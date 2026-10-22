"""E2E halaman Fokus Hari Ini: memilih task (Target ⭐, tab waktu, cari, chip, lembar filter, kelompok). Tidak dijalankan CI.

Data lewat API (satu user + satu workspace berjudul panjang): task pribadi di project "Alurik" / "Rumah" / tanpa
project, task workspace di "Kampanye Q4" dan "Konten Video Produk Baru Panjang Sekali", prioritas P1–P4, deadline
kemarin / hari ini / mendatang / tanpa, status next / waiting / someday / inbox, dan satu task ⭐.
Angka harapan dihitung di Python dari GET /api/tasks dengan aturan spec (quadrant dihitung server), bukan dari JS app.

Skenario: a Target + angka tab + urutan kelompok  b tab Hari ini/Terlambat, chip P1, P1+Q1, irisan  c cari huruf besar + ✕
d lembar filter (dialog, fokus, badge, Tampilkan N, Esc, pil, ✕ pil)  e catatan status tersembunyi → Tampilkan
f lipat kelompok + reload  g ⭐ dari baris (pindah ke Target, tanpa duplikat, kembali)  h filter project basi + Reset
i Zen + Work (bar/kelompok tersembunyi, lembar tertutup, Jeda, hitungan Zen, Target tanpa task aktif)
j storage rusak / diblokir  k task aktif dari halaman Tasks (Waiting, P3, tanpa deadline) masuk Target
l 375 px + Pixel 7 tanpa scroll horizontal, lima pil, lembar bawah  m badge sidebar + kartu Prioritas dashboard
n tanpa pageerror / console.error.
Screenshot terang + gelap, desktop + 375 px: temporary_files/e2e_focus_filter/.

    E2E_PYTHON=/path/python-dengan-dependensi-webapp python3 temporary_files/e2e_focus_filter.py
"""
import json
import os
import re
import shutil
import sys
import tempfile
import time
from datetime import date, timedelta

from playwright.sync_api import sync_playwright

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import e2e_focus_page as h  # harness: server, register, api, shot, nav, check

ROOT = h.ROOT
SHOTS = os.path.join(ROOT, "temporary_files", "e2e_focus_filter")
h.SHOTS = SHOTS
check = h.check
api = h.api

WS_NAME = "Tim Marketing Kampanye Akhir Tahun 2026"
PROJ_Q4 = "Kampanye Q4"
PROJ_LONG = "Konten Video Produk Baru Panjang Sekali"
STAR_TITLE = "Rawat tanaman balkon"
K_TITLE = "Tinjau kontrak vendor lama"

ERRS = []  # (konteks, jenis, teks): pageerror + console.error seluruh skenario
EXTERNAL = set()  # sumber eksternal (CDN/font) yang ditolak proxy sandbox: dilaporkan, tidak dihitung sebagai error


# ── data uji ────────────────────────────────────────────────────────────────────────────────────
def day(offset):
    return (date.today() + timedelta(days=offset)).isoformat()


def today_iso():
    return day(0)


# (kunci, judul, prioritas, offset deadline, status, project, workspace?)
TASKS = [
    ("A1", "Anggaran rilis versi baru", "P1", 0, "next", "Alurik", False),
    ("A2", "Atur ulang sidebar mobile", "P2", -1, "next", "Alurik", False),
    ("A3", "Audit performa sinkronisasi", "P3", 0, "waiting", "Alurik", False),
    ("A4", "Arsipkan laporan lama", "P4", 0, "next", "Alurik", False),
    ("F1", "Finalisasi deck presentasi", "P1", 3, "next", "Alurik", False),
    ("A5", "Analisis rencana kuartal", "P2", None, "someday", "Alurik", False),  # Q2: di luar cakupan
    ("R1", "Rapikan gudang belakang", "P1", -1, "next", "Rumah", False),
    ("R2", STAR_TITLE, "P3", -1, "next", "Rumah", False),  # ⭐
    ("R3", "Rencana belanja bulanan", "P2", 0, "inbox", "Rumah", False),
    ("N1", "Nomor rekening dicek", "P2", 0, "next", "", False),
    ("N4", "Nyetel printer kantor", "P2", 0, "next", "", False),  # seri dengan N1: urut judul
    ("N3", "Naikkan RAM laptop", "P4", -1, "next", "", False),
    ("N2", "Nyalakan pengingat pajak", "P3", None, "someday", "", False),  # Q4: di luar cakupan
    ("K1", "Kirim brief influencer", "P1", 0, "next", PROJ_Q4, True),
    ("K2", "Konfirmasi anggaran iklan", "P2", -1, "waiting", PROJ_Q4, True),
    ("K3", "Kumpulkan testimoni klien", "P3", 0, "someday", PROJ_Q4, True),
    ("V1", "Video teaser tiga puluh detik", "P1", -1, "next", PROJ_LONG, True),
    ("V2", "Voice over bahasa Indonesia", "P4", 0, "next", PROJ_LONG, True),
    ("V3", "Validasi naskah final", "P2", 0, "inbox", PROJ_LONG, True),
    ("W1", "Wawancara narasumber laporan internal", "P3", -1, "next", "", True),
    ("T1", K_TITLE, "P3", None, "waiting", "", False),  # Q4 + Waiting: dipakai skenario k
]


# ── model harapan (aturan spec, ditulis ulang di Python) ────────────────────────────────────────
PRI = {"P1": 0, "P2": 1, "P3": 2, "P4": 3}
STATUSES = ["next", "inbox", "waiting", "someday"]
QUICK_PRI = ["P1", "P2", "P3"]
QUICK_QUAD = ["Q1", "Q3"]


def F(**kw):
    f = {"time": "all", "status": ["next"], "pri": [], "quad": [], "proj": None}
    f.update(kw)
    return f


def fold(s):
    return re.sub(r"[A-Z]", lambda m: m.group(0).lower(), s or "")


def dl10(t):
    d = t.get("deadline")
    if isinstance(d, str) and re.fullmatch(r"\d{4}-\d{2}-\d{2}", d[:10]):
        return d[:10]
    return None


def bucket(t, today):
    d = dl10(t)
    if d is None:
        return "none"
    if d == today:
        return "today"
    if d < today:
        return "none" if t.get("gtd_status") in ("done", "archived") else "late"
    return "none"


def in_scope(t, today, focus_id=None, include_done=False):
    if t.get("gtd_status") == "archived":
        return False
    if t.get("gtd_status") == "done" and not include_done:
        return False
    return (t.get("quadrant") == "Q1" or bucket(t, today) != "none" or bool(t.get("is_focused"))
            or (focus_id is not None and str(t["id"]) == str(focus_id)))


def cmp_key(t):
    d = dl10(t)
    return (PRI.get(t.get("priority"), 9), 1 if d is None else 0, d or "", (t.get("title") or "").casefold(), t["id"])


def gkey(t):
    lid = t.get("list_id")
    return ("p" if lid in (None, "") else str(lid)) + ":" + fold(t.get("project") or "")


def split_target(scope, focus_id):
    marked = [t for t in scope if t.get("is_focused") or (focus_id is not None and str(t["id"]) == str(focus_id))]
    active = [t for t in marked if focus_id is not None and str(t["id"]) == str(focus_id)]
    rest = sorted([t for t in marked if t not in active], key=cmp_key)
    target = active + rest
    ids = {t["id"] for t in target}
    return target, [t for t in scope if t["id"] not in ids]


def norm(s):
    return " ".join((s or "").split()).lower()


def matches(t, f, query, today, skip=None):
    if skip != "time" and f["time"] != "all" and bucket(t, today) != f["time"]:
        return False
    if norm(query) and norm(query) not in norm(t.get("title")):
        return False
    if skip != "status" and f["status"] and t.get("gtd_status") not in f["status"]:
        return False
    if f["pri"] and t.get("priority") not in f["pri"]:
        return False
    if f["quad"] and t.get("quadrant") not in f["quad"]:
        return False
    if f["proj"] and gkey(t) != f["proj"]["key"]:
        return False
    return True


def build_groups(tasks, ws_names):
    gs = {}
    for t in sorted(tasks, key=cmp_key):
        lid = t.get("list_id")
        pribadi = lid in (None, "")
        g = gs.setdefault(gkey(t), {
            "key": gkey(t), "lid": lid, "pribadi": pribadi,
            "ws": "Pribadi" if pribadi else ws_names.get(str(lid), "Workspace"),
            "has_proj": bool(t.get("project")), "proj": t.get("project") or "Tanpa project", "tasks": []})
        g["tasks"].append(t)

    def order(g):
        return (0 if g["pribadi"] else 1, "" if g["pribadi"] else g["ws"].casefold(),
                0 if g["pribadi"] else int(g["lid"]), 0 if g["has_proj"] else 1,
                fold(g["proj"]) if g["has_proj"] else "")
    return sorted(gs.values(), key=order)


