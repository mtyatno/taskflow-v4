const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "../..");
const indexHtml = fs.readFileSync(path.join(root, "static/index.html"), "utf8");
const swJs = fs.readFileSync(path.join(root, "static/sw.js"), "utf8");
const webappPy = fs.readFileSync(path.join(root, "webapp.py"), "utf8");

function sliceFn(name) {
  const s = indexHtml.indexOf("function " + name + "(");
  assert.ok(s > 0, name + " ada");
  const e = indexHtml.indexOf("\nfunction ", s + 10);
  assert.ok(e > s, name + " slice");
  return indexHtml.slice(s, e);
}
// Teks toast dan komentar bukan ikon UI.
const ui = src => src.split("\n").filter(l => !/showToast\(/.test(l) && !/^\s*\/\//.test(l)).join("\n");

const NEW_KEYS = ["pPalette", "pChat", "pCalendar", "pRepeat", "pDot", "pTarget", "pFlame", "pHourglass", "pSprout", "pZap", "pCheckCircle", "pPencil"];

const mindmap = sliceFn("MindmapListItem") + sliceFn("MindmapPage") + sliceFn("MindmapTrashList");
const draw = sliceFn("DrawingListItem") + sliceFn("DrawPage");

for (const [label, src] of [["Mindmap", mindmap], ["Gambar/Canvas", draw]]) {
  test(label + " bebas emoji ikon (literal maupun escape \\u)", () => {
    const lines = ui(src);
    const m = lines.match(/[\u{1F300}-\u{1FAFF}☀-➿⬀-⯿️★✕]/u);
    assert.ok(!m, "emoji/simbol literal tersisa: " + (m && m[0]));
    const esc = lines.match(/\\u(?:D83[CD]|D83E|2[67][0-9A-F]{2}|2B[0-9A-F]{2}|FE0F|2605|2715)/i);
    assert.ok(!esc, "emoji escape tersisa: " + (esc && esc[0]));
  });
}

test("VIEW_GLYPHS memuat 12 glyph baru", () => {
  const block = indexHtml.slice(indexHtml.indexOf("const VIEW_GLYPHS = {"), indexHtml.indexOf("function ViewGlyph("));
  for (const k of NEW_KEYS) assert.match(block, new RegExp("\\b" + k + ":\\s*'<"), "glyph " + k);
});

const gl = (src, k, s) => assert.match(src, new RegExp('name:\\s*"' + k + '",\\s*size:\\s*' + s + "\\b"), k + " " + s);

test("Mindmap memakai ViewGlyph", () => {
  gl(mindmap, "nBrain", 18);
  gl(mindmap, "fX", 15);
  gl(mindmap, "fX", 13);
  gl(mindmap, "nStar", 10);
  gl(mindmap, "fTrash", 14);
  gl(mindmap, "nBrain", 44);
  gl(mindmap, "mUsers", 13);
  gl(mindmap, "nNote", 13);
  gl(mindmap, "nNote", 12);
  gl(mindmap, "mUsers", 12);
  assert.match(mindmap, /className: "wsf-title-ico"/);
  assert.match(mindmap, /"Mindmaps"/);
  assert.match(mindmap, /"Sampah"/);
  assert.match(mindmap, /`\$\{l\.name\}`|l\.name\)/);
  assert.match(mindmap, /"aria-label": "Peta workspace"/);
  assert.match(mindmap, /"Peta workspace"/);
  assert.match(mindmap, /title: "Tertaut ke catatan"/);
});

test("Gambar/Canvas memakai ViewGlyph", () => {
  gl(draw, "pPalette", 18);
  gl(draw, "fX", 15);
  gl(draw, "fX", 13);
  gl(draw, "nStar", 10);
  gl(draw, "pPalette", 44);
  gl(draw, "mUsers", 12);
  gl(draw, "pPencil", 11);
  assert.match(draw, /className: "wsf-title-ico"/);
  assert.match(draw, /"Gambar \/ Canvas"/);
  assert.match(draw, /"Pinned"/);
});

test("cache bust taskflow-v445-pages-icons", () => {
  assert.match(swJs, /^const CACHE = "taskflow-v445-pages-icons";/m);
  assert.match(indexHtml, /window\.__SW_VERSION\s*=\s*"taskflow-v445-pages-icons";/);
  assert.match(indexHtml, /window\.__SW_VERSION\s*\|\|\s*"taskflow-v445-pages-icons"/);
  assert.match(webappPy, /sw_cache = "taskflow-v445-pages-icons"/);
});
