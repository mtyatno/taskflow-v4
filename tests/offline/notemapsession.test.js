"use strict";
// Petakan C6: sesi peta tertaut (TF.notemapsession) — rencana tulis, undo/redo, remap sid, view-state.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const NM = require("../../static/offline/notemap.js");
const NS = require("../../static/offline/notemapsession.js");

const treeOf = (s, title = "T") => JSON.parse(JSON.stringify(NM.buildMindData(s.parsed, { title }).nodeData));

test("planWrite: noop, write, overflow, unsafe", () => {
  const s = NS.createSession({ noteCid: "n1", baseContent: "# A\nisi\n# B\n", title: "T" });
  const tree = () => JSON.parse(JSON.stringify(NM.buildMindData(s.parsed, { title: "T" }).nodeData));
  assert.deepEqual(NS.planWrite(s, tree()), { kind: "noop" });
  const t = tree(); t.children[1].topic = "B2";
  const w = NS.planWrite(s, t); assert.equal(w.kind, "write"); assert.equal(w.next.markdown, "# A\nisi\n# B2\n");
  const u = NS.createSession({ noteCid: "n1", baseContent: "# A\nisi\n# B\n```\nbuka\n", title: "T" });
  const ut = JSON.parse(JSON.stringify(NM.buildMindData(u.parsed, { title: "T" }).nodeData)); ut.children.reverse();
  assert.equal(NS.planWrite(u, ut).kind, "unsafe");
});

test("planWrite: overflow when a node would exceed heading level 6", () => {
  const s = NS.createSession({ noteCid: "n1", baseContent: "# A\n## B\n### C\n#### D\n##### E\n###### F\n", title: "T" });
  const t = treeOf(s);
  let deepest = t.children[0];
  while (deepest.children.length) deepest = deepest.children[0];
  deepest.children.push({ id: "x", topic: "G", children: [] });
  assert.deepEqual(NS.planWrite(s, t), { kind: "overflow" });
});

test("planWrite: unsafe reason unclosed vs structure (R16)", () => {
  const u = NS.createSession({ noteCid: "n1", baseContent: "# A\nisi\n# B\n```\nbuka\n", title: "T" });
  const ut = treeOf(u); ut.children.reverse();
  assert.deepEqual(NS.planWrite(u, ut), { kind: "unsafe", reason: "unclosed" });
  const s = NS.createSession({ noteCid: "n1", baseContent: "## A\nx\n# B\ny\n", title: "T" });
  const st = treeOf(s); st.children.reverse();
  assert.deepEqual(NS.planWrite(s, st), { kind: "unsafe", reason: "structure" });
});

test("planWrite: reload on stale parse / bad tree / throw (R17)", () => {
  const s = NS.createSession({ noteCid: "n1", baseContent: "# A\n", title: "T" });
  const stale = Object.assign({}, s, { parsed: NM.parseNote("# Lain\n") });
  assert.deepEqual(NS.planWrite(stale, treeOf(s)), { kind: "reload" });
  assert.deepEqual(NS.planWrite(s, { id: "root", topic: "T" }), { kind: "reload" });
  assert.deepEqual(NS.planWrite(s, null), { kind: "reload" });
});

test("planWrite: placeholder root keeps session title; root rename changes title; does not mutate input", () => {
  const s = NS.createSession({ noteCid: "n1", baseContent: "# A\n", title: "" });
  const t = JSON.parse(JSON.stringify(NM.buildMindData(s.parsed, { title: "" }).nodeData));
  assert.deepEqual(NS.planWrite(s, t), { kind: "noop" });
  const s2 = NS.createSession({ noteCid: "n1", baseContent: "# A\n", title: "Judul" });
  const t2 = treeOf(s2, "Judul"); t2.topic = "Baru";
  const before = JSON.stringify(t2);
  const w = NS.planWrite(s2, t2);
  assert.equal(w.kind, "write");
  assert.deepEqual(w.next, { markdown: "# A\n", title: "Baru" });
  assert.equal(JSON.stringify(t2), before, "pohon pemanggil tidak dianotasi nm.line/nm.body");
});

test("planWrite: removed section with content is reported", () => {
  const s = NS.createSession({ noteCid: "n1", baseContent: "# A\nisi\n# B\n", title: "T" });
  const t = treeOf(s); t.children.shift();
  const w = NS.planWrite(s, t);
  assert.equal(w.kind, "write");
  assert.equal(w.next.markdown, "# B\n");
  assert.deepEqual(w.removed, { count: 1, hasContent: true, firstTitle: "A" });
});

test("commitWrite + undo/redo with blocking", () => {
  let s = NS.createSession({ noteCid: "n1", baseContent: "# A\n", title: "T" });
  s = NS.commitWrite(s, { markdown: "# B\n", title: "T" });
  assert.deepEqual(NS.undoStep(s, "# B\n").next, { markdown: "# A\n", title: "T" });
  assert.deepEqual(NS.undoStep(s, "# diketik\n"), { blocked: true });
  for (let i = 0; i < 25; i++) s = NS.commitWrite(s, { markdown: `# ${i}\n`, title: "T" });
  assert.equal(s.undo.length, 20);
});

