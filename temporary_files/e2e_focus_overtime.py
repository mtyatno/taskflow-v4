"""E2E halaman Fokus Hari Ini PR C: Overtime / Flow State. Tidak dijalankan CI.

Skenario: a Mulai, +25 menit -> "Ambil Istirahat" + "Lanjut Fokus", 00:00, satu log session
b Lanjut Fokus +25 menit -> +25:00, is-overtime, Pomodoro +1, realisasi bar +1; +12 menit, Stop -> log overtime
  (1 🍅, 2220 dtk), Waktu fokus bertambah  c sesi berikutnya -> Overtime +12:00 -> Ambil Istirahat: istirahat
  berjalan, Pomodoro hanya +1  d reload saat awaiting -> tombol pilihan tetap, tanpa log baru
e Overtime +3 jam -> istirahat diam, log 4 🍅 / 7200 dtk  f chip top bar di halaman lain (awaiting tanpa tombol
  play; Overtime +mm:ss is-overtime)  g Zen menyala selama Overtime, daftar kembali saat awaiting
Screenshot terang + gelap, desktop + 375 px (awaiting, Overtime): temporary_files/e2e_focus_overtime/.

    E2E_PYTHON=/path/python-dengan-dependensi-webapp python3 temporary_files/e2e_focus_overtime.py
"""
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
import e2e_focus_page as h  # harness PR A: server, register, api, shot, nav, check
import e2e_focus_target as tg  # harness PR B: open_app (jam siang lokal), goto_focus, focus, start, sync, wait_for

ROOT = h.ROOT
SHOTS = os.path.join(ROOT, "temporary_files", "e2e_focus_overtime")
h.SHOTS = SHOTS
tg.SHOTS = SHOTS
check = h.check
T1 = "Tulis proposal"
OTHERS = ["Rapikan inbox", "Siapkan rapat", "Baca laporan", "Telepon vendor", "Update roadmap", "Cek anggaran"]
CHIP_TIP = "Pomodoro selesai — klik untuk memilih istirahat atau lanjut"


def card(p):
    return p.locator(".focus-pomo").first


def card_cls(p):
    return card(p).get_attribute("class") or ""


def time_text(p):
    return card(p).locator(".focus-pomo-time").inner_text().strip()


def stats(p):
    return [s.strip() for s in card(p).locator(".focus-pomo-stat-value").all_inner_texts()]


def done(p):
    return int(card(p).locator(".focus-pomo-task-done").inner_text().strip())


def pomo_state(p):
    return tg.pomo_state(p)


def logs(db, kind=None):
    conn = sqlite3.connect(db)
    try:
        q, a = "SELECT kind, pomodoros, focus_seconds, client_id FROM pomodoro_log", []
        if kind:
            q += " WHERE kind = ?"
            a.append(kind)
        return conn.execute(q + " ORDER BY id", a).fetchall()
    finally:
        conn.close()


def advance(p, dur):
    p.clock.fast_forward(dur)
    p.clock.run_for(2000)
    p.wait_for_timeout(500)


def within_sec(text, prefix):
    """'+25:0x': jam Playwright tetap berjalan nyata di sela fast_forward, jadi detik boleh bergeser sedikit."""
    return text.startswith(prefix) and len(text) == len(prefix) + 1


def near(sec, target, drift=15):
    return target <= sec <= target + drift


def wait_awaiting(p):
    p.wait_for_selector(".focus-pomo .pomo-controls.is-awaiting .pomo-btn-break", timeout=8000)
    p.wait_for_timeout(500)


def click_card(p, sel):
    card(p).locator(sel).first.click()
    p.wait_for_timeout(400)


def run_session(p):
    """Mulai Work dari 25:00 lalu majukan 25 menit -> awaiting."""
    tg.start(p)
    advance(p, "25:00")
    wait_awaiting(p)


def to_work(p):
    p.locator(".focus-pomo .pomo-mode").filter(has_text="Work").first.click()
    p.wait_for_timeout(300)


def wait_logs(db, p, kind, n, timeout=25):
    def ok():
        tg.sync(p)
        return len(logs(db, kind)) >= n
    tg.wait_for(ok, timeout=timeout, interval=1)
    return logs(db, kind)


