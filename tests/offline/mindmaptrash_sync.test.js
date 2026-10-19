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
const { pullMindmapTrash, pullMindmapsAndReconcile } = require("../../static/offline/syncpull.js");

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

async function all(store) {
  const db = await openDB();
  return new Promise((res) => { const q = db.transaction(store).objectStore(store).getAll(); q.onsuccess = () => res(q.result); });
}
const linkedRow = srv({ id: 9, title: "Srv9", data_json: "{\"srv\":1}", source_note_id: 3, client_id: "c9", updated_at: "t9" });
const postOnly = (row) => transport((m) => (m === "POST" ? { status: 200, data: row } : { status: 404, data: {} }));

test("linked restore returning an existing clean local map → updated in place, pin/source_note_cid kept, no duplicate", async () => {
  await put("mindmaps", [{ cid: "loc", server_id: 9, title: "Old", data_json: "{}", pinned: true, deleted: false, dirty: 0, rev: 4, source_note_cid: "n3", client_id: "c9" }]);
  await mapPut("mindmap", 9, "loc");
  await T.writeMirror([item({ source_note_id: 3, linked: true })]);
  await T.restore("5");
  await pushOutbox(postOnly(linkedRow));
  const recs = await all("mindmaps");
  assert.equal(recs.length, 1);
  assert.equal(recs[0].cid, "loc"); assert.equal(recs[0].title, "Srv9"); assert.equal(recs[0].data_json, "{\"srv\":1}");
  assert.equal(recs[0].pinned, true); assert.equal(recs[0].source_note_cid, "n3"); assert.equal(recs[0].rev, 5);
  assert.equal(await cidOf("mindmap", 9), "loc");
  assert.deepEqual((await T.readMirror()).items, []);
  assert.deepEqual(await outboxAll(), []);
});

test("linked restore returning an existing DIRTY local map → untouched, no duplicate, mirror ok", async () => {
  const dirtyRec = { cid: "loc", server_id: 9, title: "Mine", data_json: "{\"edited\":1}", pinned: false, deleted: false, dirty: 1, rev: 4, source_note_cid: "n3", client_id: "c9" };
  await put("mindmaps", [dirtyRec]);
  await mapPut("mindmap", 9, "loc");
  await T.writeMirror([item({ source_note_id: 3, linked: true })]);
  await T.restore("5");
  await pushOutbox(postOnly(linkedRow));
  assert.deepEqual(await all("mindmaps"), [dirtyRec]);
  assert.equal(await cidOf("mindmap", 9), "loc");
  const m = await T.readMirror();
  assert.deepEqual([m.items, m.errors], [[], {}]);
});

test("restore: existing dirty local map found by client_id (no idmap) → untouched, no duplicate", async () => {
  const dirtyRec = { cid: "c9", server_id: 9, title: "Mine", data_json: "{\"edited\":1}", deleted: false, dirty: 1, rev: 2, source_note_cid: "n3" };
  await put("mindmaps", [dirtyRec]);
  await T.writeMirror([item()]);
  await T.restore("5");
  await pushOutbox(postOnly(linkedRow));
  assert.deepEqual(await all("mindmaps"), [dirtyRec]);
});

test("restore: client_id already used as cid of a record mapped to another sid → fresh cid, other record untouched", async () => {
  const other = { cid: "c5", server_id: 7, title: "Other", data_json: "{}", deleted: false, dirty: 0, rev: 3 };
  await put("mindmaps", [other]);
  await mapPut("mindmap", 7, "c5");
  await T.writeMirror([item()]);
  await T.restore("5");
  await pushOutbox(postOnly(srv()));
  assert.deepEqual(await get("mindmaps", "c5"), other);
  const cid5 = await cidOf("mindmap", 5);
  assert.ok(cid5 && cid5 !== "c5");
  const rec = await get("mindmaps", cid5);
  assert.equal(rec.server_id, 5); assert.equal(rec.client_id, "c5"); assert.equal(rec.dirty, 0);
  assert.equal(await cidOf("mindmap", 7), "c5");
});

test("restore retry: 409 without code (id already exists) → treated as restored, nothing written", async () => {
  await T.writeMirror([item()]);
  await T.restore("5");
  await pushOutbox(transport(() => ({ status: 409, data: { detail: "Mindmap dengan id ini sudah ada" } })));
  const m = await T.readMirror();
  assert.deepEqual([m.items, m.restoring, m.errors], [[], [], {}]);
  assert.deepEqual(await all("mindmaps"), []);
  assert.deepEqual(await outboxAll(), []);
});

test("restore: generic 4xx → failed in mirror; missing server_id → op dropped without request", async () => {
  await T.writeMirror([item()]);
  await T.restore("5");
  await put("_outbox", [{ qid: 99, op: "restore", entity_type: "mindmap", cid: "trash:x", payload: {} }]);
  const tr = transport(() => ({ status: 400, data: { detail: "bad" } }));
  await pushOutbox(tr);
  assert.deepEqual((await T.readMirror()).errors, { 5: "failed" });
  assert.deepEqual(await outboxAll(), []);
  assert.deepEqual(tr.calls.map((c) => c.path), ["/api/mindmaps/trash/5/restore"]);
});

test("pullMindmapsAndReconcile pulls the trash mirror; a trash failure does not fail reconcile", async () => {
  await T.writeMirror([item({ id: 1 })]);
  const okRes = (rows) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(rows) });
  const paths = [];
  const res = await pullMindmapsAndReconcile((u) => { paths.push(u); return u === "/api/mindmaps/trash" ? okRes([item({ id: 2 })]) : okRes([]); });
  assert.ok(res && typeof res === "object");
  assert.ok(paths.includes("/api/mindmaps/trash"));
  assert.deepEqual((await T.readMirror()).items.map((i) => i.id), [2]);
  const res2 = await pullMindmapsAndReconcile((u) => (u === "/api/mindmaps/trash" ? Promise.reject(new Error("net")) : okRes([])));
  assert.ok(res2 && typeof res2 === "object");
  const res3 = await pullMindmapsAndReconcile((u) => { if (u === "/api/mindmaps/trash") throw new Error("sync"); return okRes([]); });
  assert.ok(res3 && typeof res3 === "object");
  assert.deepEqual((await T.readMirror()).items.map((i) => i.id), [2]);
});
