"""Tes Trash & Restore untuk note (spec: docs/superpowers/specs/2026-10-02-note-trash-design.md)."""
import json
import os
from datetime import datetime, timedelta

import pytest
import pytz

from conftest import db, register_user
from repository import TaskRepository

JKT = pytz.timezone("Asia/Jakarta")


class U:
    """User tes: selalu bersihkan cookie sebelum request supaya Bearer header yang dipakai."""

    def __init__(self, client, name):
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

    def mk_note(self, title="Judul", content="Isi", **kw):
        r = self.post("/api/scratchpad", json={"title": title, "content": content, **kw})
        assert r.status_code == 200, r.text
        return r.json()

    def trash_ids(self):
        r = self.get("/api/scratchpad/trash")
        assert r.status_code == 200, r.text
        return [i["id"] for i in r.json()]


def _row(sql, *params):
    conn = db()
    try:
        return conn.execute(sql, params).fetchone()
    finally:
        conn.close()


def _rows(sql, *params):
    conn = db()
    try:
        return conn.execute(sql, params).fetchall()
    finally:
        conn.close()


def _exec(sql, *params):
    conn = db()
    try:
        conn.execute(sql, params)
        conn.commit()
    finally:
        conn.close()


def _mk_task(u, title="Tugas tertaut"):
    r = u.post("/api/tasks", json={"title": title})
    assert r.status_code == 200, r.text
    return r.json()["id"]


# ── Skema & rute ──────────────────────────────────────────────────────────────

def test_trash_table_created_by_migrate_db():
    cols = [r["name"] for r in _rows("PRAGMA table_info(trashed_notes)")]
    assert cols == ["note_id", "user_id", "title", "snapshot_json", "deleted_at"]
    idx = [r["name"] for r in _rows("PRAGMA index_list(trashed_notes)")]
    assert "idx_trashed_user" in idx


def test_trash_routes_not_shadowed_by_int_note_id(client):
    u = U(client, "trashroute")
    assert u.get("/api/scratchpad/trash").status_code == 200  # bukan 422
    assert u.delete("/api/scratchpad/trash").status_code == 200
    r = u.post("/api/scratchpad/trash/999999/restore")
    assert r.status_code == 404
    assert u.delete("/api/scratchpad/trash/999999").status_code == 200


def test_trash_requires_login(client):
    client.cookies.clear()
    assert client.get("/api/scratchpad/trash").status_code == 401
    assert client.delete("/api/scratchpad/trash").status_code == 401
    assert client.post("/api/scratchpad/trash/1/restore").status_code == 401
    assert client.delete("/api/scratchpad/trash/1").status_code == 401


# ── Hapus -> snapshot ─────────────────────────────────────────────────────────

def test_delete_snapshots_note_and_response_unchanged(client):
    u = U(client, "trashsnap")
    n = u.mk_note("Catatan Salju", "Isi **tebal** [[Lain]]", tags=["Work", "draft"])
    d = u.delete(f"/api/scratchpad/{n['id']}")
    assert d.status_code == 200
    assert d.json() == {"ok": True}

    assert _row("SELECT 1 FROM scratchpad_notes WHERE id=?", n["id"]) is None
    row = _row("SELECT * FROM trashed_notes WHERE note_id=?", n["id"])
    assert row["user_id"] == u.id
    assert row["title"] == "Catatan Salju"
    snap = json.loads(row["snapshot_json"])
    assert set(snap) == {"note", "tags", "pins", "published", "attachments"}
    assert snap["note"]["content"] == "Isi **tebal** [[Lain]]"
    assert snap["note"]["id"] == n["id"]
    assert sorted(snap["tags"]) == ["draft", "work"]
    assert snap["published"] is None and snap["attachments"] == []
    # deleted_at ISO bertimezone JKT
    dt = datetime.fromisoformat(row["deleted_at"])
    assert dt.utcoffset() == timedelta(hours=7)

    # idempoten: hapus lagi tidak menambah/menimpa trash
    d2 = u.delete(f"/api/scratchpad/{n['id']}")
    assert d2.json() == {"ok": True, "detail": "Note already deleted"}
    assert len(_rows("SELECT 1 FROM trashed_notes WHERE note_id=?", n["id"])) == 1


