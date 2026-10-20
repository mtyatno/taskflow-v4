"""
Sesi multi-tab: klaim token (iat/auth_time/pwv), POST /api/auth/refresh
(perpanjangan geser + batas absolut SESSION_MAX_DAYS), dan urutan kandidat
token di _resolve_user (header Bearer → cookie → query).
"""
import asyncio
import time
from datetime import datetime, timedelta

import jwt
import pytest
from fastapi import HTTPException
from starlette.requests import Request

import webapp
from conftest import db, register_user


def _decode(token):
    return jwt.decode(token, webapp.SECRET_KEY, algorithms=["HS256"])


def _encode(payload):
    return jwt.encode(payload, webapp.SECRET_KEY, algorithm="HS256")


def _bearer(token):
    return {"Authorization": f"Bearer {token}"}


def _custom_token(user_id, username, **extra):
    now = int(time.time())
    payload = {"sub": str(user_id), "username": username,
               "exp": now + webapp.JWT_EXPIRE_HOURS * 3600}
    payload.update(extra)
    return _encode(payload)


# ── Klaim token ──────────────────────────────────────────────────────────────

def test_register_token_has_session_claims(client):
    r = register_user(client, "sess_reg", "sess_reg@x.com")
    data = _decode(r["token"])
    assert data["auth_time"] == data["iat"]
    assert data["pwv"] and len(data["pwv"]) == 16
    assert data["exp"] - data["iat"] == webapp.JWT_EXPIRE_HOURS * 3600


def test_login_token_has_session_claims(client):
    register_user(client, "sess_login", "sess_login@x.com")
    r = client.post("/api/auth/login", json={"username": "sess_login", "password": "pass1234"})
    assert r.status_code == 200, r.text
    data = _decode(r.json()["token"])
    assert data["auth_time"] == data["iat"]
    assert data["exp"] - data["iat"] == webapp.JWT_EXPIRE_HOURS * 3600
    with db() as conn:
        ph = conn.execute("SELECT password_hash FROM users WHERE username = ?",
                          ("sess_login",)).fetchone()[0]
    assert data["pwv"] == webapp._pw_fingerprint(ph)


# ── Refresh ──────────────────────────────────────────────────────────────────

def test_refresh_with_bearer_header(client):
    r = register_user(client, "sess_ref1", "sess_ref1@x.com")
    old = _decode(r["token"])
    client.cookies.clear()
    r = client.post("/api/auth/refresh", headers=_bearer(r["token"]))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["renewed"] is True
    assert body["expires_in"] == webapp.JWT_EXPIRE_HOURS * 3600
    new = _decode(body["token"])
    assert new["auth_time"] == old["auth_time"]
    assert new["iat"] >= old["iat"]
    assert new["pwv"] == old["pwv"]
    # klien header-saja (tanpa cookie) tidak diberi cookie baru
    assert "token" not in r.headers.get("set-cookie", "")
    assert client.cookies.get("token") is None
    me = client.get("/api/auth/me", headers=_bearer(body["token"]))
    assert me.status_code == 200
    assert me.json()["username"] == "sess_ref1"


def test_refresh_with_cookie_only(client):
    register_user(client, "sess_ref2", "sess_ref2@x.com")
    assert client.cookies.get("token")
    r = client.post("/api/auth/refresh")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["renewed"] is True
    assert "token=" in r.headers.get("set-cookie", "")
    assert client.cookies.get("token") == body["token"]


def test_refresh_refused_after_max_age(client):
    r = register_user(client, "sess_old", "sess_old@x.com")
    data = _decode(r["token"])
    stale = int(time.time()) - (webapp.SESSION_MAX_DAYS * 86400 + 60)
    tok = _custom_token(data["sub"], "sess_old", iat=int(time.time()),
                        auth_time=stale, pwv=data["pwv"])
    client.cookies.clear()
    r = client.post("/api/auth/refresh", headers=_bearer(tok))
    assert r.status_code == 200, r.text
    assert r.json() == {"renewed": False, "reason": "max_age"}
    assert "token" not in client.cookies


def test_refresh_refused_after_password_change(client):
    r = register_user(client, "sess_pw", "sess_pw@x.com")
    tok = r["token"]
    with db() as conn:
        conn.execute("UPDATE users SET password_hash = ? WHERE username = ?",
                     (webapp.hash_password("newpass999"), "sess_pw"))
    client.cookies.clear()
    r = client.post("/api/auth/refresh", headers=_bearer(tok))
    assert r.status_code == 401
    assert "Password sudah diganti" in r.json()["detail"]
    # pwv diperiksa di setiap request (ADR-022): token lama langsung gugur
    assert client.get("/api/auth/me", headers=_bearer(tok)).status_code == 401


def test_refresh_refused_for_ext_token(client):
    r = register_user(client, "sess_ext", "sess_ext@x.com")
    uid = r["user_id"]
    ext = webapp.create_ext_token(uid, "sess_ext")
    now = datetime.now()
    with db() as conn:
        conn.execute(
            "INSERT INTO ext_tokens (user_id, token, state, created_at, expires_at) VALUES (?,?,?,?,?)",
            (uid, ext, None, now.isoformat(), (now + timedelta(days=30)).isoformat()),
        )
    client.cookies.clear()
    r = client.post("/api/auth/refresh", headers=_bearer(ext))
    assert r.status_code == 403


