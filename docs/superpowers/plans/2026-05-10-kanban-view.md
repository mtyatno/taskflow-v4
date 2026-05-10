# Kanban View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Kanban as a third view mode in TaskListView, with HTML5 drag-and-drop to move tasks between columns mapped to the active Group By dimension.

**Architecture:** Three new components (KanbanCard, KanbanColumn, KanbanView) are inserted before TaskListView in `static/index.html`. TaskListView gains a third viewMode `"kanban"`, a disabled-state for the toggle button when groupBy is unsupported, and an `onMoveTask` handler that calls the existing `PUT /api/tasks/:id` with only the changed field. Quadrant groupBy shows Kanban read-only (no DnD) because quadrant is auto-calculated. Tag and none groupBy disable the Kanban button entirely.

**Tech Stack:** React (CDN/Babel), HTML5 Drag and Drop API, existing `api.put` helper, existing `buildGroups()` grouping logic.

---

## Files

| File | Action | What changes |
|------|--------|-------------|
| `static/index.html` | Modify | Add `KanbanCard`, `KanbanColumn`, `KanbanView` components before `TaskListView`; extend `TaskListView` toolbar + render logic |

No backend changes — `PUT /api/tasks/:id` already accepts partial updates for `priority`, `project`, `context`.

---

## Task 1: KanbanCard component

**Files:**
- Modify: `static/index.html` — insert before `// ── Task List view with filters` comment (around line 4977)

- [ ] **Step 1: Find insertion point**

Search for this exact comment in `static/index.html`:
```
    // ── Task List view with filters ─────────────────────────────
```
Insert the new components immediately before that line.

- [ ] **Step 2: Insert KanbanCard**

```jsx
    // ── Kanban components ────────────────────────────────────────
    const PRI_COLOR_KANBAN = { P1: "#ef4444", P2: "#f97316", P3: "#eab308", P4: "#22c55e" };
    const PRI_BG_KANBAN    = { P1: "#ef444420", P2: "#f9731620", P3: "#eab30820", P4: "#22c55e20" };

    function KanbanCard({ task, groupBy, onTaskClick, onDone }) {
      const isOverdue = task.deadline && task.deadline < new Date().toISOString().slice(0, 10);
      const isToday   = task.deadline && task.deadline === new Date().toISOString().slice(0, 10);
      const deadlineColor = isOverdue ? "#ef4444" : isToday ? "#f97316" : "var(--text-light)";
      const canDrag = groupBy !== "quadrant";

      const handleDragStart = (e) => {
        e.dataTransfer.setData("text/plain", String(task.id));
        e.dataTransfer.effectAllowed = "move";
        setTimeout(() => { e.target.style.opacity = "0.4"; }, 0);
      };
      const handleDragEnd = (e) => { e.target.style.opacity = "1"; };

      return (
        <div
          draggable={canDrag}
          onDragStart={canDrag ? handleDragStart : undefined}
          onDragEnd={canDrag ? handleDragEnd : undefined}
          onClick={() => onTaskClick(task)}
          style={{
            background: "var(--bg-card)", border: "1px solid var(--border)",
            borderRadius: 8, padding: "8px 10px", cursor: canDrag ? "grab" : "pointer",
            transition: "border-color 0.15s, box-shadow 0.15s", userSelect: "none",
          }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = "var(--accent)"; e.currentTarget.style.boxShadow = "0 2px 8px rgba(108,122,224,0.15)"; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.boxShadow = "none"; }}
        >
          <div style={{ display: "flex", alignItems: "flex-start", gap: 6, marginBottom: 5 }}>
            <input
              type="checkbox"
              onClick={e => { e.stopPropagation(); onDone(task.id); }}
              style={{ marginTop: 2, flexShrink: 0, cursor: "pointer" }}
            />
            <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-primary)", lineHeight: 1.35, wordBreak: "break-word" }}>
              {task.title}
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
            {task.priority && (
              <span style={{ background: PRI_BG_KANBAN[task.priority], color: PRI_COLOR_KANBAN[task.priority],
                borderRadius: 3, padding: "1px 5px", fontSize: 9, fontWeight: 700, flexShrink: 0 }}>
                {task.priority}
              </span>
            )}
            {task.deadline && (
              <span style={{ fontSize: 10, color: deadlineColor, flexShrink: 0 }}>
                {task.deadline.slice(5)}
              </span>
            )}
            {task.quadrant && groupBy !== "quadrant" && (
              <span style={{ marginLeft: "auto", fontSize: 10, color: "var(--text-light)", flexShrink: 0 }}>
                {{"Q1":"🔥","Q2":"📅","Q3":"👋","Q4":"🗑️"}[task.quadrant]} {task.quadrant}
              </span>
            )}
          </div>
        </div>
      );
    }
```

