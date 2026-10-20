"""Tes penyajian media: metadata, URL bertanda tangan, /media/{token}."""
import shutil
import subprocess
import time
import uuid
from pathlib import Path

import pytest

import webapp
from conftest import db
from drawing_ws_helpers import add_member, auth, make_note, uid_of, workspace
from media_probe import needs_faststart
from media_serve import sign_token

MP4 = b"\x00\x00\x00\x18ftypisom\x00\x00\x02\x00isomiso2" + b"\x00" * 16  # 36 byte
CSP = "sandbox; default-src 'none'"


def _uniq(p):
    return f"{p}{uuid.uuid4().hex[:8]}"


def _row(att):
    c = db()
    try:
        return c.execute("SELECT * FROM note_attachments WHERE id=?", (att,)).fetchone()
    finally:
        c.close()


def _set(att, **kw):
    c = db()
    try:
        sets = ", ".join(f"{k}=?" for k in kw)
        c.execute(f"UPDATE note_attachments SET {sets} WHERE id=?", (*kw.values(), att))
        c.commit()
    finally:
        c.close()


def _make_ready(client, monkeypatch, name="clip.mp4", with_poster=False):
    monkeypatch.setattr(webapp.media_worker, "enqueue", lambda i: None)
    h = auth(client, _uniq("sv"))
    nid = make_note(client, h, "n", "c")["id"]
    cid = _uniq("c")
    att = client.post(f"/api/scratchpad/{nid}/media", headers=h,
                      json={"client_id": cid, "filename": name, "size": len(MP4),
                            "mime": "video/mp4"}).json()["id"]
    r = client.patch(f"/api/media/{att}/upload", headers={**h, "Upload-Offset": "0"}, content=MP4)
    assert r.status_code == 200, r.text
    assert client.post(f"/api/media/{att}/complete", headers=h).status_code == 200
    poster_key = None
    if with_poster:
        poster_key = _row(att)["storage_key"].rsplit(".", 1)[0] + ".poster.jpg"
        (Path(webapp.MEDIA_ROOT) / poster_key).write_bytes(b"\xff\xd8JPEGDATA")
    _set(att, status="ready", poster_key=poster_key)
    return h, nid, att, cid


def _tok(att, variant="play", ttl=600):
    return sign_token(att, variant, int(time.time()) + ttl, webapp.MEDIA_URL_SECRET_BYTES)


def test_meta_requires_note_access(client, monkeypatch):
    h, nid, att, _ = _make_ready(client, monkeypatch)
    r = client.get(f"/api/media/{att}", headers=h)
    assert r.status_code == 200
    d = r.json()
    assert d["status"] == "ready" and d["play_url"].startswith("/media/")
    assert d["download_url"].startswith("/media/") and d["poster_url"] is None
    assert d["expires_at"] > int(time.time())
    owner = auth(client, _uniq("mo"))
    mname = _uniq("mm")
    mh = auth(client, mname)
    lid = workspace(client, owner, _uniq("ws"))
    add_member(lid, uid_of(mname))
    wn = make_note(client, owner, "w", "c", list_id=lid)
    wa = client.post(f"/api/scratchpad/{wn['id']}/media", headers=owner,
                     json={"client_id": _uniq("c"), "filename": "a.mp4", "size": 5}).json()["id"]
    assert client.get(f"/api/media/{wa}", headers=mh).status_code == 200
    out = client.get(f"/api/media/{wa}", headers=auth(client, _uniq("mx")))
    assert out.status_code == 404 and out.json()["detail"] == "Media tidak ditemukan"
    c = db()
    try:
        old = c.execute(
            "INSERT INTO note_attachments (note_id, user_id, nextcloud_path, original_name, "
            "file_size, mime_type, created_at, kind, storage, status) "
            "VALUES (?, ?, 'x', 'x.pdf', 1, 'application/pdf', 'now', 'file', 'nextcloud', 'ready')",
            (nid, _row(att)["user_id"])).lastrowid
        c.commit()
    finally:
        c.close()
    assert client.get(f"/api/media/{old}", headers=h).status_code == 404


