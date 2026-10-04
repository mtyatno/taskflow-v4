# Habit Page Redesign (KPI, Heatmap, Inline Checkin) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign Alurik's Habits page with a 1-row hero layout combining 4 Dashboard-style KPI cards and a 5th Calendar Heatmap card, a 2-row mini heatmap with high-contrast cells, direct inline check-in with cyclic state rotation, and removal of the quote banner.

**Architecture:**
- Frontend: React components in `static/index.html` (`HabitPage`, `HabitCard`, `MiniHeatmap`, `CalendarHeatmap`, `DashKpiIcon`, `DashSparkline`, `DashMiniBars`, `DashMeter`).
- Styles: CSS in `static/app.css` using CSS grid, design tokens, responsive breakpoints, high-contrast states.
- Backend/Sync: `webapp.py` checkin endpoint supporting uncheck/delete log, `habitrepo.js` for offline IDB operations, SW cache bump in `static/sw.js`.

**Tech Stack:** React 18, CSS3 (CSS Variables & Flex/Grid), FastAPI / SQLite backend, Service Worker, IndexedDB offline sync.

## Global Constraints
- No cowboy coding: delegate implementation and review to subagents.
- Evidence before completion: verify with pytest, check_inline.js, node --check sw.js, and node --test.
- SW cache bump & offline test synchronization mandatory.

---

### Task 1: Backend & Local Offline Uncheck / Cancel Support

**Files:**
- Modify: `webapp.py:3289-3306`
- Modify: `static/offline/habitrepo.js:86-103`
- Modify: `static/offline/habitroutes.js:43-48`
- Create: `tests/offline/habit_uncheck.test.js`

**Interfaces:**
- Consumes: `POST /api/habits/{id}/checkin`
- Produces: Support for `status: "uncheck"` in `webapp.py`, `habitrepo.js`, and `habitroutes.js`, deleting `habit_logs` for `(habit_id, date)`.

- [ ] **Step 1: Write the failing test**

Create `tests/offline/habit_uncheck.test.js`:
```javascript
"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");

// Mock environment for habitrepo and habitroutes
test("checkin with uncheck removes log from habit_logs", async () => {
  const { TF } = require("../../static/offline/habitrepo.js");
  // Test that TF.habitrepo.checkin accepts status === "uncheck"
  assert.equal(typeof TF.habitrepo.checkin, "function");
});
```

- [ ] **Step 2: Run test to verify initial state**

Run: `node --test tests/offline/habit_uncheck.test.js`
Expected: PASS (scaffolding test) or initial failure if function rejects uncheck status.

- [ ] **Step 3: Implement backend and offline uncheck logic**

In `webapp.py`:
```python
@app.post("/api/habits/{habit_id}/checkin")
async def checkin_habit(habit_id: int, req: HabitCheckinReq, user=Depends(get_current_user)):
    uid = user["sub"]
    if req.status not in ("done", "skipped", "uncheck"):
        raise HTTPException(status_code=400, detail="status harus done, skipped, atau uncheck")
    log_date = req.date if req.date else _today_jkt().isoformat()
    with get_db() as conn:
        row = conn.execute("SELECT id FROM habits WHERE id = ? AND user_id = ?", (habit_id, uid)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Habit tidak ditemukan")
        if req.status == "uncheck":
            conn.execute("DELETE FROM habit_logs WHERE habit_id = ? AND date = ?", (habit_id, log_date))
        else:
            conn.execute(
                """INSERT INTO habit_logs (habit_id, date, status, skip_reason)
                   VALUES (?,?,?,?)
                   ON CONFLICT(habit_id, date) DO UPDATE SET status=excluded.status, skip_reason=excluded.skip_reason""",
                (habit_id, log_date, req.status, req.skip_reason)
            )
    return {"ok": True, "habit_id": habit_id, "date": log_date, "status": req.status}
```

In `static/offline/habitrepo.js`:
Update `checkin(habitCid, date, status, skipReason, opts)` to allow `status === "uncheck"`.
When `status === "uncheck"`, perform store delete by `[habitCid, date]` and enqueue sync op.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/offline/habit_uncheck.test.js`
Run: `python -m pytest tests/`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add webapp.py static/offline/habitrepo.js static/offline/habitroutes.js tests/offline/habit_uncheck.test.js
git commit -m "feat(api): support uncheck status in habit checkin endpoint and offline repo"
```

