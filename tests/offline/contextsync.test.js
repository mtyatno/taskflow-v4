"use strict";
// Kanban tahap kustom — Task 2: context_id / context_ref_name di record task (hydrate, taskrepo, pull).
// (Task 3 menambahkan tes push ke file ini.)
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { deleteDB } = require("./setup.js");
const { DB_NAME, _reset, openDB } = require("../../static/offline/db.js");
const { metaGet, metaSet } = require("../../static/offline/meta.js");
const CC = require("../../static/offline/contextcache.js");
const { taskFromServer } = require("../../static/offline/hydrate.js");
const { createTask, updateTask, getRaw } = require("../../static/offline/taskrepo.js");
const { pullTasks, pullAndReconcile } = require("../../static/offline/syncpull.js");
const { mapPut } = require("../../static/offline/idmap.js");

beforeEach(async () => { _reset(); await deleteDB(DB_NAME); });

function httpRes(status, body) {
  return { ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) };
}
function ctx(over) {
  return Object.assign({
    id: 1, name: "Tahap", list_id: null, user_id: 1, position: 0, color: null, archived: false, can_manage: true,
  }, over);
}
async function put(store, recs) {
  const db = await openDB();
  await new Promise((res, rej) => {
    const tx = db.transaction(store, "readwrite");
    const os = tx.objectStore(store);
    for (const r of recs) os.put(r);
    tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error);
  });
}
function task(over) {
  return Object.assign({
    cid: over.cid, server_id: null, title: over.cid, description: "", gtd_status: "next",
    priority: "P3", quadrant: "Q4", project: "", project_id: null, context: "", context_id: null,
    context_ref_name: null, deadline: null, waiting_for: "", assigned_to: null, progress: 0, parent_cid: null,
    list_id: null, recurrence_type: null, recurrence_days: null, deleted: false, dirty: 0,
  }, over);
}
async function seedCache(items) { await metaSet(CC.KEY, { at: 1, items }); }
const TODAY = { today: "2026-10-20" };

// ── hydrate ──────────────────────────────────────────────────────────────────────────────────
test("hydrate copies context_id and sets ref name", () => {
  const a = taskFromServer({ id: 1, title: "t", context: "Review", context_id: 9 }, () => "c1");
  assert.equal(a.context_id, 9);
  assert.equal(a.context_ref_name, "Review");
  const b = taskFromServer({ id: 2, title: "t", context: "Review", context_id: null }, () => "c2");
  assert.equal(b.context_id, null);
  assert.equal(b.context_ref_name, null);
  const c = taskFromServer({ id: 3, title: "t" }, () => "c3");
  assert.equal(c.context_id, null);
  assert.equal(c.context_ref_name, null);
  // id terisi tapi teks kosong → nama ikatan "" (bukan null)
  assert.equal(taskFromServer({ id: 4, title: "t", context: null, context_id: 5 }, () => "c4").context_ref_name, "");
});

// ── createTask ───────────────────────────────────────────────────────────────────────────────
test("createTask links context id from cache", async () => {
  await seedCache([ctx({ id: 7, name: "Review" }), ctx({ id: 8, name: "Review", list_id: 5 })]);
  const a = await createTask({ title: "a", context: "review" }, TODAY);
  const ra = await getRaw(a.cid);
  assert.equal(ra.context_id, 7);
  assert.equal(ra.context_ref_name, "review");
  assert.equal(a.context_id, 7); // tampilan menyertakan context_id
  // scope workspace → tahap workspace itu, bukan yang pribadi
  const b = await createTask({ title: "b", context: "REVIEW", list_id: 5 }, TODAY);
  assert.equal((await getRaw(b.cid)).context_id, 8);
  // nama tak dikenal / kosong → null
  const c = await createTask({ title: "c", context: "Nope" }, TODAY);
  const rc = await getRaw(c.cid);
  assert.equal(rc.context_id, null);
  assert.equal(rc.context_ref_name, null);
  const d = await createTask({ title: "d" }, TODAY);
  assert.equal((await getRaw(d.cid)).context_id, null);
});

