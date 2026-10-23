"""E2E: istilah "Sketsa" + tombol/menu "Media" dan "File" di editor note (2026-10-23). Tidak dijalankan CI.

Toolbar note = [Sketsa] [Media] [📎 File]; menu blok (slash "/" dan "+") grup Sisipkan = Tabel, Divider, Sketsa,
Task, Media, File. Unggah lampiran ke Nextcloud tidak tersedia lokal (500), jadi POST /api/scratchpad/*/attachments
dan GET /api/scratchpad/attachments/*/view dicegat dengan route Playwright (JSON {id, original_name, mime_type,
file_size} / PNG kecil).

Langkah:
  1  NoteModal (note tersimpan, online): toolbar memuat tombol "Sketsa" < "Media" < "File"; tanpa tombol
     "Gambar" / "Audio/Video" / 🎬; Media dan File aktif
  2  ketik "/": grup Sisipkan berurutan Tabel, Divider, Sketsa, Task, Media, File (grup lain tak berubah); menu
     17 item tanpa scroll (1280×800)
  3  "+" block handle (desktop) membuka menu yang sama; klik Media dari menu "+" membuka file chooser
  4  klik item Media (slash) → file chooser, accept memuat .png dan .mp4; pilih PNG kecil → toast "Mengunggah
     gambar…", POST lampiran, <img src="/api/scratchpad/attachments/<id>/view"> di editor, tanpa "/" tersisa,
     daftar Lampiran bertambah
  5  keyboard: Shift+Tab dari tombol File ke tombol Media, Enter → file chooser terbuka (slash menu memang tanpa
     navigasi panah/Enter)
  6  klik item File → file chooser, accept memuat .pdf dan TIDAK .png; tombol toolbar File juga membuka chooser
     (klik dan Enter keyboard)
  7  offline (route lampiran di-abort, seperti jaringan putus): Media + PNG > 1 MB → toast batas 1 MB, tanpa <img src="data:" baru; PNG kecil → data URL tersisip;
     .mp3 → toast "Butuh koneksi internet untuk mengunggah audio/video"; tanpa percobaan unggah dan tanpa toast
     "Mengunggah gambar…"
  8  TaskFormModal (mode Note): slash menu memuat Media tetapi TIDAK File; accept Media hanya ekstensi gambar;
     title item Media "Media — gambar"
  9  halaman Sketsa: label sidebar dan judul halaman "Sketsa"; modal sisip dari note "🎨 Sisipkan Sketsa";
     ketik "/gambar" tidak membuka Sketsa, "/sketsa" membukanya
  6r server menolak unggahan (413 + detail / 502 tanpa JSON) → toast galat (detail / "Unggah gambar gagal"),
     tidak ada gambar tersisip, tanpa data URL
  8q quick-note TaskFormModal: isi kosong + PNG > 1 MB via Media (online) → note server dibuat + diunggah; "Simpan
     Note" → TEPAT satu note (server dan daftar lokal), isi memuat lampiran
  8t quick-note: task inline baru (cid lokal) via "/" Task lalu Media PNG → note server dibuat (bukan 422), simpan →
     satu note; linked_task_ids server = id server task, isi memuat [tasklink:<id server>]
  8x quick-note: isi kosong + Media PNG (note server dibuat demi lampiran) lalu "Batal" → note server dihapus (Sampah),
     daftar Notes tanpa note baru setelah sinkron
  11 NoteModal pada note yang baru tersimpan lokal (cid, dibuat offline) lalu online: Media PNG → id server via
     push outbox, diunggah ke /api/scratchpad/<id server>/attachments (bukan data URL)
  10 screenshot toolbar + slash menu terbuka: terang & gelap × desktop 1280 & HP 375 → temporary_files/e2e_istilah_sketsa_media/
     (HP: menu menutupi toolbar, jadi ditambah bidikan *-toolbar.png dengan menu ditutup)

    E2E_SERVER_PY=<python berisi fastapi/sse_starlette> python3 temporary_files/e2e_istilah_sketsa_media.py
  (Playwright dari python sistem; server memakai venv/bin/python bila ada, atau E2E_SERVER_PY. Keluar non-zero
  bila ada langkah gagal; screenshot di-.gitignore.)
"""
import json
import os
import re
import struct
import sys
import tempfile
import zlib

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import e2e_slash_menu_grid as G  # noqa: E402  (start_server, register, make_note, go_notes, card, open_editor, ...)
from playwright.sync_api import sync_playwright  # noqa: E402

ROOT = G.ROOT
SHOTS = os.path.join(ROOT, "temporary_files", "e2e_istilah_sketsa_media")
MENU = G.MENU
SISIPKAN = ["Tabel", "Divider", "Sketsa", "Task", "Media", "File"]
GROUPS = ["Teks", "Daftar", "Sisipkan", "Tautan"]
TOAST_UPLOAD = "Mengunggah gambar…"
TOAST_1MB = "Gambar lebih dari 1 MB butuh koneksi internet dan catatan yang sudah tersimpan"
TOAST_AV_OFFLINE = "Butuh koneksi internet untuk mengunggah audio/video"
REJECT_DETAIL = "File terlalu besar (maks 10 MB)"
TOAST_UPLOAD_FAIL = "Unggah gambar gagal"
ATT_ID0 = 9001
results = []

# Catat setiap teks toast (satu toast aktif sekaligus, hilang 3 dtk) agar asersi tidak balapan dengan timer-nya.
TOAST_LOG_JS = """(() => {
  window.__toastLog = [];
  let last = '';
  const scan = () => {
    const t = document.querySelector('.toast');
    const txt = t ? t.textContent : '';
    if (txt && txt !== last) window.__toastLog.push(txt);
    last = txt;
  };
  new MutationObserver(scan).observe(document, { childList: true, subtree: true, characterData: true });
})();"""


def check(step, ok, note=""):
    results.append((step, bool(ok)))
    print(("PASS " if ok else "FAIL ") + step + (" — " + str(note) if note else ""), flush=True)


def run_step(name, fn, *args):
    """Satu langkah = satu fungsi; galat tak terduga dicatat sebagai FAIL (langkah lain tetap jalan)."""
    try:
        fn(*args)
    except Exception as e:  # noqa: BLE001
        check(name + " (galat tak terduga)", False, "%s: %s" % (type(e).__name__, str(e).splitlines()[0][:300]))


