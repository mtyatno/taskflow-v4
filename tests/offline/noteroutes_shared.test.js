"use strict";
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { deleteDB } = require("./setup.js");
const { DB_NAME, _reset } = require("../../static/offline/db.js");
const { buildTaskRouter } = require("../../static/offline/taskroutes.js");
const { createNote } = require("../../static/offline/noterepo.js");

beforeEach(async () => { _reset(); await deleteDB(DB_NAME); });

test("GET /api/lists/:id/notes returns that list's local notes shaped {id,title,updated_at}", async () => {
  const R = buildTaskRouter();
  await createNote({ title: "InList", content: "", list_id: 9 }, {});
  await createNote({ title: "Other", content: "", list_id: 4 }, {});
  await createNote({ title: "Personal", content: "" }, {});
  const list = await R.dispatch("GET", "/api/lists/9/notes", undefined);
  assert.equal(list.length, 1);
  assert.equal(list[0].title, "InList");
  assert.deepEqual(Object.keys(list[0]).sort(), ["id", "title", "updated_at"]);
});

test("PATCH /api/scratchpad/:id/share is NOT intercepted (stays network)", () => {
  const R = buildTaskRouter();
  assert.equal(R.hasRoute("PATCH", "/api/scratchpad/5/share"), false);
});
