"""Akses publik drawing: /pub/drawings dan render halaman publik (/pub/{user}/{slug}).

Drawing hanya boleh tampil publik bila dirujuk ::draw[id|client_id] oleh note publish TEPERCAYA
milik pemiliknya (isinya hanya ditulis penerbit: list_id kosong, milik penerbit, dan terakhir
disunting pemiliknya sendiri, yaitu last_edited_by kosong atau = pemilik), dan note itu terbuka
(tanpa password, atau cookie unlock valid). Note publish bersama (list_id terisi, anggota workspace
ikut mengedit isinya) hanya menampilkan drawing ber-list_id = workspace note itu (PR 2; tesnya di
tests/test_drawing_workspace_public.py); drawing pribadi yang disisipkan anggota tidak tampil. Note yang pernah
diedit orang lain lalu kembali pribadi (workspace dihapus atau di-unshare) tidak menampilkan drawing apa pun.
Semua penolakan menjawab 404 yang sama dengan "tidak ada". Lampiran (/pub/attachments) dan bagian
"Related" (backlink) mengikuti gerbang password note publish yang sama. Wikilink ke note
berpassword hanya di-resolve di note tepercaya milik penerbit note itu sendiri (tidak pernah di
note bersama), dan judul, username, serta slug milik user lain di-escape di halaman publik. Id
buatan (digit Unicode, di luar INTEGER SQLite) di wikilink dan /pub/attachments menjawab "tidak
ditemukan", bukan error server. Spec: docs/superpowers/specs/
2026-10-18-workspace-drawing-project-design.md §3.

DB tes dipakai bersama satu sesi pytest: username, judul, client_id, dan marker dibuat unik.
"""
import os
import uuid
from html.parser import HTMLParser

import pytest
from starlette.testclient import TestClient

import webapp
from conftest import db, register_user


def _uniq():
    return uuid.uuid4().hex[:10]


def _auth(client, username):
    """Daftarkan user dan kembalikan header Bearer-nya. Cookie sesi hasil register dibuang
    supaya request berikutnya hanya membawa header (aman dipakai bergantian antar user)."""
    data = register_user(client, username, f"{username}@test.id")
    client.cookies.clear()
    return {"Authorization": f"Bearer {data.get('token') or data.get('access_token')}"}


def _uid(username):
    """id user dari tabel users."""
    conn = db()
    try:
        return conn.execute("SELECT id FROM users WHERE username = ?", (username,)).fetchone()["id"]
    finally:
        conn.close()


def anon():
    """Pengunjung publik: TestClient baru dengan cookie jar kosong."""
    return TestClient(webapp.app)


def _drawing(client, headers, title, svg="", cid=None):
    """Buat drawing lewat API; kembalikan baris JSON-nya (id, client_id, svg_preview, ...)."""
    payload = {"title": title, "data_json": '{"shapes":{}}', "svg_preview": svg}
    if cid:
        payload["client_id"] = cid
    r = client.post("/api/drawings", json=payload, headers=headers)
    assert r.status_code == 200, r.text
    return r.json()


def _publish(client, headers, title, content, password=None, list_id=None):
    """Buat note (pribadi, atau bersama bila list_id diisi) lalu publish; kembalikan (note_id, slug, username)."""
    payload = {"title": title, "content": content}
    if list_id is not None:
        payload["list_id"] = list_id
    r = client.post("/api/scratchpad", json=payload, headers=headers)
    assert r.status_code == 200, r.text
    note_id = r.json()["id"]
    p = client.post(f"/api/scratchpad/{note_id}/publish",
                    json={"password": password} if password else {}, headers=headers)
    assert p.status_code == 200, p.text
    return note_id, p.json()["slug"], p.json()["username"]


def _workspace(client, headers, name):
    """Buat workspace (shared list) milik user; kembalikan id-nya."""
    r = client.post("/api/lists", json={"name": name}, headers=headers)
    assert r.status_code == 200, r.text
    return r.json()["id"]


def _add_member(list_id, user_id):
    """Jadikan user anggota workspace langsung lewat DB (alur undangan tidak relevan untuk tes ini)."""
    conn = db()
    try:
        conn.execute(
            "INSERT INTO list_members (list_id, user_id, joined_at) VALUES (?, ?, '2026-10-18T00:00:00')",
            (list_id, user_id),
        )
        conn.commit()
    finally:
        conn.close()


def _unlock_cookie(slug):
    """Header Cookie unlock yang valid untuk slug. Endpoint unlock asli memasang cookie `secure`
    yang tidak dikirim balik TestClient (http), jadi cookie-nya dibuat langsung."""
    return {"Cookie": f"pub_unlock_{slug}={webapp._sign_cookie(slug)}"}


def _attachment(note_id, user_id, name, content, mime="text/plain"):
    """Tulis file lampiran ke UPLOAD_DIR (jalur lokal view_published_attachment; Nextcloud tidak
    dikonfigurasi di tes) dan sisipkan barisnya di note_attachments; kembalikan id lampiran."""
    os.makedirs(os.environ["UPLOAD_DIR"], exist_ok=True)
    with open(os.path.join(os.environ["UPLOAD_DIR"], name), "w", encoding="utf-8") as f:
        f.write(content)
    conn = db()
    try:
        cur = conn.execute(
            "INSERT INTO note_attachments (note_id, user_id, nextcloud_path, original_name, file_size, mime_type) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (note_id, user_id, f"{webapp.NEXTCLOUD_FOLDER}/{name}", name, len(content.encode("utf-8")), mime),
        )
        conn.commit()
        return cur.lastrowid
    finally:
        conn.close()