def zen_on(p):
    return p.locator(".focus-page.is-zen").count() > 0


def chip(p):
    return p.locator(".topbar-pomo-chip:visible").first


def main():
    os.makedirs(SHOTS, exist_ok=True)
    for f in os.listdir(SHOTS):
        if f.endswith(".png"):
            os.remove(os.path.join(SHOTS, f))
    tmp = tempfile.mkdtemp(prefix="e2e_focus_overtime_")
    proc, base = h.start_server(tmp)
    db = os.path.join(tmp, "e2e.db")
    print("server", base, flush=True)
    try:
        user = h.register(base, "flow")
        ids = {}
        for t in [T1] + OTHERS:
            _, r = h.api(base, user, "POST", "/api/tasks",
                         json={"title": t, "priority": "P1", "gtd_status": "next", "deadline": h.today_iso()})
            ids[t] = r["id"]
        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            ctx, p = tg.open_app(browser, base, user, "light")
            try:
                run_flow(ctx, p, base, user, ids, db)
            finally:
                ctx.close()
            run_shots(browser, base, user)
            browser.close()
    except Exception as e:
        import traceback
        traceback.print_exc()
        check("exception", False, "%s: %s" % (type(e).__name__, e))
    finally:
        proc.terminate()
        try:
            proc.wait(10)
        except subprocess.TimeoutExpired:
            proc.kill()
        shutil.rmtree(tmp, ignore_errors=True)
    failed = [r for r in h.results if not r[1]]
    print("\n%d langkah, %d gagal" % (len(h.results), len(failed)))
    sys.exit(1 if failed else 0)


