"""E2E checklist bertingkat PR B (tampilan): ChecklistTree di detail task (panel Live Edit + modal) dan halaman Fokus,
progress otomatis dari checklist sampai ke daftar task, Timeline, dan perangkat lain. Tidak dijalankan CI.

Spec docs/superpowers/specs/2026-11-06-checklist-bertingkat-design.md §6–§7, §11.4 (C-1…C-9); rencana
docs/superpowers/plans/2026-11-10-checklist-bertingkat-pr-b-ui.md Task 8. Panel Live Edit 1280 px tema terang; modal dan
Fokus 375 px tema gelap (konteks HP: is_mobile + has_touch). Tiap kelompok memakai pengguna sendiri.

  modal  (375 px gelap, modal)
    C-1m tambah butir lewat kotak bawah, Tab → sub butir menjorok (16 px), Shift+Tab kembali; ul > li bersarang;
         target ⠿/lipat/centang/⋯ ≥ 32 px; label "Checklist (N)", bar d/t, dan pill hanya level atas
    C-3  sentuh (CDP Input.dispatchTouchEvent): geser biasa dari ⠿ menggulir modal tanpa menyeret; tahan ≥ 250 ms lalu
         seret induk berturunan → turunan ikut (server), modal tidak tergulir jari, tanpa seleksi teks; gulir otomatis
         di tepi bawah modal
    C-5m centang induk → anak dicoret; pill: slider nonaktif, preset hilang, "Otomatis dari checklist (x/y)";
         "Buka Checklist" pindah tab dan menutup popover
    C-6  hapus induk → konfirmasi "Hapus «judul» beserta N sub butir?" (batal = tetap; terima = terhapus berantai);
         hapus level atas terakhir → slider aktif lagi dengan nilai terakhir (K11), server checklist_total 0;
         menutup popover tanpa geser tidak menyimpan
    C-7  lipat → chip "2/3", tf_check_collapsed; muat ulang → tetap terlipat dengan chip; buka lagi; "Tambah sub butir"
         dan Tab (kotak ubah teks) ke butir terlipat membukanya
  panel  (1280 px terang, panel Live Edit)
    C-1  sama dengan C-1m (menjorok 20 px)
    C-2  seret mouse (geser awal ≥ 6 px) induk berturunan ke bawah butir terakhir → anak ikut; seret dengan geser kanan
         → jadi sub butir (garis penanda berindentasi); Escape membatalkan; muat ulang → urutan bertahan (cek server)
    C-4  klik teks → kotak ubah teks (kursor di akhir); Tab/Shift+Tab di kotak (teks disimpan dulu, kotak tetap terbuka);
         Alt+↑/↓ di kotak dan dari tombol centang; fokus tetap di butir yang sama; pengumuman aria-live; Tab di luar kotak
         isian tidak ditangkap; Tab di butir pertama tetap ditangkap
    C-5  sama dengan C-5m + popover dibuka dengan Enter → "Buka Checklist" mendapat fokus; Enter → tab Checklist terfokus
    M    menu ⋯ (portal body): item "Ubah teks", "Tambah sub butir", "Jadikan sub", "Naikkan level", "Hapus"; aturan
         nonaktif (butir pertama di antara saudara / level atas); setiap aksi; Escape mengembalikan fokus ke ⋯; Tab di
         kotak sub butir tidak ditangkap; ubah teks kosong → teks lama; Escape membatalkan ubah teks
  galat  (1280 px terang, panel Live Edit; spec §7.7)
    G    offline: Alt+↑ tampil langsung lalu kembali ke versi server + toast "Gagal memindah butir"; centang →
         "Gagal mencentang butir"; online lagi → centang berhasil; GET daftar gagal pada task bercheklist → pill tetap
         terkunci ("Otomatis dari checklist" tanpa d/t); galat konsol hanya jaringan terputus / GET yang digagalkan
  focus  (Fokus Hari Ini 375 px gelap)
    C-8  badge level atas; centang → badge + server; kotak tambah Fokus + Tab; pembaruan 15 dtk ditunda selama kotak ubah
         teks terbuka (tanpa GET daftar, teks utuh); butir dari "perangkat lain" (API) muncul setelah kotak ditutup
  sync   (1280 px terang; Timeline ON lewat API)
    C-9  D1 panel: centang → baris daftar task "33%" tanpa muat ulang; record lokal progress/checklist_total diadopsi
         tanpa dirty/rev/updated_at; Timeline (halaman project, Live Edit dimatikan) "33%" → buka task dari baris
         Timeline (modal) → centang → Timeline "67%" tanpa muat ulang; D2 (konteks kedua, IndexedDB sudah berisi task
         0%) → setelah satu siklus refresh otomatis 30 dtk (tanpa panggilan manual) baris "67%"; record D2 diadopsi
         dengan updated_at/rev tetap dan server updated_at tidak naik (bukti TASK_DERIVED)
  Z  per kelompok: tanpa galat konsol/pageerror; aksi checklist tidak memicu PUT /api/tasks/{id} (pantau jaringan) dan
     _outbox tetap 0; akhir: tanpa respons >= 400 dari server lokal

Server lokal dijalankan sendiri (uvicorn webapp:app, DB sementara, port bebas > 8700, python E2E_PYTHON bila diset).
Host luar diblokir, SW diblokir, tf_whatsnew_seen diisi. Screenshot: temporary_files/e2e_checklist_tree/ (atau
$E2E_SHOTS_DIR). Keluar non-zero bila ada cek FAIL.

    E2E_PYTHON=$(which python3) TZ=Asia/Jakarta python3 temporary_files/e2e_checklist_tree.py
    E2E_ONLY=panel,focus E2E_PYTHON=$(which python3) TZ=Asia/Jakarta python3 temporary_files/e2e_checklist_tree.py
"""
import os
import re
import shutil
import socket
import subprocess
import sys
import tempfile
import time

import requests
from playwright.sync_api import sync_playwright

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import e2e_detail_redesign as d  # noqa: E402  (go_all_tasks, click_row, open_task, tab_*, wait_until, …)

ROOT = d.ROOT
SHOTS = os.environ.get("E2E_SHOTS_DIR") or os.path.join(ROOT, "temporary_files", "e2e_checklist_tree")
SECRET = "e2e-checklist-tree-secret"
PANEL, MODAL = d.PANEL, d.MODAL
FOCUS = ".td-tree.is-focus"
MENU = '.td-pop.td-menu[role="menu"]'
PROGRESS_POP = ".td-pop.td-progress-pop"
MENU_ITEMS = ["Ubah teks", "Tambah sub butir", "Jadikan sub", "Naikkan level", "Hapus"]
wait_until = d.wait_until

results = []        # (cek, ok, keterangan)
bad_responses = []  # (perangkat, method, path, status)
all_puts = []       # (perangkat, path) — PUT /api/tasks/<id> yang lewat jaringan


def check(step, ok, note=""):
    results.append((step, bool(ok), note))
    print(("PASS " if ok else "FAIL ") + step + (" — " + note if note else ""), flush=True)
    return ok


# ── server ────────────────────────────────────────────────────────────────────

def free_port(start=8721, end=8999):
    for port in range(start, end):
        s = socket.socket()
        try:
            s.bind(("127.0.0.1", port))
            return port
        except OSError:
            continue
        finally:
            s.close()
    raise RuntimeError("tidak ada port bebas %d-%d" % (start, end))


def launch(tmp):
    port = free_port()
    env = dict(os.environ, DB_PATH=os.path.join(tmp, "e2e.db"), UPLOAD_DIR=os.path.join(tmp, "uploads"),
               WEB_SECRET_KEY=SECRET, TELEGRAM_BOT_TOKEN="")
    os.makedirs(env["UPLOAD_DIR"], exist_ok=True)
    log = open(os.path.join(tmp, "server.log"), "w")
    proc = subprocess.Popen([os.environ.get("E2E_PYTHON") or sys.executable, "-m", "uvicorn", "webapp:app",
                             "--host", "127.0.0.1", "--port", str(port)], cwd=ROOT, env=env, stdout=log,
                            stderr=subprocess.STDOUT)
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


def stop(proc):
    proc.terminate()
    try:
        proc.wait(10)
    except subprocess.TimeoutExpired:
        proc.kill()
        proc.wait(5)


def api(base, user, method, path, **kw):
    r = requests.request(method, base + path, headers={"Authorization": "Bearer " + user["token"]}, timeout=10, **kw)
    r.raise_for_status()
    return r.json() if r.content else None


def mk_task(base, user, title, **kw):
    body = {"title": title, "priority": "P3", "gtd_status": "next"}
    body.update(kw)
    return api(base, user, "POST", "/api/tasks", json=body)["id"]


def mk_items(base, user, tid, rows):
    """rows: [(kunci, judul, kunci_induk|None, selesai?)] → {kunci: id}. Hanya daun yang ditandai selesai (centang
    induk berantai)."""
    ids = {}
    for key, title, parent, _done in rows:
        body = {"title": title}
        if parent:
            body["parent_id"] = ids[parent]
        ids[key] = api(base, user, "POST", "/api/tasks/%d/subtasks" % tid, json=body)["id"]
    for key, _title, _parent, done in rows:
        if done:
            api(base, user, "POST", "/api/subtasks/%d/toggle" % ids[key])
    return ids


def srv_task(base, user, tid):
    return api(base, user, "GET", "/api/tasks/%d" % tid)


def srv_tree(base, user, tid):
    """[(judul, depth, selesai)] pre-order dari server."""
    return [(r["title"], r["depth"], bool(r["is_done"])) for r in api(base, user, "GET", "/api/tasks/%d/subtasks" % tid)]


# ── perangkat ─────────────────────────────────────────────────────────────────

class Dev:
    def __init__(self, ctx, page, label):
        self.ctx, self.p, self.label = ctx, page, label
        self.errors = []
        self.puts = []        # path PUT /api/tasks/<id> yang lewat jaringan
        self.list_gets = []   # (detik, path) GET /api/tasks/<id>/subtasks
        self.dialogs = []     # pesan window.confirm/alert
        self.answers = []     # jawaban berikut untuk dialog (True terima, False batal); kosong = terima


