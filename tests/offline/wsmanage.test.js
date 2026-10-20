"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const wm = require("../../static/offline/wsmanage.js");

test("nameMatches trims both sides and compares case-insensitively", () => {
  assert.equal(wm.nameMatches("proyek a&b", "  Proyek A&B "), true);
  assert.equal(wm.nameMatches("Proyek", "Proyek A&B"), false);
  assert.equal(wm.nameMatches("", "X"), false);
  assert.equal(wm.nameMatches("  x ", "X"), true);
});

test("impactLines lists every non-zero category", () => {
  assert.deepEqual(
    wm.impactLines({ tasks_total: 12, tasks_active: 3, files: 4, messages: 57, projects: 2, stages: 3, notes_to_personal: 5, drawings_to_personal: 1 }),
    [
      "12 task (3 aktif) akan kembali menjadi task pribadi pembuatnya",
      "4 berkas dan 57 pesan chat dihapus permanen",
      "2 project dan 3 tahap dihapus",
      "5 catatan dan 1 drawing kembali menjadi pribadi",
    ]
  );
});

test("impactLines omits zero rows", () => {
  assert.deepEqual(
    wm.impactLines({ tasks_total: 2, tasks_active: 0, files: 0, messages: 5, projects: 0, stages: 1, notes_to_personal: 0, drawings_to_personal: 2 }),
    [
      "2 task akan kembali menjadi task pribadi pembuatnya",
      "5 pesan chat dihapus permanen",
      "1 tahap dihapus",
      "2 drawing kembali menjadi pribadi",
    ]
  );
});

test("impactLines returns the empty-workspace line when all zero or {}", () => {
  assert.deepEqual(wm.impactLines({ tasks_total: 0, tasks_active: 0, files: 0, messages: 0, projects: 0, stages: 0, notes_to_personal: 0, drawings_to_personal: 0 }), ["Workspace ini kosong."]);
  assert.deepEqual(wm.impactLines({}), ["Workspace ini kosong."]);
});

test("memberRows puts owner first and does not duplicate owner in members", () => {
  const rows = wm.memberRows({
    owner: { id: 1, username: "a", display_name: "A" },
    members: [
      { id: 2, username: "b", display_name: "B" },
      { id: 1, username: "a", display_name: "A" },
      { id: 3, username: "c", display_name: "C" },
    ],
  });
  assert.deepEqual(rows.map((r) => r.id), [1, 2, 3]);
  assert.deepEqual(rows.map((r) => r.role), ["owner", "member", "member"]);
});

test("memberRows with null owner returns members only", () => {
  const rows = wm.memberRows({ owner: null, members: [{ id: 5, username: "e", display_name: "E" }] });
  assert.deepEqual(rows, [{ id: 5, username: "e", display_name: "E", role: "member" }]);
});
