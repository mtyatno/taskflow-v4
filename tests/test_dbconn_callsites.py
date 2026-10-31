"""Pagar AST: `sqlite3.connect` hanya boleh dipanggil di `dbconn.py` (ADR-038, spec Fase 0b §4.3).

Selama migrasi bertahap (PR A Task 2–5) tes memakai *ratchet* `REMAINING`: jumlah titik
`sqlite3.connect` yang masih diizinkan per file. Angkanya hanya boleh turun; Task 6
menghapus ratchet dan menjadikannya aturan keras.

Yang ditolak di luar `dbconn.py`:
- `sqlite3.connect(...)` lewat `import sqlite3`, `import sqlite3 as X` (termasuk import di dalam
  fungsi — kasus `bot.py` lama), dan `from sqlite3 import connect [as Y]`;
- kata kunci `isolation_level=` / `autocommit=` pada pemanggilan apa pun;
- assignment ke atribut `.isolation_level` / `.autocommit`.

Yang dipindai: semua `*.py` di akar repo. `scripts/`, `tests/`, `temporary_files/`, `venv/`,
`node_modules/`, `draw-app/`, `docs/` tidak dipindai.
"""
import ast
import sqlite3
from pathlib import Path

import config
import webapp

ROOT = Path(__file__).resolve().parent.parent

# Skrip sekali jalan / pemeliharaan yang dijalankan manual dan tidak pernah di-import layanan.
# Menambah pengecualian baru harus beralasan di PR (bukan jalan pintas untuk kode layanan).
ALLOWLIST = {
    "merge_db.py",       # gabung backup → DB aktif, sekali jalan
    "fix_list_tasks.py",  # perbaikan data sekali jalan
}

PROD_FILES = sorted(p for p in ROOT.glob("*.py") if p.name not in ALLOWLIST)

# Ratchet migrasi bertahap: titik `sqlite3.connect` yang MASIH diizinkan per file (hanya boleh turun).
REMAINING = {"webapp.py": 27, "repository.py": 1, "bot.py": 1}

FORBIDDEN_TX_CONTROL = {"isolation_level", "autocommit"}

# Pemanggil dbconn yang wajib mengirim path eksplisit (R1): DB_PATH dibaca saat dipanggil.
EXPLICIT_PATH_FILES = ("webapp.py", "repository.py", "bot.py")


def _parse(path):
    return ast.parse(path.read_text(encoding="utf-8"), filename=str(path))


def connect_calls(path):
    """Semua pemanggilan `sqlite3.connect` di file: list (lineno, bentuk).

    Mengenali alias modul (`import sqlite3 as _sq`, juga di dalam fungsi) dan
    `from sqlite3 import connect [as Y]`.
    """
    tree = _parse(path)
    module_aliases = set()
    direct_names = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for a in node.names:
                if a.name == "sqlite3":
                    module_aliases.add(a.asname or "sqlite3")
        elif isinstance(node, ast.ImportFrom) and node.module == "sqlite3":
            for a in node.names:
                if a.name == "connect":
                    direct_names.add(a.asname or "connect")
    out = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        f = node.func
        if (isinstance(f, ast.Attribute) and f.attr == "connect"
                and isinstance(f.value, ast.Name) and f.value.id in module_aliases):
            out.append((node.lineno, f"{f.value.id}.connect("))
        elif isinstance(f, ast.Name) and f.id in direct_names:
            out.append((node.lineno, f"{f.id}("))
    return out


def forbidden_tx_control(path):
    """Pemakaian `isolation_level`/`autocommit` sebagai kata kunci pemanggilan atau target assignment."""
    tree = _parse(path)
    out = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Call):
            for kw in node.keywords:
                if kw.arg in FORBIDDEN_TX_CONTROL:
                    out.append((node.lineno, f"{kw.arg}="))
        elif isinstance(node, (ast.Assign, ast.AugAssign, ast.AnnAssign)):
            targets = node.targets if isinstance(node, ast.Assign) else [node.target]
            for t in targets:
                if isinstance(t, ast.Attribute) and t.attr in FORBIDDEN_TX_CONTROL:
                    out.append((node.lineno, f".{t.attr} ="))
    return out


def dbconn_calls(tree):
    """Semua `Call` ke `dbconn.connect` / `dbconn.get_conn` di pohon AST."""
    out = []
    for node in ast.walk(tree):
        if (isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
                and isinstance(node.func.value, ast.Name) and node.func.value.id == "dbconn"
                and node.func.attr in {"connect", "get_conn"}):
            out.append(node)
    return out


def _fmt(path, hits):
    return ", ".join(f"{path.name}:{ln} {form}" for ln, form in hits)


