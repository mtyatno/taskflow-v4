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

test("Interactive Note Viewer Specifications", async (t) => {
  // Extract NotePanel component code
  const notePanelMatch = indexHtml.match(/function NotePanel\([\s\S]*?^function NotesPage/m);
  const notePanelCode = notePanelMatch ? notePanelMatch[0] : "";
  assert.ok(notePanelCode.length > 0, "NotePanel function should be present in static/index.html");

  // Extract NoteModal component code
  const noteModalMatch = indexHtml.match(/function NoteModal\([\s\S]*?^function NotePanel/m);
  const noteModalCode = noteModalMatch ? noteModalMatch[0] : "";
  assert.ok(noteModalCode.length > 0, "NoteModal function should be present in static/index.html");

  await t.test("1. Interactive Checkboxes in renderMarkdown and NotePanel", () => {
    // renderMarkdown should post-process task checkboxes to remove disabled and attach data-task-checkbox-idx
    assert.match(
      indexHtml,
      /data-task-checkbox-idx/,
      "renderMarkdown should attach data-task-checkbox-idx to task checklist inputs"
    );

    // NotePanel handlePreviewClick should detect checkbox clicks and toggle task in markdown
    assert.match(
      notePanelCode,
      /data-task-checkbox-idx|task-checkbox/i,
      "NotePanel should handle clicks on task checkboxes"
    );

    // NotePanel should update note.content and call api.put
    assert.match(
      notePanelCode,
      /api\.put\([`'"]\/api\/scratchpad\//,
      "NotePanel should persist note changes via api.put"
    );
  });

  await t.test("2. Markdown Task Checkbox Toggle Logic Helper", () => {
    // Test the toggle logic with multiple checklist items
    function toggleTaskCheckbox(content, targetIndex) {
      let currentIndex = 0;
      return content.replace(/^([ \t]*[-*+]\s+\[)([ xX])(\]\s+.*)$/gm, (match, prefix, checkState, suffix) => {
        if (currentIndex === targetIndex) {
          const nextState = checkState === " " ? "x" : " ";
          currentIndex++;
          return `${prefix}${nextState}${suffix}`;
        }
        currentIndex++;
        return match;
      });
    }

    const initial = "# My List\n- [ ] Task 1\n- [x] Task 2\n  * [ ] Subtask 3";
    const toggled0 = toggleTaskCheckbox(initial, 0);
    assert.strictEqual(toggled0, "# My List\n- [x] Task 1\n- [x] Task 2\n  * [ ] Subtask 3");

    const toggled1 = toggleTaskCheckbox(toggled0, 1);
    assert.strictEqual(toggled1, "# My List\n- [x] Task 1\n- [ ] Task 2\n  * [ ] Subtask 3");

    const toggled2 = toggleTaskCheckbox(toggled1, 2);
    assert.strictEqual(toggled2, "# My List\n- [x] Task 1\n- [ ] Task 2\n  * [x] Subtask 3");
  });

  await t.test("3. Inline Title Edit in NotePanel", () => {
    // NotePanel should have title editing state
    assert.match(
      notePanelCode,
      /isEditingTitle|editingTitle/i,
      "NotePanel should have state for editing the title"
    );

    // NotePanel should render an input for title when editing
    assert.match(
      notePanelCode,
      /note-title-inline-input|notes-panel-title-input/i,
      "NotePanel should render an inline input for title editing"
    );
  });

  await t.test("4. Double-Click to Open Full Editor", () => {
    // .note-rendered container should have onDoubleClick handler
    assert.match(
      notePanelCode,
      /onDoubleClick/,
      "NotePanel .note-rendered container should have an onDoubleClick handler"
    );
  });

  await t.test("5. Complete Preservation of NoteModal, Paper Mode & Milkdown", () => {
    // NoteModal must still contain MilkdownEditor
    assert.match(
      noteModalCode,
      /MilkdownEditor/,
      "NoteModal must preserve MilkdownEditor component"
    );

    // NoteModal must still contain paperConfig and PaperPageGuides
    assert.match(
      noteModalCode,
      /paperConfig/,
      "NoteModal must preserve paperConfig state and logic"
    );
    assert.match(
      noteModalCode,
      /PaperPageGuides/,
      "NoteModal must preserve PaperPageGuides component"
    );

    // NoteModal must still contain NoteToolbar
    assert.match(
      noteModalCode,
      /NoteToolbar/,
      "NoteModal must preserve NoteToolbar"
    );
  });

  await t.test("6. CSS Pointer and Styling for Interactive Elements", () => {
    assert.match(
      appCss,
      /\.note-rendered\s+input\[type=["']?checkbox["']?\]/,
      "app.css should style checkboxes in .note-rendered as pointer"
    );
  });

  await t.test("7. Service Worker Cache Version Bumped", () => {
    assert.match(
      swJs,
      /taskflow-v344-double-click-block-focus/,
      "sw.js should be bumped to taskflow-v344-double-click-block-focus"
    );
  });

  await t.test("8. Note Title Wrapping Protection and Inline Flow", () => {
    assert.match(
      appCss,
      /\.notes-panel-title\s*\{[^}]*word-break:\s*normal/,
      "app.css should set word-break: normal on .notes-panel-title"
    );
    assert.match(
      appCss,
      /\.notes-panel-title\s*\{[^}]*overflow-wrap:\s*break-word/,
      "app.css should set overflow-wrap: break-word on .notes-panel-title"
    );
    assert.match(
      notePanelCode,
      /className:\s*["']note-title-clickable["']/,
      "NotePanel should apply note-title-clickable class to the title span"
    );
    assert.match(
      notePanelCode,
      /className:\s*["']note-title-pencil["']/,
      "NotePanel should render the pencil icon with note-title-pencil class"
    );
  });

  await t.test("9. Double-Click Block Cursor Positioning and Focus in NoteModal", () => {
    // Extract NotesPage component code
    const notesPageMatch = indexHtml.match(/function NotesPage\([\s\S]*?^function HabitCheckinModal/m);
    const notesPageCode = notesPageMatch ? notesPageMatch[0] : "";
    assert.ok(notesPageCode.length > 0, "NotesPage function should be present in static/index.html");

    // NotePanel onDoubleClick should capture blockTarget and pass to onEdit
    assert.match(
      notePanelCode,
      /blockTarget\s*=\s*\{[\s\S]*?text[\s\S]*?index[\s\S]*?\}/,
      "NotePanel onDoubleClick should extract blockTarget with text and index"
    );

    // NotesPage should maintain initialBlockTarget state and pass to NoteModal
    assert.match(
      notesPageCode,
      /initialBlockTarget/,
      "NotesPage should manage initialBlockTarget state"
    );

    // NoteModal should accept initialBlockTarget
    assert.match(
      noteModalCode,
      /initialBlockTarget/,
      "NoteModal should accept initialBlockTarget prop"
    );

    // NoteModal title input should not steal autoFocus for existing notes
    assert.match(
      noteModalCode,
      /autoFocus:\s*!note\?\.id\s*&&\s*!focusMode/,
      "NoteModal title input should suppress autoFocus for existing notes"
    );

    // NoteModal should search ProseMirror doc for block and set selection
    assert.match(
      noteModalCode,
      /doc\.descendants\([\s\S]*?targetPos/,
      "NoteModal should search doc.descendants for target block position"
    );
  });
});
