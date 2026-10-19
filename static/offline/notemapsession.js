;(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory(root);
  } else {
    root.TF = root.TF || {};
    root.TF.notemapsession = factory(root);
  }
})(typeof self !== "undefined" ? self : globalThis, function (root) {
  "use strict";

  // Sesi peta tertaut (Petakan): tab memegang isi catatan saat peta dibangun
  // (baseContent) beserta hasil urainya, dan riwayat undo/redo tulisan dari peta.
  // Murni: tanpa DOM/IndexedDB; penulisan ke catatan dilakukan pemanggil lewat
  // noterepo.applyMapEdit.

  const isNode = typeof module !== "undefined" && module.exports;
  // Dimuat malas: urutan skrip di halaman tidak dijamin saat modul didefinisikan.
  const NM = () => (isNode ? require("./notemap.js") : root.TF.notemap);

  const HISTORY_MAX = 20;
  const PROBE = "__nm_probe__";

  const kids = (n) => (n && Array.isArray(n.children) ? n.children : []);

  // Generasi sesi: sid node (nm.sid = "s"+indeks) POSISIONAL terhadap `parsed` sesi saat
  // pohon dibangun. Tiap muat ulang / rebase / tulisan menghasilkan gen baru; pohon dan
  // pesan iframe membawa gen-nya, jadi sid dari versi catatan lain bisa dikenali dan
  // tidak pernah dipetakan ke bagian yang salah. Acak (bukan penghitung): papan klip
  // bisa membawa node dari tab/jendela lain yang penghitungnya mulai dari nol juga.
  function newGen() {
    const c = root && root.crypto;
    if (c && typeof c.randomUUID === "function") return c.randomUUID();
    return Date.now().toString(36) + "-" + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  }

  function createSession(o) {
    const baseContent = String(o.baseContent == null ? "" : o.baseContent);
    return {
      noteCid: o.noteCid,
      baseContent,
      title: o.title == null ? "" : String(o.title),
      parsed: NM().parseNote(baseContent),
      gen: newGen(),
      undo: [],
      redo: [],
    };
  }

  // Salinan pohon dengan nm.ns = gen pada tiap node yang punya nm (asal sid-nya).
  function stampTree(nodeData, gen) {
    const walk = (n) => {
      if (!n || typeof n !== "object") return n;
      const out = Object.assign({}, n);
      if (n.nm && typeof n.nm === "object") out.nm = Object.assign({}, n.nm, { ns: gen });
      if (Array.isArray(n.children)) out.children = n.children.map(walk);
      return out;
    };
    return walk(JSON.parse(JSON.stringify(nodeData)));
  }

  // Sid yang bukan milik generasi sesi ini (tempel dari peta/sesi lain, salinan dari
  // generasi lama, node tanpa ns) dibuang → applyMindData menulisnya sebagai heading baru.
  function dropForeignSids(tree, gen) {
    const walk = (n) => {
      if (n && n.nm && typeof n.nm === "object" && n.nm.sid != null && n.nm.ns !== gen) delete n.nm.sid;
      kids(n).forEach(walk);
    };
    kids(tree).forEach(walk);
    return tree;
  }

  // Isi catatan berubah dari luar peta: bangun ulang dari isi terbaru, riwayat
  // tetap (undo/redo akan diblokir sendiri bila isinya bukan `after` lagi).
  function rebase(session, o) {
    return Object.assign(createSession({ noteCid: session.noteCid, baseContent: o.baseContent, title: o.title }), {
      undo: session.undo.slice(),
      redo: session.redo.slice(),
    });
  }

  // R16: blok kode / toggle yang tidak ditutup di catatan menelan heading uji.
  function unsafeReason(session) {
    const eol = session.parsed.eol;
    const sections = NM().parseNote(session.baseContent + eol + "# " + PROBE + eol).sections;
    const last = sections[sections.length - 1];
    return last && last.text === PROBE ? "structure" : "unclosed";
  }

  function planWrite(session, edited) {
    const nm = NM();
    // applyMindData menganotasi pohon (nm.line/nm.body) — bekerja pada salinan.
    let tree;
    let r;
    try {
      tree = dropForeignSids(JSON.parse(JSON.stringify(edited)), session.gen);
      r = nm.applyMindData(session.baseContent, session.parsed, tree);
    } catch (_) {
      return { kind: "reload" };
    }
    if (!r || !r.ok) return r && r.code === "LEVEL_OVERFLOW" ? { kind: "overflow" } : { kind: "reload" };
    // Root berisi placeholder "Tanpa judul" → judul "" → judul catatan tetap.
    const next = { markdown: r.markdown, title: r.title || session.title };
    if (next.markdown === session.baseContent && next.title === session.title) return { kind: "noop" };
    if (!nm.verifyStructure(next.markdown, tree)) return { kind: "unsafe", reason: unsafeReason(session) };
    return { kind: "write", next, removed: r.removed };
  }

  const pushCapped = (list, entry) => list.concat([entry]).slice(-HISTORY_MAX);

  function moved(session, next, undo, redo) {
    return Object.assign({}, session, {
      baseContent: next.markdown,
      title: next.title,
      parsed: NM().parseNote(next.markdown),
      gen: newGen(),
      undo,
      redo,
    });
  }

  function commitWrite(session, next) {
    const before = { markdown: session.baseContent, title: session.title };
    return moved(session, next, pushCapped(session.undo, { before, after: next }), []);
  }

  // { next, session } — `session` adalah sesi setelah langkah ini berhasil ditulis;
  // pemanggil memakainya hanya bila applyMapEdit sukses.
  function undoStep(session, currentContent) {
    const top = session.undo[session.undo.length - 1];
    if (!top) return { empty: true };
    if (top.after.markdown !== currentContent) return { blocked: true };
    return {
      next: top.before,
      session: moved(session, top.before, session.undo.slice(0, -1), pushCapped(session.redo, top)),
    };
  }

  function redoStep(session, currentContent) {
    const top = session.redo[session.redo.length - 1];
    if (!top) return { empty: true };
    if (top.before.markdown !== currentContent) return { blocked: true };
    return {
      next: top.after,
      session: moved(session, top.after, pushCapped(session.undo, top), session.redo.slice(0, -1)),
    };
  }

  // Setelah tulisan berhasil, node non-root (pre-order) = bagian s0, s1, … catatan baru.
  function remapSids(edited) {
    const pairs = [];
    const walk = (n) => kids(n).forEach((c) => {
      pairs.push([c.id, "s" + pairs.length]);
      walk(c);
    });
    walk(edited);
    return pairs;
  }

  function sameSet(a, b) {
    if (a.length !== b.length) return false;
    const s = new Set(a);
    return b.every((x) => s.has(x));
  }

  // edited: data kanvas ({ nodeData, direction, justify }) atau nodeData saja.
  function viewStateFrom(edited, parsed, prev) {
    const p = prev || NM().LINKED_VIEW_STATE_DEFAULT;
    const data = edited && edited.nodeData ? edited : { nodeData: edited };
    const known = new Set(parsed.sections.map((s) => s.sid));
    const collapsed = [];
    const walk = (n) => kids(n).forEach((c) => {
      const sid = c.nm ? c.nm.sid : null;
      if (c.expanded === false && sid != null && known.has(sid)) collapsed.push(NM().pathKey(parsed, sid));
      walk(c);
    });
    walk(data.nodeData);

    const viewState = {
      linked: 1,
      direction: typeof data.direction === "number" ? data.direction : typeof p.direction === "number" ? p.direction : 2,
      justify: typeof data.justify === "boolean" ? data.justify : Boolean(p.justify),
      collapsed,
      summary: p.summary !== false,
    };
    const prevCollapsed = Array.isArray(p.collapsed) ? p.collapsed : [];
    const foldChanged = !sameSet(collapsed, prevCollapsed);
    // R18: lipatan tersimpan baru dipakai buildMindData setelah pengguna menyimpan lipatan
    // (touched). Sebelum itu peta besar memakai aturan lipatan awal (> 30 node).
    if (foldChanged || p.touched) viewState.touched = 1;
    const changed = viewState.direction !== p.direction || viewState.justify !== Boolean(p.justify) ||
      viewState.summary !== (p.summary !== false) || foldChanged;
    return { viewState, changed };
  }

  return { createSession, rebase, stampTree, planWrite, commitWrite, undoStep, redoStep, remapSids, viewStateFrom };
});
