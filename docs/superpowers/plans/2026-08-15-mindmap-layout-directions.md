# Mindmap 4-Direction Layout (Org Chart) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-mindmap, persisted 4-direction layout picker (← → ⇄ ↓ org chart) by upgrading the vendored mindmap engine from mind-elixir 1.1 to 5.15.1.

**Architecture:** Replace the two vendored dist files with npm `mind-elixir@5.15.1` (same data format, same API surface, adds `initDown()` top-down layout). The React parent (`MindmapPage`) gains a `direction` state persisted in `data_json.direction` (field already present in `getData()` output); direction buttons post `{type:"setDirection", direction}` to the iframe, which calls the engine's `initLeft()/initRight()/initSide()/initDown()` and posts back the existing `change` message so the value saves through the unchanged pipeline.

**Tech Stack:** mind-elixir 5.15.1 IIFE + CSS (npm dist), vanilla JS iframe, compiled React (`React.createElement` style, no JSX), existing `api.put` save pipeline, SW cache bump.

**Spec:** `docs/superpowers/specs/2026-08-15-mindmap-layout-directions-design.md`

## Global Constraints

- Direction values: `0` LEFT, `1` RIGHT, `2` SIDE (default), `3` DOWN (org chart). Unknown/missing → `2`.
- Persistence: `data_json.direction` top-level field. NO backend, schema, offline-router, or outline-module changes.
- `static/index.html` in git is the compiled form — plain JS + `React.createElement`, no JSX; `compile.js` is a no-op.
- PostMessage handlers keep the existing `e.origin !== window.location.origin` guard.
- `setDirection` message must be ignored when `mind` is null (guard `if (!mind) return;`), and must NOT post `change` when the applied direction equals the engine's current `mind.direction` (avoids save churn on mode switches); it MUST still re-layout via `init*()` every time (fixes hidden-iframe 0×0 layout).
- On `load`, the iframe must apply `data.direction ?? 2` after `initMind(data)` — without posting a `change` back.
- Parent must normalize `nodeData.root = true` on every tree it receives (5.x serialization may drop the flag; outline helpers depend on it): in the load-effect parse, the `change` handler, and `handleOutlineEdit`.
- Versioning: iframe src `?v=119` → `?v=120` in `static/index.html`; the vendor iframe's own sub-resources get `?v=120` (`MindElixir.css?v=120`, `MindElixir.iife.js?v=120`) — otherwise browsers keep serving the stale 1.1 IIFE/CSS from HTTP cache.
- SW cache name: `taskflow-v214-mindmap-outline` → `taskflow-v215-mindmap-layout`.
- Engine swap parity: both 1.1 and 5.15.1 default theme is `Latte` (light) with identical cssVar mechanism — the dark chrome comes from the vendor `index.html` inline styles, which are NOT part of the file swap. Visual parity is expected; verify in the post-deploy browser checklist.
- Tests: no new unit tests required (direction mapping is inline); run `node --test tests/offline/mindmapoutline.test.js` (targeted) then `npm test` (full suite, expect 370 pass / 0 fail — read the REAL summary lines; on drive Z: node --test can be slow, run synchronously).
- Commit convention: `feat:`/`fix:`/`chore:` prefix, ends with `Co-Authored-By: Claude <noreply@anthropic.com>`. Commit per task. Do NOT push — the user pushes when ready to deploy.

---

### Task 1: Vendor swap — mind-elixir 5.15.1 dist + cache-version bumps

**Files:**
- Modify: `static/vendor/mind-elixir/MindElixir.iife.js` (replace content)
- Modify: `static/vendor/mind-elixir/MindElixir.css` (replace content)
- Modify: `static/vendor/mind-elixir/index.html` (sub-resource version queries)
- Modify: `static/index.html` (iframe src `?v=119` → `?v=120`)

**Interfaces:**
- Consumes: npm registry `mind-elixir@5.15.1`.
- Produces: engine with `initDown()` (direction 3), `selectNewNode` bus event, `unselectNodes` public method, constants `MindElixir.LEFT/RIGHT/SIDE/DOWN` (0/1/2/3), same `{nodeData, arrows, summaries, direction, theme, ...}` data shape. Consumed by Tasks 2-3.

