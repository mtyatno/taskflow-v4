"use strict";
// PR 1c-0b (K48, rencana R5): tarik task memakai waktu inti server (`core_updated_at`) untuk record dengan edit
// INTI tertunda. (1) inti server tidak berubah sejak base_rev (perbandingan cap waktu server saja, mikrodetik) →
// inti lokal menang tanpa jam perangkat; (2) selain itu LWW lama dengan waktu inti di sisi server; server tanpa
// field → aturan lama. Q1 pemilik = (a): hapus lokal tertunda tetap menang atas perubahan ext saja.
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { deleteDB } = require("./setup.js");
const { DB_NAME, _reset, openDB } = require("../../static/offline/db.js");
const { mapPut, cidOf } = require("../../static/offline/idmap.js");
const SPULL = require("../../static/offline/syncpull.js");
const { pullTasks } = SPULL;
const SP = require("../../static/offline/syncpush.js");
const { outboxAll } = require("../../static/offline/outbox.js");
const repo = require("../../static/offline/taskrepo.js");
const X = require("../../static/offline/taskext.js");

beforeEach(async () => { _reset(); await deleteDB(DB_NAME); });

const TODAY = { today: "2026-11-01" };
const EXT_A = "demo-ext.a";
const EXT_B = "demo-ext.b";

// salinan kecil dari tests/offline/taskext_writers_fence.test.js (tidak diekspor; require akan menjalankan tesnya)
function stripComments(src) {
  let out = "";
  let i = 0;
  const n = src.length;
  let prev = ""; // karakter bermakna terakhir (untuk membedakan `/` pembagi vs regex)
  const regexAllowed = () => prev === "" || "(,=:[!&|?{};+-*%<>~^".indexOf(prev) >= 0
    || /\b(return|typeof|case|in|of|delete|void|throw|new)$/.test(out.replace(/\s+$/, "").slice(-8));
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === "/" && d === "*") {
      const e = src.indexOf("*/", i + 2);
      const end = e < 0 ? n : e + 2;
      out += src.slice(i, end).replace(/[^\n]/g, " ");
      i = end;
      continue;
    }
    if (c === "/" && d === "/") {
      let e = src.indexOf("\n", i);
      if (e < 0) e = n;
      out += " ".repeat(e - i);
      i = e;
      continue;
    }
    if (c === "\"" || c === "'") {
      let j = i + 1;
      while (j < n && src[j] !== c && src[j] !== "\n") { if (src[j] === "\\") j++; j++; }
      j = Math.min(j + 1, n);
      out += src.slice(i, j);
      prev = c;
      i = j;
      continue;
    }
    if (c === "`") {
      let j = i + 1;
      while (j < n && src[j] !== "`") { if (src[j] === "\\") j++; j++; }
      j = Math.min(j + 1, n);
      out += src.slice(i, j);
      prev = c;
      i = j;
      continue;
    }
    if (c === "/" && regexAllowed()) {
      let j = i + 1;
      let cls = false;
      while (j < n && src[j] !== "\n") {
        if (src[j] === "\\") j++;
        else if (src[j] === "[") cls = true;
        else if (src[j] === "]") cls = false;
        else if (src[j] === "/" && !cls) break;
        j++;
      }
      if (src[j] === "/") {
        j++;
        while (/[a-z]/.test(src[j] || "")) j++;
        out += src.slice(i, j);
        prev = ")";
        i = j;
        continue;
      }
    }
    out += c;
    if (!/\s/.test(c)) prev = c;
    i++;
  }
  return out;
}

