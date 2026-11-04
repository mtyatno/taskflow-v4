"""E2E PR 1c-1 (Timeline 1.1: jadwal otomatis, CPM, pratinjau, aliran gestur, drift, Jadwalkan ulang). Rencana
docs/superpowers/plans/2026-11-01-plugin-fase1-pr-1c-1.md Task 15. Tidak dijalankan CI.

    TZ=Asia/Jakarta python3 temporary_files/e2e_plugin_fase1_1c1.py

Memakai helper `e2e_plugin_fase1_1c0.py` (server uvicorn lokal `webapp:app` + DB sementara + Chromium; tiap "perangkat" =
satu `browser.new_context(service_workers="block")`, IndexedDB terpisah). Server dijalankan dengan `TZ=Etc/UTC` (paritas
VPS, dikonfirmasi pemilik 2026-11-04); peramban dan skrip memakai Asia/Jakarta.

U1 "tc1a" Rani (perangkat A, A2, B, M, SK, D9; pemilik workspace W "Ruang Otomatis"), U2 "tc1b" Sari (anggota W;
perangkat U, C = klien 1.0, P10). Timeline ON keduanya lewat API. Seed W: 500 task + 400 dependensi FS/SS/FF/SF di 3
project — Alfa (60 task, 50 dependensi; rantai α R1→α1..α5 FS, bintang R2→β1..β30, pasangan SS, FF/SF), Beta (240 task,
300 dependensi; 200 penerus = 200 item saat Otomatis menyala), Gamma (200 task, 50 dependensi; 50 item). Penerus disimpan
lebih lambat dari hasil hitung (celah) sehingga menyalakan Otomatis menggeser tepat semua penerus. Project pribadi U1
"Pribadi" (4 task) untuk Jadwalkan ulang.

   1 nol tulisan latar: A dan B (U1) membuka Timeline W, 2 siklus __syncNow, buka seksi Jadwal 5 task → 0 PUT / 0 POST.
   2 sakelar + pratinjau: A Otomatis Alfa → dialog 50 item; Batal → 0 PUT; Terapkan → 50 PUT {ext_patch} (K25) + POST
     record project; B tarik → Gantt B sama, "Dinyalakan oleh Rani"; B 0 PUT.
   3 Terapkan 200 (Beta) CPU 4× + offline: klik → semua di IndexedDB ≤ 2 s, satu commit React optimistis (hook DevTools
     palsu); jalur lama (extPatchMany dicabut lewat route taskroutes.js) di konteks A2 sebagai pembanding (angka saja).
   4 drain (K23) latensi 150 ms (route): 200 (Beta) dan 50 (Gamma) → waktu dicatat; drain 50 > 60 s = pemicu PR batch.
   5 judul bertahan: U2 ganti judul X (API) saat A belum tarik (tarik A diblokir) → server judul U2 + jadwal A.
   6 aliran gestur: seret R1 → "Jadwal diubah · 5 task ikut bergeser" + Urungkan → IndexedDB nilai awal; seret α1 sebelum
     pendahulu → "Tidak bisa lebih awal dari dependensinya", 0 PUT; seret R2 (30 turunan) → pratinjau, Batal, 0 PUT.
   7 klien 1.0 (C, U2): plugin.js/style.css/index.json/plugin-runtime.js dipatok 390e151d lewat route; C seret SS-anak
     tanpa SNET → A banner drift "Tinjau"; dependensi SS di C "tidak dikenali versi ini", tidak terhapus; Tinjau → ES.
   8 drift dari host: U2 centang selesai R1 → A banner 5 drift, 0 PUT A sampai Tinjau → Terapkan.
   9 Jadwalkan ulang (D9, Pribadi) dengan CDP setTimezoneOverride + clock.set_system_time → "Hari ini: …", Terapkan.
  10 kinerja (P10, U2, CPU 4×): render Timeline sendiri ≤ 150 ms (R24 1b), mesin ≤ 40 ms (engine.run atas ctx view,
     diekspos lewat penulisan ulang plugin.js khusus konteks ini), DOM ≤ 1.500 dengan Jalur kritis ON.
  11 offline: A offline Otomatis Gamma → catatan offline di pratinjau → Terapkan → online → 50 op terkirim.
  12 375 px: menu "Lainnya", seksi tingkat 2 di modal, scrollWidth 375; Sakura gelap: garis kritis + banner (tangkapan);
     konsol tanpa error.
"""
import datetime
import json
import os
import re
import shutil
import statistics
import subprocess
import sys
import tempfile
import time

import requests
from playwright.sync_api import TimeoutError as PwTimeout, sync_playwright

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import e2e_hero_dashboard as hd  # noqa: E402
import e2e_plugin_fase1_1c0 as c0  # noqa: E402

SHOTS = c0.SHOTS = os.path.join(hd.ROOT, "temporary_files", "e2e_plugin_fase1_1c1")
PIN = "390e151d"  # origin/main = Timeline 1.0.0 + runtime 1c-0 (patokan sama dengan kontrol 1c-0b); bukan ref bergerak
PID = c0.PID
WS = "Ruang Otomatis"
P1, P2, P3, PRIV = "Alfa", "Beta", "Gamma", "Pribadi"
TYPES = ["FS", "SS", "FF", "SF"]
CPU_RATE = 4
RENDER_BUDGET, ENGINE_BUDGET, DOM_BUDGET, APPLY_BUDGET = 150, 40, 1500, 2000
LATENCY_MS = 150
PULL_RE = c0.PULL_RE
HARI_SHORT = ["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"]
BULAN_SHORT = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"]
MSG_EARLY = "Tidak bisa lebih awal dari dependensinya"
MSG_OFFLINE = "Kamu sedang offline — jadwal dihitung dari data di perangkat ini"
MSG_UNKNOWN = "dependensi rusak atau tidak dikenali versi ini"
PV_FLOW = "Tinjau jadwal otomatis"
PV_RESCHED = "Jadwalkan ulang yang belum selesai"

check, info, nap, wait_until = hd.check, c0.info, c0.nap, c0.wait_until
sync_now, shot, go_offline = c0.sync_now, c0.shot, c0.go_offline
puts = c0.puts  # (perangkat, task_id, body, t) — diisi c0.watch
recs = []       # (perangkat, body, t) POST /api/plugins/timeline/records
resps = []      # (perangkat, task_id, status, t) respons PUT /api/tasks/<id>


def pinned(path):
    return subprocess.run(["git", "show", PIN + ":" + path], cwd=hd.ROOT, check=True, capture_output=True).stdout


OLD_CLIENT = {  # klien 1.0 lengkap: indeks (hash lama → plugin.js?v=lama), kode plugin, gaya, runtime
    "static/plugins/index.json": ("application/json", pinned("static/plugins/index.json")),
    "static/plugins/timeline/plugin.js": ("application/javascript", pinned("static/plugins/timeline/plugin.js")),
    "static/plugins/timeline/style.css": ("text/css", pinned("static/plugins/timeline/style.css")),
    "static/plugin-runtime.js": ("application/javascript", pinned("static/plugin-runtime.js")),
}
assert b'"version":"1.0.0"' in OLD_CLIENT["static/plugins/timeline/plugin.js"][1].replace(b" ", b""), "patokan bukan Timeline 1.0.0"

_orig_watch = c0.watch


def watch(p, label):
    _orig_watch(p, label)

    def on_req(r):
        if r.method == "POST" and "/api/plugins/%s/records" % PID in r.url:
            try:
                body = r.post_data_json
            except Exception:  # noqa: BLE001
                body = None
            recs.append((label, body, time.time()))

    def on_resp(r):
        m = re.search(r"/api/tasks/(\d+)(\?.*)?$", r.url)
        if r.request.method == "PUT" and m:
            resps.append((label, int(m.group(1)), r.status, time.time()))
    p.on("request", on_req)
    p.on("response", on_resp)


c0.watch = watch  # c0.open_page memanggil c0.watch

# Peristiwa taskUpdated (ukuran waktu Terapkan), toast (teks persis), saklar pemindai saat pengukuran.
MY_INIT = r"""(() => { window.__tu = []; window.__toasts = []; window.__scanOff = false;
  window.addEventListener('taskUpdated', (e) => { const d = e.detail || {};
    const ids = Array.isArray(d.taskIds) ? d.taskIds : (d.taskId !== undefined && d.taskId !== null ? [d.taskId] : []);
    window.__tu.push([ids.length, performance.now()]); });
  const RX = /(Jadwal diubah · \d+ task ikut bergeser|Tidak bisa lebih awal dari dependensinya|Jadwal diterapkan · \d+ task|Data berubah sejak pratinjau dibuka — hitung ulang|Sebagian jadwal gagal disimpan \(\d+ dari \d+\)|Jadwal gagal disimpan|Jadwal otomatis menyala — tidak ada task yang bergeser)/;
  const scan = (t) => { if (window.__scanOff || !t || t.length > 400) return; const m = t.match(RX); if (m) window.__toasts.push([m[1], Date.now()]); };
  new MutationObserver((ms) => { for (const m of ms) { if (m.type === 'characterData') scan(m.target.textContent);
    for (const n of m.addedNodes || []) scan(n.textContent); } }).observe(document, { childList: true, subtree: true, characterData: true });
})();"""


def new_ctx(browser, base, **kw):
    ctx = c0.new_context(browser, base, **kw)
    ctx.add_init_script(MY_INIT)
    return ctx


def open_dev(browser, base, user, label, **kw):
    ctx = new_ctx(browser, base, **kw)
    return ctx, c0.open_page(ctx, base, user, label)


