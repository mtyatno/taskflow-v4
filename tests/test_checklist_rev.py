"""Versi checklist per task `tasks.checklist_rev` (spec checklist offline Fase 2 §3.1, E1–E2; rencana PR A2
T1, R1).

Aturan: setiap transaksi tulis checklist yang MENGUBAH sesuatu menaikkan rev tepat 1 (termasuk perubahan
berantai); pemulihan pohon (`_heal_task_tree`) yang mengubah sesuatu naik 1 TERSENDIRI; operasi tanpa
perubahan tidak menaikkan. Rev = field turunan: `tasks.updated_at` tidak pernah disentuh. `task_progress`
setiap kembalian membawa `rev` = nilai kolom sesudah operasi.
"""
import asyncio
import sqlite3
import uuid
from types import SimpleNamespace

import pytest

import bot
import dbconn
import webapp
from conftest import db
from repository import ChecklistError, TaskRepository, _bump_rev, _recompute_progress
from test_bot_checklist import _callback, _Msg, _update, pengguna  # noqa: F401 (fixture)
from test_checklist_repo import FROZEN, _ins, _pohon, _set_task, repo, spy_tx, tid, tulis, u  # noqa: F401 (fixture)
from test_contexts_tasks import _mk


def _rev(task_id):
    conn = db()
    try:
        return conn.execute("SELECT checklist_rev FROM tasks WHERE id = ?", (task_id,)).fetchone()[0]
    finally:
        conn.close()


def _updated_at(task_id):
    conn = db()
    try:
        return conn.execute("SELECT updated_at FROM tasks WHERE id = ?", (task_id,)).fetchone()[0]
    finally:
        conn.close()


def _raw_parent(sid):
    conn = db()
    try:
        return conn.execute("SELECT parent_id FROM subtasks WHERE id = ?", (sid,)).fetchone()[0]
    finally:
        conn.close()


# ── Skema ───────────────────────────────────────────────────────────────────

def test_kolom_checklist_rev_integer_default_0():
    conn = db()
    try:
        cols = {r["name"]: r for r in conn.execute("PRAGMA table_info(tasks)").fetchall()}
    finally:
        conn.close()
    assert "checklist_rev" in cols
    assert cols["checklist_rev"]["type"] == "INTEGER" and cols["checklist_rev"]["dflt_value"] == "0"


def test_task_baru_rev_0(u):
    assert _rev(_mk(u, title="baru")["id"]) == 0


def test_init_db_berulang_aman_dan_db_lama_mendapat_rev_0_tanpa_updated_at(tmp_path):
    p = str(tmp_path / "lama.db")
    conn = sqlite3.connect(p)
    conn.executescript("""
        CREATE TABLE tasks (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL,
            description TEXT DEFAULT '', gtd_status TEXT NOT NULL DEFAULT 'inbox',
            priority TEXT NOT NULL DEFAULT 'P3', quadrant TEXT NOT NULL DEFAULT 'Q4',
            project TEXT DEFAULT '', context TEXT DEFAULT '', deadline TEXT DEFAULT NULL,
            waiting_for TEXT DEFAULT '', user_id INTEGER DEFAULT NULL, created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL, completed_at TEXT DEFAULT NULL);
        INSERT INTO tasks (title, created_at, updated_at) VALUES ('lama', 'x', 'x');
    """)
    conn.commit()
    conn.close()
    TaskRepository(p)
    TaskRepository(p)
    conn = sqlite3.connect(p)
    try:
        assert conn.execute("SELECT checklist_rev, updated_at FROM tasks WHERE id = 1").fetchone() == (0, "x")
    finally:
        conn.close()


# ── _bump_rev dan _recompute_progress ───────────────────────────────────────

def test_bump_rev_hanya_task_itu_tanpa_updated_at_dan_null_dianggap_0(u, tid):
    lain = _mk(u, title="lain")["id"]
    _set_task(lain, updated_at=FROZEN)
    conn = dbconn.connect(webapp.DB_PATH)
    try:
        with dbconn.write_tx(conn):
            _bump_rev(conn, tid)
            _bump_rev(conn, tid, 3)
    finally:
        conn.close()
    assert (_rev(tid), _rev(lain)) == (4, 0)
    _set_task(tid, checklist_rev=None)
    conn = dbconn.connect(webapp.DB_PATH)
    try:
        with dbconn.write_tx(conn):
            _bump_rev(conn, tid)
    finally:
        conn.close()
    assert _rev(tid) == 1
    assert _updated_at(tid) == FROZEN and _updated_at(lain) == FROZEN


