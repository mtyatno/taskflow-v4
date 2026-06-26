# Weekly Review — Package B: History (Snapshots, Trend, Streak, Wins) — Design

**Date:** 2026-06-26
**Status:** Approved (design), pending implementation plan
**Builds on:** [[project-weekly-review-ai]] — Weekly Review v2 (LIVE 2026-06-26, SW v178). Package B adds the time dimension that v2 deliberately deferred.

## Goal

Record a weekly snapshot of the review's local condition each time the user finishes a review, then surface **trend** (Health Score Δ vs last week), **streak** (consecutive weeks reviewed), and **wins** (done-this-week vs last week) woven subtly into the v2 condition strip — no new cards, no dashboard clutter.

## Constraints & decisions (from brainstorming)

- **Snapshot trigger:** on "Selesai Review" only. Max one snapshot per ISO week per user (UPSERT) — finishing twice in a week updates the same row.
- **Streak meaning:** consecutive ISO weeks that have a snapshot (i.e. weeks the user actually completed a review), including the current week once captured.
- **Display:** woven into the existing condition strip — no new cards, keep it calm.
- **Tasks-only privacy:** snapshots store aggregate numbers only (no task titles/content).
- **Not AI-gated:** history is local/aggregate; the endpoints work regardless of `AI_FEATURES_ENABLED`. (The review overlay itself is still mounted behind `aiReviewOn()` as in v2 — unchanged.)
- **Graceful with no history:** first-ever week shows the score with no Δ, no streak badge, wins without a comparison.
- **No new dependencies.** Pure SVG/text only.

## A. Persistence (server)

New table in `repository.py._init_db` (same `CREATE TABLE IF NOT EXISTS` pattern as existing tables):

```sql
CREATE TABLE IF NOT EXISTS review_snapshots (
    id                     INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id                INTEGER NOT NULL,
    iso_week               TEXT NOT NULL,          -- e.g. "2026-W26"
    captured_at            TEXT NOT NULL,
    score                  INTEGER NOT NULL,
    overdue                INTEGER NOT NULL DEFAULT 0,
    p1_overdue             INTEGER NOT NULL DEFAULT 0,
    projects_without_next  INTEGER NOT NULL DEFAULT 0,
    done_this_week         INTEGER NOT NULL DEFAULT 0,
    active                 INTEGER NOT NULL DEFAULT 0,
    UNIQUE(user_id, iso_week)
);
CREATE INDEX IF NOT EXISTS idx_review_snapshots_user ON review_snapshots(user_id);
```

`UNIQUE(user_id, iso_week)` enables UPSERT (`INSERT ... ON CONFLICT(user_id, iso_week) DO UPDATE`). Only aggregate integers — no task content.

## B. Endpoints (server, authed, NOT AI-gated)

Snapshot read/write + the streak computation live in a small pure-plus-DB module `review_history.py` (keeps `webapp.py` route bodies thin and the streak logic unit-testable).

- `POST /api/review/snapshot` — body `{score, overdue, p1_overdue, projects_without_next, done_this_week, active}` (all ints). Server derives `iso_week` from the current date (`date.today().isocalendar()` → `"%04d-W%02d"`), `captured_at` = now ISO. UPSERTs the row for `(user_id, iso_week)`. Returns `{ok: true}`.
- `GET /api/review/history` — returns `{prev: {score, done_this_week} | null, streak: int}`.
  - `prev` = the most recent snapshot for an ISO week **strictly before** the current week (the comparison baseline). `null` if none.
  - `streak` = number of consecutive ISO weeks ending at the current week that have a snapshot. If the current week has no snapshot yet, the streak is counted ending at the most recent snapshot week only if that week is the current or immediately previous week; otherwise 0. (Precise rule in C/Testing below.)

### Pure streak function (unit-tested)

