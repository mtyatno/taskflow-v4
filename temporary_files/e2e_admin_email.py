"""E2E kartu Email di halaman Admin (spec 2026-10-21-email-fase0b-mailer, Task 7). Tidak dijalankan CI.

Server lokal (uvicorn webapp:app, DB sementara, tanpa SMTP_HOST = dev mode), worker email hidup.
  1  Admin: halaman Admin → kartu "Email" → badge "Dev mode".
  2  "Kirim email tes" → toast "Email tes terkirim" dan baris teratas "Terkirim" (jenis "Email tes") ≤ 30 dtk.
  3  User non-admin: tanpa menu Admin / kartu Email.
  4  User biasa "Lupa password" (API) → baris "Reset password" dengan penerima tersamar (xx***@domain).
  5  Baris `failed` (dibuat lewat sqlite) → "Coba lagi" → setelah muat ulang jadi "Antre"/"Terkirim".
  6  Tema gelap (screenshot) dan viewport 375 px tanpa scroll horizontal.
Screenshot: temporary_files/e2e_admin_email/. Keluar non-zero bila ada cek gagal.

    python temporary_files/e2e_admin_email.py
"""
import os
import socket
import sqlite3
import subprocess
import sys
import tempfile
import time

import requests
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHOTS = os.path.join(ROOT, "temporary_files", "e2e_admin_email")
PW = "rahasia123"
SECRET = "e2e-admin-email-secret"
TOURS = ['dashboard', 'tasks', 'today', 'calendar', 'kanban', 'notes', 'mindmap', 'chat', 'habits', 'habit',
         'settings', 'draw', 'goals', 'review', 'focus', 'workspace', 'slist', 'all', 'inbox',
         'done', 'overdue', 'next', 'waiting', 'someday', 'admin']

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
               WEB_SECRET_KEY=SECRET, TELEGRAM_BOT_TOKEN="", SMTP_HOST="")
    os.makedirs(env["UPLOAD_DIR"], exist_ok=True)
    log = open(os.path.join(tmp, "server.log"), "w")
    proc = subprocess.Popen([os.environ.get("E2E_PYTHON") or sys.executable, "-m", "uvicorn", "webapp:app",
                             "--host", "127.0.0.1", "--port", str(port)],
                            cwd=ROOT, env=env, stdout=log, stderr=subprocess.STDOUT)
    base = "http://127.0.0.1:%d" % port
    for _ in range(120):
        try:
            if requests.get(base + "/manifest.json", timeout=1).status_code < 500:
                return proc, base, env["DB_PATH"], log.name
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
    return {"username": u, "id": j["user_id"], "token": j["token"], "email": u + "@ex.com"}


def open_app(browser, base, user, theme="light", width=1280, height=900):
    ctx = browser.new_context(service_workers="block", viewport={"width": width, "height": height})
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
    page.evaluate("() => { const e = document.querySelector('section.admin-email'); if (e) e.scrollIntoView({block: 'start'}); }")
    page.mouse.move(5, 5)
    page.wait_for_timeout(400)
    path = os.path.join(SHOTS, name)
    page.screenshot(path=path, full_page=False)
    print("  screenshot", os.path.relpath(path, ROOT), flush=True)


def go_admin(p):
    link = p.locator(".sidebar-link").filter(has_text="Admin").first
    if p.viewport_size["width"] < 700:
        link.evaluate("el => el.click()")  # sidebar = drawer di layar sempit
    else:
        if not link.is_visible():
            p.locator("button[aria-label='Tampilkan semua menu']").first.click()
        link.click()
    p.locator("section.admin-email").wait_for(timeout=15000)
    p.locator(".admin-email-badge").wait_for(timeout=15000)


def table_rows(p):
    return p.locator("table.admin-email-table tbody tr")


