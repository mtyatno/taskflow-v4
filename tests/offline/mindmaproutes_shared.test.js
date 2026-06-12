"use strict";
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { deleteDB } = require("./setup.js");
const { DB_NAME, _reset } = require("../../static/offline/db.js");
const { buildTaskRouter } = require("../../static/offline/taskroutes.js");
const { createMindmap, setCurrentUser } = require("../../static/offline/mindmaprepo.js");

beforeEach(async () => { _reset(); await deleteDB(DB_NAME); setCurrentUser({ user_id: 3 }); });

test("GET /api/mindmaps includes shared mindmaps and exposes collaborator fields", async () => {
  const R = buildTaskRouter();
  await createMindmap({ title: "Personal" }, {});
  await createMindmap({ title: "Shared", list_id: 9 }, {});
  const list = await R.dispatch("GET", "/api/mindmaps", undefined);
  assert.deepEqual(list.map((m) => m.title).sort(), ["Personal", "Shared"]);
  const shared = list.find((m) => m.title === "Shared");
  assert.equal(shared.list_id, 9);
  assert.equal(shared.user_id, 3);
  assert.ok("last_edited_by" in shared);
});

test("GET /api/lists/:id/mindmaps returns that list's local mindmaps shaped {id,title,updated_at}", async () => {
  const R = buildTaskRouter();
  await createMindmap({ title: "InList", list_id: 9 }, {});
  await createMindmap({ title: "Other", list_id: 4 }, {});
  const list = await R.dispatch("GET", "/api/lists/9/mindmaps", undefined);
  assert.equal(list.length, 1);
  assert.equal(list[0].title, "InList");
  assert.deepEqual(Object.keys(list[0]).sort(), ["id", "title", "updated_at"]);
});

test("PATCH /api/mindmaps/:id/share is NOT intercepted", () => {
  const R = buildTaskRouter();
  assert.equal(R.hasRoute("PATCH", "/api/mindmaps/5/share"), false);
});
