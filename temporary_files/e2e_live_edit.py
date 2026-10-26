"""E2E "Live Edit" (PR B): tombol Live Edit + panel detail task di samping daftar, autosave. Tidak dijalankan CI.
Disesuaikan dengan redesain detail task 2026-10-26: properti diubah lewat popover kisi properti (tanpa select),
Proyek/Tahap lewat NamePicker ("Cari atau buat baru…"), Selesai/Buka lagi dan ⋯ "Aksi lain" → Hapus di bar atas
`.td-top` (bar aksi bawah sudah tidak ada).

Spec §9.4 (docs/superpowers/specs/2026-10-26-live-edit-design.md) plus kasus dari review tiap task. Browser 1280 px
kecuali dicatat lain. Server lokal dijalankan sendiri (uvicorn webapp:app, DB sementara); host luar diblokir;
`tf_whatsnew_seen` diisi agar modal "Apa yang baru" tidak menutupi UI. Screenshot: temporary_files/e2e_live_edit/
(atau $E2E_SHOTS_DIR). Keluar non-zero bila ada langkah gagal.

  A  muat segar dengan Live Edit sudah nyala: task pertama langsung terbuka; daftar kosong lalu task pertama tiba
     sesudah panel tampil → panel memilihnya
  D  membuka 3 task tanpa mengubah apa pun, dengan halaman OFFLINE (CDP) supaya op tidak terkuras oleh push 1,5 dtk:
     jumlah op IndexedDB `_outbox` tidak berubah DAN `updated_at`/`rev`/`dirty` rekaman lokal tiap task tidak berubah;
     sepanjang B (online) tidak ada request tulis ke /api/tasks*
  B  sidebar lebar dan sidebar ikon × Normal / Compact / Kanban: task pertama terbuka, klik mengganti panel + sorotan,
     lebar panel = clamp(round(w × 0.5), 420, 680)
  C  Prioritas (popover) langsung, deskripsi setelah diam, judul saat blur → reload → bertahan; tag task tetap saat judul diubah;
     `#tagbaru` di judul menjadi tag; tag dihapus di luar panel tidak dipulihkan oleh simpan judul berikutnya (R21)
  K  popover Proyek dibuka lalu diam 2 dtk → project lama tidak hilang; nama baru yang diketik TIDAK tersimpan karena
     diam, hanya saat Enter (R19); nama diketik dua bagian dengan jeda 2 dtk → server hanya punya nama lengkap
     (project dan context/tahap, tanpa nama setengah jadi); setengah diketik lalu klik di luar → tidak tersimpan;
     memilih opsi yang sudah ada tersimpan langsung
  E  offline (CDP) → edit → outbox bertambah, server belum berubah → online → tersinkron
  F  Selesai → task tetap di panel dan hilang dari Next, tombol menjadi "Buka lagi" → muncul lagi; ⋯ → Hapus →
     "Pilih task di daftar";
     task terpilih dihapus di tempat lain → hanya teks "sudah dihapus"; drag kartu Kanban → pilihan tidak berubah
  H  mode gelap (warna panel dan sorotan lewat token)
  G  375 px dan 900 px dengan sidebar lebar → tidak ada tombol/panel, klik membuka modal
  I  task tinggi (deskripsi panjang + checklist): bar atas `.td-top` (Fokus, Selesai, ⋯) terlihat pada scrollTop 0,
     tetap di viewport saat halaman digulir, dan menempel di puncak aside (top ≈ aside.top) saat isi panel digulir;
     tanpa kedip panel di sekitar ambang 760 px (scrollbar klasik sungguhan, bukan `--hide-scrollbars`)
  Z  tanpa error konsol/pageerror. Dua pengecualian, keduanya dicetak jumlahnya di akhir:
     (1) pra-ada, juga dengan Live Edit mati: setelah hapus + sync, syncpull mencatat 404 untuk `GET /api/tasks/:id`
         (konfirmasi "task benar-benar hilang"). Pengecualian konsol hanya berdasarkan path; karena itu akhir skrip
         menegaskan lewat `BAD_RESPONSES` bahwa SETIAP respons >= 400 pada `/api/tasks/<id>` adalah `GET` 404;
     (2) selama emulasi offline CDP (skenario D dan E) fetch jaringan yang tidak dilayani router lokal (mis.
         `fetchAll` → `/api/collaborators`, sub-daftar task `/api/tasks/<id>/subtasks`) gagal
         `net::ERR_INTERNET_DISCONNECTED`; hanya untuk URL `/api/...` di jendela offline itu (R17).
  Catatan: memilih menu di sidebar selalu melipat sidebar kembali ke bilah ikon (index.html: efek `[page]`); sidebar
  lebar hanya didapat dengan menekan › sesudah berpindah halaman.

    python3 temporary_files/e2e_live_edit.py
"""
import os
import re
import socket
import subprocess
import sys
import tempfile
import time
from urllib.parse import urlsplit

import requests
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
with open(os.path.join(ROOT, "static", "sw.js"), encoding="utf-8") as _f:
    # Versi SW saat ini: ditulis ke tf_whatsnew_seen agar modal "Apa yang baru" tidak menutupi UI.
    SW_VERSION = re.search(r'^const CACHE = "([^"]+)";', _f.read(), re.M).group(1)
SHOTS = os.environ.get("E2E_SHOTS_DIR") or os.path.join(ROOT, "temporary_files", "e2e_live_edit")
PW = "rahasia123"
SECRET = "e2e-live-edit-secret"
TOURS = ['dashboard', 'tasks', 'today', 'calendar', 'kanban', 'notes', 'mindmap', 'chat', 'habits', 'habit',
         'settings', 'draw', 'goals', 'review', 'focus', 'workspace', 'slist', 'next', 'inbox', 'all', 'alltasks']

GONE_TEXT = "Task ini sudah dihapus atau tidak bisa diakses lagi."
PICK_TEXT = "Pilih task di daftar"
EMPTY_TEXT = "Tidak ada task"
PANEL = "aside.tl-live-panel"

T_ALPHA = "Alpha rapat mingguan"      # P1, @kantor, Proyek Satu, tag #kerja (lokal), punya task anak
T_BRAVO = "Bravo beli kertas"          # P2, @toko, Proyek Satu   → Selesai
T_CHARLIE = "Charlie telepon vendor"   # P3, @kantor              → drag Kanban
T_DELTA = "Delta rapikan berkas"       # P4, @rumah, Proyek Dua   → Hapus
T_FOX = "Foxtrot cadangan"             # P3, @rumah               → edit offline
T_ECHO = "Echo anak alpha"             # task anak Alpha
T_ALPHA_NEW = "Alpha rapat mingguan revisi"  # judul Alpha setelah skenario C
SEED = [  # (judul di server, judul tampil, prioritas, context, project)
    (T_ALPHA + " #kerja", T_ALPHA, "P1", "@kantor", "Proyek Satu"),
    (T_BRAVO, T_BRAVO, "P2", "@toko", "Proyek Satu"),
    (T_CHARLIE, T_CHARLIE, "P3", "@kantor", ""),
    (T_DELTA, T_DELTA, "P4", "@rumah", "Proyek Dua"),
    (T_FOX, T_FOX, "P3", "@rumah", ""),
]
T_TALL = "Tugas dengan deskripsi panjang"

results = []  # (langkah, ok, keterangan)
known_404 = []  # 404 `GET /api/tasks/:id` pra-ada (syncpull confirm-gone) yang dikecualikan dari cek konsol
OFFLINE = {"on": False}  # True selama emulasi offline CDP; error jaringan di jendela ini dicatat terpisah
offline_noise = []  # `net::ERR_INTERNET_DISCONNECTED` milik fetch jaringan (mis. fetchAll) selama emulasi offline
BAD_RESPONSES = []  # semua respons >= 400 dari server lokal (diagnostik)


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


def open_app(browser, base, user, w, h, theme, errors, live="1", scrollbars=False):
    """Konteks baru; error konsol/pageerror milik aplikasi (host lokal) dikumpulkan ke `errors`.
    `live` = nilai awal tf_liveedit ("1" nyala, "0" mati, None tidak diisi)."""
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
            offline_noise.append(path)  # fetch API yang memang diputus oleh emulasi (R17: hanya /api/), bukan bug aplikasi
            return
        if (msg.text.startswith("Failed to load resource") and "404" in msg.text
                and re.fullmatch(r"/api/tasks/[^/]+", path)):
            known_404.append(path)  # pra-ada: syncpull confirm-gone setelah hapus + sync (juga dengan Live Edit mati)
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


