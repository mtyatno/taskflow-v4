"""Tes unit + konkurensi `dbconn` (ADR-038, spec Fase 0b §2 K1–K3, §4.2, §9.1).

Setiap tes memakai DB sendiri di `tmp_path` (bukan DB conftest) supaya jejak
`set_trace_callback` dan tes konkurensi tidak terganggu tabel lain.
Tes konkurensi memakai `threading.Event` untuk urutan; `sleep` hanya sebagai
penahan kunci yang dibatasi (≤ 0,3 s), bukan sinkronisasi.
"""
import sqlite3
import threading
import time

import pytest

import config
import dbconn


def _norm(sql):
    return " ".join(sql.split())


def _trace(conn):
    """Kumpulkan jejak SQL (dinormalisasi spasi) ke list yang dikembalikan."""
    out = []
    conn.set_trace_callback(lambda s: out.append(_norm(s)))
    return out


def _pragma(conn, name):
    return conn.execute(f"PRAGMA {name}").fetchone()[0]


def _seed_counter(path):
    """Tabel `t(id, n)` dengan satu baris id=1, n=0; koneksi ditutup."""
    c = dbconn.connect(path)
    c.execute("CREATE TABLE t (id INTEGER PRIMARY KEY, n INTEGER NOT NULL)")
    c.execute("INSERT INTO t (id, n) VALUES (1, 0)")
    c.commit()
    c.close()


def _read_n(path):
    c = dbconn.connect(path)
    try:
        return c.execute("SELECT n FROM t WHERE id = 1").fetchone()[0]
    finally:
        c.close()


# ── connect ──────────────────────────────────────────────────────────────────

def test_connect_pragmas(tmp_path):
    p = str(tmp_path / "a.db")
    conn = dbconn.connect(p)
    try:
        assert dbconn.BUSY_TIMEOUT_MS == 5000
        assert _pragma(conn, "busy_timeout") == 5000
        assert _pragma(conn, "journal_mode") == "wal"
        assert _pragma(conn, "foreign_keys") == 1
        assert conn.isolation_level == "IMMEDIATE"
        if hasattr(conn, "autocommit"):  # Python ≥ 3.12
            assert conn.autocommit == sqlite3.LEGACY_TRANSACTION_CONTROL
        assert conn.row_factory is sqlite3.Row
        assert isinstance(conn.execute("SELECT 1 AS x").fetchone(), sqlite3.Row)
    finally:
        conn.close()

    off = dbconn.connect(p, foreign_keys=False)
    try:
        assert _pragma(off, "foreign_keys") == 0
        assert _pragma(off, "busy_timeout") == 5000
        assert _pragma(off, "journal_mode") == "wal"
    finally:
        off.close()

    plain = dbconn.connect(p, row_factory=None)
    try:
        row = plain.execute("SELECT 1 AS x").fetchone()
        assert isinstance(row, tuple) and row == (1,)
    finally:
        plain.close()


class _Recording:
    """Pembungkus koneksi untuk tes `connect()`: mencatat statement yang dijalankan, menandai
    `close()`, dan (opsional) melempar pada statement yang memuat `fail_on`."""

    def __init__(self, real, fail_on=None):
        object.__setattr__(self, "_real", real)
        object.__setattr__(self, "executed", [])
        object.__setattr__(self, "closed", False)
        object.__setattr__(self, "_fail_on", fail_on)

    def execute(self, sql, *args):
        self.executed.append(sql)
        if self._fail_on and self._fail_on in sql:
            raise sqlite3.OperationalError("pragma gagal (simulasi)")
        return self._real.execute(sql, *args)

    def close(self):
        object.__setattr__(self, "closed", True)
        self._real.close()

    def __getattr__(self, name):
        return getattr(self._real, name)

    def __setattr__(self, name, value):
        setattr(self._real, name, value)


