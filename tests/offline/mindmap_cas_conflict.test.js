"use strict";
// Workstream D (audit 2026-10-15): K5 rev/CAS mindmap, T3 base_rev + 409 → salinan konflik, pull edit-vs-edit,
// tab editor (if_updated_at) → salinan konflik lewat router lokal.
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { deleteDB } = require("./setup.js");
const { DB_NAME, _reset, openDB } = require("../../static/offline/db.js");
const { mapPut, serverIdOf } = require("../../static/offline/idmap.js");
const { outboxAll } = require("../../static/offline/outbox.js");
const { pushOutbox, mindmapToUpdatePayload } = require("../../static/offline/syncpush.js");
const { listNotices, listConflicts } = require("../../static/offline/syncconflict.js");
const { buildTaskRouter } = require("../../static/offline/taskroutes.js");
const mm = require("../../static/offline/mindmaprepo.js");

beforeEach(async () => { _reset(); await deleteDB(DB_NAME); mm.setCurrentUser(null); });

async function put(store, recs) {
  const db = await openDB();
  await new Promise((res, rej) => {
    const tx = db.transaction(store, "readwrite");
    for (const r of recs) tx.objectStore(store).put(r);
    tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error);
  });
}
async function get(store, cid) {
  const db = await openDB();
  return new Promise((res) => { const q = db.transaction(store).objectStore(store).get(cid); q.onsuccess = () => res(q.result); });
}
async function all(store) {
  const db = await openDB();
  return new Promise((res) => { const q = db.transaction(store).objectStore(store).getAll(); q.onsuccess = () => res(q.result || []); });
}
function rec(over) {
  return Object.assign({
    cid: over.cid, server_id: null, title: "M", data_json: "{\"v\":1}", pinned: false, list_id: null, user_id: 1,
    last_edited_by: 1, last_editor_username: null, last_editor_display_name: null,
    created_at: "2026-10-15T00:00:00", updated_at: "2026-10-15T00:00:00", deleted: false, dirty: 1, base_rev: null, rev: 1,
  }, over);
}
function srvRow(over) {
  return Object.assign({
    id: over.id, title: "Srv", data_json: "{\"srv\":1}", is_pinned: 0, list_id: null, user_id: 1,
    last_edited_by: 2, last_editor_username: "bob", last_editor_display_name: "Bob",
    created_at: "2026-10-15T00:00:00", updated_at: "2026-10-15T09:00:00",
  }, over);
}
// Transport yang membiarkan tes mengedit record "selama request in-flight" (sebelum respons tiba).
function transport(handler, during) {
  const calls = [];
  return {
    calls,
    request(method, path, body) {
      calls.push({ method, path, body });
      const res = handler(method, path, body, calls.length);
      const d = during ? during(calls.length, method, path) : null;
      return Promise.resolve(d).then(() => res);
    },
  };
}
const rev409 = (current) => ({ status: 409, data: { detail: { code: "REV_MISMATCH", current } } });

// ── K5: rev naik di setiap tulis lokal ───────────────────────────────────────────────────────────
test("mindmaprepo bumps rev on create (1), update, pin and delete", async () => {
  const r = await mm.createMindmap({ title: "T" }, { now: "2026-10-15T00:00:00" });
  assert.equal((await get("mindmaps", r.cid)).rev, 1);
  await mm.updateMindmap(r.cid, { data_json: "{\"v\":2}" }, { now: "2026-10-15T00:01:00" });
  assert.equal((await get("mindmaps", r.cid)).rev, 2);
  await mm.togglePin(r.cid);
  const afterPin = await get("mindmaps", r.cid);
  assert.equal(afterPin.rev, 3);
  assert.equal(afterPin.dirty, 1);
  await mm.deleteMindmap(r.cid);
  assert.equal((await get("mindmaps", r.cid)).rev, 4);
});

