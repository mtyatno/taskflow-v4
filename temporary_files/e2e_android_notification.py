"""E2E bug layar putih Chrome Android saat Pomodoro selesai / tombol Fokus. Tidak dijalankan CI.

Chrome Android: `new Notification()` selalu melempar "Illegal constructor" saat izin granted. Semua konteks memakai
Pixel 7 + init script yang membuat `window.Notification` melempar dari konstruktor (permission "granted").

Skenario: a sesi alami: Fokus di dashboard -> 25 menit -> 00:00 -> app tetap tampil, fase awaiting tersimpan,
  1 log session, kartu Pomodoro menampilkan Ambil Istirahat / Lanjut Fokus; reload tetap tampil tanpa log kedua;
  Ambil Istirahat -> 5 menit -> Work 25:00 tanpa crash
b state macet dari crash lama (countdown, 0, tidak berjalan) + tap Fokus dashboard -> app tampil, awaiting
c error render dipaksa DARI TES (window.TF.tasklogic.todayLocalISO dibuat melempar, lalu App dirender ulang lewat
  window.__showToast — tanpa hook debug di kode produksi) -> layar "Terjadi kesalahan pada tampilan", tf_last_crash,
  Salin detail -> clipboard, tanpa scroll horizontal (412 / 320 px), Muat ulang -> app kembali normal
d Service Worker aktif: notifikasi lewat ServiceWorkerRegistration.showNotification (ikon, tag; tanpa badge/renotify),
  konstruktor tidak dipanggil; cache SW versi baru
Screenshot terang + gelap: temporary_files/e2e_android_notification/ (di-.gitignore).

    E2E_PYTHON=/path/python-dengan-dependensi-webapp python3 temporary_files/e2e_android_notification.py
"""
import json
import os
import re
import shutil
import sqlite3
import sys
import tempfile
import time
from datetime import datetime

from playwright.sync_api import sync_playwright

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import e2e_focus_page as h  # harness PR A: server, register, api, check
import e2e_focus_target as tg  # wait_for, sync, pomo_state

ROOT = h.ROOT
SHOTS = os.path.join(ROOT, "temporary_files", "e2e_android_notification")
check = h.check
# Nama cache SW saat ini dibaca dari static/sw.js (sebelumnya dikunci ke v450 sehingga basi setiap rilis).
with open(os.path.join(ROOT, "static", "sw.js"), encoding="utf-8") as _f:
    SW_VERSION = re.search(r'const CACHE = "([^"]+)"', _f.read()).group(1)
ANDROID_MSG = ("Failed to construct 'Notification': Illegal constructor. "
               "Use ServiceWorkerRegistration.showNotification() instead.")
ANDROID = """
(() => {
  window.__notifCtor = 0;
  class N {
    constructor() { window.__notifCtor++; throw new TypeError(%s); }
  }
  N.permission = 'granted';
  N.requestPermission = () => Promise.resolve('granted');
  window.Notification = N;
})();
""" % json.dumps(ANDROID_MSG)
# Merekam showNotification (headless tidak menampilkan notifikasi sistem).
SW_SPY = """
(() => {
  window.__shown = [];
  if (window.ServiceWorkerRegistration) {
    ServiceWorkerRegistration.prototype.showNotification = function (title, opts) {
      window.__shown.push({ title, opts: JSON.parse(JSON.stringify(opts || {})) });
      return Promise.resolve();
    };
  }
})();
"""
BOUNDARY_TITLE = "Terjadi kesalahan pada tampilan"


def root_len(p):
    return p.evaluate("(document.getElementById('root') || {innerHTML: ''}).innerHTML.length")


def pomo_state(p):
    return tg.pomo_state(p)


def session_logs(db):
    conn = sqlite3.connect(db)
    try:
        return conn.execute("SELECT kind, client_id FROM pomodoro_log WHERE kind = 'session' ORDER BY id").fetchall()
    finally:
        conn.close()


def wait_session_logs(db, p, n, timeout=25):
    def ok():
        tg.sync(p)
        return len(session_logs(db)) >= n
    tg.wait_for(ok, timeout=timeout, interval=1)
    return session_logs(db)


def shot(p, name):
    p.wait_for_timeout(300)
    path = os.path.join(SHOTS, name)
    p.screenshot(path=path, full_page=False, scale="css")
    print("  screenshot", os.path.relpath(path, ROOT), flush=True)


