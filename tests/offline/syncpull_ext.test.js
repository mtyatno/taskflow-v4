"use strict";
// Pull task mempertahankan ext yang belum terkirim (spec plugin Fase 1 K5; rencana 1a-1 T6, R3, R11).
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { deleteDB } = require("./setup.js");
const { DB_NAME, _reset, openDB } = require("../../static/offline/db.js");
const { mapPut } = require("../../static/offline/idmap.js");
const { pullTasks, withLocalExt } = require("../../static/offline/syncpull.js");
const { outboxAll, outboxAdd } = require("../../static/offline/outbox.js");

beforeEach(async () => { _reset(); await deleteDB(DB_NAME); });

async function putTasks(recs) {
  const db = await openDB();
  await new Promise((res, rej) => {
    const tx = db.transaction("tasks", "readwrite");
    const os = tx.objectStore("tasks");
    for (const r of recs) os.put(r);
    tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error);
  });
}
async function getTask(cid) {
  const db = await openDB();
  return new Promise((res) => { const q = db.transaction("tasks").objectStore("tasks").get(cid); q.onsuccess = () => res(q.result); });
}
function local(over) {
  return Object.assign({
    cid: over.cid, server_id: null, title: over.cid, gtd_status: "next", base_rev: null,
    deleted: false, dirty: 0, rev: 1,
  }, over);
}
function srv(over) {
  return Object.assign({
    id: over.id, title: "T", description: "", gtd_status: "next", priority: "P3", quadrant: "Q4",
    project: "", context: "", deadline: null, waiting_for: "", completed_at: null, progress: 0,
    is_focused: 0, assigned_to: null, parent_id: null, list_id: null,
    recurrence_type: null, recurrence_days: null, recurrence_end_date: null, recurrence_notif_level: null,
    created_at: "2026-06-01T00:00:00", updated_at: "2026-06-04T00:00:00",
  }, over);
}

test("server tanpa ext / ext string → ext lokal bersih dipertahankan saat field lain berubah", async () => {
  await putTasks([
    local({ cid: "a", server_id: 10, title: "Old", base_rev: "2026-06-01T00:00:00", ext: { "demo-ext.a": 1 } }),
    local({ cid: "b", server_id: 11, title: "Old", base_rev: "2026-06-01T00:00:00", ext: { "demo-ext.b": 2 } }),
  ]);
  await mapPut("task", 10, "a");
  await mapPut("task", 11, "b");
  const r = await pullTasks([srv({ id: 10, title: "Baru" }), srv({ id: 11, title: "Baru", ext: "{}" })]);
  assert.equal(r.updated, 2);
  const a = await getTask("a");
  assert.equal(a.title, "Baru");
  assert.deepEqual(a.ext, { "demo-ext.a": 1 });
  assert.equal(a.dirty, 0);
  assert.equal("ext_dirty" in a, false);
  assert.deepEqual((await getTask("b")).ext, { "demo-ext.b": 2 });
  assert.equal(r.extKept, 0);
});

test("server ext objek → diadopsi pada record bersih", async () => {
  await putTasks([local({ cid: "a", server_id: 10, base_rev: "2026-06-01T00:00:00", ext: { "demo-ext.a": 1 } })]);
  await mapPut("task", 10, "a");
  await pullTasks([srv({ id: 10, ext: { "demo-ext.a": 2, "lain.k": 3 } })]);
  const a = await getTask("a");
  assert.deepEqual(a.ext, { "demo-ext.a": 2, "lain.k": 3 });
  assert.equal(a.dirty, 0);
  // record baru dari server
  await pullTasks([srv({ id: 10, ext: { "demo-ext.a": 2, "lain.k": 3 } }), srv({ id: 12, ext: { "demo-ext.z": 1 } })]);
  const fresh = (await new Promise(async (res) => {
    const db = await openDB();
    const q = db.transaction("tasks").objectStore("tasks").getAll();
    q.onsuccess = () => res(q.result);
  })).find((t) => t.server_id === 12);
  assert.deepEqual(fresh.ext, { "demo-ext.z": 1 });
});

