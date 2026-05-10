# Design Spec: Mindmap Node Linking

**Date:** 2026-05-10
**Status:** Approved

---

## Overview

Allow mindmap nodes to be linked to existing notes and tasks. Links are stored inside the node's data (no new DB table). A link panel lives inside the mind-elixir iframe so it persists in fullscreen mode.

---

## 1. Data Model

Links are stored as a `links` array on each node object inside `data_json`. mind-elixir preserves unknown properties through `getData()`, so links survive the existing autosave cycle with no backend changes.

```json
{
  "id": "node-abc",
  "topic": "Auth Revamp",
  "links": [
    { "type": "note", "id": 5, "title": "Auth Redesign Spec" },
    { "type": "task", "id": 12, "title": "Implement JWT refresh" }
  ],
  "children": [...]
}
```

**No backend changes.** Existing `PUT /api/mindmaps/:id` with `data_json` handles persistence unchanged.

Backlinks (showing "this note is referenced from mindmap X") are out of scope.

---

## 2. Link Panel — Inside the iframe

The panel lives inside `vendor/mind-elixir/index.html` (vanilla HTML/JS), not in the parent React app. This means the panel is visible even when the mindmap canvas is fullscreen.

### Layout

```
┌──────────────────────────────────────────────┐
│  mind-elixir canvas  (flex: 1, min-height:0) │
├──────────────────────────────────────────────┤
│  🔗 Links — {node topic}           [✕ tutup] │  ← ~130px, shown when node selected
│  ┌─────────────────┐ ┌─────────────────┐ [+]  │
│  │ NOTE  Title  ↗✕│ │ TASK  Title  ↗✕│      │
│  │ preview text... │ │ P1 · Due 15 Mei │      │
│  └─────────────────┘ └─────────────────┘      │
└──────────────────────────────────────────────┘
```

Panel shows when a node is selected; collapses (display:none) when deselected or ✕ closed.

Nodes with at least one link show a small badge (count) in the top-right corner. Badge is rendered via a custom node style stored in the node's `style` property — set when links are added/removed.

### Panel content per link item

| Field | Notes |
|-------|-------|
| Type badge | `NOTE` (purple) or `TASK` (orange) |
| Title | note.title / task.title |
| Preview | Note: first ~60 chars of content. Task: priority badge + deadline + status |
| ↗ button | Sends postMessage to parent to open the modal |
| ✕ button | Removes link from node data, triggers autosave |

---

## 3. postMessage Protocol

All messages use `window.location.origin` as targetOrigin.

### iframe → parent

| type | payload | when |
|------|---------|------|
| `nodeSelected` | `{nodeId, topic, links}` | user clicks a node |
| `nodeDeselected` | — | user clicks empty space |
| `openNote` | `{id}` | user clicks ↗ on a note link |
| `openTask` | `{id}` | user clicks ↗ on a task link |
| `requestLinkPicker` | `{nodeId}` | user clicks "+ Tambah link" |
| `change` | `{data}` | any edit including link add/remove (existing) |

### parent → iframe

| type | payload | when |
|------|---------|------|
| `load` | `{data}` | mindmap selected (existing) |
| `addLink` | `{nodeId, link: {type,id,title}}` | user picked item in LinkPickerModal |
| `clearPanel` | — | called on `load` to reset panel state when switching mindmap |

---

## 4. iframe Changes (`vendor/mind-elixir/index.html`)

### HTML structure

```html
<div id="app" style="display:flex;flex-direction:column;height:100%;overflow:hidden">
  <div id="map" style="flex:1;min-height:0;overflow:hidden"></div>
  <div id="link-panel" style="display:none; ...">
    <!-- panel content, managed by JS -->
  </div>
</div>
```

### JS additions

**Node selection listeners:**
```js
mind.bus.addListener('selectNode', (nodeObj) => {
  const d = nodeObj.nodeData;
  currentNodeId = d.id;
  renderPanel(d.topic, d.links || []);
  window.parent.postMessage(
    { type: 'nodeSelected', nodeId: d.id, topic: d.topic, links: d.links || [] },
    window.location.origin
  );
});

mind.bus.addListener('unselectNode', () => {
  currentNodeId = null;
  hidePanel();
  window.parent.postMessage({ type: 'nodeDeselected' }, window.location.origin);
});
```

