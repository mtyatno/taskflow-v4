"use strict";
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { deleteDB } = require("./setup.js");
const { DB_NAME, _reset } = require("../../static/offline/db.js");
const { makeBlobStore } = require("../../static/offline/blobstore.js");

beforeEach(async () => { _reset(); await deleteDB(DB_NAME); });

test("factory selects IndexedDB impl when no Tauri global", () => {
  const store = makeBlobStore({ hasTauri: false });
  assert.equal(store.kind, "indexeddb");
});

test("put returns an opaque ref string", async () => {
  const store = makeBlobStore({ hasTauri: false });
  const ref = await store.put(new Uint8Array([1, 2, 3]), { mime: "application/octet-stream" });
  assert.equal(typeof ref, "string");
  assert.match(ref, /^blob_/);
});

test("getBytes returns the same bytes that were put", async () => {
  const store = makeBlobStore({ hasTauri: false });
  const ref = await store.put(new Uint8Array([10, 20, 30]), { mime: "image/png" });
  const out = await store.getBytes(ref);
  assert.deepEqual(Array.from(new Uint8Array(out)), [10, 20, 30]);
});

test("delete removes the blob", async () => {
  const store = makeBlobStore({ hasTauri: false });
  const ref = await store.put(new Uint8Array([1]), {});
  await store.delete(ref);
  assert.equal(await store.getBytes(ref), undefined);
});