def test_snapshot_includes_every_scratchpad_column(client):
    u = U(client, "trashcols")
    n = u.mk_note("Kolom", "x", client_id="cid-cols-1")
    u.delete(f"/api/scratchpad/{n['id']}")
    snap = json.loads(_row("SELECT snapshot_json FROM trashed_notes WHERE note_id=?", n["id"])["snapshot_json"])
    live_cols = {r["name"] for r in _rows("PRAGMA table_info(scratchpad_notes)")}
    assert set(snap["note"]) == live_cols
    assert snap["note"]["client_id"] == "cid-cols-1"


def test_delete_is_atomic_when_snapshot_fails(client, monkeypatch):
    """Bila tulis snapshot gagal, note TIDAK boleh hilang (satu transaksi)."""
    import webapp
    u = U(client, "trashatomic")
    n = u.mk_note("Atomik", "x")
    _exec("DROP TABLE trashed_notes")
    try:
        from starlette.testclient import TestClient
        c2 = TestClient(webapp.app, raise_server_exceptions=False)
        c2.cookies.clear()
        r = c2.delete(f"/api/scratchpad/{n['id']}", headers=u.h)
        assert r.status_code == 500
        assert _row("SELECT 1 FROM scratchpad_notes WHERE id=?", n["id"]) is not None
    finally:
        webapp.migrate_db()  # bentuk ulang tabel untuk tes lain
    assert _rows("PRAGMA table_info(trashed_notes)")


def test_delete_forbidden_other_user_leaves_no_trash(client):
    a = U(client, "trashdelA")
    b = U(client, "trashdelB")
    n = a.mk_note("Milik A")
    r = b.delete(f"/api/scratchpad/{n['id']}")
    assert r.status_code == 403
    assert "Hanya pemilik yang bisa menghapus catatan ini" in r.json()["detail"]
    assert _row("SELECT 1 FROM trashed_notes WHERE note_id=?", n["id"]) is None
    assert _row("SELECT 1 FROM scratchpad_notes WHERE id=?", n["id"]) is not None


# ── Visibilitas setelah hapus / restore ───────────────────────────────────────

def test_deleted_note_hidden_everywhere_and_back_after_restore(client):
    u = U(client, "trashvis")
    n = u.mk_note("Zebra Unik Kuantum", "konten zebraunikkuantum", tags=["vis"])
    nid = n["id"]
    pub = u.post(f"/api/scratchpad/{nid}/publish", json={})
    assert pub.status_code == 200, pub.text
    slug, uname = pub.json()["slug"], pub.json()["username"]
    assert client.get(f"/pub/{uname}/{slug}").status_code == 200

    def visible():
        listed = [x["id"] for x in u.get("/api/scratchpad").json()]
        titles = [x["id"] for x in u.get("/api/scratchpad/titles").json()]
        s = u.get("/api/search", params={"q": "zebraunikkuantum"})
        assert s.status_code == 200, s.text
        found = json.dumps(s.json())
        return nid in listed, nid in titles, ("Zebra Unik Kuantum" in found)

    assert visible() == (True, True, True)
    assert u.delete(f"/api/scratchpad/{nid}").status_code == 200
    assert visible() == (False, False, False)
    client.cookies.clear()
    assert client.get(f"/pub/{uname}/{slug}").status_code == 404
    assert u.get(f"/api/scratchpad/{nid}").status_code == 404

    r = u.post(f"/api/scratchpad/trash/{nid}/restore")
    assert r.status_code == 200, r.text
    assert visible() == (True, True, True)
    client.cookies.clear()
    assert client.get(f"/pub/{uname}/{slug}").status_code == 200
    assert u.get(f"/api/scratchpad/{nid}").status_code == 200


# ── GET trash ─────────────────────────────────────────────────────────────────

