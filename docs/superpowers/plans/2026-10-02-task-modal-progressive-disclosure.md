# TaskFormModal Progressive Disclosure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement Progressive Disclosure in `TaskFormModal` so that new task creation presents a clean, compact view (Title + Deadline, Priority, Project) and tucks secondary GTD/task configurations inside a collapsible accordion, while existing task edits remain fully expanded.

**Architecture:** Add `showAdvanced` state initialized to `isEdit` in `TaskFormModal`. When `!isEdit`, render a 3-column quick attributes bar (`Deadline`, `Priority`, `Project`) under the title, followed by an accordion toggle with an active count badge (`advancedFilledCount`). Keep GTD Status, Context, Shared List, Recurrence, Description, and Subtasks inside the collapsible section.

**Tech Stack:** React (Vanilla JS/React in `static/index.html`), Vanilla CSS (`static/app.css`), Node test runner (`tests/offline/`), Service Worker (`static/sw.js`).

## Global Constraints

- Preserve 100% of existing form submission payload keys and defaults (`gtd_status: "inbox"`, `priority: "P3"`).
- Preserve existing tag autocomplete `#tag` and Enter key submission behavior on the title input.
- Retain full form display for task edit mode (`isEdit === true`).
- Ensure responsive layout down to mobile screens (<= 640px).
- Verify every step with unit tests before completion.

---

### Task 1: CSS Styling for Quick Attributes and Accordion Toggle

**Files:**
- Modify: `static/app.css:1250-1300` (or appropriate section)
- Test: Syntax check and visual CSS verification

**Interfaces:**
- Produces: CSS classes `.task-quick-attributes` and `.task-advanced-toggle`

- [ ] **Step 1: Add CSS rules in `static/app.css`**

Add the responsive 3-column grid and toggle button styling:
```css
/* TaskFormModal Progressive Disclosure */
.task-quick-attributes {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 10px;
  margin-bottom: 14px;
}
@media (max-width: 640px) {
  .task-quick-attributes {
    grid-template-columns: 1fr;
    gap: 8px;
  }
}
.task-advanced-toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 8px 12px;
  margin-bottom: 14px;
  border-radius: 8px;
  border: 1px dashed var(--border);
  background: var(--bg-primary);
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 12px;
  font-weight: 600;
  transition: background 0.15s, border-color 0.15s, color 0.15s;
}
.task-advanced-toggle:hover {
  background: var(--bg-card);
  border-color: var(--accent);
  color: var(--text-primary);
}
```

- [ ] **Step 2: Commit**

```bash
git add static/app.css
git commit -m "style: add CSS rules for task modal progressive disclosure"
```

---

### Task 2: Unit Test Suite for TaskFormModal Progressive Disclosure

**Files:**
- Create: `tests/offline/task_modal_progressive_disclosure.test.js`

**Interfaces:**
- Tests: `static/index.html` structure, `TaskFormModal` state, accordion toggle, and form element containment.

- [ ] **Step 1: Write unit tests in `tests/offline/task_modal_progressive_disclosure.test.js`**

```javascript
"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "../..");
const indexHtml = fs.readFileSync(path.join(ROOT, "static/index.html"), "utf8");
const appCss = fs.readFileSync(path.join(ROOT, "static/app.css"), "utf8");

test("TaskFormModal Progressive Disclosure Specifications", async (t) => {
  // Extract TaskFormModal code block from static/index.html
  const modalMatch = indexHtml.match(/function TaskFormModal\([\s\S]*?^function /m);
  const modalCode = modalMatch ? modalMatch[0] : "";
  assert.ok(modalCode.length > 0, "TaskFormModal function must exist in static/index.html");

  await t.test("1. CSS rules for quick attributes and toggle button", () => {
    assert.match(appCss, /\.task-quick-attributes\s*\{[^}]*grid-template-columns:\s*1fr 1fr 1fr/, "app.css must define 3-column quick attributes");
    assert.match(appCss, /\.task-advanced-toggle/, "app.css must define .task-advanced-toggle");
  });

  await t.test("2. State management for showAdvanced initialized to isEdit", () => {
    assert.match(modalCode, /const\s*\[showAdvanced,\s*setShowAdvanced\]\s*=\s*React\.useState\(isEdit\)/, "showAdvanced state must initialize with isEdit");
  });

  await t.test("3. Quick attributes grid contains Deadline, Priority, and Project", () => {
    assert.match(modalCode, /className:\s*["']task-quick-attributes["']/, "Quick attributes container must use .task-quick-attributes class");
  });

  await t.test("4. Collapsible toggle button is rendered when !isEdit", () => {
    assert.match(modalCode, /!isEdit\s*&&[\s\S]*?className:\s*["']task-advanced-toggle["']/, "Toggle button must only be shown when not in edit mode");
    assert.match(modalCode, /setShowAdvanced\(prev\s*=>\s*!prev\)/, "Toggle button must toggle showAdvanced state");
  });

  await t.test("5. Secondary fields are contained within the advanced section", () => {
    assert.match(modalCode, /\(isEdit\s*\|\|\s*showAdvanced\)\s*&&/, "Secondary fields must be conditionally rendered based on isEdit || showAdvanced");
  });

  await t.test("6. Filled count computation reflects populated advanced fields", () => {
    assert.match(modalCode, /advancedFilledCount/, "Must compute count of populated advanced attributes");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/offline/task_modal_progressive_disclosure.test.js`  