---

### Task 2: Hero Layout with 4 Dashboard-Style KPI Cards + 5th Calendar Heatmap Card & Quote Banner Removal

**Files:**
- Modify: `static/index.html` (lines ~25300-25800)
- Modify: `static/app.css` (lines ~2650-2760)
- Create: `tests/offline/habit_hero_redesign.test.js`

**Interfaces:**
- Consumes: `computeHabitSummaryStats(habits)`, `monthlyData`
- Produces: `.habit-kpi-row` grid containing 4 dashboard-style KPI cards (`.dash-kpi`) and 1 calendar heatmap card.

- [ ] **Step 1: Write the failing test**

Create `tests/offline/habit_hero_redesign.test.js`:
```javascript
"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("habit page has .habit-kpi-row and no identity quote banner", () => {
  const indexHtml = fs.readFileSync(path.join(__dirname, "../../static/index.html"), "utf8");
  assert.ok(indexHtml.includes("habit-kpi-row"), "Must contain habit-kpi-row class");
  assert.ok(!indexHtml.includes('"Saya adalah orang yang peduli dengan kesehatan"'), "Quote banner must be removed");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/offline/habit_hero_redesign.test.js`
Expected: FAIL (missing `habit-kpi-row`)

- [ ] **Step 3: Implement Dashboard-style KPI cards and 1-row hero layout**

1. In `static/index.html`:
   - Remove identity quote banner `💫 "Saya adalah orang yang peduli dengan kesehatan"` and its associated DOM nodes.
   - Update `HabitPage` hero section to render `.habit-kpi-row`:
     - 4 KPI cards with `.dash-kpi` structure (Tile Icon gradien 40px, 30px numbers, `DashDelta` subtext, and 32px mini charts: sparkline 14 hari untuk aktif, mini bars untuk penyelesaian minggu ini, meter untuk streak, meter untuk target checkin).
     - 5th card: `CalendarHeatmap` placed in the same row, styled as a card with header and 35-day grid.
2. In `static/app.css`:
   - Define `.habit-kpi-row`:
     ```css
     .habit-kpi-row {
       display: grid;
       grid-template-columns: repeat(4, minmax(0, 1fr)) minmax(220px, 1.25fr);
       gap: 12px;
       margin-bottom: 24px;
       align-items: stretch;
     }
     @media (max-width: 1024px) {
       .habit-kpi-row {
         grid-template-columns: repeat(2, minmax(0, 1fr));
       }
       .habit-kpi-row > :last-child {
         grid-column: 1 / -1;
       }
     }
     ```
   - Update `.habit-heatmap` to integrate seamlessly as a card within `.habit-kpi-row`.

- [ ] **Step 4: Run tests to verify**

