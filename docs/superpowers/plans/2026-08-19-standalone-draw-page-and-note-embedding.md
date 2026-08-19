# Standalone Draw Page & Note Embedding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the Drawing Canvas (`tldraw`) into a dedicated standalone first-class module with a 2-column layout and multi-tab workspace, while enabling seamless inline drawing embedding (`/draw`) and editing inside notes.

**Architecture:** A new SQLite `drawings` table and REST API endpoints in `webapp.py` with automatic legacy drawing migration; client-side local-first IndexedDB storage and outbox synchronization (`drawingrepo.js`, `drawingroutes.js`, `drawingtabs.js`); a full-featured 2-column `DrawPage` UI with a 5-tab multi-tab bar; note editor slash commands `/draw` & toolbar `+Canvas` with interactive live preview cards; and global search (`Ctrl+K`) + Dashboard pinning.

**Tech Stack:** Python 3.10 / FastAPI / SQLite (Backend), Vanilla JS / React-like components (Frontend SPA), Milkdown / Markdown Editor, `tldraw` v2.4.6 iframe engine, IndexedDB & Service Worker (PWA Offline-First).

---

## Global Constraints

- Preserve all existing code conventions, documentation, and comments.
- Maintain 100% offline-first compatibility via IndexedDB and Service Worker cache-first strategies.
- Bump Service Worker cache name (`taskflow-v247-standalone-draw-page`) and versioning query parameters whenever static assets are modified.
- Zero data loss for existing drawings in notes (automatic migration on backend startup).
- Verify all changes with automated unit tests (JS `npm test` and Python `pytest`).

---

### Task 1: Backend Database & Migration & API Endpoints for Drawings

**Files:**
- Modify: `models.py`
- Modify: `webapp.py`
- Create: `tests/test_drawings.py`

**Interfaces:**
- Produces:
  - Table `drawings` with columns `(id, user_id, title, data_json, svg_preview, is_pinned, created_at, updated_at)`
  - Endpoint `GET /api/drawings` -> `list[DrawingSummary]`
  - Endpoint `POST /api/drawings` -> `DrawingDetail`
  - Endpoint `GET /api/drawings/{id}` -> `DrawingDetail`
  - Endpoint `PUT /api/drawings/{id}` -> `DrawingDetail`
  - Endpoint `DELETE /api/drawings/{id}` -> `{"ok": true}`
  - Endpoint `PATCH /api/drawings/{id}/pin` -> `{"is_pinned": int}`
  - Extended `GET /api/search` with `"drawings"` key

- [ ] **Step 1: Write failing Python tests for drawings API**

Create `tests/test_drawings.py`:

```python
import pytest
from fastapi.testclient import TestClient
from webapp import app, get_db

@pytest.fixture
def client():
    return TestClient(app)

def test_drawings_crud(client):
    # 1. Create a drawing
    res = client.post("/api/drawings", json={"title": "Arsitektur Sistem", "data_json": '{"shapes":{}}'})
    assert res.status_code == 200
    drawing = res.json()
    assert drawing["title"] == "Arsitektur Sistem"
    drawing_id = drawing["id"]

    # 2. List drawings
    res = client.get("/api/drawings")
    assert res.status_code == 200
    drawings = res.json()
    assert any(d["id"] == drawing_id for d in drawings)

    # 3. Get single drawing
    res = client.get(f"/api/drawings/{drawing_id}")
    assert res.status_code == 200
    assert res.json()["data_json"] == '{"shapes":{}}'

    # 4. Update drawing
    res = client.put(f"/api/drawings/{drawing_id}", json={"title": "Arsitektur V2", "data_json": '{"shapes":{"s1":{}}}'})
    assert res.status_code == 200
    assert res.json()["title"] == "Arsitektur V2"

    # 5. Toggle pin
    res = client.patch(f"/api/drawings/{drawing_id}/pin")
    assert res.status_code == 200
    assert res.json()["is_pinned"] == 1

    # 6. Delete drawing
    res = client.delete(f"/api/drawings/{drawing_id}")
    assert res.status_code == 200
    assert client.get(f"/api/drawings/{drawing_id}").status_code == 404
```

