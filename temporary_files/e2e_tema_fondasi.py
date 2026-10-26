"""E2E identitas piksel PR A tema (fondasi token): 8 halaman x 2 mode, baseline vs sesudah. Tidak dijalankan CI.

Refactor token warna tidak boleh mengubah satu piksel pun tampilan Default terang/gelap. Skrip ini mengambil
16 screenshot (1280x900, full page) dari server lokal bertemp DB, lalu membandingkannya:

    python3 temporary_files/e2e_tema_fondasi.py baseline --ref 64f3782   # commit itu -> baseline/ (aman dijalankan kapan saja)
    python3 temporary_files/e2e_tema_fondasi.py compare                  # pohon kerja sekarang -> after/, PASS/FAIL per gambar
    python3 temporary_files/e2e_tema_fondasi.py compare --tolerance 3
    python3 temporary_files/e2e_tema_fondasi.py verify                   # perilaku tema (Task 6), PASS/FAIL per cek

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


def open_app(browser, base, user, mode, groupby, viewmode, sw):
    ctx = browser.new_context(service_workers="block", viewport=VIEWPORT, reduced_motion="reduce")
    ctx.route(FONT_HOSTS, lambda route: route.abort())
    ctx.clock.set_fixed_time(datetime.datetime.combine(datetime.date.today(), datetime.time(10, 0)))
    ctx.add_cookies([{"name": "token", "value": user["token"], "url": base, "httpOnly": True, "sameSite": "Lax"}])
    p = ctx.new_page()
    p.goto(base + "/manifest.json")
    p.evaluate("""([t, u, tours, mode, sw, groupby, viewmode]) => {
        localStorage.setItem('tf_token', t); localStorage.setItem('tf_user_id', String(u));
        for (const pg of tours) localStorage.setItem('tf_tour_' + pg, '1');
        localStorage.setItem('tf_whatsnew_seen', sw);
        localStorage.setItem('tf_theme', mode);
        localStorage.setItem('tf_groupby', groupby);
        localStorage.setItem('tf_viewmode', viewmode);
    }""", [user["token"], user["id"], TOURS, mode, sw, groupby, viewmode])
    p.goto(base + "/")
    p.locator(".sidebar-link, .sidebar-rail-btn").first.wait_for(state="attached", timeout=20000)
    return ctx, p


def nav(page, label):
    """Buka halaman lewat link sidebar penuh (label teks); sidebar mode ikon dibuka dulu."""
    link = page.locator(".sidebar-link").filter(has_text=label).first
    if not link.is_visible():
        page.locator("button[aria-label='Tampilkan semua menu']").first.click()
    link.click()


def stable_screenshot(page, path):
    """Screenshot full page yang dua kali berturut-turut identik: membuang keadaan antara (transisi/render yang belum
    selesai) yang pernah menyisakan 2 piksel beda di satu gambar. Halaman yang tak kunjung stabil = error, bukan flake."""
    prev = None
    for _ in range(5):
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


def shoot(browser, base, user, page, mode, out_dir, sw):
    name, label, groupby, viewmode, ready_text = page
    ctx, p = open_app(browser, base, user, mode, groupby, viewmode, sw)
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
        path = os.path.join(out_dir, "%s-%s.png" % (name, mode))
        stable_screenshot(p, path)
        print("  screenshot", os.path.basename(path), flush=True)
    finally:
        ctx.close()


def capture(out_dir, repo, meta):
    """Ambil 16 screenshot dari server yang melayani `repo` ke direktori staging, lalu pindahkan ke out_dir
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
        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            for mode in MODES:
                for page in PAGES:
                    shoot(browser, base, user, page, mode, staging, sw)
            browser.close()
        with open(os.path.join(staging, META_FILE), "w") as f:
            json.dump(meta, f, indent=2)
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


def baseline(ref):
    """Baseline dari commit `ref` (git worktree sementara), atau dari pohon kerja sekarang bila ref kosong (--force)."""
    out_dir = os.path.join(SHOTS, "baseline")
    if not ref:
        capture(out_dir, ROOT, dict(working_tree_meta(), forced=True))
        return
    sha = git("rev-parse", "--verify", ref + "^{commit}")
    meta = {"ref": sha, "static_tree": git("rev-parse", sha + ":static"), "date": datetime.date.today().isoformat()}
    parent = tempfile.mkdtemp(prefix="e2e_tema_fondasi_wt_")
    worktree = os.path.join(parent, "repo")
    try:
        git("worktree", "add", "--detach", worktree, sha)
        capture(out_dir, worktree, meta)
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


