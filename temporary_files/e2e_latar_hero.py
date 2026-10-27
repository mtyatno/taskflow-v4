"""E2E latar hero (spec docs/superpowers/specs/2026-10-27-latar-hero-design.md §9). Tidak dijalankan CI.

    python3 temporary_files/e2e_latar_hero.py [hero] [settings]      (tanpa argumen = semuanya)

Server uvicorn lokal + DB sementara + Chromium (Playwright); seed pengguna = e2e_hero_dashboard.py (6 task, 4 habit).
Pilihan latar dipasang lewat localStorage (tf_palette / tf_theme / tf_herobg) sebelum aplikasi dimuat.

hero      tangkapan .dash-hero untuk 6 latar x 3 palet x 2 mode @1280x900 (hero-<latar>-<palet>-<mode>.png) + 6 latar
          Sakura terang @375x812 (hero-375-<latar>-sakura-light.png) dan lembar kontak sheet-hero.png. Cek: lapisan
          .hb.hb-k-<latar> ada, isi hero di atas latar (z-index), fitur tampil di 1280 / tersembunyi di 375, tanpa
          scroll horizontal di 375, kelopak tema tidak menimpa fitur latar.
settings  Pengaturan > Tampilan, Sakura terang: tangkapan kartu Tampilan dengan Lanskap terpilih @1280 dan @375
          (settings-<lebar>.png); cek teks/peran radiogroup, klik kartu Lanskap -> html[data-herobg] + strip pratinjau
          + hero Dashboard berubah tanpa muat ulang, tersimpan setelah muat ulang; panah kanan/kiri memindah pilihan +
          fokus; tanpa scroll horizontal di 375.
Keluaran: temporary_files/e2e_latar_hero/ (lokal, tidak di-commit).
"""
import os
import shutil
import subprocess
import sys
import tempfile

from PIL import Image, ImageDraw
from playwright.sync_api import TimeoutError as PlaywrightTimeout, sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import e2e_hero_dashboard as hd  # noqa: E402  (server, seed, tunggu dashboard siap)

ROOT = os.path.dirname(HERE)
SHOTS = os.path.join(ROOT, "temporary_files", "e2e_latar_hero")
KINDS = ("kontur", "gradasi", "lanskap", "galaksi", "objek", "polos")
NAMES = {"kontur": "Kontur", "gradasi": "Gradasi", "lanskap": "Lanskap", "galaksi": "Galaksi", "objek": "Objek 3D",
         "polos": "Polos"}
PALETTES = ("default", "sakura", "lavender")
MODES = ("light", "dark")
DESKTOP = {"width": 1280, "height": 900}
MOBILE = {"width": 375, "height": 812}

results = []


def check(step, ok, note=""):
    results.append((step, bool(ok), note))
    print(("PASS " if ok else "FAIL ") + step + (" (" + note + ")" if note else ""), flush=True)
    return ok


def new_page(browser, base, user, palette, mode, kind, mobile=False, width=None):
    extra = {"is_mobile": True, "has_touch": True} if mobile else {}
    vp = MOBILE if mobile else ({"width": width, "height": 900} if width else DESKTOP)
    ctx = browser.new_context(service_workers="block", viewport=vp,
                              timezone_id="Asia/Jakarta", reduced_motion="reduce", **extra)
    ctx.add_cookies([{"name": "token", "value": user["token"], "url": base, "httpOnly": True, "sameSite": "Lax"}])
    p = ctx.new_page()
    p.goto(base + "/manifest.json")
    p.evaluate("""([t, u, tours, sw, mode, palette, kind]) => {
        localStorage.setItem('tf_token', t); localStorage.setItem('tf_user_id', String(u));
        for (const pg of tours) localStorage.setItem('tf_tour_' + pg, '1');
        localStorage.setItem('tf_whatsnew_seen', sw);
        localStorage.setItem('tf_theme', mode);
        localStorage.setItem('tf_palette', palette);
        if (kind) localStorage.setItem('tf_herobg', kind); else localStorage.removeItem('tf_herobg');
    }""", [user["token"], user["id"], hd.TOURS, hd.sw_version(), mode, palette, kind])
    p.goto(base + "/")
    return ctx, p


RECT_JS = """(sel) => [...document.querySelectorAll(sel)].map(e => { const r = e.getBoundingClientRect();
    return {l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height}; })"""


