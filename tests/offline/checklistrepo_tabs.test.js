"use strict";
// Kesiapan checklist antar tab (perbaikan review S2c, rencana PR B2 R2/R3): setiap tab punya memori kesiapan sendiri.
// Tab yang terbuka sebelum unduhan awal di tab lain tetap tidak siap sampai refresh() memuat ulang dari IndexedDB
// (Task 5 memanggilnya sesudah setiap pullChecklists). Dua tab = dua instans modul (cache require dibersihkan) di
// atas satu fake-indexeddb.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { deleteDB } = require("./setup.js");

const OFF = path.resolve(__dirname, "../../static/offline");

function tab() {
  for (const k of Object.keys(require.cache)) if (k.startsWith(OFF)) delete require.cache[k];
  return { db: require(path.join(OFF, "db.js")), CR: require(path.join(OFF, "checklistrepo.js")) };
}
function put(TFdb, store, rec) {
  return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(store, "readwrite");
    t.objectStore(store).put(rec);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  }));
}

test("antar tab: tab B tidak siap sampai refresh() sesudah tab A menyelesaikan unduhan awal", async () => {
  const A = tab();
  await deleteDB(A.db.DB_NAME);
  await put(A.db, "tasks", { cid: "t1", server_id: 7, title: "T", deleted: false });
  await A.CR.start();
  const B = tab();
  await B.CR.start();
  assert.equal(A.CR.isReady(), false);
  assert.equal(B.CR.isReady(), false);

  await A.CR.replaceTaskChecklist("t1", [{ id: 61, task_id: 7, parent_id: null, depth: 0, title: "x", is_done: false, sort_order: 0 }], 3);
  await A.CR.markHydrated();
  assert.deepEqual([A.CR.isReady(), A.CR.knowsTask(7), A.CR.knowsItem(61)], [true, true, true]);
  assert.deepEqual([B.CR.isReady(), B.CR.knowsTask(7), B.CR.knowsItem(61)], [false, false, false], "memori tab B belum dimuat ulang");

  await B.CR.start();
  assert.equal(B.CR.isReady(), false, "start() idempoten: tidak memuat ulang");
  await B.CR.refresh();
  assert.deepEqual([B.CR.isReady(), B.CR.knowsTask(7), B.CR.knowsItem(61)], [true, true, true]);
  await B.CR.markHydrated(); // idempoten di tab mana pun
  assert.equal(B.CR.isReady(), true);
  A.db._reset();
  B.db._reset();
});
