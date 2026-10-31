"use strict";
// K2 / R12 (spec plugin Fase 1 §4): db.js menangani versionchange dan blocked supaya tab lain tidak
// membuat pembaruan IndexedDB menggantung tanpa pesan (S12 audit 2026-10-15).
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { deleteDB } = require("./setup.js");
const TFdb = require("../../static/offline/db.js");
const { DB_NAME, DB_VERSION, openDB, subscribe, upgradeState, UPGRADED_ELSEWHERE, _reset } = TFdb;

beforeEach(async () => { _reset(); await deleteDB(DB_NAME); });

function rawOpen(version, opts) {
  const o = opts || {};
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, version);
    req.onupgradeneeded = (e) => { if (o.upgrade) o.upgrade(e.target.result); };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = () => reject(req.error);
    if (o.onblocked) req.onblocked = o.onblocked;
  });
}

function collect() {
  const events = [];
  const off = subscribe((ev) => events.push(ev.type));
  return { events, off };
}

const tick = (ms) => new Promise((r) => setTimeout(r, ms || 0));

test("DB_VERSION tetap 6 dan kode penolakan diekspor", () => {
  assert.equal(DB_VERSION, 6);
  assert.equal(UPGRADED_ELSEWHERE, "DB_UPGRADED_ELSEWHERE");
  assert.equal(typeof subscribe, "function");
  assert.deepEqual(upgradeState(), { blocked: false, upgradedElsewhere: false });
});

test("koneksi modul menerima versionchange (open mentah v7) → koneksi ditutup, open mentah sukses, openDB berikutnya reject DB_UPGRADED_ELSEWHERE, event upgraded-elsewhere sekali", async () => {
  const { events, off } = collect();
  await openDB();
  let rawBlocked = false;
  const raw = await rawOpen(DB_VERSION + 1, { onblocked: () => { rawBlocked = true; } });
  assert.equal(raw.version, DB_VERSION + 1);
  assert.equal(rawBlocked, false, "koneksi modul harus menutup diri, bukan menahan upgrade");
  await assert.rejects(openDB(), (err) => err.message === "DB_UPGRADED_ELSEWHERE" && err.code === "DB_UPGRADED_ELSEWHERE");
  await assert.rejects(openDB(), { code: "DB_UPGRADED_ELSEWHERE" });
  assert.deepEqual(upgradeState(), { blocked: false, upgradedElsewhere: true });
  assert.deepEqual(events, ["upgraded-elsewhere"]);
  raw.close();
  off();
});

test("deleteDatabase (newVersion null) → openDB berikutnya membuka DB baru (bukan reject)", async () => {
  const { events, off } = collect();
  await openDB();
  let blocked = false;
  await new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => { blocked = true; };
  });
  assert.equal(blocked, false, "koneksi modul menutup diri saat DB dihapus");
  const db = await openDB();
  assert.equal(db.version, DB_VERSION);
  assert.ok(db.objectStoreNames.contains("tasks"));
  assert.deepEqual(upgradeState(), { blocked: false, upgradedElsewhere: false });
  assert.deepEqual(events, []);
  off();
});

test("koneksi mentah v5 tanpa handler menahan upgrade → event blocked; koneksi ditutup → openDB resolve + event unblocked", async () => {
  const { events, off } = collect();
  const old = await rawOpen(DB_VERSION - 1); // tab lama tanpa onversionchange
  let resolved = false;
  const p = openDB().then((db) => { resolved = true; return db; });
  for (let i = 0; i < 20 && !events.includes("blocked"); i++) await tick(5);
  assert.deepEqual(events, ["blocked"]);
  assert.equal(upgradeState().blocked, true);
  assert.equal(resolved, false, "upgrade menunggu tab lama");
  old.close();
  const db = await p;
  assert.equal(db.version, DB_VERSION);
  assert.deepEqual(events, ["blocked", "unblocked"]);
  assert.deepEqual(upgradeState(), { blocked: false, upgradedElsewhere: false });
  off();
});

test("subscribe mengembalikan fungsi berhenti; pelanggan yang melempar tidak menghentikan yang lain", async () => {
  const seen = [];
  const offBad = subscribe(() => { throw new Error("boom"); });
  const offA = subscribe((ev) => seen.push("a:" + ev.type));
  const offB = subscribe((ev) => seen.push("b:" + ev.type));
  offB();
  await openDB();
  const raw = await rawOpen(DB_VERSION + 1);
  assert.deepEqual(seen, ["a:upgraded-elsewhere"]);
  raw.close();
  offA(); offBad();
});

test("_reset mengosongkan upgradeState", async () => {
  await openDB();
  const raw = await rawOpen(DB_VERSION + 1);
  assert.equal(upgradeState().upgradedElsewhere, true);
  raw.close();
  _reset();
  assert.deepEqual(upgradeState(), { blocked: false, upgradedElsewhere: false });
});

test("upgradeState mengembalikan salinan (tidak bisa diubah dari luar)", () => {
  const s = upgradeState();
  s.blocked = true;
  assert.equal(upgradeState().blocked, false);
});

test("browser: event window tf:db-* dipancarkan bila dispatchEvent tersedia", async () => {
  const names = [];
  const origDispatch = globalThis.dispatchEvent;
  globalThis.dispatchEvent = (ev) => { names.push(ev.type); return true; };
  try {
    await openDB();
    const raw = await rawOpen(DB_VERSION + 1);
    assert.deepEqual(names, ["tf:db-upgraded-elsewhere"]);
    raw.close();
  } finally {
    if (origDispatch === undefined) delete globalThis.dispatchEvent; else globalThis.dispatchEvent = origDispatch;
  }
});

test("sumber: komentar larangan menurunkan DB_VERSION", () => {
  const src = require("node:fs").readFileSync(require("node:path").join(__dirname, "../../static/offline/db.js"), "utf8");
  assert.match(src, /jangan pernah diturunkan/i);
});
