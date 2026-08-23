# Implementation Plan: Floating TOC Overlay for Note Viewer

## Goal
Implement the floating TOC trigger button and popover overlay in `NotePanel` (`static/index.html` and `static/app.css`), replacing the static side-column to give note reading 100% full width while providing sticky heading navigation on long documents.

---

## Tasks

### Task 1: Create Unit Test Suite for Floating TOC
- **File**: `tests/offline/note_toc.test.js`
- **Actions**:
  1. Write tests verifying that `NotePanel` mounts the floating TOC trigger button (`📑 Isi (N) ▾`) when `tocItems.length >= 2`.
  2. Write tests verifying that static `.note-toc-sticky` side column is removed and note content takes full width.
  3. Write tests verifying floating TOC popover markup, hierarchical indenting, smooth scroll trigger, and outside-click ref handler.

### Task 2: Implement Floating TOC Trigger & Popover in `static/index.html` and `static/app.css`
- **Files**: `static/index.html`, `static/app.css`
- **Actions**:
  1. In `static/index.html`:
     - Inside `NotePanel`, add state `const [tocOpen, setTocOpen] = useState(false);` and ref `const tocRef = useRef(null);`.
     - Add `useEffect` click-outside dismiss handler for `tocRef`.
     - Replace static `.note-toc-sticky` with a sticky floating container at the top of the note view:
       - Floating trigger button `[ 📑 Isi (${tocItems.length}) ▾ ]`
       - Floating popover overlay displaying hierarchical headings when `tocOpen === true`.
  2. In `static/app.css`:
     - Style `.floating-toc-trigger`, `.floating-toc-popover`, `.floating-toc-item`.
     - Remove obsolete static `.note-toc-sticky` constraints.

### Task 3: Service Worker Cache Bump & Full Test Suite Verification
- **Files**: `static/sw.js`, `.agents/CURRENT_STATE.md`, `.agents/SESSION_LOG.md`
- **Actions**:
  1. Bump `CACHE` in `static/sw.js` to `taskflow-v298-floating-toc-overlay`.
  2. Run `node --check static/sw.js`, `node --test tests/offline/*.test.js`, and `python -m pytest tests/`.
  3. Update `.agents/CURRENT_STATE.md` and `.agents/SESSION_LOG.md`.
  4. Perform whole-branch code review via Subagent Reviewer.
  5. Commit and push to GitHub.
