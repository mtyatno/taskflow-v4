# Mindmap Outline Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an outline mode — a fully editable hierarchical text view of the mindmap tree that stays in sync with the mind-elixir canvas.

**Architecture:** Pure transform helpers live in a new UMD module (`static/offline/mindmapoutline.js`), unit-tested with node --test. The React parent (`MindmapPage` in `static/index.html`) becomes the single source of truth for the tree: canvas edits arrive via the existing `change` postMessage, outline edits run a transform and post a new `refresh` message back to the iframe (handled by `mind.refresh(data)` — verified to exist in the vendored IIFE and to not fire the `operation` event, so no echo loop). The iframe stays mounted (hidden) during outline mode so canvas zoom/position survive mode switches.

**Tech Stack:** Vanilla JS + React (via compiled `React.createElement` style — no JSX in this file), mind-elixir IIFE in iframe, node:test for unit tests, existing `api.put` save pipeline with local-first offline intercept.

**Spec:** `docs/superpowers/specs/2026-08-15-mindmap-outline-mode-design.md`

## Global Constraints

- All postMessage handlers keep the existing `e.origin !== window.location.origin` guard.
- Every transform must preserve all node fields it does not intentionally change (`links`, `expanded`, `direction`, unknown fields). No field may be dropped.
- Root invariants: root cannot be deleted, outdented, indented, moved, or drag-reordered; duplicating root inserts the copy as the **first child**; copying root (Ctrl+C) is disabled.
- `expanded` convention (mind-elixir): `expanded === false` means collapsed, anything else means expanded. Outline collapse reuses this field, so collapse state syncs with canvas for free.
- Tree shape = `mind.getData()` shape: `{ nodeData: {id, topic, root, children[], links[]}, arrows?, summaries?, theme? }`. The outline component receives `nodeData` root only; parent merges edits back into the full object.
- Save pipeline unchanged: debounced 1000 ms `api.put('/api/mindmaps/:id', { data_json })`; no backend, schema, or offline-router changes.
- `static/index.html` in git is the compiled form — write plain JS + `React.createElement` (no JSX). `compile.js` is a no-op on this file (no `<script type="text/babel">` block).
- New module must use the repo UMD pattern (see `static/offline/mindmaprepo.js` header) so it works in both browser (`window.TF.mindmapoutline`) and node (`require`).
- UI copy in Indonesian, matching existing UI.
- Tests: `node --test` in `tests/offline/` (auto-included by `npm test` glob `tests/offline/*.test.js`). On this machine (drive Z:) node --test is slow — always run the targeted file first, then the full suite once at the end. Do not trust reported test counts from memory; read the summary line of the run you just executed.
- SW cache: add the new module to the `STATIC` list in `static/sw.js` (Task 2) and bump the `CACHE` name (Task 6).
- iframe src version query must be bumped (`?v=118` → `?v=119`) in the same task that edits the vendor file (Task 3).
- Commit convention: `feat:`/`fix:` prefix, message ends with `Co-Authored-By: Claude <noreply@anthropic.com>`. Commit per task. Do NOT push — the user pushes when ready to deploy (VPS auto-deploys via git push).

---

### Task 1: Transform helpers module + unit tests

**Files:**
- Create: `static/offline/mindmapoutline.js`
- Test: `tests/offline/mindmapoutline.test.js`

**Interfaces:**
- Consumes: nothing (self-contained; own `uid()` — do NOT reference `genId` from index.html).
- Produces: `window.TF.mindmapoutline` (browser) / `require("../../static/offline/mindmapoutline.js")` (node) with these named exports:

| Export | Signature | Returns |
|---|---|---|
| `findNode` | `(root, id)` | `{node, parent, index}` \| `null` (root: `parent: null, index: -1`) |
| `addChild` | `(root, parentId, topic)` | `{tree, id}` — appends node, auto-expands parent |
| `addSibling` | `(root, id, after)` | `{tree, id}` — sibling of `id`; if `id` is root, appends a child of root instead |
| `renameNode` | `(root, id, topic)` | `root` (new tree) |
| `deleteNode` | `(root, id)` | `root` — no-op for root/missing |
| `duplicateNode` | `(root, id)` | `{tree, id}` — clone inserted after original; root → first child |
| `moveNode` | `(root, id, dir)` | `root` — `dir` `"up"`/`"down"`, swap with adjacent sibling; boundaries no-op |
| `moveSibling` | `(root, id, targetId, pos)` | `root` — drag-drop: remove `id`, insert `"before"`/`"after"` target; no-op if target is root, missing, same, or a descendant of `id` |
| `moveInto` | `(root, id, targetId)` | `root` — remove `id`, append as last child of target, expand target; same guards |
| `indentNode` | `(root, id)` | `root` — make last child of previous sibling; no-op root/first child |
| `outdentNode` | `(root, id)` | `root` — make sibling after parent; no-op root/top-level |
| `toggleExpand` | `(root, id)` | `root` — flip `expanded` |
| `expandAll` | `(root)` | `root` — `expanded: true` on every node with children |
| `collapseAll` | `(root)` | `root` — `expanded: false` on every node with children |
| `cloneSubtree` | `(node)` | `node` — deep clone, fresh ids recursively, `root: false`, `links` deep-copied |
| `insertSubtree` | `(root, parentId, subtree)` | `{tree, id}` — append `subtree` as child of `parentId`, auto-expand |
| `searchNodes` | `(root, query)` | `string[]` — DFS ids whose `topic` contains query (case-insensitive) |
| `ancestorsOf` | `(root, id)` | `string[]` — ancestor ids excluding the node itself; `[]` if not found |

- [ ] **Step 1: Write the failing tests**

Create `tests/offline/mindmapoutline.test.js`:

```js
"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const MO = require("../../static/offline/mindmapoutline.js");

const fixture = () => ({
  id: "root",
  topic: "Root",
  root: true,
  children: [
    {
      id: "a",
      topic: "Alpha",
      expanded: true,
      links: [{ type: "note", id: 1, title: "N" }],
      children: [{ id: "a1", topic: "A-one", x: "custom", children: [] }],
    },
    { id: "b", topic: "Beta", children: [] },
    { id: "c", topic: "Gamma", expanded: false, children: [{ id: "c1", topic: "C-one", children: [] }] },
  ],
});

const ids = (n) => [n.id, ...(n.children || []).flatMap(ids)].sort();

test("findNode returns node, parent, index; null when missing", () => {
  const t = fixture();
  const a1 = MO.findNode(t, "a1");
  assert.equal(a1.node.id, "a1");
  assert.equal(a1.parent.id, "a");
  assert.equal(a1.index, 0);
  const root = MO.findNode(t, "root");
  assert.equal(root.parent, null);
  assert.equal(root.index, -1);
  assert.equal(MO.findNode(t, "zzz"), null);
});

test("addChild appends node, auto-expands parent, returns fresh id", () => {
  const res = MO.addChild(fixture(), "b", "Baru");
  assert.notEqual(res.id, "b");
  assert.notEqual(res.id, "root");
  const b = MO.findNode(res.tree, "b").node;
  assert.equal(b.children.length, 1);
  assert.equal(b.children[0].topic, "Baru");
  assert.equal(b.children[0].id, res.id);
  assert.equal(b.expanded, true);
});

test("addSibling inserts before/after; root target appends child instead", () => {
  const after = MO.addSibling(fixture(), "a", true);
  assert.deepEqual(after.tree.children.map((c) => c.id), ["a", after.id, "b", "c"]);
  const before = MO.addSibling(fixture(), "a", false);
  assert.deepEqual(before.tree.children.map((c) => c.id), [before.id, "a", "b", "c"]);
  const atRoot = MO.addSibling(fixture(), "root", true);
  assert.equal(atRoot.tree.children[atRoot.tree.children.length - 1].id, atRoot.id);
});

test("renameNode changes topic and preserves all other fields", () => {
  const t = fixture();
  const res = MO.renameNode(t, "b", "Beta baru");
  assert.equal(MO.findNode(res, "b").node.topic, "Beta baru");
  assert.deepEqual(MO.findNode(res, "a").node.links, [{ type: "note", id: 1, title: "N" }]);
  assert.equal(MO.findNode(res, "c").node.expanded, false);
  assert.equal(MO.findNode(res, "a1").node.x, "custom");
});

test("deleteNode removes node; root is protected", () => {
  const res = MO.deleteNode(fixture(), "a1");
  assert.deepEqual(MO.findNode(res, "a").node.children, []);
  assert.equal(MO.findNode(res, "a1"), null);
  const rootDel = MO.deleteNode(fixture(), "root");
  assert.deepEqual(rootDel, fixture());
});

test("duplicateNode clones sibling after original; root duplicates as first child", () => {
  const t = fixture();
  const res = MO.duplicateNode(t, "a");
  assert.deepEqual(res.tree.children.map((c) => c.id), ["a", res.id, "b", "c"]);
  const copy = MO.findNode(res.tree, res.id).node;
  assert.equal(copy.topic, "Alpha");
  assert.equal(copy.id, res.id);
  assert.notEqual(copy.children[0].id, "a1"); // fresh ids recursively
  assert.deepEqual(copy.links, [{ type: "note", id: 1, title: "N" }]);
  assert.notEqual(copy.root, true);
  const rootDup = MO.duplicateNode(t, "root");
  assert.equal(rootDup.tree.children[0].id, rootDup.id);
  assert.equal(rootDup.tree.children[0].topic, "Root");
});

test("moveNode swaps with adjacent sibling; boundaries no-op", () => {
  const up = MO.moveNode(fixture(), "b", "up");
  assert.deepEqual(up.children.map((c) => c.id), ["b", "a", "c"]);
  const down = MO.moveNode(fixture(), "b", "down");
  assert.deepEqual(down.children.map((c) => c.id), ["a", "c", "b"]);
  assert.deepEqual(MO.moveNode(fixture(), "a", "up"), fixture());
  assert.deepEqual(MO.moveNode(fixture(), "c", "down"), fixture());
});

test("moveSibling repositions via drag-drop semantics; guards no-op", () => {
  const res = MO.moveSibling(fixture(), "b", "a", "before");
  assert.deepEqual(res.children.map((c) => c.id), ["b", "a", "c"]);
  const after = MO.moveSibling(fixture(), "b", "a", "after");
  assert.deepEqual(after.children.map((c) => c.id), ["a", "b", "c"]);
  // target inside dragged subtree -> no-op
  assert.deepEqual(MO.moveSibling(fixture(), "a", "a1", "after"), fixture());
  // root target -> no-op
  assert.deepEqual(MO.moveSibling(fixture(), "b", "root", "after"), fixture());
});

test("moveInto appends as child and expands target; guards no-op", () => {
  const res = MO.moveInto(fixture(), "c", "a");
  assert.deepEqual(MO.findNode(res, "a").node.children.map((c) => c.id), ["a1", "c"]);
  assert.deepEqual(res.children.map((c) => c.id), ["a", "b"]);
  assert.deepEqual(MO.moveInto(fixture(), "a", "a1"), fixture());
  assert.deepEqual(MO.moveInto(fixture(), "c", "root"), fixture()); // root cannot be moved
});

test("indentNode makes node last child of previous sibling; guards no-op", () => {
  const res = MO.indentNode(fixture(), "b");
  assert.deepEqual(MO.findNode(res, "a").node.children.map((c) => c.id), ["a1", "b"]);
  assert.deepEqual(res.children.map((c) => c.id), ["a", "c"]);
  assert.deepEqual(MO.indentNode(fixture(), "a"), fixture()); // first child
  assert.deepEqual(MO.indentNode(fixture(), "root"), fixture());
});

test("outdentNode makes node sibling after parent; guards no-op", () => {
  const res = MO.outdentNode(fixture(), "a1");
  assert.deepEqual(MO.findNode(res, "a").node.children, []);
  assert.deepEqual(res.children.map((c) => c.id), ["a", "a1", "b", "c"]);
  assert.deepEqual(MO.outdentNode(fixture(), "b"), fixture()); // top-level
  assert.deepEqual(MO.outdentNode(fixture(), "root"), fixture());
});

test("toggleExpand flips expanded", () => {
  assert.equal(MO.findNode(MO.toggleExpand(fixture(), "c"), "c").node.expanded, true);
  assert.equal(MO.findNode(MO.toggleExpand(fixture(), "a"), "a").node.expanded, false);
});

test("expandAll/collapseAll only touch nodes with children", () => {
  const ex = MO.expandAll(fixture());
  assert.equal(MO.findNode(ex, "a").node.expanded, true);
  assert.equal(MO.findNode(ex, "c").node.expanded, true);
  assert.equal("expanded" in MO.findNode(ex, "b").node, false);
  const col = MO.collapseAll(fixture());
  assert.equal(MO.findNode(col, "a").node.expanded, false);
  assert.equal(MO.findNode(col, "c").node.expanded, false);
});

test("cloneSubtree deep-copies with fresh ids and detached references", () => {
  const src = MO.findNode(fixture(), "a").node;
  const clone = MO.cloneSubtree(src);
  assert.equal(clone.topic, "Alpha");
  assert.notEqual(clone.id, "a");
  assert.notEqual(clone.children[0].id, "a1");
  assert.equal(clone.root, false);
  clone.children[0].topic = "MUTATED";
  clone.links.push({ type: "task", id: 9, title: "X" });
  const orig = MO.findNode(fixture(), "a").node;
  assert.equal(orig.children[0].topic, "A-one");
  assert.equal(orig.links.length, 1);
});

test("insertSubtree appends given subtree and auto-expands parent", () => {
  const t = fixture();
  const sub = MO.cloneSubtree(MO.findNode(t, "c").node);
  const res = MO.insertSubtree(t, "b", sub);
  assert.equal(MO.findNode(res.tree, "b").node.children.length, 1);
  assert.equal(MO.findNode(res.tree, "b").node.children[0].id, res.id);
  assert.equal(MO.findNode(res.tree, "b").node.children[0].topic, "Gamma");
  assert.equal(MO.findNode(res.tree, "b").node.expanded, true);
});

test("searchNodes matches case-insensitive substring in DFS order", () => {
  assert.deepEqual(MO.searchNodes(fixture(), "one"), ["a1", "c1"]);
  assert.deepEqual(MO.searchNodes(fixture(), "ROOT"), ["root"]);
  assert.deepEqual(MO.searchNodes(fixture(), "zzz"), []);
});

test("ancestorsOf returns ancestor ids excluding the node; [] when missing", () => {
  assert.deepEqual(MO.ancestorsOf(fixture(), "a1"), ["root", "a"]);
  assert.deepEqual(MO.ancestorsOf(fixture(), "a"), ["root"]);
  assert.deepEqual(MO.ancestorsOf(fixture(), "root"), []);
  assert.deepEqual(MO.ancestorsOf(fixture(), "zzz"), []);
});

test("export surface is complete", () => {
  const expected = [
    "findNode", "addChild", "addSibling", "renameNode", "deleteNode", "duplicateNode",
    "moveNode", "moveSibling", "moveInto", "indentNode", "outdentNode", "toggleExpand",
    "expandAll", "collapseAll", "cloneSubtree", "insertSubtree", "searchNodes", "ancestorsOf",
  ].sort();
  assert.deepEqual(Object.keys(MO).sort(), expected);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/offline/mindmapoutline.test.js`
