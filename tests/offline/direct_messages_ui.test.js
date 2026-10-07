"use strict";

// Pesan Pribadi (DM 1-on-1) di halaman Diskusi.
// Spec: docs/superpowers/specs/2026-10-03-direct-messages-design.md

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../..");
const indexHtml = fs.readFileSync(path.join(root, "static/index.html"), "utf8").replace(/\r\n/g, "\n");
const swJs = fs.readFileSync(path.join(root, "static/sw.js"), "utf8");
const taskroutes = fs.readFileSync(path.join(root, "static/offline/taskroutes.js"), "utf8");

function fnSource(name) {
  const start = indexHtml.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} must exist`);
  const end = indexHtml.indexOf("\n}\n", start);
  assert.ok(end > start, `${name} end must be found`);
  return indexHtml.slice(start, end);
}

test("DM components exist", () => {
  for (const name of ["DmRoom", "DmInputBar", "DmContactPicker", "ChatListPanel", "ChatPage"]) {
    fnSource(name);
  }
});

test("ChatListPanel has Grup and Pesan Pribadi sections, new-DM button, unread badge, combined search", () => {
  const src = fnSource("ChatListPanel");
  assert.match(src, /label: "Grup"/);
  assert.match(src, /label: "Pesan Pribadi"/);
  assert.match(src, /onNewDm/);
  assert.match(src, /(＋|\\uFF0B)/, "＋ button");
  assert.match(src, /dm-unread-badge/);
  assert.match(src, /filteredDms/);
  assert.match(src, /Cari grup atau orang/);
});

test("ChatPage distinguishes group vs DM selection and refreshes DM list periodically", () => {
  const src = fnSource("ChatPage");
  assert.match(src, /kind: "group"/);
  assert.match(src, /kind: "dm"/);
  assert.match(src, /has-selection/);
  assert.match(src, /\/api\/dm\/conversations/);
  assert.match(src, /setInterval\(loadDms/);
  assert.match(src, /clearInterval/);
  assert.match(src, /key: "g" \+ selected\.id/);
  assert.match(src, /key: "d" \+ selected\.id/);
  assert.match(src, /DmContactPicker/);
});

test("DmRoom uses DM endpoints, SSE with token pattern, marks read, reuses chat classes", () => {
  const src = fnSource("DmRoom");
  assert.match(src, /\/api\/dm\/conversations\/\$\{conv\.id\}\/messages\?limit=50/);
  assert.match(src, /before_id=/);
  assert.match(src, /\/api\/dm\/conversations\/\$\{conv\.id\}\/stream/);
  assert.match(src, /new EventSource/);
  assert.match(src, /encodeURIComponent\(__token\)/);
  assert.match(src, /\/api\/dm\/conversations\/\$\{conv\.id\}\/read/);
  assert.match(src, /Pesan pribadi/);
  for (const cls of ["chat-room-header", "chat-messages", "chat-bubble-wrap", "chat-bubble", "chat-quote-block", "chat-reply-btn"]) {
    assert.ok(src.includes(cls), `DmRoom uses ${cls}`);
  }
  assert.match(src, /renderMessageContent\(/);
  assert.ok(!src.includes("chatrepo"), "DM tidak memakai chatrepo");
});

test("DmInputBar posts to DM endpoint with reply and client_id, no attachments", () => {
  const src = fnSource("DmInputBar");
  assert.match(src, /api\.post\(`\/api\/dm\/conversations\/\$\{conv\.id\}\/messages`/);
  assert.match(src, /reply_to_id/);
  assert.match(src, /client_id/);
  assert.match(src, /chat-input-bar/);
  assert.match(src, /chat-send-btn/);
  assert.match(src, /chat-reply-preview/);
  assert.ok(!src.includes("AttachPopup"));
  assert.ok(!src.includes("task_id"));
});

test("DmContactPicker loads contacts and is searchable", () => {
  const src = fnSource("DmContactPicker");
  assert.match(src, /\/api\/dm\/contacts/);
  assert.match(src, /setQuery/);
  assert.match(src, /chat-list-item/);
});

test("group chat still uses ChatRoom + chatrepo", () => {
  const src = fnSource("ChatRoom");
  assert.match(src, /window\.TF\.chatrepo\.upsertIncoming/);
  assert.match(src, /\/api\/lists\/\$\{list\.id\}\/messages\/stream/);
});

test("DM endpoints are online-only (not in local router), SW network-only + v364", () => {
  assert.ok(!taskroutes.includes("/api/dm"), "taskroutes must not register /api/dm");
  assert.match(swJs, /^const CACHE = "taskflow-v374-mobile-pomodoro-second-row";/m);
  assert.match(swJs, /url\.pathname\.startsWith\("\/api\/dm\/"\)/);
});

test("DmRoom re-syncs latest messages after SSE reconnect and marks read", () => {
  const src = fnSource("DmRoom");
  assert.match(src, /es\.onopen = \(\) => \{\s*if \(hasOpened\) resyncAfterReconnect\(\);\s*hasOpened = true;/);
  const i = src.indexOf("const resyncAfterReconnect");
  assert.ok(i >= 0, "resyncAfterReconnect must exist");
  const body = src.slice(i, src.indexOf("es.onopen", i));
  assert.match(body, /\/api\/dm\/conversations\/\$\{conv\.id\}\/messages\?limit=50/);
  assert.match(body, /dmMergeMessage/);
  assert.match(body, /markReadThenRefresh\(\)/);
});

test("DM list refresh happens after mark-read resolves; Back zeroes the badge", () => {
  const room = fnSource("DmRoom");
  assert.match(room, /const markReadThenRefresh = \(\) => markRead\(\)\.then\(\(\) => \{\s*onActivity && onActivity\(\);/);
  assert.ok(!/markRead\(\);\s*onActivity && onActivity\(\)/.test(room), "markRead and refresh must not run in parallel");
  const page = fnSource("ChatPage");
  assert.match(page, /onBack: \(\) => \{\s*markDmReadLocal\(selected\.id\);\s*setSelected\(null\);/);
  assert.match(page, /dmReadAtRef/);
});

test("DM input placeholder is short (no wrap on 390px)", () => {
  const src = fnSource("DmInputBar");
  assert.match(src, /placeholder: `Pesan untuk \$\{otherName\}\.\.\.`/);
  assert.ok(!src.includes("Shift+Enter untuk baris baru)`"));
});

