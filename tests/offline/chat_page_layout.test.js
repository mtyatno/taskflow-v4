"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const indexPath = path.resolve(__dirname, "../../static/index.html");
const indexHtml = fs.readFileSync(indexPath, "utf8");

const cssPath = path.resolve(__dirname, "../../static/app.css");
const appCss = fs.readFileSync(cssPath, "utf8");

const swPath = path.resolve(__dirname, "../../static/sw.js");
const swJs = fs.readFileSync(swPath, "utf8");

test("ChatPage Unified Container Layout and Redesign", async (t) => {
  // Extract ChatListPanel and ChatPage component code
  const chatListPanelMatch = indexHtml.match(/function ChatListPanel\([\s\S]*?^function /m);
  const chatListPanelCode = chatListPanelMatch ? chatListPanelMatch[0] : "";
  assert.ok(chatListPanelCode.length > 0, "ChatListPanel function should be present in static/index.html");

  const chatPageMatch = indexHtml.match(/function ChatPage\([\s\S]*?^function /m);
  const chatPageCode = chatPageMatch ? chatPageMatch[0] : "";
  assert.ok(chatPageCode.length > 0, "ChatPage function should be present in static/index.html");

  await t.test("1. ChatPage Unified Container Structure in JSX", () => {
    // ChatPage should render .chat-layout with .chat-list-panel and .chat-room
    assert.match(
      chatPageCode,
      /className:\s*`chat-layout\$\{selectedList\s*\?\s*" has-selection"\s*:\s*""\}`/,
      "ChatPage should use .chat-layout with dynamic has-selection class"
    );
    assert.match(
      chatPageCode,
      /className:\s*`chat-list-panel\$\{panelCollapsed\s*\?\s*" collapsed"\s*:\s*""\}`/,
      "ChatPage should pass collapsed class to .chat-list-panel"
    );
    assert.match(
      chatPageCode,
      /className:\s*["']chat-room["']/,
      "ChatPage should render .chat-room container"
    );
  });

  await t.test("2. ChatListPanel Component Header and Toggle Button", () => {
    // Header title: 💬 Diskusi / Chat with font-weight 700 and font-size 14
    assert.match(
      chatListPanelCode,
      /💬 Diskusi \/ Chat/,
      "ChatListPanel header should display '💬 Diskusi / Chat'"
    );
    assert.match(
      chatListPanelCode,
      /fontSize:\s*14/,
      "ChatListPanel header should have font-size 14"
    );
    assert.match(
      chatListPanelCode,
      /fontWeight:\s*700/,
      "ChatListPanel header should have font-weight 700"
    );

    // Toggle button with ▶/◀
    assert.match(
      chatListPanelCode,
      /collapsed\s*\?\s*["']▶["']\s*:\s*["']◀["']/,
      "ChatListPanel should have collapse toggle button showing ▶ or ◀"
    );
  });

  await t.test("3. ChatListPanel Search Input and Scratchpad-bar Styling", () => {
    // Scratchpad-bar wrapper with search icon and input
    assert.match(
      chatListPanelCode,
      /className:\s*["']scratchpad-bar["']/,
      "ChatListPanel search input should use .scratchpad-bar wrapper"
    );
    assert.match(
      chatListPanelCode,
      /🔍/,
      "ChatListPanel search should include 🔍 icon"
    );
    assert.match(
      chatListPanelCode,
      /placeholder:\s*["']Cari list\.\.\.["']/,
      "ChatListPanel search placeholder should be 'Cari list...'"
    );
    assert.match(
      chatListPanelCode,
      /query\s*&&\s*\/\*#__PURE__\*\/React\.createElement\("button"[\s\S]*?✕/,
      "ChatListPanel search should show clear button ✕ when query is not empty"
    );
  });

  await t.test("4. ChatListPanel Scroll Area and Item List", () => {
    // Scroll area with flex: 1, overflow-y: auto, scrollbarWidth: none
    assert.match(
      chatListPanelCode,
      /flex:\s*1/,
      "ChatListPanel scroll area should have flex: 1"
    );
    assert.match(
      chatListPanelCode,
      /overflowY:\s*["']auto["']/,
      "ChatListPanel scroll area should have overflowY: 'auto'"
    );
    assert.match(
      chatListPanelCode,
      /scrollbarWidth:\s*["']none["']/,
      "ChatListPanel scroll area should have scrollbarWidth: 'none'"
    );

    // List item class
    assert.match(
      chatListPanelCode,
      /className:\s*`chat-list-item\$\{selectedId === l\.id \? " active" : ""\}`/,
      "ChatListPanel should render .chat-list-item with active class"
    );
  });

  await t.test("5. CSS: .chat-layout Unified Container Frame", () => {
    // .chat-layout desktop definition
    assert.match(
      appCss,
      /\.chat-layout\s*\{[\s\S]*?height:\s*calc\(100vh - 84px\);[\s\S]*?min-height:\s*480px;[\s\S]*?margin-top:\s*6px;[\s\S]*?border-radius:\s*12px;[\s\S]*?border:\s*1px solid var\(--border\);[\s\S]*?background:\s*var\(--bg-card\);[\s\S]*?box-shadow:\s*0 1px 3px rgba\(0, 0, 0, 0\.04\);[\s\S]*?gap:\s*0;[\s\S]*?padding:\s*0;[\s\S]*?\}/,
      ".chat-layout should define unified container styles matching the specification"
    );

    // Workspace group rule
    assert.match(
      appCss,
      /\.mindmap-container,\s*\n\s*\.draw-container,\s*\n\s*\.notes-layout,\s*\n\s*\.chat-layout\s*\{/,
      ".chat-layout should be grouped with .mindmap-container, .draw-container, and .notes-layout"
    );
  });

  await t.test("6. CSS: .chat-list-panel Left Sidebar Styling", () => {
    // .chat-list-panel properties
    assert.match(
      appCss,
      /\.chat-list-panel\s*\{[\s\S]*?width:\s*260px;[\s\S]*?flex-shrink:\s*0;[\s\S]*?border:\s*none;[\s\S]*?border-right:\s*1px solid var\(--border\);[\s\S]*?border-radius:\s*0;[\s\S]*?display:\s*flex;[\s\S]*?flex-direction:\s*column;[\s\S]*?height:\s*100%;[\s\S]*?background:\s*var\(--bg-card\);[\s\S]*?overflow:\s*hidden;[\s\S]*?transition:\s*width 0\.2s ease;[\s\S]*?\}/,
      ".chat-list-panel should have width 260px, border-right 1px solid var(--border), border-radius 0, height 100%"
    );

    // .chat-list-panel.collapsed
    assert.match(
      appCss,
      /\.chat-list-panel\.collapsed\s*\{\s*width:\s*52px;\s*overflow:\s*hidden;\s*\}/,
      ".chat-list-panel.collapsed should have width: 52px and overflow: hidden"
    );

    // Sidebar group rule
    assert.match(
      appCss,
      /\.mindmap-sidebar,\s*\n\s*\.draw-sidebar,\s*\n\s*\.notes-left,\s*\n\s*\.chat-list-panel\s*\{/,
      ".chat-list-panel should be grouped with .mindmap-sidebar, .draw-sidebar, and .notes-left"
    );
  });

  await t.test("7. CSS: .chat-list-item Clean Item Styling", () => {
    // .chat-list-item padding and borders
    assert.match(
      appCss,
      /\.chat-list-item\s*\{[\s\S]*?padding:\s*10px 12px;[\s\S]*?cursor:\s*pointer;[\s\S]*?border-bottom:\s*1px solid var\(--border\);[\s\S]*?display:\s*flex;[\s\S]*?align-items:\s*center;[\s\S]*?gap:\s*10px;[\s\S]*?\}/,
      ".chat-list-item should have padding 10px 12px and border-bottom"
    );

    // Should NOT have border-radius 16px 16px 0 0 on first child
    assert.strictEqual(
      appCss.includes(".chat-list-item:first-child"),
      false,
      ".chat-list-item:first-child with border-radius should be removed"
    );
  });

  await t.test("8. CSS: .chat-room Right Panel and Header/Input Reset", () => {
    // .chat-room panel
    assert.match(
      appCss,
      /\.chat-room\s*\{[\s\S]*?border:\s*none;[\s\S]*?border-radius:\s*0;[\s\S]*?height:\s*100%;[\s\S]*?min-width:\s*0;[\s\S]*?flex:\s*1;[\s\S]*?display:\s*flex;[\s\S]*?flex-direction:\s*column;[\s\S]*?overflow:\s*hidden;[\s\S]*?background:\s*var\(--bg-card\);[\s\S]*?\}/,
      ".chat-room should have border: none, border-radius: 0, height: 100%, flex: 1"
    );

    // .chat-room-header border-radius reset
    assert.match(
      appCss,
      /\.chat-room-header\s*\{[\s\S]*?border-bottom:\s*1px solid var\(--border\);[\s\S]*?border-radius:\s*0;[\s\S]*?\}/,
      ".chat-room-header should have border-radius: 0 and border-bottom: 1px solid var(--border)"
    );

    // .chat-input-bar border-radius reset
    assert.match(
      appCss,
      /\.chat-input-bar\s*\{[\s\S]*?border-top:\s*1px solid var\(--border\);[\s\S]*?border-radius:\s*0;[\s\S]*?\}/,
      ".chat-input-bar should have border-radius: 0 and border-top: 1px solid var(--border)"
    );
  });

  await t.test("9. CSS: Mobile Responsiveness (@media max-width: 768px)", () => {
    // @media (max-width: 768px) mobile chat layout
    assert.match(
      appCss,
      /@media\s*\(max-width:\s*768px\)\s*\{[\s\S]*?\.chat-layout\s*\{\s*height:\s*calc\(100vh - 56px\);\s*margin:\s*-8px -16px 0;\s*border-radius:\s*0;\s*border-left:\s*none;\s*border-right:\s*none;\s*padding:\s*0;\s*gap:\s*0;\s*\}[\s\S]*?\}/,
      "@media (max-width: 768px) should style .chat-layout with full viewport height and zero borders/padding"
    );

    assert.match(
      appCss,
      /@media\s*\(max-width:\s*768px\)\s*\{[\s\S]*?\.chat-list-panel\s*\{\s*width:\s*100%;\s*border-right:\s*none;\s*border-radius:\s*0;\s*\}[\s\S]*?\}/,
      "@media (max-width: 768px) should style .chat-list-panel with width: 100% and border-radius: 0"
    );
  });

  await t.test("10. Service Worker Cache Bump", () => {
    assert.match(
      swJs,
      /const CACHE = ["']taskflow-v\d+-[^"']+["'];/,
      "Service Worker cache version should be bumped to valid taskflow-v version"
    );
  });
});
