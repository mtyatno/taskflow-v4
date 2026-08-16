# Mindmap Node Text Formatting (Fase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mindmap node topics (canvas + outline) render markdown-formatted text with a formatting toolbar on both surfaces; alignment is a per-node `align` field.

**Architecture:** One shared renderer + pure text-insert helpers live in the existing UMD module `static/offline/mindmapoutline.js` (unit-tested in node, `marked` v15.0.12 vendored). The canvas iframe loads the module + marked and passes `markdown: renderTopicMd` to the engine constructor (engine has the hook: `this.markdown ? innerHTML = this.markdown(topic, node) : textContent`), plus a `#fmt-toolbar` row shown during `beginEdit` that inserts syntax into the engine's plaintext-only `#input-box`. The outline renders rows via the same renderer (plain-text fallback while searching) and shows a toolbar during inline edit that operates on `editVal` via the same helpers; align goes through a new `setNodeAlign` transform.

**Tech Stack:** marked v15.0.12 (`marked.parse`), mind-elixir 5.15.1 (`markdown` option), compiled React (`React.createElement`, no JSX), node --test.

**Spec:** `docs/superpowers/specs/2026-08-16-mindmap-node-text-formatting-design.md`

## Global Constraints

- Topic stays a plain string; formatting = markdown syntax inside the string. `align` = per-node field (`left`|`center`|`right`|`justify`). NO backend/schema changes.
- Renderer must leave plain topics (no markers) visually unchanged.
- Highlight (`__teks__`) preprocessor runs BEFORE marked and emits `<strong class="underscore-emphasis">` (engine CSS class). Raw HTML (`<u>…</u>`) passes through marked unchanged.
- Canvas edit box is `plaintext-only` contenteditable — users edit raw syntax; toolbar edits the box via textContent + caret restore (NOT execCommand — deterministic).
- Outline search active → row falls back to plain text + existing `<mark>` highlight (no HTML rendering during search).
- `static/index.html` and the vendor iframe are compiled/plain JS — no JSX. Only the listed files change.
- Versioning: iframe src `?v=122` → `?v=123`; SW cache name `taskflow-v220-mindmap-outline-drag-guides` → `taskflow-v221-mindmap-md` (the module is SW-precached cache-first — the name bump is what delivers the new module bytes). Vendor sub-resources keep their URLs (same-origin, covered by SW name bump).
- Tests: extend `tests/offline/mindmapoutline.test.js`; run `node --test tests/offline/mindmapoutline.test.js` (targeted) then `npm test` once at the end (expect previous total + new tests; read REAL summary lines).
- Commit convention: `feat:`/`fix:`/`chore:` + `Co-Authored-By: Claude <noreply@anthropic.com>`. Commit per task. Do NOT push — user pushes.

---

### Task 1: Module — renderer, insert helpers, setNodeAlign + unit tests

**Files:**
- Modify: `static/offline/mindmapoutline.js`
- Test: `tests/offline/mindmapoutline.test.js`

**Interfaces:**
- Consumes: vendored `marked` (UMD): `const req = (m, g) => (isNode ? require(m) : g);` pattern — module requires `../vendor/marked.min.js` in node, `root.marked` in browser.
- Produces (new exports, consumed by Tasks 2-3):
  - `renderTopicMd(topic)` → html string (highlight preprocess + `marked.parse(topic, {gfm:true, breaks:true})`, try/catch → escaped plain text on parse failure).
  - `wrapSelection(text, start, end, before, after, placeholder)` → `{text, selStart, selEnd}` — wraps selection; empty selection → placeholder inserted with caret inside.
  - `prefixLines(text, start, end, prefix, numbered)` → `{text, selStart, selEnd}` — prefixes each line in range; `numbered` → `1. `, `2. `…; empty selection → prefix at caret.
  - `insertBlock(text, start, end, block)` → `{text, selStart, selEnd}` — inserts block on its own line (adds surrounding newlines as needed), caret after block.
  - `setNodeAlign(root, id, align)` → new root — sets `align`; invalid value or missing node → same root.

- [ ] **Step 1: Write the failing tests** — append to `tests/offline/mindmapoutline.test.js`:

```js
test("renderTopicMd renders bold, italic, highlight, underline, strike", () => {
  assert.match(MO.renderTopicMd("**tebal**"), /<strong>tebal<\/strong>/);
  assert.match(MO.renderTopicMd("*miring*"), /<em>miring<\/em>/);
  assert.match(MO.renderTopicMd("__sorot__"), /underscore-emphasis/);
  assert.match(MO.renderTopicMd("<u>garis</u>"), /<u>garis<\/u>/);
  assert.match(MO.renderTopicMd("~~coret~~"), /<del>coret<\/del>/);
});

test("renderTopicMd renders heading, code, link", () => {
  assert.match(MO.renderTopicMd("# Judul"), /<h1[^>]*>Judul<\/h1>/);
  assert.match(MO.renderTopicMd("`kode`"), /<code>kode<\/code>/);
  assert.match(MO.renderTopicMd("[x](https://a)"), /<a href="https:\/\/a">x<\/a>/);
});

test("renderTopicMd renders lists, divider, table", () => {
  assert.match(MO.renderTopicMd("- a\n- b"), /<ul>/);
  assert.match(MO.renderTopicMd("1. a\n2. b"), /<ol>/);
  assert.match(MO.renderTopicMd("---"), /<hr/);
  assert.match(MO.renderTopicMd("| a | b |\n| - | - |\n| 1 | 2 |"), /<table>/);
});

test("renderTopicMd leaves plain text unchanged and handles mixed content", () => {
  assert.equal(MO.renderTopicMd("halo dunia"), /^<p>halo dunia<\/p>\n?$/.test(MO.renderTopicMd("halo dunia")) ? "halo dunia" : MO.renderTopicMd("halo dunia"));
  const mixed = MO.renderTopicMd("__sorot__ dan **tebal**");
  assert.match(mixed, /underscore-emphasis/);
  assert.match(mixed, /<strong>tebal<\/strong>/);
});

test("wrapSelection wraps selection and inserts placeholder when empty", () => {
  const w = MO.wrapSelection("halo dunia", 5, 10, "**", "**", "teks");
  assert.equal(w.text, "halo **dunia**");
  assert.equal(w.selStart, 7);
  assert.equal(w.selEnd, 12);
  const p = MO.wrapSelection("abc", 1, 1, "[", "](https://)", "teks");
  assert.equal(p.text, "a[teks](https://)bc");
  assert.equal(p.selStart, 2);
  assert.equal(p.selEnd, 6);
});

test("prefixLines prefixes each selected line; numbered counts sequentially", () => {
  const u = MO.prefixLines("a\nb", 0, 3, "- ", false);
  assert.equal(u.text, "- a\n- b");
  const o = MO.prefixLines("a\nb\nc", 0, 5, "", true);
  assert.equal(o.text, "1. a\n2. b\n3. c");
  const e = MO.prefixLines("ab", 1, 1, "- ", false);
  assert.equal(e.text, "a- b");
});

test("insertBlock puts block on its own line and places caret after it", () => {
  const b = MO.insertBlock("a\nb", 2, 2, "---");
  assert.equal(b.text, "a\n---\nb");
  assert.equal(b.selStart, 5);
  assert.equal(b.selEnd, 5);
  const e2 = MO.insertBlock("", 0, 0, "---");
  assert.equal(e2.text, "---");
});

test("setNodeAlign sets align and preserves fields; invalid no-op", () => {
  const t = fixture();
  const r = MO.setNodeAlign(t, "b", "center");
  assert.equal(MO.findNode(r, "b").node.align, "center");
  assert.deepEqual(MO.findNode(r, "a").node.links, [{ type: "note", id: 1, title: "N" }]);
  assert.equal(MO.setNodeAlign(t, "b", "banana"), t);
  assert.equal(MO.setNodeAlign(t, "zzz", "center"), t);
});
```

Update the existing export-surface test expected list — find:

```js
  const expected = [
    "findNode", "addChild", "addSibling", "renameNode", "deleteNode", "duplicateNode",
    "moveNode", "moveSibling", "moveInto", "indentNode", "outdentNode", "toggleExpand",
    "expandAll", "collapseAll", "cloneSubtree", "insertSubtree", "searchNodes", "ancestorsOf",
  ].sort();
```

Replace with:

```js
  const expected = [
    "findNode", "addChild", "addSibling", "renameNode", "deleteNode", "duplicateNode",
    "moveNode", "moveSibling", "moveInto", "indentNode", "outdentNode", "toggleExpand",
    "expandAll", "collapseAll", "cloneSubtree", "insertSubtree", "searchNodes", "ancestorsOf",
    "renderTopicMd", "wrapSelection", "prefixLines", "insertBlock", "setNodeAlign",
  ].sort();
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/offline/mindmapoutline.test.js`
Expected: FAIL — `MO.renderTopicMd is not a function` (first new test), export-surface test fails on missing names.

- [ ] **Step 3: Implement the new exports in the module**

In `static/offline/mindmapoutline.js`:

1. Add the marked dependency next to the existing helpers, right after the `"use strict";` line:

```js
  const isNode = (typeof module !== "undefined" && module.exports);
  const req = (m, g) => (isNode ? require(m) : g);
  const markedLib = req("../vendor/marked.min.js", root.marked);
```

