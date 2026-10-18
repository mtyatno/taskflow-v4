"""Ekspor DOCX hanya memakai lampiran dari note yang bisa diakses pengekspor (spec §3, kelas yang sama dengan 3e).

`_make_image_resolver(uid, note_id=None)` dipakai ekspor note tersimpan (GET /api/scratchpad/{id}/export/docx,
note_id dari path setelah cek akses) dan ekspor live (POST /api/scratchpad/export/docx, yang menerima isi dan
note_id bebas dari klien). File lampiran diambil server dari Nextcloud dengan kredensial server, jadi lampiran
hanya boleh ter-resolve bila note-nya lolos `_note_access_clause` (milik pengekspor, atau di workspace tempat ia
owner/anggota): baik dirujuk lewat id (/api/scratchpad/attachments/<id>/view dan /pub/attachments/<id>) maupun
lewat nama + note_id. Pengecualian hanya untuk id: lampiran note publish tanpa password milik siapa pun juga
boleh (sudah bisa dibuka siapa pun di /pub/attachments/<id>). Nama yang tidak ketemu di note_id (atau tanpa
note_id) hanya jatuh ke lampiran milik pengekspor sendiri.

Pengambilan Nextcloud dipalsukan di `requests.get`: fake mencatat URL dan menjawab 200 + b"BYTES:<url>".
DB tes dipakai bersama satu sesi pytest: username, nama file, dan path Nextcloud dibuat unik.
"""
import uuid
from types import SimpleNamespace

import pytest
import requests

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


def _create_note(client, headers, title, list_id=None):
    """Buat note (pribadi, atau di workspace bila list_id diisi); kembalikan id-nya."""
    payload = {"title": title, "content": "x"}
    if list_id is not None:
        payload["list_id"] = list_id
    r = client.post("/api/scratchpad", json=payload, headers=headers)
    assert r.status_code == 200, r.text
    return r.json()["id"]


def _attachment(note_id, user_id, name, path):
    """Sisipkan baris lampiran langsung ke note_attachments (tanpa unggah; Nextcloud dipalsukan);
    kembalikan {id, name, path}."""
    conn = db()
    try:
        cur = conn.execute(
            "INSERT INTO note_attachments (note_id, user_id, nextcloud_path, original_name, file_size, mime_type) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (note_id, user_id, path, name, 1, "image/png"),
        )
        conn.commit()
        return {"id": cur.lastrowid, "name": name, "path": path}
    finally:
        conn.close()


def _publish(client, headers, note_id, password=None):
    """Publish note milik user (tanpa password, atau berpassword bila diisi)."""
    r = client.post(f"/api/scratchpad/{note_id}/publish", json={"password": password} if password else {}, headers=headers)
    assert r.status_code == 200, r.text


@pytest.fixture
def nc_calls(monkeypatch):
    """Ganti pengambilan Nextcloud di resolver (requests.get) dengan fake yang mencatat URL dan menjawab
    200 + b"BYTES:<url>". URL berakhir dengan nextcloud_path lampiran (NEXTCLOUD_URL kosong di tes). Fake
    selalu kembali normal, jadi flag _nc_disabled resolver (menyala setelah exception) tidak pernah menyala.
    Fixture mengembalikan daftar URL yang diambil."""
    calls = []

    def fake(url, **kw):
        calls.append(url)
        return SimpleNamespace(status_code=200, content=b"BYTES:" + url.encode())

    monkeypatch.setattr(requests, "get", fake)
    return calls


def _fetched(calls, att):
    """URL yang diambil untuk lampiran ini (URL DAV berakhir dengan nextcloud_path-nya)."""
    return [u for u in calls if u.endswith(att["path"])]


def _is_fetch_of(got, att):
    """True bila `got` adalah isi hasil fake untuk lampiran ini."""
    return got is not None and got.startswith(b"BYTES:") and got.endswith(att["path"].encode())


