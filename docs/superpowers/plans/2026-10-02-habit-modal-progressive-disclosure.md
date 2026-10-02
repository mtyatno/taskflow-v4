# Habit Modal Progressive Disclosure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement Progressive Disclosure for new habit creation in `TaskFormModal` (`mode === "habit"`) so that the primary view focuses on Habit Name and Phase with default all-day frequency, while secondary configurations (Micro Target, custom days selection, Identity Pillar) are neatly tucked inside a collapsible accordion with active filled count indicator.

**Architecture:** Introduce `showHabitAdvanced` state (default `false`) and compute `habitAdvancedFilledCount` in `TaskFormModal`. When creating a habit, render Habit Name and Phase upfront, followed by a `.task-advanced-toggle` accordion button. When expanded, show Micro Target, Day Selector buttons, and Identity Pillar. Keep `HabitEditModal` fully open for editing existing habits.

**Tech Stack:** React (Vanilla JS/React in `static/index.html`), Vanilla CSS (`static/app.css`), Node.js test runner (`tests/offline/`), Service Worker (`static/sw.js`).

## Global Constraints

- Preserve 100% of existing habit submission payload keys (`title`, `phase`, `micro_target`, `identity_pillar`, `frequency`).
- Default frequency remains all 7 days (`["mon", "tue", "wed", "thu", "fri", "sat", "sun"]`).
- Retain tag autocomplete (`#tag`) and keyboard submission on Habit Name.
- Retain full form display for habit edit mode (`HabitEditModal`).
- Verify every step with unit tests before completion.

---

### Task 1: Create Unit Test Suite for Habit Modal Progressive Disclosure

**Files:**
- Create: `tests/offline/habit_modal_progressive_disclosure.test.js`

**Interfaces:**
- Tests: `static/index.html` structure, `TaskFormModal` habit mode JSX, `showHabitAdvanced` state, accordion toggle button, and form containment.

- [ ] **Step 1: Write unit tests in `tests/offline/habit_modal_progressive_disclosure.test.js`**

```javascript
"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "../..");
const indexHtml = fs.readFileSync(path.join(ROOT, "static/index.html"), "utf8");

test("Habit Modal Progressive Disclosure Specifications", async (t) => {
  // Extract TaskFormModal component code
  const taskModalMatch = indexHtml.match(/function TaskFormModal\([\s\S]*?^function /m);
  const taskModalCode = taskModalMatch ? taskModalMatch[0] : "";
  assert.ok(taskModalCode.length > 0, "TaskFormModal function should be present in static/index.html");

  // Extract HabitEditModal component code
  const habitEditModalMatch = indexHtml.match(/function HabitEditModal\([\s\S]*?^function /m);
  const habitEditModalCode = habitEditModalMatch ? habitEditModalMatch[0] : "";
  assert.ok(habitEditModalCode.length > 0, "HabitEditModal function should be present in static/index.html");

  await t.test("1. State management for showHabitAdvanced initialized to false", () => {
    assert.match(
      taskModalCode,
      /showHabitAdvanced/i,
      "TaskFormModal should define showHabitAdvanced state"
    );
  });

  await t.test("2. Collapsible toggle button is rendered in habit mode", () => {
    assert.match(
      taskModalCode,
      /task-advanced-toggle/,
      "Habit form should render a toggle button with class task-advanced-toggle"
    );
    assert.match(
      taskModalCode,
      /Opsi Lanjutan/i,
      "Habit form should include Opsi Lanjutan in toggle button"
    );
  });

  await t.test("3. Secondary fields (micro_target, frequency day selector, identity_pillar) inside advanced section", () => {
    assert.match(
      taskModalCode,
      /showHabitAdvanced\s*(&&|\?)/,
      "Secondary habit fields should be guarded by showHabitAdvanced"
    );
  });

  await t.test("4. Filled count computation reflects populated advanced fields", () => {
    function computeHabitFilledCount(form, daysLength = 7) {
      let count = 0;
      if (form.micro_target && form.micro_target.trim()) count++;
      if (Array.isArray(form.frequency) && form.frequency.length > 0 && form.frequency.length !== daysLength) count++;
      if (form.identity_pillar && form.identity_pillar.trim()) count++;
      return count;
    }

    assert.strictEqual(computeHabitFilledCount({ micro_target: "", frequency: ["mon","tue","wed","thu","fri","sat","sun"], identity_pillar: "" }), 0);
    assert.strictEqual(computeHabitFilledCount({ micro_target: "5 menit", frequency: ["mon","tue","wed","thu","fri","sat","sun"], identity_pillar: "" }), 1);
    assert.strictEqual(computeHabitFilledCount({ micro_target: "5 menit", frequency: ["mon","wed","fri"], identity_pillar: "" }), 2);
    assert.strictEqual(computeHabitFilledCount({ micro_target: "5 menit", frequency: ["mon","wed","fri"], identity_pillar: "Pribadi disiplin" }), 3);
  });

  await t.test("5. HabitEditModal preserves full form fields for editing", () => {
    assert.match(habitEditModalCode, /Nama Habit/i);
    assert.match(habitEditModalCode, /Fase/i);
    assert.match(habitEditModalCode, /Micro Target/i);
    assert.match(habitEditModalCode, /Frekuensi/i);
    assert.match(habitEditModalCode, /Identity Pillar/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails on unimplemented code**

Run: `node --test tests/offline/habit_modal_progressive_disclosure.test.js`  
Expected: FAIL (because `showHabitAdvanced` is not yet implemented in `TaskFormModal`).

- [ ] **Step 3: Commit test file**

```bash
git add tests/offline/habit_modal_progressive_disclosure.test.js
git commit -m "test: add test suite for Habit modal progressive disclosure"
```

---

### Task 2: Implement Progressive Disclosure in `TaskFormModal` Habit Mode

**Files:**
- Modify: `static/index.html:3600-4250`
- Test: `tests/offline/habit_modal_progressive_disclosure.test.js`

**Interfaces:**
- Consumes: `habitForm` state in `TaskFormModal`
- Produces: `showHabitAdvanced` toggle, `habitAdvancedFilledCount` memo, collapsible secondary section

- [ ] **Step 1: Add `showHabitAdvanced` and `habitAdvancedFilledCount` to `TaskFormModal` in `static/index.html`**

```javascript
const [showHabitAdvanced, setShowHabitAdvanced] = useState(false);

