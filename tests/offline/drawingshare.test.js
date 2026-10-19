"use strict";
// PR 3 Task 2: modul drawingshare (share, salin, rencana scope, moved_drawings).
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { deleteDB } = require("./setup.js");
const { DB_NAME, _reset, openDB } = require("../../static/offline/db.js");
const { mapPut } = require("../../static/offline/idmap.js");
const { outboxAll } = require("../../static/offline/outbox.js");
const repo = require("../../static/offline/drawingrepo.js");
const share = require("../../static/offline/drawingshare.js");
const { pushOutbox } = require("../../static/offline/syncpush.js");

beforeEach(async () => { _reset(); await deleteDB(DB_NAME); setOnline(true); repo.setCurrentUser({ user_id: 1 }); });

function setOnline(v) {
  Object.defineProperty(globalThis, "navigator", { value: { onLine: v }, configurable: true, writable: true });
}
async function put(store, rec) {
  const db = await openDB();
  await new Promise((res, rej) => { const tx = db.transaction(store, "readwrite"); tx.objectStore(store).put(rec); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); });
}
async function get(store, key) {
  const db = await openDB();
  return new Promise((res) => { const q = db.transaction(store).objectStore(store).get(key); q.onsuccess = () => res(q.result); });
}
function drw(over) {
  return Object.assign({
    cid: "c1", server_id: 11, client_id: "cl-1", title: "D", blob_ref: null, svg_preview: "", is_pinned: 0,
    list_id: null, user_id: 1, last_edited_by: 1, created_at: "x", updated_at: "2026-10-19T08:00:00",
    deleted: false, dirty: 0, base_rev: "2026-10-19T08:00:00", rev: 3,
  }, over);
}

test("scopeNotice covers same / own_to_ws / ws_in_personal / other_ws_copy", () => {
  assert.equal(share.scopeNotice({ list_id: null, user_id: 1 }, null, 1).kind, "same");
  assert.equal(share.scopeNotice({ list_id: 5, user_id: 2 }, 5, 1).kind, "same");
  assert.deepEqual(share.scopeNotice({ list_id: null, user_id: 1 }, 5, 1), { kind: "own_to_ws", listId: 5 });
  assert.deepEqual(share.scopeNotice({ list_id: 5, user_id: 2 }, null, 1), { kind: "ws_in_personal", listId: 5 });
  assert.equal(share.scopeNotice({ list_id: 6, user_id: 1 }, 5, 1).kind, "other_ws_copy");
  assert.equal(share.scopeNotice({ list_id: null, user_id: 2 }, 5, 1).kind, "other_ws_copy");
  for (const k of ["own_to_ws", "ws_in_personal", "other_ws_copy"]) {
    assert.match(share.noticeText({ kind: k, listId: 5 }, "Tim A"), /Tim A/);
  }
  assert.equal(share.noticeText({ kind: "same" }, "Tim A"), "");
});

test("replaceDrawingToken swaps id and client_id forms incl ::DRAW and escaped, keeps attributes", () => {
  const d = { server_id: 11, client_id: "cl-1", cid: "c1" };
  const src = 'a ::draw[11]{title="X" size="M"} b ::DRAW[CL-1] c ::draw\\[11\\]{title="Y"} d ::draw[99]{title="Z"}';
  const out = share.replaceDrawingToken(src, d, "777");
  assert.equal(out, 'a ::draw[777]{title="X" size="M"} b ::DRAW[777] c ::draw\\[777\\]{title="Y"} d ::draw[99]{title="Z"}');
  assert.equal(share.replaceDrawingToken("::draw[c1]", d, "::draw[8]"), "::draw[8]");
});

test("planNoteShare splits own personal (move), other workspace (copy), unknown (unavailable)", () => {
  const mine = drw({ cid: "m", server_id: 11, client_id: "cl-1" });
  const ws2 = drw({ cid: "w2", server_id: 12, client_id: "cl-2", list_id: 9, user_id: 1 });
  const theirs = drw({ cid: "t", server_id: 13, client_id: "cl-3", list_id: null, user_id: 2 });
  const inTarget = drw({ cid: "it", server_id: 14, client_id: "cl-4", list_id: 5 });
  const map = {};
  for (const d of [mine, ws2, theirs, inTarget]) { map[String(d.server_id)] = d; map[d.client_id] = d; }
  const content = "::draw[11] ::draw[cl-1] ::draw[12] ::draw[cl-3] ::draw[14] ::draw[404] ::draw[404]";
  const plan = share.planNoteShare(content, 5, map, 1);
  assert.deepEqual(plan.move.map((d) => d.server_id), [11]);
  assert.deepEqual(plan.copy.map((d) => d.server_id), [12, 13]);
  assert.deepEqual(plan.unavailable, ["404"]);
});

