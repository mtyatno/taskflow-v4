"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const M = require("../../static/offline/mindmapmerge.js");

const n = (id, topic, children = [], extra = {}) => Object.assign({ id, topic, children }, extra);
const doc = (children, extra = {}) => Object.assign({ nodeData: n("root", "Akar", children, { root: true }), direction: 2 }, extra);
const find = (node, id) => { if (node.id === id) return node; for (const c of node.children || []) { const f = find(c, id); if (f) return f; } return null; };
const kids = (d, id = "root") => find(d.nodeData, id).children.map((c) => c.id);
const clone = (x) => JSON.parse(JSON.stringify(x));

const B = doc([n("a", "A"), n("b", "B", [n("b1", "B1")]), n("c", "C")]);

test("echo of own write: merge3(B, L, L) = L without conflicts", () => {
  const L = clone(B); find(L.nodeData, "a").topic = "A2";
  const r = M.merge3(B, L, clone(L));
  assert.ok(M.stableEq(r.doc, L)); assert.deepEqual(r.conflicts, []); assert.equal(r.changed, false);
  assert.ok(M.stableEq(M.merge3(B, clone(B), L).doc, L));
  assert.ok(M.stableEq(M.merge3(B, L, clone(B)).doc, L));
});

test("edits to different nodes merge without conflicts", () => {
  const L = clone(B); find(L.nodeData, "a").topic = "A lokal";
  const S = clone(B); find(S.nodeData, "c").topic = "C server";
  const r = M.merge3(B, L, S);
  assert.equal(find(r.doc.nodeData, "a").topic, "A lokal");
  assert.equal(find(r.doc.nodeData, "c").topic, "C server");
  assert.deepEqual(r.conflicts, []); assert.equal(r.changed, true);
});

test("same field of the same node: server wins and the conflict is reported", () => {
  const L = clone(B); find(L.nodeData, "a").topic = "**A lokal**";
  const S = clone(B); find(S.nodeData, "a").topic = "A server";
  const r = M.merge3(B, L, S);
  assert.equal(find(r.doc.nodeData, "a").topic, "A server");
  assert.deepEqual(r.conflicts, [{ nodeId: "a", field: "topic", topic: "A lokal" }]);
});

test("adds on both sides under the same parent keep both, local first after the shared anchor", () => {
  const L = clone(B); L.nodeData.children.splice(1, 0, n("x", "X"));
  const S = clone(B); S.nodeData.children.splice(1, 0, n("y", "Y"));
  assert.deepEqual(kids(M.merge3(B, L, S).doc), ["a", "x", "y", "b", "c"]);
});

test("delete vs edit keeps the edited node (both directions)", () => {
  const L = clone(B); find(L.nodeData, "b").topic = "B lokal"; L.nodeData.children = L.nodeData.children.filter((c) => c.id !== "c");
  const S = clone(B); S.nodeData.children = S.nodeData.children.filter((c) => c.id !== "b"); find(S.nodeData, "c").topic = "C server";
  const r = M.merge3(B, L, S);
  assert.equal(find(r.doc.nodeData, "b").topic, "B lokal");
  assert.deepEqual(kids(r.doc, "b"), ["b1"]);
  assert.equal(find(r.doc.nodeData, "c").topic, "C server");
  assert.deepEqual(r.conflicts, []);
});

test("untouched subtree deleted on one side is deleted", () => {
  const S = clone(B); S.nodeData.children = S.nodeData.children.filter((c) => c.id !== "b");
  const r = M.merge3(B, clone(B), S);
  assert.equal(find(r.doc.nodeData, "b"), null); assert.equal(find(r.doc.nodeData, "b1"), null);
});

test("child added under a node deleted on the other side resurrects the parent", () => {
  const L = clone(B); find(L.nodeData, "b").children.push(n("z", "Z"));
  const S = clone(B); S.nodeData.children = S.nodeData.children.filter((c) => c.id !== "b");
  const r = M.merge3(B, L, S);
  assert.deepEqual(kids(r.doc, "b"), ["b1", "z"]);
});

