"""Komentar note: endpoint tulis + hak akses (Task 2)."""
from conftest import db
from note_comment_helpers import U, private_note, shared_note


def _count(note_id):
    conn = db()
    try:
        return conn.execute("SELECT COUNT(*) FROM note_comments WHERE note_id = ?", (note_id,)).fetchone()[0]
    finally:
        conn.close()


def _row(cid):
    conn = db()
    try:
        return conn.execute("SELECT * FROM note_comments WHERE id = ?", (cid,)).fetchone()
    finally:
        conn.close()


def _post(u, nid, body="halo", **kw):
    return u.post(f"/api/scratchpad/{nid}/comments", json={"body": body, **kw})


def test_owner_and_member_can_comment(client):
    a, b = U(client, "nca1a"), U(client, "nca1b")
    nid, lid = shared_note(a, [b], "nca1 note")
    for u in (a, b):
        r = _post(u, nid, "isi komentar", quote="kutipan")
        assert r.status_code == 200, r.text
        j = r.json()
        assert j["note_id"] == nid and j["list_id"] == lid and j["user_id"] == u.id
        assert j["username"] == u.name and j["body"] == "isi komentar"
        assert j["quote"] == "kutipan" and j["parent_id"] is None


def test_non_member_404(client):
    a, c = U(client, "nca2a"), U(client, "nca2c")
    nid, _ = shared_note(a, [], "nca2 note")
    assert _post(c, nid).status_code == 404
    assert _count(nid) == 0


def test_private_note_409(client):
    a = U(client, "nca3a")
    nid = private_note(a, "nca3 note")
    r = _post(a, nid)
    assert r.status_code == 409
    assert r.json()["detail"]["code"] == "NOTE_NOT_SHARED"


def test_body_validation(client):
    a, b = U(client, "nca4a"), U(client, "nca4b")
    nid, _ = shared_note(a, [b], "nca4 note")
    assert _post(a, nid, "   ").status_code == 422
    assert _post(a, nid, "x" * 4001).status_code == 422
    assert _post(a, nid, "x" * 4000).status_code == 200
    assert _post(a, nid, "ok", quote="q" * 501).status_code == 422
    assert _post(a, nid, "ok", client_id="c" * 65).status_code == 422
    cid = _post(a, nid, "asli").json()["id"]
    assert a.patch(f"/api/note-comments/{cid}", json={}).status_code == 422
    assert a.patch(f"/api/note-comments/{cid}", json={"body": "x", "resolved": True}).status_code == 422
    assert a.patch(f"/api/note-comments/{cid}", json={"body": "  "}).status_code == 422
    assert _row(cid)["body"] == "asli"


def test_client_id_idempotent(client):
    a = U(client, "nca5a")
    nid, _ = shared_note(a, [], "nca5 note")
    r1 = _post(a, nid, "satu", client_id="c-1")
    r2 = _post(a, nid, "satu lagi", client_id="c-1")
    assert r1.status_code == 200 and r2.status_code == 200
    assert r1.json()["id"] == r2.json()["id"]
    assert r2.json()["body"] == "satu"
    assert _count(nid) == 1


def test_reply_flattened_and_quote_dropped(client):
    a, b = U(client, "nca6a"), U(client, "nca6b")
    nid, _ = shared_note(a, [b], "nca6 note")
    t = _post(a, nid, "thread", quote="kutip").json()["id"]
    r1 = _post(b, nid, "balas", parent_id=t, quote="abaikan")
    assert r1.status_code == 200
    assert r1.json()["parent_id"] == t and r1.json()["quote"] is None
    assert _row(r1.json()["id"])["quote"] is None
    r2 = _post(a, nid, "balas balasan", parent_id=r1.json()["id"])
    assert r2.status_code == 200 and r2.json()["parent_id"] == t
    assert _post(a, nid, "x", parent_id=t, quote="q" * 501).status_code == 422


def test_reply_to_deleted_thread_404(client):
    a, b = U(client, "nca7a"), U(client, "nca7b")
    nid, _ = shared_note(a, [b], "nca7 note")
    t = _post(a, nid, "thread").json()["id"]
    assert a.delete(f"/api/note-comments/{t}").status_code == 200
    n = _count(nid)
    assert _post(b, nid, "balas", parent_id=t).status_code == 404
    assert _count(nid) == n


def test_reply_to_other_notes_comment_404(client):
    a = U(client, "nca7xa")
    n1, _ = shared_note(a, [], "nca7x one")
    n2, _ = shared_note(a, [], "nca7x two")
    t = _post(a, n1, "thread").json()["id"]
    assert _post(a, n2, "balas", parent_id=t).status_code == 404
    assert _post(a, n2, "balas", parent_id=999999).status_code == 404


