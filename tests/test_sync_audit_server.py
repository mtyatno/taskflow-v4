"""Tes server untuk perbaikan audit offline/sinkron (Workstream B).

Sumber: docs/superpowers/specs/2026-10-15-offline-sync-audit.md (K2, K4, K6, T7, T11, S7, prinsip 7)
dan docs/superpowers/plans/2026-10-15-sync-audit-fixes.md.
"""
import json
import os
import uuid
from datetime import date, timedelta

import webapp
from conftest import db, register_user
from eisenhower import Quadrant
from repository import TaskRepository


class U:
    """User tes: selalu bersihkan cookie sebelum request supaya Bearer header yang dipakai."""

    def __init__(self, client, prefix="sa"):
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


def _mk_list(owner, *members, name="Tim Audit"):
    repo = TaskRepository(os.environ["DB_PATH"])
    lst = repo.create_shared_list(name, owner.id)
    for m in members:
        repo.add_list_member(lst["id"], m.id)
    return lst["id"]


def _mk_task(u, **kw):
    body = {"title": "Tugas audit", **kw}
    r = u.post("/api/tasks", json=body)
    assert r.status_code == 200, r.text
    return r.json()


def _mk_note(u, title="Catatan", content="isi", **kw):
    r = u.post("/api/scratchpad", json={"title": title, "content": content, **kw})
    assert r.status_code == 200, r.text
    return r.json()


def _mk_mindmap(u, **kw):
    r = u.post("/api/mindmaps", json={"title": "Peta", **kw})
    assert r.status_code == 200, r.text
    return r.json()


def _mk_drawing(u, **kw):
    r = u.post("/api/drawings", json={"title": "Gambar", "data_json": "{}", **kw})
    assert r.status_code == 200, r.text
    return r.json()


# ── Skema / migrasi (T11) ─────────────────────────────────────────────────────

def test_client_id_columns_and_unique_indexes_exist_and_migration_is_idempotent():
    for tbl, idx in (("tasks", "idx_tasks_user_client"),
                     ("habits", "idx_habits_user_client"),
                     ("mindmaps", "idx_mindmaps_user_client")):
        cols = [r["name"] for r in _rows(f"PRAGMA table_info({tbl})")]
        assert "client_id" in cols, tbl
        idx_row = _row("SELECT sql FROM sqlite_master WHERE type='index' AND name=?", idx)
        assert idx_row is not None, idx
        sql = idx_row["sql"].upper()
        assert "UNIQUE" in sql and "CLIENT_ID IS NOT NULL" in sql, idx_row["sql"]
    # migrasi aman dijalankan ulang pada DB yang sudah termigrasi
    webapp.migrate_db()
    webapp.migrate_db()


def test_migration_survives_legacy_db_with_duplicate_client_ids(monkeypatch, tmp_path):
    """DB lama yang sudah punya kolom client_id berisi duplikat: ALTER dilewati (kolom ada) dan
    CREATE UNIQUE INDEX gagal IntegrityError → dilewati, migrate_db tidak crash; tabel lain tetap diindeks."""
    import sqlite3
    legacy = tmp_path / "legacy.db"
    conn = sqlite3.connect(legacy)
    conn.execute("""CREATE TABLE mindmaps (
        id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, title TEXT NOT NULL DEFAULT 'Untitled',
        data_json TEXT NOT NULL DEFAULT '{}', is_pinned INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, client_id TEXT)""")
    conn.execute("INSERT INTO mindmaps (user_id, title, created_at, updated_at, client_id) VALUES (1,'a','t','t','dup')")
    conn.execute("INSERT INTO mindmaps (user_id, title, created_at, updated_at, client_id) VALUES (1,'b','t','t','dup')")
    conn.commit()
    conn.close()
    monkeypatch.setattr(webapp, "DB_PATH", str(legacy))
    webapp.migrate_db()  # tidak boleh melempar
    conn = sqlite3.connect(legacy)
    try:
        names = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='index'")}
        assert "idx_mindmaps_user_client" not in names  # dilewati karena duplikat
        assert {"idx_tasks_user_client", "idx_habits_user_client"} <= names
        assert conn.execute("SELECT COUNT(*) FROM mindmaps WHERE client_id='dup'").fetchone()[0] == 2
    finally:
        conn.close()


# ── K2: kuadran = field turunan, tidak mem-bump updated_at ───────────────────

