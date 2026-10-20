"""E2E halaman Fokus Hari Ini PR D: Suara latar. Tidak dijalankan CI.

Skenario: a preferensi default -> 0 request /static/sounds/, select Off, slider disabled
b pilih Hujan -> tepat 1 request hujan-v1.ogg|mp3, status idle (timer belum jalan), tidak berbunyi
c Mulai -> berbunyi, gain ~0,5; Jeda -> paused, gain 0; Mulai lagi, Stop -> currentTime 0
d 00:00 (awaiting) -> berhenti; Lanjut Fokus -> berbunyi; Ambil Istirahat -> berhenti, tetap diam selama istirahat
e volume 20 -> gain ~0,2; Off -> paused
f pindah ke Semua Task -> tetap berbunyi, satu elemen audio; kembali -> kontrol tetap Hujan
g reload saat Work berjalan di browser TANPA flag autoplay -> waiting-tap (+ teks aria-live); klik -> playing
h SW aktif: Brown Noise online -> reload offline -> Brown Noise lagi bukan error (alurik-ambient-v1);
  Detak Jam (belum pernah diunduh) offline -> error, tooltip "Suara belum tersedia offline"
i reload tanpa memilih apa pun -> 0 request sebelum Work mulai; Mulai -> request diambil
Offline (h): context offline + server dimatikan, karena emulasi offline Playwright tidak mengenai fetch SW.
Screenshot terang + gelap, desktop + 375 px (kontrol di kartu, status error) dan cek tata letak 320 px:
temporary_files/e2e_focus_ambient/.

    E2E_PYTHON=/path/python-dengan-dependensi-webapp python3 temporary_files/e2e_focus_ambient.py

Status audio dibaca dari window.__ambientState() ({state, sound, volume, target, paused, gain}) dan dari elemen
<audio> yang dicatat oleh init script (window.__audios) untuk currentTime dan jumlah elemen.
"""
import os
import shutil
import subprocess
import sys
import tempfile
from datetime import datetime

from playwright.sync_api import sync_playwright

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import e2e_focus_page as h  # harness PR A: server, register, api, shot, nav, check
import e2e_focus_target as tg  # harness PR B: goto_focus, focus, start, sync, wait_for

ROOT = h.ROOT
SHOTS = os.path.join(ROOT, "temporary_files", "e2e_focus_ambient")
h.SHOTS = SHOTS
tg.SHOTS = SHOTS
check = h.check
T1 = "Tulis proposal"
OTHERS = ["Rapikan inbox", "Siapkan rapat"]
TIP_ERROR = "Suara belum tersedia offline"
TIP_TAP = "Ketuk di mana saja untuk menyalakan suara"
AUTOPLAY = ["--autoplay-policy=no-user-gesture-required"]
NO_AUTOPLAY = ["--autoplay-policy=user-gesture-required"]

# Catat setiap elemen Audio yang dibuat agar currentTime dan jumlah elemen bisa diperiksa.
SPY_AUDIO = """(() => {
    const A = window.Audio;
    window.__audios = [];
    window.Audio = function (...a) { const x = new A(...a); window.__audios.push(x); return x; };
    window.Audio.prototype = A.prototype;
})();"""


def open_app(browser, base, user, theme="light", viewport=(1280, 860), sw=False, extra_ls=None):
    """Seperti tg.open_app (jam siang lokal), plus spy Audio, opsi SW aktif, dan penghitung request suara."""
    kw = {} if sw else {"service_workers": "block"}
    ctx = browser.new_context(viewport={"width": viewport[0], "height": viewport[1]}, **kw)
    ctx.add_cookies([{"name": "token", "value": user["token"], "url": base, "httpOnly": True, "sameSite": "Lax"}])
    ctx.clock.install(time=datetime.now().replace(hour=12, minute=0, second=0, microsecond=0))
    ctx.add_init_script(SPY_AUDIO)
    ctx.sound_reqs = []
    ctx.on("request", lambda r: ctx.sound_reqs.append(r.url) if "/static/sounds/" in r.url else None)
    # (url, status, from_service_worker) untuk respons suara: membuktikan jalur cache SW di skenario h.
    ctx.sound_resps = []
    ctx.on("response", lambda r: ctx.sound_resps.append((r.url, r.status, r.from_service_worker))
           if "/static/sounds/" in r.url else None)
    p = ctx.new_page()
    p.goto(base + "/manifest.json")
    p.evaluate("""([t, u, tours, theme, extra]) => {
        localStorage.setItem('tf_token', t); localStorage.setItem('tf_user_id', String(u));
        for (const pg of tours) localStorage.setItem('tf_tour_' + pg, '1');
        localStorage.setItem('tf_dismiss_onboarding', '1');
        localStorage.setItem('tf_theme', theme);
        localStorage.setItem('tf_groupby', 'none');
        localStorage.setItem('tf_viewmode', 'normal');
        for (const [k, v] of Object.entries(extra || {})) localStorage.setItem(k, v);
    }""", [user["token"], user["id"], h.TOURS, theme, extra_ls or {}])
    tg.goto_focus(p, base)
    return ctx, p