def test_comment_on_trashed_note_404(client):
    a = U(client, "nca8a")
    nid, _ = shared_note(a, [], "nca8 note")
    assert a.delete(f"/api/scratchpad/{nid}").status_code == 200
    assert _post(a, nid).status_code == 404
    assert _count(nid) == 0


def test_edit_only_author(client):
    a, b = U(client, "nca9a"), U(client, "nca9b")
    nid, _ = shared_note(a, [b], "nca9 note")
    cid = _post(b, nid, "punya b").json()["id"]
    r = b.patch(f"/api/note-comments/{cid}", json={"body": "diedit"})
    assert r.status_code == 200 and r.json()["body"] == "diedit" and r.json()["edited_at"]
    assert a.patch(f"/api/note-comments/{cid}", json={"body": "curang"}).status_code == 403
    assert _row(cid)["body"] == "diedit"


def test_resolve_rights(client):
    a, b, c = U(client, "nca10a"), U(client, "nca10b"), U(client, "nca10c")
    nid, _ = shared_note(a, [b, c], "nca10 note")
    t = _post(b, nid, "thread b").json()["id"]
    assert c.patch(f"/api/note-comments/{t}", json={"resolved": True}).status_code == 403
    r = b.patch(f"/api/note-comments/{t}", json={"resolved": True})
    assert r.status_code == 200
    assert r.json()["resolved_at"] and r.json()["resolved_by"] == b.id and r.json()["resolved_by_name"]
    r = a.patch(f"/api/note-comments/{t}", json={"resolved": False})
    assert r.status_code == 200 and r.json()["resolved_at"] is None and r.json()["resolved_by"] is None
    assert r.json()["resolved_by_name"] is None
    r = a.patch(f"/api/note-comments/{t}", json={"resolved": True})
    assert r.status_code == 200 and r.json()["resolved_by"] == a.id


def test_resolve_reply_422(client):
    a, b = U(client, "nca11a"), U(client, "nca11b")
    nid, _ = shared_note(a, [b], "nca11 note")
    t = _post(a, nid, "thread").json()["id"]
    rep = _post(b, nid, "balas", parent_id=t).json()
    before = _row(rep["id"])["updated_at"]
    r = a.patch(f"/api/note-comments/{rep['id']}", json={"resolved": True})
    assert r.status_code == 422
    assert r.json()["detail"] == "Hanya thread yang bisa diselesaikan"
    row = _row(rep["id"])
    assert row["resolved_at"] is None and row["updated_at"] == before


def test_delete_rights_and_cascade(client):
    a, b, c = U(client, "nca12a"), U(client, "nca12b"), U(client, "nca12c")
    nid, _ = shared_note(a, [b, c], "nca12 note")
    t = _post(b, nid, "thread b").json()["id"]
    rep = _post(c, nid, "balas c", parent_id=t).json()["id"]
    assert c.delete(f"/api/note-comments/{t}").status_code == 403
    mine = _post(c, nid, "milik c").json()["id"]
    assert c.delete(f"/api/note-comments/{mine}").status_code == 200
    assert _row(mine)["deleted_at"] and _row(mine)["body"] == ""
    assert a.delete(f"/api/note-comments/{t}").json() == {"ok": True}
    for cid in (t, rep):
        row = _row(cid)
        assert row["deleted_at"] and row["body"] == ""
    assert a.delete(f"/api/note-comments/{t}").status_code == 200


def test_patch_deleted_404(client):
    a = U(client, "nca13a")
    nid, _ = shared_note(a, [], "nca13 note")
    cid = _post(a, nid).json()["id"]
    a.delete(f"/api/note-comments/{cid}")
    assert a.patch(f"/api/note-comments/{cid}", json={"body": "x"}).status_code == 404


def test_writes_bump_updated_at_not_note(client):
    import time
    a = U(client, "nca14a")
    nid, _ = shared_note(a, [], "nca14 note")
    conn = db()
    note_before = conn.execute("SELECT updated_at FROM scratchpad_notes WHERE id=?", (nid,)).fetchone()[0]
    conn.close()
    cid = _post(a, nid).json()["id"]
    u0 = _row(cid)["updated_at"]
    time.sleep(0.01)
    a.patch(f"/api/note-comments/{cid}", json={"body": "baru"})
    assert _row(cid)["updated_at"] > u0
    conn = db()
    assert conn.execute("SELECT updated_at FROM scratchpad_notes WHERE id=?", (nid,)).fetchone()[0] == note_before
    conn.close()