Expected: FAIL — `Cannot find module '../../static/offline/mindmapoutline.js'`

- [ ] **Step 3: Write the module**

Create `static/offline/mindmapoutline.js`:

```js
;(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory(root);
  } else {
    root.TF = root.TF || {};
    root.TF.mindmapoutline = factory(root);
  }
})(typeof self !== "undefined" ? self : globalThis, function (root) {
  "use strict";

  const uid = () =>
    (typeof crypto !== "undefined" && crypto.randomUUID)
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2) + Date.now().toString(36);

  function findNode(root, id) {
    if (!root) return null;
    if (root.id === id) return { node: root, parent: null, index: -1 };
    const kids = root.children || [];
    for (let i = 0; i < kids.length; i++) {
      const found = findNode(kids[i], id);
      if (found) {
        if (!found.parent) return { ...found, parent: root, index: i };
        return found;
      }
    }
    return null;
  }

  function updateNode(root, id, updater) {
    if (!root) return root;
    if (root.id === id) return updater(root);
    if (!root.children || root.children.length === 0) return root;
    let changed = false;
    const children = root.children.map((c) => {
      const nc = updateNode(c, id, updater);
      if (nc !== c) changed = true;
      return nc;
    });
    return changed ? { ...root, children } : root;
  }

  const makeNode = (topic) => ({ id: uid(), topic: topic || "Node baru", children: [], expanded: true });

  function addChild(root, parentId, topic) {
    if (!findNode(root, parentId)) return { tree: root, id: null };
    const node = makeNode(topic);
    const tree = updateNode(root, parentId, (p) => ({
      ...p,
      expanded: true,
      children: [...(p.children || []), node],
    }));
    return { tree, id: node.id };
  }

  function addSibling(root, id, after) {
    const f = findNode(root, id);
    if (!f || !f.node) return { tree: root, id: null };
    if (!f.parent) return addChild(root, root.id, "Node baru"); // root -> append child
    const node = makeNode("Node baru");
    const idx = f.index + (after ? 1 : 0);
    const tree = updateNode(root, f.parent.id, (p) => ({
      ...p,
      children: [...p.children.slice(0, idx), node, ...p.children.slice(idx)],
    }));
    return { tree, id: node.id };
  }

  function renameNode(root, id, topic) {
    return updateNode(root, id, (n) => ({ ...n, topic }));
  }

  function deleteNode(root, id) {
    const f = findNode(root, id);
    if (!f || !f.node || f.node.root || !f.parent) return root;
    return updateNode(root, f.parent.id, (p) => ({
      ...p,
      children: p.children.filter((c) => c.id !== id),
    }));
  }

  function cloneSubtree(node) {
    return {
      ...node,
      id: uid(),
      root: false,
      children: (node.children || []).map(cloneSubtree),
      links: (node.links || []).map((l) => ({ ...l })),
    };
  }

  function duplicateNode(root, id) {
    const f = findNode(root, id);
    if (!f || !f.node) return { tree: root, id: null };
    const copy = cloneSubtree(f.node);
    if (!f.parent) {
      // root -> insert as first child
      const tree = updateNode(root, root.id, (r) => ({ ...r, children: [copy, ...(r.children || [])] }));
      return { tree, id: copy.id };
    }
    const idx = f.index + 1;
    const tree = updateNode(root, f.parent.id, (p) => ({
      ...p,
      children: [...p.children.slice(0, idx), copy, ...p.children.slice(idx)],
    }));
    return { tree, id: copy.id };
  }

  function moveNode(root, id, dir) {
    const f = findNode(root, id);
    if (!f || !f.node || f.node.root || !f.parent) return root;
    const kids = f.parent.children;
    const idx = f.index;
    const swapIdx = dir === "up" ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= kids.length) return root;
    const children = [...kids];
    const tmp = children[idx];
    children[idx] = children[swapIdx];
    children[swapIdx] = tmp;
    return updateNode(root, f.parent.id, (p) => ({ ...p, children }));
  }

  function moveSibling(root, id, targetId, pos) {
    if (id === targetId) return root;
    if (ancestorsOf(root, targetId).indexOf(id) !== -1) return root;
    const src = findNode(root, id);
    if (!src || !src.node || src.node.root) return root;
    const tgt = findNode(root, targetId);
    if (!tgt || !tgt.node || tgt.node.root || !tgt.parent) return root;
    const without = deleteNode(root, id);
    const t2 = findNode(without, targetId);
    const idx = t2.index + (pos === "before" ? 0 : 1);
    return updateNode(without, t2.parent.id, (p) => ({
      ...p,
      children: [...p.children.slice(0, idx), src.node, ...p.children.slice(idx)],
    }));
  }

  function moveInto(root, id, targetId) {
    if (id === targetId) return root;
    if (ancestorsOf(root, targetId).indexOf(id) !== -1) return root;
    const src = findNode(root, id);
    if (!src || !src.node || src.node.root) return root;
    const tgt = findNode(root, targetId);
    if (!tgt || !tgt.node || tgt.node.root) return root;
    const without = deleteNode(root, id);
    return updateNode(without, targetId, (p) => ({
      ...p,
      expanded: true,
      children: [...(p.children || []), src.node],
    }));
  }

  function indentNode(root, id) {
    const f = findNode(root, id);
    if (!f || !f.node || f.node.root || !f.parent) return root;
    if (f.index === 0) return root; // no previous sibling
    const prev = f.parent.children[f.index - 1];
    const without = deleteNode(root, id);
    return updateNode(without, prev.id, (p) => ({
      ...p,
      expanded: true,
      children: [...(p.children || []), f.node],
    }));
  }

  function outdentNode(root, id) {
    const f = findNode(root, id);
    if (!f || !f.node || f.node.root || !f.parent) return root;
    const parentOfParent = findNode(root, f.parent.id).parent;
    if (!parentOfParent) return root; // top-level child
    const without = deleteNode(root, id);
    const pp = findNode(without, parentOfParent.id);
    const idx = pp.node.children.findIndex((c) => c.id === f.parent.id) + 1;
    return updateNode(without, parentOfParent.id, (p) => ({
      ...p,
      children: [...p.children.slice(0, idx), f.node, ...p.children.slice(idx)],
    }));
  }

  function toggleExpand(root, id) {
    return updateNode(root, id, (n) => ({ ...n, expanded: n.expanded === false }));
  }

  function mapAll(root, fn) {
    const mapped = fn(root);
    return {
      ...mapped,
      children: (mapped.children || []).map((c) => mapAll(c, fn)),
    };
  }

  function expandAll(root) {
    return mapAll(root, (n) => ((n.children || []).length > 0 ? { ...n, expanded: true } : n));
  }

  function collapseAll(root) {
    return mapAll(root, (n) => ((n.children || []).length > 0 ? { ...n, expanded: false } : n));
  }

  function insertSubtree(root, parentId, subtree) {
    if (!findNode(root, parentId)) return { tree: root, id: null };
    const tree = updateNode(root, parentId, (p) => ({
      ...p,
      expanded: true,
      children: [...(p.children || []), subtree],
    }));
    return { tree, id: subtree.id };
  }

  function searchNodes(root, query) {
    const ql = String(query || "").toLowerCase();
    const out = [];
    (function walk(n) {
      if (String(n.topic || "").toLowerCase().indexOf(ql) !== -1) out.push(n.id);
      (n.children || []).forEach(walk);
    })(root);
    return out;
  }

  function ancestorsOf(root, id) {
    const f = findNode(root, id);
    if (!f) return [];
    const out = [];
    let p = f.parent;
    while (p) {
      out.push(p.id);
      const pf = findNode(root, p.id);
      p = pf ? pf.parent : null;
    }
    return out.reverse();
  }

  return {
    findNode, addChild, addSibling, renameNode, deleteNode, duplicateNode,
    moveNode, moveSibling, moveInto, indentNode, outdentNode, toggleExpand,
    expandAll, collapseAll, cloneSubtree, insertSubtree, searchNodes, ancestorsOf,
  };
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/offline/mindmapoutline.test.js`
Expected: PASS — 17/17 (or the count the runner reports), 0 failures.

