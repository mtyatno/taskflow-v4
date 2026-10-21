"""E2E komentar note PR 3 (UI), Task 6 — dua akun. Tidak dijalankan CI.

A = pemilik workspace W, B = anggota. Desktop 1360×900 (panel samping pembaca), 375×812 (lembar bawah).
  1  B buka note W di Notes (pembaca) → tombol `Komentar`; note pribadi A → tanpa tombol, tanpa request komentar
  2  B pilih teks → `Komentari` → kirim → kartu berkutipan; A dapat notifikasi "… mengomentari catatanmu …";
     panel A (terbuka) menampilkan komentar ≤ 5 dtk (SSE)
  3  CSS.highlights.has("cmt") di A dan B; klik teks tersorot → `.cmt-card.is-active`
  4  A membalas; B klik notifikasi di lonceng → Notes terbuka dengan panel komentar terbuka
  5  A `Selesaikan` → tab `Selesai` di kedua sisi; `Buka lagi` mengembalikan
  6  A edit teks terkutip di editor → `Bagian ini sudah diubah atau dihapus dari catatan.`; tanpa error console
  7  B offline → banner offline, kirim → `Menunggu sinkron`; online → label hilang, A melihat komentar
  8  klik `Kirim` dua kali cepat (dan Ctrl+Enter dua kali) → tepat satu komentar di server
  9  A pindahkan note ke pribadi saat panel B terbuka → panel B kosong, tanpa error
 10  375 px terang + gelap: lembar bawah, scrollWidth ≤ 375; badge `cmt-badge` di daftar catatan B

Server lokal uvicorn webapp:app + DB sementara. Screenshot: temporary_files/e2e_komentar_note/ (di-.gitignore).
Keluar non-zero bila ada langkah gagal.

    python3 temporary_files/e2e_komentar_note.py
"""
import os
import re
import socket
import sqlite3
import subprocess
import sys
import tempfile
import time
import traceback
import uuid
from datetime import datetime

import requests
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHOTS = os.environ.get("E2E_SHOTS") or os.path.join(ROOT, "temporary_files", "e2e_komentar_note")
PW = "rahasia123"
SECRET = "e2e-komentar-note-secret-0123456789abcdef"
TOURS = ['dashboard', 'tasks', 'today', 'calendar', 'kanban', 'notes', 'mindmap', 'chat', 'habits', 'habit',
         'settings', 'draw', 'goals', 'review', 'focus', 'workspace', 'slist']
WS = "Tim Produk"
NOTE = "Rencana Rilis"
NOTE_BODY = ("Rilis versi baru dijadwalkan minggu depan.\n\n"
             "Anggaran pemasaran perlu ditinjau ulang sebelum Jumat.\n\n"
             "Tim desain menyiapkan mockup halaman utama.\n")
QUOTE = "Anggaran pemasaran perlu ditinjau ulang"
NOTE9 = "Catatan Pindah"
PRIV = "Catatan Pribadi Ana"
LOST = "Bagian ini sudah diubah atau dihapus dari catatan."
OFFLINE = "Kamu sedang offline. Komentar dikirim otomatis saat tersambung."
PENDING = "Menunggu sinkron"
EMPTY_OPEN = ("Belum ada komentar terbuka. Pilih teks di catatan untuk mengomentari bagian tertentu, "
              "atau tulis komentar umum di bawah.")
EMPTY_DONE = "Belum ada komentar yang diselesaikan."
DESKTOP = {"width": 1360, "height": 900}

# Lacak EventSource stream komentar yang masih terbuka.
ES_TRACKER = """(() => {
  const O = window.EventSource; if (!O || O.__tfWrapped) return;
  window.__esLive = new Set();
  class W extends O {
    constructor(u, o) { super(u, o); window.__esLive.add(this);
      const c = this.close.bind(this); this.close = () => { window.__esLive.delete(this); c(); }; }
  }
  W.__tfWrapped = true;
  window.EventSource = W;
})();"""

results = []


def check(step, ok, note=""):
    results.append((step, bool(ok), str(note)))
    print(("PASS " if ok else "FAIL ") + step + (" — " + str(note) if note != "" else ""), flush=True)
    return ok


def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


