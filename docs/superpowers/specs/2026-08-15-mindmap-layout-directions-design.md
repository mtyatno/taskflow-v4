# Mindmap 4-Arah Layout (Org Chart) — Design Specification

**Date:** 2026-08-15
**Author:** Claude Code & User
**Status:** Approved by User
**Target:** TaskFlow WebApp (`static/vendor/mind-elixir/`, `static/index.html`, `static/sw.js`)

---

## 1. Executive Summary & Goals

The mindmap editor is stuck on a two-sided (left/right) layout because the vendored engine, mind-elixir **1.1.x**, only supports directions 0 (left), 1 (right), 2 (side). The user wants an **org-chart / flowchart layout from top to bottom**, selectable per mindmap. The latest stable engine, **mind-elixir 5.15.1**, adds a native top-down layout (`initDown()`, direction = 3) while keeping the same data format and the API methods this project already uses. This spec upgrades the engine to 5.15.1 and adds a per-mindmap, persisted 4-direction layout picker.

### Primary Objectives
1. **Native top-down (org chart) layout** via engine upgrade to mind-elixir 5.15.1.
2. **4-direction picker per mindmap**: ← left (0), → right (1), ⇄ side (2, default), ↓ down (3) — persisted in the mindmap's `data_json.direction`, zero backend/schema changes.
3. **Zero regression** to existing canvas features (link panel, badges, node toolbar, Promote, fullscreen, dark theme) and to Outline mode.
4. **Safe rollout**: clear rollback path (vendor files are revertible from git history; no data migration).

### Out of Scope
- mind-elixir **6.0.0-next.4** (pre-release; drops `moveNodeAfter` used by Promote). Reconsider after 6.0 final releases.
- Per-node direction editing (nodes keep their existing `direction` field, used by SIDE mode).
- Theme engine adoption — visual parity via CSS overrides only.

---

## 2. Verified Engine Facts (mind-elixir 5.15.1, checked against npm dist)

| Item | 1.1 (vendored) | 5.15.1 | Notes |
|---|---|---|---|
| Data format | `{nodeData:{id, topic, children[], expanded, direction}, arrows, summaries, direction, theme}` | same + `compact`, `meta` | existing mindmaps load unchanged |
| Top-down layout | ❌ | ✅ `initDown()` (direction = 3), dedicated `me-main.down` DOM branch | landed in 5.15.0 |
| `getData()` top-level `direction` | ✅ | ✅ | persistence vehicle — no schema change |
| API used by our iframe: `init(data)`, `refresh(data)`, `getData()`, `getDataString()`, `addChild()`, `insertSibling('after')`, `moveNodeAfter([el], parentEl)`, `beginEdit()`, `removeNodes()`, `currentNodes`, `findEle(id)`, `nodeObj`, `bus` (`operation`, `changeDirection`) | ✅ | ✅ (same names) | `moveNodeAfter` present in 5.15.1, absent in 6.0.0-next.4 |
| Selection event | `selectNodes` / `unselectNodes` | `selectNewNode` (payload: nodeObj directly); `selectNodes` export still exists | listener adaptation required |
| DOM/CSS surface | `me-tpc`, `me-main`, `.map-container`, `#input-box` | same class names | custom CSS overrides need re-application |
| Constructor options | `{el, direction, draggable, editable, contextMenu, toolBar, keypress}` | same + `allowUndo` | — |

## 3. Architecture

### 3.1 Engine upgrade

- Replace `static/vendor/mind-elixir/MindElixir.iife.js` and `MindElixir.css` with the dist files from npm `mind-elixir@5.15.1`.
- Bump iframe src query in `static/index.html`: `?v=119` → `?v=120`.
- Bump SW cache name in `static/sw.js`: `taskflow-v214-mindmap-outline` → `taskflow-v215-mindmap-layout`.

### 3.2 Direction state (per-mindmap)