def test_list_trash_shape_order_preview_and_days_left(client):
    u = U(client, "trashlist")
    long_content = "# Heading\n\n**tebal** `kode` [[Link]] " + ("kata " * 100) + "\n::draw[drw_abc]"
    n1 = u.mk_note("Pertama", long_content, tags=["B", "a"])
    n2 = u.mk_note("Kedua", "pendek")
    u.delete(f"/api/scratchpad/{n1['id']}")
    u.delete(f"/api/scratchpad/{n2['id']}")
    # buat n1 lebih lama supaya urutan terbaru-dulu terdeteksi
    older = (datetime.now(JKT) - timedelta(days=10)).isoformat()
    _exec("UPDATE trashed_notes SET deleted_at=? WHERE note_id=?", older, n1["id"])

    items = u.get("/api/scratchpad/trash").json()
    assert [i["id"] for i in items] == [n2["id"], n1["id"]]
    it2, it1 = items
    assert set(it1) == {"id", "title", "preview", "tags", "list_id", "deleted_at", "days_left"}
    assert it1["title"] == "Pertama"
    assert it1["tags"] == ["a", "b"]
    assert it1["list_id"] is None
    assert len(it1["preview"]) <= 120
    assert it1["preview"].strip() != ""
    for ch in ("**", "`", "[[", "::draw", "#"):
        assert ch not in it1["preview"]
    assert it1["days_left"] == 20
    assert it2["days_left"] == 30
    assert it2["preview"] == "pendek"


def test_trash_list_is_per_user(client):
    a = U(client, "trashlistA")
    b = U(client, "trashlistB")
    n = a.mk_note("Rahasia A")
    a.delete(f"/api/scratchpad/{n['id']}")
    assert n["id"] in a.trash_ids()
    assert n["id"] not in b.trash_ids()


# ── Restore round-trip ────────────────────────────────────────────────────────

def test_restore_round_trip_tags_pin_publish_attachments_and_id(client):
    u = U(client, "trashrt")
    n = u.mk_note("Round Trip", "isi rt", tags=["alpha", "Beta"], client_id="cid-rt")
    nid = n["id"]
    assert u.patch(f"/api/scratchpad/{nid}/pin").json()["pinned"] is True
    pub = u.post(f"/api/scratchpad/{nid}/publish", json={"password": "rahasia123"}).json()
    pub_before = _row("SELECT * FROM published_notes WHERE note_id=?", nid)
    assert pub_before["password_hash"]
    _exec(
        "INSERT INTO note_attachments (note_id, user_id, nextcloud_path, original_name, file_size, mime_type) "
        "VALUES (?,?,?,?,?,?)", nid, u.id, "/nc/a.png", "a.png", 123, "image/png")
    _exec(
        "INSERT INTO note_attachments (note_id, user_id, nextcloud_path, original_name, file_size, mime_type) "
        "VALUES (?,?,?,?,?,?)", nid, u.id, "/nc/b.pdf", "b.pdf", 456, "application/pdf")
    att_before = [dict(r) for r in _rows("SELECT * FROM note_attachments WHERE note_id=? ORDER BY id", nid)]
    note_before = dict(_row("SELECT * FROM scratchpad_notes WHERE id=?", nid))

    assert u.delete(f"/api/scratchpad/{nid}").json() == {"ok": True}
    # semua relasi benar-benar hilang saat terhapus
    assert _row("SELECT 1 FROM published_notes WHERE note_id=?", nid) is None
    assert _row("SELECT 1 FROM note_pins WHERE note_id=?", nid) is None
    assert not _rows("SELECT 1 FROM note_attachments WHERE note_id=?", nid)
    assert not _rows("SELECT 1 FROM entity_tags WHERE entity_type='note' AND entity_id=?", nid)

    r = u.post(f"/api/scratchpad/trash/{nid}/restore")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["id"] == nid and body["server_id"] == nid  # id asli
    assert body["title"] == "Round Trip" and body["content"] == "isi rt"
    assert body["tags"] == ["alpha", "beta"]
    assert body["pinned"] is True

    note_after = dict(_row("SELECT * FROM scratchpad_notes WHERE id=?", nid))
    assert note_after == note_before  # semua kolom identik (termasuk created_at/updated_at/client_id)
    pub_after = _row("SELECT * FROM published_notes WHERE note_id=?", nid)
    assert dict(pub_after) == dict(pub_before)  # slug + password_hash + published_at
    assert pub_after["slug"] == pub["slug"]
    att_after = [dict(r) for r in _rows("SELECT * FROM note_attachments WHERE note_id=? ORDER BY id", nid)]
    assert att_after == att_before
    # baris trash hilang; restore kedua -> 404
    assert nid not in u.trash_ids()
    assert u.post(f"/api/scratchpad/trash/{nid}/restore").status_code == 404
    # muncul lagi di pinned & detail
    assert nid in [x["id"] for x in u.get("/api/scratchpad/pinned").json()]
    assert u.get(f"/api/scratchpad/{nid}").json()["tags"] == ["alpha", "beta"]