def exp_view(tasks, ws_names, f, query="", focus_id=None, collapsed=()):
    today = today_iso()
    scope = [t for t in tasks if in_scope(t, today, focus_id)]
    target, pool = split_target(scope, focus_id)
    shown = [t for t in pool if matches(t, f, query, today)]
    tpool = [t for t in pool if matches(t, f, query, today, "time")]
    spool = [t for t in pool if matches(t, f, query, today, "status")]
    groups = build_groups(shown, ws_names)
    return {
        "scope": scope, "target": [t["title"] for t in target], "pool": pool, "shown": shown,
        "tabs": {"Semua": len(tpool), "Hari ini": sum(bucket(t, today) == "today" for t in tpool),
                 "Terlambat": sum(bucket(t, today) == "late" for t in tpool)},
        "status_counts": {s: sum(1 for t in spool if t.get("gtd_status") == s) for s in STATUSES},
        "hidden": len(spool) - len(shown),
        "groups": [{"ws": g["ws"] + " ·", "name": g["proj"], "count": len(g["tasks"]), "collapsed": g["key"] in collapsed,
                    "titles": [] if g["key"] in collapsed else [t["title"] for t in g["tasks"]]} for g in groups],
        "titles": [t["title"] for t in shown],
        "proj_options": [(g["key"], g["ws"] + " · " + g["proj"], len(g["tasks"])) for g in build_groups(pool, ws_names)],
    }


# ── server + pembacaan UI ───────────────────────────────────────────────────────────────────────
class Env:
    pass


def all_tasks(env, user=None):
    return api(env.base, user or env.user, "GET", "/api/tasks")[1]


def tid(env, key):
    return env.ids[key]


def expect(env, f, query="", focus_key=None, collapsed=(), tasks=None):
    focus_id = env.ids[focus_key] if focus_key else None
    return exp_view(tasks if tasks is not None else all_tasks(env), env.ws_names, f, query, focus_id, collapsed)


READ_JS = """() => {
  const q = s => document.querySelector(s), qa = s => [...document.querySelectorAll(s)];
  const tabs = {}; let tabOn = null;
  qa('.focus-filter-time button').forEach(b => {
    const m = b.textContent.trim().match(/^(.*?)\\s*(\\d+)$/); if (!m) return;
    tabs[m[1]] = +m[2]; if (b.getAttribute('aria-pressed') === 'true') tabOn = m[1];
  });
  const titles = root => qa(root + ' .ftask-title').map(e => e.textContent.trim());
  const sec = qa('.focus-section').find(s => s.querySelector('.focus-section-title') && s.querySelector('.focus-section-title').textContent === 'Task hari ini');
  const note = q('.focus-filter-hidden-note'), empty = q('.focus-filter-empty'), badge = q('.focus-filter-badge'), inp = q('.focus-filter-search input');
  return {
    target: titles('.focus-target'),
    groups: qa('.focus-group').map(g => ({
      ws: g.querySelector('.focus-group-ws').textContent.trim(), name: g.querySelector('.focus-group-name').textContent.trim(),
      count: +g.querySelector('.focus-group-count').textContent, collapsed: g.classList.contains('is-collapsed'),
      expanded: g.querySelector('.focus-group-head').getAttribute('aria-expanded'),
      titles: [...g.querySelectorAll('.ftask-title')].map(e => e.textContent.trim())})),
    tabs, tabOn,
    pills: qa('.focus-filter-chips .focus-filter-chip.is-pill .focus-filter-pill-label').map(e => e.textContent.trim()),
    chipsOn: qa('.focus-filter-chips .focus-filter-chip:not(.is-pill):not(.is-reset)').filter(b => b.getAttribute('aria-pressed') === 'true').map(b => b.textContent.trim()),
    reset: !!q('.focus-filter-chips .is-reset'),
    badge: badge ? badge.textContent.trim() : null,
    note: note ? note.textContent.trim() : null,
    empty: empty ? empty.textContent.trim() : null,
    query: inp ? inp.value : null,
    poolCount: sec ? +sec.querySelector('.focus-section-count').textContent : null,
    summary: q('.focus-page-summary') ? q('.focus-page-summary').textContent.trim() : null,
  };
}"""


def ui(p):
    return p.evaluate(READ_JS)


def view_diff(u, e, keys):
    out = []
    for k in keys:
        a, b = u.get(k), e.get(k)
        if a != b:
            out.append("%s: UI=%r ≠ harapan=%r" % (k, a, b))
    return out


def settle(p, exp, keys, timeout=8.0):
    """Tunggu UI = harapan pada `keys` (sinkronisasi/refresh tak seketika). Mengembalikan (ok, selisih)."""
    end = time.time() + timeout
    while True:
        diffs = view_diff(ui(p), exp, keys)
        if not diffs or time.time() > end:
            return not diffs, diffs
        time.sleep(0.25)


def check_view(step, p, exp, keys, extra=True, extra_note=""):
    ok, diffs = settle(p, exp, keys)
    check(step, ok and extra, "; ".join(diffs)[:600] if diffs else extra_note)
    return ok and extra


def exp_ui_keys(e, collapsed=False):
    """Bentuk harapan yang sebanding dengan hasil READ_JS."""
    return {
        "target": e["target"], "tabs": e["tabs"], "poolCount": len(e["shown"]),
        "groups": [{"ws": g["ws"], "name": g["name"], "count": g["count"], "collapsed": g["collapsed"], "titles": g["titles"]}
                   for g in e["groups"]],
        "hidden": e["hidden"],
    }


def groups_view(u):
    return [{"ws": g["ws"], "name": g["name"], "count": g["count"], "collapsed": g["collapsed"], "titles": g["titles"]}
            for g in u["groups"]]


def check_list(step, p, e, extra=True, extra_note=""):
    """Target + kelompok + angka tab + jumlah seksi sama dengan harapan."""
    exp = {"target": e["target"], "tabs": e["tabs"], "poolCount": len(e["shown"]),
           "groups_v": [{"ws": g["ws"], "name": g["name"], "count": g["count"], "collapsed": g["collapsed"], "titles": g["titles"]}
                        for g in e["groups"]]}
    end = time.time() + 8
    while True:
        u = ui(p)
        u["groups_v"] = groups_view(u)
        diffs = view_diff(u, exp, ["target", "tabs", "poolCount", "groups_v"])
        if not diffs or time.time() > end:
            break
        time.sleep(0.25)
    check(step, not diffs and extra, ("; ".join(diffs)[:700]) if diffs else extra_note)
    return u, not diffs and extra


# ── konteks browser ─────────────────────────────────────────────────────────────────────────────
def open_ctx(pw, browser, env, user, kind="desktop", theme="light", init=None, tag=""):
    """kind: desktop (1280) | 375 | pixel7. Seluruh pageerror + console.error dicatat di ERRS."""
    if kind == "pixel7":
        ctx = browser.new_context(**pw.devices["Pixel 7"], service_workers="block")
    elif kind == "375":
        ctx = browser.new_context(service_workers="block", viewport={"width": 375, "height": 812},
                                  has_touch=True, is_mobile=True, device_scale_factor=2)
    else:
        ctx = browser.new_context(service_workers="block", viewport={"width": 1280, "height": 860})
    if init:
        ctx.add_init_script(init)
    ctx.add_cookies([{"name": "token", "value": user["token"], "url": env.base, "httpOnly": True, "sameSite": "Lax"}])
    p = ctx.new_page()
    label = "%s/%s/%s%s" % (kind, theme, user["username"], tag)
    def on_console(m):
        if m.type != "error":
            return
        url = (m.location or {}).get("url", "")
        if m.text.startswith("Failed to load resource") and not url.startswith(env.base):
            EXTERNAL.add(url)  # CDN/font eksternal ditolak proxy sandbox: bukan kesalahan aplikasi
            return
        ERRS.append((label, "console.error", m.text[:300] + (" @ " + url if url else "")))
    p.on("pageerror", lambda e: ERRS.append((label, "pageerror", str(e)[:300])))
    p.on("console", on_console)
    p.goto(env.base + "/manifest.json")
    p.evaluate("""([t, u, tours, theme]) => {
        localStorage.setItem('tf_token', t); localStorage.setItem('tf_user_id', String(u));
        for (const pg of tours) localStorage.setItem('tf_tour_' + pg, '1');
        localStorage.setItem('tf_dismiss_onboarding', '1');
        localStorage.setItem('tf_theme', theme);
        localStorage.setItem('tf_groupby', 'none');
        localStorage.setItem('tf_viewmode', 'normal');
    }""", [user["token"], user["id"], h.TOURS, theme])
    p.goto(env.base + "/")
    p.locator(".sidebar-link, .sidebar-rail-btn, .mobile-topbar").first.wait_for(state="attached", timeout=20000)
    p.mobile = kind != "desktop"
    return ctx, p