def open_app(browser, base, user, label, w, h, theme, live):
    mobile = w < 500
    ctx = browser.new_context(service_workers="block", viewport={"width": w, "height": h}, device_scale_factor=1,
                              is_mobile=mobile, has_touch=mobile, timezone_id="Asia/Jakarta")
    ctx.add_cookies([{"name": "token", "value": user["token"], "url": base, "httpOnly": True, "sameSite": "Lax"}])
    ctx.route(re.compile(r"^(?!http://127\.0\.0\.1).*$"), lambda r: r.abort())  # font/CDN luar: deterministik
    p = ctx.new_page()
    dev = Dev(ctx, p, label)

    def on_console(msg):
        if msg.type != "error":
            return
        url = (msg.location or {}).get("url", "") or ""
        if url and not url.startswith(base):
            return  # muat sumber luar yang kita blokir
        dev.errors.append("console: " + msg.text[:200] + (" @ " + url.replace(base, "") if url else ""))

    def on_request(r):
        if not r.url.startswith(base):
            return
        path = r.url[len(base):].split("?")[0]
        if r.method == "PUT" and re.fullmatch(r"/api/tasks/\d+", path):
            dev.puts.append(path)
            all_puts.append((label, path))
        if r.method == "GET" and re.fullmatch(r"/api/tasks/\d+/subtasks", path):
            dev.list_gets.append((time.time(), path))

    def on_response(r):
        if r.url.startswith(base) and r.status >= 400:
            bad_responses.append((label, r.request.method, r.url[len(base):], r.status))

    def on_dialog(dlg):
        dev.dialogs.append(dlg.message)
        if dev.answers and dev.answers.pop(0) is False:
            dlg.dismiss()
        else:
            dlg.accept()

    p.on("console", on_console)
    p.on("pageerror", lambda e: dev.errors.append("pageerror: " + str(e)[:200]))
    p.on("request", on_request)
    p.on("response", on_response)
    p.on("dialog", on_dialog)
    p.goto(base + "/manifest.json")
    p.evaluate("""([t, u, tours, theme, sw, live]) => {
        localStorage.setItem('tf_token', t); localStorage.setItem('tf_user_id', String(u));
        for (const pg of tours) localStorage.setItem('tf_tour_' + pg, '1');
        localStorage.setItem('tf_dismiss_onboarding', '1'); localStorage.setItem('tf_onboarded', '1');
        localStorage.setItem('tf_backup_snooze', new Date().toISOString().slice(0, 10));
        localStorage.setItem('tf_whatsnew_seen', sw);
        localStorage.setItem('tf_theme', theme);
        localStorage.setItem('tf_groupby', 'none'); localStorage.setItem('tf_viewmode', 'normal');
        localStorage.setItem('tf_liveedit', live);
    }""", [user["token"], user["id"], d.TOURS + ["today", "project"], theme, d.SW_VERSION, live])
    p.goto(base + "/")
    p.locator(".sidebar-link, .sidebar-rail-btn").first.wait_for(state="attached", timeout=20000)
    return dev


def shot(p, name):
    path = os.path.join(SHOTS, name)
    p.wait_for_timeout(300)
    p.screenshot(path=path, full_page=False)
    print("  screenshot", os.path.relpath(path, ROOT), flush=True)


def fail_exc(tag, e, p=None):
    import traceback
    traceback.print_exc()
    check("%s exception" % tag, False, "%s: %s" % (type(e).__name__, str(e)[:300]))
    if p is not None:
        try:
            shot(p, "zz_error_%s.png" % re.sub(r"\W+", "", tag))
        except Exception:  # noqa: BLE001
            pass


def outbox(p):
    return d.outbox_count(p)


def close_modal(p):
    if d.modal_count(p):
        d.close_btn(p).click()
        d.wait_closed(p)


def wait_rows_loaded(p, scope, timeout=10):
    """Muat pertama ChecklistTree selesai: ada baris, atau teks kosong, dan tidak ada "Memuat…"."""
    return wait_until(lambda: p.locator(scope + " .td-empty", has_text="Memuat").count() == 0
                      and (p.locator(scope + " .td-tree-row").count() > 0
                           or p.locator(scope + " .td-empty", has_text="Belum ada checklist").count() > 0), timeout)


def open_checklist(dev, scope, title):
    """Buka task `title` di panel (Live Edit) atau modal lalu pindah ke tab Checklist."""
    p = dev.p
    if scope == MODAL:
        close_modal(p)
        d.open_task(p, title)
    elif not d.click_row(p, title, 10):
        raise AssertionError("panel tidak menampilkan %r" % title)
    wait_until(lambda: p.locator(scope + ' [role="tab"][aria-selected="true"]').count() == 1, 10)
    d.tab_btn(p, scope, "Checklist").click()
    wait_until(lambda: (d.active_tab(p, scope) or "").startswith("Checklist"), 5)
    wait_rows_loaded(p, scope)


ROWS_JS = """(s) => Array.from(document.querySelectorAll(s + ' .td-tree-row')).map(r => {
    const t = r.querySelector('button.td-tree-text'), e = r.querySelector('input[aria-label="Ubah teks butir"]');
    return [Number(r.getAttribute('data-check-row')),
            Number(getComputedStyle(r).getPropertyValue('--td-depth').trim() || 0),
            t ? t.textContent : (e ? e.value : null), r.classList.contains('is-done')]; })"""


def rows(p, scope):
    """[(id, depth tampil, judul, selesai)] baris yang tampil, urut DOM."""
    return [tuple(r) for r in p.evaluate(ROWS_JS, scope)]


def view(p, scope):
    """[(judul, depth)] untuk dibandingkan dengan server."""
    return [(r[2], r[1]) for r in rows(p, scope)]


def titles(p, scope):
    return [r[2] for r in rows(p, scope)]


def active(p):
    """[id baris, bagian baris (data-check-part) / aria-label / tag] elemen yang sedang fokus."""
    return p.evaluate("""() => { const a = document.activeElement; if (!a) return null;
        const row = a.closest('[data-check-row]');
        return [row ? Number(row.getAttribute('data-check-row')) : null,
                a.getAttribute('data-check-part') || a.getAttribute('aria-label') || a.tagName]; }""")


def row_loc(p, scope, item_id):
    return p.locator(scope + ' [data-check-row="%d"]' % item_id).first


def grip_box(p, scope, item_id):
    return row_loc(p, scope, item_id).locator('[data-check-part="grip"]').bounding_box()


def checkbox(p, scope, title):
    return p.locator(scope + ' .td-tree-row [role="checkbox"][aria-label="%s"]' % title).first


def more_btn(p, scope, title):
    return p.locator(scope + ' button[aria-label="Aksi butir «%s»"]' % title).first


def menu_state(p):
    """[(teks, nonaktif)] item menu ⋯ yang terbuka."""
    return p.evaluate("""(sel) => Array.from(document.querySelectorAll(sel + ' [role="menuitem"]'))
        .map(b => [b.textContent.trim(), b.disabled])""", MENU)


def menu_pick(p, label):
    p.locator(MENU + ' [role="menuitem"]', has_text=label).first.click()


def pill(p, scope):
    return p.locator(scope + " .td-pill").first


def pill_label(p, scope):
    loc = pill(p, scope)
    return loc.get_attribute("aria-label") if loc.count() else None


def labels(p, scope):
    return d.tab_labels(p, scope)


def check_label(p, scope):
    return next((x for x in labels(p, scope) if x.startswith("Checklist")), None)


def bar_text(p, scope):
    loc = p.locator(scope + " .td-check-head > span")
    return loc.first.inner_text().strip() if loc.count() else None


def struck(p, scope, item_id):
    return p.evaluate("""([s, id]) => { const t = document.querySelector(s + ' [data-check-row="' + id + '"] button.td-tree-text');
        return !!t && getComputedStyle(t).textDecorationLine.includes('line-through'); }""", [scope, item_id])


def row_pct(p, title):
    """Angka progress baris daftar task (TaskRow: `task.progress%` apa adanya)."""
    return p.evaluate("""(title) => {
        const r = [...document.querySelectorAll('.task-row')].find(x => x.textContent.includes(title));
        if (!r) return null;
        const s = [...r.querySelectorAll('span')].map(x => x.textContent.trim()).filter(t => /^\\d+%$/.test(t));
        return s.length ? s[s.length - 1] : null; }""", title)


def local_rec(p, server_id):
    """Record mentah task di IndexedDB menurut server_id."""
    return p.evaluate("""async (sid) => {
        const db = await TF.db.openDB();
        const all = await new Promise((res, rej) => {
            const q = db.transaction('tasks', 'readonly').objectStore('tasks').getAll();
            q.onsuccess = () => res(q.result || []); q.onerror = () => rej(q.error);
        });
        const t = all.find(x => !x.deleted && (String(x.server_id) === String(sid) || String(x.id) === String(sid)));
        return t ? {progress: t.progress == null ? null : t.progress,
                    checklist_total: t.checklist_total == null ? null : t.checklist_total,
                    updated_at: t.updated_at, rev: t.rev == null ? null : t.rev, base_rev: t.base_rev == null ? null : t.base_rev,
                    dirty: !!t.dirty} : null; }""", server_id)


def add_box(p, scope):
    return p.locator(scope + ' input[aria-label="Butir checklist baru"]').first


def pad_start(loc):
    return loc.evaluate("e => getComputedStyle(e).paddingInlineStart")


def z_checks(tag, dev):
    """Penutup kelompok: tanpa galat konsol, tanpa PUT /api/tasks/{id}, _outbox kosong."""
    check("%s Z tanpa galat konsol/pageerror" % tag, not dev.errors, "; ".join(dev.errors[:5]))
    check("%s Z aksi checklist tanpa PUT /api/tasks/{id} (jaringan)" % tag, not dev.puts, repr(dev.puts[:8]))
    try:
        n = outbox(dev.p)
        check("%s Z _outbox tetap 0 (record task tidak jadi dirty)" % tag, n == 0, repr(n))
    except Exception as e:  # noqa: BLE001
        check("%s Z _outbox terbaca" % tag, False, str(e)[:200])


# ── C-1 ───────────────────────────────────────────────────────────────────────