def no_hscroll(p):
    return p.evaluate("() => document.documentElement.scrollWidth <= window.innerWidth + 1")


def open_mobile(pw, browser, base, user, stuck=None, theme="light", sw=False):
    ctx = browser.new_context(**pw.devices["Pixel 7"], service_workers="allow" if sw else "block")
    ctx.add_init_script(ANDROID)
    ctx.add_init_script(SW_SPY)
    ctx.add_cookies([{"name": "token", "value": user["token"], "url": base, "httpOnly": True, "sameSite": "Lax"}])
    # Jam palsu dipatok ke tengah hari lokal: total majunya ±1 jam, jadi tidak pernah melewati tengah malam.
    ctx.clock.install(time=datetime.now().replace(hour=12, minute=0, second=0, microsecond=0))
    p = ctx.new_page()
    errs, logs = [], []
    p.on("pageerror", lambda e: errs.append(str(e)[:200]))
    p.on("console", lambda m: logs.append((m.type, m.text[:300])))
    p.goto(base + "/manifest.json")
    p.evaluate("""([t, u, tours, theme, st]) => {
        localStorage.setItem('tf_token', t); localStorage.setItem('tf_user_id', String(u));
        for (const pg of tours) localStorage.setItem('tf_tour_' + pg, '1');
        localStorage.setItem('tf_dismiss_onboarding', '1');
        localStorage.setItem('tf_theme', theme);
        if (st) localStorage.setItem('tf_pomo_state', st);
    }""", [user["token"], user["id"], h.TOURS, theme, json.dumps(stuck) if stuck else ""])
    p.goto(base + "/")
    p.locator(".dash-focus-btn").first.wait_for(timeout=30000)
    return ctx, p, errs, logs


def goto_focus_mobile(p):
    p.locator(".mobile-topbar button").first.tap()
    p.wait_for_timeout(600)
    p.locator(".sidebar-link").filter(has_text="Fokus Hari Ini").first.tap()
    p.locator(".focus-pomo").first.wait_for(state="visible", timeout=15000)
    p.wait_for_timeout(500)


def awaiting_buttons(p):
    brk = p.locator(".focus-pomo .pomo-controls.is-awaiting .pomo-btn-break").first
    ot = p.locator(".focus-pomo .pomo-controls.is-awaiting button[aria-label='Lanjut Fokus (Overtime)']").first
    return (brk.count() and brk.is_visible() and "Ambil Istirahat" in (brk.text_content() or "")
            and ot.count() and ot.is_visible() and "Lanjut Fokus" in (ot.text_content() or ""))


def warned_illegal(logs):
    return any(t == "warning" and "Notifikasi gagal ditampilkan" in s and "Illegal constructor" in s for t, s in logs)


def tap_dash_focus(p):
    p.locator(".dash-focus-btn").first.tap()
    p.wait_for_timeout(800)


def advance(p, dur):
    p.clock.fast_forward(dur)
    p.clock.run_for(2000)
    p.wait_for_timeout(800)


def scenario_a(pw, browser, base, user, db):
    ctx, p, errs, logs = open_mobile(pw, browser, base, user)
    try:
        tap_dash_focus(p)
        check("a0 Pomodoro berjalan dari tombol Fokus dashboard", pomo_state(p).get("isRunning") is True)
        advance(p, "25:02")
        check("a1 00:00: app tetap tampil (root tidak kosong)", root_len(p) > 1000, "root %d" % root_len(p))
        st = pomo_state(p)
        check("a2 fase awaiting tersimpan (bukan countdown 0 yang macet)",
              st.get("phase") == "awaiting" and st.get("timeLeft") == 0 and st.get("isRunning") is False, json.dumps(st))
        check("a3 tanpa pageerror", errs == [], str(errs[:2]))
        check("a4 tanpa SW: konstruktor dicoba sekali, error-nya hanya console.warn",
              p.evaluate("window.__notifCtor") == 1 and warned_illegal(logs))
        rows = wait_session_logs(db, p, 1)
        check("a5 tepat 1 log session di server", len(rows) == 1, str(rows))
        goto_focus_mobile(p)
        check("a6 kartu Pomodoro: Ambil Istirahat + Lanjut Fokus", awaiting_buttons(p))
        shot(p, "a-awaiting-pixel7-light.png")

        p.reload()
        p.locator(".dash-focus-btn").first.wait_for(timeout=30000)
        p.wait_for_timeout(1500)
        check("a7 reload: app tetap tampil, masih awaiting", root_len(p) > 1000 and pomo_state(p).get("phase") == "awaiting")
        goto_focus_mobile(p)
        check("a8 reload: tombol pilihan tetap", awaiting_buttons(p))
        tg.sync(p)
        p.wait_for_timeout(1500)
        check("a9 reload tidak mencatat sesi kedua", len(session_logs(db)) == 1)

        p.locator(".focus-pomo .pomo-controls.is-awaiting .pomo-btn-break").first.tap()
        p.wait_for_timeout(600)
        st = pomo_state(p)
        check("a10 Ambil Istirahat: Short berjalan", st.get("mode") == "shortBreak" and st.get("isRunning") is True, json.dumps(st))
        advance(p, "05:02")
        st = pomo_state(p)
        check("a11 istirahat selesai (Notification melempar): app tampil, Work 25:00 diam",
              root_len(p) > 1000 and st.get("mode") == "work" and st.get("timeLeft") == 1500 and st.get("isRunning") is False,
              json.dumps(st))
        check("a12 tanpa pageerror sepanjang skenario", errs == [], str(errs[:2]))
    finally:
        ctx.close()