def amb(p):
    return p.evaluate("() => window.__ambientState ? window.__ambientState() : null")


def audio_info(p):
    return p.evaluate("""() => (window.__audios || []).map(a => ({paused: a.paused, t: a.currentTime,
        src: (a.currentSrc || '').slice(0, 5)}))""")


def wait_amb(p, pred, timeout=4.0):
    """Tunggu sampai pred(state) benar (fade 1000 ms); kembalikan state terakhir."""
    end = datetime.now().timestamp() + timeout
    st = amb(p)
    while not (st and pred(st)) and datetime.now().timestamp() < end:
        p.wait_for_timeout(100)
        st = amb(p)
    return st


def near(v, goal, tol=0.03):
    return v is not None and abs(v - goal) <= tol


def ctl(p):
    return p.locator(".focus-pomo .pomo-ambient").first


def ctl_state(p):
    return ctl(p).get_attribute("data-state")


def select(p, key):
    ctl(p).locator("select.pomo-ambient-select").select_option(key)
    p.wait_for_timeout(300)


def set_volume(p, v):
    ctl(p).locator("input.pomo-ambient-volume").fill(str(v))
    p.wait_for_timeout(200)


def live_text(p):
    return ctl(p).locator("[aria-live=polite]").text_content() or ""


def card_btn(p, sel):
    p.locator(".focus-pomo " + sel).first.click()
    p.wait_for_timeout(400)


def advance(p, dur):
    p.clock.fast_forward(dur)
    p.clock.run_for(2000)
    p.wait_for_timeout(500)


def playing(st):
    return st["paused"] is False and st["state"] == "playing"


def silent(st):
    return st["paused"] is True and st["gain"] == 0


def main():
    os.makedirs(SHOTS, exist_ok=True)
    for f in os.listdir(SHOTS):
        if f.endswith(".png"):
            os.remove(os.path.join(SHOTS, f))
    tmp = tempfile.mkdtemp(prefix="e2e_focus_ambient_")
    proc, base = h.start_server(tmp)
    print("server", base, flush=True)
    try:
        user = h.register(base, "ambient")
        for t in [T1] + OTHERS:
            h.api(base, user, "POST", "/api/tasks",
                  json={"title": t, "priority": "P1", "gtd_status": "next", "deadline": h.today_iso()})
        with sync_playwright() as pw:
            browser = pw.chromium.launch(args=AUTOPLAY)
            ctx, p = open_app(browser, base, user, "light")
            try:
                run_flow(p, ctx, base)
            finally:
                ctx.close()
            strict = pw.chromium.launch(args=NO_AUTOPLAY)
            try:
                run_autoplay_rejected(strict, base, user)
            finally:
                strict.close()
            run_shots(browser, base, user)
            run_sw_offline(browser, base, user, proc)
            browser.close()
    except Exception as e:
        import traceback
        traceback.print_exc()
        check("exception", False, "%s: %s" % (type(e).__name__, e))
    finally:
        proc.terminate()
        try:
            proc.wait(10)
        except subprocess.TimeoutExpired:
            proc.kill()
        shutil.rmtree(tmp, ignore_errors=True)
    failed = [r for r in h.results if not r[1]]
    print("\n%d langkah, %d gagal" % (len(h.results), len(failed)))
    sys.exit(1 if failed else 0)


