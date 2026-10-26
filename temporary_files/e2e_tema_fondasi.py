"""E2E identitas piksel PR A tema (fondasi token): 8 halaman x 2 mode, baseline vs sesudah. Tidak dijalankan CI.

Refactor token warna tidak boleh mengubah satu piksel pun tampilan Default terang/gelap. Skrip ini mengambil
16 screenshot (1280x900, full page) dari server lokal bertemp DB, lalu membandingkannya:

    python3 temporary_files/e2e_tema_fondasi.py baseline        # dari main (static/ belum diubah) -> baseline/
    python3 temporary_files/e2e_tema_fondasi.py compare         # pohon kerja sekarang -> after/, lalu PASS/FAIL per gambar
    python3 temporary_files/e2e_tema_fondasi.py compare --tolerance 3

`compare` keluar non-zero bila ada gambar yang beda: piksel beda = ada kanal RGB selisih > tolerance (default 3);
ukuran berbeda atau berkas hilang = FAIL. Gambar beda ditulis ke diff/ (piksel beda merah di atas baseline redup).

Halaman (nama berkas `<halaman>-<mode>.png`; semuanya lewat link sidebar kecuali halaman awal). Aplikasi tidak punya
id halaman `focus`/`kanban`/`tasks` sendiri, jadi dipetakan ke tampilan yang berbeda dari halaman yang sama:
  dashboard  halaman awal (Dashboard)            today     "Fokus Hari Ini"
  focus      "Fokus Hari Ini" + task pertama difokuskan lewat tombol Fokus (kartu Pomodoro aktif, timer belum jalan)
  calendar   "Kalender"                          notes     "Notes"              settings  "Pengaturan"
  tasks      "Semua Task", view Normal, kelompok Kuadran (bawaan)
  kanban     "Semua Task", view Kanban, kelompok Priority
Server uvicorn: E2E_PYTHON bila diset, lalu venv repo bila dependensi webapp-nya lengkap, lalu interpreter ini.
Penentu determinisme: tanpa animasi (reduced_motion + animations="disabled"), tema lewat localStorage.tf_theme,
font Google diblokir (selalu font cadangan, tak bergantung jaringan), data seed tetap (judul tetap; deadline = hari ini),
jam browser dibekukan pada 10.00 hari ini (sapaan "Selamat pagi") dan jam pada kartu note diganti teks tetap.
Tanggal hari ini ikut tampil (kalender, header, deadline): baseline dan compare harus dijalankan pada hari kalender
yang sama; compare menolak berjalan bila baseline dibuat pada hari lain.
"""
import argparse
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
from PIL import Image, ImageChops
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
with open(os.path.join(ROOT, "static", "sw.js"), encoding="utf-8") as _f:
    # Versi SW saat ini: ditulis ke tf_whatsnew_seen agar modal "Apa yang baru" tidak menutupi UI.
    SW_VERSION = re.search(r'^const CACHE = "([^"]+)";', _f.read(), re.M).group(1)
SHOTS = os.path.join(ROOT, "temporary_files", "e2e_tema_fondasi")
PW = "rahasia123"
SECRET = "e2e-tema-fondasi-secret-0123456789abcd"
USERNAME = "tema"
VIEWPORT = {"width": 1280, "height": 900}
MODES = ("light", "dark")
TOURS = ['dashboard', 'tasks', 'today', 'calendar', 'kanban', 'notes', 'mindmap', 'chat', 'habits', 'habit',
         'settings', 'draw', 'goals', 'review', 'focus', 'workspace', 'slist', 'all', 'inbox',
         'done', 'overdue', 'next', 'waiting', 'someday']
TASKS = [("Laporan bulanan", "P1"), ("Review kode", "P2"), ("Balas email klien", "P3")]
NOTE_TITLE = "Catatan rapat tema"
HABIT_TITLE = "Minum air putih"
# (nama berkas, label link sidebar atau None = halaman awal, localStorage.tf_groupby, tf_viewmode, teks penanda siap)
PAGES = [
    ("dashboard", None, "quadrant", "normal", TASKS[0][0]),
    ("today", "Fokus Hari Ini", "quadrant", "normal", TASKS[0][0]),
    ("focus", "Fokus Hari Ini", "quadrant", "normal", TASKS[0][0]),
    ("calendar", "Kalender", "quadrant", "normal", None),
    ("notes", "Notes", "quadrant", "normal", NOTE_TITLE),
    ("tasks", "Semua Task", "quadrant", "normal", TASKS[0][0]),
    ("kanban", "Semua Task", "priority", "kanban", TASKS[0][0]),
    ("settings", "Pengaturan", "quadrant", "normal", None),
]
DATE_FILE = "tanggal.txt"
FONT_HOSTS = re.compile(r"https://fonts\.(googleapis|gstatic)\.com/")
# Jam server pada kartu note ("26 Okt 2026, 21.03") berubah tiap menit: teksnya diganti konstanta, gayanya tetap.
FREEZE_CLOCK_TEXT_JS = """() => {
    const re = /^\\d{1,2} [A-Za-z]{3,4} \\d{4}, \\d{2}\\.\\d{2}$/;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) if (re.test(n.nodeValue.trim())) n.nodeValue = '26 Okt 2026, 10.00';
}"""