def test_meta_poster_url_when_poster_key(client, monkeypatch):
    h, _, att, _ = _make_ready(client, monkeypatch, with_poster=True)
    assert client.get(f"/api/media/{att}", headers=h).json()["poster_url"].startswith("/media/")


def test_meta_urls_only_when_ready(client, monkeypatch):
    h, _, att, _ = _make_ready(client, monkeypatch)
    for st, err in (("uploading", None), ("processing", None), ("failed", "gagal baca")):
        _set(att, status=st, error=err)
        d = client.get(f"/api/media/{att}", headers=h).json()
        assert d["status"] == st and d["error"] == err
        assert d["play_url"] is None and d["poster_url"] is None
        assert d["download_url"] is None and d["expires_at"] is None


def test_by_client_scoped_to_note(client, monkeypatch):
    h, nid, att, cid = _make_ready(client, monkeypatch)
    r = client.get(f"/api/scratchpad/{nid}/media/by-client/{cid}", headers=h)
    assert r.status_code == 200 and r.json()["id"] == att and r.json()["play_url"]
    other = make_note(client, h, "n2", "c")["id"]
    r = client.get(f"/api/scratchpad/{other}/media/by-client/{cid}", headers=h)
    assert r.status_code == 404 and r.json()["detail"] == "Media tidak ditemukan"
    assert client.get(f"/api/scratchpad/{nid}/media/by-client/nope", headers=h).status_code == 404
    assert client.get(f"/api/scratchpad/{nid}/media/by-client/bad%20id!", headers=h).status_code == 404
    out = auth(client, _uniq("mx"))
    assert client.get(f"/api/scratchpad/{nid}/media/by-client/{cid}", headers=out).status_code == 404


def test_media_token_accel_headers(client, monkeypatch):
    _, _, att, _ = _make_ready(client, monkeypatch)
    monkeypatch.setattr(webapp, "MEDIA_ACCEL", True)
    key = _row(att)["storage_key"]
    r = client.get(f"/media/{_tok(att)}")
    assert r.status_code == 200 and r.content == b""
    assert r.headers["x-accel-redirect"] == "/_alurik_media/" + key
    assert r.headers["content-type"].split(";")[0] == "video/mp4"
    assert r.headers.get_list("x-content-type-options") == ["nosniff"]
    assert r.headers["content-security-policy"] == CSP
    assert r.headers["accept-ranges"] == "bytes"
    cc = r.headers["cache-control"]
    assert cc.startswith("private, max-age=") and 595 <= int(cc.split("=")[1]) <= 600
    assert r.headers["content-disposition"].startswith("inline;")


def test_media_token_python_range(client, monkeypatch):
    _, _, att, _ = _make_ready(client, monkeypatch)
    monkeypatch.setattr(webapp, "MEDIA_ACCEL", False)
    n = len(MP4)
    t = _tok(att)
    r = client.get(f"/media/{t}")
    assert r.status_code == 200 and r.content == MP4
    assert r.headers["content-length"] == str(n) and r.headers["accept-ranges"] == "bytes"
    r = client.get(f"/media/{t}", headers={"Range": "bytes=2-5"})
    assert r.status_code == 206 and r.content == MP4[2:6]
    assert r.headers["content-range"] == f"bytes 2-5/{n}" and r.headers["content-length"] == "4"
    assert r.headers["content-security-policy"] == CSP
    assert r.headers.get_list("x-content-type-options") == ["nosniff"]
    r = client.get(f"/media/{t}", headers={"Range": f"bytes={n - 3}-"})
    assert r.status_code == 206 and r.content == MP4[-3:]
    r = client.get(f"/media/{t}", headers={"Range": f"bytes={n}-"})
    assert r.status_code == 416 and r.content == b""
    assert r.headers["content-range"] == f"bytes */{n}"


