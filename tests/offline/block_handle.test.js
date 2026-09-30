"use strict";

// Block handle ala Notion ("+" / ⋮⋮) untuk editor Milkdown (MilkdownEditor di static/index.html).
// Mengunci: dependency @milkdown/plugin-block di milkdown-build, export bundle,
// integrasi di MilkdownEditor (desktop hover + mode touch), fix sisa "/" di slash menu,
// CSS handle/gutter/drop cursor, dan bump cache SW.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "../..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

const indexHtml = read("static/index.html");
const cssContent = read("static/app.css");
const swContent = read("static/sw.js");
const entryJs = read("milkdown-build/entry.js");
const buildPkg = JSON.parse(read("milkdown-build/package.json"));

const editorMatch = indexHtml.match(/function MilkdownEditor\(\{[\s\S]*?^function /m);
const editorCode = editorMatch ? editorMatch[0] : "";

// Ambil sumber arrow function `(<params>) => { ... }` yang dimulai setelah `marker`
// (scanner sederhana: hitung kurung, lewati isi string/template literal).
function extractArrowFn(code, marker) {
  const at = code.indexOf(marker);
  if (at < 0) return null;
  let i = code.indexOf("(", at + marker.length);
  const start = i;
  const skipString = (j) => {
    const q = code[j];
    j++;
    while (j < code.length && code[j] !== q) {
      if (code[j] === "\\") j++;
      j++;
    }
    return j;
  };
  const matchPair = (j, open, close) => {
    let depth = 0;
    for (; j < code.length; j++) {
      const c = code[j];
      if (c === "'" || c === '"' || c === "`") { j = skipString(j); continue; }
      if (c === open) depth++;
      else if (c === close) { depth--; if (depth === 0) return j; }
    }
    return -1;
  };
  const paramsEnd = matchPair(i, "(", ")");
  if (paramsEnd < 0) return null;
  i = code.indexOf("{", code.indexOf("=>", paramsEnd));
  const bodyEnd = matchPair(i, "{", "}");
  if (bodyEnd < 0) return null;
  return code.slice(start, bodyEnd + 1);
}

// ResolvedPos tiruan: ancestors[d] = nama node di depth d (0 = doc).
const mockPos = (ancestors) => ({
  depth: ancestors.length - 1,
  node: (d) => ({ type: { name: ancestors[d] } }),
});

test("milkdown-build: @milkdown/plugin-block + export baru di entry.js", async (t) => {
  await t.test("package.json memakai @milkdown/plugin-block 7.20.0 (exact, sama dgn @milkdown/* lain)", () => {
    assert.equal(buildPkg.dependencies["@milkdown/plugin-block"], "7.20.0");
  });

  await t.test("package-lock.json ikut terkunci ke plugin-block 7.20.0", () => {
    const lock = JSON.parse(read("milkdown-build/package-lock.json"));
    const entry = lock.packages && lock.packages["node_modules/@milkdown/plugin-block"];
    assert.ok(entry, "lockfile harus berisi node_modules/@milkdown/plugin-block");
    assert.equal(entry.version, "7.20.0");
  });

  await t.test("entry.js mengekspor block, blockConfig, BlockProvider dari plugin-block", () => {
    assert.match(entryJs, /export\s*\{\s*block\s*,\s*blockConfig\s*,\s*BlockProvider\s*\}\s*from\s*'@milkdown\/plugin-block'/);
  });

  await t.test("entry.js mengekspor NodeSelection dari @milkdown/prose/state", () => {
    assert.match(entryJs, /export\s*\{[^}]*\bNodeSelection\b[^}]*\}\s*from\s*'@milkdown\/prose\/state'/);
  });

  await t.test("entry.js mengekspor dropCursor dari @milkdown/prose/dropcursor", () => {
    assert.match(entryJs, /export\s*\{\s*dropCursor\s*\}\s*from\s*'@milkdown\/prose\/dropcursor'/);
  });
});