results = []


def check(step, ok, note=""):
    results.append((step, bool(ok), note))
    print(("PASS " if ok else "FAIL ") + step + (" (" + note + ")" if note else ""), flush=True)
    return ok


def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


def server_python():
    """Python untuk uvicorn: E2E_PYTHON bila diset, lalu venv repo bila dependensi webapp-nya lengkap, lalu interpreter ini."""
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


def api(base, user, method, path, ok_codes=(200,), **kw):
    r = requests.request(method, base + path, headers={"Authorization": "Bearer " + user["token"]}, timeout=10, **kw)
    if r.status_code not in ok_codes:
        raise RuntimeError("%s %s -> %d %s" % (method, path, r.status_code, r.text[:200]))
    return r.json()


def seed(base):
    """Pengguna tetap + data tetap: 3 task P1/P2/P3 berdeadline hari ini, 1 note, 1 habit."""
    r = requests.post(base + "/api/auth/register", json={"username": USERNAME, "password": PW,
                                                         "email": USERNAME + "@ex.com", "display_name": "Tema"})
    r.raise_for_status()
    j = r.json()
    user = {"username": USERNAME, "id": j["user_id"], "token": j["token"]}
    today = time.strftime("%Y-%m-%d")
    for title, prio in TASKS:
        api(base, user, "POST", "/api/tasks", json={"title": title, "priority": prio, "gtd_status": "next",
                                                    "deadline": today})
    api(base, user, "POST", "/api/scratchpad", json={"title": NOTE_TITLE,
                                                     "content": "Poin pertama\n\nPoin kedua dan **tebal**"})
    api(base, user, "POST", "/api/habits", json={"title": HABIT_TITLE, "phase": "pagi", "micro_target": "1 gelas"})
    return user


def open_app(browser, base, user, mode, groupby, viewmode):
    ctx = browser.new_context(service_workers="block", viewport=VIEWPORT, reduced_motion="reduce")
    ctx.route(FONT_HOSTS, lambda route: route.abort())
    ctx.clock.set_fixed_time(datetime.datetime.combine(datetime.date.today(), datetime.time(10, 0)))
    ctx.add_cookies([{"name": "token", "value": user["token"], "url": base, "httpOnly": True, "sameSite": "Lax"}])
    p = ctx.new_page()
    p.goto(base + "/manifest.json")
    p.evaluate("""([t, u, tours, mode, sw, groupby, viewmode]) => {
        localStorage.setItem('tf_token', t); localStorage.setItem('tf_user_id', String(u));
        for (const pg of tours) localStorage.setItem('tf_tour_' + pg, '1');
        localStorage.setItem('tf_dismiss_onboarding', '1');
        localStorage.setItem('tf_whatsnew_seen', sw);
        localStorage.setItem('tf_theme', mode);
        localStorage.setItem('tf_groupby', groupby);
        localStorage.setItem('tf_viewmode', viewmode);
    }""", [user["token"], user["id"], TOURS, mode, SW_VERSION, groupby, viewmode])
    p.goto(base + "/")
    p.locator(".sidebar-link, .sidebar-rail-btn").first.wait_for(state="attached", timeout=20000)
    return ctx, p


def nav(page, label):
    """Buka halaman lewat link sidebar penuh (label teks); sidebar mode ikon dibuka dulu."""
    link = page.locator(".sidebar-link").filter(has_text=label).first
    if not link.is_visible():
        page.locator("button[aria-label='Tampilkan semua menu']").first.click()
    link.click()


def shoot(browser, base, user, name, label, groupby, viewmode, ready_text, mode, out_dir):
    ctx, p = open_app(browser, base, user, mode, groupby, viewmode)
    try:
        if label:
            nav(p, label)
        if ready_text:
            p.get_by_text(ready_text).first.wait_for(state="visible", timeout=20000)
        if name == "focus":
            p.locator(".ftask").first.locator(".ftask-focus-btn").click()
            p.locator(".ftask.is-focusing").wait_for(state="attached", timeout=10000)
        p.mouse.move(5, 5)
        p.wait_for_timeout(600)
        p.evaluate(FREEZE_CLOCK_TEXT_JS)
        path = os.path.join(out_dir, "%s-%s.png" % (name, mode))
        p.screenshot(path=path, full_page=True, animations="disabled", caret="hide", scale="css")
        print("  screenshot", os.path.relpath(path, ROOT), flush=True)
    finally:
        ctx.close()