test("commitWrite updates base/title/parsed, clears redo, is immutable", () => {
  const s0 = NS.createSession({ noteCid: "n1", baseContent: "# A\n", title: "T" });
  const s1 = NS.commitWrite(s0, { markdown: "# B\n## C\n", title: "T2" });
  assert.equal(s0.baseContent, "# A\n");
  assert.equal(s0.undo.length, 0);
  assert.equal(s1.baseContent, "# B\n## C\n");
  assert.equal(s1.title, "T2");
  assert.deepEqual(s1.parsed.sections.map((x) => x.text), ["B", "C"]);
  assert.deepEqual(s1.undo, [{ before: { markdown: "# A\n", title: "T" }, after: { markdown: "# B\n## C\n", title: "T2" } }]);
  const withRedo = Object.assign({}, s1, { redo: [{ before: {}, after: {} }] });
  assert.equal(NS.commitWrite(withRedo, { markdown: "# D\n", title: "T2" }).redo.length, 0);
});

test("undoStep/redoStep round trip; session after the step moves the entry", () => {
  let s = NS.createSession({ noteCid: "n1", baseContent: "# A\n", title: "T" });
  s = NS.commitWrite(s, { markdown: "# B\n", title: "U" });
  const u = NS.undoStep(s, s.baseContent);
  assert.deepEqual(u.next, { markdown: "# A\n", title: "T" });
  assert.equal(u.session.baseContent, "# A\n");
  assert.equal(u.session.title, "T");
  assert.equal(u.session.undo.length, 0);
  assert.equal(u.session.redo.length, 1);
  assert.deepEqual(NS.redoStep(u.session, "# diubah\n"), { blocked: true });
  const r = NS.redoStep(u.session, "# A\n");
  assert.deepEqual(r.next, { markdown: "# B\n", title: "U" });
  assert.equal(r.session.undo.length, 1);
  assert.equal(r.session.redo.length, 0);
  assert.equal(r.session.baseContent, "# B\n");
});

test("undoStep/redoStep on empty history → empty", () => {
  const s = NS.createSession({ noteCid: "n1", baseContent: "# A\n", title: "T" });
  assert.deepEqual(NS.undoStep(s, "# A\n"), { empty: true });
  assert.deepEqual(NS.redoStep(s, "# A\n"), { empty: true });
});

test("rebase keeps history for the same note and rebuilds parsed", () => {
  let s = NS.createSession({ noteCid: "n1", baseContent: "# A\n", title: "T" });
  s = NS.commitWrite(s, { markdown: "# B\n", title: "T" });
  const r = NS.rebase(s, { baseContent: "# B\n# C\n", title: "T3" });
  assert.equal(r.undo.length, 1);
  assert.equal(r.baseContent, "# B\n# C\n");
  assert.equal(r.title, "T3");
  assert.equal(r.parsed.sections.length, 2);
  // isi catatan sekarang bukan `after` lagi → undo diblokir
  assert.deepEqual(NS.undoStep(r, r.baseContent), { blocked: true });
});

test("remapSids pre-order; viewStateFrom detects collapse change", () => {
  const s = NS.createSession({ noteCid: "n1", baseContent: "# A\n## B\n# C\n", title: "T" });
  const t = JSON.parse(JSON.stringify(NM.buildMindData(s.parsed, { title: "T" }).nodeData));
  assert.deepEqual(NS.remapSids(t).map((x) => x[1]), ["s0", "s1", "s2"]);
  t.children[0].expanded = false;
  const v = NS.viewStateFrom(t, s.parsed, { linked: 1, direction: 2, justify: false, collapsed: [], summary: true });
  assert.equal(v.changed, true); assert.deepEqual(v.viewState.collapsed, ["A"]);
});

test("remapSids pairs node ids with the new pre-order sids after a move", () => {
  const s = NS.createSession({ noteCid: "n1", baseContent: "# A\n## B\n# C\n", title: "T" });
  const t = treeOf(s); t.children.reverse(); // C, A(B)
  assert.deepEqual(NS.remapSids(t), [["s2", "s0"], ["s0", "s1"], ["s1", "s2"]]);
  assert.deepEqual(NS.remapSids({ id: "root", children: [] }), []);
});

test("viewStateFrom: direction/justify from data, summary from prev, unchanged → changed false", () => {
  const s = NS.createSession({ noteCid: "n1", baseContent: "# A\n## B\n# C\n", title: "T" });
  const prev = { linked: 1, direction: 2, justify: false, collapsed: [], summary: false };
  const same = NS.viewStateFrom(treeOf(s), s.parsed, prev);
  assert.equal(same.changed, false);
  assert.deepEqual(same.viewState, { linked: 1, direction: 2, justify: false, collapsed: [], summary: false });
  const data = { nodeData: treeOf(s), direction: 3, justify: true };
  data.nodeData.children[0].children[0].expanded = false;
  const v = NS.viewStateFrom(data, s.parsed, prev);
  assert.equal(v.changed, true);
  assert.deepEqual(v.viewState, { linked: 1, direction: 3, justify: true, collapsed: ["A\u001fB"], summary: false });
  // urutan collapsed tidak dianggap perubahan
  const two = treeOf(s); two.children[0].expanded = false; two.children[1].expanded = false;
  const v2 = NS.viewStateFrom(two, s.parsed, Object.assign({}, prev, { collapsed: ["C", "A"] }));
  assert.equal(v2.changed, false);
  // node baru (tanpa sid) tidak masuk collapsed; prev kosong → default
  const t3 = treeOf(s); t3.children.push({ id: "n", topic: "Baru", expanded: false, children: [] });
  const v3 = NS.viewStateFrom(t3, s.parsed, null);
  assert.deepEqual(v3.viewState, { linked: 1, direction: 2, justify: false, collapsed: [], summary: true });
  assert.equal(v3.changed, false);
});
