"use strict";
// IndexedDB v8 (checklist offline Fase 2, review Task 4–6 PR B2): pagar tab lama. `processOp` aplikasi v502 membuang
// diam-diam entri `_outbox` entitas yang tidak dikenalnya (termasuk `subtasks`). Menaikkan DB_VERSION 7 → 8 (upgrade
// tanpa perubahan skema, data utuh) membuat tab lama yang masih terbuka menerima `versionchange` → menutup koneksinya
// (banner "Alurik diperbarui di tab lain") SEBELUM tab baru bisa membuka DB dan menulis entri `subtasks`; tab lama yang
// dibuka sesudahnya (JS lama v7 pada DB v8) mendapat VersionError — keduanya tidak bisa lagi membaca / membuang antrean.
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { deleteDB } = require("./setup.js");
const TFdb = require("../../static/offline/db.js");
const CR = require("../../static/offline/checklistrepo.js");
const { outboxAll } = require("../../static/offline/outbox.js");

const OFF = path.join(__dirname, "../../static/offline");
const DB_SRC = fs.readFileSync(path.join(OFF, "db.js"), "utf8");
const OUTBOX_SRC = fs.readFileSync(path.join(OFF, "outbox.js"), "utf8");

beforeEach(async () => {
  CR._reset();
  TFdb._reset();
  await deleteDB(TFdb.DB_NAME);
});

const req = (r) => new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
const done = (tx) => new Promise((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); });

// Instans modul "tab lama": db.js + outbox.js jalur browser (root.TF) di konteks vm terpisah, DB_VERSION 7 (kode v502
// identik selain angka versi). Berbagi fake-indexeddb global dengan modul tes (satu "browser", dua tab).
function oldTab() {
  const src = DB_SRC.replace(/const DB_VERSION = \d+;/, "const DB_VERSION = 7;");
  assert.notEqual(src, DB_SRC, "deklarasi DB_VERSION ditemukan");
  const events = [];
  const self = { TF: {}, dispatchEvent: (e) => { events.push(e.type); return true; } };
  const ctx = vm.createContext({ self, indexedDB: globalThis.indexedDB, IDBKeyRange: globalThis.IDBKeyRange, CustomEvent, console });
  vm.runInContext(src, ctx);
  vm.runInContext(OUTBOX_SRC, ctx);
  return { db: self.TF.db, outbox: self.TF.outbox, events };
}

test("DB_VERSION 8; sumber mencatat alasannya (pagar tab lama, checklist offline)", () => {
  assert.equal(TFdb.DB_VERSION, 8);
  assert.match(DB_SRC, /v8 = pagar tab lama/);
});

test("upgrade v7 → v8 mempertahankan seluruh data (antrean, butir, _meta, _idmap, plugin) tanpa perubahan skema", async () => {
  const old = oldTab();
  const db7 = await old.db.openDB();
  assert.equal(db7.version, 7);
  const t = db7.transaction(["tasks", "subtasks", "_outbox", "_meta", "_idmap", "plugin_records"], "readwrite");
  t.objectStore("tasks").put({ cid: "t1", server_id: 7, title: "T" });
  t.objectStore("subtasks").put({ cid: "a", server_id: 11, task_cid: "t1", parent_cid: null, title: "a", is_done: false, sort_order: 0 });
  t.objectStore("_outbox").add({ ts: 1, retries: 0, entity_type: "task", op: "update", cid: "t1", payload: {} });
  t.objectStore("_meta").put({ t1: 3 }, "checklist_revs");
  t.objectStore("_idmap").put({ key: "subtask:11", entity_type: "subtask", server_id: 11, cid: "a" });
  t.objectStore("plugin_records").put({ plugin_id: "p", entity: "e", id: "1", dirty: 0 });
  await done(t);
  const storesBefore = Array.from(db7.objectStoreNames).sort();
  const idxBefore = {};
  const ti = db7.transaction(storesBefore, "readonly");
  for (const n of storesBefore) idxBefore[n] = Array.from(ti.objectStore(n).indexNames).sort();
  db7.close();

  const db = await TFdb.openDB();
  assert.equal(db.version, 8);
  assert.deepEqual(Array.from(db.objectStoreNames).sort(), storesBefore, "tanpa store baru / hilang");
  const ta = db.transaction(storesBefore, "readonly");
  for (const n of storesBefore) assert.deepEqual(Array.from(ta.objectStore(n).indexNames).sort(), idxBefore[n], "indeks " + n);
  assert.equal((await req(ta.objectStore("tasks").get("t1"))).title, "T");
  assert.equal((await req(ta.objectStore("subtasks").get("a"))).server_id, 11);
  assert.deepEqual(await req(ta.objectStore("_meta").get("checklist_revs")), { t1: 3 });
  assert.equal((await req(ta.objectStore("_idmap").get("subtask:11"))).cid, "a");
  assert.equal((await req(ta.objectStore("plugin_records").getAll())).length, 1);
  assert.deepEqual((await outboxAll()).map((o) => [o.entity_type, o.op, o.cid]), [["task", "update", "t1"]]);
});

