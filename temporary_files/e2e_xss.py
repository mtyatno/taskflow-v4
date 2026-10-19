"""E2E PR 1b — pengamanan XSS, dua akun. Tidak dijalankan CI.

Setiap halaman memasang window.__xss = undefined (init script); setiap payload menulis window.__xss = 1
(lewat onerror, onload, <script>, javascript: yang diklik). Langkah (A pemilik workspace W, B anggota):
  1  A punya note pribadi N berisi semua payload §1 spec + <br>, <details>, <mark>, $x^2$ dan ::draw D
     (D = drawing pribadi A dengan svg_preview ber-onload/<script>), lalu publish. Pengunjung anonim membuka
     halaman publik: __xss tetap undefined, <details> bisa dibuka, <mark>/<br> tampil, D = <img>.
  2  A men-share N ke W lewat UI (dialog PR 3 menyebut D). B membuka N dalam mode baca lalu cetak
     (window.print di-stub, area cetak diperiksa): __xss undefined.
  3  D (kini drawing W) tampil sebagai <img> di note B, bukan markup SVG; halaman publik N (note W) juga <img>.
  4  A membuat task W berjudul `<img src=x onerror="window.__xss=1"> & co` → B membuka panel notifikasi:
     __xss undefined, teks tampil `& co`.
  5  Header CSP /pub persis sesuai Global Constraints; halaman publik memuat KaTeX tanpa error CSP di console.

Prasyarat (user, keanggotaan, note, drawing, publish, task) dibuat lewat API/DB; perilaku diamati di browser.
Server lokal dijalankan sendiri oleh skrip (uvicorn webapp:app, DB sementara).
Screenshot per langkah: temporary_files/e2e_xss/. Keluar non-zero bila ada langkah gagal.

    python3 temporary_files/e2e_xss.py
"""
import os
import re
import socket
import sqlite3
import subprocess
import sys
import tempfile
import time
import urllib.parse
import uuid
from datetime import datetime

import requests
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHOTS = os.path.join(ROOT, "temporary_files", "e2e_xss")
PW = "rahasia123"
WS = "W"
SECRET = "e2e-xss-secret"
TOURS = ['dashboard', 'tasks', 'today', 'calendar', 'kanban', 'notes', 'mindmap', 'chat', 'habits', 'habit',
         'settings', 'draw', 'goals', 'review', 'focus', 'workspace', 'slist']
CSP_PUB = ("default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' "
           "https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; "
           "img-src 'self' data: blob: https:; media-src 'self' blob:; frame-src 'self'; connect-src 'self'; "
           "object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'self'")

P = 'window.__xss=1'
NOTE_TITLE = "XSS uji </title><script>%s</script> \"kutip\" 'apos'" % P
NOTE_TAG = "tag<i>\"'"
D_TITLE = "Drawing XSS <i>\"'"
TASK_TITLE = '<img src=x onerror="%s"> & co' % P
JS_LINK_TEXT = "tautan-js"
NOTE_CONTENT = "\n".join([
    "# Uji XSS",
    "",
    "Skrip mentah: <script>%s</script>" % P,
    "",
    'Gambar onerror: <img src=x onerror="%s">' % P,
    "",
    'SVG onload: <svg onload="%s"></svg>' % P,
    "",
    "Link: [%s](javascript:%s)" % (JS_LINK_TEXT, P),
    "",
    "Link entity: [tautan-entity](jav&#x61;script:%s)" % P,
    "",
    'Gambar atribut: ![x](x"onerror="%s)' % P,
    "",
    "Penutup judul: </title><script>%s</script>" % P,
    "",
    "baris-satu<br>baris-dua",
    "",
    "<details><summary>Buka detail</summary>Isi detail tersembunyi</details>",
    "",
    "Teks <mark>ditandai</mark> di sini.",
    "",
    "Rumus $x^2$ inline.",
    "",
    "`<br>` di dalam kode tetap teks.",
    "",
    "%s",  # ::draw D diisi saat setup
    "",
])

