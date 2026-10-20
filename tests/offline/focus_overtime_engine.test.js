"use strict";

// PR C Overtime: mesin fase usePomodoro (countdown → awaiting → overtime), dijalankan dengan React palsu
// (useState/useEffect/useRef + render ulang sinkron ala ReactDOM.render legacy), jam palsu, dan timer palsu.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const pl = require("../../static/offline/pomologic.js");

const indexHtml = fs.readFileSync(path.resolve(__dirname, "../../static/index.html"), "utf8").replace(/\r\n/g, "\n");

function fnSource(name) {
  const start = indexHtml.indexOf(`\nfunction ${name}(`);
  assert.ok(start >= 0, `${name} must exist`);
  const end = indexHtml.indexOf("\n}\n", start + 1);
  assert.ok(end > start, `${name} end must be found`);
  return indexHtml.slice(start, end);
}

const T0 = new Date(2026, 9, 20, 9, 0, 0).getTime(); // 2026-10-20 09:00 waktu lokal
const TODAY = "2026-10-20";
const YESTERDAY = "2026-10-19";
const MIN = 60 * 1000;
const HOUR = 60 * MIN;

function makeEnv({ saved = null, focusTask = { id: 5 }, now = T0 } = {}) {
  const clock = { now };
  class FakeDate extends Date {
    constructor(...a) {
      if (a.length === 0) super(clock.now);
      else super(...a);
    }
    static now() { return clock.now; }
  }

  // Timer palsu: interval terpicu paling banyak sekali per langkah (seperti tab latar belakang yang di-throttle).
  let nextId = 1;
  const intervals = new Map();
  const fakeSetInterval = (fn, ms) => {
    const id = nextId++;
    intervals.set(id, { fn, ms, at: clock.now + ms });
    return id;
  };
  const fakeClearInterval = (id) => { intervals.delete(id); };

  const store = { tf_user_id: "7" };
  if (saved) store.tf_pomo_state = JSON.stringify(saved);
  const localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
  };

  const posts = [];
  const sounds = [];
  const notifs = [];
  const warns = [];
  const toasts = [];
  const api = { post: (url, body) => { posts.push({ url, body }); return Promise.resolve({}); } };
  const fakeWindow = {
    TF: { pomologic: pl, tasklogic: { todayLocalISO: () => pl.localDateISO(clock.now) } },
    __refreshTasks: () => {},
    __showToast: (msg, type) => toasts.push({ msg, type }),
  };

  // React palsu
  const hooks = [];
  let hi = 0;
  let rendering = false;
  let batch = 0;
  let dirty = false;
  let pendingEffects = [];
  let props = { focusTask };
  let result = null;
  let renders = 0;

  function schedule() {
    if (rendering || batch > 0) { dirty = true; return; }
    render();
  }
  function useState(init) {
    const i = hi++;
    if (!(i in hooks)) hooks[i] = { v: typeof init === "function" ? init() : init };
    const h = hooks[i];
    return [h.v, (u) => {
      const nv = typeof u === "function" ? u(h.v) : u;
      if (Object.is(nv, h.v)) return;
      h.v = nv;
      schedule();
    }];
  }
  function useRef(init) {
    const i = hi++;
    if (!(i in hooks)) hooks[i] = { current: init };
    return hooks[i];
  }
  function useEffect(fn, deps) {
    const i = hi++;
    const prev = hooks[i];
    const changed = !prev || !deps || !prev.deps || deps.length !== prev.deps.length ||
      deps.some((d, k) => !Object.is(d, prev.deps[k]));
    if (!prev) hooks[i] = { deps: null, cleanup: null };
    if (changed) pendingEffects.push({ h: hooks[i], fn, deps });
  }
  function render() {
    do {
      if (++renders > 100000) throw new Error("render loop");
      dirty = false;
      rendering = true;
      hi = 0;
      pendingEffects = [];
      try { result = impl(props); } finally { rendering = false; }
      const effs = pendingEffects;
      batch++;
      try {
        for (const e of effs) {
          if (e.h.cleanup) e.h.cleanup();
          e.h.deps = e.deps;
          const c = e.fn();
          e.h.cleanup = typeof c === "function" ? c : null;
        }
      } finally { batch--; }
    } while (dirty);
  }

  const fn = new Function(
    "useState", "useRef", "useEffect", "POMO_DURATIONS", "localStorage", "window", "api",
    "playNotificationSound", "sendBrowserNotification", "console", "Date", "setInterval", "clearInterval",
    `return (${fnSource("usePomodoro")}\n});`
  );
  const impl = fn(
    useState, useRef, useEffect,
    { work: 1500, shortBreak: 300, longBreak: 900 },
    localStorage, fakeWindow, api,
    (k) => sounds.push(k),
    (title, body) => notifs.push({ title, body }),
    { warn: (...a) => warns.push(a), log: () => {}, error: () => {} },
    FakeDate, fakeSetInterval, fakeClearInterval
  );
  render();

  return {
    get t() { return result; },
    clock, posts, sounds, notifs, warns, toasts, store,
    saved: () => JSON.parse(store.tf_pomo_state),
    // aksi = event handler: setState dibatch, lalu satu render
    act(f) {
      batch++;
      let r;
      try { r = f(result); } finally { batch--; }
      if (dirty) render();
      return r;
    },
    setProps(p) { props = { ...props, ...p }; render(); },
    advance(ms, step = 1000) {
      const target = clock.now + ms;
      while (clock.now < target) {
        clock.now = Math.min(target, clock.now + step);
        for (const [id, iv] of [...intervals]) {
          if (!intervals.has(id) || iv.at > clock.now) continue;
          iv.at = clock.now + iv.ms;
          iv.fn();
        }
      }
    },
  };
}

