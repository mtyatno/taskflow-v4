"""E2E plugin Timeline (Fase 1 PR 1b): view Gantt, seksi Jadwal, kalender kerja bersama, seret, dependensi, HP,
kinerja 500 task. Rencana docs/superpowers/plans/2026-11-01-plugin-fase1-pr-1b-timeline.md Task 13. Tidak dijalankan CI.

    python3 temporary_files/e2e_plugin_fase1_1b.py

Server uvicorn lokal (`webapp:app` apa adanya; Timeline plugin produksi di `static/plugins/timeline/`, tanpa `ctx.route`
untuk plugin) + DB sementara + Chromium, `service_workers="block"`. Tiap "perangkat" = satu `browser.new_context`
(IndexedDB terpisah). Sinkron: `window.__syncNow()` lalu tunggu `__syncState.running === false`.

Pengguna: U1 "tl1b1" (perangkat A, B, E=HP 375 px; pemilik workspace W "Ruang Jadwal"; project pribadi "Gamma"),
U2 "tl1b2" (perangkat C, anggota W, Timeline OFF — bawaan), U4 "tl1b4" (perangkat F, anggota W, Timeline ON lewat
`PUT /api/plugins/state/timeline`), U3 "tl1b3" (perangkat D, workspace "Ruang Besar" 500 task + 400 dependensi).
Timeline U1 dinyalakan lewat UI Pengaturan › Plugin (A) setelah diperiksa OFF bawaan.

   0 bawaan OFF (server + sakelar Pengaturan), A menyalakan lewat UI.
   1 A slist_W: tombol "Timeline" tanpa request plugin.js sampai diklik; kelompok per project + "(Tanpa project)",
     WBS, hari ini di 1/3; task berulang tidak tampil; Inbox tanpa tombol; project pribadi: tanpa baris kelompok,
     task bertanggal salah ketik (2040) di luar rentang ±1830 hari → tanpa bar, grafik tetap wajar, catatan libur.
   2 seksi Jadwal di modal (antara Deskripsi dan tab): Mulai 2026-03-17 + Durasi 2 → Selesai "Rabu, 25 Maret 2026",
     satu tulis per edit; task berulang tanpa seksi; panel Live Edit: Mulai Sabtu → dijepret ke Senin, satu tulis.
   3 seret bar +3 hari → tepat 1 PUT ext_patch (hanya timeline.start) + toast "Urungkan" mengembalikan; Esc → 0 PUT;
     dependensi lewat titik → panah; ganda → toast; siklus → toast; notifikasi U2 tidak bertambah (K6);
     tinjauan akhir #1: filter panel "si" menyembunyikan B di rantai A→B→C → tautkan C→A tetap ditolak (siklus);
     induk yang anaknya tersembunyi filter → seret dan jadi penerus dependensi ditolak tanpa tulis.
   4 libur: 25 Des (nasional) dan 24 Des (cuti bersama) diarsir; Kalender kerja "Dipakai semua anggota workspace" →
     matikan "Ikuti cuti bersama" → Selesai seksi 18 Maret, arsir 24 Des hilang; tinjauan akhir #2: B perangkat baru
     tanpa record lokal, tarik record gagal (503) → popover "Menunggu data kalender workspace…", kontrol nonaktif; B (U1) dan F (U4, anggota lain)
     sinkron → kalender sama; F mengubah → A ikut (K14); LWW: A offline vs F online lebih baru → toast kalah di A;
     U2 (OFF) mengganti judul lewat API dan lewat klien C → `timeline.*` utuh; C tanpa tombol/seksi.
   5 B offline: seret bar; A mengganti prioritas task yang sama; B online + sinkron → server prioritas A + jadwal B;
     kontrol positif K6: ganti prioritas → notifikasi U2 +1.
   6 kinerja (D, U3): 500 task + 400 dependensi, CDP CPU throttle 4×: render Timeline sendiri (pemasangan view →
     Gantt pertama tergambar, plugin.js ter-cache) ≤ 150 ms — waktu ganti view dari Normal (termasuk pembongkaran
     daftar host) dan buka halaman dengan Timeline diingat dicatat sebagai info; elemen DOM `.plg-timeline *`
     diam/saat gulir ≤ 1500, gulir 3 s + PerformanceObserver longtask; seksi Jadwal dan pemilih di akun besar.
   7 HP 375 px (E, has_touch): WBS+Nama menempel, gulir horizontal di dalam wadah, halaman 375; tekan lama lalu
     seret (CDP touch) → 1 PUT; sapuan cepat → gulir, 0 PUT; Daftar → kelompok minggu; diingat setelah muat ulang.
   8 Sakura gelap: bar, arsir libur, bendera, panah (tangkapan); konsol tanpa error.
   9 A: Timeline OFF dari Pengaturan saat view Timeline aktif → mode inti tanpa reload; seksi Jadwal hilang.
  10 Tauri Desktop: dilewati bila build tidak ada.
"""
import datetime
import json
import os
import re
import shutil
import sqlite3
import statistics
import subprocess
import sys
import tempfile
import time

import requests
from playwright.sync_api import TimeoutError as PwTimeout, sync_playwright

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import e2e_hero_dashboard as hd  # noqa: E402

ROOT = hd.ROOT
SHOTS = os.path.join(ROOT, "temporary_files", "e2e_plugin_fase1_1b")
PID = "timeline"
VIEW = "Timeline"
SWITCH = '[role=switch][aria-labelledby="plugin-name-%s"]' % PID
SUBTITLE = "Fitur opsional. Pilihanmu tersimpan di akun dan berlaku di semua perangkat."
WS = "Ruang Jadwal"
WS_BIG = "Ruang Besar"
GAMMA = "Gamma"
T_A = "Analisis kebutuhan"
T_B = "Desain antarmuka"
T_C = "Implementasi modul"
T_S = "Uji Maret"
T_U = "Belum terjadwal"
T_R = "Rapat harian"
T_N = "Catatan lepas"
T_M = "Rilis beta"
T_X = "Tanggal salah ketik"
T_I = "Ide berikutnya"
MSG_CHANGED = "Jadwal diubah"
MSG_CYCLE = "Dependensi ini membuat lingkaran"
MSG_DUP = "Dependensi ini sudah ada"
MSG_LOST = "Perubahan kalender di perangkat ini kalah oleh perubahan yang lebih baru"
MSG_SAVE_FAIL = "Jadwal gagal disimpan"
MSG_SUMMARY = "Jadwal task ini mengikuti subtask-nya"
MSG_SUMMARY_DEP = "Ringkasan tidak bisa diberi dependensi di versi ini"
MSG_CAL_WAIT = "Menunggu data kalender workspace…"
PHRASES = [MSG_CHANGED, MSG_CYCLE, MSG_DUP, MSG_LOST, MSG_SAVE_FAIL, MSG_SUMMARY, MSG_SUMMARY_DEP]
CPU_RATE = 4
BUDGET_MS = 150
DOM_BUDGET = 1500

check = hd.check
console_log = []   # (perangkat, type, text)
puts = []          # (perangkat, task_id, body, t) untuk PUT /api/tasks/<id>
plugin_js = []     # (perangkat, url)
rec_posts = []     # (perangkat, url) untuk POST /api/plugins/timeline/records (kirim record)
perf = {}          # angka kinerja untuk laporan


def info(label, value):
    perf[label] = value
    print("INFO %s: %s" % (label, value), flush=True)


# ── server dan data ──────────────────────────────────────────────────────────

def task_id(t):
    return t.get("id") or (t.get("task") or {}).get("id")


def server_task(base, user, tid):
    return hd.api(base, user, "GET", "/api/tasks/%s" % tid)


def ext_of(base, user, tid):
    e = server_task(base, user, tid).get("ext") or {}
    if isinstance(e, str):
        e = json.loads(e or "{}")
    return {k: v for k, v in e.items() if k.startswith(PID + ".")}


CORE = ("title", "priority", "deadline", "gtd_status", "progress", "project", "description", "estimated_pomodoros")


def core_of(base, user, tid):
    t = server_task(base, user, tid)
    return {k: t.get(k) for k in CORE}


def upd_notifs(base, user, title):
    rows = hd.api(base, user, "GET", "/api/notifications")
    return len([n for n in rows if "memperbarui task" in (n.get("message") or "") and title in (n.get("message") or "")])


def server_cal(base, user, cal_id):
    r = hd.api(base, user, "GET", "/api/plugins/%s/records?limit=1000" % PID)
    for x in r.get("items", []):
        if x.get("id") == cal_id and not x.get("deleted"):
            return x
    return None


def plugin_enabled(base, user):
    st = hd.api(base, user, "GET", "/api/plugins/state")
    return bool(((st.get("plugins") or {}).get(PID) or {}).get("enabled"))


def wait_until(fn, timeout=20, interval=0.5):
    end = time.time() + timeout
    last = None
    while time.time() < end:
        try:
            last = fn()
            if last:
                return last
        except Exception:  # noqa: BLE001
            last = None
        time.sleep(interval)
    return last


def dn(iso):
    return (datetime.date.fromisoformat(iso) - datetime.date(1970, 1, 1)).days


def next_monday(today):
    return today + datetime.timedelta(days=(7 - today.weekday()) % 7 or 7) if today.weekday() else today


def add_workdays(start, n):
    """start (hari kerja) + n hari kerja, Sen–Jum saja (tanpa libur; dipakai untuk November)."""
    d = start
    while n > 0:
        d += datetime.timedelta(days=1)
        if d.weekday() < 5:
            n -= 1
    return d


# ── perangkat ─────────────────────────────────────────────────────────────────

INIT_JS = """(() => {
  window.__seen = []; window.__tlWrites = [];
  const PH = %s;
  const scan = (t) => { if (!t) return; for (const ph of PH) if (t.indexOf(ph) >= 0) window.__seen.push([ph, Date.now()]); };
  const start = () => {
    new MutationObserver((ms) => { for (const m of ms) {
      if (m.type === 'characterData') scan(m.target.textContent);
      for (const n of m.addedNodes || []) scan(n.textContent);
    } }).observe(document, { childList: true, subtree: true, characterData: true });
  };
  start();
  window.addEventListener('taskUpdated', (e) => { window.__tlWrites.push([e.detail && e.detail.taskId, Date.now()]); });
})();""" % json.dumps(PHRASES)


def shot(p, name, full=False):
    os.makedirs(SHOTS, exist_ok=True)
    p.screenshot(path=os.path.join(SHOTS, name), animations="disabled", caret="hide", full_page=full)


def prime_storage(p, user, palette="default", theme="light", live="0"):
    p.evaluate("""([t, u, tours, sw, pal, th, live]) => {
        localStorage.setItem('tf_token', t); localStorage.setItem('tf_user_id', String(u));
        for (const pg of tours) localStorage.setItem('tf_tour_' + pg, '1');
        localStorage.setItem('tf_whatsnew_seen', sw); localStorage.setItem('tf_theme', th);
        localStorage.setItem('tf_palette', pal); localStorage.setItem('tf_liveedit', live);
        localStorage.setItem('tf_dismiss_onboarding', '1'); localStorage.setItem('tf_shortcut_hint', '1');
    }""", [user["token"], user["id"], hd.TOURS, hd.sw_version(), palette, theme, live])