def c1_add_tab(dev, scope, kind, base, user, tid, title):
    """C-1: tambah butir, Tab di kotak bawah → sub butir menjorok; label/bar/pill hanya level atas."""
    p = dev.p
    tag = "C-1[%s]" % kind
    indent = 20 if kind == "panel" else 16
    open_checklist(dev, scope, title)
    check("%s awal: 'Belum ada checklist', label 'Checklist', pill manual 'Progress 0%%'" % tag,
          p.locator(scope + " .td-empty", has_text="Belum ada checklist").count() == 1
          and check_label(p, scope) == "Checklist" and pill_label(p, scope) == "Progress 0%",
          "label=%r pill=%r" % (check_label(p, scope), pill_label(p, scope)))
    p.locator(scope + " button.td-add", has_text="+ Tambah butir checklist baru").first.click()
    box = add_box(p, scope)
    box.wait_for(timeout=3000)
    pad0 = pad_start(box)
    for t in ("Siapkan bahan", "Susun jadwal"):
        box.fill(t)
        box.press("Enter")
        wait_until(lambda: t in titles(p, scope), 8)
    box.press("Tab")
    pad1 = pad_start(box)
    check("%s Tab di kotak bawah menjorokkan kotak satu tingkat (%s → %s)" % (tag, pad0, pad1),
          float(pad1.rstrip("px")) - float(pad0.rstrip("px")) == indent
          and p.evaluate("document.activeElement && document.activeElement.getAttribute('aria-label')") == "Butir checklist baru")
    for t in ("Pesan ruang", "Kirim undangan"):
        box.fill(t)
        box.press("Enter")
        wait_until(lambda: t in titles(p, scope), 8)
    box.press("Shift+Tab")
    pad2 = pad_start(box)
    box.fill("Evaluasi acara")
    box.press("Enter")
    want = [("Siapkan bahan", 0), ("Susun jadwal", 0), ("Pesan ruang", 1), ("Kirim undangan", 1), ("Evaluasi acara", 0)]
    ok = wait_until(lambda: view(p, scope) == want, 8)
    check("%s sub butir menjorok di bawah butir terakhir; Shift+Tab kembali level atas (kotak %s)" % (tag, pad2),
          ok and pad2 == pad0, repr(view(p, scope)))
    check("%s kotak tetap terbuka, kosong, terfokus setelah Enter" % tag,
          box.count() == 1 and box.input_value() == ""
          and p.evaluate("document.activeElement && document.activeElement.getAttribute('aria-label')") == "Butir checklist baru")
    pads = p.evaluate("""(s) => Array.from(document.querySelectorAll(s + ' .td-tree-row')).map(r => getComputedStyle(r).paddingInlineStart)""", scope)
    check("%s indentasi baris %d px per tingkat" % (tag, indent),
          pads == ["0px", "0px", "%dpx" % indent, "%dpx" % indent, "0px"], repr(pads))
    sizes = p.evaluate("""(s) => { const r = document.querySelectorAll(s + ' .td-tree-row')[1];
        return ['grip', 'fold', 'check', 'more'].map(k => { const b = r.querySelector('[data-check-part="' + k + '"]');
            if (!b) return null; const q = b.getBoundingClientRect(); return [Math.round(q.width), Math.round(q.height)]; }); }""", scope)
    check("%s target ⠿ / lipat / centang / ⋯ minimal 32×32 px" % tag,
          all(sz and sz[0] >= 32 and sz[1] >= 32 for sz in sizes), repr(sizes))
    nest = p.evaluate("""(s) => Array.from(document.querySelectorAll(s + ' li.td-tree-item')).map(li => {
        const up = li.parentElement && li.parentElement.closest('li.td-tree-item');
        return [li.querySelector('button.td-tree-text').textContent, up ? up.querySelector('button.td-tree-text').textContent : null,
                li.parentElement.tagName]; })""", scope)
    check("%s ul > li bersarang (sub butir di dalam li induknya)" % tag,
          nest == [["Siapkan bahan", None, "UL"], ["Susun jadwal", None, "UL"], ["Pesan ruang", "Susun jadwal", "UL"],
                   ["Kirim undangan", "Susun jadwal", "UL"], ["Evaluasi acara", None, "UL"]], repr(nest))
    srv = srv_tree(base, user, tid)
    check("%s server: pohon sama (depth, induk)" % tag, [(t, dep) for t, dep, _ in srv] == want, repr(srv))
    box.press("Escape")
    check("%s Escape menutup kotak" % tag, wait_until(lambda: add_box(p, scope).count() == 0, 3))
    check("%s label 'Checklist (3)', bar '0/3', pill 'Progress 0%%, otomatis dari checklist' (level atas saja)" % tag,
          wait_until(lambda: check_label(p, scope) == "Checklist (3)" and bar_text(p, scope) == "0/3"
                     and pill_label(p, scope) == "Progress 0%, otomatis dari checklist", 5),
          "label=%r bar=%r pill=%r" % (check_label(p, scope), bar_text(p, scope), pill_label(p, scope)))
    checkbox(p, scope, "Pesan ruang").click()
    wait_until(lambda: dict((r[2], r[3]) for r in rows(p, scope)).get("Pesan ruang") is True, 5)
    p.wait_for_timeout(700)
    check("%s centang sub butir: bar tetap '0/3', pill tetap 0%%, server progress 0" % tag,
          bar_text(p, scope) == "0/3" and pill_label(p, scope) == "Progress 0%, otomatis dari checklist"
          and srv_task(base, user, tid)["progress"] == 0,
          "bar=%r pill=%r" % (bar_text(p, scope), pill_label(p, scope)))
    checkbox(p, scope, "Siapkan bahan").click()
    ok = wait_until(lambda: pill_label(p, scope) == "Progress 33%, otomatis dari checklist" and bar_text(p, scope) == "1/3", 6)
    st = srv_task(base, user, tid)
    check("%s centang level atas: bar '1/3', pill '33%%' (bukan kelipatan 5), server 33 / checklist_total 3" % tag,
          ok and pill(p, scope).inner_text().strip() == "33%" and st["progress"] == 33 and st["checklist_total"] == 3,
          "bar=%r pill=%r server=%r/%r" % (bar_text(p, scope), pill_label(p, scope), st["progress"], st["checklist_total"]))
    shot(p, "c1_%s.png" % kind)


# ── C-2 (panel, mouse) ────────────────────────────────────────────────────────

def mouse_drag(p, scope, item_id, target_id, dx=0, esc=False):
    """Seret ⠿ butir `item_id` dengan mouse ke 4 px di atas tepi bawah baris `target_id` (celah di bawahnya), geser
    horizontal `dx`. Tombol mouse masih ditekan saat kembali (pemanggil memanggil mouse.up)."""
    p.locator(scope + " button.td-add").first.scroll_into_view_if_needed()  # panel: seluruh daftar terlihat dulu
    p.wait_for_timeout(200)
    g = grip_box(p, scope, item_id)
    tgt = row_loc(p, scope, target_id).bounding_box()
    x, y = g["x"] + g["width"] / 2, g["y"] + g["height"] / 2
    p.mouse.move(x, y)
    p.mouse.down()
    p.mouse.move(x, y + 8, steps=2)  # geser awal ≥ 6 px memulai seret mouse
    p.mouse.move(x + dx, tgt["y"] + tgt["height"] - 4, steps=8)
    state = {"line": p.locator(scope + " .td-tree-line").count(),
             "dim": p.locator(scope + " .td-tree-item.is-dragging").count(),
             "line_depth": p.evaluate("""(s) => { const l = document.querySelector(s + ' .td-tree-line');
                 return l ? l.style.getPropertyValue('--td-depth') : null; }""", scope)}
    if esc:
        p.keyboard.press("Escape")
    return state


def c2_drag(dev, base, user, tid, ids, title):
    p = dev.p
    tag = "C-2[panel]"
    scope = PANEL
    open_checklist(dev, scope, title)
    want0 = [("Persiapan", 0), ("Cek alat", 1), ("Cek bahan", 1), ("Eksekusi", 0), ("Evaluasi", 0)]
    check("%s awal pre-order" % tag, view(p, scope) == want0, repr(view(p, scope)))
    k0 = len(dev.puts)
    # (a) induk berturunan ke bawah butir terakhir
    st = mouse_drag(p, scope, ids["pre"], ids["ev"])
    check("%s selama seret: garis penanda tampil, subtree diredupkan (1 li .is-dragging)" % tag,
          st["line"] == 1 and st["dim"] == 1, repr(st))
    shot(p, "c2_drag_line.png")
    p.mouse.up()
    want1 = [("Eksekusi", 0), ("Evaluasi", 0), ("Persiapan", 0), ("Cek alat", 1), ("Cek bahan", 1)]
    ok = wait_until(lambda: [(t, dep) for t, dep, _ in srv_tree(base, user, tid)] == want1, 8)
    check("%s jatuh di bawah 'Evaluasi': turunan ikut (server)" % tag, ok, repr(srv_tree(base, user, tid)))
    check("%s UI = server tanpa garis tersisa" % tag,
          view(p, scope) == want1 and p.locator(scope + " .td-tree-line").count() == 0, repr(view(p, scope)))
    # (b) geser kanan saat seret → jadi sub butir (tingkat dari dx, dibatasi dropRange)
    st = mouse_drag(p, scope, ids["ex"], ids["ev"], dx=44)
    check("%s seret + geser kanan: garis penanda berindentasi tingkat 1" % tag, st["line_depth"] == "1", repr(st))
    p.mouse.up()
    want2 = [("Evaluasi", 0), ("Eksekusi", 1), ("Persiapan", 0), ("Cek alat", 1), ("Cek bahan", 1)]
    ok = wait_until(lambda: [(t, dep) for t, dep, _ in srv_tree(base, user, tid)] == want2, 8)
    check("%s 'Eksekusi' jadi sub butir 'Evaluasi' (server)" % tag, ok and view(p, scope) == want2,
          repr((srv_tree(base, user, tid), view(p, scope))))
    # (c) Escape membatalkan
    st = mouse_drag(p, scope, ids["ev"], ids["cb"], esc=True)
    p.mouse.up()
    p.wait_for_timeout(800)
    check("%s Escape membatalkan seret (tanpa perubahan, garis hilang)" % tag,
          st["line"] == 1 and p.locator(scope + " .td-tree-line").count() == 0
          and [(t, dep) for t, dep, _ in srv_tree(base, user, tid)] == want2 and view(p, scope) == want2,
          repr((st, view(p, scope))))
    shot(p, "c2_after_drop.png")
    # (d) muat ulang → urutan bertahan
    d.reload_app(p)
    d.go_all_tasks(p, False)
    wait_until(lambda: p.locator(".task-row", has_text=title).count() > 0, 15)
    open_checklist(dev, scope, title)
    check("%s muat ulang halaman: urutan dan tingkat bertahan (= server)" % tag,
          wait_until(lambda: view(p, scope) == want2, 8)
          and [(t, dep) for t, dep, _ in srv_tree(base, user, tid)] == want2, repr(view(p, scope)))
    check("%s seret tanpa PUT /api/tasks/{id}" % tag, len(dev.puts) == k0, repr(dev.puts[k0:]))


# ── C-4 (panel, keyboard) ─────────────────────────────────────────────────────

