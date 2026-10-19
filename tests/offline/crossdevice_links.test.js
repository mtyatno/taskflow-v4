"use strict";
// Temuan mindmap #1: link node (task/mindmap) ber-id uuid (cid perangkat pembuat = client_id server) harus bisa
// dibuka di perangkat lain / setelah data lokal direset → pull memakai client_id sebagai cid, menyimpan client_id
// di record lokal (backfill untuk record lama), dan resolver lokal fallback ke client_id.
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { deleteDB } = require("./setup.js");
const { DB_NAME, _reset, openDB } = require("../../static/offline/db.js");
const { mapPut } = require("../../static/offline/idmap.js");
const { pullTasks, pullMindmaps } = require("../../static/offline/syncpull.js");
const { pushOutbox } = require("../../static/offline/syncpush.js");
const { buildTaskRouter } = require("../../static/offline/taskroutes.js");

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
async function get(store, cid) {
  const db = await openDB();
  return new Promise((res) => { const q = db.transaction(store).objectStore(store).get(cid); q.onsuccess = () => res(q.result); });
}
function srvTask(over) {
  return Object.assign({
    id: over.id, title: "T", description: "", gtd_status: "next", priority: "P3", quadrant: "Q4",
    project: "", context: "", deadline: null, waiting_for: "", completed_at: null, progress: 0,
    is_focused: 0, assigned_to: null, parent_id: null, list_id: null,
    recurrence_type: null, recurrence_days: null, recurrence_end_date: null, recurrence_notif_level: null,
    created_at: "2026-06-01T00:00:00", updated_at: "2026-06-04T00:00:00", client_id: null,
  }, over);
}
function mmRow(over) {
  return Object.assign({ id: over.id, title: "S", is_pinned: 0, list_id: null, created_at: "2026-06-10T00:00:00", updated_at: "2026-06-10T00:00:00", client_id: null }, over);
}
function fullFor(rows) {
  return (sid) => { const r = rows.find((x) => String(x.id) === String(sid)); return Promise.resolve(r ? Object.assign({ data_json: "{\"nodeData\":{\"id\":\"root\"}}" }, r) : null); };
}
function fakeTransport(handler) {
  const calls = [];
  return {
    calls,
    request(method, path, body) { calls.push({ method, path, body }); return Promise.resolve(handler(method, path, body)); },
  };
}

// --- 1. pull memakai client_id sebagai cid + menyimpan client_id -------------------------------------------

test("pull task with client_id on empty device → cid = client_id, client_id kept, router opens it by uuid", async () => {
  const r = await pullTasks([srvTask({ id: 7, title: "Dari A", client_id: "u-1" })]);
  assert.equal(r.created, 1);
  const rows = await getAll("tasks");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].cid, "u-1");
  assert.equal(rows[0].client_id, "u-1");
  assert.equal(rows[0].server_id, 7);
  const R = buildTaskRouter();
  const got = await R.dispatch("GET", "/api/tasks/u-1", undefined);
  assert.equal(got.title, "Dari A");
  assert.equal(got.id, 7);
});

test("pull task without client_id still gets a fresh cid", async () => {
  await pullTasks([srvTask({ id: 8, client_id: null })]);
  const rows = await getAll("tasks");
  assert.equal(rows.length, 1);
  assert.ok(rows[0].cid);
  assert.equal(rows[0].client_id == null, true);
});

test("pull mindmap with client_id on empty device → cid = client_id, client_id kept, router opens it by uuid", async () => {
  const rows = [mmRow({ id: 5, title: "Peta A", client_id: "u-1" })];
  const r = await pullMindmaps(rows, fullFor(rows));
  assert.equal(r.created, 1);
  const local = await getAll("mindmaps");
  assert.equal(local.length, 1);
  assert.equal(local[0].cid, "u-1");
  assert.equal(local[0].client_id, "u-1");
  const R = buildTaskRouter();
  const got = await R.dispatch("GET", "/api/mindmaps/u-1", undefined);
  assert.equal(got.title, "Peta A");
  assert.equal(got.id, 5);
});