def watch(p, label):
    p.on("dialog", lambda d: d.accept())
    p.on("console", lambda m: console_log.append((label, m.type, m.text)))
    p.on("pageerror", lambda e: console_log.append((label, "pageerror", str(e))))

    def on_req(r):
        if "/static/plugins/%s/plugin.js" % PID in r.url:
            plugin_js.append((label, r.url))
        if r.method == "POST" and "/api/plugins/%s/records" % PID in r.url:
            rec_posts.append((label, r.url))
        m = re.search(r"/api/tasks/(\d+)(\?.*)?$", r.url)
        if r.method == "PUT" and m:
            try:
                body = r.post_data_json
            except Exception:  # noqa: BLE001
                body = None
            puts.append((label, int(m.group(1)), body, time.time()))
    p.on("request", on_req)


def new_device(browser, base, user, label, viewport=None, mobile=False, palette="default", theme="light", plugin_on=True):
    extra = {"is_mobile": True, "has_touch": True} if mobile else {}
    ctx = browser.new_context(service_workers="block", viewport=viewport or hd.DESKTOP, timezone_id="Asia/Jakarta",
                              reduced_motion="reduce", **extra)
    ctx.route(re.compile(r"^(?!%s/)" % re.escape(base)), lambda route: route.abort())
    ctx.add_init_script(INIT_JS)
    p = ctx.new_page()
    watch(p, label)
    p.goto(base + "/manifest.json")
    prime_storage(p, user, palette, theme)
    p.goto(base + "/")
    hd.wait_dashboard_ready(p)
    wait_sync(p)
    p.wait_for_function("() => window.TF && window.TF.plugins && window.TF.plugins.isReady ? window.TF.plugins.isReady() : !!(window.TF && window.TF.plugins)",
                        timeout=20000)
    if plugin_on:
        p.wait_for_function("pid => window.TF.plugins.isEnabled(pid)", arg=PID, timeout=20000)
    p.evaluate("() => { window.__e2eNoReload = 1; }")
    return ctx, p


def wait_sync(p, timeout=30000):
    p.wait_for_function("() => window.__syncState && window.__syncState.running === false", timeout=timeout)


def sync_now(p):
    res = p.evaluate("""() => Promise.resolve(window.__syncNow && window.__syncNow())
        .then(() => 'ok', (e) => 'err:' + (e && e.message || e))""")
    wait_sync(p)
    p.wait_for_timeout(300)
    return res


def refresh_tasks(p):
    p.evaluate("() => Promise.resolve(window.__refreshTasks && window.__refreshTasks()).catch(() => null)")
    p.wait_for_timeout(400)


def go_offline(ctx, p):
    ctx.set_offline(True)
    p.wait_for_function("() => navigator.onLine === false", timeout=5000)


def go_online(ctx, p):
    ctx.set_offline(False)
    p.wait_for_function("() => navigator.onLine === true", timeout=5000)
    wait_sync(p)


def sidebar_click(p, label):
    ex = p.locator("button[aria-label='Tampilkan semua menu']")
    if ex.count() and ex.first.is_visible():
        ex.first.click()
        p.wait_for_timeout(300)
    top = p.locator(".mobile-topbar button")
    link = p.locator(".sidebar-link").filter(has=p.locator("span", has_text=re.compile("^" + re.escape(label) + "$")))
    bb = link.first.bounding_box() if link.first.is_visible() else None
    vw = (p.viewport_size or {}).get("width", 10000)
    hidden = bb is None or bb["x"] < 0 or bb["x"] + bb["width"] > vw + 1
    if hidden and top.count() and top.first.is_visible():
        top.first.click()  # HP: laci sidebar di luar layar → buka lewat ☰
        p.wait_for_timeout(600)
    link.first.click()
    p.wait_for_timeout(500)


def view_btn(p, label):
    return p.locator(".tl-view-btn[aria-label='%s']" % label)


def open_timeline(p, label):
    sidebar_click(p, label)
    btn = view_btn(p, VIEW)
    btn.wait_for(state="visible", timeout=15000)
    if btn.get_attribute("aria-pressed") != "true":
        btn.click()
    p.locator(".plg-timeline-scroll, .plg-timeline-list").first.wait_for(state="visible", timeout=20000)
    p.wait_for_timeout(600)


def to_normal(p, row_title=None):
    view_btn(p, "Normal").click()
    p.wait_for_timeout(400)
    if row_title:
        p.locator(".task-row", has_text=row_title).first.wait_for(state="visible", timeout=15000)


def open_settings(p):
    sidebar_click(p, "Pengaturan")
    p.get_by_text(SUBTITLE).wait_for(state="visible", timeout=20000)
    p.locator(SWITCH).scroll_into_view_if_needed()


def switch_state(p):
    return p.locator(SWITCH).get_attribute("aria-checked")


def wait_switch(p, on, timeout=10000):
    try:
        p.wait_for_function("([sel, v]) => { const s = document.querySelector(sel); return s && s.getAttribute('aria-checked') === v; }",
                            arg=[SWITCH, "true" if on else "false"], timeout=timeout)
        return True
    except PwTimeout:
        return False


def open_modal(p, title):
    p.locator(".task-row", has_text=title).first.click()
    m = p.locator(".modal-content").first
    m.wait_for(state="visible", timeout=10000)
    return m


def close_modal(p):
    p.locator(".modal-overlay").first.click(position={"x": 4, "y": 4})
    p.locator(".modal-overlay").first.wait_for(state="detached", timeout=8000)


def section_order(p, scope):
    return p.evaluate("""sel => { const root = document.querySelector(sel); if (!root) return 'tanpa wadah';
        const d = root.querySelector('.td-desc-wrap'), s = root.querySelector('.plg-timeline-section'),
              t = root.querySelector('.td-tabs');
        if (!d || !s || !t) return 'hilang: ' + [!d && 'desc', !s && 'seksi', !t && 'tabs'].filter(Boolean).join(',');
        const after = !!(d.compareDocumentPosition(s) & Node.DOCUMENT_POSITION_FOLLOWING);
        const before = !!(s.compareDocumentPosition(t) & Node.DOCUMENT_POSITION_FOLLOWING);
        return after && before ? 'ok' : 'urutan salah'; }""", scope)


def section_ready(p, scope):
    sec = p.locator(scope + " .plg-timeline-section:not([aria-busy='true'])")
    sec.wait_for(state="visible", timeout=15000)
    return sec


def expand_section(sec):
    more = sec.locator(".plg-timeline-sec-more")
    if more.count() and more.get_attribute("aria-expanded") == "false":
        more.click()
        sec.page.wait_for_timeout(300)


def seen(p, phrase, since_ms):
    return p.evaluate("([ph, t]) => window.__seen.filter(x => x[0] === ph && x[1] >= t).length", [phrase, since_ms])


def writes(p, tid, since_ms):
    return p.evaluate("([id, t]) => window.__tlWrites.filter(x => String(x[0]) === String(id) && x[1] >= t).length",
                      [tid, since_ms])


def now_ms(p):
    return p.evaluate("() => Date.now()")


def puts_for(label, tid, since):
    return [x for x in puts if x[0] == label and x[1] == tid and x[3] >= since]


def bar(p, tid):
    return p.locator(".plg-timeline-bar[data-key='%s']" % tid)


def mouse_drag(p, x, y, dx, dy=0, steps=8, esc=False):
    p.mouse.move(x, y)
    p.mouse.down()
    for i in range(1, steps + 1):
        p.mouse.move(x + dx * i / steps, y + dy * i / steps)
        p.wait_for_timeout(16)
    if esc:
        p.keyboard.press("Escape")
        p.wait_for_timeout(100)
    p.mouse.up()


def link_drag(p, from_tid, to_tid):
    """Titik di ujung kanan bar `from` → bar `to` (desktop)."""
    a = bar(p, from_tid)
    dot = a.locator(".plg-timeline-dot")
    db = dot.bounding_box() if dot.count() else None
    ab = a.bounding_box()
    if db and db["width"] > 0:
        x, y = db["x"] + db["width"] / 2, db["y"] + db["height"] / 2
    else:
        x, y = ab["x"] + ab["width"] + 5, ab["y"] + ab["height"] / 2
    tb = bar(p, to_tid).bounding_box()
    p.mouse.move(x, y)
    p.mouse.down()
    p.mouse.move(x + 10, y + 6)
    p.wait_for_timeout(30)
    tx, ty = tb["x"] + min(8, tb["width"] / 2), tb["y"] + tb["height"] / 2
    for i in range(1, 7):
        p.mouse.move(x + (tx - x) * i / 6, y + (ty - y) * i / 6)
        p.wait_for_timeout(16)
    p.mouse.up()


def scroll_chart_to(p, iso_day, frac=0.5):
    """Gulir wadah sehingga `iso_day` ada di `frac` lebar grafik tampak (px/hari dari zoom aktif)."""
    p.evaluate("""([d, frac]) => { const s = document.querySelector('.plg-timeline-scroll');
        const today = document.querySelector('.plg-timeline-today');
        const zoom = document.querySelector('.plg-timeline-seg-btn.is-active');
        const px = { Hari: 28, Minggu: 12, Bulan: 4 }[zoom ? zoom.textContent : 'Minggu'] || 12;
        const tbl = document.querySelector('.plg-timeline-table').getBoundingClientRect().width;
        const tday = Math.floor(Date.now() / 864e5 + 7 / 24);
        const tx = parseFloat(today.style.left) - px / 2 + 1;
        const x = tx + (d - tday) * px;
        s.scrollLeft = Math.max(0, x - (s.clientWidth - tbl) * frac);
        s.dispatchEvent(new Event('scroll')); }""", [dn(iso_day), frac])
    p.wait_for_timeout(500)


def dom_count(p):
    return p.evaluate("() => document.querySelectorAll('.plg-timeline *').length")


def no_hscroll(p):
    return p.evaluate("() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth })")


def dispatch_put(p, tid, body):
    return p.evaluate("""([id, b]) => window.TF.taskroutes.buildTaskRouter().dispatch('PUT', '/api/tasks/' + id, b)
        .then(() => 'ok', e => 'err:' + (e && e.message || e))""", [tid, body])


CONTRAST_JS = """el => { if (!el) return null;
    const parse = c => { const m = c.match(/rgba?\\(([^)]+)\\)/); if (!m) return null;
      const v = m[1].split(/[ ,\\/]+/).filter(Boolean).map(Number); return [v[0], v[1], v[2], v.length > 3 ? v[3] : 1]; };
    const lum = c => { const f = x => { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); };
      return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
    let bg = null; for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const c = parse(getComputedStyle(n).backgroundColor); if (c && c[3] > 0.5) { bg = c; break; } }
    if (!bg) bg = parse(getComputedStyle(document.body).backgroundColor) || [255, 255, 255, 1];
    const fg = parse(getComputedStyle(el).color);
    const a = lum(fg), b = lum(bg); const r = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    return Math.round(r * 100) / 100; }"""


