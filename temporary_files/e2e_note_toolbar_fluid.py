"""E2E/pengukuran: toolbar editor note fluid (Task 2b, 2026-10-23). Tidak dijalankan CI.

Syarat (brief Task 2b): di lebar viewport 320, 360, 375, 414, 768, 820, 1024, 1280, pada kedua host toolbar
(NoteModal dan TaskFormModal mode Note), mode terang:
  - toolbar dan semua pembungkusnya tidak meluber horizontal (scrollWidth <= clientWidth + 1), tidak ada elemen
    toolbar yang rect.right > lebar viewport atau > tepi kanan pembungkus, dokumen tanpa scroll horizontal;
  - jumlah baris toolbar <= 2 (di 320 boleh 3 — dilaporkan WARN, bukan FAIL); NoteModal @1280 tepat 1 baris;
  - tombol "+" (Format lainnya) sudah dihapus; Numbered list, Strikethrough, Insert table, Wiki tampil langsung;
  - dropdown Heading dan Template tampil penuh: di dalam viewport, tidak terpotong
    pembungkus ber-overflow, dan elemen teratas di titik-titiknya adalah dropdown itu sendiri;
  - tombol berlabel yang labelnya disembunyikan tetap punya title dan aria-label.
Mode Kertas dinyalakan (kondisi terlebar: tombol Kertas + 2 select ukuran/orientasi), seperti screenshot Bapak.

Jumlah baris = jumlah kelompok nilai offsetTop anak langsung toolbar yang tampil (nilai berselisih <= 6 px
dianggap satu baris, karena align-items:center menggeser offsetTop item yang lebih pendek, mis. .sep).

    E2E_SERVER_PY=/home/claude/venv-alurik/bin/python python3 temporary_files/e2e_note_toolbar_fluid.py

Screenshot toolbar 375/768/1280 terang+gelap per host → temporary_files/e2e_note_toolbar_fluid/ (di-.gitignore).
Keluar non-zero bila ada FAIL.
"""
import os
import re
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import e2e_slash_menu_grid as G  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402

ROOT = G.ROOT
SHOTS = os.path.join(ROOT, "temporary_files", "e2e_note_toolbar_fluid")
WIDTHS = [320, 360, 375, 414, 768, 820, 1024, 1280]
SHOT_WIDTHS = (375, 768, 1280)
NOTE_TITLE = "Note Toolbar Fluid"
results = []
table = []


def check(step, ok, note=""):
    results.append((step, bool(ok)))
    print(("PASS " if ok else "FAIL ") + step + (" — " + str(note) if note else ""), flush=True)


MEASURE_JS = r"""() => {
  const POPS = ".tpl-dropdown, button[title='Heading'] + div";
  const tb = [...document.querySelectorAll('.note-toolbar')].find(e => e.getClientRects().length);
  if (!tb) return null;
  const vw = document.documentElement.clientWidth;
  const kids = [...tb.children].filter(c => c.getClientRects().length && getComputedStyle(c).display !== 'none');
  const tops = [...new Set(kids.map(c => c.offsetTop))].sort((a, b) => a - b);
  const rowsArr = [];
  for (const t of tops) { if (!rowsArr.length || t - rowsArr[rowsArr.length - 1] > 6) rowsArr.push(t); }
  const tbr = tb.getBoundingClientRect();
  const bad = [];
  const parent = tb.parentElement.getBoundingClientRect();
  for (const el of tb.querySelectorAll('*')) {
    if (!el.getClientRects().length) continue;
    if (el.matches(POPS + ', ' + POPS.split(', ').map(x => x + ' *').join(', '))) continue;  // dropdown diuji terpisah
    const r = el.getBoundingClientRect();
    if (r.width === 0) continue;
    if (r.right > vw + 0.5 || r.right > parent.right + 1 || r.left < -0.5) {
      bad.push((el.tagName + '.' + (el.className && el.className.baseVal === undefined ? el.className : '') + ' "' +
        ((el.innerText || el.title || '').trim().slice(0, 12)) + '" right=' + Math.round(r.right)));
    }
  }
  const anc = [];
  let a = tb;
  while (a && a !== document.documentElement) {
    if (a.scrollWidth > a.clientWidth + 1 && getComputedStyle(a).display !== 'inline') {
      anc.push((a === tb ? 'TOOLBAR ' : '') + a.tagName + '.' + String(a.className).slice(0, 40) +
        ' sw=' + a.scrollWidth + ' cw=' + a.clientWidth + ' ox=' + getComputedStyle(a).overflowX);
    }
    a = a.parentElement;
  }
  const labels = [...tb.querySelectorAll('button')].map(b => {
    const txt = (b.innerText || '').trim();
    return { txt, title: b.title || '', aria: b.getAttribute('aria-label') || '' };
  });
  return {
    vw, rows: rowsArr.length, tops, tbW: Math.round(tbr.width), sw: tb.scrollWidth, cw: tb.clientWidth,
    ox: getComputedStyle(tb).overflowX, wrap: getComputedStyle(tb).flexWrap, bad: bad.slice(0, 6), anc,
    docOverflow: document.documentElement.scrollWidth > window.innerWidth + 1 ? document.documentElement.scrollWidth : 0,
    labels,
  };
}"""