test("static/vendor/milkdown.bundle.js mengekspor API block handle (dievaluasi di VM)", async (t) => {
  const bundle = read("static/vendor/milkdown.bundle.js");
  const win = {
    navigator: { userAgent: "Node.js", platform: "Win32" },
    document: {
      documentElement: { style: {} },
      createElement: () => ({ setAttribute: () => {}, querySelector: () => null }),
      createRange: () => ({ setStart: () => {}, setEnd: () => {}, detach: () => {} }),
      head: { appendChild: () => {} },
      body: { appendChild: () => {} },
    },
    customElements: { get: () => null, define: () => {} },
    HTMLElement: class {},
    CSS: { supports: () => false },
  };
  win.window = win;
  win.self = win;
  win.globalThis = win;
  const ctx = vm.createContext(win);
  vm.runInContext(bundle, ctx);
  const MB = ctx.MilkdownBundle;

  await t.test("bundle termuat", () => {
    assert.ok(MB && typeof MB.Editor === "function");
  });

  await t.test("MB.block (array plugin) dan MB.blockConfig ($ctx dengan key)", () => {
    assert.ok(Array.isArray(MB.block) && MB.block.length > 0, "MB.block harus array plugin");
    assert.ok(MB.blockConfig && MB.blockConfig.key, "MB.blockConfig.key harus ada");
  });

  await t.test("MB.BlockProvider adalah class dengan update/show/hide/destroy", () => {
    assert.equal(typeof MB.BlockProvider, "function");
  });

  await t.test("MB.NodeSelection punya create & isSelectable", () => {
    assert.equal(typeof MB.NodeSelection, "function");
    assert.equal(typeof MB.NodeSelection.create, "function");
    assert.equal(typeof MB.NodeSelection.isSelectable, "function");
  });

  await t.test("MB.dropCursor adalah factory plugin", () => {
    assert.equal(typeof MB.dropCursor, "function");
  });

  await t.test("export lama yang dipakai block handle tetap ada ($prose, Plugin, PluginKey, TextSelection)", () => {
    assert.equal(typeof MB.$prose, "function");
    assert.equal(typeof MB.Plugin, "function");
    assert.equal(typeof MB.PluginKey, "function");
    assert.equal(typeof MB.TextSelection, "function");
  });
});

test("static/index.html: cache-bust bundle & css", async (t) => {
  await t.test("milkdown.bundle.js?v=289", () => {
    assert.match(indexHtml, /<script\s+src="\/static\/vendor\/milkdown\.bundle\.js\?v=289"><\/script>/);
  });
  await t.test("app.css?v=297", () => {
    assert.match(indexHtml, /<link rel="stylesheet" href="\/static\/app\.css\?v=297">/);
  });
});

