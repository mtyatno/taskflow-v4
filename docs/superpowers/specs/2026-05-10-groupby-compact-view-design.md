# Design Spec: Group-By & Compact View for TaskListView

**Date:** 2026-05-10  
**Status:** Approved  
**Scope:** `TaskListView` component in `static/index.html`

---

## Overview

Add two toggleable display modes to all GTD task list pages (Inbox, Next Actions, Waiting For, Someday, Q1–Q4):

1. **Group-By** — group tasks into collapsible sections by a chosen field
2. **Compact View** — render each task as a minimal row (checkbox + title + date only)

Both preferences are global (apply to all pages), persisted in `localStorage`, and can be toggled freely by the user at any time.

---

## 1. Toolbar

A new control bar is inserted **above** the existing filter card, inside `TaskListView`.

```
[ Group by: ▾ None ]                    [ ▤ Compact ]  [ ▦ Normal ]
```

### Group-By Dropdown

- Options: **None · Priority · Quadrant · Project · Context · Tag**
- "Tag" groups by the first tag on the task (tasks with no tags go to "(Tanpa Tag)")
- localStorage key: `taskflow_groupby` (default: `"none"`)

### View Mode Toggle

- Two icon-buttons: Compact (▤) and Normal (▦)
- Active button is highlighted with accent color
- localStorage key: `taskflow_viewmode` (default: `"normal"`)

### Toolbar placement

- Rendered as a single flex row, right-aligned toggle buttons
- Visible on all pages that show `TaskListView` (respects existing `showFilters` prop — toolbar always shown regardless of `showFilters`)

---

## 2. Grouping Logic

### When `groupBy === "none"`

Render tasks in a single flat list (current behavior), sorted by priority (P1→P4).

### When `groupBy !== "none"`

1. Extract the group key for each task:
   - `priority` → `task.priority` ("P1"–"P4"), label: "🔴 P1 Critical" etc.
   - `quadrant` → `task.quadrant` ("Q1"–"Q4"), label: "🔥 Q1 Lakukan" etc.
   - `project` → `task.project || "(Tanpa Project)"`
   - `context` → `task.context || "(Tanpa Context)"`
   - `tag` → `task.tags?.[0] || "(Tanpa Tag)"`

2. Build an ordered map: `Map<groupKey, task[]>`
   - Priority groups: ordered P1→P4→(Tanpa)
   - Quadrant groups: ordered Q1→Q4→(Tanpa)
   - Project/Context/Tag groups: alphabetical, "(Tanpa X)" last

3. Render each group as a collapsible section (see Section 3).

4. Existing filters (priority, quadrant, project, context, search) are applied **before** grouping — groups only show tasks that pass the filters.

---

## 3. Collapsible Group Header

Each group renders:

```
▼  📁 Jatahku  ·  3 tasks
────────────────────────────────
  [task rows]
```

- Header is a flex row: chevron icon (▼/▶) + group label + task count
- Clicking anywhere on the header toggles collapsed state
- Collapsed state is **in-memory only** (resets on page refresh / page change) — not persisted
- All groups start **expanded** by default
- Collapse animation: `max-height` transition (simple CSS, no library)
- "(Tanpa X)" groups appear last and start **collapsed** by default

---

## 4. Compact Row

When `viewMode === "compact"`, each task renders as a slim row instead of `TaskRow`.

### Compact row content

```
☐  Judul task                          10-05-2026
```

- Checkbox (done action, same as TaskRow)
- Task title — full width, truncated with ellipsis if too long
- Deadline date — right-aligned, small font (12px), red if overdue, muted if not
- No progress bar
- No priority/quadrant badges
- No project/context labels
- Padding: `8px 12px` (vs `12px 16px` in normal)

### Compact row interaction

- Click row → opens `TaskDetailModal` (same as normal)
- Click checkbox → marks done (same as normal)
- Hover: subtle background highlight

### Normal row

When `viewMode === "normal"` → render existing `TaskRow` component unchanged.

---

## 5. State & Persistence

```js
// Read on mount (inside TaskListView)
const [groupBy, setGroupBy] = useState(() =>
  localStorage.getItem("taskflow_groupby") || "none"
);
const [viewMode, setViewMode] = useState(() =>
  localStorage.getItem("taskflow_viewmode") || "normal"
);

// Write on change
const handleGroupBy = (val) => {
  setGroupBy(val);
  localStorage.setItem("taskflow_groupby", val);
};
const handleViewMode = (val) => {
  setViewMode(val);
  localStorage.setItem("taskflow_viewmode", val);
};
```

Collapsed groups state: `useState({})` — object keyed by group label, value `true` = collapsed.

---

## 6. Rendering Flow

```
TaskListView
  ├── Toolbar (groupBy dropdown + viewMode toggle)
  ├── Filter card (existing — unchanged)
  └── Task list area
        ├── [groupBy === "none"]
        │     └── flat list of TaskRow or CompactRow
        └── [groupBy !== "none"]
              └── for each group:
                    ├── GroupHeader (collapsible)
                    └── [if not collapsed]
                          └── list of TaskRow or CompactRow
```

---

## 7. Implementation Scope

**In scope:**
- Toolbar UI (group-by dropdown + view toggle)
- `CompactRow` inline component (defined inside `TaskListView`)
- `GroupHeader` inline component (defined inside `TaskListView`)
- Grouping + sorting logic
- localStorage persistence
- Collapse animation

**Out of scope:**
- Drag-and-drop between groups
- Persistent collapse state across sessions
- Per-page group preferences
- Sorting within groups beyond default priority sort

---

## 8. Affected Files

| File | Change |
|------|--------|
| `static/index.html` | Extend `TaskListView` function (~4362) — add toolbar, grouping logic, `CompactRow`, `GroupHeader` |

No backend changes required.
