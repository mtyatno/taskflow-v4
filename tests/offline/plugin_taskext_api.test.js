"use strict";
// Sistem plugin Fase 1 PR 1a-1 (rencana Task 10, R14): TF.api.for(id).taskExt — read/set/setMany/ref, izin task.ext.
const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const { deleteDB } = require("./setup.js");
const { DB_NAME, _reset: resetDB } = require("../../static/offline/db.js");
const RT = require("../../static/plugin-runtime.js");
const P = RT.plugins;
const { PluginStorageError, PluginPermissionError } = RT.api;

const DEMO = {
  id: "demo-ext", name: "Demo Ext", version: "1.0.0", minApi: 1, defaultEnabled: true,
  slots: ["taskList.views", "taskDetail.sections"], permissions: ["task.ext"], taskExt: { keys: ["note", "after"] },
  files: ["plugin.js"], hash: "d1",
};
const PLAIN = { id: "plain-plug", name: "Plain", version: "1.0.0", minApi: 1, defaultEnabled: false, slots: ["dashboard.widgets"], permissions: [], files: ["plugin.js"], hash: "p1" };
const INDEX = { v: 1, plugins: [DEMO, PLAIN] };

let calls;
let events;
let origDispatch;
let origTaskroutes;

// PR 1c-1 Task 5 (R22): setMany memakai router.extPatchMany bila ada. Tes 1c-0 di bawah memakai router lokal TANPA
// extPatchMany (seperti taskroutes.js lama dari cache SW) → jalur per item lewat updateTaskExt, asersi tidak berubah.
const legacyTaskroutes = { buildTaskRouter: () => ({ hasRoute: () => false, dispatch: () => Promise.reject(new Error("router lama")) }) };

function binding(over) {
  return Object.assign({
    toast: () => {},
    patchTaskExt: (id, p) => { calls.push(["patch", id, p]); },
    updateTaskExt: (id, p) => { calls.push(["update", id, p]); return Promise.resolve({ id, ext: p }); },
    refreshTasks: () => { calls.push(["refresh"]); },
  }, over || {});
}

beforeEach(async () => {
  P._reset();
  resetDB();
  await deleteDB(DB_NAME);
  await P.init({ fetchIndex: () => Promise.resolve(INDEX) });
  calls = [];
  events = [];
  globalThis.TF = globalThis.TF || {};
  origTaskroutes = globalThis.TF.taskroutes;
  globalThis.TF.taskroutes = legacyTaskroutes;
  origDispatch = globalThis.dispatchEvent;
  globalThis.dispatchEvent = (ev) => { events.push({ type: ev.type, detail: ev.detail }); return true; };
  P.bindHost(binding());
});
afterEach(() => {
  globalThis.TF.taskroutes = origTaskroutes;
  if (origDispatch === undefined) delete globalThis.dispatchEvent; else globalThis.dispatchEvent = origDispatch;
});

const tx = () => RT.api.for("demo-ext").taskExt;

test("read: hanya kunci namespace sendiri tanpa prefiks; task tanpa ext → {}", () => {
  const t = { id: 5, ext: { "demo-ext.note": "hai", "demo-ext.after": [{ $task: 3 }], "lain-plug.x": 1, "demo-extra.y": 2 } };
  assert.deepEqual(tx().read(t), { note: "hai", after: [{ $task: 3 }] });
  assert.deepEqual(tx().read({ id: 1 }), {});
  assert.deepEqual(tx().read({ id: 1, ext: "{}" }), {});
  assert.deepEqual(tx().read(null), {});
  const r = tx().read(t);
  r.after.push(1);
  assert.equal(t.ext["demo-ext.after"].length, 1, "salinan, bukan objek task");
});

test("ref(task) → {$task: id}", () => {
  assert.deepEqual(tx().ref({ id: 12, title: "x" }), { $task: 12 });
  assert.deepEqual(tx().ref({ id: "cid-1" }), { $task: "cid-1" });
  assert.throws(() => tx().ref({}), TypeError);
});