def shoot_card(p, path):
    """Tangkapan .theme-card tanpa elemen fixed/sticky (topbar, tombol +) yang menimpanya saat elemen digulir ke layar."""
    p.evaluate("""() => { const card = document.querySelector('.theme-card');
        for (const el of document.body.querySelectorAll('*')) {
            const pos = getComputedStyle(el).position;
            if ((pos === 'fixed' || pos === 'sticky') && !el.contains(card)) { el.dataset.e2eHidden = '1'; el.style.visibility = 'hidden'; }
        } }""")
    try:
        p.locator(".theme-card").screenshot(path=path, animations="disabled", caret="hide")
    finally:
        p.evaluate("""() => { for (const el of document.querySelectorAll('[data-e2e-hidden]')) {
            el.style.visibility = ''; delete el.dataset.e2eHidden; } }""")


def rects(p, sel):
    return p.evaluate(RECT_JS, sel)


def intersects(a, b):
    return a["l"] < b["r"] and b["l"] < a["r"] and a["t"] < b["b"] and b["t"] < a["b"]


def feature_rect(p):
    """Kotak gambar fitur yang benar-benar tampil (bbox isi SVG fitur dalam koordinat layar) atau None."""
    return p.evaluate("""() => { const f = document.querySelector('.dash-hero .hb-feature');
        if (!f || getComputedStyle(f).display === 'none') return null;
        const svg = f.querySelector('svg'); if (!svg) return null;
        const g = [...svg.querySelectorAll('path, circle, ellipse, rect')].map(e => e.getBoundingClientRect())
            .filter(r => r.width > 0 && r.height > 0);
        if (!g.length) return null;
        return {l: Math.min(...g.map(r => r.left)), t: Math.min(...g.map(r => r.top)),
                r: Math.max(...g.map(r => r.right)), b: Math.max(...g.map(r => r.bottom))}; }""")


def shoot_hero(browser, base, user, palette, mode, kind, mobile=False, width=None):
    ctx, p = new_page(browser, base, user, palette, mode, kind, mobile, width)
    try:
        hd.wait_dashboard_ready(p)
        p.mouse.move(2, 2)
        p.wait_for_timeout(200)
        tag = ("375-" if mobile else "%d-" % width if width else "") + "%s-%s-%s" % (kind, palette, mode)
        info = p.evaluate("""() => { const h = document.querySelector('.dash-hero');
            const hb = h && h.querySelector(':scope > .hb');
            const f = hb && hb.querySelector('.hb-feature');
            return {attr: document.documentElement.dataset.herobg, cls: hb ? hb.className : null,
                    feature: f ? getComputedStyle(f).display : null, featureHtml: f ? f.innerHTML.length : 0,
                    zTop: getComputedStyle(h.querySelector('.dash-hero-top')).zIndex,
                    sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth}; }""")
        ok = info["attr"] == kind and info["cls"] == "hb hb-hero hb-k-" + kind and info["zTop"] == "1"
        if mobile or (width and width <= 1100):
            ok = ok and info["feature"] == "none" and info["sw"] <= info["cw"]
        else:
            ok = ok and (info["feature"] != "none" or info["featureHtml"] == 0)
        # Kelopak tema (Sakura/Lavender) tidak boleh menimpa gambar fitur latar.
        pet = [r for r in rects(p, ".dash-hero-top > .decor-page-corner svg") if r["w"] > 0]
        feat = feature_rect(p)
        overlap = bool(pet and feat and intersects(pet[0], feat))
        check("hero %s" % tag, ok and not overlap, repr(dict(info, petalOverFeature=overlap)) if not ok or overlap else "")
        path = os.path.join(SHOTS, "hero-%s.png" % tag)
        p.locator(".dash-hero").screenshot(path=path, animations="disabled", caret="hide")
        return path
    finally:
        ctx.close()


