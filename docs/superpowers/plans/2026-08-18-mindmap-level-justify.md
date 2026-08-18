# Mindmap Level-Justify Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the Mindmap Level-Justify feature to align child and sibling nodes in uniform depth columns (or rows for org charts) with a toolbar toggle chip.

**Architecture:** 
- A helper module `static/offline/mindmapjustify.js` provides depth-level grouping, dimension calculation, and DOM alignment functions with complete unit test coverage.
- The Iframe Mind-Elixir editor (`static/vendor/mind-elixir/index.html`) hooks into `applyLevelJustify` upon initial load, direction change, node editing, and `setJustify` postMessage events, followed by `mind.linkDiv()` SVG branch redraws.
- `MindmapTabInstance` in `static/index.html` renders the `[ ⇤⇥ Justify ]` chip button in the header toolbar, manages `justify` state, and persists it into `data_json.justify`.

**Tech Stack:** Vanilla JavaScript (ES6+), React 18, Mind-Elixir 5.15.1, Node.js Test Runner.

## Global Constraints

- Max 5 tabs capacity rule from existing tab system must remain intact.
- Backward compatibility: mindmaps without `justify` in `data_json` default to `justify: false`.
- Service worker cache must be bumped upon static asset changes to prevent stale cache on devices.
- Code style must match existing codebase conventions (UMD pattern for offline modules, standard React hooks).

---

### Task 1: Level-Justify Helper Module & Unit Tests (TDD)

**Files:**
- Create: `static/offline/mindmapjustify.js`
- Test: `tests/offline/mindmapjustify.test.js`

**Interfaces:**
- Produces:
  - `computeLevelMetrics(treeNode, isVertical)`: Computes maximum width or height at each tree depth level.
  - `applyLevelJustify(mapEl, isJustify, isVertical)`: Sets uniform `min-width` (or `min-height`) on `me-parent` elements per depth level.
  - `toggleJustify(current)`: Returns boolean toggled state.

- [ ] **Step 1: Write the failing unit tests in `tests/offline/mindmapjustify.test.js`**

```javascript
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const code = fs.readFileSync(path.join(process.cwd(), "static/offline/mindmapjustify.js"), "utf8");
const fn = new Function("module", "exports", code);
const moduleObj = { exports: {} };
fn(moduleObj, moduleObj.exports);
const TF = { mindmapjustify: moduleObj.exports.mindmapjustify || moduleObj.exports };

test("mindmapjustify: toggleJustify flips boolean", () => {
  assert.equal(TF.mindmapjustify.toggleJustify(false), true);
  assert.equal(TF.mindmapjustify.toggleJustify(true), false);
  assert.equal(TF.mindmapjustify.toggleJustify(undefined), true);
});

test("mindmapjustify: computeLevelMetrics traverses tree depth levels", () => {
  const tree = {
    id: "root",
    topic: "Root",
    children: [
      {
        id: "c1",
        topic: "Short",
        children: [
          { id: "c1_1", topic: "Very Long Grandchild Node Title" }
        ]
      },
      {
        id: "c2",
        topic: "A Much Longer Level 1 Topic",
        children: [
          { id: "c2_1", topic: "Child 2" }
        ]
      }
    ]
  };

  const metrics = TF.mindmapjustify.computeTreeDepths(tree);
  assert.equal(metrics.maxDepth, 2);
  assert.equal(metrics.byDepth[1].length, 2);
  assert.equal(metrics.byDepth[2].length, 2);
  assert.equal(metrics.byDepth[1][0].id, "c1");
  assert.equal(metrics.byDepth[1][1].id, "c2");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/offline/mindmapjustify.test.js`  
Expected: FAIL with Cannot find module or file not found.

- [ ] **Step 3: Create `static/offline/mindmapjustify.js` with UMD export**

