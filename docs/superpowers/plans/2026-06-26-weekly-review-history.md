# Weekly Review Package B (History) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record an aggregate weekly snapshot each time the user finishes a review, and weave trend (Health Score Δ vs last week), streak (consecutive weeks reviewed), and wins (done-this-week vs last week) into the v2 condition strip.

**Architecture:** A self-contained `review_history.py` module owns its `review_snapshots` table (created lazily via `ensure_table`, so it does not depend on repository init order), the pure week/streak math, and the DB read/write helpers. Two thin authed routes in `webapp.py` (`POST /api/review/snapshot`, `GET /api/review/history`) call those helpers via `get_db()`. The v2 `WeeklyReview` component fetches history on open, posts a snapshot on finish (fire-and-forget), and renders Δ/streak/wins in the existing strip.

**Tech Stack:** Python 3.10 (pytest, sqlite3, FastAPI/pydantic), React via in-browser Babel (`React.createElement`, no JSX), service-worker cache versioning.

## Global Constraints

- Tasks-only privacy: snapshots store aggregate integers only (no task titles/content).
- Not AI-gated: the two endpoints are plain authed routes (work regardless of `AI_FEATURES_ENABLED`). The review overlay itself stays mounted behind `aiReviewOn()` (unchanged).
- Snapshot on "Selesai Review" only; max one per ISO week per user (UPSERT on `UNIQUE(user_id, iso_week)`).
- Streak = consecutive ISO weeks (Monday-based) with a snapshot, ending at the current week (or the immediately previous week if the current week has no snapshot yet); a gap resets it.
- ISO-week string format is `"%04d-W%02d"` (e.g. `"2026-W26"`); zero-padded so lexical compare matches chronological order. Week math uses real dates (`date.fromisocalendar`), correct across year boundaries.
- Snapshot POST must be fire-and-forget: a failure must never block closing the review.
- No new dependencies. React `React.createElement` (no JSX), matching surrounding code.
- Auth/uid pattern: routes use `user=Depends(get_current_user)` and `uid = user["sub"]` (same as `POST /api/ai/review`, `webapp.py`).
- `get_db()` yields a `sqlite3` connection with `row_factory = sqlite3.Row`.
- Current SW cache is `const CACHE = "taskflow-v179-dashboard-icons";` (`static/sw.js:1`) → bump to `taskflow-v180-review-history`.

---

### Task 1: `review_history.py` module (week math, streak, snapshot DB) + tests

**Files:**
- Create: `review_history.py`
- Test: `tests/test_review_history.py`

**Interfaces:**
- Produces:
  - `current_iso_week(today=None) -> str` — `"YYYY-Www"` for `today` (default `date.today()`).
  - `prev_iso_week(iso_week: str) -> str` — the ISO week before `iso_week`.
  - `compute_streak(weeks_present, today_week: str) -> int` — consecutive-weeks count per the streak rule.
  - `ensure_table(conn)` — idempotent `CREATE TABLE IF NOT EXISTS review_snapshots` + index.
  - `upsert_snapshot(conn, user_id, iso_week, captured_at, agg: dict)` — agg keys `score, overdue, p1_overdue, projects_without_next, done_this_week, active`.
  - `get_history(conn, user_id, today_week) -> {"prev": {"score","done_this_week"} | None, "streak": int}`.

- [ ] **Step 1: Write the failing tests**

Create `tests/test_review_history.py`:

```python
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/test_review_history.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'review_history'`.

- [ ] **Step 3: Implement `review_history.py`**

Create `review_history.py`:

```python
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/test_review_history.py -v`
Expected: PASS (all 6).

- [ ] **Step 5: Commit**

```bash
git add review_history.py tests/test_review_history.py
git commit -m "feat(review): history module — iso-week snapshots, streak, prev (tasks-only)"
```

---

### Task 2: Wire the two endpoints in `webapp.py`

**Files:**
- Modify: `webapp.py` (add `import review_history`, a `ReviewSnapshotIn` model, and two routes near the `POST /api/ai/review` route)

**Interfaces:**
- Consumes: `review_history.current_iso_week/upsert_snapshot/get_history` (Task 1); `get_db`, `get_current_user`, `BaseModel`, `datetime` (all already in `webapp.py`).
- Produces: `POST /api/review/snapshot` (body `ReviewSnapshotIn`) → `{"ok": True}`; `GET /api/review/history` → `{"prev": ... | null, "streak": int}`.

- [ ] **Step 1: Add the import**

Near the top of `webapp.py`, next to `from repository import TaskRepository` (line ~50), add:

