"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../..");
const indexHtml = fs.readFileSync(path.join(root, "static/index.html"), "utf8");
const swJs = fs.readFileSync(path.join(root, "static/sw.js"), "utf8");
const webappPy = fs.readFileSync(path.join(root, "webapp.py"), "utf8");

test("Note Editor Slash Menu: Task insertion (/task, /tasks)", async (t) => {
  await t.test("slashMenu.appendChild registers 'task' with label 'Tugas / Task (/task, /tasks)'", () => {
    assert.match(
      indexHtml,
      /slashMenu\.appendChild\(makeSlashItem\(\s*['"]📌['"],\s*['"]Tugas \/ Task \(\/task, \/tasks\)['"],\s*['"]task['"]\s*\)\);/
    );
  });

  await t.test("doSlashAction handles case 'task': deletes query and invokes onInsertTaskRef.current?.()", () => {
    assert.match(
      indexHtml,
      /case\s+['"]task['"]:\s*\{[\s\S]*?const\s+qFrom2\s*=\s*state\.selection\.\$from;[\s\S]*?qText2\.lastIndexOf\(["']\/["']\)[\s\S]*?view\.dispatch\(state\.tr\.delete\(qFrom2\.start\(\)\s*\+\s*slashIdx2,\s*qFrom2\.pos\)\);[\s\S]*?onInsertTaskRef\.current\?\.(\(\);)?[\s\S]*?return;\s*\}/
    );
    assert.match(
      indexHtml,
      /if\s*\(\s*type\s*!==\s*['"]draw['"]\s*&&\s*type\s*!==\s*['"]task['"]\s*\)/
    );
  });

  await t.test("MilkdownEditor accepts onInsertTask prop and stores it in ref", () => {
    assert.match(
      indexHtml,
      /function\s+MilkdownEditor\s*\(\s*\{[\s\S]*?onInsertTask[\s\S]*?\}\s*\)/
    );
    assert.match(
      indexHtml,
      /const\s+onInsertTaskRef\s*=\s*React\.useRef\(onInsertTask\);/
    );
    assert.match(
      indexHtml,
      /React\.useEffect\(\(\)\s*=>\s*\{\s*onInsertTaskRef\.current\s*=\s*onInsertTask;\s*\},?\s*\[onInsertTask\]\);/
    );
  });

  await t.test("NoteModal passes onInsertTask: openTaskDropdown to MilkdownEditor", () => {
    assert.match(
      indexHtml,
      /React\.createElement\(MilkdownEditor,\s*\{[\s\S]*?onInsertTask:\s*openTaskDropdown/
    );
  });

  await t.test("TaskFormModal passes onInsertTask: openNoteTaskDropdown to MilkdownEditor", () => {
    assert.match(
      indexHtml,
      /React\.createElement\(MilkdownEditor,\s*\{[\s\S]*?onInsertTask:\s*openNoteTaskDropdown/
    );
  });

  await t.test("Regex /(?:^|\\n)\\/(todo|todos|task|tasks|tugas)$/i matches all expected aliases", () => {
    const slashTaskRegex = /(?:^|\n)\/(todo|todos|task|tasks|tugas)$/i;
    const validCommands = [
      "/task",
      "/tasks",
      "/todo",
      "/todos",
      "/tugas",
      "/TASK",
      "/Tasks",
      "/TODO",
      "/Tugas",
      "Line 1\n/task",
      "Catatan\n/todos",
      "Draft\n/tugas"
    ];

    for (const cmd of validCommands) {
      assert.ok(slashTaskRegex.test(cmd), `Expected regex to match: ${JSON.stringify(cmd)}`);
      const match = cmd.match(slashTaskRegex);
      assert.ok(match && match[1], `Expected capture group 1 for: ${JSON.stringify(cmd)}`);
    }

    const invalidCommands = [
      "not/task",
      "test/todos",
      "/task extra",
      "/task123",
      "/somethingelse",
      "//task"
    ];

    for (const invalid of invalidCommands) {
      assert.strictEqual(
        slashTaskRegex.test(invalid),
        false,
        `Expected regex NOT to match: ${JSON.stringify(invalid)}`
      );
    }

    // Verify regex presence in both NoteModal and TaskFormModal in index.html
    const matchesInHtml = indexHtml.match(/\/\(\?:\^\|\\n\)\\\/\(todo\|todos\|task\|tasks\|tugas\)\$\/i/g);
    assert.ok(
      matchesInHtml && matchesInHtml.length >= 2,
      "Expected regex /(?:^|\\n)\\/(todo|todos|task|tasks|tugas)$/i in NoteModal and TaskFormModal"
    );
  });

  await t.test("Service Worker cache is taskflow-v434-focus-park-zen in static/sw.js and webapp.py", () => {
    assert.match(swJs, /^const CACHE = "taskflow-v434-focus-park-zen";/m);
    assert.match(webappPy, /sw_cache = "taskflow-v434-focus-park-zen"/);
    assert.match(indexHtml, /window\.__SW_VERSION\s*=\s*"taskflow-v434-focus-park-zen";/);
  });
});
