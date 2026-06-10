"use strict";
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { deleteDB } = require("./setup.js");
const { DB_NAME, DB_VERSION, _reset, openDB } = require("../../static/offline/db.js");

beforeEach(async () => { _reset(); await deleteDB(DB_NAME); });

test("DB_VERSION is 4", () => {
  assert.equal(DB_VERSION, 4);
});

test("chat_messages store exists with list_id, created_at, server_id, client_id indexes", async () => {
  const db = await openDB();
  assert.equal(db.objectStoreNames.contains("chat_messages"), true);
  const idx = db.transaction("chat_messages", "readonly").objectStore("chat_messages").indexNames;
  for (const name of ["list_id", "created_at", "server_id", "client_id"]) {
    assert.equal(idx.contains(name), true, "missing index " + name);
  }
});
