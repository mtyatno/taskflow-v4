"""Skema `contexts` + backfill dari tasks.context (kanban context stages, Task 1)."""
import sqlite3
import uuid

import pytest

import repository


@pytest.fixture
def conn(tmp_path):
    """DB SQLite terisolasi per tes (bukan DB test bersama): hitungan global backfill deterministik."""
    path = str(tmp_path / "contexts_schema.db")
    repository.TaskRepository(path)  # membuat seluruh skema (termasuk contexts)
    c = sqlite3.connect(path)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA foreign_keys=ON")
    repository.ensure_contexts_schema(c)
    yield c
    c.close()


def _uniq(p="u"):
    return f"{p}{uuid.uuid4().hex[:10]}"


def _user(conn):
    cur = conn.execute(
        "INSERT INTO users(username, password_hash, created_at) VALUES (?,?,?)",
        (_uniq("bf"), "x", "2026-01-01T00:00:00"))
    conn.commit()
    return cur.lastrowid


def _workspace(conn, owner):
    cur = conn.execute(
        "INSERT INTO shared_lists(name, owner_id, created_at) VALUES (?,?,?)",
        (_uniq("ws"), owner, "2026-01-01T00:00:00"))
    conn.commit()
    return cur.lastrowid


def _task(conn, user_id, context, list_id=None, status="inbox",
          created="2026-01-01T00:00:00", updated="2026-01-01T00:00:00"):
    cur = conn.execute(
        "INSERT INTO tasks(title, gtd_status, context, user_id, list_id, created_at, updated_at) "
        "VALUES (?,?,?,?,?,?,?)",
        ("t", status, context, user_id, list_id, created, updated))
    conn.commit()
    return cur.lastrowid


def _row(conn, tid):
    return conn.execute("SELECT * FROM tasks WHERE id=?", (tid,)).fetchone()


def _ctx(conn, user_id=None, list_id=None, name="x", position=0, archived=0):
    cur = conn.execute(
        "INSERT INTO contexts(name, user_id, list_id, position, archived, created_at, updated_at) "
        "VALUES (?,?,?,?,?,?,?)",
        (name, user_id, list_id, position, archived, "2026-01-01T00:00:00", "2026-01-01T00:00:00"))
    conn.commit()
    return cur.lastrowid


def _personal(conn, u):
    return conn.execute(
        "SELECT * FROM contexts WHERE user_id=? AND list_id IS NULL ORDER BY position, name COLLATE NOCASE, id",
        (u,)).fetchall()


def test_schema_idempotent(conn):
    repository.ensure_contexts_schema(conn)
    repository.ensure_contexts_schema(conn)
    cols = {r[1] for r in conn.execute("PRAGMA table_info(contexts)").fetchall()}
    assert {"position", "color", "archived", "created_by"} <= cols
    tcols = {r[1] for r in conn.execute("PRAGMA table_info(tasks)").fetchall()}
    assert "context_id" in tcols


def test_check_constraint_scope(conn):
    u = _user(conn)
    w = _workspace(conn, u)
    with pytest.raises(sqlite3.IntegrityError):
        _ctx(conn, user_id=u, list_id=w, name="both")
    with pytest.raises(sqlite3.IntegrityError):
        _ctx(conn, name="neither")


def test_unique_nocase_per_scope(conn):
    u, u2 = _user(conn), _user(conn)
    w = _workspace(conn, u)
    _ctx(conn, user_id=u, name="@Home")
    with pytest.raises(sqlite3.IntegrityError):
        _ctx(conn, user_id=u, name="@home")
    _ctx(conn, user_id=u2, name="@home")
    _ctx(conn, list_id=w, name="@home")


def test_backfill_personal_alpha_positions(conn):
    u = _user(conn)
    ids = [_task(conn, u, n) for n in ("b", "A", "c")]
    res = repository.backfill_contexts(conn)
    assert res["created"] == 3 and res["linked"] == 3
    rows = _personal(conn, u)
    assert [(r["name"], r["position"]) for r in rows] == [("A", 0), ("b", 1), ("c", 2)]
    by_id = {r["id"]: r["name"] for r in rows}
    for tid in ids:
        t = _row(conn, tid)
        assert t["context_id"] is not None
        assert t["context"] == by_id[t["context_id"]]


def test_backfill_appends_after_existing(conn):
    u = _user(conn)
    _ctx(conn, user_id=u, name="Z", position=5)
    _task(conn, u, "m")
    _task(conn, u, "a")
    repository.backfill_contexts(conn)
    got = {r["name"]: r["position"] for r in _personal(conn, u)}
    assert got == {"Z": 5, "a": 6, "m": 7}


