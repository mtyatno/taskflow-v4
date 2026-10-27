"""E2E modal detail task (TaskDetailBody), disesuaikan dengan redesain detail task 2026-10-26 (bar atas, kisi
properti klik-untuk-ubah dengan popover, simpan otomatis di modal, tab Subtask/Checklist/Catatan/Lampiran; mode
✏️ Edit / 💾 Simpan sudah tidak ada). Tidak dijalankan CI.

Empat kombinasi: 1280 px dan 375 px, masing-masing terang dan gelap. Tiap kombinasi:
  a  buka task dari daftar "Semua Task" → modal tampil, input "Judul task" berisi judul, ✕ ada di ujung KANAN bar
     atas `.td-top` (di dalam modal, di atas judul)
  b  ✕ menutup modal; klik overlay (di luar modal) juga menutup
  d  klik tag → overlay "Task dengan tag" menutupi seluruh `.modal-content` (bounding box sama); × menutup overlay
  e  tab Subtask → ↗ "Buka subtask" pada baris task anak → modal berpindah ke task anak (judul + `#id` anak)
  c  popover Prioritas → "P1 Critical" (tersimpan otomatis) → ✕ → server P1; setelah reload nilai Prioritas
     "P1 Critical" dan chip tag tetap tampil (bug lama 2026-10-26: simpan form dulu menghapus semua tag task)
  f  tidak ada error konsol / pageerror dari aplikasi (permintaan ke host luar diblokir; errornya diabaikan)
  g  (1280 px, user sendiri) tag task tetap saat task disimpan: task dibuat di aplikasi dengan `#tag` di judul →
     ubah judul + Prioritas di modal (simpan otomatis) / body form edit lengkap (TaskFormModal, tidak berubah) /
     chip triage "⚡ Next" di Inbox → tag tetap di lokal, server (setelah sync), dan chip setelah reload; tag yang
     dihapus lewat × "Hapus tag <nama>" lalu simpan perubahan lain (Prioritas) → tidak kembali, juga di server
  h  overlay "Task dengan tag" saat wadah sudah digulir (modal 375 px, panel Live Edit 1280 px): bounding box overlay =
     area terlihat wadah, gulir wadah terkunci selama overlay terbuka, × → overflow semula dan bisa digulir lagi;
     pindah task di panel saat overlay terbuka → overflow aside kembali (bug lama 2026-10-26: overlay di atas isi)

Tag task hidup di IndexedDB (GET /api/tasks/:id/tags dilayani router lokal; tag dari server tidak turun), jadi
skrip memasangnya lewat TF.tagrepo setelah daftar task termuat.

Server lokal dijalankan sendiri (uvicorn webapp:app, DB sementara). Screenshot: temporary_files/e2e_task_detail_body/
(atau $E2E_SHOTS_DIR). Keluar non-zero bila ada langkah gagal.

    python3 temporary_files/e2e_task_detail_body.py
    E2E_ONLY=tags,overlay python3 temporary_files/e2e_task_detail_body.py   # sebagian (combo | tags | overlay)
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
SHOTS = os.environ.get("E2E_SHOTS_DIR") or os.path.join(ROOT, "temporary_files", "e2e_task_detail_body")
PW = "rahasia123"
SECRET = "e2e-task-detail-body-secret"
TOURS = ['dashboard', 'tasks', 'today', 'calendar', 'kanban', 'notes', 'mindmap', 'chat', 'habits', 'habit',
         'settings', 'draw', 'goals', 'review', 'focus', 'workspace', 'slist', 'next', 'inbox', 'all', 'alltasks']
T_PARENT = "Siapkan laporan bulanan"
T_CHILD = "Kumpulkan data penjualan"
T_OTHER = "Kirim laporan ke tim"
TAG = "laporan"
COMBOS = [  # (label, lebar, tinggi, tema)
    ("1280", 1280, 860, "light"),
    ("1280", 1280, 860, "dark"),
    ("375", 375, 812, "light"),
    ("375", 375, 812, "dark"),
]

results = []  # (langkah, ok, keterangan)


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
    return r.json()


def open_app(browser, base, user, w, h, theme, errors, live=None):
    """Konteks baru; error konsol/pageerror milik aplikasi (host lokal) dikumpulkan ke `errors`.
    `live` = nilai awal tf_liveedit ("1" panel Live Edit nyala; None tidak diisi → mati)."""
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
        errors.append("console: " + msg.text[:200] + (" @ " + url if url else ""))

    p.on("console", on_console)
    p.on("pageerror", lambda e: errors.append("pageerror: " + str(e)[:200]))
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
    p.locator(".sidebar-link").first.wait_for(state="attached", timeout=20000)
    return ctx, p


def go_all_tasks(page, mobile):
    """Buka halaman "Semua Task" lewat sidebar (HP: buka menu ☰ dulu)."""
    if mobile:
        page.locator(".mobile-topbar-main button", has_text="☰").first.click()
        page.wait_for_timeout(400)
    else:
        expand = page.locator("button[aria-label='Tampilkan semua menu']")
        if expand.count() and expand.first.is_visible():
            expand.first.click()
    page.locator(".sidebar-link", has_text="Semua Task").first.click()
    page.locator(".task-row").first.wait_for(timeout=15000)


TITLE_INPUT = "input[aria-label='Judul task']"
POP = ".td-pop"


def title_value(page, scope=".modal-content"):
    """Isi input "Judul task" di `scope`; None bila tidak ada."""
    inp = page.locator(scope + " " + TITLE_INPUT)
    return inp.first.input_value() if inp.count() else None


def open_task(page, title):
    page.locator(".task-row", has_text=title).first.click()
    modal = page.locator(".modal-content").first
    modal.wait_for(timeout=10000)
    if not wait_until(lambda: title_value(page) == title, 10):
        raise AssertionError("modal tidak menampilkan judul %r (ada %r)" % (title, title_value(page)))
    return modal


def prop_btn(scope, label):
    """Tombol nilai properti di kisi detail (aria-label "<Label>: <nilai|kosong>")."""
    return scope.locator('button.td-prop-val[aria-label^="%s: "], button.td-prop-add[aria-label^="%s: "]'
                         % (label, label)).first


def pick_priority(page, scope, pri):
    """Popover Prioritas → pilih `pri` ("P1".."P4"); tersimpan otomatis. True bila nilai tombol berubah."""
    prop_btn(scope, "Prioritas").click()
    page.locator(POP).first.wait_for(timeout=3000)
    page.locator(POP + " button", has_text=re.compile(r"^\s*%s\b" % pri)).first.click()
    return wait_until(lambda: prop_btn(scope, "Prioritas").inner_text().strip().startswith(pri + " ")
                      and not page.locator(POP).count(), 3)


def set_title(scope, text):
    """Ganti isi input "Judul task" lalu Enter (simpan judul)."""
    inp = scope.locator(TITLE_INPUT).first
    inp.click()
    inp.fill(text)
    inp.press("Enter")


def seed_local_tags(page, titles, tag):
    """Tag task hidup di IndexedDB (GET /api/tasks/:id/tags dilayani router lokal), bukan dibaca dari server:
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


