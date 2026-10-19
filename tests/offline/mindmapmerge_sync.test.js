"use strict";
// PR B #4 (Task B4): merge per node di push 409 / pull, basis maju setelah push sukses, pullMindmapOne.
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { deleteDB } = require("./setup.js");
const { DB_NAME, _reset, openDB } = require("../../static/offline/db.js");
const mm = require("../../static/offline/mindmaprepo.js");
const { mapPut } = require("../../static/offline/idmap.js");
const { pushOutbox } = require("../../static/offline/syncpush.js");
const { pullMindmaps, pullMindmapOne } = require("../../static/offline/syncpull.js");

beforeEach(async () => { _reset(); await deleteDB(DB_NAME); mm.setCurrentUser(null); });

async function put(store, recs) {
  const db = await openDB();
  await new Promise((res, rej) => {
    const tx = db.transaction(store, "readwrite");
    for (const r of recs) tx.objectStore(store).put(r);
    tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error);
  });
}
async function get(store, cid) {
  const db = await openDB();
  return new Promise((res) => { const q = db.transaction(store).objectStore(store).get(cid); q.onsuccess = () => res(q.result); });
}
async function all(store) {
  const db = await openDB();
  return new Promise((res) => { const q = db.transaction(store).objectStore(store).getAll(); q.onsuccess = () => res(q.result || []); });
}
function rec(over) {
  return Object.assign({
    cid: over.cid, server_id: null, title: "M", data_json: "{\"v\":1}", pinned: false, list_id: null, user_id: 1,
    last_edited_by: 1, last_editor_username: null, last_editor_display_name: null,
    created_at: "2026-10-15T00:00:00", updated_at: "2026-10-15T00:00:00", deleted: false, dirty: 1, base_rev: null, rev: 1,
  }, over);
}
function srvRow(over) {
  return Object.assign({
    id: over.id, title: "Srv", data_json: "{\"srv\":1}", is_pinned: 0, list_id: null, user_id: 1,
    last_edited_by: 2, last_editor_username: "bob", last_editor_display_name: "Bob",
    created_at: "2026-10-15T00:00:00", updated_at: "2026-10-15T09:00:00",
  }, over);
}
function transport(handler) {
  const calls = [];
  return {
    calls,
    request(method, path, body) {
      calls.push({ method, path, body });
      return Promise.resolve(handler(method, path, body, calls.length));
    },
  };
}
const rev409 = (current) => ({ status: 409, data: { detail: { code: "REV_MISMATCH", current } } });
const okRes = (body) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });

const D = (topics) => JSON.stringify({ nodeData: { id: "root", topic: "Akar", root: true,
  children: topics.map((t, i) => ({ id: "n" + i, topic: t, children: [] })) } });
const B = D(["A", "B"]), L = D(["A lokal", "B"]), S = D(["A", "B server"]);
const topics = (json) => JSON.parse(json).nodeData.children.map((c) => c.topic);
// Catatan: brief menulis rec tanpa base_data_rev; sejak B3 fix 1 basis hanya sah bila base_data_rev === base_rev.
const based = { base_data_json: B, base_title: "M", base_rev: "t1", base_data_rev: "t1" };

test("push 409 with base → merged + requeued; next push sends merged doc with new base_rev; base advanced", async () => {
  await put("mindmaps", [rec(Object.assign({ cid: "m", server_id: 10, title: "M", data_json: L, dirty: 1, rev: 1 }, based))]);
  await mapPut("mindmap", 10, "m");
  await put("_outbox", [{ qid: 1, op: "update", entity_type: "mindmap", cid: "m", payload: {} }]);
  const tr = transport((m, p, body, n) => (n === 1
    ? rev409(srvRow({ id: 10, title: "M", data_json: S, updated_at: "t2" }))
    : { status: 200, data: srvRow({ id: 10, title: "M", data_json: body.data_json, updated_at: "t3" }) }));
  const r1 = await pushOutbox(tr);
  assert.equal(r1.requeued, 1);
  assert.equal(r1.merged, 1);
  assert.equal(r1.conflicts || 0, 0);
  assert.equal((await all("mindmaps")).length, 1);
  await pushOutbox(tr);
  const sent = tr.calls[1].body;
  assert.equal(sent.base_rev, "t2");
  assert.deepEqual(topics(sent.data_json), ["A lokal", "B server"]);
  const r = await get("mindmaps", "m");
  assert.deepEqual([r.dirty, r.base_rev, r.base_data_json], [0, "t3", sent.data_json]);
  assert.equal(r.base_data_rev, "t3");
});

