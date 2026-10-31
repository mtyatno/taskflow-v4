"use strict";
// Sistem plugin Fase 0a — TF.api.storage: KV per plugin di _meta `plugin:<id>:<key>` (spec §4.7, §9).
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { deleteDB } = require("./setup.js");
const { DB_NAME, _reset: resetDB } = require("../../static/offline/db.js");
const { metaGet, metaSet } = require("../../static/offline/meta.js");
const RT = require("../../static/plugin-runtime.js");
const P = RT.plugins;

const INDEX = {
  v: 1,
  plugins: [
    { id: "plug-a", name: "A", version: "1.0.0", permissions: ["storage"], defaultEnabled: true, files: ["plugin.js"], hash: "1" },
    { id: "plug-ab", name: "AB", version: "1.0.0", permissions: ["storage"], defaultEnabled: true, files: ["plugin.js"], hash: "2" },
    { id: "no-storage", name: "NS", version: "1.0.0", permissions: [], defaultEnabled: true, files: ["plugin.js"], hash: "3" },
  ],
};

beforeEach(async () => {
  P._reset();
  resetDB();
  await deleteDB(DB_NAME);
  await P.init({ fetchIndex: () => Promise.resolve(INDEX) });
});

test("set/get/remove/keys memakai prefiks plugin:<id>:", async () => {
  const s = RT.api.for("plug-a").storage;
  assert.equal(await s.get("metric"), null);
  await s.set("metric", "habit");
  await s.set("obj", { a: [1, 2], b: "x" });
  assert.equal(await metaGet("plugin:plug-a:metric"), "habit");
  assert.equal(await s.get("metric"), "habit");
  assert.deepEqual(await s.get("obj"), { a: [1, 2], b: "x" });
  assert.deepEqual(await s.keys(), ["metric", "obj"]);
  await s.remove("metric");
  assert.equal(await s.get("metric"), null);
  assert.equal(await metaGet("plugin:plug-a:metric"), undefined);
  assert.deepEqual(await s.keys(), ["obj"]);
});

test("isolasi antar plugin dan dari _meta host", async () => {
  await metaSet("plugins:state:v1", { secret: true });
  await metaSet("cursor:tasks", "2026-01-01");
  const a = RT.api.for("plug-a").storage;
  const ab = RT.api.for("plug-ab").storage;
  await a.set("k", 1);
  await ab.set("k", 2);
  assert.equal(await a.get("k"), 1);
  assert.equal(await ab.get("k"), 2);
  assert.deepEqual(await a.keys(), ["k"]);
  assert.deepEqual(await ab.keys(), ["k"]);
  // kunci tidak bisa keluar dari ruang plugin
  await assert.rejects(a.get(""), TypeError);
  await assert.rejects(a.set(42, 1), TypeError);
});

test("nilai > 64 KB ditolak PluginStorageError; tepat 64 KB diterima", async () => {
  const s = RT.api.for("plug-a").storage;
  const ok = "x".repeat(65536 - 2); // JSON string menambah 2 tanda kutip
  await s.set("ok", ok);
  await assert.rejects(s.set("big", ok + "x"), (e) => e.name === "PluginStorageError" && e instanceof RT.api.PluginStorageError);
  // multibyte dihitung dalam byte UTF-8
  await assert.rejects(s.set("mb", "é".repeat(40000)), (e) => e.name === "PluginStorageError");
  await assert.rejects(s.set("undef", undefined), (e) => e.name === "PluginStorageError");
  assert.equal(await s.get("big"), null);
});

test("tanpa izin storage → PluginPermissionError, dihitung sebagai error", async () => {
  const s = RT.api.for("no-storage").storage;
  await assert.rejects(s.get("k"), (e) => e.name === "PluginPermissionError");
  assert.equal(P.failures("no-storage")[0].kind, "permission");
});