(Note: the module's UMD factory already receives `root` — reuse it; do not create a second isNode.)

2. Add the five functions before the `return {...}` block:

```js
  function renderTopicMd(topic) {
    const t = String(topic == null ? "" : topic);
    const pre = t.replace(/__([^_]+?)__/g, '<strong class="underscore-emphasis">$1</strong>');
    try {
      if (markedLib && typeof markedLib.parse === "function") return markedLib.parse(pre, { gfm: true, breaks: true });
      if (markedLib) return markedLib(pre);
      return pre.replace(/</g, "&lt;").replace(/>/g, "&gt;");
    } catch (_) {
      return pre.replace(/</g, "&lt;").replace(/>/g, "&gt;");
    }
  }

  function wrapSelection(text, start, end, before, after, placeholder) {
    const s = Math.max(0, start);
    const e = end == null || end <= s ? s : end;
    const sel = text.slice(s, e);
    const insert = sel || placeholder;
    const next = text.slice(0, s) + before + insert + after + text.slice(e);
    return { text: next, selStart: s + before.length, selEnd: s + before.length + insert.length };
  }

  function prefixLines(text, start, end, prefix, numbered) {
    const s = Math.max(0, start);
    const e = end == null || end <= s ? s : end;
    const sel = text.slice(s, e);
    const lines = sel.split("\n");
    const out = lines.map((l, i) => (numbered ? (i + 1) + ". " : prefix) + l).join("\n");
    const next = text.slice(0, s) + out + text.slice(e);
    return { text: next, selStart: s, selEnd: s + out.length };
  }

  function insertBlock(text, start, end, block) {
    const s = Math.max(0, start);
    const e = end == null || end <= s ? s : end;
    const before = text.slice(0, s);
    const after = text.slice(e);
    const needNLBefore = before !== "" && !before.endsWith("\n");
    const needNLAfter = after !== "" && !after.startsWith("\n");
    const ins = (needNLBefore ? "\n" : "") + block + (needNLAfter ? "\n" : "");
    const next = before + ins + after;
    const caret = s + (needNLBefore ? 1 : 0) + block.length;
    return { text: next, selStart: caret, selEnd: caret };
  }

  function setNodeAlign(root, id, align) {
    if (align !== "left" && align !== "center" && align !== "right" && align !== "justify") return root;
    const f = findNode(root, id);
    if (!f || !f.node) return root;
    return updateNode(root, id, (n) => ({ ...n, align }));
  }
```

3. Add the five names to the returned object:

```js
    renderTopicMd, wrapSelection, prefixLines, insertBlock, setNodeAlign,
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/offline/mindmapoutline.test.js`
Expected: ALL pass (previous 18 + 9 new = 27; report real numbers). If the "plain text unchanged" test behaves unexpectedly (marked wraps plain text in `<p>`), ADJUST THAT ONE TEST to assert the rendered string does not introduce newline markers: `assert.equal(MO.renderTopicMd("halo dunia").replace(/<\/?p>/g, ""), "halo dunia");` — note the change in your report.

- [ ] **Step 5: Commit**

```bash
git add static/offline/mindmapoutline.js tests/offline/mindmapoutline.test.js
git commit -m "feat(mindmap): add markdown topic renderer + text-insert helpers + setNodeAlign to outline module

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 2: Canvas — renderer, fmt toolbar, align pass (vendor iframe)

**Files:**
- Modify: `static/vendor/mind-elixir/index.html`

**Interfaces:**
- Consumes: `TF.mindmapoutline.renderTopicMd/wrapSelection/prefixLines/insertBlock` (Task 1); engine 5.15.1 `markdown` constructor option; bus `operation` names `beginEdit`/`finishEdit`; engine `#input-box` (plaintext-only contenteditable, `textContent` = raw topic).
- Produces: canvas topics render formatted HTML; `#fmt-toolbar` shown during edits; per-node `textAlign` from `nodeObj.align` applied in the post-layout pass; align changes post `change`.

- [ ] **Step 1: Load marked + module in the iframe**

In `static/vendor/mind-elixir/index.html`, find:

```html
  <script src="MindElixir.iife.js?v=120"></script>
```

Replace with:

```html
  <script src="MindElixir.iife.js?v=120"></script>
  <script src="/static/vendor/marked.min.js"></script>
  <script src="/static/offline/mindmapoutline.js"></script>
```

- [ ] **Step 2: Add the `markdown` option to the engine constructor**

In `initMind`, find:

```js
      mind = new ME({
        el: '#map',
        direction: MindElixir.SIDE,
        draggable: true,
        editable: true,
        contextMenu: true,
        toolBar: true,
        keypress: true,
      });
```

Replace with:

```js
      mind = new ME({
        el: '#map',
        direction: MindElixir.SIDE,
        draggable: true,
        editable: true,
        contextMenu: true,
        toolBar: true,
        keypress: true,
        markdown: (topic) => (window.TF && window.TF.mindmapoutline && window.TF.mindmapoutline.renderTopicMd)
          ? window.TF.mindmapoutline.renderTopicMd(topic)
          : topic,
      });
```

- [ ] **Step 3: Add the `#fmt-toolbar` markup + CSS**

In the same file, find the `#node-toolbar` block:

```html
    <div id="node-toolbar">
```

Insert directly BEFORE it:

```html
    <div id="fmt-toolbar">
      <button data-act="bold" title="Bold (tebal)"><b>B</b></button>
      <button data-act="italic" title="Italic (miring)"><i>I</i></button>
      <button data-act="underline" title="Underline (garis bawah)"><u>U</u></button>
      <button data-act="strike" title="Coret"><s>S</s></button>
      <button data-act="highlight" title="Highlight">✨</button>
      <button data-act="heading" title="Heading">H</button>
      <button data-act="code" title="Inline code">&lt;/&gt;</button>
      <button data-act="link" title="Link">🔗</button>
      <button data-act="table" title="Tabel">⊞</button>
      <div class="sep"></div>
      <button data-act="ul" title="List •">•</button>
      <button data-act="ol" title="List angka">1.</button>
      <button data-act="hr" title="Garis pemisah">─</button>
      <div class="sep"></div>
      <button data-act="align" data-align="left" title="Rata kiri">L</button>
      <button data-act="align" data-align="center" title="Tengah">C</button>
      <button data-act="align" data-align="right" title="Rata kanan">R</button>
      <button data-act="align" data-align="justify" title="Rata penuh">J</button>
    </div>
```

Find the `#node-toolbar` CSS rule:

```css
    #node-toolbar {
      display: none;
```

Insert directly BEFORE it:

```css
    #fmt-toolbar {
      display: none;
      flex-shrink: 0;
      border-bottom: 2px solid #6c7ae0;
      background: #12122a;
      padding: 4px 12px;
      font-family: system-ui, sans-serif;
      align-items: center;
      justify-content: center;
      gap: 2px;
      flex-wrap: wrap;
    }
    #fmt-toolbar button {
      background: none;
      border: none;
      cursor: pointer;
      border-radius: 20px;
      padding: 3px 9px;
      color: #ccc;
      font-size: 13px;
      -webkit-tap-highlight-color: transparent;
      min-width: 28px;
    }
    #fmt-toolbar button:hover, #fmt-toolbar button:active { background: rgba(108,122,224,0.18); }
    #fmt-toolbar .sep { width: 1px; height: 20px; background: #3a3a6a; margin: 0 4px; }
```

- [ ] **Step 4: Add topic markdown CSS to the same `<style>` block**

Append (anywhere inside the existing `<style>` element, e.g. right after the `.node-link-badge` rule):

```css
    .map-container .text ul, .map-container .text ol { margin: 3px 0 3px 18px; padding: 0; }
    .map-container .text li { margin: 1px 0; }
    .map-container .text table { border-collapse: collapse; margin: 4px 0; font-size: 0.92em; }
    .map-container .text th, .map-container .text td { border: 1px solid #3a3a6a; padding: 2px 6px; }
    .map-container .text hr { border: none; border-top: 1px solid #3a3a6a; margin: 5px 0; }
    .map-container .text code { background: #1e1e38; border: 1px solid #3a3a6a; border-radius: 3px; padding: 0 4px; font-size: 0.9em; }
    .map-container .text a { color: #6c7ae0; }
```

- [ ] **Step 5: Wire the toolbar show/hide to the operation bus**

Find:

```js
      mind.bus.addListener('operation', () => {
        window.parent.postMessage({ type: 'change', data: mind.getData() }, window.location.origin);
      });
```

Replace with:

```js
      mind.bus.addListener('operation', (op) => {
        if (op && op.name === 'beginEdit') document.getElementById('fmt-toolbar').style.display = 'flex';
        if (op && op.name === 'finishEdit') document.getElementById('fmt-toolbar').style.display = 'none';
        window.parent.postMessage({ type: 'change', data: mind.getData() }, window.location.origin);
      });
```

- [ ] **Step 6: Add the toolbar action handlers (place after the node-toolbar handlers, before the `link-panel-close` handler)**

Insert this block right after the `ntb-delete` handler:

```js
      // ── Formatting toolbar ──────────────────────────────────────
      const FMT_ACTIONS = {
        bold:      (t, s, e) => window.TF.mindmapoutline.wrapSelection(t, s, e, "**", "**", "teks"),
        italic:    (t, s, e) => window.TF.mindmapoutline.wrapSelection(t, s, e, "*", "*", "teks"),
        underline: (t, s, e) => window.TF.mindmapoutline.wrapSelection(t, s, e, "<u>", "</u>", "teks"),
        strike:    (t, s, e) => window.TF.mindmapoutline.wrapSelection(t, s, e, "~~", "~~", "teks"),
        highlight: (t, s, e) => window.TF.mindmapoutline.wrapSelection(t, s, e, "__", "__", "sorot"),
        heading:   (t, s, e) => window.TF.mindmapoutline.prefixLines(t, s, e, "# ", false),
        code:      (t, s, e) => window.TF.mindmapoutline.wrapSelection(t, s, e, "`", "`", "kode"),
        link:      (t, s, e) => window.TF.mindmapoutline.wrapSelection(t, s, e, "[", "](https://)", "teks"),
        table:     (t, s, e) => window.TF.mindmapoutline.insertBlock(t, s, e, "| Kolom 1 | Kolom 2 | Kolom 3 |\n| --- | --- | --- |\n| isi | isi | isi |"),
        ul:        (t, s, e) => window.TF.mindmapoutline.prefixLines(t, s, e, "- ", false),
        ol:        (t, s, e) => window.TF.mindmapoutline.prefixLines(t, s, e, "", true),
        hr:        (t, s, e) => window.TF.mindmapoutline.insertBlock(t, s, e, "---"),
      };

      function getEditSelection() {
        const box = document.getElementById('input-box');
        if (!box) return null;
        const sel = window.getSelection();
        if (!sel || sel.rangeCount === 0 || !box.contains(sel.anchorNode)) return { box, s: box.textContent.length, e: box.textContent.length };
        const range = document.createRange();
        range.selectNodeContents(box);
        range.setEnd(sel.anchorNode, sel.anchorOffset);
        const a = range.toString().length;
        range.selectNodeContents(box);
        range.setEnd(sel.focusNode, sel.focusOffset);
        const b = range.toString().length;
        return { box, s: Math.min(a, b), e: Math.max(a, b) };
      }

      function setEditCaret(box, start, end) {
        const sel = window.getSelection();
        const range = document.createRange();
        let pos = 0, startNode = null, startOff = 0, endNode = null, endOff = 0;
        (function walk(node) {
          if (endNode != null) return;
          if (node.nodeType === 3) {
            const len = node.textContent.length;
            if (startNode == null && pos + len >= start) { startNode = node; startOff = start - pos; }
            if (pos + len >= end) { endNode = node; endOff = end - pos; }
            pos += len;
          } else {
            for (const ch of node.childNodes) { if (endNode != null) break; walk(ch); }
          }
        })(box);
        if (startNode && endNode) {
          range.setStart(startNode, Math.max(0, Math.min(startOff, startNode.textContent.length)));
          range.setEnd(endNode, Math.max(0, Math.min(endOff, endNode.textContent.length)));
          sel.removeAllRanges();
          sel.addRange(range);
        }
      }

      document.querySelectorAll('#fmt-toolbar button').forEach(btn => {
        btn.onclick = () => {
          if (btn.dataset.act === 'align') {
            if (!currentNodeData) return;
            currentNodeData.align = btn.dataset.align;
            updateBadges(); // re-applies textAlign via the post-layout pass
            window.parent.postMessage({ type: 'change', data: mind.getData() }, window.location.origin);
            return;
          }
          const fn = FMT_ACTIONS[btn.dataset.act];
          if (!fn) return;
          const ed = getEditSelection();
          if (!ed) return;
          const res = fn(ed.box.textContent, ed.s, ed.e);
          ed.box.textContent = res.text;
          setEditCaret(ed.box, res.selStart, res.selEnd);
          ed.box.focus();
        };
      });
```

- [ ] **Step 7: Apply textAlign in the post-layout pass**

Find the `updateBadges` function and replace its `addBadge` inner function with an `apply` function that also sets alignment for EVERY node (not only nodes with links):

```js
    function updateBadges() {
      document.querySelectorAll('.node-link-badge').forEach(el => el.remove());
      function apply(nodeData) {
        const allTopics = document.querySelectorAll('me-tpc');
        allTopics.forEach(el => {
          if (el.nodeObj && el.nodeObj.id === nodeData.id) {
            el.style.textAlign = nodeData.align || '';
            const count = (nodeData.links || []).length;
            if (count > 0) {
              el.style.position = 'relative';
              const badge = document.createElement('span');
              badge.className = 'node-link-badge';
              badge.textContent = count;
              el.appendChild(badge);
            }
          }
        });
        (nodeData.children || []).forEach(apply);
      }
      apply(mind.getData().nodeData);
    }
```

(Replace the entire existing `updateBadges` body with the above — the old version had `addBadge`; keep the function name.)

- [ ] **Step 8: Syntax check**

Run:

```bash
cd "Z:\Todolist Manager V5.0"
node -e "
const fs=require('fs');
const v=fs.readFileSync('static/vendor/mind-elixir/index.html','utf8');
const vm=[...v.matchAll(/<script>([\s\S]*?)<\/script>/g)].filter(m=>!m[0].includes('src='));
fs.writeFileSync(process.env.TEMP+'/vendor-fmt.js', vm[vm.length-1][1]);
"
node --check "$TEMP/vendor-fmt.js"
```

Expected: exit 0, no output.

- [ ] **Step 9: Commit**

```bash
git add static/vendor/mind-elixir/index.html
git commit -m "feat(mindmap): canvas markdown rendering + formatting toolbar + per-node alignment

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 3: Outline — markdown rows, edit toolbar, align

**Files:**
- Modify: `static/index.html` (`MindmapOutline` component)

**Interfaces:**
- Consumes: `TF.mindmapoutline.renderTopicMd/wrapSelection/prefixLines/insertBlock/setNodeAlign` (Task 1); existing `edit()`, `editVal`/`setEditVal`, `editingIdRef`, `containerRef` inside the component.
- Produces: rows render formatted HTML (plain text + mark highlight during search); toolbar row above the textarea during inline edit; align applied per row and settable via toolbar (through `edit()` → undo-aware pipeline).

- [ ] **Step 1: Render markdown in rows (with search fallback)**

In `renderTopic`, find:

```js
    if (matchSet && matchSet.has(n.id)) {
      const idx = n.topic.toLowerCase().indexOf(q);
      if (idx !== -1) {
        return /*#__PURE__*/React.createElement(React.Fragment, null,
          n.topic.slice(0, idx),
          /*#__PURE__*/React.createElement("mark", {
            style: { background: "var(--accent)", color: "#000", borderRadius: 3, padding: "0 2px" }
          }, n.topic.slice(idx, idx + q.length)),
          n.topic.slice(idx + q.length));
      }
    }
    return n.topic;
```

Replace with:

```js
    if (matchSet && matchSet.has(n.id)) {
      const idx = n.topic.toLowerCase().indexOf(q);
      if (idx !== -1) {
        return /*#__PURE__*/React.createElement(React.Fragment, null,
          n.topic.slice(0, idx),
          /*#__PURE__*/React.createElement("mark", {
            style: { background: "var(--accent)", color: "#000", borderRadius: 3, padding: "0 2px" }
          }, n.topic.slice(idx, idx + q.length)),
          n.topic.slice(idx + q.length));
      }
    }
    const mdHtml = (MO && MO.renderTopicMd) ? MO.renderTopicMd(n.topic) : null;
    if (mdHtml) {
      return /*#__PURE__*/React.createElement("span", {
        className: "topic-md",
        dangerouslySetInnerHTML: { __html: mdHtml }
      });
    }
    return n.topic;
```

- [ ] **Step 2: Apply per-row alignment**

Find the topic span style in `renderRow`:

```js
      style: {
        flex: 1, minWidth: 0, whiteSpace: "pre-wrap", wordBreak: "break-word",
        alignSelf: "flex-start", paddingTop: 1,
        fontWeight: isRoot ? 700 : 400,
        color: isRoot ? "var(--accent)" : "var(--text-primary)"
      }
```

Replace with:

```js
      style: {
        flex: 1, minWidth: 0, whiteSpace: "pre-wrap", wordBreak: "break-word",
        alignSelf: "flex-start", paddingTop: 1,
        fontWeight: isRoot ? 700 : 400,
        color: isRoot ? "var(--accent)" : "var(--text-primary)",
        textAlign: n.align || undefined
      }
```

(Note: `whiteSpace: "pre-wrap"` on the wrapper keeps multiline topics; the markdown HTML inside `.topic-md` carries its own layout.)

- [ ] **Step 3: Add the inline-edit toolbar**

In `renderTopic`, find the editing branch's textarea return:

```js
    if (editingId === n.id) {
      return /*#__PURE__*/React.createElement("textarea", {
```

Replace with a fragment that renders a toolbar row + the textarea. Wrap: replace the WHOLE editing branch return (from `return /*#__PURE__*/React.createElement("textarea", {` through its closing `});`) with:

```js
    if (editingId === n.id) {
      const applyFmt = fn => {
        const start = editVal.length;
        const end = editVal.length;
        const res = fn(editVal, start, end);
        setEditVal(res.text);
        requestAnimationFrame(() => {
          const el = editAreaRef.current;
          if (el) el.setSelectionRange(res.selStart, res.selEnd);
        });
      };
      const setAlign = align => {
        const next = MO.setNodeAlign(treeRef.current, editingId, align);
        if (next !== treeRef.current) edit(next);
      };
      return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
        onMouseDown: e => e.preventDefault(),
        style: { display: "flex", alignItems: "center", gap: 2, flexWrap: "wrap", marginBottom: 4 }
      }, /*#__PURE__*/React.createElement("button", {
        onMouseDown: e => e.preventDefault(),
        onClick: () => applyFmt((t, s, e) => MO.wrapSelection(t, s, e, "**", "**", "teks")),
        title: "Bold", style: fmtBtn
      }, /*#__PURE__*/React.createElement("b", null, "B")), /*#__PURE__*/React.createElement("button", {
        onMouseDown: e => e.preventDefault(),
        onClick: () => applyFmt((t, s, e) => MO.wrapSelection(t, s, e, "*", "*", "teks")),
        title: "Italic", style: fmtBtn
      }, /*#__PURE__*/React.createElement("i", null, "I")), /*#__PURE__*/React.createElement("button", {
        onMouseDown: e => e.preventDefault(),
        onClick: () => applyFmt((t, s, e) => MO.wrapSelection(t, s, e, "<u>", "</u>", "teks")),
        title: "Underline", style: fmtBtn
      }, /*#__PURE__*/React.createElement("u", null, "U")), /*#__PURE__*/React.createElement("button", {
        onMouseDown: e => e.preventDefault(),
        onClick: () => applyFmt((t, s, e) => MO.wrapSelection(t, s, e, "~~", "~~", "teks")),
        title: "Coret", style: fmtBtn
      }, /*#__PURE__*/React.createElement("s", null, "S")), /*#__PURE__*/React.createElement("button", {
        onMouseDown: e => e.preventDefault(),
        onClick: () => applyFmt((t, s, e) => MO.wrapSelection(t, s, e, "__", "__", "sorot")),
        title: "Highlight", style: fmtBtn
      }, "✨"), /*#__PURE__*/React.createElement("button", {
        onMouseDown: e => e.preventDefault(),
        onClick: () => applyFmt((t, s, e) => MO.prefixLines(t, s, e, "# ", false)),
        title: "Heading", style: fmtBtn
      }, "H"), /*#__PURE__*/React.createElement("button", {
        onMouseDown: e => e.preventDefault(),
        onClick: () => applyFmt((t, s, e) => MO.wrapSelection(t, s, e, "`", "`", "kode")),
        title: "Inline code", style: fmtBtn
      }, "</>"), /*#__PURE__*/React.createElement("button", {
        onMouseDown: e => e.preventDefault(),
        onClick: () => applyFmt((t, s, e) => MO.wrapSelection(t, s, e, "[", "](https://)", "teks")),
        title: "Link", style: fmtBtn
      }, "🔗"), /*#__PURE__*/React.createElement("button", {
        onMouseDown: e => e.preventDefault(),
        onClick: () => applyFmt((t, s, e) => MO.insertBlock(t, s, e, "| Kolom 1 | Kolom 2 | Kolom 3 |\n| --- | --- | --- |\n| isi | isi | isi |")),
        title: "Tabel", style: fmtBtn
      }, "⊞"), /*#__PURE__*/React.createElement("button", {
        onMouseDown: e => e.preventDefault(),
        onClick: () => applyFmt((t, s, e) => MO.prefixLines(t, s, e, "- ", false)),
        title: "List •", style: fmtBtn
      }, "•"), /*#__PURE__*/React.createElement("button", {
        onMouseDown: e => e.preventDefault(),
        onClick: () => applyFmt((t, s, e) => MO.prefixLines(t, s, e, "", true)),
        title: "List angka", style: fmtBtn
      }, "1."), /*#__PURE__*/React.createElement("button", {
        onMouseDown: e => e.preventDefault(),
        onClick: () => applyFmt((t, s, e) => MO.insertBlock(t, s, e, "---")),
        title: "Garis pemisah", style: fmtBtn
      }, "─"), /*#__PURE__*/React.createElement("span", {
        style: { width: 1, height: 16, background: "var(--border)", margin: "0 4px", alignSelf: "center" }
      }), /*#__PURE__*/React.createElement("button", {
        onMouseDown: e => e.preventDefault(),
        onClick: () => setAlign("left"),
        title: "Rata kiri", style: fmtBtn
      }, "L"), /*#__PURE__*/React.createElement("button", {
        onMouseDown: e => e.preventDefault(),
        onClick: () => setAlign("center"),
        title: "Tengah", style: fmtBtn
      }, "C"), /*#__PURE__*/React.createElement("button", {
        onMouseDown: e => e.preventDefault(),
        onClick: () => setAlign("right"),
        title: "Rata kanan", style: fmtBtn
      }, "R"), /*#__PURE__*/React.createElement("button", {
        onMouseDown: e => e.preventDefault(),
        onClick: () => setAlign("justify"),
        title: "Rata penuh", style: fmtBtn
      }, "J")), /*#__PURE__*/React.createElement("textarea", {
        ref: editAreaRef,
        autoFocus: true,
        rows: 1,
        value: editVal,
        onChange: e => setEditVal(e.target.value),
        onInput: e => {
          // auto-grow to fit content (min 1 row, cap ~6 rows)
          const t = e.currentTarget;
          t.style.height = "auto";
          t.style.height = Math.min(t.scrollHeight, 110) + "px";
        },
        onKeyDown: e => {
          e.stopPropagation();
          // Enter commits; Shift+Enter inserts a newline (default) — same
          // semantics as the canvas editor (input-box, pre-wrap topics).
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            commitRename();
          }
          if (e.key === "Escape") {
            editingIdRef.current = null; // clear before focus() so the sync blur can't commit
            setEditingId(null);
            if (containerRef.current) containerRef.current.focus();
          }
        },
        onBlur: commitRename,
        onMouseDown: e => e.stopPropagation(),
        style: {
          flex: 1, fontSize: 13, fontFamily: "inherit", lineHeight: 1.4,
          padding: "2px 6px", borderRadius: 6, resize: "none",
          overflowY: "auto", whiteSpace: "pre-wrap", wordBreak: "break-word",
          border: "1px solid var(--accent)", background: "var(--bg-primary)",
          color: "var(--text-primary)", outline: "none",
          minHeight: 24, maxHeight: 110
        }
      }));
    }
