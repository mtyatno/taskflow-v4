"""E2E redesain detail task (modal + panel Live Edit). Tidak dijalankan CI.

Spec docs/superpowers/specs/2026-10-26-redesain-detail-task-design.md, plan
docs/superpowers/plans/2026-10-26-redesain-detail-task.md. Server lokal dijalankan sendiri (uvicorn webapp:app, DB
sementara); host luar diblokir; `tf_whatsnew_seen` diisi agar modal "Apa yang baru" tidak menutupi UI; konteks browser
baru (SW diblokir) sehingga cache lama tidak berpengaruh. Screenshot: temporary_files/e2e_detail_redesign/ (atau
$E2E_SHOTS_DIR). Keluar non-zero bila ada langkah gagal.

Kelompok (E2E_ONLY=autosave,... menjalankan sebagian; kosong = semua). Tiap kelompok memakai user baru sendiri.

  autosave  (Task 2) modal ikut simpan otomatis, mode ✏️ Edit / 💾 Simpan dihapus. Modal 1280 px terang dan
            375 px gelap:
    A-1  ketik "baru" di textarea "Deskripsi" lalu klik ✕ < 300 ms kemudian → task lokal (router lokal) dan, setelah
         sync, server berdeskripsi "baru" (flush saat modal ditutup, tanpa menunggu diam 1,5 dtk)
    A-2  task bertag lokal `kerja` → ubah judul ("Judul task") + Enter → ✕ → tag lokal tetap ["kerja"], tag server
         memuat `kerja`, judul server = judul baru
    A-3  offline (CDP) → buka lalu tutup 3 task tanpa mengubah apa pun → jumlah `_outbox` tetap dan
         `updated_at`/`rev`/`dirty` rekaman lokal tiap task tetap
    A-4  modal tidak memuat teks "✏️ Edit", "💾 Simpan", "Batal"
    A-5  tanpa error konsol/pageerror

  topbar  (Task 3) bar atas, chip, pill progress, popover, menu ⋯. Modal 1280 px terang, modal 375 px gelap, panel
          Live Edit 1280 px terang:
    T-1  teks bar atas `#<id> • Dibuat <d Mmm yyyy>`; tanpa "🗑️ Hapus" / "✅ Done"
    T-2  Fokus → aria-pressed="true", modal tetap terbuka, server is_focused benar setelah sync; klik lagi → salah
    T-3  pill → "75%" → pill "75%"; reload → lokal dan server 75; slider: fokus + ArrowRight ×2 → 85 tersimpan
    T-4  modal: Selesai → modal tertutup, server done; panel: Selesai → panel tetap, "Buka lagi" → server next,
         tombol kembali "Selesai"
    T-5  ⋯ → Hapus (confirm diterima) → task hilang di server; ⋯ task anak tanpa "Pindah ke Workspace";
         ⋯ → Pindah ke Workspace membuka panel Pindah
    T-6  (Review Focus 1) popover terbuka lalu detail berganti/ditutup lewat el.click() (tanpa pointerdown, jadi
         penutup klik-di-luar tidak ikut): panel baris lain / task anak (onOpenTask); modal ✕ / task anak / Selesai
         → 0 .td-pop
    T-7  (Review Focus 2) panel berisi tinggi digulir 40 px → pill → |pop.top − (pill.bottom + 4)| ≤ 2; gulir 30 px
         lagi → tetap ≤ 2; modal 375 px: left 8, lebar 359, dasar popover ≤ tinggi viewport
    T-8  (Review Focus 4) offline: task dibuat lewat api.post (id = cid) → modal 375 px: .td-top tidak meluber;
         Fokus → rekaman lokal is_focused; Selesai → modal tertutup, lokal done; online → server is_focused + done
    T-9  tanpa error konsol/pageerror

Pengecualian cek konsol (sama dengan e2e_live_edit.py), jumlahnya dicetak di akhir:
  (1) pra-ada: setelah hapus + sync, syncpull mencatat 404 untuk `GET /api/tasks/:id` (konfirmasi task hilang). Akhir
      skrip menegaskan lewat `BAD_RESPONSES` bahwa SETIAP respons >= 400 pada `/api/tasks/<id>` adalah `GET` 404;
  (2) selama emulasi offline CDP, fetch jaringan `/api/...` yang tidak dilayani router lokal gagal
      `net::ERR_INTERNET_DISCONNECTED` (R17).

    python3 temporary_files/e2e_detail_redesign.py
    E2E_ONLY=autosave python3 temporary_files/e2e_detail_redesign.py
    E2E_ONLY=autosave,topbar python3 temporary_files/e2e_detail_redesign.py
"""
import os
import re
import socket
import subprocess
import sys
import tempfile
import time

import requests
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
with open(os.path.join(ROOT, "static", "sw.js"), encoding="utf-8") as _f:
    # Versi SW saat ini: ditulis ke tf_whatsnew_seen agar modal "Apa yang baru" tidak menutupi UI.
    SW_VERSION = re.search(r'^const CACHE = "([^"]+)";', _f.read(), re.M).group(1)
SHOTS = os.environ.get("E2E_SHOTS_DIR") or os.path.join(ROOT, "temporary_files", "e2e_detail_redesign")
PW = "rahasia123"
SECRET = "e2e-detail-redesign-secret"
TOURS = ['dashboard', 'tasks', 'today', 'calendar', 'kanban', 'notes', 'mindmap', 'chat', 'habits', 'habit',
         'settings', 'draw', 'goals', 'review', 'focus', 'workspace', 'slist', 'next', 'inbox', 'all', 'alltasks']

PANEL = 'aside[aria-label="Detail task"]'
MODAL = '.modal-content'
TITLE_INPUT = 'input[aria-label="Judul task"]'
DESC_AREA = 'textarea[aria-label="Deskripsi"]'

results = []  # (langkah, ok, keterangan)
known_404 = []  # 404 `GET /api/tasks/:id` pra-ada (syncpull confirm-gone) yang dikecualikan dari cek konsol
OFFLINE = {"on": False}  # True selama emulasi offline CDP; error jaringan di jendela ini dicatat terpisah
offline_noise = []  # `net::ERR_INTERNET_DISCONNECTED` milik fetch jaringan selama emulasi offline
BAD_RESPONSES = []  # semua respons >= 400 dari server lokal (diagnostik)