def test_prod_files_scanned():
    names = {p.name for p in PROD_FILES}
    assert {"webapp.py", "repository.py", "bot.py"} <= names
    assert not (ALLOWLIST & names)


def test_sqlite_connect_only_in_dbconn_or_remaining():
    dbconn_py = ROOT / "dbconn.py"
    assert dbconn_py.exists(), "dbconn.py belum ada"
    own = connect_calls(dbconn_py)
    assert len(own) == 1, f"dbconn.py wajib tepat satu sqlite3.connect: {_fmt(dbconn_py, own)}"

    problems = []
    for path in PROD_FILES:
        if path.name == "dbconn.py":
            continue
        hits = connect_calls(path)
        allowed = REMAINING.get(path.name, 0)
        if len(hits) != allowed:
            problems.append(f"{path.name}: {len(hits)} titik (ratchet {allowed}) — {_fmt(path, hits) or '-'}")
    assert not problems, "sqlite3.connect di luar dbconn.py:\n" + "\n".join(problems)


def test_no_isolation_level_or_autocommit_outside_dbconn():
    problems = []
    for path in PROD_FILES:
        if path.name == "dbconn.py":
            continue
        hits = forbidden_tx_control(path)
        if hits:
            problems.append(_fmt(path, hits))
    assert not problems, "isolation_level/autocommit di luar dbconn.py: " + "; ".join(problems)


def test_dbconn_callers_pass_explicit_path():
    """R1: di webapp/repository/bot setiap `dbconn.connect(...)`/`dbconn.get_conn(...)` mengirim
    path sebagai argumen posisi (DB_PATH modul dibaca saat dipanggil → monkeypatch tes bekerja)."""
    problems = []
    for name in EXPLICIT_PATH_FILES:
        path = ROOT / name
        for call in dbconn_calls(_parse(path)):
            if len(call.args) < 1:
                problems.append(f"{name}:{call.lineno} dbconn.{call.func.attr}() tanpa path")
    assert not problems, "; ".join(problems)


# ── webapp: get_db dan _media_db_connect lewat dbconn (Task 2) ───────────────

def _pragma(conn, name):
    return conn.execute(f"PRAGMA {name}").fetchone()[0]


def _assert_dbconn_connection(c):
    assert c.isolation_level == "IMMEDIATE"  # pembeda: koneksi lama ""
    assert _pragma(c, "busy_timeout") == 5000
    assert _pragma(c, "foreign_keys") == 1
    assert _pragma(c, "journal_mode") == "wal"
    assert c.row_factory is sqlite3.Row


def test_get_db_connection_is_dbconn():
    with webapp.get_db() as c:
        _assert_dbconn_connection(c)


def test_get_db_reads_webapp_db_path_at_call_time(monkeypatch, tmp_path):
    tmp = tmp_path / "r1.db"
    cfg_before = config.DB_PATH
    monkeypatch.setattr(webapp, "DB_PATH", str(tmp))
    with webapp.get_db() as c:
        c.execute("CREATE TABLE tes_r1 (x)")
    raw = sqlite3.connect(str(tmp))
    try:
        assert raw.execute("SELECT name FROM sqlite_master WHERE name='tes_r1'").fetchone()
    finally:
        raw.close()
    assert config.DB_PATH == cfg_before
    raw = sqlite3.connect(config.DB_PATH)
    try:
        assert raw.execute("SELECT name FROM sqlite_master WHERE name='tes_r1'").fetchone() is None
    finally:
        raw.close()


def test_get_db_rollback_on_exception(monkeypatch, tmp_path):
    tmp = tmp_path / "rb.db"
    monkeypatch.setattr(webapp, "DB_PATH", str(tmp))
    with webapp.get_db() as c:
        c.execute("CREATE TABLE tes_rb (x)")
    try:
        with webapp.get_db() as c:
            c.execute("INSERT INTO tes_rb (x) VALUES (1)")
            raise ValueError("boom")
    except ValueError:
        pass
    with webapp.get_db() as c:
        assert c.execute("SELECT COUNT(*) FROM tes_rb").fetchone()[0] == 0


def test_get_db_still_patchable(monkeypatch):
    """Pola tests/test_mindmap_live.py: get_db diganti pembungkus yang memanggil yang asli."""
    real = webapp.get_db
    calls = []

    def wrapped():
        calls.append(1)
        return real()
    monkeypatch.setattr(webapp, "get_db", wrapped)
    with webapp.get_db() as c:
        assert c.execute("SELECT 1").fetchone()[0] == 1
    assert calls == [1]


def test_worker_connect_is_dbconn():
    assert webapp.email_worker._connect is webapp.media_worker._connect
    assert webapp.media_worker._connect is webapp._media_db_connect
    c = webapp.media_worker._connect()
    try:
        _assert_dbconn_connection(c)
    finally:
        c.close()
