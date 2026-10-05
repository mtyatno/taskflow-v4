"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const htmlPath = path.join(__dirname, "../../static/index.html");
const cssPath = path.join(__dirname, "../../static/app.css");

test("habit card mini heatmap 2-row layout and high-contrast styles", () => {
  const appCss = fs.readFileSync(cssPath, "utf8");

  // 1. .habit-mini-heatmap must have 2 rows x 15 columns grid
  assert.ok(
    appCss.includes("grid-template-rows: repeat(2, 10px)"),
    "app.css must define grid-template-rows: repeat(2, 10px) for .habit-mini-heatmap"
  );
  assert.ok(
    appCss.includes("grid-template-columns: repeat(15, 10px)"),
    "app.css must define grid-template-columns: repeat(15, 10px) for .habit-mini-heatmap"
  );

  // 2. High-contrast styling for .habit-mini-cell.is-empty (light & dark mode)
  assert.ok(
    appCss.includes(".habit-mini-cell.is-empty"),
    "app.css must define .habit-mini-cell.is-empty"
  );
  assert.ok(
    appCss.includes('[data-theme="dark"] .habit-mini-cell.is-empty'),
    "app.css must define dark mode styling for .habit-mini-cell.is-empty"
  );

  // 3. High-contrast styling for .habit-mini-cell.is-skipped and .level-4
  assert.ok(
    appCss.includes(".habit-mini-cell.is-skipped"),
    "app.css must define .habit-mini-cell.is-skipped"
  );
  assert.ok(
    appCss.includes(".habit-mini-cell.level-4"),
    "app.css must define .habit-mini-cell.level-4"
  );
  assert.ok(
    appCss.includes(".habit-mini-cell.is-today"),
    "app.css must define .habit-mini-cell.is-today"
  );
});

test("habit card direct cyclic checkin and removal of HabitCheckinModal in HabitPage", () => {
  const indexHtml = fs.readFileSync(htmlPath, "utf8");

  // 1. HabitCard component section checks
  const habitCardMatch = indexHtml.match(/function HabitCard\([\s\S]*?\nfunction/);
  assert.ok(habitCardMatch, "HabitCard component must exist in index.html");
  const habitCardCode = habitCardMatch[0];

  // HabitCard must cycle status directly without opening modal:
  // !h.today_status -> "done", "done" -> "skipped", else -> "uncheck"
  assert.ok(
    habitCardCode.includes('onCheckin(h.id, "done")') || habitCardCode.includes("onCheckin(h.id, 'done')"),
    "HabitCard must call onCheckin with 'done' when unchecked"
  );
  assert.ok(
    habitCardCode.includes('onCheckin(h.id, "skipped"') || habitCardCode.includes("onCheckin(h.id, 'skipped'"),
    "HabitCard must call onCheckin with 'skipped' when already done"
  );
  assert.ok(
    habitCardCode.includes('onCheckin(h.id, "uncheck"') || habitCardCode.includes("onCheckin(h.id, 'uncheck'"),
    "HabitCard must call onCheckin with 'uncheck' when already skipped"
  );

  // 2. HabitPage component checks
  const habitPageMatch = indexHtml.match(/function HabitPage\([\s\S]*?\nfunction/);
  assert.ok(habitPageMatch, "HabitPage component must exist in index.html");
  const habitPageCode = habitPageMatch[0];

  // Must not have checkinTarget state
  assert.ok(
    !habitPageCode.includes("checkinTarget"),
    "HabitPage must not contain checkinTarget state"
  );

  // Must not render HabitCheckinModal
  assert.ok(
    !habitPageCode.includes("HabitCheckinModal"),
    "HabitPage must not render HabitCheckinModal"
  );

  // habitCardProps must pass onCheckin: handleCheckin
  assert.ok(
    habitPageCode.includes("onCheckin: handleCheckin"),
    "HabitPage must pass onCheckin: handleCheckin in habitCardProps"
  );

  // handleCheckin must handle "uncheck" status and toast cancellation
  assert.ok(
    habitPageCode.includes("Check-in dibatalkan"),
    "handleCheckin must show toast 'Check-in dibatalkan' for uncheck status"
  );

  // 3. MiniHeatmap component checks
  const miniHeatmapMatch = indexHtml.match(/function MiniHeatmap\([\s\S]*?\nfunction/);
  assert.ok(miniHeatmapMatch, "MiniHeatmap component must exist in index.html");
  const miniHeatmapCode = miniHeatmapMatch[0];

  assert.ok(
    miniHeatmapCode.includes("is-empty"),
    "MiniHeatmap must assign .is-empty class"
  );
  assert.ok(
    miniHeatmapCode.includes("is-skipped"),
    "MiniHeatmap must assign .is-skipped class"
  );
  assert.ok(
    miniHeatmapCode.includes("is-today"),
    "MiniHeatmap must assign .is-today class"
  );
  assert.ok(
    miniHeatmapCode.includes("level-4"),
    "MiniHeatmap must assign .level-4 class"
  );
});

test("habit card responsive 2-row layout on mobile (<=640px)", () => {
  const indexHtml = fs.readFileSync(htmlPath, "utf8");
  const appCss = fs.readFileSync(cssPath, "utf8");

  // 1. HabitCard component structure in index.html
  const habitCardMatch = indexHtml.match(/function HabitCard\([\s\S]*?\nfunction/);
  assert.ok(habitCardMatch, "HabitCard component must exist in index.html");
  const habitCardCode = habitCardMatch[0];

  assert.ok(
    habitCardCode.includes('className: "habit-card-main"') || habitCardCode.includes("className: 'habit-card-main'"),
    "HabitCard must wrap title & info in .habit-card-main"
  );
  assert.ok(
    habitCardCode.includes('className: "habit-card-actions"') || habitCardCode.includes("className: 'habit-card-actions'"),
    "HabitCard must wrap mini heatmap and check-in button in .habit-card-actions"
  );
  assert.ok(
    habitCardCode.includes('className: "habit-card-meta"') || habitCardCode.includes("className: 'habit-card-meta'"),
    "HabitCard must wrap streak badge and menu in .habit-card-meta"
  );

  // 2. Base CSS classes defined in app.css
  assert.ok(
    appCss.includes(".habit-card-main"),
    "app.css must define .habit-card-main"
  );
  assert.ok(
    appCss.includes(".habit-card-actions"),
    "app.css must define .habit-card-actions"
  );
  assert.ok(
    appCss.includes(".habit-card-meta"),
    "app.css must define .habit-card-meta"
  );

  // 3. Mobile media query in app.css (<=640px)
  assert.ok(
    appCss.includes("@media (max-width: 640px)"),
    "app.css must include @media (max-width: 640px)"
  );
  assert.ok(
    /grid-template-areas:\s*["']info meta["']\s*["']actions actions["']/.test(appCss),
    "app.css must define 2-row grid-template-areas: 'info meta' 'actions actions' at <=640px"
  );
});