# ── dasar ───────────────────────────────────────────────────────────────────────
def check(step, ok, note=""):
    results.append((step, bool(ok), note))
    print(("PASS " if ok else "FAIL ") + step + (" — " + note if note else ""), flush=True)
    return ok


def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


def start_server(tmp):
    port = free_port()
    env = dict(os.environ, DB_PATH=os.path.join(tmp, "e2e.db"), UPLOAD_DIR=os.path.join(tmp, "uploads"),
               WEB_SECRET_KEY=SECRET, TELEGRAM_BOT_TOKEN="")
    os.makedirs(env["UPLOAD_DIR"], exist_ok=True)
    log = open(os.path.join(tmp, "server.log"), "w")
    proc = subprocess.Popen([sys.executable, "-m", "uvicorn", "webapp:app", "--host", "127.0.0.1",
                             "--port", str(port)], cwd=ROOT, env=env, stdout=log, stderr=subprocess.STDOUT)
    base = "http://127.0.0.1:%d" % port
    for _ in range(120):
        try:
            if requests.get(base + "/manifest.json", timeout=1).status_code < 500:
                return proc, base, env["DB_PATH"]
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


def api(base, user, method, path, **kw):
    r = requests.request(method, base + path, headers={"Authorization": "Bearer " + user["token"]}, timeout=10, **kw)
    r.raise_for_status()
    return r.json() if r.content else None


def server_task(base, user, task_id):
    return api(base, user, "GET", "/api/tasks/%d" % task_id)


def server_tags(base, user, task_id):
    return sorted(t["name"] for t in api(base, user, "GET", "/api/tasks/%d/tags" % task_id))


def server_row(base, user, title):
    for t in api(base, user, "GET", "/api/tasks?include_done=true"):
        if t["title"] == title:
            return t
    return None


def wait_until(fn, timeout=15, interval=0.3):
    end = time.time() + timeout
    last = None
    while time.time() < end:
        try:
            last = fn()
            if last:
                return last
        except Exception:  # noqa: BLE001
            last = None
        time.sleep(interval)
    return last


def open_app(browser, base, user, w, h, theme, errors, live="0"):
    """Konteks baru; error konsol/pageerror milik aplikasi (host lokal) dikumpulkan ke `errors`.
    `live` = nilai awal tf_liveedit ("1" panel Live Edit nyala, "0" mati, None tidak diisi)."""
    mobile = w < 500
    ctx = browser.new_context(service_workers="block", viewport={"width": w, "height": h},
                              device_scale_factor=1, is_mobile=mobile, has_touch=mobile)
    ctx.add_cookies([{"name": "token", "value": user["token"], "url": base, "httpOnly": True, "sameSite": "Lax"}])
    # Host luar (font, CDN) diblokir: hasil deterministik dan error muatnya bukan milik aplikasi.
    ctx.route(re.compile(r"^(?!http://127\.0\.0\.1).*$"), lambda route: route.abort())
    p = ctx.new_page()

    def on_console(msg):
        if msg.type != "error":
            return
        url = (msg.location or {}).get("url", "") or ""
        if url and not url.startswith(base):
            return  # muat sumber luar yang kita blokir
        path = url[len(base):].split("?")[0] if url else ""
        if OFFLINE["on"] and "ERR_INTERNET_DISCONNECTED" in msg.text and path.startswith("/api/"):
            offline_noise.append(path)  # fetch API yang memang diputus oleh emulasi (R17), bukan bug aplikasi
            return
        if (msg.text.startswith("Failed to load resource") and "404" in msg.text
                and re.fullmatch(r"/api/tasks/[^/]+", path)):
            known_404.append(path)  # pra-ada: syncpull confirm-gone setelah hapus + sync
            return
        errors.append("console: " + msg.text[:200] + (" @ " + url if url else ""))

    p.on("console", on_console)
    p.on("pageerror", lambda e: errors.append("pageerror: " + str(e)[:200]))
    p.on("response", lambda r: BAD_RESPONSES.append((r.request.method, r.url.replace(base, ""), r.status))
         if r.status >= 400 and r.url.startswith(base) else None)
    p.on("dialog", lambda d: d.accept())
    p.goto(base + "/manifest.json")
    p.evaluate("""([t, u, tours, theme, sw, live]) => {
        localStorage.setItem('tf_token', t); localStorage.setItem('tf_user_id', String(u));
        for (const pg of tours) localStorage.setItem('tf_tour_' + pg, '1');
        localStorage.setItem('tf_dismiss_onboarding', '1'); localStorage.setItem('tf_onboarded', '1');
        localStorage.setItem('tf_backup_snooze', new Date().toISOString().slice(0, 10));
        localStorage.setItem('tf_whatsnew_seen', sw);
        localStorage.setItem('tf_theme', theme);
        localStorage.setItem('tf_groupby', 'none'); localStorage.setItem('tf_viewmode', 'normal');
        if (live !== null) localStorage.setItem('tf_liveedit', live);
    }""", [user["token"], user["id"], TOURS, theme, SW_VERSION, live])
    p.goto(base + "/")
    p.locator(".sidebar-link, .sidebar-rail-btn").first.wait_for(state="attached", timeout=20000)
    return ctx, p


def reload_app(page):
    page.reload()
    page.locator(".sidebar-link, .sidebar-rail-btn").first.wait_for(state="attached", timeout=20000)


def fail_exc(tag, e, p=None):
    import traceback
    traceback.print_exc()
    check("%s exception" % tag, False, "%s: %s" % (type(e).__name__, str(e)[:300]))
    if p is not None:
        try:
            shot(p, "zz_error_%s.png" % re.sub(r"\W+", "", tag))
        except Exception:  # noqa: BLE001
            pass


def shot(page, name):
    path = os.path.join(SHOTS, name)
    page.wait_for_timeout(400)
    page.screenshot(path=path, full_page=False)
    print("  screenshot", name, flush=True)


# ── navigasi ────────────────────────────────────────────────────────────────────
def expand_sidebar(page):
    ex = page.locator("button[aria-label='Tampilkan semua menu']")
    if ex.count() and ex.first.is_visible():
        ex.first.click()
        page.locator(".sidebar-link").first.wait_for(timeout=5000)
        page.wait_for_timeout(300)