def png_bytes(w, h, noise=False):
    """PNG RGB valid. noise=True: piksel acak tanpa kompresi (ukuran ≈ w*h*3 byte)."""
    rows = []
    for y in range(h):
        px = os.urandom(w * 3) if noise else bytes([(y * 9) % 256, 110, 220]) * w
        rows.append(b"\x00" + px)

    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)) +
            chunk(b"IDAT", zlib.compress(b"".join(rows), 0 if noise else 6)) + chunk(b"IEND", b""))


SMALL_PNG = png_bytes(16, 16)
BIG_PNG = png_bytes(700, 600, noise=True)  # ≈ 1,26 MB > 1 MiB


def shot(page, name):
    path = os.path.join(SHOTS, name)
    page.wait_for_timeout(300)
    page.screenshot(path=path, full_page=False)
    print("  screenshot", os.path.relpath(path, ROOT), flush=True)


class Net:
    """Pencegat lampiran per konteks: POST unggah → JSON; GET view → PNG kecil. Mencatat request."""

    def __init__(self):
        self.posts = []
        self.views = []
        self.next_id = ATT_ID0
        self.offline = False  # route.fulfill menjawab walau context offline → saat offline batalkan seperti jaringan putus
        self.attempts = 0  # semua POST lampiran yang sampai ke route (termasuk yang dibatalkan/ditolak)
        self.reject = None  # (status, body str, content_type) → server menolak unggahan

    def on_post(self, route, request):
        if request.method != "POST":
            return route.continue_()
        self.attempts += 1
        if self.offline:
            return route.abort("internetdisconnected")
        if self.reject:
            st, rb, ct = self.reject
            return route.fulfill(status=st, content_type=ct, body=rb)
        body = request.post_data_buffer or b""
        m = re.search(rb'filename="([^"]+)"', body)
        name = m.group(1).decode("utf-8", "replace") if m else "gambar.png"
        att = {"id": self.next_id, "original_name": name, "mime_type": "image/png", "file_size": len(body)}
        self.next_id += 1
        self.posts.append((request.url, name, att["id"]))
        return route.fulfill(status=200, content_type="application/json", body=json.dumps(att))

    def on_view(self, route, request):
        if self.offline:
            return route.abort("internetdisconnected")
        self.views.append(request.url)
        return route.fulfill(status=200, content_type="image/png", body=SMALL_PNG)


def open_app(browser, base, user, viewport=(1280, 800)):
    """Seperti G.open_app + pencegat lampiran + log toast. SW diblok (tidak relevan di sini)."""
    ctx = browser.new_context(service_workers="block", viewport={"width": viewport[0], "height": viewport[1]})
    ctx.add_cookies([{"name": "token", "value": user["token"], "url": base, "httpOnly": True, "sameSite": "Lax"}])
    ctx.add_init_script(TOAST_LOG_JS)
    net = Net()
    ctx.route(re.compile(r".*/api/scratchpad/\d+/attachments$"), net.on_post)
    ctx.route(re.compile(r".*/api/scratchpad/attachments/\d+/view$"), net.on_view)
    p = ctx.new_page()
    p.errors = []
    p.net = net
    p.on("pageerror", lambda e: p.errors.append(str(e)))
    p.on("dialog", lambda d: d.accept())  # beforeunload / confirm
    p.goto(base + "/manifest.json")
    p.evaluate("""([t, u, tours]) => {
        localStorage.setItem('tf_token', t); localStorage.setItem('tf_user_id', String(u));
        for (const pg of tours) localStorage.setItem('tf_tour_' + pg, '1');
        localStorage.setItem('tf_dismiss_onboarding', '1');
    }""", [user["token"], user["id"], G.TOURS])
    p.goto(base + "/")
    p.locator(".sidebar-link").first.wait_for(state="attached", timeout=30000)
    return ctx, p


def wait_until(p, fn, timeout=10000, step=150):
    waited = 0
    last = None
    while waited <= timeout:
        try:
            last = fn()
        except Exception:  # noqa: BLE001
            last = None
        if last:
            return last
        p.wait_for_timeout(step)
        waited += step
    return last


def toasts(p):
    return p.evaluate("() => window.__toastLog || []")


def toast_seen(p, text, timeout=6000):
    return bool(wait_until(p, lambda: text in toasts(p), timeout))


def clear_toasts(p):
    p.evaluate("() => { window.__toastLog.length = 0; }")


def sisipkan_items(p):
    """Item grup 'Sisipkan' + label grup, menurut urutan DOM menu slash yang terbuka."""
    return p.evaluate("""() => {
      const m = document.querySelector(".milkdown-slash-menu[data-show='true']");
      const out = { labels: [], items: [] };
      let cur = null;
      for (const c of m.children) {
        if (c.classList.contains('milkdown-slash-group-label')) { cur = c.textContent.trim(); out.labels.push(cur); }
        else if (c.classList.contains('milkdown-slash-grid') && cur && cur.toLowerCase() === 'sisipkan')
          out.items = [...c.querySelectorAll('.milkdown-slash-item .milkdown-slash-label')].map(e => e.textContent);
      }
      return out;
    }""")


def close_menu_and_slash(p):
    """Tutup menu slash (Esc) lalu hapus '/' yang tersisa di baris."""
    if p.locator(MENU).count():
        p.keyboard.press("Escape")
        p.wait_for_timeout(250)
    p.keyboard.press("Backspace")
    p.wait_for_timeout(200)


def editor_has_slash(p):
    return p.evaluate("() => document.querySelector('.ProseMirror').innerText.includes('/')")


def toolbar_info(p):
    return p.evaluate("""() => {
      const tb = document.querySelector('.note-toolbar');
      const btns = [...tb.querySelectorAll('button')].map(b => ({ text: (b.innerText || '').trim(), title: b.title || '',
        disabled: b.disabled, cls: b.className || '', x: Math.round(b.getBoundingClientRect().left) }));
      const inputs = [...tb.querySelectorAll('input[type=file]')].map(i => i.accept);
      return { btns, inputs };
    }""")


def chooser_accept(fc):
    return fc.element.get_attribute("accept") or ""


def pick_via_chooser(p, click_fn, files=None):
    """Jalankan click_fn() yang memicu file chooser; pilih files bila ada, else kosongkan. → accept."""
    with p.expect_file_chooser(timeout=5000) as fc:
        click_fn()
    chooser = fc.value
    acc = chooser_accept(chooser)
    chooser.set_files(files if files is not None else [])
    return acc


def open_menu_at_end(p):
    G.new_line_and(p, "/")
    p.locator(MENU).wait_for(timeout=5000)
    p.wait_for_timeout(150)


