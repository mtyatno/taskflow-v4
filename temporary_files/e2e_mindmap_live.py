"""E2E PR B temuan mindmap #4 — kolaborasi langsung + merge per node. Tidak dijalankan CI.

Dua akun (A pemilik workspace W, B anggota), dua browser context, peta bersama W (satu peta per skenario):
  1  A mengubah node X, B mengubah node Y bersamaan → ≤ 5 s keduanya melihat X dan Y, tanpa "(konflik)"
  2  keduanya mengubah teks node yang sama → peta memakai versi yang tersimpan lebih dulu di server; pihak lain
     mendapat salinan "(konflik)" + notice (+ toast, dicek terpisah)
  3  B sedang mengetik di node saat A menyimpan → ketikan B tidak hilang; setelah B selesai keduanya tergabung
  4  A menghapus peta → tab B tertutup dengan toast "Peta ini dihapus oleh pemiliknya"
  5  B offline mengedit, A mengedit node lain, B online → tergabung
  6  B menerima perubahan A, mengedit satu node, Ctrl+Z, simpan selesai → perubahan A tetap ada
  7  hanya tab mindmap aktif yang memegang stream: dua tab peta, pindah tab → "🟢 Langsung" ikut pindah

Server lokal dijalankan sendiri (uvicorn webapp:app, DB sementara). Screenshot: $E2E_SHOTS atau
temporary_files/e2e_mindmap_live/. Keluar non-zero bila ada langkah gagal.

    python3 temporary_files/e2e_mindmap_live.py
"""
import json
import os
import re
import socket
import sqlite3
import subprocess
import sys
import tempfile
import time
from datetime import datetime

import requests
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHOTS = os.environ.get("E2E_SHOTS") or os.path.join(ROOT, "temporary_files", "e2e_mindmap_live")
PW = "rahasia123"
WS = "W"
SECRET = "e2e-mindmap-live-secret"
TOURS = ['dashboard', 'tasks', 'today', 'calendar', 'kanban', 'notes', 'mindmap', 'chat', 'habits', 'habit',
         'settings', 'draw', 'goals', 'review', 'focus', 'workspace', 'slist']
LIVE = "🟢 Langsung"

# Lacak EventSource stream mindmap yang masih terbuka (dipasang sebelum skrip aplikasi berjalan).
ES_TRACKER = """(() => {
  const O = window.EventSource; if (!O || O.__tfWrapped) return;
  window.__esLive = new Set();
  class W extends O {
    constructor(u, o) { super(u, o); window.__esLive.add(this);
      const c = this.close.bind(this); this.close = () => { window.__esLive.delete(this); c(); }; }
  }
  W.__tfWrapped = true;
  window.EventSource = W;
  if (window.top === window) {
    window.__msgs = [];
    window.addEventListener('message', (e) => { const t = e.data && e.data.type; if (t) window.__msgs.push([Date.now(), t]); });
  } else {
    window.addEventListener('message', (e) => { const t = e.data && e.data.type; try { if (t && window.top.__msgs) window.top.__msgs.push([Date.now(), 'in:' + t]); } catch (_) {} });
  }
})();"""

results = []


def check(step, ok, note=""):
    results.append((step, bool(ok), note))
    print(("PASS " if ok else "FAIL ") + step + (" — " + note if note else ""), flush=True)
    return ok


def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


def start_server(tmp):
    port = free_port()
    env = dict(os.environ, DB_PATH=os.path.join(tmp, "e2e.db"), UPLOAD_DIR=os.path.join(tmp, "uploads"),
               WEB_SECRET_KEY=SECRET, TELEGRAM_BOT_TOKEN="")
    os.makedirs(env["UPLOAD_DIR"], exist_ok=True)
    log = open(os.path.join(tmp, "server.log"), "w")
    proc = subprocess.Popen([sys.executable, "-m", "uvicorn", "webapp:app", "--host", "127.0.0.1",
                             "--port", str(port)], cwd=ROOT, env=env, stdout=log, stderr=subprocess.STDOUT)
    base = "http://127.0.0.1:%d" % port
    for _ in range(120):
        try:
            if requests.get(base + "/manifest.json", timeout=1).status_code < 500:
                return proc, base, env["DB_PATH"]
        except requests.RequestException:
            pass
        if proc.poll() is not None:
            break
        time.sleep(0.5)
    proc.kill()
    raise RuntimeError("server gagal start, lihat " + log.name)


