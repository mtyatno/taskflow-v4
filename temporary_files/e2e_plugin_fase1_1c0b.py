"""E2E PR 1c-0b (waktu inti task: edit inti offline vs seret Timeline perangkat lain). Rencana
docs/superpowers/plans/2026-11-01-plugin-fase1-pr-1c-0b.md Task 4 (R13). Tidak dijalankan CI.

    TZ=Asia/Jakarta python3 temporary_files/e2e_plugin_fase1_1c0b.py

Memakai helper `e2e_plugin_fase1_1c0.py` (server uvicorn lokal `webapp:app` + DB sementara + Chromium; tiap
"perangkat" = satu `browser.new_context(service_workers="block")`, IndexedDB terpisah). Server mewarisi
`TZ=Asia/Jakarta` → cap waktu naif server tampak 7 jam lebih baru dari jam perangkat (S9), seperti zona VPS
Asia/Jakarta: aturan LWW lama selalu memenangkan server.

U1 "sx1" (perangkat A, A', A''; pemilik W "Ruang Rilis"), U2 "sx2" (perangkat B, anggota). Timeline ON keduanya,
T1–T4 di project "Rilis" berjadwal (`PUT ext_patch`). Semua PUT/DELETE task dicatat per perangkat.

   1 R2 inti: A offline ubah judul T1 (UI detail); B online seret T1 +2 → PUT {ext_patch}, core_updated_at tetap;
     A online → judul A sampai ke server, jadwal B utuh; IndexedDB A judul A + start B, bersih; daftar A judul A.
   2 KONTROL kode lama: A' dengan syncpull.js origin/main → ulangi 1 pada T2 → judul A' tertimpa.
   3 KONTROL server tanpa field (jendela deploy): A'' kode PR, respons tarik dilucuti core_updated_at → tertimpa.
   4 status + progress: A offline selesai T3 + progress T4 60; B seret T3, T4 → server keduanya + jadwal B.
   5 hapus (Q1 a): A offline hapus T4; B seret T4 → A online → T4 404 di server, hilang di daftar B.
   6 dua kali seret: core_updated_at tetap di kedua respons PUT B; A ubah judul online → core == updated.
   7 konflik inti sungguhan: A offline judul T2, B judul T2 online → server judul B (LWW tidak berubah).
   8 penulis lain (API /done) setelah seret → core == updated.
   9 konsol tanpa error tak terduga.
"""
import datetime
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time

import requests
from playwright.sync_api import TimeoutError as PwTimeout, sync_playwright

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import e2e_hero_dashboard as hd  # noqa: E402
import e2e_plugin_fase1_1c0 as c0  # noqa: E402

c0.OLD["static/offline/syncpull.js"] = c0.old_src("static/offline/syncpull.js")
c0.SHOTS = SHOTS = os.path.join(hd.ROOT, "temporary_files", "e2e_plugin_fase1_1c0b")

WS, PID, PULL_RE, FULL_KEYS = c0.WS, c0.PID, c0.PULL_RE, c0.FULL_KEYS
T1, T2, T3, T4 = c0.T1, c0.T2, c0.T3, c0.T4
check, info, nap, wait_until = hd.check, c0.info, c0.nap, c0.wait_until
server_task, start_of, idb_task, sync_now = c0.server_task, c0.start_of, c0.idb_task, c0.sync_now
go_offline, go_online, shift, shot = c0.go_offline, c0.go_online, c0.shift, c0.shot

deletes = []  # (perangkat, task_id, t)
_orig_watch = c0.watch


def watch(p, label):
    _orig_watch(p, label)

    def on_req(r):
        m = re.search(r"/api/tasks/(\d+)(\?.*)?$", r.url)
        if r.method == "DELETE" and m:
            deletes.append((label, int(m.group(1)), time.time()))
    p.on("request", on_req)


c0.watch = watch  # open_page memanggil c0.watch


def puts_since(label, tid, since):
    return c0.puts_for(label, tid, since)


def core(base, user, tid):
    t = server_task(base, user, tid)
    return {"title": t.get("title"), "updated_at": t.get("updated_at"), "core_updated_at": t.get("core_updated_at"),
            "gtd_status": t.get("gtd_status"), "progress": t.get("progress"), "raw": "ext_core_at" in t or "ext_only_at" in t}


