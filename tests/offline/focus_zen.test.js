"use strict";

// Mode Zen: sembunyikan task lain saat Work berjalan di halaman Fokus Hari Ini.

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

test("PomodoroTimer: tombol Zen sebelum PomoModeSwitch", () => {
  const src = fnSource("PomodoroTimer");
  const sig = src.slice(0, src.indexOf(") {"));
  assert.ok(sig.includes("zenEnabled"));
  assert.ok(sig.includes("onToggleZen"));
  const btn = src.indexOf("focus-zen-btn");
  const sw = src.indexOf("React.createElement(PomoModeSwitch");
  assert.ok(btn >= 0 && sw >= 0 && btn < sw);
  assert.ok(src.includes("focus-pomo-head-tools"));
  assert.ok(src.includes('"aria-pressed": zenEnabled'));
  assert.ok(src.includes('name: "fEye"'));
  assert.ok(src.includes("Mode Zen: sembunyikan task lain saat Work berjalan"));
});

test("TodayFocusView: state, catatan, dan task aktif dipaksa terbuka", () => {
  const src = fnSource("TodayFocusView");
  assert.ok(src.includes("readZenPref("));
  assert.ok(src.includes("writeZenPref("));
  assert.ok(src.includes("zenActive({"));
  assert.ok(src.includes("focus-zen-note"));
  assert.ok(src.includes("task lain disembunyikan sampai istirahat"));
  assert.ok(src.includes("zenOn && focusTask?.id === task.id"));
  assert.ok(src.includes("zenEnabled: zenEnabled"));
  assert.ok(src.includes("onToggleZen: toggleZen"));
  assert.ok(src.includes("is-zen-hidden"));
  assert.ok(src.includes("is-zen-shown"));
  // root class
  assert.ok(src.includes('focus-page fade-in${zenOn ? " is-zen" : ""}'));
  // akses localStorage dijaga try/catch
  assert.ok(/try \{\s*return window\.localStorage;\s*\} catch/.test(src));
  assert.ok(!src.includes("readZenPref(window.localStorage"));
  assert.ok(!src.includes("writeZenPref(window.localStorage"));
  // reveal tetap fade-in saat Zen dimatikan ketika aktif
  assert.ok(src.includes("zenWasActive"));
  assert.ok(src.includes("zenShown: zenReveal && task.id !== focusTask?.id"), "task aktif tidak memutar ulang fade-in");
  // efek samping tidak di dalam updater setState
  assert.ok(!/setZenEnabled\(prev =>/.test(src));
});

test("FocusTaskItem: zenHidden menambah kelas dan aria-hidden", () => {
  const src = fnSource("FocusTaskItem");
  const sig = src.slice(0, src.indexOf(") {"));
  assert.ok(sig.includes("zenHidden"));
  assert.ok(src.includes("is-zen-hidden"));
  assert.ok(src.includes('"aria-hidden"'));
});

test("app.css: animasi Zen dan reduced-motion", () => {
  assert.ok(appCss.includes("@keyframes zen-fade-out"));
  assert.ok(appCss.includes(".is-zen-hidden"));
  assert.ok(appCss.includes(".is-zen-shown"));
  assert.ok(appCss.includes(".focus-zen-btn"));
  const m = appCss.match(/@media \(prefers-reduced-motion: reduce\) \{\s*\.is-zen-hidden[^}]*display: none/);
  assert.ok(m, "reduced-motion rule for .is-zen-hidden with display: none");
});

test("Zen: note hanya bila ada task tersembunyi; item tersembunyi tidak memakai ruang", () => {
  const src = fnSource("TodayFocusView");
  assert.ok(src.includes("zenOn && zenHiddenCount > 0 && React.createElement"));
  assert.ok(appCss.includes("@keyframes zen-collapse"));
  assert.ok(/\.focus-page\.is-zen \.ftask-list \{ gap: 0; \}/.test(appCss));
  const out = appCss.match(/@keyframes zen-fade-out \{[^}]*\}[^}]*\}/)[0];
  assert.ok(!/height/.test(out), "fade-out hanya opacity (tanpa lompatan height)");
});