def test_recompute_progress_membawa_rev_kolom_dan_none_bila_task_tidak_ada(tid):
    _ins(tid, "a", is_done=1)
    _set_task(tid, checklist_rev=7)
    conn = dbconn.connect(webapp.DB_PATH)
    try:
        with dbconn.write_tx(conn):
            assert _recompute_progress(conn, tid) == {"done": 1, "total": 1, "progress": 100, "rev": 7}
            assert _recompute_progress(conn, 987654321) == {"done": 0, "total": 0, "progress": None, "rev": None}
    finally:
        conn.close()
    assert _rev(tid) == 7  # menghitung ulang progress tidak menaikkan rev


# ── Tambah ──────────────────────────────────────────────────────────────────

def test_tambah_level_atas_dan_sub_butir_masing_masing_naik_1(repo, tid):
    a = repo.add_subtask(tid, "a")
    assert _rev(tid) == 1 and a["task_progress"]["rev"] == 1
    s = repo.add_subtask(tid, "s", parent_id=a["id"], index=0)
    assert _rev(tid) == 2 and s["task_progress"]["rev"] == 2
    assert _updated_at(tid) == FROZEN


def test_tambah_client_id_yang_sudah_ada_tidak_naik(repo, tid):
    cid = f"cid-{uuid.uuid4().hex}"
    a = repo.add_subtask(tid, "a", client_id=cid)
    assert a["task_progress"]["rev"] == 1
    lagi = repo.add_subtask(tid, "a lagi", client_id=cid)
    assert lagi["id"] == a["id"] and lagi["task_progress"]["rev"] == 1
    assert _rev(tid) == 1 and _updated_at(tid) == FROZEN


def test_tambah_gagal_tidak_naik(repo, tid):
    repo.add_subtask(tid, "a")
    for kw in ({"title": "  "}, {"title": "x", "parent_id": 987654321}):
        with pytest.raises(ChecklistError):
            repo.add_subtask(tid, **kw)
    assert _rev(tid) == 1


# ── Ubah teks ───────────────────────────────────────────────────────────────

def test_ubah_teks_sama_tidak_naik_berbeda_naik_1(repo, tid):
    a = repo.add_subtask(tid, "a")["id"]
    assert repo.rename_subtask(a, "a")["task_progress"]["rev"] == 1
    assert repo.rename_subtask(a, "  a  ")["task_progress"]["rev"] == 1  # sama setelah di-trim
    assert _rev(tid) == 1
    assert repo.rename_subtask(a, "b")["task_progress"]["rev"] == 2
    with pytest.raises(ChecklistError):
        repo.rename_subtask(a, " ")
    assert _rev(tid) == 2 and _updated_at(tid) == FROZEN


# ── Pindah ──────────────────────────────────────────────────────────────────

def test_pindah_posisi_sama_tidak_naik_berubah_naik_1(repo, tid):
    a, b, c, a1, a2, a11 = _pohon(repo, tid)
    assert _rev(tid) == 6
    assert repo.move_subtask(b, None, 1)["task_progress"]["rev"] == 6   # b sudah di posisi 1
    assert repo.move_subtask(a2, a)["task_progress"]["rev"] == 6        # a2 sudah anak terakhir a
    assert repo.move_subtask(b, None, 0)["task_progress"]["rev"] == 7
    assert repo.move_subtask(a1, b)["task_progress"]["rev"] == 8        # pindah induk (a11 ikut)
    assert repo.move_subtask(a1, b, 5)["task_progress"]["rev"] == 8     # sudah satu-satunya anak b
    with pytest.raises(ChecklistError):
        repo.move_subtask(b, a11)                                       # siklus
    assert _rev(tid) == 8 and _updated_at(tid) == FROZEN


# ── Centang ─────────────────────────────────────────────────────────────────

