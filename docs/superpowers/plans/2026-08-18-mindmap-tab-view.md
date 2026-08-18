# Mindmap Multi-Tab View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement multi-tab view capability for MindmapPage (up to 5 mindmaps simultaneously) with instant tab switching using multi-iframe instances.

**Architecture:** A standalone helper module `static/offline/mindmaptabs.js` handles pure tab array operations (open, close, rename, 5-tab eviction rule) with 100% unit test coverage. `MindmapPage` in `static/index.html` uses `openTabs` state to render multiple `.mindmap-tab-view-instance` DOM elements, showing the active tab (`display: flex`) and hiding inactive tabs (`display: none`).

**Tech Stack:** React, Vanilla JS (UMD module), CSS, Service Worker, Node.js unit tests (`node --test` or `npm test`).

## Global Constraints

- **Max open tabs:** 5 (oldest evicted when 6th is opened).
- **Service Worker Cache:** Bump cache name in `static/sw.js` whenever static assets change.
- **Module format:** UMD wrapper for `static/offline/mindmaptabs.js` to work in Node test & browser `TF.mindmaptabs`.
- **Existing tests:** All 406 existing tests must remain 100% passing.

---

### Task 1: Tab Management Helper Module & Unit Tests (TDD)

**Files:**
- Create: `static/offline/mindmaptabs.js`
- Create: `tests/offline/mindmaptabs.test.js`

**Interfaces:**
- Produces: `TF.mindmaptabs` (or CommonJS `exports.mindmaptabs`):
  - `openTab(tabs, mindmap, max = 5)` -> `{ tabs: Array, activeTabId: string }`
  - `closeTab(tabs, activeTabId, targetId)` -> `{ tabs: Array, activeTabId: string|null }`
  - `updateTabTitle(tabs, mindmapId, newTitle)` -> `Array`

- [ ] **Step 1: Write failing unit test suite for mindmaptabs**

Create `tests/offline/mindmaptabs.test.js`:
```javascript
const assert = require("assert");
const { test, describe } = require("node:test");
const { mindmaptabs } = require("../../static/offline/mindmaptabs.js");

describe("mindmaptabs helper module", () => {
  test("openTab adds new tab and sets activeTabId", () => {
    const res = mindmaptabs.openTab([], { id: "m1", title: "Mindmap 1" });
    assert.strictEqual(res.tabs.length, 1);
    assert.strictEqual(res.activeTabId, "m1");
  });

  test("openTab switches activeTabId if tab already open", () => {
    const initial = [{ id: "m1", title: "M1" }, { id: "m2", title: "M2" }];
    const res = mindmaptabs.openTab(initial, { id: "m1", title: "M1" });
    assert.strictEqual(res.tabs.length, 2);
    assert.strictEqual(res.activeTabId, "m1");
  });

  test("openTab evicts oldest tab when capacity (max 5) reached", () => {
    const initial = [
      { id: "m1", title: "M1" },
      { id: "m2", title: "M2" },
      { id: "m3", title: "M3" },
      { id: "m4", title: "M4" },
      { id: "m5", title: "M5" }
    ];
    const res = mindmaptabs.openTab(initial, { id: "m6", title: "M6" }, 5);
    assert.strictEqual(res.tabs.length, 5);
    assert.strictEqual(res.tabs[0].id, "m2");
    assert.strictEqual(res.tabs[4].id, "m6");
    assert.strictEqual(res.activeTabId, "m6");
  });

  test("closeTab removes target tab and activates neighbor tab", () => {
    const initial = [{ id: "m1" }, { id: "m2" }, { id: "m3" }];
    const res = mindmaptabs.closeTab(initial, "m2", "m2");
    assert.strictEqual(res.tabs.length, 2);
    assert.strictEqual(res.activeTabId, "m3");
  });

  test("closeTab keeps activeTabId if closed tab was not active", () => {
    const initial = [{ id: "m1" }, { id: "m2" }, { id: "m3" }];
    const res = mindmaptabs.closeTab(initial, "m1", "m2");
    assert.strictEqual(res.tabs.length, 2);
    assert.strictEqual(res.activeTabId, "m1");
  });

  test("updateTabTitle updates specific tab title", () => {
    const initial = [{ id: "m1", title: "Old Title" }];
    const updated = mindmaptabs.updateTabTitle(initial, "m1", "New Title");
    assert.strictEqual(updated[0].title, "New Title");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/offline/mindmaptabs.test.js`