- [ ] **Step 2: Run pytest to verify it fails**

Run: `python -m pytest tests/test_drawings.py -v`  
Expected: FAIL (endpoints not found)

- [ ] **Step 3: Implement database schema and endpoints in `models.py` & `webapp.py`**

In `models.py`, add `drawings` table initialization in `init_db()`:
```sql
CREATE TABLE IF NOT EXISTS drawings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL DEFAULT 'Untitled Drawing',
    data_json TEXT NOT NULL DEFAULT '{}',
    svg_preview TEXT DEFAULT '',
    is_pinned INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_drawings_user_updated ON drawings(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_drawings_user_pinned ON drawings(user_id, is_pinned DESC);
```

In `webapp.py`:
1. Add endpoints:
   - `GET /api/drawings`
   - `POST /api/drawings`
   - `GET /api/drawings/{id}`
   - `PUT /api/drawings/{id}`
   - `DELETE /api/drawings/{id}`
   - `PATCH /api/drawings/{id}/pin`
2. Update `GET /api/search` to search `drawings` by `title` and `tags`.
3. Add startup auto-migration for legacy note drawings (if any notes have drawing snapshots, create drawing rows and append `::draw[id]{title="..."}` to note body).

- [ ] **Step 4: Run pytest to verify all tests pass**

Run: `python -m pytest tests/ -v`  
Expected: 39+ passed (0 fail)

- [ ] **Step 5: Commit Task 1**

```bash
git add models.py webapp.py tests/test_drawings.py
git commit -m "feat(backend): add drawings schema, migration and API endpoints"
```

---

### Task 2: Multi-Tab Manager Module (`drawingtabs.js`) & TDD

**Files:**
- Create: `static/offline/drawingtabs.js`
- Create: `tests/offline/drawingtabs.test.js`

**Interfaces:**
- Produces:
  - `openTab(tabs, drawingId, title)` -> `{ tabs: Tab[], activeTabId: number }`
  - `closeTab(tabs, activeTabId, closeTabId)` -> `{ tabs: Tab[], activeTabId: number }`
  - `updateTabTitle(tabs, drawingId, newTitle)` -> `Tab[]`
  - Maximum 5 tabs limit rule (FIFO eviction of oldest unpinned/inactive tab)

- [ ] **Step 1: Write failing JS unit tests for `drawingtabs.js`**

Create `tests/offline/drawingtabs.test.js`:

```javascript
const { test } = require('node:test');
const assert = require('node:assert');
const { openTab, closeTab, updateTabTitle } = require('../../static/offline/drawingtabs.js');

test('openTab adds a new tab and activates it', () => {
  const result = openTab([], 1, 'Drawing 1');
  assert.strictEqual(result.tabs.length, 1);
  assert.strictEqual(result.activeTabId, 1);
  assert.strictEqual(result.tabs[0].title, 'Drawing 1');
});

test('openTab does not duplicate existing tab and switches to it', () => {
  const tabs = [{ id: 1, title: 'Drawing 1' }, { id: 2, title: 'Drawing 2' }];
  const result = openTab(tabs, 1, 'Drawing 1');
  assert.strictEqual(result.tabs.length, 2);
  assert.strictEqual(result.activeTabId, 1);
});

test('openTab evicts oldest tab when reaching limit of 5', () => {
  let tabs = [];
  for (let i = 1; i <= 5; i++) {
    tabs = openTab(tabs, i, `Drawing ${i}`).tabs;
  }
  assert.strictEqual(tabs.length, 5);
  const result = openTab(tabs, 6, 'Drawing 6');
  assert.strictEqual(result.tabs.length, 5);
  assert.strictEqual(result.activeTabId, 6);
  assert.strictEqual(result.tabs[0].id, 2);
  assert.strictEqual(result.tabs[4].id, 6);
});

test('closeTab switches to neighbor tab correctly', () => {
  const tabs = [{ id: 1, title: 'Drawing 1' }, { id: 2, title: 'Drawing 2' }, { id: 3, title: 'Drawing 3' }];
  const result = closeTab(tabs, 2, 2);
  assert.strictEqual(result.tabs.length, 2);
  assert.strictEqual(result.activeTabId, 3);
});

test('updateTabTitle updates the title of open tab', () => {
  const tabs = [{ id: 1, title: 'Drawing 1' }, { id: 2, title: 'Drawing 2' }];
  const updated = updateTabTitle(tabs, 2, 'Renamed Drawing');
  assert.strictEqual(updated[1].title, 'Renamed Drawing');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/offline/drawingtabs.test.js`  