def go_focus(p, bar=True):
    if not (p.locator(".focus-pomo").count() and p.locator(".focus-pomo").first.is_visible()):
        if p.mobile:
            p.locator(".mobile-topbar button").first.tap()
            p.wait_for_timeout(600)
            p.locator(".sidebar-link").filter(has_text="Fokus Hari Ini").first.tap()
        else:
            h.nav(p, "Fokus Hari Ini")
        p.locator(".focus-pomo").first.wait_for(state="visible", timeout=20000)
    if bar:
        p.locator(".focus-filter").first.wait_for(state="visible", timeout=20000)
    p.wait_for_timeout(300)


def fresh(p, bar=True):
    """Filter + kelompok terlipat dikosongkan, muat ulang, kembali ke halaman Fokus (default)."""
    p.evaluate("() => { localStorage.removeItem('tf_focus_filter'); localStorage.removeItem('tf_focus_collapsed'); }")
    p.reload()
    p.locator(".sidebar-link, .sidebar-rail-btn, .mobile-topbar").first.wait_for(state="attached", timeout=20000)
    go_focus(p, bar)


def open_sheet(p):
    p.locator(".focus-filter-btn").click()
    p.locator(".focus-filter-sheet").wait_for(state="visible", timeout=5000)
    p.wait_for_timeout(400)


def close_sheet_go(p):
    p.locator(".focus-filter-sheet-go").click()
    p.locator(".focus-filter-sheet").wait_for(state="detached", timeout=5000)
    p.wait_for_timeout(250)


def sheet_chip(p, text, group=None):
    sel = p.locator(".focus-filter-sheet")
    if group:
        sel = sel.locator(".focus-filter-sheet-group").filter(has=p.locator("h4", has_text=group))
    return sel.locator(".focus-filter-chip").filter(has_text=text).first


def quick_chip(p, label):
    return p.locator(".focus-filter-chips").get_by_role("button", name=label, exact=True)


def tab_btn(p, label):
    return p.locator(".focus-filter-time button").filter(has_text=label).first


def row(p, title, scope=""):
    return p.locator(scope + " .ftask").filter(has=p.locator(".ftask-title", has_text=title)).first


def no_hscroll(p):
    return p.evaluate("() => [document.documentElement.scrollWidth, window.innerWidth]")


def proj_filter(env, project, ws=False):
    lid = env.list_id if ws else None
    return {"key": ("p" if lid is None else str(lid)) + ":" + fold(project), "label": ""}


def wait_until(fn, timeout=15, step=0.3):
    end = time.time() + timeout
    while time.time() < end:
        try:
            if fn():
                return True
        except Exception:
            pass
        time.sleep(step)
    return False


def sidebar_badge(p):
    """Angka badge menu 'Fokus Hari Ini' (sidebar dibuka penuh dulu bila sedang mode ikon)."""
    link = p.locator(".sidebar-link").filter(has_text="Fokus Hari Ini").first
    if not link.is_visible():
        p.locator("button[aria-label='Tampilkan semua menu']").first.click()
        link.wait_for(state="visible", timeout=5000)
    text = link.inner_text().strip()
    m = re.search(r"(\d+)\s*$", text)
    return (int(m.group(1)) if m else None), text


def scroll_list(p):
    """Gulir halaman supaya seksi 'Task hari ini' (bar filter + kelompok) tepat di bawah top bar, untuk screenshot."""
    p.evaluate("""() => { const s = document.querySelector('.focus-target') || document.querySelector('[data-tour=today-list]');
        if (!s) return; window.scrollTo(0, Math.max(0, s.getBoundingClientRect().top + window.scrollY - 64)); }""")
    p.wait_for_timeout(250)


def get_task(env, key, user=None):
    return next((t for t in all_tasks(env, user) if t["id"] == env.ids[key]), None)


# ── skenario ────────────────────────────────────────────────────────────────────────────────────
def scenario_a(env, p):
    go_focus(p)
    e = expect(env, F())
    u, ok = check_list("a1 desktop 1280: Target + kelompok + angka tab = harapan (data API)", p, e)
    check("a2 Target berisi task ⭐ dan judulnya tidak ada di .focus-group",
          u["target"] == [STAR_TITLE] and not any(STAR_TITLE in g["titles"] for g in u["groups"]),
          "target=%r" % u["target"])
    heads = [g["ws"] + " " + g["name"] for g in u["groups"]]
    pri_idx = [i for i, g in enumerate(u["groups"]) if g["ws"] == "Pribadi ·"]
    ws_idx = [i for i, g in enumerate(u["groups"]) if g["ws"] == WS_NAME + " ·"]
    check("a3 urutan kelompok: Pribadi dulu, lalu workspace; 'Tanpa project' terakhir dalam Pribadi",
          pri_idx and ws_idx and max(pri_idx) < min(ws_idx) and u["groups"][max(pri_idx)]["name"] == "Tanpa project"
          and heads == [x["ws"] + " " + x["name"] for x in e["groups"]], repr(heads))
    check("a4 judul bagian 'Target hari ini' / 'Task hari ini' dan jumlah = harapan",
          p.locator(".focus-section-title").all_inner_texts().count("Target hari ini") == 1
          and u["poolCount"] == len(e["shown"]) and u["summary"].startswith("%d tugas" % len(e["scope"])),
          "ringkasan=%r, jumlah=%r" % (u["summary"], u["poolCount"]))
    check("a5 ⭐ di baris Target: aria-label konstan 'Target hari ini', aria-pressed=true, title 'Lepas dari target hari ini'",
          p.locator(".focus-target .ftask-star").get_attribute("aria-label") == "Target hari ini"
          and p.locator(".focus-target .ftask-star").get_attribute("aria-pressed") == "true"
          and p.locator(".focus-target .ftask-star").get_attribute("title") == "Lepas dari target hari ini")
    check("a6 ⭐ di baris kelompok: aria-pressed=false, title 'Tandai sebagai target hari ini'",
          p.locator(".focus-group .ftask-star").first.get_attribute("aria-pressed") == "false"
          and p.locator(".focus-group .ftask-star").first.get_attribute("title") == "Tandai sebagai target hari ini")
    # Task di luar cakupan tidak muncul di mana pun
    shown = set(u["target"]) | {t for g in u["groups"] for t in g["titles"]}
    check("a7 task di luar cakupan (Q2/Q4) dan task Waiting/Someday/Inbox (status default) tidak tampil",
          not ({"Analisis rencana kuartal", "Nyalakan pengingat pajak", K_TITLE, "Audit performa sinkronisasi",
                "Rencana belanja bulanan", "Kumpulkan testimoni klien"} & shown), repr(sorted(shown))[:300])
    h.shot(p, "default_light_desktop.png")


def scenario_b(env, p):
    fresh(p)
    tab_btn(p, "Hari ini").click()
    e = expect(env, F(time="today"))
    check_list("b1 tab 'Hari ini' → judul yang tampil = harapan", p, e,
               extra=ui(p)["tabOn"] == "Hari ini" and tab_btn(p, "Hari ini").get_attribute("aria-pressed") == "true")
    tab_btn(p, "Terlambat").click()
    e = expect(env, F(time="late"))
    u, _ = check_list("b2 tab 'Terlambat' → judul yang tampil = harapan", p, e, extra=ui(p)["tabOn"] == "Terlambat")
    check("b2b jumlah baris di kelompok = jumlah task terlambat harapan",
          p.locator(".focus-group .ftask-title").count() == len(e["titles"]) and len(e["titles"]) > 0)
    tab_btn(p, "Semua").click()
    quick_chip(p, "P1").click()
    e = expect(env, F(pri=["P1"]))
    check_list("b3 chip P1 → hanya P1", p, e, extra=ui(p)["chipsOn"] == ["P1"])
    quick_chip(p, "Q1").click()
    e = expect(env, F(pri=["P1"], quad=["Q1"]))
    check_list("b4 chip P1 + Q1 → irisan", p, e, extra=ui(p)["chipsOn"] == ["P1", "Q1"])
    quick_chip(p, "P1").click()
    quick_chip(p, "P2").click()
    quick_chip(p, "P3").click()
    e = expect(env, F(pri=["P2", "P3"], quad=["Q1"]))
    ok_inter = all(t.get("quadrant") == "Q1" and t["priority"] in ("P2", "P3") for t in e["shown"])
    check_list("b5 P2 atau P3, dan Q1 → 'atau' dalam satu jenis, 'dan' antarjenis (irisan tak kosong)", p, e,
               extra=ok_inter and len(e["shown"]) > 0 and ui(p)["chipsOn"] == ["P2", "P3", "Q1"])
    check("b6 chip cepat aktif → Reset muncul; badge dan pil tidak ada (chip cepat tidak dihitung)",
          ui(p)["badge"] is None and ui(p)["reset"] is True and ui(p)["pills"] == [])