def c4_keys(dev, base, user, tid, ids, title):
    p = dev.p
    tag = "C-4[panel]"
    scope = PANEL
    open_checklist(dev, scope, title)
    ra, rn, rt = ids["rapat"], ids["notulen"], ids["tl"]
    row_loc(p, scope, rn).locator("button.td-tree-text").click()
    ed = p.locator(scope + ' input[aria-label="Ubah teks butir"]')
    ed.wait_for(timeout=3000)
    check("%s klik teks → kotak ubah teks terfokus, kursor di akhir" % tag,
          active(p) == [rn, "edit"] and ed.evaluate("e => e.selectionStart === e.value.length && e.value === 'Notulen'"),
          repr(active(p)))
    ed.press("End")
    ed.type(" final")
    ed.press("Tab")
    ok = wait_until(lambda: view(p, scope) == [("Rapat", 0), ("Notulen final", 1), ("Tindak lanjut", 0)], 5)
    check("%s Tab di kotak ubah teks: jadi sub butir terakhir 'Rapat'; kotak tetap terbuka, fokus di butir sama" % tag,
          ok and active(p) == [rn, "edit"] and ed.input_value() == "Notulen final", repr((view(p, scope), active(p))))
    ok = wait_until(lambda: srv_tree(base, user, tid) == [("Rapat", 0, False), ("Notulen final", 1, False), ("Tindak lanjut", 0, False)], 6)
    check("%s server: teks tersimpan dulu, lalu pindah" % tag, ok, repr(srv_tree(base, user, tid)))
    p.keyboard.press("Shift+Tab")
    ok = wait_until(lambda: view(p, scope) == [("Rapat", 0), ("Notulen final", 0), ("Tindak lanjut", 0)], 5)
    check("%s Shift+Tab: kembali level atas tepat di bawah induk; fokus tetap" % tag,
          ok and active(p) == [rn, "edit"], repr((view(p, scope), active(p))))
    p.keyboard.press("Alt+ArrowDown")
    ok = wait_until(lambda: titles(p, scope) == ["Rapat", "Tindak lanjut", "Notulen final"], 5)
    check("%s Alt+↓ di kotak ubah teks: tukar dengan saudara berikut; fokus tetap" % tag,
          ok and active(p) == [rn, "edit"], repr((titles(p, scope), active(p))))
    p.keyboard.press("Alt+ArrowUp")
    ok = wait_until(lambda: titles(p, scope) == ["Rapat", "Notulen final", "Tindak lanjut"], 5)
    check("%s Alt+↑ di kotak ubah teks: kembali; fokus tetap" % tag, ok and active(p) == [rn, "edit"],
          repr((titles(p, scope), active(p))))
    p.keyboard.press("Enter")
    check("%s Enter menutup kotak, fokus ke teks butir yang sama" % tag,
          wait_until(lambda: active(p) == [rn, "text"], 3) and ed.count() == 0, repr(active(p)))
    checkbox(p, scope, "Tindak lanjut").focus()
    p.keyboard.press("Alt+ArrowUp")
    ok = wait_until(lambda: titles(p, scope) == ["Rapat", "Tindak lanjut", "Notulen final"], 5)
    check("%s Alt+↑ dari tombol centang: pindah, fokus tetap di centang butir itu" % tag,
          ok and active(p) == [rt, "check"], repr((titles(p, scope), active(p))))
    live = p.locator(scope + ' .td-tree [aria-live="polite"]').first.inner_text().strip()
    check("%s pengumuman aria-live" % tag, live == "«Tindak lanjut» dipindah ke tingkat 1, posisi 2 dari 3.", repr(live))
    p.keyboard.press("Tab")
    p.wait_for_timeout(300)
    check("%s Tab di luar kotak isian tidak ditangkap (fokus pindah ke teks, urutan tetap)" % tag,
          active(p) == [rt, "text"] and titles(p, scope) == ["Rapat", "Tindak lanjut", "Notulen final"], repr(active(p)))
    row_loc(p, scope, ra).locator("button.td-tree-text").click()
    ed.wait_for(timeout=3000)
    p.keyboard.press("Tab")
    p.wait_for_timeout(300)
    t_ok = active(p) == [ra, "edit"]
    p.keyboard.press("Shift+Tab")
    p.wait_for_timeout(300)
    check("%s butir pertama level atas: Tab/Shift+Tab tetap ditangkap di kotak ubah teks (tanpa pindah)" % tag,
          t_ok and active(p) == [ra, "edit"] and view(p, scope) == [("Rapat", 0), ("Tindak lanjut", 0), ("Notulen final", 0)],
          repr((active(p), view(p, scope))))
    p.keyboard.press("Escape")
    ok = wait_until(lambda: srv_tree(base, user, tid) == [("Rapat", 0, False), ("Tindak lanjut", 0, False), ("Notulen final", 0, False)], 6)
    check("%s server akhir = UI" % tag, ok and titles(p, scope) == ["Rapat", "Tindak lanjut", "Notulen final"],
          repr(srv_tree(base, user, tid)))
    shot(p, "c4_keyboard.png")


# ── menu ⋯ (panel) ─────────────────────────────────────────────────────────────

def m_menu(dev, base, user, tid, ids, title):
    p = dev.p
    tag = "M[panel]"
    scope = PANEL
    open_checklist(dev, scope, title)

    def open_menu(t):
        more_btn(p, scope, t).click()
        p.locator(MENU).wait_for(timeout=3000)
        return menu_state(p)

    def close_menu(t):
        p.keyboard.press("Escape")
        ok = wait_until(lambda: p.locator(MENU).count() == 0, 3)
        return ok and active(p) and active(p)[1] == "more" and more_btn(p, scope, t).get_attribute("aria-expanded") == "false"

    expect = {"Satu": (True, True), "Satu a": (True, False), "Satu b": (False, False), "Dua": (False, True)}
    for t, (no_sub, no_up) in expect.items():
        st = open_menu(t)
        if t == "Satu":
            check("%s item menu persis dan di dalam portal body (bukan di panel)" % tag,
                  [x[0] for x in st] == MENU_ITEMS and p.locator(scope + " " + MENU).count() == 0, repr(st))
            shot(p, "m_menu_open.png")
        want = [("Ubah teks", False), ("Tambah sub butir", False), ("Jadikan sub", no_sub), ("Naikkan level", no_up),
                ("Hapus", False)]
        check("%s aturan nonaktif ⋯ «%s» (Jadikan sub %s, Naikkan level %s)" % (
            tag, t, "nonaktif" if no_sub else "aktif", "nonaktif" if no_up else "aktif"),
              [tuple(x) for x in st] == want, repr(st))
        check("%s Escape menutup menu, fokus kembali ke ⋯ «%s»" % (tag, t), close_menu(t), repr(active(p)))
    open_menu("Dua")
    menu_pick(p, "Jadikan sub")
    ok = wait_until(lambda: view(p, scope) == [("Satu", 0), ("Satu a", 1), ("Satu b", 1), ("Dua", 1)], 5)
    check("%s Jadikan sub: 'Dua' jadi sub butir terakhir 'Satu'; fokus di ⋯ butir itu" % tag,
          ok and active(p) == [ids["dua"], "more"], repr((view(p, scope), active(p))))
    open_menu("Dua")
    menu_pick(p, "Naikkan level")
    ok = wait_until(lambda: view(p, scope) == [("Satu", 0), ("Satu a", 1), ("Satu b", 1), ("Dua", 0)], 5)
    check("%s Naikkan level: 'Dua' kembali level atas di bawah 'Satu'" % tag, ok, repr(view(p, scope)))
    open_menu("Satu")
    menu_pick(p, "Ubah teks")
    ed = p.locator(scope + ' input[aria-label="Ubah teks butir"]')
    ed.wait_for(timeout=3000)
    check("%s Ubah teks: kotak berisi teks lama, terfokus" % tag,
          ed.input_value() == "Satu" and active(p) == [ids["satu"], "edit"], repr(active(p)))
    ed.press("End")
    ed.type(" baru")
    ed.press("Enter")
    ok = wait_until(lambda: srv_tree(base, user, tid)[0][0] == "Satu baru", 5)
    check("%s Enter menyimpan teks (server)" % tag, ok and titles(p, scope)[0] == "Satu baru", repr(titles(p, scope)))
    open_menu("Satu baru")
    menu_pick(p, "Tambah sub butir")
    sub = p.locator(scope + ' input[aria-label="Sub butir baru"]')
    sub.wait_for(timeout=3000)
    check("%s Tambah sub butir: kotak 'Sub butir baru' (placeholder sama) terfokus" % tag,
          sub.get_attribute("placeholder") == "Sub butir baru"
          and p.evaluate("document.activeElement && document.activeElement.getAttribute('aria-label')") == "Sub butir baru")
    sub.fill("Satu c")
    sub.press("Enter")
    ok = wait_until(lambda: view(p, scope) == [("Satu baru", 0), ("Satu a", 1), ("Satu b", 1), ("Satu c", 1), ("Dua", 0)], 5)
    check("%s Enter: anak terakhir 'Satu baru'; kotak tetap terbuka dan kosong" % tag,
          ok and sub.count() == 1 and sub.input_value() == "", repr(view(p, scope)))
    sub.press("Escape")
    check("%s Escape menutup kotak sub butir" % tag, wait_until(lambda: sub.count() == 0, 3))
    open_menu("Dua")
    menu_pick(p, "Tambah sub butir")
    sub.wait_for(timeout=3000)
    p.keyboard.press("Tab")
    check("%s Tab di kotak sub butir kosong tidak ditangkap: fokus keluar, kotak tertutup (blur saat kosong)" % tag,
          wait_until(lambda: sub.count() == 0, 3) and p.evaluate(
              "document.activeElement && document.activeElement.getAttribute('aria-label')") != "Sub butir baru",
          repr(active(p)))
    n_items = len(srv_tree(base, user, tid))
    row_loc(p, scope, ids["dua"]).locator("button.td-tree-text").click()
    ed.wait_for(timeout=3000)
    ed.fill("")
    ed.press("Enter")
    p.wait_for_timeout(600)
    check("%s ubah teks dikosongkan + Enter: kembali ke teks lama, butir tidak terhapus" % tag,
          ed.count() == 0 and "Dua" in titles(p, scope) and [t for t, _d, _x in srv_tree(base, user, tid)].count("Dua") == 1
          and len(srv_tree(base, user, tid)) == n_items, repr(titles(p, scope)))
    row_loc(p, scope, ids["dua"]).locator("button.td-tree-text").click()
    ed.wait_for(timeout=3000)
    ed.type(" batal")
    ed.press("Escape")
    p.wait_for_timeout(600)
    check("%s Escape membatalkan ubah teks (UI dan server tetap 'Dua')" % tag,
          ed.count() == 0 and titles(p, scope)[-1] == "Dua" and srv_tree(base, user, tid)[-1][0] == "Dua",
          repr(titles(p, scope)))
    n_dlg = len(dev.dialogs)
    open_menu("Satu b")
    menu_pick(p, "Hapus")
    ok = wait_until(lambda: "Satu b" not in titles(p, scope), 5)
    check("%s Hapus butir tanpa turunan: langsung terhapus tanpa konfirmasi" % tag,
          ok and len(dev.dialogs) == n_dlg, repr(dev.dialogs[n_dlg:]))
    want = [("Satu baru", 0, False), ("Satu a", 1, False), ("Satu c", 1, False), ("Dua", 0, False)]
    check("%s server akhir = UI" % tag, wait_until(lambda: srv_tree(base, user, tid) == want, 5)
          and view(p, scope) == [(t, dep) for t, dep, _ in want], repr(srv_tree(base, user, tid)))


