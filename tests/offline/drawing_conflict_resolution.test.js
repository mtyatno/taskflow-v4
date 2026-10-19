"use strict";
// Workstream D (audit 2026-10-15): S2 PUT drawing 404 → conflict remote_deleted (+ resolusi), S4 data_missing
// dibersihkan saat blob ditulis, T13 sync_error tidak diantre ulang (heal/pull) & muncul di conflict bar,
// Low: blob tidak bocor (hapus gambar belum di-push, buang konflik), listDrawings memakai X-TF-Sync.
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { deleteDB } = require("./setup.js");
const { DB_NAME, _reset, openDB } = require("../../static/offline/db.js");
const { mapPut, serverIdOf } = require("../../static/offline/idmap.js");
const { outboxAll, outboxAdd } = require("../../static/offline/outbox.js");
const { makeBlobStore } = require("../../static/offline/blobstore.js");
const { pullDrawings } = require("../../static/offline/syncpull.js");
const { pushOutbox, healStrandedDrawings } = require("../../static/offline/syncpush.js");
const { listConflicts, resolveConflict } = require("../../static/offline/syncconflict.js");
const repo = require("../../static/offline/drawingrepo.js");

beforeEach(async () => { _reset(); await deleteDB(DB_NAME); });
const blobStore = makeBlobStore();
const snap = (ids) => JSON.stringify({ store: Object.fromEntries((ids || []).map((id) => ["shape:" + id, { id: "shape:" + id, typeName: "shape", x: 1 }])), schema: { schemaVersion: 2 } });

async function rawRec(cid) {
  const db = await openDB();
  return new Promise((res) => { const q = db.transaction("drawings").objectStore("drawings").get(cid); q.onsuccess = () => res(q.result || null); });
}
async function allRecs() {
  const db = await openDB();
  return new Promise((res) => { const q = db.transaction("drawings").objectStore("drawings").getAll(); q.onsuccess = () => res(q.result || []); });
}
async function allBlobIds() {
  const db = await openDB();
  return new Promise((res) => { const q = db.transaction("blobs").objectStore("blobs").getAllKeys(); q.onsuccess = () => res(q.result || []); });
}
async function putRecs(recs) {
  const db = await openDB();
  await new Promise((res, rej) => { const tx = db.transaction("drawings", "readwrite"); for (const r of recs) tx.objectStore("drawings").put(r); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); });
}
async function record(cid, sid, dataJson, over) {
  const ref = dataJson != null ? await blobStore.put(dataJson, { mime: "application/json" }) : null;
  const rec = Object.assign({
    cid, server_id: sid, title: "T", blob_ref: ref, base_blob_ref: ref, base_title: "T", svg_preview: "", svg_stale: 0, is_pinned: 0,
    created_at: "2026-10-15T00:00:00", updated_at: "2026-10-15T00:00:00", deleted: false, dirty: 0, base_rev: "2026-10-15T00:00:00", rev: 0,
  }, over || {});
  await putRecs([rec]);
  if (sid != null) await mapPut("drawing", sid, cid);
  return rec;
}
const srvRow = (id, dataJson, updatedAt, over) => Object.assign({ id, title: "T", data_json: dataJson, svg_preview: "", is_pinned: 0, tags: [], updated_at: updatedAt, created_at: "x" }, over || {});
function transport(handler) {
  const calls = [];
  return { calls, request(method, path, body) { calls.push({ method, path, body }); return Promise.resolve(handler(method, path, body, calls.length)); } };
}

// ── S2 ──────────────────────────────────────────────────────────────────────────────────────────
test("S2: PUT 404 → conflict remote_deleted, record + blob kept, op dropped; pull neither overwrites nor deletes it", async () => {
  const rec = await record("d", 7, snap(["a"]), { dirty: 1, rev: 1 });
  await repo.updateDrawing("d", { data_json: snap(["a", "b"]) }, {});
  const tr = transport(() => ({ status: 404, data: { detail: "nf" } }));
  const r = await pushOutbox(tr);
  assert.equal(r.failed, 1);
  let cur = await rawRec("d");
  assert.equal(cur.conflict, "remote_deleted");
  assert.equal(cur.dirty, 1);
  assert.equal(await blobStore.getBytes(cur.blob_ref), snap(["a", "b"]));
  assert.equal((await outboxAll()).length, 0);
  // pull: daftar server tanpa gambar ini + konfirmasi 404 → TIDAK dihapus (conflict)
  const r2 = await pullDrawings([], () => Promise.resolve({ status: 404 }));
  assert.equal(r2.deleted, 0);
  assert.ok(await rawRec("d"));
  // pull: gambar muncul lagi di server → record conflict tidak ditimpa
  const r3 = await pullDrawings([srvRow(7, undefined, "2026-10-15T05:00:00")], () => Promise.resolve(srvRow(7, snap(["z"]), "2026-10-15T05:00:00")));
  assert.equal(r3.updated + r3.merged, 0);
  cur = await rawRec("d");
  assert.equal(await blobStore.getBytes(cur.blob_ref), snap(["a", "b"]));
  assert.equal((await outboxAll()).length, 0, "pull tidak mengantre ulang record conflict");
  // conflict bar
  const list = await listConflicts();
  const c = list.find((x) => x.entity === "drawing" && x.cid === "d");
  assert.ok(c);
  assert.equal(c.conflict, "remote_deleted");
  void rec;
});

