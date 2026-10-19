"""Sinkron note -> drawing di server (PR 2 Task 4, spec §4.4)."""
from conftest import db
from drawing_ws_helpers import auth, uid_of, make_drawing, make_note, workspace, add_member, drawing_row


def test_put_with_new_embed_moves_actor_drawing(client):
    ha = auth(client, "sync_a1")
    w = workspace(client, ha, "sync_w1")
    d = make_drawing(client, ha, "sync_d1", cid="sync-cid-1")
    n = make_note(client, ha, "sync_n1", "", list_id=w)
    assert n["moved_drawings"] == [] and n["unresolved_drawings"] == []
    before = drawing_row(d["id"])["updated_at"]
    r = client.put(f"/api/scratchpad/{n['id']}", json={"title": "sync_n1", "content": "::draw[sync-cid-1]"}, headers=ha)
    assert r.status_code == 200, r.text
    body = r.json()
    assert [m["id"] for m in body["moved_drawings"]] == [d["id"]]
    assert body["moved_drawings"][0]["list_id"] == w and body["moved_drawings"][0]["client_id"] == "sync-cid-1"
    assert body["unresolved_drawings"] == []
    row = drawing_row(d["id"])
    assert row["list_id"] == w and row["updated_at"] != before


def test_post_note_in_workspace_moves_drawing(client):
    ha = auth(client, "sync_a2")
    w = workspace(client, ha, "sync_w2")
    d = make_drawing(client, ha, "sync_d2")
    n = make_note(client, ha, "sync_n2", f"::draw[{d['id']}]", list_id=w)
    assert [m["id"] for m in n["moved_drawings"]] == [d["id"]]
    assert drawing_row(d["id"])["list_id"] == w


def test_post_idempotent_client_id_path_moves_drawing(client):
    ha = auth(client, "sync_a2b")
    w = workspace(client, ha, "sync_w2b")
    d = make_drawing(client, ha, "sync_d2b")
    r = client.post("/api/scratchpad", json={"title": "t", "content": "", "client_id": "sync-note-2b"}, headers=ha)
    assert r.status_code == 200 and r.json()["moved_drawings"] == []
    r = client.post("/api/scratchpad", json={"title": "t", "content": f"::draw[{d['id']}]", "client_id": "sync-note-2b",
                                             "list_id": w}, headers=ha)
    assert r.status_code == 200
    assert [m["id"] for m in r.json()["moved_drawings"]] == [d["id"]]
    assert drawing_row(d["id"])["list_id"] == w


def test_share_note_moves_drawings(client):
    ha = auth(client, "sync_a3")
    w = workspace(client, ha, "sync_w3")
    d1 = make_drawing(client, ha, "sync_d3", cid="sync-cid-3")
    n = make_note(client, ha, "sync_n3", f"::draw[{d1['id']}] ::draw[sync-cid-3]")
    assert n["moved_drawings"] == []
    r = client.patch(f"/api/scratchpad/{n['id']}/share", json={"list_id": w}, headers=ha)
    assert r.status_code == 200, r.text
    assert [m["id"] for m in r.json()["moved_drawings"]] == [d1["id"]]  # dedup: dua token, satu drawing
    assert drawing_row(d1["id"])["list_id"] == w


def test_member_edit_does_not_move_owner_drawing(client):
    ha = auth(client, "sync_a4")
    hb = auth(client, "sync_b4")
    w = workspace(client, ha, "sync_w4")
    add_member(w, uid_of("sync_b4"))
    d = make_drawing(client, ha, "sync_d4")
    n = make_note(client, ha, "sync_n4", "", list_id=w)
    r = client.put(f"/api/scratchpad/{n['id']}", json={"title": "sync_n4", "content": f"::draw[{d['id']}]"}, headers=hb)
    assert r.status_code == 200, r.text
    assert r.json()["moved_drawings"] == []
    assert r.json()["unresolved_drawings"] == [str(d["id"])]
    assert drawing_row(d["id"])["list_id"] is None


def test_other_workspace_drawing_untouched(client):
    ha = auth(client, "sync_a5")
    w = workspace(client, ha, "sync_w5")
    w2 = workspace(client, ha, "sync_w5b")
    d2 = make_drawing(client, ha, "sync_d5", list_id=w2)
    n = make_note(client, ha, "sync_n5", f"::draw[{d2['id']}]", list_id=w)
    assert n["moved_drawings"] == [] and n["unresolved_drawings"] == [str(d2["id"])]
    assert drawing_row(d2["id"])["list_id"] == w2


def test_same_list_drawing_skipped_and_missing_token_unresolved(client):
    ha = auth(client, "sync_a5c")
    w = workspace(client, ha, "sync_w5c")
    d = make_drawing(client, ha, "sync_d5c", list_id=w)
    n = make_note(client, ha, "sync_n5c", f"::draw[{d['id']}] ::draw[no-such-cid]", list_id=w)
    assert n["moved_drawings"] == [] and n["unresolved_drawings"] == ["no-such-cid"]


def test_personal_note_never_moves(client):
    ha = auth(client, "sync_a6")
    d = make_drawing(client, ha, "sync_d6")
    n = make_note(client, ha, "sync_n6", f"::draw[{d['id']}]")
    assert n["moved_drawings"] == [] and n["unresolved_drawings"] == []
    assert drawing_row(d["id"])["list_id"] is None


def test_escaped_directive_moves_drawing(client):
    ha = auth(client, "sync_a7")
    w = workspace(client, ha, "sync_w7")
    d = make_drawing(client, ha, "sync_d7", cid="sync-cid-7")
    n = make_note(client, ha, "sync_n7", "::draw\\[sync-cid-7\\]", list_id=w)
    assert [m["id"] for m in n["moved_drawings"]] == [d["id"]]
    assert drawing_row(d["id"])["list_id"] == w


def test_restore_from_trash_moves_drawing(client):
    ha = auth(client, "sync_a8")
    w = workspace(client, ha, "sync_w8")
    d = make_drawing(client, ha, "sync_d8")
    n = make_note(client, ha, "sync_n8", f"::draw[{d['id']}]", list_id=w)
    assert drawing_row(d["id"])["list_id"] == w
    assert client.delete(f"/api/scratchpad/{n['id']}", headers=ha).status_code == 200
    conn = db()
    try:
        conn.execute("UPDATE drawings SET list_id = NULL WHERE id = ?", (d["id"],))
        conn.commit()
    finally:
        conn.close()
    r = client.post(f"/api/scratchpad/trash/{n['id']}/restore", headers=ha)
    assert r.status_code == 200, r.text
    assert [m["id"] for m in r.json()["moved_drawings"]] == [d["id"]]
    assert drawing_row(d["id"])["list_id"] == w
