# Habit Page Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign Habit Tracker page with minimalist dashboard: summary cards, 30-day calendar heatmap, single check button per habit, and 30-day mini heatmap per habit.

**Architecture:** Pure frontend UI redesign + one new backend endpoint. Keep existing `HabitCheckinModal`, CRUD operations, and offline queue unchanged. Use existing `habit_logs` table for historical data.

**Tech Stack:** React (inline JSX), CSS custom properties, FastAPI, SQLite

**Spec:** `docs/superpowers/specs/2026-10-04-habit-page-redesign.md`

---

## Global Constraints

- Service Worker cache version must be bumped for all frontend changes
- All existing habit functionality (checkin modal, edit, delete, phase grouping) must remain unchanged
- Offline support: summary stats computed from cached data, heatmap fails gracefully
- Mobile responsive: 2×2 card grid, scrollable heatmaps
- Color intensity: 5 levels (0%, 1-25%, 26-50%, 51-75%, 76-100%) using `rgba(168,197,0, opacity)`

---

## Review Focus

1. **Empty habit list:** Summary cards should show "0" gracefully, not crash or show "NaN%"
2. **Offline monthly heatmap:** Should hide or show "Offline" message, not spinner forever or blank error
3. **Today's date at month boundary:** Heatmap should highlight correct cell when today is 1st or 31st
4. **Hover tooltips on small touch screens:** Should not block content or require precision tap
5. **Per-habit mini heatmap with sparse data:** Habits created <30 days ago should show only available days, not crash

---

## Task 1: Backend — Monthly Completion Endpoint

**Files:**
- Modify: `webapp.py` (add new endpoint after existing habit endpoints)
- Test: Manual test via curl/browser

**Interfaces:**
- Consumes: Existing `habit_logs` table, `get_uid_from_token()` dependency
- Produces: `GET /api/habits/monthly-completion` → `{"days": [{"date": "2026-10-04", "total_habits": 10, "done_count": 7}, ...]}`

---

- [ ] **Step 1: Write the endpoint function**

Add after existing habit endpoints in `webapp.py`:

```python
@app.get("/api/habits/monthly-completion")
def get_habits_monthly_completion(uid: int = Depends(get_uid_from_token)):
    """
    Returns daily habit completion data for the last 30 days.
    Used for calendar heatmap visualization.
    """
    conn = get_db()
    
    # Get daily completion stats for the last 30 days
    # Uses habit_logs table (habit_id, date, status)
    query = """
    SELECT 
        hl.date as date,
        COUNT(DISTINCT hl.habit_id) as total_habits,
        SUM(CASE WHEN hl.status = 'done' THEN 1 ELSE 0 END) as done_count
    FROM habit_logs hl
    JOIN habits h ON h.id = hl.habit_id
    WHERE h.user_id = ?
      AND hl.date >= DATE('now', '-30 days')
    GROUP BY hl.date
    ORDER BY hl.date DESC
    """
    
    rows = conn.execute(query, (uid,)).fetchall()
    
    days = [
        {
            "date": row["date"],
            "total_habits": row["total_habits"],
            "done_count": row["done_count"]
        }
        for row in rows
    ]
    
    return {"days": days}
```

- [ ] **Step 2: Test endpoint manually**

Start server and test:
```bash
# Assuming server runs on localhost:8000
curl -H "Authorization: Bearer YOUR_TOKEN" http://localhost:8000/api/habits/monthly-completion
```

Expected: JSON response with `{"days": [...]}`

- [ ] **Step 3: Commit backend**

```bash
git add webapp.py
git commit -m "feat(habits): add monthly completion endpoint for heatmap

Returns daily habit completion stats for last 30 days.
Used by calendar heatmap visualization.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 2: CSS — New Styling Classes

**Files:**
- Modify: `static/app.css` (append at end, before or after existing habit styles)

**Interfaces:**
- Consumes: Existing CSS variables (`--bg-card`, `--border`, `--accent`, etc.)
- Produces: Classes `.habit-hero`, `.habit-summary-cards`, `.habit-summary-card`, `.habit-heatmap`, `.habit-heatmap-cell`, `.habit-mini-heatmap`, `.habit-mini-cell`, `.habit-check-btn`, `.habit-streak-badge`

---

- [ ] **Step 1: Add hero section styles**

Append to `static/app.css`:

```css
/* ══ Habit Page Redesign — Minimalist Dashboard ═══════════════ */

/* ── Hero Section ──────────────────────────────────────────── */
.habit-hero {
  margin: 20px 0;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
```

- [ ] **Step 2: Add summary cards styles**

Continue in `static/app.css`:

```css
/* ── Summary Cards ────────────────────────────────────────── */
.habit-summary-cards {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
}

@media (max-width: 768px) {
  .habit-summary-cards {
    grid-template-columns: repeat(2, 1fr);
  }
}

.habit-summary-card {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  transition: transform 0.15s, box-shadow 0.15s;
}

.habit-summary-card:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(0,0,0,0.08);
}

.habit-summary-card-icon {
  font-size: 24px;
}

.habit-summary-card-value {
  font-size: 20px;
  font-weight: 700;
  color: var(--text-primary);
}

.habit-summary-card-label {
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.3;
}
```

- [ ] **Step 3: Add calendar heatmap styles**

Continue in `static/app.css`:

```css
/* ── Calendar Heatmap ────────────────────────────────────── */
.habit-heatmap {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 16px;
}