// cap waktu server naif (presisi mikrodetik, seperti datetime.now().isoformat()); edit lokal = jam perangkat (Z)
const T0 = "2026-11-01T10:00:00.123456"; // base_rev record
const LOCAL = "2026-11-01T10:10:00.000Z"; // edit inti lokal
const T2 = "2026-11-01T10:20:00.654321"; // updated_at server setelah PUT ext saja anggota lain (lebih baru dari LOCAL)

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
function srv(over) {
  return Object.assign({
    id: over.id, title: "Awal", description: "", gtd_status: "next", priority: "P3", quadrant: "Q4",
    project: "", context: "", deadline: null, waiting_for: "", completed_at: null, progress: 0,
    is_focused: 0, assigned_to: null, parent_id: null, list_id: null,
    recurrence_type: null, recurrence_days: null, recurrence_end_date: null, recurrence_notif_level: null,
    created_at: "2026-06-01T00:00:00", updated_at: T0,
  }, over);
}
function noCore(d) { const c = Object.assign({}, d); delete c.core_updated_at; return c; }
// record bersih hasil tarik (base_rev = updated_at server)
async function seedClean(id, over) {
  await pullTasks([srv(Object.assign({ id, updated_at: T0, core_updated_at: T0 }, over || {}))]);
  const cid = await cidOf("task", id);
  assert.ok(cid);
  const rec = await getTask(cid);
  assert.equal(rec.dirty, 0);
  assert.equal(rec.base_rev, (over && over.updated_at) || T0);
  return cid;
}
const taskOps = async (cid) => (await outboxAll()).filter((o) => o.entity_type === "task" && o.cid === cid);

// ── fungsi murni ────────────────────────────────────────────────────────────────────────────────────────────

test("coreUnchangedSince: vektor", () => {
  const { coreUnchangedSince: U, serverCoreAt } = SPULL;
  assert.equal(typeof U, "function");
  assert.equal(typeof serverCoreAt, "function");
  const c = (v) => ({ core_updated_at: v, updated_at: "2026-11-01T11:00:00" });
  // sama / lebih tua → true
  assert.equal(U(c("2026-11-01T10:00:00.123456"), "2026-11-01T10:00:00.123456"), true);
  assert.equal(U(c("2026-11-01T09:59:59.999999"), "2026-11-01T10:00:00.123456"), true);
  // mikrodetik
  assert.equal(U(c("2026-11-01T10:00:00.123457"), "2026-11-01T10:00:00.123456"), false);
  assert.equal(U(c("2026-11-01T10:00:00.123456"), "2026-11-01T10:00:00.123457"), true);
  // tanpa pecahan vs dengan pecahan
  assert.equal(U(c("2026-11-01T10:00:00"), "2026-11-01T10:00:00.000001"), true);
  assert.equal(U(c("2026-11-01T10:00:00.000001"), "2026-11-01T10:00:00"), false);
  assert.equal(U(c("2026-11-01T10:00:00.5"), "2026-11-01T10:00:00.500000"), true);
  // spasi SQLite
  assert.equal(U(c("2026-11-01 10:00:00"), "2026-11-01T10:00:00"), true);
  assert.equal(U(c("2026-11-01 10:00:00.123457"), "2026-11-01T10:00:00.123456"), false);
  assert.equal(U(c("2026-11-01T10:00:00.123456"), "2026-11-01 10:00:00.123456"), true);
  assert.equal(U(c("2026-11-01 10:00:01"), "2026-11-01 10:00:00.999999"), false);
  // core_updated_at hilang / "" / angka / null / tak terbaca → false
  assert.equal(U({ updated_at: "2026-11-01T09:00:00" }, "2026-11-01T10:00:00"), false);
  assert.equal(U(c(""), "2026-11-01T10:00:00"), false);
  assert.equal(U(c(1793527200000), "2026-11-01T10:00:00"), false);
  assert.equal(U(c(null), "2026-11-01T10:00:00"), false);
  assert.equal(U(c("bukan waktu"), "2026-11-01T10:00:00"), false);
  // baseRev null / "" / tak terbaca → false
  assert.equal(U(c("2026-11-01T09:00:00"), null), false);
  assert.equal(U(c("2026-11-01T09:00:00"), undefined), false);
  assert.equal(U(c("2026-11-01T09:00:00"), ""), false);
  assert.equal(U(c("2026-11-01T09:00:00"), "bukan waktu"), false);
  assert.equal(U(null, "2026-11-01T10:00:00"), false);
  // serverCoreAt: hanya string tak kosong
  assert.equal(serverCoreAt(c("2026-11-01T10:00:00")), "2026-11-01T10:00:00");
  assert.equal(serverCoreAt(c("")), null);
  assert.equal(serverCoreAt(c(5)), null);
  assert.equal(serverCoreAt(c(null)), null);
  assert.equal(serverCoreAt({ updated_at: "2026-11-01T10:00:00" }), null);
  assert.equal(serverCoreAt(null), null);
  assert.equal(serverCoreAt(undefined), null);
});

