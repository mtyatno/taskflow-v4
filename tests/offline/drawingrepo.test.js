"use strict";
// S6 (audit 2026-10-15, workstream D): jalur legacy "gambar di dalam note" (record ber-note_cid + op upsert ke
// PUT /api/drawings/{noteSid}) dihapus. Record lama dikonversi menjadi drawing standalone (note_cid dihapus,
// server_id null, blob dipertahankan, op create dengan client_id = cid) — tidak ada data yang dibuang.
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { deleteDB } = require("./setup.js");
const { DB_NAME, _reset, openDB } = require("../../static/offline/db.js");
const { outboxAll, outboxAdd } = require("../../static/offline/outbox.js");
const { mapPut } = require("../../static/offline/idmap.js");
const { makeBlobStore } = require("../../static/offline/blobstore.js");
const repo = require("../../static/offline/drawingrepo.js");
const { pushOutbox } = require("../../static/offline/syncpush.js");
const { buildTaskRouter } = require("../../static/offline/taskroutes.js");

beforeEach(async () => { _reset(); await deleteDB(DB_NAME); });
const blobStore = makeBlobStore();

async function allBlobs() {
  const db = await openDB();
  return new Promise((res) => { const q = db.transaction("blobs").objectStore("blobs").getAll(); q.onsuccess = () => res(q.result || []); });
}
async function putRecs(recs) {
  const db = await openDB();
  await new Promise((res, rej) => {
    const tx = db.transaction("drawings", "readwrite");
    for (const r of recs) tx.objectStore("drawings").put(r);
    tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error);
  });
}
async function rawRec(cid) {
  const db = await openDB();
  return new Promise((res) => { const q = db.transaction("drawings").objectStore("drawings").get(cid); q.onsuccess = () => res(q.result || null); });
}
async function allRecs() {
  const db = await openDB();
  return new Promise((res) => { const q = db.transaction("drawings").objectStore("drawings").getAll(); q.onsuccess = () => res(q.result || []); });
}
const SNAP = JSON.stringify({ store: { "shape:a": { id: "shape:a", typeName: "shape", type: "draw" } }, schema: { schemaVersion: 2 } });
// Record legacy persis seperti yang ditulis putDrawing() versi lama.
async function legacyRecord(cid, noteCid, over) {
  const ref = await blobStore.put(SNAP, { mime: "application/json" });
  const rec = Object.assign({ cid, note_cid: noteCid, blob_ref: ref, updated_at: "2026-06-06T00:00:00Z", deleted: false, dirty: 1, base_rev: null }, over || {});
  await putRecs([rec]);
  return rec;
}
function fakeTransport(handler) {
  const calls = [];
  return { calls, request(method, path, body) { calls.push({ method, path, body }); return Promise.resolve(handler(method, path, body, calls.length)); } };
}

test("upgradeLegacyNoteDrawings converts a note_cid record into a standalone drawing (blob kept, create op, client_id = cid)", async () => {
  const rec = await legacyRecord("d1", "note1");
  await outboxAdd({ op: "upsert", entity_type: "drawing", cid: "d1", payload: { note_cid: "note1" } });
  const n = await repo.upgradeLegacyNoteDrawings();
  assert.equal(n, 1);
  const after = await rawRec("d1");
  assert.equal(after.note_cid, undefined);
  assert.equal(after.server_id, null);
  assert.equal(after.client_id, "d1");
  assert.equal(after.blob_ref, rec.blob_ref, "blob dipertahankan");
  assert.equal(after.dirty, 1);
  assert.equal(after.base_rev, null);
  assert.equal(after.title, "Untitled Drawing");
  assert.equal(after.rev, 1);
  assert.equal((await allBlobs()).length, 1);
  const ops = await outboxAll();
  assert.deepEqual(ops.map((o) => o.op), ["create"], "op upsert dibuang, satu op create");
  assert.equal(ops[0].cid, "d1");
  // konversi idempoten: panggilan kedua tidak mengubah apa pun
  assert.equal(await repo.upgradeLegacyNoteDrawings(), 0);
  assert.equal((await outboxAll()).length, 1);
});

test("deleted legacy note drawing is purged (record + blob) instead of converted", async () => {
  await legacyRecord("d2", "note2", { deleted: true });
  await repo.upgradeLegacyNoteDrawings();
  assert.equal(await rawRec("d2"), null);
  assert.equal((await allBlobs()).length, 0);
});

test("pushOutbox: upsert op → record converted then POSTed as a standalone drawing (never PUT /api/drawings/{noteSid})", async () => {
  await legacyRecord("d3", "ncid");
  await outboxAdd({ op: "upsert", entity_type: "drawing", cid: "d3", payload: { note_cid: "ncid" } });
  await mapPut("note", 70, "ncid"); // note sudah punya server id — dulu memicu PUT /api/drawings/70 (id note!)
  const tr = fakeTransport(() => ({ status: 200, data: { id: 501, updated_at: "2026-06-06T12:00:00" } }));
  const r = await pushOutbox(tr);
  assert.equal(r.pushed, 1);
  assert.equal(tr.calls.length, 1);
  assert.equal(tr.calls[0].method, "POST");
  assert.equal(tr.calls[0].path, "/api/drawings");
  assert.equal(tr.calls[0].body.data_json, SNAP);
  assert.equal(tr.calls[0].body.client_id, "d3");
  const after = await rawRec("d3");
  assert.equal(after.server_id, 501);
  assert.equal(after.dirty, 0);
  assert.equal(after.base_rev, "2026-06-06T12:00:00");
  assert.equal(after.note_cid, undefined);
  assert.equal(r.remaining, 0);
});

test("processOp drawing/upsert on an already-converted record just drops the op", async () => {
  const d = await repo.createDrawing({ title: "X", data_json: SNAP }, {});
  await outboxAdd({ op: "upsert", entity_type: "drawing", cid: d.cid, payload: { note_cid: "n" } });
  const tr = fakeTransport(() => ({ status: 200, data: { id: 9, updated_at: "2026-06-06T12:00:00" } }));
  const r = await pushOutbox(tr);
  assert.equal(r.pushed, 1, "hanya op create yang dikirim");
  assert.equal(tr.calls.length, 1);
  assert.equal((await outboxAll()).length, 0);
});

test("router: PUT /api/drawings/:id for an unknown id rejects (no more note-attached fallback); standalone round-trips", async () => {
  const R = buildTaskRouter();
  await assert.rejects(() => R.dispatch("PUT", "/api/drawings/ncid", { data_json: '{"a":1}' }), /Drawing not found/);
  assert.equal((await allRecs()).length, 0);
  const created = await R.dispatch("POST", "/api/drawings", { title: "T", data_json: SNAP });
  await R.dispatch("PUT", "/api/drawings/" + created.cid, { data_json: '{"store":{},"schema":{}}' });
  const got = await R.dispatch("GET", "/api/drawings/" + created.cid, undefined);
  assert.equal(got.data_json, '{"store":{},"schema":{}}');
  await assert.rejects(() => R.dispatch("GET", "/api/drawings/nope", undefined));
});

test("getDrawing ignores a legacy note_cid record (standalone only)", async () => {
  await legacyRecord("d4", "note4");
  assert.equal(await repo.getDrawing("d4", { online: false }), null);
});
