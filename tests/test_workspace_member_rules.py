"""Keluarkan/keluar melepas penanggung jawab, member_count termasuk owner, delete-impact."""
import time
import uuid
from datetime import datetime

from conftest import db
from test_workspace_delete_rules import U, _add_member, _workspace


def _task(w, creator, assignee, status="inbox", list_id="same"):
    conn = db()
    now = datetime.now().isoformat()
    cur = conn.execute(
        "INSERT INTO tasks (user_id, title, gtd_status, list_id, assigned_to, created_at, updated_at) "
        "VALUES (?,?,?,?,?,?,?)",
        (creator, "T" + uuid.uuid4().hex[:6], status, w, assignee, now, now),
    )
    conn.commit()
    tid = cur.lastrowid
    conn.close()
    return tid


def _row(tid):
    conn = db()
    r = conn.execute("SELECT * FROM tasks WHERE id=?", (tid,)).fetchone()
    conn.close()
    return r


def _setup(client):
    a, b = U(client, "wm"), U(client, "wm")
    w = _workspace(a)
    _add_member(w, b.id)
    return a, b, w


def test_remove_member_releases_active_tasks(client):
    a, b, w = _setup(client)
    t = _task(w, a.id, b.id)
    before = _row(t)["updated_at"]
    time.sleep(0.01)
    assert a.delete(f"/api/lists/{w}/members/{b.id}").status_code == 200
    after = _row(t)
    assert after["assigned_to"] is None
    assert after["updated_at"] > before
    assert after["list_id"] == w


def test_leave_releases_active_tasks(client):
    a, b, w = _setup(client)
    t = _task(w, a.id, b.id)
    before = _row(t)["updated_at"]
    time.sleep(0.01)
    assert b.delete(f"/api/lists/{w}/leave").status_code == 200
    after = _row(t)
    assert after["assigned_to"] is None
    assert after["updated_at"] > before


def test_remove_member_keeps_done_and_other_workspace(client):
    a, b, w = _setup(client)
    w2 = _workspace(a)
    _add_member(w2, b.id)
    done = _task(w, a.id, b.id, "done")
    arch = _task(w, a.id, b.id, "archived")
    other = _task(w2, a.id, b.id)
    snap = {t: _row(t)["updated_at"] for t in (done, arch, other)}
    time.sleep(0.01)
    assert a.delete(f"/api/lists/{w}/members/{b.id}").status_code == 200
    for t in (done, arch, other):
        r = _row(t)
        assert r["assigned_to"] == b.id
        assert r["updated_at"] == snap[t]


def test_member_count_includes_owner(client):
    a, b = U(client, "wm"), U(client, "wm")
    w = _workspace(a)

    def count():
        return next(x for x in a.get("/api/lists").json() if x["id"] == w)["member_count"]

    assert count() == 1
    _add_member(w, b.id)
    assert count() == 2


def test_delete_impact_counts(client):
    a, b, w = _setup(client)
    _task(w, a.id, None, "inbox")
    _task(w, a.id, b.id, "next")
    t_done = _task(w, a.id, None, "done")
    now = datetime.now().isoformat()
    conn = db()
    for fn, src in (("direct-" + uuid.uuid4().hex, "direct"), ("att-" + uuid.uuid4().hex, "task")):
        conn.execute(
            "INSERT INTO workspace_files (list_id,user_id,filename,original_name,source,is_deleted,created_at) "
            "VALUES (?,?,?,?,?,0,?)", (w, a.id, fn, fn, src, now))
    att = fn
    conn.execute(
        "INSERT INTO task_attachments (task_id,filename,original_name,created_at) VALUES (?,?,?,?)",
        (t_done, att, att, now))
    for i in range(2):
        conn.execute("INSERT INTO messages (list_id,user_id,content,created_at) VALUES (?,?,?,?)",
                     (w, a.id, f"m{i}", now))
    conn.execute("INSERT INTO projects (name,list_id,created_at,updated_at) VALUES (?,?,?,?)",
                 ("P", w, now, now))
    conn.execute("INSERT INTO contexts (name,list_id,created_at,updated_at) VALUES (?,?,?,?)",
                 ("S", w, now, now))
    conn.execute("INSERT INTO scratchpad_notes (user_id,title,content,list_id,created_at,updated_at) "
                 "VALUES (?,?,?,?,?,?)", (a.id, "n", "c", w, now, now))
    conn.execute("INSERT INTO drawings (user_id,title,list_id,created_at,updated_at) VALUES (?,?,?,?,?)",
                 (a.id, "d", w, now, now))
    conn.commit()
    conn.close()
    r = a.get(f"/api/lists/{w}/delete-impact")
    assert r.status_code == 200, r.text
    assert r.json() == {"tasks_total": 3, "tasks_active": 2, "files": 1, "messages": 2,
                        "projects": 1, "stages": 1, "notes_to_personal": 1, "drawings_to_personal": 1}


def test_delete_impact_forbidden_and_missing(client):
    a, b, w = _setup(client)
    assert b.get(f"/api/lists/{w}/delete-impact").status_code == 403
    assert a.get("/api/lists/99999999/delete-impact").status_code == 404
