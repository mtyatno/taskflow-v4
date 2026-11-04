"""E2E PR 1c-0 (sinkron "ext saja" dua anggota, kontrol bug lama, setMany satu render, entitas record baru tanpa
restart). Rencana docs/superpowers/plans/2026-11-01-plugin-fase1-pr-1c-0.md Task 8. Tidak dijalankan CI.

    TZ=Asia/Jakarta python3 temporary_files/e2e_plugin_fase1_1c0.py
    E2E_ONLY=1,2,3 TZ=Asia/Jakarta python3 temporary_files/e2e_plugin_fase1_1c0.py   # sebagian (8 dan 9 mandiri)

Server uvicorn lokal (`webapp:app` apa adanya, Timeline produksi) + DB sementara + Chromium; tiap "perangkat" = satu
`browser.new_context` (`service_workers="block"`, IndexedDB terpisah). Skenario 9 memakai server kedua dari
`temporary_files/e2e_app_demo_records.py` (indeks tmp, pola E2E 1a-2). "Data basi" = tarik task diblokir
(`ctx.route(/api/tasks?include_done=true → abort)`, push tetap jalan) atau `set_offline`. Kontrol kepekaan = modul
klien dari `git show f1569191^:<path>` lewat `route` (kode sebelum PR #123 = 1c-0; dipatok karena origin/main
sudah memuat 1c-0 sejak merge — kontrol `origin/main` tidak lagi menyajikan kode lama).

U1 "sx1" (perangkat A, pemilik workspace W "Ruang Rilis"), U2 "sx2" (anggota W; perangkat B, B', Q/P, H, M).
Timeline ON untuk keduanya lewat `PUT /api/plugins/state/timeline`. T1–T4 di W project "Rilis", jadwal lewat
`PUT ext_patch`. Semua PUT task dicatat per perangkat (`page.on("request")` + `post_data_json`).

   1 push tanpa pull: B basi (tarik diblokir), A ubah judul T1 (UI detail) → B seret T1 +2 hari → tepat 1 PUT B
     `{ext_patch}` → server judul A + start baru, notifikasi U1 tidak bertambah, IndexedDB B judul A sebelum unroute,
     setelah unroute + sinkron baris daftar B judul A.
   2 sinkron pull→push: B offline seret T2 −1 hari; A ubah judul + selesai + progress 40 → B online → server inti A +
     ext B, B menampilkan judul A + selesai, satu PUT B `{ext_patch}`.
   3 kontrol: B' dengan syncpush.js pra-#123 → ulangi 1 pada T3 → judul tertimpa (bug lama terreproduksi).
   4 regresi edit inti: judul (detail), selesai lagi (checkbox), progress (detail) → PUT penuh FULL_KEYS.
   5 inti + ext sebelum push (offline): ext→inti (T1), inti→ext (T2) → satu PUT penuh berisi ext_patch per task.
   6 hapus tag: T3 "#rapat" → offline seret + hapus chip → PUT penuh, tag server hilang.
   7 tab lama (taskrepo+syncpush pra-#123) + tab baru, IndexedDB sama → PUT penuh dengan judul tab lama.
   8 setMany 200 item (K24): jumlah commit React (hook DevTools palsu), waktu; kontrol plugin-runtime pra-#123;
     item ke-5 tak ada → applied 4, daftar konsisten; Urungkan Timeline (setMany 1 item) mengembalikan nilai.
   9 K26: entitas record baru di indeks → POST diterima tanpa restart (jendela ≤ 10 s); `nope` → INVALID entity.
  10 375 px: skenario 1 lewat Daftar HP + seksi Jadwal → PUT `{ext_patch}`; konsol tanpa error tak terduga.
"""
import datetime
import json
import os
import re
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import time

import requests
from playwright.sync_api import TimeoutError as PwTimeout, sync_playwright

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import e2e_hero_dashboard as hd  # noqa: E402

ROOT = hd.ROOT
SHOTS = os.path.join(ROOT, "temporary_files", "e2e_plugin_fase1_1c0")
PID = "timeline"
VIEW = "Timeline"
WS = "Ruang Rilis"
PROJ = "Rilis"
MASS = "Massal"
T1, T2, T3, T4 = "Rancang skema", "Tulis migrasi", "Uji integrasi", "Siapkan rilis"
TITLE_A1 = "Judul dari A"
TITLE_INPUT = 'input[aria-label="Judul task"]'
PULL_RE = re.compile(r"/api/tasks\?include_done=true")
FULL_KEYS = {"title", "description", "priority", "project", "context", "deadline", "gtd_status", "waiting_for",
             "assigned_to", "progress", "is_focused", "recurrence_type", "recurrence_days", "estimated_pomodoros"}
FULL_OPT = {"context_id", "project_id", "ext_patch"}
ONLY = set(x.strip() for x in os.environ.get("E2E_ONLY", "").split(",") if x.strip())


PRE_1C0 = "f1569191^"  # main tepat sebelum merge PR #123 (1c-0); kontrol kepekaan memakai kode ini


def old_src(path, ref=PRE_1C0):
    return subprocess.run(["git", "show", ref + ":" + path], cwd=ROOT, check=True, capture_output=True).stdout


OLD = {k: old_src(k) for k in ("static/offline/syncpush.js", "static/offline/taskrepo.js", "static/plugin-runtime.js")}

check = hd.check
console_log = []   # (perangkat, type, text)
puts = []          # (perangkat, task_id, body, t)
perf = {}


def info(label, value):
    perf[label] = value
    print("INFO %s: %s" % (label, value), flush=True)


def want(n):
    return not ONLY or str(n) in ONLY


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


def start_of(base, user, tid):
    return ext_of(base, user, tid).get(PID + ".start")


CORE = ("title", "priority", "deadline", "gtd_status", "progress", "project", "description", "estimated_pomodoros")


def core_of(base, user, tid):
    t = server_task(base, user, tid)
    return {k: t.get(k) for k in CORE}


def upd_notifs(base, user, title=None):
    rows = hd.api(base, user, "GET", "/api/notifications")
    return len([n for n in rows if "memperbarui task" in (n.get("message") or "")
                and (title is None or title in (n.get("message") or ""))])


def server_tags(base, user, tid):
    r = hd.api(base, user, "GET", "/api/tasks/%s/tags" % tid)
    return sorted((x.get("name") if isinstance(x, dict) else x) for x in (r or []))


PUMP = []  # halaman hidup: Playwright sync memproses event (request, route) hanya selama ada panggilan Playwright


def nap(seconds):
    """Tidur sambil memompa event Playwright (time.sleep menahan handler route/request → request menggantung)."""
    for pg in reversed(PUMP):
        try:
            if not pg.is_closed():
                pg.wait_for_timeout(seconds * 1000)
                return
        except Exception:  # noqa: BLE001
            continue
    time.sleep(seconds)


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
        nap(interval)
    return last


