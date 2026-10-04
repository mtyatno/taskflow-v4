# Habit Page Redesign — Minimalist Dashboard

**Date:** 2026-10-04  
**Author:** Claude Opus 5 + User (yatno)  
**Status:** Design Approved

---

## Overview

Redesign the Habit Tracker page to be more minimalist, actionable, and data-rich. Replace the current 7-day checkbox grid with a single "check today" button per habit, add 30-day history visualization per habit, and create a dashboard-style top section with summary cards and a monthly heatmap.

---

## Context & Goals

**Current state:**
- Each habit displays a 7-day grid (Mon-Sun) of checkboxes for the current week
- Top section shows a line chart of total habits completed per day across the month
- User needs to scan multiple rows to check today's habits

**Problems:**
- Too many visual elements per habit row (7 checkboxes) when user only cares about today
- Line chart is not the most intuitive way to see monthly completion patterns
- No quick overview of overall performance (completion rate, streaks, progress)

**Goals:**
- **Simplify action:** One check button per habit for today
- **Richer history:** 30-day mini heatmap per habit to see patterns at a glance
- **Better overview:** Summary cards + calendar heatmap to understand monthly performance

---

## Design Approach

**Approach selected:** Minimalist Dashboard (A)

- **Top section:** 4 summary cards horizontal + 30-day calendar heatmap
- **Habit rows:** Single check button for today + 30-day mini heatmap + streak counter
- **Why:** Balance between clean UI and information density. All critical data is visible without overwhelming the user.

---

## Detailed Design

### 1. Page Layout Structure

**Overall hierarchy:**
```
┌─ Motivational Quote (existing)
├─ Hero Section
│  ├─ Summary Cards Row (4 cards horizontal)
│  └─ Calendar Heatmap (30-day grid)
├─ Habit List
│  ├─ Phase: PAGI (04:00 - 09:00)
│  │  └─ Habit rows...
│  ├─ Phase: SIANG (09:00 - 17:00)
│  │  └─ Habit rows...
│  └─ Phase: MALAM (17:00 - 22:00)
│     └─ Habit rows...
```

**Responsive behavior:**
- **Desktop:** 4 cards side-by-side, heatmap full width, habit mini-heatmaps inline
- **Tablet:** 2×2 card grid, heatmap scrollable horizontal
- **Mobile:** 2×2 card grid, heatmap scrollable horizontal, habit mini-heatmaps scrollable

---

### 2. Summary Cards Component

**4 cards horizontal:**

#### Card 1: Total Habits Active
- **Icon:** ⚡
- **Value:** Count of active habits (not archived)
- **Subtext:** "kebiasaan aktif"
- **Data source:** `habits.filter(h => !h.archived).length`

#### Card 2: Completion Rate
- **Icon:** ✓ (or mini progress ring)
- **Value:** Percentage (e.g., "73%")
- **Subtext:** "tingkat penyelesaian minggu ini"
- **Calculation:** `(total done checkins this week) / (total habits × 7 days) × 100`
- **Data source:** Computed from habit `week_log` array

#### Card 3: Best Streak
- **Icon:** 🔥
- **Value:** Highest `streak` value among all habits
- **Subtext:** "rekor beruntun terbaik"
- **Data source:** `Math.max(...habits.map(h => h.streak || 0))`

#### Card 4: Current Week Progress
- **Icon:** 📊
- **Value:** "12/35" format (done/total)
- **Subtext:** "checkin minggu ini"
- **Calculation:** Count all "done" statuses in habit `week_log` arrays vs total possible (habits × 7)

**Card styling:**
- Background: `var(--bg-card)`
- Border: `1px solid var(--border)`
- Border-radius: `12px`
- Padding: `14px 16px`
- Transition: subtle lift on hover (`transform: translateY(-1px)`)
- Layout: Icon (24px) + value (bold 20px) + subtext (12px secondary color)

---

### 3. Calendar Heatmap (30-day)

**Purpose:** Visualize completion patterns across the month at a glance.

**Structure:**
- **Grid:** 7 columns (Mon-Sun) × 5 rows = 35 cells
- **Display:** Last 30 days + padding to fill complete weeks
- **Cell size:** 24×24px desktop, 18×18px mobile
- **Border-radius:** 4px
- **Gap:** 3px between cells

**Color intensity (5 levels based on completion rate per day):**
- **0% (no habits done):** `var(--bg-secondary)` (neutral gray)
- **1-25%:** `rgba(168,197,0, 0.2)` (very light accent)
- **26-50%:** `rgba(168,197,0, 0.4)` (light accent)
- **51-75%:** `rgba(168,197,0, 0.7)` (medium accent)
- **76-100%:** `var(--accent)` (full accent green)

