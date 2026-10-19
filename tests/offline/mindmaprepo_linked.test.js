"use strict";
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { deleteDB } = require("./setup.js");
const { DB_NAME, _reset, openDB } = require("../../static/offline/db.js");
const { outboxAll } = require("../../static/offline/outbox.js");
const { createMindmap, updateMindmap, getRaw, setCurrentUser } = require("../../static/offline/mindmaprepo.js");
const { buildTaskRouter } = require("../../static/offline/taskroutes.js");

async function putNote(rec) {
  const db = await openDB();
  await new Promise((res, rej) => {
    const tx = db.transaction("scratchpad_notes", "readwrite");
    tx.objectStore("scratchpad_notes").put(rec);
    tx.oncomplete = res; tx.onerror = () => rej(tx.error);
  });
}

beforeEach(async () => {
  _reset(); await deleteDB(DB_NAME); setCurrentUser(null);
  await putNote({ cid: "n1", server_id: 7, title: "Rencana", list_id: 3, user_id: 5, content: "# A\n", deleted: false });
});

test("createMindmap from note ref copies note fields, one op; second call reuses", async () => {
  const a = await createMindmap({ source_note_ref: "n1" });
  assert.deepEqual([a.source_note_cid, a.source_note_id, a.title, a.list_id, a.user_id], ["n1", 7, "Rencana", 3, 5]);
  assert.deepEqual(JSON.parse(a.data_json), { linked: 1, direction: 2, justify: false, collapsed: [], summary: true });
  const b = await createMindmap({ source_note_ref: 7 });
  assert.equal(b.cid, a.cid); assert.equal((await outboxAll()).length, 1);
  await assert.rejects(createMindmap({ source_note_ref: "tidak-ada" }), /Note not found/);
});

test("deleted note is treated as not found", async () => {
  await putNote({ cid: "n2", server_id: null, title: "X", content: "", deleted: true });
  await assert.rejects(createMindmap({ source_note_ref: "n2" }), /Note not found/);
});

test("linked updateMindmap ignores stale if_updated_at (no conflict copy)", async () => {
  const a = await createMindmap({ source_note_ref: "n1" });
  const out = await updateMindmap(a.cid, { data_json: '{"linked":1,"direction":3}', if_updated_at: "basi" });
  assert.equal(out.conflict_copy, undefined); assert.equal((await getRaw(a.cid)).data_json, '{"linked":1,"direction":3}');
});

test("routes expose source_note fields and accept source_note_ref", async () => {
  const r = buildTaskRouter();
  const created = await r.dispatch("POST", "/api/mindmaps", { source_note_ref: 7 });
  const list = await r.dispatch("GET", "/api/mindmaps");
  const row = list.find((m) => m.id === created.id);
  assert.equal(row.source_note_cid, "n1"); assert.equal(row.source_note_id, 7);
});

test("reuses a pulled record that only has source_note_id (no source_note_cid)", async () => {
  const { recordFromServer, putRaw } = require("../../static/offline/mindmaprepo.js");
  const rec = Object.assign(recordFromServer({ id: 40, title: "Rencana", source_note_id: 7, updated_at: "t" }, "m-pulled"), { rev: 1 });
  await putRaw(rec);
  const got = await createMindmap({ source_note_ref: "n1" });
  assert.equal(got.cid, "m-pulled"); assert.equal((await outboxAll()).length, 0);
});

test("concurrent linked creates yield one record and one op", async () => {
  const [a, b] = await Promise.all([createMindmap({ source_note_ref: "n1" }), createMindmap({ source_note_ref: 7 })]);
  assert.equal(a.cid, b.cid); assert.equal((await outboxAll()).length, 1);
});