def test_recalculate_changes_quadrant_but_not_updated_at(client):
    u = U(client, "k2")
    far = (date.today() + timedelta(days=30)).isoformat()
    t = _mk_task(u, priority="P1", deadline=far)
    assert t["quadrant"] == "Q2"
    before = _row("SELECT updated_at, quadrant FROM tasks WHERE id=?", t["id"])
    # Simulasi "waktu berjalan": deadline kini ≤ 7 hari, kuadran di DB basi (masih Q2)
    soon = (date.today() + timedelta(days=2)).isoformat()
    _exec("UPDATE tasks SET deadline=? WHERE id=?", soon, t["id"])

    r = u.post("/api/recalculate")
    assert r.status_code == 200, r.text
    assert r.json()["changed"] >= 1
    after = _row("SELECT updated_at, quadrant FROM tasks WHERE id=?", t["id"])
    assert after["quadrant"] == "Q1"
    assert after["updated_at"] == before["updated_at"]  # tidak di-bump


def test_repository_update_quadrant_does_not_bump_updated_at(client):
    u = U(client, "k2repo")
    t = _mk_task(u, priority="P3")
    before = _row("SELECT updated_at FROM tasks WHERE id=?", t["id"])["updated_at"]
    repo = TaskRepository(os.environ["DB_PATH"])
    repo.update_quadrant(t["id"], Quadrant.Q1)
    row = _row("SELECT updated_at, quadrant FROM tasks WHERE id=?", t["id"])
    assert row["quadrant"] == "Q1"
    assert row["updated_at"] == before


def test_user_edit_and_focus_toggle_still_bump_updated_at(client):
    """Edit pengguna sungguhan (PUT, /focus) tetap mem-bump updated_at."""
    u = U(client, "k2bump")
    t = _mk_task(u)
    before = _row("SELECT updated_at FROM tasks WHERE id=?", t["id"])["updated_at"]
    _exec("UPDATE tasks SET updated_at='2000-01-01T00:00:00' WHERE id=?", t["id"])
    assert u.put(f"/api/tasks/{t['id']}", json={"title": "Diedit"}).status_code == 200
    assert _row("SELECT updated_at FROM tasks WHERE id=?", t["id"])["updated_at"] != "2000-01-01T00:00:00"
    _exec("UPDATE tasks SET updated_at='2000-01-01T00:00:00' WHERE id=?", t["id"])
    assert u.post(f"/api/tasks/{t['id']}/focus").status_code == 200
    assert _row("SELECT updated_at FROM tasks WHERE id=?", t["id"])["updated_at"] != "2000-01-01T00:00:00"
    del before


# ── K4: /share mem-bump updated_at; list_id absen = tidak berubah ────────────

def test_share_bumps_updated_at(client):
    owner = U(client, "k4o")
    lid = _mk_list(owner)
    n = _mk_note(owner)
    _exec("UPDATE scratchpad_notes SET updated_at='2000-01-01T00:00:00' WHERE id=?", n["id"])
    r = owner.patch(f"/api/scratchpad/{n['id']}/share", json={"list_id": lid})
    assert r.status_code == 200, r.text
    assert r.json()["list_id"] == lid
    assert r.json()["updated_at"] != "2000-01-01T00:00:00"
    # unshare juga bump
    _exec("UPDATE scratchpad_notes SET updated_at='2000-01-01T00:00:00' WHERE id=?", n["id"])
    r = owner.patch(f"/api/scratchpad/{n['id']}/share", json={"list_id": None})
    assert r.status_code == 200
    assert r.json()["list_id"] is None
    assert r.json()["updated_at"] != "2000-01-01T00:00:00"


def test_put_without_list_id_keeps_share_state(client):
    owner = U(client, "k4keep")
    lid = _mk_list(owner)
    n = _mk_note(owner, list_id=lid)
    assert n["list_id"] == lid
    # autosave tanpa list_id → tetap dibagikan (dulu: list_id=None → un-share diam-diam)
    r = owner.put(f"/api/scratchpad/{n['id']}", json={"title": "Catatan", "content": "ketik lagi"})
    assert r.status_code == 200, r.text
    assert r.json()["list_id"] == lid
    # kebalikannya: note privat tetap privat walau PUT tanpa list_id
    p = _mk_note(owner, title="Privat")
    r = owner.put(f"/api/scratchpad/{p['id']}", json={"title": "Privat", "content": "x"})
    assert r.json()["list_id"] is None


