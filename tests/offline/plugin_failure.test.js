"use strict";
// Sistem plugin Fase 0a — penanganan gagal (spec §8, K13).
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { deleteDB } = require("./setup.js");
const { DB_NAME, _reset: resetDB } = require("../../static/offline/db.js");
const { metaGet } = require("../../static/offline/meta.js");
const RT = require("../../static/plugin-runtime.js");
const P = RT.plugins;

const INDEX = { v: 1, plugins: [{ id: "habit-heatmap", name: "Heatmap Habit", description: "d", version: "1.0.0", permissions: ["storage"], defaultEnabled: true, files: ["plugin.js"], hash: "abcd1234" }] };
const MANIFEST = { id: "habit-heatmap", name: "Heatmap Habit", version: "1.0.0", minApi: 1, slots: ["dashboard.widgets"], permissions: ["storage"] };
let toasts;

beforeEach(async () => {
  P._reset();
  resetDB();
  await deleteDB(DB_NAME);
  await P.init({ fetchIndex: () => Promise.resolve(INDEX) });
  toasts = [];
  P.bindHost({ toast: (m, t) => toasts.push([m, t]) });
});
const tick = () => new Promise((r) => setTimeout(r, 10));

test("dua error render → OFF + toast sekali per kejadian", async () => {
  P.markFailed("habit-heatmap", "render", new Error("satu"));
  assert.equal(P.isEnabled("habit-heatmap"), true);
  assert.equal(P.list()[0].failed, "render");
  assert.equal(toasts.length, 1);
  P.markFailed("habit-heatmap", "render", new Error("dua"));
  assert.equal(P.isEnabled("habit-heatmap"), false);
  assert.equal(toasts.length, 2);
  assert.deepEqual(toasts[1], ["Plugin Heatmap Habit dimatikan karena error", "error"]);
  await tick();
  assert.equal((await metaGet("plugins:state:v1"))["habit-heatmap"].enabled, false);
  // setelah OFF, error lanjutan tidak menambah toast
  P.markFailed("habit-heatmap", "render", new Error("tiga"));
  assert.equal(toasts.length, 2);
  assert.equal(P.list()[0].failed, "render");
});

test("error pendengar dihitung seperti render", async () => {
  P.register(MANIFEST, (api) => {
    api.events.on("habit.changed", () => { throw new Error("pendengar rusak"); });
    return {};
  });
  RT.events.emit("habit.changed", {});
  assert.equal(P.isEnabled("habit-heatmap"), true);
  RT.events.emit("habit.changed", {});
  assert.equal(P.isEnabled("habit-heatmap"), false);
  // pendengar dilepas saat OFF
  RT.events.emit("habit.changed", {});
  assert.equal(P.failures("habit-heatmap").length, 2);
  assert.equal(P.failures("habit-heatmap")[0].kind, "listener");
});

test("error yang sama tidak dihitung dua kali", () => {
  const err = new Error("sama");
  P.markFailed("habit-heatmap", "permission", err);
  P.markFailed("habit-heatmap", "render", err);
  assert.equal(P.isEnabled("habit-heatmap"), true);
  assert.equal(P.failures("habit-heatmap").length, 1);
});

test("failures menyimpan detail; Aktifkan lagi mereset hitungan", async () => {
  P.markFailed("habit-heatmap", "render", new Error("satu"));
  P.markFailed("habit-heatmap", "render", new Error("dua"));
  const f = P.failures("habit-heatmap");
  assert.equal(f.length, 2);
  assert.equal(f[1].message, "dua");
  assert.equal(f[1].kind, "render");
  assert.match(f[1].at, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(typeof f[1].stack, "string");
  await P.setEnabled("habit-heatmap", true);
  assert.equal(P.list()[0].failed, null);
  P.markFailed("habit-heatmap", "render", new Error("tiga"));
  assert.equal(P.isEnabled("habit-heatmap"), true);
});

test("gagal load: toast sekali per sesi", () => {
  P.markFailed("habit-heatmap", "load", new Error("a"));
  P.markFailed("habit-heatmap", "load", new Error("b"));
  assert.equal(toasts.length, 1);
  assert.equal(P.isEnabled("habit-heatmap"), true);
});

test("tanpa binding host: hanya console.warn, tidak melempar", () => {
  P.bindHost({});
  const orig = console.warn;
  let warned = 0;
  console.warn = () => { warned++; };
  try { P.markFailed("habit-heatmap", "render", new Error("x")); } finally { console.warn = orig; }
  assert.ok(warned >= 1);
});

test("init() membersihkan detail gagal sesi sebelumnya", async () => {
  P._reset();
  P.markFailed("habit-heatmap", "load", new Error("lama"));
  assert.equal(P.failures("habit-heatmap").length, 1);
  await P.init({ fetchIndex: () => Promise.resolve(INDEX) });
  assert.deepEqual(P.failures("habit-heatmap"), []);
});

// Temuan review akhir #1: error factory deterministik → langsung OFF (seperti manifest), toast sekali.
test("factory melempar → OFF setelah 1 kali + toast 'dimatikan karena error'; sesi berikutnya tanpa toast/muat ulang", async () => {
  P.register(MANIFEST, () => { throw new Error("factory rusak"); });
  assert.equal(P.isEnabled("habit-heatmap"), false);
  assert.equal(P.list()[0].failed, "factory");
  assert.deepEqual(toasts, [["Plugin Heatmap Habit dimatikan karena error", "error"]]);
  await tick();
  assert.equal((await metaGet("plugins:state:v1"))["habit-heatmap"].enabled, false);
  // sesi berikutnya: status OFF tersimpan → tidak dimuat, tidak ada toast
  P._reset();
  await P.init({ fetchIndex: () => Promise.resolve(INDEX) });
  const t2 = [];
  P.bindHost({ toast: (m, t) => t2.push([m, t]) });
  let injected = 0;
  assert.equal(await P.load("habit-heatmap", { inject: () => { injected++; return Promise.resolve(); }, timeoutMs: 20 }), false);
  assert.equal(P.isEnabled("habit-heatmap"), false);
  assert.equal(injected, 0);
  assert.deepEqual(t2, []);
});

// Temuan review akhir #3a: register yang terlambat (setelah timeout load) berhasil → penanda gagal dikosongkan.
test("register berhasil setelah timeout load → failed dikosongkan, kontribusi tersedia", async () => {
  const comp = () => null;
  const inject = (url, kind) => {
    if (kind === "script") setTimeout(() => P.register(MANIFEST, () => ({ slots: { "dashboard.widgets": [{ id: "g", component: comp }] } })), 40);
    return Promise.resolve();
  };
  assert.equal(await P.load("habit-heatmap", { inject, timeoutMs: 5 }), false);
  assert.equal(P.list()[0].failed, "load");
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(P.list()[0].failed, null);
  assert.equal(P.list()[0].loaded, true);
  assert.equal(P.contributions("dashboard.widgets").length, 1);
});

// Temuan review akhir #3b: plugin OFF + manifest invalid → hanya console.warn, tanpa toast.
test("plugin OFF: register dengan manifest invalid → tanpa toast, hanya console.warn", async () => {
  await P.setEnabled("habit-heatmap", false);
  const orig = console.warn;
  let warned = 0;
  console.warn = () => { warned++; };
  try { P.register(Object.assign({}, MANIFEST, { permissions: ["network"] }), () => ({})); } finally { console.warn = orig; }
  assert.deepEqual(toasts, []);
  assert.ok(warned >= 1);
  assert.equal(P.isEnabled("habit-heatmap"), false);
});