def go_next(page, mobile=False):
    """Buka "Next Actions" lewat sidebar lebar (HP: menu ☰). Menunggu baris task pertama."""
    if mobile:
        page.locator(".mobile-topbar-main button", has_text="☰").first.click()
        page.wait_for_timeout(400)
    else:
        expand_sidebar(page)
    page.locator(".sidebar-link", has_text="Next Actions").first.click()
    page.locator(".task-row").first.wait_for(timeout=15000)
    page.wait_for_timeout(300)


def set_view(page, mode):
    """mode: normal | compact | kanban (Kanban butuh Group by bukan None; dipilih di pemanggil)."""
    label = {"normal": "Normal", "compact": "Compact", "kanban": "Kanban"}[mode]
    page.locator("button[aria-label='%s']" % label).click()
    page.wait_for_timeout(300)


def group_by(page, value):
    page.locator("select[aria-label='Group by']").select_option(value)
    page.wait_for_timeout(300)


# ── panel ───────────────────────────────────────────────────────────────────────
def live_btn(page):
    return page.locator("button[aria-label='Live Edit']")


def panel_title(page):
    inp = page.locator(PANEL + " input[aria-label='Judul task']")
    return inp.first.input_value() if inp.count() else None


def panel_text(page):
    loc = page.locator(PANEL)
    return loc.first.inner_text().strip() if loc.count() else None


def wait_title(page, title, timeout=8):
    return wait_until(lambda: panel_title(page) == title, timeout)


def selected_text(page, sel):
    loc = page.locator(sel + "[aria-current='true']")
    return loc.first.inner_text() if loc.count() == 1 else None


POP = ".td-pop"


def prop_btn(page, label):
    """Tombol nilai properti di kisi detail panel (aria-label "<Label>: <nilai|kosong>")."""
    return page.locator('%s button.td-prop-val[aria-label^="%s: "]' % (PANEL, label)).first


def prop_text(page, label):
    return prop_btn(page, label).inner_text().strip()


def pops(page):
    return page.locator(POP).count()


def set_priority(page, pri):
    """Popover Prioritas → pilih `pri` ("P1".."P4"); tersimpan langsung (pilihan popover)."""
    prop_btn(page, "Prioritas").click()
    page.locator(POP).first.wait_for(timeout=3000)
    page.locator(POP + " button", has_text=re.compile(r"^\s*%s\b" % pri)).first.click()
    wait_until(lambda: pops(page) == 0, 3)


def open_name_picker(page, label):
    """Popover Proyek/Tahap (NamePicker): input cari terfokus. Mengembalikan input."""
    prop_btn(page, label).click()
    inp = page.locator(POP + " input[placeholder='Cari atau buat baru…']").first
    inp.wait_for(state="visible", timeout=3000)
    return inp


def pop_option(page, text):
    return page.locator(POP + " button", has=page.locator(".td-pop-label", has_text=re.compile(
        "^" + re.escape(text) + "$"))).first


def desc_area(page):
    return page.locator(PANEL + " textarea[aria-label='Deskripsi']").first


def top_btn(page, text):
    """Tombol teks di bar atas panel (Selesai / Buka lagi)."""
    return page.locator(PANEL + " .td-top button", has_text=text).first


def menu_action(page, text):
    """⋯ "Aksi lain" → butir menu `text` (Pindah ke Workspace / Hapus)."""
    page.locator(PANEL + " button[aria-label='Aksi lain']").first.click()
    page.locator(POP + " [role='menuitem']", has_text=text).first.click()


def panel_tags(page):
    # Sekali baca (all_inner_texts): count() lalu nth(i).inner_text() menunggu hingga 30 dtk bila chip hilang di antaranya.
    spans = page.locator(PANEL + " span[title='Klik untuk lihat semua task dengan tag ini']")
    return sorted(re.sub(r"[#×\s]", "", t) for t in spans.all_inner_texts())


def row(page, title):
    return page.locator(".task-row", has_text=title).first


def click_row(page, title):
    row(page, title).click()
    return wait_title(page, title)


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


def seed_local_tag(page, title, tag):
    """Tag task hidup di IndexedDB (GET /api/tasks/:id/tags dilayani router lokal; tag dari server tidak turun):
    pasang lewat tagrepo untuk task bertajuk `title`."""
    return page.evaluate("""async ([title, tag]) => {
        const db = await TF.db.openDB();
        const all = await new Promise((res, rej) => {
            const q = db.transaction('tasks', 'readonly').objectStore('tasks').getAll();
            q.onsuccess = () => res(q.result || []); q.onerror = () => rej(q.error);
        });
        let n = 0;
        for (const t of all) if (!t.deleted && t.title === title) { await TF.tagrepo.setEntityTags('task', t.cid, [tag]); n++; }
        return n;
    }""", [title, tag])


def local_tags(page, task_id):
    return page.evaluate("""async (id) => (await api.get('/api/tasks/' + id + '/tags')).map(t => t.name).sort()""", task_id)


def local_rec(page, title):
    """Rekaman mentah task di IndexedDB (bukan baris API): `updated_at`, `rev`, `dirty`. Berubah pada SETIAP simpan lokal,
    jadi tidak berubah = tidak ada simpan. None bila rekaman tidak ada."""
    return page.evaluate("""async (title) => {
        const db = await TF.db.openDB();
        const all = await new Promise((res, rej) => {
            const q = db.transaction('tasks', 'readonly').objectStore('tasks').getAll();
            q.onsuccess = () => res(q.result || []); q.onerror = () => rej(q.error);
        });
        const t = all.find(x => !x.deleted && x.title === title);
        return t ? {updated_at: t.updated_at, rev: t.rev == null ? null : t.rev, dirty: t.dirty == null ? null : t.dirty} : null;
    }""", title)


def wait_child_lists(page, task_id, act, timeout=10):
    """Jalankan `act()` lalu tunggu sampai GET notes/attachments/subtasks task `task_id` mendapat respons. Body panel
    memanggil ketiganya saat dipasang, lewat jaringan karena id numerik (K6). Dipakai sebelum task itu dihapus di
    server: tanpa menunggu, GET yang tiba sesudah DELETE menjadi 404 di konsol (race lama F6e → Z[3]).
    Mengembalikan path yang belum mendapat respons (kosong = semua sudah)."""
    want = {"/api/tasks/%d/%s" % (task_id, k) for k in ("notes", "attachments", "subtasks")}
    got = set()

    def on_resp(r):
        path = urlsplit(r.url).path
        if path in want:
            got.add(path)

    page.on("response", on_resp)
    try:
        act()
        end = time.time() + timeout
        while not want <= got and time.time() < end:
            page.wait_for_timeout(100)  # API sync Playwright hanya memompa event saat menunggu di Playwright
        return want - got
    finally:
        page.remove_listener("response", on_resp)


def net_offline(cdp, offline):
    cdp.send("Network.emulateNetworkConditions", {"offline": offline, "latency": 0, "downloadThroughput": -1,
                                                   "uploadThroughput": -1})


def local_task(page, task_id):
    """Task seperti dilihat aplikasi (router lokal / IndexedDB), bukan server: bukti simpan lokal sudah terjadi."""
    return page.evaluate("async (id) => await api.get('/api/tasks/' + id)", task_id)


def shot(page, name):
    path = os.path.join(SHOTS, name)
    page.wait_for_timeout(300)
    page.screenshot(path=path, full_page=False)
    print("  screenshot", name, flush=True)


def panel_geom(page):
    """Geometri aside panel dan bar atas `.td-top` (Fokus, Selesai, ⋯) di dalamnya."""
    return page.evaluate("""() => {
        const a = document.querySelector('aside.tl-live-panel');
        if (!a) return null;
        const bar = a.querySelector('.td-top');
        const r = a.getBoundingClientRect(), b = bar && bar.getBoundingClientRect();
        return {scrollY: Math.round(scrollY), vh: innerHeight, asideTop: Math.round(r.top), asideBottom: Math.round(r.bottom),
                asideInnerTop: Math.round(r.top + a.clientTop), asideScroll: Math.round(a.scrollTop),
                barTop: b ? Math.round(b.top) : null, barBottom: b ? Math.round(b.bottom) : null,
                scrollH: a.scrollHeight, clientH: a.clientHeight, docH: document.documentElement.scrollHeight,
                width: Math.round(r.width)};
    }""")


def bar_in_viewport(g):
    """Bar atas terlihat: di dalam viewport, di dalam aside, dan aside seluruhnya di dalam viewport."""
    return bool(g) and g["barTop"] is not None and g["barTop"] >= 0 and g["barBottom"] <= g["vh"] \
        and g["barTop"] >= g["asideTop"] - 1 and g["barBottom"] <= g["asideBottom"] and g["asideBottom"] <= g["vh"]


def bar_stuck(g, tol=2):
    """Bar atas menempel di puncak aside (top ≈ aside.top) walau isi aside sudah digulir."""
    return bar_in_viewport(g) and abs(g["barTop"] - g["asideInnerTop"]) <= tol


