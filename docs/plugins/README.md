# Menulis plugin Alurik (Fase 0a–1c-2)

Plugin = fitur opsional yang dinyalakan/dimatikan pengguna di **Pengaturan › Plugin**. Kodenya hidup di
`static/plugins/<id>/`, bukan di `index.html`, dan baru dieksekusi saat plugin ON dan slot-nya dirender.
Spec: `docs/superpowers/specs/2026-10-29-plugin-fase0a-design.md` (klien) dan
`docs/superpowers/specs/2026-10-31-plugin-fase0b-design.md` (status per akun, server, `api.fetch`; ADR-039),
`docs/superpowers/specs/2026-10-31-plugin-fase1-timeline-design.md` (Fase 1: `tasks.ext`, slot view/detail,
`api.taskExt`; ADR-040), `docs/superpowers/specs/2026-11-01-plugin-fase1-1c-otomatis-design.md` (Fase 1c: jadwal
otomatis Timeline 1.1, `setMany` satu transaksi; Timeline 1.2 baseline + aktual; ADR-043–046).
Runtime: `static/plugin-runtime.js`. Modul server opsional: `plugins/<id>.py` (§11).
Contoh nyata: `static/plugins/habit-heatmap/` (plugin #0) dan `static/plugins/timeline/` (Fase 1b: `parts` +
`records` + `task.ext` + dua slot task; Gantt, kalender hari kerja, seksi Jadwal). Contoh `task.ext` + dua slot task
untuk tes: plugin khusus tes `tests/fixtures/plugins/demo-ext/` (tidak pernah dirilis). Titik mulai: salin
`static/plugins/_template/`.

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
   (mis. kalender/jadwal) bisa di-`require` dan dites Node terpisah dari UI.
   **Pola yang dianjurkan: `parts` tanpa global** (contoh `static/plugins/timeline/*.js`): tiap part berbentuk
   `const TLCal = (function (deps) { …; return Object.freeze(api); })(…); if (typeof module !== "undefined" &&
   module.exports) module.exports = TLCal;`. Part yang bergantung pada part lain memakai
   `typeof TLCal !== "undefined" ? TLCal : require("./calendar.js")`: di `plugin.js` gabungan semua `const` part
   berada di lingkup IIFE yang sama sehingga cabang `require` tidak pernah jalan di browser, sedangkan di Node
   tiap part bisa di-`require` sendiri. Tidak ada `window.__x`/`self.__x` (pola lama `demo-ext/util.js`, yang menaruh
   mesin di global, hanya untuk fixture tes). `plugin.jsx` mengakhiri dengan `module.exports = Object.assign({},
   {…part}, {…fungsi murni})` agar tes memuat `plugin.js` hasil build lewat `vm` (§9). `parts` hanya dipakai saat build (tidak disalin ke `index.json`),
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
- `permissions`: subset `["storage", "network", "task.ext", "records"]`. `storage` = `api.storage` (per perangkat);
  `network` (Fase 0b) = `api.fetch` ke rute server milik plugin sendiri, label Pengaturan "Butuh koneksi internet
  untuk sebagian fitur"; `task.ext` (Fase 1) = `api.taskExt`, field plugin di task yang ikut tersinkron, label
  Pengaturan "Menyimpan data tambahan di task (ikut tersinkron)"; `records` (Fase 1, PR 1a-2) = `api.records`,
  record milik plugin yang ikut tersinkron, label Pengaturan "Menyimpan data plugin di akunmu (ikut tersinkron)".
  Nama yang dicadangkan untuk fase berikutnya (`settings.project`, `notifications`, `location`, `secrets`, `noteBlocks`, `bot`, `timerHooks`) dan
  nama asing **ditolak**.
- `taskExt` (Fase 1): `{"keys": ["note", "after"]}` — wajib ada **tepat** bila izin `task.ext` ada; array nama
  field unik, tak kosong, pola `^[a-zA-Z][a-zA-Z0-9_]{0,31}$`. Kunci tersimpan = `<id>.<field>`. `api.taskExt.set`
  hanya menerima field di daftar ini (salah ketik tertangkap); field baru = tambah ke manifest.
