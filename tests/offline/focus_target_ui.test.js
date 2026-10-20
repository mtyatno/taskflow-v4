"use strict";

// UI Target pomodoro: realisasi/estimasi di bar aktif, chip task, pemilih tomat, header.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const indexHtml = fs.readFileSync(path.resolve(__dirname, "../../static/index.html"), "utf8").replace(/\r\n/g, "\n");
const appCss = fs.readFileSync(path.resolve(__dirname, "../../static/app.css"), "utf8").replace(/\r\n/g, "\n");

function fnSource(name) {
  const start = indexHtml.indexOf(`\nfunction ${name}(`);
  assert.ok(start >= 0, `${name} must exist`);
  const end = indexHtml.indexOf("\n}\n", start + 1);
  assert.ok(end > start, `${name} end must be found`);
  return indexHtml.slice(start, end);
}

test("PomodoroTimer: bar task aktif realisasi / estimasi tanpa emoji", () => {
  const src = fnSource("PomodoroTimer");
  assert.ok(!src.includes("🍅"));
  assert.ok(src.includes('name: "pomoTomato"'));
  assert.ok(src.includes("pomodoros_done"));
  assert.ok(src.includes("clampEstimate("));
  assert.ok(src.includes("focus-pomo-task-done"));
  assert.ok(src.includes("is-over"));
  assert.ok(src.includes("Realisasi / estimasi pomodoro"));
});

test("FocusTaskItem: chip, pemilih estimasi, urutan DOM", () => {
  const src = fnSource("FocusTaskItem");
  const sig = src.slice(0, src.indexOf(") {"));
  assert.ok(sig.includes("onEstimate"));
  assert.ok(src.includes("ftask-count is-pomo"));
  assert.ok(src.includes('name: "pomoTomato"'));
  assert.ok(src.includes("Realisasi / estimasi pomodoro"));
  assert.ok(src.includes("ftask-estimate"));
  assert.ok(src.includes('role: "radiogroup"'));
  assert.ok(src.includes('"Estimasi pomodoro"'));
  assert.ok(src.includes("nextEstimate("));
  assert.ok(src.includes('"5+"'));
  assert.ok(src.includes("ftask-est-btn"));
  assert.ok(src.includes("is-filled"));
  const tabs = src.indexOf('className: "ftask-tabs"');
  const map = src.indexOf("FOCUS_TABS.map", tabs);
  const est = src.indexOf("ftask-estimate", map);
  const link = src.indexOf("ftask-detail-link", tabs);
  assert.ok(tabs >= 0 && map > tabs && est > map && link > est);
});

test("TodayFocusView: handleEstimate dan header ringkasan", () => {
  const src = fnSource("TodayFocusView");
  assert.ok(src.includes("headerSummary("));
  assert.ok(src.includes("estimated_pomodoros: n"));
  assert.ok(src.includes("Gagal menyimpan estimasi"));
  assert.ok(src.includes("onEstimate: handleEstimate"));
  assert.ok(!src.includes('" 🍅 hari ini"'));
  assert.ok(!src.includes("🍅"));
  assert.ok(src.includes("focus-page-summary"));
});

test("CSS: is-over dan pemilih tomat", () => {
  assert.match(appCss, /\.focus-pomo-task-done\.is-over\s*\{[^}]*#fb923c/);
  assert.match(appCss, /\.ftask-count\.is-pomo\.is-over\s*\{[^}]*var\(--p2\)/);
  assert.ok(appCss.includes(".ftask-estimate"));
  assert.match(appCss, /\.ftask-est-btn\s*\{[^}]*26px/);
  assert.ok(appCss.includes(".ftask-est-btn:focus-visible"));
});