def collapse_sidebar(page):
    """Sidebar ikon (rail)."""
    btn = page.locator("button[aria-label='Perkecil menu']")
    if btn.count() and btn.first.is_visible():
        btn.first.click()
        page.locator("button[aria-label='Tampilkan semua menu']").first.wait_for(state="visible", timeout=5000)
        page.wait_for_timeout(400)


def go_all_tasks(page, mobile):
    """Buka halaman "Semua Task" lewat sidebar (HP: buka menu ☰ dulu)."""
    if mobile:
        page.locator(".mobile-topbar-main button", has_text="☰").first.click()
        page.wait_for_timeout(400)
    else:
        expand_sidebar(page)
    page.locator(".sidebar-link", has_text="Semua Task").first.click()
    page.locator(".task-row").first.wait_for(timeout=15000)
    page.wait_for_timeout(300)


# ── detail (modal / panel) ─────────────────────────────────────────────────────
def title_value(page, scope):
    """Judul di input "Judul task" pada `scope` (MODAL / PANEL); None bila tidak ada."""
    inp = page.locator(scope + " " + TITLE_INPUT)
    return inp.first.input_value() if inp.count() else None


def open_task(page, title, timeout=10):
    """Klik baris task (Live Edit mati) → modal terbuka dengan judul itu. Mengembalikan locator modal."""
    page.locator(".task-row", has_text=title).first.click()
    modal = page.locator(MODAL).first
    modal.wait_for(timeout=timeout * 1000)
    if not wait_until(lambda: title_value(page, MODAL) == title, timeout):
        raise AssertionError("modal tidak menampilkan judul %r (ada %r)" % (title, title_value(page, MODAL)))
    return modal


def click_row(page, title, timeout=8):
    """Live Edit nyala: klik baris → panel menampilkan task itu."""
    page.locator(".task-row", has_text=title).first.click()
    return wait_until(lambda: title_value(page, PANEL) == title, timeout)


def modal_count(page):
    return page.locator(".modal-overlay").count()


def wait_closed(page, timeout=5000):
    try:
        page.locator(".modal-overlay").first.wait_for(state="detached", timeout=timeout)
        return True
    except Exception:  # noqa: BLE001
        return False


def close_btn(page):
    return page.locator(MODAL + " span").filter(has_text=re.compile(r"^✕$")).first


# ── data lokal (IndexedDB / router lokal) ──────────────────────────────────────
def seed_local_tags(page, titles, tag):
    """Tag task hidup di IndexedDB (GET /api/tasks/:id/tags dilayani router lokal; tag dari server tidak turun):
    pasang tag lewat tagrepo untuk task bertajuk `titles`. Mengembalikan jumlah task yang ditandai."""
    return page.evaluate("""async ([titles, tag]) => {
        const db = await TF.db.openDB();
        const all = await new Promise((res, rej) => {
            const q = db.transaction('tasks', 'readonly').objectStore('tasks').getAll();
            q.onsuccess = () => res(q.result || []); q.onerror = () => rej(q.error);
        });
        let n = 0;
        for (const t of all) if (!t.deleted && titles.includes(t.title)) { await TF.tagrepo.setEntityTags('task', t.cid, [tag]); n++; }
        return n;
    }""", [titles, tag])


def seed_local_tag(page, title, tag):
    return seed_local_tags(page, [title], tag)


def local_tags(page, task_id):
    """Tag task seperti dilihat aplikasi (router lokal / IndexedDB)."""
    return page.evaluate("""async (id) => (await api.get('/api/tasks/' + id + '/tags')).map(t => t.name).sort()""",
                         task_id)


def local_task(page, task_id):
    """Task seperti dilihat aplikasi (router lokal / IndexedDB), bukan server."""
    return page.evaluate("async (id) => await api.get('/api/tasks/' + id)", task_id)


def local_rec(page, title):
    """Rekaman mentah task di IndexedDB: `updated_at`, `rev`, `dirty` (berubah pada SETIAP simpan lokal)."""
    return page.evaluate("""async (title) => {
        const db = await TF.db.openDB();
        const all = await new Promise((res, rej) => {
            const q = db.transaction('tasks', 'readonly').objectStore('tasks').getAll();
            q.onsuccess = () => res(q.result || []); q.onerror = () => rej(q.error);
        });
        const t = all.find(x => !x.deleted && x.title === title);
        return t ? {updated_at: t.updated_at, rev: t.rev == null ? null : t.rev, dirty: t.dirty == null ? null : t.dirty} : null;
    }""", title)


def outbox_count(page):
    return page.evaluate("""async () => {
        const db = await TF.db.openDB();
        return await new Promise((res, rej) => {
            const q = db.transaction('_outbox', 'readonly').objectStore('_outbox').count();
            q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error);
        });
    }""")


def settle_outbox(page, quiet=2.5, timeout=25):
    """Tunggu sampai jumlah `_outbox` tidak berubah selama `quiet` detik; kembalikan jumlahnya."""
    end = time.time() + timeout
    last, since = None, time.time()
    while time.time() < end:
        n = outbox_count(page)
        if n != last:
            last, since = n, time.time()
        elif time.time() - since >= quiet:
            return n
        time.sleep(0.3)
    return last


def net_offline(cdp, offline):
    cdp.send("Network.emulateNetworkConditions", {"offline": offline, "latency": 0, "downloadThroughput": -1,
                                                   "uploadThroughput": -1})


# ── kelompok: autosave (Task 2) ────────────────────────────────────────────────
AS_DESC = "Tulis ringkasan rapat"
AS_TAG = "Susun jadwal piket"
AS_TAG_NEW = "Susun jadwal piket minggu depan"
AS_OPEN = ["Cek stok printer", "Balas email klien", "Rapikan folder desain"]
AUTOSAVE_COMBOS = [("1280", 1280, 860, "light"), ("375", 375, 812, "dark")]


def seed_autosave(base, name):
    user = register(base, name)
    ids = {}
    for server_title, title in [(AS_DESC, AS_DESC), (AS_TAG + " #kerja", AS_TAG)] + [(t, t) for t in AS_OPEN]:
        t = api(base, user, "POST", "/api/tasks", json={
            "title": server_title, "priority": "P3", "gtd_status": "next", "description": "Catatan awal " + title})
        ids[title] = t["id"]
    return user, ids