def modal_count(page):
    return page.locator(".modal-overlay").count()


def wait_closed(page, timeout=5000):
    try:
        page.locator(".modal-overlay").first.wait_for(state="detached", timeout=timeout)
        return True
    except Exception:  # noqa: BLE001
        return False


def close_btn(page):
    return page.locator(".modal-content span").filter(has_text=re.compile(r"^✕$")).first


def shot(page, name):
    path = os.path.join(SHOTS, name)
    page.wait_for_timeout(400)
    page.screenshot(path=path, full_page=False)
    print("  screenshot", os.path.relpath(path, SHOTS), flush=True)


def wait_until(fn, timeout=15, interval=0.4):
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


def server_priority(base, user, task_id):
    return api(base, user, "GET", "/api/tasks/%d" % task_id).get("priority")


def server_task(base, user, task_id):
    return api(base, user, "GET", "/api/tasks/%d" % task_id)


def server_tags(base, user, task_id):
    return sorted(t["name"] for t in api(base, user, "GET", "/api/tasks/%d/tags" % task_id))


def server_row(base, user, title):
    for t in api(base, user, "GET", "/api/tasks?include_done=true"):
        if t["title"] == title:
            return t
    return None


def local_tags(page, task_id):
    """Tag task seperti dilihat aplikasi (router lokal / IndexedDB)."""
    return page.evaluate("""async (id) => (await api.get('/api/tasks/' + id + '/tags')).map(t => t.name).sort()""",
                         task_id)


def local_task(page, task_id):
    """Task seperti dilihat aplikasi (router lokal / IndexedDB), bukan server."""
    return page.evaluate("async (id) => await api.get('/api/tasks/' + id)", task_id)


def chip_tags(scope):
    """Nama tag pada chip di detail task (`scope` = locator modal / panel)."""
    # Sekali baca (all_inner_texts): count() lalu nth(i).inner_text() menunggu hingga 30 dtk bila chip hilang di
    # antaranya (mis. tepat sesudah × diklik) dan menghabiskan jendela wait_until.
    spans = scope.locator("span[title='Klik untuk lihat semua task dengan tag ini']")
    return sorted(re.sub(r"[#×\s]", "", t) for t in spans.all_inner_texts())


def go_sidebar(page, label):
    """Buka halaman lewat sidebar lebar (1280 px)."""
    expand = page.locator("button[aria-label='Tampilkan semua menu']")
    if expand.count() and expand.first.is_visible():
        expand.first.click()
    label_span = page.locator("span", has_text=re.compile("^" + re.escape(label) + "$"))
    page.locator(".sidebar-link").filter(has=label_span).first.click()
    page.locator(".task-row").first.wait_for(timeout=15000)


def reload_app(page):
    page.reload()
    page.locator(".sidebar-link").first.wait_for(state="attached", timeout=20000)