def start_server(tmp):
    port = free_port()
    env = dict(os.environ, DB_PATH=os.path.join(tmp, "e2e.db"), UPLOAD_DIR=os.path.join(tmp, "uploads"),
               MEDIA_ROOT=os.path.join(tmp, "media"), WEB_SECRET_KEY=SECRET, WEB_PORT=str(port),
               TELEGRAM_BOT_TOKEN="")
    os.makedirs(env["UPLOAD_DIR"], exist_ok=True)
    log = open(os.path.join(tmp, "server.log"), "w")
    proc = subprocess.Popen([sys.executable, "-m", "uvicorn", "webapp:app", "--host", "127.0.0.1",
                             "--port", str(port)], cwd=ROOT, env=env, stdout=log, stderr=subprocess.STDOUT)
    base = "http://127.0.0.1:%d" % port
    for _ in range(120):
        try:
            if requests.get(base + "/manifest.json", timeout=1).status_code < 500:
                return proc, base, env["DB_PATH"]
        except requests.RequestException:
            pass
        if proc.poll() is not None:
            break
        time.sleep(0.5)
    proc.kill()
    raise RuntimeError("server gagal start, lihat " + log.name)


def register(base, name):
    u = "%s%d" % (name.lower(), int(time.time() * 1000) % 10_000_000)
    r = requests.post(base + "/api/auth/register",
                      json={"username": u, "password": PW, "email": u + "@ex.com", "display_name": name})
    r.raise_for_status()
    j = r.json()
    return {"username": u, "id": j["user_id"], "token": j["token"], "name": name}


def api(base, user, method, path, **kw):
    r = requests.request(method, base + path, headers={"Authorization": "Bearer " + user["token"]}, timeout=15, **kw)
    if r.status_code >= 400:
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


def server_comments(base, user, nid):
    try:
        d = api(base, user, "GET", "/api/scratchpad/%d/comments" % nid)
    except RuntimeError:
        return []
    return d if isinstance(d, list) else []


def open_app(browser, base, user, theme="light", viewport=None):
    vp = viewport or DESKTOP
    kw = {"service_workers": "block", "viewport": vp}
    if vp["width"] < 600:
        kw.update(has_touch=True, is_mobile=True)
    ctx = browser.new_context(**kw)
    ctx.add_init_script(ES_TRACKER)
    ctx.add_cookies([{"name": "token", "value": user["token"], "url": base, "httpOnly": True, "sameSite": "Lax"}])
    p = ctx.new_page()
    p.base = base
    p.errors = []      # pageerror (uncaught)
    p.console = []     # console.error
    p.on("pageerror", lambda e: p.errors.append(str(e)))
    p.on("console", lambda m: p.console.append(m.text) if m.type == "error" else None)
    p.goto(base + "/manifest.json")
    p.evaluate("""([t, u, tours, theme]) => {
        localStorage.setItem('tf_token', t); localStorage.setItem('tf_user_id', String(u));
        for (const pg of tours) localStorage.setItem('tf_tour_' + pg, '1');
        localStorage.setItem('tf_dismiss_onboarding', '1');
        localStorage.setItem('tf_shortcut_hint', '1');
        localStorage.setItem('tf_theme', theme);
    }""", [user["token"], user["id"], TOURS, theme])
    p.goto(base + "/")
    p.locator(".sidebar-link").first.wait_for(state="attached", timeout=20000)
    return ctx, p


def shot(page, name):
    path = os.path.join(SHOTS, name)
    page.wait_for_timeout(350)
    page.screenshot(path=path, full_page=False)
    print("  screenshot", os.path.relpath(path, ROOT), flush=True)


def wait_until(fn, timeout=15, interval=0.25):
    end = time.time() + timeout
    last = None
    while time.time() < end:
        try:
            last = fn()
            if last:
                return last
        except Exception:  # noqa: BLE001
            last = None
        time.sleep(interval)
    return last


def sync_now(page):
    page.evaluate("() => typeof window.__syncNow === 'function' ? Promise.resolve(window.__syncNow()).catch(() => null) : null")


def home(p):
    p.goto(p.base + "/")
    p.locator(".sidebar-link").first.wait_for(state="attached", timeout=20000)


def go_notes(p):
    link = p.locator(".sidebar-link").filter(has=p.locator("span", has_text=re.compile("^Notes$")))
    if link.count() == 0 or not link.first.is_visible():
        ex = p.locator("button[aria-label='Tampilkan semua menu']")
        if ex.count() and ex.first.is_visible():
            ex.first.click()
    if (p.viewport_size or {}).get("width", 1360) < 600 or not link.first.is_visible():
        link.first.evaluate("el => el.click()")  # HP: sidebar di luar layar (drawer)
    else:
        link.first.click()