```javascript
(function (root, factory) {
  if (typeof define === "function" && define.amd) {
    define([], factory);
  } else if (typeof module === "object" && module.exports) {
    module.exports = { mindmapjustify: factory() };
  } else {
    root.TF = root.TF || {};
    root.TF.mindmapjustify = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  function toggleJustify(current) {
    return !Boolean(current);
  }

  function computeTreeDepths(rootNode) {
    const byDepth = {};
    let maxDepth = 0;

    function traverse(node, depth) {
      if (!node) return;
      if (depth > 0) {
        if (!byDepth[depth]) byDepth[depth] = [];
        byDepth[depth].push(node);
        if (depth > maxDepth) maxDepth = depth;
      }
      if (Array.isArray(node.children)) {
        node.children.forEach(child => traverse(child, depth + 1));
      }
    }

    traverse(rootNode, 0);
    return { byDepth, maxDepth };
  }

  function applyLevelJustify(mapContainer, isJustify, isVertical) {
    if (!mapContainer) return;

    if (!isJustify) {
      const parents = mapContainer.querySelectorAll("me-parent");
      parents.forEach(p => {
        p.style.minWidth = "";
        p.style.minHeight = "";
      });
      return;
    }

    const levels = new Map();

    function traverseDOM(wrapper, depth) {
      const parentEl = wrapper.querySelector(":scope > me-parent");
      const tpcEl = parentEl ? parentEl.querySelector(":scope > me-tpc") : null;
      if (parentEl && tpcEl) {
        if (!levels.has(depth)) levels.set(depth, []);
        levels.get(depth).push({ parentEl, tpcEl });
      }
      const childrenEl = wrapper.querySelector(":scope > me-children");
      if (childrenEl) {
        const childWrappers = childrenEl.querySelectorAll(":scope > me-wrapper");
        childWrappers.forEach(cw => traverseDOM(cw, depth + 1));
      }
    }

    const mainWrappers = mapContainer.querySelectorAll("me-main > me-wrapper");
    mainWrappers.forEach(mw => traverseDOM(mw, 1));

    levels.forEach(nodes => {
      if (isVertical) {
        let maxH = 0;
        nodes.forEach(n => {
          n.parentEl.style.minHeight = "";
          maxH = Math.max(maxH, n.tpcEl.offsetHeight || 0);
        });
        if (maxH > 0) {
          nodes.forEach(n => {
            n.parentEl.style.minHeight = maxH + "px";
          });
        }
      } else {
        let maxW = 0;
        nodes.forEach(n => {
          n.parentEl.style.minWidth = "";
          maxW = Math.max(maxW, n.tpcEl.offsetWidth || 0);
        });
        if (maxW > 0) {
          nodes.forEach(n => {
            n.parentEl.style.minWidth = maxW + "px";
          });
        }
      }
    });
  }

  return {
    toggleJustify,
    computeTreeDepths,
    applyLevelJustify
  };
});
```

- [ ] **Step 4: Run unit test to verify it passes**

Run: `node --test tests/offline/mindmapjustify.test.js`  
Expected: PASS (2 tests pass).

- [ ] **Step 5: Commit**

```bash
git add static/offline/mindmapjustify.js tests/offline/mindmapjustify.test.js
git commit -m "feat(mindmap): add mindmapjustify helper module with unit tests"
```

---

### Task 2: Register Script Tags & Service Worker Static Assets

**Files:**
- Modify: `static/index.html:115-125`
- Modify: `static/sw.js:30-45`
- Modify: `static/vendor/mind-elixir/index.html:380-395`

**Interfaces:**
- Consumes: `static/offline/mindmapjustify.js`
- Produces: Global availability of `window.TF.mindmapjustify` across main app and mind-elixir iframe.

- [ ] **Step 1: Include `mindmapjustify.js` script tag in `static/index.html`**

Insert `<script src="/static/offline/mindmapjustify.js"></script>` next to `mindmaptabs.js`.

- [ ] **Step 2: Include `mindmapjustify.js` script tag in `static/vendor/mind-elixir/index.html`**

Insert `<script src="/static/offline/mindmapjustify.js?v=1"></script>` next to `mindmapops.js`.

- [ ] **Step 3: Register `"/static/offline/mindmapjustify.js"` in `STATIC` array in `static/sw.js`**

- [ ] **Step 4: Verify test suite**

Run: `npm test`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add static/index.html static/sw.js static/vendor/mind-elixir/index.html
git commit -m "feat(mindmap): register mindmapjustify script tags and SW static asset"
```

---

### Task 3: Layout Engine Level-Justify in Mind-Elixir Iframe

**Files:**
- Modify: `static/vendor/mind-elixir/index.html`

**Interfaces:**
- Consumes: `window.TF.mindmapjustify.applyLevelJustify`
- Produces: Real-time columnar/row alignment and `mind.linkDiv()` redraws upon `setJustify`, `load`, and mutation events.

- [ ] **Step 1: Implement `applyJustifyLayout` helper in `static/vendor/mind-elixir/index.html`**

```javascript
let isJustifyActive = false;