def _wikilink_refs(title, note_id):
    """Empat bentuk wikilink ke satu note: judul, id:N, note:N, dan N polos."""
    return [f"[[{title}]]", f"[[id:{note_id}]]", f"[[note:{note_id}]]", f"[[{note_id}]]"]


def _svg(marker):
    return f"<svg><text>{marker}</text></svg>"


# ── GET /pub/drawings/{token} ────────────────────────────────────────────────

def test_pub_drawing_not_embedded_is_404(client):
    """Drawing yang tidak dirujuk note publish mana pun tidak bisa dibaca publik (id maupun client_id)."""
    tag = _uniq()
    h = _auth(client, f"pubacc1_{tag}")
    d = _drawing(client, h, f"rahasia-{tag}", svg=_svg(f"MARKER-1-{tag}"), cid=f"cid-1-{tag}")

    pub = anon()
    r = pub.get(f"/pub/drawings/{d['id']}")
    assert r.status_code == 404
    assert r.json()["detail"] == "Drawing tidak ditemukan"
    assert pub.get(f"/pub/drawings/{d['client_id']}").status_code == 404
    assert pub.get("/pub/drawings/a.b").status_code == 404


def test_pub_drawing_unmatchable_tokens_are_404_not_500(client):
    """Token yang mustahil cocok menjawab 404, bukan error server: angka melebihi INTEGER SQLite,
    digit Unicode (isdigit() True tetapi int() gagal), dan karakter di luar [0-9a-zA-Z_-].
    Token di luar charset itu tidak pernah dicari, walau ada drawing publik ber-client_id persis itu."""
    pub = anon()
    for token in ("9" * 30, "9" * 5000, "\u00b2", "a%20b", "a.b"):
        r = pub.get(f"/pub/drawings/{token}")
        assert r.status_code == 404, (token[:12], r.status_code)
        assert r.json()["detail"] == "Drawing tidak ditemukan"

    tag = _uniq()
    h = _auth(client, f"pubacc1b_{tag}")
    d = _drawing(client, h, f"cid-aneh-{tag}", svg=_svg(f"MARKER-1B-{tag}"), cid=f"aneh.{tag}")
    _publish(client, h, f"Note cid aneh {tag}", f"::draw[{d['id']}]")
    assert pub.get(f"/pub/drawings/{d['id']}").status_code == 200
    assert pub.get(f"/pub/drawings/aneh.{tag}").status_code == 404


def test_pub_drawing_embedded_by_id_cid_and_escaped(client):
    """Drawing yang di-embed penerbit bisa dibaca lewat id MAUPUN client_id, apa pun bentuk rujukan
    di note (id, client_id, atau direktif ter-escape). Halaman publik memanggil id angka walau
    note merujuk lewat client_id, jadi keduanya wajib 200."""
    tag = _uniq()
    h = _auth(client, f"pubacc2_{tag}")
    d1 = _drawing(client, h, f"emb-id-{tag}", svg=_svg(f"S1-{tag}"), cid=f"cid-2a-{tag}")
    d2 = _drawing(client, h, f"emb-cid-{tag}", svg=_svg(f"S2-{tag}"), cid=f"cid-2b-{tag}")
    d3 = _drawing(client, h, f"emb-esc-{tag}", svg=_svg(f"S3-{tag}"), cid=f"cid-2c-{tag}")
    d3_ref = "::draw\\[" + str(d3["id"]) + "\\]"
    _publish(client, h, f"Note embed {tag}",
             f"::draw[{d1['id']}]\n\n::draw[{d2['client_id']}]\n\n{d3_ref}\n")

    pub = anon()
    for d in (d1, d2, d3):
        for token in (d["id"], d["client_id"]):
            r = pub.get(f"/pub/drawings/{token}")
            assert r.status_code == 200, (d["title"], token, r.text)
            body = r.json()
            assert set(body) == {"id", "title", "data_json", "svg_preview"}
            assert body["id"] == d["id"]
            assert body["title"] == d["title"]
            assert body["svg_preview"] == d["svg_preview"]


def test_pub_drawing_unpublish_revokes(client):
    """Setelah note di-unpublish, drawing-nya tidak lagi bisa dibaca publik."""
    tag = _uniq()
    h = _auth(client, f"pubacc3_{tag}")
    d = _drawing(client, h, f"unpub-{tag}", svg=_svg(f"MARKER-3-{tag}"), cid=f"cid-3-{tag}")
    note_id, _, _ = _publish(client, h, f"Note unpublish {tag}", f"::draw[{d['id']}]")

    pub = anon()
    assert pub.get(f"/pub/drawings/{d['id']}").status_code == 200

    assert client.delete(f"/api/scratchpad/{note_id}/publish", headers=h).status_code == 200
    assert pub.get(f"/pub/drawings/{d['id']}").status_code == 404
    assert pub.get(f"/pub/drawings/{d['client_id']}").status_code == 404


