"""E2E baris task halaman Fokus di HP: ⭐ / Fokus / chevron satu kolom vertikal (Bapak 2026-10-23). Tidak dijalankan CI.

Skenario (terang + gelap):
- 375 px & 640 px (HP, <= 640): di setiap baris (Target hari ini + kelompok task) tombol bertumpuk vertikal — left sama,
  top naik berurutan ⭐ < Fokus < chevron, kolom rata atas, target sentuh >= 32 px; lebar judul >= 70% lebar
  baris; tanpa scroll horizontal; ⭐ / Fokus / buka panel tetap berfungsi; baris "Berulang hari ini" tetap flex.
- 768, 1024 & 1280 px (tablet/desktop): tetap horizontal (tengah vertikal sama, ⭐ kiri Fokus kiri chevron); label "Fokus" terlihat di > 768 (641-768 ikon saja, aturan lama).
Screenshot: temporary_files/e2e_focus_row_stack/ (git-ignored).

    E2E_PYTHON=/path/python-dengan-dependensi-webapp python3 temporary_files/e2e_focus_row_stack.py
"""
import os
import shutil
import subprocess
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import e2e_focus_page as h  # noqa: E402
from e2e_focus_header_strip import open_focus, ERRS  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402

SHOTS = os.path.join(h.ROOT, "temporary_files", "e2e_focus_row_stack")
TITLES = ["Followup pembelian material pipa untuk proyek sumur bor desa", "Kirim laporan mingguan",
          "Review kode modul sinkronisasi offline", "Bayar listrik"]
STAR = "Kirim laporan mingguan"

GEO = """() => [...document.querySelectorAll('.ftask:not(.ftask--recurring) > .ftask-row')].map(r => {
    const b = e => { const el = r.querySelector(':scope > ' + e); if (!el) return null; const q = el.getBoundingClientRect();
        return {l: q.left, r: q.right, t: q.top, b: q.bottom, w: q.width, h: q.height, cy: q.top + q.height / 2}; };
    const rb = r.getBoundingClientRect();
    return {title: r.querySelector('.ftask-title').textContent, row: {l: rb.left, r: rb.right, t: rb.top, w: rb.width},
            star: b('.ftask-star'), focus: b('.ftask-focus-btn'), chev: b('.ftask-chevron'), main: b('.ftask-main'),
            titleW: r.querySelector('.ftask-title').getBoundingClientRect().width,
            inTarget: !!r.closest('.focus-target'), display: getComputedStyle(r).display,
            labelVis: (() => { const l = r.querySelector('.ftask-focus-label'); return !!l && getComputedStyle(l).display !== 'none'; })()};
})"""


def shot(p, name):
    os.makedirs(SHOTS, exist_ok=True)
    p.mouse.move(1, 1)
    p.locator(".focus-target").first.evaluate("e => e.scrollIntoView({block: 'start'})")
    p.evaluate("() => window.scrollBy(0, -60)")
    p.wait_for_timeout(300)
    p.screenshot(path=os.path.join(SHOTS, name), full_page=False)
    print("  screenshot", os.path.relpath(os.path.join(SHOTS, name), h.ROOT), flush=True)


def stacked_checks(p, tag):
    rows = p.evaluate(GEO)
    h.check("%s: ada baris Target hari ini & kelompok" % tag, any(r["inTarget"] for r in rows) and any(not r["inTarget"] for r in rows), str(len(rows)))
    bad = []
    for r in rows:
        s, f, c, m = r["star"], r["focus"], r["chev"], r["main"]
        ok = (r["display"] == "grid" and s and f and c
              and abs(s["l"] - f["l"]) <= 1 and abs(f["l"] - c["l"]) <= 1
              and s["t"] < f["t"] < c["t"] and s["b"] <= f["t"] + 1 and f["b"] <= c["t"] + 1
              and abs(s["t"] - m["t"]) <= 4
              and min(s["w"], s["h"], f["w"], f["h"], c["w"], c["h"]) >= 32
              and m["r"] <= s["l"] + 1 and r["titleW"] >= 0.7 * r["row"]["w"] and not r["labelVis"])
        if not ok:
            bad.append(r)
    h.check("%s: tiap baris — ⭐/Fokus/chevron satu kolom (left sama, top ⭐<Fokus<chevron, rata atas, >=32 px), judul >= 70%%" % tag,
            not bad, repr(bad[:1]))
    ratio = min(r["titleW"] / r["row"]["w"] for r in rows)
    print("  rasio lebar judul minimum %.3f" % ratio, flush=True)
    h.check("%s: tanpa scroll horizontal" % tag, not p.evaluate("() => document.documentElement.scrollWidth > innerWidth + 1"))
    rec = p.evaluate("() => { const r = document.querySelector('.ftask--recurring .ftask-row'); return r ? getComputedStyle(r).display : null; }")
    h.check("%s: baris 'Berulang hari ini' tetap flex" % tag, rec == "flex", repr(rec))