def run_autosave(browser, base):
    for label, w, h, theme in AUTOSAVE_COMBOS:
        tag = "A[%s %s]" % (label, theme)
        mobile = w < 500
        user, ids = seed_autosave(base, "as%s%s" % (label, theme[0]))
        errors = []
        ctx, p = open_app(browser, base, user, w, h, theme, errors, live="0")
        try:
            go_all_tasks(p, mobile)
            p.wait_for_timeout(800)  # router lokal + hydrate selesai

            # ── A-4: tanpa ✏️ Edit / 💾 Simpan / Batal ──
            modal = open_task(p, AS_DESC)
            txt = modal.inner_text()
            check("%s A-4 modal tanpa '✏️ Edit', '💾 Simpan', 'Batal'" % tag,
                  "✏️ Edit" not in txt and "💾 Simpan" not in txt and "Batal" not in txt
                  # "Simpan" polos milik form catatan (ModalNotes) dan tetap ada; yang dicari tombol mode edit task.
                  and modal.locator("button", has_text=re.compile(r"^\s*(✏️ Edit|💾 Simpan|Batal)\s*$")).count() == 0,
                  repr([s for s in ("✏️ Edit", "💾 Simpan", "Batal") if s in txt]))
            check("%s A-4b judul = input 'Judul task', deskripsi = textarea 'Deskripsi', indikator simpan + ✕ ada" % tag,
                  modal.locator(TITLE_INPUT).count() == 1 and modal.locator(DESC_AREA).count() == 1
                  and modal.locator(".tl-save-ind").count() == 1 and close_btn(p).is_visible())
            shot(p, "A_%s_%s_modal.png" % (label, theme))

            # ── A-1: ketik lalu ✕ < 300 ms → tersimpan (flush saat tutup) ──
            tid = ids[AS_DESC]
            area = modal.locator(DESC_AREA).first
            area.click()
            area.fill("baru")
            t0 = time.time()
            close_btn(p).click()
            dt = time.time() - t0
            closed = wait_closed(p)
            check("%s A-1a ✕ diklik %.0f ms setelah mengetik (< 300 ms) dan modal tertutup" % (tag, dt * 1000),
                  dt < 0.3 and closed)
            check("%s A-1b task lokal berdeskripsi 'baru'" % tag,
                  wait_until(lambda: local_task(p, tid).get("description") == "baru", 6),
                  repr(local_task(p, tid).get("description")))
            check("%s A-1c server (setelah sync) berdeskripsi 'baru'" % tag,
                  wait_until(lambda: server_task(base, user, tid).get("description") == "baru", 20),
                  repr(server_task(base, user, tid).get("description")))

            # ── A-2: judul diubah + Enter → tag lokal tetap, server memuat tag ──
            gid = ids[AS_TAG]
            check("%s A-2a prasyarat: tag lokal `kerja` terpasang" % tag,
                  seed_local_tag(p, AS_TAG, "kerja") == 1 and local_tags(p, gid) == ["kerja"], repr(local_tags(p, gid)))
            modal = open_task(p, AS_TAG)
            inp = modal.locator(TITLE_INPUT).first
            inp.click()
            inp.fill(AS_TAG_NEW)
            inp.press("Enter")
            p.wait_for_timeout(200)
            close_btn(p).click()
            wait_closed(p)
            check("%s A-2b judul lokal = judul baru, tag lokal tetap ['kerja']" % tag,
                  wait_until(lambda: local_task(p, gid).get("title") == AS_TAG_NEW and local_tags(p, gid) == ["kerja"], 8),
                  "judul=%r tag=%r" % (local_task(p, gid).get("title"), local_tags(p, gid)))
            check("%s A-2c server: judul baru dan tag memuat `kerja`" % tag,
                  wait_until(lambda: server_task(base, user, gid).get("title") == AS_TAG_NEW
                             and "kerja" in server_tags(base, user, gid), 20),
                  "judul=%r tag=%r" % (server_task(base, user, gid).get("title"), server_tags(base, user, gid)))

            # ── A-3: offline, buka/tutup 3 task tanpa edit → tidak ada simpan ──
            before = settle_outbox(p)
            recs_before = {t: local_rec(p, t) for t in AS_OPEN}
            check("%s A-3a prasyarat: rekaman lokal 3 task ada" % tag, all(recs_before.values()), repr(recs_before))
            cdp = ctx.new_cdp_session(p)
            OFFLINE["on"] = True
            net_offline(cdp, True)
            p.wait_for_timeout(500)
            check("%s A-3b halaman offline (navigator.onLine=false)" % tag, p.evaluate("() => navigator.onLine") is False)
            for t in AS_OPEN:
                open_task(p, t)
                p.wait_for_timeout(500)
                close_btn(p).click()
                wait_closed(p)
            p.wait_for_timeout(2500)  # lewat TEXT_IDLE_MS (1,5 dtk): simpan diam-diam akan terlihat di sini
            after = outbox_count(p)
            recs_after = {t: local_rec(p, t) for t in AS_OPEN}
            check("%s A-3c buka/tutup 3 task tanpa edit (OFFLINE) → `_outbox` tetap dan updated_at/rev/dirty tetap" % tag,
                  before == after and recs_before == recs_after,
                  "outbox %r→%r; rekaman sama=%r" % (before, after, recs_before == recs_after))
            net_offline(cdp, False)
            p.wait_for_timeout(1500)
            OFFLINE["on"] = False

            check("%s A-5 tanpa error konsol/pageerror" % tag, not errors, "; ".join(errors[:5]))
        except Exception as e:  # langkah yang melempar = gagal
            OFFLINE["on"] = False
            fail_exc(tag, e, p)
        finally:
            ctx.close()


# ── kelompok: topbar (Task 3) ──────────────────────────────────────────────────
TOP_BAR = ".td-top"
POP = ".td-pop"
MONTHS = "Jan|Feb|Mar|Apr|Mei|Jun|Jul|Agu|Sep|Okt|Nov|Des"
TB_MAIN = "Siapkan laporan bulanan"
TB_FOCUS = "Telepon vendor katering"
TB_PROG = "Perbarui dokumen SOP"
TB_DONE = "Kirim undangan rapat"
TB_DEL = "Arsipkan berkas lama"
TB_PARENT = "Rencana acara kantor"
TB_CHILD = "Pesan konsumsi acara"
TB_MOVE = "Susun anggaran tim"
TB_LONG = "Tinjau kontrak sewa gedung"
TB_OTHER = "Cek jadwal servis AC"
TB_LOCAL = "Lokal"