# Bug lama (2026-10-26): menyimpan task lewat form (💾 Simpan modal, form edit lengkap, ubah status GTD dari daftar)
# mengirim judul TANPA #tag → router lokal mengganti tag task dengan [] dan push ikut menghapusnya di server.
TG_MODAL = ("Rapikan arsip kontrak", ["arsip", "legal"], "next")
TG_FORM = ("Perbarui daftar vendor", ["pengadaan", "vendor"], "next")
TG_INBOX = ("Tanya jadwal audit", ["audit", "keuangan"], "inbox")
TG_REMOVE = ("Susun agenda rapat", ["mingguan", "rapat"], "next")


def run_tags(browser, base, user):
    """g: tag task tetap saat task disimpan lewat form; tag yang dihapus lewat chip × tidak kembali (lokal + server)."""
    tag = "g-1280"
    errors = []
    ctx, p = open_app(browser, base, user, 1280, 860, "light", errors)
    try:
        p.wait_for_timeout(1500)  # router lokal siap
        # Seed lewat judul `#tag` saat dibuat di aplikasi (router lokal → tag lokal, push → tag server).
        for title, tags, gtd in (TG_MODAL, TG_FORM, TG_INBOX, TG_REMOVE):
            p.evaluate("async (b) => { await api.post('/api/tasks', b); }",
                       {"title": title + "".join(" #" + t for t in tags), "priority": "P3", "gtd_status": gtd})
        ids = {}
        for title, tags, _gtd in (TG_MODAL, TG_FORM, TG_INBOX, TG_REMOVE):
            row = wait_until(lambda: server_row(base, user, title), 20)
            ids[title] = row["id"] if row else None
        seeded = all(ids.values()) and all(
            wait_until(lambda: server_tags(base, user, ids[t]) == tags and local_tags(p, ids[t]) == tags, 15)
            for t, tags, _g in (TG_MODAL, TG_FORM, TG_INBOX, TG_REMOVE))
        check("%s g0 setup: 4 task bertag dibuat di aplikasi (#tag di judul), tersinkron; tag lokal = server" % tag,
              seeded, repr(ids))
        reload_app(p)
        go_all_tasks(p, False)

        # ── g1. modal: ubah judul (Enter) + Prioritas lewat popover (simpan otomatis) → tag tetap (lokal, server, chip) ──
        title, tags, _g = TG_MODAL
        mid = ids[title]
        new_title = title + " baru"
        modal = open_task(p, title)
        check("%s g1a chip tag tampil sebelum simpan" % tag,
              wait_until(lambda: chip_tags(modal) == tags, 8), repr(chip_tags(modal)))
        set_title(modal, new_title)
        check("%s g1b ubah judul di modal (Enter): judul lokal baru, tag lokal tetap, chip tetap" % tag,
              wait_until(lambda: local_task(p, mid)["title"] == new_title and local_tags(p, mid) == tags
                         and chip_tags(modal) == tags, 6),
              "judul=%r tag=%r chip=%r" % (local_task(p, mid)["title"], local_tags(p, mid), chip_tags(modal)))
        check("%s g1c popover Prioritas → P1 (simpan otomatis)" % tag, pick_priority(p, modal, "P1"),
              prop_btn(modal, "Prioritas").inner_text())
        close_btn(p).click()
        wait_closed(p)
        check("%s g1d setelah ✕: tag lokal tetap" % tag,
              wait_until(lambda: local_tags(p, mid) == tags, 6), repr(local_tags(p, mid)))
        check("%s g1e server: judul baru dan Priority P1 tersimpan DAN tag tetap" % tag,
              wait_until(lambda: server_priority(base, user, mid) == "P1" and server_tags(base, user, mid) == tags
                         and server_task(base, user, mid)["title"] == new_title, 15),
              "pri=%r tag=%r judul=%r" % (server_priority(base, user, mid), server_tags(base, user, mid),
                                         server_task(base, user, mid)["title"]))
        reload_app(p)
        go_all_tasks(p, False)
        modal = open_task(p, new_title)
        check("%s g1f setelah reload: chip tag dan Prioritas 'P1 Critical' tampil" % tag,
              wait_until(lambda: chip_tags(modal) == tags, 8)
              and prop_btn(modal, "Prioritas").inner_text().strip() == "P1 Critical",
              "chip=%r pri=%r" % (chip_tags(modal), prop_btn(modal, "Prioritas").inner_text()))
        close_btn(p).click()
        wait_closed(p)

        # ── g2. form edit lengkap (TaskFormModal): payload sama persis dengan handleSubmit mode edit ──
        # Catatan: tidak ada tombol yang membuka TaskFormModal mode edit (prop onEdit TaskDetailModal tidak
        # dipakai TaskDetailBody), jadi body `{...form, ...recurrencePayload}` dikirim lewat `api.put` aplikasi.
        title, tags, _g = TG_FORM
        fid = ids[title]
        p.evaluate("""async (id) => {
            const task = await api.get('/api/tasks/' + id);
            const form = { title: task.title || "", description: task.description || "", priority: "P1",
              gtd_status: task.gtd_status || "inbox", project: task.project || "", context: task.context || "",
              deadline: task.deadline || "", waiting_for: task.waiting_for || "", list_id: task.list_id || null,
              assigned_to: task.assigned_to || null, progress: task.progress || 0 };
            await api.put('/api/tasks/' + id, { ...form, recurrence_type: null, recurrence_days: null });
        }""", fid)
        check("%s g2a simpan form edit lengkap: tag lokal tetap" % tag,
              wait_until(lambda: local_tags(p, fid) == tags, 6), repr(local_tags(p, fid)))
        check("%s g2b server: P1 DAN tag tetap" % tag,
              wait_until(lambda: server_priority(base, user, fid) == "P1" and server_tags(base, user, fid) == tags, 15),
              "pri=%r tag=%r" % (server_priority(base, user, fid), server_tags(base, user, fid)))

        # ── g3. ubah status GTD dari daftar: chip triage "⚡ Next" di Inbox (App.handleUpdateTaskGtd) ──
        title, tags, _g = TG_INBOX
        iid = ids[title]
        go_sidebar(p, "Inbox")
        row = p.locator(".task-row", has_text=title).first
        row.locator("button.gtd-chip-next").click()
        # tunggu PUT lokal selesai (status lokal berubah) sebelum memeriksa tag, supaya tidak lolos lebih dulu
        moved = wait_until(lambda: local_task(p, iid)["gtd_status"] == "next", 8)
        check("%s g3a chip triage ⚡ Next: status lokal next DAN tag lokal tetap" % tag,
              moved and local_tags(p, iid) == tags, "gtd=%r tag=%r" % (local_task(p, iid)["gtd_status"],
                                                                     local_tags(p, iid)))
        check("%s g3b server: status next DAN tag tetap" % tag,
              wait_until(lambda: server_task(base, user, iid)["gtd_status"] == "next"
                         and server_tags(base, user, iid) == tags, 15),
              "gtd=%r tag=%r" % (server_task(base, user, iid)["gtd_status"], server_tags(base, user, iid)))

        # ── g4. hapus satu tag lewat chip × lalu simpan perubahan lain → tag itu tidak kembali ──
        title, tags, _g = TG_REMOVE
        rid = ids[title]
        go_all_tasks(p, False)
        modal = open_task(p, title)
        wait_until(lambda: chip_tags(modal) == tags, 8)
        modal.locator("button[aria-label='Hapus tag mingguan']").first.click()
        check("%s g4a × 'Hapus tag mingguan' menghapus tag (chip + lokal)" % tag,
              wait_until(lambda: chip_tags(modal) == ["rapat"] and local_tags(p, rid) == ["rapat"], 6),
              "chip=%r lokal=%r" % (chip_tags(modal), local_tags(p, rid)))
        pick_priority(p, modal, "P1")
        close_btn(p).click()
        wait_closed(p)
        check("%s g4b simpan sesudahnya: tag lokal = rapat saja ('mingguan' tidak kembali, 'rapat' tidak hilang)" % tag,
              wait_until(lambda: local_tags(p, rid) == ["rapat"], 6), repr(local_tags(p, rid)))
        check("%s g4c server setelah sync: P1 dan tag = rapat saja" % tag,
              wait_until(lambda: server_priority(base, user, rid) == "P1"
                         and server_tags(base, user, rid) == ["rapat"], 15),
              "pri=%r tag=%r" % (server_priority(base, user, rid), server_tags(base, user, rid)))
        reload_app(p)
        go_all_tasks(p, False)
        modal = open_task(p, title)
        check("%s g4d setelah reload: chip = rapat saja" % tag,
              wait_until(lambda: chip_tags(modal) == ["rapat"], 8), repr(chip_tags(modal)))
        shot(p, "%s_tags_after_reload.png" % tag)
        close_btn(p).click()
        wait_closed(p)

        check("%s f1 tanpa error konsol/pageerror" % tag, not errors, "; ".join(errors[:5]))
    except Exception as e:  # langkah yang melempar = gagal
        import traceback
        traceback.print_exc()
        check("%s exception" % tag, False, "%s: %s" % (type(e).__name__, str(e)[:300]))
        try:
            shot(p, "%s_zz_error.png" % tag)
        except Exception:  # noqa: BLE001
            pass
    finally:
        ctx.close()


