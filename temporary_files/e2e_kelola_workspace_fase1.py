"""E2E Kelola Workspace Fase 1 (spec 2026-10-21-kelola-workspace-fase1, brief Task 7). Tidak dijalankan CI.

Akun A (owner) dan B (anggota, "perangkat lain"). Workspace milik A: W "Proyek Alfa" (A + B), W2 "Solo Dua"
(hanya A), W3 "Tim Tiga" (A + B), WL (nama 100 karakter tanpa spasi). Workspace milik B: "Kebun Budi" (kode undangan).
  1  A buka Kelola W → ubah nama, deskripsi, warna ws-c5 (Warna 6), avatar emoji 🔥 → Simpan → toast; avatar 🔥 +
     ws-c5 di kartu daftar, header detail, rail, sidebar terbuka, judul halaman W; deskripsi di bawah judul W;
     record list lokal (IndexedDB) ikut berubah.
  2  B (konteks browser lain) setelah sync melihat identitas baru (kartu, sidebar, IndexedDB); seksi Umum tanpa
     input; Danger Zone hanya "Keluar dari workspace".
  3  Avatar "abc" → pesan galat, Simpan nonaktif; Inisial "ab" → pratinjau "AB" (Batal, tidak disimpan).
  (Langkah 1 tampilan, 2, 3 diulang di tema gelap.)
  4  A pin W, W2, W3 lewat kartu → seksi Di sidebar urut; drag W3 ke atas → rail mengikuti; reload → urutan
     bertahan; ↓/↑ dengan keyboard (Enter pada tombol fokus).
  5  409: pin W2 dilepas lewat API (perangkat lain) → A ubah urutan → toast "Urutan pin sudah berubah di perangkat
     lain" + daftar segar (W2 hilang dari Di sidebar).
  8  Offline → Simpan / Hapus workspace (A), Pin / ↑↓ / Lepas pin (daftar), Keluar dari workspace (B) nonaktif
     dengan "Butuh koneksi internet".
  9  Pratinjau kode gabung memuat "Owner: Budi · 1 anggota".
  6  Kartu daftar tanpa Hapus/Keluar; Danger Zone A hapus W2 → kembali ke daftar; B keluar W3 → kembali ke daftar.
  7  B di halaman detail W, A menghapus W lewat API → setelah sync "Workspace tidak ditemukan" + tombol kembali.
 10  375 px (terang + gelap) dengan nama 100 karakter tanpa spasi: halaman daftar dan detail tanpa scroll
     horizontal (document.documentElement.scrollWidth <= innerWidth). Halaman workspace (slist_) hanya dicetak
     sebagai INFO: luapannya pra-ada di main (judul h1 + tombol "Kelola tahap"), di luar cakupan Fase 1.

Server lokal: uvicorn webapp:app, DB sementara (helper dari e2e_kelola_workspace_fase0.py; E2E_PYTHON opsional).
Screenshot: temporary_files/e2e_kelola_workspace_fase1/. Keluar non-zero bila ada langkah gagal.

    python temporary_files/e2e_kelola_workspace_fase1.py
"""
import os
import subprocess
import sys
import tempfile
import time
import traceback

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import e2e_kelola_workspace_fase0 as F0  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402

ROOT = F0.ROOT
SHOTS = os.path.join(ROOT, "temporary_files", "e2e_kelola_workspace_fase1")
check, wait_until, api, sync_now = F0.check, F0.wait_until, F0.api, F0.sync_now
results = F0.results

W_NAME, W2_NAME, W3_NAME = "Proyek Alfa", "Solo Dua", "Tim Tiga"
W_NEW = "Proyek Alfa Baru"
W_DESC = "Tim inti peluncuran kuartal empat"
LONG_NAME = "Workspace" + "X" * 91  # 100 karakter tanpa spasi
B_WS = "Kebun Budi"
OFF = "Butuh koneksi internet"
ORDER_409 = "Urutan pin sudah berubah di perangkat lain"
AVATAR_EMPTY = "Isi inisial atau emoji, atau pilih Otomatis."
FULL_HINT = "Sidebar penuh (5/5). Lepas salah satu untuk menambah."


# ── helper ──────────────────────────────────────────────────────────────────────────────────────
def open_app(browser, base, user, theme="light", width=1280, height=860):
    kw = {"service_workers": "block", "viewport": {"width": width, "height": height}}
    if width < 600:
        kw.update(has_touch=True, is_mobile=True)
    ctx = browser.new_context(**kw)
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
    p.goto(base + "/")
    p.locator(".sidebar-link").first.wait_for(state="attached", timeout=20000)
    return ctx, p


def shot(p, name, full=True):
    p.mouse.move(2, 2)
    p.wait_for_timeout(350)
    path = os.path.join(SHOTS, name)
    p.screenshot(path=path, full_page=full)
    print("  screenshot", os.path.relpath(path, ROOT), flush=True)