test("set: prefiks otomatis, null diteruskan, patchTaskExt sebelum updateTaskExt, satu refreshTasks", async () => {
  const row = await tx().set(7, { note: "baru", after: null });
  const prefixed = { "demo-ext.note": "baru", "demo-ext.after": null };
  assert.deepEqual(calls, [["patch", 7, prefixed], ["update", 7, prefixed], ["refresh"]]);
  assert.deepEqual(row, { id: 7, ext: prefixed });
  assert.deepEqual(events, [{ type: "taskUpdated", detail: { taskId: 7 } }]);
});

test("set: ref dari api.ref diterima", async () => {
  await tx().set(7, { after: [tx().ref({ id: 3 }), tx().ref({ id: "cid-x" })] });
  assert.deepEqual(calls[1], ["update", 7, { "demo-ext.after": [{ $task: 3 }, { $task: "cid-x" }] }]);
});

test("set: field tidak di taskExt.keys / pola salah / nilai fungsi / ref rusak → PluginStorageError tanpa memanggil host", async () => {
  const bad = [
    { notee: 1 },
    { "bad-key": 1 },
    { note: () => 1 },
    { note: { $task: 1.5 } },
    { note: { $task: 1, x: 2 } },
    { note: undefined },
    {},
    null,
    [],
  ];
  for (const patch of bad) {
    await assert.rejects(tx().set(7, patch), PluginStorageError, JSON.stringify(patch));
  }
  assert.deepEqual(calls, []);
  assert.deepEqual(events, []);
  assert.equal(P.failures("demo-ext").length, 0, "kesalahan data bukan pelanggaran izin");
});

test("set: host 422 EXT_TOO_LARGE → PluginStorageError; 'Task not found' → Error yang sama; gagal → refreshTasks dipanggil", async () => {
  const local = Object.assign(new Error("EXT_TOO_LARGE"), { status: 422 });
  P.bindHost(binding({ updateTaskExt: (id, p) => { calls.push(["update", id, p]); return Promise.reject(local); } }));
  await assert.rejects(tx().set(7, { note: "x" }), (err) => err instanceof PluginStorageError && err.code === "EXT_TOO_LARGE" && /EXT_TOO_LARGE/.test(err.message));
  assert.deepEqual(calls.map((c) => c[0]), ["patch", "update", "refresh"]);
  assert.deepEqual(events, []);

  calls = [];
  const net = Object.assign(new Error("Request failed (422)"), { status: 422, body: { detail: { code: "EXT_TOO_LARGE", key: "demo-ext" } } });
  P.bindHost(binding({ updateTaskExt: () => Promise.reject(net) }));
  await assert.rejects(tx().set(7, { note: "x" }), (err) => err instanceof PluginStorageError && err.code === "EXT_TOO_LARGE" && err.key === "demo-ext");

  calls = [];
  P.bindHost(binding({ updateTaskExt: () => Promise.reject(Object.assign(new Error("Task not found"), { status: 404 })) }));
  await assert.rejects(tx().set(99, { note: "x" }), (err) => !(err instanceof PluginStorageError) && err.message === "Task not found");
  assert.deepEqual(calls.map((c) => c[0]), ["patch", "refresh"]);

  calls = [];
  const other = new Error("Request timeout — coba lagi");
  P.bindHost(binding({ updateTaskExt: () => Promise.reject(other) }));
  await assert.rejects(tx().set(7, { note: "x" }), (err) => err === other, "error lain diteruskan");
  assert.deepEqual(calls.map((c) => c[0]), ["patch", "refresh"]);
  assert.equal(P.failures("demo-ext").length, 0);
});