def capture(out_dir):
    """Ambil 16 screenshot dari pohon kerja sekarang ke out_dir (dikosongkan dulu); tanggalnya dicatat di tanggal.txt."""
    shutil.rmtree(out_dir, ignore_errors=True)
    os.makedirs(out_dir)
    with open(os.path.join(out_dir, DATE_FILE), "w") as f:
        f.write(datetime.date.today().isoformat())
    tmp = tempfile.mkdtemp(prefix="e2e_tema_fondasi_")
    proc, base = start_server(tmp)
    print("server", base, "->", os.path.relpath(out_dir, ROOT), flush=True)
    try:
        user = seed(base)
        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            for mode in MODES:
                for name, label, groupby, viewmode, ready_text in PAGES:
                    shoot(browser, base, user, name, label, groupby, viewmode, ready_text, mode, out_dir)
            browser.close()
    finally:
        proc.terminate()
        try:
            proc.wait(10)
        except subprocess.TimeoutExpired:
            proc.kill()
        shutil.rmtree(tmp, ignore_errors=True)


def expected_names():
    return ["%s-%s.png" % (page[0], mode) for mode in MODES for page in PAGES]


def count_diff_pixels(base_img, after_img, tolerance):
    """Jumlah piksel yang punya kanal RGB selisih > tolerance; juga gambar penanda (merah = beda)."""
    diff = ImageChops.difference(base_img, after_img)
    over = [band.point(lambda v: 255 if v > tolerance else 0) for band in diff.split()]
    mask = ImageChops.lighter(ImageChops.lighter(over[0], over[1]), over[2])
    count = mask.histogram()[255]
    marked = Image.blend(base_img, Image.new("RGB", base_img.size, (255, 255, 255)), 0.7)
    marked.paste(Image.new("RGB", base_img.size, (255, 0, 0)), mask=mask)
    return count, marked


def compare(tolerance):
    base_dir, after_dir, diff_dir = (os.path.join(SHOTS, d) for d in ("baseline", "after", "diff"))
    missing = [n for n in expected_names() + [DATE_FILE] if not os.path.exists(os.path.join(base_dir, n))]
    if missing:
        print("baseline belum lengkap (%d berkas hilang, mis. %s): jalankan `baseline` lebih dulu" % (len(missing), missing[0]))
        return 1
    with open(os.path.join(base_dir, DATE_FILE)) as f:
        base_date = f.read().strip()
    if base_date != datetime.date.today().isoformat():
        print("baseline dibuat tanggal %s, hari ini %s: tanggal tampil di UI, jalankan ulang `baseline` dari main" %
              (base_date, datetime.date.today().isoformat()))
        return 1
    capture(after_dir)
    shutil.rmtree(diff_dir, ignore_errors=True)
    for name in expected_names():
        a_path, b_path = os.path.join(after_dir, name), os.path.join(base_dir, name)
        if not os.path.exists(a_path):
            check(name, False, "tidak ada di after/")
            continue
        base_img, after_img = Image.open(b_path).convert("RGB"), Image.open(a_path).convert("RGB")
        if base_img.size != after_img.size:
            check(name, False, "ukuran beda: baseline %dx%d, after %dx%d" % (base_img.size + after_img.size))
            continue
        count, marked = count_diff_pixels(base_img, after_img, tolerance)
        if count:
            os.makedirs(diff_dir, exist_ok=True)
            marked.save(os.path.join(diff_dir, name))
        check(name, count == 0, "%d px" % count if count else "")
    failed = [r for r in results if not r[1]]
    print("\n%d gambar, %d gagal (tolerance %d)" % (len(results), len(failed), tolerance))
    return 1 if failed else 0


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("baseline", help="simpan 16 screenshot ke baseline/ (jalankan dari main)")
    cmp_ = sub.add_parser("compare", help="ambil after/ dari pohon kerja, bandingkan dengan baseline/")
    cmp_.add_argument("--tolerance", type=int, default=3, help="selisih kanal maksimum yang masih dianggap sama")
    args = ap.parse_args()
    if args.cmd == "baseline":
        capture(os.path.join(SHOTS, "baseline"))
        sys.exit(0)
    sys.exit(compare(args.tolerance))


if __name__ == "__main__":
    main()