test("LWW server menang + ext_dirty: field inti = server, kunci kotor lokal ditempel di atas ext server (kunci perangkat lain ikut), dirty 1, tepat satu op update baru", async () => {
  await putTasks([local({
    cid: "a", server_id: 10, title: "Lokal", priority: "P3", base_rev: "2026-06-01T00:00:00",
    updated_at: "2026-06-04T01:00:00.000Z", dirty: 1, rev: 3,
    ext: { "demo-ext.start": "2026-11-09", "demo-ext.gone": undefined, "demo-ext.dur": 3 },
    ext_dirty: ["demo-ext.start", "demo-ext.old"],
  })]);
  await mapPut("task", 10, "a");
  await outboxAdd({ op: "update", entity_type: "task", cid: "a", payload: {} });
  await outboxAdd({ op: "update", entity_type: "task", cid: "a", payload: {} });
  const r = await pullTasks([srv({
    id: 10, title: "Laptop", priority: "P1", updated_at: "2026-06-04T05:00:00",
    ext: { "demo-ext.start": "2026-11-01", "demo-ext.old": 1, "demo-ext.dur": 5, "lain.k": 9 },
  })]);
  assert.equal(r.lwwResolved, 1);
  assert.equal(r.extKept, 1);
  const a = await getTask("a");
  assert.equal(a.title, "Laptop");
  assert.equal(a.priority, "P1");
  assert.equal(a.base_rev, "2026-06-04T05:00:00");
  // kunci kotor: start (nilai lokal) dan old (dihapus lokal) menang; dur & lain.k dari server
  assert.deepEqual(a.ext, { "demo-ext.start": "2026-11-09", "demo-ext.dur": 5, "lain.k": 9 });
  assert.deepEqual(a.ext_dirty, ["demo-ext.start", "demo-ext.old"]);
  assert.equal(a.dirty, 1);
  const ops = await outboxAll();
  assert.equal(ops.length, 1);
  assert.equal(ops[0].op, "update");
  assert.equal(ops[0].cid, "a");
});

test("LWW lokal menang + ext_dirty: tidak berubah, op tetap", async () => {
  const rec = local({
    cid: "a", server_id: 10, title: "Lokal", base_rev: "2026-06-01T00:00:00",
    updated_at: "2026-06-04T09:00:00.000Z", dirty: 1, ext: { "demo-ext.a": 1 }, ext_dirty: ["demo-ext.a"],
  });
  await putTasks([rec]);
  await mapPut("task", 10, "a");
  await outboxAdd({ op: "update", entity_type: "task", cid: "a", payload: {} });
  const r = await pullTasks([srv({ id: 10, title: "Server", updated_at: "2026-06-04T02:00:00", ext: {} })]);
  assert.equal(r.lwwResolved, 1);
  assert.deepEqual(await getTask("a"), rec);
  assert.equal((await outboxAll()).length, 1);
});

test("tanpa ext_dirty: perilaku lama persis (dropOutbox, dirty 0)", async () => {
  await putTasks([local({ cid: "a", server_id: 10, title: "Lokal", base_rev: "2026-06-01T00:00:00",
    updated_at: "2026-06-04T01:00:00.000Z", dirty: 1, ext: { "demo-ext.a": 1 } })]);
  await mapPut("task", 10, "a");
  await outboxAdd({ op: "update", entity_type: "task", cid: "a", payload: {} });
  const r = await pullTasks([srv({ id: 10, title: "Server", updated_at: "2026-06-04T05:00:00" })]);
  assert.equal(r.extKept, 0);
  const a = await getTask("a");
  assert.equal(a.title, "Server");
  assert.equal(a.dirty, 0);
  assert.deepEqual(a.ext, { "demo-ext.a": 1 }); // server tanpa ext → only-if-sent
  assert.equal("ext_dirty" in a, false);
  assert.equal((await outboxAll()).length, 0);
});

test("record dirty tanpa op (jendela deploy) → diantre ulang oleh requeueDirtyWithoutOps, tidak ditimpa", async () => {
  const rec = local({ cid: "a", server_id: 10, title: "Lokal", base_rev: "2026-06-04T00:00:00",
    updated_at: "2026-06-04T01:00:00.000Z", dirty: 1, ext: { "demo-ext.a": 1 }, ext_dirty: ["demo-ext.a"] });
  await putTasks([rec]);
  await mapPut("task", 10, "a");
  const r = await pullTasks([srv({ id: 10, title: "Lokal", updated_at: "2026-06-04T00:00:00", ext: "{}" })]);
  assert.equal(r.requeued, 1);
  assert.deepEqual(await getTask("a"), rec);
  const ops = await outboxAll();
  assert.equal(ops.length, 1);
  assert.equal(ops[0].op, "update");
});