def scenario_c(env, p):
    fresh(p)
    box = p.locator(".focus-filter-search input")
    check("c0 kotak cari: placeholder 'Cari judul task…', aria-label 'Cari task'",
          box.get_attribute("placeholder") == "Cari judul task…" and box.get_attribute("aria-label") == "Cari task")
    box.click()
    box.fill("LAPORAN")
    e = expect(env, F(), "LAPORAN")
    u, _ = check_list("c1 query huruf besar 'LAPORAN' → hanya judul yang cocok (huruf kecil/besar diabaikan)", p, e,
                      extra=len(e["titles"]) >= 2 and set(ui(p)["target"]) == {STAR_TITLE})
    check("c1b judul yang tampil = {Arsipkan laporan lama, Wawancara narasumber laporan internal}",
          sorted(e["titles"]) == ["Arsipkan laporan lama", "Wawancara narasumber laporan internal"], repr(e["titles"]))
    p.locator(".focus-filter-clear").click()
    e = expect(env, F())
    check_list("c2 ✕ hapus → kembali ke daftar default", p, e,
               extra=ui(p)["query"] == "" and p.locator(".focus-filter-clear").count() == 0)
    check("c2b fokus kembali ke kotak cari setelah ✕",
          p.evaluate("document.activeElement === document.querySelector('.focus-filter-search input')"))


def scenario_d(env, p):
    fresh(p)
    btn = p.locator(".focus-filter-btn")
    check("d0 tombol Filter: aria-label 'Filter lainnya', aria-haspopup=dialog, aria-expanded=false, tanpa badge",
          btn.get_attribute("aria-label") == "Filter lainnya" and btn.get_attribute("aria-haspopup") == "dialog"
          and btn.get_attribute("aria-expanded") == "false" and ui(p)["badge"] is None)
    open_sheet(p)
    sheet = p.locator(".focus-filter-sheet")
    check("d1 lembar role=dialog + aria-modal tampil, judul 'Filter lainnya'",
          sheet.get_attribute("role") == "dialog" and sheet.get_attribute("aria-modal") == "true"
          and sheet.locator(".focus-filter-sheet-title").inner_text() == "Filter lainnya"
          and btn.get_attribute("aria-expanded") == "true")
    check("d2 fokus pindah ke chip pertama (Next) di lembar",
          p.evaluate("document.activeElement === document.querySelector('.focus-filter-sheet .focus-filter-chip')")
          and "Next" in p.evaluate("document.activeElement.textContent"))
    subs = sheet.locator(".focus-filter-sheet-sub").all_text_contents()  # tampil kapital via CSS, teks aslinya kapital kecil
    check("d2b subjudul lembar + catatan default",
          subs == ["Status", "Prioritas", "Kuadran", "Workspace › Project"]
          and "Default: Next saja. Kosongkan semua untuk menampilkan semua status." in sheet.inner_text(), repr(subs))
    e0 = expect(env, F())
    sc = e0["status_counts"]
    chips = {s: sheet_chip(p, lbl, "Status").inner_text().split() for s, lbl in
             (("next", "Next"), ("inbox", "Inbox"), ("waiting", "Waiting"), ("someday", "Someday"))}
    check("d2c angka chip status = harapan (Next/Inbox/Waiting/Someday)",
          all(int(chips[s][-1]) == sc[s] for s in STATUSES), "UI=%r harapan=%r" % (chips, sc))
    # Tab ke-N dan Shift+Tab berputar di dalam lembar
    last = sheet.locator("button").last
    last.focus()
    p.keyboard.press("Tab")
    check("d2d Tab dari elemen terakhir berputar ke elemen pertama di dalam lembar",
          p.evaluate("document.activeElement === document.querySelector('.focus-filter-sheet button')"))
    sheet_chip(p, "Waiting", "Status").click()
    sheet_chip(p, PROJ_Q4, "Workspace").click()
    f = F(status=["next", "waiting"], proj=proj_filter(env, PROJ_Q4, ws=True))
    e = expect(env, f)
    go_txt = sheet.locator(".focus-filter-sheet-go").inner_text()
    check("d3 pilih Waiting + project → badge '2' dan tombol 'Tampilkan N task' = harapan",
          ui(p)["badge"] == "2" and go_txt == "Tampilkan %d task" % len(e["shown"]) and len(e["shown"]) == 2
          and btn.get_attribute("aria-label") == "Filter lainnya, 2 aktif", "badge=%r, tombol=%r" % (ui(p)["badge"], go_txt))
    scroll_list(p)
    h.shot(p, "sheet_selected_light_desktop.png")
    p.keyboard.press("Escape")
    p.locator(".focus-filter-sheet").wait_for(state="detached", timeout=3000)
    p.wait_for_timeout(200)
    check("d4 Esc → lembar tertutup, fokus di tombol Filter",
          p.evaluate("document.activeElement === document.querySelector('.focus-filter-btn')")
          and btn.get_attribute("aria-expanded") == "false")
    u = ui(p)
    check("d5 pil 'Status: Next, Waiting' dan pil project tampil",
          u["pills"] == ["Status: Next, Waiting", WS_NAME + " · " + PROJ_Q4], repr(u["pills"]))
    check_list("d5b daftar = harapan untuk status Next+Waiting dan project terpilih", p, e)
    p.get_by_role("button", name="Hapus filter " + WS_NAME + " · " + PROJ_Q4).click()
    p.wait_for_timeout(300)
    check("d6 ✕ pada pil project → badge '1', pil project hilang", ui(p)["badge"] == "1"
          and ui(p)["pills"] == ["Status: Next, Waiting"], "badge=%r pills=%r" % (ui(p)["badge"], ui(p)["pills"]))
    # klik di luar (latar) menutup lembar; "Tampilkan" menutup lembar dan fokus kembali
    open_sheet(p)
    p.locator(".focus-filter-backdrop").click(position={"x": 8, "y": 8}, force=True)
    p.locator(".focus-filter-sheet").wait_for(state="detached", timeout=3000)
    p.wait_for_timeout(250)
    check("d7 klik di luar menutup lembar, fokus kembali ke tombol Filter",
          p.evaluate("document.activeElement === document.querySelector('.focus-filter-btn')"))
    open_sheet(p)
    close_sheet_go(p)
    p.wait_for_timeout(250)
    check("d8 'Tampilkan N task' menutup lembar, fokus kembali ke tombol Filter",
          p.evaluate("document.activeElement === document.querySelector('.focus-filter-btn')"))
    e = expect(env, F(status=["next", "waiting"]))
    check_list("d9 filter hanya status Next+Waiting → daftar = harapan", p, e)


def scenario_e(env, p):
    fresh(p)
    e = expect(env, F())
    u = ui(p)
    want = "%d task berstatus lain disembunyikan · Tampilkan" % e["hidden"]
    check("e1 catatan 'N task berstatus lain disembunyikan · Tampilkan' (N = harapan)",
          e["hidden"] > 0 and u["note"] == want, "UI=%r harapan=%r" % (u["note"], want))
    p.locator(".focus-filter-hidden-note .focus-filter-link").click()
    e = expect(env, F(status=[]))
    u, _ = check_list("e2 Tampilkan → semua status tampil (daftar = harapan)", p, e)
    shown = {t for g in u["groups"] for t in g["titles"]}
    check("e3 pil 'Semua status' + task Waiting/Someday/Inbox tampil; catatan hilang",
          u["pills"] == ["Semua status"] and u["note"] is None
          and {"Audit performa sinkronisasi", "Kumpulkan testimoni klien", "Rencana belanja bulanan",
               "Validasi naskah final"} <= shown, "pil=%r" % u["pills"])
    p.get_by_role("button", name="Hapus filter Semua status").click()
    p.wait_for_timeout(300)
    check("e4 ✕ pil 'Semua status' → kembali ke Next saja", ui(p)["pills"] == [] and ui(p)["note"] == want)


