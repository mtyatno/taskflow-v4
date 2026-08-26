"""Test regresi untuk scripts/dedup_drawings.py (alat dedup DB produksi)."""
import os
import sqlite3
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def _seed_db(db_path):
    conn = sqlite3.connect(db_path)
    conn.executescript(
        """
        CREATE TABLE scratchpad_notes (id INTEGER PRIMARY KEY, user_id INTEGER, title TEXT, content TEXT, updated_at TEXT);
        CREATE TABLE drawings (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, client_id TEXT, title TEXT, data_json TEXT, svg_preview TEXT, is_pinned INTEGER DEFAULT 0, created_at TEXT, updated_at TEXT);
        INSERT INTO scratchpad_notes VALUES (1, 1, 'n1', 'lihat ::draw[1] ini', '2026-01-01');
        INSERT INTO scratchpad_notes VALUES (2, 1, 'n2', 'escaped ::draw\\[9\\] disimpan', '2026-01-01');
        INSERT INTO drawings (user_id,title,data_json,svg_preview,is_pinned,created_at,updated_at) VALUES
         (1,'Gambar A','{"a":1}','<svg/>',0,'2026-01-01','2026-01-01'),
         (1,'Gambar A','{"a":1}','<svg/>',0,'2026-01-01','2026-01-02'),
         (1,'Gambar A','{"a":1}','<svg/>',0,'2026-01-01','2026-01-03'),
         (1,'Gambar B','{}','',0,'2026-01-01','2026-01-04'),
         (1,'Gambar C','{}','',0,'2026-01-01','2026-01-05'),
         (1,'Gambar C','{}','',0,'2026-01-01','2026-01-06'),
         (1,'Pin','{"p":1}','',1,'2026-01-01','2026-01-07'),
         (1,'Pin','{"p":1}','',0,'2026-01-01','2026-01-08');
        """
    )
    conn.commit()
    conn.close()


def _run_script(db_path, *args):
    env = dict(os.environ, DB_PATH=db_path)
    return subprocess.run(
        [sys.executable, str(ROOT / "scripts" / "dedup_drawings.py"), *args],
        env=env, capture_output=True, text=True,
    )


def test_dedup_preserves_referenced_pinned_and_newest():
    with tempfile.TemporaryDirectory() as tmp:
        db_path = os.path.join(tmp, "test.db")
        _seed_db(db_path)

        dry = _run_script(db_path)
        assert dry.returncode == 0, dry.stderr
        # dry-run tidak mengubah apa pun
        conn = sqlite3.connect(db_path)
        assert conn.execute("SELECT COUNT(*) FROM drawings").fetchone()[0] == 8
        conn.close()

        run = _run_script(db_path, "--run")
        assert run.returncode == 0, run.stderr

        conn = sqlite3.connect(db_path)
        left = [r[0] for r in conn.execute("SELECT id FROM drawings ORDER BY id").fetchall()]
        conn.close()
        # terhapus: 2 (dup) & 5 (kosong dup); bertahan: referensi (1), terbaru grup (3,6,8), unik (4), pin (7)
        assert left == [1, 3, 4, 6, 7, 8], f"sisa salah: {left}"


def test_dedup_recognizes_escaped_draw_ref():
    # ::draw\[id\] (bentuk ter-escape dari serializer lama) juga dianggap referensi
    with tempfile.TemporaryDirectory() as tmp:
        db_path = os.path.join(tmp, "test.db")
        conn = sqlite3.connect(db_path)
        conn.executescript(
            """
            CREATE TABLE scratchpad_notes (id INTEGER PRIMARY KEY, user_id INTEGER, title TEXT, content TEXT, updated_at TEXT);
            CREATE TABLE drawings (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, client_id TEXT, title TEXT, data_json TEXT, svg_preview TEXT, is_pinned INTEGER DEFAULT 0, created_at TEXT, updated_at TEXT);
            INSERT INTO drawings (user_id,title,data_json,svg_preview,is_pinned,created_at,updated_at) VALUES
             (1,'Gambar X','{"x":1}','<svg/>',0,'2026-01-01','2026-01-01'),
             (1,'Gambar X','{"x":1}','<svg/>',0,'2026-01-01','2026-01-02');
            """
        )
        # bentuk ter-escape serializer lama: ::draw\[1\] (SATU backslash, dibangun via chr(92)
        # agar tidak bergantung pada escaping string literal antar platform)
        esc_content = "coba ::draw" + chr(92) + "[1" + chr(92) + "] ok"
        conn.execute(
            "INSERT INTO scratchpad_notes (id, user_id, title, content, updated_at) VALUES (1, 1, 'n', ?, '2026-01-01')",
            (esc_content,),
        )
        conn.commit()
        conn.close()

        run = _run_script(db_path, "--run")
        assert run.returncode == 0, run.stderr

        conn = sqlite3.connect(db_path)
        left = [r[0] for r in conn.execute("SELECT id FROM drawings ORDER BY id").fetchall()]
        conn.close()
        # keduanya bertahan: id 1 direferensikan (escaped) DAN terbaru grup
        assert left == [1, 2], f"sisa salah: {left}"


def test_dedup_preserves_uuid_client_id_refs():
    with tempfile.TemporaryDirectory() as tmp:
        db_path = os.path.join(tmp, "test.db")
        conn = sqlite3.connect(db_path)
        conn.executescript(
            """
            CREATE TABLE scratchpad_notes (id INTEGER PRIMARY KEY, user_id INTEGER, title TEXT, content TEXT, updated_at TEXT);
            CREATE TABLE drawings (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, client_id TEXT, title TEXT, data_json TEXT, svg_preview TEXT, is_pinned INTEGER DEFAULT 0, created_at TEXT, updated_at TEXT);
            INSERT INTO scratchpad_notes VALUES (1, 1, 'n1', 'Diagram link ::draw[drw-uuid-abc-123] in note', '2026-01-01');
            INSERT INTO drawings (user_id, client_id, title, data_json, svg_preview, is_pinned, created_at, updated_at) VALUES
             (1, 'drw-uuid-abc-123', 'Diagram', '{"box":1}', '<svg/>', 0, '2026-01-01', '2026-01-01'),
             (1, NULL, 'Diagram', '{"box":1}', '<svg/>', 0, '2026-01-01', '2026-01-02'),
             (1, 'other-cid', 'Diagram', '{"box":1}', '<svg/>', 0, '2026-01-01', '2026-01-03');
            """
        )
        conn.commit()
        conn.close()

        run = _run_script(db_path, "--run")
        assert run.returncode == 0, run.stderr

        conn = sqlite3.connect(db_path)
        left = [r[0] for r in conn.execute("SELECT id FROM drawings ORDER BY id").fetchall()]
        conn.close()
        # Row 1 dipertahankan karena client_id 'drw-uuid-abc-123' direferensikan di note
        # Row 3 dipertahankan karena paling baru di grup duplikat
        # Row 2 dihapus karena duplikat lama tanpa referensi
        assert left == [1, 3], f"sisa salah: {left}"

