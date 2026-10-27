"""E2E identitas piksel PR A tema (fondasi token): 8 halaman x 2 mode, baseline vs sesudah. Tidak dijalankan CI.

Refactor token warna tidak boleh mengubah satu piksel pun tampilan Default terang/gelap. Skrip ini mengambil
16 screenshot (1280x900, full page) dari server lokal bertemp DB, lalu membandingkannya:

    python3 temporary_files/e2e_tema_fondasi.py baseline --ref 64f3782   # commit itu -> baseline/ (aman dijalankan kapan saja)
    python3 temporary_files/e2e_tema_fondasi.py compare                  # pohon kerja sekarang -> after/, PASS/FAIL per gambar
    python3 temporary_files/e2e_tema_fondasi.py compare --tolerance 3
    python3 temporary_files/e2e_tema_fondasi.py verify                   # perilaku tema (PR A Task 6 + PR B Task 7)
    python3 temporary_files/e2e_tema_fondasi.py shots --palette sakura   # 28 screenshot audit -> shots/sakura/

`--palette sakura|lavender` (baseline/compare/shots) menulis localStorage.tf_palette sebelum halaman dimuat. Tanpa
--palette (= default) tf_palette tidak ditulis dan direktorinya tetap baseline/, after/, diff/; dengan palet lain
direktorinya baseline-<palet>/, after-<palet>/, diff-<palet>/ (gerbang piksel palet itu sendiri, baseline dari commit
yang sudah memuat paletnya). `shots` hanya memotret untuk audit manual (tanpa pembanding): 8 halaman x 2 mode pada
1280x900 ditambah Fokus & Pengaturan pada 375x812 (`<halaman>-375-<mode>.png`) x 2 mode, ditambah EXTRA_SHOTS
(modal detail task, note terbuka di editor, Sketsa dengan gambar terbuka, mindmap terbuka) x 2 mode = 28 gambar, ke
shots/<palet>/, lalu lembar kontak berlabel shots/<palet>-sheet.png (20 gambar halaman) dan shots/<palet>-sheet-2.png
(EXTRA_SHOTS). Sketsa butuh bundel tldraw (`static/vendor/tldraw/`, di-.gitignore; `cd draw-app && npm ci && npm run
build`); tanpa itu iframe-nya menampilkan 404.

`baseline --ref` men-checkout commit ke `git worktree` sementara dan menjalankan uvicorn dari sana (static/ dan webapp.py
milik commit itu), lalu menghapus worktree-nya. Tanpa --ref skrip menolak jalan, kecuali `--force` (ambil dari pohon
kerja; bila static/ sudah diubah, compare berikutnya lolos tanpa makna). Asal baseline dicatat di baseline/meta.json
({"ref", "static_tree", "date"}) dan dicetak di kepala `compare`. Screenshot ditulis ke direktori staging dan baru
menggantikan baseline/ (atau after/) bila 16 gambarnya lengkap: kegagalan di tengah jalan tidak merusak yang lama.

`compare` keluar non-zero bila ada gambar yang beda: piksel beda = ada kanal RGB selisih > tolerance (default 3);
ukuran berbeda atau berkas hilang = FAIL. Tiap baris memuat jumlah piksel beda dan selisih kanal terbesar
(seluruh gambar). Gambar beda ditulis ke diff/ (piksel beda merah di atas baseline redup).

Halaman (nama berkas `<halaman>-<mode>.png`; semuanya lewat link sidebar kecuali halaman awal). Aplikasi tidak punya
id halaman `focus`/`kanban`/`tasks` sendiri, jadi dipetakan ke tampilan yang berbeda dari halaman yang sama:
  dashboard  halaman awal (Dashboard)            today     "Fokus Hari Ini"
  focus      "Fokus Hari Ini" + task pertama difokuskan lewat tombol Fokus (kartu Pomodoro aktif, timer belum jalan)
  calendar   "Kalender"                          notes     "Notes"              settings  "Pengaturan"
  tasks      "Semua Task", view Normal, kelompok Kuadran (bawaan)
  kanban     "Semua Task", view Kanban, kelompok Priority
Server uvicorn: E2E_PYTHON bila diset, lalu venv repo bila dependensi webapp-nya lengkap, lalu interpreter ini.
Banner onboarding Dashboard ikut tampil bila kondisinya terpenuhi (tf_dismiss_onboarding tidak diset).
Penentu determinisme: tanpa animasi (reduced_motion + animations="disabled"), tema lewat localStorage.tf_theme,
font Google diblokir (selalu font cadangan, tak bergantung jaringan), data seed tetap (judul tetap; deadline = hari ini),
jam browser dibekukan pada 10.00 hari ini (sapaan "Selamat pagi") dan jam pada kartu note diganti teks tetap.
Tanggal hari ini ikut tampil (kalender, header, deadline): baseline dan compare harus dijalankan pada hari kalender
yang sama; compare menolak berjalan bila baseline dibuat pada hari lain (ulangi `baseline --ref`).
"""
import argparse
import datetime
import glob
import json
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
from playwright.sync_api import TimeoutError as PlaywrightTimeout, sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHOTS = os.path.join(ROOT, "temporary_files", "e2e_tema_fondasi")
PW = "rahasia123"
SECRET = "e2e-tema-fondasi-secret-0123456789abcd"
USERNAME = "tema"
VIEWPORT = {"width": 1280, "height": 900}
MOBILE_VIEWPORT = {"width": 375, "height": 812}
PALETTES = ("default", "sakura", "lavender")
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
META_FILE = "meta.json"
FONT_HOSTS = re.compile(r"https://fonts\.(googleapis|gstatic)\.com/")
# Jam server pada kartu note ("26 Okt 2026, 21.03") berubah tiap menit: teksnya diganti konstanta, gayanya tetap.
FREEZE_CLOCK_TEXT_JS = """() => {
    const re = /^\\d{1,2} [A-Za-z]{3,4} \\d{4}, \\d{2}\\.\\d{2}$/;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) if (re.test(n.nodeValue.trim())) n.nodeValue = '26 Okt 2026, 10.00';
}"""

results = []


def sw_version(repo):
    """Versi SW milik `repo`: ditulis ke tf_whatsnew_seen agar modal "Apa yang baru" tidak menutupi UI."""
    with open(os.path.join(repo, "static", "sw.js"), encoding="utf-8") as f:
        return re.search(r'^const CACHE = "([^"]+)";', f.read(), re.M).group(1)


