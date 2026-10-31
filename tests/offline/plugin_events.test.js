"use strict";
// Sistem plugin Fase 0a — event bus TF.events + jembatan event host (spec §4.6, rencana R1).
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
require("./setup.js");
const RT = require("../../static/plugin-runtime.js");
const E = RT.events;

beforeEach(() => { RT.plugins._reset(); });

test("on/off/once", () => {
  const got = [];
  const fn = (p) => got.push("a" + p.n);
  const off = E.on("task.completed", fn);
  E.once("task.completed", (p) => got.push("once" + p.n));
  E.emit("task.completed", { n: 1 });
  E.emit("task.completed", { n: 2 });
  off();
  E.emit("task.completed", { n: 3 });
  assert.deepEqual(got, ["a1", "once1", "a2"]);
  E.on("x.y", fn);
  E.off("x.y", fn);
  E.emit("x.y", { n: 4 });
  assert.deepEqual(got, ["a1", "once1", "a2"]);
});

test("payload dibekukan dan disalin", () => {
  const src = { taskId: 1 };
  let seen = null;
  E.on("task.completed", (p) => { seen = p; });
  E.emit("task.completed", src);
  assert.ok(Object.isFrozen(seen));
  assert.notEqual(seen, src);
  assert.throws(() => { "use strict"; seen.taskId = 2; });
  E.emit("task.completed");
  assert.ok(Object.isFrozen(seen));
});

test("error satu pendengar tidak menghentikan yang lain dan memanggil onListenerError(pluginId, err)", () => {
  const errs = [];
  const bus = RT.createBus({ onListenerError: (id, err) => errs.push([id, err.message]) });
  const got = [];
  const a = bus.scoped("plug-a");
  a.on("habit.changed", () => { throw new Error("boom"); });
  bus.on("habit.changed", () => got.push("host"));
  bus.scoped("plug-b").on("habit.changed", () => got.push("b"));
  bus.emit("habit.changed", {});
  assert.deepEqual(got, ["host", "b"]);
  assert.deepEqual(errs, [["plug-a", "boom"]]);
});

test("bus bawaan: error pendengar plugin diteruskan ke markFailed", () => {
  const calls = [];
  const orig = RT.plugins.markFailed;
  RT.plugins.markFailed = (id, kind, err) => calls.push([id, kind, err.message]);
  try {
    E.scoped("plug-a").on("app.online", () => { throw new Error("x"); });
    E.emit("app.online", {});
  } finally { RT.plugins.markFailed = orig; }
  assert.deepEqual(calls, [["plug-a", "listener", "x"]]);
});

test("scoped: emit hanya <id>.*; offAll melepas semua", () => {
  const s = E.scoped("plug-a");
  assert.throws(() => s.emit("b.x", {}), /plug-a\./);
  assert.throws(() => s.emit("plug-ab.x", {}), /plug-a\./);
  assert.throws(() => s.emit("task.completed", {}));
  const got = [];
  E.on("plug-a.ping", (p) => got.push(p.v));
  s.emit("plug-a.ping", { v: 1 });
  s.on("task.completed", () => got.push("t1"));
  s.once("task.completed", () => got.push("t2"));
  const fn = () => got.push("h");
  s.on("habit.changed", fn);
  s.off("habit.changed", fn);
  E.emit("habit.changed", {});
  s.offAll();
  E.emit("task.completed", {});
  assert.deepEqual(got, [1]);
});

test("OFF plugin melepas pendengar api.events-nya", async () => {
  const P = RT.plugins;
  await P.init({ fetchIndex: () => Promise.resolve({ v: 1, plugins: [{ id: "plug-a", name: "A", version: "1.0.0", permissions: [], defaultEnabled: true, files: ["plugin.js"], hash: "1" }] }) });
  let n = 0;
  P.register({ id: "plug-a", name: "A", version: "1.0.0", minApi: 1, slots: [], permissions: [] }, (api) => {
    api.events.on("task.completed", () => n++);
    return {};
  });
  E.emit("task.completed", {});
  await P.setEnabled("plug-a", false);
  E.emit("task.completed", {});
  assert.equal(n, 1);
});

function fakeClock(startIso) {
  let now = Date.parse(startIso);
  let tick = null;
  return {
    now: () => now,
    set: (iso) => { now = Date.parse(iso); },
    setInterval: (fn, ms) => { assert.equal(ms, 60000); tick = fn; return 7; },
    clearInterval: (h) => { assert.equal(h, 7); tick = null; },
    tick: () => tick && tick(),
  };
}

test("jembatan window: habitSaved, tf:initial-sync, tf:sync-state idle, online/offline", () => {
  const target = new EventTarget();
  const clock = fakeClock("2026-10-31T10:00:00Z");
  const un = E.installBridge(target, clock);
  const got = [];
  for (const n of ["habit.changed", "sync.done", "app.online", "app.offline"]) E.on(n, (p) => got.push([n, Object.assign({}, p)]));
  target.dispatchEvent(new Event("habitSaved"));
  target.dispatchEvent(new CustomEvent("tf:initial-sync", { detail: { user_id: "1" } }));
  target.dispatchEvent(new CustomEvent("tf:sync-state", { detail: { running: true } }));
  target.dispatchEvent(new CustomEvent("tf:sync-state", { detail: { running: false, lastFailed: false } }));
  target.dispatchEvent(new CustomEvent("tf:sync-state", { detail: { running: false, lastFailed: false } }));
  target.dispatchEvent(new Event("online"));
  target.dispatchEvent(new Event("offline"));
  assert.deepEqual(got, [
    ["habit.changed", {}],
    ["sync.done", { initial: true }],
    ["sync.done", { initial: false }],
    ["app.online", {}],
    ["app.offline", {}],
  ]);
  un();
  target.dispatchEvent(new Event("habitSaved"));
  assert.equal(got.length, 5);
});

test("app.dayChanged terpicu saat jam melewati tengah malam WIB", () => {
  const target = new EventTarget();
  const clock = fakeClock("2026-10-31T16:58:00Z"); // 23:58 WIB
  const un = E.installBridge(target, clock);
  const got = [];
  E.on("app.dayChanged", (p) => got.push(p.date));
  clock.tick();
  assert.deepEqual(got, []);
  clock.set("2026-10-31T17:00:30Z"); // 00:00 WIB 1 Nov
  clock.tick();
  clock.tick();
  assert.deepEqual(got, ["2026-11-01"]);
  un();
});

test("jktDate memakai Asia/Jakarta", () => {
  assert.equal(RT.jktDate(Date.parse("2026-10-31T16:59:59Z")), "2026-10-31");
  assert.equal(RT.jktDate(Date.parse("2026-10-31T17:00:00Z")), "2026-11-01");
});
