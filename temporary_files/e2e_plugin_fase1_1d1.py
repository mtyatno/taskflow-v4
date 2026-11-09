"""E2E PR 1d-1 (Timeline 1.3: Beban Tim — kapasitas/cuti, hari merah, saran leveling, editor ber-CAS). Rencana
docs/superpowers/plans/2026-11-09-plugin-fase1-pr-1d-1.md Task 11 Step 1 (Review Focus 1–5; R1, R4, R5, R7, R9–R11;
P2 (a), P3 (a)). Tidak dijalankan CI.

    E2E_PYTHON=$(which python3) TZ=Asia/Jakarta python3 temporary_files/e2e_plugin_fase1_1d1.py
    E2E_SKIP=perf ...   # lewati skenario 10 (kinerja) saat iterasi

Memakai helper `e2e_plugin_fase1_1c0.py` + `e2e_plugin_fase1_1c1.py` (server uvicorn lokal `webapp:app` + DB SQLite
sementara + Chromium; tiap "perangkat" = satu `browser.new_context(service_workers="block")`, IndexedDB terpisah). Server
dijalankan dengan `TZ=Etc/UTC` (paritas VPS); peramban dan skrip memakai Asia/Jakarta. Spy tulisan: setiap request non-GET
ke /api/ dicatat per perangkat (`page.on("request")`); "tulisan data" = /api/tasks* (ext/inti) dan
POST /api/plugins/timeline/records.

Pengguna: U1 "Rani" (pemilik W "Ruang Beban" + WP "Ruang Kinerja"; perangkat A, Z (jam palsu 23:57 WIB), M (375 px
Sakura gelap), P10 (kinerja)), U2 "Sari" (anggota; perangkat B, OLD = klien 1.2 dipatok ebf829c), U3 "Tono" (anggota;
perangkat N = perangkat baru, tarik record diblokir), U4 "Dewi" (anggota; hanya API = "perangkat lain"), 6 anggota WP
tambahan (kinerja 10 orang).

Seed W (T = hari kerja pertama ≥ hari ini; w(n) = hari kerja ke-n dari T):
  Alfa (Manual): "Alfa panjang" Rani w0+12 hk 12 🍅; "Alfa brosur" Tono w4+2 hk 4 🍅 (slack 6 hk); "Alfa desain" Sari
  w1+3 hk 3 🍅. Beta (Otomatis, dinyalakan lewat UI di setup): "Beta pondasi" Dewi w0+2 hk 4 🍅 → "Beta rangka" (FS) Dewi
  disimpan w4 (ES mesin w2 → drift) 2 hk 6 🍅. Gamma (Manual): "Gamma laporan" Dewi w−5+2 hk (terlambat) 7 🍅 − 2 selesai;
  "Gamma uji" Dewi w−2+5 hk ber-actual.start 5 🍅; "Gamma rilis besar" Dewi w1+4 hk 24 🍅; "Gamma audit" Dewi w30+2 hk
  2 🍅 (hari merah jauh di kanan, untuk Tab). Delta: "Delta rapat" tanpa penanggung jawab w1 2 🍅. Pribadi (project
  pribadi U1): "Pribadi ringkas" w0+2 hk 3 🍅. WP: Kappa 300 + Lambda 200 task, 400 dependensi FS/SS/FF/SF, 10 orang.

   1 nol tulisan latar: A dan B membuka panel Beban Tim, 2 siklus sinkron, tutup/buka panel → 0 tulis, record resource
     tidak dibuat (server + IndexedDB); Z (jam palsu 23:57 WIB, plugin.js berekspor) panel terbuka → jam maju lewat tengah
     malam → app.dayChanged + sinkron → 0 tulis; Dewi (API, perangkat lain) menulis kapasitas 0 → A/B tarik → panel memuat
     ulang ("Dewi · 0 🍅/hari"), 0 tulis.
   2 dua anggota: A ubah kapasitas Sari 4 → Simpan → 1 item record res@list:W:Sari; B tarik → "Sari · 4 🍅/hari" +
     "Diubah oleh Rani · {tgl}"; CAS: A dan B membuka editor Sari, A simpan 6, B tarik lalu simpan 5 → "Data berubah sejak
     dialog dibuka — muat ulang", 0 tulis B; "Muat ulang" → 6.
   3 perangkat baru N (U3, IndexedDB kosong, tarik record diblokir) → editor Sari terkunci "Menunggu data workspace…",
     Simpan nonaktif; tarik dibuka → editor terbuka (6 + "Diubah oleh Rani").
   4 A: cuti Tono di w4 (editor) → hari merah "Tono · {w4}: 2 dari 0 🍅 (~1 jam)" → klik → popover "Bisa digeser — Tono,
     {w4}" berisi "Alfa brosur · 2 🍅 hari ini · slack 6 hk" → klik → Gantt tergulir + bar is-flash 1,5 dtk → seret bar
     +4 hari → merah hilang.
   5 beban = bar (R1): hari merah Dewi (kapasitas 0) dari daftar "Hari kelebihan beban" + aria-label tombol = hitungan
     manual dari tanggal bar (aria-label bar) — drift Beta rangka, task Manual, terlambat (sisa di T), berjalan ber-actual.start,
     target 24; readout hover baris Rani.
   6 filter panel ("Cari task" = Beta) menyembunyikan Gamma → beban Dewi tetap; popover hari ini (Kritis/Sudah mulai/
     terlambat + "Tidak ada task yang bisa digeser…") → klik task tersaring → detail task terbuka, Gantt tidak digulir.
   7 project pribadi: satu baris "Rani · 8 🍅/hari" + "Hanya beban dari project ini"; workspace: Dewi, Rani, Sari, Tono,
     "Belum ditugaskan" terakhir, tanpa catatan. 7c (info, bukan cek): setelah navigasi Pribadi → W, viewW panel = vp.w
     view yang terukur di tengah animasi wadah host (temuan PRA-ADA, sama di origin/main) — karena itu 9b–9c dijalankan
     sebelum navigasi ini.
   8 klien 1.2 (OLD, U2; index.html, whatsnew.json, plugins/index.json, plugins/timeline/plugin.js + style.css dari ebf829c)
     + record resource di server → Timeline 1.2.0 tanpa galat, 0 tulis, record resource server utuh.
   9 tampilan: 1280 px terang (A) zoom Hari/Minggu/Bulan (tangkapan, DOM), sejajar Gantt setelah gulir horizontal dan Tab
     ke tombol hari merah di luar layar; 375 px Sakura gelap (M) daftar + chip, tanpa gulir horizontal, editor muat;
     review akhir I1: menyalakan Beban Tim lewat "Lainnya" (Gantt 9h, Daftar 9i) → judul daftar di dalam viewport.
  10 kinerja (P10, U1, WP 500/400/10 orang, CPU 4×): TLLoad.run (engine.load dibungkus lewat window.__tlPure) ≤ 20 ms,
     panel tertutup = 0 run, DOM .plg-timeline * ≤ 1.500 dengan panel terbuka di tiga zoom.
  11 konsol tanpa galat aplikasi.
"""
import datetime
import json
import math
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
import e2e_plugin_fase1_1c1 as c1  # noqa: E402  (memasang c1.watch ke c0.watch)

SHOTS = c0.SHOTS = os.path.join(hd.ROOT, "temporary_files", "e2e_plugin_fase1_1d1")
PIN = "ebf829c"  # merge PR #128 (1d-0) = Timeline 1.2.0, SW v500 (bukan ref bergerak)
PID = c0.PID
WS, WP, PRIV = "Ruang Beban", "Ruang Kinerja", "Pribadi"
TYPES = ["FS", "SS", "FF", "SF"]
CPU_RATE = 4
LOAD_BUDGET, DOM_BUDGET, PANEL_DOM_BUDGET = 20, 1500, 300
JKT = datetime.timezone(datetime.timedelta(hours=7))
MSG_WAIT = "Menunggu data workspace…"
MSG_STALE = "Data berubah sejak dialog dibuka — muat ulang"
MSG_PARTIAL = "Hanya beban dari project ini"
MSG_SUG_EMPTY = "Tidak ada task yang bisa digeser tanpa menggeser jalur kritis"
RECS_PULL_RE = re.compile(r"/api/plugins/%s/records\?cursor=" % PID)
SKIP = set(x.strip() for x in os.environ.get("E2E_SKIP", "").split(",") if x.strip())

check, info, nap, wait_until = hd.check, c0.info, c0.nap, c0.wait_until
sync_now, shot, short = c0.sync_now, c0.shot, c1.short

# ── tanggal (Sen–Jum, libur nasional di rentang uji) ─────────────────────────
HOLI = {"2026-12-24", "2026-12-25", "2027-01-01"}
TODAY = datetime.datetime.now(JKT).date()


def is_work(d):
    return d.weekday() < 5 and d.isoformat() not in HOLI


def next_work(d):
    while not is_work(d):
        d += datetime.timedelta(days=1)
    return d


T0 = next_work(TODAY)  # = TLCal.nextWork(cal, hari ini)


def w(n):
    """Hari kerja ke-n dari T0 (n negatif = mundur)."""
    d, step = T0, (1 if n >= 0 else -1)
    while n:
        d += datetime.timedelta(days=step)
        if is_work(d):
            n -= step
    return d


def iso(d):
    return d.isoformat()


SHORT2DATE = {short(TODAY + datetime.timedelta(days=k)): TODAY + datetime.timedelta(days=k) for k in range(-90, 200)}


def js_round(x):
    return math.floor(x + 0.5)


def fmt_num(h):
    return str(int(h)) if float(h).is_integer() else ("%g" % h)


def fmt_pomo(milli, up=False):
    """Cermin TLLoad.fmtPomo: kelipatan 0,5 (hari merah dibulatkan ke atas), beban > 0 minimal 0.5."""
    h = math.ceil(milli / 500) / 2 if up else js_round(milli / 500) / 2
    if milli > 0 and h < 0.5:
        h = 0.5
    return fmt_num(h)


def hours_label(pomo):
    """Cermin TLLoad.hoursLabel / pomologic.estimateHoursLabel."""
    return "~%s jam" % fmt_num(js_round(pomo * 25 / 60 * 2) / 2)


def distribute(spans, T):
    """Hitungan manual beban (R1, R8): spans = [(s, f, sisa)] dari tanggal BAR; terlambat (f < T) → seluruh sisa di T;
    selain itu dibagi rata ke hari kerja [maks(T, s), f], sisa bagi +1 ke hari paling awal. Hasil milipomodoro per hari."""
    out = {}
    for s, f, sisa in spans:
        if sisa <= 0:
            continue
        if f < T:
            days = [T]
        else:
            days, d = [], max(T, s)
            while d <= f:
                if is_work(d):
                    days.append(d)
                d += datetime.timedelta(days=1)
        R, n = sisa * 1000, len(days)
        base, rem = R // n, R - (R // n) * n
        for i, d in enumerate(days):
            out[d] = out.get(d, 0) + base + (1 if i < rem else 0)
    return out


# ── spy tulisan: semua request non-GET ke /api/ per perangkat ────────────────
WRITES = []  # (perangkat, method, path, body, t)
_prev_watch = c0.watch


