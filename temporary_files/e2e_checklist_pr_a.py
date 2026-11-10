"""E2E PR A checklist bertingkat: klien SEKARANG (static/ tidak berubah, SW v500) + server baru. Tidak dijalankan CI.

TIDAK BERLAKU SETELAH PR B (rencana docs/superpowers/plans/2026-11-10-checklist-bertingkat-pr-b-ui.md R11): skrip ini
mengunci perilaku klien LAMA sampai SW v501 (`.td-check-row` datar tanpa indentasi, × "Hapus butir", label/bar dan panel
Fokus menghitung semua butir, pill membulatkan ke kelipatan 5, progress dari checklist tidak sampai ke perangkat yang
sudah menyimpan task, slider tetap bisa digeser). PR B mengubah semua itu dengan sengaja, jadi skrip ini tidak dijalankan
sebagai regresi lagi; cek server yang masih relevan ditiru di temporary_files/e2e_checklist_tree.py. Simpan sebagai
catatan jendela deploy PR A -> PR B.

Membuktikan jendela deploy PR A -> PR B (rencana docs/superpowers/plans/2026-11-09-checklist-bertingkat-pr-a-server.md
Task 11, ADR-048): UI yang sekarang tetap berjalan dengan server checklist bertingkat. Satu pengguna, perangkat D1
(panel Live Edit 1280 px terang) dan, di akhir, perangkat D2 (login yang sama, konteks browser + IndexedDB bersih).

 1 Detail task: tab Checklist -> tambah 3 butir -> "Checklist (3)", bar 0/3; server 3 butir level atas, progress 0,
   checklist_total 3, updated_at task tetap; centang satu -> respons toggle changed_ids/task_progress, server progress 33,
   updated_at tetap. Angka progress di UI: D1 (segera / setelah sinkron / setelah muat ulang halaman) dicatat sebagai
   INFO (progress bukan TASK_DERIVED di klien sekarang dan updated_at tidak naik → D1 tetap 0%); D2 (task dimuat dari
   server, IndexedDB bersih) = lokal 33, baris daftar "33%", pill "35%" (pill klien sekarang membulatkan ke kelipatan 5
   lewat TF.taskdetail.clampProgress — bukan galat server).
 2 Sub butir dari API (POST {parent_id}) -> UI menampilkan anak tepat di bawah induk, tanpa indentasi, tanpa galat
   konsol; centang induk di UI -> changed_ids = induk + anak, server menandai anak selesai; UI menampilkan anak
   tercentang setelah daftar dimuat ulang (pindah task lalu kembali).
 3 Slider lama pada task bercheklist (server 33): geser ke 80 -> tanpa bilah "gagal disinkronkan"; server tetap 33;
   D1 tetap 80 setelah sinkron dan muat ulang (residual ADR-048); D2 menampilkan angka checklist (baris "33%", pill
   "35%").
 4 Slider pada task tanpa checklist: 40 tersimpan di server; D2 menampilkan 40.
 5 Halaman Fokus: task dengan 2 butir level atas + 2 sub butir (API; satu sub butir selesai) -> child-counts 0/2,
   badge 0/2 (bukan 1/4). Badge setelah panel Fokus dibuka dicatat sebagai INFO (klien lama menghitung semua butir).
 6 Hapus induk dari UI -> respons deleted_ids = induk + turunan, server tidak memuat turunan; UI setelah dimuat ulang
   hanya butir sisa.
 Z Tanpa galat konsol/pageerror di D1/D2; setiap respons >= 400 dari server lokal dicetak.

Server lokal dijalankan sendiri (uvicorn webapp:app, DB sementara, port bebas > 8700). Kode server = ROOT (branch ini)
atau E2E_SERVER_ROOT (mis. worktree `main` untuk membandingkan galat konsol; cek perilaku server baru tentu gagal di
sana). Screenshot: temporary_files/e2e_checklist_pr_a/ (atau $E2E_SHOTS_DIR). Keluar non-zero bila ada langkah gagal.

    E2E_PYTHON=$(which python3) TZ=Asia/Jakarta python3 temporary_files/e2e_checklist_pr_a.py
    E2E_SERVER_ROOT=/tmp/wt-main E2E_PYTHON=$(which python3) TZ=Asia/Jakarta python3 temporary_files/e2e_checklist_pr_a.py
"""
import datetime
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
import e2e_detail_redesign as d  # noqa: E402  (go_all_tasks, click_row, tab_labels, outbox_count, wait_until, …)

ROOT = d.ROOT
SERVER_ROOT = os.path.abspath(os.environ.get("E2E_SERVER_ROOT") or ROOT)
SHOTS = os.environ.get("E2E_SHOTS_DIR") or os.path.join(ROOT, "temporary_files", "e2e_checklist_pr_a")
SECRET = "e2e-checklist-pr-a-secret"
PANEL = d.PANEL
POP = d.POP
wait_until = d.wait_until