# ── skenario ──────────────────────────────────────────────────────────────────

def run(browser, base, users, ids, dates):
    u1, u2, u3, u4 = users["u1"], users["u2"], users["u3"], users["u4"]
    ws_id = ids["ws"]
    mon = dates["mon"]
    cal_w = "cal@list:%d" % ws_id
    ctxs = []
    try:
        # ── 0 bawaan OFF + nyalakan lewat UI ──
        check("0a server: Timeline OFF bawaan untuk U1 dan U2", not plugin_enabled(base, u1) and not plugin_enabled(base, u2))
        ca, a = new_device(browser, base, u1, "A", plugin_on=False)
        ctxs.append(ca)
        open_settings(a)
        off0 = switch_state(a)
        a.locator(SWITCH).click()
        on_ui = wait_switch(a, True)
        srv_on = wait_until(lambda: plugin_enabled(base, u1), 10)
        check("0b A Pengaturan › Plugin: sakelar Timeline OFF bawaan → klik → ON (server ikut)",
              off0 == "false" and on_ui and srv_on, "awal=%r" % off0)
        shot(a, "0-A-pengaturan-plugin-on.png")
        cc, c = new_device(browser, base, u2, "C", plugin_on=False)
        ctxs.append(cc)
        open_settings(c)
        check("0c C (U2): sakelar Timeline tetap OFF", switch_state(c) == "false")

        # ── 1 view ──
        n_js0 = len([x for x in plugin_js if x[0] == "A"])
        sidebar_click(a, WS)
        a.locator(".task-row", has_text=T_A).first.wait_for(state="visible", timeout=15000)
        btn = view_btn(a, VIEW)
        btn.wait_for(state="visible", timeout=15000)
        a.wait_for_timeout(800)
        n_js1 = len([x for x in plugin_js if x[0] == "A"])
        check("1a A slist_W: tombol 'Timeline' tampil tanpa request plugin.js", btn.is_visible() and n_js1 == n_js0 == 0,
              "plugin.js=%d" % n_js1)
        btn.click()
        a.locator(".plg-timeline-scroll").wait_for(state="visible", timeout=20000)
        a.wait_for_timeout(800)
        n_js2 = len([x for x in plugin_js if x[0] == "A"])
        check("1b klik → view Timeline tampil, tepat 1 request plugin.js", n_js2 == 1, "plugin.js=%d" % n_js2)
        groups = a.evaluate("""() => Array.from(document.querySelectorAll('.plg-timeline-row.is-group')).map(r =>
            [r.querySelector('.plg-timeline-col-wbs').textContent, r.querySelector('.plg-timeline-col-name').textContent])""")
        check("1c kelompok per project urut nama + '(Tanpa project)' terakhir, WBS g",
              groups == [["1", "Alpha"], ["2", "Beta"], ["3", "(Tanpa project)"]], repr(groups))
        wbs = a.evaluate("""() => Object.fromEntries(Array.from(document.querySelectorAll('.plg-timeline-row:not(.is-group)')).map(r =>
            [r.querySelector('.plg-timeline-col-name').textContent.replace('⚠', ''), r.querySelector('.plg-timeline-col-wbs').textContent]))""")
        check("1d WBS g.n: Alpha 1.x, Beta 2.x, tanpa project 3.1; task berulang tidak tampil",
              wbs.get(T_A, "").startswith("1.") and wbs.get(T_C, "").startswith("2.") and wbs.get(T_N) == "3.1"
              and T_R not in wbs, repr(wbs))
        geo = a.evaluate("""() => { const s = document.querySelector('.plg-timeline-scroll');
            const tbl = document.querySelector('.plg-timeline-table').getBoundingClientRect().width;
            const t = document.querySelector('.plg-timeline-today');
            return { left: parseFloat(t.style.left), sl: s.scrollLeft, w: s.clientWidth - tbl }; }""")
        frac = (geo["left"] - geo["sl"]) / geo["w"] if geo["w"] else -1
        check("1e garis hari ini di ~1/3 lebar grafik", abs(frac - 1 / 3) < 0.04, "%.3f %r" % (frac, geo))
        shot(a, "1-A-timeline-workspace.png")
        sidebar_click(a, "Inbox")
        a.wait_for_timeout(600)
        check("1f Inbox: tanpa tombol Timeline", view_btn(a, VIEW).count() == 0 and a.locator(".plg-timeline").count() == 0)
        open_timeline(a, GAMMA)
        g = a.evaluate("""([x]) => { const rows = Array.from(document.querySelectorAll('.plg-timeline-row'));
            const chart = document.querySelector('.plg-timeline-chart');
            const note = document.querySelector('.plg-timeline-note');
            return { groups: rows.filter(r => r.classList.contains('is-group')).length,
              wbs: rows.map(r => r.querySelector('.plg-timeline-col-wbs').textContent),
              xRow: !!document.querySelector(".plg-timeline-row[data-key='" + x + "']"),
              xBar: !!document.querySelector("[data-key='" + x + "'].plg-timeline-bar"),
              chartW: chart ? chart.getBoundingClientRect().width : 0, note: note ? note.textContent : '' }; }""",
                       [ids["tx"]])
        max_w = (2 * 1830 + 200) * 12
        check("1g project pribadi: tanpa baris kelompok, WBS n; task 2040 di luar ±1830 hari → baris tanpa bar, grafik ≤ %d px, catatan libur"
              % max_w, g["groups"] == 0 and g["wbs"][:2] == ["1", "2"] and g["xRow"] and not g["xBar"]
              and 0 < g["chartW"] <= max_w and "belum ada di Alurik versi ini." in g["note"], repr(g))
        shot(a, "1-A-timeline-project-gamma.png")

        # ── 2 seksi Jadwal ──
        sidebar_click(a, WS)
        to_normal(a, T_S)
        core_s0 = core_of(base, u1, ids["ts"])
        m = open_modal(a, T_S)
        sec = section_ready(a, ".modal-content")
        check("2a modal: seksi 'Jadwal' di antara Deskripsi dan tab", section_order(a, ".modal-content") == "ok"
              and "Jadwal" in sec.inner_text(), section_order(a, ".modal-content"))
        t0, s0 = now_ms(a), time.time()
        sec.get_by_label("Mulai", exact=True).fill("2026-03-17")
        a.wait_for_timeout(1500)
        w_start = writes(a, ids["ts"], t0)
        dur = sec.get_by_label("Durasi (hari kerja)")
        dur.fill("2")
        dur.press("Tab")
        a.wait_for_timeout(1500)
        w_all = writes(a, ids["ts"], t0)
        expand_section(sec)
        fin = sec.locator("[data-field=finish]").inner_text()
        check("2b Mulai 2026-03-17 + Durasi 2 → Selesai 'Rabu, 25 Maret 2026' (cuti bersama ON)",
              fin == "Rabu, 25 Maret 2026", repr(fin))
        check("2c satu tulis per edit (Mulai 1, Durasi 1)", w_start == 1 and w_all == 2, "mulai=%d total=%d" % (w_start, w_all))
        ok2 = wait_until(lambda: ext_of(base, u1, ids["ts"]) == {"timeline.start": "2026-03-17", "timeline.duration": 2}, 10)
        bodies = [x[2] for x in puts_for("A", ids["ts"], s0)]
        info("2 PUT seksi (ext_patch per PUT)", [b_.get("ext_patch") for b_ in bodies])
        check("2d server ext {start 2026-03-17, duration 2}; tiap PUT membawa ext_patch timeline.* saja, kolom inti tidak berubah",
              ok2 and len(bodies) == 2 and all(set(b_.get("ext_patch") or {"x": 1}) <= {"timeline.start", "timeline.duration"} for b_ in bodies)
              and core_of(base, u1, ids["ts"]) == core_s0, repr((ext_of(base, u1, ids["ts"]), [b_.get("ext_patch") for b_ in bodies])))
        a.wait_for_timeout(300)
        shot(a, "2-A-modal-seksi-jadwal.png")
        close_modal(a)
        open_modal(a, T_R)
        a.wait_for_timeout(2000)
        check("2e task berulang: tanpa seksi Jadwal", a.locator(".modal-content .plg-timeline-section").count() == 0
              and a.locator(".modal-content .td-desc-wrap").count() == 1)
        close_modal(a)
        a.locator("button[aria-label='Live Edit']").click()
        a.locator("aside.tl-live-panel").wait_for(state="visible", timeout=10000)
        a.locator(".task-row", has_text=T_U).first.click()
        psec = section_ready(a, "aside.tl-live-panel")
        check("2f panel Live Edit: seksi Jadwal di antara Deskripsi dan tab", section_order(a, "aside.tl-live-panel") == "ok",
              section_order(a, "aside.tl-live-panel"))
        sat = (mon + datetime.timedelta(days=12)).isoformat()   # Sabtu
        snap = (mon + datetime.timedelta(days=14)).isoformat()  # Senin sesudahnya
        t0 = now_ms(a)
        st = psec.get_by_label("Mulai", exact=True)
        st.fill(sat)
        st.press("Tab")
        a.wait_for_timeout(1800)
        w = writes(a, ids["tu"], t0)
        ok2g = wait_until(lambda: ext_of(base, u1, ids["tu"]).get("timeline.start") == snap, 10)
        check("2g Live Edit: Mulai Sabtu %s → dijepret ke Senin %s, satu tulis" % (sat, snap),
              ok2g and w == 1 and st.input_value() == snap, "tulis=%d nilai=%r ext=%r" % (w, st.input_value(), ext_of(base, u1, ids["tu"])))
        shot(a, "2-A-live-edit-seksi.png")
        a.locator("button[aria-label='Live Edit']").click()
        a.locator("aside.tl-live-panel").wait_for(state="detached", timeout=10000)

        # ── 3 seret, Esc, dependensi ──
        n_u2_a, n_u2_b = upd_notifs(base, u2, T_A), upd_notifs(base, u2, T_B)
        open_timeline(a, WS)
        bb = bar(a, ids["ta"]).bounding_box()
        x, y = bb["x"] + 10, bb["y"] + bb["height"] / 2
        core_a0 = core_of(base, u1, ids["ta"])
        t0, s0 = now_ms(a), time.time()
        mouse_drag(a, x, y, 36)
        a.wait_for_timeout(2500)
        new_start = add_workdays(mon, 3).isoformat()
        b3 = [x_[2] for x_ in puts_for("A", ids["ta"], s0)]
        ext_a = ext_of(base, u1, ids["ta"])
        info("3 isi PUT seret (sinkron push mengirim baris lokal + ext_patch)", b3)
        check("3a seret bar +3 hari → tepat 1 tulis + 1 PUT, ext_patch hanya {timeline.start: %s}, kolom inti tidak berubah" % new_start,
              len(b3) == 1 and b3[0].get("ext_patch") == {"timeline.start": new_start} and ext_a.get("timeline.start") == new_start
              and writes(a, ids["ta"], t0) == 1 and core_of(base, u1, ids["ta"]) == core_a0, repr(([b_.get("ext_patch") for b_ in b3], ext_a)))
        check("3b toast 'Jadwal diubah' tampil", seen(a, MSG_CHANGED, t0) >= 1)
        shot(a, "3-A-seret-toast.png")
        s1 = time.time()
        a.get_by_role("button", name="Urungkan").click()
        a.wait_for_timeout(2500)
        ok3c = wait_until(lambda: ext_of(base, u1, ids["ta"]).get("timeline.start") == mon.isoformat(), 10)
        check("3c Urungkan → server kembali %s (1 PUT lagi)" % mon.isoformat(), ok3c and len(puts_for("A", ids["ta"], s1)) == 1,
              repr(ext_of(base, u1, ids["ta"])))
        bb = bar(a, ids["ta"]).bounding_box()
        x, y = bb["x"] + 10, bb["y"] + bb["height"] / 2
        t0, s0 = now_ms(a), time.time()
        mouse_drag(a, x, y, 60, esc=True)
        a.wait_for_timeout(2500)
        bb2 = bar(a, ids["ta"]).bounding_box()
        check("3d Esc saat seret → 0 PUT, 0 tulis, bar kembali", not puts_for("A", ids["ta"], s0) and writes(a, ids["ta"], t0) == 0
              and abs(bb2["x"] - bb["x"]) < 1 and ext_of(base, u1, ids["ta"]).get("timeline.start") == mon.isoformat(),
              "x %.1f→%.1f" % (bb["x"], bb2["x"]))
        arrows0 = a.locator(".plg-timeline-arrow").count()
        s0 = time.time()
        link_drag(a, ids["ta"], ids["tb"])
        ok3e = wait_until(lambda: any((d.get("t") or {}).get("$task") == ids["ta"]
                                      for d in ext_of(base, u1, ids["tb"]).get("timeline.deps") or []), 10)
        a.wait_for_timeout(500)
        arrows1 = a.locator(".plg-timeline-arrow").count()
        check("3e titik A → bar B: dependensi FS di B (server) + panah baru", ok3e and arrows1 == arrows0 + 1,
              "panah %d→%d deps=%r" % (arrows0, arrows1, ext_of(base, u1, ids["tb"]).get("timeline.deps")))
        shot(a, "3-A-dependensi-panah.png")
        deps_b = ext_of(base, u1, ids["tb"]).get("timeline.deps")
        t0, s0 = now_ms(a), time.time()
        link_drag(a, ids["ta"], ids["tb"])
        a.wait_for_timeout(2000)
        check("3f dependensi ganda → toast 'Dependensi ini sudah ada', tanpa tulis",
              seen(a, MSG_DUP, t0) >= 1 and writes(a, ids["tb"], t0) == 0 and not puts_for("A", ids["tb"], s0)
              and ext_of(base, u1, ids["tb"]).get("timeline.deps") == deps_b)
        t0, s0 = now_ms(a), time.time()
        link_drag(a, ids["tb"], ids["ta"])
        a.wait_for_timeout(2000)
        check("3g siklus (B → A) → toast 'Dependensi ini membuat lingkaran', A tanpa tulis",
              seen(a, MSG_CYCLE, t0) >= 1 and writes(a, ids["ta"], t0) == 0 and not puts_for("A", ids["ta"], s0)
              and "timeline.deps" not in ext_of(base, u1, ids["ta"]))
        shot(a, "3-A-siklus-toast.png")
        time.sleep(1.0)
        check("3h notifikasi U2 'memperbarui task' tidak bertambah oleh seret/urungkan/dependensi (K6)",
              upd_notifs(base, u2, T_A) == n_u2_a and upd_notifs(base, u2, T_B) == n_u2_b,
              "A %d→%d B %d→%d" % (n_u2_a, upd_notifs(base, u2, T_A), n_u2_b, upd_notifs(base, u2, T_B)))
        # ── 3i–3j (tinjauan akhir #1): filter panel host tidak melemahkan cek siklus/ringkasan ──
        # Rantai A→B→C (C bergantung pada B lewat API, ext-only); induk "Induk revisi" dengan anak "Anak lain".
        # Cari "si" menampilkan A, C, dan induk, menyembunyikan B dan anak.
        hd.api(base, u1, "PUT", "/api/tasks/%d" % ids["tc"],
               json={"ext_patch": {"timeline.deps": [{"t": {"$task": ids["tb"]}, "type": "FS", "lag": 0}]}})
        par = task_id(hd.api(base, u1, "POST", "/api/tasks", json={
            "title": "Induk revisi", "gtd_status": "next", "priority": "P3", "list_id": ws_id, "project": "Alpha",
            "ext": {"timeline.start": add_workdays(mon, 1).isoformat(), "timeline.duration": 2}}))
        kid = task_id(hd.api(base, u1, "POST", "/api/tasks", json={
            "title": "Anak lain", "gtd_status": "next", "priority": "P3", "list_id": ws_id, "project": "Alpha", "parent_id": par,
            "ext": {"timeline.start": add_workdays(mon, 2).isoformat(), "timeline.duration": 1}}))
        sync_now(a)
        refresh_tasks(a)
        search = a.locator("input[placeholder*='Cari task']").first
        search.fill("si")
        a.wait_for_timeout(1000)
        vis = {k: bar(a, v).count() for k, v in (("A", ids["ta"]), ("B", ids["tb"]), ("C", ids["tc"]), ("induk", par), ("anak", kid))}
        t0, s0 = now_ms(a), time.time()
        link_drag(a, ids["tc"], ids["ta"])
        a.wait_for_timeout(2000)
        check("3i filter 'si' menyembunyikan B (rantai A→B→C): tautkan C → A → toast siklus, A tanpa tulis/PUT",
              vis["A"] == 1 and vis["C"] == 1 and vis["B"] == 0 and seen(a, MSG_CYCLE, t0) >= 1 and writes(a, ids["ta"], t0) == 0
              and not puts_for("A", ids["ta"], s0) and "timeline.deps" not in ext_of(base, u1, ids["ta"]), repr(vis))
        pb = bar(a, par).bounding_box()
        ext_p0 = ext_of(base, u1, par)
        t0, s0 = now_ms(a), time.time()
        mouse_drag(a, pb["x"] + 6, pb["y"] + pb["height"] / 2, 36)
        a.wait_for_timeout(2000)
        pb2 = bar(a, par).bounding_box()
        drag_blocked = seen(a, MSG_SUMMARY, t0) >= 1 and writes(a, par, t0) == 0 and not puts_for("A", par, s0) and abs(pb2["x"] - pb["x"]) < 1
        t0, s0 = now_ms(a), time.time()
        link_drag(a, ids["ta"], par)
        a.wait_for_timeout(2000)
        link_blocked = seen(a, MSG_SUMMARY_DEP, t0) >= 1 and writes(a, par, t0) == 0 and not puts_for("A", par, s0)
        check("3j induk yang anaknya tersembunyi filter: seret → toast '%s', tanpa tulis, bar kembali; jadi penerus dependensi → "
              "toast ringkasan, tanpa tulis" % MSG_SUMMARY,
              vis["induk"] == 1 and vis["anak"] == 0 and drag_blocked and link_blocked and ext_of(base, u1, par) == ext_p0,
              repr((vis, drag_blocked, link_blocked)))
        shot(a, "3-A-filter-ringkasan.png")
        search.fill("")
        a.wait_for_timeout(500)
        # pulihkan: C tanpa dependensi, induk + anak dihapus (skenario berikutnya tidak berubah)
        hd.api(base, u1, "PUT", "/api/tasks/%d" % ids["tc"], json={"ext_patch": {"timeline.deps": None}})
        for tid_ in (kid, par):
            hd.api(base, u1, "DELETE", "/api/tasks/%d" % tid_)
        sync_now(a)
        refresh_tasks(a)

        # ── 4 libur + kalender kerja bersama ──
        sync_now(a)
        scroll_chart_to(a, "2026-12-24", 0.4)
        hol = a.evaluate("""([d24, d25]) => { const q = d => document.querySelector(".plg-timeline-holiday[data-dn='" + d + "']");
            const h = q(d25); return { h24: !!q(d24), h25: !!h, title: h ? h.title : null,
              bg: h ? getComputedStyle(h).backgroundColor : null }; }""", [dn("2026-12-24"), dn("2026-12-25")])
        check("4a arsir libur: 25 Des (nasional) dan 24 Des (cuti bersama) tampil", hol["h24"] and hol["h25"]
              and hol["bg"] not in (None, "rgba(0, 0, 0, 0)", "transparent"), repr(hol))
        shot(a, "4-A-libur-desember.png")
        a.get_by_role("button", name="Kalender kerja").click()
        pop = a.locator(".plg-timeline-pop")
        pop.wait_for(state="visible", timeout=10000)
        a.wait_for_timeout(500)
        note_ok = "Dipakai semua anggota workspace" in pop.inner_text()
        pop.get_by_label("Ikuti cuti bersama").uncheck()
        a.wait_for_timeout(800)
        shot(a, "4-A-kalender-kerja.png")
        a.keyboard.press("Escape")
        a.wait_for_timeout(500)
        hol2 = a.evaluate("""([d24, d25]) => { const q = d => document.querySelector(".plg-timeline-holiday[data-dn='" + d + "']");
            return { h24: !!q(d24), h25: !!q(d25) }; }""", [dn("2026-12-24"), dn("2026-12-25")])
        check("4b popover 'Dipakai semua anggota workspace'; cuti bersama OFF → arsir 24 Des hilang, 25 Des tetap",
              note_ok and not hol2["h24"] and hol2["h25"], repr(hol2))
        sync_now(a)
        rec = wait_until(lambda: (lambda r: r if r and r["data"].get("cutiBersama") is False else None)(server_cal(base, u1, cal_w)), 10)
        check("4c server: record %s scope list:W cutiBersama false" % cal_w, rec and rec["scope"] == "list:%d" % ws_id, repr(rec))
        to_normal(a, T_S)
        open_modal(a, T_S)
        sec = section_ready(a, ".modal-content")
        expand_section(sec)
        a.wait_for_timeout(500)
        fin = sec.locator("[data-field=finish]").inner_text()
        check("4d seksi T_S: Selesai berubah → 'Rabu, 18 Maret 2026'", fin == "Rabu, 18 Maret 2026", repr(fin))
        close_modal(a)
        cb, b = new_device(browser, base, u1, "B")
        ctxs.append(cb)
        # Tinjauan akhir #2 (jendela D5): tarik record Timeline GAGAL (503) → sinkron selesai dengan galat (sync.done tetap
        # menyala) tetapi tanpa peristiwa `pulled` → popover kalender workspace harus tetap terkunci; lalu tarik sukses → terbuka.
        fails = []
        rec_pull = re.compile(r"/api/plugins/timeline/records\?")
        posts0 = len([x_ for x_ in rec_posts if x_[0] == "B"])

        def fail_pull(route):
            if route.request.method == "GET":
                fails.append(route.request.url)
                route.fulfill(status=503, content_type="application/json", body='{"detail":"OFFLINE"}')
            else:
                route.continue_()
        cb.route(rec_pull, fail_pull)
        open_timeline(b, WS)
        b.get_by_role("button", name="Kalender kerja").click()
        bp = b.locator(".plg-timeline-pop")
        bp.wait_for(state="visible", timeout=10000)
        sync_res = sync_now(b)  # sinkron dengan tarik record gagal (popover tetap terbuka)
        b.wait_for_timeout(1000)
        wait_view = b.evaluate("""() => { const p = document.querySelector('.plg-timeline-pop');
            const ctl = [...p.querySelectorAll('button.plg-timeline-pop-day, input, .plg-timeline-pop-form button')];
            return { note: (p.querySelector('.plg-timeline-pop-wait') || {}).textContent || null, n: ctl.length,
                     disabled: ctl.filter(e => e.disabled).length }; }""")
        shot(b, "4-B-kalender-menunggu-sinkron.png")
        check("4e-1 B perangkat baru tanpa record lokal, tarik record GAGAL (503, sync.done tanpa pulled): popover kalender "
              "workspace tetap menunggu ('%s'), semua kontrol nonaktif, tanpa kirim record" % MSG_CAL_WAIT,
              len(fails) >= 1 and wait_view["note"] == MSG_CAL_WAIT and wait_view["n"] >= 13 and wait_view["disabled"] == wait_view["n"]
              and len([x_ for x_ in rec_posts if x_[0] == "B"]) == posts0, repr((len(fails), sync_res, wait_view)))
        cb.unroute(rec_pull, fail_pull)
        fresh = {"cutiBersama_checked": bp.get_by_label("Ikuti cuti bersama").is_checked(),
                 "recordPluginIds": b.evaluate("() => window.TF.plugins.recordPluginIds()"),
                 "idb": b.evaluate("""() => new Promise(res => { const rq = indexedDB.open('taskflow-offline');
                    rq.onsuccess = () => { const db = rq.result; const g = db.transaction('plugin_records').objectStore('plugin_records').getAll();
                      g.onsuccess = () => { db.close(); res(g.result.filter(r => r.plugin_id === 'timeline').map(r => r.id)); }; }; })""")}
        info("4e-0 B perangkat baru (Timeline ON di akun) tanpa sinkron manual: kalender", fresh)
        b.keyboard.press("Escape")
        sync_now(b)
        b.get_by_role("button", name="Kalender kerja").click()
        bp.wait_for(state="visible", timeout=10000)
        b_ok = wait_until(lambda: not bp.get_by_label("Ikuti cuti bersama").is_checked(), 10, 0.3)
        b_on = bp.locator(".plg-timeline-pop-wait").count() == 0 and bp.get_by_label("Ikuti cuti bersama").is_enabled()
        check("4e B (U1, konteks lain) tarik record sukses → 'Ikuti cuti bersama' OFF juga; popover terbuka dengan data bersama",
              b_ok and b_on)
        b.keyboard.press("Escape")
        cf, f = new_device(browser, base, u4, "F")
        ctxs.append(cf)
        sync_now(f)
        open_timeline(f, WS)
        f.get_by_role("button", name="Kalender kerja").click()
        fp = f.locator(".plg-timeline-pop")
        fp.wait_for(state="visible", timeout=10000)
        f_ok = wait_until(lambda: not fp.get_by_label("Ikuti cuti bersama").is_checked(), 15, 0.3)
        check("4f F (U4, anggota lain W, Timeline ON) → kalender bersama sama (cuti bersama OFF)", f_ok)
        fp.locator(".plg-timeline-pop-day[aria-label='Sabtu']").click()
        f.wait_for_timeout(800)
        f.keyboard.press("Escape")
        sync_now(f)
        r4 = wait_until(lambda: (lambda r: r if r and 6 in r["data"].get("weekdays", []) else None)(server_cal(base, u1, cal_w)), 10)
        sync_now(a)
        open_timeline(a, WS)
        a.get_by_role("button", name="Kalender kerja").click()
        ap = a.locator(".plg-timeline-pop")
        ap.wait_for(state="visible", timeout=10000)
        a_sat = wait_until(lambda: ap.locator(".plg-timeline-pop-day[aria-label='Sabtu']").get_attribute("aria-pressed") == "true", 10, 0.3)
        check("4g F (anggota) menyalakan Sabtu → server → A ikut (K14: semua anggota boleh menulis)", r4 and a_sat)
        a.keyboard.press("Escape")
        # LWW: A offline mengubah dulu, F online mengubah belakangan → A kalah
        go_offline(ca, a)
        a.get_by_role("button", name="Kalender kerja").click()
        ap.wait_for(state="visible", timeout=10000)
        ap.locator(".plg-timeline-pop-day[aria-label='Sabtu']").click()
        a.wait_for_timeout(800)
        pend = "Menunggu sinkron" in ap.inner_text()
        shot(a, "4-A-kalender-offline-menunggu.png")
        a.keyboard.press("Escape")
        time.sleep(1.2)
        f.get_by_role("button", name="Kalender kerja").click()
        fp.wait_for(state="visible", timeout=10000)
        fp.get_by_label("Ikuti libur nasional").uncheck()
        f.wait_for_timeout(800)
        f.keyboard.press("Escape")
        sync_now(f)
        wait_until(lambda: (lambda r: r if r and r["data"].get("national") is False else None)(server_cal(base, u1, cal_w)), 10)
        t0 = now_ms(a)
        go_online(ca, a)
        sync_now(a)
        lost = wait_until(lambda: seen(a, MSG_LOST, t0) >= 1, 10, 0.3)
        srv = server_cal(base, u1, cal_w)["data"]
        a.get_by_role("button", name="Kalender kerja").click()
        ap.wait_for(state="visible", timeout=10000)
        a.wait_for_timeout(600)
        a_view = {"national": ap.get_by_label("Ikuti libur nasional").is_checked(),
                  "sat": ap.locator(".plg-timeline-pop-day[aria-label='Sabtu']").get_attribute("aria-pressed")}
        check("4h LWW: A offline (lebih dulu) vs F online (lebih baru) → A toast kalah, A & server = versi F",
              pend and lost and srv.get("national") is False and 6 in srv.get("weekdays", []) and a_view == {"national": False, "sat": "true"},
              "menunggu=%r srv=%r a=%r" % (pend, srv, a_view))
        # pulihkan: libur nasional ON, Sabtu OFF (cuti bersama tetap OFF)
        ap.get_by_label("Ikuti libur nasional").check()
        ap.locator(".plg-timeline-pop-day[aria-label='Sabtu']").click()
        a.wait_for_timeout(800)
        a.keyboard.press("Escape")
        sync_now(a)
        wait_until(lambda: (lambda r: r if r and r["data"].get("national") is True and 6 not in r["data"]["weekdays"] else None)(server_cal(base, u1, cal_w)), 10)
        # U2 (OFF): judul lewat API dan lewat klien C → timeline.* utuh
        ext_b0 = ext_of(base, u1, ids["tb"])
        hd.api(base, u2, "PUT", "/api/tasks/%d" % ids["tb"], json={"title": T_B + " (U2)"})
        ext_b1 = ext_of(base, u1, ids["tb"])
        check("4i U2 (OFF) ganti judul task berjadwal lewat API → timeline.* utuh",
              ext_b1 == ext_b0 and "timeline.deps" in ext_b0 and server_task(base, u1, ids["tb"])["title"] == T_B + " (U2)",
              repr((ext_b0, ext_b1)))
        sync_now(c)
        ext_a0 = ext_of(base, u1, ids["ta"])
        r_c = dispatch_put(c, ids["ta"], {"title": T_A + " (C)"})
        sync_now(c)
        ok4j = wait_until(lambda: server_task(base, u1, ids["ta"])["title"] == T_A + " (C)", 10)
        check("4j klien C (Timeline OFF) ganti judul lewat rute lokal + sinkron → timeline.* utuh",
              r_c == "ok" and ok4j and ext_of(base, u1, ids["ta"]) == ext_a0 and ext_a0.get("timeline.start"),
              repr((r_c, ext_a0, ext_of(base, u1, ids["ta"]))))
        refresh_tasks(c)
        sidebar_click(c, WS)
        c.locator(".task-row", has_text=T_B).first.wait_for(state="visible", timeout=15000)
        no_btn = view_btn(c, VIEW).count() == 0
        open_modal(c, T_B)
        c.wait_for_timeout(1500)
        check("4k C (OFF): tanpa tombol Timeline, tanpa seksi Jadwal, tanpa request plugin.js",
              no_btn and c.locator(".modal-content .plg-timeline-section").count() == 0
              and not [x_ for x_ in plugin_js if x_[0] == "C"])
        close_modal(c)

        # ── 5 offline B vs prioritas A ──
        sync_now(b)
        refresh_tasks(b)
        open_timeline(b, WS)
        n_u2_c = upd_notifs(base, u2, T_C)
        go_offline(cb, b)
        bb = bar(b, ids["tc"]).bounding_box()
        t0 = now_ms(b)
        mouse_drag(b, bb["x"] + 10, bb["y"] + bb["height"] / 2, 24)
        b.wait_for_timeout(2000)
        start_c0 = (mon + datetime.timedelta(days=14)).isoformat()
        start_c1 = add_workdays(mon + datetime.timedelta(days=14), 2).isoformat()
        check("5a B offline: seret T_C +2 hari → 1 tulis lokal, server belum berubah",
              writes(b, ids["tc"], t0) == 1 and ext_of(base, u1, ids["tc"]).get("timeline.start") == start_c0)
        shot(b, "5-B-offline-seret.png")
        r_a = dispatch_put(a, ids["tc"], {"priority": "P1"})
        sync_now(a)
        ok5 = wait_until(lambda: server_task(base, u1, ids["tc"])["priority"] == "P1", 10)
        s5 = time.time()
        go_online(cb, b)
        sync_now(b)
        info("5 isi PUT B setelah online (prioritas lama ikut terkirim?)", [{k: b_.get(k) for k in ("priority", "ext_patch")}
                                                                        for b_ in [x_[2] for x_ in puts_for("B", ids["tc"], s5)] if b_])
        st5 = wait_until(lambda: (lambda t: t if t["priority"] == "P1" and (t.get("ext") or {}).get("timeline.start") == start_c1 else None)(
            server_task(base, u1, ids["tc"])), 15)
        check("5b B online + sinkron → server prioritas P1 (A) + timeline.start %s (B)" % start_c1, r_a == "ok" and ok5 and st5,
              repr({k: server_task(base, u1, ids["tc"]).get(k) for k in ("priority", "ext")}))
        time.sleep(1.0)
        check("5c kontrol positif K6: ganti prioritas (kolom inti) → notifikasi U2 +1", upd_notifs(base, u2, T_C) == n_u2_c + 1,
              "%d→%d" % (n_u2_c, upd_notifs(base, u2, T_C)))
        cf.close()
        ctxs.remove(cf)

        # ── 7 HP 375 px ──
        ce, e = new_device(browser, base, u1, "E", viewport=hd.MOBILE, mobile=True)
        ctxs.append(ce)
        open_timeline(e, WS)
        e.wait_for_timeout(800)
        mob = e.evaluate("""() => { const s = document.querySelector('.plg-timeline-scroll');
            const tbl = document.querySelector('.plg-timeline-table');
            const heads = Array.from(document.querySelectorAll('.plg-timeline-corner [role=columnheader]')).map(h => h.textContent);
            const gantt = document.querySelector('.plg-timeline-seg-btn[aria-checked=true]');
            return { heads, pos: getComputedStyle(tbl).position, sw: s.scrollWidth, cw: s.clientWidth,
              docW: document.documentElement.scrollWidth, x0: tbl.getBoundingClientRect().left,
              coarse: matchMedia('(pointer: coarse)').matches,
              modes: Array.from(document.querySelectorAll('[role=radiogroup][aria-label=Tampilan] [role=radio]')).map(r => [r.textContent, r.getAttribute('aria-checked')]) }; }""")
        e.evaluate("() => { const s = document.querySelector('.plg-timeline-scroll'); s.scrollLeft += 300; s.dispatchEvent(new Event('scroll')); }")
        e.wait_for_timeout(400)
        x1 = e.evaluate("() => document.querySelector('.plg-timeline-table').getBoundingClientRect().left")
        check("7a 375 px: kolom WBS+Nama saja, menempel (sticky, tetap saat gulir), gulir horizontal di dalam wadah, halaman 375",
              mob["heads"] == ["WBS", "Nama"] and mob["pos"] == "sticky" and abs(x1 - mob["x0"]) < 1 and mob["sw"] > mob["cw"]
              and mob["docW"] == 375, repr((mob, x1)))
        check("7b sakelar 'Gantt | Daftar' (bawaan Gantt), pointer coarse", mob["modes"] == [["Gantt", "true"], ["Daftar", "false"]]
              and mob["coarse"], repr(mob["modes"]))
        e.evaluate("() => { const s = document.querySelector('.plg-timeline-scroll'); s.scrollLeft -= 300; s.dispatchEvent(new Event('scroll')); }")
        e.wait_for_timeout(400)
        shot(e, "7-E-375-gantt.png")
        cdp = ce.new_cdp_session(e)

        def touch(kind, tx, ty):
            cdp.send("Input.dispatchTouchEvent", {"type": kind, "touchPoints": [] if kind == "touchEnd" else [{"x": tx, "y": ty}]})

        def scroll_pos():
            return e.evaluate("() => { const s = document.querySelector('.plg-timeline-scroll'); return [s.scrollLeft, s.scrollTop, window.scrollY]; }")
        bb = bar(e, ids["ta"]).bounding_box()
        tx, ty = bb["x"] + 8, bb["y"] + bb["height"] / 2
        t0, s0, sp0 = now_ms(e), time.time(), scroll_pos()
        touch("touchStart", tx, ty)
        time.sleep(0.45)
        for i in range(1, 10):
            touch("touchMove", tx + i * 4, ty)
            time.sleep(0.016)
        tip = e.locator(".plg-timeline-tip").inner_text() if e.locator(".plg-timeline-tip").is_visible() else ""
        touch("touchEnd", tx + 36, ty)
        e.wait_for_timeout(2500)
        sp1 = scroll_pos()
        new_start = add_workdays(mon, 3).isoformat()
        b7 = [x_[2] for x_ in puts_for("E", ids["ta"], s0)]
        check("7c tekan lama 450 ms lalu seret +36 px (CDP touch) → 1 PUT, server %s, wadah tidak bergulir" % new_start,
              len(b7) == 1 and ext_of(base, u1, ids["ta"]).get("timeline.start") == new_start and sp0 == sp1 and writes(e, ids["ta"], t0) == 1,
              "tooltip=%r puts=%r gulir %r→%r" % (tip, b7, sp0, sp1))
        shot(e, "7-E-375-seret-sentuh.png")
        u7 = e.get_by_role("button", name="Urungkan")
        if u7.count() and u7.first.is_visible():
            u7.first.click()
            e.wait_for_timeout(2500)
        wait_until(lambda: ext_of(base, u1, ids["ta"]).get("timeline.start") == mon.isoformat(), 10)
        bb = bar(e, ids["ta"]).bounding_box()
        tx, ty = bb["x"] + 8, bb["y"] + bb["height"] / 2
        s0, sp0 = time.time(), scroll_pos()
        touch("touchStart", tx, ty)
        for i in range(1, 11):
            touch("touchMove", tx - i * 15, ty)
            time.sleep(0.01)
        touch("touchEnd", tx - 150, ty)
        e.wait_for_timeout(2000)
        sp1 = scroll_pos()
        check("7d sapuan cepat tanpa tekan lama → wadah bergulir, 0 PUT", not puts_for("E", ids["ta"], s0) and sp1[0] != sp0[0],
              "gulir %r→%r" % (sp0, sp1))
        e.get_by_role("radio", name="Daftar").click()
        e.locator(".plg-timeline-list").wait_for(state="visible", timeout=10000)
        heads = e.locator(".plg-timeline-li-head").all_inner_texts()
        wk = [h for h in heads if re.match(r"^Mg \d+", h)]
        geo7 = no_hscroll(e)
        check("7e Daftar → kelompok minggu ('Mg …') + 'Belum dijadwalkan', halaman tidak melebar",
              len(wk) >= 2 and any("Belum dijadwalkan" in h for h in heads) and geo7["sw"] <= geo7["cw"], repr((heads, geo7)))
        shot(e, "7-E-375-daftar.png")
        e.reload()
        hd.wait_dashboard_ready(e)
        wait_sync(e)
        sidebar_click(e, WS)
        try:
            e.locator(".plg-timeline-list").wait_for(state="visible", timeout=15000)
            remembered = True
        except PwTimeout:
            remembered = False
        check("7f muat ulang → halaman W tetap Timeline + Daftar (diingat per halaman)", remembered)
        ce.close()
        ctxs.remove(ce)

        # ── 6 kinerja ──
        run_perf(browser, base, u3, ids, ctxs)

        # ── 8 Sakura gelap ──
        b.evaluate("() => { localStorage.setItem('tf_palette', 'sakura'); localStorage.setItem('tf_theme', 'dark'); }")
        b.reload()
        hd.wait_dashboard_ready(b)
        wait_sync(b)
        b.evaluate("() => { window.__e2eNoReload = 1; }")
        open_timeline(b, WS)
        b.wait_for_timeout(800)
        el8 = b.evaluate("""() => ({ pal: [document.documentElement.getAttribute('data-palette'), document.documentElement.getAttribute('data-theme')],
            bars: document.querySelectorAll('.plg-timeline-bar').length, arrows: document.querySelectorAll('.plg-timeline-arrow').length,
            flags: document.querySelectorAll('.plg-timeline-flag.is-late').length,
            milestones: document.querySelectorAll('.plg-timeline-milestone').length,
            barBg: getComputedStyle(document.querySelector('.plg-timeline-bar')).backgroundColor,
            chartBg: getComputedStyle(document.querySelector('.plg-timeline-scroll')).backgroundColor })""")
        lab = b.evaluate(CONTRAST_JS.replace("el => {", "() => { const el = document.querySelector('.plg-timeline-label');", 1))
        name = b.evaluate(CONTRAST_JS.replace("el => {", "() => { const el = document.querySelector('.plg-timeline-row:not(.is-group) .plg-timeline-name');", 1))
        info("8 kontras Sakura gelap (label bar, nama baris)", [lab, name])
        check("8a Sakura gelap: bar, panah, bendera lewat tenggat, milestone ada; warna bar ≠ latar; teks nama kontras ≥ 4.5",
              el8["pal"] == ["sakura", "dark"] and el8["bars"] >= 3 and el8["arrows"] >= 1 and el8["flags"] >= 1
              and el8["milestones"] >= 1 and el8["barBg"] != el8["chartBg"] and (name or 0) >= 4.5, repr(el8))
        shot(b, "8-B-sakura-gelap-timeline.png")
        scroll_chart_to(b, "2026-12-24", 0.4)
        h8 = b.locator(".plg-timeline-holiday").count()
        check("8b Sakura gelap: arsir libur Desember tampil", h8 >= 1, "holiday=%d" % h8)
        shot(b, "8-B-sakura-gelap-libur.png")

        # ── 9 OFF dari Pengaturan saat view aktif ──
        open_timeline(a, WS)
        a.evaluate("() => { window.__e2eNoReload = 1; }")
        open_settings(a)
        a.locator(SWITCH).click()
        off = wait_switch(a, False)
        sidebar_click(a, WS)
        a.locator(".task-row", has_text=T_C).first.wait_for(state="visible", timeout=15000)
        check("9a OFF dari Pengaturan → slist_W kembali ke mode inti tanpa reload, tombol Timeline hilang",
              off and a.locator(".tf-plugin-view").count() == 0 and view_btn(a, VIEW).count() == 0
              and a.evaluate("() => window.__e2eNoReload") == 1)
        open_modal(a, T_C)
        a.wait_for_timeout(1500)
        check("9b seksi Jadwal hilang dari detail task", a.locator(".modal-content .plg-timeline-section").count() == 0
              and a.locator(".modal-content .td-desc-wrap").count() == 1)
        shot(a, "9-A-plugin-off.png")
        close_modal(a)
        check("9c server: Timeline OFF untuk U1; ext task tetap", not plugin_enabled(base, u1)
              and ext_of(base, u1, ids["tc"]).get("timeline.start") == start_c1)

        # ── 10 Tauri ──
        tauri = [os.path.join(ROOT, "src-tauri", "target", k) for k in ("release", "debug")]
        built = [x_ for x_ in tauri if os.path.isdir(x_)]
        print("SKIP 10 Tauri Desktop: %s" % ("build ada di %r tetapi tidak diotomasi" % built if built else
                                             "tidak ada build src-tauri/target (dilewati)"), flush=True)
        perf["10 Tauri"] = "dilewati: tidak ada build"

        # ── konsol ──
        allowed = re.compile(r"Failed to load resource|net::ERR_")
        # 4e-1 sengaja menggagalkan tarik record Timeline di perangkat B (503) → pesan galat tarik itu diharapkan
        injected = lambda dv, x_: dv == "B" and "pull record plugin gagal" in x_  # noqa: E731
        bad = [(dv, t, x_[:200]) for dv, t, x_ in console_log if t in ("error", "pageerror") and not allowed.search(x_) and not injected(dv, x_)]
        check("8c konsol tanpa error (selain sumber eksternal/offline yang diblokir)", not bad, repr(bad[:6]))
        warn = [(dv, x_[:200]) for dv, t, x_ in console_log if t == "warning" and re.search(r"plugin|timeline", x_, re.I)
                and not injected(dv, x_)]
        check("8d konsol tanpa peringatan plugin/timeline", not warn, repr(warn[:6]))
    finally:
        for cx in ctxs:
            try:
                cx.close()
            except Exception:  # noqa: BLE001
                pass