**Incoming `addLink` message:**
```js
if (e.data.type === 'addLink' && e.data.nodeId === currentNodeId) {
  const node = findNode(mind.getData().nodeData, e.data.nodeId);
  if (node) {
    node.links = [...(node.links || []), e.data.link];
    renderPanel(node.topic, node.links);
    updateNodeBadge(node);
    // trigger autosave via existing mechanism
    window.parent.postMessage({ type: 'change', data: mind.getData() }, window.location.origin);
  }
}
```

**Recursive node finder:**
```js
function findNode(node, id) {
  if (node.id === id) return node;
  for (const c of node.children || []) {
    const found = findNode(c, id);
    if (found) return found;
  }
  return null;
}
```

**Panel renderer** (`renderPanel(topic, links)`): builds link card HTML, wires ↗ and ✕ buttons.

**Remove link** (✕ handler inside iframe):
- Remove from `node.links`
- Re-render panel
- Update badge
- Post `{type: 'change', data: mind.getData()}` to trigger autosave

---

## 5. Parent (`MindmapPage`) Changes

### New props

`MindmapPage` currently only receives `{ showToast }`. Add two props:

```jsx
function MindmapPage({ showToast, onTaskClick, tasks = [] })
```

- `onTaskClick` — already passed by App to other pages (Dashboard, TodayFocusView, etc.); wire the same prop here
- `tasks` — passed for TaskDetailModal context (same pattern as other pages)

For opening notes, `MindmapPage` manages its own `NoteModal` state inline (same pattern as `NotesPage`):

```js
const [modalNote, setModalNote] = useState(null); // open NoteModal when non-null
```

### New state

```js
const [showLinkPicker, setShowLinkPicker]   = useState(false);
const [pickerNodeId, setPickerNodeId]       = useState(null);
const [currentNodeLinks, setCurrentNodeLinks] = useState([]); // links of selected node
```

### Extended message handler (existing useEffect)

```js
if (e.data.type === 'nodeSelected') {
  setCurrentNodeLinks(e.data.links || []);
}
if (e.data.type === 'nodeDeselected') {
  setCurrentNodeLinks([]);
}
if (e.data.type === 'openNote') {
  api.get(`/api/scratchpad/${e.data.id}`).then(note => setModalNote(note));
}
if (e.data.type === 'openTask') {
  const task = tasks.find(t => t.id === e.data.id);
  if (task) onTaskClick(task);
  else api.get(`/api/tasks/${e.data.id}`).then(t => onTaskClick(t));
}
if (e.data.type === 'requestLinkPicker') {
  setPickerNodeId(e.data.nodeId);
  setShowLinkPicker(true);
}
```

### LinkPickerModal (new component)

- Props: `nodeId`, `existingLinks`, `onSelect(link)`, `onClose`
- Uses existing `/api/search?q=...` endpoint (returns `{tasks, notes}`)
- Filter tabs: Semua / Notes / Tasks
- Excludes already-linked items using `existingLinks` (from `currentNodeLinks` state)
- On select: parent sends `{type:'addLink', nodeId, link}` to iframe, updates `currentNodeLinks`, closes modal

---

## 6. Affected Files

| File | Change |
|------|--------|
| `static/vendor/mind-elixir/index.html` | Add panel HTML, node selection listeners, `addLink` handler, `findNode`, `renderPanel`, badge update |
| `static/index.html` | Add `onTaskClick` + `tasks` props to MindmapPage; extend message handler (openNote, openTask, requestLinkPicker, nodeSelected, nodeDeselected); add `LinkPickerModal` component; add inline `NoteModal` render in MindmapPage; wire picker flow |

No changes to backend, no new DB tables, no changes to any other component.

---

## 7. Open Questions (resolved)

- **Backlinks?** No — out of scope.
- **Link storage?** In `data_json` per node — no DB migration.
- **Panel placement?** Inside the iframe for fullscreen compatibility.
- **Search API?** Reuse existing `/api/search?q=`.