def serve_pinned(ctx, served):
    def make(path, ctype, body):  # Playwright memanggil handler(route, request): nilai lewat closure, bukan argumen bawaan
        def handler(route):
            served.append(path)
            route.fulfill(status=200, content_type=ctype, body=body)
        return handler
    for path, (ctype, body) in OLD_CLIENT.items():
        ctx.route(re.compile(re.escape("/" + path) + r"(\?.*)?$"), make(path, ctype, body))


def now_ms(p):
    return p.evaluate("() => Date.now()")


def toasts(p, since):
    return [t for t, at in p.evaluate("() => window.__toasts") if at >= since]


def puts_of(label, since, tids=None):
    return [x for x in puts if x[0] == label and x[3] >= since and (tids is None or x[1] in tids)]


def recs_of(label, since):
    return [x for x in recs if x[0] == label and x[2] >= since]


def server_all(base, user):
    r = hd.api(base, user, "GET", "/api/tasks?include_done=true")
    items = r if isinstance(r, list) else r.get("tasks", [])
    out = {}
    for t in items:
        e = t.get("ext") or {}
        if isinstance(e, str):
            e = json.loads(e or "{}")
        out[t["id"]] = {"title": t.get("title"), "start": e.get(PID + ".start"), "duration": e.get(PID + ".duration"),
                        "constraint": e.get(PID + ".constraint"), "deps": e.get(PID + ".deps"), "gtd_status": t.get("gtd_status")}
    return out


def server_units(base, user):
    r = hd.api(base, user, "GET", "/api/plugins/%s/records?limit=1000" % PID)
    return [x for x in r.get("items", []) if str(x.get("id", "")).startswith("prj@") and not x.get("deleted")]


IDB_JS = """async (ids) => { const db = await TF.db.openDB();
  const all = await new Promise((res, rej) => { const q = db.transaction('tasks', 'readonly').objectStore('tasks').getAll();
    q.onsuccess = () => res(q.result || []); q.onerror = () => rej(q.error); });
  const want = new Set(ids); const out = {};
  for (const r of all) { if (!want.has(r.server_id)) continue; const e = r.ext || {};
    out[r.server_id] = { start: e['timeline.start'] || null, duration: e['timeline.duration'] === undefined ? null : e['timeline.duration'],
      constraint: e['timeline.constraint'] || null, mode: e['timeline.mode'] || null, deps: e['timeline.deps'] || null,
      dirty: r.dirty || 0, title: r.title, gtd_status: r.gtd_status, deleted: !!r.deleted }; }
  return out; }"""


def idb(p, ids):
    return {int(k): v for k, v in p.evaluate(IDB_JS, list(ids)).items()}


BARS_JS = """(keys) => Object.fromEntries(keys.map((k) => { const b = document.querySelector(".plg-timeline-bar[data-key='" + k + "']");
  return [k, b ? [b.style.left, b.style.width] : null]; }))"""


def wait_engine(p, slack=True, timeout=40000):
    """Mesin siap: tombol Jadwal otomatis/Lainnya ada (engReady) dan (desktop) sel Slack terisi angka."""
    p.wait_for_function("""(slack) => !!document.querySelector('.plg-timeline-autobtn, .plg-timeline-more, .plg-timeline-toolbar .plg-timeline-switch')
        && (!slack || Array.from(document.querySelectorAll('.plg-timeline-row:not(.is-group) .plg-timeline-col-slack')).some(c => /\\d/.test(c.textContent)))""",
                        arg=slack, timeout=timeout)


def open_units(p):
    btn = p.locator(".plg-timeline-autobtn")
    btn.wait_for(state="visible", timeout=30000)
    pop = p.locator(".plg-timeline-units")
    if not pop.count():
        btn.click()
    pop.wait_for(state="visible", timeout=10000)
    return pop


def toggle_unit(p, name):
    pop = open_units(p)
    sw = pop.locator("[role=switch][aria-label='%s']" % name)
    if not wait_until(lambda: sw.is_enabled(), 6, 0.3):  # P3 (a): unit workspace terkunci sampai tarik record
        p.keyboard.press("Escape")
        sync_now(p)
        pop = open_units(p)
        sw = pop.locator("[role=switch][aria-label='%s']" % name)
        wait_until(lambda: sw.is_enabled(), 15, 0.3)
    state = sw.get_attribute("aria-checked")
    sw.click()
    return state


def wait_pv(p, timeout=15000):
    pv = p.locator(".plg-timeline-pv")
    pv.wait_for(state="visible", timeout=timeout)
    return pv


def pv_info(pv):
    return pv.evaluate("""(el) => ({ title: el.getAttribute('aria-label'),
        summary: (el.querySelector('.plg-timeline-pv-summary') || {}).textContent || '',
        rows: el.querySelectorAll('.plg-timeline-pv-row:not(.plg-timeline-pv-nm)').length,
        keys: Array.from(el.querySelectorAll('.plg-timeline-pv-row:not(.plg-timeline-pv-nm)')).map(r => r.getAttribute('data-key')),
        offline: (el.querySelector('.plg-timeline-pv-offline') || {}).textContent || null,
        today: (el.querySelector('.plg-timeline-pv-today') || {}).textContent || null,
        apply: !el.querySelector('.plg-timeline-pv-apply').disabled })""")


def pv_cancel(p):
    p.locator(".plg-timeline-pv").get_by_role("button", name="Batal").click()
    p.locator(".plg-timeline-pv").wait_for(state="detached", timeout=10000)


def pv_apply(p):
    p.locator(".plg-timeline-pv .plg-timeline-pv-apply").click()
    p.locator(".plg-timeline-pv").wait_for(state="detached", timeout=30000)


def banner_texts(p):
    return p.evaluate("() => Array.from(document.querySelectorAll('.plg-timeline-banner-text')).map(x => x.textContent)")


def drift_banner(p):
    return [t for t in banner_texts(p) if t.startswith("Jadwal otomatis belum mutakhir:")]


REVEAL_JS = """async (key) => { const s = document.querySelector('.plg-timeline-scroll'); if (!s) return false;
  const q = () => document.querySelector(".plg-timeline-bar[data-key='" + key + "'], .plg-timeline-milestone[data-key='" + key + "']");
  const wait = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 30)));
  if (q()) return true;
  s.scrollTop = 0; s.dispatchEvent(new Event('scroll')); await wait();
  for (let i = 0; i < 400 && !q(); i++) { const t = s.scrollTop; s.scrollTop = t + Math.max(200, s.clientHeight - 120);
    s.dispatchEvent(new Event('scroll')); await wait(); if (s.scrollTop === t) break; }
  return !!q(); }"""


def reveal(p, tid):
    """Baris Gantt tervirtualisasi: gulir wadah sampai bar `tid` dirender."""
    return p.evaluate(REVEAL_JS, str(tid))


def open_bar_modal(p, tid):
    reveal(p, tid)
    b = c0.bar(p, tid)
    b.wait_for(state="visible", timeout=15000)
    b.scroll_into_view_if_needed()
    b.focus()
    p.keyboard.press("Enter")
    sec = p.locator(".modal-content .plg-timeline-section:not([aria-busy='true'])")
    sec.wait_for(state="visible", timeout=15000)
    return sec


def drag(p, tid, days):
    reveal(p, tid)
    c0.drag_bar(p, tid, days)


def wd(mon, n):
    d = mon
    step = 1 if n >= 0 else -1
    while n:
        d += datetime.timedelta(days=step)
        if d.weekday() < 5:
            n -= step
    return d


def iso_add_wd(iso, n):
    return wd(datetime.date.fromisoformat(iso), n).isoformat()


def short(d):
    return "%s %d %s" % (HARI_SHORT[d.weekday()], d.day, BULAN_SHORT[d.month - 1])


def set_latency(ctx, state):
    """Satu handler /api/: tarik task diblokir (state['block']) atau jeda state['ms'] sebelum diteruskan (RTT tambahan)."""
    def handler(route):
        if state.get("block") and PULL_RE.search(route.request.url):
            state["blocked"] = state.get("blocked", 0) + 1
            return route.abort()
        ms = state.get("ms") or 0
        if ms:
            try:
                route.request.frame.page.wait_for_timeout(ms)
            except Exception:  # noqa: BLE001
                time.sleep(ms / 1000)
        route.continue_()
    pat = re.compile(r"/api/")
    ctx.route(pat, handler)
    return lambda: ctx.unroute(pat, handler)


def drain(ctx, p, label, tids, timeout=300):
    """Online (latensi aktif) → waktu sampai semua PUT task `tids` dijawab 200. Kembalikan (detik, jumlah, per-request ms)."""
    tids = set(tids)
    t0 = time.time()
    ctx.set_offline(False)
    p.wait_for_function("() => navigator.onLine === true", timeout=5000)
    p.evaluate("() => { try { window.__syncNow && window.__syncNow(); } catch (e) {} }")
    ok = lambda: set(x[1] for x in resps if x[0] == label and x[3] >= t0 and x[2] == 200 and x[1] in tids)  # noqa: E731
    wait_until(lambda: len(ok()) >= len(tids), timeout, 0.2)
    got = [x for x in resps if x[0] == label and x[3] >= t0 and x[2] == 200 and x[1] in tids]
    t_end = max([x[3] for x in got] or [time.time()])
    times = sorted(x[3] for x in got)
    gaps = [round((b - a) * 1000) for a, b in zip(times, times[1:])]
    return round(t_end - t0, 1), len(set(x[1] for x in got)), (statistics.median(gaps) if gaps else None), t0


# Instrumen 1c-0 skenario 8: commit di dalam unstable_batchedUpdates (optimistis setMany) dan di refreshTasks.
INSTR_JS = c0.INSTR_JS

