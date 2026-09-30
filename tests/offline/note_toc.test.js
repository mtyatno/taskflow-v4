"use strict";

// Floating ToC (📑) ala Medium — komponen reusable FloatingToc dipakai NotePanel (mode baca)
// dan NoteModal (mode edit, menggantikan kolom samping NoteToc 120px yang membelah layar HP).

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const cssPath = path.resolve(__dirname, "../../static/app.css");
const appCss = fs.readFileSync(cssPath, "utf8");
const swJs = fs.readFileSync(path.resolve(__dirname, "../../static/sw.js"), "utf8");

// Ambil sumber fungsi `(<params>) => { ... }`, `x => { ... }` atau `function name(<params>) { ... }`
// yang dimulai setelah `marker`. Scanner: hitung kurung, lewati isi string/template literal dan
// komentar // & /* */. (Turunan helper di block_handle.test.js + dukungan arrow tanpa kurung.)
function extractArrowFn(code, marker) {
  const at = code.indexOf(marker);
  if (at < 0) return null;
  const skip = (j) => {
    const c = code[j], n = code[j + 1];
    if (c === "/" && n === "/") { const e = code.indexOf("\n", j); return e < 0 ? code.length : e; }
    if (c === "/" && n === "*") { const e = code.indexOf("*/", j + 2); return e < 0 ? code.length : e + 1; }
    if (c === "'" || c === '"' || c === "`") {
      j++;
      while (j < code.length && code[j] !== c) { if (code[j] === "\\") j++; j++; }
      return j;
    }
    return -1;
  };
  const matchPair = (j, open, close) => {
    let depth = 0;
    for (; j < code.length; j++) {
      const k = skip(j);
      if (k >= 0) { j = k; continue; }
      const c = code[j];
      if (c === open) depth++;
      else if (c === close) { depth--; if (depth === 0) return j; }
    }
    return -1;
  };
  // Arrow satu parameter tanpa kurung (gaya hasil compile: `item => { ... }`)
  const bare = code.slice(at + marker.length).match(/^\s*([A-Za-z_$][\w$]*)\s*=>\s*\{/);
  if (bare) {
    const from = at + marker.length + bare[0].indexOf(bare[1]);
    const bodyEnd = matchPair(at + marker.length + bare[0].length - 1, "{", "}");
    return bodyEnd < 0 ? null : code.slice(from, bodyEnd + 1);
  }
  const start = code.indexOf("(", at + marker.length);
  const paramsEnd = matchPair(start, "(", ")");
  if (paramsEnd < 0) return null;
  const rest = code.slice(paramsEnd + 1).match(/^\s*(?:=>\s*)?\{/);
  if (!rest) return null;
  const i = paramsEnd + rest[0].length;
  const bodyEnd = matchPair(i, "{", "}");
  if (bodyEnd < 0) return null;
  return code.slice(start, bodyEnd + 1);
}

test("Floating ToC CSS — tombol melayang ala Medium", async (t) => {
  await t.test("anchor fixed tersedia (satu sumber kebenaran)", () => {
    assert.ok(appCss.includes(".floating-toc-anchor"), "harus ada selector .floating-toc-anchor");
    // Satu definisi base + satu override desktop (769px) = konsolidasi tunggal.
    // Gaya pill lama (inline-flex / radius 20px) yang terduplikasi harus benar-benar hilang.
    const count = (appCss.match(/\.floating-toc-trigger \{/g) || []).length;
    assert.strictEqual(count, 2, "blok .floating-toc-trigger harus tepat 2 (base + override desktop; duplikat lama dihapus)");
    const triggerBodies = [...appCss.matchAll(/\.floating-toc-trigger \{([^}]*)\}/g)].map(m => m[1]);
    assert.ok(triggerBodies.length >= 2 && triggerBodies.every(b => !/inline-flex|border-radius:\s*20px/.test(b)), "gaya pill lama (inline-flex / radius 20px) tidak boleh tersisa");
    // Scoped ke braces blok: floating-toc tidak boleh ada DI DALAM @media (max-width: 767px) mana pun.
    const mediaDup = /@media \(max-width: 767px\)\s*\{[^}]*\.floating-toc/.exec(appCss);
    assert.strictEqual(mediaDup, null, "tidak boleh ada floating-toc di dalam blok @media (max-width: 767px) lama");
  });

  await t.test("mobile: FAB 44px di atas FAB Buat Baru (bottom 92px + safe-area)", () => {
    assert.ok(appCss.includes("bottom: calc(92px + env(safe-area-inset-bottom, 0px))"), "anchor mobile di 92px + safe-area");
    const m = /\.floating-toc-trigger \{([^}]*)\}/.exec(appCss);
    assert.ok(m, "rule .floating-toc-trigger ada");
    const body = m[1];
    assert.ok(/width:\s*44px/.test(body), "mobile: width 44px");
    assert.ok(/height:\s*44px/.test(body), "mobile: height 44px");
    assert.ok(/border-radius:\s*50%/.test(body), "bentuk lingkaran");
  });

  await t.test("desktop (min-width 769): kanan-tengah, 40px, popover ke kiri", () => {
    // Greedy: ambil kejadian TERAKHIR di file — override di dalam @media (min-width: 769px).
    // Blok konsolidasi menutup file, jadi kejadian terakhir = rule media-scoped, bukan base mobile.
    const desktop = /@media \(min-width: 769px\)[\s\S]*\.floating-toc-anchor \{([^}]*)\}/.exec(appCss);
    assert.ok(desktop, "harus ada @media (min-width: 769px) dengan .floating-toc-anchor");
    assert.ok(/top:\s*50%/.test(desktop[1]), "top 50%");
    assert.ok(/transform:\s*translateY\(-50%\)/.test(desktop[1]), "translateY(-50%)");
    const popover = /@media \(min-width: 769px\)[\s\S]*\.floating-toc-popover \{([^}]*)\}/.exec(appCss);
    assert.ok(popover, "popover desktop override ada");
    assert.ok(/right:\s*calc\(100% \+ 8px\)/.test(popover[1]), "popover membuka ke kiri tombol");
    const trigDesktop = /@media \(min-width: 769px\)[\s\S]*\.floating-toc-trigger \{([^}]*)\}/.exec(appCss);
    assert.ok(trigDesktop && /width:\s*40px/.test(trigDesktop[1]), "desktop: 40px");
  });

  await t.test("mobile: popover membuka ke atas", () => {
    const m = /\.floating-toc-popover \{([^}]*)\}/.exec(appCss);
    assert.ok(m, "rule .floating-toc-popover ada");
    assert.ok(/position:\s*absolute/.test(m[1]), "popover absolute terhadap anchor fixed");
    assert.ok(/bottom:\s*calc\(100% \+ 8px\)/.test(m[1]), "buka ke atas dari FAB");
  });

  await t.test("item aktif ter-highlight dengan tint accent", () => {
    const m = /\.note-toc-item\.active \{([^}]*)\}/.exec(appCss);
    assert.ok(m, "rule .note-toc-item.active unscoped ada");
    assert.ok(/rgba\(168,197,0,0\.12\)/.test(m[1]), "background tint accent");
    assert.ok(/color:\s*var\(--accent\)/.test(m[1]), "teks accent");
  });

  await t.test("animasi popover opacity-only (tidak bentrok transform)", () => {
    assert.ok(appCss.includes("@keyframes toc-pop-in"), "keyframes toc-pop-in ada");
    const m = /\.floating-toc-popover \{([^}]*)\}/.exec(appCss);
    assert.ok(/animation:\s*toc-pop-in/.test(m[1]), "popover pakai toc-pop-in");
  });

  await t.test("ToC statis lama benar-benar hilang", () => {
    assert.strictEqual(appCss.includes(".note-toc-sticky"), false, ".note-toc-sticky tidak boleh ada");
  });

  await t.test("kolom samping mode edit lama (.note-toc-panel) hilang dari CSS", () => {
    assert.strictEqual(appCss.includes("note-toc-panel"), false, ".note-toc-panel tidak dipakai lagi — rule scrollbar-nya dihapus");
  });

  await t.test("varian modal (mode edit): desktop right 8px (tidak menempel teks editor), z-index tidak diubah", () => {
    // Blok @media (min-width: 769px) terakhir = override desktop Floating ToC; varian modal harus di dalamnya.
    const at = appCss.lastIndexOf("@media (min-width: 769px) {");
    assert.ok(at > -1, "blok desktop ada");
    let depth = 0, end = -1;
    for (let i = appCss.indexOf("{", at); i < appCss.length; i++) {
      if (appCss[i] === "{") depth++;
      else if (appCss[i] === "}" && --depth === 0) { end = i; break; }
    }
    const block = appCss.slice(at, end + 1);
    assert.ok(block.includes(".floating-toc-anchor {"), "blok ini memang override desktop Floating ToC");
    const m = /\.floating-toc-anchor\.floating-toc-anchor--modal \{([^}]*)\}/.exec(block);
    assert.ok(m, "rule .floating-toc-anchor.floating-toc-anchor--modal di dalam @media (min-width: 769px)");
    assert.match(m[1], /right:\s*8px/, "desktop: geser ke kanan (celah dari tepi teks editor)");
    assert.strictEqual(/z-index/.test(m[1]), false, "z-index tetap 45: anchor dirender di dalam root NoteModal (konteks tumpuk z 1000)");
    assert.ok(block.indexOf(".floating-toc-anchor.floating-toc-anchor--modal {") > block.indexOf(".floating-toc-anchor {"), "varian setelah override base desktop");
  });

  await t.test("base anchor z-index 45 (di bawah modal-overlay 50)", () => {
    // Match PERTAMA di file = rule base mobile (bukan override di @media min-width: 769px).
    const base = /\.floating-toc-anchor \{([^}]*)\}/.exec(appCss);
    assert.ok(base, "rule .floating-toc-anchor base ada");
    assert.ok(/z-index:\s*45/.test(base[1]), "base anchor z-index harus 45 (di bawah modal-overlay 50, di atas sidebar 40)");
  });
});

