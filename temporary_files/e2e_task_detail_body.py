"""E2E modal detail task setelah isinya dipisah ke TaskDetailBody (PR A "Live Edit"): perilaku harus sama
dengan sebelum refaktor. Tidak dijalankan CI. Bisa dijalankan juga di `main` (salin skrip ke worktree main)
untuk membandingkan screenshot secara visual.

Empat kombinasi: 1280 px dan 375 px, masing-masing terang dan gelap. Tiap kombinasi:
  a  buka task dari daftar "Semua Task" → modal tampil, judul benar, ✕ ada di KANAN judul (di dalam modal)
  b  ✕ menutup modal; klik overlay (di luar modal) juga menutup
  d  klik tag → overlay "Task dengan tag" menutupi seluruh `.modal-content` (bounding box sama); × menutup overlay
  e  klik task anak di bagian Subtask → modal berpindah ke task anak (judul + id anak)
  c  ✏️ Edit → ubah Priority ke P1 → 💾 Simpan → modal tertutup; server P1; setelah reload badge P1 tampil
     (dikerjakan terakhir: PUT form dari modal ke router lokal menimpa tag task dengan tag dari judul)
  f  tidak ada error konsol / pageerror dari aplikasi (permintaan ke host luar diblokir; errornya diabaikan)

Tag task hidup di IndexedDB (GET /api/tasks/:id/tags dilayani router lokal; tag dari server tidak turun), jadi
skrip memasangnya lewat TF.tagrepo setelah daftar task termuat.

Server lokal dijalankan sendiri (uvicorn webapp:app, DB sementara). Screenshot: temporary_files/e2e_task_detail_body/
(atau $E2E_SHOTS_DIR). Keluar non-zero bila ada langkah gagal.

    python3 temporary_files/e2e_task_detail_body.py
"""
import os
import re
import socket
import subprocess
import sys
import tempfile
import time

import requests
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
with open(os.path.join(ROOT, "static", "sw.js"), encoding="utf-8") as _f:
    # Versi SW saat ini: ditulis ke tf_whatsnew_seen agar modal "Apa yang baru" tidak menutupi UI.
    SW_VERSION = re.search(r'^const CACHE = "([^"]+)";', _f.read(), re.M).group(1)
SHOTS = os.environ.get("E2E_SHOTS_DIR") or os.path.join(ROOT, "temporary_files", "e2e_task_detail_body")
PW = "rahasia123"
SECRET = "e2e-task-detail-body-secret"
TOURS = ['dashboard', 'tasks', 'today', 'calendar', 'kanban', 'notes', 'mindmap', 'chat', 'habits', 'habit',
         'settings', 'draw', 'goals', 'review', 'focus', 'workspace', 'slist', 'next', 'inbox', 'all', 'alltasks']
T_PARENT = "Siapkan laporan bulanan"
T_CHILD = "Kumpulkan data penjualan"
T_OTHER = "Kirim laporan ke tim"
TAG = "laporan"
COMBOS = [  # (label, lebar, tinggi, tema)
    ("1280", 1280, 860, "light"),
    ("1280", 1280, 860, "dark"),
    ("375", 375, 812, "light"),
    ("375", 375, 812, "dark"),
]

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


