# Offline Task Domain — Pure Logic (Quadrant + Derived Fields) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the server's Eisenhower quadrant calculation and task display-field derivation into a Node-tested pure-JS module `static/offline/tasklogic.js`, with strict parity to the FastAPI/`eisenhower.py` behavior.

**Architecture:** A dependency-free `static/offline/` module (same dual-export wrapper as the scaffold modules) containing pure functions only — no IndexedDB, no DOM. All functions accept an injectable "today" so tests are deterministic. This is the riskiest business-logic port in sub-project #1 (the existing in-page `computeOfflineQuadrant` is NOT faithful — it treats "urgent" as deadline ≤3 days, but the server treats urgent as deadline ≤7 days / overdue), so it is locked down first with parity tests before any repo or UI wiring.

**Tech Stack:** Vanilla ES2017 JS, `node:test`, `node:assert/strict`. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-06-03-offline-first-local-data-layer-design.md` (Section 5 — "porting server business logic to JS", quadrant row).

---

## Source-of-truth behavior (from `eisenhower.py` and `webapp.py:task_row_to_dict`)

**Quadrant** (`eisenhower.py:calculate_quadrant`):
- `IMPORTANCE_MAP = { P1: 10, P2: 7, P3: 4, P4: 1 }`; unknown priority → 4. `important = importance >= 5` (so P1/P2 important; P3/P4 not).
- Urgency from deadline:
  - no deadline → 2
  - overdue (days_left < 0) → 10
  - else first matching bracket by `days_left` (whole calendar days, `deadline - today`): `<=0 → 10`, `<=1 → 9`, `<=3 → 7`, `<=7 → 5`, `<=14 → 3`, `<=30 → 2`, else → 1
  - `urgent = urgency >= 5` (i.e. overdue, or days_left <= 7)
- Result: `urgent && important → Q1`; `important && !urgent → Q2`; `urgent && !important → Q3`; else `Q4`.

**Derived display fields** (`webapp.py:task_row_to_dict`):
- `days_until_deadline = (date.fromisoformat(deadline) - date.today()).days` when a deadline exists, else `null`.
- `is_overdue = (days_until_deadline < 0) and gtd_status not in ("done","archived")`; `false` when no deadline.

**"today" semantics:** server uses local `date.today()`. For an offline device, "today" is the device's local calendar date. All functions default to local today but accept an explicit `todayISO` (a `"YYYY-MM-DD"` string) for deterministic tests. Day math is calendar-date based (no time-of-day), matching Python `date` subtraction.

---

## File structure

```
static/offline/tasklogic.js          # NEW — pure functions: calculateQuadrant, deriveTaskFields (+ internal helpers)
tests/offline/tasklogic.test.js       # NEW — parity tests
```

No other files change. No IndexedDB. No index.html. (Repo CRUD and UI wiring are separate later plans.)

---

## Task 1: `tasklogic.js` + `calculateQuadrant` core

**Files:**
- Create: `static/offline/tasklogic.js`
- Test: `tests/offline/tasklogic.test.js`

- [ ] **Step 1: Write the failing test `tests/offline/tasklogic.test.js`**

```js
"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { calculateQuadrant } = require("../../static/offline/tasklogic.js");

const TODAY = "2026-06-03";

test("P1 with no deadline is important but not urgent -> Q2", () => {
  assert.equal(calculateQuadrant({ priority: "P1", deadline: null }, TODAY), "Q2");
});

test("P4 with no deadline is neither -> Q4", () => {
  assert.equal(calculateQuadrant({ priority: "P4", deadline: null }, TODAY), "Q4");
});

test("P1 due today is urgent + important -> Q1", () => {
  assert.equal(calculateQuadrant({ priority: "P1", deadline: "2026-06-03" }, TODAY), "Q1");
});

test("P3 due today is urgent but not important -> Q3", () => {
  assert.equal(calculateQuadrant({ priority: "P3", deadline: "2026-06-03" }, TODAY), "Q3");
});