- [ ] **Step 5: Sanity-check the export surface in node**

Run: `node -e "const MO=require('./static/offline/mindmapoutline.js'); console.log(Object.keys(MO).length + ' exports')"`
Expected: `18 exports`

- [ ] **Step 6: Commit**

```bash
git add static/offline/mindmapoutline.js tests/offline/mindmapoutline.test.js
git commit -m "feat(mindmap): add outline transform helpers module with unit tests

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 2: Register the module (script tag + SW static list)

**Files:**
- Modify: `static/index.html` (script tag block near line 118)
- Modify: `static/sw.js` (STATIC array, after `"/static/offline/mindmaproutes.js"` line 37)

**Interfaces:**
- Consumes: `static/offline/mindmapoutline.js` (Task 1).
- Produces: `window.TF.mindmapoutline` available to the main script at load time (script tag loads BEFORE the main `<script>` block — UMD load-order requirement); module precached by SW.

- [ ] **Step 1: Add the script tag**

In `static/index.html`, find:

```html
  <script src="/static/offline/mindmaprepo.js"></script>
  <script src="/static/offline/mindmaproutes.js"></script>
```

Insert BEFORE the `mindmaprepo.js` line:

```html
  <script src="/static/offline/mindmapoutline.js"></script>
```

- [ ] **Step 2: Add to SW STATIC list**

In `static/sw.js`, find:

```js
  "/static/offline/mindmaprepo.js",
  "/static/offline/mindmaproutes.js",
```

Replace with:

```js
  "/static/offline/mindmapoutline.js",
  "/static/offline/mindmaprepo.js",
  "/static/offline/mindmaproutes.js",
```

- [ ] **Step 3: Verify no syntax errors**

Run: `node --check static/offline/mindmapoutline.js && node --check static/sw.js`
Expected: no output, exit 0.

- [ ] **Step 4: Commit**

```bash
git add static/index.html static/sw.js
git commit -m "feat(mindmap): register mindmapoutline module in page and service worker

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 3: iframe `refresh` message handler + cache version bump

**Files:**
- Modify: `static/vendor/mind-elixir/index.html` (message listener, around line 508-520)
- Modify: `static/index.html` (iframe `src` query, around line 8126)

**Interfaces:**
- Consumes: nothing new.
- Produces: iframe now accepts `{ type: "refresh", data }` from parent and calls `mind.refresh(data)`; iframe URL version bumped so clients re-fetch the vendor file (HTTP cache bypass; SW caches `/static/vendor/mind-elixir/index.html`? — it is NOT in the SW STATIC precache list, the query bump on the parent's iframe src is what invalidates it).

- [ ] **Step 1: Add the `refresh` handler**

In `static/vendor/mind-elixir/index.html`, find the message listener:

```js
    window.addEventListener('message', (e) => {
      if (e.origin !== window.location.origin) return;
      if (e.data && e.data.type === 'load') {
        hidePanel();
        currentNodeId = null;
        currentNodeData = null;
        clearTimeout(unselectTimer);
        initMind(e.data.data);
        setTimeout(updateBadges, 300);
      }
      if (e.data && e.data.type === 'clearPanel') {
```

Insert a `refresh` branch directly after the `load` branch:

```js
      if (e.data && e.data.type === 'refresh') {
        if (!mind) return;
        try { mind.refresh(e.data.data); } catch (_) {}
        setTimeout(updateBadges, 300);
        return;
      }
```

(`mind.refresh` deep-clones its argument, replaces `nodeData`, re-lays-out, and does NOT fire the `operation` bus event — no `change` message back to the parent, so no save/echo loop. This was verified in the vendored `MindElixir.iife.js`; re-verify in Task 6 browser test 7.)

- [ ] **Step 2: Bump the iframe src version**

In `static/index.html`, find:

```js
    src: "/static/vendor/mind-elixir/index.html?v=118",
```

Replace with:

```js
    src: "/static/vendor/mind-elixir/index.html?v=119",
```

- [ ] **Step 3: Commit**

```bash
git add static/vendor/mind-elixir/index.html static/index.html
git commit -m "feat(mindmap): handle refresh message in mindmap iframe, bump iframe version

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 4: MindmapPage integration — viewMode, outlineTree, save pipeline, minimal outline

**Files:**
- Modify: `static/index.html` — `MindmapPage` (lines ~7423-8173): new states, load effect, `change` handler, `scheduleSave` extraction, `handleOutlineEdit`, header mode toggle, render area (iframe hidden vs outline), and a MINIMAL `MindmapOutline` scaffold (full component replaces it in Task 5).

**Interfaces:**
- Consumes: `window.TF.mindmapoutline` (Task 1), iframe `refresh` handler (Task 3), existing `api.put` + `saveTimerRef` + `syncStatus` flow.
- Produces (used by Task 5):
  - `MindmapOutline({ tree, onChange })` — `tree` is the `nodeData` root object; `onChange(nextRoot)` is called with the new root after every outline edit.
  - `MindmapPage` wires `handleOutlineEdit(nextNodeData)` → merges into full tree object → `setOutlineTree` + `scheduleSave(selected.id, JSON.stringify(next))` + postMessage `{ type: "refresh", data: next }`.

- [ ] **Step 1: Add new state**

Find in `MindmapPage` (after `const [pickerNodeId, setPickerNodeId] = useState(null);` around line 7449):

```js
  const [currentNodeLinks, setCurrentNodeLinks] = useState([]);
```

Insert after it:

```js
  const [viewMode, setViewMode] = useState("canvas"); // "canvas" | "outline", session-only
  const [outlineTree, setOutlineTree] = useState(null); // full data object {nodeData, arrows?, summaries?, theme?}
```

- [ ] **Step 2: Extract `scheduleSave`**

Find inside `MindmapPage`, right before the "Send data to iframe when selected mindmap changes" effect (line ~7486), and insert:

```js
  // Debounced persist shared by canvas changes and outline edits.
  const scheduleSave = (mid, dataStr) => {
    setSyncStatus("saving");
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      api.put(`/api/mindmaps/${mid}`, {
        data_json: dataStr
      }).then(() => setSyncStatus("saved"))
        .catch(() => setSyncStatus("offline"));
    }, 1000);
  };
