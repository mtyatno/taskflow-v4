"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const indexPath = path.resolve(__dirname, "../../static/index.html");
const indexHtml = fs.readFileSync(indexPath, "utf8");

test("TaskFormModal Note Tab Paper Selector and Paper Guides", async (t) => {
  // Extract TaskFormModal component code
  const taskFormMatch = indexHtml.match(/function TaskFormModal\([\s\S]*?^function /m);
  const taskFormCode = taskFormMatch ? taskFormMatch[0] : "";
  assert.ok(taskFormCode.length > 0, "TaskFormModal function should be present in static/index.html");

  await t.test("TaskFormModal defines notePaperConfig state and notePaperWrapRef", () => {
    assert.match(
      taskFormCode,
      /const\s+\[notePaperConfig,\s*setNotePaperConfig\]\s*=\s*useState\(\{\s*enabled:\s*true,\s*size:\s*['"]A4['"],\s*orientation:\s*['"]portrait['"]\s*\}\)/,
      "TaskFormModal should initialize notePaperConfig state with default { enabled: true, size: 'A4', orientation: 'portrait' }"
    );
    assert.match(
      taskFormCode,
      /const\s+notePaperWrapRef\s*=\s*React\.useRef\(null\)/,
      "TaskFormModal should define notePaperWrapRef"
    );
  });

  await t.test("TaskFormModal passes paperConfig and onPaperConfigChange to NoteToolbar", () => {
    assert.match(
      taskFormCode,
      /React\.createElement\(NoteToolbar,[\s\S]*?paperConfig:\s*notePaperConfig[\s\S]*?onPaperConfigChange:\s*setNotePaperConfig/,
      "NoteToolbar inside TaskFormModal should receive paperConfig and onPaperConfigChange"
    );
  });

  await t.test("TaskFormModal wraps MilkdownEditor in paper mode container with CSS variables", () => {
    assert.match(
      taskFormCode,
      /className:\s*notePaperConfig\?\.enabled\s*\?\s*["']paper-mode-active["']\s*:\s*["']["']/,
      "TaskFormModal should toggle paper-mode-active class on outer container"
    );
    assert.match(
      taskFormCode,
      /["']--paper-width["']:\s*notePaperConfig\.orientation\s*===\s*['"]landscape['"]/,
      "TaskFormModal should calculate --paper-width based on orientation"
    );
    assert.match(
      taskFormCode,
      /["']--paper-height["']:\s*notePaperConfig\.orientation\s*===\s*['"]landscape['"]/,
      "TaskFormModal should calculate --paper-height based on orientation"
    );
  });

  await t.test("TaskFormModal wraps MilkdownEditor in paper-inner-wrap ref and renders PaperPageGuides", () => {
    assert.match(
      taskFormCode,
      /ref:\s*notePaperWrapRef,\s*className:\s*["']paper-inner-wrap["']/,
      "TaskFormModal should wrap MilkdownEditor in paper-inner-wrap with notePaperWrapRef"
    );
    assert.match(
      taskFormCode,
      /notePaperConfig\?\.enabled\s*&&\s*(?:\/\*#__PURE__\*\/\s*)?React\.createElement\(PaperPageGuides,\s*\{\s*rootRef:\s*notePaperWrapRef,\s*paperConfig:\s*notePaperConfig\s*\}\)/,
      "TaskFormModal should render PaperPageGuides with rootRef and paperConfig when enabled"
    );
  });

  await t.test("TaskFormModal saves meta_json with paper_mode in scratchpad API calls", () => {
    // Check note submit API call
    assert.match(
      taskFormCode,
      /api\.post\(["']\/api\/scratchpad["'],\s*\{[\s\S]*?meta_json:\s*JSON\.stringify\(\{\s*paper_mode:\s*notePaperConfig\s*\}\)/,
      "TaskFormModal handleSubmit should include meta_json with notePaperConfig"
    );
    // Check image paste note creation API call
    assert.match(
      taskFormCode,
      /fetch\(apiUrl\(["']\/api\/scratchpad["']\),[\s\S]*?meta_json:\s*JSON\.stringify\(\{\s*paper_mode:\s*notePaperConfig\s*\}\)/,
      "TaskFormModal image paste note create should include meta_json with notePaperConfig"
    );
  });

  await t.test("NoteToolbar renders paper mode controls when onPaperConfigChange is provided", () => {
    const toolbarMatch = indexHtml.match(/function NoteToolbar\([\s\S]*?^function /m);
    const toolbarCode = toolbarMatch ? toolbarMatch[0] : "";
    assert.ok(toolbarCode.length > 0, "NoteToolbar function should be present in static/index.html");

    assert.match(
      toolbarCode,
      /onPaperConfigChange\s*&&\s*React\.createElement\("div"/,
      "NoteToolbar should render paper controls container when onPaperConfigChange is passed"
    );
    assert.match(
      toolbarCode,
      /title:\s*["']Mode Kertas["']/,
      "NoteToolbar should have Mode Kertas button"
    );
    assert.match(
      toolbarCode,
      /value:\s*paperConfig\.size/,
      "NoteToolbar should have paper size select"
    );
    assert.match(
      toolbarCode,
      /value:\s*paperConfig\.orientation/,
      "NoteToolbar should have paper orientation select"
    );
  });
});

test("NoteModal initPaperConfig defaults and user_toggled behavior", async (t) => {
  const noteModalMatch = indexHtml.match(/function NoteModal\([\s\S]*?^function /m);
  const noteModalCode = noteModalMatch ? noteModalMatch[0] : "";
  assert.ok(noteModalCode.length > 0, "NoteModal function should be present in static/index.html");

  // Workstream C (T5): logika dipindah ke paperConfigFromMeta(metaJson) supaya editor bisa memuat ulang konfigurasi
  // kertas dari record lain; initPaperConfig = () => paperConfigFromMeta(note?.meta_json).
  const initPaperConfigMatch = noteModalCode.match(/const paperConfigFromMeta = metaJson => \{([\s\S]*?)\n\s*\};\s*const initPaperConfig = \(\) => paperConfigFromMeta\(note\?\.meta_json\);\s*const \[paperConfig/);
  assert.ok(initPaperConfigMatch, "paperConfigFromMeta + initPaperConfig should be present in NoteModal");

  const runInitPaperConfig = (note) => {
    const fn = new Function("note", `
      const paperConfigFromMeta = metaJson => { ${initPaperConfigMatch[1]} };
      const initPaperConfig = () => paperConfigFromMeta(note?.meta_json);
      return initPaperConfig();
    `);
    return fn(note);
  };

  await t.test("New note (no meta_json) -> defaults to enabled: true", () => {
    assert.deepEqual(runInitPaperConfig(null), { enabled: true, size: "A4", orientation: "portrait" });
    assert.deepEqual(runInitPaperConfig({}), { enabled: true, size: "A4", orientation: "portrait" });
    assert.deepEqual(runInitPaperConfig({ meta_json: "" }), { enabled: true, size: "A4", orientation: "portrait" });
    assert.deepEqual(runInitPaperConfig({ meta_json: "{}" }), { enabled: true, size: "A4", orientation: "portrait" });
    assert.deepEqual(runInitPaperConfig({ meta_json: "invalid json string" }), { enabled: true, size: "A4", orientation: "portrait" });
  });

  await t.test("Legacy note (meta_json with paper_mode { enabled: false } without user_toggled) -> defaults to enabled: true", () => {
    const legacyNote = {
      meta_json: JSON.stringify({ paper_mode: { enabled: false, size: "A4", orientation: "portrait" } })
    };
    assert.deepEqual(runInitPaperConfig(legacyNote), { enabled: true, size: "A4", orientation: "portrait" });
  });

  await t.test("Explicitly toggled note (meta_json with paper_mode { enabled: false, user_toggled: true }) -> preserves enabled: false", () => {
    const toggledOffNote = {
      meta_json: JSON.stringify({ paper_mode: { enabled: false, size: "A4", orientation: "portrait", user_toggled: true } })
    };
    assert.deepEqual(runInitPaperConfig(toggledOffNote), {
      enabled: false,
      size: "A4",
      orientation: "portrait",
      user_toggled: true
    });
  });

  await t.test("Explicitly enabled note (meta_json with paper_mode { enabled: true, user_toggled: true }) -> preserves enabled: true", () => {
    const toggledOnNote = {
      meta_json: JSON.stringify({ paper_mode: { enabled: true, size: "Legal", orientation: "landscape", user_toggled: true } })
    };
    assert.deepEqual(runInitPaperConfig(toggledOnNote), {
      enabled: true,
      size: "Legal",
      orientation: "landscape",
      user_toggled: true
    });
  });

  await t.test("NoteToolbar paper button sets user_toggled: true", () => {
    const toolbarMatch = indexHtml.match(/function NoteToolbar\([\s\S]*?^function /m);
    const toolbarCode = toolbarMatch ? toolbarMatch[0] : "";
    assert.match(
      toolbarCode,
      /onPointerDown:\s*\(?e\)?\s*=>\s*\{[\s\S]*?user_toggled:\s*true[\s\S]*?\}/,
      "NoteToolbar paper button should set user_toggled: true when toggling paper mode"
    );
  });
});

test("NotePanel Note Viewer Paper Mode (Viewer Mode Kertas)", async (t) => {
  const swPath = path.resolve(__dirname, "../../static/sw.js");
  const swJs = fs.readFileSync(swPath, "utf8");
  const webappPath = path.resolve(__dirname, "../../webapp.py");
  const webappPy = fs.readFileSync(webappPath, "utf8");

  await t.test("Service Worker and cache version is taskflow-v479-tema-sakura-lavender", () => {
    assert.match(swJs, /^const CACHE = "taskflow-v479-tema-sakura-lavender";/m);
    assert.match(indexHtml, /window\.__SW_VERSION\s*=\s*"taskflow-v479-tema-sakura-lavender";/);
    assert.match(indexHtml, /window\.__SW_VERSION\s*\|\|\s*"taskflow-v479-tema-sakura-lavender"/);
  });

  const notePanelMatch = indexHtml.match(/function NotePanel\([\s\S]*?^function /m);
  const notePanelCode = notePanelMatch ? notePanelMatch[0] : "";
  assert.ok(notePanelCode.length > 0, "NotePanel function should be present in static/index.html");

  await t.test("NotePanel initializes viewerPaperConfig and viewerPaperWrapRef", () => {
    assert.match(
      notePanelCode,
      /const\s+initViewerPaperConfig\s*=\s*\(\)\s*=>/,
      "NotePanel should define initViewerPaperConfig function"
    );
    assert.match(
      notePanelCode,
      /const\s+\[viewerPaperConfig,\s*setViewerPaperConfig\]\s*=\s*useState\(initViewerPaperConfig\)/,
      "NotePanel should initialize viewerPaperConfig state"
    );
    assert.match(
      notePanelCode,
      /const\s+viewerPaperWrapRef\s*=\s*React\.useRef\(null\)/,
      "NotePanel should define viewerPaperWrapRef"
    );
    assert.match(
      notePanelCode,
      /const\s+saveViewerPaperConfig\s*=\s*async\s*\(?nextConfig\)?\s*=>/,
      "NotePanel should define saveViewerPaperConfig handler"
    );
  });

  await t.test("NotePanel initViewerPaperConfig correctly handles defaults and user_toggled", () => {
    const initFnMatch = notePanelCode.match(/const initViewerPaperConfig = \(\) => \{([\s\S]*?)\n\s*\};\s*const \[viewerPaperConfig/);
    assert.ok(initFnMatch, "initViewerPaperConfig should be extractable");
    const runInit = (n) => {
      const fn = new Function("note", `
        const initViewerPaperConfig = () => { ${initFnMatch[1]} };
        return initViewerPaperConfig();
      `);
      return fn(n);
    };

    // Default note -> enabled: true
    assert.deepEqual(runInit(null), { enabled: true, size: "A4", orientation: "portrait" });
    assert.deepEqual(runInit({}), { enabled: true, size: "A4", orientation: "portrait" });
    assert.deepEqual(runInit({ meta_json: "{}" }), { enabled: true, size: "A4", orientation: "portrait" });

    // Legacy note without user_toggled -> enabled: true
    assert.deepEqual(runInit({ meta_json: JSON.stringify({ paper_mode: { enabled: false, size: "A4", orientation: "portrait" } }) }), {
      enabled: true,
      size: "A4",
      orientation: "portrait"
    });

    // Explicitly toggled off note -> preserves enabled: false
    assert.deepEqual(runInit({ meta_json: JSON.stringify({ paper_mode: { enabled: false, size: "Letter", orientation: "portrait", user_toggled: true } }) }), {
      enabled: false,
      size: "Letter",
      orientation: "portrait",
      user_toggled: true
    });

    // Explicitly toggled on note -> preserves enabled: true
    assert.deepEqual(runInit({ meta_json: JSON.stringify({ paper_mode: { enabled: true, size: "A3", orientation: "landscape", user_toggled: true } }) }), {
      enabled: true,
      size: "A3",
      orientation: "landscape",
      user_toggled: true
    });
  });

  await t.test("NotePanel renders Kertas toggle button and paper selects in notes-panel-actions", () => {
    assert.match(
      notePanelCode,
      /title:\s*viewerPaperConfig\?\.enabled\s*\?\s*"Matikan Mode Kertas"\s*:\s*"Mode Kertas"/,
      "NotePanel should have Mode Kertas button with dynamic title"
    );
    assert.match(
      notePanelCode,
      /className:\s*viewerPaperConfig\?\.enabled\s*\?\s*"paper-controls paper-btn-active"\s*:\s*"paper-controls"/,
      "NotePanel Kertas button should apply paper-btn-active when enabled"
    );
    assert.match(
      notePanelCode,
      /React\.createElement\(Icon,\s*\{\s*name:\s*"fileText",\s*size:\s*14\s*\}\)/,
      "NotePanel Kertas button should render fileText icon"
    );
    assert.match(
      notePanelCode,
      /React\.createElement\("span",\s*\{\s*className:\s*"note-act-label"\s*\},\s*"Kertas"\)/,
      "NotePanel Kertas button should have Kertas label"
    );
    assert.match(
      notePanelCode,
      /viewerPaperConfig\?\.enabled\s*&&\s*(?:\/\*#__PURE__\*\/\s*)?React\.createElement\("select",\s*\{[\s\S]*?className:\s*"paper-select paper-controls"[\s\S]*?value:\s*viewerPaperConfig\.size/,
      "NotePanel should render size select when paper mode is enabled"
    );
    assert.match(
      notePanelCode,
      /viewerPaperConfig\?\.enabled\s*&&\s*(?:\/\*#__PURE__\*\/\s*)?React\.createElement\("select",\s*\{[\s\S]*?className:\s*"paper-select paper-controls"[\s\S]*?value:\s*viewerPaperConfig\.orientation/,
      "NotePanel should render orientation select when paper mode is enabled"
    );
  });

  await t.test("NotePanel wraps rendered note with paper-mode-active, paper-inner-wrap and PaperPageGuides", () => {
    assert.match(
      notePanelCode,
      /viewerPaperConfig\?\.enabled\s*\?\s*React\.createElement\("div",\s*\{[\s\S]*?className:\s*"paper-mode-active(?: paper-fit-area)?"/,
      "NotePanel should wrap note in paper-mode-active div when enabled"
    );
    assert.match(
      notePanelCode,
      /ref:\s*viewerPaperWrapRef,\s*className:\s*"paper-inner-wrap"/,
      "NotePanel should wrap renderedNoteEl in paper-inner-wrap with viewerPaperWrapRef"
    );
    assert.match(
      notePanelCode,
      /React\.createElement\(PaperPageGuides,\s*\{\s*rootRef:\s*viewerPaperWrapRef,\s*paperConfig:\s*viewerPaperConfig\s*\}\)/,
      "NotePanel should render PaperPageGuides with rootRef and paperConfig"
    );
  });

  await t.test("PaperPageGuides queries .ProseMirror or .note-rendered", () => {
    const guidesMatch = indexHtml.match(/function PaperPageGuides\([\s\S]*?^function /m);
    const guidesCode = guidesMatch ? guidesMatch[0] : "";
    assert.ok(guidesCode.length > 0, "PaperPageGuides function should be present in static/index.html");
    assert.match(
      guidesCode,
      /root\.querySelector\(['"]\.ProseMirror['"]\)\s*\|\|\s*root\.querySelector\(['"]\.note-rendered['"]\)/,
      "PaperPageGuides should check for .ProseMirror or .note-rendered"
    );
  });

  await t.test("CSS Paper Mode supports .note-rendered, dark mode desk, and .notes-panel-actions", () => {
    const styleMatch = indexHtml.match(/<style>([\s\S]*?)<\/style>/);
    const css = styleMatch ? styleMatch[1] : "";
    assert.ok(css.length > 0, "<style> tag should be present in static/index.html");

    // Dark mode desk
    assert.match(
      css,
      /\[data-theme="dark"\]\s+\.paper-mode-active\s*\{[\s\S]*?background-color:\s*#18181b\s*!important;/,
      "CSS should style dark theme desk with #18181b"
    );

    // .note-rendered paper sheet
    assert.match(
      css,
      /\.paper-mode-active\s+\.paper-inner-wrap\s+\.note-rendered\s*\{[\s\S]*?background-color:\s*white\s*!important;/,
      "CSS should style .note-rendered inside paper-inner-wrap with white background"
    );
    assert.match(
      css,
      /\.paper-mode-active\s+\.paper-inner-wrap\s+\.note-rendered\s*\{[\s\S]*?box-shadow:\s*0\s+4px\s+10px\s+rgba\(0,0,0,0\.15\)\s*!important;/,
      "CSS should give .note-rendered box-shadow"
    );
    assert.match(
      css,
      /\.paper-mode-active\s+\.paper-inner-wrap\s+\.note-rendered\s*\{[\s\S]*?width:\s*var\(--paper-width,\s*210mm\)\s*!important;/,
      "CSS should set width var(--paper-width, 210mm) on .note-rendered"
    );
    assert.match(
      css,
      /\.paper-mode-active\s+\.paper-inner-wrap\s+\.note-rendered\s*\{[\s\S]*?min-height:\s*var\(--paper-height,\s*297mm\)\s*!important;/,
      "CSS should set min-height var(--paper-height, 297mm) on .note-rendered"
    );

    // Typography
    assert.match(
      css,
      /\.paper-mode-active\s+\.paper-inner-wrap\s+\.note-rendered\s*\{[\s\S]*?color:\s*#1e293b\s*!important;/,
      "CSS should set text color #1e293b on .note-rendered"
    );
    assert.match(
      css,
      /\.paper-mode-active\s+\.paper-inner-wrap\s+\.note-rendered\s+blockquote/,
      "CSS should support .note-rendered blockquote"
    );
    assert.match(
      css,
      /\.paper-mode-active\s+\.paper-inner-wrap\s+\.note-rendered\s+pre/,
      "CSS should support .note-rendered pre"
    );
    assert.match(
      css,
      /\.paper-mode-active\s+\.paper-inner-wrap\s+\.note-rendered\s+a/,
      "CSS should support .note-rendered a"
    );
    assert.match(
      css,
      /\.paper-mode-active\s+\.paper-inner-wrap\s+\.note-rendered\s+th/,
      "CSS should support .note-rendered th"
    );

    // .notes-panel-actions controls
    assert.match(
      css,
      /\.notes-panel-actions\s+button\.paper-btn-active/,
      "CSS should support .notes-panel-actions button.paper-btn-active"
    );
    assert.match(
      css,
      /\.notes-panel-actions\s+select\.paper-select/,
      "CSS should support .notes-panel-actions select.paper-select"
    );
    assert.match(
      css,
      /\[data-theme="dark"\]\s+\.notes-panel-actions\s+select\.paper-select/,
      "CSS should support dark mode for .notes-panel-actions select.paper-select"
    );
  });
});

test("Paper mode is desktop-only: fluid full width on mobile (<= 768px)", async (t) => {
  const styleMatch = indexHtml.match(/<style>([\s\S]*?)<\/style>/);
  const css = styleMatch ? styleMatch[1] : "";

  await t.test("paper sheet styles live inside @media (min-width: 769px)", () => {
    const desk = css.match(/@media \(min-width: 769px\) \{([\s\S]*?)\n\}/);
    assert.ok(desk, "paper sheet styles should be wrapped in @media (min-width: 769px)");
    assert.match(desk[1], /\.paper-mode-active\s*\{[\s\S]*?background-color:\s*#e5e7eb/);
    assert.match(desk[1], /\.paper-mode-active\s+\.paper-inner-wrap\s+\.note-rendered\s*\{[\s\S]*?width:\s*var\(--paper-width,\s*210mm\)/);
    assert.match(desk[1], /color:\s*#1e293b\s*!important/);
    const outside = css.replace(desk[0], "");
    assert.doesNotMatch(outside, /box-shadow:\s*0\s+4px\s+10px/, "no paper shadow outside the desktop media query");
    assert.doesNotMatch(outside, /#1e293b/, "no forced paper text colour outside the desktop media query");
  });

  await t.test("mobile overrides the inline paper width and hides guides and controls", () => {
    const mobile = css.match(/@media \(max-width: 768px\) \{([\s\S]*?)\n\}/);
    assert.ok(mobile, "a @media (max-width: 768px) block should exist");
    assert.match(mobile[1], /\.paper-inner-wrap\s*\{[\s\S]*?width:\s*100%\s*!important;[\s\S]*?margin:\s*0\s*!important;/);
    assert.match(mobile[1], /\.paper-page-guides,\s*\.paper-controls\s*\{[\s\S]*?display:\s*none\s*!important;/);
  });

  await t.test("paper controls carry the paper-controls class in NoteToolbar and NotePanel", () => {
    assert.match(indexHtml, /onPaperConfigChange && React\.createElement\("div", \{ className: "paper-controls"/);
    assert.match(indexHtml, /className: viewerPaperConfig\?\.enabled \? "paper-controls paper-btn-active" : "paper-controls"/);
    assert.equal((indexHtml.match(/className: "paper-select paper-controls",\s*value: viewerPaperConfig\./g) || []).length, 2);
  });
});

test("NotePanel viewer paper fits the display area (fit-to-width)", async (t) => {
  const grab = (re) => { const m = indexHtml.match(re); assert.ok(m, "missing " + re); return m[0]; };
  const paperWidthMm = new Function(grab(/function paperWidthMm\(cfg\) \{[\s\S]*?\n\}/) + "; return paperWidthMm;")();
  const paperFitScale = new Function(grab(/function paperFitScale\([^)]*\) \{[\s\S]*?\n\}/) + "; return paperFitScale;")();

  await t.test("paperWidthMm matches the --paper-width the viewer sets", () => {
    assert.equal(paperWidthMm({ size: "A4", orientation: "portrait" }), 210);
    assert.equal(paperWidthMm({ size: "A4", orientation: "landscape" }), 297);
    assert.equal(paperWidthMm({ size: "A3", orientation: "portrait" }), 297);
    assert.equal(paperWidthMm({ size: "A3", orientation: "landscape" }), 420);
    assert.equal(paperWidthMm({ size: "Letter", orientation: "portrait" }), 215.9);
    assert.equal(paperWidthMm({ size: "Legal", orientation: "landscape" }), 279.4);
    assert.equal(paperWidthMm(null), 210);
  });

  await t.test("paperFitScale keeps normal size when the paper fits, shrinks it otherwise", () => {
    const a4 = 210 * 96 / 25.4; // ~794px
    assert.equal(paperFitScale(852, a4), 1);   // 1366px laptop, note list open: fits
    assert.equal(paperFitScale(1106, a4), 1);  // note list closed
    const s = paperFitScale(766, a4);          // 1280px laptop, note list open
    assert.ok(s < 1 && s > 0.89, "scale " + s);
    assert.ok(766 - a4 * s >= 48 - 1, "paper + gutters must fit without horizontal scroll");
    assert.equal(paperFitScale(100, a4), 0.4); // floor
    assert.equal(paperFitScale(0, a4), 1);     // not measured yet
  });

  await t.test("NotePanel wires the measured area and --paper-fit; CSS zooms only on desktop", () => {
    const notePanelCode = grab(/function NotePanel\([\s\S]*?^function /m);
    assert.match(notePanelCode, /const viewerPaperScale = usePaperFitScale\(viewerPaperAreaRef, viewerPaperConfig\)/);
    assert.match(notePanelCode, /ref: viewerPaperAreaRef,\s*className: "paper-mode-active paper-fit-area"/);
    assert.match(notePanelCode, /"--paper-fit": viewerPaperScale/);
    const desktopCss = grab(/@media \(min-width: 769px\) \{[\s\S]*?\n\}/);
    assert.match(desktopCss, /\.paper-fit-area \.paper-inner-wrap \{\s*zoom: var\(--paper-fit, 1\);/);
  });
});
