"use strict";
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { deleteDB } = require("./setup.js");
const { DB_NAME, _reset, openDB } = require("../../static/offline/db.js");
const { mapPut, cidOf, serverIdOf } = require("../../static/offline/idmap.js");
const { outboxAdd, outboxAll } = require("../../static/offline/outbox.js");
const {
  mindmapToCreatePayload, mindmapToUpdatePayload, pushOutbox,
} = require("../../static/offline/syncpush.js");

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
async function allMM() {
  const db = await openDB();
  return new Promise((res) => { const q = db.transaction("mindmaps").objectStore("mindmaps").getAll(); q.onsuccess = () => res(q.result); });
}
function mm(over) {
  return Object.assign({
    cid: over.cid, server_id: null, title: "M", data_json: "{\"nodeData\":{}}",
    pinned: false, list_id: null, created_at: "2026-06-10T00:00:00", updated_at: "2026-06-10T00:00:00",
    deleted: false, dirty: 1, base_rev: null,
  }, over);
}
function fakeTransport(handler) {
  const calls = [];
  return { calls, request(method, path, body) { calls.push({ method, path, body }); const h = handler(method, path, body); if (h === "NETWORK") return Promise.reject(new Error("net")); return Promise.resolve(h); } };
}
const VIEW = '{"linked":1,"direction":2,"justify":false,"collapsed":[],"summary":true}';
function linked(over) {
  return mm(Object.assign({ source_note_cid: "n1", source_note_id: null, title: "N", data_json: VIEW, rev: 1 }, over));
}

test("linked create is held until the note has a server id", async () => {
  // sync_error: create catatan gagal permanen (tidak di-heal ulang) → catatan tetap tanpa server id
  await put("scratchpad_notes", [{ cid: "n1", server_id: null, title: "N", content: "", deleted: false, sync_error: { status: 422 } }]);
  await put("mindmaps", [linked({ cid: "m" })]);
  await outboxAdd({ op: "create", entity_type: "mindmap", cid: "m", payload: { cid: "m" } });
  const t = fakeTransport(() => ({ status: 200, data: { id: 50 } }));
  await pushOutbox(t);
  assert.equal(t.calls.length, 0);
  assert.equal((await outboxAll()).filter((o) => o.cid === "m" && o.op === "create").length, 1);
  assert.equal((await getMM("m")).server_id, null);
});

test("held linked create does not block later ops in the outbox", async () => {
  await put("scratchpad_notes", [{ cid: "n1", server_id: null, title: "N", content: "", deleted: false, dirty: 1, rev: 1 }]);
  await put("mindmaps", [linked({ cid: "m" }), mm({ cid: "plain", title: "P" })]);
  await outboxAdd({ op: "create", entity_type: "note", cid: "n1", payload: {} });
  await outboxAdd({ op: "create", entity_type: "mindmap", cid: "m", payload: { cid: "m" } });
  await outboxAdd({ op: "create", entity_type: "mindmap", cid: "plain", payload: {} });
  // create catatan kena 503 → tetap antre; peta tertaut ditahan; peta lain tetap dikirim
  const t = fakeTransport((method, path) => (path === "/api/mindmaps"
    ? { status: 200, data: { id: 60, updated_at: "2026-10-18T03:00:00Z" } }
    : { status: 503, data: {} }));
  await pushOutbox(t);
  const mmCalls = t.calls.filter((c) => c.path === "/api/mindmaps");
  assert.equal(mmCalls.length, 1);
  assert.equal(mmCalls[0].body.client_id, "plain");
  assert.equal(await serverIdOf("plain"), 60);
  const ops = await outboxAll();
  assert.equal(ops.filter((o) => o.cid === "m" && o.op === "create").length, 1);
  assert.equal(ops.filter((o) => o.cid === "n1" && o.op === "create").length, 1);
});

test("linked create sends source_note_id once the note is pushed", async () => {
  await put("scratchpad_notes", [{ cid: "n1", server_id: 7, title: "N", content: "", deleted: false }]);
  await put("mindmaps", [linked({ cid: "m" })]);
  await outboxAdd({ op: "create", entity_type: "mindmap", cid: "m", payload: { cid: "m" } });
  const t = fakeTransport(() => ({ status: 200, data: { id: 50, updated_at: "2026-10-18T03:00:00Z", source_note_id: 7 } }));
  await pushOutbox(t);
  assert.equal(t.calls.length, 1);
  assert.equal(t.calls[0].method, "POST");
  assert.equal(t.calls[0].path, "/api/mindmaps");
  assert.deepEqual(t.calls[0].body, { title: "N", data_json: VIEW, list_id: null, client_id: "m", source_note_id: 7 });
  const rec = await getMM("m");
  assert.equal(rec.server_id, 50);
  assert.equal(rec.dirty, 0);
  assert.equal(await cidOf("mindmap", 50), "m");
  assert.equal((await outboxAll()).length, 0);
});