def scenario_f(env, p):
    fresh(p)
    e = expect(env, F())
    alurik = next(g for g in e["groups"] if g["ws"] == "Pribadi ·" and g["name"] == "Alurik")
    head = p.locator(".focus-group").filter(has=p.locator(".focus-group-name", has_text=re.compile("^Alurik$"))).locator(".focus-group-head")
    check("f1 judul kelompok = tombol aria-expanded=true", head.get_attribute("aria-expanded") == "true"
          and len(alurik["titles"]) > 0)
    head.click()
    p.wait_for_timeout(300)
    grp = p.locator(".focus-group").filter(has=p.locator(".focus-group-name", has_text=re.compile("^Alurik$")))
    check("f2 lipat kelompok → isinya hilang, hitungan tetap, kelas is-collapsed",
          grp.locator(".ftask").count() == 0 and "is-collapsed" in (grp.get_attribute("class") or "")
          and head.get_attribute("aria-expanded") == "false"
          and int(grp.locator(".focus-group-count").inner_text()) == len(alurik["titles"]))
    # Setel filter yang menyisakan kelompok Alurik: Hari ini + Semua status + chip Q1
    tab_btn(p, "Hari ini").click()
    p.locator(".focus-filter-hidden-note .focus-filter-link").click()
    quick_chip(p, "Q1").click()
    p.locator(".focus-filter-search input").fill("rilis")
    p.wait_for_timeout(300)
    key = "p:alurik"
    f = F(time="today", status=[], quad=["Q1"])
    before = ui(p)
    ls = p.evaluate("[localStorage.getItem('tf_focus_filter'), localStorage.getItem('tf_focus_collapsed')]")
    saved = json.loads(ls[0]) if ls[0] else None
    check("f3 sebelum reload: tf_focus_filter tersimpan ternormalisasi dan tf_focus_collapsed memuat kunci kelompok",
          saved == {"time": "today", "status": [], "pri": [], "quad": ["Q1"], "proj": None}
          and json.loads(ls[1]) == [key], repr(ls))
    p.reload()
    p.locator(".sidebar-link, .sidebar-rail-btn").first.wait_for(state="attached", timeout=20000)
    go_focus(p)
    u = ui(p)
    check("f4 reload → tab Hari ini, chip Q1, pil 'Semua status' bertahan; kata cari kosong",
          u["tabOn"] == "Hari ini" and u["chipsOn"] == ["Q1"] and u["pills"] == ["Semua status"] and u["query"] == "",
          "tab=%r chip=%r pil=%r query=%r" % (u["tabOn"], u["chipsOn"], u["pills"], u["query"]))
    e = expect(env, f, "", collapsed={key})
    g = next((x for x in u["groups"] if x["name"] == "Alurik"), None)
    check("f5 reload → kelompok Alurik tetap terlipat (hitungan tampil, tanpa baris)",
          g is not None and g["collapsed"] and g["expanded"] == "false" and g["titles"] == [], repr(g))
    check_list("f6 reload → daftar = harapan (filter diterapkan, tanpa kata cari)", p, e)
    # buka lagi → tf_focus_collapsed dikosongkan
    p.locator(".focus-group").filter(has=p.locator(".focus-group-name", has_text=re.compile("^Alurik$"))).locator(".focus-group-head").click()
    p.wait_for_timeout(300)
    check("f7 buka lagi → tf_focus_collapsed kosong", json.loads(p.evaluate("localStorage.getItem('tf_focus_collapsed')")) == [])


def scenario_g(env, p):
    fresh(p)
    title = "Rapikan gudang belakang"
    r = row(p, title, ".focus-group")
    check("g0 baris R1 ada di kelompok 'Rumah' sebelum ⭐", r.count() == 1)
    r.locator(".ftask-star").click()
    p.locator(".toast").filter(has_text="Ditambahkan ke Fokus").first.wait_for(state="visible", timeout=5000)
    check("g1 ⭐ pada baris di kelompok → toast '⭐ Ditambahkan ke Fokus'", True)
    wait_until(lambda: (get_task(env, "R1") or {}).get("is_focused"))
    e = expect(env, F())
    u, _ = check_list("g2 task pindah ke Target dan hilang dari kelompok (daftar = harapan)", p, e)
    check("g3 task tidak duplikat: tepat satu baris berjudul itu di seluruh halaman",
          p.locator(".ftask").filter(has=p.locator(".ftask-title", has_text=title)).count() == 1
          and title in u["target"] and not any(title in g["titles"] for g in u["groups"]),
          "target=%r" % u["target"])
    star = row(p, title, ".focus-target").locator(".ftask-star")
    check("g4 ⭐ di Target: aria-pressed=true, title 'Lepas dari target hari ini', aria-label konstan",
          star.get_attribute("aria-pressed") == "true" and star.get_attribute("title") == "Lepas dari target hari ini"
          and star.get_attribute("aria-label") == "Target hari ini")
    star.click()
    p.locator(".toast").filter(has_text="Dihapus dari Fokus").first.wait_for(state="visible", timeout=5000)
    wait_until(lambda: not (get_task(env, "R1") or {}).get("is_focused"))
    e = expect(env, F())
    u, _ = check_list("g5 ⭐ lagi → task kembali ke kelompoknya (daftar = harapan)", p, e)
    check("g6 task kembali ke kelompok 'Rumah' dan tidak duplikat",
          any(g["name"] == "Rumah" and title in g["titles"] for g in u["groups"]) and title not in u["target"]
          and p.locator(".ftask").filter(has=p.locator(".ftask-title", has_text=title)).count() == 1)


def scenario_h(env, p):
    fresh(p)
    open_sheet(p)
    sheet_chip(p, "Rumah", "Workspace").click()
    close_sheet_go(p)
    rumah = [k for k in ("R1", "R2", "R3")]
    u = ui(p)
    check("h1 pilih project Rumah → pil 'Pribadi · Rumah'", u["pills"] == ["Pribadi · Rumah"], repr(u["pills"]))
    for k in rumah:
        api(env.base, env.user, "PUT", "/api/tasks/%d" % env.ids[k], json={"gtd_status": "done"})
    p.reload()
    p.locator(".sidebar-link, .sidebar-rail-btn").first.wait_for(state="attached", timeout=20000)
    go_focus(p)
    # Jemput data baru (reload menyinkronkan); tunggu sampai kelompok Rumah hilang
    wait_until(lambda: ui(p)["empty"] is not None, timeout=12)
    u = ui(p)
    check("h2 semua task Rumah selesai + refresh → pil tetap, pesan 'Tidak ada task yang cocok dengan filter ini.' tampil",
          u["pills"] == ["Pribadi · Rumah"] and (u["empty"] or "").startswith("Tidak ada task yang cocok dengan filter ini.")
          and u["groups"] == [], "pil=%r kosong=%r" % (u["pills"], u["empty"]))
    open_sheet(p)
    opt = sheet_chip(p, "Rumah", "Workspace")
    e_now = expect(env, F(proj={"key": "p:rumah", "label": "Pribadi · Rumah"}))
    check("h3 lembar: opsi 'Pribadi · Rumah' tetap ada dengan angka 0, terpilih; 'Tampilkan 0 task'",
          opt.inner_text().split()[-1] == "0" and opt.get_attribute("aria-pressed") == "true"
          and p.locator(".focus-filter-sheet-go").inner_text() == "Tampilkan 0 task"
          and not any(o[0] == "p:rumah" for o in e_now["proj_options"]),
          "opsi=%r" % opt.inner_text())
    p.keyboard.press("Escape")
    p.locator(".focus-filter-sheet").wait_for(state="detached", timeout=3000)
    ls = json.loads(p.evaluate("localStorage.getItem('tf_focus_filter')"))
    check("h4 tf_focus_filter tetap memuat project Rumah setelah reload (tidak dihapus diam-diam)",
          ls["proj"] and ls["proj"]["key"] == "p:rumah", repr(ls))
    p.locator(".focus-filter-empty .focus-filter-link").click()
    p.wait_for_timeout(300)
    e = expect(env, F())
    u, _ = check_list("h5 'Reset filter' → default (Review Focus 3): daftar = harapan, tanpa pil", p, e,
                      extra=ui(p)["pills"] == [] and ui(p)["badge"] is None and ui(p)["empty"] is None)
    ls = json.loads(p.evaluate("localStorage.getItem('tf_focus_filter')"))
    check("h6 tf_focus_filter = default setelah Reset",
          ls == {"time": "all", "status": ["next"], "pri": [], "quad": [], "proj": None}, repr(ls))