def next_monday(today):
    return today + datetime.timedelta(days=(7 - today.weekday()) % 7 or 7) if today.weekday() else today


def shift(iso, delta):
    """Seret `delta` hari kalender lalu jepret ke hari kerja berikutnya (Sen–Jum; November tanpa libur)."""
    d = datetime.date.fromisoformat(iso) + datetime.timedelta(days=delta)
    while d.weekday() >= 5:
        d += datetime.timedelta(days=1)
    return d.isoformat()


# ── perangkat ─────────────────────────────────────────────────────────────────

INIT_JS = """(() => { window.__tlWrites = [];
  window.addEventListener('taskUpdated', (e) => { window.__tlWrites.push([e.detail && (e.detail.taskId || e.detail.taskIds), Date.now()]); });
})();"""

# Hook DevTools palsu: React produksi memanggil inject() saat dimuat lalu onCommitFiberRoot pada SETIAP commit.
HOOK_JS = """(() => { window.__commits = 0;
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = { supportsFiber: true, inject() { return 1; },
    onCommitFiberRoot() { window.__commits++; }, onCommitFiberUnmount() {}, checkDCE() {} };
})();"""


def shot(p, name, full=False):
    os.makedirs(SHOTS, exist_ok=True)
    p.screenshot(path=os.path.join(SHOTS, name), animations="disabled", caret="hide", full_page=full)


def prime_storage(p, user):
    p.evaluate("""([t, u, tours, sw]) => {
        localStorage.setItem('tf_token', t); localStorage.setItem('tf_user_id', String(u));
        for (const pg of tours) localStorage.setItem('tf_tour_' + pg, '1');
        localStorage.setItem('tf_whatsnew_seen', sw); localStorage.setItem('tf_theme', 'light');
        localStorage.setItem('tf_palette', 'default'); localStorage.setItem('tf_liveedit', '0');
        localStorage.setItem('tf_dismiss_onboarding', '1'); localStorage.setItem('tf_shortcut_hint', '1');
    }""", [user["token"], user["id"], hd.TOURS, hd.sw_version()])


def watch(p, label):
    p.on("dialog", lambda d: d.accept())
    p.on("console", lambda m: console_log.append((label, m.type, m.text)))
    p.on("pageerror", lambda e: console_log.append((label, "pageerror", str(e))))

    def on_req(r):
        m = re.search(r"/api/tasks/(\d+)(\?.*)?$", r.url)
        if r.method == "PUT" and m:
            try:
                body = r.post_data_json
            except Exception:  # noqa: BLE001
                body = None
            puts.append((label, int(m.group(1)), body, time.time()))
    p.on("request", on_req)


def serve_old(ctx_or_page, path, served=None):
    """Sajikan `path` (relatif repo, mis. static/offline/syncpush.js) dari PRE_1C0 (atau ref lain yang dimuat ke OLD) untuk konteks/halaman ini."""
    body = OLD[path]

    def handler(route):
        if served is not None:
            served.append(path)
        route.fulfill(status=200, content_type="application/javascript", body=body)
    ctx_or_page.route(re.compile(re.escape("/" + path) + r"(\?.*)?$"), handler)


def new_context(browser, base, viewport=None, mobile=False, hook=False):
    extra = {"is_mobile": True, "has_touch": True} if mobile else {}
    ctx = browser.new_context(service_workers="block", viewport=viewport or hd.DESKTOP, timezone_id="Asia/Jakarta",
                              reduced_motion="reduce", **extra)
    ctx.route(re.compile(r"^(?!%s/)" % re.escape(base)), lambda route: route.abort())
    if hook:
        ctx.add_init_script(HOOK_JS)
    ctx.add_init_script(INIT_JS)
    return ctx


def open_page(ctx, base, user, label, prime=True):
    p = ctx.new_page()
    PUMP.append(p)
    watch(p, label)
    if prime:
        p.goto(base + "/manifest.json")
        prime_storage(p, user)
    p.goto(base + "/")
    hd.wait_dashboard_ready(p)
    wait_sync(p)
    p.wait_for_function("pid => window.TF && window.TF.plugins && window.TF.plugins.isEnabled(pid)", arg=PID, timeout=20000)
    p.evaluate("() => { window.__e2eNoReload = 1; }")
    return p


def new_device(browser, base, user, label, old=(), **kw):
    ctx = new_context(browser, base, **kw)
    for path in old:
        serve_old(ctx, path)
    return ctx, open_page(ctx, base, user, label)


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
    p.wait_for_timeout(500)


def go_offline(ctx, p):
    ctx.set_offline(True)
    p.wait_for_function("() => navigator.onLine === false", timeout=5000)


def go_online(ctx, p):
    ctx.set_offline(False)
    p.wait_for_function("() => navigator.onLine === true", timeout=5000)
    p.wait_for_timeout(300)
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
        top.first.click()
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


def open_list(p, label, row_title):
    sidebar_click(p, label)
    nb = view_btn(p, "Normal")
    if nb.count() and nb.first.is_visible() and nb.first.get_attribute("aria-pressed") != "true":
        nb.first.click()
        p.wait_for_timeout(400)
    p.locator(".task-row", has_text=row_title).first.wait_for(state="visible", timeout=15000)


def open_modal(p, title):
    p.locator(".task-row", has_text=title).first.click()
    m = p.locator(".modal-content").first
    m.wait_for(state="visible", timeout=10000)
    wait_until(lambda: m.locator(TITLE_INPUT).first.input_value() == title, 8, 0.2)
    return m


def close_modal(p):
    p.locator(".modal-overlay").first.click(position={"x": 4, "y": 4})
    p.locator(".modal-overlay").first.wait_for(state="detached", timeout=8000)


def ui_set_title(p, page_label, old, new):
    """Detail task (modal): ganti judul + Enter, lalu tutup."""
    open_list(p, page_label, old)
    m = open_modal(p, old)
    inp = m.locator(TITLE_INPUT).first
    inp.click()
    inp.fill(new)
    inp.press("Enter")
    p.wait_for_timeout(300)
    close_modal(p)


def bar(p, tid):
    return p.locator(".plg-timeline-bar[data-key='%s']" % tid)


def mouse_drag(p, x, y, dx, steps=8):
    p.mouse.move(x, y)
    p.mouse.down()
    for i in range(1, steps + 1):
        p.mouse.move(x + dx * i / steps, y)
        p.wait_for_timeout(16)
    p.mouse.up()


def drag_bar(p, tid, days):
    """Seret bar `tid` sejauh `days` hari (zoom bawaan Minggu = 12 px/hari)."""
    b = bar(p, tid)
    b.wait_for(state="visible", timeout=10000)
    b.scroll_into_view_if_needed()
    bb = b.bounding_box()
    mouse_drag(p, bb["x"] + 6, bb["y"] + bb["height"] / 2, 12 * days)


