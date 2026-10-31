"use strict";
// Sistem plugin Fase 0b — TF.api.fetch (spec docs/superpowers/specs/2026-10-31-plugin-fase0b-design.md §6.4;
// rencana PR B Task 10): izin network, hanya /api/plugins/<id>/…, offline = "Butuh koneksi internet",
// pemetaan error host → PluginNetworkError (tidak dihitung markFailed), tunggu pushNow saat op tertunda.
const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const { deleteDB } = require("./setup.js");
const { DB_NAME, _reset: resetDB } = require("../../static/offline/db.js");
const PS = require("../../static/offline/pluginstate.js");
const RT = require("../../static/plugin-runtime.js");
const P = RT.plugins;
const { PluginNetworkError, PluginPermissionError } = RT.api;

const NET = "demo-server";
const PLAIN = "plain-plugin";
const INDEX = {
  v: 1,
  plugins: [
    { id: NET, name: "Demo", description: "d", version: "1.0.0", permissions: ["network"], defaultEnabled: true, files: ["plugin.js"], hash: "11112222" },
    { id: PLAIN, name: "Plain", description: "p", version: "1.0.0", permissions: [], defaultEnabled: true, files: ["plugin.js"], hash: "33334444" },
  ],
};
let calls, toasts, pushes, response;

function httpErr(status, body, message) {
  const e = new Error(message || "Request failed (" + status + ")");
  e.status = status;
  if (body) e.body = body;
  return e;
}
const isOfflineErr = (err) => !!err && (err.message === "OFFLINE" || err instanceof TypeError);

beforeEach(async () => {
  P._reset();
  resetDB();
  await deleteDB(DB_NAME);
  await P.init({ fetchIndex: () => Promise.resolve(INDEX) });
  calls = []; toasts = []; pushes = 0;
  response = () => Promise.resolve({ ok: true });
  P.bindHost({
    toast: (m, t) => toasts.push([m, t]),
    fetch: (p, o) => { calls.push([p, o]); return response(p, o); },
    isOfflineErr,
    pushNow: () => { pushes++; return Promise.resolve(); },
  });
});
afterEach(() => {
  try { delete globalThis.navigator.onLine; } catch (_) {}
});

test("TF.api mengekspor PluginNetworkError; api.for(id).fetch ada", () => {
  assert.equal(typeof PluginNetworkError, "function");
  assert.equal(typeof RT.api.for(NET).fetch, "function");
  const e = new PluginNetworkError("offline");
  assert.ok(e instanceof Error);
  assert.equal(e.code, "offline");
  assert.equal(e.message, "Butuh koneksi internet");
  assert.equal(e.name, "PluginNetworkError");
});

test("tanpa izin network → PluginPermissionError, dihitung gagal", async () => {
  await assert.rejects(RT.api.for(PLAIN).fetch("/api/plugins/plain-plugin/x"), PluginPermissionError);
  assert.equal(P.failures(PLAIN).length, 1);
  assert.equal(calls.length, 0);
});

test("path di luar /api/plugins/<id>/ → PluginPermissionError; path sah → host fetch dipanggil", async () => {
  const bad = [
    "/api/plugins/plain-plugin/items", "/api/plugins/demo-serverx/items", "/api/plugins/demo-server/../state",
    "/api/plugins/demo-server/a/../../state", "/api/plugins/demo-server/%2e%2e/state", "https://x", "//evil",
    "/api/tasks", "api/plugins/demo-server/items", "/api/plugins/demo-server//items", "/api/plugins/demo-server/a\\b",
    "/api/plugins/demo-server/a#b", "/api/plugins/demo-server/http://x", 42,
  ];
  for (const p of bad) {
    await assert.rejects(RT.api.for(NET).fetch(p), PluginPermissionError, String(p));
  }
  assert.equal(calls.length, 0);
  assert.equal(await RT.api.for(NET).fetch("/api/plugins/demo-server/items", { method: "post", body: { a: 1 } }).then(() => "ok"), "ok");
  assert.deepEqual(calls[0], ["/api/plugins/demo-server/items", { method: "POST", body: "{\"a\":1}" }]);
  await RT.api.for(NET).fetch("/api/plugins/demo-server");
  await RT.api.for(NET).fetch("/api/plugins/demo-server/items?x=1");
  assert.deepEqual(calls[1], ["/api/plugins/demo-server", { method: "GET" }]);
  assert.equal(calls.length, 3);
});

test("hasil host fetch diteruskan apa adanya", async () => {
  response = () => Promise.resolve({ items: [1, 2] });
  assert.deepEqual(await RT.api.for(NET).fetch("/api/plugins/demo-server/items"), { items: [1, 2] });
});

