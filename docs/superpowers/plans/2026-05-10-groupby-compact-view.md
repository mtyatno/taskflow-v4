# Group-By & Compact View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add group-by (collapsible sections per priority/quadrant/project/context/tag) and compact/normal view toggle to all GTD task list pages.

**Architecture:** All changes are inside `TaskListView` function in `static/index.html` (~line 4362). Three new inline components (`CompactRow`, `GroupHeader`) and one helper function (`buildGroups`) are added inside `TaskListView`. State is global via `localStorage`. No backend changes.

**Tech Stack:** React (Babel standalone, in-browser), inline JSX, localStorage for persistence.

---

## File Map

| File | Lines | Change |
|------|-------|--------|
| `static/index.html` | 4362–4479 | Extend `TaskListView` — state, helpers, toolbar, rendering |

---

## Task 1: Add groupBy / viewMode / collapsed state + handlers

**File:** `static/index.html` — inside `TaskListView`, after existing `useState` declarations (after line 4368)

- [ ] **Step 1: Find the anchor** — Locate this exact block in `static/index.html`:

```js
      const [fSearch, setFSearch] = useState("");

      const toggle = (setter, current, val) => setter(current === val ? "" : val);
```

- [ ] **Step 2: Replace with — add 3 new states + 3 handlers after fSearch:**

```js
      const [fSearch, setFSearch] = useState("");
      const [groupBy, setGroupBy] = useState(() => localStorage.getItem("taskflow_groupby") || "none");
      const [viewMode, setViewMode] = useState(() => localStorage.getItem("taskflow_viewmode") || "normal");
      const [collapsed, setCollapsed] = useState({});

      const toggle = (setter, current, val) => setter(current === val ? "" : val);
      const handleGroupBy = (val) => { setGroupBy(val); localStorage.setItem("taskflow_groupby", val); setCollapsed({}); };
      const handleViewMode = (val) => { setViewMode(val); localStorage.setItem("taskflow_viewmode", val); };
      const toggleGroup = (key) => {
        const isTanpa = key.startsWith("(Tanpa");
        const current = isTanpa ? (collapsed[key] !== false) : !!collapsed[key];
        setCollapsed(c => ({ ...c, [key]: !current }));
      };
```

- [ ] **Step 3: Verify** — Open browser, navigate to any task list page (Inbox, Someday, etc.). Page should still load and show tasks normally. Open DevTools → check no errors in console.

- [ ] **Step 4: Commit**

```
git add static/index.html
git commit -m "feat: add groupBy/viewMode/collapsed state to TaskListView"
```

---

## Task 2: Add buildGroups helper function

**File:** `static/index.html` — inside `TaskListView`, after the `clearAll` line (~line 4385), before `projList` derivation.

- [ ] **Step 1: Find the anchor:**

```js
      const clearAll = () => { setFPriority(""); setFQuadrant(""); setFProject(""); setFContext(""); setFAssignee(""); setFSearch(""); };

      // Derive projects/contexts from allTasks if not provided
```

- [ ] **Step 2: Replace with — add buildGroups between clearAll and projList:**