def test_put_with_explicit_list_id_applies_for_owner_only(client):
    owner = U(client, "k4own")
    member = U(client, "k4mem")
    other_owner = U(client, "k4oth")
    lid = _mk_list(owner, member)
    other_lid = _mk_list(other_owner, member)
    n = _mk_note(owner, list_id=lid)
    # anggota mencoba memindahkan ke list lain → diabaikan
    r = member.put(f"/api/scratchpad/{n['id']}", json={"title": "Catatan", "content": "edit anggota", "list_id": other_lid})
    assert r.status_code == 200, r.text
    assert r.json()["list_id"] == lid
    # anggota mengirim list_id: null eksplisit → juga diabaikan (bukan pemilik)
    r = member.put(f"/api/scratchpad/{n['id']}", json={"title": "Catatan", "content": "edit anggota 2", "list_id": None})
    assert r.json()["list_id"] == lid
    # pemilik dengan list_id: null eksplisit → un-share
    r = owner.put(f"/api/scratchpad/{n['id']}", json={"title": "Catatan", "content": "x", "list_id": None})
    assert r.json()["list_id"] is None
    # pemilik dengan list_id eksplisit → share
    r = owner.put(f"/api/scratchpad/{n['id']}", json={"title": "Catatan", "content": "x", "list_id": lid})
    assert r.json()["list_id"] == lid


# ── K6: TaskUpdate.is_focused ────────────────────────────────────────────────

def test_put_task_is_focused_applied(client):
    u = U(client, "k6")
    t = _mk_task(u)
    assert t["is_focused"] is False
    r = u.put(f"/api/tasks/{t['id']}", json={"is_focused": True})
    assert r.status_code == 200, r.text
    assert r.json()["is_focused"] is True
    assert _row("SELECT is_focused FROM tasks WHERE id=?", t["id"])["is_focused"] == 1
    r = u.put(f"/api/tasks/{t['id']}", json={"is_focused": False, "title": "Judul baru"})
    assert r.json()["is_focused"] is False and r.json()["title"] == "Judul baru"
    assert _row("SELECT is_focused FROM tasks WHERE id=?", t["id"])["is_focused"] == 0
    # tanpa is_focused → tidak berubah
    u.put(f"/api/tasks/{t['id']}", json={"is_focused": True})
    r = u.put(f"/api/tasks/{t['id']}", json={"description": "d"})
    assert r.json()["is_focused"] is True


# ── T11: idempotensi create lewat client_id ──────────────────────────────────

def test_task_create_idempotent_by_client_id(client):
    u = U(client, "t11task")
    cid = f"cid-task-{uuid.uuid4().hex[:6]}"
    a = _mk_task(u, title="Sekali", client_id=cid)
    b = _mk_task(u, title="Sekali (retry)", client_id=cid)
    assert a["id"] == b["id"]
    assert b["title"] == "Sekali"  # baris lama dikembalikan apa adanya
    assert set(a) == set(b)  # bentuk respons sama dengan create baru
    rows = _rows("SELECT id FROM tasks WHERE user_id=? AND client_id=?", u.id, cid)
    assert len(rows) == 1
    # user lain dengan client_id sama → baris terpisah
    v = U(client, "t11task2")
    c = _mk_task(v, title="Milik V", client_id=cid)
    assert c["id"] != a["id"]
    # tanpa client_id → tetap membuat baris baru tiap POST (perilaku lama)
    d = _mk_task(u, title="Tanpa cid")
    e = _mk_task(u, title="Tanpa cid")
    assert d["id"] != e["id"]


def test_task_create_idempotent_does_not_renotify_list(client):
    owner = U(client, "t11notif")
    member = U(client, "t11notifm")
    lid = _mk_list(owner, member)
    cid = f"cid-ln-{uuid.uuid4().hex[:6]}"
    a = _mk_task(owner, title="Bersama", list_id=lid, client_id=cid)
    n1 = _rows("SELECT id FROM notifications WHERE user_id=?", member.id)
    b = _mk_task(owner, title="Bersama", list_id=lid, client_id=cid)
    assert a["id"] == b["id"]
    n2 = _rows("SELECT id FROM notifications WHERE user_id=?", member.id)
    assert len(n2) == len(n1)  # retry tidak menambah notifikasi