def puts_for(label, tid, since):
    return [x[2] for x in puts if x[0] == label and x[1] == tid and x[3] >= since]


def wait_puts(label, tid, since, n=1, timeout=15, settle=2.0):
    """Tunggu ≥ n PUT lalu `settle` detik lagi (PUT tambahan ikut terhitung)."""
    wait_until(lambda: len(puts_for(label, tid, since)) >= n, timeout, 0.2)
    nap(settle)
    return puts_for(label, tid, since)


def is_full(body):
    keys = set(body or {})
    return FULL_KEYS <= keys and keys <= FULL_KEYS | FULL_OPT


def idb_task(p, sid):
    return p.evaluate("""async (sid) => {
        const db = await TF.db.openDB();
        const all = await new Promise((res, rej) => { const q = db.transaction('tasks', 'readonly').objectStore('tasks').getAll();
            q.onsuccess = () => res(q.result || []); q.onerror = () => rej(q.error); });
        const r = all.find(x => x.server_id === sid);
        if (!r) return null;
        return { title: r.title, gtd_status: r.gtd_status, progress: r.progress, dirty: r.dirty || 0, rev: r.rev,
                 extOnly: TF.taskext.extOnlyNow(r), start: (r.ext || {})['timeline.start'] || null };
    }""", sid)


def dispatch(p, method, path, body=None):
    return p.evaluate("""([m, u, b]) => window.TF.taskroutes.buildTaskRouter().dispatch(m, u, b)
        .then(() => 'ok', e => 'err:' + (e && e.message || e))""", [method, path, body])


# ── skenario 1–7 dan 10 (dua anggota workspace) ─────────────────────────────