test("withLocalExt murni", () => {
  const server = { cid: "a", title: "S", dirty: 0 };
  assert.deepEqual(withLocalExt(Object.assign({}, server), null), server);
  assert.deepEqual(withLocalExt(Object.assign({}, server), { ext: { "abc.a": 1 } }).ext, { "abc.a": 1 });
  assert.equal("ext" in withLocalExt(Object.assign({}, server), { ext: "{}" }), false);
  const out = withLocalExt(Object.assign({}, server, { ext: { "abc.a": 2, "abc.b": 3 } }),
    { dirty: 1, ext: { "abc.a": 1 }, ext_dirty: ["abc.a", "abc.b"] });
  assert.deepEqual(out.ext, { "abc.a": 1 });
  assert.deepEqual(out.ext_dirty, ["abc.a", "abc.b"]);
  assert.equal(out.dirty, 1);
});

// Review akhir PR 1a-1 (temuan wajib): "Buang perubahan lokal" pada task ber-sync_error (422 EXT_TOO_LARGE) harus
// membuang ext_dirty juga; pull berikutnya tidak boleh menghidupkan lagi kunci yang ditolak server.
test("discard_local membersihkan ext_dirty → pull ext {} menghasilkan record bersih tanpa op", async () => {
  const { resolveConflict } = require("../../static/offline/syncconflict.js");
  await putTasks([local({
    cid: "a", server_id: 10, title: "T", base_rev: "2026-06-01T00:00:00", dirty: 1, rev: 3,
    ext: { "demo-ext.big": "x" }, ext_dirty: ["demo-ext.big"], sync_error: { status: 422, detail: "EXT_TOO_LARGE" },
  })]);
  await mapPut("task", 10, "a");
  await outboxAdd({ op: "update", entity_type: "task", cid: "a", payload: {} });
  const res = await resolveConflict("task", "a", "discard_local");
  assert.equal(res.ok, true);
  const mid = await getTask("a");
  assert.equal("ext_dirty" in mid, false, "discard_local menghapus ext_dirty");
  assert.equal(mid.dirty, 0);
  await pullTasks([srv({ id: 10, title: "T", updated_at: "2026-06-01T00:00:00", ext: {} })]);
  await pullTasks([srv({ id: 10, title: "T", updated_at: "2026-06-01T00:00:00", ext: {} })]);
  const a = await getTask("a");
  assert.equal(a.dirty, 0);
  assert.equal("ext_dirty" in a, false);
  assert.deepEqual(a.ext, {});
  assert.deepEqual(await outboxAll(), []);
});

test("withLocalExt: ext_dirty sisa pada record lokal yang tidak dirty tidak ditempel", () => {
  const out = withLocalExt({ id: 10, ext: { "demo-ext.a": 1 } },
    { cid: "a", dirty: 0, ext: { "demo-ext.a": 1, "demo-ext.big": "x" }, ext_dirty: ["demo-ext.big"] });
  assert.deepEqual(out.ext, { "demo-ext.a": 1 });
  assert.equal("ext_dirty" in out, false);
  assert.equal(out.dirty, undefined);
});

// ── PR 1c-0 Task 4 (R7): task yang tertunda hanya karena ext → field inti server menang saat pull ─────────────
const X = require("../../static/offline/taskext.js");
const KEY = X.EXT_ONLY_KEY;

test("record ext saja kotor + op, server berubah dengan updated_at LEBIH LAMA dari edit lokal → server menang (bukan LWW lokal): judul/status server, kunci ext_dirty ditempel di atas ext server, dirty 1, penanda = rev record baru, tepat satu op update", async () => {
  await putTasks([local({
    cid: "a", server_id: 10, title: "Judul basi", gtd_status: "next", base_rev: "2026-06-01T00:00:00",
    updated_at: "2026-06-04T09:00:00.000Z", dirty: 1, rev: 3, [KEY]: 3,
    ext: { "demo-ext.start": "2026-11-09", "lain.k": 1 }, ext_dirty: ["demo-ext.start"],
  })]);
  assert.equal(X.extOnlyNow(await getTask("a")), true);
  await mapPut("task", 10, "a");
  await outboxAdd({ op: "update", entity_type: "task", cid: "a", payload: {} });
  const r = await pullTasks([srv({
    id: 10, title: "Judul anggota lain", gtd_status: "done", updated_at: "2026-06-04T02:00:00",
    ext: { "demo-ext.start": "2026-11-01", "lain.k": 7 },
  })]);
  assert.equal(r.lwwResolved, 1);
  assert.equal(r.extKept, 1);
  const a = await getTask("a");
  assert.equal(a.title, "Judul anggota lain");
  assert.equal(a.gtd_status, "done");
  assert.equal(a.base_rev, "2026-06-04T02:00:00");
  assert.deepEqual(a.ext, { "demo-ext.start": "2026-11-09", "lain.k": 7 });
  assert.deepEqual(a.ext_dirty, ["demo-ext.start"]);
  assert.equal(a.dirty, 1);
  assert.equal(a.rev, 4);
  assert.equal(a[KEY], 4);
  assert.equal(X.extOnlyNow(a), true);
  const ops = await outboxAll();
  assert.equal(ops.length, 1);
  assert.equal(ops[0].op, "update");
  assert.equal(ops[0].cid, "a");
});

