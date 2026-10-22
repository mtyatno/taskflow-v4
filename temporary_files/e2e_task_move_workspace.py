"""E2E pindah task pribadi ke workspace + screenshot (terang/gelap desktop, mobile). Tidak dijalankan CI.

  1  A punya task pribadi (project "Laporan", 1 sub-task) → detail → tombol "Pindah ke Workspace"
  2  panel → pilih workspace → Pindahkan → task + sub-task ber-list_id W, project di W
  3  B (anggota W) melihat task di workspace W

    PATH=<venv>/bin:$PATH python temporary_files/e2e_task_move_workspace.py
"""
import os
import re
import ssl
import sys
import tempfile
import time
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import e2e_project_scope as base_e2e  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402

ROOT = base_e2e.ROOT
SHOTS = os.path.join(ROOT, "temporary_files", "e2e_task_move_workspace")
WS = "Tim Produk"
TITLE = "Siapkan laporan bulanan"
check, api, register = base_e2e.check, base_e2e.api, base_e2e.register
_ctx = ssl.create_default_context(cafile="/root/.ccr/ca-bundle.crt")


def fonts(route):
    try:
        with urllib.request.urlopen(route.request.url, context=_ctx, timeout=15) as r:
            route.fulfill(status=r.status, body=r.read(), headers={"content-type": r.headers.get("content-type", "")})
    except Exception:
        route.abort()


def open_app(browser, base, user, theme="light", mobile=False):
    vp = {"width": 390, "height": 844} if mobile else {"width": 1366, "height": 900}
    ctx = browser.new_context(service_workers="block", viewport=vp, device_scale_factor=2 if mobile else 1,
                              is_mobile=mobile, has_touch=mobile)
    ctx.route("https://fonts.googleapis.com/**", fonts)
    ctx.route("https://fonts.gstatic.com/**", fonts)
    p = ctx.new_page()
    p.goto(base + "/manifest.json")
    p.evaluate("""([t, u, tours, theme]) => {
        localStorage.setItem('tf_token', t); localStorage.setItem('tf_user_id', String(u));
        for (const pg of tours) localStorage.setItem('tf_tour_' + pg, '1');
        localStorage.setItem('tf_dismiss_onboarding', '1'); localStorage.setItem('tf_onboarded', '1');
        localStorage.setItem('tf_backup_snooze', new Date().toISOString().slice(0,10));
        localStorage.setItem('tf_theme', theme); localStorage.setItem('theme', theme);
    }""", [user["token"], user["id"], base_e2e.TOURS + ["inbox", "all", "alltasks", "today"], theme])
    p.goto(base + "/")
    p.locator(".sidebar-link").first.wait_for(state="attached", timeout=20000)
    p.wait_for_timeout(3000)
    p.reload()
    p.locator(".sidebar-link").first.wait_for(state="attached", timeout=20000)
    p.evaluate("(t) => document.documentElement.setAttribute('data-theme', t)", theme)
    return ctx, p


def shot(page, name, bottom=False):
    if bottom:  # gulir isi modal ke bawah (tombol aksi / panel)
        page.evaluate("() => { const m = document.querySelector('.modal-content'); if (m) m.scrollTop = m.scrollHeight; }")
    page.wait_for_timeout(600)
    page.screenshot(path=os.path.join(SHOTS, name))
    print("  screenshot", name, flush=True)


def open_task(page, title, mobile=False):
    expand = page.locator("button[aria-label='Tampilkan semua menu']")
    if not mobile and expand.count() and expand.first.is_visible():
        expand.first.click()
    if mobile:
        page.locator(".mobile-topbar-main button", has_text="\u2630").first.click()
        page.wait_for_timeout(400)
    page.locator(".sidebar-link", has_text="Semua Task").first.click()
    page.locator(".task-row", has_text=title).first.click()
    page.locator(".modal-content", has_text=title).wait_for(timeout=10000)