function toAwaiting(opts) {
  const env = makeEnv(opts);
  assert.equal(env.act((t) => t.start()), true);
  env.advance(1500 * 1000);
  assert.equal(env.t.phase, "awaiting");
  return env;
}

function todayState(extra) {
  return { mode: "work", timeLeft: 1500, isRunning: false, targetEndTime: null, focusTaskId: 5,
    sessionCount: 0, totalFocusTime: 0, workStartedAt: null, sessionTaskId: null, date: TODAY, ...extra };
}

test("localDateISO: tanggal lokal dari ms", () => {
  assert.equal(pl.localDateISO(T0), TODAY);
  assert.equal(pl.localDateISO(new Date(2026, 0, 5, 23, 59).getTime()), "2026-01-05");
});

test("00:00 → satu log session, satu chime, notifikasi baru, awaiting di Work (pemicu ganda tidak menambah)", () => {
  const env = toAwaiting();
  const t = env.t;
  assert.equal(env.posts.length, 1);
  assert.equal(env.posts[0].url, "/api/tasks/5/pomodoros");
  assert.equal(env.posts[0].body.kind, "session");
  assert.equal(env.posts[0].body.client_id, `pomo-7-${T0}-s`);
  assert.deepEqual(env.sounds, ["work"]);
  assert.deepEqual(env.notifs, [{ title: "🍅 Pomodoro Selesai!", body: "Pomodoro selesai — lanjut fokus atau istirahat?" }]);
  assert.equal(t.phase, "awaiting");
  assert.equal(t.isAwaiting, true);
  assert.equal(t.isOvertime, false);
  assert.equal(t.mode, "work");
  assert.equal(t.isRunning, false);
  assert.equal(t.timeDisplay, "00:00");
  assert.equal(t.labelText, "Selesai");
  assert.equal(t.canStop, true);
  assert.equal(t.sessionCount, 1);
  assert.equal(t.pomodorosToday, 1);
  assert.equal(t.overtimePomodoros, 0);
  assert.equal(t.totalFocusTime, 1500);
  const s = env.saved();
  assert.equal(s.phase, "awaiting");
  assert.equal(s.workStartedAt, T0, "workStartedAt disimpan untuk client_id Overtime");
  assert.equal(s.countBeforeSession, 0);
  // waktu terus berjalan di awaiting: tidak ada pemicu tambahan
  env.advance(30 * 1000);
  assert.equal(env.posts.length, 1);
  assert.equal(env.sounds.length, 1);
  assert.equal(env.t.sessionCount, 1);
  assert.equal(env.t.timeDisplay, "00:00");
});

