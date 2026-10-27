"use strict";

// UI Overtime: kontrol per fase, kelas ungu, chip top bar, header & tip.

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

test("PomoControls: varian awaiting dan overtime", () => {
  const src = fnSource("PomoControls");
  assert.ok(src.includes('timer.phase === "awaiting"'));
  assert.ok(src.includes('timer.phase === "overtime"'));
  assert.ok(src.includes("timer.takeBreak"));
  assert.ok(src.includes("timer.continueOvertime"));
  assert.ok(src.includes("Ambil Istirahat"));
  assert.ok(src.includes("Lanjut Fokus"));
  assert.ok(src.includes("Overtime"));
  assert.ok(src.includes("pomo-btn-break"));
  assert.ok(src.includes("pomo-btn-overtime"));
});

test("PomodoroTimer: kelas fase, statistik, realisasi, sub judul", () => {
  const src = fnSource("PomodoroTimer");
  assert.ok(src.includes(" is-overtime"));
  assert.ok(src.includes(" is-awaiting"));
  assert.ok(src.includes("pomodorosToday"));
  assert.ok(src.includes("overtimePomodoros"));
  assert.ok(src.includes("Lanjut fokus atau istirahat?"));
  assert.ok(src.includes("Overtime — tetap di flow"));
  assert.ok(src.includes("Math.floor(t.pomodorosToday / 4)"));
});

test("PomodoroMiniBar: kelas fase", () => {
  const src = fnSource("PomodoroMiniBar");
  assert.ok(src.includes(" is-overtime"));
  assert.ok(src.includes(" is-awaiting"));
  assert.ok(src.includes("t.labelText"));
  // Kicker awaiting: "Selesai" saja, tanpa akhiran " · dijeda".
  assert.ok(src.includes('t.isRunning || t.phase === "awaiting" ? "" : " · dijeda"'));
});

test("TopBarPomodoroChip: awaiting tanpa tombol, tooltip persis", () => {
  const src = fnSource("TopBarPomodoroChip");
  assert.ok(src.includes(" is-overtime"));
  assert.ok(src.includes(" is-awaiting"));
  assert.ok(src.includes("Pomodoro selesai — klik untuk memilih istirahat atau lanjut"));
  assert.ok(src.includes("topbar-pomo-btn"));
});

test("TodayFocusView: header, tip, fallback timer", () => {
  const src = fnSource("TodayFocusView");
  assert.ok(src.includes("done: timer.pomodorosToday"));
  assert.ok(src.includes("💡 25 menit fokus, lalu pilih istirahat atau lanjut overtime. Setelah 4 pomodoro, istirahat panjang 15 menit."));
  assert.ok(src.includes('phase: "countdown"'));
  for (const k of ["pomodorosToday: 0", "overtimeSeconds: 0", "overtimePomodoros: 0", "continueOvertime()", "takeBreak()"]) {
    assert.ok(src.includes(k), k);
  }
});

test("CSS: ungu overtime, tombol, chip berdenyut + reduced-motion", () => {
  assert.ok(appCss.includes("#8b5cf6"));
  assert.ok(appCss.includes("#c4b5fd"));
  // Ring/tombol = ungu bermakna #8b5cf6; teks waktu = versi teks per mode (terang #6d28d9, gelap #c4b5fd; latar hero §6).
  assert.match(appCss, /\.focus-pomo\.is-overtime, \.focus-mini\.is-overtime \{ --pomo-ink: #8b5cf6; --pomo-ink-text: var\(--pomo-text-purple\); \}/);
  assert.match(appCss, /:root \{[^}]*--pomo-text-purple: #6d28d9;/);
  assert.match(appCss, /\[data-theme="dark"\] \{[^}]*--pomo-text-purple: #c4b5fd;/);
  assert.ok(appCss.includes(".focus-pomo.is-overtime"));
  assert.ok(appCss.includes(".pomo-btn-overtime"));
  assert.ok(appCss.includes(".pomo-btn-break"));
  assert.ok(appCss.includes(".topbar-pomo-chip.is-overtime"));
  assert.ok(appCss.includes(".topbar-pomo-chip.is-awaiting"));
  assert.ok(appCss.includes("@keyframes pomoChipPulse"));
  assert.match(appCss, /prefers-reduced-motion: reduce\)\s*\{[^}]*topbar-pomo-chip\.is-awaiting[^}]*animation: none/);
  // 375 px: judul task bar ringkas punya lebar minimum agar kontrol Overtime pindah baris.
  assert.match(appCss, /\.focus-mini-task \{ flex: 1 1 0; min-width: 96px; \}/);
});
