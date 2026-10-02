"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "../..");
const indexHtml = fs.readFileSync(path.join(ROOT, "static/index.html"), "utf8");
const appCss = fs.readFileSync(path.join(ROOT, "static/app.css"), "utf8");

test("TaskFormModal Progressive Disclosure Specifications", async (t) => {
  // Extract TaskFormModal code block from static/index.html
  const modalMatch = indexHtml.match(/function TaskFormModal\([\s\S]*?^function /m);
  const modalCode = modalMatch ? modalMatch[0] : "";
  assert.ok(modalCode.length > 0, "TaskFormModal function must exist in static/index.html");

  await t.test("1. CSS rules for quick attributes and toggle button", () => {
    assert.match(
      appCss,
      /\.task-quick-attributes\s*\{[^}]*grid-template-columns:\s*1fr 1fr 1fr/,
      "app.css must define 3-column quick attributes"
    );
    assert.match(
      appCss,
      /\.task-advanced-toggle/,
      "app.css must define .task-advanced-toggle"
    );
  });

  await t.test("2. State management for showAdvanced initialized to isEdit", () => {
    assert.match(
      modalCode,
      /const\s*\[showAdvanced,\s*setShowAdvanced\]\s*=\s*React\.useState\(isEdit\)/,
      "showAdvanced state must initialize with isEdit"
    );
  });

  await t.test("3. Quick attributes grid contains Deadline, Priority, and Project", () => {
    assert.match(
      modalCode,
      /className:\s*["']task-quick-attributes["']/,
      "Quick attributes container must use .task-quick-attributes class"
    );
  });

  await t.test("4. Collapsible toggle button is rendered when !isEdit", () => {
    assert.match(
      modalCode,
      /!isEdit\s*&&[\s\S]*?className:\s*["']task-advanced-toggle["']/,
      "Toggle button must only be shown when not in edit mode"
    );
    assert.match(
      modalCode,
      /setShowAdvanced\(prev\s*=>\s*!prev\)/,
      "Toggle button must toggle showAdvanced state"
    );
  });

  await t.test("5. Secondary fields are contained within the advanced section", () => {
    assert.match(
      modalCode,
      /\(isEdit\s*\|\|\s*showAdvanced\)\s*&&/,
      "Secondary fields must be conditionally rendered based on isEdit || showAdvanced"
    );
  });

  await t.test("6. Filled count computation reflects populated advanced fields", () => {
    assert.match(
      modalCode,
      /advancedFilledCount/,
      "Must compute count of populated advanced attributes"
    );
  });
});