- [ ] **Step 1: Download and unpack the npm dist**

Run (from repo root, Git Bash):

```bash
mkdir -p /tmp/me-swap && cd /tmp/me-swap
curl -sL https://registry.npmjs.org/mind-elixir/-/mind-elixir-5.15.1.tgz -o me.tgz
tar -xzf me.tgz
ls -la package/dist/MindElixir.iife.js package/dist/MindElixir.css
```

Expected: both files exist; IIFE is large (hundreds of KB), CSS several KB.

- [ ] **Step 2: Replace the vendored files**

Run:

```bash
cp /tmp/me-swap/package/dist/MindElixir.iife.js "Z:\Todolist Manager V5.0\static\vendor\mind-elixir\MindElixir.iife.js"
cp /tmp/me-swap/package/dist/MindElixir.css "Z:\Todolist Manager V5.0\static\vendor\mind-elixir\MindElixir.css"
```

- [ ] **Step 3: Add `?v=120` to the iframe's sub-resources**

In `static/vendor/mind-elixir/index.html`, find:

```html
  <link rel="stylesheet" href="MindElixir.css">
```

Replace with:

```html
  <link rel="stylesheet" href="MindElixir.css?v=120">
```

Find:

```html
  <script src="MindElixir.iife.js"></script>
```

Replace with:

```html
  <script src="MindElixir.iife.js?v=120"></script>
```

- [ ] **Step 4: Bump the iframe src version in the parent**

In `static/index.html`, find:

```js
    src: "/static/vendor/mind-elixir/index.html?v=119",
```

Replace with:

```js
    src: "/static/vendor/mind-elixir/index.html?v=120",
```

- [ ] **Step 5: Verify the swap**

Run:

```bash
cd "Z:\Todolist Manager V5.0"
grep -c "initDown" static/vendor/mind-elixir/MindElixir.iife.js
node --check static/vendor/mind-elixir/MindElixir.iife.js
grep -c 'v=120' static/vendor/mind-elixir/index.html
git diff --stat
```

Expected: `initDown` count ≥ 1 (minified — a single long line may make grep print a huge line; use `grep -o "initDown" | wc -l` instead); `node --check` exit 0, no output; `v=120` appears exactly 2 times in the vendor index.html; diff stat shows the 4 files only.

- [ ] **Step 6: Commit**

```bash
git add static/vendor/mind-elixir/MindElixir.iife.js static/vendor/mind-elixir/MindElixir.css static/vendor/mind-elixir/index.html static/index.html
git commit -m "feat(mindmap): upgrade mind-elixir to 5.15.1 (adds initDown org-chart layout)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 2: Iframe adaptation — selection events, setDirection, direction-on-load

**Files:**
- Modify: `static/vendor/mind-elixir/index.html` (script section, lines ~442-534)

**Interfaces:**
- Consumes: 5.15.1 engine (Task 1): `mind.bus` events `selectNewNode`, `operation`, `changeDirection`; public `mind.unselectNodes`, `mind.initLeft/initRight/initSide/initDown`, `mind.getData()`, `mind.direction` instance field.
- Produces: unchanged parent protocol `nodeSelected` / `nodeDeselected` / `change`; new inbound message `{type:"setDirection", direction}`; on `load`, applies saved direction.

- [ ] **Step 1: Replace the `selectNodes` listener with `selectNewNode`**

In `static/vendor/mind-elixir/index.html`, find:

```js
      mind.bus.addListener('selectNodes', (nodes) => {
        clearTimeout(unselectTimer);
        if (!nodes || nodes.length === 0) return;
        const node = nodes[0];
        currentNodeId = node.id;
        currentNodeData = node; // live reference to internal nodeObj — not a getData() copy
        renderPanel(node.topic, node.links || []);
        document.getElementById('node-toolbar').style.display = 'flex';
        window.parent.postMessage(
          { type: 'nodeSelected', nodeId: node.id, topic: node.topic, links: node.links || [] },
          window.location.origin
        );
      });