def test_pub_drawing_password_gate(client):
    """Drawing di note publish berpassword hanya terbaca dengan cookie unlock yang valid untuk
    slug note itu: tanpa cookie, cookie palsu, cookie ber-tanda-tangan slug lain, dan cookie
    unlock note lain semuanya 404. Cookie berkarakter non-ASCII juga 404 (bukan error server)."""
    tag = _uniq()
    h = _auth(client, f"pubacc4_{tag}")
    d = _drawing(client, h, f"locked-{tag}", svg=_svg(f"MARKER-4-{tag}"), cid=f"cid-4-{tag}")
    _, slug, _ = _publish(client, h, f"Note terkunci {tag}", f"::draw[{d['id']}]", password="rahasia123")
    _, other_slug, _ = _publish(client, h, f"Note terkunci lain {tag}", "tanpa drawing", password="rahasia456")

    pub = anon()
    url = f"/pub/drawings/{d['id']}"
    assert pub.get(url).status_code == 404
    assert pub.get(url, headers=_unlock_cookie(slug)).status_code == 200
    assert pub.get(f"/pub/drawings/{d['client_id']}", headers=_unlock_cookie(slug)).status_code == 200
    assert pub.get(url, headers={"Cookie": f"pub_unlock_{slug}={slug}:deadbeef"}).status_code == 404
    # cookie bernama untuk slug ini tetapi ditandatangani untuk slug lain
    assert pub.get(url, headers={"Cookie": f"pub_unlock_{slug}={webapp._sign_cookie(other_slug)}"}).status_code == 404
    # cookie unlock yang valid, tetapi milik note lain
    assert pub.get(url, headers=_unlock_cookie(other_slug)).status_code == 404
    # cookie non-ASCII (header mentah) tidak boleh membuat server error
    assert pub.get(url, headers={"Cookie": f"pub_unlock_{slug}=\u00e9:\u00e9".encode("utf-8")}).status_code == 404


def test_pub_drawing_any_accessible_note_suffices(client):
    """Drawing yang dirujuk beberapa note publish cukup lolos di salah satunya: note berpassword
    saja = 404, begitu ada note terbuka yang merujuk drawing yang sama = 200 tanpa cookie."""
    tag = _uniq()
    h = _auth(client, f"pubacc5_{tag}")
    d = _drawing(client, h, f"dua-note-{tag}", svg=_svg(f"MARKER-5-{tag}"), cid=f"cid-5-{tag}")
    _publish(client, h, f"Note berpassword {tag}", f"::draw[{d['id']}]", password="rahasia123")

    pub = anon()
    url = f"/pub/drawings/{d['id']}"
    assert pub.get(url).status_code == 404

    _publish(client, h, f"Note terbuka {tag}", f"::draw[{d['client_id']}]")
    assert pub.get(url).status_code == 200
    assert pub.get(f"/pub/drawings/{d['client_id']}").status_code == 200


def test_pub_other_users_drawing_not_exposed(client):
    """Note publish A yang merujuk drawing milik B (lewat id dan client_id) tidak membuka drawing B
    di endpoint publik, dan halaman A tidak menanam gambar B maupun menunjuk ke tokennya."""
    tag = _uniq()
    ha = _auth(client, f"pubusera6_{tag}")
    hb = _auth(client, f"pubuserb6_{tag}")
    marker = f"MARKER-B6-{tag}"
    b = _drawing(client, hb, f"gambar-b-{tag}", svg=_svg(marker), cid=f"cid-b6-{tag}")
    _, slug, username = _publish(client, ha, f"Note A {tag}", f"::draw[{b['id']}]\n\n::draw[{b['client_id']}]")

    pub = anon()
    assert pub.get(f"/pub/drawings/{b['id']}").status_code == 404
    assert pub.get(f"/pub/drawings/{b['client_id']}").status_code == 404

    page = pub.get(f"/pub/{username}/{slug}")
    assert page.status_code == 200
    assert marker not in page.text
    assert "Gambar tidak tersedia" in page.text
    assert f'data-drawing-preview="{b["id"]}"' not in page.text
    assert f'data-drawing-preview="{b["client_id"]}"' not in page.text


# ── Note publish bersama (workspace) ─────────────────────────────────────────

def test_pub_member_injection_blocked(client):
    """Anggota workspace ikut mengedit isi note bersama. Ia tidak boleh bisa membuka drawing pribadi pemilik
    lewat halaman publik dengan menyisipkan ::draw[id] / ::draw[client_id] ke note bersama yang dipublish."""
    tag = _uniq()
    ha = _auth(client, f"pubowner_{tag}")
    member = f"pubmember_{tag}"
    hb = _auth(client, member)
    marker = f"MARKER-P-{tag}"
    p = _drawing(client, ha, f"pribadi-{tag}", svg=_svg(marker), cid=f"cid-p-{tag}")  # tidak dirujuk di mana pun
    w = _workspace(client, ha, f"Workspace {tag}")
    _add_member(w, _uid(member))
    title, old_content = f"Note bersama {tag}", f"Isi awal {tag}"
    note_id, slug, username = _publish(client, ha, title, old_content, list_id=w)

    injected = f"{old_content}\n\n::draw[{p['id']}]\n\n::draw[{p['client_id']}]"
    r = client.put(f"/api/scratchpad/{note_id}", json={"title": title, "content": injected}, headers=hb)
    assert r.status_code == 200, r.text

    pub = anon()
    page = pub.get(f"/pub/{username}/{slug}")
    assert page.status_code == 200
    assert old_content in page.text
    assert marker not in page.text
    assert "Gambar tidak tersedia" in page.text  # penyisipan memang masuk ke isi yang dipublish
    assert pub.get(f"/pub/drawings/{p['id']}").status_code == 404
    assert pub.get(f"/pub/drawings/{p['client_id']}").status_code == 404


# ── Note publish "pribadi" harus juga terakhir disunting pemiliknya ──────────