test("createTask keeps explicit pending cid", async () => {
  const { item } = await CC.addPending(null, "Baru");
  const t = await createTask({ title: "t", context: "Baru", context_id: item.cid }, TODAY);
  const r = await getRaw(t.cid);
  assert.equal(r.context_id, item.cid);
  assert.equal(r.context_ref_name, "Baru");
  // tanpa context_id eksplisit, pending ditemukan lewat cache gabungan
  const u = await createTask({ title: "u", context: "baru" }, TODAY);
  assert.equal((await getRaw(u.cid)).context_id, item.cid);
  // context_id eksplisit null menang atas cache
  await seedCache([ctx({ id: 7, name: "Review" })]);
  const v = await createTask({ title: "v", context: "Review", context_id: null }, TODAY);
  const rv = await getRaw(v.cid);
  assert.equal(rv.context_id, null);
  assert.equal(rv.context_ref_name, null);
});

// ── updateTask ───────────────────────────────────────────────────────────────────────────────
test("updateTask context_id patch sets ref name", async () => {
  await put("tasks", [task({ cid: "a", context: "Lama" })]);
  await updateTask("a", { context: "Review", context_id: 7 }, TODAY);
  let r = await getRaw("a");
  assert.equal(r.context_id, 7);
  assert.equal(r.context, "Review");
  assert.equal(r.context_ref_name, "Review");
  // context_id saja → nama ikatan = teks context record
  await updateTask("a", { context_id: 8 }, TODAY);
  r = await getRaw("a");
  assert.equal(r.context_id, 8);
  assert.equal(r.context_ref_name, "Review");
});

test("updateTask same text keeps id", async () => {
  await seedCache([ctx({ id: 99, name: "Review" })]); // cache berbeda dari id record: id record dipertahankan
  await put("tasks", [task({ cid: "a", context: "Review", context_id: 7, context_ref_name: "Lama" })]);
  await updateTask("a", { context: "REVIEW" }, TODAY);
  const r = await getRaw("a");
  assert.equal(r.context_id, 7);
  assert.equal(r.context_ref_name, "Lama");
  assert.equal(r.context, "REVIEW");
});

test("updateTask different text relinks via cache", async () => {
  await seedCache([ctx({ id: 7, name: "Review" }), ctx({ id: 9, name: "Selesai Dulu" })]);
  await put("tasks", [task({ cid: "a", context: "Review", context_id: 7, context_ref_name: "Review" })]);
  await updateTask("a", { context: "selesai dulu" }, TODAY);
  let r = await getRaw("a");
  assert.equal(r.context_id, 9);
  assert.equal(r.context_ref_name, "selesai dulu");
  // teks tanpa tahap → id dilepas
  await updateTask("a", { context: "Tak ada" }, TODAY);
  r = await getRaw("a");
  assert.equal(r.context_id, null);
  assert.equal(r.context_ref_name, null);
  // record tanpa id + teks sama dengan tahap di cache → ditautkan
  await put("tasks", [task({ cid: "b", context: "Review", context_id: null })]);
  await updateTask("b", { context: "Review" }, TODAY);
  assert.equal((await getRaw("b")).context_id, 7);
});

test("updateTask clear empties both", async () => {
  await put("tasks", [task({ cid: "a", context: "Review", context_id: 7, context_ref_name: "Review" })]);
  await updateTask("a", { context: "", context_id: null }, TODAY);
  const r = await getRaw("a");
  assert.equal(r.context, "");
  assert.equal(r.context_id, null);
  assert.equal(r.context_ref_name, null);
  // context_id null saja mengosongkan id tetapi teks tetap
  await put("tasks", [task({ cid: "b", context: "Review", context_id: 7, context_ref_name: "Review" })]);
  await updateTask("b", { context_id: null }, TODAY);
  const rb = await getRaw("b");
  assert.equal(rb.context, "Review");
  assert.equal(rb.context_id, null);
  assert.equal(rb.context_ref_name, null);
});