test("MilkdownEditor: block handle ala Notion", async (t) => {
  assert.ok(editorCode.length > 0, "MilkdownEditor harus ada di static/index.html");

  await t.test("konstanta modul BLOCK_HANDLE_ON_TOUCH tepat di atas function MilkdownEditor", () => {
    assert.match(indexHtml, /const BLOCK_HANDLE_ON_TOUCH = true;\nfunction MilkdownEditor\(\{/);
  });

  await t.test("deteksi touch via matchMedia('(hover: none)') + fitur mati bila bundle lama", () => {
    assert.match(editorCode, /window\.matchMedia\('\(hover: none\)'\)\.matches/);
    assert.match(
      editorCode,
      /blockHandleEnabled = !!\((?:window\.MilkdownBundle|MB)\?\.block && (?:window\.MilkdownBundle|MB)\?\.BlockProvider\) && \(BLOCK_HANDLE_ON_TOUCH \|\| !isTouchUI\)/
    );
  });

  await t.test("container memakai className has-block-handle via React", () => {
    assert.match(
      editorCode,
      /className: "milkdown-editor note-modal-content-input" \+ \(blockHandleEnabled \? " has-block-handle" : ""\)/
    );
  });

  await t.test("DOM handle: div.milkdown-block-handle berisi tombol + dan ⋮⋮ dengan title", () => {
    assert.match(editorCode, /className = 'milkdown-block-handle'/);
    assert.match(editorCode, /milkdown-block-handle-btn milkdown-block-handle-add/);
    assert.match(editorCode, /milkdown-block-handle-btn milkdown-block-handle-drag/);
    assert.match(editorCode, /'Tambah blok di bawah'/);
    assert.match(editorCode, /'Ketuk untuk memilih blok'/);
    assert.match(editorCode, /'Seret untuk memindahkan blok'/);
  });

  await t.test("tombol +: pointerdown dicegah, pointerup memanggil onBlockAdd", () => {
    assert.match(editorCode, /addBtn\.addEventListener\('pointerdown', e => \{ e\.preventDefault\(\); e\.stopPropagation\(\); \}\)/);
    assert.match(editorCode, /addBtn\.addEventListener\('pointerup', e => \{ e\.preventDefault\(\); e\.stopPropagation\(\); onBlockAdd\(\); \}\)/);
    assert.match(editorCode, /addBtn\.addEventListener\('mousedown', e => \{ e\.preventDefault\(\);/);
  });

  await t.test("onBlockAdd: abaikan active basi, sisipkan paragraf setelah blok lalu ketik '/'", () => {
    const body = extractArrowFn(editorCode, "const onBlockAdd = ");
    assert.ok(body, "onBlockAdd harus ada");
    assert.match(body, /isTouchUI \? touchActive : blockProvider(?:\?)?\.active/);
    assert.match(body, /active\.\$pos\.doc !== view\.state\.doc/);
    assert.match(body, /active\.\$pos\.pos \+ active\.node\.nodeSize/);
    assert.match(body, /schema\.nodes\.paragraph\.create\(\)/);
    assert.match(body, /MB\.TextSelection\.near\(/);
    assert.match(body, /insertText\('\/'\)/);
    assert.match(body, /scrollIntoView\(\)/);
    assert.match(body, /blockProvider\.hide\(\)/);
  });

  await t.test("tombol ⋮⋮ di touch memilih blok dengan NodeSelection", () => {
    assert.match(editorCode, /MB\.NodeSelection\.isSelectable\(/);
    assert.match(editorCode, /MB\.NodeSelection\.create\(/);
  });

  await t.test("blockConfig.filterNodes menolak isi table & blockquote (fungsional)", () => {
    assert.match(editorCode, /ctx\.set\(MB\.blockConfig\.key, \{/);
    const src = extractArrowFn(editorCode, "filterNodes: ");
    assert.ok(src, "filterNodes harus ada");
    const filterNodes = new Function("return " + src)();
    assert.equal(filterNodes(mockPos(["doc"])), true, "blok top-level boleh");
    assert.equal(filterNodes(mockPos(["doc", "bullet_list", "list_item"])), true, "isi list boleh");
    assert.equal(filterNodes(mockPos(["doc", "table", "table_row", "table_cell"])), false, "isi sel tabel ditolak");
    assert.equal(filterNodes(mockPos(["doc", "blockquote"])), false, "isi blockquote ditolak");
    assert.equal(filterNodes(mockPos(["doc", "blockquote", "bullet_list", "list_item"])), false, "list di dalam blockquote ditolak");
  });

  await t.test("block view: BlockProvider dibuat & update() dipanggil SAAT view dibuat", () => {
    assert.match(
      editorCode,
      /ctx\.set\(MB\.block\.key, \{[\s\S]*?view: \(?editorView\)? => \{[\s\S]*?blockProvider = new MB\.BlockProvider\(\{[\s\S]*?\}\);\s*(?:\/\/[^\n]*\n\s*)*blockProvider\.update\(\);\s*(?:\/\/[^\n]*\n\s*)*let blurTimer/
    );
    assert.match(editorCode, /content: handleEl/);
    // item list: handle digeser melewati bullet/nomor/checkbox task (checkbox harus tetap bisa diklik)
    const off = extractArrowFn(editorCode, "getOffset: ");
    assert.ok(off, "getOffset harus ada");
    const getOffset = new Function("return " + off)();
    assert.equal(getOffset({ active: { node: { type: { name: "paragraph" } } } }), 4);
    assert.equal(getOffset({ active: { node: { type: { name: "list_item" } } } }), 24);
    assert.match(editorCode, /update: \(view, prevState\) => \{\s*blockProvider\.update\(\);/);
    assert.match(editorCode, /blockProvider\.destroy\(\)/);
  });

  await t.test("getPlacement ala Crepe (fungsional)", () => {
    const src = extractArrowFn(editorCode, "getPlacement: ");
    assert.ok(src, "getPlacement harus ada");
    const win = { getComputedStyle: () => ({ paddingTop: "0px", paddingBottom: "0px" }) };
    const getPlacement = new Function("window", "return " + src)(win);
    const mk = (name, childCounts, elH, handleH) => ({
      active: {
        node: { type: { name }, descendants: (fn) => childCounts.forEach((c) => fn({ childCount: c })) },
        el: { getBoundingClientRect: () => ({ height: elH }) },
      },
      blockDom: { getBoundingClientRect: () => ({ height: handleH }) },
    });
    assert.equal(getPlacement(mk("heading", [5, 5], 200, 24)), "left", "heading selalu 'left'");
    assert.equal(getPlacement(mk("paragraph", [0], 20, 24)), "left", "paragraf 1 baris → tengah");
    assert.equal(getPlacement(mk("paragraph", [0], 120, 24)), "left-start", "paragraf tinggi → atas");
    assert.equal(getPlacement(mk("bullet_list", [1, 1, 1], 20, 24)), "left-start", "banyak descendant → atas");
  });

  await t.test("plugin touch guard pointermove di-.use SEBELUM MB.block, lalu drop cursor", () => {
    assert.match(
      editorCode,
      /MB\.\$prose\(\(\) => new MB\.Plugin\(\{[\s\S]*?handleDOMEvents: \{[\s\S]*?pointermove: \(_v, e\) => e\.pointerType === 'touch'/
    );
    assert.match(
      editorCode,
      /MB\.\$prose\(\(\) => MB\.dropCursor\(\{ color: false, width: 2, class: 'milkdown-drop-cursor' \}\)\)/
    );
    assert.match(
      editorCode,
      /\.use\(tableToolbarPair\)\.use\(blockHandleEnabled \? touchGuardPlugin : \[\]\)\.use\(blockHandleEnabled \? MB\.block : \[\]\)\.use\(dropCursorPlugin \|\| \[\]\)/
    );
    assert.match(editorCode, /if \(blockHandleEnabled\) \{[\s\S]*?ctx\.set\(MB\.blockConfig\.key/);
  });

  await t.test("mode touch: handle mengikuti blok kursor (findCursorBlock fungsional)", () => {
    assert.match(editorCode, /const syncTouchHandle = /);
    assert.match(editorCode, /blockProvider\.show\(active\)/);
    assert.match(editorCode, /!prevState\.doc\.eq\(view\.state\.doc\)/);
    const src = extractArrowFn(editorCode, "const findCursorBlock = ");
    assert.ok(src, "findCursorBlock harus ada");
    class NodeSelection {}
    class FakeEl {}
    const findCursorBlock = new Function("MB", "HTMLElement", "return " + src)({ NodeSelection }, FakeEl);
    // $from tiruan: ancestors = [{name, pos}] dari depth 0; before(d) = pos node di depth d
    const mkView = (ancestors, selection) => {
      const $from = {
        depth: ancestors.length - 1,
        node: (d) => ({ type: { name: ancestors[d].name }, name: ancestors[d].name }),
        before: (d) => ancestors[d].pos,
      };
      const sel = selection || { $from };
      const doc = { resolve: (pos) => ({ pos, doc }) };
      const els = {};
      return {
        state: { selection: sel, doc },
        nodeDOM: (pos) => (els[pos] = els[pos] || Object.assign(new FakeEl(), { pos })),
      };
    };
    const P = (name, pos) => ({ name, pos });
    // paragraf top-level → blok depth 1
    let r = findCursorBlock(mkView([P("doc", -1), P("paragraph", 10)]));
    assert.equal(r.$pos.pos, 10);
    assert.equal(r.node.name, "paragraph");
    assert.ok(r.el instanceof FakeEl);
    // di dalam sel tabel → seluruh tabel
    r = findCursorBlock(mkView([P("doc", -1), P("table", 20), P("table_row", 21), P("table_cell", 22), P("paragraph", 23)]));
    assert.equal(r.node.name, "table");
    assert.equal(r.$pos.pos, 20);
    // list di dalam blockquote → blockquote (ancestor terluar)
    r = findCursorBlock(mkView([P("doc", -1), P("blockquote", 30), P("bullet_list", 31), P("list_item", 32), P("paragraph", 33)]));
    assert.equal(r.node.name, "blockquote");
    // nested list → list_item terdalam
    r = findCursorBlock(mkView([P("doc", -1), P("bullet_list", 40), P("list_item", 41), P("bullet_list", 42), P("list_item", 43), P("paragraph", 44)]));
    assert.equal(r.node.name, "list_item");
    assert.equal(r.$pos.pos, 43);
    // NodeSelection pada blok top-level → blok itu sendiri
    const nsel = Object.assign(new NodeSelection(), { from: 50, node: { name: "hr", isBlock: true }, $from: { depth: 0 } });
    r = findCursorBlock(mkView([P("doc", -1)], nsel));
    assert.equal(r.node.name, "hr");
    assert.equal(r.$pos.pos, 50);
    // NodeSelection list_item (hasil tap ⋮⋮ pada item list) → tetap list_item, tidak lompat ke seluruh list
    const liView = mkView([P("doc", -1), P("bullet_list", 60)]);
    const liSel = Object.assign(new NodeSelection(), { from: 61, node: { name: "list_item", isBlock: true }, $from: liView.state.selection.$from });
    r = findCursorBlock(mkView([P("doc", -1), P("bullet_list", 60)], liSel));
    assert.equal(r.node.name, "list_item");
    assert.equal(r.$pos.pos, 61);
    // NodeSelection inline (mis. gambar di paragraf) → paragrafnya
    const imgView = mkView([P("doc", -1), P("paragraph", 70)]);
    const imgSel = Object.assign(new NodeSelection(), { from: 72, node: { name: "image", isBlock: false }, $from: imgView.state.selection.$from });
    r = findCursorBlock(mkView([P("doc", -1), P("paragraph", 70)], imgSel));
    assert.equal(r.node.name, "paragraph");
    assert.equal(r.$pos.pos, 70);
  });

  await t.test("mode touch: blok yang tampil via hover mouse (perangkat hybrid) juga jadi acuan +/⋮⋮", () => {
    assert.match(
      editorCode,
      /if \(isTouchUI\) \{[\s\S]*?const baseShow = blockProvider\.show;\s*blockProvider\.show = \(active\) => \{ touchActive = active; baseShow\(active\); \};/
    );
  });

  await t.test("listener focus/blur mode touch dipasang di editorView.dom & dilepas saat destroy", () => {
    assert.match(editorCode, /editorView\.dom\.addEventListener\('focus', onFocus\)/);
    assert.match(editorCode, /editorView\.dom\.addEventListener\('blur', onBlur\)/);
    assert.match(editorCode, /editorView\.dom\.removeEventListener\('focus', onFocus\)/);
    assert.match(editorCode, /editorView\.dom\.removeEventListener\('blur', onBlur\)/);
  });
});

test("doSlashAction: karakter pemicu '/' dihapus sebelum aksi (kecuali draw)", async (t) => {
  await t.test("fix disisipkan sebelum `const { state } = view;`", () => {
    assert.match(
      editorCode,
      /const doSlashAction = \(type, payload\) => \{[\s\S]*?if \(type !== 'draw'\) \{[\s\S]*?\$c\.parent\.textBetween\(\$c\.parentOffset - 1, \$c\.parentOffset, null, "￼"\) === "\/"[\s\S]*?view\.dispatch\(view\.state\.tr\.delete\(\$c\.pos - 1, \$c\.pos\)\);\s*\}\s*\}\s*const \{ state \} = view;/
    );
  });
  await t.test("kursor masuk ke blok baru (list/tabel/divider), bukan ke blok sesudahnya", () => {
    const body = extractArrowFn(editorCode, "const doSlashAction = ");
    assert.ok(body, "doSlashAction harus ada");
    const m = body.match(/if \(type === 'bullet_list_simple' \|\| type === 'ordered_list' \|\| type === 'task_list' \|\| type === 'table' \|\| type === 'hr'\) \{([\s\S]*?)\n        \}\n        view\.dispatch\(tr\.scrollIntoView\(\)\);/);
    assert.ok(m, "blok penempatan kursor harus tepat sebelum view.dispatch(tr.scrollIntoView())");
    assert.match(m[1], /tr\.steps\[tr\.steps\.length - 1\]/, "blok baru dicari dari step terakhir");
    assert.match(m[1], /tr\.setSelection\(MB\.TextSelection\.near\(tr\.doc\.resolve\(inside\)\)\)/);
    assert.match(m[1], /node\.isLeaf[\s\S]*?tr\.insert\([\s\S]*?paragraph\.create\(\)\)/, "divider: sisipkan paragraf kosong untuk kursor");
  });
  await t.test("case heading & draw tidak berubah (dikunci slash_draw_query.test.js)", () => {
    assert.match(editorCode, /case 'heading':\s*tr = tr\.setBlockType\(from, to, state\.schema\.nodes\.heading, \{ level: payload \}\)/);
    assert.match(editorCode, /state\.tr\.delete\(qFrom2\.start\(\) \+ slashIdx2, qFrom2\.pos\)/);
  });
});

test("static/app.css: style block handle, gutter & drop cursor", async (t) => {
  await t.test("handle tampil hanya bila data-show=true", () => {
    assert.match(cssContent, /\.milkdown-block-handle \{[^}]*position: absolute;[^}]*opacity: 0;[^}]*pointer-events: none;/);
    assert.match(cssContent, /\.milkdown-block-handle\[data-show="true"\] \{ opacity: 1; pointer-events: auto; \}/);
  });
  await t.test("gutter kiri .has-block-handle .ProseMirror (desktop 48px, touch 44px)", () => {
    assert.match(cssContent, /\.milkdown-editor\.has-block-handle \.ProseMirror \{ padding-left: 48px; \}/);
    assert.match(cssContent, /@media \(hover: none\) \{\s*\.milkdown-editor\.has-block-handle \.ProseMirror \{ padding-left: 44px; \}/);
  });
  await t.test("drop cursor memakai warna aksen", () => {
    assert.match(cssContent, /\.milkdown-drop-cursor \{ background: var\(--accent, #a8c500\); \}/);
  });
  await t.test("section ditempatkan setelah .milkdown-tooltip-btn:hover, sebelum dark mode slash/tooltip", () => {
    const hover = cssContent.indexOf(".milkdown-tooltip-btn:hover {");
    const section = cssContent.indexOf("/* ── Block handle (+ / ⋮⋮) ala Notion");
    const dark = cssContent.indexOf('[data-theme="dark"] .milkdown-slash-menu,');
    assert.ok(hover > 0 && section > hover && dark > section, "urutan section CSS salah");
  });
});

test("static/sw.js: CACHE di-bump untuk block handle", () => {
  assert.match(swContent, /^const CACHE = "taskflow-v331-milkdown-block-handle";/m);
});
