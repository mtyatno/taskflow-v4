"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const indexHtml = fs.readFileSync(path.resolve(__dirname, "../../static/index.html"), "utf8");

test("Slash query /draw dihapus sebelum insert", async (t) => {
  await t.test("case draw menghapus teks query slash lalu panggil callback", () => {
    const m = indexHtml.match(/case 'draw':\s*\{[\s\S]*?lastIndexOf\("\/"\)[\s\S]*?state\.tr\.delete\(qFrom2\.start\(\) \+ slashIdx2, qFrom2\.pos\)[\s\S]*?onInsertDrawingRef\.current\?\.\(\)[\s\S]*?\}\s*break;/);
    assert.ok(m, "case 'draw' harus menghapus query slash (delete) lalu panggil onInsertDrawingRef");
  });

  await t.test("case lain tak berubah (heading tetap setBlockType)", () => {
    assert.match(indexHtml, /case 'heading':\s*tr = tr\.setBlockType\(from, to, state\.schema\.nodes\.heading, \{ level: payload \}\)/, "case heading tak berubah");
  });
});