def refresh(p):
    """Sync + muat ulang data App (jalur yang dipakai App setelah sync)."""
    sync_now(p)
    p.evaluate("() => typeof window.__refreshTasks === 'function' ? Promise.resolve(window.__refreshTasks()).catch(() => null) : null")


def go_list(p):
    if p.locator(".ws-list-page").count() and p.locator("[data-ws-card]").count():
        return
    if p.locator(".ws-manage-page").count() and p.get_by_role("button", name="← Semua workspace").count():
        p.get_by_role("button", name="← Semua workspace").first.click()
    else:
        p.evaluate("""() => { const b = [...document.querySelectorAll('.sidebar-link')]
            .find(x => x.textContent.includes('Kelola Workspace')); if (b) b.click(); }""")
    p.locator("h2").filter(has_text="Kelola Workspace").first.wait_for(timeout=10000)
    p.locator("[data-ws-card]").first.wait_for(timeout=10000)


def card(p, lid):
    return p.locator("[data-ws-card='%d']" % lid)


def section(p, title):
    return p.locator("section.ws-manage-section").filter(has=p.locator("h3", has_text=title)).first


def danger(p, lid):
    return p.locator("section[aria-labelledby='ws-sec-danger-%d']" % lid)


def open_detail(p, lid):
    go_list(p)
    card(p, lid).get_by_role("button", name="Kelola", exact=True).click()
    p.locator("section[aria-labelledby='ws-sec-anggota-%d']" % lid).wait_for(timeout=8000)


def pinned_names(p):
    return p.locator(".ws-pin-row .ws-pin-name").all_inner_texts()


def rail_names(p):
    return p.locator(".sidebar-rail-ws").evaluate_all("els => els.map(e => e.getAttribute('aria-label'))")


def server_pins(base, user):
    ls = api(base, user, "GET", "/api/lists")
    return [l["name"] for l in sorted([l for l in ls if l.get("pinned")], key=lambda l: l.get("pin_position"))]


def avatar_info(loc):
    """(teks, punya ws-c5) avatar pertama di loc, atau None."""
    if loc.count() == 0:
        return None
    a = loc.first
    return (a.inner_text().strip(), "ws-c5" in (a.get_attribute("class") or ""))


IDB_LIST = """(sid) => new Promise((res) => { const r = indexedDB.open('taskflow-offline');
    r.onsuccess = () => { try { const q = r.result.transaction('lists').objectStore('lists').getAll();
      q.onsuccess = () => { const x = (q.result || []).find(l => String(l.server_id) === String(sid));
        res(x ? { name: x.name, description: x.description, color_idx: x.color_idx, avatar: x.avatar } : null); };
      q.onerror = () => res(null);
    } catch (e) { res('err:' + e.message); } }; r.onerror = () => res(null); })"""


def idb_list(p, sid):
    return p.evaluate(IDB_LIST, sid)


# PUT urutan pin ditahan 2,5 dtk SEBELUM dikirim → GET fetchAll yang mulai sesudah update optimistis selesai
# lebih dulu dengan urutan lama (server belum menerima PUT).
SLOW_PIN_PUT = """() => { if (window.__origFetch2) return; const of = window.fetch; window.__origFetch2 = of;
    window.fetch = function (u, o) { const url = String((u && u.url) || u); const m = ((o && o.method) || 'GET').toUpperCase();
      const args = arguments, self = this;
      if (m === 'PUT' && /\\/api\\/lists\\/pins\\/order/.test(url)) { window.__slowPinPuts = (window.__slowPinPuts || 0) + 1;
        return new Promise(res => setTimeout(res, 2500)).then(() => of.apply(self, args)); }
      return of.apply(this, arguments); }; }"""


SLOW_LISTS_GET = """() => { if (window.__origFetch) return; const of = window.fetch; window.__origFetch = of;
    window.fetch = function (u, o) { const url = String((u && u.url) || u); const m = ((o && o.method) || 'GET').toUpperCase();
      const pr = of.apply(this, arguments);
      if (m === 'GET' && /\\/api\\/lists(\\?|$)/.test(url)) { window.__slowListsGets = (window.__slowListsGets || 0) + 1;
        return pr.then(r => new Promise(res => setTimeout(() => res(r), 2500))); }
      return pr; }; }"""


def wait_fetch_idle(p):
    wait_until(lambda: p.evaluate("() => window.__fetchAllInFlight === false"), 20)


def no_hscroll(p):
    return p.evaluate("() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth })")


def expand_sidebar(p):
    btn = p.locator("button[aria-label='Tampilkan semua menu']")
    if btn.count() and btn.first.is_visible():
        btn.first.click()
        p.wait_for_timeout(300)


def sidebar_link(p, name):
    return p.locator(".sidebar-link").filter(has_text=name).first


