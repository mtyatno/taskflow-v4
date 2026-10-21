"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const html = fs.readFileSync(path.join(__dirname, "../../static/index.html"), "utf8");
function slice(src, a, b) {
  const s = src.indexOf(a); assert.ok(s !== -1, a + " harus ada");
  const e = src.indexOf(b, s + a.length); assert.ok(e !== -1, b + " harus ada setelah " + a);
  return src.slice(s, e);
}

test("NoteTrashModal has Catatan/Mindmap tabs; MindmapTrashList uses TF.mindmaptrash", () => {
  const m = slice(html, "function NoteTrashModal(", "\nfunction ");
  assert.match(m, /initialKind = "note"/);
  assert.match(m, /"Catatan"/); assert.match(m, /"Mindmap"/);
  assert.match(m, /MindmapTrashList/);
  const l = slice(html, "function MindmapTrashList(", "\nfunction ");
  assert.match(l, /api\.get\("\/api\/mindmaps\/trash"\)/);
  assert.match(l, /pullMindmapTrash\(/);
  assert.match(l, /\/api\/mindmaps\/trash\/\$\{/);
  assert.match(l, /PURGE_OFFLINE_MSG/);
  assert.match(l, /SOURCE_MISSING_MSG/);
  assert.match(l, /PENDING_LABEL/);
});

test("MindmapPage: Sampah button, workspace filter via filterSidebar, shared badge", () => {
  const p = slice(html, "function MindmapPage(", "\nfunction ");
  assert.match(p, /name: "fTrash", size: 14 \}\), "Sampah"/);
  assert.match(p, /initialKind: "mindmap"/);
  assert.match(p, /filterSidebar\(/);
  assert.match(p, /tf_mindmap_filter/);
  assert.match(p, /"Semua peta"/); assert.match(p, /"Pribadi"/);
  const li = slice(html, "function MindmapListItem(", "\nfunction ");
  assert.match(li, /sharedName/);
  assert.match(li, /Dibagikan ke/);
});

test("Tab delete moves to Sampah and is hidden for non-owners of normal maps", () => {
  const t = slice(html, "function MindmapTabInstance(", "\nconst MINDMAP_DIRECTIONS");
  assert.match(t, /"Pindahkan ke Sampah\?"/);
  assert.match(t, /mindmaptrash\??\.TOAST_MOVED/);
  assert.match(t, /\(isLinked \? !isNoteOwner : !isOwner\) \? null/);
});

test("LinkPickerModal uses filterExistingTargets; global search shows mindmap snippet", () => {
  assert.match(slice(html, "function LinkPickerModal(", "\nfunction "), /filterExistingTargets\(/);
  assert.match(html, /mm\.snippet && \/\*#__PURE__\*\/React\.createElement/);
});
