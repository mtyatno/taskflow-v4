"""Tes unggah bertahap media note (init / PATCH / complete)."""
import asyncio
import errno
import re
import uuid
from pathlib import Path

import pytest

import webapp
from conftest import db
from drawing_ws_helpers import add_member, auth, make_note, uid_of, workspace

MP4 = b"\x00\x00\x00\x18ftypisom\x00\x00\x02\x00isomiso2" + b"\x00" * 16  # 36 byte


def _uniq(p):
    return f"{p}{uuid.uuid4().hex[:8]}"


def _setup(client):
    name = _uniq("mu")
    h = auth(client, name)
    note = make_note(client, h, "n", "c")
    return h, note["id"], name


def _init(client, h, note_id, size, cid=None, filename="a.mp4", mime="video/mp4"):
    return client.post(f"/api/scratchpad/{note_id}/media", headers=h,
                       json={"client_id": _uniq("c") if cid is None else cid, "filename": filename,
                             "size": size, "mime": mime})


def _patch(client, h, att_id, offset, data):
    hdrs = dict(h)
    if offset is not None:
        hdrs["Upload-Offset"] = str(offset)
    return client.patch(f"/api/media/{att_id}/upload", headers=hdrs, content=data)


def _row(att_id):
    c = db()
    try:
        return c.execute("SELECT * FROM note_attachments WHERE id=?", (att_id,)).fetchone()
    finally:
        c.close()


def _part(att_id):
    return webapp.media_storage.temp_path(att_id)


def test_init_owner_and_member_ok_outsider_404(client):
    h, nid, _ = _setup(client)
    r = _init(client, h, nid, 10)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["status"] == "uploading" and d["received_bytes"] == 0 and d["file_size"] == 10
    assert d["note_id"] == nid and d["original_name"] == "a.mp4"
    assert d["play_url"] is None and d["poster_url"] is None and d["download_url"] is None
    assert d["expires_at"] is None and d["uploaded_by_name"]
    assert _part(d["id"]).exists()
    row = _row(d["id"])
    assert row["kind"] == "media" and row["storage"] == "local" and row["nextcloud_path"] == ""
    # workspace member
    owner = auth(client, _uniq("mo"))
    member_name = _uniq("mm")
    mh = auth(client, member_name)
    lid = workspace(client, owner, _uniq("ws"))
    add_member(lid, uid_of(member_name))
    wn = make_note(client, owner, "w", "c", list_id=lid)
    assert _init(client, mh, wn["id"], 5).status_code == 200
    outsider = auth(client, _uniq("mx"))
    r = _init(client, outsider, wn["id"], 5)
    assert r.status_code == 404 and r.json()["detail"] == "Media tidak ditemukan"


def test_init_rejects_size_over_limit_413_and_bad_ext_415(client, monkeypatch):
    h, nid, _ = _setup(client)
    monkeypatch.setattr(webapp, "MEDIA_MAX_FILE_BYTES", 100)
    assert _init(client, h, nid, 101).status_code == 413
    assert _init(client, h, nid, 100).status_code == 200
    assert _init(client, h, nid, 10, filename="a.exe").status_code == 415
    assert _init(client, h, nid, 10, filename="noext").status_code == 415
    assert _init(client, h, nid, 10, mime="text/html").status_code == 415
    assert _init(client, h, nid, 10, mime="application/octet-stream").status_code == 200
    assert _init(client, h, nid, 10, mime="").status_code == 200
    assert _init(client, h, nid, 0).status_code == 400
    assert _init(client, h, nid, "x").status_code == 400


def test_init_idempotent_same_client_id_returns_same_row_with_progress(client):
    h, nid, _ = _setup(client)
    cid = _uniq("c")
    a = _init(client, h, nid, 12, cid=cid).json()
    assert _patch(client, h, a["id"], 0, MP4[:5]).status_code == 200
    r = _init(client, h, nid, 12, cid=cid)
    assert r.status_code == 200
    assert r.json()["id"] == a["id"] and r.json()["received_bytes"] == 5


def test_init_client_id_used_on_other_note_409(client):
    h, nid, _ = _setup(client)
    n2 = make_note(client, h, "n2", "c")["id"]
    cid = _uniq("c")
    assert _init(client, h, nid, 5, cid=cid).status_code == 200
    assert _init(client, h, n2, 5, cid=cid).status_code == 409