def get_status(base, user, tid):
    return requests.get(base + "/api/tasks/%d" % tid, headers={"Authorization": "Bearer " + user["token"]}, timeout=10).status_code


def drag_put(p, label, tid, days):
    """Seret bar lalu tunggu PUT; kembalikan (body list, json respons PUT terakhir)."""
    resp = []

    def on_resp(r):
        if r.request.method == "PUT" and re.search(r"/api/tasks/%d(\?.*)?$" % tid, r.url):
            resp.append(r)
    p.on("response", on_resp)
    s0 = time.time()
    try:
        c0.drag_bar(p, tid, days)
        body = c0.wait_puts(label, tid, s0, settle=2.0)
        wait_until(lambda: len(resp) >= len(body), 10, 0.2)
    finally:
        p.remove_listener("response", on_resp)
    js = []
    for r in resp:
        try:
            js.append(r.json())
        except Exception:  # noqa: BLE001
            js.append(None)
    return body, js


def offline_title_vs_drag(base, u1, a_ctx, a, b, tid, new_title, label):
    """Inti skenario R2: A sinkron → offline → ubah judul (UI); B seret +2 → A online + sinkron. Kembalikan data."""
    old_title = server_task(base, u1, tid)["title"]
    sync_now(a)
    sync_now(b)
    c0.refresh_tasks(b)
    go_offline(a_ctx, a)
    c0.ui_set_title(a, WS, old_title, new_title)
    loc_off = idb_task(a, tid)
    before = core(base, u1, tid)
    st_old = start_of(base, u1, tid)
    c0.open_timeline(b, WS)
    body_b, resp_b = drag_put(b, "B", tid, 2)
    after_drag = core(base, u1, tid)
    s0 = time.time()
    go_online(a_ctx, a)
    sync_now(a)
    nap(1.5)
    sync_now(a)
    return {"old_title": old_title, "loc_off": loc_off, "before": before, "st_old": st_old, "want_start": shift(st_old, 2),
            "body_b": body_b, "resp_b": resp_b, "after_drag": after_drag, "puts_a": puts_since(label, tid, s0),
            "final": core(base, u1, tid), "start_final": start_of(base, u1, tid), "loc": idb_task(a, tid)}


def list_has(p, title, timeout=10000):
    try:
        c0.open_list(p, WS, title)
        return p.locator(".task-row", has_text=title).count() > 0
    except PwTimeout:
        return False


def strip_core(route):
    resp = route.fetch()
    try:
        data = resp.json()
    except Exception:  # noqa: BLE001
        return route.fulfill(response=resp)
    items = data if isinstance(data, list) else (data.get("tasks") if isinstance(data, dict) else None) or []
    for it in items:
        if isinstance(it, dict):
            it.pop("core_updated_at", None)
    STRIPPED.append(len(items))
    route.fulfill(response=resp, json=data)


STRIPPED = []