```

Replace with (5.15.1 fires `selectNewNode` with the nodeObj directly):

```js
      mind.bus.addListener('selectNewNode', (node) => {
        clearTimeout(unselectTimer);
        if (!node) return;
        currentNodeId = node.id;
        currentNodeData = node; // live reference to internal nodeObj — not a getData() copy
        renderPanel(node.topic, node.links || []);
        document.getElementById('node-toolbar').style.display = 'flex';
        window.parent.postMessage(
          { type: 'nodeSelected', nodeId: node.id, topic: node.topic, links: node.links || [] },
          window.location.origin
        );
      });
```

- [ ] **Step 2: Replace the `unselectNodes` bus listener with a method wrapper**

Find:

```js
      mind.bus.addListener('unselectNodes', () => {
        unselectTimer = setTimeout(() => {
          currentNodeId = null;
          currentNodeData = null;
          hidePanel();
          document.getElementById('node-toolbar').style.display = 'none';
          window.parent.postMessage({ type: 'nodeDeselected' }, window.location.origin);
        }, 50);
      });
```

Replace with (5.15.1 fires NO deselect bus event — `clearSelection()` calls the public `unselectNodes()` method, so wrap it to keep the `nodeDeselected` protocol alive; the 50 ms timer lets a follow-up `selectNewNode` cancel the deselect, same as before):

```js
      const origUnselectNodes = mind.unselectNodes.bind(mind);
      mind.unselectNodes = els => {
        try { origUnselectNodes(els); } catch (_) {}
        unselectTimer = setTimeout(() => {
          currentNodeId = null;
          currentNodeData = null;
          hidePanel();
          document.getElementById('node-toolbar').style.display = 'none';
          window.parent.postMessage({ type: 'nodeDeselected' }, window.location.origin);
        }, 50);
      };
```

- [ ] **Step 3: Add the `setDirection` handler**

In the `message` listener, find:

```js
      if (e.data && e.data.type === 'refresh') {
        if (!mind) return;
        try { mind.refresh(e.data.data); } catch (_) {}
        setTimeout(updateBadges, 300);
        return;
      }
```

Insert directly after it:

```js
      if (e.data && e.data.type === 'setDirection') {
        if (!mind) return;
        try {
          const changed = mind.direction !== e.data.direction;
          if (e.data.direction === 0) mind.initLeft();
          else if (e.data.direction === 1) mind.initRight();
          else if (e.data.direction === 2) mind.initSide();
          else if (e.data.direction === 3) mind.initDown();
          else return;
          if (changed) {
            window.parent.postMessage({ type: 'change', data: mind.getData() }, window.location.origin);
          }
        } catch (_) {}
      }
```

(The `changed` guard means re-applying the current direction still re-layouts — which is exactly what the parent needs when the user switches back to canvas mode after outline edits at 0×0 — but does not re-save identical data.)

- [ ] **Step 4: Apply saved direction on `load`**

In the `message` listener, find the `load` branch:

```js
      if (e.data && e.data.type === 'load') {
        hidePanel();
        currentNodeId = null;
        currentNodeData = null;
        clearTimeout(unselectTimer);
        initMind(e.data.data);
        setTimeout(updateBadges, 300);
      }
```

Replace with:

```js
      if (e.data && e.data.type === 'load') {
        hidePanel();
        currentNodeId = null;
        currentNodeData = null;
        clearTimeout(unselectTimer);
        initMind(e.data.data);
        setTimeout(updateBadges, 300);
        const d = (e.data.data && typeof e.data.data.direction === 'number') ? e.data.data.direction : 2;
        try {
          if (d === 0) mind.initLeft();
          else if (d === 1) mind.initRight();
          else if (d === 3) mind.initDown();
          else mind.initSide();
        } catch (_) {}
      }
