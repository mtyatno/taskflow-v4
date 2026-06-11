"use strict";
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { deleteDB } = require("./setup.js");
const { DB_NAME, _reset } = require("../../static/offline/db.js");
const { buildTaskRouter } = require("../../static/offline/taskroutes.js");
const chatrepo = require("../../static/offline/chatrepo.js");
const { outboxAll } = require("../../static/offline/outbox.js");

beforeEach(async () => {
  _reset(); await deleteDB(DB_NAME);
  chatrepo.setCurrentUser({ user_id: 1, username: "me", display_name: "Me" });
  chatrepo.configureFetcher(null);
});

test("POST /api/lists/:id/messages returns optimistic record + enqueues send op", async () => {
  const R = buildTaskRouter();
  const out = await R.dispatch("POST", "/api/lists/7/messages", { content: "hi" });
  assert.equal(out.pending, 1);
  assert.equal(out.content, "hi");
  assert.equal(out.username, "me");
  const ops = await outboxAll();
  assert.equal(ops.length, 1);
  assert.equal(ops[0].entity_type, "message");
});

test("GET offline returns local cache (paginated)", async () => {
  await chatrepo.cacheMessages([
    { id: 1, list_id: 7, user_id: 2, content: "a", msg_type: "text", created_at: "2026-06-11T00:00:01", username: "bob" },
    { id: 2, list_id: 7, user_id: 2, content: "b", msg_type: "text", created_at: "2026-06-11T00:00:02", username: "bob" },
  ]);
  const R = buildTaskRouter();
  const list = await R.dispatch("GET", "/api/lists/7/messages", undefined);
  assert.deepEqual(list.map((m) => m.content), ["a", "b"]);
});

test("GET online calls the fetcher, caches, and returns server data", async () => {
  let calledUrl = null;
  chatrepo.configureFetcher((url) => {
    calledUrl = url;
    return Promise.resolve([{ id: 9, list_id: 7, user_id: 2, content: "fromServer", msg_type: "text", created_at: "2026-06-11T00:00:05", username: "bob" }]);
  });
  const R = buildTaskRouter();
  const list = await R.dispatch("GET", "/api/lists/7/messages?limit=50", { limit: "50" });
  assert.equal(calledUrl, "/api/lists/7/messages?limit=50");
  assert.equal(list.length, 1);
  assert.equal(list[0].content, "fromServer");
  const cached = await chatrepo.getMessages(7, {});
  assert.equal(cached.length, 1);
});

test("SSE stream route is NOT intercepted", () => {
  const R = buildTaskRouter();
  assert.equal(R.hasRoute("GET", "/api/lists/7/messages/stream"), false);
});