Expected: FAIL with `Cannot find module '../../static/offline/mindmaptabs.js'`

- [ ] **Step 3: Implement `static/offline/mindmaptabs.js`**

Create `static/offline/mindmaptabs.js`:
```javascript
(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = { mindmaptabs: factory() };
  } else {
    root.TF = root.TF || {};
    root.TF.mindmaptabs = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function openTab(tabs = [], mindmap, max = 5) {
    if (!mindmap || !mindmap.id) return { tabs, activeTabId: null };
    const existsIndex = tabs.findIndex(t => t.id === mindmap.id);
    if (existsIndex >= 0) {
      return { tabs, activeTabId: mindmap.id };
    }
    let nextTabs = [...tabs, mindmap];
    if (nextTabs.length > max) {
      nextTabs = nextTabs.slice(nextTabs.length - max);
    }
    return { tabs: nextTabs, activeTabId: mindmap.id };
  }

  function closeTab(tabs = [], activeTabId, targetId) {
    const index = tabs.findIndex(t => t.id === targetId);
    if (index === -1) return { tabs, activeTabId };

    const nextTabs = tabs.filter(t => t.id !== targetId);
    let nextActiveId = activeTabId;

    if (activeTabId === targetId) {
      if (nextTabs.length === 0) {
        nextActiveId = null;
      } else {
        const newActiveIdx = Math.min(index, nextTabs.length - 1);
        nextActiveId = nextTabs[newActiveIdx].id;
      }
    }

    return { tabs: nextTabs, activeTabId: nextActiveId };
  }

  function updateTabTitle(tabs = [], mindmapId, newTitle) {
    return tabs.map(t => (t.id === mindmapId ? { ...t, title: newTitle } : t));
  }

  return {
    openTab,
    closeTab,
    updateTabTitle
  };
}));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/offline/mindmaptabs.test.js`
Expected: PASS (6 tests passed)

- [ ] **Step 5: Commit**

```bash
git add static/offline/mindmaptabs.js tests/offline/mindmaptabs.test.js
git commit -m "feat(mindmap): add mindmaptabs helper module with unit tests"
```

---

### Task 2: Script Tag & SW STATIC Assets Registration

**Files:**
- Modify: `static/index.html` (script tag insertion)
- Modify: `static/sw.js` (STATIC assets list insertion)

- [ ] **Step 1: Add script tag to `static/index.html`**

Locate `<script src="/static/offline/mindmapops.js"></script>` in `static/index.html` and add:
```html
<script src="/static/offline/mindmaptabs.js"></script>
```

- [ ] **Step 2: Add static path to `static/sw.js`**

Add `"/static/offline/mindmaptabs.js"` to the `STATIC` array in `static/sw.js`.

- [ ] **Step 3: Verify syntax & run tests**

Run: `node --check static/sw.js`
Run: `npm test`
Expected: Exit code 0, all tests PASS.

- [ ] **Step 4: Commit**

```bash
git add static/index.html static/sw.js
git commit -m "feat(mindmap): register mindmaptabs script tag and SW asset"
```

---

### Task 3: Markup & CSS Styling for Mindmap Tab Bar

**Files:**
- Modify: `static/app.css` (tab bar CSS rules)

- [ ] **Step 1: Add CSS rules in `static/app.css`**

