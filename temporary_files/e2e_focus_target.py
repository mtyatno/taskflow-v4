"""E2E halaman Fokus Hari Ini PR B: Target 🍅 (estimasi vs realisasi). Tidak dijalankan CI.

Skenario: a pemilih estimasi (3 -> reload -> server; 5+ tiga kali -> 5, 6, 7 dan badge ×7)
b header "3 tugas • 0 / 9 … hari ini (~4 jam)"  c sesi 25 menit -> bar 1 / 7, header X=1, server + log, reload
d estimasi 1 + dua sesi -> realisasi is-over, timer tetap bisa dimulai  e dua tab, sesi sama -> satu log
f offline: realisasi lokal +1, online -> tepat satu baris
Screenshot terang + gelap, desktop + 375 px: temporary_files/e2e_focus_target/.

    E2E_PYTHON=/path/python-dengan-dependensi-webapp python3 temporary_files/e2e_focus_target.py
"""
import os
import re
import sqlite3
import sys
import shutil
import subprocess
import tempfile
import time
from datetime import datetime

from playwright.sync_api import sync_playwright

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import e2e_focus_page as h  # harness PR A: server, register, api, shot, nav, check

ROOT = h.ROOT
SHOTS = os.path.join(ROOT, "temporary_files", "e2e_focus_target")
h.SHOTS = SHOTS
check = h.check
TITLES = ["Laporan bulanan", "Review kode", "Balas email klien"]


def open_app(browser, base, user, theme="light", viewport=(1280, 860)):
    """Seperti harness PR A, tetapi jam Playwright dipasang sebelum halaman dimuat."""
    ctx = browser.new_context(service_workers="block", viewport={"width": viewport[0], "height": viewport[1]})
    ctx.add_cookies([{"name": "token", "value": user["token"], "url": base, "httpOnly": True, "sameSite": "Lax"}])
    # Jam palsu dipatok ke tengah hari lokal: total majunya ±3 jam, jadi tidak pernah melewati tengah malam.
    ctx.clock.install(time=datetime.now().replace(hour=12, minute=0, second=0, microsecond=0))
    p = ctx.new_page()
    p.goto(base + "/manifest.json")
    # tf_whatsnew_seen = versi SW saat ini: modal "Apa yang baru" tidak menutupi menu.
    p.evaluate("""([t, u, tours, theme, sw]) => {
        localStorage.setItem('tf_token', t); localStorage.setItem('tf_user_id', String(u));
        for (const pg of tours) localStorage.setItem('tf_tour_' + pg, '1');
        localStorage.setItem('tf_whatsnew_seen', sw);
        localStorage.setItem('tf_dismiss_onboarding', '1');
        localStorage.setItem('tf_theme', theme);
        localStorage.setItem('tf_groupby', 'none');
        localStorage.setItem('tf_viewmode', 'normal');
    }""", [user["token"], user["id"], h.TOURS, theme, h.SW_VERSION])
    goto_focus(p, base)
    return ctx, p


def goto_focus(p, base):
    p.goto(base + "/")
    p.locator(".sidebar-link, .sidebar-rail-btn, .mobile-topbar").first.wait_for(state="attached", timeout=20000)
    if p.locator(".focus-page-summary").count() == 0:
        if p.viewport_size["width"] >= 600:
            h.nav(p, "Fokus Hari Ini")
        else:
            p.evaluate("""() => { const a = [...document.querySelectorAll('a,button,[role=button],.sidebar-link,.bottom-nav *')]
                .find(x => /Fokus Hari Ini/.test(x.textContent||'') || /^today$/.test(x.getAttribute('data-page')||'')); if (a) a.click(); }""")
    p.locator(".ftask").first.wait_for(state="visible", timeout=20000)


def row(p, title):
    return p.locator(".ftask").filter(has_text=title).first


def open_panel(p, title):
    r = row(p, title)
    if "is-open" not in (r.get_attribute("class") or ""):
        r.locator(".ftask-title").click()
    r.locator(".ftask-estimate").wait_for(state="visible", timeout=5000)
    return r


