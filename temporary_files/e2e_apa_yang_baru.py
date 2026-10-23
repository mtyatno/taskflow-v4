"""E2E banner pembaruan + modal "Apa yang baru". Tidak dijalankan CI.

Spec docs/superpowers/specs/2026-10-23-apa-yang-baru-design.md §1.2, §3.1, §3.5, §3.6. Satu profil persisten (A)
mengikuti dua rilis uji tanpa me-restart uvicorn; profil baru (N) untuk login di perangkat baru.
  d0–d3  deploy tanpa restart (bug A): SW aktif di versi awal → `CACHE` + `__SW_VERSION` salinan diganti
         taskflow-v998-e2e. /api/version langsung melaporkan rilis; banner muncul, satu klik → v998; lalu
         visibilitychange + checkForAppUpdate() → tidak ada banner selama 5 dtk (di main /api/version masih
         versi awal → banner kembali).
  w0–w3  banner hanya dari SW menunggu (bug B): rilis taskflow-v999-e2e, server melaporkan v999 (main: literal
         `sw_cache` di webapp.py salinan dinaikkan + restart, seperti deploy yang benar). Unduhan tailwind milik
         install SW baru DITAHAN → selama installing tidak boleh ada banner; setelah dilepas banner muncul dengan
         reg.waiting; satu klik → v999; checkForAppUpdate() → tidak ada banner selama 5 dtk.
  m1–m3  setelah reload ke v999 modal tampil berisi entri "Rilis uji E2E" v999; "Mengerti" → tf_whatsnew_seen
         = v999; offline (set_offline + semua request dibatalkan), penanda dihapus, reload → modal tetap tampil.
  t1     dua tab dengan modal; "Mengerti" di tab A → modal tab B hilang ≤ 2 dtk (event storage).
  s1–s3  Pengaturan → "Apa yang baru" → riwayat ≥ 2 rilis; 375 px terang + gelap, "Mengerti" di dalam viewport;
         riwayat tidak menulis penanda.
  n1     profil baru, login lewat form → tanpa modal setelah 3 dtk, penanda = versi sekarang.
Rilis uji = `CACHE` di static/sw.js salinan + semua kemunculan versi lama di static/index.html salinan (penetapan
awal <body> + fallback Pengaturan) + entri teratas `Rilis uji E2E` di static/whatsnew.json salinan bila ada.

Server (uvicorn) berjalan dari SALINAN repo supaya file statis bisa diubah antar fase.
E2E_REPO=/path/checkout menyalin checkout lain (mis. worktree origin/main) untuk perbandingan.
PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS=1 diset di skrip: tanpanya context.route tidak melihat fetch dari SW.
Playwright sync hanya memproses handler route saat dipompa → tunggu dengan page.wait_for_timeout, bukan time.sleep.

    python3 temporary_files/e2e_apa_yang_baru.py
    E2E_REPO=/path/worktree-main python3 temporary_files/e2e_apa_yang_baru.py

Screenshot ke temporary_files/e2e_apa_yang_baru/ (di-.gitignore), berawalan E2E_TAG (default `branch`, atau nama
folder E2E_REPO). Keluar non-zero bila ada langkah gagal. E2E_KEEP=1 menyimpan folder sementara.
"""
import json
import os
import re
import shutil
import socket
import subprocess
import sys
import tempfile
import time

os.environ["PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS"] = "1"

import requests  # noqa: E402
from playwright.sync_api import Error as PwError, sync_playwright  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPO = os.path.abspath(os.environ.get("E2E_REPO") or ROOT)
TAG = os.environ.get("E2E_TAG") or ("branch" if REPO == ROOT else os.path.basename(REPO.rstrip("/")))
SHOTS = os.path.join(ROOT, "temporary_files", "e2e_apa_yang_baru")
PW = "rahasia123"
SECRET = "e2e-apa-yang-baru-secret-0123456789abcd"
TOURS = ['dashboard', 'tasks', 'today', 'calendar', 'kanban', 'notes', 'mindmap', 'chat', 'habits', 'habit',
         'settings', 'draw', 'goals', 'review', 'focus', 'workspace', 'slist', 'all', 'inbox',
         'done', 'overdue', 'next', 'waiting', 'someday']