// ── aturan (1) ──────────────────────────────────────────────────────────────────────────────────────────────

test("R2: inti lokal tertunda + server hanya berubah ext (core = base_rev) → lokal menang", async () => {
  const cid = await seedClean(10);
  await repo.updateTask(cid, { title: "Judul A" }, Object.assign({ now: LOCAL }, TODAY));
  const r = await pullTasks([srv({ id: 10, updated_at: T2, core_updated_at: T0, ext: { [EXT_B]: 1 } })]);
  const rec = await getTask(cid);
  assert.equal(rec.title, "Judul A");
  assert.equal(rec.dirty, 1);
  assert.equal(rec.base_rev, T0, "base_rev tidak maju: push membawanya");
  const ops = await taskOps(cid);
  assert.equal(ops.length, 1);
  assert.equal(ops[0].op, "update");
  assert.equal(r.lwwResolved, 1);
  assert.equal(r.coreKept, 1);
  assert.equal(r.updated, 0);
});

test("kontrol: dict yang sama TANPA core_updated_at → server menang (aturan lama, bug terreproduksi)", async () => {
  const cid = await seedClean(10);
  await repo.updateTask(cid, { title: "Judul A" }, Object.assign({ now: LOCAL }, TODAY));
  const r = await pullTasks([noCore(srv({ id: 10, updated_at: T2, core_updated_at: T0, ext: { [EXT_B]: 1 } }))]);
  const rec = await getTask(cid);
  assert.equal(rec.title, "Awal");
  assert.equal(rec.dirty, 0);
  assert.equal((await taskOps(cid)).length, 0);
  assert.equal(r.lwwResolved, 1);
  assert.equal(r.coreKept, 0);
  assert.equal(r.updated, 1);
});

test("hasil tarik selalu memuat coreKept (0 bila tidak ada konflik)", async () => {
  const r = await pullTasks([srv({ id: 10 })]);
  assert.equal(r.coreKept, 0);
});

// ── aturan (2) ──────────────────────────────────────────────────────────────────────────────────────────────

test("inti server berubah setelah base_rev dan lebih baru dari edit lokal → server menang", async () => {
  const cid = await seedClean(10);
  await repo.updateTask(cid, { title: "Judul A" }, Object.assign({ now: LOCAL }, TODAY));
  const r = await pullTasks([srv({ id: 10, title: "Judul B", updated_at: "2026-11-01T10:30:00.000001", core_updated_at: "2026-11-01T10:20:00.000001" })]);
  const rec = await getTask(cid);
  assert.equal(rec.title, "Judul B");
  assert.equal(rec.dirty, 0);
  assert.equal((await taskOps(cid)).length, 0);
  assert.deepEqual([r.lwwResolved, r.coreKept, r.updated], [1, 0, 1]);
});

test("inti server berubah setelah base_rev, LEBIH TUA dari edit lokal, updated_at lebih baru (seret sesudahnya) → lokal menang lewat aturan (2)", async () => {
  const cid = await seedClean(10);
  await repo.updateTask(cid, { title: "Judul A" }, Object.assign({ now: LOCAL }, TODAY));
  const r = await pullTasks([srv({ id: 10, title: "Judul B", updated_at: T2, core_updated_at: "2026-11-01T10:05:00.000001" })]);
  const rec = await getTask(cid);
  assert.equal(rec.title, "Judul A");
  assert.equal(rec.dirty, 1);
  assert.equal((await taskOps(cid)).length, 1);
  assert.deepEqual([r.lwwResolved, r.coreKept, r.updated], [1, 0, 0], "bukan aturan (1): inti server memang berubah");
});

test("... aturan lama dengan updated_at akan memenangkan server (pembanding kasus seret sesudahnya)", async () => {
  const cid = await seedClean(10);
  await repo.updateTask(cid, { title: "Judul A" }, Object.assign({ now: LOCAL }, TODAY));
  const r = await pullTasks([noCore(srv({ id: 10, title: "Judul B", updated_at: T2, core_updated_at: "2026-11-01T10:05:00.000001" }))]);
  const rec = await getTask(cid);
  assert.equal(rec.title, "Judul B");
  assert.equal(rec.dirty, 0);
  assert.deepEqual([r.lwwResolved, r.coreKept, r.updated], [1, 0, 1]);
});

