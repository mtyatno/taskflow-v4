"use strict";
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { deleteDB } = require("./setup.js");
const { DB_NAME, _reset, openDB } = require("../../static/offline/db.js");
const { cidOf } = require("../../static/offline/idmap.js");
const { outboxAll } = require("../../static/offline/outbox.js");
const {
  cacheMessages, getMessages, sendMessage, upsertIncoming, setCurrentUser, getCurrentUser,
} = require("../../static/offline/chatrepo.js");

beforeEach(async () => { _reset(); await deleteDB(DB_NAME); setCurrentUser(null); });

async function put(store, recs) {
  const db = await openDB();
  await new Promise((res, rej) => {
    const tx = db.transaction(store, "readwrite");
    const os = tx.objectStore(store);
    for (const r of recs) os.put(r);
    tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error);
  });
}
function srv(over) {
  return Object.assign({
    id: over.id, list_id: 7, user_id: 2, content: "hi", task_id: null, note_id: null,
    msg_type: "text", created_at: over.created_at || "2026-06-11T00:00:00", reply_to_id: null,
    client_id: over.client_id != null ? over.client_id : null,
    username: "bob", display_name: "Bob",
  }, over);
}

test("cacheMessages inserts new server messages with cid + idmap, no data_json", async () => {
  await cacheMessages([srv({ id: 10, content: "a" }), srv({ id: 11, content: "b", created_at: "2026-06-11T00:01:00" })]);
  const list = await getMessages(7, {});
  assert.equal(list.length, 2);
  assert.deepEqual(list.map((m) => m.content), ["a", "b"]); // ascending by created_at
  assert.equal(list[0].id, 10);
  assert.ok(await cidOf("message", 10));
});

test("cacheMessages dedups by server_id (idempotent)", async () => {
  await cacheMessages([srv({ id: 10, content: "a" })]);
  await cacheMessages([srv({ id: 10, content: "a" })]);
  assert.equal((await getMessages(7, {})).length, 1);
});

test("cacheMessages confirms an optimistic message by client_id (no duplicate)", async () => {
  setCurrentUser({ user_id: 2, username: "me", display_name: "Me" });
  const opt = await sendMessage(7, { content: "hello" }, getCurrentUser(), { now: "2026-06-11T00:00:00", cid: "c-1" });
  assert.equal(opt.pending, 1);
  assert.equal(opt.id, "c-1"); // optimistic id = cid
  await cacheMessages([srv({ id: 50, content: "hello", client_id: "c-1", user_id: 2 })]);
  const list = await getMessages(7, {});
  assert.equal(list.length, 1); // same logical message, not duplicated
  assert.equal(list[0].id, 50);
  assert.equal(list[0].pending, 0);
});

test("getMessages applies before_id pagination + limit, returns ascending", async () => {
  await cacheMessages([
    srv({ id: 1, content: "m1", created_at: "2026-06-11T00:00:01" }),
    srv({ id: 2, content: "m2", created_at: "2026-06-11T00:00:02" }),
    srv({ id: 3, content: "m3", created_at: "2026-06-11T00:00:03" }),
  ]);
  const older = await getMessages(7, { before_id: 3 });
  assert.deepEqual(older.map((m) => m.content), ["m1", "m2"]);
  const limited = await getMessages(7, { limit: 1 });
  assert.deepEqual(limited.map((m) => m.content), ["m3"]); // newest-last, last `limit`
});

test("sendMessage writes optimistic pending record + send op + local enrichment", async () => {
  setCurrentUser({ user_id: 9, username: "me", display_name: "Me" });
  await put("tasks", [{ cid: "tk", server_id: 100, title: "Fix bug", priority: "P1", deadline: "2026-06-12", quadrant: "Q1", gtd_status: "next" }]);
  const out = await sendMessage(7, { content: "see this", task_id: 100, msg_type: "task_attach" }, getCurrentUser(), { now: "2026-06-11T03:00:00", cid: "c-9" });
  assert.equal(out.pending, 1);
  assert.equal(out.user_id, 9);
  assert.equal(out.username, "me");
  assert.equal(out.task_title, "Fix bug");
  assert.equal(out.task_status, "next"); // gtd_status -> task_status
  const ops = await outboxAll();
  assert.equal(ops.length, 1);
  assert.equal(ops[0].entity_type, "message");
  assert.equal(ops[0].op, "send");
  assert.equal(ops[0].cid, "c-9");
});

test("upsertIncoming caches a single SSE message", async () => {
  await upsertIncoming(srv({ id: 77, content: "live" }));
  const list = await getMessages(7, {});
  assert.equal(list.length, 1);
  assert.equal(list[0].id, 77);
});

test("getMessages collapses duplicate rows sharing a server_id (concurrent-write safety net)", async () => {
  // Two local rows (distinct cids) for the same server message — what a concurrent
  // cacheMessages + upsertIncoming race could leave behind.
  await put("chat_messages", [
    { cid: "dupA", server_id: 88, list_id: 7, user_id: 2, content: "once", msg_type: "text", created_at: "2026-06-11T00:00:00", pending: 0 },
    { cid: "dupB", server_id: 88, list_id: 7, user_id: 2, content: "once", msg_type: "text", created_at: "2026-06-11T00:00:00", pending: 0 },
  ]);
  const list = await getMessages(7, {});
  assert.equal(list.length, 1);
  assert.equal(list[0].id, 88);
});
