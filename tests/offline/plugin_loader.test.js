"use strict";
// Sistem plugin Fase 0a — loader lazy (spec §4.2 langkah 4–5, §8; rencana R5: inject bisa disuntik).
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { deleteDB } = require("./setup.js");
const { DB_NAME, _reset: resetDB } = require("../../static/offline/db.js");
const { metaGet } = require("../../static/offline/meta.js");
const RT = require("../../static/plugin-runtime.js");
const P = RT.plugins;

const INDEX = {
  v: 1,
  plugins: [
    { id: "habit-heatmap", name: "Heatmap Habit", description: "d", version: "1.0.0", permissions: ["storage"], defaultEnabled: true, files: ["plugin.js", "style.css"], hash: "abcd1234" },
    { id: "plain-plugin", name: "Plain", description: "p", version: "1.0.0", permissions: [], defaultEnabled: false, files: ["plugin.js"], hash: "99998888" },
  ],
};
const MANIFEST = { id: "habit-heatmap", name: "Heatmap Habit", version: "1.0.0", minApi: 1, slots: ["dashboard.widgets"], permissions: ["storage"] };
const comp = () => null;

beforeEach(async () => {
  P._reset();
  resetDB();
  await deleteDB(DB_NAME);
  await P.init({ fetchIndex: () => Promise.resolve(INDEX) });
});

function scriptInject(manifest, calls) {
  return (url, kind) => {
    calls.push([url, kind]);
    if (kind === "script") {
      setTimeout(() => P.register(manifest, () => ({ slots: { "dashboard.widgets": [{ id: "grid", order: 1, component: comp }] } })), 5);
    }
    return Promise.resolve();
  };
}

test("inject dipanggil sekali walau load dua kali; URL memuat hash dari index", async () => {
  const calls = [];
  const inject = scriptInject(MANIFEST, calls);
  const [a, b] = await Promise.all([P.load("habit-heatmap", { inject }), P.load("habit-heatmap", { inject })]);
  assert.equal(a, true);
  assert.equal(b, true);
  assert.equal(await P.load("habit-heatmap", { inject }), true);
  assert.deepEqual(calls, [
    ["/static/plugins/habit-heatmap/style.css?v=abcd1234", "style"],
    ["/static/plugins/habit-heatmap/plugin.js?v=abcd1234", "script"],
  ]);
  assert.equal(P.contributions("dashboard.widgets").length, 1);
  assert.equal(P.list()[0].loaded, true);
});

test("tanpa style.css di index → hanya plugin.js", async () => {
  await P.setEnabled("plain-plugin", true);
  const calls = [];
  const ok = await P.load("plain-plugin", { inject: scriptInject(Object.assign({}, MANIFEST, { id: "plain-plugin", permissions: [] }), calls) });
  assert.equal(ok, true);
  assert.deepEqual(calls, [["/static/plugins/plain-plugin/plugin.js?v=99998888", "script"]]);
});

test("plugin OFF → load tidak menyuntik apa pun", async () => {
  const calls = [];
  assert.equal(await P.load("plain-plugin", { inject: scriptInject(MANIFEST, calls) }), false);
  assert.deepEqual(calls, []);
  assert.equal(await P.load("tidak-ada", { inject: scriptInject(MANIFEST, calls) }), false);
  assert.deepEqual(calls, []);
});

test("timeout → failed:'load', status tetap ON, tidak dicoba lagi di sesi ini", async () => {
  const calls = [];
  const inject = (url, kind) => { calls.push(kind); return Promise.resolve(); };
  const ok = await P.load("habit-heatmap", { inject, timeoutMs: 20 });
  assert.equal(ok, false);
  const row = P.list()[0];
  assert.equal(row.failed, "load");
  assert.equal(row.enabled, true);
  assert.equal(P.failures("habit-heatmap")[0].kind, "load");
  assert.equal(await P.load("habit-heatmap", { inject, timeoutMs: 20 }), false);
  assert.equal(calls.filter((k) => k === "script").length, 1);
});

test("inject menolak (unduhan gagal) → failed:'load'", async () => {
  const ok = await P.load("habit-heatmap", { inject: (u, k) => (k === "script" ? Promise.reject(new Error("404")) : Promise.resolve()), timeoutMs: 1000 });
  assert.equal(ok, false);
  assert.equal(P.list()[0].failed, "load");
  assert.equal(P.isEnabled("habit-heatmap"), true);
});

test("manifest invalid saat dimuat → otomatis OFF (tersimpan), failed:'manifest'", async () => {
  const toasts = [];
  P.bindHost({ toast: (m, t) => toasts.push([m, t]) });
  const ok = await P.load("habit-heatmap", { inject: scriptInject(Object.assign({}, MANIFEST, { permissions: ["network"] }), []), timeoutMs: 1000 });
  assert.equal(ok, false);
  assert.equal(P.isEnabled("habit-heatmap"), false);
  assert.equal(P.list()[0].failed, "manifest");
  await new Promise((r) => setTimeout(r, 10));
  assert.equal((await metaGet("plugins:state:v1"))["habit-heatmap"].enabled, false);
  assert.equal(toasts.length, 1);
  assert.match(toasts[0][0], /^Plugin Heatmap Habit /);
  assert.match(toasts[0][0], /network/);
});

test("factory melempar saat dimuat → load false, langsung OFF (deterministik)", async () => {
  const inject = (url, kind) => {
    if (kind === "script") setTimeout(() => P.register(MANIFEST, () => { throw new Error("factory rusak"); }), 1);
    return Promise.resolve();
  };
  assert.equal(await P.load("habit-heatmap", { inject, timeoutMs: 1000 }), false);
  assert.equal(P.list()[0].failed, "factory");
  assert.equal(P.isEnabled("habit-heatmap"), false);
  assert.deepEqual(P.contributions("dashboard.widgets"), []);
});
