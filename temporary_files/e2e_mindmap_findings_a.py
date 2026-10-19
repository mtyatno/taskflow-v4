"""E2E PR A temuan mindmap #3 #5–#8. Tidak dijalankan CI.

Langkah (dua akun: A pemilik workspace W, B anggota):
  1  A: hapus peta → toast → hilang dari sidebar → ada di Sampah (tab Mindmap) → Pulihkan → id sama
  2  A: link node type:'mindmap' dari peta lain (Outline) membuka peta yang dipulihkan
  3  B: pin peta bersama W → A tidak ikut ter-pin (server & UI)
  4  A: badge 👥 pada peta W; filter "Pribadi" / "👥 W" di sidebar
  5  A: cari global teks node → snippet; cari "children" (kunci JSON) → tidak ada peta
  6  A: ubah judul/prioritas task tertaut → kartu Outline & kanvas (iframe) ikut berubah tanpa simpan peta
  7  A: ekspor ZIP memuat mindmaps/
  8  A: offline hapus → Sampah "menunggu sinkron" → pulihkan offline → online → sinkron, tidak ada di Sampah

Server lokal dijalankan sendiri (uvicorn webapp:app, DB sementara). Screenshot: $E2E_SHOTS atau
temporary_files/e2e_mindmap_findings_a/. Keluar non-zero bila ada langkah gagal.

    python3 temporary_files/e2e_mindmap_findings_a.py
"""
import io
import json
import os
import re
import socket
import sqlite3
import subprocess
import sys
import tempfile
import time
import zipfile
from datetime import datetime

import requests
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHOTS = os.environ.get("E2E_SHOTS") or os.path.join(ROOT, "temporary_files", "e2e_mindmap_findings_a")
PW = "rahasia123"
WS = "W"
SECRET = "e2e-mindmap-findings-a-secret"
TOURS = ['dashboard', 'tasks', 'today', 'calendar', 'kanban', 'notes', 'mindmap', 'chat', 'habits', 'habit',
         'settings', 'draw', 'goals', 'review', 'focus', 'workspace', 'slist']

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
    ctx = browser.new_context(service_workers="block", viewport={"width": 1400, "height": 900}, accept_downloads=True)
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
    page.wait_for_timeout(500)
    page.screenshot(path=path, full_page=False)
    print("  screenshot", path, flush=True)


def wait_until(fn, timeout=20, interval=0.5):
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
    # MindmapListItem: div berisi span judul (span pertama)
    return page.locator("div[style*='cursor: pointer']").filter(
        has=page.locator("span", has_text=re.compile("^" + re.escape(title) + "$"))).last


def active_tab(page):
    return page.locator(".mindmap-tab-view-instance:visible")


def open_links(page, row):
    # Klik pertama pada baris belum aktif hanya mengaktifkan baris (tombol aksi muncul & badge 🔗 bergeser,
    # mouseup jatuh di luar badge — perilaku lama Outline). Aktifkan baris dulu lewat teksnya, lalu klik badge.
    row.locator("button[title^='Lihat link node']").evaluate("b => b.closest('div').dispatchEvent(new MouseEvent('mousedown', {bubbles: true}))")
    page.wait_for_timeout(200)
    row.locator("button[title^='Lihat link node']").click()


def tree(*nodes):
    return json.dumps({"nodeData": {"id": "root", "topic": "Akar", "root": True, "children": list(nodes)}})