def run_combo(browser, base, user, parent, child, label, w, h, theme):
    tag = "%s-%s" % (label, theme)
    mobile = w < 500
    errors = []
    api(base, user, "PUT", "/api/tasks/%d" % parent["id"], json={"priority": "P3"})  # reset tiap kombinasi
    ctx, p = open_app(browser, base, user, w, h, theme, errors)
    try:
        go_all_tasks(p, mobile)
        n_tagged = seed_local_tags(p, [T_PARENT, T_OTHER], TAG)
        check("%s setup: tag #%s dipasang di task induk dan task lain" % (tag, TAG), n_tagged == 2, repr(n_tagged))

        # ── a. modal tampil, ✕ di ujung kanan bar atas ─────────────────────────────
        modal = open_task(p, T_PARENT)
        check("%s a1 modal tampil dengan judul task (input 'Judul task')" % tag,
              modal.is_visible() and title_value(p) == T_PARENT, repr(title_value(p)))
        mb = modal.bounding_box()
        tb = p.locator(".modal-content .td-top").first.bounding_box()
        ib = p.locator(".modal-content " + TITLE_INPUT).first.bounding_box()
        cb = close_btn(p).bounding_box()
        # tombol lain di bar atas (Fokus, Selesai, ⋯) semuanya di kiri ✕
        others = p.evaluate("""() => Array.from(document.querySelectorAll('.modal-content .td-top-actions button'))
            .map(b => b.getBoundingClientRect().right)""")
        in_modal = cb["x"] >= mb["x"] and cb["x"] + cb["width"] <= mb["x"] + mb["width"] + 0.5
        check("%s a2 ✕ di ujung kanan bar atas, di dalam modal, di atas judul" % tag,
              in_modal and all(r <= cb["x"] + 1 for r in others) and cb["y"] >= tb["y"] - 1
              and cb["y"] + cb["height"] <= tb["y"] + tb["height"] + 1 and cb["y"] + cb["height"] <= ib["y"] + 1,
              "✕ x=%.0f..%.0f y=%.0f..%.0f tombol lain kanan=%r td-top y=%.0f..%.0f judul y=%.0f modal %.0f..%.0f" % (
                  cb["x"], cb["x"] + cb["width"], cb["y"], cb["y"] + cb["height"], [round(r) for r in others],
                  tb["y"], tb["y"] + tb["height"], ib["y"], mb["x"], mb["x"] + mb["width"]))
        shot(p, "%s_01_detail.png" % tag)

        # ── b. ✕ dan klik overlay menutup ──────────────────────────────────────────
        close_btn(p).click()
        check("%s b1 ✕ menutup modal" % tag, wait_closed(p))
        open_task(p, T_PARENT)
        p.locator(".modal-overlay").first.click(position={"x": 4, "y": 4})
        check("%s b2 klik overlay menutup modal" % tag, wait_closed(p))

        # ── d. overlay tag menutupi seluruh modal-content ──────────────────────
        modal = open_task(p, T_PARENT)
        chip = modal.locator("span[title='Klik untuk lihat semua task dengan tag ini']").first
        chip.wait_for(timeout=10000)
        # dispatch_event: klik tanpa menggulir modal (scrollTop 0). Kasus wadah sudah digulir: skenario h.
        chip.dispatch_event("click")
        p.get_by_text("Task dengan tag", exact=False).first.wait_for(timeout=10000)
        boxes = p.evaluate("""() => {
            const m = document.querySelector('.modal-content');
            const lab = Array.from(m.querySelectorAll('span')).find(s => (s.textContent || '').startsWith('Task dengan tag'));
            let o = lab;
            while (o && o !== m && getComputedStyle(o).position !== 'absolute') o = o.parentElement;
            if (!o || o === m) return null;
            const r = o.getBoundingClientRect(), q = m.getBoundingClientRect();
            return {o: [r.x, r.y, r.width, r.height], m: [q.x, q.y, q.width, q.height], scroll: m.scrollTop,
                    text: lab.textContent};
        }""")
        ok_box = bool(boxes) and all(abs(a - b) <= 1.5 for a, b in zip(boxes["o"], boxes["m"]))
        check("%s d1 overlay 'Task dengan tag' = bounding box .modal-content" % tag, ok_box, repr(boxes))
        check("%s d2 overlay memuat tag dan task lain bertag sama" % tag,
              boxes and ("#" + TAG) in p.locator(".modal-content").first.inner_text()
              and p.locator(".modal-content", has_text=T_OTHER).count() >= 1)
        shot(p, "%s_02_tag_overlay.png" % tag)
        p.locator(".modal-content button", has_text="\xd7").first.click()
        check("%s d3 × menutup overlay (modal tetap)" % tag,
              wait_until(lambda: not p.get_by_text("Task dengan tag", exact=False).count(), 5) and modal_count(p) == 1)

        # ── e. tab Subtask → ↗ "Buka subtask" membuka task anak ─────────────────────
        tab = modal.locator('[role="tab"]', has_text=re.compile("^Subtask")).first
        tab.click()
        sub = modal.locator(".td-sub-row", has=p.locator(".td-sub-title", has_text=re.compile(
            "^" + re.escape(T_CHILD) + "$"))).first
        sub.scroll_into_view_if_needed()
        check("%s e0 tab Subtask aktif dan memuat baris task anak" % tag,
              tab.get_attribute("aria-selected") == "true" and sub.is_visible())
        sub.locator("button[aria-label='Buka subtask']").click()
        check("%s e1 ↗ Buka subtask → modal berpindah ke task anak" % tag,
              wait_until(lambda: p.locator(".modal-content " + TITLE_INPUT).count() == 1
                         and title_value(p) == T_CHILD, 8), repr(title_value(p)))
        id_text = lambda: p.locator(".modal-content .td-top .td-id").first.inner_text().strip()  # noqa: E731
        check("%s e2 modal task anak menampilkan id anak (#%d) di bar atas" % (tag, child["id"]),
              wait_until(lambda: id_text() == "#%d" % child["id"], 5) and modal_count(p) == 1, repr(id_text()))
        shot(p, "%s_03_child.png" % tag)
        close_btn(p).click()
        wait_closed(p)

        # ── c. popover Prioritas → P1 (simpan otomatis) → ✕ → tag task tetap ───────────
        modal = open_task(p, T_PARENT)
        check("%s c1 nilai Prioritas awal 'P3 …'; detail tanpa select dan tanpa ✏️ Edit / 💾 Simpan" % tag,
              prop_btn(modal, "Prioritas").inner_text().strip().startswith("P3 ") and modal.locator("select").count() == 0
              and "\u270f" not in modal.inner_text() and "\U0001F4BE" not in modal.inner_text(),
              prop_btn(modal, "Prioritas").inner_text())
        prop_btn(modal, "Prioritas").click()
        p.locator(POP).first.wait_for(timeout=3000)
        shot(p, "%s_04_priority_pop.png" % tag)
        p.locator(POP + " button", has_text=re.compile(r"^\s*P1\b")).first.click()
        check("%s c2 pilih P1 → popover tertutup, nilai 'P1 Critical', modal tetap terbuka" % tag,
              wait_until(lambda: prop_btn(modal, "Prioritas").inner_text().strip() == "P1 Critical"
                         and not p.locator(POP).count(), 3) and modal_count(p) == 1,
              prop_btn(modal, "Prioritas").inner_text())
        close_btn(p).click()
        wait_closed(p)
        check("%s c3 server menyimpan P1" % tag, wait_until(lambda: server_priority(base, user, parent["id"]) == "P1", 10),
              repr(server_priority(base, user, parent["id"])))
        p.reload()
        p.locator(".sidebar-link").first.wait_for(state="attached", timeout=20000)
        go_all_tasks(p, mobile)
        modal = open_task(p, T_PARENT)
        check("%s c4 setelah reload nilai Prioritas 'P1 Critical' di detail" % tag,
              prop_btn(modal, "Prioritas").inner_text().strip() == "P1 Critical",
              prop_btn(modal, "Prioritas").inner_text())
        check("%s c5 setelah simpan + reload chip #%s tetap (dulu simpan form menghapus tag)" % (tag, TAG),
              wait_until(lambda: chip_tags(modal) == [TAG], 8), repr(chip_tags(modal)))

        # ── f. konsol bersih ─────────────────────────────────────────────────────
        check("%s f1 tanpa error konsol/pageerror" % tag, not errors, "; ".join(errors[:5]))
    except Exception as e:  # langkah yang melempar = gagal
        import traceback
        traceback.print_exc()
        check("%s exception" % tag, False, "%s: %s" % (type(e).__name__, str(e)[:300]))
        try:
            shot(p, "%s_zz_error.png" % tag)
        except Exception:  # noqa: BLE001
            pass
    finally:
        ctx.close()


