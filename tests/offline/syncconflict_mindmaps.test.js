"use strict";
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { deleteDB } = require("./setup.js");
const { DB_NAME, _reset, openDB } = require("../../static/offline/db.js");
const { mapPut, serverIdOf } = require("../../static/offline/idmap.js");
const { listConflicts, resolveConflict, listNotices, dismissNotice } = require("../../static/offline/syncconflict.js");

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
async function getMM(cid) {
  const db = await openDB();
  return new Promise((res) => { const q = db.transaction("mindmaps").objectStore("mindmaps").get(cid); q.onsuccess = () => res(q.result); });
}
function mm(over) {
  return Object.assign({ cid: over.cid, server_id: over.server_id != null ? over.server_id : null, title: "M", data_json: "{}", pinned: false, list_id: 9, user_id: 1, created_at: "x", updated_at: "x", deleted: false, dirty: 1, base_rev: null }, over);
}

test("listConflicts includes mindmap conflicts tagged entity=mindmap", async () => {
  await put("mindmaps", [mm({ cid: "m", server_id: 7, conflict: "remote_deleted", title: "Gone" })]);
  const list = await listConflicts();
  const c = list.find((x) => x.entity === "mindmap");
  assert.ok(c);
  assert.equal(c.cid, "m");
});

test("resolveConflict('mindmap', cid, 'discard') removes the mindmap + idmap + op", async () => {
  await put("mindmaps", [mm({ cid: "m", server_id: 7, conflict: "remote_deleted" })]);
  await mapPut("mindmap", 7, "m");
  await put("_outbox", [{ qid: 1, op: "update", entity_type: "mindmap", cid: "m", payload: {} }]);
  await resolveConflict("mindmap", "m", "discard");
  assert.equal(await getMM("m"), undefined);
  assert.equal(await serverIdOf("m"), undefined);
});

test("listNotices includes mindmap notices (entity tagged); dismissNotice('mindmap',cid) clears", async () => {
  await put("mindmaps", [mm({ cid: "m", notice: { kind: "overwritten", title: "Doc", editor: "Bob" } })]);
  const notices = await listNotices();
  const n = notices.find((x) => x.entity === "mindmap");
  assert.ok(n);
  assert.equal(n.editor, "Bob");
  await dismissNotice("mindmap", "m");
  assert.equal((await listNotices()).length, 0);
  assert.equal((await getMM("m")).notice, undefined);
});