SVG_EVIL = ('<svg xmlns="http://www.w3.org/2000/svg" width="240" height="120" viewBox="0 0 240 120" onload="%s">'
            '<script>%s</script>'
            '<rect x="10" y="10" width="220" height="100" rx="12" fill="#dc2626"/>'
            '<text x="120" y="70" font-size="24" text-anchor="middle" fill="#fff">SVG jahat</text></svg>' % (P, P))

INIT_JS = """
window.__xss = undefined;
window.__printed = 0;
window.print = function () { window.__printed = (window.__printed || 0) + 1; };
"""

results = []
PAGES = []
VERBOSE = os.environ.get("E2E_VERBOSE") == "1"
PW_RT = []


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


def start_server(tmp):
    port = free_port()
    env = dict(os.environ, DB_PATH=os.path.join(tmp, "e2e.db"), UPLOAD_DIR=os.path.join(tmp, "uploads"),
               WEB_SECRET_KEY=SECRET, TELEGRAM_BOT_TOKEN="")
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


def register(base, prefix, name):
    u = "%s%d" % (prefix, int(time.time() * 1000) % 10_000_000)
    r = requests.post(base + "/api/auth/register",
                      json={"username": u, "password": PW, "email": "u%d@ex.com" % (time.time_ns() % 10**9),
                            "display_name": name})
    r.raise_for_status()
    j = r.json()
    return {"username": u, "id": j["user_id"], "token": j["token"], "name": name}


def api(base, user, method, path, **kw):
    r = requests.request(method, base + path, headers={"Authorization": "Bearer " + user["token"]}, timeout=10, **kw)
    r.raise_for_status()
    return r.json()


def watch(page, who, sink=None):
    page.on("pageerror", lambda e: print("  [pageerror %s] %s" % (who, e), flush=True))

    def on_console(m):
        if sink is not None:
            sink.append((m.type, m.text))
        if VERBOSE and m.type in ("warning", "error"):
            print("  [console.%s %s] %s" % (m.type, who, m.text[:300]), flush=True)
    page.on("console", on_console)


def open_app(browser, base, user):
    ctx = browser.new_context(service_workers="block", viewport={"width": 1366, "height": 900})
    ctx.add_init_script(INIT_JS)
    ctx.add_cookies([{"name": "token", "value": user["token"], "url": base, "httpOnly": True, "sameSite": "Lax"}])
    p = ctx.new_page()
    watch(p, user["name"])
    p.goto(base + "/manifest.json")
    p.evaluate("""([t, u, tours]) => {
        localStorage.setItem('tf_token', t); localStorage.setItem('tf_user_id', String(u));
        for (const pg of tours) localStorage.setItem('tf_tour_' + pg, '1');
        localStorage.setItem('tf_dismiss_onboarding', '1');
    }""", [user["token"], user["id"], TOURS])
    p.goto(base + "/")
    p.locator(".sidebar-link").first.wait_for(state="attached", timeout=20000)
    return ctx, p


def shot(page, name):
    path = os.path.join(SHOTS, name)
    page.wait_for_timeout(500)
    page.screenshot(path=path, full_page=False)
    print("  screenshot", os.path.relpath(path, ROOT), flush=True)


def wait_until(fn, timeout=20, interval=0.5):
    end = time.time() + timeout
    last = None
    while time.time() < end:
        try:
            last = fn()
            if last:
                return last
        except Exception:
            pass
        time.sleep(interval)
    return last


def sync_now(page):
    page.evaluate("() => typeof window.__syncNow === 'function' ? Promise.resolve(window.__syncNow()).catch(() => null) : null")


def xss(page):
    return page.evaluate("() => window.__xss")


def hold(page, ms=1500):
    """Tunggu nyata supaya gambar gagal-muat (onerror), onload SVG, dan handler sempat jalan."""
    page.wait_for_timeout(ms)


