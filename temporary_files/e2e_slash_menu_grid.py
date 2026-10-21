"""E2E: slash menu editor note — grid 2 kolom + label grup + item Wikilink (2026-10-21). Tidak dijalankan CI.

Alur:
  a  ketik "/" di paragraf baru → menu tampil, 4 label grup, 15 item, ikon glyph svg (heading teks), grid 2 kolom, tanpa scroll (1280×800)
  b  screenshot terang + gelap; 375×740 → tanpa scroll, menu utuh di dalam viewport (dijepit middleware)
  c  klik Wikilink → "/" hilang, paragraf berisi "[[", dropdown autocomplete wikilink tampil
  d  "and/" → klik Wikilink → "and/" tetap ("/" di tengah teks bukan pemicu)
  k  emulasi keyboard HP (visualViewport 330px) → menu dibatasi + scroll di dalam, Wikilink bisa diklik
  f  Wikilink di dalam `kode` → "[[" tidak ikut mark code
  e  klik Task → "/" hilang, dropdown task tampil; klik Gambar → "/" hilang, modal Sisipkan Gambar tampil

    python temporary_files/e2e_slash_menu_grid.py
  (Playwright dari python sistem; server memakai venv/bin/python bila ada, atau E2E_SERVER_PY)
"""
import os
import re
import socket
import subprocess
import sys
import tempfile
import time
import uuid

import requests
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHOTS = os.path.join(ROOT, "temporary_files")
PW = "rahasia123"
SECRET = "e2e-slash-menu-grid-secret-0123456789abcdef"
TOURS = ['dashboard', 'tasks', 'today', 'calendar', 'kanban', 'notes', 'mindmap', 'chat', 'habits', 'habit',
         'settings', 'draw', 'goals', 'review', 'focus', 'workspace', 'slist']
SERVER_PY = os.environ.get("E2E_SERVER_PY") or (
    os.path.join(ROOT, "venv", "bin", "python") if os.path.exists(os.path.join(ROOT, "venv", "bin", "python"))
    else sys.executable)
results = []


def check(step, ok, note=""):
    results.append((step, bool(ok)))
    print(("PASS " if ok else "FAIL ") + step + (" — " + str(note) if note else ""), flush=True)


def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