test("S2: resolveConflict(drawing, keep_as_new) → server_id null, fresh client_id, create op; next push POSTs the local data", async () => {
  await record("d", 7, snap(["a", "b"]), { dirty: 1, rev: 2, conflict: "remote_deleted" });
  const res = await resolveConflict("drawing", "d", "keep_as_new");
  assert.equal(res.ok, true);
  const cur = await rawRec("d");
  assert.equal(cur.server_id, null);
  assert.equal(cur.conflict, undefined);
  assert.ok(cur.client_id && cur.client_id !== "d");
  assert.equal(cur.base_rev, null);
  assert.equal(await serverIdOf("d"), undefined);
  const ops = await outboxAll();
  assert.deepEqual(ops.map((o) => [o.op, o.cid]), [["create", "d"]]);
  assert.equal(ops[0].payload.title, "T");
  const tr = transport(() => ({ status: 200, data: { id: 99, updated_at: "2026-10-15T06:00:00" } }));
  const r = await pushOutbox(tr);
  assert.equal(r.pushed, 1);
  assert.equal(tr.calls[0].method, "POST");
  assert.equal(tr.calls[0].body.data_json, snap(["a", "b"]));
  assert.equal(tr.calls[0].body.client_id, cur.client_id);
  assert.equal((await rawRec("d")).server_id, 99);
});

test("S2: resolveConflict(drawing, discard) removes record, idmap AND its blobs", async () => {
  await record("d", 7, snap(["a"]), { dirty: 1, rev: 2, conflict: "remote_deleted" });
  assert.equal((await allBlobIds()).length, 1);
  await resolveConflict("drawing", "d", "discard");
  assert.equal(await rawRec("d"), null);
  assert.equal(await serverIdOf("d"), undefined);
  assert.deepEqual(await allBlobIds(), []);
});

// ── S4 ──────────────────────────────────────────────────────────────────────────────────────────
test("S4: mergeDirtyDrawing clears data_missing when it writes the merged blob", async () => {
  // record data_missing yang jadi dirty (mis. judul diubah) lalu server punya data → merge menulis blob nyata
  await record("d", 7, null, { data_missing: 1, dirty: 1, rev: 1, base_rev: "2026-10-15T00:00:00", base_blob_ref: null, title: "Baru", base_title: "T" });
  await outboxAdd({ op: "update", entity_type: "drawing", cid: "d", payload: { title: "Baru" } });
  const r = await pullDrawings([srvRow(7, undefined, "2026-10-15T02:00:00")], () => Promise.resolve(srvRow(7, snap(["s"]), "2026-10-15T02:00:00")));
  assert.equal(r.merged, 1);
  const cur = await rawRec("d");
  assert.equal(cur.data_missing, 0);
  assert.ok(repo.sameContent(await blobStore.getBytes(cur.blob_ref), snap(["s"])));
  assert.equal(cur.title, "Baru", "rename lokal dipertahankan (S3)");
  assert.equal(cur.dirty, 1);
  // getDrawing kini mengembalikan datanya (bukan data_missing)
  const d = await repo.getDrawing("d", { online: false });
  assert.equal(d.data_missing, 0);
  assert.ok(repo.sameContent(d.data_json, snap(["s"])));
});