def test_init_invalid_client_id_400(client):
    h, nid, _ = _setup(client)
    for bad in ["", "a b", "x" * 65, "a/b", "é"]:
        assert _init(client, h, nid, 5, cid=bad).status_code == 400, bad
    r = client.post(f"/api/scratchpad/{nid}/media", headers=h,
                    json={"filename": "a.mp4", "size": 5, "mime": ""})
    assert r.status_code == 400


def test_patch_sequence_and_resume(client):
    h, nid, _ = _setup(client)
    att = _init(client, h, nid, 12).json()["id"]
    r = _patch(client, h, att, 0, b"hello")
    assert r.status_code == 200 and r.json()["received_bytes"] == 5
    g = client.get(f"/api/media/{att}/upload", headers=h)
    assert g.status_code == 200 and g.json()["received_bytes"] == 5
    r = _patch(client, h, att, 5, b"-world!")
    assert r.status_code == 200 and r.json()["received_bytes"] == 12
    assert _part(att).read_bytes() == b"hello-world!"
    assert _row(att)["received_bytes"] == 12


def test_patch_wrong_offset_409_returns_received(client):
    h, nid, _ = _setup(client)
    att = _init(client, h, nid, 12).json()["id"]
    _patch(client, h, att, 0, b"hello")
    r = _patch(client, h, att, 3, b"xx")
    assert r.status_code == 409 and r.json()["received_bytes"] == 5
    r = _patch(client, h, att, 0, b"hello")
    assert r.status_code == 409 and r.json()["received_bytes"] == 5
    assert _part(att).read_bytes() == b"hello"


def test_patch_rewrite_same_offset_after_lost_response_keeps_file_identical(client):
    h, nid, _ = _setup(client)
    att = _init(client, h, nid, 12).json()["id"]
    _patch(client, h, att, 0, b"hello")
    # klien tak menerima respons dan mengulang offset lama: 409, file utuh
    assert _patch(client, h, att, 0, b"hello").status_code == 409
    # potongan berikutnya sukses sekali lalu pengulangannya 409
    assert _patch(client, h, att, 5, b"-world!").status_code == 200
    assert _patch(client, h, att, 5, b"-world!").status_code == 409
    assert _part(att).read_bytes() == b"hello-world!"
    # sisa byte di .part melewati received_bytes (tulis separuh lalu crash) terpotong saat tulis ulang
    att2 = _init(client, h, nid, 12).json()["id"]
    _part(att2).write_bytes(b"JUNKJUNKJUNK")
    assert _patch(client, h, att2, 0, b"abc").status_code == 200
    assert _part(att2).read_bytes() == b"abc"


def test_patch_concurrent_same_attachment_one_wins(client):
    h, nid, _ = _setup(client)
    att = _init(client, h, nid, 12).json()["id"]
    lock = asyncio.Lock()
    asyncio.run(lock.acquire())
    webapp._media_upload_locks[att] = lock
    try:
        r = _patch(client, h, att, 0, b"hello")
        assert r.status_code == 409 and r.json()["received_bytes"] == 0
        assert _part(att).read_bytes() == b""
    finally:
        webapp._media_upload_locks.pop(att, None)
    assert _patch(client, h, att, 0, b"hello").status_code == 200


def test_patch_exceeds_size_413_and_body_over_chunk_413(client, monkeypatch):
    h, nid, _ = _setup(client)
    att = _init(client, h, nid, 6).json()["id"]
    assert _patch(client, h, att, 0, b"1234567").status_code == 413
    assert _patch(client, h, att, 4, b"123").status_code == 409  # offset salah menang atas ukuran
    assert _row(att)["received_bytes"] == 0
    monkeypatch.setattr(webapp, "MEDIA_CHUNK_BYTES", 4)
    big = _init(client, h, nid, 50 * 1024 * 1024).json()["id"]
    assert _patch(client, h, big, 0, b"x" * (4 + 1024 * 1024 + 1)).status_code == 413
    assert _row(big)["received_bytes"] == 0
    assert _part(big).stat().st_size == 0


def test_patch_only_uploader_and_only_uploading(client):
    owner = auth(client, _uniq("po"))
    mname = _uniq("pm")
    mh = auth(client, mname)
    lid = workspace(client, owner, _uniq("ws"))
    add_member(lid, uid_of(mname))
    nid = make_note(client, owner, "w", "c", list_id=lid)["id"]
    att = _init(client, owner, nid, len(MP4)).json()["id"]
    # anggota lain: boleh GET, tidak boleh PATCH/complete
    assert client.get(f"/api/media/{att}/upload", headers=mh).status_code == 200
    assert _patch(client, mh, att, 0, MP4).status_code == 404
    assert client.post(f"/api/media/{att}/complete", headers=mh).status_code == 404
    outsider = auth(client, _uniq("px"))
    assert client.get(f"/api/media/{att}/upload", headers=outsider).status_code == 404
    assert _patch(client, owner, att, 0, MP4).status_code == 200
    assert client.post(f"/api/media/{att}/complete", headers=owner).status_code == 200
    r = _patch(client, owner, att, 0, MP4)
    assert r.status_code == 409
    assert client.post(f"/api/media/{att}/complete", headers=owner).status_code == 409


