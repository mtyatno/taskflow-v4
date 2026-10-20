"""E2E papan Kanban tahap (context per scope). Tidak dijalankan CI.

Dua akun: A pemilik workspace W, B anggota W. Papan = halaman workspace W, Group by Context, mode Kanban.
  1  A: "+ Tahap" "Desain" dan "Review" di W tanpa task → dua kolom kosong di antara "Belum ada tahap" dan "Selesai"
  2  task W (server) diseret dengan mouse ke "Desain" → server: context "Desain" + context_id = id tahap
  3  konteks has_touch: tekan-tahan kartu ≥ 300 ms lalu geser ke "Review" → pindah
  4  seret ke "Selesai" → done; seret keluar ke "Desain" → gtd_status "next"
  5  task berulang ke "Selesai" → occurrence hari ini (Asia/Jakarta) tercatat, kartu tetap di tahapnya
  6  menu "Pindah ke…" memindahkan kartu tanpa drag
  7  "Next Actions" dengan task pribadi + W → pemilih "Papan:" + keterangan task dari scope lain
  8  A: ganti nama, geser kiri, arsip, hapus tahap → B (anggota W) melihat hasilnya setelah sync
  9  offline: "+ Tahap" "QA", task baru (cid) diseret ke "QA" sebelum sync; online + sync → server punya
     tahap "QA" dan task ter-link ke id servernya
  10 (bagian dari 9) task offline ber-id cid bisa diseret sebelum sync

Server lokal dijalankan sendiri (uvicorn webapp:app, DB sementara). Screenshot: temporary_files/e2e_kanban_stages/.
Keluar non-zero bila ada langkah gagal.

    python3 temporary_files/e2e_kanban_stages.py
"""
import os
import re
import socket
import sqlite3
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timedelta, timezone

import requests
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHOTS = os.path.join(ROOT, "temporary_files", "e2e_kanban_stages")
PW = "rahasia123"
WS = "W"
SECRET = "e2e-kanban-stages-secret"
TOURS = ['dashboard', 'tasks', 'today', 'calendar', 'kanban', 'notes', 'mindmap', 'chat', 'habits', 'habit',
         'settings', 'draw', 'goals', 'review', 'focus', 'workspace', 'slist', 'next']
T_MAIN = "Rancang logo"
T_REC = "Standup harian"
T_MENU = "Tulis brief"
T_PERS = "Beli kopi"
T_OFF = "Uji offline"

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


def open_app(browser, base, user, **ctx_opts):
    opts = dict(service_workers="block", viewport={"width": 1400, "height": 900})
    opts.update(ctx_opts)
    ctx = browser.new_context(**opts)
    ctx.add_cookies([{"name": "token", "value": user["token"], "url": base, "httpOnly": True, "sameSite": "Lax"}])
    p = ctx.new_page()
    p.on("dialog", lambda d: d.accept())  # confirm() hapus tahap
    p.goto(base + "/manifest.json")
    p.evaluate("""([t, u, tours]) => {
        localStorage.setItem('tf_token', t); localStorage.setItem('tf_user_id', String(u));
        for (const pg of tours) localStorage.setItem('tf_tour_' + pg, '1');
        localStorage.setItem('tf_dismiss_onboarding', '1');
        localStorage.setItem('tf_groupby', 'context'); localStorage.setItem('tf_viewmode', 'kanban');
    }""", [user["token"], user["id"], TOURS])
    p.goto(base + "/")
    p.locator(".sidebar-link").first.wait_for(state="attached", timeout=20000)
    return ctx, p


def shot(page, name):
    path = os.path.join(SHOTS, name)
    page.wait_for_timeout(400)
    page.screenshot(path=path, full_page=False)
    print("  screenshot", os.path.relpath(path, ROOT), flush=True)


def wait_until(fn, timeout=20, interval=0.5):
    end = time.time() + timeout
    last = None
    while time.time() < end:
        try:
            last = fn()
            if last:
                return last
        except Exception as e:  # noqa: BLE001
            last = None
        time.sleep(interval)
    return last