def contact_sheet(shots, path):
    """Baris = latar, kolom = palet x mode (1280 px; skala 50%)."""
    pad, label_h, sc = 12, 20, 0.5
    imgs = {k: Image.open(v).convert("RGB") for k, v in shots.items()}
    cw = max(int(i.width * sc) for i in imgs.values())
    ch = max(int(i.height * sc) for i in imgs.values())
    cols = [(pl, m) for pl in PALETTES for m in MODES]
    W = pad + len(cols) * (cw + pad)
    H = pad + len(KINDS) * (ch + label_h + pad)
    sheet = Image.new("RGB", (W, H), (236, 238, 242))
    dr = ImageDraw.Draw(sheet)
    for ri, k in enumerate(KINDS):
        y = pad + ri * (ch + label_h + pad)
        for ci, (pl, m) in enumerate(cols):
            x = pad + ci * (cw + pad)
            dr.text((x, y + 4), "%s · %s · %s" % (NAMES[k], pl, m), fill=(30, 30, 40))
            im = imgs[(k, pl, m)]
            sheet.paste(im.resize((int(im.width * sc), int(im.height * sc)), Image.LANCZOS), (x, y + label_h))
    sheet.save(path)


def run_hero(browser, base, user):
    shots = {}
    for k in KINDS:
        for pl in PALETTES:
            for m in MODES:
                shots[(k, pl, m)] = shoot_hero(browser, base, user, pl, m, k)
    for k in KINDS:
        shoot_hero(browser, base, user, "sakura", "light", k, mobile=True)
        shoot_hero(browser, base, user, "default", "dark", k, mobile=True)
        for w in (768, 1024):
            shoot_hero(browser, base, user, "sakura", "light", k, width=w)
    sheet = os.path.join(SHOTS, "sheet-hero.png")
    contact_sheet(shots, sheet)
    print("lembar kontak", sheet, flush=True)


def open_settings(p):
    hd.wait_dashboard_ready(p)
    link = p.locator(".sidebar-link").filter(has_text="Pengaturan").first
    topbar = p.locator(".mobile-topbar button")
    if topbar.count() and topbar.first.is_visible():
        topbar.first.click()
        p.wait_for_timeout(600)
    elif not link.is_visible():
        p.locator("button[aria-label='Tampilkan semua menu']").first.click()
    link.click()
    p.get_by_role("radiogroup", name="Latar").wait_for(state="visible", timeout=20000)
    p.evaluate("() => Promise.race([document.fonts.ready, new Promise(r => setTimeout(r, 8000))])")
    p.wait_for_timeout(300)


def nav_dashboard(p):
    link = p.locator(".sidebar-link").filter(has_text="Dashboard").first
    if not link.is_visible():
        p.locator("button[aria-label='Tampilkan semua menu']").first.click()
    link.click()
    p.locator(".dash-hero").wait_for(state="visible", timeout=20000)


