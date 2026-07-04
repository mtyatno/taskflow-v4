from datetime import datetime, timedelta

from conftest import register_user, db


def test_harness_register_login(client):
    data = register_user(client, "smokeuser", "smoke@test.id")
    assert data["username"] == "smokeuser"
    r = client.post("/api/auth/login", json={"username": "smokeuser", "password": "pass1234"})
    assert r.status_code == 200
    assert r.json()["user_id"] == data["user_id"]


def test_register_requires_email(client):
    r = client.post("/api/auth/register", json={"username": "noemail", "password": "pass1234"})
    assert r.status_code == 422  # pydantic: field email wajib


def test_register_rejects_invalid_email(client):
    r = client.post("/api/auth/register", json={
        "username": "bademail", "password": "pass1234", "email": "bukan-email",
    })
    assert r.status_code == 400
    assert "email" in r.json()["detail"].lower()


def test_register_rejects_duplicate_email_case_insensitive(client):
    register_user(client, "dupemail1", "dup@test.id")
    r = client.post("/api/auth/register", json={
        "username": "dupemail2", "password": "pass1234", "email": "DUP@test.id",
    })
    assert r.status_code == 400
    assert "sudah terdaftar" in r.json()["detail"]


def test_me_and_login_include_email(client):
    data = register_user(client, "emailme", "me@test.id")
    assert data["email"] == "me@test.id"
    r = client.post("/api/auth/login", json={"username": "emailme", "password": "pass1234"})
    assert r.json()["email"] == "me@test.id"
    me = client.get("/api/auth/me", headers={"Authorization": f"Bearer {data['token']}"})
    assert me.status_code == 200
    assert me.json()["email"] == "me@test.id"


def test_change_email_requires_correct_password(client):
    data = register_user(client, "changer", "old@test.id")
    h = {"Authorization": f"Bearer {data['token']}"}
    r = client.patch("/api/auth/profile/email",
                     json={"email": "new@test.id", "current_password": "SALAH"}, headers=h)
    assert r.status_code == 400
    r = client.patch("/api/auth/profile/email",
                     json={"email": "new@test.id", "current_password": "pass1234"}, headers=h)
    assert r.status_code == 200
    assert r.json()["email"] == "new@test.id"
    me = client.get("/api/auth/me", headers=h)
    assert me.json()["email"] == "new@test.id"


def _token_from_link(link):
    return link.split("reset_token=")[1]


def test_forgot_reset_happy_path(client, captured_emails):
    register_user(client, "resetme", "resetme@test.id")
    r = client.post("/api/auth/forgot", json={"email": "resetme@test.id"})
    assert r.status_code == 200
    assert len(captured_emails) == 1
    token = _token_from_link(captured_emails[0]["link"])

    r = client.post("/api/auth/reset", json={"token": token, "new_password": "barubanget9"})
    assert r.status_code == 200

    assert client.post("/api/auth/login", json={
        "username": "resetme", "password": "barubanget9"}).status_code == 200
    assert client.post("/api/auth/login", json={
        "username": "resetme", "password": "pass1234"}).status_code == 401


def test_forgot_unknown_email_indistinguishable(client, captured_emails):
    register_user(client, "known1", "known1@test.id")
    r_known = client.post("/api/auth/forgot", json={"email": "known1@test.id"})
    r_unknown = client.post("/api/auth/forgot", json={"email": "ghost@test.id"})
    assert r_known.status_code == r_unknown.status_code == 200
    assert r_known.json() == r_unknown.json()
    # unknown email: tidak ada email terkirim untuknya, tidak ada token dibuat
    assert all(e["to"] != "ghost@test.id" for e in captured_emails)


def test_reset_rejects_bad_expired_and_reused_token(client, captured_emails):
    data = register_user(client, "tokuser", "tok@test.id")
    client.post("/api/auth/forgot", json={"email": "tok@test.id"})
    token = _token_from_link(captured_emails[0]["link"])

    # token acak
    assert client.post("/api/auth/reset", json={
        "token": "ngawur", "new_password": "apapun99"}).status_code == 400

    # token expired (mundurkan expires_at langsung di DB — scoped ke user ini
    # supaya tidak mengganggu token milik test lain; DB dipakai bersama semodule)
    conn = db()
    conn.execute("UPDATE password_reset_tokens SET expires_at = ? WHERE user_id = ?",
                 ((datetime.now() - timedelta(hours=2)).isoformat(), data["user_id"]))
    conn.commit(); conn.close()
    assert client.post("/api/auth/reset", json={
        "token": token, "new_password": "apapun99"}).status_code == 400

    # token valid → sukses → dipakai ulang → 400
    client.post("/api/auth/forgot", json={"email": "tok@test.id"})
    token2 = _token_from_link(captured_emails[-1]["link"])
    assert client.post("/api/auth/reset", json={
        "token": token2, "new_password": "apapun99"}).status_code == 200
    assert client.post("/api/auth/reset", json={
        "token": token2, "new_password": "lainlagi99"}).status_code == 400


def test_reset_invalidates_other_tokens(client, captured_emails):
    register_user(client, "multi", "multi@test.id")
    client.post("/api/auth/forgot", json={"email": "multi@test.id"})
    client.post("/api/auth/forgot", json={"email": "multi@test.id"})
    tok_a = _token_from_link(captured_emails[0]["link"])
    tok_b = _token_from_link(captured_emails[1]["link"])
    assert client.post("/api/auth/reset", json={
        "token": tok_b, "new_password": "pilihanB99"}).status_code == 200
    # token A ikut hangus
    assert client.post("/api/auth/reset", json={
        "token": tok_a, "new_password": "pilihanA99"}).status_code == 400


def test_forgot_rate_limit_3_per_hour(client, captured_emails):
    data = register_user(client, "spammer", "spam@test.id")
    for _ in range(4):
        r = client.post("/api/auth/forgot", json={"email": "spam@test.id"})
        assert r.status_code == 200  # respons tetap generik
    assert len(captured_emails) == 3  # permintaan ke-4 tidak membuat token/email
    conn = db()
    n = conn.execute(
        "SELECT COUNT(*) AS n FROM password_reset_tokens WHERE user_id = ?",
        (data["user_id"],)).fetchone()["n"]
    conn.close()
    assert n == 3