Add the following CSS rules to `static/app.css`:
```css
/* Mindmap Multi-Tab Bar */
.mindmap-tab-bar {
  display: flex;
  align-items: center;
  background-color: var(--bg-secondary, #f3f4f6);
  border-bottom: 1px solid var(--border-color, #e5e7eb);
  overflow-x: auto;
  flex-shrink: 0;
  height: 38px;
  padding: 0 4px;
  gap: 2px;
}
.dark .mindmap-tab-bar {
  background-color: var(--bg-secondary, #1f2937);
  border-bottom-color: var(--border-color, #374151);
}
.mindmap-tab-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  height: 30px;
  border-radius: 6px 6px 0 0;
  font-size: 13px;
  color: var(--text-secondary, #4b5563);
  cursor: pointer;
  user-select: none;
  max-width: 180px;
  transition: background-color 0.15s ease, color 0.15s ease;
}
.dark .mindmap-tab-item {
  color: var(--text-secondary, #9ca3af);
}
.mindmap-tab-item:hover {
  background-color: rgba(0, 0, 0, 0.05);
  color: var(--text-primary, #111827);
}
.dark .mindmap-tab-item:hover {
  background-color: rgba(255, 255, 255, 0.08);
  color: var(--text-primary, #f9fafb);
}
.mindmap-tab-item.active {
  background-color: var(--bg-primary, #ffffff);
  color: var(--accent-color, #84cc16);
  font-weight: 600;
  border-bottom: 2px solid var(--accent-color, #84cc16);
}
.dark .mindmap-tab-item.active {
  background-color: var(--bg-primary, #111827);
  color: var(--accent-color, #a3e635);
  border-bottom-color: var(--accent-color, #a3e635);
}
.mindmap-tab-title {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.mindmap-tab-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: none;
  background: transparent;
  color: currentColor;
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
  opacity: 0.6;
}
.mindmap-tab-close:hover {
  opacity: 1;
  background-color: rgba(0, 0, 0, 0.1);
}
.dark .mindmap-tab-close:hover {
  background-color: rgba(255, 255, 255, 0.15);
}
.mindmap-tab-contents {
  flex: 1;
  display: flex;
  flex-direction: column;
  position: relative;
  overflow: hidden;
  height: 100%;
}
.mindmap-tab-view-instance {
  flex: 1;
  flex-direction: column;
  height: 100%;
  width: 100%;
}
```

- [ ] **Step 2: Run test suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add static/app.css
git commit -m "style(mindmap): add css styles for mindmap tab bar"
```

---

### Task 4: MindmapPage Multi-Instance Integration

**Files:**
- Modify: `static/index.html` (`MindmapPage` component refactoring)

- [ ] **Step 1: Update MindmapPage component to manage `openTabs` & `activeTabId`**

In `static/index.html`, update `MindmapPage`:
1. Use `openTabs` state (initial `[]`) and `activeTabId` state.
2. Define `openTab` helper calling `TF.mindmaptabs.openTab`:
```javascript
const selectMindmap = (mm) => {
  if (!mm || !mm.id) return;
  setOpenTabs(prev => {
    const res = (window.TF?.mindmaptabs || TF.mindmaptabs).openTab(prev, mm, 5);
    setActiveTabId(res.activeTabId);
    return res.tabs;
  });
};
```
3. Define `closeTab` helper calling `TF.mindmaptabs.closeTab`.
4. Render `.mindmap-tab-bar` inside `.mindmap-main` before tab instances:
```javascript
/* Tab Bar */
openTabs.length > 0 && React.createElement("div", { className: "mindmap-tab-bar" },
  openTabs.map(tab => {
    const isActive = tab.id === activeTabId;
    return React.createElement("div", {
      key: tab.id,
      className: `mindmap-tab-item${isActive ? ' active' : ''}`,
      onClick: () => setActiveTabId(tab.id),
      title: tab.title || "(tanpa judul)"
    },
      React.createElement("span", { className: "mindmap-tab-title" }, tab.title || "(tanpa judul)"),
      React.createElement("button", {
        className: "mindmap-tab-close",
        onClick: (e) => { e.stopPropagation(); closeTab(tab.id); },
        title: "Tutup tab"
      }, "×")
    );
  })
)
```
5. Wrap single mindmap editor view in `.mindmap-tab-contents`, rendering each `tab` in `openTabs` with `display: tab.id === activeTabId ? "flex" : "none"`.
6. Update delete mindmap handler: call `closeTab(deletedId)` to clean up deleted tab.
7. Update rename mindmap handler: call `updateTabTitle` to update tab title.

- [ ] **Step 2: Check inline script syntax and run test suite**

Run: `node temporary_files/check_inline_scripts.js static/index.html` (if exists) or parse check.
Run: `npm test`
Expected: All tests PASS.

- [ ] **Step 3: Commit**

```bash
git add static/index.html
git commit -m "feat(mindmap): integrate multi-tab view and multi-instance tabs in MindmapPage"
```

---

### Task 5: Service Worker Cache Bump & Full System Verification

**Files:**
- Modify: `static/sw.js` (bump cache version)

- [ ] **Step 1: Bump SW Cache Version**

In `static/sw.js`, update line 1:
```javascript
const CACHE_NAME = "taskflow-v237-mindmap-multi-tab";
```

- [ ] **Step 2: Run full test suite**

Run: `npm test`
Expected: 406+ tests pass, 0 fail.

- [ ] **Step 3: Commit**

```bash
git add static/sw.js
git commit -m "chore(sw): bump cache to taskflow-v237-mindmap-multi-tab"
```