def main():
    os.makedirs(SHOTS, exist_ok=True)
    for f in os.listdir(SHOTS):
        if f.endswith(".png"):
            os.remove(os.path.join(SHOTS, f))
    tmp = tempfile.mkdtemp(prefix="e2e_mm_findings_a_")
    proc, base, db_path = start_server(tmp)
    print("server", base, "DB", db_path, flush=True)
    try:
        A = register(base, "ana")
        B = register(base, "budi")
        ws = api(base, A, "POST", "/api/lists", json={"name": WS})
        ws_id = ws["id"]
        with sqlite3.connect(db_path) as c:
            c.execute("INSERT INTO list_members (list_id, user_id, joined_at) VALUES (?,?,?)",
                      (ws_id, B["id"], datetime.now().isoformat()))
        task = api(base, A, "POST", "/api/tasks", json={"title": "Task Lama", "priority": "P3"})
        tid = task["id"]
        m_target = api(base, A, "POST", "/api/mindmaps", json={"title": "Peta Target", "data_json": tree(
            {"id": "t1", "topic": "Isi target"})})
        m_src = api(base, A, "POST", "/api/mindmaps", json={"title": "Peta Sumber", "data_json": tree(
            {"id": "s1", "topic": "Node ke target", "links": [{"type": "mindmap", "id": m_target["id"], "title": "Peta Target"}]},
            {"id": "s2", "topic": "Node task", "links": [{"type": "task", "id": tid, "title": "Task Lama", "preview": "P3"}]},
            {"id": "s3", "topic": "kalimat unik zebra pelangi"})})
        m_ws = api(base, A, "POST", "/api/mindmaps", json={"title": "Peta Bersama", "list_id": ws_id})
        m_off = api(base, A, "POST", "/api/mindmaps", json={"title": "Peta Offline"})
        check("setup: B anggota W, 4 peta dibuat", m_ws.get("list_id") == ws_id)

        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            ctxA, a = open_app(browser, base, A)

            # ── 1. hapus → Sampah → pulihkan ───────────────────────────
            goto_mindmap(a, base)
            sidebar_item(a, "Peta Target").click()
            tab = active_tab(a)
            tab.get_by_role("button", name="Hapus", exact=True).click()
            tab.get_by_text("Pindahkan ke Sampah?").wait_for(timeout=5000)
            shot(a, "01_konfirmasi_hapus.png")
            tab.get_by_role("button", name="Ya", exact=True).click()
            check("1a toast 'Dipindahkan ke Sampah'", wait_until(lambda: a.get_by_text("🗑 Dipindahkan ke Sampah").count() > 0, 10))
            check("1b hilang dari sidebar", wait_until(lambda: sidebar_item(a, "Peta Target").count() == 0, 10))

            def server_trash_ids():
                a.evaluate("() => window.__pushNow && window.__pushNow()")
                return [x["id"] for x in api(base, A, "GET", "/api/mindmaps/trash")]
            check("1c server: peta di Sampah", wait_until(lambda: m_target["id"] in server_trash_ids(), 20))
            a.get_by_role("button", name="🗑 Sampah").click()
            dlg = a.get_by_role("dialog", name="Sampah")
            dlg.wait_for(timeout=10000)
            item = dlg.locator(".note-trash-item").filter(has_text="Peta Target")
            check("1d Sampah tab Mindmap memuat 'Peta Target'", wait_until(lambda: item.count() > 0, 15))
            shot(a, "02_sampah_mindmap.png")
            item.get_by_role("button", name="Pulihkan").click()
            check("1e toast 'Peta dipulihkan'", wait_until(lambda: a.get_by_text("♻️ Peta dipulihkan").count() > 0, 15))
            r = raw(base, A, "GET", "/api/mindmaps/%d" % m_target["id"])
            check("1f server: id sama dipulihkan", r.status_code == 200 and r.json().get("title") == "Peta Target", str(r.status_code))
            shot(a, "03_dipulihkan.png")
            a.keyboard.press("Escape")
            close = dlg.locator("button[aria-label='Tutup'], button[title='Tutup']")
            if dlg.count() and dlg.is_visible() and close.count():
                close.first.click()
            check("1g muncul lagi di sidebar", wait_until(lambda: sidebar_item(a, "Peta Target").count() > 0, 15))

            # ── 2. link node mindmap → buka peta yang dipulihkan ───────
            goto_mindmap(a, base)
            sidebar_item(a, "Peta Sumber").click()
            tab = active_tab(a)
            tab.get_by_role("button", name="📝 Outline").click()
            tab.get_by_text("Node ke target").first.wait_for(timeout=10000)
            row = tab.locator("div").filter(has=a.locator("text=Node ke target")).filter(has=a.locator("button[title^='Lihat link node']")).last
            open_links(a, row)
            tab.locator("button[title='Buka mindmap']").first.click(timeout=8000)

            def target_open():
                t = active_tab(a)
                return t.count() == 1 and t.get_by_text("Hapus", exact=True).count() >= 0 and \
                    a.locator(".mindmap-tab-view-instance:visible iframe").count() > 0 and \
                    a.get_by_text("Mindmap tidak tersedia").count() == 0 and \
                    a.evaluate("() => !!Array.from(document.querySelectorAll('.mindmap-tab-view-instance')).find(e => e.offsetParent && e.innerText.includes('Peta Target'))")
            check("2 link node 'mindmap' membuka peta yang dipulihkan", wait_until(target_open, 15))
            shot(a, "04_link_node_buka_peta_dipulihkan.png")

            # ── 3. pin anggota tidak memengaruhi pemilik ──────────────
            ctxB, b = open_app(browser, base, B)
            goto_mindmap(b, base)
            it = sidebar_item(b, "Peta Bersama")
            it.wait_for(timeout=15000)
            it.hover()
            it.locator("span[title='Pin']").click()
            check("3a B: server is_pinned=1 untuk B",
                  wait_until(lambda: (b.evaluate("() => window.__pushNow && window.__pushNow()") or True) and
                             api(base, B, "GET", "/api/mindmaps/%d" % m_ws["id"]).get("is_pinned") == 1, 15))
            shot(b, "05_B_pin_peta_bersama.png")
            check("3b A: server is_pinned=0 untuk A", api(base, A, "GET", "/api/mindmaps/%d" % m_ws["id"]).get("is_pinned") == 0)
            goto_mindmap(a, base)
            a_item = sidebar_item(a, "Peta Bersama")
            a_item.wait_for(timeout=15000)
            check("3c A: UI tidak menampilkan pin (bintang tersembunyi tanpa hover)", a_item.locator("span[title='Unpin']").count() == 0)

            # ── 4. badge 👥 + filter workspace ─────────────────────────
            badge = a_item.locator("span[title='Dibagikan ke %s']" % WS)
            check("4a badge 👥 'Dibagikan ke W'", badge.count() == 1)
            sel = a.locator("select[aria-label='Filter workspace']")
            sel.select_option("personal")
            a.wait_for_timeout(300)
            check("4b filter Pribadi: tanpa 'Peta Bersama', ada 'Peta Sumber'",
                  sidebar_item(a, "Peta Bersama").count() == 0 and sidebar_item(a, "Peta Sumber").count() > 0)
            shot(a, "06_filter_pribadi.png")
            sel.select_option(str(ws_id))
            a.wait_for_timeout(300)
            check("4c filter 👥 W: hanya 'Peta Bersama'",
                  sidebar_item(a, "Peta Bersama").count() > 0 and sidebar_item(a, "Peta Sumber").count() == 0)
            shot(a, "07_filter_workspace.png")
            sel.select_option("")

            # ── 5. pencarian global ──────────────────────────────────
            a.keyboard.press("Control+k")
            inp = a.locator("input:focus")
            inp.wait_for(timeout=5000)
            inp.fill("zebra pelangi")
            modal = a.locator(".modal-overlay").filter(has=a.get_by_placeholder(re.compile("^Cari task, catatan, mindmap")))
            snip = modal.get_by_text(re.compile("kalimat unik zebra pelangi"))
            check("5a cari teks node → 'Peta Sumber' + snippet",
                  wait_until(lambda: snip.count() > 0 and modal.get_by_text("Peta Sumber", exact=True).count() > 0, 10))
            shot(a, "08_cari_teks_node_snippet.png")
            res = api(base, A, "GET", "/api/search?q=children")
            check("5b server: cari 'children' tidak menemukan peta", res["mindmaps"] == [], repr(res["mindmaps"]))
            inp.fill("children")
            a.wait_for_timeout(1200)
            check("5c UI: cari 'children' tanpa hasil peta", modal.get_by_text(re.compile("^Peta ")).count() == 0)
            shot(a, "08b_cari_children_tanpa_peta.png")
            a.keyboard.press("Escape")

            # ── 6. kartu link hidup ──────────────────────────────────
            goto_mindmap(a, base)
            sidebar_item(a, "Peta Sumber").click()
            tab = active_tab(a)
            frame = a.frame_locator(".mindmap-tab-view-instance:visible iframe")
            check("6a kanvas: badge link task 'Task Lama'",
                  wait_until(lambda: frame.locator(".node-link-badge[title*='Task Lama']").count() > 0, 20))
            a.evaluate("""async (id) => {
                await api.put('/api/tasks/' + id, { title: 'Task Baru', priority: 'P1' });
                window.dispatchEvent(new CustomEvent('taskUpdated', { detail: { taskId: id } }));
            }""", tid)
            check("6b kanvas: badge berubah ke 'Task Baru' tanpa simpan peta",
                  wait_until(lambda: frame.locator(".node-link-badge[title*='Task Baru']").count() > 0, 15))
            shot(a, "09_kanvas_kartu_hidup.png")
            tab.get_by_role("button", name="📝 Outline").click()
            row = tab.locator("div").filter(has=a.locator("text=Node task")).filter(has=a.locator("button[title^='Lihat link node']")).last
            open_links(a, row)
            card = tab.get_by_text("Task Baru", exact=True)
            check("6c Outline: kartu link menampilkan 'Task Baru'", wait_until(lambda: card.count() > 0, 10))
            meta = card.first.get_attribute("title") or ""
            check("6d Outline: meta memuat prioritas P1", "P1" in meta, meta.replace("\n", " | "))
            shot(a, "10_outline_kartu_hidup.png")
            mm = api(base, A, "GET", "/api/mindmaps/%d" % m_src["id"])
            check("6e peta tidak disimpan ulang (data_json tetap 'Task Lama')", "Task Lama" in mm["data_json"] and "Task Baru" not in mm["data_json"])
            a.keyboard.press("Escape")

            # ── 7. ekspor ZIP ───────────────────────────────────────
            with a.expect_download(timeout=20000) as dl:
                a.evaluate("() => downloadBackup()")
            zpath = os.path.join(tmp, "export.zip")
            dl.value.save_as(zpath)
            names = zipfile.ZipFile(zpath).namelist()
            mm_names = [n for n in names if n.startswith("mindmaps/")]
            check("7 ekspor ZIP memuat mindmaps/", "mindmaps/Peta Sumber.json" in mm_names and "mindmaps/Peta Sumber.md" in mm_names,
                  ", ".join(sorted(mm_names)))

            # ── 8. offline hapus → pulihkan → online ─────────────────
            goto_mindmap(a, base)
            sidebar_item(a, "Peta Offline").click()
            tab = active_tab(a)
            tab.get_by_text("Peta Offline").first.wait_for(timeout=10000)
            ctxA.set_offline(True)
            a.wait_for_timeout(300)
            tab.get_by_role("button", name="Hapus", exact=True).click()
            tab.get_by_role("button", name="Ya", exact=True).click()
            check("8a offline: toast pindah ke Sampah", wait_until(lambda: a.get_by_text("🗑 Dipindahkan ke Sampah").count() > 0, 10))
            a.get_by_role("button", name="🗑 Sampah").click()
            dlg = a.get_by_role("dialog", name="Sampah")
            item = dlg.locator(".note-trash-item").filter(has_text="Peta Offline")
            check("8b offline: Sampah memuat item 'menunggu sinkron'",
                  wait_until(lambda: item.count() > 0 and item.get_by_text("menunggu sinkron").count() > 0, 15))
            shot(a, "11_offline_menunggu_sinkron.png")
            item.get_by_role("button", name="Pulihkan").click()
            check("8c offline: toast dipulihkan", wait_until(lambda: a.get_by_text(re.compile("♻️ Peta dipulihkan")).count() > 0, 10))
            shot(a, "12_offline_dipulihkan.png")
            ctxA.set_offline(False)
            a.evaluate("() => window.dispatchEvent(new Event('online'))")

            def synced():
                sync_now(a)
                ok_list = any(m["id"] == m_off["id"] for m in api(base, A, "GET", "/api/mindmaps"))
                trash = api(base, A, "GET", "/api/mindmaps/trash")
                return ok_list and not any(x["id"] == m_off["id"] for x in trash)
            check("8d online: peta ada di server, tidak ada di Sampah", wait_until(synced, 30))
            check("8e Sampah UI tanpa 'Peta Offline'", wait_until(lambda: item.count() == 0, 15))
            shot(a, "13_online_sampah_bersih.png")

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
