# Menulis plugin Alurik (Fase 0a–1a)

Plugin = fitur opsional yang dinyalakan/dimatikan pengguna di **Pengaturan › Plugin**. Kodenya hidup di
`static/plugins/<id>/`, bukan di `index.html`, dan baru dieksekusi saat plugin ON dan slot-nya dirender.
Spec: `docs/superpowers/specs/2026-10-29-plugin-fase0a-design.md` (klien) dan
`docs/superpowers/specs/2026-10-31-plugin-fase0b-design.md` (status per akun, server, `api.fetch`; ADR-039),
`docs/superpowers/specs/2026-10-31-plugin-fase1-timeline-design.md` (Fase 1: `tasks.ext`, slot view/detail,
`api.taskExt`; ADR-040).
Runtime: `static/plugin-runtime.js`. Modul server opsional: `plugins/<id>.py` (§11).
Contoh nyata: `static/plugins/habit-heatmap/` (plugin #0). Contoh `task.ext` + dua slot task: plugin khusus tes
`tests/fixtures/plugins/demo-ext/` (tidak pernah dirilis). Titik mulai: salin `static/plugins/_template/`.

## 1. Struktur folder

```
static/plugins/
  index.json                 ← ditulis compile.js (jangan edit)
  _template/                 ← folder berawalan "_" tidak dibangun
  <id>/
    manifest.json            ← wajib, sumber kebenaran manifest
    plugin.jsx               ← kode sumber (JSX)
    plugin.js                ← hasil build, di-commit (jangan edit)
    style.css                ← opsional, ikut precache dan disuntik bersama plugin.js
    <part>.js                ← opsional (manifest `parts`, Fase 1): JS murni yang digabung ke plugin.js
```

`<id>` = nama folder = `manifest.id`, pola `[a-z][a-z0-9-]{2,31}`, tidak pernah diganti (tertanam di kunci
penyimpanan; rename = plugin baru).

## 2. Build: `npm run compile:plugins`

`node compile.js --plugins-only` (atau `npm run compile`, yang juga mengompilasi `index.html`):

1. `plugin.jsx` → `plugin.js` (Babel `preset-react` classic, header `// generated from plugin.jsx — jangan edit`).
   Isi `manifest.json` disuntik sebagai konstanta `manifest` di awal file.
   **`parts` (Fase 1, opsional):** `manifest.parts = ["calendar.js", …]` — nama `^[a-z0-9][a-z0-9_-]*\.js$`, unik,
   ada di folder plugin, bukan `plugin.js`. Isinya disalin **mentah** (tanpa Babel), berurutan, masing-masing
   diawali komentar `// part: <nama>`, sebelum kode `plugin.jsx` di dalam IIFE yang sama. Gunanya: mesin murni
   (mis. kalender/jadwal) bisa di-`require` dan dites Node terpisah dari UI (pola UMD seperti
   `tests/fixtures/plugins/demo-ext/util.js`). `parts` hanya dipakai saat build (tidak disalin ke `index.json`),
   dan lint berlaku atas `plugin.js` utuh.
2. Lint: `plugin.js` yang mengandung `tokenStore`, `API_BASE`, `fetch(` polos, `window|self|globalThis.fetch`,
   `localStorage`, `indexedDB`, `XMLHttpRequest`, `innerHTML`, `TF.api.for(` atau `window.TF.meta|db|taskroutes`
   → build gagal. `.fetch(` (mis. `api.fetch(`) hanya boleh bila `manifest.permissions` memuat `"network"`.
   Id yang tidak cocok pola atau sama dengan `state` (dicadangkan untuk `/api/plugins/state`) → build gagal.
3. Menulis `static/plugins/index.json`: `{v: 1, plugins: [{id, name, description, version, minApi, slots,
   permissions, defaultEnabled, files, hash}]}` (+ `contributes`, `taskExt` hanya bila ada di manifest — juga
   disalin ke konstanta `manifest` di `plugin.js`); `hash` = sha1 8 hex gabungan isi `files`.
4. Menulis ulang blok `// plugins:begin … // plugins:end` di `STATIC` `static/sw.js`: `index.json` + tiap file
   `/static/plugins/<id>/<file>?v=<hash>` (query persis sama dengan yang disuntik loader).

Gagal di plugin mana pun → exit 1. Jalankan dua kali → tidak ada perubahan (idempoten). Commit `plugin.js`,
`index.json`, dan `sw.js` bersama sumbernya.

## 3. Manifest dan izin

```json
{
  "id": "habit-heatmap",
  "name": "Heatmap Habit",
  "description": "Satu kalimat untuk kartu Pengaturan.",
  "version": "1.0.0",
  "minApi": 1,
  "slots": ["dashboard.widgets"],
  "permissions": ["storage"],
  "defaultEnabled": false
}
```

- `version` semver; naikkan setiap perubahan perilaku/data.
- `minApi` ≤ `TF.api.apiVersion` (sekarang `1`), kalau tidak manifest ditolak.
- `slots`: hanya slot yang dikenal runtime: `dashboard.widgets` (Fase 0a), `taskList.views` dan
  `taskDetail.sections` (Fase 1, §6).
- `permissions`: subset `["storage", "network", "task.ext"]`. `storage` = `api.storage` (per perangkat);
  `network` (Fase 0b) = `api.fetch` ke rute server milik plugin sendiri, label Pengaturan "Butuh koneksi internet
  untuk sebagian fitur"; `task.ext` (Fase 1) = `api.taskExt`, field plugin di task yang ikut tersinkron, label
  Pengaturan "Menyimpan data tambahan di task (ikut tersinkron)". Nama yang dicadangkan untuk fase berikutnya
  (`records`, `settings.project`, `notifications`, `location`, `secrets`, `noteBlocks`, `bot`, `timerHooks`) dan
  nama asing **ditolak**.
- `taskExt` (Fase 1): `{"keys": ["note", "after"]}` — wajib ada **tepat** bila izin `task.ext` ada; array nama
  field unik, tak kosong, pola `^[a-zA-Z][a-zA-Z0-9_]{0,31}$`. Kunci tersimpan = `<id>.<field>`. `api.taskExt.set`
  hanya menerima field di daftar ini (salah ketik tertangkap); field baru = tambah ke manifest.
- `contributes` (Fase 1, opsional): deskripsi statis kontribusi slot yang dibaca host **tanpa** memuat kode
  plugin. Tiap slot di `contributes` wajib juga ada di `slots`.
  - `taskList.views`: `[{id, label, icon: {path}, pages}]` — `id` unik, `label` teks tombol, `icon.path` = path
    SVG 16×16 (garis `currentColor`), `pages` subset tak kosong `["project", "workspace"]`.
  - `taskDetail.sections`: `[{id, label, order?}]` — `order` angka (urutan bila komponen tidak menyebutnya).
- Contoh lengkap (`tests/fixtures/plugins/demo-ext/manifest.json`):

```json
{
  "id": "demo-ext", "name": "Demo Ext", "version": "1.0.0", "minApi": 1, "defaultEnabled": false,
  "slots": ["taskList.views", "taskDetail.sections"],
  "permissions": ["task.ext"],
  "contributes": {
    "taskList.views": [{"id": "board", "label": "Demo", "icon": {"path": "M2 4h12M2 8h12M2 12h8"}, "pages": ["project", "workspace"]}],
    "taskDetail.sections": [{"id": "note", "label": "Catatan demo", "order": 10}]
  },
  "taskExt": {"keys": ["note", "after"]},
  "parts": ["util.js"]
}
```
- `defaultEnabled`: status saat pengguna belum pernah menyentuh toggle (bawaan: `false`).

Manifest tidak valid → plugin otomatis OFF dengan toast berisi alasannya. `register` dari id yang tidak ada di
`index.json` diabaikan.

## 4. Siklus hidup ON/OFF

- `TF.plugins.init()` (sekali, di `App`) membaca `index.json` (fallback salinan `_meta plugins:index:v1` bila
  offline) dan status lewat `TF.pluginstate.snapshot()`.
- **Status ikut akun (Fase 0b).** Sumber kebenaran = tabel server `plugin_states` (per pengguna, last-write-wins
  berdasarkan waktu toggle, dipotong ke waktu server). Perangkat menyimpan cache `_meta plugins:state:v1`
  `{[id]: {enabled, updatedAt, settings?, dirty?}}` (bentuk 0a kompatibel) + pemilik `plugins:state:owner:v1`;
  satu-satunya penulisnya `TF.pluginstate` (`static/offline/pluginstate.js`).
  - Toggle = satu transaksi IndexedDB `_meta` + `_outbox`: cache diperbarui seketika dan satu op
    `plugin_state/set` per plugin diantrekan (toggle berulang saat offline tetap satu op). Bekerja offline;
    Pengaturan menampilkan "Menunggu sinkron" selama op masih ada.
  - `sync()` menarik `GET /api/plugins/state` sebelum mendorong outbox; plugin dengan op tertunda tidak ditimpa
    server. Sinkron pertama dari cache 0a (tanpa pemilik): plugin yang ON di perangkat dikirim dengan
    `updatedAt` aslinya, jadi keputusan yang lebih baru di server tetap menang. Ganti akun di perangkat yang
    sama: cache milik akun lain dibuang dan status server akun baru diadopsi.
  - Perangkat lain melihat perubahan setelah sinkron berikutnya (tidak disiarkan seketika). Tab lain di browser
    yang sama juga baru melihatnya setelah sinkron/reload.
- **Peredaman lokal karena error.** Mati otomatis karena error (manifest, `factory`, 2 error render/pendengar)
  hanya berlaku **di perangkat itu** (`_meta plugins:suppressed:v1 {[id]: {reason, hash, at}}`); status akun
  tidak berubah, perangkat lain tetap ON, dan pull tidak menyalakannya lagi. Dihapus oleh "Aktifkan lagi" atau
  bila `hash` plugin berubah (versi baru). Status efektif = status akun ∧ tidak diredam.
- **OFF**: `plugin.js` tidak pernah diminta (0 byte dieksekusi).
- **ON + slot dirender** → loader menyuntik `<script src="/static/plugins/<id>/plugin.js?v=<hash>">` (+ `<link>`
  `style.css`) sekali per sesi → `plugin.js` memanggil `window.TF.plugins.register(manifest, factory)` →
  runtime memanggil `factory(api)` → slot merender kontribusi. Tanpa reload.
- `factory(api)` mengembalikan `{ slots: { "<slot>": [{ id, order, component }] }, onEnable?, onDisable? }`. Untuk
  `taskList.views`/`taskDetail.sections`, `id` komponen = `id` item `contributes` yang sama.
- **ON → OFF**: semua pendengar `api.events` plugin dilepas, `onDisable()` dipanggil, slot dirender ulang.
  Data plugin (`api.storage`) **tidak** dihapus.
- `register` tidak terpanggil dalam 10 s / skrip gagal diunduh → gagal untuk sesi ini (status tetap ON); bila
  `register` akhirnya terpanggil, penanda gagal dihapus. `factory` yang melempar → plugin langsung diredam
  di perangkat ini.

## 5. `TF.api` v1

Plugin menerima `api = TF.api.for(id)` di `factory` dan sebagai prop `api` di komponen.

| Bagian | Fungsi |
|---|---|
| `api.id`, `api.apiVersion` | id plugin, `1` |
| `api.events` | `on(name, fn) → off`, `once`, `off(name, fn)`, `emit(name, payload)` (emit hanya `<id>.*`) |
| `api.storage` (izin `storage`) | `get(key) → Promise<nilai∣null>`, `set(key, val)`, `remove(key)`, `keys()`; disimpan di `_meta` `plugin:<id>:<key>`; kunci string 1–128 karakter; nilai JSON ≤ 64 KB (lebih → `PluginStorageError`). Tanpa izin → `PluginPermissionError` (dihitung sebagai error). |
| `api.data.habits` | `list()` → habit (bentuk `GET /api/habits` lokal); `logs({from, to})` → `[{cid, habitId, habit_cid, date, status, skip_reason}]`, tanggal inklusif `YYYY-MM-DD`, log terhapus dan log dari habit terhapus dibuang |
| `api.data.tasks` | `list({includeDone, since})` → task dari IndexedDB (bentuk `GET /api/tasks` lokal, `id = server_id ?? cid`); `since` ISO dibandingkan dengan `updated_at` (fallback `completed_at`, `created_at`) |
| `api.ui` | `toast(message, type)`, `openTask(taskId)`, `navigate(page)` (hanya `dashboard`, `focus`, `inbox`, `settings`; selain itu melempar), `sanitize(html)` (lewat `TF.safehtml`) |
| `api.env` | `online` (getter), `platform` (`"web"∣"tauri"`), `theme` (`{palette, mode}`), `today()` (Asia/Jakarta `YYYY-MM-DD`), `userId` |
| `api.log` | `info/warn/error` berprefiks `[plugin:<id>]` |
| `api.fetch(path, {method, body, timeoutMs})` (izin `network`, Fase 0b) | `→ Promise<json>` ke rute server plugin sendiri: `path` diawali `/api/plugins/<id>/` (atau sama dengan `/api/plugins/<id>`), tanpa `..`, `//`, `\`, `#`, skema/host; `method` GET/POST/PUT/PATCH/DELETE; `body` JSON ≤ 256 KB; timeout bawaan 15 s. Lewat `api.fetch` host (token, `API_BASE` Tauri, 401 → login ulang). Bila toggle plugin ini masih menunggu sinkron, menunggu push ≤ 5 s dulu. Selalu ada di `api`; tanpa izin `network` / path asing → `PluginPermissionError` (dihitung error). |
| `TF.api.PluginNetworkError` | dilempar `api.fetch`; `code`: `offline` (pesan "Butuh koneksi internet", tanpa request bila offline), `timeout`, `auth` (401), `disabled` (403 `PLUGIN_DISABLED`), `unavailable` (503 `PLUGIN_UNAVAILABLE`), `http` (+ `status`, `detail`). **Tidak** dihitung sebagai error plugin. Plugin wajib menangkapnya, menampilkan "Butuh koneksi internet" untuk `offline`, dan menurunkan diri (bagian lain tetap jalan). |

| `api.taskExt` (izin `task.ext`, Fase 1) | `read(task) → {field: nilai}` (kunci namespace sendiri tanpa prefiks; sinkron, murni); `set(taskId, patch) → Promise<task>`; `setMany([{taskId, patch}]) → Promise`; `ref(task) → {$task: id}`. Selalu ada di `api`; tanpa izin → `PluginPermissionError` (dihitung error). Rinci di bawah. |

**`api.taskExt` (Fase 1).** Field plugin disimpan di kolom task `tasks.ext` (objek datar berkunci `<id>.<field>`)
dan ikut sinkron task di semua jalur (hidrasi, push, pull, workspace bersama).

- **Patch per kunci.** `set(taskId, {start: "2026-11-03", deps: null})` hanya mengubah kunci yang disebut; `null`
  menghapus kunci. Perangkat atau anggota workspace yang plugin-nya OFF (atau masih kode lama) dan mengedit
  task tidak pernah menimpa field plugin; tabrakan hanya terjadi bila dua perangkat mengubah **kunci yang sama**
  (yang terakhir sampai menang).
- **Namespace sendiri.** `set` hanya menulis `<id>.<field>` dengan `field` di `manifest.taskExt.keys`. `read`
  hanya mengembalikan kunci plugin sendiri. `task.ext` mentah (yang terlihat di `context.tasks`) memuat kunci plugin
  lain: anggap **baca saja**, jangan diandalkan.
- **Batas** (sama di klien dan server): nilai JSON baku (tanpa `NaN`/`Infinity`/fungsi); per plugin ≤ **4096**
  byte, total semua plugin ≤ **16384** byte (byte UTF-8 JSON ringkas). Gagal → `PluginStorageError` dengan
  `code` `EXT_INVALID` / `EXT_TOO_LARGE` / `EXT_TASK_REF` dan `key`. Task tidak ada → `Error("Task not found")`.
- **Referensi task** (mis. dependensi): simpan `api.taskExt.ref(task)` = `{"$task": <id>}` sebagai nilai (boleh di
  dalam array/objek). Task yang dibuat offline masih ber-id lokal (cid); host menulis ulang ref ke id server
  setelah task itu terkirim, menahan update yang merujuk task yang belum terkirim, dan mengganti ref ke task yang
  tidak pernah terkirim dengan `null`. Jangan menyimpan id task sebagai angka/string polos.
- **Seret massal:** pakai `setMany` — berurutan, berhenti pada kegagalan pertama (item sebelumnya tetap
  tersimpan), satu muat ulang daftar task + satu event `taskUpdated` di akhir (bukan per item).
- **Optimistis:** state daftar task host diperbarui seketika, lalu ditulis ke IndexedDB (rute lokal
  `PUT /api/tasks/:id` `{ext_patch}`) dan diantre untuk sinkron; gagal → daftar dimuat ulang lalu reject.
  Bekerja offline.
- Pengguna aktif: `api.env.userId` (context `taskDetail.sections` tidak membawa `currentUser`).

Semua `data.*` membaca IndexedDB, jadi bekerja offline. Tidak ada di v1: `records` (Fase 1 PR 1a-2),
`api.settings` (kolom `settings` server sudah disimpan dan disinkron tetapi belum diekspos), penulisan data host
selain `api.taskExt`. Fungsi hanya ditambah di v1; perubahan tak kompatibel = `apiVersion: 2`.

## 6. Slot

### 6.1 `dashboard.widgets`

Host: `React.createElement(TF.Slot, {name: "dashboard.widgets", context})` di `Dashboard`, setelah grid GTD.
Bila tidak ada kontribusi, tidak ada wadah sama sekali. Bila ada, kontribusi dirender di
`div.dash-grid-2.dash-plugins[data-plugin-slot="dashboard.widgets"]` (1 kolom di HP, 2 kolom di layar lebar),
urut `order` lalu id plugin, masing-masing dalam `PluginBoundary`. Komponen menerima `{context, api}`.

Kontrak `context` (objek beku, baca saja):

| Field | Isi |
|---|---|
| `user` | `{id, username}` atau `null` |
| `now` | `Date` saat Dashboard dirender |
| `onTaskClick(task)` | buka detail task seperti kartu bawaan |
| `showToast(message, type)` | toast host |

`tasks`/`habits` sengaja tidak ada di `context`; baca lewat `api.data`. Kartu sebaiknya memakai kelas
`dash-card` / `dash-card-title`, punya tinggi stabil sejak render pertama, dan `gridColumn: "1 / -1"` bila
butuh lebar penuh. Konten lebar (grid, tabel) harus di dalam wadah `overflow-x: auto` agar layar 375 px tidak
meluber.

### 6.2 `taskList.views` (Fase 1)

View ke-4 di halaman daftar task, setelah Normal/Compact/Kanban.

- **Tombol dari indeks, tanpa memuat kode.** Host membaca `contributes["taskList.views"]` di `index.json` untuk
  plugin yang ON (dan tidak diredam) lewat `TF.plugins.viewsFor(pageKind)` / hook `useViews`, lalu menggambar
  tombol (`label`, ikon `icon.path`). `pageKind`: halaman `proj_*` → `project`, `slist_*` → `workspace`;
  halaman lain (Inbox, Hari Ini, dst.) tidak pernah menampilkan tombol view plugin. `plugin.js` baru diminta saat
  tombol diklik.
- **Pilihan per halaman.** Disimpan di `localStorage` `tf_viewmode_ext:<page>` = `"<pluginId>:<viewId>"`;
  `tf_viewmode` (mode inti, global) tidak berubah. Memilih Normal/Compact/Kanban di halaman itu menghapus kunci per
  halaman. Bila plugin dimatikan atau item view hilang, halaman kembali ke mode inti tanpa reload.
- **Render:** `TF.SlotView` — "Memuat {label}…" saat kode diunduh; gagal (unduh/`register`/`factory`) → "{label}
  tidak bisa dimuat" + tombol "Kembali ke Normal". Komponen di dalam `PluginBoundary` (aturan error §8 butir 5).
- **`context`** (beku dangkal; identitasnya stabil selama masukannya sama — tidak berganti tiap detik Pomodoro):

| Field | Isi |
|---|---|
| `page`, `pageKind` | id halaman host, `"project"∣"workspace"` |
| `listId`, `projectName` | workspace (`slist_<id>`) atau nama project (`proj_<nama>`) |
| `tasks` | task aktif hasil filter panel (sama dengan daftar Normal) |
| `scopeTasks` | semua task halaman itu selain `archived` (termasuk selesai), filter panel diterapkan |
| `collaborators`, `currentUser` | anggota workspace, pengguna aktif |
| `onTaskClick(task)`, `isSelected(task)` | buka detail (sadar Live Edit: membuka panel samping bila Live Edit ON), status terpilih |
| `liveEdit` | `true` bila panel Live Edit aktif |
| `showToast(message, type)` | toast host |

### 6.3 `taskDetail.sections` (Fase 1)

Seksi di detail task, antara Deskripsi dan tab (Subtask/Komentar/…), di modal maupun panel Live Edit. Tanpa
kontribusi tidak ada wadah; bila ada, dirender di wadah `td-plugin-sections`, urut `order`. `context`:
`{task, variant: "modal"∣"panel", collaborators, onOpenTask, showToast}`; pengguna lewat `api.env.userId`.
Seksi biasanya membaca `api.taskExt.read(context.task)` dan menulis lewat `api.taskExt.set`.

## 7. Event

Nama `domain.peristiwa` huruf kecil; payload salinan beku; pendengar dipanggil sinkron, tidak bisa
membatalkan aksi host, dan sebaiknya ringan (debounce kerja berat, mis. 300 ms seperti Heatmap).

| Event host | Kapan | Payload |
|---|---|---|
| `task.completed` | `handleDone` di `App` setelah sukses lokal (centang dari subtask/Kanban belum memancarkan) | `{taskId, completedAt}` |
| `habit.changed` | setiap check-in/uncheck habit (jembatan `window` `habitSaved`) — baca ulang data | `{}` |
| `pomodoro.ended` | sesi/overtime Pomodoro tercatat | `{taskId, kind: "session"∣"overtime", pomodoros, focusSeconds, endedAt}` |
| `app.online` / `app.offline` | event `online`/`offline` browser | `{}` |
| `app.dayChanged` | tanggal Asia/Jakarta berganti (dicek tiap 60 s) | `{date}` |
| `sync.done` | sinkron awal selesai (`initial: true`) atau sinkron berkala kembali idle | `{initial}` |
| `plugins.changed` | plugin dinyalakan/dimatikan | `{id, enabled}` |

Plugin memancarkan event miliknya sendiri dengan awalan id: `api.events.emit("<id>.sesuatu", {...})`; nama lain
melempar error. Pendengar plugin dilepas otomatis saat OFF. Untuk kelengkapan data (mis. task diselesaikan di
perangkat lain), dengarkan juga `sync.done` lalu baca ulang.

## 8. Aturan wajib (ringkas Lampiran A spec)

1. **Fasad saja.** Hanya `api` dan `React` global. Dilarang `api`/`tokenStore`/`API_BASE` host, `fetch` polos /
   `window.fetch`, `localStorage`, `window.TF.<modul host>`, atau state `App`. Satu-satunya `window.TF` yang
   dipakai: `window.TF.plugins.register`.
2. **Offline by default.** Semua data dari `api.data`. Jaringan hanya lewat `api.fetch` (izin `network`) dan
   hanya ke rute server plugin sendiri `/api/plugins/<id>/…`; fitur yang butuh jaringan menurunkan diri saat
   offline ("Butuh koneksi internet"), sisanya tetap jalan.
3. **Shell dibekukan.** Fitur yang bisa jadi plugin tidak masuk `index.html`; host tidak boleh berisi
   `if (pluginId === "...")` — kebutuhan baru = slot/event/izin baru yang terdokumentasi.
4. **Precache, bukan runtime cache.** File plugin masuk `STATIC` lewat `compile.js` (jangan tulis tangan).
5. **Gagal aman.** Error di `factory` (deterministik) → langsung OFF di perangkat ini. Render/pendengar
   dibungkus runtime: error ke-1 → slot plugin kosong + toast; ke-2 dalam satu sesi → otomatis OFF di perangkat
   ini (peredaman lokal, §4) + toast "Plugin {nama} dimatikan karena error"; Pengaturan menampilkan "Dimatikan di
   perangkat ini karena error" dengan "Aktifkan lagi" dan "Salin detail". Jangan menelan error diam-diam; pakai
   `api.log`.
6. **Warna dari token tema** (`var(--accent)`, `var(--bg-card)`, `var(--border)`, `color-mix(...)`), tanpa hex
   tetap, agar ikut palet Default/Sakura/Lavender dan terang/gelap. Kelas CSS berawalan `.plg-<id>-`;
   `app.css` tidak diubah plugin.
7. **Tanpa `innerHTML`** kecuali lewat `api.ui.sanitize`.
   **Jangan menulis kolom task lain.** Plugin hanya menulis `tasks.ext` miliknya lewat `api.taskExt`; judul,
   status, tenggat, `progress`, dsb. tetap milik host (dibaca saja dari `context`/`api.data.tasks`).
8. **Ukuran.** Satu plugin satu folder; vendor baru > 100 KB wajib lazy.

**Batas diketahui — ini bukan sandbox.** Pagar di atas menangkap kesalahan tak sengaja, bukan niat jahat:

- Lint `compile.js` berbasis teks dan bisa diakali (`globalThis["fetch"]`, alias `const f = fetch`, `WebSocket`,
  `EventSource`, `import()` dinamis, dsb.). `plugin.js` berjalan di halaman yang sama dengan host dan secara
  teknis bisa menjangkau apa pun yang bisa dijangkau halaman.
- `api.fetch` memeriksa path (karakter kontrol ditolak, path dinormalkan parser URL wajib sama dengan aslinya dan
  tetap di bawah `/api/plugins/<id>`), tetapi itu hanya menjaga plugin yang memakai fasad.
- Pagar `ensure_schema` (§11) hanya menangkap DDL tak sengaja di luar prefix `plg_<id_>_`; ia **tidak** menahan
  `DELETE`/`UPDATE` ke tabel host, `ATTACH DATABASE`, atau trigger `plg_` yang menulis tabel host, dan kode
  endpoint server memakai koneksi DB host yang sama tanpa pembatasan.

Karena itu semua plugin saat ini **bawaan dan direview manusia** sebelum di-merge. Sandbox sungguhan
(`sqlite3.Connection.set_authorizer` di server, Worker/iframe ber-origin terpisah di klien) ditunda sampai ada
plugin pihak ketiga.

## 9. Menguji

Pola: `tests/offline/habit_heatmap_logic.test.js` dan `habit_heatmap_ui.test.js` (`node --test`).

- **Logika murni**: di `plugin.jsx`, kumpulkan fungsi murni dan ekspor bila di Node —
  `if (typeof module !== "undefined" && module.exports) module.exports = pure;` — lalu daftarkan hanya bila
  `window.TF.plugins` ada. Tes me-`require` `plugin.js` hasil build (jalankan `npm run compile:plugins` dulu).
- **UI**: periksa sumber (`plugin.jsx`/`style.css`: teks persis, tanpa hex, tanpa `fetch`/`localStorage`) dan
  pohon elemen komponen murni dengan React palsu (`createElement → {type, props, children}`).
- **Ujung ke ujung dengan runtime**: `require("static/plugin-runtime.js")`, `P._reset()`, `P.init({fetchIndex})`
  dengan `index.json` repo, `P.load(id, {inject})` yang menjalankan `plugin.js` di `vm`, lalu periksa
  `P.contributions("dashboard.widgets")`. IndexedDB dari `fake-indexeddb` (`tests/offline/setup.js`).
- Tambahkan pola file tes plugin baru ke `PATTERNS` di `tests/test_plugins_node.py` (seperti
  `habit_heatmap_*.test.js`) agar ikut CI pytest. CI tidak menjalankan `npm install`: tes yang butuh
  `fake-indexeddb`/Babel dilewati di sana, jadi jalankan `npm test` lokal.
- **Server**: pola `tests/test_plugin_loader.py` (loader, `ensure_schema`, router) dan `tests/test_plugin_states.py`, dengan plugin contoh khusus tes
  `tests/fixtures/plugins/demo-server.py` + `tests/fixtures/plugins/index.json`; `tasks.ext`:
  `tests/test_task_ext.py` (vektor bersama klien–server `tests/fixtures/taskext_vectors.json`).
- **Field task dan slot task (Fase 1)**: plugin contoh khusus tes `tests/fixtures/plugins/demo-ext/` (bukan di
  `static/plugins/`, jadi tidak pernah dirilis) dibangun ke direktori sementara oleh tes
  (`tests/offline/plugin_slot_views.test.js`, `plugin_taskext_api.test.js`, `tests/build-plugins.test.js`).
- Jalankan: `npm test`, `python3 -m pytest tests/test_plugins_node.py -q`, `node compile.js` dua kali (tanpa diff).
- Manual: Pengaturan › Plugin → ON → Dashboard; DevTools `TF.plugins._debugThrow("<id>")` mensimulasikan error
  render; mode offline + reload harus tetap merender.

## 10. Merilis

1. `npm run compile:plugins` → commit `plugin.jsx`, `plugin.js`, `style.css`, `manifest.json`, `index.json`, `sw.js`.
   Precache file plugin otomatis (blok `plugins:begin…end`).
2. Ikuti *Checklist rilis frontend* `.agents/PROTOCOL.md` §4: bump `CACHE` di `static/sw.js` dan
   `window.__SW_VERSION` (+ fallback) di `static/index.html`, sesuaikan tes versi, entri baru paling atas di
   `static/whatsnew.json` (bahasa pengguna, tanpa istilah teknis). Perubahan isi plugin mengubah `hash`, tapi
   tanpa bump `CACHE` perangkat pengguna tidak mengunduhnya (revisi per file = Fase 0c).
3. Deploy: `npm run compile` sudah dijalankan CI (`deploy.yml`, workflow Tauri) sebelum build; Tauri
   menyalin `static/` utuh.
4. Plugin dengan modul server (`plugins/<id>.py`) **atau izin `task.ext` baru**: workflow deploy menjalankan
   `migrate_db` (membuat tabel `plg_<id_>_…`) tetapi **tidak** me-restart layanan. Setelah deploy wajib
   `sudo systemctl restart taskflow-web taskflow` (web + bot memuat ulang loader). Selama jendela itu file
   statis sudah baru sementara proses lama masih melayani: rute plugin menjawab 404 (plugin harus menurunkan
   diri) dan toggle tetap antre di outbox sampai rute status tersedia. Untuk `task.ext`: server membaca ulang
   `index.json` sekali per request yang membawa namespace belum dikenal, jadi plugin baru berizin `task.ext`
   langsung diterima; perubahan ext yang dijawab server lama (tanpa `ext` objek) tetap tertahan di perangkat dan
   terkirim setelah restart.

## 11. Server (Fase 0b)

Modul server bersifat opsional: plugin yang hanya membaca IndexedDB tidak membutuhkannya. Titik mulai: salin
`plugins/_template.py` menjadi `plugins/<id>.py` (file berawalan `_` dilewati loader).

**Pemuatan.** `plugin_loader.py` (dipakai `webapp.py` dan `bot.py`) membaca `static/plugins/index.json` sebagai
daftar id yang dikenal, lalu memuat tiap `plugins/<id>.py` lewat `importlib` sebagai
`alurik_plugins.<id_>`. Ditolak (dengan log `WARNING`, tanpa menjatuhkan proses): id tidak cocok pola, tidak
ada di `index.json`, atau `state`; import yang melempar (termasuk `SystemExit`); `MIN_HOST_API` > `HOST_API`
(`1`); `router` bukan `APIRouter` atau ber-`prefix`; endpoint `async def` tanpa `@host.allow_async`;
`ensure_schema` bukan callable satu argumen; simbol yang belum didukung — `on_task_written`, `jobs`,
`register_bot`, `intake` ("belum didukung (ditunda, Lampiran B)"; `on_task_written` ditunda karena Timeline
menghitung jadwal di klien, spec Fase 1 K21). Ringkasan di log logger
`alurik.plugins`: `plugin server: N dimuat, M ditolak` (web dan bot). Catatan: `webapp.py` tidak memanggil
`logging.basicConfig`, jadi di proses web hanya `WARNING`/`ERROR` loader yang terlihat; baris INFO ringkasan hanya
muncul di log bot (`journalctl -u taskflow`).

**Kontrak modul** (`plugins/<id>.py`):

```python
from fastapi import APIRouter, Depends
import plugin_host as host

MIN_HOST_API = 1
router = APIRouter()                 # TANPA prefix

def ensure_schema(conn):             # opsional; dipanggil dalam write_tx; jangan commit
    conn.execute("CREATE TABLE IF NOT EXISTS plg_<id_>_items (...)")

@router.get("/items")                # → /api/plugins/<id>/items
def list_items(user=Depends(host.current_user)):
    with host.get_conn() as conn:
        rows = conn.execute("SELECT ... WHERE user_id = ?", (user["sub"],)).fetchall()
    return {"items": [dict(r) for r in rows]}
```

**Fasad `plugin_host`** (`HOST_API = 1`; satu-satunya modul host yang boleh di-import plugin, selain
fastapi/pydantic/stdlib — dilarang `webapp`, `repository`, `bot`, `sqlite3.connect`):

| Simbol | Fungsi |
|---|---|
| `current_user` | dependency FastAPI → payload token (`user["sub"]` = id pengguna); tercache sekali per request |
| `get_conn()` | context manager koneksi DB host (pragma ADR-038): commit bila sukses, rollback bila error, close |
| `write_tx(conn)` | `BEGIN IMMEDIATE` — wajib untuk setiap baca-lalu-tulis |
| `now_utc()` | `datetime` aware UTC |
| `allow_async` | dekorator pengecualian untuk endpoint `async def` (mis. uji koneksi jaringan) |

**Aturan wajib:**

1. Endpoint `def`, bukan `async def` (akses SQLite sinkron memblokir event loop).
2. Baca-lalu-tulis di dalam `with host.write_tx(conn):`; panggil `fetchall()` sebelum menulis; transaksi pendek,
   tanpa panggilan jaringan atau kerja berat di dalamnya.
3. Semua objek DB (tabel, indeks, trigger, view) bernama `plg_<id dengan - → _>_…` dan hanya untuk tabel
   ber-prefix sama. `ensure_schema` dijalankan `migrate_db` (web saja, bot tidak menjalankan DDL) dalam satu
   transaksi pada koneksi FK OFF; koneksinya menolak `commit`/`rollback`/`close`/`executescript`. Objek di luar
   prefix, perubahan tabel host, pelanggaran foreign key, atau exception → rollback, plugin ditandai
   `schema_failed` (rute menjawab 503), `migrate_db` tidak gagal.
4. Saring setiap query dengan `user["sub"]`; data plugin milik pengguna.

**Pemasangan dan kode error.** Router dipasang di `/api/plugins/<id>` dengan `Depends(current_user)` dan
`Depends(require_plugin_enabled(id))`. Semua error berbentuk `{"detail": {"code": …, "plugin_id"?: …}}`:

| Kondisi | Jawaban |
|---|---|
| tanpa token / kedaluwarsa | 401 |
| token clipper (`scope == "ext"`) | 403 `PLUGIN_FORBIDDEN_TOKEN` (juga di `/api/plugins/state`) |
| `ensure_schema` gagal / belum jalan | 503 `PLUGIN_UNAVAILABLE` |
| plugin tidak aktif untuk akun ini (baris `enabled`, atau `defaultEnabled` bila belum ada) | 403 `PLUGIN_DISABLED` |

Peredaman lokal (§4) tidak diketahui server: perangkat lain tetap bisa memakai rute plugin.

**API status host** (`plugin_states.py`): `GET /api/plugins/state` → `{v: 1, server_time, plugins: {[id]:
{enabled, settings, updated_at}}}` (hanya baris milik pengguna); `PUT /api/plugins/state/{id}` body
`{enabled?: bool|null, settings?: object ≤ 16 KB, updated_at?: ISO}` → `{applied, state}`. Urutan error PUT:
pola id salah atau `state` → 404 `PLUGIN_UNKNOWN`; indeks tidak terbaca → 503 `PLUGIN_UNAVAILABLE` (toggle
klien tetap antre); id tidak ada di indeks → 404 `PLUGIN_UNKNOWN` (klien membuang op); body tidak valid
(`enabled` bukan boolean, `settings: null`/bukan objek/terlalu besar, `updated_at` tak terbaca, tanpa field) →
422. Sebelum menjawab 404 untuk id yang cocok pola tetapi belum dikenal, server membaca ulang `index.json` sekali
(deploy menulis indeks baru sebelum restart); baca ulang yang gagal mempertahankan daftar lama. Modul server
plugin baru tetap butuh restart. Plugin tidak memanggil API ini; ia milik runtime.

**Izin dan `tasks.ext` (Fase 1).** Loader juga menyimpan `permissions` tiap plugin dari `index.json`
(`plugin_loader.permissions(id)`, `ext_namespaces()`). `POST /api/tasks` menerima `ext` (objek kunci lengkap) dan
`PUT /api/tasks/{id}` menerima `ext_patch` (`{kunci: nilai∣null}`), digabung per kunci di dalam transaksi
`UPDATE` yang sama (`task_ext.py`). Kunci ber-namespace plugin yang tidak berizin `task.ext` **dibuang diam-diam**
(satu `WARNING` per namespace per proses) — bukan 4xx, agar op lama di outbox tidak gagal permanen setelah plugin
dihapus. Bila `index.json` tidak terbaca, semua namespace berbentuk sah diterima (gagal-terbuka, tidak membuang
data). Bentuk salah → 422 `{"detail": {"code": "EXT_INVALID"∣"EXT_TOO_LARGE"∣"EXT_TASK_REF", "key"}}`. Semua
respons task memuat `ext` sebagai objek. PUT yang hanya mengubah `ext` tidak mengirim notifikasi "memperbarui task"
ke anggota workspace. Server hanya memeriksa bentuk, ukuran, namespace, dan `$task` (integer); isi semantik tugas
plugin.

**Restart.** Setiap perubahan modul server plugin, dan rilis yang mengubah `task_ext`/`plugin_loader`, butuh
restart dua layanan (`taskflow-web`, `taskflow`); lihat §10 butir 4.