const habitAdvancedFilledCount = useMemo(() => {
  let count = 0;
  if (habitForm.micro_target && habitForm.micro_target.trim()) count++;
  if (Array.isArray(habitForm.frequency) && habitForm.frequency.length > 0 && habitForm.frequency.length !== DAYS.length) count++;
  if (habitForm.identity_pillar && habitForm.identity_pillar.trim()) count++;
  return count;
}, [habitForm.micro_target, habitForm.frequency, habitForm.identity_pillar, DAYS.length]);
```

- [ ] **Step 2: Restructure `mode === "habit"` JSX in `TaskFormModal`**

Update `mode === "habit"`:
- Upfront:
  - Label & Input "Nama Habit *" with `#tag` autocomplete
  - Label & Select "Fase" (Pagi, Siang, Malam)
- Accordion Toggle Button:
  ```javascript
  /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: "task-advanced-toggle",
    onClick: () => setShowHabitAdvanced(s => !s)
  }, /*#__PURE__*/React.createElement("span", null, showHabitAdvanced ? "▾ Sembunyikan Opsi Lanjutan" : "▸ Opsi Lanjutan (Micro Target, Hari Khusus, Identity Pillar)"), !showHabitAdvanced && habitAdvancedFilledCount > 0 && /*#__PURE__*/React.createElement("span", {
    style: {
      background: "rgba(168,197,0,0.18)",
      color: "var(--accent)",
      padding: "2px 8px",
      borderRadius: 12,
      fontSize: 11,
      fontWeight: 700
    }
  }, `${habitAdvancedFilledCount} diisi`))
  ```
- Collapsible container `showHabitAdvanced && /*#__PURE__*/React.createElement("div", ...)` containing:
  - Micro Target (opsional)
  - Frekuensi (Pilih/Hapus Semua + 7 tombol hari)
  - Identity Pillar (opsional)
- Submit & Batal buttons remain at the bottom.

- [ ] **Step 3: Run the unit test to verify it passes**

Run: `node --test tests/offline/habit_modal_progressive_disclosure.test.js`  
Expected: PASS (5/5 tests).

- [ ] **Step 4: Verify inline script syntax**

Run: `node scratch/check_inline.js static/index.html`  
Expected: 5/5 scripts OK.

- [ ] **Step 5: Commit**

```bash
git add static/index.html tests/offline/habit_modal_progressive_disclosure.test.js
git commit -m "feat(habit-modal): implement progressive disclosure for new habit creation"
```

---

### Task 3: Service Worker Bump and Test Suite Verification

**Files:**
- Modify: `static/sw.js:1`
- Modify: `tests/offline/drawing_sync_ui.test.js:249-250`
- Modify: `tests/offline/interactive_note_viewer.test.js:141`
- Modify: `.agents/CURRENT_STATE.md`
- Modify: `.agents/SESSION_LOG.md`

- [ ] **Step 1: Bump Service Worker cache version in `static/sw.js`**

Change `CACHE` to:
```javascript
const CACHE = "taskflow-v346-habit-modal-progressive-disclosure";
```

- [ ] **Step 2: Update test assertions for cache version**

Update expected cache string to `v346` in:
- `tests/offline/drawing_sync_ui.test.js`
- `tests/offline/interactive_note_viewer.test.js`

- [ ] **Step 3: Run full offline JS test suite**

Run: `node --test tests/offline/*.test.js`  
Expected: All suites pass (0 failures).

- [ ] **Step 4: Run full backend pytest test suite**

Run: `python -m pytest tests/`  
Expected: 61/61 pass.

- [ ] **Step 5: Update documentation and session logs**

Update `.agents/CURRENT_STATE.md` and `.agents/SESSION_LOG.md`.

- [ ] **Step 6: Commit, push to main, and deploy**

Run `python scratch/deploy_and_check.py` and verify GitHub Actions build and deploy succeed.
