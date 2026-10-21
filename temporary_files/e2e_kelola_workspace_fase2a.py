"""E2E Kelola Workspace Fase 2a — undangan & akses gabung (spec 2026-10-21-kelola-workspace-fase2a, brief Task 7).
Tidak dijalankan CI.

Akun A (owner "Ana"), B ("Budi"), C ("Cici"). Semua workspace milik A.
  1  Undangan username (terang: A → B; gelap: A → C): A undang lewat UI → "Undangan dikirim" + "Undangan menunggu";
     penerima: badge rail "Semua workspace" + menu Kelola Workspace, notifikasi diklik → manage_lists + seksi
     #ws-invitations di layar, Terima → toast "Bergabung ke {nama}", kartu workspace muncul, badge hilang.
  2  Undang lagi (workspace lain) → Tolak → toast "Undangan ditolak", workspace tidak muncul, badge hilang.
  3  Owner Batalkan undangan menunggu → hilang di penerima (seksi + badge).
  4  Link 1 orang (L): "Sisa 1 dari 1 · berlaku sampai …"; B gabung lewat ?join= (modal "Owner: Ana · 1 anggota");
     C ditolak "Link sudah mencapai batas pemakaian."; link hilang dari daftar aktif owner.
  5  Link tanpa batas (L2): "Tanpa batas · berlaku sampai …"; B (Masukkan Kode) + C (?join=, "Owner: Ana · 2
     anggota") gabung; uses = 2. Batalkan satu link → "Link sudah dibatalkan owner."; Matikan semua (dialog Alurik)
     → "Belum ada link aktif." + link lama ditolak "Link sudah dibatalkan owner."; kedaluwarsa (DB) →
     "Link sudah kedaluwarsa."; kode asal → "Kode tidak valid.".
  6  Offline → Undang, Buat link, Batalkan (undangan/link), Matikan semua link (owner) dan Terima/Tolak (penerima)
     nonaktif dengan "Butuh koneksi internet".
  7  375 px terang + gelap: daftar (seksi Undangan untukmu) dan detail owner (undangan + link) tanpa scroll
     horizontal.

Server lokal: uvicorn webapp:app, DB sementara (helper e2e_kelola_workspace_fase0.py; E2E_PYTHON opsional).
Screenshot: temporary_files/e2e_kelola_workspace_fase2a/. Keluar non-zero bila ada langkah gagal.

    python temporary_files/e2e_kelola_workspace_fase2a.py
"""
import os
import re
import sqlite3
import subprocess
import sys
import tempfile
import traceback

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import e2e_kelola_workspace_fase0 as F0  # noqa: E402
import e2e_kelola_workspace_fase1 as F1  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402

ROOT = F0.ROOT
SHOTS = os.path.join(ROOT, "temporary_files", "e2e_kelola_workspace_fase2a")
check, wait_until, api = F0.check, F0.wait_until, F0.api
results = F0.results
card, refresh, go_list, no_hscroll, expand_sidebar = F1.card, F1.refresh, F1.go_list, F1.no_hscroll, F1.expand_sidebar

OFF = "Butuh koneksi internet"
MSG_REVOKED = "Link sudah dibatalkan owner."
MSG_EXPIRED = "Link sudah kedaluwarsa."
MSG_FULL = "Link sudah mencapai batas pemakaian."
MSG_MISSING = "Kode tidak valid."


# ── helper ──────────────────────────────────────────────────────────────────────────────────────
def open_app(browser, base, user, theme="light", width=1280, height=860, path="/"):
    kw = {"service_workers": "block", "viewport": {"width": width, "height": height}}
    if width < 600:
        kw.update(has_touch=True, is_mobile=True)
    ctx = browser.new_context(**kw)
    ctx.grant_permissions(["clipboard-read", "clipboard-write"], origin=base)
    ctx.add_cookies([{"name": "token", "value": user["token"], "url": base, "httpOnly": True, "sameSite": "Lax"}])
    p = ctx.new_page()
    errors = []
    p.on("pageerror", lambda e: errors.append(str(e)))
    p._e2e_errors = errors
    p.goto(base + "/manifest.json")
    p.evaluate("""([t, u, tours, theme]) => {
        localStorage.setItem('tf_token', t); localStorage.setItem('tf_user_id', String(u));
        for (const pg of tours) localStorage.setItem('tf_tour_' + pg, '1');
        localStorage.setItem('tf_dismiss_onboarding', '1');
        localStorage.setItem('tf_shortcut_hint', '1');
        localStorage.setItem('tf_theme', theme);
    }""", [user["token"], user["id"], F0.TOURS, theme])
    p.goto(base + path)
    p.locator(".sidebar-link").first.wait_for(state="attached", timeout=20000)
    return ctx, p