def run_flow(ctx, p, base, user, ids, db):
    uid = user["id"]
    tg.focus(p, T1)
    p.locator(".focus-zen-btn").click()
    p.wait_for_timeout(300)
    check("g0 Zen aktif (aria-pressed)", p.locator(".focus-zen-btn").get_attribute("aria-pressed") == "true")

    # a. sesi Work habis -> awaiting
    tg.start(p)
    check("g1 Zen menyala saat Work berjalan", zen_on(p))
    advance(p, "25:00")
    wait_awaiting(p)
    btn_break = card(p).locator(".pomo-btn-break")
    btn_ot = card(p).locator(".pomo-btn-overtime")
    check("a1 tombol 'Ambil Istirahat' + 'Lanjut Fokus' (subteks Overtime)",
          "Ambil Istirahat" in btn_break.text_content() and "Lanjut Fokus" in btn_ot.text_content()
          and "Overtime" in btn_ot.text_content(), "%r / %r" % (btn_break.text_content(), btn_ot.text_content()))
    check("a2 waktu 00:00, kartu is-awaiting", time_text(p) == "00:00" and "is-awaiting" in card_cls(p),
          "%r %r" % (time_text(p), card_cls(p)))
    check("a2b label 'Selesai'", card(p).locator(".focus-pomo-label").text_content().strip() == "Selesai")
    check("a2c tidak ada tombol Mulai/Jeda saat awaiting", card(p).locator(".pomo-btn-main").count() == 0)
    rows = wait_logs(db, p, "session", 1)
    check("a3 server: satu log session (1 🍅, 1500 dtk)",
          len(rows) == 1 and rows[0][1] == 1 and rows[0][2] == 1500 and rows[0][3].endswith("-s"), repr(rows))
    check("a4 statistik Pomodoro 1, Waktu fokus 25m", stats(p)[:2] == ["1", "25m"], repr(stats(p)))
    check("g2 awaiting: Zen tidak menyembunyikan daftar",
          not zen_on(p) and p.locator(".ftask.is-zen-hidden").count() == 0)
    h.shot(p, "awaiting_light_desktop_flow.png")
    done_a = done(p)
    st = pomo_state(p)
    check("a5 state: phase awaiting, totalFocusTime 1500", st.get("phase") == "awaiting"
          and st.get("totalFocusTime") == 1500, repr(st))
    ws_b = st.get("workStartedAt")
    check("a6 Mulai lewat tombol: sessionTaskId = task fokus (event klik tidak dianggap task)",
          st.get("sessionTaskId") == ids[T1], repr(st.get("sessionTaskId")))

    # b. Overtime 25 + 12 menit, Stop
    click_card(p, ".pomo-btn-overtime")
    check("b0 Overtime mulai dari +00:00", time_text(p).startswith("+00:0"), time_text(p))
    check("g3 Zen menyala selama Overtime berjalan",
          zen_on(p) and p.locator(".ftask.is-zen-hidden").count() == len(OTHERS))
    advance(p, "25:00")
    check("b1 waktu +25:0x", within_sec(time_text(p), "+25:0"), time_text(p))
    check("b2 kartu is-overtime, label Overtime", "is-overtime" in card_cls(p)
          and card(p).locator(".focus-pomo-label").text_content().strip() == "Overtime", card_cls(p))
    check("b3 statistik Pomodoro 2 (+1 kelipatan Overtime)", stats(p)[0] == "2", repr(stats(p)))
    check("b4 realisasi bar Task Aktif +1", done(p) == done_a + 1, "%d -> %d" % (done_a, done(p)))
    ink = card(p).locator(".focus-pomo-time").evaluate("e => getComputedStyle(e).color")
    check("b4b waktu Overtime ungu", "139, 92, 246" in ink or "196, 181, 253" in ink, ink)
    h.shot(p, "overtime_light_desktop_flow.png")
    focus_before = stats(p)[1]
    advance(p, "12:00")
    check("b5 waktu +37:0x", within_sec(time_text(p), "+37:0"), time_text(p))
    card(p).locator(".pomo-controls.is-overtime button[aria-label=Stop]").click()
    p.wait_for_timeout(500)
    rows = wait_logs(db, p, "overtime", 1)
    check("b6 server: log overtime 1 🍅 / 2220 dtk (+drift jam nyata), client_id -o",
          len(rows) == 1 and rows[0][1] == 1 and near(rows[0][2], 2220)
          and rows[0][3] == "pomo-%s-%s-o" % (uid, ws_b), repr(rows))
    st = pomo_state(p)
    check("b7 Waktu fokus bertambah (1500 + detik Overtime log)", bool(rows) and st.get("totalFocusTime") == 1500 + rows[0][2]
          and stats(p)[1] != focus_before and stats(p)[1] == "1j 2m", "%r -> %r, %r" % (focus_before, stats(p)[1], st))
    check("b8 Stop -> Work 25:00 diam, Pomodoro tetap 2",
          time_text(p) == "25:00" and st.get("mode") == "work" and st.get("phase") == "countdown"
          and stats(p)[0] == "2", "%r %r" % (time_text(p), stats(p)))
    check("b9 log session tetap satu", len(logs(db, "session")) == 1)

    # c. sesi berikutnya -> Overtime 12 menit -> Ambil Istirahat
    run_session(p)
    check("c0 sesi kedua: Pomodoro 3", stats(p)[0] == "3", repr(stats(p)))
    click_card(p, ".pomo-btn-overtime")
    advance(p, "12:00")
    check("c1 waktu +12:0x", within_sec(time_text(p), "+12:0"), time_text(p))
    card(p).locator(".pomo-controls.is-overtime .pomo-btn-break").click()
    p.wait_for_timeout(600)
    st = pomo_state(p)
    check("c2 istirahat (Short) langsung berjalan",
          st.get("mode") == "shortBreak" and st.get("isRunning") is True and "is-break" in card_cls(p)
          and card(p).locator(".pomo-btn-main.is-pause").count() == 1, repr(st))
    check("c3 Pomodoro hanya +1 dari sesi utama (3)", stats(p)[0] == "3", repr(stats(p)))
    rows = wait_logs(db, p, "overtime", 2)
    check("c4 log overtime kedua 0 🍅 / 720 dtk (+drift)", len(rows) == 2 and rows[1][1] == 0 and near(rows[1][2], 720), repr(rows))
    to_work(p)

    # d. reload saat awaiting
    run_session(p)
    n_s, n_o = len(wait_logs(db, p, "session", 3)), len(logs(db, "overtime"))
    check("d0 sesi ketiga tercatat (3 log session)", n_s == 3, repr(logs(db, "session")))
    tg.goto_focus(p, base)
    p.wait_for_selector(".focus-pomo .pomo-btn-break", timeout=10000)
    check("d1 reload: tombol pilihan tetap ada, 00:00",
          card(p).locator(".pomo-btn-overtime").count() == 1 and time_text(p) == "00:00", time_text(p))
    check("d1b reload: Pomodoro tetap 4", stats(p)[0] == "4", repr(stats(p)))
    time.sleep(3)
    tg.sync(p)
    time.sleep(2)
    check("d2 reload: tidak ada log baru", len(logs(db, "session")) == n_s and len(logs(db, "overtime")) == n_o,
          repr(logs(db)))

    # f. chip top bar di halaman lain
    h.nav(p, "Kalender")
    c = chip(p)
    c.wait_for(state="visible", timeout=5000)
    check("f1 chip awaiting: is-awaiting, 00:00, tanpa tombol play/pause",
          "is-awaiting" in (c.get_attribute("class") or "") and c.locator(".topbar-pomo-time").inner_text().strip() == "00:00"
          and c.locator(".topbar-pomo-btn").count() == 0, c.get_attribute("class"))
    check("f2 chip awaiting: tooltip persis", c.get_attribute("title") == CHIP_TIP, repr(c.get_attribute("title")))
    h.shot(p, "chip_awaiting_light_desktop.png")
    h.nav(p, "Fokus Hari Ini")
    p.wait_for_selector(".focus-pomo .pomo-btn-overtime", timeout=10000)
    st = pomo_state(p)
    ws_e = st.get("workStartedAt")
    click_card(p, ".pomo-btn-overtime")
    advance(p, "01:00")
    h.nav(p, "Kalender")
    c = chip(p)
    c.wait_for(state="visible", timeout=5000)
    ct = c.locator(".topbar-pomo-time").inner_text().strip()
    check("f3 chip Overtime: +mm:ss, is-overtime, tombol jeda ada",
          re.fullmatch(r"\+01:0\d", ct) is not None and "is-overtime" in (c.get_attribute("class") or "")
          and c.locator(".topbar-pomo-btn").count() == 1, "%r %r" % (ct, c.get_attribute("class")))
    col = c.locator(".topbar-pomo-time").evaluate("e => getComputedStyle(e).color")
    h.shot(p, "chip_overtime_light_desktop.png")
    check("f4 chip Overtime: teks ungu", any(x in col for x in ("139, 92, 246", "196, 181, 253", "124, 58, 237",
                                                              "109, 40, 217", "167, 139, 250")), col)
    h.nav(p, "Fokus Hari Ini")
    p.wait_for_selector(".focus-pomo.is-overtime", timeout=10000)

    # e. batas 2 jam
    advance(p, "03:00:00")
    p.wait_for_selector(".focus-pomo.is-break", timeout=8000)
    st = pomo_state(p)
    check("e1 batas: istirahat (Long) diam",
          st.get("mode") == "longBreak" and st.get("isRunning") is False and st.get("phase") == "countdown"
          and card(p).locator(".pomo-btn-main.is-pause").count() == 0, repr(st))
    rows = wait_logs(db, p, "overtime", 3)
    check("e2 log overtime 4 🍅 / 7200 dtk",
          len(rows) == 3 and rows[2][1] == 4 and rows[2][2] == 7200 and rows[2][3] == "pomo-%s-%s-o" % (uid, ws_e),
          repr(rows))
    check("e3 statistik Pomodoro 8, Set lengkap 2", stats(p)[0] == "8" and stats(p)[2] == "2", repr(stats(p)))
    check("e4 tidak ada log session tambahan", len(logs(db, "session")) == 3)