def chip(p, title):
    c = row(p, title).locator(".ftask-count.is-pomo")
    return c.inner_text().strip() if c.count() else None


def bar(p):
    """Teks 'done / est' bar Task Aktif tanpa spasi berlebih, mis. '1 / 7'."""
    return re.sub(r"\s+", " ", p.locator(".focus-pomo .focus-pomo-task-count").first.inner_text()).strip()


def summary(p):
    return re.sub(r"\s+", " ", p.locator(".focus-page-summary").inner_text()).strip()


def header_x(p):
    m = re.search(r"•\s*(\d+)", summary(p))
    return int(m.group(1)) if m else None


def server_task(base, user, tid):
    return h.api(base, user, "GET", "/api/tasks/%d" % tid)[1]


def wait_for(fn, timeout=25, interval=0.5):
    end = time.time() + timeout
    val = fn()
    while not val and time.time() < end:
        time.sleep(interval)
        val = fn()
    return val


def log_rows(db, task_id=None, client_id=None):
    conn = sqlite3.connect(db)
    try:
        q, a = "SELECT task_id, client_id, kind, pomodoros FROM pomodoro_log WHERE 1=1", []
        if task_id is not None:
            q += " AND task_id = ?"
            a.append(task_id)
        if client_id is not None:
            q += " AND client_id = ?"
            a.append(client_id)
        return conn.execute(q, a).fetchall()
    finally:
        conn.close()


SPY_ENQUEUE = """() => {
    window.__pomoEnq = [];
    const pl = window.TF.pomolog, real = pl.enqueue;
    pl.enqueue = (taskCid, e) => { window.__pomoEnq.push(e && e.client_id); return real(taskCid, e); };
}"""


def sync(p):
    p.evaluate("() => { try { return window.__syncNow && window.__syncNow(); } catch (e) {} }")


def focus(p, title):
    row(p, title).locator(".ftask-focus-btn").click()
    p.wait_for_timeout(400)


def unfocus_all(p):
    b = p.locator(".ftask-focus-btn.is-active")
    if b.count():
        b.first.click()
        p.wait_for_timeout(400)


def to_work_mode(p):
    p.locator(".focus-pomo .pomo-mode").filter(has_text="Work").first.click()
    p.wait_for_timeout(200)


def start(p):
    p.locator(".focus-pomo .pomo-btn-main").first.click()
    p.wait_for_selector(".focus-pomo .pomo-btn-main.is-pause", timeout=3000)


def wait_awaiting(p):
    """PR C: Work 00:00 tidak lagi langsung ke istirahat, tetapi menunggu pilihan (awaiting)."""
    p.wait_for_selector(".focus-pomo .pomo-controls.is-awaiting .pomo-btn-break", timeout=5000)


def stop_awaiting(p):
    """Stop saat awaiting -> Work 25:00 diam (sesi sudah tercatat di 00:00)."""
    p.locator(".focus-pomo .pomo-controls.is-awaiting button[aria-label=Stop]").first.click()
    p.wait_for_selector(".focus-pomo .pomo-btn-main:not(.is-pause)", timeout=5000)


def finish_session(p):
    p.clock.fast_forward("25:00")
    p.clock.run_for(2000)
    wait_awaiting(p)
    p.wait_for_timeout(800)
    stop_awaiting(p)


def pomo_state(p):
    return p.evaluate("() => JSON.parse(localStorage.getItem('tf_pomo_state') || '{}')")