def test_pub_workspace_delete_does_not_expose_member_drawings(client):
    """Pemilik workspace O (bukan penerbit) menyunting note bersama milik anggota V yang dipublish (pemilik dan anggota
    boleh menyunting note bersama): menyisipkan ::draw[...] ke drawing pribadi V dan [[id:K]] ke note berpassword V,
    lalu menghapus workspace (notes.list_id SET NULL). Note itu kini tampak pribadi, tetapi isinya bukan tulisan V:
    halaman publik tidak boleh menanam drawing V maupun menautkan K, dan /pub/drawings tetap 404."""
    tag = _uniq()
    ho = _auth(client, f"pubwsdelo_{tag}")
    v_name = f"pubwsdelv_{tag}"
    hv = _auth(client, v_name)
    w = _workspace(client, ho, f"Workspace {tag}")
    _add_member(w, _uid(v_name))
    m1, m2 = f"MARKER-WD1-{tag}", f"MARKER-WD2-{tag}"
    p1 = _drawing(client, hv, f"pribadi-wd1-{tag}", svg=_svg(m1))
    p2 = _drawing(client, hv, f"pribadi-wd2-{tag}", svg=_svg(m2), cid=f"cid-wd2-{tag}")
    k_id, k_slug, _ = _publish(client, hv, f"Terkunci milik V {tag}", "isi rahasia", password="rahasia123")
    title, old_content = f"Note bersama V {tag}", f"Isi awal {tag}"
    note_id, slug, username = _publish(client, hv, title, old_content, list_id=w)

    injected = f"{old_content}\n\n::draw[{p1['id']}]\n\n::draw[{p2['client_id']}]\n\n[[id:{k_id}]]"
    r = client.put(f"/api/scratchpad/{note_id}", json={"title": title, "content": injected}, headers=ho)
    assert r.status_code == 200, r.text
    assert client.delete(f"/api/lists/{w}", headers=ho).status_code == 200
    conn = db()
    try:
        assert conn.execute("SELECT list_id FROM scratchpad_notes WHERE id = ?", (note_id,)).fetchone()["list_id"] is None
    finally:
        conn.close()

    pub = anon()
    page = pub.get(f"/pub/{username}/{slug}")
    assert page.status_code == 200
    assert old_content in page.text
    assert m1 not in page.text and m2 not in page.text
    assert k_slug not in page.text
    assert page.text.count("Gambar tidak tersedia") == 2
    assert pub.get(f"/pub/drawings/{p1['id']}").status_code == 404
    assert pub.get(f"/pub/drawings/{p2['client_id']}").status_code == 404


def test_pub_unshare_after_member_edit_hides_drawings(client):
    """Anggota M menyisipkan ::draw[id drawing pribadi A] ke note bersama milik A yang dipublish, lalu A meng-unshare
    note itu. Note kembali pribadi, tetapi isinya terakhir ditulis M: drawing A tidak boleh tampil di halaman publik
    dan /pub/drawings tetap 404."""
    tag = _uniq()
    ha = _auth(client, f"pubunsha_{tag}")
    m_name = f"pubunshm_{tag}"
    hm = _auth(client, m_name)
    marker = f"MARKER-US-{tag}"
    p = _drawing(client, ha, f"pribadi-us-{tag}", svg=_svg(marker))
    w = _workspace(client, ha, f"Workspace {tag}")
    _add_member(w, _uid(m_name))
    title, old_content = f"Note bersama A {tag}", f"Isi awal {tag}"
    note_id, slug, username = _publish(client, ha, title, old_content, list_id=w)

    r = client.put(f"/api/scratchpad/{note_id}", json={"title": title, "content": f"{old_content}\n\n::draw[{p['id']}]"},
                   headers=hm)
    assert r.status_code == 200, r.text
    u = client.patch(f"/api/scratchpad/{note_id}/share", json={"list_id": None}, headers=ha)
    assert u.status_code == 200, u.text
    assert u.json()["list_id"] is None

    pub = anon()
    page = pub.get(f"/pub/{username}/{slug}")
    assert page.status_code == 200
    assert old_content in page.text
    assert marker not in page.text
    assert "Gambar tidak tersedia" in page.text
    assert pub.get(f"/pub/drawings/{p['id']}").status_code == 404


def test_pub_private_note_trusted_only_when_last_edited_by_owner(client):
    """Syarat tepercaya satu per satu: tulisan pemilik lewat PUT tampil; last_edited_by kosong (data lama) tetap
    tampil; terakhir disunting user lain tidak. Halaman dan /pub/drawings harus selalu sepakat."""
    tag = _uniq()
    v_name, o_name = f"pubtrustv_{tag}", f"pubtrusto_{tag}"
    hv = _auth(client, v_name)
    _auth(client, o_name)
    uid_v, uid_o = _uid(v_name), _uid(o_name)
    marker = f"MARKER-TR-{tag}"
    d = _drawing(client, hv, f"pribadi-tr-{tag}", svg=_svg(marker), cid=f"cid-tr-{tag}")
    title = f"Note tepercaya {tag}"
    note_id, slug, username = _publish(client, hv, title, "belum ada gambar")
    r = client.put(f"/api/scratchpad/{note_id}", json={"title": title, "content": f"::draw[{d['id']}]"}, headers=hv)
    assert r.status_code == 200, r.text

    pub = anon()

    def exposed():
        page = pub.get(f"/pub/{username}/{slug}")
        assert page.status_code == 200
        endpoint = pub.get(f"/pub/drawings/{d['id']}").status_code
        assert endpoint in (200, 404)
        assert (marker in page.text) == (endpoint == 200), "halaman dan /pub/drawings tidak sepakat"
        return endpoint == 200

    def set_last_editor(user_id):
        conn = db()
        try:
            conn.execute("UPDATE scratchpad_notes SET last_edited_by = ? WHERE id = ?", (user_id, note_id))
            conn.commit()
        finally:
            conn.close()

    assert exposed()  # ditulis pemilik lewat PUT
    set_last_editor(None)
    assert exposed()  # data lama: NULL = pemilik
    set_last_editor(uid_o)
    assert not exposed()  # terakhir disunting user lain
    set_last_editor(uid_v)
    assert exposed()


