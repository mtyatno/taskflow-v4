"""merge_db.py menyalin checklist bertingkat: induk dipetakan ke id baru (spec §8; rencana PR A T9, R10).

Skrip CLI dijalankan lewat subprocess dengan dua DB sementara (cadangan → tujuan)."""
import hashlib
import sqlite3
import subprocess
import sys
from pathlib import Path

from repository import TaskRepository

ROOT = Path(__file__).resolve().parent.parent
T0 = "2026-01-01T00:00:00"


def _run(backup, current, apply=True):
    args = [sys.executable, "merge_db.py", str(backup), str(current)] + (["--apply"] if apply else [])
    return subprocess.run(args, cwd=ROOT, capture_output=True, text=True, timeout=60)


def _conn(path):
    c = sqlite3.connect(str(path))
    c.row_factory = sqlite3.Row
    return c


def _user(c, username):
    return c.execute("INSERT INTO users (username, password_hash, display_name, telegram_id, created_at) "
                     "VALUES (?, 'x', ?, NULL, ?)", (username, username, T0)).lastrowid


def _task(c, user_id, title, progress=0):
    return c.execute("INSERT INTO tasks (title, user_id, created_at, updated_at, progress) VALUES (?,?,?,?,?)",
                     (title, user_id, T0, T0, progress)).lastrowid


def _sub(c, task_id, title, parent_id=None, sort_order=0, is_done=0, with_parent=True):
    if with_parent:
        return c.execute("INSERT INTO subtasks (task_id, title, is_done, sort_order, created_at, parent_id) "
                         "VALUES (?,?,?,?,?,?)", (task_id, title, is_done, sort_order, T0, parent_id)).lastrowid
    return c.execute("INSERT INTO subtasks (task_id, title, is_done, sort_order, created_at) VALUES (?,?,?,?,?)",
                     (task_id, title, is_done, sort_order, T0)).lastrowid


def _tujuan(tmp_path):
    """DB tujuan yang sudah berisi data lain, supaya id baru ≠ id lama."""
    cur = tmp_path / "current.db"
    TaskRepository(str(cur))
    c = _conn(cur)
    uid = _user(c, "lama")
    tid = _task(c, uid, "sudah ada")
    for i in range(5):
        _sub(c, tid, f"isi {i}", sort_order=i)
    c.commit()
    c.close()
    return cur


def _cadangan_tiga_tingkat(tmp_path):
    bak = tmp_path / "backup.db"
    TaskRepository(str(bak))
    c = _conn(bak)
    uid = _user(c, "pemilik")
    tid = _task(c, uid, "rilis", progress=90)
    b = _sub(c, tid, "B", sort_order=1)
    a = _sub(c, tid, "A", sort_order=0, is_done=1)
    a1 = _sub(c, tid, "A1", parent_id=a, sort_order=1, is_done=1)
    a2 = _sub(c, tid, "A2", parent_id=a, sort_order=0)
    _sub(c, tid, "A11", parent_id=a1, sort_order=0)
    _sub(c, tid, "B1", parent_id=b, sort_order=0)
    _sub(c, tid, "yatim", parent_id=999999, sort_order=2)
    c.commit()
    c.close()
    return bak, tid, (a, a1, a2)


def _dump_hash(path):
    c = sqlite3.connect(str(path))
    try:
        return hashlib.sha256("\n".join(c.iterdump()).encode()).hexdigest()
    finally:
        c.close()


def _merged(cur, title="rilis"):
    c = _conn(cur)
    try:
        t = c.execute("SELECT id, progress, checklist_total, updated_at FROM tasks WHERE title = ?",
                      (title,)).fetchone()
        rows = [dict(r) for r in c.execute(
            "SELECT id, parent_id, title, sort_order FROM subtasks WHERE task_id = ? ORDER BY id", (t["id"],))]
        return dict(t), rows
    finally:
        c.close()


def test_tiga_tingkat_induk_menunjuk_id_baru_urutan_preorder_dan_progress(tmp_path):
    cur = _tujuan(tmp_path)
    bak, old_tid, (a, a1, a2) = _cadangan_tiga_tingkat(tmp_path)
    r = _run(bak, cur)
    assert r.returncode == 0, r.stderr
    assert "Ditambahkan: 7 subtasks" in r.stdout

    t, rows = _merged(cur)
    by_title = {s["title"]: s for s in rows}
    assert by_title["A"]["id"] != a  # id baru
    assert by_title["A1"]["parent_id"] == by_title["A"]["id"]
    assert by_title["A2"]["parent_id"] == by_title["A"]["id"]
    assert by_title["A11"]["parent_id"] == by_title["A1"]["id"]
    assert by_title["B1"]["parent_id"] == by_title["B"]["id"]
    assert by_title["yatim"]["parent_id"] is None     # induk tak terpetakan → level atas
    assert {s["title"]: s["sort_order"] for s in rows} == {
        "A": 0, "A1": 1, "A2": 0, "A11": 0, "B": 1, "B1": 0, "yatim": 2}

    src = [(s["title"], s["depth"]) for s in TaskRepository(str(bak)).get_subtasks(old_tid)]
    dst = [(s["title"], s["depth"]) for s in TaskRepository(str(cur)).get_subtasks(t["id"])]
    assert dst == src == [("A", 0), ("A2", 1), ("A1", 1), ("A11", 2), ("B", 0), ("B1", 1), ("yatim", 0)]
    # level atas A (selesai), B, yatim → 1/3
    assert (t["progress"], t["checklist_total"], t["updated_at"]) == (33, 3, T0)


