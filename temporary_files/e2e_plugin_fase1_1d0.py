"""E2E PR 1d-0: Target pomodoro sampai 99 (Fokus Hari Ini, detail task, offline, jendela deploy, klien lama). Tidak dijalankan CI.

Skenario (rencana docs/superpowers/plans/2026-11-06-plugin-fase1-pr-1d-0.md, Task 6; keputusan R2/R4/R5/R7):
 1 Fokus: "5+" -> 5, kolom angka muncul ("5"); ketik 37 + Enter -> tepat 1 PUT jaringan (estimated_pomodoros 37, tanpa
   PUT kedua dari blur) -> server 37 -> muat ulang tetap 37; fokus+blur tanpa ubah, Escape setelah mengetik, kosong, "0"
   -> 0 PUT dan nilai kembali; 150 -> 99; klik biasa lalu ketik 12 + Enter pada kolom 99 -> 1 PUT 12 (1g2); "5+" pada 98 -> 99, sekali lagi tetap 99; 3 + Enter -> tombol 1-3 terisi,
   kolom hilang, document.activeElement = tomat ke-3.
 2 Detail: workspace dua anggota (A pemilik, B anggota); task milik B bertenggat minggu depan (tidak ada di Fokus A);
   A: "+ Target" -> 24 -> Simpan -> server 24; B menarik -> detail B "24"; ketik "2" lalu "24" cepat + Enter -> hanya
   PUT 24; Escape pada popover yang dikosongkan -> 0 PUT; "1" + Backspace + klik luar pada target 8 -> 0 PUT (2i); isian terpilih saat dibuka ("8" pada target 1 -> 8, bukan 18).
 3 Offline: ubah target ke 40 saat offline -> online -> sinkron -> server 40.
 4 Server langsung: POST/PUT 99 -> 200; 100 dan 0 -> 422.
 5 Jendela deploy (R2): server LAMA (git worktree 22cd9e5 + static/ branch ini ditimpakan, port + DB tetap) ->
   judul DAN target 30 diubah offline pada task yang sama -> sinkron -> 422 -> bilah "gagal disinkronkan"; server lama
   dihentikan, server BARU (ROOT) di port + DB yang sama -> "Coba lagi" -> server berisi judul baru DAN 30, bilah hilang.
 6 Klien lama (R7): server baru, task bertarget 50; klien v499 = rute ctx.route yang menyajikan "/" (index.html),
   static/offline/pomologic.js, static/offline/liveedit.js, static/app.css?v=383, static/whatsnew.json dari commit
   22cd9e5 (git show; berkas static lain yang berubah = sw.js, diblokir lewat service_workers="block") ->
   buka Fokus + detail + dua siklus sinkron -> 0 PUT, badge "x20", server tetap 50.
 7 Tampilan: 375 px + Sakura gelap dan 1280 px terang: pemilih + kolom "37" + chip "x/37" tanpa scroll horizontal,
   kotak batas kolom di dalam viewport; popover detail tidak luber di 375 px.

Server lokal dijalankan sendiri (uvicorn webapp:app, DB sementara) + worktree sementara untuk skenario 5 (dihapus di
finally). Screenshot: temporary_files/e2e_plugin_fase1_1d0/. Keluar non-zero bila ada langkah gagal.

    E2E_PYTHON=$(which python3) TZ=Asia/Jakarta python3 temporary_files/e2e_plugin_fase1_1d0.py
"""
import datetime
import json
import os
import re
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import time

from playwright.sync_api import sync_playwright

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import e2e_focus_page as h  # noqa: E402  (harness: server, register, api, shot, nav, check)
import e2e_focus_target as ft  # noqa: E402  (goto_focus, open_panel, row, chip, wait_for)

ROOT = h.ROOT
SHOTS = os.path.join(ROOT, "temporary_files", "e2e_plugin_fase1_1d0")
h.SHOTS = SHOTS
check = h.check
OLD = "22cd9e5"  # main sebelum PR ini: klien v499 + server batas 20
PUT_RE = re.compile(r"/api/tasks/(\d+)(\?.*)?$")
console_errors = []


def info(step, val):
    print("  INFO %s: %s" % (step, val), flush=True)


def today(off=0):
    return (datetime.date.today() + datetime.timedelta(days=off)).isoformat()


# ── server ────────────────────────────────────────────────────────────────────

def launch(cwd, tmp, port):
    """uvicorn dari `cwd` (ROOT atau worktree lama) di `port` dengan DB/UPLOAD tmp yang sama (tiru h.start_server)."""
    env = dict(os.environ, DB_PATH=os.path.join(tmp, "e2e.db"), UPLOAD_DIR=os.path.join(tmp, "uploads"),
               WEB_SECRET_KEY=h.SECRET, TELEGRAM_BOT_TOKEN="")
    os.makedirs(env["UPLOAD_DIR"], exist_ok=True)
    log = open(os.path.join(tmp, "server_%s.log" % os.path.basename(cwd.rstrip("/"))), "a")
    proc = subprocess.Popen([h.server_python(), "-m", "uvicorn", "webapp:app", "--host", "127.0.0.1",
                             "--port", str(port)], cwd=cwd, env=env, stdout=log, stderr=subprocess.STDOUT)
    base = "http://127.0.0.1:%d" % port
    import requests
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


