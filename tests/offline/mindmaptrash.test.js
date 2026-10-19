"use strict";
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { deleteDB } = require("./setup.js");
const { DB_NAME, _reset, openDB } = require("../../static/offline/db.js");
const { outboxAll } = require("../../static/offline/outbox.js");
const { buildTaskRouter, shouldRouteLocally } = require("../../static/offline/taskroutes.js");
const mm = require("../../static/offline/mindmaprepo.js");
const T = require("../../static/offline/mindmaptrash.js");

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
const DATA = JSON.stringify({ nodeData: { id: "root", topic: "R", root: true, children: [
  { id: "a", topic: "**Satu**", children: [] }, { id: "b", topic: "Dua", children: [] }] } });

test("previewOf: three topics after root, plain text", () => {
  assert.equal(T.previewOf(DATA), "Satu · Dua");
  assert.equal(T.previewOf("bukan json"), "");
});

test("listTrash merges mirror + pending local deletes, newest first", async () => {
  await T.writeMirror([item()]);
  const r = await mm.createMindmap({ title: "Lokal", data_json: DATA }, { now: "2026-10-19T00:00:00Z" });
  await mm.deleteMindmap(r.cid, { now: "2026-10-19T01:00:00Z" });
  const list = await T.listTrash();
  assert.deepEqual(list.map((i) => [i.title, i.pending]), [["Lokal", true], ["Srv", false]]);
  assert.equal(list[0].cid, r.cid);
  assert.equal(list[0].preview, "Satu · Dua");
});

test("restore of a pending local delete un-deletes, restores dirty flag and drops the delete op", async () => {
  await put("mindmaps", [{ cid: "m1", server_id: 9, title: "M", data_json: DATA, deleted: false, dirty: 0, rev: 1, base_rev: "t" }]);
  await mm.deleteMindmap("m1", { now: "2026-10-19T01:00:00Z" });
  assert.equal((await get("mindmaps", "m1")).trashed_at, "2026-10-19T01:00:00Z");
  const res = await T.restore("m1");
  assert.deepEqual(res, { restored: "local", cid: "m1" });
  const rec = await get("mindmaps", "m1");
  assert.equal(rec.deleted, false); assert.equal(rec.dirty, 0); assert.equal(rec.trashed_at, undefined);
  assert.deepEqual((await outboxAll()).filter((o) => o.cid === "m1"), []);
});

test("restore of a mirror item queues one restore op and hides the item", async () => {
  await T.writeMirror([item()]);
  assert.deepEqual(await T.restore("5"), { restored: "queued", id: 5 });
  const ops = (await outboxAll()).filter((o) => o.op === "restore");
  assert.deepEqual(ops.map((o) => [o.entity_type, o.cid, o.payload.server_id]), [["mindmap", "trash:5", 5]]);
  assert.deepEqual(await T.listTrash(), []);
  assert.deepEqual((await T.readMirror()).restoring, [5]);
  await assert.rejects(T.restore("777"), (e) => e.status === 404);
});

test("writeMirror drops restoring/errors for sids no longer on the server; markRestoreResult", async () => {
  await T.writeMirror([item(), item({ id: 6, client_id: "c6" })]);
  await T.restore("5"); await T.restore("6");
  await T.markRestoreResult(6, "source_note_missing");
  await T.writeMirror([item({ id: 6, client_id: "c6" })]);
  const m = await T.readMirror();
  assert.deepEqual(m.restoring, []); assert.deepEqual(m.errors, { 6: "source_note_missing" });
  assert.equal((await T.listTrash())[0].error, "source_note_missing");
});

test("local routes serve trash; DELETE trash goes to the network", async () => {
  await T.writeMirror([item()]);
  const router = buildTaskRouter();
  assert.equal((await router.dispatch("GET", "/api/mindmaps/trash")).length, 1);
  assert.equal((await router.dispatch("POST", "/api/mindmaps/trash/5/restore", {})).restored, "queued");
  assert.equal(shouldRouteLocally(router, "GET", "/api/mindmaps/trash"), true);
  assert.equal(shouldRouteLocally(router, "DELETE", "/api/mindmaps/trash"), false);
  assert.equal(shouldRouteLocally(router, "DELETE", "/api/mindmaps/trash/5"), false);
  assert.equal(shouldRouteLocally(router, "DELETE", "/api/mindmaps/5"), true);
});
