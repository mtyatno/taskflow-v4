"""E2E PR 1d-2 (Timeline 1.4: earned value 🍅 dari baseline aktif + ekspor Microsoft Project .xml). Rencana
docs/superpowers/plans/2026-11-10-plugin-fase1-pr-1d-2.md Task 7 (skenario minimum 1–7; R1, R2, R5–R9). Tidak dijalankan CI.

    E2E_PYTHON=$(which python3) TZ=Asia/Jakarta python3 temporary_files/e2e_plugin_fase1_1d2.py
    E2E_SKIP=perf,old ...   # lewati kelompok (clock, native, mobile, old, perf) saat iterasi

Memakai helper `e2e_plugin_fase1_1c0.py` + `e2e_plugin_fase1_1c1.py` (server uvicorn lokal `webapp:app` + DB SQLite
sementara + Chromium; tiap "perangkat" = satu `browser.new_context(service_workers="block")`, IndexedDB terpisah). Server
dijalankan dengan `TZ=Etc/UTC` (paritas VPS); peramban dan skrip memakai Asia/Jakarta. Spy tulisan (pola 1d-1): setiap
request non-GET ke /api/ dicatat per perangkat; "tulisan data" = /api/tasks* dan POST /api/plugins/<id>/records.
Verifikasi MPXJ = subprocess `mspdi_check.py --file <unduhan> --json <hasil>` atas berkas UNDUHAN nyata.

Pengguna: U1 "Rani" (pemilik W "Tim Pemasaran" + WP "Ruang Kinerja"; perangkat A 1280 terang, E jam palsu, N native,
M 375 Sakura gelap, P kinerja), U2 "Sari" (anggota; B jam palsu, OLD = klien 1.3 dipatok 847067e, B14 pembanding DOM),
U3 "Tono" (anggota). Seed (T = hari kerja pertama ≥ hari ini, w(n) = hari kerja ke-n dari T, libur nasional ikut):
  W / "Kampanye Akhir Tahun" (Otomatis, dinyalakan lewat UI): Riset audiens (selesai, aktual) →FS+1 Konsep kreatif
  (berjalan 40 %) →SS+2 Produksi konten →FF Peluncuran kampanye (milestone) →FS+2 Laporan kampanye; Produksi →SF+3 Siaran
  pers; Konsep →FS−1 Desain spanduk (SNET); Audit anggaran (MFO); Materi Natal (melintasi libur 24–25 Des). Tanggal
  tersimpan = ES hitungan skrip (cermin aturan dependensi spec 1c §5.3) → menyalakan Otomatis tanpa pratinjau/drift.
  W / "Situs Web" (Manual bawaan): Halaman produk (ringkasan) ⊃ Tata letak halaman →FS Penulisan teks, Uji tampilan (tanpa
  jadwal); Rilis situs (milestone, dependensi ke task tanpa jadwal → "1 tautan dilewati"); Perbaikan tautan rusak.
  Pribadi "Rencana Pribadi" (3 task, milestone); WP: Kappa 200 + Lambda 100 task, 150 dependensi.

   1 EV: A tanpa baseline → tanpa `.plg-timeline-ev`; "Baseline 1" (2 unit, nama sama) → teks + title + aria-label = hitungan
     manual INDEPENDEN (BAC/PV/EV/AC dari baris baseline harapan × hari kerja kalender + libur, progres/🍅 server);
     progres/🍅/selesai lewat API → angka baru; Filter (Assignee, Project, Cari) tidak mengubah teks; "Tidak ada" → hilang;
     E (jam palsu, maju 3 hari kerja) → angka D baru; B (Sari, jam sama) → teks sama; pribadi: baseline ber-w 0 (BAC 0) →
     tidak tampil, baseline lain tampil.
   2 Ekspor web: unduhan (expect_download) W + pribadi — nama `{judul}-{YYYY-MM-DD}.xml`, toast persis (+ "1 task tanpa
     jadwal ditandai perkiraan" + "1 tautan dilewati"), xml.etree (struktur, kelompok tingkat 1, jumlah task/tautan),
     MPXJ atas berkas unduhan (generik + jumlah, Start/Finish = harapan = bar, durasi, milestone, %, aktual, kendala,
     tipe + lag, libur dari <Exceptions>, baseline, resource/assignment), dua ekspor berturut identik byte.
   3 Native: `window.__TAURI__` disuntik sebelum muat → toast "Ekspor tersedia di alurik.com lewat browser", 0 unduhan.
   4 Nol tulisan: A membuka Gantt, baseline, EV, filter, 2 ekspor, 2 sinkron → 0 tulis data; E/B/N/M/P/OLD juga 0.
   5 Klien 1.3 (OLD, dipatok 847067e): baseline 1.4 + resource terbaca, tanpa EV/Lainnya desktop, 0 tulis, record utuh.
   6 Tampilan: 375 px Sakura gelap (Lainnya diakhiri Ekspor, menu + EV di dalam layar, scrollWidth ≤ 375, unduhan = A);
     1280 px terang (Lainnya desktop = tepat Ekspor).
   7 Kinerja: klik → unduhan WP 300 task CPU 4× ≤ 1 dtk; DOM awal 1.4 − 1.3 = tepat +EV +Lainnya.
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
import xml.etree.ElementTree as ET
from collections import Counter

import requests
from playwright.sync_api import sync_playwright

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import e2e_hero_dashboard as hd  # noqa: E402
import e2e_plugin_fase1_1c0 as c0  # noqa: E402
import e2e_plugin_fase1_1c1 as c1  # noqa: E402  (memasang c1.watch ke c0.watch)

SHOTS = c0.SHOTS = os.path.join(hd.ROOT, "temporary_files", "e2e_plugin_fase1_1d2")
SAMPLE = os.path.join(SHOTS, "contoh-ekspor-workspace.xml")
MSPDI_CHECK = os.path.join(hd.ROOT, "temporary_files", "mspdi_check.py")
PIN = "847067e"  # merge PR #130 (1d-1) = Timeline 1.3.0, SW v501 (bukan ref bergerak)
PID = c0.PID
WS, WP, PRIV = "Tim Pemasaran", "Ruang Kinerja", "Rencana Pribadi"
KA, SWP = "Kampanye Akhir Tahun", "Situs Web"
BL_NAME, BL_PRIV, BL_ZERO = "Rencana awal", "Rencana pribadi", "Tanpa target"
EXPORT = "Ekspor ke Microsoft Project (.xml)"
MSG_NATIVE = "Ekspor tersedia di alurik.com lewat browser"
CPU_RATE = 4
EXPORT_BUDGET_MS = 1000
JKT = datetime.timezone(datetime.timedelta(hours=7))
SKIP = set(x.strip() for x in os.environ.get("E2E_SKIP", "").split(",") if x.strip())
SNET, MSO, MFO, ASAP = "START_NO_EARLIER_THAN", "MUST_START_ON", "MUST_FINISH_ON", "AS_SOON_AS_POSSIBLE"
LINK = {"FS": "FINISH_START", "SS": "START_START", "FF": "FINISH_FINISH", "SF": "START_FINISH"}

check, info, nap, wait_until = hd.check, c0.info, c0.nap, c0.wait_until
sync_now, shot, short = c0.sync_now, c0.shot, c1.short

# ── kalender (Sen–Jum + libur nasional/cuti bersama SKB di rentang uji; bawaan kalender halaman) ──────────────────────
HOLI = {"2026-12-24", "2026-12-25", "2027-01-01", "2027-01-05", "2027-02-05"}
TODAY = datetime.datetime.now(JKT).date()
DAY = datetime.timedelta(days=1)


def is_work(d):
    return d.weekday() < 5 and d.isoformat() not in HOLI


def next_work(d):
    while not is_work(d):
        d += DAY
    return d


def prev_work(d):
    while not is_work(d):
        d -= DAY
    return d


def add_work(d, k):
    """Maju/mundur k hari kerja dari d (d sendiri tidak dihitung; k = 0 → d)."""
    if not k:
        return d
    step, left = (DAY, k) if k > 0 else (-DAY, -k)
    while True:
        d += step
        if is_work(d):
            left -= 1
            if left == 0:
                return d


def fin(s, d):
    return s if d == 0 else add_work(next_work(s), d - 1)


def sff(f, d):
    return f if d == 0 else add_work(prev_work(f), -(d - 1))


def hk(a, b):
    """Hari kerja di [a, b] inklusif."""
    n, d = 0, a
    while d <= b:
        n += 1 if is_work(d) else 0
        d += DAY
    return n


def dep_req(typ, pes, pef, lag, d):
    """ES terkecil penerus berdurasi d (cermin aturan spec 1c §5.3 untuk MENYIMPAN tanggal = ES, sehingga menyalakan
    Otomatis tidak menggeser apa pun). FS/SS: pemanggil menjepret ke hari kerja bila d ≥ 1."""
    if typ == "FS":
        return add_work(next_work(pef + DAY), lag)
    if typ == "SS":
        return add_work(next_work(pes), lag)
    e = add_work(pef, lag) if typ == "FF" else add_work(prev_work(pes - DAY), lag)
    if d >= 1:
        e = next_work(e)
    return sff(e, d)


T0 = next_work(TODAY)


def w(n):
    """Hari kerja ke-n dari T0 (n negatif = mundur)."""
    return add_work(T0, n)


def iso(d):
    return d.isoformat()


SHORT2DATE = {short(TODAY + datetime.timedelta(days=k)): TODAY + datetime.timedelta(days=k) for k in range(-90, 200)}


def js_round(x):
    return math.floor(x + 0.5)


def jkt_day(v):
    """completed_at (ISO; tanpa zona = UTC, pola TLSched.jkt) → tanggal Asia/Jakarta."""
    m = re.match(r"^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})?$", (v or "").strip())
    if not m:
        return None
    t = datetime.datetime.fromisoformat(m.group(1) + "T" + m.group(2) + ":" + m.group(3) + ":" + (m.group(4) or "00"))
    z = m.group(5)
    if z and z != "Z":
        sign = 1 if z[0] == "+" else -1
        hh, mm = int(z[1:3]), int(z[-2:])
        t -= sign * datetime.timedelta(hours=hh, minutes=mm)
    return (t + datetime.timedelta(hours=7)).date()


# ── hitungan manual earned value (INDEPENDEN dari TLLoad; spec 1d §5.3 / rencana R1) ─────────────────────────────────

def ev_manual(rows, srv, D):
    """rows = [(id, s, f, d, w)] baris baseline harapan; srv = keadaan task server; D = tanggal hari ini perangkat.
    Milipomodoro dibulatkan per baris lalu dijumlah."""
    bac = pv = ev = ac = 0
    for tid, s, f, d, wt in rows:
        t = srv[tid]
        wm = wt * 1000
        bac += wm
        if D < s:
            pv_r = 0
        elif d == 0:
            pv_r = wm
        else:
            den, num = hk(s, f), hk(s, min(f, D))
            pv_r = wm if den == 0 else js_round(wm * num / den)
        pv += pv_r
        pct = 100 if t["done"] else max(0, min(100, t["progress"] or 0))
        ev += js_round(wm * pct / 100)
        ac += (t["pomodoros_done"] or 0) * 1000
    return {"bac": bac, "pv": pv, "ev": ev, "ac": ac, "spi": ev / pv if pv else None, "cpi": ev / ac if ac else None}


def pct_text(q):
    return "—" if q is None else "%d%%" % js_round(q * 100)


def fmt1(milli):
    h = js_round(milli / 100) / 10
    return str(int(h)) if float(h).is_integer() else repr(h)


def ev_want(r, name, outside):
    text = "Jadwal %s · Efisiensi 🍅 %s" % (pct_text(r["spi"]), pct_text(r["cpi"]))
    tip = "Baseline: %s · PV %s · EV %s · AC %s · BAC %s 🍅" % (name, fmt1(r["pv"]), fmt1(r["ev"]), fmt1(r["ac"]), fmt1(r["bac"]))
    if outside:
        tip += " · %d task di luar baseline" % outside
    return {"text": text, "title": tip, "aria": text + " · " + tip}


# ── spy tulisan (pola 1d-1): semua request non-GET ke /api/ per perangkat ─────────────────────────────────────────────
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
    return [(x[0], x[1], x[2]) for x in WRITES if x[0] in labels and x[4] >= since and is_data_write(x)]


def other_writes(labels, since):
    return sorted(set((x[0], x[1], x[2]) for x in WRITES if x[0] in labels and x[4] >= since and not is_data_write(x)))


# Toast host (`.toast`, teks persis, urut) + event bus plugin (app.dayChanged) per halaman. Urutan, bukan Date.now(): jam
# palsu perangkat E/B.
MY_INIT = r"""(() => { window.__toastLog = []; window.__ev = [];
  const scan = (n) => { if (!n || n.nodeType !== 1) return;
    const els = n.classList.contains('toast') ? [n] : Array.from(n.querySelectorAll('.toast'));
    for (const e of els) window.__toastLog.push(e.textContent); };
  new MutationObserver((ms) => { for (const m of ms) for (const n of m.addedNodes || []) scan(n); })
    .observe(document, { childList: true, subtree: true });
  const iv = setInterval(() => { const E = window.TF && window.TF.events; if (window.__evOn || !E || typeof E.on !== 'function') return;
    window.__evOn = true; clearInterval(iv);
    E.on('app.dayChanged', (p) => window.__ev.push(['app.dayChanged', p && p.date ? p.date : null])); }, 20);
})();"""


def new_ctx(browser, base, clock=None, tauri=False, **kw):
    ctx = c0.new_context(browser, base, **kw)
    ctx.add_init_script(MY_INIT)
    if tauri:
        ctx.add_init_script("window.__TAURI__ = {};")  # shell native (Tauri) disuntik sebelum muat
    if clock is not None:
        ctx.clock.install(time=clock)
    return ctx


def open_dev(browser, base, user, label, **kw):
    ctx = new_ctx(browser, base, **kw)
    return ctx, c0.open_page(ctx, base, user, label)


def toast_n(p):
    return p.evaluate("() => window.__toastLog.length")


def toasts_since(p, n0):
    return p.evaluate("(n) => window.__toastLog.slice(n)", n0)


# ── Timeline: EV, Lainnya, baseline, bar ─────────────────────────────────────────────────────────────────────────────
EV_JS = """() => { const e = document.querySelector('.plg-timeline-ev'); if (!e) return null; const r = e.getBoundingClientRect();
  const tb = document.querySelector('.plg-timeline-toolbar');
  return { text: e.textContent, title: e.getAttribute('title'), aria: e.getAttribute('aria-label'), role: e.getAttribute('role'),
    next: e.nextElementSibling ? e.nextElementSibling.textContent : null, inEnd: !!e.closest('.plg-timeline-toolbar-end'),
    box: [Math.round(r.left), Math.round(r.right), Math.round(r.top), Math.round(r.bottom)], iw: innerWidth, ih: innerHeight,
    tbOver: tb ? tb.scrollWidth - tb.clientWidth : null, sw: document.documentElement.scrollWidth }; }"""


def ev_state(p):
    return p.evaluate(EV_JS)


def ev_text(p):
    return (ev_state(p) or {}).get("text")


def more_open(p):
    more = p.locator(".plg-timeline-more > button")
    more.wait_for(state="visible", timeout=20000)
    menu = p.locator(".plg-timeline-more-menu[role=menu]")
    if not menu.count():
        more.click()
    menu.wait_for(state="visible", timeout=8000)
    return menu


MENU_JS = """() => { const m = document.querySelector('.plg-timeline-more-menu'); if (!m) return null; const r = m.getBoundingClientRect();
  return { items: Array.from(m.querySelectorAll('[role^=menuitem]')).map((b) => [b.textContent, b.getAttribute('role'), b.disabled]),
    box: [Math.round(r.left), Math.round(r.right), Math.round(r.top), Math.round(r.bottom)], iw: innerWidth,
    sw: document.documentElement.scrollWidth, nMore: document.querySelectorAll('.plg-timeline-more').length }; }"""


def menu_state(p):
    more_open(p)
    return p.evaluate(MENU_JS)


def click_export(p):
    menu = more_open(p)
    it = menu.locator("[role=menuitem]", has_text=re.compile("^" + re.escape(EXPORT) + "$")).first
    it.wait_for(state="visible", timeout=8000)
    wait_until(lambda: it.is_enabled(), 20, 0.3)
    it.click()


def export_dl(p, dest_dir, tag):
    """Lainnya → Ekspor (gestur) → unduhan nyata. Kembalikan (nama, path, bytes, toast sesudahnya)."""
    n0 = toast_n(p)
    with p.expect_download(timeout=20000) as dli:
        click_export(p)
    dl = dli.value
    os.makedirs(dest_dir, exist_ok=True)
    path = os.path.join(dest_dir, "%s-%s" % (tag, dl.suggested_filename))
    dl.save_as(path)
    with open(path, "rb") as fh:
        data = fh.read()
    wait_until(lambda: toasts_since(p, n0), 8, 0.2)
    return dl.suggested_filename, path, data, toasts_since(p, n0)


def open_picker(p):
    """Pemilih Baseline: desktop = tombol Baseline; ≤ 640 px = Lainnya → Baseline."""
    pick = p.locator(".plg-timeline-blpick")
    if pick.count():
        return pick
    if p.locator(".plg-timeline-toolbar .plg-timeline-blbtn").count():
        p.locator(".plg-timeline-blbtn").click()
    else:
        menu = more_open(p)
        menu.locator("[role^=menuitem]", has_text=re.compile("^Baseline$")).first.click()
    pick.wait_for(state="visible", timeout=8000)
    return pick


def picker_items(p):
    pick = open_picker(p)
    items = pick.locator("[role=menuitemradio]").all_inner_texts()
    p.keyboard.press("Escape")
    pick.wait_for(state="detached", timeout=8000)
    return items


def pick_baseline(p, label):
    """Pilih item `label` di pemilih Baseline; kembalikan daftar item."""
    pick = open_picker(p)
    items = pick.locator("[role=menuitemradio]").all_inner_texts()
    pick.locator("[role=menuitemradio]", has_text=re.compile("^" + re.escape(label) + "$")).first.click()
    pick.wait_for(state="detached", timeout=8000)
    p.wait_for_timeout(400)
    return items


def save_baseline(p, unit, n, name):
    """Dialog Simpan baseline (slot KOSONG): pilih unit (workspace) + slot + nama → Simpan → dialog tertutup."""
    p.locator(".plg-timeline-toolbar button", has_text=re.compile("^Simpan baseline$")).first.click()
    dlg = p.locator(".plg-timeline-bl-dlg")
    dlg.wait_for(state="visible", timeout=10000)
    if unit and dlg.locator(".plg-timeline-bl-units").count():
        dlg.locator(".plg-timeline-bl-units [role=radio]", has_text=re.compile("^" + re.escape(unit) + "$")).first.click()
    wait_until(lambda: not dlg.locator(".plg-timeline-bl-slots [role=radio]").nth(n - 1).is_disabled(), 20, 0.3)
    dlg.locator(".plg-timeline-bl-slots [role=radio]").nth(n - 1).click()
    dlg.locator(".plg-timeline-bl-name").fill(name)
    dlg.locator(".plg-timeline-pv-apply").click()
    dlg.wait_for(state="detached", timeout=15000)
    p.wait_for_timeout(400)


BAR_JS = """(k) => { const b = document.querySelector(".plg-timeline-bar[data-key='" + k + "'], .plg-timeline-milestone[data-key='" + k + "']");
  return b ? b.getAttribute('aria-label') : null; }"""
BAR_RE = re.compile(r"^(.*), (\S+ \d+ \S+) sampai (\S+ \d+ \S+), (\d+) hari kerja")
MS_RE = re.compile(r"^(.*), milestone (\S+ \d+ \S+)$")


def bar_span(p, tid):
    """(mulai, selesai) tanggal bar Gantt dari aria-label (milestone: mulai = selesai)."""
    c1.reveal(p, tid)
    lbl = p.evaluate(BAR_JS, str(tid))
    m = MS_RE.match(lbl or "")
    if m:
        d = SHORT2DATE.get(m.group(2))
        return d, d, lbl
    m = BAR_RE.match(lbl or "")
    return (SHORT2DATE.get(m.group(2)), SHORT2DATE.get(m.group(3)), lbl) if m else (None, None, lbl)


def bars_visible(p):
    return p.evaluate("() => document.querySelectorAll('.plg-timeline-bar[data-key], .plg-timeline-milestone[data-key]').length")


# ── server ────────────────────────────────────────────────────────────────────────────────────────────────────────────

def server_tasks(base, user):
    r = hd.api(base, user, "GET", "/api/tasks?include_done=true")
    items = r if isinstance(r, list) else r.get("tasks", [])
    out = {}
    for t in items:
        out[t["id"]] = {"title": t.get("title"), "progress": t.get("progress") or 0, "pomodoros_done": t.get("pomodoros_done") or 0,
                        "done": t.get("gtd_status") == "done" or bool(t.get("completed_at")), "completed_at": t.get("completed_at"),
                        "est": t.get("estimated_pomodoros")}
    return out


def server_recs(base, user):
    r = hd.api(base, user, "GET", "/api/plugins/%s/records?limit=1000" % PID)
    return {x["id"]: x for x in r.get("items", []) if not x.get("deleted")}


def rec_sig(recs):
    return {k: (v.get("version"), v.get("updated_at"), json.dumps(v.get("data"), sort_keys=True)) for k, v in recs.items()}


def post_rec(base, user, entity, rid, scope, data):
    ua = datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    return hd.api(base, user, "POST", "/api/plugins/%s/records" % PID, json={"items": [
        {"entity": entity, "id": rid, "scope": scope, "data": data, "updated_at": ua}]})


def pomo(base, user, tid, k):
    hd.api(base, user, "POST", "/api/tasks/%d/pomodoros" % tid, json={
        "client_id": "e2e1d2-%d-%d" % (tid, k), "kind": "session", "pomodoros": 1, "focus_seconds": 1500, "log_date": iso(TODAY),
        "ended_at": datetime.datetime.now(datetime.timezone.utc).isoformat()})


def bl_rows_of(rec):
    """Baris record baseline server → {task id: (s, f, d, w)}."""
    out = {}
    for e in (rec.get("data") or {}).get("t") or []:
        ref = e[0].get("$task") if isinstance(e[0], dict) else e[0]
        try:
            ref = int(ref)
        except (TypeError, ValueError):
            pass
        out[ref] = (e[1], e[2], e[3], e[4] if len(e) > 4 else None)
    return out


# ── MPXJ atas berkas unduhan ──────────────────────────────────────────────────────────────────────────────────────────

def mpxj(path, tmp):
    j = path + ".mpxj.json"
    r = subprocess.run([sys.executable, "-I", MSPDI_CHECK, "--file", path, "--json", j], cwd=tmp, capture_output=True, text=True,
                       timeout=600)
    data = None
    if os.path.exists(j):
        with open(j, encoding="utf-8") as fh:
            data = json.load(fh)
    lines = [ln for ln in r.stdout.splitlines() if "GAGAL" in ln or "BEDA" in ln or "elemen diperiksa" in ln or "CEK" in ln]
    return r.returncode, data, lines


def pt(d, finish=False):
    return iso(d) + ("T17:00" if finish else "T08:00")


def xml_struct(data):
    ns = "{http://schemas.microsoft.com/project}"
    root = ET.fromstring(data)
    tv = lambda el, n: (el.find(ns + n).text if el.find(ns + n) is not None else None)  # noqa: E731
    tasks = [t for t in root.find(ns + "Tasks")]
    return {"root": root.tag, "blocks": [c.tag[len(ns):] for c in root][-4:], "name": tv(root, "Name"), "title": tv(root, "Title"),
            "prolog": data.decode("utf-8").split("\n", 1)[0],
            "tasks": [(tv(t, "UID"), tv(t, "Name"), tv(t, "OutlineLevel"), tv(t, "OutlineNumber"), tv(t, "Summary")) for t in tasks],
            "links": sum(len(t.findall(ns + "PredecessorLink")) for t in tasks),
            "resources": len(list(root.find(ns + "Resources"))), "assignments": len(list(root.find(ns + "Assignments"))),
            "exceptions": len(list(root.find(ns + "Calendars").find(ns + "Calendar").find(ns + "Exceptions") or []))}


def xml_rescal(data):
    """Uji pemilik F4: resource → CalendarUID, kalender resource (UID, Name, IsBaseCalendar, BaseCalendarUID), placeholder SW3."""
    ns = "{http://schemas.microsoft.com/project}"
    root = ET.fromstring(data)
    tv = lambda el, n: (el.find(ns + n).text if el.find(ns + n) is not None else None)  # noqa: E731
    cals = [c for c in root.find(ns + "Calendars")]
    sw3 = next((t for t in root.find(ns + "Tasks") if tv(t, "Name") == "Uji tampilan"), None)
    return {"res": [[int(tv(r, "UID")), tv(r, "Name"), int(tv(r, "CalendarUID") or 0)] for r in root.find(ns + "Resources")],
            "cals": [[int(tv(c, "UID")), tv(c, "Name"), tv(c, "IsBaseCalendar"), tv(c, "BaseCalendarUID")] for c in cals[1:]],
            "sw3": None if sw3 is None else [tv(sw3, "Manual"), tv(sw3, "Estimated"), tv(sw3, "DurationFormat")]}


# ── seed ──────────────────────────────────────────────────────────────────────────────────────────────────────────────

def plan_ws():
    """Definisi task W + tanggal harapan mesin (es, ef). Otomatis: tanggal tersimpan = ES hitungan skrip."""
    hol = min(datetime.date.fromisoformat(h) for h in HOLI if datetime.date.fromisoformat(h) > w(10))
    xmas = add_work(prev_work(hol - DAY), -1)  # dua hari kerja sebelum libur pertama setelah w(10)
    P = {}
    P["KA1"] = dict(title="Riset audiens", project=KA, s=w(-6), d=4, who="b", est=4, actual=(w(-6), w(-3)), done=True)
    es2 = next_work(dep_req("FS", P["KA1"]["s"], w(-3), 1, 3))
    P["KA2"] = dict(title="Konsep kreatif", project=KA, s=es2, d=3, who="a", est=6, deps=[("KA1", "FS", 1)], progress=40)
    es3 = next_work(dep_req("SS", es2, fin(es2, 3), 2, 5))
    P["KA3"] = dict(title="Produksi konten", project=KA, s=es3, d=5, who="c", est=10, deps=[("KA2", "SS", 2)])
    es4 = dep_req("FF", es3, fin(es3, 5), 0, 0)
    P["KA4"] = dict(title="Peluncuran kampanye", project=KA, s=es4, d=0, who="a", deps=[("KA3", "FF", 0)])
    es5 = next_work(dep_req("FS", es4, es4, 2, 2))
    P["KA5"] = dict(title="Laporan kampanye", project=KA, s=es5, d=2, who="b", est=3, deps=[("KA4", "FS", 2)])
    es6 = dep_req("SF", es3, fin(es3, 5), 3, 1)
    P["KA6"] = dict(title="Siaran pers", project=KA, s=es6, d=1, who="b", est=2, deps=[("KA3", "SF", 3)])
    snet7 = w(4)
    es7 = next_work(max(dep_req("FS", es2, fin(es2, 3), -1, 2), snet7))
    P["KA7"] = dict(title="Desain spanduk", project=KA, s=es7, d=2, who="c", est=3, deps=[("KA2", "FS", -1)], cst=("SNET", snet7))
    mfo8 = w(12)
    P["KA8"] = dict(title="Audit anggaran", project=KA, s=sff(prev_work(mfo8), 2), d=2, who="a", est=2, cst=("MFO", mfo8))
    P["KA9"] = dict(title="Materi Natal", project=KA, s=xmas, d=4, who="b", est=4)
    # Uji pemilik #2 F6 (H1): task TANPA penanggung jawab — terjadwal 0 % tanpa tautan (tanpa assignment sama sekali) dan
    # 50 % (assignment semu ResourceUID -65535); "Cadangkan situs lama" di project Manual selesai 100 % (semu + ActualFinish).
    P["KA10"] = dict(title="Rapat evaluasi", project=KA, s=w(8), d=2, who=None)
    P["KA11"] = dict(title="Kumpulkan testimoni", project=KA, s=w(-1), d=4, who=None, progress=50)
    # Review F7 butir 4: task BERJALAN (40 %, mulai awal pekan ≤ D) yang pendahulu FS-nya ("Desain spanduk") belum mulai dan
    # selesai lebih lambat dari mulai task ini → mesin: tetap di tempat (konflik ditandai). Ekspor: tautan FS 0 tetap ada,
    # SNET + ActualStart, bukan Manual; <SplitsInProgressTasks>0 menjaga MS Project tidak memecah sisa kerjanya.
    P["KA12"] = dict(title="Unggah materi", project=KA, s=w(-2), d=3, who="c", est=3, deps=[("KA7", "FS", 0)], progress=40)
    P["SW0"] = dict(title="Halaman produk", project=SWP, s=None, d=None, who=None)
    P["SW1"] = dict(title="Tata letak halaman", project=SWP, s=w(0), d=3, who="a", est=3, parent="SW0")
    P["SW2"] = dict(title="Penulisan teks", project=SWP, s=w(3), d=2, who="b", est=2, parent="SW0", deps=[("SW1", "FS", 0)])
    P["SW3"] = dict(title="Uji tampilan", project=SWP, s=None, d=None, who="c", est=2, parent="SW0")
    P["SW4"] = dict(title="Rilis situs", project=SWP, s=w(6), d=0, who="a", deps=[("SW3", "FS", 0)])
    P["SW5"] = dict(title="Perbaikan tautan rusak", project=SWP, s=w(-2), d=3, who="c", est=5, progress=30)
    P["SW6"] = dict(title="Cadangkan situs lama", project=SWP, s=w(-5), d=2, who=None, actual=(w(-5), w(-4)), done=True)
    for k, v in P.items():
        v.setdefault("est", 1)
        v["f"] = fin(v["s"], v["d"]) if v["s"] is not None else None
        if v.get("actual"):
            v["f"] = v["actual"][1]
    return P


def plan_priv():
    P = {}
    P["P1"] = dict(title="Susun anggaran rumah", s=w(0), d=2, est=2, progress=50)
    P["P2"] = dict(title="Bandingkan penawaran", s=w(2), d=1, est=1, deps=[("P1", "FS", 0)])
    P["P3"] = dict(title="Tenggat pembayaran", s=w(5), d=0, est=1, deps=[("P2", "FS", 0)])
    for v in P.values():
        v["f"] = fin(v["s"], v["d"])
    return P


def seed(base, db_path):
    ua = hd.seed(base, username="td2a", display_name="Rani")
    ub = hd.seed(base, username="td2b", display_name="Sari")
    uc = hd.seed(base, username="td2c", display_name="Tono")
    users = {"a": ua, "b": ub, "c": uc}
    ws_id = hd.api(base, ua, "POST", "/api/lists", json={"name": WS})["id"]
    wp_id = hd.api(base, ua, "POST", "/api/lists", json={"name": WP})["id"]
    with sqlite3.connect(db_path) as conn:
        now = datetime.datetime.now().isoformat()
        for lid in (ws_id, wp_id):
            for u in (ub, uc):
                conn.execute("INSERT INTO list_members (list_id, user_id, joined_at) VALUES (?,?,?)", (lid, u["id"], now))
    sess = requests.Session()
    sess.headers["Authorization"] = "Bearer " + ua["token"]
    ids = {"ws": ws_id, "wp": wp_id}

    def mk(v, list_id, refs):
        ext = {}
        if v.get("s") is not None:
            ext[PID + ".start"] = iso(v["s"])
            ext[PID + ".duration"] = v["d"]
        if v.get("actual"):
            ext[PID + ".actual"] = {"start": iso(v["actual"][0]), "finish": iso(v["actual"][1])}
        if v.get("cst"):
            ext[PID + ".constraint"] = {"type": v["cst"][0], "date": iso(v["cst"][1])}
        if v.get("deps"):
            ext[PID + ".deps"] = [{"t": {"$task": refs[k]}, "type": ty, "lag": lg} for k, ty, lg in v["deps"]]
        body = {"title": v["title"], "gtd_status": "next", "priority": "P3", "project": v.get("project", PRIV), "ext": ext,
                "estimated_pomodoros": v["est"]}
        if list_id:
            body["list_id"] = list_id
        if v.get("who"):
            body["assigned_to"] = users[v["who"]]["id"]
        if v.get("parent"):
            body["parent_id"] = refs[v["parent"]]
        r = sess.post(base + "/api/tasks", json=body, timeout=10)
        r.raise_for_status()
        tid = c0.task_id(r.json())
        if v.get("progress"):
            hd.api(base, ua, "PUT", "/api/tasks/%d" % tid, json={"progress": v["progress"]})
        if v.get("done"):
            hd.api(base, ua, "POST", "/api/tasks/%d/done" % tid)
        return tid

    P = plan_ws()
    for k, v in P.items():
        ids[k] = mk(v, ws_id, ids)
    Q = plan_priv()
    for k, v in Q.items():
        ids[k] = mk(v, None, ids)
    # WP kinerja: Kappa 200 (100 akar + 100 penerus), Lambda 100 (50 + 50); 150 dependensi FS/SS/FF/SF.
    t_seed = time.time()
    who = ["a", "b", "c"]
    n = [0]

    def mkp(title, project, s, d, deps=()):
        n[0] += 1
        v = dict(title=title, project=project, s=s, d=d, est=1 + n[0] % 4, who=who[n[0] % 3],
                 deps=[(k, ty, lg) for k, ty, lg in deps])
        return mk(v, wp_id, {k: k for k, _, _ in deps})
    types = ["FS", "SS", "FF", "SF"]
    kr = [mkp("Kappa langkah %03d" % i, "Kappa", w(i % 10), 1 + i % 3) for i in range(100)]
    for i in range(100):
        mkp("Kappa tindak lanjut %03d" % i, "Kappa", w(14 + i % 5), 1 + i % 3, [(kr[i], types[i % 4], i % 3)])
    lr = [mkp("Lambda langkah %03d" % i, "Lambda", w(i % 8), 1 + i % 2) for i in range(50)]
    for i in range(50):
        mkp("Lambda tindak lanjut %03d" % i, "Lambda", w(12 + i % 4), 2, [(lr[i], types[(i + 1) % 4], 1)])
    info("setup seed WP (detik, task)", [round(time.time() - t_seed, 1), n[0]])
    for u in users.values():
        hd.api(base, u, "PUT", "/api/plugins/state/%s" % PID, json={"enabled": True})
    srv = server_tasks(base, ua)
    check("setup: W '%s' (Rani pemilik, Sari + Tono anggota) %d task (2 project), pribadi '%s' %d task, WP %d task; Timeline ON "
          "U1–U3; T = %s; Riset audiens selesai, Konsep 40 %%" % (WS, len(P), PRIV, len(Q), n[0], short(T0)),
          all(ids[k] in srv for k in list(P) + list(Q)) and srv[ids["KA1"]]["done"] and srv[ids["KA2"]]["progress"] == 40
          and n[0] == 300, repr([(k, srv.get(ids[k])) for k in ("KA1", "KA2")]))
    return users, ids, P, Q


# ── harapan ekspor W (rencana R7/R8; nilai sesudah perubahan skenario 1) ──────────────────────────────────────────────

def bl_rows_ws(P, ids):
    """Baris baseline harapan (disimpan saat setup): simpul mesin terjadwal non-ringkasan, w = target 🍅."""
    rows = []
    for k, v in P.items():
        if v["s"] is None or k == "SW0":
            continue
        rows.append((ids[k], v["s"], v["f"], v["d"], v["est"]))
    return rows


def want_ws(P, ids, srv, D):
    """Harapan per task (nama) untuk berkas W yang diekspor pada hari D (sesudah perubahan skenario 1)."""
    W = {}

    def put(k, start, finish, dur, pct, ctype, cdate, manual=False, est=False, astart=None, afinish=None, preds=(), ms=False):
        W[P[k]["title"]] = dict(start=start, finish=finish, dur=float(dur), pct=float(pct), ctype=ctype, cdate=cdate, manual=manual,
                                est=est, astart=astart, afinish=afinish, preds=sorted(preds), ms=ms)
    t = lambda k: P[k]["title"]  # noqa: E731
    p = lambda k: P[k]  # noqa: E731
    ka1 = p("KA1")
    put("KA1", pt(ka1["s"]), pt(ka1["f"], True), 4, 100, SNET, pt(ka1["s"]), astart=pt(ka1["s"]), afinish=pt(ka1["f"], True))
    put("KA2", pt(p("KA2")["s"]), pt(p("KA2")["f"], True), 3, srv[ids["KA2"]]["progress"], SNET, pt(p("KA2")["s"]),
        astart=pt(p("KA2")["s"]), preds=[(t("KA1"), LINK["FS"], 1.0)])
    # Uji pemilik F4 B: tanpa MSO. KA3 (berjalan es > D) — SS+2 tidak menuntut lebih lambat → SNET di es; KA4 milestone FF 0
    # → di 17:00 hari selesai KA3 (hitungan MS Project) tanpa kendala; KA5 FS+2 dari milestone 17:00 = mesin → ASAP.
    put("KA3", pt(p("KA3")["s"]), pt(p("KA3")["f"], True), 5, 0, SNET, pt(p("KA3")["s"]), preds=[(t("KA2"), LINK["SS"], 2.0)])
    put("KA4", pt(p("KA4")["s"], True), pt(p("KA4")["s"], True), 0, 0, ASAP, None, preds=[(t("KA3"), LINK["FF"], 0.0)], ms=True)
    put("KA5", pt(p("KA5")["s"]), pt(p("KA5")["f"], True), 2, 0, ASAP, None, preds=[(t("KA4"), LINK["FS"], 2.0)])
    put("KA6", pt(p("KA6")["s"]), pt(p("KA6")["f"], True), 1, 0, ASAP, None, preds=[(t("KA3"), LINK["SF"], 3.0)])
    put("KA7", pt(p("KA7")["s"]), pt(p("KA7")["f"], True), 2, 0, SNET, pt(p("KA7")["cst"][1]), preds=[(t("KA2"), LINK["FS"], -1.0)])
    put("KA8", pt(p("KA8")["s"]), pt(p("KA8")["f"], True), 2, 0, MFO, pt(p("KA8")["cst"][1], True))
    put("KA9", pt(p("KA9")["s"]), pt(p("KA9")["f"], True), 4, 0, SNET, pt(p("KA9")["s"]))
    # Uji pemilik #2 F6: tanpa penanggung jawab — akar Otomatis 0 % (SNET di es); berjalan 50 % es ≤ D (ActualStart).
    put("KA10", pt(p("KA10")["s"]), pt(p("KA10")["f"], True), 2, 0, SNET, pt(p("KA10")["s"]))
    put("KA11", pt(p("KA11")["s"]), pt(p("KA11")["f"], True), 4, srv[ids["KA11"]]["progress"], SNET, pt(p("KA11")["s"]), astart=pt(p("KA11")["s"]))
    # Review F7: berjalan es ≤ D dengan pendahulu FS belum selesai → tanggal mesin (tetap), SNET di es, ActualStart, Otomatis.
    put("KA12", pt(p("KA12")["s"]), pt(p("KA12")["f"], True), 3, srv[ids["KA12"]]["progress"], SNET, pt(p("KA12")["s"]),
        astart=pt(p("KA12")["s"]), preds=[(t("KA7"), LINK["FS"], 0.0)])
    # F6: task Manual ber-% > 0 → ActualStart = Start (MS Project menyetelnya sendiri saat % diisi).
    put("SW1", pt(p("SW1")["s"]), pt(p("SW1")["f"], True), 3, srv[ids["SW1"]]["progress"], SNET, pt(p("SW1")["s"]), manual=True,
        astart=pt(p("SW1")["s"]) if srv[ids["SW1"]]["progress"] else None)
    put("SW2", pt(p("SW2")["s"]), pt(p("SW2")["f"], True), 2, 0, SNET, pt(p("SW2")["s"]), manual=True, preds=[(t("SW1"), LINK["FS"], 0.0)])
    ph = next_work(D)  # task tanpa jadwal: placeholder hari kerja pertama ≥ D
    put("SW3", pt(ph), pt(ph, True), 1, 0, SNET, pt(ph), est=True)  # F4 C: placeholder Otomatis + perkiraan
    put("SW4", pt(p("SW4")["s"]), pt(p("SW4")["s"]), 0, 0, SNET, pt(p("SW4")["s"]), manual=True, ms=True)
    s5 = p("SW5")["s"]
    f5 = max(s5, jkt_day(srv[ids["SW5"]]["completed_at"]) or p("SW5")["f"])
    put("SW5", pt(s5), pt(f5, True), hk(s5, f5), 100, SNET, pt(s5), manual=True, astart=pt(s5), afinish=pt(f5, True))
    s6, f6 = p("SW6")["actual"]  # selesai dengan aktual tersimpan (project Manual, tanpa penanggung jawab)
    put("SW6", pt(s6), pt(f6, True), hk(s6, f6), 100, SNET, pt(s6), manual=True, astart=pt(s6), afinish=pt(f6, True))
    return W


# ── skenario utama (A; EV, filter, nol tulisan, ekspor, pribadi) ───────────────────────────────────────────────────────

def run(browser, base, users, ids, P, Q, tmp, out):
    ua, ub, uc = users["a"], users["b"], users["c"]
    dl_dir = os.path.join(tmp, "unduhan")
    ctxs = []
    try:
        ca, a = open_dev(browser, base, ua, "A")
        ctxs.append(ca)
        # ── setup: Otomatis "Kampanye Akhir Tahun" lewat UI (tanggal tersimpan = ES → tanpa pratinjau/drift) ──
        c0.open_timeline(a, WS)
        c1.wait_engine(a)
        s0 = time.time()
        c1.toggle_unit(a, KA)
        pv = wait_until(lambda: a.locator(".plg-timeline-pv").count() > 0, 4, 0.3)
        if pv:
            info("setup pratinjau Otomatis (tak terduga — diterapkan)", c1.pv_info(a.locator(".plg-timeline-pv")))
            c1.pv_apply(a)
        a.keyboard.press("Escape")
        sync_now(a)
        prj = wait_until(lambda: [x for x in WRITES if x[0] == "A" and x[4] >= s0 and x[1] == "POST" and "records" in x[2]], 15, 0.3)
        c0.refresh_tasks(a)
        c1.wait_engine(a)
        a.wait_for_timeout(800)
        drift = c1.drift_banner(a)
        spans = {k: bar_span(a, ids[k]) for k, v in P.items() if v["s"] is not None and k != "SW0"}
        bad = [(k, (iso(s) if s else None, iso(f) if f else None), (iso(P[k]["s"]), iso(P[k]["f"])), lbl)
               for k, (s, f, lbl) in spans.items() if (s, f) != (P[k]["s"], P[k]["f"])]
        info("setup tanggal harapan (es, ef) per task", {k: (iso(v["s"]), iso(v["f"])) for k, v in P.items() if v["s"]})
        check("setup: A menyalakan Otomatis '%s' lewat UI (record project POST, TANPA pratinjau) → tanpa banner drift; tanggal bar "
              "Gantt %d task = hitungan skrip (cermin aturan dependensi FS/SS/FF/SF + lag, SNET, MFO, libur)" % (KA, len(spans)),
              prj and not pv and not drift and not bad, repr((bool(prj), bool(pv), drift, bad)))
        # baseline slot 1 "Rencana awal" untuk kedua unit (UI)
        sync_now(a)
        s_bl = time.time()
        save_baseline(a, KA, 1, BL_NAME)
        save_baseline(a, SWP, 1, BL_NAME)
        sync_now(a)
        wait_until(lambda: len([k for k in server_recs(base, ua) if k.startswith("bl1@list:%d:" % ids["ws"])]) == 2, 15, 0.4)
        recs = server_recs(base, ua)
        bls = {k: v for k, v in recs.items() if k.startswith("bl1@list:%d:" % ids["ws"])}
        got_rows = {}
        for v in bls.values():
            got_rows.update(bl_rows_of(v))
        rows = bl_rows_ws(P, ids)
        want_rows = {tid: (iso(s), iso(f), d, wt) for tid, s, f, d, wt in rows}
        check("setup: 'Simpan baseline' slot 1 '%s' untuk %s dan %s (UI) → 2 record baseline; baris server [s, f, d, w] = baris "
              "harapan %d task (simpul mesin non-ringkasan; w = target 🍅; selesai = aktual)" % (BL_NAME, KA, SWP, len(rows)),
              len(bls) == 2 and got_rows == want_rows and all((v.get("data") or {}).get("name") == BL_NAME for v in bls.values()),
              repr((sorted(bls), {k: (got_rows.get(k), want_rows.get(k)) for k in set(got_rows) | set(want_rows) if got_rows.get(k) != want_rows.get(k)})))
        info("setup tulisan A (baseline)", writes(("A",), s_bl))

        # ── 4 + 1: jendela nol tulisan A — buka Gantt lagi, baseline, EV, filter, 2 ekspor, 2 sinkron ──
        s4 = time.time()
        a.reload()
        hd.wait_dashboard_ready(a)
        c0.wait_sync(a)
        a.evaluate("() => { window.__e2eNoReload = 1; }")
        c0.open_timeline(a, WS)
        c1.wait_engine(a)
        a.wait_for_timeout(1000)
        no_ev = ev_state(a)
        check("1a A (W, pilihan baseline per perangkat belum ada) → tanpa ringkasan EV `.plg-timeline-ev`", no_ev is None, repr(no_ev))
        items = pick_baseline(a, "Baseline 1")
        srv = server_tasks(base, ua)
        outside = 1  # "Uji tampilan" (tanpa jadwal, bukan ringkasan) — tidak ada di baseline
        r0 = ev_manual(rows, srv, TODAY)
        want0 = ev_want(r0, BL_NAME, outside)
        ok = wait_until(lambda: ev_text(a) == want0["text"], 20, 0.4)
        st = ev_state(a)
        info("1 EV manual D0 sebelum perubahan (milipomodoro)", r0)
        check("1b A pilih 'Baseline 1' (%r) → ringkasan EV '%s' + title '%s' + aria-label = teks · title (role img), sebelum "
              "'Selesai …' di ujung toolbar — = hitungan manual" % (items, want0["text"], want0["title"]),
              ok and st and st["text"] == want0["text"] and st["title"] == want0["title"] and st["aria"] == want0["aria"]
              and st["role"] == "img" and st["inEnd"] and (st["next"] or "").startswith("Selesai "), repr((st, want0)))
        # perubahan lewat API (perangkat lain): progres, 🍅 selesai, task selesai
        hd.api(base, ua, "PUT", "/api/tasks/%d" % ids["KA2"], json={"progress": 80})
        hd.api(base, ua, "PUT", "/api/tasks/%d" % ids["SW1"], json={"progress": 50})
        for k in range(3):
            pomo(base, ua, ids["KA2"], k)
        pomo(base, ua, ids["SW1"], 0)
        pomo(base, ua, ids["KA3"], 0)
        hd.api(base, ua, "POST", "/api/tasks/%d/done" % ids["SW5"])
        srv = server_tasks(base, ua)
        out["srv"] = srv
        r1 = ev_manual(rows, srv, TODAY)
        want1 = ev_want(r1, BL_NAME, outside)
        out["want_d0"] = want1
        sync_now(a)
        c0.refresh_tasks(a)
        ok = wait_until(lambda: ev_text(a) == want1["text"], 25, 0.5)
        st1 = ev_state(a)
        shot(a, "1-A-ev-1280.png")
        info("1 EV manual D0 sesudah perubahan (milipomodoro)", r1)
        check("1c perubahan lewat API (Konsep 80 %%, Tata letak 50 %%, 🍅 3+1+1, Perbaikan tautan selesai) + sinkron A → '%s' / '%s'"
              % (want1["text"], want1["title"]),
              ok and st1["text"] == want1["text"] and st1["title"] == want1["title"] and st1["aria"] == want1["aria"]
              and want1["text"] != want0["text"], repr((st1, want1)))
        # filter panel host: Assignee, Project, Cari → bar tersaring, EV tetap
        n_all = bars_visible(a)
        search = a.locator("input[placeholder*='Cari task']").first
        fbtn = search.locator("xpath=following-sibling::button[1]")  # tombol "Filter" di sebelah "Cari task…"
        fbtn.click()
        sel = lambda lbl: a.locator("div.input-label", has_text=re.compile("^%s$" % lbl)).first.locator("xpath=following-sibling::select[1]")  # noqa: E731
        sel("Assignee").wait_for(state="visible", timeout=8000)
        sel("Assignee").select_option(value=str(ub["id"]))
        a.wait_for_timeout(1200)
        f1 = (bars_visible(a), ev_text(a), (ev_state(a) or {}).get("title"))
        shot(a, "1-A-filter-sari.png")
        sel("Assignee").select_option(value="")
        sel("Project").select_option(value=SWP)
        a.wait_for_timeout(1200)
        f2 = (bars_visible(a), ev_text(a), (ev_state(a) or {}).get("title"))
        sel("Project").select_option(value="")
        search.fill("Riset")
        a.wait_for_timeout(1200)
        f3 = (bars_visible(a), ev_text(a), (ev_state(a) or {}).get("title"))
        search.fill("")
        fbtn.click()
        a.wait_for_timeout(800)
        info("1d bar tampak / teks / title: semua, Assignee Sari, Project Situs Web, Cari 'Riset'", [n_all, f1, f2, f3])
        check("1d Filter → Assignee 'Sari' (%d → %d bar), Project '%s' (%d bar), Cari 'Riset' (%d bar) → teks + title EV tetap"
              % (n_all, f1[0], SWP, f2[0], f3[0]),
              all(f[0] < n_all and f[1] == want1["text"] and f[2] == want1["title"] for f in (f1, f2, f3)), repr((n_all, f1, f2, f3)))
        pick_baseline(a, "Tidak ada")
        gone = wait_until(lambda: ev_state(a) is None, 8, 0.3)
        pick_baseline(a, "Baseline 1")
        back = wait_until(lambda: ev_text(a) == want1["text"], 15, 0.3)
        check("1e 'Tidak ada' → ringkasan EV hilang; 'Baseline 1' lagi → kembali '%s'" % want1["text"], gone and back)

        # ── 2 ekspor web (W) ──
        fname = "%s-%s.xml" % (WS.replace(" ", "-"), iso(TODAY))
        want_toast = "Berkas %s diunduh · 1 task tanpa jadwal ditandai perkiraan · 1 tautan dilewati" % fname
        spans_now = {k: bar_span(a, ids[k]) for k, v in P.items() if v["s"] is not None and k != "SW0"}
        ms = menu_state(a)
        shot(a, "2-A-lainnya-ekspor-1280.png")
        a.keyboard.press("Escape")
        check("6c 1280 px terang: tepat satu tombol 'Lainnya' berisi tepat [%r] (menuitem, aktif), menu di dalam layar %r" % (EXPORT, ms and ms["box"]),
              ms and ms["nMore"] == 1 and ms["items"] == [[EXPORT, "menuitem", False]] and ms["box"][0] >= 0 and ms["box"][1] <= ms["iw"],
              repr(ms))
        name1, path1, data1, t1 = export_dl(a, dl_dir, "a1")
        shot(a, "2-A-toast-unduhan.png")
        a.wait_for_timeout(3500)  # toast lama hilang
        name2, path2, data2, t2 = export_dl(a, dl_dir, "a2")
        out["ws_xml"] = data1
        shutil.copyfile(path1, SAMPLE)
        check("2a W: Lainnya → '%s' → unduhan '%s' (= '{nama workspace}-{YYYY-MM-DD}.xml'), toast persis %r"
              % (EXPORT, name1, want_toast), name1 == fname and t1 == [want_toast], repr((name1, t1)))
        check("2k dua ekspor berturut → berkas identik byte (%d byte, toast kedua sama)" % len(data1),
              name2 == name1 and data2 == data1 and t2 == [want_toast], repr((name2, len(data2), t2)))
        for _ in range(2):
            sync_now(a)
        c0.refresh_tasks(a)
        nap(1.5)
        w4 = writes(("A",), s4)
        info("4 tulisan non-data A di jendela (bukan task/records)", other_writes(("A",), s4))
        check("4a nol tulisan A: muat ulang + buka Gantt W, pilih baseline (×3), baca EV, Filter, 2 ekspor, 2 sinkron → 0 tulis "
              "task/ext/records (%r)" % (w4,), not w4, repr(w4))
        check_ws_file(data1, path1, fname, P, ids, srv, spans_now, rows, tmp, out)

        # ── 1h + 2l project pribadi ──
        run_private(a, base, ua, ids, Q, dl_dir, tmp)
        ca.close()
        ctxs.remove(ca)
    finally:
        for cx in ctxs:
            try:
                cx.close()
            except Exception:  # noqa: BLE001
                pass


def check_ws_file(data, path, fname, P, ids, srv, spans, rows, tmp, out):
    """2b–2j: struktur xml.etree + MPXJ atas berkas unduhan W."""
    x = xml_struct(data)
    names = {P[k]["title"]: k for k in P}
    lvl1 = [t for t in x["tasks"] if t[2] == "1"]
    ok_out = all(t[3].startswith("1.") for t in x["tasks"] if t[1] in names and names[t[1]].startswith("KA")) \
        and all(t[3].startswith("2.") for t in x["tasks"] if t[1] in names and names[t[1]].startswith("SW"))
    sw0 = next((t for t in x["tasks"] if t[1] == P["SW0"]["title"]), None)
    kids = [t for t in x["tasks"] if t[1] in (P["SW1"]["title"], P["SW2"]["title"], P["SW3"]["title"])]
    check("2b xml.etree: prolog + <Project xmlns MSPDI>, Title '%s', Name '%s', blok …Calendars→Tasks→Resources→Assignments; "
          "%d <Task> (UID 0 + 2 kelompok + %d task); kelompok tingkat 1 %r (Summary); task KA di 1.x, Situs Web di 2.x, anak "
          "ringkasan tingkat 3; %d tautan, %d resource, %d assignment (12 nyata + 2 semu F6), %d pengecualian kalender"
          % (x["title"], x["name"], len(x["tasks"]), len(P), [t[1] for t in lvl1], x["links"], x["resources"], x["assignments"], x["exceptions"]),
          x["prolog"] == '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' and x["root"] == "{http://schemas.microsoft.com/project}Project"
          and x["title"] == WS and x["name"] == fname and x["blocks"] == ["Calendars", "Tasks", "Resources", "Assignments"]
          and len(x["tasks"]) == 1 + 2 + len(P) and [(t[1], t[4]) for t in lvl1] == [(KA, "1"), (SWP, "1")] and ok_out
          and sw0 and sw0[2] == "2" and sw0[4] == "1" and len(kids) == 3 and all(t[2] == "3" and t[3].startswith(sw0[3] + ".") for t in kids)
          and x["links"] == 8 and x["resources"] == 3 and x["assignments"] == 12 + 2 and x["exceptions"] == 3, repr(x))
    rc, mp, lines = mpxj(path, tmp)
    out["mpxj_ws"] = mp
    info("2c mspdi_check --file (baris ringkas)", lines)
    check("2c MPXJ 16.10 (mspdi_check.py --file, berkas UNDUHAN): urutan elemen = skema MSPDI, UniversalProjectReader, setiap "
          "field task/kalender/assignment MPXJ = XML, durasi = waktu kerja kalender MPXJ (rc %s)" % rc,
          rc == 0 and mp is not None and not mp.get("fail"), repr((rc, lines[:8], mp and mp.get("fail"))))
    if not mp:
        return
    by = {t["name"]: t for t in mp["tasks"]}
    want = want_ws(P, ids, srv, TODAY)
    check("2d MPXJ jumlah: %d task (UID 0 + 2 kelompok + %d), %d tautan, %d resource, %d assignment; judul '%s', HonorConstraints, "
          "480 menit/hari" % (len(mp["tasks"]), len(P), mp["links"], len(mp["resources"]), len(mp["assignments"]), mp["props"]["title"]),
          len(mp["tasks"]) == 3 + len(P) and mp["links"] == 8 and len(mp["resources"]) == 3 and len(mp["assignments"]) == 12
          and mp["props"]["title"] == WS and mp["props"]["name"] == fname and mp["props"]["honorConstraints"]
          and mp["props"]["minutesPerDay"] == 480, repr(mp["props"]))
    bad_d, bad_c, bad_l, bad_bar = [], [], [], []
    for nm, wv in want.items():
        g = by.get(nm)
        if not g:
            bad_d.append((nm, "tidak ada"))
            continue
        got = dict(start=g["start"], finish=g["finish"], dur=g["dur"], pct=g["pct"], astart=g["astart"], afinish=g["afinish"], ms=g["milestone"])
        exp = {k: wv[k] for k in got}
        if got != exp:
            bad_d.append((nm, {k: (got[k], exp[k]) for k in got if got[k] != exp[k]}))
        gc = dict(ctype=g["ctype"], cdate=g["cdate"], manual=g["manual"], est=g["est"])
        ec = {k: wv[k] for k in gc}
        if gc != ec:
            bad_c.append((nm, {k: (gc[k], ec[k]) for k in gc if gc[k] != ec[k]}))
        gl = sorted((p[1], p[2], p[3]) for p in g["preds"])
        if gl != wv["preds"]:
            bad_l.append((nm, gl, wv["preds"]))
        k = names_key(P, nm)
        if k in spans and not P[k].get("done") and k != "SW5":  # task selesai: berkas = aktual mesin (residual R11), bar = tersimpan
            s, f, _ = spans[k]
            if (g["start"][:10], (g["start"] if g["milestone"] else g["finish"])[:10]) != (iso(s), iso(f)):
                bad_bar.append((nm, g["start"], g["finish"], iso(s), iso(f)))
    check("2e MPXJ Start/Finish/durasi/milestone/%% selesai/ActualStart/ActualFinish %d task = harapan (es/ef mesin = hitungan "
          "skrip; selesai = aktual; %% > 0 = ActualStart (F6: termasuk Manual); tanpa jadwal = placeholder %s) dan = tanggal bar "
          "Gantt (task belum selesai)" % (len(want), short(next_work(TODAY))), not bad_d and not bad_bar, repr((bad_d, bad_bar)))
    check("2f MPXJ kendala + mode (uji pemilik F4): akar Otomatis/selesai/berjalan SNET di es, berjalan es > D SNET (tautan "
          "tidak menuntut lebih lambat), milestone FF 0 di 17:00 tanpa kendala, penerusnya FS+2 ASAP, SNET eksplisit, MFO 17:00, "
          "SF ASAP; Manual (R8) = MANUALLY_SCHEDULED + SNET; tanpa jadwal Otomatis + Estimated + SNET", not bad_c, repr(bad_c))
    check("2g MPXJ tautan 8 = sisi mesin: FS+1, SS+2, FF 0, FS+2 (dari milestone), SF+3, FS−1, FS 0 (Manual), FS 0 ke task berjalan (F7); ke task tanpa "
          "jadwal dilewati", not bad_l, repr(bad_l))
    exc = [tuple(e[:3]) for e in mp["calendar"]["exceptions"]]
    want_exc = [("2026-12-24", "2026-12-25", False), ("2027-01-01", "2027-01-01", False), ("2027-01-05", "2027-01-05", False)]
    check("2h MPXJ kalender: Sen–Jum kerja, pengecualian <Exceptions> = libur SKB di rentang (24–25 Des digabung, 1 Jan, 5 Jan; "
          "bernama) — Materi Natal %s–%s melompati 24–25 Des (4 hari)" % (by.get(P["KA9"]["title"], {}).get("start"), by.get(P["KA9"]["title"], {}).get("finish")),
          mp["calendar"]["week"] == [True] * 5 + [False] * 2 and exc == want_exc and all(e[3] for e in mp["calendar"]["exceptions"]),
          repr(mp["calendar"]))
    bad_b = []
    for tid, s, f, d, wt in rows:
        nm = srv[tid]["title"]
        g = by.get(nm, {})
        exp = (pt(s), pt(s) if d == 0 else pt(f, True), float(d), float(wt * 25))
        got = (g.get("bstart"), g.get("bfinish"), g.get("bdur"), g.get("bwork"))
        if got != exp:
            bad_b.append((nm, got, exp))
    nob = [t["name"] for t in mp["tasks"] if t["name"] == P["SW3"]["title"] and t["bstart"]]
    check("2i MPXJ baseline (Number 0) %d task = baris baseline aktif (Start 08:00, Finish 17:00 / milestone 08:00, durasi, Work "
          "= w × 25 menit); task di luar baseline tanpa baseline" % len(rows), not bad_b and not nob, repr((bad_b, nob)))
    want_res = [[1, "Rani", "WORK"], [2, "Sari", "WORK"], [3, "Tono", "WORK"]]
    want_asg = []
    for k, v in P.items():
        if v["s"] is None or v["d"] == 0 or k == "SW0" or not v.get("who"):
            continue
        dur = want[v["title"]]["dur"]
        work = v["est"] * 25
        units = -(-work * 10**6 // (dur * 480)) / 10**6 * 100  # 6 desimal dibulatkan ke atas (review F5), dalam %
        want_asg.append([v["title"], {"a": "Rani", "b": "Sari", "c": "Tono"}[v["who"]], float(work), round(units, 2)])
    got_asg = sorted([a[0], a[2], a[3], a[4]] for a in mp["assignments"])
    check("2j MPXJ resource %r (urut nama) + %d assignment nyata (Work = target × 25 menit, Units = Work ÷ durasi×480, 6 desimal ke atas; milestone / tanpa "
          "jadwal / ringkasan / tanpa penanggung jawab tanpa assignment nyata)" % ([r[1] for r in mp["resources"]], len(want_asg)),
          mp["resources"] == want_res and got_asg == sorted(want_asg), repr((mp["resources"], got_asg, sorted(want_asg))))
    rcal = xml_rescal(data)
    est = [t for t in x["tasks"] if t[1] == P["SW3"]["title"]]
    check("2m uji pemilik F4: tiap resource ber-kalender resource turunan UID 1 %r; MPXJ Units × waktu kerja kalender resource "
          "(Start..Finish) ≈ Work ±1 menit untuk %d assignment (Materi Natal melewati 24–25 Des), 24/12 libur; tanpa MSO; placeholder "
          "'%s' Otomatis + Estimated + DurationFormat 39 %r" % (rcal["res"], len(mp["assignments"]), P["SW3"]["title"], rcal["sw3"]),
          rcal["res"] == [[1, "Rani", 2], [2, "Sari", 3], [3, "Tono", 4]] and rcal["cals"] == [[2, "Rani", "0", "1"], [3, "Sari", "0", "1"], [4, "Tono", "0", "1"]]
          and mp.get("resourceCalendarBad") == [] and mp.get("mso") == [] and "<ConstraintType>2</ConstraintType>" not in data.decode("utf-8")
          and est and rcal["sw3"] == ["0", "1", "39"], repr((rcal, mp.get("resourceCalendarBad"), mp.get("mso"))))
    # 2n uji pemilik #2 F6 — harapan dihitung skrip dari P (durasi × 480 menit, target × 25 menit, % server), bukan dari XML.
    real = {a[0] for a in want_asg}
    bad_p, want_pseudo = [], []
    for nm, wv in want.items():
        g = by.get(nm) or {}
        dur, pct = wv["dur"] * 480, wv["pct"]
        if nm in real:
            work = float(P[names_key(P, nm)]["est"] * 25)
        elif pct > 0:  # tanpa assignment nyata tetapi berprogres → assignment semu: Work = durasi
            work = dur
            want_pseudo.append([nm, int(pct), work, work * pct / 100, wv["afinish"] if pct == 100 else None])
        else:
            work = 0.0
        exp = dict(adur=dur * pct / 100, rdur=dur - dur * pct / 100, work=work, awork=work * pct / 100, rwork=work - work * pct / 100)
        got = {k: g.get(k) for k in exp}
        if any(got[k] is None or abs(got[k] - exp[k]) > 1e-6 for k in exp):
            bad_p.append((nm, got, exp))
    sums = [t for t in mp["tasks"] if t["summary"]]
    bad_s = [(t["name"], t["pct"], t["adur"], t["rdur"], t["work"]) for t in sums
             if (t["pct"], t["adur"], t["work"], t["awork"], t["rwork"]) != (0.0, 0.0, 0.0, 0.0, 0.0) or abs(t["rdur"] - t["dur"] * 480) > 1e-6]
    got_pseudo = sorted([r[0], r[2], r[3], r[4], r[5]] for r in mp.get("pseudo") or [])
    k10, k11, k6, k3 = (by.get(P[k]["title"], {}) for k in ("KA10", "KA11", "SW6", "SW3"))
    check("2n uji pemilik #2 F6: kalender dasar '%s'; %d task — ActualDuration = durasi × %%, RemainingDuration = sisa, Work/ActualWork/"
          "RemainingWork = hitungan skrip; %d ringkasan %% 0 + sisa = durasi + kerja nol; tanpa penanggung jawab: '%s' 0 %% → tanpa "
          "assignment, RemainingDuration %s menit, Work 0; '%s' 50 %% dan '%s' 100 %% → assignment semu %r; placeholder '%s' "
          "RemainingDuration %s menit; mspdi_check 'tanpa turunan MPXJ' + konsistensi aktual/sisa lulus (%r)"
          % (mp.get("calendarName"), len(want), len(sums), P["KA10"]["title"], k10.get("rdur"), P["KA11"]["title"], P["SW6"]["title"],
             got_pseudo, P["SW3"]["title"], k3.get("rdur"), mp.get("progressBad")),
          mp.get("calendarName") == "Standard" and not bad_p and not bad_s and len(sums) == 4 and mp.get("progressBad") == []
          and got_pseudo == sorted(want_pseudo) and [r[0] for r in got_pseudo] == sorted([P["SW6"]["title"], P["KA11"]["title"]])
          and x["assignments"] == len(mp["assignments"]) + len(want_pseudo)
          and (k10.get("rdur"), k10.get("work")) == (960.0, 0.0) and P["KA10"]["title"] not in real
          and (k11.get("adur"), k11.get("rdur"), k11.get("work"), k11.get("awork")) == (960.0, 960.0, 1920.0, 960.0)
          and (k6.get("rdur"), k6.get("awork")) == (0.0, k6.get("work")) and k6.get("work") == k6.get("dur", 0) * 480
          and (k3.get("rdur"), k3.get("adur"), k3.get("work")) == (480.0, 0.0, 0.0),
          repr((bad_p, bad_s, got_pseudo, sorted(want_pseudo), mp.get("progressBad"), mp.get("calendarName"))))
    # 2o review F7: tanpa pecah task berjalan, Type, dan task berjalan yang pendahulu FS-nya belum selesai.
    bad_t = [(t["name"], t["ttype"]) for t in mp["tasks"] if t["ttype"] != ("1" if t["name"] in real else "0")]
    k12, k7 = by.get(P["KA12"]["title"], {}), by.get(P["KA7"]["title"], {})
    p12 = P["KA12"]
    check("2o review F7: <SplitsInProgressTasks> %r; Type 1 ⇔ assignment nyata (%d task Type 1, %d Type 0 termasuk ringkasan/"
          "placeholder/milestone/tanpa penanggung jawab); '%s' (berjalan %s %%, mulai %s ≤ D) dengan pendahulu FS '%s' belum "
          "selesai (%s–%s): tautan FS 0 diekspor, %s di %s, ActualStart %s, Manual %r, Start–Finish %s–%s = mesin (tetap di tempat)"
          % (mp["props"].get("splitsInProgressTasks"), sum(1 for t in mp["tasks"] if t["ttype"] == "1"),
             sum(1 for t in mp["tasks"] if t["ttype"] == "0"), p12["title"], k12.get("pct"), k12.get("start"), P["KA7"]["title"],
             k7.get("start"), k7.get("finish"), k12.get("ctype"), k12.get("cdate"), k12.get("astart"), k12.get("manual"),
             k12.get("start"), k12.get("finish")),
          mp["props"].get("splitsInProgressTasks") == "0" and not bad_t and len(real) == 12
          and [(q[1], q[2], q[3]) for q in k12.get("preds", [])] == [(P["KA7"]["title"], LINK["FS"], 0.0)]
          and (k12.get("start"), k12.get("finish"), k12.get("astart"), k12.get("afinish")) == (pt(p12["s"]), pt(p12["f"], True), pt(p12["s"]), None)
          and (k12.get("ctype"), k12.get("cdate"), k12.get("manual")) == (SNET, pt(p12["s"]), False)
          and p12["s"] <= TODAY and k7.get("pct") == 0.0 and k7.get("finish", "")[:10] > iso(p12["s"])
          and (k12.get("adur"), k12.get("rdur"), k12.get("awork"), k12.get("rwork")) == (576.0, 864.0, 30.0, 45.0),
          repr((mp["props"].get("splitsInProgressTasks"), bad_t, k12, k7)))
    # 2p uji pemilik #3 F8: bendera kepala bawaan MSPDIWriter MPXJ (ProjectExternallyEdited 0 = bukan "disunting dari luar").
    want_head = {"SpreadActualCost": "0", "SpreadPercentComplete": "0", "TaskUpdatesResource": "1", "MoveCompletedEndsBack": "0",
                 "MoveRemainingStartsBack": "0", "MoveRemainingStartsForward": "0", "MoveCompletedEndsForward": "0",
                 "ProjectExternallyEdited": "0", "ActualsInSync": "0"}
    txt = data.decode("utf-8")
    check("2p uji pemilik #3 F8: kepala Project memuat %r; <ProjectExternallyEdited>0 + <ActualsInSync>0 tepat sebelum <Calendars>"
          % (mp["props"].get("headFlags"),),
          mp["props"].get("headFlags") == want_head
          and "  <ProjectExternallyEdited>0</ProjectExternallyEdited>\n  <ActualsInSync>0</ActualsInSync>\n  <Calendars>\n" in txt
          and all(txt.count("<%s>" % k) == 1 for k in want_head), repr(mp["props"].get("headFlags")))


def names_key(P, nm):
    return next((k for k, v in P.items() if v["title"] == nm), None)


def run_private(a, base, ua, ids, Q, dl_dir, tmp):
    """1h (BAC 0 → tanpa EV) + 2l ekspor halaman project pribadi."""
    s_p = time.time()
    c0.open_timeline(a, PRIV)
    c1.wait_engine(a)
    sync_now(a)
    save_baseline(a, None, 1, BL_PRIV)
    sync_now(a)
    rec1 = wait_until(lambda: next((v for k, v in server_recs(base, ua).items() if k.startswith("bl1@user:")), None), 15, 0.4)
    rid2 = rec1["id"].replace("bl1@", "bl2@", 1)
    data2 = json.loads(json.dumps(rec1["data"]))
    data2.update(n=2, name=BL_ZERO, t=[e[:4] + [0] for e in data2["t"]])  # baseline ber-w 0 = task tanpa target → BAC 0
    post_rec(base, ua, "baseline", rid2, rec1.get("scope") or "user", data2)
    sync_now(a)
    c0.refresh_tasks(a)
    a.wait_for_timeout(800)
    s_pw = time.time()
    items = wait_until(lambda: (lambda its: its if BL_ZERO in its else (sync_now(a) and None))(picker_items(a)), 25, 0.5)
    pick_baseline(a, BL_ZERO)
    a.wait_for_timeout(2500)
    z = ev_state(a)
    shot(a, "1-A-pribadi-bac0.png")
    pick_baseline(a, BL_PRIV)
    srv = server_tasks(base, ua)
    rows = [(ids[k], v["s"], v["f"], v["d"], v["est"]) for k, v in Q.items()]
    wantp = ev_want(ev_manual(rows, srv, TODAY), BL_PRIV, 0)
    ok = wait_until(lambda: ev_text(a) == wantp["text"], 15, 0.3)
    stp = ev_state(a)
    check("1h project pribadi '%s': pemilih %r; baseline '%s' (slot 2, w 0 = BAC 0) → tanpa ringkasan EV; baseline '%s' → '%s' / "
          "'%s'" % (PRIV, items, BL_ZERO, BL_PRIV, wantp["text"], wantp["title"]),
          items and z is None and ok and stp["title"] == wantp["title"] and stp["aria"] == wantp["aria"], repr((items, z, stp, wantp)))
    fname = "%s-%s.xml" % (PRIV.replace(" ", "-"), iso(TODAY))
    name, path, data, ts = export_dl(a, dl_dir, "p")
    x = xml_struct(data)
    rc, mp, lines = mpxj(path, tmp)
    by = {t["name"]: t for t in (mp or {}).get("tasks", [])}
    p1, p3 = Q["P1"], Q["P3"]
    g1, g3 = by.get(p1["title"], {}), by.get(p3["title"], {})
    check("2l project pribadi: unduhan '%s', toast persis 'Berkas %s diunduh'; xml.etree tanpa kelompok (3 task tingkat 1, 2 "
          "tautan, 1 resource, 2 assignment); MPXJ rc %s: resource = pemilik 'Rani', Manual + SNET, milestone %s, baseline '%s'"
          % (name, fname, rc, g3.get("start"), BL_PRIV),
          name == fname and ts == ["Berkas %s diunduh" % fname] and x["title"] == PRIV and len(x["tasks"]) == 4
          and all(t[2] == "1" for t in x["tasks"][1:]) and x["links"] == 2 and x["resources"] == 1 and x["assignments"] == 2
          and rc == 0 and mp and mp["resources"] == [[1, "Rani", "WORK"]] and len(mp["assignments"]) == 2
          and g1.get("manual") and g1.get("ctype") == SNET and g1.get("start") == pt(p1["s"]) and g1.get("finish") == pt(p1["f"], True)
          and g1.get("bstart") == pt(p1["s"]) and g1.get("bwork") == 50.0 and g3.get("milestone") and g3.get("start") == pt(p3["s"]),
          repr((name, ts, x, rc, lines[:6], g1, g3)))
    check("4a-2 nol tulisan A di halaman pribadi selama pilih baseline (×2), baca EV, ekspor (%r)" % (writes(("A",), s_pw),),
          not writes(("A",), s_pw))
    info("1h tulisan A pribadi (simpan baseline slot 1)", writes(("A",), s_p))


# ── 3 native ──────────────────────────────────────────────────────────────────────────────────────────────────────────

def run_native(browser, base, ua):
    cn, n = open_dev(browser, base, ua, "N", tauri=True)
    try:
        dls = []
        n.on("download", lambda d: dls.append(d))
        plat = n.evaluate("() => !!window.__TAURI__")
        c0.open_timeline(n, WS)
        c1.wait_engine(n)
        s3 = time.time()
        n0 = toast_n(n)
        click_export(n)
        wait_until(lambda: toasts_since(n, n0), 8, 0.2)
        n.wait_for_timeout(1500)
        ts = toasts_since(n, n0)
        shot(n, "3-N-native-toast.png")
        check("3a native (window.__TAURI__ disuntik sebelum muat: %s) → Lainnya → Ekspor → toast persis %r, 0 unduhan (%d), 0 tulis"
              % (plat, MSG_NATIVE, len(dls)), plat and ts == [MSG_NATIVE] and not dls and not writes(("N",), s3), repr((ts, len(dls))))
    finally:
        cn.close()


# ── 6 HP 375 px Sakura gelap ──────────────────────────────────────────────────────────────────────────────────────────

def run_mobile(browser, base, ua, tmp, out):
    cm, m = open_dev(browser, base, ua, "M", viewport=hd.MOBILE, mobile=True)
    try:
        m.evaluate("() => { localStorage.setItem('tf_palette', 'sakura'); localStorage.setItem('tf_theme', 'dark'); }")
        m.reload()
        hd.wait_dashboard_ready(m)
        c0.wait_sync(m)
        m.evaluate("() => { window.__e2eNoReload = 1; }")
        s6 = time.time()
        sync_now(m)
        c0.open_timeline(m, WS)
        c1.wait_engine(m, slack=False)
        ms = menu_state(m)
        shot(m, "6-M-375-lainnya.png")
        m.keyboard.press("Escape")
        pick_baseline(m, "Baseline 1")
        want = out.get("want_d0") or {}
        ok = wait_until(lambda: ev_text(m) == want.get("text"), 20, 0.4)
        st = ev_state(m)
        pal = m.evaluate("() => [document.documentElement.getAttribute('data-palette'), document.documentElement.getAttribute('data-theme')]")
        m.evaluate("() => { const t = document.querySelector('.plg-timeline-toolbar'); if (t) t.scrollIntoView({ block: 'start' }); }")
        m.wait_for_timeout(300)
        st = ev_state(m) or st
        shot(m, "6-M-375-sakura-gelap-ev.png")
        want_items = ["Jadwal otomatis", "Jalur kritis", "Beban Tim", "Baseline", "Simpan baseline", "Jadwalkan ulang", EXPORT]
        check("6a 375 px Sakura gelap (%r): 'Lainnya' %r diakhiri Ekspor, menu %r di dalam [0, 375]; ringkasan EV '%s' (= A) %r di "
              "dalam layar, toolbar tanpa luber, scrollWidth %s ≤ 375"
              % (pal, [i[0] for i in (ms or {}).get("items", [])], ms and ms["box"], st and st["text"], st and st["box"], st and st["sw"]),
              ms and [i[0] for i in ms["items"]] == want_items and ms["box"][0] >= 0 and ms["box"][1] <= 375 and ms["sw"] <= 375
              and ms["nMore"] == 1 and pal == ["sakura", "dark"] and ok and st["title"] == want.get("title") and st["box"][0] >= 0
              and st["box"][1] <= 375 and st["tbOver"] <= 0 and st["sw"] <= 375, repr((ms, st, want)))
        name, path, data, ts = export_dl(m, os.path.join(tmp, "unduhan"), "m")
        check("6b 375 px: Ekspor dari HP → unduhan '%s' identik byte dengan unduhan A (%d byte), toast sama; 0 tulis M"
              % (name, len(data)), out.get("ws_xml") is not None and data == out["ws_xml"] and ts and ts[0].startswith("Berkas " + name)
              and not writes(("M",), s6), repr((name, len(data), ts, writes(("M",), s6))))
    finally:
        cm.close()


# ── 1f–1g jam palsu: E (Rani) maju beberapa hari kerja, B (Sari) perangkat kedua ────────────────────────────────────

def run_clock(browser, base, users, ids, P, out):
    ua, ub = users["a"], users["b"]
    ctxs = []
    try:
        now = datetime.datetime.now(JKT)
        ce = new_ctx(browser, base, clock=now)
        ctxs.append(ce)
        e = c0.open_page(ce, base, ua, "E")
        sE = time.time()
        sync_now(e)  # perangkat baru: record plugin (baseline) ditarik pada sinkron berikutnya (pola 4e-0 1b)
        c0.open_timeline(e, WS)
        c1.wait_engine(e)
        pick_baseline(e, "Baseline 1")
        want0 = out["want_d0"]
        ok0 = wait_until(lambda: ev_text(e) == want0["text"], 25, 0.4)
        st_e0 = ev_state(e)
        info("1f E sebelum jam maju: Date() halaman, EV", [e.evaluate("() => new Date().toString().slice(0, 24)"), st_e0])
        D1 = w(3)
        target = datetime.datetime.combine(D1, datetime.time(10, 0), tzinfo=JKT)
        fake = e.evaluate("() => Date.now()")
        e.clock.fast_forward(int(target.timestamp() * 1000 - fake))
        ev = wait_until(lambda: [x for x in e.evaluate("() => window.__ev") if x[0] == "app.dayChanged"], 15, 0.3)
        srv = server_tasks(base, ua)
        rows = bl_rows_ws(P, ids)
        r1 = ev_manual(rows, srv, D1)
        want1 = ev_want(r1, BL_NAME, 1)
        info("1f EV manual D1 = %s (milipomodoro)" % iso(D1), r1)
        sync_now(e)
        ok1 = wait_until(lambda: ev_text(e) == want1["text"], 25, 0.5)
        st_e = ev_state(e)
        shot(e, "1-E-ev-jam-maju.png")
        check("1f E (Rani, jam palsu): Baseline 1 → '%s' (= A pada %s); jam maju ke %s (+3 hari kerja, app.dayChanged %r) → '%s' / '%s'"
              % (want0["text"], short(TODAY), short(D1), ev and ev[0][1], want1["text"], want1["title"]),
              ok0 and ok1 and st_e["title"] == want1["title"] and st_e["aria"] == want1["aria"] and want1["text"] != want0["text"],
              repr((bool(ok0), bool(ok1), st_e0, want0, st_e, want1)))
        fake_now = e.evaluate("() => Date.now()")
        cb = new_ctx(browser, base, clock=datetime.datetime.fromtimestamp(fake_now / 1000, tz=JKT))
        ctxs.append(cb)
        b = c0.open_page(cb, base, ub, "B")
        sB = time.time()
        c0.open_timeline(b, WS)
        c1.wait_engine(b)
        sync_now(b)
        b.wait_for_timeout(1000)
        none_b = ev_state(b)
        pick_baseline(b, "Baseline 1")
        okb = wait_until(lambda: ev_text(b) == want1["text"], 20, 0.4)
        st_b = ev_state(b)
        shot(b, "1-B-ev-perangkat-kedua.png")
        check("1g B (Sari, anggota, perangkat kedua, jam palsu sama %s): tanpa pilihan → tanpa EV; 'Baseline 1' → teks, title, "
              "aria-label sama dengan E" % b.evaluate("() => new Date().toString().slice(0, 24)"),
              none_b is None and okb and st_b["text"] == st_e["text"] and st_b["title"] == st_e["title"] and st_b["aria"] == st_e["aria"],
              repr((none_b, st_b, st_e)))
        check("4b nol tulisan E dan B (buka Gantt, baseline, EV, jam maju, sinkron): %r" % (writes(("E", "B"), min(sE, sB)),),
              not writes(("E", "B"), min(sE, sB)))
    finally:
        for cx in ctxs:
            try:
                cx.close()
            except Exception:  # noqa: BLE001
                pass


# ── 5 klien 1.3 dipatok 847067e + 7b DOM awal 1.4 vs 1.3 ─────────────────────────────────────────────────────────────

def pinned(path):
    return subprocess.run(["git", "show", PIN + ":" + path], cwd=hd.ROOT, check=True, capture_output=True).stdout


OLD_FILES = [  # semua berkas static yang berbeda 847067e ↔ HEAD selain sw.js (SW diblokir) + load.js/mspdi.js/plan.js (dibundel)
    (r"^http://127\.0\.0\.1:\d+/(\?.*)?$", "text/html", "static/index.html"),
    (r"/static/whatsnew\.json(\?.*)?$", "application/json", "static/whatsnew.json"),
    (r"/static/plugins/index\.json(\?.*)?$", "application/json", "static/plugins/index.json"),
    (r"/static/plugins/timeline/plugin\.js(\?.*)?$", "application/javascript", "static/plugins/timeline/plugin.js"),
    (r"/static/plugins/timeline/style\.css(\?.*)?$", "text/css", "static/plugins/timeline/style.css"),
    (r"/static/plugin-runtime\.js(\?.*)?$", "application/javascript", "static/plugin-runtime.js"),
]

DOM_SIG_JS = """() => { const out = {}; for (const e of document.querySelectorAll('.plg-timeline *')) {
  const k = e.tagName.toLowerCase() + (e.classList.length ? '.' + Array.from(e.classList).sort().join('.') : ''); out[k] = (out[k] || 0) + 1; }
  return out; }"""


def run_old_client(browser, base, users, ids):
    ub = users["b"]
    served = []
    tall = {"width": 1280, "height": 1600}  # semua baris W dirender (tanpa efek virtualisasi pada perbandingan DOM)
    ctx = new_ctx(browser, base, viewport=tall)

    def make(path, ctype, body):
        def handler(route):
            served.append(path)
            route.fulfill(status=200, content_type=ctype, body=body)
        return handler
    for rx, ctype, path in OLD_FILES:
        ctx.route(re.compile(rx), make(path, ctype, pinned(path)))
    sw_old = re.search(r'^const CACHE = "([^"]+)";', pinned("static/sw.js").decode(), re.M).group(1)
    ctxs = [ctx]
    try:
        # resource 1.3 (kapasitas Sari 4) lewat API sebelum klien lama dibuka
        post_rec(base, ub, "resource", "res@list:%d:%d" % (ids["ws"], ub["id"]), "list:%d" % ids["ws"],
                 {"v": 1, "capacity": 4, "leave": [], "by": ub["id"]})
        srv0 = rec_sig(server_recs(base, ub))
        p = ctx.new_page()
        c0.PUMP.append(p)
        c0.watch(p, "OLD")
        p.goto(base + "/manifest.json")
        c0.prime_storage(p, ub)
        p.evaluate("(sw) => localStorage.setItem('tf_whatsnew_seen', sw)", sw_old)
        s5 = time.time()
        p.goto(base + "/")
        hd.wait_dashboard_ready(p)
        c0.wait_sync(p)
        p.wait_for_function("pid => window.TF && window.TF.plugins && window.TF.plugins.isEnabled(pid)", arg=PID, timeout=20000)
        p.evaluate("() => { window.__e2eNoReload = 1; }")
        sync_now(p)
        c0.open_timeline(p, WS)
        c1.wait_engine(p)
        ver = p.evaluate("() => { try { return (window.TF.plugins.list ? window.TF.plugins.list() : []).map(x => [x.id, x.version]); } catch (e) { return String(e); } }")
        items = pick_baseline(p, "Baseline 1")
        p.wait_for_timeout(1500)
        blb = p.evaluate("() => document.querySelectorAll('.plg-timeline-blbar').length")
        no14 = p.evaluate("() => [document.querySelectorAll('.plg-timeline-ev').length, document.querySelectorAll('.plg-timeline-more').length]")
        dom_old = p.evaluate(DOM_SIG_JS)
        shot(p, "5-OLD-klien-1.3-baseline.png")
        p.locator(".plg-timeline-toolbar .plg-timeline-loadbtn").click()
        p.locator(".plg-timeline-load").first.wait_for(state="visible", timeout=20000)
        okr = wait_until(lambda: "Sari · 4 🍅/hari" in p.evaluate(
            "() => Array.from(document.querySelectorAll('.plg-timeline-load-name')).map(x => x.textContent)"), 15, 0.4)
        p.locator(".plg-timeline-toolbar .plg-timeline-loadbtn").click()
        for _ in range(2):
            sync_now(p)
        c0.refresh_tasks(p)
        nap(1.5)
        w5 = writes(("OLD",), s5)
        srv1 = rec_sig(server_recs(base, ub))
        errs = [x for x in c0.console_log if x[0] == "OLD" and x[1] in ("error", "pageerror") and not re.search(r"Failed to load resource|net::ERR_", x[2])]
        info("5 OLD: berkas dipatok yang disajikan, plugin terdaftar, item pemilih baseline", [sorted(set(served)), ver, items])
        check("5a klien 1.3 (%s: %d berkas dipatok) memuat Timeline 1.3.0; baseline 1.4 (2 unit, baris [s, f, d, w]) terbaca: "
              "'Baseline 1' → %d bar baseline; tanpa ringkasan EV dan tanpa 'Lainnya' desktop (%r)" % (PIN, len(OLD_FILES), blb, no14),
              set(x[2] for x in OLD_FILES) <= set(served) and ["timeline", "1.3.0"] in [list(x) for x in (ver if isinstance(ver, list) else [])]
              and blb >= 10 and no14 == [0, 0], repr((sorted(set(served)), ver, blb, no14)))
        check("5b klien 1.3: panel Beban Tim membaca record resource 'Sari · 4 🍅/hari'", okr)
        check("5c klien 1.3: buka Timeline + baseline + panel + 2 sinkron → 0 tulis (%r); record server utuh (%d, tanpa record "
              "baru); tanpa galat konsol" % (w5, len(srv1)), not w5 and srv1 == srv0 and not errs, repr((w5, errs[:4])))
        # 7b pembanding DOM: klien 1.4 (Sari, jam nyata, viewport sama) di keadaan yang sama (Baseline 1, panel tertutup)
        c14 = new_ctx(browser, base, viewport=tall)
        ctxs.append(c14)
        q = c0.open_page(c14, base, ub, "B14")
        sync_now(q)
        c0.open_timeline(q, WS)
        c1.wait_engine(q)
        pick_baseline(q, "Baseline 1")
        wait_until(lambda: ev_state(q) is not None, 15, 0.3)
        q.wait_for_timeout(1500)
        dom_new = q.evaluate(DOM_SIG_JS)
        plus = dict(Counter(dom_new) - Counter(dom_old))
        minus = dict(Counter(dom_old) - Counter(dom_new))
        want_plus = {"span.plg-timeline-ev": 1, "div.plg-timeline-more": 1, "button.plg-timeline-btn": 1}
        info("7b DOM .plg-timeline * 1.3 / 1.4 (jumlah), selisih +/−", [sum(dom_old.values()), sum(dom_new.values()), plus, minus])
        check("7b render awal 1.4 vs 1.3 (Sari, W, 1280×1600, Baseline 1): %d → %d elemen; selisih = tepat +EV (span) +Lainnya "
              "(div + tombol), tanpa elemen hilang (%r / %r)" % (sum(dom_old.values()), sum(dom_new.values()), plus, minus),
              plus == want_plus and not minus, repr((plus, minus)))
    finally:
        for cx in ctxs:
            try:
                cx.close()
            except Exception:  # noqa: BLE001
                pass


# ── 7 kinerja: klik → unduhan WP 300 task, CPU 4× ─────────────────────────────────────────────────────────────────────

HOOK_DL_JS = """() => { if (window.__dlHook) return true; window.__dlHook = true; window.__dlT = []; window.__clickT = [];
  const orig = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () { if (this.hasAttribute('download')) window.__dlT.push(performance.now()); return orig.apply(this, arguments); };
  document.addEventListener('click', (e) => { const t = e.target; if (t && t.closest && t.closest('.plg-timeline-more-item')) window.__clickT.push(performance.now()); }, true);
  return true; }"""


def run_perf(browser, base, ua, tmp):
    cp, d = open_dev(browser, base, ua, "P")
    try:
        sync_now(d)
        c0.open_timeline(d, WP)
        c1.wait_engine(d)
        d.evaluate(HOOK_DL_JS)
        dom0 = d.evaluate("() => document.querySelectorAll('.plg-timeline *').length")
        s7 = time.time()
        cdp = cp.new_cdp_session(d)
        cdp.send("Emulation.setCPUThrottlingRate", {"rate": CPU_RATE})
        ms, wall, names, sizes, tsts = [], [], [], [], []
        try:
            for i in range(5):
                more_open(d)
                it = d.locator(".plg-timeline-more-menu [role=menuitem]", has_text=EXPORT).first
                n0 = toast_n(d)
                t0 = time.time()
                with d.expect_download(timeout=30000) as dli:
                    it.click()
                dl = dli.value
                wall.append(round((time.time() - t0) * 1000))
                path = os.path.join(tmp, "unduhan", "perf-%d.xml" % i)
                dl.save_as(path)
                names.append(dl.suggested_filename)
                sizes.append(os.path.getsize(path))
                v = d.evaluate("() => [window.__clickT[window.__clickT.length - 1], window.__dlT[window.__dlT.length - 1]]")
                ms.append(round(v[1] - v[0], 1) if v[0] is not None and v[1] is not None else None)
                wait_until(lambda: toasts_since(d, n0), 8, 0.2)
                tsts.append(toasts_since(d, n0))
                d.wait_for_timeout(3500)  # toast host 3 dtk: toast berikutnya = elemen baru (bukan teks yang diperbarui)
            shot(d, "7-P-300-ekspor.png")
        finally:
            cdp.send("Emulation.setCPUThrottlingRate", {"rate": 1})
        med = statistics.median([x for x in ms if x is not None]) if all(x is not None for x in ms) else None
        info("7a klik → a[download].click() di halaman (CPU 4×) ms / klik → event download Playwright ms / ukuran byte / DOM awal",
             [ms, wall, sizes, dom0])
        fname = "%s-%s.xml" % (WP.replace(" ", "-"), iso(TODAY))
        check("7a WP 300 task / 150 dependensi, CPU 4×: klik Ekspor → unduhan dipicu median %s ms ≤ %d ms (5 kali %r); berkas "
              "'%s' %d byte, toast 'Berkas … diunduh'; 0 tulis P" % (med, EXPORT_BUDGET_MS, ms, names[0] if names else None,
                                                                    sizes[0] if sizes else 0),
              med is not None and med <= EXPORT_BUDGET_MS and all(n == fname for n in names) and len(set(sizes)) == 1
              and all(t == ["Berkas %s diunduh" % fname] for t in tsts) and not writes(("P",), s7),
              repr((ms, names, sizes, tsts, writes(("P",), s7))))
    finally:
        cp.close()


def console_checks():
    allowed = re.compile(r"Failed to load resource|net::ERR_")
    bad = [(dv, t, x[:220]) for dv, t, x in c0.console_log if t in ("error", "pageerror") and not allowed.search(x)]
    info("konsol: error/peringatan (perangkat, jenis, teks)", [(dv, t, x[:160]) for dv, t, x in c0.console_log
                                                               if t in ("error", "pageerror", "warning")][:24])
    check("konsol tanpa galat aplikasi/plugin (semua perangkat)", not bad, repr(bad[:6]))


def main():
    if os.environ.get("TZ") != "Asia/Jakarta":
        print("PERINGATAN: jalankan dengan TZ=Asia/Jakarta", flush=True)
    os.makedirs(SHOTS, exist_ok=True)
    for fn in os.listdir(SHOTS):
        if fn.endswith(".png"):
            os.remove(os.path.join(SHOTS, fn))
    tmp = tempfile.mkdtemp(prefix="e2e_plugin_fase1_1d2_")
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
    out = {}
    try:
        users, ids, P, Q = seed(base, db_path)
        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            for name, fn in (("main", lambda: run(browser, base, users, ids, P, Q, tmp, out)),
                             ("native", lambda: run_native(browser, base, users["a"])),
                             ("mobile", lambda: run_mobile(browser, base, users["a"], tmp, out)),
                             ("clock", lambda: run_clock(browser, base, users, ids, P, out)),
                             ("old", lambda: run_old_client(browser, base, users, ids)),
                             ("perf", lambda: run_perf(browser, base, users["a"], tmp))):
                if name in SKIP:
                    print("LEWATI", name, flush=True)
                    continue
                try:
                    fn()
                except Exception as e:  # satu kelompok gagal tidak menghentikan yang lain
                    import traceback
                    traceback.print_exc()
                    check("%s exception" % name, False, "%s: %s" % (type(e).__name__, e))
            final = sorted(server_recs(base, users["a"]))
            info("akhir: record Timeline di server (U1)", final)
            want = {"prj@list", "bl1@list", "bl1@user", "bl2@user", "res@list"}
            got = set(k.split(":")[0] for k in final)
            check("akhir: record di server hanya yang dibuat eksplisit (Otomatis W lewat UI, baseline slot 1 dua unit W + pribadi "
                  "lewat UI, slot 2 pribadi + resource Sari lewat API): %r" % final,
                  got <= want and len([k for k in final if k.startswith("bl1@list:")]) == 2
                  and len([k for k in final if k.startswith("prj@")]) == 1, repr(final))
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
