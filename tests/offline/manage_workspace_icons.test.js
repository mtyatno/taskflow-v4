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
// Fase 1: daftar anggota + undangan diekstrak ke WorkspaceMembersSection (dipakai WorkspaceManagePage);
// halaman daftar SharedListsManager tetap memuat glyph judul/gabung, sliceFn digabung supaya cek ikon tetap utuh.
const manager = sliceFn("SharedListsManager") + sliceFn("WorkspaceMembersSection");
const chip = sliceFn("TopBarPomodoroChip");
// Teks toast bukan ikon UI.
const ui = src => src.split("\n").filter(l => !/showToast\(/.test(l)).join("\n");

const NEW_KEYS = ["mSettings", "mLink", "mXCircle", "mUsers", "mUser", "pomoTomato", "pomoBreak"];

for (const [label, src] of [["SharedListsManager", manager], ["WorkspaceManagePage", sliceFn("WorkspaceManagePage") + sliceFn("WorkspaceIdentityView") + sliceFn("WorkspaceIdentityForm")], ["TopBarPomodoroChip", chip]]) {
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
  // Fase 1 Task 6: ikon peran 40×40 di kartu diganti WorkspaceAvatar 40 px; peran tetap tertulis (Owner/Member).
  assert.match(manager, /React\.createElement\(WorkspaceAvatar, \{\s*list: l,\s*size: 40/);
  assert.match(manager, /l\.role === "owner" \? "Owner" : "Member", " \\xB7 ", l\.member_count, " anggota"/);
  assert.match(manager, /Kelola Workspace/);
  assert.match(manager, /className: "wsf-title-ico"/);
  assert.match(manager, /"\.\.\." : \/\*#__PURE__\*\/React\.createElement\(|"\.\.\." :/);
  // Fase 2a Task 6: tombol "Generate Invite Link" diganti bagian "Link undangan" (ikon mLink 14 di judulnya).
  assert.match(manager, /name: "mLink",\s*size: 14\s*\}\), "Link undangan"/);
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

test("cache bust v450 + app.css?v=381", () => {
  const swJs = fs.readFileSync(path.join(__dirname, "../../static/sw.js"), "utf8");
  const py = fs.readFileSync(path.join(__dirname, "../../webapp.py"), "utf8");
  assert.match(swJs, /^const CACHE = "taskflow-v485-hero-habit-hp";/m);
  assert.match(indexHtml, /window\.__SW_VERSION\s*=\s*"taskflow-v485-hero-habit-hp";/);
  assert.match(indexHtml, /window\.__SW_VERSION\s*\|\|\s*"taskflow-v485-hero-habit-hp"/);
  assert.match(indexHtml, /app\.css\?v=381/);
});