def no_hscroll(p):
    return p.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1")


def within(p, box_sel, item_sel):
    """Semua tombol item_sel berada di dalam box_sel dan di dalam viewport (lebar)."""
    return p.evaluate("""([bs, is]) => {
        const box = document.querySelector(bs); if (!box) return 'tidak ada ' + bs;
        const b = box.getBoundingClientRect(), vw = window.innerWidth, bad = [];
        for (const el of box.querySelectorAll(is)) {
            const r = el.getBoundingClientRect();
            if (r.width === 0) continue;
            if (r.left < b.left - 1 || r.right > b.right + 1 || r.left < -1 || r.right > vw + 1)
                bad.push((el.getAttribute('aria-label') || el.className) + ' ' + Math.round(r.left) + '-' + Math.round(r.right));
        }
        return bad.length ? bad.join('; ') : '';
    }""", [box_sel, item_sel])


def show_mini(p):
    """Gulir sampai kartu penuh keluar layar. Di desktop 7 task belum cukup panjang, jadi viewport dipendekkan."""
    for attempt in range(2):
        p.evaluate("() => { const l = [...document.querySelectorAll('.ftask')].pop(); if (l) l.scrollIntoView({block: 'end'}); }")
        p.wait_for_timeout(600)
        try:
            p.wait_for_selector(".focus-mini.is-visible", timeout=3000)
            return True
        except Exception:
            vs = p.viewport_size
            p.set_viewport_size({"width": vs["width"], "height": 520})
    return False