# ── langkah 1–7: NoteModal ────────────────────────────────────────────────────────────────────
def step1(p):
    t = toolbar_info(p)
    texts = [b["text"] for b in t["btns"] if b["text"]]
    pos = {b["text"]: i for i, b in enumerate(t["btns"]) if b["text"]}
    check("1a toolbar memuat tombol Sketsa, Media, File", all(x in texts for x in ("Sketsa", "Media", "File")), texts)
    check("1b urutan toolbar Sketsa < Media < File",
          all(k in pos for k in ("Sketsa", "Media", "File")) and pos["Sketsa"] < pos["Media"] < pos["File"], pos)
    bad = [x for x in texts if x in ("Gambar", "Audio/Video") or "🎬" in x or x.lower().startswith("gambar")]
    check("1c tanpa tombol toolbar 'Gambar' / 'Audio/Video' / 🎬", not bad, bad or texts)
    media = next((b for b in t["btns"] if b["text"] == "Media"), {})
    fil = next((b for b in t["btns"] if b["text"] == "File"), {})
    check("1d Media aktif + kelas note-media-insert-btn + title", media.get("cls") == "note-media-insert-btn"
          and not media.get("disabled") and media.get("title") == "Sisipkan media: gambar, audio, atau video", media)
    check("1e File aktif (note tersimpan) + title", not fil.get("disabled") and
          fil.get("title") == "Lampirkan file (PDF, dokumen, spreadsheet)", fil)
    check("1f input toolbar: Media (gambar + audio/video) dan File (dokumen)", len(t["inputs"]) == 2
          and ".png" in t["inputs"][0] and ".mp4" in t["inputs"][0] and ".pdf" not in t["inputs"][0]
          and ".pdf" in t["inputs"][1] and ".png" not in t["inputs"][1], t["inputs"])
    sk = next((b for b in t["btns"] if b["text"] == "Sketsa"), {})
    check("1g tombol Sketsa: title 'sketsa' huruf kecil di tengah kalimat", sk.get("title") ==
          "Sisipkan sketsa yang ada atau buat sketsa baru", sk)


def step2(p):
    open_menu_at_end(p)
    s = sisipkan_items(p)
    check("2a label grup tetap Teks, Daftar, Sisipkan, Tautan", s["labels"] == GROUPS, s["labels"])
    check("2b grup Sisipkan berurutan Tabel, Divider, Sketsa, Task, Media, File", s["items"] == SISIPKAN, s["items"])
    titles = p.evaluate("""() => Object.fromEntries([...document.querySelectorAll(".milkdown-slash-menu[data-show='true'] .milkdown-slash-item")]
        .map(e => [e.querySelector('.milkdown-slash-label').textContent, e.title]))""")
    check("2c title item Media dan File deskriptif", titles.get("Media", "").startswith("Media") and
          titles.get("File", "").startswith("File"), (titles.get("Media"), titles.get("File")))
    no_gambar = p.evaluate("""() => ![...document.querySelectorAll(".milkdown-slash-menu[data-show='true'] .milkdown-slash-label")]
        .some(e => e.textContent.trim() === 'Gambar')""")
    check("2d tidak ada item menu 'Gambar'", no_gambar)
    check("2e title Media di NoteModal (audio/video diterima)", titles.get("Media") == "Media — gambar, audio, atau video",
          titles.get("Media"))
    m = G.menu_metrics(p)
    check("2f menu 17 item tanpa scroll 1280×800 (Wikilink tanpa digulir)", m["sh"] <= m["ch"] and len(m["items"]) == 17,
          (m["sh"], m["ch"], len(m["items"])))
    close_menu_and_slash(p)


def step3(p):
    p.locator(".ProseMirror > p").first.hover()
    p.wait_for_timeout(400)
    p.locator(".milkdown-block-handle-add").first.click()
    p.locator(MENU).wait_for(timeout=4000)
    p.wait_for_timeout(150)
    s = sisipkan_items(p)
    check("3a '+' membuka menu dengan grup Sisipkan yang sama (… Task, Media, File)", s["items"] == SISIPKAN, s["items"])
    acc = pick_via_chooser(p, lambda: G.click_item(p, "Media"))
    check("3b klik Media dari menu '+' → file chooser terbuka (accept memuat .png)", ".png" in acc, acc)
    p.wait_for_timeout(300)
    check("3c menu tertutup dan tanpa '/' tersisa", p.locator(MENU).count() == 0 and not editor_has_slash(p),
          p.evaluate("() => document.querySelector('.ProseMirror').innerText"))


def step4(p):
    n_before = len(p.net.posts)
    clear_toasts(p)
    open_menu_at_end(p)
    acc = pick_via_chooser(p, lambda: G.click_item(p, "Media"),
                           {"name": "foto-kecil.png", "mimeType": "image/png", "buffer": SMALL_PNG})
    check("4a item Media → file chooser; accept memuat .png dan .mp4", ".png" in acc and ".mp4" in acc, acc)
    check("4b toast 'Mengunggah gambar…' tampil", toast_seen(p, TOAST_UPLOAD), toasts(p))
    sel = ".ProseMirror img[src='/api/scratchpad/attachments/%d/view']" % ATT_ID0
    img = wait_until(p, lambda: p.locator(sel).count() == 1, 8000)
    check("4c node gambar tersisip, src /api/scratchpad/attachments/<id>/view", bool(img),
          p.evaluate("() => [...document.querySelectorAll('.ProseMirror img')].map(i => (i.getAttribute('src') || '').slice(0, 60))"))
    check("4d tepat satu POST lampiran dengan nama file pilihan",
          len(p.net.posts) == n_before + 1 and p.net.posts[-1][1] == "foto-kecil.png", p.net.posts)
    check("4e teks '/' tidak tertinggal di editor", not editor_has_slash(p),
          p.evaluate("() => document.querySelector('.ProseMirror').innerText"))
    att = wait_until(p, lambda: p.evaluate("""() => [...document.querySelectorAll('.note-attachments-panel')]
        .filter(x => x.offsetParent !== null).map(x => x.innerText.replace(/\\s+/g, ' ').trim())""") or None, 5000)
    check("4f daftar Lampiran bertambah: 'Lampiran (1)' memuat foto-kecil.png",
          bool(att) and any("Lampiran (1)" in a and "foto-kecil.png" in a for a in att), att)


