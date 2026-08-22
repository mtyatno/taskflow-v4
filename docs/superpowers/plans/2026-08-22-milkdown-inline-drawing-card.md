# Milkdown Inline Interactive Drawing Card Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement custom Milkdown Node and Remark Plugin so that inline drawing directives (`::draw[...]`) render as interactive visual cards (`.note-draw-card`) directly inside the note editor, complete with live SVG hydration, size pills, and direct canvas editing.

**Architecture:** A lightweight helper module `static/offline/drawdirective.js` parses and formats drawing directive AST tokens. Milkdown registers `drawingNode` and `drawingRemark` plugins using Milkdown's `$node` and `$remark` utilities, creating ProseMirror block atom nodes that render identical visual cards to the note viewer and serialize cleanly back to Markdown.

**Tech Stack:** JavaScript (ES6 / UMD), Milkdown v7 (ProseMirror & Remark MDAST), IndexedDB / SVG hydration.

## Global Constraints
- Must maintain 100% roundtrip Markdown compatibility (`::draw[id]{title="..." size="..." width="..."}`).
- Must work 100% offline using IndexedDB `window.TF.drawingrepo` cache.
- Service Worker cache must be bumped on every frontend release.
- All test suites must pass (433+ JS tests, 43 Pytest).

---

### Task 1: Drawing Directive Parser & Serializer Unit (TDD)

**Files:**
- Create: `static/offline/drawdirective.js`
- Create: `tests/offline/drawdirective.test.js`

**Interfaces:**
- Produces:
  - `TF.drawdirective.parseDirective(rawText)` ➔ `{ id, title, size, width, height }`
  - `TF.drawdirective.formatDirective(attrs)` ➔ `::draw[id]{title="..." size="..." width="..."}`
  - `TF.drawdirective.remarkDrawPlugin()` ➔ Remark MDAST transformer function

- [ ] **Step 1: Write failing unit test**

Create `tests/offline/drawdirective.test.js`:
```javascript
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { parseDirective, formatDirective, remarkDrawPlugin } = require('../../static/offline/drawdirective.js');

describe('Drawing Directive Module', () => {
  it('parses ::draw[id]{title="..." size="M"} directive correctly', () => {
    const raw = '::draw[canvas-123]{title="Diagram Alur" size="M" width="75%"}';
    const parsed = parseDirective(raw);
    assert.equal(parsed.id, 'canvas-123');
    assert.equal(parsed.title, 'Diagram Alur');
    assert.equal(parsed.size, 'M');
    assert.equal(parsed.width, '75%');
    assert.equal(parsed.height, '300px');
  });

  it('formats attributes back to canonical ::draw string', () => {
    const attrs = { id: 'canvas-123', title: 'Diagram Alur', size: 'S', width: '50%' };
    const str = formatDirective(attrs);
    assert.equal(str, '::draw[canvas-123]{title="Diagram Alur" size="S" width="50%"}');
  });

  it('remark transformer transforms text nodes containing ::draw into drawingDirective nodes', () => {
    const tree = {
      type: 'root',
      children: [
        {
          type: 'paragraph',
          children: [
            { type: 'text', value: 'Catatan awal\n\n::draw[abc-456]{title="Sketsa"}\n\nCatatan akhir' }
          ]
        }
      ]
    };
    const transformer = remarkDrawPlugin();
    transformer(tree);
    const p = tree.children[0];
    assert.equal(p.children.length, 3);
    assert.equal(p.children[0].value, 'Catatan awal\n\n');
    assert.equal(p.children[1].type, 'drawingDirective');
    assert.equal(p.children[1].id, 'abc-456');
    assert.equal(p.children[1].title, 'Sketsa');
    assert.equal(p.children[2].value, '\n\nCatatan akhir');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/offline/drawdirective.test.js`  
Expected: FAIL (`MODULE_NOT_FOUND` / cannot find module)

- [ ] **Step 3: Implement `static/offline/drawdirective.js`**