test("Lanjut Fokus → hitung maju, 🍅 kelipatan; Stop di 2220 dtk → log overtime, Work 25:00 diam", () => {
  const env = toAwaiting();
  env.act((t) => t.continueOvertime());
  assert.equal(env.t.phase, "overtime");
  assert.equal(env.t.isOvertime, true);
  assert.equal(env.t.mode, "work", "Zen: mode tetap work");
  assert.equal(env.t.isRunning, true, "Zen: isRunning true selama Overtime");
  assert.equal(env.t.timeDisplay, "+00:00");
  const s = env.saved();
  assert.equal(s.phase, "overtime");
  assert.equal(s.otAccumSec, 0);
  assert.equal(s.otRunStartedAt, env.clock.now);
  env.advance(1500 * 1000);
  assert.equal(env.t.timeDisplay, "+25:00");
  assert.equal(env.t.overtimeSeconds, 1500);
  assert.equal(env.t.overtimePomodoros, 1);
  assert.equal(env.t.pomodorosToday, env.t.sessionCount + 1);
  assert.equal(env.t.labelText, "Overtime");
  assert.equal(env.t.progress, 0);
  assert.equal(env.t.canStop, true);
  env.advance(720 * 1000);
  assert.equal(env.t.overtimeSeconds, 2220);
  assert.equal(env.t.progress, 720 / 1500);
  const focusBefore = env.t.totalFocusTime;
  env.act((t) => t.stop());
  assert.equal(env.posts.length, 2);
  const p = env.posts[1];
  assert.equal(p.url, "/api/tasks/5/pomodoros");
  assert.equal(p.body.kind, "overtime");
  assert.equal(p.body.pomodoros, 1);
  assert.equal(p.body.focus_seconds, 2220);
  assert.equal(p.body.client_id, `pomo-7-${T0}-o`);
  assert.equal(p.body.log_date, TODAY);
  assert.equal(env.t.totalFocusTime, focusBefore + 2220);
  assert.equal(env.t.sessionCount, 2);
  assert.equal(env.t.mode, "work");
  assert.equal(env.t.phase, "countdown");
  assert.equal(env.t.isRunning, false);
  assert.equal(env.t.timeDisplay, "25:00");
  assert.equal(env.t.overtimePomodoros, 0);
  assert.equal(env.t.pomodorosToday, 2);
  // pemanggilan ganda Stop tidak mencatat lagi
  env.act((t) => t.stop());
  assert.equal(env.posts.length, 2);
  assert.equal(env.t.sessionCount, 2);
});

test("Overtime 720 dtk → Ambil Istirahat: log 0 🍅, sessionCount hanya +1, Short berjalan", () => {
  const env = toAwaiting();
  env.act((t) => t.continueOvertime());
  env.advance(720 * 1000);
  env.act((t) => t.takeBreak());
  assert.equal(env.posts.length, 2);
  assert.equal(env.posts[1].body.kind, "overtime");
  assert.equal(env.posts[1].body.pomodoros, 0);
  assert.equal(env.posts[1].body.focus_seconds, 720);
  assert.equal(env.t.sessionCount, 1);
  assert.equal(env.t.mode, "shortBreak");
  assert.equal(env.t.isRunning, true);
  assert.equal(env.t.phase, "countdown");
  env.advance(10 * 1000);
  assert.equal(env.t.timeLeft, 290);
  assert.equal(env.saved().workStartedAt, null);
});

test("Overtime < 60 dtk → Stop tanpa log overtime (Waktu fokus tetap bertambah)", () => {
  const env = toAwaiting();
  env.act((t) => t.continueOvertime());
  env.advance(59 * 1000);
  const before = env.t.totalFocusTime;
  env.act((t) => t.stop());
  assert.equal(env.posts.length, 1);
  assert.equal(env.t.totalFocusTime, before + 59);
  assert.equal(env.t.mode, "work");
  assert.equal(env.t.phase, "countdown");
});

test("Jeda di +05:00, 10 menit, Lanjutkan (tanpa task fokus), 1 menit → 360 dtk", () => {
  const env = toAwaiting();
  env.act((t) => t.continueOvertime());
  env.advance(300 * 1000);
  env.act((t) => t.pause());
  assert.equal(env.t.isRunning, false);
  assert.equal(env.t.overtimeSeconds, 300);
  assert.equal(env.saved().otAccumSec, 300);
  assert.equal(env.saved().otRunStartedAt, null);
  env.advance(10 * MIN);
  env.setProps({ focusTask: null });
  assert.equal(env.t.overtimeSeconds, 300);
  assert.equal(env.act((t) => t.start()), true);
  assert.equal(env.toasts.length, 0, "melanjutkan Overtime tidak butuh task");
  assert.equal(env.t.isRunning, true);
  assert.equal(env.t.phase, "overtime");
  env.advance(60 * 1000);
  assert.equal(env.t.overtimeSeconds, 360);
  assert.equal(env.t.timeDisplay, "+06:00");
});