test("push 409 same node → server value kept, conflict copy queued, counted as conflict", async () => {
  const L2 = D(["A lokal", "B lokal"]);
  await put("mindmaps", [rec(Object.assign({ cid: "m", server_id: 10, title: "M", data_json: L2, dirty: 1, rev: 1 }, based))]);
  await mapPut("mindmap", 10, "m");
  await put("_outbox", [{ qid: 1, op: "update", entity_type: "mindmap", cid: "m", payload: {} }]);
  const tr = transport(() => rev409(srvRow({ id: 10, title: "M", data_json: S, updated_at: "t2" })));
  const r1 = await pushOutbox(tr);
  assert.equal(r1.merged, 1);
  assert.equal(r1.conflicts, 1);
  assert.equal(r1.requeued, 1); // "A lokal" tetap perlu dikirim
  const rows = await all("mindmaps");
  assert.equal(rows.length, 2);
  const orig = rows.find((x) => x.cid === "m");
  assert.deepEqual(topics(orig.data_json), ["A lokal", "B server"]);
  assert.equal(orig.notice.kind, "merge_conflict");
  const copy = rows.find((x) => x.cid !== "m");
  assert.equal(copy.data_json, L2);
  const ops = (await all("_outbox")).map((o) => o.op + ":" + (o.cid === "m" ? "m" : "copy")).sort();
  assert.deepEqual(ops, ["create:copy", "update:m"]);
});

test("push 409 without valid base → old adopt + whole-map conflict copy, nothing requeued", async () => {
  await put("mindmaps", [rec({ cid: "m", server_id: 10, title: "M", data_json: L, base_data_json: B, base_title: "M", base_rev: "t1", dirty: 1, rev: 1 })]);
  await mapPut("mindmap", 10, "m");
  await put("_outbox", [{ qid: 1, op: "update", entity_type: "mindmap", cid: "m", payload: {} }]);
  const tr = transport(() => rev409(srvRow({ id: 10, title: "M", data_json: S, updated_at: "t2" })));
  const r1 = await pushOutbox(tr);
  assert.equal(r1.conflicts, 1);
  assert.equal(r1.requeued, 0);
  assert.equal(r1.merged, undefined);
  const rows = await all("mindmaps");
  assert.equal(rows.length, 2);
  assert.equal(rows.find((x) => x.cid === "m").data_json, S);
  assert.equal(rows.find((x) => x.cid !== "m").data_json, L);
});

test("push success advances the base: later remote edit via pull merges with the pushed edit (B3 critical)", async () => {
  await put("mindmaps", [rec(Object.assign({ cid: "m", server_id: 10, title: "M", data_json: L, dirty: 1, rev: 1 }, based))]);
  await mapPut("mindmap", 10, "m");
  await put("_outbox", [{ qid: 1, op: "update", entity_type: "mindmap", cid: "m", payload: {} }]);
  const tr = transport((m, p, body) => ({ status: 200, data: srvRow({ id: 10, title: "M", data_json: body.data_json, updated_at: "t2" }) }));
  await pushOutbox(tr);
  const pushed = await get("mindmaps", "m");
  assert.deepEqual([pushed.dirty, pushed.base_rev, pushed.base_data_rev, pushed.base_data_json], [0, "t2", "t2", L]);
  // edit lokal berikutnya (node baru) tanpa push, lalu edit server pada node B tiba lewat pull
  const local2 = JSON.stringify({ nodeData: Object.assign(JSON.parse(L).nodeData, {
    children: JSON.parse(L).nodeData.children.concat([{ id: "n9", topic: "C lokal", children: [] }]) }) });
  await put("mindmaps", [Object.assign({}, pushed, { data_json: local2, dirty: 1, rev: (pushed.rev || 0) + 1 })]);
  await put("_outbox", [{ qid: 5, op: "update", entity_type: "mindmap", cid: "m", payload: {} }]);
  const remote = D(["A lokal", "B server"]);
  const row = srvRow({ id: 10, title: "M", data_json: remote, updated_at: "t3" });
  const res = await pullMindmaps([row], () => Promise.resolve(row), null);
  assert.equal(res.merged, 1);
  assert.equal(res.conflictCopies, 0);
  const r = await get("mindmaps", "m");
  assert.deepEqual(topics(r.data_json), ["A lokal", "B server", "C lokal"]);
  assert.equal((await all("mindmaps")).length, 1);
});

