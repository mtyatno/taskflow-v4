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
});