APPLY_MEASURE_JS = """(n) => new Promise((resolve) => {
  const m = window.__m; m.batchCalls = m.batchCommits = m.refreshCalls = m.refreshCommits = 0; m.pending = [];
  window.__commits = 0; window.__tu = []; window.__scanOff = true;
  const btn = document.querySelector('.plg-timeline-pv .plg-timeline-pv-apply');
  const t0 = performance.now();
  btn.click();
  const tick = () => { const hit = window.__tu.find((x) => x[0] >= n);
    if (hit) return finish(hit[1]);
    if (performance.now() - t0 > 60000) return finish(null);
    setTimeout(tick, 2); };
  const finish = (t1) => { const atDone = window.__commits, bc = m.batchCalls, bk = m.batchCommits;
    setTimeout(() => Promise.all(m.pending).then(() => { window.__scanOff = false;
      resolve({ ms: t1 === null ? null : Math.round(t1 - t0), commitsAtDone: atDone, commits: window.__commits, batchCalls: bc,
        batchCommits: bk, refreshCalls: m.refreshCalls, refreshCommits: m.refreshCommits, tu: window.__tu.map(x => x[0]) }); }), 1500); };
  setTimeout(tick, 0);
})"""


def measure_apply(ctx, p, n):
    cdp = ctx.new_cdp_session(p)
    cdp.send("Emulation.setCPUThrottlingRate", {"rate": CPU_RATE})
    try:
        return p.evaluate(APPLY_MEASURE_JS, n)
    finally:
        cdp.send("Emulation.setCPUThrottlingRate", {"rate": 1})
        cdp.detach()


def taskroutes_no_bulk():
    with open(os.path.join(hd.ROOT, "static", "offline", "taskroutes.js"), encoding="utf-8") as fh:
        src = fh.read()
    needle = "router.extPatchMany = (items) => {"
    assert src.count(needle) == 1, "taskroutes.js: penanda extPatchMany berubah"
    return src.replace(needle, "router.__e2eNoBulk = (items) => {")


def plugin_with_pure():
    with open(os.path.join(hd.ROOT, "static", "plugins", "timeline", "plugin.js"), encoding="utf-8") as fh:
        src = fh.read()
    needle = 'if (typeof module !== "undefined" && module.exports) module.exports = Object.assign({}, {'
    assert src.count(needle) == 1, "plugin.js: penanda ekspor berubah"
    return src.replace(needle, "window.__tlPure = Object.assign({}, {")


# ── skenario ──────────────────────────────────────────────────────────────────

