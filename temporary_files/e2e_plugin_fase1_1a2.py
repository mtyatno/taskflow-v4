"""E2E sistem plugin Fase 1 — PR 1a-2: record plugin (`api.records`, `TF.pluginsync`, `GET/POST
/api/plugins/{id}/records`, IndexedDB v7). Rencana docs/superpowers/plans/2026-11-01-plugin-fase1-pr-1a-2.md Task 11.
Tidak dijalankan CI.

    python3 temporary_files/e2e_plugin_fase1_1a2.py

Server uvicorn lokal + DB sementara lewat aplikasi pembungkus `temporary_files/e2e_app_demo_records.py` (R23: indeks
plugin server = indeks nyata + `demo-ext` + `demo-records`, hasil `buildPlugins` ke direktori tmp). Klien mendapat
indeks yang sama dan file plugin contoh lewat `ctx.route` atas `/static/plugins/index.json` dan
`/static/plugins/demo-*/*`; konteks `service_workers="block"`. `static/plugins/` tidak disentuh. Tiap "perangkat" = satu
`browser.new_context` (IndexedDB terpisah). Sinkron: `window.__syncNow()` lalu tunggu `__syncState.running === false`.

Pengguna: U1 "rec1a1" (perangkat A dan B; pemilik workspace W "Ruang Demo" dan W2 "Ruang Ref"), U2 "rec1a2" (perangkat
C, anggota W). `demo-records` ON untuk U1 dan U2 lewat `PUT /api/plugins/state/demo-records`.

   1 bersama workspace: A tambah "halo" (menunggu sinkron) → sinkron → server list:W → C melihat → C Ubah → A, B ikut.
   2 offline penuh A: tambah 3, ubah satu 5×, hapus satu → view dari IndexedDB, _outbox 2 upsert + 1 delete →
     online → server = keadaan akhir, op plugin 0.
   3 LWW: A offline lebih lama vs C online lebih baru → A menampilkan versi C + "Perubahan kalah: X"; kebalikannya →
     server versi A.
   4 `$task`: A offline membuat task T di W2 (workspace kosong → T = context.tasks[0]) lalu "Tambah (ref)" →
     data `{"$task": <cid T>}` → online → server memuat id server T (integer), tanpa 422.
   5 keluar workspace: C offline menambah record W; U1 mengeluarkan U2 → C sinkron → record W hilang (termasuk yang
     tertunda, FORBIDDEN_SCOPE), sinkron berikut tanpa error; U2 masuk lagi → record W kembali.
   6 plugin OFF: C OFF dengan op tertunda → server menerima (K9); A mengubah → C tidak menarik; ON → versi baru.
   7 upgrade v6→v7 dengan data (task + op update + _meta) → app: versi 7, task tampil, op terkirim, store plugin ada.
   8 dua tab: (a) tab P kode 1a-1 (db.js v6 + handler) + tab Q v7 → P banner "diperbarui di tab lain", Q daftar task;
     (b) tab R v6 mentah tanpa handler → banner "Tutup tab Alurik lain…" → R ditutup → banner hilang, data tampil.
   9 jendela deploy: records → 404 {"detail": "Not Found"} → sinkron tanpa melempar, langkah lain jalan, op tetap;
     unroute → terkirim.
  10 ekspor: ZIP memuat plugin_states.json + plugin_records.json (record user dari halaman project, tanpa list:W).
  11 375 px Sakura gelap: view Demo Rec tanpa geser horizontal; konsol tanpa error tak terduga.
"""
import datetime
import io
import json
import os
import re
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import time
import zipfile

import requests
from playwright.sync_api import TimeoutError as PwTimeout, sync_playwright

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import e2e_hero_dashboard as hd  # noqa: E402

ROOT = hd.ROOT
SHOTS = os.path.join(ROOT, "temporary_files", "e2e_plugin_fase1_1a2")
PID = "demo-records"
FIXTURE_PIDS = ("demo-ext", "demo-records")
VIEW = "Demo Rec"
SWITCH = '[role=switch][aria-labelledby="plugin-name-%s"]' % PID
SUBTITLE = "Fitur opsional. Pilihanmu tersimpan di akun dan berlaku di semua perangkat."
WS = "Ruang Demo"
WS2 = "Ruang Ref"
PROJ = "Proyek Rec"
TW1 = "Tugas W satu"
TW2 = "Tugas W dua"
TP = "Tugas proyek rec"
TV = "Tugas v6"
TV_LOCAL = "Tugas v6 (diubah offline)"
TOFF = "Tugas T offline"
TEXT_BLOCKED = "Tutup tab Alurik lain untuk menyelesaikan pembaruan"
TEXT_ELSEWHERE = "Alurik diperbarui di tab lain. Muat ulang tab ini."
OLD_DB_JS = subprocess.run(["git", "show", "e6d9256:static/offline/db.js"], cwd=ROOT, check=True,
                           capture_output=True).stdout
V6_SCHEMA = json.load(open(os.path.join(ROOT, "tests", "fixtures", "idb_v6_schema.json"), encoding="utf-8"))

check = hd.check
console_log = []   # (perangkat, type, text)
rec_resp = []      # (perangkat, method, status, url) untuk /api/plugins/*/records


# ── build + server ────────────────────────────────────────────────────────────