**Special indicators:**
- **Today:** Border `2px solid #818cf8` (blue) + slightly larger (26×26px)
- **Future days:** Not rendered (grid only shows up to today)

**Interaction:**
- **Hover:** Tooltip showing "Senin, 7 Okt: 3/5 habits done (60%)"
- **Click:** Optional — could navigate to daily detail view (future enhancement)

**Day labels:**
- Top row: "S M T W T F S" (abbreviated, 10px gray)

**Data source:**
- New endpoint: `GET /api/habits/monthly-completion`
- Response format:
```json
{
  "days": [
    {"date": "2026-10-04", "total_habits": 10, "done_count": 7},
    {"date": "2026-10-03", "total_habits": 10, "done_count": 8},
    ...
  ]
}
```

**Calculation:**
- Frontend computes: `completion_rate = (done_count / total_habits) × 100`
- Maps rate to color intensity level

---

### 4. Habit Row Redesign

**Current layout:**
```
[Title + Micro Target + Tags] | [7-day checkbox grid] | [Streak] | [Menu]
```

**New layout:**
```
[Info] ────────────── [30-day mini heatmap] ── [Check today] [Streak] [Menu]
```

#### Components breakdown:

**A. Info section (left):**
- **Title:** Bold 15px, same as current
- **Micro target:** 12px secondary color, "🎯 {micro_target}"
- **Tags:** Existing tag chips, same styling

**B. 30-day mini heatmap (center-right):**
- **Structure:** 30 tiny squares inline, horizontal
- **Cell size:** 10×10px or 12×12px
- **Gap:** 2px
- **Color logic:** Same 5-level intensity as big heatmap
- **Hover:** Tooltip with date + status ("7 Okt: done")
- **Responsive:** Scrollable horizontal on mobile (overflow-x: auto)
- **Width:** ~300-360px desktop

**C. Check today button (right):**
- **Size:** 44×44px circular button
- **States:**
  - **Empty:** Border `2px solid var(--border)`, icon "+" or checkbox outline
  - **Done:** Background `var(--success)`, white checkmark ✓
  - **Skipped:** Background `#facc15` (yellow), icon "−" or "skip" symbol
- **Interaction:** Click opens `HabitCheckinModal` (existing modal, no changes)

**D. Streak indicator:**
- **Icon:** 🔥
- **Value:** `h.streak || 0`
- **Style:** Same as current (13px bold, accent color if > 0)

**E. Menu button (⋮):**
- Keep existing functionality (Edit, Delete)

**Spacing:**
- Row padding: `14px 16px`
- Gap between elements: `12px`
- Habit card margin-bottom: `10px`

---

### 5. Data Requirements

#### Existing endpoints (keep as-is):
- `GET /api/habits/today` — Returns habits with `week_log`, `streak`, `today_status`
- `POST /api/habits/{id}/checkin` — Check in a habit
- `PUT /api/habits/{id}` — Edit habit
- `DELETE /api/habits/{id}` — Delete habit

#### New endpoint:

**`GET /api/habits/monthly-completion`**

Returns daily completion data for the last 30 days.

**Response format:**
```json
{
  "days": [
    {
      "date": "2026-10-04",
      "total_habits": 10,
      "done_count": 7
    },
    {
      "date": "2026-10-03",
      "total_habits": 10,
      "done_count": 8
    },
    ...
  ]
}
```

**Backend logic (pseudo-SQL):**
```sql
SELECT 
  DATE(created_at) as date,
  COUNT(DISTINCT habit_id) as total_habits,
  SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) as done_count
FROM habit_checkins
WHERE user_id = ?
  AND created_at >= DATE('now', '-30 days')
GROUP BY DATE(created_at)
ORDER BY date DESC
```

**Notes:**
- Include only days where at least one habit existed (ignore days before user created any habits)
- `total_habits` = count of active habits on that day (not archived)
- `done_count` = count of checkins with `status = 'done'` on that day

---

### 6. Component Hierarchy (React)

**New/Modified components:**