def open_app(browser, base, user, w, h, theme, errors):
    """Konteks baru; error konsol/pageerror milik aplikasi (host lokal) dikumpulkan ke `errors`."""
    mobile = w < 500
    ctx = browser.new_context(service_workers="block", viewport={"width": w, "height": h},
                              device_scale_factor=1, is_mobile=mobile, has_touch=mobile)
    ctx.add_cookies([{"name": "token", "value": user["token"], "url": base, "httpOnly": True, "sameSite": "Lax"}])
    # Host luar (font, CDN) diblokir: hasil deterministik dan error muatnya bukan milik aplikasi.
    ctx.route(re.compile(r"^(?!http://127\.0\.0\.1).*$"), lambda route: route.abort())
    p = ctx.new_page()

    def on_console(msg):
        if msg.type != "error":
            return
        url = (msg.location or {}).get("url", "") or ""
        if url and not url.startswith(base):
            return  # muat sumber luar yang kita blokir
        errors.append("console: " + msg.text[:200] + (" @ " + url if url else ""))

    p.on("console", on_console)
    p.on("pageerror", lambda e: errors.append("pageerror: " + str(e)[:200]))
    p.on("dialog", lambda d: d.accept())
    p.goto(base + "/manifest.json")
    p.evaluate("""([t, u, tours, theme, sw]) => {
        localStorage.setItem('tf_token', t); localStorage.setItem('tf_user_id', String(u));
        for (const pg of tours) localStorage.setItem('tf_tour_' + pg, '1');
        localStorage.setItem('tf_dismiss_onboarding', '1'); localStorage.setItem('tf_onboarded', '1');
        localStorage.setItem('tf_backup_snooze', new Date().toISOString().slice(0, 10));
        localStorage.setItem('tf_whatsnew_seen', sw);
        localStorage.setItem('tf_theme', theme);
        localStorage.setItem('tf_groupby', 'none'); localStorage.setItem('tf_viewmode', 'normal');
    }""", [user["token"], user["id"], TOURS, theme, SW_VERSION])
    p.goto(base + "/")
    p.locator(".sidebar-link").first.wait_for(state="attached", timeout=20000)
    return ctx, p


def go_all_tasks(page, mobile):
    """Buka halaman "Semua Task" lewat sidebar (HP: buka menu ☰ dulu)."""
    if mobile:
        page.locator(".mobile-topbar-main button", has_text="☰").first.click()
        page.wait_for_timeout(400)
    else:
        expand = page.locator("button[aria-label='Tampilkan semua menu']")
        if expand.count() and expand.first.is_visible():
            expand.first.click()
    page.locator(".sidebar-link", has_text="Semua Task").first.click()
    page.locator(".task-row").first.wait_for(timeout=15000)


def open_task(page, title):
    page.locator(".task-row", has_text=title).first.click()
    modal = page.locator(".modal-content").first
    modal.wait_for(timeout=10000)
    page.locator(".modal-content h2", has_text=title).wait_for(timeout=10000)
    return modal


def seed_local_tags(page, titles, tag):
    """Tag task hidup di IndexedDB (GET /api/tasks/:id/tags dilayani router lokal), bukan dibaca dari server:
    pasang tag lewat tagrepo untuk task bertajuk `titles`. Mengembalikan jumlah task yang ditandai."""
    return page.evaluate("""async ([titles, tag]) => {
        const db = await TF.db.openDB();
        const all = await new Promise((res, rej) => {
            const q = db.transaction('tasks', 'readonly').objectStore('tasks').getAll();
            q.onsuccess = () => res(q.result || []); q.onerror = () => rej(q.error);
        });
        let n = 0;
        for (const t of all) if (!t.deleted && titles.includes(t.title)) { await TF.tagrepo.setEntityTags('task', t.cid, [tag]); n++; }
        return n;
    }""", [titles, tag])


def modal_count(page):
    return page.locator(".modal-overlay").count()


def wait_closed(page, timeout=5000):
    try:
        page.locator(".modal-overlay").first.wait_for(state="detached", timeout=timeout)
        return True
    except Exception:  # noqa: BLE001
        return False


def close_btn(page):
    return page.locator(".modal-content span").filter(has_text=re.compile(r"^✕$")).first


def shot(page, name):
    path = os.path.join(SHOTS, name)
    page.wait_for_timeout(400)
    page.screenshot(path=path, full_page=False)
    print("  screenshot", os.path.relpath(path, SHOTS), flush=True)


def wait_until(fn, timeout=15, interval=0.4):
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


def server_priority(base, user, task_id):
    return api(base, user, "GET", "/api/tasks/%d" % task_id).get("priority")


