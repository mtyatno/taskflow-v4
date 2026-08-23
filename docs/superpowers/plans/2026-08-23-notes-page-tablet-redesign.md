# Implementation Plan: Notes Page Tablet & Portrait Layout Redesign

## Goal
Implement the unified 2-column layout redesign for `NotesPage`, providing a responsive, clutter-free, and tablet-optimized experience for iPad Pro (portrait 768px–1024px), desktop, and mobile.

---

## Tasks

### Task 1: Create Unit Test Suite for Redesigned Notes Page
- **File**: `tests/offline/notes_page_layout.test.js`
- **Actions**:
  1. Write tests verifying unified left sidebar DOM structure (no separate sub-columns `.notes-col-search` and `.notes-col-list`).
  2. Write tests verifying 2–3 top tags chip bar with `+X Tags ▾` dropdown popover.
  3. Write tests verifying collapsible sidebar mechanics (`sidebarCollapsed` state, toggle button, and width collapse styles).
  4. Write tests verifying published & shared filter chips.

### Task 2: Implement Unified Left Panel & Component Layout in `static/index.html` and `static/app.css`
- **Files**: `static/index.html`, `static/app.css`
- **Actions**:
  1. In `static/index.html` (`NotesPage`):
     - Unify `.notes-left` into a single, clean column container.
     - Add top header with title `📝 Catatan`, `➕ Catatan Baru`, and collapse button `✕`.
     - Add full-width search input with clear icon.
     - Implement horizontal filter chip strip:
       - `[ Semua ]`
       - Top 2–3 tags (with counts)
       - `[ 🏷️ +X Tags ▾ ]` popover button for viewing all tags + `⬜ Tanpa Tag`
       - `[ 🔗 Published (X) ]` chip
       - `[ 👥 Shared (X) ]` chip
     - Add collapsible `📌 Disematkan (N)` section.
     - Add sort dropdown and note cards list.
  2. In `static/app.css`:
     - Style `.notes-left` to use `width: 320px` on tablets / `340px` on desktop with smooth collapse transitions.
     - Style `.tag-filter-strip`, `.tag-popover-menu`, `.pinned-notes-section`, and `.note-card`.
     - Update tablet media query (`768px – 1024px`) to preserve clean 2-column split view with 100% viewer expansion on sidebar collapse.

### Task 3: Service Worker Cache Bump & Full Regression Testing
- **Files**: `static/sw.js`, `.agents/CURRENT_STATE.md`, `.agents/SESSION_LOG.md`
- **Actions**:
  1. Bump `CACHE` version in `static/sw.js` to `taskflow-v295-notes-page-tablet-redesign`.
  2. Run `node --check static/sw.js`, `node --test tests/offline/*.test.js`, and `python -m pytest tests/`.
  3. Update `.agents/CURRENT_STATE.md` and `.agents/SESSION_LOG.md`.
  4. Perform whole-branch code review via Subagent Reviewer.
  5. Commit and push to GitHub.
