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

  await t.test("2. Sidebar Header (✕ collapse button, and Title)", () => {
    // Title with notes count
    assert.match(
      notesPageCode,
      /📝 Catatan|Catatan\s*\(\$\{allNotes\.length\}\)/,
      "Header should display Catatan title"
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

    // "Semua Tags" heading inside the tag popover (the "Semua" chip was removed)
    assert.match(
      notesPageCode,
      /Semua Tags/,
      "Tag popover should render 'Semua Tags' heading"
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

    // Filter strip wrapping and wheel scrolling support
    assert.match(
      notesPageCode,
      /flexWrap:\s*["']wrap["']/,
      "Filter strip should use flexWrap: 'wrap' for accessibility on desktop sidebars"
    );
    assert.match(
      notesPageCode,
      /onWheel:\s*\(e\)\s*=>\s*\{[\s\S]*?e\.deltaY[\s\S]*?e\.currentTarget\.scrollLeft\s*\+=\s*e\.deltaY/,
      "Filter strip should handle onWheel to support horizontal scrolling via vertical mouse wheel"
    );
    assert.match(
      notesPageCode,
      /const\s+topTags\s*=\s*sorted\.slice\(0,\s*2\)/,
      "NotesPage should slice top 2 tags to keep filter strip compact"
    );
  });

  await t.test("4. Published & Shared Filter Pills Removed (replaced by tabs)", () => {
    assert.strictEqual(notesPageCode.includes("filterPublished"), false, "filterPublished state should be removed");
    assert.strictEqual(notesPageCode.includes("filterListId"), false, "filterListId state should be removed");
    assert.strictEqual(notesPageCode.includes("🔗 Published"), false, "Published pill should be removed");
    assert.strictEqual(notesPageCode.includes("👥 Shared"), false, "Shared pill should be removed");
  });

  await t.test("5. Pinned Accordion Removed (replaced by Pinned tab)", () => {
    assert.strictEqual(notesPageCode.includes("pinnedExpanded"), false, "pinnedExpanded state should be removed");
    assert.strictEqual(notesPageCode.includes("pinned-note-item"), false, "pinned accordion items should be removed");
    assert.strictEqual(notesPageCode.includes("📌 Disematkan"), false, "Disematkan accordion header should be removed");
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
    // .notes-layout height & unified container
    assert.match(
      appCss,
      /\.notes-layout\s*\{[^}]*height:\s*calc\(100vh\s*-\s*84px\)/,
      ".notes-layout should have height calc(100vh - 84px)"
    );
    assert.match(
      appCss,
      /\.notes-layout\s*\{[^}]*border-radius:\s*12px;/,
      ".notes-layout should have border-radius: 12px"
    );
    assert.match(
      appCss,
      /\.notes-layout\s*\{[^}]*border:\s*1px solid var\(--border\);/,
      ".notes-layout should have border: 1px solid var(--border)"
    );

    // .notes-left styling
    assert.match(
      appCss,
      /\.notes-left\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;[^}]*overflow:\s*hidden;/,
      ".notes-left should have display: flex, flex-direction: column, overflow: hidden"
    );
    assert.match(
      appCss,
      /\.notes-left\s*\{[^}]*height:\s*100%;/,
      ".notes-left should have height: 100%"
    );

    // .notes-right margin-left & unified border/shadow reset
    assert.match(
      appCss,
      /\.notes-right\s*\{[^}]*margin-left:\s*0;/,
      ".notes-right should have margin-left: 0"
    );
    assert.match(
      appCss,
      /\.notes-right\s*\{[^}]*border:\s*none;[^}]*border-radius:\s*0;[^}]*box-shadow:\s*none;/,
      ".notes-right should have border: none, border-radius: 0, box-shadow: none"
    );

    // Tablet media query
    assert.match(
      appCss,
      /@media\s*\(\s*min-width:\s*768px\s*\)\s*and\s*\(\s*max-width:\s*1024px\s*\)\s*\{[\s\S]*?\.notes-left\s*\{[^}]*width:\s*320px\s*!important;\s*min-width:\s*280px\s*!important;[^}]*\}[\s\S]*?\.notes-right\s*\{[^}]*margin-left:\s*0\s*!important;[^}]*\}\s*\}/,
      "app.css should include tablet media query for .notes-left (320px) and .notes-right (margin-left: 0)"
    );

    // Mobile media query
    assert.match(
      appCss,
      /@media\s*\(\s*max-width:\s*767px\s*\)\s*\{[\s\S]*?\.notes-layout\.note-open\s+\.notes-left\s*\{[^}]*display:\s*none\s*!important;\s*\}[\s\S]*?\.notes-layout\.note-open\s+\.notes-right\s*\{[^}]*display:\s*flex\s*!important;[\s\S]*?width:\s*100%\s*!important;[\s\S]*?margin-left:\s*0\s*!important;/,
      "app.css should include mobile media query hiding .notes-left and expanding .notes-right when note-open"
    );
  });
});

