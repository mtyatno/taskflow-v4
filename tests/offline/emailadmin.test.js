"use strict";
// Kartu "Email" halaman Admin (fase 0b) — logika murni klien TF.emailadmin.
const test = require("node:test");
const assert = require("node:assert/strict");
const ea = require("../../static/offline/emailadmin.js");

test("konstanta polling: tiap 3 detik, maks 30 detik", () => {
  assert.equal(ea.POLL_MS, 3000);
  assert.equal(ea.POLL_MAX_MS, 30000);
});

test("statusLabel: label Indonesia, status tak dikenal apa adanya", () => {
  assert.equal(ea.statusLabel("sent"), "Terkirim");
  assert.equal(ea.statusLabel("queued"), "Antre");
  assert.equal(ea.statusLabel("sending"), "Mengirim");
  assert.equal(ea.statusLabel("failed"), "Gagal");
  assert.equal(ea.statusLabel("expired"), "Kedaluwarsa");
  assert.equal(ea.statusLabel("aneh"), "aneh");
  assert.equal(ea.statusLabel(null), "");
  assert.equal(ea.statusLabel(undefined), "");
});

test("kindLabel: reset / test, lainnya apa adanya", () => {
  assert.equal(ea.kindLabel("reset"), "Reset password");
  assert.equal(ea.kindLabel("test"), "Email tes");
  assert.equal(ea.kindLabel("digest"), "digest");
  assert.equal(ea.kindLabel(null), "");
});

test("badgeFor: sent ok, queued/sending warn, failed err, expired muted", () => {
  assert.equal(ea.badgeFor("sent"), "ok");
  assert.equal(ea.badgeFor("queued"), "warn");
  assert.equal(ea.badgeFor("sending"), "warn");
  assert.equal(ea.badgeFor("failed"), "err");
  assert.equal(ea.badgeFor("expired"), "muted");
  assert.equal(ea.badgeFor("lain"), "muted");
});

test("modeBadge: worker mati menang, lalu dev, lalu smtp", () => {
  assert.deepEqual(ea.modeBadge({ mode: "smtp", host: "smtp.x.id", port: 587, security: "starttls", worker_alive: false }),
    { tone: "err", text: "Worker email tidak berjalan" });
  assert.deepEqual(ea.modeBadge({ mode: "dev", worker_alive: false }),
    { tone: "err", text: "Worker email tidak berjalan" });
  assert.deepEqual(ea.modeBadge({ mode: "dev", host: "", port: 587, security: "starttls", worker_alive: true }),
    { tone: "warn", text: "Dev mode — email hanya dicetak ke log server" });
  assert.deepEqual(ea.modeBadge({ mode: "smtp", host: "smtp.x.id", port: 465, security: "ssl", worker_alive: true }),
    { tone: "ok", text: "SMTP: smtp.x.id:465 · ssl" });
});

test("modeBadge: worker_alive tidak ada (undefined) tidak dianggap mati", () => {
  assert.equal(ea.modeBadge({ mode: "smtp", host: "h", port: 25, security: "none" }).tone, "ok");
  assert.equal(ea.modeBadge({ mode: "dev" }).tone, "warn");
});

test("isPollingDone: sent/failed/expired selesai; queued/sending/kosong belum", () => {
  assert.equal(ea.isPollingDone({ status: "sent" }), true);
  assert.equal(ea.isPollingDone({ status: "failed" }), true);
  assert.equal(ea.isPollingDone({ status: "expired" }), true);
  assert.equal(ea.isPollingDone({ status: "queued" }), false);
  assert.equal(ea.isPollingDone({ status: "sending" }), false);
  assert.equal(ea.isPollingDone(null), false);
  assert.equal(ea.isPollingDone(undefined), false);
});

test("formatAttempts: n/5 (MAX_ATTEMPTS backend)", () => {
  assert.equal(ea.MAX_ATTEMPTS, 5);
  assert.equal(ea.formatAttempts(0), "0/5");
  assert.equal(ea.formatAttempts(3), "3/5");
  assert.equal(ea.formatAttempts(null), "0/5");
  assert.equal(ea.formatAttempts("2"), "2/5");
});

test("parseUtc: ISO naif dianggap UTC (tambah Z); sudah ber-zona dibiarkan; kosong → null", () => {
  assert.equal(ea.parseUtc("2026-10-21T08:00:00").getTime(), Date.UTC(2026, 9, 21, 8, 0, 0));
  assert.equal(ea.parseUtc("2026-10-21T08:00:00.123456").getTime(), Date.UTC(2026, 9, 21, 8, 0, 0, 123));
  assert.equal(ea.parseUtc("2026-10-21T08:00:00Z").getTime(), Date.UTC(2026, 9, 21, 8, 0, 0));
  assert.equal(ea.parseUtc("2026-10-21T15:00:00+07:00").getTime(), Date.UTC(2026, 9, 21, 8, 0, 0));
  assert.equal(ea.parseUtc(null), null);
  assert.equal(ea.parseUtc(""), null);
  assert.equal(ea.parseUtc("bukan tanggal"), null);
});

test("truncate: dipotong 60 karakter dengan elipsis; pendek/kosong apa adanya", () => {
  const long = "x".repeat(80);
  const t = ea.truncate(long, 60);
  assert.equal(t.length, 60);
  assert.ok(t.endsWith("…"));
  assert.equal(ea.truncate("pendek", 60), "pendek");
  assert.equal(ea.truncate("x".repeat(60), 60), "x".repeat(60));
  assert.equal(ea.truncate(null, 60), "");
  assert.equal(ea.truncate("y".repeat(70)).length, 60, "bawaan 60");
});

test("findRow: cari baris id di recent", () => {
  const s = { recent: [{ id: 3, status: "sent" }, { id: 2, status: "queued" }] };
  assert.deepEqual(ea.findRow(s, 2), { id: 2, status: "queued" });
  assert.equal(ea.findRow(s, 9), null);
  assert.equal(ea.findRow(null, 2), null);
  assert.equal(ea.findRow({}, 2), null);
});

test("testOutcome: toast sesuai hasil email tes", () => {
  assert.deepEqual(ea.testOutcome({ status: "sent" }), { type: "success", text: "Email tes terkirim" });
  assert.deepEqual(ea.testOutcome({ status: "failed", last_error: "535 auth gagal" }),
    { type: "error", text: "Email tes gagal: 535 auth gagal" });
  assert.deepEqual(ea.testOutcome({ status: "failed", last_error: null }),
    { type: "error", text: "Email tes gagal: Gagal" });
  assert.deepEqual(ea.testOutcome({ status: "expired" }),
    { type: "error", text: "Email tes gagal: Kedaluwarsa" });
  assert.equal(ea.testOutcome({ status: "queued" }), null);
  assert.deepEqual(ea.testOutcome({ status: "queued", attempts: 1, last_error: "timed out" }),
    { type: "error", text: "Email tes gagal (akan dicoba lagi): timed out" });
  assert.equal(ea.testOutcome({ status: "queued", attempts: 0, last_error: null }), null);
  assert.equal(ea.testOutcome(null), null);
  assert.deepEqual(ea.TIMEOUT_OUTCOME, { type: "info", text: "Email tes masih dalam antrean" });
});