def test_task_create_integrity_race_returns_existing(client, monkeypatch):
    """Dua request kembar: SELECT idempotensi keduanya 'kosong', INSERT kedua kena UNIQUE
    (user_id, client_id) → handler menangkap IntegrityError dan mengembalikan baris yang ada."""
    from contextlib import contextmanager

    u = U(client, "t11race")
    cid = f"cid-race-{uuid.uuid4().hex[:6]}"
    first = _mk_task(u, title="Pemenang", client_id=cid)
    real_get_db = webapp.get_db
    state = {"hide_once": True}
    _IDEM_SELECT = "SELECT * FROM TASKS WHERE USER_ID = ? AND CLIENT_ID = ?"

    class _Empty:
        def fetchone(self):
            return None

    class _Conn:
        """Bungkus koneksi: SELECT idempotensi PERTAMA pura-pura tidak melihat baris kembar."""

        def __init__(self, conn):
            self._c = conn

        def execute(self, sql, params=()):
            if state["hide_once"] and sql.lstrip().upper().startswith(_IDEM_SELECT):
                state["hide_once"] = False
                return _Empty()
            return self._c.execute(sql, params)

        def __getattr__(self, name):
            return getattr(self._c, name)

    @contextmanager
    def fake_get_db():
        with real_get_db() as conn:
            yield _Conn(conn)

    monkeypatch.setattr(webapp, "get_db", fake_get_db)
    r = u.post("/api/tasks", json={"title": "Kembar", "client_id": cid})
    assert r.status_code == 200, r.text
    assert state["hide_once"] is False  # jalur race benar-benar dilewati
    assert r.json()["id"] == first["id"]
    assert r.json()["title"] == "Pemenang"
    assert len(_rows("SELECT id FROM tasks WHERE user_id=? AND client_id=?", u.id, cid)) == 1


def test_habit_create_idempotent_by_client_id(client):
    u = U(client, "t11habit")
    cid = f"cid-habit-{uuid.uuid4().hex[:6]}"
    body = {"title": "Baca", "phase": "pagi", "client_id": cid}
    a = u.post("/api/habits", json=body)
    b = u.post("/api/habits", json=body)
    assert a.status_code == 200 and b.status_code == 200, (a.text, b.text)
    assert a.json()["id"] == b.json()["id"]
    assert set(a.json()) == set(b.json())
    assert len(_rows("SELECT id FROM habits WHERE user_id=? AND client_id=?", u.id, cid)) == 1
    assert _row("SELECT client_id FROM habits WHERE id=?", a.json()["id"])["client_id"] == cid


def test_mindmap_create_idempotent_by_client_id(client):
    u = U(client, "t11mm")
    cid = f"cid-mm-{uuid.uuid4().hex[:6]}"
    a = _mk_mindmap(u, client_id=cid)
    b = _mk_mindmap(u, client_id=cid)
    assert a["id"] == b["id"]
    assert set(a) == set(b)
    assert len(_rows("SELECT id FROM mindmaps WHERE user_id=? AND client_id=?", u.id, cid)) == 1
    # client_id ikut dikembalikan di daftar (pull klien mencocokkan cid lokal, pola drawings/notes)
    listed = next(m for m in u.get("/api/mindmaps").json() if m["id"] == a["id"])
    assert listed["client_id"] == cid
    assert u.get(f"/api/mindmaps/{a['id']}").json()["client_id"] == cid
    # /share menerima client_id sebagai pengenal (cabang yang dulu mati karena kolom tidak ada)
    lid = _mk_list(u)
    r = u.patch(f"/api/mindmaps/{cid}/share", json={"list_id": lid})
    assert r.status_code == 200, r.text
    assert r.json()["id"] == a["id"] and r.json()["list_id"] == lid


def test_list_message_post_idempotent_by_client_id(client):
    owner = U(client, "t11chat")
    member = U(client, "t11chatm")
    lid = _mk_list(owner, member)
    cid = f"cid-msg-{uuid.uuid4().hex[:6]}"
    body = {"content": f"halo @{member.username}", "client_id": cid}
    a = owner.post(f"/api/lists/{lid}/messages", json=body)
    assert a.status_code == 200, a.text
    notif_before = len(_rows("SELECT id FROM notifications WHERE user_id=?", member.id))
    b = owner.post(f"/api/lists/{lid}/messages", json=body)
    assert b.status_code == 200, b.text
    assert a.json()["id"] == b.json()["id"]
    assert set(a.json()) == set(b.json())
    assert len(_rows("SELECT id FROM messages WHERE list_id=? AND user_id=? AND client_id=?", lid, owner.id, cid)) == 1
    # mention tidak dinotifikasi dua kali
    assert len(_rows("SELECT id FROM notifications WHERE user_id=?", member.id)) == notif_before
    # user lain dengan client_id sama di list yang sama → pesan terpisah
    c = member.post(f"/api/lists/{lid}/messages", json={"content": "dari anggota", "client_id": cid})
    assert c.status_code == 200 and c.json()["id"] != a.json()["id"]