# ── langkah 1–3 ─────────────────────────────────────────────────────────────────────────────────
def verify_identity_owner(p, ids, tag):
    W = ids["W"]
    go_list(p)
    check("[%s] 1c kartu daftar: avatar 🔥 + ws-c5 + nama baru" % tag,
          wait_until(lambda: avatar_info(card(p, W).locator(".ws-avatar")) == ("🔥", True)
                     and W_NEW in card(p, W).inner_text(), 10),
          repr(avatar_info(card(p, W).locator(".ws-avatar"))))
    check("[%s] 1d rail: avatar 🔥 + ws-c5" % tag,
          avatar_info(p.locator(".sidebar-rail-ws[aria-label='%s'] .sidebar-rail-ws-avatar" % W_NEW)) == ("🔥", True),
          repr(rail_names(p)))
    expand_sidebar(p)
    sl = sidebar_link(p, W_NEW)
    check("[%s] 1e sidebar terbuka (WORKSPACES): avatar 🔥 + ws-c5" % tag,
          sl.count() == 1 and avatar_info(sl.locator(".ws-avatar")) == ("🔥", True))
    shot(p, "1c_daftar_%s.png" % tag)
    open_detail(p, W)
    hdr = p.locator(".ws-manage-page > div .ws-avatar")
    check("[%s] 1f header detail: avatar 🔥 + ws-c5" % tag, avatar_info(hdr) == ("🔥", True), repr(avatar_info(hdr)))
    shot(p, "1d_detail_owner_%s.png" % tag)
    go_list(p)
    card(p, W).get_by_role("button", name="Buka", exact=True).click()
    h1 = p.locator("h1").filter(has_text=W_NEW).first
    h1.wait_for(timeout=8000)
    check("[%s] 1g judul halaman W: avatar 🔥 + ws-c5" % tag, avatar_info(h1.locator(".ws-avatar")) == ("🔥", True))
    desc = p.locator(".ws-page-desc")
    check("[%s] 1h deskripsi di bawah judul W" % tag, desc.count() == 1 and desc.inner_text().strip() == W_DESC,
          repr(desc.all_inner_texts()))
    shot(p, "1e_halaman_W_%s.png" % tag, full=False)


def verify_member_view(p, ids, tag):
    W = ids["W"]
    go_list(p)
    check("[%s] 2a B kartu: avatar 🔥 + ws-c5 + nama baru" % tag,
          wait_until(lambda: (refresh(p) or True) and avatar_info(card(p, W).locator(".ws-avatar")) == ("🔥", True)
                     and W_NEW in card(p, W).inner_text(), 30),
          repr(avatar_info(card(p, W).locator(".ws-avatar"))))
    expand_sidebar(p)
    check("[%s] 2b B sidebar: avatar 🔥 + ws-c5" % tag,
          avatar_info(sidebar_link(p, W_NEW).locator(".ws-avatar")) == ("🔥", True))
    rec = idb_list(p, W)
    check("[%s] 2c B IndexedDB: identitas baru" % tag,
          isinstance(rec, dict) and rec.get("name") == W_NEW and rec.get("avatar") == "🔥" and rec.get("color_idx") == 5
          and rec.get("description") == W_DESC, repr(rec))
    open_detail(p, W)
    umum = section(p, "Umum")
    check("[%s] 2d B seksi Umum tanpa input/textarea/select" % tag,
          umum.locator("input, textarea, select").count() == 0 and W_DESC in umum.inner_text())
    dz = danger(p, W)
    btns = dz.get_by_role("button").all_inner_texts()
    check("[%s] 2e B Danger Zone hanya 'Keluar dari workspace'" % tag, btns == ["Keluar dari workspace"], repr(btns))
    shot(p, "2_detail_member_%s.png" % tag)


