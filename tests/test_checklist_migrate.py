"""`migrate_db` — pembersihan induk checklist yatim dan hitung ulang progress setiap start
(spec checklist bertingkat §3.3, §3.4, K15; rencana PR A T7, R8). Idempoten, tanpa `updated_at`."""
import inspect
import sqlite3
from contextlib import contextmanager

import pytest

import checklist_tree
import dbconn
import webapp
from conftest import db
from repository import TaskRepository
from test_contexts_tasks import U, _mk

FROZEN = "2020-01-01T00:00:00"
NOL = {"orphans": 0, "recomputed": 0}


def _task_baru(u, **cols):
    tid = _mk(u, title="lama")["id"]
    conn = db()
    try:
        cols = {"updated_at": FROZEN, **cols}
        conn.execute(f"UPDATE tasks SET {', '.join(f'{k} = ?' for k in cols)} WHERE id = ?",
                     (*cols.values(), tid))
        conn.commit()
    finally:
        conn.close()
    return tid


def _ins(task_id, title="x", parent_id=None, sort_order=0, is_done=0):
    conn = db()
    try:
        cur = conn.execute(
            "INSERT INTO subtasks (task_id, title, is_done, sort_order, created_at, parent_id) "
            "VALUES (?,?,?,?,?,?)", (task_id, title, is_done, sort_order, FROZEN, parent_id))
        conn.commit()
        return cur.lastrowid
    finally:
        conn.close()


def _exec(sql, *params):
    conn = db()
    try:
        conn.execute(sql, params)
        conn.commit()
    finally:
        conn.close()


def _task(tid):
    conn = db()
    try:
        return dict(conn.execute(
            "SELECT progress, checklist_total, updated_at FROM tasks WHERE id = ?", (tid,)).fetchone())
    finally:
        conn.close()


def _parent(sid):
    conn = db()
    try:
        return conn.execute("SELECT parent_id FROM subtasks WHERE id = ?", (sid,)).fetchone()[0]
    finally:
        conn.close()


@pytest.fixture
def u(client):
    return U(client, "mg")


# ── checklist_tree.recompute_all (SQL, hanya koneksi pemanggil) ─────────────

def _mem_db():
    conn = sqlite3.connect(":memory:")   # row_factory tuple: seperti merge_db.py
    conn.executescript("""
        CREATE TABLE tasks (id INTEGER PRIMARY KEY, progress INTEGER DEFAULT 0,
                            checklist_total INTEGER DEFAULT 0, updated_at TEXT);
        CREATE TABLE subtasks (id INTEGER PRIMARY KEY, task_id INTEGER, parent_id INTEGER, is_done INTEGER);
        INSERT INTO tasks VALUES (1, 80, 0, 't'), (2, 70, 0, 't'), (3, 40, 2, 't'), (4, 100, 2, 't'),
                                 (5, 15, NULL, 't');
        INSERT INTO subtasks VALUES (10, 1, NULL, 1), (11, 1, NULL, 0), (12, 1, NULL, 0),
                                    (13, 1, 10, 1), (14, 1, 13, 1),
                                    (20, 4, NULL, 1), (21, 4, NULL, 1);
    """)
    return conn


def test_recompute_all_hanya_menulis_baris_berbeda_tanpa_updated_at():
    conn = _mem_db()
    try:
        assert checklist_tree.recompute_all(conn) == 3   # task 1 (dihitung), 3 (total 0), 5 (NULL → 0)
        assert conn.execute("SELECT id, progress, checklist_total, updated_at FROM tasks ORDER BY id").fetchall() == [
            (1, 33, 3, "t"), (2, 70, 0, "t"), (3, 40, 0, "t"), (4, 100, 2, "t"), (5, 15, 0, "t")]
        n = conn.total_changes
        assert checklist_tree.recompute_all(conn) == 0
        assert conn.total_changes == n
    finally:
        conn.close()


# ── heal_checklists lewat migrate_db ────────────────────────────────────────

def test_migrate_menghitung_ulang_progress_task_lama_bercheklist(u):
    tid = _task_baru(u, progress=80, checklist_total=0)
    _ins(tid, "a", is_done=1)
    _ins(tid, "b")
    _ins(tid, "c")
    webapp.migrate_db()
    assert _task(tid) == {"progress": 33, "checklist_total": 3, "updated_at": FROZEN}