def root_width(page):
    return page.evaluate("() => document.querySelector('.tl-live').parentElement.clientWidth")


def expected_panel_width(root_w):
    return min(680, max(420, round(root_w * 0.5)))


def server_row(base, user, title):
    for t in api(base, user, "GET", "/api/tasks?include_done=true"):
        if t["title"] == title:
            return t
    return None


# ── skenario ───────────────────────────────────────────────────────────────────
def seed_user(base, name):
    user = register(base, name)
    ids = {}
    for server_title, title, pri, ctx, proj in SEED:
        t = api(base, user, "POST", "/api/tasks", json={
            "title": server_title, "priority": pri, "context": ctx, "project": proj, "gtd_status": "next",
            "description": "Catatan untuk " + title})
        ids[title] = t["id"]
    child = api(base, user, "POST", "/api/tasks", json={"title": T_ECHO, "parent_id": ids[T_ALPHA], "priority": "P2"})
    ids[T_ECHO] = child["id"]
    return user, ids


def scen_fresh_and_views(browser, base, A, ids):
    """A (muat segar, Live Edit nyala), D (outbox), B (3 view × sidebar lebar/ikon)."""
    errors = []
    ctx, p = open_app(browser, base, A, 1280, 860, "light", errors, live="1")
    writes = []  # request tulis (bukan GET) ke /api/tasks* sejak penanda direset: simpan lokal yang terkuras ke server
    p.on("request", lambda r: writes.append((r.method, r.url.replace(base, "").split("?")[0]))
         if r.method != "GET" and "/api/tasks" in r.url else None)
    try:
        # ── A. muat segar dengan tf_liveedit=1: task pertama langsung terbuka ──
        go_next(p)
        first_row_text = p.locator(".task-row").first.inner_text()
        first_title = next(t for _, t, *_ in SEED if t in first_row_text)
        check("A1 muat segar (Live Edit sudah nyala): panel menampilkan task pertama daftar",
              wait_title(p, first_title, 10), repr(panel_title(p)) + " baris pertama=" + first_title)
        btn = live_btn(p)
        check("A2 tombol Live Edit tampil, aria-pressed=true, title 'Sembunyikan panel detail'",
              btn.is_visible() and btn.get_attribute("aria-pressed") == "true"
              and btn.get_attribute("title") == "Sembunyikan panel detail", btn.get_attribute("title"))
        check("A3 baris pertama ber-aria-current dan .is-selected, tanpa modal",
              p.locator(".task-row.is-selected").count() == 1 and first_title in (selected_text(p, ".task-row") or "")
              and p.locator(".modal-overlay").count() == 0)
        seed_local_tag(p, T_ALPHA, "kerja")
        check("A4 TF.db memakai basis data 'taskflow-offline' (sumber hitungan _outbox)",
              p.evaluate("() => TF.db.DB_NAME") == "taskflow-offline")

        # ── D. membuka 3 task tanpa edit tidak menyimpan apa pun ──
        # Online, aplikasi mendorong op `_outbox` ke server 1,5 dtk setelah mutasi (schedulePush) sehingga op "simpan saat
        # dibuka" terkuras dan jumlahnya tampak tetap. Karena itu D dijalankan OFFLINE (op tidak bisa terkuras) dan
        # ditegaskan juga rekaman lokal tiap task (`updated_at`/`rev`/`dirty` berubah pada setiap simpan lokal).
        before = settle_outbox(p)
        titles = [t for _, t, *_ in SEED]
        recs_before = {t: local_rec(p, t) for t in titles[:3]}
        check("D0 prasyarat: rekaman lokal 3 task ada dan `_outbox` kosong sebelum membuka",
              all(recs_before.values()) and before == 0, "outbox=%r recs=%r" % (before, recs_before))
        cdp = ctx.new_cdp_session(p)
        OFFLINE["on"] = True
        net_offline(cdp, True)
        p.wait_for_timeout(500)
        check("D0b halaman offline (navigator.onLine=false) selama D", p.evaluate("() => navigator.onLine") is False)
        for t in titles[:3]:
            click_row(p, t)
            p.wait_for_timeout(500)
        p.wait_for_timeout(2500)  # lewat TEXT_IDLE_MS (1,5 dtk): simpan diam-diam akan terlihat di sini
        after = outbox_count(p)
        recs_after = {t: local_rec(p, t) for t in titles[:3]}
        check("D1 buka 3 task tanpa mengubah apa pun (OFFLINE) → `_outbox` tetap dan updated_at/rev/dirty tiap task tetap",
              before == after and recs_before == recs_after,
              "outbox %r→%r; rekaman sama=%r" % (before, after, recs_before == recs_after))
        check("D2 tidak ada indikator 'Menyimpan…'/'Tersimpan' sesudah hanya membuka",
              p.locator(PANEL + " .tl-save-ind").first.inner_text().strip() == "")
        net_offline(cdp, False)
        p.wait_for_timeout(1500)
        OFFLINE["on"] = False
        before = settle_outbox(p)  # sync saat online lagi selesai; dasar untuk B (online)
        recs_b0 = {t: local_rec(p, t) for t in titles[:4]}
        del writes[:]

        # ── B. Normal / Compact / Kanban × sidebar lebar dan ikon ──
        # Memilih menu melipat sidebar ke bilah ikon, jadi putaran pertama = sidebar ikon; "›" membuka sidebar lebar.
        root_w = {}
        for side in ("ikon", "lebar"):
            if side == "lebar":
                expand_sidebar(p)
                p.wait_for_timeout(500)
            tag = "B[%s]" % side
            click_row(p, T_ALPHA)
            rw = root_width(p)
            root_w[side] = rw
            g = panel_geom(p)
            check("%s panel lebar = clamp(round(w×0.5),420,680)" % tag, abs(g["width"] - expected_panel_width(rw)) <= 1,
                  "root=%d panel=%d" % (rw, g["width"]))
            pb = p.locator(PANEL).bounding_box()
            lb = p.locator(".tl-live-list").bounding_box()
            check("%s panel di kanan daftar" % tag, pb["x"] >= lb["x"] + lb["width"] - 1)
            click_row(p, T_BRAVO)
            check("%s Normal: klik task lain → panel + sorotan pindah, tanpa modal" % tag,
                  T_BRAVO in (selected_text(p, ".task-row") or "") and p.locator(".modal-overlay").count() == 0,
                  repr(selected_text(p, ".task-row")))
            shot(p, "B_%s_normal.png" % side)

            set_view(p, "compact")
            p.locator(".compact-row").first.wait_for(timeout=5000)
            check("%s Compact: panel + pilihan tetap" % tag,
                  panel_title(p) == T_BRAVO and T_BRAVO in (selected_text(p, ".compact-row") or ""),
                  repr(panel_title(p)))
            p.locator(".compact-row", has_text=T_CHARLIE).first.click()
            check("%s Compact: klik baris → panel berpindah + sorotan pindah, tanpa modal" % tag,
                  wait_title(p, T_CHARLIE) and T_CHARLIE in (selected_text(p, ".compact-row") or "")
                  and p.locator(".modal-overlay").count() == 0, repr(panel_title(p)))
            shot(p, "B_%s_compact.png" % side)

            group_by(p, "priority")
            set_view(p, "kanban")
            p.locator("[data-kanban-task]").first.wait_for(timeout=5000)
            check("%s Kanban: panel + pilihan tetap, kartu terpilih ber-aria-current" % tag,
                  panel_title(p) == T_CHARLIE and T_CHARLIE in (selected_text(p, "[data-kanban-task]") or ""),
                  repr(panel_title(p)))
            p.locator("[data-kanban-task]", has_text=T_DELTA).first.click()
            check("%s Kanban: klik kartu → panel berpindah + sorotan pindah, tanpa modal" % tag,
                  wait_title(p, T_DELTA) and T_DELTA in (selected_text(p, "[data-kanban-task]") or "")
                  and p.locator(".modal-overlay").count() == 0, repr(panel_title(p)))
            shot(p, "B_%s_kanban.png" % side)

            # kembali ke Normal tanpa grup untuk putaran berikut dan skenario sesudahnya
            group_by(p, "none")
            p.locator(".task-row").first.wait_for(timeout=5000)
            check("%s Group by None (Kanban → Normal otomatis): panel + pilihan tetap" % tag,
                  panel_title(p) == T_DELTA, repr(panel_title(p)))
            set_view(p, "normal")

        check("B-lebar sidebar lebar terbuka (tombol 'Perkecil menu' tampak) dan area konten lebih sempit dari bilah ikon",
              p.locator("button[aria-label='Perkecil menu']").first.is_visible()
              and root_w.get("lebar") is not None and root_w["lebar"] < root_w["ikon"], repr(root_w))
        after_b = settle_outbox(p)  # online: op yang tersisa akan terkuras; tulis ke server tertangkap di `writes`
        recs_b1 = {t: local_rec(p, t) for t in titles[:4]}
        check("B-end berpindah view/task (online) tidak menyimpan apa pun: tanpa request tulis ke /api/tasks*, `_outbox` tetap, "
              "updated_at/rev/dirty 4 task tetap",
              not writes and after_b == before and recs_b0 == recs_b1,
              "writes=%r outbox %r→%r rekaman sama=%r" % (writes[:3], before, after_b, recs_b0 == recs_b1))
        # Toggle: matikan → klik membuka modal; nyalakan lagi → panel kembali
        live_btn(p).click()
        check("B-toggle mati: panel hilang, aria-pressed=false", p.locator(PANEL).count() == 0
              and live_btn(p).get_attribute("aria-pressed") == "false"
              and live_btn(p).get_attribute("title") == "Tampilkan panel detail di samping")
        p.locator(".task-row").first.click()
        check("B-toggle mati: klik task membuka modal", wait_until(lambda: p.locator(".modal-content").count() == 1, 5))
        p.locator(".modal-content span").filter(has_text=re.compile(r"^✕$")).first.click()
        p.locator(".modal-overlay").first.wait_for(state="detached", timeout=5000)
        live_btn(p).click()
        check("B-toggle nyala lagi: panel kembali", wait_until(lambda: p.locator(PANEL).count() == 1, 5))
        check("Z[1] tanpa error konsol/pageerror (A, D, B)", not errors, "; ".join(errors[:5]))
    except Exception as e:  # langkah yang melempar = gagal
        fail_exc("A/D/B", e, p)
    finally:
        ctx.close()


