"use strict";
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { deleteDB } = require("./setup.js");
const { DB_NAME, _reset, openDB } = require("../../static/offline/db.js");
const { serverIdOf, mapPut, cidOf } = require("../../static/offline/idmap.js");
const { setEntityTags } = require("../../static/offline/tagrepo.js");
const { outboxAll } = require("../../static/offline/outbox.js");
const {
  noteToCreatePayload, noteToUpdatePayload, healStrandedNotes, pushOutbox,
} = require("../../static/offline/syncpush.js");

beforeEach(async () => { _reset(); await deleteDB(DB_NAME); });

async function put(store, recs) {
  const db = await openDB();
  await new Promise((res, rej) => {
    const tx = db.transaction(store, "readwrite");
    const os = tx.objectStore(store);
    for (const r of recs) os.put(r);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}

function note(over) {
  return Object.assign({
    cid: over.cid, server_id: null, title: over.cid, content: "",
    linked_task_cids: "[]", linked_to_cids: "[]", pinned: false, list_id: null,
    created_at: null, updated_at: null, deleted: false, dirty: 1, base_rev: null,
  }, over);
}

function fakeTransport(handler) {
  const calls = [];
  return {
    calls,
    request(method, path, body) {
      calls.push({ method, path, body });
      const h = handler(method, path, body);
      if (h === "NETWORK") return Promise.reject(new Error("net"));
      return Promise.resolve(h);
    },
  };
}

// Test 1: noteToCreatePayload includes client_id: record.cid
test("Test 1: noteToCreatePayload includes client_id: record.cid", () => {
  const rec = note({ cid: "note-cid-123", title: "Catatan Baru", content: "Isi catatan" });
  const p = noteToCreatePayload(rec, ["tag-a", "tag-b"], [10, 20]);
  assert.equal(p.client_id, "note-cid-123");
  assert.equal(p.title, "Catatan Baru");
  assert.equal(p.content, "Isi catatan");
  assert.deepEqual(p.tags, ["tag-a", "tag-b"]);
  assert.deepEqual(p.linked_task_ids, [10, 20]);

  // Fallback when cid is falsy / empty
  const recNoCid = note({ cid: "", title: "No CID" });
  const pNoCid = noteToCreatePayload(recNoCid, [], []);
  assert.equal(pNoCid.client_id, null);
});

// Test 2: pushOutbox on 500 / 503 error treats response as network/server error, does NOT discard outbox op, and preserves it for next sync
test("Test 2: pushOutbox on 500 / 503 error treats response as network/server error, preserves outbox op for next sync", async () => {
  await put("scratchpad_notes", [note({ cid: "note-500", title: "Catatan Error 500" })]);
  await put("_outbox", [{ qid: 1, op: "create", entity_type: "note", cid: "note-500", payload: {} }]);

  // Simulate 503 Service Unavailable on first push
  const tr503 = fakeTransport(() => ({ status: 503, data: { detail: "Service Temporarily Unavailable" } }));
  const r1 = await pushOutbox(tr503);
  assert.equal(r1.pushed, 0);
  assert.equal(r1.remaining, 1);

  // Verify outbox op is still preserved in DB
  const opsAfter503 = await outboxAll();
  assert.equal(opsAfter503.length, 1);
  assert.equal(opsAfter503[0].cid, "note-500");

  // Simulate 500 Internal Server Error
  const tr500 = fakeTransport(() => ({ status: 500, data: { detail: "Internal Server Error" } }));
  const r2 = await pushOutbox(tr500);
  assert.equal(r2.pushed, 0);
  assert.equal(r2.remaining, 1);

  const opsAfter500 = await outboxAll();
  assert.equal(opsAfter500.length, 1);

  // Now server recovers with 200 OK
  const tr200 = fakeTransport(() => ({ status: 200, data: { id: 888, updated_at: "2026-08-24T12:00:00" } }));
  const r3 = await pushOutbox(tr200);
  assert.equal(r3.pushed, 1);
  assert.equal(r3.remaining, 0);

  const opsAfterSuccess = await outboxAll();
  assert.equal(opsAfterSuccess.length, 0);
  assert.equal(await serverIdOf("note-500"), 888);
});

// Test 3: healStrandedNotes identifies stranded notes (server_id == null, !deleted, no outbox op) and appends create op to _outbox
test("Test 3: healStrandedNotes identifies stranded notes and appends create op to _outbox", async () => {
  await put("scratchpad_notes", [
    note({ cid: "stranded-1", title: "Stranded Note 1", server_id: null, deleted: false }),
    note({ cid: "stranded-2", title: "Stranded Note 2", server_id: null, deleted: false }),
  ]);

  const initialOps = await outboxAll();
  assert.equal(initialOps.length, 0);

  const count = await healStrandedNotes();
  assert.equal(count, 2);

  const healedOps = await outboxAll();
  assert.equal(healedOps.length, 2);
  const cids = new Set(healedOps.map((o) => o.cid));
  assert.equal(cids.has("stranded-1"), true);
  assert.equal(cids.has("stranded-2"), true);
  assert.equal(healedOps.every((o) => o.entity_type === "note" && o.op === "create"), true);
});

// Test 4: healStrandedNotes does not duplicate outbox op if create op already exists in _outbox
test("Test 4: healStrandedNotes does not duplicate outbox op if create op already exists in _outbox", async () => {
  await put("scratchpad_notes", [
    note({ cid: "n-existing", title: "Existing Op Note", server_id: null, deleted: false }),
  ]);
  await put("_outbox", [
    { qid: 1, op: "create", entity_type: "note", cid: "n-existing", payload: {} },
  ]);

  const count = await healStrandedNotes();
  assert.equal(count, 0);

  const ops = await outboxAll();
  assert.equal(ops.length, 1);
  assert.equal(ops[0].cid, "n-existing");
});

// Test 5: healStrandedNotes ignores deleted notes (deleted: true) or notes with valid server_id
test("Test 5: healStrandedNotes ignores deleted notes or notes with valid server_id", async () => {
  await put("scratchpad_notes", [
    note({ cid: "n-deleted", title: "Deleted Note", server_id: null, deleted: true }),
    note({ cid: "n-synced", title: "Synced Note", server_id: 42, deleted: false }),
  ]);

  const count = await healStrandedNotes();
  assert.equal(count, 0);

  const ops = await outboxAll();
  assert.equal(ops.length, 0);
});

// Test 6: Full end-to-end recovery simulation (Edge stranded note -> pushOutbox auto-heals -> pushes to server with client_id -> updates server_id and clears outbox)
test("Test 6: Full end-to-end recovery simulation", async () => {
  // Setup: Stranded note exists in IndexedDB with no outbox op
  await put("scratchpad_notes", [
    note({ cid: "edge-stranded-1", title: "Catatan Penting Hilang Antrean", content: "Isi penting", server_id: null, deleted: false }),
  ]);
  await setEntityTags("note", "edge-stranded-1", ["recovery"]);

  const opsBefore = await outboxAll();
  assert.equal(opsBefore.length, 0);

  // Run pushOutbox - should trigger healStrandedNotes before draining outbox
  const tr = fakeTransport((method, path, body) => {
    assert.equal(method, "POST");
    assert.equal(path, "/api/scratchpad");
    assert.equal(body.client_id, "edge-stranded-1");
    assert.equal(body.title, "Catatan Penting Hilang Antrean");
    assert.equal(body.content, "Isi penting");
    assert.deepEqual(body.tags, ["recovery"]);
    return { status: 200, data: { id: 999, updated_at: "2026-08-24T12:30:00" } };
  });

  const res = await pushOutbox(tr);
  assert.equal(res.pushed, 1);
  assert.equal(res.remaining, 0);
  assert.equal(tr.calls.length, 1);

  // Check ID mapping and note record
  assert.equal(await serverIdOf("edge-stranded-1"), 999);
  const db = await openDB();
  const noteRow = await new Promise((res) => {
    const q = db.transaction("scratchpad_notes").objectStore("scratchpad_notes").get("edge-stranded-1");
    q.onsuccess = () => res(q.result);
  });
  assert.equal(noteRow.server_id, 999);
  assert.equal(noteRow.dirty, 0);
  assert.equal(noteRow.base_rev, "2026-08-24T12:30:00");

  // Check outbox is empty
  const opsAfter = await outboxAll();
  assert.equal(opsAfter.length, 0);
});
