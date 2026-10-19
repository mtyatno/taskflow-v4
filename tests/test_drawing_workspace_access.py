"""Akses drawing milik workspace: daftar, detail, edit, pin, hapus, buat (PR 2 Task 2)."""
import uuid

from conftest import db
from drawing_ws_helpers import (add_member, auth, drawing_row, make_drawing, make_note, uid_of, workspace)


def _u():
    return uuid.uuid4().hex[:8]


def _setup(client):
    """A (pemilik), B (anggota), C (bukan anggota), workspace W dengan drawing milik A."""
    s = _u()
    names = {k: f"{k}{s}" for k in "abc"}
    h = {k: auth(client, n) for k, n in names.items()}
    w = workspace(client, h["a"], f"W{s}")
    add_member(w, uid_of(names["b"]))
    d = make_drawing(client, h["a"], f"Gbr{s}", list_id=w)
    return s, names, h, w, d


def test_member_can_get_and_put_workspace_drawing(client):
    s, names, h, w, d = _setup(client)
    assert client.get(f"/api/drawings/{d['id']}", headers=h["b"]).status_code == 200
    r = client.put(f"/api/drawings/{d['id']}", json={"title": "B edit"}, headers=h["b"])
    assert r.status_code == 200, r.text
    row = drawing_row(d["id"])
    assert row["title"] == "B edit"
    assert row["last_edited_by"] == uid_of(names["b"])
    got = client.get(f"/api/drawings/{d['id']}", headers=h["a"]).json()
    assert got["last_editor_username"] == names["b"]


def test_non_member_gets_404(client):
    s, names, h, w, d = _setup(client)
    i = d["id"]
    assert client.get(f"/api/drawings/{i}", headers=h["c"]).status_code == 404
    assert client.put(f"/api/drawings/{i}", json={"title": "x"}, headers=h["c"]).status_code == 404
    assert client.delete(f"/api/drawings/{i}", headers=h["c"]).status_code == 404
    assert client.patch(f"/api/drawings/{i}/pin", headers=h["c"]).status_code == 404


def test_removed_member_loses_access(client):
    s, names, h, w, d = _setup(client)
    assert client.get(f"/api/drawings/{d['id']}", headers=h["b"]).status_code == 200
    conn = db()
    conn.execute("DELETE FROM list_members WHERE list_id = ? AND user_id = ?", (w, uid_of(names["b"])))
    conn.commit()
    conn.close()
    assert client.get(f"/api/drawings/{d['id']}", headers=h["b"]).status_code == 404


def test_only_owner_can_delete_or_pin(client):
    s, names, h, w, d = _setup(client)
    i = d["id"]
    assert client.delete(f"/api/drawings/{i}", headers=h["b"]).status_code == 403
    assert client.patch(f"/api/drawings/{i}/pin", headers=h["b"]).status_code == 403
    assert client.patch(f"/api/drawings/{i}/pin", headers=h["a"]).status_code == 200
    assert client.delete(f"/api/drawings/{i}", headers=h["a"]).status_code == 200


def test_create_with_list_id_requires_membership(client):
    s, names, h, w, d = _setup(client)
    r = client.post("/api/drawings", json={"title": "x", "list_id": w}, headers=h["c"])
    assert r.status_code == 403
    assert r.json()["detail"] == "Bukan anggota list ini"
    r = client.post("/api/drawings", json={"title": "y", "list_id": w}, headers=h["a"])
    assert r.status_code == 200 and r.json()["list_id"] == w


def test_idempotent_create_keeps_list_id(client):
    s, names, h, w, d = _setup(client)
    cid = f"cid-{_u()}"
    first = make_drawing(client, h["a"], "t1", cid=cid, list_id=w)
    again = make_drawing(client, h["a"], "t2", cid=cid)
    assert again["id"] == first["id"] and again["list_id"] == w


def test_list_default_own_only_shared_flag_adds_workspace(client):
    s, names, h, w, d = _setup(client)
    own_b = make_drawing(client, h["b"], f"Milik B {s}")
    ids_b = {x["id"] for x in client.get("/api/drawings", headers=h["b"]).json()}
    assert d["id"] not in ids_b and own_b["id"] in ids_b
    shared = {x["id"]: x for x in client.get("/api/drawings?shared=1", headers=h["b"]).json()}
    assert d["id"] in shared and shared[d["id"]]["list_id"] == w and own_b["id"] in shared
    mine_a = {x["id"]: x for x in client.get("/api/drawings", headers=h["a"]).json()}
    assert mine_a[d["id"]]["list_id"] == w
    ids_c = {x["id"] for x in client.get("/api/drawings?shared=1", headers=h["c"]).json()}
    assert d["id"] not in ids_c