test("shareDrawing success mutates local list_id; 409 returns notes + hidden_count; offline returns OFFLINE without writes", async () => {
  await put("drawings", drw());
  const calls = [];
  const api = { fetch: async (url, opts) => { calls.push({ url, opts }); return { id: 11, list_id: 5, updated_at: "2026-10-19T09:00:00" }; } };
  const r = await share.shareDrawing(api, drw(), 5);
  assert.equal(r.ok, true);
  assert.equal(calls[0].url, "/api/drawings/11/share");
  assert.equal(calls[0].opts.method, "PATCH");
  assert.equal(calls[0].opts.network, true);
  assert.deepEqual(JSON.parse(calls[0].opts.body), { list_id: 5 });
  const rec = await get("drawings", "c1");
  assert.equal(rec.list_id, 5); assert.equal(rec.updated_at, "2026-10-19T09:00:00");
  assert.equal(rec.base_rev, "2026-10-19T09:00:00"); assert.equal(rec.rev, 4);
  assert.equal(r.drawing.list_id, 5);

  const e = Object.assign(new Error("Request failed (409)"), { status: 409, body: { detail: { code: "DRAWING_IN_USE", notes: [{ id: 1, title: "N" }], hidden_count: 2 } } });
  const r409 = await share.shareDrawing({ fetch: async () => { throw e; } }, drw(), null);
  assert.deepEqual(r409, { ok: false, code: "DRAWING_IN_USE", notes: [{ id: 1, title: "N" }], hidden_count: 2 });
  assert.equal((await get("drawings", "c1")).list_id, 5);

  setOnline(false);
  let called = false;
  const rOff = await share.shareDrawing({ fetch: async () => { called = true; return {}; } }, drw(), null);
  assert.equal(rOff.ok, false); assert.equal(rOff.code, "OFFLINE"); assert.equal(called, false);
  assert.equal((await get("drawings", "c1")).list_id, 5);
  setOnline(true);
  const rNet = await share.shareDrawing({ fetch: async () => { throw new TypeError("Failed to fetch"); } }, drw(), null);
  assert.equal(rNet.code, "OFFLINE");
  const rErr = await share.shareDrawing({ fetch: async () => { throw Object.assign(new Error("boom"), { status: 500 }); } }, drw(), null);
  assert.deepEqual([rErr.ok, rErr.code, rErr.message], [false, "ERROR", "boom"]);
});

test("copyDrawing with local data creates local record with list_id (works offline)", async () => {
  setOnline(false);
  const created = await repo.createDrawing({ title: "Src", data_json: '{"store":{"a":1},"schema":{}}' });
  const src = await repo.getDrawing(created.cid, { online: false });
  let called = false;
  const r = await share.copyDrawing({ fetch: async () => { called = true; } }, src, 5, "Salinan");
  assert.equal(r.ok, true); assert.equal(called, false);
  assert.equal(r.drawing.list_id, 5); assert.equal(r.drawing.title, "Salinan");
  const rec = await get("drawings", r.drawing.cid);
  assert.equal(rec.list_id, 5);
  const ops = await outboxAll();
  assert.ok(ops.some((o) => o.cid === r.drawing.cid && o.op === "create" && o.payload.list_id === 5));
});

