const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  MEDIA_REGEX, MEDIA_EXTS, parseMediaDirective, formatMediaDirective,
  newClientId, isMediaFileName, remarkMediaPlugin,
} = require('../../static/offline/mediadirective.js');

describe('Media Directive Module', () => {
  it('parse direktif biasa dan ter-escape remark', () => {
    assert.deepEqual(parseMediaDirective('::media[abc-1]{name="rapat.m4a"}'), { cid: 'abc-1', name: 'rapat.m4a' });
    assert.deepEqual(parseMediaDirective('\\::media\\[abc\\]\\{name="x"\\}'), { cid: 'abc', name: 'x' });
    assert.deepEqual(parseMediaDirective('::media[abc]'), { cid: 'abc', name: '' });
    assert.equal(parseMediaDirective('::media[a/b]'), null);
    assert.equal(parseMediaDirective('::media[' + 'a'.repeat(65) + ']'), null);
    assert.equal(parseMediaDirective(''), null);
    assert.equal(parseMediaDirective(null), null);
  });

  it('parse memberi kecocokan pertama dan tidak terpengaruh state regex global', () => {
    const t = 'a ::media[one]{name="1.mp3"} b ::media[two]';
    assert.equal(parseMediaDirective(t).cid, 'one');
    assert.equal(parseMediaDirective(t).cid, 'one');
    assert.ok(MEDIA_REGEX.global && MEDIA_REGEX.ignoreCase);
  });

  it('format -> parse bolak-balik, kutip & backslash', () => {
    const s = formatMediaDirective({ cid: 'c1', name: 'a "b" \\ c.mp3' });
    assert.equal(s, '::media[c1]{name="a \\"b\\" \\\\ c.mp3"}');
    assert.deepEqual(parseMediaDirective(s), { cid: 'c1', name: 'a "b" \\ c.mp3' });
  });

  it('escape markdown dari editor (remark-stringify: \\_ \\* \\# ...) dibuang dari nama', () => {
    // Isi yang disimpan editor Milkdown: ::media\[cid]{name="klip\_uji \*1\*.mp4"}
    assert.deepEqual(parseMediaDirective('::media\\[c3]{name="klip\\_uji \\*1\\*.mp4"}'), { cid: 'c3', name: 'klip_uji *1*.mp4' });
  });

  it('nama dengan } atau baris baru tidak merusak direktif', () => {
    const s = formatMediaDirective({ cid: 'c2', name: 'a}b\nc.mp3' });
    assert.equal(parseMediaDirective(s).cid, 'c2');
    assert.ok(!/\n/.test(s));
  });

  it('atribut lain diabaikan', () => {
    assert.deepEqual(parseMediaDirective('::media[x1]{name="x" onerror=alert(1)}'), { cid: 'x1', name: 'x' });
    assert.deepEqual(parseMediaDirective('::media[x1]{onerror="alert(1)"}'), { cid: 'x1', name: '' });
  });

  it('newClientId valid untuk regex direktif dan unik', () => {
    const a = newClientId(), b = newClientId();
    assert.match(a, /^[0-9a-zA-Z_-]{1,64}$/);
    assert.notEqual(a, b);
  });

  it('isMediaFileName', () => {
    assert.equal(isMediaFileName('A.MP4'), true);
    assert.equal(isMediaFileName('rapat.m4a'), true);
    assert.equal(isMediaFileName('x.pdf'), false);
    assert.equal(isMediaFileName('mp3'), false);
    assert.equal(isMediaFileName(''), false);
    assert.equal(isMediaFileName(null), false);
    assert.deepEqual(MEDIA_EXTS, 'mp3 m4a m4b aac wav ogg oga opus webm flac amr 3gp 3g2 mp4 m4v mov mkv'.split(' '));
  });

  it('remarkMediaPlugin memecah teks jadi node mediaDirective', () => {
    const tree = { type: 'root', children: [{ type: 'paragraph', children: [
      { type: 'text', value: 'sebelum ::media[m1]{name="a.mp3"} tengah \\::media\\[m2\\] akhir' },
    ] }] };
    remarkMediaPlugin()(tree);
    const kids = tree.children[0].children;
    assert.deepEqual(kids.map(k => k.type), ['text', 'mediaDirective', 'text', 'mediaDirective', 'text']);
    assert.deepEqual({ cid: kids[1].cid, name: kids[1].name }, { cid: 'm1', name: 'a.mp3' });
    assert.deepEqual({ cid: kids[3].cid, name: kids[3].name }, { cid: 'm2', name: '' });
    assert.equal(kids[0].value, 'sebelum ');
    assert.equal(kids[4].value, ' akhir');
  });

  it('index.html memuat script & sw.js mem-precache mediadirective.js', () => {
    const html = fs.readFileSync(path.resolve(__dirname, '../../static/index.html'), 'utf8');
    const sw = fs.readFileSync(path.resolve(__dirname, '../../static/sw.js'), 'utf8');
    assert.match(html, /<script src="\/static\/offline\/mediadirective\.js"><\/script>/);
    assert.match(sw, /"\/static\/offline\/mediadirective\.js"/);
  });
});

