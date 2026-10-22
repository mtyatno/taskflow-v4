"use strict";
// PR 3 Task 1: lapisan offline drawing milik workspace (field scope, daftar shared, guard pemilik, pull/push).
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { deleteDB } = require("./setup.js");
const { DB_NAME, _reset, openDB } = require("../../static/offline/db.js");
const { mapPut } = require("../../static/offline/idmap.js");
const { outboxAll, outboxAdd } = require("../../static/offline/outbox.js");
const { buildTaskRouter } = require("../../static/offline/taskroutes.js");
const repo = require("../../static/offline/drawingrepo.js");
const { pullDrawings, pullDrawingsAndReconcile } = require("../../static/offline/syncpull.js");
const { pushOutbox } = require("../../static/offline/syncpush.js");
const { resolveConflict } = require("../../static/offline/syncconflict.js");

beforeEach(async () => {
  _reset(); await deleteDB(DB_NAME);
  repo.setCurrentUser({ user_id: 3 });
});

async function put(recs) {
  const db = await openDB();
  await new Promise((res, rej) => {
    const tx = db.transaction("drawings", "readwrite");
    for (const r of recs) tx.objectStore("drawings").put(r);
    tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error);
  });
}
async function all() {
  const db = await openDB();
  return new Promise((res, rej) => {
    const r = db.transaction("drawings", "readonly").objectStore("drawings").getAll();
    r.onsuccess = () => res(r.result || []); r.onerror = () => rej(r.error);
  });
}
function local(over) {
  return Object.assign({
    cid: over.cid, server_id: null, title: over.cid, blob_ref: null, svg_preview: "<svg></svg>",
    is_pinned: 0, created_at: "2026-06-12T00:00:00", updated_at: "2026-06-12T00:00:00",
    deleted: false, dirty: 0, base_rev: "2026-06-12T00:00:00", rev: 1,
  }, over);
}
function srvRow(over) {
  return Object.assign({
    id: over.id, client_id: "c" + over.id, title: "S", svg_preview: "<svg></svg>", is_pinned: 0,
    list_id: null, user_id: 3, last_edited_by: null, last_editor_username: null, last_editor_display_name: null,
    created_at: "2026-06-12T00:00:00", updated_at: "2026-06-12T00:00:00",
  }, over);
}

test("createDrawing stores list_id/user_id and queues list_id in create payload", async () => {
  const d = await repo.createDrawing({ title: "W", data_json: "{}", list_id: 9 });
  const rec = (await all())[0];
  assert.equal(rec.list_id, 9);
  assert.equal(rec.user_id, 3);
  assert.equal(rec.last_edited_by, 3);
  assert.equal(d.list_id, 9);
  const ops = await outboxAll();
  assert.equal(ops[0].payload.list_id, 9);
  const p = await repo.createDrawing({ title: "P", data_json: "{}" });
  assert.equal((await all()).find((r) => r.cid === p.cid).list_id, null);
  assert.equal(repo.currentUid(), 3);
});

test("currentUid is null when no user set", () => {
  repo.setCurrentUser(null);
  assert.equal(repo.currentUid(), null);
});

test("updateDrawing stamps last_edited_by and clears last_editor_*", async () => {
  await put([local({ cid: "a", server_id: 5, list_id: 9, user_id: 7, last_edited_by: 7, last_editor_username: "bob", last_editor_display_name: "Bob" })]);
  await repo.updateDrawing("a", { title: "Edited" });
  const rec = (await all())[0];
  assert.equal(rec.last_edited_by, 3);
  assert.equal(rec.last_editor_username, null);
  assert.equal(rec.last_editor_display_name, null);
  assert.equal(rec.list_id, 9);
  assert.equal(rec.user_id, 7);
});

test("adoptServerDrawing keeps list_id, user_id, last_edited_by, last_editor_username", async () => {
  await repo.adoptServerDrawing(Object.assign(srvRow({ id: 11, list_id: 9, user_id: 7, last_edited_by: 8, last_editor_username: "bob", last_editor_display_name: "Bob" }), { data_json: "{}" }));
  const rec = (await all())[0];
  assert.equal(rec.list_id, 9);
  assert.equal(rec.user_id, 7);
  assert.equal(rec.last_edited_by, 8);
  assert.equal(rec.last_editor_username, "bob");
  assert.equal(rec.last_editor_display_name, "Bob");
});

