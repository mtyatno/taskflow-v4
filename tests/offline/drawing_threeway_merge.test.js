"use strict";
// T2 + S3 (audit 2026-10-15, workstream D): merge snapshot drawing 3-arah terhadap snapshot dasar
// (base_blob_ref = versi pada base_rev). Coretan yang dihapus di satu sisi tidak hidup lagi; hilang di satu sisi
// tapi berubah di sisi lain → dipertahankan; tanpa dasar → union lama. Judul: sisi yang berbeda dari dasar menang.
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { deleteDB } = require("./setup.js");
const { DB_NAME, _reset, openDB } = require("../../static/offline/db.js");
const { mapPut } = require("../../static/offline/idmap.js");
const { outboxAll, outboxAdd } = require("../../static/offline/outbox.js");
const { makeBlobStore } = require("../../static/offline/blobstore.js");
const { pullDrawings, mergeDrawingSnapshots } = require("../../static/offline/syncpull.js");
const { pushOutbox } = require("../../static/offline/syncpush.js");
const repo = require("../../static/offline/drawingrepo.js");

beforeEach(async () => { _reset(); await deleteDB(DB_NAME); });
const blobStore = makeBlobStore();

// Snapshot tldraw realistis: document/page/pointer + shape per id. shapes = { "shape:x": {x, y, ...} }
function tlSnap(shapes) {
  const store = {
    "document:document": { gridSize: 10, name: "", meta: {}, id: "document:document", typeName: "document" },
    "page:page": { meta: {}, id: "page:page", name: "Page 1", index: "a1", typeName: "page" },
    "pointer:pointer": { id: "pointer:pointer", typeName: "pointer", x: 0, y: 0, lastActivityTimestamp: 1, meta: {} },
  };
  let i = 1;
  for (const [id, over] of Object.entries(shapes || {})) {
    store[id] = Object.assign({
      x: 0, y: 0, rotation: 0, isLocked: false, opacity: 1, meta: {}, id, type: "draw", parentId: "page:page",
      index: "a" + (i++), props: { segments: [{ type: "free", points: [{ x: 0, y: 0, z: 0.5 }] }], color: "black", size: "m", isComplete: true },
      typeName: "shape",
    }, over);
  }
  return JSON.stringify({ store, schema: { schemaVersion: 2, sequences: { "com.tldraw.store": 4, "com.tldraw.shape.draw": 2 } } });
}
const shapeIds = (json) => Object.keys(JSON.parse(json).store).filter((k) => k.startsWith("shape:")).sort();

async function allRecs() {
  const db = await openDB();
  return new Promise((res) => { const q = db.transaction("drawings").objectStore("drawings").getAll(); q.onsuccess = () => res(q.result || []); });
}
async function rawRec(cid) {
  const db = await openDB();
  return new Promise((res) => { const q = db.transaction("drawings").objectStore("drawings").get(cid); q.onsuccess = () => res(q.result || null); });
}
async function allBlobIds() {
  const db = await openDB();
  return new Promise((res) => { const q = db.transaction("blobs").objectStore("blobs").getAllKeys(); q.onsuccess = () => res(q.result || []); });
}
async function putRecs(recs) {
  const db = await openDB();
  await new Promise((res, rej) => { const tx = db.transaction("drawings", "readwrite"); for (const r of recs) tx.objectStore("drawings").put(r); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); });
}
// Record tersinkron: blob = base (berbagi id), base_rev = updatedAt.
async function syncedRecord(cid, sid, dataJson, updatedAt, over) {
  const ref = await blobStore.put(dataJson, { mime: "application/json" });
  const rec = Object.assign({
    cid, server_id: sid, title: "T", blob_ref: ref, base_blob_ref: ref, base_title: "T", svg_preview: "", svg_stale: 0, is_pinned: 0,
    created_at: updatedAt, updated_at: updatedAt, deleted: false, dirty: 0, base_rev: updatedAt, rev: 0,
  }, over || {});
  await putRecs([rec]);
  await mapPut("drawing", sid, cid);
  return rec;
}
const srvRow = (id, dataJson, updatedAt, over) => Object.assign({ id, title: "T", data_json: dataJson, svg_preview: "", is_pinned: 0, tags: [], updated_at: updatedAt, created_at: "2026-10-15T00:00:00" }, over || {});
function transport(handler, during) {
  const calls = [];
  return { calls, request(method, path, body) { calls.push({ method, path, body }); const res = handler(method, path, body, calls.length); const d = during ? during(calls.length) : null; return Promise.resolve(d).then(() => res); } };
}