// ── fix wave item 2: nama dengan karakter markdown (remark memecah teks sebelum plugin berjalan) ──
describe('remarkMediaPlugin: atribut terpecah oleh konstruksi markdown', () => {
  const pos = (s, e) => ({ start: { offset: s }, end: { offset: e } });
  // Pohon meniru keluaran remark untuk sumber `src` (diverifikasi dengan bundle Milkdown asli).
  function run(src, children) {
    const tree = { type: 'root', children: [{ type: 'paragraph', children }] };
    remarkMediaPlugin()(tree, { value: src, toString() { return src; } });
    return tree.children[0].children;
  }
  const dirs = (ch) => ch.filter((n) => n.type === 'mediaDirective').map((n) => ({ cid: n.cid, name: n.name }));
  const rest = (ch) => ch.filter((n) => n.type !== 'mediaDirective');

  it('emphasis _x_ di dalam name', () => {
    const src = '::media[c1]{name="rapat _final_.mp4"}';
    const i = src.indexOf('_final_');
    const ch = run(src, [
      { type: 'text', value: '::media[c1]{name="rapat ', position: pos(0, i) },
      { type: 'emphasis', children: [{ type: 'text', value: 'final' }], position: pos(i, i + 7) },
      { type: 'text', value: '.mp4"}', position: pos(i + 7, src.length) },
    ]);
    assert.deepEqual(dirs(ch), [{ cid: 'c1', name: 'rapat _final_.mp4' }]);
    assert.deepEqual(rest(ch), [], 'tidak ada sisa teks/junk');
  });

  it('emphasis *y*, delete ~b~, inlineCode, autolink www./http', () => {
    let src = '::media[c2]{name="x*y*.mp4"}';
    let i = src.indexOf('*y*');
    let ch = run(src, [
      { type: 'text', value: '::media[c2]{name="x', position: pos(0, i) },
      { type: 'emphasis', children: [{ type: 'text', value: 'y' }], position: pos(i, i + 3) },
      { type: 'text', value: '.mp4"}', position: pos(i + 3, src.length) },
    ]);
    assert.deepEqual(dirs(ch), [{ cid: 'c2', name: 'x*y*.mp4' }]);
    assert.deepEqual(rest(ch), []);

    src = '::media[c3]{name="a~b~.webm"}';
    i = src.indexOf('~b~');
    ch = run(src, [
      { type: 'text', value: '::media[c3]{name="a', position: pos(0, i) },
      { type: 'delete', children: [{ type: 'text', value: 'b' }], position: pos(i, i + 3) },
      { type: 'text', value: '.webm"}', position: pos(i + 3, src.length) },
    ]);
    assert.deepEqual(dirs(ch), [{ cid: 'c3', name: 'a~b~.webm' }]);

    ch = run('', [
      { type: 'text', value: '::media[c4]{name="' },
      { type: 'link', url: 'http://www.site.mp4', children: [{ type: 'text', value: 'www.site.mp4' }] },
      { type: 'text', value: '"}' },
    ]);
    assert.deepEqual(dirs(ch), [{ cid: 'c4', name: 'www.site.mp4' }]);
    assert.deepEqual(rest(ch), []);

    ch = run('', [
      { type: 'text', value: '::media[c5]{name="q' },
      { type: 'inlineCode', value: 't' },
      { type: 'text', value: '.mp3"}' },
    ]);
    assert.deepEqual(dirs(ch), [{ cid: 'c5', name: 'q`t`.mp3' }]);
  });

  it('teks sebelum/sesudah dipertahankan, direktif berikutnya di sisa teks tetap dikenali', () => {
    const ch = run('', [
      { type: 'text', value: 'awal ::media[c1]{name="a ' },
      { type: 'emphasis', children: [{ type: 'text', value: 'b' }] },
      { type: 'text', value: '.mp4"} tengah ::media[c2]{name="z.mp3"} akhir' },
    ]);
    assert.deepEqual(dirs(ch), [{ cid: 'c1', name: 'a _b_.mp4' }, { cid: 'c2', name: 'z.mp3' }]);
    assert.deepEqual(ch.map((n) => n.type === 'text' ? n.value : '#' + n.cid), ['awal ', '#c1', ' tengah ', '#c2', ' akhir']);
  });

  it('tanpa penutup } → perilaku lama (tidak menelan node lain)', () => {
    const em = { type: 'emphasis', children: [{ type: 'text', value: 'b' }] };
    const ch = run('', [{ type: 'text', value: '::media[c1]{name="a ' }, em, { type: 'text', value: ' tanpa penutup' }]);
    assert.deepEqual(dirs(ch), [{ cid: 'c1', name: '' }]);
    assert.ok(ch.includes(em));
  });
});