```js
      const clearAll = () => { setFPriority(""); setFQuadrant(""); setFProject(""); setFContext(""); setFAssignee(""); setFSearch(""); };

      const buildGroups = (tasks) => {
        const PRI_LABELS = { P1: "🔴 P1 Critical", P2: "🟠 P2 High", P3: "🟡 P3 Medium", P4: "🟢 P4 Low" };
        const QUAD_LABELS = { Q1: "🔥 Q1 Lakukan", Q2: "📅 Q2 Rencanakan", Q3: "👋 Q3 Delegasikan", Q4: "🗑️ Q4 Singkirkan" };
        const PRI_ORDER_MAP = ["🔴 P1 Critical", "🟠 P2 High", "🟡 P3 Medium", "🟢 P4 Low"];
        const QUAD_ORDER_MAP = ["🔥 Q1 Lakukan", "📅 Q2 Rencanakan", "👋 Q3 Delegasikan", "🗑️ Q4 Singkirkan"];
        const map = {};
        for (const t of tasks) {
          let key;
          if (groupBy === "priority") key = PRI_LABELS[t.priority] || "(Tanpa Priority)";
          else if (groupBy === "quadrant") key = QUAD_LABELS[t.quadrant] || "(Tanpa Quadrant)";
          else if (groupBy === "project") key = t.project || "(Tanpa Project)";
          else if (groupBy === "context") key = t.context || "(Tanpa Context)";
          else if (groupBy === "tag") key = (t.tags && t.tags[0]) ? t.tags[0] : "(Tanpa Tag)";
          if (!map[key]) map[key] = [];
          map[key].push(t);
        }
        const allKeys = Object.keys(map);
        const tanpaKeys = allKeys.filter(k => k.startsWith("(Tanpa"));
        const normalKeys = allKeys.filter(k => !k.startsWith("(Tanpa"));
        if (groupBy === "priority") normalKeys.sort((a, b) => PRI_ORDER_MAP.indexOf(a) - PRI_ORDER_MAP.indexOf(b));
        else if (groupBy === "quadrant") normalKeys.sort((a, b) => QUAD_ORDER_MAP.indexOf(a) - QUAD_ORDER_MAP.indexOf(b));
        else normalKeys.sort();
        return [...normalKeys, ...tanpaKeys].map(key => ({ key, tasks: map[key] }));
      };

      // Derive projects/contexts from allTasks if not provided
```

- [ ] **Step 3: Verify** — Console check, no errors. Open DevTools → Console → paste `"buildGroups" exists` check is implicit; just confirm page still loads.

- [ ] **Step 4: Commit**

```
git add static/index.html
git commit -m "feat: add buildGroups helper to TaskListView"
```

---

## Task 3: Add CompactRow and GroupHeader inline components

**File:** `static/index.html` — inside `TaskListView`, just before the `return (` statement (~line 4391).

- [ ] **Step 1: Find the anchor:**

```js
      return (
        <div className="fade-in">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
```

- [ ] **Step 2: Insert CompactRow + GroupHeader before the return:**

```js
      const CompactRow = ({ task }) => {
        const dateStr = task.deadline ? formatDate(task.deadline) : null;
        return (
          <div onClick={() => onTaskClick(task)}
            style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", cursor: "pointer",
              borderBottom: "1px solid var(--border)", transition: "background 0.1s" }}
            onMouseEnter={e => e.currentTarget.style.background = "var(--bg-primary)"}
            onMouseLeave={e => e.currentTarget.style.background = ""}>
            <div className="check-btn" onClick={e => { e.stopPropagation(); onDone(task.id); }} style={{ flexShrink: 0 }}>
              {task.gtd_status === "done" && <span className="check-icon" style={{ color: "var(--success)", fontSize: 14 }}>✓</span>}
            </div>
            <span style={{ flex: 1, fontSize: 13, fontWeight: 500,
              color: task.gtd_status === "done" ? "var(--text-light)" : "var(--text-primary)",
              textDecoration: task.gtd_status === "done" ? "line-through" : "none",
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {task.title}
            </span>
            {dateStr && (
              <span style={{ fontSize: 11, color: task.is_overdue ? "#ef4444" : "var(--text-light)", flexShrink: 0 }}>
                {dateStr}
              </span>
            )}
          </div>
        );
      };

      const GroupHeader = ({ groupKey, count, isCollapsed }) => (
        <div onClick={() => toggleGroup(groupKey)}
          style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px",
            cursor: "pointer", background: "var(--bg-primary)", borderBottom: "1px solid var(--border)",
            userSelect: "none", transition: "background 0.1s" }}
          onMouseEnter={e => e.currentTarget.style.background = "rgba(168,197,0,0.07)"}
          onMouseLeave={e => e.currentTarget.style.background = "var(--bg-primary)"}>
          <span style={{ fontSize: 11, color: "var(--text-light)", display: "inline-block",
            transform: isCollapsed ? "rotate(-90deg)" : "rotate(0deg)", transition: "transform 0.15s" }}>▼</span>
          <span style={{ fontSize: 13, fontWeight: 700, color: "var(--accent)", flex: 1 }}>{groupKey}</span>
          <span style={{ fontSize: 11, color: "var(--text-light)" }}>{count} task</span>
        </div>
      );

      return (
        <div className="fade-in">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
```