- `records` (Fase 1, PR 1a-2): `{"<entitas>": {"conflict": "lww", "maxBytes": 4096}}` — wajib ada **tepat** bila
  izin `records` ada (objek tak kosong). Nama entitas `^[a-z][a-z0-9_]{0,31}$`, **≤ 16 entitas**; `conflict` hanya
  `"lww"` (`merge`/`manual` ditolak: "strategi konflik <x> belum didukung (Fase 1: lww)"); `maxBytes` opsional,
  bilangan bulat 1..65536 (bawaan dan batas atas **64 KB** per record, byte UTF-8 JSON ringkas). `api.records`
  hanya menerima entitas yang dideklarasikan di sini. Aturan sama di `compile.js` dan runtime. Contoh:
  `tests/fixtures/plugins/demo-records/manifest.json` (`"records": {"note": {"conflict": "lww", "maxBytes": 4096}}`).
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
| `api.ui` | `toast(message, type, action?)` (`action` opsional `{label: 1–20 karakter, onClick}`: tombol di toast, mis. "Urungkan"; host menampilkannya 6 s; error sinkron di `onClick` dicatat `api.log` dan tidak dihitung error plugin, sedangkan `onClick` async wajib menangani reject sendiri; `action` tidak sah diabaikan dan toast tetap tampil), `openTask(taskId)`, `navigate(page)` (hanya `dashboard`, `focus`, `inbox`, `settings`; selain itu melempar), `sanitize(html)` (lewat `TF.safehtml`) |
| `api.env` | `online` (getter), `platform` (`"web"∣"tauri"`), `theme` (`{palette, mode}`), `today()` (Asia/Jakarta `YYYY-MM-DD`), `userId` |
| `api.log` | `info/warn/error` berprefiks `[plugin:<id>]` |
| `api.fetch(path, {method, body, timeoutMs})` (izin `network`, Fase 0b) | `→ Promise<json>` ke rute server plugin sendiri: `path` diawali `/api/plugins/<id>/` (atau sama dengan `/api/plugins/<id>`), tanpa `..`, `//`, `\`, `#`, skema/host; `method` GET/POST/PUT/PATCH/DELETE; `body` JSON ≤ 256 KB; timeout bawaan 15 s. Lewat `api.fetch` host (token, `API_BASE` Tauri, 401 → login ulang). Bila toggle plugin ini masih menunggu sinkron, menunggu push ≤ 5 s dulu. Selalu ada di `api`; tanpa izin `network` / path asing → `PluginPermissionError` (dihitung error). |
| `TF.api.PluginNetworkError` | dilempar `api.fetch`; `code`: `offline` (pesan "Butuh koneksi internet", tanpa request bila offline), `timeout`, `auth` (401), `disabled` (403 `PLUGIN_DISABLED`), `unavailable` (503 `PLUGIN_UNAVAILABLE`), `http` (+ `status`, `detail`). **Tidak** dihitung sebagai error plugin. Plugin wajib menangkapnya, menampilkan "Butuh koneksi internet" untuk `offline`, dan menurunkan diri (bagian lain tetap jalan). |

| `api.taskExt` (izin `task.ext`, Fase 1) | `read(task) → {field: nilai}` (kunci namespace sendiri tanpa prefiks; sinkron, murni); `set(taskId, patch) → Promise<task>`; `setMany([{taskId, patch}]) → Promise`; `ref(task) → {$task: id}`. Selalu ada di `api`; tanpa izin → `PluginPermissionError` (dihitung error). Rinci di bawah. |
| `api.records` (izin `records`, Fase 1) | `get(entity, id)`, `list(entity, {scope, limit, after}) → {items, next}`, `put(entity, id∣null, data, {scope}) → Promise<record>`, `remove(entity, id)`, `onChange(fn) → off`, `newId()`. Selalu ada di `api`; tanpa izin → `PluginPermissionError` (dihitung error). Rinci di bawah. |

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
- **Tidak menimpa field inti.** Edit yang hanya mengubah `ext` dikirim ke server tanpa field inti task
  (judul, status, tenggat, penanggung jawab, dan seterusnya): field inti selalu milik server, yaitu anggota
  terakhir yang mengubahnya. Menyeret bar di perangkat yang datanya basi tidak mengembalikan judul atau status
  yang baru diubah orang lain, dan setelah push pertama perangkat itu menampilkan nilai server. Edit yang juga
  menyentuh field inti tetap dikirim penuh seperti biasa (last-write-wins). Edit ext tidak membuat edit inti offline
  perangkat lain kalah: server mencatat waktu inti task terpisah (`core_updated_at`, tidak naik oleh PUT yang
  hanya membawa `ext_patch`), dan perangkat yang tertunda dengan edit inti menang bila inti server belum berubah
  sejak terakhir ia sinkron. Bila kedua sisi mengubah field inti, last-write-wins seperti biasa. Penghapusan tag pada task yang hanya punya edit ext tertunda mengubahnya menjadi kiriman penuh,
  jadi tag itu segera terkirim lewat PUT penuh; penghapusan tag baru tertunda sampai PUT penuh berikutnya bila
  task tidak punya perubahan tertunda sama sekali, bila PUT penuh untuk task itu sedang terkirim, atau bila
  tarik ulang dari server menyetel task kembali ke "hanya ext" (perubahan ext yang belum terkirim ditempel ulang).
