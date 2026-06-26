import sqlite3
import review_history as rh
from datetime import date


def test_current_and_prev_iso_week():
    assert rh.current_iso_week(date(2026, 6, 26)) == "2026-W26"
    assert rh.prev_iso_week("2026-W26") == "2026-W25"
    # year boundary: ISO week 1 of 2026 -> last ISO week of 2025
    assert rh.prev_iso_week("2026-W01") == "2025-W52"


def test_compute_streak():
    # current present, three consecutive
    assert rh.compute_streak({"2026-W26", "2026-W25", "2026-W24"}, "2026-W26") == 3
    # gap resets (W25 missing)
    assert rh.compute_streak({"2026-W26", "2026-W24"}, "2026-W26") == 1
    # current absent but previous present -> count from previous
    assert rh.compute_streak({"2026-W25", "2026-W24"}, "2026-W26") == 2
    # neither current nor previous present -> 0
    assert rh.compute_streak({"2026-W23"}, "2026-W26") == 0
    # empty
    assert rh.compute_streak(set(), "2026-W26") == 0


def _conn():
    c = sqlite3.connect(":memory:")
    c.row_factory = sqlite3.Row
    return c


AGG = {"score": 70, "overdue": 5, "p1_overdue": 2,
       "projects_without_next": 1, "done_this_week": 6, "active": 30}


def test_upsert_dedups_per_week():
    c = _conn()
    rh.upsert_snapshot(c, 1, "2026-W26", "t1", AGG)
    rh.upsert_snapshot(c, 1, "2026-W26", "t2", dict(AGG, score=80))
    rows = c.execute("SELECT score FROM review_snapshots WHERE user_id=1").fetchall()
    assert len(rows) == 1 and rows[0]["score"] == 80  # updated, not duplicated


def test_get_history_prev_and_streak():
    c = _conn()
    rh.upsert_snapshot(c, 1, "2026-W24", "t", dict(AGG, score=50, done_this_week=3))
    rh.upsert_snapshot(c, 1, "2026-W25", "t", dict(AGG, score=60, done_this_week=4))
    # other user must not leak in
    rh.upsert_snapshot(c, 2, "2026-W25", "t", dict(AGG, score=99))
    h = rh.get_history(c, 1, "2026-W26")
    assert h["prev"] == {"score": 60, "done_this_week": 4}  # most recent before W26
    assert h["streak"] == 2  # W25, W24 (current W26 absent, prev W25 present)


def test_get_history_empty():
    c = _conn()
    h = rh.get_history(c, 1, "2026-W26")
    assert h == {"prev": None, "streak": 0}