def _scenario(client):
    """A (pengekspor) dan B. B pemilik dua workspace: W_in (A anggota) dan W_out (A bukan anggota).
    Lampiran (nama dan path Nextcloud unik) ada di: note pribadi A (milik A), note pribadi B, note B di W_in,
    dan note B di W_out (ketiganya milik B)."""
    tag = _uniq()
    ha = _auth(client, f"attscopea_{tag}")
    hb = _auth(client, f"attscopeb_{tag}")
    uid_a, uid_b = _uid(f"attscopea_{tag}"), _uid(f"attscopeb_{tag}")
    w_in = _workspace(client, hb, f"ws-in-{tag}")
    w_out = _workspace(client, hb, f"ws-out-{tag}")
    _add_member(w_in, uid_a)

    a_note = _create_note(client, ha, f"Note A {tag}")
    b_priv_note = _create_note(client, hb, f"Note pribadi B {tag}")
    b_in_note = _create_note(client, hb, f"Note B di W_in {tag}", list_id=w_in)
    b_out_note = _create_note(client, hb, f"Note B di W_out {tag}", list_id=w_out)

    def att(note_id, owner_id, label):
        return _attachment(note_id, owner_id, f"{label}-{tag}.png", f"/exp-att-scope/{tag}/{label}.png")

    return SimpleNamespace(
        ha=ha, uid_a=uid_a, hb=hb, uid_b=uid_b,
        a_note=a_note, a_att=att(a_note, uid_a, "a-own"),
        b_priv_note=b_priv_note, b_priv_att=att(b_priv_note, uid_b, "b-priv"),
        b_in_note=b_in_note, b_in_att=att(b_in_note, uid_b, "b-in"),
        b_out_note=b_out_note, b_out_att=att(b_out_note, uid_b, "b-out"),
    )


def _view_url(att):
    return f"/api/scratchpad/attachments/{att['id']}/view"


# ── Resolver ─────────────────────────────────────────────────────────────────

def test_export_image_resolver_rejects_other_users_attachment_by_id(client, nc_calls):
    """Lampiran yang dirujuk lewat id (kedua bentuk URL) hanya ter-resolve bila note-nya bisa diakses
    pengekspor: lampiran note pribadi B, dan lampiran note B di workspace yang A bukan anggotanya, tidak
    diambil dari Nextcloud. Tanpa filter, id lampiran mana pun ter-resolve."""
    s = _scenario(client)
    res = webapp._make_image_resolver(s.uid_a)

    got = {
        f"{label}, {form}": res(form.format(att["id"]))
        for label, att in (("note pribadi B", s.b_priv_att), ("note B di workspace luar", s.b_out_att))
        for form in ("/api/scratchpad/attachments/{}/view", "/pub/attachments/{}")
    }
    leaked = [case for case, data in got.items() if data is not None]
    assert not leaked, f"lampiran user lain ter-resolve lewat: {leaked}"
    assert nc_calls == [], f"Nextcloud diambil untuk lampiran user lain: {nc_calls}"


def test_export_image_resolver_rejects_foreign_note_id(client, nc_calls):
    """note_id dari pemanggil (body ekspor live) hanya dipakai bila note itu bisa diakses pengekspor: nama
    lampiran B tidak ter-resolve lewat note_id note pribadi B maupun note B di workspace luar."""
    s = _scenario(client)

    got = {
        label: webapp._make_image_resolver(s.uid_a, note_id=note_id)(att["name"])
        for label, note_id, att in (
            ("note pribadi B", s.b_priv_note, s.b_priv_att),
            ("note B di workspace luar", s.b_out_note, s.b_out_att),
        )
    }
    leaked = [case for case, data in got.items() if data is not None]
    assert not leaked, f"lampiran user lain ter-resolve lewat note_id: {leaked}"
    assert nc_calls == [], f"Nextcloud diambil untuk lampiran user lain: {nc_calls}"