test("getDrawing reconcile (refreshFromServer) updates scope fields", async () => {
  await put([local({ cid: "a", server_id: 5, list_id: null, user_id: 3 })]);
  const got = await repo.getDrawing("a", { online: true, fetch: () => Promise.resolve(Object.assign(srvRow({ id: 5, list_id: 9, last_edited_by: 8, last_editor_username: "bob", updated_at: "2026-06-13T00:00:00" }), { client_id: "a", data_json: '{"store":{},"schema":{}}' })) });
  assert.equal(got.list_id, 9);
  assert.equal(got.last_editor_username, "bob");
  assert.equal((await all())[0].list_id, 9);
});

test("listDrawings requests ?shared=1 and filters by list_id ('personal' | number)", async () => {
  const urls = [];
  const savedFetch = global.window, savedNav = global.navigator, savedLS = global.localStorage;
  global.window = { fetch: (u) => { urls.push(u); return Promise.resolve({ ok: true, json: () => Promise.resolve([
    srvRow({ id: 21, title: "Srv", list_id: 9, user_id: 7, last_edited_by: 7, last_editor_username: "bob" }),
  ]) }); } };
  Object.defineProperty(global, "navigator", { value: { onLine: true }, configurable: true });
  global.localStorage = { getItem: () => "tok" };
  try {
    await put([local({ cid: "p", title: "Mine", list_id: null, user_id: 3 }), local({ cid: "w", title: "Ws", list_id: 4, user_id: 3 })]);
    const everything = await repo.listDrawings({});
    assert.equal(urls[0], "/api/drawings?shared=1");
    const srv = everything.find((d) => d.title === "Srv");
    assert.equal(srv.list_id, 9);
    const mine = everything.find((d) => d.title === "Mine");
    assert.equal(mine.list_id, null);
    assert.equal(mine.user_id, 3);
    assert.ok("last_edited_by" in mine);
    assert.deepEqual((await repo.listDrawings({ list_id: "personal" })).map((d) => d.title), ["Mine"]);
    assert.deepEqual((await repo.listDrawings({ list_id: 4 })).map((d) => d.title), ["Ws"]);
    assert.deepEqual((await repo.listDrawings({ list_id: "9" })).map((d) => d.title), ["Srv"]);
  } finally {
    global.window = savedFetch;
    if (savedNav === undefined) delete global.navigator; else Object.defineProperty(global, "navigator", { value: savedNav, configurable: true });
    global.localStorage = savedLS;
  }
});

test("local GET /api/lists/:id/drawings lists only that workspace", async () => {
  const R = buildTaskRouter();
  await put([
    local({ cid: "a", title: "A", list_id: 9, user_id: 3, server_id: 50, updated_at: "2026-06-12T00:00:01" }),
    local({ cid: "b", title: "B", list_id: 9, user_id: 7, updated_at: "2026-06-12T00:00:05" }),
    local({ cid: "c", title: "C", list_id: 4, user_id: 3 }),
    local({ cid: "d", title: "D", list_id: null, user_id: 3 }),
    local({ cid: "e", title: "E", list_id: 9, user_id: 3, deleted: true }),
  ]);
  const list = await R.dispatch("GET", "/api/lists/9/drawings", undefined);
  assert.deepEqual(list.map((d) => d.title), ["B", "A"]);
  assert.deepEqual(Object.keys(list[0]).sort(), ["client_id", "id", "list_id", "svg_preview", "title", "updated_at", "user_id"]);
  assert.equal(list[1].id, 50);
  assert.equal(list[0].id, "b");
});

test("member delete/pin of others' drawing is rejected locally", async () => {
  const R = buildTaskRouter();
  await put([local({ cid: "o", server_id: 60, list_id: 9, user_id: 7 })]);
  for (const [m, p] of [["DELETE", "/api/drawings/60"], ["PATCH", "/api/drawings/60/pin"], ["DELETE", "/api/drawings/o"]]) {
    await assert.rejects(R.dispatch(m, p, undefined), (e) => e.status === 403 && e.message === "Hanya pemilik sketsa" && e.body.detail === "Hanya pemilik sketsa");
  }
  assert.deepEqual(await outboxAll(), []);
  const rec = (await all())[0];
  assert.equal(rec.deleted, false);
  assert.equal(rec.is_pinned, 0);
  assert.equal(rec.dirty, 0);
});