def test_backfill_spelling_from_newest_task(conn):
    u = _user(conn)
    t1 = _task(conn, u, "review", updated="2026-01-01T00:00:00")
    t2 = _task(conn, u, "Review", updated="2026-02-01T00:00:00")
    repository.backfill_contexts(conn)
    rows = _personal(conn, u)
    assert [r["name"] for r in rows] == ["Review"]
    assert _row(conn, t1)["context"] == "Review"
    assert _row(conn, t2)["context"] == "Review"
    assert _row(conn, t1)["context_id"] == _row(conn, t2)["context_id"] == rows[0]["id"]


def test_backfill_archived_when_no_active(conn):
    u = _user(conn)
    t1 = _task(conn, u, "old", status="done")
    t2 = _task(conn, u, "old", status="archived")
    t3 = _task(conn, u, "live", status="inbox")
    repository.backfill_contexts(conn)
    got = {r["name"]: r["archived"] for r in _personal(conn, u)}
    assert got == {"old": 1, "live": 0}
    assert _row(conn, t1)["context_id"] is not None
    assert _row(conn, t2)["context_id"] == _row(conn, t1)["context_id"]
    assert _row(conn, t3)["context_id"] is not None


def test_backfill_workspace_scope_and_created_by(conn):
    u1, u2 = _user(conn), _user(conn)
    w = _workspace(conn, u1)
    _task(conn, u1, "@team", list_id=w, created="2026-01-05T00:00:00")
    _task(conn, u2, "@Team", list_id=w, created="2026-01-03T00:00:00")
    repository.backfill_contexts(conn)
    rows = conn.execute("SELECT * FROM contexts WHERE list_id=?", (w,)).fetchall()
    assert len(rows) == 1
    assert rows[0]["user_id"] is None
    assert rows[0]["created_by"] == u2
    assert _personal(conn, u1) == [] and _personal(conn, u2) == []


def test_backfill_idempotent_and_no_updated_at_bump(conn):
    u = _user(conn)
    tids = [_task(conn, u, n, updated="2026-01-02T00:00:00") for n in ("a", "B")]
    first = repository.backfill_contexts(conn)
    assert first["created"] == 2
    snap = [tuple(r) for r in conn.execute("SELECT * FROM contexts ORDER BY id").fetchall()]
    upd = [_row(conn, t)["updated_at"] for t in tids]
    second = repository.backfill_contexts(conn)
    assert second == {"created": 0, "linked": 0, "cleared": 0, "skipped": 0}
    assert snap == [tuple(r) for r in conn.execute("SELECT * FROM contexts ORDER BY id").fetchall()]
    assert upd == [_row(conn, t)["updated_at"] for t in tids] == ["2026-01-02T00:00:00"] * 2


def test_backfill_fixes_stale_link(conn):
    u, u2 = _user(conn), _user(conn)
    other_name = _ctx(conn, user_id=u, name="other")
    other_scope = _ctx(conn, user_id=u2, name="work")
    t1 = _task(conn, u, "work")
    conn.execute("UPDATE tasks SET context_id=? WHERE id=?", (other_name, t1))
    t2 = _task(conn, u, "work")
    conn.execute("UPDATE tasks SET context_id=? WHERE id=?", (other_scope, t2))
    t3 = _task(conn, u, "")
    conn.execute("UPDATE tasks SET context_id=? WHERE id=?", (other_name, t3))
    conn.commit()
    res = repository.backfill_contexts(conn)
    assert res["cleared"] == 1
    mine = {r["name"]: r["id"] for r in _personal(conn, u)}
    assert _row(conn, t1)["context_id"] == mine["work"]
    assert _row(conn, t2)["context_id"] == mine["work"]
    assert mine["work"] != other_scope
    assert _row(conn, t3)["context_id"] is None


def test_backfill_skips_orphans(conn):
    conn.execute("PRAGMA foreign_keys=OFF")
    t = _task(conn, None, "ghost", list_id=987654)
    t2 = _task(conn, 987655, "ghost2")
    res = repository.backfill_contexts(conn)
    assert res["created"] == 0
    assert _row(conn, t)["context_id"] is None
    assert _row(conn, t2)["context_id"] is None


def test_backfill_resyncs_case_only_drift(conn):
    u = _user(conn)
    cid = _ctx(conn, user_id=u, name="Work")
    t1 = _task(conn, u, "work", updated="2026-01-02T00:00:00")
    t2 = _task(conn, u, "  Work ", updated="2026-01-02T00:00:00")
    conn.execute("UPDATE tasks SET context_id=?", (cid,))
    conn.commit()
    repository.backfill_contexts(conn)
    for t in (t1, t2):
        r = _row(conn, t)
        assert r["context"] == "Work"
        assert r["context_id"] == cid
        assert r["updated_at"] == "2026-01-02T00:00:00"
    assert len(_personal(conn, u)) == 1
    assert repository.backfill_contexts(conn) == {"created": 0, "linked": 0, "cleared": 0, "skipped": 0}