# ── perangkat (halaman + pencatat PUT jaringan) ──────────────────────────────

class Dev:
    def __init__(self, ctx, page, label):
        self.ctx, self.p, self.label, self.puts = ctx, page, label, []

    def mark(self):
        return len(self.puts)

    def of(self, tid, since=0):
        """Badan PUT /api/tasks/{tid} yang benar-benar lewat jaringan sejak `since`."""
        return [b for (t, b, _) in self.puts[since:] if t == tid]


def open_app(browser, base, user, label, theme="light", palette=None, viewport=(1280, 860), mobile=False, seen=None,
             routes=None):
    ctx = browser.new_context(service_workers="block", viewport={"width": viewport[0], "height": viewport[1]},
                              device_scale_factor=1, is_mobile=mobile, has_touch=mobile)
    ctx.add_cookies([{"name": "token", "value": user["token"], "url": base, "httpOnly": True, "sameSite": "Lax"}])
    ctx.route(re.compile(r"^(?!http://127\.0\.0\.1).*$"), lambda r: r.abort())  # font/CDN luar: hasil deterministik
    if routes:
        routes(ctx)
    p = ctx.new_page()
    dev = Dev(ctx, p, label)

    def on_req(req):
        m = PUT_RE.search(req.url)
        if req.method == "PUT" and m:
            try:
                body = req.post_data_json
            except Exception:
                body = None
            dev.puts.append((int(m.group(1)), body, time.time()))

    def on_console(msg):
        if msg.type == "error":
            url = (msg.location or {}).get("url", "") or ""
            if url and not url.startswith("http://127.0.0.1"):
                return
            console_errors.append((label, msg.text[:200]))

    p.on("request", on_req)
    p.on("console", on_console)
    p.on("pageerror", lambda e: console_errors.append((label, "pageerror: " + str(e)[:200])))
    p.on("dialog", lambda d: d.accept())
    p.goto(base + "/manifest.json")
    p.evaluate("""([t, u, tours, theme, pal, sw]) => {
        localStorage.setItem('tf_token', t); localStorage.setItem('tf_user_id', String(u));
        for (const pg of tours) localStorage.setItem('tf_tour_' + pg, '1');
        localStorage.setItem('tf_dismiss_onboarding', '1'); localStorage.setItem('tf_onboarded', '1');
        localStorage.setItem('tf_backup_snooze', new Date().toISOString().slice(0, 10));
        localStorage.setItem('tf_whatsnew_seen', sw);
        localStorage.setItem('tf_theme', theme);
        if (pal) localStorage.setItem('tf_palette', pal);
        localStorage.setItem('tf_groupby', 'none'); localStorage.setItem('tf_viewmode', 'normal');
    }""", [user["token"], user["id"], h.TOURS, theme, palette, seen or h.SW_VERSION])
    p.goto(base + "/")
    p.locator(".sidebar-link, .sidebar-rail-btn, .mobile-topbar").first.wait_for(state="attached", timeout=20000)
    return dev


def sync_now(p):
    p.evaluate("""() => Promise.resolve(window.__syncNow && window.__syncNow()).then(() => 'ok', () => 'err')""")
    p.wait_for_timeout(400)


def settle(p, n=2):
    """Paksa sinkron beberapa kali + tunggu: semua PUT yang tertunda sudah lewat jaringan."""
    for _ in range(n):
        sync_now(p)
    p.wait_for_timeout(600)


def est(base, user, tid):
    return h.api(base, user, "GET", "/api/tasks/%d" % tid)[1].get("estimated_pomodoros")


def mk_task(base, user, title, **kw):
    body = {"title": title, "priority": "P1", "gtd_status": "next"}
    body.update(kw)
    return h.api(base, user, "POST", "/api/tasks", json=body)[1]["id"]


def type_in(inp, text):
    inp.click()
    inp.press("Control+a")
    if text == "":
        inp.press("Backspace")
    else:
        inp.press_sequentially(text)


def blur_all(p):
    p.evaluate("() => { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); }")
    p.wait_for_timeout(200)


def est_input(r):
    return r.locator(".ftask-estimate > .ftask-est-input")


def hscroll(p):
    """(scrollWidth dokumen, innerWidth): scroll horizontal bila yang pertama lebih besar."""
    return p.evaluate("() => [Math.max(document.documentElement.scrollWidth, document.body.scrollWidth), window.innerWidth]")


def inside(p, sel):
    """Kotak batas elemen pertama `sel` di dalam viewport -> (ok, kotak)."""
    return p.evaluate("""(sel) => { const e = document.querySelector(sel); if (!e) return [false, null];
        const r = e.getBoundingClientRect(), w = window.innerWidth;
        return [r.left >= -0.5 && r.right <= w + 0.5 && r.width > 0, [Math.round(r.left), Math.round(r.right), Math.round(r.width), w]]; }""", sel)


# ── skenario 1-4 (satu server, 1280 px terang) ────────────────────────────────

