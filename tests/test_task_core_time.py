"""Waktu inti task (PR 1c-0b, K45–K47; rencana R1–R4, R8).

Dua kolom mentah TERIKAT pada `tasks.updated_at` (`ext_core_at`, `ext_only_at`): waktu inti efektif =
`ext_core_at` hanya bila `ext_only_at = updated_at` dan `ext_core_at` tidak kosong, selain itu `updated_at`.
Hanya PUT ext murni (body tanpa field inti, `ext_patch` ada) yang menulis kolom itu, nilainya dihitung SQL atas
baris terkini di UPDATE yang sama. API: `core_updated_at` di setiap keluaran `task_row_to_dict`, kolom mentah
dibuang. Penulis lain tidak menyentuh kolom (ikatan), dikunci pagar di akhir berkas.
"""
import ast
import inspect
import re
import uuid
from datetime import date, datetime, timedelta
from pathlib import Path

import pytest

import dbconn
import task_ext
import webapp
from conftest import db, client  # noqa: F401
from models import Quadrant
from repository import TaskRepository
from test_direct_messages import U, _mk_list, _rows
from test_task_ext import _calls_in, demo_index  # noqa: F401  (namespace demo-ext berizin task.ext)

ROOT = Path(__file__).resolve().parent.parent
RAW = ("ext_core_at", "ext_only_at")
UPDATED = "memperbarui task"


# ── Helper (disalin dari tests/test_task_ext.py) ──────────────────────────────

def _post(u, **body):
    r = u.post("/api/tasks", json=body)
    assert r.status_code == 200, r.text
    return r.json()


def _put(u, tid, **body):
    r = u._call("put", f"/api/tasks/{tid}", json=body)
    assert r.status_code == 200, r.text
    return r.json()


def _get(u, tid):
    r = u.get(f"/api/tasks/{tid}")
    assert r.status_code == 200, r.text
    return r.json()


def _full_payload(task, **over):
    """Payload PUT gaya push klien (`taskToUpdatePayload`): record penuh, tanpa ext_patch."""
    body = {"title": task["title"], "description": task["description"], "priority": task["priority"],
            "project": task["project"] or "", "context": task["context"] or "", "deadline": "",
            "gtd_status": task["gtd_status"], "waiting_for": task["waiting_for"] or "", "assigned_to": None,
            "progress": task.get("progress") or 0, "is_focused": bool(task.get("is_focused")),
            "recurrence_type": None, "recurrence_days": None}
    body.update(over)
    return body


def _updates(user_id, task_id):
    return [r["message"] for r in _rows(
        "SELECT message FROM notifications WHERE user_id = ? AND task_id = ? ORDER BY id", user_id, task_id)
        if UPDATED in r["message"]]


# ── Helper berkas ini ─────────────────────────────────────────────────────────

def _ts(s):
    return datetime.fromisoformat(s)


def _ok(r):
    assert r.status_code == 200, r.text
    return r.json()


def _exec(sql, *params):
    conn = db()
    try:
        conn.execute(sql, params)
        conn.commit()
    finally:
        conn.close()


def _db_row(tid):
    return dict(_rows("SELECT updated_at, ext_core_at, ext_only_at FROM tasks WHERE id = ?", tid)[0])


def _freeze(u, tid):
    """PUT ext murni → (waktu inti beku, `updated_at` revisi ext itu)."""
    before = _get(u, tid)
    out = _put(u, tid, ext_patch={"demo-ext.k": uuid.uuid4().hex})
    assert out["core_updated_at"] == before["core_updated_at"]
    assert _ts(out["updated_at"]) > _ts(before["updated_at"])
    return out["core_updated_at"], out["updated_at"]


def _assert_core_is_updated_at(t, frozen_core, frozen_at):
    """Penulis `updated_at` sesudah pembekuan: waktu inti = `updated_at` baru (naif), lebih baru dari nilai beku."""
    assert t["core_updated_at"] == t["updated_at"]
    assert _ts(t["updated_at"]) > _ts(frozen_at) > _ts(frozen_core)
    assert _ts(t["updated_at"]).tzinfo is None
    assert not set(RAW) & set(t)


class _NoCommit:
    """Koneksi pembungkus: `ensure_core_schema` hanya boleh `execute` (pemanggil yang commit)."""

    def __init__(self, conn):
        self._conn = conn

    def execute(self, *a):
        return self._conn.execute(*a)

    def commit(self):
        raise AssertionError("ensure_core_schema tidak boleh commit")


# ── Skema & migrasi (R4) ──────────────────────────────────────────────────────