Run: `node --test tests/offline/habit_hero_redesign.test.js`
Run: `node scratch/check_inline.js static/index.html`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add static/index.html static/app.css tests/offline/habit_hero_redesign.test.js
git commit -m "feat(habits): redesign hero section with 1-row layout and dashboard KPI cards"
```

---

### Task 3: 2-Row Mini Heatmap with High Contrast & Direct Inline Check-in

**Files:**
- Modify: `static/index.html` (lines ~24810-25250)
- Modify: `static/app.css` (lines ~2790-2870)
- Create: `tests/offline/habit_card_redesign.test.js`

**Interfaces:**
- Consumes: `h.month_log`, `h.today_status`
- Produces: 2-row mini heatmap (15×2=30 cells) with clear contrast; `.habit-check-btn` direct cyclic click handler (`null` ➔ `"done"` ➔ `"skipped"` ➔ `"uncheck"`).

- [ ] **Step 1: Write the failing test**

Create `tests/offline/habit_card_redesign.test.js`:
```javascript
"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("MiniHeatmap renders 2 rows of 15 cells and habit card uses direct inline checkin", () => {
  const indexHtml = fs.readFileSync(path.join(__dirname, "../../static/index.html"), "utf8");
  const appCss = fs.readFileSync(path.join(__dirname, "../../static/app.css"), "utf8");
  assert.ok(appCss.includes("repeat(2,"), "CSS must specify 2 rows for mini heatmap");
  assert.ok(appCss.includes("repeat(15,"), "CSS must specify 15 columns for mini heatmap");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/offline/habit_card_redesign.test.js`
Expected: FAIL

- [ ] **Step 3: Implement 2-row mini heatmap and direct inline checkin**

1. In `static/index.html`:
   - Update `MiniHeatmap`:
     - Renders 30 cells (2 rows × 15 columns).
     - Cell classes:
       - Done: `habit-mini-cell level-4`
       - Skipped: `habit-mini-cell is-skipped`
       - Unchecked/Empty: `habit-mini-cell is-empty`
       - Today cell: `is-today`
   - In `HabitCard`:
     - Update button onClick to cycle directly:
       ```javascript
       const handleButtonClick = (e) => {
         e.stopPropagation();
         if (!h.today_status) {
           onCheckin(h.id, "done");
         } else if (h.today_status === "done") {
           onCheckin(h.id, "skipped", "");
         } else {
           onCheckin(h.id, "uncheck", "");
         }
       };
       ```
     - Remove `setCheckinTarget` triggering `HabitCheckinModal`.
   - In `HabitPage`:
     - Handle `"uncheck"` status in `handleCheckin`:
       - If `status === "uncheck"`, optimistic update clears `today_status` to `null` and updates logs.
       - Dispatches toast `"↩️ Check-in dibatalkan"`.
2. In `static/app.css`:
   - Update `.habit-mini-heatmap`:
     ```css
     .habit-mini-heatmap {
       display: grid;
       grid-template-rows: repeat(2, 10px);
       grid-template-columns: repeat(15, 10px);
       gap: 3px;
       align-items: center;
     }
     ```
   - Add contrast styles:
     ```css
     .habit-mini-cell.is-empty {
       background: rgba(0, 0, 0, 0.04);
       border: 1px solid rgba(0, 0, 0, 0.14);
     }
     [data-theme="dark"] .habit-mini-cell.is-empty {
       background: rgba(255, 255, 255, 0.05);
       border: 1px solid rgba(255, 255, 255, 0.20);
     }
     .habit-mini-cell.is-skipped {
       background: #f59e0b;
       border: 1px solid #d97706;
     }
     .habit-mini-cell.level-4 {
       background: var(--accent);
       border: 1px solid var(--accent);
     }
     .habit-mini-cell.is-today {
       box-shadow: 0 0 0 1.5px #818cf8;
     }
     ```

- [ ] **Step 4: Run tests to verify**

Run: `node --test tests/offline/habit_card_redesign.test.js`
Run: `node scratch/check_inline.js static/index.html`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add static/index.html static/app.css tests/offline/habit_card_redesign.test.js
git commit -m "feat(habits): implement 2-row mini heatmap with high contrast and inline checkin rotation"
```

---

### Task 4: Service Worker Bump, Cache Assertion Sync & Full Verification

**Files:**
- Modify: `static/sw.js` (bump cache version to `taskflow-v367-habit-kpi-redesign`, `app.css?v=314`)
- Modify: `tests/offline/*.test.js` (sync cache version to `v367`)

**Interfaces:**
- Produces: Updated cache version across client and test assertions.

- [ ] **Step 1: Bump SW version and sync offline tests**

In `static/sw.js`:
Change `CACHE` to `"taskflow-v367-habit-kpi-redesign"`.
Update query param in precached CSS if needed (`app.css?v=314`).

In offline tests asserting the SW version:
- `tests/offline/direct_messages_ui.test.js`
- `tests/offline/drawing_sync_ui.test.js`
- `tests/offline/focus_workstation.test.js`
- `tests/offline/interactive_note_viewer.test.js`
- `tests/offline/note_saved_searches_view_mode.test.js`
- `tests/offline/note_search_filters.test.js`
Sync assertion to `"taskflow-v367-habit-kpi-redesign"`.

- [ ] **Step 2: Run full verification suite**

1. `node scratch/check_inline.js static/index.html` (5/5 scripts OK)
2. `node --check static/sw.js` (OK)
3. `node --test tests/offline/habit*.test.js`
4. `python -m pytest tests/`

- [ ] **Step 3: Commit**

```bash
git add static/sw.js tests/offline/
git commit -m "chore(sw): bump cache to v367 and sync offline test assertions"
```
