import pytest
from conftest import register_user, db


def test_habit_uncheck_deletes_log_from_database(client):
    user = register_user(client, "habituser_uncheck", "uncheck@test.id")
    token = user.get("token") or user.get("access_token")
    headers = {"Authorization": f"Bearer {token}"} if token else {}

    # 1. Create a habit
    create_res = client.post("/api/habits", json={
        "title": "Membaca Buku",
        "phase": "pagi",
        "frequency": ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
        "micro_target": "5 halaman",
        "identity_pillar": "Intelektual"
    }, headers=headers)
    assert create_res.status_code == 200, create_res.text
    habit_id = create_res.json()["id"]

    # 2. Check in as "done"
    checkin_date = "2026-06-04"
    done_res = client.post(f"/api/habits/{habit_id}/checkin", json={
        "status": "done",
        "date": checkin_date,
        "skip_reason": ""
    }, headers=headers)
    assert done_res.status_code == 200, done_res.text
    assert done_res.json() == {"ok": True, "habit_id": habit_id, "date": checkin_date, "status": "done"}

    # Verify log exists in SQLite
    with db() as conn:
        row = conn.execute(
            "SELECT * FROM habit_logs WHERE habit_id = ? AND date = ?",
            (habit_id, checkin_date)
        ).fetchone()
        assert row is not None
        assert row["status"] == "done"

    # 3. Check in as "uncheck"
    uncheck_res = client.post(f"/api/habits/{habit_id}/checkin", json={
        "status": "uncheck",
        "date": checkin_date
    }, headers=headers)
    assert uncheck_res.status_code == 200, uncheck_res.text
    assert uncheck_res.json() == {"ok": True, "habit_id": habit_id, "date": checkin_date, "status": "uncheck"}

    # Verify log is DELETED from SQLite
    with db() as conn:
        row = conn.execute(
            "SELECT * FROM habit_logs WHERE habit_id = ? AND date = ?",
            (habit_id, checkin_date)
        ).fetchone()
        assert row is None

    # 4. Check in as "uncheck" when no log exists returns 200 OK
    uncheck_again = client.post(f"/api/habits/{habit_id}/checkin", json={
        "status": "uncheck",
        "date": checkin_date
    }, headers=headers)
    assert uncheck_again.status_code == 200, uncheck_again.text
    assert uncheck_again.json()["ok"] is True

    # 5. Invalid status returns 400
    invalid_res = client.post(f"/api/habits/{habit_id}/checkin", json={
        "status": "invalid_status",
        "date": checkin_date
    }, headers=headers)
    assert invalid_res.status_code == 400
    assert "status harus done, skipped, atau uncheck" in invalid_res.json()["detail"]
