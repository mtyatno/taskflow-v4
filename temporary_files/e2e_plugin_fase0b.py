"""E2E sistem plugin Fase 0b — PR B: status plugin per akun, dua perangkat (spec
docs/superpowers/specs/2026-10-31-plugin-fase0b-design.md §8, §9.3; rencana
docs/superpowers/plans/2026-10-31-plugin-fase0b-pr-b.md Task 13). Tidak dijalankan CI.

    python3 temporary_files/e2e_plugin_fase0b.py

Server uvicorn lokal + DB sementara + Chromium (Playwright). Tiap "perangkat" = satu `browser.new_context`
(service worker diizinkan, IndexedDB terpisah). Sinkron dipicu `window.__syncNow()` lalu ditunggu
`window.__syncState.running === false`. Pengguna (semua di-seed `e2e_hero_dashboard.seed` supaya Dashboard siap):
  U1 "plugin0b" (perangkat A dan B), U2 "plugin0b2" (perangkat C1, C2 — lebur pertama tanpa baris server),
  U3 "plugin0b3" (akun lain yang login di B — skenario 5).

Urutan skenario (6 dijalankan sebelum 5 karena 5 mengganti akun di B):
  1 A ON → B sinkron → B ON tanpa reload + kartu Dashboard; server enabled true.
  2 B offline: OFF + toggle bolak-balik → tetap satu op; online → A sinkron → A OFF.
  3 jendela deploy (rute status 404 generik) di A: toggle ON tetap antre, sinkron lain tetap jalan; rute kembali → server ON.
  4 Q1a: (a) cache 0a ON lama vs server OFF eksplisit → OFF; (b) cache 0a ON, server tanpa baris → server ON, perangkat lain ON.
  6 error di A → diredam hanya di A; B tetap ON; sinkron tidak menyalakan; "Aktifkan lagi" → kartu kembali.
  5 logout B → login U3 → status U3 diadopsi, tanpa PUT; (b) cache milik U1 tertinggal (clearAll gagal) → dibuang.
  7 375 px Pengaturan tanpa geser horizontal; konsol tanpa error selain yang disengaja.
"""
import datetime
import os
import re
import shutil
import subprocess
import sys
import tempfile

import requests
from playwright.sync_api import TimeoutError as PwTimeout, sync_playwright

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import e2e_hero_dashboard as hd  # noqa: E402

ROOT = hd.ROOT
SHOTS = os.path.join(ROOT, "temporary_files", "e2e_plugin_fase0b")
PID = "habit-heatmap"
NAME = "Heatmap Habit"
SWITCH = '[role=switch][aria-labelledby="plugin-name-%s"]' % PID
CARD = ".dash-plugins .plg-heatmap"
SUBTITLE = "Fitur opsional. Pilihanmu tersimpan di akun dan berlaku di semua perangkat."
PENDING = "Menunggu sinkron"
SUPPRESSED = "Dimatikan di perangkat ini karena error"

check = hd.check
console_log = []      # (perangkat, type, text)
state_puts = []       # (perangkat, url, auth) — PUT /api/plugins/state/* yang keluar dari perangkat


# ── server ────────────────────────────────────────────────────────────────────

def server_state(base, user):
    r = requests.get(base + "/api/plugins/state", headers={"Authorization": "Bearer " + user["token"]}, timeout=10)
    r.raise_for_status()
    return (r.json().get("plugins") or {}).get(PID)


def server_put(base, user, enabled, updated_at=None):
    body = {"enabled": enabled}
    if updated_at:
        body["updated_at"] = updated_at
    return hd.api(base, user, "PUT", "/api/plugins/state/%s" % PID, json=body)


def iso_days_ago(n):
    return (datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=n)).isoformat(timespec="milliseconds")


# ── perangkat ─────────────────────────────────────────────────────────────────

def shot(p, name):
    os.makedirs(SHOTS, exist_ok=True)
    p.screenshot(path=os.path.join(SHOTS, name), animations="disabled", caret="hide")


