"use strict";
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { deleteDB } = require("./setup.js");
const { DB_NAME, _reset, openDB } = require("../../static/offline/db.js");
const { getTask } = require("../../static/offline/taskrepo.js");

const TODAY = "2026-06-03";

beforeEach(async () => { _reset(); await deleteDB(DB_NAME); });

// Helper: put a raw task record straight into the store.
async function seedTask(rec) {
  const db = await openDB();
  await new Promise((resolve, reject) => {
    const tx = db.transaction("tasks", "readwrite");
    tx.objectStore("tasks").put(rec);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

test("getTask returns undefined for a missing cid", async () => {
  assert.equal(await getTask("nope", TODAY), undefined);
});

test("getTask assembles derived fields and is_focused bool", async () => {
  await seedTask({
    cid: "t1", server_id: null, title: "A", deadline: "2026-06-02",
    gtd_status: "next", is_focused: 1, parent_cid: null,
    deleted: false, dirty: 0,
  });
  const t = await getTask("t1", TODAY);
  assert.equal(t.cid, "t1");
  assert.equal(t.is_focused, true);            // coerced to boolean
  assert.equal(t.days_until_deadline, -1);
  assert.equal(t.is_overdue, true);            // overdue + active
  assert.equal(t.assigned_to_name, null);      // not resolved in this plan
  assert.equal(t.parent_title, null);
});

test("getTask resolves parent_title from the local tasks store", async () => {
  await seedTask({ cid: "parent", title: "Parent Task", parent_cid: null, deleted: false, dirty: 0 });
  await seedTask({ cid: "child", title: "Child", parent_cid: "parent", deleted: false, dirty: 0 });
  const t = await getTask("child", TODAY);
  assert.equal(t.parent_title, "Parent Task");
});

test("getTask hides soft-deleted (tombstoned) records", async () => {
  await seedTask({ cid: "gone", title: "Gone", parent_cid: null, deleted: true, dirty: 1 });
  assert.equal(await getTask("gone", TODAY), undefined);
});

const { createTask } = require("../../static/offline/taskrepo.js");
const { outboxAll } = require("../../static/offline/outbox.js");

const NOW = "2026-06-03T08:00:00.000Z";

test("createTask applies defaults, uppercases priority, sets timestamps", async () => {
  const t = await createTask({ title: "Beli kopi" }, { today: TODAY, now: NOW });
  assert.equal(typeof t.cid, "string");
  assert.equal(t.server_id, null);
  assert.equal(t.title, "Beli kopi");
  assert.equal(t.description, "");
  assert.equal(t.priority, "P2");
  assert.equal(t.gtd_status, "inbox");
  assert.equal(t.project, "");
  assert.equal(t.context, "");
  assert.equal(t.deadline, null);
  assert.equal(t.progress, 0);
  assert.equal(t.is_focused, false);
  assert.equal(t.completed_at, null);
  assert.equal(t.created_at, NOW);
  assert.equal(t.updated_at, NOW);
  assert.equal(t.dirty, 1);
  assert.equal(t.deleted, false);
});

test("createTask lowercases-and-strips #tags from the title", async () => {
  const t = await createTask({ title: "Riset pasar #Kerja #urgent" }, { today: TODAY, now: NOW });
  assert.equal(t.title, "Riset pasar");
});

test("createTask throws when title is empty after stripping tags", async () => {
  await assert.rejects(
    () => createTask({ title: "#onlytags" }, { today: TODAY, now: NOW }),
    /kosong setelah strip tag/i
  );
});

test("createTask computes quadrant via tasklogic (P1 due in 5 days -> Q1)", async () => {
  const t = await createTask({ title: "X", priority: "p1", deadline: "2026-06-08" }, { today: TODAY, now: NOW });
  assert.equal(t.priority, "P1");
  assert.equal(t.quadrant, "Q1");
});

test("createTask P3 with no deadline -> Q4", async () => {
  const t = await createTask({ title: "Y", priority: "P3" }, { today: TODAY, now: NOW });
  assert.equal(t.quadrant, "Q4");
});

test("createTask persists the record and enqueues a create op in _outbox", async () => {
  const t = await createTask({ title: "Z" }, { today: TODAY, now: NOW });
  const fetched = await getTask(t.cid, TODAY);
  assert.equal(fetched.title, "Z");
  const ops = await outboxAll();
  assert.equal(ops.length, 1);
  assert.equal(ops[0].op, "create");
  assert.equal(ops[0].entity_type, "task");
  assert.equal(ops[0].cid, t.cid);
});

const { updateTask, getRaw } = require("../../static/offline/taskrepo.js");

const LATER = "2026-06-04T09:00:00.000Z";

test("updateTask changes only provided fields and bumps updated_at", async () => {
  const t = await createTask({ title: "Edit me", priority: "P3" }, { today: TODAY, now: NOW });
  const u = await updateTask(t.cid, { description: "added" }, { today: TODAY, now: LATER });
  assert.equal(u.description, "added");
  assert.equal(u.title, "Edit me");
  assert.equal(u.priority, "P3");
  assert.equal(u.updated_at, LATER);
  assert.equal(u.dirty, 1);
});

test("updateTask uppercases priority and recomputes quadrant", async () => {
  const t = await createTask({ title: "Q", priority: "P3", deadline: "2026-06-05" }, { today: TODAY, now: NOW });
  const u = await updateTask(t.cid, { priority: "p1" }, { today: TODAY, now: LATER });
  assert.equal(u.priority, "P1");
  assert.equal(u.quadrant, "Q1"); // P1 + due in 2 days
});

test("updateTask gtd_status done sets completed_at", async () => {
  const t = await createTask({ title: "Finish" }, { today: TODAY, now: NOW });
  const u = await updateTask(t.cid, { gtd_status: "done" }, { today: TODAY, now: LATER });
  assert.equal(u.gtd_status, "done");
  assert.equal(u.completed_at, LATER);
});

test("updateTask deadline '' or '-' clears the deadline", async () => {
  const t = await createTask({ title: "D", deadline: "2026-06-10" }, { today: TODAY, now: NOW });
  const u1 = await updateTask(t.cid, { deadline: "" }, { today: TODAY, now: LATER });
  assert.equal(u1.deadline, null);
  const t2 = await createTask({ title: "D2", deadline: "2026-06-10" }, { today: TODAY, now: NOW });
  const u2 = await updateTask(t2.cid, { deadline: "-" }, { today: TODAY, now: LATER });
  assert.equal(u2.deadline, null);
});

test("updateTask assigned_to 0 becomes null; progress is clamped", async () => {
  const t = await createTask({ title: "P" }, { today: TODAY, now: NOW });
  const u = await updateTask(t.cid, { assigned_to: 0, progress: 250 }, { today: TODAY, now: LATER });
  assert.equal(u.assigned_to, null);
  assert.equal(u.progress, 100);
  const u2 = await updateTask(t.cid, { progress: -5 }, { today: TODAY, now: LATER });
  assert.equal(u2.progress, 0);
});

test("updateTask strips tags from a new title; rejects empty result", async () => {
  const t = await createTask({ title: "Orig" }, { today: TODAY, now: NOW });
  const u = await updateTask(t.cid, { title: "New title #tag" }, { today: TODAY, now: LATER });
  assert.equal(u.title, "New title");
  await assert.rejects(() => updateTask(t.cid, { title: "#only" }, { today: TODAY, now: LATER }), /kosong/i);
});

test("updateTask enqueues an update op and rejects unknown cid", async () => {
  const t = await createTask({ title: "OB" }, { today: TODAY, now: NOW });
  await updateTask(t.cid, { description: "x" }, { today: TODAY, now: LATER });
  const ops = await outboxAll();
  assert.ok(ops.some((o) => o.op === "update" && o.cid === t.cid));
  await assert.rejects(() => updateTask("ghost", { description: "x" }, { today: TODAY, now: LATER }), /not found/i);
});

const { deleteTask } = require("../../static/offline/taskrepo.js");

test("deleteTask soft-deletes (tombstone) and hides from getTask", async () => {
  const t = await createTask({ title: "Trash" }, { today: TODAY, now: NOW });
  const res = await deleteTask(t.cid, { now: LATER });
  assert.deepEqual(res, { ok: true });
  assert.equal(await getTask(t.cid, TODAY), undefined);
});

test("deleteTask sets deleted=true + dirty and enqueues a delete op", async () => {
  const t = await createTask({ title: "Trash2" }, { today: TODAY, now: NOW });
  await deleteTask(t.cid, { now: LATER });
  const db = await openDB();
  const raw = await new Promise((resolve, reject) => {
    const r = db.transaction("tasks", "readonly").objectStore("tasks").get(t.cid);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  assert.equal(raw.deleted, true);
  assert.equal(raw.dirty, 1);
  assert.equal(raw.updated_at, LATER);
  const ops = await outboxAll();
  assert.ok(ops.some((o) => o.op === "delete" && o.cid === t.cid));
});

test("deleteTask rejects an unknown cid", async () => {
  await assert.rejects(() => deleteTask("ghost", { now: LATER }), /not found/i);
});

const { displayFrom } = require("../../static/offline/taskrepo.js");

test("displayFrom builds the display object from a record + parentTitle (pure)", () => {
  const rec = {
    cid: "x", title: "T", deadline: "2026-06-02", gtd_status: "next",
    is_focused: 1, parent_cid: "p",
  };
  const d = displayFrom(rec, TODAY, "Parent");
  assert.equal(d.is_focused, true);
  assert.equal(d.days_until_deadline, -1);
  assert.equal(d.is_overdue, true);
  assert.equal(d.assigned_to_name, null);
  assert.equal(d.parent_title, "Parent");
  assert.equal(d.cid, "x"); // original fields preserved
});

const { getEntityTags } = require("../../static/offline/tagrepo.js");

test("createTask persists recurrence fields (weekly days json + end_date)", async () => {
  const t = await createTask(
    { title: "Standup", recurrence_type: "weekly", recurrence_days: [1, 3, 5] },
    { today: TODAY, now: NOW }
  );
  assert.equal(t.recurrence_type, "weekly");
  assert.equal(t.recurrence_days, JSON.stringify([1, 3, 5]));
  assert.equal(t.recurrence_end_date, "2026-09-01"); // 2026-06-03 + 90d
  assert.equal(t.recurrence_notif_level, null);
});

test("createTask without recurrence leaves recurrence fields null", async () => {
  const t = await createTask({ title: "Plain" }, { today: TODAY, now: NOW });
  assert.equal(t.recurrence_type, null);
  assert.equal(t.recurrence_days, null);
  assert.equal(t.recurrence_end_date, null);
});

test("createTask persists #tags from the title", async () => {
  const t = await createTask({ title: "Beli #kopi #Susu" }, { today: TODAY, now: NOW });
  assert.equal(t.title, "Beli");
  assert.deepEqual((await getEntityTags("task", t.cid)).map((x) => x.name), ["kopi", "susu"]);
});

// Bug lama "simpan task menghapus tag" (2026-10-26): judul tersimpan tanpa #tag (tag di store entity_tags), jadi
// form yang mengirim judul tidak memuat tag. #tag di judul kini MENAMBAH tag task; judul tanpa #tag tidak menyentuh
// tag. Hapus tag hanya lewat removeEntityTag (chip ×); push tetap mengirim himpunan tag lokal lengkap.
test("updateTask adds #tags from a new title to the existing tags", async () => {
  const t = await createTask({ title: "A #one" }, { today: TODAY, now: NOW });
  await updateTask(t.cid, { title: "B #two #three" }, { today: TODAY, now: NOW });
  assert.deepEqual((await getEntityTags("task", t.cid)).map((x) => x.name), ["one", "three", "two"]);
});

test("updateTask leaves tags untouched when the title is absent", async () => {
  const t = await createTask({ title: "A #keep" }, { today: TODAY, now: NOW });
  await updateTask(t.cid, { priority: "P1" }, { today: TODAY, now: NOW });
  assert.deepEqual((await getEntityTags("task", t.cid)).map((x) => x.name), ["keep"]);
});

const { removeEntityTag } = require("../../static/offline/tagrepo.js");
const tagNamesOf = async (cid) => (await getEntityTags("task", cid)).map((x) => x.name);

test("updateTask: judul tanpa #tag (form modal/GTD) tidak menghapus tag lokal", async () => {
  const t = await createTask({ title: "A #a #b" }, { today: TODAY, now: NOW });
  const u = await updateTask(t.cid, { title: "X", priority: "P1" }, { today: TODAY, now: LATER });
  assert.equal(u.title, "X");
  assert.equal(u.priority, "P1");
  assert.deepEqual(await tagNamesOf(t.cid), ["a", "b"]);
});

test("updateTask: #tag baru di judul ditambahkan ke tag yang ada; judul tersimpan tanpa #tag", async () => {
  const t = await createTask({ title: "A #a #b" }, { today: TODAY, now: NOW });
  const u = await updateTask(t.cid, { title: "X #c" }, { today: TODAY, now: LATER });
  assert.equal(u.title, "X");
  assert.equal((await getRaw(t.cid)).title, "X");
  assert.deepEqual(await tagNamesOf(t.cid), ["a", "b", "c"]);
});

test("updateTask: #tag yang sudah ada (huruf besar) tidak menggandakan tag", async () => {
  const t = await createTask({ title: "A #a #b" }, { today: TODAY, now: NOW });
  await updateTask(t.cid, { title: "X #A #b" }, { today: TODAY, now: LATER });
  assert.deepEqual(await tagNamesOf(t.cid), ["a", "b"]);
});

test("updateTask: tag yang dihapus lewat chip × tidak kembali saat judul tanpa #tag disimpan", async () => {
  const t = await createTask({ title: "A #a #b" }, { today: TODAY, now: NOW });
  await removeEntityTag("task", t.cid, "b");
  await updateTask(t.cid, { title: "X", priority: "P1" }, { today: TODAY, now: LATER });
  assert.deepEqual(await tagNamesOf(t.cid), ["a"]);
});

test("push sesudah updateTask membawa semua tag lokal di judul (server mengganti dengan himpunan itu)", async () => {
  const { pushOutbox } = require("../../static/offline/syncpush.js");
  const calls = [];
  const tr = {
    request(method, path, body) {
      calls.push({ method, path, body });
      return Promise.resolve(method === "POST" ? { status: 201, data: { id: 100 } } : { status: 200, data: { id: 100 } });
    },
  };
  const lastPut = () => calls.filter((c) => c.method === "PUT").pop();
  const t = await createTask({ title: "A #a #b" }, { today: TODAY, now: NOW });
  await pushOutbox(tr);
  assert.equal(calls[0].method, "POST");
  assert.equal(calls[0].body.title, "A #a #b");

  await updateTask(t.cid, { title: "X", priority: "P1" }, { today: TODAY, now: LATER });
  await pushOutbox(tr);
  assert.equal(lastPut().path, "/api/tasks/100");
  assert.equal(lastPut().body.title, "X #a #b", "judul form tanpa #tag tetap mengirim tag lokal");
  assert.equal(lastPut().body.priority, "P1");

  await updateTask(t.cid, { title: "X #c" }, { today: TODAY, now: LATER });
  await pushOutbox(tr);
  assert.equal(lastPut().body.title, "X #a #b #c");

  await removeEntityTag("task", t.cid, "b");
  await updateTask(t.cid, { title: "X", description: "d" }, { today: TODAY, now: LATER });
  await pushOutbox(tr);
  assert.equal(lastPut().body.title, "X #a #c", "tag yang dihapus ikut terhapus di server lewat himpunan lengkap");
});

test("updateTask sets recurrence (type + monthly day clamp + end_date)", async () => {
  const t = await createTask({ title: "Bill" }, { today: TODAY, now: NOW });
  const u = await updateTask(
    t.cid, { recurrence_type: "monthly", recurrence_days: [99] }, { today: TODAY, now: NOW }
  );
  assert.equal(u.recurrence_type, "monthly");
  assert.equal(u.recurrence_days, JSON.stringify([28])); // clamped to 28
  assert.equal(u.recurrence_end_date, "2026-09-01");
});

test("updateTask recurrence_renew bumps end_date and clears notif_level", async () => {
  const t = await createTask(
    { title: "Daily", recurrence_type: "daily" }, { today: "2026-01-01", now: NOW }
  );
  const u = await updateTask(t.cid, { recurrence_renew: true }, { today: TODAY, now: NOW });
  assert.equal(u.recurrence_end_date, "2026-09-01"); // today+90, not the old 2026-04-01
  assert.equal(u.recurrence_notif_level, null);
});

test("createTask stores a server list_id when provided", async () => {
  const t = await createTask({ title: "Shared task", list_id: 7 }, { today: TODAY, now: NOW });
  assert.equal(t.list_id, 7);
  const plain = await createTask({ title: "Personal" }, { today: TODAY, now: NOW });
  assert.equal(plain.list_id, null);
});

test("updateTask clears recurrence when type is null/invalid", async () => {
  const t = await createTask(
    { title: "Daily", recurrence_type: "daily" }, { today: TODAY, now: NOW }
  );
  const u = await updateTask(t.cid, { recurrence_type: null }, { today: TODAY, now: NOW });
  assert.equal(u.recurrence_type, null);
  assert.equal(u.recurrence_days, null);
  assert.equal(u.recurrence_end_date, null);
});

test("createTask sets estimated_pomodoros (default 1, clamped 20) and pomodoros_done 0", async () => {
  const a = await createTask({ title: "A" }, { today: TODAY });
  const ra = await getRaw(a.cid);
  assert.equal(ra.estimated_pomodoros, 1);
  assert.equal(ra.pomodoros_done, 0);
  const b = await createTask({ title: "B", estimated_pomodoros: 30 }, { today: TODAY });
  assert.equal((await getRaw(b.cid)).estimated_pomodoros, 20);
});

test("updateTask patches estimated_pomodoros (clamped), dirty + rev up", async () => {
  const t = await createTask({ title: "A" }, { today: TODAY });
  const r0 = await getRaw(t.cid);
  await updateTask(t.cid, { estimated_pomodoros: 4 }, { today: TODAY });
  const r1 = await getRaw(t.cid);
  assert.equal(r1.estimated_pomodoros, 4);
  assert.equal(r1.dirty, 1);
  assert.ok(r1.rev > r0.rev);
  await updateTask(t.cid, { estimated_pomodoros: 0 }, { today: TODAY });
  assert.equal((await getRaw(t.cid)).estimated_pomodoros, 1);
});
