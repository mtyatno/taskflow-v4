"use strict";

// Bug layar putih Chrome Android: `new Notification()` selalu melempar "Illegal constructor" saat izin granted.
// Dipanggil dari efek usePomodoro (Work 00:00, istirahat selesai, batas Overtime) → error lolos → ReactDOM.render
// legacy meng-unmount seluruh aplikasi. Tes ini menjalankan hook dengan React palsu (seperti
// focus_overtime_engine.test.js) dan helper bunyi/notifikasi ASLI dari index.html, plus AppErrorBoundary.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const pl = require("../../static/offline/pomologic.js");

const indexHtml = fs.readFileSync(path.resolve(__dirname, "../../static/index.html"), "utf8").replace(/\r\n/g, "\n");

function blockSource(head) {
  const start = indexHtml.indexOf(`\n${head}`);
  assert.ok(start >= 0, `${head} must exist`);
  const end = indexHtml.indexOf("\n}\n", start + 1);
  assert.ok(end > start, `${head} end must be found`);
  return indexHtml.slice(start, end) + "\n}\n";
}
const fnSource = (name) => blockSource(`function ${name}(`);

const T0 = new Date(2026, 9, 21, 9, 0, 0).getTime(); // 2026-10-21 09:00 waktu lokal
const TODAY = "2026-10-21";
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const ANDROID_MSG = "Failed to construct 'Notification': Illegal constructor. Use ServiceWorkerRegistration.showNotification() instead.";

const flush = () => new Promise((r) => setImmediate(r));

// Notification palsu ala Chrome Android: konstruktor selalu melempar.
function androidNotification({ permission = "granted", requestPermission } = {}) {
  const calls = { constructed: [], requested: 0 };
  class FakeNotification {
    constructor(title, opts) {
      calls.constructed.push({ title, opts });
      throw new TypeError(ANDROID_MSG);
    }
  }
  FakeNotification.permission = permission;
  FakeNotification.requestPermission = requestPermission || (() => { calls.requested++; return Promise.resolve("granted"); });
  return { N: FakeNotification, calls };
}

// Notification palsu desktop: konstruktor berhasil.
function desktopNotification({ permission = "granted" } = {}) {
  const calls = { constructed: [] };
  class FakeNotification {
    constructor(title, opts) { calls.constructed.push({ title, opts }); }
  }
  FakeNotification.permission = permission;
  FakeNotification.requestPermission = () => Promise.resolve("granted");
  return { N: FakeNotification, calls };
}

function fakeAudio({ throwOnCreate = false, throwOnOscillator = false, closeRejects = false } = {}) {
  const log = { created: 0, started: 0, stopped: 0, closed: 0 };
  class FakeAudioContext {
    constructor() {
      if (throwOnCreate) throw new Error("AudioContext tidak diizinkan");
      log.created++;
      this.currentTime = 0;
      this.destination = {};
    }
    createOscillator() {
      if (throwOnOscillator) throw new Error("oscillator gagal");
      return { frequency: { setValueAtTime() {} }, connect() {}, start() { log.started++; }, stop() { log.stopped++; } };
    }
    createGain() {
      return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} };
    }
    close() {
      log.closed++;
      return closeRejects ? Promise.reject(new Error("sudah ditutup")) : Promise.resolve();
    }
  }
  return { AC: FakeAudioContext, log };
}

// Helper bunyi + notifikasi ASLI dari index.html, dengan window/navigator/console/setTimeout palsu.
function realAlertHelpers(win, { warns = [] } = {}) {
  const timers = [];
  const cons = { warn: (...a) => warns.push(a), log() {}, error() {} };
  const make = new Function(
    "window", "navigator", "Notification", "console", "setTimeout",
    `${fnSource("playNotificationSound")}${fnSource("sendBrowserNotification")}
     return { playNotificationSound, sendBrowserNotification };`
  );
  const fns = make(win, win.navigator || {}, win.Notification, cons, (fn) => { timers.push(fn); return timers.length; });
  return { ...fns, warns, timers, runTimers: () => { while (timers.length) timers.shift()(); } };
}

