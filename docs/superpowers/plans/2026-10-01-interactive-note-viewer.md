# Low-Friction Interactive Note Viewer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement low-friction micro-interactions in Note Viewer (`NotePanel`)—interactive task checkboxes, inline title editing, and double-click to edit—while completely preserving `NoteModal` with Paper View and Milkdown WYSIWYG.

**Architecture:** Enhance `renderMarkdown` to assign indices to task checklist items and keep them clickable; add click delegation in `NotePanel` to toggle checkbox states directly in markdown content and sync via existing API/OfflineDB; add inline title edit input on title click; add double-click trigger on `.note-rendered` container to open `NoteModal`.

**Tech Stack:** Vanilla JS / React (JSX), Marked.js, OfflineDB (IndexedDB), Service Worker.

## Global Constraints
- Do NOT modify or remove any features in `NoteModal` (Milkdown, Paper view, Toolbar, TOC, templates).
- Must support offline mode via `OfflineDB.cacheSet` and `OfflineDB.queueAdd`.
- Ensure all inline scripts in `static/index.html` pass syntax checks (`node scratch/check_inline.js static/index.html`).
- Increment Service Worker version in `static/sw.js`.
- All offline JS test suites (`node --test tests/offline/*.test.js`) and backend test suites (`python -m pytest tests/`) must pass.

---

## Tasks

### Task 1: Create Unit Test Suite for Interactive Note Viewer
- [ ] Create `tests/offline/interactive_note_viewer.test.js` covering:
  - Markdown task checkbox indexing and removal of `disabled` attribute
  - Content checkbox toggle helper logic (`[ ]` ↔ `[x]`)
  - Inline title edit state and persistence in `NotePanel`
  - Double-click handler calling `onEdit`
  - Structural preservation assertion for `NoteModal`, `MilkdownEditor`, and `paperConfig`
- [ ] Run `node --test tests/offline/interactive_note_viewer.test.js` and verify it fails on unimplemented parts.

### Task 2: Implement Interactive Task Checkbox Rendering & Toggle
- [ ] In `static/index.html` (`renderMarkdown`):
  - Post-process `<input type="checkbox" ...>` to remove `disabled` attribute in rendered preview and attach `data-task-checkbox-idx`.
- [ ] In `static/index.html` (`NotePanel`):
  - In `handlePreviewClick`, detect click on task checkbox.
  - Calculate checkbox index and toggle `[ ]` ↔ `[x]` in `note.content`.
  - Save updated content via `api.put` with offline fallback.
  - Fire `noteSaved` custom event.
- [ ] In `static/app.css`:
  - Add pointer styling and slight hover scale for `.note-rendered input[type="checkbox"]`.

### Task 3: Implement Inline Title Quick Edit in Note Viewer
- [ ] In `static/index.html` (`NotePanel`):
  - Add `isEditingTitle` and `titleDraft` state.
  - Update `.notes-panel-title` to allow clicking the title or pencil icon to enter edit mode.
  - Render input when `isEditingTitle` is active with `onKeyDown` (`Enter` to save, `Escape` to cancel) and `onBlur` to save.
  - Save title changes via `api.put` with offline fallback.
- [ ] In `static/app.css`:
  - Add subtle styling for `.note-title-inline-input` to match the panel title style seamlessly.

### Task 4: Implement Double-Click to Open Full Editor
- [ ] In `static/index.html` (`NotePanel`):
  - Add `onDoubleClick` handler to `<div className="note-rendered" ...>`.
  - Guard against double-clicks on interactive elements (checkboxes, wikilinks, tasklinks, drawings, buttons).
  - Call `onEdit()` when double-clicked.
  - Add title tooltip `Double-click untuk mengedit catatan`.

### Task 5: Service Worker Cache Bump & Full Verification
- [ ] In `static/sw.js`:
  - Bump cache name to `taskflow-v331-interactive-note-viewer`.
- [ ] Run syntax checks:
  - `node scratch/check_inline.js static/index.html`
  - `node --check static/sw.js`
- [ ] Run test suites:
  - `node --test tests/offline/interactive_note_viewer.test.js`
  - `node --test tests/offline/*.test.js`
  - `python -m pytest tests/`
- [ ] Update `.agents/CURRENT_STATE.md` and `.agents/SESSION_LOG.md`.
