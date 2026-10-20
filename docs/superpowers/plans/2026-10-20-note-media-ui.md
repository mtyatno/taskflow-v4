# Rencana: Audio & Video di Note — PR frontend

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Tanggal: 2026-10-20 · Agent: Claude · Branch: `claude/note-media-ui` · **Frontend + offline, naik versi SW**

**Goal:** Pengguna bisa melampirkan audio/video ke note dari editor, melihat progres unggah (yang bisa dilanjutkan setelah putus atau reload), dan memutar serta menggeser media di mode baca dan editor, di web maupun APK.

**Architecture:**
- Tiga modul murni baru di `static/offline/` (UMD, `window.TF.*`, dites `node --test`):
  - `mediadirective.js`: parse/format direktif + plugin remark;
  - `mediaupload.js`: manajer unggah bertahap dengan `fetch`/`storage` yang diinjeksikan;
  - `mediacard.js`: model tampilan kartu + HTML ter-escape.
- `static/index.html` hanya merangkai:
  - placeholder kartu di `prepMarkdownBlocks` (pola `DRWBLK`);
  - node Milkdown `media` (pola `createDrawingPlugin`);
  - hidrasi kartu (`window.hydrateMediaCards`, pola `hydrateDrawingPreviews`);
  - satu manajer unggah di level App (`window.__mediaUploads`);
  - tombol 🎬 di `NoteToolbar`.
- Backend tidak berubah.

**Tech Stack:** JS tanpa bundler (React UMD, Milkdown bundle `MB.*`), `node:test`, pytest (jembatan ke node test), Playwright Python untuk E2E.