def key_chooser(p, focus_fn, key, attempts=3):
    """Tekan `key` pada tombol yang difokuskan lewat focus_fn() dan tunggu file chooser. Playwright+Chromium kadang
    membuang event filechooser pada aktivasi keyboard (terukur pada halaman kontrol tanpa kode app: ~1 dari 45), jadi
    timeout diulang maks `attempts` kali; yang dinilai tetap: handler tombol memanggil input.click(). → (accept, percobaan)"""
    for n in range(1, attempts + 1):
        focus_fn()
        try:
            with p.expect_file_chooser(timeout=2500) as fc:
                p.keyboard.press(key)
        except Exception:  # noqa: BLE001
            p.wait_for_timeout(500)
            continue
        acc = chooser_accept(fc.value)
        fc.value.set_files([])
        return acc, n
    return None, attempts


def step5(p):
    p.wait_for_timeout(700)
    fil = p.locator(".note-toolbar button").filter(has_text=re.compile(r"^\s*File\s*$")).first
    fil.focus()
    p.keyboard.press("Shift+Tab")
    active = p.evaluate("() => { const a = document.activeElement; return a ? (a.innerText || '').trim() + '|' + a.className : null; }")
    check("5a Shift+Tab dari tombol File memindahkan fokus ke tombol Media", active == "Media|note-media-insert-btn", active)
    media = p.locator("button.note-media-insert-btn")
    acc, n = key_chooser(p, lambda: media.focus(), "Enter")
    check("5b Enter di tombol Media (keyboard) → file chooser terbuka, accept memuat .png dan .mp4",
          acc is not None and ".png" in acc and ".mp4" in acc, "percobaan %d, %s" % (n, acc))
    # Spasi juga mengaktifkan tombol (aktivasi keyboard e.detail === 0)
    acc2, n2 = key_chooser(p, lambda: media.focus(), "Space")
    check("5c Spasi di tombol Media → file chooser terbuka juga", acc2 is not None, "percobaan %d" % n2)


def step6(p):
    open_menu_at_end(p)
    acc = pick_via_chooser(p, lambda: G.click_item(p, "File"))
    check("6a item File → file chooser; accept memuat .pdf dan TIDAK .png", ".pdf" in acc and ".png" not in acc, acc)
    p.wait_for_timeout(300)
    check("6b menu tertutup dan tanpa '/' tersisa", p.locator(MENU).count() == 0 and not editor_has_slash(p),
          p.evaluate("() => document.querySelector('.ProseMirror').innerText"))
    fbtn = p.locator(".note-toolbar button").filter(has_text=re.compile(r"^\s*File\s*$")).first
    acc2 = pick_via_chooser(p, lambda: fbtn.click())
    check("6c tombol toolbar File → chooser, accept memuat .pdf dan .docx, tanpa gambar",
          ".pdf" in acc2 and ".docx" in acc2 and ".png" not in acc2 and ".jpg" not in acc2, acc2)
    p.wait_for_timeout(500)
    acc3, n3 = key_chooser(p, lambda: fbtn.focus(), "Enter")
    check("6d Enter di tombol File (keyboard) → file chooser terbuka, accept memuat .pdf",
          acc3 is not None and ".pdf" in acc3, "percobaan %d, %s" % (n3, acc3))


def step6r(p):
    """Server menolak unggahan gambar pilihan → toast galat (detail), tidak disisipkan, tanpa data URL."""
    media_btn = p.locator("button.note-media-insert-btn")
    n_img = p.locator(".ProseMirror img").count()
    n_posts = len(p.net.posts)
    p.net.reject = (413, json.dumps({"detail": REJECT_DETAIL}), "application/json")
    try:
        clear_toasts(p)
        pick_via_chooser(p, lambda: media_btn.click(), {"name": "ditolak.png", "mimeType": "image/png", "buffer": SMALL_PNG})
        check("6r-a server 413 → toast galat dengan detail server", toast_seen(p, REJECT_DETAIL), toasts(p))
        p.wait_for_timeout(700)
        check("6r-b 413: tidak ada gambar tersisip (juga bukan data URL)", p.locator(".ProseMirror img").count() == n_img,
              (n_img, p.locator(".ProseMirror img").count()))
        p.net.reject = (502, "<html>Bad Gateway</html>", "text/html")
        clear_toasts(p)
        pick_via_chooser(p, lambda: media_btn.click(), {"name": "ditolak2.png", "mimeType": "image/png", "buffer": SMALL_PNG})
        check("6r-c server 502 tanpa JSON → toast 'Unggah gambar gagal'", toast_seen(p, TOAST_UPLOAD_FAIL), toasts(p))
        p.wait_for_timeout(700)
        check("6r-d 502: tidak ada gambar tersisip", p.locator(".ProseMirror img").count() == n_img,
              (n_img, p.locator(".ProseMirror img").count()))
        check("6r-e tanpa lampiran baru tercatat", len(p.net.posts) == n_posts, p.net.posts)
    finally:
        p.net.reject = None


def step7(p, ctx):
    ctx.set_offline(True)
    p.net.offline = True
    p.wait_for_timeout(400)
    check("7a offline: navigator.onLine false", p.evaluate("() => navigator.onLine") is False)
    media_btn = p.locator("button.note-media-insert-btn")
    check("7b offline: tombol Media tetap aktif", not media_btn.is_disabled())
    n_data = p.locator(".ProseMirror img[src^='data:']").count()
    n_attempts = p.net.attempts
    clear_toasts(p)
    acc = pick_via_chooser(p, lambda: media_btn.click(),
                           {"name": "foto-besar.png", "mimeType": "image/png", "buffer": BIG_PNG})
    check("7c PNG > 1 MB (%.2f MB) → toast batas 1 MB" % (len(BIG_PNG) / 1048576.0), toast_seen(p, TOAST_1MB), toasts(p))
    p.wait_for_timeout(700)
    check("7d PNG besar: tidak ada <img src=\"data:\" baru", p.locator(".ProseMirror img[src^='data:']").count() == n_data,
          (n_data, p.locator(".ProseMirror img[src^='data:']").count()))
    check("7e PNG besar: tanpa POST lampiran yang berhasil (hanya foto-kecil.png dari langkah 4)", len(p.net.posts) == 1,
          p.net.posts)
    pick_via_chooser(p, lambda: media_btn.click(), {"name": "foto-mini.png", "mimeType": "image/png", "buffer": SMALL_PNG})
    ok = wait_until(p, lambda: p.locator(".ProseMirror img[src^='data:image/png']").count() == n_data + 1, 6000)
    check("7f PNG kecil offline → <img src=\"data:image/png…\"> tersisip", bool(ok),
          p.evaluate("() => [...document.querySelectorAll('.ProseMirror img')].map(i => (i.getAttribute('src') || '').slice(0, 30))"))
    pick_via_chooser(p, lambda: media_btn.click(), {"name": "rekaman.mp3", "mimeType": "audio/mpeg", "buffer": b"ID3\x03\x00\x00\x00\x00\x00\x00"})
    check("7g .mp3 offline → toast 'Butuh koneksi internet untuk mengunggah audio/video'", toast_seen(p, TOAST_AV_OFFLINE), toasts(p))
    p.wait_for_timeout(500)
    check("7h .mp3 offline: tidak ada kartu media di editor", p.locator(".ProseMirror .editor-media-card").count() == 0)
    check("7i offline: gambar pilihan tanpa percobaan unggah (langsung data URL)", p.net.attempts == n_attempts,
          (n_attempts, p.net.attempts))
    check("7j offline: tanpa toast 'Mengunggah gambar…'", TOAST_UPLOAD not in toasts(p), toasts(p))
    ctx.set_offline(False)
    p.net.offline = False
    p.wait_for_timeout(300)