def run(browser, base, users, ids, mon):
    u1, u2 = users["u1"], users["u2"]
    p1_all = ids["p1"]
    p1_movers, p2_movers, p3_movers = ids["p1m"], ids["p2m"], ids["p3m"]
    alpha = [ids["R1"]] + ids["alpha"]
    ctxs = []
    try:
        ca, a = open_dev(browser, base, u1, "A", hook=True)
        ctxs.append(ca)
        cb, b = open_dev(browser, base, u1, "B")
        ctxs.append(cb)

        # ── 1 nol tulisan latar ──
        c0.open_timeline(a, WS)
        c0.open_timeline(b, WS)
        s0 = time.time()
        for _ in range(2):
            sync_now(a)
            sync_now(b)
        wait_engine(a)
        wait_engine(b)
        nap(2)
        mid = (len(puts_of("A", s0)) + len(puts_of("B", s0)), len(recs_of("A", s0)) + len(recs_of("B", s0)))
        five = [ids["R1"], ids["alpha"][0], ids["R2"], ids["Sp"], ids["Ss"]]
        opened = 0
        for p in (a, b):
            for tid in five:
                sec = open_bar_modal(p, tid)
                opened += 1 if "Jadwal" in sec.inner_text() else 0
                p.wait_for_timeout(600)
                c0.close_modal(p)
        nap(2)
        n_put = len(puts_of("A", s0)) + len(puts_of("B", s0))
        n_rec = len(recs_of("A", s0)) + len(recs_of("B", s0))
        check("1a A dan B (U1) membuka Timeline W (500 task/400 dependensi), 2 siklus __syncNow → 0 PUT task, 0 POST records",
              mid == (0, 0), "PUT+POST=%r" % (mid,))
        check("1b buka seksi Jadwal 5 task di A dan B (%d seksi tampil) → tetap 0 PUT / 0 POST records" % opened,
              opened == 10 and n_put == 0 and n_rec == 0, "PUT=%d POST=%d" % (n_put, n_rec))
        shot(a, "1-A-timeline-W-500.png")

        # ── 2 sakelar + pratinjau ──
        s0 = time.time()
        t0 = now_ms(a)
        toggle_unit(a, P1)
        pv = wait_pv(a)
        i2 = pv_info(pv)
        info("2 pratinjau Otomatis Alfa", {k: i2[k] for k in ("title", "summary", "rows")})
        shot(a, "2-A-pratinjau-alfa.png")
        pv_cancel(a)
        nap(2)
        check("2a A sakelar Otomatis Alfa → dialog 'Nyalakan jadwal otomatis — %s' berisi 50 item ('50 task bergeser', 50 baris "
              "= penerus Alfa); Batal → 0 PUT, 0 POST records, unit tidak menyala" % P1,
              i2["title"] == "Nyalakan jadwal otomatis — " + P1 and i2["summary"].startswith("50 task bergeser")
              and i2["rows"] == 50 and set(int(k) for k in i2["keys"]) == set(p1_movers)
              and not puts_of("A", s0) and not recs_of("A", s0) and not server_units(base, u1), repr(i2))
        s1 = time.time()
        t1 = now_ms(a)
        toggle_unit(a, P1)
        wait_pv(a)
        pv_apply(a)
        wait_until(lambda: len(set(x[1] for x in puts_of("A", s1))) >= 50, 40, 0.3)
        wait_until(lambda: recs_of("A", s1), 15, 0.3)
        nap(2.5)
        bodies = puts_of("A", s1)
        allowed = {PID + ".start", PID + ".duration", PID + ".constraint", PID + ".mode"}
        check("2b Terapkan → tepat 1 PUT per penerus Alfa (50), body persis {ext_patch} tanpa field inti (K25), kunci timeline.* saja",
              len(bodies) == 50 and set(x[1] for x in bodies) == set(p1_movers)
              and all(set(x[2] or {}) == {"ext_patch"} and set(x[2]["ext_patch"]) <= allowed for x in bodies),
              "n=%d contoh=%r" % (len(bodies), [x[2] for x in bodies[:2]]))
        rp = [it for x in recs_of("A", s1) for it in ((x[1] or {}).get("items") or [])]
        units = server_units(base, u1)
        check("2c record project POST dari A: entity project, data {auto: true, name: Alfa, by: U1}; server menyimpannya",
              any(it.get("entity") == "project" and (it.get("data") or {}).get("auto") is True
                  and (it.get("data") or {}).get("name") == P1 and (it.get("data") or {}).get("by") == u1["id"] for it in rp)
              and any((u.get("data") or {}).get("auto") is True and (u.get("data") or {}).get("name") == P1 for u in units),
              repr((rp, units)))
        check("2d toast 'Jadwal diterapkan · 50 task'", "Jadwal diterapkan · 50 task" in toasts(a, t1), repr(toasts(a, t0)))
        la = idb(a, p1_all)
        srv = server_all(base, u1)
        check("2e server = IndexedDB A untuk 60 task Alfa; A tanpa banner drift",
              all(srv[t]["start"] == la[t]["start"] for t in p1_all) and not drift_banner(a)
              and all(la[t]["start"] != ids["p1start"][t] for t in p1_movers), repr(drift_banner(a)))
        shot(a, "2-A-alfa-otomatis.png")
        s2 = time.time()
        sync_now(b)
        c0.refresh_tasks(b)
        nap(1.5)
        wait_engine(b)
        lb = idb(b, p1_all)
        keys = [str(t) for t in alpha + [ids["R2"], ids["Sp"], ids["Ss"]] + ids["beta"][:5]]
        reveal(a, ids["R2"])
        reveal(b, ids["R2"])
        bars_a, bars_b = a.evaluate(BARS_JS, keys), b.evaluate(BARS_JS, keys)
        both = [k for k in keys if bars_a.get(k) and bars_b.get(k)]
        check("2f B tarik → IndexedDB B = A untuk 60 task Alfa; posisi bar Gantt B = A (%d bar dibandingkan); B tanpa banner drift"
              % len(both), all(lb[t]["start"] == la[t]["start"] for t in p1_all) and len(both) >= 8
              and all(bars_a[k] == bars_b[k] for k in both) and not drift_banner(b),
              repr([(k, bars_a.get(k), bars_b.get(k)) for k in keys if bars_a.get(k) != bars_b.get(k)][:4]))
        pop = open_units(b)
        item = pop.locator(".plg-timeline-units-item", has=b.locator("[aria-label='%s']" % P1))
        cap = item.locator(".plg-timeline-units-by").inner_text() if item.locator(".plg-timeline-units-by").count() else ""
        on_b = item.locator("[role=switch]").get_attribute("aria-checked")
        shot(b, "2-B-dinyalakan-oleh.png")
        b.keyboard.press("Escape")
        today_s = short(datetime.date.today())
        check("2g B: sakelar Alfa ON, keterangan 'Dinyalakan oleh Rani · %s'" % today_s, on_b == "true"
              and cap == "Dinyalakan oleh Rani · " + today_s, repr((on_b, cap)))
        nap(1.5)
        check("2h B 0 PUT task / 0 POST records (tarik, render, popover)", not puts_of("B", s2) and not recs_of("B", s2),
              repr((puts_of("B", s2)[:2], recs_of("B", s2)[:2])))

        # ── 6 aliran gestur (Alfa otomatis) ──
        before6 = idb(a, alpha)
        s6, t6 = time.time(), now_ms(a)
        drag(a, ids["R1"], 2)
        wait_until(lambda: len(puts_of("A", s6, set(alpha))) >= 6, 20, 0.3)
        nap(2)
        flow = puts_of("A", s6, set(alpha))
        moved6 = idb(a, alpha)
        ts6 = toasts(a, t6)
        shot(a, "6-A-aliran-toast.png")
        check("6a seret R1 +2 hari (akar Alfa) → toast 'Jadwal diubah · 5 task ikut bergeser'; 6 PUT {ext_patch} (R1 + α1..α5); "
              "semua bergeser", "Jadwal diubah · 5 task ikut bergeser" in ts6 and len(flow) == 6
              and set(x[1] for x in flow) == set(alpha) and all(set(x[2] or {}) == {"ext_patch"} for x in flow)
              and all(moved6[t]["start"] != before6[t]["start"] for t in alpha), repr((ts6, len(flow))))
        s6b = time.time()
        a.get_by_role("button", name="Urungkan").first.click()
        wait_until(lambda: len(puts_of("A", s6b, set(alpha))) >= 6, 20, 0.3)
        nap(2)
        after6 = idb(a, alpha)
        srv6 = server_all(base, u1)
        same = all({k: after6[t][k] for k in ("start", "duration", "constraint", "mode", "deps")}
                   == {k: before6[t][k] for k in ("start", "duration", "constraint", "mode", "deps")} for t in alpha)
        check("6b Urungkan → 6 PUT; IndexedDB = nilai awal persis (start/duration/constraint/mode/deps) untuk R1+α1..α5; server sama",
              same and len(puts_of("A", s6b, set(alpha))) == 6 and all(srv6[t]["start"] == before6[t]["start"] for t in alpha),
              repr([(t, before6[t]["start"], after6[t]["start"]) for t in alpha]))
        a1 = ids["alpha"][0]
        st_a1 = idb(a, [a1])[a1]["start"]
        bb0 = c0.bar(a, a1).bounding_box()
        s6c, t6c = time.time(), now_ms(a)
        drag(a, a1, -3)
        nap(2.5)
        bb1 = c0.bar(a, a1).bounding_box()
        check("6c seret α1 −3 hari (sebelum pendahulu R1) → toast '%s', 0 PUT, bar kembali, IndexedDB tetap" % MSG_EARLY,
              MSG_EARLY in toasts(a, t6c) and not puts_of("A", s6c) and abs(bb1["x"] - bb0["x"]) < 1
              and idb(a, [a1])[a1]["start"] == st_a1, repr((toasts(a, t6c), bb0["x"], bb1["x"])))
        shot(a, "6-A-terlalu-awal.png")
        s6d = time.time()
        drag(a, ids["R2"], 2)
        pv = wait_pv(a)
        i6 = pv_info(pv)
        shot(a, "6-A-pratinjau-30-turunan.png")
        pv_cancel(a)
        nap(2)
        check("6d seret R2 (30 turunan > 20) → pratinjau '%s' (%s; %d baris); Batal → 0 PUT" % (PV_FLOW, i6["summary"], i6["rows"]),
              i6["title"] == PV_FLOW and i6["rows"] >= 31 and not puts_of("A", s6d)
              and idb(a, [ids["R2"]])[ids["R2"]]["start"] == ids["p1start"][ids["R2"]], repr(i6))

        # ── 7 klien 1.0 + 1.1 ──
        served = []
        cc = new_ctx(browser, base)
        ctxs.append(cc)
        serve_pinned(cc, served)
        c = c0.open_page(cc, base, u2, "C")
        c0.open_timeline(c, WS)
        c.wait_for_timeout(1500)
        ver = c.evaluate("() => { try { return (window.TF.plugins.list ? window.TF.plugins.list() : []).map(x => [x.id, x.version]); } catch (e) { return String(e); } }")
        info("7 C: plugin terdaftar (id, versi)", ver)
        no_11 = c.locator(".plg-timeline-autobtn").count() == 0 and c.locator(".plg-timeline-col-slack").count() == 0
        ss = ids["Ss"]
        dep0 = server_all(base, u1)[ss]["deps"]
        st0 = server_all(base, u1)[ss]["start"]
        s7, t7a = time.time(), now_ms(a)
        drag(c, ss, 2)
        wait_until(lambda: puts_of("C", s7, {ss}), 15, 0.3)
        nap(2)
        b7 = puts_of("C", s7, {ss})
        want7 = c0.shift(st0, 2)
        srv7 = server_all(base, u1)[ss]
        check("7a C memuat Timeline 1.0.0 dari %s (%d berkas disajikan; tanpa tombol Jadwal otomatis/kolom Slack); C seret SS-anak "
              "+2 → satu PUT {ext_patch: {timeline.start: %s}} tanpa constraint (tanpa SNET)" % (PIN, len(served), want7),
              served and "static/plugins/timeline/plugin.js" in served and no_11 and len(b7) == 1
              and b7[0][2] == {"ext_patch": {PID + ".start": want7}} and srv7["start"] == want7,
              repr((sorted(set(served)), no_11, [x[2] for x in b7], srv7["start"], ver)))
        sec = open_bar_modal(c, ss)
        more = sec.locator(".plg-timeline-sec-more")
        if more.count() and more.get_attribute("aria-expanded") == "false":
            more.click()
        c.wait_for_timeout(800)
        sec_txt = sec.inner_text()
        shot(c, "7-C-seksi-1.0-ss-tidak-dikenali.png")
        c0.close_modal(c)
        nap(1)
        dep1 = server_all(base, u1)[ss]["deps"]
        check("7b seksi Jadwal C (1.0): '1 %s'; dependensi SS di server TIDAK terhapus (sebelum = sesudah seret/seksi C: %r)"
              % (MSG_UNKNOWN, dep1), ("1 " + MSG_UNKNOWN) in sec_txt and dep1 == dep0 and dep0
              and dep0[0].get("type") == "SS" and len(puts_of("C", s7)) == 1, repr((sec_txt[:300], dep0, dep1)))
        sync_now(a)
        c0.refresh_tasks(a)
        nap(1.5)
        sync_now(a)
        ok7 = wait_until(lambda: drift_banner(a), 15, 0.5)
        btxt = drift_banner(a)
        shot(a, "7-A-banner-drift.png")
        check("7c A (1.1) setelah tarik → banner 'Jadwal otomatis belum mutakhir: 1 task berbeda dari hasil hitung.' + 'Tinjau'; "
              "0 PUT A sejak seret C", ok7 and btxt == ["Jadwal otomatis belum mutakhir: 1 task berbeda dari hasil hitung."]
              and a.locator(".plg-timeline-banner-act", has_text="Tinjau").count() == 1 and not puts_of("A", s7), repr(btxt))
        s7d = time.time()
        a.locator(".plg-timeline-banner-act", has_text="Tinjau").first.click()
        pv = wait_pv(a)
        i7 = pv_info(pv)
        pv_apply(a)
        wait_until(lambda: puts_of("A", s7d, {ss}), 15, 0.3)
        nap(2)
        check("7d A Tinjau → pratinjau '%s' 1 baris (SS-anak) → Terapkan → server kembali ke ES %s; banner hilang" % (PV_FLOW, st0),
              i7["title"] == PV_FLOW and [int(k) for k in i7["keys"]] == [ss] and server_all(base, u1)[ss]["start"] == st0
              and server_all(base, u1)[ss]["deps"] == dep0 and not drift_banner(a), repr(i7))
        cc.close()
        ctxs.remove(cc)

        # ── 8 drift dari host ──
        cu, u = open_dev(browser, base, u2, "U")
        ctxs.append(cu)
        r1t = ids["titles"][ids["R1"]]
        c0.sidebar_click(u, WS)
        srch = u.locator("input[placeholder*='Cari task']").first
        srch.fill(r1t)
        u.locator(".task-row", has_text=r1t).first.wait_for(state="visible", timeout=15000)
        s8, t8 = time.time(), now_ms(a)
        u.locator(".task-row", has_text=r1t).first.locator(".check-btn").click()
        u.wait_for_timeout(800)
        sync_now(u)
        ok8 = wait_until(lambda: server_all(base, u1)[ids["R1"]]["gtd_status"] == "done", 15)
        srch.fill("")
        sync_now(a)
        c0.refresh_tasks(a)
        nap(1.5)
        sync_now(a)
        ok8b = wait_until(lambda: drift_banner(a), 15, 0.5)
        b8 = drift_banner(a)
        nap(2)
        shot(a, "8-A-banner-drift-host.png")
        a.locator(".plg-timeline-banner-act", has_text="Tinjau").first.click()
        pv = wait_pv(a)
        i8 = pv_info(pv)
        pre8 = len(puts_of("A", s8))
        pv_apply(a)
        wait_until(lambda: len(puts_of("A", s8)) >= 5, 15, 0.3)
        nap(2)
        p8 = puts_of("A", s8)
        check("8a U2 centang selesai R1 (host, baris daftar) → server done; A tarik → banner '…: 5 task berbeda …'",
              ok8 and ok8b and b8 == ["Jadwal otomatis belum mutakhir: 5 task berbeda dari hasil hitung."], repr(b8))
        check("8b 0 PUT / 0 POST records dari A sejak centang sampai Terapkan ditekan (2 siklus sinkron + banner + pratinjau)",
              pre8 == 0 and not [x for x in recs_of("A", s8)], "PUT=%d" % pre8)
        srv8 = server_all(base, u1)
        check("8c Tinjau → pratinjau 5 baris (α1..α5) → Terapkan → 5 PUT {ext_patch}; server = IndexedDB A; banner hilang",
              sorted(int(k) for k in i8["keys"]) == sorted(ids["alpha"]) and len(p8) == 5
              and all(set(x[2] or {}) == {"ext_patch"} for x in p8)
              and all(srv8[t]["start"] == idb(a, [t])[t]["start"] for t in ids["alpha"]) and not drift_banner(a), repr(i8))
        cu.close()
        ctxs.remove(cu)

        # ── 3 Terapkan 200 (Beta), CPU 4×, offline — pembanding jalur lama dulu (konteks A2, dibuang) ──
        ca2 = new_ctx(browser, base, hook=True)
        ctxs.append(ca2)
        nb_body = taskroutes_no_bulk()
        nb_served = []
        ca2.route(re.compile(r"/static/offline/taskroutes\.js(\?.*)?$"),
                  lambda route: (nb_served.append(1), route.fulfill(status=200, content_type="application/javascript", body=nb_body)))
        a2 = c0.open_page(ca2, base, u1, "A2")
        c0.open_timeline(a2, WS)
        sync_now(a2)
        wait_engine(a2)
        a2.evaluate(INSTR_JS)
        bulk_a2 = a2.evaluate("() => typeof window.TF.taskroutes.buildTaskRouter().extPatchMany")
        go_offline(ca2, a2)
        toggle_unit(a2, P2)
        pv = wait_pv(a2)
        i3o = pv_info(pv)
        r_old = measure_apply(ca2, a2, 200)
        l_old = idb(a2, p2_movers)
        info("3 KONTROL jalur lama (extPatchMany dicabut, CPU 4×, offline): ms klik→200 di IndexedDB, commit (saat selesai/total), "
             "batch (panggilan/commit), refresh (panggilan/commit)",
             [r_old["ms"], r_old["commitsAtDone"], r_old["commits"], r_old["batchCalls"], r_old["batchCommits"],
              r_old["refreshCalls"], r_old["refreshCommits"]])
        check("3a KONTROL jalur lama dipakai (taskroutes.js tanpa extPatchMany disajikan %d kali: typeof = %s) dan menyelesaikan 200 "
              "item (%s ms dicatat sebagai pembanding)" % (len(nb_served), bulk_a2, r_old["ms"]),
              nb_served and bulk_a2 == "undefined" and i3o["rows"] == 50 and r_old["ms"] is not None
              and sum(1 for t in p2_movers if l_old[t]["dirty"] and l_old[t]["start"] != ids["p2start"][t]) == 200, repr(r_old))
        ca2.close()
        ctxs.remove(ca2)
        sync_now(a)
        a.evaluate(INSTR_JS)
        bulk_a = a.evaluate("() => typeof window.TF.taskroutes.buildTaskRouter().extPatchMany")
        go_offline(ca, a)
        s3 = time.time()
        toggle_unit(a, P2)
        pv = wait_pv(a)
        i3 = pv_info(pv)
        shot(a, "3-A-pratinjau-beta-200-offline.png")
        r_new = measure_apply(ca, a, 200)
        l3 = idb(a, p2_movers)
        info("3 Terapkan 200 (PR, CPU 4×, offline): ms klik→200 di IndexedDB, commit (saat selesai/total), batch (panggilan/commit), "
             "refresh (panggilan/commit)", [r_new["ms"], r_new["commitsAtDone"], r_new["commits"], r_new["batchCalls"],
                                            r_new["batchCommits"], r_new["refreshCalls"], r_new["refreshCommits"]])
        info("3 perbandingan ms jalur baru / jalur lama", [r_new["ms"], r_old["ms"]])
        n_saved = sum(1 for t in p2_movers if l3[t]["dirty"] and l3[t]["start"] != ids["p2start"][t])
        check("3b pratinjau Beta '200 task bergeser' (50 baris tampil) + catatan offline; Terapkan (CPU 4×, offline, extPatchMany "
              "= %s) → 200 nilai di IndexedDB dalam %s ms ≤ %d ms (kriteria 7)" % (bulk_a, r_new["ms"], APPLY_BUDGET),
              i3["summary"].startswith("200 task bergeser") and i3["offline"] == MSG_OFFLINE and bulk_a == "function"
              and n_saved == 200 and r_new["ms"] is not None and r_new["ms"] <= APPLY_BUDGET, repr((i3["summary"], n_saved, r_new)))
        check("3c optimistis: tepat SATU unstable_batchedUpdates dengan SATU commit React (hook DevTools palsu); satu refreshTasks",
              r_new["batchCalls"] == 1 and r_new["batchCommits"] == 1 and r_new["refreshCalls"] == 1, repr(r_new))
        nap(1)
        check("3d offline: 0 PUT A sampai ke server selama Terapkan (0 respons)",
              not [x for x in resps if x[0] == "A" and x[3] >= s3], repr(puts_of("A", s3)[:2]))

        # ── 5 judul bertahan (U2 ganti judul X saat A belum tarik) ──
        x_id = p2_movers[0]
        x_title = "Judul dari Sari (U2)"
        hd.api(base, u2, "PUT", "/api/tasks/%d" % x_id, json={"title": x_title})
        check("5a U2 ganti judul X lewat API → server '%s'; A (offline) masih judul lama" % x_title,
              server_all(base, u1)[x_id]["title"] == x_title and l3[x_id]["title"] != x_title, repr(l3[x_id]))

        # ── 4 drain 200 (latensi 150 ms) + 5 lanjutan ──
        lat = {"ms": LATENCY_MS, "block": True}
        unlat = set_latency(ca, lat)
        sec200, n200, gap200, on200 = drain(ca, a, "A", p2_movers)
        info("4 drain 200 task (RTT +%d ms, tarik A diblokir): detik, task terkirim, median jarak antar respons ms"
             % LATENCY_MS, [sec200, n200, gap200])
        nap(2)
        b4 = puts_of("A", s3, set(p2_movers))
        srv4 = server_all(base, u1)
        # Selama offline host masih mencoba push sekali (tf:outbox-queued) → request gagal di jaringan (net::ERR_*), op tetap
        # antre. Dihitung terpisah: tidak ada yang sampai ke server (0 respons sebelum online).
        off_try = [(x[1], round(x[3] - s3, 2)) for x in puts_of("A", s3) if x[3] < on200]
        off_resp = [x for x in resps if x[0] == "A" and s3 <= x[3] < on200]
        info("4 percobaan PUT A selama offline (task, detik sejak Terapkan) — gagal di jaringan, tanpa respons", off_try)
        b4 = [x for x in puts_of("A", on200, set(p2_movers))]
        check("4a drain 200: tepat 200 PUT {ext_patch} (satu per task) dijawab 200 dalam %.1f s (dicatat; RTT +%d ms lewat route); "
              "percobaan selama offline (%d) tanpa respons" % (sec200, LATENCY_MS, len(off_try)),
              n200 == 200 and len(b4) == 200 and len(set(x[1] for x in b4)) == 200 and all(set(x[2] or {}) == {"ext_patch"} for x in b4)
              and not off_resp and all(srv4[t]["start"] == l3[t]["start"] for t in p2_movers),
              "n=%d puts=%d offline_resp=%d" % (n200, len(b4), len(off_resp)))
        xb = [x[2] for x in b4 if x[1] == x_id]
        check("5b A online (tarik diblokir %d kali) → PUT X persis {ext_patch}; server judul '%s' (U2) + jadwal A %s"
              % (lat.get("blocked", 0), x_title, l3[x_id]["start"]),
              lat.get("blocked", 0) >= 1 and xb and all(set(x) == {"ext_patch"} for x in xb)
              and srv4[x_id]["title"] == x_title and srv4[x_id]["start"] == l3[x_id]["start"], repr((xb, srv4[x_id])))
        lat.update(block=False, ms=0)
        wait_until(lambda: any(((it.get("data") or {}).get("name") == P2 and (it.get("data") or {}).get("auto") is True)
                               for u_ in [server_units(base, u1)] for it in u_), 20, 0.5)
        sync_now(a)
        nap(1)
        lx = idb(a, [x_id])[x_id]
        check("5c tarik dibuka → IndexedDB A: judul U2 + jadwal A, bersih; record project Beta auto di server",
              lx["title"] == x_title and lx["start"] == l3[x_id]["start"] and lx["dirty"] == 0
              and any((u_.get("data") or {}).get("name") == P2 and (u_.get("data") or {}).get("auto") for u_ in server_units(base, u1)),
              repr(lx))

        # ── 11 offline + 4 drain 50 (Gamma) ──
        go_offline(ca, a)
        s11 = time.time()
        toggle_unit(a, P3)
        pv = wait_pv(a)
        i11 = pv_info(pv)
        shot(a, "11-A-pratinjau-offline.png")
        pv_apply(a)
        nap(2)
        l11 = idb(a, p3_movers)
        check("11a A offline → Otomatis Gamma → pratinjau memuat catatan '%s' (50 item)" % MSG_OFFLINE,
              i11["offline"] == MSG_OFFLINE and i11["summary"].startswith("50 task bergeser"), repr(i11))
        check("11b Terapkan offline → 50 nilai di IndexedDB (kotor), 0 PUT sampai ke server (0 respons)",
              sum(1 for t in p3_movers if l11[t]["dirty"] and l11[t]["start"] != ids["p3start"][t]) == 50
              and not [x for x in resps if x[0] == "A" and x[3] >= s11])
        lat.update(ms=LATENCY_MS)
        sec50, n50, gap50, on50 = drain(ca, a, "A", p3_movers)
        lat.update(ms=0)
        unlat()
        info("4 drain 50 task (RTT +%d ms): detik, task terkirim, median jarak antar respons ms" % LATENCY_MS, [sec50, n50, gap50])
        info("4 pemicu PR batch generik (K23: drain 50 > 60 s)", "YA" if sec50 > 60 else "tidak (%.1f s ≤ 60 s)" % sec50)
        nap(2)
        srv11 = server_all(base, u1)
        b11 = puts_of("A", on50, set(p3_movers))
        check("11c online → 50 op terkirim (PUT {ext_patch}), server = IndexedDB A; 4b drain 50 dalam %.1f s dicatat" % sec50,
              n50 == 50 and len(b11) == 50 and all(set(x[2] or {}) == {"ext_patch"} for x in b11)
              and all(srv11[t]["start"] == l11[t]["start"] for t in p3_movers), "n=%d" % n50)
        sync_now(a)
        for cx in (ca, cb):  # skenario 9, 10, 12 tanpa perangkat A/B hidup (CPU 2 inti: pengukuran 10 tidak berebut)
            cx.close()
            ctxs.remove(cx)

        # ── 9 Jadwalkan ulang (jam tetap) ──
        run_reschedule(browser, base, u1, ids, mon, ctxs)

        # ── 10 kinerja ──
        run_perf(browser, base, u2, ctxs)

        # ── 12 375 px + Sakura gelap ──
        run_narrow_dark(browser, base, u1, ids, ctxs)
    finally:
        for cx in ctxs:
            try:
                cx.close()
            except Exception:  # noqa: BLE001
                pass


