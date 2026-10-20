"""Pin workspace per user: skema, seed sekali, pin/unpin, pembersihan saat keluar/hapus."""
import os
import uuid

import pytest

import repository
from conftest import db


@pytest.fixture
def repo():
    return repository.TaskRepository(os.environ["DB_PATH"])


@pytest.fixture
def conn(repo):
    c = db()
    c.execute("PRAGMA foreign_keys=ON")
    yield c
    c.close()


def _uniq(p="u"):
    return f"{p}{uuid.uuid4().hex[:10]}"


def _user(conn, seeded=0):
    cur = conn.execute(
        "INSERT INTO users(username, password_hash, created_at, workspace_pins_seeded) VALUES (?,?,?,?)",
        (_uniq("wp"), "x", "2026-01-01T00:00:00", seeded))
    conn.commit()
    return cur.lastrowid


def _ws(conn, owner, created="2026-01-01T00:00:00"):
    cur = conn.execute(
        "INSERT INTO shared_lists(name, owner_id, created_at) VALUES (?,?,?)",
        (_uniq("ws"), owner, created))
    conn.commit()
    return cur.lastrowid


def _task(conn, owner, list_id, updated):
    conn.execute(
        "INSERT INTO tasks(title, gtd_status, user_id, list_id, created_at, updated_at) "
        "VALUES (?,?,?,?,?,?)", ("t", "inbox", owner, list_id, updated, updated))
    conn.commit()


def _pins(conn, uid):
    return [(r["list_id"], r["position"]) for r in conn.execute(
        "SELECT list_id, position FROM workspace_pins WHERE user_id = ? ORDER BY position, list_id", (uid,))]


def _seeded(conn, uid):
    return conn.execute("SELECT workspace_pins_seeded FROM users WHERE id = ?", (uid,)).fetchone()[0]


def test_schema_idempotent(conn):
    repository.ensure_workspace_pins_schema(conn)
    repository.ensure_workspace_pins_schema(conn)
    pk = sorted(r["name"] for r in conn.execute("PRAGMA table_info(workspace_pins)") if r["pk"])
    assert pk == ["list_id", "user_id"]
    col = [r for r in conn.execute("PRAGMA table_info(users)") if r["name"] == "workspace_pins_seeded"]
    assert len(col) == 1 and str(col[0]["dflt_value"]) == "0"


def test_lists_carry_pin_fields(repo, conn):
    u = _user(conn, seeded=1)
    w = _ws(conn, u)
    before = repo.get_lists_for_user(u)
    assert before[0]["pinned"] is False and before[0]["pin_position"] is None
    repo.pin_workspace(u, w)
    after = repo.get_lists_for_user(u)
    assert after[0]["pinned"] is True and after[0]["pin_position"] == 0
    assert [x["id"] for x in after] == [x["id"] for x in before]


def test_pin_positions_and_idempotent(repo, conn):
    u = _user(conn)
    a, b = _ws(conn, u), _ws(conn, u)
    assert repo.pin_workspace(u, a) == 0
    assert repo.pin_workspace(u, b) == 1
    assert repo.pin_workspace(u, a) == 0
    assert len(_pins(conn, u)) == 2
    assert repo.unpin_workspace(u, a) is True
    assert repo.pin_workspace(u, a) == 2


def test_pin_limit(repo, conn):
    u = _user(conn)
    ws = [_ws(conn, u) for _ in range(6)]
    for w in ws[:5]:
        repo.pin_workspace(u, w)
    with pytest.raises(repository.PinLimitError):
        repo.pin_workspace(u, ws[5])
    assert len(_pins(conn, u)) == 5
    assert repo.pin_workspace(u, ws[2]) == 2


def test_unpin_returns_flag(repo, conn):
    u = _user(conn)
    w = _ws(conn, u)
    repo.pin_workspace(u, w)
    assert repo.unpin_workspace(u, w) is True
    assert repo.unpin_workspace(u, w) is False
    assert _seeded(conn, u) == 1


def test_seed_orders_by_task_activity_then_created(repo, conn):
    u = _user(conn)
    w1 = _ws(conn, u, "2026-01-01T00:00:00")
    w2 = _ws(conn, u, "2026-01-02T00:00:00")
    w3 = _ws(conn, u, "2026-01-03T00:00:00")
    w4 = _ws(conn, u, "2026-01-04T00:00:00")
    _task(conn, u, w1, "2026-05-02T00:00:00")
    _task(conn, u, w2, "2026-05-01T00:00:00")
    repo.get_lists_for_user(u)
    assert _pins(conn, u) == [(w1, 0), (w2, 1), (w4, 2)]
    assert _seeded(conn, u) == 1


def test_seed_runs_once_and_is_idempotent(repo, conn):
    u = _user(conn)
    for _ in range(4):
        _ws(conn, u)
    repo.get_lists_for_user(u)
    repo.get_lists_for_user(u)
    assert len(_pins(conn, u)) == 3
    for lid, _p in _pins(conn, u):
        repo.unpin_workspace(u, lid)
    repo.get_lists_for_user(u)
    assert _pins(conn, u) == []


def test_seed_skips_user_without_workspace(repo, conn):
    u = _user(conn)
    assert repo.get_lists_for_user(u) == []
    assert _seeded(conn, u) == 0
    w = _ws(conn, u)
    repo.get_lists_for_user(u)
    assert _pins(conn, u) == [(w, 0)]
    assert _seeded(conn, u) == 1


def test_manual_pin_before_seed_not_overwritten(repo, conn):
    u = _user(conn)
    ws = [_ws(conn, u) for _ in range(4)]
    repo.pin_workspace(u, ws[2])
    repo.get_lists_for_user(u)
    assert _pins(conn, u) == [(ws[2], 0)]


def test_leave_removes_pin(repo, conn):
    owner, m = _user(conn), _user(conn, seeded=1)
    w = _ws(conn, owner)
    repo.add_list_member(w, m)
    repo.pin_workspace(m, w)
    assert repo.remove_list_member(w, m) is True
    assert _pins(conn, m) == []


def test_rejoin_does_not_restore_pin(repo, conn):
    owner, m = _user(conn), _user(conn, seeded=1)
    w = _ws(conn, owner)
    repo.add_list_member(w, m)
    repo.pin_workspace(m, w)
    repo.remove_list_member(w, m)
    repo.add_list_member(w, m)
    items = repo.get_lists_for_user(m)
    assert items[0]["pinned"] is False


def test_delete_workspace_cascades_pins(repo, conn):
    owner = _user(conn)
    w = _ws(conn, owner)
    repo.pin_workspace(owner, w)
    assert repo.delete_shared_list(w, owner) is True
    assert conn.execute("SELECT COUNT(*) FROM workspace_pins WHERE list_id = ?", (w,)).fetchone()[0] == 0