def register(base, name):
    u = "%s%d" % (name, int(time.time() * 1000) % 10_000_000)
    r = requests.post(base + "/api/auth/register",
                      json={"username": u, "password": PW, "email": u + "@ex.com", "display_name": name})
    r.raise_for_status()
    j = r.json()
    return {"username": u, "id": j["user_id"], "token": j["token"]}


def raw(base, user, method, path, **kw):
    return requests.request(method, base + path, headers={"Authorization": "Bearer " + user["token"]}, timeout=15, **kw)


def api(base, user, method, path, **kw):
    r = raw(base, user, method, path, **kw)
    r.raise_for_status()
    return r.json()


def open_app(browser, base, user):
    ctx = browser.new_context(service_workers="block", viewport={"width": 1400, "height": 900})
    ctx.add_init_script(ES_TRACKER)
    ctx.add_cookies([{"name": "token", "value": user["token"], "url": base, "httpOnly": True, "sameSite": "Lax"}])
    p = ctx.new_page()
    p.on("dialog", lambda d: d.accept())
    p.goto(base + "/manifest.json")
    p.evaluate("""([t, u, tours]) => {
        localStorage.setItem('tf_token', t); localStorage.setItem('tf_user_id', String(u));
        for (const pg of tours) localStorage.setItem('tf_tour_' + pg, '1');
        localStorage.setItem('tf_dismiss_onboarding', '1');
    }""", [user["token"], user["id"], TOURS])
    p.goto(base + "/")
    p.locator(".sidebar-link").first.wait_for(state="attached", timeout=20000)
    return ctx, p


def shot(page, name):
    path = os.path.join(SHOTS, name)
    page.wait_for_timeout(400)
    page.screenshot(path=path, full_page=False)
    print("  screenshot", path, flush=True)


def wait_until(fn, timeout=20, interval=0.25):
    end = time.time() + timeout
    last = None
    while time.time() < end:
        try:
            last = fn()
            if last:
                return last
        except Exception:
            pass
        time.sleep(interval)
    return last


def sync_now(page):
    page.evaluate("() => typeof window.__syncNow === 'function' ? Promise.resolve(window.__syncNow()).catch(() => null) : null")


def goto_mindmap(page, base):
    page.goto(base + "/")
    page.locator(".sidebar-link").first.wait_for(state="attached", timeout=20000)
    sync_now(page)
    expand = page.locator("button[aria-label='Tampilkan semua menu']")
    if expand.count() and expand.first.is_visible():
        expand.first.click()
    page.locator(".sidebar-link").filter(has=page.locator("span", has_text=re.compile("^Mindmap$"))).first.click()
    page.get_by_text("🗑 Sampah", exact=True).wait_for(timeout=15000)


def sidebar_item(page, title):
    return page.locator("div[style*='cursor: pointer']").filter(
        has=page.locator("span", has_text=re.compile("^" + re.escape(title) + "$"))).last


def active_tab(page):
    return page.locator(".mindmap-tab-view-instance:visible")


def frame(page):
    return page.frame_locator(".mindmap-tab-view-instance:visible iframe")


def tpc(page, nid):
    return frame(page).locator('me-tpc[data-nodeid="me%s"]' % nid)


def node_text(page, nid):
    loc = tpc(page, nid)
    return loc.first.inner_text().strip() if loc.count() else None


def open_map(page, base, title, reload=True):
    if reload:
        goto_mindmap(page, base)
    it = sidebar_item(page, title)
    if not wait_until(lambda: it.count() > 0 or (sync_now(page) and False), 20):
        raise RuntimeError("peta '%s' tidak muncul di sidebar" % title)
    it.click()
    active_tab(page).get_by_text(title).first.wait_for(timeout=10000)
    tpc(page, "root").first.wait_for(timeout=15000)


def wait_live(page, timeout=15):
    ok = wait_until(lambda: active_tab(page).get_by_text(LIVE, exact=True).count() == 1, timeout)
    settle(page)
    return ok


def settle(page, quiet_ms=1200, timeout=10):
    # Tunggu sampai iframe tidak lagi menerima load/remoteUpdate/refresh (muat awal + kejar ketinggalan saat stream
    # terbuka) selama quiet_ms — klik/edit sebelum itu bisa tersapu oleh pemuatan ulang kanvas.
    return wait_until(lambda: page.evaluate("""(q) => {
        const xs = (window.__msgs || []).filter(m => /^in:(load|remoteUpdate|refresh)$/.test(m[1]));
        return !xs.length || Date.now() - xs[xs.length - 1][0] >= q; }""", quiet_ms), timeout, 0.2)


