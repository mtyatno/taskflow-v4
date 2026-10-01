# Double-Click Cursor & Block Focus in Note Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Position the editor cursor inside the exact block that was double-clicked in the Note Viewer (`NotePanel`), auto-scrolling to it in `NoteModal` without title auto-focus interception.

**Architecture:**
- Capture clicked block element, snippet text, and child index in `NotePanel.onDoubleClick`.
- Route through `openEdit(note, blockTarget)` in `NotesPage` into `NoteModal` as `initialBlockTarget`.
- Locate target textblock in ProseMirror document (`doc.descendants`), apply `TextSelection.near($pos)`, `scrollIntoView`, and suppress `autoFocus` on title input.
- Service Worker version bumped to `taskflow-v343-double-click-block-focus`.

**Tech Stack:** React 18, ProseMirror (via Milkdown bundle), CSS Vanilla, Node Test Runner, FastAPI / Pytest.

## Global Constraints
- Do not modify or break `NoteModal` advanced features (Paper Mode A4/A3, block handle, slash menu).
- Preserve existing toolbar "✏ Edit" button behavior (defaults to title / top of note).
- 100% test pass rate across offline JS tests and pytest.

---

### Task 1: Add Unit Tests for Double-Click Block Focus in `tests/offline/interactive_note_viewer.test.js`

**Files:**
- Modify: `tests/offline/interactive_note_viewer.test.js`

**Interfaces:**
- Validates `NotePanel` `onDoubleClick` passing `blockTarget`.
- Validates `NotesPage` passing `initialBlockTarget` to `NoteModal`.
- Validates `NoteModal` searching `doc.descendants` and setting selection/focus.
- Validates SW version bumped to `taskflow-v343-double-click-block-focus`.

- [ ] **Step 1: Write the failing tests**
Add Test 9 to `tests/offline/interactive_note_viewer.test.js` asserting block targeting in `NotePanel`, `NotesPage`, and `NoteModal`.

- [ ] **Step 2: Run test to verify it fails**
Run: `node --test tests/offline/interactive_note_viewer.test.js`
Expected: FAIL on Test 9.

---

### Task 2: Implement Block Target Extraction in `NotePanel` and Forwarding in `NotesPage`

**Files:**
- Modify: `static/index.html` (`NotePanel` around line 21155, `NotesPage` around line 21425 & 22285 & 22315)

- [ ] **Step 1: Update `NotePanel` `onDoubleClick`**
Extract `blockTarget = { text, index, tag }` using `e.target.closest('p, h1, h2, h3, h4, h5, h6, li, blockquote, pre, tr')` and call `onEdit(blockTarget)`.

- [ ] **Step 2: Update `NotesPage` state and `openEdit`**
Add `initialBlockTarget` state, accept `openEdit(note, blockTarget)`, and pass `initialBlockTarget` prop to `<NoteModal>`.

---

### Task 3: Implement ProseMirror Cursor Positioning & Auto-Scroll in `NoteModal`

**Files:**
- Modify: `static/index.html` (`NoteModal` around line 18157, 18450, 19305)

- [ ] **Step 1: Update title input `autoFocus`**
Set `autoFocus: !focusMode && !initialBlockTarget`.

- [ ] **Step 2: Add `useEffect` in `NoteModal` to locate block and set selection**
Implement async retry polling for editor view, matching `doc.descendants` by text snippet or index, dispatching `tr.setSelection`, `view.focus()`, and centering scroll.

---

### Task 4: Bump Service Worker Cache Version & Synchronize Regression Tests

**Files:**
- Modify: `static/sw.js` (bump to `taskflow-v343-double-click-block-focus`)
- Modify: `tests/offline/drawing_sync_ui.test.js` (update SW cache assertion to v343)
- Modify: `tests/offline/interactive_note_viewer.test.js` (update SW cache assertion to v343)

- [ ] **Step 1: Bump SW version in `static/sw.js`**
- [ ] **Step 2: Update assertions in tests**
- [ ] **Step 3: Run full verification suite**
Run:
- `node scratch/check_inline.js static/index.html`
- `node --check static/sw.js`
- `node --test tests/offline/*.test.js`
- `python -m pytest tests/`

---

### Task 5: Handover, Documentation, and Deployment

**Files:**
- Modify: `.agents/CURRENT_STATE.md`
- Modify: `.agents/SESSION_LOG.md`

- [ ] **Step 1: Update session log & current state**
- [ ] **Step 2: Commit all changes & push to `main`**
- [ ] **Step 3: Verify GitHub Actions deployment status**