def avatar_validation(p, ids, tag):
    W = ids["W"]
    open_detail(p, W)
    umum = section(p, "Umum")
    save = umum.get_by_role("button", name="Simpan", exact=True)
    umum.get_by_role("button", name="Inisial", exact=True).click()
    inp = umum.get_by_label("Inisial", exact=True)
    inp.fill("abc")
    typed = inp.input_value()
    check("[%s] 3a input Inisial maks 2 karakter (maxlength)" % tag, typed == "ab", repr(typed))
    umum.get_by_role("button", name="Emoji", exact=True).click()
    umum.get_by_label("Emoji", exact=True).fill("abc")
    alert = umum.get_by_role("alert")
    check("[%s] 3b avatar 'abc' → pesan galat" % tag,
          wait_until(lambda: alert.count() == 1 and alert.inner_text() == "Avatar harus 1–2 huruf/angka atau satu emoji", 3),
          repr(alert.all_inner_texts()))
    check("[%s] 3c avatar 'abc' → Simpan nonaktif" % tag, save.is_disabled())
    shot(p, "3a_avatar_abc_%s.png" % tag)
    umum.get_by_role("button", name="Inisial", exact=True).click()
    umum.get_by_label("Inisial", exact=True).fill("ab")
    prev = umum.locator(".ws-avatar").first
    check("[%s] 3d Inisial 'ab' → pratinjau 'AB', tanpa galat, Simpan aktif" % tag,
          wait_until(lambda: prev.inner_text().strip() == "AB" and alert.count() == 0 and save.is_enabled(), 3),
          repr(prev.inner_text()))
    shot(p, "3b_avatar_AB_%s.png" % tag)
    umum.get_by_role("button", name="Batal", exact=True).click()
    check("[%s] 3e Batal → pratinjau kembali 🔥, Simpan nonaktif" % tag,
          wait_until(lambda: prev.inner_text().strip() == "🔥" and save.is_disabled(), 3))
    # Inisial dipilih tapi kosong (+ nama diubah) → pesan, Simpan tetap nonaktif (tidak diam-diam jadi Otomatis)
    umum.get_by_role("button", name="Inisial", exact=True).click()
    umum.get_by_label("Inisial", exact=True).fill("")
    umum.get_by_label("Nama", exact=True).fill(W_NEW + " x")
    check("[%s] 3f Inisial kosong → '%s', Simpan nonaktif" % (tag, AVATAR_EMPTY),
          wait_until(lambda: alert.count() == 1 and alert.inner_text() == AVATAR_EMPTY and save.is_disabled(), 3),
          repr(alert.all_inner_texts()))
    umum.get_by_role("button", name="Batal", exact=True).click()
    check("[%s] 3g Batal → kembali 🔥" % tag, wait_until(lambda: prev.inner_text().strip() == "🔥" and save.is_disabled(), 3))