def test_dm_message_post_idempotent_by_client_id(client):
    a = U(client, "t11dma")
    b = U(client, "t11dmb")
    _mk_list(a, b)  # DM hanya bisa dimulai dengan anggota grup yang sama
    r = a.post("/api/dm/conversations", json={"user_id": b.id})
    assert r.status_code == 200, r.text
    conv_id = r.json()["id"]
    cid = f"cid-dm-{uuid.uuid4().hex[:6]}"
    m1 = a.post(f"/api/dm/conversations/{conv_id}/messages", json={"content": "hai", "client_id": cid})
    m2 = a.post(f"/api/dm/conversations/{conv_id}/messages", json={"content": "hai (retry)", "client_id": cid})
    assert m1.status_code == 200 and m2.status_code == 200, (m1.text, m2.text)
    assert m1.json()["id"] == m2.json()["id"]
    assert m2.json()["content"] == "hai"
    assert len(_rows("SELECT id FROM dm_messages WHERE conversation_id=? AND user_id=? AND client_id=?",
                     conv_id, a.id, cid)) == 1
    # notifikasi 'pesan pribadi' ke penerima tidak digandakan
    notifs = _rows("SELECT id FROM notifications WHERE user_id=? AND message LIKE '%pesan pribadi%'", b.id)
    assert len(notifs) == 1


# ── T7: tag note berskop note ────────────────────────────────────────────────

def test_note_tags_are_note_scoped_and_owner_can_remove_after_member_edit(client):
    owner = U(client, "t7o")
    member = U(client, "t7m")
    lid = _mk_list(owner, member)
    n = _mk_note(owner, title="Bersama", content="v1", tags=["Alpha", "beta"], list_id=lid)
    assert n["tags"] == ["alpha", "beta"]

    # anggota mengedit (tag ikut dikirim seperti autosave klien)
    r = member.put(f"/api/scratchpad/{n['id']}", json={"title": "Bersama", "content": "v2", "tags": ["alpha", "beta"]})
    assert r.status_code == 200, r.text
    assert r.json()["tags"] == ["alpha", "beta"]  # DISTINCT: tidak dobel
    # semua relasi tag note ini berada di bawah user_id PEMILIK, dan baris tags dibuat untuk pemilik
    et = _rows("SELECT user_id FROM entity_tags WHERE entity_type='note' AND entity_id=?", n["id"])
    assert {r_["user_id"] for r_ in et} == {owner.id}
    assert len(et) == 2
    owner_tags = {r_["name"] for r_ in _rows("SELECT name FROM tags WHERE user_id=?", owner.id)}
    assert {"alpha", "beta"} <= owner_tags

    # pemilik menghapus 'beta' → benar-benar hilang (dulu: baris milik anggota tetap → tag zombie)
    r = owner.put(f"/api/scratchpad/{n['id']}", json={"title": "Bersama", "content": "v3", "tags": ["alpha"]})
    assert r.json()["tags"] == ["alpha"]
    assert member.get(f"/api/scratchpad/{n['id']}").json()["tags"] == ["alpha"]
    assert len(_rows("SELECT 1 FROM entity_tags WHERE entity_type='note' AND entity_id=?", n["id"])) == 1

    # anggota menambah tag → disimpan di bawah pemilik, terlihat semua; pemilik bisa menghapusnya
    r = member.put(f"/api/scratchpad/{n['id']}", json={"title": "Bersama", "content": "v4", "tags": ["alpha", "gamma"]})
    assert r.json()["tags"] == ["alpha", "gamma"]
    assert {r_["user_id"] for r_ in _rows("SELECT user_id FROM entity_tags WHERE entity_type='note' AND entity_id=?", n["id"])} == {owner.id}
    r = owner.put(f"/api/scratchpad/{n['id']}", json={"title": "Bersama", "content": "v5", "tags": []})
    assert r.json()["tags"] == []
    assert member.get(f"/api/scratchpad/{n['id']}").json()["tags"] == []