def test_export_image_resolver_allows_accessible_attachments(client, nc_calls):
    """Lampiran dari note yang bisa diakses tetap ter-resolve: note pribadi sendiri (lewat id, lewat nama +
    note_id, dan lewat nama saja = fallback lampiran milik sendiri) dan note B di workspace tempat A anggota
    (lewat id dan lewat nama + note_id; lampirannya milik B). Penjaga agar penolakan tidak terlalu ketat."""
    s = _scenario(client)
    res = webapp._make_image_resolver(s.uid_a)

    cases = {
        "sendiri, id": (res(_view_url(s.a_att)), s.a_att),
        "sendiri, nama + note_id": (
            webapp._make_image_resolver(s.uid_a, note_id=s.a_note)(s.a_att["name"]), s.a_att),
        "sendiri, nama saja": (res(s.a_att["name"]), s.a_att),
        "workspace anggota, id": (res(_view_url(s.b_in_att)), s.b_in_att),
        "workspace anggota, nama + note_id": (
            webapp._make_image_resolver(s.uid_a, note_id=s.b_in_note)(s.b_in_att["name"]), s.b_in_att),
    }
    wrong = [case for case, (data, att) in cases.items() if not _is_fetch_of(data, att)]
    assert not wrong, f"lampiran yang bisa diakses tidak ter-resolve ke file yang benar: {wrong}"


def test_export_image_resolver_allows_publicly_visible_attachments(client, nc_calls):
    """Lampiran note publish TANPA password milik user lain boleh dipakai ekspor lewat id: file itu sudah bisa dibuka
    siapa pun di /pub/attachments/<id> (mis. gambar di note sendiri yang menunjuk ke sana). Lampiran note berpassword
    dan note yang tidak dipublish tetap tidak ter-resolve, dan note_id dari request tetap hanya lolos cek akses."""
    s = _scenario(client)
    tag = _uniq()

    def b_note_with_attachment(label, publish=False, password=None):
        note_id = _create_note(client, s.hb, f"Note {label} B {tag}")
        if publish:
            _publish(client, s.hb, note_id, password=password)
        return note_id, _attachment(note_id, s.uid_b, f"{label}-{tag}.png", f"/exp-att-scope/{tag}/{label}.png")

    open_note, open_att = b_note_with_attachment("b-open", publish=True)
    _, locked_att = b_note_with_attachment("b-locked", publish=True, password="rahasia123")
    _, draft_att = b_note_with_attachment("b-draft")
    res = webapp._make_image_resolver(s.uid_a)

    assert _is_fetch_of(res(f"/pub/attachments/{open_att['id']}"), open_att)
    for label, att in (("berpassword", locked_att), ("tidak dipublish", draft_att)):
        for form in ("/pub/attachments/{}", "/api/scratchpad/attachments/{}/view"):
            assert res(form.format(att["id"])) is None, f"lampiran note {label} ter-resolve lewat {form}"
    assert _fetched(nc_calls, locked_att) == [] and _fetched(nc_calls, draft_att) == [], nc_calls
    # note_id dari request tetap hanya dicek aksesnya: note publish terbuka milik B bukan note yang bisa diakses A
    assert webapp._make_image_resolver(s.uid_a, note_id=open_note)(open_att["name"]) is None


# ── Endpoint ekspor live ─────────────────────────────────────────────────────

def test_export_live_docx_ignores_foreign_attachment(client, nc_calls):
    """POST /api/scratchpad/export/docx menerima isi dan note_id bebas: gambar yang merujuk lampiran B
    (lewat id, dan lewat nama dengan note_id note B) tidak diambil dari Nextcloud. Baris ketiga, lampiran A
    sendiri, jadi kontrol bahwa resolver memang berjalan di request ini."""
    s = _scenario(client)
    content = "\n\n".join([
        f"![x]({_view_url(s.b_priv_att)})",
        f"![y]({s.b_priv_att['name']})",
        f"![z]({_view_url(s.a_att)})",
    ])

    r = client.post("/api/scratchpad/export/docx", headers=s.ha, json={
        "note_id": s.b_priv_note, "title": "Ekspor live", "content": content,
    })

    assert r.status_code == 200, r.text
    assert "wordprocessingml.document" in r.headers["content-type"], r.text[:300]  # bukan traceback text/plain
    assert _fetched(nc_calls, s.b_priv_att) == [], f"lampiran B diambil dari Nextcloud: {nc_calls}"
    assert _fetched(nc_calls, s.a_att) != [], "kontrol: lampiran A sendiri seharusnya diambil"
