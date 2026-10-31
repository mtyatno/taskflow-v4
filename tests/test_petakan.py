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


def _exec(sql, *params):
    conn = db()
    try:
        conn.execute(sql, params)
        conn.commit()
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


def test_put_linked_persists_view_state_bumps_updated_at_and_editor(client):
    o, m = U(client), U(client); lid = _mk_list(o, m)
    n = _mk_note(o, title="Sumber", list_id=lid)
    mm = o.post("/api/mindmaps", json={"title": "x", "source_note_id": n["id"]}).json()
    before = _row("SELECT updated_at, last_edited_by FROM mindmaps WHERE id = ?", mm["id"])
    vs = '{"linked":1,"direction":3,"justify":true,"collapsed":["A"],"summary":false}'
    r = m.put(f"/api/mindmaps/{mm['id']}", json={"data_json": vs})
    assert r.status_code == 200, r.text
    after = _row("SELECT data_json, updated_at, last_edited_by, list_id FROM mindmaps WHERE id = ?", mm["id"])
    assert after["data_json"] == vs
    assert after["updated_at"] != before["updated_at"]
    assert after["last_edited_by"] == m.id and before["last_edited_by"] != m.id
    assert after["list_id"] == lid


def test_normal_maps_with_null_source_note_id_insert_fine():
    conn = db()
    try:
        for t in ("n1", "n2"):
            conn.execute("INSERT INTO mindmaps (user_id,title,created_at,updated_at,source_note_id) VALUES (1,?,'x','x',NULL)", (t,))
        conn.commit()
    finally:
        conn.execute("DELETE FROM mindmaps WHERE title IN ('n1','n2') AND source_note_id IS NULL AND created_at='x'")
        conn.commit(); conn.close()


def test_share_linked_409_and_normal_put_still_checks_base_rev(client):
    o = U(client); lid = _mk_list(o); n, mm = _linked(o)
    r = o.patch(f"/api/mindmaps/{mm['id']}/share", json={"list_id": lid})
    assert r.status_code == 409 and "Peta tertaut mengikuti catatan" in r.text
    normal = _mk_mindmap(o)
    assert o.put(f"/api/mindmaps/{normal['id']}", json={"data_json": "{}", "base_rev": "basi"}).status_code == 409


# ── B5: penyamaan dari catatan + hapus permanen ───────────────────────────────

def test_share_unshare_rename_sync_and_noop(client):
    o = U(client); lid = _mk_list(o); n, mm = _linked(o)
    before = _row("SELECT updated_at FROM mindmaps WHERE id=?", mm["id"])["updated_at"]
    o.put(f"/api/scratchpad/{n['id']}", json={"title": "Sumber", "content": "isi baru"})
    assert _row("SELECT updated_at FROM mindmaps WHERE id=?", mm["id"])["updated_at"] == before
    o.patch(f"/api/scratchpad/{n['id']}/share", json={"list_id": lid})
    assert _row("SELECT list_id FROM mindmaps WHERE id=?", mm["id"])["list_id"] == lid
    o.patch(f"/api/scratchpad/{n['id']}/share", json={"list_id": None})
    assert _row("SELECT list_id FROM mindmaps WHERE id=?", mm["id"])["list_id"] is None
    o.put(f"/api/scratchpad/{n['id']}", json={"title": "Baru", "content": "isi baru"})
    assert _row("SELECT title FROM mindmaps WHERE id=?", mm["id"])["title"] == "Baru"


def test_trash_keeps_map_restore_and_purges_delete_it(client):
    o = U(client); n, mm = _linked(o)
    o.delete(f"/api/scratchpad/{n['id']}")
    assert _row("SELECT source_note_id FROM mindmaps WHERE id=?", mm["id"])["source_note_id"] == n["id"]
    assert o.post(f"/api/scratchpad/trash/{n['id']}/restore").status_code == 200
    o.delete(f"/api/scratchpad/{n['id']}"); o.delete(f"/api/scratchpad/trash/{n['id']}")
    assert _row("SELECT id FROM mindmaps WHERE id=?", mm["id"]) is None
    n2, mm2 = _linked(o); o.delete(f"/api/scratchpad/{n2['id']}"); o.delete("/api/scratchpad/trash")
    assert _row("SELECT id FROM mindmaps WHERE id=?", mm2["id"]) is None
    n3, mm3 = _linked(o); o.delete(f"/api/scratchpad/{n3['id']}")
    _exec("UPDATE trashed_notes SET deleted_at='2000-01-01T00:00:00+07:00' WHERE note_id=?", n3["id"])
    conn = db(); webapp._purge_expired_trashed_notes(conn); conn.commit(); conn.close()
    assert _row("SELECT id FROM mindmaps WHERE id=?", mm3["id"]) is None


def test_create_with_existing_client_id_syncs_linked_map(client):
    o = U(client); lid = _mk_list(o)
    cid = uuid.uuid4().hex
    n = _mk_note(o, title="Awal", client_id=cid)
    mm = o.post("/api/mindmaps", json={"title": "x", "source_note_id": n["id"]}).json()
    r = o.post("/api/scratchpad", json={"title": "Dari retry", "content": "z", "client_id": cid, "list_id": lid})
    assert r.status_code == 200 and r.json()["id"] == n["id"]
    row = _row("SELECT title, list_id FROM mindmaps WHERE id=?", mm["id"])
    assert (row["title"], row["list_id"]) == ("Dari retry", lid)