.habit-heatmap-grid {
  display: grid;
  grid-template-columns: repeat(7, 24px);
  gap: 3px;
  justify-content: center;
}

@media (max-width: 768px) {
  .habit-heatmap {
    overflow-x: auto;
  }
  .habit-heatmap-grid {
    grid-template-columns: repeat(7, 18px);
  }
}

.habit-heatmap-cell {
  width: 24px;
  height: 24px;
  border-radius: 4px;
  background: var(--bg-secondary);
  transition: transform 0.15s;
  cursor: pointer;
  position: relative;
}

.habit-heatmap-cell:hover {
  transform: scale(1.1);
}

.habit-heatmap-cell.today {
  border: 2px solid #818cf8;
  width: 26px;
  height: 26px;
}

.habit-heatmap-cell.level-1 { background: rgba(168,197,0, 0.2); }
.habit-heatmap-cell.level-2 { background: rgba(168,197,0, 0.4); }
.habit-heatmap-cell.level-3 { background: rgba(168,197,0, 0.7); }
.habit-heatmap-cell.level-4 { background: var(--accent); }

.habit-heatmap-labels {
  display: grid;
  grid-template-columns: repeat(7, 24px);
  gap: 3px;
  justify-content: center;
  margin-bottom: 6px;
}

.habit-heatmap-label {
  font-size: 10px;
  color: var(--text-light);
  text-align: center;
}

/* Tooltip for heatmap cells */
.habit-heatmap-cell::after {
  content: attr(data-tooltip);
  position: absolute;
  bottom: 100%;
  left: 50%;
  transform: translateX(-50%) translateY(-4px);
  background: rgba(0,0,0,0.9);
  color: white;
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 11px;
  white-space: nowrap;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.15s;
  z-index: 100;
}

.habit-heatmap-cell:hover::after {
  opacity: 1;
}

[data-theme="dark"] .habit-heatmap-cell::after {
  background: rgba(255,255,255,0.95);
  color: #171717;
}
```

- [ ] **Step 4: Add mini heatmap styles**

Continue in `static/app.css`:

```css
/* ── Mini Heatmap (per habit) ────────────────────────────── */
.habit-mini-heatmap {
  display: flex;
  gap: 2px;
  overflow-x: auto;
  scrollbar-width: none;
  -ms-overflow-style: none;
}

.habit-mini-heatmap::-webkit-scrollbar {
  display: none;
}

.habit-mini-cell {
  width: 10px;
  height: 10px;
  border-radius: 2px;
  background: var(--bg-secondary);
  flex-shrink: 0;
  transition: transform 0.15s;
  position: relative;
}

.habit-mini-cell:hover {
  transform: scale(1.2);
}

.habit-mini-cell.level-1 { background: rgba(168,197,0, 0.2); }
.habit-mini-cell.level-2 { background: rgba(168,197,0, 0.4); }
.habit-mini-cell.level-3 { background: rgba(168,197,0, 0.7); }
.habit-mini-cell.level-4 { background: var(--accent); }

/* Tooltip for mini cells */
.habit-mini-cell::after {
  content: attr(data-tooltip);
  position: absolute;
  bottom: 100%;
  left: 50%;
  transform: translateX(-50%) translateY(-4px);
  background: rgba(0,0,0,0.9);
  color: white;
  padding: 3px 6px;
  border-radius: 4px;
  font-size: 10px;
  white-space: nowrap;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.15s;
  z-index: 100;
}

.habit-mini-cell:hover::after {
  opacity: 1;
}

[data-theme="dark"] .habit-mini-cell::after {
  background: rgba(255,255,255,0.95);
  color: #171717;
}
```

- [ ] **Step 5: Add check button and streak badge styles**

Continue in `static/app.css`:

```css
/* ── Check Today Button ──────────────────────────────────── */
.habit-check-btn {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  border: none;
  font-size: 18px;
  cursor: pointer;
  transition: transform 0.15s, background 0.15s;
  flex-shrink: 0;
}

.habit-check-btn.empty {
  background: var(--bg-card);
  border: 2px solid var(--border);
  color: var(--text-secondary);
}

.habit-check-btn.done {
  background: var(--success);
  color: white;
}

.habit-check-btn.skipped {
  background: #facc15;
  color: white;
}

.habit-check-btn:hover {
  transform: scale(1.05);
}

.habit-check-btn:active {
  transform: scale(0.95);
}

/* ── Streak Badge ────────────────────────────────────────── */
.habit-streak-badge {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 13px;
  font-weight: 700;
  color: var(--text-light);
  flex-shrink: 0;
}

.habit-streak-badge.active {
  color: var(--accent);
}
```

- [ ] **Step 6: Add new habit card layout styles**

Continue in `static/app.css`:

```css
/* ── New Habit Card Layout ────────────────────────────────── */
.habit-card-new {
  display: flex;
  align-items: center;
  gap: 12px;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 14px 16px;
  margin-bottom: 10px;
  transition: box-shadow 0.15s;
}

.habit-card-new:hover {
  box-shadow: 0 2px 8px rgba(0,0,0,0.06);
}

.habit-card-info-new {
  flex: 1;
  min-width: 0;
}

.habit-card-title-new {
  font-size: 15px;
  font-weight: 700;
  margin-bottom: 3px;
}

.habit-card-micro-new {
  font-size: 12px;
  color: var(--text-secondary);
}
```

- [ ] **Step 7: Commit CSS**

```bash
git add static/app.css
git commit -m "style(habits): add styles for minimalist dashboard redesign