```jsx
function HabitPage({ user, showToast }) {
  // State
  const [habits, setHabits] = useState([]);
  const [monthlyData, setMonthlyData] = useState(null);
  const [summaryStats, setSummaryStats] = useState({});
  
  // Fetch
  useEffect(() => {
    fetchHabits(); // existing
    fetchMonthlyData(); // new
  }, []);
  
  // Compute summary stats from habits
  useEffect(() => {
    computeSummaryStats(habits);
  }, [habits]);
  
  return (
    <div>
      {/* Motivational quote (existing) */}
      <HeroSection 
        summaryStats={summaryStats}
        monthlyData={monthlyData}
      />
      <HabitList 
        habits={habits}
        monthlyData={monthlyData}
        onCheckin={...}
      />
    </div>
  );
}

function HeroSection({ summaryStats, monthlyData }) {
  return (
    <div className="habit-hero">
      <SummaryCards stats={summaryStats} />
      <CalendarHeatmap data={monthlyData} />
    </div>
  );
}

function SummaryCards({ stats }) {
  const cards = [
    { icon: "⚡", value: stats.totalActive, label: "kebiasaan aktif" },
    { icon: "✓", value: `${stats.completionRate}%`, label: "tingkat penyelesaian minggu ini" },
    { icon: "🔥", value: stats.bestStreak, label: "rekor beruntun terbaik" },
    { icon: "📊", value: `${stats.weekDone}/${stats.weekTotal}`, label: "checkin minggu ini" }
  ];
  
  return (
    <div className="habit-summary-cards">
      {cards.map(card => (
        <SummaryCard key={card.label} {...card} />
      ))}
    </div>
  );
}

function CalendarHeatmap({ data }) {
  // Render 7×5 grid
  // Color cells based on completion_rate
  // Highlight today
  return <div className="habit-heatmap">{/* grid */}</div>;
}

function HabitCard({ h, monthlyData, ... }) {
  // New layout:
  // [Info] | [MiniHeatmap] | [CheckButton] | [Streak] | [Menu]
  
  return (
    <div className="habit-card-new">
      <HabitInfo habit={h} />
      <MiniHeatmap habitId={h.id} data={monthlyData} />
      <CheckTodayButton habit={h} onClick={onCheckin} />
      <StreakBadge streak={h.streak} />
      <HabitMenu habit={h} onEdit={onEdit} onDelete={onDelete} />
    </div>
  );
}

function MiniHeatmap({ habitId, data }) {
  // Filter data for this specific habit (30 days)
  // Render 30 tiny cells inline
  // Tooltip on hover
  return <div className="habit-mini-heatmap">{/* cells */}</div>;
}

function CheckTodayButton({ habit, onClick }) {
  const status = habit.today_status; // "done" | "skipped" | null
  
  return (
    <button 
      className={`habit-check-btn ${status || 'empty'}`}
      onClick={() => onClick(habit)}
    >
      {status === 'done' ? '✓' : status === 'skipped' ? '−' : '+'}
    </button>
  );
}
```

---

### 7. CSS Classes & Styling

**New classes:**