def run_combo(browser, base, user, parent, child, label, w, h, theme):
    tag = "%s-%s" % (label, theme)
    mobile = w < 500
    errors = []
    api(base, user, "PUT", "/api/tasks/%d" % parent["id"], json={"priority": "P3"})  # reset tiap kombinasi
    ctx, p = open_app(browser, base, user, w, h, theme, errors)
    try:
        go_all_tasks(p, mobile)
        n_tagged = seed_local_tags(p, [T_PARENT, T_OTHER], TAG)
        check("%s setup: tag #%s dipasang di task induk dan task lain" % (tag, TAG), n_tagged == 2, repr(n_tagged))

        # ── a. modal tampil, ✕ di kanan judul ─────────────────────────────────────
        modal = open_task(p, T_PARENT)
        check("%s a1 modal tampil dengan judul task" % tag,
              modal.is_visible() and p.locator(".modal-content h2").first.inner_text().strip() == T_PARENT)
        mb = modal.bounding_box()
        hb = p.locator(".modal-content h2").first.bounding_box()
        cb = close_btn(p).bounding_box()
        in_modal = cb["x"] >= mb["x"] and cb["x"] + cb["width"] <= mb["x"] + mb["width"] + 0.5
        check("%s a2 ✕ di kanan judul dan di dalam modal" % tag,
              cb["x"] >= hb["x"] + hb["width"] - 1 and in_modal and cb["y"] < hb["y"] + hb["height"],
              "h2 kanan=%.0f ✕ x=%.0f..%.0f modal %.0f..%.0f" % (hb["x"] + hb["width"], cb["x"], cb["x"] + cb["width"],
                                                              mb["x"], mb["x"] + mb["width"]))
        shot(p, "%s_01_detail.png" % tag)

        # ── b. ✕ dan klik overlay menutup ──────────────────────────────────────────
        close_btn(p).click()
        check("%s b1 ✕ menutup modal" % tag, wait_closed(p))
        open_task(p, T_PARENT)
        p.locator(".modal-overlay").first.click(position={"x": 4, "y": 4})
        check("%s b2 klik overlay menutup modal" % tag, wait_closed(p))

        # ── d. overlay tag menutupi seluruh modal-content ──────────────────────
        modal = open_task(p, T_PARENT)
        chip = modal.locator("span[title='Klik untuk lihat semua task dengan tag ini']").first
        chip.wait_for(timeout=10000)
        # dispatch_event: klik tanpa menggulir modal. Overlay `position: absolute` ikut tergulir bersama isi
        # `.modal-content` (perilaku lama, sama di main), jadi bounding box hanya sama saat scrollTop = 0.
        chip.dispatch_event("click")
        p.get_by_text("Task dengan tag", exact=False).first.wait_for(timeout=10000)
        boxes = p.evaluate("""() => {
            const m = document.querySelector('.modal-content');
            const lab = Array.from(m.querySelectorAll('span')).find(s => (s.textContent || '').startsWith('Task dengan tag'));
            let o = lab;
            while (o && o !== m && getComputedStyle(o).position !== 'absolute') o = o.parentElement;
            if (!o || o === m) return null;
            const r = o.getBoundingClientRect(), q = m.getBoundingClientRect();
            return {o: [r.x, r.y, r.width, r.height], m: [q.x, q.y, q.width, q.height], scroll: m.scrollTop,
                    text: lab.textContent};
        }""")
        ok_box = bool(boxes) and all(abs(a - b) <= 1.5 for a, b in zip(boxes["o"], boxes["m"]))
        check("%s d1 overlay 'Task dengan tag' = bounding box .modal-content" % tag, ok_box, repr(boxes))
        check("%s d2 overlay memuat tag dan task lain bertag sama" % tag,
              boxes and ("#" + TAG) in p.locator(".modal-content").first.inner_text()
              and p.locator(".modal-content", has_text=T_OTHER).count() >= 1)
        shot(p, "%s_02_tag_overlay.png" % tag)
        p.locator(".modal-content button", has_text="\xd7").first.click()
        check("%s d3 × menutup overlay (modal tetap)" % tag,
              wait_until(lambda: not p.get_by_text("Task dengan tag", exact=False).count(), 5) and modal_count(p) == 1)

        # ── e. klik task anak membuka task anak ─────────────────────────────────
        child_row = modal.locator("span", has_text=re.compile("^" + re.escape(T_CHILD) + "$")).first
        child_row.scroll_into_view_if_needed()
        child_row.click()
        check("%s e1 klik task anak → modal berpindah ke task anak" % tag,
              wait_until(lambda: p.locator(".modal-content h2").count() == 1
                         and p.locator(".modal-content h2").first.inner_text().strip() == T_CHILD, 8),
              p.locator(".modal-content h2").first.inner_text() if p.locator(".modal-content h2").count() else "tanpa h2")
        check("%s e2 modal task anak menampilkan id anak (#%d)" % (tag, child["id"]),
              p.locator(".modal-content").first.inner_text().strip().startswith("#%d\n" % child["id"]),
              repr(p.locator(".modal-content").first.inner_text()[:12]))
        shot(p, "%s_03_child.png" % tag)
        close_btn(p).click()
        wait_closed(p)

        # ── c. Edit → priority P1 → Simpan (dikerjakan setelah d/e: menyimpan form lokal menghapus tag) ───
        modal = open_task(p, T_PARENT)
        modal.get_by_role("button", name=re.compile("Edit")).first.click()
        sel = modal.locator("select").first
        sel.wait_for(timeout=5000)
        check("%s c1 mode edit: field judul + select Priority tampil" % tag,
              modal.locator("input.input").first.is_visible() and sel.input_value() == "P3", sel.input_value())
        sel.select_option("P1")
        shot(p, "%s_04_edit.png" % tag)
        modal.locator("button", has_text="\U0001F4BE Simpan").first.click()  # bukan tombol "Simpan" lain (sub-task/catatan)
        check("%s c2 Simpan menutup modal" % tag, wait_closed(p))
        check("%s c3 server menyimpan P1" % tag, wait_until(lambda: server_priority(base, user, parent["id"]) == "P1", 10),
              repr(server_priority(base, user, parent["id"])))
        p.reload()
        p.locator(".sidebar-link").first.wait_for(state="attached", timeout=20000)
        go_all_tasks(p, mobile)
        modal = open_task(p, T_PARENT)
        check("%s c4 setelah reload badge P1 tampil di detail" % tag,
              modal.locator(".badge-p1").first.is_visible() and not modal.locator(".badge-p3").count())

        # ── f. konsol bersih ─────────────────────────────────────────────────────
        check("%s f1 tanpa error konsol/pageerror" % tag, not errors, "; ".join(errors[:5]))
    except Exception as e:  # langkah yang melempar = gagal
        import traceback
        traceback.print_exc()
        check("%s exception" % tag, False, "%s: %s" % (type(e).__name__, str(e)[:300]))
        try:
            shot(p, "%s_zz_error.png" % tag)
        except Exception:  # noqa: BLE001
            pass
    finally:
        ctx.close()


