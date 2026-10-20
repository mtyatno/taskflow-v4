"use strict";

// Timer Pomodoro mencatat sesi Work selesai ke log (route lokal) + tanggal lokal; tanpa taskPomodoros.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const indexHtml = fs.readFileSync(path.resolve(__dirname, "../../static/index.html"), "utf8").replace(/\r\n/g, "\n");

function fnSource(name) {
  const start = indexHtml.indexOf(`\nfunction ${name}(`);
  assert.ok(start >= 0, `${name} must exist`);
  const end = indexHtml.indexOf("\n}\n", start + 1);
  assert.ok(end > start, `${name} end must be found`);
  return indexHtml.slice(start, end);
}

test("usePomodoro: tanggal lokal, bukan UTC", () => {
  const src = fnSource("usePomodoro");
  assert.ok(!src.includes("toISOString().slice(0, 10)"));
  assert.ok(src.includes("todayLocalISO()"));
});

test("usePomodoro: mencatat sesi Work ke route pomodoros", () => {
  const src = fnSource("usePomodoro");
  for (const needle of [
    "workStartedAt",
    "sessionTaskId",
    "sessionClientId(",
    '"/pomodoros"',
    'kind: "session"',
    "focus_seconds: 1500",
    "__refreshTasks",
    "console.warn",
  ]) {
    assert.ok(src.includes(needle), `harus memuat ${needle}`);
  }
  assert.ok(!src.includes("setTaskPomodoros"));
  assert.match(src, /function usePomodoro\(\{\s*focusTask\s*\}\)/);
});

test("taskPomodoros dihapus dari seluruh index.html", () => {
  assert.ok(!indexHtml.includes("taskPomodoros"));
  assert.ok(!indexHtml.includes("setTaskPomodoros"));
});

test("App: pemulihan focusTaskId memakai tanggal lokal", () => {
  const i = indexHtml.indexOf('parsed?.focusTaskId && parsed?.date ===');
  assert.ok(i >= 0);
  assert.ok(indexHtml.slice(i, i + 120).includes("todayLocalISO()"));
});

test("TodayFocusView: todayStr lokal", () => {
  const src = fnSource("TodayFocusView");
  assert.ok(!src.includes("toISOString().slice(0, 10)"));
  assert.ok(src.includes("todayLocalISO()"));
});

// Harness: jalankan hook dengan useState/useEffect palsu, picu handleTimerComplete lewat efek timer.
function runWorkComplete({ focusTask, tf, saved = {} }) {
  const hookSrc = fnSource("usePomodoro");
  const states = ["work", 0, true, null, 0, 0, saved.workStartedAt ?? null, saved.sessionTaskId ?? null];
  let idx = 0;
  const fakeUseState = (init) => {
    const i = idx++;
    const set = (v) => { states[i] = typeof v === "function" ? v(states[i]) : v; };
    return [states[i], set];
  };
  const effects = [];
  const posts = [];
  const calls = { sound: 0, notif: 0, warn: 0 };
  const api = { post: (url, body) => { posts.push({ url, body }); return Promise.resolve({}); } };
  const fakeWindow = { TF: tf, __refreshTasks: () => {} };
  const fn = new Function(
    "useState", "useRef", "useEffect", "POMO_DURATIONS", "localStorage", "window", "api",
    "playNotificationSound", "sendBrowserNotification", "console",
    `return (${hookSrc}\n});`
  );
  const impl = fn(
    fakeUseState, () => ({ current: null }), (f) => effects.push(f),
    { work: 1500, shortBreak: 300, longBreak: 900 },
    { getItem: (k) => (k === "tf_user_id" ? "7" : null), setItem: () => {} },
    fakeWindow, api,
    () => { calls.sound++; }, () => { calls.notif++; },
    { warn: () => { calls.warn++; } }
  );
  impl({ focusTask });
  effects[effects.length - 1](); // efek timer: isRunning && timeLeft === 0 -> handleTimerComplete
  return { states, posts, calls };
}

const goodTf = {
  pomologic: { sessionClientId: (u, ms) => `pomo-${u}-${ms}-s` },
  tasklogic: { todayLocalISO: () => "2026-10-20" },
};

test("handleTimerComplete: payload log sesi (focusTask)", () => {
  const { posts, states, calls } = runWorkComplete({ focusTask: { id: 5 }, tf: goodTf, saved: { workStartedAt: 123456 } });
  assert.equal(posts.length, 1);
  assert.equal(posts[0].url, "/api/tasks/5/pomodoros");
  const b = posts[0].body;
  assert.equal(b.client_id, "pomo-7-123456-s");
  assert.equal(b.kind, "session");
  assert.equal(b.pomodoros, 1);
  assert.equal(b.focus_seconds, 1500);
  assert.equal(b.log_date, "2026-10-20");
  assert.ok(!Number.isNaN(Date.parse(b.ended_at)));
  assert.equal(states[0], "shortBreak");
  assert.equal(states[6], null, "workStartedAt direset");
  assert.equal(calls.sound, 1);
});

test("handleTimerComplete: fallback sessionTaskId saat focusTask null", () => {
  const { posts } = runWorkComplete({ focusTask: null, tf: goodTf, saved: { workStartedAt: 99, sessionTaskId: 42 } });
  assert.equal(posts.length, 1);
  assert.equal(posts[0].url, "/api/tasks/42/pomodoros");
  assert.equal(posts[0].body.client_id, "pomo-7-99-s");
});

test("handleTimerComplete: tanpa task tidak mencatat tapi tetap pindah mode", () => {
  const { posts, states } = runWorkComplete({ focusTask: null, tf: goodTf });
  assert.equal(posts.length, 0);
  assert.equal(states[0], "shortBreak");
});

test("handleTimerComplete: kegagalan pencatatan tidak memblokir timer", () => {
  for (const tf of [{ tasklogic: goodTf.tasklogic }, { pomologic: { sessionClientId: () => { throw new Error("boom"); } }, tasklogic: goodTf.tasklogic }]) {
    const { states, calls, posts } = runWorkComplete({ focusTask: { id: 5 }, tf });
    assert.equal(posts.length, 0);
    assert.equal(states[0], "shortBreak", "mode tetap pindah ke break");
    assert.equal(states[2], false);
    assert.equal(calls.sound, 1);
    assert.equal(calls.notif, 1);
    assert.equal(calls.warn, 1);
  }
});