# Render Timeline sendiri (keputusan controller 2026-11-01: anggaran R24 150 ms @ CPU 4× = dari pemasangan view sampai
# Gantt pertama tergambar, TANPA pembongkaran daftar Normal 500 baris oleh host). Komponen kontribusi `taskList.views`
# (TF.plugins.contributions) dipasang ulang dengan props nyata (context + api yang sedang dipakai view, dibaca dari fiber
# React) ke wadah `.tf-plugin-view` baru di tempat yang sama (view asli disembunyikan) lewat createRoot + flushSync:
# "dom" = render + commit + layout effect selesai dengan baris task di DOM, "frame" = sampai frame berikut (rAF + task).
PLUGIN_RENDER_JS = """(n) => new Promise(async (res) => {
  const view = document.querySelector('.tf-plugin-view');
  const rootEl = view && view.querySelector('.plg-timeline');
  const fk = rootEl && Object.keys(rootEl).find((k) => k.indexOf('__reactFiber$') === 0);
  let f = fk ? rootEl[fk] : null;
  while (f && !(f.memoizedProps && f.memoizedProps.api && f.memoizedProps.context)) f = f.return;
  const c = (window.TF.plugins.contributions('taskList.views') || []).find((x) => x.pluginId === 'timeline' && x.id === 'gantt');
  if (!f || !c) { res({ error: 'props/kontribusi tidak ditemukan', fiber: !!f, contrib: !!c }); return; }
  const props = { context: f.memoizedProps.context, api: f.memoizedProps.api };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const frame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
  view.style.display = 'none';
  const host = document.createElement('div');
  host.className = 'tf-plugin-view';
  view.parentNode.insertBefore(host, view);
  const out = [];
  for (let i = 0; i < n; i++) {
    await sleep(1500);
    const root = ReactDOM.createRoot(host);
    const t0 = performance.now();
    ReactDOM.flushSync(() => root.render(React.createElement(c.component, props)));
    const dom = host.querySelector('.plg-timeline-row:not(.is-group)') ? performance.now() - t0 : null;
    await frame();
    const fr = performance.now() - t0;
    const rows = host.querySelectorAll('.plg-timeline-row').length;
    const bars = host.querySelectorAll('.plg-timeline-bar').length;
    out.push({ dom, frame: fr, rows, bars });
    root.unmount();
  }
  host.remove();
  view.style.display = '';
  res({ runs: out });
})"""

