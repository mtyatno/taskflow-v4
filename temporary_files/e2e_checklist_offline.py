"""E2E checklist offline (Fase 2) PR B2: checklist dipakai penuh saat offline, antrean terkirim saat online, perangkat
lain sama, bentrok dibatalkan dengan satu pesan. Tidak dijalankan CI.

Spec docs/superpowers/specs/2026-11-11-checklist-offline-fase2-design.md §1 (kriteria 1–5), §4, §6 (E2E); rencana
docs/superpowers/plans/2026-11-12-checklist-offline-pr-b2-ui.md Task 7. Offline = context.set_offline(True).

  S1  perangkat A (panel Live Edit 1280 terang, service worker AKTIF supaya muat ulang offline bisa): offline → tambah
      butir, Tab (sub) / Shift+Tab di kotak tambah, seret mouse, Alt+↓ / Alt+↑, centang induk (turunan ikut), hapus
      induk berturunan (konfirmasi: batal lalu terima), hapus butir buatan offline (create+delete tidak terkirim), ubah
      teks → antrean berisi aksi yang benar, server belum berubah → MUAT ULANG SAAT OFFLINE → tampilan + progress tetap
      → online → antrean kosong → server sama persis (urutan, induk, centang, teks; tanpa butir ganda), rev tersimpan =
      rev server; perangkat B (konteks lain, pengguna sama) sama
  S2  perangkat B (modal 1280): offline → task baru lewat "Buat Baru" + checklist bertingkat → online dengan respons
      tambah butir pertama HILANG (dikirim ke server lalu koneksi diputus) → dikirim ulang → server: satu task, butir
      tanpa ganda, pohon sama
  S3  bentrok (B): offline ubah teks + centang butir X dan ubah teks butir Y; "perangkat lain" (API) menghapus X →
      online → tepat SATU toast "2 perubahan checklist dibatalkan karena checklist sudah berubah di perangkat lain.",
      Y terkirim, tampilan (dibuka ulang) + progress daftar = server
  S4  perangkat C baru (konteks bersih, 375 gelap, LOGIN lewat formulir) → unduhan awal mengambil SEMUA checklist (isi
      + rev = server) → offline → checklist task mana pun (termasuk yang belum pernah dibuka perangkat mana pun) tampil
      tanpa request jaringan checklist dan bisa diubah → online → server sama
  S5  progress daftar task berubah saat offline (S1: 0% → 20%) dan tidak melompat saat sinkron (pencatat
      requestAnimationFrame pada baris daftar selama antrean dikirim: hanya "20%")
  S6  tab lama: tab dengan static origin/main (IndexedDB v7, dilayani page.route dari `git archive origin/main static`)
      + tab baru (v8) di konteks yang sama → banner "Alurik diperbarui di tab lain. Muat ulang tab ini." di tab lama;
      entri antrean `subtasks` dari tab baru utuh saat tab lama mencoba push; online → tab baru mengirimnya
  S7  galat konsol / respons >= 400 hanya yang terkait jaringan terputus (offline, 503 jawaban SW saat offline,
      koneksi yang sengaja diputus di S2) dan PATCH 404 milik bentrok S3 / S8
  S8  dua tab online bersamaan (review akhir W2): dua page dalam SATU context (IndexedDB + navigator.locks bersama);
      offline → di tab 1 centang/buka centang butir X berulang, ubah teks Y, ubah teks Z yang lalu dihapus "perangkat
      lain" → online → kedua tab sinkron (event online) → setiap aksi terkirim TEPAT SEKALI (request diamati di level
      context), server = lokal (kedua tab), toast bentrok paling banyak sekali per tab dan sekali total

Server lokal dijalankan sendiri (uvicorn webapp:app, DB sementara; pola e2e_checklist_tree.py). Host luar diblokir,
tf_whatsnew_seen diisi. Screenshot: temporary_files/e2e_checklist_offline/ (atau $E2E_SHOTS_DIR). Ringkasan "N/M
lulus"; keluar non-zero bila ada cek gagal. E2E_ONLY=utama (S1–S5, S7) atau E2E_ONLY=tab (S6).

    E2E_PYTHON=$(which python3) TZ=Asia/Jakarta python3 temporary_files/e2e_checklist_offline.py
"""
import json
import mimetypes
import os
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import time

from playwright.sync_api import sync_playwright

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import e2e_detail_redesign as d  # noqa: E402
import e2e_checklist_tree as ck  # noqa: E402  (launch/stop server, api, mk_task, mk_items, checkbox, more_btn, …)

ROOT = d.ROOT
SHOTS = os.environ.get("E2E_SHOTS_DIR") or os.path.join(ROOT, "temporary_files", "e2e_checklist_offline")
PANEL, MODAL = d.PANEL, d.MODAL
wait_until = d.wait_until
api = ck.api
TOAST_TEXT = "%d perubahan checklist dibatalkan karena checklist sudah berubah di perangkat lain."
BANNER_TEXT = "Alurik diperbarui di tab lain. Muat ulang tab ini."

results = []  # (cek, ok, keterangan)
devices = []  # semua perangkat (untuk S7)


def check(step, ok, note=""):
    results.append((step, bool(ok), note))
    print(("PASS " if ok else "FAIL ") + step + (" — " + str(note) if note else ""), flush=True)
    return ok


def fail_exc(tag, e, p=None):
    import traceback
    traceback.print_exc()
    check("%s exception" % tag, False, "%s: %s" % (type(e).__name__, str(e)[:300]))
    if p is not None:
        try:
            shot(p, "zz_error_%s.png" % re.sub(r"\W+", "", tag))
        except Exception:  # noqa: BLE001
            pass


def shot(p, name):
    path = os.path.join(SHOTS, name)
    p.wait_for_timeout(300)
    p.screenshot(path=path, full_page=False)
    print("  screenshot", os.path.relpath(path, ROOT), flush=True)


# ── perangkat ─────────────────────────────────────────────────────────────────

# Pencatat toast (per elemen + teks) dan event tf:checklist-rejected; bertahan setelah muat ulang (init script).
TOAST_INIT = """(() => { window.__toasts = []; window.__rejected = [];
    window.addEventListener('tf:checklist-rejected', e => window.__rejected.push(e.detail));
    const seen = new WeakMap();
    const scan = () => document.querySelectorAll('.toast').forEach(t => {
        const txt = t.textContent.trim(); if (seen.get(t) === txt) return; seen.set(t, txt);
        window.__toasts.push([t.className, txt]); });
    const start = () => { const root = document.documentElement; if (!root) return setTimeout(start, 5);
        new MutationObserver(scan).observe(root, {childList: true, subtree: true, characterData: true}); };
    start(); })();"""


class Dev:
    def __init__(self, label, ctx, page, base):
        self.label, self.ctx, self.p, self.base = label, ctx, page, base
        self.offline = False
        self.events = []      # (jenis, teks, path, offline?) galat konsol / pageerror / respons >= 400
        self.dialogs = []     # pesan window.confirm
        self.answers = []     # jawaban dialog berikut (False = batal); kosong = terima
        self.net = []         # (method, path, offline?) request ke server lokal

    def set_offline(self, off):
        self.ctx.set_offline(off)
        self.offline = off
        self.p.wait_for_function("(v) => navigator.onLine === v", arg=not off, timeout=5000)


def attach(dev, p):
    base = dev.base

    def path_of(url):
        return url[len(base):].split("?")[0] if url and url.startswith(base) else None

    def on_console(msg):
        if msg.type != "error":
            return
        url = (msg.location or {}).get("url", "") or ""
        if url and not url.startswith(base):
            return  # sumber luar yang sengaja diblokir
        dev.events.append(("console", msg.text[:220], path_of(url) or "", dev.offline))

    def on_response(r):
        if r.url.startswith(base) and r.status >= 400:
            dev.events.append(("response %d %s" % (r.status, r.request.method), "", path_of(r.url), dev.offline))

    def on_request(r):
        pth = path_of(r.url)
        if pth is not None and pth.startswith("/api/"):
            dev.net.append((r.method, pth, dev.offline))

    def on_dialog(dlg):
        dev.dialogs.append(dlg.message)
        if dev.answers and dev.answers.pop(0) is False:
            dlg.dismiss()
        else:
            dlg.accept()

    p.on("console", on_console)
    p.on("pageerror", lambda e: dev.events.append(("pageerror", str(e)[:220], "", dev.offline)))
    p.on("response", on_response)
    p.on("request", on_request)
    p.on("dialog", on_dialog)