test("updateTask without context patch leaves context_id untouched", async () => {
  await put("tasks", [task({ cid: "a", context: "Review", context_id: 7, context_ref_name: "Review" })]);
  await updateTask("a", { title: "baru" }, TODAY);
  const r = await getRaw("a");
  assert.equal(r.context_id, 7);
  assert.equal(r.context_ref_name, "Review");
});

// ── pull ─────────────────────────────────────────────────────────────────────────────────────
function srvTask(over) {
  return Object.assign({
    id: 70, title: "a", gtd_status: "next", priority: "P3", quadrant: "Q4", project: "", project_id: null,
    context: "Review", context_id: null, deadline: null, waiting_for: "", completed_at: null, progress: 0,
    is_focused: 0, updated_at: "u0",
  }, over);
}

test("pull adopts context_id changed without updated_at bump", async () => {
  await put("tasks", [task({ cid: "a", server_id: 70, context: "Review", context_id: null, dirty: 0, base_rev: "u0",
    updated_at: "u0", rev: 1 })]);
  await mapPut("task", 70, "a");
  const res = await pullTasks([srvTask({ context_id: 4 })]);
  assert.equal(res.derived, 1);
  let r = await getRaw("a");
  assert.equal(r.context_id, 4);
  assert.equal(r.context_ref_name, "Review");
  // server mengganti nama / melepas id tanpa bump
  await pullTasks([srvTask({ context: "Baru", context_id: 4 })]);
  r = await getRaw("a");
  assert.equal(r.context, "Baru");
  assert.equal(r.context_ref_name, "Baru");
  await pullTasks([srvTask({ context: "Baru", context_id: null })]);
  r = await getRaw("a");
  assert.equal(r.context_id, null);
  assert.equal(r.context_ref_name, null);
});

test("pull does not clear local context_id when the server dict omits context fields", async () => {
  await put("tasks", [task({ cid: "a", server_id: 70, context: "Review", context_id: 4, context_ref_name: "Review",
    dirty: 0, base_rev: "u0", updated_at: "u0", rev: 1 })]);
  await mapPut("task", 70, "a");
  const s = srvTask({}); delete s.context; delete s.context_id; s.quadrant = "Q1";
  await pullTasks([s]);
  const r = await getRaw("a");
  assert.equal(r.quadrant, "Q1");
  assert.equal(r.context, "Review");
  assert.equal(r.context_id, 4);
  assert.equal(r.context_ref_name, "Review");
});

test("pull keeps a pending-cid context link when the server row has context_id null and same text", async () => {
  const { item } = await CC.addPending(null, "Review");
  await put("tasks", [task({ cid: "a", server_id: 70, context: "Review", context_id: item.cid, context_ref_name: "Review",
    dirty: 0, base_rev: "u0", updated_at: "u0", rev: 1 })]);
  await mapPut("task", 70, "a");
  await pullTasks([srvTask({ context: "review", context_id: null })]);
  let r = await getRaw("a");
  assert.equal(r.context_id, item.cid);
  assert.equal(r.context_ref_name, "Review");
  // server mengirim id angka → diadopsi
  await pullTasks([srvTask({ context: "Review", context_id: 12 })]);
  r = await getRaw("a");
  assert.equal(r.context_id, 12);
  assert.equal(r.context_ref_name, "Review");
});

test("pull: pending cid link is released when the server text differs (context changed elsewhere)", async () => {
  const { item } = await CC.addPending(null, "Review");
  await put("tasks", [task({ cid: "a", server_id: 70, context: "Review", context_id: item.cid, context_ref_name: "Review",
    dirty: 0, base_rev: "u0", updated_at: "u0", rev: 1 })]);
  await mapPut("task", 70, "a");
  await pullTasks([srvTask({ context: "Lain", context_id: null })]);
  const r = await getRaw("a");
  assert.equal(r.context_id, null);
  assert.equal(r.context, "Lain");
});

