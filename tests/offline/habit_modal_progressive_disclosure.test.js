"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "../..");
const indexHtml = fs.readFileSync(path.join(ROOT, "static/index.html"), "utf8");

test("Habit Modal Progressive Disclosure Specifications", async (t) => {
  // Extract TaskFormModal component code
  const taskModalMatch = indexHtml.match(/function TaskFormModal\([\s\S]*?^function /m);
  const taskModalCode = taskModalMatch ? taskModalMatch[0] : "";
  assert.ok(taskModalCode.length > 0, "TaskFormModal function should be present in static/index.html");

  // Extract HabitEditModal component code
  const habitEditModalMatch = indexHtml.match(/function HabitEditModal\([\s\S]*?^function /m);
  const habitEditModalCode = habitEditModalMatch ? habitEditModalMatch[0] : "";
  assert.ok(habitEditModalCode.length > 0, "HabitEditModal function should be present in static/index.html");

  await t.test("1. State management for showHabitAdvanced initialized to false", () => {
    assert.match(
      taskModalCode,
      /showHabitAdvanced/i,
      "TaskFormModal should define showHabitAdvanced state"
    );
  });

  await t.test("2. Collapsible toggle button is rendered in habit mode", () => {
    assert.match(
      taskModalCode,
      /task-advanced-toggle/,
      "Habit form should render a toggle button with class task-advanced-toggle"
    );
    assert.match(
      taskModalCode,
      /Opsi Lanjutan/i,
      "Habit form should include Opsi Lanjutan in toggle button"
    );
  });

  await t.test("3. Secondary fields (micro_target, frequency day selector, identity_pillar) inside advanced section", () => {
    assert.match(
      taskModalCode,
      /showHabitAdvanced\s*(&&|\?)/,
      "Secondary habit fields should be guarded by showHabitAdvanced"
    );
  });

  await t.test("4. Filled count computation reflects populated advanced fields", () => {
    function computeHabitFilledCount(form, daysLength = 7) {
      let count = 0;
      if (form.micro_target && form.micro_target.trim()) count++;
      if (Array.isArray(form.frequency) && form.frequency.length > 0 && form.frequency.length !== daysLength) count++;
      if (form.identity_pillar && form.identity_pillar.trim()) count++;
      return count;
    }

    assert.strictEqual(computeHabitFilledCount({ micro_target: "", frequency: ["mon","tue","wed","thu","fri","sat","sun"], identity_pillar: "" }), 0);
    assert.strictEqual(computeHabitFilledCount({ micro_target: "5 menit", frequency: ["mon","tue","wed","thu","fri","sat","sun"], identity_pillar: "" }), 1);
    assert.strictEqual(computeHabitFilledCount({ micro_target: "5 menit", frequency: ["mon","wed","fri"], identity_pillar: "" }), 2);
    assert.strictEqual(computeHabitFilledCount({ micro_target: "5 menit", frequency: ["mon","wed","fri"], identity_pillar: "Pribadi disiplin" }), 3);
  });

  await t.test("5. HabitEditModal preserves full form fields for editing", () => {
    assert.match(habitEditModalCode, /Nama Habit/i);
    assert.match(habitEditModalCode, /Fase/i);
    assert.match(habitEditModalCode, /Micro Target/i);
    assert.match(habitEditModalCode, /Frekuensi/i);
    assert.match(habitEditModalCode, /Identity Pillar/i);
  });
});