def fail_exc(tag, e, p=None):
    import traceback
    traceback.print_exc()
    check("%s exception" % tag, False, "%s: %s" % (type(e).__name__, str(e)[:300]))
    if p is not None:
        try:
            shot(p, "zz_error_%s.png" % re.sub(r"\W+", "", tag))
        except Exception:  # noqa: BLE001
            pass


def scen_edit(browser, base, A, ids):
    """C (edit + bertahan setelah reload + tag), K ("+ Baru" project), E (offline)."""
    errors = []
    ctx, p = open_app(browser, base, A, 1280, 860, "light", errors, live="1")
    try:
        go_next(p)
        seed_local_tag(p, T_ALPHA, "kerja")
        p.reload()
        p.locator(".sidebar-link, .sidebar-rail-btn").first.wait_for(state="attached", timeout=20000)
        go_next(p)
        settle_outbox(p)
        aid = ids[T_ALPHA]
        click_row(p, T_ALPHA)
        check("C0 task Alpha: tag #kerja tampil di panel", wait_until(lambda: panel_tags(p) == ["kerja"], 8),
              repr(panel_tags(p)))

        # ── Priority: tersimpan langsung (popover Prioritas) ──
        set_priority(p, "P2")
        check("C1 Priority diubah → tersimpan lokal dalam 1 dtk (langsung, tanpa menunggu diam 1,5 dtk)",
              wait_until(lambda: local_task(p, aid)["priority"] == "P2", 1), "lokal=" + local_task(p, aid)["priority"])
        check("C1a Priority P2 sampai ke server (push outbox)",
              wait_until(lambda: server_task(base, A, aid)["priority"] == "P2", 12),
              "server=" + server_task(base, A, aid)["priority"])
        check("C1b indikator 'Tersimpan' tampil setelah simpan",
              wait_until(lambda: "Tersimpan" in p.locator(PANEL + " .tl-save-ind").first.inner_text(), 5),
              repr(p.locator(PANEL + " .tl-save-ind").first.inner_text()))
        shot(p, "C_priority_saved.png")

        # ── Deskripsi: tersimpan setelah diam ──
        new_desc = "Deskripsi baru dari panel Live Edit"
        desc_area(p).fill(new_desc)
        p.wait_for_timeout(500)
        check("C2 deskripsi: 0,5 dtk setelah mengetik belum tersimpan (lokal)",
              local_task(p, aid)["description"] != new_desc, repr(local_task(p, aid)["description"]))
        check("C3 deskripsi: tersimpan lokal setelah diam ±1,5 dtk (tanpa blur)",
              wait_until(lambda: local_task(p, aid)["description"] == new_desc, 3.5),
              repr(local_task(p, aid)["description"]))
        check("C3b deskripsi sampai ke server", wait_until(lambda: server_task(base, A, aid)["description"] == new_desc, 12),
              repr(server_task(base, A, aid)["description"]))

        # ── Judul: hanya saat blur; tag lama tetap ──
        new_title = T_ALPHA_NEW
        tin = p.locator(PANEL + " input[aria-label='Judul task']").first
        tin.click()
        tin.fill(new_title)
        p.wait_for_timeout(2200)  # > TEXT_IDLE_MS: judul tidak boleh tersimpan sebelum blur
        check("C4 judul: 2,2 dtk setelah mengetik (belum blur) belum tersimpan (lokal dan server)",
              local_task(p, aid)["title"] == T_ALPHA and server_task(base, A, aid)["title"] == T_ALPHA,
              repr((local_task(p, aid)["title"], server_task(base, A, aid)["title"])))
        tin.press("Tab")
        check("C5 judul: tersimpan lokal saat blur (dalam 1,5 dtk)",
              wait_until(lambda: local_task(p, aid)["title"] == new_title, 1.5), repr(local_task(p, aid)["title"]))
        check("C5b judul sampai ke server", wait_until(lambda: server_task(base, A, aid)["title"] == new_title, 12),
              repr(server_task(base, A, aid)["title"]))
        check("C6 judul diganti → tag #kerja tetap (lokal dan server)",
              wait_until(lambda: local_tags(p, aid) == ["kerja"] and panel_tags(p) == ["kerja"], 6)
              and wait_until(lambda: server_tags(base, A, aid) == ["kerja"], 15),
              "lokal=%r panel=%r server=%r" % (local_tags(p, aid), panel_tags(p), server_tags(base, A, aid)))
        check("C6b judul di input tanpa '#tag' (bukan 'revisi #kerja')", panel_title(p) == new_title, repr(panel_title(p)))

        # ── #tagbaru di judul menjadi tag ──
        tin = p.locator(PANEL + " input[aria-label='Judul task']").first
        tin.click()
        tin.fill(new_title + " #tagbaru")
        tin.press("Enter")
        check("C7 '#tagbaru' di judul → menjadi tag (kerja + tagbaru), judul tanpa tag",
              wait_until(lambda: panel_tags(p) == ["kerja", "tagbaru"] and panel_title(p) == new_title, 8)
              and wait_until(lambda: server_task(base, A, aid)["title"] == new_title, 8),
              "tag panel=%r judul=%r server=%r" % (panel_tags(p), panel_title(p), server_task(base, A, aid)["title"]))
        check("C7b tag server ikut (kerja + tagbaru)",
              wait_until(lambda: server_tags(base, A, aid) == ["kerja", "tagbaru"], 15), repr(server_tags(base, A, aid)))
        shot(p, "C_title_tags.png")

        # ── reload: nilai bertahan ──
        p.reload()
        p.locator(".sidebar-link, .sidebar-rail-btn").first.wait_for(state="attached", timeout=20000)
        go_next(p)
        click_row(p, new_title)
        check("C8 reload: judul, Priority P2, deskripsi, dan tag bertahan",
              panel_title(p) == new_title and prop_text(p, "Prioritas").startswith("P2 ")
              and desc_area(p).input_value() == new_desc
              and wait_until(lambda: panel_tags(p) == ["kerja", "tagbaru"], 8),
              "judul=%r pri=%r tag=%r" % (panel_title(p), prop_text(p, "Prioritas"), panel_tags(p)))

        # ── R21: tag dihapus di luar panel (rute lokal, seperti modal) → simpan judul di panel tidak memulihkannya ──
        p.evaluate("async (id) => await api.del('/api/tasks/' + id + '/tags/tagbaru')", aid)
        check("C9 prasyarat: tag 'tagbaru' terhapus di luar panel (lokal)", local_tags(p, aid) == ["kerja"],
              "lokal=%r panel=%r (chip dimuat saat mount)" % (local_tags(p, aid), panel_tags(p)))
        for t_new in (new_title + " lagi", new_title):
            tin = p.locator(PANEL + " input[aria-label='Judul task']").first
            tin.click()
            tin.fill(t_new)
            tin.press("Tab")
            if not wait_until(lambda: local_task(p, aid)["title"] == t_new, 3):
                break
        check("C9a simpan judul sesudahnya memuat tag segar: 'tagbaru' tidak kembali (lokal, chip, server)",
              local_task(p, aid)["title"] == new_title
              and wait_until(lambda: local_tags(p, aid) == ["kerja"] and panel_tags(p) == ["kerja"], 6)
              and wait_until(lambda: server_tags(base, A, aid) == ["kerja"], 15),
              "judul=%r lokal=%r panel=%r server=%r" % (local_task(p, aid)["title"], local_tags(p, aid), panel_tags(p),
                                                       server_tags(base, A, aid)))

        # ── K. popover Proyek (NamePicker) terbuka lalu diam: project lama tidak hilang ──
        check("K0 project awal 'Proyek Satu'", prop_text(p, "Proyek") == "Proyek Satu", prop_text(p, "Proyek"))
        inp = open_name_picker(p, "Proyek")
        p.wait_for_timeout(2300)  # > TEXT_IDLE_MS
        check("K1 popover Proyek dibuka lalu diam 2,3 dtk → project lama masih ada (lokal dan server)",
              local_task(p, aid)["project"] == "Proyek Satu" and server_task(base, A, aid)["project"] == "Proyek Satu",
              repr((local_task(p, aid)["project"], server_task(base, A, aid)["project"])))
        shot(p, "K_new_project_idle.png")
        inp.fill("Proyek Baru")
        p.wait_for_timeout(2300)  # > TEXT_IDLE_MS
        check("K2 nama baru diketik lalu diam 2,3 dtk → BELUM tersimpan (R19: hanya saat Enter / '+ Buat')",
              local_task(p, aid)["project"] == "Proyek Satu"
              and p.locator(POP, has_text="+ Buat 'Proyek Baru'").count() == 1, repr(local_task(p, aid)["project"]))
        inp.press("Enter")
        check("K2a Enter → nama baru tersimpan lokal (dalam 1,5 dtk), popover tertutup",
              wait_until(lambda: local_task(p, aid)["project"] == "Proyek Baru" and pops(p) == 0, 1.5),
              repr(local_task(p, aid)["project"]))
        check("K2b nama project baru sampai ke server",
              wait_until(lambda: server_task(base, A, aid)["project"] == "Proyek Baru", 12),
              repr(server_task(base, A, aid)["project"]))

        # ── R19: nama diketik dua bagian dengan jeda 2 dtk → server tidak membuat project/tahap setengah jadi ──
        full_proj = "Pemasaran Kuartal"
        inp = open_name_picker(p, "Proyek")
        inp.press_sequentially("Pema", delay=40)
        p.wait_for_timeout(2000)
        check("K3 project 'Pema' + jeda 2 dtk → belum tersimpan (lokal tetap 'Proyek Baru')",
              local_task(p, aid)["project"] == "Proyek Baru", repr(local_task(p, aid)["project"]))
        inp.press_sequentially("saran Kuartal", delay=40)
        inp.press("Enter")
        check("K3a Enter → server menerima nama lengkap",
              wait_until(lambda: server_task(base, A, aid)["project"] == full_proj, 12),
              repr(server_task(base, A, aid)["project"]))
        settle_outbox(p)
        projs = api(base, A, "GET", "/api/projects")
        check("K3b daftar project server: hanya nama lengkap, tanpa 'Pema…' setengah jadi",
              [n for n in projs if n.lower().startswith("pema")] == [full_proj], repr(projs))
        # setengah diketik lalu popover ditutup (klik di luar) → tidak tersimpan sama sekali
        inp = open_name_picker(p, "Proyek")
        inp.press_sequentially("Setengah", delay=40)
        p.locator(PANEL + " .td-meta").first.click()
        p.wait_for_timeout(2300)
        settle_outbox(p)
        check("K3c 'Setengah' diketik lalu klik di luar popover → popover tertutup, project tetap, tanpa project baru",
              pops(p) == 0 and local_task(p, aid)["project"] == full_proj
              and server_task(base, A, aid)["project"] == full_proj
              and not [n for n in api(base, A, "GET", "/api/projects") if n.lower().startswith("setengah")],
              repr((local_task(p, aid)["project"], api(base, A, "GET", "/api/projects"))))

        check("K4 context/tahap awal '@kantor'", prop_text(p, "Tahap") == "@kantor", prop_text(p, "Tahap"))
        ctx_input = open_name_picker(p, "Tahap")
        ctx_input.press_sequentially("@gud", delay=40)
        p.wait_for_timeout(2000)
        check("K4a tahap '@gud' + jeda 2 dtk → belum tersimpan (lokal tetap '@kantor')",
              local_task(p, aid)["context"] == "@kantor", repr(local_task(p, aid)["context"]))
        ctx_input.press_sequentially("ang", delay=40)
        ctx_input.press("Enter")
        check("K4b Enter di popover Tahap → tersimpan lokal (dalam 1,5 dtk) dan sampai ke server",
              wait_until(lambda: local_task(p, aid)["context"] == "@gudang", 1.5)
              and wait_until(lambda: server_task(base, A, aid)["context"] == "@gudang", 12),
              repr((local_task(p, aid)["context"], server_task(base, A, aid)["context"])))
        settle_outbox(p)
        ctxs = api(base, A, "GET", "/api/contexts")
        names = [c if isinstance(c, str) else c.get("name") for c in ctxs]
        check("K4c daftar context/tahap server: hanya '@gudang', tanpa '@gud' setengah jadi",
              [n for n in names if n and n.lower().startswith("@gud")] == ["@gudang"], repr(names))

        # Opsi yang sudah ada di scope: tersimpan langsung saat diklik.
        open_name_picker(p, "Proyek")
        pop_option(p, "Proyek Dua").click()
        check("K5 memilih project yang sudah ada → tersimpan lokal langsung (dalam 1 dtk)",
              wait_until(lambda: local_task(p, aid)["project"] == "Proyek Dua", 1), repr(local_task(p, aid)["project"]))
        check("K5b project 'Proyek Dua' sampai ke server",
              wait_until(lambda: server_task(base, A, aid)["project"] == "Proyek Dua", 12),
              repr(server_task(base, A, aid)["project"]))

        # ── E. offline (CDP) → edit → online → tersinkron ──
        click_row(p, T_FOX)
        base_n = settle_outbox(p)
        cdp = ctx.new_cdp_session(p)
        OFFLINE["on"] = True
        cdp.send("Network.emulateNetworkConditions", {"offline": True, "latency": 0, "downloadThroughput": -1,
                                                       "uploadThroughput": -1})
        p.wait_for_timeout(500)
        check("E0 offline: navigator.onLine=false", p.evaluate("() => navigator.onLine") is False)
        fid = ids[T_FOX]
        set_priority(p, "P1")
        check("E1 offline: Priority P1 tersimpan lokal (_outbox bertambah)",
              wait_until(lambda: outbox_count(p) > base_n, 6), "sebelum=%r sekarang=%r" % (base_n, outbox_count(p)))
        check("E2 offline: server belum berubah", server_task(base, A, fid)["priority"] == "P3",
              server_task(base, A, fid)["priority"])
        desc_off = "Diedit saat offline"
        desc_area(p).fill(desc_off)
        p.wait_for_timeout(2300)
        check("E3 offline: indikator tidak 'Gagal menyimpan' (router lokal)",
              "Gagal" not in p.locator(PANEL + " .tl-save-ind").first.inner_text(),
              repr(p.locator(PANEL + " .tl-save-ind").first.inner_text()))
        shot(p, "E_offline_edit.png")
        cdp.send("Network.emulateNetworkConditions", {"offline": False, "latency": 0, "downloadThroughput": -1,
                                                       "uploadThroughput": -1})
        p.wait_for_timeout(1500)
        OFFLINE["on"] = False
        check("E4 online lagi → server menerima Priority P1 dan deskripsi",
              wait_until(lambda: server_task(base, A, fid)["priority"] == "P1"
                         and server_task(base, A, fid)["description"] == desc_off, 30),
              repr((server_task(base, A, fid)["priority"], server_task(base, A, fid)["description"])))
        check("E5 _outbox terkuras setelah tersinkron", wait_until(lambda: outbox_count(p) == 0, 20),
              repr(outbox_count(p)))
        check("Z[2] tanpa error konsol/pageerror (C, K, E)", not errors, "; ".join(errors[:5]))
    except Exception as e:  # noqa: BLE001
        fail_exc("C/K/E", e, p)
    finally:
        ctx.close()


