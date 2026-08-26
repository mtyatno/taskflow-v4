const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { parseDirective, formatDirective, remarkDrawPlugin, parseAttributes, DRAW_REGEX } = require('../../static/offline/drawdirective.js');

describe('Drawing Directive Module', () => {
  it('parses attributes with quotes and without quotes', () => {
    const res = parseAttributes('title="Arsitektur Sistem" size=\'M\' width=75%');
    assert.equal(res.title, 'Arsitektur Sistem');
    assert.equal(res.size, 'M');
    assert.equal(res.width, '75%');
  });

  it('parses empty or missing attribute string safely', () => {
    assert.deepEqual(parseAttributes(''), {});
    assert.deepEqual(parseAttributes(null), {});
    assert.deepEqual(parseAttributes(undefined), {});
  });

  it('parses ::draw[id]{title="..." size="M"} directive correctly', () => {
    const raw = '::draw[canvas-123]{title="Diagram Alur" size="M" width="75%"}';
    const parsed = parseDirective(raw);
    assert.equal(parsed.id, 'canvas-123');
    assert.equal(parsed.title, 'Diagram Alur');
    assert.equal(parsed.size, 'M');
    assert.equal(parsed.width, '75%');
    assert.equal(parsed.height, '300px');
  });

  it('parses directive with defaults when attributes omitted', () => {
    const raw = '::draw[canvas-default]';
    const parsed = parseDirective(raw);
    assert.equal(parsed.id, 'canvas-default');
    assert.equal(parsed.title, 'Gambar');
    assert.equal(parsed.size, 'L');
    assert.equal(parsed.width, '100%');
    assert.equal(parsed.height, '400px');
  });

  it('parses directive with escaped brackets from markdown serializer', () => {
    const raw = '\\::draw\\[canvas-escaped\\]\\{title="Escaped"\\}';
    const parsed = parseDirective(raw);
    assert.equal(parsed.id, 'canvas-escaped');
    assert.equal(parsed.title, 'Escaped');
  });

  it('formats attributes back to canonical ::draw string', () => {
    const attrs = { id: 'canvas-123', title: 'Diagram Alur', size: 'S', width: '50%' };
    const str = formatDirective(attrs);
    assert.equal(str, '::draw[canvas-123]{title="Diagram Alur" size="S" width="50%"}');
  });

  it('formats attributes with fallback defaults', () => {
    const attrs = { id: 'canvas-simple' };
    const str = formatDirective(attrs);
    assert.equal(str, '::draw[canvas-simple]{title="Gambar" size="L" width="100%"}');
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
    assert.equal(p.children[1].size, 'L');
    assert.equal(p.children[1].width, '100%');
    assert.equal(p.children[1].height, '400px');
    assert.equal(p.children[2].value, '\n\nCatatan akhir');
  });

  it('remark transformer handles multiple ::draw directives in a single text node', () => {
    const tree = {
      type: 'root',
      children: [
        {
          type: 'paragraph',
          children: [
            { type: 'text', value: 'First: ::draw[id-1]{title="One"} and Second: ::draw[id-2]{title="Two"} done.' }
          ]
        }
      ]
    };
    const transformer = remarkDrawPlugin();
    transformer(tree);
    const p = tree.children[0];
    assert.equal(p.children.length, 5);
    assert.equal(p.children[0].value, 'First: ');
    assert.equal(p.children[1].id, 'id-1');
    assert.equal(p.children[2].value, ' and Second: ');
    assert.equal(p.children[3].id, 'id-2');
    assert.equal(p.children[4].value, ' done.');
  });

  it('remark transformer handles directive inside nested tree structures (e.g. blockquote / list)', () => {
    const tree = {
      type: 'root',
      children: [
        {
          type: 'blockquote',
          children: [
            {
              type: 'paragraph',
              children: [
                { type: 'text', value: '::draw[nested-1]{title="Nested Drawing"}' }
              ]
            }
          ]
        }
      ]
    };
    const transformer = remarkDrawPlugin();
    transformer(tree);
    const p = tree.children[0].children[0];
    assert.equal(p.children.length, 1);
    assert.equal(p.children[0].type, 'drawingDirective');
    assert.equal(p.children[0].id, 'nested-1');
    assert.equal(p.children[0].title, 'Nested Drawing');
  });

  it('remark transformer leaves unaffected text nodes untouched', () => {
    const tree = {
      type: 'root',
      children: [
        {
          type: 'paragraph',
          children: [
            { type: 'text', value: 'Just ordinary markdown text without draw directive' }
          ]
        }
      ]
    };
    const transformer = remarkDrawPlugin();
    transformer(tree);
    assert.equal(tree.children[0].children.length, 1);
    assert.equal(tree.children[0].children[0].value, 'Just ordinary markdown text without draw directive');
  });

  it('remark transformer handles empty tree and nodes without text/children gracefully', () => {
    const emptyTree = { type: 'root', children: [] };
    const transformer = remarkDrawPlugin();
    transformer(emptyTree);
    assert.deepEqual(emptyTree.children, []);

    const nonTextTree = {
      type: 'root',
      children: [
        { type: 'thematicBreak' },
        { type: 'code', lang: 'javascript', value: 'const x = 1;' }
      ]
    };
    transformer(nonTextTree);
    assert.equal(nonTextTree.children.length, 2);
    assert.equal(nonTextTree.children[0].type, 'thematicBreak');
    assert.equal(nonTextTree.children[1].type, 'code');
  });

  it('remark transformer handles mixed markdown structure (headings, lists, bold, blockquotes, and draw directives)', () => {
    const tree = {
      type: 'root',
      children: [
        {
          type: 'heading',
          depth: 2,
          children: [{ type: 'text', value: 'Dokumen Proyek' }]
        },
        {
          type: 'paragraph',
          children: [
            { type: 'text', value: 'Pengantar dokumen dengan diagram berikut:' },
            { type: 'break' }
          ]
        },
        {
          type: 'paragraph',
          children: [
            { type: 'text', value: '::draw[arch-001]{title="Arsitektur Utama" size="M" width="75%"}' }
          ]
        },
        {
          type: 'list',
          ordered: false,
          children: [
            {
              type: 'listItem',
              children: [
                {
                  type: 'paragraph',
                  children: [
                    { type: 'text', value: 'Item 1 dengan kanvas: ' },
                    { type: 'text', value: '::draw[item-002]{title="Sub Diagram" size="S" width="50%"}' }
                  ]
                }
              ]
            },
            {
              type: 'listItem',
              children: [
                {
                  type: 'paragraph',
                  children: [
                    { type: 'text', value: 'Item 2 teks biasa' }
                  ]
                }
              ]
            }
          ]
        },
        {
          type: 'blockquote',
          children: [
            {
              type: 'paragraph',
              children: [
                { type: 'text', value: 'Catatan penting: ::draw[note-003]{title="Flowchart" size="L" width="100%"} - harap ditinjau.' }
              ]
            }
          ]
        }
      ]
    };

    const transformer = remarkDrawPlugin();
    transformer(tree);

    // Heading untouched
    assert.equal(tree.children[0].type, 'heading');
    assert.equal(tree.children[0].children[0].value, 'Dokumen Proyek');

    // Standalone draw directive paragraph
    const drawP = tree.children[2];
    assert.equal(drawP.children.length, 1);
    assert.equal(drawP.children[0].type, 'drawingDirective');
    assert.equal(drawP.children[0].id, 'arch-001');
    assert.equal(drawP.children[0].title, 'Arsitektur Utama');
    assert.equal(drawP.children[0].size, 'M');
    assert.equal(drawP.children[0].width, '75%');
    assert.equal(drawP.children[0].height, '300px');

    // List item containing draw directive
    const listItemP = tree.children[3].children[0].children[0];
    assert.equal(listItemP.children.length, 2);
    assert.equal(listItemP.children[0].value, 'Item 1 dengan kanvas: ');
    assert.equal(listItemP.children[1].type, 'drawingDirective');
    assert.equal(listItemP.children[1].id, 'item-002');
    assert.equal(listItemP.children[1].title, 'Sub Diagram');
    assert.equal(listItemP.children[1].size, 'S');
    assert.equal(listItemP.children[1].width, '50%');
    assert.equal(listItemP.children[1].height, '200px');

    // Blockquote containing draw directive with prefix and suffix text
    const bqP = tree.children[4].children[0];
    assert.equal(bqP.children.length, 3);
    assert.equal(bqP.children[0].value, 'Catatan penting: ');
    assert.equal(bqP.children[1].type, 'drawingDirective');
    assert.equal(bqP.children[1].id, 'note-003');
    assert.equal(bqP.children[1].title, 'Flowchart');
    assert.equal(bqP.children[1].size, 'L');
    assert.equal(bqP.children[2].value, ' - harap ditinjau.');
  });

  describe('DOMOutputSpec Safety for Milkdown / ProseMirror Drawing Node', () => {
    function generateDrawingToDOM(nodeAttrs) {
      const { id = '', title = 'Gambar', size = 'L', width = '100%', height = '400px' } = nodeAttrs;
      const widthVal = width || (size === 'S' ? '50%' : size === 'M' ? '75%' : '100%');
      const heightVal = height || (size === 'S' ? '200px' : size === 'M' ? '300px' : '400px');
      const cardWidthStyle = widthVal && widthVal !== '100%' ? `display:block;width:${widthVal};max-width:${widthVal};margin:10px auto;` : `display:block;width:100%;margin:10px 0;`;

      return ['span', {
        class: 'note-draw-card editor-draw-card',
        'data-drawing-id': id,
        'data-size': size,
        style: cardWidthStyle
      },
        ['span', { class: 'note-draw-header', style: 'display:flex;' },
          ['span', { class: 'note-draw-title' }, `🎨 ${title || 'Gambar'}`],
          ['span', { style: 'display:flex;gap:6px;align-items:center;' },
            ['span', { class: 'note-draw-size-pills', style: 'display:inline-flex;' },
              ['button', { type: 'button', class: `note-draw-size-btn ${size === 'S' ? 'active' : ''}`, 'data-size-btn': 'S' }, 'S'],
              ['button', { type: 'button', class: `note-draw-size-btn ${size === 'M' ? 'active' : ''}`, 'data-size-btn': 'M' }, 'M'],
              ['button', { type: 'button', class: `note-draw-size-btn ${size === 'L' || size === 'FULL' ? 'active' : ''}`, 'data-size-btn': 'L' }, 'L']
            ],
            ['button', { type: 'button', class: 'btn btn-secondary btn-sm', 'data-action': 'edit', style: 'font-size:11px;padding:2px 8px;cursor:pointer;' }, '✏️ Edit'],
            ['button', { type: 'button', class: 'btn btn-secondary btn-sm', 'data-action': 'open', style: 'font-size:11px;padding:2px 8px;cursor:pointer;' }, '↗️ Buka']
          ]
        ],
        ['span', {
          class: 'note-draw-preview-container',
          'data-drawing-preview': id,
          style: `display:flex;max-height:${heightVal};resize:vertical;overflow:auto;cursor:pointer;`,
          title: 'Klik untuk membuka / mengedit gambar'
        },
          ['span', { class: 'drawing-preview-placeholder', style: 'color:var(--text-light);font-size:12px;display:flex;align-items:center;gap:6px;' }, '🎨 Memuat gambar...']
        ]
      ];
    }

    function assertDOMOutputSpecSafe(spec) {
      if (typeof spec === 'string') return;
      assert.ok(Array.isArray(spec), 'Spec must be array or string');
      assert.ok(typeof spec[0] === 'string', 'Tag name must be string');
      let startIdx = 1;
      if (spec.length > 1) {
        const second = spec[1];
        assert.notEqual(second, null, `Array element [1] for <${spec[0]}> must not be null in DOMOutputSpec`);
        if (typeof second === 'object' && !Array.isArray(second)) {
          startIdx = 2;
        }
      }
      for (let i = startIdx; i < spec.length; i++) {
        const child = spec[i];
        assert.notEqual(child, null, `Child element at index ${i} in <${spec[0]}> must not be null`);
        if (Array.isArray(child)) {
          assertDOMOutputSpecSafe(child);
        }
      }
    }

    // Emulates ProseMirror DOMSerializer.renderSpec algorithm
    function mockProseMirrorRenderSpec(spec) {
      if (typeof spec === 'string') return { type: 'text', text: spec };
      if (!Array.isArray(spec)) throw new TypeError('Invalid spec');
      const tag = spec[0];
      let attrs = null;
      let start = 1;
      if (spec.length > 1 && spec[1] && typeof spec[1] === 'object' && !Array.isArray(spec[1])) {
        attrs = spec[1];
        start = 2;
      }
      const children = [];
      for (let i = start; i < spec.length; i++) {
        const child = spec[i];
        if (child === null || child === undefined) {
          throw new TypeError("Failed to execute 'appendChild' on 'Node': parameter 1 is not of type 'Node'.");
        }
        if (typeof child === 'string') {
          children.push({ type: 'text', text: child });
        } else if (Array.isArray(child)) {
          children.push(mockProseMirrorRenderSpec(child));
        }
      }
      return { tag, attrs, children };
    }

    it('verifies drawingNode toDOM output has valid object attributes on every level (no null attributes)', () => {
      const testCases = [
        { id: 'draw-1', title: 'Diagram Flow', size: 'M', width: '75%', height: '300px' },
        { id: 'draw-2', title: '', size: 'S', width: '50%', height: '200px' },
        { id: 'draw-3', title: 'Special 🎨 Symbols', size: 'L', width: '100%', height: '400px' }
      ];

      for (const tc of testCases) {
        const domSpec = generateDrawingToDOM(tc);
        assertDOMOutputSpecSafe(domSpec);
        const rendered = mockProseMirrorRenderSpec(domSpec);
        assert.equal(rendered.tag, 'span');
        assert.equal(rendered.attrs.class, 'note-draw-card editor-draw-card');
        assert.equal(rendered.attrs['data-drawing-id'], tc.id);

        // Header and title check
        const header = rendered.children[0];
        assert.equal(header.tag, 'span');
        assert.equal(header.attrs.class, 'note-draw-header');
        const titleSpan = header.children[0];
        assert.equal(titleSpan.tag, 'span');
        assert.deepEqual(titleSpan.attrs, { class: 'note-draw-title' });
        assert.equal(titleSpan.children[0].text, `🎨 ${tc.title || 'Gambar'}`);
      }
    });

    it('catches TypeError if null attribute is reintroduced to DOMOutputSpec', () => {
      const buggySpec = ['span', { class: 'card' },
        ['span', { class: 'header' },
          ['span', null, '🎨 Title']
        ]
      ];
      assert.throws(() => {
        mockProseMirrorRenderSpec(buggySpec);
      }, {
        name: 'TypeError',
        message: /Failed to execute 'appendChild' on 'Node'/
      });
    });
  });

  describe('NoteModal, NoteViewerModal (NotePanel), and TaskFormModal Bottom Canvas Removal Verification', () => {
    const fs = require('fs');
    const path = require('path');
    const indexPath = path.resolve(__dirname, '../../static/index.html');
    const indexHtml = fs.readFileSync(indexPath, 'utf8');

    // Extract component sources
    const noteModalMatch = indexHtml.match(/function NoteModal\([\s\S]*?\nfunction NotePanel\(/);
    const noteModalSource = noteModalMatch ? noteModalMatch[0] : '';

    const notePanelMatch = indexHtml.match(/function NotePanel\([\s\S]*?\nfunction NotesPage\(/);
    const notePanelSource = notePanelMatch ? notePanelMatch[0] : '';

    const taskFormModalMatch = indexHtml.match(/function TaskFormModal\([\s\S]*?\nfunction TaskDetailModal\(/);
    const taskFormModalSource = taskFormModalMatch ? taskFormModalMatch[0] : '';

    it('verifies NoteModal cleanly removes bottom canvas state, effects, and JSX', () => {
      assert.ok(noteModalSource.length > 0, 'NoteModal component must be found in static/index.html');

      // State and refs removal
      assert.doesNotMatch(noteModalSource, /canvasNoteId/, 'NoteModal should not contain canvasNoteId');
      assert.doesNotMatch(noteModalSource, /drawIframeRef/, 'NoteModal should not contain drawIframeRef');
      assert.doesNotMatch(noteModalSource, /drawActive/, 'NoteModal should not contain drawActive');
      assert.doesNotMatch(noteModalSource, /drawContainerRef/, 'NoteModal should not contain drawContainerRef');
      assert.doesNotMatch(noteModalSource, /drawFullscreen/, 'NoteModal should not contain drawFullscreen');
      assert.doesNotMatch(noteModalSource, /drawSyncStatus/, 'NoteModal should not contain drawSyncStatus');
      assert.doesNotMatch(noteModalSource, /drawIframeReady/, 'NoteModal should not contain drawIframeReady');
      assert.doesNotMatch(noteModalSource, /drawPendingData/, 'NoteModal should not contain drawPendingData');

      // Iframe and accordion JSX removal
      assert.doesNotMatch(noteModalSource, /tldraw\/index\.html/, 'NoteModal should not contain tldraw iframe');
      assert.doesNotMatch(noteModalSource, /\\u270F\\uFE0F Canvas/, 'NoteModal should not contain Canvas accordion button');
      assert.doesNotMatch(noteModalSource, /Klik untuk menggambar/, 'NoteModal should not contain drawing placeholder');
    });

    it('verifies NoteViewerModal (NotePanel) cleanly removes bottom canvas state, effects, and JSX', () => {
      assert.ok(notePanelSource.length > 0, 'NotePanel component must be found in static/index.html');

      // State and refs removal
      assert.doesNotMatch(notePanelSource, /canvasActive/, 'NotePanel should not contain canvasActive');
      assert.doesNotMatch(notePanelSource, /canvasContainerRef/, 'NotePanel should not contain canvasContainerRef');
      assert.doesNotMatch(notePanelSource, /iframeReady/, 'NotePanel should not contain iframeReady');
      assert.doesNotMatch(notePanelSource, /pendingDrawData/, 'NotePanel should not contain pendingDrawData');
      assert.doesNotMatch(notePanelSource, /drawFullscreen/, 'NotePanel should not contain drawFullscreen');
      assert.doesNotMatch(notePanelSource, /syncStatus/, 'NotePanel should not contain syncStatus');
      assert.doesNotMatch(notePanelSource, /drawOpen/, 'NotePanel should not contain drawOpen');

      // Iframe and accordion JSX removal
      assert.doesNotMatch(notePanelSource, /tldraw\/index\.html/, 'NotePanel should not contain tldraw iframe');
      assert.doesNotMatch(notePanelSource, /\\u270F\\uFE0F Canvas/, 'NotePanel should not contain Canvas accordion button');
      assert.doesNotMatch(notePanelSource, /Klik untuk menggambar/, 'NotePanel should not contain drawing placeholder');
    });

    it('verifies TaskFormModal cleanly removes bottom canvas state, iframe, and accordion JSX', () => {
      assert.ok(taskFormModalSource.length > 0, 'TaskFormModal component must be found in static/index.html');

      // State and refs removal
      assert.doesNotMatch(taskFormModalSource, /noteCanvasId/, 'TaskFormModal should not contain noteCanvasId');
      assert.doesNotMatch(taskFormModalSource, /noteDrawIframeRef/, 'TaskFormModal should not contain noteDrawIframeRef');
      assert.doesNotMatch(taskFormModalSource, /noteDrawOpen/, 'TaskFormModal should not contain noteDrawOpen');
      assert.doesNotMatch(taskFormModalSource, /noteDrawFullscreen/, 'TaskFormModal should not contain noteDrawFullscreen');
      assert.doesNotMatch(taskFormModalSource, /noteDrawIframeReady/, 'TaskFormModal should not contain noteDrawIframeReady');

      // Iframe and accordion JSX removal
      assert.doesNotMatch(taskFormModalSource, /tldraw\/index\.html/, 'TaskFormModal should not contain tldraw iframe');
      assert.doesNotMatch(taskFormModalSource, /✏️ Canvas/, 'TaskFormModal should not contain Canvas accordion button');
      assert.doesNotMatch(taskFormModalSource, /Simpan note untuk sync drawing ke server/, 'TaskFormModal should not contain drawing helper text');
    });

    it('verifies NotePanel retains changeDrawingSize listener and hydrateDrawingPreviews effect for inline drawings', () => {
      assert.match(notePanelSource, /window\.addEventListener\(['"]changeDrawingSize['"]/, 'NotePanel must keep changeDrawingSize listener');
      assert.match(notePanelSource, /window\.hydrateDrawingPreviews/, 'NotePanel must keep hydrateDrawingPreviews call');
    });

    it('verifies TaskFormModal renders DrawingInsertModal and QuickDrawModal in mode === "note" branch', () => {
      assert.ok(taskFormModalSource.length > 0, 'TaskFormModal component must be found in static/index.html');
      const noteBranchMatch = taskFormModalSource.match(/if\s*\(\s*mode\s*===\s*["']note["']\s*\)\s*\{([\s\S]*?)\}\s*return\s+\/\*#__PURE__\*\/React\.createElement/);
      assert.ok(noteBranchMatch, 'Note branch in TaskFormModal must be found');
      const noteBranchCode = noteBranchMatch[1];
      assert.match(noteBranchCode, /noteDrawingInsertOpen\s*&&\s*\/\*#__PURE__\*\/React\.createElement\(DrawingInsertModal/, 'Note mode return fragment must include DrawingInsertModal');
      assert.match(noteBranchCode, /noteQuickDrawState\s*&&\s*\/\*#__PURE__\*\/React\.createElement\(QuickDrawModal/, 'Note mode return fragment must include QuickDrawModal');
    });

    it('verifies QuickDrawModal and DrawingsPage drawing features are preserved intact', () => {
      // QuickDrawModal (inline drawing editor modal) should retain its tldraw iframe
      assert.match(indexHtml, /function QuickDrawModal[\s\S]*?tldraw\/index\.html\?noteId=\$\{drawingId\}/, 'QuickDrawModal must preserve tldraw iframe');

      // DrawingsPage / DrawingTabInstance should retain its tldraw iframe
      assert.match(indexHtml, /tldraw\/index\.html\?noteId=\$\{tab\.id\}/, 'DrawingsPage tab instance must preserve tldraw iframe');
    });
  });

  describe('Inline Drawing Preview SVG Parsing and XML Header Acceptance', () => {
    function isValidSvg(svg) {
      return Boolean(svg && (svg.includes('<svg') || svg.trim().startsWith('<svg')));
    }

    it('accepts standard <svg> string', () => {
      const svg = '<svg width="100" height="100"><circle cx="50" cy="50" r="40" fill="red" /></svg>';
      assert.equal(isValidSvg(svg), true);
    });

    it('accepts XML-prefixed <?xml version="1.0" encoding="utf-8"?> SVG output from tldraw', () => {
      const xmlSvg = '<?xml version="1.0" encoding="utf-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 500 300"><path d="M10 10 L50 50" /></svg>';
      assert.equal(isValidSvg(xmlSvg), true);
      assert.equal(xmlSvg.trim().startsWith('<svg'), false, 'XML-prefixed SVG does not start with <svg');
    });

    it('rejects invalid or empty non-SVG string', () => {
      assert.equal(isValidSvg(''), false);
      assert.equal(isValidSvg(null), false);
      assert.equal(isValidSvg(undefined), false);
      assert.equal(isValidSvg('<div>Not an SVG</div>'), false);
    });

    it('verifies static/index.html includes all 6 preview hydration and XML fixes', () => {
      const fs = require('fs');
      const path = require('path');
      const indexHtml = fs.readFileSync(path.resolve(__dirname, '../../static/index.html'), 'utf8');

      // 1. hydrateDrawingPreviews includes('<svg')
      assert.match(indexHtml, /if\s*\(\s*svg\s*&&\s*\(svg\.includes\(['"]<svg['"]\)\s*\|\|\s*svg\.trim\(\)\.startsWith\(['"]<svg['"]\)\)/);

      // 2. _lastSavedDrawingSvg declaration and dual check
      assert.match(indexHtml, /const\s+_lastSavedDrawingSvg\s*=\s*\{\};/);
      assert.match(indexHtml, /_lastSavedDrawingJson\[did\]\s*===\s*e\.data\.data\s*&&\s*_lastSavedDrawingSvg\[did\]\s*===\s*newSvg/);

      // 3. MilkdownEditor drawingSaved listener
      assert.match(indexHtml, /window\.addEventListener\(['"]drawingSaved['"],\s*hydrate\)/);

      // 4. NotePanel drawingSaved listener
      assert.match(indexHtml, /window\.addEventListener\(["']drawingSaved["'],\s*handler\)/);

      // 5. QuickDrawModal immediate + delayed hydration
      assert.match(indexHtml, /const handleClose = \(\) => \{[\s\S]*?hydrateDrawingPreviews\(null,\s*true\)[\s\S]*?setTimeout\(/);

      // 6. handlePrint and handleExportDocx includes('<svg')
      assert.match(indexHtml, /d\.svg_preview\.includes\(['"]<svg['"]\)/);
    });
  });
});
