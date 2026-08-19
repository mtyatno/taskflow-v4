# Mindmap Sub-Map & Inter-Mindmap Linking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable linking mindmap nodes to other mindmaps (`type: 'mindmap'`) with quick-create capabilities and instant multi-tab drill-down navigation.

**Architecture:** Extend existing node link mechanisms (`type: 'note' | 'task' | 'mindmap'`) in both Canvas (Mind-Elixir iframe) and Outline modes. The link picker supports searching existing mindmaps and quick-creating new linked mindmaps. Clicking a mindmap link opens the target mindmap in a new tab or switches to it if already open.

**Tech Stack:** Vanilla JS / HTML5 (Iframe), React 18, UMD Helper Modules (`mindmaptabs.js`, `mindmapoutline.js`), FastAPI `/api/search` and `/api/mindmaps`.

## Global Constraints
- Do not break existing node links (`note` and `task`).
- Maintain offline-first compatibility and graceful fallback if mindmap is not cached.
- Max 5 open tabs limit preserved via `mindmaptabs.openTab`.
- All inline script blocks in `static/index.html` and `static/vendor/mind-elixir/index.html` must pass JavaScript AST parsing.

---

### Task 1: Unit Tests for Mindmap Link Support in Outline Module

**Files:**
- Modify: `tests/offline/mindmapoutline.test.js`
- Test: `tests/offline/mindmapoutline.test.js`

**Interfaces:**
- Consumes: `window.TF.mindmapoutline.addNodeLink(root, nodeId, link)` and `removeNodeLink(root, nodeId, index)`
- Produces: Verified unit tests for mindmap link type in outline helper

- [ ] **Step 1: Add unit tests for mindmap link type**
  Add tests asserting that `{ type: 'mindmap', id: 99, title: 'Sub Family Tree' }` can be added, deduplicated, and removed correctly.
- [ ] **Step 2: Run unit tests**
  `node --test tests/offline/mindmapoutline.test.js`
- [ ] **Step 3: Commit**
  `git commit -m "test(mindmap): add unit tests for mindmap node link type"`

---

### Task 2: Canvas Iframe Link Picker & Link Panel Integration

**Files:**
- Modify: `static/vendor/mind-elixir/index.html`

**Interfaces:**
- Consumes: `/api/search?q=...` and `/api/mindmaps`
- Produces: `postMessage({ type: 'openMindmap', id })` to parent window when `↗` is clicked on a `MAP` link

- [ ] **Step 1: Update Link Picker modal in iframe**
  - Add `Mindmaps` tab in `#lp-picker-tabs`.
  - Filter and display `searchResults.mindmaps` with badge `MAP` (`#8b5cf6`).
  - Add quick-create button `➕ Mindmap "{q}"` (`#lp-create-mindmap`).
  - Implement `createAndLink('mindmap')`: calls `POST /api/mindmaps`, adds `{ type: 'mindmap', id, title }` link to `currentNodeData.links`.
- [ ] **Step 2: Update Link Panel in iframe**
  - In `renderPanel`: render `MAP` badge (`lp-badge-mindmap`) for `link.type === 'mindmap'`.
  - In `openBtn.onclick`: for `link.type === 'mindmap'`, send `postMessage({ type: 'openMindmap', id: link.id }, window.location.origin)`.
- [ ] **Step 3: Verify JS syntax in iframe**
  `node -e "const fs = require('fs'); const content = fs.readFileSync('static/vendor/mind-elixir/index.html', 'utf8'); ..."`
- [ ] **Step 4: Commit**
  `git commit -m "feat(mindmap): add mindmap linking and quick-create in canvas iframe"`

---

### Task 3: Parent App Link Picker & Outline Mode Integration

**Files:**
- Modify: `static/index.html`

**Interfaces:**
- Consumes: `LinkPickerModal` and `MindmapOutline`
- Produces: Multi-tab auto-open and tab switching when mindmap link is clicked in Outline or via iframe message

- [ ] **Step 1: Update `LinkPickerModal` in `static/index.html`**
  - Add `mindmaps` tab filter.
  - Include `results.mindmaps` in search list with badge `MAP`.
  - Add `➕ Mindmap "{query}"` button that calls `api.post('/api/mindmaps', { title: q, data_json: ... })` and attaches the link.
- [ ] **Step 2: Update `MindmapOutline` in `static/index.html`**
  - Accept `onOpenMindmap` prop.
  - Render `MAP` badge on mindmap links.
  - Wire click handler to `onOpenMindmap(link.id)`.
- [ ] **Step 3: Wire `onOpenMindmap` in `MindmapTabInstance`**
  - Pass `onOpenMindmap: id => { window.dispatchEvent(new CustomEvent('openMindmap', { detail: id })); }` to `MindmapOutline`.
- [ ] **Step 4: Verify JS syntax in `static/index.html`**
  `node -e "const fs = require('fs'); const content = fs.readFileSync('static/index.html', 'utf8'); ..."`
- [ ] **Step 5: Commit**
  `git commit -m "feat(mindmap): add mindmap links in parent LinkPickerModal and Outline mode"`

---

### Task 4: Service Worker Cache Bump, Iframe Bump & Full Suite Verification

**Files:**
- Modify: `static/sw.js`
- Modify: `static/index.html`

- [ ] **Step 1: Bump SW Cache & Iframe Version**
  - In `static/sw.js`: bump CACHE to `taskflow-v241-mindmap-submap-linking`.
  - In `static/index.html`: bump iframe src query to `?v=137`.
- [ ] **Step 2: Run full test suite**
  - `npm test`
  - `python -m pytest tests/`
- [ ] **Step 3: Commit and Push**
  - `git commit -m "chore(sw): bump cache to taskflow-v241-mindmap-submap-linking and iframe to v=137"`
  - `git push origin main`
