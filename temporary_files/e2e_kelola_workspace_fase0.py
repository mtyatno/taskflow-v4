"""E2E Kelola Workspace Fase 0 (spec 2026-10-20-kelola-workspace-fase0, brief Task 5). Tidak dijalankan CI.

Akun A (owner) dan B (anggota). Workspace: W "Proyek Alfa" (A + B), W2 "Solo Dua" (hanya A), W3 "Tim Tiga" (A + B).
Langkah 1–3 dijalankan di tema terang lalu gelap (tidak merusak data); 4–5 di tema terang, lalu screenshot gelap.
  1  Daftar anggota W: baris pertama A berlabel "Owner", lalu B; W2 → "Belum ada anggota lain."; kartu W "2 anggota".
  2  Dialog hapus W: ringkasan memuat baris task; nama salah → "Hapus permanen" nonaktif; kapital beda + spasi →
     aktif. Esc menutup dan fokus kembali ke tombol Hapus.
  3  Offline (context.set_offline) → "Hapus workspace butuh koneksi internet", tombol nonaktif.
  4  Keluarkan B dari W3 (dialog "Keluarkan …?"): task aktif B tanpa penanggung jawab, task selesai B tetap (API).
  5  Hapus W (task B di W sudah tersinkron di IndexedDB B dan A): setelah sync, di perangkat B task itu tetap ada
     dengan list_id null (task pribadi B, tampil di Inbox B); di perangkat A task itu hilang dari store lokal.
  6  Tidak ada teks "shared list" di halaman; screenshot terang + gelap tiap langkah.

Server lokal: uvicorn webapp:app, DB sementara. Screenshot: temporary_files/e2e_kelola_workspace_fase0/.
Keluar non-zero bila ada langkah gagal.

    python temporary_files/e2e_kelola_workspace_fase0.py
"""
import os
import socket
import subprocess
import sys
import tempfile
import time

import requests
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHOTS = os.path.join(ROOT, "temporary_files", "e2e_kelola_workspace_fase0")
PW = "rahasia123"
SECRET = "e2e-kelola-workspace-fase0-secret"
TOURS = ['dashboard', 'tasks', 'today', 'calendar', 'kanban', 'notes', 'mindmap', 'chat', 'habits', 'habit',
         'settings', 'draw', 'goals', 'review', 'focus', 'workspace', 'slist', 'all', 'inbox',
         'done', 'overdue', 'next', 'waiting', 'someday']