# Bug lama (2026-10-26): overlay "Task dengan tag" (`position: absolute`) berjangkar ke wadah gulir (`.modal-content` /
# `aside.tl-live-panel`); dengan `inset: 0` overlay berada di bagian atas isi, jadi saat wadah sudah digulir area yang
# terlihat tidak tertutup.
T_TALL = "Catatan rapat panjang"
T_TALL_OTHER = "Tindak lanjut rapat"
TAG_TALL = "rapat"
OVERLAY_GEOM_JS = """(sel) => {
    const box = document.querySelector(sel);
    if (!box) return null;
    const lab = Array.from(box.querySelectorAll('span')).find(s => (s.textContent || '').startsWith('Task dengan tag'));
    let o = lab;
    while (o && o !== box && getComputedStyle(o).position !== 'absolute') o = o.parentElement;
    const r = box.getBoundingClientRect();
    const vis = [r.x + box.clientLeft, r.y + box.clientTop, box.clientWidth, box.clientHeight];
    const q = o && o !== box ? o.getBoundingClientRect() : null;
    return {o: q ? [q.x, q.y, q.width, q.height] : null, vis: vis, scrollTop: box.scrollTop,
            scrollH: box.scrollHeight, clientH: box.clientHeight, overflowY: getComputedStyle(box).overflowY,
            inline: box.style.overflow, isParent: !!(o && o.parentElement === box)};
}"""


