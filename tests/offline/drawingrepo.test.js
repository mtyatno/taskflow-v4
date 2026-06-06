"use strict";
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { deleteDB } = require("./setup.js");
const { DB_NAME, _reset, openDB } = require("../../static/offline/db.js");
const { outboxAll } = require("../../static/offline/outbox.js");
const { putDrawing, getDrawingLocal } = require("../../static/offline/drawingrepo.js");

beforeEach(async () => { _reset(); await deleteDB(DB_NAME); });

async function allBlobs() {
  const db = await openDB();
  return new Promise((res) => { const q = db.transaction("blobs").objectStore("blobs").getAll(); q.onsuccess = () => res(q.result || []); });
}

test("putDrawing stores data_json in BlobStore, records outbox upsert, sets dirty 1", async () => {
  const rec = await putDrawing("note1", '{"shapes":1}', { now: "2026-06-06T00:00:00Z" });
  assert.equal(rec.note_cid, "note1");
  assert.ok(rec.blob_ref);
  assert.equal(rec.dirty, 1);
  assert.equal(rec.updated_at, "2026-06-06T00:00:00Z");
  const local = await getDrawingLocal("note1");
  assert.equal(local.cid, rec.cid);
  const blobs = await allBlobs();
  assert.equal(blobs.length, 1);
  const ops = await outboxAll();
  assert.equal(ops.length, 1);
  assert.equal(ops[0].op, "upsert");
  assert.equal(ops[0].entity_type, "drawing");
  assert.deepEqual(ops[0].payload, { note_cid: "note1" });
});

test("putDrawing overwrite reuses cid, deletes the old blob, dedupes the outbox op", async () => {
  const r1 = await putDrawing("note1", "v1", {});
  const r2 = await putDrawing("note1", "v2", {});
  assert.equal(r2.cid, r1.cid);
  const blobs = await allBlobs();
  assert.equal(blobs.length, 1); // old blob deleted
  const ops = (await outboxAll()).filter((o) => o.entity_type === "drawing");
  assert.equal(ops.length, 1); // deduped — single pending upsert
});

test("getDrawingLocal returns null for an unknown note", async () => {
  assert.equal(await getDrawingLocal("nope"), null);
});

const { cacheServerDrawing, getDrawing } = require("../../static/offline/drawingrepo.js");

test("cacheServerDrawing stores a clean drawing (dirty 0, base_rev=updated_at)", async () => {
  const rec = await cacheServerDrawing("note1", '{"s":2}', "2026-06-05T00:00:00");
  assert.equal(rec.dirty, 0);
  assert.equal(rec.base_rev, "2026-06-05T00:00:00");
  assert.equal((await getDrawingLocal("note1")).blob_ref, rec.blob_ref);
});

test("getDrawing returns the local data_json when present (no fetch)", async () => {
  await putDrawing("note1", '{"local":1}', {});
  const out = await getDrawing("note1", { online: true, fetch: () => Promise.resolve(null) });
  assert.equal(out.data_json, '{"local":1}');
});

test("getDrawing fetches + caches on a local miss when online", async () => {
  const out = await getDrawing("note1", { online: true, fetch: () => Promise.resolve({ data_json: '{"srv":1}', updated_at: "2026-06-05T00:00:00" }) });
  assert.equal(out.data_json, '{"srv":1}');
  assert.equal((await getDrawingLocal("note1")).dirty, 0);
});

test("getDrawing LWW: adopts a newer server drawing over a clean local one", async () => {
  await cacheServerDrawing("note1", '{"old":1}', "2026-06-01T00:00:00");
  const out = await getDrawing("note1", { online: true, fetch: () => Promise.resolve({ data_json: '{"new":1}', updated_at: "2026-06-09T00:00:00" }) });
  assert.equal(out.data_json, '{"new":1}');
});

test("getDrawing keeps a dirty local drawing even if server is newer", async () => {
  await putDrawing("note1", '{"localedit":1}', { now: "2026-06-02T00:00:00" }); // dirty:1
  const out = await getDrawing("note1", { online: true, fetch: () => Promise.resolve({ data_json: '{"srv":1}', updated_at: "2026-06-09T00:00:00" }) });
  assert.equal(out.data_json, '{"localedit":1}');
});

test("getDrawing returns null on offline miss", async () => {
  const out = await getDrawing("note1", { online: false, fetch: () => Promise.reject(new Error("no net")) });
  assert.equal(out, null);
});
