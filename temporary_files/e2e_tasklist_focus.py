"""E2E tombol 🎯 Fokus di baris task daftar Normal (halaman GTD + workspace slist_*). Tidak dijalankan CI.

Langkah (satu akun; task dibuat via API):
  1  seed: task biasa P3 (gtd next, tanpa deadline), workspace + task di dalamnya, satu task selesai
  2  halaman "Semua Task" (Normal): .dash-focus-btn aria-pressed=false sebelum bintang; klik tidak membuka detail;
     aria-pressed=true + label "Aktif"; TopBarPomodoroChip di top bar desktop memuat judul; timer berjalan
  3  badge sidebar "Fokus Hari Ini" bertambah +1 setelah fokus
  4  klik chip → halaman Today, task fokus paling atas
  9  viewport 375x812: tombol hanya ikon (label tersembunyi), tinggi <= 22px, tanpa scroll horizontal, baris chip mobile
  5  halaman workspace: klik 🎯 task workspace → chip berganti judul, task GTD tak aktif lagi, timer tidak di-reset
  6  klik 🎯 lagi pada task aktif → chip hilang, aria-pressed=false
  7  baris task selesai tanpa .dash-focus-btn
  8  tampilan Compact tanpa .dash-focus-btn
  10 screenshot baris + top bar terfokus, tema terang dan gelap

Server lokal dijalankan sendiri (uvicorn webapp:app, DB sementara; Python server = $E2E_PYTHON, atau venv repo).
Screenshot: temporary_files/e2e_tasklist_focus/. Keluar non-zero bila ada langkah gagal.

    E2E_PYTHON=/path/ke/python-dengan-dependensi-webapp python3 temporary_files/e2e_tasklist_focus.py
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
SHOTS = os.path.join(ROOT, "temporary_files", "e2e_tasklist_focus")
PW = "rahasia123"
SECRET = "e2e-tasklist-focus-secret"
T_GTD = "Tugas biasa E2E"
T_WS = "Tugas workspace E2E"
T_DONE = "Tugas selesai E2E"
WS_NAME = "Tim Fokus"
TOURS = ['dashboard', 'tasks', 'today', 'calendar', 'kanban', 'notes', 'mindmap', 'chat', 'habits', 'habit',
         'settings', 'draw', 'goals', 'review', 'focus', 'workspace', 'slist', 'all', 'inbox',
         'done', 'overdue', 'next', 'waiting', 'someday']

results = []


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


def server_python():
    """Python untuk uvicorn: E2E_PYTHON bila diset, lalu venv repo, lalu interpreter ini."""
    if os.environ.get("E2E_PYTHON"):
        return os.environ["E2E_PYTHON"]
    venv_py = os.path.join(ROOT, "venv", "bin", "python")
    return venv_py if os.path.exists(venv_py) else sys.executable


def start_server(tmp):
    port = free_port()
    env = dict(os.environ, DB_PATH=os.path.join(tmp, "e2e.db"), UPLOAD_DIR=os.path.join(tmp, "uploads"),
               WEB_SECRET_KEY=SECRET, TELEGRAM_BOT_TOKEN="")
    os.makedirs(env["UPLOAD_DIR"], exist_ok=True)
    log = open(os.path.join(tmp, "server.log"), "w")
    proc = subprocess.Popen([server_python(), "-m", "uvicorn", "webapp:app", "--host", "127.0.0.1",
                             "--port", str(port)], cwd=ROOT, env=env, stdout=log, stderr=subprocess.STDOUT)
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


def register(base, name):
    u = "%s%d" % (name, int(time.time() * 1000) % 10_000_000)
    r = requests.post(base + "/api/auth/register",
                      json={"username": u, "password": PW, "email": u + "@ex.com", "display_name": name})
    r.raise_for_status()
    j = r.json()
    return {"username": u, "id": j["user_id"], "token": j["token"]}


def api(base, user, method, path, ok_codes=(200,), **kw):
    r = requests.request(method, base + path, headers={"Authorization": "Bearer " + user["token"]}, timeout=10, **kw)
    if r.status_code not in ok_codes:
        raise RuntimeError("%s %s → %d %s" % (method, path, r.status_code, r.text[:200]))
    return r.status_code, r.json()


def shot(page, name):
    page.mouse.move(5, 5)
    page.wait_for_timeout(300)
    path = os.path.join(SHOTS, name)
    page.screenshot(path=path, full_page=False, scale="css")
    print("  screenshot", os.path.relpath(path, ROOT), flush=True)


def shot_clip(page, name, boxes, pad=12):
    """Screenshot satu kotak yang membungkus semua bounding box (top bar + baris, dsb.)."""
    page.mouse.move(5, 5)
    page.wait_for_timeout(300)
    x0 = min(b["x"] for b in boxes) - pad
    y0 = min(b["y"] for b in boxes) - pad
    x1 = max(b["x"] + b["width"] for b in boxes) + pad
    y1 = max(b["y"] + b["height"] for b in boxes) + pad
    path = os.path.join(SHOTS, name)
    page.screenshot(path=path, scale="css", clip={"x": max(x0, 0), "y": max(y0, 0), "width": x1 - max(x0, 0), "height": y1 - max(y0, 0)})
    print("  screenshot", os.path.relpath(path, ROOT), flush=True)


def open_app(browser, base, user, theme="light"):
    ctx = browser.new_context(service_workers="block", viewport={"width": 1280, "height": 860})
    ctx.add_cookies([{"name": "token", "value": user["token"], "url": base, "httpOnly": True, "sameSite": "Lax"}])
    p = ctx.new_page()
    p.goto(base + "/manifest.json")
    p.evaluate("""([t, u, tours, theme]) => {
        localStorage.setItem('tf_token', t); localStorage.setItem('tf_user_id', String(u));
        for (const pg of tours) localStorage.setItem('tf_tour_' + pg, '1');
        localStorage.setItem('tf_dismiss_onboarding', '1');
        localStorage.setItem('tf_theme', theme);
        localStorage.setItem('tf_groupby', 'none');
        localStorage.setItem('tf_viewmode', 'normal');
    }""", [user["token"], user["id"], TOURS, theme])
    p.goto(base + "/")
    p.locator(".sidebar-link, .sidebar-rail-btn").first.wait_for(state="attached", timeout=20000)
    return ctx, p


def nav(page, label):
    """Buka halaman lewat link sidebar penuh (label teks); sidebar mode ikon dibuka dulu."""
    link = page.locator(".sidebar-link").filter(has_text=label).first
    if not link.is_visible():
        page.locator("button[aria-label='Tampilkan semua menu']").first.click()
    link.click()
    page.wait_for_timeout(500)


def task_row(page, title):
    return page.locator(".task-row").filter(has_text=title).first


def focus_btn(page, title):
    return task_row(page, title).locator(".dash-focus-btn")


def topbar_chip(page):
    return page.locator(".desktop-topbar .topbar-pomo-chip")


def parse_time(txt):
    m = re.search(r"(\d+):(\d{2})", txt or "")
    return int(m.group(1)) * 60 + int(m.group(2)) if m else None


def chip_secs(page):
    return parse_time(topbar_chip(page).locator(".topbar-pomo-time").inner_text())


def today_badge(page):
    """Angka badge link sidebar 'Fokus Hari Ini' (0 bila badge tidak dirender)."""
    link = page.locator(".sidebar-link").filter(has_text="Fokus Hari Ini").first
    if not link.is_visible():
        page.locator("button[aria-label='Tampilkan semua menu']").first.click()
    m = re.search(r"(\d+)\s*$", link.inner_text().strip())
    return int(m.group(1)) if m else 0


def modal_count(page):
    return page.locator("[role='dialog'], .modal-overlay, .modal-backdrop, [class*='task-detail']").count()


def main():
    os.makedirs(SHOTS, exist_ok=True)
    for f in os.listdir(SHOTS):
        if f.endswith(".png"):
            os.remove(os.path.join(SHOTS, f))
    tmp = tempfile.mkdtemp(prefix="e2e_tasklist_focus_")
    proc, base = start_server(tmp)
    print("server", base, flush=True)
    try:
        user = register(base, "fika")
        # 1. seed
        _, t1 = api(base, user, "POST", "/api/tasks", json={"title": T_GTD, "priority": "P3", "gtd_status": "next"})
        _, ws = api(base, user, "POST", "/api/lists", json={"name": WS_NAME})
        _, t2 = api(base, user, "POST", "/api/tasks", json={"title": T_WS, "list_id": ws["id"], "priority": "P3"})
        _, t3 = api(base, user, "POST", "/api/tasks", json={"title": T_DONE, "priority": "P3", "gtd_status": "next"})
        api(base, user, "PUT", "/api/tasks/%d" % t3["id"], json={"gtd_status": "done"})
        check("1 seed via API: task biasa P3 bukan Q1, workspace + task, task selesai",
              t1.get("quadrant") != "Q1" and t1.get("priority") == "P3" and t2.get("list_id") == ws["id"],
              "quadrant=%r list_id=%r" % (t1.get("quadrant"), t2.get("list_id")))

        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            ctx, p = open_app(browser, base, user, "light")
            try:
                run_flow(p, ws)
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
        print("server log:", os.path.join(tmp, "server.log"))

    failed = [r for r in results if not r[1]]
    print("\n%d langkah, %d gagal" % (len(results), len(failed)))
    sys.exit(1 if failed else 0)


def run_flow(p, ws):
    # ── 2. halaman Semua Task, tombol di baris task biasa ───────────────────────
    nav(p, "Semua Task")
    row = task_row(p, T_GTD)
    row.wait_for(state="visible", timeout=15000)
    btn = focus_btn(p, T_GTD)
    check("2a baris task biasa punya satu .dash-focus-btn", btn.count() == 1, "n=%d" % btn.count())
    check("2b aria-pressed=false awal, label 'Fokus'",
          btn.get_attribute("aria-pressed") == "false" and btn.locator(".dash-focus-label").inner_text().strip() == "Fokus",
          "%r / %r" % (btn.get_attribute("aria-pressed"), btn.locator(".dash-focus-label").inner_text()))
    before_star = row.evaluate("""r => { const b = r.querySelector('.dash-focus-btn');
        const s = r.querySelector('.task-row-badges span[title*="Fokus Hari Ini"]');
        return !!b && !!s && !!(b.compareDocumentPosition(s) & Node.DOCUMENT_POSITION_FOLLOWING); }""")
    check("2c tombol Fokus ditempatkan sebelum bintang", before_star)
    check("2d top bar belum menampilkan chip Pomodoro", topbar_chip(p).count() == 0)
    badge0 = today_badge(p)
    modal0 = modal_count(p)
    btn.click()
    p.wait_for_timeout(600)
    check("2e klik tidak membuka modal detail task", modal_count(p) == modal0 and p.get_by_text("Simpan").count() == 0,
          "modal %d → %d" % (modal0, modal_count(p)))
    btn = focus_btn(p, T_GTD)
    check("2f aria-pressed=true dan label 'Aktif'",
          btn.get_attribute("aria-pressed") == "true" and btn.locator(".dash-focus-label").inner_text().strip() == "Aktif",
          "%r / %r" % (btn.get_attribute("aria-pressed"), btn.locator(".dash-focus-label").inner_text()))
    chip = topbar_chip(p)
    check("2g chip Pomodoro tampil di top bar desktop memuat judul task",
          chip.count() == 1 and chip.is_visible() and T_GTD in chip.inner_text(), repr(chip.inner_text() if chip.count() else None))
    check("2h chip berstatus berjalan: tombol 'Jeda Pomodoro' ada",
          chip.locator("button[aria-label='Jeda Pomodoro']").count() == 1 and "is-running" in (chip.get_attribute("class") or ""))
    t_a = chip_secs(p)
    p.wait_for_timeout(2300)
    t_b = chip_secs(p)
    check("2i waktu berkurang dalam ~2 dtk (%s → %s dtk)" % (t_a, t_b), t_a is not None and t_b is not None and 1 <= t_a - t_b <= 4,
          "%s → %s" % (t_a, t_b))

    # ── 3. badge sidebar ────────────────────────────────────────────────────────
    badge1 = today_badge(p)
    check("3 badge 'Fokus Hari Ini' +1 (%d → %d)" % (badge0, badge1), badge1 == badge0 + 1)

    # ── 4. klik chip → Today ────────────────────────────────────────────────────
    chip.click()
    p.locator(".ftask").first.wait_for(state="visible", timeout=10000)
    titles = p.locator(".ftask .ftask-title").evaluate_all("els => els.map(e => e.textContent.trim())")
    check("4a klik chip → halaman Today; daftar memuat task fokus paling atas", titles[:1] == [T_GTD], repr(titles))
    check("4b di halaman Today chip top bar tidak duplikat", topbar_chip(p).count() == 0)

    # ── 9. mobile (fokus masih aktif; baris di Semua Task) ──────────────────────
    nav(p, "Semua Task")
    task_row(p, T_GTD).wait_for(state="visible", timeout=10000)
    p.set_viewport_size({"width": 375, "height": 812})
    p.wait_for_timeout(600)
    b = focus_btn(p, T_GTD)
    lab = b.locator(".dash-focus-label")
    box = b.bounding_box()
    check("9a mobile: tombol terlihat, label tersembunyi (ikon saja)",
          b.is_visible() and not lab.is_visible() and b.locator("svg").count() >= 1,
          "label visible=%s" % lab.is_visible())
    check("9b mobile: tinggi tombol <= 22px (%.1f)" % (box["height"] if box else -1), box is not None and box["height"] <= 22.5)
    sw = p.evaluate("() => ({sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, bw: document.body.scrollWidth})")
    check("9c mobile: tanpa scroll horizontal halaman", sw["sw"] <= sw["cw"] and sw["bw"] <= sw["cw"], repr(sw))
    over = task_row(p, T_GTD).evaluate("""r => { const rr = r.getBoundingClientRect();
        return Array.from(r.querySelectorAll('.task-row-badges > *')).filter(e => e.getBoundingClientRect().right > rr.right + 0.5).length; }""")
    check("9d mobile: badge baris tidak keluar dari baris", over == 0, "melebihi: %d" % over)
    mrow = p.locator(".mobile-topbar-pomo-row .topbar-pomo-chip")
    check("9e mobile: baris chip Pomodoro tampil di top bar mobile memuat judul",
          mrow.count() == 1 and mrow.is_visible() and T_GTD in mrow.inner_text(), "n=%d" % mrow.count())
    shot(p, "mobile_01_fokus_aktif.png")
    p.set_viewport_size({"width": 1280, "height": 860})
    p.wait_for_timeout(600)

    # ── 5. workspace ────────────────────────────────────────────────────────────
    t_before = chip_secs_safe(p)
    nav(p, WS_NAME)
    row_ws = task_row(p, T_WS)
    row_ws.wait_for(state="visible", timeout=15000)
    wb = focus_btn(p, T_WS)
    check("5a halaman workspace: baris task punya .dash-focus-btn aria-pressed=false",
          wb.count() == 1 and wb.get_attribute("aria-pressed") == "false", "n=%d" % wb.count())
    p.wait_for_timeout(1500)
    t_pre = chip_secs(p)
    wb.click()
    p.wait_for_timeout(700)
    chip = topbar_chip(p)
    check("5b chip kini menampilkan judul task workspace", chip.count() == 1 and T_WS in chip.inner_text()
          and T_GTD not in chip.inner_text(), repr(chip.inner_text() if chip.count() else None))
    check("5c tombol task workspace aria-pressed=true", focus_btn(p, T_WS).get_attribute("aria-pressed") == "true")
    t_post = chip_secs(p)
    check("5d timer tidak di-reset: %s → %s dtk (awal sesi %s)" % (t_pre, t_post, t_before),
          t_pre is not None and t_post is not None and t_post <= t_pre and t_pre - t_post <= 5 and t_post < 25 * 60 - 3,
          "%s → %s" % (t_pre, t_post))
    check("5e timer masih berjalan setelah ganti task", "is-running" in (chip.get_attribute("class") or ""))
    p.wait_for_timeout(2200)
    t_later = chip_secs(p)
    check("5f waktu terus berkurang (%s → %s)" % (t_post, t_later), t_later is not None and t_post - t_later >= 1)
    nav(p, "Semua Task")
    task_row(p, T_GTD).wait_for(state="visible", timeout=10000)
    check("5g task GTD tidak lagi aktif (aria-pressed=false, label 'Fokus')",
          focus_btn(p, T_GTD).get_attribute("aria-pressed") == "false"
          and focus_btn(p, T_GTD).locator(".dash-focus-label").inner_text().strip() == "Fokus")
    nav(p, WS_NAME)
    task_row(p, T_WS).wait_for(state="visible", timeout=10000)

    # ── 6. lepas fokus ──────────────────────────────────────────────────────────
    focus_btn(p, T_WS).click()
    p.wait_for_timeout(600)
    check("6a klik lagi pada task aktif → chip hilang", topbar_chip(p).count() == 0)
    check("6b aria-pressed=false kembali", focus_btn(p, T_WS).get_attribute("aria-pressed") == "false")
    st = p.evaluate("() => { try { return JSON.parse(localStorage.getItem('tf_pomo_state') || 'null'); } catch (e) { return null; } }")
    check("6c state tersimpan tanpa focusTaskId", not (st or {}).get("focusTaskId"), repr(st))
    nav(p, "Fokus Hari Ini")
    p.wait_for_timeout(500)
    check("6d badge Today kembali ke nilai awal", today_badge(p) == badge0, "%d vs awal %d" % (today_badge(p), badge0))

    # ── 7. task selesai tanpa tombol (halaman "Done") ───────────────────────────
    nav(p, "Done")
    done_row = task_row(p, T_DONE)
    done_row.wait_for(state="visible", timeout=10000)
    check("7a baris task selesai tampil di halaman Done", done_row.is_visible())
    check("7b baris task selesai tanpa .dash-focus-btn", p.locator(".dash-focus-btn").count() == 0,
          "n=%d" % p.locator(".dash-focus-btn").count())
    nav(p, "Semua Task")
    task_row(p, T_GTD).wait_for(state="visible", timeout=10000)
    check("7c (kontrol) baris task aktif di Semua Task tetap punya tombol", focus_btn(p, T_GTD).count() == 1)

    # ── 8. Compact ──────────────────────────────────────────────────────────────
    p.locator(".tl-view-seg button[aria-label='Compact']").click()
    p.wait_for_timeout(500)
    check("8a tampilan Compact aktif",
          p.locator(".tl-view-seg button[aria-pressed='true']").first.get_attribute("aria-label") == "Compact")
    check("8b Compact: tidak ada .dash-focus-btn di halaman", p.locator(".dash-focus-btn").count() == 0,
          "n=%d" % p.locator(".dash-focus-btn").count())
    check("8c Compact: baris task tetap tampil", p.get_by_text(T_GTD).count() >= 1)
    p.locator(".tl-view-seg button[aria-label='Normal']").click()
    p.wait_for_timeout(500)

    # ── 10. screenshot terang + gelap, baris terfokus + top bar ─────────────────
    focus_btn(p, T_GTD).click()
    p.wait_for_timeout(600)
    for theme in ("light", "dark"):
        tag = "terang" if theme == "light" else "gelap"
        cur = p.evaluate("() => document.documentElement.getAttribute('data-theme')")
        if cur != theme:
            p.locator("[title='Ganti ke mode gelap'], [title='Ganti ke mode terang']").locator("visible=true").first.click()
            p.wait_for_timeout(500)
        got = p.evaluate("() => document.documentElement.getAttribute('data-theme')")
        check("10a [%s] tema aktif" % tag, got == theme, repr(got))
        bgc = focus_btn(p, T_GTD).evaluate("e => getComputedStyle(e).backgroundColor")
        check("10b [%s] tombol aktif berlatar merah (%s)" % (tag, bgc), bgc.startswith("rgb(239, 68, 68"), bgc)
        tb = p.locator(".desktop-topbar").first.bounding_box()
        rb = task_row(p, T_GTD).bounding_box()
        shot_clip(p, "%s_01_baris_dan_topbar.png" % tag, [tb, rb], pad=0)
        shot(p, "%s_02_halaman.png" % tag)


def chip_secs_safe(p):
    try:
        return chip_secs(p)
    except Exception:
        return None


if __name__ == "__main__":
    main()
