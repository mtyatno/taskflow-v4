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

test("push dulu, PATCH ke id server, lalu sync", async () => {
  const order = [];
  const api = stubApi({ id: 7, list_id: 3 });
  const res = await moveTaskToWorkspace({
    api, task: { id: 7, cid: "c1" }, listId: "3",
    pushNow: async () => order.push("push"), syncNow: async () => order.push("sync"),
  });
  assert.equal(res.ok, true);
  assert.deepEqual(api.calls, [{ url: "/api/tasks/7/workspace", body: { list_id: 3 } }]);
  assert.deepEqual(order, ["push", "sync"]);
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

test("TaskDetailModal: tombol hanya untuk task pribadi tingkat atas, tanpa garis warna", () => {
  const src = fnSource("TaskDetailBody");
  assert.match(src, /const canMove = \(task\.list_id == null \|\| task\.list_id === ""\) && !task\.parent_id && !task\.parent_cid/);
  assert.match(src, /canMove: canMove && !moveOpen/);
  assert.match(fnSource("DetailTopBar"), /"Pindah ke Workspace"/);
  assert.doesNotMatch(src, /borderLeft|borderTop:\s*"\d+px solid var\(--accent/);
});
