"""E2E siklus update service worker: app.css tetap ada setelah rilis + restart. Tidak dijalankan CI.

Spec docs/superpowers/specs/2026-10-22-sw-precache-shell-design.md §1 dan §6. Langkah:
  P1  pemuatan online sampai SW aktif, lalu buka lagi supaya app.css dimuat lewat SW; variabel --sidebar-rail-w
      (didefinisikan :root di app.css, tidak ada di tailwind) dan kelas tailwind `pt-4` terbaca.
  S1  rilis (CACHE di sw.js salinan → taskflow-v999-e2e) → SW baru `waiting` dengan jaringan normal → restart
      (tutup lalu buka lagi konteks persisten dengan profil yang sama) → request app.css ke jaringan dibatalkan
      → SW baru mengendalikan, cache lama terhapus, gaya app.css tetap ada.
  S2  muat ulang normal, rilis lagi (taskflow-v998-e2e) dengan tailwind.min.css dibatalkan selama install → SW baru
      `redundant` → restart dengan SEMUA request dibatalkan → cache v999 tetap ada dan tampilan tetap bergaya.

Server (uvicorn) berjalan dari SALINAN repo (tanpa .git/node_modules/venv/temporary_files) supaya static/sw.js
salinan bisa diubah antar fase; webapp.py membaca /sw.js dari disk tiap request (no-store).
E2E_REPO=/path/checkout menyalin checkout lain (mis. worktree origin/main) untuk perbandingan.
PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS=1 diset di skrip: tanpanya context.route tidak melihat fetch dari SW.

    python3 temporary_files/e2e_sw_precache_shell.py
    E2E_REPO=/path/worktree-main python3 temporary_files/e2e_sw_precache_shell.py

Screenshot ke temporary_files/e2e_sw_precache_shell/ (di-.gitignore), berawalan E2E_TAG (default `branch`, atau
nama folder E2E_REPO). Keluar non-zero bila ada langkah gagal.
"""
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
SHOTS = os.path.join(ROOT, "temporary_files", "e2e_sw_precache_shell")
PW = "rahasia123"
SECRET = "e2e-sw-precache-shell-secret-0123456789"
TOURS = ['dashboard', 'tasks', 'today', 'calendar', 'kanban', 'notes', 'mindmap', 'chat', 'habits', 'habit',
         'settings', 'draw', 'goals', 'review', 'focus', 'workspace', 'slist', 'all', 'inbox',
         'done', 'overdue', 'next', 'waiting', 'someday']
CSS_VAR = "--sidebar-rail-w"  # :root di app.css (64px); tailwind tidak mendefinisikannya
CSS_VAR_VALUE = "64px"
TW_PROBE = "16px"  # .pt-4{padding-top:1rem} dari tailwind.min.css
V_NEW = "taskflow-v999-e2e"
V_FAIL = "taskflow-v998-e2e"
COPY_IGNORE = shutil.ignore_patterns(".git", "node_modules", "venv", ".venv", "temporary_files", "__pycache__",
                                     ".pytest_cache", "uploads", "src-tauri", "draw-app", "docs", "tests",
                                     ".agents", ".superpowers", "milkdown-build", "*.db", "*.db-*", "*.zip")

results = []


def check(step, ok, note=""):
    results.append((step, bool(ok), str(note)))
    print(("PASS " if ok else "FAIL ") + step + (" — " + str(note) if note else ""), flush=True)
    return ok


def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


def server_python():
    """Python untuk uvicorn: E2E_PYTHON bila diset, lalu interpreter ini (dependensi server terpasang sistem)."""
    return os.environ.get("E2E_PYTHON") or sys.executable


def copy_repo(tmp):
    dst = os.path.join(tmp, "app")
    shutil.copytree(REPO, dst, ignore=COPY_IGNORE)
    return dst