function makeEnv({ saved = null, focusTask = { id: 5 }, now = T0, notification, audio = fakeAudio(), alerts } = {}) {
  const clock = { now };
  class FakeDate extends Date {
    constructor(...a) {
      if (a.length === 0) super(clock.now);
      else super(...a);
    }
    static now() { return clock.now; }
  }

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
  const warns = [];
  const api = { post: (url, body) => { posts.push({ url, body }); return Promise.resolve({}); } };
  const win = {
    TF: { pomologic: pl, tasklogic: { todayLocalISO: () => pl.localDateISO(clock.now) } },
    __refreshTasks: () => {},
    __showToast: () => {},
    navigator: {},
    AudioContext: audio.AC,
  };
  if (notification) win.Notification = notification;
  const helpers = alerts || realAlertHelpers(win, { warns });

  const hooks = [];
  let hi = 0;
  let rendering = false;
  let batch = 0;
  let dirty = false;
  let pendingEffects = [];
  const props = { focusTask };
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
    "playNotificationSound", "sendBrowserNotification", "console", "Date", "setInterval", "clearInterval", "Notification",
    `return (${fnSource("usePomodoro")});`
  );
  const impl = fn(
    useState, useRef, useEffect,
    { work: 1500, shortBreak: 300, longBreak: 900 },
    localStorage, win, api,
    helpers.playNotificationSound, helpers.sendBrowserNotification,
    { warn: (...a) => warns.push(a), log: () => {}, error: () => {} },
    FakeDate, fakeSetInterval, fakeClearInterval, win.Notification
  );
  render();

  return {
    get t() { return result; },
    clock, posts, warns, store, audio, helpers,
    saved: () => JSON.parse(store.tf_pomo_state),
    act(f) {
      batch++;
      let r;
      try { r = f(result); } finally { batch--; }
      if (dirty) render();
      return r;
    },
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

function todayState(extra) {
  return { mode: "work", timeLeft: 1500, isRunning: false, targetEndTime: null, focusTaskId: 5,
    sessionCount: 0, totalFocusTime: 0, workStartedAt: null, sessionTaskId: null, date: TODAY, ...extra };
}

// Helper yang melempar apa pun (kegagalan tak terduga) → transisi timer tetap harus selesai.
function throwingAlerts() {
  const calls = { sound: 0, notif: 0 };
  return {
    calls,
    playNotificationSound: () => { calls.sound++; throw new Error("bunyi gagal"); },
    sendBrowserNotification: () => { calls.notif++; throw new TypeError(ANDROID_MSG); },
  };
}

// ── Mesin timer dengan Notification ala Chrome Android ─────────────────────────────

test("Android: Work 00:00 dengan konstruktor Notification yang melempar → tanpa exception, awaiting, satu log sesi", () => {
  const { N, calls } = androidNotification();
  const env = makeEnv({ notification: N });
  assert.equal(env.act((t) => t.start()), true);
  assert.doesNotThrow(() => env.advance(1500 * 1000));
  assert.equal(env.t.phase, "awaiting");
  assert.equal(env.t.mode, "work");
  assert.equal(env.t.timeLeft, 0);
  assert.equal(env.t.isRunning, false);
  assert.equal(env.t.sessionCount, 1);
  assert.equal(env.posts.length, 1);
  assert.equal(env.posts[0].body.kind, "session");
  assert.equal(env.posts[0].body.client_id, `pomo-7-${T0}-s`);
  assert.equal(env.saved().phase, "awaiting", "fase awaiting tersimpan (bukan countdown 0 yang macet)");
  assert.equal(calls.constructed.length, 1, "tanpa registrasi SW → jalur konstruktor dicoba sekali");
  assert.ok(env.warns.some((w) => String(w[1] && w[1].message).includes("Illegal constructor")), "error dicatat lewat console.warn");
  assert.equal(env.audio.log.created, 1, "chime tetap dibunyikan");
});

test("Android: state macet (countdown, 0, tidak berjalan) lalu start(task) → tidak melempar, berakhir di awaiting", () => {
  const { N } = androidNotification();
  const env = makeEnv({ notification: N, focusTask: null,
    saved: todayState({ timeLeft: 0, isRunning: false, phase: "countdown", focusTaskId: null, sessionCount: 1, totalFocusTime: 1500 }) });
  assert.equal(env.t.phase, "countdown");
  assert.equal(env.t.timeLeft, 0);
  assert.doesNotThrow(() => env.act((t) => t.start({ id: 5, title: "Urgent 0" })));
  assert.equal(env.t.phase, "awaiting");
  assert.equal(env.t.isRunning, false);
  assert.equal(env.t.mode, "work");
  assert.equal(env.t.sessionCount, 2);
  assert.equal(env.posts.length, 1);
  assert.equal(env.saved().phase, "awaiting");
  // Tap Fokus berikutnya: awaiting → start menolak tanpa error (pilihan Istirahat/Lanjut di kartu).
  assert.doesNotThrow(() => assert.equal(env.act((t) => t.start({ id: 5 })), false));
});

test("Android: state macet REALISTIS (workStartedAt W dipertahankan) → start(task) → tepat 1 post sesi dengan client_id W (dedup server), awaiting", () => {
  const { N } = androidNotification();
  // Persis seperti tf_pomo_state setelah crash + reload di produksi: countdown 0 tidak berjalan, W tersimpan.
  const W = T0 - 40 * MIN;
  const env = makeEnv({ notification: N, focusTask: null,
    saved: todayState({ timeLeft: 0, isRunning: false, targetEndTime: W + 1500 * 1000, phase: "countdown",
      focusTaskId: null, workStartedAt: W, sessionTaskId: 5, sessionCount: 0, totalFocusTime: 0,
      otAccumSec: 0, otRunStartedAt: null, countBeforeSession: null }) });
  assert.equal(env.t.phase, "countdown");
  assert.equal(env.t.isRunning, false);
  assert.equal(env.posts.length, 0, "mount dengan state diam tidak mencatat apa pun");
  assert.doesNotThrow(() => env.act((t) => t.start({ id: 5, title: "Urgent 0" })));
  assert.equal(env.posts.length, 1, "tepat satu post sesi");
  assert.equal(env.posts[0].url, "/api/tasks/5/pomodoros");
  assert.equal(env.posts[0].body.kind, "session");
  assert.equal(env.posts[0].body.client_id, `pomo-7-${W}-s`, "client_id memakai W lama → server men-dedup bila sesi ini sudah tercatat");
  assert.equal(env.t.phase, "awaiting");
  assert.equal(env.t.isRunning, false);
  assert.equal(env.t.timeLeft, 0);
  assert.equal(env.saved().phase, "awaiting");
  assert.equal(env.saved().workStartedAt, W);
  // Render/efek berikutnya tidak memicu post kedua.
  env.advance(5000);
  assert.equal(env.posts.length, 1);
});

test("Android: state istirahat macet (shortBreak, 0, tidak berjalan) → start(task) → Work 25:00 diam, tanpa exception", () => {
  const { N } = androidNotification();
  const env = makeEnv({ notification: N, focusTask: null,
    saved: todayState({ mode: "shortBreak", timeLeft: 0, isRunning: false, targetEndTime: null, phase: "countdown",
      focusTaskId: null, sessionCount: 1, totalFocusTime: 1500 }) });
  assert.equal(env.t.mode, "shortBreak");
  assert.equal(env.t.timeLeft, 0);
  assert.doesNotThrow(() => env.act((t) => t.start({ id: 5 })));
  assert.equal(env.t.mode, "work");
  assert.equal(env.t.timeLeft, 1500);
  assert.equal(env.t.isRunning, false);
  assert.equal(env.t.phase, "countdown");
  assert.equal(env.posts.length, 0, "istirahat tidak mencatat sesi");
  assert.equal(env.saved().mode, "work");
  assert.equal(env.saved().timeLeft, 1500);
  assert.equal(env.saved().isRunning, false);
});

test("Android: muat ulang dengan countdown Work yang sudah habis (sisa crash) → tanpa exception saat mount, awaiting", () => {
  const { N } = androidNotification();
  const ws = T0 - 26 * MIN;
  let env;
  assert.doesNotThrow(() => {
    env = makeEnv({ notification: N, focusTask: null,
      saved: todayState({ timeLeft: 0, isRunning: true, targetEndTime: ws + 1500000, phase: "countdown",
        workStartedAt: ws, sessionTaskId: 5, focusTaskId: 5 }) });
  });
  assert.equal(env.t.phase, "awaiting");
  assert.equal(env.posts.length, 1);
  assert.equal(env.posts[0].body.client_id, `pomo-7-${ws}-s`, "client_id sama dengan sesi yang crash → idempoten");
});

test("Android: istirahat selesai → tidak melempar, kembali ke Work 25:00 diam", () => {
  const { N } = androidNotification();
  const env = makeEnv({ notification: N,
    saved: todayState({ mode: "shortBreak", timeLeft: 300, isRunning: true, targetEndTime: T0 + 300 * 1000, sessionCount: 1 }) });
  assert.equal(env.t.isRunning, true);
  assert.doesNotThrow(() => env.advance(300 * 1000));
  assert.equal(env.t.mode, "work");
  assert.equal(env.t.timeLeft, 1500);
  assert.equal(env.t.isRunning, false);
  assert.equal(env.t.phase, "countdown");
  // ≥ 1, bukan tepat 1: penyelesaian istirahat bisa terpicu dua kali di 0 (efek + interval basi) — perilaku lama,
  // sama di main; di luar cakupan perbaikan ini.
  assert.ok(env.audio.log.created >= 1, "chime istirahat tetap dibunyikan");
});

test("Android: batas Overtime 7200 dtk → tidak melempar, satu log overtime, istirahat diam", () => {
  const { N } = androidNotification();
  const ws = T0 - 30 * MIN;
  const env = makeEnv({ notification: N,
    saved: todayState({ timeLeft: 0, phase: "awaiting", sessionCount: 1, countBeforeSession: 0, workStartedAt: ws,
      sessionTaskId: 5, totalFocusTime: 1500 }) });
  env.act((t) => t.continueOvertime());
  assert.doesNotThrow(() => env.advance(3 * HOUR));
  assert.equal(env.posts.length, 1);
  assert.equal(env.posts[0].body.kind, "overtime");
  assert.equal(env.posts[0].body.pomodoros, 4);
  assert.equal(env.posts[0].body.focus_seconds, 7200);
  assert.equal(env.t.phase, "countdown");
  assert.equal(env.t.mode, "longBreak");
  assert.equal(env.t.isRunning, false);
  assert.equal(env.t.timeLeft, 900);
  assert.equal(env.t.sessionCount, 5);
});

test("Android: muat dengan Overtime berjalan sejak 3 jam lalu → selesai di batas saat mount tanpa exception", () => {
  const { N } = androidNotification();
  let env;
  assert.doesNotThrow(() => {
    env = makeEnv({ notification: N,
      saved: todayState({ timeLeft: 0, phase: "overtime", isRunning: true, otAccumSec: 0, otRunStartedAt: T0 - 3 * HOUR,
        workStartedAt: T0 - 3 * HOUR - 1500000, sessionTaskId: 5, sessionCount: 1, countBeforeSession: 0 }) });
  });
  assert.equal(env.t.phase, "countdown");
  assert.equal(env.t.mode, "longBreak");
  assert.equal(env.t.isRunning, false);
  assert.equal(env.posts.length, 1);
});

// ── Kegagalan bunyi/notifikasi apa pun tidak menggagalkan transisi (pomoAlert) ─────────

test("pomoAlert: bunyi + notifikasi yang melempar tidak menggagalkan Work 00:00 / istirahat / batas Overtime", () => {
  let alerts = throwingAlerts();
  let env = makeEnv({ alerts });
  env.act((t) => t.start());
  assert.doesNotThrow(() => env.advance(1500 * 1000));
  assert.equal(env.t.phase, "awaiting");
  assert.equal(env.posts.length, 1);
  assert.equal(alerts.calls.sound, 1);
  assert.equal(alerts.calls.notif, 1, "notifikasi tetap dicoba walau bunyi gagal");
  assert.ok(env.warns.length >= 2);

  alerts = throwingAlerts();
  env = makeEnv({ alerts, saved: todayState({ mode: "longBreak", timeLeft: 900, isRunning: true, targetEndTime: T0 + 900 * 1000 }) });
  assert.doesNotThrow(() => env.advance(900 * 1000));
  assert.equal(env.t.mode, "work");
  assert.equal(env.t.timeLeft, 1500);
  assert.equal(env.t.isRunning, false);
  assert.ok(alerts.calls.notif >= 1);

  alerts = throwingAlerts();
  env = makeEnv({ alerts, saved: todayState({ timeLeft: 0, phase: "awaiting", sessionCount: 1, countBeforeSession: 0,
    workStartedAt: T0 - 30 * MIN, sessionTaskId: 5 }) });
  env.act((t) => t.continueOvertime());
  assert.doesNotThrow(() => env.advance(3 * HOUR));
  assert.equal(env.t.phase, "countdown");
  assert.equal(env.t.mode, "longBreak");
  assert.equal(env.t.isRunning, false);
  assert.equal(alerts.calls.notif, 1);
});

test("pomoAlert dipanggil setelah semua setState transisi (work, break, batas Overtime)", () => {
  const src = fnSource("usePomodoro");
  const done = src.slice(src.indexOf("const handleTimerComplete = () => {"), src.indexOf("const finishOvertime = ("));
  assert.ok(done.length > 0);
  assert.ok(!/playNotificationSound\(|sendBrowserNotification\(/.test(done), "handleTimerComplete hanya lewat pomoAlert");
  const work = done.indexOf('pomoAlert("work"');
  assert.ok(work > done.indexOf('setPhase("awaiting")'), "work: pomoAlert sesudah setPhase(awaiting)");
  const brk = done.indexOf('pomoAlert("break"');
  assert.ok(brk > done.indexOf('setMode("work")') && brk > done.lastIndexOf("setTimeLeft(POMO_DURATIONS.work)"),
    "break: pomoAlert sesudah setMode + setTimeLeft");
  const fin = src.slice(src.indexOf("const finishOvertime = ("), src.indexOf("const leaveAfterSession = ("));
  assert.ok(!/playNotificationSound\(|sendBrowserNotification\(/.test(fin), "finishOvertime hanya lewat pomoAlert");
  assert.ok(fin.indexOf('pomoAlert("work"') > fin.lastIndexOf("setIsRunning(true)"), "batas Overtime: pomoAlert paling akhir");
  const helper = src.slice(src.indexOf("const pomoAlert = ("), src.indexOf("const handleTimerComplete = () => {"));
  assert.match(helper, /try \{\s*playNotificationSound\(/);
  assert.match(helper, /try \{\s*sendBrowserNotification\(/);
});

// ── sendBrowserNotification ─────────────────────────────────────────────────────

function swNavigator({ reg, rejects = false } = {}) {
  return { serviceWorker: { getRegistration: () => (rejects ? Promise.reject(new Error("SW error")) : Promise.resolve(reg)) } };
}
function fakeReg({ rejects = false } = {}) {
  const shown = [];
  return { shown, showNotification: (title, opts) => { shown.push({ title, opts }); return rejects ? Promise.reject(new TypeError("No notification permission")) : Promise.resolve(); } };
}
async function withRejectionWatch(fn) {
  const seen = [];
  const onRej = (r) => seen.push(r);
  process.on("unhandledRejection", onRej);
  try {
    await fn();
    await flush();
    await flush();
  } finally {
    process.off("unhandledRejection", onRej);
  }
  assert.deepEqual(seen, [], "tanpa unhandled rejection");
}

test("sendBrowserNotification: registrasi SW ada → reg.showNotification (ikon URL, tag; tanpa badge/renotify), konstruktor tidak dipakai", async () => {
  await withRejectionWatch(async () => {
    const { N, calls } = androidNotification();
    const reg = fakeReg();
    const h = realAlertHelpers({ Notification: N, navigator: swNavigator({ reg }) });
    assert.doesNotThrow(() => h.sendBrowserNotification("🍅 Pomodoro Selesai!", "Pomodoro selesai — lanjut fokus atau istirahat?"));
    await flush();
    assert.equal(reg.shown.length, 1);
    assert.equal(reg.shown[0].title, "🍅 Pomodoro Selesai!");
    assert.equal(reg.shown[0].opts.body, "Pomodoro selesai — lanjut fokus atau istirahat?");
    assert.equal(reg.shown[0].opts.icon, "/static/icon-192.png");
    assert.equal(reg.shown[0].opts.tag, "alurik-pomodoro");
    assert.ok(!("badge" in reg.shown[0].opts), "tanpa badge: ikon tidak transparan → kotak putih di Android");
    assert.ok(!("renotify" in reg.shown[0].opts), "tanpa renotify: penyelesaian ganda tidak bergetar dua kali");
    assert.equal(calls.constructed.length, 0);
    assert.deepEqual(h.warns, []);
  });
  assert.ok(fs.existsSync(path.resolve(__dirname, "../../static/icon-192.png")), "ikon notifikasi ada di static/");
});

test("sendBrowserNotification: tanpa registrasi SW → konstruktor (desktop); konstruktor melempar → tidak melempar, warn", async () => {
  await withRejectionWatch(async () => {
    const desk = desktopNotification();
    let h = realAlertHelpers({ Notification: desk.N, navigator: swNavigator({ reg: undefined }) });
    h.sendBrowserNotification("☕ Istirahat Selesai!", "Siap untuk fokus lagi?");
    await flush();
    assert.equal(desk.calls.constructed.length, 1);
    assert.equal(desk.calls.constructed[0].title, "☕ Istirahat Selesai!");
    assert.equal(desk.calls.constructed[0].opts.icon, "/static/icon-192.png");

    const android = androidNotification();
    h = realAlertHelpers({ Notification: android.N, navigator: swNavigator({ reg: undefined }) });
    assert.doesNotThrow(() => h.sendBrowserNotification("t", "b"));
    await flush();
    assert.equal(android.calls.constructed.length, 1);
    assert.equal(h.warns.length, 1);

    // Tanpa navigator.serviceWorker sama sekali (mis. http biasa / WebView): konstruktor dalam try/catch.
    const a2 = androidNotification();
    h = realAlertHelpers({ Notification: a2.N, navigator: {} });
    assert.doesNotThrow(() => h.sendBrowserNotification("t", "b"));
    await flush();
    assert.equal(a2.calls.constructed.length, 1);
    assert.equal(h.warns.length, 1);
  });
});

test("sendBrowserNotification: tanpa Notification / izin ditolak → diam, tidak melempar", async () => {
  await withRejectionWatch(async () => {
    let h = realAlertHelpers({ navigator: swNavigator({ reg: fakeReg() }) });
    assert.doesNotThrow(() => h.sendBrowserNotification("t", "b"));
    const reg = fakeReg();
    const denied = androidNotification({ permission: "denied" });
    h = realAlertHelpers({ Notification: denied.N, navigator: swNavigator({ reg }) });
    assert.doesNotThrow(() => h.sendBrowserNotification("t", "b"));
    await flush();
    assert.equal(reg.shown.length, 0);
    assert.equal(denied.calls.constructed.length, 0);
    assert.equal(denied.calls.requested, 0);
  });
});

test("sendBrowserNotification: izin default → requestPermission; ditolak/melempar → tidak melempar; granted → lewat jalur aman", async () => {
  await withRejectionWatch(async () => {
    const reg = fakeReg();
    let a = androidNotification({ permission: "default", requestPermission: () => Promise.reject(new Error("blocked")) });
    let h = realAlertHelpers({ Notification: a.N, navigator: swNavigator({ reg }) });
    assert.doesNotThrow(() => h.sendBrowserNotification("t", "b"));
    await flush();
    assert.equal(reg.shown.length, 0);
    assert.equal(a.calls.constructed.length, 0);

    a = androidNotification({ permission: "default", requestPermission: () => { throw new Error("sync"); } });
    h = realAlertHelpers({ Notification: a.N, navigator: swNavigator({ reg }) });
    assert.doesNotThrow(() => h.sendBrowserNotification("t", "b"));
    await flush();
    assert.equal(reg.shown.length, 0);

    a = androidNotification({ permission: "default", requestPermission: () => Promise.resolve("granted") });
    h = realAlertHelpers({ Notification: a.N, navigator: swNavigator({ reg }) });
    h.sendBrowserNotification("Izin baru", "b");
    await flush();
    assert.equal(reg.shown.length, 1, "setelah izin diberikan: reg.showNotification");
    assert.equal(reg.shown[0].title, "Izin baru");
    assert.equal(a.calls.constructed.length, 0);

    // Tanpa registrasi SW setelah izin diberikan: konstruktor yang melempar tetap tertangkap.
    a = androidNotification({ permission: "default", requestPermission: () => Promise.resolve("granted") });
    h = realAlertHelpers({ Notification: a.N, navigator: swNavigator({ reg: undefined }) });
    h.sendBrowserNotification("t", "b");
    await flush();
    assert.equal(a.calls.constructed.length, 1);
    assert.equal(h.warns.length, 1);
  });
});

test("sendBrowserNotification: getRegistration / showNotification menolak → tidak melempar, tanpa unhandled rejection", async () => {
  await withRejectionWatch(async () => {
    const { N } = androidNotification();
    let h = realAlertHelpers({ Notification: N, navigator: swNavigator({ rejects: true }) });
    assert.doesNotThrow(() => h.sendBrowserNotification("t", "b"));
    await flush();
    assert.equal(h.warns.length, 1);

    // showNotification menolak (worker belum aktif) → cadangan konstruktor; di Android ikut melempar → tetap tertangkap.
    const reg = fakeReg({ rejects: true });
    const android = androidNotification();
    h = realAlertHelpers({ Notification: android.N, navigator: swNavigator({ reg }) });
    assert.doesNotThrow(() => h.sendBrowserNotification("t", "b"));
    await flush();
    await flush();
    assert.equal(reg.shown.length, 1);
    assert.equal(android.calls.constructed.length, 1, "cadangan konstruktor dicoba setelah showNotification menolak");
    assert.equal(h.warns.length, 2, "penolakan SW + kegagalan konstruktor sama-sama dicatat");
  });
});

test("sendBrowserNotification: showNotification menolak di desktop → notifikasi lewat konstruktor", async () => {
  await withRejectionWatch(async () => {
    const reg = fakeReg({ rejects: true });
    const desk = desktopNotification();
    const h = realAlertHelpers({ Notification: desk.N, navigator: swNavigator({ reg }) });
    h.sendBrowserNotification("🍅 Pomodoro Selesai!", "b");
    await flush();
    await flush();
    assert.equal(reg.shown.length, 1);
    assert.equal(desk.calls.constructed.length, 1);
    assert.equal(desk.calls.constructed[0].title, "🍅 Pomodoro Selesai!");
    assert.equal(desk.calls.constructed[0].opts.tag, "alurik-pomodoro");
    assert.equal(h.warns.length, 1);

    // showNotification melempar sinkron (bukan promise) → jalur cadangan yang sama.
    const desk2 = desktopNotification();
    const syncReg = { showNotification: () => { throw new TypeError("No active registration"); } };
    const h2 = realAlertHelpers({ Notification: desk2.N, navigator: swNavigator({ reg: syncReg }) });
    assert.doesNotThrow(() => h2.sendBrowserNotification("t", "b"));
    await flush();
    await flush();
    assert.equal(desk2.calls.constructed.length, 1);
  });
});

test("sendBrowserNotification: ikon bukan emoji", () => {
  const src = fnSource("sendBrowserNotification");
  assert.ok(!src.includes('icon: "🍅"'));
  assert.match(src, /\/static\/icon-192\.png/);
});

// ── playNotificationSound ──────────────────────────────────────────────────────

test("playNotificationSound: AudioContext melempar dari konstruktor → tidak melempar, warn", () => {
  const audio = fakeAudio({ throwOnCreate: true });
  const h = realAlertHelpers({ AudioContext: audio.AC });
  assert.doesNotThrow(() => h.playNotificationSound("work"));
  assert.equal(h.warns.length, 1);
  assert.doesNotThrow(() => realAlertHelpers({}).playNotificationSound("break"), "tanpa AudioContext sama sekali");
});

test("playNotificationSound: nada dimainkan lalu context ditutup (tidak bocor)", async () => {
  await withRejectionWatch(async () => {
    const audio = fakeAudio();
    const h = realAlertHelpers({ AudioContext: audio.AC });
    h.playNotificationSound("work");
    assert.equal(audio.log.created, 1);
    assert.equal(audio.log.started, 1);
    assert.equal(audio.log.stopped, 1);
    h.runTimers();
    assert.equal(audio.log.closed, 1);

    // webkitAudioContext (Safari lama) + close() yang menolak → tetap tanpa unhandled rejection.
    const old = fakeAudio({ closeRejects: true });
    const h2 = realAlertHelpers({ webkitAudioContext: old.AC });
    h2.playNotificationSound("break");
    h2.runTimers();
    assert.equal(old.log.created, 1);
    assert.equal(old.log.closed, 1);
  });
});

test("playNotificationSound: gagal di tengah (createOscillator melempar) → tidak melempar, context tetap ditutup", () => {
  const audio = fakeAudio({ throwOnOscillator: true });
  const h = realAlertHelpers({ AudioContext: audio.AC });
  assert.doesNotThrow(() => h.playNotificationSound("work"));
  h.runTimers();
  assert.equal(audio.log.created, 1);
  assert.equal(audio.log.closed, 1);
  assert.equal(h.warns.length, 1);
});

// ── AppErrorBoundary ───────────────────────────────────────────────────────────

test("ReactDOM.render membungkus App dengan AppErrorBoundary", () => {
  assert.match(indexHtml,
    /ReactDOM\.render\(\/\*#__PURE__\*\/React\.createElement\(AppErrorBoundary, null, \/\*#__PURE__\*\/React\.createElement\(App, null\)\), document\.getElementById\("root"\)\);/);
  assert.equal((indexHtml.match(/ReactDOM\.render\(/g) || []).length, 1);
  const src = blockSource("class AppErrorBoundary extends React.Component {");
  for (const needle of ["Terjadi kesalahan pada tampilan", "Muat ulang", "Salin detail", "tf_last_crash", "console.error"]) {
    assert.ok(src.includes(needle), `boundary memuat ${needle}`);
  }
});

test("window.__SW_VERSION di-set sekali, sebelum render React mana pun (crash render pertama tetap mencatat versi)", () => {
  const assigns = [...indexHtml.matchAll(/window\.__SW_VERSION\s*=\s*"([^"]+)";/g)];
  assert.equal(assigns.length, 1, "satu penugasan");
  const at = assigns[0].index;
  assert.ok(at < indexHtml.indexOf("ReactDOM.render("), "sebelum ReactDOM.render");
  assert.ok(at < indexHtml.indexOf("\nfunction usePomodoro("), "sebelum skrip aplikasi");
  assert.ok(at > indexHtml.indexOf("<body>"), "di skrip awal <body>");
  const sw = fs.readFileSync(path.resolve(__dirname, "../../static/sw.js"), "utf8");
  assert.equal(assigns[0][1], sw.match(/^const CACHE = "([^"]+)";/m)[1], "string sama dengan CACHE sw.js");
});

function boundaryEnv({ setItemThrows = false, clipboard } = {}) {
  const store = {};
  const errors = [];
  const reloads = [];
  const clipWrites = [];
  const React = {
    Component: class {
      constructor(props) { this.props = props; this.state = {}; }
      setState(u) { this.state = { ...this.state, ...(typeof u === "function" ? u(this.state, this.props) : u) }; }
    },
    createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat() }),
  };
  const localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { if (setItemThrows) throw new Error("QuotaExceeded"); store[k] = String(v); },
  };
  const navigator = {
    userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 7) Chrome/131",
    clipboard: clipboard === undefined ? { writeText: (t) => { clipWrites.push(t); return Promise.resolve(); } } : clipboard,
  };
  const win = { __SW_VERSION: "taskflow-v999-test" };
  const make = new Function("React", "localStorage", "navigator", "window", "location", "console",
    `${blockSource("class AppErrorBoundary extends React.Component {")}\nreturn AppErrorBoundary;`);
  const Boundary = make(React, localStorage, navigator, win, { reload: () => reloads.push(1) },
    { error: (...a) => errors.push(a), warn() {}, log() {} });
  return { Boundary, store, errors, reloads, clipWrites };
}

function textOf(node) {
  if (node == null || node === false || node === true) return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  return textOf(node.children);
}
function findAll(node, pred, out = []) {
  if (!node || typeof node !== "object") return out;
  if (Array.isArray(node)) { node.forEach((n) => findAll(n, pred, out)); return out; }
  if (pred(node)) out.push(node);
  findAll(node.children, pred, out);
  return out;
}
function crash(env, error, componentStack = "\n    at Dashboard\n    at App\n    at AppErrorBoundary") {
  const b = new env.Boundary({ children: "APP" });
  assert.equal(b.render(), "APP", "tanpa error → anak dirender apa adanya");
  b.setState(env.Boundary.getDerivedStateFromError(error));
  b.componentDidCatch(error, { componentStack });
  return b;
}

test("AppErrorBoundary: error → layar pemulihan + tf_last_crash + console.error", () => {
  const env = boundaryEnv();
  const err = new TypeError(ANDROID_MSG);
  err.stack = [`TypeError: ${ANDROID_MSG}`, ...Array.from({ length: 20 }, (_, i) => `    at fn${i} (index.html:${i})`)].join("\n");
  const b = crash(env, err);
  const ui = b.render();
  const text = textOf(ui);
  assert.ok(text.includes("Terjadi kesalahan pada tampilan"));
  assert.ok(text.includes(ANDROID_MSG), "pesan error tampil");
  const pre = findAll(ui, (n) => n.type === "pre");
  assert.equal(pre.length, 1);
  const lines = textOf(pre[0]).split("\n");
  assert.ok(lines.length <= 6, `ringkasan stack ≤ 6 baris (dapat ${lines.length})`);
  assert.ok(lines[1].includes("fn0"));
  assert.equal(pre[0].props.style.overflow, "auto", "stack bisa digulir");
  const buttons = findAll(ui, (n) => n.type === "button");
  const labels = buttons.map(textOf);
  assert.ok(labels.includes("Muat ulang"));
  assert.ok(labels.includes("Salin detail"));

  const saved = JSON.parse(env.store.tf_last_crash);
  assert.equal(saved.message, ANDROID_MSG);
  assert.ok(saved.stack.includes("fn19"), "stack lengkap disimpan");
  assert.ok(saved.componentStack.includes("at Dashboard"));
  assert.equal(saved.version, "taskflow-v999-test");
  assert.ok(saved.ua.includes("Pixel 7"));
  assert.ok(!Number.isNaN(Date.parse(saved.at)));
  assert.ok(env.errors.length >= 1, "console.error dipanggil");
});

test("AppErrorBoundary: Muat ulang → location.reload; Salin detail → clipboard berisi pesan + stack", async () => {
  const env = boundaryEnv();
  const err = new Error("render gagal");
  err.stack = "Error: render gagal\n    at Widget (index.html:1)";
  const b = crash(env, err);
  const button = (label) => findAll(b.render(), (n) => n.type === "button" && textOf(n) === label)[0];
  button("Muat ulang").props.onClick();
  assert.equal(env.reloads.length, 1);
  button("Salin detail").props.onClick();
  await flush();
  assert.equal(env.clipWrites.length, 1);
  assert.ok(env.clipWrites[0].includes("render gagal"));
  assert.ok(env.clipWrites[0].includes("at Widget"));
  assert.ok(env.clipWrites[0].includes("at Dashboard"), "component stack ikut disalin");
  assert.ok(env.clipWrites[0].includes("taskflow-v999-test"));
});

test("AppErrorBoundary: localStorage / clipboard gagal, error bukan Error → tetap merender, tidak melempar", async () => {
  await withRejectionWatch(async () => {
    let env = boundaryEnv({ setItemThrows: true, clipboard: null });
    let b;
    assert.doesNotThrow(() => { b = crash(env, "string dilempar", undefined); });
    let ui;
    assert.doesNotThrow(() => { ui = b.render(); });
    assert.ok(textOf(ui).includes("string dilempar"));
    const copy = findAll(ui, (n) => n.type === "button" && textOf(n) === "Salin detail")[0];
    assert.doesNotThrow(() => copy.props.onClick());
    await flush();
    assert.doesNotThrow(() => b.render());

    env = boundaryEnv({ clipboard: { writeText: () => Promise.reject(new Error("NotAllowed")) } });
    b = crash(env, null);
    assert.doesNotThrow(() => b.render());
    findAll(b.render(), (n) => n.type === "button" && textOf(n) === "Salin detail")[0].props.onClick();
    await flush();
    assert.doesNotThrow(() => b.render());
    assert.ok(env.store.tf_last_crash);
  });
});
