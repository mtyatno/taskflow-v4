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
