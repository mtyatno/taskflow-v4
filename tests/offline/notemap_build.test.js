"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const NM = require("../../static/offline/notemap.js");

const build = (md, title, vs) => NM.buildMindData(NM.parseNote(md), { title, viewState: vs }).nodeData;
test("tree shape, root title and intro summary", () => {
  const t = build("Pembuka.\n# A\nisi\n## B\n# C\n", "Rencana");
  assert.equal(t.topic, "Rencana"); assert.equal(t.root, true);
  assert.equal(t.nm.summary.excerpt, "Pembuka.");
  assert.deepEqual(t.children.map((c) => c.id), ["s0", "s2"]);
  assert.deepEqual(t.children[0].children.map((c) => c.id), ["s1"]);
  assert.equal(t.children[0].children[0].nm.level, 2);
  assert.equal(t.children[0].nm.summary.excerpt, "isi");
  assert.equal(build("", "").topic, "Tanpa judul");
  assert.deepEqual(build("teks", "T").children, []);
});
test("initial collapse: ≤30 all open, >30 depth ≥2 collapsed", () => {
  const thirty = Array.from({ length: 30 }, (_, i) => `# H${i}\n`).join("");
  assert.ok(build(thirty, "T").children.every((c) => c.expanded === true));
  const big = Array.from({ length: 11 }, (_, i) => `# A${i}\n## B${i}\n### C${i}\n`).join(""); // 33 node
  const t = build(big, "T");
  assert.equal(t.children[0].expanded, true);
  assert.equal(t.children[0].children[0].expanded, false);
});
test("saved collapsed keys win; unknown keys open", () => {
  const md = "# A\n## B\n# C\n";
  const p = NM.parseNote(md);
  const t = NM.buildMindData(p, { title: "T", viewState: { collapsed: [NM.pathKey(p, "s0")] } }).nodeData;
  assert.equal(t.children[0].expanded, false); assert.equal(t.children[1].expanded, true);
});
test("pathKey disambiguates duplicate siblings", () => {
  const p = NM.parseNote("# A\n## X\n## X\n");
  assert.equal(NM.pathKey(p, "s1"), "A\u001fX"); assert.equal(NM.pathKey(p, "s2"), "A\u001fX#2");
});
test("performance: 2,000 lines / 200 headings under 150 ms", () => {
  const md = Array.from({ length: 200 }, (_, i) => `## H${i}\n` + "Kalimat isi bagian ini cukup panjang.\n".repeat(9)).join("");
  const t0 = performance.now(); build(md, "Besar"); assert.ok(performance.now() - t0 < 150);
});
test("empty collapsed array decides even for big notes; default is frozen", () => {
  const big = Array.from({ length: 11 }, (_, i) => `# A${i}\n## B${i}\n### C${i}\n`).join("");
  const t = build(big, "T", { collapsed: [] });
  assert.equal(t.children[0].children[0].expanded, true);
  assert.deepEqual(NM.LINKED_VIEW_STATE_DEFAULT, { linked: 1, direction: 2, justify: false, collapsed: [], summary: true });
  assert.ok(Object.isFrozen(NM.LINKED_VIEW_STATE_DEFAULT) && Object.isFrozen(NM.LINKED_VIEW_STATE_DEFAULT.collapsed));
  const p = NM.parseNote("# A\n# A\n## X\n");
  assert.equal(NM.pathKey(p, "s2"), "A#2\u001fX");
});