def _patch_connect(monkeypatch, fail_on=None):
    """Ganti `sqlite3.connect` (yang dipanggil dbconn) dengan pembungkus perekam; kembalikan daftarnya."""
    made = []
    real_connect = sqlite3.connect

    def fake(*args, **kwargs):
        w = _Recording(real_connect(*args, **kwargs), fail_on)
        made.append(w)
        return w

    monkeypatch.setattr(sqlite3, "connect", fake)
    return made


def test_connect_closes_connection_when_pragma_fails(tmp_path, monkeypatch):
    made = _patch_connect(monkeypatch, fail_on="journal_mode")
    with pytest.raises(sqlite3.OperationalError, match="simulasi"):
        dbconn.connect(str(tmp_path / "gagal.db"))
    assert len(made) == 1
    assert made[0].closed is True  # tidak bocor: ditutup sebelum exception diteruskan


def test_connect_sets_foreign_keys_pragma_explicitly(tmp_path, monkeypatch):
    made = _patch_connect(monkeypatch)
    p = str(tmp_path / "fk.db")
    dbconn.connect(p).close()
    dbconn.connect(p, foreign_keys=False).close()
    on, off = made
    assert "PRAGMA foreign_keys=ON" in on.executed and "PRAGMA foreign_keys=OFF" not in on.executed
    assert "PRAGMA foreign_keys=OFF" in off.executed and "PRAGMA foreign_keys=ON" not in off.executed
    for w in (on, off):
        assert "PRAGMA busy_timeout=5000" in w.executed and "PRAGMA journal_mode=WAL" in w.executed
        assert w.closed


def test_default_path_is_read_at_call_time(tmp_path, monkeypatch):
    target = tmp_path / "default.db"
    monkeypatch.setattr(config, "DB_PATH", str(target))
    assert dbconn.default_path() == str(target)
    conn = dbconn.connect()
    try:
        conn.execute("CREATE TABLE tes_default (x)")
        conn.commit()
    finally:
        conn.close()
    assert target.exists()
    other = tmp_path / "lain.db"
    monkeypatch.setattr(config, "DB_PATH", str(other))
    assert dbconn.default_path() == str(other)


# ── get_conn ─────────────────────────────────────────────────────────────────

def test_get_conn_commit_rollback_close(tmp_path):
    p = str(tmp_path / "g.db")
    with dbconn.get_conn(p) as conn:
        conn.execute("CREATE TABLE t (x INTEGER)")
        conn.execute("INSERT INTO t (x) VALUES (1)")
        kept = conn
    with pytest.raises(sqlite3.ProgrammingError):
        kept.execute("SELECT 1")  # sudah ditutup

    with pytest.raises(ValueError, match="boom"):
        with dbconn.get_conn(p) as conn:
            conn.execute("INSERT INTO t (x) VALUES (2)")
            raise ValueError("boom")

    with dbconn.get_conn(p) as conn:
        rows = [r["x"] for r in conn.execute("SELECT x FROM t ORDER BY x").fetchall()]
    assert rows == [1]


def test_get_conn_foreign_keys_flag(tmp_path):
    p = str(tmp_path / "fk.db")
    with dbconn.get_conn(p) as conn:
        assert _pragma(conn, "foreign_keys") == 1
    with dbconn.get_conn(p, foreign_keys=False) as conn:
        assert _pragma(conn, "foreign_keys") == 0


# ── mode transaksi legacy (R2a–c) ────────────────────────────────────────────

def test_legacy_trace_begin_only_before_dml(tmp_path):
    p = str(tmp_path / "tr.db")
    conn = dbconn.connect(p)
    try:
        tr = _trace(conn)
        conn.execute("SELECT 1").fetchone()
        assert conn.in_transaction is False
        conn.execute("CREATE TABLE t (x INTEGER)")
        assert conn.in_transaction is False
        conn.execute("INSERT INTO t (x) VALUES (1)")
        assert conn.in_transaction is True
        conn.commit()
        assert tr == [
            "SELECT 1",
            "CREATE TABLE t (x INTEGER)",
            "BEGIN IMMEDIATE",
            "INSERT INTO t (x) VALUES (1)",
            "COMMIT",
        ]
    finally:
        conn.close()