- **Seret massal:** pakai `setMany`. Semua item diperbarui optimistis di daftar task host dalam **satu render**
  (bukan satu per item), lalu ditulis berurutan ke IndexedDB dan berhenti pada kegagalan pertama (item
  sebelumnya tetap tersimpan); satu muat ulang daftar task + satu event `taskUpdated` di akhir. Penolakan
  membawa `err.applied` = larik `taskId` yang sudah tersimpan, berurutan (`[]` bila item pertama gagal;
  kegagalan validasi sebelum menulis tidak membawa `applied`). Karena semua item diperbarui optimistis lebih
  dulu, item yang belum tersimpan menampilkan nilai baru sampai muat ulang daftar di akhir selesai; bila muat
  ulang itu sendiri gagal, tampilan baru pulih pada muat ulang berikutnya.
- **Jalur cepat `setMany` (Fase 1c-1).** Bila router task lokal host punya `extPatchMany` (sejak SW v498), `setMany`
  memvalidasi semua patch dulu (gagal → reject tanpa menulis, tanpa `applied`), lalu menulis semua item dalam
  **satu** transaksi IndexedDB atas `tasks` + `_outbox` (satu op outbox per task, bentuk sama dengan jalur per item;
  item sebelum titik gagal tetap ter-commit), memancarkan `tf:outbox-queued` agar host menjadwalkan push, lalu satu
  muat ulang daftar + satu `taskUpdated`. Jalur per item butuh 4,2–4,8 s untuk 200 item (catatan 1c-0: pencarian
  id O(N) dan tiga transaksi per item); di tes Node (fake-indexeddb, 500 task) 200 item turun dari ±1,6–1,7 s ke
  ±0,3–0,4 s. **Kontrak tidak berubah**
  (urutan, berhenti di kegagalan pertama, `err.applied`, satu render). Modul host lama dari cache SW tanpa
  `extPatchMany` → jalur per item apa adanya. `set` tunggal tidak berubah.
- **Optimistis:** state daftar task host diperbarui seketika, lalu ditulis ke IndexedDB (rute lokal
  `PUT /api/tasks/:id` `{ext_patch}`) dan diantre untuk sinkron; gagal → daftar dimuat ulang lalu reject.
  Bekerja offline.
- Pengguna aktif: `api.env.userId` (context `taskDetail.sections` tidak membawa `currentUser`).

**`api.records` (Fase 1, PR 1a-2).** Record milik plugin (id, `data` JSON, scope) yang disimpan di IndexedDB
(store `plugin_records`) dan disinkron ke tabel server `plugin_records` milik host. Cocok untuk data yang bukan
milik satu task (kalender, preset, entri jadwal); data per task tetap lewat `api.taskExt` (§8).

- **Bentuk record.** `{entity, id, scope, data, updated_at, version, pending}` ditambah `error` (kode galat
  sinkron, mis. `INVALID`) **hanya bila ada**. `pending: true` = belum terkonfirmasi server (`version` `null` bila
  belum pernah diterima). `data` dikembalikan sebagai salinan dalam; tombstone (record terhapus) tidak pernah
  dikembalikan. `put` berikutnya menghapus `error`.
- **`get(entity, id)`** → record atau `null`. **`list(entity, {scope, limit = 200, after})`** → `{items, next}`
  (`limit` 1–1000): tanpa `scope` menelusuri kunci primer, dengan `scope` lewat indeks `entity_scope`. `next`
  `null` di halaman terakhir; selain itu teruskan sebagai `after` untuk halaman berikutnya. Urutan = urutan id.
- **`put(entity, id, data, {scope = "user"})`** — `id` `null` → `newId()`. `scope` salah satu `"user"` (milik
  akun) atau `"list:<id>"` (dibagi ke anggota workspace/daftar itu; `project:` ditunda). **Scope tidak bisa
  diubah** setelah record dibuat (`PluginStorageError`, `code` `SCOPE_IMMUTABLE`).
- **Id deterministik wajib menyandikan scope** (mis. `cal@list:12`, `cal@user`) **atau** pakai id acak
  `newId()` (uuid). Id yang sama di dua scope berbeda yang terlihat satu pengguna **ditolak server**
  `SCOPE_IMMUTABLE` (record lokal tetap `dirty` dengan `error`). Id `^[A-Za-z0-9:@._-]{1,80}$`.
  Kasus bergabung: record `u:A/x` dan `l:W/x` bisa sama-sama ada di server bila dibuat sebelum A bergabung ke W;
  secara lokal keduanya memakai kunci `[plugin_id, entity, id]` yang sama dan saling menimpa, itulah sebabnya id
  deterministik **wajib** menyandikan scope.
- **`$task`**: rujukan ke task di dalam `data` lewat `api.taskExt.ref(task)` (`{$task: id}`), sama seperti §5
  `taskExt`; host menahan pengiriman record yang merujuk task yang belum terkirim dan menulis ulang ke id server
  setelahnya (tanpa mengubah `updated_at`).
- **Entitas baru tanpa restart.** Entitas yang baru ditambahkan ke `manifest.records` diterima server tanpa
  restart: entitas yang belum dikenal memicu baca ulang `index.json` (paling sering sekali per 10 detik per
  proses server). Selama deploy belum selesai klien bisa menerima `INVALID` dengan `detail: "entity"` pada record
  itu (record lokal tetap `dirty` dengan `error`); `put` berikutnya mencoba lagi.
