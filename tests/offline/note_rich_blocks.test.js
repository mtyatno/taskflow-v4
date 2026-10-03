"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const rootDir = path.resolve(__dirname, "../..");
const indexPath = path.join(rootDir, "static/index.html");
const cssPath = path.join(rootDir, "static/app.css");
const prismJsPath = path.join(rootDir, "static/vendor/prism.min.js");
const prismCssPath = path.join(rootDir, "static/vendor/prism.min.css");
const markedJsPath = path.join(rootDir, "static/vendor/marked.min.js");

const indexHtml = fs.readFileSync(indexPath, "utf8");
const appCss = fs.readFileSync(cssPath, "utf8");

test("Task 1: Vendor Assets, Styling, and Markdown Parser for Rich Blocks", async (t) => {
  await t.test("1. Prism.js Vendor Assets", () => {
    assert.ok(fs.existsSync(prismJsPath), "static/vendor/prism.min.js must exist");
    assert.ok(fs.existsSync(prismCssPath), "static/vendor/prism.min.css must exist");

    const prismJsContent = fs.readFileSync(prismJsPath, "utf8");
    const prismCssContent = fs.readFileSync(prismCssPath, "utf8");

    assert.ok(prismJsContent.length > 500, "prism.min.js should be populated");
    assert.ok(prismCssContent.length > 100, "prism.min.css should be populated");

    // Execute prism.min.js in sandbox
    const sandbox = {
      window: {},
      document: {
        currentScript: null,
        addEventListener: () => {},
        getElementsByTagName: () => [],
        querySelectorAll: () => [],
        querySelector: () => null
      },
      navigator: {},
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (id) => clearTimeout(id)
    };
    sandbox.window = sandbox;
    sandbox.global = sandbox;
    sandbox.window.setTimeout = sandbox.setTimeout;
    sandbox.window.clearTimeout = sandbox.clearTimeout;
    vm.createContext(sandbox);
    vm.runInContext(prismJsContent, sandbox);

    assert.ok(sandbox.Prism, "Prism should be defined on window/global");
    assert.ok(sandbox.Prism.languages, "Prism.languages should exist");
    assert.strictEqual(typeof sandbox.Prism.highlight, "function", "Prism.highlight should be a function");

    // Verify required languages: core + clike + javascript + typescript + python + markup/html + css + sql + json + bash + markdown + php
    const requiredLangs = [
      "javascript", "typescript", "python", "markup", "css",
      "sql", "json", "bash", "markdown", "php"
    ];
    for (const lang of requiredLangs) {
      assert.ok(
        sandbox.Prism.languages[lang],
        `Prism language grammar for '${lang}' must be available`
      );
    }

    // Verify syntax highlighting output
    const code = "const msg = 'hello';";
    const highlighted = sandbox.Prism.highlight(code, sandbox.Prism.languages.javascript, "javascript");
    assert.ok(highlighted.includes("token"), "Prism.highlight should return token spans");
    assert.ok(highlighted.includes("keyword"), "Prism.highlight should highlight 'const' as keyword");
  });

  await t.test("2. HTML Includes for Prism Assets and copyCodeBlock in static/index.html", () => {
    assert.match(
      indexHtml,
      /<link[^>]+href=["']\/static\/vendor\/prism\.min\.css(?:\?[^"']*)?["']/,
      "static/index.html must include stylesheet link for prism.min.css"
    );

    assert.match(
      indexHtml,
      /<script[^>]+src=["']\/static\/vendor\/prism\.min\.js(?:\?[^"']*)?["']/,
      "static/index.html must include script tag for prism.min.js"
    );

    assert.match(
      indexHtml,
      /window\.copyCodeBlock\s*=\s*function|function\s+copyCodeBlock\s*\(/,
      "static/index.html must define copyCodeBlock function"
    );

    assert.match(
      indexHtml,
      /navigator\.clipboard\.writeText/,
      "copyCodeBlock must use navigator.clipboard.writeText"
    );
  });

  await t.test("3. marked.use Custom Code Renderer in static/index.html", () => {
    // Check that marked.use includes code renderer producing note-code-card
    assert.match(
      indexHtml,
      /note-code-card/,
      "marked.use should render code blocks inside .note-code-card"
    );
    assert.match(
      indexHtml,
      /note-code-header/,
      "marked.use should render .note-code-header"
    );
    assert.match(
      indexHtml,
      /note-code-copy-btn/,
      "marked.use should render .note-code-copy-btn"
    );
    assert.match(
      indexHtml,
      /copyCodeBlock\(/,
      "marked.use code renderer should invoke copyCodeBlock onclick"
    );
  });

  await t.test("4. Code Block and Callout Alerts Rendering Verification", () => {
    // Setup test environment to execute renderMarkdown
    const markedCode = fs.readFileSync(markedJsPath, "utf8");
    const prismCode = fs.existsSync(prismJsPath) ? fs.readFileSync(prismJsPath, "utf8") : "";

    // Extract normalizeWikiText, escapeHtml, escapeAttr, parseDirectiveAttrs, renderMarkdown, and marked.use
    // We can evaluate index.html section containing renderMarkdown
    class MockElement {}
    const sandbox = {
      window: {},
      document: {
        currentScript: null,
        addEventListener: () => {},
        getElementsByTagName: () => [],
        querySelectorAll: () => [],
        querySelector: () => null
      },
      Element: MockElement,
      navigator: { clipboard: { writeText: async () => {} } },
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (id) => clearTimeout(id),
      mediaUrl: (u) => u,
      showToast: () => {}
    };
    sandbox.window = sandbox;
    sandbox.global = sandbox;
    sandbox.window.Element = MockElement;
    sandbox.window.setTimeout = sandbox.setTimeout;
    sandbox.window.clearTimeout = sandbox.clearTimeout;
    vm.createContext(sandbox);

    // Run marked
    vm.runInContext(markedCode, sandbox);
    if (prismCode) {
      vm.runInContext(prismCode, sandbox);
    }

    // Extract script 4 functions around marked.use and renderMarkdown
    // Find the marked.use block through renderMarkdown
    const markedBlockMatch = indexHtml.match(/let _markedHIdx = 0;\s*marked\.use\([\s\S]*?^function renderMarkdown\([\s\S]*?^window\.hydrateDrawingPreviews/m);
    assert.ok(markedBlockMatch, "Should find marked.use and renderMarkdown in static/index.html");

    vm.runInContext(markedBlockMatch[0].replace(/^window\.hydrateDrawingPreviews.*/m, ""), sandbox);

    assert.strictEqual(typeof sandbox.renderMarkdown, "function", "renderMarkdown should be a function");

    // Test A: Code block with language
    const codeWithLang = "```javascript\nconst count = 42;\n```";
    const renderedCode = sandbox.renderMarkdown(codeWithLang);
    assert.ok(renderedCode.includes('class="note-code-card"'), "Rendered code should have .note-code-card");
    assert.ok(renderedCode.includes('class="note-code-lang">JAVASCRIPT</span>'), "Should display language JAVASCRIPT");
    assert.ok(renderedCode.includes('class="note-code-copy-btn"'), "Should have copy button");
    assert.ok(renderedCode.includes('copyCodeBlock('), "Should call copyCodeBlock");
    assert.ok(renderedCode.includes('class="language-javascript"'), "Should set language class on code");

    // Test B: Code block without language
    const codeNoLang = "```\nplain snippet\n```";
    const renderedNoLang = sandbox.renderMarkdown(codeNoLang);
    assert.ok(renderedNoLang.includes('class="note-code-card"'), "Rendered plain code should have .note-code-card");
    assert.ok(renderedNoLang.includes('class="note-code-lang">CODE</span>'), "Should fallback to CODE label");

    // Test C: Callout Alerts
    const noteAlert = "> [!NOTE]\n> Ini catatan penting.";
    const renderedNote = sandbox.renderMarkdown(noteAlert);
    assert.ok(renderedNote.includes('class="note-callout note-callout-note"'), "Should render note-callout-note");
    assert.ok(renderedNote.includes('ℹ️'), "Should render note icon ℹ️");
    assert.ok(renderedNote.includes('Catatan'), "Should render note title Catatan");
    assert.ok(renderedNote.includes('Ini catatan penting.'), "Should render note text");

    const tipAlert = "> [!TIP] Tips Efisiensi\n> Baris tips.";
    const renderedTip = sandbox.renderMarkdown(tipAlert);
    assert.ok(renderedTip.includes('class="note-callout note-callout-tip"'), "Should render note-callout-tip");
    assert.ok(renderedTip.includes('💡'), "Should render tip icon 💡");
    assert.ok(renderedTip.includes('Tips Efisiensi'), "Should render custom tip title");

    const warningAlert = "> [!WARNING]\n> Perhatian khusus.";
    const renderedWarning = sandbox.renderMarkdown(warningAlert);
    assert.ok(renderedWarning.includes('class="note-callout note-callout-warning"'), "Should render note-callout-warning");
    assert.ok(renderedWarning.includes('⚠️'), "Should render warning icon ⚠️");

    const importantAlert = "> [!IMPORTANT]\n> Informasi penting.";
    const renderedImportant = sandbox.renderMarkdown(importantAlert);
    assert.ok(renderedImportant.includes('class="note-callout note-callout-important"'), "Should render note-callout-important");
    assert.ok(renderedImportant.includes('📌'), "Should render important icon 📌");

    const cautionAlert = "> [!CAUTION]\n> Bahaya fatal.";
    const renderedCaution = sandbox.renderMarkdown(cautionAlert);
    assert.ok(renderedCaution.includes('class="note-callout note-callout-caution"'), "Should render note-callout-caution");
    assert.ok(renderedCaution.includes('🚨'), "Should render caution icon 🚨");

    // Test D: Normal blockquote should NOT become callout
    const normalQuote = "> Kalimat kutipan biasa.";
    const renderedQuote = sandbox.renderMarkdown(normalQuote);
    assert.ok(!renderedQuote.includes('note-callout'), "Normal blockquote should not become note-callout");
    assert.ok(renderedQuote.includes('<blockquote>'), "Normal blockquote should remain blockquote");

    // Test E: Details/Summary toggle pass-through
    const toggleMd = "<details><summary>Judul Toggle</summary>\n\nKonten dalam toggle\n</details>";
    const renderedToggle = sandbox.renderMarkdown(toggleMd);
    assert.ok(renderedToggle.includes('<details>'), "Should preserve details tag");
    assert.ok(renderedToggle.includes('<summary>Judul Toggle</summary>'), "Should preserve summary tag");
  });

  await t.test("5. CSS Rules in static/app.css for Code Cards, Callouts, and Toggles", () => {
    // Code card styling
    assert.match(appCss, /\.note-code-card\b/, "app.css must style .note-code-card");
    assert.match(appCss, /\.note-code-header\b/, "app.css must style .note-code-header");
    assert.match(appCss, /\.note-code-copy-btn\b/, "app.css must style .note-code-copy-btn");
    assert.match(appCss, /\.note-code-lang\b/, "app.css must style .note-code-lang");

    // Callout styling
    assert.match(appCss, /\.note-callout\b/, "app.css must style .note-callout");
    assert.match(appCss, /\.note-callout-header\b/, "app.css must style .note-callout-header");
    assert.match(appCss, /\.note-callout-icon\b/, "app.css must style .note-callout-icon");
    assert.match(appCss, /\.note-callout-title\b/, "app.css must style .note-callout-title");
    assert.match(appCss, /\.note-callout-content\b/, "app.css must style .note-callout-content");
    assert.match(appCss, /\.note-callout-note\b/, "app.css must style .note-callout-note");
    assert.match(appCss, /\.note-callout-tip\b/, "app.css must style .note-callout-tip");
    assert.match(appCss, /\.note-callout-warning\b/, "app.css must style .note-callout-warning");
    assert.match(appCss, /\.note-callout-important\b/, "app.css must style .note-callout-important");
    assert.match(appCss, /\.note-callout-caution\b/, "app.css must style .note-callout-caution");

    // Details / summary styling in note viewer
    assert.match(appCss, /\.note-rendered\s+details|details\s*\{/, "app.css must style details toggle");
  });
});
