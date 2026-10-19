"use strict";
// PR B #4 (Task B3): basis merge per record, mergeServerIntoLocal, merge di router lokal, notice merge_conflict.
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { deleteDB } = require("./setup.js");
const { DB_NAME, _reset, openDB } = require("../../static/offline/db.js");
const { buildTaskRouter } = require("../../static/offline/taskroutes.js");
const { listNotices } = require("../../static/offline/syncconflict.js");
const mm = require("../../static/offline/mindmaprepo.js");

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

const D = (topics) => JSON.stringify({ nodeData: { id: "root", topic: "Akar", root: true,
  children: topics.map((t, i) => ({ id: "n" + i, topic: t, children: [] })) } });
const B = D(["A", "B"]), L = D(["A lokal", "B"]), S = D(["A", "B server"]);

test("different nodes → merged record, dirty, one update op, base advanced, no copy", async () => {
  await put("mindmaps", [rec({ cid: "m", server_id: 10, title: "M", data_json: L, base_data_json: B, base_title: "M", base_rev: "t1", dirty: 1, rev: 3 })]);
  await put("_outbox", [{ qid: 1, op: "update", entity_type: "mindmap", cid: "m", payload: {} }]);
  const out = await mm.mergeServerIntoLocal("m", srvRow({ id: 10, title: "M", data_json: S, updated_at: "t2" }), { expectRev: 3 });
  assert.equal(out.merged, true); assert.equal(out.copy, null); assert.equal(out.conflicts, 0);
  const r = await get("mindmaps", "m");
  assert.deepEqual(JSON.parse(r.data_json).nodeData.children.map((c) => c.topic), ["A lokal", "B server"]);
  assert.equal(r.dirty, 1); assert.equal(r.rev, 4);
  assert.deepEqual([r.base_rev, r.base_data_json, r.base_title], ["t2", S, "M"]);
  assert.deepEqual((await all("_outbox")).filter((o) => o.cid === "m").map((o) => o.op), ["update"]);
});

test("same node → server value in record + private conflict copy of the local version + merge_conflict notice", async () => {
  const L2 = D(["A lokal", "B"]), S2 = D(["A server", "B"]);
  await put("mindmaps", [rec({ cid: "m", server_id: 10, title: "M", data_json: L2, base_data_json: B, base_title: "M", base_rev: "t1", dirty: 1, rev: 1 })]);
  const out = await mm.mergeServerIntoLocal("m", srvRow({ id: 10, title: "M", data_json: S2, updated_at: "t2" }), { expectRev: 1 });
  assert.equal(out.conflicts, 1); assert.ok(out.copy);
  assert.equal(JSON.parse((await get("mindmaps", "m")).data_json).nodeData.children[0].topic, "A server");
  const copy = await get("mindmaps", out.copy.cid);
  assert.equal(copy.data_json, L2); assert.equal(copy.title, "(konflik) M"); assert.equal(copy.list_id, null);
  const notices = await listNotices();
  const nt = notices.find((x) => x.cid === "m");
  assert.equal(nt.kind, "merge_conflict"); assert.equal(nt.count, 1); assert.deepEqual(nt.nodes, ["A lokal"]);
});

test("no base / linked / expectRev mismatch keep the old behaviour", async () => {
  await put("mindmaps", [rec({ cid: "nb", server_id: 11, data_json: L, base_rev: "t1", dirty: 1, rev: 1 })]);
  const o1 = await mm.mergeServerIntoLocal("nb", srvRow({ id: 11, data_json: S, updated_at: "t2" }), { expectRev: 1 });
  assert.equal(o1.merged, false); assert.ok(o1.copy);
  await put("mindmaps", [rec({ cid: "x", server_id: 12, data_json: L, base_data_json: B, base_rev: "t1", dirty: 1, rev: 5 })]);
  assert.equal(await mm.mergeServerIntoLocal("x", srvRow({ id: 12, data_json: S, updated_at: "t2" }), { expectRev: 4 }), null);
});

test("linked map is never merged (old adopt + copy path)", async () => {
  await put("mindmaps", [rec({ cid: "ln", server_id: 13, source_note_cid: "note1", data_json: L, base_data_json: B, base_title: "M", base_rev: "t1", dirty: 1, rev: 1 })]);
  const o = await mm.mergeServerIntoLocal("ln", srvRow({ id: 13, title: "M", data_json: S, updated_at: "t2" }), { expectRev: 1 });
  assert.equal(o.merged, false); assert.ok(o.copy);
  assert.equal((await get("mindmaps", "ln")).data_json, S);
  assert.equal((await get("mindmaps", o.copy.cid)).data_json, L);
});

test("clean record → plain adoption, base = server", async () => {
  await put("mindmaps", [rec({ cid: "cl", server_id: 14, data_json: B, base_data_json: B, base_title: "M", base_rev: "t1", dirty: 0, rev: 2 })]);
  const o = await mm.mergeServerIntoLocal("cl", srvRow({ id: 14, title: "M2", data_json: S, updated_at: "t2" }), { expectRev: 2 });
  assert.equal(o.merged, false); assert.equal(o.copy, null);
  const r = await get("mindmaps", "cl");
  assert.deepEqual([r.data_json, r.title, r.dirty, r.base_rev, r.base_data_json, r.base_title], [S, "M2", 0, "t2", S, "M2"]);
});

