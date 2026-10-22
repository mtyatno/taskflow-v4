"""E2E kartu Pomodoro ringkas di HP (desain pemilik 2026-10-22). Tidak dijalankan CI.

Skenario (375 px dan 340 px, terang + gelap): tanpa task aktif → task aktif → berjalan → waktu habis → istirahat;
di setiap keadaan tidak ada scroll horizontal dan tidak ada elemen kartu keluar batas; lingkaran di kiri
tombol; baris atas memuat tab mode (+ durasi), Zen, pil suara. Tombol kirim parkir menyimpan ke Inbox,
"Selesai" menandai task aktif selesai (server) dan melepas task aktif. Desktop: elemen khusus HP tersembunyi.
Screenshot: temporary_files/e2e_focus_hero_mobile/.

    E2E_PYTHON=/path/python-dengan-dependensi-webapp python3 temporary_files/e2e_focus_hero_mobile.py
"""
import os
import shutil
import sys
import tempfile
from datetime import date, datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import e2e_focus_page as h  # harness: server, register, api, check, nav
from playwright.sync_api import sync_playwright

SHOTS = os.path.join(h.ROOT, "temporary_files", "e2e_focus_hero_mobile")
ERRS = []
T_A = "Followup pembelian material pipa untuk proyek sumur"
T_B = "Kirim laporan mingguan"


def open_page(browser, base, user, vw, vh, mobile, theme):
    ctx = browser.new_context(service_workers="block", viewport={"width": vw, "height": vh}, is_mobile=mobile,
                              has_touch=mobile, device_scale_factor=2 if mobile else 1)
    ctx.clock.install(time=datetime.now().replace(hour=12, minute=0, second=0, microsecond=0))
    ctx.add_cookies([{"name": "token", "value": user["token"], "url": base, "httpOnly": True, "sameSite": "Lax"}])
    p = ctx.new_page()
    p.on("pageerror", lambda e: ERRS.append(str(e)[:200]))
    p.goto(base + "/manifest.json")
    p.evaluate("""([t, uid, tours, theme]) => { localStorage.setItem('tf_token', t); localStorage.setItem('tf_user_id', String(uid));
        for (const pg of tours) localStorage.setItem('tf_tour_' + pg, '1');
        localStorage.setItem('tf_dismiss_onboarding', '1'); localStorage.setItem('tf_theme', theme); }""",
               [user["token"], user["id"], h.TOURS, theme])
    p.goto(base + "/")
    p.locator(".sidebar-link, .sidebar-rail-btn, .mobile-topbar").first.wait_for(state="attached", timeout=20000)
    if mobile:
        p.locator(".mobile-topbar button").first.tap()
        p.wait_for_timeout(600)
        p.locator(".sidebar-link").filter(has_text="Fokus Hari Ini").first.tap()
    else:
        h.nav(p, "Fokus Hari Ini")
    p.wait_for_selector(".focus-pomo", timeout=20000)
    p.wait_for_timeout(800)
    return ctx, p


def geo(p):
    return p.evaluate("""() => {
        const c = document.querySelector('.focus-pomo').getBoundingClientRect();
        const r = s => { const e = document.querySelector('.focus-pomo ' + s); if (!e) return null; const b = e.getBoundingClientRect();
            return b.width ? {l: b.left, r: b.right, t: b.top, b: b.bottom} : null; };
        const out = [...document.querySelectorAll('.focus-pomo *')].filter(e => { const b = e.getBoundingClientRect();
            return b.width > 0 && (b.right > c.right + 1 || b.left < c.left - 1) && !e.closest('.pomo-amb-pop'); }).map(e => e.className);
        return {hscroll: document.documentElement.scrollWidth > innerWidth + 1, out: out.slice(0, 4), h: c.height,
                ring: r('.focus-pomo-ring'), ctrl: r('.pomo-controls'), modes: r('.pomo-modes'), zen: r('.focus-zen-btn'),
                pill: r('.pomo-amb-pill'), headline: r('.focus-pomo-headline'), park: r('.pomo-park'), stats: r('.focus-pomo-stats')};
    }""")