def git(*args):
    r = subprocess.run(["git", "-C", ROOT] + list(args), capture_output=True, text=True)
    if r.returncode:
        raise RuntimeError("git %s gagal: %s" % (" ".join(args), r.stderr.strip()))
    return r.stdout.strip()


def working_tree_meta():
    """Asal pohon kerja sekarang: HEAD, hash static/ di HEAD, dan `dirty` bila static/ berbeda dari HEAD."""
    return {"ref": git("rev-parse", "HEAD"), "static_tree": git("rev-parse", "HEAD:static"),
            "dirty": bool(git("status", "--porcelain", "--", "static")), "date": datetime.date.today().isoformat()}


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


def start_server(tmp, repo):
    port = free_port()
    env = dict(os.environ, DB_PATH=os.path.join(tmp, "e2e.db"), UPLOAD_DIR=os.path.join(tmp, "uploads"),
               WEB_SECRET_KEY=SECRET, TELEGRAM_BOT_TOKEN="")
    os.makedirs(env["UPLOAD_DIR"], exist_ok=True)
    log = open(os.path.join(tmp, "server.log"), "w")
    proc = subprocess.Popen([server_python(), "-m", "uvicorn", "webapp:app", "--host", "127.0.0.1",
                             "--port", str(port)], cwd=repo, env=env, stdout=log, stderr=subprocess.STDOUT)
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


def open_app(browser, base, user, mode, groupby, viewmode, sw, palette="default", mobile=False):
    """Konteks + halaman yang sudah login. palette != default -> localStorage.tf_palette ditulis sebelum "/" dimuat;
    mobile -> viewport 375x812 dengan is_mobile/has_touch (topbar mobile, sidebar sebagai laci)."""
    extra = {"is_mobile": True, "has_touch": True} if mobile else {}
    ctx = browser.new_context(service_workers="block", viewport=MOBILE_VIEWPORT if mobile else VIEWPORT,
                              reduced_motion="reduce", **extra)
    ctx.route(FONT_HOSTS, lambda route: route.abort())
    ctx.clock.set_fixed_time(datetime.datetime.combine(datetime.date.today(), datetime.time(10, 0)))
    ctx.add_cookies([{"name": "token", "value": user["token"], "url": base, "httpOnly": True, "sameSite": "Lax"}])
    p = ctx.new_page()
    p.goto(base + "/manifest.json")
    p.evaluate("""([t, u, tours, mode, sw, groupby, viewmode, palette]) => {
        localStorage.setItem('tf_token', t); localStorage.setItem('tf_user_id', String(u));
        for (const pg of tours) localStorage.setItem('tf_tour_' + pg, '1');
        localStorage.setItem('tf_whatsnew_seen', sw);
        localStorage.setItem('tf_theme', mode);
        localStorage.setItem('tf_groupby', groupby);
        localStorage.setItem('tf_viewmode', viewmode);
        if (palette !== 'default') localStorage.setItem('tf_palette', palette);
    }""", [user["token"], user["id"], TOURS, mode, sw, groupby, viewmode, palette])
    p.goto(base + "/")
    p.locator(".sidebar-link, .sidebar-rail-btn, .mobile-topbar").first.wait_for(state="attached", timeout=20000)
    return ctx, p


def nav(page, label):
    """Buka halaman lewat link sidebar penuh (label teks); sidebar mode ikon (desktop) atau laci (topbar mobile)
    dibuka dulu."""
    link = page.locator(".sidebar-link").filter(has_text=label).first
    topbar = page.locator(".mobile-topbar button")
    if topbar.count() and topbar.first.is_visible():
        # Laci mobile tertutup tetap "visible" bagi Playwright (digeser ke luar layar): selalu buka dulu.
        topbar.first.click()
        page.wait_for_timeout(600)
    elif not link.is_visible():
        page.locator("button[aria-label='Tampilkan semua menu']").first.click()
    link.click()


def stable_screenshot(page, path):
    """Screenshot full page yang dua kali berturut-turut identik: membuang keadaan antara (transisi/render yang belum
    selesai) yang pernah menyisakan 2 piksel beda di satu gambar. Halaman yang tak kunjung stabil = error, bukan flake.
    Teks versi SW di kartu Pengaturan "Pembaruan Aplikasi" diganti teks tetap agar kenaikan versi bukan selisih."""
    prev = None
    for _ in range(5):
        page.evaluate("""() => { for (const c of document.querySelectorAll('code'))
            if (/^taskflow-v\\d+-/.test(c.textContent)) c.textContent = 'taskflow-vNNN-versi'; }""")
        data = page.screenshot(full_page=True, animations="disabled", caret="hide", scale="css")
        if data == prev:
            with open(path, "wb") as f:
                f.write(data)
            return
        prev = data
        page.wait_for_timeout(300)
    raise RuntimeError("halaman tidak stabil, screenshot terus berubah: " + os.path.basename(path))


def focus_first_task(page):
    """Klik Fokus pada task pertama; klik yang jatuh ke baris yang sedang dirender ulang diulang (tanpa toggle ganda)."""
    for attempt in range(3):
        page.locator(".ftask").first.locator(".ftask-focus-btn").click()
        try:
            page.locator(".ftask.is-focusing").wait_for(state="attached", timeout=5000)
            return
        except PlaywrightTimeout:
            if attempt == 2:
                raise


def shoot(browser, base, user, page, mode, out_dir, sw, palette="default", mobile=False):
    name, label, groupby, viewmode, ready_text = page
    ctx, p = open_app(browser, base, user, mode, groupby, viewmode, sw, palette, mobile)
    try:
        if label:
            nav(p, label)
        if ready_text:
            p.get_by_text(ready_text).first.wait_for(state="visible", timeout=20000)
        if name == "focus":
            focus_first_task(p)
        p.mouse.move(5, 5)
        p.wait_for_timeout(600)
        p.evaluate(FREEZE_CLOCK_TEXT_JS)
        path = os.path.join(out_dir, "%s%s-%s.png" % (name, "-375" if mobile else "", mode))
        stable_screenshot(p, path)
        print("  screenshot", os.path.basename(path), flush=True)
    finally:
        ctx.close()


