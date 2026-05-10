# Design Spec: Kanban View

**Date:** 2026-05-10
**Status:** Approved

---

## Overview

Add a Kanban board as a third view mode in `TaskListView`, alongside existing Normal (▦) and Compact (▤). Columns are driven by the active Group By selection. Cards support HTML5 drag-and-drop to move tasks between columns, which triggers a PATCH to the backend. No backend changes required.

---

## 1. View Mode Toggle

The existing toolbar has two view mode buttons: Normal (▦) and Compact (▤). Add Kanban (⊞) as the third:

```
[Group by: Priority ▾]          [▦] [⊞] [▤]
```

- `viewMode` state gains a third value: `"kanban"` (persisted to `localStorage` key `tf_viewmode`)
- **Kanban button disabled** when `groupBy === "none"`: grayed out, `cursor: not-allowed`, tooltip "Pilih Group by terlebih dahulu"
- If `viewMode === "kanban"` and user switches `groupBy` to `"none"`, auto-revert `viewMode` to `"normal"`

---

## 2. Components

### `KanbanView`

```
KanbanView({ groups, groupBy, onTaskClick, onDone, onMoveTask })
```

- `groups` — output from existing `buildGroups()` in `TaskListView`. No new grouping logic.
- `groupBy` — passed through so `KanbanCard` can show the right secondary info.
- `onMoveTask(taskId, targetGroupKey)` — called on drop.
- Layout: horizontal flex container with `overflow-x: auto`, each column is `280px` wide, fixed.
- Column height: `calc(100vh - 240px)` with `overflow-y: auto` per column so long columns scroll independently.

### `KanbanColumn`

Each group from `buildGroups()` renders as one column:

```
┌─────────────────────────────┐
│ 🔴 P1 Critical          [3] │  ← sticky header
├─────────────────────────────┤
│  ┌─────────────────────┐    │
│  │ card                │    │
│  └─────────────────────┘    │
│  ┌─────────────────────┐    │
│  │ card                │    │
│  └─────────────────────┘    │
│                             │
│  (drop indicator zone)      │
└─────────────────────────────┘
```

- Header: group label + count badge (color-coded per priority/quadrant, neutral for project/context)
- `onDragOver` → `e.preventDefault()` + set `isDragOver` state → highlight column (dashed accent border + light bg tint)
- `onDragLeave` + `onDrop` → clear `isDragOver`
- `onDrop` → extract `taskId` from `e.dataTransfer.getData("text/plain")` → call `onMoveTask(taskId, column.key)`
- Empty column: shows "Tidak ada task" placeholder — still accepts drops

### `KanbanCard`

```
KanbanCard({ task, groupBy, onTaskClick, onDone })
```

Card layout:

```
┌──────────────────────────────┐
│ ☐  Task title yang panjang   │
│    bisa wrap ke baris ke-2   │
│                              │
│ [P1]  07-05-2026      🔥 Q1  │
└──────────────────────────────┘
```

- `draggable="true"`
- `onDragStart` → `e.dataTransfer.setData("text/plain", task.id)` + set card to 50% opacity
- `onDragEnd` → restore opacity
- Click body → `onTaskClick(task)`
- Checkbox → `onDone(task.id)`
- Priority badge colored (P1=#ef4444, P2=#f97316, P3=#eab308, P4=#22c55e)
- Deadline colored red if overdue, orange if today, default text-light otherwise
- Quadrant shown as secondary label (right side, small) — only when `groupBy !== "quadrant"`
- `cursor: grab`, `cursor: grabbing` while dragging

---

## 3. `onMoveTask` — Property Mapping

`TaskListView` implements `onMoveTask(taskId, targetGroupKey)`:

1. Parse `targetGroupKey` to extract the actual property value:

| groupBy | targetGroupKey example | parsed value |
|---------|------------------------|--------------|
| `priority` | `"🔴 P1 Critical"` | `"P1"` |
| `priority` | `"(Tanpa Priority)"` | `null` |
| `quadrant` | `"🔥 Q1 Lakukan"` | `"Q1"` |
| `quadrant` | `"(Tanpa Quadrant)"` | `null` |
| `project` | `"My Project"` | `"My Project"` |
| `project` | `"(Tanpa Project)"` | `null` |
| `context` | `"@Home"` | `"@Home"` |

For priority: extract with regex `/P[1-4]/`. For quadrant: `/Q[1-4]/`. For project/context: use the key directly (strip "(Tanpa ...)" → null).

2. **Optimistic update**: update `tasks` state locally — move the task to new group immediately in UI.

3. PATCH `/api/tasks/:id` with `{ [fieldName]: parsedValue }` where fieldName = `priority` | `quadrant` | `project` | `context`.

4. On error: revert state + `showToast("Gagal memindahkan task", "error")`.

5. Skip if `targetGroupKey === sourceGroupKey` (dropped in same column).

---

## 4. Drag Behavior Detail

- `onDragStart` on card: store `taskId` in dataTransfer + `sourceGroupKey` in a module-level ref (not dataTransfer, to avoid cross-origin restrictions)
- `onDragOver` on column: `e.preventDefault()` (required to allow drop) + toggle column highlight
- `onDragLeave` on column: remove highlight — but guard against child element triggers with `e.relatedTarget` check
- `onDrop` on column: `e.preventDefault()`, read taskId from dataTransfer, call `onMoveTask`
- `onDragEnd` on card: always clear opacity (covers the case where drop happened outside any column)

---

## 5. Empty State & Edge Cases

| Situation | Behavior |
|-----------|----------|
| Column empty | Shows "Tidak ada task" — still accepts drops |
| `groupBy = "none"` + `viewMode = "kanban"` | Auto-switch viewMode to "normal" |
| Kanban button when `groupBy = "none"` | Disabled, tooltip explains why |
| Drag task to same column | No-op (skip PATCH) |
| PATCH fails | Revert UI + toast error |
| `tag` groupBy selected | Kanban disabled for tags (tags are multi-value; reassigning is ambiguous) |

For `groupBy === "tag"`: also disable Kanban button. Tag is a many-to-many relationship — dropping into a column would need to add/remove a tag, which is out of scope.

---

## 6. Affected Files

| File | Change |
|------|--------|
| `static/index.html` | Add `KanbanView`, `KanbanColumn`, `KanbanCard` components; extend `TaskListView` with `"kanban"` viewMode, disabled state logic, and `onMoveTask` handler |

No backend changes. Existing `PATCH /api/tasks/:id` endpoint handles all property updates.
