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
  await put("mindmaps", [rec({ cid: "m", server_id: 10, title: "M", data_json: L, base_data_json: B, base_title: "M", base_rev: "t1", base_data_rev: "t1", dirty: 1, rev: 3 })]);
  await put("_outbox", [{ qid: 1, op: "update", entity_type: "mindmap", cid: "m", payload: {} }]);
  const out = await mm.mergeServerIntoLocal("m", srvRow({ id: 10, title: "M", data_json: S, updated_at: "t2" }), { expectRev: 3 });
  assert.equal(out.merged, true); assert.equal(out.copy, null); assert.equal(out.conflicts, 0);
  const r = await get("mindmaps", "m");
  assert.deepEqual(JSON.parse(r.data_json).nodeData.children.map((c) => c.topic), ["A lokal", "B server"]);
  assert.equal(r.dirty, 1); assert.equal(r.rev, 4);
  assert.deepEqual([r.base_rev, r.base_data_json, r.base_title, r.base_data_rev], ["t2", S, "M", "t2"]);
  assert.deepEqual((await all("_outbox")).filter((o) => o.cid === "m").map((o) => o.op), ["update"]);
});

test("same node → server value in record + private conflict copy of the local version + merge_conflict notice", async () => {
  const L2 = D(["A lokal", "B"]), S2 = D(["A server", "B"]);
  await put("mindmaps", [rec({ cid: "m", server_id: 10, title: "M", data_json: L2, base_data_json: B, base_title: "M", base_rev: "t1", base_data_rev: "t1", dirty: 1, rev: 1 })]);
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
  await put("mindmaps", [rec({ cid: "x", server_id: 12, data_json: L, base_data_json: B, base_rev: "t1", base_data_rev: "t1", dirty: 1, rev: 5 })]);
  assert.equal(await mm.mergeServerIntoLocal("x", srvRow({ id: 12, data_json: S, updated_at: "t2" }), { expectRev: 4 }), null);
});

test("linked map is never merged (old adopt + copy path)", async () => {
  await put("mindmaps", [rec({ cid: "ln", server_id: 13, source_note_cid: "note1", data_json: L, base_data_json: B, base_title: "M", base_rev: "t1", base_data_rev: "t1", dirty: 1, rev: 1 })]);
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
  await put("mindmaps", [rec({ cid: "e", server_id: 15, title: "M", data_json: S, base_data_json: B, base_title: "M", base_rev: "t1", base_data_rev: "t1", dirty: 1, rev: 1 })]);
  await put("_outbox", [{ qid: 7, op: "update", entity_type: "mindmap", cid: "e", payload: {} }]);
  const o = await mm.mergeServerIntoLocal("e", srvRow({ id: 15, title: "M", data_json: S, updated_at: "t2" }), { expectRev: 1 });
  assert.equal(o.merged, true);
  const r = await get("mindmaps", "e");
  assert.equal(r.dirty, 0); assert.equal(r.updated_at, "t2");
  assert.deepEqual((await all("_outbox")).filter((op) => op.cid === "e"), []);
});

test("recordFromServer stores the base; updateMindmap captures base on first edit of a clean record", async () => {
  const r0 = mm.recordFromServer(srvRow({ id: 5, title: "T", data_json: S, updated_at: "t9" }), "c");
  assert.deepEqual([r0.base_data_json, r0.base_title, r0.base_data_rev], [S, "T", "t9"]);
  await put("mindmaps", [rec({ cid: "c", server_id: 5, title: "T", data_json: B, dirty: 0, base_rev: "t9", rev: 1 })]);
  await mm.updateMindmap("c", { data_json: L });
  const r = await get("mindmaps", "c");
  assert.deepEqual([r.base_data_json, r.base_title, r.base_data_rev, r.data_json], [B, "T", "t9", L]);
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
  assert.equal(r.base_data_json, S); assert.equal(r.base_data_rev, "t3"); assert.equal(r.rev, 2); assert.equal(r.dirty, 1);
});

// Fix round 1: basis basi (markPushed memajukan base_rev tanpa basis) tidak boleh membalik hapus/edit server diam-diam.
const P = (pairs) => JSON.stringify({ nodeData: { id: "root", topic: "Akar", root: true,
  children: pairs.map(([id, t]) => ({ id, topic: t, children: [] })) } });
const ids = (r) => JSON.parse(r.data_json).nodeData.children.map((c) => c.id + ":" + c.topic);