def test_toggle_naik_1_setiap_kali_dua_arah(repo, tid):
    a = repo.add_subtask(tid, "a")["id"]
    assert repo.toggle_subtask(a)["task_progress"]["rev"] == 2
    assert repo.toggle_subtask(a)["task_progress"]["rev"] == 3
    assert _rev(tid) == 3 and _updated_at(tid) == FROZEN


def test_centang_induk_berantai_3_tingkat_naik_tepat_1(repo, tid):
    a, b, c, a1, a2, a11 = _pohon(repo, tid)
    r = repo.toggle_subtask(a)
    assert r["changed_ids"] == [a, a1, a11, a2]
    assert r["task_progress"]["rev"] == 7 and _rev(tid) == 7
    assert _updated_at(tid) == FROZEN


# ── Hapus ───────────────────────────────────────────────────────────────────

def test_hapus_berantai_naik_tepat_1(repo, tid):
    a, b, c, a1, a2, a11 = _pohon(repo, tid)
    r = repo.delete_subtask(a)
    assert r["deleted_ids"] == [a, a1, a11, a2]
    assert r["task_progress"]["rev"] == 7 and _rev(tid) == 7
    assert repo.delete_subtask(a) is None and _rev(tid) == 7
    assert _updated_at(tid) == FROZEN


def test_id_tidak_ada_tidak_menaikkan_apa_pun(repo, tid):
    repo.add_subtask(tid, "a")
    assert repo.rename_subtask(987654321, "x") is None
    assert repo.move_subtask(987654321, None) is None
    assert repo.toggle_subtask(987654321) is None
    assert repo.delete_subtask(987654321) is None
    assert _rev(tid) == 1


def test_operasi_hanya_menaikkan_rev_task_itu(repo, u, tid):
    lain = _mk(u, title="lain")["id"]
    x = repo.add_subtask(lain, "x")["id"]
    a = repo.add_subtask(tid, "a")["id"]
    repo.toggle_subtask(a)
    repo.rename_subtask(a, "a2")
    repo.delete_subtask(a)
    assert (_rev(tid), _rev(lain)) == (4, 1)
    repo.toggle_subtask(x)
    assert (_rev(tid), _rev(lain)) == (4, 2)


# ── Pemulihan pohon: +1 tersendiri ──────────────────────────────────────────

def _yatim(tid):
    """a, b level atas + butir yatim (induk tidak ada) — data rusak yang dipulihkan operasi tulis berikutnya."""
    a = _ins(tid, "a", sort_order=0)
    b = _ins(tid, "b", sort_order=1)
    o = _ins(tid, "yatim", parent_id=987654321, sort_order=2)
    return a, b, o


@pytest.mark.parametrize("op", ["add", "rename", "move", "toggle", "delete"])
def test_data_yatim_lalu_operasi_naik_2(repo, tid, op):
    a, b, o = _yatim(tid)
    assert _rev(tid) == 0
    r = {
        "add": lambda: repo.add_subtask(tid, "baru"),
        "rename": lambda: repo.rename_subtask(a, "a baru"),
        "move": lambda: repo.move_subtask(b, None, 0),
        "toggle": lambda: repo.toggle_subtask(a),
        "delete": lambda: repo.delete_subtask(b),
    }[op]()
    assert _raw_parent(o) is None
    assert _rev(tid) == 2 and r["task_progress"]["rev"] == 2
    assert _updated_at(tid) == FROZEN


@pytest.mark.parametrize("op", ["add_cid", "rename", "move"])
def test_data_yatim_lalu_operasi_tanpa_perubahan_naik_1(repo, tid, op):
    a, b, o = _yatim(tid)
    cid = f"cid-{uuid.uuid4().hex}"
    if op == "add_cid":
        conn = db()
        conn.execute("UPDATE subtasks SET client_id = ? WHERE id = ?", (cid, a))
        conn.commit()
        conn.close()
        r = repo.add_subtask(tid, "a", client_id=cid)
    elif op == "rename":
        r = repo.rename_subtask(a, "a")
    else:
        r = repo.move_subtask(b, None, 1)
    assert _raw_parent(o) is None
    assert _rev(tid) == 1 and r["task_progress"]["rev"] == 1
    assert _updated_at(tid) == FROZEN


def test_data_yatim_lalu_operasi_gagal_pemulihan_ikut_batal_tanpa_naik(repo, tid):
    a, b, o = _yatim(tid)
    with pytest.raises(ChecklistError):
        repo.rename_subtask(a, "  ")
    assert _rev(tid) == 0 and _raw_parent(o) == 987654321