```css
/* ══ Hero Section ═══════════════════════════════════════ */
.habit-hero {
  margin: 20px 0;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* ── Summary Cards ────────────────────────────────────── */
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

/* ── Calendar Heatmap ────────────────────────────────── */
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

/* ── Habit Card New Layout ────────────────────────────── */
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

.habit-card-info {
  flex: 1;
  min-width: 0;
}

.habit-card-title {
  font-size: 15px;
  font-weight: 700;
  margin-bottom: 3px;
}

.habit-card-micro {
  font-size: 12px;
  color: var(--text-secondary);
}

/* ── Mini Heatmap ────────────────────────────────────── */
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
}

.habit-mini-cell:hover {
  transform: scale(1.2);
}

.habit-mini-cell.level-1 { background: rgba(168,197,0, 0.2); }
.habit-mini-cell.level-2 { background: rgba(168,197,0, 0.4); }
.habit-mini-cell.level-3 { background: rgba(168,197,0, 0.7); }
.habit-mini-cell.level-4 { background: var(--accent); }

/* ── Check Today Button ────────────────────────────────── */
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

/* ── Streak Badge ────────────────────────────────────── */
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

---

### 8. Backend Implementation

**New endpoint:** `GET /api/habits/monthly-completion`

**File:** `webapp.py`

**Implementation:**

```python
@app.get("/api/habits/monthly-completion")
def get_habits_monthly_completion(uid: int = Depends(get_uid_from_token)):
    """
    Returns daily habit completion data for the last 30 days.
    Used for calendar heatmap visualization.
    """
    conn = get_db()
    
    # Get daily completion stats for the last 30 days
    query = """
    SELECT 
        DATE(hc.created_at) as date,
        COUNT(DISTINCT hc.habit_id) as total_habits,
        SUM(CASE WHEN hc.status = 'done' THEN 1 ELSE 0 END) as done_count
    FROM habit_checkins hc
    JOIN habits h ON h.id = hc.habit_id
    WHERE h.user_id = ?
      AND hc.created_at >= DATE('now', '-30 days')
      AND h.archived = 0
    GROUP BY DATE(hc.created_at)
    ORDER BY date DESC
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

**Note:** Assumes `habit_checkins` table exists with columns:
- `id`, `habit_id`, `user_id`, `status`, `created_at`

If this table doesn't exist yet, we need to create it or adjust the query to derive checkin data from `habits.week_log` or another source.

---

### 9. Migration & Backward Compatibility

**Breaking changes:**
- None. This is a pure UI redesign. All existing functionality (`HabitCheckinModal`, CRUD operations, phase grouping) remains unchanged.

**Data requirements:**
- New endpoint `/api/habits/monthly-completion` must be created
- If `habit_checkins` table doesn't exist, need to create it or adjust query to use existing data structure

**Deployment:**
- Backend: Add new endpoint
- Frontend: Update `HabitPage` and `HabitCard` components
- CSS: Add new classes
- Service Worker: Bump cache version

**Offline support:**
- Summary stats: Computed from cached `habits_today` data
- Monthly heatmap: Falls back gracefully if endpoint fails (hide heatmap or show "Offline" message)
- Check button: Uses existing offline queue mechanism

---

### 10. Testing Plan

**Visual testing:**
- [ ] Summary cards display correct values
- [ ] Summary cards responsive (4 cols → 2×2 grid)
- [ ] Calendar heatmap renders with correct color intensity
- [ ] Calendar heatmap highlights today correctly
- [ ] Habit mini heatmap scrolls horizontally on mobile
- [ ] Check button states (empty/done/skipped) display correctly

**Interaction testing:**
- [ ] Click check button opens `HabitCheckinModal`
- [ ] Hover on heatmap cell shows tooltip
- [ ] Hover on mini heatmap cell shows tooltip
- [ ] Menu button (⋮) still works
- [ ] Habit CRUD operations still work

**Data testing:**
- [ ] Summary stats calculate correctly
- [ ] Heatmap color intensity matches completion rate
- [ ] Mini heatmap shows last 30 days for each habit
- [ ] New endpoint returns correct data

**Responsive testing:**
- [ ] Desktop: all elements visible, proper spacing
- [ ] Tablet: cards 2×2, heatmap scrollable
- [ ] Mobile: cards 2×2, mini heatmaps scrollable

**Offline testing:**
- [ ] Summary stats work with cached data
- [ ] Heatmap fails gracefully when offline
- [ ] Check button queues action when offline

---

## Files to Modify

1. **`static/index.html`**
   - Rewrite `HabitPage` component
   - Rewrite `HabitCard` component
   - Add new components: `HeroSection`, `SummaryCards`, `CalendarHeatmap`, `MiniHeatmap`, `CheckTodayButton`
   - Update `fetchHabits` to also fetch monthly data

2. **`static/app.css`**
   - Add new classes (see Section 7)
   - Remove old classes: `.habit-card-grid`, `.habit-week-col`, `.habit-week-label`, `.habit-week-box`

3. **`webapp.py`**
   - Add new endpoint `GET /api/habits/monthly-completion` (see Section 8)

4. **`static/sw.js`**
   - Bump cache version

5. **Tests** (if exist):
   - Update Habit page tests to match new structure
   - Add tests for new endpoint

---

## Open Questions

1. **Habit checkins table:** Does `habit_checkins` table exist? If not, how is daily status currently stored?
   - **Answer needed:** Check database schema to determine data source for monthly heatmap

2. **Per-habit mini heatmap data:** Should the mini heatmap show completion for that specific habit, or overall daily completion?
   - **Assumption:** Per-habit (i.e., each habit's mini heatmap shows its own 30-day history)
   - **Implication:** Need to query per-habit checkin data, not just overall

3. **Tooltip library:** Use existing tooltip mechanism or implement custom?
   - **Recommendation:** Custom CSS tooltip (simpler, no dependencies)

---

## Success Criteria

✅ User can check off today's habit with one click  
✅ User can see 30-day history for each habit at a glance  
✅ User can understand monthly performance via summary cards + heatmap  
✅ Page is more compact (less vertical scroll)  
✅ All existing functionality (edit, delete, phase grouping) still works  
✅ Mobile responsive and usable  

---

## Future Enhancements (Out of Scope)

- Click heatmap cell to see daily detail view
- Filter habits by completion rate or streak
- Export habit data as CSV
- Habit insights / AI suggestions
- Custom color themes for heatmap

---