# ── langkah 8: TaskFormModal ──────────────────────────────────────────────────────────────────
def step8(p):
    btn = p.get_by_role("button", name=re.compile("Buat Baru")).filter(visible=True).first
    btn.click()
    p.get_by_role("button", name=re.compile(r"^\s*Note\s*$")).first.click()
    p.locator(".ProseMirror").first.wait_for(timeout=15000)
    p.wait_for_function("() => window.MilkdownBundle && document.querySelector('.ProseMirror[contenteditable=true]')", timeout=15000)
    p.wait_for_timeout(2000)
    t = toolbar_info(p)
    texts = [b["text"] for b in t["btns"] if b["text"]]
    check("8a toolbar TaskFormModal: Sketsa, Media, File", all(x in texts for x in ("Sketsa", "Media", "File")), texts)
    check("8b accept Media toolbar hanya ekstensi gambar", t["inputs"] and t["inputs"][0] == ".png,.jpg,.jpeg,.webp", t["inputs"])
    fil = next((b for b in t["btns"] if b["text"] == "File"), {})
    check("8c File nonaktif (belum ada note tersimpan) + title 'Simpan note dulu'",
          fil.get("disabled") and fil.get("title") == "Simpan note dulu", fil)
    G.new_line_and(p, "/")
    p.locator(MENU).wait_for(timeout=5000)
    s = sisipkan_items(p)
    check("8d slash menu memuat Media tetapi TIDAK File", s["items"] == ["Tabel", "Divider", "Sketsa", "Task", "Media"], s["items"])
    acc = pick_via_chooser(p, lambda: G.click_item(p, "Media"))
    check("8e item Media → chooser dengan accept hanya gambar", acc == ".png,.jpg,.jpeg,.webp", acc)
    p.wait_for_timeout(300)
    check("8f '/' hilang setelah Media", not editor_has_slash(p), p.evaluate("() => document.querySelector('.ProseMirror').innerText"))
    G.new_line_and(p, "/")
    p.locator(MENU).wait_for(timeout=5000)
    mt = p.evaluate("""() => { const it = [...document.querySelectorAll(".milkdown-slash-menu[data-show='true'] .milkdown-slash-item")]
        .find(e => e.querySelector('.milkdown-slash-label').textContent === 'Media'); return it ? it.title : null; }""")
    check("8g title item Media di TaskFormModal = 'Media — gambar' (hanya gambar)", mt == "Media — gambar", mt)
    close_menu_and_slash(p)
    media = next((b for b in t["btns"] if b["text"] == "Media"), {})
    check("8h title tombol Media toolbar = 'Sisipkan gambar'", media.get("title") == "Sisipkan gambar", media)


def server_notes(base, user, title):
    r = G.requests.get(base + "/api/scratchpad", headers={"Authorization": "Bearer " + user["token"]})
    r.raise_for_status()
    j = r.json()
    rows = j if isinstance(j, list) else (j.get("items") or j.get("notes") or [])
    return [n for n in rows if n.get("title") == title]


def local_cards(p, title):
    return p.locator(".note-card").filter(has=p.locator(".note-card-title", has_text=re.compile("^" + re.escape(title) + "$"))).count()


def step8q(p, base, user):
    """Quick-note TaskFormModal: isi kosong + PNG > 1 MB via Media (online) → satu note, berisi lampiran."""
    title = "Quick Gambar E2E"
    ti = p.locator("input[placeholder='Judul catatan...']").filter(visible=True).first
    ti.fill(title)
    p.wait_for_timeout(300)
    n_posts = len(p.net.posts)
    clear_toasts(p)
    media_btn = p.locator("button.note-media-insert-btn").filter(visible=True).first
    pick_via_chooser(p, lambda: media_btn.click(), {"name": "quick-besar.png", "mimeType": "image/png", "buffer": BIG_PNG})
    up = wait_until(p, lambda: len(p.net.posts) == n_posts + 1, 10000)
    check("8q-a isi kosong + PNG > 1 MB online → note dibuat lalu diunggah (bukan toast batas 1 MB)",
          bool(up) and TOAST_1MB not in toasts(p), (p.net.posts[n_posts:], toasts(p)))
    att_id = p.net.posts[-1][2] if up else None
    sid_url = p.net.posts[-1][0] if up else ""
    sel = ".ProseMirror img[src='/api/scratchpad/attachments/%s/view']" % att_id
    check("8q-b gambar lampiran tersisip di editor quick-note", bool(wait_until(p, lambda: p.locator(sel).count() == 1, 6000)))
    # markdownUpdated Milkdown di-debounce (±200 ms) sebelum noteForm.content ikut berubah; simpan dalam jendela itu
    # kehilangan sisipan terakhir (perilaku lama, di luar perbaikan ini) → tunggu seperti pengguna sebelum "Simpan Note".
    p.wait_for_timeout(1000)
    pre = server_notes(base, user, title)
    check("8q-c sebelum simpan: satu note server (dibuat untuk id lampiran)", len(pre) == 1 and
          ("/api/scratchpad/%s/attachments" % (pre[0]["id"] if pre else "?")) in sid_url, ([n.get("id") for n in pre], sid_url))
    p.get_by_role("button", name=re.compile(r"^\s*Simpan Note\s*$")).first.click()
    gone = wait_until(p, lambda: p.locator("input[placeholder='Judul catatan...']").filter(visible=True).count() == 0, 8000)
    check("8q-d 'Simpan Note' menutup modal tanpa galat", bool(gone))
    p.wait_for_timeout(1500)
    post = server_notes(base, user, title)
    check("8q-e server: TEPAT satu note '%s' (tanpa duplikat)" % title, len(post) == 1, [n.get("id") for n in post])
    check("8q-f isi note server memuat gambar lampiran", bool(post) and
          ("/api/scratchpad/attachments/%s/view" % att_id) in (post[0].get("content") or ""), post and post[0].get("content"))
    G.go_notes(p)
    one = wait_until(p, lambda: local_cards(p, title) == 1, 20000)
    check("8q-g daftar lokal: note quick muncul tepat satu kali", bool(one), local_cards(p, title))
    p.evaluate("() => window.__syncNow && window.__syncNow()")
    p.wait_for_timeout(2500)
    check("8q-h setelah sinkron ulang: tetap satu kartu dan satu note server", local_cards(p, title) == 1
          and len(server_notes(base, user, title)) == 1, (local_cards(p, title), len(server_notes(base, user, title))))


