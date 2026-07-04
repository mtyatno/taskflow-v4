from conftest import register_user


def test_harness_register_login(client):
    data = register_user(client, "smokeuser", "smoke@test.id")
    assert data["username"] == "smokeuser"
    r = client.post("/api/auth/login", json={"username": "smokeuser", "password": "pass1234"})
    assert r.status_code == 200
    assert r.json()["user_id"] == data["user_id"]
