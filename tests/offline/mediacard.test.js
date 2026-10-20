const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { formatDuration, viewFor, cardHtml, playerAttrs } = require('../../static/offline/mediacard.js');

const meta = (o) => Object.assign({
  id: 5, client_id: 'c1', note_id: 9, original_name: 'rapat.m4a', media_type: 'audio', mime_type: 'audio/mp4',
  file_size: 1000, duration_ms: 62000, status: 'ready', error: '', uploaded_by: 3, uploaded_by_name: 'Sari',
  play_url: '/media/tok', poster_url: null, download_url: '/media/dl',
}, o);
const base = (o) => Object.assign({ meta: meta(), httpStatus: 200, online: true, upload: null, uid: 3, noteOwnerId: 1, nameAttr: '', canPlay: () => 'maybe' }, o);
const V = (o) => viewFor(base(o));

describe('formatDuration', () => {
  it('m:ss, h:mm:ss, kosong', () => {
    assert.equal(formatDuration(62000), '1:02');
    assert.equal(formatDuration(3723000), '1:02:03');
    assert.equal(formatDuration(3600000), '1:00:00');
    assert.equal(formatDuration(5000), '0:05');
    assert.equal(formatDuration(null), '');
    assert.equal(formatDuration(0), '');
    assert.equal(formatDuration(undefined), '');
    assert.equal(formatDuration(-5), '');
  });
});

describe('viewFor', () => {
  it('404 → missing (mengalahkan semuanya)', () => {
    assert.equal(V({ httpStatus: 404 }).state, 'missing');
    assert.equal(V({ httpStatus: 404, meta: null, online: false }).state, 'missing');
  });
  it('tanpa meta: offline → offline, online → loading', () => {
    assert.equal(V({ meta: null, online: false }).state, 'offline');
    assert.equal(V({ meta: null }).state, 'loading');
  });
  it('nama: meta, lalu nameAttr, lalu Media', () => {
    assert.equal(V().name, 'rapat.m4a');
    assert.equal(V({ meta: null, nameAttr: 'x.mp3' }).name, 'x.mp3');
    assert.equal(V({ meta: null }).name, 'Media');
  });
  it('uploading milik sendiri tanpa upload lokal → uploading-stalled', () => {
    const v = V({ meta: meta({ status: 'uploading' }) });
    assert.equal(v.state, 'uploading-stalled');
    assert.equal(v.canCancel, true);
  });
  it('uploading orang lain → uploading-other dengan uploaderName', () => {
    const v = V({ meta: meta({ status: 'uploading', uploaded_by: 8 }) });
    assert.equal(v.state, 'uploading-other');
    assert.equal(v.uploaderName, 'Sari');
    assert.equal(v.canCancel, false);
  });
  it('upload lokal aktif → uploading-local dengan progress floor', () => {
    for (const phase of ['uploading', 'waiting', 'completing']) {
      const v = V({ meta: meta({ status: 'uploading' }), upload: { cid: 'c1', phase, sent: 400, size: 1000 } });
      assert.equal(v.state, 'uploading-local');
      assert.equal(v.progress, 40);
      assert.equal(v.canCancel, true);
    }
    assert.equal(V({ meta: meta({ status: 'uploading' }), upload: { phase: 'uploading', sent: 1, size: 3 } }).progress, 33);
    assert.equal(V({ meta: meta({ status: 'uploading' }), upload: { phase: 'uploading', sent: 0, size: 0 } }).progress, 0);
  });
  it('upload lokal failed retryable → uploading-stalled dengan error; tidak retryable → failed', () => {
    const msg = 'File berbeda — pilih file yang sama dengan yang diunggah';
    const a = V({ meta: meta({ status: 'uploading' }), upload: { phase: 'failed', retryable: true, error: msg } });
    assert.equal(a.state, 'uploading-stalled');
    assert.equal(a.error, msg);
    const b = V({ meta: meta({ status: 'uploading' }), upload: { phase: 'failed', error: 'Server menolak' } });
    assert.equal(b.state, 'failed');
    assert.equal(b.error, 'Server menolak');
  });
  it('processing, failed, ready', () => {
    assert.equal(V({ meta: meta({ status: 'processing' }) }).state, 'processing');
    const f = V({ meta: meta({ status: 'failed', error: 'rusak' }) });
    assert.equal(f.state, 'failed');
    assert.equal(f.error, 'rusak');
    const r = V();
    assert.equal(r.state, 'ready');
    assert.equal(r.kind, 'audio');
    assert.equal(r.durationText, '1:02');
    assert.equal(r.warnFormat, false);
  });
  it('ready + canPlay "" → warnFormat true', () => {
    assert.equal(V({ canPlay: () => '' }).warnFormat, true);
    assert.equal(V({ canPlay: () => 'probably' }).warnFormat, false);
  });
  it('offline dengan meta → offline, kecuali ada upload lokal aktif', () => {
    assert.equal(V({ online: false }).state, 'offline');
    assert.equal(V({ online: false, meta: meta({ status: 'uploading' }) }).state, 'offline');
    assert.equal(V({ online: false, meta: meta({ status: 'uploading' }), upload: { phase: 'waiting', sent: 10, size: 100 } }).state, 'uploading-local');
  });
  it('canDelete hanya pengunggah atau pemilik note', () => {
    assert.equal(V({ uid: 3, noteOwnerId: 1 }).canDelete, true);
    assert.equal(V({ uid: 1, noteOwnerId: 1 }).canDelete, true);
    assert.equal(V({ uid: 7, noteOwnerId: 1 }).canDelete, false);
    assert.equal(V({ meta: null }).canDelete, false);
  });
  it('field player diteruskan mentah dari meta', () => {
    const v = V({ meta: meta({ media_type: 'video', mime_type: 'video/mp4', poster_url: '/media/p' }) });
    assert.equal(v.kind, 'video');
    assert.deepEqual([v.src, v.poster, v.mime, v.downloadUrl], ['/media/tok', '/media/p', 'video/mp4', '/media/dl']);
  });
  it('kind null bila tidak ada meta', () => assert.equal(V({ meta: null }).kind, null));
});