def test_write_tx_trace(tmp_path):
    p = str(tmp_path / "wt.db")
    _seed_counter(p)
    conn = dbconn.connect(p)
    try:
        tr = _trace(conn)
        with dbconn.write_tx(conn) as c:
            assert c is conn
            assert conn.in_transaction is True
            n = conn.execute("SELECT n FROM t WHERE id = 1").fetchone()[0]
            conn.execute("UPDATE t SET n = 1 WHERE id = 1")
            assert n == 0
        assert conn.in_transaction is False
        assert tr == [
            "BEGIN IMMEDIATE",
            "SELECT n FROM t WHERE id = 1",
            "UPDATE t SET n = 1 WHERE id = 1",
            "COMMIT",
        ]
    finally:
        conn.close()
    assert _read_n(p) == 1


def test_write_tx_rollback_on_exception(tmp_path):
    p = str(tmp_path / "rb.db")
    _seed_counter(p)
    conn = dbconn.connect(p)
    try:
        tr = _trace(conn)
        with pytest.raises(ValueError, match="gagal"):
            with dbconn.write_tx(conn):
                conn.execute("UPDATE t SET n = 99 WHERE id = 1")
                raise ValueError("gagal")
        assert conn.in_transaction is False
        assert tr[-1] == "ROLLBACK"
        assert tr[0] == "BEGIN IMMEDIATE"
    finally:
        conn.close()
    assert _read_n(p) == 0


def test_write_tx_rejects_open_transaction(tmp_path):
    p = str(tmp_path / "open.db")
    _seed_counter(p)
    conn = dbconn.connect(p)
    try:
        conn.execute("INSERT INTO t (id, n) VALUES (2, 0)")  # transaksi implisit terbuka
        assert conn.in_transaction is True
        with pytest.raises(RuntimeError) as ei:
            with dbconn.write_tx(conn):
                pass  # pragma: no cover
        assert str(ei.value) == "write_tx: transaksi sudah terbuka"
        assert conn.in_transaction is True  # transaksi pemanggil tidak disentuh
        conn.rollback()

        with pytest.raises(RuntimeError, match="write_tx: transaksi sudah terbuka"):
            with dbconn.write_tx(conn):
                with dbconn.write_tx(conn):
                    pass  # pragma: no cover
        assert conn.in_transaction is False
    finally:
        conn.close()
    assert _read_n(p) == 0


def test_write_tx_inside_get_conn(tmp_path):
    p = str(tmp_path / "nest.db")
    _seed_counter(p)
    with dbconn.get_conn(p) as c, dbconn.write_tx(c):
        n = c.execute("SELECT n FROM t WHERE id = 1").fetchone()[0]
        c.execute("UPDATE t SET n = ? WHERE id = 1", (n + 5,))
    # commit ganda (write_tx lalu get_conn) tidak melempar
    assert _read_n(p) == 5


def test_write_tx_with_savepoint(tmp_path):
    p = str(tmp_path / "sp.db")
    _seed_counter(p)
    conn = dbconn.connect(p)
    try:
        tr = _trace(conn)
        with dbconn.write_tx(conn):
            conn.execute("SAVEPOINT s")
            conn.execute("INSERT INTO t (id, n) VALUES (2, 7)")
            conn.execute("RELEASE s")
        assert tr == [
            "BEGIN IMMEDIATE",
            "SAVEPOINT s",
            "INSERT INTO t (id, n) VALUES (2, 7)",
            "RELEASE s",
            "COMMIT",
        ]
        assert conn.execute("SELECT n FROM t WHERE id = 2").fetchone()[0] == 7
    finally:
        conn.close()


# ── bahaya yang dihindari K3 (R2d, R2e) ──────────────────────────────────────