def seed_storage(p, user, theme, live, sw_version):
    """localStorage awal (tur, onboarding, tema, Live Edit, whatsnew); token hanya bila `user` berisi token."""
    p.evaluate("""([t, u, tours, theme, sw, live]) => {
        if (t) { localStorage.setItem('tf_token', t); localStorage.setItem('tf_user_id', String(u)); }
        for (const pg of tours) localStorage.setItem('tf_tour_' + pg, '1');
        localStorage.setItem('tf_dismiss_onboarding', '1'); localStorage.setItem('tf_onboarded', '1');
        localStorage.setItem('tf_backup_snooze', new Date().toISOString().slice(0, 10));
        localStorage.setItem('tf_whatsnew_seen', sw); localStorage.setItem('tf_theme', theme);
        localStorage.setItem('tf_groupby', 'none'); localStorage.setItem('tf_viewmode', 'normal');
        localStorage.setItem('tf_liveedit', live);
    }""", [user.get("token"), user.get("id"), d.TOURS + ["today", "project"], theme, sw_version, live])


def wait_shell(p, timeout=30000):
    p.locator(".sidebar-link, .sidebar-rail-btn").first.wait_for(state="attached", timeout=timeout)


def open_dev(browser, base, user, label, w, h, theme, live, sw=False, login=False):
    mobile = w < 500
    ctx = browser.new_context(service_workers="allow" if sw else "block", viewport={"width": w, "height": h},
                              device_scale_factor=1, is_mobile=mobile, has_touch=mobile, timezone_id="Asia/Jakarta")
    if not login:
        ctx.add_cookies([{"name": "token", "value": user["token"], "url": base, "httpOnly": True, "sameSite": "Lax"}])
    ctx.route(re.compile(r"^(?!http://127\.0\.0\.1).*$"), lambda r: r.abort())  # font/CDN luar: deterministik
    ctx.add_init_script(TOAST_INIT)
    p = ctx.new_page()
    dev = Dev(label, ctx, p, base)
    devices.append(dev)
    attach(dev, p)
    p.goto(base + "/manifest.json")
    seed_storage(p, {} if login else user, theme, live, d.SW_VERSION)
    p.goto(base + "/")
    if login:
        form = p.locator("form").filter(has=p.locator('input[type="password"]')).first
        form.wait_for(timeout=20000)
        form.locator("input.input").first.fill(user["username"])
        form.locator('input[type="password"]').fill(d.PW)
        form.locator('button[type="submit"]').click()
    wait_shell(p)
    if sw:
        # SW pertama kali: tunggu terpasang + mengendalikan halaman (bisa memuat ulang sendiri lewat controllerchange),
        # lalu muat ulang sekali supaya halaman pasti dikendalikan SW dan semua shell sudah di-cache.
        wait_until(lambda: p.evaluate("async () => !!(await navigator.serviceWorker.ready).active"), 30)
        wait_until(lambda: p.evaluate("() => !!navigator.serviceWorker.controller"), 30)
        p.wait_for_timeout(1500)
        p.reload()
        wait_shell(p)
    return dev


# ── checklist di tampilan ─────────────────────────────────────────────────────

ROWS_JS = """(s) => Array.from(document.querySelectorAll(s + ' .td-tree-row')).map(r => {
    const t = r.querySelector('button.td-tree-text'), e = r.querySelector('input[aria-label="Ubah teks butir"]');
    return [r.getAttribute('data-check-row'), Number(getComputedStyle(r).getPropertyValue('--td-depth').trim() || 0),
            t ? t.textContent : (e ? e.value : null), r.classList.contains('is-done')]; })"""


def view(p, scope):
    """[(judul, depth, selesai)] baris checklist yang tampil (pre-order DOM)."""
    return [(r[2], r[1], r[3]) for r in p.evaluate(ROWS_JS, scope)]


def with_parent(rows):
    """[(judul, depth, selesai)] pre-order → [(judul, depth, judul induk, selesai)] (induk dari kedalaman)."""
    out, stack = [], []
    for title, depth, done in rows:
        del stack[depth:]
        out.append((title, depth, stack[-1] if stack else None, done))
        stack.append(title)
    return out


def srv_items(base, user, tid):
    return api(base, user, "GET", "/api/tasks/%d/subtasks" % tid)


def srv_tree(base, user, tid):
    """[(judul, depth, judul induk, selesai)] server — induk dari parent_id (bukan dari depth)."""
    items = srv_items(base, user, tid)
    by = {i["id"]: i["title"] for i in items}
    return [(i["title"], i["depth"], by.get(i["parent_id"]) if i["parent_id"] is not None else None, bool(i["is_done"]))
            for i in items]


def srv_task(base, user, tid):
    return api(base, user, "GET", "/api/tasks/%d" % tid)


def row(p, scope, title):
    return p.locator(scope + " .td-tree-row").filter(
        has=p.locator("button.td-tree-text", has_text=re.compile("^" + re.escape(title) + "$"))).first


def open_checklist(dev, scope, title):
    p = dev.p
    if scope == MODAL:
        ck.close_modal(p)
        d.open_task(p, title)
    elif d.title_value(p, PANEL) == title and not d.click_row(p, OTHER_TITLE, 10):
        raise AssertionError("panel tidak menampilkan %r" % OTHER_TITLE)
    if scope == PANEL and not d.click_row(p, title, 10):
        raise AssertionError("panel tidak menampilkan %r" % title)
    wait_until(lambda: p.locator(scope + ' [role="tab"][aria-selected="true"]').count() == 1, 10)
    d.tab_btn(p, scope, "Checklist").click()
    wait_until(lambda: (d.active_tab(p, scope) or "").startswith("Checklist"), 5)
    ck.wait_rows_loaded(p, scope)


def add_items(p, scope, steps):
    """steps: judul (Enter) atau "<Tab>" / "<Shift+Tab>" (tingkat kotak tambah). Kotak ditutup dengan Escape."""
    if ck.add_box(p, scope).count() == 0:
        p.locator(scope + " button.td-add").first.click()
    box = ck.add_box(p, scope)
    box.wait_for(timeout=3000)
    for s in steps:
        if s in ("<Tab>", "<Shift+Tab>"):
            box.press(s[1:-1])
            p.wait_for_timeout(150)
            continue
        box.fill(s)
        box.press("Enter")
        if not wait_until(lambda: any(r[0] == s for r in view(p, scope)), 8):
            raise AssertionError("butir %r tidak muncul" % s)
    box.press("Escape")
    wait_until(lambda: ck.add_box(p, scope).count() == 0, 3)


def edit_text(p, scope, old, new):
    row(p, scope, old).locator("button.td-tree-text").click()
    box = p.locator(scope + ' input[aria-label="Ubah teks butir"]').first
    box.wait_for(timeout=3000)
    box.fill(new)
    box.press("Enter")
    return wait_until(lambda: any(r[0] == new for r in view(p, scope)), 6)


def delete_item(dev, scope, title):
    ck.more_btn(dev.p, scope, title).click()
    ck.menu_pick(dev.p, "Hapus")