def test_migrate_task_tanpa_checklist_progress_tetap(u):
    tid = _task_baru(u, progress=70)
    webapp.migrate_db()
    assert _task(tid) == {"progress": 70, "checklist_total": 0, "updated_at": FROZEN}


def test_migrate_checklist_total_basi_tanpa_butir_jadi_0_progress_tetap(u):
    tid = _task_baru(u, progress=55, checklist_total=2)
    webapp.migrate_db()
    assert _task(tid) == {"progress": 55, "checklist_total": 0, "updated_at": FROZEN}


def test_migrate_induk_yatim_dan_task_lain_jadi_null(u):
    tid = _task_baru(u)
    lain = _task_baru(u)
    x = _ins(lain, "x")
    a = _ins(tid, "a", sort_order=0, is_done=1)
    o = _ins(tid, "yatim", parent_id=987654321, sort_order=1)
    lt = _ins(tid, "lintas", parent_id=x, sort_order=2)
    anak = _ins(tid, "anak", parent_id=a)
    webapp.migrate_db()
    assert (_parent(o), _parent(lt), _parent(anak)) == (None, None, a)
    assert _task(tid) == {"progress": 33, "checklist_total": 3, "updated_at": FROZEN}
    assert _task(lain)["updated_at"] == FROZEN


def test_migrate_siklus_dua_butir_terlihat_dan_dihitung_konsisten(u):
    tid = _task_baru(u)
    p = _ins(tid, "p", sort_order=0, is_done=1)
    q = _ins(tid, "q", parent_id=p, sort_order=1)
    _exec("UPDATE subtasks SET parent_id = ? WHERE id = ?", q, p)
    webapp.migrate_db()
    repo = TaskRepository(webapp.DB_PATH)
    items = repo.get_subtasks(tid)
    assert [(s["id"], s["depth"], s["parent_id"]) for s in items] == [(p, 0, None), (q, 1, p)]
    assert (_parent(p), _parent(q)) == (None, p)
    assert repo.get_subtask_progress(tid) == (1, 1)
    assert _task(tid) == {"progress": 100, "checklist_total": 1, "updated_at": FROZEN}


def test_migrate_kedua_tidak_menulis_apa_pun(u, monkeypatch):
    tid = _task_baru(u, progress=80)
    _ins(tid, "a", parent_id=987654321)
    hasil = []
    asli = TaskRepository.heal_checklists

    def catat(self):
        hasil.append(asli(self))
        return hasil[-1]

    monkeypatch.setattr(TaskRepository, "heal_checklists", catat)
    webapp.migrate_db()
    webapp.migrate_db()
    assert hasil[0]["orphans"] >= 1 and hasil[0]["recomputed"] >= 1
    assert hasil[1] == NOL
    assert _task(tid) == {"progress": 0, "checklist_total": 1, "updated_at": FROZEN}

    repo = TaskRepository(webapp.DB_PATH)
    tulis = []
    asli_connect = repo._connect

    @contextmanager
    def connect():
        with asli_connect() as conn:
            yield conn
            tulis.append(conn.total_changes)

    monkeypatch.setattr(repo, "_connect", connect)
    assert asli(repo) == NOL
    assert tulis == [0]


def test_heal_checklists_satu_write_tx(monkeypatch):
    asli = dbconn.write_tx
    panggil = []

    @contextmanager
    def mata_mata(conn):
        panggil.append(conn.in_transaction)
        with asli(conn) as c:
            yield c

    monkeypatch.setattr(dbconn, "write_tx", mata_mata)
    TaskRepository(webapp.DB_PATH).heal_checklists()
    assert panggil == [False]


def test_migrate_db_memanggil_heal_checklists_tepat_setelah_heal_orphan_workspace_items():
    src = inspect.getsource(webapp.migrate_db)
    i = src.index("heal_orphan_workspace_items()")
    j = src.index("heal_checklists()")
    assert i < j and src.count("heal_checklists()") == 1
    # tidak ada pemanggilan lain di antara keduanya (hanya komentar dan penerima `repo.`)
    antara = [ln.strip() for ln in src[i + len("heal_orphan_workspace_items()"):j].splitlines()
              if ln.strip() and not ln.strip().startswith("#")]
    assert antara == ["repo."]