test("tab lama (v7) terbuka → tab baru membuka v8: tab lama ditutup (DB_UPGRADED_ELSEWHERE) SEBELUM tab baru bisa menulis entri subtasks; antrean tidak bisa lagi dibaca / dibuang tab lama", async () => {
  const old = oldTab();
  const urutan = [];
  old.db.subscribe((ev) => urutan.push("lama:" + ev.type));
  await old.db.openDB();
  // tab baru: buka v8 (versionchange ke tab lama) lalu aksi checklist lokal → entri subtasks
  const db = await TFdb.openDB();
  urutan.push("baru:terbuka");
  assert.equal(db.version, 8);
  const tx = db.transaction("tasks", "readwrite");
  tx.objectStore("tasks").put({ cid: "t1", server_id: 7, title: "T", deleted: false });
  await done(tx);
  await CR.start();
  await CR.create("t1", { title: "Butir offline" });
  urutan.push("baru:entri-subtasks");
  assert.deepEqual(urutan, ["lama:upgraded-elsewhere", "baru:terbuka", "baru:entri-subtasks"]);
  assert.deepEqual(old.events, ["tf:db-upgraded-elsewhere"], "banner 'Alurik diperbarui di tab lain' (dbupgrade.js)");
  const st = old.db.upgradeState(); // objek dari konteks vm lain → bandingkan per field
  assert.deepEqual([st.blocked, st.upgradedElsewhere], [false, true]);
  // push v502 dimulai dengan outboxAll (heal) dan membuang entri lewat outboxRemove → keduanya ditolak
  await assert.rejects(old.outbox.outboxAll(), { code: "DB_UPGRADED_ELSEWHERE" });
  const q = (await outboxAll()).filter((o) => o.entity_type === "subtasks");
  assert.equal(q.length, 1);
  await assert.rejects(old.outbox.outboxRemove(q[0].qid), { code: "DB_UPGRADED_ELSEWHERE" });
  assert.equal((await outboxAll()).filter((o) => o.entity_type === "subtasks").length, 1, "entri subtasks utuh");
});

test("tab lama yang dibuka SESUDAH upgrade (JS v7 pada DB v8) → VersionError; antrean utuh, tab baru tetap berjalan", async () => {
  const db = await TFdb.openDB();
  const tx = db.transaction("_outbox", "readwrite");
  tx.objectStore("_outbox").add({ ts: 1, retries: 0, entity_type: "subtasks", op: "create", cid: "x", task_cid: "t1", payload: { title: "x", parent_cid: null, index: null } });
  await done(tx);
  const old = oldTab();
  await assert.rejects(old.db.openDB(), (e) => e && e.name === "VersionError");
  await assert.rejects(old.outbox.outboxAll(), (e) => e && e.name === "VersionError");
  await assert.rejects(old.outbox.outboxRemove(1), (e) => e && e.name === "VersionError");
  assert.equal((await outboxAll()).length, 1, "antrean utuh");
  assert.equal((await TFdb.openDB()).version, 8);
});
