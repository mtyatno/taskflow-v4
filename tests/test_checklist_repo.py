"""Checklist bertingkat di `TaskRepository` (spec §3–§5, §10; rencana PR A T2–T4, R2–R6).

Semua operasi tulis checklist berjalan dalam satu `dbconn.write_tx`, menghitung ulang `tasks.progress`
dan `tasks.checklist_total` dari butir level atas, dan TIDAK PERNAH menaikkan `tasks.updated_at`.
"""
import sqlite3
import uuid
from contextlib import contextmanager

import pytest

import dbconn
import webapp
from conftest import db
from repository import ChecklistError, TaskRepository, _recompute_progress
from test_contexts_tasks import U, _mk

FROZEN = "2020-01-01T00:00:00"
KEYS = {"id", "task_id", "parent_id", "depth", "title", "is_done", "sort_order"}


@pytest.fixture
def repo():
    return TaskRepository(webapp.DB_PATH)


@pytest.fixture
def u(client):
    return U(client, "cl")


@pytest.fixture
def tid(u):
    """Task baru dengan updated_at dibekukan (supaya kenaikan apa pun terlihat)."""
    t = _mk(u, title="checklist")
    _set_task(t["id"], updated_at=FROZEN)
    return t["id"]


def _set_task(task_id, **cols):
    conn = db()
    try:
        sets = ", ".join(f"{k} = ?" for k in cols)
        conn.execute(f"UPDATE tasks SET {sets} WHERE id = ?", (*cols.values(), task_id))
        conn.commit()
    finally:
        conn.close()


def _task(task_id):
    conn = db()
    try:
        return dict(conn.execute(
            "SELECT progress, checklist_total, updated_at FROM tasks WHERE id = ?", (task_id,)).fetchone())
    finally:
        conn.close()


def _ins(task_id, title="x", parent_id=None, sort_order=0, is_done=0):
    """Sisipkan butir langsung (meniru data lama / keadaan tertentu)."""
    conn = db()
    try:
        cur = conn.execute(
            "INSERT INTO subtasks (task_id, title, is_done, sort_order, created_at, parent_id) "
            "VALUES (?,?,?,?,?,?)", (task_id, title, is_done, sort_order, FROZEN, parent_id))
        conn.commit()
        return cur.lastrowid
    finally:
        conn.close()


def _rows(task_id):
    conn = db()
    try:
        return [dict(r) for r in conn.execute(
            "SELECT id, parent_id, sort_order, is_done, title FROM subtasks WHERE task_id = ? ORDER BY id",
            (task_id,)).fetchall()]
    finally:
        conn.close()


def _view(repo, task_id):
    """(id, depth) menurut urutan get_subtasks."""
    return [(s["id"], s["depth"]) for s in repo.get_subtasks(task_id)]


def _orders(repo, task_id, parent_id=None):
    """sort_order kelompok saudara menurut urutan tampil."""
    return [s["sort_order"] for s in repo.get_subtasks(task_id) if s["parent_id"] == parent_id]


# ── Task 2: skema ───────────────────────────────────────────────────────────

def test_skema_kolom_parent_id_checklist_total_dan_indeks_ada():
    conn = db()
    try:
        sub = {r["name"]: r for r in conn.execute("PRAGMA table_info(subtasks)").fetchall()}
        tasks = {r["name"]: r for r in conn.execute("PRAGMA table_info(tasks)").fetchall()}
        idx = conn.execute(
            "SELECT sql FROM sqlite_master WHERE type='index' AND name='idx_subtasks_tree'").fetchone()
    finally:
        conn.close()
    assert "parent_id" in sub and sub["parent_id"]["type"] == "INTEGER" and sub["parent_id"]["dflt_value"] == "NULL"
    assert "checklist_total" in tasks and tasks["checklist_total"]["dflt_value"] == "0"
    assert idx is not None and "task_id, parent_id, sort_order" in idx["sql"]