def s1_fokus(browser, base, user):
    ta, tb = "Target besar", "Target batas"
    ida = mk_task(base, user, ta, deadline=today())
    idb = mk_task(base, user, tb, deadline=today())
    dev = open_app(browser, base, user, "F1")
    p = dev.p
    ft.goto_focus(p, base)
    r = ft.open_panel(p, ta)
    inp = est_input(r)
    btns = r.locator(".ftask-est-btn")
    check("1a0 target 1: tidak ada kolom angka", inp.count() == 0)
    btns.nth(4).click()
    p.wait_for_timeout(500)
    check("1a '5+' pada 1 -> 5: tombol ke-5 aria-checked, kolom angka bernilai '5'",
          btns.nth(4).get_attribute("aria-checked") == "true" and inp.count() == 1 and inp.input_value() == "5",
          repr(inp.input_value() if inp.count() else None))
    check("1a2 aria-label kolom 'Target pomodoro (1–99)' dan kolom saudara radiogroup (bukan di dalamnya)",
          inp.get_attribute("aria-label") == "Target pomodoro (1–99)"
          and r.locator(".ftask-est-group[role=radiogroup] .ftask-est-input").count() == 0
          and r.locator(".ftask-estimate > .ftask-est-group").count() == 1)
    settle(p)
    check("1a3 server 5 setelah sinkron", ft.wait_for(lambda: est(base, user, ida) == 5), repr(est(base, user, ida)))
    k = dev.mark()
    type_in(inp, "37")
    inp.press("Enter")
    p.wait_for_timeout(300)
    blur_all(p)  # blur sesudah Enter tidak boleh mengirim ulang
    settle(p)
    bodies = dev.of(ida, k)
    info("1b badan PUT", bodies)
    check("1b ketik 37 + Enter (+ blur) -> tepat 1 PUT jaringan ber-estimated_pomodoros 37",
          len(bodies) == 1 and (bodies[0] or {}).get("estimated_pomodoros") == 37, repr(bodies))
    check("1b2 server 37", ft.wait_for(lambda: est(base, user, ida) == 37), repr(est(base, user, ida)))
    h.shot(p, "s1_fokus_37_desktop.png")
    ft.goto_focus(p, base)
    r = ft.open_panel(p, ta)
    inp = est_input(r)
    check("1c muat ulang: kolom tetap '37', chip 0/37", inp.count() == 1 and inp.input_value() == "37"
          and ft.chip(p, ta) == "0/37", repr((inp.input_value() if inp.count() else None, ft.chip(p, ta))))

    k = dev.mark()
    inp.click()
    blur_all(p)
    settle(p)
    check("1d fokus + blur tanpa ubah -> 0 PUT", not dev.of(ida, k), repr(dev.of(ida, k)))

    k = dev.mark()
    type_in(inp, "12")
    inp.press("Escape")
    p.wait_for_timeout(300)
    v = inp.input_value()
    blur_all(p)
    settle(p)
    check("1e Escape setelah mengetik -> nilai kembali '37', 0 PUT, server 37",
          v == "37" and not dev.of(ida, k) and est(base, user, ida) == 37, repr((v, dev.of(ida, k))))

    k = dev.mark()
    type_in(inp, "")
    blur_all(p)
    p.wait_for_timeout(300)
    v1 = inp.input_value()
    type_in(inp, "0")
    blur_all(p)
    p.wait_for_timeout(300)
    v2 = inp.input_value()
    settle(p)
    check("1f kosong lalu blur, '0' lalu blur -> kembali '37', 0 PUT", v1 == "37" and v2 == "37" and not dev.of(ida, k),
          repr((v1, v2, dev.of(ida, k))))

    k = dev.mark()
    type_in(inp, "150")
    inp.press("Enter")
    p.wait_for_timeout(400)
    v = inp.input_value()
    blur_all(p)
    settle(p)
    check("1g ketik 150 + Enter -> 99 (tampilan), 1 PUT ber-99, server 99",
          v == "99" and [b.get("estimated_pomodoros") for b in dev.of(ida, k)] == [99] and est(base, user, ida) == 99,
          repr((v, dev.of(ida, k), est(base, user, ida))))

    # 1g2 (I2): klik biasa (tanpa Ctrl+A) memilih isi kolom -> ketik "12" menimpa 99 (bukan 9912 -> 99)
    k = dev.mark()
    inp.click()
    p.wait_for_timeout(200)
    inp.press_sequentially("12")
    inp.press("Enter")
    p.wait_for_timeout(400)
    v = inp.input_value()
    blur_all(p)
    settle(p)
    check("1g2 klik biasa pada kolom 99 (tanpa Ctrl+A) lalu ketik 12 + Enter -> tepat 1 PUT bernilai 12, server 12",
          v == "12" and [b.get("estimated_pomodoros") for b in dev.of(ida, k)] == [12] and est(base, user, ida) == 12,
          repr((v, dev.of(ida, k), est(base, user, ida))))

    # tb: batas 98 -> 99 -> tetap 99, lalu turun ke 3
    r = ft.open_panel(p, tb)
    btns = r.locator(".ftask-est-btn")
    btns.nth(4).click()
    p.wait_for_timeout(400)
    inp = est_input(r)
    type_in(inp, "98")
    inp.press("Enter")
    p.wait_for_timeout(300)
    blur_all(p)
    settle(p)
    check("1h set 98 -> server 98", ft.wait_for(lambda: est(base, user, idb) == 98), repr(est(base, user, idb)))
    btns.nth(4).click()
    p.wait_for_timeout(400)
    v98 = inp.input_value()
    settle(p)
    check("1i '5+' pada 98 -> 99 (kolom + server)", v98 == "99" and est(base, user, idb) == 99, repr((v98, est(base, user, idb))))
    k = dev.mark()
    btns.nth(4).click()
    p.wait_for_timeout(400)
    v99 = inp.input_value()
    settle(p)
    info("1j PUT akibat '5+' kedua pada 99", dev.of(idb, k))
    check("1j '5+' lagi pada 99 -> tetap 99 (kolom + server)", v99 == "99" and est(base, user, idb) == 99,
          repr((v99, est(base, user, idb))))
    type_in(inp, "3")
    inp.press("Enter")
    p.wait_for_timeout(600)
    filled = [("is-filled" in (btns.nth(i).get_attribute("class") or "")) for i in range(5)]
    act = p.evaluate("() => document.activeElement && document.activeElement.getAttribute('aria-label')")
    check("1k ketik 3 + Enter -> tombol 1-3 terisi, ke-4/5 kosong, kolom hilang, fokus di tomat ke-3",
          filled == [True, True, True, False, False] and est_input(r).count() == 0 and act == "Estimasi 3 pomodoro",
          repr((filled, est_input(r).count(), act)))
    settle(p)
    check("1k2 server 3", ft.wait_for(lambda: est(base, user, idb) == 3), repr(est(base, user, idb)))
    h.shot(p, "s1_fokus_turun_ke_3_desktop.png")
    dev.ctx.close()


