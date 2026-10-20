"""Task 3 (kanban context stages): jalur task web POST/PUT /api/tasks mengikat context_id."""
import time
import uuid
from datetime import datetime

from conftest import db, register_user


class U:
    def __init__(self, client, prefix="ct"):
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
    def patch(self, url, **kw): return self._call("patch", url, **kw)
    def delete(self, url, **kw): return self._call("delete", url, **kw)


def _n(p="Ctx"):
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


def _ctx(user_id=None, list_id=None, name=None, archived=0):
    now = datetime.now().isoformat()
    conn = db()
    cur = conn.execute(
        "INSERT INTO contexts(name, user_id, list_id, position, archived, created_by, created_at, updated_at)"
        " VALUES (?,?,?,?,?,?,?,?)",
        (name or _n(), user_id, list_id, 0, archived, user_id, now, now))
    conn.commit()
    cid = cur.lastrowid
    conn.close()
    return cid


def test_post_task_creates_context_entity(client):
    u = U(client)
    name = _n("Desain")
    t = _mk(u, context=name)
    row = _row("SELECT * FROM contexts WHERE name = ? AND user_id = ?", name, u.id)
    assert row is not None and row["list_id"] is None
    assert t["context_id"] == row["id"] and t["context"] == name


def test_post_task_with_context_id(client):
    u = U(client)
    name = _n()
    cid = _ctx(user_id=u.id, name=name)
    t = _mk(u, context_id=cid)
    assert t["context_id"] == cid and t["context"] == name


def test_post_task_unknown_context_id_uses_text(client):
    u = U(client)
    name = _n("Baru")
    t = _mk(u, context_id=999999, context=name)
    assert t["context"] == name and t["context_id"] is not None
    assert _row("SELECT name FROM contexts WHERE id = ?", t["context_id"])["name"] == name


def test_post_task_context_id_other_scope_400(client):
    u, other = U(client), U(client)
    cid = _ctx(user_id=other.id)
    r = u.post("/api/tasks", json={"title": "t", "context_id": cid})
    assert r.status_code == 400


def test_post_task_workspace_context(client):
    owner, member = U(client), U(client)
    w = _workspace(owner)
    _add_member(w, member.id)
    name = _n("WSCtx")
    t = _mk(member, list_id=w, context=name)
    row = _row("SELECT * FROM contexts WHERE id = ?", t["context_id"])
    assert row["name"] == name and row["list_id"] == w and row["user_id"] is None
    assert row["created_by"] == member.id


def test_post_subtask_inherits_context_text(client):
    u = U(client)
    name = _n()
    parent = _mk(u, context=name)
    sub = _mk(u, parent_id=parent["id"])
    assert sub["context"] == name and sub["context_id"] == parent["context_id"]


def test_put_context_id_moves_stage(client):
    u = U(client)
    t = _mk(u, context=_n())
    name = _n("Tujuan")
    cid = _ctx(user_id=u.id, name=name)
    time.sleep(0.01)
    r = u.put(f"/api/tasks/{t['id']}", json={"context_id": cid})
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["context"] == name and d["context_id"] == cid
    assert d["updated_at"] != t["updated_at"]


def test_put_empty_context_clears(client):
    u = U(client)
    t = _mk(u, context=_n())
    r = u.put(f"/api/tasks/{t['id']}", json={"context": ""})
    assert r.status_code == 200, r.text
    assert r.json()["context_id"] is None and r.json()["context"] == ""


def test_put_title_only_keeps_context_link(client):
    u = U(client)
    name = _n()
    cid = _ctx(user_id=u.id, name=name)
    t = _mk(u, context_id=cid)
    conn = db()
    conn.execute("UPDATE contexts SET archived = 1 WHERE id = ?", (cid,))
    conn.commit()
    conn.close()
    r = u.put(f"/api/tasks/{t['id']}", json={"title": "baru"})
    assert r.status_code == 200, r.text
    assert r.json()["context_id"] == cid and r.json()["context"] == name
    assert _row("SELECT archived FROM contexts WHERE id = ?", cid)["archived"] == 1


def test_put_same_id_stale_text_not_rewritten(client):
    u = U(client)
    old = _n("Lama")
    cid = _ctx(user_id=u.id, name=old)
    t = _mk(u, context_id=cid)
    new = _n("Baru")
    conn = db()
    conn.execute("UPDATE contexts SET name = ? WHERE id = ?", (new, cid))
    conn.execute("UPDATE tasks SET context = ? WHERE id = ?", (new, t["id"]))
    conn.commit()
    conn.close()
    r = u.put(f"/api/tasks/{t['id']}", json={"context_id": cid, "context": old, "title": "x"})
    assert r.status_code == 200, r.text
    assert r.json()["context"] == new and r.json()["context_id"] == cid


def test_put_deleted_context_id_ignored(client):
    u = U(client)
    old = _n("Hapus")
    cid = _ctx(user_id=u.id, name=old)
    t = _mk(u, context_id=cid)
    conn = db()
    conn.execute("DELETE FROM contexts WHERE id = ?", (cid,))
    conn.execute("UPDATE tasks SET context = '', context_id = NULL WHERE id = ?", (t["id"],))
    conn.commit()
    conn.close()
    r = u.put(f"/api/tasks/{t['id']}", json={"context_id": cid, "context": old, "title": "x"})
    assert r.status_code == 200, r.text
    assert r.json()["context_id"] is None and r.json()["context"] == ""
    assert _row("SELECT 1 FROM contexts WHERE name = ? AND user_id = ?", old, u.id) is None


def test_put_context_id_other_scope_400(client):
    u, other = U(client), U(client)
    t = _mk(u)
    cid = _ctx(user_id=other.id)
    r = u.put(f"/api/tasks/{t['id']}", json={"context_id": cid})
    assert r.status_code == 400
