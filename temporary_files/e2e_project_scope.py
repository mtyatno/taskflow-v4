"""E2E PR 5 — project per scope (Pribadi / workspace). Tidak dijalankan CI.

Langkah (dua akun: A pemilik workspace W, B anggota):
  1  A: task baru → scope "👥 W" → project baru "Uji W" → simpan (server membuat project di W)
  2  B: form task baru → "👥 W" → dropdown memuat "Uji W"; "Pribadi" → "Uji W" tidak ada
  3  B: Kelola project W → "Uji W" tanpa tombol hapus/ubah; A: tombol hapus tampil
  4  A: rename "Uji W" → "Uji W2" → task W ikut menampilkan "Uji W2"

Server lokal dijalankan sendiri oleh skrip (uvicorn webapp:app, DB sementara). static/index.html
sudah JS biasa (tanpa <script type="text/babel">) → tidak perlu `node compile.js`.
Screenshot per langkah: temporary_files/e2e_project_scope/. Keluar non-zero bila ada langkah gagal.

    python3 temporary_files/e2e_project_scope.py
"""
import os
import re
import socket
import sqlite3
import subprocess
import sys
import tempfile
import time
from datetime import date, datetime, timedelta

import requests
from playwright.sync_api import sync_playwright, expect

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHOTS = os.path.join(ROOT, "temporary_files", "e2e_project_scope")
PW = "rahasia123"
WS = "W"
PROJ = "Uji W"
PROJ2 = "Uji W2"
PROJ_B = "Rumah Budi"  # project pribadi B: penanda dropdown scope "Pribadi" sudah dimuat (langkah 2c)
TASK_TITLE = "Task uji scope W"
SECRET = "e2e-project-scope-secret"
TOURS = ['dashboard', 'tasks', 'today', 'calendar', 'kanban', 'notes', 'mindmap', 'chat', 'habits', 'habit',
         'settings', 'draw', 'goals', 'review', 'focus', 'workspace', 'slist']

results = []  # (langkah, ok, keterangan)


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


def api(base, user, method, path, **kw):
    r = requests.request(method, base + path, headers={"Authorization": "Bearer " + user["token"]}, timeout=10, **kw)
    r.raise_for_status()
    return r.json()


def open_app(browser, base, user):
    ctx = browser.new_context(service_workers="block", viewport={"width": 1280, "height": 900})
    ctx.add_cookies([{"name": "token", "value": user["token"], "url": base, "httpOnly": True, "sameSite": "Lax"}])
    p = ctx.new_page()
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
    page.wait_for_timeout(500)  # animasi modal (fade/scale-in) selesai dulu
    page.screenshot(path=path, full_page=False)
    print("  screenshot", os.path.relpath(path, ROOT), flush=True)


def caption(page, text):
    """Anotasi E2E di pojok layar (isi <select> native tidak ikut ter-screenshot)."""
    page.evaluate("""(t) => { let d = document.getElementById('__e2e_caption');
        if (!d) { d = document.createElement('div'); d.id = '__e2e_caption'; document.body.appendChild(d); }
        d.textContent = 'E2E: ' + t;
        d.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:99999;background:#111;color:#fff;font:12px monospace;padding:6px 10px;border-radius:6px;max-width:90vw'; }""", text)


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


def local_scope_names(page, list_id):
    return page.evaluate("(id) => window.TF && window.TF.projectcache ? window.TF.projectcache.names(id) : []", list_id)


def open_new_task_form(page, base):
    page.goto(base + "/?action=new-task")
    page.locator("label.input-label", has_text="Judul *").wait_for(timeout=20000)


def project_select(page, label):
    """ComboSelect project = elemen setelah label 'Project · …'."""
    lab = page.locator("label.input-label", has_text=re.compile("^" + re.escape(label) + "$"))
    lab.wait_for(timeout=10000)
    return lab.locator("xpath=following-sibling::*[1]")


def option_values(sel):
    return sel.evaluate("el => el.tagName === 'SELECT' ? Array.from(el.options).map(o => o.value) : null")


def goto_workspace(page, base):
    page.goto(base + "/")  # muat ulang = tutup form/modal yang terbuka
    page.locator(".sidebar-link").first.wait_for(state="attached", timeout=20000)
    expand = page.locator("button[aria-label='Tampilkan semua menu']")
    if expand.count() and expand.first.is_visible():
        expand.first.click()
    link = page.locator(".sidebar-link").filter(has=page.locator("span", has_text=re.compile("^" + WS + "$")))
    link.first.click()
    page.locator(".workspace-nav-tabs").wait_for(timeout=10000)