def run_reschedule(browser, base, u1, ids, mon, ctxs):
    pin = datetime.datetime(mon.year, mon.month, mon.day, 3, 0, 0, tzinfo=datetime.timezone.utc)  # 10.00 WIB
    ctx = browser.new_context(service_workers="block", viewport=hd.DESKTOP, reduced_motion="reduce")  # zona lewat CDP
    ctxs.append(ctx)
    ctx.route(re.compile(r"^(?!%s/)" % re.escape(base)), lambda route: route.abort())
    ctx.add_init_script(c0.INIT_JS)
    ctx.add_init_script(MY_INIT)
    p = ctx.new_page()
    c0.PUMP.append(p)
    watch(p, "D9")
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
    env = p.evaluate("() => [new Date().toString(), Intl.DateTimeFormat().resolvedOptions().timeZone]")
    c0.open_timeline(p, PRIV)
    wait_engine(p)
    s9 = time.time()
    p.locator(".plg-timeline-toolbar button", has_text=re.compile("^Jadwalkan ulang$")).first.click()
    pv = wait_pv(p)
    i9 = pv_info(pv)
    shot(p, "9-D9-jadwalkan-ulang.png")
    want_today = "Hari ini: " + short(mon)
    T = mon.isoformat()
    k1, k2, k3, k4 = ids["K1"], ids["K2"], ids["K3"], ids["K4"]
    k3_0 = server_all(base, u1)[k3]["start"]
    pv_apply(p)
    wait_until(lambda: len(puts_of("D9", s9)) >= 3, 15, 0.3)
    nap(2)
    srv = server_all(base, u1)
    info("9 jam peramban (CDP zona + clock) / pratinjau", [env, i9["today"], i9["summary"]])
    check("9a jam tetap %s WIB (CDP Emulation.setTimezoneOverride Asia/Jakarta + clock.set_system_time): Jadwalkan ulang '%s' → "
          "pratinjau '%s', 3 baris (K1, K2 belum mulai; K4 sudah mulai)" % (pin.isoformat(), PV_RESCHED, want_today),
          i9["title"] == PV_RESCHED and i9["today"] == want_today and sorted(int(k) for k in i9["keys"]) == sorted([k1, k2, k4])
          and env[1] == "Asia/Jakarta", repr((i9, env)))
    check("9b Terapkan → 3 PUT {ext_patch}; server: K1, K2 start %s (T, project Manual); K4 durasi 5 (sisa 2 hk sampai T+1); "
          "K3 tetap %s" % (T, k3_0), len(puts_of("D9", s9)) == 3 and all(set(x[2] or {}) == {"ext_patch"} for x in puts_of("D9", s9))
          and srv[k1]["start"] == T and srv[k2]["start"] == T and srv[k4]["duration"] == 5 and srv[k3]["start"] == k3_0,
          repr({k: (srv[k]["start"], srv[k]["duration"]) for k in (k1, k2, k3, k4)}))
    ctx.close()
    ctxs.remove(ctx)