def zen_hidden_state(p):
    return p.evaluate("""() => ({
      filter: !!document.querySelector('.focus-filter.is-zen-hidden[aria-hidden="true"]'),
      groups: [...document.querySelectorAll('.focus-group')].map(g => g.classList.contains('is-zen-hidden')),
      note: (document.querySelector('.focus-zen-note') || {}).textContent || null,
      zen: !!document.querySelector('.focus-page.is-zen'),
      sheet: !!document.querySelector('.focus-filter-sheet'),
      filterShown: !!document.querySelector('.focus-filter.is-zen-shown'),
    })""")


def scenario_i(env, p):
    # Skenario h menyelesaikan task ⭐ lama; pasang ⭐ pada N1 supaya Target punya ⭐ selain task aktif.
    api(env.base, env.user, "POST", "/api/tasks/%d/focus" % env.ids["N1"])
    p.reload()
    p.locator(".sidebar-link, .sidebar-rail-btn").first.wait_for(state="attached", timeout=20000)
    fresh(p)
    check("i00 Target memuat ⭐ N1 sebelum Zen", ui(p)["target"] == ["Nomor rekening dicek"], repr(ui(p)["target"]))
    p.locator(".focus-zen-btn").click()
    check("i0 Zen dinyalakan (aria-pressed=true) tapi timer belum jalan → bar filter dan kelompok tetap terlihat",
          p.locator(".focus-zen-btn").get_attribute("aria-pressed") == "true"
          and zen_hidden_state(p)["filter"] is False and not any(zen_hidden_state(p)["groups"]))
    # Mulai tanpa task aktif ditolak → Target tidak bisa 'tanpa task aktif' saat Work berjalan lewat jalur ini
    p.locator(".focus-pomo .pomo-btn-main").first.click()
    p.locator(".toast").filter(has_text="Pilih satu task terlebih dahulu").first.wait_for(state="visible", timeout=4000)
    check("i1 Mulai tanpa task aktif ditolak (toast 'Pilih satu task…'), Zen tidak aktif — Work tak bisa jalan tanpa task",
          zen_hidden_state(p)["zen"] is False and p.locator(".focus-target").count() == 1)
    quick_chip(p, "P1").click()  # filter aktif: hitungan Zen harus tetap tidak terpengaruh filter
    p.wait_for_timeout(300)
    title = "Anggaran rilis versi baru"
    row(p, title, ".focus-group").locator(".ftask-focus-btn").click()
    p.wait_for_timeout(500)
    open_sheet(p)
    check("i2 lembar filter dibuka sebelum Mulai", p.locator(".focus-filter-sheet").count() == 1)
    # Latar lembar menutupi halaman; Work dimulai lewat jalur lain (klik programatik pada tombol Mulai)
    p.evaluate("document.querySelector('.focus-pomo .pomo-btn-main').click()")
    p.wait_for_selector(".focus-page.is-zen", timeout=4000)
    p.wait_for_timeout(900)
    zs = zen_hidden_state(p)
    check("i3 Work berjalan → .focus-filter dan setiap .focus-group ber-is-zen-hidden (aria-hidden)",
          zs["filter"] and zs["groups"] and all(zs["groups"]), repr(zs))
    check("i4 lembar tertutup saat Work berjalan", zs["sheet"] is False and p.locator(".focus-filter-sheet").count() == 0)
    e = expect(env, F(pri=["P1"]), focus_key="A1")
    n_zen = len({t["id"] for t in e["scope"]} - {env.ids["A1"]})
    check("i5 catatan Zen = (Target ∪ pool) − task aktif, tak terpengaruh filter (chip P1 aktif)",
          (zs["note"] or "").strip() == "Mode Zen · %d task lain disembunyikan sampai istirahat" % n_zen,
          "UI=%r harapan N=%d (jika terhitung filter: %d)" % (zs["note"], n_zen, len(e["shown"])))
    tsec = p.locator("section.focus-section").filter(has=p.locator(".focus-target"))
    check("i6 seksi Target memuat task aktif → tetap tampil; ⭐ lain ber-is-zen-hidden",
          "is-zen-hidden" not in (tsec.get_attribute("class") or "")
          and p.locator(".focus-target .ftask.is-focusing").count() == 1
          and p.locator(".focus-target .ftask.is-zen-hidden").count() == len(e["target"]) - 1)
    h.shot(p, "zen_light_desktop.png")
    p.locator(".focus-pomo .pomo-btn-main.is-pause").first.click()
    p.wait_for_timeout(700)
    zs = zen_hidden_state(p)
    check("i7 Jeda → bar filter dan kelompok tampil lagi; lembar tidak terbuka sendiri",
          zs["zen"] is False and zs["filter"] is False and not any(zs["groups"]) and zs["sheet"] is False
          and p.locator(".focus-filter").is_visible() and p.locator(".focus-group").first.is_visible(), repr(zs))
    # Target tanpa task aktif: task aktif diselesaikan dari tempat lain saat Work berjalan, ⭐ lain tetap di Target
    p.locator(".focus-pomo .pomo-btn-main").first.click()
    p.wait_for_selector(".focus-page.is-zen", timeout=4000)
    api(env.base, env.user, "PUT", "/api/tasks/%d" % env.ids["A1"], json={"gtd_status": "done"})
    p.evaluate("() => typeof window.__refreshTasks === 'function' ? window.__refreshTasks() : null")
    ok = wait_until(lambda: "is-zen-hidden" in (p.locator("section.focus-section").filter(has=p.locator(".focus-target")).first.get_attribute("class") or ""),
                    timeout=10)
    tsec = p.locator("section.focus-section").filter(has=p.locator(".focus-target")).first
    check("i8 Zen tanpa task aktif di Target (task aktif selesai di tempat lain, ⭐ tetap) → seksi Target ber-is-zen-hidden + aria-hidden",
          ok and tsec.get_attribute("aria-hidden") == "true" and p.locator(".focus-target .ftask.is-focusing").count() == 0,
          "kelas=%r target=%r" % (tsec.get_attribute("class"), p.locator(".focus-target .ftask-title").all_inner_texts()))


def scenario_j(env, pw, browser, user):
    for variant in ("rusak", "diblokir"):
        init = None
        if variant == "diblokir":
            init = """(() => { const g = Storage.prototype.getItem;
                Storage.prototype.getItem = function (k) { if (k === 'tf_focus_filter' || k === 'tf_focus_collapsed') throw new DOMException('blocked', 'SecurityError'); return g.call(this, k); }; })();"""
        ctx, p = open_ctx(pw, browser, env, user, init=init, tag="-j-" + variant)
        try:
            n0 = len(ERRS)
            if variant == "rusak":
                p.evaluate("""() => { localStorage.setItem('tf_focus_filter', '{rusak'); localStorage.setItem('tf_focus_collapsed', '[1,{}]'); }""")
                p.reload()
                p.locator(".sidebar-link, .sidebar-rail-btn").first.wait_for(state="attached", timeout=20000)
            go_focus(p)
            e = expect(env, F())
            u, _ = check_list("j%s halaman tampil default (%s) = harapan" % ("1" if variant == "rusak" else "2", "tf_focus_filter='{rusak' + tf_focus_collapsed='[1,{}]'" if variant == "rusak" else "getItem melempar SecurityError"),
                              p, e, extra=ui(p)["tabOn"] == "Semua" and ui(p)["pills"] == [] and ui(p)["badge"] is None
                              and all(not g["collapsed"] for g in ui(p)["groups"]))
            # tetap berfungsi: lipat + filter tidak melempar
            p.locator(".focus-group-head").first.click()
            quick_chip(p, "P1").click()
            p.wait_for_timeout(300)
            check("j%s%s halaman tetap bisa dipakai (lipat/chip) tanpa pageerror" % ("1" if variant == "rusak" else "2", "b"),
                  [x for x in ERRS[n0:] if x[1] == "pageerror"] == [], repr(ERRS[n0:])[:300])
        finally:
            ctx.close()