def test_patch_missing_upload_offset_400(client):
    h, nid, _ = _setup(client)
    att = _init(client, h, nid, 5).json()["id"]
    assert _patch(client, h, att, None, b"abc").status_code == 400
    r = client.patch(f"/api/media/{att}/upload", headers={**h, "Upload-Offset": "-1"}, content=b"a")
    assert r.status_code == 400
    r = client.patch(f"/api/media/{att}/upload", headers={**h, "Upload-Offset": "abc"}, content=b"a")
    assert r.status_code == 400


def test_patch_disk_full_507(client, monkeypatch):
    h, nid, _ = _setup(client)
    att = _init(client, h, nid, 12).json()["id"]

    def boom(*a, **k):
        raise OSError(errno.ENOSPC, "No space left")
    monkeypatch.setattr(webapp, "_media_write_chunk", boom)
    r = _patch(client, h, att, 0, b"hello")
    assert r.status_code == 507 and r.json()["detail"] == "Penyimpanan server penuh"
    assert _row(att)["received_bytes"] == 0
    assert att not in webapp._media_upload_locks or not webapp._media_upload_locks[att].locked()


def test_complete_incomplete_400(client):
    h, nid, _ = _setup(client)
    att = _init(client, h, nid, 12).json()["id"]
    _patch(client, h, att, 0, b"hello")
    assert client.post(f"/api/media/{att}/complete", headers=h).status_code == 400
    assert _row(att)["status"] == "uploading"


def test_complete_html_disguised_as_mp4_415_failed_and_file_deleted(client):
    h, nid, _ = _setup(client)
    body = b"<html><body>not media at all</body></html>"
    att = _init(client, h, nid, len(body)).json()["id"]
    _patch(client, h, att, 0, body)
    r = client.post(f"/api/media/{att}/complete", headers=h)
    assert r.status_code == 415
    row = _row(att)
    assert row["status"] == "failed" and row["error"] == "Format file tidak didukung"
    assert not _part(att).exists()


def test_complete_valid_moves_file_sets_processing_and_enqueues(client, monkeypatch):
    calls = []
    monkeypatch.setattr(webapp.media_worker, "enqueue", lambda i: calls.append(i))
    h, nid, _ = _setup(client)
    att = _init(client, h, nid, len(MP4)).json()["id"]
    _patch(client, h, att, 0, MP4)
    r = client.post(f"/api/media/{att}/complete", headers=h)
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "processing" and r.json()["media_type"] == "video"
    row = _row(att)
    assert re.fullmatch(r"\d{4}/\d{2}/[0-9a-f-]{36}\.mp4", row["storage_key"])
    f = Path(webapp.MEDIA_ROOT) / row["storage_key"]
    assert f.read_bytes() == MP4
    assert not _part(att).exists()
    assert row["mime_type"] == "video/mp4" and row["media_type"] == "video"
    assert row["status"] == "processing"
    assert calls == [att]


def test_filename_never_used_as_path(client, monkeypatch):
    monkeypatch.setattr(webapp.media_worker, "enqueue", lambda i: None)
    h, nid, _ = _setup(client)
    att = _init(client, h, nid, len(MP4), filename="../../x.mp4").json()
    assert att["original_name"] == "../../x.mp4"
    _patch(client, h, att["id"], 0, MP4)
    assert client.post(f"/api/media/{att['id']}/complete", headers=h).status_code == 200
    key = _row(att["id"])["storage_key"]
    assert re.fullmatch(r"\d{4}/\d{2}/[0-9a-f-]{36}\.mp4", key)
    long_name = ("é" * 300) + ".mp3"
    r = _init(client, h, nid, 5, filename=long_name, mime="")
    assert r.status_code == 200 and len(r.json()["original_name"]) == 255


def _delete_row(att_id):
    c = db()
    try:
        c.execute("DELETE FROM note_attachments WHERE id=?", (att_id,))
        c.commit()
    finally:
        c.close()