test("move vs edit; move vs move → server parent; cycle resolved to server structure", () => {
  const L = clone(B); const a = L.nodeData.children.shift(); find(L.nodeData, "b").children.push(a);
  const S = clone(B); find(S.nodeData, "a").topic = "A server";
  const r = M.merge3(B, L, S);
  assert.deepEqual(kids(r.doc, "b"), ["b1", "a"]); assert.equal(find(r.doc.nodeData, "a").topic, "A server");

  const S2 = clone(B); const a2 = S2.nodeData.children.shift(); find(S2.nodeData, "c").children.push(a2);
  const r2 = M.merge3(B, L, S2);
  assert.deepEqual(kids(r2.doc, "c"), ["a"]); assert.deepEqual(r2.conflicts, []);

  const Lc = clone(B); const bL = Lc.nodeData.children.splice(1, 1)[0]; find(Lc.nodeData, "a").children.push(bL);   // b → a
  const Sc = clone(B); const aS = Sc.nodeData.children.shift(); find(Sc.nodeData, "b").children.push(aS);          // a → b
  const rc = M.merge3(B, Lc, Sc);
  assert.ok(kids(rc.doc).includes("b")); assert.deepEqual(kids(rc.doc, "b"), ["b1", "a"]);
});

test("local-only reorder is kept while server edits a topic", () => {
  const L = clone(B); L.nodeData.children = [L.nodeData.children[2], L.nodeData.children[0], L.nodeData.children[1]];
  const S = clone(B); find(S.nodeData, "b").topic = "B server";
  const r = M.merge3(B, L, S);
  assert.deepEqual(kids(r.doc), ["c", "a", "b"]); assert.equal(find(r.doc.nodeData, "b").topic, "B server");
});

test("links merge as a set; expanded conflict → server without conflict", () => {
  const Bl = doc([n("a", "A", [], { links: [{ type: "task", id: 1, title: "T1" }], expanded: true })]);
  const L = clone(Bl); find(L.nodeData, "a").links.push({ type: "note", id: 2, title: "N2" }); find(L.nodeData, "a").expanded = false;
  const S = clone(Bl); find(S.nodeData, "a").links = []; find(S.nodeData, "a").expanded = true;
  const r = M.merge3(Bl, L, S);
  assert.deepEqual(find(r.doc.nodeData, "a").links.map((l) => l.type + ":" + l.id), ["note:2"]);
  assert.equal(find(r.doc.nodeData, "a").expanded, false);
  assert.deepEqual(r.conflicts, []);
});

test("arrows to deleted nodes dropped; summaries clamped; top-level keys merged", () => {
  const L = clone(B); L.arrows = [{ id: "ar1", from: "a", to: "c", label: "x" }]; L.summaries = [{ id: "s1", parent: "root", start: 0, end: 2, label: "S" }]; L.direction = 0;
  const S = clone(B); S.nodeData.children = S.nodeData.children.filter((c) => c.id !== "c"); S.justify = true;
  const r = M.merge3(B, L, S);
  assert.deepEqual(r.doc.arrows, []);
  assert.deepEqual(r.doc.summaries, [{ id: "s1", parent: "root", start: 0, end: 1, label: "S" }]);
  assert.equal(r.doc.direction, 0); assert.equal(r.doc.justify, true);
});

test("fallback on missing nodeData, duplicate ids or different roots", () => {
  assert.deepEqual(M.merge3(B, B, { v: 1 }), { fallback: true });
  assert.deepEqual(M.merge3(B, doc([n("a", "A"), n("a", "A")]), B), { fallback: true });
  assert.deepEqual(M.merge3(B, B, { nodeData: n("other", "X", [], { root: true }) }), { fallback: true });
});

test("merge3Scalar", () => {
  assert.deepEqual(M.merge3Scalar("t", "l", "t"), { value: "l", conflict: false });
  assert.deepEqual(M.merge3Scalar("t", "t", "s"), { value: "s", conflict: false });
  assert.deepEqual(M.merge3Scalar("t", "l", "s"), { value: "s", conflict: true });
});

// ---------------------------------------------------------------------------------------------
// Tambahan di luar brief: sifat-sifat keamanan data.

test("stableEq ignores key order; leaf nodes without children compare equal after merge", () => {
  assert.ok(M.stableEq({ a: 1, b: { c: 2, d: [1, { e: 3, f: 4 }] } }, { b: { d: [1, { f: 4, e: 3 }], c: 2 }, a: 1 }));
  assert.ok(!M.stableEq([1, 2], [2, 1]));
  const Bn = { nodeData: { id: "root", topic: "R", root: true, children: [{ id: "a", topic: "A" }] } };
  const r = M.merge3(Bn, clone(Bn), clone(Bn));
  assert.equal(r.changed, false);
  assert.deepEqual(find(r.doc.nodeData, "a").children, []);
});