def my_watch(p, label):
    _prev_watch(p, label)

    def on_req(r):
        if r.method == "GET":
            return
        m = re.match(r"^https?://[^/]+(/api/[^?#]*)", r.url)
        if not m:
            return
        try:
            body = r.post_data_json
        except Exception:  # noqa: BLE001
            body = None
        WRITES.append((label, r.method, m.group(1), body, time.time()))
    p.on("request", on_req)


c0.watch = my_watch  # c0.open_page memanggil c0.watch


def is_data_write(x):
    return x[2].startswith("/api/tasks") or re.match(r"^/api/plugins/[^/]+/records$", x[2]) is not None


def writes(labels, since):
    """Tulisan data (task/ext/records) perangkat `labels` sejak `since`: [(perangkat, method, path)]."""
    return [(x[0], x[1], x[2]) for x in WRITES if x[0] in labels and x[4] >= since and is_data_write(x)]


def other_writes(labels, since):
    return sorted(set((x[0], x[1], x[2]) for x in WRITES if x[0] in labels and x[4] >= since and not is_data_write(x)))


def res_items(label, since):
    """Item record entitas resource yang di-POST perangkat `label` sejak `since`."""
    out = []
    for x in WRITES:
        if x[0] != label or x[4] < since or x[1] != "POST" or not re.match(r"^/api/plugins/%s/records$" % PID, x[2]):
            continue
        for it in ((x[3] or {}).get("items") or []):
            if it.get("entity") == "resource":
                out.append(it)
    return out


def task_puts(label, since, tid=None):
    return [x[3] for x in WRITES if x[0] == label and x[4] >= since and x[1] == "PUT"
            and re.match(r"^/api/tasks/(\d+)$", x[2]) and (tid is None or x[2] == "/api/tasks/%d" % tid)]


