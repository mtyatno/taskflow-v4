"use strict";
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { deleteDB } = require("./setup.js");
const { DB_NAME, _reset, openDB } = require("../../static/offline/db.js");
const {
  extractTags, setEntityTags, getEntityTags, getAllTags, removeEntityTag, cidsForTag,
} = require("../../static/offline/tagrepo.js");

beforeEach(async () => { _reset(); await deleteDB(DB_NAME); });

async function countStore(name) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const r = db.transaction(name, "readonly").objectStore(name).count();
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

test("extractTags returns clean title and lowercased unique tags in order", () => {
  const { clean, tags } = extractTags("Beli #Kopi #susu #kopi");
  assert.equal(clean, "Beli"); // tags stripped, then trimmed (server .strip())
  assert.deepEqual(tags, ["kopi", "susu"]); // lowercased, de-duped, first-seen order
});

test("setEntityTags creates tag rows and entity_tags links", async () => {
  await setEntityTags("task", "t1", ["kerja", "urgent"]);
  assert.equal(await countStore("tags"), 2);
  assert.equal(await countStore("entity_tags"), 2);
});

test("setEntityTags reuses an existing tag by name (no duplicate tag rows)", async () => {
  await setEntityTags("task", "t1", ["kerja"]);
  await setEntityTags("task", "t2", ["kerja"]);
  assert.equal(await countStore("tags"), 1);       // one shared tag
  assert.equal(await countStore("entity_tags"), 2); // two links
});

test("setEntityTags rewrites links for the entity (replaces previous set)", async () => {
  await setEntityTags("task", "t1", ["a", "b"]);
  await setEntityTags("task", "t1", ["b", "c"]);
  const names = (await getEntityTags("task", "t1")).map((t) => t.name);
  assert.deepEqual(names, ["b", "c"]);
});

test("setEntityTags with an empty list clears the entity's links", async () => {
  await setEntityTags("task", "t1", ["a"]);
  await setEntityTags("task", "t1", []);
  assert.deepEqual(await getEntityTags("task", "t1"), []);
});

test("getEntityTags returns sorted {name,color}", async () => {
  await setEntityTags("task", "t1", ["zeta", "alpha"]);
  assert.deepEqual(await getEntityTags("task", "t1"), [
    { name: "alpha", color: null }, { name: "zeta", color: null },
  ]);
});

test("getAllTags returns all tags sorted by name", async () => {
  await setEntityTags("task", "t1", ["zeta"]);
  await setEntityTags("task", "t2", ["alpha"]);
  assert.deepEqual((await getAllTags()).map((t) => t.name), ["alpha", "zeta"]);
});

test("removeEntityTag removes only that relation and keeps the global tag", async () => {
  await setEntityTags("task", "t1", ["a", "b"]);
  await removeEntityTag("task", "t1", "A"); // case-insensitive
  assert.deepEqual((await getEntityTags("task", "t1")).map((t) => t.name), ["b"]);
  assert.equal(await countStore("tags"), 2); // tag 'a' still exists globally
});

test("cidsForTag returns the set of entity cids for a tag name", async () => {
  await setEntityTags("task", "t1", ["kerja"]);
  await setEntityTags("task", "t2", ["kerja"]);
  await setEntityTags("task", "t3", ["lain"]);
  const set = await cidsForTag("task", "KERJA");
  assert.deepEqual([...set].sort(), ["t1", "t2"]);
});
