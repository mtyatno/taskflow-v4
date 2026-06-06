"use strict";
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { deleteDB } = require("./setup.js");
const { DB_NAME, _reset, openDB } = require("../../static/offline/db.js");
const { buildTaskRouter } = require("../../static/offline/taskroutes.js");

beforeEach(async () => { _reset(); await deleteDB(DB_NAME); });

async function putNote(rec) {
  const db = await openDB();
  await new Promise((res, rej) => {
    const tx = db.transaction("scratchpad_notes", "readwrite");
    tx.objectStore("scratchpad_notes").put(rec);
    tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error);
  });
}
function note(over) {
  return Object.assign({ cid: over.cid, server_id: null, title: "N", content: "", linked_task_cids: "[]", linked_to_cids: "[]", pinned: false, list_id: null, deleted: false, dirty: 0 }, over);
}

test("PUT then GET /api/drawings/:id round-trips via the router (by cid)", async () => {
  await putNote(note({ cid: "ncid" }));
  const R = buildTaskRouter();
  const put = await R.dispatch("PUT", "/api/drawings/ncid", { data_json: '{"a":1}' });
  assert.ok(put.updated_at);
  const got = await R.dispatch("GET", "/api/drawings/ncid", undefined);
  assert.equal(got.data_json, '{"a":1}');
});

test("GET /api/drawings/:id resolves a note by server_id", async () => {
  await putNote(note({ cid: "ncid", server_id: 42 }));
  const R = buildTaskRouter();
  await R.dispatch("PUT", "/api/drawings/ncid", { data_json: '{"b":2}' });
  const got = await R.dispatch("GET", "/api/drawings/42", undefined);
  assert.equal(got.data_json, '{"b":2}');
});

test("GET /api/drawings/:id rejects when there is no local drawing (offline miss)", async () => {
  await putNote(note({ cid: "ncid" }));
  const R = buildTaskRouter();
  await assert.rejects(() => R.dispatch("GET", "/api/drawings/ncid", undefined));
});