# ── C-5 ───────────────────────────────────────────────────────────────────────

def c5_lock(dev, scope, kind, base, user, tid, ids, title):
    p = dev.p
    tag = "C-5[%s]" % kind
    open_checklist(dev, scope, title)
    check("%s pill terkunci sejak dimuat" % tag,
          wait_until(lambda: pill_label(p, scope) == "Progress 0%, otomatis dari checklist", 5), repr(pill_label(p, scope)))
    checkbox(p, scope, "Cetak materi").click()
    ok = wait_until(lambda: all(r[3] for r in rows(p, scope) if r[2].startswith("Cetak")), 6)
    check("%s centang induk → anak ikut tercentang dan dicoret" % tag,
          ok and struck(p, scope, ids["c1"]) and struck(p, scope, ids["c2"])
          and checkbox(p, scope, "Cetak agenda").get_attribute("aria-checked") == "true",
          repr(rows(p, scope)))
    check("%s server: induk + turunan selesai" % tag,
          srv_tree(base, user, tid) == [("Siapkan ruang", 0, False), ("Uji proyektor", 0, False), ("Cetak materi", 0, True),
                                        ("Cetak agenda", 1, True), ("Cetak daftar hadir", 1, True)], repr(srv_tree(base, user, tid)))
    check("%s pill 'Progress 33%%, otomatis dari checklist'" % tag,
          wait_until(lambda: pill_label(p, scope) == "Progress 33%, otomatis dari checklist", 5)
          and pill(p, scope).inner_text().strip() == "33%", repr(pill_label(p, scope)))
    d.tab_btn(p, scope, "Subtask").click()
    wait_until(lambda: (d.active_tab(p, scope) or "").startswith("Subtask"), 3)
    pill(p, scope).click()
    pop = p.locator(PROGRESS_POP)
    pop.wait_for(timeout=3000)
    rng = pop.locator('input[type="range"]')
    note = pop.locator(".td-progress-note")
    check("%s popover: slider nonaktif (nilai 33), preset tersembunyi, 'Otomatis dari checklist (1/3)'" % tag,
          rng.is_disabled() and rng.input_value() == "33" and pop.locator(".td-presets").count() == 0
          and note.count() == 1 and note.inner_text().strip() == "Otomatis dari checklist (1/3)",
          repr(pop.inner_text()))
    shot(p, "c5_%s_popover.png" % kind)
    pop.locator("button", has_text="Buka Checklist").click()
    ok = wait_until(lambda: d.active_tab(p, scope) == "Checklist (3)" and p.locator(".td-pop").count() == 0, 3)
    check("%s 'Buka Checklist' (klik): tab Checklist aktif, popover tertutup" % tag, ok, repr(d.active_tab(p, scope)))
    if kind == "panel":
        d.tab_btn(p, scope, "Subtask").click()
        wait_until(lambda: (d.active_tab(p, scope) or "").startswith("Subtask"), 3)
        pill(p, scope).focus()
        p.keyboard.press("Enter")
        pop.wait_for(timeout=3000)
        ae = p.evaluate("() => { const a = document.activeElement; return a ? [a.textContent.trim(), !!a.closest('.td-progress-pop')] : null; }")
        check("%s popover dibuka dengan Enter → 'Buka Checklist' mendapat fokus keyboard" % tag,
              ae == ["Buka Checklist", True], repr(ae))
        p.keyboard.press("Enter")
        ok = wait_until(lambda: p.locator(".td-pop").count() == 0 and p.evaluate(
            "() => { const a = document.activeElement; return !!a && a.getAttribute('role') === 'tab' && a.getAttribute('aria-selected') === 'true' && a.textContent.startsWith('Checklist'); }"), 3)
        check("%s Enter → tab Checklist aktif dan terfokus" % tag, ok,
              repr(p.evaluate("() => document.activeElement && document.activeElement.outerHTML.slice(0, 120)")))


# ── C-6 (modal) ───────────────────────────────────────────────────────────────

def c6_delete(dev, base, user, tid, ids, title):
    p = dev.p
    tag = "C-6[modal]"
    scope = MODAL
    open_checklist(dev, scope, title)
    u0 = srv_task(base, user, tid)["updated_at"]
    check("%s awal: pill 33%% (1/3), 6 baris" % tag,
          wait_until(lambda: pill_label(p, scope) == "Progress 33%, otomatis dari checklist", 5) and len(rows(p, scope)) == 6,
          repr((pill_label(p, scope), view(p, scope))))
    n = len(dev.dialogs)
    dev.answers.append(False)
    more_btn(p, scope, "Bab 1").click()
    menu_pick(p, "Hapus")
    p.wait_for_timeout(800)
    check("%s hapus induk → konfirmasi 'Hapus «Bab 1» beserta 3 sub butir?'; batal → tidak terhapus" % tag,
          dev.dialogs[n:] == ["Hapus «Bab 1» beserta 3 sub butir?"] and len(rows(p, scope)) == 6
          and len(srv_tree(base, user, tid)) == 6, repr((dev.dialogs[n:], view(p, scope))))
    more_btn(p, scope, "Bab 1").click()
    menu_pick(p, "Hapus")
    ok = wait_until(lambda: titles(p, scope) == ["Bab 2", "Bab 3"], 6)
    check("%s konfirmasi diterima → induk + 3 turunan terhapus (UI dan server)" % tag,
          ok and dev.dialogs[n + 1:] == ["Hapus «Bab 1» beserta 3 sub butir?"]
          and srv_tree(base, user, tid) == [("Bab 2", 0, True), ("Bab 3", 0, False)],
          repr((titles(p, scope), srv_tree(base, user, tid))))
    check("%s pill 50%% (1/2), label 'Checklist (2)'" % tag,
          wait_until(lambda: pill_label(p, scope) == "Progress 50%, otomatis dari checklist"
                     and check_label(p, scope) == "Checklist (2)", 5), repr((pill_label(p, scope), check_label(p, scope))))
    for t, want_pill in (("Bab 3", "Progress 100%, otomatis dari checklist"), ("Bab 2", "Progress 100%")):
        more_btn(p, scope, t).click()
        menu_pick(p, "Hapus")
        wait_until(lambda: t not in titles(p, scope), 5)
        wait_until(lambda: pill_label(p, scope) == want_pill, 5)
    st = srv_task(base, user, tid)
    check("%s level atas terakhir dihapus: pill manual 'Progress 100%%' (nilai terakhir, bukan 40 awal / 0); server "
          "progress 100, checklist_total 0" % tag,
          pill_label(p, scope) == "Progress 100%" and st["progress"] == 100 and st["checklist_total"] == 0,
          repr((pill_label(p, scope), st["progress"], st["checklist_total"])))
    check("%s daftar kosong: 'Belum ada checklist', label 'Checklist'" % tag,
          p.locator(scope + " .td-empty", has_text="Belum ada checklist").count() == 1 and check_label(p, scope) == "Checklist",
          repr(check_label(p, scope)))
    pill(p, scope).click()
    pop = p.locator(PROGRESS_POP)
    pop.wait_for(timeout=3000)
    rng = pop.locator('input[type="range"]')
    check("%s slider aktif lagi dengan nilai 100, preset kembali, tanpa keterangan otomatis" % tag,
          not rng.is_disabled() and rng.input_value() == "100" and pop.locator(".td-presets").count() == 1
          and pop.locator(".td-progress-note").count() == 0, repr(pop.inner_text()))
    shot(p, "c6_slider_manual_lagi.png")
    p.keyboard.press("Escape")
    wait_until(lambda: p.locator(".td-pop").count() == 0, 3)
    p.wait_for_timeout(1500)
    check("%s menutup popover tanpa geser: server updated_at tetap" % tag,
          srv_task(base, user, tid)["updated_at"] == u0, repr((u0, srv_task(base, user, tid)["updated_at"])))


# ── C-7 (modal) ───────────────────────────────────────────────────────────────

def c7_fold(dev, base, user, tid, ids, title):
    p = dev.p
    tag = "C-7[modal]"
    scope = MODAL
    open_checklist(dev, scope, title)
    fold = p.locator(scope + ' button[aria-label="Lipat sub butir «Induk lipat»"]')
    check("%s tombol lipat aria-expanded=true; 5 baris" % tag,
          fold.count() == 1 and fold.get_attribute("aria-expanded") == "true" and len(rows(p, scope)) == 5)
    fold.click()
    unfold = p.locator(scope + ' button[aria-label="Buka sub butir «Induk lipat»"]')
    chip = p.locator(scope + " .td-tree-chip")
    ok = wait_until(lambda: titles(p, scope) == ["Induk lipat", "Butir lain"], 3)
    check("%s lipat: anak tersembunyi, chip '2/3', aria-expanded=false" % tag,
          ok and chip.count() == 1 and chip.first.inner_text().strip() == "2/3"
          and unfold.get_attribute("aria-expanded") == "false", repr((titles(p, scope), chip.all_inner_texts())))
    stored = p.evaluate("localStorage.getItem('tf_check_collapsed')")
    check("%s tf_check_collapsed = [id induk]" % tag, stored == "[%d]" % ids["induk"], repr(stored))
    close_modal(p)
    d.reload_app(p)
    d.go_all_tasks(p, True)
    wait_until(lambda: p.locator(".task-row", has_text=title).count() > 0, 15)
    open_checklist(dev, scope, title)
    ok = wait_until(lambda: titles(p, scope) == ["Induk lipat", "Butir lain"], 5)
    check("%s muat ulang: tetap terlipat dengan chip '2/3'" % tag,
          ok and unfold.count() == 1 and chip.count() == 1 and chip.first.inner_text().strip() == "2/3",
          repr((titles(p, scope), chip.all_inner_texts())))
    shot(p, "c7_terlipat_setelah_muat_ulang.png")
    unfold.click()
    check("%s buka lagi: 5 baris, chip hilang" % tag,
          wait_until(lambda: len(rows(p, scope)) == 5 and chip.count() == 0, 3)
          and p.evaluate("localStorage.getItem('tf_check_collapsed')") == "[]", repr(titles(p, scope)))
    # §6.4: menambah sub butir ke butir terlipat membukanya.
    fold.click()
    wait_until(lambda: len(rows(p, scope)) == 2, 3)
    more_btn(p, scope, "Induk lipat").click()
    menu_pick(p, "Tambah sub butir")
    sub = p.locator(scope + ' input[aria-label="Sub butir baru"]')
    sub.wait_for(timeout=3000)
    check("%s ⋯ → Tambah sub butir pada butir terlipat: butir dibuka" % tag,
          wait_until(lambda: len(rows(p, scope)) == 5 and fold.count() == 1, 3)
          and p.evaluate("localStorage.getItem('tf_check_collapsed')") == "[]", repr(titles(p, scope)))
    sub.fill("Anak 4")
    sub.press("Enter")
    ok = wait_until(lambda: view(p, scope)[:5] == [("Induk lipat", 0), ("Anak 1", 1), ("Anak 2", 1), ("Anak 3", 1),
                                                   ("Anak 4", 1)], 5)
    check("%s 'Anak 4' jadi anak terakhir" % tag, ok, repr(view(p, scope)))
    sub.press("Escape")
    # §7.2: Tab di kotak ubah teks menjadikan butir anak terakhir saudara sebelumnya, yang dibuka bila terlipat.
    fold.click()
    wait_until(lambda: len(rows(p, scope)) == 2, 3)
    row_loc(p, scope, ids["lain"]).locator("button.td-tree-text").click()
    ed = p.locator(scope + ' input[aria-label="Ubah teks butir"]')
    ed.wait_for(timeout=3000)
    ed.press("Tab")
    want = [("Induk lipat", 0), ("Anak 1", 1), ("Anak 2", 1), ("Anak 3", 1), ("Anak 4", 1), ("Butir lain", 1)]
    ok = wait_until(lambda: view(p, scope) == want, 5)
    check("%s Tab ke butir terlipat: jadi anak terakhirnya, induk dibuka, kotak tetap terbuka di butir itu" % tag,
          ok and active(p) == [ids["lain"], "edit"] and p.evaluate("localStorage.getItem('tf_check_collapsed')") == "[]",
          repr((view(p, scope), active(p))))
    ed.press("Enter")
    check("%s server = UI" % tag, wait_until(lambda: [(t, dep) for t, dep, _ in srv_tree(base, user, tid)] == want, 5),
          repr(srv_tree(base, user, tid)))