- [ ] **Step 3: Verify no syntax errors**

Open the app in the browser. Open DevTools → Console. Navigate to any task list page (e.g., Next Actions). Should be no JS errors. KanbanCard is defined but not yet rendered.

- [ ] **Step 4: Commit**

```bash
git add static/index.html
git commit -m "feat: add KanbanCard component"
```

---

## Task 2: KanbanColumn component

**Files:**
- Modify: `static/index.html` — insert after KanbanCard, before `// ── Task List view with filters`

- [ ] **Step 1: Insert KanbanColumn immediately after KanbanCard**

```jsx
    function KanbanColumn({ groupKey, tasks, groupBy, dragSourceRef, onTaskClick, onDone, onMoveTask }) {
      const [isDragOver, setIsDragOver] = React.useState(false);
      const canDrop = groupBy !== "quadrant";

      const COL_COLORS = {
        "🔴 P1 Critical": "#ef4444", "🟠 P2 High": "#f97316",
        "🟡 P3 Medium": "#eab308",   "🟢 P4 Low": "#22c55e",
        "🔥 Q1 Lakukan": "#ef4444",  "📅 Q2 Rencanakan": "#3b82f6",
        "👋 Q3 Delegasikan": "#f97316","🗑️ Q4 Singkirkan": "#6b7280",
      };
      const accentColor = COL_COLORS[groupKey] || "var(--accent)";
      const isTanpa = groupKey.startsWith("(Tanpa");

      const handleDragOver = (e) => {
        if (!canDrop) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        setIsDragOver(true);
      };
      const handleDragLeave = (e) => {
        // Only clear if leaving the column entirely (not entering a child)
        if (!e.currentTarget.contains(e.relatedTarget)) setIsDragOver(false);
      };
      const handleDrop = (e) => {
        e.preventDefault();
        setIsDragOver(false);
        if (!canDrop) return;
        const taskId = parseInt(e.dataTransfer.getData("text/plain"), 10);
        if (!taskId || isNaN(taskId)) return;
        if (dragSourceRef.current === groupKey) return; // same column — no-op
        onMoveTask(taskId, groupKey);
      };

      return (
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          style={{
            width: 280, flexShrink: 0, background: isDragOver ? "rgba(108,122,224,0.06)" : "var(--bg-primary)",
            borderRadius: 10, border: isDragOver ? "2px dashed var(--accent)" : `1.5px solid ${isTanpa ? "var(--border)" : accentColor + "44"}`,
            display: "flex", flexDirection: "column", maxHeight: "calc(100vh - 240px)", overflow: "hidden",
            transition: "border-color 0.15s, background 0.15s",
          }}
        >
          {/* Header */}
          <div style={{
            padding: "10px 12px 8px", borderBottom: "1px solid var(--border)",
            display: "flex", justifyContent: "space-between", alignItems: "center",
            position: "sticky", top: 0, background: "var(--bg-primary)", zIndex: 1, borderRadius: "10px 10px 0 0",
          }}>
            <span style={{ fontWeight: 700, fontSize: 12, color: isTanpa ? "var(--text-secondary)" : accentColor }}>
              {groupKey}
            </span>
            <span style={{
              background: isTanpa ? "var(--bg-card)" : accentColor + "22",
              color: isTanpa ? "var(--text-light)" : accentColor,
              borderRadius: 10, padding: "1px 7px", fontSize: 10, fontWeight: 700,
            }}>
              {tasks.length}
            </span>
          </div>

          {/* Cards */}
          <div style={{ padding: 8, display: "flex", flexDirection: "column", gap: 6, overflowY: "auto", flex: 1 }}>
            {tasks.length === 0 ? (
              <div style={{ color: "var(--text-light)", fontSize: 11, textAlign: "center", padding: "16px 0" }}>
                Tidak ada task
              </div>
            ) : (
              tasks.map(t => (
                <KanbanCard key={t.id} task={t} groupBy={groupBy} onTaskClick={onTaskClick} onDone={onDone} />
              ))
            )}
            {isDragOver && (
              <div style={{ height: 48, border: "2px dashed var(--accent)", borderRadius: 8,
                display: "flex", alignItems: "center", justifyContent: "center" }}>
                <span style={{ fontSize: 10, color: "var(--accent)" }}>Drop di sini</span>
              </div>
            )}
          </div>
        </div>
      );
    }
```

- [ ] **Step 2: Verify no syntax errors**

Open the app. No JS errors in console. Still no visual change — KanbanColumn not yet rendered.