def test_ensure_core_schema_idempotent(tmp_path):
    assert task_ext.CORE_COLS == RAW
    conn = dbconn.connect(str(tmp_path / "t.db"))
    try:
        conn.execute("CREATE TABLE tasks (id INTEGER PRIMARY KEY, title TEXT, updated_at TEXT)")
        conn.execute("INSERT INTO tasks (title, updated_at) VALUES ('lama', 't0')")
        conn.commit()
        assert task_ext.ensure_core_schema(_NoCommit(conn)) is True
        assert task_ext.ensure_core_schema(_NoCommit(conn)) is False
        cols = {r["name"]: r for r in conn.execute("PRAGMA table_info(tasks)").fetchall()}
        for c in RAW:
            assert cols[c]["type"] == "TEXT", c
            assert cols[c]["notnull"] == 0, c
            assert cols[c]["dflt_value"] is None, c
        assert tuple(conn.execute("SELECT ext_core_at, ext_only_at FROM tasks").fetchone()) == (None, None)
        # idempoten per kolom: hanya kolom yang hilang yang ditambahkan
        conn.execute("ALTER TABLE tasks DROP COLUMN ext_only_at")
        assert task_ext.ensure_core_schema(conn) is True
        assert task_ext.ensure_core_schema(conn) is False
        assert set(RAW) <= {r[1] for r in conn.execute("PRAGMA table_info(tasks)").fetchall()}
    finally:
        conn.close()
    empty = dbconn.connect(str(tmp_path / "kosong.db"))
    try:
        assert task_ext.ensure_core_schema(empty) is False
        assert empty.execute("SELECT name FROM sqlite_master").fetchall() == []
    finally:
        empty.close()


def test_migrate_db_adds_core_cols_idempotent(monkeypatch, tmp_path):
    legacy = str(tmp_path / "legacy.db")
    monkeypatch.setattr(webapp, "DB_PATH", legacy)
    webapp.migrate_db()
    conn = dbconn.connect(legacy, foreign_keys=False)
    try:
        assert set(RAW) <= {r[1] for r in conn.execute("PRAGMA table_info(tasks)")}
        for c in RAW:
            conn.execute(f"ALTER TABLE tasks DROP COLUMN {c}")
        conn.execute("INSERT INTO tasks (title, created_at, updated_at) VALUES ('lama', 't', 't')")
        conn.commit()
        assert not set(RAW) & {r[1] for r in conn.execute("PRAGMA table_info(tasks)")}
    finally:
        conn.close()
    webapp.migrate_db()
    webapp.migrate_db()
    conn = dbconn.connect(legacy)
    try:
        cols = {r[1]: r for r in conn.execute("PRAGMA table_info(tasks)")}
        for c in RAW:
            assert cols[c][2] == "TEXT" and cols[c][3] == 0 and cols[c][4] is None, c
        row = conn.execute("SELECT * FROM tasks WHERE title = 'lama'").fetchone()
        assert (row["ext_core_at"], row["ext_only_at"]) == (None, None)  # tanpa backfill
        assert webapp.task_row_to_dict(row, conn)["core_updated_at"] == "t"
    finally:
        conn.close()
    calls = _calls_in(ast.parse(inspect.getsource(webapp.migrate_db)))
    core = [c for c in calls if c[1] == "task_ext.ensure_core_schema"]
    assert len(core) == 1 and core[0][2] == ["conn"]
    ext = [c[0] for c in calls if c[1] == "task_ext.ensure_schema"]
    plug = [c[0] for c in calls if c[1] == "plugin_loader.migrate"]
    commits = [c[0] for c in calls if c[1] == "conn.commit"]
    assert ext and plug and ext[0] < core[0][0] < plug[0]
    assert any(core[0][0] < ln < plug[0] for ln in commits)  # di blok yang sama, sebelum commit-nya


# ── API (R2, R3) ──────────────────────────────────────────────────────────────

def test_post_and_get_have_core_equal_updated_at(client, demo_index):
    u = U(client, "cp")
    t = _post(u, title="induk", ext={"demo-ext.a": 1})
    assert t["core_updated_at"] == t["updated_at"]
    assert not set(RAW) & set(t)
    child = _post(u, title="anak", parent_id=t["id"])
    done = _post(u, title="selesai", gtd_status="done")
    one = _get(u, t["id"])
    assert one["core_updated_at"] == one["updated_at"] == t["updated_at"]
    assert not set(RAW) & set(one)
    lst = {x["id"]: x for x in _ok(u.get("/api/tasks?include_done=true"))}
    for x in (t, child, done):
        got = lst[x["id"]]
        assert got["core_updated_at"] == got["updated_at"] == x["updated_at"]
        assert not set(RAW) & set(got)
    kids = _ok(u.get(f"/api/tasks/{t['id']}/child-tasks"))
    assert [k["core_updated_at"] for k in kids] == [child["updated_at"]]
    assert _db_row(t["id"]) == {"updated_at": t["updated_at"], "ext_core_at": None, "ext_only_at": None}