`compute_streak(weeks_present: set[str], today_week: str) -> int` in `review_history.py`:
- Walk back from `today_week`: count `today_week` if present, then the previous ISO week, etc., stopping at the first gap.
- If `today_week` is absent but the immediately previous week is present, start the count there (so a streak shown before finishing this week still reflects the unbroken run). If neither current nor previous week is present, streak = 0.
- ISO-week arithmetic uses real date math (a week = the Monday-based ISO week), not naive string decrement, so year boundaries (e.g. `2026-W01` ← `2025-W52`) are correct. Implement by converting an ISO week to its Monday `date`, subtracting 7 days, reformatting.

## C. UI (woven into the v2 condition strip)

`static/index.html` `WeeklyReview` component:

- **On open:** fetch `GET /api/review/history` (in the existing open effect or a small effect), store `{prev, streak}` in state. Failure → treat as no history (silent; the review still works).
- **Health Score Δ:** beside the score number, render a small delta vs `prev.score`: `▲+5` (green) if higher, `▼-3` (red) if lower, `±0` muted if equal, nothing if `prev` is null. Δ = current local `score` − `prev.score`.
- **Streak badge:** a small `🔥 N mgg` near the band label, shown only when `streak >= 2`.
- **Wins:** add to the existing counts row: `✓ {r.doneThisWeek.length} selesai` and, when `prev` is present, `(lalu {prev.done_this_week})`.
- **On "Selesai Review":** in `finish()`, after setting `tf_last_review`, fire `POST /api/review/snapshot` with the locally-computed `{score, overdue: r.overdue.length, p1_overdue, projects_without_next: r.projectsNoNext.length, done_this_week: r.doneThisWeek.length, active: activeCount}`. **Fire-and-forget**: a snapshot failure must NOT block closing the review (no await on the close path; `.catch` swallows). The existing "Review selesai ✅" toast stays.

The score and all aggregates are already computed locally in the v2 component (`score`, `r.overdue`, `p1Overdue`, `r.projectsNoNext`, `r.doneThisWeek`, `activeCount`) — Package B only reads them.

## D. Architecture / files

- `repository.py` — `review_snapshots` table + index in `_init_db`.
- `review_history.py` (new) — `compute_streak(weeks_present, today_week)` (pure), `current_iso_week()`, `prev_iso_week(week)`, plus DB helpers `upsert_snapshot(conn, user_id, week, captured_at, agg)` and `get_history(conn, user_id, today_week) -> {prev, streak}`. DB helpers take a connection so they reuse `webapp.get_db()`.
- `webapp.py` — two routes (`POST /api/review/snapshot`, `GET /api/review/history`) calling `review_history` with `get_db()`.
- `static/index.html` — condition-strip Δ/streak/wins rendering; history fetch on open; snapshot POST in `finish()`.
- `static/sw.js` — cache bump (current `taskflow-v178-dashboard-folder-icon` → `taskflow-v179-review-history`).

## Testing

- **Pytest (`tests/test_review_history.py`, new):**
  - `compute_streak`: current week present → counts; gap resets; year-boundary (`2026-W01` ← `2025-W52`) consecutive; current absent but previous present → counts from previous; neither present → 0.
  - `prev_iso_week` correctness across year boundary.
  - `upsert_snapshot` then `get_history`: second finish same week updates (no duplicate row); `prev` returns the prior week's snapshot, not the current week's; `streak` correct over a seeded multi-week set. (Use an in-memory/temp SQLite with the table created.)
- **Manual (desktop):** finish a review → reopen → score Δ shows `±0` (same week, prev = last week or none); seed/await a second week to see `▲/▼`, `🔥 N mgg`, and `✓ X selesai (lalu Y)`. Confirm first-ever week is graceful (no Δ, no badge).
- **Release:** SW bump; verify live SW version; **restart `taskflow-web`** after deploy (new routes + table — backend change; honors the v2 deploy lesson).

## Out of scope (YAGNI)

Score sparkline/line chart, "Recovery Week" detection, snapshot retention/pruning (rows are tiny — one per user per week).

## Reversibility

Additive: a new table (harmless if unused), two new endpoints, and additive strip rendering. Soft rollback: hide the Δ/streak/wins rendering. Hard: revert commits + drop the table (optional).