def start_server(app_dir, tmp):
    port = free_port()
    env = dict(os.environ, DB_PATH=os.path.join(tmp, "e2e.db"), UPLOAD_DIR=os.path.join(tmp, "uploads"),
               WEB_SECRET_KEY=SECRET, TELEGRAM_BOT_TOKEN="")
    os.makedirs(env["UPLOAD_DIR"], exist_ok=True)
    log = open(os.path.join(tmp, "server.log"), "w")
    proc = subprocess.Popen([server_python(), "-m", "uvicorn", "webapp:app", "--host", "127.0.0.1",
                             "--port", str(port)], cwd=app_dir, env=env, stdout=log, stderr=subprocess.STDOUT)
    base = "http://127.0.0.1:%d" % port
    for _ in range(120):
        try:
            if requests.get(base + "/manifest.json", timeout=1).status_code < 500:
                return proc, base
        except requests.RequestException:
            pass
        if proc.poll() is not None:
            break
        time.sleep(0.5)
    proc.kill()
    raise RuntimeError("server gagal start, lihat " + log.name)


def register(base, name):
    u = "%s%d" % (name, int(time.time() * 1000) % 10_000_000)
    r = requests.post(base + "/api/auth/register",
                      json={"username": u, "password": PW, "email": u + "@ex.com", "display_name": name})
    r.raise_for_status()
    j = r.json()
    return {"username": u, "id": j["user_id"], "token": j["token"]}


def sw_cache_name(sw_path):
    m = re.search(r'^const CACHE = "([^"]+)";', open(sw_path, encoding="utf-8").read(), re.M)
    return m.group(1)


def set_sw_cache(sw_path, name):
    """Rilis tiruan: ganti CACHE di sw.js salinan (byte berubah → browser memasang SW baru)."""
    src = open(sw_path, encoding="utf-8").read()
    out, n = re.subn(r'^const CACHE = "[^"]+";', 'const CACHE = "%s";' % name, src, count=1, flags=re.M)
    assert n == 1, "baris const CACHE tidak ditemukan di " + sw_path
    open(sw_path, "w", encoding="utf-8").write(out)


def app_css_url(index_path):
    m = re.search(r'<link[^>]*href="(/static/app\.css[^"]*)"', open(index_path, encoding="utf-8").read())
    return m.group(1)


def shot(page, name):
    path = os.path.join(SHOTS, "%s-%s" % (TAG, name))
    page.wait_for_timeout(300)
    page.screenshot(path=path, full_page=False)
    print("  screenshot", os.path.relpath(path, ROOT), flush=True)


def launch(pw, profile, base, block_all=False):
    """Konteks persisten (profil sama = Cache Storage + registrasi SW tetap ada, semua klien tertutup = restart)."""
    ctx = pw.chromium.launch_persistent_context(profile, headless=True, service_workers="allow",
                                                viewport={"width": 1280, "height": 860})
    if block_all:
        ctx.route(re.compile(r".*"), lambda route: route.abort())
    else:
        # CDN/font eksternal diblokir proxy sandbox: batalkan langsung supaya tidak menggantung.
        ctx.route(re.compile(r"^(?!%s/)" % re.escape(base)), lambda route: route.abort())
    page = ctx.pages[0] if ctx.pages else ctx.new_page()
    page.on("dialog", lambda d: d.accept())
    return ctx, page


def login(page, base, user):
    page.context.add_cookies([{"name": "token", "value": user["token"], "url": base, "httpOnly": True,
                               "sameSite": "Lax"}])
    page.goto(base + "/manifest.json")
    page.evaluate("""([t, u, tours]) => {
        localStorage.setItem('tf_token', t); localStorage.setItem('tf_user_id', String(u));
        for (const pg of tours) localStorage.setItem('tf_tour_' + pg, '1');
        localStorage.setItem('tf_dismiss_onboarding', '1');
        localStorage.setItem('tf_theme', 'light');
    }""", [user["token"], user["id"], TOURS])


def wait_app(page, timeout=30000):
    """Tunggu UI ter-render; jeda ekstra untuk reload controllerchange (index.html) bila ada."""
    try:
        page.locator(".sidebar-link, .sidebar-rail-btn").first.wait_for(state="attached", timeout=timeout)
        page.wait_for_timeout(1500)
        page.locator(".sidebar-link, .sidebar-rail-btn").first.wait_for(state="attached", timeout=timeout)
        return True
    except PwError as err:
        print("  (UI belum ter-render: %s)" % str(err).splitlines()[0], flush=True)
        return False