def test_patch_row_deleted_during_write_404(client, monkeypatch):
    """Temuan akhir #3: note dibuang/dihapus saat PATCH menulis → 404, bukan 500."""
    h, nid, _ = _setup(client)
    att = _init(client, h, nid, 12).json()["id"]
    orig = webapp._media_write_chunk

    def write_then_delete(path, offset, data):
        orig(path, offset, data)
        _delete_row(att)
    monkeypatch.setattr(webapp, "_media_write_chunk", write_then_delete)
    r = _patch(client, h, att, 0, b"hello")
    assert r.status_code == 404 and r.json()["detail"] == "Media tidak ditemukan"
    assert att not in webapp._media_upload_locks


def test_complete_row_deleted_during_complete_404_no_orphan(client, monkeypatch):
    """Temuan akhir #3: baris hilang saat complete → 404 dan file yang sudah dipindah dihapus."""
    calls, keys = [], []
    monkeypatch.setattr(webapp.media_worker, "enqueue", lambda i: calls.append(i))
    orig_key = webapp.new_key
    monkeypatch.setattr(webapp, "new_key", lambda ext, now: keys.append(orig_key(ext, now)) or keys[-1])
    h, nid, _ = _setup(client)
    att = _init(client, h, nid, len(MP4)).json()["id"]
    assert _patch(client, h, att, 0, MP4).status_code == 200
    orig_head = webapp._media_read_head

    def head_then_delete(path):
        head = orig_head(path)
        _delete_row(att)
        return head
    monkeypatch.setattr(webapp, "_media_read_head", head_then_delete)
    r = client.post(f"/api/media/{att}/complete", headers=h)
    assert r.status_code == 404 and r.json()["detail"] == "Media tidak ditemukan"
    assert len(keys) == 1 and not (Path(webapp.MEDIA_ROOT) / keys[0]).exists()
    assert not _part(att).exists()
    assert calls == []


def test_init_strips_control_chars_from_filename_and_docx_export_ok(client):
    """Temuan akhir #5: karakter kontrol C0/C1 dibuang dari nama (python-docx menolaknya → ekspor 500)."""
    import io
    import docx
    h = auth(client, _uniq("cc"))
    cid = _uniq("c")
    nid = make_note(client, h, "n", f"::media[{cid}]")["id"]
    dirty = "ra\x00pat\x07\x1b\x7f\x85\x9f\tfinal\n.mp3"
    r = _init(client, h, nid, 5, cid=cid, filename=dirty, mime="audio/mpeg")
    assert r.status_code == 200, r.text
    assert r.json()["original_name"] == "rapatfinal.mp3"
    assert _row(r.json()["id"])["original_name"] == "rapatfinal.mp3"
    # ekstensi dicek dari nama yang sudah bersih
    assert _init(client, h, nid, 5, filename="\x01\x02.mp3", mime="").json()["original_name"] == ".mp3"
    assert _init(client, h, nid, 5, filename="a.mp\x003", mime="").json()["original_name"] == "a.mp3"
    # karakter non-XML lain (U+FFFE/U+FFFF, surrogate tunggal dari JSON "\\ud800") juga dibuang
    assert _init(client, h, nid, 5, filename="b\ufffe\uffff.mp3", mime="").json()["original_name"] == "b.mp3"
    raw = '{"client_id": "%s", "filename": "s\\ud800x.mp3", "size": 5, "mime": ""}' % _uniq("c")
    r2 = client.post(f"/api/scratchpad/{nid}/media", headers={**h, "Content-Type": "application/json"}, content=raw)
    assert r2.status_code == 200 and r2.json()["original_name"] == "sx.mp3"
    c = db()
    try:
        c.execute("UPDATE note_attachments SET status='ready', storage_key=?, media_type='audio' WHERE id=?",
                  ("2026/10/12345678-1234-1234-1234-123456789abc.mp3", r.json()["id"]))
        c.commit()
    finally:
        c.close()
    d = client.get(f"/api/scratchpad/{nid}/export/docx", headers=h)
    assert d.status_code == 200
    text = "\n".join(p.text for p in docx.Document(io.BytesIO(d.content)).paragraphs)
    assert "rapatfinal.mp3" in text


