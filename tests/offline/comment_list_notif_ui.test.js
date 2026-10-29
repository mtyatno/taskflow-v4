"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../..");
const indexHtml = fs.readFileSync(path.join(root, "static/index.html"), "utf8").replace(/\r\n/g, "\n");
const swJs = fs.readFileSync(path.join(root, "static/sw.js"), "utf8");
const css = fs.readFileSync(path.join(root, "static/app.css"), "utf8");
const tag = (f) => `<script src="/static/offline/${f}"></script>`;

function sliceFrom(marker, len) {
  const i = indexHtml.indexOf(marker);
  assert.ok(i > 0, marker);
  return indexHtml.slice(i, i + len);
}

test("note-card memuat badge komentar terbuka", () => {
  const src = sliceFrom("note-card${viewMode", 4000);
  assert.ok(src.includes("cmt-badge"));
  assert.ok(src.includes("comment_open_count"));
  assert.ok(src.includes("comment_unread"));
  assert.ok(src.includes("komentar terbuka"));
  assert.ok(src.includes("ada yang baru"));
  assert.ok(src.includes('"fChat"'));
  assert.ok(/\.cmt-badge\.is-unread/.test(css));
  assert.ok(/\[data-theme="dark"\] \.cmt-badge/.test(css));
});

test("panel notifikasi: item note_id membuka komentar", () => {
  const src = sliceFrom('showNotifPanel && /*#__PURE__*/React.createElement("div"', 5000);
  assert.ok(src.includes("n.note_id"));
  assert.ok(src.includes("requestOpen("));
  assert.ok(src.includes("setPendingNoteId(n.note_id)"));
  assert.ok(src.includes('setPage("notes")'));
  assert.ok(src.includes("setShowNotifPanel(false)"));
  assert.ok(src.includes("openTaskById(n.task_id)"));
});

test("index.html memuat commentui & commenthighlight setelah commentroutes", () => {
  const r = indexHtml.indexOf(tag("commentroutes.js"));
  const u = indexHtml.indexOf(tag("commentui.js"));
  const h = indexHtml.indexOf(tag("commenthighlight.js"));
  assert.ok(r > 0 && u > r && h > r);
});

test("sw.js precache modul dan versi baru", () => {
  assert.ok(swJs.includes('"/static/offline/commentui.js"'));
  assert.ok(swJs.includes('"/static/offline/commenthighlight.js"'));
  assert.ok(swJs.includes('const CACHE = "taskflow-v487-domain-alurik"'));
  assert.ok(indexHtml.includes('window.__SW_VERSION = "taskflow-v487-domain-alurik"'));
  assert.ok(indexHtml.includes("app.css?v=382"));
});

test("NotePanel memasang dan melepas listener tf:comments-open", () => {
  assert.ok(indexHtml.includes('window.addEventListener("tf:comments-open"'));
  assert.ok(indexHtml.includes('window.removeEventListener("tf:comments-open"'));
});