- **`remove(entity, id)`** = tombstone lokal yang dikirim ke server (tidak hilang bila offline).
- **`onChange(fn)`** → `off`; `fn({entity, ids, source: "local" | "sync", lost?})`. `lost` berisi id record yang
  kalah LWW atas data lokal atau dibuang karena akses scope hilang (keluar dari workspace): muat ulang dari
  `get`/`list`. Error di pendengar dihitung error plugin. Event window `tf:plugin-records`
  `{pluginId, entity, ids, source, lost?, pulled?}`.
  - **Peristiwa `pulled`** — `{entity: null, ids: [], source: "sync", pulled: true}`: tarik record plugin ini dari
    server selesai dan sukses (sampai halaman terakhir; tepat satu kali per tarik, juga bila tak ada record yang
    berubah; tidak terpancar saat galat, plugin tak dikenal server, atau tarik terpotong batas halaman). Pakai untuk
    tahu data bersama sudah termuat setidaknya sekali, mis. sebelum menulis nilai bawaan ke record workspace di
    perangkat baru. **`entity` bisa `null`** pada peristiwa ini — pendengar yang memfilter `ev.entity` tetap aman
    (peristiwa dilewati), tetapi jangan memakai `ev.entity` sebagai kunci tanpa memeriksa `ev.pulled`. Beda dengan
    `sync.done` host, yang juga menyala saat sinkron gagal.
- **Konflik = last-write-wins** atas `updated_at` (waktu klien, dipotong ke waktu server) per record utuh —
  bukan per field; bagi record per kegunaan bila dua perangkat sering mengedit bagian berbeda.
- **Galat.** Entitas tak dideklarasikan, id/scope tak sah, atau melebihi `maxBytes` → `PluginStorageError` dengan
  `code`: `INVALID` dengan `detail` `entity` (entitas tak dideklarasikan), `id`, `scope`, `data` atau `task_ref`;
  `TOO_LARGE` dengan `detail: "size"` bila `data` melebihi `maxBytes` (pemeriksaan klien sebelum menulis lokal);
  `SCOPE_IMMUTABLE` bila scope record yang ada diubah. Tanpa izin `records` → `PluginPermissionError`. Server
  memeriksa ulang saat sinkron: item di atas batas dijawab `INVALID` dengan `detail: "size"` (bukan `TOO_LARGE`; kode
  itu di sisi server hanya untuk badan POST > 256 KB, 413) dan record lokal tetap `dirty` dengan `error`.
- **Offline dan plugin OFF.** Bekerja penuh offline (tulis lokal dulu, antre di outbox, satu op per record).
  Plugin OFF tetap **mengirim** perubahan yang sudah ada, tetapi **tidak menarik** record dari server; yang belum
  ditarik datang pada sinkron berikutnya setelah plugin ON.

**Contoh: kalender kerja Timeline** (`manifest.records = {"calendar": {"conflict": "lww", "maxBytes": 16384}}`).
Record `calendar` dengan id deterministik yang menyandikan scope: `cal@list:<id>` (scope `list:<id>`, dipakai dan
**boleh diubah semua anggota** workspace itu) atau `cal@user` (scope `user`, pribadi), data
`{v: 1, weekdays, national, cutiBersama, off, work}`. Tidak ada record = kalender bawaan (Sen–Jum, libur nasional dan
cuti bersama ikut). Plugin hanya menyentuh `api.records` lewat satu adaptor (`calendarStore`), menormalkan data dari
anggota lain sebelum dipakai, dan memuat ulang pada `onChange` (termasuk `lost` → toast). Setelah plugin baru
dinyalakan, record belum ditarik sampai sinkron berikutnya: `get` mengembalikan `null` (pakai bawaan) lalu
`onChange({source: "sync"})` memicu muat ulang. **Jangan menulis record bersama yang mungkin hanya belum ditarik:**
`put` tanpa record lokal berangkat dengan `base_version: null` dan menang LWW atas data anggota lain. Timeline
karenanya menonaktifkan edit kalender workspace tanpa record lokal ("Menunggu data kalender workspace…") sampai
peristiwa **`pulled`** pertama sejak view dipasang (tarik sukses), dan membuka kuncinya hanya **setelah** muat ulang
sesudah peristiwa itu selesai — tidak pernah di atas data bawaan. `sync.done` (juga menyala saat sinkron gagal) dan
`onChange` ber-`source: "sync"` biasa (juga dari ack kirim / tulis ulang ref) hanya memicu muat ulang, bukan buka kunci.

**Contoh kedua: unit jadwal Timeline 1.1** (`manifest.records.project = {"conflict": "lww", "maxBytes": 1024}`).
Satu record per unit jadwal (project pribadi, atau satu project di dalam workspace) menyimpan sakelar Jadwal otomatis,
data `{v: 1, auto, name, by}`. Tidak ada record = Manual.