T1 = "Rapikan arsip proyek"        # 1: checklist dibuat lewat UI
T2 = "Siapkan materi rapat"        # 2: sub butir dari API
T3 = "Perbarui SOP gudang"         # 3: slider pada task bercheklist
T4 = "Hubungi pemasok kertas"      # 4: slider tanpa checklist
T5 = "Tinjau laporan harian"       # 5: halaman Fokus
T6 = "Bersihkan daftar periksa"    # 6: hapus induk

results = []   # (langkah, ok, keterangan)
infos = []     # (langkah, nilai)
bad_responses = []  # (perangkat, method, path, status)


def check(step, ok, note=""):
    results.append((step, bool(ok), note))
    print(("PASS " if ok else "FAIL ") + step + (" — " + note if note else ""), flush=True)
    return ok


def info(step, val):
    infos.append((step, val))
    print("  INFO %s: %s" % (step, val), flush=True)


# ── server ────────────────────────────────────────────────────────────────────

def free_port(start=8711, end=8999):
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


def server_python():
    return os.environ.get("E2E_PYTHON") or sys.executable


def launch(cwd, tmp, port):
    env = dict(os.environ, DB_PATH=os.path.join(tmp, "e2e.db"), UPLOAD_DIR=os.path.join(tmp, "uploads"),
               WEB_SECRET_KEY=SECRET, TELEGRAM_BOT_TOKEN="")
    os.makedirs(env["UPLOAD_DIR"], exist_ok=True)
    log = open(os.path.join(tmp, "server.log"), "w")
    proc = subprocess.Popen([server_python(), "-m", "uvicorn", "webapp:app", "--host", "127.0.0.1",
                             "--port", str(port)], cwd=cwd, env=env, stdout=log, stderr=subprocess.STDOUT)
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


def srv_task(base, user, tid):
    return api(base, user, "GET", "/api/tasks/%d" % tid)


def srv_items(base, user, tid):
    return api(base, user, "GET", "/api/tasks/%d/subtasks" % tid)


def add_item(base, user, tid, title, parent_id=None):
    body = {"title": title}
    if parent_id is not None:
        body["parent_id"] = parent_id
    return api(base, user, "POST", "/api/tasks/%d/subtasks" % tid, json=body)["id"]


def seed(base, user):
    ids, items = {}, {}
    today = datetime.date.today().isoformat()
    for title in (T1, T2, T3, T4, T5, T6):
        body = {"title": title, "priority": "P2", "gtd_status": "next"}
        if title == T5:
            body.update(priority="P1", deadline=today)  # masuk Fokus Hari Ini
        ids[title] = api(base, user, "POST", "/api/tasks", json=body)["id"]
    # 2: induk A, induk B, LALU anak A1 (id terbesar) → urutan datar per id akan menaruh A1 paling bawah.
    items["A"] = add_item(base, user, ids[T2], "Induk A")
    items["B"] = add_item(base, user, ids[T2], "Induk B")
    items["A1"] = add_item(base, user, ids[T2], "Anak A1", parent_id=items["A"])
    # 3: tiga butir, satu selesai → progress server 33 sebelum D1 memuat task.
    for k in ("satu", "dua", "tiga"):
        items["L" + k] = add_item(base, user, ids[T3], "Langkah " + k)
    api(base, user, "POST", "/api/subtasks/%d/toggle" % items["Lsatu"])
    # 5: dua butir level atas + dua sub butir; satu sub butir selesai → level atas 0/2, semua butir 1/4.
    items["B1"] = add_item(base, user, ids[T5], "Bagian 1")
    items["B2"] = add_item(base, user, ids[T5], "Bagian 2")
    items["S1a"] = add_item(base, user, ids[T5], "Sub 1a", parent_id=items["B1"])
    items["S2a"] = add_item(base, user, ids[T5], "Sub 2a", parent_id=items["B2"])
    api(base, user, "POST", "/api/subtasks/%d/toggle" % items["S2a"])
    # 6: induk X (anak X1, cucu X1a) + induk Y.
    items["X"] = add_item(base, user, ids[T6], "Induk X")
    items["Y"] = add_item(base, user, ids[T6], "Induk Y")
    items["X1"] = add_item(base, user, ids[T6], "Anak X1", parent_id=items["X"])
    items["X1a"] = add_item(base, user, ids[T6], "Cucu X1a", parent_id=items["X1"])
    return ids, items


# ── perangkat ─────────────────────────────────────────────────────────────────

class Dev:
    def __init__(self, ctx, page, label):
        self.ctx, self.p, self.label = ctx, page, label
        self.errors = []
        self.puts = []  # (task_id, body, status, json respons)


