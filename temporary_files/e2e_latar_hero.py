"""E2E latar hero (spec docs/superpowers/specs/2026-10-27-latar-hero-design.md §9). Tidak dijalankan CI.

    python3 temporary_files/e2e_latar_hero.py [hero] [settings] [pomo]      (tanpa argumen = semuanya)

Server uvicorn lokal + DB sementara + Chromium (Playwright); seed pengguna = e2e_hero_dashboard.py (6 task, 4 habit).
Pilihan latar dipasang lewat localStorage (tf_palette / tf_theme / tf_herobg) sebelum aplikasi dimuat.

hero      tangkapan .dash-hero untuk 6 latar x 3 palet x 2 mode @1280x900 (hero-<latar>-<palet>-<mode>.png) + 6 latar
          Sakura terang @375x812 (hero-375-<latar>-sakura-light.png) dan lembar kontak sheet-hero.png. Cek: lapisan
          .hb.hb-k-<latar> ada, isi hero di atas latar (z-index), fitur tampil di 1280 / tersembunyi di 375, tanpa
          scroll horizontal di 375, kelopak tema tidak menimpa fitur latar, ambient Objek 3D tersembunyi di 375, dan
          KONTRAS teks hero terhadap piksel latar nyata @1280 (cara sama dengan kartu Pomodoro, lihat pomo).
          Lebar hero sempit (cek "lebar hero"): pengguna bernama tampilan panjang, 1101/1180/1280 px dengan menu lengkap
          + 1101 px sidebar ikon, 6 latar: gambar fitur tidak beririsan dengan kolom teks (.dash-hero-text).
settings  Pengaturan > Tampilan, Sakura terang: tangkapan kartu Tampilan dengan Lanskap terpilih @1280 dan @375
          (settings-<lebar>.png); cek teks/peran radiogroup (nama dari label tampak lewat aria-labelledby), klik kartu
          Lanskap -> html[data-herobg] + strip pratinjau + hero Dashboard berubah tanpa muat ulang, tersimpan setelah
          muat ulang; panah kanan/kiri dan Home/End memindah pilihan + fokus; tanpa scroll horizontal di 375.
pomo      kartu Pomodoro Fokus Hari Ini (spec §6) dengan task "Laporan bulanan" difokuskan; jam Playwright dipasang ke
          tengah hari. Latar diganti lewat <html data-herobg> (diamati useThemeAttrs, sama dengan jalur Pengaturan).
          - berjalan 18:42 untuk 6 latar x 3 palet x 2 mode @1280x900 (pomo-<latar>-<palet>-<mode>.png) + lembar kontak
            sheet-pomo.png;
          - Sakura terang + Default gelap @1280 dan @375: Zen (berjalan), menunggu pilihan, Overtime, istirahat untuk 6
            latar (pomo-[375-]<status>-<latar>-<palet>-<mode>.png, lembar sheet-pomo-states*.png) + bar ringkas sticky per
            status (mini-[375-]<status>-<palet>-<mode>.png);
          - @375 berjalan 6 latar (pomo-375-<latar>-<palet>-<mode>.png, sheet-pomo-375.png).
          Cek tiap tangkapan: lapisan .hb.hb-pomo.hb-k-<latar> = anak pertama kartu, fitur tampil @1280 / tersembunyi
          @375 (pohon Lanskap .hb-trees juga tersembunyi @375), gambar fitur tidak menimpa kontrol/teks kartu, tanpa
          gradien navy lama, warna waktu = versi teks fase
          (terang #dc2626/#15803d/#6d28d9, gelap #f87171/#4ade80/#c4b5fd), tanpa scroll horizontal @375, dan KONTRAS teks
          kartu terhadap piksel latar nyata (teks dibuat transparan lalu ditangkap ulang; persentil 10 terburuk per baris
          teks >= 4,5:1, teks besar >= 3:1; tombol utama berwarna dilewati karena tidak berubah). Bar ringkas: latar =
          --bg-card palet, kontras teks yang sama.
Keluaran: temporary_files/e2e_latar_hero/ (lokal, tidak di-commit).
"""
import io
import os
import shutil
import subprocess
import sys
import tempfile
from datetime import datetime

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
# Nama tampilan panjang (cek lebar hero): sapaan memenuhi kolom teks hero (maks 420 px) dan terbungkus dua baris.
LONG_USER = ("heropanjang", "Raden Ajeng Kartika Wulandari Prameswari")

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
        if mobile:
            # HP: ambient Objek 3D disembunyikan (bola tunggal di antara chip dan tangkap cepat); Galaksi tetap (mask).
            amb = p.evaluate("() => getComputedStyle(document.querySelector('.dash-hero > .hb .hb-ambient')).display")
            ok = ok and (amb == "none") == (kind == "objek")
            info["ambient"] = amb
        # Kelopak tema (Sakura/Lavender) tidak boleh menimpa gambar fitur latar.
        pet = [r for r in rects(p, ".dash-hero-top > .decor-page-corner svg") if r["w"] > 0]
        feat = feature_rect(p)
        overlap = bool(pet and feat and intersects(pet[0], feat))
        check("hero %s" % tag, ok and not overlap, repr(dict(info, petalOverFeature=overlap)) if not ok or overlap else "")
        if not mobile and not width:
            cons = text_contrast(p, ".dash-hero")
            bad = [(round(r, 2), t, lbl) for r, t, lbl in cons if r < t]
            worst = min(cons)[0] if cons else 0
            HERO_WORST[tag] = worst
            check("hero %s: kontras teks di atas latar (min %.2f, %d baris)" % (tag, worst, len(cons)), cons and not bad, repr(bad[:6]))
        path = os.path.join(SHOTS, "hero-%s.png" % tag)
        p.locator(".dash-hero").screenshot(path=path, animations="disabled", caret="hide")
        return path
    finally:
        ctx.close()


