"use strict";
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { deleteDB } = require("./setup.js");
const { DB_NAME, DB_VERSION, ENTITY_STORE_NAMES, openDB, clearAll, _reset } = require("../../static/offline/db.js");

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

test("DB_VERSION is 5", () => { assert.equal(DB_VERSION, 5); });

test("openDB returns the same connection on repeated calls", async () => {
  const a = await openDB();
  const b = await openDB();
  assert.equal(a, b);
  a.close();
});

test("clearAll clears all entity and system stores in taskflow-offline", async () => {
  const db = await openDB();

  await new Promise((resolve, reject) => {
    const tx = db.transaction(["tasks", "habits", "scratchpad_notes", "_meta", "_idmap", "_outbox"], "readwrite");
    tx.objectStore("tasks").add({ cid: "t-1", title: "Task 1" });
    tx.objectStore("habits").add({ cid: "h-1", name: "Habit 1" });
    tx.objectStore("scratchpad_notes").add({ cid: "n-1", content: "Note 1" });
    tx.objectStore("_meta").put("user_123", "current_user_id");
    tx.objectStore("_idmap").add({ key: "tasks:1", cid: "t-1" });
    tx.objectStore("_outbox").add({ op: "insert", cid: "t-1" });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });

  await clearAll();

  for (const name of ["tasks", "habits", "scratchpad_notes", "_meta", "_idmap", "_outbox"]) {
    const items = await new Promise((resolve, reject) => {
      const tx = db.transaction(name, "readonly");
      const req = tx.objectStore(name).getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    assert.equal(items.length, 0, `Store ${name} should be empty after clearAll`);
  }

  assert.ok(db.objectStoreNames.contains("tasks"));
  assert.ok(db.objectStoreNames.contains("_meta"));
  assert.ok(db.objectStoreNames.contains("_outbox"));
  assert.equal(db.objectStoreNames.length >= 10, true);

  db.close();
});