def start_server(tmp):
    port = free_port()
    os.makedirs(os.path.join(tmp, "uploads"))
    env = dict(os.environ, DB_PATH=os.path.join(tmp, "e2e.db"), UPLOAD_DIR=os.path.join(tmp, "uploads"),
               MEDIA_ROOT=os.path.join(tmp, "media"), MEDIA_ACCEL="0", WEB_SECRET_KEY=SECRET,
               WEB_PORT=str(port), TELEGRAM_BOT_TOKEN="")
    log = open(os.path.join(tmp, "server.log"), "w")
    proc = subprocess.Popen([SERVER_PY, "-m", "uvicorn", "webapp:app", "--host", "127.0.0.1",
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


def make_note(base, user, title, content):
    r = requests.post(base + "/api/scratchpad", headers={"Authorization": "Bearer " + user["token"]},
                      json={"title": title, "content": content, "tags": [], "client_id": str(uuid.uuid4())})
    r.raise_for_status()
    return r.json()


def open_app(browser, base, user):
    ctx = browser.new_context(service_workers="block", viewport={"width": 1280, "height": 800})
    ctx.add_cookies([{"name": "token", "value": user["token"], "url": base, "httpOnly": True, "sameSite": "Lax"}])
    p = ctx.new_page()
    p.errors = []
    p.on("pageerror", lambda e: p.errors.append(str(e)))
    p.goto(base + "/manifest.json")
    p.evaluate("""([t, u, tours]) => {
        localStorage.setItem('tf_token', t); localStorage.setItem('tf_user_id', String(u));
        for (const pg of tours) localStorage.setItem('tf_tour_' + pg, '1');
        localStorage.setItem('tf_dismiss_onboarding', '1');
    }""", [user["token"], user["id"], TOURS])
    p.goto(base + "/")
    p.locator(".sidebar-link").first.wait_for(state="attached", timeout=30000)
    return ctx, p


def go_notes(p):
    link = p.locator(".sidebar-link").filter(has=p.locator("span", has_text=re.compile("^Notes$")))
    if link.count() == 0 or not link.first.is_visible():
        ex = p.locator("button[aria-label='Tampilkan semua menu']")
        if ex.count() and ex.first.is_visible():
            ex.first.click()
    link.first.click()


def card(p, title):
    return p.locator(".note-card").filter(has=p.locator(".note-card-title", has_text=title)).first


def open_editor(p, title):
    card(p, title).click()
    p.locator(".notes-panel-actions").first.wait_for(timeout=15000)
    p.locator(".notes-panel-actions").first.get_by_text("Edit", exact=True).click()
    p.locator(".ProseMirror").first.wait_for(timeout=15000)
    p.wait_for_function("() => window.MilkdownBundle && document.querySelector('.ProseMirror[contenteditable=true]')",
                        timeout=15000)
    p.wait_for_timeout(2500)


MENU = ".milkdown-slash-menu[data-show='true']"

CUR_BLOCK_JS = """() => {
  const s = getSelection(); if (!s || !s.anchorNode) return null;
  const n = s.anchorNode; const el = n.nodeType === 3 ? n.parentElement : n;
  const b = el && el.closest('p,h1,h2,h3,li,blockquote');
  return b ? b.innerText : null;
}"""


def new_line_and(p, text):
    pm = p.locator(".ProseMirror").first
    pm.click()
    p.keyboard.press("Control+End")
    p.keyboard.press("Enter")
    p.keyboard.type(text, delay=40)


def open_menu(p, prefix=""):
    new_line_and(p, prefix + "/")
    p.locator(MENU).wait_for(timeout=5000)


def menu_metrics(p):
    return p.evaluate("""() => {
      const m = document.querySelector(".milkdown-slash-menu[data-show='true']");
      const r = m.getBoundingClientRect();
      const g = m.querySelector('.milkdown-slash-grid');
      const it = g.querySelectorAll('.milkdown-slash-item');
      const wl = [...m.querySelectorAll('.milkdown-slash-item')].find(e => e.textContent.includes('Wikilink'));
      return {
        sh: m.scrollHeight, ch: m.clientHeight,
        labels: [...m.querySelectorAll('.milkdown-slash-group-label')].map(e => e.textContent),
        items: [...m.querySelectorAll('.milkdown-slash-item .milkdown-slash-label')].map(e => e.textContent),
        row1Top: [it[0].offsetTop, it[1].offsetTop], row1Left: [it[0].offsetLeft, it[1].offsetLeft],
        wlWide: wl && wl.classList.contains('is-wide'), wlW: wl && wl.offsetWidth, gW: g.offsetWidth,
        hint: wl && (wl.querySelector('.milkdown-slash-hint') || {}).textContent,
        left: r.left, right: r.right, top: r.top, bottom: r.bottom, vw: innerWidth, vh: innerHeight,
      };
    }""")


def click_item(p, label):
    p.locator(MENU + " .milkdown-slash-item").filter(
        has=p.locator(".milkdown-slash-label", has_text=re.compile("^" + re.escape(label) + "$"))).first.click()


def wiki_dropdown_visible(p):
    loc = p.locator(".wiki-autocomplete").filter(has_text=re.compile(r"\[\[|Belum ada catatan|Tidak ditemukan"))
    try:
        loc.first.wait_for(state="visible", timeout=4000)
        return True, loc.first.inner_text()
    except Exception:
        return False, ""


EXPECTED_ITEMS = ["Heading 1", "Heading 2", "Heading 3", "Blockquote", "Callout", "Toggle", "Code",
                  "Bullet", "Numbered", "Checklist", "Tabel", "Divider", "Gambar", "Task", "Wikilink"]


def main():
    tmp = tempfile.mkdtemp(prefix="e2e_slash_menu_grid_")
    proc, base = start_server(tmp)
    try:
        A = register(base, "Penulis")
        make_note(base, A, "Catatan Tujuan", "Isi target")
        make_note(base, A, "Note Slash E2E", "Isi awal catatan")
        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            ctx, p = open_app(browser, base, A)
            go_notes(p)
            card(p, "Note Slash E2E").wait_for(timeout=20000)
            open_editor(p, "Note Slash E2E")

            # a: menu desktop
            open_menu(p)
            m = menu_metrics(p)
            check("a1 4 label grup berurutan", m["labels"] == ["Teks", "Daftar", "Sisipkan", "Tautan"], m["labels"])
            check("a2 15 item sesuai urutan", m["items"] == EXPECTED_ITEMS, m["items"])
            ic = p.evaluate("""() => [...document.querySelectorAll(".milkdown-slash-menu[data-show='true'] .milkdown-slash-item")].map(el => {
              const i = el.querySelector('.milkdown-slash-icon'); const svg = i.querySelector('svg');
              const r = svg ? svg.getBoundingClientRect() : null;
              return { label: el.querySelector('.milkdown-slash-label').textContent, text: i.textContent,
                       svg: !!svg, ns: svg ? svg.namespaceURI : null, shapes: svg ? svg.querySelectorAll('path,rect,circle').length : 0,
                       w: r ? Math.round(r.width) : 0, emoji: /\p{Extended_Pictographic}/u.test(el.textContent) };
            })""")
            heads = [x for x in ic if x["label"].startswith("Heading")]
            others = [x for x in ic if not x["label"].startswith("Heading")]
            check("a2b heading tetap ikon teks H1–H3 tanpa svg", [x["text"] for x in heads] == ["H1", "H2", "H3"] and not any(x["svg"] for x in heads),
                  [(x["text"], x["svg"]) for x in heads])
            check("a2c 12 item lain berisi svg glyph (namespace SVG, ada bentuk, 16px) tanpa teks ikon",
                  len(others) == 12 and all(x["svg"] and x["ns"] == "http://www.w3.org/2000/svg" and x["shapes"] > 0 and x["w"] == 16 and x["text"] == "" for x in others),
                  [(x["label"], x["svg"], x["shapes"], x["w"], x["text"]) for x in others if not (x["svg"] and x["shapes"] and x["w"] == 16 and x["text"] == "")])
            check("a2d tanpa emoji di item menu", not any(x["emoji"] for x in ic), [x["label"] for x in ic if x["emoji"]])
            check("a3 grid 2 kolom (baris 1 sejajar)", m["row1Top"][0] == m["row1Top"][1] and m["row1Left"][1] > m["row1Left"][0],
                  (m["row1Top"], m["row1Left"]))
            check("a4 tanpa scroll 1280×800", m["sh"] <= m["ch"], (m["sh"], m["ch"]))
            check("a4b menu utuh di viewport 1280×800", m["left"] >= 0 and m["right"] <= m["vw"] and m["top"] >= 0 and m["bottom"] <= m["vh"],
                  (m["left"], m["right"], m["top"], m["bottom"]))
            check("a5 Wikilink lebar penuh + hint [[ ]]", m["wlWide"] and m["wlW"] == m["gW"] and m["hint"] == "[[ ]]",
                  (m["wlW"], m["gW"], m["hint"]))
            title_attr = p.locator(MENU + " .milkdown-slash-item[title='Tugas / Task (/task, /tasks)']").count()
            check("a6 title deskriptif ada (Task)", title_attr == 1)
            check("a7 listbox punya aria-label", p.locator(MENU).get_attribute("aria-label") == "Sisipkan blok")

            # b: screenshot terang + gelap, lalu 375 px
            p.screenshot(path=os.path.join(SHOTS, "e2e_slash_menu_light.png"))
            p.evaluate("() => document.documentElement.setAttribute('data-theme', 'dark')")
            p.wait_for_timeout(200)
            p.screenshot(path=os.path.join(SHOTS, "e2e_slash_menu_dark.png"))
            p.evaluate("() => document.documentElement.setAttribute('data-theme', 'light')")
            p.keyboard.press("Backspace")  # hapus "/" → menu tertutup
            p.wait_for_timeout(200)
            check("b1 menu tertutup setelah '/' dihapus", p.locator(MENU).count() == 0)

            p.set_viewport_size({"width": 375, "height": 740})
            p.wait_for_timeout(500)
            open_menu(p)
            p.wait_for_timeout(200)
            m = menu_metrics(p)
            check("b2 tanpa scroll 375×740", m["sh"] <= m["ch"], (m["sh"], m["ch"]))
            check("b3 menu di dalam viewport horizontal", m["left"] >= 0 and m["right"] <= m["vw"], (m["left"], m["right"], m["vw"]))
            check("b3b menu di dalam viewport vertikal (Wikilink terlihat)", m["top"] >= 0 and m["bottom"] <= m["vh"], (m["top"], m["bottom"], m["vh"]))
            check("b4 grid 2 kolom di 375 px", m["row1Top"][0] == m["row1Top"][1], m["row1Top"])
            p.screenshot(path=os.path.join(SHOTS, "e2e_slash_menu_375_light.png"))
            p.evaluate("() => document.documentElement.setAttribute('data-theme', 'dark')")
            p.wait_for_timeout(200)
            p.screenshot(path=os.path.join(SHOTS, "e2e_slash_menu_375_dark.png"))
            p.evaluate("() => document.documentElement.setAttribute('data-theme', 'light')")
            p.keyboard.press("Backspace")
            p.wait_for_timeout(300)

            # k: keyboard HP terbuka — emulasi visualViewport setinggi 330px (layout tetap 375×740)
            p.evaluate("""() => {
              const fake = { width: 375, height: 330, offsetTop: 0, offsetLeft: 0, scale: 1,
                get pageTop() { return window.scrollY; }, get pageLeft() { return window.scrollX; },
                addEventListener() {}, removeEventListener() {} };
              Object.defineProperty(window, 'visualViewport', { value: fake, configurable: true });
            }""")
            check("k0 emulasi visualViewport aktif", p.evaluate("() => window.visualViewport.height") == 330)
            open_menu(p)
            p.wait_for_timeout(300)
            k = p.evaluate("""() => {
              const m = document.querySelector(".milkdown-slash-menu[data-show='true']");
              const r = m.getBoundingClientRect();
              const wl = [...m.querySelectorAll('.milkdown-slash-item')].find(e => e.textContent.includes('Wikilink'));
              const before = wl.getBoundingClientRect().bottom;
              wl.scrollIntoView({ block: 'nearest' });
              const w = wl.getBoundingClientRect();
              return { top: r.top, bottom: r.bottom, sh: m.scrollHeight, ch: m.clientHeight, mh: m.style.maxHeight,
                       wlBefore: before, wlTop: w.top, wlBottom: w.bottom, st: m.scrollTop };
            }""")
            check("k1 menu utuh di area terlihat 330px", k["top"] >= 0 and k["bottom"] <= 330, (k["top"], k["bottom"], k["mh"]))
            check("k2 menu bisa di-scroll di dalam (max-height dibatasi)", k["sh"] > k["ch"] and k["mh"] == "314px", (k["sh"], k["ch"], k["mh"]))
            check("k3 Wikilink awalnya di bawah area terlihat, setelah scroll menu terlihat",
                  k["wlBefore"] > 330 and k["st"] > 0 and k["wlTop"] >= k["top"] and k["wlBottom"] <= min(k["bottom"], 330),
                  (k["wlBefore"], k["st"], k["wlTop"], k["wlBottom"]))
            p.screenshot(path=os.path.join(SHOTS, "e2e_slash_menu_375_keyboard.png"))
            click_item(p, "Wikilink")
            p.wait_for_timeout(300)
            blk = p.evaluate(CUR_BLOCK_JS)
            check("k4 klik Wikilink (keyboard) → '[[' disisipkan", blk is not None and blk.strip() == "[[", repr(blk))
            p.keyboard.press("Escape")
            p.keyboard.press("Backspace")
            p.keyboard.press("Backspace")
            p.evaluate("() => { delete window.visualViewport; }")
            p.wait_for_timeout(400)
            open_menu(p)
            p.wait_for_timeout(300)
            mh = p.evaluate("() => document.querySelector(\".milkdown-slash-menu[data-show='true']\").style.maxHeight")
            check("k5 keyboard tertutup → max-height inline dikosongkan", mh == "", repr(mh))
            p.keyboard.press("Backspace")
            p.set_viewport_size({"width": 1280, "height": 800})
            p.wait_for_timeout(500)

            # c: Wikilink
            open_menu(p)
            click_item(p, "Wikilink")
            p.wait_for_timeout(300)
            blk = p.evaluate(CUR_BLOCK_JS)
            check("c1 '/' hilang, paragraf berisi '[['", blk is not None and blk.strip() == "[[", repr(blk))
            check("c2 menu slash tertutup", p.locator(MENU).count() == 0)
            ok, txt = wiki_dropdown_visible(p)
            check("c3 dropdown autocomplete wikilink tampil", ok, txt.replace("\n", " | "))
            check("c4 dropdown memuat 'Catatan Tujuan'", "Catatan Tujuan" in txt, txt.replace("\n", " | "))
            p.keyboard.type("Catatan Tu", delay=40)
            p.wait_for_timeout(500)
            ok2, txt2 = wiki_dropdown_visible(p)
            check("c5 mengetik query memfilter dropdown", ok2 and "Catatan Tujuan" in txt2, txt2.replace("\n", " | "))
            p.keyboard.press("Enter")  # pilih saran pertama → wikilink jadi
            p.wait_for_timeout(500)
            blk = p.evaluate(CUR_BLOCK_JS)
            check("c6 Enter menyisipkan wikilink 'Catatan Tujuan'", blk is not None and "Catatan Tujuan" in blk and "[[Catatan Tu" not in blk.replace("[[Catatan Tujuan]]", ""), repr(blk))
            check("c7 dropdown wikilink tertutup", p.locator(".wiki-autocomplete").count() == 0)

            # d: "and/" — "/" di tengah teks tetap
            open_menu(p, "and")
            click_item(p, "Wikilink")
            p.wait_for_timeout(300)
            blk = p.evaluate(CUR_BLOCK_JS)
            check("d1 'and/' dipertahankan lalu '[[' disisipkan", blk is not None and blk.strip() == "and/[[", repr(blk))
            p.keyboard.press("Escape")
            p.keyboard.press("Backspace")
            p.keyboard.press("Backspace")  # buang "[[" agar dropdown wikilink tidak aktif di langkah berikut
            p.wait_for_timeout(400)
            check("d2 dropdown wikilink tertutup setelah '[[' dihapus", p.locator(".wiki-autocomplete").count() == 0)

            # f: Wikilink di dalam `kode` tidak mewarisi mark inline code
            new_line_and(p, "`kode x`")
            p.wait_for_timeout(300)
            p.keyboard.press("ArrowLeft")  # kursor di dalam span kode, sebelum "x" (sesudah spasi)
            p.keyboard.type("/", delay=40)
            p.wait_for_timeout(300)
            code_before = p.evaluate("() => [...document.querySelectorAll('.ProseMirror code')].map(e => e.textContent)")
            shown = p.locator(MENU).count() > 0
            if shown and any("/" in t for t in code_before):
                click_item(p, "Wikilink")
                p.wait_for_timeout(400)
                code_txt = p.evaluate("() => [...document.querySelectorAll('.ProseMirror code')].map(e => e.textContent)")
                blk = p.evaluate(CUR_BLOCK_JS)
                check("f1 '[[' di dalam kode tidak ikut mark code", blk is not None and "[[" in blk and not any("[[" in t for t in code_txt),
                      (repr(blk), code_before, code_txt))
                ok, txt = wiki_dropdown_visible(p)
                check("f2 dropdown wikilink tampil", ok, txt.replace("\n", " | "))
                p.keyboard.press("Escape")
                p.keyboard.press("Backspace")
                p.keyboard.press("Backspace")
                p.wait_for_timeout(400)
                check("f3 dropdown wikilink tertutup", p.locator(".wiki-autocomplete").count() == 0)
            else:
                print("SKIP f menu slash tidak tampil di dalam inline code", shown, code_before, flush=True)
                if shown:
                    p.keyboard.press("Backspace")
            p.keyboard.press("End")

            # e: Task + Gambar
            open_menu(p)
            click_item(p, "Task")
            p.wait_for_timeout(400)
            blk = p.evaluate(CUR_BLOCK_JS)
            check("e1 Task: '/' hilang", blk is not None and "/" not in blk, repr(blk))
            task_dd = p.locator(".wiki-autocomplete").filter(has_not_text=re.compile(r"\[\["))
            check("e2 Task: dropdown task tampil", task_dd.count() > 0 and task_dd.first.is_visible())
            p.keyboard.press("Escape")
            p.wait_for_timeout(200)

            open_menu(p)
            click_item(p, "Gambar")
            p.wait_for_timeout(400)
            blk = p.evaluate(CUR_BLOCK_JS)
            modal = p.get_by_text("🎨 Sisipkan Gambar")
            check("e3 Gambar: modal Sisipkan Gambar tampil", modal.count() > 0 and modal.first.is_visible())
            stray = p.evaluate("() => [...document.querySelectorAll('.ProseMirror p')].filter(e => e.innerText.trim() === '/').length")
            check("e4 Gambar: '/' hilang (tak ada paragraf berisi '/')", stray == 0, stray)
            if modal.count():
                p.locator(".modal-content").filter(has_text="Sisipkan Gambar").locator("button", has_text="✕").first.click()

            check("z tanpa pageerror", not p.errors, p.errors[:3])
            browser.close()
    finally:
        proc.kill()
    failed = [s for s, ok in results if not ok]
    print("\n%d/%d lulus" % (len(results) - len(failed), len(results)))
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