def open_app(browser, base, user, label, live="1", w=1280, h=860, theme="light"):
    ctx = browser.new_context(service_workers="block", viewport={"width": w, "height": h}, device_scale_factor=1)
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

    def on_response(r):
        if not r.url.startswith(base):
            return
        path = r.url[len(base):]
        if r.status >= 400:
            bad_responses.append((label, r.request.method, path, r.status))
        m = re.fullmatch(r"/api/tasks/(\d+)", path.split("?")[0])
        if r.request.method == "PUT" and m:
            try:
                body = r.request.post_data_json
            except Exception:  # noqa: BLE001
                body = None
            try:
                js = r.json()
            except Exception:  # noqa: BLE001
                js = None
            dev.puts.append((int(m.group(1)), body, r.status, js))

    p.on("console", on_console)
    p.on("pageerror", lambda e: dev.errors.append("pageerror: " + str(e)[:200]))
    p.on("response", on_response)
    p.on("dialog", lambda dlg: dlg.accept())
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
    }""", [user["token"], user["id"], d.TOURS + ["today"], theme, d.SW_VERSION, live])
    p.goto(base + "/")
    p.locator(".sidebar-link, .sidebar-rail-btn").first.wait_for(state="attached", timeout=20000)
    return dev


def shot(p, name):
    p.mouse.move(5, 5)
    p.wait_for_timeout(300)
    path = os.path.join(SHOTS, name)
    p.screenshot(path=path, full_page=False)
    print("  screenshot", os.path.relpath(path, ROOT), flush=True)


def sync(p, n=2):
    """Dorong outbox + tarik dari server beberapa kali, lalu tunggu outbox tenang."""
    for _ in range(n):
        p.evaluate("""() => Promise.resolve(window.__pushNow && window.__pushNow()).catch(() => {})
            .then(() => Promise.resolve(window.__syncNow && window.__syncNow()).catch(() => {}))""")
        p.wait_for_timeout(500)
    d.settle_outbox(p, quiet=1.5, timeout=20)


def local_progress(p, tid):
    return p.evaluate("async (id) => { const t = await api.get('/api/tasks/' + id); return t ? t.progress : null; }", tid)


def conflict_text(p):
    bar = p.locator("#tf-conflict-bar")
    return bar.first.inner_text().strip() if bar.count() and bar.first.is_visible() else ""


# ── detail (panel Live Edit) ─────────────────────────────────────────────────

def labels(p):
    return d.tab_labels(p, PANEL)


def pill(p):
    """Teks pill Progress di panel detail. Klien sekarang membulatkan ke kelipatan 5 (clampProgress): 33 → '35%'."""
    loc = p.locator(PANEL + " .td-pill")
    return loc.first.inner_text().strip() if loc.count() else None


def row_pct(p, title):
    """Angka progress baris daftar 'Semua Task' (TaskRow: `task.progress%` apa adanya, tanpa pembulatan)."""
    return p.evaluate("""(title) => {
        const r = [...document.querySelectorAll('.task-row')].find(x => x.textContent.includes(title));
        if (!r) return null;
        const s = [...r.querySelectorAll('span')].map(x => x.textContent.trim()).filter(t => /^\\d+%$/.test(t));
        return s.length ? s[s.length - 1] : null; }""", title)


def pct(p, title):
    """(baris daftar, pill) untuk task `title` yang sedang terbuka di panel."""
    return row_pct(p, title), pill(p)


def bar_text(p):
    loc = p.locator(PANEL + " .td-check-head > span")
    return loc.first.inner_text().strip() if loc.count() else None


def ck_rows(p):
    """[(judul, aria-checked, left kotak centang, left judul)] baris checklist di panel, urut DOM."""
    return p.evaluate("""(sel) => [...document.querySelectorAll(sel + ' .td-check-row')].map(r => {
        const cb = r.querySelector('[role=checkbox]'), t = r.querySelector('.td-check-title');
        return [t.textContent.trim(), cb.getAttribute('aria-checked'),
                Math.round(cb.getBoundingClientRect().left), Math.round(t.getBoundingClientRect().left)]; })""", PANEL)


def ck_titles(p):
    return [r[0] for r in ck_rows(p)]


def ck_state(p):
    return {r[0]: r[1] for r in ck_rows(p)}


def open_detail(p, title):
    if not d.click_row(p, title, 10):
        raise AssertionError("panel tidak menampilkan %r" % title)
    # Tab awal dipilih sekali setelah anak/checklist/catatan/lampiran termuat (TaskDetailBody); tunggu agar klik tab
    # di bawah tidak ditimpa pilihan otomatis.
    wait_until(lambda: p.locator(PANEL + ' [role="tab"][aria-selected="true"]').count() == 1
               and p.locator(PANEL + " .td-empty", has_text="Memuat").count() == 0, 10)
    p.wait_for_timeout(500)


def open_checklist(p, title):
    open_detail(p, title)
    d.tab_btn(p, PANEL, "Checklist").click()
    wait_until(lambda: (d.active_tab(p, PANEL) or "").startswith("Checklist"), 5)


def reopen_checklist(p, title, other):
    """Muat ulang daftar checklist dari server: pindah ke task lain lalu kembali (efek subtasks bergantung task.id)."""
    open_detail(p, other)
    open_checklist(p, title)


def row_of(p, title):
    return d.check_row(p, PANEL, title)


def open_progress(p):
    p.locator(PANEL + " .td-pill").first.click()
    rng = p.locator(POP + ' input[type="range"]').first
    rng.wait_for(timeout=3000)
    return rng


def drag_slider(p, rng, target):
    """Geser thumb slider dengan mouse ke `target` (langkah 5); koreksi dengan panah bila meleset. Nilai akhir."""
    box = rng.bounding_box()
    tw = 16  # perkiraan lebar thumb bawaan Chromium

    def x_of(v):
        return box["x"] + tw / 2 + (box["width"] - tw) * v / 100.0

    y = box["y"] + box["height"] / 2
    cur = int(rng.input_value())
    p.mouse.move(x_of(cur), y)
    p.mouse.down()
    for i in range(1, 11):
        p.mouse.move(x_of(cur + (target - cur) * i / 10.0), y)
        p.wait_for_timeout(20)
    p.mouse.up()
    p.wait_for_timeout(200)
    v = int(rng.input_value())
    for _ in range(6):
        if v == target:
            break
        rng.press("ArrowRight" if v < target else "ArrowLeft")
        p.wait_for_timeout(100)
        v = int(rng.input_value())
    return v


def close_pops(p):
    p.keyboard.press("Escape")
    wait_until(lambda: p.locator(POP).count() == 0, 3)


# ── skenario ──────────────────────────────────────────────────────────────────

def s1_detail_ui(dev, base, user, ids):
    p, tid = dev.p, ids[T1]
    e0 = len(dev.errors)
    u0 = srv_task(base, user, tid)["updated_at"]
    open_checklist(p, T1)
    p.locator(PANEL + " button.td-add", has_text="+ Tambah butir checklist baru").first.click()
    p.locator(PANEL + ' input[aria-label="Butir checklist baru"]').first.wait_for(timeout=3000)
    for i in (1, 2, 3):
        p.keyboard.type("Butir %d" % i)
        p.keyboard.press("Enter")
        wait_until(lambda: len(ck_rows(p)) == i, 8)
    p.keyboard.press("Escape")
    check("1a UI: tambah 3 butir → label 'Checklist (3)', bar '0/3'",
          wait_until(lambda: labels(p)[1] == "Checklist (3)" and bar_text(p) == "0/3", 8),
          "label=%r bar=%r" % (labels(p), bar_text(p)))
    srv, items = srv_task(base, user, tid), srv_items(base, user, tid)
    check("1b server: 3 butir level atas (depth 0, parent_id null), progress 0, checklist_total 3, updated_at tetap",
          [(s["title"], s["depth"], s["parent_id"]) for s in items] == [("Butir %d" % i, 0, None) for i in (1, 2, 3)]
          and srv["progress"] == 0 and srv["checklist_total"] == 3 and srv["updated_at"] == u0,
          "items=%r progress=%r total=%r updated_at %r→%r" % ([(s["title"], s["depth"]) for s in items],
                                                              srv["progress"], srv.get("checklist_total"), u0,
                                                              srv["updated_at"]))
    info("1 D1 sebelum centang (baris, pill)", pct(p, T1))
    with p.expect_response(lambda r: r.request.method == "POST" and r.url.endswith("/toggle")) as ri:
        row_of(p, "Butir 1").locator('[role="checkbox"]').click()
    resp = ri.value.json()
    b1 = items[0]["id"]
    check("1c UI: Butir 1 tercentang, bar '1/3'",
          wait_until(lambda: ck_state(p).get("Butir 1") == "true" and bar_text(p) == "1/3", 5),
          "state=%r bar=%r" % (ck_state(p), bar_text(p)))
    check("1d respons toggle: changed_ids [Butir 1], task_progress {done 1, total 3, progress 33}",
          resp.get("changed_ids") == [b1] and resp.get("is_done") is True
          and resp.get("task_progress") == {"done": 1, "total": 3, "progress": 33}, repr(resp))
    srv = srv_task(base, user, tid)
    check("1e server: progress 33, checklist_total 3, updated_at task tidak berubah",
          srv["progress"] == 33 and srv["checklist_total"] == 3 and srv["updated_at"] == u0,
          "progress=%r total=%r updated_at %r→%r" % (srv["progress"], srv["checklist_total"], u0, srv["updated_at"]))
    info("1f D1 segera setelah centang (baris, pill)", pct(p, T1))
    shot(p, "s1_checklist_ui_d1.png")
    sync(p)
    reopen_checklist(p, T1, T4)
    info("1f D1 setelah sinkron (push+pull) + buka ulang detail (baris, pill)", "%r (lokal progress=%r, server=%r)"
         % (pct(p, T1), local_progress(p, tid), srv_task(base, user, tid)["progress"]))
    check("1h tanpa galat konsol (skenario 1)", len(dev.errors) == e0, "; ".join(dev.errors[e0:e0 + 5]))


def s2_sub_from_api(dev, base, user, ids, items):
    p, tid = dev.p, ids[T2]
    e0 = len(dev.errors)
    u0 = srv_task(base, user, tid)["updated_at"]
    open_checklist(p, T2)
    wait_until(lambda: len(ck_rows(p)) == 3, 8)
    rows = ck_rows(p)
    check("2a UI: anak dari API tepat di bawah induk (urutan pre-order server)",
          [r[0] for r in rows] == ["Induk A", "Anak A1", "Induk B"], repr([r[0] for r in rows]))
    lefts = {(r[2], r[3]) for r in rows}
    check("2b UI: tanpa indentasi (kotak centang dan judul anak sejajar induk)", len(lefts) == 1, repr(rows))
    info("2 label/bar UI untuk 2 induk + 1 anak (klien sekarang menghitung semua butir)",
         "label=%r bar=%r; server checklist_total=%r" % (labels(p)[1], bar_text(p),
                                                       srv_task(base, user, tid)["checklist_total"]))
    shot(p, "s2_sub_butir_api_d1.png")
    check("2c tanpa galat konsol saat menampilkan sub butir", len(dev.errors) == e0, "; ".join(dev.errors[e0:e0 + 5]))
    with p.expect_response(lambda r: r.request.method == "POST" and r.url.endswith("/toggle")) as ri:
        row_of(p, "Induk A").locator('[role="checkbox"]').click()
    resp = ri.value.json()
    check("2d respons toggle induk: changed_ids [Induk A, Anak A1], task_progress {1, 2, 50}",
          resp.get("changed_ids") == [items["A"], items["A1"]]
          and resp.get("task_progress") == {"done": 1, "total": 2, "progress": 50}, repr(resp))
    srv = {s["title"]: s["is_done"] for s in srv_items(base, user, tid)}
    st = srv_task(base, user, tid)
    check("2e server: Induk A + Anak A1 selesai, Induk B belum; progress 50; updated_at tetap",
          srv == {"Induk A": True, "Anak A1": True, "Induk B": False} and st["progress"] == 50
          and st["updated_at"] == u0, "items=%r progress=%r updated_at %r→%r" % (srv, st["progress"], u0,
                                                                                  st["updated_at"]))
    p.wait_for_timeout(300)
    info("2f UI segera setelah centang induk (klien sekarang hanya mengganti butir yang diklik)",
         "%r bar=%r" % (ck_state(p), bar_text(p)))
    reopen_checklist(p, T2, T4)
    wait_until(lambda: len(ck_rows(p)) == 3, 8)
    check("2g UI setelah daftar dimuat ulang: Anak A1 tercentang",
          wait_until(lambda: ck_state(p) == {"Induk A": "true", "Anak A1": "true", "Induk B": "false"}, 5),
          repr(ck_state(p)))
    info("2g bar UI setelah dimuat ulang", bar_text(p))
    check("2h tanpa galat konsol (skenario 2)", len(dev.errors) == e0, "; ".join(dev.errors[e0:e0 + 5]))


def s6_delete_parent(dev, base, user, ids, items):
    p, tid = dev.p, ids[T6]
    e0 = len(dev.errors)
    u0 = srv_task(base, user, tid)["updated_at"]
    open_checklist(p, T6)
    wait_until(lambda: len(ck_rows(p)) == 4, 8)
    check("6a UI: induk, anak, cucu, induk berikutnya (pre-order)",
          ck_titles(p) == ["Induk X", "Anak X1", "Cucu X1a", "Induk Y"], repr(ck_titles(p)))
    rx = row_of(p, "Induk X")
    rx.hover()
    with p.expect_response(lambda r: r.request.method == "DELETE" and "/api/subtasks/" in r.url) as ri:
        rx.locator('button[aria-label="Hapus butir"]').click()
    resp = ri.value.json()
    check("6b respons DELETE: ok, deleted_ids [Induk X, Anak X1, Cucu X1a], task_progress total 1",
          resp.get("ok") is True and resp.get("deleted_ids") == [items["X"], items["X1"], items["X1a"]]
          and (resp.get("task_progress") or {}).get("total") == 1, repr(resp))
    st = srv_task(base, user, tid)
    check("6c server: GET checklist hanya Induk Y (turunan ikut terhapus); checklist_total 1; updated_at tetap",
          [s["title"] for s in srv_items(base, user, tid)] == ["Induk Y"] and st["checklist_total"] == 1
          and st["updated_at"] == u0,
          "items=%r total=%r updated_at %r→%r" % ([s["title"] for s in srv_items(base, user, tid)],
                                                  st["checklist_total"], u0, st["updated_at"]))
    p.wait_for_timeout(300)
    info("6d UI segera setelah hapus induk (klien sekarang hanya membuang butir yang diklik)",
         "%r label=%r" % (ck_titles(p), labels(p)[1]))
    shot(p, "s6_setelah_hapus_induk_d1.png")
    reopen_checklist(p, T6, T4)
    check("6e UI setelah daftar dimuat ulang: hanya 'Induk Y', label 'Checklist (1)'",
          wait_until(lambda: ck_titles(p) == ["Induk Y"] and labels(p)[1] == "Checklist (1)", 8),
          "%r %r" % (ck_titles(p), labels(p)))
    check("6f tanpa galat konsol (skenario 6)", len(dev.errors) == e0, "; ".join(dev.errors[e0:e0 + 5]))


def s3_slider_with_checklist(dev, base, user, ids):
    p, tid = dev.p, ids[T3]
    e0, k = len(dev.errors), len(dev.puts)
    open_detail(p, T3)
    srv0 = srv_task(base, user, tid)
    check("3a awal: server progress 33 (checklist 1/3); D1 baris '33%', pill '35%' (clampProgress kelipatan 5)",
          srv0["progress"] == 33 and srv0["checklist_total"] == 3
          and wait_until(lambda: pct(p, T3) == ("33%", "35%"), 5),
          "server=%r (baris, pill)=%r" % (srv0["progress"], pct(p, T3)))
    rng = open_progress(p)
    v = drag_slider(p, rng, 80)
    check("3b slider digeser ke 80 → popover/pill 80%", v == 80 and wait_until(lambda: pill(p) == "80%", 3),
          "slider=%r pill=%r" % (v, pill(p)))
    close_pops(p)
    sync(p, 3)
    puts = [(b, s, j) for (t, b, s, j) in dev.puts[k:] if t == tid]
    info("3 PUT /api/tasks/%d yang lewat jaringan (badan progress, status, respons progress/updated_at)" % tid,
         [((b or {}).get("progress"), s, (j or {}).get("progress"), (j or {}).get("updated_at")) for b, s, j in puts])
    check("3c PUT berisi progress 80 terkirim dan diterima (200); tanpa bilah 'gagal disinkronkan'",
          any((b or {}).get("progress") == 80 and s == 200 for b, s, _ in puts)
          and "gagal disinkronkan" not in conflict_text(p), "puts=%d bar=%r" % (len(puts), conflict_text(p)[:120]))
    srv = srv_task(base, user, tid)
    check("3d server tetap angka checklist: progress 33, checklist_total 3", srv["progress"] == 33
          and srv["checklist_total"] == 3, "progress=%r total=%r" % (srv["progress"], srv["checklist_total"]))
    info("3 updated_at server sebelum/sesudah PUT (ADR-048: payload penuh tetap menaikkan updated_at)",
         "%r → %r" % (srv0["updated_at"], srv["updated_at"]))
    sync(p, 2)
    open_detail(p, T4)
    open_detail(p, T3)
    check("3e D1 setelah sinkron + buka ulang: baris dan pill tetap '80%' (residual ADR-048), lokal 80",
          pct(p, T3) == ("80%", "80%") and local_progress(p, tid) == 80,
          "(baris, pill)=%r lokal=%r" % (pct(p, T3), local_progress(p, tid)))
    check("3f tetap tanpa bilah 'gagal disinkronkan' setelah sinkron berulang", "gagal disinkronkan" not in conflict_text(p),
          conflict_text(p)[:160])
    shot(p, "s3_slider_80_d1.png")
    check("3g tanpa galat konsol (skenario 3)", len(dev.errors) == e0, "; ".join(dev.errors[e0:e0 + 5]))


def s4_slider_without_checklist(dev, base, user, ids):
    p, tid = dev.p, ids[T4]
    e0 = len(dev.errors)
    open_detail(p, T4)
    check("4a awal: pill '0%', server tanpa checklist", pill(p) == "0%"
          and srv_task(base, user, tid)["checklist_total"] == 0, repr(pill(p)))
    rng = open_progress(p)
    v = drag_slider(p, rng, 40)
    close_pops(p)
    check("4b slider digeser ke 40 → pill 40%", v == 40 and pill(p) == "40%", "slider=%r pill=%r" % (v, pill(p)))
    sync(p, 2)
    check("4c server menyimpan progress 40 seperti biasa",
          wait_until(lambda: srv_task(base, user, tid)["progress"] == 40, 20), repr(srv_task(base, user, tid)["progress"]))
    check("4d tanpa bilah 'gagal disinkronkan'; tanpa galat konsol (skenario 4)",
          "gagal disinkronkan" not in conflict_text(p) and len(dev.errors) == e0,
          "bar=%r err=%s" % (conflict_text(p)[:120], "; ".join(dev.errors[e0:e0 + 5])))


def s1_s3_d1_reload(dev, base, user, ids):
    """D1 muat ulang halaman (IndexedDB tetap): jalur 'muat ulang halaman' skenario 1 dan residual skenario 3."""
    p = dev.p
    sync(p)
    d.reload_app(p)
    d.go_all_tasks(p, False)
    wait_until(lambda: p.locator(".task-row", has_text=T1).count() > 0, 15)
    p.wait_for_timeout(800)
    open_detail(p, T1)
    info("1f D1 setelah muat ulang halaman (baris, pill)", "%r (lokal progress=%r, server=%r)"
         % (pct(p, T1), local_progress(p, ids[T1]), srv_task(base, user, ids[T1])["progress"]))
    open_detail(p, T3)
    check("3h D1 setelah muat ulang halaman: baris dan pill tetap '80%' (residual ADR-048), server 33",
          pct(p, T3) == ("80%", "80%") and srv_task(base, user, ids[T3])["progress"] == 33,
          "(baris, pill)=%r server=%r" % (pct(p, T3), srv_task(base, user, ids[T3])["progress"]))


def s5_focus(dev, base, user, ids):
    p, tid = dev.p, ids[T5]
    e0 = len(dev.errors)
    cc = api(base, user, "GET", "/api/tasks/child-counts?ids=%d" % tid)["counts"][str(tid)]
    check("5a server child-counts: sub_total 2, sub_done 0 (hanya level atas; semua butir 1/4)",
          cc.get("sub_total") == 2 and cc.get("sub_done") == 0, repr(cc))
    d.expand_sidebar(p)
    p.locator(".sidebar-link", has_text="Fokus Hari Ini").first.click()
    r = p.locator(".ftask").filter(has_text=T5).first
    r.wait_for(state="visible", timeout=20000)
    badge = r.locator('.ftask-count[title="Checklist"]')
    wait_until(lambda: badge.count() == 1, 10)
    btxt = badge.first.inner_text().strip() if badge.count() else None
    check("5b badge checklist baris Fokus = '0/2' (level atas), bukan '1/4'", btxt == "0/2", repr(btxt))
    shot(p, "s5_fokus_badge_d1.png")
    r.locator(".ftask-title").click()
    subs = r.locator(".ftask-sub")
    wait_until(lambda: subs.count() == 4, 10)
    titles = [t.strip() for t in r.locator(".ftask-sub-title").all_inner_texts()]
    check("5c panel Fokus terbuka: butir tampil pre-order (anak di bawah induk)",
          titles == ["Bagian 1", "Sub 1a", "Bagian 2", "Sub 2a"], repr(titles))
    p.wait_for_timeout(500)
    tabc = r.locator(".ftask-tab-count")
    info("5d badge/tab Checklist setelah panel Fokus dibuka (klien sekarang menghitung semua butir)",
         "badge=%r tab=%r progres panel=%r" % (badge.first.inner_text().strip() if badge.count() else None,
                                               tabc.first.inner_text().strip() if tabc.count() else None,
                                               r.locator(".ftask-progress span").first.inner_text().strip()
                                               if r.locator(".ftask-progress span").count() else None))
    shot(p, "s5_fokus_panel_terbuka_d1.png")
    check("5e tanpa galat konsol (skenario 5)", len(dev.errors) == e0, "; ".join(dev.errors[e0:e0 + 5]))


def d2_fresh(browser, base, user, ids):
    """Perangkat kedua: login yang sama, IndexedDB bersih → task dimuat dari server."""
    dev = open_app(browser, base, user, "D2")
    p = dev.p
    try:
        d.go_all_tasks(p, False)
        wait_until(lambda: p.locator(".task-row", has_text=T3).count() > 0, 15)
        p.wait_for_timeout(1000)
        open_detail(p, T1)
        check("1g D2 (task dimuat dari server, IndexedDB bersih): lokal 33, baris '33%', pill '35%' (kelipatan 5)",
              wait_until(lambda: pct(p, T1) == ("33%", "35%"), 5) and local_progress(p, ids[T1]) == 33,
              "(baris, pill)=%r lokal=%r" % (pct(p, T1), local_progress(p, ids[T1])))
        shot(p, "s1_d2_angka_checklist.png")
        open_detail(p, T3)
        check("3i D2: angka checklist, bukan 80 — lokal 33, baris '33%', pill '35%'",
              wait_until(lambda: pct(p, T3) == ("33%", "35%"), 5) and local_progress(p, ids[T3]) == 33,
              "(baris, pill)=%r lokal=%r" % (pct(p, T3), local_progress(p, ids[T3])))
        shot(p, "s3_d2_angka_checklist.png")
        open_detail(p, T4)
        check("4e D2: baris dan pill '40%'", wait_until(lambda: pct(p, T4) == ("40%", "40%"), 5), repr(pct(p, T4)))
        open_checklist(p, T2)
        wait_until(lambda: len(ck_rows(p)) == 3, 8)
        check("2i D2: Induk A dan Anak A1 tercentang, urutan pre-order",
              ck_rows(p) and [(r[0], r[1]) for r in ck_rows(p)]
              == [("Induk A", "true"), ("Anak A1", "true"), ("Induk B", "false")], repr(ck_rows(p)))
        check("Z[D2] tanpa galat konsol/pageerror", not dev.errors, "; ".join(dev.errors[:5]))
    finally:
        dev.ctx.close()


def main():
    os.makedirs(SHOTS, exist_ok=True)
    for f in os.listdir(SHOTS):
        if f.endswith(".png"):
            os.remove(os.path.join(SHOTS, f))
    tmp = tempfile.mkdtemp(prefix="e2e_checklist_pr_a_")
    proc, base = launch(SERVER_ROOT, tmp, free_port())
    head = subprocess.run(["git", "rev-parse", "--short", "HEAD"], cwd=SERVER_ROOT, capture_output=True,
                          text=True).stdout.strip()
    print("server", base, "kode server", SERVER_ROOT, "@", head, "| klien SW", d.SW_VERSION, flush=True)
    try:
        user = d.register(base, "ckl")
        ids, items = seed(base, user)
        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            d1 = open_app(browser, base, user, "D1")
            try:
                d.go_all_tasks(d1.p, False)
                wait_until(lambda: d1.p.locator(".task-row", has_text=T6).count() > 0, 15)
                d1.p.wait_for_timeout(1000)
                for name, fn in (("1", lambda: s1_detail_ui(d1, base, user, ids)),
                                 ("2", lambda: s2_sub_from_api(d1, base, user, ids, items)),
                                 ("6", lambda: s6_delete_parent(d1, base, user, ids, items)),
                                 ("3", lambda: s3_slider_with_checklist(d1, base, user, ids)),
                                 ("4", lambda: s4_slider_without_checklist(d1, base, user, ids)),
                                 ("1/3 muat ulang", lambda: s1_s3_d1_reload(d1, base, user, ids)),
                                 ("5", lambda: s5_focus(d1, base, user, ids))):
                    print("== skenario %s ==" % name, flush=True)
                    try:
                        fn()
                    except Exception as e:  # noqa: BLE001  langkah yang melempar = gagal
                        import traceback
                        traceback.print_exc()
                        check("skenario %s exception" % name, False, "%s: %s" % (type(e).__name__, str(e)[:300]))
                        try:
                            shot(d1.p, "zz_error_%s.png" % re.sub(r"\W+", "", name))
                        except Exception:  # noqa: BLE001
                            pass
                check("Z[D1] tanpa galat konsol/pageerror", not d1.errors, "; ".join(d1.errors[:5]))
            finally:
                d1.ctx.close()
            print("== D2 (konteks bersih) ==", flush=True)
            try:
                d2_fresh(browser, base, user, ids)
            except Exception as e:  # noqa: BLE001
                import traceback
                traceback.print_exc()
                check("D2 exception", False, "%s: %s" % (type(e).__name__, str(e)[:300]))
            browser.close()
    except Exception as e:  # noqa: BLE001
        import traceback
        traceback.print_exc()
        check("exception", False, "%s: %s" % (type(e).__name__, e))
    finally:
        stop(proc)
        print("server log:", os.path.join(tmp, "server.log"))
    check("Z[resp] tanpa respons >= 400 dari server lokal", not bad_responses, repr(bad_responses))
    print("\nINFO (perilaku klien sekarang yang dicatat, tidak menggagalkan run):")
    for step, val in infos:
        print("  %s: %s" % (step, val))
    failed = [r for r in results if not r[1]]
    print("\n%d langkah, %d gagal" % (len(results), len(failed)))
    for r in failed:
        print("  GAGAL:", r[0], "—", r[2])
    if not failed:
        shutil.rmtree(tmp, ignore_errors=True)
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