def build_plugins(tmp):
    """static/plugins/<id> nyata + tests/fixtures/plugins/{demo-ext,demo-records} → <tmp>/plugins (buildPlugins)."""
    pdir = os.path.join(tmp, "plugins")
    os.makedirs(pdir)
    src = os.path.join(ROOT, "static", "plugins")
    for name in os.listdir(src):
        if os.path.isdir(os.path.join(src, name)) and not name.startswith("_"):
            shutil.copytree(os.path.join(src, name), os.path.join(pdir, name))
    for pid in FIXTURE_PIDS:
        shutil.copytree(os.path.join(ROOT, "tests", "fixtures", "plugins", pid), os.path.join(pdir, pid))
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
    proc = subprocess.Popen([hd.server_python(), "-m", "uvicorn", "e2e_app_demo_records:app", "--app-dir",
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


def server_recs(base, user):
    """Record hidup yang bisa dilihat `user` (tarik penuh, kursor kosong) → {id: record}."""
    r = hd.api(base, user, "GET", "/api/plugins/%s/records?limit=1000" % PID)
    return {x["id"]: x for x in r["items"] if not x.get("deleted")}


# ── perangkat ─────────────────────────────────────────────────────────────────

def shot(p, name):
    os.makedirs(SHOTS, exist_ok=True)
    p.screenshot(path=os.path.join(SHOTS, name), animations="disabled", caret="hide")


def plugin_routes(ctx, pdir, idx_body):
    def index_route(route):
        route.fulfill(status=200, content_type="application/json", body=idx_body)

    def file_route(route):
        m = re.search(r"/static/plugins/(demo-[a-z]+)/([^?]+)", route.request.url)
        path = os.path.join(pdir, m.group(1), m.group(2)) if m else ""
        if not path or not os.path.isfile(path):
            route.fulfill(status=404, content_type="text/plain", body="Not Found")
            return
        with open(path, "rb") as fh:
            body = fh.read()
        ctype = "text/css" if path.endswith(".css") else "application/javascript"
        route.fulfill(status=200, content_type=ctype, body=body)

    ctx.route(re.compile(r"/static/plugins/index\.json(\?.*)?$"), index_route)
    ctx.route(re.compile(r"/static/plugins/(%s)/" % "|".join(re.escape(x) for x in FIXTURE_PIDS)), file_route)


def prime_storage(p, user, palette="default", theme="light"):
    p.evaluate("""([t, u, tours, sw, pal, th]) => {
        if (t) { localStorage.setItem('tf_token', t); localStorage.setItem('tf_user_id', String(u)); }
        for (const pg of tours) localStorage.setItem('tf_tour_' + pg, '1');
        localStorage.setItem('tf_whatsnew_seen', sw); localStorage.setItem('tf_theme', th);
        localStorage.setItem('tf_palette', pal); localStorage.setItem('tf_liveedit', '0');
        localStorage.setItem('tf_dismiss_onboarding', '1'); localStorage.setItem('tf_shortcut_hint', '1');
    }""", [user["token"], user["id"], hd.TOURS, hd.sw_version(), palette, theme])


def new_context(browser, base, pdir, idx_body, viewport=None):
    ctx = browser.new_context(service_workers="block", viewport=viewport or hd.DESKTOP, timezone_id="Asia/Jakarta",
                              reduced_motion="reduce")
    ctx.route(re.compile(r"^(?!%s/)" % re.escape(base)), lambda route: route.abort())
    plugin_routes(ctx, pdir, idx_body)
    return ctx


def watch(p, label):
    p.on("dialog", lambda d: d.accept())
    p.on("console", lambda m: console_log.append((label, m.type, m.text)))
    p.on("pageerror", lambda e: console_log.append((label, "pageerror", str(e))))

    def on_resp(r):
        if re.search(r"/api/plugins/[^/]+/records", r.url):
            rec_resp.append((label, r.request.method, r.status, r.url))
    p.on("response", on_resp)


def new_device(browser, base, user, label, pdir, idx_body, palette="default", theme="light"):
    ctx = new_context(browser, base, pdir, idx_body)
    p = ctx.new_page()
    watch(p, label)
    p.goto(base + "/manifest.json")
    prime_storage(p, user, palette, theme)
    p.goto(base + "/")
    hd.wait_dashboard_ready(p)
    wait_sync(p)
    p.wait_for_function("pid => window.TF && window.TF.plugins && window.TF.plugins.isEnabled(pid)", arg=PID,
                        timeout=20000)
    p.evaluate("() => { window.__e2eNoReload = 1; }")
    return ctx, p


def wait_sync(p, timeout=30000):
    p.wait_for_function("() => window.__syncState && window.__syncState.running === false", timeout=timeout)


def sync_now(p):
    """→ 'ok' bila __syncNow() selesai tanpa melempar, selain itu 'err:<pesan>'."""
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
    if not link.first.is_visible() and top.count() and top.first.is_visible():
        top.first.click()
        p.wait_for_timeout(500)
    link.first.click()
    p.wait_for_timeout(500)


def goto_list(p, label, row_title=None):
    sidebar_click(p, label)
    if row_title:
        p.locator(".task-row", has_text=row_title).first.wait_for(state="visible", timeout=15000)


def view_btn(p, label):
    return p.locator(".tl-view-btn[aria-label='%s']" % label)


def open_rec_view(p, label):
    """Halaman workspace/project `label` › view "Demo Rec" (klik tombol bila belum aktif)."""
    goto_list(p, label)
    btn = view_btn(p, VIEW)
    btn.wait_for(state="visible", timeout=15000)
    if btn.get_attribute("aria-pressed") != "true":
        btn.click()
    p.locator(".tf-plugin-view .demo-records").wait_for(state="visible", timeout=15000)
    p.wait_for_timeout(300)


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


DOM_RECS = """() => Array.from(document.querySelectorAll('[data-testid=dr-item]')).map(li => {
    const s = li.querySelectorAll('span'); const txt = li.textContent;
    const m = txt.match(/\\(gagal: ([^)]*)\\)/);
    return { id: li.getAttribute('data-record-id'), text: s[0] ? s[0].textContent : '',
             pending: txt.includes('(menunggu sinkron)'), error: m ? m[1] : null }; })"""


def dom_recs(p):
    return {x["id"]: x for x in p.evaluate(DOM_RECS)}


def lost_lines(p):
    return p.evaluate("() => Array.from(document.querySelectorAll('[data-testid=dr-lost]')).map(e => e.textContent)")


def add_rec(p, text, ref=False):
    before = set(dom_recs(p))
    p.get_by_test_id("dr-input").fill(text)
    p.get_by_test_id("dr-add-ref" if ref else "dr-add").click()
    new = wait_until(lambda: [k for k, v in dom_recs(p).items() if k not in before and v["text"] == text], 10, 0.1)
    if not new:
        raise AssertionError("record %r tidak muncul di view" % text)
    return new[0]


def item(p, rid):
    return p.locator('[data-testid=dr-item][data-record-id="%s"]' % rid)


def edit_rec(p, rid):
    old = dom_recs(p)[rid]["text"]
    item(p, rid).get_by_test_id("dr-edit").click()
    ok = wait_until(lambda: dom_recs(p).get(rid, {}).get("text") == old + " ✓", 10, 0.1)
    if not ok:
        raise AssertionError("Ubah %s tidak tampil" % rid)


def del_rec(p, rid):
    item(p, rid).get_by_test_id("dr-del").click()
    item(p, rid).wait_for(state="detached", timeout=10000)


def api_put(p, rid, data, scope):
    return p.evaluate("""([pid, id, data, scope]) => window.TF.api.for(pid).records.put('note', id, data, { scope })
        .then(r => r, e => ({ error: String(e && e.message || e) }))""", [PID, rid, data, scope])


IDB_RECS = """pid => new Promise((res, rej) => { const rq = indexedDB.open('taskflow-offline');
    rq.onerror = () => rej(rq.error); rq.onsuccess = () => { const db = rq.result;
      if (!db.objectStoreNames.contains('plugin_records')) { db.close(); res(null); return; }
      const g = db.transaction('plugin_records').objectStore('plugin_records').getAll();
      g.onsuccess = () => { db.close(); res(g.result.filter(r => r.plugin_id === pid).map(r => ({ id: r.id, scope: r.scope,
        data: r.data, dirty: r.dirty, deleted: r.deleted, version: r.version, op_qid: r.op_qid,
        sync_error: r.sync_error || null }))); }; g.onerror = () => rej(g.error); }; })"""


def idb_recs(p):
    return {x["id"]: x for x in (p.evaluate(IDB_RECS, PID) or [])}


def outbox_ops(p, etype="plugin"):
    return p.evaluate("""t => new Promise(res => { const rq = indexedDB.open('taskflow-offline');
        rq.onsuccess = () => { const db = rq.result; const g = db.transaction('_outbox').objectStore('_outbox').getAll();
          g.onsuccess = () => { db.close(); res(g.result.filter(o => o.entity_type === t).map(o => [o.op, o.cid])); }; }; })""",
                      etype)


def idb_task_by_title(p, title):
    return p.evaluate("""t => new Promise(res => { const rq = indexedDB.open('taskflow-offline');
        rq.onsuccess = () => { const db = rq.result; const g = db.transaction('tasks').objectStore('tasks').getAll();
          g.onsuccess = () => { db.close(); const r = g.result.find(x => x && x.title === t && !x.deleted);
            res(r ? { cid: r.cid, server_id: r.server_id, dirty: r.dirty } : null); }; }; })""", title)


def cid_of(rid):
    return "%s/note/%s" % (PID, rid)


def no_hscroll(p):
    return p.evaluate("() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth })")


def resp_since(n, label=None):
    return [r for r in rec_resp[n:] if label is None or r[0] == label]


# ── skenario ──────────────────────────────────────────────────────────────────

def run(browser, base, u1, u2, ids, pdir, idx_body, db_path):
    ws_id, ws2_id = ids["ws"], ids["ws2"]
    scope_w = "list:%d" % ws_id
    ctxs = []
    try:
        ca, a = new_device(browser, base, u1, "A", pdir, idx_body)
        cb, b = new_device(browser, base, u1, "B", pdir, idx_body)
        cc, c = new_device(browser, base, u2, "C", pdir, idx_body)
        ctxs += [ca, cb, cc]

        # ── 1 bersama workspace ──
        open_rec_view(a, WS)
        check("1a A slist_W: view Demo Rec scope list:W",
              a.locator(".demo-records").get_attribute("data-scope") == scope_w,
              repr(a.locator(".demo-records").get_attribute("data-scope")))
        x = add_rec(a, "halo")
        pend = dom_recs(a)[x]["pending"]
        check("1b A Tambah 'halo' → item tampil '(menunggu sinkron)'", pend, repr(dom_recs(a).get(x)))
        shot(a, "1-A-menunggu-sinkron.png")
        sync_now(a)
        ok = wait_until(lambda: not dom_recs(a)[x]["pending"], 10, 0.2)
        srv = server_recs(base, u1).get(x)
        check("1c A sinkron → penanda hilang, server GET …/records memuat record scope list:W",
              ok and srv and srv["scope"] == scope_w and srv["data"]["text"] == "halo"
              and isinstance(srv["data"].get("task", {}).get("$task"), int), repr(srv))
        sync_now(c)
        open_rec_view(c, WS)
        cv = dom_recs(c).get(x)
        check("1d C (U2, anggota W) sinkron → 'halo' tampil di view C", cv and cv["text"] == "halo"
              and not cv["pending"], repr(cv))
        shot(c, "1-C-halo.png")
        edit_rec(c, x)
        sync_now(c)
        check("1e C Ubah → server 'halo ✓'", wait_until(lambda: server_recs(base, u1)[x]["data"]["text"] == "halo ✓", 10),
              repr(server_recs(base, u1).get(x)))
        sync_now(a)
        av = wait_until(lambda: (lambda r: r if r and r["text"] == "halo ✓" and not r["pending"] else None)(dom_recs(a).get(x)), 10, 0.2)
        check("1f A sinkron → 'halo ✓'", av is not None, repr(dom_recs(a).get(x)))
        sync_now(b)
        open_rec_view(b, WS)
        bv = dom_recs(b).get(x)
        check("1g B (perangkat kedua U1) sinkron → 'halo ✓'", bv and bv["text"] == "halo ✓", repr(bv))
        shot(b, "1-B-halo-centang.png")

        # ── 2 offline penuh ──
        go_offline(ca, a)
        try:
            r1 = add_rec(a, "dua-1")
            r2 = add_rec(a, "dua-2")
            r3 = add_rec(a, "dua-3")
            for _ in range(5):
                edit_rec(a, r1)
            del_rec(a, r2)
            dv = dom_recs(a)
            check("2a A offline: tambah 3, ubah satu 5×, hapus satu → view langsung benar (dari IndexedDB)",
                  dv.get(r1, {}).get("text") == "dua-1" + " ✓" * 5 and dv[r1]["pending"]
                  and dv.get(r3, {}).get("text") == "dua-3" and dv[r3]["pending"] and r2 not in dv, repr(dv))
            ops = sorted(outbox_ops(a))
            want = sorted([["upsert", cid_of(r1)], ["upsert", cid_of(r3)], ["delete", cid_of(r2)]])
            check("2b _outbox: tepat satu op plugin per record tersisa + satu op delete (coalescing)", ops == want,
                  repr(ops))
            ir = idb_recs(a)
            check("2c IndexedDB: record terhapus = tombstone lokal (deleted 1, dirty 1), belum dihapus keras",
                  ir.get(r2, {}).get("deleted") == 1 and ir[r2]["dirty"] == 1, repr(ir.get(r2)))
            shot(a, "2-A-offline.png")
        finally:
            go_online(ca, a)
        sync_now(a)
        st = wait_until(lambda: (lambda s: s if s.get(r1, {}).get("data", {}).get("text") == "dua-1" + " ✓" * 5
                                 and r3 in s and r2 not in s else None)(server_recs(base, u1)), 15)
        check("2d online → sinkron → server = keadaan akhir (dua-1 ✓×5, dua-3, tanpa dua-2)", st is not None,
              repr({k: v["data"].get("text") for k, v in server_recs(base, u1).items()}))
        ir = idb_recs(a)
        check("2e op plugin 0, tombstone dihapus keras, record bersih", outbox_ops(a) == [] and r2 not in ir
              and ir[r1]["dirty"] == 0 and ir[r3]["dirty"] == 0, repr((outbox_ops(a), ir.get(r2))))

        # ── 3 LWW ──
        sync_now(c)
        go_offline(ca, a)
        try:
            api_put(a, x, {"text": "lww-A-lama"}, scope_w)
            time.sleep(1.2)
            api_put(c, x, {"text": "lww-C-baru"}, scope_w)
            sync_now(c)
            check("3a C (online, lebih baru) → server 'lww-C-baru'",
                  wait_until(lambda: server_recs(base, u1)[x]["data"]["text"] == "lww-C-baru", 10))
        finally:
            go_online(ca, a)
        sync_now(a)
        av = wait_until(lambda: (lambda r: r if r and r["text"] == "lww-C-baru" else None)(dom_recs(a).get(x)), 10, 0.2)
        lost = lost_lines(a)
        check("3b A online + sinkron → A menampilkan versi C dan baris 'Perubahan kalah: X'",
              av is not None and ("Perubahan kalah: " + x) in lost, repr((dom_recs(a).get(x), lost)))
        check("3c server tetap versi C, A bersih (op plugin 0)",
              server_recs(base, u1)[x]["data"]["text"] == "lww-C-baru" and outbox_ops(a) == []
              and idb_recs(a)[x]["dirty"] == 0)
        shot(a, "3-A-perubahan-kalah.png")
        n_lost = len(lost)
        sync_now(c)
        go_offline(ca, a)
        try:
            api_put(c, x, {"text": "lww-C-lama"}, scope_w)
            sync_now(c)
            wait_until(lambda: server_recs(base, u1)[x]["data"]["text"] == "lww-C-lama", 10)
            time.sleep(1.2)
            api_put(a, x, {"text": "lww-A-baru"}, scope_w)
        finally:
            go_online(ca, a)
        sync_now(a)
        sv = wait_until(lambda: (lambda r: r if r["data"]["text"] == "lww-A-baru" else None)(server_recs(base, u1)[x]), 10)
        check("3d kebalikannya (A offline lebih baru) → server versi A, tanpa baris kalah baru",
              sv is not None and len(lost_lines(a)) == n_lost, repr((server_recs(base, u1)[x], lost_lines(a))))
        sync_now(c)
        check("3e C sinkron → versi A", wait_until(lambda: dom_recs(c).get(x, {}).get("text") == "lww-A-baru", 10, 0.2))

        # ── 4 $task ──
        n4 = len(rec_resp)
        go_offline(ca, a)
        try:
            a.evaluate("""([t, l]) => window.TF.taskroutes.buildTaskRouter().dispatch('POST', '/api/tasks',
                { title: t, list_id: l, gtd_status: 'next', priority: 'P1' })""", [TOFF, ws2_id])
            refresh_tasks(a)
            open_rec_view(a, WS2)
            tl = idb_task_by_title(a, TOFF)
            a.get_by_test_id("dr-add-ref").wait_for(state="visible", timeout=10000)
            enabled = a.get_by_test_id("dr-add-ref").is_enabled()
            rt = add_rec(a, "ref-T", ref=True)
            ir = idb_recs(a).get(rt)
            check("4a A offline: task T baru (tanpa id server) + 'Tambah (ref)' → data {'$task': <cid T>}",
                  tl and tl["server_id"] is None and enabled and ir
                  and ir["data"].get("task") == {"$task": tl["cid"]} and ir["scope"] == "list:%d" % ws2_id,
                  repr((tl, ir)))
            shot(a, "4-A-ref-offline.png")
        finally:
            go_online(ca, a)

        def ref_ok():
            sync_now(a)
            t = idb_task_by_title(a, TOFF)
            s = server_recs(base, u1).get(rt)
            return (t, s) if t and t["server_id"] and s and s["data"].get("task") == {"$task": t["server_id"]} else None
        got = wait_until(ref_ok, 20, 1)
        bad = [r for r in resp_since(n4) if r[2] == 422]
        check("4b online → server: data record memuat id server T (integer), tidak ada 422",
              got is not None and isinstance(got[1]["data"]["task"]["$task"], int) and not bad,
              repr((got, bad, server_recs(base, u1).get(rt))))
        check("4c op plugin dan task 0 setelah sinkron", outbox_ops(a) == [] and outbox_ops(a, "task") == [])

        # ── 5 keluar workspace ──
        open_rec_view(c, WS)
        go_offline(cc, c)
        try:
            cp = add_rec(c, "c-tertunda")
        finally:
            pass
        r = requests.delete(base + "/api/lists/%d/members/%d" % (ws_id, u2["id"]),
                            headers={"Authorization": "Bearer " + u1["token"]}, timeout=10)
        check("5a U1 mengeluarkan U2 dari W lewat API", r.status_code == 200, "%d %s" % (r.status_code, r.text[:120]))
        n5 = len(rec_resp)
        spied = []

        def spy(route):
            if route.request.method != "POST":
                route.fallback()
                return
            resp = route.fetch()
            try:
                spied.extend((x_.get("id"), x_.get("error")) for x_ in resp.json().get("results", []))
            except Exception:  # noqa: BLE001
                spied.append((None, "tak terbaca"))
            route.fulfill(response=resp)

        cc.route("**/api/plugins/*/records", spy)
        go_online(cc, c)
        sync_now(c)

        def gone():
            sync_now(c)
            ir = idb_recs(c)
            return ir if not [k for k, v in ir.items() if v["scope"] == scope_w] else None
        g5 = wait_until(gone, 20, 1)
        forb = [rr for rr in resp_since(n5, "C") if rr[1] == "POST"]
        check("5b C online + sinkron → semua record W hilang dari IndexedDB C (termasuk yang tertunda)",
              g5 is not None and cp not in (g5 or {}) and outbox_ops(c) == [],
              repr((idb_recs(c), outbox_ops(c), forb)))
        cc.unroute("**/api/plugins/*/records", spy)
        check("5c server menjawab FORBIDDEN_SCOPE untuk record tertunda; record tidak pernah sampai server",
              (cp, "FORBIDDEN_SCOPE") in spied and cp not in server_recs(base, u1), repr(spied))
        n5b = len(rec_resp)
        err0 = len([m for m in console_log if m[0] == "C" and m[1] in ("error", "pageerror")])
        sync_now(c)
        again = [rr for rr in resp_since(n5b, "C") if rr[1] == "POST" or rr[2] >= 400]
        err1 = len([m for m in console_log if m[0] == "C" and m[1] in ("error", "pageerror")])
        check("5d sinkron berikutnya: tanpa POST record berulang, tanpa respons ≥ 400, tanpa error konsol baru",
              not again and err1 == err0, repr((again, console_log[-3:])))
        shot(c, "5-C-dikeluarkan.png")
        with sqlite3.connect(db_path) as conn:
            conn.execute("INSERT INTO list_members (list_id, user_id, joined_at) VALUES (?,?,?)",
                         (ws_id, u2["id"], datetime.datetime.now().isoformat()))

        def back():
            sync_now(c)
            ir = idb_recs(c)
            return ir if x in ir and r1 in ir and r3 in ir else None
        g5b = wait_until(back, 20, 1)
        check("5e U2 ditambahkan lagi → sinkron → record W kembali (tarik penuh)", g5b is not None
              and g5b[x]["data"]["text"] == "lww-A-baru", repr(idb_recs(c)))

        # ── 6 plugin OFF ──
        c.evaluate("() => window.__refreshLists && window.__refreshLists()")
        c.reload()
        hd.wait_dashboard_ready(c)
        wait_sync(c)
        c.evaluate("() => { window.__e2eNoReload = 1; }")
        open_rec_view(c, WS)
        go_offline(cc, c)
        try:
            co = add_rec(c, "c-off")
            open_settings(c)
            c.locator(SWITCH).click()
            off = wait_switch(c, False)
            check("6a C offline: record tertunda + demo-records OFF (Pengaturan)",
                  off and idb_recs(c)[co]["dirty"] == 1 and ["upsert", cid_of(co)] in outbox_ops(c))
        finally:
            go_online(cc, c)
        sync_now(c)
        s6 = wait_until(lambda: server_recs(base, u1).get(co), 15)
        stc = wait_until(lambda: (hd.api(base, u2, "GET", "/api/plugins/state")["plugins"].get(PID) or {}).get("enabled") is False, 15)
        check("6b sinkron → server menerima record walau plugin OFF (K9), status OFF tersimpan",
              s6 is not None and s6["data"]["text"] == "c-off" and stc and outbox_ops(c) == [], repr(s6))
        sync_now(a)
        wait_until(lambda: co in idb_recs(a), 10)
        api_put(a, co, {"text": "c-off (A)"}, scope_w)
        sync_now(a)
        wait_until(lambda: server_recs(base, u1)[co]["data"]["text"] == "c-off (A)", 10)
        n6 = len(rec_resp)
        sync_now(c)
        pulls = [rr for rr in resp_since(n6, "C") if rr[1] == "GET"]
        check("6c A mengubah → C sinkron tanpa menarik (IndexedDB C tetap versi lama)",
              idb_recs(c)[co]["data"]["text"] == "c-off" and not pulls, repr((idb_recs(c)[co], pulls)))
        open_settings(c)
        c.locator(SWITCH).click()
        on = wait_switch(c, True)
        g6 = wait_until(lambda: (sync_now(c), idb_recs(c)[co]["data"]["text"] == "c-off (A)")[1], 15, 1)
        check("6d C menyalakan lagi → sinkron → versi baru", on and g6, repr(idb_recs(c).get(co)))
        wait_until(lambda: (hd.api(base, u2, "GET", "/api/plugins/state")["plugins"].get(PID) or {}).get("enabled") is True, 15)

        # ── 7 upgrade v6 → v7 dengan data ──
        dump = a.evaluate("""sid => new Promise(res => { const rq = indexedDB.open('taskflow-offline');
            rq.onsuccess = () => { const db = rq.result; const tx = db.transaction(['tasks', '_idmap', '_meta']);
              const out = {}; const t = tx.objectStore('tasks').getAll(); const m = tx.objectStore('_idmap').getAll();
              const mk = tx.objectStore('_meta').getAllKeys(); const mv = tx.objectStore('_meta').getAll();
              tx.oncomplete = () => { db.close(); const task = t.result.find(x => x.server_id === sid);
                res({ task, idmap: m.result.filter(x => task && x.cid === task.cid),
                      meta: mk.result.map((k, i) => [k, mv.result[i]]) }); }; }; })""", ids["tv"])
        check("7-0 data v6 dari perangkat A: task Tugas v6 + _idmap + _meta (sesi initial_sync:v1)",
              dump["task"] and dump["idmap"] and any(k == "initial_sync:v1" for k, _ in dump["meta"]),
              repr((dump["task"] and dump["task"].get("cid"), dump["idmap"], [k for k, _ in dump["meta"]])))
        cg = new_context(browser, base, pdir, idx_body)
        ctxs.append(cg)
        g = cg.new_page()
        watch(g, "G")
        g.goto(base + "/manifest.json")
        prime_storage(g, u1)
        made = g.evaluate("""([schema, dump, title]) => new Promise((res, rej) => {
            const rq = indexedDB.open('taskflow-offline', 6);
            rq.onupgradeneeded = (e) => { const db = e.target.result;
              for (const [name, def] of Object.entries(schema.stores)) { const o = {};
                if (def.keyPath !== null) o.keyPath = def.keyPath; if (def.autoIncrement) o.autoIncrement = true;
                const s = db.createObjectStore(name, o);
                for (const [n, d] of Object.entries(def.indexes)) s.createIndex(n, d.keyPath, { unique: d.unique, multiEntry: d.multiEntry }); } };
            rq.onerror = () => rej(rq.error);
            rq.onsuccess = () => { const db = rq.result;
              const tx = db.transaction(['tasks', '_idmap', '_meta', '_outbox'], 'readwrite');
              const t = Object.assign({}, dump.task, { title, dirty: 1, rev: (dump.task.rev || 0) + 1,
                updated_at: new Date().toISOString() });
              tx.objectStore('tasks').put(t);
              for (const m of dump.idmap) tx.objectStore('_idmap').put(m);
              for (const [k, v] of dump.meta) tx.objectStore('_meta').put(v, k);
              tx.objectStore('_outbox').add({ entity_type: 'task', op: 'update', cid: t.cid, payload: {}, ts: Date.now(), retries: 0 });
              tx.oncomplete = () => { const v = db.version; const names = Array.from(db.objectStoreNames); db.close(); res({ v, names }); };
              tx.onerror = () => rej(tx.error); }; })""", [V6_SCHEMA, dump, TV_LOCAL])
        check("7a tab /manifest.json: taskflow-offline v6 dari fixture (tanpa store plugin) + task + op update + _meta",
              made["v"] == 6 and "plugin_records" not in made["names"] and "tasks" in made["names"], repr(made["v"]))
        g.goto(base + "/")
        hd.wait_dashboard_ready(g)
        wait_sync(g)
        info = g.evaluate("""() => new Promise(res => { const rq = indexedDB.open('taskflow-offline');
            rq.onsuccess = () => { const db = rq.result; const out = { v: db.version, names: Array.from(db.objectStoreNames) };
              db.close(); res(out); }; })""")
        check("7b buka app (login U1) → indexedDB versi 7, store plugin_records + plugin_kv ada",
              info["v"] == 7 and "plugin_records" in info["names"] and "plugin_kv" in info["names"], repr(info))
        sv7 = wait_until(lambda: (sync_now(g), hd.api(base, u1, "GET", "/api/tasks/%d" % ids["tv"])["title"] == TV_LOCAL)[1], 20, 1)
        check("7c op task update dari v6 terkirim (server judul baru), outbox task kosong",
              sv7 and outbox_ops(g, "task") == [], repr(hd.api(base, u1, "GET", "/api/tasks/%d" % ids["tv"]).get("title")))
        refresh_tasks(g)
        try:
            goto_list(g, "Inbox", TV_LOCAL)
            shown = True
        except PwTimeout:
            shown = False
        check("7d task dari data v6 tampil di daftar", shown)
        shot(g, "7-G-setelah-upgrade-v7.png")
        cg.close()
        ctxs.remove(cg)

        # ── 8a tab kode 1a-1 (v6 + handler) + tab v7 ──
        cp8 = new_context(browser, base, pdir, idx_body)
        ctxs.append(cp8)
        pp = cp8.new_page()
        watch(pp, "P")
        pp.route("**/static/offline/db.js", lambda route: route.fulfill(status=200, content_type="application/javascript",
                                                                          body=OLD_DB_JS))
        pp.goto(base + "/manifest.json")
        prime_storage(pp, u1)
        pp.goto(base + "/")
        pp.locator(".dash-hero-greet").wait_for(state="visible", timeout=30000)
        wait_sync(pp)
        pv = pp.evaluate("() => window.TF.db.openDB().then(db => db.version, e => 'err:' + (e && e.message))")
        q = cp8.new_page()
        watch(q, "Q")
        q.goto(base + "/")
        hd.wait_dashboard_ready(q)
        wait_sync(q)
        ban = pp.locator("#tf-db-banner")
        try:
            ban.wait_for(state="visible", timeout=10000)
            btxt = ban.inner_text()
        except PwTimeout:
            btxt = ""
        check("8a-1 tab P (db.js 1a-1, v6) → tab Q v7: P menampilkan 'Alurik diperbarui di tab lain…' + 'Muat ulang'",
              pv == 6 and TEXT_ELSEWHERE in btxt and ban.get_by_role("button", name="Muat ulang").count() == 1,
              repr((pv, btxt)))
        shot(pp, "8a-P-diperbarui-di-tab-lain.png")
        goto_list(q, WS, TW1)
        qv = q.evaluate("() => window.TF.db.openDB().then(db => db.version)")
        check("8a-2 tab Q: versi 7, daftar task workspace tampil", qv == 7
              and q.locator(".task-row", has_text=TW1).count() >= 1, repr(qv))
        shot(q, "8a-Q-v7.png")
        cp8.close()
        ctxs.remove(cp8)

        # ── 8b tab v6 mentah tanpa handler ──
        cr = new_context(browser, base, pdir, idx_body)
        ctxs.append(cr)
        rr_ = cr.new_page()
        watch(rr_, "R-raw")
        rr_.goto(base + "/manifest.json")
        prime_storage(rr_, u1)
        held = rr_.evaluate("""schema => new Promise(res => { const rq = indexedDB.open('taskflow-offline', 6);
            rq.onupgradeneeded = (e) => { const db = e.target.result;
              for (const [name, def] of Object.entries(schema.stores)) { const o = {};
                if (def.keyPath !== null) o.keyPath = def.keyPath; if (def.autoIncrement) o.autoIncrement = true;
                const s = db.createObjectStore(name, o);
                for (const [n, d] of Object.entries(def.indexes)) s.createIndex(n, d.keyPath, { unique: d.unique, multiEntry: d.multiEntry }); } };
            rq.onsuccess = () => { window.__hold = rq.result; res(rq.result.version); };
            rq.onerror = () => res('error'); })""", V6_SCHEMA)
        r2p = cr.new_page()
        watch(r2p, "R")
        r2p.goto(base + "/")
        fb = r2p.locator("#tf-db-banner")
        try:
            fb.wait_for(state="visible", timeout=15000)
            ftxt = fb.inner_text()
        except PwTimeout:
            ftxt = ""
        check("8b-1 tab R memegang v6 mentah tanpa handler → app: 'Tutup tab Alurik lain untuk menyelesaikan pembaruan'",
              held == 6 and TEXT_BLOCKED in ftxt, repr((held, ftxt)))
        shot(r2p, "8b-blocked.png")
        rr_.close()
        try:
            fb.wait_for(state="detached", timeout=15000)
            fgone = True
        except PwTimeout:
            fgone = False
        hd.wait_dashboard_ready(r2p)
        goto_list(r2p, WS, TW1)
        rv = r2p.evaluate("() => window.TF.db.openDB().then(db => db.version)")
        check("8b-2 R ditutup → banner hilang, upgrade v7 lanjut, data tampil", fgone and rv == 7
              and r2p.locator(".task-row", has_text=TW1).count() >= 1, repr(rv))
        shot(r2p, "8b-setelah-tab-r-ditutup.png")
        cr.close()
        ctxs.remove(cr)

        # ── 9 jendela deploy ──
        hits = []

        def old_server(route):
            hits.append((route.request.method, route.request.url))
            route.fulfill(status=404, content_type="application/json", body=json.dumps({"detail": "Not Found"}))

        open_rec_view(a, WS)
        ca.route("**/api/plugins/*/records*", old_server)
        try:
            d9 = add_rec(a, "deploy-rec")
            a.evaluate("([id, t]) => window.TF.taskroutes.buildTaskRouter().dispatch('PUT', '/api/tasks/' + id, { title: t })",
                       [ids["tw2"], TW2 + " (deploy)"])
            a.wait_for_timeout(2000)
            res9 = sync_now(a)
            t9 = wait_until(lambda: hd.api(base, u1, "GET", "/api/tasks/%d" % ids["tw2"])["title"] == TW2 + " (deploy)", 10)
            ir = idb_recs(a).get(d9)
            check("9a records 404 tanpa kode → sinkron selesai tanpa melempar, langkah lain jalan (judul task terkirim)",
                  res9 == "ok" and t9 and any(h[0] == "POST" for h in hits) and any(h[0] == "GET" for h in hits),
                  repr((res9, t9, hits[:4])))
            check("9b op record tetap antre, record dirty tanpa sync_error",
                  ["upsert", cid_of(d9)] in outbox_ops(a) and ir and ir["dirty"] == 1 and not ir["sync_error"]
                  and d9 not in server_recs(base, u1), repr((outbox_ops(a), ir)))
            shot(a, "9-A-jendela-deploy.png")
        finally:
            ca.unroute("**/api/plugins/*/records*", old_server)
        g9 = wait_until(lambda: (sync_now(a), server_recs(base, u1).get(d9))[1], 15, 1)
        check("9c unroute → sinkron → terkirim, op plugin 0", g9 is not None and outbox_ops(a) == [], repr(outbox_ops(a)))

        # ── 10 ekspor ──
        open_rec_view(a, PROJ)
        sc10 = a.locator(".demo-records").get_attribute("data-scope")
        pr = add_rec(a, "catatan proyek")
        sync_now(a)
        wait_until(lambda: server_recs(base, u1).get(pr), 10)
        z = requests.get(base + "/api/export/download", headers={"Authorization": "Bearer " + u1["token"]}, timeout=30)
        names, precs, pstates = [], [], {}
        if z.status_code == 200:
            zf = zipfile.ZipFile(io.BytesIO(z.content))
            names = zf.namelist()
            if "plugin_records.json" in names:
                precs = json.loads(zf.read("plugin_records.json"))
            if "plugin_states.json" in names:
                pstates = json.loads(zf.read("plugin_states.json"))
        check("10a GET /api/export/download → ZIP memuat plugin_states.json dan plugin_records.json",
              z.status_code == 200 and "plugin_states.json" in names and "plugin_records.json" in names,
              "%d %r" % (z.status_code, [n for n in names if "plugin" in n]))
        mine = [r_ for r_ in precs if r_.get("id") == pr]
        check("10b plugin_records.json: record user dari halaman project, tanpa record W",
              sc10 == "user" and len(mine) == 1 and mine[0]["plugin_id"] == PID and mine[0]["scope"] == "user"
              and mine[0]["data"]["text"] == "catatan proyek"
              and not [r_ for r_ in precs if str(r_.get("scope", "")).startswith("list:")], repr(precs))
        check("10c plugin_states.json memuat demo-records ON", json.dumps(pstates).find(PID) >= 0, repr(pstates)[:200])

        # ── 11 375 px + Sakura gelap ──
        a.evaluate("() => { localStorage.setItem('tf_palette', 'sakura'); localStorage.setItem('tf_theme', 'dark'); }")
        a.reload()
        a.locator(".dash-hero-greet").wait_for(state="visible", timeout=30000)
        wait_sync(a)
        open_rec_view(a, WS)
        a.set_viewport_size(hd.MOBILE)
        a.wait_for_timeout(1000)
        geo = no_hscroll(a)
        box = a.locator(".demo-records").bounding_box()
        pal = a.evaluate("() => [document.documentElement.getAttribute('data-palette'), document.documentElement.getAttribute('data-theme')]")
        check("11a 375 px Sakura gelap: view Demo Rec tanpa gulir horizontal halaman",
              pal == ["sakura", "dark"] and geo["sw"] <= geo["cw"] and box and box["x"] + box["width"] <= geo["cw"] + 0.5,
              repr((pal, geo, box)))
        shot(a, "11-375-sakura-gelap-demo-rec.png")
        a.set_viewport_size(hd.DESKTOP)

        allowed = re.compile(r"Failed to load resource|net::ERR_|DB_UPGRADED_ELSEWHERE|openDB blocked")
        # Tab P memakai db.js 1a-1 (v6, tanpa store plugin) dengan kode 1a-2 lainnya: galat store plugin di sana disengaja.
        allowed_p = re.compile(r"plugin_records|plugin_kv|object stores? (was|were) not found|NotFoundError")
        bad = [(dv, t, x_[:200]) for dv, t, x_ in console_log if t in ("error", "pageerror") and not allowed.search(x_)
               and not (dv == "P" and allowed_p.search(x_))]
        tolerated_p = [x_[:120] for dv, t, x_ in console_log if dv == "P" and t in ("error", "pageerror")
                       and not allowed.search(x_)]
        check("11b konsol tanpa error selain yang disengaja (404 jendela deploy, offline, DB di-upgrade tab lain)",
              not bad, repr(bad[:6]) if bad else "galat store plugin di tab P (db.js 1a-1) ditoleransi: %d %r"
              % (len(tolerated_p), tolerated_p[:3]))
        warn = [(dv, x_[:200]) for dv, t, x_ in console_log if t == "warning" and re.search(r"plugin|record", x_, re.I)
                and not allowed.search(x_) and dv != "P"]
        check("11c konsol tanpa peringatan plugin/record yang tak terduga", not warn, repr(warn[:6]))
    finally:
        for cx in ctxs:
            try:
                cx.close()
            except Exception:  # noqa: BLE001
                pass


def main():
    shutil.rmtree(SHOTS, ignore_errors=True)
    tmp = tempfile.mkdtemp(prefix="e2e_plugin_fase1_1a2_")
    pdir, idx = build_plugins(tmp)
    entry = next((x for x in idx["plugins"] if x["id"] == PID), None)
    assert entry and entry.get("permissions") == ["records"] and "note" in (entry.get("records") or {}), entry
    idx_body = json.dumps(idx)
    db_path = os.path.join(tmp, "e2e.db")
    proc, base = start_server(tmp, os.path.join(pdir, "index.json"))
    print("server", base, flush=True)
    try:
        u1 = hd.seed(base, username="rec1a1", display_name="Rani")
        u2 = hd.seed(base, username="rec1a2", display_name="Sari")
        ws_id = hd.api(base, u1, "POST", "/api/lists", json={"name": WS})["id"]
        ws2_id = hd.api(base, u1, "POST", "/api/lists", json={"name": WS2})["id"]
        with sqlite3.connect(db_path) as conn:
            conn.execute("INSERT INTO list_members (list_id, user_id, joined_at) VALUES (?,?,?)",
                         (ws_id, u2["id"], datetime.datetime.now().isoformat()))
        check("setup: U2 anggota W", any(x["id"] == ws_id for x in hd.api(base, u2, "GET", "/api/lists")))
        tw1 = task_id(hd.api(base, u1, "POST", "/api/tasks", json={"title": TW1, "list_id": ws_id, "gtd_status": "next", "priority": "P2"}))
        tw2 = task_id(hd.api(base, u1, "POST", "/api/tasks", json={"title": TW2, "list_id": ws_id, "gtd_status": "next", "priority": "P3"}))
        task_id(hd.api(base, u1, "POST", "/api/tasks", json={"title": TP, "project": PROJ, "gtd_status": "next", "priority": "P3"}))
        tv = task_id(hd.api(base, u1, "POST", "/api/tasks", json={"title": TV, "gtd_status": "inbox", "priority": "P3"}))
        s1 = hd.api(base, u1, "PUT", "/api/plugins/state/%s" % PID, json={"enabled": True})
        s2 = hd.api(base, u2, "PUT", "/api/plugins/state/%s" % PID, json={"enabled": True})
        check("setup: demo-records ON untuk U1 dan U2 (server)", s1["state"]["enabled"] is True
              and s2["state"]["enabled"] is True, repr((s1, s2)))
        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            run(browser, base, u1, u2, {"ws": ws_id, "ws2": ws2_id, "tw1": tw1, "tw2": tw2, "tv": tv}, pdir, idx_body,
                db_path)
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
                lines = [ln.rstrip() for ln in fh if re.search(r"plugin server|Traceback|ERROR|plugin_records", ln)]
            print("  log server (plugin/error): %r" % lines[:8], flush=True)
        shutil.rmtree(tmp, ignore_errors=True)
    failed = [r for r in hd.results if not r[1]]
    print("\n%d/%d cek lolos" % (len(hd.results) - len(failed), len(hd.results)), flush=True)
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
