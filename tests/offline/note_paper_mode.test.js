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

  const initPaperConfigMatch = noteModalCode.match(/const initPaperConfig = \(\) => \{([\s\S]*?)\n\s*\};\s*const \[paperConfig/);
  assert.ok(initPaperConfigMatch, "initPaperConfig function should be present in NoteModal");

  const runInitPaperConfig = (note) => {
    const fn = new Function("note", `
      const initPaperConfig = () => { ${initPaperConfigMatch[1]} };
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

  await t.test("Service Worker and cache version is taskflow-v403-android-icon-margin", () => {
    assert.match(swJs, /^const CACHE = "taskflow-v403-android-icon-margin";/m);
    assert.match(indexHtml, /window\.__SW_VERSION\s*=\s*"taskflow-v403-android-icon-margin";/);
    assert.match(indexHtml, /window\.__SW_VERSION\s*\|\|\s*"taskflow-v403-android-icon-margin"/);
    assert.match(webappPy, /sw_cache = "taskflow-v403-android-icon-margin"/);
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
      /className:\s*viewerPaperConfig\?\.enabled\s*\?\s*"paper-btn-active"\s*:\s*""/,
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
      /viewerPaperConfig\?\.enabled\s*&&\s*(?:\/\*#__PURE__\*\/\s*)?React\.createElement\("select",\s*\{[\s\S]*?className:\s*"paper-select"[\s\S]*?value:\s*viewerPaperConfig\.size/,
      "NotePanel should render size select when paper mode is enabled"
    );
    assert.match(
      notePanelCode,
      /viewerPaperConfig\?\.enabled\s*&&\s*(?:\/\*#__PURE__\*\/\s*)?React\.createElement\("select",\s*\{[\s\S]*?className:\s*"paper-select"[\s\S]*?value:\s*viewerPaperConfig\.orientation/,
      "NotePanel should render orientation select when paper mode is enabled"
    );
  });

  await t.test("NotePanel wraps rendered note with paper-mode-active, paper-inner-wrap and PaperPageGuides", () => {
    assert.match(
      notePanelCode,
      /viewerPaperConfig\?\.enabled\s*\?\s*React\.createElement\("div",\s*\{[\s\S]*?className:\s*"paper-mode-active"/,
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
