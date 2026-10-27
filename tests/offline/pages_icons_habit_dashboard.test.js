const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "../..");
const indexHtml = fs.readFileSync(path.join(root, "static/index.html"), "utf8");

function sliceFn(name) {
  const s = indexHtml.indexOf("function " + name + "(");
  assert.ok(s > 0, name + " ada");
  const e = indexHtml.indexOf("\nfunction ", s + 10);
  assert.ok(e > s, name + " slice");
  return indexHtml.slice(s, e);
}
const ui = src => src.split("\n").filter(l => !/showToast\??\.?\(/.test(l) && !/^\s*\/\//.test(l) && !/\s\/\/ /.test(l)).join("\n");

const habit = ["HabitCheckinModal", "HabitCard", "HabitEditModal", "HabitPage"].map(sliceFn).join("\n");
const dash = sliceFn("Dashboard");
const gl = (src, k, s) => assert.match(src, new RegExp('name:\\s*"' + k + '",\\s*size:\\s*' + s + "\\b"), k + " " + s);

test("Habit bebas emoji ikon (literal maupun escape \\u)", () => {
  // "✓ Done", tombol ✓/−/+ dan "Di-skip hari ini" (tanpa padanan ikon di rencana) dibiarkan
  const lines = ui(habit).replace(/✓/g, "").replace(/\\u2713/g, "").replace(/\\u23ED\\uFE0F Di-skip/g, "");
  const m = lines.match(/[\u{1F300}-\u{1FAFF}☀-➿⬀-⯿⏩-⏳️★✕]/u);
  assert.ok(!m, "emoji/simbol literal tersisa: " + (m && m[0]));
  const esc = lines.match(/\\u(?:D83[CD]|D83E|2[67][0-9A-F]{2}|2B[0-9A-F]{2}|23[0-9A-F]{2}|FE0F|2605|2715)/i);
  assert.ok(!esc, "emoji escape tersisa: " + (esc && esc[0]));
});

test("Habit memakai ViewGlyph", () => {
  const n = (k, s) => (habit.match(new RegExp('name:\\s*"' + k + '",\\s*size:\\s*' + s + "\\b", "g")) || []).length;
  assert.ok(n("pTarget", 13) >= 3, "pTarget 13 di Card, Checkin, Page");
  gl(habit, "pFlame", 15);
  gl(habit, "pHourglass", 13);
  assert.match(habit, /title: "Menunggu sinkron"/);
  gl(habit, "pPencil", 14);
  gl(habit, "fTrash", 14);
  gl(habit, "pCheckCircle", 15);
  gl(habit, "fX", 15);
  gl(habit, "pSprout", 44);
  assert.ok(habit.includes("#ef4444") && habit.includes("#f97316") && habit.includes("#16a34a"));
  assert.match(habit, /"Selesai hari ini"/);
  assert.match(habit, /"Edit"/);
  assert.match(habit, /"Hapus"/);
  assert.match(habit, /className: "wsf-title-ico"/);
});

test("Dashboard: chip habit, proyek, judul modal, tutup", () => {
  const d = ui(dash).replace(/🎉/g, "");
  assert.ok(!/[\u{1F300}-\u{1FAFF}⚡✕]/u.test(d), "emoji tersisa di Dashboard");
  assert.ok(!/\\u2715/.test(d));
  // Hero: streak (pFlame), terlambat (pAlert), Fokus (pTarget) memakai ViewGlyph, bukan emoji
  gl(dash, "pFlame", 14);
  gl(dash, "pAlert", 13);
  gl(dash, "pTarget", 15);
  assert.ok(dash.includes("#eab308"));
  gl(dash, "fFolder", 12);
  gl(dash, "fX", 15);
  assert.ok(dash.includes("openModal(proj, projTasks)"));
});