def test_cadangan_lama_tanpa_kolom_parent_id_semua_level_atas(tmp_path):
    cur = _tujuan(tmp_path)
    bak = tmp_path / "lama.db"
    TaskRepository(str(bak))
    c = _conn(bak)
    c.execute("DROP INDEX idx_subtasks_tree")
    c.execute("ALTER TABLE subtasks DROP COLUMN parent_id")
    uid = _user(c, "pemilik")
    tid = _task(c, uid, "rilis", progress=10)
    for i, (title, done) in enumerate((("x", 1), ("y", 0), ("z", 0), ("w", 1))):
        _sub(c, tid, title, sort_order=i, is_done=done, with_parent=False)
    c.commit()
    c.close()
    assert "parent_id" not in {r[1] for r in sqlite3.connect(str(bak)).execute("PRAGMA table_info(subtasks)")}

    r = _run(bak, cur)
    assert r.returncode == 0, r.stderr
    t, rows = _merged(cur)
    assert [(s["title"], s["parent_id"]) for s in rows] == [("x", None), ("y", None), ("z", None), ("w", None)]
    assert (t["progress"], t["checklist_total"]) == (50, 4)


def test_dry_run_tidak_menulis_apa_pun(tmp_path):
    cur = _tujuan(tmp_path)
    bak, _, _ = _cadangan_tiga_tingkat(tmp_path)
    sebelum = _dump_hash(cur)
    r = _run(bak, cur, apply=False)
    assert r.returncode == 0, r.stderr
    assert "DRY-RUN selesai" in r.stdout
    assert _dump_hash(cur) == sebelum


def test_tujuan_tanpa_kolom_parent_id_galat_jelas_tanpa_menulis(tmp_path):
    cur = _tujuan(tmp_path)
    c = _conn(cur)
    c.execute("DROP INDEX idx_subtasks_tree")
    c.execute("ALTER TABLE subtasks DROP COLUMN parent_id")
    c.commit()
    c.close()
    bak, _, _ = _cadangan_tiga_tingkat(tmp_path)
    sebelum = _dump_hash(cur)
    r = _run(bak, cur)
    assert r.returncode != 0
    assert "parent_id" in r.stdout + r.stderr and "migrate_db" in r.stdout + r.stderr
    assert _dump_hash(cur) == sebelum


# ── Perbaikan review S2: task penerima butir hasil merge menaikkan checklist_rev (spec checklist offline E2) ──
# Tanpa ini perangkat checklist offline (PR B2) tidak pernah mengambil ulang butir yang ditambahkan merge.

def _rev_task(path, title):
    c = _conn(path)
    try:
        return tuple(c.execute("SELECT checklist_rev, updated_at FROM tasks WHERE title = ?", (title,)).fetchone())
    finally:
        c.close()


def test_task_penerima_butir_rev_naik_1_termasuk_task_duplikat_tanpa_updated_at(tmp_path):
    cur = _tujuan(tmp_path)
    c = _conn(cur)
    c.execute("UPDATE tasks SET checklist_rev = 4 WHERE title = 'sudah ada'")
    _task(c, c.execute("SELECT id FROM users WHERE username = 'lama'").fetchone()[0], "kosong di tujuan")
    c.commit()
    c.close()
    bak = tmp_path / "backup.db"
    TaskRepository(str(bak))
    c = _conn(bak)
    uid = _user(c, "lama")
    dup = _task(c, uid, "sudah ada")              # duplikat (judul + created_at + pemilik sama)
    _sub(c, dup, "dari cadangan 1", sort_order=10)
    _sub(c, dup, "dari cadangan 2", sort_order=11)
    baru = _task(c, uid, "baru")
    _sub(c, baru, "isi baru")
    _task(c, uid, "kosong di tujuan")             # duplikat tanpa butir
    c.commit()
    c.close()

    r = _run(bak, cur)
    assert r.returncode == 0, r.stderr
    assert _rev_task(cur, "sudah ada") == (5, T0)          # +1 per task penerima, bukan per butir
    assert _rev_task(cur, "baru") == (1, T0)
    assert _rev_task(cur, "kosong di tujuan") == (0, T0)
    t, rows = _merged(cur, "sudah ada")
    assert len(rows) == 7


def test_tujuan_tanpa_kolom_checklist_rev_galat_jelas_tanpa_menulis(tmp_path):
    cur = _tujuan(tmp_path)
    c = _conn(cur)
    c.execute("ALTER TABLE tasks DROP COLUMN checklist_rev")
    c.commit()
    c.close()
    bak, _, _ = _cadangan_tiga_tingkat(tmp_path)
    sebelum = _dump_hash(cur)
    r = _run(bak, cur)
    assert r.returncode != 0
    out = r.stdout + r.stderr
    assert "checklist_rev" in out and "migrate_db" in out
    assert _dump_hash(cur) == sebelum