def test_media_token_uses_actual_file_size(client, monkeypatch):
    _, _, att, _ = _make_ready(client, monkeypatch)
    monkeypatch.setattr(webapp, "MEDIA_ACCEL", False)
    _set(att, file_size=999999)
    r = client.get(f"/media/{_tok(att)}")
    assert r.content == MP4 and r.headers["content-length"] == str(len(MP4))


def test_media_token_poster_and_download_variants(client, monkeypatch):
    _, _, att, _ = _make_ready(client, monkeypatch, name='kl"ip é.mp4', with_poster=True)
    monkeypatch.setattr(webapp, "MEDIA_ACCEL", False)
    r = client.get(f"/media/{_tok(att, 'poster')}")
    assert r.status_code == 200 and r.content == b"\xff\xd8JPEGDATA"
    assert r.headers["content-type"].split(";")[0] == "image/jpeg"
    assert r.headers["content-disposition"].startswith("inline;")
    assert ".jpg" in r.headers["content-disposition"]
    r = client.get(f"/media/{_tok(att, 'download')}")
    cd = r.headers["content-disposition"]
    assert r.status_code == 200 and cd.startswith("attachment;") and "filename*=UTF-8''" in cd
    assert r.headers["content-type"].split(";")[0] == "video/mp4"


def test_media_token_poster_without_poster_key_404(client, monkeypatch):
    _, _, att, _ = _make_ready(client, monkeypatch)
    r = client.get(f"/media/{_tok(att, 'poster')}")
    assert r.status_code == 404 and r.json()["detail"] == "Media tidak ditemukan"


def test_media_token_rejects_expired_tampered_deleted_or_not_ready(client, monkeypatch):
    _, _, att, _ = _make_ready(client, monkeypatch)
    monkeypatch.setattr(webapp, "MEDIA_ACCEL", False)
    good = _tok(att)
    assert client.get(f"/media/{good}").status_code == 200
    expired = sign_token(att, "play", int(time.time()) - 1, webapp.MEDIA_URL_SECRET_BYTES)
    assert client.get(f"/media/{expired}").status_code == 404
    assert client.get(f"/media/{good[:-2]}xx").status_code == 404
    assert client.get("/media/garbage").status_code == 404
    other = sign_token(att, "play", int(time.time()) + 60, b"other")
    assert client.get(f"/media/{other}").status_code == 404
    assert client.get(f"/media/{_tok(att + 9999)}").status_code == 404
    _set(att, status="processing")
    r = client.get(f"/media/{good}")
    assert r.status_code == 404 and r.json()["detail"] == "Media tidak ditemukan"
    _set(att, status="ready")
    Path(webapp.MEDIA_ROOT, _row(att)["storage_key"]).unlink()
    assert client.get(f"/media/{good}").status_code == 404
    c = db()
    try:
        c.execute("DELETE FROM note_attachments WHERE id=?", (att,))
        c.commit()
    finally:
        c.close()
    assert client.get(f"/media/{good}").status_code == 404


def test_media_token_not_bound_to_user(client, monkeypatch):
    _, _, att, _ = _make_ready(client, monkeypatch)
    monkeypatch.setattr(webapp, "MEDIA_ACCEL", False)
    client.cookies.clear()
    r = client.get(f"/media/{_tok(att)}")
    assert r.status_code == 200 and r.content == MP4


def test_media_token_head_accel(client, monkeypatch):
    _, _, att, _ = _make_ready(client, monkeypatch)
    monkeypatch.setattr(webapp, "MEDIA_ACCEL", True)
    key = _row(att)["storage_key"]
    r = client.head(f"/media/{_tok(att)}")
    assert r.status_code == 200 and r.content == b""
    assert r.headers["x-accel-redirect"] == "/_alurik_media/" + key
    assert r.headers["content-security-policy"] == CSP
    assert r.headers.get_list("x-content-type-options") == ["nosniff"]


