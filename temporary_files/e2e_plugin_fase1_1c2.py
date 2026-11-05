"""E2E PR 1c-2 (Timeline 1.2: baseline + catatan aktual). Rencana docs/superpowers/plans/2026-11-05-plugin-fase1-pr-1c-2.md
Task 12 Step 1. Tidak dijalankan CI.

    TZ=Asia/Jakarta python3 temporary_files/e2e_plugin_fase1_1c2.py

Memakai helper `e2e_plugin_fase1_1c0.py` + `e2e_plugin_fase1_1c1.py` (server uvicorn lokal `webapp:app` + DB SQLite
sementara + Chromium; tiap "perangkat" = satu `browser.new_context(service_workers="block")`, IndexedDB terpisah). Server
dijalankan dengan `TZ=Etc/UTC` (paritas VPS); peramban dan skrip memakai Asia/Jakarta.

U1 "tc2a" Rani (pemilik workspace W "Ruang Baseline" dan WP "Ruang Kinerja"; perangkat A, B, F (jam Playwright terpasang,
Pomodoro nyata), Z (jam dipatok 23:30 UTC), M (375 px Sakura gelap)), U2 "tc2b" Sari (anggota W dan WP; perangkat N (baru,
tarik record diblokir), C (klien 1.1 dipatok cb76fba5), P10 (kinerja)). Timeline ON keduanya lewat API.

Seed W: project Alfa (Otomatis dinyalakan di setup lewat UI) — rantai R→A1→A2→A3 (FS), X1 (sudah ber-actual.start),
N5 (tanpa aktual), D5 (selesai: completed_at = Selasa 23:30 UTC lewat SQLite, actual.start = Senin); project Beta (Manual)
B1, B2. Seed WP: Gamma 300 task + Delta 200 task, 400 dependensi FS/SS/FF/SF, 60 task ber-actual.start.

   1 nol tulisan latar: A dan B membuka Timeline W; F menjalankan Pomodoro nyata (tombol Fokus + jam maju 25 menit) pada
     X1 yang SUDAH ber-aktual → pomodoro.ended; 2 siklus sinkron A/B/F; seksi Jadwal (tingkat 3) dibuka → 0 PUT / 0 POST
     records; ext X1 di server tidak berubah.
   2 A Simpan baseline (Alfa, slot 1) → 1 POST record bl1@…, 0 PUT; pilih "Baseline 1" → bar baseline = bar task;
     B tarik → pilih → bar baseline B = A; perangkat baru N (U2) dengan tarik record diblokir → dialog terkunci
     "Menunggu data baseline workspace…", Simpan nonaktif, 0 POST; tarik dibuka → slot 1 terisi dan terbuka.
   3 A timpa slot 1 → konfirmasi "Timpa Baseline 1 (disimpan …)?" → Timpa → 1 POST. CAS dua anggota: A buka dialog,
     N (U2) simpan slot 2, A tarik lalu simpan slot 2 dari potret lama → "Data berubah sejak dialog dibuka — muat ulang",
     0 POST A, potret segar → konfirmasi "Timpa Versi Sari (…)?" → Timpa → server milik A.
   4 F Pomodoro nyata pada R (tanpa aktual) → tepat 1 PUT {ext_patch: {timeline.actual: {start: T0}}}; A tarik → bar R
     berpindah ke T0 (jangkar), garis aktual mulai T0, banner drift 3 penerus, 0 PUT sampai Tinjau → Terapkan.
   5 D5 completed_at 23:30 UTC → "Selesai aktual" = hari Jakarta BESOKNYA (+ penanda "Aktual") dan garis aktual sampai hari
     itu (lebar 3 hari, bukan 2); Z (jam 23:30 UTC) mencentang N5 → task.completed → actual.start = hari Jakarta besoknya.
   6 seksi A1: tingkat 2 "… · baseline −n hk" + chip Otomatis; tabel Baseline vs sekarang 3×3 sesuai record + server;
     task di luar baseline → "Tidak ada".
   7 klien 1.1 (C, U2; index.json/plugin.js/style.css/plugin-runtime.js dipatok cb76fba5 lewat route) seret X1 ber-aktual
     → PUT tanpa kunci actual; server: start berubah, actual SAMA; record baseline tidak tersentuh; A tetap menampilkan
     aktual (garis + seksi).
   8 375 px + Sakura gelap (M): "Lainnya" memuat Baseline + Simpan baseline; bar baseline + garis aktual tampil dan
     terukur kontrasnya; seksi tabel muat 375 px; 0 tulis.
   9 kinerja (P10, U2, CPU 4×, WP 500/400, baseline Gamma+Delta aktif, Jalur kritis ON, 60 garis aktual): mesin ≤ 40 ms,
     DOM ≤ 1.500 (diam + gulir).
  10 regresi dijalankan terpisah (lihat laporan Task 12).
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
from playwright.sync_api import sync_playwright

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import e2e_hero_dashboard as hd  # noqa: E402
import e2e_plugin_fase1_1c0 as c0  # noqa: E402
import e2e_plugin_fase1_1c1 as c1  # noqa: E402  (memasang c1.watch ke c0.watch: PUT + POST records + respons)

SHOTS = c0.SHOTS = os.path.join(hd.ROOT, "temporary_files", "e2e_plugin_fase1_1c2")
PIN = "cb76fba5"  # merge PR 1c-1 = Timeline 1.1.0 (bukan ref bergerak)
PID = c0.PID
WS, WP = "Ruang Baseline", "Ruang Kinerja"
ALFA, BETA, GAMMA, DELTA = "Alfa", "Beta", "Gamma", "Delta"
TYPES = ["FS", "SS", "FF", "SF"]
CPU_RATE = 4
ENGINE_BUDGET, DOM_BUDGET = 40, 1500
JKT = datetime.timezone(datetime.timedelta(hours=7))
MINUS = "−"
MSG_WAIT = "Menunggu data baseline workspace…"
MSG_STALE = "Data berubah sejak dialog dibuka — muat ulang"
PV_FLOW = "Tinjau jadwal otomatis"
RECS_PULL_RE = re.compile(r"/api/plugins/%s/records\?cursor=" % PID)

check, info, nap, wait_until = hd.check, c0.info, c0.nap, c0.wait_until
sync_now, shot = c0.sync_now, c0.shot
puts, recs, resps = c0.puts, c1.recs, c1.resps
short = c1.short
wd = c1.wd


def pinned(path):
    return subprocess.run(["git", "show", PIN + ":" + path], cwd=hd.ROOT, check=True, capture_output=True).stdout


OLD_CLIENT = {  # klien 1.1 lengkap: indeks (hash lama → plugin.js?v=lama), kode plugin, gaya, runtime
    "static/plugins/index.json": ("application/json", pinned("static/plugins/index.json")),
    "static/plugins/timeline/plugin.js": ("application/javascript", pinned("static/plugins/timeline/plugin.js")),
    "static/plugins/timeline/style.css": ("text/css", pinned("static/plugins/timeline/style.css")),
    "static/plugin-runtime.js": ("application/javascript", pinned("static/plugin-runtime.js")),
}
assert b'"version":"1.1.0"' in OLD_CLIENT["static/plugins/timeline/plugin.js"][1].replace(b" ", b""), "patokan bukan Timeline 1.1.0"


def serve_pinned(ctx, served):
    def make(path, ctype, body):
        def handler(route):
            served.append(path)
            route.fulfill(status=200, content_type=ctype, body=body)
        return handler
    for path, (ctype, body) in OLD_CLIENT.items():
        ctx.route(re.compile(re.escape("/" + path) + r"(\?.*)?$"), make(path, ctype, body))


# Toast (teks persis) + event host (pomodoro.ended / task.completed) per halaman.
MY_INIT = r"""(() => { window.__toasts = []; window.__ev = [];
  const RX = /(Jadwal diubah · \d+ task ikut bergeser|Jadwal diterapkan · \d+ task|Jadwal otomatis menyala — tidak ada task yang bergeser|Data berubah sejak dialog dibuka — muat ulang|Baseline terlalu besar|Baseline gagal disimpan|(?:Baseline \d|Rencana awal|Versi Sari|Versi Rani|Baseline Gamma|Baseline Delta) disimpan)/;
  const scan = (t) => { if (!t || t.length > 400) return; const m = t.match(RX); if (m) window.__toasts.push([m[1], Date.now()]); };
  new MutationObserver((ms) => { for (const m of ms) { if (m.type === 'characterData') scan(m.target.textContent);
    for (const n of m.addedNodes || []) scan(n.textContent); } }).observe(document, { childList: true, subtree: true, characterData: true });
  // Satu pendaftaran saja: di halaman berjam palsu (clock.install / set_system_time) clearInterval bisa milik jam lain.
  const iv = setInterval(() => { const E = window.TF && window.TF.events; if (window.__evOn || !E || typeof E.on !== 'function') return;
    window.__evOn = true; clearInterval(iv);
    for (const n of ['pomodoro.ended', 'task.completed']) E.on(n, (p) => window.__ev.push([n, p && p.taskId !== undefined ? String(p.taskId) : null,
      p ? (p.endedAt || p.completedAt || null) : null, Date.now()])); }, 20);
})();"""


def new_ctx(browser, base, **kw):
    ctx = c0.new_context(browser, base, **kw)
    ctx.add_init_script(MY_INIT)
    return ctx


def open_dev(browser, base, user, label, **kw):
    ctx = new_ctx(browser, base, **kw)
    return ctx, c0.open_page(ctx, base, user, label)


def now_ms(p):
    return p.evaluate("() => Date.now()")


def toasts(p, since):
    return [t for t, at in p.evaluate("() => window.__toasts") if at >= since]


def puts_of(label, since, tids=None):
    return [x for x in puts if x[0] == label and x[3] >= since and (tids is None or x[1] in tids)]


def rec_items(label, since, prefix=None):
    """Item record yang di-POST perangkat `label` sejak `since` (id diawali `prefix` bila diberikan)."""
    out = []
    for x in recs:
        if x[0] != label or x[2] < since:
            continue
        for it in ((x[1] or {}).get("items") or []):
            if prefix is None or str(it.get("id", "")).startswith(prefix):
                out.append(it)
    return out


def writes(labels, since):
    return sum(len(puts_of(lb, since)) for lb in labels), sum(len(rec_items(lb, since)) for lb in labels)


def server_tasks(base, user):
    r = hd.api(base, user, "GET", "/api/tasks?include_done=true")
    items = r if isinstance(r, list) else r.get("tasks", [])
    out = {}
    for t in items:
        e = t.get("ext") or {}
        if isinstance(e, str):
            e = json.loads(e or "{}")
        out[t["id"]] = {"ext": {k[len(PID) + 1:]: v for k, v in e.items() if k.startswith(PID + ".")},
                        "gtd_status": t.get("gtd_status"), "completed_at": t.get("completed_at"),
                        "pomodoros_done": t.get("pomodoros_done"), "title": t.get("title")}
    return out


def server_bl(base, user):
    r = hd.api(base, user, "GET", "/api/plugins/%s/records?limit=1000" % PID)
    return {x["id"]: x for x in r.get("items", []) if str(x.get("id", "")).startswith("bl") and not x.get("deleted")}


# [style.left, style.width, title, tinggi, rect.left, rect.width] — bar task diposisikan lewat transform (style.left NaN):
# perbandingan bar ↔ bar baseline/garis aktual memakai rect (viewport yang sama); antar perangkat memakai style.
GEO_JS = """(sel) => Object.fromEntries(Array.from(document.querySelectorAll(sel)).map((b) => { const r = b.getBoundingClientRect();
  const q = (v) => Math.round(v * 10) / 10;
  return [b.getAttribute('data-key'), [parseFloat(b.style.left), parseFloat(b.style.width), b.getAttribute('title'), q(r.height), q(r.left), q(r.width)]]; }))"""


def geo(p, sel):
    return p.evaluate(GEO_JS, sel)


def bars(p):
    return geo(p, ".plg-timeline-bar[data-key]")


def blbars(p):
    return geo(p, ".plg-timeline-blbar")


def actlines(p):
    return geo(p, ".plg-timeline-actual")


def legend(p):
    return p.evaluate("() => Array.from(document.querySelectorAll('.plg-timeline-legend-item')).map(x => x.textContent)")


def drift_banner(p):
    return c1.drift_banner(p)


# ── Baseline: pemilih + dialog ────────────────────────────────────────────────

def pick_baseline(p, label):
    btn = p.locator(".plg-timeline-blbtn")
    btn.wait_for(state="visible", timeout=20000)
    menu = p.locator(".plg-timeline-blpick")
    if not menu.count():
        btn.click()
    menu.wait_for(state="visible", timeout=8000)
    items = menu.locator("[role=menuitemradio]").all_inner_texts()
    menu.locator("[role=menuitemradio]", has_text=re.compile("^" + re.escape(label) + "$")).first.click()
    menu.wait_for(state="detached", timeout=8000)
    p.wait_for_timeout(500)
    return items


def open_save(p):
    p.locator(".plg-timeline-toolbar button", has_text=re.compile("^Simpan baseline$")).first.click()
    dlg = p.locator(".plg-timeline-bl-dlg")
    dlg.wait_for(state="visible", timeout=10000)
    return dlg


DLG_JS = """(el) => ({
  units: Array.from(el.querySelectorAll('.plg-timeline-bl-units [role=radio]')).map(b => [b.textContent, b.getAttribute('aria-checked')]),
  slots: Array.from(el.querySelectorAll('.plg-timeline-bl-slots [role=radio]')).map(b => ({ label: b.textContent, disabled: b.disabled,
    checked: b.getAttribute('aria-checked') })),
  wait: (el.querySelector('.plg-timeline-bl-wait') || {}).textContent || null,
  name: (el.querySelector('.plg-timeline-bl-name') || {}).value || null,
  confirm: (el.querySelector('.plg-timeline-bl-confirm-text') || {}).textContent || null,
  apply: (el.querySelector('.plg-timeline-pv-apply') || {}).textContent || null,
  applyDisabled: !!(el.querySelector('.plg-timeline-pv-apply') || {}).disabled })"""


def dlg_state(dlg):
    return dlg.evaluate(DLG_JS)


def dlg_unit(dlg, name):
    dlg.locator(".plg-timeline-bl-units [role=radio]", has_text=re.compile("^" + re.escape(name) + "$")).first.click()


def dlg_slot(dlg, n):
    dlg.locator(".plg-timeline-bl-slots [role=radio]").nth(n - 1).click()


def dlg_name(dlg, s):
    dlg.locator(".plg-timeline-bl-name").fill(s)


def dlg_apply(dlg):
    dlg.locator(".plg-timeline-pv-apply").click()


def dlg_cancel(p):
    dlg = p.locator(".plg-timeline-bl-dlg")
    dlg.get_by_role("button", name="Batal").click()
    dlg.wait_for(state="detached", timeout=8000)


def save_baseline(p, unit, n, name):
    """Dialog lengkap untuk slot KOSONG: pilih unit + slot + nama → Simpan → dialog tertutup."""
    dlg = open_save(p)
    if dlg.locator(".plg-timeline-bl-units").count():
        dlg_unit(dlg, unit)
    wait_until(lambda: not dlg_state(dlg)["slots"][n - 1]["disabled"], 15, 0.3)
    dlg_slot(dlg, n)
    dlg_name(dlg, name)
    dlg_apply(dlg)
    p.locator(".plg-timeline-bl-dlg").wait_for(state="detached", timeout=15000)


# ── seksi Jadwal ──────────────────────────────────────────────────────────────

SEC_JS = """() => { const s = document.querySelector('.modal-content .plg-timeline-section'); if (!s) return null;
  const t = (q) => { const e = s.querySelector(q); return e ? e.textContent : null; };
  const act = (w) => { const r = s.querySelector("[data-part='actual-" + w + "']"); if (!r) return null;
    return { val: (r.querySelector('.plg-timeline-sec-val') || {}).textContent || null, none: (r.querySelector('.plg-timeline-sec-muted') || {}).textContent || null,
      mark: (r.querySelector('.plg-timeline-act-mark') || {}).textContent || null, input: (r.querySelector('input[type=date]') || {}).value || null }; };
  const tb = s.querySelector('table.plg-timeline-sec-bltable');
  return { chips: Array.from(s.querySelectorAll('.plg-timeline-sec-head .plg-timeline-chip')).map(x => x.textContent),
    range: t('.plg-timeline-sec-range'), actStart: act('start'), actFinish: act('finish'),
    table: tb ? { label: tb.getAttribute('aria-label'), head: Array.from(tb.querySelectorAll('thead th')).map(x => x.textContent),
      rows: Array.from(tb.querySelectorAll('tbody tr')).map(r => Array.from(r.children).map(c => c.textContent)) } : null,
    sw: document.documentElement.scrollWidth }; }"""


def open_section(p, tid, expand=True):
    sec = c1.open_bar_modal(p, tid)
    if expand:
        more = sec.locator(".plg-timeline-sec-head .plg-timeline-sec-more")
        if more.count() and more.first.get_attribute("aria-expanded") == "false":
            more.first.click()
        p.wait_for_timeout(700)
    return p.evaluate(SEC_JS)


# ── Pomodoro nyata (perangkat F, jam Playwright terpasang) ────────────────────

def pomodoro(p, title, tid):
    """Timeline W dibuka (plugin dieksekusi → pelacak aktual terpasang), lalu daftar Normal: 🎯 Fokus pada `title` →
    Pomodoro mulai → jam maju 25:00 → sesi selesai (pomodoro.ended dari host). Kembalikan payload event."""
    c0.open_timeline(p, WS)
    p.locator(".plg-timeline").first.wait_for(state="visible", timeout=20000)
    c0.view_btn(p, "Normal").click()
    row = p.locator(".task-row", has_text=title).first
    row.wait_for(state="visible", timeout=15000)
    n0 = len(p.evaluate("() => window.__ev"))
    btn = row.locator(".dash-focus-btn")
    btn.click()
    wait_until(lambda: btn.get_attribute("aria-pressed") == "true", 5, 0.2)
    p.wait_for_timeout(1200)
    p.clock.fast_forward("25:00")
    p.clock.run_for(2000)
    ok = wait_until(lambda: [e for e in p.evaluate("() => window.__ev")[n0:] if e[0] == "pomodoro.ended"], 15, 0.3)
    p.wait_for_timeout(1500)
    ev = (ok or [None])[0]
    return ev, ev is not None and ev[1] == str(tid)


def reset_pomodoro(p):
    p.evaluate("() => { localStorage.removeItem('tf_pomo_state'); }")
    p.reload()
    hd.wait_dashboard_ready(p)
    c0.wait_sync(p)
    p.wait_for_function("pid => window.TF && window.TF.plugins && window.TF.plugins.isEnabled(pid)", arg=PID, timeout=20000)
    p.evaluate("() => { window.__e2eNoReload = 1; }")


def iso(d):
    return d.isoformat()


def wd_delta(a, b):
    """Selisih hari kerja bertanda a → b (positif = b lebih lambat); Sen–Jum, November tanpa libur."""
    a, b = datetime.date.fromisoformat(a), datetime.date.fromisoformat(b)
    step = 1 if b >= a else -1
    n, d = 0, a
    while d != b:
        d += datetime.timedelta(days=step)
        if d.weekday() < 5:
            n += step
    return n


def signed_hk(n):
    return ("+%d hk" % n) if n > 0 else ((MINUS + "%d hk" % -n) if n < 0 else "0 hk")


def fin(start_iso, d):
    return iso(wd(datetime.date.fromisoformat(start_iso), d - 1)) if d >= 1 else start_iso


def dshort(iso_s):
    return short(datetime.date.fromisoformat(iso_s))


CONTRAST_JS = """([sel, prop]) => { const el = document.querySelector(sel); if (!el) return null;
  const cv = document.createElement('canvas').getContext('2d');
  const rgba = (c) => { cv.clearRect(0, 0, 1, 1); cv.fillStyle = '#000'; cv.fillStyle = c; cv.fillRect(0, 0, 1, 1);
    const d = cv.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255]; };
  const fgRaw = getComputedStyle(el)[prop];
  let bg = null; for (let n = el.parentElement; n && n.nodeType === 1; n = n.parentElement) {
    const c = rgba(getComputedStyle(n).backgroundColor); if (c[3] > 0.5) { bg = c; break; } }
  if (!bg) bg = rgba(getComputedStyle(document.body).backgroundColor);
  const fg = rgba(fgRaw); const a = fg[3];
  const mix = [0, 1, 2].map(i => Math.round(fg[i] * a + bg[i] * (1 - a)));
  const lum = c => { const f = x => { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  const x = lum(mix), y = lum(bg);
  return { fg: fgRaw, eff: mix, bg: bg.slice(0, 3), ratio: Math.round((Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05) * 100) / 100 }; }"""


# ── skenario ──────────────────────────────────────────────────────────────────

def run(browser, base, users, ids, mon, db_path):
    u1, u2 = users["u1"], users["u2"]
    alfa = ids["alfa"]
    R, A1, A2, A3, X1, N5, D5 = (ids[k] for k in ("R", "A1", "A2", "A3", "X1", "N5", "D5"))
    chain = [A1, A2, A3]
    ctxs = []
    try:
        ca, a = open_dev(browser, base, u1, "A")
        ctxs.append(ca)
        cb, b = open_dev(browser, base, u1, "B")
        ctxs.append(cb)
        cf = new_ctx(browser, base)
        cf.clock.install(time=datetime.datetime.now(datetime.timezone.utc))
        ctxs.append(cf)
        f = c0.open_page(cf, base, u1, "F")

        # ── 0 setup: Otomatis Alfa (A, UI) ──
        c0.open_timeline(a, WS)
        c1.wait_engine(a)
        s0 = time.time()
        c1.toggle_unit(a, ALFA)
        pv = wait_until(lambda: a.locator(".plg-timeline-pv").count() > 0, 4, 0.3)
        if pv:
            info("setup pratinjau Otomatis Alfa (tak terduga — diterapkan)", c1.pv_info(a.locator(".plg-timeline-pv")))
            c1.pv_apply(a)
        a.keyboard.press("Escape")
        wait_until(lambda: rec_items("A", s0, "prj@"), 15, 0.3)
        nap(1.5)
        for p in (a, b, f):
            sync_now(p)
        check("setup: A menyalakan Otomatis Alfa (record project POST, %d PUT task — seed sudah sesuai hasil hitung)"
              % len(puts_of("A", s0)), rec_items("A", s0, "prj@") and not pv and not puts_of("A", s0),
              repr((rec_items("A", s0), pv)))

        # ── 1 nol tulisan latar (termasuk pomodoro.ended task ber-aktual + 2 siklus sinkron) ──
        c0.open_timeline(b, WS)
        c1.wait_engine(b)
        srv0 = server_tasks(base, u1)
        x1_ext0 = srv0[X1]["ext"]
        s1 = time.time()
        ev1, ok_ev1 = pomodoro(f, ids["titles"][X1], X1)
        info("1 F pomodoro.ended (event, taskId, endedAt)", ev1)
        for _ in range(2):
            for p in (a, b, f):
                sync_now(p)
        c0.refresh_tasks(a)
        c0.refresh_tasks(b)
        nap(2)
        mid = writes(("A", "B", "F"), s1)
        opened = 0
        for p in (a, b):
            for tid in (X1, R, D5):
                st = open_section(p, tid)
                opened += 1 if st and st.get("actStart") else 0
                p.wait_for_timeout(500)
                c0.close_modal(p)
        nap(2)
        srv1 = server_tasks(base, u1)
        allw = writes(("A", "B", "F"), s1)
        check("1a F: Pomodoro nyata (🎯 Fokus X1 + jam maju 25:00) → host memancarkan pomodoro.ended untuk X1 (ber-actual.start "
              "%s); server pomodoros_done X1 = 1" % x1_ext0.get("actual"),
              ok_ev1 and wait_until(lambda: server_tasks(base, u1)[X1]["pomodoros_done"] == 1, 15, 0.5),
              repr((ev1, server_tasks(base, u1)[X1]["pomodoros_done"])))
        check("1b setelah pomodoro.ended + 2 siklus __syncNow di A, B, F → 0 PUT task, 0 POST records (A/B/F)",
              mid == (0, 0), "PUT+POST=%r" % (mid,))
        check("1c buka seksi Jadwal tingkat 3 (X1, R, D5) di A dan B (%d/6 baris aktual tampil) → tetap 0 PUT / 0 POST; ext X1 "
              "di server sama persis (%r)" % (opened, x1_ext0),
              opened == 6 and allw == (0, 0) and srv1[X1]["ext"] == x1_ext0, "PUT+POST=%r ext=%r" % (allw, srv1[X1]["ext"]))
        shot(a, "1-A-timeline-W-aktual.png")

        # ── 2 simpan baseline + B tarik + kunci perangkat baru ──
        s2, t2 = time.time(), now_ms(a)
        save_baseline(a, ALFA, 1, "Baseline 1")
        wait_until(lambda: rec_items("A", s2, "bl1@"), 15, 0.3)
        nap(1.5)
        it2 = rec_items("A", s2)
        bl_srv = server_bl(base, u1)
        bl1_id = [k for k in bl_srv if k.startswith("bl1@")]
        d2 = (it2[0].get("data") or {}) if it2 else {}
        check("2a A Simpan baseline (Alfa, slot 1) → tepat 1 item record bl1@list:%d:… (entity baseline, v1, n 1, by U1, %d baris "
              "= 7 task Alfa), 0 PUT task; toast 'Baseline 1 disimpan'; server menyimpannya" % (ids["ws"], len(d2.get("t") or [])),
              len(it2) == 1 and str(it2[0].get("id", "")).startswith("bl1@list:%d:" % ids["ws"]) and it2[0].get("entity") == "baseline"
              and d2.get("v") == 1 and d2.get("n") == 1 and d2.get("by") == u1["id"] and len(d2.get("t") or []) == 7
              and not puts_of("A", s2) and "Baseline 1 disimpan" in toasts(a, t2) and len(bl1_id) == 1,
              repr((it2, toasts(a, t2), list(bl_srv))))
        s2b = time.time()
        items_a = pick_baseline(a, "Baseline 1")
        nap(1)
        ga, ba_ = bars(a), blbars(a)
        keys_alfa = [str(t) for t in alfa]
        # Bar baseline = tanggal MESIN saat simpan (record t: [ref, es, ef, d, w]); bar task = rencana TERSIMPAN (row.span tidak
        # pernah memakai jangkar — layout 1c-2 langkah 7). Sama untuk 6 task; D5 (selesai, completed_at 23:30 UTC) berbeda:
        # mesin ef = hari Jakarta besoknya (turunan), bar task = Mulai + durasi tersimpan.
        px = ga[str(ids["B1"])][5] / 2  # B1 Manual: 2 hari kalender
        b1x, b1s = ga[str(ids["B1"])][4], datetime.date.fromisoformat(iso(mon))
        rows2 = {str(r[0]["$task"]): r for r in d2.get("t") or []}
        geo_bad, tip_bad = [], []
        for k in keys_alfa:
            r = rows2.get(k)
            bx = ba_.get(k)
            if not r or not bx:
                geo_bad.append((k, r, bx))
                continue
            es, ef = datetime.date.fromisoformat(r[1]), datetime.date.fromisoformat(r[2])
            if abs(bx[4] - (b1x + (es - b1s).days * px)) >= 0.6 or abs(bx[5] - ((ef - es).days + 1) * px) >= 0.6:
                geo_bad.append((k, r[1:3], bx))
            if bx[2] != "Baseline: %s → %s (0 hk)" % (short(es), short(ef)):
                tip_bad.append((k, bx[2]))
        eq_bar = [k for k in keys_alfa if k != str(D5) and ga.get(k) and ba_.get(k)
                  and abs(ba_[k][4] - ga[k][4]) < 0.6 and abs(ba_[k][5] - ga[k][5]) < 0.6]
        d5r = rows2.get(str(D5)) or [None, None, None]
        shot(a, "2-A-baseline-1-aktif.png")
        check("2b A pemilih Baseline: %r → 'Baseline 1': 7 bar baseline (Beta tanpa) = tanggal record (left/lebar/tooltip "
              "'Baseline: es → ef (0 hk)'); 6 sama persis dengan bar task, D5 baseline %s→%s (selesai turunan Jakarta) vs bar "
              "rencana; legenda + 'Baseline', 'Aktual'; 0 PUT / 0 POST (pref saja)" % (items_a, d5r[1], d5r[2]),
              items_a == ["Tidak ada", "Baseline 1", "Baseline 2", "Baseline 3"] and set(ba_) == set(keys_alfa)
              and not geo_bad and not tip_bad and len(eq_bar) == 6 and d5r[2] == iso(ids["D5_utc_day"] + datetime.timedelta(days=1))
              and legend(a)[-2:] == ["Baseline", "Aktual"] and writes(("A",), s2b) == (0, 0),
              repr((geo_bad[:3], tip_bad[:3], eq_bar, d5r, legend(a), writes(("A",), s2b))))
        s2c = time.time()
        sync_now(b)
        nap(1)
        pick_baseline(b, "Baseline 1")
        nap(1)
        bb_ = blbars(b)
        check("2c B tarik → pilih 'Baseline 1' → bar baseline B = A (%d bar, left/width/tooltip sama); B 0 PUT / 0 POST"
              % len(bb_), bb_ and {k: v[:3] for k, v in bb_.items()} == {k: v[:3] for k, v in ba_.items()}
              and writes(("B",), s2c) == (0, 0), repr(([(k, ba_.get(k), bb_.get(k)) for k in keys_alfa if bb_.get(k) != ba_.get(k)][:3])))
        shot(b, "2-B-baseline-ditarik.png")
        # perangkat baru N (U2): tarik record plugin diblokir → kunci simpan K41
        cn = new_ctx(browser, base)
        ctxs.append(cn)
        blocked = {"n": 0, "on": True}

        def block_pull(route):
            if blocked["on"]:
                blocked["n"] += 1
                return route.abort()
            return route.continue_()
        cn.route(RECS_PULL_RE, block_pull)
        n = c0.open_page(cn, base, u2, "N")
        s2d = time.time()
        c0.open_timeline(n, WS)
        c1.wait_engine(n)
        sync_now(n)  # satu sinkron dengan tarik record diblokir (gagal) — kunci harus tetap
        dlg = open_save(n)
        dlg_unit(dlg, ALFA)
        n.wait_for_timeout(600)
        st_lock = dlg_state(dlg)
        shot(n, "2-N-kunci-sebelum-tarik.png")
        dlg.locator(".plg-timeline-pv-apply").click(force=True)
        n.wait_for_timeout(800)
        st_lock2 = dlg_state(dlg)
        check("2d perangkat baru N (U2), tarik record diblokir (%d percobaan gagal, termasuk satu __syncNow): dialog Simpan baseline Alfa → 3 slot nonaktif, '%s', "
              "tombol Simpan nonaktif; klik paksa → 0 POST" % (blocked["n"], MSG_WAIT),
              blocked["n"] >= 1 and all(s["disabled"] for s in st_lock["slots"]) and st_lock["wait"] == MSG_WAIT
              and st_lock["applyDisabled"] and st_lock2["wait"] == MSG_WAIT and not rec_items("N", s2d), repr(st_lock))
        blocked["on"] = False
        sync_now(n)
        ok_unl = wait_until(lambda: not dlg_state(dlg)["slots"][0]["disabled"] and dlg_state(dlg)["wait"] is None, 15, 0.4)
        st_unl = dlg_state(dlg)
        today_s = short(datetime.datetime.now(JKT).date())
        shot(n, "2-N-terbuka-setelah-tarik.png")
        dlg_cancel(n)
        nap(1)
        check("2e tarik dibuka + sinkron → dialog (masih terbuka) segar: slot terbuka, slot 1 'Baseline 1 · disimpan %s'; Batal → "
              "0 POST / 0 PUT N" % today_s, ok_unl and st_unl["slots"][0]["label"] == "Baseline 1 · disimpan " + today_s
              and not any(s["disabled"] for s in st_unl["slots"]) and writes(("N",), s2d) == (0, 0), repr(st_unl))

        # ── 3 timpa slot (konfirmasi) + CAS dua anggota ──
        s3, t3 = time.time(), now_ms(a)
        bl1_before = server_bl(base, u1)[bl1_id[0]]
        dlg = open_save(a)
        dlg_unit(dlg, ALFA)
        st3 = dlg_state(dlg)
        dlg_slot(dlg, 1)
        dlg_name(dlg, "Rencana awal")
        dlg_apply(dlg)
        a.wait_for_timeout(500)
        st3c = dlg_state(dlg)
        shot(a, "3-A-konfirmasi-timpa.png")
        nap(0.5)
        pre3 = len(rec_items("A", s3))
        dlg_apply(dlg)
        a.locator(".plg-timeline-bl-dlg").wait_for(state="detached", timeout=15000)
        wait_until(lambda: rec_items("A", s3, "bl1@"), 15, 0.3)
        nap(1.5)
        it3 = rec_items("A", s3)
        bl1_after = server_bl(base, u1)[bl1_id[0]]
        want_c = "Timpa Baseline 1 (disimpan %s)?" % today_s
        check("3a A Simpan baseline slot 1 terisi → langkah konfirmasi '%s' (tombol Timpa), 0 POST sebelum Timpa; Timpa → 1 item "
              "bl1 (nama 'Rencana awal'); toast 'Rencana awal disimpan'" % want_c,
              st3["slots"][0]["label"] == "Baseline 1 · disimpan " + today_s and st3c["confirm"] == want_c and st3c["apply"] == "Timpa"
              and pre3 == 0 and len(it3) == 1 and (it3[0].get("data") or {}).get("name") == "Rencana awal"
              and (bl1_after.get("data") or {}).get("name") == "Rencana awal" and "Rencana awal disimpan" in toasts(a, t3)
              and bl1_after.get("updated_at") != bl1_before.get("updated_at"), repr((st3, st3c, it3, toasts(a, t3))))
        # CAS: A membuka dialog (potret: slot 2 kosong) → N (U2) menyimpan slot 2 → A tarik → A simpan slot 2
        s3b, t3b = time.time(), now_ms(a)
        dlg_a = open_save(a)
        dlg_unit(dlg_a, ALFA)
        sync_now(n)
        save_baseline(n, ALFA, 2, "Versi Sari")
        wait_until(lambda: rec_items("N", s3b, "bl2@"), 15, 0.3)
        nap(1.5)
        bl2_id = [k for k in server_bl(base, u1) if k.startswith("bl2@")]
        sync_now(a)
        nap(1)
        dlg_slot(dlg_a, 2)
        dlg_name(dlg_a, "Versi Rani")
        st_pre = dlg_state(dlg_a)
        dlg_apply(dlg_a)
        ok_stale = wait_until(lambda: MSG_STALE in toasts(a, t3b), 10, 0.3)
        nap(1.5)
        st_post = dlg_state(dlg_a)
        shot(a, "3-A-cas-data-berubah.png")
        pre_a = len(rec_items("A", s3b))
        check("3b CAS: N (U2) simpan slot 2 'Versi Sari' (1 item bl2@); A — dialog dibuka SEBELUM itu (slot 2 kosong di potret: %r) "
              "— tarik lalu Simpan slot 2 → toast '%s', 0 POST A, dialog tetap terbuka" % (st_pre["slots"][1]["label"], MSG_STALE),
              len(rec_items("N", s3b, "bl2@")) == 1 and len(bl2_id) == 1 and st_pre["slots"][1]["label"] == "Baseline 2"
              and ok_stale and pre_a == 0 and a.locator(".plg-timeline-bl-dlg").count() == 1,
              repr((st_pre, toasts(a, t3b), rec_items("A", s3b))))
        dlg_apply(dlg_a)
        a.wait_for_timeout(500)
        st_conf = dlg_state(dlg_a)
        want_c2 = "Timpa Versi Sari (disimpan %s)?" % today_s
        shot(a, "3-A-cas-konfirmasi-timpa.png")
        dlg_apply(dlg_a)
        a.locator(".plg-timeline-bl-dlg").wait_for(state="detached", timeout=15000)
        wait_until(lambda: rec_items("A", s3b, "bl2@"), 15, 0.3)
        nap(1.5)
        bl2 = server_bl(base, u1)[bl2_id[0]]
        check("3c potret segar: slot 2 '%s' → Simpan → konfirmasi '%s' → Timpa → 1 item bl2@ dari A; server slot 2 = "
              "{nama 'Versi Rani', by U1}" % (st_post["slots"][1]["label"], want_c2),
              st_post["slots"][1]["label"] == "Versi Sari · disimpan " + today_s and st_conf["confirm"] == want_c2
              and len(rec_items("A", s3b, "bl2@")) == 1 and (bl2.get("data") or {}).get("name") == "Versi Rani"
              and (bl2.get("data") or {}).get("by") == u1["id"], repr((st_post, st_conf, bl2.get("data", {}).get("name"))))
        check("3d A dan N: 0 PUT task selama simpan/timpa/CAS baseline", not puts_of("A", s3) and not puts_of("N", s3),
              repr((puts_of("A", s3)[:2], puts_of("N", s3)[:2])))
        cn.close()
        ctxs.remove(cn)

        # ── 4 aktual via Pomodoro nyata → jangkar bergeser → drift penerus → Tinjau ──
        reset_pomodoro(f)
        ga0 = bars(a)
        st4_srv = server_tasks(base, u1)
        before_chain = {t: st4_srv[t]["ext"].get("start") for t in chain}
        s4, t4 = time.time(), now_ms(a)
        ev4, ok_ev4 = pomodoro(f, ids["titles"][R], R)
        info("4 F pomodoro.ended R (event)", ev4)
        t0 = None
        try:
            t0 = datetime.datetime.fromisoformat(ev4[2].replace("Z", "+00:00")).astimezone(JKT).date()
        except Exception:  # noqa: BLE001
            pass
        wait_until(lambda: puts_of("F", s4, {R}), 15, 0.3)
        nap(2)
        sync_now(f)
        p4 = puts_of("F", s4)
        srv4 = server_tasks(base, u1)
        check("4a F: Pomodoro nyata pada R (tanpa aktual) → pomodoro.ended (endedAt %s → %s WIB) → tepat 1 PUT F persis "
              "{ext_patch: {timeline.actual: {start: %s}}}; 0 POST records; server actual R = {start: %s}"
              % (ev4[2] if ev4 else None, t0, t0, t0),
              ok_ev4 and t0 is not None and len(p4) == 1 and p4[0][1] == R
              and p4[0][2] == {"ext_patch": {PID + ".actual": {"start": iso(t0)}}} and not rec_items("F", s4)
              and srv4[R]["ext"].get("actual") == {"start": iso(t0)}, repr(([x[1:3] for x in p4], srv4[R]["ext"])))
        sync_now(a)
        c0.refresh_tasks(a)
        nap(1.5)
        sync_now(a)
        ok4 = wait_until(lambda: drift_banner(a), 15, 0.5)
        c1.wait_engine(a)
        ga1, al1 = bars(a), actlines(a)
        rel = lambda g, k: g[str(k)][4] - g[str(ids["B1"])][4]  # noqa: E731  left relatif bar B1 (Manual, diam)
        shift_days = (mon - t0).days if t0 else None
        b4 = drift_banner(a)
        shot(a, "4-A-jangkar-aktual-banner.png")
        st4r = open_section(a, R, expand=False)
        c0.close_modal(a)
        want_r = "%s → %s" % (short(t0), short(wd(t0, 2))) if t0 else None
        check("4b A tarik: jangkar R = mulai aktual %s — seksi R '%s…'; garis aktual R mulai %d hari × %.0f px sebelum bar "
              "rencana (bar R tidak bergeser: rentang bar = rencana tersimpan), lebar 1 hari (hari ini); banner '%s'; "
              "0 PUT A / B sejak Pomodoro" % (t0, want_r, shift_days or -1, px, b4),
              ok4 and t0 is not None and st4r and (st4r["range"] or "").startswith(want_r + " · 3 hari kerja")
              and abs(rel(ga0, R) - rel(ga1, R)) < 0.6 and al1.get(str(R))
              and abs((ga1[str(R)][4] - al1[str(R)][4]) - shift_days * px) < 0.6 and abs(al1[str(R)][5] - px) < 0.6
              and b4 == ["Jadwal otomatis belum mutakhir: 3 task berbeda dari hasil hitung."]
              and not puts_of("A", s4) and not puts_of("B", s4),
              repr((st4r and st4r["range"], ga0.get(str(R)), ga1.get(str(R)), al1.get(str(R)), b4, puts_of("A", s4)[:2])))
        s4c = time.time()
        a.locator(".plg-timeline-banner-act", has_text="Tinjau").first.click()
        pv = c1.wait_pv(a)
        i4 = c1.pv_info(pv)
        shot(a, "4-A-tinjau-pratinjau.png")
        c1.pv_apply(a)
        wait_until(lambda: len(puts_of("A", s4c)) >= 3, 15, 0.3)
        nap(2)
        srv4c = server_tasks(base, u1)
        want4 = {A1: iso(wd(t0, 3)), A2: iso(wd(t0, 5)), A3: iso(wd(t0, 7))} if t0 and t0.weekday() < 5 else None
        got4 = {t: srv4c[t]["ext"].get("start") for t in chain}
        check("4c Tinjau → pratinjau '%s' 3 baris (A1..A3) → Terapkan → 3 PUT {ext_patch}; server %r (sebelumnya %r); banner hilang"
              % (PV_FLOW, got4, before_chain),
              i4["title"] == PV_FLOW and sorted(int(k) for k in i4["keys"]) == sorted(chain) and len(puts_of("A", s4c)) == 3
              and all(set(x[2] or {}) == {"ext_patch"} for x in puts_of("A", s4c))
              and (want4 is None or got4 == want4) and all(got4[t] < before_chain[t] for t in chain)
              and not drift_banner(a), repr((i4, got4, want4)))
        info("4 T0 (hari Jakarta pomodoro.ended), pergeseran penerus (hk)", [str(t0), {t: wd_delta(before_chain[t], got4[t]) for t in chain}])

        # ── 5 selesai 23:30 UTC → hari Jakarta besoknya (seksi + garis) ──
        d_utc = ids["D5_utc_day"]  # Selasa (tanggal UTC completed_at)
        d_jkt = d_utc + datetime.timedelta(days=1)
        st5 = open_section(a, D5)
        shot(a, "5-A-seksi-selesai-2330utc.png")
        c0.close_modal(a)
        ga5, al5 = bars(a), actlines(a)
        a5 = al5.get(str(D5))
        check("5a seksi D5 (completed_at %sT23:30:00 UTC): 'Selesai aktual' = %s (hari Jakarta besoknya) + penanda 'Aktual'; "
              "'Mulai aktual' = %s; ringkasan mesin '%s → %s'" % (iso(d_utc), short(d_jkt), short(ids["D5_start"]), short(ids["D5_start"]), short(d_jkt)),
              st5 and st5["actFinish"] and st5["actFinish"]["val"] == short(d_jkt) and st5["actFinish"]["mark"] == "Aktual"
              and st5["actFinish"]["input"] == iso(d_jkt) and st5["actStart"]["val"] == short(ids["D5_start"])
              and (st5["range"] or "").startswith("%s → %s ·" % (short(ids["D5_start"]), short(d_jkt))), repr(st5))
        n_days = (d_jkt - ids["D5_start"]).days + 1
        bl5 = blbars(a).get(str(D5))
        check("5b garis aktual D5: mulai di left bar D5 (actual.start = Mulai), lebar %d hari × %.0f px = sampai %s (hari Jakarta), "
              "bukan %s (tanggal UTC, %d px); bar baseline D5 berakhir di hari yang sama" % (n_days, px, short(d_jkt), short(d_utc), (n_days - 1) * px),
              a5 and abs(a5[4] - ga5[str(D5)][4]) < 0.6 and abs(a5[5] - n_days * px) < 0.6
              and bl5 and abs(bl5[4] + bl5[5] - (a5[4] + a5[5])) < 0.6, repr((a5, ga5.get(str(D5)), bl5, px)))
        run_late_complete(browser, base, u1, ids, d_utc, ctxs)

        # ── 6 tabel Baseline vs sekarang + tingkat 2 ──
        extra = hd.api(base, u1, "POST", "/api/tasks", json={"title": "Alfa tambahan", "gtd_status": "next", "priority": "P3",
                                                            "project": ALFA, "list_id": ids["ws"],
                                                            "ext": {PID + ".start": iso(wd(mon, 9)), PID + ".duration": 1}})
        x_id = c0.task_id(extra)
        sync_now(a)
        c0.refresh_tasks(a)
        nap(1.5)
        c1.wait_engine(a)
        bl1 = server_bl(base, u1)[bl1_id[0]]
        rows = {}
        for r in (bl1.get("data") or {}).get("t") or []:
            rows[r[0]["$task"]] = r
        b_a1 = rows.get(A1)
        now_s = got4[A1]
        now_f = fin(now_s, 2)
        ds, df = wd_delta(b_a1[1], now_s), wd_delta(b_a1[2], now_f)
        st6 = open_section(a, A1, expand=False)
        want_range = "%s → %s · 2 hari kerja · baseline %s" % (dshort(now_s), dshort(now_f), signed_hk(df))
        c0.close_modal(a)
        st6b = open_section(a, A1)
        shot(a, "6-A-tabel-baseline-vs-sekarang.png")
        c0.close_modal(a)
        want_rows = [["Mulai", dshort(b_a1[1]), dshort(now_s), signed_hk(ds)],
                     ["Selesai", dshort(b_a1[2]), dshort(now_f), signed_hk(df)],
                     ["Durasi", "%d hk" % b_a1[3], "2 hk", signed_hk(2 - b_a1[3])]]
        check("6a seksi A1 tingkat 2: chip 'Otomatis' + ringkasan '%s' (baseline aktif 'Rencana awal' slot 1)" % want_range,
              st6 and "Otomatis" in st6["chips"] and st6["range"] == want_range, repr(st6))
        check("6b tingkat 3: tabel 'Baseline vs sekarang' kepala ['', Baseline, Sekarang, Selisih], baris %r (record bl1 vs server)"
              % want_rows, st6b and st6b["table"] and st6b["table"]["label"] == "Baseline vs sekarang"
              and st6b["table"]["head"] == ["", "Baseline", "Sekarang", "Selisih"] and st6b["table"]["rows"] == want_rows,
              repr(st6b and st6b["table"]))
        st6c = open_section(a, x_id)
        c0.close_modal(a)
        check("6c task Alfa di luar baseline ('Alfa tambahan', dibuat sesudah simpan) → tabel satu baris 'Tidak ada'; ringkasan "
              "tanpa ' · baseline'", st6c and st6c["table"] and st6c["table"]["rows"] == [["Tidak ada"]]
              and st6c["range"] and "baseline" not in st6c["range"], repr(st6c))

        # ── 7 klien 1.1 mengedit start task ber-aktual ──
        run_old_client(browser, base, u1, u2, ids, a, ctxs)
        for cx in (ca, cb, cf):
            cx.close()
            ctxs.remove(cx)

        # ── 8 375 px + Sakura gelap ──
        run_narrow_dark(browser, base, u1, ids, ctxs)

        # ── 9 kinerja ──
        run_perf(browser, base, u2, ctxs)
    finally:
        for cx in ctxs:
            try:
                cx.close()
            except Exception:  # noqa: BLE001
                pass


def run_late_complete(browser, base, u1, ids, d_utc, ctxs):
    """5c: Z dengan jam 23:30 UTC (CDP zona Jakarta + clock.set_system_time) mencentang N5 → task.completed → actual.start =
    hari Jakarta besoknya (pelacak aktual, isi bila kosong)."""
    N5 = ids["N5"]
    pin = datetime.datetime(d_utc.year, d_utc.month, d_utc.day, 23, 30, 0, tzinfo=datetime.timezone.utc)
    ctx = browser.new_context(service_workers="block", viewport=hd.DESKTOP, reduced_motion="reduce")
    ctxs.append(ctx)
    ctx.route(re.compile(r"^(?!%s/)" % re.escape(base)), lambda route: route.abort())
    ctx.add_init_script(c0.INIT_JS)
    ctx.add_init_script(MY_INIT)
    p = ctx.new_page()
    c0.PUMP.append(p)
    c1.watch(p, "Z")
    cdp = ctx.new_cdp_session(p)
    cdp.send("Emulation.setTimezoneOverride", {"timezoneId": "Asia/Jakarta"})
    p.clock.set_system_time(pin)
    p.goto(base + "/manifest.json")
    c0.prime_storage(p, u1)
    p.goto(base + "/")
    p.locator(".dash-hero-greet").wait_for(state="visible", timeout=30000)
    c0.wait_sync(p)
    p.wait_for_function("pid => window.TF && window.TF.plugins && window.TF.plugins.isEnabled(pid)", arg=PID, timeout=20000)
    p.evaluate("() => { window.__e2eNoReload = 1; }")
    env = p.evaluate("() => [new Date().toISOString(), Intl.DateTimeFormat().resolvedOptions().timeZone]")
    c0.open_timeline(p, WS)
    p.locator(".plg-timeline").first.wait_for(state="visible", timeout=20000)
    c0.view_btn(p, "Normal").click()
    title = ids["titles"][N5]
    row = p.locator(".task-row", has_text=title).first
    row.wait_for(state="visible", timeout=15000)
    s5 = time.time()
    row.locator(".check-btn").click()
    ok = wait_until(lambda: [e for e in p.evaluate("() => window.__ev") if e[0] == "task.completed" and e[1] == str(N5)], 10, 0.3)
    p.wait_for_timeout(1500)
    sync_now(p)
    want = iso(d_utc + datetime.timedelta(days=1))
    got = wait_until(lambda: (lambda e: e if e and e.get("start") == want else None)(server_tasks(base, u1)[N5]["ext"].get("actual")), 15, 0.5)
    act_puts = [x[2] for x in puts_of("Z", s5, {N5}) if PID + ".actual" in ((x[2] or {}).get("ext_patch") or {})]
    info("5 Z jam/zona, event task.completed (jumlah, payload pertama), PUT Z berisi timeline.actual", [env, len(ok or []), (ok or [None])[0], act_puts])
    check("5c Z (jam %s, Asia/Jakarta) centang N5 → task.completed (completedAt 23:30 UTC) → actual.start = %s (hari Jakarta "
          "besoknya) di server; tulisan aktual Z = {start: %s} saja" % (pin.isoformat(), want, want),
          ok and got == {"start": want} and act_puts and all(x["ext_patch"][PID + ".actual"] == {"start": want} for x in act_puts)
          and env[1] == "Asia/Jakarta", repr((env, ok, act_puts, server_tasks(base, u1)[N5]["ext"])))
    ctx.close()
    ctxs.remove(ctx)


def run_old_client(browser, base, u1, u2, ids, a, ctxs):
    X1 = ids["X1"]
    served = []
    cc = new_ctx(browser, base)
    ctxs.append(cc)
    serve_pinned(cc, served)
    c = c0.open_page(cc, base, u2, "C")
    c0.open_timeline(c, WS)
    c.wait_for_timeout(1500)
    ver = c.evaluate("() => { try { return (window.TF.plugins.list ? window.TF.plugins.list() : []).map(x => [x.id, x.version]); } catch (e) { return String(e); } }")
    info("7 C: plugin terdaftar (id, versi)", ver)
    no_12 = c.locator(".plg-timeline-blbtn").count() == 0 and c.locator(".plg-timeline-actual").count() == 0
    srv0 = server_tasks(base, u1)
    ext0 = srv0[X1]["ext"]
    bl0 = {k: (v.get("updated_at"), v.get("data")) for k, v in server_bl(base, u1).items()}
    al0 = actlines(a).get(str(X1))
    s7 = time.time()
    c1.drag(c, X1, 2)
    wait_until(lambda: puts_of("C", s7, {X1}), 15, 0.3)
    nap(2.5)
    b7 = [x[2] for x in puts_of("C", s7)]
    srv7 = server_tasks(base, u1)
    ext7 = srv7[X1]["ext"]
    shot(c, "7-C-klien-1.1-seret.png")
    allowed = {PID + ".start", PID + ".duration", PID + ".constraint", PID + ".mode"}
    check("7a C memuat Timeline 1.1.0 dari %s (%d berkas disajikan; tanpa tombol Baseline / garis aktual); C seret X1 (ber-aktual) "
          "+2 → PUT {ext_patch} hanya kunci jadwal 1.1 (tanpa timeline.actual); server start %s → %s"
          % (PIN, len(served), ext0.get("start"), ext7.get("start")),
          served and "static/plugins/timeline/plugin.js" in served and no_12 and b7
          and all(set(x or {}) == {"ext_patch"} and set(x["ext_patch"]) <= allowed for x in b7)
          and ext7.get("start") != ext0.get("start"), repr((sorted(set(served)), ver, no_12, b7, ext7)))
    bl7 = {k: (v.get("updated_at"), v.get("data")) for k, v in server_bl(base, u1).items()}
    check("7b Review Focus 1: server X1 actual SAMA persis (%r) setelah tulis klien 1.1; record baseline (%d) tidak berubah; "
          "C 0 POST records" % (ext0.get("actual"), len(bl0)),
          ext7.get("actual") == ext0.get("actual") and ext0.get("actual") and bl7 == bl0 and not rec_items("C", s7),
          repr((ext0, ext7, rec_items("C", s7))))
    s7b = time.time()
    sync_now(a)
    c0.refresh_tasks(a)
    nap(1.5)
    c1.wait_engine(a)
    al7 = actlines(a).get(str(X1))
    st7 = open_section(a, X1)
    shot(a, "7-A-aktual-selamat.png")
    c0.close_modal(a)
    info("7 A setelah tulis 1.1: banner", drift_banner(a))
    check("7c A (1.2) tarik: garis aktual X1 tetap di posisi yang sama (%r), seksi 'Mulai aktual' = %s; 0 PUT A"
          % (al7, dshort(ext0["actual"]["start"])),
          al0 and al7 and al7[:2] == al0[:2] and st7 and st7["actStart"]["val"] == dshort(ext0["actual"]["start"])
          and not puts_of("A", s7b), repr((al0, al7, st7 and st7["actStart"], puts_of("A", s7b)[:2])))
    cc.close()
    ctxs.remove(cc)


def run_narrow_dark(browser, base, u1, ids, ctxs):
    cm, m = open_dev(browser, base, u1, "M", viewport=hd.MOBILE, mobile=True)
    ctxs.append(cm)
    m.evaluate("() => { localStorage.setItem('tf_palette', 'sakura'); localStorage.setItem('tf_theme', 'dark'); }")
    m.reload()
    hd.wait_dashboard_ready(m)
    c0.wait_sync(m)
    m.evaluate("() => { window.__e2eNoReload = 1; }")
    s8 = time.time()
    sync_now(m)
    c0.open_timeline(m, WS)
    c1.wait_engine(m, slack=False)
    more = m.locator(".plg-timeline-more > button")
    more.wait_for(state="visible", timeout=15000)
    more.click()
    menu = m.locator(".plg-timeline-more-menu[role=menu]")
    menu.wait_for(state="visible", timeout=8000)
    items = menu.locator("[role^=menuitem]").all_inner_texts()
    menu.locator("[role^=menuitem]", has_text=re.compile("^Baseline$")).first.click()
    pick = m.locator(".plg-timeline-blpick")
    pick.wait_for(state="visible", timeout=8000)
    pbox = m.evaluate("() => { const r = document.querySelector('.plg-timeline-blpick').getBoundingClientRect(); return [Math.round(r.left), Math.round(r.right)]; }")
    pick.locator("[role=menuitemradio]", has_text=re.compile("^Baseline 1$")).first.click()
    pick.wait_for(state="detached", timeout=8000)
    m.wait_for_timeout(800)
    pal = m.evaluate("() => [document.documentElement.getAttribute('data-palette'), document.documentElement.getAttribute('data-theme'), document.documentElement.scrollWidth]")
    blb, act = blbars(m), actlines(m)
    cb = m.evaluate(CONTRAST_JS, [".plg-timeline-blbar", "backgroundColor"])
    cl = m.evaluate(CONTRAST_JS, [".plg-timeline-actual", "backgroundColor"])
    info("8 375 Sakura gelap: palet/tema/scrollWidth, bar baseline, garis aktual, kontras bar baseline / garis aktual", [pal, len(blb), len(act), cb, cl])
    shot(m, "8-M-375-sakura-gelap-baseline-aktual.png")
    check("8a 375 px Sakura gelap: 'Lainnya' = %r (memuat Baseline + Simpan baseline); pemilih di dalam layar %r; scrollWidth 375"
          % (items, pbox), items == ["Jadwal otomatis", "Jalur kritis", "Baseline", "Simpan baseline", "Jadwalkan ulang"]
          and pal[:2] == ["sakura", "dark"] and pal[2] == 375 and pbox[0] >= 0 and pbox[1] <= 375, repr((items, pal, pbox)))
    check("8b bar baseline (%d, tinggi 4 px) + garis aktual (%d, tinggi 2 px) tampil; terbaca: kontras efektif bar baseline %.2f "
          "≥ 3, garis aktual %.2f ≥ 3 (non-teks WCAG 1.4.11)" % (len(blb), len(act), (cb or {}).get("ratio", 0), (cl or {}).get("ratio", 0)),
          len(blb) >= 7 and all(abs(v[3] - 4) < 0.6 and v[1] > 0 for v in blb.values()) and len(act) >= 4
          and all(abs(v[3] - 2) < 0.6 for v in act.values()) and (cb or {}).get("ratio", 0) >= 3 and (cl or {}).get("ratio", 0) >= 3,
          repr((cb, cl, list(blb.values())[:2], list(act.values())[:2])))
    st8 = open_section(m, ids["A1"])
    shot(m, "8-M-375-seksi-tabel.png")
    c0.close_modal(m)
    check("8c 375 px: seksi A1 tingkat 3 → tabel 'Baseline vs sekarang' 3 baris + baris aktual, scrollWidth === 375",
          st8 and st8["table"] and len(st8["table"]["rows"]) == 3 and st8["actStart"] is not None and st8["sw"] == 375, repr(st8))
    check("8d 375 px: 0 PUT / 0 POST records (lihat + pilih baseline)", writes(("M",), s8) == (0, 0), repr(writes(("M",), s8)))
    cm.close()
    ctxs.remove(cm)


def run_perf(browser, base, u2, ctxs):
    cp = new_ctx(browser, base)
    ctxs.append(cp)
    body = c1.plugin_with_pure()
    got = []
    cp.route(re.compile(r"/static/plugins/timeline/plugin\.js(\?.*)?$"),
             lambda route: (got.append(1), route.fulfill(status=200, content_type="application/javascript", body=body)))
    d = c0.open_page(cp, base, u2, "P10")
    sync_now(d)
    c0.open_timeline(d, WP)
    c1.wait_engine(d)
    # Kondisi beban setara 10c 1c-1: unit Otomatis + diterapkan (jalur kritis hanya pada simpul terhitung).
    moved = {}
    for unit in (GAMMA, DELTA):
        s_u = time.time()
        c1.toggle_unit(d, unit)
        pv = c1.wait_pv(d, timeout=30000)
        iu = c1.pv_info(pv)
        n_mv = int(re.match(r"(\d+)", iu["summary"]).group(1)) if re.match(r"(\d+)", iu["summary"] or "") else 0
        c1.pv_apply(d)
        wait_until(lambda: len(set(x[1] for x in puts_of("P10", s_u))) >= n_mv, 120, 0.5)
        d.keyboard.press("Escape")
        moved[unit] = (n_mv, len(set(x[1] for x in puts_of("P10", s_u))))
    nap(2)
    sync_now(d)
    c1.wait_engine(d)
    info("9 Otomatis WP diterapkan (unit: task bergeser, PUT terkirim)", moved)
    s9 = time.time()
    save_baseline(d, GAMMA, 1, "Baseline Gamma")
    save_baseline(d, DELTA, 1, "Baseline Delta")
    wait_until(lambda: len(rec_items("P10", s9, "bl1@")) >= 2, 20, 0.3)
    nap(1.5)
    its = rec_items("P10", s9, "bl1@")
    sizes = [len(json.dumps(it.get("data"), separators=(",", ":"), ensure_ascii=False).encode()) for it in its]
    info("9 baseline WP disimpan: item, baris per item, byte", [len(its), [len((it.get("data") or {}).get("t") or []) for it in its], sizes])
    pick_baseline(d, "Baseline 1")
    crit = d.locator(".plg-timeline-toolbar button[aria-pressed]", has_text=re.compile("^Jalur kritis$")).first
    if crit.get_attribute("aria-pressed") != "true":
        crit.click()
    d.wait_for_timeout(1500)
    wait_engine = c1.wait_engine
    wait_engine(d)
    cdp = cp.new_cdp_session(d)
    cdp.send("Emulation.setCPUThrottlingRate", {"rate": CPU_RATE})
    try:
        d.wait_for_timeout(1500)
        pr = d.evaluate(c1.PLUGIN_RENDER_JS, 5)
        frames = [round(x["frame"], 1) for x in pr.get("runs") or []]
        info("9 [info] render Timeline sendiri CPU 4× (baseline+Jalur kritis ON): frame ms, median", [frames, statistics.median(frames) if frames else None])
        wait_engine(d)
        eng = d.evaluate(c1.ENGINE_JS, 9)
        e_ms = [round(x, 1) for x in eng.get("ms") or []]
        info("9 mesin engine.run (CPU 4×) ms per putaran, task, simpul", [e_ms, eng.get("tasks"), eng.get("nodes")])
        ovl = d.evaluate("""() => { const P = window.__tlPure; if (!P || !P.baselineOverlay) return null; return true; }""")
        info("9 [info] ekspor baselineOverlay tersedia", ovl)
        check("9a mesin lengkap (engine.run atas ctx view %s task, %s simpul, 60 task ber-aktual; plugin.js diekspos %d kali) CPU 4× "
              "median %s ms ≤ %d ms" % (eng.get("tasks"), eng.get("nodes"), len(got), statistics.median(e_ms) if e_ms else None, ENGINE_BUDGET),
              got and e_ms and eng.get("tasks", 0) >= 500 and statistics.median(e_ms) <= ENGINE_BUDGET, repr(eng))
        dom = d.evaluate("""() => [document.querySelectorAll('.plg-timeline *').length, document.querySelectorAll('.plg-timeline-blbar').length,
            document.querySelectorAll('.plg-timeline-actual').length, document.querySelectorAll('.plg-timeline-bar.is-critical').length,
            document.querySelector('.plg-timeline-scroll').getAttribute('aria-rowcount')]""")
        mx = d.evaluate("""() => new Promise((res) => { const s = document.querySelector('.plg-timeline-scroll'); let maxDom = 0, maxBl = 0; const t0 = performance.now();
            const step = () => { const t = performance.now() - t0; s.scrollTop = Math.round(t * 2); const n = document.querySelectorAll('.plg-timeline *').length;
              maxBl = Math.max(maxBl, document.querySelectorAll('.plg-timeline-blbar').length);
              if (n > maxDom) maxDom = n; if (t < 3000) requestAnimationFrame(step); else res([maxDom, maxBl]); }; requestAnimationFrame(step); })""")
        info("9 DOM .plg-timeline * (Jalur kritis + Baseline 1 ON): diam, bar baseline, garis aktual, bar kritis, aria-rowcount, maks gulir 3 s / bar baseline maks",
             dom + mx)
        check("9b DOM ≤ %d dengan Jalur kritis + Baseline ON, Gamma/Delta Otomatis (diam %d: %d bar baseline, %d garis aktual, "
              "%d bar kritis; gulir maks %d)" % (DOM_BUDGET, dom[0], dom[1], dom[2], dom[3], mx[0]),
              0 < dom[0] <= DOM_BUDGET and 0 < mx[0] <= DOM_BUDGET and dom[1] > 0 and dom[2] > 0 and dom[3] > 0 and int(dom[4]) >= 500,
              repr((dom, mx)))
        shot(d, "9-P10-baseline-kritis-500.png")
    finally:
        cdp.send("Emulation.setCPUThrottlingRate", {"rate": 1})
    check("9c P10: simpan baseline WP = tepat 2 item record (Gamma, Delta), 0 PUT task", len(its) == 2 and not puts_of("P10", s9),
          repr((len(its), puts_of("P10", s9)[:2])))
    cp.close()
    ctxs.remove(cp)


# ── seed ──────────────────────────────────────────────────────────────────────

def seed(base, db_path, mon):
    u1 = hd.seed(base, username="tc2a", display_name="Rani")
    u2 = hd.seed(base, username="tc2b", display_name="Sari")
    ws_id = hd.api(base, u1, "POST", "/api/lists", json={"name": WS})["id"]
    wp_id = hd.api(base, u1, "POST", "/api/lists", json={"name": WP})["id"]
    with sqlite3.connect(db_path) as conn:
        for lid in (ws_id, wp_id):
            conn.execute("INSERT INTO list_members (list_id, user_id, joined_at) VALUES (?,?,?)",
                         (lid, u2["id"], datetime.datetime.now().isoformat()))
    sess = requests.Session()
    sess.headers["Authorization"] = "Bearer " + u1["token"]
    ids = {"ws": ws_id, "wp": wp_id, "titles": {}, "alfa": []}
    n_dep = [0]
    n_act = [0]

    def mk(title, project, start, dur, deps=(), list_id=ws_id, actual=None):
        ext = {PID + ".start": start, PID + ".duration": dur}
        if deps:
            ext[PID + ".deps"] = [{"t": {"$task": t}, "type": ty, "lag": lg} for t, ty, lg in deps]
            n_dep[0] += len(deps)
        if actual:
            ext[PID + ".actual"] = actual
            n_act[0] += 1
        r = sess.post(base + "/api/tasks", json={"title": title, "gtd_status": "next", "priority": "P3", "project": project,
                                                 "list_id": list_id, "ext": ext}, timeout=10)
        r.raise_for_status()
        tid = c0.task_id(r.json())
        ids["titles"][tid] = title
        if project == ALFA:
            ids["alfa"].append(tid)
        return tid

    w = lambda n: iso(wd(mon, n))  # noqa: E731
    ids["R"] = mk("Alfa fondasi", ALFA, w(0), 3)
    ids["A1"] = mk("Alfa dinding", ALFA, w(3), 2, [(ids["R"], "FS", 0)])
    ids["A2"] = mk("Alfa atap", ALFA, w(5), 2, [(ids["A1"], "FS", 0)])
    ids["A3"] = mk("Alfa cat", ALFA, w(7), 1, [(ids["A2"], "FS", 0)])
    ids["X1"] = mk("Alfa survei", ALFA, w(1), 2, actual={"start": w(1)})
    ids["N5"] = mk("Alfa izin", ALFA, w(2), 1)
    d5_start = mon - datetime.timedelta(days=7)
    ids["D5_start"] = d5_start
    ids["D5_utc_day"] = d5_start + datetime.timedelta(days=1)
    ids["D5"] = mk("Alfa ukur lahan", ALFA, iso(d5_start), 2, actual={"start": iso(d5_start)})
    hd.api(base, u1, "POST", "/api/tasks/%d/done" % ids["D5"])
    with sqlite3.connect(db_path) as conn:
        conn.execute("UPDATE tasks SET completed_at = ? WHERE id = ?", (iso(ids["D5_utc_day"]) + "T23:30:00", ids["D5"]))
    ids["B1"] = mk("Beta katalog", BETA, w(0), 2)
    ids["B2"] = mk("Beta brosur", BETA, w(2), 2)
    # WP: Gamma 300 (100 akar, 40 ber-aktual; 200 penerus, 300 dependensi), Delta 200 (100 akar, 20 ber-aktual; 100 penerus).
    t_seed = time.time()
    groots = []
    for k in range(100):
        st = w(k % 10)
        groots.append(mk("Gamma akar %03d" % k, GAMMA, st, 1 + k % 3, list_id=wp_id, actual={"start": st} if k < 40 else None))
    for i in range(200):
        deps = [(groots[i % 100], TYPES[i % 4], i % 3)]
        if i < 100:
            deps.append((groots[(i * 7 + 3) % 100], TYPES[(i + 1) % 4], 0))
        mk("Gamma turunan %03d" % i, GAMMA, w(14 + i % 5), 1 + i % 3, deps, list_id=wp_id)
    droots = []
    for k in range(100):
        st = w(k % 8)
        droots.append(mk("Delta akar %03d" % k, DELTA, st, 1 + k % 2, list_id=wp_id, actual={"start": st} if k < 20 else None))
    for i in range(100):
        mk("Delta turunan %03d" % i, DELTA, w(12 + i % 4), 2, [(droots[i], TYPES[i % 4], 1)], list_id=wp_id)
    info("setup seed WP (detik, dependensi, task ber-aktual)", [round(time.time() - t_seed, 1), n_dep[0], n_act[0]])
    s1 = hd.api(base, u1, "PUT", "/api/plugins/state/%s" % PID, json={"enabled": True})
    s2 = hd.api(base, u2, "PUT", "/api/plugins/state/%s" % PID, json={"enabled": True})
    srv = server_tasks(base, u2)
    d5 = srv.get(ids["D5"]) or {}
    check("setup: U2 anggota W + WP; Timeline ON U1+U2; W = Alfa 7 + Beta 2; WP = 500 task + %d dependensi; D5 selesai "
          "completed_at %r (23:30 UTC); server TZ Etc/UTC" % (n_dep[0] - 3, d5.get("completed_at")),
          s1["state"]["enabled"] and s2["state"]["enabled"] and len(ids["alfa"]) == 7
          and sum(1 for t in srv.values() if (t["title"] or "").startswith(("Gamma", "Delta"))) == 500 and n_dep[0] - 3 == 400
          and d5.get("gtd_status") == "done" and str(d5.get("completed_at") or "").startswith(iso(ids["D5_utc_day"]) + "T23:30"))
    return {"u1": u1, "u2": u2}, ids


def console_checks():
    allowed = re.compile(r"Failed to load resource|net::ERR_")
    bad = [(dv, t, x[:220]) for dv, t, x in c0.console_log if t in ("error", "pageerror") and not allowed.search(x)]
    info("konsol: error/peringatan (perangkat, jenis, teks)", [(dv, t, x[:160]) for dv, t, x in c0.console_log
                                                               if t in ("error", "pageerror", "warning")][:24])
    check("8e konsol tanpa error selain request di-abort yang disengaja", not bad, repr(bad[:6]))


def main():
    if os.environ.get("TZ") != "Asia/Jakarta":
        print("PERINGATAN: jalankan dengan TZ=Asia/Jakarta", flush=True)
    if os.path.isdir(SHOTS):
        for fn in os.listdir(SHOTS):
            if re.match(r"^\d+-.*\.png$", fn):
                os.remove(os.path.join(SHOTS, fn))
    tmp = tempfile.mkdtemp(prefix="e2e_plugin_fase1_1c2_")
    db_path = os.path.join(tmp, "e2e.db")
    tz0 = os.environ.get("TZ")
    os.environ["TZ"] = "Etc/UTC"  # server: paritas VPS (Etc/UTC)
    try:
        proc, base = hd.start_server(tmp)
    finally:
        if tz0 is None:
            os.environ.pop("TZ", None)
        else:
            os.environ["TZ"] = tz0
        time.tzset()
    print("server", base, flush=True)
    mon = c0.next_monday(datetime.datetime.now(JKT).date())
    try:
        users, ids = seed(base, db_path, mon)
        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            run(browser, base, users, ids, mon, db_path)
            console_checks()
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
                lines = [ln.rstrip() for ln in fh if re.search(r"Traceback|ERROR", ln)]
            print("  log server (error): %r" % lines[:8], flush=True)
        shutil.rmtree(tmp, ignore_errors=True)
    failed = [r for r in hd.results if not r[1]]
    print("\nangka:")
    for k, v in c0.perf.items():
        print("  %s: %s" % (k, v))
    print("\n%d/%d cek lolos" % (len(hd.results) - len(failed), len(hd.results)), flush=True)
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