def test_pub_note_published_under_another_user_is_not_trusted(client):
    """Note milik V yang terbit atas nama O (mustahil lewat API: hanya pemilik yang bisa publish) bukan tulisan
    penerbit O, jadi ::draw[...] di dalamnya tidak boleh membuka drawing pribadi O (pertahanan berlapis)."""
    tag = _uniq()
    v_name, o_name = f"pubunderv_{tag}", f"pubundero_{tag}"
    hv = _auth(client, v_name)
    ho = _auth(client, o_name)
    marker = f"MARKER-UN-{tag}"
    d = _drawing(client, ho, f"pribadi-un-{tag}", svg=_svg(marker))
    note_id, slug, _ = _publish(client, hv, f"Note V {tag}", f"::draw[{d['id']}]")
    conn = db()
    try:
        conn.execute("UPDATE published_notes SET user_id = ? WHERE note_id = ?", (_uid(o_name), note_id))
        conn.commit()
    finally:
        conn.close()

    pub = anon()
    page = pub.get(f"/pub/{o_name}/{slug}")
    assert page.status_code == 200
    assert marker not in page.text
    assert "Gambar tidak tersedia" in page.text
    assert pub.get(f"/pub/drawings/{d['id']}").status_code == 404


# ── Render halaman publik ────────────────────────────────────────────────────

def test_published_page_resolves_own_cid_reference(client):
    """::draw[client_id] (format default sejak offline-first) ter-resolve ke drawing milik penerbit;
    halaman menunjuk id angka drawing itu untuk hidrasi lewat /pub/drawings/{id}."""
    tag = _uniq()
    h = _auth(client, f"pubusera7_{tag}")
    marker = f"MARKER-A7-{tag}"
    a = _drawing(client, h, f"gambar-a-{tag}", svg=_svg(marker), cid=f"cid-a7-{tag}")
    _, slug, username = _publish(client, h, f"Note {tag}", f"::draw[{a['client_id']}]")

    page = anon().get(f"/pub/{username}/{slug}")
    assert page.status_code == 200
    assert marker in page.text
    assert f'data-drawing-preview="{a["id"]}"' in page.text
    assert "Gambar tidak tersedia" not in page.text


def test_published_page_resolved_drawing_without_svg_embeds_iframe(client):
    """Drawing milik penerbit yang belum punya svg_preview tetap tampil lewat iframe tldraw (markup lama)."""
    tag = _uniq()
    h = _auth(client, f"pubifr_{tag}")
    d = _drawing(client, h, f"tanpa-svg-{tag}", svg="", cid=f"cid-ifr-{tag}")
    _, slug, username = _publish(client, h, f"Note {tag}", f"::draw[{d['client_id']}]")

    page = anon().get(f"/pub/{username}/{slug}")
    assert page.status_code == 200
    assert f'data-drawing-preview="{d["id"]}"' in page.text
    assert f'<iframe src="/static/vendor/tldraw/index.html?noteId={d["id"]}"' in page.text
    assert "Gambar tidak tersedia" not in page.text


def test_published_page_ignores_title_match(client):
    """Token tidak lagi dicocokkan dengan judul drawing, baik milik user lain maupun milik penerbit."""
    tag = _uniq()
    ha = _auth(client, f"pubusera8_{tag}")
    hb = _auth(client, f"pubuserb8_{tag}")
    title_b, title_a = f"judulrahasiab{tag}", f"judulsendiria{tag}"
    marker_b, marker_a = f"MARKER-B8-{tag}", f"MARKER-A8-{tag}"
    _drawing(client, hb, title_b, svg=_svg(marker_b))
    _drawing(client, ha, title_a, svg=_svg(marker_a))
    _, slug, username = _publish(client, ha, f"Note {tag}", f"::draw[{title_b}]\n\n::draw[{title_a}]")

    page = anon().get(f"/pub/{username}/{slug}")
    assert page.status_code == 200
    assert marker_b not in page.text
    assert marker_a not in page.text
    assert "Gambar tidak tersedia" in page.text