@pytest.mark.parametrize("err,code,detail", [
    (errno.ENOSPC, 507, "Penyimpanan server penuh"),
    (errno.EACCES, 503, "Penyimpanan media tidak tersedia"),
    (errno.EROFS, 503, "Penyimpanan media tidak tersedia"),
])
def test_init_tmp_not_writable_no_row(client, monkeypatch, err, code, detail):
    """Temuan akhir #6: .part dibuat sebelum baris di-commit; gagal → 507/503 tanpa baris."""
    h, nid, _ = _setup(client)

    def boom(att_id):
        raise OSError(err, "tidak bisa menulis")
    monkeypatch.setattr(webapp.media_storage, "temp_path", boom)
    cid = _uniq("c")
    r = _init(client, h, nid, 10, cid=cid)
    assert r.status_code == code and r.json()["detail"] == detail
    c = db()
    try:
        assert c.execute("SELECT COUNT(*) FROM note_attachments WHERE note_id=?", (nid,)).fetchone()[0] == 0
    finally:
        c.close()
    monkeypatch.undo()
    r = _init(client, h, nid, 10, cid=cid)  # client_id yang sama bisa dipakai lagi
    assert r.status_code == 200 and _part(r.json()["id"]).exists()


def test_patch_missing_part_resets_to_zero_409_no_sparse_file(client, monkeypatch):
    """Temuan akhir #7: .part hilang saat offset > 0 → received_bytes 0 + 409, tanpa file sparse."""
    h, nid, _ = _setup(client)
    att = _init(client, h, nid, 12).json()["id"]
    assert _patch(client, h, att, 0, b"hello").status_code == 200
    _part(att).unlink()
    r = _patch(client, h, att, 5, b"-world!")
    assert r.status_code == 409 and r.json()["received_bytes"] == 0
    assert _row(att)["received_bytes"] == 0
    assert not _part(att).exists()
    assert client.get(f"/api/media/{att}/upload", headers=h).json()["received_bytes"] == 0
    # klien mengulang dari 0
    assert _patch(client, h, att, 0, b"hello").status_code == 200
    assert _patch(client, h, att, 5, b"-world!").status_code == 200
    assert _part(att).read_bytes() == b"hello-world!"
    # .part hilang di antara cek dan tulis: tetap tidak membuat file sparse
    att2 = _init(client, h, nid, 12).json()["id"]
    assert _patch(client, h, att2, 0, b"hello").status_code == 200
    orig = webapp._media_write_chunk

    def unlink_then_write(path, offset, data):
        path.unlink()
        orig(path, offset, data)
    monkeypatch.setattr(webapp, "_media_write_chunk", unlink_then_write)
    r = _patch(client, h, att2, 5, b"-world!")
    assert r.status_code == 409 and r.json()["received_bytes"] == 0
    assert _row(att2)["received_bytes"] == 0 and not _part(att2).exists()


def test_init_concurrent_same_client_id_integrity_error(client, monkeypatch):
    """Temuan akhir #8: init lain menyisipkan client_id yang sama di antara cek dan INSERT →
    aturan idempoten yang sama (note sama → baris itu, note lain → 409), bukan 500."""
    h, nid, name = _setup(client)
    n2 = make_note(client, h, "n2", "c")["id"]
    uid = uid_of(name)
    inserted = []

    def racer(target_note, cid):
        def quota(conn, u, size):
            c = db()
            try:
                cur = c.execute(
                    "INSERT INTO note_attachments (note_id, user_id, nextcloud_path, original_name, file_size, "
                    "mime_type, created_at, kind, client_id, storage, status, received_bytes, updated_at) "
                    "VALUES (?, ?, '', 'a.mp4', 10, 'application/octet-stream', '2026-10-20T00:00:00', "
                    "'media', ?, 'local', 'uploading', 0, '2026-10-20T00:00:00')", (target_note, uid, cid))
                c.commit()
                inserted.append(cur.lastrowid)
            finally:
                c.close()
        return quota

    cid = _uniq("c")
    monkeypatch.setattr(webapp, "_media_quota_check", racer(nid, cid))
    r = _init(client, h, nid, 10, cid=cid)
    assert r.status_code == 200, r.text
    assert r.json()["id"] == inserted[-1] and r.json()["status"] == "uploading"
    cid2 = _uniq("c")
    monkeypatch.setattr(webapp, "_media_quota_check", racer(n2, cid2))
    r = _init(client, h, nid, 10, cid=cid2)
    assert r.status_code == 409 and r.json()["detail"] == "client_id sudah dipakai"
    c = db()
    try:
        assert c.execute("SELECT COUNT(*) FROM note_attachments WHERE client_id IN (?, ?)",
                         (cid, cid2)).fetchone()[0] == 2
    finally:
        c.close()