def sync_now(page):
    page.evaluate("() => typeof window.__syncNow === 'function' ? Promise.resolve(window.__syncNow()).catch(() => null) : null")


def refresh(page):
    page.evaluate("() => typeof window.__refreshTasks === 'function' ? Promise.resolve(window.__refreshTasks()).catch(() => null) : null")


def sidebar_click(page, label):
    expand = page.locator("button[aria-label='Tampilkan semua menu']")
    if expand.count() and expand.first.is_visible():
        expand.first.click()
    link = page.locator(".sidebar-link").filter(has=page.locator("span", has_text=re.compile("^" + re.escape(label) + "$")))
    link.first.click()


def goto_workspace(page, base):
    page.goto(base + "/")
    page.locator(".sidebar-link").first.wait_for(state="attached", timeout=20000)
    sidebar_click(page, WS)
    page.locator(".workspace-nav-tabs").wait_for(timeout=10000)
    page.locator("[data-kanban-board]").wait_for(timeout=15000)


def board(page):
    """[{key, label, cards:[judul]}] urut tampil (kolom + penanda '+ Tahap')."""
    return page.evaluate("""() => {
        const b = document.querySelector('[data-kanban-board]');
        if (!b) return null;
        return Array.from(b.querySelectorAll('[data-kanban-column], [data-kanban-addstage]')).map(c => {
            if (c.hasAttribute('data-kanban-addstage')) return {key: '+', label: '+ Tahap', cards: []};
            const sp = c.querySelector('span');
            return {key: c.getAttribute('data-kanban-column'), label: sp ? sp.childNodes[0].textContent : '',
                    cards: Array.from(c.querySelectorAll('[data-kanban-task]')).map(x => {
                        const t = x.querySelector('span'); return t ? t.textContent : x.textContent; })};
        });
    }""")


def labels(page):
    return [c["label"] for c in (board(page) or [])]


def col_key(page, label):
    for c in board(page) or []:
        if c["label"] == label:
            return c["key"]
    return None


def column_of(page, title):
    for c in board(page) or []:
        if title in c["cards"]:
            return c["label"]
    return None


def card(page, title):
    return page.locator("[data-kanban-task]").filter(has=page.locator("span", has_text=re.compile("^" + re.escape(title) + "$"))).first


def col_box(page, label):
    k = col_key(page, label)
    loc = page.locator('[data-kanban-col="%s"]' % k)
    loc.scroll_into_view_if_needed()
    return loc.bounding_box()


def mouse_drag(page, title, target_label):
    c = card(page, title)
    c.scroll_into_view_if_needed()
    sb = c.bounding_box()
    tb = col_box(page, target_label)
    sx, sy = sb["x"] + sb["width"] / 2, sb["y"] + sb["height"] / 2
    tx, ty = tb["x"] + tb["width"] / 2, tb["y"] + min(120, tb["height"] / 2)
    page.mouse.move(sx, sy)
    page.mouse.down()
    page.mouse.move(sx + 10, sy + 4, steps=3)
    page.mouse.move(tx, ty, steps=20)
    page.wait_for_timeout(150)
    page.mouse.up()


def touch_drag_cdp(page, title, target_label, hold_ms=350):
    """Sentuh asli lewat CDP (Input.dispatchTouchEvent): touchStart, tahan, touchMove bertahap, touchEnd."""
    c = card(page, title)
    c.scroll_into_view_if_needed()
    sb = c.bounding_box()
    tb = col_box(page, target_label)
    sx, sy = sb["x"] + sb["width"] / 2, sb["y"] + sb["height"] / 2
    tx, ty = tb["x"] + tb["width"] / 2, tb["y"] + min(120, tb["height"] / 2)
    cdp = page.context.new_cdp_session(page)
    pt = lambda x, y: [{"x": x, "y": y, "id": 1, "radiusX": 4, "radiusY": 4, "force": 1}]
    cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": pt(sx, sy)})
    page.wait_for_timeout(hold_ms)
    n = 20
    for i in range(1, n + 1):
        x = sx + (tx - sx) * i / n
        y = sy + (ty - sy) * i / n
        cdp.send("Input.dispatchTouchEvent", {"type": "touchMove", "touchPoints": pt(x, y)})
        page.wait_for_timeout(16)
    page.wait_for_timeout(100)
    cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
    cdp.detach()