def test_pure_ext_put_freezes_core(client, demo_index):
    u = U(client, "pf")
    t = _post(u, title="a")
    tid, t0 = t["id"], t["updated_at"]
    one = _put(u, tid, ext_patch={"demo-ext.a": 1})
    assert _ts(one["updated_at"]) > _ts(t0)
    assert one["core_updated_at"] == t0
    assert one["ext"] == {"demo-ext.a": 1}
    assert not set(RAW) & set(one)
    two = _put(u, tid, ext_patch={"demo-ext.b": 2})
    assert _ts(two["updated_at"]) > _ts(one["updated_at"])
    assert two["core_updated_at"] == t0
    assert _get(u, tid)["core_updated_at"] == t0
    lst = {x["id"]: x for x in _ok(u.get("/api/tasks?include_done=true"))}
    assert lst[tid]["core_updated_at"] == t0 and lst[tid]["updated_at"] == two["updated_at"]
    assert _db_row(tid) == {"updated_at": two["updated_at"], "ext_core_at": t0, "ext_only_at": two["updated_at"]}


def test_core_put_after_freeze_moves_core(client, demo_index):
    u = U(client, "cm")
    t = _post(u, title="a")
    tid = t["id"]
    core0, at1 = _freeze(u, tid)
    assert core0 == t["updated_at"]
    titled = _put(u, tid, title="judul baru")
    _assert_core_is_updated_at(titled, core0, at1)
    nxt = _put(u, tid, ext_patch={"demo-ext.b": 2})
    assert _ts(nxt["updated_at"]) > _ts(titled["updated_at"])
    assert nxt["core_updated_at"] == titled["updated_at"]  # beku di waktu PUT judul


# nama → (body dari task terkini, dibekukan?). Keputusan "murni" hanya dari body (K46), bukan dari nilai yang sama.
NOT_PURE = {
    "ext+gtd_status": (lambda t: {"ext_patch": {"demo-ext.x": 1}, "gtd_status": "next"}, False),
    "ext+title": (lambda t: {"ext_patch": {"demo-ext.x": 1}, "title": "lain"}, False),
    # klien lama: payload penuh dengan inti SAMA + ext_patch → tetap tidak dibekukan
    "payload-penuh-inti-sama+ext": (lambda t: _full_payload(t, ext_patch={"demo-ext.x": 1}), False),
    "ext+recurrence_renew": (lambda t: {"ext_patch": {"demo-ext.x": 1}, "recurrence_renew": True}, False),
    "title-saja": (lambda t: {"title": "lain"}, False),
    # kontrol: `null` = tidak dikirim di server → tetap PUT ext murni → beku
    "ext+title-null+progress-null": (lambda t: {"ext_patch": {"demo-ext.x": 1}, "title": None, "progress": None},
                                     True),
}


@pytest.mark.parametrize("name", list(NOT_PURE))
def test_put_not_pure_never_freezes(client, demo_index, name):
    body_of, frozen = NOT_PURE[name]
    u = U(client, "np")
    t = _post(u, title="a")
    tid = t["id"]
    core0, at1 = _freeze(u, tid)
    out = _put(u, tid, **body_of(_get(u, tid)))
    if frozen:
        assert out["title"] == "a"
        assert _ts(out["updated_at"]) > _ts(at1)
        assert out["core_updated_at"] == _get(u, tid)["core_updated_at"] == core0
        assert _db_row(tid) == {"updated_at": out["updated_at"], "ext_core_at": core0,
                                "ext_only_at": out["updated_at"]}
        return
    _assert_core_is_updated_at(out, core0, at1)
    _assert_core_is_updated_at(_get(u, tid), core0, at1)
    assert _db_row(tid) == {"updated_at": out["updated_at"], "ext_core_at": core0, "ext_only_at": at1}


