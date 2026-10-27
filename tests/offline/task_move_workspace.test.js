"use strict";

// Pindah task pribadi ke workspace: helper moveTaskToWorkspace (top-level di index.html) dan tombol di
// TaskDetailModal. Helper dievaluasi dengan stub api/pushNow/syncNow.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const indexHtml = fs.readFileSync(path.resolve(__dirname, "../../static/index.html"), "utf8").replace(/\r\n/g, "\n");

function fnSource(name) {
  const start = indexHtml.indexOf(`\nasync function ${name}(`) >= 0
    ? indexHtml.indexOf(`\nasync function ${name}(`) : indexHtml.indexOf(`\nfunction ${name}(`);
  assert.ok(start >= 0, `${name} must exist`);
  const end = indexHtml.indexOf("\n}\n", start + 1);
  return indexHtml.slice(start, end + 2);
}

const moveTaskToWorkspace = new Function(fnSource("moveTaskToWorkspace") + "\nreturn moveTaskToWorkspace;")();

function stubApi(result, err) {
  const calls = [];
  return { calls, patch: async (url, body) => { calls.push({ url, body }); if (err) throw err; return result; } };
}

test("tanpa op task di outbox: tidak push, PATCH, baris pindah ditulis lokal, sync tidak ditunggu", async () => {
  const order = [];
  const moved = [{ id: 7, list_id: 3 }, { id: 8, parent_id: 7, list_id: 3 }];
  const api = stubApi({ id: 7, list_id: 3, moved });
  let applied = null;
  const res = await moveTaskToWorkspace({
    api, task: { id: 7, cid: "c1" }, listId: "3",
    hasPendingTaskOps: async () => false,
    pushNow: async () => order.push("push"),
    applyMoved: async (rows) => { applied = rows; order.push("apply"); },
    syncNow: () => { order.push("sync"); return new Promise(() => {}); }, // sync penuh lambat / menggantung
  });
  assert.equal(res.ok, true);
  assert.deepEqual(api.calls, [{ url: "/api/tasks/7/workspace", body: { list_id: 3 } }]);
  assert.deepEqual(applied, moved);
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(order, ["apply", "sync"]);
});

test("ada op task di outbox: push dulu sebelum PATCH", async () => {
  const order = [];
  const api = { patch: async () => { order.push("patch"); return { id: 7 }; } };
  await moveTaskToWorkspace({ api, task: { id: 7 }, listId: 3, hasPendingTaskOps: async () => true,
    pushNow: async () => order.push("push") });
  assert.deepEqual(order, ["push", "patch"]);
});

test("respons lama tanpa moved: baris task utama tetap diterapkan", async () => {
  let applied = null;
  await moveTaskToWorkspace({ api: stubApi({ id: 7, list_id: 3 }), task: { id: 7 }, listId: 3, applyMoved: async (r) => { applied = r; } });
  assert.deepEqual(applied, [{ id: 7, list_id: 3 }]);
});

test("task lokal (id = cid) memakai serverIdOf setelah push", async () => {
  const api = stubApi({ id: 9 });
  const res = await moveTaskToWorkspace({ api, task: { id: "c-abc", cid: "c-abc" }, listId: 2, serverIdOf: async () => 9 });
  assert.equal(res.ok, true);
  assert.equal(api.calls[0].url, "/api/tasks/9/workspace");
});

test("belum tersinkron → tidak memanggil server", async () => {
  const api = stubApi({});
  const res = await moveTaskToWorkspace({ api, task: { id: "c-abc", cid: "c-abc" }, listId: 2, serverIdOf: async () => undefined });
  assert.equal(res.ok, false);
  assert.match(res.message, /belum tersinkron/);
  assert.equal(api.calls.length, 0);
});

test("tanpa workspace tujuan → ditolak", async () => {
  const res = await moveTaskToWorkspace({ api: stubApi({}), task: { id: 1 }, listId: "" });
  assert.equal(res.ok, false);
});

test("error offline dan error server diteruskan sebagai pesan", async () => {
  const off = await moveTaskToWorkspace({ api: stubApi(null, new TypeError("Failed to fetch")), task: { id: 1 }, listId: 2, offline: () => true });
  assert.match(off.message, /koneksi internet/);
  const bad = await moveTaskToWorkspace({ api: stubApi(null, new Error("Kamu bukan anggota workspace ini")), task: { id: 1 }, listId: 2, offline: () => false });
  assert.equal(bad.message, "Kamu bukan anggota workspace ini");
});

test("applyMovedTasksLocal: menulis scope baru + base_rev lewat TF.db.mutate", async () => {
  const fn = new Function("window", fnSource("applyMovedTasksLocal") + "\nreturn applyMovedTasksLocal;");
  const store = { c7: { cid: "c7", list_id: null, project: "Laporan", project_id: 1, rev: 2, dirty: 0, title: "t" } };
  const win = { TF: {
    idmap: { cidOf: async (type, id) => (type === "task" && id === 7 ? "c7" : undefined) },
    db: { mutate: async (st, key, f) => { const next = f(store[key] || null); if (next != null) store[key] = next; } },
  } };
  await fn(win)([{ id: 7, list_id: 3, project: "Laporan", project_id: 9, context: "", context_id: null, updated_at: "U2" }, { id: 99 }]);
  assert.equal(store.c7.list_id, 3);
  assert.equal(store.c7.project_id, 9);
  assert.equal(store.c7.project_ref_name, "Laporan");
  assert.equal(store.c7.base_rev, "U2");
  assert.equal(store.c7.rev, 3);
  assert.equal(store.c7.title, "t");
});

test("TaskDetailModal: tombol hanya untuk task pribadi tingkat atas, tanpa garis warna", () => {
  const src = fnSource("TaskDetailBody");
  assert.match(src, /const canMove = \(task\.list_id == null \|\| task\.list_id === ""\) && !task\.parent_id && !task\.parent_cid/);
  assert.match(src, /canMove: canMove && !moveOpen/);
  assert.match(fnSource("DetailTopBar"), /"Pindah ke Workspace"/);
  assert.doesNotMatch(src, /borderLeft|borderTop:\s*"\d+px solid var\(--accent/);
});
