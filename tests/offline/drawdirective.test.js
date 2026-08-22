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
});