def touch_drag_synthetic(page, title, target_label, hold_ms=350):
    """Cadangan: PointerEvent sintetis pointerType 'touch' (pointerdown di kartu, tahan, pointermove, pointerup)."""
    c = card(page, title)
    c.scroll_into_view_if_needed()
    sb = c.bounding_box()
    tb = col_box(page, target_label)
    sx, sy = sb["x"] + sb["width"] / 2, sb["y"] + sb["height"] / 2
    tx, ty = tb["x"] + tb["width"] / 2, tb["y"] + min(120, tb["height"] / 2)
    page.evaluate("""([sx, sy]) => { const el = document.elementFromPoint(sx, sy);
        el.dispatchEvent(new PointerEvent('pointerdown', {bubbles: true, cancelable: true, pointerId: 77,
            pointerType: 'touch', isPrimary: true, clientX: sx, clientY: sy, button: 0, buttons: 1})); }""", [sx, sy])
    page.wait_for_timeout(hold_ms)
    n = 15
    for i in range(1, n + 1):
        x = sx + (tx - sx) * i / n
        y = sy + (ty - sy) * i / n
        page.evaluate("""([x, y]) => document.dispatchEvent(new PointerEvent('pointermove', {bubbles: true,
            cancelable: true, pointerId: 77, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y, buttons: 1}))""", [x, y])
        page.wait_for_timeout(16)
    page.evaluate("""([x, y]) => document.dispatchEvent(new PointerEvent('pointerup', {bubbles: true,
        cancelable: true, pointerId: 77, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y, buttons: 0}))""", [tx, ty])


def add_stage_ui(page, name):
    page.locator("[data-kanban-addstage] button[aria-label='+ Tahap']").click()
    inp = page.locator("input[aria-label='Nama tahap baru']")
    inp.fill(name)
    inp.press("Enter")
    return wait_until(lambda: name in labels(page), 15)


def stage_menu(page, label):
    page.get_by_role("button", name="Menu tahap " + label).click()
    return page.get_by_role("group", name="Aksi tahap")


def server_ctx(base, user, ws_id, include_archived=True):
    q = "/api/contexts?format=full&list_id=%d%s" % (ws_id, "&include_archived=1" if include_archived else "")
    return api(base, user, "GET", q)


def server_task(base, user, title):
    return next((t for t in api(base, user, "GET", "/api/tasks?include_done=true") if t["title"] == title), None)


