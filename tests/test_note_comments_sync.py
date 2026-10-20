"""Komentar note: baca, delta pull, siklus hidup (Task 3)."""
from datetime import datetime, timedelta, timezone

import os

from conftest import db
from note_comment_helpers import U, private_note, shared_note
from note_comments import make_cursor
from repository import TaskRepository


def _post(u, nid, body="halo", **kw):
    r = u.post(f"/api/scratchpad/{nid}/comments", json={"body": body, **kw})
    assert r.status_code == 200, r.text
    return r.json()


def _pull(u, since="", limit=None):
    params = {"since": since}
    if limit is not None:
        params["limit"] = limit
    r = u.get("/api/note-comments", params=params)
    assert r.status_code == 200, r.text
    return r.json()


def _count_note(nid):
    conn = db()
    try:
        return conn.execute("SELECT COUNT(*) FROM note_comments WHERE note_id = ?", (nid,)).fetchone()[0]
    finally:
        conn.close()


def _reads(nid):
    conn = db()
    try:
        return conn.execute("SELECT COUNT(*) FROM note_comment_reads WHERE note_id = ?", (nid,)).fetchone()[0]
    finally:
        conn.close()


def _add_read(uid, nid):
    conn = db()
    conn.execute("INSERT INTO note_comment_reads (user_id, note_id, last_read_at) VALUES (?, ?, ?)",
                 (uid, nid, "2030-01-01T00:00:00+07:00"))
    conn.commit()
    conn.close()


def test_list_per_note_excludes_tombstones(client):
    a = U(client, "ncs1a")
    nid, _ = shared_note(a, [], "ncs1 note")
    c1, c2 = _post(a, nid, "satu"), _post(a, nid, "dua")
    assert a.delete(f"/api/note-comments/{c1['id']}").status_code == 200
    r = a.get(f"/api/scratchpad/{nid}/comments")
    assert r.status_code == 200
    assert [x["id"] for x in r.json()] == [c2["id"]]


def test_list_per_note_access(client):
    a, c = U(client, "ncs1xa"), U(client, "ncs1xc")
    nid, _ = shared_note(a, [], "ncs1x note")
    assert c.get(f"/api/scratchpad/{nid}/comments").status_code == 404
    pid = private_note(a, "ncs1x priv")
    r = a.get(f"/api/scratchpad/{pid}/comments")
    assert r.status_code == 200 and r.json() == []


def test_delta_pull_pages(client):
    a = U(client, "ncs2a")
    nid, _ = shared_note(a, [], "ncs2 note")
    ids = {_post(a, nid, f"k{i}")["id"] for i in range(5)}
    seen, since, pages = [], "", 0
    while True:
        j = _pull(a, since, 2)
        pages += 1
        assert set(j) == {"items", "cursor", "more"}
        seen += [x["id"] for x in j["items"]]
        since = j["cursor"]
        if not j["more"]:
            break
        assert pages < 10
    assert pages == 3 and len(seen) == 5 and set(seen) == ids


def test_delta_same_timestamp_boundary(client):
    a = U(client, "ncs3a")
    nid, _ = shared_note(a, [], "ncs3 note")
    c1, c2 = _post(a, nid, "x"), _post(a, nid, "y")
    ts = "2030-01-01T00:00:00+07:00"
    conn = db()
    conn.execute("UPDATE note_comments SET updated_at = ? WHERE id IN (?, ?)", (ts, c1["id"], c2["id"]))
    conn.commit()
    conn.close()
    seen, since = [], make_cursor("2029-12-31T00:00:00+07:00", 0)
    for _ in range(5):
        j = _pull(a, since, 1)
        seen += [x["id"] for x in j["items"]]
        since = j["cursor"]
        if not j["more"]:
            break
    assert sorted(seen) == sorted([c1["id"], c2["id"]])


def test_delta_includes_tombstone(client):
    a = U(client, "ncs4a")
    nid, _ = shared_note(a, [], "ncs4 note")
    c = _post(a, nid, "akan dihapus", quote="kutipan")
    cur = _pull(a)["cursor"]
    assert a.delete(f"/api/note-comments/{c['id']}").status_code == 200
    j = _pull(a, cur)
    assert len(j["items"]) == 1
    it = j["items"][0]
    assert it["id"] == c["id"] and it["deleted_at"] and it["body"] == "" and it["quote"] is None


def test_delta_reset_old_cursor(client):
    a = U(client, "ncs5a")
    old = (datetime.now(timezone(timedelta(hours=7))) - timedelta(days=40)).isoformat()
    j = _pull(a, make_cursor(old, 1))
    assert j == {"reset": True, "items": [], "cursor": "", "more": False}


