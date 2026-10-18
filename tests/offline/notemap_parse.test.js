"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const NM = require("../../static/offline/notemap.js");
const texts = (p) => p.sections.map((s) => s.text);

test("intro, sections, bodies, parents", () => {
  const p = NM.parseNote("Pembuka.\n# A\nisi a\n## B\nisi b\n# C\n");
  assert.equal(p.intro, "Pembuka.\n");
  assert.deepEqual(p.sections.map((s) => s.sid), ["s0", "s1", "s2"]);
  assert.deepEqual(p.sections.map((s) => s.level), [1, 2, 1]);
  assert.deepEqual(texts(p), ["A", "B", "C"]);
  assert.equal(p.sections[0].headingLine, "# A\n");
  assert.deepEqual(p.sections.map((s) => s.body), ["isi a\n", "isi b\n", ""]);
  assert.deepEqual(p.sections.map((s) => s.parentSid), [null, "s0", null]);
  assert.deepEqual(p.sections[0].childSids, ["s1"]);
});
test("level skip attaches to nearest higher heading", () => {
  const p = NM.parseNote("## A\n#### B\n### C\n");
  assert.deepEqual(p.sections.map((s) => s.parentSid), [null, "s0", "s0"]);
});
test("ignores fences, quotes, details, empty, setext, #tag", () => {
  const md = "# Ya1\n```\n# kode\n```\n~~~\n## x\n~~~\n> ## kutip\n<details>\n<summary>T</summary>\n\n## dalam\n</details>\n## \n#tag\nJudul\n===\n````\n```\n# no\n````\n## Ya2\n";
  assert.deepEqual(texts(NM.parseNote(md)), ["Ya1", "Ya2"]);
});
test("closing hashes stripped from text, kept in headingLine", () => {
  const s = NM.parseNote("## Judul ##\n").sections[0];
  assert.equal(s.text, "Judul"); assert.equal(s.headingLine, "## Judul ##\n");
});
test("CRLF preserved", () => {
  const p = NM.parseNote("# A\r\nx\r\n");
  assert.equal(p.eol, "\r\n"); assert.equal(p.sections[0].headingLine, "# A\r\n"); assert.equal(p.sections[0].body, "x\r\n");
});
test("slices concatenate back to the input", () => {
  for (const md of ["", "teks saja", "# A", "# A\nx", "a\n\n# B\n\ny\n## C\n```\n# z\n```\n"]) {
    const p = NM.parseNote(md);
    assert.equal(p.intro + p.sections.map((s) => s.headingLine + s.body).join(""), md);
  }
});
test("nested details and unclosed fence keep headings hidden", () => {
  const p = NM.parseNote("<details>\n<details>\n</details>\n## masih dalam\n</details>\n## luar\n");
  assert.deepEqual(texts(p), ["luar"]);
  assert.deepEqual(texts(NM.parseNote("```\n# a\n")), []);
});
test("CRLF heading with closing hashes and no trailing newline", () => {
  const p = NM.parseNote("# A #\r\n## B");
  assert.deepEqual(texts(p), ["A", "B"]);
  assert.equal(p.eol, "\r\n");
  assert.equal(p.sections[1].headingLine, "## B");
});
test("eol defaults to LF", () => {
  assert.equal(NM.parseNote("# A").eol, "\n");
});
test("details tags count only at line start/end; headings never open details", () => {
  assert.deepEqual(texts(NM.parseNote("# A\nUse `<details>` tag\n# B\n## C\n")), ["A", "B", "C"]);
  assert.deepEqual(texts(NM.parseNote("## About <details>\n# B\n## C\n")), ["About <details>", "B", "C"]);
  assert.deepEqual(texts(NM.parseNote("<details>\n## in\ntutup di sini </details>\n# Luar\n")), ["Luar"]);
  assert.deepEqual(texts(NM.parseNote("<DETAILS open>\n## in\n</details> lalu teks\n# Luar\n")), ["Luar"]);
  assert.deepEqual(texts(NM.parseNote("<details><summary>S</summary>isi</details>\n# Luar\n")), ["Luar"]);
  assert.deepEqual(texts(NM.parseNote("<details>\nteks </details> masih teks\n## in\n</details>\n# Luar\n")), ["Luar"]);
});
test("backtick fence opener with a backtick in the info string is not a fence", () => {
  assert.deepEqual(texts(NM.parseNote("# A\n```js`x\n# B\n")), ["A", "B"]);
  assert.deepEqual(texts(NM.parseNote("# A\n``` kode ```\n# B\n")), ["A", "B"]);
  assert.deepEqual(texts(NM.parseNote("# A\n~~~ a`b\n# B\n~~~\n# C\n")), ["A", "C"]);
});
