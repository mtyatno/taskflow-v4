"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const wn = require("../../static/offline/whatsnew.js");
const E = (n, extra) => ({ version: `taskflow-v${n}-x`, date: "2026-10-23", title: `R${n}`, new: [`Poin ${n}.`], ...extra });
const ENTRIES = [E(466), E(465, { silent: true, title: undefined, new: undefined }), E(464), E(462), E(460)];

test("versionNumber", () => {
  assert.equal(wn.versionNumber("taskflow-v466-apa"), 466);
  assert.equal(wn.versionNumber("dev"), null);
  assert.equal(wn.versionNumber(null), null);
});
test("pickUnseen: rilis terlewat digabung, silent dibuang, urut menurun", () => {
  const r = wn.pickUnseen({ entries: ENTRIES, current: "taskflow-v466-x", seen: "taskflow-v460-x", hadUser: true });
  assert.deepEqual(r.entries.map(e => e.version), ["taskflow-v466-x", "taskflow-v464-x", "taskflow-v462-x"]);
  assert.equal(r.hiddenCount, 0);
});
test("pickUnseen: seen = current → kosong", () => {
  assert.equal(wn.pickUnseen({ entries: ENTRIES, current: "taskflow-v466-x", seen: "taskflow-v466-x", hadUser: true }).entries.length, 0);
});
test("pickUnseen: tanpa penanda + hadUser → hanya entri versi sekarang", () => {
  const r = wn.pickUnseen({ entries: ENTRIES, current: "taskflow-v466-x", seen: null, hadUser: true });
  assert.deepEqual(r.entries.map(e => e.version), ["taskflow-v466-x"]);
});
test("pickUnseen: tanpa penanda + perangkat baru → kosong", () => {
  assert.equal(wn.pickUnseen({ entries: ENTRIES, current: "taskflow-v466-x", seen: null, hadUser: false }).entries.length, 0);
});
test("pickUnseen: penanda rusak diperlakukan seperti kosong", () => {
  assert.deepEqual(wn.pickUnseen({ entries: ENTRIES, current: "taskflow-v466-x", seen: "zzz", hadUser: true }).entries.map(e => e.version), ["taskflow-v466-x"]);
});
test("pickUnseen: rollback (seen > current) → kosong; current tak terbaca → kosong", () => {
  assert.equal(wn.pickUnseen({ entries: ENTRIES, current: "taskflow-v464-x", seen: "taskflow-v466-x", hadUser: true }).entries.length, 0);
  assert.equal(wn.pickUnseen({ entries: ENTRIES, current: "dev", seen: "taskflow-v400-x", hadUser: true }).entries.length, 0);
});
test("pickUnseen: maksimal limit, sisanya hiddenCount", () => {
  const many = Array.from({ length: 13 }, (_, i) => E(500 - i));
  const r = wn.pickUnseen({ entries: many, current: "taskflow-v500-x", seen: "taskflow-v400-x", hadUser: true });
  assert.equal(r.entries.length, 10); assert.equal(r.hiddenCount, 3);
});
test("history: non-silent ≤ current, menurun, maksimal 10", () => {
  assert.deepEqual(wn.history({ entries: ENTRIES, current: "taskflow-v464-x" }).map(e => e.version), ["taskflow-v464-x", "taskflow-v462-x", "taskflow-v460-x"]);
});
test("shouldMarkSeen tidak pernah menurunkan penanda", () => {
  assert.equal(wn.shouldMarkSeen(null, "taskflow-v466-x"), true);
  assert.equal(wn.shouldMarkSeen("taskflow-v465-x", "taskflow-v466-x"), true);
  assert.equal(wn.shouldMarkSeen("taskflow-v466-x", "taskflow-v466-x"), false);
  assert.equal(wn.shouldMarkSeen("taskflow-v467-x", "taskflow-v466-x"), false);
  assert.equal(wn.shouldMarkSeen("rusak", "taskflow-v466-x"), true);
});
test("formatDate", () => {
  assert.equal(wn.formatDate("2026-10-23"), "23 Okt 2026");
  assert.equal(wn.formatDate("2026-05-01"), "1 Mei 2026");
  assert.equal(wn.formatDate("bukan"), "");
});
test("normalizeEntries membuang yang rusak tanpa crash", () => {
  const out = wn.normalizeEntries([{ version: "x" }, { version: "taskflow-v9-a", title: 5, new: "x", fixed: ["ok", 3, ""] }, null]);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0].new, []); assert.deepEqual(out[0].fixed, ["ok"]); assert.equal(out[0].title, "");
  assert.deepEqual(wn.normalizeEntries("x"), []);
});
test("load: URL + cache no-cache; gagal → null", async () => {
  let seen;
  const ok = await wn.load((u, o) => { seen = [u, o]; return Promise.resolve({ ok: true, json: () => Promise.resolve({ entries: [E(1)] }) }); });
  assert.deepEqual(seen, ["/static/whatsnew.json", { cache: "no-cache" }]); assert.equal(ok.length, 1);
  assert.equal(await wn.load(() => Promise.resolve({ ok: false })), null);
  assert.equal(await wn.load(() => Promise.reject(new Error("offline"))), null);
  assert.equal(await wn.load(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) })), null);
});
test("readSeen/writeSeen menelan storage yang melempar", () => {
  const bad = { getItem() { throw new Error("x"); }, setItem() { throw new Error("x"); } };
  assert.equal(wn.readSeen(bad), null); assert.equal(wn.writeSeen(bad, "v"), false);
  const m = new Map(); const good = { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) };
  assert.equal(wn.writeSeen(good, "taskflow-v1-a"), true); assert.equal(wn.readSeen(good), "taskflow-v1-a");
});
test("entri tanpa poin tidak tampil; silent:false dianggap entri biasa", () => {
  const entries = [E(12, { new: [], fixed: [] }), E(11, { silent: false }), E(10, { new: undefined, fixed: ["Perbaikan."] })];
  const r = wn.pickUnseen({ entries, current: "taskflow-v12-x", seen: "taskflow-v9-x", hadUser: true });
  assert.deepEqual(r.entries.map(e => e.version), ["taskflow-v11-x", "taskflow-v10-x"]);
  assert.deepEqual(wn.history({ entries, current: "taskflow-v12-x" }).map(e => e.version), ["taskflow-v11-x", "taskflow-v10-x"]);
  // hadUser + tanpa penanda: entri versi sekarang tanpa poin → tidak ada modal
  assert.equal(wn.pickUnseen({ entries, current: "taskflow-v12-x", seen: null, hadUser: true }).entries.length, 0);
});
test("shouldMarkSeen: current tak terbaca → jangan menulis penanda", () => {
  assert.equal(wn.shouldMarkSeen(null, "dev"), false);
  assert.equal(wn.shouldMarkSeen("taskflow-v1-x", undefined), false);
});
test("formatDate menolak tanggal yang tidak ada dan bentuk selain YYYY-MM-DD", () => {
  assert.equal(wn.formatDate("2026-02-30"), "");
  assert.equal(wn.formatDate("2026-13-01"), "");
  assert.equal(wn.formatDate("2024-02-29"), "29 Feb 2024");
  assert.equal(wn.formatDate("2026-10-23T10:00:00Z"), "");
  assert.equal(wn.formatDate(null), "");
});
test("history: current tak terbaca → kosong; limit dihormati", () => {
  assert.deepEqual(wn.history({ entries: ENTRIES, current: "dev" }), []);
  assert.equal(wn.history({ entries: ENTRIES, current: "taskflow-v466-x", limit: 2 }).length, 2);
});