test("pull: context null vs \"\" is not a difference (no rewrite of clean tasks)", async () => {
  await put("tasks", [task({ cid: "a", server_id: 70, context: "", dirty: 0, base_rev: "u0", updated_at: "u0", rev: 1 })]);
  await mapPut("task", 70, "a");
  const res = await pullTasks([srvTask({ context: null, context_id: null })]);
  assert.equal(res.derived, 0);
  assert.equal((await getRaw("a")).rev, 1);
});

test("pull refreshes context cache and failure does not fail pull", async () => {
  const items = [ctx({ id: 1, name: "Review" })];
  const seen = [];
  const rawFetch = (u) => {
    seen.push(u);
    if (u === "/api/tasks?include_done=true") return Promise.resolve(httpRes(200, []));
    if (u === CC.FULL_PATH) return Promise.resolve(httpRes(200, items));
    return Promise.resolve(null);
  };
  await pullAndReconcile(rawFetch);
  assert.ok(seen.indexOf(CC.FULL_PATH) > seen.indexOf("/api/tasks?include_done=true"));
  assert.deepEqual((await metaGet(CC.KEY)).items, items);

  // refresh gagal → pull tetap sukses, cache lama dipertahankan
  const failing = (u) => {
    if (u === "/api/tasks?include_done=true") return Promise.resolve(httpRes(200, []));
    if (u === CC.FULL_PATH) return Promise.reject(new Error("net"));
    return Promise.resolve(null);
  };
  const res = await pullAndReconcile(failing);
  assert.equal(typeof res.created, "number");
  assert.deepEqual((await metaGet(CC.KEY)).items, items);

  // refresh project gagal tidak menghalangi refresh context
  await deleteDB(DB_NAME); _reset();
  const projFail = (u) => {
    if (u === "/api/tasks?include_done=true") return Promise.resolve(httpRes(200, []));
    if (u.indexOf("/api/projects") === 0) return Promise.reject(new Error("net"));
    if (u === CC.FULL_PATH) return Promise.resolve(httpRes(200, items));
    return Promise.resolve(null);
  };
  await pullAndReconcile(projFail);
  assert.deepEqual((await metaGet(CC.KEY)).items, items);
});

test("pull does not refresh the context cache when the task pull fails", async () => {
  const seen = [];
  const rawFetch = (u) => { seen.push(u); return Promise.resolve(httpRes(503, { detail: "OFFLINE" })); };
  await assert.rejects(pullAndReconcile(rawFetch));
  assert.equal(seen.includes(CC.FULL_PATH), false);
});

// ── sumber index.html ────────────────────────────────────────────────────────────────────────
test("sync() dispatches tf:contexts-changed right after tf:projects-changed (old regex still holds)", () => {
  const html = fs.readFileSync(path.join(__dirname, "../../static/index.html"), "utf8");
  const start = html.indexOf("function sync() {");
  assert.ok(start >= 0);
  const syncFn = html.slice(start, html.indexOf("\nfunction ", start + 10));
  const p = syncFn.indexOf('"tf:projects-changed"');
  const c = syncFn.indexOf('"tf:contexts-changed"');
  assert.ok(p >= 0 && c > p, "contexts-changed harus setelah projects-changed");
  assert.match(syncFn, /new CustomEvent\("tf:contexts-changed", \{ detail: \{ source: "sync" \} \}\)/);
  // di blok .then yang sama (belum ada `.catch(stepFailed)` di antara keduanya)
  assert.ok(syncFn.slice(p, c).indexOf(".catch(") < 0);
  // regex lama project_views.test.js
  assert.match(syncFn, /pullAndReconcile\(__syncRawFetch\)\.then\(\(?\w*\)? => \{[^}]*tf:projects-changed/);
});
