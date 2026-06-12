"use strict";
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { deleteDB } = require("./setup.js");
const { DB_NAME, _reset } = require("../../static/offline/db.js");
const { buildTaskRouter } = require("../../static/offline/taskroutes.js");

beforeEach(async () => { _reset(); await deleteDB(DB_NAME); });

test("POST then GET list returns server-shaped metadata WITHOUT data_json", async () => {
  const R = buildTaskRouter();
  const created = await R.dispatch("POST", "/api/mindmaps", { title: "M1", data_json: "{\"nodeData\":{\"id\":\"root\"}}" });
  assert.equal(created.title, "M1");
  assert.equal(created.is_pinned, 0);
  assert.ok("data_json" in created); // POST returns full
  const list = await R.dispatch("GET", "/api/mindmaps", undefined);
  assert.equal(list.length, 1);
  assert.equal(list[0].title, "M1");
  assert.equal("data_json" in list[0], false); // list omits data_json
  assert.ok("is_pinned" in list[0] && "updated_at" in list[0]);
});

test("GET /:id returns full record including data_json", async () => {
  const R = buildTaskRouter();
  const m = await R.dispatch("POST", "/api/mindmaps", { title: "M", data_json: "{\"nodeData\":{\"id\":\"root\",\"topic\":\"hi\"}}" });
  const full = await R.dispatch("GET", "/api/mindmaps/" + m.id, undefined);
  assert.equal(full.title, "M");
  assert.match(full.data_json, /topic/);
});

test("PUT updates, PATCH /pin toggles is_pinned, DELETE removes from list", async () => {
  const R = buildTaskRouter();
  const m = await R.dispatch("POST", "/api/mindmaps", { title: "M", data_json: "{}" });
  await R.dispatch("PUT", "/api/mindmaps/" + m.id, { title: "M2", data_json: "{\"a\":1}" });
  const afterPut = await R.dispatch("GET", "/api/mindmaps/" + m.id, undefined);
  assert.equal(afterPut.title, "M2");
  assert.equal(afterPut.data_json, "{\"a\":1}");
  const pinned = await R.dispatch("PATCH", "/api/mindmaps/" + m.id + "/pin", undefined);
  assert.equal(pinned.is_pinned, 1);
  await R.dispatch("DELETE", "/api/mindmaps/" + m.id, undefined);
  assert.equal((await R.dispatch("GET", "/api/mindmaps", undefined)).length, 0);
});

test("list sorts pinned first then by updated_at desc", async () => {
  const R = buildTaskRouter();
  const a = await R.dispatch("POST", "/api/mindmaps", { title: "A", data_json: "{}" });
  const b = await R.dispatch("POST", "/api/mindmaps", { title: "B", data_json: "{}" });
  await R.dispatch("PATCH", "/api/mindmaps/" + a.id + "/pin", undefined); // pin A
  const list = await R.dispatch("GET", "/api/mindmaps", undefined);
  assert.equal(list[0].title, "A"); // pinned first
  assert.equal(list[0].is_pinned, 1);
});

test("share is NOT intercepted (stays network); list-scoped mindmaps IS intercepted", async () => {
  const R = buildTaskRouter();
  assert.equal(R.hasRoute("PATCH", "/api/mindmaps/5/share"), false);
  assert.equal(R.hasRoute("GET", "/api/lists/3/mindmaps"), true);
});