- **Id deterministik ber-hash.** Nama project bebas (spasi, huruf non-ASCII, panjang) tidak muat pola id, jadi id =
  `prj@user:<h>` (scope `user`) atau `prj@list:<lid>:<h>` (scope `list:<lid>`), `<h>` = FNV-1a 32 bit (8 hex huruf
  kecil) atas nama project yang dilipat (A–Z → a–z); task tanpa project → `-` di tempat `<h>`. Scope tetap tersandi di
  id (aturan di atas). Hanya satu fungsi yang membuat id (`TLSched.unitOf`).
- **Penjaga nama.** Hash bisa bertabrakan, jadi `data.name` menyimpan nama project (dipotong 120 unit UTF-16 tanpa
  memotong pasangan surrogate; potongan yang sama dipakai saat tulis dan saat baca) dan pembaca hanya memakai record
  bila lipatan `name` sama dengan lipatan nama project task. Record rusak atau tidak cocok = tidak ada (Manual). Ganti
  nama project = unit baru (kembali Manual); record lama dibiarkan.
- **Jangan menulis dari efek.** Satu adaptor (`projectStore`): `loadUnits` hanya membaca (record rusak tidak
  dinormalisasi lalu disimpan ulang) dan `setAuto` satu-satunya `put`, dipanggil hanya dari klik sakelar. Mount,
  `onChange`, `pulled`, dan `sync.done` hanya memicu baca ulang. Dua anggota menyalakan unit yang sama = LWW per
  record, hasil sama (idempoten).

**Contoh ketiga: baseline Timeline 1.2** (`manifest.records.baseline = {"conflict": "lww", "maxBytes": 65536}`).
Sampai tiga potret jadwal per unit jadwal, data `{v: 1, n, name, savedAt, by, t: [[ref, s, f, d, w], …]}`: satu larik
ringkas per task (±55 B/task), `ref` = `{"$task": <id>}`, `s`/`f` tanggal ISO, `d` durasi hari kerja,
`w` = `estimated_pomodoros`.

- **Id slot dari id unit.** `bl<n>@user:<h>` / `bl<n>@list:<lid>:<h>` dengan `n` ∈ 1–3 = id record `project` unit
  (`prj@…`, di atas) dengan awalan `prj` diganti `bl<n>`; dibuat hanya oleh `blRecId(unit, n)` di atas
  `TLSched.unitOf`. Ganti nama project = unit baru, jadi baseline lama tersembunyi (tetap tersimpan).
- **Rujukan task.** `$task` = id task mentah, sama dengan `api.taskExt.ref`: bilangan bulat id server, atau cid untuk
  task yang dibuat offline (host menahan record lalu menulis ulang rujukan ke id server; server menolak `$task` string
  angka). Rujukan yang tak terpecahkan (`null` dari host, task dihapus/diarsip/di luar scope) dilewati saat dibaca,
  bukan membuang seluruh baseline.
- **Batas ukuran dua sisi.** `TLPlan.BL_MAX = 65536` = `maxBytes`: plugin menghitung byte UTF-8 JSON ringkas
  (`TLPlan.baselineByteSize`) sebelum menulis dan menolak dengan "Baseline terlalu besar"; server menolak hal yang
  sama (65.536 diterima, 65.537 ditolak — teruji di `tests/test_plugin_timeline_records.py`).
- **Kunci simpan (K41).** Slot workspace baru boleh ditulis bila record lokalnya ada **atau** peristiwa `pulled`
  sudah menyala sejak view dipasang; sebelum itu "Menunggu data baseline workspace…" (aturan §8 butir 2). Menimpa
  slot terisi butuh konfirmasi "Timpa {nama} (disimpan {tanggal})?" dan CAS: potret slot `{exists, updatedAt, by}`
  saat dialog dibuka harus sama dengan saat tulis, kalau tidak "Data berubah sejak dialog dibuka — muat ulang".
  Record yang tidak dipahami (mis. `v: 2` dari klien lebih baru) tetap dihitung **terisi** ("(versi lebih baru)"),
  tidak pernah ditimpa diam-diam.
- **Satu adaptor.** `baselineStore`: `loadScope`/`loadAll` hanya membaca (satu `list` se-scope dibagi semua unit
  halaman workspace), `save`/`remove` lewat satu fungsi penulis `saveBaseline`, dipanggil hanya dari dialog Simpan
  baseline. Baseline yang **ditampilkan** = preferensi per perangkat `bl:<page>` (`api.storage`), bukan record.

Semua `data.*` membaca IndexedDB, jadi bekerja offline. Tidak ada di v1: `api.settings` (kolom `settings` server sudah disimpan dan disinkron tetapi belum diekspos), penulisan data host
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

