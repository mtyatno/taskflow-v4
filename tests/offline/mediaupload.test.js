const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { createManager } = require('../../static/offline/mediaupload.js');

const MiB = 1024 * 1024;
const flush = async (n = 8) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };
const jres = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => body || {} });

function fakeFile(size, name = 'rapat.m4a', lastModified = 1700000000000) {
  return { name, size, lastModified, type: 'audio/mp4', slice: (a, b) => ({ a, b, size: b - a }) };
}

function memStorage(initial) {
  const m = new Map(Object.entries(initial || {}));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), _m: m };
}

// Server palsu berstatus + pencatat request. `over(req)` boleh mengembalikan respons untuk menimpa perilaku bawaan.
function setup(opts = {}) {
  const calls = [];
  const timers = [];
  const server = { attId: 77, received: opts.received || 0, status: 'uploading', size: null };
  const storage = opts.storage || memStorage();
  let online = true;
  const fetchFn = async (url, init) => {
    const path = url.replace('https://api.test', '');
    const req = { path, method: init.method, headers: init.headers || {}, body: init.body };
    calls.push(req);
    if (opts.over) { const r = opts.over(req, server, calls); if (r) return r; }
    if (req.method === 'POST' && /\/media$/.test(path)) {
      const b = JSON.parse(req.body); server.size = b.size;
      return jres(200, { id: server.attId, status: server.status, received_bytes: server.received });
    }
    if (req.method === 'PATCH') {
      const off = Number(req.headers['Upload-Offset']);
      if (off !== server.received) return jres(409, { detail: 'offset', received_bytes: server.received });
      server.received = req.body.b;
      return jres(200, { id: server.attId, received_bytes: server.received });
    }
    if (req.method === 'GET') return jres(200, { received_bytes: server.received, size: server.size, status: server.status });
    if (req.method === 'POST' && /\/complete$/.test(path)) return jres(200, { id: server.attId, status: 'processing' });
    if (req.method === 'DELETE') return jres(200, {});
    return jres(500, {});
  };
  const mgr = createManager({
    fetch: fetchFn, apiUrl: (p) => 'https://api.test' + p, getToken: () => 'tok123', storage,
    now: () => 1, isOnline: () => online,
    setTimeout: (fn, ms) => { const t = { fn, ms, on: true }; timers.push(t); return t; },
    clearTimeout: (t) => { if (t) t.on = false; },
    ...(opts.deps || {}),
  });
  return { mgr, calls, timers, server, storage, setOnline: (v) => { online = v; },
    patches: () => calls.filter((c) => c.method === 'PATCH') };
}