def open_quick_note(p, title):
    p.get_by_role("button", name=re.compile("Buat Baru")).filter(visible=True).first.click()
    p.get_by_role("button", name=re.compile(r"^\s*Note\s*$")).first.click()
    p.wait_for_function("() => window.MilkdownBundle && document.querySelector('.ProseMirror[contenteditable=true]')", timeout=15000)
    p.wait_for_timeout(1500)
    p.locator("input[placeholder='Judul catatan...']").filter(visible=True).first.fill(title)
    p.wait_for_timeout(300)


def server_tasks(base, user, title):
    r = G.requests.get(base + "/api/tasks", headers={"Authorization": "Bearer " + user["token"]})
    r.raise_for_status()
    j = r.json()
    rows = j if isinstance(j, list) else (j.get("items") or j.get("tasks") or [])
    return [t for t in rows if t.get("title") == title]


def step8t(p, base, user):
    """Quick-note + task inline (cid lokal) + gambar → body mentah memakai id server task (bukan 422)."""
    title, ttl = "Quick Task E2E", "Tugas Inline E2E"
    open_quick_note(p, title)
    G.new_line_and(p, "/")
    p.locator(MENU).wait_for(timeout=5000)
    G.click_item(p, "Task")
    q = p.locator("input[placeholder='Cari task...']").filter(visible=True).first
    q.wait_for(timeout=5000)
    q.fill(ttl)
    q.press("Enter")
    linked = wait_until(p, lambda: p.locator(".ProseMirror .tasklink-node, .ProseMirror .tasklink-node-fallback").count() > 0, 8000)
    check("8t-a task inline baru tersisip sebagai tasklink di quick-note", bool(linked))
    p.wait_for_timeout(600)  # debounce markdownUpdated → noteForm.content memuat [tasklink:<cid>]
    n_posts = len(p.net.posts)
    clear_toasts(p)
    media_btn = p.locator("button.note-media-insert-btn").filter(visible=True).first
    pick_via_chooser(p, lambda: media_btn.click(), {"name": "quick-task.png", "mimeType": "image/png", "buffer": SMALL_PNG})
    up = wait_until(p, lambda: len(p.net.posts) == n_posts + 1, 12000)
    pre = server_notes(base, user, title)
    check("8t-b note server dibuat (bukan 422) dan gambar diunggah; tanpa toast galat",
          bool(up) and len(pre) == 1 and "Unggah gambar gagal" not in toasts(p), (len(pre), toasts(p)))
    p.wait_for_timeout(1000)
    p.get_by_role("button", name=re.compile(r"^\s*Simpan Note\s*$")).first.click()
    wait_until(p, lambda: p.locator("input[placeholder='Judul catatan...']").filter(visible=True).count() == 0, 8000)
    p.wait_for_timeout(1500)
    post = server_notes(base, user, title)
    tasks = server_tasks(base, user, ttl)
    tid = tasks[0]["id"] if tasks else None
    check("8t-c server: tepat satu note dan task inline sudah ber-id server", len(post) == 1 and tid is not None,
          ([n.get("id") for n in post], [t.get("id") for t in tasks]))
    note = post[0] if post else {}
    check("8t-d linked_task_ids note server = [id server task]", note.get("linked_task_ids") == [tid],
          (note.get("linked_task_ids"), tid))
    check("8t-e isi note server memuat [tasklink:<id server>] (bukan cid)", ("tasklink:%s" % tid) in (note.get("content") or "")
          and not re.search(r"tasklink:[0-9a-f]{8}-", note.get("content") or ""), note.get("content"))
    G.go_notes(p)
    check("8t-f daftar lokal: satu kartu quick-task", bool(wait_until(p, lambda: local_cards(p, title) == 1, 20000)), local_cards(p, title))


def step8x(p, base, user):
    """Quick-note: gambar membuat note server lalu modal dibatalkan → note itu dihapus, tanpa kartu kosong."""
    title = "Quick Batal E2E"
    open_quick_note(p, title)
    n_posts = len(p.net.posts)
    media_btn = p.locator("button.note-media-insert-btn").filter(visible=True).first
    pick_via_chooser(p, lambda: media_btn.click(), {"name": "batal.png", "mimeType": "image/png", "buffer": SMALL_PNG})
    up = wait_until(p, lambda: len(p.net.posts) == n_posts + 1, 10000)
    check("8x-a sebelum batal: note server dibuat demi lampiran", bool(up) and len(server_notes(base, user, title)) == 1,
          len(server_notes(base, user, title)))
    p.wait_for_timeout(500)
    p.get_by_role("button", name=re.compile(r"^\s*Batal\s*$")).filter(visible=True).first.click()
    gone = wait_until(p, lambda: len(server_notes(base, user, title)) == 0, 8000)
    check("8x-b 'Batal' → note server yatim dihapus", bool(gone), len(server_notes(base, user, title)))
    G.go_notes(p)
    p.locator(".note-card").first.wait_for(timeout=20000)
    p.evaluate("() => window.__syncNow && window.__syncNow()")
    p.wait_for_timeout(2500)
    check("8x-c daftar Notes tanpa note baru setelah sinkron", local_cards(p, title) == 0, local_cards(p, title))
    tr = G.requests.get(base + "/api/scratchpad/trash", headers={"Authorization": "Bearer " + user["token"]})
    check("8x-d note ada di Sampah (bisa dipulihkan)", tr.ok and any((x.get("title") == title) for x in (tr.json() or [])),
          tr.status_code)


