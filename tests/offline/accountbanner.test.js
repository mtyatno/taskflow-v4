"use strict";
// Banner akun (email / lengkapi akun) — keputusan murni + validasi form "Lengkapi akun".
const test = require("node:test");
const assert = require("node:assert/strict");
const ab = require("../../static/offline/accountbanner.js");

const NOW = Date.UTC(2026, 9, 21, 8, 0, 0);
const full = { id: 1, username: "budi", email: "budi@contoh.id", password_set: true };

test("konstanta: kunci localStorage dan jendela 7 hari", () => {
  assert.equal(ab.DISMISS_KEY, "tf_email_banner_dismissed_until");
  assert.equal(ab.DISMISS_MS, 7 * 24 * 60 * 60 * 1000);
  assert.equal(ab.dismissUntil(NOW), NOW + 7 * 24 * 60 * 60 * 1000);
});

test("decide: tanpa user → null", () => {
  assert.equal(ab.decide({ user: null, now: NOW }), null);
  assert.equal(ab.decide({ now: NOW }), null);
  assert.equal(ab.decide(), null);
});

test("decide: akun lengkap → null", () => {
  assert.equal(ab.decide({ user: full, now: NOW }), null);
});

test("decide: password_set === false → incomplete (menang atas no_email)", () => {
  assert.equal(ab.decide({ user: { ...full, password_set: false, email: null }, now: NOW }), "incomplete");
  assert.equal(ab.decide({ user: { ...full, password_set: false }, now: NOW }), "incomplete");
});

test("decide: password_set undefined dianggap true (respons login tanpa field ini)", () => {
  const u = { id: 1, username: "budi", email: "budi@contoh.id" };
  assert.equal(ab.decide({ user: u, now: NOW }), null);
});

test("decide: email null / kosong / spasi → no_email", () => {
  assert.equal(ab.decide({ user: { ...full, email: null }, now: NOW }), "no_email");
  assert.equal(ab.decide({ user: { ...full, email: "" }, now: NOW }), "no_email");
  assert.equal(ab.decide({ user: { ...full, email: "   " }, now: NOW }), "no_email");
});

test("decide: field email tidak ada (user dari payload token saat offline) → tidak diketahui → null", () => {
  const u = { id: 1, username: "budi", display_name: "budi" };
  assert.equal(ab.decide({ user: u, now: NOW }), null);
});

test("decide: masih dalam jendela tutup → null; lewat → tampil lagi", () => {
  const u = { ...full, email: null };
  assert.equal(ab.decide({ user: u, now: NOW, dismissedUntil: NOW + 1000 }), null);
  assert.equal(ab.decide({ user: u, now: NOW, dismissedUntil: String(NOW + 1000) }), null, "nilai string dari localStorage");
  assert.equal(ab.decide({ user: u, now: NOW, dismissedUntil: NOW }), "no_email", "batas = sekarang → sudah lewat");
  assert.equal(ab.decide({ user: u, now: NOW, dismissedUntil: NOW - 1 }), "no_email");
  assert.equal(ab.decide({ user: u, now: NOW, dismissedUntil: "bukan-angka" }), "no_email");
  assert.equal(ab.decide({ user: u, now: NOW, dismissedUntil: null }), "no_email");
  assert.equal(ab.decide({ user: { ...full, password_set: false }, now: NOW, dismissedUntil: NOW + 5 }), null);
});

test("validateCompleteAccount: email wajib dan berformat", () => {
  const ok = { username: "", email: "a@b.co", password: "rahasia", confirm: "rahasia" };
  assert.equal(ab.validateCompleteAccount(ok), null);
  assert.equal(ab.validateCompleteAccount({ ...ok, email: "" }), "Email wajib diisi");
  assert.equal(ab.validateCompleteAccount({ ...ok, email: "   " }), "Email wajib diisi");
  assert.equal(ab.validateCompleteAccount({ ...ok, email: "bukan-email" }), "Format email tidak valid");
});

test("validateCompleteAccount: password min 4 dan konfirmasi cocok", () => {
  const ok = { username: "", email: "a@b.co", password: "rahasia", confirm: "rahasia" };
  assert.equal(ab.validateCompleteAccount({ ...ok, password: "abc", confirm: "abc" }), "Password minimal 4 karakter");
  assert.equal(ab.validateCompleteAccount({ ...ok, confirm: "lain" }), "Password baru tidak cocok");
});

test("validateCompleteAccount / usernameError: aturan username (opsional)", () => {
  const ok = { username: "", email: "a@b.co", password: "rahasia", confirm: "rahasia" };
  assert.equal(ab.validateCompleteAccount({ ...ok, username: "   " }), null, "kosong = tetap username lama");
  assert.equal(ab.validateCompleteAccount({ ...ok, username: "budi_01" }), null);
  assert.equal(ab.usernameError("ab"), "Username hanya boleh huruf, angka, dan _ (3–50 karakter)");
  assert.equal(ab.usernameError("budi santoso"), "Username hanya boleh huruf, angka, dan _ (3–50 karakter)");
  assert.equal(ab.usernameError("a".repeat(51)), "Username hanya boleh huruf, angka, dan _ (3–50 karakter)");
  assert.equal(ab.usernameError("TG_budi"), "Username tidak boleh diawali tg_");
  assert.equal(ab.usernameError("budi_01"), null);
  assert.equal(ab.validateCompleteAccount({ ...ok, username: "tg_123" }), "Username tidak boleh diawali tg_");
});