def test_scratchpad_row_dedupes_legacy_per_user_tag_rows(client):
    """Baris entity_tags lama (per editor, nama sama, tag_id beda) tidak muncul dobel."""
    owner = U(client, "t7legacy")
    member = U(client, "t7legacym")
    lid = _mk_list(owner, member)
    n = _mk_note(owner, tags=["dup"], list_id=lid)
    # simulasi data lama: anggota punya baris tag 'dup' sendiri untuk note yang sama
    conn = db()
    try:
        conn.execute("INSERT OR IGNORE INTO tags (user_id, name, created_at) VALUES (?, 'dup', '2000-01-01')", (member.id,))
        tid = conn.execute("SELECT id FROM tags WHERE user_id=? AND name='dup'", (member.id,)).fetchone()["id"]
        conn.execute("INSERT OR IGNORE INTO entity_tags (tag_id, user_id, entity_type, entity_id, created_at) VALUES (?,?,'note',?, '2000-01-01')",
                     (tid, member.id, n["id"]))
        conn.commit()
    finally:
        conn.close()
    assert len(_rows("SELECT 1 FROM entity_tags WHERE entity_type='note' AND entity_id=?", n["id"])) == 2
    assert owner.get(f"/api/scratchpad/{n['id']}").json()["tags"] == ["dup"]
    # PUT pemilik membersihkan baris legacy milik anggota
    owner.put(f"/api/scratchpad/{n['id']}", json={"title": "Catatan", "content": "x", "tags": ["dup"]})
    assert len(_rows("SELECT 1 FROM entity_tags WHERE entity_type='note' AND entity_id=?", n["id"])) == 1


# ── S7: MindmapCreate.list_id ────────────────────────────────────────────────

def test_mindmap_create_with_list_id_stores_it_when_member(client):
    owner = U(client, "s7o")
    member = U(client, "s7m")
    lid = _mk_list(owner, member)
    mm = _mk_mindmap(member, list_id=lid)
    assert mm["list_id"] == lid
    assert _row("SELECT list_id FROM mindmaps WHERE id=?", mm["id"])["list_id"] == lid
    # terlihat oleh pemilik list lewat akses bersama
    assert owner.get(f"/api/mindmaps/{mm['id']}").status_code == 200
    assert mm["id"] in [m["id"] for m in owner.get(f"/api/lists/{lid}/mindmaps").json()]
    # tanpa list_id → pribadi (perilaku lama)
    assert _mk_mindmap(member)["list_id"] is None


def test_mindmap_create_with_foreign_list_id_is_403(client):
    stranger = U(client, "s7s")
    lord = U(client, "s7l")
    lid = _mk_list(lord)
    r = stranger.post("/api/mindmaps", json={"title": "Nyelonong", "list_id": lid})
    assert r.status_code == 403, r.text
    assert "Bukan anggota list ini" in r.json()["detail"]
    assert _row("SELECT 1 FROM mindmaps WHERE user_id=? AND title='Nyelonong'", stranger.id) is None


# ── Prinsip 7: base_rev → 409 REV_MISMATCH ───────────────────────────────────

def _assert_rev_mismatch(r, expected_id):
    assert r.status_code == 409, r.text
    body = r.json()
    assert body["detail"]["code"] == "REV_MISMATCH"
    cur = body["detail"]["current"]
    assert cur["id"] == expected_id
    assert cur["updated_at"]
    return cur