Expected: FAIL (module not found)

- [ ] **Step 3: Implement `static/offline/drawingtabs.js`**

Implement UMD module `static/offline/drawingtabs.js` with `openTab`, `closeTab`, and `updateTabTitle`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`  
Expected: All tests pass.

- [ ] **Step 5: Commit Task 2**

```bash
git add static/offline/drawingtabs.js tests/offline/drawingtabs.test.js
git commit -m "feat(draw): add drawingtabs UMD helper module with unit tests"
```

---

### Task 3: Offline Data Store & Outbox Sync Modules (`drawingrepo.js`, `drawingroutes.js`) & TDD

**Files:**
- Modify: `static/offline/db.js`
- Modify: `static/offline/drawingrepo.js`
- Modify: `static/offline/drawingroutes.js`
- Create: `tests/offline/drawingrepo.test.js`

**Interfaces:**
- Produces:
  - IndexedDB object store `drawings`
  - `drawingrepo.listDrawings(opts)`
  - `drawingrepo.getDrawing(id)`
  - `drawingrepo.createDrawing(doc)`
  - `drawingrepo.updateDrawing(id, patch)`
  - `drawingrepo.deleteDrawing(id)`
  - `drawingrepo.togglePin(id)`
  - `drawingroutes` registering offline endpoints in `TF.router`

- [ ] **Step 1: Write failing JS unit tests for `drawingrepo.test.js`**

Create `tests/offline/drawingrepo.test.js` covering offline CRUD, tag filtering, and outbox queuing.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/offline/drawingrepo.test.js`  
Expected: FAIL

- [ ] **Step 3: Implement offline store, repo, and routes**