W_NAME, W2_NAME, W3_NAME = "Proyek Alfa", "Solo Dua", "Tim Tiga"
OFFLINE_TEXT = "Hapus workspace butuh koneksi internet"
B_TASK = "Task B di Proyek Alfa"
A_TASK = "Task A di Proyek Alfa"

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
    proc = subprocess.Popen([os.environ.get("E2E_PYTHON") or sys.executable, "-m", "uvicorn", "webapp:app",
                             "--host", "127.0.0.1", "--port", str(port)],
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


_seq = [0]


def register(base, name, display):
    _seq[0] += 1
    u = "%s%d%d" % (name, int(time.time() * 1000) % 1_000_000, _seq[0])
    r = requests.post(base + "/api/auth/register",
                      json={"username": u, "password": PW, "email": u + "@ex.com", "display_name": display})
    r.raise_for_status()
    j = r.json()
    return {"username": u, "id": j["user_id"], "token": j["token"], "display": display}


def api(base, user, method, path, ok_codes=(200, 201), **kw):
    r = requests.request(method, base + path, headers={"Authorization": "Bearer " + user["token"]}, timeout=10, **kw)
    if r.status_code not in ok_codes:
        raise RuntimeError("%s %s → %d %s" % (method, path, r.status_code, r.text[:200]))
    return r.json()


def open_app(browser, base, user, theme="light"):
    ctx = browser.new_context(service_workers="block", viewport={"width": 1280, "height": 860})
    ctx.add_cookies([{"name": "token", "value": user["token"], "url": base, "httpOnly": True, "sameSite": "Lax"}])
    p = ctx.new_page()
    p.goto(base + "/manifest.json")
    p.evaluate("""([t, u, tours, theme]) => {
        localStorage.setItem('tf_token', t); localStorage.setItem('tf_user_id', String(u));
        for (const pg of tours) localStorage.setItem('tf_tour_' + pg, '1');
        localStorage.setItem('tf_dismiss_onboarding', '1');
        localStorage.setItem('tf_shortcut_hint', '1');
        localStorage.setItem('tf_theme', theme);
    }""", [user["token"], user["id"], TOURS, theme])
    p.goto(base + "/")
    p.locator(".sidebar-link").first.wait_for(state="attached", timeout=20000)
    return ctx, p


def shot(page, name):
    page.mouse.move(5, 5)
    page.wait_for_timeout(400)
    path = os.path.join(SHOTS, name)
    page.screenshot(path=path, full_page=False)
    print("  screenshot", os.path.relpath(path, ROOT), flush=True)


def wait_until(fn, timeout=15, interval=0.3):
    end = time.time() + timeout
    last = None
    while time.time() < end:
        try:
            last = fn()
            if last:
                return last
        except Exception:  # noqa: BLE001
            pass
        time.sleep(interval)
    return last


def nav_to(p, label):
    link = p.locator(".sidebar-link").filter(has_text=label).first
    if not link.is_visible():
        p.locator("button[aria-label='Tampilkan semua menu']").first.click()
    link.click()


def open_manage(p):
    nav_to(p, "Kelola Workspace")
    p.locator("h2").filter(has_text="Kelola Workspace").first.wait_for(timeout=10000)


def sync_now(page):
    page.evaluate("() => typeof window.__syncNow === 'function' ? Promise.resolve(window.__syncNow()).catch(() => null) : null")


IDB_BY_TITLE = """(title) => new Promise((res) => { const r = indexedDB.open('taskflow-offline');
    r.onsuccess = () => { try { const q = r.result.transaction('tasks').objectStore('tasks').getAll();
      q.onsuccess = () => res((q.result || []).filter(x => x.title === title && !x.deleted)
        .map(x => ({ list_id: x.list_id == null ? null : x.list_id, server_id: x.server_id == null ? null : x.server_id })));
      q.onerror = () => res(null);
    } catch (e) { res('err:' + e.message); } }; r.onerror = () => res(null); })"""


def idb_tasks(page, title):
    return page.evaluate(IDB_BY_TITLE, title)


def kelola_btn(p, lid):
    return p.locator("button[aria-controls='ws-panel-%d']" % lid)


def card(p, lid):
    return kelola_btn(p, lid).locator("xpath=ancestor::div[3]")


def hapus_btn(p, lid):
    return card(p, lid).get_by_role("button", name="Hapus", exact=True)


def panel(p, lid):
    return p.locator("#ws-panel-%d" % lid)


def member_rows(p, lid):
    # Fase 1: daftar anggota di dalam WorkspaceMembersSection (panel > heading, section > baris)
    return panel(p, lid).locator(":scope > div > div").filter(has=p.locator("span", has_text="@"))


def expand(p, lid):
    if kelola_btn(p, lid).get_attribute("aria-expanded") != "true":
        kelola_btn(p, lid).click()
    panel(p, lid).wait_for(timeout=5000)
    wait_until(lambda: panel(p, lid).inner_text().find("Memuat") < 0, 10)


def collapse(p, lid):
    if kelola_btn(p, lid).get_attribute("aria-expanded") == "true":
        kelola_btn(p, lid).click()


def dialog(p):
    return p.locator("form[role=dialog]")


def no_shared_list(p, step):
    txt = p.locator("#root").inner_text().lower()
    check(step, "shared list" not in txt)


def ui_steps_1_to_3(browser, base, A, B, ids, theme):
    tag = "terang" if theme == "light" else "gelap"
    ctx, p = open_app(browser, base, A, theme)
    try:
        got = p.evaluate("() => document.documentElement.getAttribute('data-theme')")
        check("[%s] tema aktif" % tag, (got or "light") == theme, repr(got))
        open_manage(p)
        W, W2 = ids["W"], ids["W2"]
        kelola_btn(p, W).wait_for(timeout=10000)

        # ── 1. daftar anggota ────────────────────────────────────────────────────────────────────
        ctext = card(p, W).inner_text()
        check("[%s] 1a kartu W menulis '2 anggota'" % tag, "2 anggota" in ctext, repr(ctext[:120]))
        check("[%s] 1b kartu W2 menulis '1 anggota'" % tag, "1 anggota" in card(p, W2).inner_text())
        expand(p, W)
        rows = member_rows(p, W)
        n = rows.count()
        r0 = rows.nth(0).inner_text() if n > 0 else ""
        r1 = rows.nth(1).inner_text() if n > 1 else ""
        check("[%s] 1c W: 2 baris anggota" % tag, n == 2, "n=%d" % n)
        check("[%s] 1d baris pertama A berlabel 'Owner' (tanpa tombol Keluarkan)" % tag,
              ("@" + A["username"]) in r0 and "Owner" in r0 and "Keluarkan" not in r0, repr(r0))
        check("[%s] 1e baris kedua B dengan tombol Keluarkan" % tag,
              ("@" + B["username"]) in r1 and "Keluarkan" in r1 and "Owner" not in r1, repr(r1))
        check("[%s] 1f W tidak menampilkan 'Belum ada anggota lain.'" % tag,
              "Belum ada anggota lain." not in panel(p, W).inner_text())
        shot(p, "1a_anggota_W_%s.png" % tag)
        collapse(p, W)
        expand(p, W2)
        ptxt = panel(p, W2).inner_text()
        check("[%s] 1g W2: owner + 'Belum ada anggota lain.'" % tag,
              "Belum ada anggota lain." in ptxt and ("@" + A["username"]) in ptxt and "Owner" in ptxt, repr(ptxt[:160]))
        shot(p, "1b_W2_tanpa_anggota_%s.png" % tag)
        collapse(p, W2)
        no_shared_list(p, "[%s] 6a halaman Kelola tanpa teks 'shared list'" % tag)

        # ── 2. dialog hapus ──────────────────────────────────────────────────────────────────────
        hapus_btn(p, W).click()
        d = dialog(p)
        d.wait_for(timeout=5000)
        check("[%s] 2a judul dialog" % tag, d.get_by_text('Hapus workspace "%s"?' % W_NAME, exact=True).count() == 1)
        li = d.locator("li")
        li.first.wait_for(timeout=10000)
        lines = li.all_inner_texts()
        check("[%s] 2b ringkasan memuat baris task" % tag,
              any("2 task (2 aktif) akan kembali menjadi task pribadi pembuatnya" == x for x in lines), repr(lines))
        focus_in_input = p.evaluate("() => document.activeElement && document.activeElement.tagName === 'INPUT'")
        check("[%s] 2c fokus di input konfirmasi" % tag, focus_in_input)
        inp = d.get_by_label("Ketik nama workspace untuk konfirmasi")
        submit = d.get_by_role("button", name="Hapus permanen")
        check("[%s] 2d kosong → 'Hapus permanen' nonaktif" % tag, submit.is_disabled())
        inp.fill("Proyek Alfa salah")
        check("[%s] 2e nama salah → nonaktif" % tag, submit.is_disabled())
        shot(p, "2a_dialog_nama_salah_%s.png" % tag)
        inp.fill("  proyek ALFA  ")
        check("[%s] 2f kapital beda + spasi → aktif" % tag, wait_until(lambda: submit.is_enabled(), 3))
        shot(p, "2b_dialog_nama_cocok_%s.png" % tag)
        no_shared_list(p, "[%s] 6b dialog hapus tanpa teks 'shared list'" % tag)
        p.keyboard.press("Escape")
        check("[%s] 2g Esc menutup dialog" % tag, wait_until(lambda: dialog(p).count() == 0, 3))
        check("[%s] 2h fokus kembali ke tombol Hapus W" % tag,
              hapus_btn(p, W).evaluate("el => el === document.activeElement"))
        check("[%s] 2i workspace W masih ada" % tag, kelola_btn(p, W).count() == 1)

        # ── 3. offline ───────────────────────────────────────────────────────────────────────────
        ctx.set_offline(True)
        hapus_btn(p, W).click()
        d = dialog(p)
        d.wait_for(timeout=5000)
        check("[%s] 3a offline: '%s'" % (tag, OFFLINE_TEXT),
              wait_until(lambda: d.get_by_text(OFFLINE_TEXT).count() == 1, 5))
        d.get_by_label("Ketik nama workspace untuk konfirmasi").fill(W_NAME)
        check("[%s] 3b offline: 'Hapus permanen' nonaktif walau nama cocok" % tag,
              d.get_by_role("button", name="Hapus permanen").is_disabled())
        shot(p, "3_offline_%s.png" % tag)
        p.keyboard.press("Escape")
        wait_until(lambda: dialog(p).count() == 0, 3)
        ctx.set_offline(False)
    finally:
        ctx.close()


def main():
    os.makedirs(SHOTS, exist_ok=True)
    for f in os.listdir(SHOTS):
        if f.endswith(".png"):
            os.remove(os.path.join(SHOTS, f))
    tmp = tempfile.mkdtemp(prefix="e2e_kelola_ws_f0_")
    proc, base = start_server(tmp)
    print("server", base, flush=True)
    try:
        A = register(base, "ana", "Ana")
        B = register(base, "budi", "Budi")
        ids = {}
        for k, name in (("W", W_NAME), ("W2", W2_NAME), ("W3", W3_NAME)):
            ids[k] = api(base, A, "POST", "/api/lists", json={"name": name})["id"]
        for k in ("W", "W3"):
            api(base, A, "POST", "/api/lists/%d/invite" % ids[k], json={"username": B["username"]})
        a_task = api(base, A, "POST", "/api/tasks", json={"title": A_TASK, "list_id": ids["W"]})
        b_task = api(base, B, "POST", "/api/tasks", json={"title": B_TASK, "list_id": ids["W"]})
        w3_active = api(base, A, "POST", "/api/tasks", json={"title": "Aktif B W3", "list_id": ids["W3"],
                                                              "assigned_to": B["id"]})
        w3_done = api(base, A, "POST", "/api/tasks", json={"title": "Selesai B W3", "list_id": ids["W3"],
                                                            "assigned_to": B["id"]})
        api(base, A, "POST", "/api/tasks/%d/done" % w3_done["id"])
        chk = api(base, A, "GET", "/api/tasks/%d" % w3_active["id"])
        check("setup: task aktif W3 ditugaskan ke B", chk.get("assigned_to") == B["id"], repr(chk.get("assigned_to")))

        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            for theme in ("light", "dark"):
                ui_steps_1_to_3(browser, base, A, B, ids, theme)

            # Perangkat B: task B di W tersinkron ke IndexedDB B.
            ctxb, b = open_app(browser, base, B)
            ok = wait_until(lambda: (sync_now(b) or True) and idb_tasks(b, B_TASK) == [
                {"list_id": ids["W"], "server_id": b_task["id"]}], 30)
            check("5a pra: IndexedDB B memuat task B dengan list_id W", ok, repr(idb_tasks(b, B_TASK)))

            ctx, a = open_app(browser, base, A)
            ok = wait_until(lambda: (sync_now(a) or True) and len(idb_tasks(a, B_TASK) or []) == 1
                            and idb_tasks(a, B_TASK)[0]["list_id"] == ids["W"], 30)
            check("5b pra: IndexedDB A memuat task B (workspace W)", ok, repr(idb_tasks(a, B_TASK)))
            open_manage(a)

            # ── 4. keluarkan B dari W3 ───────────────────────────────────────────────────────────
            W3 = ids["W3"]
            kelola_btn(a, W3).wait_for(timeout=10000)
            expand(a, W3)
            panel(a, W3).get_by_role("button", name="Keluarkan %s" % B["display"], exact=True).click()
            title = "Keluarkan %s dari workspace ini?" % B["display"]
            a.get_by_text(title, exact=True).wait_for(timeout=5000)
            check("4a dialog '%s'" % title, True)
            shot(a, "4a_dialog_keluarkan_terang.png")
            no_shared_list(a, "6c dialog keluarkan tanpa teks 'shared list'")
            a.get_by_role("button", name="Keluarkan", exact=True).click()
            check("4b panel W3: 'Belum ada anggota lain.'",
                  wait_until(lambda: "Belum ada anggota lain." in panel(a, W3).inner_text(), 10))
            check("4c kartu W3 '1 anggota'", wait_until(lambda: "1 anggota" in card(a, W3).inner_text(), 10),
                  repr(card(a, W3).inner_text()[:100]))
            act = api(base, A, "GET", "/api/tasks/%d" % w3_active["id"])
            don = api(base, A, "GET", "/api/tasks/%d" % w3_done["id"])
            check("4d API: task aktif B di W3 tanpa penanggung jawab", act.get("assigned_to") is None,
                  repr(act.get("assigned_to")))
            check("4e API: task selesai B di W3 tetap ditugaskan ke B", don.get("assigned_to") == B["id"],
                  repr(don.get("assigned_to")))
            shot(a, "4b_setelah_keluarkan_terang.png")
            collapse(a, W3)

            # ── 5. hapus W ───────────────────────────────────────────────────────────────────────
            W = ids["W"]
            hapus_btn(a, W).click()
            d = dialog(a)
            d.locator("li").first.wait_for(timeout=10000)
            d.get_by_label("Ketik nama workspace untuk konfirmasi").fill(W_NAME.upper())
            d.get_by_role("button", name="Hapus permanen").click()
            check("5c dialog tertutup + kartu W hilang",
                  wait_until(lambda: dialog(a).count() == 0 and kelola_btn(a, W).count() == 0, 10))
            check("5d toast 'Workspace dihapus'",
                  wait_until(lambda: a.locator(".toast").filter(has_text="Workspace dihapus").count() >= 1, 5))
            shot(a, "5a_A_setelah_hapus_terang.png")
            bt = api(base, B, "GET", "/api/tasks/%d" % b_task["id"])
            check("5e API: task B kembali pribadi B (list_id null)", bt.get("list_id") is None, repr(bt.get("list_id")))
            at = api(base, A, "GET", "/api/tasks/%d" % a_task["id"])
            check("5f API: task A kembali pribadi A", at.get("list_id") is None, repr(at.get("list_id")))

            ok = wait_until(lambda: (sync_now(b) or True) and idb_tasks(b, B_TASK) == [
                {"list_id": None, "server_id": b_task["id"]}], 30)
            check("5g setelah sync B: task B tetap ada dengan list_id null", ok, repr(idb_tasks(b, B_TASK)))
            ok = wait_until(lambda: (sync_now(a) or True) and idb_tasks(a, B_TASK) == [], 30)
            check("5h setelah sync A: task B hilang dari store lokal A", ok, repr(idb_tasks(a, B_TASK)))
            ok = wait_until(lambda: (sync_now(a) or True) and idb_tasks(a, A_TASK) == [
                {"list_id": None, "server_id": a_task["id"]}], 30)
            check("5i setelah sync A: task A tetap ada dengan list_id null", ok, repr(idb_tasks(a, A_TASK)))

            b.reload()
            b.locator(".sidebar-link").first.wait_for(state="attached", timeout=20000)
            nav_to(b, "Inbox")
            check("5j B: task tampil di Inbox pribadi B",
                  wait_until(lambda: b.get_by_text(B_TASK, exact=True).count() >= 1, 15))
            shot(b, "5b_B_inbox_terang.png")
            no_shared_list(b, "6d halaman B tanpa teks 'shared list'")
            open_manage(b)
            check("5k B: W tidak lagi ada di Kelola Workspace B",
                  wait_until(lambda: b.get_by_text(W_NAME, exact=True).count() == 0, 10))
            ctx.close()
            ctxb.close()

            # Screenshot gelap hasil langkah 4–5.
            ctxd, ad = open_app(browser, base, A, "dark")
            open_manage(ad)
            kelola_btn(ad, W3).wait_for(timeout=10000)
            expand(ad, W3)
            check("6e [gelap] W3 'Belum ada anggota lain.' dan W tidak ada",
                  "Belum ada anggota lain." in panel(ad, W3).inner_text() and kelola_btn(ad, W).count() == 0)
            shot(ad, "4b_5a_A_setelah_keluarkan_hapus_gelap.png")
            ctxd.close()
            ctxbd, bd = open_app(browser, base, B, "dark")
            nav_to(bd, "Inbox")
            check("6f [gelap] B: task tampil di Inbox",
                  wait_until(lambda: bd.get_by_text(B_TASK, exact=True).count() >= 1, 15))
            shot(bd, "5b_B_inbox_gelap.png")
            ctxbd.close()
            browser.close()
    except Exception as e:  # noqa: BLE001
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