- [ ] **Step 3: Verify** — Browser reload → page still loads, no console errors. The components are defined but not yet rendered — that's fine.

- [ ] **Step 4: Commit**

```
git add static/index.html
git commit -m "feat: add CompactRow and GroupHeader components to TaskListView"
```

---

## Task 4: Add Toolbar UI (group-by dropdown + view mode toggle)

**File:** `static/index.html` — inside the `return` JSX, after the page title row and before the filter card.

- [ ] **Step 1: Find the anchor** — the title + count row followed by the filter card:

```jsx
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <h1 style={{ fontSize: 24, fontWeight: 700 }}>{icon} {title}</h1>
            <span style={{ color: "var(--text-light)", fontSize: 14 }}>{filtered.length}{hasFilters ? `/${tasks.length}` : ""} task(s)</span>
          </div>

          {showFilters !== false && (
```

- [ ] **Step 2: Replace with — add toolbar between title row and filter card:**

```jsx
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <h1 style={{ fontSize: 24, fontWeight: 700 }}>{icon} {title}</h1>
            <span style={{ color: "var(--text-light)", fontSize: 14 }}>{filtered.length}{hasFilters ? `/${tasks.length}` : ""} task(s)</span>
          </div>

          {/* ── Toolbar: group-by + view mode ── */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: 12, color: "var(--text-secondary)", fontWeight: 500 }}>Group by:</span>
              <select value={groupBy} onChange={e => handleGroupBy(e.target.value)}
                style={{ fontSize: 12, padding: "4px 8px", borderRadius: 6,
                  border: "1px solid var(--border)", background: "var(--bg-card)",
                  color: "var(--text-primary)", cursor: "pointer" }}>
                <option value="none">None</option>
                <option value="priority">Priority</option>
                <option value="quadrant">Quadrant</option>
                <option value="project">Project</option>
                <option value="context">Context</option>
                <option value="tag">Tag</option>
              </select>
            </div>
            <div style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
              {[["normal", "▦", "Normal"], ["compact", "▤", "Compact"]].map(([mode, ico, label]) => (
                <button key={mode} onClick={() => handleViewMode(mode)} title={label}
                  style={{ padding: "4px 10px", borderRadius: 6, border: "1px solid var(--border)",
                    cursor: "pointer", fontSize: 14, lineHeight: 1,
                    background: viewMode === mode ? "var(--accent)" : "var(--bg-card)",
                    color: viewMode === mode ? "#1a2a00" : "var(--text-secondary)",
                    fontWeight: viewMode === mode ? 700 : 400, transition: "all 0.15s" }}>
                  {ico}
                </button>
              ))}
            </div>
          </div>

          {showFilters !== false && (
```

- [ ] **Step 3: Verify in browser:**
  - Reload page → toolbar "Group by: None ▦ ▤" appears below page title
  - Click ▤ → button highlights green (accent color)
  - Reload page → active button persists (localStorage working)
  - Change "Group by" dropdown to "Project" → reload → still shows Project

- [ ] **Step 4: Commit**

```
git add static/index.html
git commit -m "feat: add group-by and view-mode toolbar to TaskListView"
```

---

## Task 5: Wire up rendering (flat + grouped × compact + normal)

**File:** `static/index.html` — replace the task list render section at the bottom of `TaskListView`.

- [ ] **Step 1: Find the anchor — the current rendering block:**

```jsx
          {loading ? (
            <div style={{ textAlign: "center", padding: 40, color: "var(--text-light)" }}>Loading...</div>
          ) : filtered.length === 0 ? (
            <div className="card" style={{ textAlign: "center", padding: 48, color: "var(--text-light)" }}>
              <div style={{ fontSize: 36, marginBottom: 8 }}>{hasFilters ? "🔍" : "🎉"}</div>
              <div>{hasFilters ? "Tidak ada task yang cocok dengan filter" : "Tidak ada task"}</div>
            </div>
          ) : (
            <div className="card" style={{ padding: 8 }}>
              {filtered.map(t => <TaskRow key={t.id} task={t} onClick={onTaskClick} onDone={onDone} onToggleFocus={onToggleFocus} />)}
            </div>
          )}
```