HERO_WIDTH_JS = """() => { const h = document.querySelector('.dash-hero'), cs = getComputedStyle(h);
    return {hero: Math.round(h.getBoundingClientRect().width),
            content: Math.round(h.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)),
            feature: getComputedStyle(h.querySelector('.hb-feature')).display}; }"""


def hero_widths(browser, base, user):
    """Hero sempit (menu lengkap / sidebar ikon di 1101-1280 px) + nama tampilan panjang: gambar fitur latar tidak
    beririsan dengan kolom teks hero (sapaan, ringkasan) di 6 latar. Fitur yang tidak muat disembunyikan (container)."""
    for vw, full in ((1101, True), (1180, True), (1280, True), (1101, False)):
        for k in KINDS:
            ctx, p = new_page(browser, base, user, "sakura", "light", k, width=vw)
            try:
                hd.wait_dashboard_ready(p)
                if full:
                    btn = p.locator("button[aria-label='Tampilkan semua menu']")
                    if btn.count() and btn.first.is_visible():
                        btn.first.click()
                        p.wait_for_timeout(400)
                p.mouse.move(2, 2)
                p.wait_for_timeout(150)
                m = p.evaluate(HERO_WIDTH_JS)
                text = rects(p, ".dash-hero-text")[0]
                feat = feature_rect(p)
                hit = bool(feat and intersects(feat, text))
                tag = "%d%s %s" % (vw, "+menu" if full else "", k)
                note = "hero %d, isi %d, teks %d..%d, fitur %s" % (
                    m["hero"], m["content"], text["l"], text["r"],
                    "tersembunyi" if m["feature"] == "none" else ("-" if not feat else "%d..%d" % (feat["l"], feat["r"])))
                # Nama panjang benar-benar memenuhi kolom teks (maks 420 px), jadi cek ini menguji kasus terburuk.
                check("lebar hero %s: fitur tidak beririsan dengan kolom teks (%s)" % (tag, note),
                      not hit and text["w"] >= 400, "fitur %r, teks %r" % (feat, text) if hit or text["w"] < 400 else "")
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


HERO_WORST = {}


def run_hero(browser, base, user, user_long):
    hero_widths(browser, base, user_long)
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
    low = sorted(HERO_WORST.items(), key=lambda kv: kv[1])[:5]
    print("kontras teks hero terendah:", ", ".join("%s %.2f" % kv for kv in low), flush=True)


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
        lab = group.evaluate("""(g) => [g.getAttribute('aria-label'), g.getAttribute('aria-labelledby'),
            (document.getElementById(g.getAttribute('aria-labelledby')) || {}).textContent]""")
        check("s1b nama radiogroup dari label tampak (aria-labelledby, tanpa aria-label)",
              lab == [None, "theme-herobg-label", "Latar"], repr(lab))
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
        p.keyboard.press("End")
        p.wait_for_function("() => document.documentElement.dataset.herobg === 'polos'", timeout=5000)
        f3 = p.evaluate("() => document.activeElement && document.activeElement.textContent")
        p.keyboard.press("Home")
        p.wait_for_function("() => document.documentElement.dataset.herobg === 'kontur'", timeout=5000)
        f4 = p.evaluate("() => document.activeElement && document.activeElement.textContent")
        check("s6b End/Home -> pilihan terakhir/pertama + fokus", "Polos" in (f3 or "") and "Kontur" in (f4 or ""),
              repr((f3, f4)))
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


# ---------- Kartu Pomodoro (spec §6) ----------