test("copyDrawing falls back to server copy / refuses offline without data", async () => {
  const missing = { cid: "m1", server_id: 21, title: "Remote", data_missing: 1, data_json: null };
  setOnline(false);
  const off = await share.copyDrawing({ fetch: async () => { throw new Error("no"); } }, missing, 5);
  assert.deepEqual(off, { ok: false, code: "OFFLINE", message: "Data gambar belum tersedia offline." });
  setOnline(true);
  const calls = [];
  const api = { fetch: async (url, opts) => { calls.push({ url, opts }); return { id: 22, client_id: "srv-22", title: "Remote (salinan)", data_json: '{"store":{},"schema":{}}', list_id: 5, user_id: 1, updated_at: "2026-10-19T09:00:00", created_at: "2026-10-19T09:00:00" }; } };
  const r = await share.copyDrawing(api, missing, 5, "T");
  assert.equal(r.ok, true);
  assert.equal(calls[0].url, "/api/drawings/21/copy");
  assert.equal(calls[0].opts.method, "POST"); assert.equal(calls[0].opts.network, true);
  assert.deepEqual(JSON.parse(calls[0].opts.body), { list_id: 5, title: "T" });
  const rec = await get("drawings", "srv-22");
  assert.equal(rec.server_id, 22); assert.equal(rec.list_id, 5);
  const bad = await share.copyDrawing({ fetch: async () => { throw Object.assign(new Error("x"), { status: 403 }); } }, missing, 5);
  assert.deepEqual([bad.ok, bad.code, bad.message], [false, "ERROR", "x"]);
});

test("applyMovedDrawings updates matching records by server_id or client_id", async () => {
  await put("drawings", drw({ cid: "a", server_id: 31, client_id: "ca" }));
  await put("drawings", drw({ cid: "b", server_id: null, client_id: "cb" }));
  await share.applyMovedDrawings([
    { id: 31, client_id: "zzz", list_id: 5, updated_at: "2026-10-19T10:00:00" },
    { id: 99, client_id: "cb", list_id: 5, updated_at: "2026-10-19T10:00:01" },
    { id: 12345, client_id: "none", list_id: 5, updated_at: "x" },
  ]);
  const a = await get("drawings", "a"); const b = await get("drawings", "b");
  assert.deepEqual([a.list_id, a.updated_at, a.base_rev, a.rev], [5, "2026-10-19T10:00:00", "2026-10-19T10:00:00", 4]);
  assert.deepEqual([b.list_id, b.base_rev, b.rev], [5, "2026-10-19T10:00:01", 4]);
  await share.applyMovedDrawings(undefined);
  await share.applyMovedDrawings([]);
});

test("opNoteUpdate applies moved_drawings from response", async () => {
  await put("drawings", drw({ cid: "a", server_id: 31, client_id: "ca" }));
  await put("scratchpad_notes", {
    cid: "n", server_id: 7, title: "N", content: "::draw[31]", linked_task_cids: "[]", linked_to_cids: "[]", pinned: false, list_id: 5,
    created_at: "x", updated_at: "2026-10-15T09:00:00", deleted: false, dirty: 1, base_rev: "2026-10-15T08:00:00", rev: 1,
  });
  await mapPut("note", 7, "n");
  await put("_outbox", { qid: 1, op: "update", entity_type: "note", cid: "n", payload: {} });
  const tr = { request: async () => ({ status: 200, data: { id: 7, updated_at: "2026-10-19T11:00:00", moved_drawings: [{ id: 31, client_id: "ca", list_id: 5, updated_at: "2026-10-19T11:00:00" }] } }) };
  await pushOutbox(tr);
  assert.equal((await get("drawings", "a")).list_id, 5);
  assert.equal((await get("scratchpad_notes", "n")).dirty, 0);
  assert.equal((await outboxAll()).length, 0);
});

test("opNoteCreate applies moved_drawings and a failing apply never fails the push", async () => {
  await put("drawings", drw({ cid: "a", server_id: 31, client_id: "ca" }));
  await put("scratchpad_notes", {
    cid: "n2", server_id: null, title: "N", content: "::draw[31]", linked_task_cids: "[]", linked_to_cids: "[]", pinned: false, list_id: 5,
    created_at: "x", updated_at: "2026-10-15T09:00:00", deleted: false, dirty: 1, base_rev: null, rev: 1,
  });
  await put("_outbox", { qid: 1, op: "create", entity_type: "note", cid: "n2", payload: {} });
  const tr = { request: async () => ({ status: 200, data: { id: 8, updated_at: "2026-10-19T11:00:00", moved_drawings: [{ id: 31, client_id: "ca", list_id: 5, updated_at: "2026-10-19T11:00:00" }, null] } }) };
  const r = await pushOutbox(tr);
  assert.equal((await get("drawings", "a")).list_id, 5);
  assert.equal(r.pushed, 1);
});