def drag_below(p, scope, title, target):
    """Seret ⠿ `title` dengan mouse ke celah di bawah baris `target` (geser awal ≥ 6 px memulai seret). → garis tampil?"""
    p.locator(scope + " button.td-add").first.scroll_into_view_if_needed()
    p.wait_for_timeout(200)
    g = row(p, scope, title).locator('[data-check-part="grip"]').bounding_box()
    tgt = row(p, scope, target).bounding_box()
    x, y = g["x"] + g["width"] / 2, g["y"] + g["height"] / 2
    p.mouse.move(x, y)
    p.mouse.down()
    p.mouse.move(x, y + 8, steps=2)
    p.mouse.move(x, tgt["y"] + tgt["height"] - 4, steps=10)
    line = p.locator(scope + " .td-tree-line").count() == 1
    p.mouse.up()
    return line


def alt_key(p, scope, title, key):
    ck.checkbox(p, scope, title).focus()
    p.keyboard.press(key)


# ── data lokal ────────────────────────────────────────────────────────────────

def outbox_n(p):
    return d.outbox_count(p)


def outbox_subtasks(p):
    return p.evaluate("""async () => (await TF.outbox.outboxAll()).filter(o => o.entity_type === 'subtasks')
        .map(o => [o.op, (o.payload && o.payload.title) || null])""")


def task_cid(p, sid):
    return p.evaluate("async (sid) => await TF.idmap.cidOf('task', sid)", sid)


def revs(p):
    return p.evaluate("async () => await TF.checklistrepo.getRevs()")


def local_items(p, cid):
    return [(i["title"], i["depth"], bool(i["is_done"])) for i in p.evaluate("async (c) => await TF.checklistrepo.itemsForTask(c)", cid)]


def is_ready(p):
    return p.evaluate("() => !!(window.TF && TF.checklistrepo && TF.checklistrepo.isReady())")


def wait_drain(p, timeout=40):
    return bool(wait_until(lambda: outbox_n(p) == 0, timeout, 0.3))


def checklist_toasts(p):
    return [t for t in p.evaluate("() => window.__toasts || []") if "perubahan checklist" in t[1]]


def error_toasts(p):
    return [t[1] for t in p.evaluate("() => window.__toasts || []") if "toast-error" in t[0]]


PCT_SAMPLER = """(title) => { window.__pct = []; let last;
    const f = () => { const r = [...document.querySelectorAll('.task-row')].find(x => x.textContent.includes(title));
        let v = null;
        if (r) { const s = [...r.querySelectorAll('span')].map(x => x.textContent.trim()).filter(t => /^\\d+%$/.test(t));
                 v = s.length ? s[s.length - 1] : null; }
        if (v !== last) { window.__pct.push(v); last = v; }
        window.__pctRaf = requestAnimationFrame(f); };
    f(); }"""


# ── data uji ──────────────────────────────────────────────────────────────────

S1_TITLE = "Persiapan pameran"
OTHER_TITLE = "Tanpa checklist"  # task pembanding: panel dipindah ke sini dulu supaya checklist dimuat ulang
S1_INIT = [("Desain booth", 0, None, False), ("Sketsa awal", 1, "Desain booth", False),
           ("Revisi warna", 1, "Desain booth", False), ("Cetak brosur", 0, None, False),
           ("Kirim undangan", 0, None, False), ("Sewa peralatan", 0, None, False), ("Kursi", 1, "Sewa peralatan", False),
           ("Meja", 1, "Sewa peralatan", False), ("Konsumsi", 0, None, False)]
S1_FINAL = [("Desain booth", 0, None, True), ("Sketsa awal", 1, "Desain booth", True),
            ("Revisi warna", 1, "Desain booth", True), ("Konsumsi", 0, None, False),
            ("Kirim undangan digital", 0, None, False), ("Cetak brosur", 0, None, False),
            ("Booking hotel", 0, None, False), ("Konfirmasi tamu", 1, "Booking hotel", False)]
S2_TITLE = "Rencana offline baru"
S2_WANT = [("Langkah 1", 0, None, False), ("Langkah 2", 0, None, True), ("Langkah 2a", 1, "Langkah 2", True),
           ("Langkah 2b", 1, "Langkah 2", True), ("Langkah 3", 0, None, False)]
S3_WANT = [("Desain booth", 0, None, True), ("Sketsa awal", 1, "Desain booth", True),
           ("Revisi warna", 1, "Desain booth", True), ("Kirim undangan digital", 0, None, False),
           ("Cetak brosur A5", 0, None, False), ("Booking hotel", 0, None, False),
           ("Konfirmasi tamu", 1, "Booking hotel", False)]
S4_TITLE = "Arsip lama"
S4_INIT = [("Bab A", 0, None, False), ("Bab A.1", 1, "Bab A", True), ("Bab A.2", 1, "Bab A", False),
           ("Bab A.2.x", 2, "Bab A.2", False), ("Bab B", 0, None, True)]
S4_WANT = [("Bab A", 0, None, False), ("Bab A.1", 1, "Bab A", True), ("Bab A.2", 1, "Bab A", True),
           ("Bab A.2.x", 2, "Bab A.2", True), ("Bab B", 0, None, True), ("Bab C", 0, None, False)]


def strip(tree):
    """[(judul, depth, induk, selesai)] → [(judul, depth, selesai)] (bentuk view())."""
    return [(t, dep, done) for t, dep, _par, done in tree]


# ── S1 + S5 ───────────────────────────────────────────────────────────────────