def shot(p, name, full=True):
    p.mouse.move(2, 2)
    p.wait_for_timeout(350)
    path = os.path.join(SHOTS, name)
    p.screenshot(path=path, full_page=full)
    print("  screenshot", os.path.relpath(path, ROOT), flush=True)


def anggota(p, lid):
    return p.locator("section[aria-labelledby='ws-sec-anggota-%d']" % lid)


def open_detail(p, lid):
    go_list(p)
    card(p, lid).get_by_role("button", name="Kelola", exact=True).click()
    anggota(p, lid).wait_for(timeout=8000)


def badge_state(p):
    """(label rail 'Semua workspace', teks badge rail, teks link sidebar 'Kelola Workspace')."""
    return p.evaluate("""() => {
        const r = [...document.querySelectorAll('.sidebar-rail-btn')].find(b => (b.getAttribute('aria-label') || '').startsWith('Semua workspace'));
        const bd = r && r.querySelector('.sidebar-rail-badge');
        const l = [...document.querySelectorAll('.sidebar-link')].find(x => x.textContent.includes('Kelola Workspace'));
        return { rail: r ? r.getAttribute('aria-label') : null, railBadge: bd ? bd.textContent.trim() : null,
                 link: l ? l.textContent.replace(/\\s+/g, ' ').trim() : null };
    }""")


def has_badge(p, n):
    s = badge_state(p)
    return (s["rail"] == "Semua workspace, %d undangan" % n and s["railBadge"] == str(n)
            and s["link"] is not None and s["link"].endswith("Kelola Workspace%d" % n))


def no_badge(p):
    s = badge_state(p)
    return s["rail"] == "Semua workspace" and s["railBadge"] is None and s["link"] == "Kelola Workspace"


def inv_section(p):
    return p.locator("#ws-invitations")


def toast(p, text):
    return wait_until(lambda: p.locator(".toast").filter(has_text=text).count() >= 1, 8)


def field(sec, label):
    """<select> di dalam <label>{label}<select>…</label> (nama aksesibel label ikut memuat teks opsi)."""
    return sec.locator("label").filter(has_text=re.compile("^" + re.escape(label))).locator("select")


def link_codes(base, A, lid):
    return [l["code"] for l in api(base, A, "GET", "/api/lists/%d/links" % lid)]


def preview_via_code(p, code):
    """Halaman daftar → Masukkan Kode → Cek. Mengembalikan teks galat atau pratinjau setelah tampil."""
    go_list(p)
    if p.get_by_placeholder("Paste kode invite...").count() == 0:
        p.get_by_role("button", name="Masukkan Kode").click()
    p.get_by_placeholder("Paste kode invite...").fill(code)
    p.get_by_role("button", name="Cek", exact=True).click()


def close_join_form(p):
    btn = p.get_by_role("button", name="Batal", exact=True)
    if p.locator(".ws-join-preview").count() and btn.count():
        btn.first.click()