def run_flow(p, ctx, base):
    # a. preferensi default
    p.wait_for_timeout(800)
    check("a1 0 request suara saat halaman dibuka", ctx.sound_reqs == [], repr(ctx.sound_reqs))
    check("a2 kontrol tampil di kartu Pomodoro", ctl(p).is_visible())
    sel = ctl(p).locator("select.pomo-ambient-select")
    opts = sel.locator("option").evaluate_all("os => os.map(o => [o.value, o.textContent])")
    check("a3 pilihan Off/Hujan/Brown Noise/Detak Jam berurutan",
          opts == [["off", "Off"], ["hujan", "Hujan"], ["brown-noise", "Brown Noise"], ["detak-jam", "Detak Jam"]],
          repr(opts))
    vol = ctl(p).locator("input.pomo-ambient-volume")
    check("a4 select = off, slider disabled, volume 50 (aria-valuetext 50%)",
          sel.input_value() == "off" and vol.is_disabled() and vol.input_value() == "50"
          and vol.get_attribute("aria-valuetext") == "50%",
          "%s %s %s" % (sel.input_value(), vol.is_disabled(), vol.input_value()))
    check("a5 label aksesibel", sel.get_attribute("aria-label") == "Suara latar"
          and vol.get_attribute("aria-label") == "Volume suara latar")
    check("a6 data-state idle, aria-live kosong", ctl_state(p) == "idle" and live_text(p) == "")

    # b. pilih Hujan -> tepat satu request, tidak berbunyi
    select(p, "hujan")
    st = wait_amb(p, lambda s: s["state"] == "idle")
    p.wait_for_timeout(500)
    reqs = list(ctx.sound_reqs)
    check("b1 tepat 1 request hujan-v1.ogg|mp3", len(reqs) == 1
          and (reqs[0].endswith("/static/sounds/hujan-v1.ogg") or reqs[0].endswith("/static/sounds/hujan-v1.mp3")),
          repr(reqs))
    check("b2 status idle, tidak berbunyi (timer belum jalan)", st["state"] == "idle" and silent(st)
          and ctl_state(p) == "idle", repr(st))
    check("b3 slider aktif setelah memilih suara", not vol.is_disabled())
    check("b4 localStorage tf_ambient_sound = hujan",
          p.evaluate("localStorage.getItem('tf_ambient_sound')") == "hujan")

    # c. Mulai / Jeda / Stop
    tg.focus(p, T1)
    tg.start(p)
    p.wait_for_timeout(1200)
    st = wait_amb(p, lambda s: playing(s) and near(s["gain"], 0.5), timeout=2.0)
    check("c1 Mulai -> berbunyi, gain ~0,5", playing(st) and near(st["gain"], 0.5), repr(st))
    check("c2 data-state playing", ctl_state(p) == "playing")
    check("c3 sumber dari Blob URL", audio_info(p)[0]["src"] == "blob:", repr(audio_info(p)))
    card_btn(p, ".pomo-btn-main.is-pause")
    p.wait_for_timeout(1200)
    st = wait_amb(p, silent, timeout=2.0)
    check("c4 Jeda -> paused, gain 0", silent(st) and st["target"] == "pause", repr(st))
    t_paused = audio_info(p)[0]["t"]
    check("c5 Jeda mempertahankan posisi (currentTime > 0)", t_paused > 0, repr(t_paused))
    tg.start(p)
    st = wait_amb(p, lambda s: playing(s) and near(s["gain"], 0.5))
    check("c6 Mulai lagi -> berbunyi", playing(st), repr(st))
    card_btn(p, "button[aria-label=Stop]")
    st = wait_amb(p, lambda s: silent(s) and s["target"] == "stop")
    p.wait_for_timeout(200)
    ai = audio_info(p)
    check("c7 Stop -> paused, currentTime 0", silent(st) and ai[0]["t"] == 0, "%r %r" % (st, ai))
    check("c8 tetap 1 request suara", len(ctx.sound_reqs) == 1, repr(ctx.sound_reqs))

    # d. awaiting / Lanjut Fokus / Ambil Istirahat
    tg.start(p)
    st = wait_amb(p, playing)
    check("d0 Mulai -> berbunyi", playing(st), repr(st))
    advance(p, "25:00")
    tg.wait_awaiting(p)
    st = wait_amb(p, silent)
    check("d1 00:00 (awaiting) -> berhenti", silent(st) and tg.pomo_state(p).get("phase") == "awaiting", repr(st))
    card_btn(p, ".pomo-btn-overtime")
    st = wait_amb(p, lambda s: playing(s) and near(s["gain"], 0.5))
    check("d2 Lanjut Fokus (Overtime) -> berbunyi lagi", playing(st), repr(st))
    card_btn(p, ".pomo-btn-break")
    st = wait_amb(p, silent)
    ps = tg.pomo_state(p)
    check("d3 Ambil Istirahat -> berhenti (istirahat berjalan)", silent(st)
          and ps.get("mode") in ("shortBreak", "longBreak") and ps.get("isRunning") is True, "%r %r" % (st, ps))
    advance(p, "02:00")
    st = amb(p)
    check("d4 selama istirahat tetap paused", silent(st) and tg.pomo_state(p).get("isRunning") is True, repr(st))
    # kembali ke Work dan jalankan
    p.locator(".focus-pomo .pomo-mode").filter(has_text="Work").first.click()
    p.wait_for_timeout(300)
    st = wait_amb(p, silent)
    check("d5 kembali ke Work (diam) -> tetap hening", silent(st), repr(st))
    tg.start(p)
    st = wait_amb(p, lambda s: playing(s) and near(s["gain"], 0.5))
    check("d6 Work berjalan lagi -> berbunyi", playing(st), repr(st))

    # e. volume + Off
    set_volume(p, 20)
    st = wait_amb(p, lambda s: near(s["gain"], 0.2, 0.01), timeout=1.5)
    check("e1 volume 20 saat berbunyi -> gain ~0,2", playing(st) and near(st["gain"], 0.2, 0.01), repr(st))
    check("e2 aria-valuetext 20%, tersimpan", vol.get_attribute("aria-valuetext") == "20%"
          and p.evaluate("localStorage.getItem('tf_ambient_volume')") == "20")
    select(p, "off")
    st = wait_amb(p, lambda s: s["paused"] is True)
    check("e3 Off -> paused", st["paused"] is True and st["sound"] == "off" and vol.is_disabled(), repr(st))
    select(p, "hujan")
    st = wait_amb(p, lambda s: playing(s) and near(s["gain"], 0.2, 0.01))
    check("e4 Hujan lagi (Work berjalan) -> berbunyi tanpa request baru", playing(st) and len(ctx.sound_reqs) == 1,
          "%r %r" % (st, ctx.sound_reqs))

    # f. pindah halaman
    h.nav(p, "Semua Task")
    p.wait_for_timeout(1500)
    st = amb(p)
    check("f1 di Semua Task -> tetap berbunyi", p.locator(".focus-pomo").count() == 0 and playing(st), repr(st))
    check("f2 satu elemen audio saja", len(audio_info(p)) == 1, repr(audio_info(p)))
    h.nav(p, "Fokus Hari Ini")
    p.locator(".focus-pomo .pomo-ambient").wait_for(state="visible", timeout=10000)
    st = amb(p)
    check("f3 kembali -> kontrol tetap Hujan, playing", sel.input_value() == "hujan" and ctl_state(p) == "playing"
          and playing(st), "%s %r" % (sel.input_value(), st))
    check("f4 masih satu elemen audio, tetap 1 request", len(audio_info(p)) == 1 and len(ctx.sound_reqs) == 1)
    check("f5 timer tetap berjalan", tg.pomo_state(p).get("isRunning") is True)

    # i. reload tanpa memilih apa pun -> 0 request sebelum Work mulai
    card_btn(p, "button[aria-label=Stop]")
    wait_amb(p, silent)
    ctx.sound_reqs.clear()
    tg.goto_focus(p, base)
    p.wait_for_timeout(1500)
    check("i1 reload (pilihan Hujan tersimpan, timer diam) -> 0 request suara", ctx.sound_reqs == [],
          repr(ctx.sound_reqs))
    check("i2 kontrol menampilkan Hujan, volume 20", sel.input_value() == "hujan" and vol.input_value() == "20")
    tg.start(p)
    st = wait_amb(p, lambda s: playing(s) and near(s["gain"], 0.2, 0.01))
    check("i3 Work mulai -> file diambil (1 request) dan berbunyi", len(ctx.sound_reqs) == 1 and playing(st),
          "%r %r" % (ctx.sound_reqs, st))
    card_btn(p, "button[aria-label=Stop]")