test("core_updated_at tak terbaca → aturan (2) memakai fallback updated_at (setara aturan lama)", async () => {
  const cid = await seedClean(10);
  await repo.updateTask(cid, { title: "Judul A" }, Object.assign({ now: LOCAL }, TODAY));
  const r = await pullTasks([srv({ id: 10, updated_at: T2, core_updated_at: "" })]);
  assert.equal((await getTask(cid)).title, "Awal");
  assert.deepEqual([r.lwwResolved, r.coreKept, r.updated], [1, 0, 1]);
});

test("core_updated_at tak terbaca (\"bukan waktu\") → aturan lama pada s.updated_at (aturan 1 dan 2)", async () => {
  // updated_at server lebih baru dari edit lokal → server menang (bukan lokal menang selamanya)
  const cid = await seedClean(10);
  await repo.updateTask(cid, { title: "Judul A" }, Object.assign({ now: LOCAL }, TODAY));
  assert.equal(SPULL.coreUnchangedSince(srv({ id: 10, core_updated_at: "bukan waktu" }), T0), false);
  const r = await pullTasks([srv({ id: 10, title: "Server", updated_at: T2, core_updated_at: "bukan waktu" })]);
  const rec = await getTask(cid);
  assert.equal(rec.title, "Server");
  assert.equal(rec.dirty, 0);
  assert.equal((await taskOps(cid)).length, 0);
  assert.deepEqual([r.lwwResolved, r.coreKept, r.updated], [1, 0, 1]);
  // updated_at server lebih tua dari edit lokal → lokal menang (sama seperti aturan lama)
  const cid2 = await seedClean(11);
  await repo.updateTask(cid2, { title: "Judul A2" }, Object.assign({ now: "2026-11-01T10:40:00.000Z" }, TODAY));
  const r2 = await pullTasks([srv({ id: 11, title: "Server", updated_at: "2026-11-01T10:30:00.000001", core_updated_at: "bukan waktu" })]);
  const rec2 = await getTask(cid2);
  assert.equal(rec2.title, "Judul A2");
  assert.equal(rec2.dirty, 1);
  assert.deepEqual([r2.lwwResolved, r2.coreKept, r2.updated], [1, 0, 0]);
});

// ── field inti lain + hapus (Q1 a) ─────────────────────────────────────────────────────────────────────────

for (const [name, patch, field, want] of [
  ["status selesai", { gtd_status: "done" }, "gtd_status", "done"],
  ["progress", { progress: 40 }, "progress", 40],
  ["assigned_to", { assigned_to: 7 }, "assigned_to", 7],
  ["deadline", { deadline: "2026-11-20" }, "deadline", "2026-11-20"],
]) {
  test("status selesai / progress / assigned_to / deadline lokal tertunda + server ext saja → lokal menang: " + name, async () => {
    const cid = await seedClean(10);
    await repo.updateTask(cid, patch, Object.assign({ now: LOCAL }, TODAY));
    const r = await pullTasks([srv({ id: 10, updated_at: T2, core_updated_at: T0, ext: { [EXT_B]: 1 } })]);
    const rec = await getTask(cid);
    assert.deepEqual(rec[field], want);
    assert.equal(rec.dirty, 1);
    assert.equal((await taskOps(cid)).length, 1);
    assert.deepEqual([r.lwwResolved, r.coreKept, r.updated], [1, 1, 0]);
  });
}

test("hapus lokal tertunda + server ext saja → op delete tetap, record deleted tetap (Q1 a)", async () => {
  const cid = await seedClean(10);
  await repo.deleteTask(cid, { now: LOCAL });
  const r = await pullTasks([srv({ id: 10, updated_at: T2, core_updated_at: T0, ext: { [EXT_B]: 1 } })]);
  const rec = await getTask(cid);
  assert.equal(rec.deleted, true);
  assert.equal(rec.dirty, 1);
  const ops = await taskOps(cid);
  assert.equal(ops.length, 1);
  assert.equal(ops[0].op, "delete");
  assert.deepEqual([r.lwwResolved, r.coreKept, r.updated], [1, 1, 0]);
});