def main():
    os.makedirs(SHOTS, exist_ok=True)
    for f in os.listdir(SHOTS):
        if f.endswith(".png"):
            os.remove(os.path.join(SHOTS, f))
    tmp = tempfile.mkdtemp(prefix="e2e_task_detail_body_")
    proc, base, _db = start_server(tmp)
    print("server", base, "root", ROOT, "SW", SW_VERSION, flush=True)
    try:
        A = register(base, "ana")
        parent = api(base, A, "POST", "/api/tasks", json={
            "title": "%s #%s" % (T_PARENT, TAG), "priority": "P3", "project": "Laporan", "gtd_status": "next",
            "description": "Rekap angka penjualan dan kirim ke tim."})
        child = api(base, A, "POST", "/api/tasks", json={"title": T_CHILD, "parent_id": parent["id"], "priority": "P2"})
        api(base, A, "POST", "/api/tasks", json={"title": "%s #%s" % (T_OTHER, TAG), "priority": "P4"})
        check("setup: task induk (tag #%s), anak, dan task lain bertag sama" % TAG,
              parent["title"] == T_PARENT and child["parent_id"] == parent["id"]
              and [t["name"] for t in api(base, A, "GET", "/api/tasks/%d/tags" % parent["id"])] == [TAG],
              repr((parent["title"], child.get("parent_id"))))
        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            for label, w, h, theme in COMBOS:
                print("== %s px %s ==" % (label, theme), flush=True)
                run_combo(browser, base, A, parent, child, label, w, h, theme)
            browser.close()
    except Exception as e:  # noqa: BLE001
        import traceback
        traceback.print_exc()
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
