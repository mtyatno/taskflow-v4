const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const indexHtml = fs.readFileSync(path.join(__dirname, "../../static/index.html"), "utf8");
const sw = fs.readFileSync(path.join(__dirname, "../../static/sw.js"), "utf8");

function sliceFn(name) {
  const s = indexHtml.indexOf("function " + name + "(");
  assert.ok(s > 0, name + " ada");
  const e = indexHtml.indexOf("\nfunction ", s + 10);
  assert.ok(e > s, name + " slice");
  return indexHtml.slice(s, e);
}
const notes = sliceFn("NotesPage");
const petakan = sliceFn("PetakanButton");
// Header + toolbar note view (komponen yang memuat onPin(note.id)).
const hdrStart = indexHtml.lastIndexOf("\nfunction ", indexHtml.indexOf("onPin(note.id)"));
const noteView = indexHtml.slice(hdrStart, indexHtml.indexOf("\nfunction ", hdrStart + 10));
// Teks toast dan komentar bukan ikon UI.
const ui = notes.split("\n").filter(l => !/showToast\(/.test(l) && !/^\s*\/\//.test(l)).join("\n");

const NEW_KEYS = ["nPin", "nBrain", "nNote", "nTag", "nTagOff", "nStar", "nChevronDown", "nChevronUp", "nBacklink"];

test("NotesPage bebas emoji/simbol ikon lama", () => {
  for (const ch of ["📝", "🔍", "⭐", "🏷", "⬜", "📌", "👥", "🔗", "☰", "▤", "▴", "▾", "✕"]) {
    assert.ok(!ui.includes(ch), "tersisa: " + ch);
  }
});

test("NotesPage bebas escape \\u emoji", () => {
  assert.ok(!/\\uD83[CDE]|\\u2B[0-9A-F]{2}|\\u2[67][0-9A-F]{2}/i.test(ui));
});

test("VIEW_GLYPHS memuat 9 glyph baru", () => {
  const block = indexHtml.slice(indexHtml.indexOf("const VIEW_GLYPHS = {"), indexHtml.indexOf("function ViewGlyph("));
  for (const k of NEW_KEYS) assert.match(block, new RegExp("\\b" + k + ":\\s*'<"), "glyph " + k);
});

test("NotesPage memakai glyph yang ditentukan", () => {
  for (const [k, s] of [["nNote", 20], ["nNote", 44], ["fX", 15], ["fX", 13], ["fSearch", 15], ["nStar", 14], ["nStar", 13],
    ["nChevronUp", 14], ["nChevronDown", 14], ["nChevronDown", 12], ["nTag", 14], ["nTagOff", 13], ["nTagOff", 11],
    ["nPin", 12], ["mUsers", 12], ["mLink", 11], ["nBacklink", 11], ["fTrash", 15]]) {
    assert.match(notes, new RegExp('name:\\s*"' + k + '",\\s*size:\\s*' + s + "\\b"), k + " " + s);
  }
  assert.match(notes, /viewMode === "card" \? "compact" : "normal"/);
  assert.match(notes, /title: "Dibagikan ke workspace"/);
  assert.match(notes, /className: "wsf-title-ico"/);
  assert.match(notes, /Catatan \(\$\{/);
});

test("versi SW di-bump", () => {
  assert.match(sw, /taskflow-v459-task-selesai-instan/);
  assert.match(indexHtml, /taskflow-v459-task-selesai-instan/);
  assert.ok(!/taskflow-v44[0-3]-/.test(indexHtml));
});

test("PetakanButton: ViewGlyph nBrain, tanpa emoji", () => {
  assert.ok(!petakan.includes("\u{1F9E0}"), "🧠 tersisa");
  assert.ok(!/\\uD83E\\uDDE0/i.test(petakan));
  assert.match(petakan, /name:\s*"nBrain",\s*size:\s*14/);
  assert.match(petakan, /"Buka peta"/);
  assert.match(petakan, /"Petakan"/);
  assert.match(petakan, /gap:\s*5/);
  assert.match(petakan, /display:\s*"inline-flex"/);
});

test("Note view: pin toolbar nPin + aria-pressed, badge Bersama mUsers", () => {
  assert.match(noteView, /name:\s*"nPin",\s*size:\s*15/);
  assert.match(noteView, /"aria-pressed":\s*!!note\.pinned/);
  assert.ok(!/name:\s*"pin",\s*size:\s*15/.test(noteView), "Icon pin lama tersisa");
  assert.match(noteView, /name:\s*"mUsers",\s*size:\s*12/);
  assert.ok(!/\\uD83D\\uDC65/i.test(noteView) && !noteView.includes("\u{1F465}"), "👥 tersisa");
  assert.match(noteView, /"Bersama"/);
});
