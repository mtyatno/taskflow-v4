"""Profil akun: ganti password/username, lengkapi akun Telegram (password_set),
dan pwv (sidik jari password) yang diperiksa di setiap request."""
import os
import sqlite3
import uuid
from datetime import datetime, timedelta

import pytest
from starlette.testclient import TestClient

import repository
import webapp
from conftest import register_user, db


def _uniq(p="u"):
    return f"{p}{uuid.uuid4().hex[:8]}"


def _device(token=None):
    """Klien terpisah tanpa cookie — mensimulasikan perangkat lain (header Bearer saja)."""
    c = TestClient(webapp.app)
    c.cookies.clear()
    return c


def _h(token):
    return {"Authorization": f"Bearer {token}"}


def _new_user(client, password="pass1234"):
    name = _uniq("acc")
    data = register_user(client, name, f"{name}@test.id", password=password)
    client.cookies.clear()
    return name, data


def _login(name, password="pass1234"):
    c = _device()
    r = c.post("/api/auth/login", json={"username": name, "password": password})
    assert r.status_code == 200, r.text
    return r.json()["token"]


def _tg_user():
    tid = int(uuid.uuid4().int % 10**9) + 10**9
    repo = repository.TaskRepository(os.environ["DB_PATH"])
    uid = repo.auto_register_telegram_user(tid, "Pengguna TG")
    with db() as conn:
        row = conn.execute("SELECT * FROM users WHERE id = ?", (uid,)).fetchone()
    token = webapp.create_token(uid, row["username"], pwv=webapp._pw_fingerprint(row["password_hash"]))
    return uid, row["username"], token


def _ext_token(uid, username):
    tok = webapp.create_ext_token(uid, username)
    now = datetime.now()
    with db() as conn:
        conn.execute(
            "INSERT INTO ext_tokens (user_id, token, state, created_at, expires_at) VALUES (?,?,NULL,?,?)",
            (uid, tok, now.isoformat(), (now + timedelta(days=30)).isoformat()),
        )
    return tok


# ── Migrasi users.password_set ────────────────────────────────────────────────

def test_migration_password_set_marks_tg_users_and_is_idempotent(tmp_path):
    path = str(tmp_path / "old.db")
    repository.TaskRepository(path)
    c = sqlite3.connect(path)
    c.execute("ALTER TABLE users DROP COLUMN password_set")  # simulasi DB lama
    c.execute("INSERT INTO users (username, password_hash, telegram_id, created_at) "
              "VALUES ('tg_555', 'x', 555, '2026-01-01')")
    c.execute("INSERT INTO users (username, password_hash, telegram_id, created_at) "
              "VALUES ('webuser', 'x', 777, '2026-01-01')")  # tertaut Telegram, username sendiri
    c.execute("INSERT INTO users (username, password_hash, created_at) "
              "VALUES ('biasa', 'x', '2026-01-01')")
    c.commit()
    c.close()

    repository.TaskRepository(path)
    c = sqlite3.connect(path)
    rows = dict(c.execute("SELECT username, password_set FROM users").fetchall())
    assert rows == {"tg_555": 0, "webuser": 1, "biasa": 1}

    # migrasi ulang tidak menyentuh data: tg_ yang sudah melengkapi tetap 1
    c.execute("UPDATE users SET password_set = 1 WHERE username = 'tg_555'")
    c.commit()
    c.close()
    repository.TaskRepository(path)
    c = sqlite3.connect(path)
    assert c.execute("SELECT password_set FROM users WHERE username='tg_555'").fetchone()[0] == 1
    c.close()


def test_telegram_auto_register_sets_password_set_zero():
    uid, _, _ = _tg_user()
    with db() as conn:
        assert conn.execute("SELECT password_set FROM users WHERE id=?", (uid,)).fetchone()[0] == 0


def test_me_returns_password_set(client):
    _, data = _new_user(client)
    me = _device().get("/api/auth/me", headers=_h(data["token"]))
    assert me.status_code == 200
    assert me.json()["password_set"] is True
    _, _, tg_tok = _tg_user()
    me = _device().get("/api/auth/me", headers=_h(tg_tok))
    assert me.json()["password_set"] is False


# ── Ganti password ────────────────────────────────────────────────────────────

def test_change_password_wrong_old(client):
    _, data = _new_user(client)
    r = _device().patch("/api/auth/profile/password",
                        json={"old_password": "SALAH", "new_password": "baru1234"},
                        headers=_h(data["token"]))
    assert r.status_code == 400
    assert r.json()["detail"] == "Password lama salah"


