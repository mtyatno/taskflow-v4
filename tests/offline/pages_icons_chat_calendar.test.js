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
// Teks toast dan komentar bukan ikon UI.
const ui = src => src.split("\n").filter(l => !/showToast\(/.test(l) && !/^\s*\/\//.test(l) && !/\s\/\/ /.test(l)).join("\n");

const chat = sliceFn("ChatListPanel") + sliceFn("ChatPage");
const cal = sliceFn("CalendarView");

for (const [label, src] of [["Diskusi/Chat", chat], ["Kalender", cal]]) {
  test(label + " bebas emoji ikon (literal maupun escape \\u)", () => {
    const lines = ui(src).replace(/✓/g, ""); // "✓ Done"/"✓ Selesai" sengaja dibiarkan
    const m = lines.match(/[\u{1F300}-\u{1FAFF}☀-➿⬀-⯿️★✕]/u);
    assert.ok(!m, "emoji/simbol literal tersisa: " + (m && m[0]));
    const esc = lines.replace(/\\u2713/g, "").match(/\\u(?:D83[CD]|D83E|2[67][0-9A-F]{2}|2B[0-9A-F]{2}|FE0F|2605|2715)/i);
    assert.ok(!esc, "emoji escape tersisa: " + (esc && esc[0]));
  });
}

const gl = (src, k, s) => assert.match(src, new RegExp('name:\\s*"' + k + '",\\s*size:\\s*' + s + "\\b"), k + " " + s);
const count = (src, k, s) => (src.match(new RegExp('name:\\s*"' + k + '",\\s*size:\\s*' + s + "\\b", "g")) || []).length;

test("Chat memakai ViewGlyph", () => {
  gl(chat, "pChat", 18);
  gl(chat, "fSearch", 15);
  gl(chat, "fX", 13);
  gl(chat, "wsTasks", 28);
  gl(chat, "pChat", 44);
  assert.match(chat, /className: "wsf-title-ico"/);
  assert.match(chat, /"Diskusi \/ Chat"/);
  assert.ok(chat.includes('color: "var(--text-light)"'));
});

test("Kalender memakai ViewGlyph di setiap sub-view", () => {
  gl(cal, "pCalendar", 22);
  assert.match(cal, /className: "wsf-title-ico"/);
  assert.match(cal, /"Kalender"/);
  assert.ok(count(cal, "pRepeat", 12) >= 3, "pRepeat 12 di semua judul rekuren");
  assert.ok(count(cal, "fFolder", 12) >= 2, "fFolder 12 untuk proyek");
  assert.ok(count(cal, "pDot", 10) >= 2, "pDot 10 sendiri");
  assert.ok(count(cal, "pDot", 8) >= 4, "pDot 8 + teks");
  assert.ok(count(cal, "pCalendar", 15) >= 3, "pCalendar 15 label tanggal");
  gl(cal, "pRepeat", 15);
  assert.ok(count(cal, "fX", 14) >= 2, "fX 14 tombol tutup popup");
  assert.match(cal, /name: "pDot",\s*size: 10/);
  assert.ok(cal.includes("#ef4444"));
});

test("Kalender: tombol tutup punya aria-label", () => {
  assert.ok((cal.match(/"aria-label": "Tutup"/g) || []).length >= 2);
});
