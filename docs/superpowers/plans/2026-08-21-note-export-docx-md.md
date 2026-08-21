# Note Export (.docx & .md) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provide full export capabilities for Scratchpad Notes to Microsoft Word (`.docx`) and raw Markdown (`.md`), alongside the existing PDF print feature, integrated via an elegant dropdown menu in the Note header.

**Architecture:** 
1. A Python backend converter module `docx_exporter.py` parses Markdown content (headings, formatted text, tables, checklists, blockquotes, code blocks) and constructs native `.docx` documents using `python-docx`.
2. REST API endpoints in `webapp.py` (`GET /api/scratchpad/{id}/export/docx` and `GET /api/scratchpad/{id}/export/md`, plus POST for live payloads) serve generated files with appropriate MIME headers and sanitised filenames.
3. Frontend UI in `static/index.html` replaces the static `PDF` button in `NoteModal` with an `Export ▾` dropdown offering PDF, Word (.docx), and Markdown (.md) options, with client-side instant fallback for `.md` and offline compatibility.

**Tech Stack:** Python 3.10+, FastAPI, `python-docx`, React, Vanilla JS / HTML5 Blob & Download.

## Global Constraints
- Must preserve all existing markdown formatting features (wikilinks, tasklinks, tags, checklists, tables, drawings).
- File download filenames must be sanitised (safe for Windows/Linux/macOS) and reflect the note title.
- Must work seamlessly across dark and light themes without UI regressions.
- All existing unit tests (433 JS tests + 40 Python tests) must continue to pass.

---

### Task 1: Add `python-docx` Dependency and Create `docx_exporter.py`

**Files:**
- Modify: `requirements.txt`
- Modify: `requirements-web.txt`
- Create: `docx_exporter.py`
- Test: `tests/test_docx_export.py`

**Interfaces:**
- Consumes: Note dict with `title`, `content`, `tags`, `updated_at`
- Produces: `docx_exporter.markdown_to_docx(title: str, content: str, meta: dict = None) -> io.BytesIO`

- [ ] **Step 1: Write failing test in `tests/test_docx_export.py`**
- [ ] **Step 2: Run pytest to confirm failure**
- [ ] **Step 3: Implement `docx_exporter.py` with headings, text styles, tables, code blocks, checklists**
- [ ] **Step 4: Run pytest and confirm all tests pass**
- [ ] **Step 5: Commit changes**

---

### Task 2: Add Export Endpoints in `webapp.py`

**Files:**
- Modify: `webapp.py`
- Test: `tests/test_docx_export.py`

**Interfaces:**
- `GET /api/scratchpad/{id}/export/docx` -> binary `.docx` file
- `GET /api/scratchpad/{id}/export/md` -> text `.md` file
- `POST /api/scratchpad/export/docx` -> live preview `.docx` download

- [ ] **Step 1: Add test for GET and POST export endpoints in `tests/test_docx_export.py`**
- [ ] **Step 2: Implement endpoint handlers in `webapp.py` with auth & access control**
- [ ] **Step 3: Run pytest to verify endpoints pass**
- [ ] **Step 4: Commit changes**

---

### Task 3: Implement Frontend `Export ▾` Dropdown in `static/index.html`

**Files:**
- Modify: `static/index.html`
- Modify: `static/sw.js`

**Interfaces:**
- Dropdown with options: "📄 PDF", "📘 Word (.docx)", "📝 Markdown (.md)"
- Client-side download handlers for `.md`, `.docx`, and PDF

- [ ] **Step 1: Add `handleExportDocx` and `handleExportMd` in `NoteModal`**
- [ ] **Step 2: Replace `PDF` button with `Export ▾` dropdown button and menu**
- [ ] **Step 3: Bump SW cache version in `static/sw.js`**
- [ ] **Step 4: Run full test suite (`npm test` and `pytest`)**
- [ ] **Step 5: Commit changes**

---

### Task 4: Multi-Agent State Synchronization & Verification

**Files:**
- Modify: `.agents/CURRENT_STATE.md`
- Modify: `.agents/SESSION_LOG.md`

- [ ] **Step 1: Update `.agents/CURRENT_STATE.md` with completed tasks**
- [ ] **Step 2: Append session summary in `.agents/SESSION_LOG.md`**
- [ ] **Step 3: Commit and push to `origin/main`**