V1 = "taskflow-v998-e2e"
V2 = "taskflow-v999-e2e"
SEEN_FUTURE = "taskflow-v1000-e2e"  # penanda > versi sekarang: modal saat muat tidak tampil, penulisan terdeteksi
TEST_TITLE = "Rilis uji E2E"
HOLD = "**/static/vendor/tailwind.min.css*"  # file STATIC (shell atomik) → install SW baru tertahan
ALL = re.compile(r".*")
APP_SEL = ".sidebar-link, .sidebar-rail-btn, .mobile-topbar"
COPY_IGNORE = shutil.ignore_patterns(".git", "node_modules", "venv", ".venv", "temporary_files", "__pycache__",
                                     ".pytest_cache", "uploads", "src-tauri", "draw-app", "docs", "tests",
                                     ".agents", ".superpowers", "milkdown-build", "*.db", "*.db-*", "*.zip")

results = []


def check(step, ok, note=""):
    results.append((step, bool(ok), str(note)))
    print(("PASS " if ok else "FAIL ") + step + (" — " + str(note) if note else ""), flush=True)
    return ok


def scenario(ids, fn):
    """Jalankan satu skenario; galat → langkah yang belum tercatat ditandai FAIL, skenario berikutnya tetap jalan."""
    try:
        fn()
    except Exception as err:  # noqa: BLE001 — harness: catat lalu lanjut
        msg = "galat: %s: %s" % (type(err).__name__, (str(err).splitlines() or [""])[0])
        print("  (skenario %s berhenti: %s)" % ("/".join(ids), msg), flush=True)
        done = {r[0].split(" ", 1)[0] for r in results}
        for i in ids:
            if i not in done:
                check(i + " tidak selesai", False, msg)


def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


class Server:
    """uvicorn dari salinan repo; restart memakai port yang sama (origin SW + localStorage tetap)."""

    def __init__(self, app_dir, tmp):
        self.app_dir, self.tmp = app_dir, tmp
        self.port = free_port()
        self.base = "http://127.0.0.1:%d" % self.port
        self.proc = None
        self.log = open(os.path.join(tmp, "server.log"), "a")

    def start(self):
        env = dict(os.environ, DB_PATH=os.path.join(self.tmp, "e2e.db"), UPLOAD_DIR=os.path.join(self.tmp, "uploads"),
                   WEB_SECRET_KEY=SECRET, TELEGRAM_BOT_TOKEN="")
        os.makedirs(env["UPLOAD_DIR"], exist_ok=True)
        self.proc = subprocess.Popen([os.environ.get("E2E_PYTHON") or sys.executable, "-m", "uvicorn", "webapp:app",
                                      "--host", "127.0.0.1", "--port", str(self.port)],
                                     cwd=self.app_dir, env=env, stdout=self.log, stderr=subprocess.STDOUT)
        for _ in range(120):
            try:
                if requests.get(self.base + "/manifest.json", timeout=1).status_code < 500:
                    return
            except requests.RequestException:
                pass
            if self.proc.poll() is not None:
                break
            time.sleep(0.5)
        self.stop()
        raise RuntimeError("server gagal start, lihat " + self.log.name)

    def stop(self):
        if self.proc and self.proc.poll() is None:
            self.proc.terminate()
            try:
                self.proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                self.proc.kill()

    def restart(self):
        self.stop()
        self.start()


def register(base, name):
    u = "%s%d" % (name, int(time.time() * 1000) % 10_000_000)
    r = requests.post(base + "/api/auth/register",
                      json={"username": u, "password": PW, "email": u + "@ex.com", "display_name": name})
    r.raise_for_status()
    j = r.json()
    return {"username": u, "id": j["user_id"], "token": j["token"]}