def s3_offline(browser, base, user):
    t = "Target offline"
    tid = mk_task(base, user, t, deadline=today())
    dev = open_app(browser, base, user, "F3")
    p = dev.p
    ft.goto_focus(p, base)
    r = ft.open_panel(p, t)
    p.wait_for_timeout(800)
    dev.ctx.set_offline(True)
    r.locator(".ftask-est-btn").nth(4).click()
    p.wait_for_timeout(300)
    inp = est_input(r)
    type_in(inp, "40")
    inp.press("Enter")
    p.wait_for_timeout(500)
    blur_all(p)
    check("3a offline: chip 0/40 lokal, server masih 1", ft.chip(p, t) == "0/40" and est(base, user, tid) == 1,
          repr((ft.chip(p, t), est(base, user, tid))))
    dev.ctx.set_offline(False)
    p.wait_for_timeout(500)
    k = 0
    settle(p, 3)
    check("3b online + sinkron -> server 40", ft.wait_for(lambda: est(base, user, tid) == 40), repr(est(base, user, tid)))
    info("3b PUT ke server", dev.of(tid, k))
    ft.goto_focus(p, base)
    check("3c muat ulang: chip 0/40", ft.chip(p, t) == "0/40", repr(ft.chip(p, t)))
    dev.ctx.close()


def s4_server(base, user):
    s, j = h.api(base, user, "POST", "/api/tasks", json={"title": "Batas server 99", "estimated_pomodoros": 99})
    check("4a POST 99 -> 200 dan tersimpan 99", s == 200 and j.get("estimated_pomodoros") == 99, repr((s, j.get("estimated_pomodoros"))))
    tid = j["id"]
    c100 = h.api(base, user, "POST", "/api/tasks", ok_codes=(422,), json={"title": "x", "estimated_pomodoros": 100})[0]
    c0 = h.api(base, user, "POST", "/api/tasks", ok_codes=(422,), json={"title": "x", "estimated_pomodoros": 0})[0]
    check("4b POST 100 dan 0 -> 422", (c100, c0) == (422, 422), repr((c100, c0)))
    s21 = h.api(base, user, "PUT", "/api/tasks/%d" % tid, json={"estimated_pomodoros": 21})[0]
    s99 = h.api(base, user, "PUT", "/api/tasks/%d" % tid, json={"estimated_pomodoros": 99})[0]
    check("4c PUT 21 dan 99 -> 200", (s21, s99) == (200, 200) and est(base, user, tid) == 99, repr((s21, s99)))
    u100 = h.api(base, user, "PUT", "/api/tasks/%d" % tid, ok_codes=(422,), json={"estimated_pomodoros": 100})[0]
    u0 = h.api(base, user, "PUT", "/api/tasks/%d" % tid, ok_codes=(422,), json={"estimated_pomodoros": 0})[0]
    check("4d PUT 100 dan 0 -> 422, nilai server tetap 99", (u100, u0) == (422, 422) and est(base, user, tid) == 99,
          repr((u100, u0, est(base, user, tid))))


# ── skenario 2: detail task workspace ─────────────────────────────────────────

def close_modal(p):
    p.locator(".modal-content span").filter(has_text=re.compile(r"^✕$")).first.click()
    p.locator(".modal-overlay").first.wait_for(state="detached", timeout=5000)


def open_detail(p, title):
    p.locator(".task-row", has_text=title).first.wait_for(timeout=15000)
    p.locator(".task-row", has_text=title).first.click()
    p.locator(".modal-content").first.wait_for(timeout=10000)
    inp = p.locator(".modal-content input[aria-label='Judul task']")
    end = time.time() + 10
    while time.time() < end and (not inp.count() or inp.first.input_value() != title):
        time.sleep(0.2)
    return p.locator(".modal-content").first