MEASURE_JS = """() => new Promise((res) => {
  const btn = document.querySelector(".tl-view-btn[aria-label='Timeline']");
  let t1 = null; const t0 = performance.now();
  const done = () => { requestAnimationFrame(() => setTimeout(() => res({ dom: t1 - t0, frame: performance.now() - t0 }), 0)); };
  const mo = new MutationObserver(() => {
    if (t1 === null && document.querySelector('.plg-timeline-row:not(.is-group)')) { t1 = performance.now(); mo.disconnect(); done(); }
  });
  mo.observe(document.body, { childList: true, subtree: true });
  btn.click();
  if (t1 === null && document.querySelector('.plg-timeline-row:not(.is-group)')) { t1 = performance.now(); mo.disconnect(); done(); }
})"""

SCROLL_JS = """([ms, vy, vx]) => new Promise((res) => {
  // gulir berkecepatan tetap (px/s) selama `ms` lewat rAF; long task lewat PerformanceObserver; elemen DOM maks tiap frame
  const s = document.querySelector('.plg-timeline-scroll');
  const longs = []; let maxDom = 0, frames = 0, po = null;
  try { po = new PerformanceObserver((l) => { for (const e of l.getEntries()) longs.push([Math.round(e.startTime), Math.round(e.duration)]); });
        po.observe({ type: 'longtask', buffered: false }); } catch (e) { longs.push(['unsupported', String(e)]); }
  const t0 = performance.now(); const top0 = s.scrollTop, left0 = s.scrollLeft;
  const step = () => {
    const t = performance.now() - t0; frames++;
    s.scrollTop = Math.round(top0 + vy * t / 1000);
    s.scrollLeft = Math.round(left0 + vx * t / 1000);
    const n = document.querySelectorAll('.plg-timeline *').length; if (n > maxDom) maxDom = n;
    if (t < ms) requestAnimationFrame(step);
    else setTimeout(() => { if (po) po.disconnect(); res({ longs, maxDom, frames, top: s.scrollTop, left: s.scrollLeft - left0 }); }, 200);
  };
  requestAnimationFrame(step);
})"""


