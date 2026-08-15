# Mindmap Outline Mode — Design Specification

**Date:** 2026-08-15
**Author:** Claude Code & User
**Status:** Approved by User
**Target:** TaskFlow WebApp (`static/index.html`, `static/vendor/mind-elixir/index.html`)

---

## 1. Executive Summary & Goals

The TaskFlow mindmap editor is a canvas-only view (mind-elixir inside an iframe), which is hard to scan and edit on small screens and for large maps. This spec adds an **outline mode**: a hierarchical text view of the same mindmap data with full editing capability. Like XMind — two views, one data. Changes made in the outline appear immediately in the canvas and vice versa.

### Primary Objectives
1. **Two views, one data**: canvas and outline always render the same tree; every edit in either view syncs to the other and persists.
2. **Full editing in outline (P0)**: inline rename, add child/sibling, delete/duplicate, indent/outdent, drag reorder, collapse/expand.
3. **Power features (P1)**: search node, expand/collapse all, context menu, undo/redo, copy/paste branch.
4. **Mobile-friendly**: all P0/P1 operations reachable via tap (buttons + context menu), no keyboard required.
5. **Zero disruption to existing flows**: save (debounced `api.put`), offline local-first, sharing, and node links all keep working unchanged.

### Out of Scope (deferred to V2+)
- **V2**: icon per node, checkbox/task mode (both require new fields in the mindmap data model + canvas rendering).
- **Not planned**: multi-select, notes per node (links already cover this), tag system, breadcrumb, focus mode, virtual scrolling, real-time collaboration, version history, AI-generated nodes.

---

## 2. Architecture

**Principle:** the iframe mind-elixir stays the *canvas engine*; the React parent becomes the *single source of truth* for the tree during outline mode.

```
┌────────────────────────── MindmapPage (React, static/index.html) ──────────────────────────┐
│  state: viewMode ("canvas"|"outline"), outlineTree, syncStatus, outlineUndo/outlineRedo    │
│                                                                                             │
│  ┌─ sidebar list ─┐   ┌─ canvas view ─────────────┐   ┌─ outline view (new) ──────────────┐ │
│  │ (existing)      │   │ iframe mind-elixir        │   │ MindmapOutline component:        │ │
│  │                 │   │ (always mounted,          │   │ search box, expand/collapse all, │ │
│  │                 │   │  display:none in outline) │   │ recursive rows, context menu      │ │
│  └─────────────────┘   └──────────────────────────┘   └────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────────────────────┘
```

### 2.1 Source of Truth for the Tree

- `outlineTree` in `MindmapPage` holds the latest serializable tree (`{nodeData, arrows?, summaries?, theme?}` — the same shape as `data_json` / `mind.getData()`).
- `outlineTree` is updated from two directions:
  1. **Canvas → parent**: existing postMessage `change` handler (fires on every mind-elixir `operation`). Update `outlineTree` + schedule save. (Already exists; add the state update.)
  2. **Outline → parent**: user edits run a pure transform on `outlineTree`, then setState + schedule save + post `refresh` to the iframe.

### 2.2 Sync Protocol (postMessage)

All messages keep the existing `e.origin !== window.location.origin` guard.

| Direction | Type | Payload | Notes |
|---|---|---|---|
| parent → iframe | `load` | `data` | Existing. Used when switching mindmaps. |
| parent → iframe | `refresh` | `data` | **New.** Iframe handler calls `mind.refresh(data)` — re-renders canvas layout from new tree *without* re-initializing the instance. Verified present in the vendored `MindElixir.iife.js` (`refresh:function(e){...}` deep-clones `e`, replaces `nodeData`, calls `layout()` + `linkDiv()`). |
| parent → iframe | `clearPanel` | — | Existing. |
| iframe → parent | `change` | `data` (full tree) | Existing. Fired by canvas user operations. |
| iframe → parent | `ready`, `nodeSelected`, `nodeDeselected`, `openNote`, `openTask`, `requestLinkPicker` | — | Existing. Unchanged. |

- **No echo loop**: `mind.refresh()` does not fire the `operation` bus event, so a parent-initiated `refresh` never produces a `change` back to the parent. This must be re-verified during implementation with a browser test.
- **Canvas state preserved across mode switches**: the iframe is never unmounted while the mindmap is open — it is hidden with `display:none` during outline mode, so zoom/position persist. `refresh()` may reset scroll position; acceptable (outline edits change the layout anyway).

### 2.3 Save Pipeline (unchanged)

Both canvas and outline edits funnel into the existing debounced save:

