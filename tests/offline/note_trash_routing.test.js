"use strict";
// Sampah note (Trash & Restore) — jebakan router offline.
// Rute lokal `GET/DELETE /api/scratchpad/:id` cocok dengan `/api/scratchpad/trash` (3 segmen) →
// resolveNoteCid("trash") → "Note not found". Semua `/api/scratchpad/trash...` WAJIB ke jaringan.
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { deleteDB } = require("./setup.js");
const { DB_NAME, _reset } = require("../../static/offline/db.js");
const { buildTaskRouter, isNoteTrashCall, shouldRouteLocally } = require("../../static/offline/taskroutes.js");

const ROOT = path.join(__dirname, "..", "..");
const indexHtml = fs.readFileSync(path.join(ROOT, "static", "index.html"), "utf8");
const swJs = fs.readFileSync(path.join(ROOT, "static", "sw.js"), "utf8");

beforeEach(async () => { _reset(); await deleteDB(DB_NAME); });

const TRASH_CALLS = [
  ["GET", "/api/scratchpad/trash"],
  ["GET", "/api/scratchpad/trash/"],
  ["GET", "/api/scratchpad/trash?x=1"],
  ["DELETE", "/api/scratchpad/trash"],
  ["DELETE", "/api/scratchpad/trash/12"],
  ["POST", "/api/scratchpad/trash/12/restore"],
  ["delete", "/api/scratchpad/trash"],
];

test("isNoteTrashCall: true untuk semua /api/scratchpad/trash... (semua method)", () => {
  for (const [m, p] of TRASH_CALLS) assert.equal(isNoteTrashCall(m, p), true, `${m} ${p}`);
});

test("isNoteTrashCall: false untuk rute note biasa & yang mirip", () => {
  assert.equal(isNoteTrashCall("GET", "/api/scratchpad"), false);
  assert.equal(isNoteTrashCall("GET", "/api/scratchpad/123"), false);
  assert.equal(isNoteTrashCall("DELETE", "/api/scratchpad/123"), false);
  assert.equal(isNoteTrashCall("PATCH", "/api/scratchpad/123/pin"), false);
  assert.equal(isNoteTrashCall("GET", "/api/scratchpad/trashy"), false);
  assert.equal(isNoteTrashCall("GET", "/api/scratchpad/123/trash"), false);
  assert.equal(isNoteTrashCall("GET", "/api/tasks/trash"), false);
});

test("jebakan nyata: router lokal MENELAN GET/DELETE /api/scratchpad/trash lewat :id", async () => {
  const R = buildTaskRouter();
  assert.equal(R.hasRoute("GET", "/api/scratchpad/trash"), true);
  assert.equal(R.hasRoute("DELETE", "/api/scratchpad/trash"), true);
  await assert.rejects(R.dispatch("GET", "/api/scratchpad/trash", undefined), /Note not found/);
});

test("shouldRouteLocally: semua permintaan trash → jaringan (false)", () => {
  const R = buildTaskRouter();
  for (const [m, p] of TRASH_CALLS) assert.equal(shouldRouteLocally(R, m, p), false, `${m} ${p}`);
});

test("shouldRouteLocally: rute note lama tetap lokal", () => {
  const R = buildTaskRouter();
  assert.equal(shouldRouteLocally(R, "GET", "/api/scratchpad"), true);
  assert.equal(shouldRouteLocally(R, "GET", "/api/scratchpad/123"), true);
  assert.equal(shouldRouteLocally(R, "PUT", "/api/scratchpad/123"), true);
  assert.equal(shouldRouteLocally(R, "DELETE", "/api/scratchpad/123"), true);
  assert.equal(shouldRouteLocally(R, "PATCH", "/api/scratchpad/123/pin"), true);
  assert.equal(shouldRouteLocally(R, "GET", "/api/scratchpad/recent"), true);
  assert.equal(shouldRouteLocally(R, "get", "/api/scratchpad/123"), true);
});

test("shouldRouteLocally: preseden isNoteTagsCall & rute tak terdaftar tetap jaringan", () => {
  const R = buildTaskRouter();
  assert.equal(shouldRouteLocally(R, "GET", "/api/tags?entity_type=note"), false);
  assert.equal(shouldRouteLocally(R, "GET", "/api/tags"), true);
  assert.equal(shouldRouteLocally(R, "PATCH", "/api/scratchpad/5/share"), false);
  assert.equal(shouldRouteLocally(null, "GET", "/api/scratchpad/123"), false);
});

test("index.html: api wrapper memutuskan lokal vs jaringan lewat shouldRouteLocally", () => {
  assert.match(indexHtml, /const _local = _R\.shouldRouteLocally\s*\?\s*_R\.shouldRouteLocally\(_router, _method, url\)/);
  assert.match(indexHtml, /if \(_local\) \{/);
  // fallback (taskroutes.js lama dari cache) juga tidak boleh menelan trash
  const fb = indexHtml.match(/: \(_router\.hasRoute\(_method, url\) && !_R\.isNoteTagsCall\(_method, url\) && !\/(.+?)\/\.test\(url\)\);/);
  assert.ok(fb, "fallback ada");
  const re = new RegExp(fb[1].replace(/\\\//g, "/"));
  for (const [, p] of TRASH_CALLS) assert.equal(re.test(p), true, p);
  assert.equal(re.test("/api/scratchpad/123"), false);
  assert.equal(re.test("/api/scratchpad/trashy"), false);
});

test("sw.js: /api/scratchpad/trash network-only (tanpa cache basi; offline → 503 OFFLINE)", () => {
  const i = swJs.indexOf('url.pathname === "/api/scratchpad/trash" || url.pathname.startsWith("/api/scratchpad/trash/")');
  assert.ok(i > -1, "rule trash ada di sw.js");
  const iGetCache = swJs.indexOf('if (request.method === "GET" && url.pathname.startsWith("/api/"))');
  assert.ok(iGetCache > -1 && i < iGetCache, "rule trash harus sebelum network-first + cache GET /api/*");
});
