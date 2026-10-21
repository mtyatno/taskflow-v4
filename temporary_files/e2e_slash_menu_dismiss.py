"""E2E: slash menu editor note — tutup dengan Esc / klik di luar (2026-10-21). Tidak dijalankan CI.

Alur (desktop 1280×800):
  a  "+" → Esc → menu tertutup, "/" sisipan "+" hilang, kursor di paragraf kosong, editor tetap fokus,
     note tetap terbuka, Escape tidak sampai ke listener window (stopPropagation)
  b  "+" → klik teks lain di editor → tertutup, "/" hilang
  c  "+" → klik area kosong di luar editor (latar halaman note) → tertutup, "/" hilang
  d  "+" → klik area kosong toolbar note → tertutup, "/" hilang
  e  ketik "/" → Esc → tertutup, "/" tetap, menu tidak muncul lagi (lewat debounce); ketik → normal lagi
  f  ketik "/" → klik di luar → tertutup, "/" tetap, tidak muncul lagi
  g  item tetap bisa diklik setelah semua itu ("+" → Heading 1; ketik "/" → Divider); scroll roda di menu tidak menutup
  h  "+" dua kali (menu "+" pertama masih terbuka) → hanya satu "/" tersisa
  i  keluar dari mode edit → listener pointerdown document dilepas (destroy)
Touch 375×740 (has_touch, is_mobile):
  t  ketuk paragraf → ketuk "+" → menu tampil → ketuk di luar → tertutup, "/" hilang;
     ketuk "+" lagi → ketuk teks lain di editor → tertutup, "/" hilang

    PYTHONPATH=<pyextra2> python3 temporary_files/e2e_slash_menu_dismiss.py
  (Playwright dari python sistem; server memakai venv/bin/python bila ada, atau E2E_SERVER_PY)
"""
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import e2e_slash_menu_grid as G  # noqa: E402  (start_server, register, make_note, open_app, ...)
from playwright.sync_api import sync_playwright  # noqa: E402

MENU = G.MENU
results = []


def check(step, ok, note=""):
    results.append((step, bool(ok)))
    print(("PASS " if ok else "FAIL ") + step + (" — " + str(note) if note else ""), flush=True)


# Lacak listener pointerdown capture di document (nama fungsi) untuk memeriksa cleanup destroy
TRACK_JS = """(() => {
  const live = new Map();
  window.__slashListeners = () => [...live.values()].filter(n => n === 'onSlashOutsidePointer').length;
  const add = Document.prototype.addEventListener, rem = Document.prototype.removeEventListener;
  const key = (t, f, c) => t + '|' + (c === true || (c && c.capture) ? 1 : 0) + '|' + (f && f.__id || (f.__id = Math.random()));
  Document.prototype.addEventListener = function (t, f, c) { if (t === 'pointerdown' && f) live.set(key(t, f, c), f.name); return add.call(this, t, f, c); };
  Document.prototype.removeEventListener = function (t, f, c) { if (t === 'pointerdown' && f) live.delete(key(t, f, c)); return rem.call(this, t, f, c); };
  window.__escSeen = 0;
  window.addEventListener('keydown', e => { if (e.key === 'Escape') window.__escSeen++; });
})()"""

STATE_JS = """() => {
  const s = getSelection(); const n = s && s.anchorNode;
  const el = n ? (n.nodeType === 3 ? n.parentElement : n) : null;
  const b = el && el.closest('p,h1,h2,h3,li,blockquote');
  return {
    menu: !!document.querySelector(".milkdown-slash-menu[data-show='true']"),
    slashParas: [...document.querySelectorAll('.ProseMirror p')].filter(e => e.innerText.trim() === '/').length,
    texts: [...document.querySelectorAll('.ProseMirror > *')].map(e => e.innerText.trim()),
    focused: !!document.querySelector('.ProseMirror.ProseMirror-focused') && document.activeElement && document.activeElement.classList.contains('ProseMirror'),
    block: b ? b.innerText.replace(/\\n/g, '') : null, blockTag: b ? b.tagName : null,
  };
}"""