def test_init_db_aman_dijalankan_berulang():
    TaskRepository(webapp.DB_PATH)
    TaskRepository(webapp.DB_PATH)


def test_init_db_menambah_kolom_ke_db_lama_tanpa_mengubah_data(tmp_path):
    p = str(tmp_path / "lama.db")
    conn = sqlite3.connect(p)
    conn.executescript("""
        CREATE TABLE tasks (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL,
            description TEXT DEFAULT '', gtd_status TEXT NOT NULL DEFAULT 'inbox',
            priority TEXT NOT NULL DEFAULT 'P3', quadrant TEXT NOT NULL DEFAULT 'Q4',
            project TEXT DEFAULT '', context TEXT DEFAULT '', deadline TEXT DEFAULT NULL,
            waiting_for TEXT DEFAULT '', user_id INTEGER DEFAULT NULL, created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL, completed_at TEXT DEFAULT NULL);
        CREATE TABLE subtasks (id INTEGER PRIMARY KEY AUTOINCREMENT, task_id INTEGER NOT NULL,
            title TEXT NOT NULL, is_done INTEGER DEFAULT 0, sort_order INTEGER DEFAULT 0,
            created_at TEXT NOT NULL, FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE);
        INSERT INTO tasks (title, created_at, updated_at) VALUES ('lama', 'x', 'x');
        INSERT INTO subtasks (task_id, title, sort_order, created_at) VALUES (1, 'b', 0, 'x'), (1, 'a', 0, 'x');
    """)
    conn.commit()
    conn.close()
    TaskRepository(p)
    r = TaskRepository(p)
    assert [(s["title"], s["parent_id"], s["depth"]) for s in r.get_subtasks(1)] == [
        ("b", None, 0), ("a", None, 0)]
    conn = sqlite3.connect(p)
    try:
        assert conn.execute("SELECT checklist_total, updated_at FROM tasks WHERE id = 1").fetchone() == (0, "x")
    finally:
        conn.close()


def test_checklisterror_turunan_valueerror_dengan_code():
    e = ChecklistError("CYCLE")
    assert isinstance(e, ValueError) and e.code == "CYCLE"


# ── Task 2: baca pre-order ──────────────────────────────────────────────────

def test_get_subtasks_bentuk_butir_preorder(repo, tid):
    a = _ins(tid, "a", sort_order=0, is_done=1)
    b = _ins(tid, "b", sort_order=1)
    a1 = _ins(tid, "a1", parent_id=a, sort_order=0)
    a11 = _ins(tid, "a11", parent_id=a1, sort_order=0)
    items = repo.get_subtasks(tid)
    assert [(s["id"], s["depth"]) for s in items] == [(a, 0), (a1, 1), (a11, 2), (b, 0)]
    assert all(set(s) == KEYS for s in items)
    assert items[0]["is_done"] is True and items[1]["is_done"] is False
    assert items[1]["parent_id"] == a and items[0]["parent_id"] is None
    assert items[0]["task_id"] == tid and items[0]["title"] == "a"


# ── Task 2: tambah ──────────────────────────────────────────────────────────

def test_tambah_tanpa_induk_level_atas_di_akhir(repo, tid):
    a = repo.add_subtask(tid, "a")
    b = repo.add_subtask(tid, "b")
    assert {"id", "task_id", "title", "is_done", "sort_order"} <= set(b)  # bentuk lama tetap
    assert KEYS | {"task_progress"} == set(b)
    assert b["parent_id"] is None and b["depth"] == 0 and b["is_done"] is False
    assert b["task_id"] == tid and b["title"] == "b" and b["sort_order"] == 1
    assert _view(repo, tid) == [(a["id"], 0), (b["id"], 0)]
    assert _orders(repo, tid) == [0, 1]


