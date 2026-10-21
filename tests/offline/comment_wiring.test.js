"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../..");
const indexHtml = fs.readFileSync(path.join(root, "static/index.html"), "utf8").replace(/\r\n/g, "\n");
const swJs = fs.readFileSync(path.join(root, "static/sw.js"), "utf8");
const FILES = ["commentanchor.js", "commentrepo.js", "commentroutes.js"];
const tag = (f) => `<script src="/static/offline/${f}"></script>`;

test("index.html memuat ketiga modul komentar sebelum taskroutes.js", () => {
  const task = indexHtml.indexOf(tag("taskroutes.js"));
  assert.ok(task > 0);
  for (const f of FILES) {
    const i = indexHtml.indexOf(tag(f));
    assert.ok(i > 0 && i < task, f + " harus dimuat sebelum taskroutes.js");
  }
  assert.ok(indexHtml.indexOf(tag("commentrepo.js")) < indexHtml.indexOf(tag("noteroutes.js")));
  assert.ok(indexHtml.indexOf(tag("commentanchor.js")) < indexHtml.indexOf(tag("noteroutes.js")));
  assert.ok(indexHtml.indexOf(tag("commentroutes.js")) > indexHtml.indexOf(tag("chatroutes.js")));
});

test("fullSync memanggil pullComments setelah pullNotesAndReconcile dan sebelum mindmap", () => {
  const n = indexHtml.indexOf("pullNotesAndReconcile(__syncRawFetch)");
  const c = indexHtml.indexOf("pullComments(__syncRawFetch)");
  const m = indexHtml.indexOf("pullMindmapsAndReconcile(__syncRawFetch)", c);
  assert.ok(n > 0 && c > n && m > c);
  assert.ok(indexHtml.includes('"tf:comments-changed"'));
});

test("sw.js mem-precache ketiga modul komentar dan versi v453", () => {
  for (const f of FILES) assert.ok(swJs.includes(`"/static/offline/${f}"`), f);
  assert.ok(swJs.includes('"taskflow-v453-email-mailer"'));
  assert.ok(indexHtml.includes('window.__SW_VERSION = "taskflow-v453-email-mailer"'));
});