def target_btn(modal):
    return modal.locator('button.td-prop-val[aria-label^="Target 🍅: "], button.td-prop-add[aria-label^="Target pomodoro: "]').first


def s2_detail(browser, base, tmp, ua, ub):
    ws = h.api(base, ua, "POST", "/api/lists", json={"name": "Ruang Target"})[1]["id"]
    with sqlite3.connect(os.path.join(tmp, "e2e.db")) as conn:
        conn.execute("INSERT INTO list_members (list_id, user_id, joined_at) VALUES (?,?,?)",
                     (ws, ub["id"], datetime.datetime.now().isoformat()))
    w1, w2, w3 = "Estimasi mingguan satu", "Estimasi mingguan dua", "Estimasi mingguan tiga"
    ids = {}
    for t in (w1, w2, w3):
        ids[t] = mk_task(base, ua, t, list_id=ws, assigned_to=ub["id"], deadline=today(8), priority="P3")
    mk_task(base, ua, "Pengisi Fokus A", deadline=today())
    check("2a0 seed: tiga task workspace milik B (assigned_to B, tenggat +8 hari), target bawaan 1",
          all(est(base, ua, i) == 1 for i in ids.values()))
    a = open_app(browser, base, ua, "A")
    p = a.p
    ft.goto_focus(p, base)
    check("2a task minggu depan milik B tidak tampil di Fokus A", p.locator(".ftask").filter(has_text="Estimasi mingguan").count() == 0)
    h.nav(p, "Semua Task")

    # w1: + Target -> 24 -> Simpan
    m = open_detail(p, w1)
    add = m.locator("button.td-prop-add[aria-label^='Target pomodoro: ']")
    check("2b detail: tombol ringkas '+ Target 🍅' (aria 'Target pomodoro: 1 (bawaan)')",
          add.count() == 1 and add.first.get_attribute("aria-label") == "Target pomodoro: 1 (bawaan)"
          and "+ Target 🍅" in add.first.inner_text(), repr(add.first.get_attribute("aria-label") if add.count() else None))
    add.first.click()
    pop = p.locator(".td-pop-input.is-number")
    pop.wait_for(timeout=3000)
    # selectionStart/End bernilai null pada input type=number (spesifikasi HTML) -> keterpilihan isi dibuktikan lewat 2g
    # (mengetik "8" pada target 1 menghasilkan 8, bukan 18); di sini cukup fokus otomatis.
    foc = pop.evaluate("e => document.activeElement === e")
    check("2b2 popover: kolom angka terfokus otomatis saat dibuka", foc is True, repr(foc))
    check("2b3 aria-label 'Target pomodoro (1–99)'", pop.get_attribute("aria-label") == "Target pomodoro (1–99)")
    k = a.mark()
    pop.press_sequentially("24")
    p.locator(".td-pop button", has_text="Simpan").first.click()
    p.wait_for_timeout(400)
    txt = target_btn(m).inner_text()
    check("2c Simpan -> baris 'Target 🍅' menampilkan '24 🍅 · ~… jam'", re.search(r"24 🍅 · ~", txt) is not None, repr(txt))
    h.shot(p, "s2_detail_target_24_desktop.png")
    close_modal(p)
    settle(p)
    bodies = a.of(ids[w1], k)
    check("2d server 24 setelah sinkron; satu PUT, hanya nilai 24", est(base, ua, ids[w1]) == 24
          and [b.get("estimated_pomodoros") for b in bodies] == [24], repr(bodies))

    # B menarik
    b = open_app(browser, base, ub, "B")
    pb = b.p
    sync_now(pb)
    pb.evaluate("() => Promise.resolve(window.__refreshTasks && window.__refreshTasks()).catch(() => null)")
    h.nav(pb, "Semua Task")
    mb = open_detail(pb, w1)
    txtb = target_btn(mb).inner_text()
    check("2e B menarik: detail B menampilkan '24 🍅'", "24 🍅" in txtb, repr(txtb))
    close_modal(pb)
    b.ctx.close()

    # w2: "2" lalu "24" cepat + Enter
    m = open_detail(p, w2)
    m.locator("button.td-prop-add[aria-label^='Target pomodoro: ']").first.click()
    pop = p.locator(".td-pop-input.is-number")
    pop.wait_for(timeout=3000)
    k = a.mark()
    pop.press_sequentially("24", delay=0)
    pop.press("Enter")
    p.wait_for_timeout(300)
    close_modal(p)
    settle(p)
    vals = [x.get("estimated_pomodoros") for x in a.of(ids[w2], k)]
    check("2f ketik '2' lalu '24' cepat + Enter -> hanya PUT bernilai 24 (tanpa 2), server 24",
          vals == [24] and est(base, ua, ids[w2]) == 24, repr((vals, est(base, ua, ids[w2]))))

    # w3: isian terpilih -> "8" (bukan 18)
    m = open_detail(p, w3)
    m.locator("button.td-prop-add[aria-label^='Target pomodoro: ']").first.click()
    pop = p.locator(".td-pop-input.is-number")
    pop.wait_for(timeout=3000)
    k = a.mark()
    pop.press_sequentially("8")
    v = pop.input_value()
    p.locator(".td-pop button", has_text="Simpan").first.click()
    p.wait_for_timeout(300)
    close_modal(p)
    settle(p)
    check("2g target 1, ketik '8' -> 8 (bukan 18; isian terpilih saat dibuka) di kolom dan di server", v == "8" and est(base, ua, ids[w3]) == 8
          and [x.get("estimated_pomodoros") for x in a.of(ids[w3], k)] == [8], repr((v, est(base, ua, ids[w3]))))

    # w1 (24): kosongkan + Escape -> 0 PUT
    m = open_detail(p, w1)
    target_btn(m).click()
    pop = p.locator(".td-pop-input.is-number")
    pop.wait_for(timeout=3000)
    k = a.mark()
    type_in(pop, "")
    pop.press("Escape")
    p.wait_for_timeout(400)
    still = p.locator(".modal-content").count()
    info("2h modal masih terbuka setelah Escape", still)
    if still:
        txt2 = target_btn(p.locator(".modal-content").first).inner_text()
        close_modal(p)
    else:
        txt2 = None
    settle(p)
    check("2h popover 24 dikosongkan + Escape -> 0 PUT, server tetap 24 (tampilan tetap '24 🍅')",
          not a.of(ids[w1], k) and est(base, ua, ids[w1]) == 24 and (txt2 is None or "24 🍅" in txt2),
          repr((a.of(ids[w1], k), est(base, ua, ids[w1]), txt2)))

    # w3 (8): ketik "1" lalu Backspace (kolom kosong) + klik di luar popover -> 0 PUT, tetap 8 (I1)
    m = open_detail(p, w3)
    target_btn(m).click()
    pop = p.locator(".td-pop-input.is-number")
    pop.wait_for(timeout=3000)
    k = a.mark()
    pop.press_sequentially("1")
    pop.press("Backspace")
    kosong = pop.input_value()
    m.locator("input[aria-label='Judul task']").click()  # klik di luar popover -> popover menutup + komit
    p.wait_for_timeout(500)
    tutup = p.locator(".td-pop-input.is-number").count()
    txt3 = target_btn(p.locator(".modal-content").first).inner_text()
    close_modal(p)
    settle(p)
    check("2i target 8: ketik '1' + Backspace (kosong) + klik luar -> popover tertutup, 0 PUT, server 8, baris '8 🍅'",
          kosong == "" and tutup == 0 and not a.of(ids[w3], k) and est(base, ua, ids[w3]) == 8 and "8 🍅" in txt3,
          repr((kosong, tutup, a.of(ids[w3], k), est(base, ua, ids[w3]), txt3)))
    a.ctx.close()