```
edit → setSyncStatus("saving") → clearTimeout(saveTimer) → setTimeout 1000ms →
       api.put(`/api/mindmaps/${mid}`, { data_json: JSON.stringify(outlineTree) })
         → setSyncStatus("saved") | "offline" (catch)
```

The offline local-first interceptor (`static/offline/mindmaproutes.js`) works unchanged since the request path and payload shape are identical.

---

## 3. Components

### 3.1 `MindmapOutline` (new React component in `static/index.html`)

Props: `tree`, `onEdit(nextTree)` (parent applies setState + save + refresh), `onFocusNode(id)` (reserved for future "focus in canvas" navigation), `syncStatus`, `showToast`.

Rendering rules:
- Recursive render of `tree.nodeData.children`; root topic rendered as the top row (not deletable, not outdentable).
- Each row: collapse caret (▶/▼, hidden when no children), topic text, link badge (count of `node.links`), hover action buttons (↑, ↓, ✏️, ⋮).
- Indentation by depth; rows use existing CSS variables (`--border`, `--bg-*`, `--accent`) to match light/dark themes.
- Selected row highlight; single active cursor row per outline.
- Empty children arrays render nothing; expanded state read from `node.expanded` (mind-elixir convention: `expanded !== false` means expanded), so collapse state syncs with the canvas for free.

### 3.2 Transform Helpers (new pure functions)

All helpers take `(tree, nodeId, ...)` and return a new tree. They must preserve every node field except the ones they intentionally change — especially `id`, `topic`, `root`, `children`, `links`, `expanded`, `direction`, `theme`-level data. Implemented in the same file near `MindmapOutline` with unit tests.

| Helper | Behavior |
|---|---|
| `outlineFindNode(nodeData, id)` | Recursive find returning node + parent + index (or nulls). |
| `outlineAddChild(tree, parentId, topic?)` | Appends new node `{id: uid(), topic: "Node baru", children: [], expanded: true}` to parent's children; auto-expands parent. |
| `outlineAddSibling(tree, nodeId, after=true)` | Inserts new node after (or before) the given node. Root: appends a child instead. |
| `outlineRename(tree, nodeId, topic)` | Replaces `topic` (trimmed; empty input cancels). |
| `outlineDelete(tree, nodeId)` | Removes node; returns same tree if root. |
| `outlineDuplicate(tree, nodeId)` | Deep-clones the subtree with fresh ids, inserts after original (sibling), or as first child if root. |
| `outlineMoveUp/Down(tree, nodeId)` | Swaps position with adjacent sibling; no-op at boundaries/root. |
| `outlineIndent(tree, nodeId)` | Makes node the last child of the previous sibling (classic outline semantics); no-op for root/first child. |
| `outlineOutdent(tree, nodeId)` | Makes node a sibling after its parent; no-op for root or top-level children. |
| `outlineToggleExpand(tree, nodeId)` | Flips `node.expanded`. |
| `outlineExpandAll / outlineCollapseAll(tree)` | Sets `expanded = true/false` on every node with children. |
| `outlineCloneSubtree(node)` | Deep clone with regenerated ids for copy/paste branch. |
| `outlineSearch(tree, query)` | Returns matched node ids; UI auto-expands ancestors and highlights matches (case-insensitive substring on `topic`). |

`uid()` reuses the existing id generator already used in the codebase.

### 3.3 `MindmapPage` modifications

- New state: `viewMode` (`"canvas"` default, session-only — resets to canvas on page load), `outlineTree`, `outlineUndoStack`, `outlineRedoStack`.
- Toggle UI: a small segmented control / two-icon button rendered above the canvas/outline area (visible only when a mindmap is selected). Not inside the iframe.
- `outlineTree` initialized from `selected.data_json` when a mindmap loads (same `useEffect` that posts `load`); reset to `null` when selection cleared.
- Existing `change` handler additionally does `setOutlineTree(e.data.data)`.
- New `handleOutlineEdit(nextTree)`: pushes previous tree onto `outlineUndoStack` (cap 50, clear redo), `setOutlineTree`, `scheduleSave`, post `refresh` to iframe.
- Undo/redo: `Ctrl+Z` / `Ctrl+Shift+Z` (and Ctrl+Y) captured in the outline container while outline mode active; restore snapshot, schedule save, post `refresh`. Undo stacks reset on mindmap switch. Canvas undo history is separate — documented limitation: outline edits do not appear in canvas Ctrl+Z history; after a parent-initiated `refresh`, canvas undo history may be stale (acceptable for V1, documented in UI docs if a clean history-reset API exists in mind-elixir, use it).
- Switching mode: pure UI toggle (`display:none` on the iframe container vs outline container). No data transfer needed at switch time because `refresh` keeps the iframe continuously in sync.
- Root can be renamed but never deleted, outdented, indented, moved, or duplicated-as-sibling.