def test_read_then_write_without_write_tx_loses_update(tmp_path):
    """Dokumentasi bahaya: SELECT di luar transaksi lalu UPDATE berdasar nilainya = pembaruan hilang
    tanpa error. Inilah alasan K3 mewajibkan write_tx untuk kode baca-lalu-tulis."""
    p = str(tmp_path / "lost.db")
    _seed_counter(p)
    A = dbconn.connect(p)
    B = dbconn.connect(p)
    try:
        na = A.execute("SELECT n FROM t WHERE id = 1").fetchone()[0]
        nb = B.execute("SELECT n FROM t WHERE id = 1").fetchone()[0]
        assert (na, nb) == (0, 0)
        B.execute("UPDATE t SET n = ? WHERE id = 1", (nb + 1,))
        B.commit()
        A.execute("UPDATE t SET n = ? WHERE id = 1", (na + 1,))
        A.commit()  # tidak melempar
    finally:
        A.close()
        B.close()
    assert _read_n(p) == 1  # bukan 2


def test_deferred_read_then_write_fails_immediately(tmp_path):
    """Transaksi deferred (BEGIN; SELECT) yang menulis setelah penulis lain commit gagal SEKETIKA
    `database is locked` (SQLITE_BUSY_SNAPSHOT); busy_timeout 5 s tidak dipakai."""
    p = str(tmp_path / "snap.db")
    _seed_counter(p)
    A = dbconn.connect(p)
    B = dbconn.connect(p)
    try:
        A.execute("BEGIN")
        A.execute("SELECT n FROM t WHERE id = 1").fetchone()
        B.execute("UPDATE t SET n = n + 1 WHERE id = 1")
        B.commit()
        t0 = time.perf_counter()
        with pytest.raises(sqlite3.OperationalError, match="locked"):
            A.execute("UPDATE t SET n = n + 1 WHERE id = 1")
        assert time.perf_counter() - t0 < 1.0
        A.rollback()
    finally:
        A.close()
        B.close()
    assert _read_n(p) == 1


# ── konkurensi write_tx ──────────────────────────────────────────────────────

def test_write_tx_waits_for_other_writer_then_sees_its_write(tmp_path):
    p = str(tmp_path / "wait.db")
    _seed_counter(p)
    started = threading.Event()
    errors = []

    def writer_b():
        try:
            conn = dbconn.connect(p)
            try:
                with dbconn.write_tx(conn):
                    conn.execute("UPDATE t SET n = n + 1 WHERE id = 1")
                    started.set()
                    time.sleep(0.3)  # tahan kunci sebentar (dibatasi), bukan sinkronisasi
            finally:
                conn.close()
        except BaseException as e:  # pragma: no cover
            errors.append(repr(e))
            started.set()

    th = threading.Thread(target=writer_b)
    th.start()
    assert started.wait(2)
    t0 = time.perf_counter()
    conn = dbconn.connect(p)
    try:
        with dbconn.write_tx(conn):
            n = conn.execute("SELECT n FROM t WHERE id = 1").fetchone()[0]
            assert n == 1  # menunggu B commit, lalu melihat tulisannya
            conn.execute("UPDATE t SET n = ? WHERE id = 1", (n + 1,))
    finally:
        conn.close()
    elapsed = time.perf_counter() - t0
    th.join(2)
    assert not th.is_alive()
    assert errors == []
    assert elapsed >= 0.2
    assert _read_n(p) == 2


def test_write_tx_two_threads_fifty_increments(tmp_path):
    p = str(tmp_path / "inc.db")
    _seed_counter(p)
    errors = []
    go = threading.Event()

    def worker():
        conn = dbconn.connect(p)
        try:
            go.wait(2)
            for _ in range(50):
                try:
                    with dbconn.write_tx(conn):
                        n = conn.execute("SELECT n FROM t WHERE id = 1").fetchone()[0]
                        conn.execute("UPDATE t SET n = ? WHERE id = 1", (n + 1,))
                except Exception as e:
                    errors.append(repr(e))
        finally:
            conn.close()

    threads = [threading.Thread(target=worker) for _ in range(2)]
    for th in threads:
        th.start()
    go.set()
    for th in threads:
        th.join(30)
        assert not th.is_alive()
    assert errors == []
    assert _read_n(p) == 100
