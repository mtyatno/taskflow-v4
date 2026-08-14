# Habit Tracker UI/UX Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the Habit Tracker UI in `static/index.html` to a gamified, high-motivation "Hero Dashboard" with dynamic progress rings, 30-day activity heatmaps, compact 7-day status pills, and celebratory micro-interactions.

**Architecture:** Update React components `HabitPage` and `HabitCard` in `static/index.html`. Add dedicated HSL design tokens and CSS styles for Habit Tracker components in the embedded style block for seamless Light and Dark theme support.

**Tech Stack:** React (embedded in `static/index.html`), Vanilla CSS, LocalStorage / OfflineDB.

## Global Constraints

- Preserve existing backend API contracts (`/api/habits/today`, `/api/habits/monthly`, `/api/habits/{id}/checkin`).
- Preserve offline queueing logic via `OfflineDB`.
- High contrast legibility in both Light (`data-theme="light"`) and Dark (`data-theme="dark"`) modes.

---

### Task 1: Add CSS Design Tokens & Styling for Habit Redesign

**Files:**
- Modify: `static/index.html` (embedded CSS style block)

**Interfaces:**
- Consumes: CSS variables `data-theme` attribute on `document.documentElement`.
- Produces: CSS utility classes `.habit-hero-card`, `.habit-heatmap-grid`, `.habit-card-redesign`, `.habit-day-pill`, `.habit-streak-badge`.

- [ ] **Step 1: Inspect existing Habit CSS in `static/index.html`**

View lines in `static/index.html` where habit card styles are defined to avoid conflicting selectors.

- [ ] **Step 2: Add theme tokens & component styles**

Add the following CSS rules to the main `<style>` block in `static/index.html`:

```css
/* Habit Tracker Redesign Styles */
.habit-hero-container {
  display: grid;
  grid-template-columns: 1fr;
  gap: 16px;
  margin-bottom: 24px;
}
@media (min-width: 768px) {
  .habit-hero-container {
    grid-template-columns: 3fr 2fr;
  }
}
.habit-hero-card {
  background: var(--card-bg, #ffffff);
  border: 1px solid var(--border-color, rgba(0,0,0,0.08));
  border-radius: 16px;
  padding: 20px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.03);
}
.habit-heatmap-grid {
  display: grid;
  grid-template-columns: repeat(10, 1fr);
  gap: 6px;
  margin-top: 12px;
}
.habit-heatmap-cell {
  aspect-ratio: 1;
  border-radius: 4px;
  background: var(--bg-tertiary, #e2e8f0);
  transition: all 0.2s ease;
}
.habit-heatmap-cell[data-level="1"] { background: rgba(132, 204, 22, 0.3); }
.habit-heatmap-cell[data-level="2"] { background: rgba(132, 204, 22, 0.6); }
.habit-heatmap-cell[data-level="3"] { background: rgba(132, 204, 22, 1); box-shadow: 0 0 8px rgba(132, 204, 22, 0.4); }

.habit-card-redesign {
  background: var(--card-bg, #ffffff);
  border: 1px solid var(--border-color, rgba(0,0,0,0.06));
  border-radius: 14px;
  padding: 16px 20px;
  margin-bottom: 12px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  transition: transform 0.15s ease, box-shadow 0.15s ease;
}
.habit-card-redesign:hover {
  transform: translateY(-1px);
  box-shadow: 0 6px 16px rgba(0,0,0,0.05);
}
.habit-day-pill {
  width: 32px;
  height: 36px;
  border-radius: 10px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  border: 1px solid var(--border-color, rgba(0,0,0,0.1));
  background: var(--bg-secondary, #f1f5f9);
  color: var(--text-muted, #64748b);
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}
.habit-day-pill.today {
  border: 2px solid var(--accent, #84cc16);
  color: var(--text-main, #0f172a);
}
.habit-day-pill.done {
  background: var(--accent, #84cc16);
  color: #ffffff;
  border-color: var(--accent, #84cc16);
}
.habit-day-pill.done:active {
  transform: scale(0.92);
}
.habit-streak-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  border-radius: 20px;
  font-size: 12px;
  font-weight: 700;
  background: rgba(245, 158, 11, 0.12);
  color: #d97706;
}
[data-theme="dark"] .habit-streak-badge {
  background: rgba(251, 191, 36, 0.18);
  color: #fbbf24;
}
```