def main():
    os.makedirs(SHOTS, exist_ok=True)
    for f in os.listdir(SHOTS):
        if f.endswith(".png"):
            os.remove(os.path.join(SHOTS, f))
    tmp = tempfile.mkdtemp(prefix="e2e_focus_target_")
    proc, base = h.start_server(tmp)
    db = os.path.join(tmp, "e2e.db")
    print("server", base, flush=True)
    try:
        user = h.register(base, "tomat")
        ids = {}
        for t in TITLES:
            _, r = h.api(base, user, "POST", "/api/tasks",
                         json={"title": t, "priority": "P1", "gtd_status": "next", "deadline": h.today_iso()})
            ids[t] = r["id"]
        check("0 seed: 3 task Q1 hari ini, estimasi default 1",
              all(server_task(base, user, i).get("estimated_pomodoros") == 1 for i in ids.values()))
        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            ctx, p = open_app(browser, base, user, "light")
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
    t1, t2, t3 = TITLES
    check("a0 halaman Fokus: chip 🍅 tersembunyi untuk 0/1", chip(p, t1) is None, repr(chip(p, t1)))

    # a. pemilih estimasi
    r = open_panel(p, t1)
    btns = r.locator(".ftask-est-btn")
    check("a1 lima tombol estimasi, ke-5 berlabel 5+",
          btns.count() == 5 and "5+" in btns.nth(4).inner_text(), "n=%d" % btns.count())
    check("a1b pemilih di luar tablist (div.ftask-tabbar > tablist + radiogroup)",
          r.locator(".ftask-tabbar > [role=tablist]").count() == 1
          and r.locator(".ftask-tabbar > .ftask-estimate[role=radiogroup]").count() == 1
          and r.locator("[role=tablist] .ftask-est-btn").count() == 0)
    btns.nth(2).click()
    p.wait_for_timeout(600)
    check("a2 klik tomat ke-3 -> chip 0/3", chip(p, t1) == "0/3", repr(chip(p, t1)))
    check("a2b aria-checked pada tombol ke-3", btns.nth(2).get_attribute("aria-checked") == "true")
    sync(p)
    got = wait_for(lambda: server_task(base, user, ids[t1]).get("estimated_pomodoros") == 3)
    check("a3 server estimated_pomodoros == 3", got, repr(server_task(base, user, ids[t1]).get("estimated_pomodoros")))
    goto_focus(p, base)
    check("a4 reload -> chip tetap 0/3", chip(p, t1) == "0/3", repr(chip(p, t1)))
    r = open_panel(p, t1)
    plus = r.locator(".ftask-est-btn").nth(4)
    seen = []
    for _ in range(3):
        plus.click()
        p.wait_for_timeout(400)
        seen.append(chip(p, t1))
    check("a5 '5+' tiga kali dari 3 -> 5, 6, 7", seen == ["0/5", "0/6", "0/7"], repr(seen))
    badge = r.locator(".ftask-est-badge")
    check("a6 badge ×7", badge.count() == 1 and badge.inner_text().strip() == "×7",
          repr(badge.inner_text() if badge.count() else None))
    sync(p)
    got = wait_for(lambda: server_task(base, user, ids[t1]).get("estimated_pomodoros") == 7)
    check("a7 server estimated_pomodoros == 7", got)
    h.shot(p, "panel_light_desktop.png")

    # b. header
    s = summary(p)
    check("b1 header '3 tugas • 0 / 9 … hari ini (~4 jam)'",
          re.fullmatch(r"3 tugas • 0 / 9 ?hari ini \(~4 jam\)", s) is not None, repr(s))
    p.locator(".focus-page-summary").scroll_into_view_if_needed()
    h.shot(p, "header_light_desktop.png")

    # c. satu sesi 25 menit
    focus(p, t1)
    check("c0 bar Task Aktif 0 / 7", bar(p) == "0 / 7", repr(bar(p)))
    start(p)
    finish_session(p)
    check("c1 bar Task Aktif 1 / 7", bar(p) == "1 / 7", repr(bar(p)))
    check("c2 header X = 1", header_x(p) == 1, summary(p))
    check("c2b chip 1/7", chip(p, t1) == "1/7", repr(chip(p, t1)))
    sync(p)
    got = wait_for(lambda: server_task(base, user, ids[t1]).get("pomodoros_done") == 1)
    check("c3 server pomodoros_done == 1", got, repr(server_task(base, user, ids[t1]).get("pomodoros_done")))
    rows = log_rows(db, ids[t1])
    check("c4 satu baris pomodoro_log (session, 1)", len(rows) == 1 and rows[0][2] == "session" and rows[0][3] == 1,
          repr(rows))
    check("c4b client_id = pomo-<uid>-<ms>-s", bool(rows) and re.fullmatch(r"pomo-%s-\d+-s" % user["id"], rows[0][1]),
          repr(rows[0][1] if rows else None))
    h.shot(p, "bar_light_desktop.png")
    goto_focus(p, base)
    p.locator(".focus-pomo .focus-pomo-task-count").first.wait_for(state="visible", timeout=10000)
    check("c5 reload -> bar tetap 1 / 7", bar(p) == "1 / 7", repr(bar(p)))

    # d. estimasi 1 + dua sesi -> is-over
    unfocus_all(p)
    r = open_panel(p, t2)
    r.locator(".ftask-est-btn").nth(0).click()
    p.wait_for_timeout(400)
    focus(p, t2)
    for i in range(2):
        to_work_mode(p)
        start(p)
        finish_session(p)
    check("d1 bar Task Aktif 2 / 1", bar(p) == "2 / 1", repr(bar(p)))
    done_el = p.locator(".focus-pomo .focus-pomo-task-done").first
    check("d2 realisasi berkelas is-over", "is-over" in (done_el.get_attribute("class") or ""))
    col = done_el.evaluate("e => getComputedStyle(e).color")
    base_col = p.locator(".focus-pomo .focus-pomo-task-count").first.evaluate("e => getComputedStyle(e).color")
    check("d2b warna realisasi beda dari teks bar (oranye)", col != base_col, "%s vs %s" % (col, base_col))
    check("d2c chip task 2 is-over", "is-over" in (row(p, t2).locator(".ftask-count.is-pomo").get_attribute("class") or ""))
    h.shot(p, "over_light_desktop.png")
    to_work_mode(p)
    start(p)
    check("d3 timer tetap bisa dimulai lagi", p.locator(".focus-pomo .pomo-btn-main.is-pause").count() >= 1)
    p.locator(".focus-pomo .pomo-btn-main.is-pause").first.click()
    p.wait_for_timeout(300)
    sync(p)
    check("d4 server task 2 pomodoros_done == 2",
          wait_for(lambda: server_task(base, user, ids[t2]).get("pomodoros_done") == 2))

    # e. dua tab, satu sesi yang sama
    unfocus_all(p)
    focus(p, t1)
    to_work_mode(p)
    sync(p)
    wait_for(lambda: server_task(base, user, ids[t1]).get("is_focused") in (1, True), timeout=10)
    before = server_task(base, user, ids[t1]).get("pomodoros_done")
    start(p)
    # tf_pomo_state ditulis efek React ±11 ms setelah DOM berubah; baca setelah workStartedAt tersimpan (bukan balapan).
    wait_for(lambda: pomo_state(p).get("isRunning") and pomo_state(p).get("workStartedAt"), timeout=5, interval=0.05)
    st = pomo_state(p)
    cid = "pomo-%s-%s-s" % (user["id"], st.get("workStartedAt"))
    p2 = ctx.new_page()
    goto_focus(p2, base)
    p2.wait_for_selector(".focus-pomo .pomo-btn-main.is-pause", timeout=10000)
    st2 = pomo_state(p2)
    check("e0 tab kedua memuat state timer yang sama (workStartedAt)",
          st2.get("workStartedAt") == st.get("workStartedAt") and st2.get("isRunning") is True, repr(st2))
    for pg in (p, p2):
        pg.evaluate(SPY_ENQUEUE)
    p.clock.fast_forward("25:00")
    p.clock.run_for(2000)
    for pg in (p, p2):
        wait_awaiting(pg)
    p.wait_for_timeout(1000)
    enq1, enq2 = p.evaluate("window.__pomoEnq"), p2.evaluate("window.__pomoEnq")
    check("e0b kedua tab sendiri mencatat sesi yang sama (enqueue client_id sama)",
          enq1 == [cid] and enq2 == [cid], "tab1 %r, tab2 %r" % (enq1, enq2))
    st2b = pomo_state(p2)
    check("e0c tab kedua menyelesaikan sesi (PR C: awaiting di 00:00, mode work)",
          st2b.get("phase") == "awaiting" and st2b.get("mode") == "work" and st2b.get("timeLeft") == 0, repr(st2b))
    stop_awaiting(p)
    sync(p)
    sync(p2)
    wait_for(lambda: server_task(base, user, ids[t1]).get("pomodoros_done") == before + 1)
    time.sleep(3)
    sync(p)
    sync(p2)
    time.sleep(2)
    rows = log_rows(db, client_id=cid)
    after = server_task(base, user, ids[t1]).get("pomodoros_done")
    check("e1 server: satu baris log untuk client_id sesi", len(rows) == 1, "%s -> %r" % (cid, rows))
    check("e2 realisasi server +1 (bukan +2)", after == before + 1, "%r -> %r" % (before, after))
    goto_focus(p2, base)
    p2.locator(".focus-pomo .focus-pomo-task-count").first.wait_for(state="visible", timeout=10000)
    check("e3 tab kedua setelah reload: bar %d / 7" % (before + 1), bar(p2) == "%d / 7" % (before + 1), repr(bar(p2)))
    p2.close()

    # f. offline
    goto_focus(p, base)
    p.locator(".focus-pomo .focus-pomo-task-count").first.wait_for(state="visible", timeout=10000)
    before = server_task(base, user, ids[t1]).get("pomodoros_done")
    n_before = len(log_rows(db, ids[t1]))
    to_work_mode(p)
    ctx.set_offline(True)
    p.evaluate("window.dispatchEvent(new Event('offline'))")
    p.wait_for_timeout(300)
    start(p)
    finish_session(p)
    check("f1 offline: bar lokal langsung +1", bar(p) == "%d / 7" % (before + 1), repr(bar(p)))
    check("f1b offline: server belum berubah", len(log_rows(db, ids[t1])) == n_before)
    ctx.set_offline(False)
    p.evaluate("window.dispatchEvent(new Event('online'))")
    sync(p)
    got = wait_for(lambda: len(log_rows(db, ids[t1])) > n_before, timeout=40)
    time.sleep(3)
    sync(p)
    time.sleep(2)
    n_after = len(log_rows(db, ids[t1]))
    check("f2 online -> server menerima tepat satu baris", n_after == n_before + 1, "%d -> %d" % (n_before, n_after))
    check("f3 server pomodoros_done +1", server_task(base, user, ids[t1]).get("pomodoros_done") == before + 1)
    check("f4 bar setelah sync tetap %d / 7 (tidak dobel)" % (before + 1), bar(p) == "%d / 7" % (before + 1),
          repr(bar(p)))


