"""Tes server Petakan (catatan <-> mindmap tertaut), Bagian B.

Spec: docs/superpowers/specs/2026-10-18-petakan-note-mindmap-design.md
"""
import json
import os
import sqlite3
import uuid

import pytest

import webapp
from conftest import db, register_user
from repository import TaskRepository


class U:
    """User tes: bersihkan cookie sebelum request supaya Bearer header yang dipakai."""

    def __init__(self, client, prefix="pk"):
        name = f"{prefix}{uuid.uuid4().hex[:8]}"
        info = register_user(client, name, f"{name}@test.id")
        self.client = client
        self.id = info["user_id"]
        self.username = info["username"]
        self.h = {"Authorization": f"Bearer {info['token']}"}

    def _call(self, method, url, **kw):
        self.client.cookies.clear()
        return getattr(self.client, method)(url, headers=self.h, **kw)

    def get(self, url, **kw): return self._call("get", url, **kw)
    def post(self, url, **kw): return self._call("post", url, **kw)
    def put(self, url, **kw): return self._call("put", url, **kw)
    def delete(self, url, **kw): return self._call("delete", url, **kw)


def _row(sql, *params):
    conn = db()
    try:
        return conn.execute(sql, params).fetchone()
    finally:
        conn.close()


def _mk_list(owner, *members, name="Tim Petakan"):
    repo = TaskRepository(os.environ["DB_PATH"])
    lst = repo.create_shared_list(name, owner.id)
    for m in members:
        repo.add_list_member(lst["id"], m.id)
    return lst["id"]


def _mk_note(u, title="Catatan", content="isi", **kw):
    r = u.post("/api/scratchpad", json={"title": title, "content": content, **kw})
    assert r.status_code == 200, r.text
    return r.json()


def test_migration_adds_source_note_id_and_unique_index():
    webapp.migrate_db(); webapp.migrate_db()  # idempoten
    conn = db()
    cols = [r["name"] for r in conn.execute("PRAGMA table_info(mindmaps)")]
    assert "source_note_id" in cols
    idx = {r["name"]: r["unique"] for r in conn.execute("PRAGMA index_list(mindmaps)")}
    assert idx.get("ux_mindmaps_source_note") == 1
    conn.execute("INSERT INTO mindmaps (user_id,title,created_at,updated_at,source_note_id) VALUES (1,'a','x','x',424242)")
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute("INSERT INTO mindmaps (user_id,title,created_at,updated_at,source_note_id) VALUES (1,'b','x','x',424242)")
    conn.rollback(); conn.close()


# ── B2: POST /api/mindmaps dengan source_note_id ──────────────────────────────

def test_create_linked_map_uses_note_owner_list_and_title(client):
    o, m = U(client), U(client); lid = _mk_list(o, m)
    n = _mk_note(o, title="Rencana", content="# A\n", list_id=lid)
    r = m.post("/api/mindmaps", json={"title": "x", "data_json": '{"nodeData":{}}', "source_note_id": n["id"]})
    assert r.status_code == 200, r.text
    mm = r.json()
    assert (mm["user_id"], mm["list_id"], mm["title"], mm["source_note_id"]) == (o.id, lid, "Rencana", n["id"])
    assert json.loads(mm["data_json"]) == {"linked": 1, "direction": 2, "justify": False, "collapsed": [], "summary": True}


def test_create_linked_map_idempotent_per_note(client):
    o = U(client); n = _mk_note(o)
    a = o.post("/api/mindmaps", json={"title": "x", "source_note_id": n["id"], "client_id": "c1"}).json()
    b = o.post("/api/mindmaps", json={"title": "y", "source_note_id": n["id"], "client_id": "c2"}).json()
    assert a["id"] == b["id"]
    assert _row("SELECT COUNT(*) c FROM mindmaps WHERE source_note_id = ?", n["id"])["c"] == 1


def test_create_linked_map_inaccessible_note_404(client):
    o, s = U(client), U(client); n = _mk_note(o)
    assert s.post("/api/mindmaps", json={"title": "x", "source_note_id": n["id"]}).status_code == 404
    assert o.post("/api/mindmaps", json={"title": "x", "source_note_id": 99999999}).status_code == 404