test("setMany 20 item → 20 updateTaskExt berurutan, satu refreshTasks, satu taskUpdated", async () => {
  let inflight = 0;
  let maxInflight = 0;
  P.bindHost(binding({
    updateTaskExt: (id, p) => {
      calls.push(["update", id, p]);
      inflight++; maxInflight = Math.max(maxInflight, inflight);
      return new Promise((r) => setTimeout(() => { inflight--; r({ id }); }, 1));
    },
  }));
  const items = Array.from({ length: 20 }, (_, i) => ({ taskId: i + 1, patch: { note: "n" + i } }));
  const rows = await tx().setMany(items);
  assert.equal(rows.length, 20);
  assert.deepEqual(rows.map((r) => r.id), items.map((it) => it.taskId));
  assert.equal(calls.filter((c) => c[0] === "update").length, 20);
  assert.deepEqual(calls.filter((c) => c[0] === "update").map((c) => c[1]), items.map((it) => it.taskId));
  assert.equal(maxInflight, 1, "berurutan");
  assert.equal(calls.filter((c) => c[0] === "refresh").length, 1);
  assert.equal(calls[calls.length - 1][0], "refresh");
  assert.deepEqual(events, [{ type: "taskUpdated", detail: { taskIds: items.map((it) => it.taskId) } }]);
});

test("setMany: gagal di item 3 → item 1–2 tersimpan, reject, tetap satu refreshTasks", async () => {
  const saved = [];
  P.bindHost(binding({
    updateTaskExt: (id, p) => {
      if (id === 3) return Promise.reject(Object.assign(new Error("EXT_TOO_LARGE"), { status: 422 }));
      saved.push(id);
      return Promise.resolve({ id });
    },
  }));
  const items = [1, 2, 3, 4, 5].map((id) => ({ taskId: id, patch: { note: "x" } }));
  await assert.rejects(tx().setMany(items), PluginStorageError);
  assert.deepEqual(saved, [1, 2]);
  assert.equal(calls.filter((c) => c[0] === "refresh").length, 1);
  assert.deepEqual(events, [{ type: "taskUpdated", detail: { taskIds: [1, 2] } }]);
});

test("setMany: item tidak valid → reject sebelum menulis apa pun; [] → []", async () => {
  await assert.rejects(tx().setMany([{ taskId: 1, patch: { note: 1 } }, { taskId: 2, patch: { salah: 1 } }]), PluginStorageError);
  await assert.rejects(tx().setMany("x"), PluginStorageError);
  assert.deepEqual(calls, []);
  assert.deepEqual(await tx().setMany([]), []);
  assert.deepEqual(calls, []);
});

test("tanpa izin task.ext → PluginPermissionError untuk read/set/setMany/ref, failures(id) bertambah", async () => {
  const plain = RT.api.for("plain-plug").taskExt;
  assert.throws(() => plain.read({ id: 1, ext: {} }), PluginPermissionError);
  assert.throws(() => plain.ref({ id: 1 }), PluginPermissionError);
  await assert.rejects(plain.set(1, { note: 1 }), PluginPermissionError);
  await assert.rejects(plain.setMany([{ taskId: 1, patch: { note: 1 } }]), PluginPermissionError);
  assert.equal(P.failures("plain-plug").length, 4);
  assert.ok(P.failures("plain-plug").every((f) => f.kind === "permission"));
  assert.deepEqual(calls, []);
});

test("api.for(id).taskExt selalu ada (beku); apiVersion tetap 1", () => {
  const a = RT.api.for("demo-ext");
  assert.equal(RT.api.apiVersion, 1);
  assert.ok(Object.isFrozen(a.taskExt));
  for (const k of ["read", "set", "setMany", "ref"]) assert.equal(typeof a.taskExt[k], "function");
  assert.equal(typeof RT.api.for("plain-plug").taskExt.read, "function");
});

test("review akhir: set lewat api.put host (rute lokal) → PluginStorageError dengan key namespace yang benar", async () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const TX = require("../../static/offline/taskext.js");
  const html = fs.readFileSync(path.join(__dirname, "../../static/index.html"), "utf8");
  const src = html.match(/\nconst api = \{[\s\S]*?\n\};/)[0];
  const router = { hasRoute: () => true, dispatch: () => Promise.reject(TX.extError("EXT_TOO_LARGE", "demo-ext")) };
  const win = { TF: { taskroutes: { buildTaskRouter: () => router, shouldRouteLocally: () => true } } };
  const hostApi = new Function("window", "schedulePush", src + "\nreturn api;")(win, () => {});
  P.bindHost(binding({ updateTaskExt: (id, p) => hostApi.put(`/api/tasks/${id}`, { ext_patch: p }) }));
  await assert.rejects(tx().set(7, { note: "x" }),
    (err) => err instanceof PluginStorageError && err.code === "EXT_TOO_LARGE" && err.key === "demo-ext");
});