test("owner and legacy (no user_id) rows can delete/pin locally", async () => {
  const R = buildTaskRouter();
  await put([local({ cid: "m", user_id: 3 }), local({ cid: "l" })]);
  await R.dispatch("PATCH", "/api/drawings/m/pin", undefined);
  await R.dispatch("DELETE", "/api/drawings/l", undefined);
  repo.setCurrentUser(null);
  await put([local({ cid: "x", user_id: 7 })]);
  await R.dispatch("PATCH", "/api/drawings/x/pin", undefined); // uid tidak diketahui → tidak menolak
  const recs = await all();
  assert.equal(recs.find((r) => r.cid === "m").is_pinned, 1);
  assert.equal(recs.find((r) => r.cid === "l").deleted, true);
  assert.equal(recs.find((r) => r.cid === "x").is_pinned, 1);
});

test("local GET by server id finds other user's workspace drawing", async () => {
  const R = buildTaskRouter();
  await put([local({ cid: "o", server_id: 60, list_id: 9, user_id: 7, last_edited_by: 7 })]);
  await mapPut("drawing", 60, "o");
  const got = await R.dispatch("GET", "/api/drawings/60", undefined);
  assert.equal(got.cid, "o");
  assert.equal(got.list_id, 9);
  assert.equal(got.user_id, 7);
});

test("pull copies scope fields from server rows", async () => {
  const rows = [srvRow({ id: 70, list_id: 9, user_id: 7, last_edited_by: 8, last_editor_username: "bob", last_editor_display_name: "Bob" })];
  await pullDrawings(rows, (sid) => Promise.resolve(Object.assign({}, rows[0], { data_json: "{}" })));
  const rec = (await all())[0];
  assert.equal(rec.list_id, 9);
  assert.equal(rec.user_id, 7);
  assert.equal(rec.last_editor_display_name, "Bob");
});

test("pull adopts scope fields onto pre-upgrade records even when the server row is not newer", async () => {
  const blob = await repo._BlobStore.put('{"store":{},"schema":{}}', { mime: "application/json" });
  // Record dari sebelum upgrade: user_id/list_id/last_editor_* undefined; revisi sama dengan server.
  const pre = local({ cid: "pre", server_id: 90, blob_ref: blob, base_blob_ref: blob, svg_preview: "<svg>x</svg>", rev: 4 });
  const dirtyPre = local({ cid: "dp", server_id: 91, blob_ref: blob, dirty: 1, rev: 2 });
  // Terikat ke baris lain (keep_as_new: server_id null) → tidak disentuh.
  const detached = local({ cid: "kn", server_id: null, user_id: 3, list_id: null, dirty: 1 });
  await put([pre, dirtyPre, detached]);
  await mapPut("drawing", 90, "pre"); await mapPut("drawing", 91, "dp"); await mapPut("drawing", 92, "kn");
  await outboxAdd({ op: "update", entity_type: "drawing", cid: "dp", payload: {} });
  await outboxAdd({ op: "create", entity_type: "drawing", cid: "kn", payload: {} });
  const rows = [
    srvRow({ id: 90, list_id: 5, user_id: 7, last_edited_by: 7, last_editor_username: "bob", last_editor_display_name: "Bob" }),
    srvRow({ id: 91, list_id: 5, user_id: 7 }),
    srvRow({ id: 92, list_id: 5, user_id: 7 }),
  ];
  let fetched = 0;
  await pullDrawings(rows, () => { fetched++; return Promise.resolve(null); });
  const by = Object.fromEntries((await all()).map((r) => [r.cid, r]));
  const a = by.pre;
  assert.deepEqual([a.user_id, a.list_id, a.last_edited_by, a.last_editor_username, a.last_editor_display_name], [7, 5, 7, "bob", "Bob"]);
  // isi, base_rev, updated_at, dirty, rev tidak berubah
  assert.deepEqual([a.blob_ref, a.base_rev, a.updated_at, a.dirty, a.rev, a.svg_preview, a.title], [blob, pre.base_rev, pre.updated_at, 0, 4, "<svg>x</svg>", "pre"]);
  const d = by.dp;
  assert.deepEqual([d.user_id, d.list_id, d.dirty, d.rev, d.base_rev, d.blob_ref], [7, 5, 1, 2, dirtyPre.base_rev, blob]);
  assert.deepEqual([by.kn.user_id, by.kn.list_id], [3, null]);
  assert.equal(fetched, 0); // tidak ada revisi baru → tidak ada unduhan isi
  // Baris tidak berubah lagi → pull kedua tidak menulis (rev tetap)
  await pullDrawings(rows, () => Promise.resolve(null));
  assert.equal((await all()).find((r) => r.cid === "pre").rev, 4);
});