SNAPSHOT_JS = """async ([cssVar, cssUrl]) => {
    const probe = document.createElement('div');
    probe.className = 'pt-4';
    document.body.appendChild(probe);
    const tw = getComputedStyle(probe).paddingTop;
    probe.remove();
    const reg = await navigator.serviceWorker.getRegistration();
    const keys = await caches.keys();
    const cssIn = [];
    for (const k of keys) {
        if (await (await caches.open(k)).match(cssUrl)) cssIn.push(k);
    }
    return {
        cssVar: getComputedStyle(document.documentElement).getPropertyValue(cssVar).trim(),
        tw, keys, cssIn,
        controller: !!navigator.serviceWorker.controller,
        active: !!(reg && reg.active), waiting: !!(reg && reg.waiting), installing: !!(reg && reg.installing),
    };
}"""


def snapshot(page, css_url):
    for _ in range(5):
        try:
            return page.evaluate(SNAPSHOT_JS, [CSS_VAR, css_url])
        except PwError as err:  # konteks hancur karena reload controllerchange → coba lagi
            if "destroyed" not in str(err) and "navigation" not in str(err):
                raise
            page.wait_for_load_state("load")
            page.wait_for_timeout(1000)
    raise RuntimeError("snapshot gagal: halaman terus bernavigasi")


WAIT_WAITING_JS = """async (timeoutMs) => {
    const reg = await navigator.serviceWorker.getRegistration();
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
        if (reg.waiting) return { waiting: true, ms: timeoutMs - (end - Date.now()) };
        if (!reg.installing) await reg.update().catch(() => {});
        await new Promise(r => setTimeout(r, 500));
    }
    return { waiting: !!reg.waiting, installing: !!reg.installing, ms: timeoutMs };
}"""

UPDATE_TRACK_JS = """async (timeoutMs) => {
    const reg = await navigator.serviceWorker.getRegistration();
    const states = [];
    const done = new Promise(resolve => {
        const watch = w => {
            if (!w) return;
            states.push(w.state);
            w.addEventListener('statechange', () => {
                states.push(w.state);
                if (['redundant', 'installed', 'activated'].includes(w.state)) resolve(w.state);
            });
        };
        if (reg.installing) watch(reg.installing);
        reg.addEventListener('updatefound', () => watch(reg.installing));
    });
    const timeout = new Promise(r => setTimeout(() => r('timeout'), timeoutMs));
    const update = reg.update().then(() => 'resolve', e => 'reject: ' + (e && e.message));
    const final = await Promise.race([done, timeout]);
    return { final, states, update: await Promise.race([update, timeout]),
             waiting: !!reg.waiting, installing: !!reg.installing };
}"""


def styled(snap):
    return snap["cssVar"] == CSS_VAR_VALUE and snap["tw"] == TW_PROBE


def describe(snap):
    return "%s=%r, pt-4=%s, caches=%s, app.css di cache=%s, controller=%s, waiting=%s" % (
        CSS_VAR, snap["cssVar"], snap["tw"], snap["keys"], snap["cssIn"], snap["controller"], snap["waiting"])


