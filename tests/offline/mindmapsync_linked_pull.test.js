"use strict";
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { deleteDB } = require("./setup.js");
const { DB_NAME, _reset, openDB } = require("../../static/offline/db.js");
const { mapPut, cidOf } = require("../../static/offline/idmap.js");
const { outboxAdd } = require("../../static/offline/outbox.js");
const { pullMindmaps, pullMindmapsAndReconcile } = require("../../static/offline/syncpull.js");

beforeEach(async () => { _reset(); await deleteDB(DB_NAME); });

async function put(store, recs) {
  const db = await openDB();
  await new Promise((res, rej) => {
    const tx = db.transaction(store, "readwrite");
    for (const r of recs) tx.objectStore(store).put(r);
    tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error);
  });
}
async function getAll(store) {
  const db = await openDB();
  return new Promise((res) => { const q = db.transaction(store).objectStore(store).getAll(); q.onsuccess = () => res(q.result || []); });
}
const VIEW = '{"linked":1,"direction":2,"justify":false,"collapsed":[],"summary":true}';
function row(over) {
  return Object.assign({ id: 50, title: "N", is_pinned: 0, list_id: null, source_note_id: 7, data_json: VIEW,
    created_at: "2026-06-10T00:00:00", updated_at: "2026-06-10T00:00:00" }, over);
}
function jsonRes(body) { return { ok: true, status: 200, json: () => Promise.resolve(body), text: () => Promise.resolve(JSON.stringify(body)) }; }

test("pull uses ?linked=1 and resolves source_note_cid", async () => {
  await mapPut("note", 7, "n1");
  const urls = [];
  const rawFetch = (url) => {
    urls.push(url);
    return Promise.resolve(url === "/api/mindmaps?linked=1" ? jsonRes([row()]) : jsonRes(row()));
  };
  await pullMindmapsAndReconcile(rawFetch);
  assert.ok(urls.includes("/api/mindmaps?linked=1"));
  assert.equal((await getAll("mindmaps"))[0].source_note_cid, "n1");
});

test("map pulled before its note gets source_note_cid filled on a later pull", async () => {
  const rows = [row()];
  const fetchOne = () => Promise.resolve(row());
  await pullMindmaps(rows, fetchOne);
  assert.equal((await getAll("mindmaps"))[0].source_note_cid == null, true);
  await mapPut("note", 7, "n1");
  const res = await pullMindmaps(rows, fetchOne);
  const recs = await getAll("mindmaps");
  assert.equal(recs[0].source_note_cid, "n1");
  assert.equal(recs[0].dirty, 0);
  assert.ok(res.changed.some((c) => c.server_id === 50));
});

test("dirty linked map with pending op never becomes a conflict copy", async () => {
  await mapPut("mindmap", 50, "a");
  await put("mindmaps", [{ cid: "a", server_id: 50, source_note_cid: "n1", source_note_id: 7, title: "N", data_json: VIEW,
    dirty: 1, base_rev: "r1", rev: 2, deleted: false, list_id: null, updated_at: "r1" }]);
  await outboxAdd({ op: "update", entity_type: "mindmap", cid: "a", payload: { cid: "a" } });
  const res = await pullMindmaps([row({ updated_at: "r2" })], () => Promise.resolve(row({ updated_at: "r2" })));
  assert.equal(res.conflictCopies, 0);
  assert.equal(res.skipped >= 1, true);
  const recs = await getAll("mindmaps");
  assert.equal(recs.length, 1);
  assert.equal(recs[0].dirty, 1);
});

test("reconcile keeps local linked maps (still listed with linked=1)", async () => {
  await mapPut("mindmap", 50, "a");
  await put("mindmaps", [{ cid: "a", server_id: 50, source_note_cid: "n1", source_note_id: 7, title: "N", data_json: VIEW,
    dirty: 0, base_rev: "x", rev: 1, deleted: false, list_id: null, updated_at: "x" }]);
  const rawFetch = (url) => Promise.resolve(url === "/api/mindmaps?linked=1" ? jsonRes([row({ updated_at: "x" })]) : jsonRes(row()));
  const res = await pullMindmapsAndReconcile(rawFetch);
  assert.equal(res.deleted, 0);
  assert.equal((await getAll("mindmaps")).length, 1);
  assert.equal(await cidOf("mindmap", 50), "a");
});

test("dirty shared linked map (list_id set) with pending op never becomes a conflict copy", async () => {
  await mapPut("mindmap", 50, "a");
  await put("mindmaps", [{ cid: "a", server_id: 50, source_note_cid: "n1", source_note_id: 7, title: "N", data_json: VIEW,
    dirty: 1, base_rev: "r1", rev: 2, deleted: false, list_id: 9, updated_at: "r1" }]);
  await outboxAdd({ op: "update", entity_type: "mindmap", cid: "a", payload: { cid: "a" } });
  const r = row({ updated_at: "r2", list_id: 9 });
  const res = await pullMindmaps([r], () => Promise.resolve(r));
  assert.equal(res.conflictCopies, 0);
  assert.equal((await getAll("mindmaps")).length, 1);
});

test("shared linked map, dirty with pending update, missing from server list -> no remote_deleted conflict", async () => {
  await mapPut("mindmap", 50, "a");
  await put("mindmaps", [{ cid: "a", server_id: 50, source_note_cid: "n1", source_note_id: 7, title: "N", data_json: VIEW,
    dirty: 1, base_rev: "r1", rev: 2, deleted: false, list_id: 9, updated_at: "r1" }]);
  await outboxAdd({ op: "update", entity_type: "mindmap", cid: "a", payload: { cid: "a" } });
  await pullMindmaps([], () => Promise.resolve(null));
  const recs = await getAll("mindmaps");
  assert.equal(recs.length, 1);
  assert.equal(recs[0].conflict, undefined);
  assert.equal(recs[0].dirty, 1);
});