- [ ] **Step 3: Commit**

```bash
git add static/index.html
git commit -m "feat: add KanbanColumn component with HTML5 DnD drop zone"
```

---

## Task 3: KanbanView component

**Files:**
- Modify: `static/index.html` — insert after KanbanColumn, before `// ── Task List view with filters`

- [ ] **Step 1: Insert KanbanView immediately after KanbanColumn**

```jsx
    function KanbanView({ groups, groupBy, dragSourceRef, onTaskClick, onDone, onMoveTask }) {
      return (
        <div style={{ display: "flex", gap: 12, overflowX: "auto", paddingBottom: 12, alignItems: "flex-start" }}>
          {groups.map(({ key, tasks }) => (
            <KanbanColumn
              key={key}
              groupKey={key}
              tasks={tasks}
              groupBy={groupBy}
              dragSourceRef={dragSourceRef}
              onTaskClick={onTaskClick}
              onDone={onDone}
              onMoveTask={onMoveTask}
            />
          ))}
        </div>
      );
    }
```

- [ ] **Step 2: Verify no syntax errors**

Open the app. No JS errors in console.

- [ ] **Step 3: Commit**

```bash
git add static/index.html
git commit -m "feat: add KanbanView component"
```

---

## Task 4: Extend TaskListView — toolbar + onMoveTask + render

**Files:**
- Modify: `static/index.html` — changes inside `function TaskListView`

- [ ] **Step 1: Add `dragSourceRef` after existing `useRef` calls**

Find in `TaskListView`:
```js
      const iframeRef = useRef(null);
      const saveTimerRef = useRef(null);
```

There is no `iframeRef` in TaskListView. Find the existing state declarations block. After the last `useState` / `useRef` call in TaskListView (after `const [showFilterPanel, setShowFilterPanel] = useState(false);`), add:

```js
      const dragSourceRef = React.useRef(null); // tracks source groupKey during drag
```

- [ ] **Step 2: Add `onMoveTask` handler**

After `const clearAll = () => { ... };` (around line 5015), add:

```js
      const KANBAN_FIELD = { priority: "priority", project: "project", context: "context" };

      const parseGroupKeyValue = (key) => {
        if (key.startsWith("(Tanpa")) return "";
        if (groupBy === "priority") { const m = key.match(/P[1-4]/); return m ? m[0] : null; }
        if (groupBy === "quadrant") { const m = key.match(/Q[1-4]/); return m ? m[0] : null; }
        return key; // project / context: key IS the value
      };

      const onMoveTask = async (taskId, targetGroupKey) => {
        const field = KANBAN_FIELD[groupBy];
        if (!field) return; // quadrant — no-op
        const newValue = parseGroupKeyValue(targetGroupKey);
        if (newValue === null) return;

        // Optimistic update
        const prev = [...tasks]; // tasks prop from parent — used for revert signal only
        // We mutate the parent's tasks array indirectly through the filtered/groups view.
        // Revert is handled by re-fetching on error — parent's onDone / task refresh path.

        // Find task in filtered list to store original value for revert
        const task = filtered.find(t => t.id === taskId);
        if (!task) return;
        const originalValue = task[field];
        if (originalValue === newValue || (originalValue == null && newValue === "")) return; // no change

        // Optimistic: update task in place (mutate the object React is already rendering)
        task[field] = newValue;
        // Force re-render by updating a local counter
        setDragVersion(v => v + 1);

        try {
          await api.put(`/api/tasks/${taskId}`, { [field]: newValue });
        } catch (_) {
          // Revert
          task[field] = originalValue;
          setDragVersion(v => v + 1);
          showToast && showToast("Gagal memindahkan task", "error");
        }
      };
```

**Note:** `setDragVersion` requires a new state variable. Also add this with the other useState declarations:
```js
      const [dragVersion, setDragVersion] = useState(0);
```

And `showToast` is not currently a prop of `TaskListView`. Add it to the signature:

Find:
```js
    function TaskListView({ tasks, allTasks, title, icon, onTaskClick, onDone, onToggleFocus, loading, projects, contexts, showFilters, showQuadrant = true, collaborators = [] }) {
```

Replace with:
```js
    function TaskListView({ tasks, allTasks, title, icon, onTaskClick, onDone, onToggleFocus, loading, projects, contexts, showFilters, showQuadrant = true, collaborators = [], showToast }) {
```

- [ ] **Step 3: Update view mode toggle buttons**

