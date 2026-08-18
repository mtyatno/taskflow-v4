# Mindmap Ops Panel — Mirror Context-Menu Items (mobile/tablet access) — Design Specification

**Date:** 2026-08-18
**Author:** Claude Code & User
**Status:** Approved by User (design in chat; spec pending review)
**Target:** `static/vendor/mind-elixir/index.html`, `static/index.html` (iframe version bump), `static/sw.js` (cache bump)

---

## 1. Executive Summary

The engine's built-in right-click context menu offers 11 actions, but only a subset (Child/Sibling/Promote/Edit/Delete) is reachable from the touch-friendly 🔧 Ops tab of the iframe sidebar. On tablets/phones there is no right-click, so the remaining actions — **Add Parent, Focus Mode, Cancel Focus Mode, Move up, Move down, Summary, Link, Bidirectional Link** — are inaccessible. This change adds all of them as buttons in the Ops panel, mirroring the desktop context menu exactly (labels, enable/disable logic, behavior).

## 2. Scope (user decision)

Full mirror (option "Lengkap" chosen by user): all context-menu items that Ops lacks, **plus** the items it already has remain. Long-press gesture (approach B) is explicitly out of scope for this iteration.

## 3. UI — `#node-ops-panel` (iframe)

New button order (all vertical list, existing CSS applies):

```
↳ Child        ↵ Sibling        ↑ Promote
⤴ Parent                          ← NEW (mind.insertParent())
─────────────────────────
✏️ Edit
─────────────────────────
🎯 Focus Mode                     ← NEW (mind.focusNode(el))
🎯 Cancel Focus Mode              ← NEW (mind.cancelFocus())
⇧ Move up                         ← NEW (mind.moveUpNode())
⇩ Move down                       ← NEW (mind.moveDownNode())
⧉ Summary                         ← NEW (mind.createSummary())
🔗 Link                           ← NEW (arrow flow, step 1)
⇄ Bidirectional Link              ← NEW (arrow flow, step 1, bidirectional)
─────────────────────────
🗑️ Hapus
```

- **Labels mirror the desktop context menu** (English) so users recognize the same actions; the panel already mixes EN/ID.
- **Root-guard (mirror engine context menu):** when the selected node is the root, disable Parent, Focus Mode, Move up, Move down (same set the engine disables via its `C` flag). Child, Summary, Link, Bidirectional Link stay enabled for root (engine behavior). Buttons render `disabled` attribute + reduced opacity (CSS `.disabled`-like styling via existing `#node-ops-panel button` rules; add a `:disabled` style).
- No-selection state: unchanged — Ops panel is not shown; the hint appears (existing `switchTab(null)` flow).

## 4. Link / Bidirectional Link — two-step flow

The engine's `createArrow(fromEl, toEl, {bidirectional})` needs a target node; the desktop context menu uses "click next node" mode. Ops mirrors it with taps:

1. Tap **Link** (or **Bidirectional Link**) → a hint element (engine's `.tips`-style, `position:fixed` near center-top) shows "Tap node target" and the button shows a temporary pressed state.
2. One-time `click` listener on the map (`{once:true}`, same semantics as the engine's `D()` function):
   - if the tap target is a node topic (`me-tpc`, whose parent is `ME-PARENT`/`ME-ROOT` — engine's own check) → `mind.createArrow(sourceEl, targetEl, {bidirectional})` (source = `mind.currentNodes[0]`).
   - any other tap → hint removed, nothing created (mirror of engine).
3. Hint is removed in both cases. Cancel on deselect: the wrapper's existing `unselectNodes` path clears panel state; the one-time listener is also removed if the user taps a non-node (already covered by `once`).

## 5. Data Flow & Persistence (no parent changes)

- Every new button calls a public engine method on the existing `mind` instance; the methods fire the engine's `operation` bus event (verified: `createArrow`/`createSummary`/move ops fire `operation`) → the iframe's existing `operation` listener already `postMessage({type:'change', data: mind.getData()})` → parent persists `data_json`.
- `mind.getData()` verified safe during focus mode: `isFocusMode ? nodeDataBackup : nodeData` — always the FULL tree, plus `arrows`, `summaries`, `direction`, `theme`. No data-loss risk; arrows/summaries were already persisted when created via desktop context menu.
- Focus Mode/Cancel are view-only states (engine `isFocusMode` + `nodeDataBackup`); they do not persist and must not.

## 6. Edge Cases

- **Focus on root** — engine `focusNode` guards `nodeObj.parent &&`; button disabled for root anyway.
- **Cancel Focus when not focused** — engine no-op (safe); button always enabled mirroring the context menu.
- **Move up/down on root or single child** — engine `Jt`/`Zt` guard `!n.parent`; no-op otherwise.
- **Summary with no selection** — engine `createSummary` returns early when `currentNodes` empty; Ops panel only shows when a node is selected, so this is belt-and-suspenders.
- **Arrow to self / duplicates** — engine allows whatever the context menu allows; we do not add extra validation (mirror).
- **Focus mode + panel state** — after `focusNode`, the wrapper's `currentNodeData` still references the live nodeObj (it exists in the focused subtree); Ops stays functional. Selection may be cleared by the engine (existing behavior).
- **Panel after Summary** — context menu calls `unselectNodes` after summary; the wrapper's wrapped `unselectNodes` hides the panel (existing behavior, unchanged).

## 7. Versioning & Deployment

- Bump the iframe reference in `static/index.html`: `/static/vendor/mind-elixir/index.html?v=132` → `?v=133` (SW cache-first; without the bump, devices keep the old iframe HTML).
- Bump SW cache name in `static/sw.js`: `taskflow-v234-mindmap-header-wrap` → `taskflow-v235-mindmap-ops-context-actions`.
- `MindElixir.iife.js`/`MindElixir.css` are unchanged (their `?v=120` refs stay).

## 8. Testing

- **Automated:** full suite `npm test` (currently 402 tests) must stay green (they don't cover this file, but regression check). Syntax-check the iframe inline script (one-off extraction + `node --check`, pattern used in previous session).
- **Manual device checklist (user):**
  1. Phone/tablet → open a mindmap → open sidebar (▸) → select a node → Ops shows all 13 buttons.
  2. Focus Mode → only subtree visible, header direction unchanged → Cancel Focus Mode → full tree restored.
  3. Move up/down reorder siblings; Summary creates a summary node.
  4. Link → hint appears → tap another node → arrow drawn; reload page → arrow persists (saved in `data_json`).
  5. Bidirectional Link → arrows both ways, persists after reload.
  6. Root node selected → Parent/Focus/Move up/Move down disabled.
  7. Desktop regression: right-click context menu unchanged and still works.

## 9. Non-Goals

- Long-press-to-open-context-menu gesture on touch (approach B — deferred).
- Replacing the engine's built-in context menu (no engine fork).
- Note/task link picker changes (the 🔗 Links tab is a separate link system and is untouched).
