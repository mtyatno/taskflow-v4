"""E2E workspace di-pin di sidebar mode ikon (spec §10 Browser). Tidak dijalankan CI.

Langkah (satu akun A, enam workspace W1..W6; task di W1..W3 → seed 3 pin):
  1  seed: rail menampilkan avatar W1..W3 sesuai urutan pin_position server
  2  klik avatar → halaman workspace terbuka, penanda aktif pindah
  3  pin W4 dari halaman workspace → tombol "Di-pin", avatar W4 muncul paling akhir di rail
  4  klik kanan avatar W4 → "Lepas pin" → avatar hilang, server unpinned
  5  pin ke-6: W4+W5 di-pin (5) → buka W6, tombol nonaktif + tooltip penuh
  6  perangkat kedua: dari 4 pin, halaman W6 tombol aktif; pin ke-5 lewat requests (perangkat lain);
     klik Pin di halaman pertama → 409 → toast "Maksimal 5 ..."; tombol/rail tidak berubah
  7  offline (context dengan SW, set_offline + reload) → rail sama, tombol Pin dan "Lepas pin" nonaktif
  8  tema gelap dan terang (screenshot)

Server lokal dijalankan sendiri (uvicorn webapp:app, DB sementara). Screenshot:
temporary_files/e2e_workspace_pins/. Keluar non-zero bila ada langkah gagal.

    python temporary_files/e2e_workspace_pins.py
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
SHOTS = os.path.join(ROOT, "temporary_files", "e2e_workspace_pins")
PW = "rahasia123"
SECRET = "e2e-workspace-pins-secret"
FULL_TEXT = "Maksimal 5 workspace di-pin. Lepas salah satu dulu."
OFFLINE_TEXT = "Butuh koneksi internet"
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


def server_pins(base, user):
    _, ls = api(base, user, "GET", "/api/lists")
    pins = sorted([l for l in ls if l.get("pinned")], key=lambda l: (l["pin_position"], l["id"]))
    return [l["name"] for l in pins]


def open_app(browser, base, user, theme="light", sw=False):
    ctx = browser.new_context(service_workers="allow" if sw else "block", viewport={"width": 1280, "height": 860})
    ctx.add_cookies([{"name": "token", "value": user["token"], "url": base, "httpOnly": True, "sameSite": "Lax"}])
    p = ctx.new_page()
    p.goto(base + "/manifest.json")
    p.evaluate("""([t, u, tours, theme]) => {
        localStorage.setItem('tf_token', t); localStorage.setItem('tf_user_id', String(u));
        for (const pg of tours) localStorage.setItem('tf_tour_' + pg, '1');
        localStorage.setItem('tf_dismiss_onboarding', '1');
        localStorage.setItem('tf_theme', theme);
    }""", [user["token"], user["id"], TOURS, theme])
    p.goto(base + "/")
    p.locator(".sidebar-link").first.wait_for(state="attached", timeout=20000)
    return ctx, p


def shot(page, name):
    path = os.path.join(SHOTS, name)
    page.wait_for_timeout(400)
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
        except Exception:
            pass
        time.sleep(interval)
    return last


def rail_names(page):
    return page.locator(".sidebar-rail-ws").evaluate_all("els => els.map(e => e.getAttribute('aria-label'))")


def rail_btn(page, name):
    return page.locator(".sidebar-rail-ws[aria-label='%s']" % name)


def pin_btn(page):
    return page.locator("[data-testid='workspace-pin-btn']")


def open_ws_from_rail(page, name):
    rail_btn(page, name).click()
    page.locator(".workspace-nav-tabs").wait_for(timeout=10000)
    pin_btn(page).wait_for(timeout=10000)


def open_ws_via_all(page, name):
    """Workspace yang tidak di-pin: buka sidebar penuh → klik link workspace (menu terlipat lagi)."""
    page.locator("button[aria-label='Tampilkan semua menu']").first.click()
    link = page.locator(".sidebar-link").filter(has=page.locator("span", has_text=re.compile("^" + re.escape(name) + "$")))
    link.first.click()
    page.locator(".workspace-nav-tabs").wait_for(timeout=10000)
    pin_btn(page).wait_for(timeout=10000)
    page.locator(".sidebar.collapsed").wait_for(state="attached", timeout=5000)


def toast_text(page):
    t = page.locator(".toast")
    return t.first.inner_text() if t.count() else ""


def main():
    os.makedirs(SHOTS, exist_ok=True)
    for f in os.listdir(SHOTS):
        if f.endswith(".png"):
            os.remove(os.path.join(SHOTS, f))
    tmp = tempfile.mkdtemp(prefix="e2e_workspace_pins_")
    proc, base = start_server(tmp)
    print("server", base, flush=True)
    try:
        A = register(base, "ana")
        ids = {}
        for i in range(1, 7):
            _, w = api(base, A, "POST", "/api/lists", json={"name": "W%d" % i})
            ids["W%d" % i] = w["id"]
        for i in (1, 2, 3):  # aktivitas task → kandidat seed
            api(base, A, "POST", "/api/tasks", json={"title": "Task W%d" % i, "list_id": ids["W%d" % i]})
            time.sleep(1.1)
        seeded = server_pins(base, A)  # GET /api/lists pertama → seed
        check("setup: seed 3 pin = W1..W3", sorted(seeded) == ["W1", "W2", "W3"], repr(seeded))

        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            ctx, a = open_app(browser, base, A)

            # ── 1. seed tampil di rail ───────────────────────────────────────────────
            got = wait_until(lambda: rail_names(a) == seeded and rail_names(a), 15)
            check("1 rail menampilkan seed sesuai urutan server", got == seeded, repr(rail_names(a)))
            check("1b tombol 'Semua workspace' ada di rail",
                  a.locator(".sidebar-rail-btn[aria-label='Semua workspace']").count() == 1)
            shot(a, "01_seed_rail_terang.png")

            # ── 2. klik avatar → workspace terbuka, penanda aktif pindah ───────────────
            first, second = seeded[0], seeded[1]
            open_ws_from_rail(a, first)
            check("2a avatar %s aktif" % first, "active" in (rail_btn(a, first).get_attribute("class") or ""))
            open_ws_from_rail(a, second)
            check("2b penanda aktif pindah ke %s" % second,
                  "active" in (rail_btn(a, second).get_attribute("class") or "")
                  and "active" not in (rail_btn(a, first).get_attribute("class") or ""))
            check("2c tombol 'Di-pin' di workspace ter-pin", pin_btn(a).inner_text().strip() == "Di-pin",
                  repr(pin_btn(a).inner_text()))
            pin_btn(a).hover()
            check("2d hover 'Di-pin' → ikon pin-off",
                  pin_btn(a).locator("svg").first.inner_html().find("m2 2 20 20") >= 0)
            shot(a, "02_workspace_dipin_hover_pinoff.png")
            a.mouse.move(5, 500)

            # ── 3. pin W4 dari halaman workspace → muncul paling akhir ────────────────
            open_ws_via_all(a, "W4")
            btn = pin_btn(a)
            check("3a W4 belum di-pin: tombol 'Pin' aktif", btn.inner_text().strip() == "Pin" and btn.is_enabled())
            shot(a, "03a_W4_tombol_pin.png")
            btn.click()
            ok = wait_until(lambda: pin_btn(a).inner_text().strip() == "Di-pin", 10)
            check("3b tombol berubah 'Di-pin'", ok)
            check("3c avatar W4 paling akhir di rail", wait_until(lambda: rail_names(a)[-1:] == ["W4"], 10),
                  repr(rail_names(a)))
            check("3d server: W4 di-pin di urutan terakhir", server_pins(base, A)[-1:] == ["W4"], repr(server_pins(base, A)))
            a.mouse.move(5, 500)
            shot(a, "03b_W4_dipin_rail.png")

            # ── 4. klik kanan → Lepas pin ────────────────────────────────────────────
            rail_btn(a, "W4").click(button="right")
            menu = a.locator(".sidebar-rail-ctx[role=menu]")
            menu.wait_for(timeout=5000)
            check("4a menu klik kanan: Buka / Lepas pin",
                  menu.get_by_role("menuitem", name="Buka").count() == 1
                  and menu.get_by_role("menuitem", name="Lepas pin").count() == 1)
            shot(a, "04a_menu_klik_kanan.png")
            menu.get_by_role("menuitem", name="Lepas pin").click()
            check("4b avatar W4 hilang dari rail", wait_until(lambda: "W4" not in rail_names(a), 10), repr(rail_names(a)))
            check("4c server: W4 tidak di-pin", "W4" not in server_pins(base, A))
            check("4d halaman W4 terbuka: tombol kembali 'Pin'",
                  wait_until(lambda: pin_btn(a).inner_text().strip() == "Pin", 5))
            shot(a, "04b_setelah_lepas_pin.png")

            # ── 5. pin ke-6: tombol nonaktif dengan tooltip ──────────────────────────
            pin_btn(a).click()  # W4 → 4 pin
            wait_until(lambda: pin_btn(a).inner_text().strip() == "Di-pin", 10)
            open_ws_via_all(a, "W5")
            pin_btn(a).click()  # W5 → 5 pin
            wait_until(lambda: pin_btn(a).inner_text().strip() == "Di-pin", 10)
            check("5a server 5 pin", len(server_pins(base, A)) == 5, repr(server_pins(base, A)))
            check("5b rail 5 avatar", wait_until(lambda: len(rail_names(a)) == 5, 10), repr(rail_names(a)))
            open_ws_via_all(a, "W6")
            btn = pin_btn(a)
            check("5c W6: tombol 'Pin' nonaktif", btn.inner_text().strip() == "Pin" and btn.is_disabled())
            check("5d tooltip pin penuh", btn.get_attribute("title") == FULL_TEXT, repr(btn.get_attribute("title")))
            shot(a, "05_pin_penuh_nonaktif.png")

            # ── 6. pin ke-6 lewat perangkat kedua saat tombol perangkat pertama aktif ──
            # Lepas W5 dari halaman pertama (4 pin) → W6 tombol aktif.
            rail_btn(a, "W5").click(button="right")
            a.locator(".sidebar-rail-ctx").get_by_role("menuitem", name="Lepas pin").click()
            wait_until(lambda: "W5" not in rail_names(a), 10)
            open_ws_via_all(a, "W6")
            check("6a W6: tombol 'Pin' aktif dengan 4 pin", wait_until(lambda: pin_btn(a).is_enabled(), 5))
            # Perangkat kedua (context browser kedua, user sama) mem-pin W5 → server 5 pin.
            ctx2, d2 = open_app(browser, base, A)
            open_ws_via_all(d2, "W5")
            pin_btn(d2).click()
            check("6b perangkat kedua mem-pin W5 (server 5 pin)",
                  wait_until(lambda: len(server_pins(base, A)) == 5, 10), repr(server_pins(base, A)))
            ctx2.close()
            before_rail = rail_names(a)
            pin_btn(a).click()
            t = wait_until(lambda: toast_text(a), 8)
            check("6c toast 409", (t or "").strip() == FULL_TEXT, repr(t))
            shot(a, "06_toast_pin_limit.png")
            a.wait_for_timeout(500)
            check("6d tombol tetap 'Pin' (state tidak berubah)", pin_btn(a).inner_text().strip() == "Pin")
            check("6e rail tidak berubah", rail_names(a) == before_rail, repr((before_rail, rail_names(a))))
            check("6f server tetap 5 pin tanpa W6", "W6" not in server_pins(base, A) and len(server_pins(base, A)) == 5)
            ctx.close()

            # ── 7. offline: reload dari cache SW → rail sama, tombol nonaktif ─────────
            ctxo, o = open_app(browser, base, A, sw=True)
            pins_now = server_pins(base, A)
            wait_until(lambda: rail_names(o) == pins_now, 15)
            o.wait_for_function("() => navigator.serviceWorker && navigator.serviceWorker.controller", timeout=20000) \
                if o.evaluate("() => !!navigator.serviceWorker") else None
            o.wait_for_timeout(1500)  # listsync menulis cache IndexedDB
            online_rail = rail_names(o)
            ctxo.set_offline(True)
            o.reload()
            o.locator(".sidebar-link").first.wait_for(state="attached", timeout=20000)
            got = wait_until(lambda: rail_names(o) == online_rail and rail_names(o), 15)
            check("7a offline: rail sama setelah reload", got == online_rail, repr((online_rail, rail_names(o))))
            open_ws_from_rail(o, online_rail[0])
            b = pin_btn(o)
            check("7b offline: tombol 'Di-pin' nonaktif + tooltip",
                  b.is_disabled() and b.get_attribute("title") == OFFLINE_TEXT, repr(b.get_attribute("title")))
            rail_btn(o, online_rail[0]).click(button="right")
            item = o.locator(".sidebar-rail-ctx").get_by_role("menuitem", name="Lepas pin")
            check("7c offline: 'Lepas pin' nonaktif + tooltip",
                  item.is_disabled() and item.get_attribute("title") == OFFLINE_TEXT)
            shot(o, "07_offline_rail_menu.png")
            o.keyboard.press("Escape")
            ctxo.set_offline(False)
            ctxo.close()

            # ── 8. tema gelap ────────────────────────────────────────────────────────
            ctxd, dk = open_app(browser, base, A, theme="dark")
            check("8a tema gelap aktif", dk.evaluate("() => document.documentElement.getAttribute('data-theme')") == "dark")
            wait_until(lambda: len(rail_names(dk)) == 5, 10)
            open_ws_from_rail(dk, rail_names(dk)[1])
            shot(dk, "08a_gelap_workspace_dipin.png")
            open_ws_via_all(dk, "W6")
            check("8b gelap: W6 tombol nonaktif (5 pin)", pin_btn(dk).is_disabled())
            shot(dk, "08b_gelap_pin_penuh.png")
            rail_btn(dk, rail_names(dk)[0]).click(button="right")
            dk.locator(".sidebar-rail-ctx").wait_for()
            shot(dk, "08c_gelap_menu_klik_kanan.png")
            ctxd.close()
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