const indexPath = path.resolve(__dirname, "../../static/index.html");
const indexHtml = fs.readFileSync(indexPath, "utf8");

const floatingMatch = indexHtml.match(/^function FloatingToc\(\{[\s\S]*?^function /m);
const floatingCode = floatingMatch ? floatingMatch[0] : "";
const notePanelMatch = indexHtml.match(/function NotePanel\(\{[\s\S]*?^function /m);
const notePanelCode = notePanelMatch ? notePanelMatch[0] : "";
const noteModalMatch = indexHtml.match(/function NoteModal\(\{[\s\S]*?^function /m);
const noteModalCode = noteModalMatch ? noteModalMatch[0] : "";

// ── React tiruan minimal untuk merender FloatingToc di Node (hook berurutan, tanpa DOM) ──
function loadFloatingToc() {
  const src = extractArrowFn(indexHtml, "function FloatingToc");
  assert.ok(src, "sumber function FloatingToc harus bisa diekstrak");
  const slots = [];
  let cursor = 0;
  const effects = [];
  const listeners = {};
  const fakeDocument = {
    addEventListener: (type, fn) => { (listeners[type] = listeners[type] || new Set()).add(fn); },
    removeEventListener: (type, fn) => { if (listeners[type]) listeners[type].delete(fn); },
  };
  const React = {
    useState(init) {
      const i = cursor++;
      if (!(i in slots)) slots[i] = typeof init === "function" ? init() : init;
      return [slots[i], v => { slots[i] = typeof v === "function" ? v(slots[i]) : v; }];
    },
    useRef(init) {
      const i = cursor++;
      if (!(i in slots)) slots[i] = { current: init };
      return slots[i];
    },
    useEffect(fn, deps) {
      const i = cursor++;
      const prev = slots[i];
      const changed = !prev || !deps || deps.some((d, k) => !Object.is(d, prev.deps[k]));
      if (changed) effects.push(() => {
        if (prev && typeof prev.cleanup === "function") prev.cleanup();
        slots[i] = { deps, cleanup: fn() };
      });
      else effects.push(() => {});
    },
    createElement(type, props, ...children) {
      return { type, props: props || {}, children: children.flat(Infinity).filter(c => c !== false && c != null) };
    },
  };
  const FloatingToc = new Function("React", "document", "return function FloatingToc" + src)(React, fakeDocument);
  const render = props => {
    cursor = 0;
    effects.length = 0;
    const tree = FloatingToc(props);
    effects.splice(0).forEach(run => run());
    return tree;
  };
  return { render, listeners, slots };
}
const walk = (node, fn) => {
  if (!node || typeof node !== "object") return;
  fn(node);
  (node.children || []).forEach(c => walk(c, fn));
};
const findAll = (tree, pred) => { const out = []; walk(tree, n => { if (pred(n)) out.push(n); }); return out; };
const textOf = node => (node.children || []).map(c => (typeof c === "object" ? textOf(c) : String(c))).join("");
const hasClass = (n, cls) => typeof n.props.className === "string" && n.props.className.split(/\s+/).includes(cls);

test("FloatingToc — komponen reusable (level modul)", async (t) => {
  await t.test("didefinisikan di level modul dengan API { items, activeIdx, onJump, onOpen, className }", () => {
    assert.ok(floatingCode.length > 0, "function FloatingToc harus ada di level modul static/index.html");
    assert.match(floatingCode, /^function FloatingToc\(\{\s*items,\s*activeIdx,\s*onJump,\s*onOpen,\s*className\s*\}\)/);
  });

  await t.test("mengurus state open + ref + tutup saat pointerdown di luar", () => {
    assert.match(floatingCode, /const \[tocOpen, setTocOpen\] = React\.useState\(false\)/);
    assert.match(floatingCode, /const tocRef = React\.useRef\(null\)/);
    assert.match(floatingCode, /document\.addEventListener\("pointerdown", onDown\)/);
    assert.match(floatingCode, /document\.removeEventListener\("pointerdown", onDown\)/);
    assert.match(floatingCode, /!tocRef\.current\.contains\(e\.target\)/);
  });

  await t.test("markup: anchor fixed (tanpa inline relative), ikon 📑, popover hanya class", () => {
    assert.match(floatingCode, /ref: tocRef,\s*className: `floating-toc-anchor\$\{className \? " " \+ className : ""\}`/);
    assert.strictEqual(/ref: tocRef,\s*style: \{ position: "relative"/.test(floatingCode), false, "wrapper tidak boleh inline relative");
    assert.ok(floatingCode.includes('React.createElement("span", null, "📑")'), "ikon 📑 ada");
    assert.ok(floatingCode.includes('className: "floating-toc-popover"'), "popover hanya pakai class");
    assert.strictEqual(floatingCode.includes('top: "calc(100% + 6px)"'), false, "inline top popover lama harus hilang");
    assert.strictEqual(floatingCode.includes("zIndex: 200"), false, "inline zIndex 200 popover harus hilang");
    assert.strictEqual(floatingCode.includes("Isi ("), false, "label teks Isi (N) harus hilang");
    assert.strictEqual(floatingCode.includes('"▲" : "▼"'), false, "indikator panah harus hilang");
  });

  await t.test("item: template class active + indent level + klik → tutup lalu onJump", () => {
    assert.match(floatingCode, /className: `note-toc-item\$\{activeIdx === item\.idx \? " active" : ""\}`/);
    assert.match(floatingCode, /paddingLeft: 6 \+ \(item\.level - 1\) \* 10/);
    assert.match(floatingCode, /setTocOpen\(false\);\s*if \(onJump\) onJump\(item\);/);
    assert.ok(floatingCode.includes("`📑 DAFTAR ISI (${items.length})`"), "header 📑 DAFTAR ISI (N)");
  });

  await t.test("agnostik mode: tidak tahu cara lompat (tanpa note-h- / getElementById)", () => {
    assert.strictEqual(floatingCode.includes("note-h-"), false);
    assert.strictEqual(floatingCode.includes("getElementById"), false);
  });

  await t.test("fungsional: buka → onOpen + popover; klik item → tutup + onJump(item)", () => {
    const { render, listeners } = loadFloatingToc();
    const items = [
      { idx: 0, level: 1, text: "Bab Satu" },
      { idx: 1, level: 2, text: "Sub A" },
      { idx: 2, level: 3, text: "Detail" },
    ];
    const opened = [];
    const jumped = [];
    const props = { items, activeIdx: 1, onJump: it => jumped.push(it), onOpen: () => opened.push(1), className: "floating-toc-anchor--modal" };
    let tree = render(props);
    assert.equal(tree.type, "div");
    assert.ok(hasClass(tree, "floating-toc-anchor") && hasClass(tree, "floating-toc-anchor--modal"), "class anchor + varian dari prop className");
    assert.equal(findAll(tree, n => hasClass(n, "floating-toc-popover")).length, 0, "popover tertutup awalnya");
    const trigger = findAll(tree, n => n.type === "button" && hasClass(n, "floating-toc-trigger"))[0];
    assert.ok(trigger, "tombol trigger ada");
    assert.equal(textOf(trigger), "📑");
    assert.equal(hasClass(trigger, "active"), false);

    trigger.props.onClick();
    assert.equal(opened.length, 1, "onOpen dipanggil saat membuka");
    tree = render(props);
    const popover = findAll(tree, n => hasClass(n, "floating-toc-popover"))[0];
    assert.ok(popover, "popover terbuka");
    assert.ok(textOf(popover).includes("📑 DAFTAR ISI (3)"), "header menghitung item");
    assert.ok(hasClass(findAll(tree, n => n.type === "button" && hasClass(n, "floating-toc-trigger"))[0], "active"), "trigger aktif saat terbuka");
    const spans = findAll(popover, n => hasClass(n, "note-toc-item"));
    assert.equal(spans.length, 3);
    assert.deepEqual(spans.map(s => hasClass(s, "active")), [false, true, false], "hanya activeIdx yang active");
    assert.deepEqual(spans.map(s => s.props.style.paddingLeft), [6, 16, 26], "indent per level");
    assert.deepEqual(spans.map(s => s.props.title), ["Bab Satu", "Sub A", "Detail"]);

    spans[2].props.onClick();
    assert.deepEqual(jumped, [items[2]], "onJump menerima item yang diklik");
    tree = render(props);
    assert.equal(findAll(tree, n => hasClass(n, "floating-toc-popover")).length, 0, "popover tertutup setelah klik item");
    assert.equal((listeners.pointerdown || new Set()).size, 0, "listener pointerdown dilepas saat tertutup");
    assert.equal(opened.length, 1, "onOpen tidak dipanggil saat menutup");
  });

  await t.test("fungsional: tombol ✕ dan pointerdown di luar menutup popover; di dalam tidak", () => {
    const { render, listeners, slots } = loadFloatingToc();
    const props = { items: [{ idx: 0, level: 1, text: "A" }, { idx: 1, level: 1, text: "B" }], activeIdx: null };
    let tree = render(props);
    findAll(tree, n => n.type === "button" && hasClass(n, "floating-toc-trigger"))[0].props.onClick(); // tanpa onOpen: aman
    tree = render(props);
    const close = findAll(tree, n => n.type === "button" && textOf(n) === "✕")[0];
    assert.ok(close, "tombol ✕ ada");
    close.props.onClick();
    tree = render(props);
    assert.equal(findAll(tree, n => hasClass(n, "floating-toc-popover")).length, 0, "✕ menutup");

    findAll(tree, n => n.type === "button" && hasClass(n, "floating-toc-trigger"))[0].props.onClick();
    tree = render(props);
    const ref = slots.find(s => s && typeof s === "object" && "current" in s);
    const inside = { id: "inside" };
    ref.current = { contains: el => el === inside };
    assert.equal(listeners.pointerdown.size, 1, "listener pointerdown terpasang saat terbuka");
    [...listeners.pointerdown][0]({ target: inside });
    tree = render(props);
    assert.ok(findAll(tree, n => hasClass(n, "floating-toc-popover")).length, "pointerdown di dalam anchor tidak menutup");
    [...listeners.pointerdown][0]({ target: { id: "outside" } });
    tree = render(props);
    assert.equal(findAll(tree, n => hasClass(n, "floating-toc-popover")).length, 0, "pointerdown di luar menutup");
  });
});

test("Floating ToC — NotePanel (mode baca) memakai FloatingToc", async (t) => {
  assert.ok(notePanelCode.length > 0, "NotePanel harus ada di static/index.html");

  await t.test("render FloatingToc bila heading ≥ 2 (markup inline lama pindah ke komponen)", () => {
    assert.match(notePanelCode, /tocItems\.length >= 2 && \/\*#__PURE__\*\/React\.createElement\(FloatingToc, \{\s*items: tocItems,\s*activeIdx: tocActiveIdx,/);
    assert.strictEqual(notePanelCode.includes('className: "floating-toc-anchor"'), false, "markup anchor inline tidak boleh tersisa di NotePanel");
    assert.strictEqual(notePanelCode.includes('className: "floating-toc-popover"'), false, "markup popover inline tidak boleh tersisa di NotePanel");
    assert.strictEqual(/const \[tocOpen, setTocOpen\]/.test(notePanelCode), false, "state open diurus FloatingToc");
    assert.strictEqual(/const tocRef = /.test(notePanelCode), false, "ref anchor diurus FloatingToc");
  });

  await t.test("onJump: set aktif instan + gulir ke #note-h-N milik renderer baca", () => {
    assert.match(notePanelCode, /onJump: item => \{\s*setTocActiveIdx\(item\.idx\);\s*const el = document\.getElementById\(`note-h-\$\{item\.idx\}`\);\s*if \(el\) el\.scrollIntoView\(\{ behavior: "smooth", block: "start" \}\);/);
  });

  await t.test("state tocActiveIdx + ref tocSpyRef + observer wiring", () => {
    assert.match(notePanelCode, /const \[tocActiveIdx, setTocActiveIdx\] = React\.useState\(null\)/, "state tocActiveIdx ada");
    assert.match(notePanelCode, /const tocSpyRef = React\.useRef\(null\)/, "ref tocSpyRef ada");
    assert.match(notePanelCode, /typeof IntersectionObserver === "undefined"/, "guard IntersectionObserver ada");
    assert.match(notePanelCode, /querySelectorAll\('\[id\^="note-h-"\]'\)/, "scope observer ke heading dalam container");
    assert.match(notePanelCode, /rootMargin: "-15% 0px -60% 0px"/, "band scroll-spy 15%–60%");
    assert.match(notePanelCode, /setTocActiveIdx\(parseInt\(m\[1\], 10\)\)/, "parse idx dari id heading");
  });

  await t.test("effect observer SETELAH deklarasi tocItems (regresi TDZ)", () => {
    const tocItemsIdx = notePanelCode.indexOf('const tocItems = useMemo(() => extractHeadings(note.content || ""), [note.content]);');
    const observerIdx = notePanelCode.indexOf("new IntersectionObserver");
    assert.ok(tocItemsIdx > -1 && observerIdx > -1, "kedua penanda ada");
    assert.ok(observerIdx > tocItemsIdx, "observer WAJIB setelah deklarasi tocItems (TDZ)");
  });

  await t.test("tocSpyRef terpasang di .note-rendered milik panel", () => {
    assert.match(notePanelCode, /className: "note-rendered",\s*ref: tocSpyRef/, "ref tocSpyRef di div note-rendered");
  });

  await t.test("scroll-spy reset tocActiveIdx saat note berganti (anti highlight stale)", () => {
    assert.match(notePanelCode, /React\.useEffect\(\(\) => \{\s*setTocActiveIdx\(null\);/, "setTocActiveIdx(null) harus statement PERTAMA di body effect scroll-spy");
  });
});

test("Floating ToC — NoteModal (mode edit) menggantikan kolom samping NoteToc", async (t) => {
  assert.ok(noteModalCode.length > 0, "NoteModal harus ada di static/index.html");

  await t.test("NoteToc & .note-toc-panel dihapus total (komponen, render, komentar DEPENDENCIES)", () => {
    assert.strictEqual(/\bNoteToc\b/.test(indexHtml), false, "tidak boleh ada NoteToc di index.html");
    assert.strictEqual(indexHtml.includes("note-toc-panel"), false, "tidak boleh ada note-toc-panel di index.html");
  });

  await t.test("FloatingToc dirender langsung di root modal (setelah area scroll), gating !focusMode & heading ≥ 2", () => {
    assert.match(noteModalCode, /\}, inner\), !focusMode && tocItems\.length >= 2 && \/\*#__PURE__\*\/React\.createElement\(FloatingToc, \{\s*items: tocItems,\s*activeIdx: tocActiveIdx,\s*onJump: jumpToEditorHeading,\s*onOpen: syncEditorToc,\s*className: "floating-toc-anchor--modal"\s*\}\)/);
  });

  await t.test("daftar heading dari dokumen editor; extractHeadings(content) hanya fallback sebelum editor siap", () => {
    assert.match(noteModalCode, /const mdTocItems = React\.useMemo\(\(\) => extractHeadings\(content\), \[content\]\);/);
    assert.match(noteModalCode, /const \[editorToc, setEditorToc\] = React\.useState\(null\);/);
    assert.match(noteModalCode, /const tocItems = editorToc \|\| mdTocItems;/);
    assert.match(noteModalCode, /ctx\.get\(MB\.editorViewCtx\)/);
    assert.match(noteModalCode, /extractDocHeadings\(view\.state\.doc\)/);
  });

  await t.test("daftar segar: dihitung ulang saat content berubah (coba ulang sampai editor siap) & saat popover dibuka", () => {
    const body = extractArrowFn(noteModalCode, "const syncEditorToc = ");
    assert.ok(body, "syncEditorToc harus ada");
    assert.match(body, /setEditorToc\(/);
    assert.match(noteModalCode, /if \(syncEditorToc\(\) \|\| \+\+tries > \d+\) return;\s*timer = setTimeout\(run, \d+\);/);
    assert.match(noteModalCode, /return \(\) => clearTimeout\(timer\);\s*\}, \[content\]\);/);
  });

  await t.test("lompat pakai posisi heading editor (bukan #note-h-N) & tidak memindah kursor", () => {
    assert.strictEqual(noteModalCode.includes("note-h-"), false, "NoteModal tidak boleh mencari #note-h-N (milik renderer baca)");
    const body = extractArrowFn(noteModalCode, "const jumpToEditorHeading = ");
    assert.ok(body, "jumpToEditorHeading harus ada");
    assert.match(body, /view\.nodeDOM\(/);
    assert.match(body, /doc\.nodeAt\(/);
    assert.match(body, /scrollIntoView\(\{ behavior: "smooth", block: "start" \}\)/);
    assert.strictEqual(/setSelection|\.focus\(|dispatch\(/.test(body), false, "tidak boleh memindah seleksi / fokus / dispatch");
  });

  await t.test("scroll-spy mode edit: observer pada DOM heading editor, dibuat ulang hanya saat struktur berubah", () => {
    assert.match(noteModalCode, /const editorTocKey = editorToc \? editorToc\.map\(h => h\.level \+ ":" \+ h\.text\)\.join\("\\n"\) : "";/);
    assert.match(noteModalCode, /React\.useEffect\(\(\) => \{\s*setTocActiveIdx\(null\);/, "reset aktif = statement pertama effect scroll-spy");
    assert.match(noteModalCode, /new IntersectionObserver\(/);
    assert.match(noteModalCode, /rootMargin: "-15% 0px -60% 0px"/);
    assert.match(noteModalCode, /\}, \[editorTocKey, focusMode, tocSpyNonce\]\);/, "deps: key struktur (bukan content) + focusMode + nonce DOM terganti");
    assert.match(noteModalCode, /!el\.isConnected/, "deteksi DOM heading diganti ProseMirror → buat ulang observer");
  });
});

test("extractDocHeadings — heading top-level dari dokumen ProseMirror (fungsional)", async (t) => {
  const src = extractArrowFn(indexHtml, "function extractDocHeadings");
  assert.ok(src, "function extractDocHeadings harus ada di level modul");
  const extractDocHeadings = new Function("return function extractDocHeadings" + src)();
  // Dokumen tiruan: forEach(node, offset) seperti ProseMirror Node.forEach (offset = pos top-level).
  const mkDoc = blocks => {
    let pos = 0;
    const kids = blocks.map(b => {
      const node = { type: { name: b.type }, attrs: b.attrs || {}, textContent: b.text || "", nodeSize: b.size };
      const at = pos;
      pos += b.size;
      return [node, at];
    });
    return { forEach: fn => kids.forEach(([n, at], i) => fn(n, at, i)) };
  };

  await t.test("hanya heading non-kosong, idx berurutan, level dari attrs, pos = offset", () => {
    const doc = mkDoc([
      { type: "heading", attrs: { level: 1 }, text: "Bab Satu", size: 10 },
      { type: "paragraph", text: "isi", size: 5 },
      { type: "code_block", text: "# komentar\nx = 1", size: 18 },
      { type: "heading", attrs: { level: 2 }, text: "   ", size: 5 },
      { type: "heading", attrs: { level: 2 }, text: "  Sub A  ", size: 9 },
      { type: "blockquote", text: "# bukan heading", size: 12 },
      { type: "heading", attrs: { level: 1 }, text: "Bab Dua", size: 9 },
    ]);
    assert.deepEqual(extractDocHeadings(doc), [
      { level: 1, text: "Bab Satu", idx: 0, pos: 0 },
      { level: 2, text: "Sub A", idx: 1, pos: 38 },
      { level: 1, text: "Bab Dua", idx: 2, pos: 59 },
    ]);
  });

  await t.test("dokumen tanpa heading → []", () => {
    assert.deepEqual(extractDocHeadings(mkDoc([{ type: "paragraph", text: "a", size: 3 }])), []);
  });
});

test("jumpToEditorHeading — lompat ke DOM heading editor (fungsional)", async (t) => {
  const src = extractArrowFn(noteModalCode, "const jumpToEditorHeading = ");
  assert.ok(src, "jumpToEditorHeading harus ada");
  const docSrc = extractArrowFn(indexHtml, "function extractDocHeadings");
  const extractDocHeadings = new Function("return function extractDocHeadings" + docSrc)();
  const setup = blocks => {
    const active = [];
    const scrolled = [];
    let pos = 0;
    const kids = blocks.map(b => {
      const node = { type: { name: b.type }, attrs: b.attrs || {}, textContent: b.text || "" };
      const at = pos;
      pos += b.size;
      return [node, at];
    });
    const byPos = new Map(kids.map(([n, at]) => [at, n]));
    const doms = new Map(kids.map(([n, at]) => [at, { pos: at, scrollIntoView: opts => scrolled.push({ pos: at, opts }) }]));
    const view = {
      state: { doc: { forEach: fn => kids.forEach(([n, at], i) => fn(n, at, i)), nodeAt: p => byPos.get(p) || null } },
      nodeDOM: p => doms.get(p) || null,
      dispatch: () => { throw new Error("tidak boleh dispatch"); },
      focus: () => { throw new Error("tidak boleh focus"); },
    };
    const jump = new Function("getEditorView", "extractDocHeadings", "setTocActiveIdx", "return " + src)(() => view, extractDocHeadings, v => active.push(v));
    return { jump, active, scrolled };
  };
  const blocks = [
    { type: "heading", attrs: { level: 1 }, text: "Bab Satu", size: 10 },
    { type: "code_block", text: "# komentar", size: 12 },
    { type: "heading", attrs: { level: 2 }, text: "Sub A", size: 7 },
    { type: "paragraph", text: "teks", size: 6 },
    { type: "heading", attrs: { level: 1 }, text: "Penutup", size: 9 },
  ];

  await t.test("item segar → gulir DOM heading ke-idx (smooth, start) & set aktif", () => {
    const { jump, active, scrolled } = setup(blocks);
    jump({ idx: 2, level: 1, text: "Penutup" });
    assert.deepEqual(scrolled, [{ pos: 35, opts: { behavior: "smooth", block: "start" } }]);
    assert.equal(active[0], 2);
  });

  await t.test("item dari fallback markdown (idx beda krn '# ...' di code block) → dicocokkan via teks", () => {
    const { jump, active, scrolled } = setup(blocks);
    // extractHeadings(content) menghitung "# komentar" → "Penutup" ber-idx 3 di fallback
    jump({ idx: 3, level: 1, text: "Penutup" });
    assert.deepEqual(scrolled.map(s => s.pos), [35]);
    assert.equal(active[active.length - 1], 2, "aktif dikoreksi ke idx dokumen editor");
  });

  await t.test("editor belum siap → tidak melempar, hanya set aktif", () => {
    const active = [];
    const jump = new Function("getEditorView", "extractDocHeadings", "setTocActiveIdx", "return " + src)(() => null, extractDocHeadings, v => active.push(v));
    assert.doesNotThrow(() => jump({ idx: 0, level: 1, text: "X" }));
    assert.deepEqual(active, [0]);
  });
});

test("cache bust: app.css & service worker", async (t) => {
  await t.test("index.html memuat app.css?v=298", () => {
    assert.match(indexHtml, /<link rel="stylesheet" href="\/static\/app\.css\?v=298">/);
  });
  await t.test("sw.js CACHE = taskflow-v332-edit-mode-floating-toc", () => {
    assert.match(swJs, /^const CACHE = "taskflow-v332-edit-mode-floating-toc";/m);
  });
});
