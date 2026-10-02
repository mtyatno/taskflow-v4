"use strict";
// Logika murni Sampah note (label/format) + wiring statis NoteTrashModal di index.html & sw.js.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const T = require("../../static/offline/notetrash.js");

const ROOT = path.join(__dirname, "..", "..");
const indexHtml = fs.readFileSync(path.join(ROOT, "static", "index.html"), "utf8");
const swJs = fs.readFileSync(path.join(ROOT, "static", "sw.js"), "utf8");

const NOW = new Date("2026-10-02T10:00:00+07:00");

test("teks konfirmasi & toast sesuai spec", () => {
  assert.equal(T.CONFIRM_MOVE, "Pindahkan catatan ini ke Sampah? Bisa dipulihkan dalam 30 hari.");
  assert.match(T.TOAST_MOVED, /Dipindahkan ke Sampah$/);
  assert.match(T.TOAST_RESTORED, /Catatan dipulihkan$/);
  assert.equal(T.OFFLINE_MSG, "Perlu koneksi internet untuk melihat Sampah");
  assert.match(T.CONFIRM_PURGE, /permanen/i);
  assert.match(T.CONFIRM_EMPTY, /permanen/i);
});

test("daysAgo: hari penuh yang berlalu (floor), tidak negatif, input buruk → 0", () => {
  assert.equal(T.daysAgo("2026-10-02T09:00:00+07:00", NOW), 0);
  assert.equal(T.daysAgo("2026-10-01T10:30:00+07:00", NOW), 0); // < 24 jam
  assert.equal(T.daysAgo("2026-10-01T09:59:00+07:00", NOW), 1);
  assert.equal(T.daysAgo("2026-09-22T10:00:00+07:00", NOW), 10);
  assert.equal(T.daysAgo("2026-10-03T10:00:00+07:00", NOW), 0); // jam klien tertinggal
  assert.equal(T.daysAgo("bukan tanggal", NOW), 0);
  assert.equal(T.daysAgo(null, NOW), 0);
});

test("deletedAgoLabel: 'dihapus hari ini' / 'dihapus N hari lalu'", () => {
  assert.equal(T.deletedAgoLabel("2026-10-02T08:00:00+07:00", NOW), "dihapus hari ini");
  assert.equal(T.deletedAgoLabel("2026-10-01T08:00:00+07:00", NOW), "dihapus 1 hari lalu");
  assert.equal(T.deletedAgoLabel("2026-09-25T08:00:00+07:00", NOW), "dihapus 7 hari lalu");
});

test("daysLeftLabel: 'sisa N hari', 0/buruk → 'dihapus permanen hari ini'", () => {
  assert.equal(T.daysLeftLabel(30), "sisa 30 hari");
  assert.equal(T.daysLeftLabel(1), "sisa 1 hari");
  assert.equal(T.daysLeftLabel(0), "dihapus permanen hari ini");
  assert.equal(T.daysLeftLabel(undefined), "dihapus permanen hari ini");
});

test("isExpiringSoon: ≤3 hari", () => {
  assert.equal(T.isExpiringSoon(3), true);
  assert.equal(T.isExpiringSoon(0), true);
  assert.equal(T.isExpiringSoon(4), false);
});

test("titleLabel: judul (trim) atau '(tanpa judul)'", () => {
  assert.equal(T.titleLabel({ title: "  Rapat  " }), "Rapat");
  assert.equal(T.titleLabel({ title: "" }), "(tanpa judul)");
  assert.equal(T.titleLabel({ title: "   " }), "(tanpa judul)");
  assert.equal(T.titleLabel({}), "(tanpa judul)");
  assert.equal(T.titleLabel(null), "(tanpa judul)");
});

test("trashViewState: offline menang atas semuanya (tanpa memanggil API)", () => {
  assert.equal(T.trashViewState({ online: false, loading: true, error: "x", items: [{ id: 1 }] }), "offline");
  assert.equal(T.trashViewState({ online: true, loading: true, error: null, items: [] }), "loading");
  assert.equal(T.trashViewState({ online: true, loading: false, error: "Gagal", items: [] }), "error");
  assert.equal(T.trashViewState({ online: true, loading: false, error: null, items: [] }), "empty");
  assert.equal(T.trashViewState({ online: true, loading: false, error: null, items: null }), "empty");
  assert.equal(T.trashViewState({ online: true, loading: false, error: null, items: [{ id: 1 }] }), "list");
});

test("isOnline: hanya navigator.onLine === false yang dianggap offline", () => {
  assert.equal(T.isOnline({ onLine: false }), false);
  assert.equal(T.isOnline({ onLine: true }), true);
  assert.equal(T.isOnline(undefined), true);
});

// ── wiring statis ──
test("index.html memuat notetrash.js sebelum script app & sw.js mem-precache-nya", () => {
  const iMod = indexHtml.indexOf('<script src="/static/offline/notetrash.js"></script>');
  assert.ok(iMod > -1, "script tag notetrash.js");
  assert.ok(iMod < indexHtml.indexOf('<script src="/static/ui-components.js"></script>'));
  assert.match(swJs, /"\/static\/offline\/notetrash\.js",/);
});

test("NoteTrashModal: komponen ada, cek offline SEBELUM fetch, endpoint sesuai kontrak", () => {
  const start = indexHtml.indexOf("function NoteTrashModal(");
  assert.ok(start > -1, "NoteTrashModal didefinisikan");
  const body = indexHtml.slice(start, indexHtml.indexOf("\n}\n", start));
  assert.match(body, /api\.get\("\/api\/scratchpad\/trash"\)/);
  assert.match(body, /api\.post\(`\/api\/scratchpad\/trash\/\$\{[^}]+\}\/restore`/);
  assert.match(body, /api\.del\(`\/api\/scratchpad\/trash\/\$\{[^}]+\}`\)/);
  assert.match(body, /api\.del\("\/api\/scratchpad\/trash"\)/);
  const iOnline = body.indexOf("NT.isOnline(navigator)");
  assert.ok(iOnline > -1 && iOnline < body.indexOf('api.get("/api/scratchpad/trash")'), "cek offline sebelum GET");
  assert.match(body, /NT\.CONFIRM_PURGE/);
  assert.match(body, /NT\.CONFIRM_EMPTY/);
  assert.doesNotMatch(body, /OfflineDB\.queueAdd/, "permintaan trash tidak pernah diantre");
});

test("NotesPage: tombol Sampah membuka NoteTrashModal; restore → sync + fetchNotes", () => {
  const start = indexHtml.indexOf("function NotesPage(");
  const body = indexHtml.slice(start, indexHtml.indexOf("\n}\n", start));
  assert.match(body, /title: "Sampah"/);
  assert.match(body, /setTrashOpen\(true\)/);
  assert.match(body, /React\.createElement\(NoteTrashModal,/);
  assert.match(body, /window\.__syncNow/);
  assert.match(body, /showToast\(window\.TF\.notetrash\.TOAST_MOVED\)/);
});

test("konfirmasi hapus note lama diganti di semua tempat", () => {
  assert.doesNotMatch(indexHtml, /Hapus catatan ini\?/);
  assert.doesNotMatch(indexHtml, /Catatan dihapus"/);
  assert.doesNotMatch(indexHtml, /api\.delete\(`\/api\/scratchpad/, "api.delete tidak ada; pakai api.del");
});