def s1_offline(A, base, user, tid):
    tag = "S1"
    p = A.p
    scope = PANEL
    ok = wait_until(lambda: is_ready(p), 30)
    cid = task_cid(p, tid)
    check("%s unduhan awal selesai (isReady) dan rev tersimpan = rev server" % tag,
          ok and revs(p).get(cid) == srv_task(base, user, tid)["checklist_rev"],
          "revs=%r server=%r" % (revs(p).get(cid), srv_task(base, user, tid)["checklist_rev"]))
    check("%s halaman dikendalikan service worker" % tag, p.evaluate("() => !!navigator.serviceWorker.controller"))
    d.go_all_tasks(p, False)
    wait_until(lambda: p.locator(".task-row", has_text=S1_TITLE).count() > 0, 15)
    open_checklist(A, scope, S1_TITLE)
    check("%s checklist awal tampil (= server)" % tag, with_parent(view(p, scope)) == S1_INIT, repr(view(p, scope)))
    check("%s progress awal: baris daftar '0%%'" % tag, ck.row_pct(p, S1_TITLE) == "0%", repr(ck.row_pct(p, S1_TITLE)))
    A.set_offline(True)
    t_off = len(error_toasts(p))
    # (a) tambah, Tab → sub butir, Shift+Tab → level atas
    add_items(p, scope, ["Booking hotel", "<Tab>", "Konfirmasi tamu", "<Shift+Tab>", "Catatan sementara"])
    want = S1_INIT + [("Booking hotel", 0, None, False), ("Konfirmasi tamu", 1, "Booking hotel", False),
                      ("Catatan sementara", 0, None, False)]
    check("%s offline: tambah 3 butir, Tab di kotak tambah → sub butir, Shift+Tab → level atas" % tag,
          with_parent(view(p, scope)) == want, repr(view(p, scope)))
    # (b) seret mouse 'Konsumsi' ke bawah subtree 'Desain booth'
    line = drag_below(p, scope, "Konsumsi", "Revisi warna")
    order = ["Desain booth", "Sketsa awal", "Revisi warna", "Konsumsi", "Cetak brosur", "Kirim undangan",
             "Sewa peralatan", "Kursi", "Meja", "Booking hotel", "Konfirmasi tamu", "Catatan sementara"]
    ok = wait_until(lambda: [r[0] for r in view(p, scope)] == order, 6)
    check("%s offline: seret mouse 'Konsumsi' ke bawah 'Revisi warna' (garis penanda tampil, tetap level atas)" % tag,
          line and ok and dict((r[0], r[1]) for r in view(p, scope))["Konsumsi"] == 0, repr(view(p, scope)))
    # (c) Alt+↓ / Alt+↑ dari tombol centang
    alt_key(p, scope, "Cetak brosur", "Alt+ArrowDown")
    order = ["Desain booth", "Sketsa awal", "Revisi warna", "Konsumsi", "Kirim undangan", "Cetak brosur",
             "Sewa peralatan", "Kursi", "Meja", "Booking hotel", "Konfirmasi tamu", "Catatan sementara"]
    ok1 = wait_until(lambda: [r[0] for r in view(p, scope)] == order, 5)
    alt_key(p, scope, "Booking hotel", "Alt+ArrowUp")
    order = ["Desain booth", "Sketsa awal", "Revisi warna", "Konsumsi", "Kirim undangan", "Cetak brosur",
             "Booking hotel", "Konfirmasi tamu", "Sewa peralatan", "Kursi", "Meja", "Catatan sementara"]
    ok2 = wait_until(lambda: [r[0] for r in view(p, scope)] == order, 5)
    check("%s offline: Alt+↓ 'Cetak brosur' tukar dengan 'Kirim undangan'; Alt+↑ 'Booking hotel' (+ sub butirnya) naik"
          % tag, ok1 and ok2, repr(view(p, scope)))
    # (d) centang induk → turunan ikut
    ck.checkbox(p, scope, "Desain booth").click()
    ok = wait_until(lambda: [r[2] for r in view(p, scope)[:3]] == [True, True, True], 5)
    check("%s offline: centang induk 'Desain booth' → 'Sketsa awal' dan 'Revisi warna' ikut tercentang" % tag,
          ok, repr(view(p, scope)[:3]))
    # (e) hapus induk berturunan: konfirmasi batal → tetap; terima → induk + 2 sub butir hilang
    n = len(A.dialogs)
    A.answers.append(False)
    delete_item(A, scope, "Sewa peralatan")
    p.wait_for_timeout(700)
    kept = "Sewa peralatan" in [r[0] for r in view(p, scope)]
    delete_item(A, scope, "Sewa peralatan")
    ok = wait_until(lambda: not {"Sewa peralatan", "Kursi", "Meja"} & {r[0] for r in view(p, scope)}, 5)
    check("%s offline: hapus induk → konfirmasi 'Hapus «Sewa peralatan» beserta 2 sub butir?' (batal = tetap, terima ="
          " induk + turunan hilang)" % tag,
          kept and ok and A.dialogs[n:] == ["Hapus «Sewa peralatan» beserta 2 sub butir?"] * 2, repr(A.dialogs[n:]))
    # (f) hapus butir yang dibuat offline (create belum terkirim → keduanya tidak dikirim)
    n = len(A.dialogs)
    delete_item(A, scope, "Catatan sementara")
    ok = wait_until(lambda: "Catatan sementara" not in [r[0] for r in view(p, scope)], 5)
    check("%s offline: hapus butir buatan offline tanpa turunan (tanpa konfirmasi)" % tag, ok and len(A.dialogs) == n)
    check("%s create yang dibuang sementara entri task itu yang lebih baru masih antre → rev tersimpan dikosongkan "
          "(diambil ulang sesudah antrean kosong, R2)" % tag, cid in revs(p) and revs(p)[cid] is None, repr(revs(p).get(cid)))
    # (g) ubah teks
    ok = edit_text(p, scope, "Kirim undangan", "Kirim undangan digital")
    check("%s offline: ubah teks 'Kirim undangan' → 'Kirim undangan digital'" % tag, ok, repr(view(p, scope)))
    check("%s tampilan akhir offline = harapan (urutan, induk, centang, teks)" % tag,
          with_parent(view(p, scope)) == S1_FINAL, repr(view(p, scope)))
    check("%s label 'Checklist (5)', bar '1/5', pill 'Progress 20%%, otomatis dari checklist'" % tag,
          wait_until(lambda: ck.check_label(p, scope) == "Checklist (5)" and ck.bar_text(p, scope) == "1/5"
                     and ck.pill_label(p, scope) == "Progress 20%, otomatis dari checklist", 5),
          repr((ck.check_label(p, scope), ck.bar_text(p, scope), ck.pill_label(p, scope))))
    check("%s S5 progress daftar task berubah saat offline: '0%%' → '20%%'" % tag,
          wait_until(lambda: ck.row_pct(p, S1_TITLE) == "20%", 6), repr(ck.row_pct(p, S1_TITLE)))
    q = outbox_subtasks(p)
    check("%s antrean: create ×2, move ×3, set_done, delete (akar saja), rename — tanpa entri butir yang dibuat lalu "
          "dihapus offline" % tag,
          [o[0] for o in q] == ["create", "create", "move", "move", "move", "set_done", "delete", "rename"]
          and [o[1] for o in q if o[0] == "create"] == ["Booking hotel", "Konfirmasi tamu"], repr(q))
    check("%s tanpa toast galat selama aksi offline" % tag, not error_toasts(p)[t_off:], repr(error_toasts(p)))
    check("%s server belum berubah selama offline" % tag, srv_tree(base, user, tid) == S1_INIT, repr(srv_tree(base, user, tid)))
    shot(p, "s1_offline_panel.png")
    # ── muat ulang saat offline (SW melayani shell) ──
    p.reload(wait_until="domcontentloaded", timeout=30000)
    wait_shell(p)
    net = p.evaluate("""async () => { try { const r = await fetch('/api/tasks', {cache: 'no-store'}); return 'status ' + r.status; }
        catch (e) { return 'gagal'; } }""")
    check("%s muat ulang saat offline: aplikasi tampil (navigator.onLine false, server tak terjangkau: %s)" % (tag, net),
          p.evaluate("() => navigator.onLine") is False and net in ("gagal", "status 503"), net)
    d.go_all_tasks(p, False)
    check("%s muat ulang offline: progress daftar tetap '20%%'" % tag,
          wait_until(lambda: ck.row_pct(p, S1_TITLE) == "20%", 10), repr(ck.row_pct(p, S1_TITLE)))
    open_checklist(A, scope, S1_TITLE)
    check("%s muat ulang offline: checklist tetap (urutan, induk, centang, teks) + pill 20%%" % tag,
          wait_until(lambda: with_parent(view(p, scope)) == S1_FINAL, 8)
          and ck.pill_label(p, scope) == "Progress 20%, otomatis dari checklist",
          repr((view(p, scope), ck.pill_label(p, scope))))
    check("%s muat ulang offline: antrean utuh (8 entri checklist)" % tag, len(outbox_subtasks(p)) == 8, repr(outbox_subtasks(p)))
    shot(p, "s1_offline_reload.png")
    # ── online: S5 pencatat progress baris daftar, sampai checklist selesai diambil ulang ──
    p.evaluate(PCT_SAMPLER, S1_TITLE)
    A.set_offline(False)
    t0 = time.time()
    ok = wait_drain(p, 40)
    check("%s online → antrean kosong (%.1f dtk)" % (tag, time.time() - t0), ok, repr(outbox_subtasks(p)))
    srv = srv_tree(base, user, tid)
    items = srv_items(base, user, tid)
    check("%s server = hasil offline persis (urutan, induk, centang, teks), tanpa butir ganda" % tag,
          srv == S1_FINAL and len({i["id"] for i in items}) == len(items) == 8, repr(srv))
    st = srv_task(base, user, tid)
    check("%s server progress 20, checklist_total 5" % tag, st["progress"] == 20 and st["checklist_total"] == 5,
          repr((st["progress"], st["checklist_total"])))
    # Butir buatan offline yang dihapus sebelum entri lain task itu terkirim → rev tersimpan dikosongkan (rencana R2) →
    # checklist diambil ulang di siklus sinkron berikutnya (≤ 30 dtk) sesudah antrean kosong.
    t0 = time.time()
    ok = wait_until(lambda: revs(p).get(cid) == srv_task(base, user, tid)["checklist_rev"], 45, 0.5)
    check("%s rev tersimpan = rev server sesudah sinkron (%.0f dtk)" % (tag, time.time() - t0), ok,
          "lokal=%r server=%r" % (revs(p).get(cid), srv_task(base, user, tid)["checklist_rev"]))
    check("%s checklist lokal (IndexedDB) = server sesudah diambil ulang" % tag, local_items(p, cid) == strip(S1_FINAL),
          repr(local_items(p, cid)))
    p.wait_for_timeout(1000)
    samples = p.evaluate("() => { cancelAnimationFrame(window.__pctRaf); return window.__pct; }")
    check("%s S5 progress daftar tidak melompat selama sinkron + ambil ulang (semua nilai yang tampil: %s)" % (tag, samples),
          [s for s in samples if s is not None] and all(s in (None, "20%") for s in samples)
          and ck.row_pct(p, S1_TITLE) == "20%", repr(samples))
    open_checklist(A, scope, S1_TITLE)
    check("%s tampilan sesudah sinkron tetap sama, pill 20%%" % tag,
          with_parent(view(p, scope)) == S1_FINAL and ck.pill_label(p, scope) == "Progress 20%, otomatis dari checklist",
          repr(view(p, scope)))