def run_settings(browser, base, user):
    # 1280: mulai dari Kontur (bawaan), pilih Lanskap lewat klik.
    ctx, p = new_page(browser, base, user, "sakura", "light", None)
    try:
        open_settings(p)
        group = p.get_by_role("radiogroup", name="Latar")
        radios = group.get_by_role("radio")
        names = [" ".join(r.inner_text().split()) for r in radios.all()]
        want = [NAMES[k] + (" Bawaan" if k == "kontur" else "") for k in KINDS]
        # Nama aksesibel persis (lencana dipisah spasi: "Kontur Bawaan", bukan "KonturBawaan").
        exact = [group.get_by_role("radio", name=n, exact=True).count() for n in want]
        check("s1 radiogroup Latar berisi 6 radio sesuai urutan, nama aksesibel persis", names == want and exact == [1] * 6,
              repr((names, exact)))
        card = p.locator(".theme-card")
        txt = card.inner_text()
        check("s2 teks persis: Latar + keterangan + Bawaan",
              "Untuk bagian atas Dashboard dan kartu Pomodoro di Fokus Hari Ini." in txt and "Bawaan" in txt
              and "LATAR" in txt.upper(), "")
        checked = [r.get_attribute("aria-checked") for r in radios.all()]
        tabidx = [r.get_attribute("tabindex") for r in radios.all()]
        check("s3 bawaan Kontur terpilih (aria-checked, roving tabindex)",
              checked == ["true"] + ["false"] * 5 and tabidx == ["0"] + ["-1"] * 5, repr((checked, tabidx)))
        group.get_by_role("radio", name="Lanskap").click()
        try:
            p.wait_for_function("() => document.documentElement.dataset.herobg === 'lanskap'", timeout=5000)
            attr_ok = True
        except PlaywrightTimeout:
            attr_ok = False
        ls = p.evaluate("() => localStorage.getItem('tf_herobg')")
        prev = p.evaluate("() => { const h = document.querySelector('.theme-preview-hero .hb'); return h && h.className; }")
        check("s4 klik Lanskap -> data-herobg, localStorage, strip pratinjau berubah tanpa muat ulang",
              attr_ok and ls == "lanskap" and prev == "hb hb-hero hb-k-lanskap", repr((attr_ok, ls, prev)))
        checked = [r.get_attribute("aria-checked") for r in radios.all()]
        check("s5 aria-checked pindah ke Lanskap", checked == ["false", "false", "true", "false", "false", "false"],
              repr(checked))
        p.mouse.move(2, 2)
        p.wait_for_timeout(200)
        shoot_card(p, os.path.join(SHOTS, "settings-1280.png"))
        p.screenshot(path=os.path.join(SHOTS, "settings-1280-page.png"), animations="disabled", caret="hide")
        # Keyboard: fokus di radio terpilih, panah kanan -> Galaksi, panah kiri x2 -> Gradasi.
        group.get_by_role("radio", name="Lanskap").focus()
        p.keyboard.press("ArrowRight")
        p.wait_for_function("() => document.documentElement.dataset.herobg === 'galaksi'", timeout=5000)
        f1 = p.evaluate("() => document.activeElement && document.activeElement.textContent")
        p.keyboard.press("ArrowLeft")
        p.keyboard.press("ArrowLeft")
        p.wait_for_function("() => document.documentElement.dataset.herobg === 'gradasi'", timeout=5000)
        f2 = p.evaluate("() => document.activeElement && document.activeElement.textContent")
        check("s6 panah kanan/kiri memindah pilihan + fokus", "Galaksi" in (f1 or "") and "Gradasi" in (f2 or ""),
              repr((f1, f2)))
        group.get_by_role("radio", name="Lanskap").click()
        p.wait_for_function("() => document.documentElement.dataset.herobg === 'lanskap'", timeout=5000)
        nav_dashboard(p)
        cls = p.evaluate("() => document.querySelector('.dash-hero > .hb').className")
        check("s7 hero Dashboard memakai Lanskap tanpa muat ulang", cls == "hb hb-hero hb-k-lanskap", repr(cls))
        p.reload()
        hd.wait_dashboard_ready(p)
        after = p.evaluate("""() => [document.documentElement.dataset.herobg, localStorage.getItem('tf_herobg'),
            document.querySelector('.dash-hero > .hb').className]""")
        check("s8 tersimpan setelah muat ulang", after == ["lanskap", "lanskap", "hb hb-hero hb-k-lanskap"], repr(after))
    finally:
        ctx.close()
    # 375: Lanskap tersimpan dari awal.
    ctx, p = new_page(browser, base, user, "sakura", "light", "lanskap", mobile=True)
    try:
        open_settings(p)
        card = p.locator(".theme-card")
        card.scroll_into_view_if_needed()
        sw, cw = p.evaluate("() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]")
        tiles = rects(p, ".theme-card-herobgs [role=radio]")
        cols = len({round(t["l"]) for t in tiles})
        cr = rects(p, ".theme-card")[0]
        inside = all(t["l"] >= cr["l"] and t["r"] <= cr["r"] for t in tiles + rects(p, ".theme-preview-hero"))
        check("s9 375 px: tanpa scroll horizontal, kartu latar 2 kolom, pratinjau di dalam kartu",
              sw <= cw and cols == 2 and inside, repr((sw, cw, cols, inside)))
        shoot_card(p, os.path.join(SHOTS, "settings-375.png"))
    finally:
        ctx.close()


def main():
    parts = set(sys.argv[1:]) or {"hero", "settings"}
    shutil.rmtree(SHOTS, ignore_errors=True)
    os.makedirs(SHOTS, exist_ok=True)
    tmp = tempfile.mkdtemp(prefix="e2e_latar_hero_")
    proc, base = hd.start_server(tmp)
    print("server", base, flush=True)
    try:
        user = hd.seed(base)
        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            if "settings" in parts:
                run_settings(browser, base, user)
            if "hero" in parts:
                run_hero(browser, base, user)
            browser.close()
    finally:
        proc.terminate()
        try:
            proc.wait(10)
        except subprocess.TimeoutExpired:
            proc.kill()
        shutil.rmtree(tmp, ignore_errors=True)
    failed = [r for r in results if not r[1]]
    print("\n%d/%d cek lolos" % (len(results) - len(failed), len(results)), flush=True)
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