def js_nav_focus(p):
    """Buka halaman Fokus tanpa user activation. page.evaluate Playwright berjalan dengan userGesture, dan aktivasi
    transien Chromium berlaku 5 detik; jadi klik sintetis dijadwalkan 8 detik kemudian, tanpa evaluate di antaranya."""
    p.evaluate("""() => { setTimeout(() => { const a = [...document.querySelectorAll('[data-page],a,button,.sidebar-link,.sidebar-rail-btn')]
        .find(x => (x.getAttribute('data-page') || '') === 'today'
              || /Fokus Hari Ini/.test((x.textContent || '') + (x.getAttribute('aria-label') || '') + (x.getAttribute('title') || '')));
        if (a) a.click(); }, 8000); }""")
    p.wait_for_timeout(8500)


def run_autoplay_rejected(browser, base, user):
    # g. reload saat Work berjalan, tanpa gesture -> play() ditolak -> waiting-tap
    ctx, p = open_app(browser, base, user, "light", extra_ls={"tf_ambient_sound": "hujan", "tf_ambient_volume": "50"})
    try:
        if p.locator(".focus-pomo .focus-pomo-task-count").count() == 0:
            tg.focus(p, T1)
        tg.start(p)  # klik = gesture: berbunyi
        st = wait_amb(p, playing)
        check("g0 (tanpa flag autoplay) Mulai dengan klik -> berbunyi", playing(st), repr(st))
        p.reload()
        p.locator(".sidebar-link, .sidebar-rail-btn").first.wait_for(state="attached", timeout=20000)
        st = wait_amb(p, lambda s: s["state"] == "waiting-tap", timeout=6)
        check("g1 reload saat Work berjalan -> waiting-tap, tidak berbunyi", st and st["state"] == "waiting-tap"
              and st["paused"] is True, repr(st))
        # Navigasi lewat klik sintetis (tanpa user activation): klik nyata akan langsung menyalakan suara.
        js_nav_focus(p)
        p.locator(".focus-pomo .pomo-ambient").wait_for(state="visible", timeout=20000)
        st = wait_amb(p, lambda s: s["state"] == "waiting-tap", timeout=6)
        check("g1b di halaman Fokus: data-state waiting-tap", st["state"] == "waiting-tap" and st["paused"] is True
              and ctl_state(p) == "waiting-tap", repr(st))
        check("g2 tooltip + aria-live waiting-tap",
              ctl(p).locator(".pomo-ambient-icon").get_attribute("title") == TIP_TAP and live_text(p) == TIP_TAP,
              "%r %r" % (ctl(p).locator(".pomo-ambient-icon").get_attribute("title"), live_text(p)))
        check("g3 timer tetap berjalan", tg.pomo_state(p).get("isRunning") is True)
        p.locator(".focus-page-summary").click()
        st = wait_amb(p, lambda s: playing(s) and near(s["gain"], 0.5))
        check("g4 klik di halaman -> playing", playing(st) and ctl_state(p) == "playing" and live_text(p) == "",
              repr(st))
        h.shot(p, "waiting_tap_after_click_light_desktop.png")
        card_btn(p, "button[aria-label=Stop]")
    finally:
        ctx.close()