# ── main ────────────────────────────────────────────────────────────────────────────────────────
def main():
    os.makedirs(SHOTS, exist_ok=True)
    for f in os.listdir(SHOTS):
        if f.endswith(".png"):
            os.remove(os.path.join(SHOTS, f))
    tmp = tempfile.mkdtemp(prefix="e2e_kelola_ws_f1_")
    proc, base = F0.start_server(tmp)
    print("server", base, flush=True)
    pages = []
    try:
        A = F0.register(base, "ana", "Ana")
        B = F0.register(base, "budi", "Budi")
        ids = {}
        for k, name in (("W", W_NAME), ("W2", W2_NAME), ("W3", W3_NAME), ("WL", LONG_NAME)):
            ids[k] = api(base, A, "POST", "/api/lists", json={"name": name})["id"]
        for k in ("W", "W3"):
            api(base, A, "POST", "/api/lists/%d/invite" % ids[k], json={"username": B["username"]})
        bw = api(base, B, "POST", "/api/lists", json={"name": B_WS})["id"]
        code = api(base, B, "POST", "/api/lists/%d/generate-link" % bw, json={})["code"]
        # Keadaan pin yang diketahui: GET pertama menanam pin otomatis → lepas semua, lalu pin W saja (rail langkah 1).
        for U in (A, B):
            for l in api(base, U, "GET", "/api/lists"):
                if l.get("pinned"):
                    api(base, U, "DELETE", "/api/lists/%d/pin" % l["id"])
        api(base, A, "PUT", "/api/lists/%d/pin" % ids["W"], json={})
        check("setup: pin A = [W]", server_pins(base, A) == [W_NAME], repr(server_pins(base, A)))
        W, W2, W3, WL = ids["W"], ids["W2"], ids["W3"], ids["WL"]

        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            ctxa, a = open_app(browser, base, A)
            ctxb, b = open_app(browser, base, B)
            pages += [a, b]

            # ── 1. A ubah identitas W ───────────────────────────────────────────────────────────
            open_detail(a, W)
            umum = section(a, "Umum")
            save = umum.get_by_role("button", name="Simpan", exact=True)
            check("1a Simpan nonaktif tanpa perubahan", save.is_disabled())
            umum.get_by_label("Nama", exact=True).fill(W_NEW)
            umum.get_by_label("Deskripsi", exact=True).fill(W_DESC)
            umum.get_by_role("radio", name="Warna 6", exact=True).click()
            umum.get_by_role("button", name="Emoji", exact=True).click()
            umum.get_by_label("Emoji", exact=True).fill("🔥")
            check("1b pratinjau 🔥 + ws-c5 sebelum simpan",
                  avatar_info(umum.locator(".ws-avatar")) == ("🔥", True), repr(avatar_info(umum.locator(".ws-avatar"))))
            save.click()
            check("1b' toast 'Workspace disimpan'",
                  wait_until(lambda: a.locator(".toast").filter(has_text="Workspace disimpan").count() >= 1, 8))
            srv = api(base, A, "GET", "/api/lists/%d" % W)
            check("1b'' server: identitas tersimpan",
                  srv.get("name") == W_NEW and srv.get("description") == W_DESC and srv.get("color_idx") == 5
                  and srv.get("avatar") == "🔥", repr({k: srv.get(k) for k in ("name", "description", "color_idx", "avatar")}))
            check("1b''' A IndexedDB: record list diperbarui",
                  wait_until(lambda: (idb_list(a, W) or {}).get("avatar") == "🔥"
                             and idb_list(a, W).get("color_idx") == 5 and idb_list(a, W).get("name") == W_NEW, 10),
                  repr(idb_list(a, W)))
            verify_identity_owner(a, ids, "terang")

            # ── 2. B setelah sync ──────────────────────────────────────────────────────────────
            verify_member_view(b, ids, "terang")

            # ── 3. validasi avatar ─────────────────────────────────────────────────────────────
            avatar_validation(a, ids, "terang")

            # ── 1–3 tema gelap ─────────────────────────────────────────────────────────────────
            ctxad, ad = open_app(browser, base, A, "dark")
            ctxbd, bd = open_app(browser, base, B, "dark")
            pages += [ad, bd]
            check("[gelap] tema aktif", ad.evaluate("() => document.documentElement.getAttribute('data-theme')") == "dark")
            verify_identity_owner(ad, ids, "gelap")
            verify_member_view(bd, ids, "gelap")
            avatar_validation(ad, ids, "gelap")
            ctxad.close()
            ctxbd.close()

            # ── 11. tombol Kelola di baris workspace-nav-tabs ──────────────────────────────────
            go_list(a)
            card(a, W).get_by_role("button", name="Buka", exact=True).click()
            kel = a.get_by_role("button", name="Kelola workspace %s" % W_NEW, exact=True)
            kel.wait_for(timeout=8000)
            check("11a tombol Kelola di workspace-nav-tabs (teks 'Kelola')",
                  a.locator(".workspace-nav-tabs [data-testid='workspace-manage-btn']").count() == 1
                  and kel.inner_text().strip() == "Kelola", repr(kel.inner_text()))
            kel.click()
            check("11b Kelola → halaman detail W",
                  wait_until(lambda: a.locator("section[aria-labelledby='ws-sec-anggota-%d']" % W).count() == 1, 8))

            # ── 4. pin + urutan ────────────────────────────────────────────────────────────────
            api(base, A, "DELETE", "/api/lists/%d/pin" % W)
            a.reload()
            a.locator(".sidebar-link").first.wait_for(state="attached", timeout=20000)
            go_list(a)
            check("4a Di sidebar kosong", wait_until(lambda: pinned_names(a) == [], 8), repr(pinned_names(a)))
            expect = []
            for lid, name in ((W, W_NEW), (W2, W2_NAME), (W3, W3_NAME)):
                card(a, lid).get_by_role("button", name="Pin", exact=True).click()
                expect.append(name)
                check("4b pin %s → Di sidebar %s" % (name, expect),
                      wait_until(lambda: pinned_names(a) == expect, 8), repr(pinned_names(a)))
            check("4c rail = [W, W2, W3]", wait_until(lambda: rail_names(a) == expect, 8), repr(rail_names(a)))
            check("4c' kartu W 'Di-pin' aria-pressed",
                  card(a, W).get_by_role("button", name="Di-pin").get_attribute("aria-pressed") == "true")
            # drag W3 (terakhir) ke atas
            rows = a.locator(".ws-pin-row")
            lb = rows.nth(2).locator(".ws-pin-name").bounding_box()
            fb = rows.nth(0).bounding_box()
            a.mouse.move(lb["x"] + 5, lb["y"] + lb["height"] / 2)
            a.mouse.down()
            a.mouse.move(lb["x"] + 5, lb["y"] + lb["height"] / 2 - 10, steps=3)
            a.mouse.move(fb["x"] + 60, fb["y"] + 5, steps=10)
            shot(a, "4a_drag_terang.png")
            a.mouse.up()
            exp = [W3_NAME, W_NEW, W2_NAME]
            check("4d drag W3 ke atas: Di sidebar + server",
                  wait_until(lambda: pinned_names(a) == exp and server_pins(base, A) == exp, 10),
                  repr((pinned_names(a), server_pins(base, A))))
            check("4e rail mengikuti", wait_until(lambda: rail_names(a) == exp, 5), repr(rail_names(a)))
            a.reload()
            a.locator(".sidebar-link").first.wait_for(state="attached", timeout=20000)
            go_list(a)
            wait_fetch_idle(a)  # race dengan fetchAll diuji terpisah di 4j
            check("4f reload → urutan bertahan (daftar + rail)",
                  wait_until(lambda: pinned_names(a) == exp and rail_names(a) == exp, 10),
                  repr((pinned_names(a), rail_names(a))))
            a.get_by_role("button", name="Turunkan %s" % W3_NAME, exact=True).focus()
            a.keyboard.press("Enter")
            exp2 = [W_NEW, W3_NAME, W2_NAME]
            check("4g keyboard ↓ W3: daftar + server",
                  wait_until(lambda: pinned_names(a) == exp2 and server_pins(base, A) == exp2, 10),
                  repr(pinned_names(a)))
            foc = a.evaluate("() => document.activeElement && document.activeElement.getAttribute('aria-label')")
            check("4h fokus tetap di tombol W3", foc in ("Turunkan %s" % W3_NAME, "Naikkan %s" % W3_NAME), repr(foc))
            a.get_by_role("button", name="Naikkan %s" % W3_NAME, exact=True).focus()
            a.keyboard.press("Space")
            check("4i keyboard ↑ W3 (Space): kembali [W3, W, W2]",
                  wait_until(lambda: pinned_names(a) == exp and server_pins(base, A) == exp and rail_names(a) == exp, 10),
                  repr(pinned_names(a)))
            shot(a, "4b_di_sidebar_terang.png")
            # Race: GET /api/lists milik fetchAll (reload / tiap 30 dtk / tab terlihat) sudah terkirim sebelum urutan
            # diubah dan responsnya (urutan lama) tiba sesudahnya → tidak boleh menimpa urutan baru.
            a.evaluate(SLOW_LISTS_GET)
            a.evaluate("() => { window.__slowListsGets = 0; window.__refreshTasks && window.__refreshTasks(); }")
            check("4j pra: GET /api/lists fetchAll tertahan",
                  wait_until(lambda: a.evaluate("() => window.__slowListsGets") >= 1, 15))
            a.get_by_role("button", name="Turunkan %s" % W3_NAME, exact=True).click()
            check("4j server menerima urutan baru", wait_until(lambda: server_pins(base, A) == exp2, 8),
                  repr(server_pins(base, A)))
            a.wait_for_timeout(3500)  # respons GET lama (2,5 dtk) sudah diterapkan
            check("4j respons GET lama tidak menimpa urutan baru (daftar + rail)",
                  pinned_names(a) == exp2 and rail_names(a) == exp2, repr((pinned_names(a), rail_names(a))))
            a.evaluate("() => { if (window.__origFetch) window.fetch = window.__origFetch; }")
            a.get_by_role("button", name="Naikkan %s" % W3_NAME, exact=True).click()
            check("4k kembali [W3, W, W2]",
                  wait_until(lambda: pinned_names(a) == exp and server_pins(base, A) == exp, 10), repr(pinned_names(a)))
            wait_until(lambda: a.get_by_role("button", name="Turunkan %s" % W3_NAME, exact=True).is_enabled(), 5)
            # Race kebalikan: PUT ditahan; fetchAll mulai SESUDAH update optimistis dan selesai SEBELUM PUT
            # (membawa urutan lama) → setelah PUT sukses urutan yang diminta diterapkan ulang.
            a.evaluate(SLOW_PIN_PUT)
            a.get_by_role("button", name="Turunkan %s" % W3_NAME, exact=True).click()
            check("4l selama menyimpan: ↑/↓ + Lepas pin + Pin kartu nonaktif",
                  wait_until(lambda: all(x.is_disabled() for x in a.locator(".ws-pin-move").all())
                             and all(x.is_disabled() for x in a.get_by_role("button", name="Lepas pin").all())
                             and card(a, W2).locator("button[aria-pressed]").is_disabled(), 2))
            a.evaluate("() => window.__refreshTasks && window.__refreshTasks()")
            wait_fetch_idle(a)
            print("INFO 4m urutan setelah GET lama (sebelum PUT selesai): %r" % (pinned_names(a),), flush=True)
            check("4m server menerima urutan baru (PUT tertahan)", wait_until(lambda: server_pins(base, A) == exp2, 8),
                  repr(server_pins(base, A)))
            check("4m' setelah PUT sukses urutan diminta diterapkan ulang (daftar + rail)",
                  wait_until(lambda: pinned_names(a) == exp2 and rail_names(a) == exp2, 5),
                  repr((pinned_names(a), rail_names(a))))
            a.evaluate("() => { if (window.__origFetch2) { window.fetch = window.__origFetch2; window.__origFetch2 = null; } }")
            wait_until(lambda: a.get_by_role("button", name="Naikkan %s" % W3_NAME, exact=True).is_enabled(), 5)
            a.get_by_role("button", name="Naikkan %s" % W3_NAME, exact=True).click()
            check("4n kembali [W3, W, W2]",
                  wait_until(lambda: pinned_names(a) == exp and server_pins(base, A) == exp, 10), repr(pinned_names(a)))
            wait_until(lambda: a.get_by_role("button", name="Turunkan %s" % W3_NAME, exact=True).is_enabled(), 5)

            # ── 5. 409 urutan ──────────────────────────────────────────────────────────────────
            api(base, A, "DELETE", "/api/lists/%d/pin" % W2)  # perangkat lain
            a.get_by_role("button", name="Turunkan %s" % W3_NAME, exact=True).click()
            check("5a toast '%s'" % ORDER_409,
                  wait_until(lambda: a.locator(".toast").filter(has_text=ORDER_409).count() >= 1, 8))
            check("5b daftar segar = server (W2 hilang)",
                  wait_until(lambda: pinned_names(a) == [W3_NAME, W_NEW] == server_pins(base, A), 10),
                  repr((pinned_names(a), server_pins(base, A))))
            check("5c rail segar", wait_until(lambda: rail_names(a) == [W3_NAME, W_NEW], 8), repr(rail_names(a)))
            shot(a, "5_setelah_409_terang.png")

            # ── 8. offline ─────────────────────────────────────────────────────────────────────
            open_detail(b, W3)
            ctxa.set_offline(True)
            ctxb.set_offline(True)
            go_list(a)
            moves = a.locator(".ws-pin-move")
            check("8a offline: ↑/↓ nonaktif + title",
                  wait_until(lambda: moves.count() > 0 and all(x.is_disabled() and x.get_attribute("title") == OFF
                                                                for x in moves.all()), 5))
            op = moves.first.evaluate("el => ({ o: parseFloat(getComputedStyle(el).opacity), c: getComputedStyle(el).cursor })")
            check("8a' tombol nonaktif tampak nonaktif (opacity < 1, cursor not-allowed)",
                  op["o"] < 1 and op["c"] == "not-allowed", repr(op))
            lp = a.get_by_role("button", name="Lepas pin")
            check("8b offline: Lepas pin nonaktif", lp.count() > 0 and all(x.is_disabled() for x in lp.all()))
            pb = card(a, W2).locator("button[aria-pressed]")
            check("8c offline: Pin nonaktif + title", pb.is_disabled() and pb.get_attribute("title") == OFF,
                  repr(pb.get_attribute("title")))
            shot(a, "8a_offline_daftar_terang.png")
            open_detail(a, W)
            umum = section(a, "Umum")
            umum.get_by_label("Deskripsi", exact=True).fill("edit offline")
            sv = umum.get_by_role("button", name="Simpan", exact=True)
            check("8d offline: Simpan nonaktif + title", sv.is_disabled() and sv.get_attribute("title") == OFF)
            check("8e offline: keterangan 'Butuh koneksi internet' di form", OFF in umum.inner_text())
            hb = danger(a, W).get_by_role("button", name="Hapus workspace", exact=True)
            check("8f offline: Hapus workspace nonaktif + title", hb.is_disabled() and hb.get_attribute("title") == OFF)
            shot(a, "8b_offline_detail_owner_terang.png")
            umum.get_by_role("button", name="Batal", exact=True).click()
            kb = danger(b, W3).get_by_role("button", name="Keluar dari workspace", exact=True)
            check("8g offline: B Keluar dari workspace nonaktif + title",
                  wait_until(lambda: kb.is_disabled() and kb.get_attribute("title") == OFF, 5))
            shot(b, "8c_offline_detail_member_terang.png")
            ctxa.set_offline(False)
            ctxb.set_offline(False)
            check("8h online lagi: Hapus workspace aktif", wait_until(lambda: hb.is_enabled(), 5))

            # ── 9. pratinjau kode ──────────────────────────────────────────────────────────────
            go_list(a)
            a.get_by_role("button", name="Masukkan Kode").click()
            a.get_by_placeholder("Paste kode invite...").fill(code)
            a.get_by_role("button", name="Cek", exact=True).click()
            check("9a pratinjau 'Owner: Budi · 1 anggota'",
                  wait_until(lambda: a.get_by_text("Owner: Budi · 1 anggota", exact=True).count() == 1, 8))
            shot(a, "9_pratinjau_kode_terang.png")
            a.get_by_role("button", name="Batal", exact=True).click()

            # ── 6. hapus / keluar dari Danger Zone ─────────────────────────────────────────────
            cards = a.locator("[data-ws-card]")
            check("6a kartu daftar tanpa Hapus/Keluar",
                  cards.count() >= 4 and cards.get_by_role("button", name="Hapus").count() == 0
                  and cards.get_by_role("button", name="Keluar").count() == 0
                  and cards.get_by_role("button", name="Hapus workspace").count() == 0
                  and cards.get_by_role("button", name="Keluar dari workspace").count() == 0)
            open_detail(a, W2)
            danger(a, W2).get_by_role("button", name="Hapus workspace", exact=True).click()
            d = a.locator("form[role=dialog]")
            d.wait_for(timeout=5000)
            wait_until(lambda: d.locator("li").count() > 0 or "kosong" in d.inner_text().lower(), 8)
            d.get_by_label("Ketik nama workspace untuk konfirmasi").fill(W2_NAME)
            d.get_by_role("button", name="Hapus permanen").click()
            check("6b A hapus W2 → kembali ke daftar, kartu W2 hilang",
                  wait_until(lambda: a.locator(".ws-manage-page").count() == 0 and card(a, W).count() == 1
                             and card(a, W2).count() == 0, 10))
            check("6c API: W2 terhapus", all(l["id"] != W2 for l in api(base, A, "GET", "/api/lists")))
            shot(a, "6a_A_setelah_hapus_terang.png")
            danger(b, W3).get_by_role("button", name="Keluar dari workspace", exact=True).click()
            ok_btn = b.get_by_role("button", name="Keluar", exact=True)
            ok_btn.wait_for(timeout=8000)
            shot(b, "6b_B_konfirmasi_keluar_terang.png")
            ok_btn.click()
            check("6d B keluar W3 → kembali ke daftar, kartu W3 hilang",
                  wait_until(lambda: b.locator(".ws-manage-page").count() == 0 and card(b, W).count() == 1
                             and card(b, W3).count() == 0, 10))
            check("6e API: B bukan anggota W3", all(l["id"] != W3 for l in api(base, B, "GET", "/api/lists")))
            shot(b, "6c_B_setelah_keluar_terang.png")

            # ── 7. detail workspace yang dihapus dari perangkat lain ───────────────────────────
            open_detail(b, W)
            api(base, A, "DELETE", "/api/lists/%d" % W)
            nf = b.get_by_text("Workspace tidak ditemukan", exact=True)
            check("7a B: 'Workspace tidak ditemukan' setelah sync",
                  wait_until(lambda: (refresh(b) or True) and nf.count() == 1, 30))
            back = b.locator(".ws-manage-page").get_by_role("button", name="← Semua workspace", exact=True)
            check("7b tombol kembali ada", back.count() == 1)
            shot(b, "7_tidak_ditemukan_terang.png")
            back.click()
            check("7c kembali → daftar tanpa W",
                  wait_until(lambda: b.locator("h2").filter(has_text="Kelola Workspace").count() >= 1
                             and card(b, W).count() == 0, 8))
            ctxa.close()
            ctxb.close()

            # ── 10. 375 px nama 100 karakter ───────────────────────────────────────────────────
            api(base, A, "PUT", "/api/lists/%d/pin" % WL, json={})
            for i in range(3):  # 5 pin: W3, WL, F1..F3 → petunjuk "Sidebar penuh"
                fid = api(base, A, "POST", "/api/lists", json={"name": "Penuh %d" % (i + 1)})["id"]
                api(base, A, "PUT", "/api/lists/%d/pin" % fid, json={})
            check("setup 10: 5 pin", len(server_pins(base, A)) == 5, repr(server_pins(base, A)))
            api(base, A, "PATCH", "/api/lists/%d" % WL, json={"description": "D" * 300})
            for theme in ("light", "dark"):
                tag = "terang" if theme == "light" else "gelap"
                ctx, m = open_app(browser, base, A, theme, width=375, height=800)
                pages.append(m)
                go_list(m)
                m.wait_for_timeout(400)
                sw = no_hscroll(m)
                check("[%s] 10a 375 px daftar (nama 100 char): tanpa scroll horizontal" % tag, sw["sw"] <= sw["iw"], repr(sw))
                check("[%s] 10a' Di sidebar memuat nama panjang" % tag, LONG_NAME in pinned_names(m))
                hint = m.locator(".ws-pin-section").get_by_text(FULL_HINT, exact=True)
                check("[%s] 10a'' 5 pin → petunjuk '%s'" % (tag, FULL_HINT),
                      wait_until(lambda: hint.count() == 1 and hint.is_visible(), 5))
                shot(m, "10a_375_daftar_%s.png" % tag)
                card(m, WL).get_by_role("button", name="Kelola", exact=True).click()
                m.locator("section[aria-labelledby='ws-sec-anggota-%d']" % WL).wait_for(timeout=8000)
                m.wait_for_timeout(400)
                sw = no_hscroll(m)
                check("[%s] 10b 375 px detail: tanpa scroll horizontal" % tag, sw["sw"] <= sw["iw"], repr(sw))
                shot(m, "10b_375_detail_%s.png" % tag)
                m.get_by_role("button", name="← Semua workspace").first.click()
                card(m, WL).get_by_role("button", name="Buka", exact=True).click()
                m.locator("h1").filter(has_text=LONG_NAME).first.wait_for(timeout=8000)
                m.wait_for_timeout(400)
                sw = no_hscroll(m)
                # Bukan pemeriksaan lulus/gagal: halaman workspace (slist_) sudah meluap di main sebelum Fase 1
                # (h1 judul tanpa min-width/overflow-wrap + tombol "Kelola tahap" ~417 px bahkan untuk nama
                # pendek). Di luar cakupan Fase 1 — dicatat di laporan Task 7.
                print("INFO [%s] 10c 375 px halaman workspace (pra-ada di main): %r" % (tag, sw), flush=True)
                check("[%s] 10c judul halaman W memuat avatar" % tag,
                      m.locator("h1").filter(has_text=LONG_NAME).first.locator(".ws-avatar").count() == 1)
                shot(m, "10c_375_halaman_ws_%s.png" % tag, full=False)
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
