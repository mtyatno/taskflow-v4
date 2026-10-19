"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const OPS = require("../../static/offline/mindmapops.js");

const el = (tag, parent) => ({ tagName: tag, parentElement: parent });

test("isNodeTopicTarget: hanya me-tpc di dalam ME-PARENT / ME-ROOT", () => {
  const parent = el("ME-PARENT", el("ME-CHILD", null));
  assert.equal(OPS.isNodeTopicTarget(el("ME-TPC", parent)), true);
  assert.equal(OPS.isNodeTopicTarget(el("ME-TPC", el("ME-ROOT", null))), true);
  assert.equal(OPS.isNodeTopicTarget(el("ME-TPC", el("ME-CHILD", null))), false);
  assert.equal(OPS.isNodeTopicTarget(null), false);
  assert.equal(OPS.isNodeTopicTarget(el("SPAN", parent)), false);
});

test("resolveTopicTarget: walk dari inner text ke me-tpc", () => {
  const parent = el("ME-PARENT", el("ME-CHILD", el("ME-CHILDREN", null)));
  const tpc = el("ME-TPC", parent);
  const span = el("SPAN", tpc);
  assert.equal(OPS.resolveTopicTarget(span), tpc);
  assert.equal(OPS.resolveTopicTarget(tpc), tpc);
  // tap di area kosong map / node tanpa parent valid
  assert.equal(OPS.resolveTopicTarget(el("DIV", el("ME-MAP", null))), null);
  assert.equal(OPS.resolveTopicTarget(el("ME-TPC", el("ME-CHILD", null))), null);
  assert.equal(OPS.resolveTopicTarget(null), null);
});

test("opsDisabledStates mirror flag root context menu engine", () => {
  assert.deepEqual(OPS.opsDisabledStates(true),
    { parent: true, focus: true, moveUp: true, moveDown: true, sibling: true, remove: true });
  assert.deepEqual(OPS.opsDisabledStates(false),
    { parent: false, focus: false, moveUp: false, moveDown: false, sibling: false, remove: false });
});

test("safeExportName: sanitasi karakter path-hostile, fallback, ekstensi", () => {
  assert.equal(OPS.safeExportName("Rencana Q3: /v1", "png"), "Rencana Q3- -v1.png");
  assert.equal(OPS.safeExportName('a\\b/c:d*e?f"g<h>i|j', "svg"), "a-b-c-d-e-f-g-h-i-j.svg");
  assert.equal(OPS.safeExportName("   ", "png"), "mindmap.png");
  assert.equal(OPS.safeExportName("", "svg"), "mindmap.svg");
  assert.equal(OPS.safeExportName(null, "png"), "mindmap.png");
  assert.equal(OPS.safeExportName("  Rencana   Akhir\tTahun  ", "png"), "Rencana Akhir-Tahun.png");
});

test("engineOptions linked vs normal", () => {
  const o = OPS.engineOptions(true, { openModal: () => "m", openPage: () => "p" });
  assert.equal(o.allowUndo, false); assert.equal(o.newTopicName, "Node baru");
  assert.equal(o.contextMenu.link, false);
  assert.deepEqual(o.contextMenu.extend.map((e) => e.name), ["📄 Buka di catatan", "↗ Buka di halaman Notes"]);
  assert.deepEqual(OPS.engineOptions(false, {}), { contextMenu: true });
});
test("isOpenNoteClick", () => {
  assert.equal(OPS.isOpenNoteClick({ button: 0, ctrlKey: true }), true);
  assert.equal(OPS.isOpenNoteClick({ button: 0, metaKey: true }), true);
  assert.equal(OPS.isOpenNoteClick({ button: 0 }), false);
});
test("hidden selectors cover arrows, summary, links tab and block formats", () => {
  for (const s of ["#ntb-link", "#ntb-summary", '.side-tab[data-tab="links"]', '#fmt-panel [data-act="table"]']) assert.ok(OPS.LINKED_HIDDEN_SELECTORS.includes(s));
});
// C10: mind.init() memasang ulang menu konteks, keypress & listener copy/paste
// setiap dipanggil. Peta tertaut dimuat ulang sering (undo, catatan berubah,
// modal ditutup) → menu ganda yang tidak menutup & tempel ganda. Muat ulang
// mesin yang sama untuk peta tertaut lewat refresh(), bukan init().
test("reloadEngine: tertaut → refresh + toCenter (tanpa init); biasa → init", () => {
  const calls = [];
  const fake = {
    init: (d) => calls.push(["init", d]),
    refresh: (d) => calls.push(["refresh", d]),
    toCenter: () => calls.push(["toCenter"]),
  };
  const data = { nodeData: { id: "r", topic: "R" } };
  OPS.reloadEngine(fake, data, true);
  assert.deepEqual(calls, [["refresh", data], ["toCenter"]]);
  calls.length = 0;
  OPS.reloadEngine(fake, data, false);
  assert.deepEqual(calls, [["init", data]]);
});
