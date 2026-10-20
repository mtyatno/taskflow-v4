"""E2E audio/video di note (PR frontend, Task 7). Tidak dijalankan CI.

Alur (spec §9, brief Task 7):
  1  unggah video (mp4 ffmpeg 3 dtk) + audio (mp3) dari editor → progres → kartu `ready`
  2  putar di mode baca; geser currentTime → request /media/ ber-Range → 206, BUKAN dari SW
  3  unggah 12 MB, jaringan putus di tengah (context.route abort /upload), pulih → selesai tanpa ulang dari 0
  4  reload saat unggah → kartu `uploading-stalled` → file berbeda (ditolak) → file sama (lanjut dari offset)
  5  anggota workspace memutar media note bersama, tanpa tombol Hapus untuk media pemilik
  6  offline → kartu "Butuh koneksi untuk memutar"; tombol 🎬 nonaktif + tooltip; SW tidak melayani meta dari cache
  7  direktif dengan nama berbahaya dan cid note lain → teks ter-escape / pesan `missing`
  8  token kedaluwarsa (server kedua MEDIA_URL_TTL_SEC=5) → jeda, tunggu, geser+putar → posisi dipulihkan

Service worker AKTIF (service_workers="allow"); wajib env PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS=1
(diset di skrip) agar context.route juga menangkap fetch dari SW. Chromium Playwright tanpa H.264 → pemutaran
diuji dengan WebM (VP8/Opus); MP4 hanya dicek sampai `ready`.

    python temporary_files/e2e_note_media.py      (python sistem, bukan venv)

Screenshot ke temporary_files/e2e_note_media/ (di-.gitignore). Keluar non-zero bila ada langkah gagal.
"""
import os
import re
import socket
import subprocess
import sys
import tempfile
import time
import uuid

os.environ["PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS"] = "1"

import requests  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHOTS = os.path.join(ROOT, "temporary_files", "e2e_note_media")
PW = "rahasia123"
SECRET = "e2e-note-media-secret-0123456789abcdef"
TOURS = ['dashboard', 'tasks', 'today', 'calendar', 'kanban', 'notes', 'mindmap', 'chat', 'habits', 'habit',
         'settings', 'draw', 'goals', 'review', 'focus', 'workspace', 'slist']
CHUNK = 5 * 1024 * 1024
STALLED = "Unggahan terhenti — pilih file yang sama untuk melanjutkan"
MISMATCH = "File berbeda — pilih file yang sama dengan yang diunggah"
OFFLINE_CARD = "Butuh koneksi untuk memutar"
OFFLINE_BTN = "Butuh koneksi internet untuk mengunggah audio/video"
MISSING = "Media tidak tersedia untukmu: sudah dihapus atau bukan bagian dari catatan ini."
READ_CARD = "[data-media-card]:not(.editor-media-card)"
EDIT_CARD = ".ProseMirror .editor-media-card"

results = []
PUMP = [None]  # halaman aktif: wait_until memompa event Playwright (handler route/request) lewat wait_for_timeout


def check(step, ok, note=""):
    results.append((step, bool(ok), str(note)))
    print(("PASS " if ok else "FAIL ") + step + (" — " + str(note) if note else ""), flush=True)
    return ok


def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


def ffmpeg(*args):
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", *args], check=True)


