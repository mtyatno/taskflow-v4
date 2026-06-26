"""Weekly Review history — ISO-week snapshots for trend/streak/wins.

Pure helpers (week math + streak) import with no DB. DB helpers take an open
sqlite3 connection and store aggregate numbers only (tasks-only privacy). The
module owns its table via ensure_table(), so it does not depend on repository
init order."""
from datetime import date, timedelta

SNAPSHOT_DDL = """
CREATE TABLE IF NOT EXISTS review_snapshots (
    id                     INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id                INTEGER NOT NULL,
    iso_week               TEXT NOT NULL,
    captured_at            TEXT NOT NULL,
    score                  INTEGER NOT NULL,
    overdue                INTEGER NOT NULL DEFAULT 0,
    p1_overdue             INTEGER NOT NULL DEFAULT 0,
    projects_without_next  INTEGER NOT NULL DEFAULT 0,
    done_this_week         INTEGER NOT NULL DEFAULT 0,
    active                 INTEGER NOT NULL DEFAULT 0,
    UNIQUE(user_id, iso_week)
)
"""


def ensure_table(conn):
    conn.execute(SNAPSHOT_DDL)
    conn.execute("CREATE INDEX IF NOT EXISTS idx_review_snapshots_user "
                 "ON review_snapshots(user_id)")


def current_iso_week(today=None):
    d = today or date.today()
    y, w, _ = d.isocalendar()
    return f"{y:04d}-W{w:02d}"


def _week_monday(iso_week):
    return date.fromisocalendar(int(iso_week[:4]), int(iso_week[6:]), 1)


def prev_iso_week(iso_week):
    p = _week_monday(iso_week) - timedelta(days=7)
    y, w, _ = p.isocalendar()
    return f"{y:04d}-W{w:02d}"


def compute_streak(weeks_present, today_week):
    weeks = set(weeks_present)
    if today_week in weeks:
        cur = today_week
    elif prev_iso_week(today_week) in weeks:
        cur = prev_iso_week(today_week)
    else:
        return 0
    n = 0
    while cur in weeks:
        n += 1
        cur = prev_iso_week(cur)
    return n


def upsert_snapshot(conn, user_id, iso_week, captured_at, agg):
    ensure_table(conn)
    conn.execute(
        "INSERT INTO review_snapshots "
        "(user_id, iso_week, captured_at, score, overdue, p1_overdue, "
        "projects_without_next, done_this_week, active) "
        "VALUES (?,?,?,?,?,?,?,?,?) "
        "ON CONFLICT(user_id, iso_week) DO UPDATE SET "
        "captured_at=excluded.captured_at, score=excluded.score, "
        "overdue=excluded.overdue, p1_overdue=excluded.p1_overdue, "
        "projects_without_next=excluded.projects_without_next, "
        "done_this_week=excluded.done_this_week, active=excluded.active",
        (user_id, iso_week, captured_at, agg["score"], agg["overdue"],
         agg["p1_overdue"], agg["projects_without_next"],
         agg["done_this_week"], agg["active"]))
    conn.commit()


def get_history(conn, user_id, today_week):
    ensure_table(conn)
    rows = conn.execute(
        "SELECT iso_week, score, done_this_week "
        "FROM review_snapshots WHERE user_id=?", (user_id,)).fetchall()
    weeks = {r["iso_week"] for r in rows}
    streak = compute_streak(weeks, today_week)
    earlier = [r for r in rows if r["iso_week"] < today_week]
    prev = None
    if earlier:
        best = max(earlier, key=lambda r: r["iso_week"])
        prev = {"score": best["score"], "done_this_week": best["done_this_week"]}
    return {"prev": prev, "streak": streak}