def run_members(browser, base, users, ids, mon):
    u1, u2 = users["u1"], users["u2"]
    t1, t2, t3, t4 = ids["t1"], ids["t2"], ids["t3"], ids["t4"]
    ctxs = []
    try:
        ca, a = new_device(browser, base, u1, "A")
        ctxs.append(ca)
        cb, b = new_device(browser, base, u2, "B")
        ctxs.append(cb)

        # ── 1 push tanpa pull ──
        if want(1):
            sync_now(b)
            blocked = []
            abort_pull = lambda route: (blocked.append(route.request.url), route.abort())  # noqa: E731
            cb.route(PULL_RE, abort_pull)
            core0 = core_of(base, u1, t1)
            ui_set_title(a, WS, T1, TITLE_A1)
            ok_a = wait_until(lambda: server_task(base, u1, t1)["title"] == TITLE_A1, 15)
            check("1a A (UI detail) ganti judul T1 → server '%s'" % TITLE_A1, ok_a)
            sync_now(b)  # tarik diblokir, push tetap jalan
            pre = idb_task(b, t1)
            check("1b prasyarat data basi: tarik B diblokir (%d request di-abort), IndexedDB B judul lama '%s'"
                  % (len(blocked), T1), blocked and pre and pre["title"] == T1, repr(pre))
            n_u1 = upd_notifs(base, u1)
            s_old = start_of(base, u1, t1)
            open_timeline(b, WS)
            s0 = time.time()
            drag_bar(b, t1, 2)
            body = wait_puts("B", t1, s0, settle=2.5)
            want_start = shift(s_old, 2)
            info("1 isi PUT B (seret T1)", body)
            check("1c B seret T1 +2 hari → tepat SATU PUT, body persis {ext_patch} = {timeline.start: %s}" % want_start,
                  len(body) == 1 and set(body[0] or {}) == {"ext_patch"}
                  and body[0]["ext_patch"] == {PID + ".start": want_start}, repr(body))
            srv = server_task(base, u1, t1)
            core1 = core_of(base, u1, t1)
            check("1d server: judul '%s' (A) TIDAK tertimpa, timeline.start %s (geser 2 hari kerja), field inti lain sama"
                  % (TITLE_A1, want_start), srv["title"] == TITLE_A1 and start_of(base, u1, t1) == want_start
                  and {k: v for k, v in core1.items() if k != "title"} == {k: v for k, v in core0.items() if k != "title"},
                  repr((srv["title"], start_of(base, u1, t1), core0, core1)))
            nap(1.0)
            check("1e notifikasi U1 'memperbarui task' tidak bertambah", upd_notifs(base, u1) == n_u1,
                  "%d→%d" % (n_u1, upd_notifs(base, u1)))
            post = idb_task(b, t1)
            check("1f IndexedDB B (tarik masih diblokir): judul '%s' diadopsi dari respons PUT, bersih, start %s"
                  % (TITLE_A1, want_start), post and post["title"] == TITLE_A1 and post["dirty"] == 0
                  and post["start"] == want_start, repr(post))
            shot(b, "1-B-seret-ext-saja.png")
            cb.unroute(PULL_RE, abort_pull)
            sync_now(b)
            refresh_tasks(b)
            try:
                open_list(b, WS, TITLE_A1)
                row_ok = True
            except PwTimeout:
                row_ok = False
            check("1g unroute + sinkron → baris T1 di daftar B '%s'" % TITLE_A1,
                  row_ok and b.locator(".task-row", has_text=T1).count() == 0)
            shot(b, "1-B-daftar-judul-A.png")

        # ── 2 sinkron pull → push ──
        if want(2):
            title2 = "Migrasi versi A"
            open_timeline(b, WS)
            s_old = start_of(base, u1, t2)
            go_offline(cb, b)
            drag_bar(b, t2, -1)
            b.wait_for_timeout(1500)
            want_start = shift(s_old, -1)
            loc = idb_task(b, t2)
            check("2a B offline seret T2 −1 hari → lokal start %s (penanda ext saja sah), server belum berubah"
                  % want_start, loc and loc["start"] == want_start and loc["extOnly"] and start_of(base, u1, t2) == s_old,
                  repr(loc))
            r = [dispatch(a, "PUT", "/api/tasks/%d" % t2, {"title": title2}), dispatch(a, "POST", "/api/tasks/%d/done" % t2),
                 dispatch(a, "PUT", "/api/tasks/%d" % t2, {"progress": 40})]
            sync_now(a)
            ok_a = wait_until(lambda: (lambda t: t["title"] == title2 and t["gtd_status"] == "done" and t["progress"] == 40)(
                server_task(base, u1, t2)), 15)
            check("2b A (klien, rute lokal + sinkron): judul '%s' + selesai + progress 40 di server" % title2,
                  r == ["ok"] * 3 and ok_a, repr(r))
            s0 = time.time()
            go_online(cb, b)
            sync_now(b)
            body = wait_puts("B", t2, s0, settle=2.0)
            info("2 isi PUT B setelah online", body)
            srv = server_task(base, u1, t2)
            check("2c server: judul/status/progress A + timeline.start %s (B)" % want_start,
                  srv["title"] == title2 and srv["gtd_status"] == "done" and srv["progress"] == 40
                  and start_of(base, u1, t2) == want_start, repr({k: srv.get(k) for k in ("title", "gtd_status", "progress", "ext")}))
            check("2d satu PUT B untuk T2, body persis {ext_patch}", len(body) == 1 and set(body[0] or {}) == {"ext_patch"}
                  and body[0]["ext_patch"] == {PID + ".start": want_start}, repr(body))
            loc = idb_task(b, t2)
            refresh_tasks(b)
            sidebar_click(b, "Done")
            try:
                b.locator(".task-row", has_text=title2).first.wait_for(state="visible", timeout=10000)
                done_row = b.locator(".task-row", has_text=title2).first.locator(".check-icon").count() == 1
            except PwTimeout:
                done_row = False
            check("2e B menampilkan judul A dan status selesai (IndexedDB + baris di halaman Done bertanda ✓)",
                  loc and loc["title"] == title2 and loc["gtd_status"] == "done" and loc["dirty"] == 0 and done_row,
                  repr((loc, done_row)))
            shot(b, "2-B-done-judul-A.png")

        # ── 3 kontrol kepekaan: syncpush.js pra-#123 ──
        if want(3):
            title3 = "Uji versi A"
            served = []
            cc = new_context(browser, base)
            ctxs.append(cc)
            serve_old(cc, "static/offline/syncpush.js", served)
            c = open_page(cc, base, u2, "B'")
            sync_now(c)
            stale = server_task(base, u1, t3)["title"]
            blocked = []
            cc.route(PULL_RE, lambda route: (blocked.append(1), route.abort()))
            ui_set_title(a, WS, stale, title3)
            wait_until(lambda: server_task(base, u1, t3)["title"] == title3, 15)
            open_timeline(c, WS)
            s0 = time.time()
            drag_bar(c, t3, 2)
            body = wait_puts("B'", t3, s0, settle=2.5)
            srv_title = server_task(base, u1, t3)["title"]
            shot(c, "3-Bp-kontrol-origin-main.png")
            info("3 isi PUT B' (kode pra-#123)", [{k: (b_ or {}).get(k) for k in ("title", "ext_patch")} for b_ in body])
            reproduced = srv_title == stale and any(is_full(b_) and b_.get("title") == stale for b_ in body)
            check("3a KONTROL syncpush.js pra-#123 (%d kali disajikan): B' basi seret T3 → PUT penuh membawa judul basi "
                  "'%s' → judul A '%s' TERTIMPA (bug lama terreproduksi)" % (len(served), stale, title3),
                  served and reproduced, "server=%r body=%r" % (srv_title, body))
            if reproduced:
                print("INFO 3: bug lama terreproduksi — kode pra-#123 menimpa judul A dengan salinan basi B'", flush=True)
            hd.api(base, u1, "PUT", "/api/tasks/%d" % t3, json={"title": title3})
            check("3b judul T3 dikembalikan lewat API", server_task(base, u1, t3)["title"] == title3)
            cc.close()
            ctxs.remove(cc)

        # ── 4 regresi edit inti normal ──
        if want(4):
            sync_now(b)
            refresh_tasks(b)
            cur1 = server_task(base, u1, t1)["title"]
            new1 = "Skema versi B"
            s0 = time.time()
            ui_set_title(b, WS, cur1, new1)
            body = wait_puts("B", t1, s0)
            check("4a B ganti judul T1 di detail → PUT penuh (FULL_KEYS%s) dengan title '%s', server sama"
                  % (" + context_id/project_id" if body and set(body[-1]) - FULL_KEYS else "", new1),
                  len(body) == 1 and is_full(body[0]) and body[0]["title"] == new1 and "ext_patch" not in body[0]
                  and wait_until(lambda: server_task(base, u1, t1)["title"] == new1, 10), repr(body))
            title2 = server_task(base, u1, t2)["title"]
            if server_task(base, u1, t2)["gtd_status"] != "done":  # dijalankan tanpa skenario 2 → siapkan T2 selesai
                dispatch(b, "POST", "/api/tasks/%d/done" % t2)
                sync_now(b)
                wait_until(lambda: server_task(base, u1, t2)["gtd_status"] == "done", 15)
                nap(1.0)
            s0 = time.time()
            r = dispatch(b, "PUT", "/api/tasks/%d" % t2, {"gtd_status": "next"})
            sync_now(b)  # rute lokal langsung tidak menjadwalkan push (pembungkus api host yang melakukannya)
            b_open = wait_puts("B", t2, s0)
            refresh_tasks(b)
            open_list(b, WS, title2)
            s1 = time.time()
            b.locator(".task-row", has_text=title2).first.locator(".check-btn").click()
            b_done = wait_puts("B", t2, s1)
            check("4b B: T2 belum selesai (rute lokal) lalu selesai (checkbox baris) → dua PUT penuh dengan gtd_status "
                  "next → done", r == "ok" and len(b_open) == 1 and is_full(b_open[0]) and b_open[0]["gtd_status"] == "next"
                  and len(b_done) == 1 and is_full(b_done[0]) and b_done[0]["gtd_status"] == "done"
                  and wait_until(lambda: server_task(base, u1, t2)["gtd_status"] == "done", 10),
                  repr((b_open, b_done)))
            cur3 = server_task(base, u1, t3)["title"]
            open_list(b, WS, cur3)
            open_modal(b, cur3)
            s0 = time.time()
            b.locator(".modal-content .td-pill").first.click()
            b.locator(".td-pop button", has_text=re.compile(r"^75%$")).first.click()
            b.keyboard.press("Escape")
            b.wait_for_timeout(300)
            close_modal(b)
            body = wait_puts("B", t3, s0)
            check("4c B ubah progress T3 di detail (preset 75%) → PUT penuh dengan progress 75, server 75",
                  len(body) == 1 and is_full(body[0]) and body[0]["progress"] == 75
                  and wait_until(lambda: server_task(base, u1, t3)["progress"] == 75, 10), repr(body))

        # ── 5 inti + ext sebelum push ──
        if want(5):
            sync_now(b)
            refresh_tasks(b)
            open_timeline(b, WS)
            st1, st2 = start_of(base, u1, t1), start_of(base, u1, t2)
            go_offline(cb, b)
            drag_bar(b, t1, 2)
            b.wait_for_timeout(1200)
            r1 = dispatch(b, "PUT", "/api/tasks/%d" % t1, {"title": "Skema offline B"})
            r2 = dispatch(b, "PUT", "/api/tasks/%d" % t2, {"title": "Migrasi offline B"})
            refresh_tasks(b)
            drag_bar(b, t2, 2)
            b.wait_for_timeout(1200)
            l1, l2 = idb_task(b, t1), idb_task(b, t2)
            check("5a offline: T1 seret→judul, T2 judul→seret → penanda ext saja TIDAK sah di keduanya",
                  r1 == r2 == "ok" and l1 and l2 and not l1["extOnly"] and not l2["extOnly"] and l1["dirty"] and l2["dirty"],
                  repr((l1, l2)))
            s0 = time.time()
            go_online(cb, b)
            sync_now(b)
            b1, b2 = wait_puts("B", t1, s0, settle=0.5), wait_puts("B", t2, s0, settle=2.0)
            w1, w2 = shift(st1, 2), shift(st2, 2)
            v1, v2 = server_task(base, u1, t1), server_task(base, u1, t2)
            check("5b server memuat keduanya: T1 'Skema offline B' + start %s, T2 'Migrasi offline B' + start %s" % (w1, w2),
                  v1["title"] == "Skema offline B" and start_of(base, u1, t1) == w1
                  and v2["title"] == "Migrasi offline B" and start_of(base, u1, t2) == w2,
                  repr((v1["title"], start_of(base, u1, t1), v2["title"], start_of(base, u1, t2))))
            check("5c tiap task tepat satu PUT penuh berisi ext_patch",
                  len(b1) == 1 and len(b2) == 1 and all(is_full(x) and x.get("ext_patch") for x in b1 + b2),
                  repr((b1, b2)))

        # ── 6 hapus tag ──
        if want(6):
            sync_now(b)
            refresh_tasks(b)
            cur3 = server_task(base, u1, t3)["title"]
            s0 = time.time()
            ui_set_title(b, WS, cur3, cur3 + " #rapat")
            wait_puts("B", t3, s0, settle=1.0)
            ok_tag = wait_until(lambda: "rapat" in server_tags(base, u2, t3), 10)
            check("6a B judul T3 '… #rapat' → sinkron, server punya tag rapat (U2)", ok_tag, repr(server_tags(base, u2, t3)))
            sync_now(b)
            refresh_tasks(b)
            st3 = start_of(base, u1, t3)
            open_timeline(b, WS)
            go_offline(cb, b)
            drag_bar(b, t3, 2)
            b.wait_for_timeout(1200)
            mark1 = idb_task(b, t3)
            open_list(b, WS, cur3)
            m = open_modal(b, cur3)
            chip = m.locator("button[aria-label='Hapus tag rapat']")
            chip.wait_for(state="visible", timeout=8000)
            chip.click()
            b.wait_for_timeout(600)
            gone_ui = m.locator("button[aria-label='Hapus tag rapat']").count() == 0
            close_modal(b)
            mark2 = idb_task(b, t3)
            s0 = time.time()
            go_online(cb, b)
            sync_now(b)
            body = wait_puts("B", t3, s0, settle=2.0)
            check("6b offline: seret T3 (penanda sah) lalu hapus chip 'rapat' (penanda batal)",
                  mark1 and mark1["extOnly"] and gone_ui and mark2 and not mark2["extOnly"] and mark2["dirty"],
                  repr((mark1, mark2, gone_ui)))
            check("6c online → PUT T3 penuh (bukan ext saja) berisi ext_patch; server tanpa tag rapat, start %s" % shift(st3, 2),
                  len(body) == 1 and is_full(body[0]) and body[0].get("ext_patch") and "#rapat" not in body[0]["title"]
                  and wait_until(lambda: "rapat" not in server_tags(base, u2, t3), 10) and start_of(base, u1, t3) == shift(st3, 2),
                  repr((body, server_tags(base, u2, t3))))

        # ── 7 tab lama + tab baru (IndexedDB sama) ──
        if want(7):
            cq = new_context(browser, base)
            ctxs.append(cq)
            q = open_page(cq, base, u2, "Q")
            sync_now(q)
            served = []
            pp = cq.new_page()
            watch(pp, "P")
            serve_old(pp, "static/offline/taskrepo.js", served)
            serve_old(pp, "static/offline/syncpush.js", served)
            pp.goto(base + "/")
            hd.wait_dashboard_ready(pp)
            wait_sync(pp)
            st1 = start_of(base, u1, t1)
            open_timeline(q, WS)
            go_offline(cq, q)
            drag_bar(q, t1, 2)
            q.wait_for_timeout(1200)
            mq = idb_task(q, t1)
            r = dispatch(pp, "PUT", "/api/tasks/%d" % t1, {"title": "Judul tab lama"})
            mp = idb_task(q, t1)
            check("7a Q (kode PR) offline seret T1 → penanda sah; P (taskrepo+syncpush pra-#123, %d modul) ubah judul → "
                  "penanda batal (rev naik)" % len(served),
                  len(served) == 2 and mq and mq["extOnly"] and r == "ok" and mp and not mp["extOnly"]
                  and mp["title"] == "Judul tab lama", repr((mq, r, mp)))
            pp.close()
            s0 = time.time()
            go_online(cq, q)
            sync_now(q)
            body = wait_puts("Q", t1, s0, settle=2.0)
            check("7b Q online + sinkron → PUT penuh berjudul 'Judul tab lama' + ext_patch; server judul P + start %s"
                  % shift(st1, 2), len(body) == 1 and is_full(body[0]) and body[0]["title"] == "Judul tab lama"
                  and body[0].get("ext_patch") and server_task(base, u1, t1)["title"] == "Judul tab lama"
                  and start_of(base, u1, t1) == shift(st1, 2), repr(body))
            cq.close()
            ctxs.remove(cq)

        # ── 10 375 px ──
        if want(10):
            title4 = "Rilis versi A"
            cm, mob = new_device(browser, base, u2, "M", viewport=hd.MOBILE, mobile=True)
            ctxs.append(cm)
            sync_now(mob)
            cm.route(PULL_RE, lambda route: route.abort())
            n_u1 = upd_notifs(base, u1)
            ui_set_title(a, WS, T4, title4)
            wait_until(lambda: server_task(base, u1, t4)["title"] == title4, 15)
            sync_now(mob)
            st4 = start_of(base, u1, t4)
            new4 = shift(st4, 2)
            open_timeline(mob, WS)
            mob.get_by_role("radio", name="Daftar").click()
            mob.locator(".plg-timeline-list").wait_for(state="visible", timeout=10000)
            mob.locator(".plg-timeline-li", has_text=T4).first.click()
            sec = mob.locator(".modal-content .plg-timeline-section:not([aria-busy='true'])")
            sec.wait_for(state="visible", timeout=15000)
            s0 = time.time()
            inp = sec.get_by_label("Mulai", exact=True)
            inp.fill(new4)
            inp.press("Tab")
            body = wait_puts("M", t4, s0, settle=2.5)
            shot(mob, "10-M-375-seksi-jadwal.png")
            close_modal(mob)
            check("10a 375 px (basi, tarik diblokir): Daftar HP → detail → seksi Jadwal Mulai %s → tepat 1 PUT {ext_patch}"
                  % new4, len(body) == 1 and set(body[0] or {}) == {"ext_patch"}
                  and body[0]["ext_patch"] == {PID + ".start": new4}, repr(body))
            nap(1.0)
            check("10b server: judul A '%s' tetap, start %s; notifikasi U1 tidak bertambah; IndexedDB M judul A"
                  % (title4, new4), server_task(base, u1, t4)["title"] == title4 and start_of(base, u1, t4) == new4
                  and upd_notifs(base, u1) == n_u1 and (idb_task(mob, t4) or {}).get("title") == title4,
                  repr((server_task(base, u1, t4)["title"], start_of(base, u1, t4), idb_task(mob, t4))))
            geo = mob.evaluate("() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]")
            check("10c 375 px tanpa geser horizontal halaman", geo[0] <= geo[1], repr(geo))
    finally:
        for cx in ctxs:
            try:
                cx.close()
            except Exception:  # noqa: BLE001
                pass