test("Batas 2 jam: majukan 3 jam → satu log 4 🍅/7200, chime + notifikasi batas, istirahat diam", () => {
  const env = toAwaiting();
  env.act((t) => t.continueOvertime());
  const before = env.t.totalFocusTime;
  env.advance(3 * HOUR);
  assert.equal(env.posts.length, 2);
  assert.equal(env.posts[1].body.kind, "overtime");
  assert.equal(env.posts[1].body.pomodoros, 4);
  assert.equal(env.posts[1].body.focus_seconds, 7200);
  assert.deepEqual(env.sounds, ["work", "work"]);
  assert.deepEqual(env.notifs[1], { title: "⏱️ Overtime selesai", body: "Overtime dihentikan otomatis setelah 2 jam" });
  assert.equal(env.notifs.length, 2);
  assert.equal(env.t.phase, "countdown");
  assert.equal(env.t.mode, "longBreak", "0 → 1 + 4 melewati kelipatan 4");
  assert.equal(env.t.isRunning, false);
  assert.equal(env.t.timeLeft, 900);
  assert.equal(env.t.sessionCount, 5);
  assert.equal(env.t.totalFocusTime, before + 7200);
});

test("Istirahat panjang mengikuti countBeforeSession + 🍅 Overtime", () => {
  let env = toAwaiting({ saved: todayState({ sessionCount: 3 }) });
  env.act((t) => t.takeBreak());
  assert.equal(env.t.mode, "longBreak");
  assert.equal(env.t.isRunning, true);

  env = toAwaiting({ saved: todayState({ sessionCount: 2 }) });
  env.act((t) => t.continueOvertime());
  env.advance(1500 * 1000);
  env.act((t) => t.takeBreak());
  assert.equal(env.t.sessionCount, 4);
  assert.equal(env.t.mode, "longBreak");
  assert.equal(env.t.isRunning, true);

  env = toAwaiting({ saved: todayState({ sessionCount: 1 }) });
  env.act((t) => t.takeBreak());
  assert.equal(env.t.mode, "shortBreak");
  assert.equal(env.t.isRunning, true);
  assert.equal(env.t.timeLeft, 300);
});

test("Awaiting → Stop → Work 25:00 diam tanpa log baru; sesi berikutnya bisa dimulai", () => {
  const env = toAwaiting();
  env.act((t) => t.stop());
  assert.equal(env.posts.length, 1);
  assert.equal(env.t.mode, "work");
  assert.equal(env.t.phase, "countdown");
  assert.equal(env.t.isRunning, false);
  assert.equal(env.t.timeDisplay, "25:00");
  assert.equal(env.saved().workStartedAt, null);
  assert.equal(env.t.canStop, false);
  env.advance(MIN);
  assert.equal(env.act((t) => t.start()), true);
  env.advance(1500 * 1000);
  assert.equal(env.posts.length, 2);
  assert.equal(env.posts[1].body.kind, "session");
  assert.equal(env.t.phase, "awaiting");
  assert.equal(env.t.sessionCount, 2);
});

test("Overtime lalu klik tab Short / Lewati → Overtime tercatat dulu, mode tidak berjalan", () => {
  let env = toAwaiting();
  env.act((t) => t.continueOvertime());
  env.advance(600 * 1000);
  env.act((t) => t.switchMode("shortBreak"));
  assert.equal(env.posts.length, 2);
  assert.equal(env.posts[1].body.kind, "overtime");
  assert.equal(env.posts[1].body.focus_seconds, 600);
  assert.equal(env.t.mode, "shortBreak");
  assert.equal(env.t.isRunning, false);
  assert.equal(env.t.phase, "countdown");
  assert.equal(env.t.timeLeft, 300);

  env = toAwaiting();
  env.act((t) => t.continueOvertime());
  env.advance(600 * 1000);
  env.act((t) => t.skip());
  assert.equal(env.posts.length, 2);
  assert.equal(env.posts[1].body.kind, "overtime");
  assert.equal(env.t.mode, "shortBreak");
  assert.equal(env.t.isRunning, false);
  assert.equal(env.t.phase, "countdown");

  // awaiting → tab Work: tanpa log, kembali countdown
  env = toAwaiting();
  env.act((t) => t.switchMode("work"));
  assert.equal(env.posts.length, 1);
  assert.equal(env.t.phase, "countdown");
  assert.equal(env.t.timeDisplay, "25:00");
});