def make_media(tmp):
    d = os.path.join(tmp, "files")
    os.makedirs(d)
    f = {
        "mp4": os.path.join(d, "video uji.mp4"),
        "mp3": os.path.join(d, "audio uji.mp3"),
        "webm": os.path.join(d, "klip kecil.webm"),
        "big": os.path.join(d, "besar 12mb.webm"),
    }
    ffmpeg("-f", "lavfi", "-i", "testsrc=duration=3:size=320x240:rate=15", "-f", "lavfi", "-i",
           "sine=frequency=440:duration=3", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", f["mp4"])
    ffmpeg("-f", "lavfi", "-i", "sine=frequency=330:duration=3", "-c:a", "libmp3lame", "-b:a", "128k", f["mp3"])
    ffmpeg("-f", "lavfi", "-i", "testsrc=duration=3:size=320x240:rate=15", "-f", "lavfi", "-i",
           "sine=frequency=440:duration=3", "-c:v", "libvpx", "-b:v", "300k", "-c:a", "libopus", "-shortest", f["webm"])
    # ±12 MB: 10 dtk derau (sulit dikompresi) VP8 bitrate tinggi
    ffmpeg("-f", "lavfi", "-i", "testsrc2=size=640x360:rate=25,noise=alls=80:allf=t", "-f", "lavfi", "-i",
           "sine=frequency=550:duration=10", "-t", "10", "-c:v", "libvpx", "-b:v", "9600k", "-minrate", "9600k",
           "-maxrate", "9600k", "-bufsize", "2000k", "-c:a", "libopus", "-shortest", f["big"])
    print("  ukuran besar:", os.path.getsize(f["big"]), flush=True)
    return f


def start_server(tmp, name, extra=None):
    port = free_port()
    d = os.path.join(tmp, name)
    os.makedirs(os.path.join(d, "uploads"))
    env = dict(os.environ, DB_PATH=os.path.join(d, "e2e.db"), UPLOAD_DIR=os.path.join(d, "uploads"),
               MEDIA_ROOT=os.path.join(d, "media"), MEDIA_ACCEL="0", WEB_SECRET_KEY=SECRET,
               WEB_PORT=str(port), TELEGRAM_BOT_TOKEN="", **(extra or {}))
    log = open(os.path.join(d, "server.log"), "w")
    proc = subprocess.Popen([sys.executable, "-m", "uvicorn", "webapp:app", "--host", "127.0.0.1",
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
    return {"username": u, "id": j["user_id"], "token": j["token"], "name": name}


def api(base, user, method, path, ok_codes=(200,), headers=None, **kw):
    h = {"Authorization": "Bearer " + user["token"]}
    h.update(headers or {})
    r = requests.request(method, base + path, headers=h, timeout=30, **kw)
    if r.status_code not in ok_codes:
        raise RuntimeError("%s %s → %d %s" % (method, path, r.status_code, r.text[:200]))
    try:
        return r.json()
    except ValueError:
        return None


def make_note(base, user, title, content, list_id=None):
    body = {"title": title, "content": content, "tags": [], "client_id": str(uuid.uuid4())}
    if list_id is not None:
        body["list_id"] = list_id
    return api(base, user, "POST", "/api/scratchpad", json=body)


def api_upload(base, user, note_id, path, mime, cid=None):
    """Unggah lewat API (init → PATCH potongan → complete) lalu tunggu ready. → (cid, att_id)."""
    cid = cid or str(uuid.uuid4())
    size = os.path.getsize(path)
    att = api(base, user, "POST", "/api/scratchpad/%d/media" % note_id,
              json={"client_id": cid, "filename": os.path.basename(path), "size": size, "mime": mime})["id"]
    with open(path, "rb") as fh:
        data = fh.read()
    off = 0
    while off < size:
        api(base, user, "PATCH", "/api/media/%d/upload" % att, data=data[off:off + CHUNK],
            headers={"Upload-Offset": str(off), "Content-Type": "application/offset+octet-stream"})
        off = min(size, off + CHUNK)
    api(base, user, "POST", "/api/media/%d/complete" % att)
    st = wait_until(lambda: api(base, user, "GET", "/api/media/%d" % att)["status"] in ("ready", "failed")
                    and api(base, user, "GET", "/api/media/%d" % att)["status"], 60)
    if st != "ready":
        raise RuntimeError("media %d tidak ready: %s" % (att, st))
    return cid, att


def from_sw(req):
    """Request yang dibuat service worker (bukan halaman): Request.frame melempar untuk request SW."""
    sw = getattr(req, "service_worker", None)
    if sw is not None:
        return True
    try:
        req.frame
        return False
    except Exception:  # noqa: BLE001
        return True


def directive(cid, name):
    return '::media[%s]{name="%s"}' % (cid, name)


def wait_until(fn, timeout=15, interval=0.25):
    end = time.time() + timeout
    last = None
    while time.time() < end:
        try:
            last = fn()
            if last:
                return last
        except Exception as e:  # noqa: BLE001
            last = None
            _ = e
        if PUMP[0] is not None:
            try:
                PUMP[0].wait_for_timeout(int(interval * 1000))
                continue
            except Exception:  # noqa: BLE001
                PUMP[0] = None
        time.sleep(interval)
    return last


def shot(page, name):
    path = os.path.join(SHOTS, name)
    page.wait_for_timeout(300)
    page.screenshot(path=path, full_page=False)
    print("  screenshot", os.path.relpath(path, ROOT), flush=True)


def open_app(browser, base, user):
    """Konteks dengan SW aktif; tunggu SW mengontrol halaman + reload controllerchange pertama selesai."""
    ctx = browser.new_context(service_workers="allow", viewport={"width": 1366, "height": 900})
    ctx.add_cookies([{"name": "token", "value": user["token"], "url": base, "httpOnly": True, "sameSite": "Lax"}])
    p = ctx.new_page()
    p.errors = []
    p.base = base
    p.on("pageerror", lambda e: p.errors.append(str(e)))
    p.on("dialog", lambda d: d.accept())  # confirm Hapus + beforeunload saat reload ketika unggah aktif
    p.goto(base + "/manifest.json")
    p.evaluate("""([t, u, tours]) => {
        localStorage.setItem('tf_token', t); localStorage.setItem('tf_user_id', String(u));
        for (const pg of tours) localStorage.setItem('tf_tour_' + pg, '1');
        localStorage.setItem('tf_dismiss_onboarding', '1');
    }""", [user["token"], user["id"], TOURS])
    p.goto(base + "/")
    p.wait_for_function("() => navigator.serviceWorker && navigator.serviceWorker.controller", timeout=30000)
    p.wait_for_timeout(2500)  # reload controllerchange pertama (index.html) selesai
    p.goto(base + "/")
    p.locator(".sidebar-link").first.wait_for(state="attached", timeout=30000)
    PUMP[0] = p
    return ctx, p


def home(p):
    p.goto(p.base + "/")
    p.locator(".sidebar-link").first.wait_for(state="attached", timeout=30000)


def go_notes(p):
    link = p.locator(".sidebar-link").filter(has=p.locator("span", has_text=re.compile("^Notes$")))
    if link.count() == 0 or not link.first.is_visible():
        ex = p.locator("button[aria-label='Tampilkan semua menu']")
        if ex.count() and ex.first.is_visible():
            ex.first.click()
    link.first.click()


def open_note(p, title, edit=False):
    home(p)  # muat ulang → pull note terbaru (juga offline: shell dari cache SW)
    go_notes(p)
    item = p.get_by_text(title).first
    try:
        item.wait_for(timeout=20000)
    except Exception:
        shot(p, "debug_open_note.png")
        raise
    item.click()
    p.locator(".notes-panel-actions").first.wait_for(timeout=15000)
    if edit:
        p.locator(".notes-panel-actions").first.get_by_text("Edit", exact=True).click()
        p.locator(".ProseMirror").first.wait_for(timeout=15000)


def card_state(loc):
    try:
        return loc.get_attribute("data-media-state", timeout=2000)
    except Exception:  # noqa: BLE001
        return None


def wait_state(loc, want, timeout=60):
    seen = []
    end = time.time() + timeout
    while time.time() < end:
        st = card_state(loc)
        if st and (not seen or seen[-1] != st):
            seen.append(st)
        if st == want:
            return True, seen
        time.sleep(0.15)
    return False, seen


def note_content(base, user, nid):
    return api(base, user, "GET", "/api/scratchpad/%d" % nid).get("content") or ""


def upload_from_editor(p, path):
    n = p.locator(EDIT_CARD).count()
    p.locator(".ProseMirror p").first.click()
    p.keyboard.press("Control+End")
    p.keyboard.press("Enter")
    p.locator("input[type=file][accept*='.mkv']").first.set_input_files(path)
    try:
        p.locator(EDIT_CARD).nth(n).wait_for(timeout=10000)
    except Exception:
        shot(p, "debug_upload_%d.png" % n)
        print("  toast:", p.locator(".toast").all_inner_texts(), "cards:", p.locator(EDIT_CARD).count(), flush=True)
        raise


def main():
    os.makedirs(SHOTS, exist_ok=True)
    for f in os.listdir(SHOTS):
        if f.endswith(".png"):
            os.remove(os.path.join(SHOTS, f))
    tmp = tempfile.mkdtemp(prefix="e2e_note_media_")
    files = make_media(tmp)
    proc, base = start_server(tmp, "srv1")
    proc2 = None
    try:
        A = register(base, "Pemilik")
        B = register(base, "Anggota")
        note1 = make_note(base, A, "Note Media E2E", "Catatan media\n")
        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            ctx, a = open_app(browser, base, A)
            check("0 SW mengontrol halaman (v427)", a.evaluate("() => window.__SW_VERSION") == "taskflow-v427-note-media"
                  and a.evaluate("() => !!navigator.serviceWorker.controller"))

            # ── 1. unggah mp4 + mp3 dari editor → progres → ready ──────────────────────────
            open_note(a, "Note Media E2E", edit=True)
            btn = a.locator("button.note-media-insert-btn")
            btn.wait_for(timeout=10000)
            upload_from_editor(a, files["mp4"])
            c1 = a.locator(EDIT_CARD).filter(has_text="video uji.mp4")
            c1.wait_for(timeout=10000)
            ok, seen = wait_state(c1, "ready")
            check("1a mp4 dari editor → ready", ok, seen)
            upload_from_editor(a, files["mp3"])
            c2 = a.locator(EDIT_CARD).filter(has_text="audio uji.mp3")
            c2.wait_for(timeout=10000)
            ok2, seen2 = wait_state(c2, "ready")
            check("1b mp3 dari editor → ready", ok2, seen2)
            check("1c progres/proses terlihat sebelum ready", any(s in ("uploading-local", "processing", "loading")
                                                                  for s in seen + seen2), seen + seen2)
            check("1d mp3 → <audio>, mp4 → <video>", c2.locator("audio").count() == 1 and c1.locator("video").count() == 1)
            shot(a, "01_editor_mp4_mp3_ready.png")
            cont = wait_until(lambda: (lambda c: c if c.count("::media") >= 2 else "")(note_content(base, A, note1["id"])), 20)
            check("1e dua direktif tersimpan di isi note", bool(cont), repr(cont)[:200])
            m = re.search(r"::media\\?\[([0-9a-zA-Z_-]+)\\?\]\{name=\"audio uji\.mp3\"", cont or "")
            mp3_cid = m.group(1) if m else None
            home(a)

            # ── 3. unggah 12 MB, putus di tengah, pulih → selesai tanpa ulang dari 0 ──────────
            offsets, aborted = [], {"n": 0, "until": 0.0, "patch": 0}

            def flaky(route, request):
                if request.method == "PATCH":
                    aborted["patch"] += 1
                    offsets.append(int(request.headers.get("upload-offset", "-1")))
                    if aborted["patch"] == 2 and aborted["until"] == 0.0:
                        aborted["until"] = time.time() + 2.5
                if time.time() < aborted["until"]:
                    aborted["n"] += 1
                    return route.abort()
                return route.continue_()

            ctx.route(re.compile(r".*/api/media/\d+/upload$"), flaky)
            note_big = make_note(base, A, "Note Besar E2E", "Video besar\n")
            open_note(a, "Note Besar E2E", edit=True)
            upload_from_editor(a, files["big"])
            cb = a.locator(EDIT_CARD).first
            cb.wait_for(timeout=10000)
            ok3, seen3 = wait_state(cb, "ready", 120)
            ctx.unroute(re.compile(r".*/api/media/\d+/upload$"))
            check("3a unggah 12 MB selesai (ready) setelah jaringan putus", ok3, seen3)
            check("3b ada request yang digagalkan", aborted["n"] >= 1, aborted)
            first_nz = next((i for i, o in enumerate(offsets) if o > 0), None)
            check("3c tidak mengulang dari 0 setelah putus",
                  first_nz is not None and all(o > 0 for o in offsets[first_nz:]) and offsets.count(0) == 1, offsets)
            big_meta = None
            bc = re.findall(r"::media\\?\[([0-9a-zA-Z_-]+)", wait_until(lambda: note_content(base, A, note_big["id"]), 10) or "")
            if bc:
                big_meta = api(base, A, "GET", "/api/scratchpad/%d/media/by-client/%s" % (note_big["id"], bc[0]))
            check("3d ukuran file di server = ukuran asli", big_meta and big_meta["file_size"] == os.path.getsize(files["big"]),
                  big_meta and big_meta.get("file_size"))
            home(a)

            # ── 2. putar di mode baca; seek → Range → 206 dari jaringan (bukan SW) ───────────
            media_resp = []
            sw_media_req = []
            a.on("response", lambda r: media_resp.append(r) if "/media/" in r.url and "/api/" not in r.url else None)
            ctx.on("request", lambda r: sw_media_req.append(r.url)
                   if ("/media/" in r.url and "/api/" not in r.url and from_sw(r)) else None)
            a.reload()
            a.locator(".sidebar-link").first.wait_for(state="attached", timeout=30000)
            open_note(a, "Note Besar E2E")
            rc = a.locator(READ_CARD).first
            ok, seen = wait_state(rc, "ready", 30)
            check("2a mode baca: kartu ready", ok, seen)
            vq = "document.querySelector('[data-media-card]:not(.editor-media-card) video')"
            a.wait_for_function("() => %s && %s.readyState >= 1" % (vq, vq), timeout=15000)  # preload=metadata
            n_before = len(media_resp)
            a.evaluate("() => { %s.currentTime = 8.5; }" % vq)
            wait_until(lambda: len(media_resp) > n_before and a.evaluate("() => %s.readyState" % vq) >= 2, 15)
            after = media_resp[n_before:]
            ranged = [r for r in after if r.request.headers.get("range")]
            check("2c seek → request /media/ baru ber-Range", len(ranged) >= 1,
                  [(r.status, r.request.headers.get("range")) for r in after])
            check("2d respons seek 206", ranged and all(r.status == 206 for r in ranged),
                  [(r.status, r.request.headers.get("range")) for r in ranged])
            played = a.evaluate("() => %s.play().then(() => true, (e) => String(e))" % vq)
            a.wait_for_timeout(800)
            check("2b video WebM diputar di mode baca (dari posisi seek)", played is True and a.evaluate(
                "() => %s.currentTime >= 8.5 && !%s.paused" % (vq, vq)), played)
            a.evaluate("() => %s.pause()" % vq)
            check("2e semua respons /media/ BUKAN dari SW", media_resp and not any(r.from_service_worker for r in media_resp),
                  [(r.status, r.from_service_worker) for r in media_resp])
            check("2f SW tidak membuat request /media/ sendiri", not sw_media_req, sw_media_req[:3])
            cached = a.evaluate("""async () => { const out = [];
                for (const k of await caches.keys()) { const c = await caches.open(k);
                  for (const r of await c.keys()) { const u = new URL(r.url).pathname;
                    if (u.startsWith('/media/') || u.startsWith('/api/media/') || /\\/api\\/scratchpad\\/[^/]+\\/media/.test(u)) out.push(u); } }
                return out; }""")
            check("2g Cache Storage tanpa /media/ maupun meta media", cached == [], cached)
            shot(a, "02_baca_seek_206.png")

            # ── 4. reload saat unggah → stalled → file berbeda ditolak → file sama lanjut ─────
            offs4 = []

            def stall(route, request):
                if request.method == "PATCH":
                    o = int(request.headers.get("upload-offset", "-1"))
                    offs4.append(o)
                    if o > 0:
                        return route.abort()
                return route.continue_()

            ctx.route(re.compile(r".*/api/media/\d+/upload$"), stall)
            note4 = make_note(base, A, "Note Terhenti E2E", "Unggah terhenti\n")
            open_note(a, "Note Terhenti E2E", edit=True)
            upload_from_editor(a, files["big"])
            c4 = a.locator(EDIT_CARD).first
            c4.wait_for(timeout=10000)
            wait_until(lambda: any(o > 0 for o in offs4), 30)
            check("4a potongan pertama terkirim lalu jaringan putus", 0 in offs4 and any(o > 0 for o in offs4), offs4)
            check("4b kartu editor masih 'Mengunggah…'", card_state(c4) == "uploading-local", card_state(c4))
            saved = wait_until(lambda: "::media" in note_content(base, A, note4["id"]), 20)
            check("4c direktif tersimpan sebelum reload", bool(saved))
            a.reload()
            a.locator(".sidebar-link").first.wait_for(state="attached", timeout=30000)
            ctx.unroute(re.compile(r".*/api/media/\d+/upload$"))
            open_note(a, "Note Terhenti E2E")
            c4r = a.locator(READ_CARD).first
            ok, seen = wait_state(c4r, "uploading-stalled", 20)
            check("4d setelah reload: kartu uploading-stalled + teks", ok and STALLED in c4r.inner_text(), seen)
            shot(a, "04a_stalled.png")
            with a.expect_file_chooser() as fc:
                c4r.locator("[data-media-action=resume]").click()
            fc.value.set_files(files["webm"])
            got = wait_until(lambda: MISMATCH in c4r.inner_text(), 10)
            check("4e file berbeda ditolak dengan pesan", bool(got), c4r.inner_text())
            check("4f server tetap 'uploading' (tidak tercampur)",
                  api(base, A, "GET", "/api/scratchpad/%d/media/by-client/%s" % (
                      note4["id"], re.findall(r"::media\\?\[([0-9a-zA-Z_-]+)", note_content(base, A, note4["id"]))[0]))["status"] == "uploading")
            shot(a, "04b_file_berbeda.png")
            offs4.clear()
            patch_offs = []
            ctx.route(re.compile(r".*/api/media/\d+/upload$"),
                      lambda route, req: (patch_offs.append(int(req.headers.get("upload-offset", "-1")))
                                          if req.method == "PATCH" else None) or route.continue_())
            with a.expect_file_chooser() as fc:
                c4r.locator("[data-media-action=resume]").click()
            fc.value.set_files(files["big"])
            ok, seen = wait_state(c4r, "ready", 90)
            ctx.unroute(re.compile(r".*/api/media/\d+/upload$"))
            check("4g file sama → lanjut sampai ready", ok, seen)
            check("4h lanjut dari offset terakhir (bukan 0)", patch_offs and patch_offs[0] == CHUNK, patch_offs)
            shot(a, "04c_lanjut_ready.png")

            # ── 7. direktif berbahaya + cid note lain → escape / missing ─────────────────────
            evil_name = "<img src=x onerror=window.__xss=1>"
            make_note(base, A, "Note Jahat E2E", "Uji\n\n" + directive("evilcid01", evil_name) + "\n\n" +
                      directive(mp3_cid or "nocid", "punya note lain") + "\n")
            open_note(a, "Note Jahat E2E")
            cards7 = a.locator(READ_CARD)
            ok_a, s_a = wait_state(cards7.nth(0), "missing", 20)
            ok_b, s_b = wait_state(cards7.nth(1), "missing", 20)
            check("7a cid tak dikenal → missing + pesan seragam", ok_a and MISSING in cards7.nth(0).inner_text(), s_a)
            check("7b cid milik note lain → missing + pesan seragam", ok_b and MISSING in cards7.nth(1).inner_text()
                  and mp3_cid is not None, s_b)
            check("7c nama berbahaya tampil sebagai teks", evil_name in cards7.nth(0).inner_text(), cards7.nth(0).inner_text())
            check("7d tanpa <img> di kartu & tanpa eksekusi", cards7.nth(0).locator("img").count() == 0
                  and a.evaluate("() => window.__xss") is None)
            shot(a, "07_direktif_berbahaya.png")

            # ── 6. offline: kartu & tombol; SW tidak menyajikan meta dari cache ───────────────
            open_note(a, "Note Media E2E", edit=True)
            btn = a.locator("button.note-media-insert-btn")
            btn.wait_for(timeout=10000)
            ctx.set_offline(True)
            a.wait_for_timeout(500)
            check("6a offline: 🎬 nonaktif + tooltip persis", btn.is_disabled() and btn.get_attribute("title") == OFFLINE_BTN,
                  btn.get_attribute("title"))
            shot(a, "06a_tombol_offline.png")
            home(a)  # offline: shell dari cache SW
            open_note(a, "Note Media E2E")
            c6 = a.locator(READ_CARD).first
            ok, seen = wait_state(c6, "offline", 15)
            check("6b offline: kartu 'Butuh koneksi untuk memutar'", ok and OFFLINE_CARD in c6.inner_text(), seen)
            shot(a, "06b_kartu_offline.png")
            ctx.set_offline(False)
            # jaringan SW gagal (route abort) sementara navigator online → meta TIDAK dari cache SW
            a.reload()
            a.locator(".sidebar-link").first.wait_for(state="attached", timeout=30000)
            ctx.route(re.compile(r".*/api/scratchpad/\d+/media/by-client/.*"), lambda route, req: route.abort())
            open_note(a, "Note Media E2E")
            c6b = a.locator(READ_CARD).first
            ok, seen = wait_state(c6b, "offline", 15)
            check("6c jaringan SW putus → kartu offline (bukan meta basi dari cache)", ok, seen)
            ctx.unroute(re.compile(r".*/api/scratchpad/\d+/media/by-client/.*"))
            c6b.locator("[data-media-action=retry]").click()
            ok, seen = wait_state(c6b, "ready", 15)
            check("6d 'Coba lagi' setelah pulih → ready", ok, seen)
            check("A: tanpa pageerror", not a.errors, a.errors[:3])
            ctx.close()

            # ── 5. anggota workspace memutar media note bersama, tanpa Hapus ─────────────────
            w = api(base, A, "POST", "/api/lists", json={"name": "WS Media"})
            api(base, A, "POST", "/api/lists/%d/invite" % w["id"], json={"username": B["username"]})
            wn = make_note(base, A, "Note Bersama E2E", "Bersama\n", list_id=w["id"])
            cid5, _att5 = api_upload(base, A, wn["id"], files["webm"], "video/webm")
            api(base, A, "PUT", "/api/scratchpad/%d" % wn["id"],
                json={"title": "Note Bersama E2E", "content": "Bersama\n\n" + directive(cid5, "klip kecil.webm") + "\n",
                      "tags": [], "list_id": w["id"]})
            ctxb, b = open_app(browser, base, B)
            open_note(b, "Note Bersama E2E")
            c5 = b.locator(READ_CARD).first
            ok, seen = wait_state(c5, "ready", 30)
            check("5a anggota: kartu ready", ok, seen)
            played = b.evaluate("""() => { const v = document.querySelector('[data-media-card]:not(.editor-media-card) video');
                return v.play().then(() => true, (e) => String(e)); }""")
            b.wait_for_timeout(700)
            check("5b anggota bisa memutar", played is True and b.evaluate(
                "() => document.querySelector('[data-media-card]:not(.editor-media-card) video').currentTime > 0"), played)
            check("5c tanpa tombol Hapus untuk media pemilik", c5.locator("[data-media-action=delete]").count() == 0)
            check("5d tautan Unduh ada", c5.locator("a[data-media-download]").count() == 1)
            shot(b, "05_anggota_putar.png")
            check("B: tanpa pageerror", not b.errors, b.errors[:3])
            ctxb.close()
            browser.close()

        # ── 8. token kedaluwarsa: server kedua dengan MEDIA_URL_TTL_SEC=5 ───────────────────
        proc2, base2 = start_server(tmp, "srv2", {"MEDIA_URL_TTL_SEC": "5"})
        C = register(base2, "Penonton")
        n8 = make_note(base2, C, "Note Token E2E", "Token\n")
        cid8, _ = api_upload(base2, C, n8["id"], files["big"], "video/webm")
        api(base2, C, "PUT", "/api/scratchpad/%d" % n8["id"],
            json={"title": "Note Token E2E", "content": "Token\n\n" + directive(cid8, "besar.webm") + "\n", "tags": []})
        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            ctx, c = open_app(browser, base2, C)
            meta_reqs = []
            ctx.on("request", lambda r: meta_reqs.append(r.url) if "/media/by-client/" in r.url and not from_sw(r) else None)
            open_note(c, "Note Token E2E")
            c8 = c.locator(READ_CARD).first
            ok, seen = wait_state(c8, "ready", 30)
            check("8a kartu ready (TTL 5 dtk)", ok, seen)
            vsel = "document.querySelector('[data-media-card]:not(.editor-media-card) video')"
            # Jaringan lokal terlalu cepat (seluruh 12 MB langsung ter-buffer → tak ada request baru setelah token
            # kedaluwarsa). Batasi unduhan halaman ±400 KB/dtk agar posisi tujuan seek belum ter-buffer.
            cdp = ctx.new_cdp_session(c)
            cdp.send("Network.enable")
            cdp.send("Network.emulateNetworkConditions", {"offline": False, "latency": 0,
                                                          "downloadThroughput": 400 * 1024, "uploadThroughput": -1})
            c.evaluate("() => %s.play().catch(() => {})" % vsel)
            wait_until(lambda: c.evaluate("() => %s.currentTime" % vsel) > 1.0, 15)
            c.evaluate("() => %s.pause()" % vsel)
            src1 = c.evaluate("() => %s.src" % vsel)
            n_meta = len(meta_reqs)
            c.wait_for_timeout(8000)  # token kedaluwarsa
            buf_end = c.evaluate("() => { const b = %s.buffered; return b.length ? b.end(b.length - 1) : 0; }" % vsel)
            check("8x posisi tujuan (9 dtk) belum ter-buffer", buf_end < 8.5, buf_end)
            c.evaluate("() => { const v = %s; v.currentTime = 9; v.play().catch(() => {}); }" % vsel)
            okp = wait_until(lambda: (lambda s: s["src"] != src1 and s["t"] >= 9)(
                c.evaluate("() => { const v = %s; return {src: v.src, paused: v.paused, t: v.currentTime}; }" % vsel)), 25)
            state = c.evaluate("() => { const v = %s; return {src: v.src.slice(-30), paused: v.paused, ended: v.ended, t: v.currentTime, err: v.error && v.error.code}; }" % vsel)
            check("8b URL diganti setelah kedaluwarsa (meta diminta ulang)", len(meta_reqs) > n_meta and state["src"] != src1[-30:],
                  (len(meta_reqs), n_meta, state))
            check("8c posisi dipulihkan (>= 9 dtk) & status putar dipulihkan", bool(okp) and (not state["paused"] or state["ended"]), state)
            cdp.send("Network.emulateNetworkConditions", {"offline": False, "latency": 0,
                                                          "downloadThroughput": -1, "uploadThroughput": -1})
            adv = wait_until(lambda: c.evaluate("() => %s.currentTime" % vsel) > 9.3, 15)
            check("8d pemutaran berlanjut dari posisi yang dipulihkan", bool(adv), c.evaluate("() => %s.currentTime" % vsel))
            shot(c, "08_token_kedaluwarsa_dipulihkan.png")
            check("C: tanpa pageerror", not c.errors, c.errors[:3])
            browser.close()
    finally:
        proc.kill()
        if proc2:
            proc2.kill()
    fails = [r for r in results if not r[1]]
    print("RESULT %d/%d lulus" % (len(results) - len(fails), len(results)), flush=True)
    for s, _, n in fails:
        print("  GAGAL:", s, n, flush=True)
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