# Toast (teks persis) + event bus plugin (app.dayChanged) per halaman.
MY_INIT = r"""(() => { window.__toasts = []; window.__ev = [];
  const RX = /(Kapasitas \S+ disimpan|Data berubah sejak dialog dibuka — muat ulang|Gagal menyimpan kapasitas|Data kapasitas terlalu besar — kurangi cuti atau catatannya|Jadwal diubah · \d+ task ikut bergeser|Jadwal otomatis menyala — tidak ada task yang bergeser)/;
  const scan = (t) => { if (!t || t.length > 400) return; const m = t.match(RX); if (m) window.__toasts.push([m[1], Date.now()]); };
  new MutationObserver((ms) => { for (const m of ms) { if (m.type === 'characterData') scan(m.target.textContent);
    for (const n of m.addedNodes || []) scan(n.textContent); } }).observe(document, { childList: true, subtree: true, characterData: true });
  const iv = setInterval(() => { const E = window.TF && window.TF.events; if (window.__evOn || !E || typeof E.on !== 'function') return;
    window.__evOn = true; clearInterval(iv);
    E.on('app.dayChanged', (p) => window.__ev.push(['app.dayChanged', p && p.date ? p.date : null, Date.now()])); }, 20);
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


# ── server ────────────────────────────────────────────────────────────────────

def server_tasks(base, user):
    r = hd.api(base, user, "GET", "/api/tasks?include_done=true")
    items = r if isinstance(r, list) else r.get("tasks", [])
    out = {}
    for t in items:
        e = t.get("ext") or {}
        if isinstance(e, str):
            e = json.loads(e or "{}")
        out[t["id"]] = {"ext": {k[len(PID) + 1:]: v for k, v in e.items() if k.startswith(PID + ".")}, "title": t.get("title"),
                        "est": t.get("estimated_pomodoros"), "done": t.get("pomodoros_done"), "assigned_to": t.get("assigned_to")}
    return out


def server_res(base, user):
    """Record resource di server yang terlihat `user` (semua scope): id → {data, updated_at, version, scope}."""
    r = hd.api(base, user, "GET", "/api/plugins/%s/records?limit=1000" % PID)
    return {x["id"]: {"data": x.get("data"), "updated_at": x.get("updated_at"), "version": x.get("version"), "scope": x.get("scope")}
            for x in r.get("items", []) if x.get("entity") == "resource" and not x.get("deleted")}


def res_id(lid, uid):
    return "res@list:%d:%d" % (lid, uid)


def post_res(base, user, lid, uid, data):
    ua = datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    return hd.api(base, user, "POST", "/api/plugins/%s/records" % PID, json={"items": [
        {"entity": "resource", "id": res_id(lid, uid), "scope": "list:%d" % lid, "data": data, "updated_at": ua}]})


LOCAL_RES_JS = """() => new Promise((res) => { const rq = indexedDB.open('taskflow-offline'); rq.onerror = () => res(null);
  rq.onsuccess = () => { const db = rq.result; const g = db.transaction('plugin_records').objectStore('plugin_records').getAll();
    g.onsuccess = () => { db.close(); res(g.result.filter(r => r.plugin_id === 'timeline' && String(r.id).indexOf('res@') === 0).map(r => r.id)); }; }; })"""


# ── panel Beban Tim ───────────────────────────────────────────────────────────

PANEL_JS = """() => { const s = document.querySelector('.plg-timeline-load, .plg-timeline-load-m'); if (!s) return null;
  const t = (q) => { const e = s.querySelector(q); return e ? e.textContent : null; };
  return { m: s.classList.contains('plg-timeline-load-m'), head: t('.plg-timeline-load-head'), note: t('.plg-timeline-load-note'),
    names: Array.from(s.querySelectorAll('.plg-timeline-load-name, .plg-timeline-load-m-person')).map(x => x.textContent),
    hits: Array.from(s.querySelectorAll('.plg-timeline-load-hit')).map(x => x.getAttribute('aria-label')),
    days: Array.from(s.querySelectorAll('.plg-timeline-load-m-day')).map(x => x.textContent),
    svgs: s.querySelectorAll('svg').length, paths: s.querySelectorAll('path').length, dom: s.querySelectorAll('*').length + 1,
    all: document.querySelectorAll('.plg-timeline *').length, sw: document.documentElement.scrollWidth, iw: window.innerWidth }; }"""


def panel(p):
    return p.evaluate(PANEL_JS)


# Review akhir I1: kotak judul panel/daftar Beban Tim terhadap viewport + posisi "alami" (top + jumlah scrollTop semua
# leluhur = posisi bila halaman di paling atas; > innerHeight berarti tanpa gulir otomatis judul berada di bawah lipatan).
HEAD_VIEW_JS = """() => { const s = document.querySelector('.plg-timeline-load, .plg-timeline-load-m'); if (!s) return null;
  const h = s.querySelector('.plg-timeline-load-head'); const r = h.getBoundingClientRect(); let off = 0;
  for (let e = s.parentElement; e; e = e.parentElement) off += e.scrollTop || 0;
  return { top: Math.round(r.top), bottom: Math.round(r.bottom), ih: window.innerHeight, off: Math.round(off),
    natural: Math.round(r.top + off), inside: r.top >= 0 && r.bottom <= window.innerHeight }; }"""
SCROLL_TOP_JS = """() => { for (const e of [document.scrollingElement].concat(Array.from(document.querySelectorAll('*'))))
  if (e && e.scrollTop) e.scrollTop = 0; }"""


def head_view(p):
    return p.evaluate(HEAD_VIEW_JS)


def names(p):
    st = panel(p)
    return st["names"] if st else []


def hits(p):
    st = panel(p)
    return st["hits"] if st else []


def more_menu_items(p):
    more = p.locator(".plg-timeline-more > button")
    more.wait_for(state="visible", timeout=20000)
    menu = p.locator(".plg-timeline-more-menu[role=menu]")
    if not menu.count():
        more.click()
    menu.wait_for(state="visible", timeout=8000)
    return menu, menu.locator("[role^=menuitem]").all_inner_texts()


def panel_on(p, on=True):
    """Nyalakan/matikan Beban Tim (pref load:<page>, lokal): tombol toolbar, atau item "Lainnya" (≤ 640 px / Live Edit)."""
    p.wait_for_function("() => !!document.querySelector('.plg-timeline-loadbtn, .plg-timeline-more')", timeout=40000)
    if p.locator(".plg-timeline-toolbar .plg-timeline-loadbtn").count():
        b = p.locator(".plg-timeline-toolbar .plg-timeline-loadbtn").first
        if (b.get_attribute("aria-pressed") == "true") != on:
            b.click()
    else:
        menu, _ = more_menu_items(p)
        it = menu.locator("[role=menuitemcheckbox]", has_text=re.compile("^Beban Tim$")).first
        if (it.get_attribute("aria-checked") == "true") != on:
            it.click()
        else:
            p.keyboard.press("Escape")
    sel = p.locator(".plg-timeline-load, .plg-timeline-load-m").first
    if on:
        sel.wait_for(state="visible", timeout=30000)
    else:
        sel.wait_for(state="detached", timeout=15000)
    p.wait_for_timeout(400)


def name_btn(p, who):
    return p.locator(".plg-timeline-load-name, .plg-timeline-load-m-person", has_text=re.compile("^" + re.escape(who) + " · ")).first


ED_JS = """() => { const e = document.querySelector('.plg-timeline-res-pop'); if (!e) return null;
  const q = (s) => e.querySelector(s); const tx = (s) => { const x = q(s); return x ? x.textContent : null; };
  const save = q('.plg-timeline-res-save'); const cap = q('.plg-timeline-res-cap-input');
  const st = q('.plg-timeline-res-stale .plg-timeline-pop-err');
  return { title: e.getAttribute('aria-label'), busy: e.getAttribute('aria-busy'), by: tx('.plg-timeline-res-by'), wait: tx('.plg-timeline-pop-wait'),
    cap: cap ? cap.value : null, capDisabled: cap ? cap.disabled : null, saveDisabled: save ? save.disabled : null,
    rows: Array.from(e.querySelectorAll('.plg-timeline-res-row')).map(r => [r.querySelector('.plg-timeline-res-from').value,
      r.querySelector('.plg-timeline-res-to').value, r.querySelector('.plg-timeline-res-note').value]),
    stale: st ? st.textContent : null, reload: !!Array.from(e.querySelectorAll('button')).find(b => b.textContent === 'Muat ulang'),
    errs: Array.from(e.querySelectorAll('.plg-timeline-pop-err')).map(x => x.textContent) }; }"""


def ed_state(p):
    return p.evaluate(ED_JS)


def open_editor(p, who):
    name_btn(p, who).click()
    ed = p.locator(".plg-timeline-res-pop")
    ed.wait_for(state="visible", timeout=10000)
    return ed


def ed_ready(p, timeout=20):
    return wait_until(lambda: (lambda s: s if s and s["busy"] == "false" else None)(ed_state(p)), timeout, 0.3)


def close_editor(p):
    p.locator(".plg-timeline-res-pop").get_by_role("button", name="Batal", exact=True).click()
    p.locator(".plg-timeline-res-pop").wait_for(state="detached", timeout=8000)


def save_editor(p):
    p.locator(".plg-timeline-res-pop .plg-timeline-res-save").click()
    p.locator(".plg-timeline-res-pop").wait_for(state="detached", timeout=15000)


POP_JS = """() => { const e = document.querySelector('.plg-timeline-load-pop'); if (!e) return null; const r = e.getBoundingClientRect();
  return { title: e.getAttribute('aria-label'), note: (e.querySelector('.plg-timeline-pop-note') || {}).textContent || null,
    items: Array.from(e.querySelectorAll('.plg-timeline-load-sug-btn')).map(b => [(b.querySelector('.plg-timeline-load-sug-text') || {}).textContent || null,
      (b.querySelector('.plg-timeline-load-sug-kind') || {}).textContent || null]),
    box: [Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom)], iw: innerWidth, ih: innerHeight }; }"""


def pop_state(p):
    return p.evaluate(POP_JS)


def hit(p, label):
    return p.locator(".plg-timeline-load-hit[aria-label='%s']" % label.replace("'", "\\'"))


SCROLL_JS = """(key) => { const s = document.querySelector('.plg-timeline-scroll'); const sr = s.getBoundingClientRect();
  const b = key ? document.querySelector(".plg-timeline-bar[data-key='" + key + "']") : null; const br = b ? b.getBoundingClientRect() : null;
  const tb = document.querySelector('.plg-timeline-table'); const tw = tb ? tb.getBoundingClientRect().width : 0;
  return { st: s.scrollTop, sl: s.scrollLeft, cw: s.clientWidth, ch: s.clientHeight, sLeft: sr.left, sTop: sr.top, tw,
    bLeft: br ? br.left : null, bTop: br ? br.top : null, flash: b ? b.classList.contains('is-flash') : null,
    rowFlash: key ? !!document.querySelector(".plg-timeline-row.is-flash[data-key='" + key + "']") : null,
    active: document.activeElement ? document.activeElement.getAttribute('data-key') : null }; }"""


def scroll_state(p, key=None):
    return p.evaluate(SCROLL_JS, str(key) if key is not None else None)


def bar_label(p, tid):
    c1.reveal(p, tid)
    return p.evaluate("(k) => { const b = document.querySelector(\".plg-timeline-bar[data-key='\" + k + \"']\"); return b ? b.getAttribute('aria-label') : null; }", str(tid))


BAR_RE = re.compile(r"^(.*), (\S+ \d+ \S+) sampai (\S+ \d+ \S+), (\d+) hari kerja")


def bar_span(label):
    m = BAR_RE.match(label or "")
    return (SHORT2DATE.get(m.group(2)), SHORT2DATE.get(m.group(3)), int(m.group(4))) if m else (None, None, None)


# engine.load (satu pintu TLLoad.run) dibungkus lewat window.__tlPure (plugin.js berekspor, hanya konteks Z dan P10).
WRAP_JS = """() => { const P = window.__tlPure; if (!P || !P.engine) return false; if (P.engine.__e2e) return true;
  const orig = P.engine.load; window.__loadRuns = []; window.__loadOrig = orig;
  P.engine.load = function (input) { const t0 = performance.now(); const r = orig(input); const ms = performance.now() - t0;
    window.__loadRuns.push({ ms, D: input ? input.D : null, tasks: input && input.tasks ? input.tasks.length : null,
      people: input && input.people ? input.people.length : null, rows: r && r.rows ? r.rows.length : null,
      over: r && r.rows ? r.rows.reduce((s, x) => s + x.overDays.length, 0) : null }); window.__loadLast = input; return r; };
  P.engine.__e2e = true; return true; }"""


def load_runs(p):
    return p.evaluate("() => window.__loadRuns || []")


def pure_route(ctx, served=None):
    body = c1.plugin_with_pure()
    ctx.route(re.compile(r"/static/plugins/timeline/plugin\.js(\?.*)?$"),
              lambda route: ((served.append(1) if served is not None else None),
                             route.fulfill(status=200, content_type="application/javascript", body=body)))


# ── klien 1.2 dipatok ebf829c ─────────────────────────────────────────────────

def pinned(path):
    return subprocess.run(["git", "show", PIN + ":" + path], cwd=hd.ROOT, check=True, capture_output=True).stdout


OLD_FILES = [  # (regex URL, tipe, berkas) — semua berkas static yang berbeda ebf829c ↔ HEAD selain sw.js (SW diblokir) + load.js (baru)
    (r"^http://127\.0\.0\.1:\d+/(\?.*)?$", "text/html", "static/index.html"),
    (r"/static/whatsnew\.json(\?.*)?$", "application/json", "static/whatsnew.json"),
    (r"/static/plugins/index\.json(\?.*)?$", "application/json", "static/plugins/index.json"),
    (r"/static/plugins/timeline/plugin\.js(\?.*)?$", "application/javascript", "static/plugins/timeline/plugin.js"),
    (r"/static/plugins/timeline/style\.css(\?.*)?$", "text/css", "static/plugins/timeline/style.css"),
]


def old_sw():
    return re.search(r'^const CACHE = "([^"]+)";', pinned("static/sw.js").decode(), re.M).group(1)


# ── skenario utama (A, B, Z, N) ───────────────────────────────────────────────

def run(browser, base, users, ids):
    ua, ub, uc, ud = (users[k] for k in ("a", "b", "c", "d"))
    lid = ids["ws"]
    F, P, Q, G1, G2, G3, G4 = (ids[k] for k in ("F", "P", "Q", "G1", "G2", "G3", "G4"))
    dewi_tasks = [G1, G2, G3, G4, P, Q]
    ctxs = []
    try:
        ca, a = open_dev(browser, base, ua, "A")
        ctxs.append(ca)
        cb, b = open_dev(browser, base, ub, "B")
        ctxs.append(cb)

        # ── setup: Otomatis Beta lewat UI (A), lalu drift Beta rangka lewat API ──
        c0.open_timeline(a, WS)
        c1.wait_engine(a)
        s0 = time.time()
        c1.toggle_unit(a, "Beta")
        pv = wait_until(lambda: a.locator(".plg-timeline-pv").count() > 0, 4, 0.3)
        if pv:
            info("setup pratinjau Otomatis Beta (tak terduga — diterapkan)", c1.pv_info(a.locator(".plg-timeline-pv")))
            c1.pv_apply(a)
        a.keyboard.press("Escape")
        sync_now(a)
        prj = wait_until(lambda: [x for x in WRITES if x[0] == "A" and x[4] >= s0 and x[1] == "POST" and "records" in x[2]], 15, 0.3)
        hd.api(base, ua, "PUT", "/api/tasks/%d" % Q, json={"ext_patch": {PID + ".start": iso(w(4))}})
        sync_now(a)
        c0.refresh_tasks(a)
        c1.wait_engine(a)
        drift = wait_until(lambda: c1.drift_banner(a), 15, 0.5)
        check("setup: A menyalakan Otomatis Beta (UI, record project POST, tanpa pratinjau); Beta rangka digeser ke %s lewat API "
              "→ banner drift 1 task (ES mesin %s)" % (short(w(4)), short(w(2))),
              prj and not pv and drift == ["Jadwal otomatis belum mutakhir: 1 task berbeda dari hasil hitung."], repr((prj, pv, drift)))

        # ── 1 nol tulisan latar ──
        s1 = time.time()
        sync_now(b)
        c0.open_timeline(b, WS)
        c1.wait_engine(b)
        panel_on(a)
        panel_on(b)
        want_rows0 = ["Dewi · 8 🍅/hari", "Rani · 8 🍅/hari", "Sari · 8 🍅/hari", "Tono · 8 🍅/hari", "Belum ditugaskan"]
        wait_until(lambda: names(a) == want_rows0 and names(b) == want_rows0, 20, 0.4)
        for _ in range(2):
            for p in (a, b):
                sync_now(p)
        c0.refresh_tasks(a)
        c0.refresh_tasks(b)
        nap(1.5)
        panel_on(a, False)
        panel_on(a, True)
        wait_until(lambda: names(a) == want_rows0, 15, 0.3)
        st_a, st_b = panel(a), panel(b)
        nap(1)
        w1 = writes(("A", "B"), s1)
        srv_res1 = server_res(base, ua)
        loc1 = [a.evaluate(LOCAL_RES_JS), b.evaluate(LOCAL_RES_JS)]
        shot(a, "1-A-panel-beban-tim.png")
        info("1 tulisan non-data A/B (bukan task/records)", other_writes(("A", "B"), s1))
        check("1a A dan B: buka panel Beban Tim + 2 siklus sinkron + tutup/buka panel → 0 tulis task/ext/records (%r); baris %r; "
              "judul '%s'" % (w1, st_a["names"], st_a["head"]),
              not w1 and st_a["names"] == want_rows0 and st_b["names"] == want_rows0
              and st_a["head"] == "Beban Tim · 3 hari kelebihan beban" and st_b["head"] == st_a["head"], repr((st_a, st_b)))
        check("1b record resource TIDAK dibuat otomatis: server 0 record resource, IndexedDB A/B 0 record res@ (%r / %r)"
              % (list(srv_res1), loc1), srv_res1 == {} and loc1 == [[], []], repr((srv_res1, loc1)))
        run_day_change(browser, base, ua, ctxs)
        # perangkat lain (Dewi, API) menulis kapasitas 0 → A/B tarik → panel memuat ulang
        s1c = time.time()
        post_res(base, ud, lid, ud["id"], {"v": 1, "capacity": 0, "leave": [], "by": ud["id"]})
        for p in (a, b):
            sync_now(p)
        ok1c = wait_until(lambda: "Dewi · 0 🍅/hari" in names(a) and "Dewi · 0 🍅/hari" in names(b), 20, 0.4)
        for p in (a, b):
            sync_now(p)
        nap(1.5)
        st1c = panel(a)
        w1c = writes(("A", "B"), s1c)
        check("1d Dewi (perangkat lain, API) menulis kapasitas 0 → A dan B tarik → panel memuat ulang 'Dewi · 0 🍅/hari', judul '%s' "
              "→ 0 tulis A/B (%r); server hanya %r" % (st1c["head"], w1c, list(server_res(base, ua))),
              ok1c and not w1c and list(server_res(base, ua)) == [res_id(lid, ud["id"])]
              and st1c["head"] == "Beban Tim · 8 hari kelebihan beban", repr((st1c, w1c)))
        shot(a, "1-A-dewi-kapasitas-0.png")

        # ── 2 dua anggota: A ubah kapasitas Sari ──
        sari_id = res_id(lid, ub["id"])
        s2, t2 = time.time(), now_ms(a)
        open_editor(a, "Sari")
        st2o = ed_ready(a)
        a.locator(".plg-timeline-res-pop .plg-timeline-res-cap-input").fill("4")
        shot(a, "2-A-editor-sari-4.png")
        save_editor(a)
        sync_now(a)
        wait_until(lambda: res_items("A", s2), 15, 0.3)
        it2 = res_items("A", s2)
        srv2 = server_res(base, ua).get(sari_id) or {}
        want2 = {"v": 1, "capacity": 4, "leave": [], "by": ua["id"]}
        check("2a A (pemilik) editor Sari (dibuka: %r, terbuka tanpa kunci) → kapasitas 4 → Simpan → toast 'Kapasitas Sari disimpan', "
              "tepat 1 item record %s scope list:%d data %r; 0 tulis task; server menyimpannya"
              % ((st2o or {}).get("cap"), sari_id, lid, want2),
              st2o and st2o["cap"] == "8" and st2o["by"] is None and len(it2) == 1 and it2[0].get("id") == sari_id
              and it2[0].get("scope") == "list:%d" % lid and it2[0].get("data") == want2
              and "Kapasitas Sari disimpan" in toasts(a, t2) and not [x for x in writes(("A",), s2) if x[2].startswith("/api/tasks")]
              and srv2.get("data") == want2, repr((st2o, it2, toasts(a, t2), srv2)))
        s2b = time.time()
        sync_now(b)
        okb = wait_until(lambda: "Sari · 4 🍅/hari" in names(b), 20, 0.4)
        open_editor(b, "Sari")
        stb = ed_ready(b)
        want_by = "Diubah oleh Rani · " + short(TODAY)
        shot(b, "2-B-sari-4-diubah-oleh-rani.png")
        close_editor(b)
        nap(1)
        check("2b B tarik → panel B '%s', editor Sari: kapasitas 4 + keterangan '%s'; Batal → 0 tulis B"
              % ("Sari · 4 🍅/hari", want_by), okb and stb and stb["cap"] == "4" and stb["by"] == want_by and not writes(("B",), s2b),
              repr((names(b), stb, writes(("B",), s2b))))
        # CAS: A dan B membuka editor Sari; A simpan 6; B tarik lalu simpan 5
        s2c = time.time()
        open_editor(a, "Sari")
        ed_ready(a)
        open_editor(b, "Sari")
        stb0 = ed_ready(b)
        a.locator(".plg-timeline-res-pop .plg-timeline-res-cap-input").fill("6")
        save_editor(a)
        sync_now(a)
        wait_until(lambda: (server_res(base, ua).get(sari_id) or {}).get("data", {}).get("capacity") == 6, 15, 0.4)
        sync_now(b)
        nap(1.5)
        b.locator(".plg-timeline-res-pop .plg-timeline-res-cap-input").fill("5")
        b.locator(".plg-timeline-res-pop .plg-timeline-res-save").click()
        ok_stale = wait_until(lambda: (ed_state(b) or {}).get("stale") == MSG_STALE, 10, 0.3)
        st_stale = ed_state(b)
        shot(b, "2-B-cas-data-berubah.png")
        sync_now(b)
        nap(1)
        wb = writes(("B",), s2c)
        srv2c = server_res(base, ua).get(sari_id) or {}
        check("2c CAS: B membuka editor Sari (potret kapasitas %s) sebelum A menyimpan 6; B tarik lalu Simpan 5 → '%s' + tombol "
              "'Muat ulang', Simpan nonaktif, isian beku; 0 tulis B (%r); server tetap 6 dari Rani"
              % ((stb0 or {}).get("cap"), MSG_STALE, wb),
              stb0 and stb0["cap"] == "4" and ok_stale and st_stale["reload"] and st_stale["saveDisabled"] and st_stale["capDisabled"]
              and not wb and not res_items("B", s2c) and (srv2c.get("data") or {}).get("capacity") == 6
              and (srv2c.get("data") or {}).get("by") == ua["id"], repr((stb0, st_stale, wb, srv2c)))
        b.locator(".plg-timeline-res-pop").get_by_role("button", name="Muat ulang").click()
        ok_rl = wait_until(lambda: (lambda s: s if s and s["cap"] == "6" and s["stale"] is None and s["busy"] == "false" else None)(ed_state(b)), 10, 0.3)
        st_rl = ed_state(b)
        shot(b, "2-B-cas-muat-ulang.png")
        close_editor(b)
        sync_now(b)
        nap(1)
        check("2d 'Muat ulang' → nilai Rani (kapasitas 6, '%s'), Simpan aktif lagi; Batal → 0 tulis B; panel B 'Sari · 6 🍅/hari'"
              % want_by, ok_rl and st_rl["by"] == want_by and not st_rl["saveDisabled"] and not writes(("B",), s2c)
              and "Sari · 6 🍅/hari" in names(b), repr((st_rl, writes(("B",), s2c), names(b))))

        # ── 3 perangkat baru (U3, tarik record diblokir) ──
        run_new_device(browser, base, uc, ctxs, want_by)

        # ── 4 cuti → merah → saran → gulir + kedip → seret ──
        tono_id = res_id(lid, uc["id"])
        sync_now(a)
        s4, t4 = time.time(), now_ms(a)
        open_editor(a, "Tono")
        st4o = ed_ready(a)
        a.locator(".plg-timeline-res-pop .plg-timeline-res-add").click()
        row = a.locator(".plg-timeline-res-pop .plg-timeline-res-row").first
        row.locator(".plg-timeline-res-from").fill(iso(w(4)))
        row.locator(".plg-timeline-res-to").fill(iso(w(4)))
        row.locator(".plg-timeline-res-note").fill("Cuti keluarga")
        st4f = ed_state(a)
        shot(a, "4-A-editor-cuti-tono.png")
        save_editor(a)
        sync_now(a)
        wait_until(lambda: res_items("A", s4), 15, 0.3)
        it4 = res_items("A", s4)
        want4 = {"v": 1, "capacity": 8, "leave": [{"from": iso(w(4)), "to": iso(w(4)), "note": "Cuti keluarga"}], "by": ua["id"]}
        lbl4 = "Tono · %s: 2 dari 0 🍅 (%s)" % (short(w(4)), hours_label(2))
        ok_red = wait_until(lambda: lbl4 in hits(a), 15, 0.3)
        st4 = panel(a)
        check("4a A: editor Tono (terbuka, tanpa record) → Tambah cuti %s → Simpan → 1 item %s data %r; toast; hari merah '%s'; judul '%s'"
              % (iso(w(4)), tono_id, want4, lbl4, st4["head"]),
              st4o and st4o["by"] is None and st4f["rows"] == [[iso(w(4)), iso(w(4)), "Cuti keluarga"]] and not st4f["saveDisabled"]
              and len(it4) == 1 and it4[0].get("id") == tono_id and it4[0].get("data") == want4
              and "Kapasitas Tono disimpan" in toasts(a, t4) and ok_red and st4["head"] == "Beban Tim · 9 hari kelebihan beban",
              repr((st4f, it4, toasts(a, t4), st4["hits"][:12], st4["head"])))
        s4b = time.time()
        hit(a, lbl4).click()
        a.locator(".plg-timeline-load-pop").wait_for(state="visible", timeout=8000)
        ps4 = pop_state(a)
        shot(a, "4-A-popover-saran.png")
        slack_f = len(range(6, 12))  # hari kerja w6..w11: setelah EF brosur (w5) s.d. akhir project Alfa (EF Alfa panjang = w11)
        want_item = ["Alfa brosur · 2 🍅 hari ini · slack %d hk" % slack_f, None]
        check("4b klik hari merah → popover '%s' berisi tepat %r (free, tanpa label jenis), tanpa catatan '%s'"
              % ("Bisa digeser — Tono, " + short(w(4)), want_item[0], MSG_SUG_EMPTY),
              ps4 and ps4["title"] == "Bisa digeser — Tono, " + short(w(4)) and ps4["items"] == [want_item] and ps4["note"] is None,
              repr(ps4))
        sc0 = scroll_state(a, F)
        a.locator(".plg-timeline-load-pop .plg-timeline-load-sug-btn").first.click()
        a.wait_for_timeout(250)
        sc1 = scroll_state(a, F)
        shot(a, "4-A-bar-tergulir-berkedip.png")
        a.wait_for_timeout(2000)
        sc2 = scroll_state(a, F)
        vw = sc1["cw"] - sc1["tw"]
        x_rel = (sc1["bLeft"] - sc1["sLeft"] - sc1["tw"]) if sc1["bLeft"] is not None else None
        info("4 gulir sebelum/sesudah klik saran (scrollLeft, x bar relatif area grafik, lebar area)", [sc0["sl"], sc1["sl"], x_rel, vw])
        check("4c klik saran → popover tertutup, Gantt tergulir (scrollLeft %s → %s; bar mulai di x %.0f ≈ sepertiga lebar %d), "
              "bar + baris ber-kelas is-flash, fokus di bar, is-flash hilang setelah 2 dtk; 0 tulis"
              % (sc0["sl"], sc1["sl"], x_rel if x_rel is not None else -1, vw),
              a.locator(".plg-timeline-load-pop").count() == 0 and sc1["sl"] != sc0["sl"] and x_rel is not None
              and abs(x_rel - vw / 3) <= 8 and sc1["flash"] and sc1["rowFlash"] and sc1["active"] == str(F)
              and sc2["flash"] is False and not sc2["rowFlash"] and not writes(("A",), s4b), repr((sc0, sc1, sc2)))
        s4d = time.time()
        c0.drag_bar(a, F, 4)
        wait_until(lambda: task_puts("A", s4d, F), 15, 0.3)
        nap(2)
        sync_now(a)
        new_start = c0.shift(iso(w(4)), 4)
        p4 = task_puts("A", s4d)
        gone = wait_until(lambda: not [x for x in hits(a) if x.startswith("Tono · %s:" % short(w(4)))], 10, 0.3)
        st4d = panel(a)
        shot(a, "4-A-seret-keluar-cuti.png")
        check("4d seret bar 'Alfa brosur' +4 hari (gestur yang ada) → 1 PUT {ext_patch: timeline.start %s}; server; hari %s Tono "
              "tidak merah lagi; judul '%s'" % (new_start, short(w(4)), st4d["head"]),
              len(p4) == 1 and ((p4[0] or {}).get("ext_patch") or {}).get(PID + ".start") == new_start
              and server_tasks(base, ua)[F]["ext"].get("start") == new_start and gone
              and st4d["head"] == "Beban Tim · 8 hari kelebihan beban", repr((p4, st4d["head"], st4d["hits"][:10])))

        # ── 5 beban = bar (R1) ──
        srv = server_tasks(base, ua)
        labels = {t: bar_label(a, t) for t in dewi_tasks}
        spans, bad_bar = [], []
        for t in dewi_tasks:
            s, f, dur = bar_span(labels[t])
            st_ext = srv[t]["ext"]
            if s is None or iso(s) != st_ext.get("start") or dur != st_ext.get("duration"):
                bad_bar.append((t, labels[t], st_ext))
            spans.append((s, f, max(0, (srv[t]["est"] or 1) - (srv[t]["done"] or 0))))
        exp = distribute(spans, T0)
        exp_es = distribute([x if t != Q else (w(2), w(3), x[2]) for t, x in zip(dewi_tasks, spans)], T0)  # pembanding salah (ES mesin)
        want_days = ["Dewi · %s · %s dari 0 🍅" % (short(d), fmt_pomo(v, True)) for d, v in sorted(exp.items())]
        a.locator(".plg-timeline-load-daysbtn").click()
        a.locator(".plg-timeline-load-days").wait_for(state="visible", timeout=8000)
        a.wait_for_timeout(300)
        days = [x for x in panel(a)["days"] if x.startswith("Dewi · ")]
        shot(a, "5-A-daftar-hari-kelebihan-beban.png")
        a.locator(".plg-timeline-load-daysbtn").click()
        a.locator(".plg-timeline-load-days").wait_for(state="detached", timeout=8000)
        dhits = [x for x in hits(a) if x.startswith("Dewi · ")]
        want_hits = {"Dewi · %s: %s dari 0 🍅 (%s)" % (short(d), fmt_pomo(v, True), hours_label(float(fmt_pomo(v, True))))
                     for d, v in exp.items()}
        info("5 bar Dewi (aria-label)", list(labels.values()))
        info("5 beban manual milipomodoro per hari (bar) / pembanding ES", [{iso(d): v for d, v in sorted(exp.items())},
                                                                         {iso(d): v for d, v in sorted(exp_es.items())}])
        check("5a tanggal bar Dewi (aria-label Gantt) = tanggal tersimpan server untuk 6 task (drift Beta rangka %s, Manual, "
              "terlambat, berjalan ber-actual.start, target 24, jauh)" % short(w(4)), not bad_bar, repr(bad_bar))
        check("5b daftar 'Hari kelebihan beban' Dewi (kapasitas 0) = hitungan manual dari tanggal bar: %r" % want_days,
              days == want_days and exp != exp_es, repr(days))
        check("5c aria-label tombol hari merah Dewi di jendela (%d) ⊆ hitungan manual (beban + jam), memuat hari ini '%s'"
              % (len(dhits), [h for h in dhits if (" · %s:" % short(T0)) in h]),
              dhits and set(dhits) <= want_hits and any((" · %s:" % short(T0)) in h for h in dhits), repr((dhits, sorted(want_hits))))
        tip = hover_tip(a, 1, short(T0))
        want_tip = "Rani · %s: 1 dari 8 🍅 (%s)" % (short(T0), hours_label(1))
        shot(a, "5-A-readout-hover.png")
        a.mouse.move(5, 5)
        check("5d readout hover baris Rani hari ini = '%s' (task Manual 12 🍅 / 12 hk)" % want_tip, tip == want_tip, repr(tip))

        # ── 6 filter panel ──
        lbl6 = [x for x in hits(a) if x.startswith("Dewi · %s:" % short(T0))]
        search = a.locator("input[placeholder*='Cari task']").first
        s6 = time.time()
        search.fill("Beta")
        a.wait_for_timeout(1200)
        vis6 = {k: c0.bar(a, v).count() for k, v in (("G1", G1), ("G3", G3), ("P", P))}
        lbl6b = [x for x in hits(a) if x.startswith("Dewi · %s:" % short(T0))]
        hit(a, lbl6[0]).click()
        a.locator(".plg-timeline-load-pop").wait_for(state="visible", timeout=8000)
        ps6 = pop_state(a)
        shot(a, "6-A-filter-popover.png")
        want6 = [["Beta pondasi · 2 🍅 hari ini", "Kritis"], ["Gamma uji · 1.5 🍅 hari ini", "Sudah mulai"],
                 ["Gamma laporan · 5 🍅 hari ini", "terlambat"]]
        sc6 = scroll_state(a)
        a.locator(".plg-timeline-load-pop .plg-timeline-load-sug-btn", has_text="Gamma laporan").first.click()
        m6 = a.locator(".modal-content").first
        m6.wait_for(state="visible", timeout=10000)
        ttl = wait_until(lambda: m6.locator(c0.TITLE_INPUT).first.input_value() == "Gamma laporan", 8, 0.2)
        sc6b = scroll_state(a)
        shot(a, "6-A-detail-task-tersaring.png")
        c0.close_modal(a)
        search.fill("")
        a.wait_for_timeout(800)
        check("6a filter 'Beta' menyembunyikan bar Gamma (%r) → hari merah Dewi hari ini tetap '%s' (beban tidak hilang)"
              % (vis6, lbl6[0] if lbl6 else None), lbl6 and lbl6b == lbl6 and vis6 == {"G1": 0, "G3": 0, "P": 1}, repr((lbl6, lbl6b, vis6)))
        check("6b popover hari ini: catatan '%s' + %r (urutan R6: Kritis, Sudah mulai, terlambat)" % (MSG_SUG_EMPTY, want6),
              ps6 and ps6["note"] == MSG_SUG_EMPTY and ps6["items"] == want6, repr(ps6))
        check("6c klik 'Gamma laporan' (tersaring) → detail task terbuka (judul 'Gamma laporan'), Gantt tidak digulir (%s,%s → %s,%s); "
              "0 tulis" % (sc6["st"], sc6["sl"], sc6b["st"], sc6b["sl"]),
              ttl and (sc6["st"], sc6["sl"]) == (sc6b["st"], sc6b["sl"]) and not writes(("A",), s6), repr((sc6, sc6b, writes(("A",), s6))))

        # ── 9 (desktop 1280 terang) kesejajaran, Tab, zoom — sebelum navigasi ke Pribadi (lihat catatan 7c) ──
        run_desktop_view(a, ids)

        # ── 7 baris workspace + project pribadi ──
        st7w = panel(a)
        want_rows = ["Dewi · 0 🍅/hari", "Rani · 8 🍅/hari", "Sari · 6 🍅/hari", "Tono · 8 🍅/hari", "Belum ditugaskan"]
        is_none = a.evaluate("() => Array.from(document.querySelectorAll('.plg-timeline-load-name')).map(x => [x.tagName, x.classList.contains('is-none')])")
        check("7a workspace multi-project: baris %r ('Belum ditugaskan' terakhir, bukan tombol), tanpa catatan" % want_rows,
              st7w["names"] == want_rows and st7w["note"] is None and is_none[-1] == ["DIV", True]
              and all(x == ["BUTTON", False] for x in is_none[:-1]), repr((st7w["names"], st7w["note"], is_none)))
        s7 = time.time()
        c0.open_timeline(a, PRIV)
        c1.wait_engine(a)
        panel_on(a)
        ok7 = wait_until(lambda: names(a) == ["Rani · 8 🍅/hari"], 15, 0.3)
        st7p = panel(a)
        shot(a, "7-A-project-pribadi.png")
        panel_on(a, False)
        check("7b project pribadi '%s': satu baris 'Rani · 8 🍅/hari' + catatan persis '%s'; judul '%s'; 0 tulis"
              % (PRIV, MSG_PARTIAL, st7p["head"]), ok7 and st7p["note"] == MSG_PARTIAL
              and st7p["head"] == "Beban Tim · 0 hari kelebihan beban" and not writes(("A",), s7), repr(st7p))
        # Temuan pra-ada (juga di origin/main, Timeline 1.2): view yang dipasang ulang saat navigasi (Pribadi → W) mengukur
        # lebar grafik di tengah animasi wadah host (1158 → 962 → 1158 px) dan tidak mengukur ulang tanpa resize jendela →
        # vp.w basi (mis. 374 alih-alih 570). Dicatat sebagai info; cek kesejajaran/Tab 9b–9c dijalankan SEBELUM navigasi ini.
        c0.open_timeline(a, WS)
        c1.wait_engine(a)
        a.wait_for_timeout(1000)
        info("7c [info] props LoadPanel setelah kembali ke W (viewW vs lebar area grafik nyata)",
             [a.evaluate(LPROPS_JS), a.evaluate("() => { const s = document.querySelector('.plg-timeline-scroll'); return s.clientWidth - 588; }")])
        cb.close()
        ctxs.remove(cb)
        ca.close()
        ctxs.remove(ca)
    finally:
        for cx in ctxs:
            try:
                cx.close()
            except Exception:  # noqa: BLE001
                pass


def hover_tip(p, row_i, day_short):
    """Readout hover sel (baris row_i, hari = kolom tombol hari merah Dewi pada day_short)."""
    p.locator(".plg-timeline-load-view").scroll_into_view_if_needed()
    xy = p.evaluate("""([ds, i]) => { const h = Array.from(document.querySelectorAll('.plg-timeline-load-hit')).find(b => (b.getAttribute('aria-label') || '').indexOf(' · ' + ds + ':') > 0);
        const v = document.querySelector('.plg-timeline-load-view'); if (!h || !v) return null; const hr = h.getBoundingClientRect(), vr = v.getBoundingClientRect();
        return [hr.left + hr.width / 2, vr.top + i * 28 + 14]; }""", [day_short, row_i])
    if not xy:
        return None
    p.mouse.move(xy[0] - 30, xy[1])
    p.mouse.move(xy[0], xy[1], steps=3)
    p.wait_for_timeout(400)
    return p.evaluate("() => (document.querySelector('.plg-timeline-load-tip') || {}).textContent || null")


def run_day_change(browser, base, ua, ctxs):
    """1c: Z (U1, jam Playwright dipasang 23:57 WIB, plugin.js berekspor) panel terbuka → jam maju lewat tengah malam →
    runtime memancarkan app.dayChanged → sinkron → 0 tulis; D masukan TLLoad.run dicatat."""
    cz = new_ctx(browser, base)
    ctxs.append(cz)
    pure_route(cz)
    pin = datetime.datetime.combine(TODAY, datetime.time(23, 57, 0), tzinfo=JKT)
    cz.clock.install(time=pin)
    z = c0.open_page(cz, base, ua, "Z")
    c0.open_timeline(z, WS)
    c1.wait_engine(z)
    wrapped = z.evaluate(WRAP_JS)
    sz = time.time()
    sync_now(z)
    n_closed = len(load_runs(z))
    panel_on(z)
    wait_until(lambda: load_runs(z), 15, 0.3)
    nap(1)
    r0 = load_runs(z)
    t_before = z.evaluate("() => new Date().toString()")
    z.clock.fast_forward("05:00")
    ev = wait_until(lambda: [e for e in z.evaluate("() => window.__ev") if e[0] == "app.dayChanged"], 10, 0.3)
    sync_now(z)
    c0.refresh_tasks(z)
    nap(1.5)
    sync_now(z)
    r1 = load_runs(z)
    t_after = z.evaluate("() => new Date().toString()")
    wz = writes(("Z",), sz)
    shot(z, "1-Z-setelah-tengah-malam.png")
    d0 = r0[-1]["D"] if r0 else None
    d1 = r1[-1]["D"] if r1 else None
    info("1c Z jam sebelum/sesudah, event, TLLoad.run (jumlah, D terakhir) sebelum/sesudah", [t_before, t_after, ev, [len(r0), d0], [len(r1), d1]])
    check("1c Z (jam palsu 23:57 WIB, panel terbuka): panel tertutup = 0 run TLLoad (%d); jam maju lewat tengah malam → app.dayChanged "
          "%r + 2 sinkron → 0 tulis task/ext/records (%r); TLLoad.run D %s → %s (%d → %d run)"
          % (n_closed, ev and ev[0][1], wz, d0, d1, len(r0), len(r1)),
          wrapped and n_closed == 0 and r0 and ev and not wz, repr((wrapped, n_closed, ev, wz)))
    cz.close()
    ctxs.remove(cz)


def run_new_device(browser, base, uc, ctxs, want_by):
    cn = new_ctx(browser, base)
    ctxs.append(cn)
    blocked = {"n": 0, "on": True}

    def block_pull(route):
        if blocked["on"]:
            blocked["n"] += 1
            return route.abort()
        return route.continue_()
    cn.route(RECS_PULL_RE, block_pull)
    n = c0.open_page(cn, base, uc, "N")
    s3 = time.time()
    loc0 = n.evaluate(LOCAL_RES_JS)
    c0.open_timeline(n, WS)
    c1.wait_engine(n)
    sync_now(n)  # satu sinkron dengan tarik record diblokir — kunci tetap
    panel_on(n)
    wait_until(lambda: "Sari · 8 🍅/hari" in names(n), 15, 0.3)
    open_editor(n, "Sari")
    n.wait_for_timeout(800)
    st_l = ed_state(n)
    shot(n, "3-N-kunci-sebelum-tarik.png")
    n.locator(".plg-timeline-res-pop .plg-timeline-res-save").click(force=True)
    n.wait_for_timeout(600)
    st_l2 = ed_state(n)
    check("3a perangkat baru N (U3, IndexedDB kosong: %r, tarik record diblokir %d×, termasuk satu __syncNow): editor Sari → '%s', "
          "Simpan + isian nonaktif, kapasitas bawaan 8; klik paksa → 0 tulis" % (loc0, blocked["n"], MSG_WAIT),
          loc0 == [] and blocked["n"] >= 1 and st_l and st_l["wait"] == MSG_WAIT and st_l["saveDisabled"] and st_l["capDisabled"]
          and st_l["cap"] == "8" and st_l["by"] is None and st_l2["wait"] == MSG_WAIT and not writes(("N",), s3), repr((st_l, st_l2)))
    blocked["on"] = False
    sync_now(n)
    ok = wait_until(lambda: (lambda s: s if s and s["wait"] is None and s["cap"] == "6" and not s["saveDisabled"] else None)(ed_state(n)), 20, 0.4)
    st_u = ed_state(n)
    shot(n, "3-N-terbuka-setelah-tarik.png")
    close_editor(n)
    nap(1)
    check("3b tarik dibuka + sinkron → editor (masih terbuka) tidak terkunci: kapasitas 6, '%s', Simpan aktif; Batal → 0 tulis N; "
          "panel 'Sari · 6 🍅/hari'" % want_by, ok and st_u["by"] == want_by and not writes(("N",), s3) and "Sari · 6 🍅/hari" in names(n),
          repr((st_u, writes(("N",), s3), names(n))))
    cn.close()
    ctxs.remove(cn)


ALIGN_JS = """(ds) => { const s = document.querySelector('.plg-timeline-scroll'); const tl = document.querySelector('.plg-timeline-today');
  const v = document.querySelector('.plg-timeline-load-view'); const hs = Array.from(document.querySelectorAll('.plg-timeline-load-hit'));
  const h = ds ? hs.find(b => (b.getAttribute('aria-label') || '').indexOf(' · ' + ds + ':') > 0) : null;
  const r = tl ? tl.getBoundingClientRect() : null, hr = h ? h.getBoundingClientRect() : null, vr = v.getBoundingClientRect();
  const a = document.activeElement; const ar = a && a.classList.contains('plg-timeline-load-hit') ? a.getBoundingClientRect() : null;
  return { sl: s.scrollLeft, today: r ? r.left + r.width / 2 : null, hit: hr ? hr.left + hr.width / 2 : null, px: hs.length ? hs[0].getBoundingClientRect().width : null,
    view: [vr.left, vr.right], active: a ? a.getAttribute('aria-label') : null, activeX: ar ? ar.left + ar.width / 2 : null,
    activeIn: ar ? ar.left >= vr.left - 0.5 && ar.right <= vr.right + 0.5 : null,
    hits: hs.map(b => { const q = b.getBoundingClientRect(); return [b.getAttribute('aria-label'), q.left, q.right]; }) }; }"""


# Props LoadPanel (jendela dw, rangeFrom, px, viewW, getLeft) dari fiber React — diagnosis saja.
LPROPS_JS = """() => { const el = document.querySelector('.plg-timeline-load'); if (!el) return null;
  const fk = Object.keys(el).find((k) => k.indexOf('__reactFiber$') === 0); let f = fk ? el[fk] : null;
  while (f && !(f.memoizedProps && f.memoizedProps.fromDn !== undefined && f.memoizedProps.load)) f = f.return;
  if (!f) return null; const p = f.memoizedProps;
  return { fromDn: p.fromDn, toDn: p.toDn, rangeFrom: p.rangeFrom, px: p.px, viewW: p.viewW, tableW: p.tableW, left: p.getLeft ? p.getLeft() : null,
    over: p.load.rows.map((r) => [r.name, r.overDays]) }; }"""


def run_desktop_view(a, ids):
    """9 (1280 px terang, A): sejajar dengan Gantt setelah gulir horizontal dan setelah Tab ke tombol hari merah di luar
    layar (zoom Minggu, lebar grafik terukur benar), lalu histogram di zoom Hari/Bulan/Minggu (tangkapan + DOM)."""
    ds = short(T0)
    a.locator(".plg-timeline-load-view").scroll_into_view_if_needed()
    lp = a.evaluate(LPROPS_JS)
    cw = a.evaluate("() => document.querySelector('.plg-timeline-scroll').clientWidth")
    al0 = a.evaluate(ALIGN_JS, ds)
    a.evaluate("() => { const s = document.querySelector('.plg-timeline-scroll'); s.scrollLeft = s.scrollLeft + 150; }")
    a.wait_for_timeout(700)
    al1 = a.evaluate(ALIGN_JS, ds)
    shot(a, "9-A-1280-gulir-horizontal.png")
    check("9b sejajar (viewW panel %s = lebar area grafik %d): x hari ini garis Gantt = x tombol hari ini panel ± 1 px — awal "
          "(%.1f / %.1f) dan setelah gulir +150 px (scrollLeft %s → %s: %.1f / %.1f)"
          % (lp and lp["viewW"], cw - 588, al0["today"] or -1, al0["hit"] or -1, al0["sl"], al1["sl"], al1["today"] or -1, al1["hit"] or -1),
          lp and lp["viewW"] == cw - 588 and al0["hit"] is not None and al1["hit"] is not None and abs(al0["today"] - al0["hit"]) <= 1
          and abs(al1["today"] - al1["hit"]) <= 1 and al1["sl"] != al0["sl"]
          and abs((al0["today"] - al1["today"]) - (al1["sl"] - al0["sl"])) <= 1, repr((lp, al0, al1)))
    # Tab: fokus (skrip) tombol Dewi terakhir yang tampak, lalu Tab (keyboard nyata → :focus-visible) ke tombol Dewi
    # berikutnya yang ada di jendela tetapi di luar layar kanan.
    a.evaluate("() => { const s = document.querySelector('.plg-timeline-scroll'); s.scrollLeft = s.scrollLeft - 150; }")
    a.wait_for_timeout(700)
    al = a.evaluate(ALIGN_JS, ds)
    hs = al["hits"]
    k = None
    for i in range(len(hs) - 1):
        if hs[i][0].startswith("Dewi · ") and hs[i + 1][0].startswith("Dewi · ") and hs[i][2] <= al["view"][1] and hs[i + 1][1] > al["view"][1]:
            k = i
            break
    info("9 tombol hari merah (label, kiri, kanan) / area grafik / indeks tombol tampak terakhir", [hs[:12], al["view"], k])
    if k is None:
        check("9c Tab ke tombol hari merah di luar layar (pasangan tampak → di luar kanan tidak ditemukan)", False, repr((hs, lp)))
    else:
        nxt = hs[k + 1][0]
        a.evaluate("(i) => document.querySelectorAll('.plg-timeline-load-hit')[i].focus()", k)
        a.wait_for_timeout(200)
        a.keyboard.press("Tab")
        a.wait_for_timeout(900)
        al2 = a.evaluate(ALIGN_JS, ds)
        shot(a, "9-A-1280-tab-hari-merah-luar-layar.png")
        dn = SHORT2DATE.get(nxt.split(" · ")[1].split(":")[0])
        want_x = (al2["today"] + (dn - T0).days * al2["px"]) if dn and al2["today"] is not None and al2["px"] else None
        check("9c Tab dari tombol tampak '%s' ke '%s' (di luar layar kanan) → Gantt tergulir (scrollLeft %s → %s), tombol fokus di "
              "dalam area grafik, x tombol = x hari itu di Gantt (garis hari ini + %d hari × %s px) ± 1 px (%.1f / %.1f)"
              % (hs[k][0], nxt, al["sl"], al2["sl"], (dn - T0).days if dn else -1, al2["px"], al2["activeX"] or -1, want_x or -1),
              al2["active"] == nxt and al2["sl"] > al["sl"] and al2["activeIn"] and want_x is not None and abs(al2["activeX"] - want_x) <= 1,
              repr((al, al2)))
        a.mouse.click(5, 5)
    zoom = lambda name: a.locator(".plg-timeline-seg[aria-label='Skala waktu'] [role=radio]", has_text=re.compile("^" + name + "$")).first  # noqa: E731
    doms = {}
    for name, fn in (("Hari", "hari"), ("Bulan", "bulan"), ("Minggu", "minggu")):
        zoom(name).click()
        a.wait_for_timeout(1200)
        st = panel(a)
        doms[name] = (st["dom"], st["all"], st["svgs"], len(st["hits"]))
        shot(a, "9-A-1280-zoom-%s.png" % fn)
    info("9 1280 terang: DOM panel / .plg-timeline * / svg / tombol hari merah per zoom", doms)
    check("9a 1280 px terang: histogram (svg per baris = 5) di zoom Hari/Bulan/Minggu; DOM panel ≤ %d, total ≤ %d (%r)"
          % (PANEL_DOM_BUDGET, DOM_BUDGET, doms),
          all(v[2] == 5 and v[0] <= PANEL_DOM_BUDGET and v[1] <= DOM_BUDGET and v[3] > 0 for v in doms.values()), repr(doms))


# ── 8 klien 1.2 ───────────────────────────────────────────────────────────────

def run_old_client(browser, base, ub, ids):
    served = []
    ctx = new_ctx(browser, base)

    def make(path, ctype, body):
        def handler(route):
            served.append(path)
            route.fulfill(status=200, content_type=ctype, body=body)
        return handler
    for rx, ctype, path in OLD_FILES:
        ctx.route(re.compile(rx), make(path, ctype, pinned(path)))
    sw_old = old_sw()
    p = ctx.new_page()
    c0.PUMP.append(p)
    c0.watch(p, "OLD")
    p.goto(base + "/manifest.json")
    c0.prime_storage(p, ub)
    p.evaluate("(sw) => localStorage.setItem('tf_whatsnew_seen', sw)", sw_old)
    srv0 = server_res(base, ub)
    s8 = time.time()
    p.goto(base + "/")
    hd.wait_dashboard_ready(p)
    c0.wait_sync(p)
    p.wait_for_function("pid => window.TF && window.TF.plugins && window.TF.plugins.isEnabled(pid)", arg=PID, timeout=20000)
    p.evaluate("() => { window.__e2eNoReload = 1; }")
    c0.open_timeline(p, WS)
    c1.wait_engine(p)
    ver = p.evaluate("() => { try { return (window.TF.plugins.list ? window.TF.plugins.list() : []).map(x => [x.id, x.version]); } catch (e) { return String(e); } }")
    sw_page = p.evaluate("() => window.__SW_VERSION")
    no13 = p.locator(".plg-timeline-loadbtn, .plg-timeline-load").count() == 0
    for _ in range(2):
        sync_now(p)
    c0.refresh_tasks(p)
    nap(2)
    shot(p, "8-OLD-klien-1.2-timeline.png")
    w8 = writes(("OLD",), s8)
    srv1 = server_res(base, ub)
    errs = [x for x in c0.console_log if x[0] == "OLD" and x[1] in ("error", "pageerror") and not re.search(r"Failed to load resource|net::ERR_", x[2])]
    info("8 OLD: berkas dipatok yang disajikan, plugin terdaftar, SW halaman", [sorted(set(served)), ver, sw_page])
    check("8a klien 1.2 (%s: %s) memuat Timeline 1.2.0 (tanpa tombol/panel Beban Tim), SW halaman %s, tanpa galat konsol"
          % (PIN, ", ".join(x[2] for x in OLD_FILES), sw_page),
          set(x[2] for x in OLD_FILES) <= set(served) and ["timeline", "1.2.0"] in [list(x) for x in (ver if isinstance(ver, list) else [])]
          and no13 and sw_page == sw_old and not errs, repr((sorted(set(served)), ver, no13, errs[:4])))
    check("8b klien 1.2 + %d record resource di server: buka Timeline W + 2 siklus sinkron → 0 tulis task/ext/records (%r); record "
          "resource server utuh (data, updated_at, version sama)" % (len(srv0), w8),
          len(srv0) == 3 and not w8 and srv1 == srv0, repr((w8, srv0, srv1)))
    ctx.close()


# ── 9 (HP) 375 px Sakura gelap ────────────────────────────────────────────────

def inside_js():
    return """(sel) => Array.from(document.querySelectorAll(sel)).map(e => { const r = e.getBoundingClientRect();
        return [Math.round(r.left * 10) / 10, Math.round(r.right * 10) / 10, Math.round(r.width * 10) / 10, e.scrollWidth > e.clientWidth + 1]; })"""


def run_mobile(browser, base, ua, ids):
    cm, m = open_dev(browser, base, ua, "M", viewport=hd.MOBILE, mobile=True)
    try:
        m.evaluate("() => { localStorage.setItem('tf_palette', 'sakura'); localStorage.setItem('tf_theme', 'dark'); }")
        m.reload()
        hd.wait_dashboard_ready(m)
        c0.wait_sync(m)
        m.evaluate("() => { window.__e2eNoReload = 1; }")
        s9 = time.time()
        sync_now(m)
        c0.open_timeline(m, WS)
        c1.wait_engine(m, slack=False)
        menu, items = more_menu_items(m)
        m.keyboard.press("Escape")
        m.evaluate(SCROLL_TOP_JS)
        panel_on(m)  # lewat "Lainnya" (375 px)
        ok = wait_until(lambda: len(panel(m)["days"]) == 8, 15, 0.3)
        hv = head_view(m)
        st = panel(m)
        pal = m.evaluate("() => [document.documentElement.getAttribute('data-palette'), document.documentElement.getAttribute('data-theme')]")
        shot(m, "9-M-375-sakura-gelap-daftar.png")
        exp_days = ["Dewi · %s · %s dari 0 🍅" % (short(d), b) for d, b in ids["dewi_days"]]
        check("9d 375 px Sakura gelap (%r): 'Lainnya' = %r (Beban Tim setelah Jalur kritis); panel = daftar '%s' + chip %r, item %r, "
              "tanpa svg; scrollWidth %d ≤ 375" % (pal, items, "Hari kelebihan beban", st["names"], st["days"], st["sw"]),
              ok and pal == ["sakura", "dark"] and items == ["Jadwal otomatis", "Jalur kritis", "Beban Tim", "Baseline", "Simpan baseline", "Jadwalkan ulang"]
              and st["m"] and st["svgs"] == 0 and st["names"] == ["Dewi · 0 🍅/hari", "Rani · 8 🍅/hari", "Sari · 6 🍅/hari", "Tono · 8 🍅/hari"]
              and st["days"] == exp_days and st["sw"] <= 375 and st["head"] == "Beban Tim · 8 hari kelebihan beban", repr(st))
        check("9h (review akhir I1) mode Gantt 375 px: menyalakan Beban Tim lewat 'Lainnya' → judul daftar di dalam viewport "
              "(atas %s, bawah %s, innerHeight %s; posisi alami %s, digulir %s)" % (hv and hv["top"], hv and hv["bottom"],
                                                                                  hv and hv["ih"], hv and hv["natural"], hv and hv["off"]),
              bool(hv) and hv["inside"], repr(hv))
        m.locator(".plg-timeline-load-m-day").first.click()
        m.locator(".plg-timeline-load-pop").wait_for(state="visible", timeout=8000)
        ps = pop_state(m)
        sw_pop = m.evaluate("() => document.documentElement.scrollWidth")
        shot(m, "9-M-375-popover-saran.png")
        m.keyboard.press("Escape")
        m.locator(".plg-timeline-load-pop").wait_for(state="detached", timeout=8000)
        check("9e ketuk item → popover saran '%s' di dalam 375 px (%r), scrollWidth %d" % (ps and ps["title"], ps and ps["box"], sw_pop),
              ps and ps["box"][0] >= 0 and ps["box"][2] <= 375 and sw_pop <= 375 and len(ps["items"]) == 3, repr(ps))
        open_editor(m, "Tono")
        ed_ready(m)
        m.wait_for_timeout(500)
        st_e = ed_state(m)
        boxes = {sel: m.evaluate(inside_js(), sel) for sel in (".plg-timeline-res-pop", ".plg-timeline-res-from", ".plg-timeline-res-to",
                                                              ".plg-timeline-res-note", ".plg-timeline-res-cap-input", ".plg-timeline-res-save")}
        sw_ed = m.evaluate("() => document.documentElement.scrollWidth")
        shot(m, "9-M-375-editor-kapasitas.png")
        close_editor(m)
        info("9 375 editor: kotak [kiri, kanan, lebar, terpotong] per elemen", boxes)
        flat = [b for v in boxes.values() for b in v]
        check("9f editor kapasitas Tono (cuti %r) muat 375 px: popover + input tanggal/catatan/kapasitas + Simpan di [0, 375], input "
              "tanggal tidak terpotong (lebar ≥ 100 px, scrollWidth ≤ clientWidth); scrollWidth dokumen %d"
              % (st_e and st_e["rows"], sw_ed),
              st_e and st_e["rows"] == [[iso(w(4)), iso(w(4)), "Cuti keluarga"]] and flat and all(b[0] >= -0.5 and b[1] <= 375.5 for b in flat)
              and all(b[2] >= 100 and not b[3] for b in boxes[".plg-timeline-res-from"] + boxes[".plg-timeline-res-to"]) and sw_ed <= 375,
              repr((boxes, sw_ed)))
        m.get_by_role("radio", name="Daftar").click()
        m.locator(".plg-timeline-list").wait_for(state="visible", timeout=10000)
        m.wait_for_timeout(600)
        st_l = panel(m)
        _, items_l = more_menu_items(m)
        m.keyboard.press("Escape")
        shot(m, "9-M-375-mode-daftar.png")
        # 9i (review akhir I1): mode Daftar — matikan lewat "Lainnya", gulir ke paling atas, nyalakan lagi lewat "Lainnya" →
        # judul daftar Beban Tim (di bawah seluruh daftar task) di dalam viewport
        panel_on(m, False)
        m.evaluate(SCROLL_TOP_JS)
        m.wait_for_timeout(200)
        panel_on(m, True)
        hv_l = head_view(m)
        shot(m, "9-M-375-daftar-dinyalakan.png")
        m.get_by_role("radio", name="Gantt").click()
        m.wait_for_timeout(500)
        check("9g mode Daftar HP: daftar Beban Tim tetap (%d item), 'Lainnya' %r memuat Beban Tim; scrollWidth %d; 0 tulis M"
              % (len(st_l["days"]) if st_l else -1, items_l, st_l["sw"] if st_l else -1),
              st_l and st_l["m"] and len(st_l["days"]) == 8 and "Beban Tim" in items_l and st_l["sw"] <= 375 and not writes(("M",), s9),
              repr((st_l, items_l, writes(("M",), s9))))
        check("9i (review akhir I1) mode Daftar 375 px: matikan, gulir ke atas, nyalakan lewat 'Lainnya' → judul daftar di dalam "
              "viewport (atas %s, bawah %s, innerHeight %s; posisi alami %s, digulir %s); 0 tulis M"
              % (hv_l and hv_l["top"], hv_l and hv_l["bottom"], hv_l and hv_l["ih"], hv_l and hv_l["natural"], hv_l and hv_l["off"]),
              bool(hv_l) and hv_l["inside"] and not writes(("M",), s9), repr((hv_l, writes(("M",), s9))))
    finally:
        cm.close()


# ── 10 kinerja ────────────────────────────────────────────────────────────────

def run_perf(browser, base, ua, ids):
    cp = new_ctx(browser, base)
    got = []
    pure_route(cp, got)
    try:
        d = c0.open_page(cp, base, ua, "P10")
        sync_now(d)
        c0.open_timeline(d, WP)
        c1.wait_engine(d)
        wrapped = d.evaluate(WRAP_JS)
        s10 = time.time()
        sync_now(d)
        c0.refresh_tasks(d)
        nap(1)
        n_closed = len(load_runs(d))
        cdp = cp.new_cdp_session(d)
        cdp.send("Emulation.setCPUThrottlingRate", {"rate": CPU_RATE})
        try:
            toggles = []
            for i in range(5):
                t_on = d.evaluate("""() => new Promise((res) => { const b = document.querySelector('.plg-timeline-loadbtn'); const t0 = performance.now(); b.click();
                    const tick = () => { if (document.querySelector('.plg-timeline-load-svg')) requestAnimationFrame(() => res(performance.now() - t0)); else setTimeout(tick, 1); }; tick(); })""")
                toggles.append(round(t_on, 1))
                d.wait_for_timeout(1500)
                if i < 4:
                    panel_on(d, False)
            runs = load_runs(d)
            direct = d.evaluate("""(n) => { const out = []; for (let i = 0; i < n; i++) { const t0 = performance.now(); window.__loadOrig(window.__loadLast); out.push(performance.now() - t0); } return out; }""", 9)
            st = panel(d)
            doms = {}
            zoom = lambda name: d.locator(".plg-timeline-seg[aria-label='Skala waktu'] [role=radio]", has_text=re.compile("^" + name + "$")).first  # noqa: E731
            for name in ("Minggu", "Hari", "Bulan"):
                zoom(name).click()
                d.wait_for_timeout(1500)
                s = panel(d)
                mx = d.evaluate("""() => new Promise((res) => { const s = document.querySelector('.plg-timeline-scroll'); let maxDom = 0; const t0 = performance.now();
                    const step = () => { const t = performance.now() - t0; s.scrollTop = Math.round(t * 2); s.scrollLeft = Math.round(t); const n = document.querySelectorAll('.plg-timeline *').length;
                      if (n > maxDom) maxDom = n; if (t < 2500) requestAnimationFrame(step); else res(maxDom); }; requestAnimationFrame(step); })""")
                doms[name] = [s["all"], s["dom"], len(s["hits"]), mx]
                shot(d, "10-P10-500-zoom-%s.png" % name.lower())
            zoom("Minggu").click()
            d.wait_for_timeout(800)
        finally:
            cdp.send("Emulation.setCPUThrottlingRate", {"rate": 1})
        ms = [round(x["ms"], 2) for x in runs]
        dms = [round(x, 2) for x in direct]
        info("10 TLLoad.run lewat engine.load (CPU 4×) per panggilan ms / masukan (task, orang) / keluaran (baris, hari merah)",
             [ms, [(x["tasks"], x["people"], x["rows"], x["over"]) for x in runs[:3]]])
        info("10 TLLoad.run langsung atas masukan terakhir (CPU 4×) ms, median", [dms, statistics.median(dms) if dms else None])
        info("10 [info] klik Beban Tim → svg panel tergambar + frame (CPU 4×, termasuk muat record + render) ms", toggles)
        info("10 DOM per zoom: [.plg-timeline * diam, DOM panel, tombol hari merah, maks saat gulir 2,5 dtk]", doms)
        med = statistics.median(ms) if ms else None
        check("10a panel tertutup = 0 run TLLoad (%d, setelah sinkron); WP %s task / %s orang (plugin.js berekspor %d×)"
              % (n_closed, runs[0]["tasks"] if runs else None, runs[0]["people"] if runs else None, len(got)),
              wrapped and n_closed == 0 and runs and runs[0]["tasks"] >= 500 and runs[0]["people"] == 10, repr(runs[:2]))
        check("10b TLLoad.run (500 task / 400 dependensi / 10 orang, CPU 4×): median panggilan view %s ms, median langsung %s ms ≤ %d ms"
              % (med, statistics.median(dms) if dms else None, LOAD_BUDGET),
              med is not None and med <= LOAD_BUDGET and dms and statistics.median(dms) <= LOAD_BUDGET, repr((ms, dms)))
        check("10c DOM .plg-timeline * ≤ %d dengan panel terbuka di zoom Minggu/Hari/Bulan (diam + gulir), DOM panel ≤ %d: %r"
              % (DOM_BUDGET, PANEL_DOM_BUDGET, doms),
              all(0 < v[0] <= DOM_BUDGET and v[1] <= PANEL_DOM_BUDGET and 0 < v[3] <= DOM_BUDGET for v in doms.values())
              and st and len(st["names"]) == 10, repr((doms, st and st["names"])))
        check("10d P10: 0 tulis task/ext/records (%r); WP tanpa record resource di server" % writes(("P10",), s10),
              not writes(("P10",), s10) and not [k for k in server_res(base, ua) if k.startswith("res@list:%d:" % ids["wp"])])
    finally:
        cp.close()


# ── seed ──────────────────────────────────────────────────────────────────────

def register(base, username, display_name):
    r = requests.post(base + "/api/auth/register", json={"username": username, "password": hd.PW, "email": username + "@ex.com",
                                                         "display_name": display_name}, timeout=10)
    r.raise_for_status()
    j = r.json()
    return {"id": j["user_id"], "token": j["token"]}


def seed(base, db_path):
    ua = hd.seed(base, username="td1a", display_name="Rani")
    ub = hd.seed(base, username="td1b", display_name="Sari")
    uc = hd.seed(base, username="td1c", display_name="Tono")
    ud = hd.seed(base, username="td1d", display_name="Dewi")
    extra = [register(base, "td1x%d" % i, "Orang %d" % (i + 1)) for i in range(6)]
    ws_id = hd.api(base, ua, "POST", "/api/lists", json={"name": WS})["id"]
    wp_id = hd.api(base, ua, "POST", "/api/lists", json={"name": WP})["id"]
    with sqlite3.connect(db_path) as conn:
        now = datetime.datetime.now().isoformat()
        for u in (ub, uc, ud):
            conn.execute("INSERT INTO list_members (list_id, user_id, joined_at) VALUES (?,?,?)", (ws_id, u["id"], now))
        for u in [ub, uc, ud] + extra:
            conn.execute("INSERT INTO list_members (list_id, user_id, joined_at) VALUES (?,?,?)", (wp_id, u["id"], now))
    sess = requests.Session()
    sess.headers["Authorization"] = "Bearer " + ua["token"]
    ids = {"ws": ws_id, "wp": wp_id}
    n_dep = [0]

    def mk(title, project, start, dur, who=None, target=None, list_id=ws_id, actual=None, deps=()):
        ext = {PID + ".start": iso(start), PID + ".duration": dur}
        if actual:
            ext[PID + ".actual"] = {"start": iso(actual)}
        if deps:
            ext[PID + ".deps"] = [{"t": {"$task": t}, "type": ty, "lag": lg} for t, ty, lg in deps]
            n_dep[0] += len(deps)
        body = {"title": title, "gtd_status": "next", "priority": "P3", "project": project, "ext": ext}
        if list_id:
            body["list_id"] = list_id
        if who:
            body["assigned_to"] = who["id"]
        if target:
            body["estimated_pomodoros"] = target
        r = sess.post(base + "/api/tasks", json=body, timeout=10)
        r.raise_for_status()
        return c0.task_id(r.json())

    ids["L"] = mk("Alfa panjang", "Alfa", w(0), 12, ua, 12)
    ids["F"] = mk("Alfa brosur", "Alfa", w(4), 2, uc, 4)
    ids["SD"] = mk("Alfa desain", "Alfa", w(1), 3, ub, 3)
    ids["P"] = mk("Beta pondasi", "Beta", w(0), 2, ud, 4)
    ids["Q"] = mk("Beta rangka", "Beta", w(2), 2, ud, 6, deps=[(ids["P"], "FS", 0)])  # konsisten saat Otomatis menyala
    ids["G1"] = mk("Gamma laporan", "Gamma", w(-5), 2, ud, 7)
    for k in range(2):  # 2 pomodoro selesai → sisa 5
        hd.api(base, ua, "POST", "/api/tasks/%d/pomodoros" % ids["G1"], json={
            "client_id": "e2e1d1-g1-%d" % k, "kind": "session", "pomodoros": 1, "focus_seconds": 1500, "log_date": iso(TODAY),
            "ended_at": datetime.datetime.now(datetime.timezone.utc).isoformat()})
    ids["G2"] = mk("Gamma uji", "Gamma", w(-2), 5, ud, 5, actual=w(-2))
    ids["G3"] = mk("Gamma rilis besar", "Gamma", w(1), 4, ud, 24)
    ids["G4"] = mk("Gamma audit", "Gamma", w(30), 2, ud, 2)
    ids["U"] = mk("Delta rapat", "Delta", w(1), 1, None, 2)
    ids["K1"] = mk("Pribadi ringkas", PRIV, w(0), 2, None, 3, list_id=None)
    # WP kinerja: Kappa 300 (100 akar + 200 penerus, 300 dependensi), Lambda 200 (100 akar + 100 penerus); 10 orang.
    people = [ua, ub, uc, ud] + extra
    t_seed = time.time()
    n_dep[0] = 0
    kr, i_all = [], [0]

    def mkp(title, project, start, dur, deps=()):
        i_all[0] += 1
        return mk(title, project, start, dur, people[i_all[0] % 10], 1 + i_all[0] % 4, list_id=wp_id, deps=deps)
    for k in range(100):
        kr.append(mkp("Kappa akar %03d" % k, "Kappa", w(k % 10), 1 + k % 3))
    for i in range(200):
        deps = [(kr[i % 100], TYPES[i % 4], i % 3)]
        if i < 100:
            deps.append((kr[(i * 7 + 3) % 100], TYPES[(i + 1) % 4], 0))
        mkp("Kappa turunan %03d" % i, "Kappa", w(14 + i % 5), 1 + i % 3, deps)
    lr = [mkp("Lambda akar %03d" % k, "Lambda", w(k % 8), 1 + k % 2) for k in range(100)]
    for i in range(100):
        mkp("Lambda turunan %03d" % i, "Lambda", w(12 + i % 4), 2, [(lr[i], TYPES[i % 4], 1)])
    info("setup seed WP (detik, dependensi)", [round(time.time() - t_seed, 1), n_dep[0]])
    for u in (ua, ub, uc):
        hd.api(base, u, "PUT", "/api/plugins/state/%s" % PID, json={"enabled": True})
    srv = server_tasks(base, ua)
    in_wp = [t for t in srv.values() if (t["title"] or "").startswith(("Kappa", "Lambda"))]
    # hari merah Dewi yang diharapkan (kapasitas 0, setelah skenario 1) untuk daftar HP: dari tanggal TERSIMPAN
    dewi = [(ids[k], s, dur, est, done) for k, s, dur, est, done in (("G1", w(-5), 2, 7, 2), ("G2", w(-2), 5, 5, 0),
                                                                       ("G3", w(1), 4, 24, 0), ("G4", w(30), 2, 2, 0),
                                                                       ("P", w(0), 2, 4, 0), ("Q", w(4), 2, 6, 0))]
    exp = distribute([(s, w_add(s, dur - 1), est - done) for _, s, dur, est, done in dewi], T0)
    ids["dewi_days"] = [(d, fmt_pomo(v, True)) for d, v in sorted(exp.items())]
    check("setup: 4 anggota W (Rani pemilik, Sari, Tono, Dewi) + 6 anggota WP; Timeline ON U1–U3; W 10 task + Pribadi 1; WP %d task "
          "+ %d dependensi; Gamma laporan pomodoros_done %s; T = %s; hari merah Dewi diharapkan %r"
          % (len(in_wp), n_dep[0], srv[ids["G1"]]["done"], short(T0), [(short(d), b) for d, b in ids["dewi_days"]]),
          len(in_wp) == 500 and n_dep[0] == 400 and srv[ids["G1"]]["done"] == 2 and srv[ids["G3"]]["est"] == 24)
    return {"a": ua, "b": ub, "c": uc, "d": ud}, ids


def w_add(d, n):
    """Hari kerja ke-n setelah d (d hari kerja)."""
    while n:
        d += datetime.timedelta(days=1)
        if is_work(d):
            n -= 1
    return d


def console_checks():
    allowed = re.compile(r"Failed to load resource|net::ERR_")
    bad = [(dv, t, x[:220]) for dv, t, x in c0.console_log if t in ("error", "pageerror") and not allowed.search(x)]
    info("konsol: error/peringatan (perangkat, jenis, teks)", [(dv, t, x[:160]) for dv, t, x in c0.console_log
                                                               if t in ("error", "pageerror", "warning")][:24])
    check("11 konsol tanpa galat aplikasi (selain request di-abort yang disengaja)", not bad, repr(bad[:6]))


def main():
    if os.environ.get("TZ") != "Asia/Jakarta":
        print("PERINGATAN: jalankan dengan TZ=Asia/Jakarta", flush=True)
    os.makedirs(SHOTS, exist_ok=True)
    for fn in os.listdir(SHOTS):
        if fn.endswith(".png"):
            os.remove(os.path.join(SHOTS, fn))
    tmp = tempfile.mkdtemp(prefix="e2e_plugin_fase1_1d1_")
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
    try:
        users, ids = seed(base, db_path)
        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            for name, fn in (("main", lambda: run(browser, base, users, ids)),
                             ("old", lambda: run_old_client(browser, base, users["b"], ids)),
                             ("mobile", lambda: run_mobile(browser, base, users["a"], ids)),
                             ("perf", lambda: run_perf(browser, base, users["a"], ids))):
                if name in SKIP:
                    print("LEWATI", name, flush=True)
                    continue
                try:
                    fn()
                except Exception as e:  # satu kelompok gagal tidak menghentikan yang lain
                    import traceback
                    traceback.print_exc()
                    check("%s exception" % name, False, "%s: %s" % (type(e).__name__, e))
            final = server_res(base, users["a"])
            want_ids = sorted(res_id(ids["ws"], users[k]["id"]) for k in ("b", "c", "d"))
            check("akhir: record resource di server hanya yang disimpan eksplisit (Dewi lewat API, Sari dan Tono lewat Simpan): %r"
                  % sorted(final), sorted(final) == want_ids, repr(sorted(final)))
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
    print("\n%d langkah, %d gagal" % (len(hd.results), len(failed)), flush=True)
    for r in failed:
        print("GAGAL:", r[0], "—", r[2][:400])
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