```javascript
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.TF = root.TF || {};
    root.TF.drawdirective = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const DRAW_REGEX = /\\?::draw\\?\[([0-9a-zA-Z_-]+)\\?\](?:\s*\\?\{([^}]*)\\?\})?/i;

  function parseAttributes(attrRaw) {
    const res = {};
    if (!attrRaw) return res;
    const re = /([a-zA-Z0-9_-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s,}]+))/g;
    let m;
    while ((m = re.exec(attrRaw)) !== null) {
      res[m[1]] = m[2] !== undefined ? m[2] : m[3] !== undefined ? m[3] : m[4];
    }
    return res;
  }

  function parseDirective(rawText) {
    const match = DRAW_REGEX.exec(rawText || '');
    if (!match) return null;
    const id = match[1];
    const attrs = parseAttributes(match[2]);
    const title = attrs.title || 'Gambar';
    const size = (attrs.size || (attrs.width === '40%' || attrs.width === '50%' || attrs.width === 'small' ? 'S' : attrs.width === '70%' || attrs.width === '75%' || attrs.width === 'medium' ? 'M' : 'L')).toUpperCase();
    const width = attrs.width || (size === 'S' ? '50%' : size === 'M' ? '75%' : '100%');
    const height = attrs.height || (size === 'S' ? '200px' : size === 'M' ? '300px' : '400px');
    return { id, title, size, width, height };
  }

  function formatDirective(attrs) {
    const id = attrs.id || '';
    const title = attrs.title || 'Gambar';
    const size = attrs.size || 'L';
    const width = attrs.width || (size === 'S' ? '50%' : size === 'M' ? '75%' : '100%');
    return `::draw[${id}]{title="${title}" size="${size}" width="${width}"}`;
  }

  function remarkDrawPlugin() {
    return function transformer(tree) {
      function walk(node) {
        if (!node || !node.children) return;
        const nextChildren = [];
        for (const child of node.children) {
          if (child.type === 'text' && child.value && DRAW_REGEX.test(child.value)) {
            let val = child.value;
            let m;
            while ((m = DRAW_REGEX.exec(val)) !== null) {
              const before = val.slice(0, m.index);
              if (before) nextChildren.push({ type: 'text', value: before });
              const parsed = parseDirective(m[0]);
              nextChildren.push({
                type: 'drawingDirective',
                id: parsed.id,
                title: parsed.title,
                size: parsed.size,
                width: parsed.width,
                height: parsed.height
              });
              val = val.slice(m.index + m[0].length);
              DRAW_REGEX.lastIndex = 0;
            }
            if (val) nextChildren.push({ type: 'text', value: val });
          } else {
            walk(child);
            nextChildren.push(child);
          }
        }
        node.children = nextChildren;
      }
      walk(tree);
    };
  }

  return { parseAttributes, parseDirective, formatDirective, remarkDrawPlugin, DRAW_REGEX };
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/offline/drawdirective.test.js`  
Expected: PASS (3/3 passing)

- [ ] **Step 5: Commit**

```bash
git add static/offline/drawdirective.js tests/offline/drawdirective.test.js
git commit -m "feat(drawing): add drawing directive parser and remark plugin unit"
```

---

### Task 2: Milkdown Drawing Node Schema & Registration

**Files:**
- Modify: `static/index.html` (Milkdown registration section around line 16680-16780)

**Interfaces:**
- Consumes: `TF.drawdirective.remarkDrawPlugin`, `TF.drawdirective.formatDirective`
- Produces: `MB.$node('drawing')`, `MB.$remark('drawing-remark')`

- [ ] **Step 1: Define `drawingNode` and `drawingRemark` in `static/index.html`**

