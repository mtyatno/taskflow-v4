"use strict";
// Review akhir PR 1a-1: error rute lokal di api.fetch (index.html) membawa code/key/body (api.taskExt → key yang
// benar di PluginStorageError) dan DB_UPGRADED_ELSEWHERE tampil sebagai pesan ramah (satu titik terpusat).
// Murni (tanpa paket npm): blok `const api = {…};` diekstrak dari index.html dan dijalankan dengan window palsu.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const HTML = fs.readFileSync(path.join(__dirname, "../../static/index.html"), "utf8");
const API_SRC = HTML.match(/\nconst api = \{[\s\S]*?\n\};/)[0];
const TEXT_ELSEWHERE = "Alurik diperbarui di tab lain. Muat ulang tab ini.";

function loadApi(rejectWith, withBanner) {
  const router = { hasRoute: () => true, dispatch: () => Promise.reject(rejectWith) };
  const win = { TF: { taskroutes: { buildTaskRouter: () => router, shouldRouteLocally: () => true, isNoteTagsCall: () => false } } };
  if (withBanner) win.TF.dbupgrade = { TEXT_ELSEWHERE };
  const calls = { schedulePush: 0 };
  const api = new Function("window", "schedulePush", API_SRC + "\nreturn api;")(win, () => { calls.schedulePush++; });
  return { api, calls };
}

test("rute lokal 422 EXT_*: error membawa status, code, key, body (bukan hanya message)", async () => {
  const err = Object.assign(new Error("EXT_TOO_LARGE"), {
    status: 422, code: "EXT_TOO_LARGE", key: "demo-ext", body: { detail: { code: "EXT_TOO_LARGE", key: "demo-ext" } },
  });
  const { api, calls } = loadApi(err, true);
  await assert.rejects(api.put("/api/tasks/7", { ext_patch: { "demo-ext.note": "x" } }), (e) => {
    assert.equal(e.__local, true, "tetap error lokal (bukan offline)");
    assert.equal(e.message, "EXT_TOO_LARGE");
    assert.equal(e.status, 422);
    assert.equal(e.code, "EXT_TOO_LARGE");
    assert.equal(e.key, "demo-ext");
    assert.deepEqual(e.body, { detail: { code: "EXT_TOO_LARGE", key: "demo-ext" } });
    return true;
  });
  assert.equal(calls.schedulePush, 0);
});

test("rute lokal: key null tetap diteruskan; error tanpa code/key/body tidak mendapat properti kosong", async () => {
  const withNull = Object.assign(new Error("EXT_TOO_LARGE"), { status: 422, code: "EXT_TOO_LARGE", key: null });
  await assert.rejects(loadApi(withNull, true).api.put("/api/tasks/7", {}), (e) => e.key === null && e.code === "EXT_TOO_LARGE");
  await assert.rejects(loadApi(new Error("Task not found"), true).api.put("/api/tasks/7", {}),
    (e) => e.message === "Task not found" && !("code" in e) && !("key" in e) && !("body" in e) && e.__local === true);
});

test("DB_UPGRADED_ELSEWHERE → pesan ramah (teks banner), code tetap untuk pemanggil", async () => {
  const err = Object.assign(new Error("DB_UPGRADED_ELSEWHERE"), { code: "DB_UPGRADED_ELSEWHERE" });
  await assert.rejects(loadApi(err, true).api.get("/api/tasks"), (e) => e.message === TEXT_ELSEWHERE && e.code === "DB_UPGRADED_ELSEWHERE" && e.__local === true);
  // dbupgrade.js belum dimuat → teks cadangan yang sama
  await assert.rejects(loadApi(err, false).api.get("/api/tasks"), (e) => e.message === TEXT_ELSEWHERE);
});