test("kontrol hapus: tanpa core_updated_at → task hidup lagi (aturan lama)", async () => {
  const cid = await seedClean(10);
  await repo.deleteTask(cid, { now: LOCAL });
  await pullTasks([noCore(srv({ id: 10, updated_at: T2, core_updated_at: T0 }))]);
  const rec = await getTask(cid);
  assert.equal(rec.deleted, false);
  assert.equal((await taskOps(cid)).length, 0);
});

// ── jalur yang tidak berubah ────────────────────────────────────────────────────────────────────────────────

test("record ext saja (penanda sah) + core = base → jalur R7 1c-0 (inti server, ext ditempel, op diantre ulang)", async () => {
  const cid = await seedClean(10);
  await repo.updateTask(cid, { ext_patch: { [EXT_A]: 1 } }, Object.assign({ now: LOCAL }, TODAY));
  assert.equal(X.extOnlyNow(await getTask(cid)), true);
  const r = await pullTasks([srv({ id: 10, title: "Server", updated_at: T2, core_updated_at: T0, ext: { [EXT_B]: 2 } })]);
  const rec = await getTask(cid);
  assert.equal(rec.title, "Server", "inti server menang untuk record ext saja");
  assert.deepEqual(rec.ext, { [EXT_B]: 2, [EXT_A]: 1 });
  assert.equal(rec.dirty, 1);
  assert.equal(rec.base_rev, T2);
  assert.equal((await taskOps(cid)).length, 1);
  assert.deepEqual([r.lwwResolved, r.coreKept, r.updated, r.extKept], [1, 0, 1, 1]);
});

test("daftar basi (s.updated_at < base_rev, core < base_rev) untuk record berinti tertunda → lokal menang", async () => {
  const BASE = "2026-11-01T10:30:00.000001";
  const cid = await seedClean(10, { updated_at: BASE, core_updated_at: BASE });
  // jam perangkat tertinggal (S9): edit lokal tampak lebih tua dari daftar basi
  await repo.updateTask(cid, { title: "Judul A" }, Object.assign({ now: "2026-11-01T10:05:00.000Z" }, TODAY));
  const r = await pullTasks([srv({ id: 10, title: "Lama", updated_at: "2026-11-01T10:20:00.000001", core_updated_at: "2026-11-01T10:00:00.000001" })]);
  const rec = await getTask(cid);
  assert.equal(rec.title, "Judul A");
  assert.equal(rec.dirty, 1);
  assert.equal(rec.base_rev, BASE, "base_rev tidak mundur");
  assert.equal((await taskOps(cid)).length, 1);
  assert.deepEqual([r.lwwResolved, r.coreKept, r.updated], [1, 1, 0]);
});

test("sync_error / conflict / base_rev null → tidak berubah", async () => {
  const base = { server_id: null, title: "Lokal", gtd_status: "next", deleted: false, dirty: 1, rev: 2, updated_at: LOCAL };
  await putTasks([
    Object.assign({}, base, { cid: "e", server_id: 21, base_rev: T0, sync_error: "boom" }),
    Object.assign({}, base, { cid: "c", server_id: 22, base_rev: T0, conflict: "x" }),
    Object.assign({}, base, { cid: "n", server_id: 23, base_rev: null }),
  ]);
  await mapPut("task", 21, "e"); await mapPut("task", 22, "c"); await mapPut("task", 23, "n");
  const db = await openDB();
  await new Promise((res, rej) => {
    const tx = db.transaction("_outbox", "readwrite");
    for (const cid of ["e", "c", "n"]) tx.objectStore("_outbox").add({ op: "update", entity_type: "task", cid, payload: {}, ts: 1 });
    tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error);
  });
  const before = {};
  for (const cid of ["e", "c", "n"]) before[cid] = await getTask(cid);
  const r = await pullTasks([21, 22, 23].map((id) => srv({ id, updated_at: T2, core_updated_at: T0 })));
  for (const cid of ["e", "c", "n"]) {
    assert.deepEqual(await getTask(cid), before[cid], cid);
    assert.equal((await taskOps(cid)).length, 1, cid);
  }
  assert.deepEqual([r.lwwResolved, r.coreKept, r.updated, r.skipped], [0, 0, 0, 3]);
});

// ── alur dua perangkat (server palsu dengan semantik K45/K46) ───────────────────────────────────────────────

