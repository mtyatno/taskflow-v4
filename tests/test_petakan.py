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
    def patch(self, url, **kw): return self._call("patch", url, **kw)
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


def _mk_mindmap(u, **kw):
    r = u.post("/api/mindmaps", json={"title": "Peta", **kw})
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


def test_create_linked_map_ignores_client_id_of_existing_normal_map(client):
    o = U(client); n = _mk_note(o)
    normal = o.post("/api/mindmaps", json={"title": "Biasa", "client_id": "dup1"}).json()
    r = o.post("/api/mindmaps", json={"title": "x", "source_note_id": n["id"], "client_id": "dup1"})
    assert r.status_code == 200, r.text
    mm = r.json()
    assert mm["id"] != normal["id"]
    assert mm["source_note_id"] == n["id"]
    assert _row("SELECT source_note_id FROM mindmaps WHERE id = ?", normal["id"])["source_note_id"] is None


# ── B3: daftar menyaring peta tertaut kecuali ?linked=1 ───────────────────────

def test_lists_hide_linked_without_flag(client):
    o = U(client); lid = _mk_list(o); n = _mk_note(o, list_id=lid)
    normal = _mk_mindmap(o, list_id=lid); linked = o.post("/api/mindmaps", json={"title": "x", "source_note_id": n["id"]}).json()
    ids = lambda r: {x["id"] for x in r.json()}
    assert normal["id"] in ids(o.get("/api/mindmaps")) and linked["id"] not in ids(o.get("/api/mindmaps"))
    both = o.get("/api/mindmaps?linked=1").json()
    assert {normal["id"], linked["id"]} <= {x["id"] for x in both}
    assert next(x for x in both if x["id"] == linked["id"])["source_note_id"] == n["id"]
    assert linked["id"] not in ids(o.get(f"/api/lists/{lid}/mindmaps"))
    assert linked["id"] in ids(o.get(f"/api/lists/{lid}/mindmaps?linked=1"))
    assert o.get(f"/api/mindmaps/{linked['id']}").json()["source_note_id"] == n["id"]


# ── B4: aturan PUT dan share untuk peta tertaut ───────────────────────────────

def _linked(o, **note_kw):
    n = _mk_note(o, title="Sumber", **note_kw)
    return n, o.post("/api/mindmaps", json={"title": "x", "source_note_id": n["id"]}).json()


def test_put_linked_rejects_tree_and_ignores_title_base_rev(client):
    o = U(client); n, mm = _linked(o)
    r = o.put(f"/api/mindmaps/{mm['id']}", json={"data_json": '{"nodeData":{"id":"root"}}'})
    assert r.status_code == 400 and r.json() == {"detail": {"code": "LINKED_TREE_REJECTED"}}
    for bad in ("[1,2]", "42"):  # JSON tak valid sudah ditolak 422 oleh validator model
        r = o.put(f"/api/mindmaps/{mm['id']}", json={"data_json": bad})
        assert r.status_code == 400 and r.json() == {"detail": {"code": "LINKED_TREE_REJECTED"}}
    vs = '{"linked":1,"direction":3,"justify":true,"collapsed":["A"],"summary":false}'
    r = o.put(f"/api/mindmaps/{mm['id']}", json={"title": "Lain", "data_json": vs, "base_rev": "basi"})
    assert r.status_code == 200 and r.json()["title"] == "Sumber" and r.json()["data_json"] == vs


def test_put_linked_keeps_list_id(client):
    o = U(client); lid = _mk_list(o); n, mm = _linked(o)
    before = _row("SELECT list_id FROM mindmaps WHERE id = ?", mm["id"])["list_id"]
    r = o.put(f"/api/mindmaps/{mm['id']}", json={"list_id": lid, "data_json": '{"linked":1}'})
    assert r.status_code == 200
    assert _row("SELECT list_id FROM mindmaps WHERE id = ?", mm["id"])["list_id"] == before


def test_share_linked_409_and_normal_put_still_checks_base_rev(client):
    o = U(client); lid = _mk_list(o); n, mm = _linked(o)
    r = o.patch(f"/api/mindmaps/{mm['id']}/share", json={"list_id": lid})
    assert r.status_code == 409 and "Peta tertaut mengikuti catatan" in r.text
    normal = _mk_mindmap(o)
    assert o.put(f"/api/mindmaps/{normal['id']}", json={"data_json": "{}", "base_rev": "basi"}).status_code == 409
