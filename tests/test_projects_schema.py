"""Skema `projects` + backfill dari tasks.project (PR 4, Task 1)."""
import sqlite3
import uuid

import pytest

import repository
from conftest import db


@pytest.fixture
def conn():
    c = db()
    c.execute("PRAGMA foreign_keys=ON")
    repository.ensure_projects_schema(c)
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


def _task(conn, user_id, project, list_id=None, status="inbox",
          created="2026-01-01T00:00:00", updated="2026-01-01T00:00:00"):
    cur = conn.execute(
        "INSERT INTO tasks(title, gtd_status, project, user_id, list_id, created_at, updated_at) "
        "VALUES (?,?,?,?,?,?,?)",
        ("t", status, project, user_id, list_id, created, updated))
    conn.commit()
    return cur.lastrowid


def _row(conn, tid):
    return conn.execute("SELECT * FROM tasks WHERE id=?", (tid,)).fetchone()


def test_backfill_groups_by_scope_and_case(conn):
    u = _user(conn)
    u2 = _user(conn)
    w = _workspace(conn, u)
    name = _uniq("Proj")
    t1 = _task(conn, u, name, created="2026-01-01T00:00:00", updated="2026-01-02T00:00:00")
    t2 = _task(conn, u, f"  {name.lower()} ", created="2026-01-02T00:00:00", updated="2026-03-01T00:00:00")
    tw1 = _task(conn, u, name, list_id=w, created="2026-01-05T00:00:00", updated="2026-01-05T00:00:00")
    tw2 = _task(conn, u2, name.upper(), list_id=w, created="2026-01-03T00:00:00", updated="2026-01-06T00:00:00")

    repository.backfill_projects(conn)

    r1, r2, rw1, rw2 = (_row(conn, t) for t in (t1, t2, tw1, tw2))
    assert r1["project_id"] == r2["project_id"] is not None
    assert rw1["project_id"] == rw2["project_id"] is not None
    assert r1["project_id"] != rw1["project_id"]

    pp = conn.execute("SELECT * FROM projects WHERE id=?", (r1["project_id"],)).fetchone()
    assert pp["user_id"] == u and pp["list_id"] is None
    assert pp["name"] == name.lower()          # ejaan task updated_at terbaru (ter-strip)
    assert pp["created_by"] == u
    pw = conn.execute("SELECT * FROM projects WHERE id=?", (rw1["project_id"],)).fetchone()
    assert pw["list_id"] == w and pw["user_id"] is None
    assert pw["name"] == name.upper()
    assert pw["created_by"] == u2              # task tertua di grup (created_at)

    # teks diseragamkan ke nama kanonis, updated_at tak berubah
    assert r1["project"] == name.lower() and r2["project"] == name.lower()
    assert r1["updated_at"] == "2026-01-02T00:00:00"
    assert r2["updated_at"] == "2026-03-01T00:00:00"
    assert rw1["project"] == name.upper() and rw1["updated_at"] == "2026-01-05T00:00:00"


def test_backfill_archives_projects_without_active_tasks(conn):
    u = _user(conn)
    done_name, active_name, mixed_name = _uniq("Done"), _uniq("Act"), _uniq("Mix")
    _task(conn, u, done_name, status="done")
    _task(conn, u, active_name, status="next")
    _task(conn, u, mixed_name, status="archived")
    _task(conn, u, mixed_name, status="inbox")
    # project yang sudah ada tanpa task aktif: tidak diubah
    pre = _uniq("Pre")
    cur = conn.execute(
        "INSERT INTO projects(name, user_id, archived, created_by, created_at, updated_at) "
        "VALUES (?,?,0,?,?,?)", (pre, u, u, "2026-01-01T00:00:00", "2026-01-01T00:00:00"))
    pre_id = cur.lastrowid
    _task(conn, u, pre.lower(), status="done")
    conn.commit()

    res = repository.backfill_projects(conn)
    assert res["created"] >= 3

    def arch(n):
        return conn.execute("SELECT archived FROM projects WHERE user_id=? AND name=? COLLATE NOCASE",
                            (u, n)).fetchone()["archived"]
    assert arch(done_name) == 1
    assert arch(active_name) == 0
    assert arch(mixed_name) == 0
    assert arch(pre) == 0
    # task terhubung ke project yang sudah ada, teks dikanonkan
    t = conn.execute("SELECT project, project_id FROM tasks WHERE user_id=? AND project=?", (u, pre)).fetchone()
    assert t["project_id"] == pre_id