def test_pure_ext_put_rejected_rolls_back_freeze(client, demo_index):
    u = U(client, "rb")
    t = _post(u, title="a")
    tid = t["id"]
    _freeze(u, tid)
    _put(u, tid, title="inti")  # ikatan putus: pembekuan berhasil akan mengubah KETIGA kolom
    before = _db_row(tid)
    big = {"demo-ext.v": "x" * (task_ext.TOTAL_MAX_BYTES + 1)}
    r = u._call("put", f"/api/tasks/{tid}", json={"ext_patch": big})
    assert r.status_code == 422, r.text
    assert r.json()["detail"]["code"] == "EXT_TOO_LARGE"
    assert _db_row(tid) == before
    got = _get(u, tid)
    assert got["core_updated_at"] == got["updated_at"] == before["updated_at"]


def test_freeze_reads_current_row_not_stale_existing(client, demo_index, monkeypatch):
    """`existing` dibaca SEBELUM BEGIN IMMEDIATE (dbconn K3): penulis inti konkuren yang commit di antaranya harus
    menjadi waktu inti (CASE membaca baris terkini), bukan nilai beku lama dari `existing` basi."""
    u = U(client, "rc")
    t = _post(u, title="a")
    tid = t["id"]
    core0, at1 = _freeze(u, tid)
    real = webapp._can_access_task
    raced = {}

    def racing(conn, task_id, user_id, write=False):
        row = real(conn, task_id, user_id, write=write)  # baris ini menjadi `existing` basi
        if write and not raced:
            raced["at"] = datetime.now().isoformat()
            _exec("UPDATE tasks SET title = ?, updated_at = ? WHERE id = ?", "konkuren", raced["at"], task_id)
        return row

    monkeypatch.setattr(webapp, "_can_access_task", racing)
    out = _put(u, tid, ext_patch={"demo-ext.b": 2})
    assert raced, "penulis konkuren tidak berjalan"
    assert out["title"] == "konkuren"
    assert out["core_updated_at"] == raced["at"] != core0
    assert _ts(out["updated_at"]) > _ts(raced["at"]) > _ts(at1)
    assert _db_row(tid) == {"updated_at": out["updated_at"], "ext_core_at": raced["at"],
                            "ext_only_at": out["updated_at"]}


def test_unaware_writer_invalidates_freeze(client, demo_index):
    """Penulis yang tidak mengenal kolom (kode lama/rollback/penulis baru) cukup menaikkan `updated_at`."""
    u = U(client, "uw")
    t = _post(u, title="a")
    tid = t["id"]
    core0, at1 = _freeze(u, tid)
    new_at = datetime.now().isoformat()
    _exec("UPDATE tasks SET title = 'x', updated_at = ? WHERE id = ?", new_at, tid)
    got = _get(u, tid)
    assert got["core_updated_at"] == got["updated_at"] == new_at
    assert _db_row(tid) == {"updated_at": new_at, "ext_core_at": core0, "ext_only_at": at1}  # basi, tak berlaku
    nxt = _put(u, tid, ext_patch={"demo-ext.c": 3})
    assert nxt["core_updated_at"] == new_at


def test_rows_without_cols_or_null():
    t0, t1, t2 = "2026-11-04T09:00:00.000001", "2026-11-04T10:00:00.000002", "2026-11-04T11:00:00"
    d = {"id": 1, "title": "a", "updated_at": t1, "ext": {}}
    out = task_ext.apply_core_at(d)
    assert out is d
    assert d == {"id": 1, "title": "a", "updated_at": t1, "ext": {}, "core_updated_at": t1}
    for core in (None, ""):
        d = {"title": "a", "updated_at": t1, "ext_only_at": t1, "ext_core_at": core}
        assert task_ext.apply_core_at(d) == {"title": "a", "updated_at": t1, "core_updated_at": t1}
    cases = [
        ({"updated_at": t1, "ext_only_at": t1, "ext_core_at": t0}, t0),     # beku
        ({"updated_at": t2, "ext_only_at": t1, "ext_core_at": t0}, t2),     # ikatan putus
        ({"updated_at": t1, "ext_only_at": None, "ext_core_at": t0}, t1),
        ({"updated_at": t1, "ext_only_at": None, "ext_core_at": None}, t1),  # baris lama / POST
        ({"updated_at": None, "ext_only_at": None, "ext_core_at": t0}, None),
        ({}, None),
    ]
    for row, want in cases:
        snapshot = dict(row)
        assert task_ext.core_at_of(row) == want, row
        assert row == snapshot  # core_at_of tidak mengubah dict
        assert task_ext.apply_core_at(dict(row)) == {
            **{k: v for k, v in row.items() if k not in RAW}, "core_updated_at": want}