def test_media_token_head_python_range(client, monkeypatch):
    _, _, att, _ = _make_ready(client, monkeypatch)
    monkeypatch.setattr(webapp, "MEDIA_ACCEL", False)
    n = len(MP4)
    t = _tok(att)
    r = client.head(f"/media/{t}", headers={"Range": "bytes=0-9"})
    assert r.status_code == 206 and r.content == b""
    assert r.headers["content-range"] == f"bytes 0-9/{n}" and r.headers["content-length"] == "10"
    assert r.headers["content-type"].split(";")[0] == "video/mp4"
    assert r.headers["content-disposition"].startswith("inline;")
    r = client.head(f"/media/{t}")
    assert r.status_code == 200 and r.content == b"" and r.headers["content-length"] == str(n)
    assert client.head(f"/media/{t}", headers={"Range": f"bytes={n}-"}).status_code == 416
    assert client.head("/media/garbage").status_code == 404
    # GET tidak berubah
    r = client.get(f"/media/{t}", headers={"Range": "bytes=0-9"})
    assert r.status_code == 206 and r.content == MP4[:10]


@pytest.mark.skipif(not (shutil.which("ffmpeg") and shutil.which("ffprobe")), reason="ffmpeg tidak terpasang")
def test_end_to_end_upload_process_and_range(client, monkeypatch, tmp_path):
    """Temuan akhir #13: init → PATCH bertahap → complete → worker sungguhan → ready → Range 206."""
    monkeypatch.setattr(webapp, "MEDIA_ACCEL", False)
    q = webapp.media_worker._queue
    while not q.empty():  # buang sisa antrean tes lain agar hanya lampiran ini yang diproses
        q.get_nowait()
    src = tmp_path / "clip.mp4"
    subprocess.run(
        ["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", "testsrc=duration=2:size=320x240:rate=15",
         "-f", "lavfi", "-i", "sine=frequency=440:duration=2", "-c:v", "libx264", "-c:a", "aac",
         "-pix_fmt", "yuv420p", "-shortest", str(src)], check=True)
    data = src.read_bytes()
    assert needs_faststart(src) is True  # worker sungguhan harus me-remux
    h = auth(client, _uniq("e2e"))
    nid = make_note(client, h, "n", "c")["id"]
    r = client.post(f"/api/scratchpad/{nid}/media", headers=h,
                    json={"client_id": _uniq("c"), "filename": "klip.mp4", "size": len(data), "mime": "video/mp4"})
    assert r.status_code == 200, r.text
    att = r.json()["id"]
    step = len(data) // 3 + 1
    for off in range(0, len(data), step):
        p = client.patch(f"/api/media/{att}/upload", headers={**h, "Upload-Offset": str(off)},
                         content=data[off:off + step])
        assert p.status_code == 200, p.text
    c = client.post(f"/api/media/{att}/complete", headers=h)
    assert c.status_code == 200 and c.json()["status"] == "processing", c.text
    assert webapp.media_worker.run_pending() == 1
    meta = client.get(f"/api/media/{att}", headers=h).json()
    assert meta["status"] == "ready", meta["error"]
    assert meta["media_type"] == "video" and meta["mime_type"] == "video/mp4"
    assert 1800 <= meta["duration_ms"] <= 2300 and (meta["width"], meta["height"]) == (320, 240)
    assert meta["play_url"] and meta["poster_url"]
    stored = Path(webapp.MEDIA_ROOT) / _row(att)["storage_key"]
    assert needs_faststart(stored) is False
    g = client.get(meta["play_url"], headers={"Range": "bytes=0-99"})
    assert g.status_code == 206
    assert g.headers["content-range"] == f"bytes 0-99/{stored.stat().st_size}"
    assert g.headers["content-type"] == "video/mp4" and g.content == stored.read_bytes()[:100]
    assert len(g.content) == 100
    pg = client.get(meta["poster_url"])
    assert pg.status_code == 200 and pg.headers["content-type"] == "image/jpeg" and pg.content[:2] == b"\xff\xd8"
