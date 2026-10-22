"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const ui = require("../../static/offline/commentui.js");

test("canEdit hanya penulis (id dibanding sebagai string)", () => {
  assert.equal(ui.canEdit({ user_id: 5 }, "5"), true);
  assert.equal(ui.canEdit({ user_id: 5 }, 6), false);
});
test("canResolve: penulis thread atau pemilik note; balasan tidak", () => {
  const t = { user_id: 5, replies: [] };
  assert.equal(ui.canResolve(t, 5, 1), true);
  assert.equal(ui.canResolve(t, 1, "1"), true);
  assert.equal(ui.canResolve(t, 9, 1), false);
  assert.equal(ui.canResolve({ user_id: 5, parent_cid: "x" }, 5, 1), false);
  assert.equal(ui.canResolve({ user_id: 5, parent_id: 3 }, 1, 1), false);
});
test("canDelete: penulis atau pemilik note", () => {
  assert.equal(ui.canDelete({ user_id: 5 }, 5, 1), true);
  assert.equal(ui.canDelete({ user_id: 5 }, 1, 1), true);
  assert.equal(ui.canDelete({ user_id: 5 }, 9, 1), false);
});

const NOW = Date.parse("2026-10-21T12:00:00Z");
test("relTime rentang", () => {
  assert.equal(ui.relTime(new Date(NOW - 59000).toISOString(), NOW), "baru saja");
  assert.equal(ui.relTime(new Date(NOW - 60000).toISOString(), NOW), "1 menit lalu");
  assert.equal(ui.relTime(new Date(NOW - 59 * 60000).toISOString(), NOW), "59 menit lalu");
  assert.equal(ui.relTime(new Date(NOW - 3 * 3600000).toISOString(), NOW), "3 jam lalu");
  assert.equal(ui.relTime(new Date(NOW - 23 * 3600000).toISOString(), NOW), "23 jam lalu");
});
test("relTime format +07:00 dan Z", () => {
  assert.equal(ui.relTime("2026-10-21T18:59:30+07:00", NOW), "baru saja");
  assert.equal(ui.relTime("2026-10-21T11:55:00Z", NOW), "5 menit lalu");
});
test("relTime kemarin / hari lalu / tanggal (zona waktu independen)", () => {
  const now = new Date(2026, 9, 21, 15, 0, 0).getTime(); // lokal
  const at = (d, h) => new Date(2026, 9, d, h, 0, 0).toISOString();
  assert.equal(ui.relTime(at(20, 10), now), "kemarin");
  assert.equal(ui.relTime(at(20, 1), now), "kemarin");
  assert.equal(ui.relTime(at(20, 23), now), "16 jam lalu"); // < 24 jam menang atas kalender
  assert.equal(ui.relTime(at(18, 12), now), "3 hari lalu");
  assert.equal(ui.relTime(at(15, 12), now), "6 hari lalu");
  assert.equal(ui.relTime(at(10, 12), now), "10 Okt 2026");
  assert.equal(ui.relTime(new Date(2025, 4, 3, 12).toISOString(), now), "3 Mei 2025");
});

test("initials", () => {
  assert.equal(ui.initials("Budi Santoso"), "BS");
  assert.equal(ui.initials("rina"), "RI");
  assert.equal(ui.initials("  ani budi citra "), "AB");
  assert.equal(ui.initials(""), "");
  assert.equal(ui.initials(null), "");
});

test("mentionCandidates: owner + members, tanpa diri & duplikat", () => {
  const d = {
    owner: { id: 1, username: "own", display_name: "Own" },
    members: [{ id: 1, username: "own", display_name: "Own", joined_at: "x" }, { id: 2, username: "me", display_name: "Me" },
      { id: 3, username: "c", display_name: "C" }, { id: 3, username: "c", display_name: "C" }],
  };
  assert.deepEqual(ui.mentionCandidates(d, "2"), [
    { id: 1, username: "own", display_name: "Own" }, { id: 3, username: "c", display_name: "C" }]);
  assert.deepEqual(ui.mentionCandidates(null, 1), []);
  assert.deepEqual(ui.mentionCandidates({ owner: null }, 1), []);
});

