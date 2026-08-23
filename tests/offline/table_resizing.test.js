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

test("static/vendor/milkdown.bundle.js exports table commands and column resizing plugin", async (t) => {
  const vm = require("node:vm");
  const bundlePath = path.resolve(__dirname, "../../static/vendor/milkdown.bundle.js");
  const bundleContent = fs.readFileSync(bundlePath, "utf8");

  const win = {
    navigator: { userAgent: "Node.js", platform: "Win32" },
    document: {
      documentElement: { style: {} },
      createElement: () => ({ setAttribute: () => {}, querySelector: () => null }),
      createRange: () => ({ setStart: () => {}, setEnd: () => {}, detach: () => {} }),
      head: { appendChild: () => {} },
      body: { appendChild: () => {} }
    },
    customElements: { get: () => null, define: () => {} },
    HTMLElement: class {},
    CSS: { supports: () => false }
  };
  win.window = win;
  win.self = win;
  win.globalThis = win;

  const ctx = vm.createContext(win);
  vm.runInContext(bundleContent, ctx);
  const MB = ctx.MilkdownBundle;

  await t.test("MilkdownBundle is loaded and defined", () => {
    assert.ok(MB, "MilkdownBundle should be defined");
    assert.equal(typeof MB.Editor, "function", "MB.Editor should be a function/class");
  });

  await t.test("MilkdownBundle exports columnResizingPlugin and tableEditingPlugin", () => {
    assert.ok(MB.columnResizingPlugin, "MB.columnResizingPlugin should be exported");
    assert.ok(MB.tableEditingPlugin, "MB.tableEditingPlugin should be exported");
  });

  await t.test("MilkdownBundle exports table editing commands", () => {
    assert.ok(MB.addRowBeforeCommand, "MB.addRowBeforeCommand should be exported");
    assert.ok(MB.addRowAfterCommand, "MB.addRowAfterCommand should be exported");
    assert.ok(MB.addColBeforeCommand, "MB.addColBeforeCommand should be exported");
    assert.ok(MB.addColAfterCommand, "MB.addColAfterCommand should be exported");
    assert.ok(MB.setAlignCommand, "MB.setAlignCommand should be exported");
    assert.ok(MB.selectRowCommand, "MB.selectRowCommand should be exported");
    assert.ok(MB.selectColCommand, "MB.selectColCommand should be exported");
    assert.ok(MB.selectTableCommand, "MB.selectTableCommand should be exported");
    assert.ok(MB.deleteSelectedCellsCommand, "MB.deleteSelectedCellsCommand should be exported");
    assert.ok(MB.insertTableCommand, "MB.insertTableCommand should be exported");
  });

  await t.test("MilkdownBundle exports prosemirror-tables primitives", () => {
    assert.ok(MB.columnResizing, "MB.columnResizing should be exported");
    assert.ok(MB.tableEditing, "MB.tableEditing should be exported");
  });
});

test("static/index.html integrates milkdown.bundle.js and registers columnResizingPlugin", async (t) => {
  const indexPath = path.resolve(__dirname, "../../static/index.html");
  const indexContent = fs.readFileSync(indexPath, "utf8");

  await t.test("loads milkdown.bundle.js with ?v=288 cache query", () => {
    assert.match(
      indexContent,
      /<script\s+src="\/static\/vendor\/milkdown\.bundle\.js\?v=288"><\/script>/i,
      "Expected milkdown.bundle.js?v=288 script tag in static/index.html"
    );
  });

  await t.test("registers MB.columnResizingPlugin in MilkdownEditor .use() chain", () => {
    assert.match(
      indexContent,
      /\.use\(MB\.columnResizingPlugin\s*\|\|\s*\[\]\)/,
      "Expected .use(MB.columnResizingPlugin || []) in MilkdownEditor chain"
    );
  });
});

