"""E2E hero Dashboard baru (spec docs/superpowers/specs/2026-10-27-hero-dashboard-design.md §5). Tidak dijalankan CI.

    python3 temporary_files/e2e_hero_dashboard.py

Server uvicorn lokal + DB sementara + Chromium (Playwright). Seed satu pengguna:
  - 6 task dalam cakupan hari ini: 3 berdeadline hari ini, 1 terlambat (deadline kemarin), 2 selesai hari ini;
  - 4 habit: "Minum air putih" (pagi) dicentang hari ini; "Jalan kaki 20 menit" (siang) `done` kemarin dan lusa
    tapi BELUM dicentang hari ini (streak harus 2 berkat perbaikan "hari ini boleh belum"); "Baca buku" (malam) dan
    "Meditasi" (pagi) tanpa log.

Cek (PASS/FAIL per baris; keluar non-zero bila ada yang gagal):
  1 chip streak "2 hari beruntun" tanpa check-in hari ini pada habit itu;
  2 chip "1 terlambat";
  3 tanpa task difokuskan: chip "Pilih task untuk difokuskan" → klik membuka Fokus Hari Ini;
  4 fokuskan task lewat tombol Fokus di kartu Prioritas → hero "Fokus" + judul + Mulai/Jeda; klik bergantian Mulai/Jeda;
  5 klik chip habit yang belum selesai → chip bergaya selesai;
  6 375 px: tanpa overflow horizontal, ilustrasi hero tersembunyi.

Tangkapan (sesudah font termuat dan dashboard selesai sinkron) ke temporary_files/e2e_hero_dashboard/:
  hero-<palet>-<mode>.png (elemen .dash-hero) + full-<palet>-<mode>.png (viewport) untuk 3 palet × 2 mode @1280×900,
  hero-375-sakura-light / hero-375-default-dark (+ full-375-…) @375×812, dan sheet.png (lembar kontak 6 desktop + 2 HP).
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
from PIL import Image, ImageDraw
from playwright.sync_api import TimeoutError as PlaywrightTimeout, sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHOTS = os.path.join(ROOT, "temporary_files", "e2e_hero_dashboard")
PW = "rahasia123"
SECRET = "e2e-hero-dashboard-secret-0123456789abcd"
USERNAME = "hero"
DESKTOP = {"width": 1280, "height": 900}
MOBILE = {"width": 375, "height": 812}
PALETTES = ("default", "sakura", "lavender")
MODES = ("light", "dark")
MOBILE_SHOTS = (("sakura", "light"), ("default", "dark"))
TOURS = ['dashboard', 'tasks', 'today', 'calendar', 'kanban', 'notes', 'mindmap', 'chat', 'habits', 'habit',
         'settings', 'draw', 'goals', 'review', 'focus', 'workspace', 'slist', 'all', 'inbox',
         'done', 'overdue', 'next', 'waiting', 'someday']
FOCUS_TITLE = "Laporan bulanan"
STREAK_HABIT = "Jalan kaki 20 menit"

results = []


def check(step, ok, note=""):
    results.append((step, bool(ok), note))
    print(("PASS " if ok else "FAIL ") + step + (" (" + note + ")" if note else ""), flush=True)
    return ok


def sw_version():
    with open(os.path.join(ROOT, "static", "sw.js"), encoding="utf-8") as f:
        return re.search(r'^const CACHE = "([^"]+)";', f.read(), re.M).group(1)


def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


def server_python():
    if os.environ.get("E2E_PYTHON"):
        return os.environ["E2E_PYTHON"]
    venv_py = os.path.join(ROOT, "venv", "bin", "python")
    if os.path.exists(venv_py) and subprocess.run([venv_py, "-c", "import uvicorn, fastapi, sse_starlette"],
                                                  capture_output=True).returncode == 0:
        return venv_py
    return sys.executable


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


def api(base, user, method, path, ok_codes=(200, 201), **kw):
    r = requests.request(method, base + path, headers={"Authorization": "Bearer " + user["token"]}, timeout=10, **kw)
    if r.status_code not in ok_codes:
        raise RuntimeError("%s %s -> %d %s" % (method, path, r.status_code, r.text[:200]))
    return r.json()


def seed(base):
    r = requests.post(base + "/api/auth/register", json={"username": USERNAME, "password": PW,
                                                         "email": USERNAME + "@ex.com", "display_name": "Rani"})
    r.raise_for_status()
    j = r.json()
    user = {"id": j["user_id"], "token": j["token"]}
    today = datetime.date.today()
    d = lambda n: (today - datetime.timedelta(days=n)).isoformat()
    tasks = [(FOCUS_TITLE, "P1", d(0), False), ("Review kode", "P2", d(0), False),
             ("Balas email klien", "P3", d(0), False), ("Siapkan presentasi", "P2", d(1), False),
             ("Beli tinta printer", "P3", d(0), True), ("Kirim invoice", "P2", d(0), True)]
    for title, prio, deadline, done in tasks:
        t = api(base, user, "POST", "/api/tasks", json={"title": title, "priority": prio, "gtd_status": "next",
                                                        "deadline": deadline})
        tid = t.get("id") or (t.get("task") or {}).get("id")
        if done:
            api(base, user, "POST", "/api/tasks/%s/done" % tid)
    habits = {}
    for title, phase in (("Minum air putih", "pagi"), (STREAK_HABIT, "siang"), ("Baca buku", "malam"),
                         ("Meditasi", "pagi")):
        h = api(base, user, "POST", "/api/habits", json={"title": title, "phase": phase})
        habits[title] = h.get("id") or (h.get("habit") or {}).get("id")
    api(base, user, "POST", "/api/habits/%s/checkin" % habits["Minum air putih"], json={"status": "done", "date": d(0)})
    for n in (1, 2):
        api(base, user, "POST", "/api/habits/%s/checkin" % habits[STREAK_HABIT], json={"status": "done", "date": d(n)})
    return user


def open_dashboard(browser, base, user, palette, mode, mobile=False):
    extra = {"is_mobile": True, "has_touch": True} if mobile else {}
    ctx = browser.new_context(service_workers="block", viewport=MOBILE if mobile else DESKTOP,
                              timezone_id="Asia/Jakarta", reduced_motion="reduce", **extra)
    ctx.add_cookies([{"name": "token", "value": user["token"], "url": base, "httpOnly": True, "sameSite": "Lax"}])
    p = ctx.new_page()
    p.goto(base + "/manifest.json")
    p.evaluate("""([t, u, tours, mode, sw, palette]) => {
        localStorage.setItem('tf_token', t); localStorage.setItem('tf_user_id', String(u));
        for (const pg of tours) localStorage.setItem('tf_tour_' + pg, '1');
        localStorage.setItem('tf_whatsnew_seen', sw);
        localStorage.setItem('tf_theme', mode);
        if (palette !== 'default') localStorage.setItem('tf_palette', palette);
    }""", [user["token"], user["id"], TOURS, mode, sw_version(), palette])
    p.goto(base + "/")
    wait_dashboard_ready(p)
    return ctx, p


def wait_dashboard_ready(p):
    """Hero + kartu Prioritas tampil, tidak ada kartu "Menyinkronkan", font selesai dimuat."""
    p.locator(".dash-hero-greet").wait_for(state="visible", timeout=30000)
    p.get_by_text(FOCUS_TITLE).first.wait_for(state="visible", timeout=30000)
    p.wait_for_function("() => !document.querySelector('.dash-sync-card')", timeout=30000)
    p.locator(".dash-hero-habit").first.wait_for(state="visible", timeout=30000)
    p.evaluate("() => Promise.race([document.fonts.ready, new Promise(r => setTimeout(r, 8000))])")
    p.wait_for_timeout(500)


def text_of(p, sel):
    loc = p.locator(sel)
    return loc.first.inner_text().strip() if loc.count() else ""


def run_checks(browser, base, user):
    ctx, p = open_dashboard(browser, base, user, "default", "light")
    try:
        streak = text_of(p, ".dash-hero-streak")
        check("1 chip streak '2 hari beruntun' tanpa check-in hari ini", "2 hari beruntun" in streak, repr(streak))
        overdue = text_of(p, ".dash-hero-overdue")
        check("2 chip '1 terlambat'", overdue == "1 terlambat", repr(overdue))

        invite = p.locator(".dash-hero-focus.is-invite")
        ok = invite.count() == 1 and "Pilih task untuk difokuskan" in invite.inner_text()
        check("3a tanpa fokus: chip 'Pilih task untuk difokuskan'", ok, repr(text_of(p, ".dash-hero-chips")))
        if ok:
            invite.click()
            try:
                p.locator(".ftask").first.wait_for(state="visible", timeout=10000)
                opened = p.locator(".dash-hero").count() == 0
            except PlaywrightTimeout:
                opened = False
            check("3b klik chip ajakan membuka Fokus Hari Ini", opened)
            p.goto(base + "/")
            wait_dashboard_ready(p)

        row = p.locator(".dash-row").filter(has_text=FOCUS_TITLE).first
        row.locator(".dash-focus-btn").click()
        focus = p.locator(".dash-hero-focus:not(.is-invite)")
        try:
            focus.wait_for(state="visible", timeout=10000)
        except PlaywrightTimeout:
            pass
        ftxt = focus.inner_text() if focus.count() else ""
        act = p.locator(".dash-hero-focus-act")
        a0 = act.inner_text().strip() if act.count() else ""
        check("4a fokus aktif: 'Fokus' + judul + Mulai/Jeda",
              "Fokus" in ftxt and FOCUS_TITLE in ftxt and a0 in ("Mulai", "Jeda"), repr(ftxt))
        if a0:
            act.click()
            want = "Jeda" if a0 == "Mulai" else "Mulai"
            try:
                p.wait_for_function("w => (document.querySelector('.dash-hero-focus-act')||{}).textContent.trim() === w",
                                    arg=want, timeout=5000)
                a1 = want
            except PlaywrightTimeout:
                a1 = act.inner_text().strip()
            act.click()
            try:
                p.wait_for_function("w => (document.querySelector('.dash-hero-focus-act')||{}).textContent.trim() === w",
                                    arg=a0, timeout=5000)
                a2 = a0
            except PlaywrightTimeout:
                a2 = act.inner_text().strip()
            check("4b klik bergantian Mulai/Jeda", a1 == want and a2 == a0, "%s -> %s -> %s" % (a0, a1, a2))

        # Chip selesai pindah ke belakang urutan (spec §3: belum selesai dulu); dengan batas 3 chip, habit yang baru
        # dicentang bisa tergeser ke "+N". Lolos bila tombolnya hilang, server mencatat `done`, dan chip selesai
        # bertambah atau habit itu tampil sebagai chip selesai.
        btn = p.locator("button.dash-hero-habit").first
        name = btn.locator(".dash-hero-habit-name").inner_text().strip()
        done_before = p.locator(".dash-hero-habit.is-done").count()
        btn.click()
        try:
            p.wait_for_function("""n => ![...document.querySelectorAll('button.dash-hero-habit .dash-hero-habit-name')]
                .some(x => x.textContent.trim() === n)""", arg=name, timeout=10000)
            gone = True
        except PlaywrightTimeout:
            gone = False
        server = None
        for _ in range(20):
            server = {h["title"]: h["today_status"] for h in api(base, user, "GET", "/api/habits/today")}.get(name)
            if server == "done":
                break
            time.sleep(0.5)
        shown_done = p.locator(".dash-hero-habit.is-done").filter(has_text=name).count() > 0
        done_after = p.locator(".dash-hero-habit.is-done").count()
        check("5 centang habit dari hero -> chip selesai",
              gone and server == "done" and (shown_done or done_after > done_before),
              "%s: tombol hilang=%s, server=%s, chip selesai %d->%d, chip habit ini tampil selesai=%s"
              % (name, gone, server, done_before, done_after, shown_done))
    finally:
        ctx.close()

    ctx, p = open_dashboard(browser, base, user, "default", "light", mobile=True)
    try:
        sw_, cw = p.evaluate("() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]")
        check("6a 375px tanpa overflow horizontal", sw_ <= cw, "scrollWidth %d, clientWidth %d" % (sw_, cw))
        illus = p.locator(".dash-hero-illus")
        hidden = illus.count() == 0 or not illus.first.is_visible()
        check("6b 375px ilustrasi hero tersembunyi", hidden)
    finally:
        ctx.close()


def shoot(browser, base, user, palette, mode, mobile=False):
    ctx, p = open_dashboard(browser, base, user, palette, mode, mobile)
    try:
        p.mouse.move(2, 2)
        p.wait_for_timeout(300)
        tag = ("375-" if mobile else "") + "%s-%s" % (palette, mode)
        hero = os.path.join(SHOTS, "hero-%s.png" % tag)
        p.locator(".dash-hero").screenshot(path=hero, animations="disabled", caret="hide")
        p.screenshot(path=os.path.join(SHOTS, "full-%s.png" % tag), animations="disabled", caret="hide")
        print("  screenshot hero-%s.png + full-%s.png" % (tag, tag), flush=True)
        return hero
    finally:
        ctx.close()


def contact_sheet(desktop, mobile, path):
    """2 kolom (terang | gelap) per palet, lalu baris HP (2 tangkapan 375 px)."""
    pad, label_h = 16, 26
    imgs = {k: Image.open(v).convert("RGB") for k, v in list(desktop.items()) + list(mobile.items())}
    cw = max(imgs[(pl, m, False)].width for pl in PALETTES for m in MODES)
    rh = [max(imgs[(pl, m, False)].height for m in MODES) for pl in PALETTES]
    mob = [imgs[(pl, m, True)] for pl, m in MOBILE_SHOTS]
    mob_h = max(i.height for i in mob)
    W = pad + 2 * (cw + pad)
    H = pad + sum(h + label_h + pad for h in rh) + mob_h + label_h + pad
    sheet = Image.new("RGB", (W, H), (236, 238, 242))
    dr = ImageDraw.Draw(sheet)
    y = pad
    for pl, h in zip(PALETTES, rh):
        for ci, m in enumerate(MODES):
            x = pad + ci * (cw + pad)
            dr.text((x, y + 6), "%s · %s · 1280" % (pl, m), fill=(30, 30, 40))
            sheet.paste(imgs[(pl, m, False)], (x, y + label_h))
        y += h + label_h + pad
    x = pad
    for (pl, m), im in zip(MOBILE_SHOTS, mob):
        dr.text((x, y + 6), "%s · %s · 375" % (pl, m), fill=(30, 30, 40))
        sheet.paste(im, (x, y + label_h))
        x += im.width + pad
    sheet.save(path)


def main():
    shutil.rmtree(SHOTS, ignore_errors=True)
    os.makedirs(SHOTS, exist_ok=True)
    tmp = tempfile.mkdtemp(prefix="e2e_hero_dashboard_")
    proc, base = start_server(tmp)
    print("server", base, flush=True)
    try:
        user = seed(base)
        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            run_checks(browser, base, user)
            desktop, mobile = {}, {}
            for pl in PALETTES:
                for m in MODES:
                    desktop[(pl, m, False)] = shoot(browser, base, user, pl, m)
            for pl, m in MOBILE_SHOTS:
                mobile[(pl, m, True)] = shoot(browser, base, user, pl, m, mobile=True)
            browser.close()
        sheet = os.path.join(SHOTS, "sheet.png")
        contact_sheet(desktop, mobile, sheet)
        print("lembar kontak", sheet, flush=True)
    finally:
        proc.terminate()
        try:
            proc.wait(10)
        except subprocess.TimeoutExpired:
            proc.kill()
        shutil.rmtree(tmp, ignore_errors=True)
    failed = [r for r in results if not r[1]]
    print("\n%d/%d cek lolos" % (len(results) - len(failed), len(results)), flush=True)
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