def test_published_page_no_note_id_fallback_and_no_legacy_canvas(client):
    """Token tak ter-resolve tidak jatuh ke drawing yang id-nya kebetulan sama dengan id note,
    dan halaman tidak lagi menanam "kanvas legacy per-note" (drawings WHERE id = note_id)."""
    tag = _uniq()
    ha = _auth(client, f"pubusera9_{tag}")
    hb = _auth(client, f"pubuserb9_{tag}")
    uid_b = _uid(f"pubuserb9_{tag}")
    marker_svg, marker_data = f"MARKER-SVG-B9-{tag}", f"MARKER-DATA-B9-{tag}"

    # Pastikan baris sqlite_sequence scratchpad_notes ada, lalu paksa id note A == id drawing B.
    client.post("/api/scratchpad", json={"title": f"seed {tag}", "content": "x"}, headers=ha)
    conn = db()
    try:
        d = max(
            conn.execute("SELECT COALESCE(MAX(id), 0) FROM drawings").fetchone()[0],
            conn.execute("SELECT COALESCE(MAX(id), 0) FROM scratchpad_notes").fetchone()[0],
            conn.execute("SELECT COALESCE(MAX(seq), 0) FROM sqlite_sequence WHERE name = 'scratchpad_notes'").fetchone()[0],
        ) + 1000
        conn.execute(
            "INSERT INTO drawings (id, user_id, title, data_json, svg_preview, is_pinned, created_at, updated_at) "
            "VALUES (?, ?, ?, ?, ?, 0, '2026-10-18T00:00:00', '2026-10-18T00:00:00')",
            (d, uid_b, f"gambar-b9-{tag}", f'{{"marker":"{marker_data}"}}', _svg(marker_svg)),
        )
        conn.execute("UPDATE sqlite_sequence SET seq = ? WHERE name = 'scratchpad_notes'", (d - 1,))
        conn.commit()
    finally:
        conn.close()

    note_id, slug, username = _publish(client, ha, f"Note A {tag}", "::draw[00000000-0000-0000-0000-000000000000]")
    assert note_id == d, "skenario salah: id note A harus sama dengan id drawing B"

    page = anon().get(f"/pub/{username}/{slug}")
    assert page.status_code == 200
    assert marker_svg not in page.text
    assert marker_data not in page.text
    assert 'id="drawing-iframe"' not in page.text
    assert "Gambar tidak tersedia" in page.text


class _DrawCardAttrs(HTMLParser):
    """Kumpulkan nama atribut semua elemen kartu drawing (class memuat 'note-draw-'), seperti dibaca browser."""

    def __init__(self):
        super().__init__()
        self.cards = 0
        self.attr_names = set()

    def handle_starttag(self, tag, attrs):
        css_class = dict(attrs).get("class") or ""
        if "note-draw-" in css_class:
            self.cards += css_class == "note-draw-card"
            self.attr_names.update(name for name, _ in attrs)


def test_published_page_unresolved_card_escapes_directive_attributes(client):
    """size/width/height dari direktif berasal dari isi note dan masuk ke atribut HTML kartu.
    Kartu 'Gambar tidak tersedia' tidak boleh bisa disuntik atribut baru (mis. onmouseover)."""
    tag = _uniq()
    h = _auth(client, f"pubattr_{tag}")
    content = ('::draw[tidakada]{height=400px"onmouseover=alert(1)}\n\n'
               '::draw[tidakada2]{size=X"onfocus=alert(2)}\n\n'
               '::draw[tidakada3]{width=50%"onclick=alert(3)}\n')
    _, slug, username = _publish(client, h, f"Note {tag}", content)

    page = anon().get(f"/pub/{username}/{slug}")
    assert page.status_code == 200
    assert page.text.count("Gambar tidak tersedia") == 3
    parser = _DrawCardAttrs()
    parser.feed(page.text)
    assert parser.cards == 3
    assert {name for name in parser.attr_names if name.startswith("on")} == set()
    assert parser.attr_names == {"class", "data-size", "style"}


# ── Gerbang password halaman note (refactor ke _pub_note_unlocked) ───────────

def test_published_page_password_gate_uses_unlock_cookie(client):
    """Halaman note berpassword: tanpa cookie unlock valid yang tampil hanya form password."""
    tag = _uniq()
    h = _auth(client, f"pubgate_{tag}")
    body_marker = f"ISI-RAHASIA-{tag}"
    _, slug, username = _publish(client, h, f"Note gate {tag}", body_marker, password="rahasia123")

    pub = anon()
    url = f"/pub/{username}/{slug}"
    locked = pub.get(url)
    assert locked.status_code == 200
    assert "dilindungi password" in locked.text
    assert body_marker not in locked.text

    forged = pub.get(url, headers={"Cookie": f"pub_unlock_{slug}={slug}:deadbeef"})
    assert "dilindungi password" in forged.text
    assert body_marker not in forged.text

    unlocked = pub.get(url, headers=_unlock_cookie(slug))
    assert unlocked.status_code == 200
    assert body_marker in unlocked.text
    assert "dilindungi password" not in unlocked.text


# ── Lampiran dan backlink mengikuti password note publish ────────────────────

def test_pub_attachment_respects_note_password(client):
    """Lampiran note publish berpassword hanya terbaca dengan cookie unlock yang valid untuk slug note-nya.
    Tanpa cookie, atau dengan cookie unlock note lain, jawabannya 404 yang identik dengan id yang tidak ada.
    Lampiran note publish terbuka tetap terbaca tanpa cookie."""
    tag = _uniq()
    username = f"pubatt_{tag}"
    h = _auth(client, username)
    uid = _uid(username)
    locked_text, open_text = f"ISI-LAMPIRAN-TERKUNCI-{tag}", f"ISI-LAMPIRAN-TERBUKA-{tag}"
    locked_note, locked_slug, _ = _publish(client, h, f"Note lampiran terkunci {tag}", "isi", password="rahasia123")
    _, other_slug, _ = _publish(client, h, f"Note terkunci lain {tag}", "isi lain", password="rahasia456")
    open_note, _, _ = _publish(client, h, f"Note lampiran terbuka {tag}", "isi")
    locked_att = _attachment(locked_note, uid, f"pubatt-{tag}-terkunci.txt", locked_text)
    open_att = _attachment(open_note, uid, f"pubatt-{tag}-terbuka.txt", open_text)

    pub = anon()
    url = f"/pub/attachments/{locked_att}"
    denied = pub.get(url)
    assert denied.status_code == 404
    assert denied.json() == {"detail": "Attachment tidak ditemukan"}
    missing = pub.get("/pub/attachments/2147483647")  # id yang memang tidak ada
    assert (missing.status_code, missing.json()) == (denied.status_code, denied.json())
    # cookie unlock yang valid, tetapi milik note lain
    assert pub.get(url, headers=_unlock_cookie(other_slug)).status_code == 404

    unlocked = pub.get(url, headers=_unlock_cookie(locked_slug))
    assert unlocked.status_code == 200
    assert unlocked.content == locked_text.encode("utf-8")

    opened = pub.get(f"/pub/attachments/{open_att}")
    assert opened.status_code == 200
    assert opened.content == open_text.encode("utf-8")


