"use strict";
// Rute drawing router lokal (S6: hanya drawing standalone — tanpa fallback "gambar di dalam note").
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { deleteDB } = require("./setup.js");
const { DB_NAME, _reset, openDB } = require("../../static/offline/db.js");
const { buildTaskRouter } = require("../../static/offline/taskroutes.js");
const { mapPut } = require("../../static/offline/idmap.js");

beforeEach(async () => { _reset(); await deleteDB(DB_NAME); });

async function putDrawing(rec) {
  const db = await openDB();
  await new Promise((res, rej) => {
    const tx = db.transaction("drawings", "readwrite");
    tx.objectStore("drawings").put(rec);
    tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error);
  });
}

test("POST → PUT → GET /api/drawings/:id round-trips via the router (by cid)", async () => {
  const R = buildTaskRouter();
  const created = await R.dispatch("POST", "/api/drawings", { title: "D", data_json: '{"store":{},"schema":{}}' });
  const put = await R.dispatch("PUT", "/api/drawings/" + created.cid, { data_json: '{"store":{"a":1},"schema":{}}' });
  assert.ok(put.updated_at);
  const got = await R.dispatch("GET", "/api/drawings/" + created.cid, undefined);
  assert.equal(got.data_json, '{"store":{"a":1},"schema":{}}');
});

test("GET /api/drawings/:id resolves a drawing by server_id", async () => {
  const R = buildTaskRouter();
  const created = await R.dispatch("POST", "/api/drawings", { title: "D", data_json: '{"store":{"b":2},"schema":{}}' });
  await mapPut("drawing", 42, created.cid);
  const db = await openDB();
  const rec = await new Promise((res) => { const q = db.transaction("drawings").objectStore("drawings").get(created.cid); q.onsuccess = () => res(q.result); });
  await putDrawing(Object.assign({}, rec, { server_id: 42 }));
  const got = await R.dispatch("GET", "/api/drawings/42", undefined);
  assert.equal(got.data_json, '{"store":{"b":2},"schema":{}}');
});

test("GET / PUT /api/drawings/:id reject when there is no local drawing (no note fallback)", async () => {
  const R = buildTaskRouter();
  await assert.rejects(() => R.dispatch("GET", "/api/drawings/ncid", undefined), /Drawing not found/);
  await assert.rejects(() => R.dispatch("PUT", "/api/drawings/ncid", { data_json: '{"a":1}' }), /Drawing not found/);
});