def test_refresh_legacy_token_without_session_claims(client):
    r = register_user(client, "sess_legacy", "sess_legacy@x.com")
    uid = r["user_id"]
    exp = int(time.time()) + webapp.JWT_EXPIRE_HOURS * 3600 - 100
    tok = _encode({"sub": str(uid), "username": "sess_legacy", "exp": exp})
    client.cookies.clear()
    r = client.post("/api/auth/refresh", headers=_bearer(tok))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["renewed"] is True
    new = _decode(body["token"])
    assert new["pwv"]
    assert new["auth_time"] == exp - webapp.JWT_EXPIRE_HOURS * 3600


def test_refresh_unauthenticated(client):
    client.cookies.clear()
    assert client.post("/api/auth/refresh").status_code == 401


# ── Urutan kandidat _resolve_user ────────────────────────────────────────────

def test_valid_header_with_garbage_cookie(client):
    r = register_user(client, "sess_hdr", "sess_hdr@x.com")
    client.cookies.clear()
    client.cookies.set("token", "garbage")
    me = client.get("/api/auth/me", headers=_bearer(r["token"]))
    assert me.status_code == 200
    assert me.json()["id"] == r["user_id"]


def test_garbage_header_with_valid_cookie(client):
    r = register_user(client, "sess_cook", "sess_cook@x.com")
    assert client.cookies.get("token")
    me = client.get("/api/auth/me", headers=_bearer("garbage"))
    assert me.status_code == 200
    assert me.json()["id"] == r["user_id"]


def test_header_wins_over_cookie_of_other_user(client):
    a = register_user(client, "sess_a", "sess_a@x.com")
    b = register_user(client, "sess_b", "sess_b@x.com")
    # cookie jar sekarang milik B (register terakhir)
    assert _decode(client.cookies.get("token"))["username"] == "sess_b"
    me = client.get("/api/auth/me", headers=_bearer(a["token"]))
    assert me.status_code == 200
    assert me.json()["id"] == a["user_id"]
    assert me.json()["id"] != b["user_id"]


def test_no_credentials_401(client):
    client.cookies.clear()
    r = client.get("/api/auth/me")
    assert r.status_code == 401
    assert r.json()["detail"] == "Not authenticated"


def test_all_candidates_invalid_401(client):
    client.cookies.clear()
    client.cookies.set("token", "garbage-cookie")
    r = client.get("/api/auth/me", headers=_bearer("garbage-header"))
    assert r.status_code == 401
    assert r.json()["detail"] == "Invalid token"


def _expired_token(user_id, username):
    past = int(time.time()) - 3600
    return _encode({"sub": str(user_id), "username": username, "iat": past - 100,
                    "auth_time": past - 100, "exp": past})


def test_expired_header_other_user_cookie_401(client):
    a = register_user(client, "sess_exp_a", "sess_exp_a@x.com")
    register_user(client, "sess_exp_b", "sess_exp_b@x.com")  # cookie jar = B
    stale = _expired_token(a["user_id"], "sess_exp_a")
    me = client.get("/api/auth/me", headers=_bearer(stale))
    assert me.status_code == 401
    assert me.json()["detail"] == "Token expired"
    # refresh juga tidak boleh menerbitkan token milik B
    r = client.post("/api/auth/refresh", headers=_bearer(stale))
    assert r.status_code == 401


def test_expired_header_same_user_cookie_200(client):
    a = register_user(client, "sess_exp_s", "sess_exp_s@x.com")  # cookie jar = A
    stale = _expired_token(a["user_id"], "sess_exp_s")
    me = client.get("/api/auth/me", headers=_bearer(stale))
    assert me.status_code == 200
    assert me.json()["id"] == a["user_id"]


def _resolve(cookie=None, query=None, allow_query=True):
    headers = []
    if cookie:
        headers.append((b"cookie", f"token={cookie}".encode()))
    scope = {"type": "http", "method": "GET", "path": "/", "headers": headers,
             "query_string": f"token={query}".encode() if query else b""}
    return asyncio.run(webapp._resolve_user(Request(scope), allow_query=allow_query))


def test_sse_invalid_cookie_other_user_query_401(client):
    a = register_user(client, "sess_sse_a", "sess_sse_a@x.com")
    b = register_user(client, "sess_sse_b", "sess_sse_b@x.com")
    with pytest.raises(HTTPException) as ei:
        _resolve(cookie=_expired_token(a["user_id"], "sess_sse_a"), query=b["token"])
    assert ei.value.status_code == 401


def test_sse_invalid_cookie_same_user_query_200(client):
    a = register_user(client, "sess_sse_s", "sess_sse_s@x.com")
    data = _resolve(cookie=_expired_token(a["user_id"], "sess_sse_s"), query=a["token"])
    assert data["sub"] == a["user_id"]