def seed_topbar(base, name):
    user = register(base, name)
    ids = {}
    for title in [TB_MAIN, TB_FOCUS, TB_PROG, TB_DONE, TB_DEL, TB_PARENT, TB_MOVE, TB_OTHER]:
        ids[title] = api(base, user, "POST", "/api/tasks", json={
            "title": title, "priority": "P2", "gtd_status": "next"})["id"]
        api(base, user, "PUT", "/api/tasks/%d" % ids[title], json={"progress": 15})  # POST mengabaikan progress
    ids[TB_CHILD] = api(base, user, "POST", "/api/tasks", json={
        "title": TB_CHILD, "priority": "P3", "gtd_status": "next", "parent_id": ids[TB_PARENT]})["id"]
    long_desc = "\n".join("Baris catatan lingkup %d: periksa pasal, tanggal, dan lampiran." % i for i in range(1, 31))
    ids[TB_LONG] = api(base, user, "POST", "/api/tasks", json={
        "title": TB_LONG, "priority": "P2", "gtd_status": "next", "description": long_desc})["id"]
    for i in range(1, 13):
        api(base, user, "POST", "/api/tasks/%d/subtasks" % ids[TB_LONG], json={"title": "Butir periksa %d" % i})
    # Workspace supaya menu Pindah punya tujuan (panel Pindah tetap terbuka walau daftar kosong).
    try:
        api(base, user, "POST", "/api/lists", json={"name": "Tim Umum"})
    except Exception:  # noqa: BLE001
        pass
    return user, ids


def scope_open(page, scope, title):
    if scope == MODAL:
        return open_task(page, title)
    if not click_row(page, title):
        raise AssertionError("panel tidak menampilkan %r" % title)
    return page.locator(PANEL).first


def pops(page):
    return page.evaluate("() => document.querySelectorAll('.td-pop').length")


def rect(page, selector):
    return page.evaluate("""(sel) => { const el = document.querySelector(sel); if (!el) return null;
        const r = el.getBoundingClientRect(); return {top: r.top, bottom: r.bottom, left: r.left, width: r.width}; }""",
                         selector)


def js_click(page, selector, text):
    """el.click() lewat evaluate: hanya event click (tanpa pointerdown/mousedown). Elemen = yang teksnya persis
    `text`, kalau tidak ada yang pertama yang memuatnya. True bila ada yang diklik."""
    return page.evaluate("""([sel, text]) => { const els = [...document.querySelectorAll(sel)];
        const el = els.find(e => e.textContent.trim() === text) || els.find(e => e.textContent.includes(text));
        if (!el) return false; el.click(); return true; }""", [selector, text])


def pill_text(page, scope):
    return page.locator(scope + " .td-pill").first.inner_text().strip()


