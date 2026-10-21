"use strict";
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { deleteDB } = require("./setup.js");
const { DB_NAME, _reset, openDB } = require("../../static/offline/db.js");
const { buildTaskRouter } = require("../../static/offline/taskroutes.js");
const chatrepo = require("../../static/offline/chatrepo.js");
const { mapPut } = require("../../static/offline/idmap.js");

async function put(store, recs) {
  const db = await openDB();
  await new Promise((res, rej) => {
    const tx = db.transaction(store, "readwrite");
    for (const r of recs) tx.objectStore(store).put(r);
    tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error);
  });
}
const NOTE = { cid: "n1", server_id: 10, list_id: 7, title: "T", content: "", updated_at: "2026-10-21T08:00:00Z" };
function srv(over) {
  return Object.assign({
    id: 100, note_id: 10, list_id: 7, parent_id: null, user_id: 2, username: "rina", display_name: "Rina",
    body: "server body", quote: null, resolved_at: null, resolved_by: null, resolved_by_name: null,
    edited_at: null, deleted_at: null, client_id: null,
    created_at: "2026-10-21T08:00:00+07:00", updated_at: "2026-10-21T08:00:00+07:00",
  }, over);
}
async function rejects(p) { try { await p; } catch (e) { return e; } assert.fail("expected rejection"); }

beforeEach(async () => {
  _reset(); await deleteDB(DB_NAME);
  chatrepo.setCurrentUser({ user_id: 1, username: "me", display_name: "Me" });
  chatrepo.configureFetcher(null);
  await put("scratchpad_notes", [Object.assign({}, NOTE)]);
});

test("POST then GET offline gives one pending comment", async () => {
  const R = buildTaskRouter();
  const c = await R.dispatch("POST", "/api/scratchpad/10/comments", { body: "halo" });
  assert.equal(c.body, "halo");
  const list = await R.dispatch("GET", "/api/scratchpad/10/comments");
  assert.equal(list.length, 1);
  assert.equal(list[0].pending, true);
});

test("POST on a private note rejects 409", async () => {
  await put("scratchpad_notes", [{ cid: "p1", server_id: 11, list_id: null, title: "P", content: "" }]);
  const e = await rejects(buildTaskRouter().dispatch("POST", "/api/scratchpad/11/comments", { body: "x" }));
  assert.equal(e.status, 409);
});

test("GET/POST on unknown note rejects 404", async () => {
  const R = buildTaskRouter();
  assert.equal((await rejects(R.dispatch("GET", "/api/scratchpad/999/comments"))).message, "Note not found");
  assert.equal((await rejects(R.dispatch("POST", "/api/scratchpad/999/comments", { body: "x" }))).message, "Note not found");
});

test("PATCH body and resolved via cid and via server id; unknown id 404", async () => {
  const R = buildTaskRouter();
  const c = await R.dispatch("POST", "/api/scratchpad/10/comments", { body: "satu" });
  const e1 = await R.dispatch("PATCH", "/api/note-comments/" + c.cid, { body: "dua" });
  assert.equal(e1.body, "dua");
  const r1 = await R.dispatch("PATCH", "/api/note-comments/" + c.cid, { resolved: true });
  assert.ok(r1.resolved_at);
  await mapPut("comment", 555, c.cid);
  const r2 = await R.dispatch("PATCH", "/api/note-comments/555", { resolved: false });
  assert.equal(r2.resolved_at, null);
  const e = await rejects(R.dispatch("PATCH", "/api/note-comments/zzz", { body: "x" }));
  assert.equal(e.status, 404);
  assert.equal(e.message, "Komentar tidak ditemukan");
});

test("DELETE removes comment from GET; unknown 404", async () => {
  const R = buildTaskRouter();
  const c = await R.dispatch("POST", "/api/scratchpad/10/comments", { body: "x" });
  assert.deepEqual(await R.dispatch("DELETE", "/api/note-comments/" + c.cid), { ok: true });
  assert.equal((await R.dispatch("GET", "/api/scratchpad/10/comments")).length, 0);
  assert.equal((await rejects(R.dispatch("DELETE", "/api/note-comments/nope"))).status, 404);
});

test("GET online fetches server comments and merges", async () => {
  let url = null;
  chatrepo.configureFetcher((u) => { url = u; return Promise.resolve([srv()]); });
  const list = await buildTaskRouter().dispatch("GET", "/api/scratchpad/10/comments");
  assert.equal(url, "/api/scratchpad/10/comments");
  assert.equal(list.length, 1);
  assert.equal(list[0].body, "server body");
});

test("GET with failing fetcher falls back to local", async () => {
  const R = buildTaskRouter();
  await R.dispatch("POST", "/api/scratchpad/10/comments", { body: "lokal" });
  chatrepo.configureFetcher(() => Promise.reject(new Error("net")));
  const list = await R.dispatch("GET", "/api/scratchpad/10/comments");
  assert.deepEqual(list.map((c) => c.body), ["lokal"]);
});

test("GET skips fetch when note has no server_id", async () => {
  await put("scratchpad_notes", [{ cid: "l1", server_id: null, list_id: 7, title: "L", content: "" }]);
  let called = false;
  chatrepo.configureFetcher(() => { called = true; return Promise.resolve([]); });
  const list = await buildTaskRouter().dispatch("GET", "/api/scratchpad/l1/comments");
  assert.equal(called, false);
  assert.deepEqual(list, []);
});

test("POST comments/read returns ok", async () => {
  assert.deepEqual(await buildTaskRouter().dispatch("POST", "/api/scratchpad/10/comments/read", {}), { ok: true });
});

test("note list and detail carry comment badge fields; moved note is 0/false", async () => {
  const R = buildTaskRouter();
  await R.dispatch("POST", "/api/scratchpad/10/comments", { body: "mine" });
  const other = require("../../static/offline/commentrepo.js");
  await other.mergePulled([srv({ id: 101, user_id: 2, body: "dari lain" })], {});
  const list = await R.dispatch("GET", "/api/scratchpad", {});
  const row = list.find((n) => n.cid === "n1");
  assert.equal(row.comment_open_count, 2);
  assert.equal(row.comment_unread, true);
  const one = await R.dispatch("GET", "/api/scratchpad/10");
  assert.equal(one.comment_open_count, 2);
  assert.equal(one.comment_unread, true);
  await put("scratchpad_notes", [Object.assign({}, NOTE, { list_id: 8 })]);
  const moved = await R.dispatch("GET", "/api/scratchpad/10");
  assert.equal(moved.comment_open_count, 0);
  assert.equal(moved.comment_unread, false);
  const e = await rejects(R.dispatch("GET", "/api/scratchpad/999"));
  assert.equal(e.message, "Note not found");
});

test("stream and delta-pull stay network-only", () => {
  const R = buildTaskRouter();
  assert.equal(R.hasRoute("GET", "/api/note-comments?since="), false);
  assert.equal(R.hasRoute("GET", "/api/scratchpad/10/comments/stream"), false);
  assert.equal(R.hasRoute("GET", "/api/scratchpad/10/comments"), true);
});