test("Task fokus dilepas di tengah Overtime → log ke sessionTaskId; fokus baru → task fokus", () => {
  let env = toAwaiting();
  env.act((t) => t.continueOvertime());
  env.advance(600 * 1000);
  env.setProps({ focusTask: null });
  env.act((t) => t.pause());
  env.act((t) => t.stop());
  assert.equal(env.posts.length, 2);
  assert.equal(env.posts[1].url, "/api/tasks/5/pomodoros");
  assert.equal(env.posts[1].body.focus_seconds, 600);

  env = toAwaiting();
  env.act((t) => t.continueOvertime());
  env.advance(600 * 1000);
  env.setProps({ focusTask: { id: 8 } });
  env.act((t) => t.stop());
  assert.equal(env.posts[1].url, "/api/tasks/8/pomodoros");
});

test("Muat ulang saat awaiting → dipulihkan tanpa log; Lanjut Fokus tetap berfungsi", () => {
  const ws = T0 - 30 * MIN;
  const env = makeEnv({ saved: todayState({ timeLeft: 0, phase: "awaiting", sessionCount: 1, countBeforeSession: 0,
    workStartedAt: ws, sessionTaskId: 5, totalFocusTime: 1500 }) });
  assert.equal(env.t.phase, "awaiting");
  assert.equal(env.t.timeDisplay, "00:00");
  assert.equal(env.t.isRunning, false);
  env.advance(5000);
  assert.equal(env.posts.length, 0);
  assert.equal(env.sounds.length, 0);
  env.act((t) => t.continueOvertime());
  env.advance(120 * 1000);
  env.act((t) => t.stop());
  assert.equal(env.posts.length, 1);
  assert.equal(env.posts[0].body.client_id, `pomo-7-${ws}-o`);
  assert.equal(env.posts[0].body.focus_seconds, 120);
});

test("Muat dengan countdown Work yang targetEndTime-nya lewat → satu log session, awaiting", () => {
  const end = T0 - 1000;
  const env = makeEnv({ saved: todayState({ isRunning: true, targetEndTime: end, timeLeft: 100,
    workStartedAt: end - 1500000, sessionTaskId: 5, sessionCount: 2 }) });
  assert.equal(env.posts.length, 1);
  assert.equal(env.posts[0].body.kind, "session");
  assert.equal(env.posts[0].body.client_id, `pomo-7-${end - 1500000}-s`);
  assert.equal(env.t.phase, "awaiting");
  assert.equal(env.t.mode, "work");
  assert.equal(env.t.sessionCount, 3);
  assert.deepEqual(env.sounds, ["work"]);
  env.advance(5000);
  assert.equal(env.posts.length, 1);
  assert.equal(env.saved().countBeforeSession, 2);
});

test("Muat dengan Overtime berjalan sejak 3 jam lalu → selesai di batas saat mount", () => {
  const env = makeEnv({ saved: todayState({ timeLeft: 0, phase: "overtime", isRunning: true, otAccumSec: 0,
    otRunStartedAt: T0 - 3 * HOUR, workStartedAt: T0 - 3 * HOUR - 1500000, sessionTaskId: 5,
    sessionCount: 1, countBeforeSession: 0 }) });
  assert.equal(env.posts.length, 1);
  assert.equal(env.posts[0].body.kind, "overtime");
  assert.equal(env.posts[0].body.pomodoros, 4);
  assert.equal(env.posts[0].body.focus_seconds, 7200);
  assert.equal(env.t.phase, "countdown");
  assert.equal(env.t.mode, "longBreak");
  assert.equal(env.t.isRunning, false);
  assert.equal(env.t.sessionCount, 5);
  assert.deepEqual(env.notifs, [{ title: "⏱️ Overtime selesai", body: "Overtime dihentikan otomatis setelah 2 jam" }]);
  assert.deepEqual(env.sounds, ["work"]);
});

test("Muat dengan Overtime berjalan 10 menit → lanjut dihitung dari jam dinding", () => {
  const env = makeEnv({ saved: todayState({ timeLeft: 0, phase: "overtime", isRunning: true, otAccumSec: 60,
    otRunStartedAt: T0 - 10 * MIN, workStartedAt: T0 - 40 * MIN, sessionTaskId: 5, sessionCount: 1, countBeforeSession: 0 }) });
  assert.equal(env.t.phase, "overtime");
  assert.equal(env.t.isRunning, true);
  assert.equal(env.t.overtimeSeconds, 660);
  assert.equal(env.posts.length, 0);
  env.advance(5000);
  assert.equal(env.t.overtimeSeconds, 665);
});