def test_tambah_dengan_induk_depth_1_tepat_di_bawah_induk(repo, tid):
    a = repo.add_subtask(tid, "a")
    b = repo.add_subtask(tid, "b")
    a1 = repo.add_subtask(tid, "a1", parent_id=a["id"])
    assert a1["parent_id"] == a["id"] and a1["depth"] == 1 and a1["sort_order"] == 0
    a11 = repo.add_subtask(tid, "a11", parent_id=a1["id"])
    assert a11["depth"] == 2
    assert _view(repo, tid) == [(a["id"], 0), (a1["id"], 1), (a11["id"], 2), (b["id"], 0)]


def test_tambah_index_0_di_antara_3_saudara(repo, tid):
    ids = [repo.add_subtask(tid, t)["id"] for t in ("a", "b", "c")]
    n = repo.add_subtask(tid, "baru", index=0)
    assert n["sort_order"] == 0
    assert [i for i, _ in _view(repo, tid)] == [n["id"], *ids]
    assert _orders(repo, tid) == [0, 1, 2, 3]


def test_tambah_index_tengah_dan_99_paling_akhir(repo, tid):
    ids = [repo.add_subtask(tid, t)["id"] for t in ("a", "b", "c")]
    m = repo.add_subtask(tid, "tengah", index=2)
    z = repo.add_subtask(tid, "akhir", index=99)
    assert z["sort_order"] == 4
    assert [i for i, _ in _view(repo, tid)] == [ids[0], ids[1], m["id"], ids[2], z["id"]]
    assert _orders(repo, tid) == [0, 1, 2, 3, 4]


def test_tambah_menomori_ulang_saudara_kembar_data_lama_tanpa_menyentuh_kelompok_lain(repo, tid):
    a = _ins(tid, "a", sort_order=0)
    b = _ins(tid, "b", sort_order=0)
    c = _ins(tid, "c", sort_order=0)
    x = _ins(tid, "x", parent_id=a, sort_order=7)
    n = repo.add_subtask(tid, "n", index=1)
    assert [i for i, _ in _view(repo, tid)] == [a, x, n["id"], b, c]
    assert _orders(repo, tid) == [0, 1, 2, 3]
    assert _orders(repo, tid, parent_id=a) == [7]  # kelompok lain tidak disentuh


def test_tambah_induk_task_lain_parent_not_found(repo, u, tid):
    lain = _mk(u, title="lain")["id"]
    p = repo.add_subtask(lain, "induk lain")
    with pytest.raises(ChecklistError) as ei:
        repo.add_subtask(tid, "anak", parent_id=p["id"])
    assert ei.value.code == "PARENT_NOT_FOUND"
    assert _rows(tid) == []


def test_tambah_induk_tidak_ada_parent_not_found(repo, tid):
    with pytest.raises(ChecklistError) as ei:
        repo.add_subtask(tid, "anak", parent_id=987654321)
    assert ei.value.code == "PARENT_NOT_FOUND"
    assert _rows(tid) == []


def test_tambah_judul_di_trim_dan_kosong_empty_title(repo, tid):
    assert repo.add_subtask(tid, "  rapi  ")["title"] == "rapi"
    for kosong in ("  ", "", "\n\t"):
        with pytest.raises(ChecklistError) as ei:
            repo.add_subtask(tid, kosong)
        assert ei.value.code == "EMPTY_TITLE"
    assert [r["title"] for r in _rows(tid)] == ["rapi"]


def test_tambah_client_id_sama_dua_kali_satu_baris_dengan_progress_terkini(repo, tid):
    cid = f"cid-{uuid.uuid4().hex}"
    a = repo.add_subtask(tid, "a", client_id=cid)
    repo.add_subtask(tid, "b")
    _set_task(tid, progress=77, checklist_total=9)  # nilai basi
    again = repo.add_subtask(tid, "a lagi", client_id=cid)
    assert again["id"] == a["id"] and again["title"] == "a" and set(again) == KEYS | {"task_progress"}
    assert again["task_progress"] == {"done": 0, "total": 2, "progress": 0}
    assert len(_rows(tid)) == 2
    assert _task(tid)["checklist_total"] == 2