function applyJustifyLayout() {
  if (!mind || !mind.map) return;
  const isVertical = mind.direction === 3;
  if (window.TF && window.TF.mindmapjustify) {
    window.TF.mindmapjustify.applyLevelJustify(mind.map, isJustifyActive, isVertical);
  }
  try {
    mind.linkDiv();
  } catch (_) {}
}
```

- [ ] **Step 2: Handle `setJustify` and initial `load` message with `justify` flag**

In the `window.addEventListener('message')` handler:
- In `ready` / `load`: parse `data.justify` and set `isJustifyActive = Boolean(e.data.data?.justify)`. Call `applyJustifyLayout()`.
- In `setJustify`: update `isJustifyActive = Boolean(e.data.justify)`, call `applyJustifyLayout()`, and post `change` message to parent with updated `justify` flag.
- In `operation` and `changeDirection` listeners: if `isJustifyActive`, trigger `applyJustifyLayout()`.

- [ ] **Step 3: Verify inline script syntax**

Run syntax validator: `node -e "const fs = require('fs'); const content = fs.readFileSync('static/vendor/mind-elixir/index.html', 'utf8'); const scripts = content.match(/<script[\s\S]*?>([\s\S]*?)<\/script>/gi); scripts.forEach(s => new Function(s.replace(/<script[\s\S]*?>/i, '').replace(/<\/script>/i, ''))); console.log('OK');"`  
Expected: OK.

- [ ] **Step 4: Commit**

```bash
git add static/vendor/mind-elixir/index.html
git commit -m "feat(mindmap): integrate level-justify engine and postMessage hooks in iframe"
```

---

### Task 4: UI Justify Toggle Chip in MindmapTabInstance

**Files:**
- Modify: `static/index.html` (inside `MindmapTabInstance`)

**Interfaces:**
- Consumes: `mindmapjustify.toggleJustify`
- Produces: Header toolbar chip button `[ ⇤⇥ Justify ]`, state management, and DB persistence into `data_json.justify`.

- [ ] **Step 1: Add `justify` state and handlers in `MindmapTabInstance`**

In `MindmapTabInstance`:
- Add state: `const [justify, setJustify] = useState(false);`
- In `useEffect` on `tab?.id`: parse `data.justify` from `tab.data_json`, set `setJustify(Boolean(data && data.justify))`.
- Send `justify` in `sendLoad` message.

- [ ] **Step 2: Add `handleToggleJustify` callback**

```javascript
const handleToggleJustify = () => {
  const next = !justify;
  setJustify(next);
  if (outlineTree) {
    const updatedTree = { ...outlineTree, justify: next };
    setOutlineTree(updatedTree);
    scheduleSave(tab.id, JSON.stringify(updatedTree));
  }
  iframeRef.current?.contentWindow?.postMessage({
    type: "setJustify",
    justify: next
  }, window.location.origin);
};
```

- [ ] **Step 3: Render Justify chip button in toolbar header**

Next to the direction button group `MINDMAP_DIRECTIONS.map(...)`:
```javascript
/*#__PURE__*/React.createElement("button", {
  onClick: handleToggleJustify,
  title: justify ? "Matikan perataan kolom (Justify)" : "Ratakan kolom/baris per level (Justify)",
  style: {
    border: justify ? "1px solid var(--accent)" : "1px solid var(--border)",
    background: justify ? "var(--accent)" : "var(--bg-card)",
    color: justify ? "#000" : "var(--text-secondary)",
    borderRadius: 6,
    padding: "3px 8px",
    fontSize: 11,
    fontWeight: 600,
    cursor: "pointer",
    flexShrink: 0
  }
}, "⇤⇥ Justify")
```

- [ ] **Step 4: Verify JS syntax in `static/index.html`**

Run AST syntax check on `static/index.html`.  
Expected: All 52 scripts OK.

- [ ] **Step 5: Commit**

```bash
git add static/index.html
git commit -m "feat(mindmap): add justify toggle chip button in MindmapTabInstance toolbar"
```

---

### Task 5: Service Worker Cache Bump & Full Suite Verification

**Files:**
- Modify: `static/sw.js`
- Modify: `static/index.html`

**Interfaces:**
- Consumes: Updated static assets.
- Produces: Service Worker cache bump to `taskflow-v239-mindmap-level-justify` and iframe bump `?v=136`.

- [ ] **Step 1: Bump SW cache version in `static/sw.js`**

Change `CACHE` from `"taskflow-v238-mindmap-multi-tab-syntax-fix"` to `"taskflow-v239-mindmap-level-justify"`.

- [ ] **Step 2: Bump iframe version query parameter in `static/index.html`**

Change `src: "/static/vendor/mind-elixir/index.html?v=135"` to `?v=136`.

- [ ] **Step 3: Run full test suite**

Run: `npm test`  
Expected: 414/414 PASS (0 fail).

- [ ] **Step 4: Commit**

```bash
git add static/sw.js static/index.html
git commit -m "chore(sw): bump cache to taskflow-v239-mindmap-level-justify"
```
