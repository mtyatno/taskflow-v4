# Offline Drawings (#2f-3) Design

**Status:** Disetujui 2026-06-06
**Parent:** Inisiatif offline native (Model B). Sub-proyek #2 (sync engine), domain notes. #1 + #2a–e + #2f-1/f-2 SELESAI & deployed (SW v128, 254 test). Lihat [[project_offline_native]].
**Predecessor state:** Notes personal sudah local-first + sync (#2f-1/f-2). Drawings (tldraw, 1 per note) saat ini online + offline ad-hoc lewat **localStorage** (`draw_pending_<note.id>`, keyed by server id) — TERPISAH dari modul offline. Store `drawings` (key `cid`, index `note_cid`) sudah ada di db.js (v3). `BlobStore` (impl IndexedDB) sudah ada (`blobstore.js`: `makeBlobStore()→{put(bytes,meta)→ref, getBytes(ref), getURL(ref), delete(ref)}`).

## Tujuan

Bawa **drawings** (tldraw canvas per-note) ke local-first: edit offline tersimpan lokal + outbox, buka kembali offline, dan push ke server saat online — disimpan via **BlobStore** (mulus migrasi FS Tauri). Ganti mekanisme localStorage ad-hoc dengan jalur `api.*` ter-intercept.

## Keputusan terkunci (brainstorming 2026-06-06)

1. **Storage = BlobStore / blob_ref.** `data_json` masuk BlobStore (impl IndexedDB sekarang); record drawing kecil menyimpan `blob_ref`. Align master spec ("byte besar jangan di store terstruktur") & migrasi FS Tauri otomatis (ganti impl BlobStore → drawing pindah ke filesystem, lepas kuota webview).
2. **Hydration = lazy read-through (backend nol perubahan).** Tak ada endpoint list-all; drawing di-fetch per-note saat dibuka. `GET` intercept: lokal→balas; online & cache-miss→fetch+cache; offline & miss→null. Sesuai master spec "lazy blob download".
3. **Konflik = LWW by `updated_at`** (drawing punya updated_at, single-owner → kontensi rendah). Read-through saat buka: server lebih baru & lokal clean→adopt; lokal dirty→keep.
4. **Rewire komponen React drawing** agar selalu pakai `api.get/api.put` (intercept tangani offline). Mekanisme localStorage `draw_pending` + guard `navigator.onLine` dipensiun (kini mem-bypass api.put saat offline).

## Non-goals (eksplisit)

- ❌ Ekstraksi aset (base64 gambar dalam tldraw → blob terpisah). Simpan seluruh `data_json` sbg 1 blob. Tunda (optimasi/Tauri).
- ❌ Bulk hydration / offline untuk drawing yang belum pernah dibuka online.
- ❌ FS BlobStore impl (→ #3 Tauri). Pakai impl IndexedDB.
- ❌ Drawing pada shared note (online-only, ikut kebijakan shared note #2h).

## Kontrak server (dari `webapp.py`, TAK diubah)

- `GET /api/drawings/{note_id}` → `{data_json(string), updated_at}`. 404 bila note tak accessible / drawing belum ada.
- `PUT /api/drawings/{note_id}` (`DrawingUpsert{data_json}`): upsert ON CONFLICT(note_id); hanya owner note (403 non-owner). Balas `{updated_at}`. 404 bila note tak ada.

## Bentuk record & `_outbox`

- **Drawing lokal** (store `drawings`, key `cid`, index `note_cid`): `{cid, note_cid, blob_ref, updated_at, deleted:false, dirty, base_rev}`. (Tak perlu `server_id` — drawing di-key note di server; identitas via `note_cid` → note `server_id`.) `data_json` di BlobStore (`blob_ref`).
- **Outbox:** `{op:'upsert', entity_type:'drawing', cid, payload:{note_cid}}`.

## Arsitektur

| Unit | Status | Tanggung jawab | Uji |
|---|---|---|---|
| `static/offline/drawingrepo.js` | **BARU** | `putDrawing`/`getDrawingLocal`/`cacheServerDrawing`/`getDrawing`(read-through) + BlobStore | Node |
| `static/offline/drawingroutes.js` | **BARU** | `registerDrawingRoutes(router)` (GET/PUT /api/drawings/:id) | Node |
| `static/offline/taskroutes.js` | **UBAH** | `buildTaskRouter` panggil `registerDrawingRoutes(router)` | Node |
| `static/offline/syncpush.js` | **UBAH** | `opDrawingUpsert` (note sid resolve, hold-if-unsynced, PUT, base_rev, 404 drop) | Node |
| `static/index.html` | **UBAH** | load modul; configure fetcher; **rewire komponen React drawing** (api.* ; pensiun localStorage draw_pending) | Browser |
| `static/sw.js` | **UBAH** | bump v128→v129 + precache 2 modul | Browser |

### `drawingrepo.js`
BlobStore instance via `TFblob.makeBlobStore()` (module-level). Helpers store `drawings` (getByNoteCid via index `note_cid`, put, delete).
- `putDrawing(noteCid, dataJson, opts)`: cari record by note_cid; `BlobStore.put(dataJson, {mime:'application/json'})→ref`; bila record lama ada `blob_ref` → `BlobStore.delete(old)`; upsert `{cid (lama‖newCid), note_cid, blob_ref:ref, updated_at:now, deleted:false, dirty:1, base_rev:(lama)}`; outbox `{op:'upsert', entity_type:'drawing', cid, payload:{note_cid}}`. Balas record.
- `getDrawingLocal(noteCid)` → record|null (by index).
- `cacheServerDrawing(noteCid, dataJson, updatedAt)`: simpan dari server — `BlobStore.put`+delete-old; upsert `{...,blob_ref, updated_at:updatedAt, dirty:0, base_rev:updatedAt}`.
- `getDrawing(noteCid, opts)` read-through (`opts.fetch(noteCid)→{data_json,updated_at}|null`, `opts.online`): `local=getDrawingLocal`; bila `opts.fetch` & online → `srv=fetch(noteCid)`; bila `srv` & (`!local` ‖ (`local.dirty==0` & `tsEpoch(srv.updated_at)>tsEpoch(local.base_rev)`)) → `cacheServerDrawing`; re-read local; balas `local? {data_json:BlobStore.getBytes(blob_ref), updated_at} : null`.
- `configureFetcher(fn)`: set module-level fetcher dipakai route (di-set index.html boot). Tests panggil langsung dgn `opts.fetch`.

### `drawingroutes.js` → `registerDrawingRoutes(router)`
- `GET /api/drawings/:id` → `resolveNoteCid(id)` (notes store, cid‖server_id) → `getDrawing(noteCid, {fetch:_fetcher, online:navigator.onLine})` → `{data_json,updated_at}`; null → reject 404-style (`Promise.reject(new Error("Drawing not found"))`).
- `PUT /api/drawings/:id` → `resolveNoteCid(id)` → `putDrawing(noteCid, body.data_json)` → `{updated_at}`.
- `resolveNoteCid` via notes store (sama pola `noteroutes`). `buildTaskRouter` panggil `registerDrawingRoutes(router)`.

### `syncpush.js` — `opDrawingUpsert`
- get drawing record by cid; `noteSid = serverIdOf(record.note_cid)`; **`noteSid==null` → leave op** (note belum ter-push; FIFO jamin note create qid lebih kecil → retry drain berikut), return (jangan remove, jangan stop).
- `data_json = BlobStore.getBytes(record.blob_ref)`; `PUT /api/drawings/{noteSid}` body `{data_json}` → 2xx: putDrawing record `{dirty:0, base_rev:resp.updated_at}` + remove op + pushed++; 404 (note hilang)→drop+log; network→stop.
- Dispatch di `processOp`: `if (op.entity_type==='drawing' && op.op==='upsert') return opDrawingUpsert(op, transport, result);`.

### `index.html` + React rewiring
- Load `drawingrepo.js`+`drawingroutes.js` (setelah noteroutes, sebelum taskroutes). Boot: `TF.drawingrepo.configureFetcher((noteCid)=>{ const sid=...serverIdOf...; return __syncRawFetch('/api/drawings/'+sid).then(r=>r.ok?r.json():null); })` — atau fetcher resolve sid sendiri. (Detail di plan.)
- **Rewire komponen drawing** (NoteModal canvas ~baris 15050, fullscreen ~16754, + handler terkait ~8106): pada event `change` dari iframe → **selalu** `api.put('/api/drawings/'+id, {data_json})` (intercept persist lokal+outbox walau offline); pada buka → `api.get('/api/drawings/'+id)` (intercept lokal/read-through). **Hapus** `localStorage draw_pending`, guard `if(!navigator.onLine){...return}`, dan handler `online`/flush localStorage. Badge status (`drawSyncStatus`) boleh tetap untuk umpan balik (saved/saving/offline berdasarkan `navigator.onLine`).
- SW bump v129 + precache `drawingrepo.js`,`drawingroutes.js`.

## Data flow
```
buka canvas: api.get('/api/drawings/'+noteId)
  → intercept → drawingroutes GET → resolveNoteCid → getDrawing(noteCid,{fetch,online})
       lokal ada → balas (online & clean → LWW adopt bila server lebih baru)
       lokal tak ada & online → fetch server → cache → balas
       offline & tak ada → 404
edit (iframe change): api.put('/api/drawings/'+noteId,{data_json})
  → intercept → drawingroutes PUT → putDrawing → BlobStore.put + record dirty:1 + outbox
  → schedulePush (online) → opDrawingUpsert → PUT /api/drawings/{noteSid} → dirty:0,base_rev
```

## Testing
- **Node** `tests/offline/drawingrepo.test.js`: putDrawing (blob_ref di-set, outbox upsert, blob lama dihapus saat overwrite), getDrawingLocal, cacheServerDrawing (dirty:0,base_rev), getDrawing read-through (local-hit tanpa fetch; miss+online→fetch+cache; LWW adopt server-baru-clean; keep local-dirty; offline-miss→null). `tests/offline/drawingroutes.test.js`: GET/PUT via `buildTaskRouter().dispatch` (resolveNoteCid by cid & server_id; PUT→get round-trip). `tests/offline/syncpush.test.js` (extend): opDrawingUpsert (note sid null→op tetap; PUT→base_rev+dirty:0+remove; 404→drop).
- **Browser**: draw offline → tutup/buka offline (persist dari BlobStore); online → `__syncNow()`/auto → drawing di server (cek web lain); draw di web → desktop buka note → read-through cache + tampil; localStorage `draw_pending` tak lagi terpakai; notes/tasks/habits utuh.
- **Deploy:** backend tak berubah → tak perlu restart `taskflow-web`. Verifikasi SW v129 via curl.

## Done criteria
1. `drawingrepo`/`drawingroutes` Node-tested; GET/PUT /api/drawings ter-intercept via buildTaskRouter; `opDrawingUpsert` di syncpush (hold-if-note-unsynced).
2. Drawing offline: edit→BlobStore+lokal+outbox; buka→read-through (lazy); push→server; LWW.
3. Komponen React drawing pakai `api.*`; localStorage `draw_pending` dipensiun; SW v129; backend nol perubahan.
4. Node suite hijau (254 + tambahan); browser-verified.

## Next
- **#2g Mindmap offline** (mirip notes: store `mindmaps`, updated_at, LWW) → **#2h chat/kolaboratif** (+shared notes & `/share`) → **#3 Tauri shell** (.exe/AppImage, FS BlobStore impl) → **#4 Android**.
