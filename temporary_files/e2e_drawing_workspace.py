"""E2E PR 3 — drawing milik workspace (frontend + offline). Tidak dijalankan CI.

Langkah (dua akun: A pemilik workspace W, B anggota):
  1  A punya drawing D + note pribadi berisi D → share note ke W lewat UI → dialog menyebut D;
     setelah share D ber-badge "👥 W" di Draw
  2  B buka note → pratinjau D (svg) tampil; B ubah judul D di Draw → A melihat "terakhir diedit oleh B"
  3  B di Draw: D tampil dengan badge, tanpa bintang pin dan tanpa tombol hapus
  4  A di tab D: tombol share → "Pribadi" → 409 nyata dari server → dialog "Drawing masih dipakai" menyebut note
  5  A sisip drawing pribadi D2 ke note W yang sudah ada → pemberitahuan → setelah sisip, B melihat D2 (svg)
  6  B dikeluarkan dari W (DB) → setelah sync B, D hilang dari Draw B; embed D di note pribadi B = placeholder persis

Prasyarat (drawing D/D2, note, keanggotaan) dibuat lewat API/DB; perilaku yang diuji diamati di UI.
Server lokal dijalankan sendiri oleh skrip (uvicorn webapp:app, DB sementara).
Screenshot per langkah: temporary_files/e2e_drawing_workspace/. Keluar non-zero bila ada langkah gagal.

    python3 temporary_files/e2e_drawing_workspace.py
"""
import os
import re
import socket
import sqlite3
import subprocess
import sys
import tempfile
import time
import uuid
from datetime import datetime

import requests
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHOTS = os.path.join(ROOT, "temporary_files", "e2e_drawing_workspace")
PW = "rahasia123"
WS = "W"
D_TITLE = "Drawing D"
D_TITLE_B = "Drawing D oleh Budi"
D2_TITLE = "Drawing D2"
NOTE1 = "Note berisi D"
NOTE2 = "Note W lama"
NOTE_B = "Note pribadi Budi"
PLACEHOLDER = "Gambar tidak tersedia untukmu: sudah dihapus atau tidak dibagikan ke workspace ini."
SECRET = "e2e-drawing-workspace-secret"
TOURS = ['dashboard', 'tasks', 'today', 'calendar', 'kanban', 'notes', 'mindmap', 'chat', 'habits', 'habit',
         'settings', 'draw', 'goals', 'review', 'focus', 'workspace', 'slist']


def svg_of(label, color):
    return ('<svg xmlns="http://www.w3.org/2000/svg" width="240" height="120" viewBox="0 0 240 120">'
            '<rect x="10" y="10" width="220" height="100" rx="12" fill="%s"/>'
            '<text x="120" y="70" font-size="28" text-anchor="middle" fill="#fff">%s</text></svg>' % (color, label))


results = []  # (langkah, ok, keterangan)
PAGES = []  # [(nama, page)] untuk screenshot saat exception
VERBOSE = os.environ.get("E2E_VERBOSE") == "1"
PW_RT = []  # runtime playwright (dihentikan di finally)


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
    return {"username": u, "id": j["user_id"], "token": j["token"], "name": name}


def api(base, user, method, path, **kw):
    r = requests.request(method, base + path, headers={"Authorization": "Bearer " + user["token"]}, timeout=10, **kw)
    r.raise_for_status()
    return r.json()


def open_app(browser, base, user):
    ctx = browser.new_context(service_workers="block", viewport={"width": 1366, "height": 900})
    ctx.add_cookies([{"name": "token", "value": user["token"], "url": base, "httpOnly": True, "sameSite": "Lax"}])
    p = ctx.new_page()
    p.on("pageerror", lambda e: print("  [pageerror %s] %s" % (user["name"], e), flush=True))
    p.on("console", lambda m: print("  [console.%s %s] %s" % (m.type, user["name"], m.text[:300]), flush=True)
         if m.type in ("warning", "error") and VERBOSE else None)
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
    page.evaluate("""(t) => { let d = document.getElementById('__e2e_caption');
        if (!d) { d = document.createElement('div'); d.id = '__e2e_caption'; document.body.appendChild(d); }
        d.textContent = 'E2E: ' + t;
        d.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:99999;background:#111;color:#fff;font:12px monospace;padding:6px 10px;border-radius:6px;max-width:90vw;pointer-events:none'; }""", text)


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
    """Sync penuh di halaman (push outbox + pull) — sama dengan E2E PR 5."""
    page.evaluate("() => typeof window.__syncNow === 'function' ? Promise.resolve(window.__syncNow()).catch(() => null) : null")