const FULL_KEYS = [
  "title", "description", "priority", "project", "context", "deadline", "gtd_status", "waiting_for", "assigned_to",
  "progress", "is_focused", "recurrence_type", "recurrence_days", "estimated_pomodoros",
];
const PAYLOAD_KEYS = FULL_KEYS.concat(["context_id"]);
const CORE_KEYS = [
  "title", "description", "gtd_status", "priority", "project", "project_id", "context", "context_id", "deadline",
  "waiting_for", "progress", "is_focused", "assigned_to", "recurrence_type", "recurrence_days", "estimated_pomodoros",
];

// versi JS task_ext.core_at_of / apply_core_at (Task 1)
function applyCoreAt(row) {
  const frozen = row.ext_only_at != null && row.ext_only_at === row.updated_at && !!row.ext_core_at;
  return frozen ? row.ext_core_at : row.updated_at;
}

function fakeServer() {
  const rows = new Map();
  const calls = [];
  let tick = 0;
  // naif, bermikrodetik, semua LEBIH BARU dari edit lokal A (jam perangkat 09:30Z)
  const ts = () => { tick++; return "2026-11-01T10:00:" + String(tick).padStart(2, "0") + "." + String(tick * 7).padStart(6, "0"); };
  const s = {
    calls, rows,
    seed(id, core, ext) {
      rows.set(id, {
        id, ext: Object.assign({}, ext || {}), updated_at: "2026-11-01T09:00:00.000001", ext_core_at: null, ext_only_at: null,
        core: Object.assign({
          title: "Awal", description: "", gtd_status: "next", priority: "P3", quadrant: "Q4", project: "", context: "",
          deadline: null, waiting_for: "", completed_at: null, progress: 0, is_focused: 0, assigned_to: null,
          recurrence_type: null, recurrence_days: null, recurrence_end_date: null, recurrence_notif_level: null,
          estimated_pomodoros: 1, pomodoros_done: 0,
        }, core || {}),
      });
    },
    dict(row) {
      return Object.assign({ created_at: "2026-06-01T00:00:00", parent_id: null, list_id: null }, row.core,
        { id: row.id, updated_at: row.updated_at, core_updated_at: applyCoreAt(row), ext: Object.assign({}, row.ext) });
    },
    list() { return Array.from(rows.values()).map((r) => s.dict(r)); },
    request(method, p, body) {
      calls.push({ method, path: p, body: JSON.parse(JSON.stringify(body || {})) });
      const m = /^\/api\/tasks\/(\d+)$/.exec(p);
      if (method === "PUT" && m) {
        const row = rows.get(Number(m[1]));
        if (!row) return Promise.resolve({ status: 404, data: {} });
        const b = body || {};
        let touched = false;
        for (const k of CORE_KEYS) {
          if (k in b) {
            touched = true;
            row.core[k] = k === "recurrence_days" && Array.isArray(b[k]) ? JSON.stringify(b[k])
              : k === "is_focused" ? (b[k] ? 1 : 0) : (k === "deadline" && b[k] === "" ? null : b[k]);
          }
        }
        if (b.ext_patch) row.ext = X.applyPatch(row.ext, b.ext_patch);
        const now = ts();
        if (!touched && b.ext_patch) { // K46: PUT ext murni → bekukan dari baris terkini
          row.ext_core_at = applyCoreAt(row);
          row.ext_only_at = now;
        }
        row.updated_at = now; // PUT inti: kolom tidak disentuh → ikatan putus (K45)
        return Promise.resolve({ status: 200, data: s.dict(row) });
      }
      return Promise.resolve({ status: 404, data: {} });
    },
  };
  s.transport = { request: (mt, p, b) => s.request(mt, p, b) };
  return s;
}
const drain = (s) => SP.pushOutbox(s.transport, { tagsFor: () => Promise.resolve([]) });

