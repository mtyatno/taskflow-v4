"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const NM = require("../../static/offline/notemap.js");

const P = (md) => NM.parseNote(md);
const T = (md, title = "T") => JSON.parse(JSON.stringify(NM.buildMindData(P(md), { title }).nodeData));
const run = (md, mutate, title = "T") => { const t = T(md, title); mutate(t); return NM.applyMindData(md, P(md), t); };
const BASE = "Intro\n# A\nisi a\n## B\nisi b\n# C\nisi c\n";
const FIXTURES = [ "", "teks", "# A", "# A\nx", BASE, "# A\r\nx\r\n## B\r\ny", "## A ##\n```\n# kode\n```\n> ## q\n",
  "<details>\n<summary>S</summary>\n\n## in\n</details>\n# Luar\n", "# A\n## \n#### Lompat\n", "# 😀 Émoji\n::draw[d1]{title=\"G\"}\n[tasklink:t1]\n| a |\n|---|\n$$\nx\n$$\n",
  "# #tag thing\n", "## # A\n" ];

test("identity on fixtures", () => { for (const md of FIXTURES) { const r = run(md, () => {}); assert.equal(r.markdown, md); assert.equal(r.removed.count, 0); } });
test("identity on 200 generated documents", () => {
  let a = 42; const rnd = () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const pick = (xs) => xs[Math.floor(rnd() * xs.length)];
  const LINES = [() => "#".repeat(1 + Math.floor(rnd() * 6)) + " Judul " + Math.floor(rnd() * 9), () => "Paragraf isi.", () => "- butir", () => "- [x] cek",
    () => "```\n# bukan heading\n```", () => "> kutip", () => "", () => "<details>\n<summary>S</summary>\n\n## dalam\n</details>"];
  for (let i = 0; i < 200; i++) {
    const md = Array.from({ length: 5 + Math.floor(rnd() * 36) }, () => pick(LINES)()).join(rnd() < 0.2 ? "\r\n" : "\n") + (rnd() < 0.5 ? "\n" : "");
    assert.equal(run(md, () => {}).markdown, md);
  }
});
test("rename + sanitize + root title", () => {
  assert.equal(run(BASE, (t) => { t.children[0].children[0].topic = "Beta"; }).markdown, BASE.replace("## B\n", "## Beta\n"));
  assert.equal(run(BASE, (t) => { t.children[0].children[0].topic = "## Baru\nbaris"; }).markdown, BASE.replace("## B\n", "## Baru baris\n"));
  assert.equal(run(BASE, (t) => { t.children[0].children[0].topic = "   "; }).markdown, BASE);
  const r = run(BASE, (t) => { t.topic = "Judul Baru"; }); assert.equal(r.title, "Judul Baru"); assert.equal(r.markdown, BASE);
});
test("add child / top-level / empty note levels", () => {
  const nn = (topic = "Node baru") => ({ id: "x" + Math.random(), topic, children: [] });
  assert.equal(run(BASE, (t) => t.children[0].children.push(nn())).markdown, "Intro\n# A\nisi a\n## B\nisi b\n\n## Node baru\n# C\nisi c\n");
  assert.equal(run(BASE, (t) => t.children[1].children.push(nn())).markdown, BASE + "\n## Node baru\n");
  assert.equal(run("## A\nx\n", (t) => t.children.push(nn())).markdown, "## A\nx\n\n## Node baru\n");
  assert.equal(run("", (t) => t.children.push(nn())).markdown, "# Node baru\n");
});
test("insert parent shifts subtree; overflow rejected", () => {
  const r = run(BASE, (t) => { const b = t.children[0].children[0]; t.children[0].children[0] = { id: "p", topic: "P", children: [b] }; });
  assert.equal(r.markdown, "Intro\n# A\nisi a\n\n## P\n### B\nisi b\n# C\nisi c\n");
  const deep = "# 1\n## 2\n### 3\n#### 4\n##### 5\n###### 6\n";
  const o = run(deep, (t) => { let n = t; while (n.children[0]) n = n.children[0]; n.children.push({ id: "z", topic: "7", children: [] }); });
  assert.deepEqual(o, { ok: false, code: "LEVEL_OVERFLOW" });
});
test("move section with body; move under another parent re-levels", () => {
  assert.equal(run(BASE, (t) => t.children.reverse()).markdown, "Intro\n# C\nisi c\n# A\nisi a\n## B\nisi b\n");
  const r = run(BASE, (t) => { const b = t.children[0].children.pop(); t.children[1].children.push(b); });
  assert.equal(r.markdown, "Intro\n# A\nisi a\n# C\nisi c\n## B\nisi b\n");
});
test("delete reports removed content; duplicate copies body; foreign sid is new", () => {
  const d = run(BASE, (t) => t.children.shift());
  assert.equal(d.markdown, "Intro\n# C\nisi c\n"); assert.deepEqual(d.removed, { count: 2, hasContent: true, firstTitle: "A" });
  assert.equal(run("# A\n# B\n", (t) => t.children.pop()).removed.hasContent, false);
  const c = run(BASE, (t) => t.children.push(JSON.parse(JSON.stringify(t.children[1]))));
  assert.equal(c.markdown, BASE + "# C\nisi c\n");
  const f = run(BASE, (t) => t.children.push({ id: "q", topic: "Asing", nm: { sid: "s99" }, children: [] }));
  assert.equal(f.markdown, BASE + "\n# Asing\n");
});
test("CRLF and missing final newline when moving the last section", () => {
  assert.equal(run("# A\r\nisi\r\n# B\r\nakhir", (t) => t.children.reverse()).markdown, "# B\r\nakhir\r\n# A\r\nisi\r\n");
});
test("verifyStructure detects an unclosed fence swallowing later sections", () => {
  const md = "# A\nisi\n# B\n```\nterbuka\n";
  const t = T(md); t.children.reverse(); const r = NM.applyMindData(md, P(md), t);
  assert.equal(NM.verifyStructure(r.markdown, t), false);
  const ok = T(BASE); assert.equal(NM.verifyStructure(BASE, ok), true);
});
test("old sections under a new node are re-leveled (R6)", () => {
  const w = run(BASE, (t) => { t.children[0] = { id: "p", topic: "P", children: [t.children[0]] }; });
  assert.equal(w.markdown, "Intro\n\n# P\n## A\nisi a\n### B\nisi b\n# C\nisi c\n");
  const m = run(BASE, (t) => { const c = t.children.pop(); t.children.push({ id: "n", topic: "N", children: [c] }); });
  assert.equal(m.markdown, "Intro\n# A\nisi a\n## B\nisi b\n\n# N\n## C\nisi c\n");
});
test("verifyStructure checks nesting (R7)", () => {
  const md1 = "## A\nx\n# B\ny\n";
  const t1 = T(md1); t1.children.reverse(); const r1 = NM.applyMindData(md1, P(md1), t1);
  assert.equal(r1.markdown, "# B\ny\n## A\nx\n");
  assert.equal(NM.verifyStructure(r1.markdown, t1), false);
  const md2 = "# R\n### x\n## y\n";
  const t2 = T(md2); t2.children[0].children.push({ id: "n", topic: "N", children: [] }); const r2 = NM.applyMindData(md2, P(md2), t2);
  assert.equal(r2.markdown, "# R\n### x\n## y\n\n### N\n");
  assert.equal(NM.verifyStructure(r2.markdown, t2), false);
});
test("broken trees are rejected with BAD_TREE", () => {
  for (const bad of [null, undefined, "x", 3, {}, { topic: "T", children: "no" }]) {
    assert.deepEqual(NM.applyMindData(BASE, P(BASE), bad), { ok: false, code: "BAD_TREE" });
  }
});
test("stale parse (markdown changed since parseNote) is rejected", () => {
  const t = T(BASE);
  assert.deepEqual(NM.applyMindData(BASE + "tambahan\n", P(BASE), t), { ok: false, code: "STALE_PARSE" });
  assert.deepEqual(NM.applyMindData("lain", P(BASE), t), { ok: false, code: "STALE_PARSE" });
  assert.equal(NM.applyMindData(BASE, P(BASE), t).ok, true);
});
test("placeholder root title is not returned as the note title", () => {
  const t = JSON.parse(JSON.stringify(NM.buildMindData(P(BASE), { title: "" }).nodeData));
  assert.equal(t.topic, "Tanpa judul");
  assert.equal(NM.applyMindData(BASE, P(BASE), t).title, "");
  t.topic = "Judul Asli"; assert.equal(NM.applyMindData(BASE, P(BASE), t).title, "Judul Asli");
  assert.equal(run(BASE, () => {}, "Tanpa judul").title, "Tanpa judul"); // judul sungguhan, bukan placeholder
});
test("untouched headings starting with # survive an edit elsewhere byte-identical", () => {
  const md = "# #tag thing\nx\n## # A\ny\n# B\n";
  const e = T(md); e.children[1].topic = "B2"; const r = NM.applyMindData(md, P(md), e);
  assert.equal(r.markdown, "# #tag thing\nx\n## # A\ny\n# B2\n");
  assert.equal(NM.verifyStructure(r.markdown, e), true);
  const c = run(md, (t) => t.children.push(JSON.parse(JSON.stringify(t.children[0]))));
  assert.equal(c.markdown, md + "# #tag thing\nx\n## # A\ny\n");
  const w = run(md, (t) => { t.children[0] = { id: "p", topic: "P", children: [t.children[0]] }; });
  assert.equal(w.markdown, "# P\n## #tag thing\nx\n### # A\ny\n# B\n");
  assert.equal(NM.sanitizeTopic("#tag"), "#tag");
  assert.equal(NM.sanitizeTopic("## Baru\nbaris"), "Baru baris");
  assert.equal(run("# A\n", (t) => t.children.push({ id: "n", topic: "#tag", children: [] })).markdown, "# A\n\n# #tag\n");
});