test("method TRACE / body > 256 KB / body tak terserialisasi → TypeError tanpa request", async () => {
  await assert.rejects(RT.api.for(NET).fetch("/api/plugins/demo-server/x", { method: "TRACE" }), TypeError);
  await assert.rejects(RT.api.for(NET).fetch("/api/plugins/demo-server/x", { method: "POST", body: { s: "a".repeat(256 * 1024) } }), TypeError);
  const cyc = {}; cyc.self = cyc;
  await assert.rejects(RT.api.for(NET).fetch("/api/plugins/demo-server/x", { method: "POST", body: cyc }), TypeError);
  assert.equal(calls.length, 0);
  assert.equal(P.failures(NET).length, 0);
});

test("navigator.onLine = false → PluginNetworkError offline tanpa request", async () => {
  Object.defineProperty(globalThis.navigator, "onLine", { value: false, configurable: true });
  await assert.rejects(RT.api.for(NET).fetch("/api/plugins/demo-server/items"),
    (e) => e instanceof PluginNetworkError && e.code === "offline" && e.message === "Butuh koneksi internet");
  assert.equal(calls.length, 0);
});

test("pemetaan error host → kode PluginNetworkError; tidak menambah failures / toast", async () => {
  const cases = [
    [() => httpErr(503, null, "OFFLINE"), "offline"],
    [() => new TypeError("Failed to fetch"), "offline"],
    [() => httpErr(401, null, "Unauthorized"), "auth"],
    [() => httpErr(403, { detail: { code: "PLUGIN_DISABLED", plugin_id: NET } }), "disabled"],
    [() => httpErr(503, { detail: { code: "PLUGIN_UNAVAILABLE", plugin_id: NET } }), "unavailable"],
    [() => new Error("Request timeout — coba lagi"), "timeout"],
    [() => httpErr(500, { detail: "boom" }), "http"],
    [() => httpErr(403, { detail: { code: "PLUGIN_FORBIDDEN_TOKEN" } }), "http"],
  ];
  for (const [mk, code] of cases) {
    response = () => Promise.reject(mk());
    await assert.rejects(RT.api.for(NET).fetch("/api/plugins/demo-server/items"), (e) => {
      assert.ok(e instanceof PluginNetworkError, code);
      assert.equal(e.code, code);
      return true;
    });
  }
  response = () => Promise.reject(httpErr(500, { detail: "boom" }));
  await assert.rejects(RT.api.for(NET).fetch("/api/plugins/demo-server/items"), (e) => e.status === 500 && e.detail === "boom");
  response = () => Promise.reject(httpErr(503, null, "OFFLINE"));
  await assert.rejects(RT.api.for(NET).fetch("/api/plugins/demo-server/items"), (e) => e.message === "Butuh koneksi internet");
  assert.equal(P.failures(NET).length, 0);
  assert.deepEqual(toasts, []);
  assert.equal(P.isEnabled(NET), true);
});

test("timeout runtime: host tak pernah selesai → timeout", async () => {
  response = () => new Promise(() => {});
  await assert.rejects(RT.api.for(NET).fetch("/api/plugins/demo-server/items", { timeoutMs: 20 }),
    (e) => e instanceof PluginNetworkError && e.code === "timeout");
  assert.equal(P.failures(NET).length, 0);
});

test("op plugin_state tertunda → pushNow dipanggil sebelum request; tanpa op → tidak", async () => {
  await RT.api.for(NET).fetch("/api/plugins/demo-server/items");
  assert.equal(pushes, 0);
  const order = [];
  P.bindHost({
    fetch: (p) => { order.push("fetch"); return Promise.resolve({}); },
    isOfflineErr,
    pushNow: () => { order.push("push"); return Promise.resolve(); },
  });
  await PS.setLocal(NET, { enabled: true });
  await RT.api.for(NET).fetch("/api/plugins/demo-server/items");
  assert.deepEqual(order, ["push", "fetch"]);
});

test("pushNow menggantung → request tetap jalan setelah batas tunggu", async () => {
  P._setPushWaitMs(20);
  let fetched = 0;
  P.bindHost({ fetch: () => { fetched++; return Promise.resolve({}); }, isOfflineErr, pushNow: () => new Promise(() => {}) });
  await PS.setLocal(NET, { enabled: true });
  const t0 = Date.now();
  await RT.api.for(NET).fetch("/api/plugins/demo-server/items");
  assert.equal(fetched, 1);
  assert.ok(Date.now() - t0 < 2000);
});
