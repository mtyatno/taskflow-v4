"""Akses publik drawing: /pub/drawings dan render halaman publik (/pub/{user}/{slug}).

Drawing hanya boleh tampil publik bila dirujuk ::draw[id|client_id] oleh note publish milik
pemiliknya, dan note itu terbuka (tanpa password, atau cookie unlock valid). Semua penolakan
menjawab 404 yang sama dengan "tidak ada". Spec: docs/superpowers/specs/
2026-10-18-workspace-drawing-project-design.md §3.

DB tes dipakai bersama satu sesi pytest: username, judul, client_id, dan marker dibuat unik.
"""
import uuid
from html.parser import HTMLParser

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


def _publish(client, headers, title, content, password=None):
    """Buat note lalu publish; kembalikan (note_id, slug, username)."""
    r = client.post("/api/scratchpad", json={"title": title, "content": content}, headers=headers)
    assert r.status_code == 200, r.text
    note_id = r.json()["id"]
    p = client.post(f"/api/scratchpad/{note_id}/publish",
                    json={"password": password} if password else {}, headers=headers)
    assert p.status_code == 200, p.text
    return note_id, p.json()["slug"], p.json()["username"]


def _unlock_cookie(slug):
    """Header Cookie unlock yang valid untuk slug. Endpoint unlock asli memasang cookie `secure`
    yang tidak dikirim balik TestClient (http), jadi cookie-nya dibuat langsung."""
    return {"Cookie": f"pub_unlock_{slug}={webapp._sign_cookie(slug)}"}


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
