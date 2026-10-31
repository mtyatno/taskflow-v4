"""K4/R3: `migrate_db()` TETAP berjalan tanpa foreign_keys pada blok rebuild tabel.

Tes ini LULUS di `main` (FK memang OFF pada 26 koneksi migrasi). Ia pagar agar migrasi
ke `dbconn` tidak menyalakan FK: rebuild tabel (`ALTER … RENAME TO x_old` → `CREATE x` →
`INSERT … SELECT` → `DROP TABLE x_old`) dengan FK ON (a) menghapus baris tabel anak lewat
CASCADE saat `DROP TABLE x_old`, dan (b) menulis ulang `REFERENCES` anak ke `x_old` walau
`legacy_alter_table=ON` (diverifikasi 2026-10-31).
"""
import sqlite3

import webapp
from repository import TaskRepository


def _legacy_db(path):
    """DB lama: tabel dasar dari _init_db + `drawings` skema lama (tanpa `title`, ada `note_id`)
    + tabel anak sintetis ber-FK ke drawings. Mengembalikan user_id pemilik."""
    repo = TaskRepository(str(path))
    uid = repo.auto_register_telegram_user(1, "A")
    conn = sqlite3.connect(str(path))
    try:
        conn.execute("DROP TABLE drawings")
        conn.execute("""
            CREATE TABLE drawings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                note_id INTEGER,
                data_json TEXT NOT NULL DEFAULT '{}',
                created_at TEXT,
                updated_at TEXT
            )
        """)
        conn.execute("""
            CREATE TABLE tes_anak_drawings (
                id INTEGER PRIMARY KEY,
                drawing_id INTEGER NOT NULL REFERENCES drawings(id) ON DELETE CASCADE
            )
        """)
        conn.execute(
            "INSERT INTO drawings (id, user_id, note_id, data_json, created_at, updated_at) "
            "VALUES (1, ?, NULL, '{}', '2025-01-01T00:00:00+07:00', '2025-01-01T00:00:00+07:00')",
            (uid,),
        )
        conn.execute("INSERT INTO tes_anak_drawings (id, drawing_id) VALUES (1, 1)")
        conn.commit()
    finally:
        conn.close()
    return uid


def test_rebuild_drawings_keeps_child_rows_and_references(monkeypatch, tmp_path):
    legacy = tmp_path / "legacy.db"
    uid = _legacy_db(legacy)
    monkeypatch.setattr(webapp, "DB_PATH", str(legacy))
    webapp.migrate_db()

    conn = sqlite3.connect(str(legacy))
    conn.row_factory = sqlite3.Row
    try:
        cols = {r["name"] for r in conn.execute("PRAGMA table_info(drawings)").fetchall()}
        assert "title" in cols and "note_id" not in cols  # rebuild memang terjadi
        row = conn.execute("SELECT id, user_id FROM drawings").fetchone()
        assert (row["id"], row["user_id"]) == (1, uid)
        assert conn.execute("SELECT COUNT(*) FROM tes_anak_drawings").fetchone()[0] == 1
        child_sql = conn.execute(
            "SELECT sql FROM sqlite_master WHERE type='table' AND name='tes_anak_drawings'"
        ).fetchone()["sql"]
        assert "REFERENCES drawings(" in child_sql
        assert "drawings_old" not in child_sql
        assert conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='drawings_old'"
        ).fetchone() is None
        assert conn.execute("PRAGMA foreign_key_check").fetchall() == []
    finally:
        conn.close()

    webapp.migrate_db()  # idempoten: kedua kali tidak melempar