def capture(out_dir, repo, meta, palette="default", mobile_pages=(), extra_shots=False):
    """Ambil 16 screenshot (+ halaman `mobile_pages` pada 375 px x 2 mode, + EXTRA_SHOTS x 2 mode bila extra_shots)
    dari server yang melayani `repo` dengan palet `palette` ke direktori staging, lalu pindahkan ke out_dir
    (menggantikan isi lamanya) hanya bila semuanya berhasil, bersama meta.json; kegagalan tidak menyentuh out_dir."""
    os.makedirs(SHOTS, exist_ok=True)
    for stale in glob.glob(os.path.join(SHOTS, ".staging-*")):  # sisa proses yang dimatikan paksa
        shutil.rmtree(stale, ignore_errors=True)
    sw = sw_version(repo)
    tmp = tempfile.mkdtemp(prefix="e2e_tema_fondasi_")
    proc, base = start_server(tmp, repo)
    print("server", base, "dari", repo, "->", os.path.relpath(out_dir, ROOT), flush=True)
    staging = None
    try:
        staging = tempfile.mkdtemp(prefix=".staging-", dir=SHOTS)
        user = seed(base)
        if extra_shots:
            seed_shots_extra(base, user)
        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            for mode in MODES:
                for page in PAGES:
                    shoot(browser, base, user, page, mode, staging, sw, palette)
                for page in PAGES:
                    if page[0] in mobile_pages:
                        shoot(browser, base, user, page, mode, staging, sw, palette, mobile=True)
                if extra_shots:
                    for name in EXTRA_SHOTS:
                        shoot_extra(browser, base, user, name, mode, staging, sw, palette)
            browser.close()
        with open(os.path.join(staging, META_FILE), "w") as f:
            json.dump(dict(meta, palette=palette), f, indent=2)
        shutil.rmtree(out_dir, ignore_errors=True)
        os.replace(staging, out_dir)
    finally:
        proc.terminate()
        try:
            proc.wait(10)
        except subprocess.TimeoutExpired:
            proc.kill()
        shutil.rmtree(tmp, ignore_errors=True)
        if staging:
            shutil.rmtree(staging, ignore_errors=True)  # sudah tak ada bila berhasil dipindah


def palette_dir(kind, palette):
    """baseline/after/diff untuk Default; baseline-<palet>/… untuk palet lain."""
    return os.path.join(SHOTS, kind if palette == "default" else "%s-%s" % (kind, palette))


def baseline(ref, palette="default"):
    """Baseline dari commit `ref` (git worktree sementara), atau dari pohon kerja sekarang bila ref kosong (--force)."""
    out_dir = palette_dir("baseline", palette)
    if not ref:
        capture(out_dir, ROOT, dict(working_tree_meta(), forced=True), palette)
        return
    sha = git("rev-parse", "--verify", ref + "^{commit}")
    meta = {"ref": sha, "static_tree": git("rev-parse", sha + ":static"), "date": datetime.date.today().isoformat()}
    parent = tempfile.mkdtemp(prefix="e2e_tema_fondasi_wt_")
    worktree = os.path.join(parent, "repo")
    try:
        git("worktree", "add", "--detach", worktree, sha)
        capture(out_dir, worktree, meta, palette)
    finally:
        subprocess.run(["git", "-C", ROOT, "worktree", "remove", "--force", worktree], capture_output=True)
        shutil.rmtree(parent, ignore_errors=True)


def expected_names():
    return ["%s-%s.png" % (page[0], mode) for mode in MODES for page in PAGES]


def count_diff_pixels(base_img, after_img, tolerance):
    """(jumlah piksel dengan kanal RGB selisih > tolerance, selisih kanal terbesar, gambar penanda merah = beda)."""
    diff = ImageChops.difference(base_img, after_img)
    max_delta = max(hi for _, hi in diff.getextrema())
    over = [band.point(lambda v: 255 if v > tolerance else 0) for band in diff.split()]
    mask = ImageChops.lighter(ImageChops.lighter(over[0], over[1]), over[2])
    count = mask.histogram()[255]
    marked = Image.blend(base_img, Image.new("RGB", base_img.size, (255, 255, 255)), 0.7)
    marked.paste(Image.new("RGB", base_img.size, (255, 0, 0)), mask=mask)
    return count, max_delta, marked


def compare(tolerance, palette="default"):
    base_dir, after_dir, diff_dir = (palette_dir(d, palette) for d in ("baseline", "after", "diff"))
    missing = [n for n in expected_names() + [META_FILE] if not os.path.exists(os.path.join(base_dir, n))]
    if missing:
        print("baseline belum lengkap (%d berkas hilang, mis. %s): jalankan `baseline --ref <commit>%s` lebih dulu" %
              (len(missing), missing[0], "" if palette == "default" else " --palette " + palette))
        return 1
    with open(os.path.join(base_dir, META_FILE)) as f:
        meta = json.load(f)
    print("baseline: ref %s, static %s, tanggal %s" % (meta["ref"], meta["static_tree"], meta["date"]), flush=True)
    if meta.get("forced"):
        print("PERINGATAN: baseline diambil dari pohon kerja (--force)" +
              (" dan static/ sudah berubah dari HEAD" if meta.get("dirty") else "") + ": gerbang bisa lolos tanpa makna")
    if meta["date"] != datetime.date.today().isoformat():
        print("baseline dibuat tanggal %s, hari ini %s: tanggal tampil di UI, jalankan ulang `baseline --ref <commit>`" %
              (meta["date"], datetime.date.today().isoformat()))
        return 1
    capture(after_dir, ROOT, working_tree_meta(), palette)
    shutil.rmtree(diff_dir, ignore_errors=True)
    for name in expected_names():
        label = os.path.splitext(name)[0]
        a_path, b_path = os.path.join(after_dir, name), os.path.join(base_dir, name)
        if not os.path.exists(a_path):
            check(label, False, "tidak ada di after/")
            continue
        base_img, after_img = Image.open(b_path).convert("RGB"), Image.open(a_path).convert("RGB")
        if base_img.size != after_img.size:
            check(label, False, "ukuran beda: baseline %dx%d, after %dx%d" % (base_img.size + after_img.size))
            continue
        count, max_delta, marked = count_diff_pixels(base_img, after_img, tolerance)
        if count:
            os.makedirs(diff_dir, exist_ok=True)
            marked.save(os.path.join(diff_dir, name))
        check(label, count == 0, "%d px, max delta %d" % (count, max_delta))
    failed = [r for r in results if not r[1]]
    print("\n%d gambar, %d gagal (tolerance %d)" % (len(results), len(failed), tolerance))
    return 1 if failed else 0