def open_manager(page):
    page.locator(".workspace-nav-tabs button", has_text="Kelola project").click()
    dlg = page.get_by_role("dialog", name="Kelola project")
    dlg.wait_for(timeout=10000)
    return dlg


def manager_row(dlg, name):
    # baris = div yang memuat nama project (div bold persis = name)
    title = dlg.locator("div", has_text=re.compile("^" + re.escape(name) + "$")).last
    title.wait_for(timeout=15000)
    return title.locator("xpath=../..")


def main():
    os.makedirs(SHOTS, exist_ok=True)
    for f in os.listdir(SHOTS):
        if f.endswith(".png"):
            os.remove(os.path.join(SHOTS, f))
    tmp = tempfile.mkdtemp(prefix="e2e_project_scope_")
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
        check("setup: B anggota W", any(l["id"] == ws_id for l in api(base, B, "GET", "/api/lists")))
        api(base, B, "POST", "/api/tasks", json={"title": "Task pribadi B", "project": PROJ_B})
        check("setup: B punya project pribadi '%s'" % PROJ_B, PROJ_B in api(base, B, "GET", "/api/projects"))
        deadline = (date.today() + timedelta(days=3)).isoformat()

        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            ctxA, a = open_app(browser, base, A)
            ctxB, b = open_app(browser, base, B)

            # ── 1. A: task baru di W dengan project baru "Uji W" ──────────────────────
            open_new_task_form(a, base)
            a.locator("input[placeholder^='Judul task']").fill(TASK_TITLE)
            a.locator(".task-quick-attributes input[type=date]").fill(deadline)
            scope = a.locator("select[aria-label='Scope task']")
            scope.select_option(label="👥 " + WS)
            sel = project_select(a, "Project · " + WS)
            check("1a label 'Project · W' setelah pilih scope", sel.count() == 1)
            assign = a.locator(".task-quick-attributes select[aria-label='Assign ke']")
            check("1a2 'Assign ke' tampil di baris cepat setelah pilih scope W (tanpa buka Opsi Tambahan)",
                  wait_until(lambda: assign.is_visible(), 10))
            sel.select_option(value="__new__")
            inp = project_select(a, "Project · " + WS).locator("input")
            inp.wait_for()
            inp.fill(PROJ)
            shot(a, "01_A_form_task_W_project_baru.png")
            a.locator("button[type=submit]", has_text=re.compile("^Tambah$")).click()
            a.locator("label.input-label", has_text="Judul *").wait_for(state="detached", timeout=15000)
            shot(a, "01b_A_task_tersimpan.png")

            def server_has(name):
                sync_now(a)
                return name in api(base, A, "GET", "/api/projects?list_id=%d" % ws_id)
            ok = wait_until(lambda: server_has(PROJ), 30)
            check("1b server: project 'Uji W' ada di scope W", ok)
            tasks = api(base, A, "GET", "/api/tasks?include_done=true")
            t = next((x for x in tasks if x["title"] == TASK_TITLE), None)
            check("1c server: task di W dengan project 'Uji W'",
                  t and t.get("list_id") == ws_id and t.get("project") == PROJ, repr(t and (t.get("list_id"), t.get("project"))))
            check("1d server: 'Uji W' bukan project pribadi A",
                  PROJ not in api(base, A, "GET", "/api/projects"))

            # ── 2. B: dropdown project per scope ─────────────────────────────────────
            def b_cache():
                sync_now(b)
                return PROJ in local_scope_names(b, ws_id) and PROJ_B in local_scope_names(b, None)
            check("2a B: sync menarik 'Uji W' ke cache lokal", wait_until(b_cache, 30))
            open_new_task_form(b, base)
            b.locator("select[aria-label='Scope task']").select_option(label="👥 " + WS)
            sel = project_select(b, "Project · " + WS)
            got = wait_until(lambda: PROJ in (option_values(sel) or []), 10)
            check("2b B: scope '👥 W' → dropdown memuat 'Uji W'", got, repr(option_values(sel)))
            sel.select_option(value=PROJ)
            caption(b, "B · scope 👥 W · opsi project = %r" % option_values(sel))
            shot(b, "02_B_scope_W_dropdown_memuat_Uji_W.png")
            b.locator("select[aria-label='Scope task']").select_option(label="Pribadi")
            sel = project_select(b, "Project · Pribadi")
            # tunggu sampai opsi benar-benar daftar scope pribadi (project pribadi B muncul), baru cek negatif
            loaded = wait_until(lambda: PROJ_B in (option_values(sel) or []), 10)
            vals = option_values(sel) or []
            check("2c B: scope 'Pribadi' → opsi memuat '%s' dan 'Uji W' tidak ada" % PROJ_B,
                  loaded and PROJ not in vals, repr(vals))
            check("2d B: ganti ke 'Pribadi' mengosongkan pilihan 'Uji W'", sel.input_value() == "", repr(sel.input_value()))
            caption(b, "B · scope Pribadi · opsi project = %r · terpilih = %r" % (vals, sel.input_value()))
            shot(b, "03_B_scope_Pribadi_tanpa_Uji_W.png")

            # ── 3. Kelola project W: B tanpa tombol hapus, A dengan tombol hapus ───────
            goto_workspace(b, base)
            dlg = open_manager(b)
            row = manager_row(dlg, PROJ)
            check("3a B: Kelola project W menampilkan 'Uji W'", row.count() == 1)
            check("3b B: tanpa tombol Hapus", row.get_by_role("button", name="Hapus").count() == 0)
            check("3c B: tanpa tombol Ubah", row.get_by_role("button", name="Ubah").count() == 0)
            shot(b, "04_B_kelola_project_tanpa_hapus.png")
            b.keyboard.press("Escape")

            goto_workspace(a, base)
            dlg = open_manager(a)
            row = manager_row(dlg, PROJ)
            check("3d A: tombol Hapus tampil", row.get_by_role("button", name="Hapus").count() == 1)
            shot(a, "05_A_kelola_project_dengan_hapus.png")

            # ── 4. A: rename "Uji W" → "Uji W2", task W ikut ──────────────────────────
            row.get_by_role("button", name="Ubah").click()
            name_in = dlg.locator("input[aria-label='Nama project']")
            name_in.fill(PROJ2)
            shot(a, "06_A_rename_Uji_W2.png")
            dlg.get_by_role("button", name="Simpan").click()
            row2 = manager_row(dlg, PROJ2)
            check("4a A: Kelola project menampilkan 'Uji W2'", row2.count() == 1)
            check("4b A: 'Uji W' lama hilang dari modal",
                  dlg.locator("div", has_text=re.compile("^" + re.escape(PROJ) + "$")).count() == 0)
            shot(a, "07_A_kelola_setelah_rename.png")
            a.keyboard.press("Escape")
            dlg.wait_for(state="detached", timeout=5000)

            tasks = api(base, A, "GET", "/api/tasks?include_done=true")
            t = next((x for x in tasks if x["title"] == TASK_TITLE), None)
            check("4c server: task W berproject 'Uji W2'", t and t.get("project") == PROJ2, repr(t and t.get("project")))

            # UI A: task W di halaman workspace menampilkan project baru
            def a_task_shows():
                sync_now(a)
                card = a.locator("text=" + TASK_TITLE).first
                if card.count() == 0:
                    return False
                return a.get_by_text(PROJ2, exact=False).count() > 0 and a.get_by_text(re.compile(r"\b" + re.escape(PROJ) + r"$")).count() == 0
            check("4d A: halaman W menampilkan task dengan project 'Uji W2'", wait_until(a_task_shows, 30))
            shot(a, "08_A_task_W_project_Uji_W2.png")
            rec = a.evaluate("""(title) => new Promise((res) => { const r = indexedDB.open('taskflow-offline');
                r.onsuccess = () => { try { const tx = r.result.transaction('tasks'); const q = tx.objectStore('tasks').getAll();
                q.onsuccess = () => res((q.result || []).filter(x => x.title === title).map(x => x.project)); q.onerror = () => res(null);
                } catch (e) { res('err:' + e.message); } }; r.onerror = () => res(null); })""", TASK_TITLE)
            print("  IndexedDB A project task W:", rec, flush=True)

            # B ikut melihat rename setelah sync (perangkat lain)
            def b_task_shows():
                sync_now(b)
                return PROJ2 in local_scope_names(b, ws_id) and PROJ not in local_scope_names(b, ws_id)
            check("4e B: setelah sync daftar scope W = 'Uji W2' (tanpa 'Uji W')", wait_until(b_task_shows, 30),
                  repr(local_scope_names(b, ws_id)))
            goto_workspace(b, base)
            b.get_by_text(PROJ2).first.wait_for(timeout=15000)
            shot(b, "09_B_task_W_project_Uji_W2.png")

            ctxA.close()
            ctxB.close()
            browser.close()
    except Exception as e:  # langkah yang melempar = gagal
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