def test_core_freeze_set_sql_matches_core_at_of(tmp_path):
    """Nilai beku SQL (`CASE` atas baris lama) = `core_at_of` baris lama, di urutan SET mana pun."""
    s = task_ext.CORE_FREEZE_SET
    assert s.count("?") == 1 and all(c in s for c in RAW)
    t0, t1, t2, t3 = "2026-11-04T09:00:00", "2026-11-04T10:00:00.5", "2026-11-04T11:00:00.25", "2026-11-04T12:00:00"
    olds = [(t1, None, None), (t1, t1, t0), (t2, t1, t0), (t1, t1, None), (t1, t1, ""), (t1, None, t0), (t2, t2, t1)]
    conn = dbconn.connect(str(tmp_path / "f.db"))
    try:
        conn.execute("CREATE TABLE tasks (id INTEGER PRIMARY KEY, updated_at TEXT)")
        task_ext.ensure_core_schema(conn)
        for order in ("upd-dulu", "freeze-dulu"):
            for upd, only, core in olds:
                conn.execute("DELETE FROM tasks")
                conn.execute("INSERT INTO tasks (id, updated_at, ext_only_at, ext_core_at) VALUES (1, ?, ?, ?)",
                             (upd, only, core))
                want = task_ext.core_at_of({"updated_at": upd, "ext_only_at": only, "ext_core_at": core})
                sets = ["updated_at = ?", s] if order == "upd-dulu" else [s, "updated_at = ?"]
                vals = [t3, t3]
                conn.execute(f"UPDATE tasks SET {', '.join(sets)} WHERE id = 1", vals)
                row = dict(conn.execute("SELECT updated_at, ext_core_at, ext_only_at FROM tasks").fetchone())
                assert row == {"updated_at": t3, "ext_core_at": want, "ext_only_at": t3}, (order, upd, only, core)
                assert task_ext.core_at_of(row) == want
        conn.commit()
    finally:
        conn.close()


# ── Matriks penulis `updated_at` (R8(c)): satu kasus per baris tabel R1 selain PUT ─────────────

def _w_done(client):
    u = U(client, "wd")
    tid = _post(u, title="a")["id"]
    return u, tid, lambda: _ok(u.post(f"/api/tasks/{tid}/done")), lambda t: t["gtd_status"] == "done"


def _w_focus(client):
    u = U(client, "wf")
    tid = _post(u, title="a")["id"]
    return u, tid, lambda: _ok(u.post(f"/api/tasks/{tid}/focus")), lambda t: t["is_focused"] is True


def _w_move_workspace(client):
    u = U(client, "wm")
    lid = _mk_list(u, name="tujuan")
    tid = _post(u, title="a")["id"]
    run = lambda: _ok(u._call("patch", f"/api/tasks/{tid}/workspace", json={"list_id": lid}))  # noqa: E731
    return u, tid, run, lambda t: t["list_id"] == lid


def _project_case(prefix, rename):
    def case(client):
        u = U(client, prefix)
        t = _post(u, title="a", project="Proyek " + uuid.uuid4().hex[:6])
        pid, new = t["project_id"], "Baru " + uuid.uuid4().hex[:6]
        assert pid

        def run():
            if rename:
                _ok(u._call("patch", f"/api/projects/{pid}", json={"name": new}))
            else:
                _ok(u.delete(f"/api/projects/{pid}"))
        want = (new, pid) if rename else ("", None)
        return u, t["id"], run, lambda g: (g["project"], g["project_id"]) == want
    return case


def _context_case(prefix, rename):
    def case(client):
        u = U(client, prefix)
        t = _post(u, title="a", context="Tahap " + uuid.uuid4().hex[:6])
        cid, new = t["context_id"], "Baru " + uuid.uuid4().hex[:6]
        assert cid

        def run():
            if rename:
                _ok(u._call("patch", f"/api/contexts/{cid}", json={"name": new}))
            else:
                _ok(u.delete(f"/api/contexts/{cid}"))
        want = (new, cid) if rename else ("", None)
        return u, t["id"], run, lambda g: (g["context"], g["context_id"]) == want
    return case


def _w_bot_update(client):
    u = U(client, "wb")
    tid = _post(u, title="a")["id"]

    def run():
        repo = TaskRepository(webapp.DB_PATH)
        task = repo.get(tid)
        task.title = "dari bot"
        repo.update(task)
    return u, tid, run, lambda t: t["title"] == "dari bot"


def _w_bot_toggle_focus(client):
    u = U(client, "wt")
    tid = _post(u, title="a")["id"]

    def run():
        assert TaskRepository(webapp.DB_PATH).toggle_focus(tid) is True
    return u, tid, run, lambda t: t["is_focused"] is True