IDB_DRAWINGS = """() => new Promise((res) => { const r = indexedDB.open('taskflow-offline');
    r.onsuccess = () => { try { const tx = r.result.transaction('drawings'); const q = tx.objectStore('drawings').getAll();
      q.onsuccess = () => res((q.result || []).map(x => ({cid: x.cid, server_id: x.server_id, client_id: x.client_id,
        title: x.title, list_id: x.list_id, deleted: !!x.deleted, dirty: !!x.dirty, access_lost: !!(x.access_lost || x.remote_deleted),
        last_editor_username: x.last_editor_username || null})));
      q.onerror = () => res(null); } catch (e) { res('err:' + e.message); } };
    r.onerror = () => res(null); })"""


def local_drawings(page):
    return page.evaluate(IDB_DRAWINGS) or []


def local_drawing(page, server_id):
    rows = local_drawings(page)
    for d in rows if isinstance(rows, list) else []:
        if d.get("server_id") is not None and str(d["server_id"]) == str(server_id):
            return d
    return None


def goto_page(page, label):
    link = page.locator(".sidebar-link").filter(has=page.locator("span", has_text=re.compile("^" + re.escape(label) + "$")))
    if link.count() == 0 or not link.first.is_visible():
        expand = page.locator("button[aria-label='Tampilkan semua menu']")
        if expand.count() and expand.first.is_visible():
            expand.first.click()
    link.first.click()


def reload_app(page, base):
    page.goto(base + "/")
    page.locator(".sidebar-link").first.wait_for(state="attached", timeout=20000)


def open_note(page, base, title):
    """Halaman Notes → klik note di daftar → panel note terbuka."""
    reload_app(page, base)
    goto_page(page, "Notes")
    item = page.get_by_text(title).first
    item.wait_for(timeout=20000)
    item.click()
    panel = page.locator(".notes-panel-actions").first
    panel.wait_for(timeout=15000)
    return panel


def draw_row(page, title):
    """Baris DrawingListItem di sidebar Draw (div dengan span judul persis)."""
    span = page.locator("span", has_text=re.compile("^" + re.escape(title) + "$"))
    return span.locator("xpath=..")


def open_draw_page(page, base):
    reload_app(page, base)
    goto_page(page, "Draw")
    page.locator(".draw-tab-view-instance, input[placeholder*='Cari']").first.wait_for(state="attached", timeout=20000)


def open_drawing_tab(page, title):
    row = draw_row(page, title).first
    row.wait_for(timeout=20000)
    row.click()
    tab = page.locator(".draw-tab-view-instance").filter(has=page.locator("span", has_text="🎨 " + title))
    tab.first.wait_for(timeout=20000)
    # tab aktif = instance yang terlihat (judul berganti jadi input saat Rename)
    return page.locator(".draw-tab-view-instance:visible").first


def preview_state(page, token):
    """Isi kontainer pratinjau ::draw[token] di halaman: 'svg' / 'placeholder:<teks>' / 'loading' / None."""
    return page.evaluate("""(tok) => {
        const els = Array.from(document.querySelectorAll('[data-drawing-preview]'))
          .filter(e => (e.getAttribute('data-drawing-preview') || '').toLowerCase() === String(tok).toLowerCase());
        if (!els.length) return null;
        const el = els[0];
        if (el.querySelector('svg')) return 'svg';
        const u = el.querySelector('.drawing-unavailable');
        if (u) return 'placeholder:' + u.textContent;
        return 'loading:' + el.textContent.trim().slice(0, 60);
    }""", token)