# ── Semua kembalian: task_progress.rev = kolom ──────────────────────────────

def test_task_progress_rev_sama_dengan_kolom_di_setiap_kembalian(repo, tid):
    a = repo.add_subtask(tid, "a")
    hasil = [a,
             repo.add_subtask(tid, "a1", parent_id=a["id"]),
             repo.rename_subtask(a["id"], "A"),
             repo.toggle_subtask(a["id"]),
             repo.move_subtask(a["id"], None, 0)]
    for r in hasil:
        assert set(r["task_progress"]) == {"done", "total", "progress", "rev"}
    assert [r["task_progress"]["rev"] for r in hasil] == [1, 2, 3, 4, 4]
    d = repo.delete_subtask(a["id"])
    assert d["task_progress"]["rev"] == 5 == _rev(tid)
    assert _updated_at(tid) == FROZEN


# ── Jalur bot (repository yang sama) ────────────────────────────────────────

def test_jalur_bot_tambah_centang_hapus_menaikkan_rev(pengguna):  # noqa: F811
    tid = _mk(pengguna, title="bot")["id"]
    _set_task(tid, updated_at=FROZEN)
    msg = _Msg("dari bot")
    asyncio.run(bot.handle_text_input(_update(message=msg), SimpleNamespace(user_data={"waiting_subtask_for": tid})))
    assert _rev(tid) == 1
    sid = bot.repo.get_subtasks(tid)[0]["id"]
    _callback(f"togsub_{sid}_{tid}")
    assert _rev(tid) == 2
    _callback(f"delsub_{sid}_{tid}")
    assert _rev(tid) == 3
    assert bot.repo.get_subtasks(tid) == []
    assert _updated_at(tid) == FROZEN


# ── Task 2: update_subtask — ubah teks dan/atau centang SET dalam satu transaksi (R2, E3) ──

KEYS = {"id", "task_id", "parent_id", "depth", "title", "is_done", "sort_order"}


def _done(repo, tid):
    return {s["id"]: s["is_done"] for s in repo.get_subtasks(tid)}


def test_set_selesai_berantai_bentuk_kembalian_dan_naik_1(repo, tid):
    a, b, c, a1, a2, a11 = _pohon(repo, tid)
    r = repo.update_subtask(a, is_done=True)
    assert set(r) == KEYS | {"changed_ids", "task_progress"}
    assert r["id"] == a and r["is_done"] is True and r["title"] == "a"
    assert r["changed_ids"] == [a, a1, a11, a2]
    assert r["task_progress"] == {"done": 1, "total": 3, "progress": 33, "rev": 7}
    d = _done(repo, tid)
    assert d[a] and d[a1] and d[a11] and d[a2] and not d[b] and not d[c]
    assert _updated_at(tid) == FROZEN


def test_set_selesai_dua_kali_kedua_tanpa_perubahan_tanpa_tulis(repo, tid, tulis):
    a, b, c, a1, a2, a11 = _pohon(repo, tid)
    repo.update_subtask(a, is_done=True)
    tulis.clear()
    r = repo.update_subtask(a, is_done=True)
    assert r["changed_ids"] == [] and r["is_done"] is True
    assert r["task_progress"]["rev"] == 7 == _rev(tid)
    assert tulis == [0]


def test_set_selesai_butir_sudah_selesai_menyelesaikan_turunan_yang_belum(repo, tid):
    a, b, c, a1, a2, a11 = _pohon(repo, tid)
    repo.toggle_subtask(a)       # semua turunan selesai (rev 7)
    repo.toggle_subtask(a11)     # a11 dibuka lagi (rev 8)
    r = repo.update_subtask(a, is_done=True)
    assert r["changed_ids"] == [a11] and r["task_progress"]["rev"] == 9
    assert all(_done(repo, tid)[i] for i in (a, a1, a11, a2))


def test_set_belum_selesai_hanya_butir_itu_diulang_tanpa_perubahan(repo, tid):
    a, b, c, a1, a2, a11 = _pohon(repo, tid)
    repo.update_subtask(a, is_done=True)
    r = repo.update_subtask(a, is_done=False)
    assert r["is_done"] is False and r["changed_ids"] == [a] and r["task_progress"]["rev"] == 8
    d = _done(repo, tid)
    assert not d[a] and d[a1] and d[a11] and d[a2]
    r = repo.update_subtask(a, is_done=False)
    assert r["changed_ids"] == [] and _rev(tid) == 8


