"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const htmlPath = path.join(__dirname, "../../static/index.html");
const cssPath = path.join(__dirname, "../../static/app.css");

test("habit page hero section redesign", () => {
  const indexHtml = fs.readFileSync(htmlPath, "utf8");
  const appCss = fs.readFileSync(cssPath, "utf8");

  // 1. .habit-kpi-row must exist in HTML and CSS
  assert.ok(indexHtml.includes('className: "habit-kpi-row"'), "index.html must contain className: 'habit-kpi-row'");
  assert.ok(appCss.includes(".habit-kpi-row"), "app.css must contain .habit-kpi-row");

  // 2. Quote banner must be removed from HabitPage
  const habitPageMatch = indexHtml.match(/function HabitPage\([\s\S]*?\nfunction/);
  assert.ok(habitPageMatch, "HabitPage component section must exist");
  assert.ok(!habitPageMatch[0].includes('quoteHabit'), "HabitPage must not compute quoteHabit");
  assert.ok(!habitPageMatch[0].includes('\\u2728'), "HabitPage must not contain the quote sparkle banner");
  assert.ok(!habitPageMatch[0].includes('"Saya adalah orang yang peduli dengan kesehatan"'), "Identity quote must not be present in HabitPage");

  // 3. .dash-kpi must be used for habit KPI cards
  assert.ok(indexHtml.includes('className: "dash-kpi"'), "Must use dash-kpi for habit KPI cards");

  // 4. Calendar heatmap has header with 35 Hari and Rata-rata
  assert.ok(indexHtml.includes("Aktivitas 35 Hari"), "CalendarHeatmap must include 'Aktivitas 35 Hari' in header");
  assert.ok(indexHtml.includes("Rata-rata:"), "Heatmap card must contain 'Rata-rata:'");

  // 5. app.css styles .habit-kpi-row with 5 columns on desktop and responsive breakdown
  assert.ok(appCss.includes("grid-template-columns: repeat(4, minmax(0, 1fr)) minmax(210px, 1.25fr)") ||
            appCss.includes("grid-template-columns: repeat(4, minmax(0, 1fr)) minmax(220px, 1.25fr)"),
            "app.css must define 5-column grid for .habit-kpi-row");
  assert.ok(appCss.includes(".habit-kpi-row > :last-child"), "app.css must span :last-child across columns on mobile/tablet");

  // 6. Calendar heatmap cell styling and empty state
  assert.ok(
    /\.habit-heatmap-cell\s*\{[^}]*width:\s*20px[^}]*height:\s*20px/s.test(appCss),
    "app.css must define .habit-heatmap-cell with width: 20px and height: 20px"
  );
  assert.ok(
    appCss.includes(".habit-heatmap-cell.is-empty"),
    "app.css must define .habit-heatmap-cell.is-empty"
  );
  assert.ok(
    appCss.includes('[data-theme="dark"] .habit-heatmap-cell.is-empty'),
    "app.css must define [data-theme=\"dark\"] .habit-heatmap-cell.is-empty"
  );
  assert.ok(
    appCss.includes(".habit-heatmap-cell.level-4"),
    "app.css must define .habit-heatmap-cell.level-4"
  );

  // 7. CalendarHeatmap component in index.html applies is-placeholder and is-empty
  assert.ok(
    indexHtml.includes('className: "habit-heatmap-cell is-placeholder"'),
    "CalendarHeatmap must render placeholder cells with className 'habit-heatmap-cell is-placeholder'"
  );
  assert.ok(
    indexHtml.includes("is-empty") && indexHtml.includes("level-${cell.level}"),
    "CalendarHeatmap must apply is-empty class when cell.level <= 0"
  );
});