def consecutive_longs(longs, gap=17):
    """Pasangan long task berturut (awal yang berikut ≤ `gap` ms setelah yang sebelumnya selesai)."""
    xs = [x for x in longs if isinstance(x[0], int)]
    return [(p_, q) for p_, q in zip(xs, xs[1:]) if q[0] - (p_[0] + p_[1]) <= gap]


def run_perf(browser, base, u3, ids, ctxs):
    cd, d = new_device(browser, base, u3, "D")
    ctxs.append(cd)
    try:
        n_tasks = d.evaluate("() => window.TF.db.openDB().then(db => new Promise(r => { const g = db.transaction('tasks').objectStore('tasks').count(); g.onsuccess = () => r(g.result); }))")
        info("6 task di IndexedDB perangkat D", n_tasks)
        sidebar_click(d, WS_BIG)
        btn = view_btn(d, VIEW)
        btn.wait_for(state="visible", timeout=20000)
        d.wait_for_timeout(1500)
        first = d.evaluate(MEASURE_JS)
        info("6 klik pertama (memuat plugin.js, tanpa throttle) ms", {k: round(v, 1) for k, v in first.items()})
        d.locator(".plg-timeline-scroll").wait_for(state="visible", timeout=20000)
        d.wait_for_timeout(1500)
        cdp = cd.new_cdp_session(d)
        cdp.send("Emulation.setCPUThrottlingRate", {"rate": CPU_RATE})
        runs = []
        for _ in range(3):
            view_btn(d, "Normal").click()
            d.locator(".plg-timeline").wait_for(state="detached", timeout=20000)
            d.wait_for_timeout(2500)
            runs.append(d.evaluate(MEASURE_JS))
            d.wait_for_timeout(2000)
        dom_ms = [round(r_["dom"], 1) for r_ in runs]
        frame_ms = [round(r_["frame"], 1) for r_ in runs]
        info("6 [info] ganti view Normal (500 baris) → Timeline, CPU 4×: baris pertama di DOM ms (termasuk pembongkaran daftar host)", dom_ms)
        info("6 [info] ganti view Normal → Timeline, CPU 4×: sampai frame berikut ms", frame_ms)
        pr = d.evaluate(PLUGIN_RENDER_JS, 9)
        p_runs = pr.get("runs") or []
        p_dom = [round(x["dom"], 1) if x["dom"] is not None else None for x in p_runs]
        p_frame = [round(x["frame"], 1) for x in p_runs]
        info("6 render Timeline sendiri (pasang view → Gantt tergambar), CPU 4×: DOM ms / frame ms / baris+bar DOM",
             [p_dom, p_frame, [(x["rows"], x["bars"]) for x in p_runs]])
        ok_runs = p_runs and all(x["dom"] is not None and x["bars"] > 0 for x in p_runs)
        check("6a CPU 4×, plugin.js ter-cache: render Timeline sendiri (pemasangan view → Gantt pertama tergambar) ≤ %d ms "
              "(median %d putaran; keputusan controller: tanpa pembongkaran daftar Normal host)" % (BUDGET_MS, len(p_runs)),
              ok_runs and statistics.median(p_frame) <= BUDGET_MS, "frame=%r dom=%r %r" % (p_frame, p_dom, pr.get("error")))
        rows = d.evaluate("() => [document.querySelectorAll('.plg-timeline-row').length, document.querySelector('.plg-timeline-scroll').getAttribute('aria-rowcount')]")
        idle = dom_count(d)
        info("6 elemen DOM .plg-timeline * saat diam (baris DOM, aria-rowcount)", [idle] + rows)
        check("6b 500 task: elemen DOM ≤ %d saat diam (baris tervirtualisasi)" % DOM_BUDGET, 0 < idle <= DOM_BUDGET
              and int(rows[1]) >= 510 and rows[0] < 100, repr((idle, rows)))
        arrows = d.locator(".plg-timeline-arrow").count()
        info("6 panah tampak", arrows)
        shot(d, "6-D-500-task.png")
        def scroll_run(tag, vy, vx):
            d.evaluate("() => { const s = document.querySelector('.plg-timeline-scroll'); s.scrollTop = 0; s.scrollLeft = 300; s.dispatchEvent(new Event('scroll')); }")
            d.wait_for_timeout(1000)
            r_ = d.evaluate(SCROLL_JS, [3000, vy, vx])
            lg = [x for x in r_["longs"] if isinstance(x[0], int)]
            cons_ = consecutive_longs(lg)
            info("6 gulir 3 s %s (vy %d, vx %d px/s): frame, long task n, maks ms, total ms, pasangan berturut, DOM maks"
                 % (tag, vy, vx), [r_["frames"], len(lg), max([x[1] for x in lg] or [0]), sum(x[1] for x in lg), len(cons_), r_["maxDom"]])
            return r_, lg, cons_
        sc, longs, cons = scroll_run("CPU 4×", 1000, 300)
        info("6 gulir CPU 4×: daftar long task [start, dur]", longs[:40])
        check("6c saat gulir 3 s (CPU 4×): elemen DOM maks ≤ %d" % DOM_BUDGET, 0 < sc["maxDom"] <= DOM_BUDGET, "maks=%d" % sc["maxDom"])
        check("6d gulir 3 s (CPU 4×, 1000 px/s vertikal + 300 px/s horizontal): tidak ada long task (> 50 ms) berturut",
              not cons and sc["top"] > 0 and longs is not None, "berturut=%d %r" % (len(cons), cons[:4]))
        scroll_run("CPU 4× vertikal saja", 1000, 0)
        scroll_run("CPU 4× horizontal saja", 0, 600)
        d.evaluate("() => { const b = Array.from(document.querySelectorAll('.plg-timeline-seg-btn')).find(x => x.textContent === 'Minggu'); b.click(); }")
        d.wait_for_timeout(1000)
        zm = d.evaluate("""() => new Promise(res => { const b = Array.from(document.querySelectorAll('.plg-timeline-seg-btn')).find(x => x.textContent === 'Bulan');
            const t0 = performance.now(); b.click(); requestAnimationFrame(() => setTimeout(() => {
              const b2 = Array.from(document.querySelectorAll('.plg-timeline-seg-btn')).find(x => x.textContent === 'Minggu');
              const m = performance.now() - t0; const t1 = performance.now(); b2.click();
              requestAnimationFrame(() => setTimeout(() => res([m, performance.now() - t1]), 0)); }, 0)); })""")
        info("6 CPU 4×: ganti zoom Bulan / kembali Minggu (tata letak + render ulang plugin saja, tanpa host) ms", [round(x, 1) for x in zm])
        sidebar_click(d, "Inbox")
        d.wait_for_timeout(2500)
        pg = d.evaluate("""(label) => new Promise((res) => {
            const link = Array.from(document.querySelectorAll('.sidebar-link')).find(l => Array.from(l.querySelectorAll('span')).some(s => s.textContent === label));
            let t1 = null; const t0 = performance.now();
            const mo = new MutationObserver(() => { if (t1 === null && document.querySelector('.plg-timeline-row:not(.is-group)')) {
              t1 = performance.now(); mo.disconnect(); requestAnimationFrame(() => setTimeout(() => res({ dom: t1 - t0, frame: performance.now() - t0 }), 0)); } });
            mo.observe(document.body, { childList: true, subtree: true }); link.click(); })""", WS_BIG)
        info("6 [info] CPU 4×: dari Inbox klik sidebar ke workspace besar (Timeline diingat) → baris pertama ms", {k: round(v, 1) for k, v in pg.items()})
        d.locator(".plg-timeline-scroll").wait_for(state="visible", timeout=20000)
        d.wait_for_timeout(1500)
        cdp.send("Emulation.setCPUThrottlingRate", {"rate": 1})
        scroll_run("CPU 1×", 1000, 300)
        cdp.send("Emulation.setCPUThrottlingRate", {"rate": CPU_RATE})
        idle2 = dom_count(d)
        info("6 elemen DOM setelah gulir", idle2)
        # seksi Jadwal + pemilih di akun besar (dibaca seluruh daftar task saat dibuka)
        view_btn(d, "Normal").click()
        d.locator(".task-row").first.wait_for(state="visible", timeout=20000)
        d.wait_for_timeout(1500)
        sec_ms = d.evaluate("""() => new Promise((res) => {
            const row = document.querySelector('.task-row'); const t0 = performance.now(); let tm = null;
            const iv = setInterval(() => { const m = document.querySelector('.modal-content');
              if (m && tm === null) tm = performance.now() - t0;
              const s = document.querySelector(".modal-content .plg-timeline-section:not([aria-busy='true']) input[type=date], .modal-content .plg-timeline-section:not([aria-busy='true']) .plg-timeline-sec-note");
              if (s) { clearInterval(iv); res({ modal: tm, section: performance.now() - t0 }); }
              else if (performance.now() - t0 > 20000) { clearInterval(iv); res({ modal: tm, section: null }); } }, 5);
            row.click(); })""")
        info("6 akun besar CPU 4×: klik task → modal / seksi Jadwal siap ms", {k: (round(v, 1) if v else v) for k, v in sec_ms.items()})
        d.wait_for_timeout(500)
        pick_ms = d.evaluate("""() => new Promise((res) => {
            const btn = Array.from(document.querySelectorAll('.modal-content .plg-timeline-section button')).find(b => b.textContent.trim() === 'Tambah dependensi');
            if (!btn) { res(null); return; } const t0 = performance.now();
            const iv = setInterval(() => { if (document.querySelector('.plg-timeline-pick')) { clearInterval(iv); res({ picker: performance.now() - t0, n: document.querySelectorAll('.plg-timeline-pick').length }); }
              else if (performance.now() - t0 > 20000) { clearInterval(iv); res({ picker: null }); } }, 5);
            btn.click(); })""")
        info("6 akun besar CPU 4×: 'Tambah dependensi' → kandidat tampil ms", pick_ms)
        check("6e akun besar: seksi Jadwal dan pemilih dependensi terbuka (angka dicatat)",
              sec_ms.get("section") is not None and pick_ms and pick_ms.get("picker") is not None and pick_ms["n"] <= 50,
              repr((sec_ms, pick_ms)))
        shot(d, "6-D-seksi-akun-besar.png")
        cdp.send("Emulation.setCPUThrottlingRate", {"rate": 1})
    finally:
        cd.close()
        ctxs.remove(cd)