test("K5: edit during an in-flight PUT is NOT reverted — record stays dirty with v2, update op requeued, v2 pushed next", async () => {
  await put("mindmaps", [rec({ cid: "m", server_id: 10, data_json: "{\"v\":1}", rev: 1, base_rev: "2026-10-15T00:00:00" })]);
  await mapPut("mindmap", 10, "m");
  await put("_outbox", [{ qid: 1, op: "update", entity_type: "mindmap", cid: "m", payload: {} }]);
  const tr = transport(
    () => ({ status: 200, data: { id: 10, updated_at: "2026-10-15T01:00:00" } }),
    (n) => (n === 1 ? mm.updateMindmap("m", { data_json: "{\"v\":2}" }, { now: "2026-10-15T00:30:00" }) : null),
  );
  const r = await pushOutbox(tr);
  assert.equal(r.pushed, 1);
  assert.equal(tr.calls[0].body.data_json, "{\"v\":1}");
  let cur = await get("mindmaps", "m");
  assert.equal(cur.data_json, "{\"v\":2}", "edit selama in-flight tidak ditimpa versi pra-request");
  assert.equal(cur.dirty, 1);
  assert.equal(cur.base_rev, "2026-10-15T01:00:00");
  const ops = await outboxAll();
  assert.equal(ops.filter((o) => o.entity_type === "mindmap" && o.op === "update" && o.cid === "m").length, 1);
  // drain berikutnya mengirim v2 dengan base_rev dari respons PUT pertama
  const tr2 = transport(() => ({ status: 200, data: { id: 10, updated_at: "2026-10-15T02:00:00" } }));
  await pushOutbox(tr2);
  assert.equal(tr2.calls[0].body.data_json, "{\"v\":2}");
  assert.equal(tr2.calls[0].body.base_rev, "2026-10-15T01:00:00");
  cur = await get("mindmaps", "m");
  assert.equal(cur.dirty, 0);
  assert.equal((await outboxAll()).length, 0);
});

test("K5: edit during an in-flight POST create → server_id adopted, still dirty, update op follows", async () => {
  await put("mindmaps", [rec({ cid: "m", data_json: "{\"v\":1}", rev: 1 })]);
  await put("_outbox", [{ qid: 1, op: "create", entity_type: "mindmap", cid: "m", payload: {} }]);
  const tr = transport(
    () => ({ status: 200, data: { id: 44, updated_at: "2026-10-15T01:00:00" } }),
    (n) => (n === 1 ? mm.updateMindmap("m", { data_json: "{\"v\":2}" }, { now: "2026-10-15T00:30:00" }) : null),
  );
  await pushOutbox(tr);
  const cur = await get("mindmaps", "m");
  assert.equal(cur.server_id, 44);
  assert.equal(await serverIdOf("m"), 44);
  assert.equal(cur.dirty, 1);
  assert.equal(cur.data_json, "{\"v\":2}");
  const ops = await outboxAll();
  assert.equal(ops.length, 1);
  assert.equal(ops[0].op, "update");
});

// ── T3: base_rev + 409 REV_MISMATCH → salinan konflik ────────────────────────────────────────────
test("mindmapToUpdatePayload carries base_rev only when known", () => {
  assert.equal(mindmapToUpdatePayload(rec({ cid: "m", base_rev: "2026-10-15T00:00:00" })).base_rev, "2026-10-15T00:00:00");
  assert.equal("base_rev" in mindmapToUpdatePayload(rec({ cid: "m", base_rev: null })), false);
});