test("record ext saja + server tidak berubah (updated_at = base_rev) → dilewati, op tetap", async () => {
  const rec = local({
    cid: "a", server_id: 10, title: "Lokal", base_rev: "2026-06-04T00:00:00",
    updated_at: "2026-06-04T09:00:00.000Z", dirty: 1, rev: 3, [KEY]: 3, ext: { "demo-ext.a": 1 }, ext_dirty: ["demo-ext.a"],
  });
  await putTasks([rec]);
  await mapPut("task", 10, "a");
  await outboxAdd({ op: "update", entity_type: "task", cid: "a", payload: {} });
  const r = await pullTasks([srv({ id: 10, title: "Lokal", updated_at: "2026-06-04T00:00:00", ext: {} })]);
  assert.equal(r.lwwResolved, 0);
  assert.equal(r.skipped, 1);
  assert.deepEqual(await getTask("a"), rec);
  assert.equal((await outboxAll()).length, 1);
});

test("record ext saja tanpa ext_dirty (kasus tepi) → dropOutbox + tulis server, bersih", async () => {
  await putTasks([local({
    cid: "a", server_id: 10, title: "Lokal", base_rev: "2026-06-01T00:00:00",
    updated_at: "2026-06-04T09:00:00.000Z", dirty: 1, rev: 3, [KEY]: 3, ext: { "demo-ext.a": 1 },
  })]);
  await mapPut("task", 10, "a");
  await outboxAdd({ op: "update", entity_type: "task", cid: "a", payload: {} });
  const r = await pullTasks([srv({ id: 10, title: "Server", updated_at: "2026-06-04T02:00:00", ext: { "demo-ext.a": 2 } })]);
  assert.equal(r.lwwResolved, 1);
  assert.equal(r.updated, 1);
  assert.equal(r.extKept, 0);
  const a = await getTask("a");
  assert.equal(a.title, "Server");
  assert.equal(a.dirty, 0);
  assert.deepEqual(a.ext, { "demo-ext.a": 2 });
  assert.equal(KEY in a, false);
  assert.equal("ext_dirty" in a, false);
  assert.equal((await outboxAll()).length, 0);
});

test("jalur R11 untuk record TANPA penanda yang kalah LWW → kini ber-penanda (inti dari server)", async () => {
  await putTasks([local({
    cid: "a", server_id: 10, title: "Lokal", base_rev: "2026-06-01T00:00:00",
    updated_at: "2026-06-04T01:00:00.000Z", dirty: 1, rev: 5, ext: { "demo-ext.a": 1 }, ext_dirty: ["demo-ext.a"],
  })]);
  await mapPut("task", 10, "a");
  await outboxAdd({ op: "update", entity_type: "task", cid: "a", payload: {} });
  const r = await pullTasks([srv({ id: 10, title: "Server", updated_at: "2026-06-04T05:00:00", ext: {} })]);
  assert.equal(r.extKept, 1);
  const a = await getTask("a");
  assert.equal(a.title, "Server");
  assert.equal(a.rev, 6);
  assert.equal(a[KEY], 6);
  assert.equal(X.extOnlyNow(a), true);
});

test("tab lama menaikkan rev tanpa penanda (record kotor, ext_only_rev < rev) → LWW lama", async () => {
  // tab lama (kode 1b) menyalin record dan menaikkan rev untuk edit judul → penanda basi
  const rec = local({
    cid: "a", server_id: 10, title: "Judul baru tab lama", base_rev: "2026-06-01T00:00:00",
    updated_at: "2026-06-04T09:00:00.000Z", dirty: 1, rev: 4, [KEY]: 3, ext: { "demo-ext.a": 1 }, ext_dirty: ["demo-ext.a"],
  });
  assert.equal(X.extOnlyNow(rec), false);
  await putTasks([rec]);
  await mapPut("task", 10, "a");
  await outboxAdd({ op: "update", entity_type: "task", cid: "a", payload: {} });
  const r = await pullTasks([srv({ id: 10, title: "Server", updated_at: "2026-06-04T02:00:00", ext: {} })]);
  assert.equal(r.lwwResolved, 1);
  assert.deepEqual(await getTask("a"), rec, "lokal lebih baru → lokal menang, judul tab lama tidak hilang");
  assert.equal((await outboxAll()).length, 1);
});

