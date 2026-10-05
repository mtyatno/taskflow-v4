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
});