test("note server id known only via idmap → used as source_note_id", async () => {
  // sync_error: jauhkan healStrandedNotes (fixture hanya menguji fallback TFidmap.serverIdOf)
  await put("scratchpad_notes", [{ cid: "n1", server_id: null, title: "N", content: "", deleted: false, sync_error: { status: 422 } }]);
  await mapPut("note", 9, "n1");
  await put("mindmaps", [linked({ cid: "m" })]);
  await outboxAdd({ op: "create", entity_type: "mindmap", cid: "m", payload: { cid: "m" } });
  const t = fakeTransport(() => ({ status: 200, data: { id: 51, updated_at: "2026-10-18T03:00:00Z" } }));
  await pushOutbox(t);
  assert.equal(t.calls.length, 1);
  assert.equal(t.calls[0].body.source_note_id, 9);
});

test("note pushed earlier in the same drain → linked create follows in that drain", async () => {
  await put("scratchpad_notes", [{ cid: "n1", server_id: null, title: "N", content: "", deleted: false, dirty: 1, rev: 1 }]);
  await put("mindmaps", [linked({ cid: "m" })]);
  await outboxAdd({ op: "create", entity_type: "note", cid: "n1", payload: {} });
  await outboxAdd({ op: "create", entity_type: "mindmap", cid: "m", payload: { cid: "m" } });
  const t = fakeTransport((method, path) => (path === "/api/mindmaps"
    ? { status: 200, data: { id: 50, updated_at: "2026-10-18T03:00:00Z" } }
    : { status: 200, data: { id: 7, updated_at: "2026-10-18T03:00:00Z" } }));
  await pushOutbox(t);
  const mmCall = t.calls.find((c) => c.path === "/api/mindmaps");
  assert.ok(mmCall, "mindmap POST sent");
  assert.equal(mmCall.body.source_note_id, 7);
  assert.equal((await outboxAll()).length, 0);
});

test("linked record without source_note_cid falls back to source_note_id", async () => {
  await put("mindmaps", [linked({ cid: "m", source_note_cid: null, source_note_id: 7 })]);
  await outboxAdd({ op: "create", entity_type: "mindmap", cid: "m", payload: { cid: "m" } });
  const t = fakeTransport(() => ({ status: 200, data: { id: 50, updated_at: "2026-10-18T03:00:00Z" } }));
  await pushOutbox(t);
  assert.equal(t.calls.length, 1);
  assert.equal(t.calls[0].body.source_note_id, 7);
});

test("note deleted → op dropped and local map removed", async () => {
  await put("scratchpad_notes", [{ cid: "n1", server_id: 7, title: "N", content: "", deleted: true }]);
  await put("mindmaps", [linked({ cid: "m" })]);
  await outboxAdd({ op: "create", entity_type: "mindmap", cid: "m", payload: { cid: "m" } });
  const t = fakeTransport(() => ({ status: 200, data: { id: 50 } }));
  await pushOutbox(t);
  assert.equal(t.calls.length, 0);
  assert.equal(await getMM("m"), undefined);
  assert.equal((await outboxAll()).length, 0);
});

test("note missing locally → op dropped and local map removed", async () => {
  await put("mindmaps", [linked({ cid: "m" })]);
  await outboxAdd({ op: "create", entity_type: "mindmap", cid: "m", payload: { cid: "m" } });
  const t = fakeTransport(() => ({ status: 200, data: { id: 50 } }));
  await pushOutbox(t);
  assert.equal(t.calls.length, 0);
  assert.equal(await getMM("m"), undefined);
  assert.equal((await outboxAll()).length, 0);
});