- [ ] **Step 2: Replace with — conditional rendering for all 4 modes (flat/grouped × compact/normal):**

```jsx
          {loading ? (
            <div style={{ textAlign: "center", padding: 40, color: "var(--text-light)" }}>Loading...</div>
          ) : filtered.length === 0 ? (
            <div className="card" style={{ textAlign: "center", padding: 48, color: "var(--text-light)" }}>
              <div style={{ fontSize: 36, marginBottom: 8 }}>{hasFilters ? "🔍" : "🎉"}</div>
              <div>{hasFilters ? "Tidak ada task yang cocok dengan filter" : "Tidak ada task"}</div>
            </div>
          ) : groupBy === "none" ? (
            <div className="card" style={{ padding: viewMode === "compact" ? 0 : 8, overflow: "hidden" }}>
              {filtered.map(t => viewMode === "compact"
                ? <CompactRow key={t.id} task={t} />
                : <TaskRow key={t.id} task={t} onClick={onTaskClick} onDone={onDone} onToggleFocus={onToggleFocus} />
              )}
            </div>
          ) : (
            <div className="card" style={{ overflow: "hidden", padding: 0 }}>
              {buildGroups(filtered).map(({ key, tasks: groupTasks }, idx) => {
                const isTanpa = key.startsWith("(Tanpa");
                const isCollapsed = isTanpa ? (collapsed[key] !== false) : !!collapsed[key];
                return (
                  <div key={key}>
                    {idx > 0 && <div style={{ height: 1, background: "var(--border)" }} />}
                    <GroupHeader groupKey={key} count={groupTasks.length} isCollapsed={isCollapsed} />
                    {!isCollapsed && (
                      <div style={{ padding: viewMode === "compact" ? 0 : 8 }}>
                        {groupTasks.map(t => viewMode === "compact"
                          ? <CompactRow key={t.id} task={t} />
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

- [ ] **Step 3: Verify in browser — test all combinations:**

  1. **Normal + No group (default):** Should look exactly like before — nothing changed
  2. **Compact + No group:** Click ▤ → tasks become slim rows (title + date only)
  3. **Normal + Group by Project:** Select "Project" → tasks separated by project header with ▼ chevron
  4. **Click group header** → section collapses (▶ chevron), click again → expands
  5. **"(Tanpa Project)" group** → appears last, starts collapsed
  6. **Compact + Group by Priority** → both modes active simultaneously — slim rows inside collapsible sections
  7. **Click task in compact mode** → opens TaskDetailModal
  8. **Click checkbox in compact mode** → marks task done
  9. **Change page** (Inbox → Someday) → group-by and view-mode persist across pages

- [ ] **Step 4: Commit**

```
git add static/index.html
git commit -m "feat: wire grouped and compact rendering in TaskListView"
```

---

## Task 6: Deploy to GitHub

- [ ] **Step 1: Push to remote**

```
git push origin main
```

- [ ] **Step 2: Verify CI/CD** — Wait for auto-deploy on VPS. Open the live app and repeat the verification steps from Task 5 Step 3.

---

## Self-Review Notes

- `buildGroups` uses `groupBy` from closure — correct, it's defined in the same scope
- `CompactRow` uses `onTaskClick`, `onDone`, `formatDate` from outer scope — all accessible
- `GroupHeader` uses `toggleGroup` from outer scope — accessible
- "(Tanpa X)" default-collapsed logic: `isTanpa ? (collapsed[key] !== false) : !!collapsed[key]` — when `collapsed[key]` is `undefined`: Tanpa→`true` (collapsed), normal→`false` (expanded) ✓
- `handleGroupBy` resets `collapsed` to `{}` when group field changes — prevents stale collapse state ✓
- Existing filter logic unchanged — filters still apply before grouping ✓
- `showFilters` prop only hides filter card, not toolbar — toolbar always visible ✓