**Spec:** `docs/superpowers/specs/2026-10-19-note-media-audio-video-design.md` (§8.1, §9; API di §5.1, §6.1). Backend sudah di `main` (#51, ADR-017).

## Global Constraints

- **API (sudah ada):**
  - `POST /api/scratchpad/{note_id}/media` `{client_id, filename, size, mime}`;
  - `GET /api/media/{id}/upload` → `{received_bytes, size, status}`;
  - `PATCH /api/media/{id}/upload` header `Upload-Offset`, body bytes. 409 → JSON top-level `received_bytes`;
  - `POST /api/media/{id}/complete`;
  - `GET /api/media/{id}`;
  - `GET /api/scratchpad/{note_id}/media/by-client/{client_id}`;
  - hapus/batal: `DELETE /api/scratchpad/attachments/{id}`.
  - Payload media: `id, client_id, note_id, original_name, media_type, mime_type, file_size, duration_ms, width, height, status, error, received_bytes, uploaded_by, uploaded_by_name, play_url, poster_url, download_url, expires_at`.
  - URL media relatif (`/media/<token>`) → **selalu** dibungkus `apiUrl()`. Semua `fetch` memakai `apiUrl()` + `Authorization: Bearer <__token>`.
- **Direktif:** regex `/\\?::media\\?\[([0-9a-zA-Z_-]{1,64})\\?\](?:\s*\\?\{([^}]*)\\?\})?/gi`.
  - Atribut yang dikenali hanya `name` (bentuk `name="…"`).
  - Format keluaran: `::media[<cid>]{name="<nama, \" dan \\ di-escape>"}`.
  - `client_id` baru = `crypto.randomUUID()` (fallback: 32 hex acak).
- **Ekstensi yang diterima** (sama dengan server): `mp3 m4a m4b aac wav ogg oga opus webm flac amr 3gp 3g2 mp4 m4v mov mkv`.
  - Batas klien 2048 MB.
  - Potongan 5 MiB (`5 * 1024 * 1024`).
  - Jeda ulang: 1, 2, 4, 8, 16, lalu 30 detik seterusnya; langsung dicoba lagi saat event `online`.
- **Teks UI (persis):**
  - tombol: `🎬 Audio/Video`;
  - tooltip offline: `Butuh koneksi internet untuk mengunggah audio/video`;
  - note belum tersimpan: `Simpan catatan dulu, lalu lampirkan media`;
  - `File terlalu besar (maks 2 GB)`;
  - `Format tidak didukung`;
  - `Mengunggah… {p}%`;
  - `Batal`;
  - `Sedang diunggah oleh {nama}`;
  - `Memproses…`;
  - `Unggahan terhenti — pilih file yang sama untuk melanjutkan`;
  - `File berbeda — pilih file yang sama dengan yang diunggah`;
  - `Format ini mungkin tidak bisa diputar di perangkat ini`;
  - `Unduh`;
  - `Butuh koneksi untuk memutar`;
  - `Media tidak tersedia untukmu: sudah dihapus atau bukan bagian dari catatan ini.`;
  - `Hapus`;
  - peringatan tutup tab saat unggah aktif memakai `beforeunload` bawaan browser.
- **Kartu:** elemen `div.note-media-card[data-media-card][data-media-cid]`.
  - Di editor ditambah kelas `editor-media-card`.
  - Isi kartu selalu dibuat oleh `TF.mediacard.cardHtml(view)`. Semua teks dari server/isi note di-escape lewat `TF.safehtml`.
- **Status kartu** (`TF.mediacard.viewFor`): `loading | offline | missing | uploading-local | uploading-stalled | uploading-other | processing | ready | failed`.
  - `processing` dicek ulang tiap 5 detik.
  - Player: `<video controls preload="metadata" playsinline>` / `<audio controls preload="metadata">`.
  - URL diminta saat kartu masuk viewport (`IntersectionObserver`, fallback langsung).
- **Hak hapus di kartu/daftar:** `uploaded_by == uid` atau `uid == pemilik note`; `uid = Number(localStorage.tf_user_id)`.
- **Service worker:**
  - `/media/` tidak di-intercept sama sekali (`return` sebelum `respondWith`);
  - `/api/media/…` dan `/api/scratchpad/<id>/media…` network-only semua method (offline → 503 `OFFLINE`, tanpa cache);
  - modul baru di-precache.
- **Versi:**
  - SW `taskflow-v425-note-media` di **semua** tempat yang memuat `taskflow-v424-xss-hardening` (`sw.js:1`, `index.html` `__SW_VERSION` + fallback About, `webapp.py` `sw_cache`, `tests/test_version.py`, dan tes node yang mencocokkan string itu);
  - `app.css?v=335` beserta tes yang mematoknya.
  - Bila `main` sudah memakai v425 saat merge, ambil nomor berikutnya (Ruling di ledger).
- **Tauri:** `src-tauri/tauri.conf.json` `media-src 'self' blob: https://todo.yatno.web.id`.
- **Di luar cakupan:**
  - lampiran media di TaskFormModal mode note (attach di sana memang nonaktif);
  - rekam langsung;
  - putar offline.

## Review Focus

1. **Token URL kedaluwarsa saat video dijeda lebih dari 6 jam.** Saat `error` setelah `expires_at`, meta diminta ulang, `src` diganti, dan posisi `currentTime` (dan status play) dipulihkan. → Task 4.
2. **Reload/tutup tab di tengah unggah, lalu memilih file lain.** File yang tidak cocok (nama + ukuran + `lastModified`) ditolak dengan pesan, dan unggahan tidak tercampur. → Task 2 (manajer), Task 5 (UI).
3. **Note dibuat offline (id lokal) lalu langsung diberi media.** `__pushNow` dulu (maks 5 dtk); tetap belum ada id server → toast, tanpa direktif yatim. → Task 5.
4. **Direktif `::media` ditulis/ditempel tangan dengan nama berisi HTML/kutip**, atau `client_id` milik note lain. Kartu tampil ter-escape, dan id asing → `missing` (pesan seragam). → Task 1, 3, 4.
5. **Service worker menyimpan respons `/media/` atau meta bertanda tangan.** Seek harus tetap 206 dari jaringan, dan meta tidak pernah dilayani dari cache. → Task 7.

---

### Task 1: `TF.mediadirective` + jembatan CI untuk tes node media

**Files:**
- Create: `static/offline/mediadirective.js`, `tests/offline/mediadirective.test.js`, `tests/test_note_media_ui_node.py`
- Modify: `static/index.html` (`<script>` di samping `drawdirective.js` ~304), `static/sw.js` (`STATIC` di samping `drawdirective.js` ~26)

**Interfaces:**
- Produces `TF.mediadirective` / `module.exports`:
  - `MEDIA_REGEX` (global, i);
  - `parseMediaDirective(text) -> {cid, name} | null` (kecocokan pertama);
  - `formatMediaDirective({cid, name}) -> string`;
  - `newClientId() -> string`;
  - `isMediaFileName(name) -> boolean` (ekstensi dari Global Constraints, tidak peka huruf);
  - `MEDIA_EXTS: string[]`;
  - `remarkMediaPlugin` (pemisah text node → node `{type:'mediaDirective', cid, name}`, pola `remarkDrawPlugin`).
- Produces `tests/test_note_media_ui_node.py`: menjalankan `node --test tests/offline/mediadirective.test.js tests/offline/mediaupload.test.js tests/offline/mediacard.test.js` (file yang belum ada dilewati), assert `# fail 0`. Pola: `tests/test_safehtml_parity_node.py`.

- [ ] **Step 1: Tulis tes yang gagal**

```js
test('parse direktif biasa dan ter-escape remark', () => {
  assert.deepEqual(parseMediaDirective('::media[abc-1]{name="rapat.m4a"}'), {cid:'abc-1', name:'rapat.m4a'});
  assert.deepEqual(parseMediaDirective('\\::media\\[abc\\]\\{name="x"\\}'), {cid:'abc', name:'x'});
  assert.equal(parseMediaDirective('::media[a/b]'), null);
  assert.equal(parseMediaDirective('::media[' + 'a'.repeat(65) + ']'), null);
});
test('format → parse bolak-balik, kutip & backslash', () => {
  const s = formatMediaDirective({cid:'c1', name:'a "b" \\ c.mp3'});
  assert.deepEqual(parseMediaDirective(s), {cid:'c1', name:'a "b" \\ c.mp3'});
});
test('atribut lain diabaikan', () => { /* {name="x" onerror=alert(1)} → name 'x' saja */ });
test('isMediaFileName', () => { /* 'A.MP4' true, 'x.pdf' false, 'mp3' false (tanpa titik) */ });
test('remarkMediaPlugin memecah teks jadi node mediaDirective', () => { /* pola drawdirective.test.js */ });
test('index.html memuat script & sw.js mem-precache mediadirective.js', () => { /* fs + regex */ });
```

- [ ] **Step 2: Jalankan → FAIL.** `node --test tests/offline/mediadirective.test.js` → `Cannot find module`.
- [ ] **Step 3: Implementasi** modul (UMD seperti `drawdirective.js`), `<script>` dan entri precache, serta jembatan pytest.
- [ ] **Step 4: Jalankan → PASS.** `node --test tests/offline/mediadirective.test.js` dan `python -m pytest tests/test_note_media_ui_node.py -q`.
- [ ] **Step 5: Commit** `feat(media-ui): modul direktif ::media + jembatan CI tes node`

---

### Task 2: `TF.mediaupload` — manajer unggah bertahap

**Files:**
- Create: `static/offline/mediaupload.js`, `tests/offline/mediaupload.test.js`
- Modify: `static/index.html` (`<script>`), `static/sw.js` (`STATIC`)

**Interfaces:**
- Produces `TF.mediaupload.createManager(deps) -> manager`. `deps`:
  - `{fetch, apiUrl, getToken, storage, now, setTimeout, clearTimeout, isOnline, chunkSize = 5 MiB, maxBytes = 2048 MiB}`;
  - `storage` = objek seperti `localStorage`, kunci `tf_media_uploads` berisi JSON `{[cid]: {cid, noteId, attId, name, size, lastModified}}`.
- `manager` menyediakan:
  - `start({file, noteId, cid}) -> Promise<state>`: validasi ukuran/ekstensi → init → loop PATCH → complete;
  - `resume(cid, file) -> Promise<state>`: tolak bila file tidak cocok;
  - `cancel(cid) -> Promise<void>`: hentikan loop, `DELETE /api/scratchpad/attachments/{attId}`, hapus dari storage;
  - `get(cid) -> state | null`;
  - `pending() -> entry[]`;
  - `subscribe(fn) -> unsubscribe` (fn dipanggil `(cid, state)`);
  - `kick()`: mencoba ulang semua unggahan yang sedang menunggu jeda; dipanggil dari event `online`;
  - `hasActive() -> boolean`.
- `state = {cid, attId, phase, sent, size, error}`, dengan `phase ∈ uploading | waiting | completing | done | failed | canceled`.
  - `error` memakai teks persis dari Global Constraints, atau `detail` server untuk 4xx.

- [ ] **Step 1: Tulis tes yang gagal** (fetch palsu yang mencatat request; `setTimeout` palsu)

```js
test('unggah 12 MB jadi 3 PATCH dengan Upload-Offset 0, 5M, 10M lalu complete', ...);
test('409 offset → GET upload → lanjut dari received_bytes (tanpa kirim ulang yang sudah diterima)', ...);
test('error jaringan → waiting, jeda 1s lalu 2s, kick() langsung mencoba lagi', ...);
test('404 saat PATCH → failed, entri storage dihapus', ...);
test('507 → failed dengan detail server, tanpa retry', ...);
test('file > 2048 MB → error "File terlalu besar (maks 2 GB)" tanpa request', ...);
test('ekstensi .pdf → "Format tidak didukung" tanpa request', ...);
test('storage menyimpan entri sampai done lalu menghapusnya', ...);
test('resume dengan file berbeda (size/lastModified) → error "File berbeda — pilih file yang sama dengan yang diunggah"', ...); // Review Focus 2
test('resume dengan file sama → GET offset lalu PATCH dari offset itu', ...);
test('cancel di tengah loop → DELETE lampiran, tidak ada PATCH berikutnya', ...);
test('Authorization Bearer dan apiUrl dipakai di semua request', ...);
```

- [ ] **Step 2: Jalankan → FAIL.**
- [ ] **Step 3: Implementasi.**
  - Satu loop per `cid`; `Blob.slice` per potongan.
  - Init idempoten: `start` dengan `cid` yang sudah ada di server memakai `received_bytes` dari respons init.
  - Respons `uploading` dengan `received_bytes > 0` dilanjutkan.
  - Tanpa dependensi DOM.
- [ ] **Step 4: Jalankan → PASS** (`node --test tests/offline/mediaupload.test.js`, `python -m pytest tests/test_note_media_ui_node.py -q`).
- [ ] **Step 5: Commit** `feat(media-ui): manajer unggah bertahap yang bisa dilanjutkan`

---

### Task 3: `TF.mediacard` — model tampilan + HTML kartu

**Files:**
- Create: `static/offline/mediacard.js`, `tests/offline/mediacard.test.js`
- Modify: `static/index.html` (`<script>`), `static/sw.js` (`STATIC`)

**Interfaces:**
- Consumes `TF.safehtml` (`escapeHtml`, `escapeAttr`): di browser dari `window.TF`, di node lewat `require('./safehtml.js')`.
- Produces `TF.mediacard`:
  - `formatDuration(ms) -> string | ''`: `m:ss`, atau `h:mm:ss` bila ≥ 1 jam, sama dengan server;
  - `viewFor({meta, httpStatus, online, upload, uid, noteOwnerId, nameAttr, canPlay}) -> view`;
    - `meta` = payload API atau `null`; `upload` = state `TF.mediaupload` untuk `cid` ini atau `null`;
    - `canPlay(mime) -> '' | 'maybe' | 'probably'`;
  - `cardHtml(view) -> string` (isi dalam kartu);
  - `playerAttrs(view) -> {tag:'video'|'audio', src, poster, mime}`.
- `view = {state, name, kind:'audio'|'video'|null, durationText, progress, uploaderName, error, canDelete, canCancel, warnFormat, downloadUrl}`, dengan `state` dari Global Constraints.
  - Aturan `viewFor`:
    - offline tanpa meta → `offline`;
    - `httpStatus === 404` → `missing`;
    - meta `uploading`:
      - upload lokal aktif → `uploading-local`;
      - `uploaded_by === uid` tanpa upload lokal → `uploading-stalled`;
      - selain itu → `uploading-other`;
    - `processing` / `ready` / `failed` → sesuai status.
  - Nama = `meta.original_name || nameAttr || 'Media'`.

- [ ] **Step 1: Tulis tes yang gagal**

```js
test('formatDuration', () => { assert.equal(formatDuration(62000), '1:02'); assert.equal(formatDuration(3723000), '1:02:03'); assert.equal(formatDuration(null), ''); });
test('viewFor: 404 → missing; offline → offline; uploading milik sendiri tanpa upload lokal → uploading-stalled', ...);
test('viewFor: uploading orang lain → uploading-other dengan uploaderName', ...);
test('viewFor: ready + canPlay "" → warnFormat true', ...);
test('viewFor: canDelete hanya pengunggah atau pemilik note', ...);
test('cardHtml meng-escape nama dan pesan', () => {
  const h = cardHtml(viewFor({meta:{status:'failed', original_name:'<img src=x onerror=1>', error:'"><b>'}, ...}));
  assert.ok(!h.includes('<img src=x') && !h.includes('"><b>'));
});
test('cardHtml memakai teks persis', () => { /* Mengunggah… 40%, Memproses…, Butuh koneksi untuk memutar, pesan missing, stalled */ });
test('playerAttrs: video dengan poster, audio tanpa poster', ...);
```

- [ ] **Step 2: Jalankan → FAIL.**
- [ ] **Step 3: Implementasi.**
  - Ready: `cardHtml` **tidak** membuat elemen `<video>`/`<audio>`. Isinya caption + slot `<div class="note-media-player" data-media-player></div>` + tautan `Unduh` (`download_url` di-`apiUrl` oleh pemanggil, dikirim lewat `view.downloadUrl`), supaya player dibuat via DOM API di Task 4 dan tidak ikut terhapus saat re-render.
  - Tombol aksi memakai `data-media-action="cancel|resume|delete|retry"`.
- [ ] **Step 4: Jalankan → PASS** (node + jembatan pytest).
- [ ] **Step 5: Commit** `feat(media-ui): model tampilan dan HTML kartu media`

---

### Task 4: Mode baca — placeholder kartu, hidrasi, CSS

**Files:**
- Modify: `static/index.html`:
  - `prepMarkdownBlocks` ~21164 (blok baru setelah `::draw` ~21264-21303) + return ~21348;
  - `markdownPlaceholderKeyRe` ~21368 (prefix `MEDIABLK`);
  - `renderMarkdown` ~21399 (destructure ~21408, daftar map ~21444, panggil hidrasi seperti ~21445);
  - fungsi baru `window.hydrateMediaCards` di samping `hydrateDrawingPreviews` ~21986;
  - efek NotePanel ~28105 (panggil dengan `noteId`, `noteOwnerId`);
  - guard dblclick ~28129 (tambah `[data-media-card]`);
  - `handlePrint` ~27779 (tanpa hidrasi player).
- Modify: `static/app.css`: gaya `.note-media-card` di blok "Note Inline Draw Card Embed" ~2070; aturan print di `@media print` ~1093 (sembunyikan player, tampilkan caption).
- Modify: `static/offline/notemap.js` ~195 (ringkasan membuang `::media`, pola `::draw`).
- Test: `tests/offline/render_markdown_media.test.js` (pola slice `render_markdown_xss.test.js`); tambah kasus di `tests/offline/notemap.test.js`.

**Interfaces:**
- Consumes `TF.mediadirective.MEDIA_REGEX`, `TF.mediacard.*`, `window.__mediaUploads` (Task 5; perlakukan bila belum ada sebagai `null`), `apiUrl`, `__token`.
- Produces:
  - `window.hydrateMediaCards(root, {noteId, noteOwnerId}) -> void`;
  - `window.__mediaMetaCache` (Map `noteId:cid → {meta, at}`; meta `ready` dipakai ulang sampai 60 dtk sebelum `expires_at`).
  - Dipakai Task 5 (editor) dengan argumen yang sama.

- [ ] **Step 1: Tulis tes yang gagal**

```js
test('renderMarkdown: ::media jadi kartu ber-data-media-cid, nama ter-escape, tanpa <video> mentah', ...);
test('renderMarkdown: <video src=x> yang diketik tetap teks', ...);
test('renderMarkdown: ::media di dalam blok kode tetap literal', ...);   // berbeda dengan ::draw di server — klien sudah melindungi kode
test('placeholder MEDIABLK tanpa nonce yang benar tidak terisi', ...);
test('notemap: ringkasan membuang ::media', ...);
test('index.html: hydrateMediaCards ada, dipanggil di efek NotePanel dengan noteId, dan guard dblclick memuat [data-media-card]', ...); // struktural
```

- [ ] **Step 2: Jalankan → FAIL.**
- [ ] **Step 3: Implementasi `hydrateMediaCards`.** Untuk tiap `[data-media-card]` yang belum `data-media-bound`:
  1. Saat terlihat: offline → render `offline`. Online → `GET /api/scratchpad/{noteId}/media/by-client/{cid}` (`fetch` + `apiUrl` + Bearer; 404 → `missing`).
  2. Render `cardHtml(viewFor(...))`.
  3. `ready`: buat player sekali (DOM API, `src = apiUrl(play_url)`, `poster = apiUrl(poster_url)`). Listener `error`: bila `Date.now()/1000 >= expires_at - 30` → minta meta baru, simpan `currentTime` + `!paused`, ganti `src`, pulihkan posisi (Review Focus 1).
  4. `processing`: jadwalkan cek ulang 5 dtk selama kartu masih di DOM.
  5. `uploading-local`: berlangganan `__mediaUploads.subscribe` untuk progres; saat `done`, ambil meta lagi.
  6. Event `online` → hidrasi ulang kartu `offline`.
  7. Klik `data-media-action` lewat delegasi di `root`:
     - `cancel` → `__mediaUploads.cancel(cid)`;
     - `resume` → `<input type=file>` → `__mediaUploads.resume(cid, file)`;
     - `delete` → konfirmasi → `DELETE …/attachments/{id}` → render `missing`;
     - `retry` → hidrasi ulang.
- [ ] **Step 4: Jalankan → PASS**, plus `node temporary_files/check_inline_scripts.js static/index.html` (atau pemeriksa inline yang ada) OK.
- [ ] **Step 5: Commit** `feat(media-ui): kartu media di mode baca dengan pemutar, progres dan pembaruan URL`

---

### Task 5: Editor — node Milkdown, tombol 🎬, unggah dari note

**Files:**
- Modify: `static/index.html`:
  - `createMediaPlugin(MB)` baru di samping `createDrawingPlugin` ~24040, didaftarkan di rantai `.use(...)` ~23358;
  - `handleContainerClick` ~23483 (cabang `.editor-media-card` → delegasi aksi yang sama);
  - efek hidrasi editor ~23680 (panggil `hydrateMediaCards(containerRef.current, {noteId, noteOwnerId})`);
  - `NoteToolbar` ~22596 (tombol `🎬 Audio/Video` + input `accept` dari `MEDIA_EXTS`, nonaktif saat offline/`noteId` kosong);
  - `NoteModal` ~26620 (prop `onInsertMedia`);
  - level App: buat `window.__mediaUploads = TF.mediaupload.createManager({...})` sekali, listener `online` → `kick()`, `beforeunload` saat `hasActive()`;
  - menu slash ~22890 (opsional, entri yang sama dengan tombol).
- Test: `tests/offline/note_media_editor.test.js` (struktural + logika resolusi id).

**Interfaces:**
- Consumes Task 1–4.
- Produces `async function ensureServerNoteId(noteId) -> number | null`: id numerik → kembalikan; selain itu `await window.__pushNow?.()` dengan batas 5 dtk, lalu `TF.idmap.serverIdOf` / baris lokal `server_id`; gagal → `null`.
- Alur sisip:
  1. Pilih file → validasi ekstensi/ukuran (toast bila gagal).
  2. `ensureServerNoteId`; `null` → toast `Simpan catatan dulu, lalu lampirkan media` **tanpa** menyisipkan direktif (Review Focus 3).
  3. `cid = newClientId()` → `insertMarkdown('\n\n' + formatMediaDirective({cid, name}) + '\n\n')`.
  4. `__mediaUploads.start({file, noteId, cid})`.
  5. Kartu di editor hidrasi ke `uploading-local`.

- [ ] **Step 1: Tulis tes yang gagal**

```js
test('ensureServerNoteId: angka langsung; cid lokal → pushNow lalu idmap; tetap kosong → null', ...); // fungsi diambil dengan slice index.html + vm
test('createMediaPlugin: parse ::media → node media, toMarkdown → formatMediaDirective', ...); // struktural + panggil toMarkdown dengan MB palsu
test('NoteToolbar: tombol "🎬 Audio/Video", accept memuat .mp3 dan .mov, title offline persis', ...);
test('App membuat __mediaUploads sekali dan memasang online→kick serta beforeunload', ...);
```

- [ ] **Step 2: Jalankan → FAIL.**
- [ ] **Step 3: Implementasi.**
  - Node: `MB.$node('media', …)` inline atom, attrs `{cid, name}`.
  - `toDOM` → `['div', {class:'note-media-card editor-media-card', 'data-media-card':'', 'data-media-cid':cid, 'data-media-name':name, contenteditable:'false'}]`.
  - `parseMarkdown` mencocokkan `mediaDirective`.
  - `toMarkdown` → teks `formatMediaDirective`.
  - `MB.$remark('media-remark', () => TF.mediadirective.remarkMediaPlugin)`.
  - Tanpa rebuild bundle Milkdown.
- [ ] **Step 4: Jalankan → PASS**, pemeriksa inline OK.
- [ ] **Step 5: Commit** `feat(media-ui): unggah audio/video dari editor note`

---

### Task 6: Daftar lampiran dan ekspor

**Files:**
- Modify: `static/index.html`:
  - daftar lampiran NoteModal ~26935-26985;
  - daftar NotePanel ~28736-28760;
  - prefetch DOCX ~27934/27956 (lewati `kind === 'media'`);
  - `openAttachment`/`mediaUrl` ~528-552 (baris media tidak dibuka lewat `/view` di APK; pakai meta → `apiUrl(download_url)`).
- Test: `tests/offline/note_media_attachments.test.js`.

**Interfaces:**
- Consumes `TF.mediacard.formatDuration`, hak hapus dari Global Constraints.
- Baris media: ikon 🎬/🎵, nama ter-escape, durasi, label status (`Mengunggah…`/`Memproses…`/error), tombol hapus sesuai hak (NoteModal saja, seperti sekarang). Klik → gulir ke kartu `[data-media-cid]` di note bila ada, selain itu buka `download_url`.

- [ ] **Step 1: Tulis tes yang gagal**: struktural — kedua daftar memeriksa `kind === 'media'`, prefetch DOCX melewati media, label durasi memakai `formatDuration`.
- [ ] **Step 2: Jalankan → FAIL.**
- [ ] **Step 3: Implementasi.**
- [ ] **Step 4: Jalankan → PASS.**
- [ ] **Step 5: Commit** `feat(media-ui): media di daftar lampiran note`

---

### Task 7: Service worker, versi, Tauri CSP, E2E, dokumentasi

**Files:**
- Modify: `static/sw.js` (aturan media sebelum cabang statis/`/api/` ~250-290; `CACHE`).
- Modify: tempat versi SW dan `app.css?v` (Global Constraints; daftar file dari `grep -rn "taskflow-v424-xss-hardening\|app.css?v=334"`).
- Modify: `src-tauri/tauri.conf.json` (`media-src`).
- Create: `temporary_files/e2e_note_media.py` (screenshot ke `temporary_files/e2e_note_media/`, folder di-.gitignore seperti E2E lain).
- Modify: `.agents/CURRENT_STATE.md` (entri backend → "DI-MERGE (#51), DEPLOY & AKTIF 2026-10-20, diverifikasi Range 206 di produksi"; entri baru PR frontend), `.agents/SESSION_LOG.md`.
- Test: `tests/offline/sw_media.test.js`.

**Interfaces:**
- Consumes semua task sebelumnya.

- [ ] **Step 1: Tulis tes yang gagal**

```js
test('sw: /media/ tidak memanggil respondWith', ...);              // harness fetch-event palsu, pola tes SW yang ada (cari tes trash SW)
test('sw: GET /api/media/7 network-only, offline → 503 OFFLINE, tidak di-cache', ...);
test('sw: /api/scratchpad/5/media/by-client/x network-only', ...);
test('sw: precache memuat mediadirective/mediaupload/mediacard', ...);
test('tauri csp media-src memuat https://todo.yatno.web.id', ...);
```

- [ ] **Step 2: Jalankan → FAIL.**
- [ ] **Step 3: Implementasi aturan SW + kenaikan versi.** Jalankan seluruh `node --test "tests/offline/*.test.js"`.
  - Bandingkan jumlah gagal dengan `origin/main` di lingkungan yang sama. Baseline env ini: 76/1076 gagal karena lingkungan; branch tidak boleh menambah kegagalan.
  - Jalankan `python -m pytest tests/ -q`.
- [ ] **Step 4: E2E Playwright** (`uvicorn` lokal, `MEDIA_ACCEL=0`, dua akun pemilik + anggota workspace; wajib env `PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS=1` dan tunggu reload `controllerchange` pertama, sesuai catatan E2E sebelumnya). Alur:
  1. Unggah video (mp4 ffmpeg 3 dtk) dan audio (mp3) dari editor → progres → kartu `ready`.
  2. Putar di mode baca; geser `currentTime` → request `Range` → 206 (bukan dari SW).
  3. Unggah 12 MB, putus jaringan di tengah (`context.route` abort untuk `/upload`), pulihkan → selesai tanpa mengulang dari 0.
  4. Reload saat unggah → kartu `uploading-stalled` → pilih file berbeda (ditolak), lalu file sama (lanjut).
  5. Anggota workspace memutar media note bersama, tanpa tombol hapus untuk media pemilik.
  6. Offline → kartu `Butuh koneksi untuk memutar`; tombol 🎬 nonaktif dengan tooltip.
  7. Direktif dengan nama berbahaya dan `cid` note lain → teks ter-escape / pesan `missing`.
  8. Token kedaluwarsa (monkeypatch `MEDIA_URL_TTL_SEC=5` di server E2E) → jeda, tunggu, putar → posisi dipulihkan.

  Catat hasil per alur.
- [ ] **Step 5: Commit** `feat(media-ui): SW network-only media, naik versi, CSP Tauri, E2E` dan `docs(agents): status media`.
