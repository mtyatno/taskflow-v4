"use strict";
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { deleteDB } = require("./setup.js");
const { DB_NAME, _reset, openDB } = require("../../static/offline/db.js");
const { serverIdOf, mapPut } = require("../../static/offline/idmap.js");
const { outboxAll } = require("../../static/offline/outbox.js");
const {
  mindmapToCreatePayload, mindmapToUpdatePayload, pushOutbox,
} = require("../../static/offline/syncpush.js");

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
async function getMM(cid) {
  const db = await openDB();
  return new Promise((res) => { const q = db.transaction("mindmaps").objectStore("mindmaps").get(cid); q.onsuccess = () => res(q.result); });
}
function mm(over) {
  return Object.assign({
    cid: over.cid, server_id: null, title: "M", data_json: "{\"nodeData\":{}}",
    pinned: false, list_id: null, created_at: "2026-06-10T00:00:00", updated_at: "2026-06-10T00:00:00",
    deleted: false, dirty: 1, base_rev: null,
  }, over);
}
function fakeTransport(handler) {
  const calls = [];
  return { calls, request(method, path, body) { calls.push({ method, path, body }); const h = handler(method, path, body); if (h === "NETWORK") return Promise.reject(new Error("net")); return Promise.resolve(h); } };
}

test("mindmapToCreatePayload / Update build {title, data_json}", () => {
  const p = mindmapToCreatePayload(mm({ cid: "m", title: "Hi", data_json: "{\"x\":1}" }));
  assert.deepEqual(p, { title: "Hi", data_json: "{\"x\":1}" });
  assert.deepEqual(mindmapToUpdatePayload(mm({ cid: "m", title: "T", data_json: "{}" })), { title: "T", data_json: "{}" });
});

test("push create POSTs /api/mindmaps, sets server_id + idmap + base_rev, clears dirty", async () => {
  await put("mindmaps", [mm({ cid: "m", title: "Hi" })]);
  await put("_outbox", [{ qid: 1, op: "create", entity_type: "mindmap", cid: "m", payload: {} }]);
  const tr = fakeTransport(() => ({ status: 200, data: { id: 50, updated_at: "2026-06-10T10:00:00" } }));
  const r = await pushOutbox(tr);
  assert.equal(r.pushed, 1);
  assert.equal(await serverIdOf("m"), 50);
  const rec = await getMM("m");
  assert.equal(rec.server_id, 50);
  assert.equal(rec.dirty, 0);
  assert.equal(rec.base_rev, "2026-06-10T10:00:00");
  assert.equal((await outboxAll()).length, 0);
});

test("push update PUTs and clears dirty + base_rev", async () => {
  await put("mindmaps", [mm({ cid: "m", server_id: 7, title: "T" })]);
  await mapPut("mindmap", 7, "m");
  await put("_outbox", [{ qid: 1, op: "update", entity_type: "mindmap", cid: "m", payload: {} }]);
  const tr = fakeTransport((method) => { assert.equal(method, "PUT"); return { status: 200, data: { id: 7, updated_at: "2026-06-10T11:00:00" } }; });
  const r = await pushOutbox(tr);
  assert.equal(r.pushed, 1);
  const rec = await getMM("m");
  assert.equal(rec.dirty, 0);
  assert.equal(rec.base_rev, "2026-06-10T11:00:00");
});

test("push update 404 re-creates (POST), remaps server_id", async () => {
  await put("mindmaps", [mm({ cid: "m", server_id: 7, title: "T" })]);
  await mapPut("mindmap", 7, "m");
  await put("_outbox", [{ qid: 1, op: "update", entity_type: "mindmap", cid: "m", payload: {} }]);
  let n = 0;
  const tr = fakeTransport(() => (n++ === 0 ? { status: 404, data: { detail: "gone" } } : { status: 200, data: { id: 99, updated_at: "2026-06-10T12:00:00" } }));
  const r = await pushOutbox(tr);
  assert.equal(r.pushed, 1);
  assert.equal(await serverIdOf("m"), 99);
  const rec = await getMM("m");
  assert.equal(rec.server_id, 99);
  assert.equal(rec.dirty, 0);
});

test("push delete DELETEs, drops idmap + record", async () => {
  await put("mindmaps", [mm({ cid: "m", server_id: 7, deleted: true })]);
  await mapPut("mindmap", 7, "m");
  await put("_outbox", [{ qid: 1, op: "delete", entity_type: "mindmap", cid: "m", payload: {} }]);
  const tr = fakeTransport((method) => { assert.equal(method, "DELETE"); return { status: 200, data: { ok: true } }; });
  const r = await pushOutbox(tr);
  assert.equal(r.pushed, 1);
  assert.equal(await serverIdOf("m"), undefined);
  assert.equal(await getMM("m"), undefined);
});

test("push pin is conditional: skips PATCH when server already matches", async () => {
  await put("mindmaps", [mm({ cid: "m", server_id: 7, pinned: true, dirty: 0 })]);
  await mapPut("mindmap", 7, "m");
  await put("_outbox", [{ qid: 1, op: "pin", entity_type: "mindmap", cid: "m", payload: { pinned: true } }]);
  const tr = fakeTransport((method) => {
    if (method === "GET") return { status: 200, data: { id: 7, is_pinned: 1 } }; // already pinned on server
    throw new Error("should not PATCH when already in sync");
  });
  const r = await pushOutbox(tr);
  assert.equal(r.pushed, 1);
  assert.equal((await outboxAll()).length, 0);
});

test("push pin PATCHes when server differs", async () => {
  await put("mindmaps", [mm({ cid: "m", server_id: 7, pinned: true, dirty: 0 })]);
  await mapPut("mindmap", 7, "m");
  await put("_outbox", [{ qid: 1, op: "pin", entity_type: "mindmap", cid: "m", payload: { pinned: true } }]);
  const seen = [];
  const tr = fakeTransport((method) => {
    seen.push(method);
    if (method === "GET") return { status: 200, data: { id: 7, is_pinned: 0 } }; // server unpinned → must toggle
    return { status: 200, data: { id: 7, is_pinned: 1 } };
  });
  const r = await pushOutbox(tr);
  assert.equal(r.pushed, 1);
  assert.deepEqual(seen, ["GET", "PATCH"]);
});
