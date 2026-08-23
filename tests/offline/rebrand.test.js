"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const read = (p) => fs.readFileSync(path.resolve(__dirname, "../../", p), "utf8");
const indexHtml = read("static/index.html");
const manifest = read("static/manifest.json");
const swJs = read("static/sw.js");
const dbJs = read("static/offline/db.js");
const tauriConf = read("src-tauri/tauri.conf.json");

test("Rebrand Alurik — user-visible strings", async (t) => {
  await t.test("title & apple title jadi Alurik", () => {
    assert.ok(indexHtml.includes("<title>Alurik</title>"), "title harus <title>Alurik</title>");
    assert.ok(indexHtml.includes('content="Alurik"'), "apple-mobile-web-app-title harus Alurik");
  });

  await t.test("UI string lama hilang", () => {
    assert.strictEqual(indexHtml.includes("⚡ TaskFlow"), false, '"⚡ TaskFlow" tidak boleh ada');
    // semua identifier internal di file ini lowercase ("taskflow-..."), jadi literal
    // kapital-quoted '"TaskFlow"' yang tersisa pasti string UI — wajib nol.
    assert.strictEqual(indexHtml.includes('"TaskFlow"'), false, 'literal UI "TaskFlow" (kapital, quoted) tidak boleh ada');
    assert.strictEqual(indexHtml.includes("TaskFlow V4"), false, '"TaskFlow V4" tidak boleh ada');
  });

  await t.test("brand baru muncul di UI & ekspor", () => {
    assert.ok(indexHtml.includes("⚡ Alurik"), '"⚡ Alurik" harus ada di UI');
    assert.ok(indexHtml.includes("a.download = 'alurik-export-' + today + '.zip';"), "nama file ekspor harus alurik-export");
    assert.ok(indexHtml.includes("Navigasi utama Alurik"), "teks tour harus menyebut Alurik");
  });

  await t.test("manifest PWA pakai Alurik", () => {
    assert.ok(manifest.includes('"name": "Alurik"'), "manifest name = Alurik");
    assert.ok(manifest.includes('"short_name": "Alurik"'), "manifest short_name = Alurik");
    assert.strictEqual(manifest.includes("TaskFlow"), false, "manifest tidak boleh menyebut TaskFlow");
  });

  await t.test("identifier internal TETAP (data & identitas app)", () => {
    assert.ok(dbJs.includes('DB_NAME = "taskflow-offline"'), "IndexedDB name wajib tetap");
    assert.ok(indexHtml.includes('const NAME = "taskflow-legacy-cache"'), "legacy cache name wajib tetap");
    assert.ok(/^const CACHE = "taskflow-v\d+-/.test(swJs.trim().split("\n")[0]), "prefix cache sw.js wajib tetap taskflow-v");
    assert.ok(tauriConf.includes('"identifier": "id.web.yatno.taskflow"'), "package id Android wajib tetap");
  });
});
