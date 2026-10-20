"""Task 2: resolve_task_context + jalur TaskRepository/bot (kanban context stages)."""
import os
import uuid

import pytest

import repository
from conftest import db
from models import Task


@pytest.fixture
def repo():
    r = repository.TaskRepository(os.environ["DB_PATH"])
    return r


@pytest.fixture
def conn(repo):
    c = db()
    c.execute("PRAGMA foreign_keys=ON")
    repository.ensure_contexts_schema(c)
    yield c
    c.close()


def _uniq(p="u"):
    return f"{p}{uuid.uuid4().hex[:10]}"


def _user(conn):
    cur = conn.execute(
        "INSERT INTO users(username, password_hash, created_at) VALUES (?,?,?)",
        (_uniq("cr"), "x", "2026-01-01T00:00:00"))
    conn.commit()
    return cur.lastrowid


def _workspace(conn, owner):
    cur = conn.execute(
        "INSERT INTO shared_lists(name, owner_id, created_at) VALUES (?,?,?)",
        (_uniq("ws"), owner, "2026-01-01T00:00:00"))
    conn.commit()
    return cur.lastrowid


def _member(conn, list_id, user_id):
    conn.execute("INSERT INTO list_members(list_id, user_id, joined_at) VALUES (?,?,?)",
                 (list_id, user_id, "2026-01-01T00:00:00"))
    conn.commit()


def _ctx(conn, user_id=None, list_id=None, name="x", position=0, archived=0):
    cur = conn.execute(
        "INSERT INTO contexts(name, user_id, list_id, position, archived, created_at, updated_at) "
        "VALUES (?,?,?,?,?,?,?)",
        (name, user_id, list_id, position, archived, "2026-01-01T00:00:00", "2026-01-01T00:00:00"))
    conn.commit()
    return cur.lastrowid


def _resolve(conn, uid, *, name=None, context_id=None, list_id=None, actor=None):
    r = repository.resolve_task_context(
        conn, owner_id=uid, list_id=list_id, name=name, context_id=context_id,
        actor_id=uid if actor is None else actor)
    conn.commit()
    return r


def _task_row(conn, tid):
    return conn.execute("SELECT * FROM tasks WHERE id=?", (tid,)).fetchone()


def test_resolve_creates_at_last_position(conn):
    u = _user(conn)
    for i in range(3):
        _ctx(conn, user_id=u, name=f"@c{i}", position=i)
    cid, name = _resolve(conn, u, name="@baru")
    row = conn.execute("SELECT * FROM contexts WHERE id=?", (cid,)).fetchone()
    assert name == "@baru" and row["position"] == 3 and row["created_by"] == u


def test_resolve_nocase_and_trim_same_row(conn):
    u = _user(conn)
    a = _resolve(conn, u, name="@Phone ")
    b = _resolve(conn, u, name="@phone")
    assert a == b == (a[0], "@Phone")
    n = conn.execute("SELECT COUNT(*) FROM contexts WHERE user_id=?", (u,)).fetchone()[0]
    assert n == 1


@pytest.mark.parametrize("by", ["name", "id"])
def test_resolve_reactivates_archived(conn, by):
    u = _user(conn)
    cid = _ctx(conn, user_id=u, name="@old", archived=1)
    if by == "name":
        _resolve(conn, u, name="@old")
    else:
        _resolve(conn, u, context_id=cid)
    assert conn.execute("SELECT archived FROM contexts WHERE id=?", (cid,)).fetchone()[0] == 0


def test_resolve_empty_returns_none(conn):
    u = _user(conn)
    assert _resolve(conn, u, name="  ") == (None, "")


def test_resolve_id_other_scope_raises(conn):
    u, other = _user(conn), _user(conn)
    w = _workspace(conn, u)
    w2 = _workspace(conn, other)
    c_other = _ctx(conn, user_id=other, name="@o")
    c_w2 = _ctx(conn, list_id=w2, name="@w2")
    with pytest.raises(repository.ContextScopeError):
        _resolve(conn, u, context_id=c_other)
    with pytest.raises(repository.ContextScopeError):
        _resolve(conn, u, context_id=c_w2, list_id=w)


def test_resolve_workspace_non_member_raises(conn):
    owner, stranger = _user(conn), _user(conn)
    w = _workspace(conn, owner)
    with pytest.raises(repository.ContextScopeError):
        _resolve(conn, stranger, name="@x", list_id=w)


def test_repo_add_links_context(conn, repo):
    u = _user(conn)
    t = repo.add(Task(title="x", context="@kantor"), u)
    row = _task_row(conn, t.id)
    c = conn.execute("SELECT * FROM contexts WHERE user_id=? AND name='@kantor'", (u,)).fetchone()
    assert c is not None and row["context_id"] == c["id"]


def test_repo_add_to_list_workspace_context(conn, repo):
    u = _user(conn)
    w = _workspace(conn, u)
    t = repo.add_to_list(Task(title="x", context="@ws"), u, w)
    row = _task_row(conn, t.id)
    c = conn.execute("SELECT * FROM contexts WHERE list_id=?", (w,)).fetchone()
    assert c is not None and c["name"] == "@ws" and row["context_id"] == c["id"]


def test_repo_update_unchanged_context_keeps_link(conn, repo):
    u = _user(conn)
    t = repo.add(Task(title="x", context="@kantor"), u)
    cid = _task_row(conn, t.id)["context_id"]
    conn.execute("UPDATE contexts SET archived=1 WHERE id=?", (cid,))
    conn.commit()
    t.title = "baru"
    repo.update(t)
    assert _task_row(conn, t.id)["context_id"] == cid
    assert conn.execute("SELECT archived FROM contexts WHERE id=?", (cid,)).fetchone()[0] == 1


def test_repo_update_changed_context_relinks(conn, repo):
    u = _user(conn)
    t = repo.add(Task(title="x", context="@kantor"), u)
    old = _task_row(conn, t.id)["context_id"]
    t.context = "@rumah"
    repo.update(t)
    new = _task_row(conn, t.id)["context_id"]
    assert new is not None and new != old
    t.context = ""
    repo.update(t)
    assert _task_row(conn, t.id)["context_id"] is None


def test_repo_update_non_member_text_only(conn, repo):
    u, member = _user(conn), _user(conn)
    w = _workspace(conn, u)
    _member(conn, w, member)
    t = repo.add_to_list(Task(title="x"), member, w)
    conn.execute("DELETE FROM list_members WHERE list_id=? AND user_id=?", (w, member))
    conn.commit()
    t.context = "@baru"
    repo.update(t)
    row = _task_row(conn, t.id)
    assert row["context_id"] is None and row["context"] == "@baru"
    # backfill_contexts (test lain) bersifat global: jangan tinggalkan task tak tertaut
    conn.execute("DELETE FROM tasks WHERE id=?", (t.id,))
    conn.commit()


def test_list_contexts_from_table_ordered(conn, repo):
    u = _user(conn)
    w = _workspace(conn, u)
    _ctx(conn, user_id=u, name="@z", position=0)
    _ctx(conn, user_id=u, name="@a", position=1)
    _ctx(conn, user_id=u, name="@arsip", position=2, archived=1)
    _ctx(conn, list_id=w, name="@ws", position=0)
    assert repo.list_contexts(u) == ["@z", "@a"]