def test_restore_keeps_original_id_and_does_not_reuse(client):
    u = U(client, "trashid")
    n = u.mk_note("Id asli")
    u.delete(f"/api/scratchpad/{n['id']}")
    other = u.mk_note("Baru")
    assert other["id"] != n["id"]
    r = u.post(f"/api/scratchpad/trash/{n['id']}/restore")
    assert r.json()["id"] == n["id"]


def test_restore_conflict_when_live_row_has_same_id(client):
    """Tak mungkin lewat API normal; pastikan tidak menimpa/crash 500."""
    u = U(client, "trashconf409")
    n = u.mk_note("Ada dua")
    u.delete(f"/api/scratchpad/{n['id']}")
    _exec("INSERT INTO scratchpad_notes (id, user_id, title) VALUES (?,?,?)", n["id"], u.id, "Penyusup")
    r = u.post(f"/api/scratchpad/trash/{n['id']}/restore")
    assert r.status_code == 409
    assert _row("SELECT title FROM scratchpad_notes WHERE id=?", n["id"])["title"] == "Penyusup"
    assert n["id"] in u.trash_ids()  # item trash tidak hilang


# ── Kasus tepi restore ────────────────────────────────────────────────────────

def _shared_list(owner, member=None):
    repo = TaskRepository(os.environ["DB_PATH"])
    lst = repo.create_shared_list("Tim Trash", owner.id)
    if member:
        repo.add_list_member(lst["id"], member.id)
    return lst["id"]


def test_restore_shared_note_keeps_list_when_still_member(client):
    owner = U(client, "trashshO")
    member = U(client, "trashshM")
    lid = _shared_list(owner, member)
    n = owner.mk_note("Bersama", "x", list_id=lid)
    assert n["id"] in [x["id"] for x in member.get("/api/scratchpad").json()]
    owner.delete(f"/api/scratchpad/{n['id']}")
    assert n["id"] not in [x["id"] for x in member.get("/api/scratchpad").json()]  # anggota kehilangan
    assert owner.get("/api/scratchpad/trash").json()[0]["list_id"] == lid
    r = owner.post(f"/api/scratchpad/trash/{n['id']}/restore")
    assert r.status_code == 200 and r.json()["list_id"] == lid
    assert n["id"] in [x["id"] for x in member.get("/api/scratchpad").json()]  # anggota melihatnya lagi


def test_restore_list_deleted_sets_list_id_null(client):
    owner = U(client, "trashlistgone")
    lid = _shared_list(owner)
    n = owner.mk_note("List hilang", list_id=lid)
    owner.delete(f"/api/scratchpad/{n['id']}")
    _exec("DELETE FROM shared_lists WHERE id=?", lid)
    r = owner.post(f"/api/scratchpad/trash/{n['id']}/restore")
    assert r.status_code == 200, r.text
    assert r.json()["list_id"] is None


def test_restore_not_member_anymore_sets_list_id_null(client):
    """User pemilik note bukan owner list & sudah dikeluarkan dari list."""
    lst_owner = U(client, "trashnmO")
    note_owner = U(client, "trashnmN")
    lid = _shared_list(lst_owner, note_owner)
    n = note_owner.mk_note("Bukan anggota lagi", list_id=lid)
    note_owner.delete(f"/api/scratchpad/{n['id']}")
    _exec("DELETE FROM list_members WHERE list_id=? AND user_id=?", lid, note_owner.id)
    r = note_owner.post(f"/api/scratchpad/trash/{n['id']}/restore")
    assert r.status_code == 200, r.text
    assert r.json()["list_id"] is None


