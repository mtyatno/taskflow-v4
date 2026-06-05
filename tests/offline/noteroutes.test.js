"use strict";
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { deleteDB } = require("./setup.js");
const { DB_NAME, _reset, openDB } = require("../../static/offline/db.js");
const { buildTaskRouter } = require("../../static/offline/taskroutes.js");

beforeEach(async () => { _reset(); await deleteDB(DB_NAME); });

test("POST then GET /api/scratchpad round-trips a local note", async () => {
  const R = buildTaskRouter();
  const created = await R.dispatch("POST", "/api/scratchpad", { title: "Hello", content: "world", tags: ["x"] });
  assert.equal(created.title, "Hello");
  const list = await R.dispatch("GET", "/api/scratchpad", undefined);
  assert.equal(list.length, 1);
  assert.equal(list[0].title, "Hello");
  assert.deepEqual(list[0].tags, ["x"]);
});

test("GET /api/scratchpad/:id, PUT, pin, DELETE, backlinks via router", async () => {
  const R = buildTaskRouter();
  const a = await R.dispatch("POST", "/api/scratchpad", { title: "A", content: "", tags: [] });
  await R.dispatch("POST", "/api/scratchpad", { title: "B", content: "[[A]]", tags: [] });
  const got = await R.dispatch("GET", "/api/scratchpad/" + a.id, undefined);
  assert.equal(got.title, "A");
  await R.dispatch("PUT", "/api/scratchpad/" + a.id, { title: "A2", content: "", tags: [] });
  assert.equal((await R.dispatch("GET", "/api/scratchpad/" + a.id, undefined)).title, "A2");
  const pinned = await R.dispatch("PATCH", "/api/scratchpad/" + a.id + "/pin", undefined);
  assert.equal(pinned.pinned, true);
  const back = await R.dispatch("GET", "/api/scratchpad/" + a.id + "/backlinks", undefined);
  assert.deepEqual(back.map((n) => n.title), ["B"]);
  await R.dispatch("DELETE", "/api/scratchpad/" + a.id, undefined);
  assert.equal((await R.dispatch("GET", "/api/scratchpad", undefined)).length, 1); // only B remains
});

test("GET /api/scratchpad/titles + /recent are registered (win over /:id by specificity)", async () => {
  const R = buildTaskRouter();
  await R.dispatch("POST", "/api/scratchpad", { title: "T1", content: "", tags: [] });
  assert.equal((await R.dispatch("GET", "/api/scratchpad/titles", undefined)).length, 1);
  assert.equal((await R.dispatch("GET", "/api/scratchpad/recent", undefined)).length, 1);
});

test("PATCH /api/scratchpad/:id/share is NOT registered (stays network)", async () => {
  const R = buildTaskRouter();
  assert.equal(R.hasRoute("PATCH", "/api/scratchpad/5/share"), false);
});
