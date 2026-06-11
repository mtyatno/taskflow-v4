"use strict";
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { deleteDB } = require("./setup.js");
const { DB_NAME, _reset, openDB } = require("../../static/offline/db.js");
const { serverIdOf, mapPut } = require("../../static/offline/idmap.js");
const { outboxAll } = require("../../static/offline/outbox.js");
const { pushOutbox } = require("../../static/offline/syncpush.js");

beforeEach(async () => { _reset(); await deleteDB(DB_NAME); });

async function put(store, recs) {
  const db = await openDB();
  await new Promise((res, rej) => {
    const tx = db.transaction(store, "readwrite");
    const os = tx.objectStore(store);
    for (const r of recs) os.put(r);
    tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error);
  });
}
async function getMsg(cid) {
  const db = await openDB();
  return new Promise((res) => { const q = db.transaction("chat_messages").objectStore("chat_messages").get(cid); q.onsuccess = () => res(q.result); });
}
function msg(over) {
  return Object.assign({
    cid: over.cid, server_id: null, list_id: 7, user_id: 1, content: "hi",
    task_id: null, note_id: null, msg_type: "text", reply_to_id: null,
    created_at: "2026-06-11T00:00:00", pending: 1,
  }, over);
}
function fakeTransport(handler) {
  const calls = [];
  return { calls, request(method, path, body) { calls.push({ method, path, body }); const h = handler(method, path, body); if (h === "NETWORK") return Promise.reject(new Error("net")); return Promise.resolve(h); } };
}

test("opChatSend POSTs with client_id, sets server_id + idmap + created_at, clears pending", async () => {
  await put("chat_messages", [msg({ cid: "c1", content: "yo" })]);
  await put("_outbox", [{ qid: 1, op: "send", entity_type: "message", cid: "c1", payload: {} }]);
  const tr = fakeTransport((m, p, b) => {
    assert.equal(p, "/api/lists/7/messages");
    assert.equal(b.client_id, "c1");
    assert.equal(b.content, "yo");
    return { status: 200, data: { id: 500, created_at: "2026-06-11T09:00:00" } };
  });
  const r = await pushOutbox(tr);
  assert.equal(r.pushed, 1);
  assert.equal(await serverIdOf("c1"), 500);
  const rec = await getMsg("c1");
  assert.equal(rec.server_id, 500);
  assert.equal(rec.pending, 0);
  assert.equal(rec.created_at, "2026-06-11T09:00:00");
  assert.equal((await outboxAll()).length, 0);
});

test("opChatSend holds when reply target (a cid) has no server id yet", async () => {
  await put("chat_messages", [msg({ cid: "c2", content: "reply", reply_to_id: "c-target" })]);
  await put("_outbox", [{ qid: 1, op: "send", entity_type: "message", cid: "c2", payload: {} }]);
  const tr = fakeTransport(() => { throw new Error("should not POST while held"); });
  const r = await pushOutbox(tr);
  assert.equal(r.pushed, 0);
  assert.equal((await outboxAll()).length, 1); // op retained for retry
});

test("opChatSend resolves a cid reply target via idmap to a server id", async () => {
  await mapPut("message", 300, "c-target");
  await put("chat_messages", [msg({ cid: "c3", content: "reply", reply_to_id: "c-target" })]);
  await put("_outbox", [{ qid: 1, op: "send", entity_type: "message", cid: "c3", payload: {} }]);
  const tr = fakeTransport((m, p, b) => { assert.equal(b.reply_to_id, 300); return { status: 200, data: { id: 501, created_at: "x" } }; });
  const r = await pushOutbox(tr);
  assert.equal(r.pushed, 1);
});

test("opChatSend on 403 drops the op and deletes the local optimistic record", async () => {
  await put("chat_messages", [msg({ cid: "c4" })]);
  await put("_outbox", [{ qid: 1, op: "send", entity_type: "message", cid: "c4", payload: {} }]);
  const tr = fakeTransport(() => ({ status: 403, data: { detail: "Not a member" } }));
  const r = await pushOutbox(tr);
  assert.equal((await outboxAll()).length, 0);
  assert.equal(await getMsg("c4"), undefined);
});

test("opChatSend retains the op on network error", async () => {
  await put("chat_messages", [msg({ cid: "c5" })]);
  await put("_outbox", [{ qid: 1, op: "send", entity_type: "message", cid: "c5", payload: {} }]);
  const tr = fakeTransport(() => "NETWORK");
  await pushOutbox(tr);
  assert.equal((await outboxAll()).length, 1);
});