def test_change_password_validates_length(client):
    _, data = _new_user(client)
    r = _device().patch("/api/auth/profile/password",
                        json={"old_password": "pass1234", "new_password": "abc"},
                        headers=_h(data["token"]))
    assert r.status_code == 422


def test_change_password_revokes_other_devices(client):
    name, _ = _new_user(client)
    tok_a = _login(name)
    tok_b = _login(name)
    r = _device().patch("/api/auth/profile/password",
                        json={"old_password": "pass1234", "new_password": "baru1234"},
                        headers=_h(tok_a))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["ok"] is True and body["token"]

    r_b = _device().get("/api/auth/me", headers=_h(tok_b))
    assert r_b.status_code == 401
    assert r_b.json()["detail"] == "Password sudah diganti — masuk lagi"
    assert _device().get("/api/auth/me", headers=_h(tok_a)).status_code == 401
    assert _device().get("/api/auth/me", headers=_h(body["token"])).status_code == 200

    # login dengan password baru berhasil, lama gagal
    assert _device().post("/api/auth/login", json={"username": name, "password": "baru1234"}).status_code == 200
    assert _device().post("/api/auth/login", json={"username": name, "password": "pass1234"}).status_code == 401


def test_change_password_keeps_auth_time(client):
    name, _ = _new_user(client)
    with db() as conn:
        row = conn.execute("SELECT id, password_hash FROM users WHERE username=?", (name,)).fetchone()
    old_auth = int(datetime.now().timestamp()) - 5 * 86400
    tok = webapp.create_token(row["id"], name, auth_time=old_auth,
                              pwv=webapp._pw_fingerprint(row["password_hash"]))
    r = _device().patch("/api/auth/profile/password",
                        json={"old_password": "pass1234", "new_password": "baru1234"}, headers=_h(tok))
    assert r.status_code == 200
    assert webapp.decode_token(r.json()["token"])["auth_time"] == old_auth


def test_change_password_cookie_rule(client):
    name, _ = _new_user(client)
    # tanpa cookie → tidak set cookie
    r = _device().patch("/api/auth/profile/password",
                        json={"old_password": "pass1234", "new_password": "baru1234"},
                        headers=_h(_login(name)))
    assert r.status_code == 200
    assert "token=" not in r.headers.get("set-cookie", "")

    # dengan cookie → cookie diperbarui ke token baru
    c = _device()
    lr = c.post("/api/auth/login", json={"username": name, "password": "baru1234"})
    assert lr.status_code == 200 and c.cookies.get("token")
    r = c.patch("/api/auth/profile/password",
                json={"old_password": "baru1234", "new_password": "lagi1234"})
    assert r.status_code == 200
    assert c.cookies.get("token") == r.json()["token"]


def test_change_password_revokes_ext_tokens(client):
    name, data = _new_user(client)
    ext = _ext_token(data["user_id"], name)
    assert _device().get("/api/auth/me", headers=_h(ext)).status_code == 200
    r = _device().patch("/api/auth/profile/password",
                        json={"old_password": "pass1234", "new_password": "baru1234"},
                        headers=_h(_login(name)))
    assert r.status_code == 200
    assert _device().get("/api/auth/me", headers=_h(ext)).status_code == 401
    with db() as conn:
        n = conn.execute("SELECT COUNT(*) FROM ext_tokens WHERE user_id=?", (data["user_id"],)).fetchone()[0]
    assert n == 0


def test_token_without_pwv_still_works(client):
    name, data = _new_user(client)
    legacy = webapp.create_token(data["user_id"], name)  # token lama tanpa klaim pwv
    assert _device().get("/api/auth/me", headers=_h(legacy)).status_code == 200


def test_token_for_deleted_user_with_pwv_rejected(client):
    tok = webapp.create_token(99999999, "hantu", pwv="abcd")
    r = _device().get("/api/auth/me", headers=_h(tok))
    assert r.status_code == 401


# ── Reset password lewat email ────────────────────────────────────────────────

