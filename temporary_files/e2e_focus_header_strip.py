"""E2E header ringkas halaman Fokus di HP & tablet (Bapak 2026-10-23). Tidak dijalankan CI.

Skenario (terang + gelap): 320/375/768/1024 px -> header = satu strip satu baris
"Jum, 23 Okt · 27 task · 0/27 · ~11,5 j" (glyph pomoTomato), h1 + kalimat lengkap tetap di DOM
(visually-hidden), tinggi header <= 1 baris; data angka besar di 320 px -> jam disembunyikan dulu,
tetap satu baris; desktop 1280 -> tampilan lama (h1 24 px, tanggal panjang, ringkasan lengkap, strip
tersembunyi, margin 16 px). Screenshot: temporary_files/e2e_focus_header_strip/ (git-ignored).

    E2E_PYTHON=/path/python-dengan-dependensi-webapp python3 temporary_files/e2e_focus_header_strip.py
"""
import os
import re
import shutil
import subprocess
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import e2e_focus_page as h  # noqa: E402  harness: server, register, api, check, nav
from playwright.sync_api import sync_playwright  # noqa: E402

SHOTS = os.path.join(h.ROOT, "temporary_files", "e2e_focus_header_strip")
ERRS = []


def open_focus(browser, base, user, vw, vh, theme):
    mobile = vw <= 768
    ctx = browser.new_context(service_workers="block", viewport={"width": vw, "height": vh}, is_mobile=mobile,
                              has_touch=mobile, device_scale_factor=2 if mobile else 1)
    ctx.add_cookies([{"name": "token", "value": user["token"], "url": base, "httpOnly": True, "sameSite": "Lax"}])
    p = ctx.new_page()
    p.on("pageerror", lambda e: ERRS.append(str(e)[:200]))
    p.goto(base + "/manifest.json")
    p.evaluate("""([t, uid, tours, theme]) => { localStorage.setItem('tf_token', t); localStorage.setItem('tf_user_id', String(uid));
        for (const pg of tours) localStorage.setItem('tf_tour_' + pg, '1');
        localStorage.setItem('tf_dismiss_onboarding', '1'); localStorage.setItem('tf_theme', theme); }""",
               [user["token"], user["id"], h.TOURS, theme])
    p.goto(base + "/")
    p.locator(".sidebar-link, .sidebar-rail-btn, .mobile-topbar").first.wait_for(state="attached", timeout=20000)
    p.wait_for_timeout(400)
    if p.locator(".mobile-topbar").first.is_visible():
        p.locator(".mobile-topbar button").first.click()
        p.wait_for_timeout(600)
        p.locator(".sidebar-link").filter(has_text="Fokus Hari Ini").first.click()
    else:
        h.nav(p, "Fokus Hari Ini")
    p.wait_for_selector(".focus-pomo", timeout=20000)
    p.wait_for_timeout(700)
    return ctx, p


GEO = """() => {
    const head = document.querySelector('.focus-page-head'), strip = document.querySelector('.focus-page-strip');
    const sb = strip.getBoundingClientRect(), hb = head.getBoundingClientRect();
    const part = s => { const e = strip.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect();
        return {t: b.top, b: b.bottom, l: b.left, r: b.right, text: e.textContent, row1: b.top >= sb.top - 1 && b.bottom <= sb.bottom + 1 && b.height > 4 && b.right <= sb.right + 1}; };
    const h1 = document.querySelector('h1.focus-page-title'), h1b = h1 ? h1.getBoundingClientRect() : null;
    // terlihat = titik tengah elemen benar-benar menampilkan elemen itu (clip/overflow ikut dihitung)
    const seen = e => { const b = e.getBoundingClientRect(); if (b.width < 2 || b.height < 2) return false;
        const x = Math.min(innerWidth - 1, Math.max(0, b.left + Math.min(8, b.width / 2))), y = b.top + b.height / 2;
        const at = document.elementFromPoint(x, y); return !!at && (at === e || e.contains(at)); };
    const pomo = document.querySelector('.focus-pomo').getBoundingClientRect();
    const cs = getComputedStyle(strip);
    return {
        stripDisplay: cs.display, stripH: sb.height, headH: hb.height, lineH: parseFloat(cs.lineHeight),
        stripAria: strip.getAttribute('aria-hidden'), stripW: sb.width, stripScrollW: strip.scrollWidth,
        date: part('.fps-date'), tasks: part('.fps-tasks'), pomo: part('.fps-pomo'), hours: part('.fps-hours'),
        glyph: !!strip.querySelector('.fps-pomo svg'),
        h1: h1 ? {text: h1.textContent.trim(), w: h1b.width, h: h1b.height, fs: getComputedStyle(h1).fontSize,
                  vis: seen(h1)} : null,
        dateFull: document.querySelector('.focus-page-date').textContent,
        dateFullVis: seen(document.querySelector('.focus-page-date')),
        summary: document.querySelector('.focus-page-summary').textContent,
        summaryVis: seen(document.querySelector('.focus-page-summary')),
        headMB: getComputedStyle(head).marginBottom, gapToHero: pomo.top - hb.bottom,
        hscroll: document.documentElement.scrollWidth > innerWidth + 1,
        expectDate: new Date().toLocaleDateString('id-ID', {weekday: 'short', day: 'numeric', month: 'short'}),
    };
}"""


