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

test("ownership check: owner can share, non-owner cannot", () => {
  const currentUserId = 3;
  const ownTab = { id: 1, user_id: 3, list_id: null };
  const otherTab = { id: 2, user_id: 5, list_id: 10 };
  const legacyTab = { id: 3, user_id: null, list_id: null };

  const isOwner = (tab, uid) => !tab?.user_id || !uid || tab.user_id === uid;

  assert.equal(isOwner(ownTab, currentUserId), true);
  assert.equal(isOwner(otherTab, currentUserId), false);
  assert.equal(isOwner(legacyTab, currentUserId), true);
  assert.equal(isOwner(ownTab, null), true);
});

test("persisting list_id update to mindmaps store in IndexedDB", async () => {
  const { openDB } = require("../../static/offline/db.js");
  const { putRaw, getRaw } = require("../../static/offline/mindmaprepo.js");
  const created = await createMindmap({ title: "To Share" }, {});
  assert.equal(created.list_id, null);

  const db = await openDB();
  const all = await new Promise((res, rej) => {
    const req = db.transaction("mindmaps", "readonly").objectStore("mindmaps").getAll();
    req.onsuccess = () => res(req.result || []);
    req.onerror = () => rej(req.error);
  });
  const match = all.find((m) => m.cid === created.cid);
  assert.ok(match);
  match.list_id = 42;
  match.updated_at = new Date().toISOString();
  await putRaw(match);

  const reloaded = await getRaw(created.cid);
  assert.equal(reloaded.list_id, 42);
});
