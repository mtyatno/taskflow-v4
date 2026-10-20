"""PR B Task 1: estimasi/realisasi Pomodoro dan POST /api/tasks/{id}/pomodoros (ADR-021)."""
import uuid
from datetime import datetime

import pytest

import webapp
from conftest import db, register_user


class U:
    def __init__(self, client):
        name = f"pm{uuid.uuid4().hex[:8]}"
        info = register_user(client, name, f"{name}@test.id")
        self.client = client
        self.id = info["user_id"]
        self.h = {"Authorization": f"Bearer {info['token']}"}

    def _call(self, method, url, **kw):
        self.client.cookies.clear()
        return getattr(self.client, method)(url, headers=self.h, **kw)

    def get(self, url, **kw): return self._call("get", url, **kw)
    def post(self, url, **kw): return self._call("post", url, **kw)
    def put(self, url, **kw): return self._call("put", url, **kw)
    def delete(self, url, **kw): return self._call("delete", url, **kw)


def _q(sql, *params):
    conn = db()
    try:
        return conn.execute(sql, params).fetchall()
    finally:
        conn.close()


def _mk(u, **body):
    body.setdefault("title", "t")
    r = u.post("/api/tasks", json=body)
    assert r.status_code == 200, r.text
    return r.json()


def _body(**over):
    b = {"client_id": uuid.uuid4().hex, "kind": "session", "pomodoros": 1, "focus_seconds": 1500,
         "log_date": "2026-10-20", "ended_at": "2026-10-20T09:30:00+07:00"}
    b.update(over)
    return b


def _log(u, tid, **over):
    return u.post(f"/api/tasks/{tid}/pomodoros", json=_body(**over))


@pytest.fixture
def u(client):
    return U(client)


def test_migration_adds_columns_and_table():
    webapp.migrate_db()
    webapp.migrate_db()
    cols = {r["name"]: r for r in _q("PRAGMA table_info(tasks)")}
    assert cols["estimated_pomodoros"]["dflt_value"] == "1"
    assert cols["pomodoros_done"]["dflt_value"] == "0"
    names = {r["name"] for r in _q("SELECT name FROM sqlite_master WHERE type IN ('table','index')")}
    assert {"pomodoro_log", "idx_pomodoro_log_task", "idx_pomodoro_log_user_date"} <= names


def test_task_dict_has_estimate_defaults(u):
    t = _mk(u)
    assert t["estimated_pomodoros"] == 1 and t["pomodoros_done"] == 0


def test_create_and_update_estimate(u):
    t = _mk(u, estimated_pomodoros=3)
    assert t["estimated_pomodoros"] == 3
    r = u.put(f"/api/tasks/{t['id']}", json={"estimated_pomodoros": 7})
    assert r.status_code == 200 and r.json()["estimated_pomodoros"] == 7
    r = u.put(f"/api/tasks/{t['id']}", json={"title": "baru"})
    assert r.json()["estimated_pomodoros"] == 7
    for bad in (0, 21):
        assert u.put(f"/api/tasks/{t['id']}", json={"estimated_pomodoros": bad}).status_code == 422


def test_put_cannot_change_pomodoros_done(u):
    t = _mk(u)
    u.put(f"/api/tasks/{t['id']}", json={"title": "x", "pomodoros_done": 99})
    assert u.get(f"/api/tasks/{t['id']}").json()["pomodoros_done"] == 0


def test_log_session_increments_without_touching_updated_at(u):
    t = _mk(u)
    before = u.get(f"/api/tasks/{t['id']}").json()["updated_at"]
    b = _body()
    r = u.post(f"/api/tasks/{t['id']}/pomodoros", json=b)
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["pomodoros_done"] == 1 and j["duplicate"] is False and j["task_id"] == t["id"]
    assert u.get(f"/api/tasks/{t['id']}").json()["updated_at"] == before
    rows = _q("SELECT * FROM pomodoro_log WHERE task_id = ?", t["id"])
    assert len(rows) == 1
    assert (rows[0]["kind"], rows[0]["log_date"], rows[0]["client_id"]) == ("session", "2026-10-20", b["client_id"])


def test_log_duplicate_client_id_is_idempotent(u):
    t = _mk(u)
    b = _body()
    r1 = u.post(f"/api/tasks/{t['id']}/pomodoros", json=b)
    r2 = u.post(f"/api/tasks/{t['id']}/pomodoros", json=b)
    assert r1.status_code == r2.status_code == 200
    assert r1.json()["id"] == r2.json()["id"]
    assert r1.json()["pomodoros_done"] == r2.json()["pomodoros_done"] == 1
    assert r2.json()["duplicate"] is True
    assert len(_q("SELECT 1 FROM pomodoro_log WHERE task_id = ?", t["id"])) == 1


