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


# ── HTTP (Task 4) ─────────────────────────────────────────────────────────────

import uuid  # noqa: E402

import plugin_loader  # noqa: E402
import webapp  # noqa: E402
from conftest import db as _rawdb, register_user  # noqa: E402


def _bearer(tok):
    return {"Authorization": f"Bearer {tok}"}


def _new_user(client):
    name = f"pst_{uuid.uuid4().hex[:8]}"
    r = register_user(client, name, f"{name}@x.com")
    return r["token"], r["user_id"], name


def _z(dt):
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def test_get_state_empty_then_after_put(client):
    tok, _, _ = _new_user(client)
    r = client.get("/api/plugins/state", headers=_bearer(tok))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["v"] == 1 and body["plugins"] == {}
    ps.parse_ts(body["server_time"])
    when = datetime.now(timezone.utc) - timedelta(minutes=1)
    r = client.put(f"/api/plugins/state/{PID}", json={"enabled": True, "updated_at": _z(when)},
                   headers=_bearer(tok))
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["applied"] is True
    assert out["state"]["enabled"] is True and out["state"]["settings"] == {}
    assert ps.parse_ts(out["state"]["updated_at"]) == ps.parse_ts(_z(when))
    r = client.get("/api/plugins/state", headers=_bearer(tok))
    assert r.json()["plugins"] == {PID: out["state"]}


def test_put_lww_over_http(client):
    tok, _, _ = _new_user(client)
    now = datetime.now(timezone.utc)
    url = f"/api/plugins/state/{PID}"
    r = client.put(url, json={"enabled": True, "updated_at": _z(now + timedelta(minutes=5))}, headers=_bearer(tok))
    assert r.json()["applied"] is True
    stored = ps.parse_ts(r.json()["state"]["updated_at"])
    assert stored <= datetime.now(timezone.utc)  # dipotong ke waktu server
    r = client.put(url, json={"enabled": False, "updated_at": _z(now - timedelta(minutes=10))}, headers=_bearer(tok))
    assert r.json()["applied"] is False
    assert r.json()["state"]["enabled"] is True
    same = {"enabled": False, "updated_at": _z(datetime.now(timezone.utc))}
    r1 = client.put(url, json=same, headers=_bearer(tok)).json()
    r2 = client.put(url, json=same, headers=_bearer(tok)).json()
    assert r1 == r2 and r1["applied"] is True and r1["state"]["enabled"] is False


def test_put_unknown_and_reserved_ids(client):
    tok, _, _ = _new_user(client)
    for pid in ("nope-plugin", "state", "Bad_Id"):
        r = client.put(f"/api/plugins/state/{pid}", json={"enabled": True}, headers=_bearer(tok))
        assert r.status_code == 404, (pid, r.text)
        assert r.json() == {"detail": {"code": "PLUGIN_UNKNOWN"}}


def test_put_validation_422(client):
    tok, _, _ = _new_user(client)
    url = f"/api/plugins/state/{PID}"
    for body in ({}, {"enabled": "ya"}, {"settings": []}, {"settings": None},
                 {"settings": {"x": "a" * 16400}}, {"enabled": True, "updated_at": "kemarin"},
                 {"enabled": 1}):
        r = client.put(url, json=body, headers=_bearer(tok))
        assert r.status_code == 422, (body, r.text)
    r = client.put(url, json={"enabled": True, "updated_at": "kemarin"}, headers=_bearer(tok))
    assert "updated_at tidak valid" in r.text
    r = client.put(url, json={"enabled": None}, headers=_bearer(tok))
    assert r.status_code == 200, r.text
    assert r.json()["state"]["enabled"] is None
    r = client.put(url, json={"settings": {"metric": "habits"}}, headers=_bearer(tok))
    assert r.status_code == 200 and r.json()["state"]["settings"] == {"metric": "habits"}


def test_state_requires_login_and_rejects_ext(client):
    from fastapi.testclient import TestClient
    anon = TestClient(webapp.app)
    assert anon.get("/api/plugins/state").status_code == 401
    assert anon.put(f"/api/plugins/state/{PID}", json={"enabled": True}).status_code == 401
    _, uid, name = _new_user(client)
    ext = webapp.create_ext_token(uid, name)
    now = datetime.now(timezone.utc)
    c = _rawdb()
    try:
        c.execute("INSERT INTO ext_tokens (user_id, token, state, created_at, expires_at) VALUES (?,?,?,?,?)",
                  (uid, ext, None, now.isoformat(), (now + timedelta(days=30)).isoformat()))
        c.commit()
    finally:
        c.close()
    anon = TestClient(webapp.app)
    for r in (anon.get("/api/plugins/state", headers=_bearer(ext)),
              anon.put(f"/api/plugins/state/{PID}", json={"enabled": True}, headers=_bearer(ext))):
        assert r.status_code == 403
        assert r.json() == {"detail": {"code": "PLUGIN_FORBIDDEN_TOKEN"}}


def test_state_isolated_between_users(client):
    tok1, _, _ = _new_user(client)
    tok2, _, _ = _new_user(client)
    client.put(f"/api/plugins/state/{PID}", json={"enabled": True}, headers=_bearer(tok1))
    assert client.get("/api/plugins/state", headers=_bearer(tok2)).json()["plugins"] == {}
    assert PID in client.get("/api/plugins/state", headers=_bearer(tok1)).json()["plugins"]


def test_put_503_when_index_unhealthy(client, monkeypatch):
    tok, _, _ = _new_user(client)
    monkeypatch.setattr(plugin_loader, "_index_ok", False)
    r = client.put(f"/api/plugins/state/{PID}", json={"enabled": True}, headers=_bearer(tok))
    assert r.status_code == 503
    assert r.json()["detail"]["code"] == "PLUGIN_UNAVAILABLE"
    # Indeks rusak total (known kosong): id sah tetap 503, bukan 404 yang membuat klien membuang op.
    monkeypatch.setattr(plugin_loader, "_known", {})
    r = client.put(f"/api/plugins/state/{PID}", json={"enabled": True}, headers=_bearer(tok))
    assert r.status_code == 503