def s1_second_device(B, base, user, tid):
    tag = "S1"
    p = B.p
    check("%s perangkat B: unduhan awal selesai" % tag, wait_until(lambda: is_ready(p), 30))
    d.go_all_tasks(p, False)
    check("%s perangkat B: baris daftar '20%%'" % tag, wait_until(lambda: ck.row_pct(p, S1_TITLE) == "20%", 10),
          repr(ck.row_pct(p, S1_TITLE)))
    open_checklist(B, MODAL, S1_TITLE)
    check("%s perangkat B: checklist sama persis dengan perangkat A" % tag,
          with_parent(view(p, MODAL)) == S1_FINAL, repr(view(p, MODAL)))
    shot(p, "s1_perangkat_b.png")
    ck.close_modal(p)


# ── S2 ────────────────────────────────────────────────────────────────────────

def s2_new_task(B, base, user):
    tag = "S2"
    p = B.p
    scope = MODAL
    ck.close_modal(p)
    B.set_offline(True)
    p.locator("button.btn.btn-primary.btn-sm", has_text="Buat Baru").first.click()
    inp = p.locator('input[placeholder="Judul task... atau tambahkan #tag"]').first
    inp.wait_for(timeout=5000)
    inp.fill(S2_TITLE)
    p.locator('.modal-content button[type="submit"]', has_text=re.compile(r"^Tambah$")).first.click()
    skip = p.locator("button", has_text="Tidak perlu (Lewati)")
    if wait_until(lambda: skip.count() > 0 or p.locator(".task-row", has_text=S2_TITLE).count() > 0, 8) and skip.count():
        skip.first.click()
    ok = wait_until(lambda: p.locator(".task-row", has_text=S2_TITLE).count() > 0 and d.modal_count(p) == 0, 10)
    rec = p.evaluate("""async (t) => { const db = await TF.db.openDB();
        const all = await new Promise(r => { const q = db.transaction('tasks').objectStore('tasks').getAll(); q.onsuccess = () => r(q.result || []); });
        const x = all.find(x => !x.deleted && x.title === t); return x ? {cid: x.cid, server_id: x.server_id == null ? null : x.server_id} : null; }""",
                     S2_TITLE)
    check("%s offline: task baru lewat 'Buat Baru' tampil di daftar, belum punya id server" % tag,
          ok and rec and rec["server_id"] is None, repr(rec))
    open_checklist(B, scope, S2_TITLE)
    check("%s checklist task baru kosong ('Belum ada checklist')" % tag,
          p.locator(scope + " .td-empty", has_text="Belum ada checklist").count() == 1)
    add_items(p, scope, ["Langkah 1", "Langkah 2", "<Tab>", "Langkah 2a", "Langkah 2b", "<Shift+Tab>", "Langkah 3"])
    ck.checkbox(p, scope, "Langkah 2").click()
    ok = wait_until(lambda: with_parent(view(p, scope)) == S2_WANT, 5)
    check("%s offline: checklist bertingkat di task baru (Tab/Shift+Tab, centang induk berantai), pill 33%%" % tag,
          ok and wait_until(lambda: ck.pill_label(p, scope) == "Progress 33%, otomatis dari checklist", 5),
          repr((view(p, scope), ck.pill_label(p, scope))))
    shot(p, "s2_task_baru_offline.png")
    ck.close_modal(p)
    check("%s progress daftar task baru '33%%' saat offline" % tag,
          wait_until(lambda: ck.row_pct(p, S2_TITLE) == "33%", 6), repr(ck.row_pct(p, S2_TITLE)))
    q = outbox_subtasks(p)
    check("%s antrean: 5 create + set_done" % tag, sorted(o[0] for o in q) == ["create"] * 5 + ["set_done"], repr(q))
    # Respons tambah butir pertama hilang: diteruskan ke server (server menyimpan) lalu koneksi diputus.
    lost = []

    def lose_first(route):
        if route.request.method == "POST" and not lost:
            resp = route.fetch()
            lost.append(resp.status)
            route.abort("connectionreset")
        else:
            route.continue_()
    pat = re.compile(re.escape(base) + r"/api/tasks/\d+/subtasks$")
    B.ctx.route(pat, lose_first)
    try:
        B.set_offline(False)
        t0 = time.time()
        ok = wait_drain(p, 75)
        check("%s online → antrean kosong walau respons tambah pertama hilang (%.0f dtk; diteruskan ke server: %r)"
              % (tag, time.time() - t0, lost), ok and lost == [200], repr((outbox_subtasks(p), lost)))
    finally:
        B.ctx.unroute(pat, lose_first)
    tasks = [t for t in api(base, user, "GET", "/api/tasks?include_done=true") if t["title"] == S2_TITLE]
    check("%s server: tepat satu task '%s'" % (tag, S2_TITLE), len(tasks) == 1, repr([t["id"] for t in tasks]))
    tid = tasks[0]["id"] if tasks else None
    items = srv_items(base, user, tid) if tid else []
    check("%s server: checklist bertingkat sama persis, tanpa butir ganda (kirim ulang tambah idempoten)" % tag,
          tid and srv_tree(base, user, tid) == S2_WANT and len(items) == 5, repr(srv_tree(base, user, tid) if tid else None))
    st = srv_task(base, user, tid) if tid else {}
    check("%s server progress 33, checklist_total 3" % tag, st.get("progress") == 33 and st.get("checklist_total") == 3,
          repr((st.get("progress"), st.get("checklist_total"))))
    open_checklist(B, scope, S2_TITLE)
    check("%s tampilan perangkat B sesudah sinkron = server" % tag, with_parent(view(p, scope)) == S2_WANT, repr(view(p, scope)))
    ck.close_modal(p)
    return tid


# ── S3 ────────────────────────────────────────────────────────────────────────