SHOT_MOBILE_PAGES = ("focus", "settings")
MODE_LABEL = {"light": "terang", "dark": "gelap"}


# Tangkapan tambahan khusus `shots` (audit final review PR B), 1280 px x 2 mode. Datanya (mindmap + sketsa) hanya
# di-seed untuk `shots`, jadi baseline/compare tidak berubah.
EXTRA_SHOTS = ("taskdetail", "noteeditor", "sketsa", "mindmap")
DRAW_TITLE = "Sketsa tema"
EDITOR_NOTE_TITLE = "Catatan audit tema"
EDITOR_NOTE_TAG = "audit-tema"
EDITOR_NOTE_CONTENT = ("## Ringkasan rapat\n\nPembuka dengan **tebal** dan `kode`.\n\n"
                       "- Butir pertama\n- Butir kedua\n- Butir ketiga\n\n#audit-tema\n")


def shot_names():
    """28 nama berkas `shots`: 8 halaman x 2 mode (1280 px), Fokus & Pengaturan 375 px x 2 mode, lalu EXTRA_SHOTS
    (detail task, editor note, Sketsa, mindmap) x 2 mode."""
    desk = ["%s-%s.png" % (page[0], mode) for page in PAGES for mode in MODES]
    mob = ["%s-375-%s.png" % (name, mode) for name in SHOT_MOBILE_PAGES for mode in MODES]
    extra = ["%s-%s.png" % (name, mode) for name in EXTRA_SHOTS for mode in MODES]
    return desk + mob + extra


def seed_shots_extra(base, user):
    """Data tambahan `shots`: satu mindmap (MAP_TITLE), satu sketsa kosong (DRAW_TITLE) dan satu note berjudul,
    berdaftar dan bertag (EDITOR_NOTE_TITLE) untuk tangkapan editor."""
    api(base, user, "POST", "/api/scratchpad", json={"title": EDITOR_NOTE_TITLE, "content": EDITOR_NOTE_CONTENT,
                                                     "tags": [EDITOR_NOTE_TAG]})
    tree = {"nodeData": {"id": "root", "topic": "Akar tema", "root": True,
                         "children": [{"id": "a", "topic": "Cabang A"}, {"id": "b", "topic": "Cabang B"}]}}
    api(base, user, "POST", "/api/mindmaps", json={"title": MAP_TITLE, "data_json": json.dumps(tree)})
    api(base, user, "POST", "/api/drawings", json={"title": DRAW_TITLE, "data_json": "{}"})


def loose_screenshot(page, path):
    """Seperti stable_screenshot, tetapi halaman yang tak kunjung stabil (iframe/kanvas yang masih memuat) tetap
    dipotret sekali (audit visual, bukan pembanding piksel)."""
    try:
        stable_screenshot(page, path)
    except RuntimeError:
        page.screenshot(path=path, full_page=True, animations="disabled", caret="hide", scale="css")
        print("  (tidak stabil, dipotret apa adanya)", flush=True)


def shoot_extra(browser, base, user, name, mode, out_dir, sw, palette="default"):
    """Satu tangkapan EXTRA_SHOTS: halaman dibuka lewat sidebar lalu item seed diklik."""
    ctx, p = open_app(browser, base, user, mode, "quadrant", "normal", sw, palette)
    try:
        p.get_by_text(TASKS[0][0]).first.wait_for(state="visible", timeout=20000)
        if name == "taskdetail":
            nav(p, "Semua Task")
            p.locator(".task-row", has_text=TASKS[0][0]).first.click()
            p.locator(".modal-content").first.wait_for(state="visible", timeout=20000)
        elif name == "noteeditor":
            nav(p, "Notes")
            p.locator(".note-card-title", has_text=EDITOR_NOTE_TITLE).first.click()
            # Note terbuka dalam tampilan baca; tombol Edit membuka editor Milkdown.
            p.get_by_role("button", name="Edit", exact=True).first.click()
            p.locator(".ProseMirror:visible").first.wait_for(state="visible", timeout=20000)
        elif name == "sketsa":
            nav(p, "Sketsa")
            row = p.locator("span", has_text=re.compile("^" + re.escape(DRAW_TITLE) + "$")).first
            row.wait_for(state="visible", timeout=20000)
            row.locator("xpath=..").click()
            try:  # kanvas tldraw (iframe) butuh bundel lokal: tanpa itu potret apa adanya
                p.frame_locator(".draw-tab-view-instance:visible iframe").locator(".tl-container").first.wait_for(
                    state="visible", timeout=20000)
                p.wait_for_timeout(1500)
            except PlaywrightTimeout:
                print("  kanvas Sketsa tidak muncul (bundel tldraw belum di-build?), memotret apa adanya", flush=True)
        elif name == "mindmap":
            nav(p, "Mindmap")
            item = p.locator("div[style*='cursor: pointer']").filter(
                has=p.locator("span", has_text=re.compile("^" + re.escape(MAP_TITLE) + "$"))).last
            item.wait_for(state="visible", timeout=20000)
            item.click()
            p.frame_locator(".mindmap-tab-view-instance:visible iframe").locator("me-tpc").first.wait_for(timeout=20000)
        p.mouse.move(5, 5)
        p.wait_for_timeout(800)
        p.evaluate(FREEZE_CLOCK_TEXT_JS)
        path = os.path.join(out_dir, "%s-%s.png" % (name, mode))
        loose_screenshot(p, path)
        print("  screenshot", os.path.basename(path), flush=True)
    finally:
        ctx.close()


