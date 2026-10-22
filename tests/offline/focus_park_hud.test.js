"use strict";

// Input Parkir Distraksi (halaman Fokus) memakai HUD "Task Created" yang sama dengan Dashboard.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const indexHtml = fs.readFileSync(path.resolve(__dirname, "../../static/index.html"), "utf8").replace(/\r\n/g, "\n");

function fnSource(name) {
  const start = indexHtml.indexOf(`\nfunction ${name}(`);
  assert.ok(start >= 0, `${name} must exist`);
  const end = indexHtml.indexOf("\n}\n", start + 1);
  assert.ok(end > start, `${name} end must be found`);
  return indexHtml.slice(start, end);
}

test("CenterHudToast: komponen bersama dengan markup/kelas/ikon identik", () => {
  const src = fnSource("CenterHudToast");
  assert.ok(src.includes("`center-hud-toast center-hud-${toast.type}`"));
  assert.ok(src.includes("`center-hud-icon-wrap center-hud-icon-${toast.type}`"));
  assert.ok(src.includes('"clipboardCheck"'));
  assert.ok(src.includes('"activity"'));
  assert.ok(src.includes('role: "status"'));
  assert.ok(src.includes('"aria-live": "polite"'));
  assert.ok(src.includes('"center-hud-title"'));
  assert.ok(src.includes("toast.title"));
});

test("useCenterHudToast: hilang otomatis 2800 ms", () => {
  const src = fnSource("useCenterHudToast");
  assert.ok(src.includes("2800"));
  assert.ok(src.includes("clearTimeout"));
});

test("Dashboard memakai komponen bersama (tanpa markup HUD inline)", () => {
  const src = fnSource("Dashboard");
  assert.ok(src.includes("React.createElement(CenterHudToast"));
  assert.ok(src.includes("useCenterHudToast()"));
  assert.ok(!src.includes('className: `center-hud-toast'), "markup HUD tidak boleh duplikat di Dashboard");
  assert.ok(src.includes('title: "Task Created"'));
});

test("PomoParkInput: HUD task 'Task Created' hanya setelah POST sukses", () => {
  const src = fnSource("PomoParkInput");
  assert.ok(src.includes("useCenterHudToast()"));
  assert.ok(src.includes("React.createElement(CenterHudToast"));
  const post = src.indexOf('api.post("/api/tasks"');
  const show = src.indexOf('type: "task"');
  const title = src.indexOf('title: "Task Created"');
  const catchAt = src.indexOf("} catch");
  assert.ok(post >= 0 && show > post && title > post, "HUD setelah api.post");
  assert.ok(show < catchAt && title < catchAt, "HUD bukan di blok catch");
  assert.ok(src.includes('"Gagal menyimpan ke Inbox"'), "toast galat tetap");
  assert.ok(src.includes("parkPayload("), "payload tidak berubah");
});

test("PomoParkInput: HUD di-portal ke body agar tidak terjebak kontainer kartu/Zen", () => {
  const hud = fnSource("CenterHudToast");
  assert.ok(hud.includes("createPortal"));
  assert.ok(hud.includes("document.body"));
  assert.ok(/portal: true/.test(fnSource("PomoParkInput")));
  assert.ok(!/portal: true/.test(fnSource("Dashboard")), "Dashboard tetap tanpa portal");
});