def _w_remove_list_member(client):
    a, b = U(client, "wra"), U(client, "wrb")
    lid = _mk_list(a, b, name="ws")
    tid = _post(a, title="a", list_id=lid, assigned_to=b.id)["id"]
    assert _get(a, tid)["assigned_to"] == b.id

    def run():
        assert TaskRepository(webapp.DB_PATH).remove_list_member(lid, b.id) is True
    return a, tid, run, lambda t: t["assigned_to"] is None and t["list_id"] == lid


def _w_return_to_creator(client):
    a = U(client, "wx")
    lid = _mk_list(a, name="dihapus")
    tid = _post(a, title="a", list_id=lid)["id"]

    def run():
        _ok(a.delete(f"/api/lists/{lid}"))  # delete_shared_list → _return_tasks_to_creator
    return a, tid, run, lambda t: t["list_id"] is None


WRITERS = {
    "webapp-done": _w_done,
    "webapp-focus": _w_focus,
    "webapp-pindah-workspace": _w_move_workspace,
    "webapp-ganti-nama-project": _project_case("wpr", rename=True),
    "webapp-hapus-project": _project_case("wpd", rename=False),
    "webapp-ganti-nama-tahap": _context_case("wcr", rename=True),
    "webapp-hapus-tahap": _context_case("wcd", rename=False),
    "repository-update-bot": _w_bot_update,
    "repository-toggle-focus-bot": _w_bot_toggle_focus,
    "repository-remove-list-member": _w_remove_list_member,
    "repository-return-tasks-to-creator": _w_return_to_creator,
}


@pytest.mark.parametrize("name", list(WRITERS))
def test_writers_after_freeze_bump_core(client, demo_index, name):
    viewer, tid, run, applied = WRITERS[name](client)
    core0, at1 = _freeze(viewer, tid)
    out = run()
    if out is not None:  # respons endpoint yang mengembalikan task
        _assert_core_is_updated_at(out, core0, at1)
    got = _get(viewer, tid)
    assert applied(got), got
    _assert_core_is_updated_at(got, core0, at1)
    # penulis ini tidak menyentuh kolom mentah: waktu inti benar karena ikatan (K45)
    assert _db_row(tid) == {"updated_at": got["updated_at"], "ext_core_at": core0, "ext_only_at": at1}


def _n_pomodoro(client):
    u = U(client, "np")
    tid = _post(u, title="a")["id"]

    def run():
        body = {"client_id": uuid.uuid4().hex, "kind": "session", "pomodoros": 1, "focus_seconds": 1500,
                "log_date": date.today().isoformat(), "ended_at": datetime.now().isoformat()}
        assert _ok(u.post(f"/api/tasks/{tid}/pomodoros", json=body))["pomodoros_done"] == 1
    return u, tid, run


def _wrong_quadrant(tid):
    cur = _rows("SELECT quadrant FROM tasks WHERE id = ?", tid)[0]["quadrant"]
    wrong = "Q1" if cur != "Q1" else "Q4"
    _exec("UPDATE tasks SET quadrant = ? WHERE id = ?", wrong, tid)
    return cur, wrong


def _n_recalculate(client):
    u = U(client, "nr")
    tid = _post(u, title="a")["id"]

    def run():
        right, _ = _wrong_quadrant(tid)
        assert _ok(u.post("/api/recalculate"))["changed"] >= 1
        assert _rows("SELECT quadrant FROM tasks WHERE id = ?", tid)[0]["quadrant"] == right
    return u, tid, run


def _n_quadrant_cron(client):
    u = U(client, "nq")
    tid = _post(u, title="a")["id"]

    def run():  # cron kuadran bot (repository.update_quadrant)
        cur = _rows("SELECT quadrant FROM tasks WHERE id = ?", tid)[0]["quadrant"]
        other = "Q1" if cur != "Q1" else "Q4"
        TaskRepository(webapp.DB_PATH).update_quadrant(tid, Quadrant(other))
        assert _rows("SELECT quadrant FROM tasks WHERE id = ?", tid)[0]["quadrant"] == other
    return u, tid, run


def _n_check_expiry(client):
    u = U(client, "ne")
    tid = _post(u, title="a", recurrence_type="daily")["id"]

    def run():
        _exec("UPDATE tasks SET recurrence_end_date = ? WHERE id = ?",
              (date.today() + timedelta(days=3)).isoformat(), tid)
        assert "week" in _ok(u.post("/api/recurring/check-expiry"))["notified"]
        assert _rows("SELECT recurrence_notif_level FROM tasks WHERE id = ?", tid)[0][0] == "week"
    return u, tid, run