```

- [ ] **Step 3: Initialize `outlineTree` on mindmap select**

Find the load effect (line ~7487-7508). Replace its body:

```js
  // Send data to iframe when selected mindmap changes
  useEffect(() => {
    if (!selected) return;
    clearTimeout(saveTimerRef.current);
    setSyncStatus("saved");
    setDeleteConfirm(false);
    setRenaming(false);
    const dataStr = selected.data_json;
    const sendLoad = () => {
      try {
        const data = JSON.parse(dataStr);
        iframeRef.current?.contentWindow?.postMessage({
          type: "load",
          data
        }, window.location.origin);
      } catch (_) {}
    };
    if (iframeRef.current?.contentWindow) {
      setTimeout(sendLoad, 200);
    }
    setMmListId(selected?.list_id ?? null);
    setShareOpen(false);
  }, [selected?.id]);
```

with:

```js
  // Send data to iframe when selected mindmap changes
  useEffect(() => {
    if (!selected) {
      setOutlineTree(null);
      return;
    }
    clearTimeout(saveTimerRef.current);
    setSyncStatus("saved");
    setDeleteConfirm(false);
    setRenaming(false);
    let data = null;
    try { data = JSON.parse(selected.data_json); } catch (_) {}
    setOutlineTree(data);
    const sendLoad = () => {
      if (!data) return;
      try {
        iframeRef.current?.contentWindow?.postMessage({
          type: "load",
          data
        }, window.location.origin);
      } catch (_) {}
    };
    if (iframeRef.current?.contentWindow) {
      setTimeout(sendLoad, 200);
    }
    setMmListId(selected?.list_id ?? null);
    setShareOpen(false);
  }, [selected?.id]);
```

Note: this effect resets outline state on every mindmap switch. The `viewMode` intentionally does NOT reset here (mode is session-only, per spec).

- [ ] **Step 4: Update the `change` handler to feed `outlineTree`**

Find in the message-handler effect (line ~7577-7588):

```js
      if (e.data && e.data.type === "change" && selected) {
        const dataStr = JSON.stringify(e.data.data);
        const mid = selected.id;
        setSyncStatus("saving");
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = setTimeout(() => {
          api.put(`/api/mindmaps/${mid}`, {
            data_json: dataStr
          }).then(() => setSyncStatus("saved"))
            .catch(() => setSyncStatus("offline"));
        }, 1000);
      }
```

Replace with:

```js
      if (e.data && e.data.type === "change" && selected) {
        setOutlineTree(e.data.data);
        scheduleSave(selected.id, JSON.stringify(e.data.data));
      }
```

- [ ] **Step 5: Add `handleOutlineEdit`**

Insert after `scheduleSave` (Step 2):

```js
  // Outline edit: update local tree, persist, and re-render the (hidden or
  // visible) canvas via the iframe 'refresh' message. mind.refresh does not
  // fire 'operation', so no 'change' comes back — no echo loop.
  const handleOutlineEdit = nextNodeData => {
    if (!selected || !outlineTree) return;
    const next = { ...outlineTree, nodeData: nextNodeData };
    setOutlineTree(next);
    scheduleSave(selected.id, JSON.stringify(next));
    iframeRef.current?.contentWindow?.postMessage({
      type: "refresh",
      data: next
    }, window.location.origin);
  };
```

- [ ] **Step 6: Add the mode toggle to the header row**

In the header row (line ~7928+), find the sync status span ending:

```js
  }, syncStatus === "saving" ? "Menyimpan..." : syncStatus === "offline" ? "Offline" : "Tersimpan"), /*#__PURE__*/React.createElement("button", {
    className: "btn btn-secondary btn-sm",
    onClick: () => {
      setRenaming(true);
      setRenameVal(selected.title);
    },
```

Insert between the sync status span and the Rename button:

```js
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 2,
      background: "var(--bg-primary)",
      borderRadius: 8,
      padding: 2,
      flexShrink: 0
    }
  }, /*#__PURE__*/React.createElement("button", {
    onClick: () => setViewMode("canvas"),
    title: "Mode canvas",
    style: {
      border: "none",
      background: viewMode === "canvas" ? "var(--accent)" : "transparent",
      color: viewMode === "canvas" ? "#000" : "var(--text-light)",
      borderRadius: 6,
      padding: "3px 10px",
      fontSize: 11,
      fontWeight: 600,
      cursor: "pointer"
    }
  }, "🧠 Canvas"), /*#__PURE__*/React.createElement("button", {
    onClick: () => setViewMode("outline"),
    title: "Mode outline",
    style: {
      border: "none",
      background: viewMode === "outline" ? "var(--accent)" : "transparent",
      color: viewMode === "outline" ? "#000" : "var(--text-light)",
      borderRadius: 6,
      padding: "3px 10px",
      fontSize: 11,
      fontWeight: 600,
      cursor: "pointer"
    }
  }, "📝 Outline"))