DOM_PROBE = """(sel) => {
    const root = document.querySelector(sel) || document.body;
    const all = Array.from(root.querySelectorAll('*'));
    // Atribut on* yang berasal dari payload (nilainya memuat __xss). Handler milik aplikasi (tombol Print,
    // tombol ukuran drawing, fallback onerror gambar) bukan isi pengguna dan tidak dihitung.
    const evAttr = all.filter(e => Array.from(e.attributes).some(a => /^on/i.test(a.name) && a.value.includes('__xss')))
        .map(e => e.outerHTML.slice(0, 120));
    const jsHref = Array.from(root.querySelectorAll('a[href]')).filter(a => /^\\s*javascript:/i.test(a.getAttribute('href'))
        || /^javascript:/i.test(a.href)).map(a => a.outerHTML.slice(0, 120));
    const scripts = Array.from(root.querySelectorAll('script')).map(s => s.outerHTML.slice(0, 120));
    const svgs = Array.from(root.querySelectorAll('svg')).filter(s => !s.closest('.katex')).length;
    const det = root.querySelector('details');
    return {
        evAttr, jsHref, scripts, svgs,
        br: root.querySelectorAll('br').length,
        mark: Array.from(root.querySelectorAll('mark')).map(m => m.textContent),
        details: !!det, summary: det ? (det.querySelector('summary') || {}).textContent : null,
        codeBr: Array.from(root.querySelectorAll('code')).some(c => c.textContent.includes('<br>')),
        jsLinkText: root.textContent.includes('%s'),
        katex: root.querySelectorAll('.katex').length,
        drawImgs: Array.from(root.querySelectorAll('[data-drawing-preview] img')).map(i => (i.getAttribute('src') || '').slice(0, 26)),
        drawSvgMarkup: root.querySelectorAll('[data-drawing-preview] svg').length,
    };
}""" % JS_LINK_TEXT


def click_js_links(page, sel):
    """Klik setiap link dari payload javascript: (seharusnya sudah teks biasa)."""
    links = page.locator(sel + " a", has_text=re.compile("tautan-js|tautan-entity"))
    n = links.count()
    for i in range(n):
        try:
            links.nth(i).click(timeout=3000)
        except Exception:
            pass
    return n


def check_details(page, sel, step):
    det = page.locator(sel + " details").first
    if det.count() == 0:
        return check(step, False, "tidak ada <details>")
    before = det.evaluate("d => d.open")
    det.locator("summary").first.click()
    page.wait_for_timeout(300)
    after = det.evaluate("d => d.open")
    vis = page.locator(sel + " details").first.get_by_text("Isi detail tersembunyi").is_visible()
    return check(step, (not before) and after and vis, repr((before, after, vis)))


def goto_page(page, label):
    link = page.locator(".sidebar-link").filter(has=page.locator("span", has_text=re.compile("^" + re.escape(label) + "$")))
    if link.count() == 0 or not link.first.is_visible():
        expand = page.locator("button[aria-label='Tampilkan semua menu']")
        if expand.count() and expand.first.is_visible():
            expand.first.click()
    link.first.click()


def reload_app(page, base):
    page.goto(base + "/")
    page.locator(".sidebar-link").first.wait_for(state="attached", timeout=20000)


def open_note(page, base, title_part):
    reload_app(page, base)
    goto_page(page, "Notes")
    item = page.get_by_text(title_part).first
    item.wait_for(timeout=20000)
    item.click()
    panel = page.locator(".notes-panel-actions").first
    panel.wait_for(timeout=15000)
    page.locator(".note-rendered").first.wait_for(timeout=15000)
    return panel


IDB_DRAWINGS = """() => new Promise((res) => { const r = indexedDB.open('taskflow-offline');
    r.onsuccess = () => { try { const tx = r.result.transaction('drawings'); const q = tx.objectStore('drawings').getAll();
      q.onsuccess = () => res((q.result || []).map(x => ({server_id: x.server_id})));
      q.onerror = () => res(null); } catch (e) { res(null); } };
    r.onerror = () => res(null); })"""