def horizontal_checks(p, tag, vw):
    rows = p.evaluate(GEO)
    bad = [r for r in rows if not (r["display"] == "flex" and r["star"] and abs(r["star"]["cy"] - r["focus"]["cy"]) <= 2
                                   and abs(r["focus"]["cy"] - r["chev"]["cy"]) <= 2
                                   and r["star"]["r"] <= r["focus"]["l"] + 1 and r["focus"]["r"] <= r["chev"]["l"] + 1
                                   and r["star"]["w"] == 36 and (r["labelVis"] or vw <= 768))]
    h.check("%s: tombol tetap horizontal (⭐ · Fokus · chevron, ⭐ 36 px%s)" % (tag, ", label Fokus" if vw > 768 else "; 641-768: Fokus ikon saja"), rows and not bad, repr(bad[:1]))


def behaviour_checks(p, base, user, tag):
    row = p.locator(".focus-group .ftask").filter(has_text="Bayar listrik").first
    star = row.locator(".ftask-star")
    before = star.get_attribute("aria-pressed")
    star.click()
    p.wait_for_timeout(700)
    tgt = p.locator(".focus-target .ftask").filter(has_text="Bayar listrik")
    h.check("%s: ⭐ tetap berfungsi (masuk Target hari ini)" % tag, before == "false" and tgt.count() == 1)
    tgt.first.locator(".ftask-star").click()
    p.wait_for_timeout(700)
    h.check("%s: ⭐ lepas lagi" % tag, p.locator(".focus-target .ftask").filter(has_text="Bayar listrik").count() == 0)
    row = p.locator(".focus-group .ftask").filter(has_text="Review kode").first
    row.locator(".ftask-chevron").click()
    p.wait_for_timeout(400)
    h.check("%s: klik chevron membuka panel" % tag, row.locator(".ftask-panel").count() == 1
            and row.locator(".ftask-main").get_attribute("aria-expanded") == "true")
    row.locator(".ftask-focus-btn").click()
    p.wait_for_timeout(500)
    h.check("%s: tombol Fokus menjadikan task aktif" % tag, p.locator(".ftask-focus-btn.is-active").count() >= 1
            and "Review kode" in p.locator(".focus-pomo").inner_text())
    p.locator(".ftask-focus-btn.is-active").first.click()
    p.wait_for_timeout(400)


def main():
    if os.path.isdir(SHOTS):
        for f in os.listdir(SHOTS):
            if f.endswith(".png"):
                os.remove(os.path.join(SHOTS, f))
    tmp = tempfile.mkdtemp(prefix="e2e_focus_row_stack_")
    proc, base = h.start_server(tmp)
    print("server", base, flush=True)
    try:
        user = h.register(base, "rows")
        for t in TITLES:
            h.api(base, user, "POST", "/api/tasks", json={"title": t, "priority": "P1", "gtd_status": "next", "deadline": h.today_iso(),
                                                         "project": "Proyek Sumur" if "pipa" in t else ""})
        h.api(base, user, "POST", "/api/tasks", json={"title": h.REC_TITLE, "priority": "P2", "gtd_status": "next", "deadline": h.today_iso(),
                                                     "recurrence_type": "daily"})
        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            first = True
            for theme in ("light", "dark"):
                for vw in (375, 640, 768, 1024, 1280):
                    tag = "%s %d" % (theme, vw)
                    ctx, p = open_focus(browser, base, user, vw, 900, theme)
                    try:
                        if first:
                            p.locator(".focus-group .ftask").filter(has_text=STAR).first.locator(".ftask-star").click()
                            p.wait_for_timeout(800)
                            first = False
                        p.locator(".focus-target .ftask").first.wait_for(state="visible", timeout=10000)
                        if vw <= 640:
                            stacked_checks(p, tag)
                            if vw == 375:
                                shot(p, "rows_%s_%d.png" % (theme, vw))
                                behaviour_checks(p, base, user, tag)
                            else:
                                shot(p, "rows_%s_%d.png" % (theme, vw))
                        else:
                            horizontal_checks(p, tag, vw)
                            shot(p, "rows_%s_%d.png" % (theme, vw))
                    finally:
                        ctx.close()
            browser.close()
    except Exception as e:
        import traceback
        traceback.print_exc()
        h.check("exception", False, "%s: %s" % (type(e).__name__, e))
    finally:
        proc.terminate()
        try:
            proc.wait(10)
        except subprocess.TimeoutExpired:
            proc.kill()
        shutil.rmtree(tmp, ignore_errors=True)
    h.check("tanpa pageerror", not ERRS, repr(ERRS[:3]))
    failed = [r for r in h.results if not r[1]]
    print("\n%d langkah, %d gagal" % (len(h.results), len(failed)))
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