def scenario_b(pw, browser, base, user):
    today = time.strftime("%Y-%m-%d")
    stuck = {"mode": "work", "phase": "countdown", "timeLeft": 0, "isRunning": False, "targetEndTime": None,
             "focusTaskId": None, "sessionCount": 1, "totalFocusTime": 1500, "workStartedAt": None,
             "sessionTaskId": None, "date": today}
    ctx, p, errs, logs = open_mobile(pw, browser, base, user, stuck=stuck)
    try:
        check("b0 state macet dimuat, app tampil", root_len(p) > 1000 and pomo_state(p).get("timeLeft") == 0)
        tap_dash_focus(p)
        check("b1 tap Fokus: app tetap tampil", root_len(p) > 1000, "root %d" % root_len(p))
        st = pomo_state(p)
        check("b2 berakhir di awaiting", st.get("phase") == "awaiting" and st.get("isRunning") is False, json.dumps(st))
        check("b3 tanpa pageerror", errs == [], str(errs[:2]))
        goto_focus_mobile(p)
        check("b4 kartu Pomodoro: Ambil Istirahat + Lanjut Fokus", awaiting_buttons(p))
    finally:
        ctx.close()


def force_render_error(p):
    # Hanya dari tes: helper yang dipanggil setiap render usePomodoro dibuat melempar, lalu App dirender ulang.
    p.evaluate("""() => {
        window.TF.tasklogic.todayLocalISO = () => { throw new Error('E2E: render dipaksa gagal'); };
        window.__showToast('E2E memicu render ulang', 'info');
    }""")
    p.get_by_text(BOUNDARY_TITLE).first.wait_for(timeout=8000)
    p.wait_for_timeout(400)


def scenario_c(pw, browser, base, user):
    for theme in ("light", "dark"):
        ctx, p, errs, logs = open_mobile(pw, browser, base, user, theme=theme)
        try:
            ctx.grant_permissions(["clipboard-read", "clipboard-write"], origin=base)
            force_render_error(p)
            tag = "c-" + theme
            body = p.locator("#root").inner_text()
            check(tag + "1 layar pemulihan: judul + pesan error",
                  BOUNDARY_TITLE in body and "E2E: render dipaksa gagal" in body)
            check(tag + "2 tombol Muat ulang + Salin detail",
                  p.get_by_role("button", name="Muat ulang").is_visible()
                  and p.get_by_role("button", name="Salin detail").is_visible())
            stack_lines = p.locator("#root pre").first.inner_text().split("\n")
            check(tag + "3 ringkasan stack <= 6 baris", 1 <= len(stack_lines) <= 6, str(len(stack_lines)))
            crash = json.loads(p.evaluate("localStorage.getItem('tf_last_crash')") or "{}")
            check(tag + "4 tf_last_crash tersimpan (pesan, stack, komponen, versi, ua)",
                  crash.get("message") == "E2E: render dipaksa gagal" and crash.get("stack")
                  and "App" in (crash.get("componentStack") or "") and crash.get("version") == SW_VERSION
                  and "Android" in (crash.get("ua") or "") and crash.get("at"), json.dumps(crash)[:300])
            check(tag + "5 console.error dicatat", any(t == "error" and "kesalahan tampilan" in s for t, s in logs))
            check(tag + "6 tanpa scroll horizontal (412 px)", no_hscroll(p))
            shot(p, "c-boundary-pixel7-%s.png" % theme)
            if theme == "light":
                p.set_viewport_size({"width": 320, "height": 700})
                p.wait_for_timeout(300)
                check(tag + "7 tanpa scroll horizontal (320 px)", no_hscroll(p))
                shot(p, "c-boundary-320-light.png")
                p.get_by_role("button", name="Salin detail").click()
                p.get_by_role("button", name="Detail tersalin").wait_for(timeout=5000)
                clip = p.evaluate("navigator.clipboard.readText()")
                check(tag + "8 Salin detail: clipboard berisi pesan + stack + komponen",
                      "E2E: render dipaksa gagal" in clip and "Stack:" in clip and "Komponen:" in clip and SW_VERSION in clip)
            p.get_by_role("button", name="Muat ulang").click()
            p.locator(".dash-focus-btn").first.wait_for(timeout=30000)
            p.wait_for_timeout(800)
            check(tag + "9 Muat ulang: app kembali normal",
                  root_len(p) > 1000 and BOUNDARY_TITLE not in p.locator("#root").inner_text())
        finally:
            ctx.close()