def shot(p, name):
    os.makedirs(SHOTS, exist_ok=True)
    p.evaluate("() => window.scrollTo(0, 0)")
    p.wait_for_timeout(250)
    box = p.locator(".focus-pomo").bounding_box()
    p.screenshot(path=os.path.join(SHOTS, name), clip={"x": 0, "y": 0, "width": p.viewport_size["width"],
                                                       "height": min(p.viewport_size["height"], box["y"] + box["height"] + 12)})
    print("  screenshot", os.path.relpath(os.path.join(SHOTS, name), h.ROOT), flush=True)


def seed(base, user, n, est):
    for i in range(n):
        h.api(base, user, "POST", "/api/tasks", json={"title": "Tugas %02d" % (i + 1), "priority": "P2", "gtd_status": "next",
                                                     "deadline": h.today_iso(), "estimated_pomodoros": est})


def main():
    if os.path.isdir(SHOTS):
        for f in os.listdir(SHOTS):
            if f.endswith(".png"):
                os.remove(os.path.join(SHOTS, f))
    tmp = tempfile.mkdtemp(prefix="e2e_focus_header_strip_")
    proc, base = h.start_server(tmp)
    print("server", base, flush=True)
    try:
        user = h.register(base, "strip")
        seed(base, user, 27, 1)          # 27 task, estimasi 27 -> ~11,5 j (contoh Bapak)
        big = h.register(base, "stripbig")
        seed(base, big, 120, 20)         # 120 task, 0/2400, ~1000 j -> uji jam disembunyikan dulu
        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            for theme in ("light", "dark"):
                for vw in (320, 375, 768, 1024):
                    tag = "%s %d" % (theme, vw)
                    ctx, p = open_focus(browser, base, user, vw, 800, theme)
                    try:
                        g = p.evaluate(GEO)
                        h.check("%s: strip tampil (flex), aria-hidden" % tag, g["stripDisplay"] == "flex" and g["stripAria"] == "true", repr(g["stripDisplay"]))
                        row = all(g[k] and g[k]["row1"] for k in ("date", "tasks", "pomo", "hours"))
                        h.check("%s: semua bagian di baris 1 (tanggal · task · pomo · jam)" % tag, row,
                                repr({k: g[k] for k in ("date", "tasks", "pomo", "hours")}))
                        text = "".join(g[k]["text"] for k in ("date", "tasks", "pomo", "hours"))
                        h.check("%s: teks strip" % tag, text == g["expectDate"] + " · 27 task ·  0/27 · ~11,5 j", repr(text))
                        h.check("%s: tanggal pendek id-ID (mis. 'Jum, 23 Okt')" % tag, re.match(r"^\w{3}, \d{1,2} \w{3}$", g["date"]["text"]) is not None, g["date"]["text"])
                        h.check("%s: glyph pomoTomato" % tag, g["glyph"])
                        h.check("%s: header satu baris (tinggi <= 1 baris teks)" % tag, g["headH"] <= g["lineH"] + 1 and g["stripH"] <= g["lineH"] + 1,
                                "head %.1f strip %.1f line %.1f" % (g["headH"], g["stripH"], g["lineH"]))
                        h.check("%s: h1 tetap di DOM, visually-hidden" % tag, g["h1"] and g["h1"]["text"] == "Fokus Hari Ini" and not g["h1"]["vis"], repr(g["h1"]))
                        h.check("%s: kalimat lengkap tetap di DOM (pembaca layar), tidak terlihat" % tag,
                                "27 tugas" in g["summary"] and "~11.5 jam" in g["summary"] and not g["summaryVis"]
                                and re.search(r"\d{4}$", g["dateFull"].strip()) and not g["dateFullVis"], repr((g["summary"], g["dateFull"])))
                        h.check("%s: margin bawah kecil (hero naik)" % tag, g["headMB"] == "8px" and g["gapToHero"] <= 9, "%s gap %.1f" % (g["headMB"], g["gapToHero"]))
                        h.check("%s: tanpa scroll horizontal" % tag, not g["hscroll"])
                        shot(p, "strip_%s_%d.png" % (theme, vw))
                    finally:
                        ctx.close()
                # angka besar di 320 px: jam disembunyikan lebih dulu, tetap satu baris
                ctx, p = open_focus(browser, base, big, 320, 800, theme)
                try:
                    g = p.evaluate(GEO)
                    tag = "%s 320 angka besar" % theme
                    h.check("%s: semua bagian muat di baris 1" % tag, all(g[k]["row1"] for k in ("date", "tasks", "pomo", "hours")),
                            repr({k: g[k] for k in ("date", "tasks", "pomo", "hours")}))
                    h.check("%s: teks pomo 0/2400, jam ~1000 j" % tag, g["pomo"]["text"].endswith(" 0/2400") and g["hours"]["text"] == " · ~1000 j",
                            repr((g["pomo"]["text"], g["hours"]["text"])))
                    h.check("%s: header satu baris, tanpa scroll horizontal" % tag, g["headH"] <= g["lineH"] + 1 and not g["hscroll"], "%.1f" % g["headH"])
                    shot(p, "strip_%s_320_angka_besar.png" % theme)
                    # kontainer lebih sempit dari isi (mis. huruf sistem diperbesar): jam turun & terpotong lebih dulu
                    tag = "%s strip sempit 230 px" % theme
                    p.evaluate("() => { document.querySelector('.focus-page-strip').style.width = '230px'; }")
                    p.wait_for_timeout(100)
                    g = p.evaluate(GEO)
                    h.check("%s: tanggal · task · pomo tetap di baris 1" % tag, all(g[k]["row1"] for k in ("date", "tasks", "pomo")),
                            repr({k: g[k] for k in ("date", "tasks", "pomo")}))
                    h.check("%s: jam tersembunyi (turun & terpotong)" % tag, g["hours"] and not g["hours"]["row1"], repr(g["hours"]))
                    h.check("%s: header tetap satu baris" % tag, g["headH"] <= g["lineH"] + 1 and g["stripH"] <= g["lineH"] + 1, "%.1f" % g["headH"])
                    shot(p, "strip_%s_sempit_230.png" % theme)
                finally:
                    ctx.close()
                # desktop: tampilan lama
                ctx, p = open_focus(browser, base, user, 1280, 860, theme)
                try:
                    g = p.evaluate(GEO)
                    tag = "%s 1280" % theme
                    h.check("%s: strip tersembunyi" % tag, g["stripDisplay"] == "none")
                    h.check("%s: h1 terlihat 24px" % tag, g["h1"]["vis"] and g["h1"]["fs"] == "24px", repr(g["h1"]))
                    h.check("%s: tanggal panjang & ringkasan lengkap terlihat" % tag, g["dateFullVis"] and g["summaryVis"]
                            and "27 tugas" in g["summary"] and "0 / 27" in g["summary"], repr((g["dateFull"], g["summary"])))
                    h.check("%s: margin bawah header 16px" % tag, g["headMB"] == "16px", g["headMB"])
                    shot(p, "strip_%s_1280.png" % theme)
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