def main():
    os.makedirs(SHOTS, exist_ok=True)
    for f in os.listdir(SHOTS):
        if f.endswith(".png"):
            os.remove(os.path.join(SHOTS, f))
    tmp = tempfile.mkdtemp(prefix="e2e_xss_")
    proc, base, db_path = start_server(tmp)
    print("server", base, "DB", db_path, flush=True)
    try:
        # Username A berisi < " ' (aturan karakter username di luar cakupan; escape harus menutupnya)
        A = register(base, "ana<u>\"'", "ana")
        B = register(base, "budi", "budi")
        ws = api(base, A, "POST", "/api/lists", json={"name": WS})
        ws_id = ws["id"]
        with sqlite3.connect(db_path) as c:
            c.execute("INSERT INTO list_members (list_id, user_id, joined_at) VALUES (?,?,?)",
                      (ws_id, B["id"], datetime.now().isoformat()))
        check("setup: B anggota W", any(l["id"] == ws_id for l in api(base, B, "GET", "/api/lists")))

        d_cid = str(uuid.uuid4())
        D = api(base, A, "POST", "/api/drawings", json={"title": D_TITLE, "data_json": "{}", "client_id": d_cid,
                                                         "svg_preview": SVG_EVIL})
        n = api(base, A, "POST", "/api/scratchpad", json={
            "title": NOTE_TITLE, "client_id": str(uuid.uuid4()), "tags": [NOTE_TAG],
            "content": NOTE_CONTENT % ("::draw[%s]{title=\"%s\"}" % (d_cid, D_TITLE.replace('"', "'")))})
        stored_svg = api(base, A, "GET", "/api/drawings/%d" % D["id"]).get("svg_preview") or ""
        check("setup: D pribadi A dengan svg_preview ber-onload/<script>, N pribadi",
              D.get("list_id") is None and n.get("list_id") is None and "<script>" in stored_svg and "onload=" in stored_svg)
        pub = api(base, A, "POST", "/api/scratchpad/%d/publish" % n["id"], json={})
        pub_url = base + "/pub/%s/%s" % (urllib.parse.quote(pub["username"], safe=""), urllib.parse.quote(pub["slug"], safe=""))
        check("setup: N dipublish", requests.get(pub_url, timeout=10).status_code == 200, pub_url)

        pw = sync_playwright().start()
        PW_RT.append(pw)
        browser = pw.chromium.launch()

        # ── 1. Pengunjung anonim membuka halaman publik ───────────────────────────────
        ctxP = browser.new_context(viewport={"width": 1100, "height": 900})
        ctxP.add_init_script(INIT_JS)
        pv = ctxP.new_page()
        pub_console = []
        watch(pv, "anon", pub_console)
        PAGES[:] = [("anon", pv)]
        pv.goto(pub_url)
        pv.wait_for_load_state("load")
        check("1a anon pub: __xss undefined setelah render", xss(pv) is None, repr(xss(pv)))
        hold(pv, 2000)
        check("1b anon pub: __xss undefined setelah tunggu gambar/handler", xss(pv) is None, repr(xss(pv)))
        title = pv.title()
        check("1c anon pub: <title> memuat payload judul sebagai teks", "</title><script>" in title, repr(title))
        pr = pv.evaluate(DOM_PROBE, "body")
        check("1d anon pub: tanpa atribut on*, tanpa href javascript:, tanpa <script> di isi",
              not pr["evAttr"] and not pr["jsHref"],
              repr((pr["evAttr"][:3], pr["jsHref"][:3])))
        content_scripts = pv.evaluate("""() => Array.from(document.querySelectorAll('script'))
            .filter(s => (s.textContent || '').includes('window.__xss=1')).length""")
        check("1e anon pub: tidak ada elemen <script> berisi payload", content_scripts == 0, repr(content_scripts))
        check("1f anon pub: link javascript: tampil sebagai teks biasa", pr["jsLinkText"] and not pr["jsHref"])
        nclick = click_js_links(pv, "body")
        hold(pv, 500)
        check("1g anon pub: klik link dari payload javascript: (bila ada) tidak menjalankan apa pun",
              xss(pv) is None, "link diklik: %d" % nclick)
        check("1h anon pub: <mark> tampil, <br> jadi tag, <br> di kode tetap teks",
              "ditandai" in pr["mark"] and pr["br"] >= 1 and pr["codeBr"] and pv.locator("mark").first.is_visible(),
              repr((pr["mark"], pr["br"], pr["codeBr"])))
        check("1i anon pub: drawing D tampil sebagai <img data:image/svg+xml>, bukan markup SVG",
              pr["drawImgs"] and all(s.startswith("data:image/svg+xml") for s in pr["drawImgs"]) and pr["drawSvgMarkup"] == 0,
              repr((pr["drawImgs"], pr["drawSvgMarkup"])))
        shot(pv, "01_anon_pub_sebelum_details.png")
        check_details(pv, "body", "1j anon pub: <details> bisa dibuka")
        pv.locator("details").first.scroll_into_view_if_needed()
        shot(pv, "02_anon_pub_details_terbuka.png")
        check("1k anon pub: __xss tetap undefined di akhir langkah", xss(pv) is None, repr(xss(pv)))

        # ── 5. CSP /pub + KaTeX tanpa error CSP ────────────────────────────────────────
        hdr = requests.get(pub_url, timeout=10).headers
        check("5a header CSP /pub persis sesuai Global Constraints", hdr.get("Content-Security-Policy") == CSP_PUB,
              repr(hdr.get("Content-Security-Policy")))
        check("5b header X-Content-Type-Options: nosniff di /pub", hdr.get("X-Content-Type-Options") == "nosniff")
        check("5c anon pub: KaTeX merender $x^2$", pr["katex"] >= 1, "elemen .katex: %d" % pr["katex"])
        katex_css = pv.evaluate("""() => Array.from(document.styleSheets).some(s => (s.href || '').includes('katex'))""")
        fonts = pv.evaluate("""() => document.fonts ? Array.from(document.fonts).map(f => f.family + ':' + f.status) : []""")
        csp_err = [t for (_, t) in pub_console if re.search(r"Refused to|Content Security Policy", t)]
        check("5d anon pub: tidak ada pelanggaran CSP di console (KaTeX/font)", katex_css and not csp_err,
              "katex.css=%s; font=%s; CSP=%r" % (katex_css, sorted(set(fonts))[:6], csp_err[:3]))
        net_err = [t for (ty, t) in pub_console if ty == "error" and t not in csp_err]
        if net_err:
            print("  (info) error console non-CSP di halaman publik:", net_err[:4], flush=True)
        pv.locator(".katex").first.scroll_into_view_if_needed()
        shot(pv, "03_anon_pub_katex.png")
        # Kontrol negatif: detektor bekerja — payload yang sama, disuntik langsung ke DOM, memang menulis __xss
        pv.evaluate("""() => { const d = document.createElement('div');
            d.innerHTML = '<img src=x onerror="window.__xss=1">'; document.body.appendChild(d); }""")
        check("5e kontrol: payload yang disuntik langsung ke DOM memang menyetel __xss (detektor bekerja)",
              wait_until(lambda: xss(pv) == 1, 5), repr(xss(pv)))

        # ── 2. A share N ke W lewat dialog; B mode baca + cetak ────────────────────────
        ctxA, a = open_app(browser, base, A)
        ctxB, b = open_app(browser, base, B)
        PAGES[:] = [("anon", pv), ("A", a), ("B", b)]

        def a_has_d():
            sync_now(a)
            rows = a.evaluate(IDB_DRAWINGS) or []
            return any(str(r.get("server_id")) == str(D["id"]) for r in rows)
        check("2a A: sync menarik D ke IndexedDB", wait_until(a_has_d, 30))
        panel = open_note(a, base, "XSS uji")
        hold(a)
        check("2b A mode baca (pemilik): __xss undefined", xss(a) is None, repr(xss(a)))
        share_btn = panel.locator("button[title='Bagikan ke list']")
        share_btn.click()
        menu = share_btn.locator("xpath=..")
        menu.get_by_text("Bagikan ke List").wait_for(timeout=5000)
        menu.get_by_text(WS, exact=True).click()
        dlg_title = a.get_by_text("Ikut dibagikan ke %s:" % WS)
        dlg_title.wait_for(timeout=20000)
        dlg = dlg_title.locator("xpath=ancestor::div[contains(@class,'modal-overlay')][1]")
        check("2c A: dialog share menyebut drawing D (judul sebagai teks)", dlg.get_by_text(D_TITLE).count() > 0,
              dlg.inner_text()[:200].replace("\n", " | "))
        shot(a, "04_A_dialog_share_ke_W.png")
        dlg.get_by_role("button", name="Bagikan").click()

        def shared():
            nn = api(base, A, "GET", "/api/scratchpad/%d" % n["id"])
            dd = api(base, A, "GET", "/api/drawings/%d" % D["id"])
            return nn.get("list_id") == ws_id and dd.get("list_id") == ws_id
        check("2d server: N dan D pindah ke W", wait_until(shared, 30))
        check("2e A: __xss undefined setelah share", xss(a) is None, repr(xss(a)))

        sync_now(b)
        open_note(b, base, "XSS uji")
        sel_b = ".note-rendered"
        wait_until(lambda: b.evaluate(DOM_PROBE, sel_b)["drawImgs"], 20)
        hold(b, 2000)
        check("2f B mode baca: __xss undefined setelah render dan tunggu", xss(b) is None, repr(xss(b)))
        prb = b.evaluate(DOM_PROBE, sel_b)
        check("2g B mode baca: tanpa atribut on*, href javascript:, <script> di isi note",
              not prb["evAttr"] and not prb["jsHref"] and not prb["scripts"],
              repr((prb["evAttr"][:3], prb["jsHref"][:3], prb["scripts"][:3])))
        nclick = click_js_links(b, sel_b)
        hold(b, 500)
        check("2h B mode baca: link javascript: tampil teks, klik (bila ada) tidak menjalankan apa pun",
              prb["jsLinkText"] and xss(b) is None, "link diklik: %d" % nclick)
        check("2i B mode baca: <mark> tampil, <br> jadi tag, <br> di kode tetap teks",
              "ditandai" in prb["mark"] and prb["br"] >= 1 and prb["codeBr"], repr((prb["mark"], prb["br"], prb["codeBr"])))
        check_details(b, sel_b, "2j B mode baca: <details> bisa dibuka")
        shot(b, "05_B_mode_baca.png")

        # cetak: Export → PDF (Cetak); window.print di-stub sehingga area cetak tetap ada untuk diperiksa
        b.locator("button[title='Export Catatan']").first.click()
        b.get_by_text("PDF (Cetak)").first.click()
        printed = wait_until(lambda: b.evaluate("() => window.__printed") >= 1, 15)
        check("2k B cetak: handlePrint memanggil window.print", printed)
        hold(b, 1500)
        prp = b.evaluate(DOM_PROBE, "#note-print-area")
        check("2l B cetak: __xss undefined", xss(b) is None, repr(xss(b)))
        check("2m B cetak: area cetak tanpa atribut on*, href javascript:, <script>; <mark>/<details> tampil",
              b.locator("#note-print-area").count() == 1 and not prp["evAttr"] and not prp["jsHref"]
              and not prp["scripts"] and "ditandai" in prp["mark"] and prp["details"],
              repr((prp["evAttr"][:3], prp["jsHref"][:3], prp["scripts"][:3], prp["mark"], prp["details"])))
        b.emulate_media(media="print")
        shot(b, "06_B_print_preview.png")
        b.emulate_media(media="screen")

        # ── 3. D (drawing W) di note B = <img>; halaman publik note W juga <img> ──────
        check("3a B mode baca: D (drawing W, svg ber-script) tampil sebagai <img>, tanpa markup SVG",
              prb["drawImgs"] and prb["drawSvgMarkup"] == 0, repr((prb["drawImgs"], prb["drawSvgMarkup"])))
        check("3b B cetak: D tampil sebagai <img>, tanpa markup SVG",
              prp["drawImgs"] and prp["drawSvgMarkup"] == 0, repr((prp["drawImgs"], prp["drawSvgMarkup"])))
        b.locator(sel_b + " [data-drawing-preview] img").first.scroll_into_view_if_needed()
        shot(b, "07_B_drawing_W_sebagai_img.png")
        check("3c B: __xss undefined setelah pratinjau drawing", xss(b) is None, repr(xss(b)))
        pv.goto(pub_url)
        pv.wait_for_load_state("load")
        hold(pv, 1500)
        pr2 = pv.evaluate(DOM_PROBE, "body")
        check("3d anon pub (N kini note W): D tampil sebagai <img data:image/svg+xml>, __xss undefined",
              pr2["drawImgs"] and all(s.startswith("data:image/svg+xml") for s in pr2["drawImgs"])
              and pr2["drawSvgMarkup"] == 0 and xss(pv) is None,
              repr((pr2["drawImgs"], pr2["drawSvgMarkup"], xss(pv))))
        pv.locator("[data-drawing-preview] img").first.scroll_into_view_if_needed()
        shot(pv, "08_anon_pub_note_W_drawing_img.png")

        # ── 4. Task W ber-payload → notifikasi B ──────────────────────────────────────
        t = api(base, A, "POST", "/api/tasks", json={"title": TASK_TITLE, "list_id": ws_id})

        def b_notif():
            rows = api(base, B, "GET", "/api/notifications")
            rows = rows.get("notifications", rows) if isinstance(rows, dict) else rows
            return [r for r in rows if r.get("task_id") == t["id"]]
        got = wait_until(b_notif, 20)
        check("4a server: notifikasi B tersimpan ter-escape", got and "&lt;img" in got[0]["message"]
              and "&amp; co" in got[0]["message"], repr(got and got[0]["message"]))
        reload_app(b, base)
        bell = b.locator("button[title='Notifikasi']:visible").first
        bell.click()
        panel_n = b.get_by_text("🔔 Notifikasi").locator("xpath=ancestor::div[@data-notif-panel][1]")
        panel_n.wait_for(timeout=10000)
        b.get_by_text("menambahkan task", exact=False).first.wait_for(timeout=15000)
        hold(b, 1500)
        txt = panel_n.inner_text()
        check("4b B panel notifikasi: __xss undefined", xss(b) is None, repr(xss(b)))
        check("4c B panel notifikasi: judul tampil sebagai teks dan berakhir '& co' (tanpa &amp;)",
              TASK_TITLE in txt and "& co" in txt and "&amp;" not in txt, repr(txt[:300]))
        check("4d B panel notifikasi: username A (< \" ') tampil sebagai teks", A["username"] in txt, repr(A["username"]))
        np = b.evaluate(DOM_PROBE, "div[data-notif-panel] > div:last-child")
        imgs = panel_n.locator("img").count()
        check("4e B panel notifikasi: tanpa <img>/atribut on* dari payload", imgs == 0 and not np["evAttr"],
              repr((imgs, np["evAttr"][:2])))
        shot(b, "09_B_panel_notifikasi.png")

        for c in (ctxP, ctxA, ctxB):
            c.close()
        browser.close()
    except Exception as e:
        for nm, pg in PAGES:
            try:
                shot(pg, "zz_exception_%s.png" % nm)
            except Exception:
                pass
        check("exception", False, "%s: %s" % (type(e).__name__, str(e).splitlines()[0] if str(e) else ""))
        import traceback
        traceback.print_exc(limit=3)
    finally:
        for rt in PW_RT:
            try:
                rt.stop()
            except Exception:
                pass
        proc.terminate()
        try:
            proc.wait(10)
        except subprocess.TimeoutExpired:
            proc.kill()
        print("server log:", os.path.join(tmp, "server.log"))

    failed = [r for r in results if not r[1]]
    print("\n%d langkah, %d gagal" % (len(results), len(failed)))
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
