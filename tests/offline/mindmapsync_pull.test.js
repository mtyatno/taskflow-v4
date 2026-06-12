"use strict";
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { deleteDB } = require("./setup.js");
const { DB_NAME, _reset, openDB } = require("../../static/offline/db.js");
const { mapPut, serverIdOf, cidOf } = require("../../static/offline/idmap.js");
const { outboxAll } = require("../../static/offline/outbox.js");
const { pullMindmaps } = require("../../static/offline/syncpull.js");

beforeEach(async () => { _reset(); await deleteDB(DB_NAME); });

async function put(store, recs) {
  const db = await openDB();
  await new Promise((res, rej) => {
    const tx = db.transaction(store, "readwrite");
    const os = tx.objectStore(store);
    for (const r of recs) os.put(r);
    tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error);
  });
}
async function getAll(store) {
  const db = await openDB();
  return new Promise((res) => { const q = db.transaction(store).objectStore(store).getAll(); q.onsuccess = () => res(q.result || []); });
}
// metadata row (list shape, no data_json) + a fetchOne that supplies the full row.
function metaRow(over) {
  return Object.assign({ id: over.id, title: "S", is_pinned: 0, list_id: null, created_at: "2026-06-10T00:00:00", updated_at: "2026-06-10T00:00:00" }, over);
}
function fullFor(rows) {
  return (sid) => { const r = rows.find((x) => String(x.id) === String(sid)); return Promise.resolve(r ? Object.assign({}, r, { data_json: r.data_json || "{\"nodeData\":{}}" }) : null); };
}

test("new server mindmap is fetched (data_json) + inserted with idmap", async () => {
  const rows = [metaRow({ id: 5, title: "Remote", data_json: "{\"nodeData\":{\"id\":\"root\"}}" })];
  const res = await pullMindmaps(rows, fullFor(rows));
  assert.equal(res.created, 1);
  const local = await getAll("mindmaps");
  assert.equal(local.length, 1);
  assert.equal(local[0].title, "Remote");
  assert.match(local[0].data_json, /root/);
  assert.equal(local[0].dirty, 0);
  assert.equal(await cidOf("mindmap", 5), local[0].cid);
});

test("changed clean local is overwritten; fetchOne only called for new/changed", async () => {
  await put("mindmaps", [{ cid: "m", server_id: 5, title: "Old", data_json: "{\"old\":1}", pinned: false, list_id: null, created_at: "x", updated_at: "2026-06-10T00:00:00", deleted: false, dirty: 0, base_rev: "2026-06-10T00:00:00" }]);
  await mapPut("mindmap", 5, "m");
  const rows = [metaRow({ id: 5, title: "New", updated_at: "2026-06-10T05:00:00", data_json: "{\"new\":1}" })];
  let fetchCount = 0;
  const fetchOne = (sid) => { fetchCount++; return fullFor(rows)(sid); };
  const res = await pullMindmaps(rows, fetchOne);
  assert.equal(res.updated, 1);
  assert.equal(fetchCount, 1);
  const local = (await getAll("mindmaps"))[0];
  assert.equal(local.title, "New");
  assert.equal(local.data_json, "{\"new\":1}");
});

test("unchanged clean local is not fetched or rewritten", async () => {
  await put("mindmaps", [{ cid: "m", server_id: 5, title: "Same", data_json: "{}", pinned: false, list_id: null, created_at: "x", updated_at: "2026-06-10T00:00:00", deleted: false, dirty: 0, base_rev: "2026-06-10T00:00:00" }]);
  await mapPut("mindmap", 5, "m");
  const rows = [metaRow({ id: 5, title: "Same", updated_at: "2026-06-10T00:00:00" })];
  let fetchCount = 0;
  const res = await pullMindmaps(rows, (sid) => { fetchCount++; return fullFor(rows)(sid); });
  assert.equal(res.updated, 0);
  assert.equal(fetchCount, 0);
});

test("dirty local is skipped (local-wins / deferred)", async () => {
  await put("mindmaps", [{ cid: "m", server_id: 5, title: "MineEdited", data_json: "{}", pinned: false, list_id: null, created_at: "x", updated_at: "2026-06-10T09:00:00", deleted: false, dirty: 1, base_rev: "2026-06-10T00:00:00" }]);
  await mapPut("mindmap", 5, "m");
  const rows = [metaRow({ id: 5, title: "ServerOlder", updated_at: "2026-06-10T01:00:00" })];
  const res = await pullMindmaps(rows, fullFor(rows));
  // local newer → local wins
  assert.equal(res.lwwResolved, 1);
  const local = (await getAll("mindmaps"))[0];
  assert.equal(local.title, "MineEdited");
});

test("clean local vanished from server is deleted + unmapped", async () => {
  await put("mindmaps", [{ cid: "m", server_id: 5, title: "Gone", data_json: "{}", pinned: false, list_id: null, created_at: "x", updated_at: "2026-06-10T00:00:00", deleted: false, dirty: 0, base_rev: "2026-06-10T00:00:00" }]);
  await mapPut("mindmap", 5, "m");
  const res = await pullMindmaps([], fullFor([]));
  assert.equal(res.deleted, 1);
  assert.equal((await getAll("mindmaps")).length, 0);
  assert.equal(await serverIdOf("m"), undefined);
});

test("pin-adopt uses list is_pinned but respects a pending pin op", async () => {
  await put("mindmaps", [{ cid: "m", server_id: 5, title: "P", data_json: "{}", pinned: false, list_id: null, created_at: "x", updated_at: "2026-06-10T00:00:00", deleted: false, dirty: 0, base_rev: "2026-06-10T00:00:00" }]);
  await mapPut("mindmap", 5, "m");
  await put("_outbox", [{ qid: 1, op: "pin", entity_type: "mindmap", cid: "m", payload: { pinned: false } }]);
  const rows = [metaRow({ id: 5, title: "P", is_pinned: 1, updated_at: "2026-06-10T00:00:00" })];
  const res = await pullMindmaps(rows, fullFor(rows));
  // pending pin op → do not adopt server pinned
  assert.equal(res.pinned, 0);
  const local = (await getAll("mindmaps"))[0];
  assert.equal(local.pinned, false);
});

test("shared mindmaps (list_id != null) are reconciled like personal ones", async () => {
  const rows = [metaRow({ id: 9, title: "Shared", list_id: 3 })];
  const res = await pullMindmaps(rows, fullFor(rows));
  assert.equal(res.created, 1);
  const local = (await getAll("mindmaps"))[0];
  assert.equal(local.list_id, 3);
});