# ── skenario 5: jendela deploy ────────────────────────────────────────────────

def s5_deploy(browser, tmp, port):
    old_dir = os.path.join(tmp, "old")
    subprocess.run(["git", "worktree", "add", "--detach", old_dir, OLD], cwd=ROOT, check=True, capture_output=True)
    tmp5 = os.path.join(tmp, "s5")
    os.makedirs(tmp5)
    procs = []
    try:
        shutil.copytree(os.path.join(ROOT, "static"), os.path.join(old_dir, "static"), dirs_exist_ok=True)
        old_proc, base = launch(old_dir, tmp5, port)
        procs.append(old_proc)
        user = h.register(base, "deploy")
        t_old, t_new = "Judul lama S5", "Judul baru S5"
        tid = mk_task(base, user, t_old, deadline=today())
        mx = h.api(base, user, "PUT", "/api/tasks/%d" % tid, ok_codes=(200, 422), json={"estimated_pomodoros": 30})[0]
        check("5a server LAMA (22cd9e5 + static baru): PUT target 30 langsung -> 422", mx == 422, repr(mx))
        dev = open_app(browser, base, user, "D5")
        p = dev.p
        ft.goto_focus(p, base)
        p.wait_for_timeout(800)
        dev.ctx.set_offline(True)  # kedua ubahan tersimpan lokal dan tergabung dalam satu PUT penuh saat sinkron
        r = ft.open_panel(p, t_old)
        r.locator(".ftask-detail-link").click()
        modal = p.locator(".modal-content").first
        modal.wait_for(timeout=10000)
        ti = modal.locator("input[aria-label='Judul task']")
        ti.click()
        ti.press("Control+a")
        ti.press_sequentially(t_new)
        ti.press("Tab")
        p.wait_for_timeout(500)
        modal.locator("button.td-prop-add[aria-label^='Target pomodoro: ']").first.click()
        pop = p.locator(".td-pop-input.is-number")
        pop.wait_for(timeout=3000)
        pop.press_sequentially("30")
        p.locator(".td-pop button", has_text="Simpan").first.click()
        p.wait_for_timeout(400)
        close_modal(p)
        k = dev.mark()
        dev.ctx.set_offline(False)
        p.wait_for_timeout(500)
        settle(p, 3)
        bar = p.locator("#tf-conflict-bar")
        ft.wait_for(lambda: bar.count() and "gagal disinkronkan" in bar.inner_text(), 15)
        bt = bar.inner_text() if bar.count() else ""
        srv = h.api(base, user, "GET", "/api/tasks/%d" % tid)[1]
        info("5b badan PUT penuh yang ditolak", dev.of(tid, k)[:2])
        check("5b server lama menolak (422) -> bilah 'gagal disinkronkan' tampil dengan 'Coba lagi'; server: judul lama + target lama",
              "gagal disinkronkan" in bt and "Coba lagi" in bt and "422" in bt and srv["title"] == t_old
              and srv["estimated_pomodoros"] == 1, repr((bt[:200], srv["title"], srv["estimated_pomodoros"])))
        check("5b2 PUT yang ditolak memuat judul baru DAN target 30 (satu PUT penuh)",
              any((b or {}).get("title") == t_new and (b or {}).get("estimated_pomodoros") == 30 for b in dev.of(tid, k)),
              repr(dev.of(tid, k)[:2]))
        h.shot(p, "s5_bilah_gagal_server_lama.png")
        # restart: server lama mati, server BARU (ROOT) di port + DB sama
        stop(old_proc)
        procs.remove(old_proc)
        new_proc, base2 = launch(ROOT, tmp5, port)
        procs.append(new_proc)
        check("5c server baru di port + DB yang sama", base2 == base)
        p.locator("#tf-conflict-bar button", has_text="Coba lagi").first.click()
        p.wait_for_timeout(800)
        settle(p, 2)
        ok = ft.wait_for(lambda: h.api(base, user, "GET", "/api/tasks/%d" % tid)[1]["estimated_pomodoros"] == 30, 20)
        srv = h.api(base, user, "GET", "/api/tasks/%d" % tid)[1]
        gone = ft.wait_for(lambda: (not bar.count()) or (not bar.is_visible()) or "gagal disinkronkan" not in bar.inner_text(), 10)
        check("5d 'Coba lagi' -> server berisi judul baru DAN target 30", ok and srv["title"] == t_new and srv["estimated_pomodoros"] == 30,
              repr((srv["title"], srv["estimated_pomodoros"])))
        check("5e bilah konflik hilang", gone, repr(bar.inner_text() if bar.count() else None))
        h.shot(p, "s5_setelah_coba_lagi_server_baru.png")
        dev.ctx.close()
    finally:
        for pr in procs:
            stop(pr)
        subprocess.run(["git", "worktree", "remove", "--force", old_dir], cwd=ROOT, capture_output=True)
        subprocess.run(["git", "worktree", "prune"], cwd=ROOT, capture_output=True)