def seed_tall(base, name):
    user = register(base, name)
    desc = "\n".join("Baris catatan nomor %d supaya detail task cukup tinggi untuk digulir." % i for i in range(40))
    t = api(base, user, "POST", "/api/tasks", json={"title": T_TALL, "priority": "P2", "gtd_status": "next",
                                                    "description": desc})
    for i in range(7):
        api(base, user, "POST", "/api/tasks/%d/subtasks" % t["id"], json={"title": "Poin rapat %d" % (i + 1)})
    api(base, user, "POST", "/api/tasks", json={"title": T_TALL_OTHER, "priority": "P3", "gtd_status": "next"})
    return user


def same_box(a, b, tol=1.5):
    return bool(a) and bool(b) and all(abs(x - y) <= tol for x, y in zip(a, b))


def check_overlay_scrolled(p, tag, box_sel, scope):
    """Gulir wadah ke bawah → buka overlay tag → overlay = area terlihat wadah, gulir wadah terkunci → × → normal."""
    p.evaluate("(sel) => { const b = document.querySelector(sel); b.scrollTop = b.scrollHeight; }", box_sel)
    p.wait_for_timeout(300)
    g0 = p.evaluate(OVERLAY_GEOM_JS, box_sel)
    check("%s h1 isi wadah lebih tinggi dari wadah dan sudah digulir ke bawah" % tag,
          g0["scrollH"] > g0["clientH"] + 100 and g0["scrollTop"] > 100, repr(g0))
    chip = p.locator(scope + " span[title='Klik untuk lihat semua task dengan tag ini']").first
    chip.dispatch_event("click")  # chip ada di atas isi (sudah tergulir keluar): klik tanpa menggulir wadah
    p.get_by_text("Task dengan tag", exact=False).first.wait_for(timeout=10000)
    p.wait_for_timeout(300)
    g = p.evaluate(OVERLAY_GEOM_JS, box_sel)
    check("%s h2 overlay 'Task dengan tag' = area terlihat wadah (bounding box) saat wadah tergulir" % tag,
          same_box(g["o"], g["vis"]) and g["isParent"], repr(g))
    check("%s h3 gulir wadah terkunci selama overlay terbuka (overflow hidden, scrollTop tetap)" % tag,
          g["overflowY"] == "hidden" and abs(g["scrollTop"] - g0["scrollTop"]) <= 1, repr(g))
    o = g["o"] or [0, 0, 0, 0]
    p.mouse.move(o[0] + o[2] / 2, o[1] + 30)
    p.mouse.wheel(0, -400)
    p.wait_for_timeout(400)
    g2 = p.evaluate(OVERLAY_GEOM_JS, box_sel)
    check("%s h4 roda tetikus di atas overlay tidak menggulir wadah; overlay tetap menutupi area terlihat" % tag,
          abs(g2["scrollTop"] - g0["scrollTop"]) <= 1 and same_box(g2["o"], g2["vis"]), repr(g2))
    shot(p, "%s_overlay_scrolled.png" % tag)
    p.locator(scope + " button").filter(has_text=re.compile(r"^×$")).last.click()
    closed = wait_until(lambda: not p.get_by_text("Task dengan tag", exact=False).count(), 5)
    g3 = p.evaluate(OVERLAY_GEOM_JS, box_sel)
    check("%s h5 × menutup overlay; overflow wadah kembali semula (inline kosong, auto)" % tag,
          closed and g3["inline"] == "" and g3["overflowY"] == "auto", repr(g3))
    check("%s h5b posisi gulir wadah tidak berubah oleh buka/tutup overlay" % tag,
          abs(g3["scrollTop"] - g0["scrollTop"]) <= 1, "awal=%r sesudah=%r" % (g0["scrollTop"], g3["scrollTop"]))
    up = g3["scrollTop"] > 100  # gulir ke arah yang masih tersedia
    p.mouse.move(g3["vis"][0] + g3["vis"][2] / 2, g3["vis"][1] + g3["vis"][3] / 2)
    p.mouse.wheel(0, -400 if up else 400)
    p.wait_for_timeout(400)
    g4 = p.evaluate(OVERLAY_GEOM_JS, box_sel)
    moved = (g3["scrollTop"] - g4["scrollTop"]) if up else (g4["scrollTop"] - g3["scrollTop"])
    check("%s h6 setelah overlay ditutup wadah bisa digulir lagi (roda tetikus)" % tag,
          moved > 50, "sebelum=%r sesudah=%r" % (g3["scrollTop"], g4["scrollTop"]))


