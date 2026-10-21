"use strict";
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { deleteDB } = require("./setup.js");
const { DB_NAME, openDB, clearAll, _reset } = require("../../static/offline/db.js");

beforeEach(async () => { _reset(); await deleteDB(DB_NAME); });

test("db v6 punya store note_comments dengan index", async () => {
  const db = await openDB();
  assert.equal(db.version, 6);
  assert.equal(db.objectStoreNames.contains("note_comments"), true);
  const store = db.transaction("note_comments", "readonly").objectStore("note_comments");
  assert.equal(store.keyPath, "cid");
  for (const name of ["server_id", "note_cid", "note_id", "list_id"]) {
    assert.equal(store.indexNames.contains(name), true, "missing index " + name);
  }
});

test("upgrade v5 → v6 mempertahankan data lama", async () => {
  await new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 5);
    req.onupgradeneeded = () => {
      const s = req.result.createObjectStore("tasks", { keyPath: "cid" });
      s.put({ cid: "t1", title: "x" });
    };
    req.onsuccess = () => { req.result.close(); resolve(); };
    req.onerror = () => reject(req.error);
  });
  _reset();
  const db = await openDB();
  const got = await new Promise((resolve, reject) => {
    const r = db.transaction("tasks", "readonly").objectStore("tasks").get("t1");
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  assert.equal(got.title, "x");
  assert.equal(db.objectStoreNames.contains("note_comments"), true);
});

test("clearAll mengosongkan note_comments", async () => {
  const db = await openDB();
  await new Promise((resolve, reject) => {
    const tx = db.transaction("note_comments", "readwrite");
    tx.objectStore("note_comments").put({ cid: "c1", note_cid: "n1" });
    tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
  });
  await clearAll();
  const n = await new Promise((resolve, reject) => {
    const r = db.transaction("note_comments", "readonly").objectStore("note_comments").count();
    r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
  });
  assert.equal(n, 0);
});