def test_tambah_level_atas_menghitung_progress_dan_checklist_total(repo, tid):
    _set_task(tid, progress=70)
    a = repo.add_subtask(tid, "a")
    assert a["task_progress"] == {"done": 0, "total": 1, "progress": 0}
    assert _task(tid)["progress"] == 0 and _task(tid)["checklist_total"] == 1
    _set_task(tid, progress=0)
    conn = db()
    conn.execute("UPDATE subtasks SET is_done = 1 WHERE id = ?", (a["id"],))
    conn.commit()
    conn.close()
    b = repo.add_subtask(tid, "b")
    assert b["task_progress"] == {"done": 1, "total": 2, "progress": 50}
    c = repo.add_subtask(tid, "c")
    assert c["task_progress"] == {"done": 1, "total": 3, "progress": 33}
    assert _task(tid)["checklist_total"] == 3


def test_tambah_sub_butir_tidak_mengubah_checklist_total_dan_progress(repo, tid):
    a = repo.add_subtask(tid, "a")
    repo.add_subtask(tid, "b")
    s = repo.add_subtask(tid, "sub", parent_id=a["id"])
    assert s["task_progress"] == {"done": 0, "total": 2, "progress": 0}
    assert _task(tid)["checklist_total"] == 2


def test_tambah_tidak_mengubah_updated_at(repo, tid):
    a = repo.add_subtask(tid, "a")
    repo.add_subtask(tid, "sub", parent_id=a["id"], index=0)
    cid = f"cid-{uuid.uuid4().hex}"
    repo.add_subtask(tid, "a", client_id=cid)
    repo.add_subtask(tid, "a", client_id=cid)
    with pytest.raises(ChecklistError):
        repo.add_subtask(tid, " ")
    assert _task(tid)["updated_at"] == FROZEN


def test_tambah_memakai_satu_write_tx(repo, tid, monkeypatch):
    asli = dbconn.write_tx
    panggil = []

    @contextmanager
    def mata_mata(conn):
        panggil.append(conn.in_transaction)
        with asli(conn) as c:
            assert c.in_transaction  # BEGIN IMMEDIATE sebelum SELECT pertama
            yield c

    monkeypatch.setattr(dbconn, "write_tx", mata_mata)
    repo.add_subtask(tid, "a")
    assert panggil == [False]


def test_get_subtask_progress_mengabaikan_sub_butir(repo, tid):
    a = repo.add_subtask(tid, "a")
    repo.add_subtask(tid, "b")
    s1 = repo.add_subtask(tid, "s1", parent_id=a["id"])
    repo.add_subtask(tid, "s2", parent_id=a["id"])
    conn = db()
    conn.execute("UPDATE subtasks SET is_done = 1 WHERE id IN (?, ?)", (a["id"], s1["id"]))
    conn.commit()
    conn.close()
    assert repo.get_subtask_progress(tid) == (1, 2)


# ── Task 2: _recompute_progress ─────────────────────────────────────────────

def test_recompute_progress_hanya_menulis_bila_berbeda(tid):
    a = _ins(tid, "a", is_done=1)
    _ins(tid, "b")
    _ins(tid, "sub", parent_id=a, is_done=0)
    conn = dbconn.connect(webapp.DB_PATH)
    try:
        with dbconn.write_tx(conn):
            assert _recompute_progress(conn, tid) == {"done": 1, "total": 2, "progress": 50}
        sesudah_pertama = conn.total_changes
        assert sesudah_pertama == 1
        with dbconn.write_tx(conn):
            assert _recompute_progress(conn, tid) == {"done": 1, "total": 2, "progress": 50}
        assert conn.total_changes == sesudah_pertama
    finally:
        conn.close()
    assert _task(tid) == {"progress": 50, "checklist_total": 2, "updated_at": FROZEN}