def s3_conflict(B, base, user, tid):
    tag = "S3"
    p = B.p
    scope = MODAL
    konsumsi = next(i["id"] for i in srv_items(base, user, tid) if i["title"] == "Konsumsi")
    open_checklist(B, scope, S1_TITLE)
    B.set_offline(True)
    ok1 = edit_text(p, scope, "Konsumsi", "Konsumsi makan siang")
    ck.checkbox(p, scope, "Konsumsi makan siang").click()
    ok2 = wait_until(lambda: dict((r[0], r[2]) for r in view(p, scope)).get("Konsumsi makan siang") is True, 5)
    ok3 = edit_text(p, scope, "Cetak brosur", "Cetak brosur A5")
    check("%s offline: ubah teks + centang butir X ('Konsumsi'), ubah teks butir Y ('Cetak brosur')" % tag,
          ok1 and ok2 and ok3, repr(view(p, scope)))
    ck.close_modal(p)
    check("%s progress daftar offline '40%%' (2/5)" % tag, wait_until(lambda: ck.row_pct(p, S1_TITLE) == "40%", 6),
          repr(ck.row_pct(p, S1_TITLE)))
    api(base, user, "DELETE", "/api/subtasks/%d" % konsumsi)  # perangkat lain menghapus X
    p.evaluate("() => { window.__toasts = []; window.__rejected = []; }")
    B.set_offline(False)
    ok = wait_until(lambda: len(checklist_toasts(p)) > 0, 25)
    t0 = time.time()
    pct_ok = wait_until(lambda: ck.row_pct(p, S1_TITLE) == "25%", 6, 0.2)
    dt = time.time() - t0
    shot(p, "s3_toast_bentrok.png")
    wait_drain(p, 20)
    p.wait_for_timeout(5000)  # sinkron ulang sesudah pesan: tidak boleh ada pesan kedua
    tt = checklist_toasts(p)
    check("%s tepat SATU toast bentrok, bertipe galat, berteks persis" % tag,
          ok and len(tt) == 1 and tt[0][1] == TOAST_TEXT % 2 and "toast-error" in tt[0][0], repr(tt))
    check("%s event tf:checklist-rejected sekali {count: 2}" % tag, p.evaluate("() => window.__rejected") == [{"count": 2}],
          repr(p.evaluate("() => window.__rejected")))
    srv = srv_tree(base, user, tid)
    check("%s server: X tetap terhapus (perubahan X dibatalkan), perubahan Y terkirim" % tag, srv == S3_WANT, repr(srv))
    cid = task_cid(p, tid)
    ok = wait_until(lambda: local_items(p, cid) == strip(S3_WANT)
                    and revs(p).get(cid) == srv_task(base, user, tid)["checklist_rev"], 20)
    check("%s checklist lokal diambil ulang = server, rev tersimpan = rev server" % tag, ok, repr(local_items(p, cid)))
    # Tanpa muat ulang daftar sesudah pesan, angka yang dibatalkan ('40%') bertahan sampai refresh 30 dtk berikutnya.
    check("%s progress daftar kembali = server '25%%' segera sesudah pesan (%.1f dtk, < 6 dtk)" % (tag, dt),
          pct_ok and srv_task(base, user, tid)["progress"] == 25, repr(ck.row_pct(p, S1_TITLE)))
    open_checklist(B, scope, S1_TITLE)
    check("%s tampilan dibuka ulang = server" % tag, with_parent(view(p, scope)) == S3_WANT, repr(view(p, scope)))
    ck.close_modal(p)


# ── S4 ────────────────────────────────────────────────────────────────────────

def s4_new_device(browser, base, user):
    tag = "S4"
    C = open_dev(browser, base, user, "C375", 375, 812, "dark", "0", login=True)
    p = C.p
    try:
        check("%s perangkat baru: login lewat formulir berhasil" % tag, p.evaluate("() => !!localStorage.getItem('tf_token')"))
        ok = wait_until(lambda: is_ready(p), 40)
        tasks = api(base, user, "GET", "/api/tasks?include_done=true")
        bad, n_cl = [], 0
        lr = revs(p)
        for t in tasks:
            cid = task_cid(p, t["id"])
            want = strip(srv_tree(base, user, t["id"]))
            n_cl += 1 if want else 0
            if not cid or local_items(p, cid) != want or lr.get(cid) != t.get("checklist_rev"):
                bad.append((t["title"], cid, lr.get(cid) if cid else None, t.get("checklist_rev")))
        check("%s unduhan awal: SEMUA checklist (%d task bercheklist dari %d) isi + rev = server" % (tag, n_cl, len(tasks)),
              ok and not bad and n_cl >= 3, repr(bad))
        d.go_all_tasks(p, True)
        wait_until(lambda: p.locator(".task-row", has_text=S4_TITLE).count() > 0, 15)
        C.set_offline(True)
        k = len(C.net)
        open_checklist(C, MODAL, S4_TITLE)
        check("%s offline: checklist task yang belum pernah dibuka perangkat mana pun tampil (= server)" % tag,
              with_parent(view(p, MODAL)) == S4_INIT, repr(view(p, MODAL)))
        ck.checkbox(p, MODAL, "Bab A.2").click()
        add_items(p, MODAL, ["Bab C"])
        check("%s offline: centang + tambah butir berhasil lokal" % tag,
              wait_until(lambda: with_parent(view(p, MODAL)) == S4_WANT, 5)
              and ck.pill_label(p, MODAL) == "Progress 33%, otomatis dari checklist",
              repr((view(p, MODAL), ck.pill_label(p, MODAL))))
        shot(p, "s4_perangkat_baru_offline.png")
        for title, want in ((S1_TITLE, S3_WANT), (S2_TITLE, S2_WANT)):
            open_checklist(C, MODAL, title)
            check("%s offline: checklist '%s' tampil (= server)" % (tag, title), with_parent(view(p, MODAL)) == want,
                  repr(view(p, MODAL)))
        ck.close_modal(p)
        cl_net = [x for x in C.net[k:] if "/subtasks" in x[1] or x[1].startswith("/api/checklists")]
        check("%s offline: tanpa request jaringan checklist (semua dari lokal)" % tag, not cl_net, repr(cl_net[:5]))
        C.set_offline(False)
        ok = wait_drain(p, 40)
        tid = next(t["id"] for t in tasks if t["title"] == S4_TITLE)
        check("%s online → server '%s' sama dengan perangkat baru" % (tag, S4_TITLE),
              ok and srv_tree(base, user, tid) == S4_WANT and srv_task(base, user, tid)["progress"] == 33,
              repr(srv_tree(base, user, tid)))
    finally:
        C.ctx.close()


# ── S8 dua tab online bersamaan ───────────────────────────────────────────────

S8_TITLE = "Dua tab sekaligus"
S8_INIT = [("X satu", 0, None, False), ("Y dua", 0, None, False), ("Z tiga", 0, None, False)]
S8_WANT = [("X satu", 0, None, False), ("Y dua diubah", 0, None, False)]


