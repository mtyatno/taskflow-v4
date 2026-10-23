"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const uiComponentsPath = path.resolve(__dirname, "../../static/ui-components.js");
const indexPath = path.resolve(__dirname, "../../static/index.html");
const appCssPath = path.resolve(__dirname, "../../static/app.css");

const uiComponentsCode = fs.readFileSync(uiComponentsPath, "utf8");
const indexHtml = fs.readFileSync(indexPath, "utf8");
const appCss = fs.readFileSync(appCssPath, "utf8");

test("Note Editor Toolbar Lucide Icons Modernization", async (t) => {
  await t.test("1. ICONS dictionary in static/ui-components.js contains all required Lucide SVG icons", () => {
    const requiredIcons = [
      "bold",
      "italic",
      "code",
      "heading",
      "checkSquare",
      "quote",
      "listOrdered",
      "strikethrough",
      "table",
      "minus",
      "mic",
      "fileText"
    ];

    for (const iconName of requiredIcons) {
      assert.ok(
        new RegExp(`(?:\\b${iconName}|['"]${iconName}['"])\\s*:`).test(uiComponentsCode),
        `ICONS dictionary in static/ui-components.js must define "${iconName}" icon`
      );
    }
  });

  await t.test("2. NoteToolbar in static/index.html renders new Lucide icons via React.createElement(Icon, ...)", () => {
    const toolbarMatch = indexHtml.match(/function NoteToolbar\([\s\S]*?^function /m);
    const toolbarCode = toolbarMatch ? toolbarMatch[0] : "";
    assert.ok(toolbarCode.length > 0, "NoteToolbar function must be present in static/index.html");

    // Template button: clipboardCheck & chevronDown
    assert.match(
      toolbarCode,
      /React\.createElement\(Icon,\s*\{\s*name:\s*["']clipboardCheck["']/,
      "Template button should use clipboardCheck icon"
    );

    // Heading button: heading & chevronDown
    assert.match(
      toolbarCode,
      /React\.createElement\(Icon,\s*\{\s*name:\s*["']heading["']/,
      "Heading dropdown button should use heading icon"
    );

    // Bold button: bold icon
    assert.match(
      toolbarCode,
      /title:\s*["']Bold["'][\s\S]*?React\.createElement\(Icon,\s*\{\s*name:\s*["']bold["']/,
      "Bold button should use bold icon"
    );

    // Italic button: italic icon
    assert.match(
      toolbarCode,
      /title:\s*["']Italic["'][\s\S]*?React\.createElement\(Icon,\s*\{\s*name:\s*["']italic["']/,
      "Italic button should use italic icon"
    );

    // Inline code button: code icon
    assert.match(
      toolbarCode,
      /title:\s*["']Inline code["'][\s\S]*?React\.createElement\(Icon,\s*\{\s*name:\s*["']code["']/,
      "Inline code button should use code icon"
    );

    // Bullet list button: list icon
    assert.match(
      toolbarCode,
      /title:\s*["']Bullet list["'][\s\S]*?React\.createElement\(Icon,\s*\{\s*name:\s*["']list["']/,
      "Bullet list button should use list icon"
    );

    // Checklist button: checkSquare icon
    assert.match(
      toolbarCode,
      /title:\s*["']Checklist \/ Task["'][\s\S]*?React\.createElement\(Icon,\s*\{\s*name:\s*["']checkSquare["']/,
      "Checklist / Task button should use checkSquare icon"
    );

    // Blockquote button: quote icon
    assert.match(
      toolbarCode,
      /title:\s*["']Blockquote["'][\s\S]*?React\.createElement\(Icon,\s*\{\s*name:\s*["']quote["']/,
      "Blockquote button should use quote icon"
    );

    // + Task button: checkSquare icon
    assert.match(
      toolbarCode,
      /title:\s*["']Tambah link task inline["'][\s\S]*?React\.createElement\(Icon,\s*\{\s*name:\s*["']checkSquare["']/,
      "+ Task button should use checkSquare icon"
    );

    // Sketsa button: draw icon
    assert.match(
      toolbarCode,
      /title:\s*["']Sisipkan sketsa yang ada atau buat sketsa baru["'][\s\S]*?React\.createElement\(Icon,\s*\{\s*name:\s*["']draw["']/,
      "Sketsa button should use draw icon"
    );

    // Tombol "+" (Format lainnya) dihapus (Task 2b, 2026-10-23): isinya tampil langsung di toolbar.
    assert.doesNotMatch(toolbarCode, /Format lainnya/, "tombol + Format lainnya sudah dihapus");

    // Numbered list button (langsung di toolbar): listOrdered icon
    assert.match(
      toolbarCode,
      /title:\s*["']Numbered list["']\s*\},\s*React\.createElement\(Icon,\s*\{\s*name:\s*["']listOrdered["']/,
      "Numbered list button should use listOrdered icon"
    );

    // Strikethrough button: strikethrough icon
    assert.match(
      toolbarCode,
      /title:\s*["']Strikethrough["']\s*\},\s*React\.createElement\(Icon,\s*\{\s*name:\s*["']strikethrough["']/,
      "Strikethrough button should use strikethrough icon"
    );

    // Table button: table icon
    assert.match(
      toolbarCode,
      /title:\s*["']Insert table["']\s*\},\s*React\.createElement\(Icon,\s*\{\s*name:\s*["']table["']/,
      "Table button should use table icon"
    );

    // Wikilink button: link icon
    assert.match(
      toolbarCode,
      /title:\s*["']Internal link \[\[wiki\]\]["'][^}]*\},\s*\[React\.createElement\(Icon,\s*\{\s*name:\s*["']link["']/,
      "Wikilink button should use link icon"
    );

    // Horizontal rule button: minus icon
    assert.match(
      toolbarCode,
      /title:\s*["']Horizontal rule["'][\s\S]*?React\.createElement\(Icon,\s*\{\s*name:\s*["']minus["']/,
      "Horizontal rule button should use minus icon"
    );

    // Attach file button (📎 File): paperclip icon
    assert.match(
      toolbarCode,
      /title:\s*noteId \? ['"]Lampirkan file \(PDF, dokumen, spreadsheet\)['"][\s\S]*?React\.createElement\(Icon,\s*\{\s*name:\s*["']paperclip["']/,
      "Attach file button should use paperclip icon"
    );

    // Media button: ViewGlyph fImage (gaya Alurik)
    assert.match(
      toolbarCode,
      /className:\s*["']note-media-insert-btn["'][\s\S]*?React\.createElement\(ViewGlyph,\s*\{\s*name:\s*["']fImage["']/,
      "Media button should use fImage glyph"
    );

    // Voice dictation mic button: mic icon
    assert.match(
      toolbarCode,
      /className:\s*["']note-mic-btn["'][\s\S]*?React\.createElement\(Icon,\s*\{\s*name:\s*["']mic["']/,
      "Voice dictation button should use mic icon"
    );

    // Mode Kertas button: fileText icon
    assert.match(
      toolbarCode,
      /title:\s*["']Mode Kertas["'][\s\S]*?React\.createElement\(Icon,\s*\{\s*name:\s*["']fileText["']/,
      "Mode Kertas button should use fileText icon"
    );
  });

  await t.test("3. No legacy emojis in NoteToolbar buttons", () => {
    const toolbarMatch = indexHtml.match(/function NoteToolbar\([\s\S]*?^function /m);
    const toolbarCode = toolbarMatch ? toolbarMatch[0] : "";
    assert.ok(toolbarCode.length > 0, "NoteToolbar function must be present in static/index.html");

    // Check absence of legacy unicode and emoji strings inside buttons
    assert.doesNotMatch(toolbarCode, /\\uD83D\\uDCCB/, "No legacy clipboard emoji in NoteToolbar buttons");
    assert.doesNotMatch(toolbarCode, /\\u2261/, "No legacy bullet unicode \u2261 in NoteToolbar buttons");
    assert.doesNotMatch(toolbarCode, /\\u2611/, "No legacy checklist unicode \u2611 in NoteToolbar buttons");
    assert.doesNotMatch(toolbarCode, /\\u275D/, "No legacy blockquote unicode \u275D in NoteToolbar buttons");
    assert.doesNotMatch(toolbarCode, /\\u2014/, "No legacy em dash unicode \u2014 in NoteToolbar buttons");
    assert.doesNotMatch(toolbarCode, /\\uD83D\\uDCCE/, "No legacy paperclip emoji in NoteToolbar buttons");
    assert.doesNotMatch(toolbarCode, /\\uD83D\\uDCC4/, "No legacy paper emoji unicode in NoteToolbar buttons");
    assert.doesNotMatch(toolbarCode, /📄\s*Kertas/, "No literal 📄 Kertas string in NoteToolbar buttons");
    assert.doesNotMatch(toolbarCode, /🎨\s*\+Gambar/, "No literal 🎨 +Gambar string in NoteToolbar buttons");
    assert.doesNotMatch(toolbarCode, /🎨\s*\+?Sketsa/, "No literal 🎨 Sketsa string in NoteToolbar buttons");
    assert.doesNotMatch(toolbarCode, /🎬/, "No legacy 🎬 Audio/Video label in NoteToolbar buttons");
    assert.doesNotMatch(toolbarCode, /\\uD83C\\uDF99/, "No legacy microphone emoji in NoteToolbar buttons");
    assert.doesNotMatch(toolbarCode, /\\uD83D\\uDD34/, "No legacy red circle emoji in NoteToolbar buttons");
    assert.doesNotMatch(toolbarCode, /\\uD83D\\uDFE1/, "No legacy yellow circle emoji in NoteToolbar buttons");
  });

  await t.test("4. Mode Kertas attributes and sizing selects preserved in NoteToolbar", () => {
    const toolbarMatch = indexHtml.match(/function NoteToolbar\([\s\S]*?^function /m);
    const toolbarCode = toolbarMatch ? toolbarMatch[0] : "";

    assert.match(toolbarCode, /title:\s*["']Mode Kertas["']/, "title 'Mode Kertas' must be intact");
    assert.match(toolbarCode, /className:\s*paperConfig\?\.enabled \? ["']paper-btn-active["'] : ["']["']/, "paper-btn-active class toggle must be intact");
    assert.match(toolbarCode, /user_toggled:\s*true/, "user_toggled: true preservation must be intact");
    assert.match(toolbarCode, /value:\s*paperConfig\.size/, "paperConfig.size select must be intact");
    assert.match(toolbarCode, /value:\s*paperConfig\.orientation/, "paperConfig.orientation select must be intact");
  });

  await t.test("5. Styling for .note-toolbar button in static/app.css conforms to modern specs", () => {
    const toolbarBtnMatch = appCss.match(/\.note-toolbar\s+button\s*\{([^}]+)\}/);
    assert.ok(toolbarBtnMatch, ".note-toolbar button style should exist in static/app.css");
    const styleBody = toolbarBtnMatch[1];

    assert.match(styleBody, /border-radius:\s*7px;?/, "border-radius should be 7px");
    assert.match(styleBody, /height:\s*28px;?/, "height should be 28px");
    assert.match(styleBody, /gap:\s*3px;?/, "gap should be 3px");
    assert.match(styleBody, /align-items:\s*center;?/, "align-items should be center");
    assert.match(styleBody, /justify-content:\s*center;?/, "justify-content should be center");
    assert.match(styleBody, /padding:\s*0\s+[78]px;?/, "padding should be 0 7px or 0 8px");
  });
});
