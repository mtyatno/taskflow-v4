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
  assert.match(hook, /if\s*\(!(?:activeTask|focusTask)\)/, "usePomodoro harus memeriksa keberadaan activeTask atau focusTask");
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

test("sw.js CACHE = taskflow-v390-dashboard-habit-title-fix", () => {
  const swJs = fs.readFileSync(path.resolve(__dirname, "../../static/sw.js"), "utf8");
  assert.match(swJs, /^const CACHE = "taskflow-v390-dashboard-habit-title-fix";/m);
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

test("mobile-topbar: mini pomodoro dirender di baris kedua (mobile-topbar-pomo-row)", () => {
  const appSrc = fnSource("App");
  assert.match(appSrc, /mobile-topbar-main/, "harus memiliki mobile-topbar-main untuk baris 1");
  assert.match(appSrc, /mobile-topbar-pomo-row/, "harus memiliki mobile-topbar-pomo-row untuk baris 2");
  assert.match(appSrc, /mobile-topbar-pomo-row[\s\S]*TopBarPomodoroChip/, "TopBarPomodoroChip harus berada di dalam mobile-topbar-pomo-row");
});

test("Dashboard: tombol fokus (.dash-focus-btn) didefinisikan di CSS dan dirender di TodayRow", () => {
  const btnRule = cssRule(".dash-focus-btn");
  assert.match(btnRule, /width:\s*22px/);
  assert.match(btnRule, /height:\s*22px/);
  assert.doesNotMatch(btnRule, /border-(left|top|right):\s*[2-9]px/);
  assert.doesNotMatch(appCss, /\.dash-focus-btn[^{]*\{[^}]*border-left/);

  const dashSrc = fnSource("Dashboard");
  assert.match(dashSrc, /TodayRow/);
  assert.match(dashSrc, /dash-focus-btn/);
  assert.match(dashSrc, /onStartFocus/);
  assert.match(dashSrc, /name:\s*"target"/);
  assert.match(dashSrc, /size:\s*13/);

  const appSrc = fnSource("App");
  assert.match(appSrc, /handleStartFocus/);
  assert.match(appSrc, /onStartFocus:\s*handleStartFocus/);
});

test("usePomodoro: start(explicitTask) menerima explicit task dan memulai timer meski focusTask di closure awalnya null", () => {
  const hookSrc = fnSource("usePomodoro");
  assert.match(hookSrc, /start\s*=\s*\(\s*explicitTask\s*=\s*null\s*\)\s*=>/);
  assert.match(hookSrc, /const activeTask = explicitTask \|\| focusTask;/);

  const states = [
    "work",
    1500,
    false,
    null,
    0,
    0
  ];
  let hookIdx = 0;
  const fakeUseState = (init) => {
    const idx = hookIdx++;
    const setVal = (updater) => {
      states[idx] = typeof updater === "function" ? updater(states[idx]) : updater;
    };
    return [states[idx], setVal];
  };

  const POMO_DURATIONS = { work: 1500, shortBreak: 300, longBreak: 900 };
  let toastCalls = [];
  const fakeWindow = {
    __showToast: (msg, type) => toastCalls.push({ msg, type })
  };
  const fakeLocalStorage = {
    getItem: () => null,
    setItem: () => {}
  };

  const fn = new Function(
    "useState", "useRef", "useEffect", "POMO_DURATIONS", "localStorage", "window",
    `return (${hookSrc}\n});`
  );

  const usePomodoroImpl = fn(
    fakeUseState,
    () => ({ current: null }),
    () => {},
    POMO_DURATIONS,
    fakeLocalStorage,
    fakeWindow
  );

  // 1. Tanpa explicitTask dan focusTask null: ditolak
  const timer = usePomodoroImpl({ focusTask: null, setTaskPomodoros: () => {} });
  const startWithoutTask = timer.start();
  assert.strictEqual(startWithoutTask, false, "timer.start() tanpa task harus mengembalikan false");
  assert.strictEqual(states[2], false, "isRunning harus tetap false");
  assert.strictEqual(toastCalls.length, 1);
  assert.strictEqual(toastCalls[0].type, "warning");

  // 2. Dengan explicitTask meski focusTask di closure adalah null: timer berhasil dimulai
  const explicitTask = { id: 42, title: "Tugas Fokus Spesifik" };
  const startWithExplicitTask = timer.start(explicitTask);
  assert.strictEqual(startWithExplicitTask, true, "timer.start(explicitTask) harus mengembalikan true");
  assert.strictEqual(states[2], true, "isRunning harus menjadi true");
  assert.ok(typeof states[3] === "number" && states[3] > Date.now(), "targetEndTime harus di-set ke masa depan");
});

test("App: handleDoneParentOnly dan handleDoneAll membersihkan focusTaskId saat task fokus diselesaikan", () => {
  const appSrc = fnSource("App");
  assert.match(appSrc, /handleDoneParentOnly\s*=\s*async\s*taskId\s*=>\s*\{[\s\S]*if\s*\(focusTaskId === taskId \|\| focusTask\?\.id === taskId\)\s*\{\s*setFocusTaskId\(null\);\s*if\s*\(timer\.isRunning\)\s*timer\.pause\(\);/);
  assert.match(appSrc, /handleDoneAll\s*=\s*async\s*\(\s*\{[\s\S]*taskId,[\s\S]*children[\s\S]*\}\s*\)\s*=>\s*\{[\s\S]*if\s*\(focusTaskId === taskId \|\| focusTask\?\.id === taskId/);
});