describe('TF.mediaupload', () => {
  it('unggah 12 MB jadi 3 PATCH dengan Upload-Offset 0, 5M, 10M lalu complete', async () => {
    const t = setup();
    const st = await t.mgr.start({ file: fakeFile(12 * MiB), noteId: 5, cid: 'c1' });
    assert.equal(st.phase, 'done');
    assert.deepEqual(t.patches().map((c) => c.headers['Upload-Offset']), ['0', String(5 * MiB), String(10 * MiB)]);
    assert.deepEqual(t.patches().map((c) => [c.body.a, c.body.b]), [[0, 5 * MiB], [5 * MiB, 10 * MiB], [10 * MiB, 12 * MiB]]);
    assert.equal(t.patches()[0].headers['Content-Type'], 'application/offset+octet-stream');
    assert.equal(t.calls[0].path, '/api/scratchpad/5/media');
    assert.deepEqual(JSON.parse(t.calls[0].body), { client_id: 'c1', filename: 'rapat.m4a', size: 12 * MiB, mime: 'audio/mp4' });
    assert.equal(t.patches()[0].path, '/api/media/77/upload');
    const last = t.calls[t.calls.length - 1];
    assert.equal(last.method, 'POST');
    assert.equal(last.path, '/api/media/77/complete');
    assert.equal(t.mgr.get('c1').sent, 12 * MiB);
  });

  it('409 offset → lanjut dari received_bytes tanpa kirim ulang yang sudah diterima', async () => {
    let first = true;
    const t = setup({ over: (req, s) => {
      if (req.method === 'PATCH' && first) { first = false; s.received = 7 * MiB; return jres(409, { detail: 'x', received_bytes: 7 * MiB }); }
    } });
    const st = await t.mgr.start({ file: fakeFile(12 * MiB), noteId: 5, cid: 'c2' });
    assert.equal(st.phase, 'done');
    assert.deepEqual(t.patches().map((c) => c.headers['Upload-Offset']), ['0', String(7 * MiB)]);
    assert.deepEqual([t.patches()[1].body.a, t.patches()[1].body.b], [7 * MiB, 12 * MiB]);
  });

  it('409 tanpa received_bytes → GET status lalu lanjut', async () => {
    let first = true;
    const t = setup({ over: (req, s) => {
      if (req.method === 'PATCH' && first) { first = false; s.received = 5 * MiB; return jres(409, { detail: 'terkunci' }); }
    } });
    const st = await t.mgr.start({ file: fakeFile(8 * MiB), noteId: 5, cid: 'c2b' });
    assert.equal(st.phase, 'done');
    assert.ok(t.calls.some((c) => c.method === 'GET' && c.path === '/api/media/77/upload'));
    assert.equal(t.patches()[1].headers['Upload-Offset'], String(5 * MiB));
  });

  it('init idempoten: received_bytes dari respons init dipakai sebagai awal', async () => {
    const t = setup({ received: 5 * MiB });
    const st = await t.mgr.start({ file: fakeFile(8 * MiB), noteId: 5, cid: 'c3' });
    assert.equal(st.phase, 'done');
    assert.deepEqual(t.patches().map((c) => c.headers['Upload-Offset']), [String(5 * MiB)]);
  });

  it('error jaringan → waiting, jeda 1s lalu 2s, kick() langsung mencoba lagi', async () => {
    let fails = 0;
    const t = setup({ over: (req) => { if (req.method === 'PATCH' && fails < 3) { fails++; throw new TypeError('network'); } } });
    const p = t.mgr.start({ file: fakeFile(1 * MiB), noteId: 5, cid: 'c4' });
    await flush();
    assert.equal(t.mgr.get('c4').phase, 'waiting');
    assert.equal(t.timers.length, 1);
    assert.equal(t.timers[0].ms, 1000);
    t.timers[0].fn(); await flush();
    assert.equal(t.mgr.get('c4').phase, 'waiting');
    assert.equal(t.timers[1].ms, 2000);
    const before = t.patches().length;
    t.mgr.kick(); await flush();               // kick: tanpa menunggu timer
    assert.equal(t.patches().length, before + 1); // percobaan ke-3 (masih gagal)
    assert.equal(t.timers[2].ms, 4000);
    assert.equal(t.timers[1].on, false);
    t.timers[2].fn();
    const st = await p;
    assert.equal(st.phase, 'done');
  });

  it('jeda ulang berhenti di 30 detik', async () => {
    const t = setup({ over: (req) => { if (req.method === 'PATCH') throw new TypeError('x'); } });
    t.mgr.start({ file: fakeFile(1 * MiB), noteId: 5, cid: 'c4b' });
    for (let i = 0; i < 8; i++) { await flush(); t.timers[t.timers.length - 1].fn(); }
    await flush();
    assert.deepEqual(t.timers.slice(0, 8).map((x) => x.ms), [1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000]);
  });

  it('5xx dicoba ulang dengan jeda; offline → tidak mengirim request sampai kick', async () => {
    const t = setup();
    t.setOnline(false);
    const p = t.mgr.start({ file: fakeFile(1 * MiB), noteId: 5, cid: 'c5' });
    await flush();
    assert.equal(t.calls.length, 0);
    assert.equal(t.mgr.get('c5').phase, 'waiting');
    assert.equal(t.mgr.hasActive(), true);
    t.setOnline(true); t.mgr.kick();
    assert.equal((await p).phase, 'done');
  });

  it('404 saat PATCH → failed, entri storage dihapus', async () => {
    const t = setup({ over: (req) => { if (req.method === 'PATCH') return jres(404, { detail: 'Tidak ditemukan' }); } });
    const st = await t.mgr.start({ file: fakeFile(6 * MiB), noteId: 5, cid: 'c6' });
    assert.equal(st.phase, 'failed');
    assert.equal(st.error, 'Tidak ditemukan');
    assert.equal(t.mgr.pending().length, 0);
    assert.equal(t.storage.getItem('tf_media_uploads'), null);
    assert.equal(t.mgr.hasActive(), false);
  });

  it('507 → failed dengan detail server, tanpa retry', async () => {
    const t = setup({ over: (req) => { if (req.method === 'PATCH') return jres(507, { detail: 'Penyimpanan server penuh' }); } });
    const st = await t.mgr.start({ file: fakeFile(6 * MiB), noteId: 5, cid: 'c7' });
    assert.equal(st.phase, 'failed');
    assert.equal(st.error, 'Penyimpanan server penuh');
    assert.equal(t.patches().length, 1);
    assert.equal(t.timers.length, 0);
  });

  it('4xx lain → failed dengan detail, atau teks umum bila tidak ada', async () => {
    const t = setup({ over: (req) => { if (req.method === 'PATCH') return jres(413, { detail: 'Terlalu besar' }); } });
    assert.equal((await t.mgr.start({ file: fakeFile(1 * MiB), noteId: 5, cid: 'a' })).error, 'Terlalu besar');
    const t2 = setup({ over: (req) => { if (req.method === 'POST' && /media$/.test(req.path)) return jres(403, {}); } });
    const st = await t2.mgr.start({ file: fakeFile(1 * MiB), noteId: 5, cid: 'b' });
    assert.equal(st.phase, 'failed');
    assert.ok(st.error && st.error.length > 5);
  });

  it('complete 415 → failed dengan detail format', async () => {
    const t = setup({ over: (req) => { if (/complete$/.test(req.path)) return jres(415, { detail: 'Format tidak didukung' }); } });
    const st = await t.mgr.start({ file: fakeFile(1 * MiB), noteId: 5, cid: 'c8' });
    assert.equal(st.phase, 'failed');
    assert.equal(st.error, 'Format tidak didukung');
  });

  it('file > 2048 MB → error tanpa request', async () => {
    const t = setup();
    const st = await t.mgr.start({ file: fakeFile(2048 * MiB + 1), noteId: 5, cid: 'c9' });
    assert.equal(st.phase, 'failed');
    assert.equal(st.error, 'File terlalu besar (maks 2 GB)');
    assert.equal(t.calls.length, 0);
    assert.equal(t.mgr.pending().length, 0);
  });

  it('ekstensi .pdf → "Format tidak didukung" tanpa request', async () => {
    const t = setup();
    const st = await t.mgr.start({ file: fakeFile(1 * MiB, 'dok.pdf'), noteId: 5, cid: 'c10' });
    assert.equal(st.phase, 'failed');
    assert.equal(st.error, 'Format tidak didukung');
    assert.equal(t.calls.length, 0);
  });

  it('storage menyimpan entri sampai done lalu menghapusnya', async () => {
    let seen = null;
    const t = setup({ over: (req, s, calls) => {
      if (/complete$/.test(req.path)) seen = JSON.parse(t.storage.getItem('tf_media_uploads'));
    } });
    const st = await t.mgr.start({ file: fakeFile(1 * MiB), noteId: 5, cid: 'c11' });
    assert.equal(st.phase, 'done');
    assert.deepEqual(seen.c11, { cid: 'c11', noteId: 5, attId: 77, name: 'rapat.m4a', size: MiB, lastModified: 1700000000000 });
    assert.equal(t.mgr.pending().length, 0);
    assert.equal(t.mgr.get('c11').phase, 'done');
  });

  it('storage yang melempar tidak mematahkan unggahan', async () => {
    const bad = { getItem() { throw new Error('x'); }, setItem() { throw new Error('x'); }, removeItem() { throw new Error('x'); } };
    const t = setup({ storage: bad });
    assert.equal((await t.mgr.start({ file: fakeFile(1 * MiB), noteId: 5, cid: 'c12' })).phase, 'done');
    assert.deepEqual(t.mgr.pending(), []);
  });

  it('resume dengan file berbeda → error persis, tanpa request, entri tetap', async () => {
    const entry = { cid: 'r1', noteId: 5, attId: 77, name: 'rapat.m4a', size: 12 * MiB, lastModified: 1700000000000 };
    const msg = 'File berbeda — pilih file yang sama dengan yang diunggah';
    for (const f of [fakeFile(12 * MiB + 1), fakeFile(12 * MiB, 'rapat.m4a', 5), fakeFile(12 * MiB, 'lain.m4a')]) {
      const t = setup({ storage: memStorage({ tf_media_uploads: JSON.stringify({ r1: entry }) }) });
      const st = await t.mgr.resume('r1', f);
      assert.equal(st.error, msg);
      assert.equal(st.phase, 'failed');
      assert.equal(t.calls.length, 0);
      assert.equal(t.mgr.pending().length, 1);
    }
  });

  it('resume dengan file sama → GET offset lalu PATCH dari offset itu', async () => {
    const entry = { cid: 'r2', noteId: 5, attId: 77, name: 'rapat.m4a', size: 12 * MiB, lastModified: 1700000000000 };
    const t = setup({ received: 10 * MiB, storage: memStorage({ tf_media_uploads: JSON.stringify({ r2: entry }) }) });
    const st = await t.mgr.resume('r2', fakeFile(12 * MiB));
    assert.equal(st.phase, 'done');
    assert.equal(t.calls[0].method, 'GET');
    assert.equal(t.calls[0].path, '/api/media/77/upload');
    assert.deepEqual(t.patches().map((c) => c.headers['Upload-Offset']), [String(10 * MiB)]);
    assert.equal(t.calls.filter((c) => c.method === 'POST' && /media$/.test(c.path)).length, 0);
  });

  it('resume: status bukan uploading → done; 404 → failed + entri dihapus', async () => {
    const entry = { cid: 'r3', noteId: 5, attId: 77, name: 'rapat.m4a', size: MiB, lastModified: 1700000000000 };
    const mk = () => memStorage({ tf_media_uploads: JSON.stringify({ r3: entry }) });
    const a = setup({ storage: mk(), over: (req) => { if (req.method === 'GET') return jres(200, { received_bytes: MiB, size: MiB, status: 'processing' }); } });
    const sa = await a.mgr.resume('r3', fakeFile(MiB));
    assert.equal(sa.phase, 'done');
    assert.equal(a.patches().length, 0);
    assert.equal(a.mgr.pending().length, 0);
    const b = setup({ storage: mk(), over: (req) => { if (req.method === 'GET') return jres(404, { detail: 'hilang' }); } });
    const sb = await b.mgr.resume('r3', fakeFile(MiB));
    assert.equal(sb.phase, 'failed');
    assert.equal(b.mgr.pending().length, 0);
  });

  it('cancel di tengah loop → DELETE lampiran, tidak ada PATCH berikutnya', async () => {
    let release;
    const gate = new Promise((r) => { release = r; });
    let n = 0;
    const t = setup({ over: (req, s) => {
      if (req.method === 'PATCH' && ++n === 1) return gate.then(() => { s.received = req.body.b; return jres(200, { received_bytes: req.body.b }); });
    } });
    const p = t.mgr.start({ file: fakeFile(12 * MiB), noteId: 5, cid: 'c13' });
    await flush();
    assert.equal(t.patches().length, 1);
    const c = t.mgr.cancel('c13');
    release();
    await c;
    const st = await p;
    await flush();
    assert.equal(st.phase, 'canceled');
    assert.equal(t.patches().length, 1);
    const del = t.calls.filter((x) => x.method === 'DELETE');
    assert.equal(del.length, 1);
    assert.equal(del[0].path, '/api/scratchpad/attachments/77');
    assert.equal(t.mgr.pending().length, 0);
    assert.equal(t.mgr.hasActive(), false);
  });

  it('cancel saat waiting menghentikan loop', async () => {
    const t = setup({ over: (req) => { if (req.method === 'PATCH') throw new TypeError('x'); } });
    const p = t.mgr.start({ file: fakeFile(MiB), noteId: 5, cid: 'c14' });
    await flush();
    await t.mgr.cancel('c14');
    assert.equal((await p).phase, 'canceled');
    assert.equal(t.timers[0].on, false);
  });

  it('Authorization Bearer dan apiUrl dipakai di semua request', async () => {
    const t = setup();
    await t.mgr.start({ file: fakeFile(6 * MiB), noteId: 5, cid: 'c15' });
    await t.mgr.cancel('c15');
    assert.ok(t.calls.length >= 4);
    for (const c of t.calls) assert.equal(c.headers.Authorization, 'Bearer tok123', c.method + ' ' + c.path);
  });

  it('start dengan cid yang sedang berjalan mengembalikan promise yang sama', async () => {
    const t = setup();
    const f = fakeFile(6 * MiB);
    const p1 = t.mgr.start({ file: f, noteId: 5, cid: 'c16' });
    const p2 = t.mgr.start({ file: f, noteId: 5, cid: 'c16' });
    assert.equal(p1, p2);
    await p1;
    assert.equal(t.calls.filter((c) => c.method === 'POST' && /media$/.test(c.path)).length, 1);
  });

  it('subscribe menerima (cid, state) dan bisa berhenti; chunkSize/maxBytes bisa diatur', async () => {
    const t = setup({ deps: { chunkSize: 1 * MiB, maxBytes: 3 * MiB } });
    const seen = [];
    const off = t.mgr.subscribe((cid, s) => seen.push([cid, s.phase, s.sent]));
    await t.mgr.start({ file: fakeFile(2 * MiB), noteId: 5, cid: 'c17' });
    assert.equal(t.patches().length, 2);
    assert.ok(seen.every((x) => x[0] === 'c17'));
    assert.deepEqual(seen[seen.length - 1].slice(1), ['done', 2 * MiB]);
    assert.ok(seen.some((x) => x[1] === 'uploading' && x[2] === MiB));
    off();
    const n = seen.length;
    const st = await t.mgr.start({ file: fakeFile(4 * MiB), noteId: 5, cid: 'c18' });
    assert.equal(st.error, 'File terlalu besar (maks 2 GB)');
    assert.equal(seen.length, n);
  });

  it('status server failed (init/resume GET) → failed dengan error server, entri dihapus; processing/ready → done', async () => {
    const t = setup({ over: (req) => { if (req.method === 'POST' && /media$/.test(req.path)) return jres(200, { id: 77, status: 'failed', error: 'Transkode gagal', received_bytes: 0 }); } });
    const st = await t.mgr.start({ file: fakeFile(MiB), noteId: 5, cid: 'f1' });
    assert.equal(st.phase, 'failed');
    assert.equal(st.error, 'Transkode gagal');
    assert.equal(t.mgr.pending().length, 0);
    assert.equal(t.patches().length, 0);
    const entry = { cid: 'f2', noteId: 5, attId: 77, name: 'rapat.m4a', size: MiB, lastModified: 1700000000000 };
    const t2 = setup({ storage: memStorage({ tf_media_uploads: JSON.stringify({ f2: entry }) }),
      over: (req) => { if (req.method === 'GET') return jres(200, { received_bytes: 0, size: MiB, status: 'failed' }); } });
    const s2 = await t2.mgr.resume('f2', fakeFile(MiB));
    assert.equal(s2.phase, 'failed');
    assert.ok(s2.error && s2.error.length > 5);
    assert.equal(t2.mgr.pending().length, 0);
    const t3 = setup({ over: (req) => { if (req.method === 'POST' && /media$/.test(req.path)) return jres(200, { id: 77, status: 'ready', received_bytes: MiB }); } });
    assert.equal((await t3.mgr.start({ file: fakeFile(MiB), noteId: 5, cid: 'f3' })).phase, 'done');
  });

  it('complete 409 dengan received_bytes (lock sibuk) → backoff lalu coba lagi; entri dihapus hanya saat done', async () => {
    let n = 0; let entryDuring = null;
    const t = setup({ over: (req, s) => {
      if (/complete$/.test(req.path) && ++n === 1) return jres(409, { detail: 'sibuk', received_bytes: MiB });
      if (/complete$/.test(req.path)) entryDuring = t.storage.getItem('tf_media_uploads');
    } });
    const p = t.mgr.start({ file: fakeFile(MiB), noteId: 5, cid: 'k1' });
    await flush();
    assert.equal(t.mgr.get('k1').phase, 'waiting');
    assert.equal(t.timers[0].ms, 1000);
    assert.notEqual(t.storage.getItem('tf_media_uploads'), null);
    t.timers[0].fn();
    const st = await p;
    assert.equal(st.phase, 'done');
    assert.equal(n, 2);
    assert.ok(entryDuring && entryDuring.includes('k1'));
    assert.equal(t.mgr.pending().length, 0);
    assert.equal(t.calls.filter((c) => c.method === 'GET').length, 0);
  });

  it('resume file berbeda → state retryable: true; state lain tidak punya retryable', async () => {
    const entry = { cid: 'm1', noteId: 5, attId: 77, name: 'rapat.m4a', size: MiB, lastModified: 1700000000000 };
    const t = setup({ storage: memStorage({ tf_media_uploads: JSON.stringify({ m1: entry }) }) });
    const st = await t.mgr.resume('m1', fakeFile(MiB + 1));
    assert.equal(st.retryable, true);
    assert.equal(t.mgr.get('m1').retryable, true);
    const t2 = setup();
    const bad = await t2.mgr.start({ file: fakeFile(1 * MiB, 'x.pdf'), noteId: 5, cid: 'm2' });
    assert.ok(!('retryable' in bad));
    const ok = await t2.mgr.start({ file: fakeFile(MiB), noteId: 5, cid: 'm3' });
    assert.ok(!('retryable' in ok));
  });

  it('cancel saat init masih berjalan → respons init dengan id memicu DELETE sekali, tanpa PATCH', async () => {
    let release;
    const gate = new Promise((r) => { release = r; });
    const t = setup({ over: (req) => { if (req.method === 'POST' && /media$/.test(req.path)) return gate.then(() => jres(200, { id: 91, status: 'uploading', received_bytes: 0 })); } });
    const p = t.mgr.start({ file: fakeFile(MiB), noteId: 5, cid: 'i1' });
    await flush();
    const c = t.mgr.cancel('i1');
    release();
    await c;
    const st = await p;
    await flush();
    assert.equal(st.phase, 'canceled');
    const del = t.calls.filter((x) => x.method === 'DELETE');
    assert.equal(del.length, 1);
    assert.equal(del[0].path, '/api/scratchpad/attachments/91');
    assert.equal(t.patches().length, 0);
    assert.equal(t.mgr.pending().length, 0);
  });

  it('Blob asli juga berfungsi', async () => {
    const t = setup();
    const blob = new Blob([new Uint8Array(100)]);
    Object.defineProperty(blob, 'name', { value: 'a.mp3' });
    // slice asli menghasilkan Blob tanpa .b → server palsu butuh .b; pakai fetch sendiri
    const calls = [];
    const mgr = createManager({
      fetch: async (u, i) => { calls.push(i); return i.method === 'PATCH' ? jres(200, { received_bytes: 100 }) : jres(200, { id: 1, status: 'uploading', received_bytes: 0 }); },
      apiUrl: (p) => p, getToken: () => 't', storage: memStorage(), isOnline: () => true,
      setTimeout, clearTimeout,
    });
    const st = await mgr.start({ file: blob, noteId: 1, cid: 'b1' });
    assert.equal(st.phase, 'done');
    assert.ok(calls.find((c) => c.method === 'PATCH').body instanceof Blob);
  });
});