def shots_for(p, theme, tag, phase, size):
    card(p).scroll_into_view_if_needed()
    p.evaluate("() => { const c = document.querySelector('.focus-pomo'); if (c) c.scrollIntoView({block: 'start'}); }")
    p.wait_for_timeout(300)
    h.shot(p, "%s_%s_%s.png" % (phase, theme, tag))
    if tag == "375":
        check("h1 375px %s %s: tanpa scroll horizontal" % (theme, phase), no_hscroll(p))
    bad = within(p, ".focus-pomo", ".pomo-controls .pomo-btn")
    check("h2 %s %s %s: tombol kartu di dalam kartu" % (tag, theme, phase), bad == "", bad)
    vis = show_mini(p)
    check("h3 %s %s %s: bar ringkas tampil" % (tag, theme, phase), vis)
    if vis:
        kicker = p.locator(".focus-mini-kicker").inner_text().strip()
        if phase == "awaiting":
            check("h4 %s %s: kicker bar ringkas 'Selesai' tanpa ' · dijeda'" % (tag, theme),
                  kicker.lower() == "selesai", repr(kicker))
        h.shot(p, "mini_%s_%s_%s.png" % (phase, theme, tag))
        bad = within(p, ".focus-mini", ".pomo-btn, .pomo-mode")
        check("h5 %s %s %s: tombol bar ringkas di dalam bar" % (tag, theme, phase), bad == "", bad)
        if tag == "375":
            check("h6 375px %s %s: tanpa scroll horizontal (bar ringkas)" % (theme, phase), no_hscroll(p))
            w_task = p.evaluate("() => { const k = document.querySelector('.focus-mini-kicker'), t = document.querySelector('.focus-mini-task');"
                                " return [k.scrollWidth <= k.clientWidth + 1, Math.round(t.getBoundingClientRect().width)]; }")
            check("h7 375px %s %s: kicker + judul bar ringkas tidak terjepit (tombol pindah baris)" % (theme, phase),
                  w_task[0] and w_task[1] >= 90, repr(w_task))
    if p.viewport_size["height"] != size[1]:
        p.set_viewport_size({"width": size[0], "height": size[1]})
        p.wait_for_timeout(300)


def run_shots(browser, base, user):
    for theme, w, hgt, tag in (("light", 1280, 860, "desktop"), ("dark", 1280, 860, "desktop"),
                               ("light", 375, 812, "375"), ("dark", 375, 812, "375")):
        c2, p2 = tg.open_app(browser, base, user, theme, (w, hgt))
        try:
            p2.locator(".focus-page-summary").wait_for(state="visible", timeout=20000)
            if p2.locator(".focus-pomo .focus-pomo-task-count").count() == 0:
                tg.focus(p2, T1)
            tg.start(p2)
            shots_for(p2, theme, tag, "countdown", (w, hgt))
            advance(p2, "25:00")
            wait_awaiting(p2)
            shots_for(p2, theme, tag, "awaiting", (w, hgt))
            p2.evaluate("() => { const c = document.querySelector('.focus-pomo'); if (c) c.scrollIntoView({block: 'start'}); }")
            p2.wait_for_timeout(300)
            click_card(p2, ".pomo-btn-overtime")
            advance(p2, "05:00")
            shots_for(p2, theme, tag, "overtime", (w, hgt))
        finally:
            c2.close()


if __name__ == "__main__":
    main()