def test_pub_backlinks_hide_password_protected_notes(client):
    """Bagian "Related" halaman publik tidak boleh membocorkan judul maupun slug note publish berpassword
    yang menautkan ke note ini. Note publish terbuka yang menautkan tetap tampil."""
    tag = _uniq()
    h = _auth(client, f"pubbl_{tag}")
    target_title = f"Sasaran tautan {tag}"
    protected_title, open_title = f"Penaut rahasia {tag}", f"Penaut terbuka {tag}"
    _, target_slug, username = _publish(client, h, target_title, "Isi sasaran")
    _, protected_slug, _ = _publish(client, h, protected_title, f"Lihat [[{target_title}]]", password="rahasia123")
    _publish(client, h, open_title, f"Lihat juga [[{target_title}]]")

    page = anon().get(f"/pub/{username}/{target_slug}")
    assert page.status_code == 200
    assert open_title in page.text
    assert protected_title not in page.text
    assert protected_slug not in page.text


# ── Wikilink dan metadata lintas user di halaman publik ──────────────────────

def test_pub_wikilinks_skip_password_protected_notes(client):
    """Wikilink (judul, id:N, note:N, N polos) di halaman publik tidak me-resolve ke note berpassword milik user
    lain: slug-nya (diturunkan dari judul) tidak boleh muncul, dan wikilink tampil sebagai teks biasa seperti
    target yang tidak dipublish. Kontrol: note pribadi penerbit target yang sama tetap me-resolve keempatnya."""
    tag = _uniq()
    ha = _auth(client, f"pubwla_{tag}")
    hc = _auth(client, f"pubwlc_{tag}")
    t_title = f"Terkunci wikilink {tag}"
    t_id, t_slug, _ = _publish(client, ha, t_title, "isi rahasia", password="rahasia123")
    refs = _wikilink_refs(t_title, t_id)
    _, c_slug, c_user = _publish(client, hc, f"Penaut wikilink {tag}", "\n\n".join(refs))

    page = anon().get(f"/pub/{c_user}/{c_slug}")
    assert page.status_code == 200
    assert t_slug not in page.text
    for ref in refs:
        assert ref in page.text, ref  # isi note tetap dirender; hanya tautannya yang tidak dibuat

    _, a_slug, a_user = _publish(client, ha, f"Pemilik wikilink {tag}", "\n\n".join(refs))
    own_page = anon().get(f"/pub/{a_user}/{a_slug}")
    assert own_page.text.count(f'href="/pub/{a_user}/{t_slug}"') == 4


def test_pub_wikilinks_shared_note_skips_protected_notes(client):
    """Note publish bersama bisa diedit anggota workspace, jadi isinya bukan bukti penerbit mau menautkan note
    berpasswordnya: wikilink di note bersama tidak me-resolve note berpassword, walau milik penerbit yang sama."""
    tag = _uniq()
    h = _auth(client, f"pubwlshare_{tag}")
    t_title = f"Terkunci bersama {tag}"
    t_id, t_slug, _ = _publish(client, h, t_title, "isi rahasia", password="rahasia123")
    w = _workspace(client, h, f"Workspace {tag}")
    refs = _wikilink_refs(t_title, t_id)
    _, s_slug, s_user = _publish(client, h, f"Note bersama wikilink {tag}", "\n\n".join(refs), list_id=w)

    page = anon().get(f"/pub/{s_user}/{s_slug}")
    assert page.status_code == 200
    assert t_slug not in page.text
    for ref in refs:
        assert ref in page.text, ref


def test_pub_wikilinks_protected_note_does_not_shadow_open_note_with_same_title(client):
    """Judul tidak unik antar user. Note berpassword milik A yang berjudul sama dengan note terbuka milik B tidak
    boleh menggeser tautan ke note terbuka itu: wikilink judul tersebut me-resolve ke note B, bukan ke note A."""
    tag = _uniq()
    ha = _auth(client, f"pubshadowa_{tag}")
    hb = _auth(client, f"pubshadowb_{tag}")
    hc = _auth(client, f"pubshadowc_{tag}")
    title = f"Judul kembar {tag}"
    _, open_slug, open_user = _publish(client, hb, title, "isi terbuka")  # terbit lebih dulu
    _, locked_slug, _ = _publish(client, ha, title, "isi rahasia", password="rahasia123")  # terbit belakangan
    _, c_slug, c_user = _publish(client, hc, f"Penaut kembar {tag}", f"[[{title}]]")

    page = anon().get(f"/pub/{c_user}/{c_slug}")
    assert page.status_code == 200
    assert f'href="/pub/{open_user}/{open_slug}"' in page.text
    assert locked_slug not in page.text