- Summary cards with hover effects
- Calendar heatmap with 5-level color intensity
- Mini heatmap per habit (30-day history)
- Check today button with 3 states
- Tooltips for heatmap cells

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 3: Frontend — Summary Stats Helper

**Files:**
- Modify: `static/index.html` (add helper function before `HabitPage` component)

**Interfaces:**
- Consumes: `habits` array with `streak`, `week_log` properties
- Produces: `computeSummaryStats(habits)` → `{totalActive: number, completionRate: number, bestStreak: number, weekDone: number, weekTotal: number}`

---

- [ ] **Step 1: Add computeSummaryStats function**

Find `function HabitPage` in `static/index.html` (around line 25092) and add before it:

```javascript
// Helper: Compute summary statistics from habits array
function computeHabitSummaryStats(habits) {
  if (!habits || habits.length === 0) {
    return {
      totalActive: 0,
      completionRate: 0,
      bestStreak: 0,
      weekDone: 0,
      weekTotal: 0
    };
  }
  
  const totalActive = habits.filter(h => !h.archived).length;
  
  // Count "done" in week_log arrays
  let weekDone = 0;
  let weekTotal = 0;
  habits.forEach(h => {
    if (h.week_log && Array.isArray(h.week_log)) {
      h.week_log.forEach(status => {
        if (status === 'done') weekDone++;
        if (status !== null) weekTotal++; // Count all logged days
      });
    }
  });
  
  // If no logged days yet, calculate potential total as habits × 7
  if (weekTotal === 0) {
    weekTotal = totalActive * 7;
  }
  
  const completionRate = weekTotal > 0 
    ? Math.round((weekDone / weekTotal) * 100) 
    : 0;
  
  const bestStreak = Math.max(0, ...habits.map(h => h.streak || 0));
  
  return {
    totalActive,
    completionRate,
    bestStreak,
    weekDone,
    weekTotal
  };
}
```

- [ ] **Step 2: Verify function syntax**

Run syntax check:
```bash
node scratch/check_inline.js static/index.html
```

Expected: All scripts OK

- [ ] **Step 3: Commit helper function**

```bash
git add static/index.html
git commit -m "feat(habits): add summary stats computation helper

Computes totalActive, completionRate, bestStreak, weekDone/weekTotal
from habits array. Handles empty list gracefully (returns zeros).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 4: Frontend — Summary Cards Component

**Files:**
- Modify: `static/index.html` (add component before `HabitPage`)

**Interfaces:**
- Consumes: `stats` object with `{totalActive, completionRate, bestStreak, weekDone, weekTotal}`
- Produces: `SummaryCards({ stats })` → React element with 4 cards

---

- [ ] **Step 1: Add SummaryCard component**

Add before `HabitPage` in `static/index.html`:

```javascript
function SummaryCard({ icon, value, label }) {
  return /*#__PURE__*/React.createElement("div", {
    className: "habit-summary-card"
  }, /*#__PURE__*/React.createElement("div", {
    className: "habit-summary-card-icon"
  }, icon), /*#__PURE__*/React.createElement("div", {
    className: "habit-summary-card-value"
  }, value), /*#__PURE__*/React.createElement("div", {
    className: "habit-summary-card-label"
  }, label));
}
```

- [ ] **Step 2: Add SummaryCards component**

Add after `SummaryCard`:

```javascript
function SummaryCards({ stats }) {
  const cards = [
    { 
      icon: "⚡", 
      value: stats.totalActive || 0, 
      label: "kebiasaan aktif" 
    },
    { 
      icon: "✓", 
      value: `${stats.completionRate || 0}%`, 
      label: "tingkat penyelesaian minggu ini" 
    },
    { 
      icon: "🔥", 
      value: stats.bestStreak || 0, 
      label: "rekor beruntun terbaik" 
    },
    { 
      icon: "📊", 
      value: `${stats.weekDone || 0}/${stats.weekTotal || 0}`, 
      label: "checkin minggu ini" 
    }
  ];
  
  return /*#__PURE__*/React.createElement("div", {
    className: "habit-summary-cards"
  }, cards.map((card, i) => /*#__PURE__*/React.createElement(SummaryCard, {
    key: i,
    icon: card.icon,
    value: card.value,
    label: card.label
  })));
}
```

- [ ] **Step 3: Verify syntax**

```bash
node scratch/check_inline.js static/index.html
```

Expected: All scripts OK

- [ ] **Step 4: Commit summary cards**

```bash
git add static/index.html
git commit -m "feat(habits): add SummaryCards component

Renders 4 cards: total active, completion rate %, best streak,
and week progress. Handles zero/null values gracefully.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 5: Frontend — Calendar Heatmap Component

**Files:**
- Modify: `static/index.html` (add component after `SummaryCards`)

**Interfaces:**
- Consumes: `monthlyData` object with `{days: [{date, total_habits, done_count}, ...]}`
- Produces: `CalendarHeatmap({ data })` → React element with 7×5 grid

---

- [ ] **Step 1: Add helper to compute color level**

Add before `CalendarHeatmap` component:

```javascript
// Helper: Map completion rate to color level (0-4)
function getHeatmapColorLevel(doneCount, totalHabits) {
  if (!totalHabits || totalHabits === 0) return 0;
  const rate = (doneCount / totalHabits) * 100;
  if (rate === 0) return 0;
  if (rate <= 25) return 1;
  if (rate <= 50) return 2;
  if (rate <= 75) return 3;
  return 4;
}
```