// ── mergeDrawingSnapshots dengan opts.base ───────────────────────────────────────────────────────
test("3-way: A erases shape S (remote), B draws stroke T (local) → merged has T and NOT S", () => {
  const base = tlSnap({ "shape:S": { x: 10 } });
  const remote = tlSnap({});                                   // A menghapus S lalu push
  const local = tlSnap({ "shape:S": { x: 10 }, "shape:T": { x: 50 } }); // B belum tahu, menambah T
  const merged = mergeDrawingSnapshots(local, remote, { preferRemote: true, base });
  assert.deepEqual(shapeIds(merged), ["shape:T"]);
  const obj = JSON.parse(merged);
  assert.ok(obj.store["page:page"] && obj.store["document:document"], "record non-shape tetap ada");
  assert.equal(obj.schema.schemaVersion, 2);
});

test("3-way: A moves S (remote changed), B erases S (local) → S kept with A's position (changed side wins)", () => {
  const base = tlSnap({ "shape:S": { x: 10 } });
  const remote = tlSnap({ "shape:S": { x: 99 } });
  const local = tlSnap({});
  const merged = JSON.parse(mergeDrawingSnapshots(local, remote, { preferRemote: false, base }));
  assert.ok(merged.store["shape:S"]);
  assert.equal(merged.store["shape:S"].x, 99);
  // simetris: lokal memindahkan, remote menghapus → dipertahankan dengan posisi lokal
  const merged2 = JSON.parse(mergeDrawingSnapshots(tlSnap({ "shape:S": { x: 77 } }), tlSnap({}), { preferRemote: true, base }));
  assert.equal(merged2.store["shape:S"].x, 77);
});

test("3-way: both sides erase S, local adds T, remote adds U → {T, U}; per-field: only the changed side wins", () => {
  const base = tlSnap({ "shape:S": { x: 10, y: 10 } });
  const local = tlSnap({ "shape:T": { x: 1 } });
  const remote = tlSnap({ "shape:U": { x: 2 } });
  assert.deepEqual(shapeIds(mergeDrawingSnapshots(local, remote, { base })), ["shape:T", "shape:U"]);
  // S ada di kedua sisi: lokal ubah x, remote ubah y → keduanya diambil walau preferRemote
  const l2 = tlSnap({ "shape:S": { x: 55, y: 10 } });
  const r2 = tlSnap({ "shape:S": { x: 10, y: 66 } });
  const m2 = JSON.parse(mergeDrawingSnapshots(l2, r2, { preferRemote: true, base }));
  assert.equal(m2.store["shape:S"].x, 55);
  assert.equal(m2.store["shape:S"].y, 66);
  // keduanya mengubah x → preferRemote menentukan
  const m3 = JSON.parse(mergeDrawingSnapshots(tlSnap({ "shape:S": { x: 1, y: 10 } }), tlSnap({ "shape:S": { x: 2, y: 10 } }), { preferRemote: true, base }));
  assert.equal(m3.store["shape:S"].x, 2);
});

test("no base → plain union (old behaviour): erased shape comes back, both additions kept", () => {
  const remote = tlSnap({});
  const local = tlSnap({ "shape:S": { x: 10 }, "shape:T": { x: 50 } });
  assert.deepEqual(shapeIds(mergeDrawingSnapshots(local, remote, { preferRemote: true })), ["shape:S", "shape:T"]);
  assert.deepEqual(shapeIds(mergeDrawingSnapshots(local, remote, { preferRemote: true, base: null })), ["shape:S", "shape:T"]);
});

