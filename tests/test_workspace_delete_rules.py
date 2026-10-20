"""Hapus workspace: task kembali ke pembuatnya, berkas disk dibersihkan, migrasi task yatim."""
import os
import uuid
from datetime import datetime

import pytest

import repository
from config import DB_PATH, UPLOAD_DIR
from conftest import db, register_user


class U:
    def __init__(self, client, prefix="wd"):
        name = f"{prefix}{uuid.uuid4().hex[:8]}"
        info = register_user(client, name, f"{name}@test.id")
        self.client = client
        self.name = name
        self.id = info["user_id"]
        self.h = {"Authorization": f"Bearer {info['token']}"}

    def _call(self, method, url, **kw):
        self.client.cookies.clear()
        return getattr(self.client, method)(url, headers=self.h, **kw)

    def get(self, url, **kw): return self._call("get", url, **kw)
    def post(self, url, **kw): return self._call("post", url, **kw)
    def put(self, url, **kw): return self._call("put", url, **kw)
    def delete(self, url, **kw): return self._call("delete", url, **kw)


def _workspace(u):
    r = u.post("/api/lists", json={"name": f"WS{uuid.uuid4().hex[:8]}"})
    assert r.status_code == 200, r.text
    return r.json()["id"]


def _add_member(list_id, user_id):
    conn = db()
    conn.execute("INSERT INTO list_members(list_id, user_id, joined_at) VALUES (?,?,?)",
                 (list_id, user_id, datetime.now().isoformat()))
    conn.commit()
    conn.close()


def _setup_task(client):
    a, b = U(client), U(client)
    w = _workspace(a)
    _add_member(w, b.id)
    r = b.post("/api/tasks", json={"title": "T", "list_id": w, "assigned_to": a.id,
                                   "project": "ProjW", "context": "CtxW"})
    assert r.status_code == 200, r.text
    return a, b, w, r.json()["id"]


def _row(tid):
    conn = db()
    row = conn.execute("SELECT * FROM tasks WHERE id=?", (tid,)).fetchone()
    conn.close()
    return row


def _assert_private(row, creator_id):
    assert row["user_id"] == creator_id
    assert row["list_id"] is None
    assert row["assigned_to"] is None
    assert row["project_id"] is None and row["project"] == ""
    assert row["context_id"] is None and row["context"] == ""


def test_delete_returns_task_to_creator(client):
    a, b, w, t = _setup_task(client)
    before = _row(t)
    assert before["project_id"] is not None and before["context_id"] is not None
    assert a.delete(f"/api/lists/{w}").status_code == 200
    after = _row(t)
    _assert_private(after, b.id)
    assert after["updated_at"] > before["updated_at"]
    assert b.get(f"/api/tasks/{t}").status_code == 200
    assert a.get(f"/api/tasks/{t}").status_code in (403, 404)
    ids = [x["id"] for x in b.get("/api/tasks?include_done=true").json()]
    assert t in ids


def test_delete_unlinks_workspace_files(client):
    a = U(client)
    w = _workspace(a)
    r = a.post(f"/api/lists/{w}/files", files={"file": ("x.txt", b"hello", "text/plain")})
    assert r.status_code == 201, r.text
    path = os.path.join(UPLOAD_DIR, r.json()["filename"])
    assert os.path.exists(path)
    assert a.delete(f"/api/lists/{w}").status_code == 200
    assert not os.path.exists(path)


def test_delete_keeps_task_attachment_file(client):
    a, b, w, t = _setup_task(client)
    r = b.post(f"/api/tasks/{t}/attachments", files={"file": ("y.txt", b"data", "text/plain")})
    assert r.status_code == 200, r.text
    att = r.json()
    path = os.path.join(UPLOAD_DIR, att["filename"])
    assert os.path.exists(path)
    assert a.delete(f"/api/lists/{w}").status_code == 200
    assert os.path.exists(path)
    assert b.get(f"/api/attachments/{att['id']}/download").status_code == 200


