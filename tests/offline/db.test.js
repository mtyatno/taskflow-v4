"use strict";
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { deleteDB } = require("./setup.js");
const { DB_NAME, DB_VERSION, ENTITY_STORE_NAMES, openDB, _reset } = require("../../static/offline/db.js");

beforeEach(async () => { _reset(); await deleteDB(DB_NAME); });

test("openDB creates all entity stores", async () => {
  const db = await openDB();
  for (const name of ENTITY_STORE_NAMES) {
    assert.ok(db.objectStoreNames.contains(name), `missing entity store: ${name}`);
  }
  db.close();
});

test("openDB creates all system stores", async () => {
  const db = await openDB();
  for (const name of ["_meta", "_idmap", "_outbox", "blobs"]) {
    assert.ok(db.objectStoreNames.contains(name), `missing system store: ${name}`);
  }
  db.close();
});

test("tasks store has expected indexes", async () => {
  const db = await openDB();
  const tx = db.transaction("tasks", "readonly");
  const idx = tx.objectStore("tasks").indexNames;
  for (const name of ["server_id", "gtd_status", "list_cid", "parent_cid", "updated_at", "dirty"]) {
    assert.ok(idx.contains(name), `tasks missing index: ${name}`);
  }
  db.close();
});

test("migration v1->v2 moves queue records into _outbox and drops queue", async () => {
  await new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      db.createObjectStore("cache");
      db.createObjectStore("queue", { keyPath: "qid", autoIncrement: true });
    };
    req.onsuccess = (e) => {
      const db = e.target.result;
      const tx = db.transaction("queue", "readwrite");
      tx.objectStore("queue").add({ kind: "task", action: "create", payload: { title: "x" } });
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    };
    req.onerror = () => reject(req.error);
  });

  const db = await openDB(); // upgrades to v2
  assert.equal(db.objectStoreNames.contains("queue"), false, "queue should be deleted");
  assert.equal(db.objectStoreNames.contains("cache"), false, "cache should be deleted");
  const all = await new Promise((resolve, reject) => {
    const r = db.transaction("_outbox", "readonly").objectStore("_outbox").getAll();
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  assert.equal(all.length, 1);
  assert.equal(all[0].kind, "task");
  db.close();
});

test("DB_VERSION is 3", () => { assert.equal(DB_VERSION, 3); });

test("openDB returns the same connection on repeated calls", async () => {
  const a = await openDB();
  const b = await openDB();
  assert.equal(a, b);
  a.close();
});