test("409 REV_MISMATCH → local becomes '(konflik) <title>' copy (create op), original adopts server current (clean, notice)", async () => {
  await put("mindmaps", [rec({ cid: "m", server_id: 10, title: "Peta", data_json: "{\"mine\":1}", list_id: 7, rev: 2, base_rev: "2026-10-15T00:00:00" })]);
  await mapPut("mindmap", 10, "m");
  await put("_outbox", [{ qid: 1, op: "update", entity_type: "mindmap", cid: "m", payload: {} }]);
  const current = srvRow({ id: 10, title: "Peta", data_json: "{\"theirs\":1}", list_id: 7, updated_at: "2026-10-15T09:00:00" });
  const tr = transport(() => rev409(current));
  const r = await pushOutbox(tr);
  assert.equal(tr.calls[0].body.base_rev, "2026-10-15T00:00:00");
  assert.equal(r.conflicts, 1);
  assert.equal(r.pushed, 0);
  const rows = await all("mindmaps");
  const orig = rows.find((x) => x.cid === "m");
  const copy = rows.find((x) => x.cid !== "m");
  assert.equal(orig.data_json, "{\"theirs\":1}");
  assert.equal(orig.dirty, 0);
  assert.equal(orig.base_rev, "2026-10-15T09:00:00");
  assert.equal(orig.rev, 3);
  assert.equal(orig.list_id, 7);
  assert.deepEqual(orig.notice, { kind: "conflict_copy", title: "Peta", copyTitle: "(konflik) Peta", editor: "Bob" });
  assert.equal(copy.title, "(konflik) Peta");
  assert.equal(copy.data_json, "{\"mine\":1}");
  assert.equal(copy.list_id, null);
  assert.equal(copy.server_id, null);
  assert.equal(copy.dirty, 1);
  assert.equal(copy.rev, 1);
  assert.ok(copy.client_id && copy.client_id !== "m");
  const ops = await outboxAll();
  assert.deepEqual(ops.map((o) => [o.op, o.cid]), [["create", copy.cid]]);
  // notice tampil di conflict bar (listNotices) dengan copyTitle
  const notices = await listNotices();
  assert.equal(notices.length, 1);
  assert.equal(notices[0].kind, "conflict_copy");
  assert.equal(notices[0].copyTitle, "(konflik) Peta");
  assert.equal(notices[0].entity, "mindmap");
  // drain berikutnya: salinan di-POST dengan client_id segar dan isi lokal
  const tr2 = transport(() => ({ status: 200, data: { id: 99, updated_at: "2026-10-15T10:00:00" } }));
  const r2 = await pushOutbox(tr2);
  assert.equal(r2.pushed, 1);
  assert.equal(tr2.calls[0].method, "POST");
  assert.equal(tr2.calls[0].body.data_json, "{\"mine\":1}");
  assert.equal(tr2.calls[0].body.client_id, copy.client_id);
  assert.equal((await get("mindmaps", copy.cid)).server_id, 99);
});

test("409 REV_MISMATCH while the record was edited in-flight → op kept (CAS), resolved on the next drain", async () => {
  await put("mindmaps", [rec({ cid: "m", server_id: 10, data_json: "{\"mine\":1}", rev: 2, base_rev: "2026-10-15T00:00:00" })]);
  await mapPut("mindmap", 10, "m");
  await put("_outbox", [{ qid: 1, op: "update", entity_type: "mindmap", cid: "m", payload: {} }]);
  const current = srvRow({ id: 10, data_json: "{\"theirs\":1}" });
  const tr = transport(() => rev409(current), (n) => (n === 1 ? mm.updateMindmap("m", { data_json: "{\"mine\":2}" }, {}) : null));
  const r = await pushOutbox(tr);
  assert.equal(r.conflicts, undefined);
  assert.equal((await all("mindmaps")).length, 1, "tidak ada salinan dari versi yang sudah basi");
  assert.equal((await get("mindmaps", "m")).data_json, "{\"mine\":2}");
  assert.ok((await outboxAll()).some((o) => o.op === "update" && o.cid === "m"));
  const tr2 = transport(() => rev409(current));
  const r2 = await pushOutbox(tr2);
  assert.equal(r2.conflicts, 1);
  const rows = await all("mindmaps");
  assert.equal(rows.length, 2);
  assert.equal(rows.find((x) => x.cid !== "m").data_json, "{\"mine\":2}");
});

test("409 REV_MISMATCH where local content equals server current → adopt without a copy (lost-response echo)", async () => {
  await put("mindmaps", [rec({ cid: "m", server_id: 10, title: "Srv", data_json: "{\"same\":1}", rev: 2, base_rev: "2026-10-15T00:00:00" })]);
  await mapPut("mindmap", 10, "m");
  await put("_outbox", [{ qid: 1, op: "update", entity_type: "mindmap", cid: "m", payload: {} }]);
  const tr = transport(() => rev409(srvRow({ id: 10, title: "Srv", data_json: "{\"same\":1}" })));
  await pushOutbox(tr);
  const rows = await all("mindmaps");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].dirty, 0);
  assert.equal(rows[0].base_rev, "2026-10-15T09:00:00");
  assert.equal(rows[0].notice, undefined);
  assert.equal((await outboxAll()).length, 0);
});