test("pull task whose client_id equals an unmapped local cid → treated as the same record (no duplicate)", async () => {
  await put("tasks", [{ cid: "u-3", server_id: null, title: "Lokal", gtd_status: "next", base_rev: null, deleted: false, dirty: 0 }]);
  await pullTasks([srvTask({ id: 9, title: "Lokal", client_id: "u-3" })]);
  const rows = await getAll("tasks");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].cid, "u-3");
  assert.equal(rows[0].server_id, 9);
});

test("two server rows sharing a client_id in one pull do not collide on the same cid", async () => {
  await pullTasks([srvTask({ id: 11, title: "Satu", client_id: "u-dup" }), srvTask({ id: 12, title: "Dua", client_id: "u-dup" })]);
  const rows = await getAll("tasks");
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((r) => r.title).sort(), ["Dua", "Satu"]);
  assert.equal(rows.filter((r) => r.cid === "u-dup").length, 1);
});

// --- 3. backfill client_id pada record lama yang tidak berubah ---------------------------------------------

test("task backfill: old local record (random cid, no client_id, same updated_at) gets client_id; dirty/rev untouched; resolver finds it", async () => {
  await put("tasks", [{ cid: "acak", server_id: 10, title: "Lama", gtd_status: "next", base_rev: "2026-06-04T00:00:00",
    updated_at: "2026-06-04T00:00:00", deleted: false, dirty: 0, rev: 4 }]);
  await mapPut("task", 10, "acak");
  const r = await pullTasks([srvTask({ id: 10, title: "Lama", updated_at: "2026-06-04T00:00:00", client_id: "u-2" })]);
  assert.equal(r.updated, 0);
  const rec = await get("tasks", "acak");
  assert.equal(rec.client_id, "u-2");
  assert.equal(rec.dirty, 0);
  assert.equal(rec.rev, 4);
  const R = buildTaskRouter();
  const got = await R.dispatch("GET", "/api/tasks/u-2", undefined);
  assert.equal(got.title, "Lama");
  assert.equal(got.id, 10);
});

test("task backfill keeps a dirty record dirty (client_id only)", async () => {
  await put("tasks", [{ cid: "acak", server_id: 10, title: "Edit lokal", gtd_status: "next", base_rev: "2026-06-04T00:00:00",
    deleted: false, dirty: 1, rev: 6 }]);
  await mapPut("task", 10, "acak");
  await put("_outbox", [{ qid: 1, op: "update", entity_type: "task", cid: "acak", payload: {} }]);
  await pullTasks([srvTask({ id: 10, title: "Server", updated_at: "2026-06-04T00:00:00", client_id: "u-2" })]);
  const rec = await get("tasks", "acak");
  assert.equal(rec.client_id, "u-2");
  assert.equal(rec.dirty, 1);
  assert.equal(rec.rev, 6);
  assert.equal(rec.title, "Edit lokal");
});

test("mindmap backfill: old local record (random cid, no client_id, unchanged) gets client_id; dirty/rev untouched; resolver finds it", async () => {
  await put("mindmaps", [{ cid: "acak", server_id: 5, title: "Lama", data_json: "{}", pinned: false, list_id: null, created_at: "x",
    updated_at: "2026-06-10T00:00:00", deleted: false, dirty: 0, base_rev: "2026-06-10T00:00:00", rev: 3 }]);
  await mapPut("mindmap", 5, "acak");
  const rows = [mmRow({ id: 5, title: "Lama", client_id: "u-2" })];
  let fetches = 0;
  await pullMindmaps(rows, (sid) => { fetches++; return fullFor(rows)(sid); });
  assert.equal(fetches, 0);
  const rec = await get("mindmaps", "acak");
  assert.equal(rec.client_id, "u-2");
  assert.equal(rec.dirty, 0);
  assert.equal(rec.rev, 3);
  const R = buildTaskRouter();
  const got = await R.dispatch("GET", "/api/mindmaps/u-2", undefined);
  assert.equal(got.title, "Lama");
});