test("POST create success sets the merge base from the response", async () => {
  await put("mindmaps", [rec({ cid: "n", server_id: null, title: "M", data_json: L, dirty: 1, rev: 1 })]);
  await put("_outbox", [{ qid: 1, op: "create", entity_type: "mindmap", cid: "n", payload: { cid: "n" } }]);
  const tr = transport((m, p, body) => ({ status: 200, data: srvRow({ id: 33, title: body.title, data_json: body.data_json, updated_at: "t5" }) }));
  await pushOutbox(tr);
  const r = await get("mindmaps", "n");
  assert.deepEqual([r.server_id, r.dirty, r.base_rev, r.base_data_rev, r.base_data_json, r.base_title], [33, 0, "t5", "t5", L, "M"]);
});

test("pull: dirty record with pending op and changed server row is merged, not copied", async () => {
  await put("mindmaps", [rec(Object.assign({ cid: "m", server_id: 10, title: "M", data_json: L, dirty: 1, rev: 1 }, based))]);
  await mapPut("mindmap", 10, "m");
  await put("_outbox", [{ qid: 1, op: "update", entity_type: "mindmap", cid: "m", payload: {} }]);
  const row = srvRow({ id: 10, title: "M", data_json: S, updated_at: "t2" });
  const res = await pullMindmaps([row], () => Promise.resolve(row), null);
  assert.equal(res.merged, 1); assert.equal(res.conflictCopies, 0);
  assert.equal((await all("mindmaps")).length, 1);
  assert.deepEqual(res.changed.map((c) => c.cid), ["m"]);
  const r = await get("mindmaps", "m");
  assert.deepEqual(topics(r.data_json), ["A lokal", "B server"]);
  assert.equal(r.dirty, 1);
  assert.equal(r.base_rev, "t2");
  assert.deepEqual((await all("_outbox")).map((o) => o.op), ["update"]);
});

test("pull: dirty record without valid base still gets the old conflict copy", async () => {
  await put("mindmaps", [rec({ cid: "m", server_id: 10, title: "M", data_json: L, base_rev: "t1", dirty: 1, rev: 1 })]);
  await mapPut("mindmap", 10, "m");
  await put("_outbox", [{ qid: 1, op: "update", entity_type: "mindmap", cid: "m", payload: {} }]);
  const row = srvRow({ id: 10, title: "M", data_json: S, updated_at: "t2" });
  const res = await pullMindmaps([row], () => Promise.resolve(row), null);
  assert.equal(res.merged, 0); assert.equal(res.conflictCopies, 1);
  assert.equal(res.changed.length, 2);
  assert.equal((await all("mindmaps")).length, 2);
});

test("pull: restore-marker record (then_restore_sid) is never merged", async () => {
  await put("mindmaps", [rec(Object.assign({ cid: "m", server_id: 10, title: "M", data_json: L, dirty: 1, rev: 1 }, based))]);
  await mapPut("mindmap", 10, "m");
  await put("_outbox", [
    { qid: 1, op: "delete", entity_type: "mindmap", cid: "m", payload: { then_restore_sid: 10 } },
    { qid: 2, op: "update", entity_type: "mindmap", cid: "m", payload: {} },
  ]);
  const row = srvRow({ id: 10, title: "M", data_json: S, updated_at: "t2" });
  const res = await pullMindmaps([row], () => Promise.resolve(row), null);
  assert.equal(res.merged, 0);
  const r = await get("mindmaps", "m");
  assert.deepEqual([r.data_json, r.rev, r.base_rev], [L, 1, "t1"]);
  assert.equal((await all("_outbox")).length, 2);
});