test("State kemarin berisi Overtime → log overtime ber-log_date hari ini; statistik hari ini nol", () => {
  const y = new Date(2026, 9, 19, 23, 0, 0).getTime();
  const env = makeEnv({ saved: todayState({ date: YESTERDAY, timeLeft: 0, phase: "overtime", isRunning: true,
    otAccumSec: 0, otRunStartedAt: y, workStartedAt: y - 1500000, sessionTaskId: 9, sessionCount: 6,
    totalFocusTime: 9000, countBeforeSession: 5 }) });
  assert.equal(env.posts.length, 1);
  assert.equal(env.posts[0].url, "/api/tasks/9/pomodoros");
  assert.equal(env.posts[0].body.kind, "overtime");
  assert.equal(env.posts[0].body.log_date, TODAY);
  assert.equal(env.posts[0].body.focus_seconds, 7200);
  assert.equal(env.t.sessionCount, 0);
  assert.equal(env.t.totalFocusTime, 0);
  assert.equal(env.t.phase, "countdown");
  assert.equal(env.t.mode, "work");
  assert.equal(env.sounds.length, 0);
  assert.equal(env.saved().date, TODAY);
});

test("State kemarin dengan countdown habis → log session ber-log_date kemarin", () => {
  const end = new Date(2026, 9, 19, 22, 0, 0).getTime();
  const env = makeEnv({ saved: todayState({ date: YESTERDAY, isRunning: true, targetEndTime: end,
    workStartedAt: end - 1500000, sessionTaskId: 9, sessionCount: 3 }) });
  assert.equal(env.posts.length, 1);
  assert.equal(env.posts[0].body.kind, "session");
  assert.equal(env.posts[0].body.log_date, YESTERDAY);
  assert.equal(env.t.sessionCount, 0);
  assert.equal(env.t.phase, "countdown");
});

test("Waktu fokus countdown: tick yang meloncat 60 dtk menambah 60; istirahat tidak menambah", () => {
  const env = makeEnv();
  env.act((t) => t.start());
  env.advance(60 * 1000, 60 * 1000);
  assert.equal(env.t.timeLeft, 1440);
  assert.equal(env.t.totalFocusTime, 60);
  env.advance(5 * 1000);
  assert.equal(env.t.totalFocusTime, 65);
  env.act((t) => t.pause());
  env.advance(MIN);
  env.act((t) => t.start());
  env.advance(10 * 1000, 10 * 1000);
  assert.equal(env.t.totalFocusTime, 75, "jeda tidak dihitung");
  env.act((t) => t.switchMode("shortBreak"));
  env.act((t) => t.start());
  env.advance(30 * 1000);
  assert.equal(env.t.totalFocusTime, 75);
});

// ── Review akhir PR C ─────────────────────────────────────────────────────────

test("start(event klik) → event diabaikan: sessionTaskId = task fokus; tanpa task fokus tetap ditolak", () => {
  const env = makeEnv();
  assert.equal(env.act((t) => t.start({ type: "click", target: {} })), true);
  assert.equal(env.saved().sessionTaskId, 5);
  const env2 = makeEnv({ focusTask: null });
  assert.equal(env2.act((t) => t.start({ type: "click", target: {} })), false);
  assert.equal(env2.t.isRunning, false);
  assert.equal(env2.toasts.length, 1);
});

test("Mulai lewat event klik, fokus dilepas di tengah Overtime, Stop → baris Overtime ke task sesi", () => {
  const env = makeEnv();
  env.act((t) => t.start({ type: "click", target: {} }));
  env.advance(1500 * 1000);
  assert.equal(env.t.phase, "awaiting");
  env.act((t) => t.continueOvertime());
  env.advance(10 * MIN);
  env.setProps({ focusTask: null });
  env.act((t) => t.stop());
  const ot = env.posts.filter((p) => p.body.kind === "overtime");
  assert.equal(ot.length, 1);
  assert.equal(ot[0].url, "/api/tasks/5/pomodoros");
  assert.equal(ot[0].body.focus_seconds, 600);
});