def kanban_col_keys(page):
    return page.evaluate("() => Array.from(document.querySelectorAll('[data-kanban-col]')).map(c => c.getAttribute('data-kanban-col'))")


def mouse_drag_card(page, title, col_key):
    """Seret kartu `title` ke kolom `col_key`. Dengan panel tampil papan hanya ±2 kolom lebar dan bergulir ke samping:
    gulirkan kartu lalu kolom tujuan ke dalam layar SEBELUM mengukur (kolom bersebelahan tetap sama-sama terlihat)."""
    c = page.locator("[data-kanban-task]", has_text=title).first
    target = page.locator('[data-kanban-col="%s"]' % col_key)
    c.scroll_into_view_if_needed()
    target.scroll_into_view_if_needed()
    page.wait_for_timeout(200)
    sb = c.bounding_box()
    tb = target.bounding_box()
    vw = page.evaluate("() => innerWidth")
    sx, sy = sb["x"] + sb["width"] / 2, sb["y"] + sb["height"] / 2
    if not (0 <= sx <= vw and 0 <= tb["x"] + tb["width"] / 2 <= vw):
        raise RuntimeError("kartu atau kolom tujuan di luar layar: kartu x=%.0f kolom x=%.0f vw=%d" % (sx, tb["x"], vw))
    tx, ty = tb["x"] + tb["width"] / 2, tb["y"] + min(120, tb["height"] / 2)
    page.mouse.move(sx, sy)
    page.mouse.down()
    page.mouse.move(sx + 10, sy + 4, steps=3)
    page.mouse.move(tx, ty, steps=20)
    page.wait_for_timeout(150)
    page.mouse.up()