In `static/index.html`, register the drawing schema:
```javascript
function createDrawingPlugin(MB) {
  if (!MB || !MB.$node) return [];
  const DD = window.TF && window.TF.drawdirective ? window.TF.drawdirective : null;
  if (!DD) return [];

  const drawingNode = MB.$node('drawing', () => ({
    group: 'block',
    atom: true,
    selectable: true,
    draggable: true,
    attrs: {
      id: { default: '' },
      title: { default: 'Gambar' },
      size: { default: 'L' },
      width: { default: '100%' },
      height: { default: '400px' }
    },
    toDOM: node => {
      const { id, title, size, width, height } = node.attrs;
      const widthVal = width || (size === 'S' ? '50%' : size === 'M' ? '75%' : '100%');
      const heightVal = height || (size === 'S' ? '200px' : size === 'M' ? '300px' : '400px');
      const cardWidthStyle = widthVal && widthVal !== '100%' ? `width:${widthVal};max-width:${widthVal};margin:10px auto;` : `width:100%;margin:10px 0;`;

      return ['div', {
        class: 'note-draw-card editor-draw-card',
        'data-drawing-id': id,
        'data-size': size,
        style: cardWidthStyle
      },
        ['div', { class: 'note-draw-header' },
          ['span', null, `🎨 ${title || 'Gambar'}`],
          ['div', { style: 'display:flex;gap:6px;align-items:center;' },
            ['div', { class: 'note-draw-size-pills' },
              ['button', { type: 'button', class: `note-draw-size-btn ${size === 'S' ? 'active' : ''}`, 'data-size-btn': 'S' }, 'S'],
              ['button', { type: 'button', class: `note-draw-size-btn ${size === 'M' ? 'active' : ''}`, 'data-size-btn': 'M' }, 'M'],
              ['button', { type: 'button', class: `note-draw-size-btn ${size === 'L' || size === 'FULL' ? 'active' : ''}`, 'data-size-btn': 'L' }, 'L']
            ],
            ['button', { type: 'button', class: 'btn btn-secondary btn-sm', 'data-action': 'edit', style: 'font-size:11px;padding:2px 8px;cursor:pointer;' }, '✏️ Edit'],
            ['button', { type: 'button', class: 'btn btn-secondary btn-sm', 'data-action': 'open', style: 'font-size:11px;padding:2px 8px;cursor:pointer;' }, '↗️ Buka']
          ]
        ],
        ['div', {
          class: 'note-draw-preview-container',
          'data-drawing-preview': id,
          style: `max-height:${heightVal};resize:vertical;overflow:auto;cursor:pointer;`,
          title: 'Klik untuk membuka / mengedit gambar'
        },
          ['div', { class: 'drawing-preview-placeholder', style: 'color:var(--text-light);font-size:12px;display:flex;align-items:center;gap:6px;' }, '🎨 Memuat gambar...']
        ]
      ];
    },
    parseDOM: [{
      tag: 'div.note-draw-card[data-drawing-id]',
      getAttrs: dom => ({
        id: dom.getAttribute('data-drawing-id') || '',
        size: dom.getAttribute('data-size') || 'L',
        title: dom.querySelector('.note-draw-header span')?.textContent?.replace(/^🎨\s*/, '') || 'Gambar'
      })
    }],
    parseMarkdown: {
      match: node => node.type === 'drawingDirective',
      runner: (state, node, type) => {
        state.addNode(type, {
          id: node.id,
          title: node.title,
          size: node.size,
          width: node.width,
          height: node.height
        });
      }
    },
    toMarkdown: {
      match: node => node.type.name === 'drawing',
      runner: (state, node) => {
        state.addNode('text', undefined, DD.formatDirective(node.attrs));
      }
    }
  }));

  const drawingRemark = MB.$remark('drawing-remark', () => DD.remarkDrawPlugin);
  return [drawingRemark, drawingNode];
}
```

- [ ] **Step 2: Add `createDrawingPlugin` to Milkdown editor instance plugins**

In `MilkdownEditor` initialization, add `...createDrawingPlugin(MB)`.

- [ ] **Step 3: Test syntax and build**

Run: `node --check static/index.html` (via inline extraction or browser script check).

- [ ] **Step 4: Commit**

```bash
git add static/index.html
git commit -m "feat(milkdown): register drawing node and remark plugin"
```