def test_backfill_deleted_workspace_is_personal(conn):
    u = _user(conn)
    ghost = 987654321  # shared_lists tak ada
    name = _uniq("Ghost")
    t = _task(conn, u, name, list_id=ghost)
    repository.backfill_projects(conn)
    pid = _row(conn, t)["project_id"]
    p = conn.execute("SELECT * FROM projects WHERE id=?", (pid,)).fetchone()
    assert p["user_id"] == u and p["list_id"] is None and p["created_by"] == u


def test_backfill_idempotent_and_picks_up_new_tasks(conn):
    u = _user(conn)
    name = _uniq("Idem")
    t1 = _task(conn, u, name)
    repository.backfill_projects(conn)
    pid = _row(conn, t1)["project_id"]
    n_before = conn.execute("SELECT COUNT(*) c FROM projects WHERE user_id=?", (u,)).fetchone()["c"]

    # run kedua: tak ada yang diproses untuk task ini
    repository.backfill_projects(conn)
    assert conn.execute("SELECT COUNT(*) c FROM projects WHERE user_id=?", (u,)).fetchone()["c"] == n_before

    # task baru dari kode lama (project_id NULL) + project baru
    t2 = _task(conn, u, name.upper())
    other = _uniq("Other")
    t3 = _task(conn, u, other)
    res = repository.backfill_projects(conn)
    assert res["linked"] >= 2
    assert _row(conn, t2)["project_id"] == pid
    assert _row(conn, t2)["project"] == name
    assert _row(conn, t3)["project_id"] is not None
    assert conn.execute("SELECT COUNT(*) c FROM projects WHERE user_id=?", (u,)).fetchone()["c"] == n_before + 1

    # task tanpa project dilewati
    t4 = _task(conn, u, "   ")
    repository.backfill_projects(conn)
    assert _row(conn, t4)["project_id"] is None


def test_schema_constraints(conn):
    u = _user(conn)
    w = _workspace(conn, u)
    now = "2026-01-01T00:00:00"

    def ins(name, user_id, list_id):
        conn.execute(
            "INSERT INTO projects(name, user_id, list_id, created_by, created_at, updated_at) "
            "VALUES (?,?,?,?,?,?)", (name, user_id, list_id, u, now, now))

    with pytest.raises(sqlite3.IntegrityError):
        ins("both", u, w)
    with pytest.raises(sqlite3.IntegrityError):
        ins("none", None, None)
    conn.rollback()

    ins("Alpha", u, None)
    with pytest.raises(sqlite3.IntegrityError):
        ins("alpha", u, None)
    conn.rollback()
    ins("Alpha", None, w)          # scope lain boleh
    with pytest.raises(sqlite3.IntegrityError):
        ins("ALPHA", None, w)
    conn.rollback()

    ins("Beta", None, w)
    conn.commit()
    pid = conn.execute("SELECT id FROM projects WHERE list_id=? AND name='Beta'", (w,)).fetchone()["id"]
    tid = _task(conn, u, "Beta", list_id=w)
    conn.execute("UPDATE tasks SET project_id=? WHERE id=?", (pid, tid))
    conn.commit()
    conn.execute("DELETE FROM shared_lists WHERE id=?", (w,))
    conn.commit()
    assert conn.execute("SELECT COUNT(*) c FROM projects WHERE list_id=?", (w,)).fetchone()["c"] == 0
    assert _row(conn, tid)["project_id"] is None