# Render Timeline sendiri (definisi R24 1b, `PLUGIN_RENDER_JS` 1b) + waktu sampai sel Slack terisi (info).
PLUGIN_RENDER_JS = r"""(n) => new Promise(async (res) => {
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
    let slack = null;
    while (performance.now() - t0 < 10000) {
      if (Array.from(host.querySelectorAll('.plg-timeline-row:not(.is-group) .plg-timeline-col-slack')).some((x) => /\d/.test(x.textContent))) { slack = performance.now() - t0; break; }
      await sleep(2);
    }
    out.push({ dom, frame: fr, slack, rows: host.querySelectorAll('.plg-timeline-row').length, bars: host.querySelectorAll('.plg-timeline-bar').length });
    root.unmount();
  }
  host.remove();
  view.style.display = '';
  res({ runs: out });
})"""

# ctx mesin view (state useEngine {status: "ready", ctx, result}) dari fiber → engine.run (diekspos window.__tlPure).
ENGINE_JS = r"""(n) => {
  const c = document.getElementById('root')._reactRootContainer; const fr = c && (c._internalRoot || c);
  let ctx = null; const st = [fr && fr.current];
  while (st.length && !ctx) { const x = st.pop(); if (!x) continue; let h = x.memoizedState, g = 0;
    while (h && typeof h === 'object' && 'next' in h && g++ < 300) { const v = h.memoizedState;
      if (v && typeof v === 'object' && v.status === 'ready' && v.ctx && v.result && Array.isArray(v.ctx.tasks) && v.ctx.tasks.length >= 400) { ctx = v.ctx; break; }
      h = h.next; }
    if (x.sibling) st.push(x.sibling); if (x.child) st.push(x.child); }
  if (!ctx || !window.__tlPure) return { error: 'ctx/engine tidak ditemukan', ctx: !!ctx, pure: !!window.__tlPure };
  const ms = []; let r = null;
  for (let i = 0; i < n; i++) { const t0 = performance.now(); r = window.__tlPure.engine.run(ctx); ms.push(performance.now() - t0); }
  return { ms, tasks: ctx.tasks.length, nodes: r && r.nodes ? r.nodes.size : null, drift: r && r.drift ? r.drift.size : null };
}"""


def run_perf(browser, base, u2, ctxs):
    cp = new_ctx(browser, base)
    ctxs.append(cp)
    body = plugin_with_pure()
    got = []
    cp.route(re.compile(r"/static/plugins/timeline/plugin\.js(\?.*)?$"),
             lambda route: (got.append(1), route.fulfill(status=200, content_type="application/javascript", body=body)))
    d = c0.open_page(cp, base, u2, "P10")
    c0.sidebar_click(d, WS)
    btn = c0.view_btn(d, "Timeline")
    btn.wait_for(state="visible", timeout=20000)
    d.wait_for_timeout(1500)
    first = d.evaluate(hd_measure_js())
    info("10 klik pertama (memuat plugin.js, tanpa throttle) ms", {k: round(v, 1) for k, v in first.items()})
    d.locator(".plg-timeline-scroll").wait_for(state="visible", timeout=20000)
    wait_engine(d)
    cdp = cp.new_cdp_session(d)
    cdp.send("Emulation.setCPUThrottlingRate", {"rate": CPU_RATE})
    try:
        c0.view_btn(d, "Normal").click()
        d.locator(".plg-timeline").wait_for(state="detached", timeout=20000)
        d.wait_for_timeout(2500)
        second = d.evaluate(hd_measure_js())
        info("10 [info] klik kedua Normal → Timeline (CPU 4×, termasuk pembongkaran daftar host) ms", {k: round(v, 1) for k, v in second.items()})
        d.locator(".plg-timeline-scroll").wait_for(state="visible", timeout=20000)
        wait_engine(d)
        d.wait_for_timeout(1500)
        pr = d.evaluate(PLUGIN_RENDER_JS, 9)
        runs = pr.get("runs") or []
        frames = [round(x["frame"], 1) for x in runs]
        slacks = [round(x["slack"], 1) if x["slack"] is not None else None for x in runs]
        info("10 render Timeline sendiri (CPU 4×): frame ms / DOM ms / sampai sel Slack terisi ms (memuat daftar + mesin)",
             [frames, [round(x["dom"], 1) if x["dom"] is not None else None for x in runs], slacks])
        check("10a CPU 4×, plugin.js ter-cache: render Timeline sendiri (R24 1b: pasang view → Gantt pertama tergambar) median %s ms "
              "≤ %d ms" % (statistics.median(frames) if frames else None, RENDER_BUDGET),
              runs and all(x["dom"] is not None and x["bars"] > 0 for x in runs) and statistics.median(frames) <= RENDER_BUDGET,
              repr((frames, pr.get("error"))))
        wait_engine(d)
        eng = d.evaluate(ENGINE_JS, 9)
        e_ms = [round(x, 1) for x in eng.get("ms") or []]
        info("10 mesin engine.run (CPU 4×) ms per putaran, task, simpul, drift", [e_ms, eng.get("tasks"), eng.get("nodes"), eng.get("drift")])
        check("10b mesin lengkap (engine.run atas ctx view %s task, %s simpul; plugin.js diekspos %d kali) CPU 4× median %s ms ≤ %d ms"
              % (eng.get("tasks"), eng.get("nodes"), len(got), statistics.median(e_ms) if e_ms else None, ENGINE_BUDGET),
              got and e_ms and eng.get("tasks", 0) >= 500 and statistics.median(e_ms) <= ENGINE_BUDGET, repr(eng))
        crit = d.locator(".plg-timeline-toolbar button[aria-pressed]", has_text=re.compile("^Jalur kritis$")).first
        if crit.get_attribute("aria-pressed") != "true":
            crit.click()
        d.wait_for_timeout(1200)
        dom = d.evaluate("() => [document.querySelectorAll('.plg-timeline *').length, document.querySelectorAll('.plg-timeline-bar.is-critical').length, document.querySelector('.plg-timeline-scroll').getAttribute('aria-rowcount')]")
        mx = d.evaluate("""() => new Promise((res) => { const s = document.querySelector('.plg-timeline-scroll'); let maxDom = 0; const t0 = performance.now();
            const step = () => { const t = performance.now() - t0; s.scrollTop = Math.round(t); const n = document.querySelectorAll('.plg-timeline *').length;
              if (n > maxDom) maxDom = n; if (t < 2000) requestAnimationFrame(step); else res(maxDom); }; requestAnimationFrame(step); })""")
        info("10 DOM .plg-timeline * dengan Jalur kritis ON: diam, bar kritis, aria-rowcount, maks saat gulir 2 s", dom + [mx])
        check("10c Jalur kritis ON: DOM ≤ %d (diam %d, gulir maks %d), bar kritis tampil (%d)" % (DOM_BUDGET, dom[0], mx, dom[1]),
              0 < dom[0] <= DOM_BUDGET and 0 < mx <= DOM_BUDGET and dom[1] > 0 and int(dom[2]) >= 500)
        shot(d, "10-P10-jalur-kritis-500.png")
    finally:
        cdp.send("Emulation.setCPUThrottlingRate", {"rate": 1})
    cp.close()
    ctxs.remove(cp)
    # Pembanding mesin uji (bukan cek): Timeline 1.0.0 (patok PIN) pada data dan mesin yang sama, ukuran yang sama.
    ck = new_ctx(browser, base)
    ctxs.append(ck)
    served = []
    serve_pinned(ck, served)
    k = c0.open_page(ck, base, u2, "P10-1.0")
    c0.open_timeline(k, WS)
    k.wait_for_timeout(2000)
    cdk = ck.new_cdp_session(k)
    cdk.send("Emulation.setCPUThrottlingRate", {"rate": CPU_RATE})
    try:
        pk = k.evaluate(PLUGIN_RENDER_JS.replace("let slack = null;", "let slack = null; if (true) { out.push({ dom, frame: fr, slack, rows: 0, bars: host.querySelectorAll('.plg-timeline-bar').length }); root.unmount(); continue; }"), 9)
    finally:
        cdk.send("Emulation.setCPUThrottlingRate", {"rate": 1})
    kf = [round(x["frame"], 1) for x in pk.get("runs") or []]
    info("10 [pembanding] Timeline 1.0.0 (%s, %d berkas) render sendiri CPU 4× pada data yang sama: frame ms, median"
         % (PIN, len(served)), [kf, statistics.median(kf) if kf else None])
    ck.close()
    ctxs.remove(ck)


