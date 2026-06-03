# Spec — Offline-First Local Data Layer (Sub-proyek #1)

**Tanggal:** 2026-06-03
**Status:** Disetujui untuk planning
**Bagian dari:** Inisiatif "Native Desktop & Android Offline Sempurna" (Model B)

---

## 1. Konteks & tujuan besar

TaskFlow V4 saat ini: FastAPI + React SPA (pre-compiled JSX di `static/index.html`) + SQLite di VPS, plus bot Telegram. Sudah berstatus PWA dengan service worker dan offline parsial (modul `OfflineDB` di IndexedDB: store `cache` untuk cache respons HTTP + store `queue` sebagai outbox mutasi task).

**Tujuan akhir inisiatif:** aplikasi dapat berjalan **100% offline dengan sempurna** di desktop (Windows `.exe` + Linux AppImage) **dan** Android, dengan satu basis kode.

**Keputusan arsitektur fondasi (Model B — offline di frontend):**
Data per-device hidup di **IndexedDB sebagai sumber kebenaran** (queryable, bisa cari/filter walau belum pernah dibuka online), bukan menjalankan server lokal per-device (Model A ditolak karena tidak port ke Android). Server VPS Python tetap ada, nanti berperan sebagai **endpoint sync** (sub-proyek #2). Shell desktop = **Tauri** (membungkus frontend; tidak ada Python sidecar). Blob besar disimpan di filesystem via abstraksi (menghindari kuota webview). Distribusi Linux via AppImage demi auto-update Tauri.

### Peta sub-proyek (masing-masing spec sendiri)

| # | Sub-proyek | Inti |
|---|-----------|------|
| **1** | **Data layer lokal (spec ini)** | Semua domain personal jadi sumber-kebenaran di IndexedDB; baca-tulis penuh offline; rekam outbox; hydration awal |
| 2 | Sync engine | Push/pull delta lokal↔VPS, resolusi konflik, multi-device, domain kolaboratif offline |
| 3 | Shell Tauri + auto-update | Bundle frontend, storage permanen, updater bertanda-tangan, `.exe` + AppImage |
| 4 | Android via Tauri v2 | Reuse penuh, offline gratis |

---

## 2. Lingkup sub-proyek #1

### Klasifikasi domain

**Kelompok 1 — Personal / pemilik tunggal (LINGKUP #1, jadi lokal sumber-kebenaran):**
`tasks` (+`subtasks`, `task_notes`, `task_attachments`), `habits` (+`habit_logs`), `scratchpad_notes` (+`drawings`, `note_attachments`, `note_pins`), `mindmaps`, `tags` (+`entity_tags`), `recurring_exceptions`, `note_templates`, `habit_templates`. Turunan: projects, contexts, summary, search.

**Kelompok 2 — Kolaboratif / banyak penulis (TETAP online-only di #1, → #2):**
`shared_lists` (+members, invites), `messages` (chat), notes/mindmap yang di-share, `notifications`, collaborators.

**Kelompok 3 — Server-only (tetap jaringan):**
`users`, `magic_tokens`, `telegram_link_tokens`, `ext_tokens` (auth/identitas). `holidays` (referensi read-only, cache).

### Definisi "offline sempurna" untuk #1
Saat tanpa internet, seluruh domain Kelompok 1: baca dari IndexedDB, tulis ke IndexedDB, navigasi/cari/filter penuh, nol jaringan. Perubahan direkam ke `_outbox` untuk di-sync kelak.

### Non-goals (eksplisit)
- ❌ Push `_outbox` → server (→ #2). **Pengecualian:** hydration *pull* awal (read-only) ada di #1.
- ❌ Delta-pull, resolusi konflik, konvergensi multi-device (→ #2).
- ❌ Domain kolaboratif offline (→ #2).
- ❌ Packaging Tauri / `.exe` / AppImage / auto-update (→ #3).
- ❌ Android (→ #4).

---

## 3. Identitas & strategi ID

**Masalah:** ID sekarang `INTEGER AUTOINCREMENT` server. Record yang dibuat offline tak punya ID server → referensi pecah.

**Keputusan:**
1. **ID kanonik lokal = UUID v4 (`cid`)** via `crypto.randomUUID()`, dibuat di client saat record dibuat. Primary key IndexedDB untuk semua entitas.
2. **Semua relasi antar-entitas memakai `cid`**, bukan integer server: `subtask.task_cid`, `task.parent_cid`, `note.linked_task_cids[]`, `habit_log.habit_cid`, `entity_tag.entity_cid`, dst.
3. **Tiap record menyimpan `server_id` (integer, null sampai ter-sync)** sebagai jembatan ke server.
4. **Store `_idmap`:** pemetaan `(entity_type, server_id) ↔ cid`, dipakai saat hydration & sync.

Pola ini memperluas `client_id` yang sudah ada di `subtasks` & `task_notes`.

**Konsekuensi:** komponen React yang memakai `task.id` (integer) beralih ke `task.cid`. Perubahan menyebar tapi mekanis; sebagian besar tertangani di lapisan `LocalRouter` (Bagian 5) karena pemanggilan API terpusat.

---

## 4. Skema IndexedDB

Evolusi DB `taskflow-offline` (naikkan versi via `onupgradeneeded`). Store lama `cache` **dipensiunkan**; `queue` → `_outbox`.

### Store entitas (di-key `cid`)

| Store | Index |
|---|---|
| `tasks` | `server_id`, `gtd_status`, `list_cid`, `parent_cid`, `updated_at`, `dirty` |
| `subtasks` | `task_cid`, `server_id`, `dirty` |
| `task_notes` | `task_cid`, `server_id`, `dirty` |
| `task_attachments` | `task_cid` |
| `habits` | `server_id`, `dirty` |
| `habit_logs` | `[habit_cid+date]` (unik), `date`, `dirty` |
| `scratchpad_notes` | `server_id`, `updated_at`, `linked_task_cids` (multiEntry), `dirty` |
| `drawings` | `note_cid` |
| `note_attachments` | `note_cid` |
| `note_pins` | `note_cid` |
| `mindmaps` | `server_id`, `updated_at`, `dirty` |
| `tags` | `server_id`, `name`, `dirty` |
| `entity_tags` | `tag_cid`, `[entity_type+entity_cid]`, `dirty` |
| `recurring_exceptions` | `task_cid`, `dirty` |
| `note_templates`, `habit_templates` | `server_id`, `dirty` |

### Store sistem

| Store | Fungsi |
|---|---|
| `_meta` | key-value: identitas user, cursor sync per-domain, `schema_version`, `last_hydrate`, progres hydration |
| `_idmap` | `(entity_type, server_id) → cid` |
| `_outbox` | antrean mutasi terurut (autoincrement): `{op, entity_type, cid, payload, ts, retries}` |
| `blobs` | hanya fallback PWA (Bagian 6); di Tauri isinya ref/path |

### Metadata sync per-record (ditanam di tiap entitas)
```js
{
  cid, server_id,        // identitas
  ...field bisnis,
  updated_at,            // ISO, jam client
  deleted: false,        // tombstone — hapus = soft-delete agar bisa di-sync
  dirty: 1,              // perubahan lokal belum di-push
  base_rev: null         // versi server terakhir diketahui (dipakai #2)
}
```
- **Delete = tombstone** (`deleted:true`), bukan hapus fisik; di-purge setelah terkonfirmasi sync (#2).
- `dirty` & `base_rev` ditaruh sekarang walau penuh dipakai #2 → hindari migrasi skema ulang.
- ⚠️ `updated_at` jam client → rawan clock skew; resolusi konflik dituntaskan di #2.

---

## 5. Lapisan akses data — `LocalRouter` di balik `api`

**Temuan kunci:** semua panggilan API melewati satu objek terpusat `api` (`.get/.post/.put/.patch/.del`, berbasis path, ~168 call site) di `static/index.html` (~baris 1382). Ini titik sergap ideal → komponen React hampir tak disentuh.

**Strategi:** ubah isi `api.fetch` jadi router:
```
api.get('/api/tasks') → parse "GET /api/tasks"
  ├─ path Kelompok 1? → LocalRouter → IndexedDB → balikan JSON (bentuk = respons server)
  └─ path Kelompok 2/3? → fetch() jaringan (perilaku sekarang dipertahankan,
                          termasuk semantik 401/timeout/throw)
```

**`LocalRouter` = tabel rute meniru REST:**

| Rute (contoh) | Handler |
|---|---|
| `GET /api/tasks` | `taskRepo.list(query)` |
| `POST /api/tasks` | `taskRepo.create(body)` → tulis store `dirty:1` + append `_outbox` |
| `PUT /api/tasks/:cid` | `taskRepo.update(cid, body)` |
| `DELETE /api/tasks/:cid` | `taskRepo.softDelete(cid)` (tombstone) |
| ... tiap domain Kelompok 1 | ... |

Tiap handler **tulis** menambah op `_outbox`. Tiap handler **baca** mengembalikan **bentuk JSON identik** dengan server.

### Sumber effort & risiko utama #1 — porting logika bisnis server ke JS
Sebagian endpoint bukan CRUD lurus:

| Logika server | Status di JS |
|---|---|
| Hitung kuadran Eisenhower | ✅ ada (`computeOfflineQuadrant`) |
| Ekspansi recurring + `recurring_exceptions`/occurrences | ❌ port dari `datehelper.py`/`eisenhower.py` |
| `GET /api/summary` (agregasi) | ❌ query lokal |
| `GET /api/search` | ❌ pencarian IndexedDB |
| `projects`, `contexts` (derivasi tasks) | ❌ derivasi lokal |
| join `tags`/`entity_tags`, backlinks note | ❌ join lokal |

Strategi: tiap endpoint Kelompok 1 → handler lokal diuji **paritas** terhadap respons server (test-driven).

**11 panggilan `fetch()` mentah** (sebagian SSE chat, auth) = Kelompok 2/3, **tetap jaringan**, di-audit terpisah saat planning.

---

## 6. Abstraksi blob

Blob: `task_attachments`, `note_attachments`, data drawing tldraw (JSON besar + aset), gambar tertanam. **Byte mentah tidak boleh di IndexedDB** (kuota webview).

**Interface tunggal, dua implementasi, dipilih runtime:**
```js
BlobStore = {
  put(bytes, meta) → ref,   // balikan ref opaque
  getURL(ref) → string,     // utk <img src>/<a href>
  getBytes(ref) → Blob,     // utk upload sync (#2)
  delete(ref)
}
```

| Implementasi | Kapan | Mekanisme |
|---|---|---|
| **FS** | Tauri (desktop) & Android-native | `plugin-fs` → file di app data dir; `getURL` via `convertFileSrc` |
| **IndexedDB-blob** | PWA murni di browser | `Blob` di store `blobs`; `getURL` via `URL.createObjectURL` |

Deteksi platform via `window.__TAURI__` (atau flag Capacitor). Record menyimpan `blob_ref` (id opaque), bukan byte. Contoh `task_attachments` lokal:
```js
{ cid, server_id, task_cid, original_name, mime_type, file_size, blob_ref: "blob_…", ... }
```

**Drawing tldraw:** dokumen JSON di store `drawings`; aset gambar > ~100KB diekstrak ke `BlobStore` (by ref), tidak base64 inline.

**Dampak kuota:** dengan blob besar di filesystem (Tauri/Android), IndexedDB tinggal data terstruktur kecil → kuota webview praktis tak kena. Jalur PWA-murni dibatasi kuota → andalkan `navigator.storage.persist()` + `estimate()` + peringatan + tangani `QuotaExceededError` dengan rapi.

---

## 7. Hydration awal & alur end-to-end

**Hydration (login pertama, online) — read-only pull, ada di #1:**
1. Login (auth server, Kelompok 3) → simpan token + identitas di `_meta`.
2. Tarik penuh tiap domain Kelompok 1 lewat endpoint GET yang sudah ada.
3. **Pass 1:** tiap record server → mint `cid`, tulis store (`server_id` diisi, `dirty:0`, `base_rev=updated_at`), catat `_idmap`.
4. **Pass 2:** terjemahkan FK integer server → `*_cid` lewat `_idmap` (dua-pass karena target FK bisa muncul belakangan).
5. **Blob:** metadata di-hydrate segera; byte **di-download malas** saat pertama dibuka.
6. Set `_meta.last_hydrate` + cursor sync per-domain.

**Idempoten/resumable:** putus di tengah → ulang aman via `_idmap` + flag progres per-domain.

**Alur setelah hydrate (tanpa jaringan):**

| Aksi | Alur |
|---|---|
| Buka "Today" | `api.get('/api/tasks')` → LocalRouter → query IndexedDB (filter `deleted:false`, ekspansi recurring, hitung kuadran) → JSON → render |
| Buat task | `api.post('/api/tasks')` → mint `cid`, tulis `dirty:1`, append `_outbox` → balikan task → render |
| Hapus task | tombstone `deleted:true` + op `_outbox` |

**Perilaku online #1 (keputusan: Opsi B):** `_outbox` hanya **direkam**, tidak di-push. Server tak disentuh selain hydration pull. Seluruh push/pull/konflik = #2. (Selama development, desktop = "pulau" offline-sempurna tanpa propagasi sampai #2 jadi — diterima.)

---

## 8. Interaksi Service Worker

`LocalRouter` menangani Kelompok 1 di halaman → request tsebut tak pernah menyentuh jaringan/SW. Maka:
- **Hentikan** cache `GET /api/*` di SW untuk path Kelompok 1 (kini redundan/berpotensi rancu).
- SW **tetap**: cache aset statis (cache-first) + passthrough Kelompok 2/3 + network-first untuk endpoint kolaboratif.
- **Bump versi cache** SW saat deploy (saat ini `taskflow-v109-katex-patch`).

---

## 9. Strategi testing

- **Test paritas** per domain Kelompok 1: respons `LocalRouter` vs respons server untuk input sama — terutama logika non-trivial (recurring, summary, search, tag-join, backlinks).
- IndexedDB diuji via `fake-indexeddb` (Node); uji integritas `_outbox` & tombstone.
- Hydration: uji dua-pass (FK teratasi benar) & resumable (putus di tengah → ulang aman, tanpa duplikasi).
- `BlobStore`: uji kedua implementasi lewat interface yang sama (kontrak).

---

## 10. Urutan implementasi

1. **Scaffold:** bump versi IndexedDB; store `_meta`/`_idmap`/`_outbox`; `StorageAbstraction` + `BlobStore` (dua impl); kerangka `LocalRouter` + tabel rute.
2. **Pilot domain `tasks`** end-to-end (outbox sudah separuh ada) — buktikan pola + paritas + alur cid.
3. **Replikasi pola** ke domain Kelompok 1 lain: habits, scratchpad (+drawings/attachments/pins), mindmaps, tags/entity_tags, templates, recurring_exceptions.
4. **Hydration** pull-sekali + lazy-blob + resumable.
5. **Sesuaikan Service Worker** (Bagian 8) + bump versi cache.
6. **Audit 11 `fetch()` mentah** → pastikan Kelompok 2/3 tetap jaringan.

---

## 11. Risiko & catatan jujur

- **Paritas logika bisnis** (recurring, summary, search) = sumber bug terbesar; mitigasi dengan test paritas ketat.
- **Migrasi `id`→`cid`** menyentuh banyak komponen; terpusat di `LocalRouter` mengurangi, tapi tempat yang memakai `task.id` langsung di JSX perlu audit.
- **Clock skew `updated_at`** ditunda ke #2 — jangan diandalkan untuk konflik di #1.
- **Kuota PWA-murni** tetap ada batas; native (Tauri/Android) aman via filesystem.
- Desktop tetap "pulau" sampai #2 (konsekuensi Opsi B yang diterima).