def new_device(browser, base, user, label):
    ctx = browser.new_context(service_workers="allow", viewport=hd.DESKTOP, timezone_id="Asia/Jakarta",
                              reduced_motion="reduce")
    ctx.route(re.compile(r"^(?!%s/)" % re.escape(base)), lambda route: route.abort())
    ctx.on("request", lambda r: state_puts.append((label, r.url, r.headers.get("authorization", "")))
           if r.method == "PUT" and "/api/plugins/state/" in r.url else None)
    p = ctx.new_page()
    p.on("dialog", lambda d: d.accept())
    p.on("console", lambda m: console_log.append((label, m.type, m.text)))
    p.on("pageerror", lambda e: console_log.append((label, "pageerror", str(e))))
    p.goto(base + "/manifest.json")
    prime_storage(p, user)
    p.goto(base + "/")
    hd.wait_dashboard_ready(p)
    settle_sw(p, base)
    wait_sync(p)
    return ctx, p


def settle_sw(p, base):
    """Instalasi SW pertama memicu `controllerchange` → aplikasi memuat ulang dirinya. Tunggu SW mengendalikan
    halaman, lalu buka ulang sendiri supaya tidak ada reload susulan di tengah skenario."""
    for _ in range(3):
        try:
            p.wait_for_function("() => !!(navigator.serviceWorker && navigator.serviceWorker.controller)", timeout=60000)
            break
        except Exception:  # noqa: BLE001 — konteks hancur karena reload controllerchange; coba lagi
            p.wait_for_timeout(1000)
    p.wait_for_timeout(1500)
    p.goto(base + "/")
    hd.wait_dashboard_ready(p)


def prime_storage(p, user):
    p.evaluate("""([t, u, tours, sw]) => {
        if (t) { localStorage.setItem('tf_token', t); localStorage.setItem('tf_user_id', String(u)); }
        for (const pg of tours) localStorage.setItem('tf_tour_' + pg, '1');
        localStorage.setItem('tf_whatsnew_seen', sw); localStorage.setItem('tf_theme', 'light');
        localStorage.setItem('tf_dismiss_onboarding', '1'); localStorage.setItem('tf_shortcut_hint', '1');
    }""", [user and user["token"], user and user["id"], hd.TOURS, hd.sw_version()])


def wait_sync(p, timeout=30000):
    p.wait_for_function("() => window.__syncState && window.__syncState.running === false", timeout=timeout)


def sync_now(p):
    p.evaluate("() => Promise.resolve(window.__syncNow && window.__syncNow()).catch(() => null)")
    wait_sync(p)
    p.wait_for_timeout(300)


def nav(p, label):
    link = p.locator(".sidebar-link").filter(has_text=label).first
    if not link.is_visible():
        top = p.locator(".mobile-topbar button")
        if top.count() and top.first.is_visible():
            top.first.click()
            p.wait_for_timeout(500)
        elif p.locator("button[aria-label='Tampilkan semua menu']").count():
            p.locator("button[aria-label='Tampilkan semua menu']").first.click()
    link.click()


def open_settings(p):
    nav(p, "Pengaturan")
    p.get_by_text(SUBTITLE).wait_for(state="visible", timeout=20000)
    p.locator(SWITCH).scroll_into_view_if_needed()


def open_dashboard(p):
    nav(p, "Dashboard")
    p.locator(".dash-hero-greet").wait_for(state="visible", timeout=20000)
    p.wait_for_timeout(800)


def plugin_row(p):
    return p.locator(".theme-card-decor").filter(has=p.locator(SWITCH)).first


def row_text(p):
    return plugin_row(p).inner_text().replace("\n", " | ")


def switch_on(p):
    return p.locator(SWITCH).get_attribute("aria-checked") == "true"