def main():
    os.makedirs(SHOTS, exist_ok=True)
    for f in os.listdir(SHOTS):
        if f.startswith(TAG + "-") and f.endswith(".png"):
            os.remove(os.path.join(SHOTS, f))
    tmp = tempfile.mkdtemp(prefix="e2e_sw_precache_shell_")
    app_dir = copy_repo(tmp)
    sw_path = os.path.join(app_dir, "static", "sw.js")
    v_old = sw_cache_name(sw_path)
    css_url = app_css_url(os.path.join(app_dir, "static", "index.html"))
    profile = os.path.join(tmp, "profile")
    print("repo", REPO, "| tag", TAG, "| SW awal", v_old, "| app.css", css_url, flush=True)
    proc, base = start_server(app_dir, tmp)
    print("server", base, "| tmp", tmp, flush=True)
    try:
        user = register(base, "swshell")
        with sync_playwright() as pw:
            # ── P1: pemuatan online sampai SW aktif; buka lagi supaya app.css lewat SW ──────────────
            ctx, page = launch(pw, profile, base)
            login(page, base, user)
            page.goto(base + "/")
            page.wait_for_function("() => navigator.serviceWorker && navigator.serviceWorker.controller",
                                   timeout=60000)
            page.wait_for_timeout(2500)  # reload controllerchange pertama (index.html) selesai
            page.goto(base + "/")
            wait_app(page)
            snap = snapshot(page, css_url)
            check("P1 SW mengendalikan halaman, cache = %s" % v_old,
                  snap["controller"] and snap["keys"] == [v_old], describe(snap))
            check("P1 tampilan bergaya (app.css + tailwind)", styled(snap), describe(snap))
            check("P1 app.css ada di cache SW aktif", v_old in snap["cssIn"], describe(snap))
            shot(page, "p1-online.png")

            # ── S1: rilis → waiting → restart → app.css dari jaringan dibatalkan ───────────────────
            set_sw_cache(sw_path, V_NEW)
            page.goto(base + "/")
            wait_app(page)
            w = page.evaluate(WAIT_WAITING_JS, 90000)
            check("S1 SW %s ter-install dan menunggu (waiting)" % V_NEW, w["waiting"], w)
            ctx.close()

            ctx, page = launch(pw, profile, base)
            css_hits = []

            def abort_css(route):
                css_hits.append(route.request.url)
                route.abort()

            ctx.route("**/static/app.css*", abort_css)
            page.goto(base + "/")
            wait_app(page)
            snap = snapshot(page, css_url)
            check("S1 SW baru aktif: cache %s ada, %s terhapus" % (V_NEW, v_old),
                  V_NEW in snap["keys"] and v_old not in snap["keys"], describe(snap))
            check("S1 gaya app.css tetap diterapkan (%s=%s) walau app.css dari jaringan dibatalkan"
                  % (CSS_VAR, CSS_VAR_VALUE), snap["cssVar"] == CSS_VAR_VALUE,
                  describe(snap) + "; request app.css ke jaringan dibatalkan: %d" % len(css_hits))
            check("S1 tailwind tetap diterapkan", snap["tw"] == TW_PROBE, describe(snap))
            shot(page, "s1-after-restart.png")

            # ── S2: rilis lagi dengan tailwind gagal saat install → SW lama tetap mengendalikan ──────
            ctx.unroute("**/static/app.css*")
            page.goto(base + "/")
            wait_app(page)
            snap = snapshot(page, css_url)
            check("S2 awal: SW %s mengendalikan, tampilan bergaya dengan jaringan normal" % V_NEW,
                  snap["controller"] and V_NEW in snap["keys"] and styled(snap), describe(snap))
            set_sw_cache(sw_path, V_FAIL)
            tw_hits = []

            def abort_tw(route):
                tw_hits.append(route.request.url)
                route.abort()

            ctx.route("**/static/vendor/tailwind.min.css*", abort_tw)
            u = page.evaluate(UPDATE_TRACK_JS, 90000)
            ctx.unroute("**/static/vendor/tailwind.min.css*")
            check("S2 install %s dengan tailwind gagal → redundant" % V_FAIL, u["final"] == "redundant",
                  "%s; request tailwind dibatalkan: %d" % (u, len(tw_hits)))
            check("S2 tidak ada SW waiting", not u["waiting"], u)
            shot(page, "s2-install-failed.png")
            ctx.close()

            ctx, page = launch(pw, profile, base, block_all=True)
            try:
                page.goto(base + "/")
                nav_ok = True
            except PwError as err:
                nav_ok = False
                print("  (navigasi gagal: %s)" % str(err).splitlines()[0], flush=True)
            check("S2 restart tanpa jaringan: halaman dilayani SW", nav_ok)
            if nav_ok:
                wait_app(page)
                snap = snapshot(page, css_url)
                check("S2 cache %s (SW sebelumnya) tetap ada" % V_NEW, V_NEW in snap["keys"], describe(snap))
                check("S2 tampilan tetap bergaya tanpa jaringan (app.css + tailwind)", styled(snap),
                      describe(snap))
                shot(page, "s2-offline-restart.png")
            ctx.close()
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()
        if os.environ.get("E2E_KEEP") != "1":
            shutil.rmtree(tmp, ignore_errors=True)

    failed = [r for r in results if not r[1]]
    print("\n%d langkah, %d PASS, %d FAIL (%s)" % (len(results), len(results) - len(failed), len(failed), TAG))
    for step, _, note in failed:
        print("  FAIL", step, "—", note)
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