# ── skenario 6: klien lama ────────────────────────────────────────────────────

def git_show(path):
    return subprocess.run(["git", "show", "%s:%s" % (OLD, path)], cwd=ROOT, check=True, capture_output=True).stdout


OLD_FILES = [  # (regex URL, tipe, berkas) — satu-satunya berkas static yang berubah di PR ini selain sw.js (SW diblokir)
    (r"^http://127\.0\.0\.1:\d+/(\?.*)?$", "text/html", "static/index.html"),
    (r"/static/offline/pomologic\.js(\?.*)?$", "application/javascript", "static/offline/pomologic.js"),
    (r"/static/offline/liveedit\.js(\?.*)?$", "application/javascript", "static/offline/liveedit.js"),
    (r"/static/app\.css(\?.*)?$", "text/css", "static/app.css"),
    (r"/static/whatsnew\.json(\?.*)?$", "application/json", "static/whatsnew.json"),
]


def s6_old_client(browser, base, user):
    t = "Target lama 50"
    tid = mk_task(base, user, t, deadline=today())
    h.api(base, user, "PUT", "/api/tasks/%d" % tid, json={"estimated_pomodoros": 50})
    old_sw = re.search(r'^const CACHE = "([^"]+)";', git_show("static/sw.js").decode(), re.M).group(1)
    served = []

    def routes(ctx):
        def make(path, ctype, body):
            def handler(route):
                served.append(path)
                route.fulfill(status=200, content_type=ctype, body=body)
            return handler
        for rx, ctype, path in OLD_FILES:
            ctx.route(re.compile(rx), make(path, ctype, git_show(path)))

    dev = open_app(browser, base, user, "OLD", seen=old_sw, routes=routes)
    p = dev.p
    ft.goto_focus(p, base)
    info("6 versi SW klien lama / berkas lama yang disajikan", (old_sw, sorted(set(served))))
    emax = p.evaluate("() => window.TF.pomologic.EST_MAX")
    check("6a klien lama aktif: EST_MAX == 20, tidak ada kolom angka, berkas lama disajikan",
          emax == 20 and {x for _, _, x in OLD_FILES} <= set(served), repr((emax, sorted(set(served)))))
    r = ft.open_panel(p, t)
    badge = r.locator(".ftask-est-badge")
    btxt = re.sub(r"\s+", "", badge.inner_text()) if badge.count() else None
    check("6b pemilih lama menampilkan badge '×20' (residual R7 terdokumentasi), tanpa kolom angka",
          btxt == "×20" and est_input(r).count() == 0, repr(btxt))
    h.shot(p, "s6_klien_lama_badge_x20.png")
    r.locator(".ftask-detail-link").click()
    p.locator(".modal-content").first.wait_for(timeout=10000)
    p.wait_for_timeout(800)
    h.shot(p, "s6_klien_lama_detail.png")
    close_modal(p)
    for _ in range(2):  # dua siklus sinkron (+ muat ulang data)
        settle(p, 2)
        p.evaluate("() => Promise.resolve(window.__refreshTasks && window.__refreshTasks()).catch(() => null)")
        p.wait_for_timeout(500)
    check("6c Fokus + detail + dua siklus sinkron -> 0 PUT /api/tasks/{id}; server tetap 50",
          not dev.puts and est(base, user, tid) == 50, repr((dev.puts[:2], est(base, user, tid))))
    dev.ctx.close()


