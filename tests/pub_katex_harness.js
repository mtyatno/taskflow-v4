// Harness DOM tiruan (tanpa jsdom) untuk script KaTeX halaman publik; dipanggil tests/test_pub_xss.py.
// Pemakaian: node tests/pub_katex_harness.js <file-script-katex.js>. Keluar 0 bila semua asersi lolos.
'use strict';
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

class N {
  constructor(type, name, value) {
    this.nodeType = type; this.nodeName = name; this.nodeValue = value === undefined ? null : value;
    this.parentNode = null; this.childNodes = []; this.attrs = {};
  }
  appendChild(c) {
    if (c.nodeType === 11) { c.childNodes.slice().forEach((x) => this.appendChild(x)); c.childNodes = []; return c; }
    if (c.parentNode) c.parentNode.childNodes.splice(c.parentNode.childNodes.indexOf(c), 1);
    c.parentNode = this; this.childNodes.push(c); return c;
  }
  replaceChild(nw, old) {
    const i = this.childNodes.indexOf(old);
    assert.ok(i >= 0, 'replaceChild: old bukan anak');
    const items = nw.nodeType === 11 ? nw.childNodes.splice(0) : [nw];
    items.forEach((x) => { x.parentNode = this; });
    this.childNodes.splice(i, 1, ...items); old.parentNode = null; return old;
  }
  getAttribute(n) { return n in this.attrs ? this.attrs[n] : null; }
  get innerHTML() { throw new Error('innerHTML dibaca'); }
  set innerHTML(v) { throw new Error('innerHTML ditulis: ' + v); }
  get textContent() { return this.nodeType === 3 ? this.nodeValue : this.childNodes.map((c) => c.textContent).join(''); }
}
const el = (name, attrs, kids) => { const e = new N(1, name.toUpperCase()); Object.assign(e.attrs, attrs || {}); (kids || []).forEach((k) => e.appendChild(k)); return e; };
const tx = (v) => new N(3, '#text', v);

const ATTR_IMG = '$<img src=x onerror=alert(1)>';
const ATTR_A = '$<img src=x onerror=1>';
const p1 = el('p', {}, [tx('harga $5 '), el('img', { src: '/a.png', alt: ATTR_IMG }), tx(' total')]);
const p2 = el('p', {}, [el('a', { href: '/x', title: ATTR_A }, [tx('l')]), tx(' dan $x^2$ serta $$y$$ akhir')]);
const pre = el('pre', {}, [el('code', {}, [tx('$kode$')])]);
const p3 = el('p', {}, [tx('satu $ saja')]);
const body = el('div', { class: 'pub-body' }, [p1, p2, pre, p3]);

function textNodes(root) {
  const out = [];
  (function walk(n) { n.childNodes.forEach((c) => { if (c.nodeType === 3) out.push(c); else walk(c); }); })(root);
  return out;
}
const calls = [];
const ctx = {
  NodeFilter: { SHOW_TEXT: 4 },
  window: {},
  katex: {
    render(tex, target, opts) { calls.push([tex, opts.displayMode, target.nodeName]); target.appendChild(tx('K[' + tex + ']')); },
    renderToString() { throw new Error('renderToString dipakai'); },
  },
  document: {
    querySelector: (sel) => (sel === '.pub-body' ? body : null),
    createTreeWalker(root, what) {
      assert.strictEqual(what, 4);
      const list = textNodes(root); let i = -1;
      return { get currentNode() { return list[i]; }, nextNode() { i += 1; return i < list.length ? list[i] : null; } };
    },
    createDocumentFragment: () => new N(11, '#document-fragment'),
    createElement: (name) => el(name),
    createTextNode: tx,
  },
};
ctx.window.katex = ctx.katex;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(process.argv[2], 'utf8'), ctx);

assert.deepStrictEqual(calls, [['x^2', false, 'SPAN'], ['y', true, 'DIV']]);
// atribut tidak pernah disentuh
assert.strictEqual(p1.childNodes[1].attrs.alt, ATTR_IMG);
assert.strictEqual(p2.childNodes[0].attrs.title, ATTR_A);
// teks dengan satu $ di node-nya sendiri tetap utuh (tidak dipasangkan dengan $ di atribut/node lain)
assert.deepStrictEqual(p1.childNodes.map((c) => c.nodeName), ['#text', 'IMG', '#text']);
assert.strictEqual(p1.childNodes[0].nodeValue, 'harga $5 ');
assert.strictEqual(p3.textContent, 'satu $ saja');
// kode tidak dirender
assert.strictEqual(pre.textContent, '$kode$');
// math dipecah: teks / span / teks / div / teks
assert.deepStrictEqual(p2.childNodes.map((c) => c.nodeName), ['A', '#text', 'SPAN', '#text', 'DIV', '#text']);
assert.deepStrictEqual(p2.childNodes.slice(1).map((c) => c.textContent), [' dan ', 'K[x^2]', ' serta ', 'K[y]', ' akhir']);
console.log('katex harness OK');