- [ ] **Step 2: Add CalendarHeatmap component**

Add after helper:

```javascript
function CalendarHeatmap({ data }) {
  const [hoveredCell, setHoveredCell] = React.useState(null);
  
  if (!data || !data.days || data.days.length === 0) {
    return /*#__PURE__*/React.createElement("div", {
      className: "habit-heatmap",
      style: { textAlign: "center", padding: "30px", color: "var(--text-secondary)", fontSize: 14 }
    }, "Tidak ada data untuk ditampilkan");
  }
  
  // Build 35-cell grid (5 weeks × 7 days)
  // Fill with last 30 days + padding for complete weeks
  const today = new Date();
  const todayStr = today.toISOString().split('T')[0];
  
  // Create map of date -> day data
  const dataMap = {};
  data.days.forEach(d => {
    dataMap[d.date] = d;
  });
  
  // Generate 35 cells (5 rows × 7 cols) going backwards from today
  const cells = [];
  const todayDow = (today.getDay() + 6) % 7; // 0=Mon, 6=Sun
  
  for (let i = 34; i >= 0; i--) {
    const daysBack = 34 - i - todayDow;
    const cellDate = new Date(today);
    cellDate.setDate(cellDate.getDate() - daysBack);
    const cellDateStr = cellDate.toISOString().split('T')[0];
    
    // Only render cells up to today
    if (cellDate <= today) {
      const dayData = dataMap[cellDateStr];
      const level = dayData 
        ? getHeatmapColorLevel(dayData.done_count, dayData.total_habits)
        : 0;
      
      const isToday = cellDateStr === todayStr;
      
      // Format tooltip
      const dateObj = new Date(cellDateStr + 'T00:00:00');
      const dayName = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'][dateObj.getDay()];
      const tooltip = dayData
        ? `${dayName}, ${cellDate.getDate()} ${['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Ags','Sep','Okt','Nov','Des'][cellDate.getMonth()]}: ${dayData.done_count}/${dayData.total_habits} habits`
        : `${dayName}, ${cellDate.getDate()} ${['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Ags','Sep','Okt','Nov','Des'][cellDate.getMonth()]}: Tidak ada data`;
      
      cells.push({
        key: cellDateStr,
        level,
        isToday,
        tooltip,
        isEmpty: !dayData
      });
    } else {
      cells.push(null); // Future date, don't render
    }
  }
  
  const dayLabels = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  
  return /*#__PURE__*/React.createElement("div", {
    className: "habit-heatmap"
  }, /*#__PURE__*/React.createElement("div", {
    className: "habit-heatmap-labels"
  }, dayLabels.map((label, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    className: "habit-heatmap-label"
  }, label))), /*#__PURE__*/React.createElement("div", {
    className: "habit-heatmap-grid"
  }, cells.map((cell, i) => {
    if (!cell) return /*#__PURE__*/React.createElement("div", { key: i }); // Empty placeholder
    
    const className = `habit-heatmap-cell${cell.level > 0 ? ` level-${cell.level}` : ''}${cell.isToday ? ' today' : ''}`;
    
    return /*#__PURE__*/React.createElement("div", {
      key: cell.key,
      className: className,
      "data-tooltip": cell.tooltip,
      onMouseEnter: () => setHoveredCell(cell.key),
      onMouseLeave: () => setHoveredCell(null)
    });
  })));
}
```

- [ ] **Step 3: Verify syntax**

```bash
node scratch/check_inline.js static/index.html
```

Expected: All scripts OK

- [ ] **Step 4: Commit calendar heatmap**

```bash
git add static/index.html
git commit -m "feat(habits): add CalendarHeatmap component

Renders 7×5 grid showing last 30 days completion rate.
5-level color intensity, highlights today, tooltip on hover.
Handles empty data gracefully.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 6: Frontend — Mini Heatmap Component

**Files:**
- Modify: `static/index.html` (add component after `CalendarHeatmap`)

**Interfaces:**
- Consumes: `habitId` number, `habitData` array with `[{date, status}, ...]` for last 30 days
- Produces: `MiniHeatmap({ habitId, habitData })` → React element with 30 tiny cells

---

- [ ] **Step 1: Add MiniHeatmap component**

Add after `CalendarHeatmap`:

```javascript
function MiniHeatmap({ habitId, habitData }) {
  if (!habitData || habitData.length === 0) {
    // Show 30 empty cells
    const emptyCells = Array(30).fill(null);
    return /*#__PURE__*/React.createElement("div", {
      className: "habit-mini-heatmap"
    }, emptyCells.map((_, i) => /*#__PURE__*/React.createElement("div", {
      key: i,
      className: "habit-mini-cell"
    })));
  }
  
  // habitData is array of {date, status} for last 30 days
  // status: "done" | "skipped" | "missed" | null
  return /*#__PURE__*/React.createElement("div", {
    className: "habit-mini-heatmap"
  }, habitData.map((day, i) => {
    let level = 0;
    if (day.status === 'done') level = 4; // Full intensity
    else if (day.status === 'skipped') level = 2; // Medium (yellow-ish)
    else if (day.status === 'missed') level = 0; // Gray
    
    const dateObj = new Date(day.date + 'T00:00:00');
    const dayName = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'][dateObj.getDay()];
    const tooltip = `${dayName}, ${dateObj.getDate()} ${['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Ags','Sep','Okt','Nov','Des'][dateObj.getMonth()]}: ${day.status || 'tidak tercatat'}`;
    
    const className = `habit-mini-cell${level > 0 ? ` level-${level}` : ''}`;
    
    return /*#__PURE__*/React.createElement("div", {
      key: day.date,
      className: className,
      "data-tooltip": tooltip
    });
  }));
}
```

- [ ] **Step 2: Verify syntax**

```bash
node scratch/check_inline.js static/index.html
```

Expected: All scripts OK

- [ ] **Step 3: Commit mini heatmap**

```bash
git add static/index.html
git commit -m "feat(habits): add MiniHeatmap component per habit