# ── skenario 7: tampilan ──────────────────────────────────────────────────────

def s7_view(browser, base, user):
    t = "Target tampilan panjang untuk uji luber"
    tid = mk_task(base, user, t, deadline=today())
    h.api(base, user, "PUT", "/api/tasks/%d" % tid, json={"estimated_pomodoros": 37})
    for i in range(3):
        h.api(base, user, "POST", "/api/tasks/%d/pomodoros" % tid, json={
            "client_id": "pomo-%s-%d-s" % (user["id"], 1000 + i), "kind": "session", "pomodoros": 1,
            "focus_seconds": 1500, "log_date": today(), "ended_at": datetime.datetime.now().isoformat()})
    for tag, vp, theme, pal, mobile in (("375_sakura_gelap", (375, 812), "dark", "sakura", True),
                                        ("1280_terang", (1280, 860), "light", None, False)):
        dev = open_app(browser, base, user, "V" + tag, theme=theme, palette=pal, viewport=vp, mobile=mobile)
        p = dev.p
        ft.goto_focus(p, base)
        r = ft.open_panel(p, t)
        p.wait_for_timeout(500)
        inp = est_input(r)
        chip = ft.chip(p, t)
        ok_in, box_in = inside(p, ".ftask-estimate > .ftask-est-input")
        ok_est, box_est = inside(p, ".ftask-estimate")
        ok_chip, box_chip = inside(p, ".ftask-count.is-pomo")
        ow, iw = hscroll(p)
        clipped = inp.evaluate("e => e.scrollWidth > e.clientWidth + 1")
        check("7a %s kolom '37' + chip '3/37': tampil, tanpa scroll horizontal, kotak di dalam viewport" % tag,
              inp.input_value() == "37" and chip == "3/37" and ok_in and ok_est and ok_chip and ow <= iw and not clipped,
              repr((inp.input_value(), chip, box_in, box_est, box_chip, (ow, iw), clipped)))
        h.shot(p, "s7_fokus_%s.png" % tag)
        r.locator(".ftask-detail-link").click()
        p.locator(".modal-content").first.wait_for(timeout=10000)
        p.wait_for_timeout(500)
        modal = p.locator(".modal-content").first
        target_btn(modal).scroll_into_view_if_needed()
        target_btn(modal).click()
        p.locator(".td-pop-input.is-number").wait_for(timeout=3000)
        p.wait_for_timeout(300)
        okp, boxp = inside(p, ".td-pop")
        ow, iw = hscroll(p)
        okm, boxm = inside(p, ".modal-content")
        check("7b %s popover detail 'Target 🍅' di dalam viewport, tanpa scroll horizontal" % tag,
              okp and okm and ow <= iw, repr((boxp, boxm, (ow, iw))))
        h.shot(p, "s7_detail_popover_%s.png" % tag)
        dev.ctx.close()


def main():
    os.makedirs(SHOTS, exist_ok=True)
    for f in os.listdir(SHOTS):
        if f.endswith(".png"):
            os.remove(os.path.join(SHOTS, f))
    tmp = tempfile.mkdtemp(prefix="e2e_1d0_")
    proc, base = h.start_server(tmp)
    print("server", base, flush=True)
    try:
        ua = h.register(base, "ana")
        ub = h.register(base, "budi")
        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            for name, fn in (("s1", lambda: s1_fokus(browser, base, ua)),
                             ("s2", lambda: s2_detail(browser, base, tmp, ua, ub)),
                             ("s3", lambda: s3_offline(browser, base, ua)),
                             ("s4", lambda: s4_server(base, ua)),
                             ("s6", lambda: s6_old_client(browser, base, h.register(base, "lama"))),
                             ("s7", lambda: s7_view(browser, base, h.register(base, "tampil"))),
                             ("s5", lambda: s5_deploy(browser, tmp, h.free_port()))):
                try:
                    fn()
                except Exception as e:  # satu skenario gagal tidak menghentikan yang lain
                    import traceback
                    traceback.print_exc()
                    check("%s exception" % name, False, "%s: %s" % (type(e).__name__, e))
            browser.close()
        bad = [x for x in console_errors if not re.search(r"Failed to load resource|net::ERR_", x[1])]
        info("konsol: error", console_errors[:10])
        check("8 konsol tanpa error aplikasi (selain request yang sengaja offline/ditolak 422)", not bad, repr(bad[:5]))
    except Exception as e:
        import traceback
        traceback.print_exc()
        check("exception", False, "%s: %s" % (type(e).__name__, e))
    finally:
        stop(proc)
        subprocess.run(["git", "worktree", "prune"], cwd=ROOT, capture_output=True)
        shutil.rmtree(tmp, ignore_errors=True)
    failed = [r for r in h.results if not r[1]]
    print("\n%d langkah, %d gagal" % (len(h.results), len(failed)))
    for r in failed:
        print("GAGAL:", r[0], "—", r[2][:300])
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
