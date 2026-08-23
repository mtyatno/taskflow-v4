"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const cssPath = path.resolve(__dirname, "../../static/app.css");
const cssContent = fs.readFileSync(cssPath, "utf8");

test("static/app.css contains table column resizing and selection rules", async (t) => {
  await t.test("has .tableWrapper styling with overflow-x: auto", () => {
    assert.match(
      cssContent,
      /\.milkdown-editor\s+\.ProseMirror\s+\.tableWrapper[\s\S]*?overflow-x:\s*auto;/i,
      "Expected .tableWrapper to set overflow-x: auto"
    );
  });

  await t.test("has table styling with table-layout: fixed and overflow: hidden", () => {
    assert.match(
      cssContent,
      /\.milkdown-editor\s+\.ProseMirror\s+table[\s\S]*?table-layout:\s*fixed;/i,
      "Expected .milkdown-editor .ProseMirror table to set table-layout: fixed"
    );
    assert.match(
      cssContent,
      /\.milkdown-editor\s+\.ProseMirror\s+table[\s\S]*?overflow:\s*hidden;/i,
      "Expected .milkdown-editor .ProseMirror table to set overflow: hidden"
    );
  });

  await t.test("has td and th with position: relative and box-sizing: border-box", () => {
    assert.match(
      cssContent,
      /\.milkdown-editor\s+\.ProseMirror\s+(?:td\s*,\s*\.milkdown-editor\s+\.ProseMirror\s+th|th\s*,\s*\.milkdown-editor\s+\.ProseMirror\s+td)[\s\S]*?position:\s*relative;/i,
      "Expected td/th in editor to have position: relative"
    );
  });

  await t.test("has .column-resize-handle styling", () => {
    assert.match(
      cssContent,
      /\.milkdown-editor\s+\.ProseMirror\s+\.column-resize-handle[\s\S]*?position:\s*absolute;/i,
      "Expected .column-resize-handle to have position: absolute"
    );
    assert.match(
      cssContent,
      /\.milkdown-editor\s+\.ProseMirror\s+\.column-resize-handle[\s\S]*?width:\s*4px;/i,
      "Expected .column-resize-handle to have width: 4px"
    );
  });

  await t.test("has .resize-cursor cursor: col-resize !important", () => {
    assert.match(
      cssContent,
      /\.milkdown-editor\s+\.ProseMirror\.resize-cursor[\s\S]*?cursor:\s*col-resize\s*!important;/i,
      "Expected .resize-cursor to have cursor: col-resize !important"
    );
  });

  await t.test("has .selectedCell:after styling for table cell selection overlay", () => {
    assert.match(
      cssContent,
      /\.milkdown-editor\s+\.ProseMirror\s+\.selectedCell:after[\s\S]*?background:\s*rgba\(59,\s*130,\s*246,\s*0\.2\);/i,
      "Expected .selectedCell:after to have cell selection overlay background"
    );
  });
});