def hd_measure_js():
    return """() => new Promise((res) => {
  const btn = document.querySelector(".tl-view-btn[aria-label='Timeline']");
  let t1 = null; const t0 = performance.now();
  const done = () => { requestAnimationFrame(() => setTimeout(() => res({ dom: t1 - t0, frame: performance.now() - t0 }), 0)); };
  const mo = new MutationObserver(() => {
    if (t1 === null && document.querySelector('.plg-timeline-row:not(.is-group)')) { t1 = performance.now(); mo.disconnect(); done(); }
  });
  mo.observe(document.body, { childList: true, subtree: true });
  btn.click();
})"""


CONTRAST_JS = """(sel) => { const el = document.querySelector(sel); if (!el) return null;
    const parse = c => { const m = c.match(/rgba?\\(([^)]+)\\)/); if (!m) return null;
      const v = m[1].split(/[ ,\\/]+/).filter(Boolean).map(Number); return [v[0], v[1], v[2], v.length > 3 ? v[3] : 1]; };
    const lum = c => { const f = x => { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); };
      return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
    let bg = null; for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const c = parse(getComputedStyle(n).backgroundColor); if (c && c[3] > 0.5) { bg = c; break; } }
    if (!bg) bg = parse(getComputedStyle(document.body).backgroundColor) || [255, 255, 255, 1];
    const fg = parse(getComputedStyle(el).color);
    const a = lum(fg), b = lum(bg); return Math.round((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) * 100) / 100; }"""


PREC_JS = """() => new Promise((res) => { const rq = indexedDB.open('taskflow-offline'); rq.onsuccess = () => { const db = rq.result;
  const g = db.transaction('plugin_records').objectStore('plugin_records').getAll();
  g.onsuccess = () => { db.close(); res(g.result.filter(r => r.plugin_id === 'timeline').map(r => r.id)); }; }; })"""


def run_narrow_dark(browser, base, u1, ids, ctxs):
    # ── 12a 375 px ──
    cm, m = open_dev(browser, base, u1, "M", viewport=hd.MOBILE, mobile=True)
    ctxs.append(cm)
    s12 = time.time()
    n_rec0 = m.evaluate(PREC_JS)
    sync_now(m)  # perangkat baru: record plugin (unit project) baru ditarik pada sinkron berikutnya (pola 4e-0 1b)
    info("12 perangkat baru M: record Timeline lokal sebelum / sesudah sinkron kedua", [n_rec0, m.evaluate(PREC_JS)])
    c0.open_timeline(m, WS)
    wait_engine(m, slack=False)
    more = m.locator(".plg-timeline-more > button")
    more.wait_for(state="visible", timeout=15000)
    more.click()
    menu = m.locator(".plg-timeline-more-menu[role=menu]")
    menu.wait_for(state="visible", timeout=8000)
    items = menu.locator("[role^=menuitem]").all_inner_texts()
    geo1 = m.evaluate("() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]")
    box_js = """() => { const r = document.querySelector('.plg-timeline-more-menu').getBoundingClientRect();
        const b = document.querySelector('.plg-timeline-more > button').getBoundingClientRect();
        return { left: Math.round(r.left), right: Math.round(r.right), btn: Math.round(b.left),
          sw: document.documentElement.scrollWidth }; }"""
    g_box = m.evaluate(box_js)
    shot(m, "12-M-375-lainnya.png")
    check("12a 375 px: toolbar menu 'Lainnya' memuat Jadwal otomatis, Jalur kritis, Jadwalkan ulang; scrollWidth === 375",
          more.inner_text() == "Lainnya" and items == ["Jadwal otomatis", "Jalur kritis", "Jadwalkan ulang"] and geo1[0] == 375,
          repr((items, geo1)))
    m.keyboard.press("Escape")
    m.wait_for_timeout(300)
    m.get_by_role("radio", name="Daftar").click()
    m.locator(".plg-timeline-list").wait_for(state="visible", timeout=10000)
    more.click()
    menu.wait_for(state="visible", timeout=8000)
    l_box = m.evaluate(box_js)
    l_items = menu.locator("[role^=menuitem]").all_inner_texts()
    shot(m, "12-M-375-lainnya-daftar.png")
    m.keyboard.press("Escape")
    m.wait_for_timeout(300)
    check("12a-2 menu 'Lainnya' di dalam layar pada Gantt dan Daftar: tepi kiri ≥ 0, tepi kanan ≤ 375, scrollWidth 375 "
          "(Gantt %r, Daftar %r)" % (g_box, l_box),
          all(0 <= bx["left"] and bx["right"] <= 375 and bx["sw"] == 375 for bx in (g_box, l_box))
          and l_items == ["Jadwal otomatis", "Jadwalkan ulang"], repr((g_box, l_box, l_items)))
    a3 = ids["titles"][ids["alpha"][2]]
    m.locator(".plg-timeline-li", has_text=a3).first.click()
    sec = m.locator(".modal-content .plg-timeline-section:not([aria-busy='true'])")
    sec.wait_for(state="visible", timeout=15000)
    m.wait_for_timeout(800)
    t2 = m.evaluate("""() => { const s = document.querySelector('.modal-content .plg-timeline-section');
        return { chips: Array.from(s.querySelectorAll('.plg-timeline-chip')).map(x => x.textContent),
          range: (s.querySelector('.plg-timeline-sec-range') || {}).textContent || null,
          links: (s.querySelector('.plg-timeline-sec-links') || {}).textContent || null,
          sw: document.documentElement.scrollWidth }; }""")
    shot(m, "12-M-375-seksi-tingkat2.png")
    c0.close_modal(m)
    check("12b 375 px: detail task otomatis (α3) → seksi Jadwal tingkat 2 (chip 'Otomatis', rentang, 'menunggu …'); scrollWidth === 375",
          "Otomatis" in t2["chips"] and t2["range"] and "hari kerja" in t2["range"] and t2["links"] and "menunggu" in t2["links"]
          and t2["sw"] == 375, repr(t2))
    check("12c 375 px: 0 PUT / 0 POST records (lihat saja)", not puts_of("M", s12) and not recs_of("M", s12))
    cm.close()
    ctxs.remove(cm)

    # ── 12d Sakura gelap: garis kritis + banner drift (drift dibuat lewat API seperti klien 1.0, lalu dipulihkan) ──
    a4 = ids["alpha"][3]
    st0 = server_all(base, u1)[a4]["start"]
    hd.api(base, u1, "PUT", "/api/tasks/%d" % a4, json={"ext_patch": {PID + ".start": iso_add_wd(st0, 3)}})
    cs, sk = open_dev(browser, base, u1, "SK")
    ctxs.append(cs)
    sk.evaluate("() => { localStorage.setItem('tf_palette', 'sakura'); localStorage.setItem('tf_theme', 'dark'); }")
    sk.reload()
    hd.wait_dashboard_ready(sk)
    c0.wait_sync(sk)
    sk.evaluate("() => { window.__e2eNoReload = 1; }")
    s12d = time.time()
    c0.open_timeline(sk, WS)
    wait_engine(sk)
    crit = sk.locator(".plg-timeline-toolbar button[aria-pressed]", has_text=re.compile("^Jalur kritis$")).first
    if crit.get_attribute("aria-pressed") != "true":
        crit.click()
    sk.wait_for_timeout(1200)
    wait_until(lambda: drift_banner(sk), 10, 0.5)
    el = sk.evaluate("""() => { const c = document.querySelector('.plg-timeline-bar.is-critical'); const n = document.querySelector('.plg-timeline-bar:not(.is-critical)');
        return { pal: [document.documentElement.getAttribute('data-palette'), document.documentElement.getAttribute('data-theme')],
          crit: document.querySelectorAll('.plg-timeline-bar.is-critical').length, critArrows: document.querySelectorAll('.plg-timeline-arrow.is-critical').length,
          shadow: c ? getComputedStyle(c).boxShadow : null, shadowN: n ? getComputedStyle(n).boxShadow : null }; }""")
    ban = sk.evaluate(CONTRAST_JS, ".plg-timeline-banner-text")
    act = sk.evaluate(CONTRAST_JS, ".plg-timeline-banner-act")
    info("12 Sakura gelap: elemen kritis, kontras teks banner / tombol Tinjau", [el, ban, act])
    shot(sk, "12-SK-sakura-gelap-kritis-banner.png")
    check("12d Sakura gelap: bar kritis bergaris tepi (box-shadow ≠ bar biasa), panah kritis; banner drift tampil, teks kontras ≥ 4.5",
          el["pal"] == ["sakura", "dark"] and el["crit"] > 0 and el["critArrows"] > 0 and el["shadow"] not in (None, "none")
          and el["shadow"] != el["shadowN"] and drift_banner(sk) and (ban or 0) >= 4.5, repr((el, ban, drift_banner(sk))))
    check("12e Sakura gelap: 0 PUT / 0 POST records (drift ditampilkan, tidak ditulis)", not puts_of("SK", s12d) and not recs_of("SK", s12d))
    hd.api(base, u1, "PUT", "/api/tasks/%d" % a4, json={"ext_patch": {PID + ".start": st0}})
    cs.close()
    ctxs.remove(cs)