def test_restore_drops_missing_linked_tasks(client):
    u = U(client, "trashtask")
    t_keep = _mk_task(u, "Tetap ada")
    t_gone = _mk_task(u, "Akan dihapus")
    n = u.mk_note("Tertaut", linked_task_ids=[t_gone, t_keep])  # linked_task_id = t_gone (elemen pertama)
    assert set(u.get(f"/api/scratchpad/{n['id']}").json()["linked_task_ids"]) == {t_keep, t_gone}
    u.delete(f"/api/scratchpad/{n['id']}")
    _exec("DELETE FROM tasks WHERE id=?", t_gone)
    r = u.post(f"/api/scratchpad/trash/{n['id']}/restore")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["linked_task_ids"] == [t_keep]
    row = _row("SELECT linked_task_id, linked_task_ids FROM scratchpad_notes WHERE id=?", n["id"])
    assert row["linked_task_id"] is None  # t_gone (linked_task_id asli) dibuang
    assert json.loads(row["linked_task_ids"]) == [t_keep]


def test_restore_keeps_linked_task_when_exists(client):
    u = U(client, "trashtaskok")
    t = _mk_task(u)
    n = u.mk_note("Tertaut ok", linked_task_id=t)
    u.delete(f"/api/scratchpad/{n['id']}")
    r = u.post(f"/api/scratchpad/trash/{n['id']}/restore")
    assert r.status_code == 200
    assert _row("SELECT linked_task_id FROM scratchpad_notes WHERE id=?", n["id"])["linked_task_id"] == t


def test_restore_client_id_conflict_sets_null(client):
    u = U(client, "trashcid")
    n = u.mk_note("Lama", client_id="cid-dup-1")
    u.delete(f"/api/scratchpad/{n['id']}")
    # klien offline membuat note lain dengan client_id yang sama
    new = u.mk_note("Baru", client_id="cid-dup-1")
    assert new["id"] != n["id"]
    r = u.post(f"/api/scratchpad/trash/{n['id']}/restore")
    assert r.status_code == 200, r.text
    assert _row("SELECT client_id FROM scratchpad_notes WHERE id=?", n["id"])["client_id"] is None
    assert _row("SELECT client_id FROM scratchpad_notes WHERE id=?", new["id"])["client_id"] == "cid-dup-1"


def test_restore_client_id_same_value_other_user_is_kept(client):
    a = U(client, "trashcidA")
    b = U(client, "trashcidB")
    n = a.mk_note("A", client_id="cid-shared-name")
    a.delete(f"/api/scratchpad/{n['id']}")
    b.mk_note("B", client_id="cid-shared-name")  # unik per (user, client_id)
    r = a.post(f"/api/scratchpad/trash/{n['id']}/restore")
    assert r.status_code == 200
    assert _row("SELECT client_id FROM scratchpad_notes WHERE id=?", n["id"])["client_id"] == "cid-shared-name"


def test_restore_publish_slug_conflict_skips_publish(client):
    u = U(client, "trashslug")
    n = u.mk_note("Slug Bentrok")
    slug = u.post(f"/api/scratchpad/{n['id']}/publish", json={}).json()["slug"]
    u.delete(f"/api/scratchpad/{n['id']}")
    taker = u.mk_note("Pengambil slug")
    _exec("INSERT INTO published_notes (note_id, user_id, slug, password_hash, published_at) VALUES (?,?,?,?,?)",
          taker["id"], u.id, slug, None, datetime.now(JKT).isoformat())
    r = u.post(f"/api/scratchpad/trash/{n['id']}/restore")
    assert r.status_code == 200, r.text
    assert _row("SELECT 1 FROM scratchpad_notes WHERE id=?", n["id"]) is not None
    assert _row("SELECT 1 FROM published_notes WHERE note_id=?", n["id"]) is None
    # publish milik note lain tidak tersentuh
    assert _row("SELECT note_id FROM published_notes WHERE slug=?", slug)["note_id"] == taker["id"]