# ── 8 setMany (K24) ──────────────────────────────────────────────────────────

# Instrumen: commit di dalam unstable_batchedUpdates, dan commit selama refreshTasks (properti dibungkus getter/setter
# karena host memasang ulang window.__refreshTasks lewat efek).
INSTR_JS = """() => {
  if (window.__m) return;
  const m = window.__m = { batchCalls: 0, batchCommits: 0, refreshCalls: 0, refreshCommits: 0, pending: [] };
  const rd = window.ReactDOM, ob = rd.unstable_batchedUpdates;
  rd.unstable_batchedUpdates = function (f, a) { m.batchCalls++; const c0 = window.__commits;
    try { return ob.call(this, f, a); } finally { m.batchCommits += window.__commits - c0; } };
  let inner = window.__refreshTasks;
  const wrap = function () { m.refreshCalls++; const c0 = window.__commits; const r = inner && inner.apply(this, arguments);
    m.pending.push(Promise.resolve(r).catch(() => null).then(() => { m.refreshCommits += window.__commits - c0; })); return r; };
  Object.defineProperty(window, '__refreshTasks', { configurable: true, get: () => wrap, set: (v) => { inner = v; } });
}"""

# items: semua task project Massal urut judul, start +1 hari kalender; bad = indeks item yang diganti taskId tak ada.
SETMANY_JS = """async ([proj, bad]) => {
  const api = TF.api.for('timeline');
  const all = (await api.data.tasks.list({})).filter(t => t.project === proj).sort((a, b) => a.title < b.title ? -1 : 1);
  const iso = (s, d) => new Date(Date.parse(s + 'T00:00:00Z') + d * 864e5).toISOString().slice(0, 10);
  const items = []; const ids = all.map(t => t.id);
  for (const t of all) { if (items.length === bad) items.push({ taskId: 987654321, patch: { start: '2030-01-01' } });
    if (items.length >= 200) break; items.push({ taskId: t.id, patch: { start: iso(t.ext['timeline.start'], 1) } }); }
  const before = Object.fromEntries(all.map(t => [t.id, t.ext['timeline.start']]));
  const m = window.__m; m.batchCalls = m.batchCommits = m.refreshCalls = m.refreshCommits = 0; m.pending = [];
  window.__commits = 0;
  const t0 = performance.now(); let res = null, err = null;
  try { res = await api.taskExt.setMany(items); } catch (e) { err = e; }
  const ms = performance.now() - t0;
  const atResolve = window.__commits;
  await new Promise(r => setTimeout(r, 50));
  await Promise.all(m.pending);
  await new Promise(r => setTimeout(r, 400));
  return { n: items.length, ms: Math.round(ms), commitsAtResolve: atResolve, commits: window.__commits,
    batchCalls: m.batchCalls, batchCommits: m.batchCommits, refreshCalls: m.refreshCalls, refreshCommits: m.refreshCommits,
    rows: res ? res.length : null, err: err ? String(err.message || err) : null,
    applied: err && Array.isArray(err.applied) ? err.applied : null,
    items: items.map(it => [it.taskId, it.patch.start]), before };
}"""

