const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

test("View Mode Toggle and CSS in NotesPage", async (t) => {
  const indexHtml = fs.readFileSync(path.join(__dirname, "../../static/index.html"), "utf8");
  const appCss = fs.readFileSync(path.join(__dirname, "../../static/app.css"), "utf8");

  await t.test("app.css defines compact view rules", () => {
    assert.match(appCss, /\.note-card\.note-card--compact/);
    assert.match(appCss, /\.note-card\.note-card--compact\s+\.note-card-preview\s*\{[^}]*display:\s*none/);
  });

  await t.test("index.html defines viewMode state and toggle button", () => {
    assert.match(indexHtml, /tf_notes_view_mode/);
    assert.match(indexHtml, /note-card--compact/);
  });
});

test("Saved Searches UI and SW v350", async (t) => {
  const indexHtml = fs.readFileSync(path.join(__dirname, "../../static/index.html"), "utf8");
  const swJs = fs.readFileSync(path.join(__dirname, "../../static/sw.js"), "utf8");

  await t.test("index.html handles saved searches api and chips", () => {
    assert.match(indexHtml, /\/api\/scratchpad\/saved-searches/);
    assert.match(indexHtml, /savedSearches/);
    assert.match(indexHtml, /handleSaveSearch/);
    assert.match(indexHtml, /handleDeleteSavedSearch/);
  });

  await t.test("sw.js bumped to taskflow-v350-note-saved-searches-view-mode", () => {
    assert.match(swJs, /taskflow-v350-note-saved-searches-view-mode/);
  });
});
