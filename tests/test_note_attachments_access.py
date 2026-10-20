"""Lampiran note bersama (D9): semua lampiran (Nextcloud lama + media) bisa dilihat/ditambah siapa pun yang bisa
membuka note; hapus hanya oleh pengunggah atau pemilik note. Nextcloud dipalsukan di requests.put/get/delete/request."""
import io
import uuid
from pathlib import Path
from types import SimpleNamespace

import pytest
import requests

import webapp
from conftest import db
from drawing_ws_helpers import add_member, auth, make_note, uid_of, workspace

MP4 = b"\x00\x00\x00\x18ftypisom\x00\x00\x02\x00isomiso2" + b"\x00" * 16
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 16


def _uniq(p):
    return f"{p}{uuid.uuid4().hex[:8]}"


@pytest.fixture
def nc(monkeypatch):
    calls = {"put": [], "get": [], "delete": []}
    monkeypatch.setattr(requests, "put", lambda url, **kw: (calls["put"].append(url), SimpleNamespace(status_code=201))[1])
    monkeypatch.setattr(requests, "request", lambda *a, **kw: SimpleNamespace(status_code=201))
    monkeypatch.setattr(requests, "delete", lambda url, **kw: (calls["delete"].append(url), SimpleNamespace(status_code=204))[1])

    def fget(url, **kw):
        calls["get"].append(url)
        return SimpleNamespace(status_code=200, iter_content=lambda chunk_size=8192: iter([b"NCBYTES"]))
    monkeypatch.setattr(requests, "get", fget)
    return calls


@pytest.fixture
def world(client, monkeypatch):
    monkeypatch.setattr(webapp.media_worker, "enqueue", lambda i: None)
    owner = _uniq("ao")
    m1, m2, out = _uniq("am"), _uniq("an"), _uniq("ax")
    ho, h1, h2, hx = (auth(client, n) for n in (owner, m1, m2, out))
    lid = workspace(client, ho, _uniq("ws"))
    add_member(lid, uid_of(m1))
    add_member(lid, uid_of(m2))
    note = make_note(client, ho, "n", "c", list_id=lid)["id"]
    return SimpleNamespace(client=client, ho=ho, h1=h1, h2=h2, hx=hx, note=note, uo=uid_of(owner), u1=uid_of(m1))


def _legacy(w, uid, name="a.png"):
    c = db()
    try:
        cur = c.execute(
            "INSERT INTO note_attachments (note_id, user_id, nextcloud_path, original_name, file_size, mime_type) "
            "VALUES (?,?,?,?,?,?)", (w.note, uid, f"/x/{_uniq('f')}.png", name, 1, "image/png"))
        c.commit()
        return cur.lastrowid
    finally:
        c.close()


def _media(w, h, name="clip.mp4", finish=True):
    cid = _uniq("c")
    att = w.client.post(f"/api/scratchpad/{w.note}/media", headers=h,
                        json={"client_id": cid, "filename": name, "size": len(MP4), "mime": "video/mp4"}).json()["id"]
    if finish:
        assert w.client.patch(f"/api/media/{att}/upload", headers={**h, "Upload-Offset": "0"}, content=MP4).status_code == 200
        assert w.client.post(f"/api/media/{att}/complete", headers=h).status_code == 200
    return att, cid


def _row(att):
    c = db()
    try:
        return c.execute("SELECT * FROM note_attachments WHERE id=?", (att,)).fetchone()
    finally:
        c.close()


def test_member_can_list_upload_and_view_legacy_attachments(client, nc, world):
    w = world
    aid = _legacy(w, w.uo)
    r = client.get(f"/api/scratchpad/{w.note}/attachments", headers=w.h1)
    assert r.status_code == 200 and aid in [x["id"] for x in r.json()]
    up = client.post(f"/api/scratchpad/{w.note}/attachments", headers=w.h1,
                     files={"file": ("p.png", io.BytesIO(PNG), "image/png")})
    assert up.status_code == 200, up.text
    assert up.json()["user_id"] == w.u1
    v = client.get(f"/api/scratchpad/attachments/{aid}/view", headers=w.h1)
    assert v.status_code == 200 and v.content == b"NCBYTES"