def run_shots(browser, base, user):
    for theme, w, hgt, tag in (("dark", 1280, 860, "desktop"), ("dark", 375, 812, "375"), ("light", 375, 812, "375")):
        c2, p2 = open_app(browser, base, user, theme, (w, hgt))
        try:
            p2.locator(".focus-page-summary").wait_for(state="visible", timeout=20000)
            if p2.locator(".focus-pomo .focus-pomo-task-count").count() == 0:
                focus(p2, TITLES[0])
            # di HP hitungan 🍅 di kartu disembunyikan (kartu ringkas) → gulir ke baris task aktif
            p2.locator(".focus-pomo .focus-pomo-task").first.scroll_into_view_if_needed()
            h.shot(p2, "bar_%s_%s.png" % (theme, tag))
            r = open_panel(p2, TITLES[0])
            r.scroll_into_view_if_needed()
            h.shot(p2, "panel_%s_%s.png" % (theme, tag))
            p2.locator(".focus-page-summary").scroll_into_view_if_needed()
            h.shot(p2, "header_%s_%s.png" % (theme, tag))
            if tag == "375":
                check("h 375px %s tanpa scroll horizontal" % theme,
                      p2.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1"))
                est = r.locator(".ftask-estimate").bounding_box()
                check("h2 375px %s pemilih estimasi muat di layar" % theme,
                      est is not None and est["x"] >= 0 and est["x"] + est["width"] <= 376, repr(est))
        finally:
            c2.close()


if __name__ == "__main__":
    main()