def wait_switch(p, on, timeout=10000):
    try:
        p.wait_for_function("([sel, v]) => { const s = document.querySelector(sel); return s && s.getAttribute('aria-checked') === v; }",
                            arg=[SWITCH, "true" if on else "false"], timeout=timeout)
        return True
    except PwTimeout:
        return False


def pending_visible(p):
    return plugin_row(p).get_by_text(PENDING, exact=True).count() > 0


def wait_pending(p, visible, timeout=15000):
    try:
        plugin_row(p).get_by_text(PENDING, exact=True).wait_for(state="visible" if visible else "detached", timeout=timeout)
        return True
    except PwTimeout:
        return False


def card_visible(p, timeout=10000):
    try:
        p.locator(CARD).wait_for(state="visible", timeout=timeout)
        return True
    except PwTimeout:
        return False


def wait_toast(p, text, timeout=8000):
    try:
        p.get_by_text(text, exact=True).first.wait_for(state="visible", timeout=timeout)
        return True
    except PwTimeout:
        return False


def outbox_ops(p):
    """Op `plugin_state` di `_outbox` IndexedDB perangkat."""
    return p.evaluate("""() => new Promise((res, rej) => { const rq = indexedDB.open('taskflow-offline');
        rq.onerror = () => rej(rq.error); rq.onsuccess = () => { const db = rq.result;
          const g = db.transaction('_outbox', 'readonly').objectStore('_outbox').getAll();
          g.onsuccess = () => { db.close(); res(g.result.filter(o => o.entity_type === 'plugin_state')
            .map(o => ({ qid: o.qid, cid: o.cid, payload: o.payload }))); }; g.onerror = () => rej(g.error); }; })""")


def wait_outbox_empty(p, timeout=15000):
    try:
        p.wait_for_function("""() => new Promise(res => { const rq = indexedDB.open('taskflow-offline');
            rq.onsuccess = () => { const db = rq.result; const g = db.transaction('_outbox').objectStore('_outbox').getAll();
              g.onsuccess = () => { db.close(); res(!g.result.some(o => o.entity_type === 'plugin_state')); }; }; })""",
                            timeout=timeout, polling=500)
        return True
    except PwTimeout:
        return False


def idb_has_task(p, title):
    return p.evaluate("""t => new Promise(res => { const rq = indexedDB.open('taskflow-offline');
        rq.onsuccess = () => { const db = rq.result; if (!db.objectStoreNames.contains('tasks')) { db.close(); return res(false); }
          const g = db.transaction('tasks').objectStore('tasks').getAll();
          g.onsuccess = () => { db.close(); res(g.result.some(x => x && x.title === t)); }; }; })""", title)


def write_cache_0a(p, enabled, updated_at, owner=None):
    """Cache bentuk 0a (atau milik `owner` lain) lalu runtime membaca ulang."""
    p.evaluate("""async ([pid, en, at, owner]) => {
        await window.TF.meta.metaSet('plugins:state:v1', { [pid]: { enabled: en, updatedAt: at } });
        if (owner == null) await window.TF.meta.metaDel('plugins:state:owner:v1');
        else await window.TF.meta.metaSet('plugins:state:owner:v1', String(owner));
        await window.TF.plugins.reloadState(); }""", [PID, enabled, updated_at, owner])


def is_enabled(p):
    return p.evaluate("pid => window.TF.plugins.isEnabled(pid)", PID)


def toggle(p):
    p.locator(SWITCH).click()


def toggle_and_push(p, want):
    """Toggle online lalu tunggu op-nya benar-benar terkirim (petunjuk muncul → outbox kosong → petunjuk hilang)."""
    toggle(p)
    ok = wait_switch(p, want)
    try:  # op sudah tertulis (push terjadwal baru berjalan ±1,5 s kemudian)
        plugin_row(p).get_by_text(PENDING, exact=True).wait_for(state="visible", timeout=1400)
    except PwTimeout:
        pass
    p.wait_for_timeout(300)
    return ok and wait_outbox_empty(p, 15000) and wait_pending(p, False, 5000)