- Stored in `data_json.direction`: `0` LEFT, `1` RIGHT, `2` SIDE (default), `3` DOWN (org chart).
- `MindmapPage` gains `direction` state, initialized from `selected.data_json` (`direction ?? 2`) and updated from iframe `change` events (the payload's top-level `direction`).
- New mindmaps keep default `2` (SIDE) — no change to `handleCreate` defaults.

### 3.3 Direction picker UI

- Four buttons **← → ⇄ ↓** in the `MindmapPage` header row, next to the existing 🧠 Canvas / 📝 Outline toggle.
- Active direction highlighted (`--accent` background), others transparent — same visual pattern as the Canvas/Outline toggle.
- `title` tooltips: "Arah kiri", "Arah kanan", "Dua arah", "Org chart (atas ke bawah)".
- Click → `iframeRef.contentWindow.postMessage({type:"setDirection", direction}, origin)`.
- Also disable/mark unsupported states? None — all 4 directions valid in 5.15.1.

### 3.4 Iframe adaptation (`static/vendor/mind-elixir/index.html`)

1. **Apply saved direction on load**: in the `load` message handler, after `initMind(data)`, read `e.data.data.direction ?? 2` and call the matching `mind.initLeft() / initRight() / initSide() / initDown()` once.
2. **`setDirection` handler**: new branch in the message listener — if `mind` exists, call the matching `init*()` method; the engine fires `changeDirection` but NOT `operation` (verify), so explicitly post `{type:"change", data: mind.getData()}` to the parent so the new `direction` persists.
3. **Selection listener adaptation** (verified in 5.15.1 source): replace the `selectNodes` listener with `selectNewNode` (payload is a single `nodeObj`, not an array). There is NO unselect/deselect bus event in 5.15.1 (`clearSelection` calls `unselectNodes` without firing anything), so wrap the engine's public `unselectNodes` method to detect deselection: `const orig = mind.unselectNodes.bind(mind); mind.unselectNodes = els => { orig(els); hide panel; post nodeDeselected; }`. Keep the parent protocol identical: `nodeSelected {nodeId, topic, links}` / `nodeDeselected`.
4. **`refresh` semantics**: verify `mind.refresh(data)` in 5.15.1 still deep-clones input, re-lays-out, and does NOT fire `operation` (no save/echo loop). If it fires, guard the refresh branch with a flag to skip the `change` post.
5. **Custom UI re-verification**: node toolbar (`addChild`, `insertSibling`, `moveNodeAfter` promote, `beginEdit`, `removeNodes`), link panel (`currentNodeData.links` on nodeObj), badge overlay (`me-tpc` + `nodeObj`), fullscreen redirect (`#map` → `#app` requestFullscreen override). Adapt to any 5.15.1 internal differences found during implementation.
6. **`root: true` normalization**: 5.x serialization may drop the `root: true` flag. Parent normalizes on every tree it receives (`load` parse, `change` handler, `handleOutlineEdit` merge): `if (tree && tree.nodeData) tree.nodeData.root = true;` — keeps outline helpers' root protection working.

### 3.5 Outline mode compatibility

- Outline mode is tree-based and ignores canvas layout — no changes.
- `handleOutlineEdit` merges `{...outlineTree, nodeData}` — top-level `direction` is preserved automatically.
- Direction buttons remain visible in outline mode (they still work: iframe is mounted; refresh/init* applies when switching back to canvas — see error handling note below).

## 4. Data Flow

```
Load mindmap ──► parent parses data_json (incl. direction) ──► posts load ──► iframe init + apply direction
                                                                          └──► (normalize root:true in parent)
Canvas edit ──► iframe change (getData incl. direction) ──► parent setOutlineTree + scheduleSave   [existing]
Direction click ──► parent setDirection msg ──► iframe init*() ──► post change ──► parent save      [new]
Outline edit ──► parent transform ──► save + refresh msg ──► iframe re-layouts                      [existing]
```

## 5. Error Handling

- Unknown/missing `direction` in data → `?? 2` (SIDE), never crash.
- `setDirection` when `mind` is null or not initialized → ignore (guard `if (!mind) return;`).
- Direction clicked while in outline mode → iframe is mounted but hidden; the `init*()` re-layout happens at 0×0. Mitigation (reuse existing fix pattern): the canvas-mode switch button already posts a delayed `refresh`; extend it to also re-apply the current direction after showing.
- `init*()` exceptions → wrap in try/catch; on failure post no `change` (no partial persist).
- Corrupt `data_json` → existing behavior unchanged.

## 6. Testing

### 6.1 Unit
- No new pure-logic module needed. Direction mapping is a 4-value constant; if a mapping helper is added, a tiny node --test covers it (optional).

### 6.2 Browser regression checklist (mandatory — the engine upgrade is the risk)

Run against the deployed app after user pushes:

1. Load a mindmap created BEFORE the upgrade (1.1 data with `root: true`, links, expanded) — renders correctly, no console errors, no crash.
2. All 4 directions render sensibly: ← / → / ⇄ / ↓ (org chart connectors top-to-bottom).
3. Direction persists after page reload and after sharing the mindmap to a list (direction travels in data_json).
4. All edit operations: Tab (child), Enter (sibling), F2 rename, Delete, toolbar buttons (Child/Sibling/Promote/Edit/Hapus), drag-move.
5. Link panel: add link via picker, remove, open note/task, badge count on nodes.
6. Outline mode: full P0/P1 interactions still work; two-way sync (canvas ↔ outline); collapse sync (`expanded`); direction change while in outline then switch to canvas shows correct layout.
7. Fullscreen: opens/closes, link panel stays visible.
8. Undo/redo in canvas (Ctrl+Z).
9. No save/echo loop: DevTools Network shows no PUT storm while editing (refresh must not fire operation).
10. Mobile viewport: 4 direction buttons + canvas interactions usable; no overflow.
11. Dark theme visual parity: node colors, badges, link panel, toolbar look like before the upgrade.
12. Zero console errors on load, mode switch, direction switch.

### 6.3 Rollback

- Vendor files revertible via git history; rollback = restore old `MindElixir.iife.js` + `MindElixir.css` + iframe index.html, `?v` back to 119, SW cache bump. No data migration means old data stays valid in both engines.

## 7. Files Touched

| File | Change |
|---|---|
| `static/vendor/mind-elixir/MindElixir.iife.js` | replace with npm 5.15.1 dist |
| `static/vendor/mind-elixir/MindElixir.css` | replace with npm 5.15.1 dist + our dark-theme/badge/panel overrides appended (or a separate override block) |
| `static/vendor/mind-elixir/index.html` | listener adaptation (selectNewNode), setDirection handler, apply-direction-on-load, verification of existing integrations |
| `static/index.html` | `MindmapPage`: direction state, 4 direction buttons, setDirection postMessage, root:true normalization, iframe `?v=120` |
| `static/sw.js` | CACHE name bump `taskflow-v215-mindmap-layout` |

No backend, schema, offline-router, or outline-module changes.