def scen_actions(browser, base, A, ids):
    """F: Selesai / Buka lagi, Hapus, drag Kanban."""
    errors = []
    ctx, p = open_app(browser, base, A, 1280, 860, "light", errors, live="1")
    try:
        go_next(p)
        p.wait_for_timeout(500)
        # ── Selesai (bar atas) ──
        bid = ids[T_BRAVO]
        click_row(p, T_BRAVO)
        top_btn(p, "Selesai").click()
        check("F1 Selesai di panel: task hilang dari Next Actions",
              wait_until(lambda: p.locator(".task-row", has_text=T_BRAVO).count() == 0, 10))
        check("F2 Selesai di panel: task tetap tampil di panel", panel_title(p) == T_BRAVO, repr(panel_title(p)))
        check("F3 server: status done", wait_until(lambda: server_task(base, A, bid)["gtd_status"] == "done", 10),
              server_task(base, A, bid)["gtd_status"])
        check("F4 panel menampilkan status 'Done' (data terbaru), tombol 'Selesai' diganti 'Buka lagi'",
              wait_until(lambda: prop_text(p, "Status") == "Done", 8)
              and p.locator(PANEL + " .td-top button", has_text="Selesai").count() == 0
              and top_btn(p, "Buka lagi").is_visible(),
              repr(prop_text(p, "Status")))
        shot(p, "F_done_in_panel.png")
        top_btn(p, "Buka lagi").click()
        check("F5 Buka lagi → server next dan task muncul lagi di daftar; tombol kembali 'Selesai'",
              wait_until(lambda: server_task(base, A, bid)["gtd_status"] == "next", 8)
              and wait_until(lambda: p.locator(".task-row", has_text=T_BRAVO).count() == 1, 10)
              and wait_until(lambda: top_btn(p, "Selesai").is_visible(), 5),
              server_task(base, A, bid)["gtd_status"])
        check("F5b panel tetap di task yang sama", panel_title(p) == T_BRAVO)

        # ── Hapus ──
        did = ids[T_DELTA]
        click_row(p, T_DELTA)
        menu_action(p, "Hapus")
        check("F6 ⋯ Aksi lain → Hapus (konfirmasi diterima) → panel 'Pilih task di daftar'",
              wait_until(lambda: p.locator(PANEL + " .tl-live-empty", has_text=PICK_TEXT).count() == 1, 8),
              repr(panel_text(p)))
        check("F6b task hilang dari daftar dan tidak ada sorotan",
              wait_until(lambda: p.locator(".task-row", has_text=T_DELTA).count() == 0, 8)
              and p.locator(".task-row.is-selected").count() == 0)
        check("F6c server: task terhapus", wait_until(
            lambda: server_row(base, A, T_DELTA) is None, 20), repr(server_row(base, A, T_DELTA)))
        shot(p, "F_deleted.png")
        p.locator(".task-row", has_text=T_CHARLIE).first.click()
        check("F6d klik task lain sesudah Hapus → panel menampilkannya", wait_title(p, T_CHARLIE))

        # ── task terpilih dihapus di perangkat lain (R6/R16): hanya teks, tanpa body ──
        # tunggu GET anak panel (notes/attachments/subtasks) selesai dulu: yang tiba sesudah DELETE menjadi 404
        missing = wait_child_lists(p, ids[T_FOX], lambda: click_row(p, T_FOX))
        if missing:
            print("  catatan F6e: respons anak panel belum tiba sebelum DELETE: %r" % sorted(missing), flush=True)
        api(base, A, "DELETE", "/api/tasks/%d" % ids[T_FOX])
        p.evaluate("() => window.__refreshTasks && window.__refreshTasks()")
        check("F6e task terpilih dihapus di tempat lain → teks 'sudah dihapus', tanpa body",
              wait_until(lambda: p.locator(PANEL + " .tl-live-empty", has_text=GONE_TEXT).count() == 1, 15)
              and p.locator(PANEL + " input[aria-label='Judul task']").count() == 0, repr(panel_text(p)))
        shot(p, "F_gone_elsewhere.png")

        # ── drag kartu Kanban: pilihan tidak berubah ──
        click_row(p, T_ALPHA_NEW)  # judul Alpha sudah diganti di skenario C
    except Exception as e:  # noqa: BLE001
        fail_exc("F-aksi", e, p)
    try:
        group_by(p, "priority")
        set_view(p, "kanban")
        p.locator("[data-kanban-task]").first.wait_for(timeout=5000)
        sel_before = panel_title(p)
        keys = kanban_col_keys(p)
        check("F7 Kanban Group by Priority: kolom pri:P1..pri:P4 ada", all(("pri:" + k) in keys for k in ("P1", "P2", "P3", "P4")), repr(keys))
        cid = ids[T_CHARLIE]
        check("F7b kartu terpilih ber-aria-current sebelum drag", bool(selected_text(p, "[data-kanban-task]")),
              repr(selected_text(p, "[data-kanban-task]")))
        sel_card_before = selected_text(p, "[data-kanban-task]")
        check("F7c kartu terpilih = task di panel", sel_before in (sel_card_before or ""), repr(sel_card_before))
        mouse_drag_card(p, T_CHARLIE, "pri:P2")
        check("F8 drag kartu Charlie P3 → P2 (kolom bersebelahan): lokal P2 dan server P2",
              wait_until(lambda: local_task(p, cid)["priority"] == "P2", 5)
              and wait_until(lambda: server_task(base, A, cid)["priority"] == "P2", 12),
              "lokal=%r server=%r" % (local_task(p, cid)["priority"], server_task(base, A, cid)["priority"]))
        check("F9 drag kartu: panel tetap pada task semula", panel_title(p) == sel_before,
              "sebelum=%r sesudah=%r" % (sel_before, panel_title(p)))
        check("F9b drag kartu: tetap satu kartu terpilih dan itu task di panel (bukan kartu yang diseret)",
              p.locator("[data-kanban-task][aria-current='true']").count() == 1
              and sel_before in (selected_text(p, "[data-kanban-task]") or ""),
              "sesudah=%r" % selected_text(p, "[data-kanban-task]"))
        shot(p, "F_kanban_drag.png")
        check("Z[3] tanpa error konsol/pageerror (F)", not errors, "; ".join(errors[:5]))
    except Exception as e:  # noqa: BLE001
        fail_exc("F-kanban", e, p)
    finally:
        ctx.close()