test("DmRoom header ⋯ menu toggles Blokir / Buka blokir with confirm before blocking", () => {
  const src = fnSource("DmRoom");
  assert.match(src, /className: "dm-menu-btn"/);
  assert.match(src, /\\u22EF|⋯/);
  assert.match(src, /`Blokir \$\{otherName\}`/);
  assert.match(src, /"Buka blokir"/);
  assert.match(src, /window\.confirm\(`Blokir \$\{otherName\}\? Kalian berdua tidak bisa saling mengirim pesan sampai blokir dibuka\.`\)/);
  assert.match(src, /api\.post\(`\/api\/dm\/conversations\/\$\{conv\.id\}\/block`/);
  assert.match(src, /api\.del\(`\/api\/dm\/conversations\/\$\{conv\.id\}\/block`\)/);
  assert.match(src, /applyBlockResponse[\s\S]*?onActivity && onActivity\(\)/, "refresh list after block/unblock");
});

test("DmRoom replaces input with blocked notice", () => {
  const src = fnSource("DmRoom");
  assert.match(src, /isBlocked \? \/\*#__PURE__\*\/React\.createElement\("div", \{\s*className: "chat-input-bar dm-blocked-notice"/);
  assert.match(src, /"Kamu memblokir ", otherName, "\."/);
  assert.match(src, /"Kamu tidak bisa membalas obrolan ini\."/);
  assert.match(src, /onBlocked: handleBlockedSend/);
  assert.match(src, /blocked_by_me/);
  assert.match(src, /blocked_by_other/);
});

test("DmInputBar handles 403 blocked send", () => {
  const src = fnSource("DmInputBar");
  assert.match(src, /err\.status === 403 && err\.message === "Obrolan ini diblokir" && onBlocked/);
});

test("ChatPage passes refreshed conversation (block flags) to DmRoom", () => {
  const src = fnSource("ChatPage");
  assert.match(src, /conv: dmConversations\.find\(c => c\.id === selected\.id\) \|\| selected\.conv/);
});

test("Daftar Diskusi: item aktif tanpa garis warna (preferensi Bapak)", () => {
  const css = require("fs").readFileSync(require("path").join(__dirname, "../../static/app.css"), "utf8");
  const rule = css.match(/\.chat-list-item\.active\s*\{[^}]*\}/);
  assert.ok(rule, ".chat-list-item.active harus ada");
  assert.doesNotMatch(rule[0], /border-left/);
});