def test_set_sama_dengan_toggle_ke_arah_yang_sama(repo, u, tid):
    """Dua pohon kembar: centang set menghasilkan perubahan yang sama dengan toggle ke arah yang sama."""
    lain = _mk(u, title="kembar")["id"]
    p, q = _pohon(repo, tid), _pohon(repo, lain)
    for i in (0, 3, 0):  # a selesai (berantai), a1 dibuka (a tetap selesai), a dibuka
        x = repo.toggle_subtask(p[i])
        y = repo.update_subtask(q[i], is_done=x["is_done"])
        assert [p.index(j) for j in x["changed_ids"]] == [q.index(j) for j in y["changed_ids"]]
        assert y["is_done"] == x["is_done"] and y["task_progress"] == x["task_progress"]


def test_ubah_teks_saja_changed_ids_kosong_naik_1_sama_tidak_naik(repo, tid):
    a = repo.add_subtask(tid, "a")["id"]
    r = repo.update_subtask(a, title="  baru  ")
    assert r["title"] == "baru" and r["changed_ids"] == [] and r["task_progress"]["rev"] == 2
    r = repo.update_subtask(a, title="baru")
    assert r["changed_ids"] == [] and r["task_progress"]["rev"] == 2
    assert _updated_at(tid) == FROZEN


def test_ubah_teks_dan_centang_satu_kenaikan(repo, tid):
    a, b, c, a1, a2, a11 = _pohon(repo, tid)
    r = repo.update_subtask(a1, title="A1", is_done=True)
    assert r["title"] == "A1" and r["is_done"] is True and r["changed_ids"] == [a1, a11]
    assert r["task_progress"]["rev"] == 7 == _rev(tid)
    # teks sama + centang berubah → tetap satu kenaikan; keduanya sama → tanpa kenaikan
    assert repo.update_subtask(a1, title="A1", is_done=False)["task_progress"]["rev"] == 8
    assert repo.update_subtask(a1, title=" A1 ", is_done=False)["task_progress"]["rev"] == 8
    assert _updated_at(tid) == FROZEN


def test_tanpa_argumen_no_change_tanpa_menulis(repo, tid):
    a = repo.add_subtask(tid, "a")["id"]
    for sid in (a, 987654321):
        with pytest.raises(ChecklistError) as ei:
            repo.update_subtask(sid)
        assert ei.value.code == "NO_CHANGE"
        with pytest.raises(ChecklistError) as ei:
            repo.update_subtask(sid, title=None, is_done=None)
        assert ei.value.code == "NO_CHANGE"
    assert _rev(tid) == 1


def test_judul_kosong_empty_title_centang_ikut_batal(repo, tid):
    a = repo.add_subtask(tid, "a")["id"]
    for kosong in ("", "   ", "\n"):
        with pytest.raises(ChecklistError) as ei:
            repo.update_subtask(a, title=kosong, is_done=True)
        assert ei.value.code == "EMPTY_TITLE"
    assert _done(repo, tid)[a] is False and _rev(tid) == 1
    assert repo.get_subtasks(tid)[0]["title"] == "a"


def test_id_tidak_ada_none(repo):
    assert repo.update_subtask(987654321, title="x") is None
    assert repo.update_subtask(987654321, is_done=True) is None


def test_update_data_yatim_pemulihan_naik_tersendiri(repo, tid):
    a, b, o = _yatim(tid)
    r = repo.update_subtask(a, is_done=True)
    assert _raw_parent(o) is None and r["task_progress"]["rev"] == 2
    r = repo.update_subtask(a, is_done=True)
    assert r["task_progress"]["rev"] == 2


def test_update_memakai_satu_write_tx(repo, tid, spy_tx):
    a = repo.add_subtask(tid, "a")["id"]
    spy_tx.clear()
    repo.update_subtask(a, title="b", is_done=True)
    repo.update_subtask(a, is_done=False)
    repo.update_subtask(987654321, title="x")
    assert spy_tx == [False, False, False]