def test_delta_malformed_since_and_limit(client):
    a = U(client, "ncs5xa")
    nid, _ = shared_note(a, [], "ncs5x note")
    c = _post(a, nid, "x")
    assert c["id"] in [x["id"] for x in _pull(a, "sampah")["items"]]

    nid2, _ = shared_note(a, [], "ncs5x note2")
    _post(a, nid2, "y")
    assert len(_pull(a, "", 0)["items"]) == 1  # limit dibatasi ke >= 1
    assert _pull(a, "", 5000)["items"]  # limit dibatasi ke <= 1000, tanpa error
    j = _pull(a, "", 1)
    assert len(j["items"]) == 1 and j["more"] is True


def test_delta_since_with_space_equals_plus(client):
    a = U(client, "ncs5ya")
    nid, _ = shared_note(a, [], "ncs5y note")
    _post(a, nid, "satu")
    cur = _pull(a)["cursor"]
    assert "+" in cur
    c2 = _post(a, nid, "dua")
    enc = _pull(a, cur)
    spc = _pull(a, cur.replace("+", " "))
    assert [x["id"] for x in spc["items"]] == [x["id"] for x in enc["items"]] == [c2["id"]]


def test_delta_hides_invisible(client):
    a, b, c = U(client, "ncs6a"), U(client, "ncs6b"), U(client, "ncs6c")
    nid, _ = shared_note(a, [b], "ncs6 note")
    cm = _post(a, nid, "rahasia")
    assert cm["id"] in [x["id"] for x in _pull(b)["items"]]
    assert cm["id"] not in [x["id"] for x in _pull(c)["items"]]


def test_unshare_reshare_other_workspace(client):
    a = U(client, "ncs7a")
    nid, lid = shared_note(a, [], "ncs7 note")
    cm = _post(a, nid, "x")
    put = lambda lst: a.put(f"/api/scratchpad/{nid}", json={"title": "ncs7 note", "content": "isi", "list_id": lst})
    assert put(None).status_code == 200
    assert a.get(f"/api/scratchpad/{nid}/comments").json() == []
    assert cm["id"] not in [x["id"] for x in _pull(a)["items"]]
    assert put(lid).status_code == 200
    assert [x["id"] for x in a.get(f"/api/scratchpad/{nid}/comments").json()] == [cm["id"]]
    assert cm["id"] in [x["id"] for x in _pull(a)["items"]]
    repo = TaskRepository(os.environ["DB_PATH"])
    w2 = repo.create_shared_list("WS ncs7 dua", a.id)
    assert put(w2["id"]).status_code == 200
    assert a.get(f"/api/scratchpad/{nid}/comments").json() == []
    assert cm["id"] not in [x["id"] for x in _pull(a)["items"]]


def test_trash_restore_purge(client):
    a = U(client, "ncs8a")
    n1, _ = shared_note(a, [], "ncs8 one")
    n2, _ = shared_note(a, [], "ncs8 two")
    _post(a, n1, "x")
    _post(a, n2, "y")
    _add_read(a.id, n1)
    _add_read(a.id, n2)
    assert a.delete(f"/api/scratchpad/{n1}").status_code == 200
    assert a.get(f"/api/scratchpad/{n1}/comments").status_code == 404
    assert a.post(f"/api/scratchpad/trash/{n1}/restore").status_code == 200
    assert len(a.get(f"/api/scratchpad/{n1}/comments").json()) == 1
    assert a.delete(f"/api/scratchpad/{n1}").status_code == 200
    assert a.delete(f"/api/scratchpad/trash/{n1}").status_code == 200
    assert _count_note(n1) == 0
    assert _reads(n1) == 0
    assert _count_note(n2) == 1  # note lain tidak tersentuh
    assert a.delete(f"/api/scratchpad/{n2}").status_code == 200
    assert a.delete("/api/scratchpad/trash").status_code == 200
    assert _count_note(n2) == 0
    assert _reads(n2) == 0


def test_lazy_retention_purge_removes_comments(client):
    a = U(client, "ncs10a")
    nid, _ = shared_note(a, [], "ncs10 note")
    _post(a, nid, "x")
    _add_read(a.id, nid)
    assert a.delete(f"/api/scratchpad/{nid}").status_code == 200
    conn = db()
    conn.execute("UPDATE trashed_notes SET deleted_at = ? WHERE note_id = ?",
                 ((datetime.now(timezone(timedelta(hours=7))) - timedelta(days=400)).isoformat(), nid))
    conn.commit()
    conn.close()
    assert a.get("/api/scratchpad/trash").status_code == 200  # memicu lazy purge
    assert _count_note(nid) == 0 and _reads(nid) == 0


