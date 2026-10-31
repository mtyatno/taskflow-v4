"use strict";
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { deleteDB } = require("./setup.js");
const { DB_NAME, _reset } = require("../../static/offline/db.js");
const { metaGet, metaSet, metaDel, metaKeys } = require("../../static/offline/meta.js");

beforeEach(async () => { _reset(); await deleteDB(DB_NAME); });

test("metaGet returns undefined for missing key", async () => {
  assert.equal(await metaGet("nope"), undefined);
});

test("metaSet then metaGet round-trips a value", async () => {
  await metaSet("schema_version", 2);
  assert.equal(await metaGet("schema_version"), 2);
});

test("metaSet overwrites", async () => {
  await metaSet("cursor:tasks", "2026-01-01");
  await metaSet("cursor:tasks", "2026-02-02");
  assert.equal(await metaGet("cursor:tasks"), "2026-02-02");
});

test("metaDel menghapus kunci", async () => {
  await metaSet("a", 1);
  await metaDel("a");
  assert.equal(await metaGet("a"), undefined);
});

test("metaKeys hanya mengembalikan kunci berawalan prefix", async () => {
  await metaSet("plugin:a:x", 1);
  await metaSet("plugin:a:y", 2);
  await metaSet("plugin:ab:z", 3);
  await metaSet("cursor:tasks", "t");
  assert.deepEqual(await metaKeys("plugin:a:"), ["plugin:a:x", "plugin:a:y"]);
});