Find:
```js
            <div style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
              {[["normal", "▦", "Normal"], ["compact", "▤", "Compact"]].map(([mode, ico, label]) => (
                <button type="button" key={mode} onClick={() => handleViewMode(mode)} title={label}
                  style={{ padding: "4px 10px", borderRadius: 6, border: "1px solid var(--border)",
                    cursor: "pointer", fontSize: 14, lineHeight: 1,
                    background: viewMode === mode ? "var(--accent)" : "var(--bg-card)",
                    color: viewMode === mode ? "#1a2a00" : "var(--text-secondary)",
                    fontWeight: viewMode === mode ? 700 : 400, transition: "all 0.15s" }}>
                  {ico}
                </button>
              ))}
            </div>
```

Replace with:
```jsx
            <div style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
              {[["normal", "▦", "Normal"], ["compact", "▤", "Compact"]].map(([mode, ico, label]) => (
                <button type="button" key={mode} onClick={() => handleViewMode(mode)} title={label}
                  style={{ padding: "4px 10px", borderRadius: 6, border: "1px solid var(--border)",
                    cursor: "pointer", fontSize: 14, lineHeight: 1,
                    background: viewMode === mode ? "var(--accent)" : "var(--bg-card)",
                    color: viewMode === mode ? "#1a2a00" : "var(--text-secondary)",
                    fontWeight: viewMode === mode ? 700 : 400, transition: "all 0.15s" }}>
                  {ico}
                </button>
              ))}
              {(() => {
                const kanbanDisabled = groupBy === "none" || groupBy === "tag";
                const kanbanTitle = kanbanDisabled ? "Pilih Group by terlebih dahulu" : "Kanban view";
                return (
                  <button type="button"
                    onClick={() => !kanbanDisabled && handleViewMode("kanban")}
                    title={kanbanTitle}
                    style={{ padding: "4px 10px", borderRadius: 6, border: "1px solid var(--border)",
                      cursor: kanbanDisabled ? "not-allowed" : "pointer", fontSize: 14, lineHeight: 1,
                      background: viewMode === "kanban" ? "var(--accent)" : "var(--bg-card)",
                      color: kanbanDisabled ? "var(--text-light)" : viewMode === "kanban" ? "#1a2a00" : "var(--text-secondary)",
                      fontWeight: viewMode === "kanban" ? 700 : 400, transition: "all 0.15s",
                      opacity: kanbanDisabled ? 0.45 : 1 }}>
                    ⊞
                  </button>
                );
              })()}
            </div>
```

- [ ] **Step 4: Add useEffect to revert viewMode when groupBy becomes unsupported**

After `const handleViewMode = ...` line, add:

```js
      useEffect(() => {
        if ((groupBy === "none" || groupBy === "tag") && viewMode === "kanban") {
          setViewMode("normal");
          localStorage.setItem("tf_viewmode", "normal");
        }
      }, [groupBy]);
```

- [ ] **Step 5: Add `onDragStart` tracking to cards via KanbanColumn**

The `dragSourceRef` needs to be set when drag starts from a card. The cleanest way: pass an `onCardDragStart` callback from `KanbanView` down to `KanbanCard`.

Update `KanbanView` call site in TaskListView render (Step 6 below) to pass `dragSourceRef`. The `KanbanColumn` already receives `dragSourceRef` and should set it in `handleDragOver`:

Actually, the cleanest approach: set `dragSourceRef.current` in the column's `onDragOver` isn't right. Instead, each card's `onDragStart` should set `dragSourceRef.current`.

Update `KanbanCard` component (from Task 1) to accept and call `onDragStart` prop:

Find in `KanbanCard`:
```js
      const handleDragStart = (e) => {
        e.dataTransfer.setData("text/plain", String(task.id));
        e.dataTransfer.effectAllowed = "move";
        setTimeout(() => { e.target.style.opacity = "0.4"; }, 0);
      };
```

Replace with:
```js
      const handleDragStart = (e) => {
        e.dataTransfer.setData("text/plain", String(task.id));
        e.dataTransfer.effectAllowed = "move";
        if (onCardDragStart) onCardDragStart();
        setTimeout(() => { e.target.style.opacity = "0.4"; }, 0);
      };
```

Update `KanbanCard` function signature:
```js
    function KanbanCard({ task, groupBy, onTaskClick, onDone, onCardDragStart }) {
```

Update `KanbanColumn` to pass `onCardDragStart` to each `KanbanCard`:
```jsx
              tasks.map(t => (
                <KanbanCard key={t.id} task={t} groupBy={groupBy} onTaskClick={onTaskClick} onDone={onDone}
                  onCardDragStart={() => { dragSourceRef.current = groupKey; }} />
              ))
```

- [ ] **Step 6: Wire KanbanView into TaskListView render**

