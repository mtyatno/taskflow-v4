"use strict";
// Kanban Task 6 — drag dengan Pointer Events: helper murni (di-slice dari index.html) + pemeriksaan sumber.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "../..");
const indexHtml = fs.readFileSync(path.join(ROOT, "static/index.html"), "utf8").replace(/\r\n/g, "\n");

function sliceFn(startMarker, endMarker) {
  const start = indexHtml.indexOf(startMarker);
  assert.ok(start > 0, `${startMarker} harus ada`);
  const end = indexHtml.indexOf(endMarker, start + startMarker.length);
  assert.ok(end > start, `${endMarker} harus ada setelah ${startMarker}`);
  return indexHtml.slice(start, end);
}

function load(documentStub) {
  const code = sliceFn("function kanbanDragStart(", "function KanbanCard(");
  return new Function("document",
    `${code}; return { kanbanDragStart, kanbanDragShouldStart, kanbanAutoScrollDelta, kanbanColumnAt };`)(documentStub || {});
}

const ev = (type, x, y) => ({ pointerType: type, clientX: x, clientY: y });

test("kanbanDragStart merekam jenis pointer, posisi, waktu", () => {
  const H = load();
  assert.deepEqual(H.kanbanDragStart(ev("touch", 10, 20), 1000), { pointerType: "touch", x: 10, y: 20, t: 1000 });
  assert.equal(H.kanbanDragStart({ clientX: 1, clientY: 2 }, 5).pointerType, "mouse");
});

test("kanbanDragShouldStart: mouse/pen mulai pada jarak >= 6 px", () => {
  const H = load();
  for (const type of ["mouse", "pen"]) {
    const s = H.kanbanDragStart(ev(type, 100, 100), 0);
    assert.equal(H.kanbanDragShouldStart(s, ev(type, 105, 100), 10), false);
    assert.equal(H.kanbanDragShouldStart(s, ev(type, 106, 100), 10), true);
    assert.equal(H.kanbanDragShouldStart(s, ev(type, 100, 94), 10), true);
    assert.equal(H.kanbanDragShouldStart(s, ev(type, 104, 104), 10), false); // ~5.66
  }
});

test("kanbanDragShouldStart: sentuh diam >= 250 ms mulai, sebelumnya tidak", () => {
  const H = load();
  const s = H.kanbanDragStart(ev("touch", 100, 100), 1000);
  assert.equal(H.kanbanDragShouldStart(s, ev("touch", 100, 100), 1249), false);
  assert.equal(H.kanbanDragShouldStart(s, ev("touch", 100, 100), 1250), true);
  assert.equal(H.kanbanDragShouldStart(s, ev("touch", 103, 100), 1300), true);
});

test("kanbanDragShouldStart: sentuh bergerak >= 6 px tidak pernah mulai (scroll)", () => {
  const H = load();
  const s = H.kanbanDragStart(ev("touch", 100, 100), 0);
  assert.equal(H.kanbanDragShouldStart(s, ev("touch", 108, 100), 100), false);
  assert.equal(H.kanbanDragShouldStart(s, ev("touch", 108, 100), 400), false);
  assert.equal(H.kanbanDragShouldStart(s, ev("touch", 100, 130), 5000), false);
});

test("kanbanAutoScrollDelta: tepi kiri negatif, kanan positif, tengah 0, maks 16", () => {
  const H = load();
  const rect = { left: 100, right: 700 };
  assert.equal(H.kanbanAutoScrollDelta(400, rect), 0);
  assert.equal(H.kanbanAutoScrollDelta(140, rect), 0);
  assert.equal(H.kanbanAutoScrollDelta(660, rect), 0);
  assert.ok(H.kanbanAutoScrollDelta(120, rect) < 0);
  assert.ok(H.kanbanAutoScrollDelta(680, rect) > 0);
  assert.equal(H.kanbanAutoScrollDelta(100, rect), -16);
  assert.equal(H.kanbanAutoScrollDelta(700, rect), 16);
  assert.equal(H.kanbanAutoScrollDelta(-500, rect), -16);
  assert.equal(H.kanbanAutoScrollDelta(5000, rect), 16);
  for (let x = 90; x <= 710; x += 5) assert.ok(Math.abs(H.kanbanAutoScrollDelta(x, rect)) <= 16);
});

test("kanbanColumnAt: key kolom dari elementFromPoint().closest, null bila tidak ada", () => {
  const col = { getAttribute: (n) => (n === "data-kanban-col" ? "ctx:7" : null) };
  const inside = { closest: (sel) => (sel === "[data-kanban-col]" ? col : null) };
  const outside = { closest: () => null };
  let at = null;
  const H = load({ elementFromPoint: (x, y) => { at = [x, y]; return x < 50 ? inside : x < 100 ? outside : null; } });
  assert.equal(H.kanbanColumnAt(10, 20), "ctx:7");
  assert.deepEqual(at, [10, 20]);
  assert.equal(H.kanbanColumnAt(60, 20), null);
  assert.equal(H.kanbanColumnAt(500, 20), null);
});

test("sumber: blok Kanban tanpa HTML5 drag; memakai pointer events", () => {
  const block = sliceFn("function kanbanDragStart(", "// ── GTD Inbox Wizard");
  assert.doesNotMatch(block, /draggable: (?!false)/);
  assert.doesNotMatch(block, /dataTransfer/);
  assert.doesNotMatch(block, /onDragStart|onDragOver|onDrop\b|onDragEnd|onDragLeave/);
  assert.doesNotMatch(block, /dragSourceRef/);
  assert.match(block, /data-kanban-col"/);
  assert.match(block, /setPointerCapture/);
  assert.match(block, /touchAction: "pan-y"/);
  assert.match(block, /"Escape"/);
  assert.match(block, /pointercancel/);
  assert.match(block, /requestAnimationFrame/);
  assert.match(block, /tabIndex: 0/);
  assert.match(block, /"Enter"/);
  assert.match(block, /pointer-events:\s*none/);
  assert.doesNotMatch(block, /parseInt\(/);
  assert.doesNotMatch(indexHtml, /dragSourceRef/);
});