def read(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


def write(path, text):
    with open(path, "w", encoding="utf-8") as f:
        f.write(text)


def sw_cache_name(app_dir):
    return re.search(r'^const CACHE = "([^"]+)";', read(os.path.join(app_dir, "static", "sw.js")), re.M).group(1)


def release(app_dir, old, new):
    """Rilis uji: CACHE (sw.js) + __SW_VERSION (index.html, semua kemunculan) + entri whatsnew.json bila ada."""
    sw = os.path.join(app_dir, "static", "sw.js")
    out, n = re.subn(r'^const CACHE = "[^"]+";', 'const CACHE = "%s";' % new, read(sw), count=1, flags=re.M)
    assert n == 1, "baris const CACHE tidak ditemukan"
    write(sw, out)
    idx = os.path.join(app_dir, "static", "index.html")
    html = read(idx)
    count = html.count('"%s"' % old)
    assert count >= 1 and 'window.__SW_VERSION = "%s"' % old in html, "__SW_VERSION %s tidak ditemukan" % old
    write(idx, html.replace('"%s"' % old, '"%s"' % new))
    wn = os.path.join(app_dir, "static", "whatsnew.json")
    note = "index.html: %d kemunculan" % count
    if os.path.exists(wn):
        data = json.loads(read(wn))
        data["entries"].insert(0, {"version": new, "date": time.strftime("%Y-%m-%d"), "title": TEST_TITLE,
                                   "new": ["Poin uji untuk %s." % new]})
        write(wn, json.dumps(data, ensure_ascii=False, indent=1))
        note += ", whatsnew.json + entri %s" % new
    print("  rilis %s → %s (%s)" % (old, new, note), flush=True)


def server_literal(app_dir, new):
    """main: /api/version memakai literal sw_cache di webapp.py → naikkan (restart menyusul). Branch: tidak ada."""
    wp = os.path.join(app_dir, "webapp.py")
    out, n = re.subn(r'sw_cache = "[^"]+"', 'sw_cache = "%s"' % new, read(wp))
    if n:
        write(wp, out)
    return bool(n)


def api_version(base):
    try:
        return requests.get(base + "/api/version", timeout=5).json().get("sw_version")
    except (requests.RequestException, ValueError) as err:
        return "gagal: %s" % err


def shot(page, name):
    path = os.path.join(SHOTS, "%s-%s" % (TAG, name))
    page.wait_for_timeout(350)  # animasi modal/banner selesai
    page.screenshot(path=path, full_page=False)
    print("  screenshot", os.path.relpath(path, ROOT), flush=True)
    return os.path.relpath(path, ROOT)


def launch(pw, profile, base, viewport=(1280, 860)):
    """Konteks persisten (profil sama = Cache Storage + registrasi SW tetap ada)."""
    ctx = pw.chromium.launch_persistent_context(profile, headless=True, service_workers="allow",
                                                viewport={"width": viewport[0], "height": viewport[1]})
    # CDN/font eksternal diblokir proxy sandbox: batalkan langsung supaya tidak menggantung.
    ctx.route(re.compile(r"^(?!%s/)" % re.escape(base)), lambda route: route.abort())
    page = ctx.pages[0] if ctx.pages else ctx.new_page()
    watch_page(page)
    return ctx, page


def watch_page(page):
    page.on("dialog", lambda d: d.accept())
    page.on("pageerror", lambda e: print("  (pageerror %s)" % str(e).splitlines()[0], flush=True))


def seed(page, base, user=None, seen=None):
    """Kunci tur/onboarding/tema; user → token di localStorage (sudah login sebelum halaman dimuat)."""
    page.goto(base + "/manifest.json")
    page.evaluate("""([t, u, tours, seen]) => {
        if (t) { localStorage.setItem('tf_token', t); localStorage.setItem('tf_user_id', String(u)); }
        for (const pg of tours) localStorage.setItem('tf_tour_' + pg, '1');
        localStorage.setItem('tf_dismiss_onboarding', '1');
        localStorage.setItem('tf_theme', 'light');
        if (seen) localStorage.setItem('tf_whatsnew_seen', seen);
    }""", [user and user["token"], user and user["id"], TOURS, seen])
    if user:
        page.context.add_cookies([{"name": "token", "value": user["token"], "url": base, "httpOnly": True,
                                   "sameSite": "Lax"}])


def wait_app(page, timeout=30000):
    page.wait_for_load_state("load")
    page.locator(APP_SEL).first.wait_for(state="attached", timeout=timeout)


STATE_JS = """async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    let server = null;
    try {
        const r = await fetch('/api/version?t=' + Date.now(), { cache: 'no-store' });
        server = r.ok ? (await r.json()).sw_version : 'HTTP ' + r.status;
    } catch (e) { server = 'gagal'; }
    return {
        page: window.__SW_VERSION, server,
        controller: !!navigator.serviceWorker.controller,
        installing: !!(reg && reg.installing), waiting: !!(reg && reg.waiting),
        banner: !!document.querySelector('.update-notification-banner'),
        modal: !!document.querySelector('.whatsnew-modal'),
        seen: localStorage.getItem('tf_whatsnew_seen'),
        caches: (await caches.keys()).filter(k => !k.startsWith('alurik-ambient-')),
    };
}"""


def state(page):
    for _ in range(5):
        try:
            return page.evaluate(STATE_JS)
        except PwError as err:  # konteks hancur karena reload controllerchange → coba lagi
            if "destroyed" not in str(err) and "navigation" not in str(err):
                raise
            page.wait_for_load_state("load")
    raise RuntimeError("state gagal: halaman terus bernavigasi")


# Catat kemunculan PERTAMA banner + keadaan registration saat itu (banner yang sudah ada juga tercatat).
OBSERVE_JS = """() => {
    window.__e2eBanner = [];
    if (window.__e2eObs) window.__e2eObs.disconnect();
    const rec = () => {
        if (window.__e2eBanner.length || !document.querySelector('.update-notification-banner')) return;
        const r = window.__SW_REGISTRATION;
        window.__e2eBanner.push({ waiting: !!(r && r.waiting), installing: !!(r && r.installing),
                                  page: window.__SW_VERSION });
    };
    window.__e2eObs = new MutationObserver(rec);
    window.__e2eObs.observe(document.body, { childList: true, subtree: true });
    rec();
}"""

TRIGGER_JS = """async (call) => {
    document.dispatchEvent(new Event('visibilitychange'));
    if (call) await window.checkForAppUpdate();
}"""


def banner_log(page):
    return page.evaluate("window.__e2eBanner || []")


def no_banner_for(page, ms):
    """visibilitychange + checkForAppUpdate(), lalu amati `ms` milidetik: True bila banner tidak pernah muncul."""
    page.evaluate(OBSERVE_JS)
    page.evaluate(TRIGGER_JS, True)
    page.wait_for_timeout(ms)
    log = banner_log(page)
    return not log and page.locator(".update-notification-banner").count() == 0, log


def click_banner(page):
    """Satu klik "Perbarui Sekarang"; True bila halaman bernavigasi (reload) dalam 20 dtk."""
    btn = page.locator(".update-notification-banner button.btn-primary")
    try:
        with page.expect_navigation(timeout=20000):
            btn.click()
        nav = True
    except PwError as err:
        print("  (tanpa navigasi setelah klik: %s)" % str(err).splitlines()[0], flush=True)
        nav = False
    wait_app(page)
    return nav


def modal_info(page):
    m = page.locator(".whatsnew-modal")
    return {
        "releases": m.locator(".whatsnew-release").count(),
        "titles": m.locator(".whatsnew-release-title").all_text_contents(),
        "text": m.inner_text() if m.count() else "",
    }


def dismiss_whatsnew(page, timeout=10000):
    """Bantuan (bukan langkah): tutup modal bila muncul (penanda = versi sekarang). False bila tidak muncul."""
    modal = page.locator(".whatsnew-modal")
    try:
        modal.wait_for(state="visible", timeout=timeout)
    except PwError:
        print("  (modal Apa yang baru tidak muncul dalam %d dtk)" % (timeout // 1000), flush=True)
        return False
    page.locator(".whatsnew-ok").click()
    modal.wait_for(state="detached", timeout=5000)
    return True


def seen(page):
    return page.evaluate("localStorage.getItem('tf_whatsnew_seen')")


def ok_in_viewport(page, vw, vh):
    box = page.locator(".whatsnew-ok").bounding_box()
    return bool(box and box["x"] >= 0 and box["y"] >= 0 and box["x"] + box["width"] <= vw
                and box["y"] + box["height"] <= vh), box


def open_history(page):
    page.evaluate("window.dispatchEvent(new CustomEvent('navigate', { detail: 'settings' }))")
    btn = page.get_by_role("button", name="Apa yang baru")
    btn.wait_for(timeout=10000)
    btn.scroll_into_view_if_needed()
    btn.click()
    page.locator(".whatsnew-modal").wait_for(state="visible", timeout=10000)
    page.wait_for_timeout(400)  # animasi whatsnew-pop (scale) selesai sebelum mengukur


def main():
    os.makedirs(SHOTS, exist_ok=True)
    for f in os.listdir(SHOTS):
        if f.startswith(TAG + "-") and f.endswith(".png"):
            os.remove(os.path.join(SHOTS, f))
    tmp = tempfile.mkdtemp(prefix="e2e_apa_yang_baru_")
    app_dir = os.path.join(tmp, "app")
    shutil.copytree(REPO, app_dir, ignore=COPY_IGNORE)
    v0 = sw_cache_name(app_dir)
    has_whatsnew = os.path.exists(os.path.join(app_dir, "static", "whatsnew.json"))
    srv = Server(app_dir, tmp)
    srv.start()
    base = srv.base
    print("repo", REPO, "| tag", TAG, "| SW awal", v0, "| whatsnew.json", has_whatsnew, flush=True)
    print("server", base, "| tmp", tmp, flush=True)
    try:
        user = register(base, "wnew")
        with sync_playwright() as pw:
            ctx, page = launch(pw, os.path.join(tmp, "profile-a"), base)
            seed(page, base, user, seen=v0)
            page.goto(base + "/")
            page.wait_for_function("() => navigator.serviceWorker && navigator.serviceWorker.controller",
                                   timeout=60000)
            page.wait_for_timeout(1500)  # reload controllerchange pertama (index.html) selesai
            page.goto(base + "/")
            wait_app(page)
            st = state(page)
            check("p0 SW %s mengendalikan halaman, tanpa banner" % v0,
                  st["controller"] and st["page"] == v0 and st["caches"] == [v0] and not st["banner"], st)

            # ── d: deploy tanpa restart (bug A) ──────────────────────────────────────────────────────
            def scen_d():
                release(app_dir, v0, V1)
                api = api_version(base)
                check("d0 /api/version = %s tanpa restart server" % V1, api == V1, "server melaporkan %s" % api)
                page.evaluate(OBSERVE_JS)
                page.evaluate(TRIGGER_JS, False)  # tab kembali aktif
                page.locator(".update-notification-banner").wait_for(state="visible", timeout=90000)
                log = banner_log(page)
                check("d1 banner muncul setelah deploy tanpa restart", bool(log), {"banner": log, **state(page)})
                shot(page, "d1-banner.png")
                nav = click_banner(page)
                st = state(page)
                check("d2 satu klik → __SW_VERSION = %s, cache %s saja" % (V1, V1),
                      nav and st["page"] == V1 and st["caches"] == [V1], st)
                dismiss_whatsnew(page)  # modal v998 (bukan langkah d; modal diuji di m* pada v999)
                ok, log = no_banner_for(page, 5000)
                st = state(page)
                check("d3 visibilitychange + checkForAppUpdate() → tanpa banner selama 5 dtk", ok,
                      {"banner": log, **st})
                if not ok:
                    shot(page, "d3-banner-kembali.png")

            scenario(["d0", "d1", "d2", "d3"], scen_d)

            # ── w: banner hanya dari SW menunggu (bug B) ─────────────────────────────────────────────
            def scen_w():
                cur = page.evaluate("window.__SW_VERSION")
                release(app_dir, cur, V2)
                restarted = server_literal(app_dir, V2)
                if restarted:
                    srv.restart()
                api = api_version(base)
                check("w0 /api/version = %s (%s)" % (V2, "literal sw_cache dinaikkan + restart" if restarted
                                                      else "tanpa restart"), api == V2, "server melaporkan %s" % api)
                held = []
                ctx.route(HOLD, lambda route: held.append(route))
                page.evaluate(OBSERVE_JS)
                page.evaluate(TRIGGER_JS, False)
                end = time.time() + 30
                inst = False
                while time.time() < end:
                    inst = page.evaluate("!!(window.__SW_REGISTRATION && window.__SW_REGISTRATION.installing)")
                    if inst and held:
                        break
                    page.wait_for_timeout(200)
                page.wait_for_timeout(2000)
                page.evaluate(TRIGGER_JS, False)  # pengguna berpindah tab lagi selama install
                page.wait_for_timeout(2000)
                during = banner_log(page)
                st_hold = state(page)
                first_click = None
                if page.locator(".update-notification-banner").count():
                    # Banner muncul selama install (perilaku lama): pengguna mengkliknya.
                    shot(page, "w1-banner-saat-installing.png")
                    click_banner(page)
                    first_click = page.evaluate("window.__SW_VERSION")
                ctx.unroute(HOLD)
                for r in held:
                    try:
                        r.continue_()
                    except PwError:
                        pass
                print("  install ditahan: installing=%s, request tailwind ditahan=%d" % (inst, len(held)), flush=True)
                if first_click is None:
                    page.locator(".update-notification-banner").wait_for(state="visible", timeout=90000)
                    after = banner_log(page)
                    check("w1 tanpa banner selama SW baru installing; banner muncul setelah reg.waiting",
                          inst and held and not during and after and after[0]["waiting"],
                          {"selama_ditahan": during, "saat_muncul": after, "state_ditahan": st_hold})
                    shot(page, "w1-banner-waiting.png")
                    nav = click_banner(page)
                    st = state(page)
                    check("w2 satu klik → __SW_VERSION = %s, cache %s saja" % (V2, V2),
                          nav and st["page"] == V2 and st["caches"] == [V2], st)
                else:
                    check("w1 tanpa banner selama SW baru installing; banner muncul setelah reg.waiting", False,
                          {"selama_ditahan": during, "state_ditahan": st_hold})
                    check("w2 satu klik → __SW_VERSION = %s, cache %s saja" % (V2, V2), first_click == V2,
                          "klik saat installing → versi setelah reload %s; %s" % (first_click, state(page)))
                ok, log = no_banner_for(page, 5000)
                check("w3 checkForAppUpdate() → banner tidak kembali selama 5 dtk", ok,
                      {"banner": log, **state(page)})
                if not ok:
                    shot(page, "w3-banner-kembali.png")

            scenario(["w0", "w1", "w2", "w3"], scen_w)

            # ── m: modal setelah reload, penanda, offline ──────────────────────────────────────────────
            def scen_m():
                modal = page.locator(".whatsnew-modal")
                visible = True
                try:
                    modal.wait_for(state="visible", timeout=15000)
                except PwError:
                    visible = False
                info = modal_info(page) if visible else {}
                check("m1 setelah reload ke %s modal tampil: 1 rilis \"%s\" berisi %s" % (V2, TEST_TITLE, V2),
                      visible and info["releases"] == 1 and info["titles"] == [TEST_TITLE] and V2 in info["text"],
                      info or state(page))
                if visible:
                    shot(page, "m1-modal.png")
                    page.get_by_role("button", name="Mengerti").click()
                    modal.wait_for(state="detached", timeout=5000)
                check("m2 \"Mengerti\" → tf_whatsnew_seen = %s" % V2, visible and seen(page) == V2, seen(page))
                net = []

                def block_all(route):
                    net.append(route.request.url)
                    route.abort()

                ctx.set_offline(True)
                ctx.route(ALL, block_all)
                try:
                    page.evaluate("localStorage.removeItem('tf_whatsnew_seen')")
                    page.reload()
                    wait_app(page)
                    try:
                        modal.wait_for(state="visible", timeout=15000)
                        visible = True
                    except PwError:
                        visible = False
                    info = modal_info(page) if visible else {}
                    wn_net = [u for u in net if "whatsnew.json" in u]
                    check("m3 offline + penanda dihapus + reload → modal %s tetap tampil dari cache" % V2,
                          visible and info["titles"][:1] == [TEST_TITLE] and V2 in info["text"],
                          "%s; request jaringan dibatalkan: %d (whatsnew.json: %d)"
                          % (info or "modal tidak tampil", len(net), len(wn_net)))
                    shot(page, "m3-offline.png")
                finally:
                    ctx.unroute(ALL)
                    ctx.set_offline(False)

            scenario(["m1", "m2", "m3"], scen_m)

            # ── t: dua tab ─────────────────────────────────────────────────────────────────────────────
            def scen_t():
                page.evaluate("localStorage.removeItem('tf_whatsnew_seen')")
                page.reload()
                wait_app(page)
                pb = ctx.new_page()
                watch_page(pb)
                try:
                    pb.goto(base + "/")
                    wait_app(pb)
                    for p in (page, pb):
                        p.locator(".whatsnew-modal").wait_for(state="visible", timeout=15000)
                    page.get_by_role("button", name="Mengerti").click()
                    t0 = time.time()
                    try:
                        pb.locator(".whatsnew-modal").wait_for(state="detached", timeout=2000)
                        gone = True
                    except PwError:
                        gone = False
                    check("t1 \"Mengerti\" di tab A → modal tab B hilang ≤ 2 dtk", gone,
                          "%.2f dtk; penanda tab B = %s" % (time.time() - t0, seen(pb)))
                finally:
                    pb.close()

            scenario(["t1"], scen_t)

            # ── s: riwayat di Pengaturan, 375 px terang + gelap ────────────────────────────────────────
            def scen_s():
                vw, vh = 375, 812
                page.set_viewport_size({"width": vw, "height": vh})
                page.evaluate("(v) => localStorage.setItem('tf_whatsnew_seen', v)", SEEN_FUTURE)
                page.reload()
                wait_app(page)
                open_history(page)
                info = modal_info(page)
                check("s1 Pengaturan → \"Apa yang baru\" → riwayat ≥ 2 rilis, teratas %s" % V2,
                      info["releases"] >= 2 and V2 in info["text"] and V1 in info["text"],
                      {"releases": info["releases"], "titles": info["titles"]})
                ok_l, box_l = ok_in_viewport(page, vw, vh)
                shot(page, "s2-riwayat-375-terang.png")
                page.get_by_role("button", name="Mengerti").click()
                page.locator(".whatsnew-modal").wait_for(state="detached", timeout=5000)
                check("s3 riwayat tidak mengubah penanda", seen(page) == SEEN_FUTURE, seen(page))
                page.evaluate("localStorage.setItem('tf_theme', 'dark')")
                page.reload()
                wait_app(page)
                open_history(page)
                dark = page.evaluate("document.documentElement.getAttribute('data-theme')")
                ok_d, box_d = ok_in_viewport(page, vw, vh)
                shot(page, "s2-riwayat-375-gelap.png")
                check("s2 375 px terang + gelap: \"Mengerti\" di dalam viewport", ok_l and ok_d and dark == "dark",
                      {"terang": box_l, "gelap": box_d, "data-theme": dark})
                page.get_by_role("button", name="Mengerti").click()

            scenario(["s1", "s2", "s3"], scen_s)
            ctx.close()

            # ── n: perangkat baru, login di halaman ────────────────────────────────────────────────────
            def scen_n():
                ctx_n, pn = launch(pw, os.path.join(tmp, "profile-n"), base)
                try:
                    seed(pn, base)  # tanpa token: belum login saat halaman dimuat
                    pn.goto(base + "/")
                    pn.wait_for_function("() => navigator.serviceWorker && navigator.serviceWorker.controller",
                                         timeout=60000)
                    pn.wait_for_timeout(1500)  # reload controllerchange install pertama selesai
                    pn.wait_for_load_state("load")
                    pw_input = pn.locator("input[type=password]").first
                    pw_input.wait_for(state="visible", timeout=30000)
                    had = pn.evaluate("window.__TF_HAD_USER_AT_LOAD")
                    pn.locator("input:not([type=password])").first.fill(user["username"])
                    pw_input.fill(PW)
                    pw_input.press("Enter")
                    wait_app(pn)
                    pn.wait_for_timeout(3000)
                    st = state(pn)
                    check("n1 profil baru, login di halaman → tanpa modal setelah 3 dtk, penanda = %s" % st["page"],
                          had is False and not st["modal"] and st["seen"] == st["page"] == V2,
                          {"__TF_HAD_USER_AT_LOAD": had, **st})
                    shot(pn, "n1-login-baru.png")
                finally:
                    ctx_n.close()

            scenario(["n1"], scen_n)
    finally:
        srv.stop()
        srv.log.close()
        if os.environ.get("E2E_KEEP") != "1":
            shutil.rmtree(tmp, ignore_errors=True)
        else:
            print("tmp disimpan:", tmp)

    failed = [r for r in results if not r[1]]
    print("\n%d langkah, %d PASS, %d FAIL (%s)" % (len(results), len(results) - len(failed), len(failed), TAG))
    for step, _, note in failed:
        print("  FAIL", step, "—", note)
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