def run_sw_offline(browser, base, user, proc):
    # h. SW aktif: suara yang pernah diunduh tersedia offline dari alurik-ambient-v1
    ctx, p = open_app(browser, base, user, "light", sw=True, extra_ls={"tf_ambient_sound": "off"})
    try:
        ok = tg.wait_for(lambda: p.evaluate("() => !!(navigator.serviceWorker && navigator.serviceWorker.controller)"),
                         timeout=20)
        if not ok:
            tg.goto_focus(p, base)
            ok = p.evaluate("() => !!(navigator.serviceWorker && navigator.serviceWorker.controller)")
        check("h0 SW mengendalikan halaman", ok)
        if p.locator(".focus-pomo .pomo-ambient").count() == 0:
            tg.goto_focus(p, base)
        select(p, "brown-noise")
        st = wait_amb(p, lambda s: s["state"] == "idle")
        cached = tg.wait_for(lambda: p.evaluate("""async () => { const c = await caches.open('alurik-ambient-v1');
            return (await c.keys()).map(r => new URL(r.url).pathname); }"""), timeout=10)
        check("h1 Brown Noise online -> idle, tersimpan di alurik-ambient-v1",
              st["state"] == "idle" and cached and all("brown-noise-v1" in u for u in cached), "%r %r" % (st, cached))
        names = p.evaluate("() => caches.keys()")
        check("h2 cache SW versi aktif + alurik-ambient-v1", "taskflow-v440-focus-ambient" in names
              and "alurik-ambient-v1" in names, repr(names))
        # Kosongkan cache HTTP browser (dipakai bersama oleh halaman dan fetch SW) dan matikan untuk halaman ini:
        # StaticFiles mengirim ETag/Last-Modified tanpa Cache-Control, sehingga cache heuristik Chromium bisa
        # menyajikan file dan membuat h4 lulus tanpa melewati alurik-ambient-v1. CacheStorage tidak ikut terhapus.
        cdp = ctx.new_cdp_session(p)
        cdp.send("Network.enable")
        cdp.send("Network.clearBrowserCache")
        cdp.send("Network.setCacheDisabled", {"cacheDisabled": True})
        still = p.evaluate("""async () => (await (await caches.open('alurik-ambient-v1')).keys())
            .map(r => new URL(r.url).pathname)""")
        check("h2b cache HTTP dikosongkan; alurik-ambient-v1 tetap berisi Brown Noise",
              any("brown-noise-v1" in u for u in still), repr(still))
        # set_offline tidak berlaku untuk fetch milik service worker di Chromium, jadi server juga dimatikan:
        # semua request (halaman dan SW) benar-benar gagal. Skenario ini dijalankan paling akhir.
        tg.goto_focus(p, base)
        proc.terminate()
        proc.wait(10)
        ctx.set_offline(True)
        p.reload()
        p.locator(".sidebar-link, .sidebar-rail-btn").first.wait_for(state="attached", timeout=20000)
        if p.locator(".focus-pomo .pomo-ambient").count() == 0:
            h.nav(p, "Fokus Hari Ini")
        p.locator(".focus-pomo .pomo-ambient").wait_for(state="visible", timeout=20000)
        check("h3 offline: halaman dimuat, pilihan Brown Noise tersimpan",
              ctl(p).locator("select.pomo-ambient-select").input_value() == "brown-noise")
        select(p, "off")
        n0 = len(ctx.sound_resps)
        select(p, "brown-noise")
        st = wait_amb(p, lambda s: s["state"] in ("idle", "error"))
        p.wait_for_timeout(500)
        st = amb(p)
        new_resps = ctx.sound_resps[n0:]
        check("h4 offline: Brown Noise lagi -> bukan error, respons 200 dari service worker (alurik-ambient-v1)",
              st["state"] == "idle" and ctl_state(p) == "idle"
              and any("brown-noise-v1" in u and code == 200 and sw for u, code, sw in new_resps),
              "%r %r" % (st, new_resps))
        select(p, "detak-jam")
        st = wait_amb(p, lambda s: s["state"] == "error", timeout=6)
        icon_tip = ctl(p).locator(".pomo-ambient-icon").get_attribute("title")
        check("h5 offline: Detak Jam (belum diunduh) -> error, tooltip persis",
              st["state"] == "error" and ctl_state(p) == "error" and icon_tip == TIP_ERROR, "%r %r" % (st, icon_tip))
        check("h6 aria-live mengumumkan error", live_text(p) == TIP_ERROR, repr(live_text(p)))
        if p.locator(".focus-pomo .focus-pomo-task-count").count() == 0:
            tg.focus(p, T1)
        tg.start(p)
        p.wait_for_timeout(1500)
        check("h7 error audio tidak memengaruhi timer", tg.pomo_state(p).get("isRunning") is True)
        h.shot(p, "error_offline_light_desktop.png")
        card_btn(p, "button[aria-label=Stop]")
        select(p, "brown-noise")
        st = wait_amb(p, lambda s: s["state"] == "idle" and s["paused"] is True)
        check("h8 pilih suara lain (sudah di cache) -> pulih dari error", st["state"] == "idle", repr(st))
        # Kontrol negatif: tanpa entri di alurik-ambient-v1, Brown Noise offline harus error. Membuktikan h4
        # memang dilayani dari cache SW, bukan dari cache HTTP atau jaringan.
        deleted = p.evaluate("""async () => { const c = await caches.open('alurik-ambient-v1');
            const ks = (await c.keys()).filter(r => r.url.includes('brown-noise-v1'));
            for (const k of ks) await c.delete(k);
            return [ks.length, (await c.keys()).length]; }""")
        check("h9a entri Brown Noise dihapus dari alurik-ambient-v1", deleted[0] >= 1 and deleted[1] == 0, repr(deleted))
        p.reload()  # pemutar baru: Brown Noise belum terpasang, jadi pilihan berikut mengambil file lagi
        p.locator(".sidebar-link, .sidebar-rail-btn").first.wait_for(state="attached", timeout=20000)
        if p.locator(".focus-pomo .pomo-ambient").count() == 0:
            h.nav(p, "Fokus Hari Ini")
        p.locator(".focus-pomo .pomo-ambient").wait_for(state="visible", timeout=20000)
        cdp = ctx.new_cdp_session(p)
        cdp.send("Network.enable")
        cdp.send("Network.setCacheDisabled", {"cacheDisabled": True})
        n0 = len(ctx.sound_resps)
        r0 = len(ctx.sound_reqs)
        select(p, "off")
        select(p, "brown-noise")
        st = wait_amb(p, lambda s: s["state"] == "error", timeout=6)
        check("h9b kontrol negatif: tanpa entri cache, Brown Noise offline -> error",
              st["state"] == "error" and ctl_state(p) == "error"
              and any("brown-noise-v1" in u for u in ctx.sound_reqs[r0:])
              and not any(code == 200 for _, code, _ in ctx.sound_resps[n0:]),
              "%r %r %r" % (st, ctx.sound_reqs[r0:], ctx.sound_resps[n0:]))
    finally:
        ctx.close()