async function twoDevice(withExtA) {
  const S = fakeServer();
  S.seed(1);
  await pullTasks(S.list()); // A sinkron
  const cid = await cidOf("task", 1);
  const A_NOW = { now: "2026-11-01T09:30:00.000Z", today: "2026-11-01" };
  await repo.updateTask(cid, { title: "Judul A" }, A_NOW); // A offline
  if (withExtA) await repo.updateTask(cid, { ext_patch: { [EXT_A]: "a" } }, A_NOW);
  // B online: dua kali seret bar (PUT ext murni)
  await S.request("PUT", "/api/tasks/1", { ext_patch: { [EXT_B]: "b1" } });
  await S.request("PUT", "/api/tasks/1", { ext_patch: { [EXT_B]: "b2" } });
  const row = S.rows.get(1);
  assert.equal(applyCoreAt(row), "2026-11-01T09:00:00.000001", "waktu inti server beku");
  S.calls.length = 0;
  // A online: tarik dulu, lalu dorong
  const r = await pullTasks(S.list());
  assert.equal(r.coreKept, 1);
  assert.equal((await getTask(cid)).title, "Judul A");
  await drain(S);
  return { S, cid, row };
}

test("A offline judul; B PUT {ext_patch}; A pull→push → judul A di server, ext B utuh, A mengadopsi ext B", async () => {
  const { S, cid, row } = await twoDevice(false);
  const puts = S.calls.filter((c) => c.method === "PUT");
  assert.equal(puts.length, 1);
  assert.deepEqual(Object.keys(puts[0].body), PAYLOAD_KEYS, "PUT penuh tanpa ext_patch");
  assert.equal(puts[0].body.title, "Judul A");
  assert.equal(row.core.title, "Judul A");
  assert.deepEqual(row.ext, { [EXT_B]: "b2" });
  assert.equal(applyCoreAt(row), row.updated_at, "PUT inti A memutus pembekuan");
  const rec = await getTask(cid);
  assert.equal(rec.dirty, 0);
  assert.equal(rec.title, "Judul A");
  assert.deepEqual(rec.ext, { [EXT_B]: "b2" });
  assert.equal(rec.base_rev, row.updated_at);
  assert.equal((await outboxAll()).length, 0);
});

test("varian: A juga punya ext_dirty kunci lain → PUT penuh + ext_patch kunci A saja, ext server = gabungan", async () => {
  const { S, cid, row } = await twoDevice(true);
  const puts = S.calls.filter((c) => c.method === "PUT");
  assert.equal(puts.length, 1);
  assert.deepEqual(Object.keys(puts[0].body), PAYLOAD_KEYS.concat(["ext_patch"]));
  assert.equal(puts[0].body.title, "Judul A");
  assert.deepEqual(puts[0].body.ext_patch, { [EXT_A]: "a" });
  assert.equal(row.core.title, "Judul A");
  assert.deepEqual(row.ext, { [EXT_B]: "b2", [EXT_A]: "a" });
  const rec = await getTask(cid);
  assert.equal(rec.dirty, 0);
  assert.deepEqual(rec.ext, { [EXT_B]: "b2", [EXT_A]: "a" });
  assert.equal(rec.base_rev, row.updated_at);
  assert.equal((await outboxAll()).length, 0);
});

// ── pagar ───────────────────────────────────────────────────────────────────────────────────────────────────

test("pagar: core_updated_at hanya dibaca syncpull.js (di dalam serverCoreAt)", () => {
  const STATIC = path.join(__dirname, "..", "..", "static");
  const OFFLINE = path.join(STATIC, "offline");
  const files = fs.readdirSync(OFFLINE).filter((f) => f.endsWith(".js"));
  assert.ok(files.length > 50);
  for (const f of files) {
    if (f === "syncpull.js") continue;
    const src = stripComments(fs.readFileSync(path.join(OFFLINE, f), "utf8"));
    assert.equal(src.indexOf("core_updated_at"), -1, "core_updated_at muncul di static/offline/" + f);
  }
  assert.equal(fs.readFileSync(path.join(STATIC, "index.html"), "utf8").indexOf("core_updated_at"), -1, "index.html");
  const sp = stripComments(fs.readFileSync(path.join(OFFLINE, "syncpull.js"), "utf8"));
  const start = sp.indexOf("function serverCoreAt(");
  assert.ok(start >= 0, "serverCoreAt ada");
  const end = sp.indexOf("\n  }\n", start);
  assert.ok(end > start);
  const inside = sp.slice(start, end);
  const all = sp.split("core_updated_at").length - 1;
  const inner = inside.split("core_updated_at").length - 1;
  assert.ok(inner >= 1, "serverCoreAt membaca core_updated_at");
  assert.equal(all, inner, "core_updated_at di luar serverCoreAt");
});