test("409 without REV_MISMATCH body stays a permanent error (sync_error, op dropped, record dirty)", async () => {
  await put("mindmaps", [rec({ cid: "m", server_id: 10, rev: 1, base_rev: "x" })]);
  await mapPut("mindmap", 10, "m");
  await put("_outbox", [{ qid: 1, op: "update", entity_type: "mindmap", cid: "m", payload: {} }]);
  const tr = transport(() => ({ status: 409, data: { detail: "duplikat" } }));
  await pushOutbox(tr);
  const cur = await get("mindmaps", "m");
  assert.equal(cur.dirty, 1);
  assert.equal(cur.sync_error.status, 409);
  assert.equal((await outboxAll()).length, 0);
  assert.ok((await listConflicts()).some((c) => c.entity === "mindmap" && c.conflict === "sync_error"));
});

test("404 on update (personal) re-creates via CAS: edit during the POST keeps v2 dirty", async () => {
  await put("mindmaps", [rec({ cid: "m", server_id: 10, data_json: "{\"v\":1}", rev: 1, base_rev: "x" })]);
  await mapPut("mindmap", 10, "m");
  await put("_outbox", [{ qid: 1, op: "update", entity_type: "mindmap", cid: "m", payload: {} }]);
  const tr = transport(
    (m, p, b, n) => (n === 1 ? { status: 404, data: { detail: "gone" } } : { status: 200, data: { id: 55, updated_at: "2026-10-15T03:00:00" } }),
    (n) => (n === 2 ? mm.updateMindmap("m", { data_json: "{\"v\":2}" }, {}) : null),
  );
  await pushOutbox(tr);
  const cur = await get("mindmaps", "m");
  assert.equal(cur.server_id, 55);
  assert.equal(cur.data_json, "{\"v\":2}");
  assert.equal(cur.dirty, 1);
  assert.equal(cur.base_rev, "2026-10-15T03:00:00");
  assert.ok((await outboxAll()).some((o) => o.op === "update" && o.cid === "m"));
});

// ── Tab editor: if_updated_at (router lokal PUT) ─────────────────────────────────────────────────
test("PUT /api/mindmaps/:id with a stale if_updated_at (record replaced by pull) → conflict copy, original untouched, response carries conflict_copy", async () => {
  await put("mindmaps", [rec({ cid: "m", server_id: 10, title: "Peta", data_json: "{\"srv\":2}", dirty: 0, rev: 3, updated_at: "2026-10-15T09:00:00", base_rev: "2026-10-15T09:00:00" })]);
  await mapPut("mindmap", 10, "m");
  const R = buildTaskRouter();
  const res = await R.dispatch("PUT", "/api/mindmaps/10", { data_json: "{\"tab\":1}", if_updated_at: "2026-10-15T00:00:00" });
  assert.equal(res.data_json, "{\"srv\":2}", "respons = versi server (tab memuat ulang)");
  assert.ok(res.conflict_copy);
  assert.equal(res.conflict_copy.title, "(konflik) Peta");
  assert.equal(res.conflict_copy.data_json, "{\"tab\":1}");
  const orig = await get("mindmaps", "m");
  assert.equal(orig.data_json, "{\"srv\":2}");
  assert.equal(orig.dirty, 0);
  assert.equal(orig.notice.kind, "conflict_copy");
  const ops = await outboxAll();
  assert.equal(ops.length, 1);
  assert.equal(ops[0].op, "create");
  assert.equal((await all("mindmaps")).length, 2);
});

test("PUT with a matching if_updated_at saves normally (no copy); without if_updated_at always saves", async () => {
  await put("mindmaps", [rec({ cid: "m", server_id: 10, data_json: "{\"srv\":2}", dirty: 0, rev: 3, updated_at: "2026-10-15T09:00:00", base_rev: "2026-10-15T09:00:00" })]);
  await mapPut("mindmap", 10, "m");
  const R = buildTaskRouter();
  const res = await R.dispatch("PUT", "/api/mindmaps/10", { data_json: "{\"tab\":1}", if_updated_at: "2026-10-15T09:00:00" });
  assert.equal(res.data_json, "{\"tab\":1}");
  assert.equal(res.conflict_copy, undefined);
  const cur = await get("mindmaps", "m");
  assert.equal(cur.dirty, 1);
  assert.equal(cur.rev, 4);
  const res2 = await R.dispatch("PUT", "/api/mindmaps/10", { data_json: "{\"tab\":2}" });
  assert.equal(res2.data_json, "{\"tab\":2}");
  assert.equal((await all("mindmaps")).length, 1);
});