# ── seed ──────────────────────────────────────────────────────────────────────

def seed_all(base, db_path, mon):
    u1 = hd.seed(base, username="tl1b1", display_name="Rani")
    u2 = hd.seed(base, username="tl1b2", display_name="Sari")
    u3 = hd.seed(base, username="tl1b3", display_name="Bima")
    u4 = hd.seed(base, username="tl1b4", display_name="Tari")
    ws_id = hd.api(base, u1, "POST", "/api/lists", json={"name": WS})["id"]
    with sqlite3.connect(db_path) as conn:
        for u in (u2, u4):
            conn.execute("INSERT INTO list_members (list_id, user_id, joined_at) VALUES (?,?,?)",
                         (ws_id, u["id"], datetime.datetime.now().isoformat()))
    d = lambda n: (mon + datetime.timedelta(days=n)).isoformat()

    def mk(user, title, ext=None, **kw):
        body = {"title": title, "gtd_status": "next", "priority": "P3"}
        body.update(kw)
        if ext:
            body["ext"] = {PID + "." + k: v for k, v in ext.items()}
        return task_id(hd.api(base, user, "POST", "/api/tasks", json=body))

    ids = {"ws": ws_id}
    ids["ta"] = mk(u1, T_A, {"start": d(0), "duration": 3}, list_id=ws_id, project="Alpha")
    ids["tb"] = mk(u1, T_B, {"start": d(7), "duration": 3}, list_id=ws_id, project="Alpha", deadline=d(7))
    ids["ts"] = mk(u1, T_S, None, list_id=ws_id, project="Alpha")
    ids["tu"] = mk(u1, T_U, None, list_id=ws_id, project="Alpha")
    ids["tr"] = mk(u1, T_R, None, list_id=ws_id, project="Alpha", recurrence_type="daily")
    ids["tc"] = mk(u1, T_C, {"start": d(14), "duration": 5}, list_id=ws_id, project="Beta")
    ids["tm"] = mk(u1, T_M, {"start": d(21), "duration": 0, "deps": [{"t": {"$task": ids["tc"]}, "type": "FS", "lag": 0}]},
                   list_id=ws_id, project="Beta")
    ids["tn"] = mk(u1, T_N, {"start": d(2), "duration": 2}, list_id=ws_id)
    ids["ti"] = mk(u1, T_I, None, list_id=ws_id, project="Beta")
    mk(u1, "Persiapan Gamma", {"start": d(1), "duration": 2}, project=GAMMA)
    ids["tx"] = mk(u1, T_X, {"start": "2040-01-02", "duration": 2}, project=GAMMA)
    mk(u1, "Tugas inbox biasa", None, gtd_status="inbox")
    for k in ("ta", "tb", "tc"):  # rentang 1 bulan → arsip tidak relevan, tetapi tetap "next"
        assert ids[k]
    s1 = hd.api(base, u4, "PUT", "/api/plugins/state/%s" % PID, json={"enabled": True})
    s3 = hd.api(base, u3, "PUT", "/api/plugins/state/%s" % PID, json={"enabled": True})
    check("setup: U2 dan U4 anggota W; Timeline ON untuk U4 dan U3 lewat API",
          s1["state"]["enabled"] is True and s3["state"]["enabled"] is True
          and any(x["id"] == ws_id for x in hd.api(base, u2, "GET", "/api/lists"))
          and any(x["id"] == ws_id for x in hd.api(base, u4, "GET", "/api/lists")))
    # 500 task + 400 dependensi di workspace U3 (10 project × 50; task ke-10..49 tiap project bergantung pada sebelumnya)
    big = hd.api(base, u3, "POST", "/api/lists", json={"name": WS_BIG})["id"]
    ids["big"] = big
    t_start = time.time()
    n_dep = 0
    sess = requests.Session()
    sess.headers["Authorization"] = "Bearer " + u3["token"]
    for pj in range(10):
        prev = None
        for j in range(50):
            ext = {"start": (mon + datetime.timedelta(days=-70 + j * 3 + pj)).isoformat(), "duration": 1 + (j % 5)}
            if j >= 10 and prev:
                ext["deps"] = [{"t": {"$task": prev}, "type": "FS", "lag": 0}]
                n_dep += 1
            body = {"title": "Tugas %02d-%02d" % (pj, j), "gtd_status": "next", "priority": "P3", "list_id": big,
                    "project": "Proyek %02d" % pj, "ext": {PID + "." + k: v for k, v in ext.items()}}
            r = sess.post(base + "/api/tasks", json=body, timeout=10)
            r.raise_for_status()
            prev = task_id(r.json())
    info("6 seed 500 task + %d dependensi (s)" % n_dep, round(time.time() - t_start, 1))
    return {"u1": u1, "u2": u2, "u3": u3, "u4": u4}, ids