def test_reset_password_revokes_tokens_and_ext(client, captured_emails):
    name, data = _new_user(client)
    tok_b = _login(name)
    ext = _ext_token(data["user_id"], name)
    r = _device().post("/api/auth/forgot", json={"email": f"{name}@test.id"})
    assert r.status_code == 200
    token = captured_emails[-1]["link"].split("reset_token=")[1]
    r = _device().post("/api/auth/reset", json={"token": token, "new_password": "reset1234"})
    assert r.status_code == 200
    assert _device().get("/api/auth/me", headers=_h(tok_b)).status_code == 401
    assert _device().get("/api/auth/me", headers=_h(ext)).status_code == 401


def test_reset_password_sets_password_set(client, captured_emails):
    uid, _, _ = _tg_user()
    email = f"{_uniq('tg')}@test.id"
    with db() as conn:
        conn.execute("UPDATE users SET email=? WHERE id=?", (email, uid))
    _device().post("/api/auth/forgot", json={"email": email})
    token = captured_emails[-1]["link"].split("reset_token=")[1]
    assert _device().post("/api/auth/reset", json={"token": token, "new_password": "reset1234"}).status_code == 200
    with db() as conn:
        assert conn.execute("SELECT password_set FROM users WHERE id=?", (uid,)).fetchone()[0] == 1


# ── Ganti username ────────────────────────────────────────────────────────────

def _patch_username(token, new_username, password="pass1234", c=None):
    return (c or _device()).patch("/api/auth/profile/username",
                                  json={"new_username": new_username, "current_password": password},
                                  headers=_h(token) if token else None)


def test_change_username_success(client):
    name, data = _new_user(client)
    with db() as conn:
        dn_before = conn.execute("SELECT display_name FROM users WHERE id=?", (data["user_id"],)).fetchone()[0]
    new = _uniq("ganti")
    r = _patch_username(data["token"], f"  {new}  ")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["ok"] is True and body["username"] == new
    assert webapp.decode_token(body["token"])["username"] == new
    me = _device().get("/api/auth/me", headers=_h(body["token"])).json()
    assert me["username"] == new
    assert me["display_name"] == dn_before  # display_name tidak berubah
    # token lama tetap sah (password tidak berubah)
    assert _device().get("/api/auth/me", headers=_h(data["token"])).status_code == 200
    assert _device().post("/api/auth/login", json={"username": new, "password": "pass1234"}).status_code == 200


@pytest.mark.parametrize("bad", ["ab", "ada spasi", "nama-strip", "x" * 51, "émoji"])
def test_change_username_invalid_format(client, bad):
    _, data = _new_user(client)
    r = _patch_username(data["token"], bad)
    assert r.status_code == 400
    assert r.json()["detail"] == "Username hanya boleh huruf, angka, dan _ (3–50 karakter)"


@pytest.mark.parametrize("bad", ["tg_123", "TG_abc", "Tg_xyz"])
def test_change_username_rejects_tg_prefix(client, bad):
    _, data = _new_user(client)
    r = _patch_username(data["token"], bad)
    assert r.status_code == 400


def test_change_username_wrong_password(client):
    _, data = _new_user(client)
    r = _patch_username(data["token"], _uniq("x"), password="SALAH")
    assert r.status_code == 400
    assert r.json()["detail"] == "Password salah"


def test_change_username_taken(client):
    other, _ = _new_user(client)
    _, data = _new_user(client)
    r = _patch_username(data["token"], other)
    assert r.status_code == 400
    assert r.json()["detail"] == "Username sudah digunakan"


def test_change_username_same_as_current(client):
    name, data = _new_user(client)
    r = _patch_username(data["token"], name)
    assert r.status_code == 200
    assert r.json()["username"] == name


def test_change_username_cookie_rule(client):
    name, _ = _new_user(client)
    c = _device()
    c.post("/api/auth/login", json={"username": name, "password": "pass1234"})
    new = _uniq("ck")
    r = _patch_username(None, new, c=c)
    assert r.status_code == 200
    assert c.cookies.get("token") == r.json()["token"]


# ── Lengkapi akun Telegram ────────────────────────────────────────────────────

def test_complete_account_success():
    uid, _, tok = _tg_user()
    new = _uniq("lengkap")
    email = f"{new}@Test.ID"
    r = _device().post("/api/auth/complete-account",
                       json={"new_username": new, "email": email, "new_password": "rahasia1"},
                       headers=_h(tok))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["ok"] is True and body["username"] == new and body["email"] == email.lower()
    me = _device().get("/api/auth/me", headers=_h(body["token"])).json()
    assert me["password_set"] is True and me["username"] == new
    # token lama (pwv lama) tidak berlaku lagi
    assert _device().get("/api/auth/me", headers=_h(tok)).status_code == 401
    assert _device().post("/api/auth/login", json={"username": new, "password": "rahasia1"}).status_code == 200
    # kedua kali → sudah lengkap
    r = _device().post("/api/auth/complete-account",
                       json={"email": f"{_uniq('z')}@test.id", "new_password": "rahasia2"},
                       headers=_h(body["token"]))
    assert r.status_code == 400
    assert r.json()["detail"] == "Akun sudah lengkap"


