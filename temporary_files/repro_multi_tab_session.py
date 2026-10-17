"""Reproduksi: sesi Alurik di beberapa tab browser (satu profil = localStorage + cookie bersama).

Skenario
  S1  token kedaluwarsa → tab A & B sama-sama menampilkan form login → login di tab A →
      pindah ke tab B: apakah B ikut masuk lagi, atau minta login ulang?
  S2  tab C masih memegang token lama di memori; respons 401 untuk request yang dikirim sebelum
      tab A login baru tiba SETELAH A login → apakah token baru A di localStorage ikut terhapus?
  S3  logout manual di tab A → apakah tab B ikut keluar (data lokal sudah dihapus A)?

  S4  (--renew) token berumur 25 jam diperpanjang otomatis; cookie & tab lain ikut token baru
  S5  (--renew) akun lain masuk di tab lain → tab akun lama dimuat ulang sebagai akun baru

Pakai (server lokal dengan WEB_SECRET_KEY=<secret>, mis. `WEB_SECRET_KEY=localtestkey WEB_PORT=8182
DB_PATH=/tmp/x.db python3 webapp.py`):
    python3 temporary_files/repro_multi_tab_session.py http://localhost:8182 localtestkey --renew
Hasil 2026-10-17: main (v414) S1 B tetap login, S2 token A hilang, S3 B tetap masuk; branch v415 semua beres.
"""
import json
import sys
import time

import jwt
import requests
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8181"
SECRET = sys.argv[2] if len(sys.argv) > 2 else "localtestkey"
PW = "rahasia123"
TTL = 25  # detik masa berlaku token uji


def register():
    u = "tab%d" % int(time.time() * 1000 % 10_000_000)
    r = requests.post(BASE + "/api/auth/register",
                      json={"username": u, "password": PW, "email": u + "@ex.com", "display_name": u})
    r.raise_for_status()
    return u, r.json()["user_id"]


def short_token(uid, username, ttl):
    exp = int(time.time()) + ttl
    return jwt.encode({"sub": str(uid), "username": username, "exp": exp}, SECRET, algorithm="HS256"), exp


def state(page, _tries=20):
    """'login' | 'app' | 'loading' — dibaca dari DOM (tunggu bila halaman sedang dimuat ulang)."""
    for _ in range(_tries):
        try:
            return _state(page)
        except Exception:
            page.wait_for_timeout(300)
    return "navigating"


def _state(page):
    return page.evaluate("""() => {
        const t = document.body ? document.body.innerText : "";
        if (t.includes("V4 — Login")) return "login";
        if (document.querySelector("nav, aside, .sidebar") || t.includes("Dashboard")) return "app";
        return "loading";
    }""")


def wait_state(page, want, timeout=15):
    end = time.time() + timeout
    while time.time() < end:
        if state(page) == want:
            return True
        page.wait_for_timeout(250)
    return False


def ping_visible(page):
    page.bring_to_front()
    page.evaluate("document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('focus'))")


def ls_token(page):
    return page.evaluate("localStorage.getItem('tf_token')")


def login_ui(page, username):
    page.locator("form input.input").first.fill(username)
    page.locator("form input[type=password]").fill(PW)
    page.locator("form input[type=password]").press("Enter")


def seed(ctx, token, exp, uid, block_renew=False):
    ctx.add_cookies([{"name": "token", "value": token, "url": BASE, "expires": exp,
                      "httpOnly": True, "sameSite": "Lax"}])
    p = ctx.new_page()
    p.goto(BASE + "/manifest.json")
    p.evaluate("""([t, u]) => {
        localStorage.setItem('tf_token', t); localStorage.setItem('tf_user_id', String(u));
        for (const pg of ['dashboard','tasks','today','calendar','kanban','notes','mindmap','chat','habits','habit','settings','draw','goals','review','focus'])
            localStorage.setItem('tf_tour_' + pg, '1');
        localStorage.setItem('tf_dismiss_onboarding', '1');
    }""", [token, uid])
    if block_renew:  # S1/S2 menguji token yang benar-benar kedaluwarsa (app tidak dipakai) → tahan perpanjangan
        p.evaluate("localStorage.setItem('tf_token_renew_at', String(Date.now()))")
    p.close()