NO_UPDATED_AT = {
    "pomodoro": _n_pomodoro,
    "recalculate": _n_recalculate,
    "kuadran-cron": _n_quadrant_cron,
    "check-expiry": _n_check_expiry,
}


@pytest.mark.parametrize("name", list(NO_UPDATED_AT))
def test_writers_without_updated_at_keep_core(client, demo_index, name):
    u, tid, run = NO_UPDATED_AT[name](client)
    core0, at1 = _freeze(u, tid)
    before = _db_row(tid)
    run()
    assert _db_row(tid) == before == {"updated_at": at1, "ext_core_at": core0, "ext_only_at": at1}
    got = _get(u, tid)
    assert (got["updated_at"], got["core_updated_at"]) == (at1, core0)


def test_rev_mismatch_current_has_core(client, demo_index):
    u = U(client, "rv")
    t = _post(u, title="a")
    core0, at1 = _freeze(u, t["id"])
    r = u._call("put", f"/api/tasks/{t['id']}", json={"title": "basi", "base_rev": "2000-01-01T00:00:00"})
    assert r.status_code == 409, r.text
    cur = r.json()["detail"]["current"]
    assert cur["core_updated_at"] == core0 == t["updated_at"]
    assert cur["updated_at"] == at1
    assert not set(RAW) & set(cur)
    assert set(cur) == set(_get(u, t["id"]))


def test_k6_and_payload_unchanged(client, demo_index):
    a, b = U(client, "ka"), U(client, "kb")
    list_id = _mk_list(a, b, name="ws")
    t = _post(a, title="rapat", list_id=list_id)
    tid = t["id"]
    frozen = _put(a, tid, ext_patch={"demo-ext.a": 1})
    assert frozen["core_updated_at"] == t["updated_at"]
    assert _updates(b.id, tid) == []  # K6: PUT ext murni tanpa notifikasi
    titled = _put(a, tid, title="rapat baru")
    assert titled["core_updated_at"] == titled["updated_at"]
    assert len(_updates(b.id, tid)) == 1
    # Payload PUT tidak berubah: tidak ada field baru; nilai kiriman klien untuk waktu inti diabaikan
    assert not ({"core_updated_at", *RAW} & set(webapp.TaskUpdate.model_fields))
    old = "2000-01-01T00:00:00"
    spoof = _put(a, tid, ext_patch={"demo-ext.b": 2}, core_updated_at=old, ext_core_at=old, ext_only_at=old)
    assert spoof["core_updated_at"] == titled["updated_at"]
    assert _db_row(tid) == {"updated_at": spoof["updated_at"], "ext_core_at": titled["updated_at"],
                            "ext_only_at": spoof["updated_at"]}
    assert len(_updates(b.id, tid)) == 1
    assert set(spoof) == set(_get(a, tid))


# ── Pagar (R8(a), R8(b)) ──────────────────────────────────────────────────────

def _prod_sources():
    """`*.py` akar repo + modul server plugin (`plugins/*.py`), sama dengan cakupan pagar dbconn."""
    paths = sorted([*ROOT.glob("*.py"), *ROOT.glob("plugins/*.py")])
    return [(p.relative_to(ROOT).as_posix(), p.read_text(encoding="utf-8")) for p in paths]


def _func(tree, name):
    hits = [n for n in ast.walk(tree)
            if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) and n.name == name]
    assert len(hits) == 1, name
    return hits[0]


def _attr_refs(node, mod, attr):
    return [n for n in ast.walk(node) if isinstance(n, ast.Attribute) and n.attr == attr
            and isinstance(n.value, ast.Name) and n.value.id == mod]


def test_core_cols_only_in_task_ext():
    sources = dict(_prod_sources())
    assert "task_ext.py" in sources and "webapp.py" in sources and "repository.py" in sources
    leaks = {rel: [c for c in RAW if c in text] for rel, text in sources.items() if rel != "task_ext.py"}
    assert {rel: cs for rel, cs in leaks.items() if cs} == {}, \
        "nama kolom waktu inti hanya boleh di task_ext.py (ikatan K45: penulis lain tidak menyentuh kolom)"
    assert all(c in sources["task_ext.py"] for c in RAW)
    # Satu-satunya penulis kolom: PUT (update_task) lewat task_ext.CORE_FREEZE_SET
    others = [rel for rel, text in sources.items()
              if "CORE_FREEZE_SET" in text and rel not in ("task_ext.py", "webapp.py")]
    assert others == []
    tree = ast.parse(sources["webapp.py"])
    assert len(_attr_refs(tree, "task_ext", "CORE_FREEZE_SET")) == 1
    assert len(_attr_refs(_func(tree, "update_task"), "task_ext", "CORE_FREEZE_SET")) == 1
    # Semua keluaran task API lewat task_row_to_dict → task_ext.apply_core_at (core_updated_at, kolom dibuang)
    assert len(_attr_refs(tree, "task_ext", "apply_core_at")) == 1
    fn = _func(tree, "task_row_to_dict")
    refs = _attr_refs(fn, "task_ext", "apply_core_at")
    calls = [n for n in ast.walk(fn) if isinstance(n, ast.Call) and n.func in refs]
    assert len(refs) == 1 and len(calls) == 1 and [ast.unparse(x) for x in calls[0].args] == ["d"]