# Titik kosong (bukan tombol/input/tautan) di dalam elemen selector; elementFromPoint harus di dalamnya
SPOT_JS = """(sel) => {
  const root = document.querySelector(sel); if (!root) return null;
  const r = root.getBoundingClientRect();
  for (let y = r.top + 4; y < Math.min(r.bottom, innerHeight) - 2; y += 6) {
    for (let x = r.right - 6; x > r.left + 4; x -= 8) {
      const e = document.elementFromPoint(x, y);
      if (!e || !root.contains(e)) continue;
      if (e.closest('button,a,input,select,textarea,[role=button],.ProseMirror,.milkdown-slash-menu,label')) continue;
      return { x, y, tag: e.tagName, cls: String(e.className).slice(0, 40) };
    }
  }
  return null;
}"""


def st(p):
    return p.evaluate(STATE_JS)


def plus(p, idx=0):
    para = p.locator(".ProseMirror > p").nth(idx)
    para.hover()
    p.wait_for_timeout(350)
    p.locator(".milkdown-block-handle-add").first.click()
    p.locator(MENU).wait_for(timeout=4000)
    p.wait_for_timeout(150)


def click_spot(p, sel):
    spot = p.evaluate(SPOT_JS, sel)
    if not spot:
        return None
    p.mouse.click(spot["x"], spot["y"])
    p.wait_for_timeout(450)
    return spot