def test_recompute_progress_total_0_progress_tetap(tid):
    _set_task(tid, progress=42, checklist_total=3)
    conn = dbconn.connect(webapp.DB_PATH)
    try:
        with dbconn.write_tx(conn):
            assert _recompute_progress(conn, tid) == {"done": 0, "total": 0, "progress": 42}
        n = conn.total_changes
        with dbconn.write_tx(conn):
            _recompute_progress(conn, tid)
        assert conn.total_changes == n  # checklist_total sudah 0 → tidak menulis lagi
    finally:
        conn.close()
    assert _task(tid) == {"progress": 42, "checklist_total": 0, "updated_at": FROZEN}


# ── Task 3: alat bantu ──────────────────────────────────────────────────────

@pytest.fixture
def tulis(repo, monkeypatch):
    """Daftar `conn.total_changes` per koneksi repo (0 = operasi tidak menulis apa pun)."""
    catat = []
    asli = repo._connect

    @contextmanager
    def connect():
        with asli() as conn:
            yield conn
            catat.append(conn.total_changes)

    monkeypatch.setattr(repo, "_connect", connect)
    return catat


@pytest.fixture
def spy_tx(monkeypatch):
    """Catat setiap pemakaian dbconn.write_tx: (transaksi sudah terbuka sebelumnya?)."""
    asli = dbconn.write_tx
    panggil = []

    @contextmanager
    def mata_mata(conn):
        panggil.append(conn.in_transaction)
        with asli(conn) as c:
            yield c

    monkeypatch.setattr(dbconn, "write_tx", mata_mata)
    return panggil


def _pohon(repo, tid):
    """a(a1(a11), a2), b, c — dibuat lewat repo supaya sort_order rapi."""
    a = repo.add_subtask(tid, "a")["id"]
    b = repo.add_subtask(tid, "b")["id"]
    c = repo.add_subtask(tid, "c")["id"]
    a1 = repo.add_subtask(tid, "a1", parent_id=a)["id"]
    a2 = repo.add_subtask(tid, "a2", parent_id=a)["id"]
    a11 = repo.add_subtask(tid, "a11", parent_id=a1)["id"]
    return a, b, c, a1, a2, a11


# ── Task 3: ubah teks ───────────────────────────────────────────────────────

def test_ubah_teks_di_trim_mengembalikan_butir_dan_task_progress(repo, tid):
    a, b, c, a1, a2, a11 = _pohon(repo, tid)
    r = repo.rename_subtask(a1, "  teks baru  ")
    assert set(r) == KEYS | {"task_progress"}
    assert r["id"] == a1 and r["title"] == "teks baru" and r["depth"] == 1 and r["parent_id"] == a
    assert r["task_progress"] == {"done": 0, "total": 3, "progress": 0}
    assert [s["title"] for s in repo.get_subtasks(tid) if s["id"] == a1] == ["teks baru"]
    assert _task(tid)["updated_at"] == FROZEN


def test_ubah_teks_kosong_empty_title_tanpa_mengubah_baris(repo, tid):
    a = repo.add_subtask(tid, "a")["id"]
    for kosong in ("", "   ", "\t"):
        with pytest.raises(ChecklistError) as ei:
            repo.rename_subtask(a, kosong)
        assert ei.value.code == "EMPTY_TITLE"
    assert _rows(tid)[0]["title"] == "a"


def test_ubah_teks_sama_tanpa_tulis(repo, tid, tulis):
    a = repo.add_subtask(tid, "a")["id"]
    tulis.clear()
    r = repo.rename_subtask(a, "  a ")
    assert r["title"] == "a" and r["task_progress"] == {"done": 0, "total": 1, "progress": 0}
    assert tulis == [0]
    assert _task(tid)["updated_at"] == FROZEN