def step11(p, ctx, base, user):
    """NoteModal: note baru tersimpan lokal (cid) saat offline, lalu online → gambar pilihan diunggah ke id server."""
    title = "Note Cid E2E"
    G.go_notes(p)
    p.locator(".note-card").first.wait_for(timeout=20000)
    ctx.set_offline(True)
    p.net.offline = True
    p.wait_for_timeout(400)
    p.get_by_role("button", name=re.compile("Catatan Baru")).filter(visible=True).first.click()
    ti = p.locator("input[placeholder='Judul catatan...']").filter(visible=True).first
    ti.wait_for(timeout=10000)
    ti.fill(title)
    p.locator(".ProseMirror").first.wait_for(timeout=15000)
    p.wait_for_function("() => window.MilkdownBundle && document.querySelector('.ProseMirror[contenteditable=true]')", timeout=15000)
    p.locator(".ProseMirror").first.click()
    p.keyboard.type("Isi note lokal", delay=20)
    p.wait_for_timeout(400)
    p.get_by_role("button", name=re.compile(r"^\s*Simpan\s*$")).filter(visible=True).first.click()
    G.card(p, title).wait_for(timeout=15000)
    check("11a note baru offline tersimpan lokal, belum ada di server", len(server_notes(base, user, title)) == 0)
    G.open_editor(p, title)
    ctx.set_offline(False)
    p.net.offline = False
    p.wait_for_timeout(500)
    n_posts = len(p.net.posts)
    clear_toasts(p)
    media_btn = p.locator("button.note-media-insert-btn").filter(visible=True).first
    pick_via_chooser(p, lambda: media_btn.click(), {"name": "cid-foto.png", "mimeType": "image/png", "buffer": SMALL_PNG})
    up = wait_until(p, lambda: len(p.net.posts) == n_posts + 1, 12000)
    srv = server_notes(base, user, title)
    check("11b online: note cid didorong ke server (id server ada)", len(srv) == 1, [n.get("id") for n in srv])
    check("11c gambar diunggah ke /api/scratchpad/<id server>/attachments + toast unggah",
          bool(up) and bool(srv) and ("/api/scratchpad/%s/attachments" % srv[0]["id"]) in p.net.posts[-1][0]
          and TOAST_UPLOAD in toasts(p), (p.net.posts[n_posts:], toasts(p)))
    att_id = p.net.posts[-1][2] if up else None
    sel = ".ProseMirror img[src='/api/scratchpad/attachments/%s/view']" % att_id
    check("11d gambar lampiran tersisip (bukan data URL) dan tanpa toast batas/galat",
          bool(wait_until(p, lambda: p.locator(sel).count() == 1, 6000)) and
          p.locator(".ProseMirror img[src^='data:']").count() == 0 and TOAST_1MB not in toasts(p), toasts(p))


# ── langkah 9: halaman Sketsa ─────────────────────────────────────────────────────────────────
def step9(p, base):
    p.goto(base + "/")
    p.locator(".sidebar-link").first.wait_for(state="attached", timeout=30000)
    labels = p.evaluate("() => [...document.querySelectorAll('.sidebar-link span')].map(e => e.textContent.trim()).filter(Boolean)")
    check("9a label sidebar 'Sketsa' ada; tanpa 'Gambar' / 'Draw'", "Sketsa" in labels and "Gambar" not in labels
          and "Draw" not in labels, labels)
    link = p.locator(".sidebar-link").filter(has=p.locator("span", has_text=re.compile("^Sketsa$"))).first
    if not link.is_visible():
        ex = p.locator("button[aria-label='Tampilkan semua menu']")
        if ex.count() and ex.first.is_visible():
            ex.first.click()
    link.click()
    hdr = wait_until(p, lambda: p.evaluate("""() => { const s = document.querySelector('.draw-sidebar'); if (!s) return null;
        const t = s.firstElementChild && s.firstElementChild.firstElementChild; return t ? t.textContent.trim() : null; }"""), 15000)
    check("9b judul halaman Sketsa = 'Sketsa'", hdr == "Sketsa", hdr)
    btns = p.evaluate("() => [...document.querySelectorAll('.draw-sidebar button')].map(b => (b.innerText||'').trim()).filter(Boolean)")
    check("9c tombol buat baru berlabel Sketsa", any("Sketsa Baru" in b for b in btns) and not any("Gambar" in b for b in btns), btns)
    # modal sisip dari note (toolbar lalu slash menu)
    G.go_notes(p)
    G.card(p, "Note Sketsa E2E").wait_for(timeout=20000)
    G.open_editor(p, "Note Sketsa E2E")
    p.locator(".note-toolbar button").filter(has_text=re.compile(r"^\s*Sketsa\s*$")).first.click()
    modal = p.get_by_text("🎨 Sisipkan Sketsa")
    modal.first.wait_for(timeout=8000)
    check("9d toolbar Sketsa → modal '🎨 Sisipkan Sketsa'", modal.count() > 0 and modal.first.is_visible())
    lbl = p.evaluate("() => [...document.querySelectorAll('.modal-content label, .modal-content button')].map(e => (e.innerText||'').trim()).filter(Boolean)")
    check("9e modal memakai istilah Sketsa (Judul Sketsa, + Sketsa Baru), tanpa 'Gambar'",
          any("Judul Sketsa" in x for x in lbl) and any("Sketsa Baru" in x for x in lbl) and not any("Gambar" in x for x in lbl), lbl)
    p.locator(".modal-content").filter(has_text="Sisipkan Sketsa").locator("button", has_text="✕").first.click()
    p.wait_for_timeout(300)
    open_menu_at_end(p)
    G.click_item(p, "Sketsa")
    p.get_by_text("🎨 Sisipkan Sketsa").first.wait_for(timeout=8000)
    check("9f item menu blok Sketsa → modal '🎨 Sisipkan Sketsa'; '/' hilang", not editor_has_slash(p),
          p.evaluate("() => document.querySelector('.ProseMirror').innerText"))
    p.locator(".modal-content").filter(has_text="Sisipkan Sketsa").locator("button", has_text="✕").first.click()
    p.wait_for_timeout(300)
    # alias ketik: "/gambar" tidak lagi membuka Sketsa; "/sketsa" membukanya (teks perintah terhapus)
    G.new_line_and(p, "/gambar")
    p.wait_for_timeout(1200)
    check("9g ketik '/gambar' tidak membuka modal Sketsa (teks tetap)", p.get_by_text("🎨 Sisipkan Sketsa").count() == 0
          and "/gambar" in p.evaluate("() => document.querySelector('.ProseMirror').innerText"))
    if p.locator(MENU).count():
        p.keyboard.press("Escape")
    for _ in range(len("/gambar")):
        p.keyboard.press("Backspace")
    p.keyboard.type("/sketsa", delay=40)
    shown = wait_until(p, lambda: p.get_by_text("🎨 Sisipkan Sketsa").count() > 0, 8000)
    check("9h ketik '/sketsa' membuka modal '🎨 Sisipkan Sketsa'; teks perintah terhapus", bool(shown)
          and "/sketsa" not in p.evaluate("() => document.querySelector('.ProseMirror').innerText"),
          p.evaluate("() => document.querySelector('.ProseMirror').innerText"))
    if shown:
        p.locator(".modal-content").filter(has_text="Sisipkan Sketsa").locator("button", has_text="✕").first.click()
        p.wait_for_timeout(300)