def test_restore_pins_of_other_users_only_if_they_still_exist(client):
    owner = U(client, "trashpinO")
    member = U(client, "trashpinM")
    ghost = U(client, "trashpinG")
    lid = _shared_list(owner, member)
    repo = TaskRepository(os.environ["DB_PATH"])
    repo.add_list_member(lid, ghost.id)
    n = owner.mk_note("Pin banyak", list_id=lid)
    for who in (owner, member, ghost):
        assert who.patch(f"/api/scratchpad/{n['id']}/pin").json()["pinned"] is True
    owner.delete(f"/api/scratchpad/{n['id']}")
    snap = json.loads(_row("SELECT snapshot_json FROM trashed_notes WHERE note_id=?", n["id"])["snapshot_json"])
    assert sorted(snap["pins"]) == sorted([owner.id, member.id, ghost.id])
    # user ghost dihapus dari sistem (FK ON agar cascade nyata)
    conn = db()
    conn.execute("PRAGMA foreign_keys=ON")
    conn.execute("DELETE FROM users WHERE id=?", (ghost.id,))
    conn.commit()
    conn.close()
    r = owner.post(f"/api/scratchpad/trash/{n['id']}/restore")
    assert r.status_code == 200, r.text
    pinned_by = sorted(x["user_id"] for x in _rows("SELECT user_id FROM note_pins WHERE note_id=?", n["id"]))
    assert pinned_by == sorted([owner.id, member.id])


def test_restore_last_edited_by_missing_user_becomes_null(client):
    owner = U(client, "trashleO")
    editor = U(client, "trashleE")
    lid = _shared_list(owner, editor)
    n = owner.mk_note("Diedit", "v1", list_id=lid)
    r = editor.put(f"/api/scratchpad/{n['id']}", json={"title": "Diedit", "content": "v2", "list_id": lid})
    assert r.status_code == 200, r.text
    assert _row("SELECT last_edited_by FROM scratchpad_notes WHERE id=?", n["id"])["last_edited_by"] == editor.id
    owner.delete(f"/api/scratchpad/{n['id']}")
    conn = db()
    conn.execute("PRAGMA foreign_keys=ON")
    conn.execute("DELETE FROM users WHERE id=?", (editor.id,))
    conn.commit()
    conn.close()
    r = owner.post(f"/api/scratchpad/trash/{n['id']}/restore")
    assert r.status_code == 200, r.text
    assert _row("SELECT last_edited_by FROM scratchpad_notes WHERE id=?", n["id"])["last_edited_by"] is None


# ── Otorisasi lintas user ─────────────────────────────────────────────────────

def test_other_user_cannot_see_restore_or_purge_item(client):
    a = U(client, "trashauthA")
    b = U(client, "trashauthB")
    n = a.mk_note("Milik A", "isi", tags=["t"])
    a.delete(f"/api/scratchpad/{n['id']}")

    assert n["id"] not in b.trash_ids()
    assert b.post(f"/api/scratchpad/trash/{n['id']}/restore").status_code == 404
    assert _row("SELECT 1 FROM scratchpad_notes WHERE id=?", n["id"]) is None

    r = b.delete(f"/api/scratchpad/trash/{n['id']}")
    assert r.status_code == 200  # idempoten, tapi tidak menghapus milik A
    assert n["id"] in a.trash_ids()

    r = b.delete("/api/scratchpad/trash")
    assert r.json() == {"ok": True, "deleted": 0}
    assert n["id"] in a.trash_ids()

    # A tetap bisa memulihkan
    assert a.post(f"/api/scratchpad/trash/{n['id']}/restore").status_code == 200


# ── Purge kedaluwarsa ─────────────────────────────────────────────────────────

