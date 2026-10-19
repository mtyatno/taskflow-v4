"use strict";

// PR 3 Task 3: halaman Draw — share ke workspace, badge, filter scope, aksi khusus pemilik.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const html = fs.readFileSync(path.resolve(__dirname, "../../static/index.html"), "utf8");

const drawPage = () => (html.match(/function DrawPage\(\{[\s\S]*?\nfunction /) || [""])[0];
const listItem = () => (html.match(/function DrawingListItem\([\s\S]*?\nfunction DrawingTabInstance/) || [""])[0];
const tabInst = () => (html.match(/function DrawingTabInstance\([\s\S]*?\nfunction DrawPage/) || [""])[0];
function helper(name) {
  const m = html.match(new RegExp("function " + name + "\\([^)]*\\) \\{[\\s\\S]*?\\n\\}"));
  assert.ok(m, name + " harus ada sebagai fungsi top-level");
  return new Function("return (" + m[0] + ");")();
}

test("drawingIsOwner: legacy tanpa user_id = pemilik; fallback ke currentUserId", () => {
  const f = helper("drawingIsOwner");
  const saved = global.TF;
  try {
    global.window = global;
    global.TF = { drawingrepo: { currentUid: () => 7 } };
    assert.equal(f({ user_id: null }, null), true);
    assert.equal(f({ user_id: 7 }, null), true);
    assert.equal(f({ user_id: 8 }, null), false);
    global.TF = { drawingrepo: { currentUid: () => null } };
    assert.equal(f({ user_id: 8 }, 8), true);
    assert.equal(f({ user_id: 8 }, 9), false);
  } finally { global.TF = saved; delete global.window; }
});

test("drawingScopeMatches: Semua / Pribadi / W", () => {
  const f = helper("drawingScopeMatches");
  assert.equal(f({ list_id: 3 }, "all"), true);
  assert.equal(f({ list_id: null }, "personal"), true);
  assert.equal(f({ list_id: 3 }, "personal"), false);
  assert.equal(f({ list_id: 3 }, 3), true);
  assert.equal(f({ list_id: 3 }, "3"), true);
  assert.equal(f({ list_id: 4 }, 3), false);
  assert.equal(f({ list_id: null }, 3), false);
});

test("DrawPage passes sharedLists and filters by scope (Semua/Pribadi/W)", () => {
  const b = drawPage();
  assert.match(b, /sharedLists = \[\]/);
  assert.match(b, /drawingScopeMatches\(d, scopeFilter\)/);
  assert.match(b, /"Semua"/);
  assert.match(b, /"Pribadi"/);
  assert.match(b, /sharedLists\.map\(/);
  // buat baru saat filter = W → list_id W
  assert.match(b, /list_id: newListId/);
  assert.match(b, /newListId = scopeFilter !== "all" && scopeFilter !== "personal" \? scopeFilter : null/);
  assert.match(b, /sharedLists: sharedLists/);
});

test("DrawingListItem shows 👥 badge and hides pin for non-owner", () => {
  const b = listItem();
  assert.match(b, /projectWorkspaceBadge\(d\.list_id, sharedLists\)/);
  assert.match(b, /oleh \$\{d\.last_editor_username\}|"oleh "/);
  assert.match(b, /drawingIsOwner\(d, currentUserId\)/);
  assert.match(b, /isOwner && \(hovered \|\| !!d\.is_pinned\)|\(hovered \|\| !!d\.is_pinned\) && isOwner/);
});

test("DrawingTabInstance share uses TF.drawingshare.shareDrawing and renders DRAWING_IN_USE dialog text", () => {
  const b = tabInst();
  assert.match(b, /TF\.drawingshare\.shareDrawing\(api, tab, listId\)/);
  assert.match(b, /Drawing masih dipakai/);
  assert.match(b, /dan \$\{inUse\.hidden_count\} note lain/);
  assert.match(b, /Buat salinan pribadi sebagai gantinya\./);
  assert.match(b, /Jadikan salinan pribadi/);
  assert.match(b, /TF\.drawingshare\.copyDrawing\(api, tab, null\)/);
  assert.match(b, /"Tutup"/);
  assert.match(b, /👥 Share/);
  assert.match(b, /isOwner && sharedLists\.length > 0/);
  assert.match(b, /last_editor_username/);
  assert.match(b, /Dipakai di: /);
  assert.match(b, /Butuh koneksi untuk membagikan gambar\.|res\.message/);
  assert.doesNotMatch(b, /window\.alert|\balert\(/);
});

test("non-owner has no delete/rename-delete/pin/share actions in the tab toolbar", () => {
  const b = tabInst();
  assert.match(b, /isOwner \? /);
  assert.match(b, /onPin && isOwner|isOwner && \/\*#__PURE__\*\/React\.createElement\("button", \{\s*className: "btn btn-secondary btn-sm",\s*onClick: \(\) => onPin/);
});

test("App passes sharedLists and currentUserId to DrawPage", () => {
  const m = html.match(/React\.createElement\(DrawPage, \{[\s\S]*?\n      \}\);/);
  assert.ok(m, "pemanggilan DrawPage");
  assert.match(m[0], /sharedLists: sharedLists/);
  assert.match(m[0], /currentUserId: user\?\.id/);
});
