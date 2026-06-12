"use strict";
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { deleteDB } = require("./setup.js");
const { DB_NAME, _reset, openDB } = require("../../static/offline/db.js");
const { serverIdOf, mapPut } = require("../../static/offline/idmap.js");
const { outboxAll } = require("../../static/offline/outbox.js");
const { noteToCreatePayload, pushOutbox } = require("../../static/offline/syncpush.js");

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
async function getNote(cid) {
  const db = await openDB();
  return new Promise((res) => { const q = db.transaction("scratchpad_notes").objectStore("scratchpad_notes").get(cid); q.onsuccess = () => res(q.result); });
}
function note(over) {
  return Object.assign({
    cid: over.cid, server_id: over.server_id != null ? over.server_id : null, title: "N", content: "c",
    linked_task_cids: "[]", linked_to_cids: "[]", pinned: false,
    list_id: over.list_id != null ? over.list_id : null, user_id: null, last_edited_by: null,
    created_at: "x", updated_at: "2026-06-12T00:00:00", deleted: false, dirty: 1, base_rev: null,
  }, over);
}
function fakeTransport(handler) {
  const calls = [];
  return { calls, request(method, path, body) { calls.push({ method, path, body }); const h = handler(method, path, body); if (h === "NETWORK") return Promise.reject(new Error("net")); return Promise.resolve(h); } };
}

test("noteToCreatePayload sends the real list_id", () => {
  const p = noteToCreatePayload(note({ cid: "n", list_id: 9 }), [], []);
  assert.equal(p.list_id, 9);
});

test("shared update 404 sets conflict=remote_deleted (no re-create)", async () => {
  await put("scratchpad_notes", [note({ cid: "n", server_id: 7, list_id: 9 })]);
  await mapPut("note", 7, "n");
  await put("_outbox", [{ qid: 1, op: "update", entity_type: "note", cid: "n", payload: {} }]);
  const tr = fakeTransport((m) => { assert.notEqual(m, "POST"); return { status: 404, data: { detail: "gone" } }; });
  await pushOutbox(tr);
  const rec = await getNote("n");
  assert.equal(rec.conflict, "remote_deleted");
  assert.equal(rec.server_id, 7); // not re-created
});

test("personal update 404 still re-creates (regression guard)", async () => {
  await put("scratchpad_notes", [note({ cid: "n", server_id: 7, list_id: null })]);
  await mapPut("note", 7, "n");
  await put("_outbox", [{ qid: 1, op: "update", entity_type: "note", cid: "n", payload: {} }]);
  let n = 0;
  const tr = fakeTransport(() => (n++ === 0 ? { status: 404, data: {} } : { status: 200, data: { id: 99, updated_at: "x" } }));
  await pushOutbox(tr);
  assert.equal(await serverIdOf("n"), 99);
});

test("shared create 403 (lost membership) drops op + deletes local + idmap", async () => {
  await put("scratchpad_notes", [note({ cid: "n", server_id: null, list_id: 9 })]);
  await put("_outbox", [{ qid: 1, op: "create", entity_type: "note", cid: "n", payload: {} }]);
  const tr = fakeTransport(() => ({ status: 403, data: { detail: "Not a member" } }));
  await pushOutbox(tr);
  assert.equal((await outboxAll()).length, 0);
  assert.equal(await getNote("n"), undefined);
});

test("member delete 403 reverts the tombstone + records a notice", async () => {
  await put("scratchpad_notes", [note({ cid: "n", server_id: 7, list_id: 9, deleted: true, title: "Shared" })]);
  await mapPut("note", 7, "n");
  await put("_outbox", [{ qid: 1, op: "delete", entity_type: "note", cid: "n", payload: {} }]);
  const tr = fakeTransport(() => ({ status: 403, data: { detail: "Hanya pemilik" } }));
  await pushOutbox(tr);
  const rec = await getNote("n");
  assert.equal(rec.deleted, false);
  assert.equal(rec.dirty, 0);
  assert.equal(rec.notice.kind, "delete_refused");
  assert.equal((await outboxAll()).length, 0);
});

test("a note already flagged conflict is not re-pushed (guard, no network call)", async () => {
  await put("scratchpad_notes", [note({ cid: "n", server_id: 7, list_id: 9, conflict: "remote_deleted" })]);
  await mapPut("note", 7, "n");
  await put("_outbox", [{ qid: 1, op: "update", entity_type: "note", cid: "n", payload: {} }]);
  const tr = fakeTransport(() => { throw new Error("should not hit the network for a conflicted note"); });
  await pushOutbox(tr);
  assert.equal((await outboxAll()).length, 0); // op dropped, no PUT issued
});