test("Jeda Overtime di luar batch (+65:00) → akumulasi 3900, tanpa batas, tanpa log", () => {
  const env = toAwaiting();
  env.act((t) => t.continueOvertime());
  env.advance(65 * MIN);
  const notifsBefore = env.notifs.length;
  env.t.pause(); // tanpa act: setiap setState langsung merender (pemanggil setelah await)
  const s = env.saved();
  assert.equal(s.phase, "overtime");
  assert.equal(s.otAccumSec, 3900);
  assert.equal(s.otRunStartedAt, null);
  assert.equal(s.isRunning, false);
  assert.equal(env.posts.filter((p) => p.body.kind === "overtime").length, 0);
  assert.equal(env.notifs.length, notifsBefore);
  assert.equal(env.t.timeDisplay, "+1:05:00");
});

test("Transisi Overtime di luar batch: Stop / Ambil Istirahat tidak memicu penyelesaian sesi ganda", () => {
  for (const action of ["stop", "takeBreak"]) {
    const env = toAwaiting();
    env.t.continueOvertime(); // tanpa act
    assert.equal(env.t.phase, "overtime");
    assert.equal(env.t.isRunning, true);
    env.advance(30 * MIN);
    env.t[action]();
    const sessions = env.posts.filter((p) => p.body.kind === "session");
    const ot = env.posts.filter((p) => p.body.kind === "overtime");
    assert.equal(sessions.length, 1, action);
    assert.equal(ot.length, 1, action);
    assert.equal(ot[0].body.focus_seconds, 1800, action);
    assert.equal(env.t.sessionCount, 2, action);
    assert.equal(env.t.phase, "countdown", action);
    assert.deepEqual(env.sounds, ["work"], action);
  }
  const env = toAwaiting();
  env.t.takeBreak(); // awaiting → istirahat, tanpa act
  assert.equal(env.t.mode, "shortBreak");
  assert.equal(env.t.isRunning, true);
  assert.equal(env.posts.length, 1);
  assert.equal(env.t.sessionCount, 1);
});

test("Pulih ke Overtime berjalan lalu Stop di luar batch → tanpa log session kedua / sessionCount ganda", () => {
  const ws = T0 - 40 * MIN;
  const env = makeEnv({ saved: todayState({ timeLeft: 0, phase: "overtime", isRunning: true, otAccumSec: 0,
    otRunStartedAt: T0 - 10 * MIN, workStartedAt: ws, sessionTaskId: 5, sessionCount: 1, countBeforeSession: 0 }) });
  env.t.stop();
  assert.equal(env.posts.filter((p) => p.body.kind === "session").length, 0);
  assert.equal(env.posts.filter((p) => p.body.kind === "overtime").length, 1);
  assert.equal(env.t.sessionCount, 1);
  assert.equal(env.t.phase, "countdown");
  assert.equal(env.t.mode, "work");
  assert.equal(env.t.timeLeft, 1500);
  assert.equal(env.sounds.length, 0);
});

test("Pulih ke awaiting → completedSessionRef diisi workStartedAt tersimpan", () => {
  const src = fnSource("usePomodoro");
  assert.match(src, /const completedSessionRef = useRef\(savedPhase !== "countdown" \? savedState\.workStartedAt \?\? null : null\)/);
});

test("Kontrol memanggil timer.start() tanpa event", () => {
  const ctrl = fnSource("PomoControls");
  assert.ok(!ctrl.includes("onClick: timer.start,"), "PomoControls tidak boleh meneruskan event ke start");
  assert.ok(ctrl.includes("onClick: () => timer.start()"));
  const chip = fnSource("TopBarPomodoroChip");
  assert.ok(!chip.includes("timer.pause : timer.start)()"));
  assert.ok(chip.includes("timer.start()"));
});

test("App.handleStartFocus: toast mengikuti fase (awaiting / Overtime / mulai)", () => {
  const i = indexHtml.indexOf("const handleStartFocus = useCallback(task => {");
  assert.ok(i >= 0);
  const src = indexHtml.slice(i, indexHtml.indexOf("}, [focusTask, timer, showToast]);", i));
  assert.ok(src.includes('timer.phase === "awaiting"'));
  assert.ok(src.includes("Pomodoro selesai — pilih istirahat atau lanjut"));
  assert.ok(src.includes("Overtime dilanjutkan"));
  assert.match(src, /const started = timer\.start\(task\)/);
  assert.match(src, /if \(!started\) return;/);
});