# ── langkah 1–3 ─────────────────────────────────────────────────────────────────────────────────
def invite_flows(base, A, a, U, u, ws, tag):
    """A (halaman a) mengundang U (halaman u). ws = dict acc/dec/can → (id, nama)."""
    acc_id, acc_name = ws["acc"]
    dec_id, dec_name = ws["dec"]
    can_id, can_name = ws["can"]
    refresh(u)
    check("[%s] 1-pra penerima tanpa badge" % tag, wait_until(lambda: no_badge(u), 8), repr(badge_state(u)))

    # 1. undang lewat UI → terima
    open_detail(a, acc_id)
    sec = anggota(a, acc_id)
    sec.get_by_role("button", name="＋ Undang via Username").click()
    sec.get_by_label("Username anggota baru").fill("@" + U["username"])
    sec.get_by_role("button", name="Undang", exact=True).click()
    check("[%s] 1a toast 'Undangan dikirim ke @%s'" % (tag, U["username"]),
          toast(a, "Undangan dikirim ke @%s" % U["username"]))
    batal = sec.get_by_role("button", name="Batalkan undangan untuk @%s" % U["username"], exact=True)
    check("[%s] 1b 'Undangan menunggu' memuat penerima + Batalkan" % tag,
          wait_until(lambda: "Undangan menunggu" in sec.inner_text() and batal.count() == 1, 8),
          repr(sec.inner_text()[:300]))
    check("[%s] 1b' server: penerima belum anggota" % tag,
          all(m.get("id") != U["id"] for m in api(base, A, "GET", "/api/lists/%d" % acc_id).get("members", [])))
    shot(a, "1a_owner_undangan_menunggu_%s.png" % tag)

    check("[%s] 1c penerima: badge rail + menu Kelola Workspace = 1" % tag,
          wait_until(lambda: (refresh(u) or True) and has_badge(u, 1), 20), repr(badge_state(u)))
    expand_sidebar(u)
    shot(u, "1b_penerima_badge_%s.png" % tag, full=False)
    # notifikasi diklik → manage_lists + seksi undangan
    bell = u.locator("button[title='Notifikasi']:visible")
    bell.first.click()
    item = u.get_by_text("mengundangmu ke workspace %s" % acc_name)
    check("[%s] 1d notifikasi undangan tampil" % tag, wait_until(lambda: item.count() >= 1, 8))
    shot(u, "1c_notifikasi_%s.png" % tag, full=False)
    item.first.click()
    check("[%s] 1e klik notifikasi → Kelola Workspace + #ws-invitations di layar" % tag,
          wait_until(lambda: u.locator("h2").filter(has_text="Kelola Workspace").count() >= 1
                     and inv_section(u).count() == 1
                     and u.evaluate("""() => { const r = document.getElementById('ws-invitations').getBoundingClientRect();
                                         return r.top >= -2 && r.top < window.innerHeight; }"""), 8))
    row = inv_section(u).locator("[data-invitation]")
    check("[%s] 1f seksi 'Undangan untukmu': nama workspace + 'Diundang oleh Ana'" % tag,
          row.count() == 1 and acc_name in row.inner_text() and "Diundang oleh Ana" in row.inner_text(),
          repr(row.all_inner_texts()))
    shot(u, "1d_undangan_untukmu_%s.png" % tag)
    row.get_by_role("button", name="Terima", exact=True).click()
    check("[%s] 1g toast 'Bergabung ke %s'" % (tag, acc_name), toast(u, "Bergabung ke %s" % acc_name))
    check("[%s] 1h kartu workspace muncul, seksi + badge hilang" % tag,
          wait_until(lambda: card(u, acc_id).count() == 1 and inv_section(u).count() == 0 and no_badge(u), 15),
          repr(badge_state(u)))
    check("[%s] 1i IndexedDB penerima memuat workspace" % tag,
          wait_until(lambda: (refresh(u) or True) and isinstance(F1.idb_list(u, acc_id), dict), 20))
    check("[%s] 1j server: penerima anggota" % tag,
          any(m.get("id") == U["id"] for m in api(base, A, "GET", "/api/lists/%d" % acc_id).get("members", [])))
    shot(u, "1e_setelah_terima_%s.png" % tag)

    # 2. undang lagi → tolak
    api(base, A, "POST", "/api/lists/%d/invite" % dec_id, json={"username": U["username"]})
    check("[%s] 2a badge muncul lagi" % tag, wait_until(lambda: (refresh(u) or True) and has_badge(u, 1), 20),
          repr(badge_state(u)))
    go_list(u)
    row = inv_section(u).locator("[data-invitation]")
    row.first.wait_for(timeout=8000)
    check("[%s] 2b seksi memuat %s" % (tag, dec_name), dec_name in row.first.inner_text())
    row.first.get_by_role("button", name="Tolak", exact=True).click()
    check("[%s] 2c toast 'Undangan ditolak'" % tag, toast(u, "Undangan ditolak"))
    check("[%s] 2d workspace tidak muncul, seksi + badge hilang" % tag,
          wait_until(lambda: card(u, dec_id).count() == 0 and inv_section(u).count() == 0 and no_badge(u), 10))
    check("[%s] 2e server: undangan menunggu kosong" % tag,
          api(base, A, "GET", "/api/lists/%d/invitations" % dec_id) == [])

    # 3. owner batalkan → hilang di penerima
    api(base, A, "POST", "/api/lists/%d/invite" % can_id, json={"username": U["username"]})
    check("[%s] 3a penerima melihat undangan %s" % (tag, can_name),
          wait_until(lambda: (refresh(u) or True) and has_badge(u, 1) and inv_section(u).count() == 1
                     and can_name in inv_section(u).inner_text(), 20))
    open_detail(a, can_id)
    sec = anggota(a, can_id)
    batal = sec.get_by_role("button", name="Batalkan undangan untuk @%s" % U["username"], exact=True)
    batal.wait_for(timeout=8000)
    batal.click()
    check("[%s] 3b owner: undangan hilang dari 'Undangan menunggu'" % tag,
          wait_until(lambda: batal.count() == 0 and "Undangan menunggu" not in sec.inner_text(), 8))
    check("[%s] 3c penerima: seksi + badge hilang setelah sync" % tag,
          wait_until(lambda: (refresh(u) or True) and inv_section(u).count() == 0 and no_badge(u), 20),
          repr(badge_state(u)))
    shot(u, "3_setelah_dibatalkan_%s.png" % tag)