# ── C-3 (modal, sentuh) ───────────────────────────────────────────────────────

def c3_touch(dev, base, user, tid, ids, title):
    p = dev.p
    tag = "C-3[modal 375 sentuh]"
    scope = MODAL
    open_checklist(dev, scope, title)
    cdp = dev.ctx.new_cdp_session(p)
    mc = p.locator(MODAL).first

    def touch(kind, x=0, y=0):
        cdp.send("Input.dispatchTouchEvent", {"type": kind, "touchPoints": [] if kind == "touchEnd" else [{"x": x, "y": y}]})

    def order():
        return [t for t, _dep, _done in srv_tree(base, user, tid)]

    # (a) geser biasa dari ⠿ tanpa menahan → modal tergulir, tanpa seret
    row_loc(p, scope, ids["i5"]).scroll_into_view_if_needed()
    p.wait_for_timeout(300)
    g = grip_box(p, scope, ids["i5"])
    st0 = mc.evaluate("e => e.scrollTop")
    order0 = order()
    x, y = g["x"] + g["width"] / 2, g["y"] + g["height"] / 2
    touch("touchStart", x, y)
    line_seen = False
    for i in range(1, 9):
        touch("touchMove", x, y - i * 15)
        p.wait_for_timeout(16)
        line_seen = line_seen or p.locator(scope + " .td-tree-line").count() > 0
    touch("touchEnd")
    p.wait_for_timeout(600)
    st1 = mc.evaluate("e => e.scrollTop")
    check("%s geser biasa dari ⠿ = gulir modal, tidak menyeret" % tag,
          st1 > st0 + 20 and not line_seen and order() == order0, "scrollTop %s → %s, garis=%s" % (st0, st1, line_seen))
    # (b) tahan 400 ms lalu seret induk berturunan (Langkah 03 + anak) ke atas Langkah 01. Langkah 01 di tengah modal
    # supaya penunjuk jauh dari tepi (tanpa gulir otomatis).
    row_loc(p, scope, ids["i1"]).evaluate("e => e.scrollIntoView({block: 'center'})")
    p.wait_for_timeout(300)
    g = grip_box(p, scope, ids["i3"])
    tgt = row_loc(p, scope, ids["i1"]).bounding_box()
    x, y = g["x"] + g["width"] / 2, g["y"] + g["height"] / 2
    st0 = mc.evaluate("e => e.scrollTop")
    touch("touchStart", x, y)
    p.wait_for_timeout(400)
    ty = tgt["y"] + 4
    for i in range(1, 9):
        touch("touchMove", x, y + (ty - y) * i / 8)
        p.wait_for_timeout(30)
    dragging = p.locator(scope + " .td-tree-line").count() == 1 and p.locator(scope + " .td-tree-item.is-dragging").count() == 1
    st1 = mc.evaluate("e => e.scrollTop")
    shot(p, "c3_touch_drag_line.png")
    touch("touchEnd")
    want = ["Langkah 00", "Langkah 03", "Langkah 03 rinci", "Langkah 01", "Langkah 02", "Langkah 04"]
    ok = wait_until(lambda: order()[:6] == want, 8)
    check("%s tahan lalu seret: 'Langkah 03' + anaknya pindah ke atas 'Langkah 01' (server)" % tag,
          dragging and ok, repr((dragging, order()[:7])))
    check("%s UI = server; anak tetap menjorok" % tag,
          wait_until(lambda: view(p, scope)[:6] == [(t, 1 if t.endswith("rinci") else 0) for t in want], 5), repr(view(p, scope)[:7]))
    check("%s selama seret modal tidak tergulir jari" % tag, abs(st1 - st0) < 2, "%s → %s" % (st0, st1))
    sel = p.evaluate("String(window.getSelection())")
    check("%s tanpa seleksi teks liar" % tag, sel == "", repr(sel))
    # (c) gulir otomatis di tepi bawah wadah gulir (modal)
    mc.evaluate("e => { e.scrollTop = 0; }")
    p.wait_for_timeout(200)
    row_loc(p, scope, ids["i0"]).scroll_into_view_if_needed()
    p.wait_for_timeout(200)
    st0 = mc.evaluate("e => e.scrollTop")
    g = grip_box(p, scope, ids["i0"])
    mrect = mc.bounding_box()
    x, y = g["x"] + g["width"] / 2, g["y"] + g["height"] / 2
    touch("touchStart", x, y)
    p.wait_for_timeout(400)
    by = mrect["y"] + mrect["height"] - 10
    for i in range(1, 7):
        touch("touchMove", x, y + (by - y) * i / 6)
        p.wait_for_timeout(30)
    p.wait_for_timeout(1200)
    st1 = mc.evaluate("e => e.scrollTop")
    touch("touchEnd")
    p.wait_for_timeout(800)
    check("%s seret di tepi bawah modal: gulir otomatis" % tag, st1 > st0 + 50, "%s → %s" % (st0, st1))
    check("%s pembongkaran bersih: tanpa garis/redup tersisa" % tag,
          p.locator(scope + " .td-tree-line").count() == 0 and p.locator(scope + " .td-tree-item.is-dragging").count() == 0)


# ── kelompok ──────────────────────────────────────────────────────────────────

def group_modal(browser, base):
    user = d.register(base, "ckm")
    t_c1 = mk_task(base, user, "Catat kebutuhan acara")
    t_c3 = mk_task(base, user, "Urutkan langkah panjang")
    rows3 = [("i%d" % i, "Langkah %02d" % i, None, False) for i in range(24)]
    rows3.insert(4, ("i3c", "Langkah 03 rinci", "i3", False))
    ids3 = mk_items(base, user, t_c3, rows3)
    t_c5 = mk_task(base, user, "Cek kunci progres")
    ids5 = mk_items(base, user, t_c5, [("s", "Siapkan ruang", None, False), ("u", "Uji proyektor", None, False),
                                       ("c", "Cetak materi", None, False), ("c1", "Cetak agenda", "c", False),
                                       ("c2", "Cetak daftar hadir", "c", False)])
    t_c6 = mk_task(base, user, "Hapus bab lama")
    api(base, user, "PUT", "/api/tasks/%d" % t_c6, json={"progress": 40})
    ids6 = mk_items(base, user, t_c6, [("b1", "Bab 1", None, False), ("b11", "Bab 1.1", "b1", False),
                                       ("b12", "Bab 1.2", "b1", False), ("b12a", "Bab 1.2.a", "b12", False),
                                       ("b2", "Bab 2", None, True), ("b3", "Bab 3", None, False)])
    t_c7 = mk_task(base, user, "Lipat butir induk")
    ids7 = mk_items(base, user, t_c7, [("induk", "Induk lipat", None, False), ("a1", "Anak 1", "induk", True),
                                       ("a2", "Anak 2", "induk", True), ("a3", "Anak 3", "induk", False),
                                       ("lain", "Butir lain", None, False)])
    dev = open_app(browser, base, user, "modal375", 375, 812, "dark", "0")
    p = dev.p
    try:
        d.go_all_tasks(p, True)
        wait_until(lambda: p.locator(".task-row", has_text="Lipat butir induk").count() > 0, 15)
        p.wait_for_timeout(800)
        for name, fn in (("C-1m", lambda: c1_add_tab(dev, MODAL, "modal", base, user, t_c1, "Catat kebutuhan acara")),
                         ("C-3", lambda: c3_touch(dev, base, user, t_c3, ids3, "Urutkan langkah panjang")),
                         ("C-5m", lambda: c5_lock(dev, MODAL, "modal", base, user, t_c5, ids5, "Cek kunci progres")),
                         ("C-6", lambda: c6_delete(dev, base, user, t_c6, ids6, "Hapus bab lama")),
                         ("C-7", lambda: c7_fold(dev, base, user, t_c7, ids7, "Lipat butir induk"))):
            print("== %s ==" % name, flush=True)
            try:
                fn()
            except Exception as e:  # noqa: BLE001  langkah yang melempar = gagal
                fail_exc(name, e, p)
        close_modal(p)
        z_checks("modal375", dev)
    finally:
        dev.ctx.close()


