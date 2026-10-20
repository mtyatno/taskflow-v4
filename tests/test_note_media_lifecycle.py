"""Tes siklus hidup media: purge Sampah, unggahan macet, antre ulang."""
import os
import time
import uuid
from datetime import datetime, timedelta
from pathlib import Path

import webapp
from conftest import db
from drawing_ws_helpers import auth, make_note
from media_serve import sign_token

MP4 = b"\x00\x00\x00\x18ftypisom\x00\x00\x02\x00isomiso2" + b"\x00" * 16


def _uniq(p):
    return f"{p}{uuid.uuid4().hex[:8]}"


def _q(sql, *a):
    c = db()
    try:
        r = c.execute(sql, a).fetchall()
        c.commit()
        return r
    finally:
        c.close()


def _root():
    return Path(webapp.MEDIA_ROOT)


def _make(client, monkeypatch, user=None, status="ready"):
    monkeypatch.setattr(webapp.media_worker, "enqueue", lambda i: None)
    h = user or auth(client, _uniq("lc"))
    nid = make_note(client, h, "n", "c")["id"]
    att = client.post(f"/api/scratchpad/{nid}/media", headers=h,
                      json={"client_id": _uniq("c"), "filename": "clip.mp4", "size": len(MP4),
                            "mime": "video/mp4"}).json()["id"]
    assert client.patch(f"/api/media/{att}/upload", headers={**h, "Upload-Offset": "0"},
                        content=MP4).status_code == 200
    assert client.post(f"/api/media/{att}/complete", headers=h).status_code == 200
    key = _q("SELECT storage_key FROM note_attachments WHERE id=?", att)[0]["storage_key"]
    poster = key.rsplit(".", 1)[0] + ".poster.jpg"
    (_root() / poster).write_bytes(b"\xff\xd8JPEG")
    _q("UPDATE note_attachments SET status=?, poster_key=? WHERE id=?", status, poster, att)
    return h, nid, att, key, poster


def _tok(att):
    return sign_token(att, "play", int(time.time()) + 600, webapp.MEDIA_URL_SECRET_BYTES)


def _gone(*keys):
    return all(not (_root() / k).exists() for k in keys)


def test_delete_media_files_tolerates_partial_dict():
    webapp._delete_media_files({})
    webapp._delete_media_files({"id": 999999})
    webapp._delete_media_files({"storage_key": None, "poster_key": None, "id": 5})


def test_trash_hides_media_and_restore_brings_it_back(client, monkeypatch):
    h, nid, att, key, poster = _make(client, monkeypatch)
    tok = _tok(att)
    assert client.get(f"/media/{tok}").status_code == 200
    assert client.delete(f"/api/scratchpad/{nid}", headers=h).status_code == 200
    assert client.get(f"/api/media/{att}", headers=h).status_code == 404
    assert client.get(f"/media/{tok}").status_code == 404
    assert (_root() / key).exists()
    assert client.post(f"/api/scratchpad/trash/{nid}/restore", headers=h).status_code == 200
    assert client.get(f"/api/media/{att}", headers=h).status_code == 200
    assert client.get(f"/media/{_tok(att)}").status_code == 200
    assert (_root() / key).exists() and (_root() / poster).exists()


def test_purge_single_deletes_media_files(client, monkeypatch):
    h, nid, att, key, poster = _make(client, monkeypatch)
    (_root() / ".tmp").mkdir(parents=True, exist_ok=True)
    (_root() / ".tmp" / f"{att}.part").write_bytes(b"x")
    client.delete(f"/api/scratchpad/{nid}", headers=h)
    assert (_root() / key).exists()
    assert client.delete(f"/api/scratchpad/trash/{nid}", headers=h).status_code == 200
    assert _gone(key, poster, f".tmp/{att}.part")