def main():
    results = {}
    with sync_playwright() as p:
        browser = p.chromium.launch()

        # ── S1 + S2 ───────────────────────────────────────────────────────────
        username, uid = register()
        t1, exp = short_token(uid, username, TTL)
        ctx = browser.new_context(service_workers="block")
        seed(ctx, t1, exp, uid, block_renew=True)
        a = ctx.new_page(); a.goto(BASE + "/")
        b = ctx.new_page(); b.goto(BASE + "/")
        c = ctx.new_page(); c.goto(BASE + "/")
        assert wait_state(a, "app") and wait_state(b, "app") and wait_state(c, "app"), "awal: semua tab harus masuk"

        # tab C: tahan semua request /api/ setelah token kedaluwarsa (simulasi request in-flight)
        held = []
        expired_at = exp + 1
        def hold(route):
            if time.time() >= expired_at:
                held.append(route)
            else:
                route.continue_()
        c.route("**/api/**", hold)

        time.sleep(max(0, exp - time.time()) + 2)  # token & cookie kedaluwarsa

        ping_visible(b)  # tab B menyadari lebih dulu (mis. poll notifikasi di latar)
        results["S1.tabB_login_setelah_kedaluwarsa"] = wait_state(b, "login")
        ping_visible(a)
        results["S1.tabA_login_setelah_kedaluwarsa"] = wait_state(a, "login")

        a.bring_to_front()
        login_ui(a, username)
        results["S1.tabA_masuk_lagi"] = wait_state(a, "app")
        t2 = ls_token(a)
        results["S1.token_baru_tersimpan"] = bool(t2) and t2 != t1

        ping_visible(b)
        b.wait_for_timeout(2500)
        results["S1.tabB_setelah_pindah_tab"] = state(b)  # harapan: 'app'

        # S2: request C yang dikirim sebelum A login baru dijawab 401 sekarang
        ping_visible(c)
        c.wait_for_timeout(1500)
        n_held = len(held)
        n_401 = 0
        for r in held:
            try:
                # hanya request yang DIKIRIM dengan token lama T1 yang dijawab 401 (seperti server sungguhan);
                # request baru (mis. pemulihan sesi dengan T2) diteruskan ke server
                if t1 in (r.request.headers.get("authorization") or ""):
                    n_401 += 1
                    r.fulfill(status=401, content_type="application/json", body=json.dumps({"detail": "Token expired"}))
                else:
                    r.continue_()
            except Exception:
                pass
        results["S2.request_dijawab_401_token_lama"] = n_401
        c.unroute("**/api/**")
        c.wait_for_timeout(2500)
        results["S2.request_ditahan"] = n_held
        results["S2.token_di_localStorage_setelah_401_basi"] = "masih T2" if ls_token(a) == t2 else ("hilang" if not ls_token(a) else "lain")
        results["S2.tabC_state"] = state(c)
        a.reload()
        a.wait_for_timeout(4000)
        results["S2.tabA_setelah_reload"] = state(a)  # harapan: 'app'
        ctx.close()

        # ── S3: logout manual di satu tab ─────────────────────────────────────
        username3, uid3 = register()
        ctx3 = browser.new_context(service_workers="block")
        tok = requests.post(BASE + "/api/auth/login", json={"username": username3, "password": PW}).json()["token"]
        seed(ctx3, tok, int(time.time()) + 3600, uid3)
        a3 = ctx3.new_page(); a3.goto(BASE + "/")
        b3 = ctx3.new_page(); b3.goto(BASE + "/")
        assert wait_state(a3, "app") and wait_state(b3, "app")
        a3.bring_to_front()
        a3.evaluate("window.__logout && window.__logout()")
        results["S3.tabA_login_setelah_logout"] = wait_state(a3, "login")
        b3.wait_for_timeout(3000)
        results["S3.tabB_setelah_logout_di_A"] = state(b3)  # harapan: 'login'
        ctx3.close()

        if "--renew" in sys.argv:
            # ── S4: token berumur 25 jam diperpanjang otomatis, tab lain ikut memakai token baru ──
            username4, uid4 = register()
            now = int(time.time())
            old = jwt.encode({"sub": str(uid4), "username": username4, "iat": now - 25 * 3600,
                              "auth_time": now - 25 * 3600, "exp": now + 47 * 3600}, SECRET, algorithm="HS256")
            ctx4 = browser.new_context(service_workers="block")
            seed(ctx4, old, now + 47 * 3600, uid4)
            # throttle aktif saat dimuat → belum ada perpanjangan; dibuka lalu dipicu manual di tab A
            pre = ctx4.new_page(); pre.goto(BASE + "/manifest.json")
            pre.evaluate("localStorage.setItem('tf_token_renew_at', String(Date.now()))"); pre.close()
            a4 = ctx4.new_page(); a4.goto(BASE + "/")
            b4 = ctx4.new_page(); b4.goto(BASE + "/")
            assert wait_state(a4, "app") and wait_state(b4, "app")
            results["S4.belum_diperpanjang_saat_throttle"] = ls_token(a4) == old
            a4.evaluate("localStorage.setItem('tf_token_renew_at', '0')")
            ping_visible(a4)
            a4.wait_for_timeout(2500)
            new = ls_token(a4)
            results["S4.token_diperpanjang"] = bool(new) and new != old
            p_new = jwt.decode(new, SECRET, algorithms=["HS256"]) if new and new != old else {}
            results["S4.auth_time_tetap"] = p_new.get("auth_time") == now - 25 * 3600
            results["S4.iat_baru"] = p_new.get("iat", 0) >= now - 5
            ck = [c for c in ctx4.cookies() if c["name"] == "token"]
            results["S4.cookie_ikut_baru"] = bool(ck) and ck[0]["value"] == new
            results["S4.tabB_memakai_token_baru"] = b4.evaluate("tokenStore.get()") == new
            ping_visible(b4); b4.wait_for_timeout(1500)
            results["S4.tabB_tetap_masuk"] = state(b4)
            ctx4.close()

            # ── S5: akun lain masuk di tab lain → tab B (akun X) dimuat ulang sebagai akun Y ──
            ux, idx = register(); uy, idy = register()
            ctx5 = browser.new_context(service_workers="block")
            tx = requests.post(BASE + "/api/auth/login", json={"username": ux, "password": PW}).json()["token"]
            ty = requests.post(BASE + "/api/auth/login", json={"username": uy, "password": PW}).json()["token"]
            seed(ctx5, tx, int(time.time()) + 3600, idx)
            b5 = ctx5.new_page(); b5.goto(BASE + "/")
            assert wait_state(b5, "app")
            b5.evaluate("window.__tf_marker = 1")
            other = ctx5.new_page(); other.goto(BASE + "/manifest.json")
            other.evaluate("([t, u]) => { localStorage.setItem('tf_user_id', String(u)); localStorage.setItem('tf_token', t); }", [ty, idy])
            b5.wait_for_timeout(4000)
            results["S5.tabB_dimuat_ulang"] = b5.evaluate("window.__tf_marker === undefined")
            results["S5.tabB_akun"] = b5.evaluate("(tokenPayload(tokenStore.get()) || {}).sub") == str(idy)
            results["S5.tabB_state"] = state(b5)
            ctx5.close()
        browser.close()

    for k, v in results.items():
        print("%-48s %s" % (k, v))


if __name__ == "__main__":
    main()