def group_panel(browser, base):
    user = d.register(base, "ckp")
    t_c1 = mk_task(base, user, "Susun rencana rilis")
    t_c2 = mk_task(base, user, "Atur urutan persiapan")
    ids2 = mk_items(base, user, t_c2, [("pre", "Persiapan", None, False), ("ca", "Cek alat", "pre", False),
                                       ("cb", "Cek bahan", "pre", False), ("ex", "Eksekusi", None, False),
                                       ("ev", "Evaluasi", None, False)])
    t_c4 = mk_task(base, user, "Rapikan notulen rapat")
    ids4 = mk_items(base, user, t_c4, [("rapat", "Rapat", None, False), ("notulen", "Notulen", None, False),
                                       ("tl", "Tindak lanjut", None, False)])
    t_m = mk_task(base, user, "Uji menu butir")
    idsm = mk_items(base, user, t_m, [("satu", "Satu", None, False), ("sa", "Satu a", "satu", False),
                                      ("sb", "Satu b", "satu", False), ("dua", "Dua", None, False)])
    t_c5 = mk_task(base, user, "Periksa progres otomatis")
    ids5 = mk_items(base, user, t_c5, [("s", "Siapkan ruang", None, False), ("u", "Uji proyektor", None, False),
                                       ("c", "Cetak materi", None, False), ("c1", "Cetak agenda", "c", False),
                                       ("c2", "Cetak daftar hadir", "c", False)])
    dev = open_app(browser, base, user, "panel1280", 1280, 860, "light", "1")
    p = dev.p
    try:
        d.go_all_tasks(p, False)
        wait_until(lambda: p.locator(".task-row", has_text="Periksa progres otomatis").count() > 0, 15)
        p.wait_for_timeout(800)
        for name, fn in (("C-1", lambda: c1_add_tab(dev, PANEL, "panel", base, user, t_c1, "Susun rencana rilis")),
                         ("C-2", lambda: c2_drag(dev, base, user, t_c2, ids2, "Atur urutan persiapan")),
                         ("C-4", lambda: c4_keys(dev, base, user, t_c4, ids4, "Rapikan notulen rapat")),
                         ("M", lambda: m_menu(dev, base, user, t_m, idsm, "Uji menu butir")),
                         ("C-5", lambda: c5_lock(dev, PANEL, "panel", base, user, t_c5, ids5, "Periksa progres otomatis"))):
            print("== %s ==" % name, flush=True)
            try:
                fn()
            except Exception as e:  # noqa: BLE001
                fail_exc(name, e, p)
        z_checks("panel1280", dev)
    finally:
        dev.ctx.close()


def group_focus(browser, base):
    tag = "C-8[fokus 375]"
    user = d.register(base, "ckf")
    title = "Tinjau draf proposal"
    tid = mk_task(base, user, title, priority="P1", deadline=time.strftime("%Y-%m-%d"))
    ids = mk_items(base, user, tid, [("a", "Alpha", None, False), ("a1", "Alpha satu", "a", False),
                                     ("a1x", "Alpha satu x", "a1", True), ("a2", "Alpha dua", "a", False),
                                     ("b", "Beta", None, False), ("c", "Gamma", None, False)])
    dev = open_app(browser, base, user, "fokus375", 375, 812, "dark", "0")
    p = dev.p
    try:
        p.locator(".mobile-topbar-main button", has_text="☰").first.click()
        p.wait_for_timeout(400)
        p.locator(".sidebar-link", has_text="Fokus Hari Ini").first.click()
        card = p.locator(".ftask", has_text=title).first
        card.wait_for(timeout=20000)
        badge = card.locator('.ftask-count[title="Checklist"]')
        btxt = lambda: badge.first.inner_text().strip() if badge.count() else None  # noqa: E731
        check("%s badge level atas '0/3' (semua butir 1/6)" % tag, wait_until(lambda: btxt() == "0/3", 10), repr(btxt()))
        card.locator(".ftask-main").click()
        p.locator(FOCUS + " .td-tree-row").first.wait_for(timeout=10000)
        check("%s panel terbuka: pohon berindentasi" % tag,
              [x[1] for x in rows(p, FOCUS)] == [0, 1, 2, 1, 0, 0], repr(view(p, FOCUS)))
        prog = p.locator('.ftask-progress[role="progressbar"]').first
        check("%s bar progres level atas (teks lama)" % tag,
              prog.get_attribute("aria-label") == "0 dari 3 item checklist selesai", prog.get_attribute("aria-label"))
        checkbox(p, FOCUS, "Beta").click()
        check("%s centang level atas → badge '1/3'" % tag, wait_until(lambda: btxt() == "1/3", 6), repr(btxt()))
        check("%s server progress 33" % tag, wait_until(lambda: srv_task(base, user, tid)["progress"] == 33, 5))
        inp = p.locator('input[aria-label="Item checklist baru"]').first
        inp.fill("Delta")
        inp.press("Tab")
        pad = p.locator(".ftask-add.td-tree-add").first.evaluate("e => getComputedStyle(e).paddingInlineStart")
        inp.press("Enter")
        ok = wait_until(lambda: ("Delta", 1) in view(p, FOCUS) and view(p, FOCUS)[-1] == ("Delta", 1), 6)
        check("%s kotak Fokus: Tab → 'Delta' sub butir 'Gamma' (kotak menjorok %s); badge tetap '1/3'" % (tag, pad),
              ok and pad == "16px" and btxt() == "1/3", repr((view(p, FOCUS), btxt())))
        # Pembaruan 15 dtk ditunda selama kotak ubah teks terbuka.
        row_loc(p, FOCUS, ids["a"]).locator("button.td-tree-text").click()
        ed = p.locator(FOCUS + ' input[aria-label="Ubah teks butir"]')
        ed.wait_for(timeout=3000)
        ed.press("End")
        ed.type(" diubah")
        api(base, user, "POST", "/api/tasks/%d/subtasks" % tid, json={"title": "Dari perangkat lain"})
        t0 = time.time()
        p.wait_for_timeout(16500)
        gets = [g for g in dev.list_gets if g[0] >= t0]
        check("%s 16,5 dtk dengan kotak ubah teks terbuka: tanpa GET daftar, teks utuh, tetap terfokus, butir baru belum muncul" % tag,
              not gets and ed.count() == 1 and ed.input_value() == "Alpha diubah" and active(p) == [ids["a"], "edit"]
              and "Dari perangkat lain" not in titles(p, FOCUS), repr((gets, ed.count(), active(p))))
        shot(p, "c8_fokus_kotak_ubah_teks.png")
        ed.press("Enter")
        check("%s Enter menyimpan teks (server)" % tag,
              wait_until(lambda: srv_tree(base, user, tid)[0][0] == "Alpha diubah", 5), repr(srv_tree(base, user, tid)[:1]))
        t1 = time.time()
        ok = wait_until(lambda: ("Dari perangkat lain", 0) in view(p, FOCUS), 18, 0.5)
        check("%s setelah kotak ditutup: pembaruan berkala memuat butir dari perangkat lain (%.1f dtk)" % (tag, time.time() - t1),
              ok and view(p, FOCUS)[-1] == ("Dari perangkat lain", 0), repr(view(p, FOCUS)))
        check("%s badge ikut '1/4'" % tag, wait_until(lambda: btxt() == "1/4", 5), repr(btxt()))
        shot(p, "c8_fokus_setelah_pembaruan.png")
        z_checks("fokus375", dev)
    except Exception as e:  # noqa: BLE001
        fail_exc(tag, e, p)
    finally:
        dev.ctx.close()


def tl_pct(p, title):
    """Teks kolom % baris Timeline task `title` (None bila baris tidak ada)."""
    return p.evaluate("""(t) => { const r = [...document.querySelectorAll('.plg-timeline-row')].find(x => {
            const n = x.querySelector('.plg-timeline-name'); return n && n.textContent.trim() === t; });
        if (!r) return null; const c = r.querySelector('.plg-timeline-col-pct');
        return c ? c.textContent.trim() : '(tanpa kolom %)'; }""", title)


def sidebar_project(p, name):
    ex = p.locator("button[aria-label='Tampilkan semua menu']")
    if ex.count() and ex.first.is_visible():
        ex.first.click()
        p.wait_for_timeout(300)
    p.locator(".sidebar-link").filter(has=p.locator("span", has_text=re.compile("^" + re.escape(name) + "$"))).first.click()
    p.wait_for_timeout(500)


def group_sync(browser, base):
    tag = "C-9"
    user = d.register(base, "cks")
    proj = "Proyek Laporan"
    title = "Siapkan laporan kuartal"
    st = api(base, user, "PUT", "/api/plugins/state/timeline", json={"enabled": True})
    tid = mk_task(base, user, title, project=proj, priority="P2")
    mk_task(base, user, "Tugas pembanding", project=proj)
    ids = mk_items(base, user, tid, [("k", "Kumpulkan data", None, False), ("t", "Tulis ringkasan", None, False),
                                     ("r", "Kirim ke atasan", None, False), ("r1", "Lampirkan grafik", "r", False)])
    srv0 = srv_task(base, user, tid)
    check("%s setup: Timeline ON (API), server progress 0, checklist_total 3" % tag,
          st["state"]["enabled"] is True and srv0["progress"] == 0 and srv0["checklist_total"] == 3, repr(srv0.get("checklist_total")))
    d2 = open_app(browser, base, user, "D2", 1280, 860, "light", "0")
    d1 = None
    try:
        d.go_all_tasks(d2.p, False)
        check("%s D2 (perangkat lain) memuat task: baris '0%%'" % tag,
              wait_until(lambda: row_pct(d2.p, title) == "0%", 15), repr(row_pct(d2.p, title)))
        rec2_0 = wait_until(lambda: local_rec(d2.p, tid), 10)
        check("%s D2 IndexedDB berisi task (progress 0, bersih)" % tag,
              rec2_0 and rec2_0["progress"] == 0 and not rec2_0["dirty"], repr(rec2_0))
        d1 = open_app(browser, base, user, "D1", 1280, 860, "light", "1")
        p = d1.p
        d.go_all_tasks(p, False)
        wait_until(lambda: row_pct(p, title) == "0%", 15)
        rec1_0 = wait_until(lambda: local_rec(p, tid), 10)
        open_checklist(d1, PANEL, title)
        checkbox(p, PANEL, "Kumpulkan data").click()
        t0 = time.time()
        ok = wait_until(lambda: row_pct(p, title) == "33%", 8, 0.2)
        check("%s D1: baris daftar task '33%%' tanpa muat ulang (%.1f dtk); pill 33%%" % (tag, time.time() - t0),
              ok and pill_label(p, PANEL) == "Progress 33%, otomatis dari checklist", repr((row_pct(p, title), pill_label(p, PANEL))))
        rec1 = local_rec(p, tid)
        check("%s D1 record lokal: progress 33, checklist_total 3; updated_at/rev/base_rev/dirty tidak berubah" % tag,
              rec1 and rec1["progress"] == 33 and rec1["checklist_total"] == 3 and rec1["updated_at"] == rec1_0["updated_at"]
              and rec1["rev"] == rec1_0["rev"] and rec1["base_rev"] == rec1_0["base_rev"] and not rec1["dirty"],
              "sebelum=%r sesudah=%r" % (rec1_0, rec1))
        srv1 = srv_task(base, user, tid)
        check("%s server progress 33, updated_at tidak naik" % tag,
              srv1["progress"] == 33 and srv1["updated_at"] == srv0["updated_at"], repr((srv1["progress"], srv1["updated_at"])))
        shot(p, "c9_d1_daftar_33.png")
        # Timeline (halaman project): Live Edit dimatikan supaya kolom % tampil (mode ringkas Live Edit hanya WBS + Nama).
        p.wait_for_function("pid => !!(window.TF && window.TF.plugins && window.TF.plugins.isEnabled && window.TF.plugins.isEnabled(pid))",
                            arg="timeline", timeout=20000)
        sidebar_project(p, proj)
        btn = p.locator(".tl-view-btn[aria-label='Timeline']")
        btn.wait_for(state="visible", timeout=15000)
        if btn.get_attribute("aria-pressed") != "true":
            btn.click()
        p.locator(".plg-timeline-scroll, .plg-timeline-list").first.wait_for(state="visible", timeout=20000)
        live = p.locator(".tl-live-btn[aria-pressed='true']")
        if live.count() and live.first.is_visible():
            live.first.click()
        check("%s Timeline: baris task '33%%'" % tag, wait_until(lambda: tl_pct(p, title) == "33%", 10), repr(tl_pct(p, title)))
        p.locator(".plg-timeline-row", has=p.locator(".plg-timeline-name", has_text=title)).first.click()
        p.locator(MODAL).first.wait_for(timeout=10000)
        wait_until(lambda: d.title_value(p, MODAL) == title, 8)
        d.tab_btn(p, MODAL, "Checklist").click()
        wait_rows_loaded(p, MODAL)
        checkbox(p, MODAL, "Tulis ringkasan").click()
        t0 = time.time()
        ok = wait_until(lambda: tl_pct(p, title) == "67%", 8, 0.2)
        check("%s Timeline di balik modal: '67%%' tanpa muat ulang (%.1f dtk)" % (tag, time.time() - t0), ok, repr(tl_pct(p, title)))
        checkbox(p, MODAL, "Lampirkan grafik").click()
        p.wait_for_timeout(1500)
        check("%s centang sub butir: Timeline tetap '67%%'" % tag, tl_pct(p, title) == "67%", repr(tl_pct(p, title)))
        close_modal(p)
        check("%s modal ditutup: Timeline '67%%'" % tag, tl_pct(p, title) == "67%", repr(tl_pct(p, title)))
        shot(p, "c9_timeline_67.png")
        srv2 = srv_task(base, user, tid)
        check("%s server progress 67, updated_at tetap" % tag,
              srv2["progress"] == 67 and srv2["updated_at"] == srv0["updated_at"], repr((srv2["progress"], srv2["updated_at"])))
        # D2: satu siklus refresh otomatis (fetchAll tiap 30 dtk = sync + daftar), tanpa panggilan manual.
        t0 = time.time()
        ok = wait_until(lambda: row_pct(d2.p, title) == "67%", 45, 0.5)
        rec2 = local_rec(d2.p, tid)
        check("%s D2: baris '67%%' setelah satu siklus sinkron otomatis (%.0f dtk), tanpa muat ulang" % (tag, time.time() - t0),
              ok, repr(row_pct(d2.p, title)))
        check("%s D2 record lokal: progress 67 + checklist_total 3 diadopsi dengan updated_at/rev/base_rev tetap dan "
              "server updated_at tidak naik (TASK_DERIVED)" % tag,
              rec2 and rec2["progress"] == 67 and rec2["checklist_total"] == 3 and rec2["updated_at"] == rec2_0["updated_at"]
              and rec2["rev"] == rec2_0["rev"] and rec2["base_rev"] == rec2_0["base_rev"] and not rec2["dirty"]
              and srv_task(base, user, tid)["updated_at"] == srv0["updated_at"],
              "sebelum=%r sesudah=%r" % (rec2_0, rec2))
        shot(d2.p, "c9_d2_daftar_67.png")
        z_checks("D1", d1)
        z_checks("D2", d2)
    except Exception as e:  # noqa: BLE001
        fail_exc(tag, e, (d1 or d2).p)
    finally:
        if d1:
            d1.ctx.close()
        d2.ctx.close()


