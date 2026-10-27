"""Streak di GET /api/habits/today: hari ini tanpa log tidak memutus streak (mulai dari kemarin).
Paritas dengan static/offline/habitlogic.js deriveToday. Spec 2026-10-27-hero-dashboard-design.md §2."""
from datetime import timedelta

import webapp
from conftest import register_user, db


def _setup(client, name):
    user = register_user(client, name, f"{name}@test.id")
    token = user.get("token") or user.get("access_token")
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    r = client.post("/api/habits", json={
        "title": "Jalan pagi", "phase": "pagi",
        "frequency": ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
    }, headers=headers)
    assert r.status_code == 200, r.text
    return headers, r.json()["id"]


def _log(habit_id, offset, status):
    d = (webapp._today_jkt() - timedelta(days=offset)).isoformat()
    with db() as conn:
        conn.execute(
            "INSERT INTO habit_logs (habit_id, date, status, skip_reason) VALUES (?, ?, ?, '')",
            (habit_id, d, status),
        )


def _streak(client, headers, habit_id):
    r = client.get("/api/habits/today", headers=headers)
    assert r.status_code == 200, r.text
    return next(h for h in r.json() if h["id"] == habit_id)["streak"]


def test_streak_today_no_log_counts_from_yesterday(client):
    headers, hid = _setup(client, "streak_nolog")
    _log(hid, 1, "done")
    _log(hid, 2, "done")
    assert _streak(client, headers, hid) == 2


def test_streak_today_done_counts(client):
    headers, hid = _setup(client, "streak_done")
    _log(hid, 0, "done")
    _log(hid, 1, "done")
    assert _streak(client, headers, hid) == 2


def test_streak_today_missed_breaks(client):
    headers, hid = _setup(client, "streak_missed")
    _log(hid, 0, "missed")
    _log(hid, 1, "done")
    assert _streak(client, headers, hid) == 0


def test_streak_skipped_in_middle_passed_over(client):
    headers, hid = _setup(client, "streak_skip")
    _log(hid, 1, "done")
    _log(hid, 2, "skipped")
    _log(hid, 3, "done")
    _log(hid, 5, "done")
    assert _streak(client, headers, hid) == 2


def test_streak_no_logs_zero(client):
    headers, hid = _setup(client, "streak_empty")
    assert _streak(client, headers, hid) == 0


def test_streak_today_skipped_counts_from_yesterday(client):
    headers, hid = _setup(client, "streak_skip_today")
    _log(hid, 0, "skipped")
    _log(hid, 1, "done")
    assert _streak(client, headers, hid) == 1