test("hapus tag pada record ext saja (rev naik, updated_at tetap → penanda basi) → LWW lama, bukan server-menang", async () => {
  // keadaan setelah rute DELETE tag (Task 2, R8): rev +1 dari record ext saja, updated_at tidak berubah
  const rec = local({
    cid: "a", server_id: 10, title: "Lokal", base_rev: "2026-06-01T00:00:00",
    updated_at: "2026-06-04T09:00:00.000Z", dirty: 1, rev: 4, [KEY]: 3, ext: { "demo-ext.a": 1 }, ext_dirty: ["demo-ext.a"],
  });
  assert.equal(X.extOnlyNow(rec), false);
  await putTasks([rec]);
  await mapPut("task", 10, "a");
  await outboxAdd({ op: "update", entity_type: "task", cid: "a", payload: {} });
  // server lebih lama dari edit lokal → lokal menang (PUT penuh berikutnya membawa penghapusan tag)
  await pullTasks([srv({ id: 10, title: "Server", updated_at: "2026-06-04T02:00:00", ext: {} })]);
  assert.deepEqual(await getTask("a"), rec);
  assert.equal((await outboxAll()).length, 1);
  // server lebih baru → jalur R11 lama (inti server, kunci ext ditempel)
  await pullTasks([srv({ id: 10, title: "Server2", updated_at: "2026-06-04T10:00:00", ext: {} })]);
  const a = await getTask("a");
  assert.equal(a.title, "Server2");
  assert.deepEqual(a.ext, { "demo-ext.a": 1 });
  assert.equal(a.dirty, 1);
  assert.equal((await outboxAll()).length, 1);
});

test("withLocalExt murni: kunci ditempel → ext_only_rev = rec.rev; tanpa kunci → tanpa penanda", () => {
  const out = withLocalExt({ cid: "a", rev: 7, ext: { "abc.a": 2 } },
    { dirty: 1, rev: 6, ext: { "abc.a": 1 }, ext_dirty: ["abc.a"] });
  assert.equal(out[KEY], 7);
  assert.equal(X.extOnlyNow(out), true);
  const none = withLocalExt({ cid: "a", rev: 7, ext: { "abc.a": 2 } }, { dirty: 1, rev: 6, [KEY]: 6, ext: { "abc.a": 1 } });
  assert.equal(KEY in none, false);
  const clean = withLocalExt({ cid: "a", rev: 7 }, { dirty: 0, rev: 6, ext: {}, ext_dirty: ["abc.a"] });
  assert.equal(KEY in clean, false);
});

test("setelah pull R11, push → {ext_patch} saja", async () => {
  const { pushOutbox } = require("../../static/offline/syncpush.js");
  await putTasks([local({
    cid: "a", server_id: 10, title: "Judul lokal", base_rev: "2026-06-01T00:00:00",
    updated_at: "2026-06-04T01:00:00.000Z", dirty: 1, rev: 2, ext: { "demo-ext.a": 1 }, ext_dirty: ["demo-ext.a"],
  })]);
  await mapPut("task", 10, "a");
  await outboxAdd({ op: "update", entity_type: "task", cid: "a", payload: {} });
  const row = srv({ id: 10, title: "Judul server", gtd_status: "done", updated_at: "2026-06-04T05:00:00", ext: {} });
  await pullTasks([row]);
  const calls = [];
  const tr = {
    request(m, p, b) {
      calls.push({ m, p, b });
      return Promise.resolve({ status: 200, data: Object.assign({}, row, { updated_at: "2026-06-04T06:00:00", ext: Object.assign({}, b.ext_patch) }) });
    },
  };
  await pushOutbox(tr);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].m, "PUT");
  assert.deepEqual(calls[0].b, { ext_patch: { "demo-ext.a": 1 } });
  const a = await getTask("a");
  assert.equal(a.title, "Judul server");
  assert.equal(a.dirty, 0);
  assert.equal(KEY in a, false);
  assert.deepEqual(a.ext, { "demo-ext.a": 1 });
  assert.deepEqual(await outboxAll(), []);
});