def run_topbar(browser, base):
    combos = [("1280", 1280, 860, "light", "modal"), ("375", 375, 812, "dark", "modal"),
              ("panel", 1280, 860, "light", "panel")]
    for label, w, h, theme, kind in combos:
        tag = "T[%s %s]" % (label, theme)
        mobile = w < 500
        scope = MODAL if kind == "modal" else PANEL
        user, ids = seed_topbar(base, "tb%s%s" % (label[:3], theme[0]))
        errors = []
        ctx, p = open_app(browser, base, user, w, h, theme, errors, live="1" if kind == "panel" else "0")
        try:
            go_all_tasks(p, mobile)
            p.wait_for_timeout(800)

            # ── T-1 ──
            box = scope_open(p, scope, TB_MAIN)
            meta = box.locator(TOP_BAR + " .td-meta").first.inner_text().strip()
            check("%s T-1a bar atas `#id • Dibuat d Mmm yyyy`" % tag,
                  re.match(r"^#\d+ • Dibuat \d{1,2} (%s) \d{4}" % MONTHS, meta), repr(meta))
            txt = box.inner_text()
            check("%s T-1b tanpa '🗑️ Hapus' / '✅ Done'" % tag, "🗑️ Hapus" not in txt and "✅ Done" not in txt)
            shot(p, "T_%s_%s_%s.png" % (label, theme, kind))

            # ── T-3 pill + preset + slider ──
            pid = ids[TB_PROG]
            if kind == "modal":
                close_btn(p).click()
                wait_closed(p)
            box = scope_open(p, scope, TB_PROG)
            check("%s T-3a pill awal '15%%'" % tag, pill_text(p, scope) == "15%", pill_text(p, scope))
            p.locator(scope + " .td-pill").first.click()
            p.locator(POP).first.wait_for(timeout=3000)
            check("%s T-3b popover 'Ubah Progress' (role dialog) terbuka dan fokus di slider" % tag,
                  p.locator(POP + '[role="dialog"][aria-label="Ubah Progress"]').count() == 1
                  and p.evaluate("() => document.activeElement && document.activeElement.type === 'range'"))
            shot(p, "T_%s_%s_%s_progress.png" % (label, theme, kind))
            p.locator(POP + " button", has_text=re.compile(r"^75%$")).first.click()
            check("%s T-3c pill '75%%' setelah preset" % tag,
                  wait_until(lambda: pill_text(p, scope) == "75%", 3), pill_text(p, scope))
            check("%s T-3d preset 75%% aria-pressed" % tag,
                  p.locator(POP + ' button[aria-pressed="true"]', has_text="75%").count() == 1)
            p.keyboard.press("Escape")
            check("%s T-3e Escape menutup popover, fokus kembali ke pill" % tag,
                  wait_until(lambda: pops(p) == 0, 3)
                  and p.evaluate("() => document.activeElement && document.activeElement.classList.contains('td-pill')"))
            check("%s T-3f lokal 75" % tag, wait_until(lambda: local_task(p, pid).get("progress") == 75, 6),
                  repr(local_task(p, pid).get("progress")))
            check("%s T-3g server 75" % tag,
                  wait_until(lambda: server_task(base, user, pid).get("progress") == 75, 20),
                  repr(server_task(base, user, pid).get("progress")))
            if kind == "modal":
                close_btn(p).click()
                wait_closed(p)
            reload_app(p)
            go_all_tasks(p, mobile)
            p.wait_for_timeout(800)
            box = scope_open(p, scope, TB_PROG)
            check("%s T-3h reload → pill '75%%'" % tag, wait_until(lambda: pill_text(p, scope) == "75%", 5),
                  pill_text(p, scope))
            p.locator(scope + " .td-pill").first.click()
            rng = p.locator(POP + ' input[type="range"]').first
            rng.focus()
            rng.press("ArrowRight")
            rng.press("ArrowRight")
            check("%s T-3i slider ArrowRight ×2 → pill '85%%'" % tag,
                  wait_until(lambda: pill_text(p, scope) == "85%", 3), pill_text(p, scope))
            check("%s T-3j server 85 (commit saat keyup)" % tag,
                  wait_until(lambda: server_task(base, user, pid).get("progress") == 85, 20),
                  repr(server_task(base, user, pid).get("progress")))
            p.keyboard.press("Escape")
            wait_until(lambda: pops(p) == 0, 3)

            # ── T-2 Fokus ──
            fid = ids[TB_FOCUS]
            if kind == "modal":
                close_btn(p).click()
                wait_closed(p)
            box = scope_open(p, scope, TB_FOCUS)
            fbtn = p.locator(scope + ' button[aria-label="Fokus"]').first
            check("%s T-2a Fokus awal aria-pressed=false" % tag, fbtn.get_attribute("aria-pressed") == "false")
            fbtn.click()
            check("%s T-2b Fokus → aria-pressed=true" % tag,
                  wait_until(lambda: fbtn.get_attribute("aria-pressed") == "true", 3))
            p.wait_for_timeout(600)
            if kind == "modal":
                check("%s T-2c modal tetap terbuka" % tag, modal_count(p) == 1 and title_value(p, MODAL) == TB_FOCUS)
            else:
                check("%s T-2c panel tetap pada task" % tag, title_value(p, PANEL) == TB_FOCUS)
            check("%s T-2d server is_focused benar" % tag,
                  wait_until(lambda: server_task(base, user, fid).get("is_focused") is True, 20),
                  repr(server_task(base, user, fid).get("is_focused")))
            fbtn = p.locator(scope + ' button[aria-label="Fokus"]').first
            fbtn.click()
            check("%s T-2e klik lagi → aria-pressed=false" % tag,
                  wait_until(lambda: fbtn.get_attribute("aria-pressed") == "false", 3))
            check("%s T-2f server is_focused salah" % tag,
                  wait_until(lambda: server_task(base, user, fid).get("is_focused") is False, 20),
                  repr(server_task(base, user, fid).get("is_focused")))

            # ── T-6 popover yatim (Review Focus 1) ──
            # Detail berganti / ditutup TANPA pointerdown (el.click() lewat evaluate): penutup "klik di luar" milik
            # popover tidak ikut bekerja, jadi 0 .td-pop hanya bisa berasal dari portal yang ikut di-unmount.
            def orphan_case(step, open_sel, trigger_sel, trigger_text, after):
                p.locator(open_sel).first.click()
                p.locator(POP).first.wait_for(timeout=3000)
                before = pops(p)
                pd0 = p.evaluate("() => window.__pdCount || 0")
                clicked = js_click(p, trigger_sel, trigger_text)
                ok_after = after()
                p.wait_for_timeout(300)
                pd1 = p.evaluate("() => window.__pdCount || 0")
                check("%s %s → 0 .td-pop (tanpa pointerdown)" % (tag, step),
                      before == 1 and clicked and ok_after and pd1 == pd0 and pops(p) == 0,
                      "sebelum=%r diklik=%r sesudah-ok=%r pointerdown=%d .td-pop=%d"
                      % (before, clicked, ok_after, pd1 - pd0, pops(p)))

            p.evaluate("""() => { if (!window.__pdHooked) { window.__pdHooked = 1;
                document.addEventListener('pointerdown', () => { window.__pdCount = (window.__pdCount || 0) + 1; }, true); } }""")
            if kind == "panel":
                p.locator(PANEL + ' button[aria-label="Aksi lain"]').first.click()
                p.locator(POP + '[role="menu"]').first.wait_for(timeout=3000)
                shot(p, "T_%s_%s_%s_menu.png" % (label, theme, kind))
                p.keyboard.press("Escape")
                wait_until(lambda: pops(p) == 0, 3)
                orphan_case("T-6a panel: ⋯ terbuka, baris lain diklik (el.click)",
                            PANEL + ' button[aria-label="Aksi lain"]', ".task-row", TB_OTHER,
                            lambda: wait_until(lambda: title_value(p, PANEL) == TB_OTHER, 6))
                click_row(p, TB_PARENT)
                orphan_case("T-6b panel: pill terbuka, task anak dibuka (onOpenTask, el.click)",
                            PANEL + " .td-pill", PANEL + " span", TB_CHILD,
                            lambda: wait_until(lambda: title_value(p, PANEL) == TB_CHILD, 6))
            else:
                orphan_case("T-6c modal: pill terbuka lalu ✕ (el.click)", MODAL + " .td-pill",
                            MODAL + " .td-top-actions > span", "✕", lambda: wait_closed(p))
                open_task(p, TB_PARENT)
                orphan_case("T-6d modal: pill terbuka, task anak dibuka (↗/onOpenTask, el.click)", MODAL + " .td-pill",
                            MODAL + " span", TB_CHILD,
                            lambda: wait_until(lambda: title_value(p, MODAL) == TB_CHILD, 6))
                close_btn(p).click()
                wait_closed(p)
                open_task(p, TB_OTHER)
                orphan_case("T-6e modal: menu ⋯ terbuka lalu Selesai (el.click) → modal tertutup",
                            MODAL + ' button[aria-label="Aksi lain"]', MODAL + " .td-top button", "Selesai",
                            lambda: wait_closed(p))

            # ── T-7 popover menempel pada jangkar ──
            if kind == "panel":
                click_row(p, TB_LONG)
                p.wait_for_timeout(500)
                sh = p.evaluate("(sel) => { const a = document.querySelector(sel); return [a.scrollHeight, a.clientHeight]; }",
                                PANEL)
                check("%s T-7a prasyarat: panel bisa digulir (isi tinggi)" % tag, sh[0] - sh[1] > 200, repr(sh))
                p.evaluate("(sel) => { document.querySelector(sel).scrollTop = 40; }", PANEL)
                p.wait_for_timeout(200)
                p.locator(PANEL + " .td-pill").first.click()
                p.locator(POP).first.wait_for(timeout=3000)
                p.wait_for_timeout(150)
                st = p.evaluate("(sel) => document.querySelector(sel).scrollTop", PANEL)
                a, b = rect(p, PANEL + " .td-pill"), rect(p, POP)
                check("%s T-7b panel digulir %d px: |pop.top − (pill.bottom + 4)| ≤ 2" % (tag, st),
                      st >= 38 and abs(b["top"] - (a["bottom"] + 4)) <= 2, "pill=%r pop=%r" % (a, b))
                shot(p, "T_%s_%s_%s_scrolled_progress.png" % (label, theme, kind))
                p.evaluate("(sel) => { document.querySelector(sel).scrollTop += 30; }", PANEL)
                p.wait_for_timeout(250)
                st2 = p.evaluate("(sel) => document.querySelector(sel).scrollTop", PANEL)
                a, b = rect(p, PANEL + " .td-pill"), rect(p, POP)
                check("%s T-7c gulir lagi (%d px): selisih tetap ≤ 2" % (tag, st2),
                      st2 >= st + 28 and b is not None and abs(b["top"] - (a["bottom"] + 4)) <= 2,
                      "pill=%r pop=%r" % (a, b))
                p.keyboard.press("Escape")
                wait_until(lambda: pops(p) == 0, 3)
            elif mobile:
                box = scope_open(p, scope, TB_LONG)
                p.locator(MODAL + " .td-pill").first.click()
                p.locator(POP).first.wait_for(timeout=3000)
                p.wait_for_timeout(150)
                b = rect(p, POP)
                vh = p.evaluate("() => window.innerHeight")
                check("%s T-7d modal 375: left 8, lebar 359, dasar ≤ tinggi viewport" % tag,
                      b and round(b["left"]) == 8 and round(b["width"]) == 359 and b["bottom"] <= vh,
                      "pop=%r vh=%r" % (b, vh))
                p.keyboard.press("Escape")
                wait_until(lambda: pops(p) == 0, 3)
                close_btn(p).click()
                wait_closed(p)

            # ── T-5 menu ⋯ ──
            box = scope_open(p, scope, TB_MOVE)
            p.locator(scope + ' button[aria-label="Aksi lain"]').first.click()
            menu = p.locator(POP + '[role="menu"][aria-label="Aksi lain"]').first
            menu.wait_for(timeout=3000)
            check("%s T-5a menu task pribadi: Pindah ke Workspace + Hapus" % tag,
                  menu.locator('[role="menuitem"]', has_text="Pindah ke Workspace").count() == 1
                  and menu.locator('[role="menuitem"]', has_text="Hapus").count() == 1)
            menu.locator('[role="menuitem"]', has_text="Pindah ke Workspace").first.click()
            check("%s T-5b Pindah ke Workspace membuka panel Pindah, menu tertutup" % tag,
                  wait_until(lambda: p.locator(scope + " .task-move-panel").count() == 1, 3) and pops(p) == 0)
            p.locator(scope + " .task-move-panel button", has_text="Batal").first.click()
            if kind == "modal":
                close_btn(p).click()
                wait_closed(p)
            box = scope_open(p, scope, TB_PARENT)
            if kind == "modal":
                p.locator(MODAL).get_by_text(TB_CHILD, exact=True).first.click()
                check("%s T-5c buka task anak" % tag, wait_until(lambda: title_value(p, MODAL) == TB_CHILD, 6))
            else:
                p.locator(PANEL).get_by_text(TB_CHILD, exact=True).first.click()
                check("%s T-5c buka task anak" % tag, wait_until(lambda: title_value(p, PANEL) == TB_CHILD, 6))
            check("%s T-5d task anak: baris '↳ Subtask dari #%d'" % (tag, ids[TB_PARENT]),
                  ("↳ Subtask dari #%d" % ids[TB_PARENT]) in p.locator(scope + " .td-parent").first.inner_text())
            p.locator(scope + ' button[aria-label="Aksi lain"]').first.click()
            menu = p.locator(POP + '[role="menu"]').first
            menu.wait_for(timeout=3000)
            check("%s T-5e menu task anak tanpa 'Pindah ke Workspace'" % tag,
                  "Pindah ke Workspace" not in menu.inner_text() and "Hapus" in menu.inner_text())
            p.keyboard.press("Escape")
            wait_until(lambda: pops(p) == 0, 3)
            if kind == "modal":
                close_btn(p).click()
                wait_closed(p)
            did = ids[TB_DEL]
            box = scope_open(p, scope, TB_DEL)
            p.locator(scope + ' button[aria-label="Aksi lain"]').first.click()
            p.locator(POP + ' [role="menuitem"]', has_text="Hapus").first.click()
            check("%s T-5f Hapus (confirm diterima) → task hilang di server" % tag,
                  wait_until(lambda: server_row(base, user, TB_DEL) is None, 20))
            if kind == "modal":
                check("%s T-5g modal tertutup setelah Hapus" % tag, wait_closed(p))

            # ── T-4 Selesai / Buka lagi ──
            xid = ids[TB_DONE]
            box = scope_open(p, scope, TB_DONE)
            p.locator(scope + " .td-top button", has_text="Selesai").first.click()
            if kind == "modal":
                check("%s T-4a modal: Selesai → modal tertutup" % tag, wait_closed(p))
                check("%s T-4b server done" % tag,
                      wait_until(lambda: server_task(base, user, xid).get("gtd_status") == "done", 20),
                      repr(server_task(base, user, xid).get("gtd_status")))
            else:
                reopen = p.locator(PANEL + " .td-top button", has_text="Buka lagi")
                check("%s T-4c panel: Selesai → panel tetap, tombol 'Buka lagi'" % tag,
                      wait_until(lambda: reopen.count() == 1, 8) and title_value(p, PANEL) == TB_DONE)
                check("%s T-4d panel: Fokus disembunyikan saat done" % tag,
                      p.locator(PANEL + ' button[aria-label="Fokus"]').count() == 0)
                check("%s T-4e server done" % tag,
                      wait_until(lambda: server_task(base, user, xid).get("gtd_status") == "done", 20),
                      repr(server_task(base, user, xid).get("gtd_status")))
                meta = p.locator(PANEL + " .td-meta").first.inner_text()
                check("%s T-4f bar atas memuat '• Selesai <tanggal>'" % tag,
                      re.search(r" • Selesai \d{1,2} (%s) \d{4}" % MONTHS, meta), repr(meta))
                shot(p, "T_%s_%s_%s_done.png" % (label, theme, kind))
                reopen.first.click()
                check("%s T-4g Buka lagi → server next" % tag,
                      wait_until(lambda: server_task(base, user, xid).get("gtd_status") == "next", 20),
                      repr(server_task(base, user, xid).get("gtd_status")))
                check("%s T-4h tombol kembali 'Selesai'" % tag,
                      wait_until(lambda: p.locator(PANEL + " .td-top button", has_text="Selesai").count() == 1, 5))

            # ── T-8 task belum tersinkron (id = cid), modal 375 px ──
            if kind == "modal" and mobile:
                cdp = ctx.new_cdp_session(p)
                OFFLINE["on"] = True
                net_offline(cdp, True)
                p.wait_for_timeout(500)
                created = p.evaluate("""async (title) => { const r = await api.post('/api/tasks', {title});
                    window.dispatchEvent(new CustomEvent('taskSaved')); return r; }""", TB_LOCAL)
                p.locator(".task-row", has_text=TB_LOCAL).first.wait_for(timeout=10000)
                box = open_task(p, TB_LOCAL)
                idtxt = box.locator(".td-id").first.inner_text()
                check("%s T-8a id task lokal = cid (bukan angka)" % tag, not re.fullmatch(r"#\d+", idtxt),
                      "%r / %r" % (idtxt, (created or {}).get("id")))
                ov = p.evaluate("""() => { const t = document.querySelector('.modal-content .td-top');
                    const id = t.querySelector('.td-id');
                    return {sw: t.scrollWidth, cw: t.clientWidth, idsw: id.scrollWidth, idcw: id.clientWidth,
                            right: t.getBoundingClientRect().right, vw: innerWidth}; }""")
                check("%s T-8b .td-top tidak meluber (scrollWidth ≤ clientWidth + 1), #cid berelipsis" % tag,
                      ov["sw"] <= ov["cw"] + 1 and ov["right"] <= ov["vw"], repr(ov))
                shot(p, "T_%s_%s_%s_cid.png" % (label, theme, kind))
                cid = created["id"]
                fbtn = p.locator(MODAL + ' button[aria-label="Fokus"]').first
                fbtn.click()
                check("%s T-8c Fokus bisa diklik (aria-pressed=true)" % tag,
                      wait_until(lambda: fbtn.get_attribute("aria-pressed") == "true", 3))
                check("%s T-8d rekaman lokal (cid) is_focused benar" % tag,
                      wait_until(lambda: local_task(p, cid).get("is_focused") is True, 5),
                      repr(local_task(p, cid).get("is_focused")))
                p.locator(MODAL + " .td-top button", has_text="Selesai").first.click()
                check("%s T-8e Selesai pada task cid (offline) → modal tertutup" % tag, wait_closed(p))
                check("%s T-8f rekaman lokal (cid) gtd_status done" % tag,
                      wait_until(lambda: local_task(p, cid).get("gtd_status") == "done", 5),
                      repr(local_task(p, cid).get("gtd_status")))
                net_offline(cdp, False)
                p.wait_for_timeout(1000)
                OFFLINE["on"] = False
                p.evaluate("() => window.__pushNow && window.__pushNow()")
                check("%s T-8g online → server: task 'Lokal' ada, is_focused benar, gtd_status done" % tag,
                      wait_until(lambda: (lambda r: r is not None and r.get("is_focused") is True
                                          and r.get("gtd_status") == "done")(server_row(base, user, TB_LOCAL)), 30),
                      repr(server_row(base, user, TB_LOCAL)))

            check("%s T-9 tanpa error konsol/pageerror" % tag, not errors, "; ".join(errors[:5]))
        except Exception as e:  # langkah yang melempar = gagal
            OFFLINE["on"] = False
            fail_exc(tag, e, p)
        finally:
            ctx.close()