FOCUS_TITLE = hd.FOCUS_TITLE
# Warna waktu (versi teks fase) per mode: [berjalan/menunggu, istirahat, Overtime].
TIME_INK = {"light": {"work": (220, 38, 38), "break": (21, 128, 61), "overtime": (109, 40, 217)},
            "dark": {"work": (248, 113, 113), "break": (74, 222, 128), "overtime": (196, 181, 253)}}
STATE_INK = {"running": "work", "zen": "work", "awaiting": "work", "overtime": "overtime", "break": "break"}


def open_focus(browser, base, user, palette, mode, kind, mobile=False):
    """Konteks baru (jam Playwright = tengah hari lokal, dipasang sebelum muat) → Fokus Hari Ini, task difokuskan."""
    extra = {"is_mobile": True, "has_touch": True} if mobile else {}
    ctx = browser.new_context(service_workers="block", viewport=MOBILE if mobile else DESKTOP,
                              timezone_id="Asia/Jakarta", reduced_motion="reduce", **extra)
    ctx.add_cookies([{"name": "token", "value": user["token"], "url": base, "httpOnly": True, "sameSite": "Lax"}])
    ctx.clock.install(time=datetime.now().replace(hour=12, minute=0, second=0, microsecond=0))
    p = ctx.new_page()
    p.goto(base + "/manifest.json")
    p.evaluate("""([t, u, tours, sw, mode, palette, kind]) => {
        localStorage.setItem('tf_token', t); localStorage.setItem('tf_user_id', String(u));
        for (const pg of tours) localStorage.setItem('tf_tour_' + pg, '1');
        localStorage.setItem('tf_whatsnew_seen', sw);
        localStorage.setItem('tf_dismiss_onboarding', '1');
        localStorage.setItem('tf_theme', mode);
        localStorage.setItem('tf_palette', palette);
        localStorage.setItem('tf_herobg', kind);
        localStorage.setItem('tf_groupby', 'none');
        localStorage.setItem('tf_viewmode', 'normal');
    }""", [user["token"], user["id"], hd.TOURS, hd.sw_version(), mode, palette, kind])
    p.goto(base + "/")
    p.locator(".sidebar-link, .sidebar-rail-btn, .mobile-topbar").first.wait_for(state="attached", timeout=30000)
    link = p.locator(".sidebar-link").filter(has_text="Fokus Hari Ini").first
    topbar = p.locator(".mobile-topbar button")
    if topbar.count() and topbar.first.is_visible():
        topbar.first.click()
        p.wait_for_timeout(600)
    elif not link.is_visible():
        p.locator("button[aria-label='Tampilkan semua menu']").first.click()
    link.click()
    p.locator(".focus-pomo").wait_for(state="visible", timeout=30000)
    row = p.locator(".ftask").filter(has_text=FOCUS_TITLE).first
    row.wait_for(state="visible", timeout=30000)
    row.locator(".ftask-focus-btn").click()
    try:
        p.locator(".focus-pomo .focus-pomo-task").wait_for(state="visible", timeout=10000)
    except PlaywrightTimeout:
        # Sesekali klik pertama jatuh saat daftar masih dirender ulang (sinkron awal): ulangi sekali.
        row.locator(".ftask-focus-btn").click()
        p.locator(".focus-pomo .focus-pomo-task").wait_for(state="visible", timeout=10000)
    p.evaluate("() => document.fonts.ready")
    p.wait_for_timeout(300)
    return ctx, p


def advance(p, dur):
    p.clock.fast_forward(dur)
    p.clock.run_for(1000)
    p.wait_for_timeout(300)


def start_work(p):
    p.locator(".focus-pomo .pomo-btn-main").first.click()
    p.locator(".focus-pomo .pomo-btn-main.is-pause").wait_for(timeout=5000)
    advance(p, "06:17")  # 25:00 → 18:42 (seperti mockup)


# Kartu tepat di bawah top bar sticky/fixed (tangkapan elemen tidak tertimpa top bar).
CARD_TOP_JS = """() => { const c = document.querySelector('.focus-pomo'); if (!c) return;
    let sp = c.parentElement;
    while (sp && sp !== document.body && !(/(auto|scroll)/.test(getComputedStyle(sp).overflowY) && sp.scrollHeight > sp.clientHeight)) sp = sp.parentElement;
    if (!sp || sp === document.body) sp = document.scrollingElement;
    sp.scrollTop = 0;
    let bar = 0;
    for (const el of document.querySelectorAll('body *')) {
        const cs = getComputedStyle(el);
        if ((cs.position !== 'fixed' && cs.position !== 'sticky') || el.closest('.focus-mini-anchor') || c.contains(el)) continue;
        const r = el.getBoundingClientRect();
        if (r.top <= 1 && r.height > 0 && r.height < 200 && r.width > 200) bar = Math.max(bar, r.bottom);
    }
    const t = c.getBoundingClientRect().top;
    if (t < bar + 8) sp.scrollTop += t - bar - 8; }"""