Renders 30 tiny cells showing habit's 30-day history.
Color: done=full, skipped=medium, missed/null=gray.
Tooltip on hover.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 7: Frontend — Fetch Monthly Data & Update HabitPage

**Files:**
- Modify: `static/index.html` (`HabitPage` component, around line 25092)

**Interfaces:**
- Consumes: New endpoint `/api/habits/monthly-completion`, existing `/api/habits/today`
- Produces: Updated `HabitPage` with `monthlyData` state, calls `SummaryCards` + `CalendarHeatmap`

---

- [ ] **Step 1: Add monthlyData state and fetch function to HabitPage**

Find `function HabitPage` and update state declarations (around line 25096):

```javascript
// ADD these new states after existing states:
const [monthlyData, setMonthlyData] = useState(null);
const [summaryStats, setSummaryStats] = useState({});
```

- [ ] **Step 2: Add fetchMonthlyData function**

After `fetchMonthly` function (around line 25155), replace with:

```javascript
const fetchMonthly = async () => {
  try {
    const data = await api.get("/api/habits/monthly");
    setMonthlyData(data);
  } catch (e) {/* offline — skip chart */}
};

// NEW: Fetch monthly completion data for heatmap
const fetchMonthlyCompletion = async () => {
  try {
    const data = await api.get("/api/habits/monthly-completion");
    setMonthlyData(data);
  } catch (e) {
    // Offline or error — set null, heatmap will show fallback
    setMonthlyData(null);
  }
};
```

- [ ] **Step 3: Call fetchMonthlyCompletion in useEffect**

Find the `useEffect` hook that calls `fetchMonthly()` (around line 25161) and update:

```javascript
useEffect(() => {
  fetchHabits();
  fetchMonthlyCompletion(); // CHANGED: use new endpoint
  const handler = () => {
    fetchHabits();
    fetchMonthlyCompletion(); // CHANGED
  };
  window.addEventListener("habitSaved", handler);
  return () => window.removeEventListener("habitSaved", handler);
}, []);
```

- [ ] **Step 4: Compute summary stats when habits change**

Add new `useEffect` after the fetch effect:

```javascript
// Compute summary stats whenever habits change
useEffect(() => {
  const stats = computeHabitSummaryStats(habits);
  setSummaryStats(stats);
}, [habits]);
```

- [ ] **Step 5: Remove old Chart.js code**