def scenario_k(env, pw, browser, user):
    ctx, p = open_ctx(pw, browser, env, user, tag="-k")
    try:
        h.nav(p, "Waiting For")
        r = p.locator(".task-row").filter(has_text=K_TITLE).first
        r.wait_for(state="visible", timeout=15000)
        r.locator(".dash-focus-btn").click()
        p.wait_for_timeout(800)
        h.nav(p, "Fokus Hari Ini")
        p.locator(".focus-pomo").first.wait_for(state="visible", timeout=20000)
        p.locator(".focus-filter").first.wait_for(state="visible", timeout=20000)
        p.wait_for_timeout(500)
        t = get_task(env, "T1")
        e = expect(env, F(), focus_key="T1")
        u, ok = check_list("k1 Mulai Fokus P3 Waiting tanpa deadline dari halaman Tasks → ada di Target, tidak di kelompok; daftar = harapan",
                           p, e, extra=K_TITLE in ui(p)["target"] and ui(p)["target"][0] == K_TITLE
                           and not any(K_TITLE in g["titles"] for g in ui(p)["groups"]))
        check("k2 task itu memang di luar cakupan (P3, tanpa deadline, Waiting, Q4) — masuk hanya karena aktif",
              t["priority"] == "P3" and not t.get("deadline") and t["gtd_status"] == "waiting"
              and t["quadrant"] != "Q1" and not t.get("is_focused"), repr({k: t.get(k) for k in ("priority", "deadline", "gtd_status", "quadrant", "is_focused")}))
        check("k3 status default Next tidak menyembunyikannya; pil status tidak ada; catatan tersembunyi tidak menghitungnya",
              ui(p)["pills"] == [] and (ui(p)["note"] or "").startswith("%d task berstatus lain" % e["hidden"])
              and p.locator(".focus-target .ftask.is-focusing").count() == 1)
        h.shot(p, "target_active_light_desktop.png")
    finally:
        ctx.close()


def hscroll_check(step, p):
    w = no_hscroll(p)
    check(step, w[0] <= w[1], "scrollWidth=%d innerWidth=%d" % (w[0], w[1]))


def five_pills(p):
    open_sheet(p)
    sheet_chip(p, "Waiting", "Status").click()
    sheet_chip(p, PROJ_LONG, "Workspace").click()
    sheet_chip(p, "P4", "Prioritas").click()
    sheet_chip(p, "Q2", "Kuadran").click()
    sheet_chip(p, "Q4", "Kuadran").click()


def scenario_l(env, pw, browser, user, kind, theme="light"):
    ctx, p = open_ctx(pw, browser, env, user, kind=kind, theme=theme, tag="-l")
    tag = "412" if kind == "pixel7" else "375"
    try:
        go_focus(p)
        vp = p.evaluate("[innerWidth, innerHeight]")
        hscroll_check("l1 %s px (%s) daftar default tanpa scroll horizontal" % (tag, kind), p)
        long_group = p.locator(".focus-group").filter(has=p.locator(".focus-group-name", has_text=PROJ_LONG)).locator(".focus-group-head")
        box = long_group.bounding_box()
        check("l2 judul kelompok dengan workspace + project ±40 karakter terpotong elipsis di dalam viewport",
              box["x"] >= 0 and box["x"] + box["width"] <= vp[0] + 0.5
              and p.evaluate("""() => { const el = document.querySelector('.focus-group-name'); return getComputedStyle(el).textOverflow; }""") == "ellipsis",
              "kotak=%r" % box)
        before_ov = p.evaluate("getComputedStyle(document.body).overflow")
        open_sheet(p)
        sheet = p.locator(".focus-filter-sheet")
        sb = sheet.bounding_box()
        check("l3 lembar bawah menempel di bawah layar, maks 86vh, latar redup tampil",
              abs(sb["y"] + sb["height"] - vp[1]) <= 1.5 and sb["height"] <= vp[1] * 0.86 + 1.5
              and p.evaluate("getComputedStyle(document.querySelector('.focus-filter-sheet')).position") == "fixed"
              and p.locator(".focus-filter-backdrop").is_visible(), "kotak=%r viewport=%r" % (sb, vp))
        hscroll_check("l3b %s px lembar terbuka tanpa scroll horizontal" % tag, p)
        locked = p.evaluate("getComputedStyle(document.body).overflow")
        y0 = p.evaluate("window.scrollY")
        p.mouse.move(vp[0] / 2, 40)
        p.mouse.wheel(0, 600)
        p.wait_for_timeout(300)
        check("l4 body tidak bisa digulir selama lembar terbuka (overflow=hidden, scrollY tetap) dan dipulihkan setelah ditutup",
              locked == "hidden" and p.evaluate("window.scrollY") == y0, "overflow=%r scrollY %r→%r" % (locked, y0, p.evaluate("window.scrollY")))
        p.locator(".focus-filter-sheet").wait_for(state="visible")
        p.keyboard.press("Escape")
        p.locator(".focus-filter-sheet").wait_for(state="detached", timeout=3000)
        check("l4b setelah ditutup overflow body dipulihkan", p.evaluate("getComputedStyle(document.body).overflow") == before_ov,
              "sebelum=%r sesudah=%r" % (before_ov, p.evaluate("getComputedStyle(document.body).overflow")))
        y1 = p.evaluate("window.scrollY")
        p.mouse.move(vp[0] / 2, 40)
        p.mouse.wheel(0, -300)
        p.wait_for_timeout(400)
        check("l4c kontrol: tanpa lembar, roda yang sama menggulir halaman (jadi l4 bukan kebetulan)",
              p.evaluate("window.scrollY") != y1, "scrollY %r→%r" % (y1, p.evaluate("window.scrollY")))
        five_pills(p)
        hscroll_check("l5 %s px lembar terbuka dengan lima pilihan tanpa scroll horizontal" % tag, p)
        close_sheet_go(p)
        u = ui(p)
        check("l6 lima pil aktif: Status, project panjang, P4, Q2, Q4; badge '5'",
              u["pills"] == ["Status: Next, Waiting", WS_NAME + " · " + PROJ_LONG, "P4", "Q2", "Q4"] and u["badge"] == "5",
              "pil=%r badge=%r" % (u["pills"], u["badge"]))
        hscroll_check("l7 %s px dengan lima pil aktif tanpa scroll horizontal" % tag, p)
        row_geo = p.evaluate("""() => { const r = document.querySelector('.focus-filter-chips'); const b = r.getBoundingClientRect();
            return { right: b.right, sw: r.scrollWidth, cw: r.clientWidth, ox: getComputedStyle(r).overflowX }; }""")
        check("l8 baris chip bergeser di dalam dirinya sendiri (overflow-x, tidak melebarkan halaman)",
              row_geo["right"] <= vp[0] + 0.5 and row_geo["sw"] > row_geo["cw"] and row_geo["ox"] in ("auto", "scroll"), repr(row_geo))
        check("l9 pesan kosong tampil untuk kombinasi pil (tidak ada task cocok)",
              (ui(p)["empty"] or "").startswith("Tidak ada task yang cocok dengan filter ini."))
        if theme == "light" and kind == "375":
            h.shot(p, "pills_empty_light_375.png")
        return ctx, p
    except Exception:
        ctx.close()
        raise


def shots_set(env, pw, browser, user, kind, theme, tag):
    """Daftar default, lembar terbuka, pil aktif, pesan kosong; satu konteks per tema/lebar."""
    ctx, p = open_ctx(pw, browser, env, user, kind=kind, theme=theme, tag="-shot")
    try:
        go_focus(p)
        p.evaluate("() => { localStorage.removeItem('tf_focus_filter'); localStorage.removeItem('tf_focus_collapsed'); }")
        p.reload()
        p.locator(".sidebar-link, .sidebar-rail-btn, .mobile-topbar").first.wait_for(state="attached", timeout=20000)
        go_focus(p)
        scroll_list(p)
        h.shot(p, "default_%s_%s.png" % (theme, tag))
        open_sheet(p)
        h.shot(p, "sheet_%s_%s.png" % (theme, tag))
        sheet_chip(p, "Waiting", "Status").click()
        sheet_chip(p, PROJ_Q4, "Workspace").click()
        close_sheet_go(p)
        u = ui(p)
        check("s %s %s: pil aktif (status + project) dan daftar tidak kosong" % (theme, tag),
              len(u["pills"]) == 2 and u["empty"] is None and u["badge"] == "2", repr(u["pills"]))
        scroll_list(p)
        h.shot(p, "pills_%s_%s.png" % (theme, tag))
        open_sheet(p)
        sheet_chip(p, "P4", "Prioritas").click()
        close_sheet_go(p)
        u = ui(p)
        check("s %s %s: pesan kosong 'Tidak ada task yang cocok dengan filter ini.' + 'Reset filter'" % (theme, tag),
              (u["empty"] or "").startswith("Tidak ada task yang cocok dengan filter ini.")
              and p.locator(".focus-filter-empty .focus-filter-link").inner_text() == "Reset filter", repr(u["empty"]))
        scroll_list(p)
        h.shot(p, "empty_%s_%s.png" % (theme, tag))
        if kind == "375":
            hscroll_check("s %s %s: tanpa scroll horizontal" % (theme, tag), p)
    finally:
        ctx.close()