Expected: FAIL on subtests 2-6 (since implementation in `static/index.html` has not been applied yet).

---

### Task 3: Implement Progressive Disclosure in `TaskFormModal`

**Files:**
- Modify: `static/index.html:2868-2920` (state), `4270-4630` (JSX layout)

**Interfaces:**
- Consumes: `isEdit`, `form`, `projects`, `contexts`, `sharedLists`
- Produces: Clean, progressive layout with `showAdvanced` toggle and compact top attributes.

- [ ] **Step 1: Add `showAdvanced` and `advancedFilledCount` to `TaskFormModal` in `static/index.html`**

Around line 2882:
```javascript
  const [showAdvanced, setShowAdvanced] = React.useState(isEdit);
  const advancedFilledCount = React.useMemo(() => {
    let count = 0;
    if (form.gtd_status && form.gtd_status !== 'inbox') count++;
    if (form.context && form.context.trim()) count++;
    if (form.list_id) count++;
    if (recurringOn) count++;
    if (form.description && form.description.trim()) count++;
    if (pendingSubtasks.length > 0) count += pendingSubtasks.length;
    if (form.waiting_for && form.waiting_for.trim()) count++;
    return count;
  }, [form.gtd_status, form.context, form.list_id, recurringOn, form.description, pendingSubtasks, form.waiting_for]);
```

- [ ] **Step 2: Restructure `mode === "task"` JSX in `TaskFormModal`**

1. Directly below the Title input, render the 3-column `.task-quick-attributes` grid:
   - **Deadline**
   - **Priority**
   - **Project**
2. Below the quick attributes grid, render the toggle button when `!isEdit`:
   ```javascript
   !isEdit && /*#__PURE__*/React.createElement("button", {
     type: "button",
     onClick: () => setShowAdvanced(prev => !prev),
     className: "task-advanced-toggle"
   }, /*#__PURE__*/React.createElement("span", {
     style: { display: "flex", alignItems: "center", gap: 6 }
   }, /*#__PURE__*/React.createElement(Icon, {
     name: showAdvanced ? "chevron-down" : "chevron-right",
     size: 14
   }), showAdvanced ? "Sembunyikan Opsi Tambahan" : "Opsi Tambahan (GTD, Context, Deskripsi, Subtask)"),
   !showAdvanced && advancedFilledCount > 0 && /*#__PURE__*/React.createElement("span", {
     style: {
       background: "var(--accent)",
       color: "#000",
       borderRadius: 10,
       padding: "1px 7px",
       fontSize: 11,
       fontWeight: 700
     }
   }, `${advancedFilledCount} diisi`))
   ```
3. Wrap the secondary controls inside `(isEdit || showAdvanced) && /*#__PURE__*/React.createElement("div", { className: "task-advanced-section fade-in" }, ...)`:
   - GTD Status & Waiting For
   - Context
   - Shared List & Assignee
   - Berulang (Recurrence)
   - Deskripsi (MentionInput)
   - Subtasks

- [ ] **Step 3: Run the unit test to verify it passes**

Run: `node --test tests/offline/task_modal_progressive_disclosure.test.js`  
Expected: PASS (6/6 tests).

- [ ] **Step 4: Verify inline script syntax**

Run: `node scratch/check_inline.js static/index.html`  
Expected: 5/5 scripts OK.

- [ ] **Step 5: Commit**

```bash
git add static/index.html tests/offline/task_modal_progressive_disclosure.test.js
git commit -m "feat(task-modal): implement progressive disclosure for new task creation"
```

---

### Task 4: Service Worker Bump and Test Suite Verification

**Files:**
- Modify: `static/sw.js:1`
- Modify: `tests/offline/drawing_sync_ui.test.js:249-250`
- Modify: `tests/offline/interactive_note_viewer.test.js:141`
- Modify: `.agents/CURRENT_STATE.md`
- Modify: `.agents/SESSION_LOG.md`

- [ ] **Step 1: Bump Service Worker cache version in `static/sw.js`**

Change `CACHE` to:
```javascript
const CACHE = "taskflow-v345-task-modal-progressive-disclosure";
```

- [ ] **Step 2: Update test assertions for cache version**

Update expected cache string to `v345` in:
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
