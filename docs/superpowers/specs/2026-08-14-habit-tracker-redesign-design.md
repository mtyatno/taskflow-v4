# Habit Tracker UI/UX Redesign — Design Specification

**Date:** 2026-08-14  
**Author:** Antigravity (Gemini 3.6 Flash) & User  
**Status:** Approved by User  
**Target:** TaskFlow WebApp (`static/index.html`, Habit Components & Styling)

---

## 1. Executive Summary & Goals

The current Habit Tracker UI features a repetitive table-like row layout, low contrast, static line graph (-1 to 1 axis), and static flame indicators. This spec defines a gamified, dynamic redesign ("Hero Gamified Dashboard") to maximize motivation, clarity, and dopamine feedback loops across both Light and Dark themes.

### Primary Objectives
1. **Gamification & Daily Progress**: Introduce a prominent Hero progress bar/ring and a 30-day activity heatmap grid.
2. **Visual Hierarchy & Ergonomics**: Remove repetitive day label headers per row; streamline to compact 7-day status pills.
3. **Dopamine Micro-interactions**: Add celebratory visual feedback (pulse, checkmark glow, dynamic streak badges) on check-in.
4. **Seamless Theme Support**: High-contrast, premium styling tuned specifically for Light mode (`#f8fafc` surface) and Dark mode (`#0f172a` surface).

---

## 2. UI/UX Component Specifications

### 2.1 Hero Dashboard Header
- **Daily Progress Summary**:
  - Displays circular or segmented daily completion rate (e.g. `5/8 Habit Selesai • 62.5%`).
  - Dynamic motivational text based on percentage completed (e.g. *"Tinggal 3 habit lagi untuk menyempurnakan hari ini! 🔥"*).
- **Consistency Heatmap Grid**:
  - Replaces the raw `-1 to 1` line chart with a 30-day GitHub/Habitify style contribution dot grid.
  - Cell intensity scales with completion rate (0%, 1-49%, 50-99%, 100%).
  - Interactive hover/tap tooltip showing date & completed count.
- **Identity Affirmation Pill**:
  - Styled as an inspirational card with a sparkle icon ✨, cursive typography, and quick edit trigger.

### 2.2 Time-of-Day Section Groups (Pagi, Siang, Malam)
- Phase header badge with icon (☼ Pagi 04:00-09:00, ☁ Siang 09:00-17:00, 🌙 Malam 17:00-22:00).
- Phase progress indicator pill on the right (e.g. `3/3 Selesai ✨` styled in vibrant green when 100% complete).

### 2.3 Redesigned Habit Card Component
- **Left Column**:
  - Habit category/emoji avatar in soft rounded container.
  - Habit title (bold, primary text).
  - Target anchor / subtitle (e.g. `🎯 1 gelas air mineral`).
- **Center Column (Compact 7-Day Day Selector)**:
  - 7 compact day circles (`Sen`, `Sel`, `Rab`, `Kam`, `Jum`, `Sab`, `Min`).
  - **Today**: Distinct active ring/border highlighting the current day.
  - **Completed**: Filled with accent lime/emerald green (`#84cc16` in Light, `#34d399` in Dark) with white checkmark.
  - **Missed/Pending**: Soft neutral background.
- **Right Column**:
  - **Dynamic Streak Badge (`🔥 N Hari`)**:
    - 1-6 days: Warm Amber/Orange (`#f59e0b`).
    - 7-29 days: Glowing Gold (`#eab308`).
    - 30+ days: Premium Diamond/Cyan Glow (`#06b6d4`).
  - **Action Menu**: `⋮` dropdown menu for edit, skip reason, and delete actions.

### 2.4 Micro-Interactions & Celebrations
- Tapping today's check-in triggers:
  1. Instant local state update & UI re-render.
  2. Scale & glow animation on checkmark pill.
  3. Micro-confetti burst animation overlay when daily completion hits 100%.

---

## 3. Design Tokens & Theme Mapping

| Token Name | Light Theme | Dark Theme |
|---|---|---|
| `--habit-bg` | `#f8fafc` | `#0b0f17` |
| `--habit-card-bg` | `#ffffff` | `#1e293b` |
| `--habit-card-border` | `rgba(0, 0, 0, 0.06)` | `rgba(255, 255, 255, 0.08)` |
| `--habit-card-shadow` | `0 4px 6px -1px rgba(0,0,0,0.04), 0 2px 4px -2px rgba(0,0,0,0.03)` | `0 4px 6px -1px rgba(0,0,0,0.3)` |
| `--habit-accent-green` | `#84cc16` (Lime-600) | `#34d399` (Emerald-400) |
| `--habit-text-primary` | `#0f172a` | `#f8fafc` |
| `--habit-text-muted` | `#64748b` | `#94a3b8` |
| `--habit-streak-bg` | `rgba(245, 158, 11, 0.12)` | `rgba(251, 191, 36, 0.16)` |
| `--habit-streak-text` | `#d97706` | `#fbbf24` |

---

## 4. Architecture & Data Flow

- Core state remains managed by React in `HabitPage`, `HabitCard`, and `OfflineDB`.
- API endpoints used:
  - `GET /api/habits/today`
  - `GET /api/habits/monthly`
  - `POST /api/habits/{id}/checkin`
- Offline synchronization queue remains intact for offline-first support.

---

## 5. Verification Plan

1. **Visual Testing**: Verify render in Light Theme and Dark Theme on Desktop and Mobile viewport widths.
2. **Functionality Testing**:
   - Check-in today's habit updates streak and progress ring immediately.
   - 30-day heatmap correctly maps daily completion count.
   - Phase progress indicator updates accurately when habits are checked.
3. **Offline Mode**: Ensure check-in works offline via `OfflineDB` queue.
