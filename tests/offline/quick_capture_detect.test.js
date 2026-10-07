"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const indexHtml = fs.readFileSync(path.resolve(__dirname, "../../static/index.html"), "utf8").replace(/\r\n/g, "\n");
const appCss = fs.readFileSync(path.resolve(__dirname, "../../static/app.css"), "utf8").replace(/\r\n/g, "\n");

// Ekstrak definisi parseQuickCapture dari static/index.html
function getParseQuickCapture() {
  const start = indexHtml.indexOf("function parseQuickCapture(");
  assert.ok(start >= 0, "function parseQuickCapture must exist in static/index.html");
  const end = indexHtml.indexOf("\nfunction Dashboard({", start);
  assert.ok(end > start, "parseQuickCapture must end before function Dashboard");
  const fnCode = indexHtml.slice(start, end);
  const factory = new Function(`${fnCode}; return parseQuickCapture;`);
  return factory();
}

test("parseQuickCapture: deteksi awalan 'tugas,' dan deadline 'besok'", () => {
  const parse = getParseQuickCapture();
  const baseDate = new Date("2026-10-07T12:00:00");
  const result = parse("Tugas, beli mobil fortuner besok", baseDate);

  assert.equal(result.isTask, true);
  assert.equal(result.title, "beli mobil fortuner");
  assert.equal(result.deadline, "2026-10-08");
});

test("parseQuickCapture: deteksi awalan 'tugas:' tanpa deadline", () => {
  const parse = getParseQuickCapture();
  const result = parse("tugas: bayar tagihan listrik");

  assert.equal(result.isTask, true);
  assert.equal(result.title, "bayar tagihan listrik");
  assert.equal(result.deadline, null);
});

test("parseQuickCapture: deteksi awalan 'task' dan 'tasks:'", () => {
  const parse = getParseQuickCapture();
  const r1 = parse("task beli kopi");
  assert.equal(r1.isTask, true);
  assert.equal(r1.title, "beli kopi");
  assert.equal(r1.deadline, null);

  const r2 = parse("tasks: review pull request");
  assert.equal(r2.isTask, true);
  assert.equal(r2.title, "review pull request");
  assert.equal(r2.deadline, null);
});

test("parseQuickCapture: deteksi awalan 'todo -' dan deadline 'hari ini'", () => {
  const parse = getParseQuickCapture();
  const baseDate = new Date("2026-10-07T08:00:00");
  const result = parse("todo - selesaikan laporan hari ini", baseDate);

  assert.equal(result.isTask, true);
  assert.equal(result.title, "selesaikan laporan");
  assert.equal(result.deadline, "2026-10-07");
});

test("parseQuickCapture: deteksi awalan 'todos' dan deadline 'lusa'", () => {
  const parse = getParseQuickCapture();
  const baseDate = new Date("2026-10-07T09:00:00");
  const result = parse("todos antar adik ke stasiun lusa", baseDate);

  assert.equal(result.isTask, true);
  assert.equal(result.title, "antar adik ke stasiun");
  assert.equal(result.deadline, "2026-10-09");
});

test("parseQuickCapture: deteksi deadline bahasa Inggris 'today' dan 'tomorrow'", () => {
  const parse = getParseQuickCapture();
  const baseDate = new Date("2026-10-07T10:00:00");

  const r1 = parse("task workout today", baseDate);
  assert.equal(r1.isTask, true);
  assert.equal(r1.title, "workout");
  assert.equal(r1.deadline, "2026-10-07");

  const r2 = parse("todo buy groceries tomorrow", baseDate);
  assert.equal(r2.isTask, true);
  assert.equal(r2.title, "buy groceries");
  assert.equal(r2.deadline, "2026-10-08");
});

test("parseQuickCapture: fallback ke note jika bukan task", () => {
  const parse = getParseQuickCapture();

  const r1 = parse("Catatan meeting pagi ini");
  assert.equal(r1.isTask, false);

  const r2 = parse("Ide startup baru untuk tahun depan");
  assert.equal(r2.isTask, false);

  // 'tugasnya' bukan awalan task karena 'nya' bagian kata
  const r3 = parse("Tugasnya sangat berat hari ini");
  assert.equal(r3.isTask, false);

  // Hanya mengetik awalan tanpa isi konten task
  const r4 = parse("tugas:");
  assert.equal(r4.isTask, false);

  const r5 = parse("");
  assert.equal(r5.isTask, false);
});

test("static/index.html: Dashboard handleScratch mendukung task auto-detect dan center toast", () => {
  assert.match(indexHtml, /function parseQuickCapture\(/);
  assert.match(indexHtml, /const parsed = parseQuickCapture\(text\);/);
  assert.match(indexHtml, /parsed\.isTask/);
  assert.match(indexHtml, /api\.post\(["']\/api\/tasks["']/);
  assert.match(indexHtml, /center-hud-toast/);
  assert.match(indexHtml, /Task Created/);
  assert.match(indexHtml, /Note Created/);
});

test("static/app.css: styling center-hud-toast dan keyframes centerHudFade tersedia", () => {
  assert.match(appCss, /\.center-hud-toast\s*\{/);
  assert.match(appCss, /@keyframes centerHudFade\s*\{/);
  assert.match(appCss, /\.center-hud-task\s*\{/);
  assert.match(appCss, /\.center-hud-note\s*\{/);
});
