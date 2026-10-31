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
  origDispatch = globalThis.dispatchEvent;
  globalThis.dispatchEvent = (ev) => { events.push({ type: ev.type, detail: ev.detail }); return true; };
  P.bindHost(binding());
});
afterEach(() => {
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
