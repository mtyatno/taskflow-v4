"use strict";
// Regresi I1: di browser modul offline dimuat berurutan lewat <script> (index.html), bukan require.
// commentrepo.js dimuat sebelum chatrepo.js, jadi user saat ini harus dibaca saat dipanggil.
const { test } = require("node:test");
const assert = require("node:assert/strict");
require("fake-indexeddb/auto");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../..");
const html = fs.readFileSync(path.join(root, "static/index.html"), "utf8");
const FILES = [...html.matchAll(/<script src="\/static\/offline\/([\w-]+\.js)"><\/script>/g)].map((m) => m[1]);

function loadBrowserOrder() {
  const ctx = { indexedDB, IDBKeyRange, console, crypto: globalThis.crypto, navigator: { onLine: false },
    setTimeout, clearTimeout };
  ctx.self = ctx;
  vm.createContext(ctx);
  for (const f of FILES) {
    vm.runInContext(fs.readFileSync(path.join(root, "static/offline", f), "utf8"), ctx, { filename: f });
  }
  return ctx.TF;
}

test("urutan index.html: commentrepo dimuat sebelum chatrepo (prasyarat regresi)", () => {
  assert.ok(FILES.indexOf("commentrepo.js") >= 0 && FILES.indexOf("chatrepo.js") >= 0);
  assert.ok(FILES.indexOf("commentrepo.js") < FILES.indexOf("chatrepo.js"));
});

test("urutan browser: create mencatat user dari setCurrentUser dan komentar sendiri tidak membuat unread", async () => {
  const TF = loadBrowserOrder();
  TF.chatrepo.setCurrentUser({ user_id: 1, username: "me", display_name: "Me" });
  const db = await TF.db.openDB();
  await new Promise((res, rej) => {
    const tx = db.transaction("scratchpad_notes", "readwrite");
    tx.objectStore("scratchpad_notes").put({ cid: "n1", server_id: 10, list_id: 7, deleted: false });
    tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error);
  });
  const c = await TF.commentrepo.create("n1", { body: "halo" });
  assert.equal(c.user_id, 1);
  assert.equal(c.username, "me");
  assert.equal(c.display_name, "Me");
  // anggap sudah tersinkron (server_id, tanpa pending), dibuat setelah penanda baca apa pun
  const rec = await TF.commentrepo.getRaw(c.cid);
  await TF.commentrepo.putRaw(Object.assign({}, rec, { pending: null, server_id: 5,
    created_at: new Date(Date.now() + 1000).toISOString() }));
  const rows = await TF.commentrepo.decorateNotes([{ cid: "n1", list_id: 7 }]);
  assert.equal(rows[0].comment_open_count, 1);
  assert.equal(rows[0].comment_unread, false);
});
