"""plugin_states — skema per pengguna, last-write-wins, API status (spec Fase 0b §4.5, §5; rencana PR B T1, T4)."""
from datetime import datetime, timedelta, timezone

import pytest

import dbconn
import plugin_states as ps

T0 = datetime(2026, 11, 1, 10, 0, 0, tzinfo=timezone.utc)
U1, U2 = 1, 2
PID = "habit-heatmap"


@pytest.fixture
def conn(tmp_path):
    c = dbconn.connect(str(tmp_path / "p.db"))
    c.execute("CREATE TABLE users (id INTEGER PRIMARY KEY)")
    c.execute("INSERT INTO users (id) VALUES (1), (2)")
    c.commit()
    ps.ensure_schema(c)
    c.commit()
    yield c
    c.close()


def _rows(conn):
    return [dict(r) for r in conn.execute(
        "SELECT * FROM plugin_states ORDER BY user_id, plugin_id, scope").fetchall()]


# ── Unit (Task 1) ─────────────────────────────────────────────────────────────

def test_ensure_schema_idempotent(conn):
    ps.ensure_schema(conn)
    ps.ensure_schema(conn)
    conn.commit()
    info = conn.execute("PRAGMA table_info(plugin_states)").fetchall()
    assert [r["name"] for r in info] == ["user_id", "plugin_id", "scope", "enabled", "settings", "updated_at"]
    pk = sorted((r["pk"], r["name"]) for r in info if r["pk"])
    assert [n for _, n in pk] == ["user_id", "plugin_id", "scope"]


def test_put_creates_then_updates(conn):
    applied, state = ps.put_state(conn, U1, PID, fields={"enabled": True},
                                  updated_at=T0, now=T0 + timedelta(minutes=1))
    assert applied is True
    assert state == {"enabled": True, "settings": {}, "updated_at": ps.iso(T0)}
    applied, state = ps.put_state(conn, U1, PID, fields={"enabled": False},
                                  updated_at=T0 + timedelta(seconds=30), now=T0 + timedelta(minutes=1))
    assert applied is True
    assert state["enabled"] is False
    assert len(_rows(conn)) == 1


def test_put_older_not_applied(conn):
    ps.put_state(conn, U1, PID, fields={"enabled": True},
                 updated_at=T0 + timedelta(minutes=5), now=T0 + timedelta(minutes=10))
    before = _rows(conn)
    applied, state = ps.put_state(conn, U1, PID, fields={"enabled": False},
                                  updated_at=T0, now=T0 + timedelta(minutes=10))
    assert applied is False
    assert state == {"enabled": True, "settings": {}, "updated_at": ps.iso(T0 + timedelta(minutes=5))}
    assert _rows(conn) == before


def test_put_equal_time_is_idempotent(conn):
    r1 = ps.put_state(conn, U1, PID, fields={"enabled": True}, updated_at=T0, now=T0 + timedelta(minutes=1))
    r2 = ps.put_state(conn, U1, PID, fields={"enabled": True}, updated_at=T0, now=T0 + timedelta(minutes=1))
    assert r1 == r2
    assert r1[0] is True
    assert len(_rows(conn)) == 1


def test_put_future_clipped(conn):
    now = T0
    applied, state = ps.put_state(conn, U1, PID, fields={"enabled": True},
                                  updated_at=now + timedelta(days=1), now=now)
    assert applied is True
    assert state["updated_at"] == ps.iso(now)
    now2 = now + timedelta(seconds=2)
    applied, state = ps.put_state(conn, U1, PID, fields={"enabled": False},
                                  updated_at=now + timedelta(seconds=1), now=now2)
    assert applied is True
    assert state["enabled"] is False