STATE_JS = """() => { // state React host: context.tasks milik SlotView Timeline (pohon fiber terkini dari akar)
  const c = document.getElementById('root')._reactRootContainer; // React 18 legacy: FiberRoot (17: {_internalRoot})
  const fr = c && (c._internalRoot || c); let st = [fr && fr.current];
  while (st.length) { const n = st.pop(); if (!n) continue; const mp = n.memoizedProps;
    if (mp && mp.pluginId === 'timeline' && mp.name === 'taskList.views' && mp.context && Array.isArray(mp.context.tasks))
      return Object.fromEntries(mp.context.tasks.map(t => [t.id, (t.ext || {})['timeline.start'] || null]));
    if (n.sibling) st.push(n.sibling); if (n.child) st.push(n.child); }
  return null; }"""

LOCAL_JS = """async (proj) => Object.fromEntries((await TF.api.for('timeline').data.tasks.list({})).filter(t => t.project === proj)
  .map(t => [t.id, t.ext['timeline.start']]))"""


def measure_setmany(ctx, p, bad=-1):
    cdp = ctx.new_cdp_session(p)
    cdp.send("Emulation.setCPUThrottlingRate", {"rate": 4})
    try:
        return p.evaluate(SETMANY_JS, [MASS, bad])
    finally:
        cdp.send("Emulation.setCPUThrottlingRate", {"rate": 1})