def edit_node(page, nid, text, commit=True):
    # pilih node lalu F2 (dblclick Playwright mengenai span teks di dalam me-tpc, bukan me-tpc)
    tpc(page, nid).first.click()
    page.wait_for_timeout(150)
    page.keyboard.press("F2")
    box = frame(page).locator("#input-box")
    try:
        box.wait_for(state="visible", timeout=5000)
    except Exception:
        shot(page, "debug_edit_%s.png" % nid)
        raise
    page.keyboard.press("Control+A")
    page.keyboard.type(text)
    if commit:
        page.keyboard.press("Enter")
        box.wait_for(state="detached", timeout=5000)


def server_doc(base, user, mid):
    return json.loads(api(base, user, "GET", "/api/mindmaps/%d" % mid)["data_json"])


def server_topics(base, user, mid):
    out = {}

    def walk(n):
        out[n.get("id")] = n.get("topic")
        for c in n.get("children") or []:
            walk(c)
    walk(server_doc(base, user, mid)["nodeData"])
    return out


def open_streams(page):
    return page.evaluate("""() => Array.from(window.__esLive || [])
        .filter(e => /\\/api\\/mindmaps\\/[^/]+\\/stream/.test(e.url) && e.readyState !== 2)
        .map(e => e.url.replace(/^.*\\/api\\/mindmaps\\//, '').replace(/\\/stream.*$/, ''))""")


def konflik_titles(base, user):
    return [m["title"] for m in api(base, user, "GET", "/api/mindmaps") if (m.get("title") or "").startswith("(konflik)")]


def tree(*nodes):
    return json.dumps({"nodeData": {"id": "root", "topic": "Akar", "root": True, "children": list(nodes)}})


def three(prefix):
    return tree({"id": prefix + "x", "topic": "Ide X"}, {"id": prefix + "y", "topic": "Ide Y"},
                {"id": prefix + "z", "topic": "Ide Z"})