def run(browser, base, users, ids):
    u1, u2 = users["u1"], users["u2"]
    t1, t2, t3, t4 = ids["t1"], ids["t2"], ids["t3"], ids["t4"]
    ctxs = []
    try:
        ca, a = c0.new_device(browser, base, u1, "A")
        ctxs.append(ca)
        cb, b = c0.new_device(browser, base, u2, "B")
        ctxs.append(cb)

        # ── 1 R2 inti ──
        title1 = "Judul offline A"
        r = offline_title_vs_drag(base, u1, ca, a, b, t1, title1, "A")
        info("1 data", {k: r[k] for k in ("before", "after_drag", "final", "body_b", "puts_a", "loc")})
        check("1a A offline ubah judul T1 (UI detail) → IndexedDB A judul '%s', kotor" % title1,
              r["loc_off"] and r["loc_off"]["title"] == title1 and r["loc_off"]["dirty"], repr(r["loc_off"]))
        check("1b B seret T1 +2 → tepat SATU PUT {ext_patch} = {timeline.start: %s}" % r["want_start"],
              len(r["body_b"]) == 1 and set(r["body_b"][0] or {}) == {"ext_patch"}
              and r["body_b"][0]["ext_patch"] == {PID + ".start": r["want_start"]}, repr(r["body_b"]))
        bd, ad = r["before"], r["after_drag"]
        check("1c server setelah seret: judul lama '%s', updated_at naik, core_updated_at TETAP (%s); respons PUT memuat "
              "core_updated_at sama; kolom mentah tidak terekspos" % (r["old_title"], bd["core_updated_at"]),
              ad["title"] == r["old_title"] and ad["updated_at"] > bd["updated_at"]
              and ad["core_updated_at"] == bd["core_updated_at"] and bd["core_updated_at"]
              and r["resp_b"] and (r["resp_b"][-1] or {}).get("core_updated_at") == bd["core_updated_at"]
              and not ad["raw"], repr((bd, ad)))
        check("1d A online + sinkron → server judul '%s', timeline.start %s (seret B tidak kembali)" % (title1, r["want_start"]),
              r["final"]["title"] == title1 and r["start_final"] == r["want_start"], repr((r["final"], r["start_final"])))
        check("1e PUT A ke T1 penuh (FULL_KEYS) tanpa ext_patch, berjudul '%s'" % title1,
              r["puts_a"] and all(c0.is_full(x) and "ext_patch" not in x for x in r["puts_a"])
              and r["puts_a"][-1]["title"] == title1, repr(r["puts_a"]))
        check("1f IndexedDB A: judul A, ext timeline.start = nilai B, dirty 0",
              r["loc"] and r["loc"]["title"] == title1 and r["loc"]["start"] == r["want_start"] and r["loc"]["dirty"] == 0,
              repr(r["loc"]))
        c0.refresh_tasks(a)
        check("1g daftar A menampilkan '%s'" % title1, list_has(a, title1))
        shot(a, "1-A-judul-offline-menang.png")
        sync_now(b)
        c0.refresh_tasks(b)
        check("1h B tarik → judul A + jadwal B tetap", (idb_task(b, t1) or {}).get("title") == title1
              and (idb_task(b, t1) or {}).get("start") == r["want_start"], repr(idb_task(b, t1)))

        # ── 2 KONTROL kode lama (syncpull.js origin/main) ──
        served = []
        cp = c0.new_context(browser, base)
        ctxs.append(cp)
        c0.serve_old(cp, "static/offline/syncpull.js", served)
        ap = c0.open_page(cp, base, u1, "A'")
        title2 = "Judul offline A'"
        r = offline_title_vs_drag(base, u1, cp, ap, b, t2, title2, "A'")
        info("2 data", {k: r[k] for k in ("after_drag", "final", "puts_a", "loc")})
        reproduced = (r["final"]["title"] == r["old_title"] and r["loc"] and r["loc"]["title"] == r["old_title"]
                      and not any((x or {}).get("title") == title2 for x in r["puts_a"]))
        check("2a KONTROL syncpull.js origin/main (%d kali disajikan): A' offline ubah judul T2, B seret → judul A' "
              "TERTIMPA (server '%s', IndexedDB A' judul lama, tidak ada PUT judul A') — bug lama terreproduksi"
              % (len(served), r["old_title"]), served and r["loc_off"] and r["loc_off"]["title"] == title2 and reproduced,
              repr((r["final"], r["loc"], r["puts_a"])))
        if reproduced:
            print("INFO 2: bug lama (R2) terreproduksi dengan syncpull.js origin/main", flush=True)
        check("2b jadwal B di T2 tetap %s" % r["want_start"], r["start_final"] == r["want_start"])
        shot(ap, "2-Ap-kontrol-origin-main.png")
        if server_task(base, u1, t2)["title"] != T2:
            hd.api(base, u1, "PUT", "/api/tasks/%d" % t2, json={"title": T2})
        check("2c judul T2 server '%s' (dikembalikan lewat API bila perlu)" % T2, server_task(base, u1, t2)["title"] == T2)
        cp.close()
        ctxs.remove(cp)

        # ── 3 KONTROL server tanpa field (jendela deploy) ──
        cq = c0.new_context(browser, base)
        ctxs.append(cq)
        cq.route(PULL_RE, strip_core)
        aq = c0.open_page(cq, base, u1, "A''")
        title3 = "Judul offline A''"
        n_strip0 = len(STRIPPED)
        r = offline_title_vs_drag(base, u1, cq, aq, b, t3, title3, "A''")
        info("3 data", {k: r[k] for k in ("final", "puts_a", "loc")})
        check("3a KONTROL kode PR + respons tarik tanpa core_updated_at (%d respons dilucuti): judul A'' TERTIMPA "
              "(aturan lama: server '%s', IndexedDB judul lama, tidak ada PUT judul A'')" % (len(STRIPPED) - n_strip0,
                                                                                          r["old_title"]),
              len(STRIPPED) > n_strip0 and r["loc_off"] and r["loc_off"]["title"] == title3
              and r["final"]["title"] == r["old_title"] and r["loc"] and r["loc"]["title"] == r["old_title"]
              and not any((x or {}).get("title") == title3 for x in r["puts_a"]), repr((r["final"], r["loc"], r["puts_a"])))
        errs = [x for x in c0.console_log if x[0] == "A''" and x[1] in ("error", "pageerror")
                and not re.search(r"Failed to load resource|net::ERR_", x[2])]
        check("3b A'' tanpa error konsol (selain request offline; route fulfill, bukan abort)", not errs, repr(errs[:4]))
        cq.close()
        ctxs.remove(cq)

        # ── 4 status + progress ──
        sync_now(a)
        sync_now(b)
        c0.refresh_tasks(a)
        cur3 = server_task(base, u1, t3)["title"]
        go_offline(ca, a)
        c0.open_list(a, WS, cur3)
        a.locator(".task-row", has_text=cur3).first.locator(".check-btn").click()
        a.wait_for_timeout(800)
        rp = c0.dispatch(a, "PUT", "/api/tasks/%d" % t4, {"progress": 60})
        l3, l4 = idb_task(a, t3), idb_task(a, t4)
        check("4a A offline: T3 selesai (checkbox baris), T4 progress 60 (rute lokal) → lokal kotor",
              rp == "ok" and l3 and l3["gtd_status"] == "done" and l3["dirty"] and l4 and l4["progress"] == 60 and l4["dirty"],
              repr((rp, l3, l4)))
        c0.refresh_tasks(b)
        c0.open_timeline(b, WS)
        st3, st4 = start_of(base, u1, t3), start_of(base, u1, t4)
        b3, _ = drag_put(b, "B", t3, 2)
        b4, _ = drag_put(b, "B", t4, 2)
        check("4b B seret T3 dan T4 → masing-masing satu PUT {ext_patch}",
              len(b3) == 1 and set(b3[0]) == {"ext_patch"} and len(b4) == 1 and set(b4[0]) == {"ext_patch"}, repr((b3, b4)))
        go_online(ca, a)
        sync_now(a)
        nap(1.0)
        sync_now(a)
        s3, s4 = core(base, u1, t3), core(base, u1, t4)
        check("4c server: T3 selesai, T4 progress 60, jadwal B utuh (T3 %s, T4 %s)" % (shift(st3, 2), shift(st4, 2)),
              s3["gtd_status"] == "done" and s4["progress"] == 60 and start_of(base, u1, t3) == shift(st3, 2)
              and start_of(base, u1, t4) == shift(st4, 2), repr((s3, s4, start_of(base, u1, t3), start_of(base, u1, t4))))

        # ── 5 hapus (Q1 a) ──
        sync_now(a)
        sync_now(b)
        go_offline(ca, a)
        rd = c0.dispatch(a, "DELETE", "/api/tasks/%d" % t4)
        c0.refresh_tasks(b)
        c0.open_timeline(b, WS)
        b5, _ = drag_put(b, "B", t4, 2)
        check("5a A offline hapus T4 (rute lokal); B seret T4 → satu PUT {ext_patch}, T4 masih ada di server",
              rd == "ok" and len(b5) == 1 and set(b5[0]) == {"ext_patch"} and get_status(base, u1, t4) == 200,
              repr((rd, b5)))
        s0 = time.time()
        go_online(ca, a)
        sync_now(a)
        nap(1.0)
        sync_now(a)
        dels = [x for x in deletes if x[0] == "A" and x[1] == t4 and x[2] >= s0]
        check("5b A online → DELETE T4 terkirim, GET /api/tasks/T4 → 404 (penghapusan A menang, Q1 a)",
              dels and wait_until(lambda: get_status(base, u1, t4) == 404, 10), "deletes=%d status=%d"
              % (len(dels), get_status(base, u1, t4)))
        sync_now(a)
        check("5c task T4 tidak hidup lagi di A (IndexedDB tanpa baris aktif)", idb_task(a, t4) is None
              or a.evaluate("""async (sid) => { const db = await TF.db.openDB(); const all = await new Promise((res) => {
                  const q = db.transaction('tasks').objectStore('tasks').getAll(); q.onsuccess = () => res(q.result); });
                  const r = all.find(x => x.server_id === sid); return !r || !!r.deleted; }""", t4), repr(idb_task(a, t4)))
        sync_now(b)
        c0.refresh_tasks(b)
        t4_title = T4
        b_rows = c0.open_list(b, WS, server_task(base, u1, t1)["title"]) or b.locator(".task-row", has_text=t4_title).count()
        check("5d B sinkron → T4 tidak ada di IndexedDB/daftar B", idb_task(b, t4) is None and b_rows == 0,
              repr((idb_task(b, t4), b_rows)))
        shot(b, "5-B-daftar-tanpa-T4.png")

        # ── 6 dua kali seret ──
        sync_now(b)
        c0.refresh_tasks(b)
        c0.open_timeline(b, WS)
        c_before = core(base, u1, t1)
        _, j1 = drag_put(b, "B", t1, 1)
        _, j2 = drag_put(b, "B", t1, 1)
        cs = [(x or {}).get("core_updated_at") for x in j1 + j2]
        us = [(x or {}).get("updated_at") for x in j1 + j2]
        check("6a B seret T1 dua kali → core_updated_at tetap %s di kedua respons PUT, updated_at naik" % c_before["core_updated_at"],
              len(cs) == 2 and cs == [c_before["core_updated_at"]] * 2 and us[0] > c_before["updated_at"] and us[1] > us[0],
              repr((c_before, cs, us)))
        sync_now(a)
        c0.refresh_tasks(a)
        c0.ui_set_title(a, WS, server_task(base, u1, t1)["title"], "Judul online A")
        ok6 = wait_until(lambda: server_task(base, u1, t1)["title"] == "Judul online A", 15)
        c6 = core(base, u1, t1)
        check("6b A ubah judul online → core_updated_at == updated_at", ok6 and c6["core_updated_at"] == c6["updated_at"],
              repr(c6))

        # ── 7 konflik inti sungguhan ──
        sync_now(a)
        sync_now(b)
        c0.refresh_tasks(b)
        go_offline(ca, a)
        r7 = c0.dispatch(a, "PUT", "/api/tasks/%d" % t2, {"title": "Migrasi offline A"})
        nap(1.0)
        c0.ui_set_title(b, WS, T2, "Migrasi online B")
        ok7 = wait_until(lambda: server_task(base, u1, t2)["title"] == "Migrasi online B", 15)
        go_online(ca, a)
        sync_now(a)
        nap(1.0)
        sync_now(a)
        check("7a A offline judul T2, B judul T2 online (lebih baru) → A online → server judul B (LWW tidak berubah), "
              "IndexedDB A judul B", r7 == "ok" and ok7 and server_task(base, u1, t2)["title"] == "Migrasi online B"
              and (idb_task(a, t2) or {}).get("title") == "Migrasi online B", repr((r7, idb_task(a, t2))))
        info("7 varian 'B ubah judul sebelum edit offline A, lalu seret'",
             "tidak dijalankan di E2E: dengan TZ=Asia/Jakarta server menang karena S9 (aturan (2), tes Node)")

        # ── 8 penulis lain (API) ──
        sync_now(b)
        c0.refresh_tasks(b)
        c0.open_timeline(b, WS)
        drag_put(b, "B", t1, 1)
        c8a = core(base, u1, t1)
        hd.api(base, u1, "POST", "/api/tasks/%d/done" % t1)
        c8b = core(base, u1, t1)
        check("8a setelah seret B: core_updated_at < updated_at; POST /done lewat API U1 → core_updated_at == updated_at",
              c8a["core_updated_at"] < c8a["updated_at"] and c8b["gtd_status"] == "done"
              and c8b["core_updated_at"] == c8b["updated_at"] and c8b["updated_at"] > c8a["updated_at"], repr((c8a, c8b)))
    finally:
        for cx in ctxs:
            try:
                cx.close()
            except Exception:  # noqa: BLE001
                pass