def test_ubah_teks_id_tidak_ada_none(repo):
    assert repo.rename_subtask(987654321, "apa saja") is None


# ── Task 3: pindah ──────────────────────────────────────────────────────────

def test_pindah_di_antara_saudara_atas_ke_bawah(repo, tid):
    a, b, c, a1, a2, a11 = _pohon(repo, tid)
    r = repo.move_subtask(a, None, 2)
    assert set(r) == {"items", "task_progress"}
    assert r["items"] == repo.get_subtasks(tid)
    assert [(s["id"], s["depth"]) for s in r["items"]] == [
        (b, 0), (c, 0), (a, 0), (a1, 1), (a11, 2), (a2, 1)]
    assert _orders(repo, tid) == [0, 1, 2]


def test_pindah_di_antara_saudara_bawah_ke_atas(repo, tid):
    a, b, c, a1, a2, a11 = _pohon(repo, tid)
    repo.move_subtask(c, None, 0)
    assert [i for i, d in _view(repo, tid) if d == 0] == [c, a, b]
    assert _orders(repo, tid) == [0, 1, 2]
    repo.move_subtask(a2, a, 0)
    assert [i for i, _ in _view(repo, tid)] == [c, a, a2, a1, a11, b]
    assert _orders(repo, tid, parent_id=a) == [0, 1]


def test_pindah_index_lebih_dari_n_atau_kosong_ke_akhir(repo, tid):
    a, b, c, a1, a2, a11 = _pohon(repo, tid)
    repo.move_subtask(a, None, 99)
    assert [i for i, d in _view(repo, tid) if d == 0] == [b, c, a]
    repo.move_subtask(b, None)
    assert [i for i, d in _view(repo, tid) if d == 0] == [c, a, b]
    assert _orders(repo, tid) == [0, 1, 2]


def test_pindah_ke_induk_lain_turunan_ikut_depth_bertambah(repo, tid):
    a, b, c, a1, a2, a11 = _pohon(repo, tid)
    r = repo.move_subtask(a1, b, 0)
    assert [(s["id"], s["depth"]) for s in r["items"]] == [
        (a, 0), (a2, 1), (b, 0), (a1, 1), (a11, 2), (c, 0)]
    repo.move_subtask(b, a2)
    assert [(i, d) for i, d in _view(repo, tid)] == [
        (a, 0), (a2, 1), (b, 2), (a1, 3), (a11, 4), (c, 0)]


def test_pindah_ke_level_atas(repo, tid):
    a, b, c, a1, a2, a11 = _pohon(repo, tid)
    r = repo.move_subtask(a11, None, 1)
    assert [(s["id"], s["depth"]) for s in r["items"]] == [
        (a, 0), (a1, 1), (a2, 1), (a11, 0), (b, 0), (c, 0)]
    assert _orders(repo, tid) == [0, 1, 2, 3]
    assert _orders(repo, tid, parent_id=a1) == []


def test_pindah_ke_diri_sendiri_cycle(repo, tid):
    a, b, c, a1, a2, a11 = _pohon(repo, tid)
    sebelum = _rows(tid)
    with pytest.raises(ChecklistError) as ei:
        repo.move_subtask(a, a, 0)
    assert ei.value.code == "CYCLE"
    assert _rows(tid) == sebelum


def test_pindah_ke_anak_atau_cucu_sendiri_cycle(repo, tid):
    a, b, c, a1, a2, a11 = _pohon(repo, tid)
    sebelum = _rows(tid)
    for tujuan in (a1, a11, a2):
        with pytest.raises(ChecklistError) as ei:
            repo.move_subtask(a, tujuan)
        assert ei.value.code == "CYCLE"
    assert _rows(tid) == sebelum