// ── pullDrawings memakai base_blob_ref; dasar baru = data remote ────────────────────────────────
test("pull: dirty local (base kept) + remote erased S → merge drops S, keeps local T; base becomes remote data", async () => {
  const base = tlSnap({ "shape:S": { x: 10 } });
  const rec = await syncedRecord("d", 1, base, "2026-10-15T01:00:00");
  // B menggambar T (edit lokal lewat repo → blob baru, blob dasar dipertahankan)
  await repo.updateDrawing("d", { data_json: tlSnap({ "shape:S": { x: 10 }, "shape:T": { x: 50 } }) }, { now: "2026-10-15T01:30:00" });
  let cur = await rawRec("d");
  assert.equal(cur.base_blob_ref, rec.blob_ref, "blob dasar tetap");
  assert.notEqual(cur.blob_ref, cur.base_blob_ref);
  assert.ok((await allBlobIds()).includes(rec.blob_ref), "blob dasar tidak dibuang oleh updateDrawing");
  const remote = tlSnap({}); // A menghapus S
  const r = await pullDrawings([srvRow(1, undefined, "2026-10-15T02:00:00")], () => Promise.resolve(srvRow(1, remote, "2026-10-15T02:00:00")));
  assert.equal(r.merged, 1);
  cur = await rawRec("d");
  const mergedJson = await blobStore.getBytes(cur.blob_ref);
  assert.deepEqual(shapeIds(mergedJson), ["shape:T"], "S tidak hidup lagi");
  assert.equal(cur.dirty, 1);
  assert.equal(cur.base_rev, "2026-10-15T02:00:00");
  assert.equal(await blobStore.getBytes(cur.base_blob_ref), remote, "dasar baru = data remote");
  const ids = await allBlobIds();
  assert.ok(!ids.includes(rec.blob_ref), "blob dasar lama dibuang");
  assert.equal(ids.length, 2, "hanya blob isi + blob dasar yang tersisa");
  // push berikutnya mengirim hasil merge; setelah sukses dasar = data yang terkirim (berbagi blob)
  const tr = transport(() => ({ status: 200, data: { id: 1, updated_at: "2026-10-15T03:00:00" } }));
  await pushOutbox(tr);
  assert.deepEqual(shapeIds(tr.calls[0].body.data_json), ["shape:T"]);
  cur = await rawRec("d");
  assert.equal(cur.dirty, 0);
  assert.equal(cur.base_rev, "2026-10-15T03:00:00");
  assert.equal(cur.base_blob_ref, cur.blob_ref);
  assert.equal((await allBlobIds()).length, 1, "blob dasar remote dibuang setelah diganti");
});

test("pull: record without base (legacy) still merges as union", async () => {
  const rec = await syncedRecord("d", 1, tlSnap({ "shape:S": { x: 10 } }), "2026-10-15T01:00:00", { base_blob_ref: undefined, base_title: undefined });
  await repo.updateDrawing("d", { data_json: tlSnap({ "shape:S": { x: 10 }, "shape:T": { x: 50 } }) }, {});
  const r = await pullDrawings([srvRow(1, undefined, "2026-10-15T02:00:00")], () => Promise.resolve(srvRow(1, tlSnap({}), "2026-10-15T02:00:00")));
  assert.equal(r.merged, 1);
  const cur = await rawRec("d");
  assert.deepEqual(shapeIds(await blobStore.getBytes(cur.blob_ref)), ["shape:S", "shape:T"]);
  assert.ok(cur.base_blob_ref, "dasar kini tercatat untuk merge berikutnya");
  void rec;
});

// ── markDrawingPushed: data terkirim = dasar baru ────────────────────────────────────────────────
test("push: edit during an in-flight PUT → base = SENT data (new blob), current blob stays the newer edit", async () => {
  const v1 = tlSnap({ "shape:S": { x: 1 } });
  const v2 = tlSnap({ "shape:S": { x: 1 }, "shape:T": { x: 2 } });
  await syncedRecord("d", 1, tlSnap({}), "2026-10-15T00:00:00");
  await repo.updateDrawing("d", { data_json: v1 }, {}); // dirty, op update
  const tr = transport(
    () => ({ status: 200, data: { id: 1, updated_at: "2026-10-15T01:00:00" } }),
    (n) => (n === 1 ? repo.updateDrawing("d", { data_json: v2 }, {}) : null),
  );
  await pushOutbox(tr);
  assert.equal(tr.calls[0].body.data_json, v1);
  const cur = await rawRec("d");
  assert.equal(cur.dirty, 1, "edit in-flight tetap dirty");
  assert.equal(await blobStore.getBytes(cur.blob_ref), v2);
  assert.equal(await blobStore.getBytes(cur.base_blob_ref), v1, "dasar = data yang terkirim");
  assert.equal(cur.base_rev, "2026-10-15T01:00:00");
  assert.equal(cur.base_title, "T");
  assert.ok((await outboxAll()).some((o) => o.op === "update" && o.cid === "d"));
  assert.equal((await allBlobIds()).length, 2);
});