1. In `static/offline/db.js`: Ensure `drawings` store exists in IndexedDB upgrade handler.
2. In `static/offline/drawingrepo.js`: Implement standalone drawing CRUD methods and outbox queuing.
3. In `static/offline/drawingroutes.js`: Register `/api/drawings` routes in local offline router.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`  
Expected: All JS tests pass.

- [ ] **Step 5: Commit Task 3**

```bash
git add static/offline/db.js static/offline/drawingrepo.js static/offline/drawingroutes.js tests/offline/drawingrepo.test.js
git commit -m "feat(offline): add drawings store, repository and offline router"
```

---

### Task 4: DrawPage UI Component (2-Column & Multi-Tab Canvas)

**Files:**
- Modify: `static/index.html`
- Modify: `static/app.css`

**Interfaces:**
- Consumes: `drawingtabs.js`, `drawingrepo.js`, `/static/vendor/tldraw/index.html`
- Produces:
  - Component `DrawPage`
  - Component `DrawingTabInstance`
  - Navigation item in sidebar `🎨 Draw` / `🎨 Gambar`
  - URL routing `activeTab === 'draw'`

- [ ] **Step 1: Add CSS styling in `static/app.css`**

Add styles for:
- `.draw-page-container` (2-column layout)
- `.draw-sidebar` & `.draw-list-item`
- `.draw-tab-bar` & `.draw-tab-item`
- `.draw-header-toolbar`
- Responsive mobile drawer layout

- [ ] **Step 2: Implement `DrawPage` & `DrawingTabInstance` in `static/index.html`**

1. Register `<script src="/static/offline/drawingtabs.js">` before main app script.
2. Implement `DrawingTabInstance`:
   - Maintains isolated DOM iframe for each open drawing.
   - Switches visibility with `display: 'none' / 'flex'` to avoid iframe reloads.
   - Listens to `change` postMessage to auto-save drawing snapshot to `drawingrepo`.
3. Implement `DrawPage`:
   - Left Sidebar: Search input, tag filter pills, ➕ New Drawing button, list items with pin/linked note badges.
   - Right Canvas: Multi-tab bar (`drawingtabs`), title inline editor, pin toggle, quick export buttons (PNG, SVG, JSON), and full viewport canvas.
4. Add `🎨 Draw` to sidebar navigation items.

- [ ] **Step 3: Syntax check & test suite run**

Run: `npm test`  
Expected: All tests pass.

- [ ] **Step 4: Commit Task 4**

```bash
git add static/index.html static/app.css
git commit -m "feat(ui): implement dedicated DrawPage with 2-column layout and multi-tab canvas"
```

---

### Task 5: Note Editor Integration (`/draw`, `+Canvas` button, Live Preview Markdown Block)

**Files:**
- Modify: `static/index.html`
- Modify: `static/app.css`

**Interfaces:**
- Produces:
  - Slash command `/draw`, `/canvas`, `/gambar`, `/sketsa` popup
  - Toolbar button `+Gambar` / `+Canvas`
  - Autocomplete trigger `[draw` / `[gambar`
  - Markdown Drawing Block component rendering `::draw[id]{title="..."}`

- [ ] **Step 1: Add styling for Drawing Preview Block in `static/app.css`**

Add styles for `.note-draw-card`, `.note-draw-preview`, `.note-draw-header`, and `.note-draw-edit-btn`.

- [ ] **Step 2: Implement Note Editor Integration in `static/index.html`**

1. Slash menu dropdown popup on `/` with command options (`/draw`, `/task`, `/mindmap`, `/ai`).
2. Toolbar button `+Gambar` in NoteForm header.
3. Quick-Draw Modal & Drawing Picker:
   - Option 1: ➕ Create new drawing modal (instantly draw and insert).
   - Option 2: 🔗 Link existing drawing from Draw list.
4. Custom Markdown parser/renderer for `::draw[id]{title="..."}`:
   - Renders live preview card with SVG thumbnail and `✏️ Edit` button.
   - Clicking `✏️ Edit` opens quick-draw modal for inline editing.

- [ ] **Step 3: Run unit tests and syntax checks**

Run: `npm test`  
Expected: All tests pass.

- [ ] **Step 4: Commit Task 5**

```bash
git add static/index.html static/app.css
git commit -m "feat(notes): add slash command /draw, toolbar button, and interactive preview block"
```

---

### Task 6: Global Search (`Ctrl+K`), Dashboard Card & Service Worker Cache Bump

**Files:**
- Modify: `static/index.html`
- Modify: `static/sw.js`
- Modify: `.agents/CURRENT_STATE.md`
- Modify: `.agents/SESSION_LOG.md`

**Interfaces:**
- Produces:
  - `SearchModal` drawing search results with direct navigation
  - `Dashboard` card "🎨 Gambar Disematkan"
  - Service Worker cache bumped to `taskflow-v247-standalone-draw-page`

- [ ] **Step 1: Update Global Search and Dashboard in `static/index.html`**

1. Add `"drawings"` section in `SearchModal`:
   - Clicking a drawing result navigates to `DrawPage` and opens the tab.
2. Add "🎨 Gambar Disematkan" card in `Dashboard`.

- [ ] **Step 2: Bump Service Worker cache in `static/sw.js`**

1. Add `"/static/offline/drawingtabs.js"` to `STATIC` array.
2. Bump `CACHE` to `"taskflow-v247-standalone-draw-page"`.

- [ ] **Step 3: Run full verification suite**

Run: `npm test`  
Run: `python -m pytest tests/`  
Expected: All JS (420+) and Python (39+) tests pass with 0 failures.

- [ ] **Step 4: Update multi-agent state files and commit Task 6**

Update `.agents/CURRENT_STATE.md` and `.agents/SESSION_LOG.md`.

```bash
git add static/index.html static/sw.js .agents/CURRENT_STATE.md .agents/SESSION_LOG.md
git commit -m "feat: complete global search, dashboard pinned drawings card and SW cache bump"
```

---