def test_task_put_base_rev(client):
    u = U(client, "p7task")
    t = _mk_task(u, title="Asli")
    rev = _row("SELECT updated_at FROM tasks WHERE id=?", t["id"])["updated_at"]
    assert t["updated_at"] == rev
    # base_rev basi → 409 + baris server terkini (bentuk sama dengan GET), tidak ada perubahan
    r = u.put(f"/api/tasks/{t['id']}", json={"title": "Dari perangkat lama", "base_rev": "2000-01-01T00:00:00"})
    cur = _assert_rev_mismatch(r, t["id"])
    assert cur["title"] == "Asli" and cur["updated_at"] == rev
    assert set(cur) == set(u.get(f"/api/tasks/{t['id']}").json())
    assert _row("SELECT title, updated_at FROM tasks WHERE id=?", t["id"])["title"] == "Asli"
    # base_rev cocok → 200
    r = u.put(f"/api/tasks/{t['id']}", json={"title": "Cocok", "base_rev": rev})
    assert r.status_code == 200, r.text
    assert r.json()["title"] == "Cocok"
    new_rev = r.json()["updated_at"]
    assert new_rev != rev
    # tanpa base_rev → perilaku lama (LWW) tetap
    r = u.put(f"/api/tasks/{t['id']}", json={"title": "Tanpa rev"})
    assert r.status_code == 200 and r.json()["title"] == "Tanpa rev"
    # base_rev tidak bocor ke kolom UPDATE: hanya base_rev → 400 'No fields to update' seperti body kosong
    r = u.put(f"/api/tasks/{t['id']}", json={"base_rev": "x"})
    assert r.status_code in (400, 409)
    assert "base_rev" not in [c["name"] for c in _rows("PRAGMA table_info(tasks)")]


def test_note_put_base_rev(client):
    owner = U(client, "p7note")
    member = U(client, "p7notem")
    lid = _mk_list(owner, member)
    n = _mk_note(owner, title="N", content="v1", list_id=lid)
    rev = n["updated_at"]
    # anggota menyimpan dulu → rev berubah
    r = member.put(f"/api/scratchpad/{n['id']}", json={"title": "N", "content": "v2 anggota", "base_rev": rev})
    assert r.status_code == 200, r.text
    rev2 = r.json()["updated_at"]
    assert rev2 != rev
    # pemilik dengan rev lama → 409 + current (bentuk _scratchpad_row: tags, pinned, server_id)
    r = owner.put(f"/api/scratchpad/{n['id']}", json={"title": "N", "content": "v2 pemilik", "base_rev": rev})
    cur = _assert_rev_mismatch(r, n["id"])
    assert cur["content"] == "v2 anggota" and cur["updated_at"] == rev2
    assert "tags" in cur and "server_id" in cur and "pinned" in cur
    assert _row("SELECT content FROM scratchpad_notes WHERE id=?", n["id"])["content"] == "v2 anggota"
    # pemilik dengan rev terkini → 200
    r = owner.put(f"/api/scratchpad/{n['id']}", json={"title": "N", "content": "v3", "base_rev": rev2})
    assert r.status_code == 200 and r.json()["content"] == "v3"
    # tanpa base_rev → tetap LWW
    r = owner.put(f"/api/scratchpad/{n['id']}", json={"title": "N", "content": "v4"})
    assert r.status_code == 200 and r.json()["content"] == "v4"


def test_mindmap_put_base_rev(client):
    u = U(client, "p7mm")
    mm = _mk_mindmap(u)
    rev = mm["updated_at"]
    r = u.put(f"/api/mindmaps/{mm['id']}", json={"title": "Basi", "base_rev": "nope"})
    cur = _assert_rev_mismatch(r, mm["id"])
    assert cur["title"] == "Peta" and "data_json" in cur
    r = u.put(f"/api/mindmaps/{mm['id']}", json={"title": "Cocok", "base_rev": rev})
    assert r.status_code == 200 and r.json()["title"] == "Cocok"
    r = u.put(f"/api/mindmaps/{mm['id']}", json={"title": "Tanpa rev"})
    assert r.status_code == 200 and r.json()["title"] == "Tanpa rev"


def test_drawing_put_base_rev(client):
    u = U(client, "p7drw")
    d = _mk_drawing(u, client_id=f"cid-drw-{uuid.uuid4().hex[:6]}")
    rev = d["updated_at"]
    r = u.put(f"/api/drawings/{d['id']}", json={"title": "Basi", "base_rev": "nope"})
    cur = _assert_rev_mismatch(r, d["id"])
    assert cur["title"] == "Gambar" and cur["server_id"] == d["id"] and "tags" in cur
    # juga lewat client_id
    r = u.put(f"/api/drawings/{d['client_id']}", json={"title": "Basi", "base_rev": "nope"})
    _assert_rev_mismatch(r, d["id"])
    r = u.put(f"/api/drawings/{d['id']}", json={"title": "Cocok", "base_rev": rev})
    assert r.status_code == 200 and r.json()["title"] == "Cocok"
    r = u.put(f"/api/drawings/{d['id']}", json={"title": "Tanpa rev"})
    assert r.status_code == 200 and r.json()["title"] == "Tanpa rev"