def test_purge_single_other_user_keeps_media(client, monkeypatch):
    h, nid, att, key, poster = _make(client, monkeypatch)
    client.delete(f"/api/scratchpad/{nid}", headers=h)
    other = auth(client, _uniq("oth"))
    _q("UPDATE trashed_notes SET user_id=? WHERE note_id=?", "someone-else", nid)
    client.delete(f"/api/scratchpad/trash/{nid}", headers=other)
    assert (_root() / key).exists() and (_root() / poster).exists()
    assert _q("SELECT 1 FROM trashed_notes WHERE note_id=?", nid)


def test_empty_trash_deletes_media_files(client, monkeypatch):
    h, n1, a1, k1, p1 = _make(client, monkeypatch)
    _, n2, a2, k2, p2 = _make(client, monkeypatch, user=h)
    client.delete(f"/api/scratchpad/{n1}", headers=h)
    client.delete(f"/api/scratchpad/{n2}", headers=h)
    r = client.delete("/api/scratchpad/trash", headers=h)
    assert r.status_code == 200 and r.json()["deleted"] == 2
    assert _gone(k1, p1, k2, p2)


def test_empty_trash_keeps_other_users_media(client, monkeypatch):
    h, n1, a1, k1, p1 = _make(client, monkeypatch)
    h2, n2, a2, k2, p2 = _make(client, monkeypatch)
    client.delete(f"/api/scratchpad/{n1}", headers=h)
    client.delete(f"/api/scratchpad/{n2}", headers=h2)
    _q("UPDATE trashed_notes SET user_id='zzz' WHERE note_id=?", n2)
    client.delete("/api/scratchpad/trash", headers=h)
    assert _gone(k1, p1)
    assert (_root() / k2).exists() and (_root() / p2).exists()


def test_expired_purge_deletes_media_files(client, monkeypatch):
    h, nid, att, key, poster = _make(client, monkeypatch)
    client.delete(f"/api/scratchpad/{nid}", headers=h)
    old = (datetime.now(webapp._TZ_JKT) - timedelta(days=31)).isoformat()
    _q("UPDATE trashed_notes SET deleted_at=? WHERE note_id=?", old, nid)
    assert client.get("/api/scratchpad/trash", headers=h).status_code == 200
    assert not _q("SELECT 1 FROM trashed_notes WHERE note_id=?", nid)
    assert _gone(key, poster)


def test_purge_keeps_nextcloud_rows_untouched(client, monkeypatch):
    h, nid, att, key, poster = _make(client, monkeypatch)
    client.delete(f"/api/scratchpad/{nid}", headers=h)
    import json
    snap = json.loads(_q("SELECT snapshot_json FROM trashed_notes WHERE note_id=?", nid)[0][0])
    snap["attachments"].append({"id": 424242, "storage": "nextcloud", "storage_key": key,
                                "poster_key": poster, "kind": "file"})
    snap["attachments"][0]["storage"] = "nextcloud"  # semua nextcloud
    _q("UPDATE trashed_notes SET snapshot_json=? WHERE note_id=?", json.dumps(snap), nid)
    calls = []
    monkeypatch.setattr(webapp.media_storage, "delete", lambda k: calls.append(k))
    client.delete(f"/api/scratchpad/trash/{nid}", headers=h)
    assert calls == []
    assert (_root() / key).exists()


def test_purge_bad_snapshot_does_not_block(client, monkeypatch):
    h, nid, att, key, poster = _make(client, monkeypatch)
    client.delete(f"/api/scratchpad/{nid}", headers=h)
    _q("UPDATE trashed_notes SET snapshot_json=? WHERE note_id=?", "{not json", nid)
    assert client.delete(f"/api/scratchpad/trash/{nid}", headers=h).status_code == 200
    assert not _q("SELECT 1 FROM trashed_notes WHERE note_id=?", nid)


def test_purge_survives_file_delete_failure(client, monkeypatch):
    h, nid, att, key, poster = _make(client, monkeypatch)
    client.delete(f"/api/scratchpad/{nid}", headers=h)

    def boom(row):
        raise RuntimeError("x")
    monkeypatch.setattr(webapp, "_delete_media_files", boom)
    assert client.delete(f"/api/scratchpad/trash/{nid}", headers=h).status_code == 200
    assert not _q("SELECT 1 FROM trashed_notes WHERE note_id=?", nid)