Find the existing render logic (the big ternary at the bottom of TaskListView):
```js
          {loading ? (
            ...
          ) : filtered.length === 0 ? (
            ...
          ) : groupBy === "none" ? (
            ...
          ) : (
            <div className="card" style={{ overflow: "hidden", padding: 0 }}>
              {buildGroups(filtered).map(...)}
            </div>
          )}
```

Replace the final `(` branch (the grouped list) with:

```jsx
          ) : viewMode === "kanban" ? (
            <KanbanView
              groups={buildGroups(filtered)}
              groupBy={groupBy}
              dragSourceRef={dragSourceRef}
              onTaskClick={onTaskClick}
              onDone={onDone}
              onMoveTask={onMoveTask}
            />
          ) : (
            <div className="card" style={{ overflow: "hidden", padding: 0 }}>
              {buildGroups(filtered).map(({ key, tasks: groupTasks }, idx) => {
                const isTanpa = key.startsWith("(Tanpa");
                const isCollapsed = isTanpa ? (collapsed[key] !== false) : !!collapsed[key];
                return (
                  <div key={key}>
                    {idx > 0 && <div style={{ height: 1, background: "var(--border)" }} />}
                    <GroupHeader groupKey={key} count={groupTasks.length} isCollapsed={isCollapsed} onToggle={toggleGroup} />
                    {!isCollapsed && (
                      <div style={{ padding: viewMode === "compact" ? 0 : 8 }}>
                        {groupTasks.map(t => viewMode === "compact"
                          ? <CompactRow key={t.id} task={t} onTaskClick={onTaskClick} onDone={onDone} />
                          : <TaskRow key={t.id} task={t} onClick={onTaskClick} onDone={onDone} onToggleFocus={onToggleFocus} />
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
```

- [ ] **Step 7: Pass `showToast` to TaskListView where it's used**

Search for all `<TaskListView` usages:

```bash
grep -n "TaskListView" static/index.html
```

For each usage that doesn't already have `showToast`, add `showToast={showToast}` prop. The `showToast` function is available in the parent App component scope at each call site.

- [ ] **Step 8: Verify full flow manually**

1. Open app → navigate to Next Actions
2. Set Group by: Priority
3. Click ⊞ → Kanban view appears with 4 columns (P1/P2/P3/P4)
4. Drag a card from P3 column to P1 column → card moves instantly (optimistic)
5. Check DevTools Network tab → PUT `/api/tasks/:id` with `{priority: "P1"}` fired
6. Refresh page → task should still be in P1 column (persisted)
7. Set Group by: None → ⊞ button becomes grayed out/disabled
8. Set Group by: Quadrant → Kanban shows columns, cards NOT draggable (cursor: pointer not grab)
9. Set Group by: Project → DnD works, drag sets project name

- [ ] **Step 9: Commit**

```bash
git add static/index.html
git commit -m "feat: kanban view with DnD — toggle, columns, optimistic update"
```

---

## Self-Review

**Spec coverage:**
- ✅ Kanban as 3rd view mode (⊞ button) — Task 4 Step 3
- ✅ Columns follow Group By — KanbanView uses `buildGroups()` output — Task 3
- ✅ Disabled when groupBy=none or tag — Task 4 Step 3
- ✅ Auto-revert to normal when switching to unsupported groupBy — Task 4 Step 4
- ✅ DnD — KanbanCard draggable, KanbanColumn drop zone — Tasks 1, 2
- ✅ Quadrant read-only (no drag) — Task 1 `canDrag` logic
- ✅ Optimistic update + revert on error — Task 4 Step 2
- ✅ Empty column still accepts drops — Task 2
- ✅ `onMoveTask` field mapping: priority/project/context — Task 4 Step 2
- ✅ "(Tanpa X)" columns → empty string value — Task 4 `parseGroupKeyValue`
- ✅ `dragSourceRef` to detect same-column drop — Tasks 2, 4 Step 5
- ✅ `showToast` for error feedback — Task 4 Step 2 + 7

**Placeholder scan:** No TBDs. All code shown explicitly. ✅

**Type consistency:**
- `dragSourceRef` defined in Task 4 Step 1, passed through KanbanView → KanbanColumn → used in `handleDrop` and set via `onCardDragStart` callback
- `onMoveTask(taskId: number, targetGroupKey: string)` consistent across Task 4 Step 2 and Task 3
- `KanbanCard` prop `onCardDragStart` added in Task 4 Step 5 and referenced in Task 2 KanbanColumn card render
- `parseGroupKeyValue` returns `""` for "(Tanpa X)" — consistent with backend accepting `""` for project/context
- `KANBAN_FIELD` only maps priority/project/context — quadrant correctly returns undefined → no-op ✅