def test_outsider_gets_404_everywhere(client, nc, world):
    w = world
    aid = _legacy(w, w.uo)
    m, _ = _media(w, w.ho)
    assert client.get(f"/api/scratchpad/{w.note}/attachments", headers=w.hx).status_code == 404
    assert client.post(f"/api/scratchpad/{w.note}/attachments", headers=w.hx,
                       files={"file": ("p.png", io.BytesIO(PNG), "image/png")}).status_code == 404
    for a in (aid, m):
        assert client.get(f"/api/scratchpad/attachments/{a}/view", headers=w.hx).status_code == 404
        d = client.delete(f"/api/scratchpad/attachments/{a}", headers=w.hx)
        assert d.status_code == 404 and d.json()["detail"] == "Attachment tidak ditemukan"
    assert _row(aid) and _row(m)


def test_delete_only_uploader_or_note_owner(client, nc, world):
    w = world
    mine = _legacy(w, w.u1)
    theirs = _legacy(w, w.u1)
    other = _legacy(w, w.u1)
    d = client.delete(f"/api/scratchpad/attachments/{other}", headers=w.h2)
    assert d.status_code == 403 and d.json()["detail"] == "Bukan attachment milikmu"
    assert _row(other)
    assert client.delete(f"/api/scratchpad/attachments/{mine}", headers=w.h1).status_code == 200
    assert client.delete(f"/api/scratchpad/attachments/{theirs}", headers=w.ho).status_code == 200  # pemilik note
    assert _row(mine) is None and _row(theirs) is None
    assert len(nc["delete"]) == 2


def test_delete_uploading_media_cancels_upload(client, nc, world):
    w = world
    att, _ = _media(w, w.h1, finish=False)
    assert client.patch(f"/api/media/{att}/upload", headers={**w.h1, "Upload-Offset": "0"}, content=MP4[:10]).status_code == 200
    part = Path(webapp.media_storage.temp_path(att))
    assert part.exists()
    assert client.delete(f"/api/scratchpad/attachments/{att}", headers=w.h1).status_code == 200
    assert _row(att) is None and not part.exists()
    r = client.patch(f"/api/media/{att}/upload", headers={**w.h1, "Upload-Offset": "10"}, content=MP4[10:])
    assert r.status_code == 404


def test_delete_media_removes_files_and_row(client, nc, world):
    w = world
    att, _ = _media(w, w.h1)
    root = Path(webapp.MEDIA_ROOT)
    key = _row(att)["storage_key"]
    poster = key.rsplit(".", 1)[0] + ".poster.jpg"
    (root / poster).write_bytes(b"jpg")
    c = db()
    c.execute("UPDATE note_attachments SET status='ready', poster_key=? WHERE id=?", (poster, att))
    c.commit()
    c.close()
    tmp = root / ".tmp"
    tmp.mkdir(parents=True, exist_ok=True)
    extra = [tmp / f"{att}.part", tmp / f"{att}.fs.mp4", tmp / f"{att}.poster.jpg"]
    for p in extra:
        p.write_bytes(b"t")
    assert (root / key).exists()
    assert client.delete(f"/api/scratchpad/attachments/{att}", headers=w.ho).status_code == 200
    assert _row(att) is None
    assert not (root / key).exists() and not (root / poster).exists()
    assert not any(p.exists() for p in extra)
    assert nc["delete"] == []  # tidak menyentuh Nextcloud


def test_delete_media_files_never_raises(monkeypatch):
    webapp._delete_media_files({"id": 999001, "storage_key": "../../etc/passwd", "poster_key": None})
    webapp._delete_media_files({"id": 999002, "storage_key": None, "poster_key": None})


def test_view_media_row_redirects_to_signed_play(client, nc, world):
    w = world
    att, _ = _media(w, w.h1)
    assert client.get(f"/api/scratchpad/attachments/{att}/view", headers=w.h2, follow_redirects=False).status_code == 404
    c = db()
    c.execute("UPDATE note_attachments SET status='ready' WHERE id=?", (att,))
    c.commit()
    c.close()
    r = client.get(f"/api/scratchpad/attachments/{att}/view", headers=w.h2, follow_redirects=False)
    assert r.status_code == 302 and r.headers["location"].startswith("/media/")


def test_list_includes_media_fields(client, nc, world):
    w = world
    _legacy(w, w.uo)
    att, cid = _media(w, w.h1)
    items = client.get(f"/api/scratchpad/{w.note}/attachments", headers=w.h2).json()
    m = next(x for x in items if x["id"] == att)
    assert m["kind"] == "media" and m["status"] == "processing" and m["client_id"] == cid
    assert "media_type" in m and "duration_ms" in m