POP_JS = r"""(sel) => {
  // sel: selector dropdown terbuka di dalam toolbar
  const tb = [...document.querySelectorAll('.note-toolbar')].find(e => e.getClientRects().length);
  const pop = tb && tb.querySelector(sel);
  if (!pop) return { found: false };
  const r = pop.getBoundingClientRect();
  const vw = document.documentElement.clientWidth, vh = window.innerHeight;
  const inView = r.left >= -0.5 && r.right <= vw + 0.5 && r.top >= -0.5;
  const clippers = [];
  let a = pop.parentElement;
  while (a && a !== document.documentElement) {
    const cs = getComputedStyle(a);
    if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') {
      const ar = a.getBoundingClientRect();
      if (r.left < ar.left - 0.5 || r.right > ar.right + 0.5) clippers.push('x:' + a.tagName + '.' + String(a.className).slice(0, 30) + ' ox=' + cs.overflowX);
      if (r.top < ar.top - 0.5 || r.bottom > ar.bottom + 0.5) clippers.push('y:' + a.tagName + '.' + String(a.className).slice(0, 30) + ' oy=' + cs.overflowY);
    }
    a = a.parentElement;
  }
  // titik uji di dalam dropdown (yang masih di viewport): elemen teratas harus bagian dari dropdown
  const pts = [[r.left + 6, r.top + 6], [r.right - 6, r.top + 6], [(r.left + r.right) / 2, (r.top + r.bottom) / 2],
               [r.left + 6, Math.min(r.bottom, vh) - 6], [r.right - 6, Math.min(r.bottom, vh) - 6]];
  const covered = pts.filter(([x, y]) => { const e = document.elementFromPoint(x, y); return !(e && pop.contains(e)); }).length;
  return { found: true, inView, clippers, covered, rect: [Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom)], vw };
}"""


def measure(p):
    return p.evaluate(MEASURE_JS)


def click_title(p, title):
    """Klik tombol toolbar ber-title persis (pointerdown/mousedown dipicu oleh click Playwright)."""
    btn = p.locator('.note-toolbar button[title="%s"]' % title).filter(visible=True).first
    btn.click()
    p.wait_for_timeout(250)


def check_pop(p, host, w, name, open_title, sel):
    click_title(p, open_title)
    r = p.evaluate(POP_JS, sel)
    ok = r.get("found") and r["inView"] and not [c for c in r["clippers"] if c.startswith("x:")] and r["covered"] == 0
    ycl = [c for c in r.get("clippers", []) if c.startswith("y:")]
    check("%s@%d dropdown %s tampil penuh" % (host, w, name), ok,
          "rect=%s vw=%s clip=%s tertutup=%s" % (r.get("rect"), r.get("vw"), r.get("clippers"), r.get("covered")))
    if ycl and ok:
        print("  info: %s@%d %s melewati batas vertikal pembungkus scroll: %s" % (host, w, name, ycl), flush=True)
    # tutup: tombol pembuka adalah toggle
    if p.evaluate("(s) => !!document.querySelector('.note-toolbar ' + s)", sel):
        click_title(p, open_title)


def ensure_paper(p):
    """Nyalakan mode Kertas (lebar >768 saja; di HP .paper-controls disembunyikan)."""
    on = p.evaluate("() => !!document.querySelector('.note-toolbar select.paper-select')")
    if not on:
        click_title(p, "Mode Kertas")
        p.wait_for_function("() => !!document.querySelector('.note-toolbar select.paper-select')", timeout=5000)