def _utc_iso(hours_ago):
    return (datetime.utcnow() - timedelta(hours=hours_ago)).isoformat()


def test_stuck_upload_cleanup(client, monkeypatch):
    monkeypatch.setattr(webapp.media_worker, "enqueue", lambda i: None)
    h = auth(client, _uniq("st"))
    nid = make_note(client, h, "n", "c")["id"]
    ids = []
    for _ in range(2):
        a = client.post(f"/api/scratchpad/{nid}/media", headers=h,
                        json={"client_id": _uniq("c"), "filename": "a.mp4", "size": len(MP4)}).json()["id"]
        client.patch(f"/api/media/{a}/upload", headers={**h, "Upload-Offset": "0"}, content=MP4[:10])
        ids.append(a)
    old, fresh = ids
    _q("UPDATE note_attachments SET updated_at=? WHERE id=?", _utc_iso(25), old)
    _q("UPDATE note_attachments SET updated_at=? WHERE id=?", _utc_iso(1), fresh)
    part_old = _root() / ".tmp" / f"{old}.part"
    part_fresh = _root() / ".tmp" / f"{fresh}.part"
    assert part_old.exists() and part_fresh.exists()
    c = db()
    try:
        n = webapp._cleanup_stuck_media_uploads(c, datetime.utcnow())
        c.commit()
    finally:
        c.close()
    assert n == 1
    assert not _q("SELECT 1 FROM note_attachments WHERE id=?", old)
    assert _q("SELECT 1 FROM note_attachments WHERE id=?", fresh)
    assert not part_old.exists() and part_fresh.exists()


def test_orphan_part_older_than_limit_removed(client):
    tmp = _root() / ".tmp"
    tmp.mkdir(parents=True, exist_ok=True)
    orphan_old = tmp / "987001.part"
    orphan_new = tmp / "987002.part"
    for p in (orphan_old, orphan_new):
        p.write_bytes(b"x")
    past = time.time() - (webapp.MEDIA_STUCK_HOURS + 2) * 3600
    os.utime(orphan_old, (past, past))
    c = db()
    try:
        n = webapp._cleanup_stuck_media_uploads(c, datetime.utcnow())
    finally:
        c.close()
    assert n == 0
    assert not orphan_old.exists() and orphan_new.exists()
    orphan_new.unlink()


def test_old_part_with_processing_row_kept(client, monkeypatch):
    h, nid, att, key, poster = _make(client, monkeypatch, status="processing")
    part = _root() / ".tmp" / f"{att}.part"
    part.parent.mkdir(parents=True, exist_ok=True)
    part.write_bytes(b"x")
    past = time.time() - (webapp.MEDIA_STUCK_HOURS + 2) * 3600
    os.utime(part, (past, past))
    c = db()
    try:
        webapp._cleanup_stuck_media_uploads(c, datetime.utcnow())
    finally:
        c.close()
    assert part.exists()


def test_cleanup_never_raises(client):
    class Bad:
        def execute(self, *a, **k):
            raise RuntimeError("db")
    assert webapp._cleanup_stuck_media_uploads(Bad(), datetime.utcnow()) == 0


def test_restored_processing_row_requeued(client, monkeypatch):
    h, nid, att, key, poster = _make(client, monkeypatch, status="processing")
    client.delete(f"/api/scratchpad/{nid}", headers=h)
    assert client.post(f"/api/scratchpad/trash/{nid}/restore", headers=h).status_code == 200
    assert _q("SELECT status FROM note_attachments WHERE id=?", att)[0][0] == "processing"
    # keluarkan antrean lama agar hanya enqueue baru yang terhitung
    seen = []
    monkeypatch.setattr(webapp.media_worker, "enqueue", webapp.media_worker._queue.put)
    monkeypatch.setattr(webapp.media_worker, "process", lambda i: seen.append(i))
    webapp.media_worker.run_pending()
    seen.clear()
    assert webapp.media_worker.requeue_processing() >= 1
    webapp.media_worker.run_pending()
    assert att in seen