test("mindmap full write (server changed) stores client_id from the server row", async () => {
  await put("mindmaps", [{ cid: "acak", server_id: 5, title: "Lama", data_json: "{}", pinned: false, list_id: null, created_at: "x",
    updated_at: "2026-06-10T00:00:00", deleted: false, dirty: 0, base_rev: "2026-06-10T00:00:00", rev: 3 }]);
  await mapPut("mindmap", 5, "acak");
  const rows = [mmRow({ id: 5, title: "Baru", updated_at: "2026-06-11T00:00:00", client_id: "u-2" })];
  await pullMindmaps(rows, fullFor(rows));
  const rec = await get("mindmaps", "acak");
  assert.equal(rec.title, "Baru");
  assert.equal(rec.client_id, "u-2");
});

// --- 4. resolver fallback client_id (note) -------------------------------------------------------------------

test("note resolver falls back to client_id", async () => {
  await put("scratchpad_notes", [{ cid: "acak", server_id: 3, client_id: "u-9", title: "Catatan", content: "", deleted: false, dirty: 0 }]);
  const R = buildTaskRouter();
  const got = await R.dispatch("GET", "/api/scratchpad/u-9", undefined);
  assert.equal(got.title, "Catatan");
});

// --- 5. ujung-ke-ujung: perangkat A buat → push → perangkat B pull → buka link uuid ------------------------

test("end-to-end: task created on device A via local router opens by its uuid on empty device B after pull", async () => {
  const RA = buildTaskRouter();
  const created = await RA.dispatch("POST", "/api/tasks", { title: "Tugas lintas perangkat" });
  const X = created.id; // id link node = cid perangkat A
  assert.equal(typeof X, "string");
  let serverRow = null;
  const tr = fakeTransport((m, p, b) => {
    if (m === "POST" && p === "/api/tasks") {
      serverRow = srvTask({ id: 77, title: b.title, client_id: b.client_id, updated_at: "2026-06-05T00:00:00" });
      return { status: 201, data: serverRow };
    }
    return { status: 200, data: {} };
  });
  await pushOutbox(tr);
  assert.equal(serverRow.client_id, X);
  // perangkat B: DB kosong
  _reset(); await deleteDB(DB_NAME);
  await pullTasks([serverRow]);
  const RB = buildTaskRouter();
  const got = await RB.dispatch("GET", "/api/tasks/" + X, undefined);
  assert.equal(got.title, "Tugas lintas perangkat");
  assert.equal(got.id, 77);
});

test("end-to-end: mindmap created on device A via local router opens by its uuid on empty device B after pull", async () => {
  const RA = buildTaskRouter();
  const created = await RA.dispatch("POST", "/api/mindmaps", { title: "Peta lintas perangkat" });
  const X = created.id;
  assert.equal(typeof X, "string");
  let serverRow = null;
  const tr = fakeTransport((m, p, b) => {
    if (m === "POST" && p === "/api/mindmaps") {
      serverRow = mmRow({ id: 55, title: b.title, data_json: b.data_json, client_id: b.client_id, updated_at: "2026-06-12T00:00:00" });
      return { status: 201, data: serverRow };
    }
    return { status: 200, data: {} };
  });
  await pushOutbox(tr);
  assert.equal(serverRow.client_id, X);
  _reset(); await deleteDB(DB_NAME);
  const list = [Object.assign({}, serverRow, { data_json: undefined })];
  await pullMindmaps(list, () => Promise.resolve(serverRow));
  const RB = buildTaskRouter();
  const got = await RB.dispatch("GET", "/api/mindmaps/" + X, undefined);
  assert.equal(got.title, "Peta lintas perangkat");
  assert.equal(got.id, 55);
});

// --- Review round 1 ------------------------------------------------------------------------------------------