### 3.4 Iframe vendor modifications (`static/vendor/mind-elixir/index.html`)

- Add one branch in the `message` listener:
  ```js
  if (e.data && e.data.type === 'refresh') { mind && mind.refresh(e.data.data); }
  ```
- Nothing else changes. `?v=118` query bumped to `?v=119` in the iframe `src` and SW version bumped in `static/sw.js` so clients get the new files.

---

## 4. Interactions

### 4.1 Keyboard (desktop)

| Key | Action |
|---|---|
| ↑ / ↓ | Move active row |
| Enter | Add sibling after active row (consistent with canvas tour: Enter = sibling) |
| Tab | Add child to active row (consistent with canvas tour: Tab = child) |
| Shift+Tab | Outdent active row |
| F2 or double-click | Inline rename (input replaces topic text) |
| Delete / Backspace | Delete node (root protected) |
| Ctrl+D | Duplicate node |
| Ctrl+C / Ctrl+V | Copy / paste subtree (parent-internal clipboard; paste inserts as child of active row) |
| Ctrl+Z / Ctrl+Shift+Z (Ctrl+Y) | Undo / redo outline edits |
| Alt+↑ / Alt+↓ | Move node up / down |

Inline edit behavior: Enter commits, Esc cancels; empty text cancels the rename.

### 4.2 Touch / mobile

- Row tap selects; ✏️ button opens inline rename; ⋮ opens context menu; ↑/↓ hover buttons reorder.
- Context menu (also right-click on desktop): Rename, Tambah child, Tambah sibling, Duplikat, Hapus, Indent, Outdent.
- Search box at top filters rows, auto-expands ancestors, highlights matches.

### 4.3 Context Menu

Rendered as a small positioned popover near the row (React component, not native menu). Closes on outside click / Esc. Root row: Indent/Outdent/Hapus disabled.

---

## 5. Error Handling

- **Save failure / offline**: existing `syncStatus` flow — status shows "offline", data remains in `outlineTree`, toast "Gagal menyimpan" (existing).
- **Corrupt `data_json`**: `JSON.parse` failure keeps current behavior — mindmap fails to load with toast "Gagal memuat mindmap"; outline mode is not available for that mindmap.
- **Duplicate/race ids**: `outlineCloneSubtree` and duplicate always regenerate ids via `uid()`; collisions practically impossible and harmless (last write wins on save).
- **Mode switch mid-edit**: committing or canceling an inline rename before switching modes (input blur fires first; switch also commits the rename).
- **Multiple rapid edits**: debounced save keeps only the latest `outlineTree` (existing pattern).

---

## 6. Testing

### 6.1 Unit (node --test, new file `tests/mindmap-outline.test.js`)

Cover every transform helper with a fixture tree containing `links`, `expanded`, nested children:
- add child/sibling (positions, auto-expand, root handling)
- rename (trim/empty cancel)
- delete (root protected; sibling order preserved)
- duplicate / clone subtree (fresh ids, deep copy, links preserved)
- move up/down boundaries
- indent/outdent semantics + root/first-child no-ops
- toggle/expand-all/collapse-all (only nodes with children)
- search matches + ancestor expansion
- field preservation invariant: transforms never drop `links`/`expanded`/unknown fields

### 6.2 Browser verification (manual, after deploy)

1. Open mindmap → toggle outline → tree renders identically to canvas content.
2. Edit in outline (add/rename/indent/delete) → toggle canvas → changes visible.
3. Edit in canvas → toggle outline → changes visible.
4. Collapse a branch in outline → toggle canvas → branch collapsed there too.
5. Reload page → edits persisted (debounced save flushed).
6. DevTools offline → edit outline → syncStatus "offline" → online again → data saved (local-first queue).
7. Confirm `refresh` does not fire `operation` (no save/echo loop: Network tab shows no PUT storm).
8. Mobile viewport: all operations via tap; no overflow; safe-area respected.

### 6.3 Cache versioning

- Bump `static/sw.js` cache version.
- Bump iframe src `?v=118` → `?v=119` in `static/index.html`.

---

## 7. Files Touched

| File | Change |
|---|---|
| `static/index.html` | `MindmapPage` state/logic + toggle UI; new `MindmapOutline` component; transform helpers; iframe src version bump |
| `static/vendor/mind-elixir/index.html` | `refresh` message handler (few lines) |
| `static/sw.js` | cache version bump |
| `tests/mindmap-outline.test.js` | new unit tests |

No backend changes. No schema changes. No offline-router changes.