```

- [ ] **Step 7: Replace the render area (placeholder vs iframe)**

Find the block:

```js
  }, mindmaps.length === 0 && !loading ? "Buat mindmap pertamamu" : "Pilih mindmap dari daftar"), mindmaps.length === 0 && !loading && !creating && /*#__PURE__*/React.createElement("button", {
    className: "btn btn-primary",
    onClick: () => {
      setSidebarOpen(true);
      setCreating(true);
    },
    style: {
      marginTop: 4
    }
  }, "+ Buat Mindmap Pertama")) : /*#__PURE__*/React.createElement("iframe", {
    ref: iframeRef,
    "data-tour": "mindmap-canvas",
    src: "/static/vendor/mind-elixir/index.html?v=119",
    style: {
      flex: 1,
      border: "none",
      width: "100%"
    },
    title: "Mindmap editor"
  })), showLinkPicker && /*#__PURE__*/React.createElement(LinkPickerModal, {
```

Replace the ternary result (`: iframe`) with a fragment that keeps BOTH the iframe and the outline mounted (display toggling — this preserves canvas zoom/position across mode switches):

```js
  }, mindmaps.length === 0 && !loading ? "Buat mindmap pertamamu" : "Pilih mindmap dari daftar"), mindmaps.length === 0 && !loading && !creating && /*#__PURE__*/React.createElement("button", {
    className: "btn btn-primary",
    onClick: () => {
      setSidebarOpen(true);
      setCreating(true);
    },
    style: {
      marginTop: 4
    }
  }, "+ Buat Mindmap Pertama")) : /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      display: viewMode === "canvas" ? "flex" : "none",
      flexDirection: "column",
      overflow: "hidden",
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("iframe", {
    ref: iframeRef,
    "data-tour": "mindmap-canvas",
    src: "/static/vendor/mind-elixir/index.html?v=119",
    style: {
      flex: 1,
      border: "none",
      width: "100%"
    },
    title: "Mindmap editor"
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      display: viewMode === "outline" ? "flex" : "none",
      flexDirection: "column",
      overflow: "hidden",
      minWidth: 0,
      background: "var(--bg-card)"
    }
  }, outlineTree && selected ? /*#__PURE__*/React.createElement(MindmapOutline, {
    key: selected.id,
    tree: outlineTree.nodeData,
    onChange: handleOutlineEdit
  }) : null)), showLinkPicker && /*#__PURE__*/React.createElement(LinkPickerModal, {
```

- [ ] **Step 8: Add the minimal `MindmapOutline` scaffold**

Insert directly BEFORE `function MindmapPage({` (line ~7424):

```js
// ── Mindmap Outline (minimal scaffold — full component in Task 5) ──
  // uses: React
function MindmapOutline({ tree, onChange }) {
  const rows = [];
  (function walk(n, depth) {
    rows.push({ n, depth });
    (n.children || []).forEach(c => walk(c, depth + 1));
  })(tree, 0);
  return /*#__PURE__*/React.createElement("div", {
    style: { padding: 12, overflowY: "auto", flex: 1 }
  }, rows.map(r => /*#__PURE__*/React.createElement("div", {
    key: r.n.id,
    style: { padding: "4px 0 4px " + r.depth * 18 + "px", fontSize: 13 }
  }, r.n.topic)));
}
```

- [ ] **Step 9: Syntax check**

Run: `node -e "new Function(require('fs').readFileSync('static/index.html','utf8').match(/<script>([\s\S]*?)<\/script>\s*<\/body>/)[1])" `
Expected: no output, exit 0. (If the regex does not match your file layout, use `node -e "const s=require('fs').readFileSync('static/index.html','utf8'); new Function(s.slice(s.lastIndexOf('<script>')+8, s.lastIndexOf('</script>')))"`)

- [ ] **Step 10: Commit**

```bash
git add static/index.html
git commit -m "feat(mindmap): wire outline mode state, sync and minimal outline view

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 5: Full `MindmapOutline` component

**Files:**
- Modify: `static/index.html` — replace the minimal `MindmapOutline` scaffold (Task 4 Step 8) with the full component.

**Interfaces:**
- Consumes: `window.TF.mindmapoutline` (all 18 exports), props `{ tree, onChange }` (Task 4 contract).
- Produces: complete outline UI — search, expand/collapse all, collapse carets, inline rename, add child/sibling, delete/duplicate, indent/outdent, move buttons, context menu, keyboard shortcuts, drag & drop reorder, copy/paste branch, undo/redo.

- [ ] **Step 1: Replace the scaffold with the full component**

Replace the entire minimal `MindmapOutline` function (Task 4 Step 8) with:

```js
// ── Mindmap Outline (text-hierarchy view of a mindmap) ──────
  // ═══ DEPENDENCIES: Mindmap Outline ═══
  // uses:
  //   - React
  //   - window.TF.mindmapoutline
  // emits:
  //   - MindmapOutline
function MindmapOutline({ tree, onChange }) {
  const MO = window.TF && window.TF.mindmapoutline;
  const [activeId, setActiveId] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [editVal, setEditVal] = useState("");
  const [searchQ, setSearchQ] = useState("");
  const [ctxMenu, setCtxMenu] = useState(null);
  const [dragId, setDragId] = useState(null);
  const [dragOver, setDragOver] = useState(null);
  const [clipboard, setClipboard] = useState(null);
  const undoRef = useRef([]);
  const redoRef = useRef([]);
  const treeRef = useRef(tree);
  treeRef.current = tree;

  const find = id => MO.findNode(tree, id);

  const pushUndo = () => {
    undoRef.current.push(treeRef.current);
    if (undoRef.current.length > 50) undoRef.current.shift();
    redoRef.current = [];
  };
  const edit = nextRoot => { pushUndo(); onChange(nextRoot); };
  const undo = () => {
    if (!undoRef.current.length) return;
    redoRef.current.push(treeRef.current);
    onChange(undoRef.current.pop());
  };
  const redo = () => {
    if (!redoRef.current.length) return;
    undoRef.current.push(treeRef.current);
    onChange(redoRef.current.pop());
  };

  const q = searchQ.trim().toLowerCase();
  const matches = q ? MO.searchNodes(tree, q) : null;
  const matchSet = matches ? new Set(matches) : null;
  const visible = node => {
    if (!matchSet) return true;
    if (matchSet.has(node.id)) return true;
    return (node.children || []).some(visible);
  };

  const rows = [];
  (function walk(n, depth) {
    if (!visible(n)) return;
    rows.push({ n, depth });
    // search overrides collapse: descend into everything while filtering
    if (n.expanded === false && !matchSet) return;
    (n.children || []).forEach(c => walk(c, depth + 1));
  })(tree, 0);

  const visibleIds = () => rows.map(r => r.n.id);

  const commitRename = () => {
    if (editingId == null) return;
    const val = editVal.trim();
    setEditingId(null);
    if (!val) return;
    edit(MO.renameNode(treeRef.current, editingId, val));
  };
  const startRename = id => {
    const f = find(id);
    if (!f || !f.node) return;
    setEditingId(id);
    setEditVal(f.node.topic);
  };

  const addChildOp = id => { const r = MO.addChild(treeRef.current, id, "Node baru"); edit(r.tree); setActiveId(r.id); };
  const addSiblingOp = id => { const r = MO.addSibling(treeRef.current, id, true); edit(r.tree); setActiveId(r.id); };
  const duplicateOp = id => { const r = MO.duplicateNode(treeRef.current, id); if (r.id == null) return; edit(r.tree); setActiveId(r.id); };
  const deleteOp = id => {
    const f = find(id);
    if (!f || !f.node || f.node.root) return;
    const parentId = f.parent ? f.parent.id : null;
    edit(MO.deleteNode(treeRef.current, id));
    setActiveId(parentId || treeRef.current.id);
  };
  const indentOp = id => { edit(MO.indentNode(treeRef.current, id)); };
  const outdentOp = id => { edit(MO.outdentNode(treeRef.current, id)); };
  const moveOp = (id, dir) => { edit(MO.moveNode(treeRef.current, id, dir)); };
  const toggleOp = id => { edit(MO.toggleExpand(treeRef.current, id)); };
  const copyOp = id => {
    const f = find(id);
    if (!f || !f.node || f.node.root) return;
    setClipboard(MO.cloneSubtree(f.node));
  };
  const pasteOp = id => {
    if (!clipboard) return;
    const r = MO.insertSubtree(treeRef.current, id, MO.cloneSubtree(clipboard));
    edit(r.tree);
    setActiveId(r.id);
  };
  const expandAllOp = () => edit(MO.expandAll(treeRef.current));
  const collapseAllOp = () => edit(MO.collapseAll(treeRef.current));

  const handleDrop = (targetId, into) => {
    const d = dragId;
    setDragId(null);
    setDragOver(null);
    if (!d || d === targetId) return;
    if (MO.ancestorsOf(treeRef.current, targetId).indexOf(d) !== -1) return;
    const next = into
      ? MO.moveInto(treeRef.current, d, targetId)
      : MO.moveSibling(treeRef.current, d, targetId, dragOver ? dragOver.pos : "after");
    edit(next);
  };

  const onKeyDown = e => {
    if (editingId != null) return; // inline input handles its own keys
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && e.key.toLowerCase() === "z") { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
    if (ctrl && e.key.toLowerCase() === "y") { e.preventDefault(); redo(); return; }
    if (ctrl && e.key.toLowerCase() === "c") { e.preventDefault(); if (activeId) copyOp(activeId); return; }
    if (ctrl && e.key.toLowerCase() === "v") { e.preventDefault(); if (activeId) pasteOp(activeId); return; }
    if (ctrl && e.key.toLowerCase() === "d") { e.preventDefault(); if (activeId) duplicateOp(activeId); return; }
    if (ctrl) return;
    if (!activeId) return;
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      if (e.altKey) { moveOp(activeId, e.key === "ArrowUp" ? "up" : "down"); return; }
      const ids = visibleIds();
      const i = ids.indexOf(activeId);
      if (e.key === "ArrowUp" && i > 0) setActiveId(ids[i - 1]);
      if (e.key === "ArrowDown" && i >= 0 && i < ids.length - 1) setActiveId(ids[i + 1]);
      return;
    }
    if (e.key === "Enter") { e.preventDefault(); addSiblingOp(activeId); return; }
    if (e.key === "Tab") { e.preventDefault(); if (e.shiftKey) outdentOp(activeId); else addChildOp(activeId); return; }
    if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); deleteOp(activeId); return; }
    if (e.key === "F2") { e.preventDefault(); startRename(activeId); return; }
    if (e.key === "Escape" && ctxMenu) { setCtxMenu(null); }
  };

  const hovBtn = {
    border: "none", background: "none", cursor: "pointer", fontSize: 12,
    color: "var(--text-light)", padding: "0 2px", flexShrink: 0
  };

  const renderTopic = n => {
    if (editingId === n.id) {
      return /*#__PURE__*/React.createElement("input", {
        autoFocus: true,
        value: editVal,
        onChange: e => setEditVal(e.target.value),
        onKeyDown: e => {
          e.stopPropagation();
          if (e.key === "Enter") commitRename();
          if (e.key === "Escape") setEditingId(null);
        },
        onBlur: commitRename,
        onMouseDown: e => e.stopPropagation(),
        style: {
          flex: 1, fontSize: 13, padding: "2px 6px", borderRadius: 6,
          border: "1px solid var(--accent)", background: "var(--bg-primary)",
          color: "var(--text-primary)", outline: "none"
        }
      });
    }
    if (matchSet && matchSet.has(n.id)) {
      const idx = n.topic.toLowerCase().indexOf(q);
      if (idx !== -1) {
        return /*#__PURE__*/React.createElement(React.Fragment, null,
          n.topic.slice(0, idx),
          /*#__PURE__*/React.createElement("mark", {
            style: { background: "var(--accent)", color: "#000", borderRadius: 3, padding: "0 2px" }
          }, n.topic.slice(idx, idx + q.length)),
          n.topic.slice(idx + q.length));
      }
    }
    return n.topic;
  };

  const renderRow = ({ n, depth }) => {
    const f = find(n.id);
    const isRoot = !!n.root;
    const collapsed = n.expanded === false;
    const hasKids = (n.children || []).length > 0;
    const linkCount = (n.links || []).length;
    const isActive = activeId === n.id;
    const isDragging = dragId === n.id;
    const dropMark = dragOver && dragOver.id === n.id ? dragOver.pos : null;
    return /*#__PURE__*/React.createElement("div", {
      key: n.id,
      onMouseDown: e => { if (editingId !== n.id) setActiveId(n.id); },
      onDoubleClick: e => { e.stopPropagation(); startRename(n.id); },
      onContextMenu: e => {
        e.preventDefault();
        e.stopPropagation();
        setActiveId(n.id);
        setCtxMenu({ x: e.clientX, y: e.clientY });
      },
      draggable: !isRoot,
      onDragStart: e => {
        if (isRoot) { e.preventDefault(); return; }
        setDragId(n.id);
        e.dataTransfer.effectAllowed = "move";
        try { e.dataTransfer.setData("text/plain", n.id); } catch (_) {}
      },
      onDragOver: e => {
        if (!dragId || dragId === n.id) return;
        e.preventDefault();
        e.stopPropagation();
        const r = e.currentTarget.getBoundingClientRect();
        setDragOver({ id: n.id, pos: (e.clientY - r.top) < r.height / 2 ? "before" : "after" });
      },
      onDrop: e => { e.preventDefault(); e.stopPropagation(); handleDrop(n.id, e.shiftKey); },
      onDragEnd: () => { setDragId(null); setDragOver(null); },
      style: {
        display: "flex", alignItems: "center", gap: 6,
        padding: "4px 8px 4px " + (depth * 18 + 6) + "px",
        borderRadius: 6, cursor: "pointer", fontSize: 13,
        background: isActive ? "rgba(168,197,0,0.10)" : "transparent",
        borderTop: dropMark === "before" ? "2px solid var(--accent)" : "2px solid transparent",
        borderBottom: dropMark === "after" ? "2px solid var(--accent)" : "2px solid transparent",
        opacity: isDragging ? 0.45 : 1,
        userSelect: "none"
      }
    }, /*#__PURE__*/React.createElement("span", {
      onClick: e => { e.stopPropagation(); if (hasKids) toggleOp(n.id); },
      style: {
        width: 16, textAlign: "center", flexShrink: 0, fontSize: 10,
        color: hasKids ? "var(--text-primary)" : "transparent",
        transform: collapsed ? "rotate(-90deg)" : "none",
        transition: "transform 0.15s", display: "inline-block"
      }
    }, "▼"), /*#__PURE__*/React.createElement("span", {
      style: {
        flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        fontWeight: isRoot ? 700 : 400,
        color: isRoot ? "var(--accent)" : "var(--text-primary)"
      }
    }, renderTopic(n)), linkCount > 0 && /*#__PURE__*/React.createElement("span", {
      style: { fontSize: 10, color: "var(--text-light)", flexShrink: 0 }
    }, "🔗", linkCount), isActive && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("button", {
      onClick: e => { e.stopPropagation(); moveOp(n.id, "up"); },
      disabled: isRoot || !f || f.index === 0,
      title: "Geser naik",
      style: hovBtn
    }, "↑"), /*#__PURE__*/React.createElement("button", {
      onClick: e => { e.stopPropagation(); moveOp(n.id, "down"); },
      disabled: isRoot || !f || !f.parent || f.index >= f.parent.children.length - 1,
      title: "Geser turun",
      style: hovBtn
    }, "↓"), /*#__PURE__*/React.createElement("button", {
      onClick: e => { e.stopPropagation(); startRename(n.id); },
      title: "Rename",
      style: hovBtn
    }, "✏️"), /*#__PURE__*/React.createElement("button", {
      onClick: e => {
        e.stopPropagation();
        setActiveId(n.id);
        setCtxMenu({ x: e.clientX, y: e.clientY });
      },
      title: "Menu",
      style: hovBtn
    }, "⋮"));
  };

  const menuF = activeId ? find(activeId) : null;
  const menuIsRoot = !!(menuF && menuF.node && menuF.node.root);
  const menuItem = (label, fn, danger, disabled) => /*#__PURE__*/React.createElement("div", {
    key: label,
    onMouseDown: e => {
      e.preventDefault();
      e.stopPropagation();
      if (!disabled) fn();
      setCtxMenu(null);
    },
    style: {
      padding: "7px 14px", fontSize: 13, cursor: disabled ? "default" : "pointer",
      color: disabled ? "var(--text-light)" : danger ? "#ef4444" : "var(--text-primary)",
      opacity: disabled ? 0.5 : 1
    },
    onMouseEnter: e => { if (!disabled) e.currentTarget.style.background = "var(--bg-primary)"; },
    onMouseLeave: e => { e.currentTarget.style.background = "transparent"; }
  }, label);

  return /*#__PURE__*/React.createElement("div", {
    tabIndex: 0,
    onKeyDown,
    style: {
      outline: "none", display: "flex", flexDirection: "column", flex: 1,
      minHeight: 0, overflow: "hidden"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex", alignItems: "center", gap: 8, padding: "8px 12px",
      borderBottom: "1px solid var(--border)", flexShrink: 0
    }
  }, /*#__PURE__*/React.createElement("input", {
    placeholder: "Cari node...",
    value: searchQ,
    onChange: e => setSearchQ(e.target.value),
    style: {
      flex: 1, padding: "5px 10px", borderRadius: 6, border: "1px solid var(--border)",
      background: "var(--bg-primary)", color: "var(--text-primary)", fontSize: 12, outline: "none"
    }
  }), /*#__PURE__*/React.createElement("button", {
    className: "btn btn-secondary btn-sm",
    onClick: expandAllOp,
    style: { fontSize: 11 }
  }, "Expand all"), /*#__PURE__*/React.createElement("button", {
    className: "btn btn-secondary btn-sm",
    onClick: collapseAllOp,
    style: { fontSize: 11 }
  }, "Collapse all")), /*#__PURE__*/React.createElement("div", {
    style: { flex: 1, overflowY: "auto", padding: 8, minHeight: 0 }
  }, rows.map(renderRow), rows.length === 0 && /*#__PURE__*/React.createElement("div", {
    style: { color: "var(--text-light)", fontSize: 12, padding: 16, textAlign: "center" }
  }, "Tidak ada node cocok")), ctxMenu && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    onMouseDown: () => setCtxMenu(null),
    style: { position: "fixed", inset: 0, zIndex: 400 }
  }), /*#__PURE__*/React.createElement("div", {
    onMouseDown: e => e.stopPropagation(),
    style: {
      position: "fixed", left: ctxMenu.x, top: ctxMenu.y, zIndex: 401,
      background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 8,
      boxShadow: "0 6px 20px rgba(0,0,0,0.18)", padding: "4px 0", minWidth: 170
    }
  },
    menuItem("✏️ Rename", () => startRename(activeId)),
    menuItem("↳ Tambah child", () => addChildOp(activeId)),
    menuItem("↵ Tambah sibling", () => addSiblingOp(activeId)),
    menuItem("⧉ Duplikat", () => duplicateOp(activeId), false, menuIsRoot),
    menuItem("⤒ Indent", () => indentOp(activeId), false, menuIsRoot || !menuF || menuF.index === 0),
    menuItem("⤓ Outdent", () => outdentOp(activeId), false, menuIsRoot || !menuF || !menuF.parent),
    menuItem("📋 Copy branch", () => copyOp(activeId), false, menuIsRoot),
    menuItem("📥 Paste branch", () => pasteOp(activeId), false, !clipboard),
    menuItem("🗑 Hapus", () => deleteOp(activeId), true, menuIsRoot))));
}
```

- [ ] **Step 2: Syntax check**

Run: `node -e "const s=require('fs').readFileSync('static/index.html','utf8'); new Function(s.slice(s.lastIndexOf('<script>')+8, s.lastIndexOf('</script>')))"`
Expected: no output, exit 0. (Note: `s.lastIndexOf('<script>')` picks the LAST script block — the main app block; verify this assumption holds — if not, extract the block by matching the `MindmapPage` function boundaries instead.)

- [ ] **Step 3: Commit**

```bash
git add static/index.html
git commit -m "feat(mindmap): add full outline view with editing, keyboard, drag-drop, undo

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 6: Final verification — full test suite, SW cache bump, browser checklist

**Files:**
- Modify: `static/sw.js` (CACHE name)

**Interfaces:**
- Consumes: Tasks 1-5.

- [ ] **Step 1: Bump the SW cache name**

In `static/sw.js` line 1, find:

```js
const CACHE = "taskflow-v213-dashboard-pinned";
```

Replace with:

```js
const CACHE = "taskflow-v214-mindmap-outline";
```

- [ ] **Step 2: Run the new test file**

Run: `node --test tests/offline/mindmapoutline.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 3: Run the full suite**

Run: `npm test`
Expected: ALL pass, 0 failures. Read the summary line yourself (e.g. `# tests N`, `# pass N`, `# fail 0`) — do not trust memory of the previous count; if any unrelated test fails, re-run that file alone before touching anything (drive Z: node --test is slow and can be flaky in background runs).

- [ ] **Step 4: Commit**

```bash
git add static/sw.js
git commit -m "chore: bump service worker cache version for mindmap outline mode

Co-Authored-By: Claude <noreply@anthropic.com>"
```

- [ ] **Step 5: Deploy (user action)**

Ask the user to push: `git push origin main` (VPS deploys via pull + service restart). Agent must NOT push without user confirmation.

- [ ] **Step 6: Browser verification checklist (on the live app)**

Open the app → Mindmap page → select/create a mindmap:

1. Toggle `📝 Outline` — tree renders identically to canvas content (topics, order).
2. Edit in outline: add child/sibling, rename (F2/dbl-click), indent/outdent, delete — then toggle `🧠 Canvas`: changes are visible.
3. Edit in canvas (Tab/Enter/F2/Delete) — toggle to outline: changes visible.
4. Collapse a branch in outline (caret) — toggle to canvas: the same branch is collapsed on canvas (shared `expanded` field).
5. Reload the page — edits persisted (debounced save flushed).
6. DevTools → Network: set Offline — edit outline — status shows "Offline"; go online — local-first queue syncs (existing behavior).
7. **Echo-loop check:** DevTools Network tab — while editing outline, confirm NO PUT request storm and exactly one PUT per debounce window after edits stop (confirms `mind.refresh` does not fire `operation`/`change`).
8. Search: type a topic — matched rows shown with highlight, ancestors visible even if collapsed.
9. Drag & drop reorder (drag onto top half = before, bottom half = after; Shift+drag = move into as child). Verify no cycle (can't drop a node into its own subtree).
10. Undo/redo: Ctrl+Z / Ctrl+Shift+Z after several outline edits — tree steps back/forward and canvas follows.
11. Copy/paste branch: Ctrl+C on a branch, Ctrl+V into another — pasted subtree appears with fresh node ids (spot-check in canvas mode).
12. Mobile viewport (DevTools device mode): all operations reachable via tap — caret, ✏️, ⋮ menu, ↑/↓ buttons; no horizontal overflow.

- [ ] **Step 7: Post-deploy cache verification**

Run: `curl -s https://<host>/static/sw.js | head -1` (host from `.env`/config — ask user if unsure)
Expected: `const CACHE = "taskflow-v214-mindmap-outline";` — confirms the live SW is the new one (deploy can be green while stale; verify live state, not Action status).

- [ ] **Step 8: Update agent handover files (CLAUDE.md mandates this before ending session)**

Update `.agents/CURRENT_STATE.md` (task status, known issues, next-agent notes) and append an entry to `.agents/SESSION_LOG.md` with the standard format (Task / Changes / Files Modified / Status). Commit these updates.

---

## Self-Review Notes (run by the plan author)

- Spec coverage: P0 (expand/collapse, inline edit, keyboard, indent/outdent, add child/sibling, drag-drop reorder, delete/duplicate, two-way sync) → Tasks 1+5; P1 (search, expand/collapse all, context menu, undo/redo, copy/paste branch) → Task 5; sync architecture → Tasks 3+4; error handling (save offline via existing flow) → unchanged pipeline; testing → Task 1 + Task 6; cache versioning → Tasks 2/3/6. Spec section 7 file list matches Tasks 1-6.
- Deviation from spec (accepted, behavior unchanged): undo/redo stacks live inside `MindmapOutline` instead of `MindmapPage` (simpler; resets via `key={selected.id}` on mindmap switch, satisfying the spec's "reset on mindmap switch" requirement). Search auto-expansion is render-time (collapsed branches are still searched and shown) instead of mutating `expanded` on the tree — avoids refresh churn.
- No placeholders: every code step contains full code.
- Type consistency: `findNode` → `{node,parent,index}`; `{tree,id}` returns from `addChild`/`addSibling`/`duplicateNode`/`insertSubtree`; `moveNode(dir)` uses `"up"`/`"down"`; `moveSibling(pos)` uses `"before"`/`"after"` — consistent across module, tests, and component.