def note_card(p, title):
    return p.locator(".note-card-title").filter(has_text=title).first


def open_note(p, title, reload=True):
    if reload:
        home(p)
        sync_now(p)
        go_notes(p)
    card = note_card(p, title)
    if not wait_until(lambda: card.count() > 0 or (sync_now(p) and False), 20):
        shot(p, "debug_open_note_%s.png" % re.sub(r"\W+", "_", title))
        raise RuntimeError("note '%s' tidak muncul di daftar" % title)
    card.click()
    p.locator(".notes-panel-actions").first.wait_for(timeout=15000)
    p.locator(".note-rendered").first.wait_for(timeout=15000)


def reader_btn(p):
    return p.locator(".notes-panel-actions button[aria-label^='Komentar,']")


def panel(p):
    return p.locator("aside.cmt-panel")


def cards(p):
    return panel(p).locator(".cmt-card")


def ensure_panel_open(p):
    if panel(p).count() == 0:
        reader_btn(p).first.click()
    panel(p).first.wait_for(timeout=10000)


def select_text(p, root_sel, text):
    """Pilih `text` (dalam satu node teks) di bawah root_sel; kembalikan rect seleksi."""
    return p.evaluate("""([sel, text]) => {
        const root = document.querySelector(sel); if (!root) return null;
        const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        let n; while ((n = w.nextNode())) {
            const i = n.data.indexOf(text);
            if (i >= 0) {
                const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + text.length);
                const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
                const b = r.getBoundingClientRect();
                return { x: b.left, y: b.top, w: b.width, h: b.height };
            }
        }
        return null;
    }""", [root_sel, text])


def text_point(p, root_sel, text, frac=0.3):
    return p.evaluate("""([sel, text, frac]) => {
        const root = document.querySelector(sel); if (!root) return null;
        const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        let n; while ((n = w.nextNode())) {
            const i = n.data.indexOf(text);
            if (i >= 0) {
                const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + text.length);
                const b = r.getClientRects()[0];
                return { x: b.left + b.width * frac, y: b.top + b.height / 2 };
            }
        }
        return null;
    }""", [root_sel, text, frac])


def composer(p):
    # komposer utama (bukan balasan) = yang terakhir di panel, di luar kartu
    return panel(p).locator(":scope > .cmt-composer")


def send_comment(p, text):
    c = composer(p)
    c.locator("textarea.cmt-input").fill(text)
    c.get_by_role("button", name="Kirim", exact=True).click()


def has_highlight(p):
    """Sorotan kutipan: 'cmt' (biasa) atau 'cmt-active' (thread aktif dipisah ke highlight sendiri)."""
    return p.evaluate("() => !!(window.CSS && CSS.highlights && (CSS.highlights.has('cmt') || CSS.highlights.has('cmt-active')))")


def has_cmt_key(p):
    return p.evaluate("() => !!(window.CSS && CSS.highlights && CSS.highlights.has('cmt'))")


def tab_btn(p, prefix):
    return panel(p).locator("button.cmt-tab").filter(has_text=re.compile("^" + re.escape(prefix)))


def card_with(p, text):
    return cards(p).filter(has_text=text)


def open_streams(p):
    return p.evaluate("""() => Array.from(window.__esLive || [])
        .filter(e => /\\/comments\\/stream/.test(e.url) && e.readyState !== 2).map(e => e.url)""")


def scroll_w(p):
    return p.evaluate("() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth })")


def cmt_errors(lines):
    return [x for x in lines if re.search(r"cmt|comment|Comment|highlight|Highlight", x)]