**Pemakai pertama: Timeline** (`static/plugins/timeline/`, `contributes["taskList.views"]` id `gantt`, `pages`
`["project", "workspace"]`). `TimelineView` membaca `context.scopeTasks` (termasuk task selesai), menghitung tata
letak murni (`layout.js`) dan hanya menggambar baris/kolom di jendela tampak (virtualisasi); `context.onTaskClick`
membuka Live Edit/modal. Jadwal per task lewat `api.taskExt` (`timeline.start|duration|deps`), kalender kerja lewat
`api.records` (entitas `calendar`, di bawah), preferensi tampilan per perangkat (zoom, urutan, mode HP) lewat
`api.storage`. Seret bar = satu `api.taskExt.set` per lepas; toast "Urungkan" memakai `api.ui.toast` dengan `action`.
`scopeTasks` sudah difilter panel host, jadi validasi yang butuh semua task (siklus dependensi lewat task tersembunyi,
induk yang anaknya tersembunyi) membaca `api.data.tasks.list({includeDone: true})` sebelum menulis.

**Timeline 1.1 (jadwal otomatis, Fase 1c-1).** Mesin jadwal (CPM murni, parts `cpm.js`/`plan.js`) dihitung dari
**daftar lengkap** `api.data.tasks.list({includeDone: true})` yang disaring ke scope dependensi halaman, **bukan** dari
`scopeTasks`: filter panel tidak boleh membuang pendahulu dari perhitungan. `scopeTasks` hanya menentukan baris yang
digambar dan, saat identitasnya berubah (juga `sync.done`), memicu muat ulang daftar lengkap (debounce 300 ms, hanya
jawaban terbaru dipakai). Mesin dijalankan **setelah gambar pertama** (`requestAnimationFrame` lalu
`setTimeout(…, 0)`, hasil di-memo per kunci data): render awal menampilkan bar tanpa Slack, jalur kritis, atau banner,
lalu nilai itu menyusul; selama mesin belum siap atau gagal, kontrol otomatis disembunyikan. Hasil hitung hanya untuk
tampilan (§8 butir 9). Gestur pada task otomatis menulis task itu dan turunannya dengan **satu** `setMany` (> 20
turunan → pratinjau dulu); Urungkan = `setMany` atas nilai mentah sebelumnya (`null` untuk kunci yang dulu tidak ada).

### 6.3 `taskDetail.sections` (Fase 1)

Seksi di detail task, antara Deskripsi dan tab (Subtask/Komentar/…), di modal maupun panel Live Edit. Tanpa
kontribusi tidak ada wadah; bila ada, dirender di wadah `td-plugin-sections`, urut `order`. `context`:
`{task, variant: "modal"∣"panel", collaborators, onOpenTask, showToast}`; pengguna lewat `api.env.userId`.
Seksi biasanya membaca `api.taskExt.read(context.task)` dan menulis lewat `api.taskExt.set`.

**Pemakai pertama: Timeline** (id `schedule`, label "Jadwal"): Mulai, Durasi, dependensi, tenggat; mengembalikan
`null` untuk task yang tidak relevan (berulang, tanpa `id`). **`context.task` di modal adalah salinan**
(`selectedTask` tidak mengikuti daftar `tasks`): setelah `api.taskExt.set`, prop `task` tidak berubah sampai modal
dibuka ulang. Seksi yang menulis karenanya **menyimpan state lokal optimistis** (nilai yang baru ditulis) dan
men-seed ulang dari props hanya bila `task.id` berganti atau nilai ext di props berubah; jangan menampilkan langsung
`api.taskExt.read(context.task)` setelah menulis. Simpan pada `change`/`blur`/Enter (atau debounce), bukan per ketikan.

## 7. Event

Nama `domain.peristiwa` huruf kecil; payload salinan beku; pendengar dipanggil sinkron, tidak bisa
membatalkan aksi host, dan sebaiknya ringan (debounce kerja berat, mis. 300 ms seperti Heatmap).