test("unknown priority defaults to importance 4 (not important)", () => {
  // no deadline -> not urgent, importance 4 < 5 -> Q4
  assert.equal(calculateQuadrant({ priority: "PX", deadline: null }, TODAY), "Q4");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/offline/tasklogic.test.js`
Expected: FAIL — cannot find module `tasklogic.js`.

- [ ] **Step 3: Write `static/offline/tasklogic.js`**

```js
;(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory(root);
  } else {
    root.TF = root.TF || {};
    factory(root);
  }
})(typeof self !== "undefined" ? self : globalThis, function (root) {
  "use strict";

  const IMPORTANCE_MAP = { P1: 10, P2: 7, P3: 4, P4: 1 };
  const IMPORTANCE_DEFAULT = 4;
  const IMPORTANCE_THRESHOLD = 5;
  const URGENCY_THRESHOLD = 5;
  const URGENCY_NO_DEADLINE = 2;
  const URGENCY_OVERDUE = 10;
  // [maxDays, score] — first bracket whose maxDays >= days_left wins.
  const URGENCY_BRACKETS = [[0, 10], [1, 9], [3, 7], [7, 5], [14, 3], [30, 2]];

  // Whole calendar days between two YYYY-MM-DD dates: (deadline - today).
  function daysUntil(deadlineISO, todayISO) {
    const d = parseDateUTC(deadlineISO);
    const t = parseDateUTC(todayISO);
    return Math.round((d - t) / 86400000);
  }

  function parseDateUTC(iso) {
    // iso is "YYYY-MM-DD" (date-only). Build a UTC midnight timestamp to avoid TZ/DST drift.
    const [y, m, day] = String(iso).slice(0, 10).split("-").map(Number);
    return Date.UTC(y, m - 1, day);
  }

  function todayLocalISO() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    const d = String(now.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  function urgencyScore(deadlineISO, todayISO) {
    if (!deadlineISO) return URGENCY_NO_DEADLINE;
    const daysLeft = daysUntil(deadlineISO, todayISO);
    if (daysLeft < 0) return URGENCY_OVERDUE;
    for (const [maxDays, score] of URGENCY_BRACKETS) {
      if (daysLeft <= maxDays) return score;
    }
    return 1;
  }

  function calculateQuadrant(task, todayISO) {
    const today = todayISO || todayLocalISO();
    const importance = IMPORTANCE_MAP[task.priority] != null
      ? IMPORTANCE_MAP[task.priority]
      : IMPORTANCE_DEFAULT;
    const important = importance >= IMPORTANCE_THRESHOLD;
    const urgent = urgencyScore(task.deadline, today) >= URGENCY_THRESHOLD;
    if (urgent && important) return "Q1";
    if (important && !urgent) return "Q2";
    if (urgent && !important) return "Q3";
    return "Q4";
  }

  const exported = { calculateQuadrant };
  if (root && typeof root === "object") { root.TF = root.TF || {}; root.TF.tasklogic = exported; }
  return exported;
});
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/offline/tasklogic.test.js`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add static/offline/tasklogic.js tests/offline/tasklogic.test.js
git commit -m "feat(offline): calculateQuadrant faithful port of eisenhower.py"
```

---

## Task 2: Urgency-bracket boundary parity tests

**Files:**
- Modify: `tests/offline/tasklogic.test.js` (append tests)

These tests pin the exact boundaries where the existing in-page `computeOfflineQuadrant` diverged from the server (it used ≤3 days; the server uses ≤7 days). No implementation change is expected — Task 1 already implements the brackets; this task proves the boundaries.

- [ ] **Step 1: Append boundary tests to `tests/offline/tasklogic.test.js`**

```js
test("P2 due in exactly 7 days is still urgent -> Q1 (server boundary, NOT 3 days)", () => {
  assert.equal(calculateQuadrant({ priority: "P2", deadline: "2026-06-10" }, TODAY), "Q1");
});

test("P2 due in 8 days is no longer urgent -> Q2", () => {
  assert.equal(calculateQuadrant({ priority: "P2", deadline: "2026-06-11" }, TODAY), "Q2");
});

test("P1 overdue (yesterday) is urgent -> Q1", () => {
  assert.equal(calculateQuadrant({ priority: "P1", deadline: "2026-06-02" }, TODAY), "Q1");
});

test("P3 due in 8 days is neither -> Q4", () => {
  assert.equal(calculateQuadrant({ priority: "P3", deadline: "2026-06-11" }, TODAY), "Q4");
});

test("P3 overdue is urgent but not important -> Q3", () => {
  assert.equal(calculateQuadrant({ priority: "P3", deadline: "2026-05-01" }, TODAY), "Q3");
});

test("calculateQuadrant defaults today to local date when omitted (smoke, no throw)", () => {
  const q = calculateQuadrant({ priority: "P1", deadline: null });
  assert.ok(["Q1", "Q2", "Q3", "Q4"].includes(q));
});
```

- [ ] **Step 2: Run to verify they pass**

Run: `node --test tests/offline/tasklogic.test.js`
Expected: PASS, 11 tests total.

- [ ] **Step 3: Commit**

```bash
git add tests/offline/tasklogic.test.js
git commit -m "test(offline): pin urgency-bracket boundaries (7-day server parity)"
```

---

## Task 3: `deriveTaskFields` (is_overdue + days_until_deadline)

**Files:**
- Modify: `static/offline/tasklogic.js` (add `deriveTaskFields`, export it)
- Modify: `tests/offline/tasklogic.test.js` (append tests)

- [ ] **Step 1: Write failing tests — append to `tests/offline/tasklogic.test.js`**

```js
const { deriveTaskFields } = require("../../static/offline/tasklogic.js");

test("deriveTaskFields: no deadline -> null days, not overdue", () => {
  const r = deriveTaskFields({ deadline: null, gtd_status: "inbox" }, TODAY);
  assert.equal(r.days_until_deadline, null);
  assert.equal(r.is_overdue, false);
});

test("deriveTaskFields: deadline tomorrow -> 1 day, not overdue", () => {
  const r = deriveTaskFields({ deadline: "2026-06-04", gtd_status: "inbox" }, TODAY);
  assert.equal(r.days_until_deadline, 1);
  assert.equal(r.is_overdue, false);
});

test("deriveTaskFields: deadline yesterday + active -> -1 day, overdue", () => {
  const r = deriveTaskFields({ deadline: "2026-06-02", gtd_status: "next" }, TODAY);
  assert.equal(r.days_until_deadline, -1);
  assert.equal(r.is_overdue, true);
});

test("deriveTaskFields: overdue but done -> not overdue", () => {
  const r = deriveTaskFields({ deadline: "2026-06-02", gtd_status: "done" }, TODAY);
  assert.equal(r.is_overdue, false);
});

test("deriveTaskFields: overdue but archived -> not overdue", () => {
  const r = deriveTaskFields({ deadline: "2026-06-02", gtd_status: "archived" }, TODAY);
  assert.equal(r.is_overdue, false);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/offline/tasklogic.test.js`
Expected: FAIL — `deriveTaskFields` is not a function / undefined.

- [ ] **Step 3: Add `deriveTaskFields` to `static/offline/tasklogic.js`**

Insert this function just before the `const exported = ...` line:

```js
  function deriveTaskFields(task, todayISO) {
    const today = todayISO || todayLocalISO();
    let daysLeft = null;
    let isOverdue = false;
    if (task.deadline) {
      daysLeft = daysUntil(task.deadline, today);
      isOverdue = daysLeft < 0 && task.gtd_status !== "done" && task.gtd_status !== "archived";
    }
    return { days_until_deadline: daysLeft, is_overdue: isOverdue };
  }
```

And update the export line to include it:

```js
  const exported = { calculateQuadrant, deriveTaskFields };
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/offline/tasklogic.test.js`
Expected: PASS, 16 tests total.

- [ ] **Step 5: Run the whole offline suite to confirm no regression**

Run: `node --test tests/offline/smoke.test.js tests/offline/ids.test.js tests/offline/db.test.js tests/offline/meta.test.js tests/offline/idmap.test.js tests/offline/outbox.test.js tests/offline/blobstore.test.js tests/offline/router.test.js tests/offline/tasklogic.test.js`
Expected: `ℹ tests 47 / ℹ pass 47 / ℹ fail 0` (31 prior + 16 new), terminating promptly.

- [ ] **Step 6: Commit**

```bash
git add static/offline/tasklogic.js tests/offline/tasklogic.test.js
git commit -m "feat(offline): deriveTaskFields (is_overdue, days_until_deadline) parity"
```

---

## Done criteria

- `static/offline/tasklogic.js` exports `calculateQuadrant(task, todayISO?)` and `deriveTaskFields(task, todayISO?)`, both pure and dependency-free.
- Quadrant logic is a faithful port of `eisenhower.py` (importance map, urgency brackets, thresholds) — verified at the 7-day boundary the old in-page helper got wrong.
- `deriveTaskFields` matches `task_row_to_dict` for `is_overdue`/`days_until_deadline`, including the done/archived exclusion.
- Full offline suite green (47 tests), no hang.

## Next plans (not in scope here)

1. **`taskRepo.js`** — CRUD over IndexedDB returning the full server-parity task shape (uses `tasklogic` for quadrant + derived fields; assembles `assigned_to_name`/`parent_title`/tags from local stores), records to `_outbox`. Node-tested.
2. **Tasks list/query parity** — port `GET /api/tasks` filtering + ordering (status/priority/quadrant/project/context/include_done/tag, `ORDER BY priority, deadline`) and `projects`/`contexts`/`summary` derivation.
3. **index.html integration** — script-tag wiring + load order, retire in-page `OfflineDB` and the inaccurate `computeOfflineQuadrant`, intercept the `api` object for task routes, hydrate the tasks domain, adjust the Service Worker + cache bump. (Browser-verified.)
```
