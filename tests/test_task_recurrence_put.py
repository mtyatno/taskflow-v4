"""PUT /api/tasks/{id} dengan recurrence_type: dulu 500 (`existing` = sqlite3.Row, tidak punya `.get`).

Klien offline mengirim recurrence_type di setiap PUT penuh (`taskToUpdatePayload`), jadi setiap push penuh task
berulang gagal 500 di produksi.
"""
import json

from conftest import db, client  # noqa: F401
from test_direct_messages import U


def _row(task_id):
    conn = db()
    try:
        return conn.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
    finally:
        conn.close()


def _mk(u, **extra):
    r = u.post("/api/tasks", json={"title": "berulang", **extra})
    assert r.status_code == 200, r.text
    return r.json()["id"]


def test_minimal_put_recurrence_daily(client):
    u = U(client, "rcm")
    tid = _mk(u)
    r = u._call("put", f"/api/tasks/{tid}", json={"recurrence_type": "daily"})
    assert r.status_code == 200, r.text
    row = _row(tid)
    assert row["recurrence_type"] == "daily"
    assert row["recurrence_end_date"]


def test_full_payload_put_of_recurring_task_preserves_recurrence(client):
    u = U(client, "rcf")
    tid = _mk(u, recurrence_type="weekly", recurrence_days=[0, 2])
    before = _row(tid)
    assert before["recurrence_end_date"]
    payload = {  # bentuk `taskToUpdatePayload` (static/offline/syncpush.js)
        "title": "berulang", "description": "", "priority": "P3", "project": "", "context": "",
        "deadline": "", "gtd_status": "inbox", "waiting_for": "", "assigned_to": None, "progress": 0,
        "is_focused": False, "recurrence_type": "weekly", "recurrence_days": [0, 2],
    }
    r = u._call("put", f"/api/tasks/{tid}", json=payload)
    assert r.status_code == 200, r.text
    after = _row(tid)
    assert after["recurrence_type"] == "weekly"
    assert json.loads(after["recurrence_days"]) == [0, 2]
    assert after["recurrence_end_date"] == before["recurrence_end_date"]


def test_full_payload_changes_and_clears_recurrence(client):
    u = U(client, "rcc")
    tid = _mk(u, recurrence_type="weekly", recurrence_days=[1])
    r = u._call("put", f"/api/tasks/{tid}", json={"title": "berulang", "recurrence_type": "monthly",
                                                  "recurrence_days": [15]})
    assert r.status_code == 200, r.text
    assert json.loads(_row(tid)["recurrence_days"]) == [15]
    r = u._call("put", f"/api/tasks/{tid}", json={"title": "berulang", "recurrence_type": None})
    assert r.status_code == 200, r.text
    row = _row(tid)
    assert row["recurrence_type"] is None and row["recurrence_end_date"] is None