def contact_sheet(src_dir, out_path, title, names):
    """Satu PNG berisi gambar `names` dalam grid 4 kolom berlabel (bagian atas tiap halaman, diperkecil)."""
    from PIL import ImageDraw, ImageFont

    def font(size):
        for f in ("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", "DejaVuSans-Bold.ttf"):
            try:
                return ImageFont.truetype(f, size)
            except OSError:
                pass
        return ImageFont.load_default()

    cols, cell_w, img_h, label_h, gap, head_h = 4, 400, 450, 26, 12, 44
    scales, heights = {}, []
    for name in names:
        with Image.open(os.path.join(src_dir, name)) as im:
            scales[name] = cell_w / im.width if im.width > 600 else 0.6  # 1280 px -> 400, 375 px -> 225
            heights.append(int(im.height * scales[name]))
    img_h = min(img_h, max(heights))  # tinggi baris = thumbnail tertinggi: lembar 1280x900 tanpa ruang kosong
    rows = (len(names) + cols - 1) // cols
    sheet = Image.new("RGB", (gap + cols * (cell_w + gap), head_h + rows * (label_h + img_h + gap)), (236, 236, 236))
    draw = ImageDraw.Draw(sheet)
    draw.text((gap, 10), title, fill=(20, 20, 20), font=font(22))
    for i, name in enumerate(names):
        x = gap + (i % cols) * (cell_w + gap)
        y = head_h + (i // cols) * (label_h + img_h + gap)
        stem = name[:-4]
        page, mode = stem.rsplit("-", 1)
        draw.text((x, y + 3), "%s · %s" % (page.replace("-375", " (375 px)"), MODE_LABEL[mode]), fill=(20, 20, 20),
                  font=font(16))
        img = Image.open(os.path.join(src_dir, name)).convert("RGB")
        scale = scales[name]
        crop = img.crop((0, 0, img.width, min(img.height, int(img_h / scale))))
        thumb = crop.resize((int(crop.width * scale), int(crop.height * scale)), Image.LANCZOS)
        sheet.paste(thumb, (x + (cell_w - thumb.width) // 2, y + label_h))
    sheet.save(out_path)
    return out_path


def shots(palette):
    """28 screenshot audit palet ke shots/<palet>/ + lembar kontak shots/<palet>-sheet.png (20 halaman) dan
    shots/<palet>-sheet-2.png (EXTRA_SHOTS). Tanpa pembanding."""
    out_dir = os.path.join(SHOTS, "shots", palette)
    os.makedirs(os.path.dirname(out_dir), exist_ok=True)
    capture(out_dir, ROOT, working_tree_meta(), palette, SHOT_MOBILE_PAGES, extra_shots=True)
    missing = [n for n in shot_names() if not os.path.exists(os.path.join(out_dir, n))]
    if missing:
        print("shots tidak lengkap, hilang:", ", ".join(missing))
        return 1
    names = shot_names()
    n_extra = len(EXTRA_SHOTS) * len(MODES)
    sheet = contact_sheet(out_dir, os.path.join(SHOTS, "shots", palette + "-sheet.png"),
                          "Alurik — palet %s (1280x900 dan 375x812, bagian atas halaman)" % palette.capitalize(),
                          names[:-n_extra])
    sheet2 = contact_sheet(out_dir, os.path.join(SHOTS, "shots", palette + "-sheet-2.png"),
                           "Alurik — palet %s: modal detail task, editor note, Sketsa, mindmap (1280x900)"
                           % palette.capitalize(), names[-n_extra:])
    print("%d gambar di %s\nlembar kontak: %s, %s" % (len(names), os.path.relpath(out_dir, ROOT),
                                                      os.path.relpath(sheet, ROOT), os.path.relpath(sheet2, ROOT)))
    return 0


# Disuntikkan tepat setelah <script id="tf-theme-boot">: memotret atribut <html> + meta sebelum skrip lain mana pun
# (TF.themes, React) berjalan, jadi nilai yang tercatat murni hasil skrip boot.
BOOT_SNAPSHOT = ('<script>window.__TF_BOOT_SNAPSHOT = JSON.stringify({ds: Object.assign({}, '
                 'document.documentElement.dataset), meta: document.querySelector(\'meta[name="theme-color"]\')'
                 '.getAttribute("content"), themesLoaded: !!(window.TF && window.TF.themes)});</script>')
# Disuntikkan tepat setelah <body>: stylesheet <head> (app.css, themes.css) sudah dimuat karena skrip menunggu
# stylesheet yang tertunda, sedangkan TF.themes belum dimuat dan App belum dirender -> --accent terhitung murni dari
# atribut skrip boot.
BODY_SNAPSHOT = ('<script>window.__TF_BODY_SNAPSHOT = JSON.stringify({ds: Object.assign({}, '
                 'document.documentElement.dataset), accent: getComputedStyle(document.documentElement)'
                 '.getPropertyValue("--accent").trim(), meta: document.querySelector(\'meta[name="theme-color"]\')'
                 '.getAttribute("content"), themesLoaded: !!(window.TF && window.TF.themes), '
                 'appRendered: !!(document.getElementById("root") && document.getElementById("root").childElementCount)});'
                 '</script>')
DATASET_JS = "() => Object.assign({}, document.documentElement.dataset)"
THEME_KEYS_JS = "() => ({tf_theme: localStorage.getItem('tf_theme'), tf_palette: localStorage.getItem('tf_palette'), tf_decor: localStorage.getItem('tf_decor')})"


def with_boot_snapshot(ctx, base):
    """Halaman "/" dilayani dengan BOOT_SNAPSHOT disisipkan setelah skrip boot tema dan BODY_SNAPSHOT setelah <body>."""
    def handle(route):
        resp = route.fetch()
        body = resp.text()
        marker = body.index('<script id="tf-theme-boot">')
        end = body.index("</script>", marker) + len("</script>")
        body = body[:end] + BOOT_SNAPSHOT + body[end:]
        b = body.index("<body>") + len("<body>")
        route.fulfill(response=resp, body=body[:b] + BODY_SNAPSHOT + body[b:])
    ctx.route(base + "/", handle)

ACCENT_JS = "() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()"
META_JS = "() => document.querySelector('meta[name=\"theme-color\"]').getAttribute('content')"
PALETTE_KEYS = {"sakura": {"light": "#B0287E", "dark": "#EE8FCB"}, "lavender": {"light": "#8A3AAE", "dark": "#CDA2F2"}}
MAP_TITLE = "Peta tema"


def same_color(a, b):
    return (a or "").strip().lower() == (b or "").strip().lower()


def seed_verify_extra(base, user):
    """Data tambahan khusus verify (tidak dipakai compare/shots, jadi baseline tidak berubah): 2 task selesai agar
    bagian Analitik Dashboard (grafik Tren Produktivitas) tampil, dan satu mindmap."""
    for title in ("Selesai satu", "Selesai dua"):
        tid = api(base, user, "POST", "/api/tasks", json={"title": title, "priority": "P3", "gtd_status": "next"})["id"]
        api(base, user, "POST", "/api/tasks/%d/done" % tid)
    tree = {"nodeData": {"id": "root", "topic": "Akar tema", "root": True,
                         "children": [{"id": "a", "topic": "Cabang A"}, {"id": "b", "topic": "Cabang B"}]}}
    api(base, user, "POST", "/api/mindmaps", json={"title": MAP_TITLE, "data_json": json.dumps(tree)})


def open_settings(p):
    nav(p, "Pengaturan")
    p.get_by_role("radiogroup", name="Mode").wait_for(state="visible", timeout=20000)


def pick_palette(p, name):
    """Klik tombol palet di kartu Tampilan dan tunggu data-palette berganti."""
    p.get_by_role("button", name=name, exact=True).click()
    p.wait_for_function("(id) => document.documentElement.dataset.palette === id", arg=name.lower(), timeout=5000)


def verify_palettes(browser, base, user, sw):
    """Cek PR B Task 7: v-boot, v-settings, v-system, v-chart, v-mindmap, v-settings-375."""
    # v-boot: tf_palette=sakura (terang) -> atribut + --accent terhitung sebelum TF.themes/App.
    ctx = browser.new_context(service_workers="block", viewport=VIEWPORT, reduced_motion="reduce")
    ctx.route(FONT_HOSTS, lambda route: route.abort())
    with_boot_snapshot(ctx, base)
    p = ctx.new_page()
    p.goto(base + "/manifest.json")
    p.evaluate("([t, u, sw]) => { localStorage.clear(); localStorage.setItem('tf_token', t); "
               "localStorage.setItem('tf_user_id', String(u)); localStorage.setItem('tf_whatsnew_seen', sw); "
               "localStorage.setItem('tf_theme', 'light'); localStorage.setItem('tf_palette', 'sakura'); }",
               [user["token"], user["id"], sw])
    p.goto(base + "/", wait_until="domcontentloaded")
    head = json.loads(p.evaluate("() => window.__TF_BOOT_SNAPSHOT || 'null'") or "null")
    body = json.loads(p.evaluate("() => window.__TF_BODY_SNAPSHOT || 'null'") or "null")
    want = {"theme": "light", "palette": "sakura", "decor": "on"}
    check("v-boot tf_palette=sakura: data-palette=sakura dan --accent #B0287E sebelum React "
          "(meta #FDF5FA, TF.themes belum dimuat, App belum dirender)",
          bool(head) and bool(body) and head["ds"] == want and body["ds"] == want and same_color(body["accent"], "#B0287E")
          and same_color(body["meta"], "#FDF5FA") and not body["themesLoaded"] and not body["appRendered"],
          "head=%r body=%r" % (head, body))
    ctx.close()

    # v-settings: klik palet Lavender di kartu Tampilan -> atribut, meta, localStorage, tanpa reload.
    ctx, p = open_app(browser, base, user, "light", "quadrant", "normal", sw)
    try:
        p.get_by_text(TASKS[0][0]).first.wait_for(state="visible", timeout=20000)
        open_settings(p)
        p.evaluate("() => { window.__tfNoReload = true; }")
        pressed_before = p.get_by_role("button", name="Default", exact=True).get_attribute("aria-pressed")
        pick_palette(p, "Lavender")
        got = p.evaluate("""() => [document.documentElement.dataset.palette,
            document.querySelector('meta[name="theme-color"]').getAttribute('content'),
            localStorage.getItem('tf_palette'), window.__tfNoReload === true]""")
        pressed = [p.get_by_role("button", name=n, exact=True).get_attribute("aria-pressed")
                   for n in ("Default", "Lavender")]
        check("v-settings klik palet Lavender: data-palette, meta #FAF6FD, tf_palette, tanpa reload, aria-pressed",
              got[0] == "lavender" and same_color(got[1], "#FAF6FD") and got[2] == "lavender" and got[3] is True
              and pressed_before == "true" and pressed == ["false", "true"], "%r pressed %r -> %r" % (got, pressed_before, pressed))

        # v-system: sistem gelap, mode terang -> klik "Ikuti sistem"; rekam setiap nilai data-theme sesudah klik.
        p.emulate_media(color_scheme="dark")
        p.evaluate("""() => {
            const el = document.documentElement;
            window.__tfThemeLog = [];
            window.__tfThemeMo = new MutationObserver(recs => recs.forEach((r, i) => window.__tfThemeLog.push(
                i + 1 < recs.length ? recs[i + 1].oldValue : el.getAttribute('data-theme'))));
            window.__tfThemeMo.observe(el, {attributes: true, attributeOldValue: true, attributeFilter: ['data-theme']});
        }""")
        start = p.evaluate(DATASET_JS).get("theme")
        p.get_by_role("radio", name="Ikuti sistem").click()
        try:
            p.wait_for_function("() => document.documentElement.dataset.theme === 'dark'", timeout=5000)
        except PlaywrightTimeout:
            pass
        p.wait_for_timeout(500)
        log = p.evaluate("() => { window.__tfThemeMo.disconnect(); return window.__tfThemeLog; }")
        final = p.evaluate("""() => [document.documentElement.dataset.theme, localStorage.getItem('tf_theme'),
            document.querySelector('[role=radio][aria-checked=true]').textContent, window.__tfNoReload === true]""")
        check("v-system pil 'Ikuti sistem' + prefers dark: data-theme=dark tanpa snapshot 'light' sesudah klik",
              start == "light" and final == ["dark", "system", "Ikuti sistem", True] and log and "light" not in log,
              "awal %r, log %r, akhir %r" % (start, log, final))
        p.emulate_media(color_scheme="light")
    finally:
        ctx.close()

    # v-chart: Dashboard dengan task selesai -> warna garis grafik Tren Produktivitas ikut palet.
    chart_js = """() => {
        const card = [...document.querySelectorAll('.dash-card')].find(c => c.textContent.includes('Tren Produktivitas'));
        const cv = card && card.querySelector('canvas');
        const ch = cv && window.Chart && window.Chart.getChart(cv);
        return ch ? ch.data.datasets.map(d => d.borderColor) : null;
    }"""
    ctx, p = open_app(browser, base, user, "light", "quadrant", "normal", sw)
    try:
        p.get_by_text("Tren Produktivitas").first.wait_for(state="visible", timeout=20000)
        p.wait_for_function(chart_js, timeout=10000)
        before = p.evaluate(chart_js)
        open_settings(p)
        pick_palette(p, "Sakura")
        nav(p, "Dashboard")
        p.get_by_text("Tren Produktivitas").first.wait_for(state="visible", timeout=20000)
        p.wait_for_function(chart_js, timeout=10000)
        after = p.evaluate(chart_js)
        check("v-chart ganti palet Default -> Sakura: borderColor grafik berubah (garis 'Dibuat' = aksen Sakura)",
              bool(before) and bool(after) and before != after and same_color(after[1], PALETTE_KEYS["sakura"]["light"]),
              "%r -> %r" % (before, after))
        # Ganti mode dari header saat Dashboard terbuka: grafik digambar ulang tanpa navigasi.
        p.locator("[title='Ganti ke mode gelap']:visible").first.click()
        p.wait_for_function("() => document.documentElement.dataset.theme === 'dark'", timeout=5000)
        try:
            p.wait_for_function("(c) => { const v = (%s)(); return v && v[1].toLowerCase() === c; }" % chart_js,
                                arg=PALETTE_KEYS["sakura"]["dark"].lower(), timeout=5000)
        except PlaywrightTimeout:
            pass
        live = p.evaluate(chart_js)
        check("v-chart toggle header ke gelap: garis 'Dibuat' = aksen Sakura gelap tanpa navigasi",
              bool(live) and same_color(live[1], PALETTE_KEYS["sakura"]["dark"]), repr(live))
    finally:
        ctx.close()

    # v-mindmap: Default -> iframe memakai aksennya sendiri; Sakura -> --side-accent iframe = --accent induk.
    side_js = """() => { const st = getComputedStyle(document.documentElement);
        return [st.getPropertyValue('--side-accent').trim(), document.documentElement.style.getPropertyValue('--side-accent')]; }"""

    def iframe_side(p, want=None):
        fr = p.locator(".mindmap-tab-view-instance:visible iframe").first.element_handle().content_frame()
        if want:
            try:
                fr.wait_for_function("(w) => getComputedStyle(document.documentElement).getPropertyValue('--side-accent')"
                                     ".trim().toLowerCase() === w", arg=want.lower(), timeout=5000)
            except PlaywrightTimeout:
                pass
        return fr.evaluate(side_js)

    def open_map(p):
        nav(p, "Mindmap")
        item = p.locator("div[style*='cursor: pointer']").filter(
            has=p.locator("span", has_text=re.compile("^" + re.escape(MAP_TITLE) + "$"))).last
        item.wait_for(state="visible", timeout=20000)
        item.click()
        p.frame_locator(".mindmap-tab-view-instance:visible iframe").locator("me-tpc").first.wait_for(timeout=20000)
        p.wait_for_timeout(500)

    ctx, p = open_app(browser, base, user, "light", "quadrant", "normal", sw)
    try:
        p.get_by_text(TASKS[0][0]).first.wait_for(state="visible", timeout=20000)
        open_map(p)
        default_side = iframe_side(p)
        open_settings(p)
        pick_palette(p, "Sakura")
        accent = p.evaluate(ACCENT_JS)
        open_map(p)
        sakura_side = iframe_side(p, accent)
        check("v-mindmap Default: iframe memakai aksen bawaannya (#A8C500, tanpa properti inline)",
              same_color(default_side[0], "#A8C500") and default_side[1] == "", repr(default_side))
        check("v-mindmap ganti palet ke Sakura: --side-accent iframe = --accent induk (#B0287E)",
              same_color(sakura_side[0], accent) and same_color(accent, PALETTE_KEYS["sakura"]["light"]),
              "induk %r, iframe %r" % (accent, sakura_side))
        p.locator("[title='Ganti ke mode gelap']:visible").first.click()
        p.wait_for_function("() => document.documentElement.dataset.theme === 'dark'", timeout=5000)
        dark_side = iframe_side(p, PALETTE_KEYS["sakura"]["dark"])
        check("v-mindmap toggle header ke gelap saat peta terbuka: --side-accent iframe = Sakura gelap (#EE8FCB)",
              same_color(dark_side[0], PALETTE_KEYS["sakura"]["dark"]), repr(dark_side))
    finally:
        ctx.close()

    # v-settings-375: grid palet satu kolom, tanpa scroll horizontal.
    ctx, p = open_app(browser, base, user, "light", "quadrant", "normal", sw, mobile=True)
    try:
        open_settings(p)
        p.get_by_role("group", name="Palet").scroll_into_view_if_needed()
        g = p.evaluate("""() => {
            const grid = document.querySelector('.theme-card-palettes');
            const btns = [...grid.querySelectorAll('.theme-card-palette')].map(b => b.getBoundingClientRect());
            return {cols: getComputedStyle(grid).gridTemplateColumns.trim().split(/\\s+/).length,
                    lefts: [...new Set(btns.map(b => Math.round(b.left)))].length, n: btns.length,
                    hscroll: document.documentElement.scrollWidth > window.innerWidth,
                    sw: document.documentElement.scrollWidth, iw: window.innerWidth};
        }""")
        check("v-settings-375 grid palet 1 kolom, tanpa scroll horizontal",
              g["cols"] == 1 and g["lefts"] == 1 and g["n"] == 3 and not g["hscroll"], repr(g))
    finally:
        ctx.close()


def verify():
    """Cek perilaku tema di browser: (a) skrip boot memasang atribut sebelum React, (b) toggle header menulis tf_theme
    dan mengganti data-theme, (c) mode system mengikuti prefers-color-scheme tanpa reload, (d) logout tidak menghapus
    kunci tema, lalu cek palet v-* (verify_palettes). Keluar non-zero bila ada cek gagal."""
    sw = sw_version(ROOT)
    tmp = tempfile.mkdtemp(prefix="e2e_tema_fondasi_verify_")
    proc, base = start_server(tmp, ROOT)
    print("server", base, flush=True)
    try:
        user = seed(base)
        seed_verify_extra(base, user)
        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            want = {"theme": "dark", "palette": "default", "decor": "on"}

            # (a) tf_theme=dark → atribut terpasang oleh skrip boot, sebelum TF.themes/React.
            ctx = browser.new_context(service_workers="block", viewport=VIEWPORT, reduced_motion="reduce")
            ctx.route(FONT_HOSTS, lambda route: route.abort())
            with_boot_snapshot(ctx, base)
            p = ctx.new_page()
            p.goto(base + "/manifest.json")
            p.evaluate("([t, u, sw]) => { localStorage.clear(); localStorage.setItem('tf_token', t); "
                       "localStorage.setItem('tf_user_id', String(u)); localStorage.setItem('tf_whatsnew_seen', sw); "
                       "localStorage.setItem('tf_theme', 'dark'); }", [user["token"], user["id"], sw])
            p.goto(base + "/", wait_until="domcontentloaded")
            ds = p.evaluate(DATASET_JS)
            snap = json.loads(p.evaluate("() => window.__TF_BOOT_SNAPSHOT || 'null'") or "null")
            check("a1 domcontentloaded: dataset = dark/default/on", ds == want, repr(ds))
            check("a2 tepat setelah skrip boot (TF.themes belum dimuat): dataset = dark/default/on, meta #0f172a",
                  bool(snap) and snap["ds"] == want and snap["meta"] == "#0f172a" and not snap["themesLoaded"], repr(snap))
            ctx.close()

            # (b)–(d) memakai open_app (login + tf_theme=light).
            ctx, p = open_app(browser, base, user, "light", "quadrant", "normal", sw)
            try:
                p.get_by_text(TASKS[0][0]).first.wait_for(state="visible", timeout=20000)
                before = (p.evaluate(THEME_KEYS_JS)["tf_theme"], p.evaluate(DATASET_JS).get("theme"))
                p.locator("[title='Ganti ke mode gelap']:visible").first.click()
                p.wait_for_function("() => document.documentElement.dataset.theme === 'dark'", timeout=5000)
                after = (p.evaluate(THEME_KEYS_JS)["tf_theme"], p.evaluate(DATASET_JS).get("theme"))
                check("b1 toggle header terang → gelap: tf_theme dan data-theme", before == ("light", "light") and
                      after == ("dark", "dark"), "%r -> %r" % (before, after))
                p.locator("[title='Ganti ke mode terang']:visible").first.click()
                p.wait_for_function("() => document.documentElement.dataset.theme === 'light'", timeout=5000)
                back = (p.evaluate(THEME_KEYS_JS)["tf_theme"], p.evaluate(DATASET_JS).get("theme"))
                check("b2 toggle header gelap → terang", back == ("light", "light"), repr(back))

                # (c) mode system: tf_theme=system lalu reload (App membaca preferensi saat mount).
                p.emulate_media(color_scheme="dark")
                p.evaluate("() => localStorage.setItem('tf_theme', 'system')")
                p.reload()
                p.get_by_text(TASKS[0][0]).first.wait_for(state="visible", timeout=20000)
                c1 = p.evaluate(DATASET_JS).get("theme")
                check("c1 system + prefers dark → data-theme=dark", c1 == "dark", repr(c1))
                p.evaluate("() => { window.__tfNoReload = true; }")
                p.emulate_media(color_scheme="light")
                try:
                    p.wait_for_function("() => document.documentElement.dataset.theme === 'light'", timeout=5000)
                except PlaywrightTimeout:
                    pass
                c2 = p.evaluate("() => [document.documentElement.dataset.theme, window.__tfNoReload === true, "
                                "localStorage.getItem('tf_theme')]")
                check("c2 prefers light → data-theme=light tanpa reload, tf_theme tetap system",
                      c2 == ["light", True, "system"], repr(c2))
                p.emulate_media(color_scheme="dark")
                try:
                    p.wait_for_function("() => document.documentElement.dataset.theme === 'dark'", timeout=5000)
                except PlaywrightTimeout:
                    pass
                c3 = p.evaluate(DATASET_JS).get("theme")
                check("c3 prefers dark lagi → data-theme=dark", c3 == "dark", repr(c3))

                # (d) logout → ketiga kunci tema tetap.
                p.evaluate("() => { localStorage.setItem('tf_theme', 'dark'); localStorage.setItem('tf_palette', 'default'); "
                           "localStorage.setItem('tf_decor', 'off'); }")
                nav(p, "Logout")
                p.locator("input[type=password]").first.wait_for(state="visible", timeout=20000)
                keys = p.evaluate(THEME_KEYS_JS)
                token = p.evaluate("() => localStorage.getItem('tf_token')")
                check("d1 logout (form login tampil, tf_token terhapus)", token is None, repr(token))
                check("d2 setelah logout tf_theme/tf_palette/tf_decor tetap",
                      keys == {"tf_theme": "dark", "tf_palette": "default", "tf_decor": "off"}, repr(keys))
            finally:
                ctx.close()
            verify_palettes(browser, base, user, sw)
            browser.close()
    finally:
        proc.terminate()
        try:
            proc.wait(10)
        except subprocess.TimeoutExpired:
            proc.kill()
        shutil.rmtree(tmp, ignore_errors=True)
    failed = [r for r in results if not r[1]]
    print("\n%d cek, %d gagal" % (len(results), len(failed)))
    return 1 if failed else 0


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    pal = dict(choices=PALETTES, default="default", help="palet (localStorage.tf_palette), bawaan default")
    base_ = sub.add_parser("baseline", help="simpan 16 screenshot ke baseline/ dari satu commit")
    base_.add_argument("--palette", **pal)
    src = base_.add_mutually_exclusive_group()
    src.add_argument("--ref", help="commit/branch/tag untuk baseline, di-checkout ke git worktree sementara (mis. 64f3782)")
    src.add_argument("--force", action="store_true",
                     help="tanpa --ref: ambil dari pohon kerja sekarang (gerbang bisa lolos tanpa makna bila static/ berubah)")
    cmp_ = sub.add_parser("compare", help="ambil after/ dari pohon kerja, bandingkan dengan baseline/")
    cmp_.add_argument("--tolerance", type=int, default=3, help="selisih kanal maksimum yang masih dianggap sama")
    cmp_.add_argument("--palette", **pal)
    shots_ = sub.add_parser("shots", help="28 screenshot audit satu palet ke shots/<palet>/ + lembar kontak")
    shots_.add_argument("--palette", **pal)
    sub.add_parser("verify", help="cek perilaku tema di browser (skrip boot, toggle, mode system, logout, palet)")
    args = ap.parse_args()
    if args.cmd == "baseline":
        if not args.ref and not args.force:
            base_.error("butuh --ref <commit> (mis. --ref 64f3782); --force hanya untuk mengambil dari pohon kerja")
        baseline(args.ref, args.palette)
        sys.exit(0)
    if args.cmd == "verify":
        sys.exit(verify())
    if args.cmd == "shots":
        sys.exit(shots(args.palette))
    sys.exit(compare(args.tolerance, args.palette))


if __name__ == "__main__":
    main()