def scenario_d(pw, browser, base, user):
    ctx, p, errs, logs = open_mobile(pw, browser, base, user, sw=True)
    try:
        p.wait_for_function("() => navigator.serviceWorker && navigator.serviceWorker.controller", timeout=30000)
        # clients.claim() memicu controllerchange -> reload sekali; tunggu sampai halaman stabil.
        p.wait_for_timeout(2500)
        p.locator(".dash-focus-btn").first.wait_for(timeout=30000)
        has_reg = p.evaluate("navigator.serviceWorker.getRegistration().then(r => !!r)")
        check("d0 registrasi SW aktif", has_reg)
        keys = p.evaluate("caches.keys()")
        check("d1 cache SW versi baru", SW_VERSION in keys, str(keys))
        tap_dash_focus(p)
        advance(p, "25:02")
        p.wait_for_timeout(800)
        shown = p.evaluate("window.__shown")
        check("d2 00:00: app tetap tampil", root_len(p) > 1000 and pomo_state(p).get("phase") == "awaiting")
        ok = (len(shown) == 1 and shown[0]["title"] == "🍅 Pomodoro Selesai!"
              and shown[0]["opts"].get("body") == "Pomodoro selesai — lanjut fokus atau istirahat?"
              and shown[0]["opts"].get("icon") == "/static/icon-192.png"
              and shown[0]["opts"].get("tag") == "alurik-pomodoro"
              and "badge" not in shown[0]["opts"] and "renotify" not in shown[0]["opts"])
        check("d3 notifikasi lewat ServiceWorkerRegistration.showNotification (ikon, tag; tanpa badge/renotify)",
              ok, json.dumps(shown))
        check("d4 konstruktor Notification tidak dipanggil", p.evaluate("window.__notifCtor") == 0)
        check("d5 tanpa pageerror", errs == [], str(errs[:2]))
    finally:
        ctx.close()


def main():
    os.makedirs(SHOTS, exist_ok=True)
    for f in os.listdir(SHOTS):
        if f.endswith(".png"):
            os.remove(os.path.join(SHOTS, f))
    tmp = tempfile.mkdtemp(prefix="e2e_android_notif_")
    proc, base = h.start_server(tmp)
    db = os.path.join(tmp, "e2e.db")
    print("server", base, flush=True)
    try:
        today = time.strftime("%Y-%m-%d")
        users = {}
        for key in ("a", "b", "c", "d"):
            users[key] = h.register(base, "andro" + key)
            for i in range(3):
                h.api(base, users[key], "POST", "/api/tasks",
                      json={"title": "Urgent %d" % i, "priority": "P1", "deadline": today, "gtd_status": "next"})
        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            try:
                scenario_a(pw, browser, base, users["a"], db)
                scenario_b(pw, browser, base, users["b"])
                scenario_c(pw, browser, base, users["c"])
                scenario_d(pw, browser, base, users["d"])
            finally:
                browser.close()
    finally:
        proc.kill()
        shutil.rmtree(tmp, ignore_errors=True)
    failed = [r for r in results() if not r[1]]
    print("\n%d/%d PASS" % (len(results()) - len(failed), len(results())), flush=True)
    sys.exit(1 if failed else 0)


def results():
    return h.results


if __name__ == "__main__":
    main()
