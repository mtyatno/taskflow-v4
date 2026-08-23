# Milkdown Table Column Resizing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable interactive drag-to-resize table columns with visual resize handles and custom styling inside the Milkdown Note Editor.

**Architecture:** Integrate `prosemirror-tables` column resize CSS and grip styling into `static/app.css`, ensuring seamless integration with existing `@milkdown/preset-gfm` `columnResizingPlugin`, dark mode, and paper mode while keeping pure Markdown GFM storage format.

**Tech Stack:** JavaScript, Milkdown v7, ProseMirror (`prosemirror-tables`), CSS3, Node.js test runner.

## Global Constraints
- **Mode**: Interactive WYSIWYG (no raw HTML `<table>` serialization, format remains standard GFM `| col | col |`).
- **Styles**: Must support Light Theme, Dark Theme (`[data-theme="dark"]`), and Paper Mode (`.paper-mode-active`).
- **Tests**: All 448+ JS unit tests and 43 backend pytest tests must pass with 0 regressions.

---

### Task 1: CSS Integration for Table Column Resizing & Selection

**Files:**
- Create: `tests/offline/table_resizing.test.js`
- Modify: `static/app.css:1225-1250`

**Interfaces:**
- Consumes: `@milkdown/preset-gfm` table nodes (`table`, `table_row`, `table_cell`, `table_header`) and `columnResizingPlugin` DOM markers (`.column-resize-handle`, `.resize-cursor`, `.selectedCell`).
- Produces: Polished interactive column resizing grip and cell selection styles.

- [ ] **Step 1: Write the failing test**

Create `tests/offline/table_resizing.test.js`:
```javascript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

describe('Milkdown Table Column Resizing CSS', () => {
  const cssPath = path.resolve('static/app.css');
  const css = fs.readFileSync(cssPath, 'utf8');

  it('contains .tableWrapper with horizontal scroll styling', () => {
    assert.match(css, /\.tableWrapper\s*\{[^}]*overflow-x:\s*auto/);
  });

  it('contains table with fixed layout for proportional resizing', () => {
    assert.match(css, /\.milkdown-editor\s+\.ProseMirror\s+table\s*\{[^}]*table-layout:\s*fixed/);
  });

  it('contains cell positioning for relative resize handle placement', () => {
    assert.match(css, /\.milkdown-editor\s+\.ProseMirror\s+td[^}]*position:\s*relative/);
  });

  it('contains .column-resize-handle with col-resize grip styling', () => {
    assert.match(css, /\.column-resize-handle\s*\{[^}]*position:\s*absolute/);
    assert.match(css, /\.column-resize-handle\s*\{[^}]*right:\s*-2px/);
  });

  it('contains .resize-cursor rule', () => {
    assert.match(css, /\.resize-cursor\s*\{[^}]*cursor:\s*col-resize/);
  });

  it('contains .selectedCell selection overlay', () => {
    assert.match(css, /\.selectedCell:after\s*\{[^}]*position:\s*absolute/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/offline/table_resizing.test.js`
Expected: FAIL (CSS rules not yet present in `static/app.css`)

- [ ] **Step 3: Add Table Column Resizing CSS to `static/app.css`**

Add in `static/app.css`:
```css
/* ── Milkdown Table Column Resizing & Selection ── */
.milkdown-editor .ProseMirror .tableWrapper {
  overflow-x: auto;
  margin: 12px 0;
  max-width: 100%;
}
.milkdown-editor .ProseMirror table {
  border-collapse: collapse;
  table-layout: fixed;
  width: 100%;
  overflow: hidden;
}
.milkdown-editor .ProseMirror td,
.milkdown-editor .ProseMirror th {
  vertical-align: top;
  box-sizing: border-box;
  position: relative;
}
.milkdown-editor .ProseMirror .column-resize-handle {
  position: absolute;
  right: -2px;
  top: 0;
  bottom: 0;
  width: 4px;
  z-index: 20;
  background-color: var(--accent, #3b82f6);
  opacity: 0.85;
  pointer-events: none;
  border-radius: 2px;
}
.milkdown-editor .ProseMirror.resize-cursor,
.milkdown-editor .ProseMirror.resize-cursor * {
  cursor: col-resize !important;
}
.milkdown-editor .ProseMirror .selectedCell:after {
  z-index: 2;
  position: absolute;
  content: '';
  left: 0;
  right: 0;
  top: 0;
  bottom: 0;
  background: rgba(59, 130, 246, 0.2);
  pointer-events: none;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/offline/table_resizing.test.js`
Expected: PASS (All 6 assertions pass)

- [ ] **Step 5: Commit**

```bash
git add tests/offline/table_resizing.test.js static/app.css
git commit -m "feat(table): add prosemirror table column resizing and cell selection styles"
```

---

### Task 2: Service Worker Cache Bump & Full Regression Suite

**Files:**
- Modify: `static/sw.js:1`
- Update: `.agents/CURRENT_STATE.md` & `.agents/SESSION_LOG.md`

- [ ] **Step 1: Bump Cache Version in `static/sw.js`**

Update `static/sw.js`:
```javascript
const CACHE = "taskflow-v287-table-column-resizing";
```

- [ ] **Step 2: Run Full Test Suite**

Run:
```bash
node --check static/sw.js
node --test tests/offline/*.test.js
python -m pytest tests/
```
Expected: All tests pass (0 failures).

- [ ] **Step 3: Commit and Document**

```bash
git add static/sw.js .agents/CURRENT_STATE.md .agents/SESSION_LOG.md
git commit -m "chore(sw): bump cache to v287 for table column resizing feature"
```
