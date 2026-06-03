# Offline Wiring `index.html` — Design (Plan #1e(b))

**Status:** Disetujui 2026-06-03
**Parent spec:** `docs/superpowers/specs/2026-06-03-offline-first-local-data-layer-design.md` (sub-proyek #1)
**Predecessors:** #1a scaffold, #1b tasklogic, #1c taskrepo, #1d taskquery, #1e(a) tags+recurrence — SELESAI, 106 test Node hijau di `main`.

## Tujuan

Menyambungkan modul `static/offline/*` ke aplikasi React di `static/index.html` sehingga **domain task berjalan local-first di browser** (Model B): objek `api` disergap, request task ke route yang sudah diport dilayani dari IndexedDB lokal (bukan jaringan), dengan **hydration** awal yang menarik task dari server sekali saat boot. Ini bagian pertama yang **diverifikasi di browser** (bukan Node).

## Keputusan terkunci (brainstorming 2026-06-03)

1. **Dispatch = local-first selalu (Model B).** Online pun, route task yang diport baca/tulis ke IndexedDB lokal; tulis hanya direkam `_outbox` (Opsi B, tidak push ke server sampai sub-proyek #2). Konsekuensi "pulau" diterima (masa development).
2. **`OfflineDB` lama di-rename agar koeksis.** Konstanta `NAME` di IIFE `OfflineDB` (index.html ~baris 1338) diganti dari `"taskflow-offline"` → `"taskflow-legacy-cache"`, supaya tidak tabrakan dengan `db.js` (DB `"taskflow-offline"` v2 yang migrasinya menghapus store `cache`/`queue`). Notes/habits tetap memakai `OfflineDB` apa adanya; layer baru murni untuk task.
3. **Hydration = tasks saja.** Pull `GET /api/tasks?include_done=true` (jaringan asli) → upsert ke store `tasks` lokal. Tag & `recurring_exceptions` TIDAK di-hydrate.
4. **`/done` & `/focus` TIDAK diport** (tetap ke jaringan). Sub-entitas task (`/subtasks`, `/child-tasks`, `/notes`, `/attachments`) juga tetap ke jaringan. Limitasi "pincang" diterima: untuk task buatan-lokal (hanya punya `cid`, belum punya `server_id`) aksi-aksi ini akan 404 sampai sync #2. Terdokumentasi.

## Non-goals (eksplisit)

- ❌ Port `/done`, `/focus`, subtasks, task_notes, attachments, child-tasks (domain/aksi sendiri — plan lain).
- ❌ Push/pull/sinkronisasi ke server (sub-proyek #2).
- ❌ Migrasi notes/habits/mindmaps ke layer baru (plan domain masing-masing).
- ❌ Ekspansi occurrence (tetap `computeOccurrences` di frontend).
- ❌ Hydration tag/exceptions; multi-device; konflik.

## Identitas: `id` ⇄ `cid`

UI memakai `t.id` di semua URL & key. Aturan:

- **Row task lokal mengekspos `id = server_id != null ? server_id : cid`.** Task hasil hydration → `id = server_id` (integer, agar route jaringan tak-diport tetap jalan untuk task ter-sync). Task buatan-lokal → `id = cid` (UUID).
- **Handler route lokal me-resolve `id` di path ke `cid`** via `resolveCid(idOrCid)`: jika ada task dengan `cid === idOrCid` → pakai itu; selain itu cari task dengan `server_id == idOrCid` → `cid`-nya; jika tak ada → `null` (handler balas 404-equiv / reject).
- **Map yang di-key task (exceptions) di-remap** dari `cid` → display-id (`server_id||cid`) oleh handler, agar cocok dengan `t.id` di UI.

## Route yang disergap (ported) → handler lokal

| Method & pattern | Handler lokal | Catatan shaping |
|---|---|---|
| `GET /api/tasks` | `taskquery.listTasks(query)` | tiap row + `id`; `query.tag/status/priority/quadrant/project/context/include_done` |
| `GET /api/tasks/:id` | `resolveCid`→`taskrepo.getTask` | + `id`; 404-equiv jika tak ada |
| `POST /api/tasks` | `taskrepo.createTask(body)` | + `id`; recurrence & tag ditangani repo |
| `PUT /api/tasks/:id` | `resolveCid`→`taskrepo.updateTask` | + `id` |
| `DELETE /api/tasks/:id` | `resolveCid`→`taskrepo.deleteTask` | `{ok:true}` |
| `GET /api/summary` | `taskquery.getSummary` | apa adanya |
| `GET /api/projects` | `taskquery.getProjects` | array string |
| `GET /api/contexts` | `taskquery.getContexts` | array string |
| `GET /api/tasks/:id/tags` | `resolveCid`→`tagrepo.getEntityTags('task',cid)` | `[{name,color}]` |
| `GET /api/tags` | `tagrepo.getAllTags` | hanya untuk `entity_type` absen/`task`; `entity_type=note` dilewati ke jaringan oleh intercept (lihat "Mekanisme intercept" / `isNoteTagsCall`) |
| `DELETE /api/tasks/:id/tags/:name` | `resolveCid`→`tagrepo.removeEntityTag` | `{ok:true}` |
| `GET /api/recurring/exceptions` | `recurrence.getExceptions(from,to)` lalu remap key `cid`→display-id | `{ [id]: [...] }` |
| `POST /api/tasks/:id/occurrences/:date/mark` | `resolveCid`→`recurrence.markOccurrence` | record |

**`GET /api/tags` & `entity_type`:** server `/api/tags` mengembalikan tag milik user (dipakai task autocomplete) dan juga dipanggil dgn `?entity_type=note` untuk note-tags. Karena note-tags belum lokal, **route `GET /api/tags` hanya disergap bila TANPA `entity_type` atau `entity_type=task`**; dengan `entity_type=note` dibiarkan ke jaringan (note domain belum offline). Implementasi: registrasi `GET /api/tags` tetap, handler memeriksa `query.entity_type` — jika `note`, lempar sentinel agar intercept fallback ke jaringan (atau: intercept memeriksa dan tak men-dispatch). Lihat "Mekanisme intercept".

Route task lain (`/done`, `/focus`, `/subtasks`, `/child-tasks`, `/notes`, `/attachments`, `/api/recurring/check-expiry`) **tidak diregistrasi** → otomatis fallback ke jaringan.

## Arsitektur modul

| Modul | Status | Tanggung jawab | Uji |
|---|---|---|---|
| `static/offline/taskroutes.js` | **BARU** | `buildTaskRouter()` → `router` (pakai `router.makeRouter`) dgn semua route ported teregistrasi + shaping + `resolveCid` + remap exceptions | Node |
| `static/offline/hydrate.js` | **BARU** | `taskFromServer(dict, getCid)` (pure mapper) + `hydrateTasks(serverTasks)` (upsert ke store) + `ensureTasks(rawFetch)` (orkestrasi sekali) | Node (mapper+upsert) |
| `static/index.html` | **UBAH** | `<script>` modul (urutan), rename `OfflineDB` DB, intercept `api.fetch`, panggil hydration di `fetchAll` | Browser |
| `static/sw.js` (atau `sw.js`) | **UBAH** | bump versi cache + precache file `static/offline/*` | Browser |

### `taskroutes.js`

`buildTaskRouter(deps)` — `deps` opsional untuk uji (default ke `root.TF.{taskrepo,taskquery,tagrepo,recurrence,db,router}`). Mengembalikan objek `router` (dari `makeRouter()`), siap dipakai `hasRoute`/`dispatch`. Handler async mengembalikan objek JS (bukan Response). `resolveCid(idOrCid)` membaca store `tasks`. Helper `withId(row)` menambah `row.id = row.server_id != null ? row.server_id : row.cid`. `displayId(cid)` kebalikannya untuk remap exceptions.

### `hydrate.js`

- `taskFromServer(dict, getCid)` — map dict server → record lokal: `cid = getCid(dict.id)` (stabil via `_idmap`/lookup), `server_id = dict.id`, `parent_cid = dict.parent_id ? getCid(dict.parent_id) : null`, salin `title, description, gtd_status, priority, quadrant, project, context, deadline, waiting_for, completed_at, progress, is_focused, assigned_to, recurrence_type, recurrence_days, recurrence_end_date, recurrence_notif_level, created_at, updated_at`, `list_cid=null`, `deleted=false`, `dirty=0`, `base_rev = dict.updated_at`.
- `hydrateTasks(serverTasks)` — dua-pass: (1) untuk tiap `dict` pastikan `cid` (buat & catat `_idmap` `task:<server_id>` bila belum ada), (2) `put` record hasil `taskFromServer` ke store `tasks`. Idempoten (re-hydrate meng-upsert; tidak menggandakan cid karena `_idmap` stabil). Tidak menyentuh task dgn `server_id===null` (buatan-lokal — tak ditimpa).
- `ensureTasks(rawFetch)` — sekali per sesi: panggil `rawFetch("/api/tasks?include_done=true")` (jaringan asli, **bukan** `api`), lalu `hydrateTasks`. Set flag meta `tasks_hydrated_at`. Aman dipanggil berkali-kali (guard in-memory promise).

### Perubahan `index.html` (minimal, browser-verified)

1. **Script tags** sebelum `<script>` aplikasi (baris ~1306), urutan dependensi:
   `ids, db, meta, idmap, outbox, blobstore, router, tasklogic, tagrepo, taskrepo, taskquery, recurrence, taskroutes, hydrate`.
   (Modul UMD mendaftar ke `window.TF.*`; referensi antar-modul dilakukan saat call-time, tetapi urutan ini aman.)
2. **Rename `OfflineDB`**: `NAME = "taskflow-legacy-cache"` (baris ~1338). Hanya konstanta itu.
3. **Intercept `api.fetch`**: di awal `api.fetch(url, opts)`, sebelum jaringan:
   ```
   const method = (opts.method || "GET").toUpperCase();
   const R = getTaskRouter();            // lazy: TF.taskroutes.buildTaskRouter(), sekali
   if (R.hasRoute(method, url) && !isNoteTagsCall(method, url)) {
     const body = opts.body ? JSON.parse(opts.body) : undefined;
     try { return await R.dispatch(method, url, body); }
     catch (e) { throw new Error(e.message || "local route error"); }
   }
   // ...lanjut fetch jaringan seperti semula
   ```
   `isNoteTagsCall` = `GET /api/tags` dengan `entity_type=note` (biarkan ke jaringan).
4. **Hydration** di `fetchAll` (baris ~20493): bila `navigator.onLine`, `await TF.hydrate.ensureTasks(window.fetch.bind(window))` **sebelum** `Promise.allSettled(calls...)` (karena `api.get("/api/tasks…")` kini membaca lokal). Bungkus dalam `try/catch` (offline/boot pertama gagal → lanjut pakai lokal apa adanya). Baris `OfflineDB.cacheSet/Get` untuk task/summary/projects/contexts menjadi redundan tetapi tidak berbahaya — dibiarkan (hindari operasi berisiko). Blok apply-queue offline lama untuk task menjadi no-op (queue task kini di `_outbox`, cabang offline-manual mati).
5. **`computeOfflineQuadrant` & cabang offline-manual task** (index.html ~3956–4008, 5573, dll.) menjadi **dead code** di bawah intercept (route ter-intercept tak melempar error jaringan, sehingga `catch(isOfflineErr)` task tak tercapai). Tidak dihapus di plan ini (operasi berisiko di file 22k baris); ditandai superseded. Penghapusan opsional sebagai langkah cleanup terpisah bila verifikasi browser mulus.

### `sw.js`

Bump versi cache (mis. `v109` → `v110`) dan tambahkan `static/offline/*.js` ke daftar precache STATIC, agar app shell + modul tersedia offline. Lihat [[feedback_sw_cache_bump]].

## Data flow (boot online)

```
fetchAll() [online]
  ├─ await TF.hydrate.ensureTasks(window.fetch)   // pull server → upsert local tasks (sekali)
  ├─ api.get("/api/tasks?include_done=true")        // intercept → listTasks(local) → rows+id
  ├─ api.get("/api/summary"|"/projects"|"/contexts")// intercept → local
  └─ api.get("/api/lists"|"/collaborators")         // tak diport → jaringan

Buat task: api.post("/api/tasks", body)
  └─ intercept → taskrepo.createTask → local + _outbox → balas task (+id=cid)

Mark done (BELUM diport): api.post("/api/tasks/<id>/done")
  └─ tak diport → jaringan (404 untuk task buatan-lokal — limp diterima)
```

## Testing

- **Node** (`tests/offline/taskroutes.test.js`): tiap route ported → bentuk respons benar; `resolveCid` (cid langsung, via server_id, tak ada→404-equiv); `withId` (server_id vs cid); remap key exceptions ke display-id; `GET /api/tags?entity_type=note` tidak ditangani (hasRoute true tapi intercept lewati — uji di unit: handler/penanda). Pakai `fake-indexeddb` + seed.
- **Node** (`tests/offline/hydrate.test.js`): `taskFromServer` mapping (parent_cid resolve, recurrence passthrough, dirty=0); `hydrateTasks` idempoten + tak menimpa task `server_id===null`.
- **Browser (manual, didokumentasikan di plan)**: boot online → hydration mengisi list; buat/edit/hapus task offline (DevTools offline) → muncul & persist setelah reload; filter tag; summary/projects/contexts dari lokal; SW cache bump → app shell load offline. Verifikasi tak ada error console; notes/habits (OfflineDB rename) tetap berfungsi.

## Done criteria

1. `taskroutes.js` + `hydrate.js` ada, ter-export, Node-tested.
2. `api` di index.html menyergap route task ported → dilayani lokal; route lain → jaringan.
3. Boot online meng-hydrate task dari server ke lokal sekali; daftar/board/summary/projects/contexts dari lokal.
4. CRUD task + filter tag + recurring mark/exceptions berfungsi offline di browser; `id⇄cid` konsisten.
5. `OfflineDB` di-rename; notes/habits tak regresi. SW cache di-bump + modul ter-precache.
6. Suite Node offline tetap hijau (106 + taskroutes + hydrate). Verifikasi browser lulus.

## Next (di luar scope)

- Cleanup: hapus `computeOfflineQuadrant` + cabang offline-manual task mati (setelah verifikasi).
- Port `/done`, `/focus`, sub-entitas; sub-proyek #2 (sync engine).