def scenario_m(env, pw, browser):
    # Pengguna utama: badge sidebar = jumlah cakupan harapan (tanggal lokal), termasuk deadline hari ini non-Q1
    ctx, p = open_ctx(pw, browser, env, env.user, tag="-m")
    try:
        tasks = all_tasks(env)
        exp_n = len([t for t in tasks if in_scope(t, today_iso())])
        non_q1_today = [t for t in tasks if bucket(t, today_iso()) == "today" and t.get("quadrant") != "Q1" and t["gtd_status"] not in ("done", "archived")]
        wait_until(lambda: sidebar_badge(p)[0] == exp_n, timeout=15)
        badge, text = sidebar_badge(p)
        check("m1 badge sidebar Fokus = jumlah cakupan harapan; ada task deadline hari ini yang bukan Q1 di datanya",
              badge == exp_n and len(non_q1_today) > 0,
              "badge=%r harapan=%d, non-Q1 hari ini=%d" % (text, exp_n, len(non_q1_today)))
        h.nav(p, "Fokus Hari Ini")
        p.locator(".focus-filter").first.wait_for(state="visible", timeout=20000)
        sm = re.match(r"(\d+) tugas", ui(p)["summary"])
        check("m2 header halaman Fokus 'N tugas' = badge sidebar = cakupan harapan",
              sm and int(sm.group(1)) == exp_n, "ringkasan=%r" % ui(p)["summary"])
    finally:
        ctx.close()
    # Dataset kecil: satu P1 hari ini (Q1) + satu P3 hari ini (Q3, non-Q1) + satu P3 tanpa deadline (di luar cakupan)
    userb = h.register(env.base, "gita")
    ids = {}
    for key, title, pri, off in (("B1", "Siapkan slide rapat pagi", "P1", 0), ("B2", "Beli tinta printer", "P3", 0),
                                 ("B3", "Rapikan arsip lama", "P3", None)):
        body = {"title": title, "priority": pri, "gtd_status": "next"}
        if off is not None:
            body["deadline"] = day(off)
        ids[key] = api(env.base, userb, "POST", "/api/tasks", json=body)[1]["id"]
    tb = all_tasks(env, userb)
    qb = {t["title"]: t["quadrant"] for t in tb}
    ctx, p = open_ctx(pw, browser, env, userb, tag="-m2")
    try:
        wait_until(lambda: sidebar_badge(p)[0] == 2, timeout=15)
        badge, text = sidebar_badge(p)
        check("m3 pengguna kedua: badge sidebar '2' (Q1 + deadline hari ini yang bukan Q1; Q4 tanpa deadline tidak dihitung)",
              badge == 2 and qb["Beli tinta printer"] != "Q1" and qb["Rapikan arsip lama"] != "Q1",
              "badge=%r quadrant=%r" % (text, qb))
        card = p.locator(".dash-prio-card")
        card.wait_for(state="visible", timeout=15000)
        wait_until(lambda: "Beli tinta printer" in card.inner_text(), timeout=10)
        titles = card.locator(".dash-row-title").all_inner_texts()
        check("m4 kartu Prioritas dashboard memuat task deadline hari ini yang bukan Q1 dan tidak memuat task di luar cakupan",
              "Beli tinta printer" in titles and "Siapkan slide rapat pagi" in titles and "Rapikan arsip lama" not in titles
              and "0 dari 2 selesai" in card.inner_text(), "baris=%r teks=%r" % (titles, card.inner_text()[:120]))
        h.nav(p, "Fokus Hari Ini")
        p.locator(".focus-filter").first.wait_for(state="visible", timeout=20000)
        eb = exp_view(tb, env.ws_names, F())
        check("m5 halaman Fokus pengguna kedua memuat kedua task (daftar = harapan)", sorted(ui(p)["groups"][0]["titles"]) == sorted(eb["titles"])
              and sorted(eb["titles"]) == ["Beli tinta printer", "Siapkan slide rapat pagi"], repr(ui(p)["groups"]))
    finally:
        ctx.close()


# ── main ───────────────────────────────────────────────────────────────────────────────────────
def seed(env):
    env.user = h.register(env.base, "fina")
    env.list_id = api(env.base, env.user, "POST", "/api/lists", json={"name": WS_NAME}, ok_codes=(200, 201))[1]["id"]
    env.ws_names = {str(env.list_id): WS_NAME}
    env.ids = {}
    for key, title, pri, off, status, proj, ws in TASKS:
        body = {"title": title, "priority": pri, "gtd_status": status, "project": proj}
        if off is not None:
            body["deadline"] = day(off)
        if ws:
            body["list_id"] = env.list_id
        env.ids[key] = api(env.base, env.user, "POST", "/api/tasks", json=body)[1]["id"]
    api(env.base, env.user, "POST", "/api/tasks/%d/focus" % env.ids["R2"])
    tasks = all_tasks(env)
    by = {t["id"]: t for t in tasks}
    q = {k: by[i]["quadrant"] for k, i in env.ids.items() if i in by}
    ok = (len(tasks) == len(TASKS) and by[env.ids["R2"]]["is_focused"] and q["A5"] == "Q2" and q["N2"] == "Q4"
          and q["T1"] == "Q4" and q["A1"] == "Q1" and q["A4"] == "Q3" and q["F1"] == "Q1"
          and by[env.ids["K1"]]["list_id"] == env.list_id and by[env.ids["K1"]]["project"] == PROJ_Q4)
    check("0 seed: %d task (2 project pribadi + tanpa project, workspace dengan 2 project, 1 ⭐), quadrant dari server" % len(tasks),
          ok, repr({k: q.get(k) for k in ("A1", "A4", "A5", "F1", "N2", "T1")}))


def main():
    os.makedirs(SHOTS, exist_ok=True)
    for f in os.listdir(SHOTS):
        if f.endswith(".png"):
            os.remove(os.path.join(SHOTS, f))
    tmp = tempfile.mkdtemp(prefix="e2e_focus_filter_")
    proc, base = h.start_server(tmp)
    print("server", base, flush=True)
    env = Env()
    env.base = base
    try:
        seed(env)
        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            ctx, p = open_ctx(pw, browser, env, env.user, tag="-main")
            try:
                scenario_a(env, p)
                scenario_b(env, p)
                scenario_c(env, p)
                scenario_d(env, p)
                scenario_e(env, p)
                scenario_f(env, p)
                scenario_g(env, p)
                scenario_h(env, p)
            finally:
                ctx.close()
            ctx, p = open_ctx(pw, browser, env, env.user, tag="-i")
            try:
                scenario_i(env, p)
            finally:
                ctx.close()
            scenario_j(env, pw, browser, env.user)
            scenario_k(env, pw, browser, env.user)
            for kind in ("375", "pixel7"):
                ctx, p = scenario_l(env, pw, browser, env.user, kind)
                ctx.close()
            for theme, kind, tag in (("light", "desktop", "desktop"), ("dark", "desktop", "desktop"),
                                     ("light", "375", "375"), ("dark", "375", "375")):
                shots_set(env, pw, browser, env.user, kind, theme, tag)
            scenario_m(env, pw, browser)
            browser.close()
    except Exception as e:
        import traceback
        traceback.print_exc()
        check("exception", False, "%s: %s" % (type(e).__name__, e))
    finally:
        proc.terminate()
        try:
            proc.wait(10)
        except Exception:
            proc.kill()
        shutil.rmtree(tmp, ignore_errors=True)
    check("n tanpa pageerror atau console.error sepanjang skenario (semua konteks)", ERRS == [],
          (repr(ERRS[:4])[:500]) if ERRS else "sumber eksternal ditolak proxy sandbox (diabaikan): %s" % sorted(EXTERNAL)[:4])
    failed = [r for r in h.results if not r[1]]
    print("\n%d langkah, %d gagal" % (len(h.results), len(failed)))
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