def main():
    os.makedirs(SHOTS, exist_ok=True)
    tmp = tempfile.mkdtemp(prefix="e2e_task_move_")
    proc, base, db_path = base_e2e.start_server(tmp)
    try:
        A = register(base, "ana")
        B = register(base, "budi")
        ws = api(base, A, "POST", "/api/lists", json={"name": WS})
        api(base, A, "POST", "/api/lists", json={"name": "Keluarga"})
        import sqlite3
        from datetime import datetime
        with sqlite3.connect(db_path) as c:
            c.execute("INSERT INTO list_members(list_id, user_id, joined_at) VALUES (?,?,?)",
                      (ws["id"], B["id"], datetime.now().isoformat()))
        t = api(base, A, "POST", "/api/tasks", json={"title": TITLE, "project": "Laporan", "priority": "P2",
                                                    "description": "Rekap angka penjualan dan kirim ke tim."})
        api(base, A, "POST", "/api/tasks", json={"title": "Kumpulkan data penjualan", "parent_id": t["id"]})
        with sync_playwright() as pw:
            br = pw.chromium.launch(executable_path="/opt/pw-browsers/chromium", ignore_default_args=["--hide-scrollbars"])
            # dark + mobile dulu (sebelum dipindah)
            ctx, p = open_app(br, base, A, "dark")
            open_task(p, TITLE)
            shot(p, "3-detail-gelap-desktop.png", bottom=True)
            p.get_by_role("button", name=re.compile("Pindah ke Workspace")).click()
            p.locator("select[aria-label='Workspace tujuan']").select_option(str(ws["id"]))
            shot(p, "4-panel-gelap-desktop.png", bottom=True)
            ctx.close()
            ctx, p = open_app(br, base, A, "light", mobile=True)
            try:
                open_task(p, TITLE, mobile=True)
                p.get_by_role("button", name=re.compile("Pindah ke Workspace")).click()
                p.locator("select[aria-label='Workspace tujuan']").select_option(str(ws["id"]))
                p.locator(".task-move-panel").scroll_into_view_if_needed()
                shot(p, "5-panel-mobile-terang.png", bottom=True)
            except Exception as e:
                check("mobile", False, str(e)[:200])
            ctx.close()
            # terang desktop: lakukan pemindahan
            ctx, p = open_app(br, base, A, "light")
            open_task(p, TITLE)
            btn = p.get_by_role("button", name=re.compile("Pindah ke Workspace"))
            check("1 tombol tampil", btn.count() == 1)
            shot(p, "1-detail-terang-desktop.png", bottom=True)
            btn.click()
            p.locator("select[aria-label='Workspace tujuan']").select_option(str(ws["id"]))
            shot(p, "2-panel-terang-desktop.png", bottom=True)
            # sync penuh dibuat lambat (30 dtk) seperti akun besar: modal harus tetap cepat tertutup
            p.evaluate("() => { window.__syncNow = () => new Promise(r => setTimeout(r, 30000)); }")
            t0 = time.time()
            p.get_by_role("button", name="Pindahkan").click()
            p.locator(".modal-content", has_text=TITLE).wait_for(state="detached", timeout=15000)
            check("2 modal tertutup < 5 dtk walau sync lambat", time.time() - t0 < 5, "%.1f dtk" % (time.time() - t0))
            shot(p, "6-setelah-pindah-terang-desktop.png")
            with sqlite3.connect(db_path) as c:
                rows = c.execute("SELECT t.list_id, p.list_id FROM tasks t LEFT JOIN projects p ON p.id = t.project_id "
                                 "WHERE t.id = ? OR t.parent_id = ?", (t["id"], t["id"])).fetchall()
            check("2 task + sub-task di W", len(rows) == 2 and all(r[0] == ws["id"] for r in rows), str(rows))
            check("2 project di W", rows[0][1] == ws["id"], str(rows))
            local = p.evaluate("""async (title) => { const db = await window.TF.db.openDB();
                const all = await new Promise(r => { const q = db.transaction('tasks').objectStore('tasks').getAll(); q.onsuccess = () => r(q.result); });
                const t = all.find(x => x.title === title); return t ? t.list_id : 'missing'; }""", TITLE)
            check("2 IndexedDB ikut list_id", local == ws["id"], str(local))
            ctx.close()
            ctx, p = open_app(br, base, B, "light")
            base_e2e.WS = WS
            base_e2e.goto_workspace(p, base)
            p.wait_for_timeout(1500)
            check("3 anggota melihat task", p.locator("text=" + TITLE).count() > 0)
            shot(p, "7-workspace-anggota-terang.png")
            ctx.close()
            br.close()
    finally:
        proc.kill()
    fails = [r for r in base_e2e.results if not r[1]]
    print("%d/%d PASS" % (len(base_e2e.results) - len(fails), len(base_e2e.results)))
    sys.exit(1 if fails else 0)


if __name__ == "__main__":
    main()