test("push: PUT without data (data_missing record) clears the base (falls back to union later)", async () => {
  const rec = await syncedRecord("d", 1, tlSnap({}), "2026-10-15T00:00:00", { data_missing: 1, dirty: 1, rev: 1 });
  await outboxAdd({ op: "update", entity_type: "drawing", cid: "d", payload: { title: "Judul" } });
  const tr = transport(() => ({ status: 200, data: { id: 1, updated_at: "2026-10-15T01:00:00" } }));
  await pushOutbox(tr);
  assert.equal(tr.calls[0].body.data_json, undefined);
  const cur = await rawRec("d");
  assert.equal(cur.base_blob_ref, null);
  assert.equal(cur.base_rev, "2026-10-15T01:00:00");
  void rec;
});

// ── S3: judul ────────────────────────────────────────────────────────────────────────────────────
test("S3: local rename survives a merge when the remote title is unchanged; remote rename wins when local didn't rename", async () => {
  const base = tlSnap({ "shape:S": { x: 1 } });
  await syncedRecord("d", 1, base, "2026-10-15T01:00:00", { title: "Lama", base_title: "Lama" });
  await repo.updateDrawing("d", { title: "Baru" }, {}); // rename lokal (data tetap)
  const r = await pullDrawings([srvRow(1, undefined, "2026-10-15T02:00:00", { title: "Lama" })],
    () => Promise.resolve(srvRow(1, tlSnap({ "shape:S": { x: 1 }, "shape:U": { x: 3 } }), "2026-10-15T02:00:00", { title: "Lama" })));
  assert.equal(r.merged, 1);
  let cur = await rawRec("d");
  assert.equal(cur.title, "Baru", "rename lokal tidak hilang");
  assert.equal(cur.base_title, "Lama");
  assert.deepEqual(shapeIds(await blobStore.getBytes(cur.blob_ref)), ["shape:S", "shape:U"]);
  // remote rename, lokal tidak rename → remote menang
  await syncedRecord("e", 2, base, "2026-10-15T01:00:00", { title: "Lama", base_title: "Lama" });
  await repo.updateDrawing("e", { data_json: tlSnap({ "shape:S": { x: 1 }, "shape:T": { x: 2 } }) }, {});
  await pullDrawings([srvRow(2, undefined, "2026-10-15T02:00:00", { title: "Remote" })],
    () => Promise.resolve(srvRow(2, base, "2026-10-15T02:00:00", { title: "Remote" })));
  cur = await rawRec("e");
  assert.equal(cur.title, "Remote");
  assert.equal(cur.base_title, "Remote");
  // keduanya rename → remote (perilaku lama)
  await syncedRecord("f", 3, base, "2026-10-15T01:00:00", { title: "Lama", base_title: "Lama" });
  await repo.updateDrawing("f", { title: "LokalBaru" }, {});
  await pullDrawings([srvRow(3, undefined, "2026-10-15T02:00:00", { title: "RemoteBaru" })],
    () => Promise.resolve(srvRow(3, base, "2026-10-15T02:00:00", { title: "RemoteBaru" })));
  assert.equal((await rawRec("f")).title, "RemoteBaru");
});

// ── Siklus blob: adopsi server & hapus record ────────────────────────────────────────────────────
test("pull adopt (clean record) shares the blob as base and drops the previous content + base blobs; deleting a record drops both", async () => {
  const rec = await syncedRecord("d", 1, tlSnap({ "shape:S": {} }), "2026-10-15T01:00:00");
  const r = await pullDrawings([srvRow(1, undefined, "2026-10-15T02:00:00")], () => Promise.resolve(srvRow(1, tlSnap({ "shape:S": {}, "shape:U": {} }), "2026-10-15T02:00:00")));
  assert.equal(r.updated, 1);
  const cur = await rawRec("d");
  assert.equal(cur.base_blob_ref, cur.blob_ref);
  assert.equal(cur.base_title, "T");
  assert.notEqual(cur.blob_ref, rec.blob_ref);
  assert.deepEqual(await allBlobIds(), [cur.blob_ref]);
  // record dihapus di server (404 eksplisit) → record + blob (dasar) dibuang
  const r2 = await pullDrawings([], () => Promise.resolve({ status: 404 }));
  assert.equal(r2.deleted, 1);
  assert.equal((await allRecs()).length, 0);
  assert.deepEqual(await allBlobIds(), []);
});