# Urutan kelompok; task berikutnya menambah (nama, fungsi(browser, base)).
GROUPS = [
    ("autosave", run_autosave),
    ("topbar", run_topbar),
]


def want(name):
    only = [x for x in os.environ.get("E2E_ONLY", "").split(",") if x]
    return not only or name in only


def main():
    os.makedirs(SHOTS, exist_ok=True)
    for f in os.listdir(SHOTS):
        if f.endswith(".png"):
            os.remove(os.path.join(SHOTS, f))
    tmp = tempfile.mkdtemp(prefix="e2e_detail_redesign_")
    proc, base, _db = start_server(tmp)
    print("server", base, "root", ROOT, "SW", SW_VERSION, flush=True)
    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            for name, fn in GROUPS:
                if want(name):
                    print("== %s ==" % name, flush=True)
                    fn(browser, base)
            browser.close()
    except Exception as e:  # noqa: BLE001
        import traceback
        traceback.print_exc()
        check("exception", False, "%s: %s" % (type(e).__name__, e))
    finally:
        proc.terminate()
        try:
            proc.wait(10)
        except subprocess.TimeoutExpired:
            proc.kill()
        print("server log:", os.path.join(tmp, "server.log"))

    odd = [r for r in BAD_RESPONSES if re.fullmatch(r"/api/tasks/[^/?]+", r[1].split("?")[0])
           and not (r[0] == "GET" and r[2] == 404)]
    check("Z[resp] setiap respons >= 400 pada /api/tasks/<id> adalah GET 404 (confirm-gone pra-ada)",
          not odd, "aneh=%r semua=%r" % (odd, BAD_RESPONSES))
    print("\nrespons >= 400 dari server lokal (diagnostik): %r" % BAD_RESPONSES)
    print("404 pra-ada yang dikecualikan dari cek konsol: %d %r" % (len(known_404), known_404))
    print("net::ERR_INTERNET_DISCONNECTED /api/... selama emulasi offline yang dikecualikan: %d %r"
          % (len(offline_noise), sorted(set(offline_noise))))
    failed = [r for r in results if not r[1]]
    print("\n%d langkah, %d gagal" % (len(results), len(failed)))
    for r in failed:
        print("  GAGAL:", r[0], "—", r[2])
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
