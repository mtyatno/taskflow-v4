# Menulis plugin Alurik (Fase 0a)

Plugin = fitur opsional yang dinyalakan/dimatikan pengguna di **Pengaturan › Plugin**. Kodenya hidup di
`static/plugins/<id>/`, bukan di `index.html`, dan baru dieksekusi saat plugin ON dan slot-nya dirender.
Spec: `docs/superpowers/specs/2026-10-29-plugin-fase0a-design.md`. Runtime: `static/plugin-runtime.js`.
Contoh nyata: `static/plugins/habit-heatmap/` (plugin #0). Titik mulai: salin `static/plugins/_template/`.

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
```

`<id>` = nama folder = `manifest.id`, pola `[a-z][a-z0-9-]{2,31}`, tidak pernah diganti (tertanam di kunci
penyimpanan; rename = plugin baru).

## 2. Build: `npm run compile:plugins`

`node compile.js --plugins-only` (atau `npm run compile`, yang juga mengompilasi `index.html`):

1. `plugin.jsx` → `plugin.js` (Babel `preset-react` classic, header `// generated from plugin.jsx — jangan edit`).
   Isi `manifest.json` disuntik sebagai konstanta `manifest` di awal file.
2. Lint: `plugin.js` yang mengandung `tokenStore`, `API_BASE`, `fetch(` atau `localStorage` → build gagal.
3. Menulis `static/plugins/index.json`: `{v: 1, plugins: [{id, name, description, version, minApi, slots,
   permissions, defaultEnabled, files, hash}]}`; `hash` = sha1 8 hex gabungan isi `files`.
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
- `slots`: hanya slot yang dikenal runtime (Fase 0a: `dashboard.widgets`).
- `permissions` Fase 0a: `[]` atau `["storage"]`. Nama yang dicadangkan untuk fase berikutnya (`network`,
  `task.ext`, `records`, `settings.project`, `notifications`, `location`, `secrets`, `noteBlocks`, `bot`,
  `timerHooks`) dan nama asing **ditolak**.
- `defaultEnabled`: status saat pengguna belum pernah menyentuh toggle (bawaan: `false`).

Manifest tidak valid → plugin otomatis OFF dengan toast berisi alasannya. `register` dari id yang tidak ada di
`index.json` diabaikan.

## 4. Siklus hidup ON/OFF

- `TF.plugins.init()` (sekali, di `App`) membaca `index.json` (fallback salinan `_meta plugins:index:v1` bila
  offline) dan status `_meta plugins:state:v1` `{[id]: {enabled, updatedAt}}`. Status **per perangkat**,
  bekerja offline, tanpa `localStorage`.
- **OFF**: `plugin.js` tidak pernah diminta (0 byte dieksekusi).
- **ON + slot dirender** → loader menyuntik `<script src="/static/plugins/<id>/plugin.js?v=<hash>">` (+ `<link>`
  `style.css`) sekali per sesi → `plugin.js` memanggil `window.TF.plugins.register(manifest, factory)` →
  runtime memanggil `factory(api)` → slot merender kontribusi. Tanpa reload.
- `factory(api)` mengembalikan `{ slots: { "dashboard.widgets": [{ id, order, component }] }, onEnable?, onDisable? }`.
- **ON → OFF**: semua pendengar `api.events` plugin dilepas, `onDisable()` dipanggil, slot dirender ulang.
  Data plugin (`api.storage`) **tidak** dihapus.
- `register` tidak terpanggil dalam 10 s / skrip gagal diunduh → gagal untuk sesi ini (status tetap ON).

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

Semua `data.*` membaca IndexedDB, jadi bekerja offline. Tidak ada di v1: `fetch` (Fase 0b, izin `network`),
`records` (Fase 1), penulisan data host. Fungsi hanya ditambah di v1; perubahan tak kompatibel = `apiVersion: 2`.

## 6. Slot `dashboard.widgets`

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

1. **Fasad saja.** Hanya `api` dan `React` global. Dilarang `api`/`tokenStore`/`API_BASE` host, `fetch`,
   `localStorage`, `window.TF.<modul host>`, atau state `App`. Satu-satunya `window.TF` yang dipakai:
   `window.TF.plugins.register`.
2. **Offline by default.** Semua data dari `api.data`; tanpa jaringan (Fase 0a tidak punya `api.fetch`).
3. **Shell dibekukan.** Fitur yang bisa jadi plugin tidak masuk `index.html`; host tidak boleh berisi
   `if (pluginId === "...")` — kebutuhan baru = slot/event/izin baru yang terdokumentasi.
4. **Precache, bukan runtime cache.** File plugin masuk `STATIC` lewat `compile.js` (jangan tulis tangan).
5. **Gagal aman.** Render/pendengar dibungkus runtime: error ke-1 → slot plugin kosong + toast; ke-2 dalam
   satu sesi → otomatis OFF + toast "Plugin {nama} dimatikan karena error"; Pengaturan menawarkan "Aktifkan
   lagi" dan "Salin detail". Jangan menelan error diam-diam; pakai `api.log`.
6. **Warna dari token tema** (`var(--accent)`, `var(--bg-card)`, `var(--border)`, `color-mix(...)`), tanpa hex
   tetap, agar ikut palet Default/Sakura/Lavender dan terang/gelap. Kelas CSS berawalan `.plg-<id>-`;
   `app.css` tidak diubah plugin.
7. **Tanpa `innerHTML`** kecuali lewat `api.ui.sanitize`.
8. **Ukuran.** Satu plugin satu folder; vendor baru > 100 KB wajib lazy.

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
  `habit_heatmap_*.test.js`) agar ikut CI pytest.
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