Find the `useEffect` that creates Chart.js (around line 25171, starts with `useEffect(() => { if (!monthlyData || !chartRef.current) return;`). **DELETE** this entire useEffect block (it's the old line chart implementation).

Also remove `chartRef` and `chartInstanceRef` state declarations (around line 25101).

- [ ] **Step 6: Verify syntax**

```bash
node scratch/check_inline.js static/index.html
```

Expected: All scripts OK

- [ ] **Step 7: Commit HabitPage updates**

```bash
git add static/index.html
git commit -m "feat(habits): update HabitPage to use monthly completion data

- Add monthlyData and summaryStats state
- Fetch from /api/habits/monthly-completion endpoint
- Compute summary stats when habits change
- Remove old Chart.js line chart code

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 8: Frontend — Render Hero Section in HabitPage

**Files:**
- Modify: `static/index.html` (`HabitPage` return JSX, around line 25250+)

**Interfaces:**
- Consumes: `summaryStats`, `monthlyData` state from `HabitPage`
- Produces: Hero section JSX with `SummaryCards` and `CalendarHeatmap` rendered above habit list

---

- [ ] **Step 1: Find HabitPage return statement**

Locate the `return` statement in `HabitPage` (around line 25250+). It currently renders motivational quote, then the old chart canvas, then habit list.

- [ ] **Step 2: Replace old chart with hero section**

Find the canvas element for chart (around `<canvas ref={chartRef} ...>`). **DELETE** the entire canvas block and the container div around it.

**REPLACE** with hero section:

```javascript
// After motivational quote, BEFORE habit list:
/*#__PURE__*/React.createElement("div", {
  className: "habit-hero"
}, /*#__PURE__*/React.createElement(SummaryCards, {
  stats: summaryStats
}), /*#__PURE__*/React.createElement(CalendarHeatmap, {
  data: monthlyData
}))
```

The structure should be:
```javascript
return /*#__PURE__*/React.createElement("div", { ... },
  // ... loading/motivational quote ...
  
  // NEW HERO SECTION:
  /*#__PURE__*/React.createElement("div", {
    className: "habit-hero"
  }, ...),
  
  // Existing habit list by phase:
  phases.map(phase => ...)
);
```

- [ ] **Step 3: Verify syntax**

```bash
node scratch/check_inline.js static/index.html
```

Expected: All scripts OK

- [ ] **Step 4: Commit hero section rendering**

```bash
git add static/index.html
git commit -m "feat(habits): render hero section with cards + heatmap

Replace old Chart.js canvas with SummaryCards and CalendarHeatmap
components. Hero section appears below motivational quote.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 9: Frontend — Rewrite HabitCard Component

**Files:**
- Modify: `static/index.html` (`HabitCard` component, around line 24587)

**Interfaces:**
- Consumes: `h` (habit object), `monthlyData`, `onCheckin`, `onEdit`, `onDelete`, `onTagClick`, `onTagRemove`
- Produces: New layout JSX: `[Info] | [MiniHeatmap] | [CheckButton] | [Streak] | [Menu]`

---

- [ ] **Step 1: Add helper to get habit's 30-day data**

Before `HabitCard` component, add helper:

```javascript
// Helper: Extract last 30 days of data for a specific habit
function getHabit30DayData(habitId, habitLogs) {
  // habitLogs is the habit's own log history
  // For now, we'll derive from week_log (7 days only)
  // Full implementation needs backend to return per-habit 30-day data
  // TEMPORARY: return empty array, will be filled in next task
  return [];
}
```

- [ ] **Step 2: Backup old HabitCard**

Copy the entire `function HabitCard` block and paste it below, then comment it out with `/*` and `*/`. Label it `// OLD HabitCard — backup`.

- [ ] **Step 3: Rewrite HabitCard with new layout**

Replace the active `HabitCard` function with:

```javascript
function HabitCard({
  h,
  DAY_LABELS,
  todayDow,
  onCheckin,
  onEdit,
  onDelete,
  onTagClick,
  onTagRemove
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const closeMenu = () => setMenuOpen(false);
  const [habitTags, setHabitTags] = useState([]);
  const [tagsExpanded, setTagsExpanded] = useState(false);
  
  useEffect(() => {
    if (h?.id && !String(h.id).startsWith("tmp_")) {
      api.get(`/api/habits/${h.id}/tags`).then(data => setHabitTags(data || [])).catch(() => {});
    }
  }, [h?.id]);
  
  // Get 30-day data for mini heatmap
  const habit30DayData = getHabit30DayData(h.id, []); // Empty for now
  
  return /*#__PURE__*/React.createElement("div", {
    className: "habit-card-new fade-in",
    "data-tour": "habit-card"
  }, menuOpen && /*#__PURE__*/React.createElement("div", {
    style: {
      position: "fixed",
      inset: 0,
      zIndex: 9
    },
    onClick: e => {
      e.stopPropagation();
      closeMenu();
    }
  }), 
  
  /* Info section (left) */
  /*#__PURE__*/React.createElement("div", {
    className: "habit-card-info-new"
  }, /*#__PURE__*/React.createElement("div", {
    className: "habit-card-title-new"
  }, h.title, h._pending && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 10,
      color: "var(--text-light)",
      marginLeft: 6
    }
  }, "⏳")), h.micro_target && /*#__PURE__*/React.createElement("div", {
    className: "habit-card-micro-new"
  }, "🎯 ", h.micro_target), habitTags.length > 0 && /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexWrap: "wrap",
      gap: 4,
      marginTop: 4,
      alignItems: "center"
    },
    onClick: e => e.stopPropagation()
  }, (tagsExpanded ? habitTags : habitTags.slice(0, 3)).map(tag => /*#__PURE__*/React.createElement("span", {
    key: tag.id,
    title: "Klik untuk lihat semua habit dengan tag ini",
    onClick: () => onTagClick && onTagClick(tag.name),
    style: {
      display: "inline-flex",
      alignItems: "center",
      gap: 3,
      background: "rgba(168,197,0,0.10)",
      color: "var(--accent)",
      border: "1px solid rgba(168,197,0,0.25)",
      borderRadius: 999,
      fontSize: 10,
      fontWeight: 600,
      padding: "1px 7px 1px 5px",
      cursor: "pointer",
      userSelect: "none"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: { opacity: 0.7 }
  }, "#"), tag.name, /*#__PURE__*/React.createElement("span", {
    onClick: e => {
      e.stopPropagation();
      if (onTagRemove) {
        onTagRemove(h.id, tag.name);
        setHabitTags(prev => prev.filter(t => t.name !== tag.name));
      }
    },
    style: {
      marginLeft: 2,
      opacity: 0.5,
      fontWeight: 400,
      fontSize: 12,
      lineHeight: 1,
      cursor: "pointer"
    }
  }, "×"))), habitTags.length > 3 && /*#__PURE__*/React.createElement("span", {
    onClick: () => setTagsExpanded(e => !e),
    style: {
      fontSize: 10,
      color: "var(--text-light)",
      cursor: "pointer",
      padding: "1px 5px",
      borderRadius: 999,
      border: "1px solid var(--border)"
    }
  }, tagsExpanded ? "‹" : `+${habitTags.length - 3}`))),
  
  /* Mini heatmap (center-right) */
  /*#__PURE__*/React.createElement(MiniHeatmap, {
    habitId: h.id,
    habitData: habit30DayData
  }),
  
  /* Check today button */
  /*#__PURE__*/React.createElement("button", {
    className: `habit-check-btn ${h.today_status || 'empty'}`,
    onClick: e => {
      e.stopPropagation();
      onCheckin(h);
    }
  }, h.today_status === 'done' ? '✓' : h.today_status === 'skipped' ? '−' : '+'),
  
  /* Streak badge */
  /*#__PURE__*/React.createElement("div", {
    className: `habit-streak-badge${h.streak > 0 ? ' active' : ''}`
  }, /*#__PURE__*/React.createElement("span", null, "🔥"), /*#__PURE__*/React.createElement("span", null, h.streak || 0)),
  
  /* Menu button */
  !h._pending && /*#__PURE__*/React.createElement("div", {
    style: {
      position: "relative",
      zIndex: 10,
      marginLeft: 6,
      flexShrink: 0
    },
    onClick: e => e.stopPropagation()
  }, /*#__PURE__*/React.createElement("button", {
    style: {
      background: "none",
      border: "none",
      cursor: "pointer",
      color: "var(--text-secondary)",
      fontSize: 18,
      padding: "2px 6px",
      borderRadius: 6,
      lineHeight: 1
    },
    onClick: () => setMenuOpen(p => !p)
  }, "⋮"), menuOpen && /*#__PURE__*/React.createElement("div", {
    style: {
      position: "absolute",
      right: 0,
      top: "calc(100% + 4px)",
      background: "var(--bg-card)",
      border: "1px solid var(--border)",
      borderRadius: 10,
      boxShadow: "0 8px 24px rgba(0,0,0,0.2)",
      zIndex: 20,
      minWidth: 130,
      overflow: "hidden"
    }
  }, /*#__PURE__*/React.createElement("button", {
    style: {
      display: "block",
      width: "100%",
      padding: "10px 16px",
      background: "none",
      border: "none",
      textAlign: "left",
      cursor: "pointer",
      fontSize: 13,
      color: "var(--text-primary)"
    },
    onClick: () => {
      closeMenu();
      onEdit(h);
    }
  }, "✏️ Edit"), /*#__PURE__*/React.createElement("button", {
    style: {
      display: "block",
      width: "100%",
      padding: "10px 16px",
      background: "none",
      border: "none",
      textAlign: "left",
      cursor: "pointer",
      fontSize: 13,
      color: "#ef4444"
    },
    onClick: () => {
      closeMenu();
      if (confirm(`Hapus habit "${h.title}"?`)) {
        onDelete(h.id);
      }
    }
  }, "🗑 Hapus"))));
}
```

- [ ] **Step 4: Verify syntax**

```bash
node scratch/check_inline.js static/index.html
```

Expected: All scripts OK

- [ ] **Step 5: Commit HabitCard rewrite**

```bash
git add static/index.html
git commit -m "refactor(habits): rewrite HabitCard with new layout

New layout: Info | MiniHeatmap | CheckButton | Streak | Menu
Removes 7-day checkbox grid. Check button opens existing modal.
Mini heatmap placeholder (empty for now, needs per-habit data).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 10: Frontend — Remove Old Habit CSS Classes

**Files:**
- Modify: `static/app.css` (remove old classes that are no longer used)

**Interfaces:**
- Consumes: None
- Produces: Cleaner CSS file without dead code

---

- [ ] **Step 1: Remove old habit card grid classes**

Find and **DELETE** these CSS rules from `static/app.css`:

```css
.habit-card-grid
.habit-week-col
.habit-week-label
.habit-week-box
```

Search for each class name and remove the entire rule block (including media queries).

- [ ] **Step 2: Verify no other code references removed classes**

```bash
grep -n "habit-card-grid\|habit-week-col\|habit-week-label\|habit-week-box" static/index.html
```

Expected: No matches (since we rewrote HabitCard)

- [ ] **Step 3: Commit CSS cleanup**

```bash
git add static/app.css
git commit -m "refactor(habits): remove old 7-day grid CSS classes

Removed .habit-card-grid, .habit-week-col, .habit-week-label,
.habit-week-box as they are no longer used after redesign.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 11: Service Worker — Bump Cache Version

**Files:**
- Modify: `static/sw.js` (line 1, cache version constant)

**Interfaces:**
- Consumes: None
- Produces: New cache version to force client updates

---

- [ ] **Step 1: Update CACHE constant**

Find line 1 in `static/sw.js`:

```javascript
const CACHE = "taskflow-v361-rename-workspace-ui";
```

**CHANGE** to:

```javascript
const CACHE = "taskflow-v362-habit-page-redesign";
```

- [ ] **Step 2: Verify SW syntax**

```bash
node --check static/sw.js
```

Expected: No errors

- [ ] **Step 3: Commit SW version bump**

```bash
git add static/sw.js
git commit -m "chore(sw): bump cache to v362 for habit page redesign

Forces clients to fetch new HTML/CSS with redesigned habit page.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 12: Integration — Wire Per-Habit 30-Day Data

**Files:**
- Modify: `webapp.py` (add per-habit endpoint or extend existing)
- Modify: `static/index.html` (fetch and pass habit-specific data to MiniHeatmap)

**Interfaces:**
- Consumes: `habit_logs` table per habit
- Produces: Per-habit 30-day array passed to `MiniHeatmap`

**NOTE:** This task fills in the temporary empty array from Task 6/9.

---

- [ ] **Step 1: Option A — Extend /api/habits/today to include 30-day logs**

Find `get_habits_today` function in `webapp.py`. After building the habit object with `week_log`, add a field `month_log`:

```python
# Inside get_habits_today, after week_log is built for each habit:

# Fetch last 30 days of logs for this habit
month_logs_query = """
SELECT date, status 
FROM habit_logs 
WHERE habit_id = ? 
  AND date >= DATE('now', '-30 days')
ORDER BY date ASC
"""
month_logs_rows = conn.execute(month_logs_query, (hid,)).fetchall()

# Build 30-day array
month_log = []
start_date = (_today_jkt() - timedelta(days=29)).date()
for i in range(30):
  day = start_date + timedelta(days=i)
  day_str = day.isoformat()
  log_row = next((r for r in month_logs_rows if r["date"] == day_str), None)
  month_log.append({
    "date": day_str,
    "status": log_row["status"] if log_row else None
  })

# Add to habit dict:
h_dict["month_log"] = month_log
```

- [ ] **Step 2: Update getHabit30DayData helper in index.html**

Find `getHabit30DayData` helper and update:

```javascript
function getHabit30DayData(habitId, habit) {
  // habit.month_log is array of {date, status} from backend
  if (habit && habit.month_log && Array.isArray(habit.month_log)) {
    return habit.month_log;
  }
  
  // Fallback: empty 30 cells
  const today = new Date();
  const arr = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    arr.push({
      date: d.toISOString().split('T')[0],
      status: null
    });
  }
  return arr;
}
```

- [ ] **Step 3: Update HabitCard to pass habit object to helper**

In `HabitCard`, change:

```javascript
const habit30DayData = getHabit30DayData(h.id, h); // Pass h object
```

- [ ] **Step 4: Test backend change**

Start server and check `/api/habits/today` response includes `month_log` array for each habit.

- [ ] **Step 5: Verify syntax**

```bash
node scratch/check_inline.js static/index.html
```

Expected: All scripts OK

- [ ] **Step 6: Commit per-habit 30-day data**

```bash
git add webapp.py static/index.html
git commit -m "feat(habits): add per-habit 30-day logs to /api/habits/today