| Event host | Kapan | Payload |
|---|---|---|
| `task.completed` | `handleDone` di `App` setelah sukses lokal — termasuk drop Kanban ke Selesai (`runKanbanAction` → `onDone` → `handleDone`); yang BELUM memancarkan: dialog subtask (`handleDoneAll`/`handleDoneParentOnly`), tinjauan mingguan, dan cabang offline-error `handleDone` (ADR-046) | `{taskId, completedAt}` |
| `habit.changed` | setiap check-in/uncheck habit (jembatan `window` `habitSaved`) — baca ulang data | `{}` |
| `pomodoro.ended` | sesi/overtime Pomodoro tercatat | `{taskId, kind: "session"∣"overtime", pomodoros, focusSeconds, endedAt}` |
| `app.online` / `app.offline` | event `online`/`offline` browser | `{}` |
| `app.dayChanged` | tanggal Asia/Jakarta berganti (dicek tiap 60 s) | `{date}` |
| `sync.done` | sinkron awal selesai (`initial: true`) atau sinkron berkala kembali idle — **juga saat sinkron gagal**; tanda "record plugin sudah ditarik" = peristiwa `pulled` di `api.records.onChange` (§5) | `{initial}` |
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
   offline ("Butuh koneksi internet"), sisanya tetap jalan. Sebelum menulis record **bersama** yang belum ada di
   perangkat (mis. nilai bawaan ke record workspace), tunggu peristiwa `pulled` (§5) — bukan `sync.done`, yang juga
   menyala saat sinkron gagal; tanpa itu `put` ber-`base_version: null` bisa menimpa data anggota lain lewat LWW.
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
   `app.css` tidak diubah plugin. Token yang belum tentu ada di `app.css` (mis. `--danger`) dibungkus token lokal
   dengan fallback, mis. `--plg-timeline-danger: var(--danger, var(--pomodoro))`.
   **Modifier keadaan memakai kelas `.is-*` yang ditempelkan pada selektor `.plg-<id>-*`** (mis.
   `.plg-timeline-row.is-selected`, `.plg-timeline-btn.is-active`), bukan kelas global tanpa awalan dan bukan gaya inline
   untuk warna.
   **Satu pengait host yang boleh dibaca: atribut `[data-theme="dark"]` di elemen dokumen** — hanya untuk
   `color-scheme` kontrol bawaan (mis. `<input type="date">` agar ikon kalender terang di mode gelap), selektor
   `[data-theme="dark"] .plg-<id>-…` di `style.css`. Baca saja; jangan menulis atribut itu dan jangan
   membaca atribut host lain. Untuk logika JS pakai `api.env.theme`.
7. **Tanpa `innerHTML`** kecuali lewat `api.ui.sanitize`.
   **Jangan menulis kolom task lain.** Plugin hanya menulis `tasks.ext` miliknya lewat `api.taskExt`; judul,
   status, tenggat, `progress`, dsb. tetap milik host (dibaca saja dari `context`/`api.data.tasks`).
   **Jangan menyimpan data per task di record.** Field yang melekat pada task (mulai, durasi, dependensi) pakai
   `task.ext` lewat `api.taskExt`, agar ikut task di semua jalur; `api.records` untuk data yang berdiri sendiri.
8. **Ukuran.** Satu plugin satu folder; vendor baru > 100 KB wajib lazy.
9. **Hasil hitung tidak pernah ditulis otomatis — tampilkan drift, tulis hanya dari gestur** (K27). Mesin (CPM,
   agregat, normalisasi) boleh berjalan kapan saja, tetapi `api.taskExt.set`/`setMany` dan `api.records.put` hanya
   dipanggil dari klik/ketik pengguna di perangkat ini (seret, Terapkan, sakelar, Perbarui), tidak pernah dari mount,
   `sync.done`, `pulled`, `onChange`, atau `app.dayChanged`. Data yang berbeda dari hasil hitung ditampilkan sebagai
   drift (banner/seksi + "Tinjau"); dua perangkat yang menulis hasil hitung masing-masing di latar akan saling
   menimpa. Timeline menjaganya dengan tes sumber (panggilan tulis hanya di fungsi daftar-izin) + tes perilaku (spy 0).
10. **Aktual dicatat dari gestur perangkat itu (pomodoro selesai, task selesai), isi bila kosong — tidak pernah dari
   sync** (K42 setelah amandemen). Timeline mencatat `timeline.actual.start` hanya pada event `pomodoro.ended` dan
   `task.completed` (keduanya hanya dari gestur lokal), memakai tanggal Asia/Jakarta dari `endedAt`/`completedAt`
   (atau hari ini), dan hanya bila kunci itu kosong. Listener terpasang saat kode plugin termuat di sesi (render pertama Timeline/seksi); pomodoro atau centang SEBELUM itu — termasuk replay sesi basi saat mount — tidak tercatat; fallback-nya tombol "Catat hari ini". Pemicu dari kenaikan `progress` dibatalkan: perbedaan data tidak
   membedakan edit lokal dari hasil tarik. `actual.finish` tidak disimpan otomatis (turunan `completed_at`); yang
   terlewat diisi lewat tombol "Catat hari ini".

**Batas diketahui — ini bukan sandbox.** Pagar di atas menangkap kesalahan tak sengaja, bukan niat jahat:

- Lint `compile.js` berbasis teks dan bisa diakali (`globalThis["fetch"]`, alias `const f = fetch`, `WebSocket`,
  `EventSource`, `import()` dinamis, dsb.). `plugin.js` berjalan di halaman yang sama dengan host dan secara
  teknis bisa menjangkau apa pun yang bisa dijangkau halaman.
- `api.fetch` memeriksa path (karakter kontrol ditolak, path dinormalkan parser URL wajib sama dengan aslinya dan
  tetap di bawah `/api/plugins/<id>`), tetapi itu hanya menjaga plugin yang memakai fasad.