def run_overlay(browser, base, user):
    """h: overlay tag menutupi area terlihat wadah yang sudah digulir — modal 375 px dan panel Live Edit 1280 px."""
    # ── modal 375 px ──
    tag = "h-375-modal"
    errors = []
    ctx, p = open_app(browser, base, user, 375, 812, "light", errors)
    try:
        go_all_tasks(p, True)
        n = seed_local_tags(p, [T_TALL, T_TALL_OTHER], TAG_TALL)
        check("%s setup: tag #%s dipasang di 2 task" % (tag, TAG_TALL), n == 2, repr(n))
        open_task(p, T_TALL)
        p.locator(".modal-content span", has_text="Poin rapat 7").first.wait_for(timeout=10000)
        check_overlay_scrolled(p, tag, ".modal-content", ".modal-content")
        check("%s f1 tanpa error konsol/pageerror" % tag, not errors, "; ".join(errors[:5]))
    except Exception as e:  # noqa: BLE001
        import traceback
        traceback.print_exc()
        check("%s exception" % tag, False, "%s: %s" % (type(e).__name__, str(e)[:300]))
        try:
            shot(p, "%s_zz_error.png" % tag)
        except Exception:  # noqa: BLE001
            pass
    finally:
        ctx.close()

    # ── panel Live Edit 1280 px ──
    tag = "h-1280-panel"
    errors = []
    panel = "aside.tl-live-panel"
    ctx, p = open_app(browser, base, user, 1280, 860, "light", errors, live="1")
    try:
        go_sidebar(p, "Next Actions")
        # IndexedDB per konteks: pasang tag lalu muat ulang supaya panel memuat chip saat task dibuka
        n = seed_local_tags(p, [T_TALL, T_TALL_OTHER], TAG_TALL)
        reload_app(p)
        go_sidebar(p, "Next Actions")
        p.locator(".task-row", has_text=T_TALL).first.click()
        p.locator(panel + " span", has_text="Poin rapat 7").first.wait_for(timeout=10000)
        check("%s setup: tag #%s di 2 task; panel Live Edit menampilkan task tinggi" % (tag, TAG_TALL),
              n == 2 and wait_until(lambda: p.locator(panel + " input[aria-label='Judul task']").first.input_value()
                                    == T_TALL, 8), repr(n))
        p.locator(panel + " span[title='Klik untuk lihat semua task dengan tag ini']").first.wait_for(timeout=10000)
        check_overlay_scrolled(p, tag, panel, panel)
        # overlay terbuka lalu pindah task (TaskDetailBody di-mount ulang, aside tetap) → overflow aside kembali
        p.evaluate("(sel) => { const b = document.querySelector(sel); b.scrollTop = b.scrollHeight; }", panel)
        p.locator(panel + " span[title='Klik untuk lihat semua task dengan tag ini']").first.dispatch_event("click")
        p.get_by_text("Task dengan tag", exact=False).first.wait_for(timeout=10000)
        locked = p.evaluate(OVERLAY_GEOM_JS, panel)["overflowY"] == "hidden"
        p.locator(".task-row", has_text=T_TALL_OTHER).first.click()
        switched = wait_until(lambda: p.locator(panel + " input[aria-label='Judul task']").first.input_value()
                              == T_TALL_OTHER, 8)
        g = p.evaluate(OVERLAY_GEOM_JS, panel)
        check("%s h7 overlay terbuka lalu pindah task: overlay hilang, overflow aside kembali (inline kosong, auto)" % tag,
              locked and switched and g["o"] is None and g["inline"] == "" and g["overflowY"] == "auto", repr(g))
        check("%s f1 tanpa error konsol/pageerror" % tag, not errors, "; ".join(errors[:5]))
    except Exception as e:  # noqa: BLE001
        import traceback
        traceback.print_exc()
        check("%s exception" % tag, False, "%s: %s" % (type(e).__name__, str(e)[:300]))
        try:
            shot(p, "%s_zz_error.png" % tag)
        except Exception:  # noqa: BLE001
            pass
    finally:
        ctx.close()