def main():
    os.makedirs(SHOTS, exist_ok=True)
    for f in os.listdir(SHOTS):
        if f.endswith(".png"):
            os.remove(os.path.join(SHOTS, f))
    tmp = tempfile.mkdtemp(prefix="e2e_mm_live_")
    proc, base, db_path = start_server(tmp)
    print("server", base, "DB", db_path, flush=True)
    try:
        A = register(base, "ana")
        B = register(base, "budi")
        ws_id = api(base, A, "POST", "/api/lists", json={"name": WS})["id"]
        with sqlite3.connect(db_path) as c:
            c.execute("INSERT INTO list_members (list_id, user_id, joined_at) VALUES (?,?,?)",
                      (ws_id, B["id"], datetime.now().isoformat()))
        maps = {}
        for key, title in [("s1", "Peta Bersamaan"), ("s2", "Peta Bentrok"), ("s3", "Peta Ketik"), ("s4", "Peta Hapus"),
                           ("s5", "Peta Offline"), ("s6", "Peta Undo"), ("s7a", "Peta Tab Satu"), ("s7b", "Peta Tab Dua")]:
            maps[key] = api(base, A, "POST", "/api/mindmaps", json={"title": title, "list_id": ws_id, "data_json": three(key)})
        check("setup: B anggota W, 8 peta bersama dibuat", all(m.get("list_id") == ws_id for m in maps.values()))

        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            ctxA, a = open_app(browser, base, A)
            ctxB, b = open_app(browser, base, B)

            # ── 1. node berbeda bersamaan ───────────────────────────
            s = "s1"
            mid = maps[s]["id"]
            open_map(a, base, "Peta Bersamaan")
            open_map(b, base, "Peta Bersamaan")
            check("1a kedua tab menampilkan '🟢 Langsung'", wait_live(a) and wait_live(b))
            edit_node(a, s + "x", "X oleh Ana")
            edit_node(b, s + "y", "Y oleh Budi")
            t0 = time.time()

            def both_see():
                return all(node_text(p, s + "x") == "X oleh Ana" and node_text(p, s + "y") == "Y oleh Budi" for p in (a, b))
            ok = wait_until(both_see, 15)
            dt = time.time() - t0
            check("1b keduanya melihat X dan Y", ok, "%.1f s" % dt)
            check("1c dalam ≤ 5 s", ok and dt <= 5.0, "%.1f s" % dt)
            st = wait_until(lambda: (lambda t: t if t.get(s + "x") == "X oleh Ana" and t.get(s + "y") == "Y oleh Budi" else None)(
                server_topics(base, A, mid)), 10)
            check("1d server memuat X dan Y", bool(st), repr(st))
            sync_now(a)
            sync_now(b)
            time.sleep(1)
            check("1e tidak ada '(konflik)'", not konflik_titles(base, A) and not konflik_titles(base, B)
                  and a.locator("#tf-conflict-bar").count() == 0 and b.locator("#tf-conflict-bar").count() == 0)
            shot(a, "01_A_node_berbeda_tergabung.png")
            shot(b, "01_B_node_berbeda_tergabung.png")

            # ── 2. node yang sama bersamaan ─────────────────────────
            s = "s2"
            mid = maps[s]["id"]
            open_map(a, base, "Peta Bentrok")
            open_map(b, base, "Peta Bentrok")
            wait_live(a)
            wait_live(b)
            edit_node(a, s + "x", "Versi Ana")
            edit_node(b, s + "x", "Versi Budi")

            def settled():
                sync_now(a)
                sync_now(b)
                v = server_topics(base, A, mid).get(s + "x")
                if v not in ("Versi Ana", "Versi Budi"):
                    return None
                loser = B if v == "Versi Ana" else A
                return (v, loser) if konflik_titles(base, loser) else None
            res = wait_until(settled, 30, 1)
            check("2a server memakai satu versi + salinan konflik milik pihak lain", bool(res),
                  "menang: %s, kalah: %s" % (res[0], "B" if res[1] is B else "A") if res else "")
            if res:
                winner_text, loser = res
                lp, wp = (b, a) if loser is B else (a, b)
                check("2b pemenang tidak mendapat salinan '(konflik)'", not konflik_titles(base, A if loser is B else B))
                check("2c kedua kanvas memakai versi server",
                      wait_until(lambda: node_text(a, s + "x") == winner_text and node_text(b, s + "x") == winner_text, 15),
                      "%s / %s" % (node_text(a, s + "x"), node_text(b, s + "x")))
                bar = lp.locator("#tf-conflict-bar")
                check("2d pihak kalah: notice 'node diubah bersamaan'",
                      wait_until(lambda: (lp.evaluate("() => typeof renderConflicts === 'function' && renderConflicts()") or True)
                                 and bar.count() > 0 and "node diubah bersamaan" in bar.inner_text(), 15),
                      bar.inner_text() if bar.count() else "(tanpa bar)")
                copy = konflik_titles(base, loser)
                check("2e salinan berjudul '(konflik) Peta Bentrok'", "(konflik) Peta Bentrok" in copy, repr(copy))
                toast = lp.get_by_text(re.compile("Sebagian perubahanmu bentrok|edit-mu disimpan sebagai"))
                check("2f pihak kalah: toast konflik", wait_until(lambda: toast.count() > 0, 3),
                      "toast hanya dari jalur router lokal (simpan tab); jalur push 409/pull hanya notice")
                shot(lp, "02_kalah_notice_salinan_konflik.png")
                shot(wp, "02_menang_versi_server.png")
                lp.evaluate("""() => Promise.resolve(window.TF.syncconflict.listNotices()).then(ns =>
                    Promise.all(ns.map(n => window.TF.syncconflict.dismissNotice(n.entity, n.cid)))).then(() => renderConflicts())""")

            # ── 3. B mengetik saat A menyimpan ──────────────────────
            s = "s3"
            mid = maps[s]["id"]
            open_map(a, base, "Peta Ketik")
            open_map(b, base, "Peta Ketik")
            wait_live(a)
            wait_live(b)
            b.evaluate("() => { window.__msgs = []; }")
            edit_node(b, s + "z", "Budi sedang mengetik", commit=False)  # z di kiri: tidak tertutup panel samping
            box = frame(b).locator("#input-box")
            check("3a B sedang mengetik (kotak edit terbuka)", box.count() == 1 and box.inner_text().strip() == "Budi sedang mengetik")
            edit_node(a, s + "x", "X dari Ana saat Budi mengetik")
            check("3b server menerima edit A",
                  wait_until(lambda: server_topics(base, A, mid).get(s + "x") == "X dari Ana saat Budi mengetik", 15))
            time.sleep(2.5)  # SSE + pull di B; iframe B harus melewati (remoteSkipped) karena kotak edit aktif
            box = frame(b).locator("#input-box")
            typed = box.inner_text() if box.count() else ""
            msgs = [m[1] for m in b.evaluate("() => window.__msgs") if not m[1].startswith("in:")]
            check("3c iframe B melewati pembaruan jarak jauh (remoteSkipped)", "remoteSkipped" in msgs and "remoteApplied" not in msgs, repr(msgs))
            check("3d ketikan B tetap utuh di kotak edit", box.count() == 1 and typed.strip() == "Budi sedang mengetik", repr(typed))
            shot(b, "03_B_masih_mengetik.png")
            b.keyboard.type(" selesai")
            b.keyboard.press("Enter")
            want = {s + "x": "X dari Ana saat Budi mengetik", s + "z": "Budi sedang mengetik selesai"}
            check("3e kedua kanvas tergabung", wait_until(
                lambda: all(node_text(p, k) == v for p in (a, b) for k, v in want.items()), 15),
                "A=%s/%s B=%s/%s" % (node_text(a, s + "x"), node_text(a, s + "z"), node_text(b, s + "x"), node_text(b, s + "z")))
            check("3f server tergabung", wait_until(lambda: all(server_topics(base, A, mid).get(k) == v for k, v in want.items()), 10))
            check("3g tanpa salinan konflik", "(konflik) Peta Ketik" not in konflik_titles(base, A) + konflik_titles(base, B))
            shot(b, "03_B_tergabung_setelah_selesai.png")

            # ── 4. A menghapus peta → tab B tertutup ────────────────
            s = "s4"
            open_map(b, base, "Peta Hapus")
            open_map(a, base, "Peta Hapus")
            wait_live(b)
            tab = active_tab(a)
            tab.get_by_role("button", name="Hapus", exact=True).click()
            tab.get_by_role("button", name="Ya", exact=True).click()
            check("4a toast B 'Peta ini dihapus oleh pemiliknya'",
                  wait_until(lambda: b.get_by_text("Peta ini dihapus oleh pemiliknya").count() > 0, 15))
            shot(b, "04_B_tab_ditutup_toast.png")
            check("4b tab B tertutup", wait_until(
                lambda: b.locator(".mindmap-tab-item[title='Peta Hapus']").count() == 0 and tpc(b, s + "x").count() == 0, 10))

            # ── 5. B offline mengedit, A mengedit node lain ────────
            s = "s5"
            mid = maps[s]["id"]
            open_map(a, base, "Peta Offline")
            open_map(b, base, "Peta Offline")
            wait_live(a)
            wait_live(b)
            ctxB.set_offline(True)
            b.evaluate("() => window.dispatchEvent(new Event('offline'))")
            b.wait_for_timeout(500)
            edit_node(b, s + "y", "Y offline Budi")
            b.wait_for_timeout(2500)
            shot(b, "05_B_offline_edit.png")
            edit_node(a, s + "x", "X online Ana")
            check("5a server menerima edit A", wait_until(lambda: server_topics(base, A, mid).get(s + "x") == "X online Ana", 15))
            check("5b server belum punya edit B (offline)", server_topics(base, A, mid).get(s + "y") == "Ide Y")
            ctxB.set_offline(False)
            b.evaluate("() => window.dispatchEvent(new Event('online'))")
            want = {s + "x": "X online Ana", s + "y": "Y offline Budi"}

            def merged5():
                sync_now(b)
                return all(server_topics(base, A, mid).get(k) == v for k, v in want.items())
            check("5c online: server tergabung", wait_until(merged5, 30, 1))
            check("5d kedua kanvas tergabung", wait_until(
                lambda: all(node_text(p, k) == v for p in (a, b) for k, v in want.items()), 20),
                "A=%s/%s B=%s/%s" % (node_text(a, s + "x"), node_text(a, s + "y"), node_text(b, s + "x"), node_text(b, s + "y")))
            check("5e tanpa salinan konflik baru", "(konflik) Peta Offline" not in konflik_titles(base, B))
            shot(b, "05_B_online_tergabung.png")
            shot(a, "05_A_online_tergabung.png")

            # ── 6. Ctrl+Z setelah pembaruan jarak jauh ─────────────
            s = "s6"
            mid = maps[s]["id"]
            open_map(a, base, "Peta Undo")
            open_map(b, base, "Peta Undo")
            wait_live(a)
            wait_live(b)
            edit_node(a, s + "x", "X jarak jauh Ana")
            check("6a B menerima perubahan A", wait_until(lambda: node_text(b, s + "x") == "X jarak jauh Ana", 10))
            edit_node(b, s + "y", "Y Budi sebelum undo")
            frame(b).locator("me-tpc").first.wait_for()
            b.keyboard.press("Control+z")
            b.wait_for_timeout(300)
            check("6b Ctrl+Z membatalkan edit B saja", node_text(b, s + "y") == "Ide Y" and node_text(b, s + "x") == "X jarak jauh Ana",
                  "x=%s y=%s" % (node_text(b, s + "x"), node_text(b, s + "y")))
            check("6c simpan selesai (status 'Tersimpan')",
                  wait_until(lambda: active_tab(b).get_by_text("Tersimpan", exact=True).count() > 0
                             and server_topics(base, A, mid).get(s + "y") == "Y Budi sebelum undo", 15))
            check("6d server: perubahan A tetap ada", server_topics(base, A, mid).get(s + "x") == "X jarak jauh Ana")
            # edit berikutnya menyimpan seluruh pohon kanvas (pasca-undo) — perubahan A tetap ada
            edit_node(b, s + "z", "Z Budi sesudah undo")
            check("6e setelah edit berikutnya: server memuat X dari A + Z dari B", wait_until(
                lambda: (lambda t: t.get(s + "x") == "X jarak jauh Ana" and t.get(s + "z") == "Z Budi sesudah undo")(
                    server_topics(base, A, mid)), 15), repr(server_topics(base, A, mid)))
            check("6f kanvas A tetap memuat X dari A", wait_until(lambda: node_text(a, s + "x") == "X jarak jauh Ana"
                                                                 and node_text(a, s + "z") == "Z Budi sesudah undo", 10))
            shot(b, "06_B_undo_perubahan_A_tetap.png")

            # ── 7. stream hanya untuk tab aktif ────────────────────
            k1, k2 = maps["s7a"]["id"], maps["s7b"]["id"]
            open_map(b, base, "Peta Tab Satu")
            open_map(b, base, "Peta Tab Dua", reload=False)
            wait_live(b)
            check("7a dua tab peta terbuka", b.locator(".mindmap-tab-item").count() >= 2)
            st = wait_until(lambda: (lambda s_: s_ if s_ == [str(k2)] else None)(open_streams(b)), 10)
            check("7b satu stream, untuk tab aktif (Tab Dua)", bool(st), repr(open_streams(b)))
            check("7c '🟢 Langsung' di tab aktif, hanya satu", active_tab(b).get_by_text(LIVE, exact=True).count() == 1
                  and active_tab(b).get_by_text("Peta Tab Dua").count() > 0
                  and b.get_by_text(LIVE, exact=True).count() == 1)
            shot(b, "07_badge_tab_dua.png")
            b.locator(".mindmap-tab-item[title='Peta Tab Satu']").click()
            st = wait_until(lambda: (lambda s_: s_ if s_ == [str(k1)] else None)(open_streams(b)), 10)
            check("7d pindah tab: stream pindah ke Tab Satu", bool(st), repr(open_streams(b)))
            check("7e '🟢 Langsung' pindah ke Tab Satu", wait_live(b, 10) and active_tab(b).get_by_text("Peta Tab Satu").count() > 0
                  and b.get_by_text(LIVE, exact=True).count() == 1)
            shot(b, "07_badge_tab_satu.png")
            # tab latar belakang tetap mengejar saat diaktifkan
            api(base, A, "PUT", "/api/mindmaps/%d" % k2, json={"data_json": tree(
                {"id": "s7bx", "topic": "Diubah saat latar"}, {"id": "s7by", "topic": "Ide Y"}, {"id": "s7bz", "topic": "Ide Z"})})
            b.locator(".mindmap-tab-item[title='Peta Tab Dua']").click()
            check("7f tab latar mengejar perubahan saat diaktifkan",
                  wait_until(lambda: node_text(b, "s7bx") == "Diubah saat latar", 10), str(node_text(b, "s7bx")))

            ctxA.close()
            ctxB.close()
            browser.close()
    except Exception as e:
        check("exception", False, "%s: %s" % (type(e).__name__, e))
    finally:
        proc.terminate()
        try:
            proc.wait(10)
        except subprocess.TimeoutExpired:
            proc.kill()
        print("server log:", os.path.join(tmp, "server.log"))

    failed = [r for r in results if not r[1]]
    print("\n%d langkah, %d gagal" % (len(results), len(failed)))
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