def run_setmany(browser, base, u2):
    ctxs = []
    try:
        ch, h = new_device(browser, base, u2, "H", hook=True)
        ctxs.append(ch)
        hooked = h.evaluate("() => window.__commits")
        open_timeline(h, MASS)
        check("8a hook DevTools palsu terpasang (commit terhitung: %r); Timeline project Massal tampil" % hooked,
              isinstance(hooked, int) and hooked > 0 and h.locator(".plg-timeline-bar").count() > 0)
        h.evaluate(INSTR_JS)
        # Urungkan Timeline = setMany 1 item (online)
        first = h.evaluate("() => { const b = document.querySelector('.plg-timeline-bar'); return b && b.getAttribute('data-key'); }")
        tid = int(first)
        st0 = start_of(base, u2, tid)
        s0 = time.time()
        drag_bar(h, tid, 2)
        wait_puts("H", tid, s0, settle=1.0)
        moved = start_of(base, u2, tid)
        h.evaluate("() => { const m = window.__m; m.batchCalls = m.batchCommits = 0; }")
        s1 = time.time()
        h.get_by_role("button", name="Urungkan").first.click()
        undo_put = wait_puts("H", tid, s1, settle=1.5)
        mu = h.evaluate("() => ({ batchCalls: window.__m.batchCalls, batchCommits: window.__m.batchCommits })")
        info("8 Urungkan: batch unstable_batchedUpdates (panggilan, commit)", mu)
        check("8b Urungkan Timeline (setMany 1 item): optimistis satu batch satu commit, 1 PUT {ext_patch}, server kembali %s"
              % st0, moved == shift(st0, 2) and mu == {"batchCalls": 1, "batchCommits": 1} and len(undo_put) == 1
              and set(undo_put[0]) == {"ext_patch"} and wait_until(lambda: start_of(base, u2, tid) == st0, 10)
              and h.evaluate("(id) => document.querySelector(\".plg-timeline-bar[data-key='\" + id + \"']\") !== null", tid),
              repr((moved, mu, undo_put, start_of(base, u2, tid))))
        sync_now(h)
        # setMany 200 item, offline (tanpa sinkron di latar) + CPU 4×
        go_offline(ch, h)
        local0 = h.evaluate(LOCAL_JS, MASS)
        r = measure_setmany(ch, h)
        st = wait_until(lambda: h.evaluate(STATE_JS), 5, 0.3) or {}
        info("8 state React (context.tasks Timeline) terbaca: task", len(st))
        local1 = h.evaluate(LOCAL_JS, MASS)
        exp = {i: s for i, s in r["items"]}
        info("8 setMany 200 (PR, CPU 4×): ms sampai resolve", r["ms"])
        info("8 setMany 200 (PR): commit total / saat resolve / di batch (panggilan) / di refreshTasks (panggilan)",
             [r["commits"], r["commitsAtResolve"], r["batchCommits"], r["batchCalls"], r["refreshCommits"], r["refreshCalls"]])
        outside = r["commits"] - r["refreshCommits"]
        check("8c setMany 200 item: resolve 200 baris; optimistis SATU unstable_batchedUpdates = 1 commit; satu refreshTasks; "
              "commit di luar refreshTasks ≤ 2 (batch + toleransi 1)",
              r["rows"] == 200 and r["batchCalls"] == 1 and r["batchCommits"] == 1 and r["refreshCalls"] == 1 and outside <= 2,
              "commit total %d (refresh %d)" % (r["commits"], r["refreshCommits"]))
        check("8d setMany: IndexedDB dan state React memuat 200 nilai baru",
              all(local1.get(str(k), local1.get(k)) == v for k, v in exp.items())
              and all(st.get(str(k), st.get(k)) == v for k, v in exp.items()), "state %d task" % len(st))
        info("8 [catatan] commit total (≤ 3 di brief: batch + refreshTasks + 1) — refreshTasks = fetchAll host", r["commits"])
        # gagal di item ke-5
        r2 = measure_setmany(ch, h, bad=4)
        st2 = wait_until(lambda: (lambda s: s if s else None)(h.evaluate(STATE_JS)), 5, 0.3) or {}
        local2 = h.evaluate(LOCAL_JS, MASS)
        items = r2["items"]
        good = [(i, s) for i, s in items[:4]]
        rest = [i for i, _ in items[5:]]
        prev = r2["before"]
        info("8 setMany gagal item 5: err, applied, commit total/batch/refresh", [r2["err"], r2["applied"], r2["commits"],
                                                                               r2["batchCommits"], r2["refreshCommits"]])
        cons_state = all(st2.get(str(i), st2.get(i)) == prev.get(str(i)) for i in rest) and all(st2.get(str(i), st2.get(i)) == s for i, s in good)
        cons_local = all(local2.get(str(i), local2.get(i)) == prev.get(str(i)) for i in rest) and all(local2.get(str(i), local2.get(i)) == s for i, s in good)
        check("8e setMany item ke-5 taskId tak ada → reject 'Task not found', err.applied = 4 id pertama; item 1–4 baru, "
              "item 6–200 kembali ke nilai lama (state React lewat satu refreshTasks + IndexedDB)",
              r2["err"] == "Task not found" and r2["applied"] == [i for i, _ in good] and cons_state and cons_local
              and r2["refreshCalls"] == 1, repr((r2["err"], r2["applied"], cons_state, cons_local)))
        shot(h, "8-H-setmany-200.png")
        # online: semua PUT task dari H = ext saja
        s0 = time.time()
        n_before = len([x for x in puts if x[0] == "H"])
        go_online(ch, h)
        sync_now(h)
        wait_until(lambda: len([x for x in puts if x[0] == "H" and x[3] >= s0]) >= 200, 90, 1.0)
        nap(2)
        hx = [x for x in puts if x[0] == "H" and x[3] >= s0]
        hp = [x[2] for x in hx]
        per_task = len(set(x[1] for x in hx))
        check("8f online → %d PUT dari H = satu per task (200 task tertunda; tulis kedua pada 4 task digabung, R3), "
              "semuanya persis {ext_patch}" % len(hp),
              len(hp) == 200 and per_task == 200 and all(set(b_ or {}) == {"ext_patch"} for b_ in hp),
              "n=%d task=%d sebelum=%d" % (len(hp), per_task, n_before))
        ch.close()
        ctxs.remove(ch)
        # kontrol: plugin-runtime.js pra-#123
        served = []
        cr = new_context(browser, base, hook=True)
        ctxs.append(cr)
        serve_old(cr, "static/plugin-runtime.js", served)
        rp = open_page(cr, base, u2, "R")
        open_timeline(rp, MASS)
        rp.evaluate(INSTR_JS)
        go_offline(cr, rp)
        rc = measure_setmany(cr, rp)
        info("8 KONTROL plugin-runtime pra-#123 (CPU 4×): ms, commit total / di luar refreshTasks / batch",
             [rc["ms"], rc["commits"], rc["commits"] - rc["refreshCommits"], rc["batchCalls"]])
        check("8g KONTROL plugin-runtime.js pra-#123 (%d kali disajikan): commit per item (≥ 150 di luar refreshTasks, "
              "tanpa batch) — tes peka" % len(served), served and rc["rows"] == 200 and rc["batchCalls"] == 0
              and rc["commits"] - rc["refreshCommits"] >= 150, repr(rc["commits"]))
        cr.close()
        ctxs.remove(cr)
    finally:
        for cx in ctxs:
            try:
                cx.close()
            except Exception:  # noqa: BLE001
                pass


# ── 9 K26 ────────────────────────────────────────────────────────────────────

POST_JS = """async ([tok, ent, id]) => { const r = await fetch('/api/plugins/demo-records/records', { method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok },
    body: JSON.stringify({ items: [{ entity: ent, id, scope: 'user', data: { t: 'halo' }, updated_at: new Date().toISOString() }] }) });
  const j = await r.json(); return { status: r.status, item: (j.results || [])[0] || j }; }"""


