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

// ---- fix round 1 ----
const { mapPut, cidOf } = require("../../static/offline/idmap.js");
const { pushOutbox } = require("../../static/offline/syncpush.js");
function transport(handler) {
  const calls = [];
  return { calls, request(method, path, body) { calls.push({ method, path, body }); return Promise.resolve(handler(method, path, body)); } };
}
const srvRow = (over) => Object.assign({ id: 9, title: "M", data_json: DATA, is_pinned: 0, list_id: null, user_id: 1,
  client_id: "m1", created_at: "t0", updated_at: "t" }, over);
async function syncedMap(over) {
  await put("mindmaps", [Object.assign({ cid: "m1", server_id: 9, title: "M", data_json: DATA, deleted: false, dirty: 0, rev: 1, base_rev: "t" }, over)]);
  await mapPut("mindmap", 9, "m1");
}

test("restore with dirty_before_delete=1 requeues exactly one update op", async () => {
  await syncedMap({ dirty: 1 });
  await put("_outbox", [{ op: "update", entity_type: "mindmap", cid: "m1", payload: { cid: "m1" } }]);
  await mm.deleteMindmap("m1");
  await T.restore("m1");
  const rec = await get("mindmaps", "m1");
  assert.equal(rec.dirty, 1); assert.equal(rec.dirty_before_delete, undefined);
  assert.deepEqual((await outboxAll()).filter((o) => o.cid === "m1").map((o) => o.op), ["update"]);
});

test("restore of a never-synced record re-adds its create op", async () => {
  const r = await mm.createMindmap({ title: "Baru", data_json: DATA });
  await mm.deleteMindmap(r.cid);
  // push sempat membuang op create (record terhapus) sebelum pengguna memulihkan
  for (const o of (await outboxAll()).filter((x) => x.op === "create")) await require("../../static/offline/outbox.js").outboxRemove(o.qid);
  assert.deepEqual(await T.restore(r.cid), { restored: "local", cid: r.cid });
  const rec = await get("mindmaps", r.cid);
  assert.equal(rec.deleted, false); assert.equal(rec.dirty, 1);
  assert.deepEqual((await outboxAll()).filter((o) => o.cid === r.cid).map((o) => o.op), ["create"]);
});

test("restoreLocal of a missing record rejects 404", async () => {
  await assert.rejects(mm.restoreLocal("nope"), (e) => e.status === 404 && e.message === "Mindmap tidak ada di Sampah");
});

test("mirror restore is idempotent: double restore queues one op", async () => {
  await T.writeMirror([item()]);
  await Promise.all([T.restore("5"), T.restore("5")]);
  assert.equal((await outboxAll()).filter((o) => o.op === "restore").length, 1);
  assert.deepEqual((await T.readMirror()).restoring, [5]);
});

test("restore while DELETE is in flight: record survives, server row restored with same id, edit pushed", async () => {
  await syncedMap();
  await mm.deleteMindmap("m1");
  const tr = transport(async (m, p) => {
    if (m === "DELETE" && p === "/api/mindmaps/9") {
      await T.restore("m1");                                   // pengguna memulihkan saat DELETE in-flight
      await mm.updateMindmap("m1", { title: "Edit" });          // lalu mengedit
      return { status: 200, data: { ok: true, trashed: true } };
    }
    if (m === "POST" && p === "/api/mindmaps/trash/9/restore") return { status: 200, data: srvRow() };
    if (m === "PUT" && p === "/api/mindmaps/9") return { status: 200, data: srvRow({ title: "Edit", updated_at: "t2" }) };
    return { status: 500, data: {} };
  });
  await pushOutbox(tr);
  let rec = await get("mindmaps", "m1");
  assert.ok(rec); assert.equal(rec.deleted, false); assert.equal(rec.server_id, 9); assert.equal(rec.title, "Edit");
  assert.equal(await cidOf("mindmap", 9), "m1");
  assert.ok(tr.calls.some((c) => c.method === "POST" && c.path === "/api/mindmaps/trash/9/restore"));
  await pushOutbox(tr); // op update susulan
  assert.ok(tr.calls.some((c) => c.method === "PUT" && c.path === "/api/mindmaps/9"));
  rec = await get("mindmaps", "m1");
  assert.equal(rec.dirty, 0);
  assert.deepEqual(await outboxAll(), []);
  assert.deepEqual(await T.listTrash(), []);
});

test("restore while DELETE in flight, restore POST 503: marker kept, update held, retried later", async () => {
  await syncedMap();
  await mm.deleteMindmap("m1");
  let restoreStatus = 503;
  const tr = transport(async (m, p) => {
    if (m === "DELETE") { await T.restore("m1"); await mm.updateMindmap("m1", { title: "E" }); return { status: 200, data: {} }; }
    if (m === "POST") return restoreStatus === 200 ? { status: 200, data: srvRow() } : { status: 503, data: {} };
    if (m === "PUT") return { status: 200, data: srvRow({ title: "E", updated_at: "t2" }) };
    return { status: 500, data: {} };
  });
  await pushOutbox(tr);
  await pushOutbox(tr); // update ditahan selama penanda masih ada
  assert.ok(!tr.calls.some((c) => c.method === "PUT"));
  const ops = await outboxAll();
  assert.ok(ops.some((o) => o.op === "delete" && o.payload.then_restore_sid === 9));
  restoreStatus = 200;
  await pushOutbox(tr);
  await pushOutbox(tr);
  assert.ok(tr.calls.some((c) => c.method === "PUT" && c.path === "/api/mindmaps/9"));
  assert.equal((await get("mindmaps", "m1")).server_id, 9);
  assert.deepEqual(await outboxAll(), []);
});

test("restore while DELETE in flight and server says 404 → record recreated (create op, same client_id)", async () => {
  await syncedMap();
  await mm.deleteMindmap("m1");
  const tr = transport(async (m) => {
    if (m === "DELETE") { await T.restore("m1"); return { status: 404, data: {} }; }
    return { status: 500, data: {} };
  });
  await pushOutbox(tr);
  const rec = await get("mindmaps", "m1");
  assert.equal(rec.server_id, null); assert.equal(rec.dirty, 1); assert.equal(rec.client_id, "m1");
  assert.deepEqual((await outboxAll()).map((o) => o.op), ["create"]);
});

test("restore before the delete op is sent: no DELETE request", async () => {
  await syncedMap();
  await mm.deleteMindmap("m1");
  await T.restore("m1");
  const tr = transport(() => ({ status: 500, data: {} }));
  await pushOutbox(tr);
  assert.ok(!tr.calls.some((c) => c.method === "DELETE"));
  assert.ok(await get("mindmaps", "m1"));
});

test("forbidden delete restores dirty_before_delete and clears trash fields", async () => {
  await syncedMap({ dirty: 1 });
  await mm.deleteMindmap("m1");
  await pushOutbox(transport((m) => (m === "DELETE" ? { status: 403, data: {} } : { status: 503, data: {} })));
  const rec = await get("mindmaps", "m1");
  assert.equal(rec.deleted, false); assert.equal(rec.dirty, 1);
  assert.equal(rec.trashed_at, undefined); assert.equal(rec.dirty_before_delete, undefined);
  assert.equal(rec.notice.kind, "delete_refused");
});