def main():
    os.makedirs(SHOTS, exist_ok=True)
    for f in os.listdir(SHOTS):
        if f.endswith(".png"):
            os.remove(os.path.join(SHOTS, f))
    tmp = tempfile.mkdtemp(prefix="e2e_kanban_stages_")
    proc, base, db_path = start_server(tmp)
    print("server", base, "DB", db_path, flush=True)
    today_jkt = (datetime.now(timezone.utc) + timedelta(hours=7)).date().isoformat()
    try:
        A = register(base, "ana")
        B = register(base, "budi")
        ws_id = api(base, A, "POST", "/api/lists", json={"name": WS})["id"]
        with sqlite3.connect(db_path) as c:
            c.execute("INSERT INTO list_members (list_id, user_id, joined_at) VALUES (?,?,?)",
                      (ws_id, B["id"], datetime.now().isoformat()))
        check("setup: B anggota W", any(l["id"] == ws_id for l in api(base, B, "GET", "/api/lists")))

        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            ctxA, a = open_app(browser, base, A)

            # ── 1. tahap kosong ─────────────────────────────────────────────────────
            goto_workspace(a, base)
            check("1a papan W awal: Belum ada tahap, + Tahap, Selesai",
                  labels(a) == ["Belum ada tahap", "+ Tahap", "Selesai"], repr(labels(a)))
            ok = add_stage_ui(a, "Desain") and add_stage_ui(a, "Review")
            got = labels(a)
            check("1b dua kolom kosong 'Desain','Review' di antara 'Belum ada tahap' dan 'Selesai'",
                  ok and got == ["Belum ada tahap", "Desain", "Review", "+ Tahap", "Selesai"]
                  and all(not c["cards"] for c in board(a) if c["label"] in ("Desain", "Review")), repr(got))
            shot(a, "01_A_tahap_kosong_Desain_Review.png")

            def server_stages():
                sync_now(a)
                names = [x["name"] for x in server_ctx(base, A, ws_id) if not x["archived"]]
                return names == ["Desain", "Review"] and names
            check("1c server: tahap W = Desain, Review (urut)", wait_until(server_stages, 30))
            sid = {x["name"]: x["id"] for x in server_ctx(base, A, ws_id)}

            # ── 2. drag mouse ke Desain ─────────────────────────────────────────────
            api(base, A, "POST", "/api/tasks", json={"title": T_MAIN, "list_id": ws_id, "gtd_status": "next", "priority": "P2"})
            def a_sees(title, col="Belum ada tahap"):
                sync_now(a)
                refresh(a)
                return column_of(a, title) == col
            check("2a task baru tampil di 'Belum ada tahap'", wait_until(lambda: a_sees(T_MAIN), 30), repr(board(a)))
            mouse_drag(a, T_MAIN, "Desain")
            check("2b UI: kartu pindah ke 'Desain' (mouse)", wait_until(lambda: column_of(a, T_MAIN) == "Desain", 10),
                  repr(column_of(a, T_MAIN)))
            shot(a, "02_A_mouse_drag_ke_Desain.png")

            def server_ctx_is(title, name, status=None):
                sync_now(a)
                t = server_task(base, A, title)
                return (t and t.get("context") == name and t.get("context_id") == sid.get(name)
                        and (status is None or t.get("gtd_status") == status)) and t
            t = wait_until(lambda: server_ctx_is(T_MAIN, "Desain"), 30)
            check("2c server: context 'Desain' + context_id tahap Desain", t,
                  repr(server_task(base, A, T_MAIN) and {k: server_task(base, A, T_MAIN)[k] for k in ("context", "context_id")}))

            # ── 3. sentuh: tekan-tahan lalu geser ke Review ─────────────────────────
            ctxT, tp = open_app(browser, base, A, has_touch=True)
            goto_workspace(tp, base)
            wait_until(lambda: column_of(tp, T_MAIN) == "Desain", 20)
            method = "CDP touch"
            touch_drag_cdp(tp, T_MAIN, "Review")
            moved = wait_until(lambda: column_of(tp, T_MAIN) == "Review", 5)
            if not moved:
                print("  CDP touch tidak memindahkan kartu (kolom: %r) → PointerEvent sintetis" % column_of(tp, T_MAIN))
                method = "PointerEvent sintetis"
                touch_drag_synthetic(tp, T_MAIN, "Review")
                moved = wait_until(lambda: column_of(tp, T_MAIN) == "Review", 5)
            check("3a sentuh (tahan 350 ms, %s): kartu pindah ke 'Review'" % method, moved, repr(column_of(tp, T_MAIN)))
            shot(tp, "03_touch_tahan_geser_ke_Review.png")
            def server_on_review():
                sync_now(tp)
                t = server_task(base, A, T_MAIN)
                return t and t.get("context") == "Review" and t.get("context_id") == sid["Review"]
            check("3b server: context 'Review' setelah drag sentuh", wait_until(server_on_review, 30))
            # sentuh yang langsung bergeser (tanpa tahan) = scroll, bukan drag
            touch_drag_cdp(tp, T_MAIN, "Desain", hold_ms=0) if method == "CDP touch" else \
                touch_drag_synthetic(tp, T_MAIN, "Desain", hold_ms=0)
            tp.wait_for_timeout(800)
            check("3c sentuh tanpa tahan: kartu tetap di 'Review'", column_of(tp, T_MAIN) == "Review", repr(column_of(tp, T_MAIN)))
            ctxT.close()

            # ── 4. ke Selesai lalu keluar ke Desain ────────────────────────────────
            check("4pre A: kartu di 'Review' setelah sync", wait_until(lambda: a_sees(T_MAIN, "Review"), 30), repr(column_of(a, T_MAIN)))
            mouse_drag(a, T_MAIN, "Selesai")
            check("4a UI: kartu di 'Selesai'", wait_until(lambda: column_of(a, T_MAIN) == "Selesai", 10), repr(column_of(a, T_MAIN)))
            def server_status(title, st):
                sync_now(a)
                t = server_task(base, A, title)
                return t and t.get("gtd_status") == st and t
            check("4b server: task done", wait_until(lambda: server_status(T_MAIN, "done"), 30))
            shot(a, "04a_A_drag_ke_Selesai.png")
            mouse_drag(a, T_MAIN, "Desain")
            check("4c UI: kartu kembali ke 'Desain'", wait_until(lambda: column_of(a, T_MAIN) == "Desain", 10), repr(column_of(a, T_MAIN)))
            t = wait_until(lambda: server_ctx_is(T_MAIN, "Desain", "next"), 30)
            check("4d server: gtd_status 'next' + context 'Desain'", t, repr(server_task(base, A, T_MAIN)))
            shot(a, "04b_A_keluar_Selesai_ke_Desain.png")

            # ── 5. task berulang ke Selesai ────────────────────────────────────────
            api(base, A, "POST", "/api/tasks", json={"title": T_REC, "list_id": ws_id, "gtd_status": "next",
                                                     "context": "Desain", "recurrence_type": "daily"})
            check("5pre task berulang di 'Desain'", wait_until(lambda: a_sees(T_REC, "Desain"), 30), repr(column_of(a, T_REC)))
            rec_id = server_task(base, A, T_REC)["id"]
            mouse_drag(a, T_REC, "Selesai")

            def occ_done():
                sync_now(a)
                ex = api(base, A, "GET", "/api/recurring/exceptions?from=%s&to=%s" % (today_jkt, today_jkt))
                # bentuk respons: {"<task_id>": [{occurrence_date, status}]}
                return any(e["status"] == "done" and e["occurrence_date"] == today_jkt for e in ex.get(str(rec_id), []))
            check("5a server: occurrence %s tercatat done" % today_jkt, wait_until(occ_done, 30))
            refresh(a)
            a.wait_for_timeout(800)
            check("5b UI: kartu berulang tetap di 'Desain'", column_of(a, T_REC) == "Desain", repr(column_of(a, T_REC)))
            t = server_task(base, A, T_REC)
            check("5c server: task berulang tidak done", t and t["gtd_status"] != "done", repr(t and t["gtd_status"]))
            shot(a, "05_A_berulang_tetap_di_Desain.png")

            # ── 6. menu Pindah ke… ─────────────────────────────────────────────────
            api(base, A, "POST", "/api/tasks", json={"title": T_MENU, "list_id": ws_id, "gtd_status": "next"})
            check("6pre kartu di 'Belum ada tahap'", wait_until(lambda: a_sees(T_MENU), 30))
            c = card(a, T_MENU)
            c.get_by_role("button", name="Pindah ke…").click()
            menu = a.get_by_role("menu")
            menu.wait_for(timeout=5000)
            shot(a, "06a_A_menu_Pindah_ke.png")
            menu.get_by_role("menuitem", name="Review").click()
            check("6a UI: kartu pindah ke 'Review' lewat menu", wait_until(lambda: column_of(a, T_MENU) == "Review", 10),
                  repr(column_of(a, T_MENU)))
            check("6b server: context 'Review'", wait_until(lambda: server_ctx_is(T_MENU, "Review"), 30))
            shot(a, "06b_A_menu_hasil_Review.png")

            # ── 7. Next Actions: pemilih Papan + keterangan scope lain ─────────────
            api(base, A, "POST", "/api/tasks", json={"title": T_PERS, "gtd_status": "next"})
            sync_now(a)
            refresh(a)
            sidebar_click(a, "Next Actions")
            a.locator("[data-kanban-board]").wait_for(timeout=15000)
            picker = a.locator("select[aria-label='Papan']")
            check("7a label 'Papan:' + pemilih tampil", a.get_by_text("Papan:", exact=True).count() == 1 and picker.count() == 1)
            opts = picker.evaluate("el => Array.from(el.options).map(o => [o.value, o.textContent])")
            check("7b opsi = Pribadi + 👥 W", opts == [["", "Pribadi"], [str(ws_id), "👥 " + WS]], repr(opts))
            note = a.get_by_text(re.compile(r"^\d+ task dari scope lain tidak ditampilkan$"))
            def note_ok(n_expected):
                return note.count() == 1 and note.first.text_content().startswith("%d task" % n_expected)
            w_next = [t for t in api(base, A, "GET", "/api/tasks") if t.get("list_id") == ws_id and t.get("gtd_status") == "next"]
            check("7c scope Pribadi: '%s' tampil, keterangan %d task scope lain" % (T_PERS, len(w_next)),
                  wait_until(lambda: column_of(a, T_PERS) == "Belum ada tahap" and note_ok(len(w_next)), 15),
                  repr((board(a), note.all_text_contents())))
            shot(a, "07a_A_NextActions_Papan_Pribadi.png")
            picker.select_option(value=str(ws_id))
            check("7d scope W: kolom Desain/Review, '%s' disembunyikan (keterangan 1)" % T_PERS,
                  wait_until(lambda: "Desain" in labels(a) and column_of(a, T_PERS) is None and note_ok(1), 10),
                  repr((labels(a), note.all_text_contents())))
            shot(a, "07b_A_NextActions_Papan_W.png")

            # ── 8. kelola tahap di A → B melihat hasilnya ──────────────────────────
            for nm in ("Lama", "Buang"):
                api(base, A, "POST", "/api/contexts", json={"name": nm, "list_id": ws_id})
            goto_workspace(a, base)
            check("8pre A: tahap Lama/Buang tampil", wait_until(lambda: (sync_now(a), "Buang" in labels(a))[1], 30), repr(labels(a)))
            g = stage_menu(a, "Review")
            g.get_by_role("button", name="Ganti nama").click()
            inp = a.locator("input[aria-label='Nama tahap']")
            inp.fill("Tinjau")
            inp.press("Enter")
            check("8a A: rename Review → Tinjau", wait_until(lambda: "Tinjau" in labels(a) and "Review" not in labels(a), 15), repr(labels(a)))
            g = stage_menu(a, "Tinjau")
            g.get_by_role("button", name="Geser ke kiri").click()
            check("8b A: geser kiri → Tinjau sebelum Desain",
                  wait_until(lambda: labels(a)[1:3] == ["Tinjau", "Desain"], 15), repr(labels(a)))
            g = stage_menu(a, "Lama")
            g.get_by_role("button", name="Arsipkan").click()
            check("8c A: arsip 'Lama' → kolom hilang", wait_until(lambda: "Lama" not in labels(a), 15), repr(labels(a)))
            g = stage_menu(a, "Buang")
            g.get_by_role("button", name="Hapus").click()
            check("8d A: hapus 'Buang' → kolom hilang", wait_until(lambda: "Buang" not in labels(a), 15), repr(labels(a)))
            shot(a, "08a_A_setelah_kelola_tahap.png")
            srv = server_ctx(base, A, ws_id)
            check("8e server: aktif = Tinjau, Desain; Lama diarsip; Buang terhapus",
                  [x["name"] for x in srv if not x["archived"]] == ["Tinjau", "Desain"]
                  and [x["name"] for x in srv if x["archived"]] == ["Lama"], repr([(x["name"], x["archived"]) for x in srv]))
            ctxB, b = open_app(browser, base, B)
            goto_workspace(b, base)
            want = ["Belum ada tahap", "Tinjau", "Desain", "+ Tahap", "Selesai"]
            def b_ok():
                sync_now(b)
                return labels(b) == want
            check("8f B: papan W = Tinjau, Desain (tanpa Lama/Buang) setelah sync", wait_until(b_ok, 30), repr(labels(b)))
            check("8g B: kartu '%s' di 'Tinjau', '%s' di 'Desain'" % (T_MENU, T_MAIN),
                  wait_until(lambda: column_of(b, T_MENU) == "Tinjau" and column_of(b, T_MAIN) == "Desain", 15),
                  repr(board(b)))
            shot(b, "08b_B_melihat_hasil_kelola.png")

            # ── 9 + 10. offline: tahap QA + task cid diseret sebelum sync ───────────
            goto_workspace(a, base)
            ctxA.set_offline(True)
            a.wait_for_timeout(500)
            check("9pre navigator.onLine false", a.evaluate("() => navigator.onLine") is False)
            check("9a offline: '+ Tahap' 'QA' tampil", add_stage_ui(a, "QA"), repr(labels(a)))
            qa_key = col_key(a, "QA")
            check("9b kolom QA ber-id lokal (cid, bukan angka)", qa_key and not re.match(r"^stage:\d+$", qa_key), repr(qa_key))
            a.get_by_role("button", name="Buat Baru").first.click()
            a.locator("input[placeholder^='Judul task']").fill(T_OFF)
            scope = a.locator("select[aria-label='Scope task']")
            if scope.count():
                scope.select_option(label="👥 " + WS)
            a.locator("button[type=submit]", has_text=re.compile("^Tambah$")).click()
            skip = a.get_by_role("button", name="Tidak perlu (Lewati)")  # prompt "Kapan task ini dikerjakan?"
            if wait_until(lambda: skip.count() > 0 and skip.first.is_visible(), 5):
                skip.first.click()
            a.locator("label.input-label", has_text="Judul *").wait_for(state="detached", timeout=15000)
            check("10a task offline tampil di 'Belum ada tahap'", wait_until(lambda: column_of(a, T_OFF) == "Belum ada tahap", 15),
                  repr(board(a)))
            tid = a.evaluate("(t) => { const el = Array.from(document.querySelectorAll('[data-kanban-task]')).find(x => x.textContent.includes(t)); return el && el.getAttribute('data-kanban-task'); }", T_OFF)
            check("10b id kartu = cid (bukan angka)", tid and not re.match(r"^\d+$", tid), repr(tid))
            mouse_drag(a, T_OFF, "QA")
            check("10c offline: task cid diseret ke 'QA' sebelum sync", wait_until(lambda: column_of(a, T_OFF) == "QA", 10),
                  repr(column_of(a, T_OFF)))
            shot(a, "09_A_offline_QA_task_cid.png")
            ctxA.set_offline(False)
            a.wait_for_timeout(500)

            def server_qa():
                sync_now(a)
                qa = next((x for x in server_ctx(base, A, ws_id) if x["name"] == "QA"), None)
                t = server_task(base, A, T_OFF)
                return qa and t and t.get("context") == "QA" and t.get("context_id") == qa["id"] and t.get("list_id") == ws_id and (qa, t)
            r = wait_until(server_qa, 40)
            check("9c online + sync: server punya tahap QA, task ter-link ke id servernya", r,
                  repr((server_ctx(base, A, ws_id), server_task(base, A, T_OFF))))
            refresh(a)
            check("9d UI: kolom QA ber-id server, task tetap di QA",
                  wait_until(lambda: re.match(r"^stage:\d+$", col_key(a, "QA") or "") and column_of(a, T_OFF) == "QA", 20),
                  repr((col_key(a, "QA"), column_of(a, T_OFF))))
            shot(a, "10_A_online_QA_tersinkron.png")

            ctxB.close()
            ctxA.close()
            browser.close()
    except Exception as e:  # langkah yang melempar = gagal
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