test("linked create 404 (note inaccessible on server) → op dropped and local map removed", async () => {
  await put("scratchpad_notes", [{ cid: "n1", server_id: 7, title: "N", content: "", deleted: false }]);
  await put("mindmaps", [linked({ cid: "m" })]);
  await outboxAdd({ op: "create", entity_type: "mindmap", cid: "m", payload: { cid: "m" } });
  const t = fakeTransport(() => ({ status: 404, data: { detail: "Catatan tidak ditemukan" } }));
  const r = await pushOutbox(t);
  assert.equal(t.calls.length, 1);
  assert.equal(await getMM("m"), undefined);
  assert.equal((await outboxAll()).length, 0);
  assert.equal(r.failed, 0);
});

test("server returns an existing linked map already pulled locally → merged", async () => {
  await put("scratchpad_notes", [{ cid: "n1", server_id: 7, title: "N", content: "", deleted: false }]);
  await put("mindmaps", [mm({ cid: "a", server_id: 50, source_note_cid: "n1", source_note_id: 7, dirty: 0, updated_at: "2026-10-18T01:00:00Z", data_json: '{"linked":1,"direction":2}' }),
                         mm({ cid: "b", source_note_cid: "n1", source_note_id: 7, dirty: 1, updated_at: "2026-10-18T02:00:00Z", data_json: '{"linked":1,"direction":3}' })]);
  await mapPut("mindmap", 50, "a");
  await outboxAdd({ op: "create", entity_type: "mindmap", cid: "b", payload: { cid: "b" } });
  const t = fakeTransport(() => ({ status: 200, data: { id: 50, updated_at: "2026-10-18T03:00:00Z", source_note_id: 7 } }));
  await pushOutbox(t);
  assert.equal(await getMM("b"), undefined);
  assert.equal((await getMM("a")).data_json, '{"linked":1,"direction":3}'); // view-state yang lebih baru dipakai
  assert.equal(await cidOf("mindmap", 50), "a");
  assert.equal((await outboxAll()).filter((o) => o.cid === "b").length, 0);
});

test("merge: newer view-state makes the kept map dirty with an update op; older one is discarded", async () => {
  await put("scratchpad_notes", [{ cid: "n1", server_id: 7, title: "N", content: "", deleted: false }]);
  await put("mindmaps", [mm({ cid: "a", server_id: 50, source_note_cid: null, source_note_id: 7, dirty: 0, rev: 2, updated_at: "2026-10-18T01:00:00Z", data_json: '{"linked":1,"direction":2}' }),
                         mm({ cid: "b", source_note_cid: "n1", source_note_id: null, dirty: 1, updated_at: "2026-10-18T02:00:00Z", data_json: '{"linked":1,"direction":3}' })]);
  await mapPut("mindmap", 50, "a");
  await outboxAdd({ op: "create", entity_type: "mindmap", cid: "b", payload: { cid: "b" } });
  const t = fakeTransport((method) => (method === "POST"
    ? { status: 200, data: { id: 50, updated_at: "2026-10-18T03:00:00Z", source_note_id: 7 } }
    : { status: 200, data: { id: 50, updated_at: "2026-10-18T04:00:00Z" } }));
  await pushOutbox(t);
  const a = await getMM("a");
  assert.equal(a.dirty, 1);
  assert.equal(a.rev, 3);
  assert.equal(a.source_note_cid, "n1");
  assert.equal((await outboxAll()).filter((o) => o.cid === "a" && o.op === "update").length, 1);
  assert.equal((await allMM()).length, 1);

  // sebaliknya: peta yang sudah ada lebih baru → data_json-nya tetap, tidak dirty
  _reset(); await deleteDB(DB_NAME);
  await put("scratchpad_notes", [{ cid: "n1", server_id: 7, title: "N", content: "", deleted: false }]);
  await put("mindmaps", [mm({ cid: "a", server_id: 50, source_note_cid: "n1", source_note_id: 7, dirty: 0, updated_at: "2026-10-18T05:00:00Z", data_json: '{"linked":1,"direction":2}' }),
                         mm({ cid: "b", source_note_cid: "n1", dirty: 1, updated_at: "2026-10-18T02:00:00Z", data_json: '{"linked":1,"direction":3}' })]);
  await mapPut("mindmap", 50, "a");
  await outboxAdd({ op: "create", entity_type: "mindmap", cid: "b", payload: { cid: "b" } });
  await pushOutbox(fakeTransport(() => ({ status: 200, data: { id: 50, updated_at: "2026-10-18T03:00:00Z" } })));
  const a2 = await getMM("a");
  assert.equal(a2.data_json, '{"linked":1,"direction":2}');
  assert.equal(a2.dirty, 0);
  assert.equal(await getMM("b"), undefined);
  assert.equal((await outboxAll()).length, 0);
});

