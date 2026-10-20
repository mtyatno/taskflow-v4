"""E2E toggle tampilan halaman Tasks (glyph duotone + segmented control). Tidak dijalankan CI.

Langkah (satu akun, beberapa task via API; halaman "Semua Task"):
  1  struktur: group role=group "Tampilan task" berisi tiga tombol (Normal / Compact / Kanban) bersvg, tanpa teks Unicode lama
  2  Group by = None  → Kanban aria-disabled="true", klik tidak mengubah tampilan, tooltip "Pilih Group by terlebih dahulu"
  3  klik Normal / Compact → aria-pressed berpindah
  4  Group by = Priority → Kanban aktif (tanpa aria-disabled), klik → aria-pressed=true, papan Kanban tampil
  5  tema terang DAN gelap: screenshot .tl-view-seg di tiap keadaan + satu screenshot toolbar yang lebih lebar
  6  halaman workspace (list dibuat via API): tab Tasks / Files memakai svg duotone (bukan emoji), aria-pressed
     mengikuti tab aktif; screenshot .workspace-nav-tabs dengan Tasks aktif dan Files aktif, terang + gelap

Server lokal dijalankan sendiri (uvicorn webapp:app, DB sementara; Python server = $E2E_PYTHON, atau venv repo). Screenshot:
temporary_files/e2e_tasklist_view_icons/. Keluar non-zero bila ada langkah gagal.

    E2E_PYTHON=/path/ke/python-dengan-dependensi-webapp python3 temporary_files/e2e_tasklist_view_icons.py
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
SHOTS = os.path.join(ROOT, "temporary_files", "e2e_tasklist_view_icons")
PW = "rahasia123"
SECRET = "e2e-tasklist-view-icons-secret"
DISABLED_TITLE = "Pilih Group by terlebih dahulu"
TOURS = ['dashboard', 'tasks', 'today', 'calendar', 'kanban', 'notes', 'mindmap', 'chat', 'habits', 'habit',
         'settings', 'draw', 'goals', 'review', 'focus', 'workspace', 'slist', 'all', 'inbox']

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


def server_python():
    """Python untuk uvicorn: E2E_PYTHON bila diset, lalu venv repo, lalu interpreter ini (Playwright bisa saja
    terpasang di Python yang berbeda dari yang memuat dependensi webapp)."""
    if os.environ.get("E2E_PYTHON"):
        return os.environ["E2E_PYTHON"]
    venv_py = os.path.join(ROOT, "venv", "bin", "python")
    return venv_py if os.path.exists(venv_py) else sys.executable


def start_server(tmp):
    port = free_port()
    env = dict(os.environ, DB_PATH=os.path.join(tmp, "e2e.db"), UPLOAD_DIR=os.path.join(tmp, "uploads"),
               WEB_SECRET_KEY=SECRET, TELEGRAM_BOT_TOKEN="")
    os.makedirs(env["UPLOAD_DIR"], exist_ok=True)
    log = open(os.path.join(tmp, "server.log"), "w")
    proc = subprocess.Popen([server_python(), "-m", "uvicorn", "webapp:app", "--host", "127.0.0.1",
                             "--port", str(port)], cwd=ROOT, env=env, stdout=log, stderr=subprocess.STDOUT)
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


def register(base, name):
    u = "%s%d" % (name, int(time.time() * 1000) % 10_000_000)
    r = requests.post(base + "/api/auth/register",
                      json={"username": u, "password": PW, "email": u + "@ex.com", "display_name": name})
    r.raise_for_status()
    j = r.json()
    return {"username": u, "id": j["user_id"], "token": j["token"]}


def api(base, user, method, path, ok_codes=(200,), **kw):
    r = requests.request(method, base + path, headers={"Authorization": "Bearer " + user["token"]}, timeout=10, **kw)
    if r.status_code not in ok_codes:
        raise RuntimeError("%s %s → %d %s" % (method, path, r.status_code, r.text[:200]))
    return r.status_code, r.json()


def open_tasks_page(browser, base, user, theme, width=1280):
    ctx = browser.new_context(service_workers="block", viewport={"width": width, "height": 860}, device_scale_factor=3)
    ctx.add_cookies([{"name": "token", "value": user["token"], "url": base, "httpOnly": True, "sameSite": "Lax"}])
    p = ctx.new_page()
    p.goto(base + "/manifest.json")
    p.evaluate("""([t, u, tours, theme]) => {
        localStorage.setItem('tf_token', t); localStorage.setItem('tf_user_id', String(u));
        for (const pg of tours) localStorage.setItem('tf_tour_' + pg, '1');
        localStorage.setItem('tf_dismiss_onboarding', '1');
        localStorage.setItem('tf_theme', theme);
        localStorage.setItem('tf_groupby', 'priority');
        localStorage.setItem('tf_viewmode', 'normal');
    }""", [user["token"], user["id"], TOURS, theme])
    p.goto(base + "/")
    p.locator(".sidebar-link, .sidebar-rail-btn").first.wait_for(state="attached", timeout=20000)
    # halaman "Semua Task": sidebar penuh bila terlipat, lalu klik link-nya
    link = p.locator(".sidebar-link").filter(has_text="Semua Task")
    if not link.first.is_visible():  # sidebar mode ikon: buka daftar menu penuh dulu
        p.locator("button[aria-label='Tampilkan semua menu']").first.click()
    link.first.click()
    p.locator(".tl-view-seg").wait_for(state="visible", timeout=15000)
    return ctx, p


def seg(page):
    return page.locator(".tl-view-seg")


def btn(page, label):
    return seg(page).locator("button[aria-label='%s']" % label)


def pressed(page):
    """Label tombol yang aria-pressed=true (daftar, harusnya paling banyak satu)."""
    return seg(page).locator("button[aria-pressed='true']").evaluate_all("els => els.map(e => e.getAttribute('aria-label'))")


def kanban_columns(page):
    """Kolom papan Kanban (KanbanColumn: div lebar 280 tanpa class) — 0 bila tampilan bukan Kanban."""
    return page.locator("div[style*='width: 280px'][style*='flex-shrink: 0']").count()


def set_group_by(page, value):
    page.locator("select[aria-label='Group by']").select_option(value)
    page.wait_for_timeout(150)


def shot_el(page, el, name, keep_hover=False):
    if not keep_hover:
        page.mouse.move(5, 5)  # jangan biarkan hover mengubah tampilan screenshot
    page.wait_for_timeout(300)
    path = os.path.join(SHOTS, name)
    el.screenshot(path=path)
    print("  screenshot", os.path.relpath(path, ROOT), flush=True)


def shot_page(page, name):
    page.mouse.move(5, 5)
    page.wait_for_timeout(300)
    path = os.path.join(SHOTS, name)
    page.screenshot(path=path, full_page=False, scale="css")  # 1x supaya berkas halaman penuh tidak raksasa
    print("  screenshot", os.path.relpath(path, ROOT), flush=True)


def toolbar_clip(page):
    """Kotak toolbar (Group by + toggle) dengan sedikit ruang kiri/kanan untuk screenshot lebar."""
    g = page.locator("select[aria-label='Group by']").bounding_box()
    s = seg(page).bounding_box()
    x = max(g["x"] - 140, 0)
    y = max(min(g["y"], s["y"]) - 12, 0)
    w = (s["x"] + s["width"]) - x + 16
    h = max(g["height"], s["height"]) + 24
    return {"x": x, "y": y, "width": w, "height": h}


def shot_toolbar(page, name):
    page.mouse.move(5, 5)
    page.wait_for_timeout(300)
    path = os.path.join(SHOTS, name)
    page.screenshot(path=path, clip=toolbar_clip(page))
    print("  screenshot", os.path.relpath(path, ROOT), flush=True)


def run_theme(browser, base, user, theme):
    tag = "terang" if theme == "light" else "gelap"
    ctx, p = open_tasks_page(browser, base, user, theme)
    try:
        check("[%s] tema aktif" % tag,
              p.evaluate("() => document.documentElement.getAttribute('data-theme')") == ("dark" if theme == "dark" else "light"),
              repr(p.evaluate("() => document.documentElement.getAttribute('data-theme')")))

        # ── 1. struktur ──────────────────────────────────────────────────────────
        s = seg(p)
        check("[%s] 1a role=group + aria-label 'Tampilan task'" % tag,
              s.get_attribute("role") == "group" and s.get_attribute("aria-label") == "Tampilan task")
        labels = s.locator("button").evaluate_all("els => els.map(e => e.getAttribute('aria-label'))")
        check("[%s] 1b tiga tombol urut Normal, Compact, Kanban" % tag, labels == ["Normal", "Compact", "Kanban"], repr(labels))
        check("[%s] 1c tiap tombol berisi satu svg ber-aria-hidden, tanpa teks" % tag,
              all(s.locator("button").nth(i).locator("svg[aria-hidden='true']").count() == 1
                  and s.locator("button").nth(i).inner_text().strip() == "" for i in range(3)))
        glyph = s.locator("button").first.locator("svg").evaluate("e => ({w: e.getAttribute('width'), sw: e.getAttribute('stroke-width'), vb: e.getAttribute('viewBox')})")
        check("[%s] 1d svg 16px, viewBox 0 0 24 24, stroke-width 1.9" % tag,
              glyph == {"w": "16", "sw": "1.9", "vb": "0 0 24 24"}, repr(glyph))
        check("[%s] 1e awal: Normal aktif" % tag, pressed(p) == ["Normal"], repr(pressed(p)))
        check("[%s] 1f Kanban aktif karena Group by = Priority (tanpa aria-disabled)" % tag,
              btn(p, "Kanban").get_attribute("aria-disabled") is None and btn(p, "Kanban").get_attribute("title") == "Kanban view")

        # ── 3. Normal / Compact ──────────────────────────────────────────────────
        shot_el(p, s, "%s_01_normal_aktif.png" % tag)
        btn(p, "Compact").click()
        check("[%s] 3a klik Compact → hanya Compact aktif" % tag, pressed(p) == ["Compact"], repr(pressed(p)))
        shot_el(p, s, "%s_02_compact_aktif.png" % tag)
        btn(p, "Normal").click()
        check("[%s] 3b klik Normal → hanya Normal aktif" % tag, pressed(p) == ["Normal"], repr(pressed(p)))

        # hover (bukan tombol aktif) memberi latar --bg-hover
        btn(p, "Compact").hover()
        p.wait_for_timeout(300)
        bg = btn(p, "Compact").evaluate("e => getComputedStyle(e).backgroundColor")
        check("[%s] 3c hover tombol tidak aktif → latar berubah dari transparan" % tag,
              bg not in ("rgba(0, 0, 0, 0)", "transparent"), bg)
        shot_el(p, s, "%s_03_hover_compact.png" % tag, keep_hover=True)

        # ── 2. Group by = None → Kanban nonaktif ─────────────────────────────────
        set_group_by(p, "none")
        k = btn(p, "Kanban")
        check("[%s] 2a Group by None → Kanban aria-disabled=true" % tag, k.get_attribute("aria-disabled") == "true")
        check("[%s] 2b tombol Kanban tetap tanpa atribut disabled (tooltip tetap tampil)" % tag,
              k.get_attribute("disabled") is None and k.evaluate("e => e.disabled") is False)
        check("[%s] 2c title 'Pilih Group by terlebih dahulu'" % tag, k.get_attribute("title") == DISABLED_TITLE,
              repr(k.get_attribute("title")))
        before = pressed(p)
        k.click(force=True)  # Playwright menganggap aria-disabled "tidak enabled"; klik pengguna nyata tetap sampai ke handler
        p.wait_for_timeout(200)
        check("[%s] 2d klik Kanban nonaktif tidak mengubah tampilan" % tag,
              pressed(p) == before == ["Normal"] and kanban_columns(p) == 0,
              "%r → %r, kolom kanban %d" % (before, pressed(p), kanban_columns(p)))
        check("[%s] 2e Kanban nonaktif bisa difokus keyboard" % tag,
              (k.focus() or True) and p.evaluate("() => document.activeElement && document.activeElement.getAttribute('aria-label')") == "Kanban")
        op = k.evaluate("e => getComputedStyle(e).opacity")
        cur = k.evaluate("e => getComputedStyle(e).cursor")
        check("[%s] 2f gaya nonaktif dari CSS (opacity 0.45, cursor not-allowed)" % tag, op == "0.45" and cur == "not-allowed", "%s / %s" % (op, cur))
        shot_el(p, s, "%s_04_kanban_nonaktif.png" % tag)

        # ── 4. Group by = Priority → Kanban aktif ────────────────────────────────
        set_group_by(p, "priority")
        k = btn(p, "Kanban")
        check("[%s] 4a Group by Priority → Kanban tidak aria-disabled" % tag, k.get_attribute("aria-disabled") is None)
        k.click()
        p.wait_for_timeout(400)
        check("[%s] 4b klik Kanban → hanya Kanban aktif" % tag, pressed(p) == ["Kanban"], repr(pressed(p)))
        check("[%s] 4c papan Kanban tampil (kolom ada)" % tag, kanban_columns(p) > 0, "kolom %d" % kanban_columns(p))
        check("[%s] 4d localStorage tf_viewmode = kanban" % tag,
              p.evaluate("() => localStorage.getItem('tf_viewmode')") == "kanban")
        shot_el(p, s, "%s_05_kanban_aktif.png" % tag)
        shot_toolbar(p, "%s_06_toolbar_kanban_lebar.png" % tag)
        shot_page(p, "%s_07_halaman_kanban.png" % tag)

        # kembali ke Normal untuk toolbar lebar mode normal
        btn(p, "Normal").click()
        check("[%s] 4e kembali ke Normal" % tag, pressed(p) == ["Normal"], repr(pressed(p)))
        shot_toolbar(p, "%s_08_toolbar_normal_lebar.png" % tag)

        # fokus keyboard terlihat (focus-visible) pada tombol
        btn(p, "Compact").focus()
        p.keyboard.press("Shift+Tab")
        p.keyboard.press("Tab")
        outline = p.evaluate("""() => { const e = document.activeElement; const c = getComputedStyle(e);
            return e.getAttribute('aria-label') + '|' + c.outlineStyle + '|' + c.outlineWidth + '|' + c.outlineColor; }""")
        check("[%s] 5 fokus keyboard → outline 2px solid" % tag, outline.startswith("Compact|solid|2px|"), outline)
        shot_el(p, s, "%s_09_fokus_keyboard.png" % tag)
    finally:
        ctx.close()


def run_workspace_tabs(browser, base, user, theme, ws_name):
    tag = "terang" if theme == "light" else "gelap"
    ctx, p = open_tasks_page(browser, base, user, theme)
    try:
        if not p.locator(".sidebar-link").first.is_visible():
            p.locator("button[aria-label='Tampilkan semua menu']").first.click()
        p.locator(".sidebar-link").filter(has=p.locator("span", has_text=ws_name)).first.click()
        tabs = p.locator(".workspace-nav-tabs")
        tabs.wait_for(state="visible", timeout=15000)
        bt = tabs.locator("button").filter(has_text="Tasks").first
        bf = tabs.locator("button").filter(has_text="Files").first
        text = tabs.inner_text()
        check("[%s] 6a emoji 📋/📁 tidak ada di tab" % tag, "📋" not in text and "📁" not in text, repr(text))
        check("[%s] 6b tab Tasks dan Files masing-masing satu svg aria-hidden 15px" % tag,
              all(b.locator("svg[aria-hidden='true'][width='15'][height='15']").count() == 1 for b in (bt, bf)))
        check("[%s] 6c Tasks aktif: aria-pressed true/false" % tag,
              bt.get_attribute("aria-pressed") == "true" and bf.get_attribute("aria-pressed") == "false")
        shot_el(p, tabs, "%s_10_workspace_tab_tasks_aktif.png" % tag)
        bf.click()
        p.wait_for_timeout(400)
        check("[%s] 6d klik Files: aria-pressed berpindah" % tag,
              bf.get_attribute("aria-pressed") == "true" and bt.get_attribute("aria-pressed") == "false")
        shot_el(p, tabs, "%s_11_workspace_tab_files_aktif.png" % tag)
    finally:
        ctx.close()


def main():
    os.makedirs(SHOTS, exist_ok=True)
    for f in os.listdir(SHOTS):
        if f.endswith(".png"):
            os.remove(os.path.join(SHOTS, f))
    tmp = tempfile.mkdtemp(prefix="e2e_tasklist_view_icons_")
    proc, base = start_server(tmp)
    print("server", base, flush=True)
    try:
        user = register(base, "tina")
        for i, pr in enumerate(["P1", "P2", "P3", "P1"], 1):
            api(base, user, "POST", "/api/tasks", json={"title": "Task contoh %d" % i, "priority": pr, "gtd_status": "next"})
        ws_name = "Tim Alfa"
        api(base, user, "POST", "/api/lists", json={"name": ws_name})
        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            for theme in ("light", "dark"):
                run_theme(browser, base, user, theme)
                run_workspace_tabs(browser, base, user, theme, ws_name)
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