// ── PR 1c-0 Task 6 (R11, R12): setMany satu render + err.applied ─────────────
function fakeReactDOM(log, over) {
  let depth = 0;
  const rd = {
    unstable_batchedUpdates: (f) => {
      log.push(["batch-start"]);
      depth++;
      try { f(); } finally { depth--; log.push(["batch-end"]); }
      if (over && over.throwAfter) throw new Error("batch boom");
    },
    depth: () => depth,
  };
  return rd;
}
function withReactDOM(rd, fn) {
  const had = Object.prototype.hasOwnProperty.call(globalThis, "ReactDOM");
  const prev = globalThis.ReactDOM;
  globalThis.ReactDOM = rd;
  const restore = () => { if (had) globalThis.ReactDOM = prev; else delete globalThis.ReactDOM; };
  return Promise.resolve().then(fn).then((v) => { restore(); return v; }, (e) => { restore(); throw e; });
}
function silenceWarn(fn) {
  const orig = console.warn;
  const warns = [];
  console.warn = (...a) => { warns.push(a); };
  return Promise.resolve().then(() => fn(warns)).then((v) => { console.warn = orig; return v; }, (e) => { console.warn = orig; throw e; });
}
const many = (n) => Array.from({ length: n }, (_, i) => ({ taskId: i + 1, patch: { note: "n" + i } }));

test("setMany 200 item → satu unstable_batchedUpdates; urutan panggilan: batch-mulai, patch×200, batch-selesai, update×200, refresh", async () => {
  const log = [];
  const rd = fakeReactDOM(log);
  const depths = [];
  P.bindHost(binding({
    patchTaskExt: (id, p) => { depths.push(rd.depth()); log.push(["patch", id]); },
    updateTaskExt: (id) => { log.push(["update", id]); return Promise.resolve({ id }); },
    refreshTasks: () => { log.push(["refresh"]); },
  }));
  const items = many(200);
  await withReactDOM(rd, () => tx().setMany(items));
  const expected = [["batch-start"]]
    .concat(items.map((it) => ["patch", it.taskId]))
    .concat([["batch-end"]])
    .concat(items.map((it) => ["update", it.taskId]))
    .concat([["refresh"]]);
  assert.deepEqual(log, expected);
  assert.equal(log.filter((c) => c[0] === "batch-start").length, 1);
  assert.equal(depths.length, 200);
  assert.ok(depths.every((d) => d === 1), "semua patch di kedalaman 1");
});

test("patchTaskExt tepat sekali per item (tidak dipanggil lagi saat tulis)", async () => {
  const items = many(7);
  await tx().setMany(items);
  const patches = calls.filter((c) => c[0] === "patch");
  assert.equal(patches.length, 7);
  assert.deepEqual(patches.map((c) => c[1]), items.map((it) => it.taskId));
});

test("tanpa ReactDOM (Node) → patch tetap semua di depan, berurutan", async () => {
  assert.equal(globalThis.ReactDOM, undefined);
  const items = many(5);
  await tx().setMany(items);
  const kinds = calls.map((c) => c[0]);
  assert.deepEqual(kinds, ["patch", "patch", "patch", "patch", "patch", "update", "update", "update", "update", "update", "refresh"]);
  assert.deepEqual(calls.slice(0, 5).map((c) => c[1]), [1, 2, 3, 4, 5]);
});

test("unstable_batchedUpdates melempar → warn, semua item tetap ditulis", async () => {
  const log = [];
  await silenceWarn(async (warns) => {
    await withReactDOM(fakeReactDOM(log, { throwAfter: true }), () => tx().setMany(many(4)));
    assert.ok(warns.length >= 1);
  });
  assert.equal(calls.filter((c) => c[0] === "update").length, 4);
  assert.equal(calls.filter((c) => c[0] === "patch").length, 4);
});