test("does not mutate its inputs and is deterministic", () => {
  const L = clone(B); find(L.nodeData, "a").topic = "A L"; L.nodeData.children.push(n("x", "X"));
  const S = clone(B); find(S.nodeData, "a").topic = "A S"; S.nodeData.children = S.nodeData.children.filter((c) => c.id !== "b");
  const snap = [clone(B), clone(L), clone(S)];
  const r1 = M.merge3(B, L, S); const r2 = M.merge3(B, L, S);
  assert.deepEqual([B, L, S], snap);
  assert.deepEqual(r1, r2);
});

test("non-array children on any side → fallback (never a mass delete)", () => {
  const bad = { nodeData: { id: "root", children: "zz" } };
  assert.deepEqual(M.merge3(B, bad, B), { fallback: true });
  assert.deepEqual(M.merge3(B, B, bad), { fallback: true });
  assert.deepEqual(M.merge3(bad, B, B), { fallback: true });
  const deep = clone(B); find(deep.nodeData, "b").children = { 0: n("b1", "B1") };
  assert.deepEqual(M.merge3(B, deep, B), { fallback: true });
  assert.deepEqual(M.merge3(B, B, deep), { fallback: true });
  const nul = clone(B); find(nul.nodeData, "a").children = null;   // null = tanpa anak, tetap sah
  assert.ok(!M.merge3(B, nul, B).fallback);
});

test("result is a deep copy: mutating it never touches base/local/server", () => {
  const Bx = doc([n("a", "A", [], { links: [{ type: "task", id: 1 }], style: { color: "red" } })], { theme: { name: "t", palette: ["#000"] }, arrows: [{ id: "ar", from: "a", to: "a" }] });
  const L = clone(Bx); find(L.nodeData, "a").topic = "A L";
  const S = clone(Bx); S.nodeData.children.push(n("y", "Y"));
  const snap = [clone(Bx), clone(L), clone(S)];
  for (const r of [M.merge3(Bx, L, S), M.merge3(Bx, L, L), M.merge3(Bx, Bx, S)]) {
    const a = find(r.doc.nodeData, "a");
    a.links.push({ type: "note", id: 9 }); a.links[0].id = 99; a.style.color = "blue"; a.topic = "X";
    r.doc.theme.palette.push("#fff"); r.doc.theme.name = "z"; r.doc.arrows[0].from = "q"; r.doc.nodeData.children.length = 0;
  }
  assert.deepEqual([Bx, L, S], snap);
});

// Randomized property test (seeded PRNG): random base, random independent edits on two sides.
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function allNodes(d) {
  const out = []; const stack = [{ node: d.nodeData, parent: null }];
  while (stack.length) {
    const { node, parent } = stack.pop(); out.push({ node, parent });
    const ch = node.children || [];
    for (let i = ch.length - 1; i >= 0; i--) stack.push({ node: ch[i], parent: node.id });
  }
  return out;
}
const isDesc = (node, id) => !!find(node, id);

function randomBase(rnd) {
  let next = 0;
  const root = n("root", "Akar", [], { root: true });
  const pool = [root];
  const count = 1 + Math.floor(rnd() * 14);
  for (let i = 0; i < count; i++) {
    const p = pool[Math.floor(rnd() * pool.length)];
    const extra = {};
    if (rnd() < 0.3) extra.links = [{ type: "task", id: Math.floor(rnd() * 4), title: "T" }];
    if (rnd() < 0.3) extra.expanded = rnd() < 0.5;
    const c = n("n" + next++, "Topik " + i, [], extra);
    p.children.push(c); pool.push(c);
  }
  return { nodeData: root, direction: 2 };
}

function randomEdits(base, rnd, side) {
  const d = clone(base); let next = 0;
  const ops = Math.floor(rnd() * 5);
  for (let k = 0; k < ops; k++) {
    const nodes = allNodes(d);
    const pick = () => nodes[Math.floor(rnd() * nodes.length)];
    const r = rnd();
    if (r < 0.25) { pick().node.topic = side + " topik " + k; }
    else if (r < 0.45) { pick().node.children.push(n(side + "new" + next++, side + " baru")); }
    else if (r < 0.6) {
      const { node, parent } = pick();
      if (parent) { const p = find(d.nodeData, parent); p.children = p.children.filter((c) => c.id !== node.id); }
    } else if (r < 0.72) {
      const { node, parent } = pick(); const target = pick().node;
      if (parent && !isDesc(node, target.id)) {
        const p = find(d.nodeData, parent); p.children = p.children.filter((c) => c.id !== node.id);
        target.children.splice(Math.floor(rnd() * (target.children.length + 1)), 0, node);
      }
    } else if (r < 0.82) { const p = pick().node; p.children.reverse(); }
    else if (r < 0.9) { const x = pick().node; x.expanded = !x.expanded; }
    else { const x = pick().node; x.links = (x.links || []).concat([{ type: "note", id: side + k, title: "N" }]); }
  }
  return d;
}