def run_host(p, host):
    ensure_paper(p)
    for w in WIDTHS:
        p.set_viewport_size({"width": w, "height": 800})
        p.wait_for_timeout(450)
        m = measure(p)
        if not m:
            check("%s@%d toolbar ditemukan" % (host, w), False)
            continue
        over = bool(m["bad"] or m["anc"] or m["docOverflow"])
        table.append((host, w, m["rows"], m["tbW"], m["sw"], m["cw"], "YA" if over else "tidak"))
        print("  %s@%d rows=%d tops=%s tbW=%d sw=%d cw=%d ox=%s wrap=%s bad=%s anc=%s doc=%s" % (
            host, w, m["rows"], m["tops"], m["tbW"], m["sw"], m["cw"], m["ox"], m["wrap"], m["bad"], m["anc"],
            m["docOverflow"]), flush=True)
        check("%s@%d tanpa overflow (toolbar/pembungkus/viewport)" % (host, w), not over,
              "bad=%s anc=%s doc=%s" % (m["bad"], m["anc"], m["docOverflow"]))
        if w == 320:
            check("%s@%d baris <= 3" % (host, w), m["rows"] <= 3, m["rows"])
            if m["rows"] == 3:
                print("WARN %s@320 tiga baris" % host, flush=True)
        else:
            check("%s@%d baris <= 2" % (host, w), m["rows"] <= 2, m["rows"])
        if host == "NoteModal" and w == 1280:
            check("NoteModal@1280 tepat satu baris", m["rows"] == 1, m["rows"])
        hidden = [b for b in m["labels"] if not b["txt"]]
        miss = [b for b in hidden if not b["title"] or not b["aria"]]
        labelled_hidden = [b for b in m["labels"] if b["aria"] in ("Sketsa", "Media", "File", "Task", "Kertas", "Template", "Wiki")]
        check("%s@%d tombol berlabel: title + aria-label ada" % (host, w),
              all(b["title"] and b["aria"] for b in labelled_hidden) and len(labelled_hidden) >= 4,
              [(b["aria"], b["txt"] or "-") for b in labelled_hidden] or m["labels"])
        if miss:
            print("  info: tombol ikon-saja tanpa aria-label: %s" % [b["title"] for b in miss], flush=True)
        # dropdown
        if w == WIDTHS[0]:
            check("%s tombol + Format lainnya dihapus" % host, "Format lainnya" not in [b["title"] for b in m["labels"]])
        inline = [t for t in ("Numbered list", "Strikethrough", "Insert table", "Internal link [[wiki]]")
                  if t not in [b["title"] for b in m["labels"]]]
        check("%s@%d Numbered/Strike/Table/Wiki tampil langsung" % (host, w), not inline, inline)
        check_pop(p, host, w, "Heading", "Heading", "button[title='Heading'] + div")
        if host == "TaskFormModal":
            check_pop(p, host, w, "Template", "Terapkan template", ".tpl-dropdown")
        if w in SHOT_WIDTHS:
            for theme in ("light", "dark"):
                p.evaluate("(t) => document.documentElement.setAttribute('data-theme', t)", theme)
                p.wait_for_timeout(200)
                tb = p.locator(".note-toolbar").filter(visible=True).first
                box = tb.bounding_box()
                path = os.path.join(SHOTS, "%s-%d-%s.png" % (host, w, theme))
                p.screenshot(path=path, clip={"x": 0, "y": max(0, box["y"] - 40), "width": w,
                                              "height": min(800 - max(0, box["y"] - 40), box["height"] + 80)})
                print("  screenshot", os.path.relpath(path, ROOT), flush=True)
            p.evaluate("() => document.documentElement.setAttribute('data-theme', 'light')")


def main():
    os.makedirs(SHOTS, exist_ok=True)
    for f in os.listdir(SHOTS):
        if f.endswith(".png"):
            os.remove(os.path.join(SHOTS, f))
    tmp = tempfile.mkdtemp(prefix="e2e_note_toolbar_fluid_")
    proc, base = G.start_server(tmp)
    try:
        A = G.register(base, "Penulis")
        G.make_note(base, A, NOTE_TITLE, "Isi awal catatan untuk uji toolbar")
        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            ctx, p = G.open_app(browser, base, A)
            G.go_notes(p)
            G.card(p, NOTE_TITLE).wait_for(timeout=20000)
            G.open_editor(p, NOTE_TITLE)
            try:
                run_host(p, "NoteModal")
            except Exception as e:  # noqa: BLE001
                check("NoteModal (galat tak terduga)", False, "%s: %s" % (type(e).__name__, str(e).splitlines()[0][:300]))
            check("NoteModal tanpa pageerror", not p.errors, p.errors[:3])
            ctx.close()
            ctx, p = G.open_app(browser, base, A)
            try:
                p.get_by_role("button", name=re.compile("Buat Baru")).filter(visible=True).first.click()
                p.get_by_role("button", name=re.compile(r"^\s*Note\s*$")).first.click()
                p.wait_for_function("() => window.MilkdownBundle && document.querySelector('.ProseMirror[contenteditable=true]')",
                                    timeout=15000)
                p.wait_for_timeout(1500)
                run_host(p, "TaskFormModal")
            except Exception as e:  # noqa: BLE001
                check("TaskFormModal (galat tak terduga)", False, "%s: %s" % (type(e).__name__, str(e).splitlines()[0][:300]))
            check("TaskFormModal tanpa pageerror", not p.errors, p.errors[:3])
            ctx.close()
            browser.close()
    finally:
        proc.kill()
    print("\n| host | lebar | baris | lebar toolbar | scrollWidth | clientWidth | overflow |")
    print("|---|---|---|---|---|---|---|")
    for row in table:
        print("| %s | %d | %d | %d | %d | %d | %s |" % row)
    failed = [s for s, ok in results if not ok]
    print("\nRESULT %d/%d lulus" % (len(results) - len(failed), len(results)), flush=True)
    for s in failed:
        print("  GAGAL:", s, flush=True)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