def test_log_overtime_rules(u):
    t = _mk(u)
    ov = lambda p, s: _log(u, t["id"], kind="overtime", pomodoros=p, focus_seconds=s)
    r = ov(2, 3100)
    assert r.status_code == 200 and r.json()["pomodoros_done"] == 2
    assert ov(1, 3100).status_code == 422
    assert ov(0, 59).status_code == 422
    assert ov(5, 7500).status_code == 422
    r = ov(0, 720)
    assert r.status_code == 200 and r.json()["pomodoros_done"] == 2


@pytest.mark.parametrize("over", [
    {"pomodoros": 2}, {"focus_seconds": 0}, {"focus_seconds": 1501},
    {"log_date": "20-10-2026"}, {"ended_at": "kemarin"},
    {"client_id": ""}, {"client_id": "x" * 65}, {"kind": "x"},
])
def test_log_session_rules(u, over):
    t = _mk(u)
    assert _log(u, t["id"], **over).status_code == 422


def test_log_access(client, u):
    t = _mk(u)
    other = U(client)
    assert _log(other, t["id"]).status_code == 403
    assert _log(u, 99999999).status_code == 404
    u.put(f"/api/tasks/{t['id']}", json={"gtd_status": "done"})
    assert _log(u, t["id"]).status_code == 200


def test_workspace_member_adds_to_shared_task(client, u):
    member = U(client)
    ws = u.post("/api/lists", json={"name": "WS" + uuid.uuid4().hex[:6]}).json()["id"]
    conn = db()
    conn.execute("INSERT INTO list_members(list_id, user_id, joined_at) VALUES (?,?,?)",
                 (ws, member.id, datetime.now().isoformat()))
    conn.commit()
    conn.close()
    t = _mk(u, list_id=ws)
    r = _log(member, t["id"])
    assert r.status_code == 200 and r.json()["pomodoros_done"] == 1
    assert u.get(f"/api/tasks/{t['id']}").json()["pomodoros_done"] == 1


def test_delete_task_keeps_log_with_null_task(u):
    t = _mk(u)
    b = _body()
    u.post(f"/api/tasks/{t['id']}/pomodoros", json=b)
    conn = db()
    conn.execute("PRAGMA foreign_keys=ON")
    conn.execute("DELETE FROM tasks WHERE id = ?", (t["id"],))
    conn.commit()
    row = conn.execute("SELECT task_id FROM pomodoro_log WHERE client_id = ?", (b["client_id"],)).fetchone()
    conn.close()
    assert row is not None and row["task_id"] is None


def test_migration_on_old_schema_db_with_existing_task_row(tmp_path):
    """DB lama: tabel tasks tanpa kolom estimasi/realisasi + satu baris → migrasi (dua kali) memberi 1/0, updated_at tetap."""
    import sqlite3
    import repository

    path = str(tmp_path / "old.db")
    conn = sqlite3.connect(path)
    conn.execute("""
        CREATE TABLE tasks (
            id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, description TEXT DEFAULT '',
            gtd_status TEXT NOT NULL DEFAULT 'inbox', priority TEXT NOT NULL DEFAULT 'P3',
            quadrant TEXT NOT NULL DEFAULT 'Q4', project TEXT DEFAULT '', context TEXT DEFAULT '',
            deadline TEXT DEFAULT NULL, waiting_for TEXT DEFAULT '', user_id INTEGER DEFAULT NULL,
            created_at TEXT NOT NULL, updated_at TEXT NOT NULL, completed_at TEXT DEFAULT NULL
        )""")
    stamp = "2026-01-02T03:04:05"
    conn.execute("INSERT INTO tasks (title, created_at, updated_at) VALUES ('lama', ?, ?)", (stamp, stamp))
    conn.commit()
    cols = [r[1] for r in conn.execute("PRAGMA table_info(tasks)")]
    assert "estimated_pomodoros" not in cols and "pomodoros_done" not in cols
    conn.close()

    repository.TaskRepository(path)
    repository.TaskRepository(path)  # idempoten

    conn = sqlite3.connect(path)
    try:
        row = conn.execute("SELECT estimated_pomodoros, pomodoros_done, updated_at FROM tasks WHERE title = 'lama'").fetchone()
        assert row == (1, 0, stamp)
        assert conn.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='pomodoro_log'").fetchone()
    finally:
        conn.close()