function nodeInfo(d) {
  const m = new Map();
  for (const { node, parent } of allNodes(d)) {
    const f = Object.assign({}, node); delete f.children;
    m.set(node.id, { fields: f, parent });
  }
  return m;
}

test("property: merge never drops edited/added nodes and never duplicates ids (400 seeded cases)", () => {
  for (let seed = 1; seed <= 400; seed++) {
    const rnd = mulberry32(seed);
    const Bd = randomBase(rnd);
    const L = randomEdits(Bd, rnd, "L");
    const S = randomEdits(Bd, rnd, "S");
    const r = M.merge3(Bd, L, S);
    assert.ok(!r.fallback, "seed " + seed + ": unexpected fallback");

    const out = allNodes(r.doc);
    const ids = out.map((x) => x.node.id);
    assert.equal(new Set(ids).size, ids.length, "seed " + seed + ": duplicated node id");
    assert.equal(r.doc.nodeData.id, "root");
    for (const { node } of out) assert.ok(Array.isArray(node.children), "seed " + seed + ": children array");

    const res = nodeInfo(r.doc); const bi = nodeInfo(Bd);
    const lAll = nodeInfo(L), sAll = nodeInfo(S);
    for (const id of res.keys()) assert.ok(lAll.has(id) || sAll.has(id), `seed ${seed}: node ${id} invented`);
    for (const id of lAll.keys()) if (sAll.has(id)) assert.ok(res.has(id), `seed ${seed}: node ${id} present on both sides was dropped`);
    // A node kept but deleted on one side keeps its whole subtree from the side that kept it.
    for (const [X, other] of [[L, sAll], [S, lAll]]) {
      for (const { node } of allNodes(X)) {
        if (res.has(node.id) && !other.has(node.id) && bi.has(node.id)) {
          for (const { node: d } of allNodes({ nodeData: node })) assert.ok(res.has(d.id), `seed ${seed}: subtree of resurrected ${node.id} lost ${d.id}`);
        }
      }
    }
    for (const [sideName, sd, other] of [["L", L, S], ["S", S, L]]) {
      const si = nodeInfo(sd); const oi = nodeInfo(other);
      for (const [id, info] of si) {
        const b = bi.get(id);
        const edited = !b || !M.stableEq(info.fields, b.fields) || info.parent !== b.parent;
        if (!edited) continue;
        assert.ok(res.has(id), `seed ${seed}: node ${id} edited/added on ${sideName} was dropped`);
        // Topic edited only on this side (other side untouched or deleted) → this side's topic wins.
        const o = oi.get(id);
        const topicChanged = !b || info.fields.topic !== b.fields.topic;
        const otherChanged = o && b && o.fields.topic !== b.fields.topic;
        if (topicChanged && !otherChanged) {
          assert.equal(res.get(id).fields.topic, info.fields.topic, `seed ${seed}: topic of ${id} from ${sideName} lost`);
        }
        // Links added on this side survive.
        const bLinks = new Set(((b && b.fields.links) || []).map((l) => l.type + ":" + l.id));
        for (const l of info.fields.links || []) {
          if (bLinks.has(l.type + ":" + l.id)) continue;
          const got = (res.get(id).fields.links || []).map((x) => x.type + ":" + x.id);
          assert.ok(got.includes(l.type + ":" + l.id), `seed ${seed}: link ${l.type}:${l.id} on ${id} lost`);
        }
      }
    }
    // Every reported conflict really was a two-sided change, and topic fields all lived in both sides.
    for (const c of r.conflicts) {
      const li = nodeInfo(L).get(c.nodeId); const si = nodeInfo(S).get(c.nodeId);
      assert.ok(li && si, `seed ${seed}: conflict on a node missing from a side`);
    }
    // Basic algebra on the same random inputs.
    assert.ok(M.stableEq(M.merge3(Bd, L, clone(L)).doc, L), `seed ${seed}: echo merge3(B,L,L) != L`);
    assert.ok(M.stableEq(M.merge3(Bd, clone(Bd), S).doc, S), `seed ${seed}: merge3(B,B,S) != S`);
    assert.ok(M.stableEq(M.merge3(Bd, L, clone(Bd)).doc, L), `seed ${seed}: merge3(B,L,B) != L`);
    assert.deepEqual(M.merge3(Bd, L, S), r, `seed ${seed}: not deterministic`);
  }
});
