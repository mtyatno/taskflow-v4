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
