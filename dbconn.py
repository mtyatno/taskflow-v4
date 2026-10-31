"""
Alurik — satu pintu koneksi SQLite (ADR-038, spec Fase 0b §2 K1–K3, §4.2).

Modul ini adalah SATU-SATUNYA tempat `sqlite3.connect` dipanggil di kode layanan
(dijaga pagar AST `tests/test_dbconn_callsites.py`). Hanya meng-import stdlib
(+ `config` secara malas di `default_path`); tidak pernah meng-import `webapp`,
`repository`, atau `bot` (keduanya meng-import modul ini).

Pragma per koneksi (K2): `busy_timeout=5000` eksplisit, `journal_mode=WAL`, dan
`foreign_keys=ON`/`OFF` eksplisit sesuai parameter `foreign_keys`. Mode transaksi = *legacy* Python dengan
`isolation_level="IMMEDIATE"`: SELECT/DDL sebelum DML pertama berjalan di luar
transaksi, DML pertama memicu `BEGIN IMMEDIATE`. Atribut `conn.autocommit`
(Python ≥ 3.12) TIDAK PERNAH disentuh — tetap `sqlite3.LEGACY_TRANSACTION_CONTROL`.

Aturan K3 untuk kode BARU yang membaca lalu menulis pada koneksi yang sama:
wajib `with dbconn.write_tx(conn):` (`BEGIN IMMEDIATE` sebelum SELECT pertama).
Tanpa itu, SELECT berjalan sebelum transaksi dan pembaruan bisa hilang tanpa
error; transaksi *deferred* yang membaca lalu menulis setelah penulis lain
commit gagal seketika `database is locked` (SQLITE_BUSY_SNAPSHOT) — keduanya
dibuktikan di `tests/test_dbconn.py`. Jangan menulis saat kursor masih
terbuka: `fetchall()` dulu, baru menulis. Kode lama tidak di-refactor.
"""
from __future__ import annotations

import sqlite3
from contextlib import contextmanager

BUSY_TIMEOUT_MS = 5000


def default_path() -> str:
    """`config.DB_PATH`, dibaca SAAT DIPANGGIL (bukan saat import) agar monkeypatch tes bekerja."""
    import config
    return config.DB_PATH


def connect(path: str | None = None, *, foreign_keys: bool = True,
            row_factory=sqlite3.Row) -> sqlite3.Connection:
    """Buka koneksi dengan pragma standar. Pemanggil bertanggung jawab commit/close.
    Bila pengaturan pragma gagal, koneksi ditutup dulu lalu exception diteruskan (tidak bocor).
    `foreign_keys=False` menulis `PRAGMA foreign_keys=OFF` eksplisit (tidak bergantung pada
    default kompilasi SQLite) — K4 `migrate_db`."""
    conn = sqlite3.connect(
        path or default_path(),
        timeout=BUSY_TIMEOUT_MS / 1000,
        isolation_level="IMMEDIATE",
    )
    try:
        conn.row_factory = row_factory
        conn.execute(f"PRAGMA busy_timeout={BUSY_TIMEOUT_MS}")
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA foreign_keys=ON" if foreign_keys else "PRAGMA foreign_keys=OFF")
    except BaseException:
        conn.close()
        raise
    return conn


@contextmanager
def get_conn(path: str | None = None, *, foreign_keys: bool = True):
    """Semantik `webapp.get_db` lama: commit bila blok sukses, rollback bila `Exception`,
    selalu close (close di `finally` juga membuang transaksi bila `BaseException` lolos)."""
    conn = connect(path, foreign_keys=foreign_keys)
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


@contextmanager
def write_tx(conn: sqlite3.Connection):
    """Transaksi tulis untuk pola baca-ubah-tulis: `BEGIN IMMEDIATE` eksplisit SEBELUM
    SELECT pertama, `COMMIT` bila sukses, `ROLLBACK` bila `BaseException`.
    Menolak koneksi yang transaksinya sudah terbuka (termasuk `write_tx` bersarang)."""
    if conn.in_transaction:
        raise RuntimeError("write_tx: transaksi sudah terbuka")
    conn.execute("BEGIN IMMEDIATE")
    try:
        yield conn
        conn.commit()
    except BaseException:
        conn.rollback()
        raise