test("normalizeQuote", () => {
  assert.equal(ui.normalizeQuote("  a\n\n b "), "a b");
  assert.equal(ui.normalizeQuote("x".repeat(501)).length, 500);
  assert.equal(ui.normalizeQuote(null), "");
});

function row(o) {
  return Object.assign({ id: null, cid: "c" + Math.random(), server_id: null, parent_id: null, parent_cid: null, user_id: 5,
    body: "b", quote: null, resolved_at: null, deleted_at: null, created_at: "2026-10-21T10:00:00Z", sync_error: null }, o);
}
test("viewModel hitungan, hak, anchorLost, failed vs rejected", () => {
  const rows = [
    row({ cid: "a", id: 1, server_id: 1, quote: "ada", user_id: 5 }),
    row({ cid: "b", id: 2, server_id: 2, quote: "hilang", created_at: "2026-10-21T10:01:00Z", sync_error: { code: "x", message: "m" } }),
    row({ cid: "r", parent_cid: "a", user_id: 7, created_at: "2026-10-21T10:02:00Z", sync_error: { code: "rejected", message: "m" } }),
    row({ cid: "d", id: 4, server_id: 4, resolved_at: "2026-10-21T11:00:00Z", created_at: "2026-10-21T10:03:00Z" }),
  ];
  const vm = ui.viewModel(rows, { tab: "open", meId: 5, noteOwnerId: 1, docText: "teks ada di sini" });
  assert.equal(vm.openCount, 2);
  assert.equal(vm.doneCount, 1);
  assert.equal(vm.threads.length, 2);
  const [a, b] = vm.threads;
  assert.equal(a.anchorLost, false);
  assert.equal(b.anchorLost, true);
  assert.equal(a.canEdit, true); assert.equal(a.canResolve, true); assert.equal(a.canDelete, true);
  assert.equal(b.failed, true); assert.equal(b.rejected, false);
  assert.equal(a.replies.length, 1);
  const r = a.replies[0];
  assert.equal(r.rejected, true); assert.equal(r.failed, false);
  assert.equal(r.canEdit, false); assert.equal(r.canResolve, false); assert.equal(r.canDelete, false);
  assert.equal(ui.viewModel(rows, { tab: "done", meId: 5, noteOwnerId: 1, docText: "" }).threads.length, 1);
});
test("viewModel tanpa docText: anchorLost false", () => {
  const rows = [row({ cid: "a", quote: "apa saja" })];
  assert.equal(ui.viewModel(rows, { tab: "open", meId: 1, noteOwnerId: 1 }).threads[0].anchorLost, false);
  assert.equal(ui.viewModel(rows, { tab: "open", meId: 1, noteOwnerId: 1, docText: null }).threads[0].anchorLost, false);
});

test("requestOpen/consumeOpen sekali pakai", () => {
  assert.equal(ui.consumeOpen(9), false);
  ui.requestOpen(9);
  assert.equal(ui.consumeOpen("8"), false);
  assert.equal(ui.consumeOpen("9"), true);
  assert.equal(ui.consumeOpen(9), false);
});

test("consumeOpen kedaluwarsa setelah 30 detik", () => {
  const real = Date.now;
  try {
    Date.now = () => 1000;
    ui.requestOpen(4);
    assert.equal(ui.consumeOpen(4, 1000 + 30001), false);
    assert.equal(ui.consumeOpen(4, 1000), false); // sudah dibersihkan
    ui.requestOpen(4);
    assert.equal(ui.consumeOpen(4, 1000 + 29000), true);
  } finally { Date.now = real; }
});
test("requestOpen mengirim event tf:comments-open bila window ada", () => {
  const seen = [];
  const hadW = "window" in global, hadC = "CustomEvent" in global;
  const oldW = global.window;
  global.window = { dispatchEvent: (e) => seen.push(e) };
  try {
    ui.requestOpen(12);
    assert.equal(seen.length, 1);
    assert.equal(seen[0].type, "tf:comments-open");
    assert.equal(seen[0].detail.noteId, "12");
  } finally { if (hadW) global.window = oldW; else delete global.window; ui.consumeOpen(12); }
});