// Server palsu bersama dua perangkat: POST /api/mindmaps & /api/scratchpad idempoten per client_id (seperti T11).
function fakeServer() {
  let nextId = 100;
  const rows = { mindmaps: [], notes: [] };
  const posts = [];
  function create(kind, b) {
    posts.push({ kind, client_id: b.client_id });
    const hit = rows[kind].find((r) => r.client_id === b.client_id);
    if (hit) return { status: 200, data: hit };
    const row = Object.assign({}, b, { id: nextId++, updated_at: "2026-06-20T00:00:0" + rows[kind].length });
    rows[kind].push(row);
    return { status: 201, data: row };
  }
  return {
    rows, posts,
    transport(opts) {
      opts = opts || {};
      return fakeTransport((m, p, b) => {
        if (m === "PUT") return { status: 404, data: { detail: "not found" } };
        if (m === "POST" && p === "/api/mindmaps") {
          if (opts.dropPost && opts.dropPost()) { create("mindmaps", b); return "NETWORK"; }
          return create("mindmaps", b);
        }
        if (m === "POST" && p === "/api/scratchpad") return create("notes", b);
        return { status: 200, data: {} };
      });
    },
  };
}
function networkAware(tr) {
  const orig = tr.request;
  tr.request = (m, p, b) => orig(m, p, b).then((h) => (h === "NETWORK" ? Promise.reject(new Error("net")) : h));
  return tr;
}
function personalMap(over) {
  return Object.assign({ server_id: 5, title: "Peta", pinned: false, list_id: null, created_at: "x", updated_at: "2026-06-10T00:00:00",
    deleted: false, dirty: 1, base_rev: "2026-06-10T00:00:00", rev: 2 }, over);
}

test("review#1: two devices re-creating the same deleted personal map → two distinct server rows, B's edit not adopted onto A's row", async () => {
  const server = fakeServer();
  // perangkat A: pembuat asli (cid = client_id = X)
  await put("mindmaps", [personalMap({ cid: "X", client_id: "X", data_json: "{\"a\":1}" })]);
  await mapPut("mindmap", 5, "X");
  await put("_outbox", [{ qid: 1, op: "update", entity_type: "mindmap", cid: "X", payload: {} }]);
  await pushOutbox(networkAware(server.transport()));
  // perangkat B: record hasil pull (client_id asli X, cid lain)
  _reset(); await deleteDB(DB_NAME);
  await put("mindmaps", [personalMap({ cid: "b-local", client_id: "X", data_json: "{\"b\":1}" })]);
  await mapPut("mindmap", 5, "b-local");
  await put("_outbox", [{ qid: 1, op: "update", entity_type: "mindmap", cid: "b-local", payload: {} }]);
  await pushOutbox(networkAware(server.transport()));
  assert.equal(server.rows.mindmaps.length, 2);
  assert.notEqual(server.posts[0].client_id, server.posts[1].client_id);
  const b = await get("mindmaps", "b-local");
  const bRow = server.rows.mindmaps.find((r) => r.id === b.server_id);
  assert.ok(bRow, "B mapped to its own new row");
  assert.equal(bRow.data_json, "{\"b\":1}");
  assert.notEqual(b.server_id, server.rows.mindmaps[0].id);
});

test("review#1: re-create retry after a lost POST response reuses the same fresh client_id (idempotent)", async () => {
  const server = fakeServer();
  await put("mindmaps", [personalMap({ cid: "b-local", client_id: "X", data_json: "{\"b\":1}" })]);
  await mapPut("mindmap", 5, "b-local");
  await put("_outbox", [{ qid: 1, op: "update", entity_type: "mindmap", cid: "b-local", payload: {} }]);
  let drops = 1;
  const tr = networkAware(server.transport({ dropPost: () => drops-- > 0 }));
  await pushOutbox(tr);
  await pushOutbox(tr);
  assert.equal(server.posts.length, 2);
  assert.equal(server.posts[0].client_id, server.posts[1].client_id);
  assert.notEqual(server.posts[0].client_id, "X");
  assert.equal(server.rows.mindmaps.length, 1);
  const b = await get("mindmaps", "b-local");
  assert.equal(b.server_id, server.rows.mindmaps[0].id);
});