def test_client_id_lookup_prefers_own_row(client):
    s = _u()
    names = {k: f"{k}{s}" for k in "abd"}
    h = {k: auth(client, n) for k, n in names.items()}
    w = workspace(client, h["b"], f"W{s}")
    add_member(w, uid_of(names["a"]))
    add_member(w, uid_of(names["d"]))
    cid = f"cid-{s}"
    mine = make_drawing(client, h["a"], "pribadi A")
    theirs = make_drawing(client, h["b"], "ws B", list_id=w)
    conn = db()
    conn.execute("UPDATE drawings SET client_id = ? WHERE id IN (?, ?)", (cid, mine["id"], theirs["id"]))
    conn.commit()
    conn.close()
    assert client.get(f"/api/drawings/{cid}", headers=h["a"]).json()["id"] == mine["id"]
    assert client.get(f"/api/drawings/{cid}", headers=h["d"]).json()["id"] == theirs["id"]
    # pin/hapus lewat cid memilih baris milik sendiri
    assert client.patch(f"/api/drawings/{cid}/pin", headers=h["a"]).json()["id"] == mine["id"]
    assert client.delete(f"/api/drawings/{cid}", headers=h["a"]).status_code == 200
    assert drawing_row(theirs["id"]) is not None and drawing_row(mine["id"]) is None


def test_member_put_tags_stored_under_owner(client):
    s, names, h, w, d = _setup(client)
    tag = f"x{s}"
    r = client.put(f"/api/drawings/{d['id']}", json={"tags": [tag]}, headers=h["b"])
    assert r.status_code == 200 and r.json()["tags"] == [tag]
    conn = db()
    row = conn.execute(
        "SELECT et.user_id eu, t.user_id tu FROM entity_tags et JOIN tags t ON t.id = et.tag_id "
        "WHERE et.entity_type = 'drawing' AND et.entity_id = ? AND t.name = ?", (d["id"], tag)).fetchone()
    conn.close()
    assert row["eu"] == uid_of(names["a"]) and row["tu"] == uid_of(names["a"])


def test_linked_notes_only_viewer_accessible(client):
    s, names, h, w, d = _setup(client)
    ref = f"::draw[{d['id']}]"
    make_note(client, h["a"], f"Rahasia A {s}", f"x {ref}")
    make_note(client, h["a"], f"Catatan W {s}", f"y ::draw\\[{d['id']}\\]", list_id=w)
    b = client.get(f"/api/drawings/{d['id']}", headers=h["b"]).json()
    assert [n["title"] for n in b["linked_notes"]] == [f"Catatan W {s}"]
    a = client.get(f"/api/drawings/{d['id']}", headers=h["a"]).json()
    assert {n["title"] for n in a["linked_notes"]} == {f"Rahasia A {s}", f"Catatan W {s}"}


def test_search_includes_workspace_drawings(client):
    s, names, h, w, d = _setup(client)
    r = client.get(f"/api/search?q=Gbr{s}", headers=h["b"])
    assert d["id"] in [x["id"] for x in r.json()["drawings"]]
    r = client.get(f"/api/search?q=Gbr{s}", headers=h["c"])
    assert r.json()["drawings"] == []


def test_linked_notes_by_client_id_in_list_and_detail(client):
    s, names, h, w, d = _setup(client)
    cid = f"cid-{s}"
    conn = db()
    conn.execute("UPDATE drawings SET client_id = ? WHERE id = ?", (cid, d["id"]))
    conn.commit()
    conn.close()
    make_note(client, h["a"], f"Rahasia A {s}", f"::draw\\[{cid}\\]")
    make_note(client, h["a"], f"Catatan W {s}", f"::draw\\[{cid}\\]", list_id=w)
    detail = client.get(f"/api/drawings/{d['id']}", headers=h["b"]).json()
    assert [n["title"] for n in detail["linked_notes"]] == [f"Catatan W {s}"]
    listed = {x["id"]: x for x in client.get("/api/drawings?shared=1", headers=h["b"]).json()}
    assert [n["title"] for n in listed[d["id"]]["linked_notes"]] == [f"Catatan W {s}"]
    listed_a = {x["id"]: x for x in client.get("/api/drawings?shared=1", headers=h["a"]).json()}
    assert {n["title"] for n in listed_a[d["id"]]["linked_notes"]} == {f"Rahasia A {s}", f"Catatan W {s}"}
