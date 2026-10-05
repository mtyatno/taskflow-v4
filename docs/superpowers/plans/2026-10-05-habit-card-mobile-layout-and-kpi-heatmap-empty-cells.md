# Implementation Plan: Habit Card Mobile Responsive Layout & KPI Calendar Heatmap Empty Cells

## 1. Overview
Fix two visual issues on the Habits page:
1. Restore missing `.habit-heatmap-cell` styling in `static/app.css` with explicit dimensions (20px / 18px), high-contrast empty cells, and color levels.
2. Restructure `HabitCard` with `.habit-card-main` and `.habit-card-actions` so on mobile (≤640px) it breaks into a clean 2-row layout: full-width title/info + top-right meta on row 1, and mini heatmap + check-in button on row 2.
3. Bump Service Worker cache version to `taskflow-v369-habit-card-mobile-fix` and `app.css?v=315`, and synchronize offline tests.

---

## 2. Tasks

### Task 1: KPI Calendar Heatmap Visible Empty Cells & Color Levels
**Files to Touch:**
- Modify: `static/app.css`
  - Add `.habit-heatmap-cell` base rules:
    ```css
    .habit-heatmap-cell {
      width: 20px;
      height: 20px;
      border-radius: 4px;
      transition: transform 0.15s;
      cursor: pointer;
      position: relative;
      box-sizing: border-box;
    }
    .habit-heatmap-cell.is-empty {
      background: rgba(0, 0, 0, 0.04);
      border: 1px solid rgba(0, 0, 0, 0.12);
    }
    [data-theme="dark"] .habit-heatmap-cell.is-empty {
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid rgba(255, 255, 255, 0.18);
    }
    .habit-heatmap-cell.level-1 { background: rgba(168, 197, 0, 0.25); border: 1px solid rgba(168, 197, 0, 0.35); }
    .habit-heatmap-cell.level-2 { background: rgba(168, 197, 0, 0.50); border: 1px solid rgba(168, 197, 0, 0.60); }
    .habit-heatmap-cell.level-3 { background: rgba(168, 197, 0, 0.75); border: 1px solid rgba(168, 197, 0, 0.85); }
    .habit-heatmap-cell.level-4 { background: var(--accent); border: 1px solid var(--accent); }
    .habit-heatmap-cell.today { box-shadow: 0 0 0 1.5px #818cf8; }
    .habit-heatmap-cell.is-placeholder { visibility: hidden; }
    ```
  - Update `.habit-heatmap-grid`:
    ```css
    .habit-heatmap-grid {
      display: grid;
      grid-template-columns: repeat(7, 20px);
      gap: 3px;
      justify-content: center;
    }
    .habit-heatmap-labels {
      display: grid;
      grid-template-columns: repeat(7, 20px);
      gap: 3px;
      justify-content: center;
      margin-bottom: 6px;
    }
    @media (max-width: 768px) {
      .habit-heatmap-grid,
      .habit-heatmap-labels {
        grid-template-columns: repeat(7, 18px);
      }
      .habit-heatmap-cell {
        width: 18px;
        height: 18px;
      }
    }
    ```
- Modify: `static/index.html` (`CalendarHeatmap`):
  - In `cells.map`:
    ```javascript
    if (!cell) return /*#__PURE__*/React.createElement("div", { key: i, className: "habit-heatmap-cell is-placeholder" });
    const className = `habit-heatmap-cell${cell.level > 0 ? ` level-${cell.level}` : ' is-empty'}${cell.isToday ? ' today' : ''}`;
    ```
- Modify: `tests/offline/habit_hero_redesign.test.js`:
  - Add assertions for `.habit-heatmap-cell` dimensions, `.is-empty`, `.level-4`, and dark mode styles.

---

### Task 2: Mobile Responsive 2-Row Habit Card Layout
**Files to Touch:**
- Modify: `static/index.html` (`HabitCard`):
  - Wrap elements into `.habit-card-main` (info + meta) and `.habit-card-actions` (mini heatmap + check button).
- Modify: `static/app.css`:
  - Add styles for `.habit-card-main`, `.habit-card-meta`, `.habit-card-actions`.
  - Add `@media (max-width: 640px)` where `.habit-card-new` is `flex-direction: column`, `.habit-card-main` takes 100% with `justify-content: space-between`, and `.habit-card-actions` takes 100% with `justify-content: space-between; border-top: 1px dashed var(--border); padding-top: 8px;`.
- Modify: `tests/offline/habit_card_redesign.test.js`:
  - Add assertions verifying `.habit-card-main`, `.habit-card-actions`, and mobile responsive CSS rules.

---

### Task 3: Service Worker Bump, Cache Assertion Sync & Full Verification
**Files to Touch:**
- Modify: `static/sw.js` (bump CACHE to `taskflow-v369-habit-card-mobile-fix`)
- Modify: `static/index.html` (bump CSS link to `app.css?v=315`)
- Modify: 6 offline test suites (`direct_messages_ui`, `drawing_sync_ui`, `focus_workstation`, `interactive_note_viewer`, `note_saved_searches_view_mode`, `note_search_filters`)
- Verification:
  - `node scratch/check_inline.js static/index.html` (5/5 OK)
  - `node --check static/sw.js` (OK)
  - `node --test tests/offline/habit*.test.js` (all pass)
  - `python -m pytest tests/` (123/123 pass)