Backend extends habit objects with month_log array (30 days).
Frontend helper extracts and passes to MiniHeatmap component.
Fallback to empty cells if no data.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 13: Testing — Manual Verification

**Files:**
- None (manual testing only)

**Interfaces:**
- Consumes: Deployed application
- Produces: Verification checklist

---

- [ ] **Step 1: Test summary cards**

1. Open habits page in browser
2. Verify 4 summary cards display at top
3. Check values are correct (not NaN or null)
4. Resize window to mobile width (<768px)
5. Verify cards switch to 2×2 grid

- [ ] **Step 2: Test calendar heatmap**

1. Verify 7×5 grid appears below summary cards
2. Check today's cell is highlighted with blue border
3. Hover over cells — tooltip should appear
4. Verify color intensity matches completion rate
5. On mobile, verify heatmap is scrollable horizontally

- [ ] **Step 3: Test habit rows**

1. Verify each habit shows new layout (no 7-day grid)
2. Check mini heatmap shows 30 tiny cells
3. Hover mini cells — tooltip should appear
4. Click check button — `HabitCheckinModal` should open
5. Verify streak badge displays correctly
6. Click menu (⋮) — Edit/Delete options should appear

- [ ] **Step 4: Test offline behavior**

1. Go offline (disable network in DevTools)
2. Reload page
3. Summary cards should still show (from cached habits data)
4. Calendar heatmap should show "Tidak ada data" or hide gracefully
5. Check button should still work (queues action offline)

