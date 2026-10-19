;(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory();
  } else {
    root.TF = root.TF || {};
    root.TF.mindmapmerge = factory();
  }
})(typeof self !== "undefined" ? self : globalThis, function () {
  "use strict";

  // Merge tiga arah per node untuk data mind-elixir (spec #4, "Algoritma merge3(B, L, S)").
  // Modul murni tanpa dependensi: tidak mengubah input, deterministik.
  // Prinsip: edit menang atas hapus — isi yang diubah di salah satu sisi tidak pernah hilang.

  // JSON stabil: urutan key objek diabaikan; key bernilai undefined = key tidak ada.
  function stableStr(v) {
    if (v === undefined) return "\u0000u";
    if (v === null || typeof v !== "object") {
      const s = JSON.stringify(v);
      return s === undefined ? "\u0000u" : s;
    }
    if (Array.isArray(v)) {
      return "[" + v.map((x) => (x === undefined ? "null" : stableStr(x))).join(",") + "]";
    }
    const keys = Object.keys(v).filter((k) => v[k] !== undefined && typeof v[k] !== "function").sort();
    return "{" + keys.map((k) => JSON.stringify(k) + ":" + stableStr(v[k])).join(",") + "}";
  }
  function stableEq(a, b) { return stableStr(a) === stableStr(b); }

  function merge3Scalar(b, l, s) {
    if (stableEq(l, s)) return { value: l, conflict: false };
    if (stableEq(l, b)) return { value: s, conflict: false };
    if (stableEq(s, b)) return { value: l, conflict: false };
    return { value: s, conflict: true };
  }

  function plainTopic(t) {
    if (t === undefined || t === null) return "";
    return String(t)
      .replace(/<[^>]*>/g, " ")
      .replace(/\*\*|__|~~|==|`/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  // id → {fields, parent, childIds}; pre-order list. null bila tidak valid (→ fallback).
  function indexDoc(d) {
    if (!d || typeof d !== "object" || !d.nodeData || typeof d.nodeData !== "object" || Array.isArray(d.nodeData)) return null;
    const map = new Map();
    const order = [];
    const stack = [{ node: d.nodeData, parent: null }];
    while (stack.length) {
      const { node, parent } = stack.pop();
      if (!node || typeof node !== "object" || node.id === undefined || node.id === null) return null;
      const id = String(node.id);
      if (map.has(id)) return null;
      const fields = {};
      for (const k of Object.keys(node)) if (k !== "children") fields[k] = node[k];
      if (node.children !== undefined && node.children !== null && !Array.isArray(node.children)) return null;
      const ch = Array.isArray(node.children) ? node.children : [];
      const childIds = [];
      for (const c of ch) {
        if (!c || typeof c !== "object" || c.id === undefined || c.id === null) return null;
        childIds.push(String(c.id));
      }
      map.set(id, { fields, parent, childIds });
      order.push(id);
      for (let i = ch.length - 1; i >= 0; i--) stack.push({ node: ch[i], parent: id });
    }
    return { map, order, rootId: String(d.nodeData.id) };
  }

  // "Disentuh" per sisi: field berubah, induk berubah, atau punya anak baru/disentuh (dihitung pasca-order).
  function touchedSet(X, Bx) {
    const t = new Set();
    for (let i = X.order.length - 1; i >= 0; i--) {
      const id = X.order[i];
      const x = X.map.get(id);
      const b = Bx.map.get(id);
      let touched = !b || !stableEq(x.fields, b.fields) || x.parent !== b.parent;
      if (!touched) {
        for (const c of x.childIds) { if (!Bx.map.has(c) || t.has(c)) { touched = true; break; } }
      }
      if (touched) t.add(id);
    }
    return t;
  }

  const linkKey = (l) => (l && typeof l === "object" ? String(l.type) + ":" + String(l.id) : stableStr(l));

  function mergeLinks(vB, vL, vS) {
    if (stableEq(vL, vS)) return vL;
    if (stableEq(vS, vB)) return vL;
    if (stableEq(vL, vB)) return vS;
    const okArr = (v) => v === undefined || Array.isArray(v);
    if (!okArr(vB) || !okArr(vL) || !okArr(vS)) return vS; // bentuk tak dikenal: server, tanpa konflik
    const bArr = vB || [], lArr = vL || [], sArr = vS || [];
    const bKeys = new Set(bArr.map(linkKey));
    const lKeys = new Set(lArr.map(linkKey));
    const removedByL = new Set([...bKeys].filter((k) => !lKeys.has(k)));
    const out = [];
    const seen = new Set();
    for (const l of sArr) {
      const k = linkKey(l);
      if (removedByL.has(k) || seen.has(k)) continue;
      seen.add(k); out.push(l);
    }
    for (const l of lArr) {
      const k = linkKey(l);
      if (bKeys.has(k) || seen.has(k)) continue;
      seen.add(k); out.push(l);
    }
    return out;
  }

  function mergeFields(id, bF, lF, sF, conflicts) {
    const out = {};
    const keys = [];
    const seen = new Set();
    for (const f of [sF, lF, bF]) for (const k of Object.keys(f)) if (!seen.has(k)) { seen.add(k); keys.push(k); }
    for (const k of keys) {
      const vB = bF[k], vL = lF[k], vS = sF[k];
      let v;
      if (k === "links") {
        v = mergeLinks(vB, vL, vS);
      } else {
        const r = merge3Scalar(vB, vL, vS);
        v = r.value;
        if (r.conflict && k !== "expanded") conflicts.push({ nodeId: id, field: k, topic: plainTopic(lF.topic) });
      }
      if (v !== undefined) out[k] = v;
    }
    return out;
  }

  // arrows / summaries: gabung per id dengan 3-way objek utuh. Tidak pernah konflik.
  function mergeById(vB, vL, vS) {
    if (stableEq(vS, vB)) return vL;
    if (stableEq(vL, vB) || stableEq(vL, vS)) return vS;
    const arrOk = (v) => v === undefined || (Array.isArray(v) && v.every((x) => x && typeof x === "object" && x.id !== undefined && x.id !== null));
    if (!arrOk(vB) || !arrOk(vL) || !arrOk(vS)) return merge3Scalar(vB, vL, vS).value;
    const toMap = (a) => { const m = new Map(); for (const x of a || []) if (!m.has(String(x.id))) m.set(String(x.id), x); return m; };
    const mB = toMap(vB), mL = toMap(vL), mS = toMap(vS);
    const ids = [];
    const seen = new Set();
    for (const a of [vS || [], vL || []]) for (const x of a) { const k = String(x.id); if (!seen.has(k)) { seen.add(k); ids.push(k); } }
    const out = [];
    for (const k of ids) {
      const b = mB.get(k), l = mL.get(k), s = mS.get(k);
      if (l && s) out.push(merge3Scalar(b, l, s).value);
      else if (l) { if (!b || !stableEq(l, b)) out.push(l); }
      else if (s) { if (!b || !stableEq(s, b)) out.push(s); }
    }
    return out;
  }

  function merge3(base, local, server) {
    const FALLBACK = { fallback: true };
    const IB = indexDoc(base), IL = indexDoc(local), IS = indexDoc(server);
    if (!IB || !IL || !IS) return FALLBACK;
    if (IB.rootId !== IL.rootId || IB.rootId !== IS.rootId) return FALLBACK;
    const rootId = IS.rootId;
    const inB = (id) => IB.map.has(id), inL = (id) => IL.map.has(id), inS = (id) => IS.map.has(id);

    // 1–2. Bertahan / hapus.
    const tL = touchedSet(IL, IB), tS = touchedSet(IS, IB);
    const union = [];
    {
      const seen = new Set();
      for (const I of [IS, IL, IB]) for (const id of I.order) if (!seen.has(id)) { seen.add(id); union.push(id); }
    }
    const keep = new Set();
    // Sumber field untuk node yang hanya hidup di satu sisi (dihidupkan bersama subtree).
    const carryL = [], carryS = [];
    for (const id of union) {
      if (id === rootId) { keep.add(id); continue; }
      const l = inL(id), s = inS(id);
      if (l && s) keep.add(id);
      else if (!inB(id)) keep.add(id);
      else if (l && !s) { if (tL.has(id)) { keep.add(id); carryL.push(id); } }
      else if (s && !l) { if (tS.has(id)) { keep.add(id); carryS.push(id); } }
    }
    const carrySubtree = (I, ids) => {
      const stack = ids.slice();
      while (stack.length) {
        const id = stack.pop();
        for (const c of I.map.get(id).childIds) { if (!keep.has(c)) keep.add(c); stack.push(c); }
      }
    };
    carrySubtree(IL, carryL);
    carrySubtree(IS, carryS);

    // 3. Induk.
    const rawParent = (id) => {
      const l = IL.map.get(id), s = IS.map.get(id), b = IB.map.get(id);
      if (l && s) {
        const pL = l.parent, pS = s.parent, pB = b ? b.parent : undefined;
        if (pL === pS) return pL;
        if (b && pL === pB) return pS;
        if (b && pS === pB) return pL;
        return pS;
      }
      if (l) return l.parent;
      if (s) return s.parent;
      return b ? b.parent : null;
    };
    const parent = new Map();
    const processOrder = [];
    {
      const seen = new Set();
      for (const id of IS.order.concat(IL.order)) if (keep.has(id) && !seen.has(id)) { seen.add(id); processOrder.push(id); }
    }
    const pending = processOrder.slice();
    while (pending.length) {
      const id = pending.shift();
      if (id === rootId || parent.has(id)) continue;
      let p = rawParent(id);
      if (p === null || p === undefined) p = rootId;
      parent.set(id, p);
      // Induk hasil yang terhapus → dihidupkan kembali (rantai ke atas).
      if (!keep.has(p)) { keep.add(p); processOrder.push(p); pending.push(p); }
    }

    // Siklus → pakai pS, lalu pB, lalu root (diproses dalam urutan pre-order S lalu L).
    const reaches = (start, target) => {
      const seen = new Set();
      let cur = start;
      while (cur !== undefined && cur !== null && cur !== rootId) {
        if (cur === target) return true;
        if (seen.has(cur)) return false;
        seen.add(cur);
        cur = parent.get(cur);
      }
      return cur === target;
    };
    for (const id of processOrder) {
      if (id === rootId) continue;
      if (!reaches(parent.get(id), id)) continue;
      const s = IS.map.get(id), b = IB.map.get(id);
      const cands = [s && s.parent, b && b.parent, rootId];
      for (const c of cands) {
        if (c === undefined || c === null || !keep.has(c) || c === id) continue;
        if (c !== rootId && reaches(c, id)) continue;
        parent.set(id, c);
        break;
      }
    }

    // 4. Field.
    const conflicts = [];
    const fieldsOf = (id) => {
      const l = IL.map.get(id), s = IS.map.get(id), b = IB.map.get(id);
      if (l && s) return mergeFields(id, b ? b.fields : {}, l.fields, s.fields, conflicts);
      if (s) return Object.assign({}, s.fields);
      if (l) return Object.assign({}, l.fields);
      return Object.assign({}, b.fields);
    };

    // 5. Urutan anak.
    const kidsOf = new Map();
    for (const id of processOrder) {
      if (id === rootId) continue;
      const p = parent.get(id);
      if (!kidsOf.has(p)) kidsOf.set(p, []);
      kidsOf.get(p).push(id);
    }
    const childList = (I, p) => { const x = I.map.get(p); return x ? x.childIds : null; };
    const orderChildren = (p) => {
      const kids = kidsOf.get(p) || [];
      if (!kids.length) return [];
      const kidSet = new Set(kids);
      const cS = childList(IS, p), cL = childList(IL, p), cB = childList(IB, p) || [];
      let baseSide;
      if (!cL) baseSide = "S";
      else if (!cS) baseSide = "L";
      else {
        const bSet = new Set(cB), sSet = new Set(cS);
        const sRel = cS.filter((x) => bSet.has(x));
        const bRel = cB.filter((x) => sSet.has(x));
        baseSide = stableEq(sRel, bRel) ? "L" : "S";
      }
      const lists = { S: cS, L: cL, B: cB };
      const result = lists[baseSide].filter((x) => kidSet.has(x));
      const placed = new Set(result);
      const rest = kids.filter((x) => !placed.has(x));
      if (!rest.length) return result;
      const restSet = new Set(rest);
      const sides = baseSide === "L" ? ["S", "B"] : ["L", "B"];
      const originOf = new Map();
      for (const id of rest) {
        for (const side of sides) {
          const lst = lists[side];
          if (lst && lst.indexOf(id) >= 0) { originOf.set(id, side); break; }
        }
      }
      for (const side of sides) {
        const lst = lists[side];
        if (!lst) continue;
        const lstSet = new Set(lst);
        for (let i = 0; i < lst.length; i++) {
          const id = lst[i];
          if (!restSet.has(id) || placed.has(id) || originOf.get(id) !== side) continue;
          let pos;
          if (i === 0) pos = 0;
          else {
            pos = -1;
            for (let j = i - 1; j >= 0; j--) {
              const k = result.indexOf(lst[j]);
              if (k >= 0) { pos = k + 1; break; }
            }
          }
          if (pos < 0) { result.push(id); placed.add(id); continue; }
          while (pos < result.length && !lstSet.has(result[pos])) pos++;
          result.splice(pos, 0, id);
          placed.add(id);
        }
      }
      for (const id of rest) if (!placed.has(id)) { result.push(id); placed.add(id); }
      return result;
    };

    // 9. Bangun ulang dari root (pre-order, field digabung dalam urutan ini → konflik deterministik).
    const built = new Map();
    const finalKids = new Map();
    const stack = [rootId];
    const reachable = new Set();
    while (stack.length) {
      const id = stack.pop();
      if (reachable.has(id)) continue;
      reachable.add(id);
      const fields = fieldsOf(id);
      const ch = orderChildren(id);
      finalKids.set(id, ch);
      built.set(id, fields);
      for (let i = ch.length - 1; i >= 0; i--) stack.push(ch[i]);
    }
    const nodeOf = (id) => {
      const objs = new Map();
      const order = [];
      const st = [id];
      while (st.length) { const x = st.pop(); order.push(x); for (const c of finalKids.get(x)) st.push(c); }
      for (let i = order.length - 1; i >= 0; i--) {
        const x = order[i];
        objs.set(x, Object.assign({}, built.get(x), { children: finalKids.get(x).map((c) => objs.get(c)) }));
      }
      return objs.get(id);
    };
    const nodeData = nodeOf(rootId);

    // 6. arrows / summaries.
    const doc = {};
    const bD = base, lD = local, sD = server;
    const topKeys = [];
    {
      const seen = new Set();
      for (const d of [sD, lD, bD]) for (const k of Object.keys(d)) if (!seen.has(k)) { seen.add(k); topKeys.push(k); }
    }
    for (const k of topKeys) {
      if (k === "nodeData") { doc.nodeData = nodeData; continue; }
      let v;
      if (k === "arrows") {
        v = mergeById(bD.arrows, lD.arrows, sD.arrows);
        if (Array.isArray(v)) v = v.filter((a) => !(a && typeof a === "object") || ((a.from === undefined || reachable.has(String(a.from))) && (a.to === undefined || reachable.has(String(a.to)))));
      } else if (k === "summaries") {
        v = mergeById(bD.summaries, lD.summaries, sD.summaries);
        if (Array.isArray(v)) {
          const out = [];
          for (const s of v) {
            if (!s || typeof s !== "object") { out.push(s); continue; }
            const p = String(s.parent);
            if (!reachable.has(p)) continue;
            const cnt = finalKids.get(p).length;
            if (typeof s.start === "number" && typeof s.end === "number") {
              const end = Math.min(s.end, cnt - 1);
              if (s.start > end || s.start >= cnt) continue;
              out.push(end === s.end ? s : Object.assign({}, s, { end }));
            } else out.push(s);
          }
          v = out;
        }
      } else {
        // 7. Key tingkat atas lain: 3-way skalar, beda di kedua sisi → S tanpa konflik.
        v = merge3Scalar(bD[k], lD[k], sD[k]).value;
      }
      if (v !== undefined) doc[k] = v;
    }

    // changed dibandingkan dengan S yang dinormalkan (setiap node punya children).
    const sNorm = normalize(sD, IS);
    // Salinan dalam: pemanggil boleh mengubah hasil tanpa menyentuh base/local/server.
    const out = JSON.parse(JSON.stringify(doc));
    return { doc: out, conflicts, changed: !stableEq(out, sNorm) };
  }

  function normalize(d, I) {
    const objs = new Map();
    for (let i = I.order.length - 1; i >= 0; i--) {
      const id = I.order[i];
      const x = I.map.get(id);
      objs.set(id, Object.assign({}, x.fields, { children: x.childIds.map((c) => objs.get(c)) }));
    }
    return Object.assign({}, d, { nodeData: objs.get(I.rootId) });
  }

  return { merge3, merge3Scalar, stableEq, plainTopic, _indexDoc: indexDoc };
});