def run_k26(browser):
    import e2e_plugin_fase1_1a2 as a2  # build_plugins + start_server (aplikasi pembungkus indeks tmp)
    tmp = tempfile.mkdtemp(prefix="e2e_plugin_fase1_1c0_k26_")
    proc = None
    try:
        pdir, idx = a2.build_plugins(tmp)
        index_path = os.path.join(pdir, "index.json")
        proc, base = a2.start_server(tmp, index_path)
        pid0 = proc.pid
        r = requests.post(base + "/api/auth/register", json={"username": "k26", "password": hd.PW, "email": "k26@ex.com",
                                                              "display_name": "Kara"})
        r.raise_for_status()
        tok = r.json()["token"]
        ctx = browser.new_context(service_workers="block")
        try:
            p = ctx.new_page()
            p.on("console", lambda m_: console_log.append(("K", m_.type, m_.text)))
            p.goto(base + "/manifest.json")
            r0 = p.evaluate(POST_JS, [tok, "memo", "m1"])
            check("9a sebelum indeks berubah: POST entitas 'memo' → INVALID entity (memulai jendela baca ulang)",
                  r0["status"] == 200 and r0["item"].get("error") == "INVALID" and r0["item"].get("detail") == "entity", repr(r0))
            t_write = time.time()
            for e in idx["plugins"]:
                if e["id"] == "demo-records":
                    e["records"]["memo"] = {"conflict": "lww", "maxBytes": 4096}
            with open(index_path + ".tmp", "w", encoding="utf-8") as fh:
                json.dump(idx, fh)
            os.replace(index_path + ".tmp", index_path)
            tries = []

            def ok_memo():
                x = p.evaluate(POST_JS, [tok, "memo", "m1"])
                tries.append(round(time.time() - t_write, 1))
                return x if x["item"].get("applied") is True else None
            got = wait_until(ok_memo, 15, 1.0)
            waited = round(time.time() - t_write, 1)
            info("9 K26: detik sejak indeks ditulis sampai POST memo diterima (percobaan)", [waited, tries])
            check("9b indeks tmp memuat 'memo' (tanpa restart, pid %d sama) → POST memo applied:true dalam ≤ 11 s" % pid0,
                  got and got["item"]["record"]["entity"] == "memo" and waited <= 11.5 and proc.poll() is None and proc.pid == pid0,
                  repr((got, waited)))
            rn = p.evaluate(POST_JS, [tok, "nope", "n1"])
            check("9c entitas 'nope' → INVALID entity", rn["item"].get("error") == "INVALID" and rn["item"].get("detail") == "entity",
                  repr(rn))
        finally:
            ctx.close()
    finally:
        if proc:
            proc.terminate()
            try:
                proc.wait(10)
            except subprocess.TimeoutExpired:
                proc.kill()
        log = os.path.join(tmp, "server.log")
        if os.path.exists(log):
            with open(log, encoding="utf-8", errors="replace") as fh:
                lines = [ln.rstrip() for ln in fh if re.search(r"baca ulang indeks|Traceback|ERROR", ln)]
            info("9 log server (baca ulang / error)", lines[:6])
            # baris baca ulang kini WARNING (review akhir 1c-0) → tercetak di proses web (level efektif WARNING); runbook
            # ADR-043 memakai baris ini di journalctl sebagai bukti opsional proses baru. Informasi, bukan cek.
            info("9 baris WARNING 'baca ulang indeks' ada di log server", any("baca ulang indeks" in ln for ln in lines))
        shutil.rmtree(tmp, ignore_errors=True)


# ── seed ──────────────────────────────────────────────────────────────────────

def seed_all(base, db_path, mon):
    u1 = hd.seed(base, username="sx1", display_name="Rani")
    u2 = hd.seed(base, username="sx2", display_name="Sari")
    ws_id = hd.api(base, u1, "POST", "/api/lists", json={"name": WS})["id"]
    with sqlite3.connect(db_path) as conn:
        conn.execute("INSERT INTO list_members (list_id, user_id, joined_at) VALUES (?,?,?)",
                     (ws_id, u2["id"], datetime.datetime.now().isoformat()))
    d = lambda n: (mon + datetime.timedelta(days=n)).isoformat()  # noqa: E731
    ids = {"ws": ws_id}
    for key, title, off, dur in (("t1", T1, 0, 3), ("t2", T2, 8, 2), ("t3", T3, 14, 2), ("t4", T4, 21, 1)):
        tid = task_id(hd.api(base, u1, "POST", "/api/tasks", json={"title": title, "gtd_status": "next", "priority": "P3",
                                                                     "list_id": ws_id, "project": PROJ}))
        hd.api(base, u1, "PUT", "/api/tasks/%d" % tid, json={"ext_patch": {PID + ".start": d(off), PID + ".duration": dur}})
        ids[key] = tid
    s1 = hd.api(base, u1, "PUT", "/api/plugins/state/%s" % PID, json={"enabled": True})
    s2 = hd.api(base, u2, "PUT", "/api/plugins/state/%s" % PID, json={"enabled": True})
    sess = requests.Session()
    sess.headers["Authorization"] = "Bearer " + u2["token"]
    for i in range(200):
        r = sess.post(base + "/api/tasks", json={"title": "Massal %03d" % i, "gtd_status": "next", "priority": "P3",
                                                 "project": MASS, "ext": {PID + ".start": d(i % 10), PID + ".duration": 3}},
                      timeout=10)
        r.raise_for_status()
    check("setup: U2 anggota W; Timeline ON U1+U2; T1–T4 berjadwal (PUT ext_patch); 200 task Massal U2",
          s1["state"]["enabled"] is True and s2["state"]["enabled"] is True
          and any(x["id"] == ws_id for x in hd.api(base, u2, "GET", "/api/lists"))
          and all(start_of(base, u1, ids[k]) for k in ("t1", "t2", "t3", "t4")))
    return {"u1": u1, "u2": u2}, ids


def console_checks():
    allowed = re.compile(r"Failed to load resource|net::ERR_")
    bad = [(dv, t, x[:220]) for dv, t, x in console_log if t in ("error", "pageerror") and not allowed.search(x)]
    info("konsol: error/peringatan (perangkat, jenis, teks) — semua", [(dv, t, x[:160]) for dv, t, x in console_log
                                                                       if t in ("error", "pageerror", "warning")][:20])
    check("10d konsol tanpa error selain yang disengaja (request yang di-abort/offline)", not bad, repr(bad[:6]))


def main():
    if not ONLY and os.path.isdir(SHOTS):
        for fn in os.listdir(SHOTS):
            if re.match(r"^\d+-.*\.png$", fn):
                os.remove(os.path.join(SHOTS, fn))
    tmp = tempfile.mkdtemp(prefix="e2e_plugin_fase1_1c0_")
    db_path = os.path.join(tmp, "e2e.db")
    proc, base = hd.start_server(tmp)
    print("server", base, flush=True)
    mon = next_monday(datetime.date.today())
    try:
        users, ids = seed_all(base, db_path, mon)
        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            if any(want(n) for n in (1, 2, 3, 4, 5, 6, 7, 10)):
                run_members(browser, base, users, ids, mon)
            if want(8):
                run_setmany(browser, base, users["u2"])
            if want(9):
                run_k26(browser)
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
    for k, v in perf.items():
        print("  %s: %s" % (k, v))
    print("\n%d/%d cek lolos" % (len(hd.results) - len(failed), len(hd.results)), flush=True)
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