# Pernyataan `UPDATE tasks SET …` yang menaikkan `updated_at` (tabel R1 rencana 1c-0b). Semua otomatis benar
# berkat ikatan K45 (penulis yang tidak mengenal kolom waktu inti membatalkan pembekuan); hanya PUT yang menulis
# kolom itu. Penulis baru/hilang → tinjau nilainya (`datetime.now().isoformat()`, naif) dan ADR-044, lalu ubah angka.
AUDIT = {
    # PUT /api/tasks/{id} (set_clause dinamis, `updates["updated_at"]` selalu ada; CORE_FREEZE_SET bila pure_ext)
    # PATCH /api/tasks/{id}/workspace (pindah ke workspace) · POST /api/tasks/{id}/done · POST /api/tasks/{id}/focus
    # PATCH /api/projects/{id} (ganti nama → tasks.project) · DELETE /api/projects/{id}
    # PATCH /api/contexts/{id} (ganti nama tahap → tasks.context) · DELETE /api/contexts/{id}
    "webapp.py": 8,
    # _return_tasks_to_creator (hapus workspace, heal task yatim) · TaskRepository.update (bot, NLP)
    # TaskRepository.toggle_focus (bot) · TaskRepository.remove_list_member (lepas penanggung jawab)
    "repository.py": 4,
}

_UPDATE_TASKS = re.compile(r"\bUPDATE\s+(?:OR\s+\w+\s+)?tasks\s+SET\b", re.IGNORECASE)
_WHERE = re.compile(r"\bWHERE\b", re.IGNORECASE)
_SET_CLAUSE_MARK = "{set_clause}"  # f-string PUT update_task: SET dinamis, `updated_at` selalu ikut


def _updated_at_writers(text):
    """Nomor baris setiap `UPDATE tasks SET` yang menulis `updated_at` (sampai WHERE terdekat, ≤ 400 karakter)."""
    out = []
    for m in _UPDATE_TASKS.finditer(text):
        seg = text[m.end():m.end() + 400]
        w = _WHERE.search(seg)
        if w:
            seg = seg[:w.start()]
        if "updated_at" in seg or _SET_CLAUSE_MARK in seg:
            out.append(text.count("\n", 0, m.start()) + 1)
    return out


def test_task_updated_at_writers_audit():
    # kontrol kepekaan pemindai
    assert len(_updated_at_writers('conn.execute("UPDATE tasks SET x=?, updated_at=? WHERE id=?")')) == 1
    assert _updated_at_writers('conn.execute("UPDATE tasks SET quadrant=? WHERE id=?")') == []
    assert len(_updated_at_writers('f"UPDATE tasks SET {set_clause} WHERE id = ?"')) == 1
    assert len(_updated_at_writers('"UPDATE tasks SET a = ?, "\n    "updated_at = ? WHERE " + w')) == 1
    assert len(_updated_at_writers('"update or ignore tasks set updated_at=?"')) == 1
    assert _updated_at_writers('"UPDATE tasks SET quadrant=? WHERE updated_at < ?"') == []
    assert _updated_at_writers('"UPDATE tasks_x SET updated_at=? WHERE id=?"') == []
    found = {}
    for rel, text in _prod_sources():
        lines = _updated_at_writers(text)
        if lines:
            found[rel] = lines
    for rel in sorted(set(found) | set(AUDIT)):
        assert len(found.get(rel, [])) == AUDIT.get(rel, 0), (
            f"penulis `updated_at` task berubah di {rel} (baris {found.get(rel, [])}): pastikan nilainya "
            f"`datetime.now().isoformat()` (naif) dan tinjau ADR-044, lalu perbarui AUDIT")
    # penanda set_clause hanya di PUT
    tree = ast.parse(dict(_prod_sources())["webapp.py"])
    fn = _func(tree, "update_task")
    put_lines = [ln for ln in found["webapp.py"] if fn.lineno <= ln <= fn.end_lineno]
    assert len(put_lines) == 1