---

### Task 3: Editor SVG Hydration & Interactive Actions

**Files:**
- Modify: `static/index.html` (Inside `MilkdownEditor` and note modals)
- Modify: `static/app.css` (Style adjustments for `.editor-draw-card`)

**Interfaces:**
- Consumes: `window.TF.drawingrepo.get(id)`, `window.dispatchEvent`
- Produces: `hydrateEditorDrawings(editorRoot)`, click delegation for S/M/L size buttons & ✏️ Edit modal

- [ ] **Step 1: Implement SVG Hydration for Editor**

Add an effect in `MilkdownEditor`:
```javascript
function hydrateEditorDrawings(containerEl) {
  if (!containerEl) return;
  const cards = containerEl.querySelectorAll('.note-draw-card[data-drawing-id]');
  cards.forEach(async card => {
    const id = card.getAttribute('data-drawing-id');
    const preview = card.querySelector(`[data-drawing-preview="${id}"]`);
    if (!preview || preview.querySelector('svg')) return;

    try {
      let svg = null;
      if (window.TF && window.TF.drawingrepo) {
        const local = await window.TF.drawingrepo.get(id);
        if (local && local.svg_preview) svg = local.svg_preview;
      }
      if (!svg && window.api) {
        const res = await window.api.get('/api/drawings/' + id);
        if (res && res.svg_preview) svg = res.svg_preview;
      }
      if (svg) {
        preview.innerHTML = svg;
        const svgEl = preview.querySelector('svg');
        if (svgEl) {
          svgEl.style.width = '100%';
          svgEl.style.height = 'auto';
          svgEl.style.display = 'block';
        }
      } else {
        preview.innerHTML = '<div class="drawing-preview-placeholder" style="color:var(--text-light);font-size:12px;">🎨 Klik untuk membuka / mengedit gambar</div>';
      }
    } catch (e) {
      console.warn('Failed to hydrate drawing preview', id, e);
    }
  });
}
```

- [ ] **Step 2: Add Click Delegation & Event Synchronization**

In `MilkdownEditor`, handle card interactions:
1. Size Buttons (`[data-size-btn]`): Update ProseMirror node markup attributes (`size`, `width`, `height`).
2. Edit Button (`[data-action="edit"]`) & Preview Click: Dispatch `window.dispatchEvent(new CustomEvent('editDrawingModal', { detail: { id, title } }))`.
3. Open Button (`[data-action="open"]`): Dispatch `window.dispatchEvent(new CustomEvent('openDrawing', { detail: id }))`.
4. Listen to `editDrawingModal:saved` or `drawingSaved`: Re-hydrate preview for the updated drawing ID immediately.

- [ ] **Step 3: Verify CSS in `static/app.css`**

Ensure `.editor-draw-card` has user-select properties and smooth hover states.

- [ ] **Step 4: Run unit and integration checks**

Run: `node --test tests/offline/*.test.js`

- [ ] **Step 5: Commit**

```bash
git add static/index.html static/app.css
git commit -m "feat(milkdown): add svg hydration and interactive card actions in editor"
```

---

### Task 4: Service Worker Cache Bump & Final Verification

**Files:**
- Modify: `static/sw.js`

- [ ] **Step 1: Register script and bump Service Worker cache**

In `static/sw.js`:
- Add `"/static/offline/drawdirective.js"` to `STATIC` pre-cache array.
- Bump `CACHE` to `"taskflow-v283-milkdown-inline-draw-card"`.

In `static/index.html`:
- Include `<script src="/static/offline/drawdirective.js"></script>` in `<head>`.

- [ ] **Step 2: Run full test suite**

Run:
```bash
node --test tests/offline/*.test.js
python -m pytest tests/
node --check static/sw.js
node --check static/offline/drawdirective.js
```
Expected: ALL PASS with 0 failures.

- [ ] **Step 3: Commit**

```bash
git add static/sw.js static/index.html
git commit -m "chore: bump service worker cache to v283 for inline draw card"
```