```python
import review_history
```

- [ ] **Step 2: Add the request model**

Next to the other pydantic models (e.g. after `class TaskUpdate(BaseModel):` block, around `webapp.py:476`), add:

```python
class ReviewSnapshotIn(BaseModel):
    score: int
    overdue: int = 0
    p1_overdue: int = 0
    projects_without_next: int = 0
    done_this_week: int = 0
    active: int = 0
```

- [ ] **Step 3: Add the two routes**

Immediately after the `ai_weekly_review` route (it ends with `raise HTTPException(status_code=503, detail=str(e))`, around `webapp.py:3117`), add:

```python
@app.post("/api/review/snapshot")
async def review_snapshot(req: ReviewSnapshotIn, user=Depends(get_current_user)):
    uid = user["sub"]
    week = review_history.current_iso_week()
    now = datetime.utcnow().isoformat()
    with get_db() as conn:
        review_history.upsert_snapshot(conn, uid, week, now, {
            "score": req.score, "overdue": req.overdue,
            "p1_overdue": req.p1_overdue,
            "projects_without_next": req.projects_without_next,
            "done_this_week": req.done_this_week, "active": req.active})
    return {"ok": True}


@app.get("/api/review/history")
async def review_history_route(user=Depends(get_current_user)):
    uid = user["sub"]
    week = review_history.current_iso_week()
    with get_db() as conn:
        return review_history.get_history(conn, uid, week)
```

- [ ] **Step 4: Verify the module imports cleanly**

Run: `python -c "import webapp; print('webapp OK')"`
Expected: prints `webapp OK` (no ImportError / syntax error). (This also confirms the routes register without error.)

- [ ] **Step 5: Commit**

```bash
git add webapp.py
git commit -m "feat(review): POST /api/review/snapshot + GET /api/review/history routes"
```

---

### Task 3: Weave trend/streak/wins into the v2 condition strip

**Files:**
- Modify: `static/index.html` — `WeeklyReview` component (state, an open effect, `finish()`, the band-label render, the counts row)

**Interfaces:**
- Consumes: `GET /api/review/history` → `{prev, streak}` (Task 2); `POST /api/review/snapshot` (Task 2); existing locals `score`, `r`, `p1Overdue`, `activeCount`; `api.get/api.post`.
- Produces: history-aware condition strip; snapshot write on finish.

CRITICAL: line numbers are approximate. Locate by searching anchors and match current code.

- [ ] **Step 1: Add history state + fetch-on-open effect**

In `WeeklyReview`, after `const [showAll, setShowAll] = React.useState(false);` (around line 20958), add:

```javascript
  const [hist, setHist] = React.useState(null);
  React.useEffect(() => {
    if (!open) return;
    api.get("/api/review/history").then(setHist).catch(() => setHist(null));
  }, [open]);
```

- [ ] **Step 2: Post a snapshot on finish (fire-and-forget)**

Replace the `finish` definition (around line 20973):

```javascript
  const finish = () => { try { localStorage.setItem("tf_last_review", new Date().toISOString()); } catch (e) {} setOpen(false); showToast && showToast("Review selesai ✅"); };
```

with:

```javascript
  const finish = () => {
    try { localStorage.setItem("tf_last_review", new Date().toISOString()); } catch (e) {}
    try {
      api.post("/api/review/snapshot", { score: score, overdue: r.overdue.length, p1_overdue: p1Overdue, projects_without_next: r.projectsNoNext.length, done_this_week: r.doneThisWeek.length, active: activeCount }).catch(() => {});
    } catch (e) {}
    setOpen(false); showToast && showToast("Review selesai ✅");
  };
```

- [ ] **Step 3: Compute trend locals**

Immediately after `const band = healthBand(score);` (around line 20970), add:

```javascript
  const prevScore = hist && hist.prev ? hist.prev.score : null;
  const delta = prevScore == null ? null : score - prevScore;
  const streak = hist ? hist.streak : 0;
  const prevDone = hist && hist.prev ? hist.prev.done_this_week : null;
```

- [ ] **Step 4: Render Δ + streak in the band-label row**

Replace the band-label div (around line 21021):

```javascript
          /*#__PURE__*/React.createElement("div", { style: { fontSize: 13, fontWeight: 700, color: band.color, marginBottom: 2 } }, band.label),
```

with:

```javascript
          /*#__PURE__*/React.createElement("div", { style: { fontSize: 13, fontWeight: 700, color: band.color, marginBottom: 2, display: "flex", alignItems: "center", gap: 8 } },
            band.label,
            delta != null && /*#__PURE__*/React.createElement("span", { style: { fontSize: 12, fontWeight: 700, color: delta > 0 ? "#16a34a" : (delta < 0 ? "#dc2626" : "var(--text-light)") } }, delta > 0 ? `▲+${delta}` : (delta < 0 ? `▼${delta}` : "±0")),
            streak >= 2 && /*#__PURE__*/React.createElement("span", { style: { fontSize: 11, fontWeight: 700, color: "#f59e0b" } }, `🔥 ${streak} mgg`)),
```

- [ ] **Step 5: Add the wins span to the counts row**

In the counts row, after the "mandek" span (around line 21028, the line ending `...r.projectsNoNext.length), " mandek")))),`), add a fourth span. Replace:

```javascript
            /*#__PURE__*/React.createElement("span", null, /*#__PURE__*/React.createElement("b", { style: { color: "#0891b2" } }, r.projectsNoNext.length), " mandek")))),
```

with:

```javascript
            /*#__PURE__*/React.createElement("span", null, /*#__PURE__*/React.createElement("b", { style: { color: "#0891b2" } }, r.projectsNoNext.length), " mandek"),
            /*#__PURE__*/React.createElement("span", null, /*#__PURE__*/React.createElement("b", { style: { color: "#16a34a" } }, r.doneThisWeek.length), prevDone != null ? ` selesai (lalu ${prevDone})` : " selesai")))),
```

- [ ] **Step 6: Syntax sanity check**

Run from `Z:/Todolist Manager V5.0`:
`node -e 'const fs=require("fs");const L=fs.readFileSync("static/index.html","utf8").split("\n");const end=L.findIndex((x,i)=>i>1362&&x.trim()==="</script>");const b=L.slice(1362,end).join("\n");try{new Function(b);console.log("PARSE OK")}catch(e){console.log("SYNTAX ERROR:",e.message.split("\n")[0])}'`
Expected: prints `PARSE OK`.

- [ ] **Step 7: Manual verification (desktop)**

Open review → strip shows score with no Δ and no streak badge on first ever use (graceful). Finish a review; re-open → if a prior-week snapshot exists, Δ (`▲/▼/±0`) and `✓ X selesai (lalu Y)` appear; `🔥 N mgg` appears when streak ≥ 2. With AI off the strip still renders (history is independent of AI).

- [ ] **Step 8: Commit**

```bash
git add static/index.html
git commit -m "feat(review): condition-strip trend (score delta), streak badge, wins vs last week"
```

---

### Task 4: SW cache bump + full sweep

**Files:**
- Modify: `static/sw.js:1`
- Verify: suites

- [ ] **Step 1: Bump the SW cache version**

In `static/sw.js:1`, change `const CACHE = "taskflow-v179-dashboard-icons";` to:

```javascript
const CACHE = "taskflow-v180-review-history";
```

- [ ] **Step 2: Run the suites**

Run: `python -m pytest tests/test_review_history.py tests/test_ai_review.py tests/test_bookmark.py -q`
Expected: PASS.

Run: `node --test tests/buildReview.test.js`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add static/sw.js
git commit -m "chore(sw): bump cache v179 -> v180 for review history"
```

---

## Self-Review Notes

- **Spec coverage:** Table → Task 1 (`ensure_table`, self-contained per plan refinement vs spec's repository.py — noted); week math + streak → Task 1; endpoints → Task 2; condition-strip Δ/streak/wins + snapshot-on-finish → Task 3; SW bump/testing → Task 4. Fire-and-forget snapshot → Task 3 Step 2 (wrapped, `.catch`). Not-AI-gated → Task 2 (plain authed routes). Graceful no-history → Task 3 (delta null / streak<2 hidden / wins without comparison).
- **Type consistency:** `current_iso_week/upsert_snapshot/get_history` (Task 1) used verbatim in Task 2; `{prev:{score,done_this_week}, streak}` shape (Task 1) consumed in Task 3 (`hist.prev.score`, `hist.prev.done_this_week`, `hist.streak`). `ReviewSnapshotIn` fields match the POST body sent in Task 3 Step 2 and the `agg` dict keys in Task 1.
- **Plan refinement vs spec:** the spec put the table in `repository.py._init_db`; this plan instead has `review_history.ensure_table()` (called by the DB helpers) so the feature is self-contained and unit-testable without repository init. Functionally equivalent; documented here.
- **Deploy note:** new routes + table → backend change → **restart `taskflow-web`** after deploy (honors the v2 lesson).