test("pull removes lost workspace drawings; dirty one becomes access_lost", async () => {
  await put([
    local({ cid: "gone", server_id: 81, list_id: 9, user_id: 7 }),
    local({ cid: "edited", server_id: 82, list_id: 9, user_id: 7, dirty: 1, rev: 2 }),
  ]);
  await mapPut("drawing", 81, "gone"); await mapPut("drawing", 82, "edited");
  await outboxAdd({ op: "update", entity_type: "drawing", cid: "edited", payload: {} });
  let fetched = 0;
  const res = await pullDrawings([], () => { fetched++; return Promise.resolve(null); }); // fetchOne tidak membuktikan apa pun
  const recs = await all();
  assert.equal(recs.find((r) => r.cid === "gone"), undefined);
  assert.equal(recs.find((r) => r.cid === "edited").conflict, "access_lost");
  assert.equal(res.deleted, 1);
  assert.equal(fetched, 0);
  const { serverIdOf } = require("../../static/offline/idmap.js");
  assert.equal(await serverIdOf("gone"), undefined);
  const { cidOf } = require("../../static/offline/idmap.js");
  assert.equal(await cidOf("drawing", 81), undefined);
});

test("pull keeps own drawings missing from list until 404 (old behaviour)", async () => {
  await put([local({ cid: "mine", server_id: 91, list_id: 9, user_id: 3 }), local({ cid: "legacy", server_id: 92 })]);
  await pullDrawings([], () => Promise.resolve(null));
  assert.equal((await all()).length, 2);
  await pullDrawings([], () => Promise.resolve({ status: 404 }));
  assert.equal((await all()).length, 0);
});

test("pullDrawingsAndReconcile uses /api/drawings?shared=1", async () => {
  const urls = [];
  await pullDrawingsAndReconcile((u) => { urls.push(u); return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) }); });
  assert.equal(urls[0], "/api/drawings?shared=1");
});

test("opDrawingCreate sends list_id", async () => {
  const d = await repo.createDrawing({ title: "W", data_json: '{"a":1}', list_id: 9 });
  const bodies = [];
  const tr = { request: (method, path, body) => { bodies.push(body); return Promise.resolve({ status: 200, data: { id: 700, updated_at: "2026-08-25T12:00:00" } }); } };
  await pushOutbox(tr);
  assert.equal(bodies[0].list_id, 9);
  assert.equal(d.list_id, 9);
});

test("access_lost -> keep_as_new -> owner can delete/pin offline and record user_id is current user", async () => {
  await put([local({ cid: "k", server_id: 95, list_id: 9, user_id: 7, last_edited_by: 7, last_editor_username: "bob", last_editor_display_name: "Bob", conflict: "access_lost", dirty: 1 })]);
  await resolveConflict("drawing", "k", "keep_as_new");
  const rec = (await all())[0];
  assert.equal(rec.user_id, 3);
  assert.equal(rec.last_edited_by, 3);
  assert.equal(rec.list_id, null);
  assert.equal("last_editor_username" in rec, false);
  assert.equal("last_editor_display_name" in rec, false);
  const R = buildTaskRouter();
  await R.dispatch("PATCH", "/api/drawings/k/pin", undefined);
  await R.dispatch("DELETE", "/api/drawings/k", undefined);
  assert.equal((await all())[0].deleted, true);
});

test("create push adopts user_id/list_id from the response", async () => {
  repo.setCurrentUser(null);
  const d = await repo.createDrawing({ title: "W", data_json: '{"a":1}' });
  assert.equal((await all())[0].user_id, null);
  const tr = { request: () => Promise.resolve({ status: 200, data: { id: 701, user_id: 3, list_id: 9, updated_at: "2026-08-25T12:00:00" } }) };
  await pushOutbox(tr);
  const rec = (await all()).find((r) => r.cid === d.cid);
  assert.equal(rec.user_id, 3);
  assert.equal(rec.list_id, 9);
  assert.equal(rec.server_id, 701);
});