describe('cardHtml', () => {
  it('meng-escape nama dan pesan', () => {
    const h = cardHtml(V({ meta: meta({ status: 'failed', original_name: '<img src=x onerror=1>', error: '"><b>' }) }));
    assert.ok(!h.includes('<img src=x') && !h.includes('"><b>') && !h.includes('<b>'));
    assert.ok(h.includes('&lt;img src=x onerror=1&gt;'));
  });
  it('tidak pernah memuat video/audio/script/iframe, juga dari downloadUrl jahat', () => {
    for (const m of [{}, { status: 'processing' }, { status: 'uploading' }, { media_type: 'video' }]) {
      const v = V({ meta: meta(m) });
      v.downloadUrl = '"><script>x</script>';
      const h = cardHtml(v);
      assert.ok(!/<(video|audio|script|iframe)/i.test(h), h);
    }
    assert.ok(!/href="javascript:/i.test(cardHtml(Object.assign(V(), { downloadUrl: 'javascript:alert(1)' }))));
  });
  it('teks persis tiap state', () => {
    const up = cardHtml(V({ meta: meta({ status: 'uploading' }), upload: { phase: 'uploading', sent: 400, size: 1000 } }));
    assert.ok(up.includes('Mengunggah… 40%') && up.includes('data-media-action="cancel"') && up.includes('>Batal<'));
    assert.ok(cardHtml(V({ meta: meta({ status: 'processing' }) })).includes('Memproses…'));
    assert.ok(cardHtml(V({ online: false })).includes('Butuh koneksi untuk memutar'));
    assert.ok(cardHtml(V({ httpStatus: 404 })).includes('Media tidak tersedia untukmu: sudah dihapus atau bukan bagian dari catatan ini.'));
    const st = cardHtml(V({ meta: meta({ status: 'uploading' }) }));
    assert.ok(st.includes('Unggahan terhenti — pilih file yang sama untuk melanjutkan'));
    assert.ok(st.includes('data-media-action="resume"') && st.includes('Pilih file') && st.includes('data-media-action="cancel"'));
    const stErr = cardHtml(V({ meta: meta({ status: 'uploading' }), upload: { phase: 'failed', retryable: true, error: 'File berbeda — pilih file yang sama dengan yang diunggah' } }));
    assert.ok(stErr.includes('File berbeda — pilih file yang sama dengan yang diunggah'));
    const oth = cardHtml(V({ meta: meta({ status: 'uploading', uploaded_by: 8, uploaded_by_name: 'Budi <i>' }) }));
    assert.ok(oth.includes('Sedang diunggah oleh Budi &lt;i&gt;') && !oth.includes('data-media-action="cancel"'));
  });
  it('ready: caption, slot player, peringatan format, tautan Unduh, tombol Hapus', () => {
    const h = cardHtml(V({ meta: meta({ media_type: 'video' }) }));
    assert.ok(h.includes('🎬') && h.includes('rapat.m4a') && h.includes('1:02'));
    assert.ok(h.includes('<div class="note-media-player" data-media-player></div>'));
    assert.ok(h.includes('<a data-media-download href="/media/dl" download>Unduh</a>'));
    assert.ok(h.includes('data-media-action="delete"') && h.includes('>Hapus<'));
    assert.ok(!h.includes('Format ini mungkin'));
    assert.ok(cardHtml(V({ canPlay: () => '' })).includes('Format ini mungkin tidak bisa diputar di perangkat ini'));
    assert.ok(cardHtml(V({ meta: meta({ media_type: 'audio' }) })).includes('🎵'));
    assert.ok(cardHtml(V({ meta: null })).includes('📎'));
  });
  it('tanpa hak hapus → tanpa tombol Hapus', () => {
    assert.ok(!cardHtml(V({ uid: 7 })).includes('data-media-action="delete"'));
  });
});

describe('playerAttrs', () => {
  it('video dengan poster, audio tanpa poster', () => {
    const v = V({ meta: meta({ media_type: 'video', mime_type: 'video/mp4', poster_url: '/media/p' }) });
    assert.deepEqual(playerAttrs(v), { tag: 'video', src: '/media/tok', poster: '/media/p', mime: 'video/mp4' });
    const a = V({ meta: meta({ poster_url: '/media/p' }) });
    assert.deepEqual(playerAttrs(a), { tag: 'audio', src: '/media/tok', poster: '', mime: 'audio/mp4' });
  });
});
