"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const indexPath = path.resolve(__dirname, "../../static/index.html");
const indexHtml = fs.readFileSync(indexPath, "utf8");

const cssPath = path.resolve(__dirname, "../../static/app.css");
const appCss = fs.readFileSync(cssPath, "utf8");

test("NotesPage Tablet and Desktop Layout Redesign", async (t) => {
  // Extract NotesPage component code
  const notesPageMatch = indexHtml.match(/function NotesPage\([\s\S]*?^function /m);
  const notesPageCode = notesPageMatch ? notesPageMatch[0] : "";
  assert.ok(notesPageCode.length > 0, "NotesPage function should be present in static/index.html");

  await t.test("1. Unified Sidebar Structure (Elimination of sub-columns)", () => {
    // Should NOT have .notes-col-search and .notes-col-list sub-columns
    assert.strictEqual(
      notesPageCode.includes('className: "notes-col-search"'),
      false,
      "NotesPage should not use .notes-col-search sub-column"
    );
    assert.strictEqual(
      notesPageCode.includes('className: "notes-col-list"'),
      false,
      "NotesPage should not use .notes-col-list sub-column"
    );

    // Should use a single unified .notes-left container
    assert.match(
      notesPageCode,
      /className:\s*["']notes-left["']/,
      "NotesPage should contain a unified .notes-left container"
    );

    // .notes-left width and style specification
    assert.match(
      notesPageCode,
      /width:\s*sidebarCollapsed\s*\?\s*0\s*:\s*['"]340px['"]/,
      ".notes-left should have width 340px when open and 0 when collapsed"
    );
    assert.match(
      notesPageCode,
      /minWidth:\s*sidebarCollapsed\s*\?\s*0\s*:\s*['"]280px['"]/,
      ".notes-left should have minWidth 280px when open and 0 when collapsed"
    );
    assert.match(
      notesPageCode,
      /maxWidth:\s*sidebarCollapsed\s*\?\s*0\s*:\s*['"]380px['"]/,
      ".notes-left should have maxWidth 380px when open and 0 when collapsed"
    );
    assert.match(
      notesPageCode,
      /borderRight:\s*sidebarCollapsed\s*\?\s*['"]none['"]\s*:\s*['"]1px solid var\(--border\)['"]/,
      ".notes-left should hide borderRight when collapsed"
    );
  });

  await t.test("2. Sidebar Header (+ Baru button, ✕ collapse button, and Title)", () => {
    // Title with notes count
    assert.match(
      notesPageCode,
      /📝 Catatan|Catatan\s*\(\$\{allNotes\.length\}\)/,
      "Header should display Catatan title"
    );

    // + Baru button triggering openNew
    assert.match(
      notesPageCode,
      /onClick:\s*openNew[\s\S]*?\+ Baru|\+ Baru[\s\S]*?onClick:\s*openNew/,
      "Header should have + Baru button triggering openNew"
    );

    // ✕ collapse button triggering setSidebarCollapsed(true)
    assert.match(
      notesPageCode,
      /onClick:\s*\(\)\s*=>\s*setSidebarCollapsed\(true\)/,
      "Header should have ✕ button setting sidebarCollapsed to true"
    );
  });

  await t.test("3. Search Bar and Compact Filter Strip with Tag Popover", () => {
    // Popover state and click-outside ref
    assert.match(
      notesPageCode,
      /const\s+\[allTagsPopoverOpen,\s*setAllTagsPopoverOpen\]\s*=\s*useState\(false\)/,
      "NotesPage should define allTagsPopoverOpen state"
    );
    assert.match(
      notesPageCode,
      /const\s+tagPopoverRef\s*=\s*(?:React\.)?useRef\(null\)/,
      "NotesPage should define tagPopoverRef"
    );

    // Outside click detection useEffect
    assert.match(
      notesPageCode,
      /document\.addEventListener\(\s*["'](?:pointerdown|click|mousedown)["'],\s*handleClickOutside\)/,
      "NotesPage should register pointerdown/click outside handler for tag popover"
    );

    // Full-width search bar
    assert.match(
      notesPageCode,
      /className:\s*["']scratchpad-bar["']/,
      "NotesPage should render scratchpad-bar search container"
    );
    assert.match(
      notesPageCode,
      /className:\s*["']scratchpad-search-input["']/,
      "NotesPage should render scratchpad-search-input"
    );

    // [ Semua ] chip
    assert.match(
      notesPageCode,
      /Semua/,
      "Filter strip should render 'Semua' filter chip"
    );

    // Tag Popover toggle button and popover container
    assert.match(
      notesPageCode,
      /setAllTagsPopoverOpen/,
      "Tag filter strip should toggle allTagsPopoverOpen"
    );
    assert.match(
      notesPageCode,
      /ref:\s*tagPopoverRef/,
      "Tag popover container should attach tagPopoverRef"
    );
  });

  await t.test("4. Published & Shared Filter Chips", () => {
    assert.match(
      notesPageCode,
      /Published\s*\(\$\{publishedNotes\.length\}\)|🔗 Published/,
      "Filter strip should display Published filter chip with count"
    );
    assert.match(
      notesPageCode,
      /filterPublished/,
      "NotesPage should have filterPublished state and handling"
    );
    assert.match(
      notesPageCode,
      /Shared\s*\(\$\{listsWithNotes\.length\}\)|👥 Shared|Shared List/,
      "Filter strip should display Shared filter chip or list filters"
    );
  });

  await t.test("5. Pinned Notes Accordion", () => {
    // Disematkan accordion header and count
    assert.match(
      notesPageCode,
      /📌 Disematkan\s*\(\$\{pinned\.length\}\)|Disematkan\s*\(\$\{pinned\.length\}\)|Disematkan/,
      "Pinned section should render header with pinned count"
    );
    assert.match(
      notesPageCode,
      /pinnedExpanded/,
      "NotesPage should manage pinnedExpanded state"
    );
  });

  await t.test("6. Full-Width Collapse Behavior & Sidebar Toggle", () => {
    // When sidebar is collapsed, sidebar-toggle is rendered
    assert.match(
      notesPageCode,
      /sidebarCollapsed\s*&&\s*(?:\/\*#__PURE__\*\/\s*)?React\.createElement\("div",\s*\{\s*className:\s*["']sidebar-toggle visible["'],\s*onClick:\s*\(\)\s*=>\s*setSidebarCollapsed\(false\)/,
      "NotesPage should render .sidebar-toggle with setSidebarCollapsed(false) when collapsed"
    );
    assert.match(
      notesPageCode,
      /className:\s*["']notes-right["']/,
      "NotesPage should render .notes-right container"
    );
  });

  await t.test("7. CSS Rules in static/app.css", () => {
    // .notes-layout height
    assert.match(
      appCss,
      /\.notes-layout\s*\{[^}]*height:\s*calc\(100vh\s*-\s*84px\)/,
      ".notes-layout should have height calc(100vh - 84px)"
    );

    // .notes-left styling
    assert.match(
      appCss,
      /\.notes-left\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;[^}]*overflow:\s*hidden;/,
      ".notes-left should have display: flex, flex-direction: column, overflow: hidden"
    );

    // .notes-right margin-left
    assert.match(
      appCss,
      /\.notes-right\s*\{[^}]*margin-left:\s*10px;/,
      ".notes-right should have margin-left: 10px"
    );

    // Tablet media query
    assert.match(
      appCss,
      /@media\s*\(\s*min-width:\s*768px\s*\)\s*and\s*\(\s*max-width:\s*1024px\s*\)\s*\{[\s\S]*?\.notes-left\s*\{[^}]*width:\s*320px\s*!important;\s*min-width:\s*280px\s*!important;[^}]*\}[\s\S]*?\.notes-right\s*\{[^}]*margin-left:\s*8px\s*!important;[^}]*\}\s*\}/,
      "app.css should include tablet media query for .notes-left (320px) and .notes-right (margin-left: 8px)"
    );

    // Mobile media query
    assert.match(
      appCss,
      /@media\s*\(\s*max-width:\s*767px\s*\)\s*\{[\s\S]*?\.notes-layout\.note-open\s+\.notes-left\s*\{[^}]*display:\s*none\s*!important;\s*\}[\s\S]*?\.notes-layout\.note-open\s+\.notes-right\s*\{[^}]*display:\s*flex\s*!important;[\s\S]*?width:\s*100%\s*!important;[\s\S]*?margin-left:\s*0\s*!important;/,
      "app.css should include mobile media query hiding .notes-left and expanding .notes-right when note-open"
    );
  });
});