def main():
    os.makedirs(SHOTS, exist_ok=True)
    for f in os.listdir(SHOTS):
        if f.endswith(".png"):
            os.remove(os.path.join(SHOTS, f))
    tmp = tempfile.mkdtemp(prefix="e2e_drawing_workspace_")
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

        # Prasyarat lewat API (UI gambar = kanvas tldraw, sulit dikendalikan): D & D2 milik A, pribadi.
        d_cid, d2_cid = str(uuid.uuid4()), str(uuid.uuid4())
        D = api(base, A, "POST", "/api/drawings", json={"title": D_TITLE, "data_json": "{}", "client_id": d_cid,
                                                         "svg_preview": svg_of("D", "#2563eb")})
        D2 = api(base, A, "POST", "/api/drawings", json={"title": D2_TITLE, "data_json": "{}", "client_id": d2_cid,
                                                          "svg_preview": svg_of("D2", "#16a34a")})
        n1 = api(base, A, "POST", "/api/scratchpad", json={
            "title": NOTE1, "client_id": str(uuid.uuid4()),
            "content": "Catatan pribadi A.\n\n::draw[%s]{title=\"%s\"}\n" % (d_cid, D_TITLE)})
        n2 = api(base, A, "POST", "/api/scratchpad", json={
            "title": NOTE2, "client_id": str(uuid.uuid4()), "list_id": ws_id,
            "content": "Note workspace yang sudah ada.\n"})
        check("setup: D pribadi, N1 pribadi, N2 di W",
              D.get("list_id") is None and n1.get("list_id") is None and n2.get("list_id") == ws_id,
              repr((D.get("list_id"), n1.get("list_id"), n2.get("list_id"))))

        pw = sync_playwright().start()
        PW_RT.append(pw)
        browser = pw.chromium.launch()
        ctxA, a = open_app(browser, base, A)
        ctxB, b = open_app(browser, base, B)
        PAGES[:] = [("A", a), ("B", b)]

        # ── 1. A share note N1 ke W → dialog menyebut D → D ber-badge 👥 W ─────────
        def a_has_both():
            sync_now(a)
            ids = {str(d.get("server_id")) for d in local_drawings(a)}
            return str(D["id"]) in ids and str(D2["id"]) in ids
        check("1a A: sync menarik D dan D2 ke IndexedDB", wait_until(a_has_both, 30))
        panel = open_note(a, base, NOTE1)
        a.locator("[data-drawing-preview] svg").first.wait_for(timeout=20000)
        share_btn = panel.locator("button[title='Bagikan ke list']")
        share_btn.click()
        menu = share_btn.locator("xpath=..")
        menu.get_by_text("Bagikan ke List").wait_for(timeout=5000)
        menu.get_by_text(WS, exact=True).click()
        dlg_title = a.get_by_text("Ikut dibagikan ke %s:" % WS)
        dlg_title.wait_for(timeout=20000)
        dlg = dlg_title.locator("xpath=ancestor::div[contains(@class,'modal-overlay')][1]")
        check("1b A: dialog share note menyebut '%s'" % D_TITLE,
              dlg.get_by_text(D_TITLE).count() > 0, dlg.inner_text()[:200].replace("\n", " | "))
        shot(a, "01_A_dialog_share_note_menyebut_D.png")
        dlg.get_by_role("button", name="Bagikan").click()

        def server_shared():
            n = api(base, A, "GET", "/api/scratchpad/%d" % n1["id"])
            d = api(base, A, "GET", "/api/drawings/%d" % D["id"])
            return n.get("list_id") == ws_id and d.get("list_id") == ws_id
        check("1c server: N1 dan D pindah ke W", wait_until(server_shared, 30))
        shot(a, "01b_A_note_setelah_share.png")
        open_draw_page(a, base)
        row = draw_row(a, D_TITLE).first
        badge = row.locator(".badge", has_text="👥 " + WS)
        check("1d A Draw: D ber-badge '👥 %s'" % WS, wait_until(lambda: badge.count() == 1, 20))
        shot(a, "02_A_draw_D_badge_W.png")

        # ── 2. B buka note → pratinjau D; B ubah judul D → A melihat 'terakhir diedit oleh B' ──
        sync_now(b)
        panel_b = open_note(b, base, NOTE1)
        ok = wait_until(lambda: preview_state(b, d_cid) == "svg", 30)
        check("2a B: note N1 menampilkan pratinjau D (svg, bukan placeholder)", ok, repr(preview_state(b, d_cid)))
        shot(b, "03_B_note_pratinjau_D.png")

        open_draw_page(b, base)
        tab_b = open_drawing_tab(b, D_TITLE)
        tab_b.get_by_role("button", name="Rename").click()
        inp = tab_b.locator("input").first
        inp.fill(D_TITLE_B)
        tab_b.get_by_role("button", name="Simpan").click()
        b.locator(".draw-tab-view-instance span", has_text="🎨 " + D_TITLE_B).first.wait_for(timeout=10000)

        def server_title():
            sync_now(b)
            d = api(base, A, "GET", "/api/drawings/%d" % D["id"])
            return d.get("title") == D_TITLE_B and d
        srv = wait_until(server_title, 30)
        check("2b server: judul D diubah B, last_edited_by = B",
              srv and str(srv.get("last_edited_by")) == str(B["id"]),
              repr(srv and (srv.get("title"), srv.get("last_edited_by"), srv.get("last_editor_username"))))
        shot(b, "04_B_rename_D.png")

        def a_pulled():
            sync_now(a)
            d = local_drawing(a, D["id"])
            return d and d.get("title") == D_TITLE_B
        check("2c A: sync menarik judul baru D", wait_until(a_pulled, 30))
        open_draw_page(a, base)
        tab_a = open_drawing_tab(a, D_TITLE_B)
        label = tab_a.get_by_text(re.compile(r"^terakhir diedit oleh "))
        check("2d A: tab D menampilkan 'terakhir diedit oleh %s'" % B["name"],
              wait_until(lambda: label.count() > 0 and label.first.inner_text() == "terakhir diedit oleh " + B["name"], 15),
              repr(label.first.inner_text() if label.count() else None))
        shot(a, "05_A_terakhir_diedit_oleh_B.png")

        # ── 3. B di Draw: badge, tanpa pin, tanpa hapus ───────────────────────────
        open_draw_page(b, base)
        row_b = draw_row(b, D_TITLE_B).first
        row_b.wait_for(timeout=20000)
        row_b.hover()
        check("3a B Draw: D ber-badge '👥 %s'" % WS, row_b.locator(".badge", has_text="👥 " + WS).count() == 1)
        check("3b B Draw: baris D tanpa bintang pin (saat hover)",
              row_b.locator("span[title='Pin'], span[title='Unpin']").count() == 0)
        tab_b = open_drawing_tab(b, D_TITLE_B)
        check("3c B tab D: tanpa tombol Hapus dan tanpa Pin",
              tab_b.get_by_role("button", name="Hapus").count() == 0
              and tab_b.get_by_role("button", name=re.compile("Pin")).count() == 0)
        check("3d B tab D: badge '👥 %s', tanpa menu share" % WS,
              tab_b.locator(".badge", has_text="👥 " + WS).count() == 1
              and tab_b.get_by_role("button", name=re.compile("^👥")).count() == 0)
        row_b.hover()
        shot(b, "06_B_draw_tanpa_pin_hapus.png")
        # pembanding: A (pemilik) melihat pin & hapus
        check("3e A tab D (pemilik): tombol Hapus dan Pin tampil",
              tab_a.get_by_role("button", name="Hapus").count() == 1
              and tab_a.get_by_role("button", name=re.compile("Pin")).count() == 1)

        # ── 4. A: 👥 → Pribadi → 409 nyata → dialog 'Drawing masih dipakai' ──────────
        patch_resp = []
        a.on("response", lambda r: patch_resp.append(r.status) if re.search(r"/api/drawings/\d+/share$", r.url) and r.request.method == "PATCH" else None)
        share = tab_a.get_by_role("button", name=re.compile("^👥 "))
        check("4a A tab D: tombol share menampilkan '👥 %s'" % WS, share.count() == 1 and share.inner_text() == "👥 " + WS,
              repr(share.inner_text() if share.count() else None))
        share.click()
        tab_a.get_by_text("Pribadi", exact=True).click()
        in_use = a.get_by_text("Drawing masih dipakai", exact=True)
        in_use.wait_for(timeout=15000)
        box = in_use.locator("xpath=..")
        check("4b A: PATCH /share dijawab 409 oleh server", 409 in patch_resp, repr(patch_resp))
        check("4c A: dialog 'Drawing masih dipakai' menyebut note '%s'" % NOTE1,
              box.locator("li", has_text=NOTE1).count() == 1 and box.get_by_text("Buat salinan pribadi sebagai gantinya.").count() == 1,
              box.inner_text()[:200].replace("\n", " | "))
        shot(a, "07_A_dialog_drawing_masih_dipakai.png")
        box.get_by_role("button", name="Tutup").click()
        check("4d server: D tetap di W setelah 409",
              api(base, A, "GET", "/api/drawings/%d" % D["id"]).get("list_id") == ws_id)

        # ── 5. A sisip D2 (pribadi) ke note W yang sudah ada ─────────────────────────
        panel = open_note(a, base, NOTE2)
        panel.get_by_text("Edit", exact=True).click()
        ins = a.locator("button[title^='Sisipkan atau buat gambar']").first
        ins.wait_for(timeout=20000)
        a.locator(".ProseMirror").first.click()
        a.keyboard.press("Control+End")
        ins.click()
        a.get_by_role("button", name="🖼️ Pilih Dari Galeri").click()
        a.get_by_text(D2_TITLE, exact=False).last.click()
        notice = "Gambar ini akan dibagikan ke workspace %s supaya semua anggota bisa melihatnya." % WS
        nt = a.get_by_text(notice, exact=True)
        check("5a A: pemberitahuan sisip drawing pribadi ke note W", wait_until(lambda: nt.count() == 1, 10))
        shot(a, "08_A_pemberitahuan_sisip_D2.png")
        a.get_by_role("button", name="Sisipkan").click()
        nt.wait_for(state="detached", timeout=15000)

        def d2_shared():
            sync_now(a)
            d = api(base, A, "GET", "/api/drawings/%d" % D2["id"])
            n = api(base, A, "GET", "/api/scratchpad/%d" % n2["id"])
            return d.get("list_id") == ws_id and re.search(r"::draw\\?\[(%s|%s)\\?\]" % (re.escape(d2_cid), D2["id"]),
                                                            n.get("content") or "", re.I) and n
        got = wait_until(d2_shared, 40)
        check("5b server: D2 pindah ke W dan N2 berisi ::draw D2", got,
              repr(api(base, A, "GET", "/api/scratchpad/%d" % n2["id"]).get("content")))
        shot(a, "08b_A_note_W_berisi_D2.png")
        tok = re.search(r"::draw\\?\[([0-9a-zA-Z_-]+)", (got or {}).get("content", "") or "")
        tok = tok.group(1) if tok else d2_cid

        def b_has_n2():
            sync_now(b)
            d = local_drawing(b, D2["id"])
            return d is not None
        check("5c B: sync menarik D2", wait_until(b_has_n2, 30))
        open_note(b, base, NOTE2)
        ok = wait_until(lambda: preview_state(b, tok) == "svg", 30)
        check("5d B: note W menampilkan D2 (svg, bukan placeholder)", ok, repr(preview_state(b, tok)))
        shot(b, "09_B_note_W_melihat_D2.png")

        # ── 6. B dikeluarkan dari W → D hilang dari Draw B, embed di note pribadi B = placeholder ──
        nb = api(base, B, "POST", "/api/scratchpad", json={
            "title": NOTE_B, "client_id": str(uuid.uuid4()),
            "content": "Catatan pribadi B.\n\n::draw[%s]{title=\"%s\"}\n" % (d_cid, D_TITLE_B)})
        sync_now(b)
        open_note(b, base, NOTE_B)
        check("6a B (masih anggota): embed D di note pribadi B tampil svg",
              wait_until(lambda: preview_state(b, d_cid) == "svg", 30), repr(preview_state(b, d_cid)))
        shot(b, "10_B_note_pribadi_D_sebelum_keluar.png")
        with sqlite3.connect(db_path) as c:
            c.execute("DELETE FROM list_members WHERE list_id = ? AND user_id = ?", (ws_id, B["id"]))
        check("6b setup: B bukan anggota W lagi", not any(l["id"] == ws_id for l in api(base, B, "GET", "/api/lists")))

        def b_lost():
            sync_now(b)
            d = local_drawing(b, D["id"])
            return d is None or d.get("deleted") or d.get("access_lost")
        check("6c B: setelah sync D hilang dari IndexedDB B (atau ditandai akses hilang)", wait_until(b_lost, 30),
              repr(local_drawing(b, D["id"])))
        open_draw_page(b, base)
        b.wait_for_timeout(1000)
        check("6d B Draw: D tidak tampil di daftar", draw_row(b, D_TITLE_B).count() == 0 and draw_row(b, D_TITLE).count() == 0)
        shot(b, "11_B_draw_tanpa_D.png")
        open_note(b, base, NOTE_B)
        st = wait_until(lambda: (preview_state(b, d_cid) or "").startswith("placeholder:") and preview_state(b, d_cid), 30)
        check("6e B: embed D di note pribadi B menampilkan placeholder persis", st == "placeholder:" + PLACEHOLDER, repr(st))
        shot(b, "12_B_note_pribadi_placeholder.png")

        ctxA.close()
        ctxB.close()
        browser.close()
    except Exception as e:  # langkah yang melempar = gagal
        for nm, pg in PAGES:
            try:
                shot(pg, "zz_exception_%s.png" % nm)
            except Exception:
                pass
        check("exception", False, "%s: %s" % (type(e).__name__, str(e).splitlines()[0] if str(e) else ""))
        import traceback
        traceback.print_exc(limit=2)
    finally:
        for rt in PW_RT:
            try:
                rt.stop()
            except Exception:
                pass
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
