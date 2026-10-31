"""E2E sistem plugin Fase 1 — PR 1a-1: `tasks.ext` per kunci, slot `taskList.views` + `taskDetail.sections`,
`api.taskExt`, banner `versionchange` IndexedDB (spec docs/superpowers/specs/2026-10-31-plugin-fase1-timeline-design.md
§10–§11; rencana docs/superpowers/plans/2026-10-31-plugin-fase1-pr-1a-1.md Task 13). Tidak dijalankan CI.

    python3 temporary_files/e2e_plugin_fase1_1a1.py

Server uvicorn lokal + DB sementara lewat aplikasi pembungkus `temporary_files/e2e_app_demo_ext.py` (R21: indeks plugin
server = indeks nyata + `demo-ext`, hasil `buildPlugins` ke direktori tmp). Klien mendapat indeks yang sama dan file
`demo-ext` lewat `ctx.route` atas `/static/plugins/index.json` dan `/static/plugins/demo-ext/*`; konteks
`service_workers="block"` (rute tidak dilewati cache SW). `static/plugins/` tidak disentuh. Tiap "perangkat" = satu
`browser.new_context` (IndexedDB terpisah). Sinkron: `window.__syncNow()` lalu tunggu `__syncState.running === false`.

Pengguna: U1 "ext1a1" (perangkat A, B, C, D; pemilik workspace W, demo-ext ON lewat `PUT /api/plugins/state/demo-ext`),
U2 "ext1a2" (anggota W, demo-ext OFF, hanya lewat API).

  1 A: detail task W › seksi "Catatan demo" di antara Deskripsi dan tab (modal + panel Live Edit) → "hai" + Simpan →
    server ext == {"demo-ext.note": "hai"} → B sinkron → seksi B "hai"; notifikasi U2 "memperbarui task" tidak bertambah.
  2 B offline: put lokal ext_patch {"demo-ext.after": {"$task": T2}}; A ganti judul (notifikasi +1, kontrol positif) →
    B online + sinkron → server: judul A + kedua kunci; U2 (OFF) ganti prioritas lewat API → ext utuh.
  3 jendela deploy di A: rute PUT /api/tasks/* meniru server lama (ext_patch diabaikan, respons `"ext": "{}"` string) →
    ext_dirty tetap, ≤ 1 PUT per sinkron → unroute → sinkron → server punya kunci, ext_dirty hilang.
  4 C (sesi segar): tombol "Demo" di proj_* dan slist_* tanpa request plugin.js sampai diklik → "Memuat Demo…" → view;
    reload → tetap Demo per halaman; Inbox tanpa tombol, tf_viewmode tetap; Normal → kunci per halaman hilang;
    Live Edit + klik item view → panel; D: plugin.js 404 → "Demo tidak bisa dimuat" → "Kembali ke Normal".
  5 C: plugin OFF dari Pengaturan saat view Demo aktif → daftar kembali ke mode inti tanpa reload.
  6 dua tab: (a) tab app + tab kedua indexedDB.open(v7) mentah → banner "diperbarui di tab lain" + "Muat ulang"
    (375 px, Sakura gelap); (b) tab /manifest.json memegang DB v5 mentah → tab app banner "Tutup tab Alurik lain…" →
    tab pertama ditutup → banner hilang, daftar task tampil.
  7 375 px: tombol view tanpa geser horizontal; Sakura gelap: tombol view terbaca; konsol tanpa error tak terduga.
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
SHOTS = os.path.join(ROOT, "temporary_files", "e2e_plugin_fase1_1a1")
PID = "demo-ext"
PNAME = "Demo Ext"
SWITCH = '[role=switch][aria-labelledby="plugin-name-%s"]' % PID
SUBTITLE = "Fitur opsional. Pilihanmu tersimpan di akun dan berlaku di semua perangkat."
WS = "Ruang Demo"
PROJ = "Proyek Demo"
T1 = "Tugas W satu"
T1_A = "Tugas W satu (diubah A)"
T2 = "Tugas W dua"
TP = "Tugas proyek demo"
SECTION = '[data-plugin-slot="taskDetail.sections"] .demo-ext-section'
TEXT_BLOCKED = "Tutup tab Alurik lain untuk menyelesaikan pembaruan"
TEXT_ELSEWHERE = "Alurik diperbarui di tab lain. Muat ulang tab ini."
PLUGIN_JS = "/static/plugins/%s/plugin.js" % PID

check = hd.check
console_log = []      # (perangkat, type, text)
plugin_js_reqs = []   # (perangkat, url)


# ── build + server ────────────────────────────────────────────────────────────

def build_plugins(tmp):
    """static/plugins/<id> nyata + tests/fixtures/plugins/demo-ext → <tmp>/plugins (buildPlugins compile.js)."""
    pdir = os.path.join(tmp, "plugins")
    os.makedirs(pdir)
    src = os.path.join(ROOT, "static", "plugins")
    for name in os.listdir(src):
        if os.path.isdir(os.path.join(src, name)) and not name.startswith("_"):
            shutil.copytree(os.path.join(src, name), os.path.join(pdir, name))
    shutil.copytree(os.path.join(ROOT, "tests", "fixtures", "plugins", PID), os.path.join(pdir, PID))
    sw = os.path.join(tmp, "sw.js")
    shutil.copy(os.path.join(ROOT, "static", "sw.js"), sw)
    code = ("const b = require(%s); b.buildPlugins({ pluginsDir: %s, swPath: %s, log: () => {} });"
            % (json.dumps(os.path.join(ROOT, "compile.js")), json.dumps(pdir), json.dumps(sw)))
    subprocess.run(["node", "-e", code], cwd=ROOT, check=True)
    with open(os.path.join(pdir, "index.json"), encoding="utf-8") as fh:
        idx = json.load(fh)
    return pdir, idx


def start_server(tmp, index_path):
    port = hd.free_port()
    env = dict(os.environ, DB_PATH=os.path.join(tmp, "e2e.db"), UPLOAD_DIR=os.path.join(tmp, "uploads"),
               WEB_SECRET_KEY=hd.SECRET, TELEGRAM_BOT_TOKEN="", E2E_PLUGIN_INDEX=index_path)
    os.makedirs(env["UPLOAD_DIR"], exist_ok=True)
    log = open(os.path.join(tmp, "server.log"), "w")
    proc = subprocess.Popen([hd.server_python(), "-m", "uvicorn", "e2e_app_demo_ext:app", "--app-dir",
                             os.path.join(ROOT, "temporary_files"), "--host", "127.0.0.1", "--port", str(port)],
                            cwd=ROOT, env=env, stdout=log, stderr=subprocess.STDOUT)
    base = "http://127.0.0.1:%d" % port
    for _ in range(120):
        try:
            if requests.get(base + "/manifest.json", timeout=1).status_code < 500:
                return proc, base
        except requests.RequestException:
            pass
        if proc.poll() is not None:
            break
        time.sleep(0.5)
    proc.kill()
    raise RuntimeError("server gagal start, lihat " + log.name)


def task_id(t):
    return t.get("id") or (t.get("task") or {}).get("id")


def server_task(base, user, tid):
    return hd.api(base, user, "GET", "/api/tasks/%s" % tid)


def upd_notifs(base, user, title):
    rows = hd.api(base, user, "GET", "/api/notifications")
    return len([n for n in rows if "memperbarui task" in (n.get("message") or "") and title in (n.get("message") or "")])


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


# ── perangkat ─────────────────────────────────────────────────────────────────

def shot(p, name):
    os.makedirs(SHOTS, exist_ok=True)
    p.screenshot(path=os.path.join(SHOTS, name), animations="disabled", caret="hide")


def plugin_routes(ctx, label, pdir, idx_body, mode):
    """`mode["js"]`: "ok" | "404" — file demo-ext dari build tmp; index.json = indeks tmp."""
    def index_route(route):
        route.fulfill(status=200, content_type="application/json", body=idx_body)

    def file_route(route):
        url = route.request.url
        name = url.split("/static/plugins/%s/" % PID, 1)[1].split("?", 1)[0]
        if name == "plugin.js":
            plugin_js_reqs.append((label, url))
            if mode.get("js") == "404":
                route.fulfill(status=404, content_type="text/plain", body="Not Found")
                return
        path = os.path.join(pdir, PID, name)
        if not os.path.isfile(path):
            route.fulfill(status=404, content_type="text/plain", body="Not Found")
            return
        with open(path, "rb") as fh:
            body = fh.read()
        ctype = "text/css" if name.endswith(".css") else "application/javascript"
        route.fulfill(status=200, content_type=ctype, body=body)

    ctx.route(re.compile(r"/static/plugins/index\.json(\?.*)?$"), index_route)
    ctx.route(re.compile(r"/static/plugins/%s/" % re.escape(PID)), file_route)


def prime_storage(p, user, palette="default", theme="light", live="0"):
    p.evaluate("""([t, u, tours, sw, pal, th, live]) => {
        if (t) { localStorage.setItem('tf_token', t); localStorage.setItem('tf_user_id', String(u)); }
        for (const pg of tours) localStorage.setItem('tf_tour_' + pg, '1');
        localStorage.setItem('tf_whatsnew_seen', sw); localStorage.setItem('tf_theme', th);
        localStorage.setItem('tf_palette', pal); localStorage.setItem('tf_liveedit', live);
        localStorage.setItem('tf_dismiss_onboarding', '1'); localStorage.setItem('tf_shortcut_hint', '1');
    }""", [user["token"], user["id"], hd.TOURS, hd.sw_version(), palette, theme, live])


def new_context(browser, base, label, pdir, idx_body, mode=None, viewport=None):
    ctx = browser.new_context(service_workers="block", viewport=viewport or hd.DESKTOP, timezone_id="Asia/Jakarta",
                              reduced_motion="reduce")
    ctx.route(re.compile(r"^(?!%s/)" % re.escape(base)), lambda route: route.abort())
    plugin_routes(ctx, label, pdir, idx_body, mode if mode is not None else {"js": "ok"})
    return ctx


def watch(p, label):
    p.on("dialog", lambda d: d.accept())
    p.on("console", lambda m: console_log.append((label, m.type, m.text)))
    p.on("pageerror", lambda e: console_log.append((label, "pageerror", str(e))))


def new_device(browser, base, user, label, pdir, idx_body, mode=None, palette="default", theme="light"):
    ctx = new_context(browser, base, label, pdir, idx_body, mode)
    p = ctx.new_page()
    watch(p, label)
    p.goto(base + "/manifest.json")
    prime_storage(p, user, palette, theme)
    p.goto(base + "/")
    hd.wait_dashboard_ready(p)
    wait_sync(p)
    p.wait_for_function("pid => window.TF && window.TF.plugins && window.TF.plugins.isEnabled(pid)", arg=PID,
                        timeout=20000)
    return ctx, p


def wait_sync(p, timeout=30000):
    p.wait_for_function("() => window.__syncState && window.__syncState.running === false", timeout=timeout)


def sync_now(p):
    p.evaluate("() => Promise.resolve(window.__syncNow && window.__syncNow()).catch(() => null)")
    wait_sync(p)
    p.wait_for_timeout(300)


def refresh_tasks(p):
    p.evaluate("() => Promise.resolve(window.__refreshTasks && window.__refreshTasks()).catch(() => null)")
    p.wait_for_timeout(400)


def sidebar_click(p, label):
    ex = p.locator("button[aria-label='Tampilkan semua menu']")
    if ex.count() and ex.first.is_visible():
        ex.first.click()
        p.wait_for_timeout(300)
    top = p.locator(".mobile-topbar button")
    link = p.locator(".sidebar-link").filter(has=p.locator("span", has_text=re.compile("^" + re.escape(label) + "$")))
    if not link.first.is_visible() and top.count() and top.first.is_visible():
        top.first.click()
        p.wait_for_timeout(500)
    link.first.click()
    p.wait_for_timeout(500)


def goto_list(p, label, row_title=None):
    sidebar_click(p, label)
    if row_title:
        p.locator(".task-row", has_text=row_title).first.wait_for(state="visible", timeout=15000)


def open_settings(p):
    sidebar_click(p, "Pengaturan")
    p.get_by_text(SUBTITLE).wait_for(state="visible", timeout=20000)
    p.locator(SWITCH).scroll_into_view_if_needed()


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
    """Klik overlay di luar kartu (pola e2e_task_detail_body)."""
    p.locator(".modal-overlay").first.click(position={"x": 4, "y": 4})
    p.locator(".modal-overlay").first.wait_for(state="detached", timeout=8000)


def section_order(p, scope):
    """Seksi plugin di antara .td-desc-wrap dan .td-tabs di dalam `scope` (selektor wadah)."""
    return p.evaluate("""sel => { const root = document.querySelector(sel); if (!root) return 'tanpa wadah';
        const d = root.querySelector('.td-desc-wrap'), s = root.querySelector('[data-plugin-slot="taskDetail.sections"]'),
              t = root.querySelector('.td-tabs');
        if (!d || !s || !t) return 'hilang: ' + [!d && 'desc', !s && 'slot', !t && 'tabs'].filter(Boolean).join(',');
        const after = !!(d.compareDocumentPosition(s) & Node.DOCUMENT_POSITION_FOLLOWING);
        const before = !!(s.compareDocumentPosition(t) & Node.DOCUMENT_POSITION_FOLLOWING);
        return after && before ? 'ok' : 'urutan salah'; }""", scope)


IDB_TASK = """sid => new Promise((res, rej) => { const rq = indexedDB.open('taskflow-offline');
    rq.onerror = () => rej(rq.error); rq.onsuccess = () => { const db = rq.result;
      const g = db.transaction('tasks').objectStore('tasks').getAll();
      g.onsuccess = () => { db.close(); const r = g.result.find(x => x && x.server_id === sid);
        res(r ? { title: r.title, ext: r.ext === undefined ? null : r.ext, ext_dirty: r.ext_dirty === undefined ? null : r.ext_dirty,
                  dirty: r.dirty, priority: r.priority } : null); }; g.onerror = () => rej(g.error); }; })"""


def idb_task(p, sid):
    return p.evaluate(IDB_TASK, sid)


def outbox_task_ops(p):
    return p.evaluate("""() => new Promise(res => { const rq = indexedDB.open('taskflow-offline');
        rq.onsuccess = () => { const db = rq.result; const g = db.transaction('_outbox').objectStore('_outbox').getAll();
          g.onsuccess = () => { db.close(); res(g.result.filter(o => o.entity_type === 'task').map(o => [o.op, o.cid])); }; }; })""")


def view_btn(p, label):
    return p.locator(".tl-view-btn[aria-label='%s']" % label)


def ls_get(p, key):
    return p.evaluate("k => localStorage.getItem(k)", key)


CONTRAST_JS = """sel => { const el = typeof sel === 'string' ? document.querySelector(sel) : sel; if (!el) return null;
    const parse = c => { const m = c.match(/rgba?\\(([^)]+)\\)/); if (!m) return null;
      const v = m[1].split(/[ ,\\/]+/).filter(Boolean).map(Number); return [v[0], v[1], v[2], v.length > 3 ? v[3] : 1]; };
    const lum = c => { const f = x => { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); };
      return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
    let bg = null; for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const c = parse(getComputedStyle(n).backgroundColor); if (c && c[3] > 0.5) { bg = c; break; } }
    if (!bg) bg = parse(getComputedStyle(document.body).backgroundColor) || [255, 255, 255, 1];
    const fg = parse(getComputedStyle(el).color);
    const a = lum(fg), b = lum(bg); const r = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    return { ratio: Math.round(r * 100) / 100, fg: getComputedStyle(el).color, bg: 'rgb(' + bg.slice(0, 3).join(',') + ')' }; }"""


def contrast(p, sel):
    return p.evaluate(CONTRAST_JS, sel)


def no_hscroll(p):
    return p.evaluate("() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth })")


# ── skenario ──────────────────────────────────────────────────────────────────

def run(browser, base, u1, u2, ids, pdir, idx_body):
    t1, t2, tp, ws_id = ids["t1"], ids["t2"], ids["tp"], ids["ws"]
    ws_page = "slist_%d" % ws_id
    proj_page = "proj_%s" % PROJ
    ctxs = []
    try:
        ca, a = new_device(browser, base, u1, "A", pdir, idx_body)
        cb, b = new_device(browser, base, u1, "B", pdir, idx_body)
        ctxs += [ca, cb]
        a.evaluate("() => { window.__e2eNoReload = 1; }")

        # ── 1 ──
        n0 = upd_notifs(base, u2, T1)
        goto_list(a, WS, T1)
        m = open_modal(a, T1)
        sec = a.locator(".modal-content " + SECTION)
        try:
            sec.wait_for(state="visible", timeout=15000)
            sec_ok = True
        except PwTimeout:
            sec_ok = False
        order = section_order(a, ".modal-content")
        lbl = sec.inner_text() if sec_ok else ""
        check("1a A modal: seksi 'Catatan demo' tampil di antara Deskripsi dan tab", sec_ok and order == "ok"
              and "Catatan demo" in lbl, "order=%s teks=%r" % (order, lbl))
        shot(a, "1-A-modal-seksi.png")
        close_modal(a)
        a.locator("button[aria-label='Live Edit']").click()
        panel = a.locator("aside.tl-live-panel")
        panel.wait_for(state="visible", timeout=10000)
        a.locator(".task-row", has_text=T1).first.click()
        try:
            a.locator("aside.tl-live-panel " + SECTION).wait_for(state="visible", timeout=10000)
            psec = True
        except PwTimeout:
            psec = False
        porder = section_order(a, "aside.tl-live-panel")
        check("1b A panel Live Edit: seksi yang sama tampil di antara Deskripsi dan tab", psec and porder == "ok",
              "order=%s" % porder)
        shot(a, "1-A-panel-live-edit.png")
        a.locator("button[aria-label='Live Edit']").click()
        panel.wait_for(state="detached", timeout=10000)
        m = open_modal(a, T1)
        inp = m.locator(SECTION + " input[type=text]")
        inp.fill("hai")
        m.locator(SECTION).get_by_role("button", name="Simpan").click()
        rec = wait_until(lambda: (lambda r: r if r and (r.get("ext") or {}).get("demo-ext.note") == "hai" else None)(idb_task(a, t1)), 10)
        check("1c A Simpan → record IndexedDB ext 'hai' + ext_dirty", rec is not None, repr(rec))
        close_modal(a)
        sync_now(a)
        st = wait_until(lambda: (lambda t: t if t.get("ext") == {"demo-ext.note": "hai"} else None)(server_task(base, u1, t1)), 15)
        check("1d server: ext == {'demo-ext.note': 'hai'}", st is not None, repr(server_task(base, u1, t1).get("ext")))
        rec = idb_task(a, t1)
        check("1e A setelah sinkron: ext_dirty bersih, dirty 0", rec and rec["ext_dirty"] is None and rec["dirty"] == 0,
              repr(rec))
        sync_now(b)
        refresh_tasks(b)
        goto_list(b, WS, T1)
        mb = open_modal(b, T1)
        try:
            b.wait_for_function("sel => { const i = document.querySelector(sel); return i && i.value === 'hai'; }",
                                arg=".modal-content " + SECTION + " input[type=text]", timeout=15000)
            b_ok = True
        except PwTimeout:
            b_ok = False
        check("1f B sinkron → seksi B menampilkan 'hai'", b_ok)
        shot(b, "1-B-seksi-hai.png")
        close_modal(b)
        time.sleep(1.0)  # notifikasi dikirim lewat BackgroundTasks setelah respons
        n1 = upd_notifs(base, u2, T1)
        check("1g notifikasi U2 'memperbarui task' tidak bertambah oleh perubahan ext saja (K6)", n1 == n0,
              "sebelum=%d sesudah=%d" % (n0, n1))

        # ── 2 ──
        cb.set_offline(True)
        try:
            b.wait_for_function("() => navigator.onLine === false", timeout=5000)
            b.evaluate("""([id, other]) => window.TF.taskroutes.buildTaskRouter().dispatch('PUT', '/api/tasks/' + id,
                { ext_patch: { 'demo-ext.after': { $task: other } } })""", [t1, t2])
            rb = idb_task(b, t1)
            check("2a B offline: put lokal ext_patch → record ext 2 kunci, ext_dirty ['demo-ext.after']",
                  rb and rb["ext"] == {"demo-ext.note": "hai", "demo-ext.after": {"$task": t2}}
                  and rb["ext_dirty"] == ["demo-ext.after"], repr(rb))
            time.sleep(1.5)  # edit judul A lebih baru (LWW server menang di pull B)
            a.evaluate("([id, t]) => window.TF.taskroutes.buildTaskRouter().dispatch('PUT', '/api/tasks/' + id, { title: t })",
                       [t1, T1_A])
            sync_now(a)
            sa = wait_until(lambda: (lambda t: t if t.get("title") == T1_A else None)(server_task(base, u1, t1)), 15)
            check("2b A ganti judul → server judul A, ext lama utuh", sa is not None and sa["ext"] == {"demo-ext.note": "hai"},
                  repr(server_task(base, u1, t1)))
            time.sleep(1.0)
            n2 = upd_notifs(base, u2, T1)
            check("2c kontrol positif: ganti judul (field inti) → notifikasi U2 bertambah 1", n2 == n1 + 1,
                  "sebelum=%d sesudah=%d" % (n1, n2))
        finally:
            cb.set_offline(False)
        b.wait_for_function("() => navigator.onLine === true", timeout=5000)
        want = {"demo-ext.note": "hai", "demo-ext.after": {"$task": t2}}

        def merged():
            sync_now(b)
            t = server_task(base, u1, t1)
            return t if t.get("title") == T1_A and t.get("ext") == want else None
        sm = wait_until(merged, 30, 1)
        check("2d B online + sinkron → server: judul A + kedua kunci ext", sm is not None, repr(server_task(base, u1, t1)))
        rb = idb_task(b, t1)
        check("2e B: record judul A, ext 2 kunci, ext_dirty bersih, outbox task kosong",
              rb and rb["title"] == T1_A and rb["ext"] == want and rb["ext_dirty"] is None and not outbox_task_ops(b),
              repr((rb, outbox_task_ops(b))))
        r = requests.put(base + "/api/tasks/%d" % t1, json={"priority": "P1"},
                         headers={"Authorization": "Bearer " + u2["token"]}, timeout=10)
        st = server_task(base, u1, t1)
        check("2f U2 (demo-ext OFF) ganti prioritas lewat API → ext utuh", r.status_code == 200
              and st["priority"] == "P1" and st["ext"] == want, "%d %r" % (r.status_code, st.get("ext")))

        # ── 3 ──
        hits = []

        def old_server(route):
            req = route.request
            if req.method != "PUT":
                route.fallback()
                return
            body = req.post_data_json or {}
            had = "ext_patch" in body
            body.pop("ext_patch", None)  # server lama: pydantic mengabaikan field asing
            resp = route.fetch(post_data=json.dumps(body))
            data = resp.json()
            if isinstance(data, dict):
                data["ext"] = "{}"  # R3: kolom baru terlihat lewat SELECT *, dikirim sebagai string
            hits.append((req.url, had))
            route.fulfill(response=resp, json=data)

        ca.route("**/api/tasks/*", old_server)
        try:
            a.evaluate("([pid, id]) => window.TF.api.for(pid).taskExt.set(id, { note: 'deploy' })", [PID, t2])
            a.wait_for_timeout(2200)  # push terjadwal 1,5 s
            sync_now(a)
            r3 = idb_task(a, t2)
            s3 = server_task(base, u1, t2)
            mine = [h for h in hits if h[0].endswith("/api/tasks/%d" % t2)]
            check("3a jendela deploy: PUT terkirim membawa ext_patch, server lama mengabaikannya",
                  mine and all(h[1] for h in mine) and "demo-ext.note" not in (s3.get("ext") or {}),
                  "hits=%r server=%r" % (mine, s3.get("ext")))
            check("3b respons tanpa ext objek ('{}' string) → record tetap ext_dirty ['demo-ext.note'], dirty 1",
                  r3 and r3["ext_dirty"] == ["demo-ext.note"] and r3["dirty"] == 1
                  and (r3["ext"] or {}).get("demo-ext.note") == "deploy", repr(r3))
            before = len(mine)
            sync_now(a)
            mine2 = [h for h in hits if h[0].endswith("/api/tasks/%d" % t2)]
            r3b = idb_task(a, t2)
            check("3c satu sinkron lagi → paling banyak 1 PUT (tanpa loop), ext_dirty tetap",
                  len(mine2) - before <= 1 and r3b["ext_dirty"] == ["demo-ext.note"], "PUT=%d" % (len(mine2) - before))
            idle0 = len(mine2)
            a.wait_for_timeout(8000)
            idle = len([h for h in hits if h[0].endswith("/api/tasks/%d" % t2)]) - idle0
            check("3c' diam 8 detik tanpa sinkron manual → tidak ada PUT berulang (push terjadwal tidak berputar)",
                  idle <= 1, "PUT selama diam=%d" % idle)
            shot(a, "3-A-jendela-deploy.png")
        finally:
            ca.unroute("**/api/tasks/*", old_server)
        sync_now(a)
        s3 = wait_until(lambda: (lambda t: t if (t.get("ext") or {}).get("demo-ext.note") == "deploy" else None)(server_task(base, u1, t2)), 15)
        r3 = idb_task(a, t2)
        check("3d server di-restart (rute dilepas) → sinkron → server punya kunci, ext_dirty hilang",
              s3 is not None and r3["ext_dirty"] is None and r3["dirty"] == 0, repr((s3 and s3.get("ext"), r3)))

        # ── 4 ──
        cc, c = new_device(browser, base, u1, "C", pdir, idx_body)
        ctxs.append(cc)
        c.evaluate("() => { window.__e2eNoReload = 1; }")
        vm0 = ls_get(c, "tf_viewmode")
        goto_list(c, PROJ, TP)
        btn = view_btn(c, "Demo")
        n_js = len([x for x in plugin_js_reqs if x[0] == "C"])
        check("4a proj_*: tombol 'Demo' tampil tanpa request plugin.js", btn.count() == 1 and btn.is_visible() and n_js == 0,
              "tombol=%d req=%d" % (btn.count(), n_js))
        c.evaluate("""() => { window.__sawLoading = false; const o = new MutationObserver(() => {
            if (document.body.innerText.includes('Memuat Demo…')) window.__sawLoading = true; });
            o.observe(document.body, { childList: true, subtree: true, characterData: true }); window.__loadObs = o; }""")
        btn.click()
        board = c.locator(".tf-plugin-view .demo-ext-board")
        board.wait_for(state="visible", timeout=15000)
        saw = c.evaluate("() => { window.__loadObs.disconnect(); return window.__sawLoading; }")
        n_js = len([x for x in plugin_js_reqs if x[0] == "C"])
        items = board.inner_text()
        check("4b klik Demo → 'Memuat Demo…' lalu view (1 request plugin.js), task project tampil",
              saw and n_js == 1 and TP in items and btn.get_attribute("aria-pressed") == "true",
              "loading=%s req=%d isi=%r" % (saw, n_js, items[:120]))
        check("4c tf_viewmode_ext:<proj> = 'demo-ext:board', tf_viewmode tidak berubah",
              ls_get(c, "tf_viewmode_ext:" + proj_page) == "demo-ext:board" and ls_get(c, "tf_viewmode") == vm0,
              "%r / %r" % (ls_get(c, "tf_viewmode_ext:" + proj_page), ls_get(c, "tf_viewmode")))
        shot(c, "4-C-proj-demo.png")
        goto_list(c, WS)
        c.wait_for_timeout(800)
        check("4d slist_*: tombol Demo tampil, view tetap Normal (pilihan per halaman)",
              view_btn(c, "Demo").count() == 1 and c.locator(".tf-plugin-view").count() == 0
              and c.locator(".task-row", has_text=T2).count() >= 1)
        view_btn(c, "Demo").click()
        wb = c.locator(".tf-plugin-view .demo-ext-board")
        wb.wait_for(state="visible", timeout=10000)
        wtxt = wb.inner_text()
        check("4e slist_* view Demo: task W + ext dibaca plugin ('— hai' di T1, '— deploy' di T2)",
              T1_A in wtxt and "hai" in wtxt and "deploy" in wtxt, repr(wtxt[:200]))
        shot(c, "4-C-workspace-demo.png")
        c.reload()
        hd.wait_dashboard_ready(c)
        goto_list(c, PROJ)
        try:
            c.locator(".tf-plugin-view .demo-ext-board").wait_for(state="visible", timeout=15000)
            kept = True
        except PwTimeout:
            kept = False
        check("4f reload → proj_* tetap Demo", kept and view_btn(c, "Demo").get_attribute("aria-pressed") == "true")
        c.evaluate("() => { window.__e2eNoReload = 1; }")
        sidebar_click(c, "Inbox")
        c.wait_for_timeout(800)
        check("4g Inbox: tanpa tombol Demo, tf_viewmode tidak berubah",
              view_btn(c, "Demo").count() == 0 and c.locator(".tf-plugin-view").count() == 0
              and ls_get(c, "tf_viewmode") == vm0, "viewmode=%r" % ls_get(c, "tf_viewmode"))
        goto_list(c, PROJ)
        c.locator(".tf-plugin-view .demo-ext-board").wait_for(state="visible", timeout=10000)
        c.locator("button[aria-label='Normal']").click()
        c.locator(".task-row", has_text=TP).first.wait_for(state="visible", timeout=10000)
        check("4h klik Normal → kunci tf_viewmode_ext:<proj> hilang, daftar Normal",
              ls_get(c, "tf_viewmode_ext:" + proj_page) is None and c.locator(".tf-plugin-view").count() == 0
              and view_btn(c, "Demo").get_attribute("aria-pressed") == "false")
        goto_list(c, WS)
        c.locator(".tf-plugin-view .demo-ext-board").wait_for(state="visible", timeout=10000)
        c.locator("button[aria-label='Live Edit']").click()
        c.locator("aside.tl-live-panel").wait_for(state="visible", timeout=10000)
        c.locator(".demo-ext-board li", has_text=T2).locator("button").first.click()
        try:
            c.wait_for_function("""t => { const a = document.querySelector('aside.tl-live-panel'); if (!a) return false;
                return Array.from(a.querySelectorAll('input,textarea')).some(e => e.value === t); }""", arg=T2, timeout=10000)
            live_ok = True
        except PwTimeout:
            live_ok = False
        check("4i Live Edit ON + klik item view → panel detail membuka task itu (view tetap)",
              live_ok and c.locator(".tf-plugin-view .demo-ext-board").count() == 1)
        shot(c, "4-C-view-live-edit.png")
        c.locator("button[aria-label='Live Edit']").click()
        c.locator("aside.tl-live-panel").wait_for(state="detached", timeout=10000)

        cd, d = new_device(browser, base, u1, "D", pdir, idx_body, mode={"js": "404"})
        ctxs.append(cd)
        d.evaluate("p => localStorage.setItem('tf_viewmode_ext:' + p, 'demo-ext:board')", ws_page)
        goto_list(d, WS)
        fail = d.locator(".tf-plugin-view-failed")
        try:
            fail.wait_for(state="visible", timeout=20000)
            f_ok = "Demo tidak bisa dimuat" in fail.inner_text()
        except PwTimeout:
            f_ok = False
        check("4j plugin.js 404 → 'Demo tidak bisa dimuat' + tombol 'Kembali ke Normal'",
              f_ok and fail.get_by_role("button", name="Kembali ke Normal").count() == 1)
        shot(d, "4-D-gagal-muat.png")
        fail.get_by_role("button", name="Kembali ke Normal").click()
        d.locator(".task-row", has_text=T2).first.wait_for(state="visible", timeout=10000)
        check("4k 'Kembali ke Normal' → daftar Normal, kunci per halaman dihapus",
              d.locator(".tf-plugin-view").count() == 0 and ls_get(d, "tf_viewmode_ext:" + ws_page) is None)
        cd.close()
        ctxs.remove(cd)

        # ── 5 ──
        view_btn(c, "Demo").wait_for(state="visible", timeout=5000)
        check("5-0 C: view Demo aktif di slist_*", c.locator(".tf-plugin-view .demo-ext-board").count() == 1)
        open_settings(c)
        c.locator(SWITCH).click()
        off = wait_switch(c, False)
        goto_list(c, WS, T2)
        c.wait_for_timeout(600)
        check("5a OFF dari Pengaturan → slist_* kembali ke mode inti tanpa reload, tombol Demo hilang",
              off and c.locator(".tf-plugin-view").count() == 0 and view_btn(c, "Demo").count() == 0
              and c.evaluate("() => window.__e2eNoReload") == 1)
        shot(c, "5-C-plugin-off.png")
        open_settings(c)
        c.locator(SWITCH).click()
        on = wait_switch(c, True)
        goto_list(c, WS)
        try:
            c.locator(".tf-plugin-view .demo-ext-board").wait_for(state="visible", timeout=15000)
            back = True
        except PwTimeout:
            back = False
        check("5b ON lagi → view Demo kembali (pilihan per halaman masih tersimpan), tanpa reload",
              on and back and c.evaluate("() => window.__e2eNoReload") == 1)
        wait_until(lambda: (hd.api(base, u1, "GET", "/api/plugins/state")["plugins"].get(PID) or {}).get("enabled") is True, 15)

        # ── 6a ──
        ce = new_context(browser, base, "E", pdir, idx_body, viewport=hd.MOBILE)
        ctxs.append(ce)
        e = ce.new_page()
        watch(e, "E")
        e.goto(base + "/manifest.json")
        prime_storage(e, u1, "sakura", "dark")
        e.goto(base + "/")
        e.locator(".dash-hero-greet").wait_for(state="visible", timeout=30000)
        wait_sync(e)
        e2 = ce.new_page()
        watch(e2, "E-raw")
        e2.goto(base + "/manifest.json")
        raw = e2.evaluate("""() => new Promise(res => { const rq = indexedDB.open('taskflow-offline', 7);
            rq.onupgradeneeded = () => {}; rq.onblocked = () => res('blocked');
            rq.onsuccess = () => { const v = rq.result.version; rq.result.close(); res('ok:' + v); };
            rq.onerror = () => res('error:' + (rq.error && rq.error.name)); setTimeout(() => res('timeout'), 8000); })""")
        ban = e.locator("#tf-db-banner")
        try:
            ban.wait_for(state="visible", timeout=10000)
            btxt = ban.inner_text()
        except PwTimeout:
            btxt = ""
        check("6a-1 tab app menutup koneksi (open v7 mentah sukses tanpa blocked)", raw == "ok:7", raw)
        check("6a-2 tab app: banner 'Alurik diperbarui di tab lain. Muat ulang tab ini.' + tombol 'Muat ulang'",
              TEXT_ELSEWHERE in btxt and ban.get_attribute("role") == "alert"
              and ban.get_by_role("button", name="Muat ulang").count() == 1, repr(btxt))
        err = e.evaluate("""() => window.TF.db.openDB().then(() => 'terbuka', (x) => x && (x.code || x.message))""")
        check("6a-3 openDB berikutnya ditolak DB_UPGRADED_ELSEWHERE", err == "DB_UPGRADED_ELSEWHERE", repr(err))
        geo = e.evaluate("""() => { const b = document.getElementById('tf-db-banner').getBoundingClientRect();
            const k = document.querySelector('#tf-db-banner button').getBoundingClientRect();
            return { left: b.left, right: b.right, kRight: k.right, cw: document.documentElement.clientWidth,
                     sw: document.documentElement.scrollWidth }; }""")
        c_txt = contrast(e, "#tf-db-banner span")
        c_btn = contrast(e, "#tf-db-banner button")
        pal = e.evaluate("() => [document.documentElement.getAttribute('data-palette'), document.documentElement.getAttribute('data-theme')]")
        check("6a-4 375 px Sakura gelap: banner + tombol muat (tanpa geser), teks dan tombol terbaca (≥ 4,5)",
              pal == ["sakura", "dark"] and geo["left"] >= 0 and geo["right"] <= geo["cw"] + 0.5
              and geo["kRight"] <= geo["cw"] + 0.5 and geo["sw"] <= geo["cw"]
              and c_txt["ratio"] >= 4.5 and c_btn["ratio"] >= 4.5, repr((pal, geo, c_txt, c_btn)))
        shot(e, "6a-375-sakura-gelap-diperbarui.png")
        ce.close()
        ctxs.remove(ce)

        # ── 6b ──
        cf = new_context(browser, base, "F", pdir, idx_body)
        ctxs.append(cf)
        f1 = cf.new_page()
        watch(f1, "F-raw")
        f1.goto(base + "/manifest.json")
        prime_storage(f1, u1)
        held = f1.evaluate("""() => new Promise(res => { const rq = indexedDB.open('taskflow-offline', 5);
            rq.onupgradeneeded = () => {}; rq.onsuccess = () => { window.__hold = rq.result; res(rq.result.version); };
            rq.onerror = () => res('error'); })""")
        f2 = cf.new_page()
        watch(f2, "F")
        f2.goto(base + "/")
        fb = f2.locator("#tf-db-banner")
        try:
            fb.wait_for(state="visible", timeout=15000)
            ftxt = fb.inner_text()
        except PwTimeout:
            ftxt = ""
        check("6b-1 tab lama memegang DB v5 → tab app: banner 'Tutup tab Alurik lain untuk menyelesaikan pembaruan'",
              held == 5 and TEXT_BLOCKED in ftxt and fb.get_attribute("role") == "status"
              and fb.get_by_role("button").count() == 0, repr((held, ftxt)))
        fc = contrast(f2, "#tf-db-banner span")
        check("6b-2 banner blocked terbaca (≥ 4,5, terang)", fc and fc["ratio"] >= 4.5, repr(fc))
        shot(f2, "6b-blocked.png")
        f1.close()
        try:
            fb.wait_for(state="detached", timeout=15000)
            gone = True
        except PwTimeout:
            gone = False
        hd.wait_dashboard_ready(f2)
        goto_list(f2, WS, T2)
        ver = f2.evaluate("() => window.TF.db.openDB().then(db => db.version)")
        check("6b-3 tab lama ditutup → banner hilang, upgrade v6 lanjut, daftar task tampil",
              gone and ver == 6 and f2.locator(".task-row", has_text=T2).count() >= 1, "ver=%r" % ver)
        shot(f2, "6b-setelah-tab-lama-ditutup.png")
        cf.close()
        ctxs.remove(cf)

        # ── 7 ──
        a.evaluate("() => { localStorage.setItem('tf_palette', 'sakura'); localStorage.setItem('tf_theme', 'dark'); }")
        a.reload()
        a.locator(".dash-hero-greet").wait_for(state="visible", timeout=30000)
        wait_sync(a)
        goto_list(a, WS, T2)
        a.set_viewport_size(hd.MOBILE)
        a.wait_for_timeout(1000)
        vb = view_btn(a, "Demo")
        geo7 = no_hscroll(a)
        bx = vb.bounding_box() if vb.count() and vb.is_visible() else None
        nb = view_btn(a, "Normal")
        nvis = nb.count() > 0 and nb.is_visible()
        check("7a 375 px slist_*: tombol view (termasuk Demo) tanpa geser horizontal halaman, Demo tampil bila Normal tampil",
              geo7["sw"] <= geo7["cw"] and (bx is None or bx["x"] + bx["width"] <= geo7["cw"] + 0.5)
              and (bx is not None) == nvis, repr((geo7, bx, "Normal tampil=%s" % nvis)))
        shot(a, "7-375-sakura-gelap-workspace.png")
        a.set_viewport_size(hd.DESKTOP)
        a.wait_for_timeout(600)
        vb.wait_for(state="visible", timeout=10000)
        c_off = contrast(a, ".tl-view-btn[aria-label='Demo']")
        vb.click()
        a.locator(".tf-plugin-view .demo-ext-board").wait_for(state="visible", timeout=10000)
        c_on = contrast(a, ".tl-view-btn[aria-label='Demo']")
        c_norm = contrast(a, ".tl-view-btn[aria-label='Normal']")
        check("7b Sakura gelap: tombol Demo terbaca (tidak aktif dan aktif ≥ 3, setara tombol inti)",
              c_off["ratio"] >= 3 and c_on["ratio"] >= 3, repr((c_off, c_on, c_norm)))
        shot(a, "7-sakura-gelap-demo.png")
        a.locator("button[aria-label='Normal']").click()

        allowed = re.compile(r"Failed to load resource|net::ERR_|DB_UPGRADED_ELSEWHERE|openDB blocked"
                             r"|\[plugins\] .*demo-ext.*(gagal|tidak)|plugin\.js")
        bad = [(dv, t, x[:200]) for dv, t, x in console_log if t in ("error", "pageerror") and not allowed.search(x)]
        check("7c konsol tanpa error selain yang disengaja (404 plugin.js, offline, DB di-upgrade tab lain)",
              not bad, repr(bad[:6]))
        warn = [(dv, x[:200]) for dv, t, x in console_log if t == "warning" and re.search(r"plugin|taskext|ext_", x, re.I)
                and not allowed.search(x)]
        check("7d konsol tanpa peringatan plugin/ext yang tak terduga", not warn, repr(warn[:6]))
    finally:
        for cx in ctxs:
            try:
                cx.close()
            except Exception:  # noqa: BLE001
                pass


def main():
    shutil.rmtree(SHOTS, ignore_errors=True)
    tmp = tempfile.mkdtemp(prefix="e2e_plugin_fase1_1a1_")
    pdir, idx = build_plugins(tmp)
    entry = next((x for x in idx["plugins"] if x["id"] == PID), None)
    assert entry and entry.get("permissions") == ["task.ext"] and entry.get("contributes"), entry
    idx_body = json.dumps(idx)
    proc, base = start_server(tmp, os.path.join(pdir, "index.json"))
    print("server", base, flush=True)
    try:
        u1 = hd.seed(base, username="ext1a1", display_name="Rani")
        u2 = hd.seed(base, username="ext1a2", display_name="Sari")
        ws_id = hd.api(base, u1, "POST", "/api/lists", json={"name": WS})["id"]
        with sqlite3.connect(os.path.join(tmp, "e2e.db")) as conn:
            conn.execute("INSERT INTO list_members (list_id, user_id, joined_at) VALUES (?,?,?)",
                         (ws_id, u2["id"], datetime.datetime.now().isoformat()))
        check("setup: U2 anggota W", any(x["id"] == ws_id for x in hd.api(base, u2, "GET", "/api/lists")))
        t1 = task_id(hd.api(base, u1, "POST", "/api/tasks", json={"title": T1, "list_id": ws_id, "gtd_status": "next", "priority": "P2"}))
        t2 = task_id(hd.api(base, u1, "POST", "/api/tasks", json={"title": T2, "list_id": ws_id, "gtd_status": "next", "priority": "P3"}))
        tp = task_id(hd.api(base, u1, "POST", "/api/tasks", json={"title": TP, "project": PROJ, "gtd_status": "next", "priority": "P3"}))
        st = hd.api(base, u1, "PUT", "/api/plugins/state/%s" % PID, json={"enabled": True})
        check("setup: demo-ext ON untuk U1 (server), task baru ext {}",
              st["state"]["enabled"] is True and hd.api(base, u1, "GET", "/api/tasks/%d" % t1)["ext"] == {}, repr(st))
        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            run(browser, base, u1, u2, {"t1": t1, "t2": t2, "tp": tp, "ws": ws_id}, pdir, idx_body)
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
                lines = [ln.rstrip() for ln in fh if re.search(r"plugin server|Traceback|ERROR|namespace", ln)]
            print("  log server (plugin/error): %r" % lines[:8], flush=True)
        shutil.rmtree(tmp, ignore_errors=True)
    failed = [r for r in hd.results if not r[1]]
    print("\n%d/%d cek lolos" % (len(hd.results) - len(failed), len(hd.results)), flush=True)
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