def test_expired_items_purged_on_list(client):
    import webapp
    assert webapp.NOTE_TRASH_RETENTION_DAYS == 30
    u = U(client, "trashexp")
    old = u.mk_note("Kedaluwarsa")
    edge = u.mk_note("Masih sah")
    u.delete(f"/api/scratchpad/{old['id']}")
    u.delete(f"/api/scratchpad/{edge['id']}")
    _exec("UPDATE trashed_notes SET deleted_at=? WHERE note_id=?",
          (datetime.now(JKT) - timedelta(days=31)).isoformat(), old["id"])
    _exec("UPDATE trashed_notes SET deleted_at=? WHERE note_id=?",
          (datetime.now(JKT) - timedelta(days=29, hours=23)).isoformat(), edge["id"])

    ids = u.trash_ids()
    assert old["id"] not in ids
    assert edge["id"] in ids
    assert _row("SELECT 1 FROM trashed_notes WHERE note_id=?", old["id"]) is None  # barisnya terhapus
    assert _row("SELECT 1 FROM trashed_notes WHERE note_id=?", edge["id"]) is not None
    assert [i for i in u.get("/api/scratchpad/trash").json() if i["id"] == edge["id"]][0]["days_left"] == 1


def test_expired_item_cannot_be_restored(client):
    u = U(client, "trashexp2")
    n = u.mk_note("Kedaluwarsa restore")
    u.delete(f"/api/scratchpad/{n['id']}")
    _exec("UPDATE trashed_notes SET deleted_at=? WHERE note_id=?",
          (datetime.now(JKT) - timedelta(days=45)).isoformat(), n["id"])
    assert u.post(f"/api/scratchpad/trash/{n['id']}/restore").status_code == 404
    assert _row("SELECT 1 FROM scratchpad_notes WHERE id=?", n["id"]) is None


# ── Hapus permanen & kosongkan ────────────────────────────────────────────────

def test_permanent_delete_single_idempotent(client):
    u = U(client, "trashperm")
    n = u.mk_note("Hapus permanen")
    keep = u.mk_note("Tetap di sampah")
    u.delete(f"/api/scratchpad/{n['id']}")
    u.delete(f"/api/scratchpad/{keep['id']}")
    r = u.delete(f"/api/scratchpad/trash/{n['id']}")
    assert r.status_code == 200 and r.json()["ok"] is True
    assert n["id"] not in u.trash_ids() and keep["id"] in u.trash_ids()
    assert u.delete(f"/api/scratchpad/trash/{n['id']}").json()["ok"] is True  # ulang -> tetap ok
    assert u.post(f"/api/scratchpad/trash/{n['id']}/restore").status_code == 404
    assert _row("SELECT 1 FROM scratchpad_notes WHERE id=?", n["id"]) is None


def test_empty_trash_returns_count_and_only_own(client):
    a = U(client, "trashemptyA")
    b = U(client, "trashemptyB")
    ids = []
    for i in range(3):
        n = a.mk_note(f"A{i}")
        a.delete(f"/api/scratchpad/{n['id']}")
        ids.append(n["id"])
    nb = b.mk_note("B0")
    b.delete(f"/api/scratchpad/{nb['id']}")
    live = a.mk_note("Hidup")

    r = a.delete("/api/scratchpad/trash")
    assert r.status_code == 200
    assert r.json() == {"ok": True, "deleted": 3}
    assert a.trash_ids() == []
    assert nb["id"] in b.trash_ids()  # milik B utuh
    assert a.get(f"/api/scratchpad/{live['id']}").status_code == 200  # note hidup tak tersentuh
    assert a.delete("/api/scratchpad/trash").json() == {"ok": True, "deleted": 0}


def test_old_delete_tests_behaviour_still_holds(client):
    """Regresi: 403 + idempoten + id tak ada tetap seperti sebelum fitur trash."""
    a = U(client, "trashregA")
    b = U(client, "trashregB")
    n = a.mk_note("Reg")
    assert b.delete(f"/api/scratchpad/{n['id']}").status_code == 403
    assert a.delete(f"/api/scratchpad/{n['id']}").json() == {"ok": True}
    r = a.delete("/api/scratchpad/987654")
    assert r.json() == {"ok": True, "detail": "Note already deleted"}
    assert _row("SELECT 1 FROM trashed_notes WHERE note_id=?", 987654) is None