# ── seed ──────────────────────────────────────────────────────────────────────

def seed(base, db_path, mon):
    import sqlite3
    u1 = hd.seed(base, username="tc1a", display_name="Rani")
    u2 = hd.seed(base, username="tc1b", display_name="Sari")
    ws_id = hd.api(base, u1, "POST", "/api/lists", json={"name": WS})["id"]
    with sqlite3.connect(db_path) as conn:
        conn.execute("INSERT INTO list_members (list_id, user_id, joined_at) VALUES (?,?,?)",
                     (ws_id, u2["id"], datetime.datetime.now().isoformat()))
    sess = requests.Session()
    sess.headers["Authorization"] = "Bearer " + u1["token"]
    ids = {"ws": ws_id, "titles": {}, "p1": [], "p1m": [], "p2m": [], "p3m": [], "p1start": {}, "p2start": {}, "p3start": {}}
    n_dep = [0]
    types_used = {}

    def mk(title, project, start, dur, deps=(), list_id=ws_id, bucket=None, mover=None, **kw):
        ext = {PID + ".start": start, PID + ".duration": dur}
        if deps:
            ext[PID + ".deps"] = [{"t": {"$task": t}, "type": ty, "lag": lg} for t, ty, lg in deps]
            n_dep[0] += len(deps)
            for _, ty, _ in deps:
                types_used[ty] = types_used.get(ty, 0) + 1
        body = {"title": title, "gtd_status": "next", "priority": "P3", "project": project, "ext": ext}
        if list_id:
            body["list_id"] = list_id
        body.update(kw)
        r = sess.post(base + "/api/tasks", json=body, timeout=10)
        r.raise_for_status()
        tid = c0.task_id(r.json())
        ids["titles"][tid] = title
        if bucket:
            ids[bucket + "start"][tid] = start
            if bucket == "p1":
                ids["p1"].append(tid)
            if mover:
                ids[bucket + "m"].append(tid)
        return tid

    w = lambda n: wd(mon, n).isoformat()  # noqa: E731
    t_seed = time.time()
    # Alfa (60): rantai α, bintang β, pasangan SS, 7 akar Q dengan penerus FF + SF. Penerus = celah ≥ 3 hk dari hasil hitung.
    ids["R1"] = mk("Alfa akar satu", P1, w(0), 3, bucket="p1")
    ids["alpha"] = []
    prev = ids["R1"]
    for i in range(1, 6):
        prev = mk("Alfa rantai %d" % i, P1, w(6 * i + 2), 2, [(prev, "FS", 0)], bucket="p1", mover=True)
        ids["alpha"].append(prev)
    ids["R2"] = mk("Alfa akar dua", P1, w(1), 2, bucket="p1")
    ids["beta"] = [mk("Alfa cabang %02d" % j, P1, w(6 + j % 5), 1 + j % 3, [(ids["R2"], "FS", 0)], bucket="p1", mover=True)
                   for j in range(30)]
    ids["Sp"] = mk("Alfa SS induk", P1, w(2), 3, bucket="p1")
    ids["Ss"] = mk("Alfa SS anak", P1, w(8), 2, [(ids["Sp"], "SS", 1)], bucket="p1", mover=True)
    for k in range(7):
        q = mk("Alfa Q%d" % k, P1, w(k % 5), 2, bucket="p1")
        mk("Alfa Q%d FF" % k, P1, w(k % 5 + 8), 2, [(q, "FF", 0)], bucket="p1", mover=True)
        mk("Alfa Q%d SF" % k, P1, w(k % 5 + 8), 1, [(q, "SF", 0)], bucket="p1", mover=True)
    # Beta (240): 40 akar + 200 penerus (dep1 ke akar i%40, dep2 untuk i<100), semua tipe bergiliran.
    roots = [mk("Beta akar %02d" % r, P2, w(r % 10), 1 + r % 4) for r in range(40)]
    for i in range(200):
        deps = [(roots[i % 40], TYPES[i % 4], i % 3)]
        if i < 100:
            deps.append((roots[(i * 7 + 3) % 40], TYPES[(i + 1) % 4], 0))
        mk("Beta turunan %03d" % i, P2, w(20 + i % 5), 1 + i % 3, deps, bucket="p2", mover=True)
    # Gamma (200): 150 akar + 50 penerus (ke akar 3k).
    groots = [mk("Gamma akar %03d" % k, P3, w(k % 15), 1 + k % 3) for k in range(150)]
    for k in range(50):
        mk("Gamma turunan %02d" % k, P3, w(25 + k % 5), 2, [(groots[k * 3], TYPES[k % 4], 1)], bucket="p3", mover=True)
    # Pribadi (U1, Manual): K1/K2 belum mulai sebelum T, K3 sesudah T, K4 sudah mulai (progress 50) selesai sebelum T.
    d = lambda n: (mon + datetime.timedelta(days=n)).isoformat()  # noqa: E731
    ids["K1"] = mk("Pribadi lewat satu", PRIV, d(-7), 2, list_id=None)
    ids["K2"] = mk("Pribadi lewat dua", PRIV, d(-3), 1, list_id=None)
    ids["K3"] = mk("Pribadi nanti", PRIV, w(3), 2, list_id=None)
    ids["K4"] = mk("Pribadi berjalan", PRIV, d(-5), 3, list_id=None)
    hd.api(base, u1, "PUT", "/api/tasks/%d" % ids["K4"], json={"progress": 50})
    info("setup seed (detik, dependensi per tipe)", [round(time.time() - t_seed, 1), types_used])
    s1 = hd.api(base, u1, "PUT", "/api/plugins/state/%s" % PID, json={"enabled": True})
    s2 = hd.api(base, u2, "PUT", "/api/plugins/state/%s" % PID, json={"enabled": True})
    srv = server_all(base, u2)
    in_ws = [t for t in srv if t in ids["titles"] and t not in (ids["K1"], ids["K2"], ids["K3"], ids["K4"])]
    check("setup: U2 anggota W; Timeline ON U1+U2; W = 500 task + %d dependensi (FS/SS/FF/SF: %r); Alfa 60/50, Beta 200 penerus, "
          "Gamma 50 penerus; server TZ Etc/UTC" % (n_dep[0], types_used),
          s1["state"]["enabled"] and s2["state"]["enabled"] and len(in_ws) == 500 and n_dep[0] == 400
          and set(types_used) == set(TYPES) and len(ids["p1"]) == 60 and len(ids["p1m"]) == 50
          and len(ids["p2m"]) == 200 and len(ids["p3m"]) == 50)
    return {"u1": u1, "u2": u2}, ids


def console_checks():
    allowed = re.compile(r"Failed to load resource|net::ERR_")
    bad = [(dv, t, x[:220]) for dv, t, x in c0.console_log if t in ("error", "pageerror") and not allowed.search(x)]
    info("konsol: error/peringatan (perangkat, jenis, teks)", [(dv, t, x[:160]) for dv, t, x in c0.console_log
                                                               if t in ("error", "pageerror", "warning")][:20])
    check("12f konsol tanpa error selain request offline/di-abort yang disengaja", not bad, repr(bad[:6]))


def main():
    if os.environ.get("TZ") != "Asia/Jakarta":
        print("PERINGATAN: jalankan dengan TZ=Asia/Jakarta", flush=True)
    if os.path.isdir(SHOTS):
        for fn in os.listdir(SHOTS):
            if re.match(r"^\d+-.*\.png$", fn):
                os.remove(os.path.join(SHOTS, fn))
    tmp = tempfile.mkdtemp(prefix="e2e_plugin_fase1_1c1_")
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
    mon = c0.next_monday(datetime.date.today())
    try:
        users, ids = seed(base, db_path, mon)
        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            run(browser, base, users, ids, mon)
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