```

- [ ] **Step 4: Add the `editAreaRef` and `fmtBtn`**

Find:

```js
  const [clipboard, setClipboard] = useState(null);
  const undoRef = useRef([]);
```

Insert after the clipboard line:

```js
  const editAreaRef = useRef(null);
```

Find (near `hovBtn`):

```js
  const hovBtn = {
```

Insert directly BEFORE it:

```js
  const fmtBtn = {
    border: "1px solid var(--border)", background: "var(--bg-card)", cursor: "pointer",
    fontSize: 12, color: "var(--text-primary)", borderRadius: 5, padding: "1px 7px",
    minWidth: 24, flexShrink: 0
  };
```

- [ ] **Step 5: Syntax check**

Run:

```bash
cd "Z:\Todolist Manager V5.0"
node -e "const s=require('fs').readFileSync('static/index.html','utf8'); const blocks=[...s.matchAll(/<script>([\s\S]*?)<\/script>/g)]; blocks.forEach((m,i)=>{ try{ new Function(m[1]); }catch(e){ console.log('BLOCK',i,'FAILS:',e.message); process.exitCode=1; } }); console.log('OK');"
```

Expected: `OK`.

- [ ] **Step 6: Commit**

```bash
git add static/index.html
git commit -m "feat(mindmap): outline markdown rows + inline formatting toolbar + row alignment

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 4: CSS + version bumps + full suite

**Files:**
- Modify: `static/app.css` (`.topic-md` markdown styles)
- Modify: `static/index.html` (iframe src `?v=122` → `?v=123`)
- Modify: `static/sw.js` (CACHE name)

**Interfaces:**
- Consumes: Tasks 1-3.

- [ ] **Step 1: Add `.topic-md` styles to `static/app.css`**

Append:

```css
/* Mindmap outline topic markdown */
.topic-md p { margin: 0; }
.topic-md ul, .topic-md ol { margin: 2px 0 2px 18px; padding: 0; }
.topic-md li { margin: 1px 0; }
.topic-md table { border-collapse: collapse; margin: 3px 0; font-size: 0.92em; }
.topic-md th, .topic-md td { border: 1px solid var(--border); padding: 2px 6px; }
.topic-md hr { border: none; border-top: 1px solid var(--border); margin: 5px 0; }
.topic-md code { background: var(--bg-primary); border: 1px solid var(--border); border-radius: 3px; padding: 0 4px; font-size: 0.9em; }
.topic-md a { color: var(--accent); }
.topic-md h1, .topic-md h2, .topic-md h3, .topic-md h4, .topic-md h5, .topic-md h6 { margin: 2px 0; font-weight: 700; }
.topic-md h1 { font-size: 1.3em; }
.topic-md h2 { font-size: 1.15em; }
.topic-md h3 { font-size: 1.05em; }
```

- [ ] **Step 2: Bump the iframe src**

In `static/index.html`, find:

```js
    src: "/static/vendor/mind-elixir/index.html?v=122",
```

Replace with:

```js
    src: "/static/vendor/mind-elixir/index.html?v=123",
```

- [ ] **Step 3: Bump the SW cache name**

In `static/sw.js`, find:

```js
const CACHE = "taskflow-v220-mindmap-outline-drag-guides";
```

Replace with:

```js
const CACHE = "taskflow-v221-mindmap-md";
```

- [ ] **Step 4: Run targeted tests**

Run: `node --test tests/offline/mindmapoutline.test.js`
Expected: all pass (previous 18 + 9 new = 27 — report real numbers).

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: ALL pass — previous total (370) + 9 new = 379 (report REAL summary lines; if an unrelated test fails, re-run it alone once to check flakiness).

- [ ] **Step 6: Commit**

```bash
git add static/app.css static/index.html static/sw.js
git commit -m "feat(mindmap): topic markdown CSS + version bumps for node text formatting

Co-Authored-By: Claude <noreply@anthropic.com>"
```

- [ ] **Step 7: Deploy gate (user action — do NOT push yourself)**

Ask the user to push. After deploy, verify live:

```bash
curl -s https://todo.yatno.web.id/static/sw.js | head -1                       # taskflow-v221-mindmap-md
curl -s https://todo.yatno.web.id/static/index.html | grep -o 'mind-elixir/index.html?v=[0-9]*' | head -1  # ?v=123
curl -s https://todo.yatno.web.id/static/vendor/mind-elixir/index.html | grep -c 'fmt-toolbar'              # >= 2
```

- [ ] **Step 8: Browser checklist (post-deploy)**

1. Canvas: node dengan `**tebal**` ter-render bold; edit (F2) → toolbar muncul; B/I/U/S/✨/H/code/link/table/•/1./─ bekerja dengan dan tanpa seleksi; align L/C/R/J menggeser teks node; hasil persist setelah reload.
2. Outline: baris render bold/italic/list/table; inline edit → toolbar muncul di atas textarea; insert bekerja; align baris ikut berubah.
3. Mindmap lama (tanpa markdown): tampil seperti biasa.
4. Search outline masih highlight + fallback teks polos.
5. Link di canvas bisa diklik (pointer-events).
6. Nol console error; tidak ada PUT storm.

- [ ] **Step 9: Update agent handover files (CLAUDE.md mandate)**

Update `.agents/CURRENT_STATE.md` and append to `.agents/SESSION_LOG.md` (Task / Changes / Files Modified / Status). Commit.

---

## Self-Review Notes (run by the plan author)

- Spec coverage: §2 formats → Task 1 renderer + tests; §3 shared renderer → Task 1 + Task 2 Step 1-2 + Task 3 Step 1; §4.1 canvas → Task 2 Steps 1-8; §4.2 outline → Task 3; §5 helpers → Task 1; §6 data/compat → Task 2 Step 7 (align pass) + Task 3 Step 2; §7 testing → Tasks 1/4 + Step 8 checklist; §8 files → Tasks 1-4.
- Placeholder scan: full code in every step; the one test that may need adjustment (plain-text `<p>` wrapping) has an explicit instruction.
- Type consistency: helper signatures `(text, start, end, ...)` used identically in module, canvas `FMT_ACTIONS`, outline `applyFmt`; `setNodeAlign(root, id, align)` consistent; `renderTopicMd(topic)` consistent; iframe version `?v=123` appears in exactly one place; SW name `taskflow-v221-mindmap-md` consistent.