def s8_two_tabs_online(browser, base, user, tid, z_id):
    tag = "S8"
    ctx = browser.new_context(service_workers="block", viewport={"width": 1280, "height": 860}, device_scale_factor=1,
                              timezone_id="Asia/Jakarta")
    ctx.add_cookies([{"name": "token", "value": user["token"], "url": base, "httpOnly": True, "sameSite": "Lax"}])
    ctx.route(re.compile(r"^(?!http://127\.0\.0\.1).*$"), lambda r: r.abort())
    ctx.add_init_script(TOAST_INIT)
    sent = []  # (method, path, body) mutasi checklist yang keluar dari tab mana pun (level context)

    def on_req(r):
        if not r.url.startswith(base):
            return
        pth = r.url[len(base):].split("?")[0]
        if r.method != "GET" and (pth.startswith("/api/subtasks/") or re.fullmatch(r"/api/tasks/\d+/subtasks", pth)):
            sent.append((r.method, pth, r.post_data))
    ctx.on("request", on_req)
    try:
        tabs = []
        for i in (1, 2):
            p = ctx.new_page()
            dv = Dev("S8-tab%d" % i, ctx, p, base)
            devices.append(dv)
            attach(dv, p)
            if i == 1:
                p.goto(base + "/manifest.json")
                seed_storage(p, user, "light", "0", d.SW_VERSION)
            p.goto(base + "/")
            wait_shell(p)
            tabs.append(dv)
        t1, t2 = tabs
        ok = all(wait_until(lambda dv=dv: is_ready(dv.p), 30) for dv in tabs)
        check("%s dua tab satu context: unduhan awal selesai di keduanya" % tag, ok)
        check("%s navigator.locks tersedia (Chromium)" % tag, t1.p.evaluate("() => !!(navigator.locks && navigator.locks.request)"))
        d.go_all_tasks(t1.p, False)
        ctx.set_offline(True)
        for dv in tabs:
            dv.offline = True
        for dv in tabs:
            dv.p.wait_for_function("() => navigator.onLine === false", timeout=5000)
        open_checklist(t1, MODAL, S8_TITLE)
        p = t1.p
        for _ in range(4):  # centang / buka centang berulang → set_done true, false, true, false
            want_done = not dict((r[0], r[2]) for r in view(p, MODAL))["X satu"]
            ck.checkbox(p, MODAL, "X satu").click()
            wait_until(lambda: dict((r[0], r[2]) for r in view(p, MODAL))["X satu"] is want_done, 5)
        ok1 = edit_text(p, MODAL, "Y dua", "Y dua diubah")
        ok2 = edit_text(p, MODAL, "Z tiga", "Z tiga diubah")
        ck.close_modal(p)
        q = outbox_subtasks(p)
        check("%s offline di tab 1: antrean set_done ×4 + rename ×2" % tag,
              ok1 and ok2 and [o[0] for o in q] == ["set_done"] * 4 + ["rename"] * 2, repr(q))
        api(base, user, "DELETE", "/api/subtasks/%d" % z_id)  # perangkat lain menghapus Z
        for dv in tabs:
            dv.p.evaluate("() => { window.__toasts = []; window.__rejected = []; }")
            # Catat hasil pushOutbox per tab (dipanggil index.html lewat properti → pembungkus berlaku): busy karena kunci
            # dipegang tab lain = bukti kedua tab memang mencoba menguras bersamaan.
            dv.p.evaluate("""() => { const sp = TF.syncpush, orig = sp.pushOutbox; window.__pushRes = [];
                sp.pushOutbox = (...a) => orig(...a).then((r) => { window.__pushRes.push(r ? {pushed: r.pushed,
                    locked: !!r.lockedElsewhere} : null); return r; }); }""")
        ctx.set_offline(False)
        for dv in tabs:
            dv.offline = False
        ok = wait_drain(p, 40)
        wait_until(lambda: sum(len(checklist_toasts(dv.p)) for dv in tabs) > 0, 15)
        p.wait_for_timeout(6000)  # sinkron ulang / push susulan kedua tab selesai: tidak boleh ada kiriman/pesan kedua
        check("%s online: antrean kosong" % tag, ok and outbox_n(p) == 0, repr(outbox_subtasks(p)))
        push_res = [dv.p.evaluate("() => window.__pushRes") for dv in tabs]
        print("  hasil pushOutbox per tab:", push_res, flush=True)
        patches = [x for x in sent if x[0] == "PATCH"]
        bodies = [json.loads(x[2] or "{}") for x in patches]
        n_locked = sum(1 for res in push_res for x in res if x and x["locked"])
        check("%s setiap aksi terkirim tepat sekali walau dua tab sinkron bersamaan (6 PATCH: centang ×4, ubah teks ×2; "
              "push dilewati karena kunci dipegang tab lain: %d×)" % (tag, n_locked),
              len(sent) == 6 and [b.get("is_done") for b in bodies[:4]] == [True, False, True, False]
              and [b.get("title") for b in bodies[4:]] == ["Y dua diubah", "Z tiga diubah"], repr(sent))
        srv = srv_tree(base, user, tid)
        check("%s server: X belum dicentang (aksi terakhir), Y diubah, Z terhapus (perubahan Z dibatalkan)" % tag,
              srv == S8_WANT, repr(srv))
        cid = task_cid(p, tid)
        ok = wait_until(lambda: local_items(t1.p, cid) == strip(S8_WANT) and local_items(t2.p, cid) == strip(S8_WANT)
                        and revs(t1.p).get(cid) == srv_task(base, user, tid)["checklist_rev"], 45, 0.5)
        check("%s lokal kedua tab = server, rev tersimpan = rev server" % tag, ok,
              repr((local_items(t1.p, cid), local_items(t2.p, cid), revs(t1.p).get(cid), srv_task(base, user, tid)["checklist_rev"])))
        per_tab = [len(checklist_toasts(dv.p)) for dv in tabs]
        texts = [t[1] for dv in tabs for t in checklist_toasts(dv.p)]
        check("%s toast bentrok paling banyak sekali per tab, sekali total (tab pemegang kunci): %s" % (tag, per_tab),
              all(n <= 1 for n in per_tab) and sum(per_tab) == 1 and texts == [TOAST_TEXT % 1], repr(texts))
        d.go_all_tasks(t2.p, False)
        open_checklist(t2, MODAL, S8_TITLE)
        check("%s tab 2: checklist = server" % tag, with_parent(view(t2.p, MODAL)) == S8_WANT, repr(view(t2.p, MODAL)))
        shot(t2.p, "s8_tab2.png")
        ck.close_modal(t2.p)
    finally:
        ctx.close()


# ── S6 tab lama ───────────────────────────────────────────────────────────────

def main_static(tmp):
    """Salinan static/ origin/main (git archive) → direktori; None bila gagal."""
    out = os.path.join(tmp, "main_static")
    os.makedirs(out, exist_ok=True)
    tar = os.path.join(tmp, "main_static.tar")
    r = subprocess.run(["git", "archive", "-o", tar, "origin/main", "static"], cwd=ROOT, capture_output=True, text=True)
    if r.returncode != 0:
        print("  git archive gagal:", r.stderr[:200])
        return None
    with tarfile.open(tar) as tf:
        try:
            tf.extractall(out, filter="data")
        except TypeError:  # Python < 3.12
            tf.extractall(out)
    return out


def old_page(ctx, base, root):
    """Halaman yang index + /static/* dilayani dari salinan origin/main (API tetap ke server lokal)."""
    p = ctx.new_page()

    def handle(route):
        url = route.request.url
        pth = url[len(base):].split("?")[0] if url.startswith(base) else None
        if pth is None or pth.startswith("/api/") or pth in ("/manifest.json", "/sw.js"):
            return route.continue_()
        f = os.path.join(root, "static", "index.html") if pth in ("/", "/index.html") else os.path.join(root, pth.lstrip("/"))
        if not os.path.isfile(f):
            return route.continue_()
        with open(f, "rb") as fh:
            route.fulfill(status=200, body=fh.read(),
                          headers={"Content-Type": mimetypes.guess_type(f)[0] or "application/octet-stream", "Cache-Control": "no-store"})
    p.route(re.compile(r"^http://127\.0\.0\.1.*"), handle)
    return p


