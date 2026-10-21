"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const html = fs.readFileSync(path.join(__dirname, "../../static/index.html"), "utf8");
const css = fs.readFileSync(path.join(__dirname, "../../static/app.css"), "utf8");

test("WorkspaceAvatar memakai avatarFor dengan guard", () => {
  const i = html.indexOf("function WorkspaceAvatar");
  assert.ok(i > 0);
  const body = html.slice(i, i + 900);
  assert.match(body, /avatarFor/);
  assert.match(body, /window\.TF && window\.TF\.workspacepins/);
  assert.match(body, /ws-avatar ws-c/);
  assert.doesNotMatch(body, /dangerouslySetInnerHTML|innerHTML/);
});
test("rail tidak lagi memakai avatarColorIndex langsung", () => {
  assert.doesNotMatch(html, /sidebar-rail-ws-avatar ws-c\$\{WP \? WP\.avatarColorIndex\(w\.id\)/);
  assert.match(html, /sidebar-rail-ws-avatar/);
});
test("sidebar WORKSPACES memakai avatar, bukan clipboard/users", () => {
  assert.doesNotMatch(html, /icon: l\.role === "owner" \? "clipboard" : "users"/);
  assert.match(html, /avatarList: l/);
  assert.match(html, /l\.avatarList/);
});
test("judul halaman workspace merender avatar dan ws-page-desc bersyarat", () => {
  assert.match(html, /titleAvatarList/);
  assert.match(html, /description \? .*ws-page-desc|description && .*ws-page-desc/s);
});
test("app.css memuat .ws-avatar dan .ws-page-desc", () => {
  assert.match(css, /\.ws-avatar\s*\{/);
  assert.match(css, /\.ws-page-desc\s*\{/);
});
