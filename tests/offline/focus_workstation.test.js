"use strict";

// Fokus Hari Ini sebagai workstation:
//   - Timer Pomodoro dipegang satu hook (usePomodoro) → kartu penuh & bar ringkas sinkron.
//   - Bar ringkas (PomodoroMiniBar) menempel di bawah top bar (anchor sticky setinggi 0) dan
//     memuat waktu berjalan, Work/Short/Long, Mulai/Jeda, Stop, serta task aktif.
//   - Daftar task ringkas: detail (Subtask/Catatan/Lampiran) hanya dirender untuk task yang dibuka,
//     satu task terbuka sekaligus, sebagai tab.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const indexHtml = fs.readFileSync(path.resolve(__dirname, "../../static/index.html"), "utf8").replace(/\r\n/g, "\n");
const appCss = fs.readFileSync(path.resolve(__dirname, "../../static/app.css"), "utf8").replace(/\r\n/g, "\n");

function fnSource(name) {
  const start = indexHtml.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} must exist`);
  const end = indexHtml.indexOf("\n}\n", start);
  assert.ok(end > start, `${name} end must be found`);
  return indexHtml.slice(start, end);
}
function cssRule(selector) {
  const re = new RegExp(`(^|\\n)${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\{([^}]*)\\}`);
  const m = appCss.match(re);
  assert.ok(m, `CSS rule ${selector} must exist`);
  return m[2];
}

test("TodayFocusView: satu timer dibagi kartu penuh & bar ringkas", () => {
  const src = fnSource("TodayFocusView");
  assert.match(src, /const timer = usePomodoro\(/);
  assert.match(src, /React\.createElement\(PomodoroMiniBar, \{\s*timer: timer/);
  assert.match(src, /React\.createElement\(PomodoroTimer, \{\s*timer: timer/);
  assert.doesNotMatch(fnSource("PomodoroTimer"), /useState\(/, "kartu penuh tidak punya state timer sendiri");
});

test("Bar ringkas: sticky di bawah top bar, tampil setelah kartu penuh tergulir", () => {
  const src = fnSource("TodayFocusView");
  assert.match(src, /\.desktop-topbar, \.mobile-topbar/);
  assert.match(src, /setMiniVisible\(card\.getBoundingClientRect\(\)\.bottom < top \+ 12\)/);
  const anchor = cssRule(".focus-mini-anchor");
  assert.match(anchor, /position: sticky/);
  assert.match(anchor, /height: 0/);
  const mini = fnSource("PomodoroMiniBar");
  assert.match(mini, /t\.timeDisplay/);
  assert.match(mini, /PomoModeSwitch/);
  assert.match(mini, /PomoControls/);
  assert.match(mini, /focusTask \? focusTask\.title : "Belum ada task aktif"/);
  assert.match(cssRule(".focus-mini"), /visibility: hidden/);
  assert.match(cssRule(".focus-mini.is-visible"), /visibility: visible/);
});

test("Kontrol Pomodoro: Mulai/Jeda, Stop, Work/Short/Long", () => {
  const ctrl = fnSource("PomoControls");
  assert.match(ctrl, /"aria-label": "Mulai"/);
  assert.match(ctrl, /"aria-label": "Jeda"/);
  assert.match(ctrl, /"aria-label": "Stop"/);
  assert.match(indexHtml, /\{ key: "work", label: "Work" \},\s*\{ key: "shortBreak", label: "Short" \},\s*\{ key: "longBreak", label: "Long" \}/);
  const hook = fnSource("usePomodoro");
  assert.match(hook, /const stop = \(\) => \{\s*setIsRunning\(false\);\s*setTimeLeft\(POMO_DURATIONS\[mode\]\);/);
});

test("Daftar task: detail hanya untuk task yang dibuka, sebagai tab", () => {
  const view = fnSource("TodayFocusView");
  assert.match(view, /open: openId === task\.id/);
  assert.doesNotMatch(view, /React\.createElement\(FocusNotes/, "catatan tidak dirender langsung untuk semua task");
  const item = fnSource("FocusTaskItem");
  assert.match(item, /open && React\.createElement\("div", \{\s*id: panelId/);
  assert.match(item, /"aria-expanded": open/);
  assert.match(item, /role: "tablist"/);
  assert.match(item, /QUAD_LABELS\[task\.quadrant\]/, "kuadran Eisenhower terlihat");
  assert.match(item, /GTD_LABELS\[task\.gtd_status\]/, "status GTD terlihat");
  assert.match(item, /task\.project/, "project terlihat");
});

test("Tanpa garis warna di tepi kartu task Fokus", () => {
  const block = appCss.slice(appCss.indexOf("Fokus Hari Ini — workstation"));
  assert.ok(block.length > 100);
  assert.doesNotMatch(block, /border-(left|top|right):\s*[2-9]px/);
});

test("usePomodoro: start() ditolak tanpa focusTask dan memicu peringatan", () => {
  const hook = fnSource("usePomodoro");
  assert.match(hook, /if\s*\(!focusTask\)/, "usePomodoro harus memeriksa keberadaan focusTask");
  assert.match(hook, /window\.__showToast\?\.\(.*"warning"\)/, "harus menampilkan toast warning");
});

test("TodayFocusView: task yang sedang fokus diposisikan di urutan paling atas", () => {
  const view = fnSource("TodayFocusView");
  assert.match(view, /if\s*\(focusTask\)\s*\{[\s\S]*a\.id === focusTask\.id[\s\S]*return -1/, "focusTask harus berada di puncak sortedTasks");
});

test("TodayFocusView: membatalkan fokus atau menyelesaikan task menjeda Pomodoro", () => {
  const view = fnSource("TodayFocusView");
  assert.match(view, /timer\.pause\(\)/, "harus memanggil timer.pause()");
  assert.match(view, /Fokus dilepas/, "harus memberi toast saat fokus dilepas");
  assert.match(view, /Task selesai/, "harus memberi toast saat task selesai");
});

test("sw.js CACHE = taskflow-v366-focus-task-guard", () => {
  const swJs = fs.readFileSync(path.resolve(__dirname, "../../static/sw.js"), "utf8");
  assert.match(swJs, /^const CACHE = "taskflow-v366-focus-task-guard";/m);
});

test("App: mengelola timer Pomodoro dan focusTask di level App", () => {
  const appSrc = fnSource("App");
  assert.match(appSrc, /const timer = usePomodoro\(/, "App harus menginstansiasi usePomodoro");
  assert.match(appSrc, /pomoTimer|focusTask/, "App harus mengelola state Pomodoro");
  assert.match(appSrc, /TodayFocusView,[\s\S]*timer:/, "App harus mengoper timer ke TodayFocusView");
});

test("TopBarPomodoroChip: didefinisikan dan dirender di top bar saat page !== 'today'", () => {
  assert.ok(indexHtml.includes("function TopBarPomodoroChip("), "TopBarPomodoroChip harus didefinisikan");
  const appSrc = fnSource("App");
  assert.match(appSrc, /React\.createElement\(TopBarPomodoroChip/, "App harus merender TopBarPomodoroChip");
  const chipSrc = fnSource("TopBarPomodoroChip");
  assert.match(chipSrc, /topbar-pomo-chip/, "chip harus memiliki kelas CSS topbar-pomo-chip");
});

test("TopBarPomodoroChip: navigasi ke today saat diklik dan memiliki tombol play/pause", () => {
  const chipSrc = fnSource("TopBarPomodoroChip");
  assert.match(chipSrc, /timer\.isRunning \? timer\.pause : timer\.start/, "chip harus memiliki tombol play/pause");
  assert.match(chipSrc, /onNavigateToday/, "chip harus memanggil onNavigateToday");
});

test("usePomodoro: menyimpan snapshot ke localStorage (tf_pomo_state)", () => {
  const hook = fnSource("usePomodoro");
  assert.match(hook, /localStorage\.setItem\("tf_pomo_state"/, "usePomodoro harus menyimpan ke localStorage");
  assert.match(hook, /targetEndTime/, "usePomodoro harus menghitung targetEndTime");
});