def layout(p, tag):
    g = geo(p)
    h.check("%s: tanpa scroll horizontal, semua elemen di dalam kartu" % tag, not g["hscroll"] and not g["out"], repr(g["out"]))
    ok = (g["ring"] and g["ctrl"] and g["ring"]["r"] <= g["ctrl"]["l"] + 1 and g["modes"] and g["zen"] and g["pill"]
          and g["modes"]["r"] <= g["zen"]["l"] + 1 and g["zen"]["r"] <= g["pill"]["l"] + 1 and abs(g["zen"]["t"] - g["pill"]["t"]) < 4
          and g["headline"] is None and g["stats"]["t"] >= g["ctrl"]["b"] and g["park"]["t"] >= g["stats"]["b"])
    h.check("%s: tata letak ringkas (mode | Zen | pil; lingkaran | tombol; statistik; parkir; tanpa judul)" % tag, ok, repr(g))
    return g


def shot(p, name):
    os.makedirs(SHOTS, exist_ok=True)
    p.evaluate("() => window.scrollTo(0, 0)")
    p.wait_for_timeout(250)
    box = p.locator(".focus-pomo").bounding_box()
    p.screenshot(path=os.path.join(SHOTS, name), clip={"x": 0, "y": max(0, box["y"] - 8), "width": p.viewport_size["width"],
                                                       "height": box["height"] + 16})


def task_by_title(base, user, title):
    data = h.api(base, user, "GET", "/api/tasks?include_done=true&limit=500")[1]
    items = data if isinstance(data, list) else data.get("tasks", data.get("items", []))
    return next((t for t in items if t.get("title") == title), None)