def want(name):
    """E2E_ONLY=combo,tags,... menjalankan sebagian skenario (debug); kosong = semua."""
    only = [x for x in os.environ.get("E2E_ONLY", "").split(",") if x]
    return not only or name in only


def main():
    os.makedirs(SHOTS, exist_ok=True)
    for f in os.listdir(SHOTS):
        if f.endswith(".png"):
            os.remove(os.path.join(SHOTS, f))
    tmp = tempfile.mkdtemp(prefix="e2e_task_detail_body_")
    proc, base, _db = start_server(tmp)
    print("server", base, "root", ROOT, "SW", SW_VERSION, flush=True)
    try:
        A = register(base, "ana")
        parent = api(base, A, "POST", "/api/tasks", json={
            "title": "%s #%s" % (T_PARENT, TAG), "priority": "P3", "project": "Laporan", "gtd_status": "next",
            "description": "Rekap angka penjualan dan kirim ke tim."})
        child = api(base, A, "POST", "/api/tasks", json={"title": T_CHILD, "parent_id": parent["id"], "priority": "P2"})
        api(base, A, "POST", "/api/tasks", json={"title": "%s #%s" % (T_OTHER, TAG), "priority": "P4"})
        check("setup: task induk (tag #%s), anak, dan task lain bertag sama" % TAG,
              parent["title"] == T_PARENT and child["parent_id"] == parent["id"]
              and [t["name"] for t in api(base, A, "GET", "/api/tasks/%d/tags" % parent["id"])] == [TAG],
              repr((parent["title"], child.get("parent_id"))))
        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            for label, w, h, theme in COMBOS:
                if not want("combo"):
                    break
                print("== %s px %s ==" % (label, theme), flush=True)
                run_combo(browser, base, A, parent, child, label, w, h, theme)
            if want("tags"):
                print("== g: tag tetap saat task disimpan (1280 px) ==", flush=True)
                run_tags(browser, base, register(base, "gita"))
            if want("overlay"):
                print("== h: overlay tag saat wadah tergulir (modal 375 px, panel 1280 px) ==", flush=True)
                run_overlay(browser, base, seed_tall(base, "hana"))
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

    failed = [r for r in results if not r[1]]
    print("\n%d langkah, %d gagal" % (len(results), len(failed)))
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