- [ ] **Step 3: Verify CSS syntax & commit**

```bash
git add static/index.html
git commit -m "style: add CSS styles and tokens for Habit Tracker redesign"
```

---

### Task 2: Redesign Habit Page Header (Hero Progress & 30-Day Heatmap)

**Files:**
- Modify: `static/index.html` (`HabitPage` component ~L19687-L19850)

**Interfaces:**
- Consumes: `monthlyData` state from `/api/habits/monthly`, `habits` list from `/api/habits/today`.
- Produces: Hero Progress Banner, 30-day dot grid heatmap, Affirmation card.

- [ ] **Step 1: Locate `HabitPage` header rendering logic in `static/index.html`**

Inspect lines 19760 to 19850 where the chart and top section are rendered.

- [ ] **Step 2: Replace flat line chart with Hero Progress Ring & 30-day Heatmap**

Update `HabitPage` JSX:
1. Calculate daily completion percentage: `doneCount / totalCount * 100`.
2. Render Progress Ring / Bar with dynamic encouragement text (e.g. `X/Y Habit Selesai`).
3. Render 30-day Heatmap Grid mapping `monthlyData.days` array to `.habit-heatmap-cell` elements with `data-level` intensity attributes.

- [ ] **Step 3: Verify rendering in browser**

Open the app or test dev server to verify `HabitPage` header renders cleanly without React errors.

- [ ] **Step 4: Commit**

```bash
git add static/index.html
git commit -m "feat(habits): replace flat line chart with Hero Progress & 30-day Heatmap"
```

---

### Task 3: Redesign Habit Cards Component & Time Phase Groups

**Files:**
- Modify: `static/index.html` (`HabitCard` component & phase section loops ~L19500-L19680)

**Interfaces:**
- Consumes: `habit` object (with `week_log`, `today_status`, `streak`, `title`, `phase`, `target`).
- Produces: `HabitCard` with compact 7-day pills, dynamic streak flame badge, and check-in callback.

- [ ] **Step 1: Locate `HabitCard` component definition in `static/index.html`**

Inspect `HabitCard` props and render structure (~L19500-L19670).

- [ ] **Step 2: Refactor `HabitCard` layout**

1. Render Habit Title & Subtitle target on left.
2. Render 7 day pills (`Sen` to `Min`) with distinct classes (`.done`, `.today`, `.missed`).
3. Clicking today's pill triggers `onCheckin(habit, dow)` check-in function with pulse animation.
4. Render Dynamic Streak Badge (`🔥 N Hari`) on the right.
5. Update Phase Section Headers (`PAGI`, `SIANG`, `MALAM`) with phase completion pill (e.g. `3/3 Selesai ✨`).

- [ ] **Step 3: Verify Habit Card interaction & check-in flow**

Click check-in pill for habit; verify status changes to done, streak increments, and progress ring updates immediately.

- [ ] **Step 4: Commit**

```bash
git add static/index.html
git commit -m "feat(habits): refactor HabitCard to compact 7-day pills and dynamic streak badges"
```

---

### Task 4: Visual Polish & Theme Verification (Light & Dark Mode)

**Files:**
- Modify: `static/index.html` (adjust margins, dark mode contrast if needed)

- [ ] **Step 1: Test Light Theme rendering**

Ensure card backgrounds, text contrast, check-in pills, and heatmap grid look sharp in Light theme (`data-theme="light"`).

- [ ] **Step 2: Test Dark Theme rendering**

Switch app to Dark theme (`data-theme="dark"`). Ensure glowing green accents, slate card backgrounds, and gold streak badges are legible and premium.

- [ ] **Step 3: Commit final polish**

```bash
git add static/index.html
git commit -m "style(habits): polish Light and Dark theme contrast for Habit Tracker redesign"
```
