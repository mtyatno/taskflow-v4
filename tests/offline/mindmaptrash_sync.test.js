"use strict";
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { deleteDB } = require("./setup.js");
const { DB_NAME, _reset, openDB } = require("../../static/offline/db.js");
const { outboxAll } = require("../../static/offline/outbox.js");
const mm = require("../../static/offline/mindmaprepo.js");
const T = require("../../static/offline/mindmaptrash.js");
const { mapPut, cidOf } = require("../../static/offline/idmap.js");
const { pushOutbox } = require("../../static/offline/syncpush.js");
const { pullMindmapTrash } = require("../../static/offline/syncpull.js");

beforeEach(async () => { _reset(); await deleteDB(DB_NAME); mm.setCurrentUser(null); });

async function put(store, recs) {
  const db = await openDB();
  await new Promise((res, rej) => {
    const tx = db.transaction(store, "readwrite");
    for (const r of recs) tx.objectStore(store).put(r);
    tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error);
  });
}
async function get(store, key) {
  const db = await openDB();
  return new Promise((res) => { const q = db.transaction(store).objectStore(store).get(key); q.onsuccess = () => res(q.result); });
}
const item = (over) => Object.assign({ id: 5, title: "Srv", preview: "a", list_id: null, source_note_id: null, linked: false,
  client_id: "c5", deleted_at: "2026-10-18T10:00:00+07:00", days_left: 29 }, over);

function transport(handler) {
  const calls = [];
  return { calls, request(method, path, body) { calls.push({ method, path, body }); return Promise.resolve(handler(method, path, body)); } };
}
const srv = (over) => Object.assign({ id: 5, title: "Srv", data_json: "{\"nodeData\":{\"id\":\"root\",\"topic\":\"Srv\",\"root\":true,\"children\":[]}}",
  is_pinned: 0, list_id: null, user_id: 1, client_id: "c5", created_at: "t0", updated_at: "t1" }, over);

test("push restore op: ok → record recreated with cid = client_id, idmap, mirror cleared", async () => {
  await T.writeMirror([item()]);
  await T.restore("5");
  const tr = transport((m, p) => (m === "POST" && p === "/api/mindmaps/trash/5/restore") ? { status: 200, data: srv() } : { status: 404, data: {} });
  await pushOutbox(tr);
  const rec = await get("mindmaps", "c5");
  assert.equal(rec.server_id, 5); assert.equal(rec.dirty, 0); assert.equal(rec.deleted, false);
  assert.equal(await cidOf("mindmap", 5), "c5");
  const m = await T.readMirror();
  assert.deepEqual([m.items, m.restoring], [[], []]);
  assert.deepEqual(await outboxAll(), []);
});

test("push restore 409 SOURCE_NOTE_MISSING → error in mirror, op dropped; 404 → item removed", async () => {
  await T.writeMirror([item(), item({ id: 6, client_id: "c6" })]);
  await T.restore("5"); await T.restore("6");
  const tr = transport((m, p) => p.endsWith("/5/restore")
    ? { status: 409, data: { detail: { code: "SOURCE_NOTE_MISSING" } } } : { status: 404, data: { detail: "x" } });
  await pushOutbox(tr);
  const m = await T.readMirror();
  assert.deepEqual(m.items.map((i) => i.id), [5]);
  assert.deepEqual(m.errors, { 5: "source_note_missing" });
  assert.deepEqual(await outboxAll(), []);
});

test("push restore 503 keeps the op", async () => {
  await T.writeMirror([item()]);
  await T.restore("5");
  await pushOutbox(transport(() => ({ status: 503, data: {} })));
  assert.equal((await outboxAll()).length, 1);
});

test("pullMindmapTrash mirrors the server list; failure keeps the old mirror", async () => {
  await T.writeMirror([item({ id: 1 })]);
  const ok = (rows) => () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(rows) });
  assert.deepEqual(await pullMindmapTrash(() => Promise.resolve({ ok: false, status: 503, json: () => Promise.resolve({}) })), { mirrored: false });
  assert.deepEqual((await T.readMirror()).items.map((i) => i.id), [1]);
  assert.deepEqual(await pullMindmapTrash(ok([item({ id: 2 })])), { mirrored: true });
  assert.deepEqual((await T.readMirror()).items.map((i) => i.id), [2]);
});

test("push pin sends explicit body", async () => {
  await put("mindmaps", [{ cid: "p", server_id: 8, title: "P", data_json: "{}", pinned: true, deleted: false, dirty: 0, rev: 1 }]);
  await mapPut("mindmap", 8, "p");
  await put("_outbox", [{ qid: 1, op: "pin", entity_type: "mindmap", cid: "p", payload: { pinned: true } }]);
  const tr = transport((m) => (m === "GET" ? { status: 200, data: { id: 8, is_pinned: 0 } } : { status: 200, data: { id: 8, is_pinned: 1 } }));
  await pushOutbox(tr);
  const patch = tr.calls.find((c) => c.method === "PATCH");
  assert.equal(patch.path, "/api/mindmaps/8/pin");
  assert.deepEqual(patch.body, { pinned: true });
});
