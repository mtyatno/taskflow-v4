"use strict";
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { deleteDB } = require("./setup.js");
const { DB_NAME, _reset } = require("../../static/offline/db.js");
const { validateAvatar, avatarFor, pinOrderAfterMove } = require("../../static/offline/workspacepins.js");
const { pullLists, listFromServer, getLocalLists, setLocalIdentity, setLocalPinOrder } = require("../../static/offline/listsync.js");

beforeEach(async () => { _reset(); await deleteDB(DB_NAME); });

const ERR = "Avatar harus 1–2 huruf/angka atau satu emoji";
// Tabel sama persis dengan tests/test_workspace_identity.py (paritas server).
const OK = [[null, null], ["", null], ["  ", null], ["ab", "AB"], ["x", "X"], ["7", "7"], ["é", "É"],
  ["🔥", "🔥"], ["👨‍👩‍👧", "👨‍👩‍👧"], ["🇮🇩", "🇮🇩"], ["👍🏽", "👍🏽"], ["❤️", "❤️"], ["1️⃣", "1️⃣"], ["ß", "SS"], ["ﬀ", "FF"]];
const BAD = ["abc", "a b", "🔥🔥", "A🔥", "a-", "<b>", "​", "🇮🇩🇮🇩",
  "ßß", "🇮️", "🇮‍", "🔥‍", "‍🔥", "🔥‍‍👍", "🔥⃣"];

for (const [raw, expected] of OK) {
  test(`validateAvatar ok ${JSON.stringify(raw)}`, () => {
    assert.deepEqual(validateAvatar(raw), { ok: true, value: expected });
  });
}
for (const raw of BAD) {
  test(`validateAvatar bad ${JSON.stringify(raw)}`, () => {
    const r = validateAvatar(raw);
    assert.equal(r.ok, false);
    assert.equal(r.error, ERR);
  });
}

test("avatarFor", () => {
  assert.deepEqual(avatarFor({ id: 3, name: "proyek", avatar: null, color_idx: null }), { text: "P", colorIdx: 3, isEmoji: false });
  assert.deepEqual(avatarFor({ id: 3, name: "x", avatar: "🔥", color_idx: 6 }), { text: "🔥", colorIdx: 6, isEmoji: true });
  assert.deepEqual(avatarFor({ id: 3, name: "x", avatar: "AB", color_idx: 9 }), { text: "AB", colorIdx: 3, isEmoji: false });
});

test("pinOrderAfterMove", () => {
  assert.deepEqual(pinOrderAfterMove([1, 2, 3], 0, 2), [2, 3, 1]);
  assert.deepEqual(pinOrderAfterMove([1, 2, 3], 2, 0), [3, 1, 2]);
  const src = [1, 2, 3];
  const same = pinOrderAfterMove(src, 0, 5);
  assert.deepEqual(same, [1, 2, 3]);
  assert.notEqual(same, src);
  assert.deepEqual(pinOrderAfterMove(src, -1, 1), [1, 2, 3]);
});

test("listsync keeps identity fields", async () => {
  const s = { id: 1, name: "a", role: "owner", description: "d", color_idx: 2, avatar: "🔥", updated_at: "t" };
  const rec = listFromServer(s, "c1");
  assert.deepEqual([rec.description, rec.color_idx, rec.avatar, rec.updated_at], ["d", 2, "🔥", "t"]);
  const bare = listFromServer({ id: 2, name: "b", role: "member" }, "c2");
  assert.deepEqual([bare.description, bare.color_idx, bare.avatar, bare.updated_at], ["", null, null, null]);

  await pullLists([s, { id: 3, name: "c", role: "member", pinned: true }]);
  assert.equal(await setLocalIdentity(1, { name: "z", description: "dd", color_idx: null, avatar: "AB", updated_at: "t2" }), true);
  assert.equal(await setLocalIdentity(99, { name: "q" }), false);
  const one = (await getLocalLists()).find((l) => l.id === 1);
  assert.deepEqual([one.name, one.description, one.color_idx, one.avatar, one.updated_at], ["z", "dd", null, "AB", "t2"]);

  assert.equal(await setLocalPinOrder([3, 1]), 2);
  const all = await getLocalLists();
  assert.equal(all.find((l) => l.id === 3).pin_position, 0);
  assert.equal(all.find((l) => l.id === 1).pin_position, 1);
});