test("review#1: personal note re-create after PUT 404 uses a fresh client_id (not the original one)", async () => {
  const server = fakeServer();
  await put("scratchpad_notes", [{ cid: "X", server_id: 3, client_id: "X", title: "N", content: "isi B", list_id: null,
    deleted: false, dirty: 1, rev: 2, base_rev: "2026-06-10T00:00:00" }]);
  await mapPut("note", 3, "X");
  await put("_outbox", [{ qid: 1, op: "update", entity_type: "note", cid: "X", payload: {} }]);
  await pushOutbox(networkAware(server.transport()));
  assert.equal(server.posts.length, 1);
  assert.notEqual(server.posts[0].client_id, "X");
  const n = await get("scratchpad_notes", "X");
  assert.equal(n.server_id, server.rows.notes[0].id);
});

test("review#2: findByClientId ignores a local record (cid = client_id) already mapped to a different server row", async () => {
  // record lokal ber-cid X terpetakan ke baris 20 TANPA entri idmap (mis. idmap hilang); baris lain 30 ber-client_id X
  await put("tasks", [{ cid: "X", server_id: 20, title: "Dua puluh", gtd_status: "next", base_rev: "2026-06-04T00:00:00", deleted: false, dirty: 0 }]);
  await pullTasks([srvTask({ id: 20, title: "Dua puluh", client_id: "lain" }), srvTask({ id: 30, title: "Tiga puluh", client_id: "X" })]);
  const rows = await getAll("tasks");
  const t20 = rows.filter((r) => r.server_id === 20);
  const t30 = rows.filter((r) => r.server_id === 30);
  assert.equal(t20.length, 1);
  assert.equal(t30.length, 1);
  assert.notEqual(t20[0].cid, t30[0].cid);
  assert.equal(t20[0].title, "Dua puluh");
  assert.equal(t30[0].title, "Tiga puluh");
});

test("review#2: mindmap findByClientId ignores a record mapped to another server row (re-created, client_id kept)", async () => {
  await put("mindmaps", [personalMap({ cid: "m1", client_id: "X", server_id: 50, dirty: 0, data_json: "{}" })]);
  await mapPut("mindmap", 50, "m1");
  const rows = [mmRow({ id: 50, title: "Lima puluh", client_id: "F" }), mmRow({ id: 60, title: "Enam puluh", client_id: "X" })];
  await pullMindmaps(rows, fullFor(rows));
  const local = await getAll("mindmaps");
  assert.equal(local.length, 2);
  assert.equal(local.find((m) => m.server_id === 50).cid, "m1");
  assert.notEqual(local.find((m) => m.server_id === 60).cid, "m1");
});

test("review#3: freshCidFor idmap-collision branch — client_id already mapped to another server id → fresh cid", async () => {
  await mapPut("task", 20, "X"); // idmap basi tanpa record lokal
  await pullTasks([srvTask({ id: 30, title: "Tiga puluh", client_id: "X" })]);
  const rows = await getAll("tasks");
  assert.equal(rows.length, 1);
  assert.notEqual(rows[0].cid, "X");
  assert.equal(rows[0].client_id, "X");
  const R = buildTaskRouter();
  assert.equal((await R.dispatch("GET", "/api/tasks/X", undefined)).title, "Tiga puluh");
});

test("review#3: unmapped local record (server_id null) keeps its own client_id when a pull writes it", async () => {
  await put("tasks", [{ cid: "K", server_id: null, client_id: "F", title: "Lokal", gtd_status: "next", base_rev: null, deleted: false, dirty: 0 }]);
  await pullTasks([srvTask({ id: 40, title: "Server", client_id: "K" })]);
  const rows = await getAll("tasks");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].cid, "K");
  assert.equal(rows[0].client_id, "F");
});

// --- Review round 2: recreate_of_sid basi ------------------------------------------------------------------