def test_touch_on_reshare_and_restore_reaches_old_cursor(client):
    a = U(client, "ncs11a")
    nid, lid = shared_note(a, [], "ncs11 note")
    cm = _post(a, nid, "x")
    cur = _pull(a)["cursor"]
    assert a.patch(f"/api/scratchpad/{nid}/share", json={"list_id": None}).status_code == 200
    assert _pull(a, cur)["items"] == []
    assert a.patch(f"/api/scratchpad/{nid}/share", json={"list_id": lid}).status_code == 200
    j = _pull(a, cur)
    assert [x["id"] for x in j["items"]] == [cm["id"]]
    # PUT dengan list_id berubah -> non-null
    cur = j["cursor"]
    put = lambda lst: a.put(f"/api/scratchpad/{nid}", json={"title": "ncs11 note", "content": "isi", "list_id": lst})
    assert put(None).status_code == 200
    assert _pull(a, cur)["items"] == []
    assert put(lid).status_code == 200
    j = _pull(a, cur)
    assert [x["id"] for x in j["items"]] == [cm["id"]]
    # trash -> restore
    cur = j["cursor"]
    assert a.delete(f"/api/scratchpad/{nid}").status_code == 200
    assert _pull(a, cur)["items"] == []
    assert a.post(f"/api/scratchpad/trash/{nid}/restore").status_code == 200
    assert [x["id"] for x in _pull(a, cur)["items"]] == [cm["id"]]


def test_moved_note_hidden_from_old_workspace_member(client):
    a, b = U(client, "ncs12a"), U(client, "ncs12b")
    nid, lid = shared_note(a, [b], "ncs12 note")
    cm = _post(a, nid, "x")
    assert cm["id"] in [x["id"] for x in _pull(b)["items"]]
    w2 = TaskRepository(os.environ["DB_PATH"]).create_shared_list("WS ncs12 dua", a.id)
    assert a.patch(f"/api/scratchpad/{nid}/share", json={"list_id": w2["id"]}).status_code == 200
    assert cm["id"] not in [x["id"] for x in _pull(b, "")["items"]]
    assert b.get(f"/api/scratchpad/{nid}/comments").status_code == 404


def test_delete_workspace_removes_comments(client):
    a = U(client, "ncs9a")
    nid, lid = shared_note(a, [], "ncs9 note")
    _post(a, nid, "x")
    conn = db()
    assert conn.execute("SELECT COUNT(*) FROM note_comments WHERE list_id = ?", (lid,)).fetchone()[0] == 1
    conn.close()
    assert TaskRepository(os.environ["DB_PATH"]).delete_shared_list(lid, a.id)
    conn = db()
    assert conn.execute("SELECT COUNT(*) FROM note_comments WHERE list_id = ?", (lid,)).fetchone()[0] == 0
    conn.close()


def test_quiet_cursor_advances_no_reset(client):
    a = U(client, "ncs20a")
    nid, _ = shared_note(a, [], "ncs20 note")
    c = _post(a, nid, "lama")
    old = (datetime.now(timezone(timedelta(hours=7))) - timedelta(days=31)).isoformat()
    conn = db()
    conn.execute("UPDATE note_comments SET updated_at = ? WHERE id = ?", (old, c["id"]))
    conn.commit()
    conn.close()
    j1 = _pull(a)
    assert [x["id"] for x in j1["items"]] == [c["id"]] and j1["more"] is False
    j2 = _pull(a, j1["cursor"])
    assert "reset" not in j2 and j2["items"] == []
    c2 = _post(a, nid, "baru")
    j3 = _pull(a, j2["cursor"])
    assert [x["id"] for x in j3["items"]] == [c2["id"]]
    j4 = _pull(a, j3["cursor"])
    assert "reset" not in j4 and j4["items"] == []


def test_malformed_since_returns_clean_cursor(client):
    a = U(client, "ncs21a")
    j = _pull(a, "sampah")
    assert j["cursor"] != "sampah" and "|" in j["cursor"]
    assert "reset" not in _pull(a, j["cursor"])


def test_new_member_receives_existing_comments(client):
    a, b = U(client, "ncs22a"), U(client, "ncs22b")
    nid, lid = shared_note(a, [], "ncs22 note")
    _post(a, nid, "sebelum bergabung")
    nid_b, _ = shared_note(b, [], "ncs22 note b")
    _post(b, nid_b, "aktivitas workspace lain")  # lebih baru dari komentar a
    cur = _pull(b)["cursor"]  # kursor b sudah melewati komentar a
    assert _pull(b, cur)["items"] == []
    TaskRepository(os.environ["DB_PATH"]).add_list_member(lid, b.id)
    j = _pull(b, cur)
    assert [x["body"] for x in j["items"]] == ["sebelum bergabung"]