def login_ui(p, username):
    p.locator("form input.input").first.wait_for(state="visible", timeout=20000)
    p.locator("form input.input").first.fill(username)
    p.locator("form input[type=password]").fill(hd.PW)
    p.locator("form button[type=submit]").first.click()


# ── skenario ──────────────────────────────────────────────────────────────────

def run(browser, base, u1, u2, u3):
    ctxs = []
    try:
        ca, a = new_device(browser, base, u1, "A")
        cb, b = new_device(browser, base, u1, "B")
        ctxs += [ca, cb]

        # ── 1 ──
        open_settings(a)
        open_settings(b)
        check("1a awal: A dan B Nonaktif, server tanpa baris", not switch_on(a) and not switch_on(b)
              and server_state(base, u1) is None, repr(server_state(base, u1)))
        toggle(a)
        on_a = wait_switch(a, True)
        pend_shown = wait_pending(a, True, 1400)
        shot(a, "1-A-on-menunggu-sinkron.png")
        pend_gone = wait_pending(a, False, 15000)
        check("1b A: switch ON, petunjuk 'Menunggu sinkron' tampil lalu hilang setelah push", on_a and pend_shown and pend_gone,
              "on=%s tampil=%s hilang=%s" % (on_a, pend_shown, pend_gone))
        st = server_state(base, u1)
        check("1c server GET /api/plugins/state → enabled true", st and st["enabled"] is True, repr(st))
        b.evaluate("() => { window.__e2eNoReload = 1; }")
        sync_now(b)
        on_b = wait_switch(b, True)
        check("1d B __syncNow → switch B aria-checked=true tanpa reload",
              on_b and b.evaluate("() => window.__e2eNoReload") == 1)
        shot(b, "1-B-on-setelah-sinkron.png")
        open_dashboard(b)
        check("1e Dashboard B merender .dash-plugins .plg-heatmap", card_visible(b, 15000)
              and b.evaluate("() => window.__e2eNoReload") == 1)
        shot(b, "1-B-dashboard.png")

        # ── 2 ──
        open_settings(b)
        cb.set_offline(True)
        try:
            b.wait_for_function("() => navigator.onLine === false", timeout=5000)
            toggle(b)
            off_b = wait_switch(b, False)
            pend_b = wait_pending(b, True, 5000)
            ops1 = outbox_ops(b)
            check("2a B offline: OFF, 'Menunggu sinkron', tepat satu op plugin_state",
                  off_b and pend_b and len(ops1) == 1 and ops1[0]["payload"].get("enabled") is False, repr(ops1))
            shot(b, "2-B-offline-off.png")
            for want in (True, False, True, False):
                toggle(b)
                wait_switch(b, want)
                b.wait_for_timeout(200)
            ops2 = outbox_ops(b)
            check("2b toggle ON→OFF→ON→OFF offline tetap satu op (niat terakhir OFF)",
                  len(ops2) == 1 and ops2[0]["payload"].get("enabled") is False and not switch_on(b)
                  and set(ops2[0]["payload"]) <= {"plugin_id", "enabled", "updated_at"}, repr(ops2))
            check("2c server belum berubah selama B offline", (server_state(base, u1) or {}).get("enabled") is True)
        finally:
            cb.set_offline(False)
        flushed = wait_outbox_empty(b, 20000)
        if not flushed:
            sync_now(b)
            flushed = wait_outbox_empty(b, 10000)
        pend_b_gone = wait_pending(b, False, 10000)
        st = server_state(base, u1)
        check("2d online → op terkirim, 'Menunggu sinkron' hilang, server enabled false",
              flushed and pend_b_gone and st and st["enabled"] is False, repr(st))
        sync_now(a)
        check("2e A __syncNow → A OFF", wait_switch(a, False))

        # ── 3 ──
        title3 = "E2E jendela deploy %s" % datetime.datetime.now().strftime("%H%M%S")
        hd.api(base, u1, "POST", "/api/tasks", json={"title": title3, "priority": "P3", "gtd_status": "next"})
        hits = []

        def fake_404(route):
            hits.append((route.request.method, route.request.url))
            route.fulfill(status=404, content_type="application/json", body='{"detail": "Not Found"}')

        ca.route("**/api/plugins/state**", fake_404)
        try:
            toggle(a)
            on3 = wait_switch(a, True)
            a.wait_for_timeout(2500)  # push terjadwal (1,5 s) ikut kena 404
            sync_now(a)
            ops3 = outbox_ops(a)
            sstate = a.evaluate("() => window.__syncState")
            st = server_state(base, u1)
            check("3a rute status 404 generik: toggle ON tetap antre (op ada, 'Menunggu sinkron')",
                  on3 and len(ops3) == 1 and ops3[0]["payload"].get("enabled") is True and pending_visible(a),
                  "ops=%r hits=%d" % (ops3, len(hits)))
            check("3b PUT/GET kena 404 tapi server tidak menerima apa pun (enabled tetap false)",
                  any(m == "PUT" for m, _ in hits) and any(m == "GET" for m, _ in hits) and st["enabled"] is False,
                  "hits=%r server=%r" % (sorted({m for m, _ in hits}), st))
            check("3c sinkron lain tetap jalan: lastFailed false, task baru dari server ada di IndexedDB A",
                  sstate and sstate.get("lastFailed") is False and idb_has_task(a, title3), repr(sstate))
            shot(a, "3-A-jendela-deploy.png")
        finally:
            ca.unroute("**/api/plugins/state**", fake_404)
        sync_now(a)
        gone3 = wait_outbox_empty(a, 15000)
        st = server_state(base, u1)
        check("3d rute kembali → __syncNow → op terkirim, server ON, petunjuk hilang",
              gone3 and st["enabled"] is True and wait_pending(a, False, 5000), repr(st))

        # ── 4a ──
        pushed = toggle_and_push(a, False)
        st_off = server_state(base, u1)
        check("4a-1 server OFF eksplisit hari ini (PUT dari A)", pushed and st_off["enabled"] is False, repr(st_off))
        sync_now(b)
        wait_switch(b, False)
        write_cache_0a(b, True, iso_days_ago(7))
        on4 = wait_switch(b, True, 5000)
        sync_now(b)
        off4 = wait_switch(b, False)
        wait_outbox_empty(b, 10000)
        st = server_state(base, u1)
        check("4a-2 cache 0a ON (7 hari lalu) vs server OFF hari ini → B OFF, server tetap OFF",
              on4 and off4 and st["enabled"] is False and st["updated_at"] == st_off["updated_at"],
              "sebelum-sinkron-ON=%s B-OFF=%s server=%r" % (on4, off4, st))
        owner = b.evaluate("() => window.TF.meta.metaGet('plugins:state:owner:v1')")
        check("4a-3 pemilik cache ditulis = id U1", str(owner) == str(u1["id"]), repr(owner))

        # ── 4b ──
        cc1, c1 = new_device(browser, base, u2, "C1")
        ctxs.append(cc1)
        check("4b-1 U2: server tanpa baris", server_state(base, u2) is None)
        open_settings(c1)
        write_cache_0a(c1, True, iso_days_ago(7))
        sync_now(c1)
        wait_outbox_empty(c1, 15000)
        st2 = server_state(base, u2)
        check("4b-2 cache 0a ON + server tanpa baris → lebur: server ON, C1 tetap ON",
              st2 and st2["enabled"] is True and switch_on(c1), repr(st2))
        cc2, c2 = new_device(browser, base, u2, "C2")
        ctxs.append(cc2)
        open_settings(c2)
        on_c2 = wait_switch(c2, True, 5000)
        open_dashboard(c2)
        check("4b-3 perangkat lain U2 (C2) ikut ON setelah sinkron + kartu Dashboard", on_c2 and card_visible(c2, 15000))
        shot(c2, "4b-C2-dashboard.png")
        cc2.close()
        cc1.close()
        ctxs = [x for x in ctxs if x not in (cc1, cc2)]

        # ── 6 ──
        check("6-0 A ON lagi (terkirim)", toggle_and_push(a, True) and server_state(base, u1)["enabled"] is True)
        sync_now(b)
        wait_switch(b, True)
        open_dashboard(a)
        card_visible(a, 15000)
        a.evaluate("pid => TF.plugins._debugThrow(pid)", PID)
        wait_toast(a, "Plugin %s mengalami error" % NAME, 5000)
        a.wait_for_timeout(400)
        a.evaluate("pid => TF.plugins._debugThrow(pid)", PID)
        t6 = wait_toast(a, "Plugin %s dimatikan karena error" % NAME, 5000)
        a.wait_for_timeout(500)
        acc = a.evaluate("pid => [TF.plugins.isEnabled(pid), TF.plugins.accountEnabled(pid)]", PID)
        check("6a A: dua error → padam di A (isEnabled false, status akun tetap true), Dashboard tanpa kartu",
              t6 and acc == [False, True] and a.locator(".dash-plugins").count() == 0, repr(acc))
        shot(a, "6-A-dashboard-diredam.png")
        ops6 = outbox_ops(a)
        st = server_state(base, u1)
        check("6b peredaman tidak mengantre op dan tidak mengubah server", not ops6 and st["enabled"] is True, repr((ops6, st)))
        open_settings(a)
        rt = row_text(a)
        check("6c Pengaturan A: 'Dimatikan di perangkat ini karena error' + 'Aktifkan lagi' + 'Salin detail'",
              SUPPRESSED in rt and plugin_row(a).get_by_role("button", name="Aktifkan lagi").count() == 1
              and plugin_row(a).get_by_role("button", name="Salin detail").count() == 1, repr(rt))
        shot(a, "6-A-pengaturan-diredam.png")
        sync_now(b)
        open_dashboard(b)
        check("6d B tetap ON setelah __syncNow (kartu tampil)", is_enabled(b) and card_visible(b, 15000))
        sync_now(a)
        a.wait_for_timeout(500)
        check("6e A __syncNow tidak menyalakannya lagi", is_enabled(a) is False and SUPPRESSED in row_text(a), repr(row_text(a)))
        plugin_row(a).get_by_role("button", name="Aktifkan lagi").click()
        t6f = wait_toast(a, "Plugin %s diaktifkan" % NAME)
        open_dashboard(a)
        check("6f 'Aktifkan lagi' di A → toast + kartu kembali", t6f and card_visible(a, 15000) and is_enabled(a))
        wait_outbox_empty(a, 15000)
        sup = a.evaluate("() => window.TF.meta.metaGet('plugins:suppressed:v1')")
        check("6g peredaman lokal dihapus, server tetap ON", not (sup or {}).get(PID)
              and server_state(base, u1)["enabled"] is True, repr(sup))

        # ── 5 ──
        server_put(base, u3, False)
        st3_before = server_state(base, u3)
        open_settings(b)
        check("5-0 B (U1) ON sebelum logout; server U3 OFF eksplisit", switch_on(b) and st3_before["enabled"] is False)
        n_puts = len(state_puts)
        b.evaluate("() => window.__logout()")
        login_ui(b, "plugin0b3")
        b.locator(".dash-hero-greet").wait_for(state="visible", timeout=30000)
        prime_storage(b, None)
        wait_sync(b)
        sync_now(b)
        uid_b = b.evaluate("() => localStorage.getItem('tf_user_id')")
        open_settings(b)
        off5 = wait_switch(b, False)
        st3 = server_state(base, u3)
        puts5 = [x for x in state_puts[n_puts:] if x[0] == "B"]
        check("5a logout B → login U3 → status U3 (OFF) diadopsi, tanpa PUT status, server U3 tidak berubah",
              uid_b == str(u3["id"]) and off5 and not puts5 and st3 == st3_before,
              "uid=%s off=%s puts=%r server=%r" % (uid_b, off5, puts5, st3))
        open_dashboard(b)
        check("5b Dashboard U3 di B tanpa kartu plugin", b.locator(".dash-plugins").count() == 0)
        shot(b, "5-B-akun-lain.png")
        # clearAll gagal (simulasi): cache U1 ON tertinggal dengan owner U1 → pull membuang, tanpa PUT.
        n_puts = len(state_puts)
        write_cache_0a(b, True, datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="milliseconds"),
                       owner=u1["id"])
        sync_now(b)
        open_settings(b)
        off5c = wait_switch(b, False)
        puts5c = [x for x in state_puts[n_puts:] if x[0] == "B"]
        owner = b.evaluate("() => window.TF.meta.metaGet('plugins:state:owner:v1')")
        check("5c cache milik U1 tertinggal (owner berbeda) → dibuang, U3 tetap OFF, tanpa PUT, owner = U3",
              off5c and not puts5c and server_state(base, u3) == st3_before and str(owner) == str(u3["id"]),
              "off=%s puts=%r owner=%r" % (off5c, puts5c, owner))
        check("5d akun U1 tidak tersentuh oleh B setelah ganti akun", server_state(base, u1)["enabled"] is True)

        # ── 7 ──
        open_settings(a)
        a.set_viewport_size(hd.MOBILE)
        a.wait_for_timeout(800)
        geo = a.evaluate("""sel => { const de = document.documentElement; const row = document.querySelector(sel).closest('.theme-card');
            const r = row.getBoundingClientRect(); return { docSW: de.scrollWidth, docCW: de.clientWidth, right: r.right, width: r.width }; }""",
                         SWITCH)
        check("7a 375 px: kartu Pengaturan › Plugin tanpa geser horizontal",
              geo["docSW"] <= geo["docCW"] and geo["right"] <= geo["docCW"] + 0.5, repr(geo))
        plugin_row(a).scroll_into_view_if_needed()
        shot(a, "7-375-pengaturan.png")
        allowed = re.compile(r"Failed to load resource|_debugThrow|\[plugins\] plugin habit-heatmap gagal \(render\)"
                             r"|The above error occurred|React will try to recreate")
        bad = [(d, t, x[:160]) for d, t, x in console_log if t in ("error", "pageerror") and not allowed.search(x)]
        check("7b konsol tanpa error selain yang disengaja (404 rute status, offline, _debugThrow)", not bad, repr(bad[:6]))
        warn = [(d, x[:160]) for d, t, x in console_log if t == "warning" and re.search(r"plugin|pluginstate", x, re.I)
                and not allowed.search(x)]
        check("7c konsol tanpa peringatan plugin/pluginstate yang tak terduga", not warn, repr(warn[:6]))
    finally:
        for c in ctxs:
            try:
                c.close()
            except Exception:  # noqa: BLE001
                pass


def main():
    shutil.rmtree(SHOTS, ignore_errors=True)
    tmp = tempfile.mkdtemp(prefix="e2e_plugin_fase0b_")
    proc, base = hd.start_server(tmp)
    print("server", base, flush=True)
    try:
        u1 = hd.seed(base, username="plugin0b", display_name="Rani")
        u2 = hd.seed(base, username="plugin0b2", display_name="Sari")
        u3 = hd.seed(base, username="plugin0b3", display_name="Dewi")
        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            run(browser, base, u1, u2, u3)
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
                lines = [ln.rstrip() for ln in fh if re.search(r"plugin server|Traceback|ERROR", ln)]
            print("  log server (plugin/error): %r" % lines[:8], flush=True)
        shutil.rmtree(tmp, ignore_errors=True)
    failed = [r for r in hd.results if not r[1]]
    print("\n%d/%d cek lolos" % (len(hd.results) - len(failed), len(hd.results)), flush=True)
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