def main():
    tmp = tempfile.mkdtemp()
    proc, base = h.start_server(tmp)
    try:
        today = date.today().isoformat()
        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            for theme in ("dark", "light"):
                for vw in (375, 340):
                    user = h.register(base, "hero%s%d" % (theme[0], vw))
                    for t, pr in ((T_A, "Patuha II"), (T_B, "MSBT")):
                        h.api(base, user, "POST", "/api/tasks", json={"title": t, "project": pr, "priority": "P1", "deadline": today, "gtd_status": "next"})
                    tag = "%s %d" % (theme, vw)
                    ctx, p = open_page(browser, base, user, vw, 812, True, theme)
                    try:
                        layout(p, "a %s tanpa task aktif" % tag)
                        mins = p.locator(".focus-pomo .pomo-mode-min").all_inner_texts()
                        h.check("a %s: durasi mode 25m/5m/15m terlihat" % tag, [m.strip() for m in mins] == ["25m", "5m", "15m"], repr(mins))
                        h.check("a %s: petunjuk pilih task tampil" % tag, p.locator(".focus-pomo-hint").is_visible())
                        shot(p, "%s_%d_1_tanpa_task.png" % (theme, vw))
                        # kirim parkir lewat tombol (bukan Enter)
                        send = p.locator(".pomo-park-send")
                        h.check("b %s: tombol kirim nonaktif saat kosong" % tag, send.is_disabled())
                        p.locator(".pomo-park-input").fill("ide dari tombol kirim %d" % vw)
                        send.tap()
                        got = h.wait_server(base, user, "ide dari tombol kirim %d" % vw)
                        h.check("b %s: tombol kirim menyimpan ke Inbox" % tag, len(got) == 1 and got[0].get("gtd_status") == "inbox", repr(got[:1]))
                        h.check("b %s: placeholder pendek di HP" % tag,
                                p.locator(".pomo-park-input").get_attribute("placeholder") == "Ada pikiran lewat? Ketik & Enter ke Inbox...")
                        # task aktif
                        p.locator(".ftask-focus-btn").first.tap()
                        p.wait_for_timeout(600)
                        title = p.locator(".focus-pomo-task-title").inner_text()
                        layout(p, "c %s task aktif" % tag)
                        proj = p.locator(".focus-pomo-stats-project")
                        h.check("c %s: titik + judul + Selesai, project di baris statistik, 🍅 tersembunyi" % tag,
                                p.locator(".focus-pomo-task-dot").is_visible() and p.locator(".focus-pomo-task-done-btn").is_visible()
                                and proj.is_visible() and proj.inner_text() in ("Patuha II", "MSBT")
                                and not p.locator(".focus-pomo-task-count").is_visible(), title)
                        shot(p, "%s_%d_2_task_aktif.png" % (theme, vw))
                        p.locator(".focus-pomo .pomo-btn-main").tap()
                        p.wait_for_timeout(500)
                        p.clock.run_for(3000)
                        layout(p, "d %s berjalan" % tag)
                        shot(p, "%s_%d_3_berjalan.png" % (theme, vw))
                        p.clock.fast_forward("25:00")
                        p.clock.run_for(2000)
                        p.wait_for_timeout(600)
                        h.check("e %s: waktu habis → tombol Istirahat / Lanjut / Stop" % tag,
                                p.locator(".focus-pomo .pomo-controls.is-awaiting").count() == 1)
                        layout(p, "e %s waktu habis" % tag)
                        shot(p, "%s_%d_4_waktu_habis.png" % (theme, vw))
                        p.locator(".focus-pomo .pomo-btn-break").tap()
                        p.wait_for_timeout(600)
                        layout(p, "f %s istirahat" % tag)
                        shot(p, "%s_%d_5_istirahat.png" % (theme, vw))
                        # Selesai → task selesai di server, task aktif dilepas
                        p.locator(".focus-pomo-task-done-btn").tap()
                        p.wait_for_timeout(1500)
                        t = task_by_title(base, user, title)
                        h.check("g %s: Selesai menandai task aktif selesai (server)" % tag, t is not None and t.get("gtd_status") == "done",
                                repr(t and t.get("gtd_status")))
                        h.check("g %s: setelah Selesai, kartu kembali ke petunjuk pilih task" % tag,
                                p.locator(".focus-pomo-hint").is_visible() and p.locator(".focus-pomo-task").count() == 0)
                    finally:
                        ctx.close()
            # desktop: tidak berubah — elemen khusus HP tersembunyi, judul tampil
            user = h.register(base, "herodesk")
            h.api(base, user, "POST", "/api/tasks", json={"title": T_B, "project": "MSBT", "priority": "P1", "deadline": today, "gtd_status": "next"})
            ctx, p = open_page(browser, base, user, 1280, 860, False, "light")
            try:
                p.locator(".ftask-focus-btn").first.click()
                p.wait_for_timeout(600)
                hidden = p.evaluate("""() => ['.pomo-mode-min', '.pomo-amb-mobile', '.focus-pomo-task-dot', '.focus-pomo-task-done-btn',
                    '.focus-pomo-stats-project', '.pomo-park-icon', '.pomo-park-send'].filter(s =>
                    [...document.querySelectorAll('.focus-pomo ' + s)].some(e => getComputedStyle(e).display !== 'none'))""")
                h.check("h desktop: elemen khusus HP tersembunyi", hidden == [], repr(hidden))
                h.check("h desktop: judul Pomodoro, 🍅 task aktif, kontrol suara inline tetap tampil",
                        p.locator(".focus-pomo-headline").is_visible() and p.locator(".focus-pomo-task-count").is_visible()
                        and p.locator(".focus-pomo .pomo-ambient-select").is_visible())
                h.check("h desktop: placeholder parkir kalimat panjang",
                        p.locator(".pomo-park-input").get_attribute("placeholder") == "Ada pikiran lewat? Ketik & tekan Enter untuk simpan ke Inbox...")
            finally:
                ctx.close()
            browser.close()
        h.check("i tanpa pageerror", ERRS == [], repr(ERRS[:3]))
    finally:
        proc.kill()
        shutil.rmtree(tmp, ignore_errors=True)
    failed = [r for r in h.results if not r[1]]
    print("%d langkah, %d gagal" % (len(h.results), len(failed)))
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