def test_delete_unlink_failure_does_not_abort(client, monkeypatch):
    a = U(client)
    w = _workspace(a)
    r = a.post(f"/api/lists/{w}/files", files={"file": ("z.txt", b"zz", "text/plain")})
    assert r.status_code == 201, r.text

    def boom(p):
        raise OSError("nope")
    monkeypatch.setattr(repository.os, "unlink", boom)
    assert a.delete(f"/api/lists/{w}").status_code == 200
    conn = db()
    assert conn.execute("SELECT 1 FROM shared_lists WHERE id=?", (w,)).fetchone() is None
    conn.close()


def test_repo_delete_returns_task_to_creator(client):
    a, b, w, t = _setup_task(client)
    repo = repository.TaskRepository(DB_PATH)
    snap = dict(_row(t))
    assert repo.delete_shared_list(w, b.id) is False  # bukan owner
    assert dict(_row(t)) == snap
    assert repo.delete_shared_list(w, a.id) is True
    _assert_private(_row(t), b.id)


def test_orphan_migration_fixes_and_idempotent(client):
    import webapp
    u = U(client)
    now = datetime.now().isoformat()
    conn = db()
    cur = conn.execute(
        "INSERT INTO tasks (title, user_id, list_id, assigned_to, project, context, created_at, updated_at) "
        "VALUES ('orphan', ?, 999999, ?, 'P', 'C', ?, ?)", (u.id, u.id, now, now))
    tid = cur.lastrowid
    conn.commit()
    conn.close()
    webapp.migrate_db()
    row = _row(tid)
    _assert_private(row, u.id)
    assert row["updated_at"] >= now
    conn = db()
    snap = {r["id"]: r["updated_at"] for r in conn.execute("SELECT id, updated_at FROM tasks")}
    conn.close()
    webapp.migrate_db()
    conn = db()
    snap2 = {r["id"]: r["updated_at"] for r in conn.execute("SELECT id, updated_at FROM tasks")}
    conn.close()
    assert snap == snap2


def _mindmap(owner_id, list_id, source_note_id=None, updated_at="2026-01-01T00:00:00"):
    conn = db()
    cur = conn.execute(
        "INSERT INTO mindmaps (user_id, title, list_id, source_note_id, created_at, updated_at) "
        "VALUES (?, 'MM', ?, ?, ?, ?)", (owner_id, list_id, source_note_id, updated_at, updated_at))
    conn.commit()
    mid = cur.lastrowid
    conn.close()
    return mid


def _mm_row(mid):
    conn = db()
    row = conn.execute("SELECT * FROM mindmaps WHERE id=?", (mid,)).fetchone()
    conn.close()
    return row


def test_delete_returns_standalone_mindmap_to_owner(client):
    a, b = U(client), U(client)
    w = _workspace(a)
    _add_member(w, b.id)
    mid = _mindmap(b.id, w)
    assert b.get(f"/api/mindmaps/{mid}").status_code == 200
    assert a.get(f"/api/mindmaps/{mid}").status_code == 200
    assert a.delete(f"/api/lists/{w}").status_code == 200
    row = _mm_row(mid)
    assert row["list_id"] is None
    assert row["user_id"] == b.id
    assert row["updated_at"] > "2026-01-01T00:00:00"
    # pembuat tetap melihatnya sebagai pribadi; owner workspace kehilangan akses
    assert any(m["id"] == mid and m["list_id"] is None for m in b.get("/api/mindmaps").json())
    assert all(m["id"] != mid for m in a.get("/api/mindmaps").json())
    assert a.get(f"/api/mindmaps/{mid}").status_code in (403, 404)


def test_orphan_heal_covers_mindmaps_and_idempotent(client):
    import webapp
    u = U(client)
    orphan = _mindmap(u.id, 999998)
    w = _workspace(u)
    live = _mindmap(u.id, w)
    webapp.migrate_db()
    row = _mm_row(orphan)
    assert row["list_id"] is None and row["user_id"] == u.id
    assert row["updated_at"] > "2026-01-01T00:00:00"
    assert _mm_row(live)["list_id"] == w
    assert _mm_row(live)["updated_at"] == "2026-01-01T00:00:00"
    def snap():
        conn = db()
        out = {r["id"]: r["updated_at"] for r in conn.execute("SELECT id, updated_at FROM mindmaps")}
        conn.close()
        return out
    before = snap()
    assert repository.TaskRepository(DB_PATH).heal_orphan_workspace_items() == 0
    assert snap() == before