def main():
    os.makedirs(SHOTS, exist_ok=True)
    for f in os.listdir(SHOTS):
        if f.endswith(".png"):
            os.remove(os.path.join(SHOTS, f))
    tmp = tempfile.mkdtemp(prefix="e2e_komentar_note_")
    proc, base, db_path = start_server(tmp)
    print("server", base, "DB", db_path, flush=True)
    pages = []
    try:
        A = register(base, "Ana")
        B = register(base, "Budi")
        ws_id = api(base, A, "POST", "/api/lists", json={"name": WS})["id"]
        with sqlite3.connect(db_path) as c:
            c.execute("INSERT INTO list_members (list_id, user_id, joined_at) VALUES (?,?,?)",
                      (ws_id, B["id"], datetime.now().isoformat()))
        n1 = make_note(base, A, NOTE, NOTE_BODY, ws_id)
        n9 = make_note(base, A, NOTE9, "Catatan ini akan dipindah ke pribadi.\n", ws_id)
        npriv = make_note(base, A, PRIV, "Hanya untuk Ana.\n")
        api(base, A, "POST", "/api/scratchpad/%d/comments" % n9["id"], json={"body": "Komentar sebelum dipindah"})
        check("setup: W + B anggota + 2 note W + 1 note pribadi",
              n1.get("list_id") == ws_id and n9.get("list_id") == ws_id and npriv.get("list_id") is None)

        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            ctxA, a = open_app(browser, base, A)
            ctxB, b = open_app(browser, base, B)
            pages += [a, b]
            comment_reqs = []
            ctxA.on("request", lambda r: comment_reqs.append(r.url) if "comments" in r.url else None)

            # ── 1. tombol Komentar hanya untuk note workspace ────────────────────
            open_note(a, PRIV)
            a.wait_for_timeout(800)
            priv_reqs = [u for u in comment_reqs if "/api/scratchpad/%d/" % npriv["id"] in u]
            check("1a note pribadi A: tanpa tombol Komentar", reader_btn(a).count() == 0)
            check("1b note pribadi A: tanpa request ke rute komentar", not priv_reqs, repr(priv_reqs))
            check("1c note pribadi A: tanpa panel / stream", panel(a).count() == 0 and not open_streams(a), repr(open_streams(a)))
            shot(a, "01_A_note_pribadi_tanpa_tombol.png")
            open_note(b, NOTE)
            check("1d B (anggota) buka note W di pembaca: tombol Komentar ada", wait_until(lambda: reader_btn(b).count() == 1, 10))
            btn_txt = reader_btn(b).first.inner_text().strip() if reader_btn(b).count() else ""
            check("1e label tombol 'Komentar', aria-label 'Komentar, 0 terbuka'",
                  btn_txt == "Komentar" and reader_btn(b).first.get_attribute("aria-label") == "Komentar, 0 terbuka",
                  repr(btn_txt))
            shot(b, "01_B_note_workspace_tombol_komentar.png")

            # A membuka note W dengan panel terbuka (untuk SSE di skenario 2)
            open_note(a, NOTE)
            ensure_panel_open(a)
            check("2pre A: panel samping terbuka, kosong",
                  panel(a).locator(".cmt-empty").filter(has_text=EMPTY_OPEN).count() == 1
                  and panel(a).first.get_attribute("class").find("cmt-panel--side") >= 0)
            check("2pre2 A: stream komentar terbuka", wait_until(lambda: len(open_streams(a)) == 1, 10), repr(open_streams(a)))

            # ── 2. B pilih teks → Komentari → kirim ─────────────────────────────
            rect = select_text(b, ".note-rendered", QUOTE)
            check("2a teks terpilih di pembaca B", bool(rect), repr(rect))
            bubble = b.locator("button.cmt-bubble")
            check("2b gelembung 'Komentari' muncul", wait_until(lambda: bubble.count() == 1, 5)
                  and bubble.first.inner_text().strip() == "Komentari")
            shot(b, "02_B_gelembung_komentari.png")
            bubble.first.click()
            panel(b).first.wait_for(timeout=8000)
            chip = panel(b).locator(".cmt-quote-chip-text")
            check("2c panel B terbuka dengan chip kutipan",
                  chip.count() == 1 and chip.first.inner_text().strip() == "Mengomentari: “%s”" % QUOTE,
                  chip.first.inner_text() if chip.count() else "")
            body2 = "Tolong cek angka anggarannya ya."
            t_send = time.time()
            send_comment(b, body2)
            c2 = card_with(b, body2)
            check("2d kartu B tampil dengan kutipan", wait_until(lambda: c2.count() == 1, 10)
                  and c2.first.locator(".cmt-quote-text").inner_text().strip() == "“%s”" % QUOTE)
            check("2e chip kutipan dilepas setelah kirim", panel(b).locator(".cmt-quote-chip").count() == 0)
            shot(b, "02_B_kartu_berkutipan.png")
            seen_a = wait_until(lambda: card_with(a, body2).count() == 1, 15)
            dt = time.time() - t_send
            check("2f panel A (terbuka) menampilkan komentar B (SSE)", seen_a, "%.1f s" % dt)
            check("2g dalam ≤ 5 dtk", seen_a and dt <= 5.0, "%.1f s" % dt)
            srv = server_comments(base, A, n1["id"])
            check("2h server: komentar dengan kutipan", any(r.get("body") == body2 and r.get("quote") == QUOTE for r in srv),
                  repr([(r.get("body"), r.get("quote")) for r in srv]))
            notifs = api(base, A, "GET", "/api/notifications")
            msg = next((n["message"] for n in notifs if "mengomentari catatanmu" in (n.get("message") or "")), None)
            check("2i A menerima notifikasi '… mengomentari catatanmu …'", bool(msg) and NOTE in msg, repr(msg))
            shot(a, "02_A_panel_menerima_sse.png")

            # ── 3. sorotan ───────────────────────────────────────────────────────
            check("3a CSS.highlights.has('cmt') di A", wait_until(lambda: has_cmt_key(a), 5))
            check("3b CSS.highlights.has('cmt') di B", wait_until(lambda: has_cmt_key(b), 5))
            # lepas thread aktif dulu (klik area kosong) lalu klik teks tersorot di A
            a.evaluate("() => window.getSelection().removeAllRanges()")
            pt = text_point(a, ".note-rendered", QUOTE)
            check("3c kartu A belum aktif sebelum klik", a.locator(".cmt-card.is-active").count() == 0)
            a.mouse.click(pt["x"], pt["y"])
            act = a.locator(".cmt-card.is-active")
            check("3d klik teks tersorot → .cmt-card.is-active", wait_until(lambda: act.count() == 1, 5)
                  and body2 in act.first.inner_text())
            shot(a, "03_A_sorotan_kartu_aktif.png")
            b.evaluate("() => window.getSelection().removeAllRanges()")
            pt = text_point(b, ".note-rendered", QUOTE, 0.6)
            b.mouse.click(pt["x"], pt["y"])
            check("3e B: klik teks tersorot → kartu aktif", wait_until(lambda: b.locator(".cmt-card.is-active").count() == 1, 5))
            shot(b, "03_B_sorotan.png")

            # ── 4. A membalas; B klik notifikasi ───────────────────────────────
            reply = "Sudah saya cek, angkanya aman."
            ca = card_with(a, body2).first
            ca.get_by_role("button", name="Balas", exact=True).click()
            ca.locator("textarea[placeholder='Tulis balasan…']").fill(reply)
            ca.locator(".cmt-composer--reply").get_by_role("button", name="Kirim", exact=True).click()
            check("4a balasan A tampil di kartu A", wait_until(lambda: card_with(a, reply).count() == 1, 10))
            check("4b server: balasan ber-parent", wait_until(lambda: any(
                r.get("body") == reply and r.get("parent_id") for r in server_comments(base, A, n1["id"])), 10))
            # B pindah halaman (dashboard), lalu buka lonceng → klik notifikasi komentar
            home(b)
            bell = b.locator(".desktop-topbar button[title='Notifikasi']")
            wait_until(lambda: any("membalas" in (n.get("message") or "") or "komentar" in (n.get("message") or "")
                                   for n in api(base, B, "GET", "/api/notifications")), 10)
            bell.first.click()
            item = b.locator("div[data-notif-panel] div[role='button']").filter(has_text=re.compile("balas|komentar", re.I))
            check("4c notifikasi komentar ada di lonceng B", wait_until(lambda: item.count() >= 1, 10),
                  b.locator("div[data-notif-panel]").last.inner_text()[:300] if b.locator("div[data-notif-panel]").count() else "")
            shot(b, "04_B_lonceng_notifikasi.png")
            print("  notif B:", item.first.inner_text()[:160] if item.count() else None, flush=True)
            item.first.click()
            check("4d B: halaman Notes terbuka dengan note itu", wait_until(
                lambda: b.locator(".notes-panel-actions").count() >= 1 and NOTE in b.locator(".notes-panel-actions").first.locator("xpath=..").inner_text(), 15))
            check("4e B: panel komentar terbuka + balasan A terlihat",
                  wait_until(lambda: panel(b).count() == 1 and card_with(b, reply).count() == 1, 15))
            shot(b, "04_B_notifikasi_membuka_panel.png")

            # ── 5. Selesaikan / Buka lagi ─────────────────────────────────────
            card_with(a, body2).first.get_by_role("button", name="Selesaikan", exact=True).click()
            check("5a A: tab Terbuka kosong", wait_until(
                lambda: card_with(a, body2).count() == 0 and panel(a).locator(".cmt-empty").filter(has_text=EMPTY_OPEN).count() == 1, 10))
            check("5b A: tab 'Selesai · 1'", wait_until(lambda: tab_btn(a, "Selesai").first.inner_text().strip() == "Selesai · 1", 5),
                  tab_btn(a, "Selesai").first.inner_text())
            tab_btn(a, "Selesai").first.click()
            check("5c A: kartu di tab Selesai + 'Diselesaikan oleh'", wait_until(lambda: card_with(a, body2).count() == 1
                  and "Diselesaikan oleh" in card_with(a, body2).first.inner_text(), 5))
            check("5d B: kartu pindah ke Selesai (SSE)", wait_until(
                lambda: card_with(b, body2).count() == 0 and tab_btn(b, "Selesai").first.inner_text().strip() == "Selesai · 1", 10))
            tab_btn(b, "Selesai").first.click()
            check("5e B: kartu terlihat di tab Selesai", wait_until(lambda: card_with(b, body2).count() == 1, 5))
            check("5f sorotan hilang (thread selesai) di A", wait_until(lambda: not has_highlight(a), 5))
            shot(a, "05_A_tab_selesai.png")
            shot(b, "05_B_tab_selesai.png")
            card_with(a, body2).first.get_by_role("button", name="Buka lagi", exact=True).click()
            check("5g A: Buka lagi → tab Selesai kosong", wait_until(
                lambda: panel(a).locator(".cmt-empty").filter(has_text=EMPTY_DONE).count() == 1, 10))
            tab_btn(a, "Terbuka").first.click()
            check("5h A: kartu kembali di Terbuka", wait_until(lambda: card_with(a, body2).count() == 1, 5))
            check("5i B: kartu kembali (Selesai kosong, Terbuka · 1)", wait_until(
                lambda: panel(b).locator(".cmt-empty").filter(has_text=EMPTY_DONE).count() == 1
                and tab_btn(b, "Terbuka").first.inner_text().strip() == "Terbuka · 1", 10))
            tab_btn(b, "Terbuka").first.click()
            check("5j sorotan kembali di A", wait_until(lambda: has_highlight(a), 5))

            # ── 6. A edit teks terkutip di editor ───────────────────────────────
            a.console.clear()
            a.errors.clear()
            a.locator(".notes-panel-actions").first.get_by_text("Edit", exact=True).click()
            pm = a.locator(".ProseMirror").first
            pm.wait_for(timeout=15000)
            wait_until(lambda: QUOTE in pm.inner_text(), 10)
            mbtn = a.locator("button.cmt-hdr-btn--modal")
            check("6a editor: tombol Komentar ada", wait_until(lambda: mbtn.count() == 1, 10))
            if panel(a).count() == 0:
                mbtn.first.click()
            panel(a).first.wait_for(timeout=8000)
            check("6b editor: panel menampilkan kartu berkutipan", wait_until(lambda: card_with(a, body2).count() == 1, 10))
            check("6c editor: sorotan aktif", wait_until(lambda: has_highlight(a), 8))
            shot(a, "06_A_editor_sorotan.png")
            # pilih kata "pemasaran" di ProseMirror lalu ketik pengganti
            pm.click()
            select_text(a, ".ProseMirror", "pemasaran")
            a.wait_for_timeout(150)
            a.keyboard.type("promosi digital", delay=40)
            a.wait_for_timeout(400)
            a.keyboard.type(" dan iklan", delay=40)
            check("6d editor memuat teks baru", "Anggaran promosi digital dan iklan" in pm.inner_text())
            lost = card_with(a, body2).first.locator(".cmt-quote-lost")
            check("6e kartu: '%s'" % LOST, wait_until(lambda: lost.count() == 1 and lost.inner_text().strip() == LOST, 8))
            check("6f sorotan thread kutipan-hilang lenyap", wait_until(lambda: not has_highlight(a), 5))
            errs = cmt_errors(a.console) + a.errors
            check("6g mengetik di editor: tanpa error console/pageerror dari kode komentar", not errs, repr(errs[:3]))
            print("  console error lain:", a.console[:5], flush=True)
            shot(a, "06_A_editor_kutipan_hilang.png")
            # tutup editor (simpan otomatis), tunggu server
            wait_until(lambda: "promosi digital" in (api(base, A, "GET", "/api/scratchpad/%d" % n1["id"]).get("content") or ""), 15)
            a.keyboard.press("Escape")
            wait_until(lambda: a.locator(".ProseMirror").count() == 0, 5)
            if a.locator(".ProseMirror").count():
                close = a.locator("button[title='Tutup'], button[aria-label='Tutup']")
                if close.count():
                    close.first.click()
            check("6h editor ditutup, isi tersimpan di server",
                  "promosi digital" in (api(base, A, "GET", "/api/scratchpad/%d" % n1["id"]).get("content") or ""))

            # ── 7. B offline ───────────────────────────────────────────────────
            open_note(b, NOTE)
            ensure_panel_open(b)
            ctxB.set_offline(True)
            b.evaluate("() => window.dispatchEvent(new Event('offline'))")
            off = panel(b).locator(".cmt-offline")
            check("7a banner offline di panel", wait_until(lambda: off.count() == 1 and off.inner_text().strip() == OFFLINE, 5))
            body7 = "Komentar dari mode offline."
            send_comment(b, body7)
            c7 = card_with(b, body7)
            check("7b kartu offline: 'Menunggu sinkron'", wait_until(
                lambda: c7.count() == 1 and c7.first.locator(".cmt-pending-label").inner_text().strip() == PENDING, 8))
            check("7c server belum punya komentar offline",
                  not any(r.get("body") == body7 for r in server_comments(base, A, n1["id"])))
            shot(b, "07_B_offline_menunggu_sinkron.png")
            ctxB.set_offline(False)
            b.evaluate("() => window.dispatchEvent(new Event('online'))")

            def synced7():
                sync_now(b)
                return any(r.get("body") == body7 for r in server_comments(base, A, n1["id"]))
            check("7d online: server menerima komentar", wait_until(synced7, 30, 1))
            check("7e online: label 'Menunggu sinkron' hilang, banner hilang", wait_until(
                lambda: c7.count() == 1 and c7.first.locator(".cmt-pending-label").count() == 0 and off.count() == 0, 15))
            open_note(a, NOTE)  # editor A sudah ditutup di skenario 6; buka lagi pembaca + panel
            ensure_panel_open(a)
            check("7f A melihat komentar offline B", wait_until(lambda: card_with(a, body7).count() == 1, 15))
            shot(b, "07_B_online_tersinkron.png")

            # ── 8. dua kali kirim cepat ────────────────────────────────────────
            body8 = "Kirim dobel harus jadi satu."
            c = composer(b)
            c.locator("textarea.cmt-input").fill(body8)
            b.evaluate("""() => { const btns = [...document.querySelectorAll('aside.cmt-panel > .cmt-composer button')]
                .filter(x => x.textContent.trim() === 'Kirim'); const k = btns[0]; k.click(); k.click(); }""")
            c.get_by_role("button", name="Kirim", exact=True).click(force=True, no_wait_after=True, timeout=2000) \
                if c.get_by_role("button", name="Kirim", exact=True).is_enabled() else None
            body8b = "Ctrl Enter dobel juga satu."
            wait_until(lambda: card_with(b, body8).count() >= 1, 8)
            c.locator("textarea.cmt-input").fill(body8b)
            c.locator("textarea.cmt-input").press("Control+Enter")
            c.locator("textarea.cmt-input").press("Control+Enter")

            def counted():
                sync_now(b)
                rows = server_comments(base, A, n1["id"])
                return ([r for r in rows if r.get("body") == body8], [r for r in rows if r.get("body") == body8b])
            wait_until(lambda: all(counted()), 20, 1)
            time.sleep(2)
            r8, r8b = counted()
            check("8a klik Kirim dua kali cepat → tepat satu komentar di server", len(r8) == 1, len(r8))
            check("8b Ctrl+Enter dua kali → tepat satu komentar di server", len(r8b) == 1, len(r8b))
            check("8c panel B: masing-masing satu kartu", card_with(b, body8).count() == 1 and card_with(b, body8b).count() == 1,
                  "%d/%d" % (card_with(b, body8).count(), card_with(b, body8b).count()))

            # ── 9. note dipindah ke pribadi saat panel B terbuka ─────────────────
            b.errors.clear()
            b.console.clear()
            open_note(b, NOTE9)
            ensure_panel_open(b)
            check("9a B: panel note W menampilkan komentar", wait_until(
                lambda: card_with(b, "Komentar sebelum dipindah").count() == 1, 10))
            check("9b B: stream terbuka", wait_until(lambda: any("/%d/comments/stream" % n9["id"] in u for u in open_streams(b)), 10),
                  repr(open_streams(b)))
            shot(b, "09_B_sebelum_dipindah.png")
            api(base, A, "PUT", "/api/scratchpad/%d" % n9["id"], json={"list_id": None})
            check("9c server: note jadi pribadi", api(base, A, "GET", "/api/scratchpad/%d" % n9["id"]).get("list_id") is None)

            def emptied():
                if card_with(b, "Komentar sebelum dipindah").count() == 0:
                    return True
                sync_now(b)
                return False
            check("9d panel B tidak lagi menampilkan komentar", wait_until(emptied, 25, 1),
                  "panel=%d kartu=%d" % (panel(b).count(), card_with(b, "Komentar sebelum dipindah").count()))
            check("9d2 panel B: daftar kosong (teks kosong Terbuka)",
                  panel(b).count() == 0 or panel(b).locator(".cmt-empty").filter(has_text=EMPTY_OPEN).count() == 1)
            b.wait_for_timeout(1500)
            check("9d3 tanpa toast 'Gagal memuat komentar'", b.get_by_text("Gagal memuat komentar").count() == 0)
            check("9e B: stream note ditutup", not any("/%d/comments/stream" % n9["id"] in u for u in open_streams(b)),
                  repr(open_streams(b)))
            errs = b.errors + cmt_errors(b.console)
            check("9f B: tanpa error tak tertangkap", not errs, repr(errs[:3]))
            print("  B setelah pindah: panel=%d, aksi=%d" % (panel(b).count(), b.locator(".notes-panel-actions").count()), flush=True)
            shot(b, "09_B_setelah_dipindah.png")

            ctxA.close()
            ctxB.close()

            # ── 10. 375 px terang + gelap ──────────────────────────────────────
            for theme in ("light", "dark"):
                tag = "terang" if theme == "light" else "gelap"
                ctx, m = open_app(browser, base, B, theme, {"width": 375, "height": 812})
                pages.append(m)
                check("[%s] 10a data-theme=%s" % (tag, theme),
                      m.evaluate("() => document.documentElement.getAttribute('data-theme')") == theme)
                home(m)
                sync_now(m)
                go_notes(m)
                badge = note_card(m, NOTE).locator(".cmt-badge")
                check("[%s] 10b badge cmt-badge di daftar catatan B" % tag, wait_until(lambda: badge.count() == 1, 15))
                lab = badge.first.get_attribute("aria-label") if badge.count() else ""
                check("[%s] 10c aria-label badge '{N} komentar terbuka'" % tag,
                      bool(re.match(r"^\d+ komentar terbuka(, ada yang baru)?$", lab or "")), repr(lab))
                sw = scroll_w(m)
                check("[%s] 10d daftar: scrollWidth ≤ 375" % tag, sw["sw"] <= 375, repr(sw))
                shot(m, "10_%s_daftar_badge.png" % tag)
                open_note(m, NOTE, reload=False)
                btn = m.locator("button[aria-label^='Komentar,']:visible")
                btn.first.click()
                sheet = m.locator("aside.cmt-panel.cmt-sheet")
                check("[%s] 10e lembar bawah (.cmt-sheet) terbuka" % tag, wait_until(lambda: sheet.count() == 1, 8))
                m.wait_for_timeout(500)
                sw = scroll_w(m)
                check("[%s] 10f lembar: scrollWidth ≤ 375" % tag, sw["sw"] <= 375, repr(sw))
                box = sheet.first.bounding_box() if sheet.count() else None
                cbox = sheet.first.locator(":scope > .cmt-composer").bounding_box() if sheet.count() else None
                check("[%s] 10g lembar menempel bawah, komposer terlihat di layar" % tag,
                      box and cbox and abs(box["y"] + box["height"] - 812) <= 2 and cbox["y"] + cbox["height"] <= 812
                      and box["x"] >= 0 and box["x"] + box["width"] <= 375, repr((box, cbox)))
                shot(m, "10_%s_lembar_bawah.png" % tag)
                ctx.close()

            errs = [e for pg in pages for e in pg.errors]
            check("tanpa pageerror", not errs, "; ".join(errs[:3]))
            browser.close()
    except Exception as e:  # noqa: BLE001
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
    for r in failed:
        print("  FAIL", r[0], "—", r[2])
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