def scen_dark(browser, base, A):
    errors = []
    ctx, p = open_app(browser, base, A, 1280, 860, "dark", errors, live="1")
    try:
        go_next(p)
        wait_until(lambda: panel_title(p) is not None, 10)
        p.wait_for_timeout(400)
        info = p.evaluate("""() => {
            const lum = c => { const m = /rgba?\\((\\d+), *(\\d+), *(\\d+)(?:, *([\\d.]+))?\\)/.exec(c); if (!m) return null;
                return {l: (0.2126*m[1] + 0.7152*m[2] + 0.0722*m[3]) / 255, a: m[4] === undefined ? 1 : parseFloat(m[4])}; };
            const a = document.querySelector('aside.tl-live-panel');
            const sel = document.querySelector('.task-row.is-selected');
            const rows = Array.from(document.querySelectorAll('.task-row:not(.is-selected)'));
            const bg = el => el ? getComputedStyle(el).backgroundColor : null;
            const probe = document.createElement('div'); probe.style.background = 'var(--bg-card)'; document.body.appendChild(probe);
            const card = getComputedStyle(probe).backgroundColor; probe.remove();
            return {theme: document.documentElement.getAttribute('data-theme'), panel: bg(a), panelLum: lum(bg(a)), card,
                    sel: bg(sel), other: rows.length ? bg(rows[0]) : null, btnBorder: a ? getComputedStyle(a).borderTopColor : null};
        }""")
        check("H1 mode gelap aktif (data-theme=dark)", info["theme"] == "dark", repr(info["theme"]))
        check("H2 panel berlatar token --bg-card (tidak transparan, gelap), bukan putih",
              info["panelLum"] is not None and info["panelLum"]["a"] > 0 and info["panelLum"]["l"] < 0.35
              and info["panel"] == info["card"], "panel=%r --bg-card=%r" % (info["panel"], info["card"]))
        check("H3 baris terpilih berlatar berbeda dari baris lain", info["sel"] and info["sel"] != info["other"],
              "terpilih=%r lain=%r" % (info["sel"], info["other"]))
        shot(p, "H_dark_normal.png")
        group_by(p, "priority")
        set_view(p, "kanban")
        p.locator("[data-kanban-task]").first.wait_for(timeout=5000)
        kinfo = p.evaluate("""() => {
            const sel = document.querySelector('[data-kanban-task][aria-current="true"]');
            const other = document.querySelector('[data-kanban-task]:not([aria-current="true"])');
            const bi = el => el ? getComputedStyle(el).backgroundImage : null;
            return {sel: bi(sel), other: bi(other)};
        }""")
        check("H4 kartu Kanban terpilih punya lapisan sorotan (background-image) yang tidak ada di kartu lain",
              kinfo["sel"] and kinfo["sel"] != "none" and kinfo["sel"] != kinfo["other"], repr(kinfo))
        shot(p, "H_dark_kanban.png")
        check("Z[4] tanpa error konsol/pageerror (H)", not errors, "; ".join(errors[:5]))
    except Exception as e:  # noqa: BLE001
        fail_exc("H", e, p)
    finally:
        ctx.close()


def scen_narrow(browser, base, A):
    """G: area konten < 760 px → tidak ada tombol/panel; klik membuka modal. Nilai tf_liveedit tetap '1' tersimpan."""
    for label, w, h in (("375", 375, 812), ("900", 900, 800)):
        errors = []
        tag = "G[%s]" % label
        ctx, p = open_app(browser, base, A, w, h, "light", errors, live="1")
        try:
            go_next(p, mobile=w < 500)
            if w >= 500:
                # bilah ikon di 900 px: area konten ≈ 780 px → tersedia, panel tampil; sidebar dilebarkan → menyempit
                p.wait_for_timeout(500)
                check("%s bilah ikon (area konten ≥ 760 px): tombol Live Edit tampil dan panel menampilkan task" % tag,
                      live_btn(p).count() == 1 and p.locator(PANEL).count() == 1, "root=%r" % root_width(p))
                expand_sidebar(p)
                p.wait_for_timeout(700)
            p.wait_for_timeout(500)
            check("%s tombol Live Edit tidak ada, panel tidak ada" % tag,
                  live_btn(p).count() == 0 and p.locator(PANEL).count() == 0)
            p.locator(".task-row").first.click()
            check("%s klik task membuka modal" % tag, wait_until(lambda: p.locator(".modal-content").count() == 1, 6))
            shot(p, "G_%s_modal.png" % label)
            p.locator(".modal-content span").filter(has_text=re.compile(r"^✕$")).first.click()
            p.locator(".modal-overlay").first.wait_for(state="detached", timeout=5000)
            check("%s tf_liveedit tetap '1' (preferensi tidak ditimpa saat tidak tersedia)" % tag,
                  p.evaluate("() => localStorage.getItem('tf_liveedit')") == "1")
            check("Z[%s] tanpa error konsol/pageerror (%s px)" % (label, label), not errors, "; ".join(errors[:5]))
        except Exception as e:  # noqa: BLE001
            fail_exc(tag, e, p)
        finally:
            ctx.close()


def scen_first_arrives(browser, base, E):
    """A (varian terjamin): daftar kosong saat panel sudah tampil, task pertama tiba sesudahnya."""
    errors = []
    ctx, p = open_app(browser, base, E, 1280, 860, "light", errors, live="1")
    try:
        expand_sidebar(p)
        p.locator(".sidebar-link", has_text="Next Actions").first.click()
        p.wait_for_timeout(1500)
        check("A5 daftar kosong + panel nyala → 'Tidak ada task'",
              p.locator(PANEL + " .tl-live-empty", has_text=EMPTY_TEXT).count() == 1, repr(panel_text(p)))
        api(base, E, "POST", "/api/tasks", json={"title": "Tugas pertama tiba", "priority": "P2", "gtd_status": "next"})
        p.evaluate("() => window.__refreshTasks && window.__refreshTasks()")
        p.locator(".task-row").first.wait_for(timeout=15000)
        check("A6 task pertama tiba sesudah panel tampil → panel langsung memilihnya",
              wait_title(p, "Tugas pertama tiba", 8), repr(panel_title(p)) + " / " + repr(panel_text(p)))
        shot(p, "A_first_arrives.png")
        check("Z[5] tanpa error konsol/pageerror (A5/A6)", not errors, "; ".join(errors[:5]))
    except Exception as e:  # noqa: BLE001
        fail_exc("A-first", e, p)
    finally:
        ctx.close()


def seed_tall(base, name):
    user = register(base, name)
    desc = "\n".join("Baris deskripsi nomor %d untuk membuat detail task tinggi." % i for i in range(40))
    t = api(base, user, "POST", "/api/tasks", json={"title": T_TALL, "priority": "P1", "gtd_status": "next",
                                                    "description": desc, "project": "Proyek Satu", "context": "@kantor"})
    for i in range(7):
        api(base, user, "POST", "/api/tasks/%d/subtasks" % t["id"], json={"title": "Langkah checklist %d" % (i + 1)})
    for i in range(24):  # daftar panjang agar halaman bisa digulir
        api(base, user, "POST", "/api/tasks", json={"title": "Isi daftar %02d" % i, "priority": "P3", "gtd_status": "next"})
    return user, t["id"]


def scen_tall(browser, base, T):
    """I (bagian 1): bar atas panel (Fokus, Selesai, ⋯) terlihat pada scrollTop 0, tetap di viewport saat halaman
    digulir, dan menempel di puncak aside saat isi panel digulir; task tinggi."""
    errors = []
    ctx, p = open_app(browser, base, T, 1280, 800, "light", errors, live="1")
    try:
        go_next(p)
        check("I0 task tinggi dipilih di panel", wait_title(p, T_TALL, 10), repr(panel_title(p)))
        p.locator(PANEL + " span", has_text="Langkah checklist 7").first.wait_for(timeout=10000)
        p.wait_for_timeout(500)
        g0 = panel_geom(p)
        check("I1 konten panel lebih tinggi dari panel (task tinggi sungguhan)", g0["scrollH"] > g0["clientH"] + 100,
              repr(g0))
        check("I2 scrollTop 0: aside dan bar atas (Fokus … ⋯) di dalam viewport, bar di puncak aside",
              bar_stuck(g0) and g0["asideScroll"] == 0, repr(g0))
        shot(p, "I_tall_scroll0.png")
        for y in (120, 400, 5000):
            p.evaluate("(y) => window.scrollTo(0, y)", y)
            p.wait_for_timeout(350)
            g = panel_geom(p)
            check("I3 halaman digulir ke y=%d (scrollY=%d): aside dan bar atas tetap di dalam viewport" % (y, g["scrollY"]),
                  bar_in_viewport(g), repr(g))
        p.evaluate("() => window.scrollTo(0, 0)")
        p.wait_for_timeout(350)
        for y in (60, 300, 100000):
            p.evaluate("(y) => { document.querySelector('aside.tl-live-panel').scrollTop = y; }", y)
            p.wait_for_timeout(350)
            g = panel_geom(p)
            check("I3b isi panel digulir (aside.scrollTop=%d): bar atas menempel di puncak aside (top ≈ aside.top)"
                  % g["asideScroll"], g["asideScroll"] > 0 and bar_stuck(g), repr(g))
        shot(p, "I_tall_scrolled.png")
        # bar atas benar-benar dapat diklik saat isi digulir (tidak tertutup isi yang lewat di bawahnya)
        hit = p.evaluate("""() => { const b = Array.from(document.querySelectorAll('aside.tl-live-panel .td-top button'))
            .find(x => x.textContent.trim() === 'Selesai'); if (!b) return null; const r = b.getBoundingClientRect();
            const el = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
            return !!el && (el === b || b.contains(el)); }""")
        check("I5 tombol Selesai di bar atas tidak tertutup elemen lain saat isi panel digulir", hit is True, repr(hit))
        p.evaluate("() => { document.querySelector('aside.tl-live-panel').scrollTop = 0; }")
        p.wait_for_timeout(350)
        check("I4 kembali ke scrollTop 0: bar atas di puncak aside", bar_stuck(panel_geom(p)), repr(panel_geom(p)))
        check("Z[6] tanpa error konsol/pageerror (I)", not errors, "; ".join(errors[:5]))
    except Exception as e:  # noqa: BLE001
        fail_exc("I-tall", e, p)
    finally:
        ctx.close()