def test_pub_wikilinks_escape_target_username(client):
    """Href wikilink ke note publik user lain memuat username target. Username tidak dibatasi karakternya,
    jadi tiap segmen href di-percent-encode (semua bentuk wikilink), bukan ditanam mentah."""
    tag = _uniq()
    ha = _auth(client, f"pubwlx_{tag}")
    evil_user = f'pubwlevil_"><i>{tag}'
    he = _auth(client, evil_user)
    w_title = f"Target username wikilink {tag}"
    w_id, w_slug, w_user = _publish(client, he, w_title, "isi target")
    assert w_user == evil_user
    refs = _wikilink_refs(w_title, w_id)
    _, p_slug, p_user = _publish(client, ha, f"Penaut username wikilink {tag}", "\n\n".join(refs))

    page = anon().get(f"/pub/{p_user}/{p_slug}")
    assert page.status_code == 200
    assert '"><i>' not in page.text
    assert page.text.count(f'href="/pub/pubwlevil_%22%3E%3Ci%3E{tag}/{w_slug}"') == 4
    # tautan ter-encode itu tetap membuka halaman target
    assert anon().get(f"/pub/pubwlevil_%22%3E%3Ci%3E{tag}/{w_slug}").status_code == 200


def test_pub_related_escapes_other_users_titles(client):
    """Judul note publik user lain ikut tampil di "Related" halaman ini. Judul itu di-escape sebagai teks HTML,
    bukan ditanam mentah (XSS lintas user)."""
    tag = _uniq()
    ha = _auth(client, f"pubrelt_a_{tag}")
    hb = _auth(client, f"pubrelt_b_{tag}")
    x_title = f"Sasaran judul {tag}"
    payload = "<img src=x onerror=alert(1)>"
    _, x_slug, x_user = _publish(client, ha, x_title, "isi")
    _publish(client, hb, f"{payload}{tag}", f"[[{x_title}]]")

    page = anon().get(f"/pub/{x_user}/{x_slug}")
    assert page.status_code == 200
    assert payload not in page.text
    assert f"&lt;img src=x onerror=alert(1)&gt;{tag}" in page.text


def test_pub_related_escapes_usernames(client):
    """Username tidak dibatasi karakternya. Username user lain di href "Related" tidak boleh bisa menutup atribut
    dan menyisipkan markup: tiap segmen href di-percent-encode, dan tautannya tetap membuka halaman penaut."""
    tag = _uniq()
    ha = _auth(client, f"pubrelu_{tag}")
    evil_user = f'pubevil_"><i>{tag}'
    he = _auth(client, evil_user)
    x_title = f"Sasaran username {tag}"
    _, x_slug, x_user = _publish(client, ha, x_title, "isi")
    _, e_slug, e_user = _publish(client, he, f"Penaut username {tag}", f"[[{x_title}]]")
    assert e_user == evil_user

    page = anon().get(f"/pub/{x_user}/{x_slug}")
    assert page.status_code == 200
    assert '"><i>' not in page.text
    assert f'href="/pub/pubevil_%22%3E%3Ci%3E{tag}/{e_slug}"' in page.text
    assert anon().get(f"/pub/pubevil_%22%3E%3Ci%3E{tag}/{e_slug}").status_code == 200


# ── Input buatan di rute publik tidak boleh error server ─────────────────────

@pytest.mark.parametrize("ref", [
    "[[\u00b2]]",
    "[[123456789012345678901234]]",
    "[[id:123456789012345678901234]]",
    "[[note:123456789012345678901234]]",
    "[[9223372036854775808]]",
    "[[id:9223372036854775808]]",
])
def test_published_page_crafted_wikilink_id_renders_as_plain_text(client, ref):
    """Isi note bisa disunting orang lain (note bersama), jadi satu wikilink buruk tidak boleh merusak halaman publik:
    digit Unicode (isdigit() True tetapi int() gagal), angka di atas INTEGER SQLite (20+ digit, dan tepat 2**63), serta
    bentuk id:N / note:N dengan angka itu. Semuanya tampil sebagai teks biasa seperti target yang tidak dipublish."""
    tag = _uniq()
    h = _auth(client, f"pubwlcraft_{tag}")
    note_id, slug, username = _publish(client, h, f"Note wikilink aneh {tag}", "isi awal")
    # Isi ditulis langsung ke DB: POST/PUT /api/scratchpad memanggil _resolve_linked_to yang sendiri gagal (500) pada id
    # raksasa sehingga isi seperti ini tidak bisa disimpan lewat API; renderer publik tetap tidak boleh bergantung pada itu.
    conn = db()
    try:
        conn.execute("UPDATE scratchpad_notes SET content = ? WHERE id = ?", (f"sebelum {ref} sesudah", note_id))
        conn.commit()
    finally:
        conn.close()

    page = anon().get(f"/pub/{username}/{slug}")
    assert page.status_code == 200
    assert f"sebelum {ref} sesudah" in page.text
    assert f"{ref}</a>" not in page.text  # teks biasa, bukan tautan


def test_pub_attachment_id_out_of_range_is_404_not_500(client):
    """Id lampiran di luar INTEGER SQLite (di atas maupun di bawah rentangnya) menjawab 404 yang identik dengan
    id yang tidak ada, bukan error server."""
    pub = anon()
    missing = pub.get("/pub/attachments/2147483647")
    assert (missing.status_code, missing.json()) == (404, {"detail": "Attachment tidak ditemukan"})
    for att_id in ("123456789012345678901234", "9223372036854775808", "9" * 5000, "-9223372036854775809", "-1"):
        r = pub.get(f"/pub/attachments/{att_id}")
        assert (r.status_code, r.json()) == (missing.status_code, missing.json()), att_id[:30]
