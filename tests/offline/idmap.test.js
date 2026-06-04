"use strict";
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { deleteDB } = require("./setup.js");
const { DB_NAME, _reset } = require("../../static/offline/db.js");
const { mapPut, cidOf, serverIdOf, mapDelete } = require("../../static/offline/idmap.js");

beforeEach(async () => { _reset(); await deleteDB(DB_NAME); });

test("cidOf returns undefined when unmapped", async () => {
  assert.equal(await cidOf("task", 1), undefined);
});

test("mapPut then cidOf resolves forward", async () => {
  await mapPut("task", 142, "cid-abc");
  assert.equal(await cidOf("task", 142), "cid-abc");
});

test("serverIdOf resolves reverse", async () => {
  await mapPut("note", 9, "cid-note");
  assert.equal(await serverIdOf("cid-note"), 9);
});

test("same server_id across different entity types does not collide", async () => {
  await mapPut("task", 1, "cid-task-1");
  await mapPut("note", 1, "cid-note-1");
  assert.equal(await cidOf("task", 1), "cid-task-1");
  assert.equal(await cidOf("note", 1), "cid-note-1");
});

test("mapDelete removes a mapping (cidOf and serverIdOf become undefined)", async () => {
  await mapPut("task", 42, "cid-42");
  assert.equal(await cidOf("task", 42), "cid-42");
  await mapDelete("task", 42);
  assert.equal(await cidOf("task", 42), undefined);
  assert.equal(await serverIdOf("cid-42"), undefined);
});
