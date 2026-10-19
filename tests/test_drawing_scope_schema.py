"""Skema drawing milik workspace: kolom list_id/last_edited_by, backfill sekali jalan, hapus workspace.
Spec: docs/superpowers/specs/2026-10-18-workspace-drawing-project-design.md §4.1."""
import uuid

import drawing_scope
from conftest import db
from drawing_ws_helpers import auth, drawing_row, make_drawing, make_note, uid_of, workspace

FLAG = "drawing_list_backfill_v1"


def _u():
    return uuid.uuid4().hex[:8]


def _reset_backfill(conn):
    conn.execute("DELETE FROM app_meta WHERE key = ?", (FLAG,))
    conn.commit()


def _set_note_time(conn, note_id, ts):
    conn.execute("UPDATE scratchpad_notes SET updated_at = ? WHERE id = ?", (ts, note_id))
    conn.commit()


def _run_backfill():
    conn = db()
    try:
        res = drawing_scope.backfill_drawing_lists(conn, "2026-10-19T10:00:00+07:00")
        conn.commit()
        return res
    finally:
        conn.close()


def test_schema_columns_and_index():
    conn = db()
    try:
        cols = {r["name"] for r in conn.execute("PRAGMA table_info(drawings)")}
        assert {"list_id", "last_edited_by"} <= cols
        idx = {r["name"] for r in conn.execute("PRAGMA index_list(drawings)")}
        assert "idx_drawings_list" in idx
        drawing_scope.ensure_drawing_scope_schema(conn)  # idempoten
    finally:
        conn.close()


def test_backfill_moves_owner_drawing_into_note_workspace(client):
    a, b = f"a{_u()}", f"b{_u()}"
    ha, hb = auth(client, a), auth(client, b)
    w = workspace(client, ha, f"ws{_u()}")
    d1 = make_drawing(client, ha, "d1")
    cid = str(uuid.uuid4())
    d2 = make_drawing(client, ha, "d2", cid=cid)
    d3 = make_drawing(client, hb, "milik B")
    make_note(client, ha, "W", f"::draw[{d1['id']}] ::draw[{cid}] ::draw[{d3['id']}]", list_id=w)
    conn = db()
    try:
        conn.execute("UPDATE drawings SET updated_at = '2020-01-01T00:00:00' WHERE id IN (?, ?, ?)",
                     (d1["id"], d2["id"], d3["id"]))
        _reset_backfill(conn)
    finally:
        conn.close()
    res = _run_backfill()
    assert res["moved"] >= 2 and res["conflicts"] == []
    r1, r2, r3 = drawing_row(d1["id"]), drawing_row(d2["id"]), drawing_row(d3["id"])
    assert r1["list_id"] == w and r2["list_id"] == w
    assert r1["updated_at"] == "2026-10-19T10:00:00+07:00"
    assert r3["list_id"] is None and r3["updated_at"] == "2020-01-01T00:00:00"  # bukan milik penulis note
    assert uid_of(a) == r1["user_id"]


def test_backfill_runs_once(client):
    a = f"a{_u()}"
    ha = auth(client, a)
    w = workspace(client, ha, f"ws{_u()}")
    conn = db()
    try:
        _reset_backfill(conn)
    finally:
        conn.close()
    assert "skipped" not in _run_backfill()
    assert _run_backfill() == {"skipped": True}
    d = make_drawing(client, ha, "baru")
    make_note(client, ha, "W", f"::draw[{d['id']}]", list_id=w)
    assert _run_backfill() == {"skipped": True}
    assert drawing_row(d["id"])["list_id"] is None


def test_backfill_conflict_newest_note_wins(client):
    a = f"a{_u()}"
    ha = auth(client, a)
    w1, w2 = workspace(client, ha, f"w1{_u()}"), workspace(client, ha, f"w2{_u()}")
    d1 = make_drawing(client, ha, "d1")
    n1 = make_note(client, ha, "N1", f"::draw[{d1['id']}]", list_id=w1)
    n2 = make_note(client, ha, "N2", f"::draw[{d1['id']}]", list_id=w2)
    conn = db()
    try:
        _set_note_time(conn, n1["id"], "2030-01-02T00:00:00")
        _set_note_time(conn, n2["id"], "2030-01-01T00:00:00")
        _reset_backfill(conn)
    finally:
        conn.close()
    res = _run_backfill()
    assert drawing_row(d1["id"])["list_id"] == w1
    assert {"drawing_id": d1["id"], "kept_list_id": w1, "other_list_id": w2} in res["conflicts"]
    assert len([c for c in res["conflicts"] if c["drawing_id"] == d1["id"]]) == 1


def test_delete_workspace_reverts_drawing_and_bumps(client):
    a = f"a{_u()}"
    ha = auth(client, a)
    w = workspace(client, ha, f"ws{_u()}")
    d1 = make_drawing(client, ha, "d1")
    conn = db()
    try:
        conn.execute("UPDATE drawings SET list_id = ?, updated_at = '2020-01-01T00:00:00' WHERE id = ?",
                     (w, d1["id"]))
        conn.commit()
    finally:
        conn.close()
    r = client.delete(f"/api/lists/{w}", headers=ha)
    assert r.status_code == 200, r.text
    row = drawing_row(d1["id"])
    assert row["list_id"] is None and row["updated_at"] != "2020-01-01T00:00:00"


def test_access_clause_and_find_accessible(client):
    a, b, c = f"a{_u()}", f"b{_u()}", f"c{_u()}"
    ha, hb, hc = auth(client, a), auth(client, b), auth(client, c)
    w = workspace(client, ha, f"ws{_u()}")
    ub = uid_of(b)
    cid = str(uuid.uuid4())
    d = make_drawing(client, ha, "d", cid=cid)
    conn = db()
    try:
        conn.execute("UPDATE drawings SET list_id = ? WHERE id = ?", (w, d["id"]))
        conn.commit()
        assert drawing_scope.find_accessible(conn, str(d["id"]), ub) is None
        from drawing_ws_helpers import add_member
        add_member(w, ub)
        row = drawing_scope.find_accessible(conn, str(d["id"]), ub, "id, client_id")
        assert row["id"] == d["id"] and drawing_scope.refs_of(row) == {str(d["id"]), cid}
        assert drawing_scope.find_accessible(conn, cid, ub)["id"] == d["id"]
        assert drawing_scope.find_accessible(conn, cid, uid_of(c)) is None
        # client_id sama di dua user: milik sendiri didahulukan
        own = make_drawing(client, hb, "own", cid=cid)
        assert drawing_scope.find_accessible(conn, cid, ub)["id"] == own["id"]
    finally:
        conn.close()