```

(`initMind` creates the instance with `direction: MindElixir.SIDE`; calling `initSide()` for the default case is intentional — it re-centers the map. These calls fire `changeDirection` only, never `operation`, so no `change` is posted back — no save loop on load.)

- [ ] **Step 5: Syntax-verify the iframe script**

Run:

```bash
cd "Z:\Todolist Manager V5.0"
node -e "
const fs=require('fs');
const s=fs.readFileSync('static/vendor/mind-elixir/index.html','utf8');
const m=[...s.matchAll(/<script>([\s\S]*?)<\/script>/g)];
console.log('script blocks:', m.length);
fs.writeFileSync('/tmp/vendor-inline.js', m[m.length-1][1]);
"
node --check /tmp/vendor-inline.js
```

Expected: exit 0, no output. (If the inline block is not the LAST script block, adjust the index; the file has exactly 2 script blocks: the IIFE include is a src-tag, the inline one has no src — select the one without `src=` if the last-index assumption fails.)

- [ ] **Step 6: Commit**

```bash
git add static/vendor/mind-elixir/index.html
git commit -m "feat(mindmap): adapt iframe to mind-elixir 5.15.1 — selectNewNode, setDirection, direction-on-load

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 3: MindmapPage — direction state, 4-direction buttons, root normalization

**Files:**
- Modify: `static/index.html` — `MindmapPage` (~lines 7820-7995, header UI ~8423-8436)

**Interfaces:**
- Consumes: iframe `setDirection` handler (Task 2); existing `scheduleSave`, `outlineTree`, `handleOutlineEdit`, `selected.data_json` shape (top-level `direction`).
- Produces: parent state `direction` (0|1|2|3), 4 direction buttons posting `{type:"setDirection", direction}`, `root:true` normalization on every tree intake.

- [ ] **Step 1: Add the direction constant + state**

Find:

```js
  const [viewMode, setViewMode] = useState("canvas"); // "canvas" | "outline", session-only
  const [outlineTree, setOutlineTree] = useState(null); // full data object {nodeData, arrows?, summaries?, theme?}
```

Replace with:

```js
  const [viewMode, setViewMode] = useState("canvas"); // "canvas" | "outline", session-only
  const [outlineTree, setOutlineTree] = useState(null); // full data object {nodeData, arrows?, summaries?, theme?}
  const [direction, setDirection] = useState(2); // 0=LEFT 1=RIGHT 2=SIDE 3=DOWN (org chart), per-mindmap via data_json.direction
```

- [ ] **Step 2: Add the direction constant array at module scope**

Find the line directly before `function MindmapPage({`:

```js
// ── Mindmap page ──────────────────────────────────────────────
function MindmapPage({
```

Replace with:

```js
// ── Mindmap page ──────────────────────────────────────────────
const MINDMAP_DIRECTIONS = [
  { value: 0, label: "←", title: "Arah kiri" },
  { value: 1, label: "→", title: "Arah kanan" },
  { value: 2, label: "⇄", title: "Dua arah" },
  { value: 3, label: "↓", title: "Org chart (atas ke bawah)" }
];
function MindmapPage({
```

- [ ] **Step 3: Normalize root + set direction in the load effect**

In the selected-change effect, find:

```js
    let data = null;
    try { data = JSON.parse(selected.data_json); } catch (_) {}
    setOutlineTree(data);
```

Replace with:

```js
    let data = null;
    try { data = JSON.parse(selected.data_json); } catch (_) {}
    if (data && data.nodeData) data.nodeData.root = true; // 5.x serialization may drop the root flag — outline helpers depend on it
    setOutlineTree(data);
    setDirection(data && typeof data.direction === "number" ? data.direction : 2);
```

- [ ] **Step 4: Normalize root + set direction in the `change` handler**

Find:

```js
      if (e.data && e.data.type === "change" && selected) {
        setOutlineTree(e.data.data);
        scheduleSave(selected.id, JSON.stringify(e.data.data));
      }
```

Replace with:

```js
      if (e.data && e.data.type === "change" && selected) {
        const data = e.data.data;
        if (data && data.nodeData) data.nodeData.root = true;
        setOutlineTree(data);
        if (data && typeof data.direction === "number") setDirection(data.direction);
        scheduleSave(selected.id, JSON.stringify(data));
      }
```

- [ ] **Step 5: Normalize root in `handleOutlineEdit`**

Find:

```js
  const handleOutlineEdit = nextNodeData => {
    if (!selected || !outlineTree) return;
    const next = { ...outlineTree, nodeData: nextNodeData };
```

Replace with:

```js
  const handleOutlineEdit = nextNodeData => {
    if (!selected || !outlineTree) return;
    if (nextNodeData) nextNodeData.root = true;
    const next = { ...outlineTree, nodeData: nextNodeData };
```

- [ ] **Step 6: Add the 4 direction buttons after the Canvas/Outline toggle**

Find (header row, the toggle's closing):

```js
  }, "📝 Outline")), /*#__PURE__*/React.createElement("button", {
    className: "btn btn-secondary btn-sm",
    onClick: () => {
      setRenaming(true);
      setRenameVal(selected.title);
    },
```

Insert between them:

```js
  }, "📝 Outline")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 2,
      background: "var(--bg-primary)",
      borderRadius: 8,
      padding: 2,
      flexShrink: 0
    }
  }, MINDMAP_DIRECTIONS.map(d => /*#__PURE__*/React.createElement("button", {
    key: d.value,
    onClick: () => {
      setDirection(d.value);
      iframeRef.current?.contentWindow?.postMessage({
        type: "setDirection",
        direction: d.value
      }, window.location.origin);
    },
    title: d.title,
    style: {
      border: "none",
      background: direction === d.value ? "var(--accent)" : "transparent",
      color: direction === d.value ? "#000" : "var(--text-light)",
      borderRadius: 6,
      padding: "3px 8px",
      fontSize: 13,
      fontWeight: 600,
      cursor: "pointer"
    }
  }, d.label))), /*#__PURE__*/React.createElement("button", {
    className: "btn btn-secondary btn-sm",
    onClick: () => {
      setRenaming(true);
      setRenameVal(selected.title);
    },
```

- [ ] **Step 7: Switch the canvas-mode button from refresh to setDirection**

Find:

```js
    onClick: () => {
      setViewMode("canvas");
      // While in outline mode the iframe is display:none, so the refresh posted
      // by outline edits laid out at 0x0. Re-refresh once visible.
      setTimeout(() => {
        if (iframeRef.current?.contentWindow && outlineTree) iframeRef.current.contentWindow.postMessage({
          type: "refresh",
          data: outlineTree
        }, window.location.origin);
      }, 50);
    },
```

Replace with:

```js
    onClick: () => {
      setViewMode("canvas");
      // While in outline mode the iframe is display:none, so outline-edit
      // refreshes laid out at 0x0. Re-apply the direction once visible — the
      // engine's init*() re-layouts and re-centers the canvas.
      setTimeout(() => {
        if (iframeRef.current?.contentWindow && selected) iframeRef.current.contentWindow.postMessage({
          type: "setDirection",
          direction
        }, window.location.origin);
      }, 50);
    },
```

(The `setDirection` handler re-layouts unconditionally and only posts `change` when the direction actually differs — so this never re-saves identical data.)

- [ ] **Step 8: Syntax check**

Run:

```bash
cd "Z:\Todolist Manager V5.0"
node -e "const s=require('fs').readFileSync('static/index.html','utf8'); const blocks=[...s.matchAll(/<script>([\s\S]*?)<\/script>/g)]; blocks.forEach((m,i)=>{ try{ new Function(m[1]); }catch(e){ console.log('BLOCK',i,'FAILS:',e.message); process.exitCode=1; } }); console.log('compiled', blocks.length, 'script blocks');"
```

Expected: `compiled N script blocks` with exit 0.

- [ ] **Step 9: Commit**

```bash
git add static/index.html
git commit -m "feat(mindmap): add per-mindmap 4-direction layout picker with root normalization

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 4: SW cache bump + full test suite + handover

**Files:**
- Modify: `static/sw.js` (CACHE name, line 1)

**Interfaces:**
- Consumes: Tasks 1-3.

- [ ] **Step 1: Bump the SW cache name**

In `static/sw.js`, find:

```js
const CACHE = "taskflow-v214-mindmap-outline";
```

Replace with:

```js
const CACHE = "taskflow-v215-mindmap-layout";
```

- [ ] **Step 2: Run the targeted test file**

Run: `node --test tests/offline/mindmapoutline.test.js`
Expected: PASS — 18/18, 0 fail (real summary lines).

- [ ] **Step 3: Run the full suite**

Run: `npm test`
Expected: ALL pass — 370 pass / 0 fail (baseline 352 + 18 outline tests; read the real summary lines; if any unrelated test fails, re-run that file alone once to check flakiness before touching anything).

- [ ] **Step 4: Commit**

```bash
git add static/sw.js
git commit -m "chore: bump service worker cache version for mindmap 4-direction layout

Co-Authored-By: Claude <noreply@anthropic.com>"
```

- [ ] **Step 5: Deploy gate (user action — do NOT push yourself)**

Ask the user to push: `git push origin main`. After deploy, verify live state with curl (NOT the Action status):

```bash
curl -s https://todo.yatno.web.id/static/sw.js | head -1          # expect taskflow-v215-mindmap-layout
curl -s https://todo.yatno.web.id/static/vendor/mind-elixir/index.html | grep -c "setDirection"   # expect ≥ 1
curl -s https://todo.yatno.web.id/static/index.html | grep -o 'mind-elixir/index.html?v=[0-9]*' | head -1  # expect ?v=120
```

- [ ] **Step 6: Browser regression checklist (post-deploy, against the live app)**

From the spec §6.2 — run all 12 items:

1. Load a mindmap created BEFORE the upgrade (1.1 data with `root: true`, links, expanded) — renders, no console errors, no crash.
2. All 4 directions render sensibly: ← / → / ⇄ / ↓ (org chart connectors top-to-bottom).
3. Direction persists after reload AND after sharing to a list (direction travels in `data_json`).
4. All edit operations: Tab, Enter, F2, Delete, toolbar (Child/Sibling/Promote/Edit/Hapus), drag-move.
5. Link panel: add via picker, remove, open note/task, badge count on nodes.
6. Outline mode: P0/P1 interactions intact; two-way sync; collapse sync; direction change while in outline → switch to canvas shows the chosen layout.
7. Fullscreen opens/closes; link panel stays visible.
8. Canvas undo/redo (Ctrl+Z).
9. No save/echo loop: Network tab shows no PUT storm while editing.
10. Mobile viewport: direction buttons + canvas usable; no overflow.
11. Dark theme visual parity: nodes, badges, link panel, toolbar look like before the upgrade.
12. Zero console errors on load, mode switch, direction switch.

Any failure in items 1-6 or 9: report immediately with console errors and screenshots; rollback = `git revert` the Task 1-3 commits + re-bump SW cache (or restore the old vendor files from `git show`).

- [ ] **Step 7: Update agent handover files (CLAUDE.md mandate)**

Update `.agents/CURRENT_STATE.md` (task status, known issues, next-agent notes) and append an entry to `.agents/SESSION_LOG.md` with the standard format (Task / Changes / Files Modified / Status). Commit these updates.

---

## Self-Review Notes (run by the plan author)

- Spec coverage: §3.1 engine upgrade → Task 1; §3.2 direction state → Task 3 Steps 1,3,4; §3.3 picker UI → Task 3 Steps 2,6; §3.4 iframe adaptation items 1-6 → Task 2 Steps 1-4 (root normalization lives in parent per item 6 → Task 3 Steps 3-5); §3.5 outline compatibility → Task 3 Step 7 (canvas-switch re-layout) — outline edits themselves untouched; §4 data flow → Tasks 2+3; §5 error handling → Task 2 Steps 3-4 guards (`!mind`, try/catch, `?? 2`, `changed` guard) + Task 3 defaults; §6.2 checklist → Task 4 Step 6; §6.3 rollback → Task 4 Step 6 note; §7 files → matches Tasks 1-4.
- Placeholder scan: every code step contains full code; no TBDs.
- Type consistency: `direction` values 0/1/2/3 used identically across the constant array (Task 3), the parent state, the postMessage payloads, and the iframe handler (Task 2); message type string `setDirection` identical everywhere; `mind.direction` field check guarded by the `changed` boolean.