def main():
    tmp = tempfile.mkdtemp(prefix="e2e_slash_menu_dismiss_")
    proc, base = G.start_server(tmp)
    try:
        A = G.register(base, "Penulis")
        G.make_note(base, A, "Note Dismiss E2E", "Isi awal catatan\n\nParagraf kedua")
        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            ctx, p = G.open_app(browser, base, A)
            p.add_init_script(TRACK_JS)
            p.reload()
            p.locator(".sidebar-link").first.wait_for(state="attached", timeout=30000)
            G.go_notes(p)
            G.card(p, "Note Dismiss E2E").wait_for(timeout=20000)
            G.open_editor(p, "Note Dismiss E2E")
            check("0 listener pointerdown slash terpasang (1)", p.evaluate("() => window.__slashListeners()") == 1,
                  p.evaluate("() => window.__slashListeners()"))

            # a: "+" → Esc
            plus(p)
            s0 = st(p)
            check("a0 '+' membuka menu dengan '/' di paragraf baru", s0["menu"] and s0["slashParas"] == 1, s0)
            esc0 = p.evaluate("() => window.__escSeen")
            p.keyboard.press("Escape")
            p.wait_for_timeout(500)
            s = st(p)
            check("a1 Esc → menu tertutup", not s["menu"], s)
            check("a2 Esc → '/' sisipan '+' hilang", s["slashParas"] == 0, s["texts"])
            check("a3 kursor di paragraf kosong, editor fokus", s["focused"] and s["blockTag"] == "P" and s["block"] == "", s)
            check("a4 note tetap terbuka (editor masih ada)", p.locator(".ProseMirror[contenteditable=true]").count() == 1)
            check("a5 Escape tidak diteruskan ke listener window", p.evaluate("() => window.__escSeen") == esc0)
            p.wait_for_timeout(400)
            check("a6 menu tetap tertutup setelah debounce", not st(p)["menu"])
            p.keyboard.type("abc", delay=30)
            p.wait_for_timeout(300)
            check("a7 mengetik di paragraf itu normal", st(p)["block"] == "abc" and not st(p)["menu"], st(p))

            # b: "+" → klik teks lain di editor
            plus(p)
            p.locator(".ProseMirror > p").first.click()
            p.wait_for_timeout(500)
            s = st(p)
            check("b1 klik teks editor → menu tertutup", not s["menu"], s)
            check("b2 klik teks editor → '/' hilang", s["slashParas"] == 0, s["texts"])
            check("b3 kursor pindah ke paragraf yang diklik", s["block"] == "Isi awal catatan", s["block"])

            # c: "+" → klik latar halaman note di luar editor
            plus(p)
            spot = click_spot(p, ".paper-mode-active") or click_spot(p, ".main-content")
            s = st(p)
            check("c0 titik kosong di luar editor ditemukan", spot is not None, spot)
            check("c1 klik di luar editor → menu tertutup", not s["menu"], s)
            check("c2 klik di luar editor → '/' hilang", s["slashParas"] == 0, s["texts"])
            check("c3 note tetap terbuka", p.locator(".ProseMirror[contenteditable=true]").count() == 1)

            # d: "+" → klik area kosong toolbar note
            plus(p)
            spot = click_spot(p, ".note-toolbar")
            s = st(p)
            check("d0 titik kosong toolbar ditemukan", spot is not None, spot)
            check("d1 klik toolbar → menu tertutup", not s["menu"], s)
            check("d2 klik toolbar → '/' hilang", s["slashParas"] == 0, s["texts"])

            # e: ketik "/" → Esc
            G.new_line_and(p, "/")
            p.locator(MENU).wait_for(timeout=4000)
            esc0 = p.evaluate("() => window.__escSeen")
            p.keyboard.press("Escape")
            p.wait_for_timeout(700)
            s = st(p)
            check("e1 Esc (ketik '/') → menu tertutup", not s["menu"], s)
            check("e2 '/' ketikan pengguna tetap", s["block"] == "/" and s["slashParas"] == 1, s)
            check("e3 Escape tidak diteruskan ke window", p.evaluate("() => window.__escSeen") == esc0)
            p.keyboard.press("Escape")  # menu sudah tertutup → Esc biasa (diteruskan)
            p.wait_for_timeout(300)
            check("e4 Esc kedua tidak memunculkan menu", not st(p)["menu"])
            check("e5 Esc kedua (tanpa menu) diteruskan seperti biasa", p.evaluate("() => window.__escSeen") == esc0 + 1)
            p.keyboard.type("x", delay=30)
            p.wait_for_timeout(400)
            check("e6 ketik setelah '/' → menu tetap tertutup, teks '/x'", not st(p)["menu"] and st(p)["block"] == "/x", st(p))
            p.keyboard.press("Backspace")
            p.wait_for_timeout(500)
            check("e7 hapus 'x' → kembali setelah '/' → menu muncul lagi (normal)", st(p)["menu"], st(p))
            p.keyboard.press("Backspace")
            p.wait_for_timeout(400)

            # f: ketik "/" → klik di luar
            G.new_line_and(p, "/")
            p.locator(MENU).wait_for(timeout=4000)
            click_spot(p, ".paper-mode-active") or click_spot(p, ".main-content")
            p.wait_for_timeout(400)
            s = st(p)
            check("f1 klik di luar (ketik '/') → menu tertutup", not s["menu"], s)
            check("f2 '/' ketikan pengguna tetap", s["slashParas"] == 1, s["texts"])
            # bersihkan "/" itu
            p.locator(".ProseMirror > p").filter(has_text="/").last.click()
            p.keyboard.press("End")
            p.wait_for_timeout(300)
            if st(p)["menu"]:
                p.keyboard.press("Escape")
            p.keyboard.press("Backspace")
            p.wait_for_timeout(300)
            check("f3 '/' dibersihkan", st(p)["slashParas"] == 0, st(p)["texts"])

            # g: item tetap berfungsi + scroll roda di dalam menu
            plus(p)
            box = p.locator(MENU).bounding_box()
            p.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
            p.mouse.wheel(0, 120)
            p.wait_for_timeout(400)
            check("g0 scroll roda di dalam menu tidak menutup", st(p)["menu"])
            G.click_item(p, "Heading 1")
            p.wait_for_timeout(400)
            s = st(p)
            check("g1 '+' → klik Heading 1 → '/' hilang, blok jadi H1", s["slashParas"] == 0 and s["blockTag"] == "H1" and not s["menu"], s)
            p.keyboard.type("Judul", delay=30)
            G.new_line_and(p, "/")
            p.locator(MENU).wait_for(timeout=4000)
            G.click_item(p, "Divider")
            p.wait_for_timeout(400)
            s = st(p)
            check("g2 ketik '/' → klik Divider → hr disisipkan, '/' hilang",
                  p.locator(".ProseMirror hr").count() >= 1 and s["slashParas"] == 0 and not s["menu"], s["texts"])

            # h: "+" dua kali
            plus(p, 0)
            plus(p, 1)
            s = st(p)
            check("h1 '+' kedua saat menu '+' pertama terbuka → hanya satu '/'", s["menu"] and s["slashParas"] == 1, s["texts"])
            p.keyboard.press("Escape")
            p.wait_for_timeout(400)
            check("h2 Esc → '/' hilang", st(p)["slashParas"] == 0, st(p)["texts"])

            check("i0 listener masih satu sebelum keluar edit", p.evaluate("() => window.__slashListeners()") == 1)
            # i: keluar mode edit → editor dihancurkan
            saved = p.locator("button", has_text="Simpan")
            if saved.count() and saved.first.is_visible():
                saved.first.click()
            else:
                p.keyboard.press("Control+s")
            p.wait_for_timeout(1500)
            n_editors = p.locator(".ProseMirror[contenteditable=true]").count()
            lst = p.evaluate("() => window.__slashListeners()")
            check("i1 keluar mode edit → listener pointerdown slash dilepas", n_editors == 0 and lst == 0, (n_editors, lst))

            check("z tanpa pageerror (desktop)", not p.errors, p.errors[:3])
            ctx.close()

            # t: touch 375 px
            # navigasi di 1280 (tautan Notes sidebar), lalu editor diuji di 375×740
            tctx = browser.new_context(service_workers="block", viewport={"width": 1280, "height": 800},
                                       has_touch=True, is_mobile=True)
            tctx.add_cookies([{"name": "token", "value": A["token"], "url": base, "httpOnly": True, "sameSite": "Lax"}])
            tp = tctx.new_page()
            tp.errors = []
            tp.on("pageerror", lambda e: tp.errors.append(str(e)))
            tp.goto(base + "/manifest.json")
            tp.evaluate("""([t, u, tours]) => {
                localStorage.setItem('tf_token', t); localStorage.setItem('tf_user_id', String(u));
                for (const pg of tours) localStorage.setItem('tf_tour_' + pg, '1');
                localStorage.setItem('tf_dismiss_onboarding', '1');
            }""", [A["token"], A["id"], G.TOURS])
            tp.goto(base + "/")
            tp.locator(".sidebar-link").first.wait_for(state="attached", timeout=30000)
            check("t0 emulasi touch (hover: none)", tp.evaluate("() => matchMedia('(hover: none)').matches"))
            G.go_notes(tp)
            G.card(tp, "Note Dismiss E2E").wait_for(timeout=20000)
            G.card(tp, "Note Dismiss E2E").tap()
            tp.locator(".notes-panel-actions").first.wait_for(timeout=15000)
            tp.locator(".notes-panel-actions").first.get_by_text("Edit", exact=True).tap()
            tp.wait_for_function("() => window.MilkdownBundle && document.querySelector('.ProseMirror[contenteditable=true]')", timeout=15000)
            tp.wait_for_timeout(2500)
            tp.set_viewport_size({"width": 375, "height": 740})
            tp.wait_for_timeout(800)
            tp.locator(".ProseMirror > p").first.tap()
            tp.wait_for_timeout(500)
            add = tp.locator(".milkdown-block-handle-add").first
            add.wait_for(state="visible", timeout=4000)
            add.tap()
            tp.wait_for_timeout(600)
            s = st(tp)
            check("t1 ketuk '+' → menu tampil dengan '/'", s["menu"] and s["slashParas"] == 1, s)
            spot = tp.evaluate(SPOT_JS, ".paper-mode-active") or tp.evaluate(SPOT_JS, ".main-content")
            tp.mouse.click(5, 5) if not spot else tp.touchscreen.tap(spot["x"], spot["y"])
            tp.wait_for_timeout(600)
            s = st(tp)
            check("t2 ketuk di luar → menu tertutup", not s["menu"], (spot, s))
            check("t3 ketuk di luar → '/' hilang", s["slashParas"] == 0, s["texts"])
            tp.locator(".ProseMirror > p").first.tap()
            tp.wait_for_timeout(500)
            add.wait_for(state="visible", timeout=4000)
            add.tap()
            tp.wait_for_timeout(600)
            check("t4 ketuk '+' lagi → menu tampil", st(tp)["menu"] and st(tp)["slashParas"] == 1, st(tp))
            # (di 375 px menu menutupi paragraf di bawahnya → ketuk paragraf di atas)
            tp.locator(".ProseMirror > p", has_text="Isi awal catatan").first.tap()
            tp.wait_for_timeout(600)
            s = st(tp)
            check("t5 ketuk teks lain di editor → tertutup, '/' hilang", not s["menu"] and s["slashParas"] == 0, s)
            check("z tanpa pageerror (touch)", not tp.errors, tp.errors[:3])
            browser.close()
    finally:
        proc.kill()
    failed = [s for s, ok in results if not ok]
    print("\n%d/%d lulus" % (len(results) - len(failed), len(results)))
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