def compare(tolerance):
    base_dir, after_dir, diff_dir = (os.path.join(SHOTS, d) for d in ("baseline", "after", "diff"))
    missing = [n for n in expected_names() + [META_FILE] if not os.path.exists(os.path.join(base_dir, n))]
    if missing:
        print("baseline belum lengkap (%d berkas hilang, mis. %s): jalankan `baseline --ref <commit>` lebih dulu" %
              (len(missing), missing[0]))
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
    capture(after_dir, ROOT, working_tree_meta())
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


# Disuntikkan tepat setelah <script id="tf-theme-boot">: memotret atribut <html> + meta sebelum skrip lain mana pun
# (TF.themes, React) berjalan, jadi nilai yang tercatat murni hasil skrip boot.
BOOT_SNAPSHOT = ('<script>window.__TF_BOOT_SNAPSHOT = JSON.stringify({ds: Object.assign({}, '
                 'document.documentElement.dataset), meta: document.querySelector(\'meta[name="theme-color"]\')'
                 '.getAttribute("content"), themesLoaded: !!(window.TF && window.TF.themes)});</script>')
DATASET_JS = "() => Object.assign({}, document.documentElement.dataset)"
THEME_KEYS_JS = "() => ({tf_theme: localStorage.getItem('tf_theme'), tf_palette: localStorage.getItem('tf_palette'), tf_decor: localStorage.getItem('tf_decor')})"


def with_boot_snapshot(ctx, base):
    """Halaman "/" dilayani dengan BOOT_SNAPSHOT disisipkan setelah skrip boot tema."""
    def handle(route):
        resp = route.fetch()
        body = resp.text()
        marker = body.index('<script id="tf-theme-boot">')
        end = body.index("</script>", marker) + len("</script>")
        route.fulfill(response=resp, body=body[:end] + BOOT_SNAPSHOT + body[end:])
    ctx.route(base + "/", handle)


def verify():
    """Cek perilaku tema di browser: (a) skrip boot memasang atribut sebelum React, (b) toggle header menulis tf_theme
    dan mengganti data-theme, (c) mode system mengikuti prefers-color-scheme tanpa reload, (d) logout tidak menghapus
    kunci tema. Keluar non-zero bila ada cek gagal."""
    sw = sw_version(ROOT)
    tmp = tempfile.mkdtemp(prefix="e2e_tema_fondasi_verify_")
    proc, base = start_server(tmp, ROOT)
    print("server", base, flush=True)
    try:
        user = seed(base)
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
                p.locator("[title='Switch to Dark']:visible").first.click()
                p.wait_for_function("() => document.documentElement.dataset.theme === 'dark'", timeout=5000)
                after = (p.evaluate(THEME_KEYS_JS)["tf_theme"], p.evaluate(DATASET_JS).get("theme"))
                check("b1 toggle header terang → gelap: tf_theme dan data-theme", before == ("light", "light") and
                      after == ("dark", "dark"), "%r -> %r" % (before, after))
                p.locator("[title='Switch to Light']:visible").first.click()
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
    base_ = sub.add_parser("baseline", help="simpan 16 screenshot ke baseline/ dari satu commit")
    src = base_.add_mutually_exclusive_group()
    src.add_argument("--ref", help="commit/branch/tag untuk baseline, di-checkout ke git worktree sementara (mis. 64f3782)")
    src.add_argument("--force", action="store_true",
                     help="tanpa --ref: ambil dari pohon kerja sekarang (gerbang bisa lolos tanpa makna bila static/ berubah)")
    cmp_ = sub.add_parser("compare", help="ambil after/ dari pohon kerja, bandingkan dengan baseline/")
    cmp_.add_argument("--tolerance", type=int, default=3, help="selisih kanal maksimum yang masih dianggap sama")
    sub.add_parser("verify", help="cek perilaku tema di browser (skrip boot, toggle, mode system, logout)")
    args = ap.parse_args()
    if args.cmd == "baseline":
        if not args.ref and not args.force:
            base_.error("butuh --ref <commit> (mis. --ref 64f3782); --force hanya untuk mengambil dari pohon kerja")
        baseline(args.ref)
        sys.exit(0)
    if args.cmd == "verify":
        sys.exit(verify())
    sys.exit(compare(args.tolerance))


if __name__ == "__main__":
    main()