def seed(base, db_path, mon):
    import sqlite3
    u1 = hd.seed(base, username="sx1", display_name="Rani")
    u2 = hd.seed(base, username="sx2", display_name="Sari")
    ws_id = hd.api(base, u1, "POST", "/api/lists", json={"name": WS})["id"]
    with sqlite3.connect(db_path) as conn:
        conn.execute("INSERT INTO list_members (list_id, user_id, joined_at) VALUES (?,?,?)",
                     (ws_id, u2["id"], datetime.datetime.now().isoformat()))
    d = lambda n: (mon + datetime.timedelta(days=n)).isoformat()  # noqa: E731
    ids = {"ws": ws_id}
    for key, title, off, dur in (("t1", T1, 0, 3), ("t2", T2, 8, 2), ("t3", T3, 14, 2), ("t4", T4, 21, 3)):  # T4 3 hari (1c-0: 1 hari → x+6 kena pegangan ubah durasi)
        tid = c0.task_id(hd.api(base, u1, "POST", "/api/tasks", json={"title": title, "gtd_status": "next", "priority": "P3",
                                                                        "list_id": ws_id, "project": c0.PROJ}))
        hd.api(base, u1, "PUT", "/api/tasks/%d" % tid, json={"ext_patch": {PID + ".start": d(off), PID + ".duration": dur}})
        ids[key] = tid
    s1 = hd.api(base, u1, "PUT", "/api/plugins/state/%s" % PID, json={"enabled": True})
    s2 = hd.api(base, u2, "PUT", "/api/plugins/state/%s" % PID, json={"enabled": True})
    check("setup: U2 anggota W; Timeline ON U1+U2; T1–T4 berjadwal; server mengirim core_updated_at; TZ server %s"
          % os.environ.get("TZ"), s1["state"]["enabled"] and s2["state"]["enabled"]
          and all(start_of(base, u1, ids[k]) for k in ("t1", "t2", "t3", "t4"))
          and all(server_task(base, u1, ids[k]).get("core_updated_at") for k in ("t1", "t2", "t3", "t4")))
    return {"u1": u1, "u2": u2}, ids


