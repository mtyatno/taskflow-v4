"""E2E HUD "Task Created" untuk input Parkir Distraksi halaman Fokus. Tidak dijalankan CI.

Skenario: ketik + Enter -> .center-hud-toast.center-hud-task "Task Created" muncul di tengah layar,
hilang +-2,8 dtk, task masuk Inbox; juga dalam Zen Mode dan 375 px; terang + gelap.
Screenshot: temporary_files/e2e_focus_park_hud/ (git-ignored).

    E2E_PYTHON=/path/python python3 temporary_files/e2e_focus_park_hud.py
"""
import os
import shutil
import subprocess
import sys
import tempfile
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import e2e_focus_page as base_e2e  # noqa: E402
from e2e_focus_page import (api, check, nav, open_app, register, start_server, today_iso,  # noqa: E402
                            wait_server, results)
from playwright.sync_api import sync_playwright  # noqa: E402

ROOT = base_e2e.ROOT
SHOTS = os.path.join(ROOT, "temporary_files", "e2e_focus_park_hud")
HUD = ".center-hud-toast.center-hud-task"


def shot(page, name):
    path = os.path.join(SHOTS, name)
    page.screenshot(path=path, full_page=False, scale="css")
    print("  screenshot", os.path.relpath(path, ROOT), flush=True)


def go_focus(p, w):
    if w >= 600:
        nav(p, "Fokus Hari Ini")
    else:
        p.evaluate("""() => { const a = [...document.querySelectorAll('a,button,[role=button],.sidebar-link,.bottom-nav *')]
            .find(x => /Fokus Hari Ini/.test(x.textContent||'') || /^today$/.test(x.getAttribute('data-page')||'')); if (a) a.click(); }""")
    p.locator(".pomo-park-input").wait_for(state="visible", timeout=20000)


def park_and_check(p, base, user, text, tag, theme, w, h):
    inp = p.locator(".pomo-park-input")
    inp.click()
    inp.fill(text)
    inp.press("Enter")
    p.wait_for_selector(HUD, timeout=3000)
    t0 = time.time()
    check("%s HUD muncul" % tag, True)
    p.wait_for_timeout(350)
    check("%s teks 'Task Created'" % tag, p.locator(HUD + " .center-hud-title").inner_text().strip() == "Task Created")
    box = p.locator(HUD).bounding_box()
    cx, cy = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
    check("%s HUD di tengah layar" % tag, abs(cx - w / 2) < 6 and abs(cy - h / 2) < 6, "(%.0f,%.0f) vs (%.0f,%.0f)" % (cx, cy, w / 2, h / 2))
    check("%s HUD fixed & z-index tinggi" % tag, p.evaluate(
        "(s) => { const c = getComputedStyle(document.querySelector(s)); return c.position === 'fixed' && parseInt(c.zIndex) >= 10000; }", HUD))
    check("%s HUD anak langsung body (tidak terjebak kontainer)" % tag, p.evaluate(
        "(s) => document.querySelector(s).parentElement === document.body", HUD))
    shot(p, "hud_%s.png" % tag)
    p.wait_for_selector(HUD, state="detached", timeout=4000)
    dt = time.time() - t0
    check("%s HUD hilang ~2,8 dtk" % tag, 2.0 <= dt <= 3.6, "%.2f dtk" % dt)
    got = wait_server(base, user, text)
    check("%s task masuk Inbox" % tag, len(got) == 1 and got[0].get("gtd_status") == "inbox")


def dashboard_regression(p, base, user, theme, w, h):
    """Dashboard tetap memakai HUD yang sama (komponen bersama, tanpa portal)."""
    inp = p.locator(".dash-capture input, input[placeholder*='Tulis apa saja'], input[placeholder*='Awali']").first
    inp.wait_for(state="visible", timeout=20000)
    title = "dash %s susu" % theme
    inp.click()
    inp.fill("tugas: " + title)
    inp.press("Enter")
    p.wait_for_selector(HUD, timeout=3000)
    t0 = time.time()
    tag = "dashboard_%s_%d" % (theme, w)
    check("%s HUD 'Task Created'" % tag, p.locator(HUD + " .center-hud-title").inner_text().strip() == "Task Created")
    check("%s ikon clipboardCheck di .center-hud-icon-task" % tag, p.locator(HUD + " .center-hud-icon-wrap.center-hud-icon-task svg").count() == 1)
    check("%s HUD tidak di-portal (tetap di Dashboard)" % tag, p.evaluate(
        "(s) => document.querySelector(s).parentElement !== document.body", HUD))
    p.wait_for_timeout(350)
    box = p.locator(HUD).bounding_box()
    cx, cy = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
    check("%s HUD di tengah layar" % tag, abs(cx - w / 2) < 6 and abs(cy - h / 2) < 6, "(%.0f,%.0f)" % (cx, cy))
    shot(p, "hud_%s.png" % tag)
    p.wait_for_selector(HUD, state="detached", timeout=4000)
    check("%s HUD hilang ~2,8 dtk" % tag, 2.0 <= time.time() - t0 <= 3.6, "%.2f dtk" % (time.time() - t0))
    check("%s task masuk Inbox" % tag, len(wait_server(base, user, title)) == 1)


def main():
    os.makedirs(SHOTS, exist_ok=True)
    for f in os.listdir(SHOTS):
        if f.endswith(".png"):
            os.remove(os.path.join(SHOTS, f))
    tmp = tempfile.mkdtemp(prefix="e2e_focus_park_hud_")
    proc, base = start_server(tmp)
    print("server", base, flush=True)
    try:
        user = register(base, "hudy")
        for t in ("Laporan bulanan", "Review kode"):
            api(base, user, "POST", "/api/tasks",
                json={"title": t, "priority": "P1", "gtd_status": "next", "deadline": today_iso()})
        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            n = 0
            for theme, w, h in (("light", 1280, 860), ("dark", 1280, 860), ("light", 375, 812), ("dark", 375, 812)):
                ctx, p = open_app(browser, base, user, theme)
                try:
                    p.set_viewport_size({"width": w, "height": h})
                    p.goto(base + "/")
                    p.locator(".sidebar-link, .sidebar-rail-btn, .mobile-topbar").first.wait_for(state="attached", timeout=20000)
                    if w == 1280:
                        dashboard_regression(p, base, user, theme, w, h)
                    go_focus(p, w)
                    n += 1
                    tag = "%s_%d" % (theme, w)
                    park_and_check(p, base, user, "pikiran %d biasa" % n, tag, theme, w, h)
                    # Zen Mode: nyalakan, fokus task, mulai timer
                    if p.locator(".focus-zen-btn").get_attribute("aria-pressed") != "true":
                        p.locator(".focus-zen-btn").click()
                    p.locator(".ftask").filter(has_text="Laporan bulanan").first.locator(".ftask-focus-btn").click()
                    p.locator(".focus-pomo .pomo-btn-main").first.click()
                    p.wait_for_selector(".focus-page.is-zen", timeout=3000)
                    p.wait_for_timeout(500)
                    n += 1
                    park_and_check(p, base, user, "pikiran %d zen" % n, "zen_" + tag, theme, w, h)
                finally:
                    ctx.close()
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
    failed = [r for r in results if not r[1]]
    print("\n%d langkah, %d gagal" % (len(results), len(failed)))
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