def seed_short(base, name):
    """Daftar PENDEK dengan judul panjang: saat panel mati halaman muat satu layar (tanpa scrollbar); saat panel nyala
    kolom daftar menyempit, judul membungkus, halaman memanjang dan scrollbar klasik muncul → area konten menyempit.
    Itulah syarat kedip lama di dekat 760 px (tanpa kompensasi lebar scrollbar: 37–48 mutasi panel per detik)."""
    user = register(base, name)
    for i in range(4):
        api(base, user, "POST", "/api/tasks", json={
            "title": "Tugas %d dengan judul yang cukup panjang supaya baris membungkus saat kolom daftar menyempit" % i,
            "priority": "P2", "gtd_status": "next"})
    return user


def scen_flicker(pw, base, F):
    """I (bagian 2): tanpa kedip panel di sekitar ambang 760 px. Memakai scrollbar klasik sungguhan (headless
    menyembunyikannya secara bawaan): panel tinggi memanjangkan halaman, scrollbar muncul, area konten menyempit;
    tanpa kompensasi lebar scrollbar panel mati sendiri lalu menyala lagi tanpa henti."""
    errors = []
    browser = pw.chromium.launch(ignore_default_args=["--hide-scrollbars"])
    ctx, p = open_app(browser, base, F, 1100, 700, "light", errors, live="1")
    try:
        go_next(p)
        collapse_sidebar(p)  # sidebar ikon: area konten ≈ viewport − 120 px
        p.locator(PANEL + " input[aria-label='Judul task']").first.wait_for(timeout=10000)
        p.set_viewport_size({"width": 1000, "height": 700})
        p.wait_for_timeout(700)
        sb_on = p.evaluate("() => window.innerWidth - document.documentElement.clientWidth")
        p.set_viewport_size({"width": 870, "height": 700})
        p.wait_for_timeout(700)
        sb_off = p.evaluate("() => window.innerWidth - document.documentElement.clientWidth")
        check("I6 syarat kedip ada: scrollbar klasik muncul saat panel nyala (>0) dan tidak saat panel mati (=0)",
              sb_on > 0 and sb_off == 0 and p.locator(PANEL).count() == 0, "panel nyala=%d, mati=%d" % (sb_on, sb_off))
        unstable = []
        states = []
        for vw in range(870, 907, 3):
            p.set_viewport_size({"width": vw, "height": 700})
            p.wait_for_timeout(700)  # beri waktu mengendap setelah resize
            res = p.evaluate("""() => new Promise(res => {
                const has = () => !!document.querySelector('aside.tl-live-panel');
                const start = has(); let muts = 0;
                const mo = new MutationObserver(ms => { for (const m of ms) for (const x of [...m.addedNodes, ...m.removedNodes])
                    if (x.nodeType === 1 && (x.matches('.tl-live,aside.tl-live-panel') || x.querySelector?.('aside.tl-live-panel'))) muts++; });
                mo.observe(document.body, {childList: true, subtree: true});
                let flips = 0, last = start;
                const iv = setInterval(() => { const h = has(); if (h !== last) { flips++; last = h; } }, 50);
                setTimeout(() => { clearInterval(iv); mo.disconnect(); res({start, end: has(), muts, flips,
                    root: document.querySelector('.fade-in')?.clientWidth,
                    sb: window.innerWidth - document.documentElement.clientWidth}); }, 1000);
            })""")
            expect = (res["root"] + res["sb"]) >= 760
            states.append((vw, res["root"], res["sb"], res["end"]))
            if res["muts"] or res["flips"] or res["start"] != res["end"] or res["end"] != expect:
                unstable.append((vw, res, expect))
        panel_on = [s for s in states if s[3]]
        panel_off = [s for s in states if not s[3]]
        check("I7 sapuan lebar viewport 870–906 px mencakup kedua sisi ambang (panel nyala dan mati)",
              bool(panel_on) and bool(panel_off), "nyala=%d mati=%d" % (len(panel_on), len(panel_off)))
        check("I8 tanpa kedip: panel stabil 1 dtk di tiap lebar dan sesuai ambang (root+scrollbar ≥ 760)", not unstable,
              repr(unstable[:3]))
        print("  sapuan:", " ".join("%d:%d+%d=%s" % (v, r, s, "ON" if on else "off") for v, r, s, on in states), flush=True)
        check("Z[7] tanpa error konsol/pageerror (I kedip)", not errors, "; ".join(errors[:5]))
    except Exception as e:  # noqa: BLE001
        fail_exc("I-flicker", e, p)
    finally:
        ctx.close()
        browser.close()


def want(name):
    """E2E_ONLY=flicker,tall,... menjalankan sebagian skenario (debug); kosong = semua."""
    only = [x for x in os.environ.get("E2E_ONLY", "").split(",") if x]
    return not only or name in only


def main():
    os.makedirs(SHOTS, exist_ok=True)
    for f in os.listdir(SHOTS):
        if f.endswith(".png"):
            os.remove(os.path.join(SHOTS, f))
    tmp = tempfile.mkdtemp(prefix="e2e_live_edit_")
    proc, base, _db = start_server(tmp)
    print("server", base, "root", ROOT, "SW", SW_VERSION, flush=True)
    try:
        A, ids = seed_user(base, "ana")
        E = register(base, "eka")  # tanpa task
        T, _tid = seed_tall(base, "tia")
        F = seed_short(base, "kedip")
        check("setup: 5 task Next + 1 anak untuk Alpha; user tanpa task; user dengan task tinggi",
              len(api(base, A, "GET", "/api/tasks")) >= 6)
        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            if want("views"):
                print("== A/D/B: muat segar, outbox, tiga view × sidebar ==", flush=True)
                scen_fresh_and_views(browser, base, A, ids)
            if want("first"):
                print("== A5/A6: task pertama tiba sesudah panel tampil ==", flush=True)
                scen_first_arrives(browser, base, E)
            if want("edit"):
                print("== C/K/E: edit, '+ Baru', offline ==", flush=True)
                scen_edit(browser, base, A, ids)
            if want("actions"):
                print("== F: Selesai, Hapus, drag Kanban ==", flush=True)
                scen_actions(browser, base, A, ids)
            if want("dark"):
                print("== H: mode gelap ==", flush=True)
                scen_dark(browser, base, A)
            if want("narrow"):
                print("== G: 375 px dan 900 px ==", flush=True)
                scen_narrow(browser, base, A)
            if want("tall"):
                print("== I: task tinggi, bar atas ==", flush=True)
                scen_tall(browser, base, T)
            browser.close()
            if want("flicker"):
                print("== I: kedip di sekitar 760 px (scrollbar klasik) ==", flush=True)
                scen_flicker(pw, base, F)
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

    # Pengecualian konsol untuk 404 hanya mencocokkan path; di sini dipastikan setiap respons >= 400 pada
    # `/api/tasks/<id>` memang `GET` 404 (404 dari PUT/DELETE = bug nyata dan harus menggagalkan run).
    odd = [r for r in BAD_RESPONSES if re.fullmatch(r"/api/tasks/[^/?]+", r[1].split("?")[0])
           and not (r[0] == "GET" and r[2] == 404)]
    check("Z[resp] setiap respons >= 400 pada /api/tasks/<id> adalah GET 404 (confirm-gone pra-ada), bukan PUT/DELETE/lainnya",
          not odd, "aneh=%r semua=%r" % (odd, BAD_RESPONSES))
    print("\nrespons >= 400 dari server lokal (diagnostik): %r" % BAD_RESPONSES)
    print("404 pra-ada yang dikecualikan dari cek konsol (syncpull confirm-gone, GET /api/tasks/:id): %d %r"
          % (len(known_404), known_404))
    print("net::ERR_INTERNET_DISCONNECTED /api/... selama emulasi offline (D, E) yang dikecualikan: %d %r"
          % (len(offline_noise), sorted(set(offline_noise))))
    failed = [r for r in results if not r[1]]
    print("\n%d langkah, %d gagal" % (len(results), len(failed)))
    for r in failed:
        print("  GAGAL:", r[0], "—", r[2])
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
