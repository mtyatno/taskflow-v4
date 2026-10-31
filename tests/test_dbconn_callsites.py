"""Pagar AST: `sqlite3.connect` hanya boleh dipanggil di `dbconn.py` (ADR-038, spec Fase 0b §4.3).

Aturan keras (tanpa ratchet sejak PR A Task 6): `dbconn.py` wajib tepat SATU `sqlite3.connect`;
file produksi lain nol. Yang ditolak di luar `dbconn.py`:
- `sqlite3.connect(...)` lewat `import sqlite3`, `import sqlite3 as X` (termasuk import di dalam
  fungsi — kasus `bot.py` lama), dan `from sqlite3 import connect [as Y]`;
- kata kunci `isolation_level=` / `autocommit=` pada pemanggilan apa pun;
- assignment ke atribut `.isolation_level` / `.autocommit`.

Yang dipindai: semua `*.py` di akar repo dan `plugins/*.py` (modul server plugin, PR B; folder
boleh belum ada) — `PROD_FILES`. Tidak dipindai: `scripts/` (skrip pemeliharaan, mis.
`scripts/dedup_drawings.py` yang masih memakai `sqlite3.connect`), `tests/`, `temporary_files/`,
`venv/`, `node_modules/`, `draw-app/`, `docs/`.

Allowlist (`ALLOWLIST`) = skrip sekali jalan di akar repo yang dijalankan manual dan tidak
pernah di-import layanan: `merge_db.py`, `fix_list_tasks.py`. Menambah pengecualian baru
harus beralasan di PR (bukan jalan pintas untuk kode layanan): kode yang dipakai `webapp`,
`repository`, `bot`, worker, atau plugin wajib lewat `dbconn.connect`/`dbconn.get_conn`.
"""
import ast
import sqlite3
from pathlib import Path

import config
import webapp
from repository import TaskRepository

ROOT = Path(__file__).resolve().parent.parent

# Skrip sekali jalan / pemeliharaan yang dijalankan manual dan tidak pernah di-import layanan.
# Menambah pengecualian baru harus beralasan di PR (bukan jalan pintas untuk kode layanan).
ALLOWLIST = {
    "merge_db.py",       # gabung backup → DB aktif, sekali jalan
    "fix_list_tasks.py",  # perbaikan data sekali jalan
}

DBCONN_PY = ROOT / "dbconn.py"

# Akar repo + modul server plugin (`plugins/<id>.py`, PR B; glob kosong bila folder belum ada).
PROD_FILES = sorted(
    p for p in [*ROOT.glob("*.py"), *ROOT.glob("plugins/*.py")] if p.name not in ALLOWLIST
)

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


def _rel(path):
    return path.relative_to(ROOT).as_posix()


def _fmt(path, hits):
    return ", ".join(f"{_rel(path)}:{ln} {form}" for ln, form in hits)


def test_prod_files_scanned():
    rels = {_rel(p) for p in PROD_FILES}
    assert {"webapp.py", "repository.py", "bot.py", "dbconn.py"} <= rels
    assert not (ALLOWLIST & rels)
    assert all(r.endswith(".py") and ("/" not in r or r.startswith("plugins/")) for r in rels)


def test_sqlite_connect_only_in_dbconn():
    assert DBCONN_PY.exists(), "dbconn.py belum ada"
    own = connect_calls(DBCONN_PY)
    assert len(own) == 1, f"dbconn.py wajib tepat satu sqlite3.connect: {_fmt(DBCONN_PY, own)}"

    problems = []
    for path in PROD_FILES:
        if path == DBCONN_PY:
            continue
        hits = connect_calls(path)
        if hits:
            problems.append(_fmt(path, hits))
    assert not problems, (
        "sqlite3.connect di luar dbconn.py (pakai dbconn.connect/dbconn.get_conn): " + "; ".join(problems)
    )


def test_no_isolation_level_or_autocommit_outside_dbconn():
    problems = []
    for path in PROD_FILES:
        if path == DBCONN_PY:
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


# ── webapp: migrate_db tanpa FK kecuali blok project (Task 3, K4/R3) ─────────

def test_migrate_db_connects_without_fk_except_project_block():
    tree = _parse(ROOT / "webapp.py")
    fn = next(n for n in ast.walk(tree) if isinstance(n, ast.FunctionDef) and n.name == "migrate_db")
    calls = [c for c in dbconn_calls(fn) if c.func.attr == "connect"]
    assert len(calls) == 27, f"migrate_db: {len(calls)} pemanggilan dbconn.connect (harus 27)"
    trues = []
    for c in calls:
        assert c.args and isinstance(c.args[0], ast.Name) and c.args[0].id == "DB_PATH", \
            f"webapp.py:{c.lineno} dbconn.connect tanpa DB_PATH sebagai argumen pertama"
        fk = [kw for kw in c.keywords if kw.arg == "foreign_keys"]
        assert len(fk) == 1, f"webapp.py:{c.lineno} dbconn.connect tanpa foreign_keys= literal"
        val = fk[0].value
        assert isinstance(val, ast.Constant) and isinstance(val.value, bool), \
            f"webapp.py:{c.lineno} foreign_keys= harus literal True/False"
        if val.value is True:
            trues.append(c.lineno)
    assert len(trues) == 1, f"migrate_db: foreign_keys=True harus tepat satu (blok project), ada di {trues}"


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


# ── repository: TaskRepository._connect lewat dbconn.get_conn (Task 4) ───────

def test_repository_connect_is_dbconn(tmp_path):
    repo = TaskRepository(str(tmp_path / "r.db"))  # _init_db lewat dbconn
    assert repo.db_path == str(tmp_path / "r.db")
    with repo._connect() as c:
        _assert_dbconn_connection(c)


def test_repository_connect_rollback(tmp_path):
    repo = TaskRepository(str(tmp_path / "rb.db"))
    try:
        with repo._connect() as c:
            c.execute(
                "INSERT INTO users (username, display_name, password_hash, created_at) VALUES ('x', 'X', 'h', 't')"
            )
            raise ValueError("boom")
    except ValueError:
        pass
    with repo._connect() as c:
        assert c.execute("SELECT COUNT(*) FROM users WHERE username = 'x'").fetchone()[0] == 0


def test_repository_explicit_begin_immediate_still_works(tmp_path):
    """BEGIN IMMEDIATE eksplisit (repository.py pin_workspace/unpin_workspace) di atas koneksi
    isolation_level="IMMEDIATE": tidak ada BEGIN ganda, `return` di dalam blok tetap commit."""
    repo = TaskRepository(str(tmp_path / "pin.db"))
    uid = repo.auto_register_telegram_user(1, "A")
    lid = repo.create_shared_list("WS", uid)["id"]
    assert repo.pin_workspace(uid, lid) == 0
    assert repo.pin_workspace(uid, lid) == 0  # idempoten
    assert repo.unpin_workspace(uid, lid) is True
    assert repo.unpin_workspace(uid, lid) is False