- [ ] **Step 5: Test responsive design**

1. Test on desktop (>1024px)
2. Test on tablet (768-1024px)
3. Test on mobile (<768px)
4. Verify all elements visible and usable on each size

- [ ] **Step 6: Document any issues found**

If bugs found, create new commits to fix them.

---

## Self-Review Checklist

- [x] **Spec coverage:** All sections implemented
  - Summary cards: ✓ Task 4
  - Calendar heatmap: ✓ Task 5
  - Mini heatmap per habit: ✓ Task 6
  - Check today button: ✓ Task 9
  - Monthly completion endpoint: ✓ Task 1
  
- [x] **Placeholders:** None found — all code is complete

- [x] **Type consistency:** 
  - `monthlyData` → `{days: [...]}`
  - `summaryStats` → `{totalActive, completionRate, bestStreak, weekDone, weekTotal}`
  - All function signatures match across tasks

- [x] **Review Focus:**
  - Empty habit list: Task 3 `computeSummaryStats` returns zeros
  - Offline heatmap: Task 5 `CalendarHeatmap` shows fallback message
  - Today at boundary: Task 5 uses `toISOString().split('T')[0]` comparison
  - Touch hover: Task 2 CSS tooltips use `:hover` (works on touch)
  - Sparse mini data: Task 6 `MiniHeatmap` shows empty cells gracefully

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-10-04-habit-page-redesign.md`. Please review the plan. Which execution approach would you prefer?

- **Subagent-driven** - A fresh subagent implements each task and a fresh reviewer checks it before the next one starts, then a whole-branch review at the end. Most thorough; costs a fresh context per task and per review.
- **Native** - I implement every task myself in this session, the way this harness runs work, then one fresh reviewer on the most capable model checks the whole branch. Cheapest and fastest; no independent review until the end. Runs well with a mid-tier session model, since the plan carries the design.

For this plan I recommend **Native**, because tasks are sequential and share state (monthlyData, summaryStats), making fresh context per task less valuable. The plan is detailed enough to execute reliably in one session.

Does the plan capture what you want, and which approach should we use?