// PUT 404 → POST buat ulang membuat baris N (client_id segar F) tetapi responsnya hilang → baris asli dipulihkan
// (mis. pulihkan dari Sampah) → PUT ulang sukses. Pull berikutnya tidak boleh memetakan N ke record yang sama.
function restoreScenarioTransport(kind) {
  const base = kind === "note" ? "/api/scratchpad" : "/api/mindmaps";
  let puts = 0;
  const created = [];
  const tr = fakeTransport((m, p, b) => {
    if (m === "PUT" && p === base + "/5") {
      puts++;
      return puts === 1 ? { status: 404, data: { detail: "not found" } } : { status: 200, data: { id: 5, updated_at: "2026-06-21T00:00:00" } };
    }
    if (m === "POST" && p === base) { created.push(Object.assign({}, b, { id: 100 })); return "NETWORK"; }
    return { status: 200, data: {} };
  });
  return { tr: networkAware(tr), created };
}

test("review#2-followup: mindmap — lost re-create POST, row restored, PUT succeeds → marker cleared, orphan row N not mapped onto the record", async () => {
  await put("mindmaps", [personalMap({ cid: "b-local", client_id: "X", data_json: "{\"b\":1}" })]);
  await mapPut("mindmap", 5, "b-local");
  await put("_outbox", [{ qid: 1, op: "update", entity_type: "mindmap", cid: "b-local", payload: {} }]);
  const { tr, created } = restoreScenarioTransport("mindmap");
  await pushOutbox(tr); // PUT 404 → POST (respons hilang)
  assert.equal(created.length, 1);
  const F = created[0].client_id;
  assert.equal((await get("mindmaps", "b-local")).recreate_of_sid, 5);
  await pushOutbox(tr); // PUT sukses (baris dipulihkan)
  const after = await get("mindmaps", "b-local");
  assert.equal(after.recreate_of_sid, undefined);
  assert.equal(after.server_id, 5);
  const rows = [mmRow({ id: 5, title: "Asli", updated_at: "2026-06-21T00:00:00", client_id: "X" }),
    mmRow({ id: 100, title: "Yatim", updated_at: "2026-06-21T01:00:00", client_id: F })];
  await pullMindmaps(rows, fullFor(rows));
  const { cidOf } = require("../../static/offline/idmap.js");
  assert.equal(await cidOf("mindmap", 5), "b-local");
  assert.notEqual(await cidOf("mindmap", 100), "b-local");
  const local = await getAll("mindmaps");
  assert.equal(local.length, 2);
  assert.equal((await get("mindmaps", "b-local")).server_id, 5);
});

test("review#2-followup: stale recreate_of_sid whose original row is back in the list does not match a row by client_id", async () => {
  await put("mindmaps", [personalMap({ cid: "b-local", client_id: "F", recreate_of_sid: 5, dirty: 0, rev: 3, data_json: "{}" })]);
  await mapPut("mindmap", 5, "b-local");
  const rows = [mmRow({ id: 5, title: "Asli", updated_at: "2026-06-11T00:00:00", client_id: "X" }),
    mmRow({ id: 100, title: "Yatim", updated_at: "2026-06-12T00:00:00", client_id: "F" })];
  await pullMindmaps(rows, fullFor(rows));
  const { cidOf } = require("../../static/offline/idmap.js");
  assert.equal(await cidOf("mindmap", 5), "b-local");
  assert.notEqual(await cidOf("mindmap", 100), "b-local");
  assert.equal((await getAll("mindmaps")).length, 2);
});

test("review#2-followup: note — PUT success after a lost re-create POST clears recreate_of_sid", async () => {
  await put("scratchpad_notes", [{ cid: "n1", server_id: 5, client_id: "X", title: "N", content: "isi", list_id: null,
    deleted: false, dirty: 1, rev: 2, base_rev: "2026-06-10T00:00:00" }]);
  await mapPut("note", 5, "n1");
  await put("_outbox", [{ qid: 1, op: "update", entity_type: "note", cid: "n1", payload: {} }]);
  const { tr, created } = restoreScenarioTransport("note");
  await pushOutbox(tr);
  assert.equal(created.length, 1);
  assert.equal((await get("scratchpad_notes", "n1")).recreate_of_sid, 5);
  await pushOutbox(tr);
  const n = await get("scratchpad_notes", "n1");
  assert.equal(n.recreate_of_sid, undefined);
  assert.equal(n.server_id, 5);
});
