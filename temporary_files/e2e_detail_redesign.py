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

  props  (Task 4) kisi properti + popover picker. Panel Live Edit 1280 px terang dan modal 375 px gelap:
    P-1  Status → Waiting, Prioritas → P1 Critical → server waiting/P1; Menunggu "Budi" + Enter → server waiting_for
    P-2  (Review Focus 3) proyek "Pemasaran" ada: ketik "Pema", diam 2 dtk, Escape → tanpa proyek "Pema", proyek task
         tetap; "pemasaran" + Enter → "Pemasaran" (satu nama di server); "+ Buat 'Riset Pasar'" → dibuat sekali;
         Tahap → Kosongkan → context kosong di server
    P-3  offline: Deadline diketik digit demi digit (11152026) → `_outbox` tetap selama mengetik, naik tepat 1 saat
         popover ditutup (klik di luar); online → server deadline 2026-11-15
    P-4  (Review Focus 5) P1 + "Hari ini" → chip Q1 tanpa reload; tanggal kemarin diketik → chip "Terlambat" dan nilai
         Deadline is-danger; "Hapus deadline" → chip hilang, nilai "+ Tambah"
    P-8  (review akhir) deadline 2026-11-15: segmen hari dikosongkan (Backspace → value "" + badInput) lalu klik di
         luar → nilai tetap "15 Nov 2026", deadline lokal dan server tetap
    P-5  workspace dua anggota: Assign ke anggota → server assigned_to; "Lepas" → task lokal tanpa assignee (server
         tidak ikut: bug pra-ada syncpush.js mengirim assigned_to null yang diabaikan PUT; dicetak di akhir)
    P-6  Escape menutup popover dan fokus kembali ke tombol nilai; detail tanpa select / .input-label
    P-7  tanpa error konsol/pageerror

  tags  (Task 5) baris Tag + TagAdder (judul tersimpan + #tag, ADR-032). Modal 375 px gelap dan panel Live Edit
        1280 px terang. Tag lokal dinormalkan huruf kecil (tagrepo), jadi "Rapat" tampil/tersimpan sebagai `rapat`:
    G-1  task bertag lokal `kerja` → "+" → "Rapat" Enter → chip #kerja dan #rapat, popover tetap terbuka dengan input
         kosong; tag lokal dua; setelah sync tag server dua; judul lokal (input) dan server tanpa `#`
    G-3  "dua kata" Enter → alert "Tag hanya boleh huruf, angka, dan _"; kosong + Enter → "Tulis nama tag"
    G-4  task lain bertag `proyekx` → ketik "proy" → saran `proyekx` (tag terpasang tidak disarankan) → klik → terpasang
    G-2  (Review Focus 3) offline: "#KERJA" Enter → tanpa chip baru, tanpa alert, `_outbox` dan `updated_at` lokal tetap
    G-5  × pada #rapat → hilang (lokal); lalu ubah judul → #rapat tidak kembali (lokal dan server)
    G-6  ketik deskripsi lalu (< 1 dtk) tambah tag → deskripsi dan tag sama-sama tersimpan (lokal dan server)
    G-7  tanpa error konsol/pageerror

  tabs  (Task 6) deskripsi tanpa bingkai + tab Subtask/Checklist/Catatan/Lampiran. Panel Live Edit 1280 px terang
        dan modal 375 px gelap:
    B-1  task dengan 2 anak, 3 butir checklist, 1 catatan → label "Subtask (2)", "Checklist (3)", "Catatan (1)",
         "Lampiran"; aktif "Subtask"; deadline anak terlambat merah; task hanya bercatatan → aktif "Catatan"
    B-2  "+ Buat subtask baru…" "Anak C" Enter → baris `#<id> Anak C` chip Inbox, "Subtask (3)"; centang → dicoret +
         server done; centang lagi → server next; tombol buka → panel/modal menampilkan Anak C
    B-3  checklist: "Butir 4" lalu "Butir 5" tanpa membuka ulang, Escape → "Checklist (5)"; centang → aria-checked
         dan lokal selesai; × → "Checklist (4)"; 375 px (sentuh): × terlihat tanpa hover
    B-4  tambah catatan di tab Catatan → "Catatan (2)"
    B-6  fokus tab "Subtask", ArrowRight → "Checklist" aria-selected dan terfokus; ArrowLeft → kembali
    B-5  deskripsi: placeholder persis; 5 baris → tinggi bertambah; 30 baris → tinggi = 12 baris, bisa digulir
    B-7  tanpa error konsol/pageerror

Pengecualian cek konsol (sama dengan e2e_live_edit.py), jumlahnya dicetak di akhir:
  (1) pra-ada: setelah hapus + sync, syncpull mencatat 404 untuk `GET /api/tasks/:id` (konfirmasi task hilang). Akhir
      skrip menegaskan lewat `BAD_RESPONSES` bahwa SETIAP respons >= 400 pada `/api/tasks/<id>` adalah `GET` 404;
  (2) selama emulasi offline CDP, fetch jaringan `/api/...` yang tidak dilayani router lokal gagal
      `net::ERR_INTERNET_DISCONNECTED` (R17).

    python3 temporary_files/e2e_detail_redesign.py
    E2E_ONLY=autosave python3 temporary_files/e2e_detail_redesign.py
    E2E_ONLY=autosave,topbar python3 temporary_files/e2e_detail_redesign.py
    E2E_ONLY=tags,props python3 temporary_files/e2e_detail_redesign.py
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
KNOWN_ISSUES = []  # temuan pra-ada di luar cakupan (dicetak di akhir, tidak menggagalkan run)


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


# ── kelompok: props (Task 4) ───────────────────────────────────────────────────
PR_MAIN = "Susun proposal pameran"
PR_NAME = "Riset vendor panggung"
PR_DATE = "Kirim brosur cetak"
PR_QUAD = "Siapkan materi presentasi"
PR_WS = "Bagi tugas dekorasi"
PR_PROJECT = "Pemasaran"
PR_NEW_PROJECT = "Riset Pasar"


def seed_props(base, name):
    user = register(base, name)
    ids = {}
    api(base, user, "POST", "/api/projects", json={"name": PR_PROJECT})
    for title, extra in [(PR_MAIN, {}), (PR_NAME, {"context": "Rapat"}), (PR_DATE, {}), (PR_QUAD, {})]:
        body = {"title": title, "priority": "P3", "gtd_status": "next"}
        body.update(extra)
        ids[title] = api(base, user, "POST", "/api/tasks", json=body)["id"]
    # Workspace dua anggota (P-5): pemilik = user ini, anggota bergabung lewat kode undangan.
    member = register(base, name + "m")
    ws = api(base, user, "POST", "/api/lists", json={"name": "Tim Pameran"})
    code = api(base, user, "POST", "/api/lists/%d/generate-link" % ws["id"], json={})["code"]
    api(base, member, "POST", "/api/lists/join", json={"code": code})
    ids[PR_WS] = api(base, user, "POST", "/api/tasks", json={
        "title": PR_WS, "priority": "P3", "gtd_status": "next", "list_id": ws["id"]})["id"]
    return user, member, ws, ids


def prop_btn(page, scope, label):
    """Tombol nilai properti; properti opsional kosong (Assign ke, Menunggu) tampil sebagai tombol ringkas "+ …"
    (.td-prop-add) dengan aria-label yang sama ("<Label>: kosong"), klik membuka baris penuh + popover."""
    return page.locator('%s button.td-prop-val[aria-label^="%s: "], %s button.td-prop-add[aria-label^="%s: "]'
                        % (scope, label, scope, label)).first


def pop_item(page, text):
    return page.locator(POP + " button", has_text=re.compile(r"^\s*%s\s*$" % re.escape(text))).first


def server_projects(base, user):
    return api(base, user, "GET", "/api/projects")


def type_date(page, mmddyyyy):
    """Klik input tanggal di popover lalu ketik digit demi digit (locale en-US: bulan/hari/tahun)."""
    inp = page.locator(POP + ' input[type="date"]').first
    inp.click()
    for ch in mmddyyyy:
        page.keyboard.type(ch)
        page.wait_for_timeout(60)
    return inp


def click_outside(page, scope):
    """pointerdown di luar popover dan jangkar (judul detail) → popover ditutup (commit)."""
    page.locator(scope + " .td-meta").first.click()


def run_props(browser, base):
    combos = [("panel", 1280, 860, "light", "panel"), ("375", 375, 812, "dark", "modal")]
    for label, w, h, theme, kind in combos:
        tag = "P[%s %s]" % (label, theme)
        mobile = w < 500
        scope = MODAL if kind == "modal" else PANEL
        user, member, ws, ids = seed_props(base, "pr%s%s" % (label[:3], theme[0]))
        errors = []
        ctx, p = open_app(browser, base, user, w, h, theme, errors, live="1" if kind == "panel" else "0")

        def reopen(title):
            """Modal: tutup dulu bila terbuka, lalu buka task; panel: klik baris."""
            if kind == "modal" and modal_count(p):
                close_btn(p).click()
                wait_closed(p)
            return scope_open(p, scope, title)

        try:
            go_all_tasks(p, mobile)
            p.wait_for_timeout(800)

            # ── P-6: Escape menutup, fokus kembali ke nilai; tanpa select/.input-label ──
            box = reopen(PR_MAIN)
            check("%s P-6a kisi properti: Status, Prioritas, Tahap, Proyek, Deadline; Menunggu & Tag kosong diringkas "
                  "jadi '+ Menunggu' '+ Tag' (tanpa Assign di task pribadi)"
                  % tag, [x.strip() for x in box.locator(".td-props .td-prop-label").all_inner_texts()]
                  == ["Status", "Prioritas", "Tahap", "Proyek", "Deadline"]
                  and [x.strip() for x in box.locator(".td-prop-add").all_inner_texts()] == ["+ Menunggu", "+ Tag"]
                  and box.locator('[aria-label^="Assign ke: "]').count() == 0,
                  repr((box.locator(".td-prop-label").all_inner_texts(), box.locator(".td-prop-add").all_inner_texts())))
            check("%s P-6b detail tanpa select / .input-label" % tag,
                  box.locator("select").count() == 0 and box.locator(".input-label").count() == 0,
                  "select=%d label=%d" % (box.locator("select").count(), box.locator(".input-label").count()))
            check("%s P-6c nilai kosong '+ Tambah' (Proyek, Deadline); Menunggu ringkas '+ Menunggu'" % tag,
                  all(prop_btn(p, scope, l).inner_text().strip() == "+ Tambah" for l in ("Proyek", "Deadline"))
                  and prop_btn(p, scope, "Menunggu").inner_text().strip() == "+ Menunggu")
            sbtn = prop_btn(p, scope, "Status")
            sbtn.click()
            p.locator(POP).first.wait_for(timeout=3000)
            check("%s P-6d popover Status terbuka, aria-expanded=true" % tag,
                  pops(p) == 1 and sbtn.get_attribute("aria-expanded") == "true")
            shot(p, "P_%s_%s_status_pop.png" % (label, theme))
            p.keyboard.press("Escape")
            check("%s P-6e Escape → popover tertutup, fokus kembali ke tombol Status" % tag,
                  wait_until(lambda: pops(p) == 0, 3) and p.evaluate(
                      "() => (document.activeElement.getAttribute('aria-label') || '').startsWith('Status: ')"))

            # ── P-1: Status Waiting, Prioritas P1 Critical, Menunggu Budi ──
            tid = ids[PR_MAIN]
            prop_btn(p, scope, "Status").click()
            pop_item(p, "Waiting").click()
            check("%s P-1a pilih Waiting → popover tertutup, nilai 'Waiting'" % tag,
                  wait_until(lambda: pops(p) == 0 and prop_btn(p, scope, "Status").inner_text().strip() == "Waiting", 3),
                  prop_btn(p, scope, "Status").inner_text())
            prop_btn(p, scope, "Prioritas").click()
            pop_item(p, "P1 Critical").click()
            check("%s P-1b pilih P1 Critical → nilai 'P1 Critical'" % tag,
                  wait_until(lambda: prop_btn(p, scope, "Prioritas").inner_text().strip() == "P1 Critical", 3))
            check("%s P-1c server: gtd_status waiting, priority P1" % tag,
                  wait_until(lambda: (lambda t: t["gtd_status"] == "waiting" and t["priority"] == "P1")(
                      server_task(base, user, tid)), 20), repr({k: server_task(base, user, tid).get(k)
                                                               for k in ("gtd_status", "priority")}))
            prop_btn(p, scope, "Menunggu").click()
            winp = p.locator(POP + " input").first
            winp.wait_for(timeout=3000)
            check("%s P-1d popover Menunggu: input terfokus" % tag,
                  p.evaluate("() => document.activeElement && document.activeElement.closest('.td-pop') !== null"))
            p.keyboard.type("Budi")
            shot(p, "P_%s_%s_menunggu_pop.png" % (label, theme))
            p.keyboard.press("Enter")
            check("%s P-1e Enter → popover tertutup, nilai 'Budi'" % tag,
                  wait_until(lambda: pops(p) == 0 and prop_btn(p, scope, "Menunggu").inner_text().strip() == "Budi", 3))
            check("%s P-1f server waiting_for == 'Budi'" % tag,
                  wait_until(lambda: server_task(base, user, tid).get("waiting_for") == "Budi", 20),
                  repr(server_task(base, user, tid).get("waiting_for")))

            # ── P-2: NamePicker (Review Focus 3) ──
            nid = ids[PR_NAME]
            box = reopen(PR_NAME)
            before_proj = server_task(base, user, nid).get("project")
            prop_btn(p, scope, "Proyek").click()
            p.locator(POP + " input").first.wait_for(timeout=3000)
            p.keyboard.type("Pema")
            check("%s P-2a cari 'Pema' menyaring: opsi 'Pemasaran' tampil, '+ Buat 'Pema'' tampil" % tag,
                  pop_item(p, PR_PROJECT).count() == 1 and p.locator(POP, has_text="+ Buat 'Pema'").count() == 1)
            shot(p, "P_%s_%s_proyek_pop.png" % (label, theme))
            p.wait_for_timeout(2000)
            p.keyboard.press("Escape")
            wait_until(lambda: pops(p) == 0, 3)
            p.wait_for_timeout(2500)
            projs = server_projects(base, user)
            check("%s P-2b ketik 'Pema' + diam 2 dtk + Escape → tanpa proyek 'Pema', proyek task tetap" % tag,
                  "Pema" not in projs and server_task(base, user, nid).get("project") == before_proj
                  and prop_btn(p, scope, "Proyek").inner_text().strip() == "+ Tambah",
                  "proyek=%r task=%r" % (projs, server_task(base, user, nid).get("project")))
            prop_btn(p, scope, "Proyek").click()
            p.locator(POP + " input").first.wait_for(timeout=3000)
            p.keyboard.type("pemasaran")
            p.keyboard.press("Enter")
            check("%s P-2c 'pemasaran' + Enter → nilai 'Pemasaran'" % tag,
                  wait_until(lambda: pops(p) == 0 and prop_btn(p, scope, "Proyek").inner_text().strip() == PR_PROJECT, 3),
                  prop_btn(p, scope, "Proyek").inner_text())
            check("%s P-2d server: proyek task 'Pemasaran', hanya satu nama itu (tanpa beda huruf)" % tag,
                  wait_until(lambda: server_task(base, user, nid).get("project") == PR_PROJECT, 20)
                  and [x for x in server_projects(base, user) if x.lower() == "pemasaran"] == [PR_PROJECT],
                  "task=%r proyek=%r" % (server_task(base, user, nid).get("project"), server_projects(base, user)))
            prop_btn(p, scope, "Proyek").click()
            p.locator(POP + " input").first.wait_for(timeout=3000)
            p.keyboard.type(PR_NEW_PROJECT)
            p.locator(POP + " button", has_text="+ Buat '%s'" % PR_NEW_PROJECT).first.click()
            check("%s P-2e + Buat 'Riset Pasar' → nilai 'Riset Pasar'" % tag,
                  wait_until(lambda: prop_btn(p, scope, "Proyek").inner_text().strip() == PR_NEW_PROJECT, 3))
            check("%s P-2f server: proyek task 'Riset Pasar', dibuat sekali" % tag,
                  wait_until(lambda: server_task(base, user, nid).get("project") == PR_NEW_PROJECT, 20)
                  and server_projects(base, user).count(PR_NEW_PROJECT) == 1,
                  "task=%r proyek=%r" % (server_task(base, user, nid).get("project"), server_projects(base, user)))
            check("%s P-2g prasyarat: Tahap 'Rapat'" % tag, prop_btn(p, scope, "Tahap").inner_text().strip() == "Rapat")
            prop_btn(p, scope, "Tahap").click()
            pop_item(p, "Kosongkan").click()
            check("%s P-2h Tahap → Kosongkan → nilai '+ Tambah'" % tag,
                  wait_until(lambda: prop_btn(p, scope, "Tahap").inner_text().strip() == "+ Tambah", 3))
            check("%s P-2i server: context kosong" % tag,
                  wait_until(lambda: not server_task(base, user, nid).get("context"), 20),
                  repr(server_task(base, user, nid).get("context")))

            # ── P-4: chip kuadran / Terlambat ikut nilai form (Review Focus 5) ──
            qid = ids[PR_QUAD]
            box = reopen(PR_QUAD)
            chips = lambda: box.locator(".td-chips").first.inner_text()  # noqa: E731
            check("%s P-4a prasyarat: P3 tanpa deadline → bukan Q1" % tag, "Q1" not in chips(), repr(chips()))
            prop_btn(p, scope, "Prioritas").click()
            pop_item(p, "P1 Critical").click()
            prop_btn(p, scope, "Deadline").click()
            pop_item(p, "Hari ini").click()
            check("%s P-4b P1 + Hari ini → chip 'Q1' tanpa reload" % tag, wait_until(lambda: "Q1" in chips(), 3),
                  repr(chips()))
            prop_btn(p, scope, "Deadline").click()
            p.locator(POP + ' input[type="date"]').first.wait_for(timeout=3000)
            y = time.localtime(time.time() - 86400)
            type_date(p, "%02d%02d%04d" % (y.tm_mon, y.tm_mday, y.tm_year))
            check("%s P-4c tanggal kemarin diketik → chip 'Terlambat' (popover masih terbuka)" % tag,
                  wait_until(lambda: "Terlambat" in chips(), 3) and pops(p) == 1, repr(chips()))
            shot(p, "P_%s_%s_deadline_pop.png" % (label, theme))
            click_outside(p, scope)
            check("%s P-4d tutup popover → nilai Deadline ber-kelas is-danger" % tag,
                  wait_until(lambda: pops(p) == 0 and "is-danger" in (prop_btn(p, scope, "Deadline").get_attribute("class") or ""), 3),
                  prop_btn(p, scope, "Deadline").get_attribute("class"))
            yiso = "%04d-%02d-%02d" % (y.tm_year, y.tm_mon, y.tm_mday)
            check("%s P-4e server: deadline kemarin, priority P1" % tag,
                  wait_until(lambda: (lambda t: t.get("deadline", "")[:10] == yiso and t["priority"] == "P1")(
                      server_task(base, user, qid)), 20), repr(server_task(base, user, qid).get("deadline")))
            shot(p, "P_%s_%s_terlambat.png" % (label, theme))
            prop_btn(p, scope, "Deadline").click()
            pop_item(p, "Hapus deadline").click()
            check("%s P-4f Hapus deadline → chip 'Terlambat' hilang, nilai '+ Tambah'" % tag,
                  wait_until(lambda: "Terlambat" not in chips()
                             and prop_btn(p, scope, "Deadline").inner_text().strip() == "+ Tambah", 3), repr(chips()))
            check("%s P-4g server: deadline kosong" % tag,
                  wait_until(lambda: not server_task(base, user, qid).get("deadline"), 20),
                  repr(server_task(base, user, qid).get("deadline")))

            # ── P-3: offline, ketik tanggal per digit → satu op outbox saat popover ditutup ──
            did = ids[PR_DATE]
            box = reopen(PR_DATE)
            before = settle_outbox(p)
            cdp = ctx.new_cdp_session(p)
            OFFLINE["on"] = True
            net_offline(cdp, True)
            p.wait_for_timeout(500)
            prop_btn(p, scope, "Deadline").click()
            p.locator(POP + ' input[type="date"]').first.wait_for(timeout=3000)
            type_date(p, "11152026")
            p.wait_for_timeout(2000)
            mid = outbox_count(p)
            check("%s P-3a selama mengetik (popover terbuka) `_outbox` tetap" % tag, mid == before,
                  "%r→%r" % (before, mid))
            click_outside(p, scope)
            wait_until(lambda: pops(p) == 0, 3)
            p.wait_for_timeout(2000)
            after = outbox_count(p)
            check("%s P-3b tutup popover (klik di luar) → `_outbox` naik tepat 1" % tag, after == before + 1,
                  "%r→%r" % (before, after))
            check("%s P-3c nilai Deadline '15 Nov 2026'" % tag,
                  prop_btn(p, scope, "Deadline").inner_text().strip() == "15 Nov 2026",
                  prop_btn(p, scope, "Deadline").inner_text())
            net_offline(cdp, False)
            p.wait_for_timeout(1000)
            OFFLINE["on"] = False
            p.evaluate("() => window.__pushNow && window.__pushNow()")
            check("%s P-3d online → server deadline 2026-11-15" % tag,
                  wait_until(lambda: (server_task(base, user, did).get("deadline") or "")[:10] == "2026-11-15", 30),
                  repr(server_task(base, user, did).get("deadline")))

            # ── P-8: segmen hari dikosongkan (value "" + validity.badInput) lalu klik di luar → deadline tetap ──
            prop_btn(p, scope, "Deadline").click()
            dinp = p.locator(POP + ' input[type="date"]').first
            dinp.wait_for(timeout=3000)
            dinp.focus()  # fokus ke segmen pertama (bulan, en-US)
            p.keyboard.press("ArrowRight")  # → segmen hari
            p.keyboard.press("Backspace")
            p.wait_for_timeout(300)
            st = dinp.evaluate("e => ({v: e.value, bad: e.validity.badInput})")
            check("%s P-8a prasyarat: segmen hari kosong → input value '' + badInput" % tag,
                  st.get("v") == "" and st.get("bad") is True, repr(st))
            click_outside(p, scope)
            wait_until(lambda: pops(p) == 0, 3)
            p.wait_for_timeout(2500)
            p.evaluate("() => window.__pushNow && window.__pushNow()")
            p.wait_for_timeout(2500)
            check("%s P-8b nilai Deadline tetap '15 Nov 2026' (bukan '+ Tambah')" % tag,
                  prop_btn(p, scope, "Deadline").inner_text().strip() == "15 Nov 2026",
                  prop_btn(p, scope, "Deadline").inner_text())
            check("%s P-8c lokal dan server deadline tetap 2026-11-15" % tag,
                  (local_task(p, did).get("deadline") or "")[:10] == "2026-11-15"
                  and (server_task(base, user, did).get("deadline") or "")[:10] == "2026-11-15",
                  "lokal=%r server=%r" % (local_task(p, did).get("deadline"), server_task(base, user, did).get("deadline")))

            # ── P-5: Assign ke anggota workspace, lalu Lepas ──
            wid = ids[PR_WS]
            if kind == "modal" and modal_count(p):
                close_btn(p).click()
                wait_closed(p)
            p.locator(".task-row", has_text=PR_WS).first.wait_for(timeout=15000)
            box = scope_open(p, scope, PR_WS)
            abtn = prop_btn(p, scope, "Assign ke")
            check("%s P-5a task workspace: 'Assign ke' kosong tampil ringkas '+ Assign'" % tag,
                  abtn.count() == 1 and abtn.inner_text().strip() == "+ Assign")
            abtn.click()
            p.locator(POP).first.wait_for(timeout=3000)
            check("%s P-5b daftar anggota memuat '(Saya)' dan anggota lain" % tag,
                  wait_until(lambda: p.locator(POP, has_text="(Saya)").count() == 1
                             and p.locator(POP, has_text="@" + member["username"]).count() == 1, 5))
            shot(p, "P_%s_%s_assign_pop.png" % (label, theme))
            p.locator(POP + " button", has_text="@" + member["username"]).first.click()
            check("%s P-5c pilih anggota → popover tertutup, nilai nama anggota" % tag,
                  wait_until(lambda: pops(p) == 0 and abtn.inner_text().strip() not in ("", "+ Tambah"), 3),
                  abtn.inner_text())
            check("%s P-5d server assigned_to = anggota" % tag,
                  wait_until(lambda: server_task(base, user, wid).get("assigned_to") == member["id"], 20),
                  repr(server_task(base, user, wid).get("assigned_to")))
            abtn.click()
            pop_item(p, "Lepas").click()
            check("%s P-5e Lepas → kembali ringkas '+ Assign'" % tag,
                  wait_until(lambda: abtn.inner_text().strip() == "+ Assign", 3))
            check("%s P-5f task lokal (router lokal) tanpa assignee" % tag,
                  wait_until(lambda: not local_task(p, wid).get("assigned_to"), 5),
                  repr(local_task(p, wid).get("assigned_to")))
            # Pra-ada, di luar cakupan (syncpush.js tidak boleh diubah): taskToUpdatePayload mengirim
            # assigned_to: null untuk task tanpa assignee dan PUT server mengabaikan null (hanya 0 = lepas), jadi
            # "Lepas" tidak sampai ke server. Dicatat sebagai diagnostik, bukan langkah.
            p.wait_for_timeout(4000)
            KNOWN_ISSUES.append("%s P-5 Lepas: server assigned_to tetap %r (syncpush mengirim null)"
                                % (tag, server_task(base, user, wid).get("assigned_to")))
            shot(p, "P_%s_%s_grid.png" % (label, theme))

            check("%s P-7 tanpa error konsol/pageerror" % tag, not errors, "; ".join(errors[:5]))
        except Exception as e:  # langkah yang melempar = gagal
            OFFLINE["on"] = False
            fail_exc(tag, e, p)
        finally:
            ctx.close()


# ── kelompok: tags (Task 5) ────────────────────────────────────────────────────
TG_MAIN = "Siapkan agenda rapat"
TG_OTHER = "Kumpulkan data proyek"
TG_DESC = "Tulis notulen singkat"


def seed_tags(base, name):
    user = register(base, name)
    ids = {}
    # Tag server ikut dibuat (#tag di judul POST) agar server dan lokal sejalan; tag lokal dipasang di halaman.
    for server_title, title in [(TG_MAIN + " #kerja", TG_MAIN), (TG_OTHER + " #proyekx", TG_OTHER), (TG_DESC, TG_DESC)]:
        ids[title] = api(base, user, "POST", "/api/tasks", json={
            "title": server_title, "priority": "P3", "gtd_status": "next", "description": "Awal"})["id"]
    return user, ids


def tag_chips(page, scope):
    return [x.strip().lower() for x in page.locator(scope + " .td-tag .td-tag-name").all_inner_texts()]


def tag_input(page):
    return page.locator(POP + ' input[aria-label="Nama tag"]').first


def pop_alert(page):
    a = page.locator(POP + ' [role="alert"]')
    return a.first.inner_text().strip() if a.count() else ""


def push_now(page):
    page.evaluate("() => window.__pushNow && window.__pushNow()")


def run_tags(browser, base):
    combos = [("375", 375, 812, "dark", "modal"), ("panel", 1280, 860, "light", "panel")]
    for label, w, h, theme, kind in combos:
        tag = "G[%s %s]" % (label, theme)
        mobile = w < 500
        scope = MODAL if kind == "modal" else PANEL
        user, ids = seed_tags(base, "tg%s%s" % (label[:3], theme[0]))
        errors = []
        ctx, p = open_app(browser, base, user, w, h, theme, errors, live="1" if kind == "panel" else "0")

        def reopen(title):
            if kind == "modal" and modal_count(p):
                close_btn(p).click()
                wait_closed(p)
            return scope_open(p, scope, title)

        def add_btn():
            return p.locator(scope + ' button.td-tag-add[aria-label="Tambah tag"], ' + scope
                             + ' button.td-prop-add[aria-label="Tambah tag"]').first

        try:
            # Tag lokal dipasang lalu halaman dimuat ulang: panel Live Edit bisa sudah memuat chip task pertama
            # sebelum tag dipasang (task yang sama tidak memuat ulang chip saat barisnya diklik lagi).
            check("%s G-0 prasyarat: tag lokal dipasang" % tag,
                  wait_until(lambda: seed_local_tag(p, TG_MAIN, "kerja") == 1, 15)
                  and seed_local_tag(p, TG_OTHER, "proyekx") == 1)
            reload_app(p)
            go_all_tasks(p, mobile)
            p.wait_for_timeout(800)
            mid = ids[TG_MAIN]

            # ── G-1: "+" → "Rapat" Enter ──
            box = reopen(TG_MAIN)
            check("%s G-1a baris Tag terakhir di kisi, selebar kisi; chip #kerja" % tag,
                  wait_until(lambda: tag_chips(p, scope) == ["#kerja"], 5)
                  and box.locator(".td-props > .td-prop").last.locator(".td-prop-label").inner_text().strip() == "Tag"
                  and "is-wide" in (box.locator(".td-props > .td-prop").last.get_attribute("class") or ""),
                  repr(tag_chips(p, scope)))
            add_btn().click()
            tag_input(p).wait_for(timeout=3000)
            check("%s G-1b popover 'Tambah tag' terbuka, input terfokus, aria-expanded=true" % tag,
                  pops(p) == 1 and p.locator(POP).first.get_attribute("aria-label") == "Tambah tag"
                  and p.evaluate("() => document.activeElement && document.activeElement.getAttribute('aria-label') === 'Nama tag'")
                  and add_btn().get_attribute("aria-expanded") == "true")
            p.keyboard.type("Rapat")
            p.keyboard.press("Enter")
            check("%s G-1c chip #kerja dan #rapat; popover tetap terbuka, input kosong" % tag,
                  wait_until(lambda: sorted(tag_chips(p, scope)) == ["#kerja", "#rapat"], 5)
                  and pops(p) == 1 and tag_input(p).input_value() == "", repr(tag_chips(p, scope)))
            check("%s G-1d tag lokal == [kerja, rapat]" % tag,
                  wait_until(lambda: local_tags(p, mid) == ["kerja", "rapat"], 5), repr(local_tags(p, mid)))
            check("%s G-1e judul lokal (input) tanpa '#'" % tag, title_value(p, scope) == TG_MAIN, repr(title_value(p, scope)))
            push_now(p)
            check("%s G-1f setelah sync: tag server [kerja, rapat], judul server tanpa '#'" % tag,
                  wait_until(lambda: [x.lower() for x in server_tags(base, user, mid)] == ["kerja", "rapat"]
                             and server_task(base, user, mid)["title"] == TG_MAIN, 25),
                  "tags=%r title=%r" % (server_tags(base, user, mid), server_task(base, user, mid)["title"]))
            shot(p, "G_%s_%s_tag_pop.png" % (label, theme))

            # ── G-3: galat validasi ──
            tag_input(p).fill("dua kata")
            p.keyboard.press("Enter")
            check("%s G-3a 'dua kata' → alert 'Tag hanya boleh huruf, angka, dan _'" % tag,
                  wait_until(lambda: pop_alert(p) == "Tag hanya boleh huruf, angka, dan _", 3), repr(pop_alert(p)))
            shot(p, "G_%s_%s_tag_error.png" % (label, theme))
            tag_input(p).fill("")
            check("%s G-3b mengetik menghapus alert" % tag, pop_alert(p) == "", repr(pop_alert(p)))
            p.keyboard.press("Enter")
            check("%s G-3c kosong + Enter → alert 'Tulis nama tag'" % tag,
                  wait_until(lambda: pop_alert(p) == "Tulis nama tag", 3), repr(pop_alert(p)))
            check("%s G-3d chip tetap [kerja, rapat]" % tag, sorted(tag_chips(p, scope)) == ["#kerja", "#rapat"])

            # ── G-4: saran dari tag task lain ──
            sugg = lambda: [x.strip().lower() for x in p.locator(POP + " .td-pop-list button").all_inner_texts()]  # noqa: E731
            check("%s G-4a saran tanpa tag yang sudah terpasang (kerja/rapat), memuat proyekx" % tag,
                  wait_until(lambda: "proyekx" in sugg(), 3) and "kerja" not in sugg() and "rapat" not in sugg(),
                  repr(sugg()))
            tag_input(p).fill("proy")
            check("%s G-4b ketik 'proy' → saran [proyekx]" % tag, wait_until(lambda: sugg() == ["proyekx"], 3), repr(sugg()))
            shot(p, "G_%s_%s_tag_suggest.png" % (label, theme))
            p.locator(POP + " .td-pop-list button", has_text="proyekx").first.click()
            check("%s G-4c klik saran → chip #proyekx, input kosong" % tag,
                  wait_until(lambda: "#proyekx" in tag_chips(p, scope), 5) and tag_input(p).input_value() == "",
                  repr(tag_chips(p, scope)))
            check("%s G-4d tag lokal == [kerja, proyekx, rapat]" % tag,
                  wait_until(lambda: local_tags(p, mid) == ["kerja", "proyekx", "rapat"], 5), repr(local_tags(p, mid)))

            # ── G-2: duplikat beda huruf, offline (Review Focus 3) ──
            push_now(p)
            before = settle_outbox(p)
            rec = local_rec(p, TG_MAIN)
            cdp = ctx.new_cdp_session(p)
            OFFLINE["on"] = True
            net_offline(cdp, True)
            p.wait_for_timeout(500)
            tag_input(p).fill("#KERJA")
            p.keyboard.press("Enter")
            p.wait_for_timeout(1500)
            check("%s G-2a '#KERJA' → tanpa chip baru, tanpa alert, input dikosongkan" % tag,
                  sorted(tag_chips(p, scope)) == ["#kerja", "#proyekx", "#rapat"] and pop_alert(p) == ""
                  and tag_input(p).input_value() == "", "chips=%r alert=%r" % (tag_chips(p, scope), pop_alert(p)))
            after = outbox_count(p)
            rec2 = local_rec(p, TG_MAIN)
            check("%s G-2b `_outbox` dan updated_at/rev lokal tetap" % tag, after == before and rec2 == rec,
                  "outbox %r→%r rec %r→%r" % (before, after, rec, rec2))
            net_offline(cdp, False)
            p.wait_for_timeout(800)
            OFFLINE["on"] = False

            # ── G-5: × lalu ubah judul → tag tidak kembali ──
            p.keyboard.press("Escape")
            check("%s G-5a Escape → popover tertutup, fokus kembali ke '+'" % tag,
                  wait_until(lambda: pops(p) == 0, 3) and p.evaluate(
                      "() => document.activeElement && document.activeElement.getAttribute('aria-label') === 'Tambah tag'"))
            p.locator(scope + ' button.td-tag-x[aria-label="Hapus tag rapat"]').first.click()
            check("%s G-5b × #rapat → chip hilang, tag lokal tanpa rapat" % tag,
                  wait_until(lambda: "#rapat" not in tag_chips(p, scope) and local_tags(p, mid) == ["kerja", "proyekx"], 5),
                  "chips=%r local=%r" % (tag_chips(p, scope), local_tags(p, mid)))
            new_title = TG_MAIN + " pekan ini"
            ti = p.locator(scope + " " + TITLE_INPUT).first
            ti.click()
            ti.press("End")
            p.keyboard.type(" pekan ini")
            p.keyboard.press("Enter")
            check("%s G-5c ubah judul → lokal: judul baru, tag [kerja, proyekx] (rapat tidak kembali)" % tag,
                  wait_until(lambda: local_task(p, mid)["title"] == new_title and local_tags(p, mid) == ["kerja", "proyekx"], 8),
                  "title=%r tags=%r" % (local_task(p, mid)["title"], local_tags(p, mid)))
            push_now(p)
            check("%s G-5d server: judul baru, tag [kerja, proyekx]" % tag,
                  wait_until(lambda: server_task(base, user, mid)["title"] == new_title
                             and [x.lower() for x in server_tags(base, user, mid)] == ["kerja", "proyekx"], 25),
                  "title=%r tags=%r" % (server_task(base, user, mid)["title"], server_tags(base, user, mid)))
            check("%s G-5e chip tetap [kerja, proyekx] setelah simpan judul" % tag,
                  wait_until(lambda: sorted(tag_chips(p, scope)) == ["#kerja", "#proyekx"], 5), repr(tag_chips(p, scope)))
            shot(p, "G_%s_%s_tag_row.png" % (label, theme))

            # ── G-6: deskripsi baru diketik lalu langsung tambah tag ──
            did = ids[TG_DESC]
            reopen(TG_DESC)
            area = p.locator(scope + " " + DESC_AREA).first
            area.click()
            area.press("End")
            p.keyboard.type(" lalu cepat")
            add_btn().click()
            tag_input(p).wait_for(timeout=3000)
            p.keyboard.type("cepat")
            p.keyboard.press("Enter")
            check("%s G-6a chip #cepat" % tag, wait_until(lambda: tag_chips(p, scope) == ["#cepat"], 5),
                  repr(tag_chips(p, scope)))
            check("%s G-6b lokal: deskripsi 'Awal lalu cepat' dan tag [cepat]" % tag,
                  wait_until(lambda: local_task(p, did)["description"] == "Awal lalu cepat"
                             and local_tags(p, did) == ["cepat"], 5),
                  "desc=%r tags=%r" % (local_task(p, did)["description"], local_tags(p, did)))
            push_now(p)
            check("%s G-6c server: deskripsi dan tag tersimpan, judul tanpa '#'" % tag,
                  wait_until(lambda: (lambda t: t["description"] == "Awal lalu cepat" and t["title"] == TG_DESC)(
                      server_task(base, user, did)) and [x.lower() for x in server_tags(base, user, did)] == ["cepat"], 25),
                  "task=%r tags=%r" % ({k: server_task(base, user, did).get(k) for k in ("title", "description")},
                                       server_tags(base, user, did)))
            p.keyboard.press("Escape")
            wait_until(lambda: pops(p) == 0, 3)

            check("%s G-7 tanpa error konsol/pageerror" % tag, not errors, "; ".join(errors[:5]))
        except Exception as e:  # langkah yang melempar = gagal
            OFFLINE["on"] = False
            fail_exc(tag, e, p)
        finally:
            ctx.close()


# ── kelompok: tabs (Task 6) ────────────────────────────────────────────────────
TS_MAIN = "Rencanakan pelatihan staf"
TS_NOTES = "Catat hasil wawancara"
TS_DESC = "Tulis ringkasan kebijakan"
TS_CHILDREN = ["Anak A", "Anak B"]
DESC_PLACEHOLDER = "Tulis deskripsi atau catatan lingkup tugas di sini…"


def seed_tabs(base, name):
    import datetime
    user = register(base, name)
    ids = {}
    for title in [TS_MAIN, TS_NOTES, TS_DESC]:
        ids[title] = api(base, user, "POST", "/api/tasks", json={
            "title": title, "priority": "P3", "gtd_status": "next", "description": ""})["id"]
    yesterday = (datetime.date.today() - datetime.timedelta(days=1)).isoformat()
    for i, child in enumerate(TS_CHILDREN):
        body = {"title": child, "priority": "P3", "gtd_status": "next", "parent_id": ids[TS_MAIN]}
        if i == 0:
            body["deadline"] = yesterday  # deadline singkat merah (terlambat)
        ids[child] = api(base, user, "POST", "/api/tasks", json=body)["id"]
    for i in range(1, 4):
        api(base, user, "POST", "/api/tasks/%d/subtasks" % ids[TS_MAIN], json={"title": "Butir %d" % i})
    api(base, user, "POST", "/api/tasks/%d/notes" % ids[TS_MAIN], json={"content": "Catatan pertama"})
    api(base, user, "POST", "/api/tasks/%d/notes" % ids[TS_NOTES], json={"content": "Hanya catatan"})
    return user, ids


def tab_labels(page, scope):
    return [x.strip() for x in page.locator(scope + ' [role="tablist"] [role="tab"]').all_inner_texts()]


def active_tab(page, scope):
    t = page.locator(scope + ' [role="tab"][aria-selected="true"]')
    return t.first.inner_text().strip() if t.count() else None


def tab_btn(page, scope, name):
    return page.locator(scope + ' [role="tab"]', has_text=re.compile("^" + name)).first


def visible_panels(page, scope):
    return page.locator(scope + ' [role="tabpanel"]:not([hidden])').count()


def sub_row(page, scope, title):
    return page.locator(scope + " .td-sub-row", has=page.locator(".td-sub-title", has_text=re.compile("^%s$" % re.escape(title)))).first


def check_row(page, scope, title):
    return page.locator(scope + " .td-check-row", has=page.locator(".td-check-title", has_text=re.compile("^%s$" % re.escape(title)))).first


def run_tabs(browser, base):
    combos = [("panel", 1280, 860, "light", "panel"), ("375", 375, 812, "dark", "modal")]
    for label, w, h, theme, kind in combos:
        tag = "B[%s %s]" % (label, theme)
        mobile = w < 500
        scope = MODAL if kind == "modal" else PANEL
        user, ids = seed_tabs(base, "tb%s%s" % (label[:3], theme[0]))
        errors = []
        ctx, p = open_app(browser, base, user, w, h, theme, errors, live="1" if kind == "panel" else "0")

        def reopen(title):
            if kind == "modal" and modal_count(p):
                close_btn(p).click()
                wait_closed(p)
            return scope_open(p, scope, title)

        try:
            go_all_tasks(p, mobile)
            # Data server (anak, checklist, catatan) turun lewat sync ke IndexedDB.
            wait_until(lambda: p.locator(".task-row", has_text=TS_MAIN).count() > 0, 15)
            p.wait_for_timeout(1500)

            # ── B-1: label, jumlah, tab awal ──
            want_labels = ["Subtask (2)", "Checklist (3)", "Catatan (1)", "Lampiran"]
            reopen(TS_MAIN)
            check("%s B-1a label tab %r" % (tag, want_labels),
                  wait_until(lambda: tab_labels(p, scope) == want_labels, 10), repr(tab_labels(p, scope)))
            check("%s B-1b tab aktif 'Subtask', satu panel terlihat, 2 baris anak" % tag,
                  active_tab(p, scope) == "Subtask (2)" and visible_panels(p, scope) == 1
                  and p.locator(scope + " .td-sub-row").count() == 2,
                  "aktif=%r panel=%d" % (active_tab(p, scope), visible_panels(p, scope)))
            check("%s B-1c deadline singkat anak terlambat merah; tanpa warna per prioritas" % tag,
                  sub_row(p, scope, "Anak A").locator(".td-sub-date.is-danger").count() == 1
                  and re.fullmatch(r"\d{1,2} (%s)" % MONTHS,
                                   sub_row(p, scope, "Anak A").locator(".td-sub-date").inner_text().strip()) is not None,
                  repr(sub_row(p, scope, "Anak A").inner_text()))
            p.locator(scope + ' [role="tablist"]').first.scroll_into_view_if_needed()
            shot(p, "B_%s_%s_tabs.png" % (label, theme))
            reopen(TS_NOTES)
            check("%s B-1d task hanya bercatatan → tab aktif 'Catatan'" % tag,
                  wait_until(lambda: active_tab(p, scope) == "Catatan (1)", 10), repr(active_tab(p, scope)))
            check("%s B-1e panel Catatan tanpa judul bagian lama" % tag,
                  "📓" not in p.locator(scope + ' [role="tabpanel"]:not([hidden])').first.inner_text())

            # ── B-2: subtask baru, centang, buka ──
            reopen(TS_MAIN)
            wait_until(lambda: tab_labels(p, scope) == want_labels, 10)
            add = p.locator(scope + ' input[aria-label="Buat subtask baru"]').first
            check("%s B-2a placeholder '+ Buat subtask baru…'" % tag, add.get_attribute("placeholder") == "+ Buat subtask baru…")
            add.click()
            p.keyboard.type("Anak C")
            p.keyboard.press("Enter")
            row = sub_row(p, scope, "Anak C")
            check("%s B-2b baris '#<id> Anak C' chip Inbox, label 'Subtask (3)'" % tag,
                  wait_until(lambda: row.count() == 1 and tab_labels(p, scope)[0] == "Subtask (3)", 8)
                  and re.fullmatch(r"#\S+\s*Anak C", row.locator(".td-sub-main").inner_text().strip()) is not None
                  and "Inbox" in row.locator(".badge").inner_text(),
                  "row=%r labels=%r" % (row.inner_text() if row.count() else None, tab_labels(p, scope)))
            check("%s B-2c input kosong lagi" % tag, add.input_value() == "")
            shot(p, "B_%s_%s_subtask_new.png" % (label, theme))
            row.locator('[role="checkbox"]').click()
            check("%s B-2d centang → dicoret, aria-checked=true" % tag,
                  wait_until(lambda: "is-done" in (row.get_attribute("class") or "")
                             and row.locator('[role="checkbox"]').get_attribute("aria-checked") == "true"
                             and "line-through" in (row.locator(".td-sub-title").get_attribute("style") or ""), 8))
            push_now(p)
            check("%s B-2e server: Anak C done" % tag,
                  wait_until(lambda: (server_row(base, user, "Anak C") or {}).get("gtd_status") == "done", 25),
                  repr(server_row(base, user, "Anak C")))
            row.locator('[role="checkbox"]').click()
            check("%s B-2f centang lagi → tidak dicoret" % tag,
                  wait_until(lambda: row.locator('[role="checkbox"]').get_attribute("aria-checked") == "false", 8))
            push_now(p)
            check("%s B-2g server: Anak C next" % tag,
                  wait_until(lambda: (server_row(base, user, "Anak C") or {}).get("gtd_status") == "next", 25),
                  repr(server_row(base, user, "Anak C")))
            row.locator('button[aria-label="Buka subtask"]').click()
            check("%s B-2h tombol buka → %s menampilkan Anak C" % (tag, kind),
                  wait_until(lambda: title_value(p, scope) == "Anak C", 8), repr(title_value(p, scope)))

            # ── B-3: checklist ──
            reopen(TS_MAIN)
            wait_until(lambda: tab_labels(p, scope)[:2] == ["Subtask (3)", "Checklist (3)"], 10)
            tab_btn(p, scope, "Checklist").click()
            check("%s B-3a klik tab Checklist → aktif, bar progress" % tag,
                  active_tab(p, scope) == "Checklist (3)" and p.locator(scope + " .td-check-bar").count() == 1)
            p.locator(scope + " button.td-add", has_text="+ Tambah butir checklist baru").first.click()
            inp = p.locator(scope + ' input[aria-label="Butir checklist baru"]')
            inp.first.wait_for(timeout=3000)
            p.keyboard.type("Butir 4")
            p.keyboard.press("Enter")
            wait_until(lambda: p.locator(scope + " .td-check-row").count() == 4, 5)
            p.keyboard.type("Butir 5")
            p.keyboard.press("Enter")
            check("%s B-3b 'Butir 4' lalu 'Butir 5' tanpa membuka ulang → 5 baris, input tetap terbuka" % tag,
                  wait_until(lambda: p.locator(scope + " .td-check-row").count() == 5, 5)
                  and inp.count() == 1 and inp.first.input_value() == "",
                  repr(p.locator(scope + " .td-check-title").all_inner_texts()))
            p.keyboard.press("Escape")
            check("%s B-3c Escape → input tertutup, label 'Checklist (5)'" % tag,
                  wait_until(lambda: inp.count() == 0, 3) and tab_labels(p, scope)[1] == "Checklist (5)",
                  repr(tab_labels(p, scope)))
            shot(p, "B_%s_%s_checklist.png" % (label, theme))
            cb = check_row(p, scope, "Butir 1").locator('[role="checkbox"]')
            cb.click()
            mid = ids[TS_MAIN]
            check("%s B-3d centang Butir 1 → aria-checked=true dan lokal selesai" % tag,
                  wait_until(lambda: cb.get_attribute("aria-checked") == "true" and p.evaluate(
                      "async (id) => (await api.get('/api/tasks/' + id + '/subtasks')).some(s => s.title === 'Butir 1' && s.is_done)",
                      mid), 5))
            r5 = check_row(p, scope, "Butir 5")
            r5.hover()
            r5.locator('button[aria-label="Hapus butir"]').click()
            check("%s B-3e × Butir 5 → 'Checklist (4)'" % tag,
                  wait_until(lambda: tab_labels(p, scope)[1] == "Checklist (4)"
                             and p.locator(scope + " .td-check-row").count() == 4, 5), repr(tab_labels(p, scope)))
            if mobile:
                check("%s B-3f perangkat sentuh: × terlihat tanpa hover" % tag,
                      p.evaluate("""(sel) => { const b = document.querySelector(sel + ' .td-check-del');
                          return !!b && getComputedStyle(b).opacity === '1'; }""", scope))

            # ── B-4: catatan baru ──
            tab_btn(p, scope, "Catatan").click()
            note = p.locator(scope + ' [role="tabpanel"]:not([hidden]) input[placeholder="Tulis catatan..."]').first
            note.click()
            p.keyboard.type("Catatan kedua")
            p.keyboard.press("Enter")
            check("%s B-4 tambah catatan → 'Catatan (2)'" % tag,
                  wait_until(lambda: tab_labels(p, scope)[2] == "Catatan (2)", 8), repr(tab_labels(p, scope)))

            # ── B-6: tab dengan panah ──
            tab_btn(p, scope, "Subtask").click()
            tab_btn(p, scope, "Subtask").focus()
            p.keyboard.press("ArrowRight")
            check("%s B-6a ArrowRight dari Subtask → Checklist aria-selected, fokus pindah" % tag,
                  wait_until(lambda: tab_btn(p, scope, "Checklist").get_attribute("aria-selected") == "true", 3)
                  and p.evaluate("() => (document.activeElement && document.activeElement.textContent || '').startsWith('Checklist')"))
            p.keyboard.press("ArrowLeft")
            check("%s B-6b ArrowLeft → Subtask" % tag,
                  wait_until(lambda: tab_btn(p, scope, "Subtask").get_attribute("aria-selected") == "true", 3))

            # ── B-5: deskripsi tumbuh lalu bergulir ──
            reopen(TS_DESC)
            area = p.locator(scope + " " + DESC_AREA).first
            check("%s B-5a placeholder persis" % tag, area.get_attribute("placeholder") == DESC_PLACEHOLDER,
                  repr(area.get_attribute("placeholder")))
            dims = lambda: p.evaluate("""(sel) => { const t = document.querySelector(sel); const cs = getComputedStyle(t);
                return {h: t.getBoundingClientRect().height, sh: t.scrollHeight, ch: t.clientHeight,
                        lh: parseFloat(cs.lineHeight), pad: parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom),
                        bord: parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth), ov: cs.overflowY}; }""",
                                      scope + " " + DESC_AREA)  # noqa: E731
            d0 = dims()
            area.fill("\n".join("Baris %d" % i for i in range(1, 6)))
            p.wait_for_timeout(200)
            d5 = dims()
            check("%s B-5b 5 baris → tinggi bertambah, tanpa gulir" % tag,
                  d5["h"] > d0["h"] + d0["lh"] and d5["sh"] <= d5["ch"] + 1, "d0=%r d5=%r" % (d0, d5))
            area.fill("\n".join("Baris %d" % i for i in range(1, 31)))
            p.wait_for_timeout(200)
            d30 = dims()
            cap = 12 * d30["lh"] + d30["pad"] + d30["bord"]
            check("%s B-5c 30 baris → tinggi berhenti ≤ 12 baris, textarea bisa digulir" % tag,
                  d30["h"] <= cap + 1 and d30["h"] >= cap - 1 and d30["sh"] > d30["ch"] + 50 and d30["ov"] == "auto",
                  "d30=%r cap=%.1f" % (d30, cap))
            shot(p, "B_%s_%s_desc.png" % (label, theme))
            area.fill("")
            p.locator(scope + " " + TITLE_INPUT).first.click()

            check("%s B-7 tanpa error konsol/pageerror" % tag, not errors, "; ".join(errors[:5]))
        except Exception as e:  # langkah yang melempar = gagal
            OFFLINE["on"] = False
            fail_exc(tag, e, p)
        finally:
            ctx.close()


# Urutan kelompok; task berikutnya menambah (nama, fungsi(browser, base)).
GROUPS = [
    ("autosave", run_autosave),
    ("topbar", run_topbar),
    ("props", run_props),
    ("tags", run_tags),
    ("tabs", run_tabs),
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
    for k in KNOWN_ISSUES:
        print("pra-ada (di luar cakupan):", k)
    failed = [r for r in results if not r[1]]
    print("\n%d langkah, %d gagal" % (len(results), len(failed)))
    for r in failed:
        print("  GAGAL:", r[0], "—", r[2])
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
