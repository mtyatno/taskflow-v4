"""Task 2 (PR 4): resolusi project di semua jalur tulis task (spec §5.4)."""
import os
import uuid
from datetime import datetime

import models
import repository
from conftest import db, register_user


class U:
    def __init__(self, client, prefix="pt"):
        name = f"{prefix}{uuid.uuid4().hex[:8]}"
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


def _n(p="Proj"):
    return f"{p}{uuid.uuid4().hex[:8]}"


def _row(sql, *params):
    conn = db()
    try:
        return conn.execute(sql, params).fetchone()
    finally:
        conn.close()


def _workspace(u):
    r = u.post("/api/lists", json={"name": _n("WS")})
    assert r.status_code == 200, r.text
    return r.json()["id"]


def _add_member(list_id, user_id):
    conn = db()
    conn.execute("INSERT INTO list_members(list_id, user_id, joined_at) VALUES (?,?,?)",
                 (list_id, user_id, datetime.now().isoformat()))
    conn.commit()
    conn.close()


def _mk(u, **body):
    body.setdefault("title", "t")
    r = u.post("/api/tasks", json=body)
    assert r.status_code == 200, r.text
    return r.json()


def test_create_personal_resolves_project(client):
    u = U(client)
    name = _n()
    t = _mk(u, project=f"  {name} ")
    assert t["project"] == name and t["project_id"]
    p = _row("SELECT * FROM projects WHERE id=?", t["project_id"])
    assert p["user_id"] == u.id and p["list_id"] is None and p["created_by"] == u.id


def test_same_name_workspace_vs_personal_differ(client):
    u = U(client)
    ws = _workspace(u)
    name = _n()
    a = _mk(u, project=name)
    b = _mk(u, project=name, list_id=ws)
    assert a["project_id"] != b["project_id"]
    assert _row("SELECT list_id FROM projects WHERE id=?", b["project_id"])["list_id"] == ws


def test_case_insensitive_canonical(client):
    u = U(client)
    name = _n("Case")
    a = _mk(u, project=name)
    b = _mk(u, project=name.upper())
    assert a["project_id"] == b["project_id"]
    assert b["project"] == name


def test_project_id_other_scope_400(client):
    u, other = U(client), U(client)
    pid = _mk(other, project=_n())["project_id"]
    r = u.post("/api/tasks", json={"title": "x", "project_id": pid})
    assert r.status_code == 400
    assert r.json()["detail"] == "Project tidak berada di scope task"
    r = u.post("/api/tasks", json={"title": "x", "project_id": 99999999})
    assert r.status_code == 400


def test_create_with_project_id_sets_text(client):
    u = U(client)
    name = _n()
    pid = _mk(u, project=name)["project_id"]
    t = _mk(u, project_id=pid)
    assert t["project_id"] == pid and t["project"] == name


def test_put_empty_project_clears(client):
    u = U(client)
    t = _mk(u, project=_n())
    r = u.put(f"/api/tasks/{t['id']}", json={"project": ""})
    assert r.status_code == 200, r.text
    row = _row("SELECT project, project_id FROM tasks WHERE id=?", t["id"])
    assert row["project"] == "" and row["project_id"] is None


def test_put_only_project_id_sets_text(client):
    u = U(client)
    name = _n()
    pid = _mk(u, project=name)["project_id"]
    t = _mk(u)
    r = u.put(f"/api/tasks/{t['id']}", json={"project_id": pid})
    assert r.status_code == 200, r.text
    row = _row("SELECT project, project_id FROM tasks WHERE id=?", t["id"])
    assert row["project"] == name and row["project_id"] == pid


def test_put_other_scope_project_id_400(client):
    u, other = U(client), U(client)
    pid = _mk(other, project=_n())["project_id"]
    t = _mk(u)
    r = u.put(f"/api/tasks/{t['id']}", json={"project_id": pid})
    assert r.status_code == 400
    assert r.json()["detail"] == "Project tidak berada di scope task"


def test_put_without_project_keeps_it(client):
    u = U(client)
    t = _mk(u, project=_n())
    r = u.put(f"/api/tasks/{t['id']}", json={"title": "baru"})
    assert r.status_code == 200
    row = _row("SELECT project_id FROM tasks WHERE id=?", t["id"])
    assert row["project_id"] == t["project_id"]


def test_member_edits_workspace_task_resolves_in_workspace(client):
    a, b = U(client), U(client)
    ws = _workspace(a)
    _add_member(ws, b.id)
    t = _mk(a, list_id=ws)
    name = _n()
    r = b.put(f"/api/tasks/{t['id']}", json={"project": name})
    assert r.status_code == 200, r.text
    row = _row("SELECT p.*, t.project AS tp FROM tasks t JOIN projects p ON p.id=t.project_id "
               "WHERE t.id=?", t["id"])
    assert row["list_id"] == ws and row["user_id"] is None
    assert row["created_by"] == b.id and row["tp"] == name


def test_subtask_inherits_project_id(client):
    u = U(client)
    name = _n()
    parent = _mk(u, project=name)
    sub = _mk(u, parent_id=parent["id"])
    assert sub["project_id"] == parent["project_id"] and sub["project"] == name


def test_archived_project_reactivated(client):
    u = U(client)
    name = _n()
    pid = _mk(u, project=name)["project_id"]
    conn = db()
    conn.execute("UPDATE projects SET archived=1, updated_at='2000-01-01' WHERE id=?", (pid,))
    conn.commit()
    conn.close()
    t = _mk(u, project=name.lower())
    assert t["project_id"] == pid
    p = _row("SELECT archived, updated_at FROM projects WHERE id=?", pid)
    assert p["archived"] == 0 and p["updated_at"] != "2000-01-01"


def test_repository_add_and_update_fill_project_id(client):
    u = U(client)
    repo = repository.TaskRepository(os.environ["DB_PATH"])
    name = _n()
    t = repo.add(models.Task(title="bot", project=f" {name} "), u.id)
    row = _row("SELECT project, project_id FROM tasks WHERE id=?", t.id)
    assert row["project"] == name and row["project_id"]
    t.project = _n("Other")
    repo.update(t)
    row2 = _row("SELECT project, project_id FROM tasks WHERE id=?", t.id)
    assert row2["project"] == t.project and row2["project_id"] != row["project_id"]
    t.project = ""
    repo.update(t)
    row3 = _row("SELECT project, project_id FROM tasks WHERE id=?", t.id)
    assert row3["project"] == "" and row3["project_id"] is None


def test_repository_add_to_list_uses_workspace_scope(client):
    u = U(client)
    ws = _workspace(u)
    repo = repository.TaskRepository(os.environ["DB_PATH"])
    t = repo.add_to_list(models.Task(title="bot", project=_n()), u.id, ws)
    row = _row("SELECT p.list_id FROM tasks t JOIN projects p ON p.id=t.project_id WHERE t.id=?", t.id)
    assert row["list_id"] == ws


def test_task_in_deleted_workspace_is_personal(client):
    u = U(client)
    t = _mk(u)
    conn = db()
    conn.execute("UPDATE tasks SET list_id=987654 WHERE id=?", (t["id"],))
    conn.commit()
    conn.close()
    name = _n()
    r = u.put(f"/api/tasks/{t['id']}", json={"project": name})
    assert r.status_code == 200, r.text
    p = _row("SELECT p.user_id, p.list_id FROM tasks t JOIN projects p ON p.id=t.project_id "
             "WHERE t.id=?", t["id"])
    assert p["user_id"] == u.id and p["list_id"] is None