def main():
    os.makedirs(SHOTS, exist_ok=True)
    tmp = tempfile.mkdtemp(prefix="e2e_admin_email_")
    proc, base, db, logpath = start_server(tmp)
    try:
        admin = register(base, "adm", "Admin E2E")
        normal = register(base, "usr", "User Biasa")
        with sqlite3.connect(db) as c:
            c.execute("UPDATE users SET is_admin=1 WHERE id=?", (admin["id"],))
        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            ctx, p = open_app(browser, base, admin)
            go_admin(p)
            badge = p.locator(".admin-email-badge").inner_text()
            check("1 badge dev mode", "Dev mode" in badge, badge)
            shot(p, "01-admin-card.png")

            # 2 email tes
            p.get_by_role("button", name="Kirim email tes", exact=True).click()
            toast_ok = False
            try:
                p.locator(".toast").filter(has_text="Email tes terkirim").first.wait_for(timeout=35000)
                toast_ok = True
            except Exception:  # noqa: BLE001
                pass
            check("2a toast 'Email tes terkirim' ≤ 35 dtk", toast_ok)
            first = table_rows(p).first
            txt = first.inner_text() if table_rows(p).count() else ""
            check("2b baris teratas 'Email tes' + 'Terkirim'", "Email tes" in txt and "Terkirim" in txt, txt.replace("\n", " | "))
            shot(p, "02-test-sent.png")

            # 3 non-admin
            ctx2, p2 = open_app(browser, base, normal)
            p2.wait_for_timeout(1500)
            has_link = p2.locator(".sidebar-link").filter(has_text="Admin").count() > 0
            has_card = p2.locator("section.admin-email").count() > 0
            r = requests.get(base + "/api/admin/email/status", headers={"Authorization": "Bearer " + normal["token"]})
            check("3 non-admin tanpa menu/kartu, API 403", not has_link and not has_card and r.status_code == 403,
                  "link=%s card=%s api=%d" % (has_link, has_card, r.status_code))
            ctx2.close()

            # 4 lupa password
            r = requests.post(base + "/api/auth/forgot", json={"email": normal["email"]})
            check("4a forgot 200", r.status_code == 200, str(r.status_code))
            p.locator("button.admin-email-reload").click()
            ok = False
            for _ in range(20):
                p.wait_for_timeout(500)
                t = " ".join(table_rows(p).nth(i).inner_text().replace("\n", " ") for i in range(table_rows(p).count()))
                if "Reset password" in t:
                    ok = True
                    break
            local = normal["email"].split("@")[0][:2]
            masked = local + "***@ex.com"
            rowtxt = [table_rows(p).nth(i).inner_text().replace("\n", " ") for i in range(table_rows(p).count())]
            reset_row = next((x for x in rowtxt if "Reset password" in x), "")
            check("4b baris 'Reset password' dengan penerima tersamar",
                  ok and masked in reset_row and normal["email"] not in reset_row, reset_row)
            shot(p, "03-reset-row.png")

            # 5 coba lagi pada baris failed
            now = time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime())
            with sqlite3.connect(db) as c:
                c.execute("INSERT INTO email_outbox (kind, user_id, to_addr, subject, body_text, body_html, status,"
                          " attempts, last_error, next_attempt_at, created_at, updated_at)"
                          " VALUES ('test', ?, ?, 'Tes gagal', 'x', '<p>x</p>', 'failed', 5, 'SMTP: simulasi gagal',"
                          " ?, ?, ?)", (admin["id"], "gagal@ex.com", now, now, now))
                fid = c.execute("SELECT max(id) FROM email_outbox").fetchone()[0]
            p.locator("button.admin-email-reload").click()
            p.get_by_role("button", name="Coba lagi", exact=True).first.wait_for(timeout=10000)
            shot(p, "04-failed-row.png")
            check("5a baris Gagal tampil dengan tombol 'Coba lagi'",
                  table_rows(p).filter(has_text="gagal***@ex.com".replace("gagal", "ga")).count() >= 1)
            table_rows(p).filter(has=p.get_by_role("button", name="Coba lagi", exact=True)).first \
                .get_by_role("button", name="Coba lagi", exact=True).click()
            p.locator(".toast").filter(has_text="antrean lagi").first.wait_for(timeout=10000)
            p.reload()
            p.locator(".sidebar-link").first.wait_for(state="attached", timeout=20000)
            try:
                p.locator("section.admin-email").wait_for(timeout=5000)  # halaman terakhir dipulihkan
            except Exception:  # noqa: BLE001
                go_admin(p)
            row = None
            for _ in range(10):
                p.wait_for_timeout(500)
                row = next((table_rows(p).nth(i).inner_text().replace("\n", " ")
                            for i in range(table_rows(p).count()) if "ga***@ex.com" in table_rows(p).nth(i).inner_text()), None)
                if row and ("Antre" in row or "Terkirim" in row):
                    break
            with sqlite3.connect(db) as c:
                st = c.execute("SELECT status FROM email_outbox WHERE id=?", (fid,)).fetchone()[0]
            check("5b setelah 'Coba lagi' + reload: Antre/Terkirim", bool(row) and ("Antre" in row or "Terkirim" in row)
                  and st in ("queued", "sending", "sent"), "%s | db=%s" % (row, st))
            shot(p, "05-retried.png")
            ctx.close()

            # 6 gelap + 375px
            ctx3, p3 = open_app(browser, base, admin, theme="dark")
            go_admin(p3)
            shot(p3, "06-dark-desktop.png")
            ctx3.close()
            ctx4, p4 = open_app(browser, base, admin, theme="dark", width=375, height=800)
            go_admin(p4)
            p4.wait_for_timeout(500)
            sw = p4.evaluate("document.documentElement.scrollWidth")
            check("6a 375 px tanpa scroll horizontal", sw <= 375, "scrollWidth=%d" % sw)
            shot(p4, "07-dark-375.png")
            ctx4.close()
            ctx5, p5 = open_app(browser, base, admin, theme="light", width=375, height=800)
            go_admin(p5)
            p5.wait_for_timeout(500)
            sw = p5.evaluate("document.documentElement.scrollWidth")
            check("6b 375 px terang tanpa scroll horizontal", sw <= 375, "scrollWidth=%d" % sw)
            shot(p5, "08-light-375.png")
            ctx5.close()
            browser.close()
    finally:
        proc.terminate()
        try:
            proc.wait(10)
        except subprocess.TimeoutExpired:
            proc.kill()
    bad = [r for r in results if not r[1]]
    print("\n%d/%d cek lulus" % (len(results) - len(bad), len(results)))
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