test("stale base after markPushed: next edit re-captures the base → Bob's delete/edit kept", async () => {
  const B0 = P([["a", "a"]]), L1 = P([["a", "a1"], ["y", "Y"]]);
  await put("mindmaps", [rec({ cid: "m", server_id: 10, title: "M", data_json: L1, base_data_json: B0, base_title: "M", base_data_rev: "t1", base_rev: "t2", updated_at: "t2", dirty: 0, rev: 2 })]);
  await mm.updateMindmap("m", { data_json: P([["a", "a1"], ["y", "Y"], ["z", "Z"]]) });
  const r = await get("mindmaps", "m");
  assert.deepEqual([r.base_data_json, r.base_data_rev], [L1, "t2"]);
  const out = await mm.mergeServerIntoLocal("m", srvRow({ id: 10, title: "M", data_json: P([["a", "a"]]), updated_at: "t3" }), { expectRev: r.rev });
  assert.equal(out.merged, true); assert.equal(out.conflicts, 0);
  assert.deepEqual(ids(await get("mindmaps", "m")), ["a:a", "z:Z"]); // y dihapus Bob, a dikembalikan Bob, z lokal tetap
});

test("stale base while dirty (base_data_rev ≠ base_rev) → old adopt + full conflict copy, never silent reversal", async () => {
  const B0 = P([["a", "a"]]), L2 = P([["a", "a1"], ["y", "Y"], ["z", "Z"]]);
  await put("mindmaps", [rec({ cid: "m", server_id: 10, title: "M", data_json: L2, base_data_json: B0, base_title: "M", base_data_rev: "t1", base_rev: "t2", dirty: 1, rev: 3 })]);
  const out = await mm.mergeServerIntoLocal("m", srvRow({ id: 10, title: "M", data_json: P([["a", "a"]]), updated_at: "t3" }), { expectRev: 3 });
  assert.equal(out.merged, false); assert.ok(out.copy);
  assert.deepEqual(ids(await get("mindmaps", "m")), ["a:a"]);
  assert.equal((await get("mindmaps", out.copy.cid)).data_json, L2);
  assert.equal((await listNotices()).find((x) => x.cid === "m").kind, "conflict_copy");
});

test("base without base_data_rev (legacy) is treated as no base", async () => {
  await put("mindmaps", [rec({ cid: "m", server_id: 10, title: "M", data_json: L, base_data_json: B, base_title: "M", base_rev: "t1", dirty: 1, rev: 1 })]);
  const out = await mm.mergeServerIntoLocal("m", srvRow({ id: 10, title: "M", data_json: S, updated_at: "t2" }), { expectRev: 1 });
  assert.equal(out.merged, false); assert.ok(out.copy);
});

test("merge path and clean adopt write base_data_rev = server updated_at", async () => {
  await put("mindmaps", [rec({ cid: "c", server_id: 14, data_json: B, dirty: 0, base_rev: "t1", rev: 1 })]);
  await mm.mergeServerIntoLocal("c", srvRow({ id: 14, title: "M", data_json: S, updated_at: "t2" }), { expectRev: 1 });
  const c = await get("mindmaps", "c");
  assert.deepEqual([c.base_data_json, c.base_data_rev, c.base_rev], [S, "t2", "t2"]);
});

test("linked map: first edit does not capture a base", async () => {
  await put("mindmaps", [rec({ cid: "ln", server_id: 13, source_note_cid: "n1", data_json: B, dirty: 0, base_rev: "t1", rev: 1 })]);
  await mm.updateMindmap("ln", { data_json: L });
  assert.equal((await get("mindmaps", "ln")).base_data_json, undefined);
});

test("router merge conflict reuses the recent conflict copy of the same map", async () => {
  const S2 = D(["A server", "B"]);
  await put("mindmaps", [rec({ cid: "m", server_id: 10, title: "M", data_json: S2, updated_at: "t2", dirty: 0, base_rev: "t2" }),
    rec({ cid: "old", client_id: "old", conflict_of: "m", title: "(konflik) M", data_json: L, dirty: 1, rev: 1 })]);
  await put("_outbox", [{ qid: 1, op: "create", entity_type: "mindmap", cid: "old", payload: { cid: "old" } }]);
  const R = buildTaskRouter();
  const L3 = D(["A tab", "B"]);
  const res = await R.dispatch("PUT", "/api/mindmaps/10", { data_json: L3, base_data_json: B, if_updated_at: "t1" });
  assert.equal(res.merge_conflicts, 1);
  assert.equal((await all("mindmaps")).length, 2);
  const old = await get("mindmaps", "old");
  assert.equal(old.data_json, L3); assert.equal(old.rev, 2);
  assert.deepEqual((await all("_outbox")).filter((o) => o.cid === "old").map((o) => o.op), ["create"]);
});