def card_top(p):
    p.evaluate(CARD_TOP_JS)
    p.mouse.move(2, 2)
    p.wait_for_timeout(250)


def set_kind(p, kind):
    p.evaluate("(k) => { localStorage.setItem('tf_herobg', k); document.documentElement.dataset.herobg = k; }", kind)
    p.wait_for_function("(k) => { const h = document.querySelector('.focus-pomo > .hb');"
                        " return h && h.classList.contains('hb-k-' + k); }", arg=kind, timeout=5000)
    p.wait_for_timeout(120)


# Teks di kartu: tiap node teks (Range → kotak baris) + placeholder input + select; warna = color elemen induk.
TEXT_JS = """([sel, skip]) => {
    const root = document.querySelector(sel); if (!root) return [];
    const out = [], cr = root.getBoundingClientRect();
    const vis = (el) => { for (let e = el; e && e !== root.parentElement; e = e.parentElement) {
        const cs = getComputedStyle(e); if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) return false; }
        return true; };
    const push = (el, rects, color, label) => {
        const cs = getComputedStyle(el);
        for (const r of rects) { if (r.width < 2 || r.height < 2) continue;
            const l = Math.max(r.left, cr.left), t = Math.max(r.top, cr.top), rr = Math.min(r.right, cr.right), b = Math.min(r.bottom, cr.bottom);
            if (rr - l < 2 || b - t < 2) continue;
            out.push({x: l - cr.left, y: t - cr.top, w: rr - l, h: b - t, color, size: parseFloat(cs.fontSize),
                      weight: parseInt(cs.fontWeight, 10) || 400, label}); }
    };
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const el = n.parentElement; if (!n.textContent.trim() || !el || el.closest(skip) || !vis(el)) continue;
        if (el.closest('select, option, .sr-only')) continue;
        const r = document.createRange(); r.selectNodeContents(n);
        push(el, [...r.getClientRects()], getComputedStyle(el).color, (el.className && el.className.baseVal === undefined ? el.className : el.tagName) + ': ' + n.textContent.trim().slice(0, 24));
    }
    for (const inp of root.querySelectorAll('input[type=text]')) {
        if (inp.value || !vis(inp)) continue;
        const cs = getComputedStyle(inp), r = inp.getBoundingClientRect(), pl = parseFloat(cs.paddingLeft), pr = parseFloat(cs.paddingRight);
        const fs = parseFloat(getComputedStyle(inp, '::placeholder').fontSize) || parseFloat(cs.fontSize);
        const cy = r.top + r.height / 2, h = fs * 1.2;
        push(inp, [{left: r.left + pl, right: Math.min(r.right - pr, r.left + pl + inp.placeholder.length * fs * 0.5), top: cy - h / 2, bottom: cy + h / 2,
                    width: 99, height: h}], getComputedStyle(inp, '::placeholder').color, 'placeholder');
    }
    for (const s of root.querySelectorAll('select')) { if (!vis(s)) continue;
        const r = s.getBoundingClientRect(), cs = getComputedStyle(s);
        push(s, [{left: r.left + 8, right: r.right - 18, top: r.top + 4, bottom: r.bottom - 4, width: r.width, height: r.height}], cs.color, 'select'); }
    return out;
}"""
HIDE_TEXT = ("{sel}, {sel} * {{ color: transparent !important; -webkit-text-fill-color: transparent !important;"
             " caret-color: transparent !important; }} {sel} ::placeholder {{ color: transparent !important; }}")
SKIP_TEXT = ".pomo-btn-main, .pomo-btn-break, .pomo-btn-overtime"


def parse_rgba(s):
    """rgb()/rgba() atau color(srgb r g b [/ a]) (hasil color-mix di Chromium, kanal 0..1) → [r, g, b, a] (0..255)."""
    body = s[s.index("(") + 1:s.rindex(")")]
    srgb = body.startswith("srgb")
    if srgb:
        body = body[4:]
    nums = [float(x) for x in body.replace("/", ",").replace(" ", ",").split(",") if x]
    rgb = [v * 255 for v in nums[:3]] if srgb else nums[:3]
    return rgb + [nums[3] if len(nums) > 3 else 1.0]


def lum(c):
    def ch(v):
        v /= 255
        return v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4
    return 0.2126 * ch(c[0]) + 0.7152 * ch(c[1]) + 0.0722 * ch(c[2])