test("merge result equal to server → clean, updated_at from server, no update op", async () => {
  await put("mindmaps", [rec({ cid: "e", server_id: 15, title: "M", data_json: S, base_data_json: B, base_title: "M", base_rev: "t1", dirty: 1, rev: 1 })]);
  await put("_outbox", [{ qid: 7, op: "update", entity_type: "mindmap", cid: "e", payload: {} }]);
  const o = await mm.mergeServerIntoLocal("e", srvRow({ id: 15, title: "M", data_json: S, updated_at: "t2" }), { expectRev: 1 });
  assert.equal(o.merged, true);
  const r = await get("mindmaps", "e");
  assert.equal(r.dirty, 0); assert.equal(r.updated_at, "t2");
  assert.deepEqual((await all("_outbox")).filter((op) => op.cid === "e"), []);
});

test("recordFromServer stores the base; updateMindmap captures base on first edit of a clean record", async () => {
  const r0 = mm.recordFromServer(srvRow({ id: 5, title: "T", data_json: S, updated_at: "t9" }), "c");
  assert.deepEqual([r0.base_data_json, r0.base_title], [S, "T"]);
  await put("mindmaps", [rec({ cid: "c", server_id: 5, title: "T", data_json: B, dirty: 0, base_rev: "t9", rev: 1 })]);
  await mm.updateMindmap("c", { data_json: L });
  const r = await get("mindmaps", "c");
  assert.deepEqual([r.base_data_json, r.base_title, r.data_json], [B, "T", L]);
});

test("router PUT with stale if_updated_at + base_data_json merges instead of copying", async () => {
  await put("mindmaps", [rec({ cid: "m", server_id: 10, title: "M", data_json: S, updated_at: "t2", dirty: 0, base_rev: "t2", base_data_json: S, base_title: "M" })]);
  const R = buildTaskRouter();
  const res = await R.dispatch("PUT", "/api/mindmaps/10", { data_json: L, base_data_json: B, if_updated_at: "t1" });
  assert.equal(res.merged, true); assert.equal(res.merge_conflicts, 0); assert.equal(res.conflict_copy, undefined);
  assert.deepEqual(JSON.parse(res.data_json).nodeData.children.map((c) => c.topic), ["A lokal", "B server"]);
  assert.equal((await all("mindmaps")).length, 1);
});

test("router PUT stale merge with same-node conflict → copy of the tab version, record not replaced by copy", async () => {
  const S2 = D(["A server", "B"]);
  await put("mindmaps", [rec({ cid: "m", server_id: 10, title: "M", data_json: S2, updated_at: "t2", dirty: 0, base_rev: "t2", base_data_json: S2, base_title: "M" })]);
  const R = buildTaskRouter();
  const res = await R.dispatch("PUT", "/api/mindmaps/10", { data_json: L, base_data_json: B, if_updated_at: "t1" });
  assert.equal(res.merged, true); assert.equal(res.merge_conflicts, 1); assert.ok(res.conflict_copy);
  assert.equal(JSON.parse(res.data_json).nodeData.children[0].topic, "A server");
  const copy = (await all("mindmaps")).find((m) => m.cid !== "m");
  assert.equal(copy.data_json, L); assert.equal(copy.title, "(konflik) M");
  const ops = await all("_outbox");
  assert.deepEqual(ops.filter((o) => o.cid === "m").map((o) => o.op), ["update"]);
  assert.deepEqual(ops.filter((o) => o.cid === copy.cid).map((o) => o.op), ["create"]);
});

test("router PUT stale without base_data_json keeps the old conflict-copy path", async () => {
  await put("mindmaps", [rec({ cid: "m", server_id: 10, title: "M", data_json: S, updated_at: "t2", dirty: 0, base_rev: "t2" })]);
  const R = buildTaskRouter();
  const res = await R.dispatch("PUT", "/api/mindmaps/10", { data_json: L, if_updated_at: "t1" });
  assert.equal(res.merged, undefined); assert.ok(res.conflict_copy);
  assert.equal(res.data_json, S);
});

test("setBaseFromServer only when base_rev matches the row", async () => {
  await put("mindmaps", [rec({ cid: "m", server_id: 10, data_json: L, base_rev: "t3", dirty: 1, rev: 2 })]);
  await mm.setBaseFromServer("m", srvRow({ id: 10, title: "M", data_json: S, updated_at: "t2" }));
  assert.equal((await get("mindmaps", "m")).base_data_json, undefined);
  await mm.setBaseFromServer("m", srvRow({ id: 10, title: "M", data_json: S, updated_at: "t3" }));
  const r = await get("mindmaps", "m");
  assert.equal(r.base_data_json, S); assert.equal(r.rev, 2); assert.equal(r.dirty, 1);
});
