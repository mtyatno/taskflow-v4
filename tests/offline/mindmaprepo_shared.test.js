"use strict";
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { deleteDB } = require("./setup.js");
const { DB_NAME, _reset, openDB } = require("../../static/offline/db.js");
const { createMindmap, updateMindmap, getRaw, setCurrentUser } = require("../../static/offline/mindmaprepo.js");

beforeEach(async () => { _reset(); await deleteDB(DB_NAME); setCurrentUser(null); });

test("createMindmap stores list_id + stamps owner/last_edited_by from current user", async () => {
  setCurrentUser({ user_id: 5, username: "me", display_name: "Me" });
  const rec = await createMindmap({ title: "Shared", list_id: 9 }, {});
  assert.equal(rec.list_id, 9);
  assert.equal(rec.user_id, 5);
  assert.equal(rec.last_edited_by, 5);
});

test("createMindmap defaults list_id null when omitted", async () => {
  setCurrentUser({ user_id: 5 });
  const rec = await createMindmap({ title: "Personal" }, {});
  assert.equal(rec.list_id, null);
});

test("updateMindmap stamps last_edited_by + clears stale last_editor_*", async () => {
  setCurrentUser({ user_id: 5 });
  const rec = await createMindmap({ title: "A", list_id: 9 }, {});
  const db = await openDB();
  await new Promise((res) => { const tx = db.transaction("mindmaps", "readwrite"); tx.objectStore("mindmaps").put(Object.assign({}, rec, { last_editor_username: "bob", last_editor_display_name: "Bob" })); tx.oncomplete = res; });
  setCurrentUser({ user_id: 7 });
  await updateMindmap(rec.cid, { data_json: "{\"x\":1}" }, {});
  const raw = await getRaw(rec.cid);
  assert.equal(raw.last_edited_by, 7);
  assert.equal(raw.last_editor_username, null);
  assert.equal(raw.last_editor_display_name, null);
});