def test_restore_syncs_map_when_list_access_lost(client):
    o = U(client); m = U(client); lid = _mk_list(o, m)
    n = _mk_note(o, title="Bersama", list_id=lid)
    mm = o.post("/api/mindmaps", json={"title": "x", "source_note_id": n["id"]}).json()
    assert mm["list_id"] == lid
    o.delete(f"/api/scratchpad/{n['id']}")
    _exec("DELETE FROM shared_lists WHERE id=?", lid)
    assert o.post(f"/api/scratchpad/trash/{n['id']}/restore").status_code == 200
    assert _row("SELECT list_id FROM mindmaps WHERE id=?", mm["id"])["list_id"] is None


def test_empty_title_falls_back_and_list_deletion_nulls_map_list(client):
    o = U(client); lid = _mk_list(o)
    n = _mk_note(o, title="Judul", list_id=lid)
    mm = o.post("/api/mindmaps", json={"title": "x", "source_note_id": n["id"]}).json()
    o.put(f"/api/scratchpad/{n['id']}", json={"title": "", "content": "isi"})
    assert _row("SELECT title FROM mindmaps WHERE id=?", mm["id"])["title"] == "Tanpa judul"
    repo = TaskRepository(os.environ["DB_PATH"])
    assert repo.delete_shared_list(lid, o.id)
    assert _row("SELECT list_id FROM scratchpad_notes WHERE id=?", n["id"])["list_id"] is None
    assert _row("SELECT list_id FROM mindmaps WHERE id=?", mm["id"])["list_id"] is None


# ── Final review fixes ────────────────────────────────────────────────────────

def test_purge_expired_deletes_maps_before_trash_rows(client, monkeypatch):
    o = U(client); n, mm = _linked(o); o.delete(f"/api/scratchpad/{n['id']}")
    _exec("UPDATE trashed_notes SET deleted_at='2000-01-01T00:00:00+07:00' WHERE note_id=?", n["id"])

    def boom(conn, ids):
        raise RuntimeError("gagal hapus peta")
    monkeypatch.setattr(webapp, "_delete_linked_mindmaps", boom)
    conn = db(); webapp._purge_expired_trashed_notes(conn); conn.commit(); conn.close()
    # peta gagal dihapus -> baris sampah harus masih ada (tidak ada peta yatim)
    assert _row("SELECT note_id FROM trashed_notes WHERE note_id=?", n["id"]) is not None
    assert _row("SELECT id FROM mindmaps WHERE id=?", mm["id"]) is not None


def test_empty_trash_deletes_map_of_note_trashed_between_statements(client, monkeypatch):
    import contextlib
    o = U(client)
    n1, mm1 = _linked(o); o.delete(f"/api/scratchpad/{n1['id']}")
    n2, mm2 = _linked(o); o.delete(f"/api/scratchpad/{n2['id']}")
    saved = dict(_row("SELECT * FROM trashed_notes WHERE note_id=?", n2["id"]))
    _exec("DELETE FROM trashed_notes WHERE note_id=?", n2["id"])  # n2 belum 'masuk sampah' saat request mulai
    fired = []

    def inject(stmt):
        # Disisipkan saat SELECT _purge_trashed_media (sesudah daftar `mine` dibaca, sebelum DELETE, di luar
        # transaksi). Dulu dipicu oleh DELETE itu sendiri; sejak dbconn (BEGIN IMMEDIATE, ADR-038) kunci tulis
        # sudah dipegang saat DELETE mulai, sehingga penulis lain tidak bisa menyelip di titik itu.
        if not fired and stmt.lstrip().upper().startswith("SELECT NOTE_ID, SNAPSHOT_JSON FROM TRASHED_NOTES"):
            fired.append(1)
            cols = list(saved)
            _exec(f"INSERT INTO trashed_notes ({','.join(cols)}) VALUES ({','.join('?' * len(cols))})", *saved.values())

    real = webapp.get_db

    @contextlib.contextmanager
    def traced():
        with real() as conn:
            conn.set_trace_callback(inject)
            yield conn

    monkeypatch.setattr(webapp, "get_db", traced)
    assert o.delete("/api/scratchpad/trash").status_code == 200
    monkeypatch.setattr(webapp, "get_db", real)
    assert fired
    assert _row("SELECT note_id FROM trashed_notes WHERE note_id=?", n2["id"]) is None
    assert _row("SELECT id FROM mindmaps WHERE id=?", mm1["id"]) is None
    assert _row("SELECT id FROM mindmaps WHERE id=?", mm2["id"]) is None


def test_delete_shared_list_bumps_linked_map_updated_at(client):
    o = U(client); lid = _mk_list(o)
    n = _mk_note(o, title="Judul", list_id=lid)
    mm = o.post("/api/mindmaps", json={"title": "x", "source_note_id": n["id"]}).json()
    _exec("UPDATE mindmaps SET updated_at='2000-01-01T00:00:00+07:00' WHERE id=?", mm["id"])
    assert TaskRepository(os.environ["DB_PATH"]).delete_shared_list(lid, o.id)
    row = _row("SELECT list_id, updated_at FROM mindmaps WHERE id=?", mm["id"])
    assert row["list_id"] is None
    assert row["updated_at"] != "2000-01-01T00:00:00+07:00" and row["updated_at"] > "2000-01-01T00:00:00+07:00"