def test_pindah_ke_butir_task_lain_atau_tidak_ada_parent_not_found(repo, u, tid):
    a, b, c, a1, a2, a11 = _pohon(repo, tid)
    lain = repo.add_subtask(_mk(u, title="lain")["id"], "x")["id"]
    sebelum = _rows(tid)
    for tujuan in (lain, 987654321):
        with pytest.raises(ChecklistError) as ei:
            repo.move_subtask(a1, tujuan)
        assert ei.value.code == "PARENT_NOT_FOUND"
    assert _rows(tid) == sebelum


def test_pindah_id_tidak_ada_none(repo):
    assert repo.move_subtask(987654321, None, 0) is None


def test_pindah_sort_order_kelompok_lama_dan_baru_rapat(repo, tid):
    a, b, c, a1, a2, a11 = _pohon(repo, tid)
    x = _ins(tid, "x", parent_id=b, sort_order=5)
    y = _ins(tid, "y", parent_id=b, sort_order=5)   # data lama: kembar dan berjarak
    repo.move_subtask(a1, b, 1)
    assert [i for i, _ in _view(repo, tid)] == [a, a2, b, x, a1, a11, y, c]
    assert _orders(repo, tid, parent_id=a) == [0]
    assert _orders(repo, tid, parent_id=b) == [0, 1, 2]
    repo.move_subtask(b, None, 0)
    assert _orders(repo, tid) == [0, 1, 2]


def test_pindah_sub_jadi_level_atas_menaikkan_checklist_total_dan_progress(repo, tid):
    a, b, c, a1, a2, a11 = _pohon(repo, tid)
    conn = db()
    conn.execute("UPDATE subtasks SET is_done = 1 WHERE id IN (?, ?)", (a, a1))
    conn.commit()
    conn.close()
    r = repo.move_subtask(a1, None)
    assert r["task_progress"] == {"done": 2, "total": 4, "progress": 50}
    assert _task(tid) == {"progress": 50, "checklist_total": 4, "updated_at": FROZEN}


def test_pindah_level_atas_jadi_sub_menurunkannya(repo, tid):
    a, b, c, a1, a2, a11 = _pohon(repo, tid)
    conn = db()
    conn.execute("UPDATE subtasks SET is_done = 1 WHERE id = ?", (a,))
    conn.commit()
    conn.close()
    assert repo.move_subtask(c, a)["task_progress"] == {"done": 1, "total": 2, "progress": 50}
    assert repo.move_subtask(b, a)["task_progress"] == {"done": 1, "total": 1, "progress": 100}
    assert _task(tid) == {"progress": 100, "checklist_total": 1, "updated_at": FROZEN}


def test_pindah_posisi_sama_tanpa_tulis(repo, tid, tulis):
    a, b, c, a1, a2, a11 = _pohon(repo, tid)
    tulis.clear()
    r1 = repo.move_subtask(b, None, 1)
    r2 = repo.move_subtask(c, None)
    r3 = repo.move_subtask(a2, a, 7)
    assert tulis == [0, 0, 0]
    assert r1["items"] == r2["items"] == r3["items"] == repo.get_subtasks(tid)
    assert r1["task_progress"] == {"done": 0, "total": 3, "progress": 0}


def test_pindah_tidak_mengubah_updated_at(repo, tid):
    a, b, c, a1, a2, a11 = _pohon(repo, tid)
    repo.move_subtask(a1, None, 0)
    repo.move_subtask(c, a1)
    repo.move_subtask(a1, b, 0)
    assert _task(tid)["updated_at"] == FROZEN


def test_ubah_teks_dan_pindah_memakai_satu_write_tx(repo, tid, spy_tx):
    a = repo.add_subtask(tid, "a")["id"]
    b = repo.add_subtask(tid, "b")["id"]
    spy_tx.clear()
    repo.rename_subtask(a, "a2")
    repo.move_subtask(b, a)
    repo.rename_subtask(987654321, "x")
    repo.move_subtask(987654321, None)
    assert spy_tx == [False, False, False, False]