def ratio(a, b):
    la, lb = sorted((lum(a), lum(b)), reverse=True)
    return (la + 0.05) / (lb + 0.05)


def text_contrast(p, sel):
    """Kontras tiap baris teks vs piksel latar sesungguhnya (teks transparan, tangkap ulang). → [(rasio, ambang, label)]."""
    items = p.evaluate(TEXT_JS, [sel, SKIP_TEXT])
    box = p.evaluate("(s) => { const r = document.querySelector(s).getBoundingClientRect();"
                     " return {x: r.left, y: r.top, width: r.width, height: r.height}; }", sel)
    tag = p.add_style_tag(content=HIDE_TEXT.format(sel=sel))
    p.wait_for_timeout(60)
    png = p.screenshot(clip=box, animations="disabled", caret="hide")
    tag.evaluate("(e) => e.remove()")
    img = Image.open(io.BytesIO(png)).convert("RGB")
    sx, sy = img.width / box["width"], img.height / box["height"]
    out = []
    for it in items:
        fg = parse_rgba(it["color"])
        x0, y0 = int(it["x"] * sx), int(it["y"] * sy)
        x1, y1 = max(x0 + 1, int((it["x"] + it["w"]) * sx)), max(y0 + 1, int((it["y"] + it["h"]) * sy))
        crop = img.crop((x0, y0, min(x1, img.width), min(y1, img.height)))
        px = list(crop.getdata())[::3] or [(255, 255, 255)]
        rs = sorted(ratio([fg[i] * fg[3] + bg[i] * (1 - fg[3]) for i in range(3)], bg) for bg in px)
        worst = rs[len(rs) // 10]
        large = it["size"] >= 24 or (it["size"] >= 18.66 and it["weight"] >= 700)
        out.append((worst, 3.0 if large else 4.5, it["label"]))
    return out


FEATURE_JS = """() => { const f = document.querySelector('.focus-pomo > .hb .hb-feature');
    if (!f || getComputedStyle(f).display === 'none') return null;
    const card = document.querySelector('.focus-pomo').getBoundingClientRect();
    const g = [...f.querySelectorAll('path, circle, ellipse, rect, polygon')].filter(e => !e.closest('defs, mask, pattern, clipPath'))
        .map(e => e.getBoundingClientRect()).filter(r => r.width > 0 && r.height > 0);
    if (!g.length) return null;
    const r = {l: Math.max(card.left, Math.min(...g.map(r => r.left))), t: Math.max(card.top, Math.min(...g.map(r => r.top))),
               r: Math.min(card.right, Math.max(...g.map(r => r.right))), b: Math.min(card.bottom, Math.max(...g.map(r => r.bottom)))};
    return r.r > r.l && r.b > r.t ? r : null; }"""
# Elemen kartu yang tidak boleh tertimpa gambar fitur (jarak aman 4 px).
CARD_PARTS = (".focus-pomo-headline, .focus-pomo .focus-zen-btn, .focus-pomo .pomo-modes, .focus-pomo .pomo-controls .pomo-btn, "
              ".focus-pomo .pomo-park, .focus-pomo .focus-pomo-task, .focus-pomo .focus-pomo-hint, .focus-pomo .focus-pomo-stat, "
              ".focus-pomo .pomo-ambient, .focus-pomo-ring")


def inspect_pomo(p, kind, mode, state, tag, mobile):
    info = p.evaluate("""() => { const c = document.querySelector('.focus-pomo'), hb = c.querySelector(':scope > .hb');
        const f = hb && hb.querySelector('.hb-feature'), cs = getComputedStyle(c);
        return {first: c.firstElementChild === hb, cls: hb ? hb.className : null, feature: f ? getComputedStyle(f).display : null,
                featureHtml: f ? f.innerHTML.length : 0, bg: cs.backgroundImage + ' ' + cs.backgroundColor, inline: c.style.background,
                time: getComputedStyle(c.querySelector('.focus-pomo-time')).color,
                sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth}; }""")
    ok = info["first"] and info["cls"] == "hb hb-pomo hb-k-" + kind and bool(info["inline"])
    if mobile:
        ok = ok and info["feature"] == "none" and info["sw"] <= info["cw"]
    else:
        ok = ok and (info["feature"] != "none" or info["featureHtml"] == 0)
    if kind == "lanskap":
        # Pohon Lanskap (ambient, pojok kiri bawah) tampil di desktop, tersembunyi di HP (di balik input parkir).
        trees = p.evaluate("() => { const t = document.querySelector('.focus-pomo > .hb .hb-trees'); return t ? getComputedStyle(t).display : null; }")
        ok = ok and trees is not None and (trees == "none") == bool(mobile)
        info["trees"] = trees
    navy = any(x in info["bg"] for x in ("30, 41, 59", "15, 23, 42"))
    ink = tuple(int(round(v)) for v in parse_rgba(info["time"])[:3])
    want = TIME_INK[mode][STATE_INK[state]]
    feat = p.evaluate(FEATURE_JS)
    hits = []
    if feat:
        for r in rects(p, CARD_PARTS):
            if r["w"] > 0 and r["l"] - 4 < feat["r"] and feat["l"] < r["r"] + 4 and r["t"] - 4 < feat["b"] and feat["t"] < r["b"] + 4:
                hits.append("%d,%d-%d,%d" % (r["l"], r["t"], r["r"], r["b"]))
    check("pomo %s: lapisan + fitur + tanpa navy + waktu %s" % (tag, want),
          ok and not navy and ink == want, repr(dict(info, ink=ink, navy=navy)) if not (ok and not navy and ink == want) else "")
    check("pomo %s: fitur latar tidak menimpa kontrol/teks" % tag, not hits, "fitur %r menimpa %s" % (feat, hits) if hits else "")
    cons = text_contrast(p, ".focus-pomo")
    bad = [(round(r, 2), t, lbl) for r, t, lbl in cons if r < t]
    worst = min(cons)[0] if cons else 0
    check("pomo %s: kontras teks di atas latar (min %.2f, %d baris)" % (tag, worst, len(cons)), cons and not bad, repr(bad[:6]))
    return worst


def show_mini(p):
    """Gulir sampai kartu penuh keluar layar; viewport dipendekkan bila halaman kurang panjang."""
    for _ in range(2):
        p.evaluate("() => { const l = [...document.querySelectorAll('.ftask')].pop(); if (l) l.scrollIntoView({block: 'end'});"
                   " window.scrollBy(0, 2000); }")
        p.wait_for_timeout(500)
        try:
            p.wait_for_selector(".focus-mini.is-visible", timeout=2500)
            return True
        except PlaywrightTimeout:
            vs = p.viewport_size
            p.set_viewport_size({"width": vs["width"], "height": 420})
    return False


def shoot_mini(p, mode, state, tag, size):
    vis = show_mini(p)
    check("mini %s: bar ringkas tampil" % tag, vis)
    if vis:
        p.mouse.move(2, 2)
        p.wait_for_timeout(250)
        info = p.evaluate("""() => { const m = document.querySelector('.focus-mini'), probe = document.createElement('div');
            probe.style.background = 'var(--bg-card)'; document.body.appendChild(probe);
            const want = getComputedStyle(probe).backgroundColor; probe.remove();
            return {bg: getComputedStyle(m).backgroundColor, want, img: getComputedStyle(m).backgroundImage,
                    time: getComputedStyle(m.querySelector('.focus-mini-time')).color,
                    sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth}; }""")
        ink = tuple(int(round(v)) for v in parse_rgba(info["time"])[:3])
        ok = info["bg"] == info["want"] and info["img"] == "none" and ink == TIME_INK[mode][STATE_INK[state]]
        if "375" in tag:
            ok = ok and info["sw"] <= info["cw"]
        check("mini %s: latar --bg-card tanpa ilustrasi, waktu versi teks fase" % tag, ok, repr(dict(info, ink=ink)) if not ok else "")
        cons = text_contrast(p, ".focus-mini")
        bad = [(round(r, 2), t, lbl) for r, t, lbl in cons if r < t]
        check("mini %s: kontras teks (min %.2f)" % (tag, min(cons)[0] if cons else 0), cons and not bad, repr(bad[:6]))
        p.locator(".focus-mini").screenshot(path=os.path.join(SHOTS, "mini-%s.png" % tag), animations="disabled", caret="hide")
    if p.viewport_size["height"] != size["height"]:
        p.set_viewport_size(size)
        p.wait_for_timeout(250)
    card_top(p)


def shoot_kinds(p, palette, mode, state, mobile, shots, worst):
    for k in KINDS:
        set_kind(p, k)
        card_top(p)
        tag = ("375-" if mobile else "") + ("" if state == "running" else state + "-") + "%s-%s-%s" % (k, palette, mode)
        worst[tag] = inspect_pomo(p, k, mode, state, tag, mobile)
        path = os.path.join(SHOTS, "pomo-%s.png" % tag)
        p.locator(".focus-pomo").screenshot(path=path, animations="disabled", caret="hide")
        shots[(state, k, palette, mode)] = path


def pomo_grid(browser, base, user, worst):
    """Berjalan @1280: 6 latar x 3 palet x 2 mode."""
    shots = {}
    for pl in PALETTES:
        for m in MODES:
            ctx, p = open_focus(browser, base, user, pl, m, KINDS[0])
            try:
                start_work(p)
                shoot_kinds(p, pl, m, "running", False, shots, worst)
            finally:
                ctx.close()
    return {(k, pl, m): v for (s, k, pl, m), v in shots.items()}


def pomo_states(browser, base, user, palette, mode, mobile, worst):
    """Zen (berjalan) → menunggu → Overtime → istirahat, 6 latar per status + bar ringkas per status."""
    shots = {}
    size = MOBILE if mobile else DESKTOP
    pre = "375-" if mobile else ""
    ctx, p = open_focus(browser, base, user, palette, mode, KINDS[0], mobile)
    try:
        if not mobile:
            p.locator(".focus-pomo .focus-zen-btn").click()
            p.wait_for_timeout(200)
        start_work(p)
        if mobile:
            shoot_kinds(p, palette, mode, "running", True, shots, worst)
            shoot_mini(p, mode, "running", pre + "running-%s-%s" % (palette, mode), size)
        else:
            check("pomo zen %s-%s: Zen menyala (aria-pressed, kartu is-running)" % (palette, mode),
                  p.locator(".focus-zen-btn").get_attribute("aria-pressed") == "true"
                  and p.locator(".focus-page.is-zen").count() == 1)
            shoot_kinds(p, palette, mode, "zen", False, shots, worst)
            shoot_mini(p, mode, "zen", "zen-%s-%s" % (palette, mode), size)
        advance(p, "18:42")
        p.locator(".focus-pomo .pomo-controls.is-awaiting .pomo-btn-break").wait_for(timeout=8000)
        p.wait_for_timeout(300)
        shoot_kinds(p, palette, mode, "awaiting", mobile, shots, worst)
        shoot_mini(p, mode, "awaiting", pre + "awaiting-%s-%s" % (palette, mode), size)
        p.locator(".focus-pomo .pomo-btn-overtime").click()
        p.wait_for_timeout(300)
        advance(p, "05:00")
        p.locator(".focus-pomo.is-overtime").wait_for(timeout=5000)
        shoot_kinds(p, palette, mode, "overtime", mobile, shots, worst)
        shoot_mini(p, mode, "overtime", pre + "overtime-%s-%s" % (palette, mode), size)
        p.locator(".focus-pomo .pomo-controls.is-overtime .pomo-btn-break").click()
        p.locator(".focus-pomo.is-break .pomo-btn-main.is-pause").wait_for(timeout=5000)
        advance(p, "01:45")
        shoot_kinds(p, palette, mode, "break", mobile, shots, worst)
        shoot_mini(p, mode, "break", pre + "break-%s-%s" % (palette, mode), size)
    finally:
        ctx.close()
    return shots


MEASURE_JS = """() => { const c = document.querySelector('.focus-pomo'), cr = c.getBoundingClientRect(), cs = getComputedStyle(c);
    const left = cr.left + parseFloat(cs.borderLeftWidth) + parseFloat(cs.paddingLeft);
    const cw = c.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const btns = [...c.querySelectorAll('.pomo-controls .pomo-btn')].map(b => b.getBoundingClientRect().right);
    return {content: Math.round(cw), ctrlRight: Math.round(Math.max(...btns) - left), cardLeft: Math.round(cr.left)}; }"""


def pomo_widths(browser, base, user):
    """Desktop sempit (sidebar ikon / menu lengkap): fitur latar tidak menimpa tombol di status berjalan/menunggu/Overtime;
    fitur tetap tampil bila muat (1280 + sidebar ikon). Hanya cek posisi, tanpa tangkapan."""
    for vw in (1101, 1180, 1280, 1440):
        for full in (False, True):
            ctx, p = open_focus(browser, base, user, "sakura", "light", "galaksi")
            try:
                p.set_viewport_size({"width": vw, "height": 900})
                start_work(p)
                if full:
                    btn = p.locator("button[aria-label='Tampilkan semua menu']")
                    if btn.count() and btn.first.is_visible():
                        btn.first.click()
                        p.wait_for_timeout(400)
                for state in ("running", "overtime", "awaiting"):
                    if state == "overtime":
                        advance(p, "18:42")
                        p.locator(".focus-pomo .pomo-btn-overtime").wait_for(timeout=8000)
                        p.locator(".focus-pomo .pomo-btn-overtime").click()
                        advance(p, "01:00")
                    if state == "awaiting":
                        # Overtime → Stop → Mulai → habis lagi = menunggu pilihan.
                        p.locator(".focus-pomo .pomo-controls.is-overtime button[aria-label=Stop]").click()
                        p.wait_for_timeout(300)
                        p.locator(".focus-pomo .pomo-btn-main").first.click()
                        advance(p, "25:00")
                        p.locator(".focus-pomo .pomo-controls.is-awaiting").wait_for(timeout=8000)
                    m = p.evaluate(MEASURE_JS)
                    for k in ("kontur", "galaksi", "objek"):
                        set_kind(p, k)
                        feat = p.evaluate(FEATURE_JS)
                        hits = [r for r in rects(p, CARD_PARTS) if feat and r["w"] > 0 and r["l"] - 4 < feat["r"]
                                and feat["l"] < r["r"] + 4 and r["t"] - 4 < feat["b"] and feat["t"] < r["b"] + 4]
                        tag = "%d%s %s %s" % (vw, "+menu" if full else "", state, k)
                        note = "isi %d, tombol s.d. %d, fitur %s" % (m["content"], m["ctrlRight"],
                                                                     "-" if not feat else "%d..%d" % (feat["l"] - m["cardLeft"], feat["r"] - m["cardLeft"]))
                        check("lebar %s: fitur tidak menimpa tombol (%s)" % (tag, note), not hits, repr(hits[:2]) if hits else "")
                        if vw == 1280 and not full and state == "running":
                            check("lebar %s: fitur tampil bila muat" % tag, feat is not None)
                    set_kind(p, "galaksi")
            finally:
                ctx.close()


def labeled_sheet(cells, cols, path, sc=0.5):
    """cells = [[(label, path)]] per baris."""
    pad, label_h = 12, 20
    imgs = {pth: Image.open(pth).convert("RGB") for row in cells for _, pth in row}
    cw = max(int(i.width * sc) for i in imgs.values())
    ch = max(int(i.height * sc) for i in imgs.values())
    W = pad + cols * (cw + pad)
    H = pad + len(cells) * (ch + label_h + pad)
    sheet = Image.new("RGB", (W, H), (236, 238, 242))
    dr = ImageDraw.Draw(sheet)
    for ri, row in enumerate(cells):
        y = pad + ri * (ch + label_h + pad)
        for ci, (label, pth) in enumerate(row):
            x = pad + ci * (cw + pad)
            dr.text((x, y + 4), label, fill=(30, 30, 40))
            im = imgs[pth]
            sheet.paste(im.resize((int(im.width * sc), int(im.height * sc)), Image.LANCZOS), (x, y + label_h))
    sheet.save(path)
    print("lembar kontak", path, flush=True)


def run_pomo(browser, base, user):
    worst = {}
    only = os.environ.get("POMO_ONLY", "")  # iterasi lokal: "grid" / "states" / "375" / "widths"
    if only in ("", "widths"):
        pomo_widths(browser, base, user)
    if only in ("", "grid"):
        grid = pomo_grid(browser, base, user, worst)
        contact_sheet(grid, os.path.join(SHOTS, "sheet-pomo.png"))
        print("lembar kontak", os.path.join(SHOTS, "sheet-pomo.png"), flush=True)
    for mobile in (False, True):
        if only and only != ("375" if mobile else "states"):
            continue
        st = {}
        for pl, m in (("sakura", "light"), ("default", "dark")):
            st.update(pomo_states(browser, base, user, pl, m, mobile, worst))
        states = ("running", "awaiting", "overtime", "break") if mobile else ("zen", "awaiting", "overtime", "break")
        for pl, m in (("sakura", "light"), ("default", "dark")):
            cells = [[("%s · %s · %s %s" % (NAMES[k], s, pl, m), st[(s, k, pl, m)]) for s in states] for k in KINDS]
            name = "sheet-pomo-states%s-%s-%s.png" % ("-375" if mobile else "", pl, m)
            labeled_sheet(cells, len(states), os.path.join(SHOTS, name), 0.5 if not mobile else 0.8)
    low = sorted(worst.items(), key=lambda kv: kv[1])[:5]
    print("kontras teks terendah:", ", ".join("%s %.2f" % kv for kv in low), flush=True)


def clean(parts):
    os.makedirs(SHOTS, exist_ok=True)
    pre = {"hero": ("hero-", "sheet-hero"), "settings": ("settings-",), "pomo": ("pomo-", "mini-", "sheet-pomo")}
    if os.environ.get("POMO_ONLY"):
        parts = set(parts) - {"pomo"}  # iterasi sebagian: tangkapan pomo lain dibiarkan
    for f in os.listdir(SHOTS):
        if any(f.startswith(x) for part in parts for x in pre[part]):
            os.remove(os.path.join(SHOTS, f))


def main():
    parts = set(sys.argv[1:]) or {"hero", "settings", "pomo"}
    clean(parts)
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
                run_hero(browser, base, user, hd.seed(base, *LONG_USER))
            if "pomo" in parts:
                run_pomo(browser, base, user)
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