- Pagar `ensure_schema` (§11) hanya menangkap DDL tak sengaja di luar prefix `plg_<id_>_`; ia **tidak** menahan
  `DELETE`/`UPDATE` ke tabel host, `ATTACH DATABASE`, atau trigger `plg_` yang menulis tabel host, dan kode
  endpoint server memakai koneksi DB host yang sama tanpa pembatasan.

**Kasus tepi `tasks.ext` (Fase 1):**

- Rujukan `{"$task": <cid>}` ke task yang dibuat offline dan op create-nya **gagal permanen** (dibuang, atau
  "Buang perubahan lokal" pada task baru) diganti `null` saat dikirim: task itu tidak pernah punya id server. Plugin
  wajib menerima `null` di tempat rujukan (mis. dependensi ke task yang sudah tidak ada).
- PUT yang membawa `ext_patch` dan hanya mengubah **tag** task dianggap "hanya ext": perbandingan field inti untuk
  melewati notifikasi "memperbarui task" (`_core_changed`, `webapp.py`) tidak menghitung perubahan tag (tag disimpan
  terpisah dari kolom task). Push klien selalu membawa tag, jadi bila tag diubah lalu plugin menulis ext sebelum
  sinkron (satu PUT gabungan), anggota workspace tidak mendapat notifikasi perubahan tag itu.
- Namespace yang belum dikenal memicu baca ulang `index.json` paling sering sekali per 10 detik per proses: kunci
  plugin yang baru ditambahkan bisa dibuang selama ≤ 10 detik setelah deploy menulis indeks baru (op klien tidak
  gagal; kunci tetap ada di perangkat dan terkirim lagi pada edit berikutnya pada kunci itu).

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
- **Record plugin (Fase 1, PR 1a-2)**: plugin contoh khusus tes `tests/fixtures/plugins/demo-records/`; server
  `tests/test_plugin_records.py`; klien `tests/offline/db_v7.test.js`, `plugin_sync*.test.js`,
  `plugin_records_api.test.js`; vektor bersama klien–server `tests/fixtures/plugin_records_vectors.json`.
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
   `index.json` saat request membawa namespace belum dikenal (paling sering sekali per 10 detik), jadi plugin baru
   berizin `task.ext` diterima tanpa restart; perubahan ext yang dijawab server lama (tanpa `ext` objek) tetap tertahan di perangkat dan
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
plugin baru tetap butuh restart; entitas record baru di `manifest.records` tidak (§5 `api.records`, §11 record).
Plugin tidak memanggil API ini; ia milik runtime.

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

**Record plugin (Fase 1, PR 1a-2).** `plugin_records.py` (milik host, dipasang sebelum router plugin): tabel
`plugin_records` + `plugin_records_meta` **bukan** objek `plg_*` dan tidak dikelola `ensure_schema` plugin
(dibuat `plugin_loader.migrate`); rute `GET` dan `POST /api/plugins/{plugin_id}/records` **dicadangkan** — router
plugin yang mendefinisikan `/records` ditolak utuh ("rute /records dicadangkan host"). Berbeda dengan rute
plugin lain, endpoint ini **tidak mensyaratkan plugin ON** (push tetap diterima; pull hanya dipanggil klien untuk
plugin ON). Sinkron memakai kursor `seq` (nomor urut commit server, bukan `updated_at` klien) sehingga edit offline
yang terlambat tetap tertarik perangkat lain; kursor tidak sah (format, `seq` di bawah batas purge, atau sidik jari
keanggotaan workspace berubah) → `{"reset": true}` dan klien menarik penuh. Kursor dari GET ber-`entity` hanya sah
untuk filter yang sama (kursor `seq` global per plugin; dipakai tanpa filter ia melewatkan entitas lain). Plugin harus ada di `index.json` dan
berizin `records` (kalau tidak 404 `PLUGIN_UNKNOWN`); entitas dan `maxBytes` dibaca dari deklarasi indeks.
Kode: `PLUGIN_UNKNOWN`, `PLUGIN_UNAVAILABLE` (503, antre di klien), `TOO_LARGE` (413, POST > 256 KB),
`INVALID`, `FORBIDDEN_SCOPE`, `SCOPE_IMMUTABLE`. Entitas record baru di `manifest.records` **tidak butuh restart**: POST/GET
ber-`entity` yang belum dikenal membaca ulang `index.json` (paling sering sekali per 10 detik per proses; bukan
di dalam transaksi tulis; indeks rusak mempertahankan daftar lama). Runbook deploy: tunggu lebih dari 10 detik
setelah indeks ditulis sebelum menguji entitas baru. Rilis yang mengubah `plugin_records`/`plugin_loader` butuh
**restart dua layanan** (`taskflow-web`, `taskflow`); selama jendela deploy server lama menjawab 404 tanpa kode dan
op record tetap antre di klien. Tombstone dibersihkan setelah 30 hari.
