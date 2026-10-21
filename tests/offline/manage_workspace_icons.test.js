const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const indexHtml = fs.readFileSync(path.join(__dirname, "../../static/index.html"), "utf8");
const appCss = fs.readFileSync(path.join(__dirname, "../../static/app.css"), "utf8");

function sliceFn(name) {
  const s = indexHtml.indexOf("function " + name + "(");
  assert.ok(s > 0, name + " ada");
  const e = indexHtml.indexOf("\nfunction ", s + 10);
  assert.ok(e > s, name + " slice");
  return indexHtml.slice(s, e);
}
const manager = sliceFn("SharedListsManager");
const chip = sliceFn("TopBarPomodoroChip");
// Teks toast bukan ikon UI.
const ui = src => src.split("\n").filter(l => !/showToast\(/.test(l)).join("\n");

const NEW_KEYS = ["mSettings", "mLink", "mXCircle", "mUsers", "mUser", "pomoTomato", "pomoBreak"];

for (const [label, src] of [["SharedListsManager", manager], ["TopBarPomodoroChip", chip]]) {
  test(label + " bebas emoji ikon (literal maupun escape \\u)", () => {
    const lines = ui(src);
    const m = lines.match(/[\u{1F300}-\u{1FAFF}☀-➿⬀-⯿️]/u);
    assert.ok(!m, "emoji literal tersisa: " + (m && m[0]));
    const esc = lines.match(/\\u(?:D83[CD]|D83E|2[67][0-9A-F]{2}|2B[0-9A-F]{2}|FE0F)/i);
    assert.ok(!esc, "emoji escape tersisa: " + (esc && esc[0]));
  });
}

test("VIEW_GLYPHS memuat 7 glyph baru", () => {
  const block = indexHtml.slice(indexHtml.indexOf("const VIEW_GLYPHS = {"), indexHtml.indexOf("function ViewGlyph("));
  for (const k of NEW_KEYS) assert.match(block, new RegExp("\\b" + k + ":\\s*'<"), "glyph " + k);
});

test("SharedListsManager memakai ViewGlyph di semua tempat", () => {
  for (const [k, s] of [["mSettings", 22], ["mLink", 16], ["mXCircle", 14], ["wsTasks", 16], ["mUser", 16], ["mLink", 14]]) {
    assert.match(manager, new RegExp('name:\\s*"' + k + '",\\s*size:\\s*' + s + "\\b"), k + " " + s);
  }
  assert.match(manager, /name:\s*l\.role === "owner" \? "wsTasks" : "mUsers",\s*size:\s*22/);
  assert.match(manager, /Kelola Workspace/);
  assert.match(manager, /className: "wsf-title-ico"/);
  assert.match(manager, /width: 40,\s*height: 40/);
  assert.match(manager, /title: l\.role === "owner" \? "Owner" : "Member"/);
  assert.match(manager, /"\.\.\." : \/\*#__PURE__\*\/React\.createElement\(|"\.\.\." :/);
  assert.match(manager, /Generate Invite Link/);
});

test("TopBarPomodoroChip: ViewGlyph pomoTomato/pomoBreak + kelas is-break", () => {
  assert.match(chip, /name:\s*timer\.isBreak \? "pomoBreak" : "pomoTomato"/);
  assert.match(chip, /size:\s*14/);
  assert.match(chip, /is-break/);
  assert.match(chip, /is-running/);
  assert.match(chip, /is-paused/);
  assert.match(chip, /name:\s*timer\.isRunning \? "pause" : "play"/);
});

test("CSS ikon chip Pomodoro", () => {
  assert.match(appCss, /\.topbar-pomo-icon\s*\{\s*display:\s*inline-flex;\s*color:\s*var\(--pomodoro\);\s*\}/);
  assert.match(appCss, /\.topbar-pomo-chip\.is-break \.topbar-pomo-icon\s*\{\s*color:\s*var\(--break\);\s*\}/);
});

test("cache bust v442 + app.css?v=350", () => {
  const swJs = fs.readFileSync(path.join(__dirname, "../../static/sw.js"), "utf8");
  const py = fs.readFileSync(path.join(__dirname, "../../webapp.py"), "utf8");
  assert.match(swJs, /^const CACHE = "taskflow-v442-focus-ambient";/m);
  assert.match(indexHtml, /window\.__SW_VERSION\s*=\s*"taskflow-v442-focus-ambient";/);
  assert.match(indexHtml, /window\.__SW_VERSION\s*\|\|\s*"taskflow-v442-focus-ambient"/);
  assert.match(py, /sw_cache = "taskflow-v442-focus-ambient"/);
  assert.match(indexHtml, /app\.css\?v=350/);
});
