"""Komentar note Task 6: sinyal SSE perubahan komentar."""
import asyncio
import os

import webapp
from note_comment_helpers import U, private_note, shared_note
from repository import TaskRepository


def _recorder(monkeypatch):
    calls = []

    async def rec(nid, event):
        calls.append((nid, event))
    monkeypatch.setattr(webapp, "_note_comment_broadcast", rec)
    return calls


def test_writes_broadcast_signal(client, monkeypatch):
    calls = _recorder(monkeypatch)
    a, b = U(client, "nclv1a"), U(client, "nclv1b")
    nid, _ = shared_note(a, [b], "Live Komentar 1")
    expected = (nid, {"type": "comments_changed", "note_id": nid})

    r = b.post(f"/api/scratchpad/{nid}/comments", json={"body": "halo", "client_id": "live-1"})
    assert r.status_code == 200
    cid = r.json()["id"]
    assert calls == [expected]
    # duplikat client_id: tidak ada baris berubah -> tidak ada sinyal
    assert b.post(f"/api/scratchpad/{nid}/comments", json={"body": "halo", "client_id": "live-1"}).status_code == 200
    assert len(calls) == 1

    assert b.patch(f"/api/note-comments/{cid}", json={"body": "edit"}).status_code == 200
    assert len(calls) == 2 and calls[-1] == expected
    assert a.patch(f"/api/note-comments/{cid}", json={"resolved": True}).status_code == 200
    assert len(calls) == 3 and calls[-1] == expected
    assert b.delete(f"/api/note-comments/{cid}").status_code == 200
    assert len(calls) == 4 and calls[-1] == expected
    # hapus ulang (sudah tombstone): tak ada yang berubah -> tak ada sinyal
    assert b.delete(f"/api/note-comments/{cid}").status_code == 200
    assert len(calls) == 4
    for _, ev in calls:
        assert set(ev) == {"type", "note_id"}


def test_failed_write_does_not_broadcast(client, monkeypatch):
    calls = _recorder(monkeypatch)
    a, b = U(client, "nclv2a"), U(client, "nclv2b")
    nid, _ = shared_note(a, [b], "Live Komentar 2")
    assert b.post(f"/api/scratchpad/{nid}/comments", json={"body": "   "}).status_code == 422
    assert calls == []


def test_broadcast_access_lost(client):
    a, b = U(client, "nclv3a"), U(client, "nclv3b")
    nid, lid = shared_note(a, [b], "Live Komentar 3")
    qa, qb = asyncio.Queue(maxsize=100), asyncio.Queue(maxsize=100)
    webapp.note_comment_subscribers[nid].add((a.id, qa))
    webapp.note_comment_subscribers[nid].add((b.id, qb))
    TaskRepository(os.environ["DB_PATH"]).remove_list_member(lid, b.id)
    ev = {"type": "comments_changed", "note_id": nid}
    asyncio.run(webapp._note_comment_broadcast(nid, ev))
    assert qa.get_nowait() == ev
    assert qb.get_nowait() == {"type": "comments_access_lost", "note_id": nid}
    assert (b.id, qb) not in webapp.note_comment_subscribers[nid]
    assert (a.id, qa) in webapp.note_comment_subscribers[nid]
    webapp.note_comment_subscribers.pop(nid, None)


def test_broadcast_private_note_counts_as_lost(client):
    a, b = U(client, "nclv4a"), U(client, "nclv4b")
    nid, lid = shared_note(a, [b], "Live Komentar 4")
    qb = asyncio.Queue(maxsize=100)
    webapp.note_comment_subscribers[nid].add((b.id, qb))
    with webapp.get_db() as conn:
        conn.execute("UPDATE scratchpad_notes SET list_id = NULL WHERE id = ?", (nid,))
    asyncio.run(webapp._note_comment_broadcast(nid, {"type": "comments_changed", "note_id": nid}))
    assert qb.get_nowait()["type"] == "comments_access_lost"
    webapp.note_comment_subscribers.pop(nid, None)


def test_stream_404(client):
    a, b, c = U(client, "nclv5a"), U(client, "nclv5b"), U(client, "nclv5c")
    nid, _ = shared_note(a, [b], "Live Komentar 5")
    assert c.get(f"/api/scratchpad/{nid}/comments/stream").status_code == 404
    pid = private_note(a, "Live Komentar 5 pribadi")
    assert a.get(f"/api/scratchpad/{pid}/comments/stream").status_code == 404
    assert a.get("/api/scratchpad/99999999/comments/stream").status_code == 404
