"use strict";
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { deleteDB } = require("./setup.js");
const { DB_NAME, _reset, openDB } = require("../../static/offline/db.js");
const { outboxAll } = require("../../static/offline/outbox.js");
const TFrepo = require("../../static/offline/drawingrepo.js");
const { buildTaskRouter } = require("../../static/offline/taskroutes.js");

beforeEach(async () => { _reset(); await deleteDB(DB_NAME); });

test("createDrawing creates a local record, saves blob, sets dirty 1, enqueues create op", async () => {
  const rec = await TFrepo.createDrawing({
    title: "Diagram Arsitektur",
    data_json: '{"shapes":{"s1":{}}}',
    svg_preview: "<svg></svg>",
    tags: ["arsitektur"]
  }, { now: "2026-08-19T10:00:00Z" });

  assert.ok(rec.cid);
  assert.equal(rec.title, "Diagram Arsitektur");
  assert.equal(rec.is_pinned, 0);
  assert.equal(rec.dirty, 1);
  assert.equal(rec.deleted, false);
  assert.deepEqual(rec.tags, ["arsitektur"]);

  const ops = await outboxAll();
  assert.equal(ops.length, 1);
  assert.equal(ops[0].entity_type, "drawing");
  assert.equal(ops[0].op, "create");
  assert.equal(ops[0].cid, rec.cid);
});

test("getDrawing and listDrawings return enriched drawings", async () => {
  const d1 = await TFrepo.createDrawing({ title: "Drawing 1", data_json: '{"v":1}' }, { now: "2026-08-19T10:00:00Z" });
  const d2 = await TFrepo.createDrawing({ title: "Drawing 2", data_json: '{"v":2}' }, { now: "2026-08-19T11:00:00Z" });

  const list = await TFrepo.listDrawings();
  assert.equal(list.length, 2);
  assert.equal(list[0].title, "Drawing 2"); // newer first

  const detail = await TFrepo.getDrawing(d1.cid);
  assert.equal(detail.title, "Drawing 1");
  assert.equal(detail.data_json, '{"v":1}');
});

test("updateDrawing patches title/data_json/tags, dedupes update outbox op", async () => {
  const d = await TFrepo.createDrawing({ title: "Draft", data_json: '{"v":1}' }, { now: "2026-08-19T10:00:00Z" });
  await TFrepo.updateDrawing(d.cid, { title: "Draft Final", data_json: '{"v":2}' }, { now: "2026-08-19T10:30:00Z" });

  const updated = await TFrepo.getDrawing(d.cid);
  assert.equal(updated.title, "Draft Final");
  assert.equal(updated.data_json, '{"v":2}');

  const ops = await outboxAll();
  const updateOps = ops.filter(o => o.op === "update");
  assert.equal(updateOps.length, 1);
});

test("togglePin flips is_pinned and deleteDrawing soft deletes record", async () => {
  const d = await TFrepo.createDrawing({ title: "Pin Test" }, { now: "2026-08-19T10:00:00Z" });
  const pinRes = await TFrepo.togglePin(d.cid);
  assert.equal(pinRes.is_pinned, 1);

  const listPinned = await TFrepo.listDrawings();
  assert.equal(listPinned[0].is_pinned, 1);

  await TFrepo.deleteDrawing(d.cid);
  const listAfterDel = await TFrepo.listDrawings();
  assert.equal(listAfterDel.length, 0);
});

test("Router dispatches REST endpoints for drawings offline", async () => {
  const R = buildTaskRouter();
  const created = await R.dispatch("POST", "/api/drawings", {
    title: "Route Test",
    data_json: '{"hello":"world"}'
  });
  assert.ok(created.id);
  assert.equal(created.title, "Route Test");

  const list = await R.dispatch("GET", "/api/drawings", undefined);
  assert.equal(list.length, 1);

  const got = await R.dispatch("GET", `/api/drawings/${created.id}`, undefined);
  assert.equal(got.title, "Route Test");
  assert.equal(got.data_json, '{"hello":"world"}');

  const updated = await R.dispatch("PUT", `/api/drawings/${created.id}`, {
    title: "Route Test Updated"
  });
  assert.equal(updated.title, "Route Test Updated");

  const pinned = await R.dispatch("PATCH", `/api/drawings/${created.id}/pin`, undefined);
  assert.equal(pinned.is_pinned, 1);

  const deleted = await R.dispatch("DELETE", `/api/drawings/${created.id}`, undefined);
  assert.equal(deleted.ok, true);
});