test("linked update payload omits base_rev", () => {
  const p = mindmapToUpdatePayload(mm({ cid: "m", source_note_cid: "n1", title: "T", data_json: VIEW, base_rev: "x" }));
  assert.equal(p.base_rev, undefined);
  assert.equal(p.title, "T");
  // peta biasa tetap membawa base_rev
  assert.equal(mindmapToUpdatePayload(mm({ cid: "m", base_rev: "x" })).base_rev, "x");
});

test("R15: linked create/update payloads carry a non-empty title", () => {
  const rec = mm({ cid: "m", source_note_cid: "n1", title: "", data_json: VIEW });
  assert.equal(mindmapToCreatePayload(rec, 7).title, "Tanpa judul");
  assert.equal(mindmapToCreatePayload(rec, 7).source_note_id, 7);
  assert.equal(mindmapToUpdatePayload(rec).title, "Tanpa judul");
  assert.equal(mindmapToCreatePayload(mm({ cid: "m", source_note_cid: "n1", title: null }), 7).title, "Tanpa judul");
  // peta biasa tidak membawa source_note_id
  assert.equal("source_note_id" in mindmapToCreatePayload(mm({ cid: "m" })), false);
});

test("linked update 400 LINKED_TREE_REJECTED → op dropped, no conflict copy", async () => {
  await put("scratchpad_notes", [{ cid: "n1", server_id: 7, title: "N", content: "", deleted: false }]);
  await put("mindmaps", [linked({ cid: "m", server_id: 50, source_note_id: 7, base_rev: "2026-10-18T01:00:00Z" })]);
  await mapPut("mindmap", 50, "m");
  await outboxAdd({ op: "update", entity_type: "mindmap", cid: "m", payload: {} });
  const t = fakeTransport(() => ({ status: 400, data: { detail: { code: "LINKED_TREE_REJECTED" } } }));
  const orig = console.warn; let warned = 0; console.warn = () => { warned++; };
  try { await pushOutbox(t); } finally { console.warn = orig; }
  assert.equal(t.calls.length, 1);
  assert.equal(t.calls[0].body.base_rev, undefined);
  assert.equal((await outboxAll()).length, 0);
  assert.equal((await allMM()).length, 1);
  const rec = await getMM("m");
  assert.equal(rec.conflict, undefined);
  assert.equal(rec.sync_error, undefined);
  assert.equal(warned, 1);
});

test("linked update 404 → re-POST carries source_note_id (R15)", async () => {
  await put("scratchpad_notes", [{ cid: "n1", server_id: 7, title: "N", content: "", deleted: false }]);
  await put("mindmaps", [linked({ cid: "m", server_id: 50, source_note_id: 7, list_id: 3, title: "" })]);
  await mapPut("mindmap", 50, "m");
  await outboxAdd({ op: "update", entity_type: "mindmap", cid: "m", payload: {} });
  const t = fakeTransport((method) => (method === "PUT"
    ? { status: 404, data: { detail: "Not found" } }
    : { status: 200, data: { id: 61, updated_at: "2026-10-18T03:00:00Z" } }));
  await pushOutbox(t);
  assert.equal(t.calls.length, 2);
  assert.equal(t.calls[1].method, "POST");
  assert.equal(t.calls[1].body.source_note_id, 7);
  assert.equal(t.calls[1].body.title, "Tanpa judul");
  assert.equal(await serverIdOf("m"), 61);
  const rec = await getMM("m");
  assert.equal(rec.server_id, 61);
  assert.equal(rec.conflict, undefined);
  assert.equal((await outboxAll()).length, 0);
});

test("linked update 404 and re-POST 404 → local map removed", async () => {
  await put("scratchpad_notes", [{ cid: "n1", server_id: 7, title: "N", content: "", deleted: false }]);
  await put("mindmaps", [linked({ cid: "m", server_id: 50, source_note_id: 7 })]);
  await mapPut("mindmap", 50, "m");
  await outboxAdd({ op: "update", entity_type: "mindmap", cid: "m", payload: {} });
  const t = fakeTransport(() => ({ status: 404, data: { detail: "Catatan tidak ditemukan" } }));
  await pushOutbox(t);
  assert.equal(t.calls.length, 2);
  assert.equal(await getMM("m"), undefined);
  assert.equal(await cidOf("mindmap", 50), undefined);
  assert.equal((await outboxAll()).length, 0);
});