// ── T13 ─────────────────────────────────────────────────────────────────────────────────────────
test("T13: permanent 4xx on create → sync_error; heal/pull never requeue it; conflict bar offers retry / discard_local", async () => {
  const d = await repo.createDrawing({ title: "Besar", data_json: snap(["a"]) }, {});
  const tr = transport(() => ({ status: 422, data: { detail: [{ msg: "data_json terlalu besar" }] } }));
  const r = await pushOutbox(tr);
  assert.equal(r.failed, 1);
  let cur = await rawRec(d.cid);
  assert.equal(cur.sync_error.status, 422);
  assert.match(cur.sync_error.detail, /terlalu besar/);
  assert.equal(cur.dirty, 1);
  assert.equal((await outboxAll()).length, 0);
  assert.equal(await healStrandedDrawings(), 0, "heal tidak mengantre ulang record sync_error");
  await pullDrawings([], () => Promise.resolve({ status: 404 }));
  assert.equal((await outboxAll()).length, 0, "pull tidak mengantre ulang record sync_error");
  assert.ok(await rawRec(d.cid), "pull tidak menghapus record sync_error");
  // drain berikutnya tidak mengulang upload
  const tr2 = transport(() => { throw new Error("tidak boleh ada request"); });
  await pushOutbox(tr2);
  assert.equal(tr2.calls.length, 0);
  const c = (await listConflicts()).find((x) => x.entity === "drawing" && x.cid === d.cid);
  assert.equal(c.conflict, "sync_error");
  assert.equal(c.status, 422);
  // retry → op create lagi
  await resolveConflict("drawing", d.cid, "retry");
  cur = await rawRec(d.cid);
  assert.equal(cur.sync_error, undefined);
  assert.deepEqual((await outboxAll()).map((o) => o.op), ["create"]);
  // discard_local pada record tanpa server_id → record + blob dibuang
  await resolveConflict("drawing", d.cid, "discard_local");
  assert.equal(await rawRec(d.cid), null);
  assert.deepEqual(await allBlobIds(), []);
});

test("T13: permanent 4xx on update → sync_error; pull skips it (no overwrite, no requeue); discard_local takes the server version", async () => {
  await record("d", 7, snap(["a"]), { dirty: 1, rev: 1 });
  await repo.updateDrawing("d", { data_json: snap(["a", "b"]) }, {});
  await pushOutbox(transport(() => ({ status: 413, data: { detail: "too large" } })));
  let cur = await rawRec("d");
  assert.equal(cur.sync_error.status, 413);
  const r = await pullDrawings([srvRow(7, undefined, "2026-10-15T05:00:00")], () => Promise.resolve(srvRow(7, snap(["srv"]), "2026-10-15T05:00:00")));
  assert.equal(r.skipped, 1);
  assert.equal((await outboxAll()).length, 0);
  assert.equal(await blobStore.getBytes((await rawRec("d")).blob_ref), snap(["a", "b"]));
  await resolveConflict("drawing", "d", "discard_local");
  cur = await rawRec("d");
  assert.equal(cur.dirty, 0);
  assert.equal(cur.base_rev, null);
  const r2 = await pullDrawings([srvRow(7, undefined, "2026-10-15T05:00:00")], () => Promise.resolve(srvRow(7, snap(["srv"]), "2026-10-15T05:00:00")));
  assert.equal(r2.updated, 1);
  assert.equal(await blobStore.getBytes((await rawRec("d")).blob_ref), snap(["srv"]));
});

// ── Low: blob tidak bocor ────────────────────────────────────────────────────────────────────────
test("Low: deleting a never-pushed drawing drops its blob immediately and the delete op purges the tombstone (no POST)", async () => {
  const d = await repo.createDrawing({ title: "X", data_json: snap(["a"]) }, {});
  assert.equal((await allBlobIds()).length, 1);
  await repo.deleteDrawing(d.cid);
  assert.deepEqual(await allBlobIds(), [], "blob dibuang saat dihapus");
  const ops = await outboxAll();
  assert.deepEqual(ops.map((o) => o.op), ["delete"], "op create dibuang, hanya op delete");
  const tr = transport(() => { throw new Error("tidak boleh ada request"); });
  await pushOutbox(tr);
  assert.equal(tr.calls.length, 0);
  assert.equal(await rawRec(d.cid), null, "tombstone dibuang tanpa sisa");
  assert.equal((await outboxAll()).length, 0);
});

test("Low: DELETE of a pushed drawing purges record + blobs + idmap after the server confirms (200 or 404)", async () => {
  await record("d", 7, snap(["a"]));
  await repo.deleteDrawing("d");
  assert.equal((await allBlobIds()).length, 1, "blob masih ada sampai server dikonfirmasi");
  const tr = transport(() => ({ status: 404, data: { detail: "gone" } }));
  const r = await pushOutbox(tr);
  assert.equal(r.pushed, 1);
  assert.equal(tr.calls[0].method, "DELETE");
  assert.equal(await rawRec("d"), null);
  assert.deepEqual(await allBlobIds(), []);
  assert.equal(await serverIdOf("d"), undefined);
});

test("Low: listDrawings fetches /api/drawings with X-TF-Sync (never the stale SW cache)", () => {
  const src = require("fs").readFileSync(require.resolve("../../static/offline/drawingrepo.js"), "utf8");
  const m = src.match(/window\.fetch\("\/api\/drawings\?shared=1", \{ headers: \{[^}]*\} \}\)/);
  assert.ok(m, "fetch daftar harus ada");
  assert.match(m[0], /"X-TF-Sync": "1"/);
});