def layout_check(p, tag):
    res = p.evaluate("""() => {
        const card = document.querySelector('.focus-pomo'), c = document.querySelector('.focus-pomo .pomo-ambient');
        const stats = document.querySelector('.focus-pomo .focus-pomo-stats');
        const b = card.getBoundingClientRect(), vw = window.innerWidth, bad = [];
        for (const el of [stats, c, ...c.querySelectorAll('select, input, .pomo-ambient-icon')]) {
            const r = el.getBoundingClientRect();
            if (r.left < b.left - 1 || r.right > b.right + 1 || r.left < -1 || r.right > vw + 1)
                bad.push(el.className + ' ' + Math.round(r.left) + '-' + Math.round(r.right));
        }
        return {hscroll: document.documentElement.scrollWidth > vw + 1, bad: bad.join('; ')};
    }""")
    check("L %s: tanpa scroll horizontal" % tag, not res["hscroll"], repr(res))
    check("L %s: statistik + kontrol suara di dalam kartu" % tag, res["bad"] == "", res["bad"])


def run_shots(browser, base, user):
    for theme, w, hgt, tag in (("light", 1280, 860, "desktop"), ("dark", 1280, 860, "desktop"),
                               ("light", 375, 812, "375"), ("dark", 375, 812, "375"),
                               ("light", 320, 700, "320"), ("dark", 320, 700, "320")):
        c2, p2 = open_app(browser, base, user, theme, (w, hgt), extra_ls={"tf_ambient_sound": "hujan"})
        try:
            if p2.locator(".focus-pomo .focus-pomo-task-count").count() == 0:
                tg.focus(p2, T1)
            tg.start(p2)
            wait_amb(p2, playing)
            ctl(p2).scroll_into_view_if_needed()
            p2.wait_for_timeout(300)
            if tag != "320":
                h.shot(p2, "playing_%s_%s.png" % (theme, tag))
            layout_check(p2, "%s %s playing" % (tag, theme))
            card_btn(p2, "button[aria-label=Stop]")
            # status error: request suara diputus
            c2.route("**/static/sounds/**", lambda r: r.abort())
            select(p2, "detak-jam")
            wait_amb(p2, lambda s: s["state"] == "error")
            ctl(p2).scroll_into_view_if_needed()
            p2.wait_for_timeout(300)
            check("S %s %s: status error" % (tag, theme), ctl_state(p2) == "error")
            if tag != "320":
                h.shot(p2, "error_%s_%s.png" % (theme, tag))
            layout_check(p2, "%s %s error" % (tag, theme))
        finally:
            c2.close()


if __name__ == "__main__":
    main()
