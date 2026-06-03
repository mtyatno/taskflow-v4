"use strict";
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { deleteDB } = require("./setup.js");
const { DB_NAME, _reset } = require("../../static/offline/db.js");
const { metaGet, metaSet } = require("../../static/offline/meta.js");

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