# ── langkah 10: screenshot ────────────────────────────────────────────────────────────────────
def scroll_toolbar_to_file(p):
    p.evaluate("""() => { const tb = document.querySelector('.note-toolbar'); const f = [...tb.querySelectorAll('button')]
        .find(b => (b.innerText || '').trim() === 'File'); if (f) f.scrollIntoView({ inline: 'center', block: 'nearest' }); }""")


def step10(p):
    shots = []
    for tag, vw, vh in (("desktop-1280", 1280, 800), ("hp-375", 375, 740)):
        p.set_viewport_size({"width": vw, "height": vh})
        p.wait_for_timeout(600)
        open_menu_at_end(p)
        if vw < 500:
            scroll_toolbar_to_file(p)  # toolbar HP bisa di-scroll horizontal; tampilkan Sketsa…File di layar
        s = sisipkan_items(p)
        m = G.menu_metrics(p)
        check("10-%s menu tanpa scroll dan utuh di viewport (Wikilink terlihat)" % tag, m["sh"] <= m["ch"] and m["top"] >= 0
              and m["bottom"] <= m["vh"] and m["left"] >= 0 and m["right"] <= m["vw"],
              (m["sh"], m["ch"], m["top"], m["bottom"], m["vh"]))
        for theme in ("light", "dark"):
            p.evaluate("(t) => document.documentElement.setAttribute('data-theme', t)", theme)
            p.wait_for_timeout(250)
            name = "%s-%s.png" % (tag, theme)
            shot(p, name)
            shots.append(name)
        p.evaluate("() => document.documentElement.setAttribute('data-theme', 'light')")
        if vw < 500:
            # di HP menu slash menutupi toolbar → tambah bidikan toolbar saja (menu ditutup), ikon-saja diharapkan
            close_menu_and_slash(p)
            p.evaluate("() => document.querySelector('.note-toolbar').scrollIntoView({ block: 'center' })")
            for theme in ("light", "dark"):
                p.evaluate("(t) => document.documentElement.setAttribute('data-theme', t)", theme)
                p.wait_for_timeout(250)
                name = "%s-%s-toolbar.png" % (tag, theme)
                shot(p, name)
                shots.append(name)
            p.evaluate("() => document.documentElement.setAttribute('data-theme', 'light')")
            open_menu_at_end(p)
        check("10-%s menu terbuka saat screenshot (grup Sisipkan lengkap)" % tag, s["items"] == SISIPKAN, s["items"])
        close_menu_and_slash(p)
    check("10z 6 screenshot tersimpan (terang/gelap × desktop/HP + toolbar HP)", all(os.path.getsize(os.path.join(SHOTS, n)) > 5000 for n in shots), shots)


def main():
    os.makedirs(SHOTS, exist_ok=True)
    for f in os.listdir(SHOTS):
        if f.endswith(".png"):
            os.remove(os.path.join(SHOTS, f))
    print("PNG kecil %d B, PNG besar %d B (> 1 MiB: %s)" % (len(SMALL_PNG), len(BIG_PNG), len(BIG_PNG) > 1048576), flush=True)
    tmp = tempfile.mkdtemp(prefix="e2e_istilah_sketsa_media_")
    proc, base = G.start_server(tmp)
    try:
        A = G.register(base, "Penulis")
        G.make_note(base, A, "Note Sketsa E2E", "Isi awal catatan")
        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            # 1–7: NoteModal pada note tersimpan
            ctx, p = open_app(browser, base, A)
            G.go_notes(p)
            G.card(p, "Note Sketsa E2E").wait_for(timeout=20000)
            G.open_editor(p, "Note Sketsa E2E")
            run_step("1", step1, p)
            run_step("2", step2, p)
            run_step("3", step3, p)
            run_step("4", step4, p)
            run_step("5", step5, p)
            run_step("6", step6, p)
            run_step("6r", step6r, p)
            run_step("7", step7, p, ctx)
            check("A (langkah 1–7): tanpa pageerror", not p.errors, p.errors[:3])
            ctx.close()
            # 8: TaskFormModal
            ctx, p = open_app(browser, base, A)
            run_step("8", step8, p)
            run_step("8q", step8q, p, base, A)
            run_step("8t", step8t, p, base, A)
            run_step("8x", step8x, p, base, A)
            check("B (langkah 8): tanpa pageerror", not p.errors, p.errors[:3])
            # 9: halaman Sketsa + modal sisip (konteks yang sama, mulai dari muat ulang)
            run_step("9", step9, p, base)
            check("C (langkah 9): tanpa pageerror", not p.errors, p.errors[:3])
            ctx.close()
            # 11: NoteModal pada note cid (dibuat offline) → online → unggah ke id server
            ctx, p = open_app(browser, base, A)
            run_step("11", step11, p, ctx, base, A)
            check("E (langkah 11): tanpa pageerror", not p.errors, p.errors[:3])
            ctx.close()
            # 10: screenshot
            ctx, p = open_app(browser, base, A)
            G.go_notes(p)
            G.card(p, "Note Sketsa E2E").wait_for(timeout=20000)
            G.open_editor(p, "Note Sketsa E2E")
            run_step("10", step10, p)
            check("D (langkah 10): tanpa pageerror", not p.errors, p.errors[:3])
            ctx.close()
            browser.close()
    finally:
        proc.kill()
    failed = [s for s, ok in results if not ok]
    print("\nRESULT %d/%d lulus" % (len(results) - len(failed), len(results)), flush=True)
    for s in failed:
        print("  GAGAL:", s, flush=True)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