# ── main ────────────────────────────────────────────────────────────────────────────────────────
def main():
    os.makedirs(SHOTS, exist_ok=True)
    for f in os.listdir(SHOTS):
        if f.endswith(".png"):
            os.remove(os.path.join(SHOTS, f))
    tmp = tempfile.mkdtemp(prefix="e2e_kelola_ws_f2a_")
    proc, base = F0.start_server(tmp)
    db_path = os.path.join(tmp, "e2e.db")
    print("server", base, flush=True)
    pages = []
    try:
        A = F0.register(base, "ana", "Ana")
        B = F0.register(base, "budi", "Budi")
        C = F0.register(base, "cici", "Cici")
        mk = lambda name: (api(base, A, "POST", "/api/lists", json={"name": name})["id"], name)  # noqa: E731
        ws_light = {"acc": mk("Proyek Terima"), "dec": mk("Proyek Tolak"), "can": mk("Proyek Batal")}
        ws_dark = {"acc": mk("Gelap Terima"), "dec": mk("Gelap Tolak"), "can": mk("Gelap Batal")}
        L, L_NAME = mk("Proyek Link Satu")
        L2, L2_NAME = mk("Proyek Link Bebas")
        W4, W4_NAME = mk("Proyek Offline")

        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            ctxa, a = open_app(browser, base, A)
            ctxb, b = open_app(browser, base, B)
            pages += [a, b]

            # ── 1–3 terang (A → B) ─────────────────────────────────────────────────────────────
            invite_flows(base, A, a, B, b, ws_light, "terang")

            # ── 1–3 gelap (A → C) ──────────────────────────────────────────────────────────────
            ctxad, ad = open_app(browser, base, A, "dark")
            ctxcd, cd = open_app(browser, base, C, "dark")
            pages += [ad, cd]
            check("[gelap] tema aktif", cd.evaluate("() => document.documentElement.getAttribute('data-theme')") == "dark")
            invite_flows(base, A, ad, C, cd, ws_dark, "gelap")
            ctxad.close()
            ctxcd.close()

            # ── 4. link 1 orang ────────────────────────────────────────────────────────────────
            open_detail(a, L)
            sec = anggota(a, L)
            check("4a 'Link undangan' + 'Belum ada link aktif.'",
                  wait_until(lambda: "Link undangan" in sec.inner_text() and "Belum ada link aktif." in sec.inner_text(), 8))
            field(sec, "Berlaku").select_option("1d")
            field(sec, "Bisa dipakai").select_option("1")
            sec.get_by_role("button", name="Buat link", exact=True).click()
            inp = sec.locator("input.ws-invite-link")
            check("4b link dibuat: 'Sisa 1 dari 1 · berlaku sampai …'",
                  wait_until(lambda: inp.count() == 1 and "Sisa 1 dari 1 · berlaku sampai " in sec.inner_text(), 8),
                  repr(sec.inner_text()[-300:]))
            join_url = inp.input_value()
            code1 = join_url.split("code=")[-1]
            check("4c join_url berisi /join?code=", "/join?code=" in join_url and len(code1) > 10, join_url)
            sec.get_by_role("button", name="Salin", exact=True).click()
            check("4c' Salin → toast 'Link disalin'", toast(a, "Link disalin"))
            shot(a, "4a_link_satu_orang_terang.png")
            # B lewat ?join=
            ctxj, bj = open_app(browser, base, B, path="/?join=" + code1)
            pages.append(bj)
            modal = bj.locator(".modal-content").filter(has_text="Bergabung ke Shared List")
            check("4d ?join= modal: 'Owner: Ana · 1 anggota'",
                  wait_until(lambda: modal.get_by_text("Owner: Ana · 1 anggota", exact=True).count() == 1, 10),
                  repr(modal.all_inner_texts()))
            check("4d' ?join= dibersihkan dari URL", "join=" not in bj.url, bj.url)
            shot(bj, "4b_join_modal_terang.png", full=False)
            modal.get_by_role("button", name="Gabung ke List Ini").click()
            check("4e B bergabung (toast + kartu)",
                  toast(bj, 'Berhasil bergabung ke "%s"' % L_NAME)
                  and wait_until(lambda: card(bj, L).count() == 1, 10))
            ctxj.close()
            # C ditolak (link penuh)
            ctxc, c = open_app(browser, base, C)
            pages.append(c)
            preview_via_code(c, code1)
            check("4f C: '%s'" % MSG_FULL, wait_until(lambda: c.get_by_text(MSG_FULL, exact=True).count() == 1, 8))
            shot(c, "4c_link_penuh_terang.png")
            check("4g server: C bukan anggota L", all(l["id"] != L for l in api(base, C, "GET", "/api/lists")))
            open_detail(a, L)
            check("4h owner: link penuh tidak lagi di daftar aktif",
                  wait_until(lambda: "Belum ada link aktif." in anggota(a, L).inner_text(), 8))

            # ── 5. link tanpa batas, batalkan, matikan semua, kedaluwarsa, kode asal ──────────
            open_detail(a, L2)
            sec = anggota(a, L2)
            field(sec, "Berlaku").select_option("7d")
            field(sec, "Bisa dipakai").select_option("none")
            sec.get_by_role("button", name="Buat link", exact=True).click()
            inp = sec.locator("input.ws-invite-link")
            check("5a 'Tanpa batas · berlaku sampai …'",
                  wait_until(lambda: inp.count() == 1 and "Tanpa batas · berlaku sampai " in sec.inner_text(), 8))
            code2 = inp.input_value().split("code=")[-1]
            preview_via_code(b, code2)
            check("5b B pratinjau 'Owner: Ana · 1 anggota'",
                  wait_until(lambda: b.get_by_text("Owner: Ana · 1 anggota", exact=True).count() == 1, 8))
            b.locator(".ws-join-preview").locator("xpath=..").get_by_role("button", name="Gabung").click()
            check("5c B bergabung lewat kode", wait_until(lambda: card(b, L2).count() == 1, 10))
            ctxj, cj = open_app(browser, base, C, path="/?join=" + code2)
            pages.append(cj)
            modal = cj.locator(".modal-content").filter(has_text="Bergabung ke Shared List")
            check("5d C ?join=: 'Owner: Ana · 2 anggota'",
                  wait_until(lambda: modal.get_by_text("Owner: Ana · 2 anggota", exact=True).count() == 1, 10))
            modal.get_by_role("button", name="Gabung ke List Ini").click()
            check("5e C bergabung", wait_until(lambda: card(cj, L2).count() == 1, 10))
            ctxj.close()
            ls = api(base, A, "GET", "/api/lists/%d/links" % L2)
            check("5f link tanpa batas: uses = 2, masih aktif", len(ls) == 1 and ls[0]["uses"] == 2, repr(ls))
            # Batalkan satu link
            open_detail(a, L2)
            sec = anggota(a, L2)
            field(sec, "Bisa dipakai").select_option("10")
            sec.get_by_role("button", name="Buat link", exact=True).click()
            check("5g dua link aktif (Maks 10: 'Sisa 10 dari 10')",
                  wait_until(lambda: sec.locator("input.ws-invite-link").count() == 2
                             and "Sisa 10 dari 10" in sec.inner_text(), 8))
            code3 = sec.locator("input.ws-invite-link").first.input_value().split("code=")[-1]
            sec.get_by_role("button", name="Batalkan link undangan").first.click()
            check("5h Batalkan → satu link tersisa",
                  wait_until(lambda: sec.locator("input.ws-invite-link").count() == 1, 8))
            check("5h' link tersisa = link tanpa batas", link_codes(base, A, L2) == [code2], repr(link_codes(base, A, L2)))
            preview_via_code(c, code3)
            check("5i link dibatalkan → '%s'" % MSG_REVOKED,
                  wait_until(lambda: c.get_by_text(MSG_REVOKED, exact=True).count() == 1, 8))
            # Matikan semua
            sec.get_by_role("button", name="Buat link", exact=True).click()
            wait_until(lambda: sec.locator("input.ws-invite-link").count() == 2, 8)
            sec.get_by_role("button", name="Matikan semua link", exact=True).click()
            dlg = a.locator(".modal-overlay").filter(has_text="Matikan semua link undangan workspace ini?")
            dlg.wait_for(timeout=5000)
            shot(a, "5a_dialog_matikan_semua_terang.png", full=False)
            dlg.get_by_role("button", name="Batal", exact=True).click()
            check("5j Batal di dialog → link tetap", wait_until(lambda: dlg.count() == 0, 5)
                  and len(link_codes(base, A, L2)) == 2)
            sec.get_by_role("button", name="Matikan semua link", exact=True).click()
            dlg.wait_for(timeout=5000)
            dlg.get_by_role("button", name="Matikan semua link", exact=True).click()
            check("5k toast 'Semua link dimatikan' + 'Belum ada link aktif.'",
                  toast(a, "Semua link dimatikan")
                  and wait_until(lambda: "Belum ada link aktif." in sec.inner_text(), 8))
            check("5k' server: tanpa link aktif", link_codes(base, A, L2) == [])
            shot(a, "5b_setelah_matikan_semua_terang.png")
            ctxj, cj = open_app(browser, base, C, path="/?join=" + code2)
            pages.append(cj)
            modal = cj.locator(".modal-content").filter(has_text="Bergabung ke Shared List")
            check("5l ?join= link dimatikan → '%s'" % MSG_REVOKED,
                  wait_until(lambda: modal.get_by_text(MSG_REVOKED, exact=True).count() == 1, 10),
                  repr(modal.all_inner_texts()))
            shot(cj, "5c_join_dibatalkan_terang.png", full=False)
            ctxj.close()
            # kedaluwarsa (expires_at dimundurkan langsung di DB)
            code4 = api(base, A, "POST", "/api/lists/%d/generate-link" % L2, json={"expires_in": "1h", "max_uses": 1})["code"]
            con = sqlite3.connect(db_path)
            con.execute("UPDATE list_invites SET expires_at = '2000-01-01T00:00:00' WHERE code = ?", (code4,))
            con.commit()
            con.close()
            preview_via_code(c, code4)
            check("5m kedaluwarsa → '%s'" % MSG_EXPIRED,
                  wait_until(lambda: c.get_by_text(MSG_EXPIRED, exact=True).count() == 1, 8))
            preview_via_code(c, "kode-asal-tidak-ada")
            check("5n kode asal → '%s'" % MSG_MISSING,
                  wait_until(lambda: c.get_by_text(MSG_MISSING, exact=True).count() == 1, 8))
            shot(c, "5d_kode_tidak_valid_terang.png")
            ctxc.close()

            # ── 6. offline ─────────────────────────────────────────────────────────────────────
            api(base, A, "POST", "/api/lists/%d/invite" % W4, json={"username": B["username"]})
            api(base, A, "POST", "/api/lists/%d/generate-link" % W4, json={"expires_in": "1d", "max_uses": 10})
            open_detail(a, W4)
            sec = anggota(a, W4)
            wait_until(lambda: sec.locator("input.ws-invite-link").count() == 1
                       and sec.get_by_role("button", name="Batalkan undangan untuk @%s" % B["username"]).count() == 1, 8)
            check("6b-pra penerima melihat undangan W4",
                  wait_until(lambda: (refresh(b) or True) and has_badge(b, 1), 20))
            go_list(b)
            inv_section(b).wait_for(timeout=8000)
            ctxa.set_offline(True)
            ctxb.set_offline(True)

            def off(loc):
                return loc.count() >= 1 and all(x.is_disabled() and x.get_attribute("title") == OFF for x in loc.all())

            names = ["＋ Undang via Username", "Buat link", "Batalkan undangan untuk @%s" % B["username"],
                     "Batalkan link undangan", "Matikan semua link"]
            check("6a owner offline: %s nonaktif + title '%s'" % (", ".join(names), OFF),
                  wait_until(lambda: all(off(sec.get_by_role("button", name=n, exact=True)) for n in names), 5),
                  repr({n: [(x.is_disabled(), x.get_attribute("title"))
                            for x in sec.get_by_role("button", name=n, exact=True).all()] for n in names}))
            shot(a, "6a_offline_owner_terang.png")
            row = inv_section(b).locator("[data-invitation]")
            check("6b penerima offline: Terima/Tolak nonaktif + title",
                  wait_until(lambda: off(row.get_by_role("button", name="Terima", exact=True))
                             and off(row.get_by_role("button", name="Tolak", exact=True)), 5))
            check("6c penerima offline: badge tetap (cache)", has_badge(b, 1), repr(badge_state(b)))
            shot(b, "6b_offline_penerima_terang.png")
            ctxa.set_offline(False)
            ctxb.set_offline(False)
            check("6d online lagi: Buat link aktif",
                  wait_until(lambda: sec.get_by_role("button", name="Buat link", exact=True).is_enabled(), 5))
            ctxa.close()
            ctxb.close()

            # ── 7. 375 px ──────────────────────────────────────────────────────────────────────
            for theme in ("light", "dark"):
                tag = "terang" if theme == "light" else "gelap"
                ctx, m = open_app(browser, base, B, theme, width=375, height=800)
                pages.append(m)
                go_list(m)
                refresh(m)
                inv_section(m).wait_for(timeout=10000)
                m.wait_for_timeout(400)
                sw = no_hscroll(m)
                check("[%s] 7a 375 px daftar + Undangan untukmu: tanpa scroll horizontal" % tag, sw["sw"] <= sw["iw"], repr(sw))
                shot(m, "7a_375_undangan_%s.png" % tag)
                ctx.close()
                ctx, m = open_app(browser, base, A, theme, width=375, height=800)
                pages.append(m)
                open_detail(m, W4)
                wait_until(lambda: m.locator("input.ws-invite-link").count() == 1, 8)
                m.wait_for_timeout(400)
                sw = no_hscroll(m)
                check("[%s] 7b 375 px detail owner (undangan + link): tanpa scroll horizontal" % tag,
                      sw["sw"] <= sw["iw"], repr(sw))
                anggota(m, W4).scroll_into_view_if_needed()
                shot(m, "7b_375_detail_owner_%s.png" % tag)
                ctx.close()

            errs = [e for pg in pages for e in getattr(pg, "_e2e_errors", [])]
            check("tanpa pageerror", not errs, "; ".join(errs[:3]))
            browser.close()
    except Exception as e:  # noqa: BLE001
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