test("patchTaskExt melempar untuk satu item → warn, item lain tetap dipatch, semua tetap ditulis", async () => {
  P.bindHost(binding({
    patchTaskExt: (id, p) => { calls.push(["patch", id, p]); if (id === 2) throw new Error("patch boom"); },
  }));
  await silenceWarn(async (warns) => {
    await tx().setMany(many(4));
    assert.equal(warns.length, 1);
  });
  assert.deepEqual(calls.filter((c) => c[0] === "patch").map((c) => c[1]), [1, 2, 3, 4]);
  assert.deepEqual(calls.filter((c) => c[0] === "update").map((c) => c[1]), [1, 2, 3, 4]);
});

test("gagal di item 3 (EXT_TOO_LARGE) → PluginStorageError dengan applied [1, 2]; satu refreshTasks; taskUpdated {taskIds: [1, 2]}", async () => {
  P.bindHost(binding({
    updateTaskExt: (id, p) => {
      calls.push(["update", id, p]);
      if (id === 3) return Promise.reject(Object.assign(new Error("EXT_TOO_LARGE"), { status: 422 }));
      return Promise.resolve({ id });
    },
  }));
  await assert.rejects(tx().setMany(many(5)), (err) => err instanceof PluginStorageError && err.code === "EXT_TOO_LARGE" && Array.isArray(err.applied) && JSON.stringify(err.applied) === "[1,2]");
  assert.equal(calls.filter((c) => c[0] === "refresh").length, 1);
  assert.deepEqual(events, [{ type: "taskUpdated", detail: { taskIds: [1, 2] } }]);
});

test("gagal di item 1 → applied []", async () => {
  P.bindHost(binding({ updateTaskExt: () => Promise.reject(Object.assign(new Error("EXT_TOO_LARGE"), { status: 422 })) }));
  await assert.rejects(tx().setMany(many(3)), (err) => err instanceof PluginStorageError && Array.isArray(err.applied) && err.applied.length === 0);
  assert.deepEqual(events, []);
  assert.equal(calls.filter((c) => c[0] === "refresh").length, 1);
});

test("'Task not found' → Error dengan applied", async () => {
  P.bindHost(binding({
    updateTaskExt: (id) => id === 2 ? Promise.reject(Object.assign(new Error("Task not found"), { status: 404 })) : Promise.resolve({ id }),
  }));
  await assert.rejects(tx().setMany(many(3)), (err) => !(err instanceof PluginStorageError) && err.message === "Task not found" && JSON.stringify(err.applied) === "[1]");
});

test("penolakan bukan objek (string) → Error dengan applied", async () => {
  P.bindHost(binding({
    updateTaskExt: (id) => id === 2 ? Promise.reject("kacau") : Promise.resolve({ id }),
  }));
  await assert.rejects(tx().setMany(many(3)), (err) => err instanceof Error && err.message === "kacau" && JSON.stringify(err.applied) === "[1]");
});

test("validasi gagal (field tak terdaftar) → reject tanpa patch, tanpa tulis, tanpa applied", async () => {
  const items = [{ taskId: 1, patch: { note: "ok" } }, { taskId: 2, patch: { salah: 1 } }];
  await assert.rejects(tx().setMany(items), (err) => err instanceof PluginStorageError && !("applied" in err));
  assert.deepEqual(calls, []);
  assert.deepEqual(events, []);
});

test("set tunggal: urutan patch → update tidak berubah", async () => {
  await tx().set(9, { note: "a" });
  assert.deepEqual(calls.map((c) => c[0]), ["patch", "update", "refresh"]);
});

test("apiVersion tetap 1 (1c-0)", () => {
  assert.equal(RT.api.apiVersion, 1);
});

// ── PR 1c-1 Task 5 (R22): jalur tulis massal lokal ─────────────────────────────────────────────────────────────
// Router palsu dengan extPatchMany; failAt = indeks item gagal (error = errAt), throwAll = penolakan seluruh panggilan.
function bulkRouter(log, over) {
  const o = over || {};
  return {
    hasRoute: () => true,
    dispatch: (m, p) => { log.push(["dispatch", m, p]); return Promise.resolve({}); },
    extPatchMany: (items) => {
      log.push(["extPatchMany", items.map((it) => ({ id: it.id, ext_patch: it.ext_patch }))]);
      if (o.throwAll) return Promise.reject(o.throwAll);
      const n = o.failAt == null ? items.length : o.failAt;
      const ok = items.slice(0, n);
      return Promise.resolve({ rows: ok.map((it) => ({ id: it.id, ext: it.ext_patch })), appliedIds: ok.map((it) => it.id), error: o.failAt == null ? null : o.errAt });
    },
  };
}
function useBulk(router) { globalThis.TF.taskroutes = { buildTaskRouter: () => router }; }

