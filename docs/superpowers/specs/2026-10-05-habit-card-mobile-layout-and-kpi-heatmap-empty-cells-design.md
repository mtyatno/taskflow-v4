# Design Spec: Habit Card Mobile Responsive Layout & KPI Calendar Heatmap Empty Cells

## 1. Context & Motivation
Following the habits page redesign, the user reported two critical visual issues (with screenshot `Z:\Todolist Manager V5.0\temporary_files\Screenshot 2026-10-05 at 19-37-51 Alurik.png`):
1. **KPI Heatmap Empty Cells:**
   - In the 5th KPI card ("Aktivitas 35 Hari"), the calendar heatmap grid rendered blank underneath day labels ("S M T W T F S").
   - Root cause: `.habit-heatmap-cell` base CSS rules were missing in `static/app.css` (cells collapsed to 0×0px), and empty/zero-completion cells had no visible background or border.
2. **Mobile Habit Card Layout Squished ("Amburadul"):**
   - On mobile screens (≤640px), `.habit-card-new` placed 5 components in a single horizontal flex row:
     `[Title/Info] [Mini Heatmap (192px)] [Check button (44px)] [Streak (35px)] [Menu (20px)]`
   - Non-title elements occupied >330px, forcing `.habit-card-info-new` down to ~40px width.
   - This caused habit names to wrap 1 word per line ("Minum \n air \n putih \n setelah \n bangun \n tidur"), micro targets to be squashed vertically, and the card height to balloon to ~180px with misaligned buttons.

---

## 2. Requirements & Desired Behavior

### Requirement 1: KPI Calendar Heatmap Visible Cells & High Contrast
- **Cell Dimensions:** In `static/app.css`, `.habit-heatmap-cell` must have explicit dimensions:
  - Width: 20px, Height: 20px, Border-radius: 4px.
  - On mobile screens (≤768px): 18px × 18px.
- **Empty / Incomplete Cells (`.is-empty` / Level 0):**
  - Light mode: `background: rgba(0, 0, 0, 0.04); border: 1px solid rgba(0, 0, 0, 0.12);`
  - Dark mode: `background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.18);`
- **Levels 1 to 4:**
  - `.level-1`: `background: rgba(168, 197, 0, 0.25); border: 1px solid rgba(168, 197, 0, 0.35);`
  - `.level-2`: `background: rgba(168, 197, 0, 0.50); border: 1px solid rgba(168, 197, 0, 0.60);`
  - `.level-3`: `background: rgba(168, 197, 0, 0.75); border: 1px solid rgba(168, 197, 0, 0.85);`
  - `.level-4`: `background: var(--accent); border: 1px solid var(--accent);`
- **Today Indicator:**
  - `.today`: `box-shadow: 0 0 0 1.5px #818cf8;`
- **Placeholder Cells (`!cell`):**
  - Render with `.habit-heatmap-cell.is-placeholder` with `visibility: hidden` (or subtle dashed outline) to maintain strict 7-column grid alignment.

### Requirement 2: Mobile Responsive 2-Row Habit Card Layout
- **Component Anatomy (`HabitCard` in `static/index.html`):**
  ```jsx
  <div className="habit-card-new">
    {/* Section 1: Main Info & Meta */}
    <div className="habit-card-main">
      <div className="habit-card-info-new">
        <div className="habit-card-title-new">{h.title} ...</div>
        {h.micro_target && <div className="habit-card-micro-new">🎯 {h.micro_target}</div>}
        {habitTags.length > 0 && <div className="habit-card-tags">...</div>}
      </div>
      <div className="habit-card-meta">
        <div className={`habit-streak-badge${h.streak > 0 ? ' active' : ''}`}>...</div>
        {!h._pending && <div className="habit-menu-wrap">...</div>}
      </div>
    </div>

    {/* Section 2: Visual Progress & Action */}
    <div className="habit-card-actions">
      <MiniHeatmap habitId={h.id} habitData={habit30DayData} />
      <button className={`habit-check-btn ${h.today_status || 'empty'}`} onClick={handleButtonClick}>
        {h.today_status === 'done' ? '✓' : h.today_status === 'skipped' ? '−' : '+'}
      </button>
    </div>
  </div>
  ```
- **Desktop Behavior (>640px):**
  - `.habit-card-new`: `display: flex; align-items: center; justify-content: space-between; gap: 16px;`
  - `.habit-card-main`: `display: flex; align-items: center; gap: 12px; flex: 1; min-width: 0;`
  - `.habit-card-info-new`: `flex: 1; min-width: 0;`
  - `.habit-card-actions`: `display: flex; align-items: center; gap: 12px; flex-shrink: 0;`
  - `.habit-card-meta`: `display: flex; align-items: center; gap: 8px; flex-shrink: 0;`
- **Mobile Behavior (≤640px):**
  - `.habit-card-new`: `display: flex; flex-direction: column; align-items: stretch; gap: 12px; padding: 14px 16px;`
  - `.habit-card-main`: `display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; width: 100%;`
    - `.habit-card-info-new`: `flex: 1; min-width: 0;` (Habit title gets 100% full width to wrap naturally across 1–2 normal lines!)
    - `.habit-card-meta`: `display: flex; align-items: center; gap: 6px; flex-shrink: 0; margin-top: 2px;` (Streak badge and ⋯ menu neatly grouped in the top-right corner).
  - `.habit-card-actions`: `display: flex; align-items: center; justify-content: space-between; width: 100%; padding-top: 8px; border-top: 1px dashed var(--border);`
    - `MiniHeatmap`: 2 rows of 15 squares sit on the left (192px width easily fits on 320px+ mobile).
    - `habit-check-btn`: 42px touch-friendly circle sits on the right, directly under the user's thumb!

---

## 3. Backward Compatibility & Test Guardrails
- Desktop layout is 100% preserved.
- No changes to check-in click handler or optimistic state logic.
- Offline IndexedDB caching and outbox queues remain intact.
- Service Worker bumped to `taskflow-v369-habit-card-mobile-fix` and CSS to `app.css?v=315`.