test("pullMindmaps partial: records absent from the list are neither deleted nor confirmed", async () => {
  await put("mindmaps", [rec({ cid: "a", server_id: 1, data_json: B, dirty: 0, base_rev: "t1" }), rec({ cid: "b", server_id: 2, dirty: 0, base_rev: "t1" })]);
  await mapPut("mindmap", 1, "a"); await mapPut("mindmap", 2, "b");
  let confirmed = 0;
  const row = srvRow({ id: 1, data_json: S, updated_at: "t2" });
  const res = await pullMindmaps([row], () => Promise.resolve(row), () => { confirmed++; return Promise.resolve({ status: 404 }); }, { partial: true });
  assert.equal(confirmed, 0);
  assert.equal(res.deleted, 0);
  assert.ok(await get("mindmaps", "b"));
});

test("pullMindmapOne updates one map and never deletes others", async () => {
  await put("mindmaps", [rec({ cid: "a", server_id: 1, data_json: B, dirty: 0, base_rev: "t1" }), rec({ cid: "b", server_id: 2, dirty: 0, base_rev: "t1" })]);
  await mapPut("mindmap", 1, "a"); await mapPut("mindmap", 2, "b");
  const raw = (url) => (url === "/api/mindmaps/1" ? okRes(srvRow({ id: 1, data_json: S, updated_at: "t2" }))
    : Promise.resolve({ ok: false, status: 503, json: () => Promise.resolve({}) }));
  const res = await pullMindmapOne(raw, 1);
  assert.deepEqual(res.changed.map((c) => c.cid), ["a"]);
  assert.equal(res.dirty, false);
  assert.equal((await get("mindmaps", "a")).data_json, S);
  assert.ok(await get("mindmaps", "b"));
});

test("pullMindmapOne merges a dirty record and reports it still dirty", async () => {
  await put("mindmaps", [rec(Object.assign({ cid: "m", server_id: 10, title: "M", data_json: L, dirty: 1, rev: 1 }, based))]);
  await mapPut("mindmap", 10, "m");
  await put("_outbox", [{ qid: 1, op: "update", entity_type: "mindmap", cid: "m", payload: {} }]);
  const res = await pullMindmapOne(() => okRes(srvRow({ id: 10, title: "M", data_json: S, updated_at: "t2" })), 10);
  assert.equal(res.merged, 1);
  assert.equal(res.dirty, true);
  assert.deepEqual(topics((await get("mindmaps", "m")).data_json), ["A lokal", "B server"]);
});

test("pullMindmapOne 404: clean record deleted, dirty record kept", async () => {
  await put("mindmaps", [rec({ cid: "a", server_id: 1, dirty: 0, base_rev: "t1" }), rec({ cid: "d", server_id: 3, dirty: 1, base_rev: "t1" })]);
  await mapPut("mindmap", 1, "a"); await mapPut("mindmap", 3, "d");
  const gone = () => Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({ detail: "x" }) });
  assert.equal((await pullMindmapOne(gone, 1)).deleted, 1);
  assert.equal(await get("mindmaps", "a"), undefined);
  const d = await pullMindmapOne(gone, 3);
  assert.equal(d.deleted, 0);
  assert.equal(d.dirty, true);
  assert.ok(await get("mindmaps", "d"));
});

test("pullMindmapOne 404 keeps a clean record held by a restore marker; failures change nothing", async () => {
  await put("mindmaps", [rec({ cid: "a", server_id: 1, dirty: 0, base_rev: "t1" })]);
  await mapPut("mindmap", 1, "a");
  await put("_outbox", [{ qid: 1, op: "delete", entity_type: "mindmap", cid: "a", payload: { then_restore_sid: 1 } }]);
  const gone = () => Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
  assert.equal((await pullMindmapOne(gone, 1)).deleted, 0);
  assert.ok(await get("mindmaps", "a"));
  const fail = () => Promise.resolve({ ok: false, status: 503, json: () => Promise.resolve({}) });
  assert.deepEqual(await pullMindmapOne(fail, 1), { changed: [], merged: 0, deleted: 0, dirty: false });
  const thrown = () => Promise.reject(new Error("offline"));
  assert.deepEqual(await pullMindmapOne(thrown, 1), { changed: [], merged: 0, deleted: 0, dirty: false });
  assert.ok(await get("mindmaps", "a"));
});

test("index.html schedules another push when a merge requeued an update", () => {
  const html = require("fs").readFileSync(require("path").join(__dirname, "../../static/index.html"), "utf8");
  assert.ok((html.match(/r\.busy \|\| r\.requeued/g) || []).length >= 2);
});