SAMPLER_JS = """(s) => { window.__ckSamples = []; let last = '';
    const f = () => { const o = Array.from(document.querySelectorAll(s + ' .td-tree-row button.td-tree-text')).map(t => t.textContent).join(',');
        if (o !== last) { window.__ckSamples.push(o); last = o; }
        window.__ckRaf = requestAnimationFrame(f); };
    f(); }"""


def group_galat(browser, base):
    """G (spec §7.7): offline → pindah optimistis kembali ke versi server + toast; centang gagal + toast; online lagi
    → centang berhasil. Galat konsol yang diharapkan hanya jaringan terputus."""
    tag = "G[panel 1280 offline]"
    user = d.register(base, "ckg")
    title = "Uji galat jaringan"
    tid = mk_task(base, user, title)
    mk_items(base, user, tid, [("s", "Satu", None, False), ("d", "Dua", None, False), ("t", "Tiga", None, False)])
    title2 = "Uji gagal muat checklist"
    tid2 = mk_task(base, user, title2)
    mk_items(base, user, tid2, [("a", "Butir A", None, True), ("b", "Butir B", None, False)])
    dev = open_app(browser, base, user, "galat1280", 1280, 860, "light", "1")
    p = dev.p
    toast = p.locator(".toast.toast-error")
    try:
        d.go_all_tasks(p, False)
        wait_until(lambda: p.locator(".task-row", has_text=title).count() > 0, 15)
        open_checklist(dev, PANEL, title)
        dev.ctx.set_offline(True)
        p.wait_for_function("() => navigator.onLine === false", timeout=5000)
        p.evaluate(SAMPLER_JS, PANEL)
        checkbox(p, PANEL, "Tiga").focus()
        p.keyboard.press("Alt+ArrowUp")
        ok_toast = wait_until(lambda: toast.count() > 0 and toast.first.inner_text().strip() == "Gagal memindah butir", 6)
        ok_back = wait_until(lambda: titles(p, PANEL) == ["Satu", "Dua", "Tiga"], 5)
        p.wait_for_timeout(300)
        samples = p.evaluate("() => { cancelAnimationFrame(window.__ckRaf); return window.__ckSamples; }")
        check("%s Alt+↑ offline: tampil langsung (optimistis), gagal → toast 'Gagal memindah butir', daftar kembali ke "
              "versi server" % tag, ok_toast and ok_back and "Satu,Tiga,Dua" in samples and samples[-1] == "Satu,Dua,Tiga",
              repr((samples, toast.all_inner_texts())))
        checkbox(p, PANEL, "Satu").click()
        ok = wait_until(lambda: toast.count() > 0 and toast.first.inner_text().strip() == "Gagal mencentang butir", 6)
        check("%s centang offline: toast 'Gagal mencentang butir', butir tetap belum selesai" % tag,
              ok and checkbox(p, PANEL, "Satu").get_attribute("aria-checked") == "false", repr(toast.all_inner_texts()))
        check("%s server tidak berubah" % tag,
              srv_tree(base, user, tid) == [("Satu", 0, False), ("Dua", 0, False), ("Tiga", 0, False)], repr(srv_tree(base, user, tid)))
        dev.ctx.set_offline(False)
        p.wait_for_function("() => navigator.onLine === true", timeout=5000)
        checkbox(p, PANEL, "Satu").click()
        ok = wait_until(lambda: checkbox(p, PANEL, "Satu").get_attribute("aria-checked") == "true"
                        and pill_label(p, PANEL) == "Progress 33%, otomatis dari checklist", 8)
        check("%s online lagi: centang berhasil, pill 33%%, server selesai" % tag,
              ok and srv_tree(base, user, tid)[0] == ("Satu", 0, True), repr((pill_label(p, PANEL), srv_tree(base, user, tid))))
        # Muat daftar gagal pada task bercheklist (checklist_total > 0 di record lokal) → pill tetap terkunci tanpa d/t.
        pat = re.compile(r"^http://127\.0\.0\.1:\d+/api/tasks/%d/subtasks$" % tid2)
        dev.ctx.route(pat, lambda r: r.abort())
        open_checklist(dev, PANEL, title2)
        ok = wait_until(lambda: pill_label(p, PANEL) == "Progress 50%, otomatis dari checklist", 5)
        pill(p, PANEL).click()
        pop = p.locator(PROGRESS_POP)
        pop.wait_for(timeout=3000)
        note = pop.locator(".td-progress-note")
        check("%s GET daftar gagal: pill tetap terkunci 50%% (checklist_total lokal), keterangan 'Otomatis dari checklist' "
              "tanpa d/t, slider nonaktif" % tag,
              ok and note.count() == 1 and note.inner_text().strip() == "Otomatis dari checklist"
              and pop.locator('input[type="range"]').is_disabled() and pop.locator(".td-presets").count() == 0,
              repr((pill_label(p, PANEL), pop.inner_text())))
        p.keyboard.press("Escape")
        dev.ctx.unroute(pat)
        unexpected = [e for e in dev.errors if "ERR_INTERNET_DISCONNECTED" not in e and "Failed to fetch" not in e
                      and not ("ERR_FAILED" in e and "/subtasks" in e)]
        check("%s Z galat konsol hanya jaringan terputus (%d diharapkan)" % (tag, len(dev.errors) - len(unexpected)),
              not unexpected, "; ".join(unexpected[:5]))
        check("%s Z tanpa PUT /api/tasks/{id}" % tag, not dev.puts, repr(dev.puts[:8]))
        check("%s Z _outbox tetap 0" % tag, wait_until(lambda: outbox(p) == 0, 5), repr(outbox(p)))
    except Exception as e:  # noqa: BLE001
        fail_exc(tag, e, p)
    finally:
        dev.ctx.close()


GROUPS = [("modal", group_modal), ("panel", group_panel), ("galat", group_galat), ("focus", group_focus),
          ("sync", group_sync)]


def want(name):
    only = [x for x in os.environ.get("E2E_ONLY", "").split(",") if x]
    return not only or name in only


def main():
    os.makedirs(SHOTS, exist_ok=True)
    for f in os.listdir(SHOTS):
        if f.endswith(".png"):
            os.remove(os.path.join(SHOTS, f))
    tmp = tempfile.mkdtemp(prefix="e2e_checklist_tree_")
    proc, base = launch(tmp)
    head = subprocess.run(["git", "rev-parse", "--short", "HEAD"], cwd=ROOT, capture_output=True, text=True).stdout.strip()
    print("server", base, "@", head, "| klien SW", d.SW_VERSION, flush=True)
    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            for name, fn in GROUPS:
                if want(name):
                    print("=== kelompok %s ===" % name, flush=True)
                    try:
                        fn(browser, base)
                    except Exception as e:  # noqa: BLE001
                        fail_exc("kelompok %s" % name, e)
            browser.close()
    finally:
        stop(proc)
        print("server log:", os.path.join(tmp, "server.log"))
    check("Z tanpa respons >= 400 dari server lokal", not bad_responses, repr(bad_responses[:10]))
    check("Z tanpa PUT /api/tasks/{id} di semua perangkat", not all_puts, repr(all_puts[:10]))
    failed = [r for r in results if not r[1]]
    print("\n%d cek, %d gagal" % (len(results), len(failed)))
    for r in failed:
        print("  FAIL:", r[0], "—", r[2])
    if not failed:
        shutil.rmtree(tmp, ignore_errors=True)
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