test("Notes sidebar tabs — CSS segmented & flex zone", async (t) => {
  await t.test("baris tabs segmented tersedia", () => {
    assert.ok(appCss.includes(".notes-tabs"), "harus ada .notes-tabs");
    const m = /\.notes-tab \{([^}]*)\}/.exec(appCss);
    assert.ok(m, "rule .notes-tab ada");
    assert.ok(/flex:\s*1/.test(m[1]), "tab flex:1 (equal width segmented)");
    assert.ok(/cursor:\s*pointer/.test(m[1]), "tab clickable");
    assert.ok(appCss.includes(".notes-tab.active"), "ada state .notes-tab.active");
  });

  await t.test("zona kontrol tidak menyusut, list dapat sisa ruang", () => {
    assert.match(appCss, /\.notes-left\s*>\s*\*:not\(\.notes-left-inner\)\s*\{\s*flex-shrink:\s*0/, "zona kontrol flex-shrink: 0");
    assert.match(appCss, /\.notes-left-inner\s*\{[^}]*min-height:\s*0/, ".notes-left-inner wajib min-height: 0");
  });

  await t.test("scroll list punya padding atas (anti-clip hover lift)", () => {
    assert.match(appCss, /\.notes-left-inner\s*\{[^}]*padding:\s*6px\s+16px\s+16px\s+0/, "base rule padding-top 6px");
    assert.match(appCss, /\.notes-left-inner\s*\{[^}]*padding:\s*6px\s+14px\s+84px\s+0\s*!important/, "mobile override padding-top 6px");
  });
});

test("Notes sidebar tabs — struktur JSX & state", async (t) => {
  // Extract NotesPage component code (anchored to the NotesPage definition)
  const notesPageMatch = indexHtml.match(/function NotesPage\(\{[\s\S]*?^function /m);
  const notesPageCode = notesPageMatch ? notesPageMatch[0] : "";
  assert.ok(notesPageCode.length > 0, "NotesPage function should be present in static/index.html");

  await t.test("state notesTab menggantikan filter lama", () => {
    assert.match(notesPageCode, /const \[notesTab, setNotesTab\] = React\.useState\("all"\)/, "state notesTab default all");
    assert.strictEqual(notesPageCode.includes("filterPublished"), false, "filterPublished harus hilang");
    assert.strictEqual(notesPageCode.includes("filterListId"), false, "filterListId harus hilang");
    assert.strictEqual(notesPageCode.includes("pinnedExpanded"), false, "pinnedExpanded harus hilang");
  });

  await t.test("4 tab segmented dengan label benar", () => {
    assert.ok(notesPageCode.includes('className: "notes-tabs"'), "baris .notes-tabs ada");
    for (const label of ["All", "Pinned", "Pub", "Shared"]) {
      assert.ok(notesPageCode.includes(`"${label}"`), `label tab ${label} ada`);
    }
    assert.match(notesPageCode, /handleTabChange\(/, "handler handleTabChange terpakai");
  });

  await t.test("pills lama hilang dari baris tags", () => {
    assert.strictEqual(notesPageCode.includes("isAllActive"), false, "pill Semua hilang");
    assert.strictEqual(notesPageCode.includes("filterPublished ? ' active'"), false, "pill Published hilang");
    assert.strictEqual(notesPageCode.includes("pinned-note-item"), false, "accordion pinned hilang");
  });

  await t.test("applyFilters tab-aware (tab ∩ tags ∩ search)", () => {
    assert.match(notesPageCode, /tab === "pinned"\)\s*result = result\.filter\(n => n\.pinned\)/, "tab pinned filter n.pinned");
    assert.match(notesPageCode, /tab === "pub"\)\s*result = result\.filter\(n => publishedNoteIds\.has\(n\.id\)\)/, "tab pub pakai publishedNoteIds");
    assert.match(notesPageCode, /tab === "shared"\)\s*result = result\.filter\(n => n\.list_id\s*&&\s*sharedListIds\.has\(n\.list_id\)\)/, "tab shared pakai sharedListIds");
  });

  await t.test("empty state per tab", () => {
    assert.ok(notesPageCode.includes("Belum ada catatan yang di-pin"), "empty pinned");
    assert.ok(notesPageCode.includes("Belum ada catatan yang di-publish"), "empty pub");
    assert.ok(notesPageCode.includes("Belum ada catatan yang di-share"), "empty shared");
  });

  await t.test("header berisi count + sort (subheader lama hilang)", () => {
    assert.match(notesPageCode, /Catatan \(\$\{sortedNotes\.length\}\)/, "count di header");
    // subheader lama: pattern lama `marginBottom: 6` + sort select sebagai baris sendiri dihapus —
    // asersi: hanya SATU kemunculan select sort (regex count):
    const sortCount = (notesPageCode.match(/value:\s*sortBy/g) || []).length;
    assert.strictEqual(sortCount, 1, "select sort hanya 1 (di header)");
  });

  await t.test("tombol + Baru dihapus dari header panel", () => {
    assert.strictEqual(notesPageCode.includes('className: "btn btn-sm btn-primary"'), false, 'button "+ Baru" harus hilang dari NotesPage');
    assert.strictEqual(notesPageCode.includes('"+ Baru"'), false, 'teks "+ Baru" tidak boleh ada di NotesPage');
  });
});