def test_put_partial_fields(conn):
    ps.put_state(conn, U1, PID, fields={"enabled": True}, updated_at=T0, now=T0)
    applied, state = ps.put_state(conn, U1, PID, fields={"settings": {"a": 1}},
                                  updated_at=T0 + timedelta(seconds=1), now=T0 + timedelta(seconds=1))
    assert applied is True
    assert state == {"enabled": True, "settings": {"a": 1}, "updated_at": ps.iso(T0 + timedelta(seconds=1))}
    applied, state = ps.put_state(conn, U1, PID, fields={"enabled": None},
                                  updated_at=T0 + timedelta(seconds=2), now=T0 + timedelta(seconds=2))
    assert state["enabled"] is None
    assert state["settings"] == {"a": 1}
    assert conn.execute("SELECT enabled FROM plugin_states").fetchone()[0] is None
    assert ps.effective_enabled(conn, U1, PID, default_enabled=True) is True
    assert ps.effective_enabled(conn, U1, PID, default_enabled=False) is False
    # Tanpa baris → default.
    assert ps.effective_enabled(conn, U2, PID, default_enabled=True) is True
    ps.put_state(conn, U1, PID, fields={"enabled": False}, updated_at=None, now=T0 + timedelta(seconds=3))
    assert ps.effective_enabled(conn, U1, PID, default_enabled=True) is False


def test_put_new_row_settings_only_has_null_enabled(conn):
    applied, state = ps.put_state(conn, U1, PID, fields={"settings": {"x": 1}}, updated_at=None, now=T0)
    assert applied is True
    assert state == {"enabled": None, "settings": {"x": 1}, "updated_at": ps.iso(T0)}


def test_get_states_isolated_per_user_and_scope(conn):
    ps.put_state(conn, U1, PID, fields={"enabled": True}, updated_at=T0, now=T0)
    with dbconn.write_tx(conn):
        conn.execute("INSERT INTO plugin_states (user_id, plugin_id, scope, enabled, settings, updated_at) "
                     "VALUES (1, 'other-plugin', 'workspace', 1, '{}', ?)", (ps.iso(T0),))
    assert ps.get_states(conn, U1) == {PID: {"enabled": True, "settings": {}, "updated_at": ps.iso(T0)}}
    assert ps.get_states(conn, U2) == {}


def test_parse_ts():
    a = ps.parse_ts("2026-11-01T10:05:00Z")
    b = ps.parse_ts("2026-11-01T17:05:00+07:00")
    assert a == b
    assert a.tzinfo is not None and a.utcoffset() == timedelta(0)
    naive = ps.parse_ts("2026-11-01T10:05:00")
    assert naive == a
    assert naive.utcoffset() == timedelta(0)
    with pytest.raises(ValueError):
        ps.parse_ts("kemarin")
    assert ps.iso(a) == "2026-11-01T10:05:00.000+00:00"


def test_cascade_on_user_delete(conn):
    ps.put_state(conn, U1, PID, fields={"enabled": True}, updated_at=T0, now=T0)
    ps.put_state(conn, U2, PID, fields={"enabled": True}, updated_at=T0, now=T0)
    assert conn.execute("PRAGMA foreign_keys").fetchone()[0] == 1
    conn.execute("DELETE FROM users WHERE id = 1")
    conn.commit()
    assert [r["user_id"] for r in _rows(conn)] == [2]


def test_put_state_uses_write_tx(conn):
    trace = []
    conn.set_trace_callback(trace.append)
    try:
        ps.put_state(conn, U1, PID, fields={"enabled": True}, updated_at=T0, now=T0)
    finally:
        conn.set_trace_callback(None)
    stmts = [s.strip().split()[0].upper() for s in trace]
    assert trace[0].strip().upper() == "BEGIN IMMEDIATE"
    assert stmts.index("SELECT") > 0
    conn.execute("INSERT INTO users (id) VALUES (3)")  # membuka transaksi legacy
    assert conn.in_transaction
    with pytest.raises(RuntimeError):
        ps.put_state(conn, U1, PID, fields={"enabled": False}, updated_at=None, now=T0 + timedelta(minutes=1))
    conn.rollback()