def main():
    # hanya tangkapan skrip ini (awalan nomor skenario); tangkapan lain di folder yang sama tidak disentuh
    if os.path.isdir(SHOTS):
        for fn in os.listdir(SHOTS):
            if re.match(r"^\d+-.*\.png$", fn):
                os.remove(os.path.join(SHOTS, fn))
    tmp = tempfile.mkdtemp(prefix="e2e_plugin_fase1_1b_")
    db_path = os.path.join(tmp, "e2e.db")
    proc, base = hd.start_server(tmp)
    print("server", base, flush=True)
    today = datetime.date.today()
    mon = next_monday(today)
    try:
        users, ids = seed_all(base, db_path, mon)
        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            run(browser, base, users, ids, {"mon": mon, "today": today})
            browser.close()
    finally:
        proc.terminate()
        try:
            proc.wait(10)
        except subprocess.TimeoutExpired:
            proc.kill()
        log = os.path.join(tmp, "server.log")
        if os.path.exists(log):
            with open(log, encoding="utf-8", errors="replace") as fh:
                lines = [ln.rstrip() for ln in fh if re.search(r"Traceback|ERROR|plugin server", ln)]
            print("  log server (error): %r" % lines[:8], flush=True)
        shutil.rmtree(tmp, ignore_errors=True)
    failed = [r for r in hd.results if not r[1]]
    print("\nangka:")
    for k, v in perf.items():
        print("  %s: %s" % (k, v))
    print("\n%d/%d cek lolos" % (len(hd.results) - len(failed), len(hd.results)), flush=True)
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