def s6_old_tab(browser, base, user, tmp):
    tag = "S6"
    root = main_static(tmp)
    if not root:
        check("%s salinan static origin/main tersedia" % tag, False)
        return
    with open(os.path.join(root, "static", "sw.js")) as fh:
        old_ver = re.search(r'^const CACHE = "([^"]+)";', fh.read(), re.M).group(1)
    ctx = browser.new_context(service_workers="block", viewport={"width": 1280, "height": 860}, timezone_id="Asia/Jakarta")
    ctx.add_cookies([{"name": "token", "value": user["token"], "url": base, "httpOnly": True, "sameSite": "Lax"}])
    ctx.route(re.compile(r"^(?!http://127\.0\.0\.1).*$"), lambda r: r.abort())
    ctx.add_init_script(TOAST_INIT)
    try:
        a = old_page(ctx, base, root)
        a.goto(base + "/manifest.json")
        seed_storage(a, user, "light", "0", old_ver)
        a.goto(base + "/")
        wait_shell(a)
        va = a.evaluate("async () => (await TF.db.openDB()).version")
        check("%s tab lama (static origin/main %s) memakai IndexedDB v7" % (tag, old_ver), va == 7, va)
        a.wait_for_timeout(3000)  # sinkron awal tab lama
        a.evaluate("(v) => localStorage.setItem('tf_whatsnew_seen', v)", d.SW_VERSION)
        b = ctx.new_page()
        nb = Dev("tab-baru", ctx, b, base)
        devices.append(nb)
        attach(nb, b)
        b.goto(base + "/")
        wait_shell(b)
        vb = b.evaluate("async () => (await TF.db.openDB()).version")
        check("%s tab baru membuka IndexedDB v8" % tag, vb == 8, vb)
        ok = wait_until(lambda: a.locator("#tf-db-banner").count() == 1, 10)
        txt = a.locator("#tf-db-banner").inner_text() if ok else None
        check("%s tab lama menampilkan banner '%s'" % (tag, BANNER_TEXT), ok and BANNER_TEXT in txt, repr(txt))
        shot(a, "s6_tab_lama_banner.png")
        wait_until(lambda: is_ready(b), 30)
        d.go_all_tasks(b, False)
        nb.set_offline(True)
        open_checklist(nb, MODAL, S2_TITLE)
        add_items(b, MODAL, ["Dari tab baru"])
        ck.close_modal(b)
        n1 = len(outbox_subtasks(b))
        check("%s tab baru (offline) menulis entri antrean subtasks lewat tampilan" % tag, n1 == 1, n1)
        res = a.evaluate("""async () => { try { const r = await (window.__pushNow ? window.__pushNow()
                : TF.syncpush.pushOutbox({request: () => Promise.reject(new TypeError('x'))}));
            return {ok: true, r: r}; } catch (e) { return {ok: false, err: String(e && (e.code || e.message || e))}; } }""")
        n2 = len(outbox_subtasks(b))
        check("%s push tab lama tidak menyentuh antrean (DB_UPGRADED_ELSEWHERE); entri subtasks utuh" % tag,
              not res["ok"] and "DB_UPGRADED_ELSEWHERE" in res["err"] and n2 == 1, repr((res, n2)))
        nb.set_offline(False)
        ok = wait_drain(b, 30)
        tid = next(t["id"] for t in api(base, user, "GET", "/api/tasks?include_done=true") if t["title"] == S2_TITLE)
        srv = [t for t, _dep, _par, _done in srv_tree(base, user, tid)]
        check("%s tab baru online → entri terkirim, server memuat butir dari tab baru (sekali)" % tag,
              ok and srv.count("Dari tab baru") == 1, repr(srv))
    finally:
        ctx.close()


# ── S7 ────────────────────────────────────────────────────────────────────────

def s7_errors(conflict_ids, n_conflict):
    """Galat konsol / respons >= 400 yang diharapkan: jaringan terputus (offline), 503 jawaban SW saat offline, koneksi
    yang sengaja diputus di S2, dan PATCH 404 bentrok S3 / S8 (butir yang dihapus perangkat lain)."""
    x_paths = {"/api/subtasks/%d" % i for i in conflict_ids}
    unexpected, expected = [], 0
    for dev in devices:
        for kind, text, pth, off in dev.events:
            net = ("ERR_INTERNET_DISCONNECTED" in text or "Failed to fetch" in text or "ERR_CONNECTION_RESET" in text
                   or "NetworkError" in text)
            sw503 = off and ("status of 503" in text or kind.startswith("response 503"))
            conflict = pth in x_paths and ("status of 404" in text or kind == "response 404 PATCH")
            if net or sw503 or conflict:
                expected += 1
            else:
                unexpected.append((dev.label, kind, text, pth))
    check("S7 galat konsol / respons >= 400 hanya jaringan terputus + PATCH 404 bentrok S3/S8 (%d diharapkan)" % expected,
          not unexpected, repr(unexpected[:8]))
    conflict404 = [(dv.label, k) for dv in devices for k, _t, pth, _o in dv.events if pth in x_paths and k.startswith("response")]
    check("S7 PATCH 404 bentrok tepat %d (S3: ubah teks + centang X; S8: ubah teks Z, sekali walau dua tab)" % n_conflict,
          len(conflict404) == n_conflict, repr(conflict404))


# ── main ──────────────────────────────────────────────────────────────────────

def want(name):
    only = [x for x in os.environ.get("E2E_ONLY", "").split(",") if x]
    return not only or name in only


def main():
    os.makedirs(SHOTS, exist_ok=True)
    for f in os.listdir(SHOTS):
        if f.endswith(".png"):
            os.remove(os.path.join(SHOTS, f))
    tmp = tempfile.mkdtemp(prefix="e2e_checklist_offline_")
    proc, base = ck.launch(tmp)
    head = subprocess.run(["git", "rev-parse", "--short", "HEAD"], cwd=ROOT, capture_output=True, text=True).stdout.strip()
    print("server", base, "@", head, "| klien SW", d.SW_VERSION, flush=True)
    user = d.register(base, "clo")
    tid = ck.mk_task(base, user, S1_TITLE)
    ids = ck.mk_items(base, user, tid, [("d", "Desain booth", None, False), ("d1", "Sketsa awal", "d", False),
                                        ("d2", "Revisi warna", "d", False), ("c", "Cetak brosur", None, False),
                                        ("k", "Kirim undangan", None, False), ("s", "Sewa peralatan", None, False),
                                        ("s1", "Kursi", "s", False), ("s2", "Meja", "s", False),
                                        ("m", "Konsumsi", None, False)])
    ck.mk_task(base, user, OTHER_TITLE)
    t4 = ck.mk_task(base, user, S4_TITLE)
    ck.mk_items(base, user, t4, [("a", "Bab A", None, False), ("a1", "Bab A.1", "a", True), ("a2", "Bab A.2", "a", False),
                                 ("a2x", "Bab A.2.x", "a2", False), ("b", "Bab B", None, True)])
    t8 = ck.mk_task(base, user, S8_TITLE)
    ids8 = ck.mk_items(base, user, t8, [("x", "X satu", None, False), ("y", "Y dua", None, False), ("z", "Z tiga", None, False)])
    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            if want("utama"):
                A = open_dev(browser, base, user, "A1280", 1280, 860, "light", "1", sw=True)
                B = None
                for name, fn in (("S1", lambda: s1_offline(A, base, user, tid)),):
                    print("== %s ==" % name, flush=True)
                    try:
                        fn()
                    except Exception as e:  # noqa: BLE001
                        fail_exc(name, e, A.p)
                try:
                    B = open_dev(browser, base, user, "B1280", 1280, 860, "light", "0")
                    for name, fn in (("S1-B", lambda: s1_second_device(B, base, user, tid)),
                                     ("S2", lambda: s2_new_task(B, base, user)),
                                     ("S3", lambda: s3_conflict(B, base, user, tid))):
                        print("== %s ==" % name, flush=True)
                        try:
                            fn()
                        except Exception as e:  # noqa: BLE001
                            fail_exc(name, e, B.p)
                    print("== S4 ==", flush=True)
                    try:
                        s4_new_device(browser, base, user)
                    except Exception as e:  # noqa: BLE001
                        fail_exc("S4", e)
                    print("== S8 ==", flush=True)
                    try:
                        s8_two_tabs_online(browser, base, user, t8, ids8["z"])
                    except Exception as e:  # noqa: BLE001
                        fail_exc("S8", e)
                finally:
                    A.ctx.close()
                    if B:
                        B.ctx.close()
                s7_errors([ids["m"], ids8["z"]], 3)
            if want("tab"):
                print("== S6 ==", flush=True)
                try:
                    if not want("utama"):
                        t2 = ck.mk_task(base, user, S2_TITLE)
                        ck.mk_items(base, user, t2, [("l", "Langkah 1", None, False)])
                    s6_old_tab(browser, base, user, tmp)
                except Exception as e:  # noqa: BLE001
                    fail_exc("S6", e)
            browser.close()
    finally:
        ck.stop(proc)
        print("server log:", os.path.join(tmp, "server.log"))
    failed = [r for r in results if not r[1]]
    by = {}
    for name, ok, _n in results:
        k = name.split()[0]
        a, b = by.get(k, (0, 0))
        by[k] = (a + (1 if ok else 0), b + 1)
    print("\nper skenario: " + ", ".join("%s %d/%d" % (k, a, b) for k, (a, b) in by.items()))
    print("%d/%d lulus" % (len(results) - len(failed), len(results)))
    for r in failed:
        print("  FAIL:", r[0], "—", r[2])
    if not failed:
        shutil.rmtree(tmp, ignore_errors=True)
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