test("setMany dengan router.extPatchMany: patchTaskExt semua item dalam satu batch, satu extPatchMany, satu refreshTasks, satu taskUpdated, event tf:outbox-queued dipancarkan sekali; reject membawa applied dari appliedIds", async () => {
  const log = [];
  const rd = fakeReactDOM(log);
  const depths = [];
  P.bindHost(binding({
    patchTaskExt: (id, p) => { depths.push(rd.depth()); log.push(["patch", id]); },
    updateTaskExt: (id) => { log.push(["update", id]); return Promise.resolve({ id }); },
    refreshTasks: () => { log.push(["refresh"]); },
  }));
  useBulk(bulkRouter(log));
  const items = many(200);
  const rows = await withReactDOM(rd, () => tx().setMany(items));
  const expected = [["batch-start"]]
    .concat(items.map((it) => ["patch", it.taskId]))
    .concat([["batch-end"]])
    .concat([["extPatchMany", items.map((it) => ({ id: it.taskId, ext_patch: { "demo-ext.note": it.patch.note } }))]])
    .concat([["refresh"]]);
  assert.deepEqual(log, expected, "tanpa updateTaskExt per item, tanpa dispatch PUT");
  assert.ok(depths.length === 200 && depths.every((d) => d === 1));
  assert.deepEqual(rows.map((r) => r.id), items.map((it) => it.taskId));
  assert.deepEqual(events, [
    { type: "tf:outbox-queued", detail: null },
    { type: "taskUpdated", detail: { taskIds: items.map((it) => it.taskId) } },
  ]);

  // gagal di item 3 → applied dari appliedIds, tetap satu refresh/taskUpdated/tf:outbox-queued
  log.length = 0;
  events = [];
  P._reset();
  await P.init({ fetchIndex: () => Promise.resolve(INDEX) });
  P.bindHost(binding({ refreshTasks: () => { log.push(["refresh"]); } }));
  useBulk(bulkRouter(log, { failAt: 2, errAt: Object.assign(new Error("EXT_TOO_LARGE"), { status: 422, code: "EXT_TOO_LARGE", key: "demo-ext" }) }));
  await assert.rejects(tx().setMany(many(5)), (err) => err instanceof PluginStorageError && err.code === "EXT_TOO_LARGE" && err.key === "demo-ext"
    && JSON.stringify(err.applied) === "[1,2]");
  assert.equal(log.filter((c) => c[0] === "extPatchMany").length, 1);
  assert.equal(log.filter((c) => c[0] === "refresh").length, 1);
  assert.deepEqual(events, [{ type: "tf:outbox-queued", detail: null }, { type: "taskUpdated", detail: { taskIds: [1, 2] } }]);
  assert.equal(calls.filter((c) => c[0] === "update").length, 0);

  // 'Task not found' di item 1 → Error biasa, applied [], tanpa event
  log.length = 0;
  events = [];
  P._reset();
  await P.init({ fetchIndex: () => Promise.resolve(INDEX) });
  P.bindHost(binding({ refreshTasks: () => { log.push(["refresh"]); } }));
  useBulk(bulkRouter(log, { failAt: 0, errAt: new Error("Task not found") }));
  await assert.rejects(tx().setMany(many(3)), (err) => !(err instanceof PluginStorageError) && err.message === "Task not found" && JSON.stringify(err.applied) === "[]");
  assert.deepEqual(events, []);
  assert.equal(log.filter((c) => c[0] === "refresh").length, 1);

  // extPatchMany menolak seluruhnya (mis. transaksi batal) → applied [], satu refresh
  log.length = 0;
  P._reset();
  await P.init({ fetchIndex: () => Promise.resolve(INDEX) });
  P.bindHost(binding({ refreshTasks: () => { log.push(["refresh"]); } }));
  const boom = new Error("transaksi batal");
  useBulk(bulkRouter(log, { throwAll: boom }));
  await assert.rejects(tx().setMany(many(3)), (err) => err === boom && JSON.stringify(err.applied) === "[]");
  assert.equal(log.filter((c) => c[0] === "refresh").length, 1);
  assert.deepEqual(events, []);
});

