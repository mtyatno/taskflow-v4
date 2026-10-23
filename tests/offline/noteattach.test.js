const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const na = require("../../static/offline/noteattach.js");
const indexHtml = fs.readFileSync(path.join(__dirname, "../../static/index.html"), "utf8");
const swJs = fs.readFileSync(path.join(__dirname, "../../static/sw.js"), "utf8");

test("attachmentMarkdown: gambar → ![nama](url), file lain → [📄 nama](url)", () => {
  assert.equal(na.attachmentMarkdown({ id: 44, mime_type: "image/png", original_name: "ChatGPT Image Jul 22, 2026, 09_09_26 AM.png" }),
    "![ChatGPT Image Jul 22, 2026, 09_09_26 AM.png](/api/scratchpad/attachments/44/view)");
  assert.equal(na.attachmentMarkdown({ id: 7, mime_type: "application/pdf", original_name: "laporan.pdf" }),
    "[📄 laporan.pdf](/api/scratchpad/attachments/7/view)");
  assert.equal(na.attachmentMarkdown({ id: 3, mime_type: "image/jpeg" }), "![image](/api/scratchpad/attachments/3/view)");
});

test("attachmentMarkdown: kurung siku, backslash, baris baru di nama di-escape", () => {
  assert.equal(na.attachmentMarkdown({ id: 1, mime_type: "image/png", original_name: "a]b[c\\d\ne.png" }),
    "![a\\]b\\[c\\\\d e.png](/api/scratchpad/attachments/1/view)");
});

test("repairEscapedAttachmentLinks: pulihkan isi yang rusak dari bug lama", () => {
  const broken = "Isi\n\n!\\[ChatGPT Image Jul 22, 2026, 09\\_09\\_26 AM.png]\\(/api/scratchpad/attachments/44/view)";
  assert.equal(na.repairEscapedAttachmentLinks(broken),
    "Isi\n\n![ChatGPT Image Jul 22, 2026, 09_09_26 AM.png](/api/scratchpad/attachments/44/view)");
  assert.equal(na.repairEscapedAttachmentLinks("\\[📄 dok uji.pdf]\\(/api/scratchpad/attachments/2/view)"),
    "[📄 dok uji.pdf](/api/scratchpad/attachments/2/view)");
  // nama berisi kurung siku tidak dipulihkan (lebih aman daripada salah gabung; kasus jarang)
  assert.equal(na.repairEscapedAttachmentLinks("x !\\[a\\]b.png]\\(/api/scratchpad/attachments/9/view) y"),
    "x !\\[a\\]b.png]\\(/api/scratchpad/attachments/9/view) y");
});

test("repairEscapedAttachmentLinks: teks lain tidak disentuh", () => {
  const cases = [
    "",
    "biasa saja",
    "![ok](/api/scratchpad/attachments/1/view)",
    "\\[bukan lampiran]\\(https://contoh.com)",
    "\\[x]\\(/api/scratchpad/attachments/abc/view)",
    "\\[catatan] biasa",
  ];
  for (const c of cases) assert.equal(na.repairEscapedAttachmentLinks(c), c);
  assert.equal(na.repairEscapedAttachmentLinks(null), null);
});

test("repairEscapedAttachmentLinks: tautan yang sudah benar & kode tidak dirusak (review)", () => {
  const keep = [
    // backslash literal (\\) diikuti tautan asli → bukan escape
    "\\\\[a](/api/scratchpad/attachments/3/view)",
    // `[` tak ter-escape di label → tautan asli [y](...) tetap utuh
    "\\[x\\] text [y](/api/scratchpad/attachments/9/view)",
    // inline code + blok kode
    "`!\\[a]\\(/api/scratchpad/attachments/1/view)`",
    "```\n!\\[a]\\(/api/scratchpad/attachments/1/view)\n```",
    "~~~md\n\\[📄 b]\\(/api/scratchpad/attachments/2/view)\n~~~",
  ];
  for (const c of keep) assert.equal(na.repairEscapedAttachmentLinks(c), c, c);
  // dua lampiran rusak di satu baris → dua node terpisah (tidak tergabung)
  assert.equal(na.repairEscapedAttachmentLinks("!\\[a]\\(/api/scratchpad/attachments/1/view) x \\[b]\\(/api/scratchpad/attachments/2/view)"),
    "![a](/api/scratchpad/attachments/1/view) x [b](/api/scratchpad/attachments/2/view)");
  // setelah blok kode ditutup, perbaikan berjalan lagi
  assert.equal(na.repairEscapedAttachmentLinks("```\nx\n```\n!\\[c]\\(/api/scratchpad/attachments/5/view)"),
    "```\nx\n```\n![c](/api/scratchpad/attachments/5/view)");
});

test("repairEscapedAttachmentLinks: satu baris panjang tetap cepat", () => {
  const line = "\\[".repeat(20000) + " /api/scratchpad/attachments/1/view";
  const t0 = Date.now();
  na.repairEscapedAttachmentLinks(line);
  assert.ok(Date.now() - t0 < 1500, "harus < 1,5 dtk");
});

test("statusText / percent", () => {
  assert.equal(na.statusText("a.png", 0, 0), "Mengunggah a.png…");
  assert.equal(na.statusText("a.png", 50, 200), "Mengunggah a.png…");
  assert.equal(na.percent(199, 200), 99);
  assert.equal(na.percent(200, 200), 100);
  assert.equal(na.statusText("a.png", 200, 200), "Menyimpan a.png…");
  assert.equal(na.percent(1, 4), 25);
  assert.equal(na.percent(5, 0), null);
});

test("index.html + sw.js memuat noteattach.js; editor memakai parser, bukan insertText", () => {
  assert.ok(indexHtml.includes('<script src="/static/offline/noteattach.js"></script>'));
  assert.ok(swJs.includes('"/static/offline/noteattach.js"'));
  const start = indexHtml.indexOf("const uploadNoteAttachment = (file, onProgress) =>");
  const fn = indexHtml.slice(start, indexHtml.indexOf("const headings = [", start));
  assert.ok(start !== -1);
  assert.doesNotMatch(fn, /insertText\(syntax\)/, "sintaks markdown jangan disisipkan sebagai teks mentah");
  assert.match(fn, /NA\.attachmentMarkdown\(att\)/);
  assert.match(fn, /insertParsedMarkdown\(/);
  assert.match(fn, /upload\.onprogress/, "progres unggahan dilaporkan");
  assert.doesNotMatch(fn, /\balert\(/, "galat lewat toast, bukan alert()");
  assert.match(indexHtml, /className: "note-upload-status"/);
  assert.match(indexHtml, /className: "note-upload-pct"/, "persentase terpisah agar tidak terpotong di layar sempit");
  assert.match(indexHtml, /ctx\.set\(MB\.defaultValueCtx, repairNoteMarkdown\(value \|\| ''\)\);/);
  assert.match(indexHtml, /const next = repairNoteMarkdown\(value \|\| ''\);/);
});