def console_checks():
    allowed = re.compile(r"Failed to load resource|net::ERR_")
    bad = [(dv, t, x[:220]) for dv, t, x in c0.console_log if t in ("error", "pageerror") and not allowed.search(x)]
    info("konsol: error/peringatan (perangkat, jenis, teks)", [(dv, t, x[:160]) for dv, t, x in c0.console_log
                                                               if t in ("error", "pageerror", "warning")][:20])
    check("9 konsol tanpa error selain yang disengaja (request offline)", not bad, repr(bad[:6]))


def main():
    if os.environ.get("TZ") != "Asia/Jakarta":
        print("PERINGATAN: jalankan dengan TZ=Asia/Jakarta (S9 seperti zona VPS Jakarta)", flush=True)
    if os.path.isdir(SHOTS):
        for fn in os.listdir(SHOTS):
            if re.match(r"^\d+-.*\.png$", fn):
                os.remove(os.path.join(SHOTS, fn))
    tmp = tempfile.mkdtemp(prefix="e2e_plugin_fase1_1c0b_")
    db_path = os.path.join(tmp, "e2e.db")
    proc, base = hd.start_server(tmp)
    print("server", base, flush=True)
    mon = c0.next_monday(datetime.date.today())
    try:
        users, ids = seed(base, db_path, mon)
        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            run(browser, base, users, ids)
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
    print("\n%d/%d cek lolos" % (len(hd.results) - len(failed), len(hd.results)), flush=True)
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