test("setMany jalur massal: validasi gagal → reject tanpa patch, tanpa extPatchMany, tanpa applied", async () => {
  const log = [];
  useBulk(bulkRouter(log));
  await assert.rejects(tx().setMany([{ taskId: 1, patch: { note: "ok" } }, { taskId: 2, patch: { salah: 1 } }]),
    (err) => err instanceof PluginStorageError && !("applied" in err));
  assert.deepEqual(log, []);
  assert.deepEqual(calls, []);
  assert.deepEqual(await tx().setMany([]), []);
  assert.deepEqual(log, []);
});

test("router tanpa extPatchMany → jalur per item lama (tes 1c-0 tetap lulus tanpa ubah asersi)", async () => {
  const log = [];
  const r = bulkRouter(log);
  delete r.extPatchMany;
  useBulk(r);
  await tx().setMany(many(3));
  assert.deepEqual(calls.map((c) => c[0]), ["patch", "patch", "patch", "update", "update", "update", "refresh"]);
  assert.deepEqual(log, []);
  assert.deepEqual(events, [{ type: "taskUpdated", detail: { taskIds: [1, 2, 3] } }]);
  // TF.taskroutes tidak dimuat sama sekali → juga jalur per item
  P._reset();
  await P.init({ fetchIndex: () => Promise.resolve(INDEX) });
  P.bindHost(binding());
  calls = [];
  globalThis.TF.taskroutes = { buildTaskRouter: () => { throw new Error("belum siap"); } };
  await tx().setMany(many(2));
  assert.deepEqual(calls.map((c) => c[0]), ["patch", "patch", "update", "update", "refresh"]);
});

test("set tunggal tidak memakai extPatchMany", async () => {
  const log = [];
  useBulk(bulkRouter(log));
  await tx().set(9, { note: "a" });
  assert.deepEqual(calls.map((c) => c[0]), ["patch", "update", "refresh"]);
  assert.deepEqual(log, []);
  assert.deepEqual(events, [{ type: "taskUpdated", detail: { taskId: 9 } }]);
});

test("setMany jalur massal lewat router lokal NYATA (fake-indexeddb): record tersimpan, applied, satu op per item", async () => {
  const realTr = require("../../static/offline/taskroutes.js");
  const repo = require("../../static/offline/taskrepo.js");
  const { outboxAll } = require("../../static/offline/outbox.js");
  globalThis.TF.taskroutes = realTr;
  P.bindHost(binding({ updateTaskExt: () => { throw new Error("tidak boleh dipanggil"); } }));
  const a = await repo.createTask({ title: "A" }, { today: "2026-11-01" });
  const b = await repo.createTask({ title: "B" }, { today: "2026-11-01" });
  const before = (await outboxAll()).length;
  const rows = await tx().setMany([{ taskId: a.cid, patch: { note: "x" } }, { taskId: b.cid, patch: { after: [{ $task: a.cid }] } }]);
  assert.deepEqual(rows.map((r) => r.id), [a.cid, b.cid]);
  assert.deepEqual(rows[1].ext, { "demo-ext.after": [{ $task: a.cid }] });
  assert.equal((await outboxAll()).length, before + 2);
  assert.deepEqual(events.map((e) => e.type), ["tf:outbox-queued", "taskUpdated"]);
  await assert.rejects(tx().setMany([{ taskId: a.cid, patch: { note: "y" } }, { taskId: "cid-hilang", patch: { note: "z" } }]),
    (err) => err.message === "Task not found" && JSON.stringify(err.applied) === JSON.stringify([a.cid]));
  assert.equal((await repo.getRaw(a.cid)).ext["demo-ext.note"], "y");
});