def test_complete_account_keeps_username_when_empty():
    uid, tg_name, tok = _tg_user()
    r = _device().post("/api/auth/complete-account",
                       json={"new_username": "  ", "email": f"{_uniq('e')}@test.id", "new_password": "rahasia1"},
                       headers=_h(tok))
    assert r.status_code == 200, r.text
    assert r.json()["username"] == tg_name
    r2 = _device().post("/api/auth/complete-account",
                        json={"email": f"{_uniq('e')}@test.id", "new_password": "rahasia1"},
                        headers=_h(r.json()["token"]))
    assert r2.status_code == 400


def test_complete_account_rejected_for_normal_account(client):
    _, data = _new_user(client)
    r = _device().post("/api/auth/complete-account",
                       json={"email": f"{_uniq('e')}@test.id", "new_password": "rahasia1"},
                       headers=_h(data["token"]))
    assert r.status_code == 400
    assert r.json()["detail"] == "Akun sudah lengkap"


def test_complete_account_validation_is_atomic(client):
    other, _ = _new_user(client)
    uid, tg_name, tok = _tg_user()
    with db() as conn:
        before = conn.execute("SELECT password_hash FROM users WHERE id=?", (uid,)).fetchone()[0]

    def post(body):
        return _device().post("/api/auth/complete-account", json=body, headers=_h(tok))

    r = post({"email": "bukan-email", "new_password": "rahasia1"})
    assert r.status_code == 400
    r = post({"email": f"{other}@TEST.id", "new_password": "rahasia1"})  # email dipakai user lain
    assert r.status_code == 400 and r.json()["detail"] == "Email sudah terdaftar"
    r = post({"new_username": other, "email": f"{_uniq('e')}@test.id", "new_password": "rahasia1"})
    assert r.status_code == 400 and r.json()["detail"] == "Username sudah digunakan"
    r = post({"new_username": "tg_baru", "email": f"{_uniq('e')}@test.id", "new_password": "rahasia1"})
    assert r.status_code == 400
    r = post({"new_username": "a b", "email": f"{_uniq('e')}@test.id", "new_password": "rahasia1"})
    assert r.status_code == 400
    r = post({"email": f"{_uniq('e')}@test.id", "new_password": "abc"})
    assert r.status_code == 422

    with db() as conn:
        row = conn.execute("SELECT username, email, password_hash, password_set FROM users WHERE id=?",
                           (uid,)).fetchone()
    assert row["username"] == tg_name and row["email"] is None
    assert row["password_hash"] == before and row["password_set"] == 0
    assert _device().get("/api/auth/me", headers=_h(tok)).status_code == 200


# ── Magic link Telegram → sesi SPA (cookie ditukar token lewat /api/auth/refresh) ──

def test_magic_link_redirects_with_flag_and_cookie_exchanges_for_token():
    uid, username, _ = _tg_user()
    magic = repository.TaskRepository(os.environ["DB_PATH"]).create_magic_token(uid)
    c = _device()
    r = c.get(f"/auth/magic?token={magic}", follow_redirects=False)
    assert r.status_code == 302
    assert r.headers["location"] == "/?magic=1"
    cookie_tok = c.cookies.get("token")
    assert cookie_tok, "cookie token harus diset"
    # SPA belum punya token di localStorage: tukar cookie (tanpa header Authorization) jadi token
    r2 = c.post("/api/auth/refresh")
    assert r2.status_code == 200, r2.text
    body = r2.json()
    assert body["renewed"] is True and body["token"]
    me = _device().get("/api/auth/me", headers=_h(body["token"]))
    assert me.status_code == 200
    assert me.json()["id"] == uid and me.json()["password_set"] is False
    # link sekali pakai
    r3 = _device().get(f"/auth/magic?token={magic}", follow_redirects=False)
    assert r3.status_code == 400


def test_refresh_without_cookie_or_header_is_401():
    assert _device().post("/api/auth/refresh").status_code == 401
