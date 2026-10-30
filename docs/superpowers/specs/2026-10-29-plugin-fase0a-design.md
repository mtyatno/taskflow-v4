# Spec: Sistem Plugin Alurik — Fase 0a (fondasi klien + plugin #0 Heatmap)

- **Tanggal:** 2026-10-29
- **Basis kode:** `main` @ `b11ebe1` (mtyatno/taskflow-v4; SW `taskflow-v486-ws-dropdown`, `app.css?v=382`, `themes.css?v=2`, IndexedDB `taskflow-offline` v6, 80 modul `static/offline/`, `webapp.py` 10.838 baris / 213 endpoint / 0 `APIRouter`, `index.html` 46.049 baris)
- **Status:** disetujui pemilik 2026-10-31 (A1–A4 + istilah diputuskan, lihat §2). Hasil brainstorming 2026-10-28/29 (pemilik + Claude + analisis rekan pemilik: "Peta kebutuhan" dan "Evaluasi Bottleneck"). Belum ada branch.
- **Salinan:** Project claude.ai "alurik" `claude/spec-plugin-fase0a-2026-10-29.md`; saat implementasi dimulai, ikut di-commit ke `docs/superpowers/specs/2026-10-29-plugin-fase0a-design.md`. Isi keduanya harus sama.
- **Dokumen terkait:** mockup Timeline/Gantt (artifact "Mockup Timeline Alurik", 4 artboard) sebagai gambaran plugin Fase 1; bukan bagian spec ini.
- **Istilah:**
  - *host* = aplikasi Alurik inti (`index.html` + `static/offline/*` + `webapp.py`);
  - *plugin* = unit fitur opsional yang bisa dinyalakan/dimatikan per pengguna, kodenya di `static/plugins/<id>/`;
  - *runtime* = modul `static/plugin-runtime.js`: registry, loader, slot, event bus, fasad `TF.api`, status ON/OFF;
  - *slot* = titik kait bernama di UI host tempat plugin menyumbang komponen (mis. `dashboard.widgets`);
  - *manifest* = objek deskripsi plugin (id, nama, versi, slot, izin) yang didaftarkan plugin ke runtime;
  - *fasad `TF.api`* = satu-satunya permukaan host yang boleh dipakai plugin; ber-versi (`apiVersion`);
  - *ON/OFF (enabled)* = status plugin per pengguna; OFF = UI plugin tidak dirender dan kodenya tidak dieksekusi, data tidak dihapus;
  - *lazy-execute* = kode plugin dieksekusi (disuntik sebagai `<script>`) hanya saat slot-nya pertama kali dirender, walau filenya sudah di-precache;
  - *Fase 0a* = spec ini: klien saja, tanpa perubahan server/SQLite; *Fase 0b* = sisi server (`load_plugins`, `plugin_states`); *Fase 0c* = SW revisi per file; *Fase 1* = Timeline + IndexedDB v7 + `plugin_records`.

---

## 1. Tujuan

Alurik akan mendapat fitur-fitur opsional (Timeline/Gantt, Peliharaan, Boss Mingguan, Mode Ramadan, Forward WA/Telegram, CalDAV, Flashcard, dan ide-ide yang belum terpikir) tanpa membuat `index.html` dan `webapp.py` terus membengkak, dan tanpa memaksa semua pengguna memuat kode fitur yang tidak mereka pakai. Fase 0a membangun fondasi terkecil yang membuat tombol ON/OFF plugin bekerja sungguhan, dibuktikan dengan satu plugin kecil (#0 Heatmap), **tanpa menyentuh server, SQLite, maupun versi IndexedDB**.

**Kriteria berhasil**

1. **Runtime ada dan ber-versi.** `window.TF.plugins` (registry + loader + status) dan `window.TF.api` (`apiVersion: 1`) tersedia sebelum `App` dirender; plugin tidak menyentuh global `index.html` lain selain `React`.
2. **Satu slot bekerja.** Komponen `<TF.Slot name="dashboard.widgets"/>` di `Dashboard` merender kontribusi semua plugin ON, urut `order`, masing-masing dibungkus error boundary.
3. **Lazy-execute.** Kode plugin tidak dieksekusi saat aplikasi start; file `plugin.js` disuntik saat slot pertama kali dirender dan plugin ON. Plugin OFF = 0 byte JS dieksekusi.
4. **100% offline.** File plugin ada di precache `sw.js`, jadi aktivasi dan render plugin bekerja tanpa jaringan sejak rilis terpasang. Di Tauri (Desktop/APK) file ikut `dist-tauri/static/plugins/`.
5. **ON/OFF per perangkat tersimpan.** Toggle di Pengaturan › Plugin, tersimpan di IndexedDB `_meta` (bukan `localStorage`), langsung berlaku tanpa reload, bekerja offline.
6. **Gagal aman.** Plugin yang melempar error saat load atau render tidak membuat layar putih: slot itu kosong, toast sekali, plugin dinonaktifkan otomatis setelah 2 error dalam satu sesi.
7. **Event bus hidup.** Host memancarkan `task.completed`, `habit.checked`, `habit.unchecked`, `pomodoro.ended`, `app.online`, `app.offline`, `app.dayChanged`, `sync.done`; plugin bisa mendengar dan memancarkan event bernamespace sendiri.
8. **Plugin #0 Heatmap** menampilkan grid 365 hari habit tercentang (+ opsional task selesai) di Dashboard, dihitung 100% dari IndexedDB, ikut token tema (Default/Sakura/Lavender, terang/gelap), tanpa Chart.js.
9. **Build & tes.** `npm run compile` mengompilasi `static/plugins/*/plugin.jsx` → `plugin.js`; `npm test` mencakup tes runtime, slot, event bus, status, loader, dan heatmap; `check_inline_scripts` tetap lolos.
10. **`index.html` bertambah ≤ 60 baris** (slot, emit event, kartu Pengaturan). Semua logika runtime di file terpisah.

## 2. Keputusan

| # | Keputusan | Alasan |
|---|---|---|
| K1 | Fase 0a klien saja: tidak ada perubahan `webapp.py`, SQLite, `bot.py`, dan versi IndexedDB tetap 6. | Membuktikan fondasi dengan risiko nol pada data; bump IndexedDB (perlu `onupgradeneeded`, bisa diblokir tab lain) ditunda ke Fase 1 bersama `plugin_records`. |
| K2 | Kode plugin di `static/plugins/<id>/plugin.jsx`, dikompilasi `compile.js` menjadi `plugin.js` di folder yang sama; `index.html` tidak berisi kode plugin. | `index.html` 46 ribu baris sudah di batas; tanpa bundler, `React` global membuat plugin bisa memakai React yang sama tanpa konflik instance. |
| K3 | Precache semua plugin bawaan di `STATIC` `sw.js` (bukan runtime cache), eksekusi tetap lazy saat slot dirender. | Koreksi dari evaluasi rekan: runtime cache gagal bila pengguna offline sebelum slot pernah dibuka. Precache = siap offline; lazy-execute = startup tetap ringan. |
| K4 | Fase 0a memakai bump versi cache SW monolitik seperti biasa; precache revisi per file (manifest hash) menjadi Fase 0c dengan spec sendiri. | Mengubah strategi cache menyentuh alur banner update (`appupdate.js`, `/api/version`) yang baru diperbaiki 2026-10-22; dengan 1 plugin, ongkos unduh ulang masih kecil. Strategi cache bisa diganti kapan saja tanpa migrasi data. |
| K5 | Status ON/OFF Fase 0a per perangkat di IndexedDB `_meta` kunci `plugins:state:v1`; Fase 0b menambah `plugin_states` per pengguna di server dan melebur status perangkat ke status pengguna (OR) pada sinkron pertama. | `_meta` sudah ada (KV, precedent `contexts:pending:v1`), bekerja offline, tidak perlu bump versi. Per pengguna dibutuhkan begitu plugin menyimpan data (Fase 1). |
| K6 | OFF = UI disembunyikan, kode tidak dieksekusi, pendengar event dilepas; data plugin tidak dihapus. "Hapus data plugin" = aksi terpisah dengan konfirmasi (Fase 1, saat ada data). | Mematikan Timeline tidak boleh menghapus tanggal mulai yang sudah diisi. |
| K7 | Plugin hanya memakai `TF.api` (ber-versi) dan `React`; dilarang memakai `api`, `tokenStore`, `API_BASE`, `fetch("/api/...")`, state `App`, atau global `index.html` lain. | `config.js` mengarahkan `__API_BASE` ke VPS di Tauri; `fetch` langsung jalan di web tapi mati di Desktop/APK. Fasad juga melindungi host saat refactor. |
| K8 | Plugin offline by default. Fase 0a tidak menyediakan `TF.api.fetch` sama sekali; Fase 0b menyediakannya hanya untuk plugin dengan izin `network`, dan UI wajib menurunkan diri dengan pola "Butuh koneksi internet" yang sudah ada. | Alurik wajib 100% offline, tapi punya preseden operasi online-only (`PATCH /api/contexts`, tandai task berulang dari Kanban). Larangan mutlak terlalu keras; izin eksplisit lebih jujur. |
| K9 | Slot didefinisikan host satu per satu saat ada plugin yang membutuhkan; Fase 0a hanya `dashboard.widgets`. Host dilarang menulis `if (pluginId === …)`. | Menghindari merancang slot untuk kebutuhan yang belum ada; satu pengecualian bernama sudah cukup merusak sistem plugin. |
| K10 | Event bus host: nama `domain.peristiwa` (huruf kecil), payload objek beku (`Object.freeze`), pendengar dipanggil sinkron dalam `try/catch` terpisah, tidak boleh `await` dan tidak bisa membatalkan aksi host. Hook yang bisa membatalkan/menjeda (mis. timer Ramadan) adalah mekanisme berbeda (Fase Ramadan). | Bus murah dan hampir semua plugin membutuhkannya; memisahkan "mendengar" dari "mengubah" menjaga host tetap bisa diprediksi. |
| K11 | Plugin #0 = **Heatmap habit** (+ task selesai sebagai opsi), bukan Heatmap 🍅. | `pomolog.js` hanya mengantre op; riwayat `pomodoro_log` tidak ada di IndexedDB dan satu-satunya endpoint pomodoro adalah `POST`. Heatmap 🍅 menyusul saat log dihidrasi lewat delta pull (Fase 1+). `habit_logs` dan `tasks.completed_at` sudah lengkap di klien. |
| K12 | Plugin mendaftar lewat `window.TF.plugins.register(manifest, factory)`; format file = skrip klasik (bukan modul ES), memakai `window` secara eksplisit, tanpa pola UMD `this`. | `index.html` adalah skrip klasik hasil Babel `preset-react` classic. `import()` menjalankan file sebagai modul (strict, `this` undefined) sehingga pola UMD lain bisa diam-diam gagal mendaftar; penyuntikan `<script>` konsisten dengan 80 modul offline. CSP Tauri (`script-src 'self'`) mengizinkannya. |
| K13 | Error boundary per slot (`PluginBoundary`) terpisah dari `AppErrorBoundary`; 2 error per plugin dalam satu sesi → plugin dinonaktifkan otomatis dengan toast dan tombol "Aktifkan lagi" di Pengaturan. | `AppErrorBoundary` menggantikan seluruh pohon dengan layar pemulihan; kegagalan plugin tidak boleh sampai ke sana. |
| K14 | Styling plugin: Tailwind v2 prebuilt + token `themes.css` (`--accent`, `--bg-card`, `--border`, dst.) + `style.css` opsional milik plugin (dideklarasikan di manifest, ikut precache). `app.css` tidak diubah oleh plugin. | Tailwind statis, tidak ada purge/JIT; `app.css` tidak perlu bump (`?v=382` tetap). |
| K15 | Pengujian Fase 0a: `node --test` dengan `fake-indexeddb` (harness yang ada, 267 tes) untuk runtime dan heatmap; tanpa pytest karena server tidak berubah; E2E manual 8 langkah (§11.3). | Mengikuti pola `tests/offline/*.test.js`. |
| K16 | Dokumentasi untuk pembuat plugin: `docs/plugins/README.md` (satu halaman) + `static/plugins/_template/` yang disalin untuk plugin baru; keduanya bagian dari Fase 0a. | Ongkos memulai plugin baru menentukan apakah ide masa depan jadi dikerjakan. |

**Keputusan pemilik 2026-10-31 (sebelumnya asumsi A1–A4)**

- A1. Status ON/OFF **per perangkat** di Fase 0a (`_meta`); per pengguna di server menyusul di Fase 0b.
- A2. Plugin dalam workspace ditunda ke spec Fase 1 (Timeline).
- A3. Toggle plugin **tetap bisa diubah saat offline** dan disinkronkan belakangan saat jaringan tersedia (Fase 0b: op outbox payload-only `plugin_state/set`); tidak ada "Butuh koneksi internet" untuk toggle.
- A4. Plugin #0 = **Heatmap Habit** (dengan opsi menampilkan task selesai).
- Istilah UI: **"Plugin"**.

## 3. Ruang lingkup

| Fase | Isi | Server? | IndexedDB? |
|---|---|---|---|
| **0a (spec ini)** | `plugin-runtime.js`, `<Slot>`, event bus, `TF.api` v1, status `_meta`, loader + precache, `PluginBoundary`, kartu Pengaturan › Plugin, `compile.js`, template + README, plugin #0 Heatmap, tes | tidak | v6 tetap |
| 0b | `plugins/<id>.py` + `load_plugins(app)` + `APIRouter` dengan `Depends(require_plugin_enabled, current_user)`, `ensure_schema` di `migrate_db()`, tabel `plugin_states`, `GET/PUT /api/plugins/state`, outbox op `plugin_state/set`, `get_conn()` tunggal (`busy_timeout=5000`, `isolation_level="IMMEDIATE"`), `TF.api.fetch` berizin | ya | v6 tetap |
| 0c | `sw.js` precache revisi per file (manifest hash dari `compile.js`), cache plugin terpisah dari shell, kompatibel dengan `appupdate.js`/`whatsnew.js` | tidak | v6 tetap |
| 1 | Timeline: bump v6→v7 (`plugin_records`, `plugin_kv`), `plugin_sync.js` (outbox coalescing, keyset cursor, tombstone), `tasks.ext`, tabel `plugin_records` server + endpoint delta, slot `taskList.views` dan `taskDetail.sections`, setting per project | ya | v7 |
| ditunda | kanal SSE per pengguna, `plugin_jobs` + worker, `plugin_secrets` (MultiFernet), `register_bot`, pipeline intake, registry blok Milkdown, `theme.decorations`, `activeWhen` bertanggal, sandbox pihak ketiga, marketplace | – | – |

## 4. Arsitektur Fase 0a

### 4.1 File

| File | Status | Isi |
|---|---|---|
| `static/plugin-runtime.js` | baru (~300 baris, tanpa JSX) | registry, manifest validator, status, loader, event bus, `TF.api` v1, `TF.Slot`, `PluginBoundary`, helper `usePluginData` |
| `static/plugins/habit-heatmap/plugin.jsx` | baru | plugin #0 |
| `static/plugins/habit-heatmap/plugin.js` | hasil `compile.js`, di-commit (seperti `index.html` terkompilasi) | – |
| `static/plugins/habit-heatmap/style.css` | baru, opsional | kelas `.plg-heatmap-*` |
| `static/plugins/_template/plugin.jsx`, `README.md` | baru | templat plugin |
| `static/plugins/index.json` | baru, ditulis `compile.js` | daftar plugin bawaan: `[{id, version, files:[…], hash}]` untuk precache dan Pengaturan (nama/deskripsi dibaca dari manifest saat plugin dimuat; sebelum dimuat, dari `index.json` yang menyalin field `name`, `description`, `permissions`) |
| `static/index.html` | ubah ≤ 60 baris | `<script src="/static/plugin-runtime.js">` setelah modul offline terakhir dan sebelum `ui-components.js`; `<TF.Slot name="dashboard.widgets"/>`; 8 titik `TF.events.emit`; `PluginSettingsCard` di `SettingsPage` |
| `static/sw.js` | ubah | `STATIC` += `/static/plugin-runtime.js`, `/static/plugins/index.json`, dan setiap file dari `index.json` dengan query `?v=<hash>`; bump `CACHE` |
| `compile.js` | ubah (+~40 baris) | loop `static/plugins/*/plugin.jsx` → `plugin.js`, tulis `index.json` |
| `scripts/build-tauri-dist.js` | tidak berubah | sudah menyalin seluruh `static/`; cukup pastikan `npm run compile` dijalankan sebelumnya (CI) |
| `static/whatsnew.json` | ubah | entri rilis |
| `docs/plugins/README.md` | baru | cara menulis plugin |
| `tests/offline/plugin_*.test.js` | baru | §11 |

### 4.2 Urutan muat

1. `config.js` → vendor → `static/offline/*.js` (termasuk `db.js`, `meta.js`) → **`plugin-runtime.js`** → `ui-components.js` → skrip `index.html`.
2. `plugin-runtime.js` membaca `/static/plugins/index.json` **secara sinkron dari cache?** Tidak: dibaca lewat `fetch` saat `TF.plugins.init()` dipanggil di awal `App` (sebelum sinkron awal), hasilnya disimpan di memori; bila fetch gagal (offline tanpa precache, seharusnya tidak terjadi), fallback ke daftar terakhir di `_meta` kunci `plugins:index:v1`.
3. `init()` juga membaca status dari `_meta` `plugins:state:v1`. Sampai `init()` selesai, `<Slot>` merender kosong (bukan spinner) agar Dashboard tidak melompat.
4. Slot pertama kali dirender → untuk setiap plugin ON yang menyumbang slot itu → `load(id)` menyuntik `<script src="/static/plugins/<id>/plugin.js?v=<hash>">` (+ `<link>` `style.css` bila ada) → skrip memanggil `TF.plugins.register(manifest, factory)` → runtime memvalidasi manifest, memanggil `factory(TF.api.for(id))` → hasil `{ slots: { "dashboard.widgets": [{ id, order, component }] }, onEnable?, onDisable?, settings? }` disimpan → slot merender ulang.
5. `load(id)` memakai timeout 10 s; bila `register` tidak terpanggil → dianggap gagal (§8).

### 4.3 Manifest

```js
window.TF.plugins.register({
  id: "habit-heatmap",            // [a-z][a-z0-9-]{2,31}, unik, = nama folder
  name: "Heatmap Habit",
  description: "Grid 365 hari habit tercentang dan task selesai di Dashboard.",
  version: "1.0.0",               // semver
  minApi: 1,                      // apiVersion minimum; runtime menolak bila TF.api.apiVersion < minApi
  slots: ["dashboard.widgets"],   // hanya slot yang dikenal runtime; slot asing → ditolak dengan pesan jelas
  permissions: [],                // Fase 0a: hanya [] atau ["storage"]; nama lain → ditolak
  defaultEnabled: false,          // nilai saat belum ada status tersimpan
  builtin: true                   // Fase 0a selalu true
}, function factory(api) { /* mengembalikan kontribusi */ });
```

Daftar izin yang **dicadangkan** untuk fase berikutnya (ditolak di 0a agar tidak ada yang mengandalkannya diam-diam): `network`, `task.ext`, `records`, `settings.project`, `notifications`, `location`, `secrets`, `noteBlocks`, `bot`, `timerHooks`.

### 4.4 Registry dan status (`TF.plugins`)

| Fungsi | Perilaku |
|---|---|
| `init()` | baca `index.json` + status; sekali per sesi; mengembalikan Promise |
| `list()` | `[{id, name, description, version, enabled, loaded, failed, permissions}]` untuk kartu Pengaturan |
| `isEnabled(id)` | sinkron, dari memori |
| `setEnabled(id, bool)` | tulis `_meta` `plugins:state:v1` (`{[id]: {enabled, updatedAt}}`), update memori, emit `plugins.changed` `{id, enabled}`; ON → memuat bila ada slot yang sedang tampil; OFF → lepas pendengar event plugin itu, panggil `onDisable()`, render ulang slot. Tanpa reload. |
| `register(manifest, factory)` | dipanggil kode plugin; validasi; bila id tidak ada di `index.json` atau tidak ON → factory tidak dipanggil (kode asing tidak dieksekusi) |
| `contributions(slotName)` | `[{pluginId, id, order, component}]` dari plugin ON yang sudah dimuat, urut `order` lalu `pluginId` |
| `load(id)` | §4.2 langkah 4–5; idempoten |
| `markFailed(id, err)` | §8 |

Kunci `_meta`: `plugins:state:v1`, `plugins:index:v1`, `plugins:failed:v1` (hanya sesi; dihapus saat `init()`), dan ruang plugin `plugin:<id>:<key>` (lihat `TF.api.storage`).

### 4.5 Slot

```js
<TF.Slot name="dashboard.widgets" context={{ user, tasks, habits, onTaskClick, showToast }} />
```

- Host meletakkan `<TF.Slot>` di `Dashboard` **di bawah kartu bawaan yang ada** (setelah grid GTD, sebelum footer), sebagai satu wadah `div.dash-plugins` dengan grid 1 kolom di HP dan 2 kolom ≥ 1024 px (ikut pola `dash-grid-2`).
- `Slot` memanggil `TF.plugins.contributions(name)`; bila kosong, tidak merender wadah (tidak ada ruang kosong).
- Tiap kontribusi dirender `<PluginBoundary pluginId>` → `<component context api/>`. `context` adalah **salinan baca-saja** yang disediakan host; isinya didokumentasikan per slot di README. Untuk `dashboard.widgets` Fase 0a: `{ user: {id, username}, now: Date, onTaskClick(task), showToast(message, type) }`. `tasks`/`habits` tidak dilewatkan lewat context; plugin membacanya dari `api.data` (sumber IndexedDB) supaya tidak bergantung pada bentuk state `App`.
- Slot mendengar `plugins.changed` untuk merender ulang.
- Slot yang dikenal runtime Fase 0a: hanya `dashboard.widgets`. Menambah slot = satu entri di `KNOWN_SLOTS` + satu `<TF.Slot>` di host + satu paragraf README.

### 4.6 Event bus (`TF.events`)

API: `on(name, fn) → off`, `once`, `off`, `emit(name, payload)`. Pola nama: `domain.peristiwa`. Host memancarkan:

| Event | Titik emit di host | Payload |
|---|---|---|
| `task.completed` | `handleDone` di `App` (±44544) setelah sukses lokal | `{taskId, cid, listId, projectId, completedAt}` |
| `habit.checked` / `habit.unchecked` | setelah `POST /api/habits/{id}/checkin` (±23024) / uncheck sukses lokal | `{habitId, cid, date}` |
| `pomodoro.ended` | 3 titik `api.post(".../pomodoros")` (±11448, 11543, 11592) | `{taskId, kind: "session"∣"overtime", pomodoros, focusSeconds, endedAt}` |
| `app.online` / `app.offline` | listener `online`/`offline` di runtime | `{}` |
| `app.dayChanged` | runtime: interval 60 s membandingkan tanggal Asia/Jakarta | `{date}` |
| `sync.done` | jembatan dari `window` event `tf:initial-sync` dan `tf:sync-state` (state idle) | `{initial: bool}` |
| `plugins.changed` | runtime | `{id, enabled}` |

Aturan: pendengar dipanggil sinkron dalam `try/catch` masing-masing; error pendengar → `markFailed(id)` (§8), tidak menghentikan pendengar lain; payload di-`Object.freeze`; plugin hanya boleh memancarkan nama berawalan `<id>.` (runtime menolak selain itu); `api.events` untuk plugin otomatis melepas semua pendengar saat plugin OFF/gagal. Event `tf:*` di `window` **tidak** diekspos ke plugin (internal host).

### 4.7 Fasad `TF.api` v1

`TF.api.apiVersion === 1`. `TF.api.for(id)` mengembalikan objek per plugin (closure membawa `id`):

| Bagian | Fungsi (Fase 0a) | Sumber di host |
|---|---|---|
| `events` | `on/once/off/emit` (emit hanya `<id>.*`) | §4.6 |
| `storage` | `get(key)`, `set(key, val)`, `remove(key)`, `keys()` — KV per plugin di `_meta` dengan kunci `plugin:<id>:<key>`; nilai JSON-serializable ≤ 64 KB | `TF.meta.metaGet/metaSet` |
| `data.tasks` | `list({includeDone, since})` → task dari IndexedDB dengan `id = server_id ?? cid` (bentuk sama seperti `GET /api/tasks` lokal) | `TF.taskquery` lewat `TF.taskroutes` (rute lokal `GET /api/tasks`) |
| `data.habits` | `list()`, `logs({from, to})` | `TF.habitquery.getHabits`, `liveLogs` |
| `ui` | `toast(message, type)`, `openTask(taskId)`, `navigate(page)` (hanya halaman inti: `dashboard`, `focus`, `inbox`, `settings`) | `showToast`, `setSelectedTask`, `onNav` yang disuntik `App` ke runtime lewat `TF.plugins.bindHost({...})` saat mount |
| `env` | `online` (getter), `platform` (`"web"∣"tauri"`), `theme` (getter `{palette, mode}` dari `TF.themes`), `today()` (tanggal Asia/Jakarta `YYYY-MM-DD`), `userId` | `navigator.onLine`, `window.__TAURI__`, `TF.themes`, `localStorage["tf_user_id"]` |
| `log` | `info/warn/error` dengan prefiks `[plugin:<id>]` | `console` |

Tidak ada di v1: `fetch` (0b), `records` (1), `settings.project` (1), `secrets`, `notifications`. Menambah fungsi ke v1 boleh; mengubah/menghapus = `apiVersion: 2` dan runtime tetap menyediakan v1 untuk plugin `minApi: 1`.

### 4.8 Kartu Pengaturan › Plugin (`PluginSettingsCard`)

- Diletakkan di `SettingsPage` setelah `ThemeSettingsCard`.
- Isi: daftar dari `TF.plugins.list()`; tiap baris: nama, deskripsi, badge "Bawaan", versi kecil, daftar izin dalam bahasa manusia (Fase 0a: "Menyimpan pengaturan di perangkat ini" untuk `storage`; kosong → "Tidak butuh izin"), toggle (`role="switch"`, teks "Aktif"/"Nonaktif"), status "Dimuat"/"Belum dimuat"/"Error — Aktifkan lagi".
- Teks UI persis: judul kartu `"Plugin"`, subjudul `"Fitur opsional. Status disimpan di perangkat ini."`, toast ON `"Plugin {nama} diaktifkan"`, toast OFF `"Plugin {nama} dinonaktifkan"`, toast gagal `"Plugin {nama} dimatikan karena error"`, tombol `"Aktifkan lagi"`, baris kosong `"Belum ada plugin"`.
- Tidak ada tombol "Pasang plugin" (K-ditunda).

## 5. Plugin #0: Heatmap Habit

- **Manifest:** `id: "habit-heatmap"`, `slots: ["dashboard.widgets"]`, `permissions: ["storage"]`, `defaultEnabled: false`.
- **Tampilan:** kartu `dash-card` berjudul "Heatmap" dengan segmen `Habit | Task selesai | Keduanya` (pilihan tersimpan di `api.storage` kunci `metric`), grid 53 kolom × 7 baris (365 hari berakhir hari ini) di layar lebar; di HP 26 kolom (182 hari) dengan scroll horizontal; kotak 11 px, jarak 2 px, radius 2 px; label bulan di atas, label Sen/Rab/Jum di kiri; tooltip `title="Sel 14 Okt · 3 habit · 2 task"`; ringkasan di bawah: "Streak 12 hari · 87 hari aktif dari 365".
- **Warna:** 5 tingkat dari `color-mix(in srgb, var(--accent) X%, var(--bg-card))` X = 0/25/50/75/100 (ikut palet dan mode); kotak hari ini diberi `outline: 1px solid var(--accent)`. Tidak ada warna hex tetap.
- **Data:** `api.data.habits.logs({from, to})` (hanya `checked`, tanpa `deleted`) dan `api.data.tasks.list({includeDone: true})` dengan `completed_at` dalam rentang, dikonversi ke tanggal Asia/Jakarta. Dihitung di modul murni `heatmaplogic.js` (di dalam `plugin.jsx`, diekspor untuk tes): `bucketByDate(logs, tasks, from, to)`, `levels(counts)` (kuantil, maksimum ≥ 1), `streak(counts, today)`.
- **Pembaruan:** hitung saat mount, lalu pada `habit.checked/unchecked`, `task.completed`, `sync.done`, `app.dayChanged` (debounce 300 ms).
- **Offline:** 100% IndexedDB.
- **Tanpa:** Chart.js, jaringan, `localStorage`, penulisan data host.

## 6. Build (`compile.js`)

1. Perilaku lama untuk `index.html` tetap (guard "already compiled").
2. Baru: untuk setiap `static/plugins/<id>/plugin.jsx` (lewati `_template`): Babel `preset-react` classic → `plugin.js`; header komentar `// generated from plugin.jsx — jangan edit`; gagal kompilasi satu plugin → proses keluar dengan kode 1 (tidak diam-diam melewati).
3. Tulis `static/plugins/index.json`: `{ "v": 1, "plugins": [{ "id", "name", "description", "version", "permissions", "defaultEnabled", "files": ["plugin.js", "style.css"], "hash": "<sha1 8 hex gabungan isi files>" }] }`. Field manifest dibaca dengan regex ringan dari blok `register({...})` **atau** dari `manifest.json` opsional di folder plugin (lebih aman; direkomendasikan di template).
4. `package.json` script `compile` tetap; tambah `compile:plugins` untuk menjalankan bagian plugin saja saat pengembangan.
5. Tes build: `tests/build-plugins.test.js` memverifikasi `index.json` konsisten dengan folder dan `hash` berubah bila isi berubah.

## 7. Service Worker dan Tauri

- `STATIC` += `/static/plugin-runtime.js`, `/static/plugins/index.json`, `/static/plugins/habit-heatmap/plugin.js?v=<hash>`, `/static/plugins/habit-heatmap/style.css?v=<hash>`. Query `?v=` harus persis sama dengan yang disuntik loader (loader mengambil `hash` dari `index.json`), aturan yang sama seperti `app.css?v=`.
- `CACHE` bump: `taskflow-v487-plugin-fase0a` (nama final saat rilis).
- Tauri: tidak ada perubahan; `build-tauri-dist.js` menyalin `static/` utuh. CI harus menjalankan `npm run compile` sebelum `node scripts/build-tauri-dist.js` (periksa workflow). CSP `script-src 'self'` mengizinkan `<script src="/static/plugins/...">`.
- Fase 0c mengganti bump monolitik dengan revisi per file; Fase 0a sengaja tidak.

## 8. Kegagalan plugin

| Situasi | Perilaku |
|---|---|
| `plugin.js` gagal diunduh / `register` tidak terpanggil dalam 10 s | `markFailed(id, "load")`; slot kosong untuk plugin itu; toast sekali per sesi; status tetap ON (bisa karena cache lama), dicoba lagi di sesi berikutnya |
| Manifest tidak valid / `minApi` terlalu tinggi / slot atau izin tidak dikenal | `markFailed(id, "manifest")`; **otomatis OFF** (tidak akan berhasil di sesi berikutnya juga); toast dengan alasan singkat |
| Error di `factory` atau render (ditangkap `PluginBoundary`) | hitung per plugin per sesi; ke-1 → render kosong + toast; ke-2 → otomatis OFF + toast "dimatikan karena error" |
| Error di pendengar event | sama seperti render |
| Plugin memanggil API di luar izin | `TF.api` melempar `PluginPermissionError`; dihitung sebagai error |

Detail error terakhir per plugin disimpan di memori (`plugins:failed:v1`) dan bisa disalin dari kartu Pengaturan (tombol "Salin detail"), meniru `tf_last_crash`.

## 9. Keamanan Fase 0a

- Hanya plugin yang id-nya ada di `index.json` (dibangun dari repo) yang bisa mendaftar; `register` dari skrip lain diabaikan dengan `warn`. Fase 0a tidak memuat kode dari URL luar.
- `context` dan payload event adalah salinan beku; plugin tidak mendapat `setState` host.
- `api.storage` dibatasi ke prefiks `plugin:<id>:`; plugin tidak bisa membaca kunci plugin lain maupun `_meta` host.
- Tidak ada `innerHTML` di runtime; plugin yang memakainya harus lewat `TF.safehtml` (diekspos sebagai `api.ui.sanitize` di v1).

## 10. Offline dan sinkron

- Fase 0a tidak menambah op outbox dan tidak mengubah `syncpush`/`syncpull`.
- Status plugin per perangkat; saat Fase 0b tiba: status pengguna = OR(status perangkat, status server) pada sinkron pertama, lalu server menjadi sumber kebenaran dan `_meta` menjadi cache.
- Sinkron awal (`tf:initial-sync`) → `sync.done {initial:true}` → heatmap menghitung ulang.

## 11. Pengujian

### 11.1 `node --test` (baru)

| File | Yang diuji |
|---|---|
| `tests/offline/plugin_registry.test.js` | validasi manifest (id, semver, minApi, slot/izin tidak dikenal), `register` dari id tak terdaftar diabaikan, `contributions` urut `order` lalu `pluginId`, `setEnabled` menulis `_meta` dan memancarkan `plugins.changed`, OFF melepas pendengar dan memanggil `onDisable` |
| `tests/offline/plugin_events.test.js` | `on/off/once`, payload beku, error satu pendengar tidak menghentikan yang lain dan memanggil `markFailed`, plugin hanya boleh emit `<id>.*` |
| `tests/offline/plugin_loader.test.js` | penyuntikan `<script>` dengan `?v=<hash>` (DOM palsu minimal), idempoten, timeout 10 s → `markFailed("load")`, manifest invalid → otomatis OFF |
| `tests/offline/plugin_storage.test.js` | prefiks kunci, batas 64 KB, isolasi antar plugin |
| `tests/offline/plugin_failure.test.js` | 2 error → OFF; `plugins:failed:v1` berisi detail; `init()` membersihkannya |
| `tests/offline/habit_heatmap_logic.test.js` | `bucketByDate` (zona Asia/Jakarta, batas tengah malam, `deleted`), `levels` (semua nol, satu nilai, kuantil), `streak` (hari ini belum dicentang tidak memutus streak, mengikuti aturan hero) |
| `tests/build-plugins.test.js` | `index.json` konsisten; `_template` dilewati; hash berubah bila isi berubah |
| `tests/offline/sw_precache.test.js` (yang ada) | tambah asersi: setiap file di `index.json` ada di `STATIC` dengan `?v=<hash>` yang sama |

### 11.2 Statis

- `check_inline_scripts` tetap lolos (tidak ada skrip inline baru di `index.html`).
- Lint sederhana di `compile.js`: `plugin.js` tidak boleh mengandung `tokenStore`, `API_BASE`, `fetch(`, `localStorage` → gagal build dengan pesan. (Pagar murah; bukan sandbox.)

### 11.3 E2E manual (Chrome desktop + PWA HP)

1. Buka Pengaturan › Plugin: ada "Heatmap Habit", Nonaktif, "Belum dimuat".
2. Dashboard tanpa plugin: tidak ada wadah kosong; DevTools Network: `plugin.js` tidak diminta.
3. Aktifkan → toast; kembali ke Dashboard: kartu Heatmap muncul tanpa reload; Network: `plugin.js` diminta sekali.
4. Centang habit → kotak hari ini naik satu tingkat tanpa reload.
5. Mode pesawat → reload → kartu tetap ada (precache), toggle OFF/ON tetap bekerja.
6. Ganti palet Sakura + gelap → warna heatmap ikut.
7. Simulasi error (DevTools: `TF.plugins._debugThrow("habit-heatmap")`) dua kali → plugin OFF + toast; Pengaturan menampilkan "Aktifkan lagi".
8. Tauri Desktop (bila build tersedia): langkah 1–5 sama; tidak ada permintaan ke domain lama/baru untuk file plugin.

## 12. Rilis

- Branch `claude/plugin-fase0a`, satu PR (fondasi + plugin #0 + dokumen + tes). Bila diminta dipisah: PR A runtime + slot + kartu Pengaturan (dengan plugin #0 di-stub), PR B plugin #0.
- `sw.js` bump; `app.css` tidak berubah; `themes.css` tidak berubah.
- `static/whatsnew.json`: entri `"Plugin: fitur opsional yang bisa dinyalakan"` dengan `new: ["Pengaturan › Plugin", "Plugin pertama: Heatmap Habit di Dashboard"]`.
- Deploy: `git pull`, `npm run compile`, restart `taskflow-web` saja (bot tidak berubah). Urutan di CI Tauri: `npm run compile` → `build-tauri-dist`.
- Rollback: matikan plugin di Pengaturan (tanpa deploy) atau revert PR; tidak ada migrasi data.

## 13. Risiko dan mitigasi

| Risiko | Mitigasi |
|---|---|
| `plugin-runtime.js` dimuat sebelum modul offline yang dibutuhkannya (`meta.js`, `habitquery.js`) | urutan `<script>` di `index.html` dan `STATIC`; runtime me-resolve `TF.*` secara malas saat dipanggil (pola `projectcache.js`), bukan saat file dieksekusi |
| Cache SW lama memuat `index.html` baru tanpa `plugin-runtime.js` | semua masuk `STATIC` dalam satu versi cache; `appupdate.js` menangani reload seperti biasa |
| Plugin memakai global `index.html` lewat `window.X` | lint build (§11.2) + README; sandbox sesungguhnya ditunda sampai ada plugin pihak ketiga |
| Dashboard melompat saat plugin dimuat | wadah slot hanya dirender bila ada kontribusi; plugin wajib `min-height` kartu sejak render pertama |
| HP menengah: heatmap 365 kotak = 365 elemen DOM | render sebagai satu `<svg>` dengan `<rect>` (lebih ringan dari div) dan 182 hari di HP |
| `_meta` dihapus oleh `clearAll()` (logout) | status plugin kembali ke `defaultEnabled`; dapat diterima di Fase 0a, Fase 0b memulihkan dari server |

## 14. Di luar cakupan Fase 0a

Server dan SQLite; `plugin_records`/`plugin_kv`/bump IndexedDB; `TF.api.fetch`; slot selain `dashboard.widgets`; setting per workspace/project; sinkron status antar perangkat; precache revisi per file; "Hapus data plugin"; pemasangan plugin dari luar repo; Heatmap 🍅; lazy-load Milkdown (PR performa terpisah, bukan bagian sistem plugin).

## 15. Pertanyaan terbuka

1. ~~A1–A4~~ dan ~~istilah UI~~ — diputuskan 2026-10-31 (§2).
2. Apakah plugin #0 sebaiknya `defaultEnabled: true` untuk semua pengguna lama sebagai demonstrasi? Spec memilih `false` agar Dashboard tidak berubah tanpa diminta.

---

## Lampiran A — Guard rails (aturan dari lensa "apa yang rusak duluan")

Aturan wajib untuk semua fase. Pelanggaran = PR ditolak. Nomor mengacu ke urutan bottleneck analisis 2026-10-29.

1. **Event loop server.** Endpoint plugin ditulis `def` (threadpool), bukan `async def` yang memanggil `sqlite3`. I/O jaringan keluar hanya di worker (`plugin_jobs`), tidak pernah di dalam request maupun di dalam transaksi DB. Pengecualian: verifikasi singkat (mis. "Uji koneksi CalDAV") boleh `async def` dengan `httpx.AsyncClient` + timeout ≤ 10 s. Threadpool AnyIO terbatas (default 40); jangan melempar jaringan lambat ke `def`.
2. **Delta sejak hari pertama.** Setiap endpoint baca data plugin yang disinkron memakai kursor keyset `(updated_at, id)` + `limit` + tombstone `deleted` + TTL kursor 30 hari (tiru `note_comments.make_cursor/parse_cursor/cursor_expired/purge_old_tombstones`), bukan `since=<timestamp>` saja dan bukan tarik penuh.
3. **Shell frontend dibekukan.** Fitur yang bisa menjadi plugin tidak masuk `index.html`. Kode plugin dieksekusi saat slot dirender, bukan saat start. Vendor baru > 100 KB wajib lazy.
4. **Precache, bukan runtime cache.** Semua file plugin bawaan ada di precache SW dengan query versi yang persis sama dengan yang disuntik loader. (Fase 0c: revisi per file.)
5. **IndexedDB tanpa `getAll` mentah untuk plugin.** `plugin_sync.js` hanya mengekspos query berindeks (`IDBKeyRange.bound` pada `[plugin_id, entity]` / `[plugin_id, entity, updated_at]`) dengan `limit`/kursor. Bump versi skema hanya lewat spec, maksimal sekali per fase besar.
6. **SQLite.** Satu `get_conn()` (`busy_timeout=5000`, `isolation_level="IMMEDIATE"`, WAL, `foreign_keys=ON`); plugin tidak memanggil `sqlite3.connect`; hook server menerima `conn` yang sedang aktif. Tabel plugin berawalan `plg_<id>_`, dibuat idempoten di `ensure_schema(conn)` dengan pola `PRAGMA table_info`. Indeks JSON/generated column hanya bila ada konsumen sisi server (bot, worker).
7. **Otorisasi deklaratif.** `include_router(..., dependencies=[Depends(require_plugin_enabled(id)), Depends(current_user)])`; akses objek lewat `Depends(get_authorized_task)` / `get_authorized_list`; tidak ada pemeriksaan hak yang ditulis manual di badan endpoint plugin.
8. **Rahasia.** Kredensial pihak ketiga hanya di `plugin_secrets` (MultiFernet, kunci di `.env`, dekripsi terikat `plugin_id`); tidak pernah di kolom teks, `localStorage`, atau log.
9. **Jaringan di klien.** Plugin offline by default; `network` adalah izin eksplisit; setiap aksi online-only menampilkan "Butuh koneksi internet" dan tidak merusak alur offline.
10. **Fasad saja.** Plugin memakai `TF.api` dan `React`; dilarang `api`, `tokenStore`, `API_BASE`, `fetch`, `localStorage`, `window.TF.<modul host>`, state `App`. Lint build menegakkan sebagian; review menegakkan sisanya.
11. **Gagal aman.** Setiap render/pendengar/hook plugin dibungkus; 2 error → OFF otomatis; host tidak pernah layar putih karena plugin.
12. **Tanpa pengecualian bernama.** Host tidak boleh berisi `if (pluginId === "...")`; kebutuhan baru = slot/event/izin baru yang terdokumentasi.
13. **Ukuran.** `index.html` tidak bertambah > 60 baris per fase plugin; `plugin-runtime.js` tidak memakai JSX; satu plugin satu folder.

## Lampiran B — Keputusan yang sulit dibalik (lensa "apa yang harus benar sejak awal")

Dikunci sekarang walau implementasinya di fase berikutnya, karena mengubahnya belakangan berarti migrasi data atau memutus plugin yang sudah ada.

| # | Keputusan | Berlaku sejak | Mengapa sulit dibalik |
|---|---|---|---|
| B1 | **Format manifest** (§4.3) dan nama izin yang dicadangkan. Field baru boleh ditambah; field yang ada tidak diganti artinya. | 0a | Semua plugin bergantung padanya. |
| B2 | **`TF.api` ber-versi**: `apiVersion` integer, plugin menyatakan `minApi`, fungsi hanya ditambah di versi yang sama; perubahan tak kompatibel = versi baru dengan v lama tetap tersedia ≥ 2 rilis mayor Alurik. | 0a | Memutus plugin lama = memutus pengguna. |
| B3 | **Penamaan event** `domain.peristiwa` untuk host dan `<id>.peristiwa` untuk plugin; payload beku; pendengar tidak membatalkan aksi. Hook yang bisa menjeda/membatalkan adalah API terpisah (`TF.hooks`, Fase Ramadan) dengan kontrak sendiri. | 0a | Plugin antar-plugin berkomunikasi lewat ini. |
| B4 | **Siklus hidup** `register → enable → load → disable`, ditambah `migrate(from, to)` untuk data plugin mulai Fase 1; OFF tidak menghapus data. | 0a | Menentukan harapan pengguna tentang data. |
| B5 | **IndexedDB v7 (Fase 1) hanya menambah dua store generik**: `plugin_records` keyPath `[plugin_id, entity, id]`, indeks `[plugin_id, entity]`, `[plugin_id, entity, updated_at]`, `[plugin_id, entity, dirty]`; `plugin_kv` keyPath `[plugin_id, scope, key]`. Tidak ada store per plugin, selamanya. | 1 | Store baru = bump versi + `onupgradeneeded` + risiko tab terblokir. |
| B6 | **Record plugin** bentuknya tetap: `{plugin_id, entity, id (uuid klien), server_id?, scope: "user"∣"list:<id>"∣"project:<id>", data (JSON ≤ 64 KB), updated_at (ISO dengan offset), deleted (bool), version (int, naik tiap tulis), dirty}`. Konflik: strategi per entitas dideklarasikan plugin: `lww` (default, berdasar `updated_at` lalu `version`), `merge(fn)`, atau `manual` (masuk `syncconflict`). | 1 | Dua sisi (klien + server) dan semua plugin bergantung pada bentuk ini. |
| B7 | **Server `plugin_records`** sebagai transport sync generik: tabel `(plugin_id, entity, id, user_id, scope, data, updated_at, deleted, version)`, indeks `(user_id, plugin_id, entity, updated_at, id)`; endpoint `GET /api/plugins/{id}/records?entity=&cursor=&limit=` (keyset) dan `POST /api/plugins/{id}/records` (batch upsert idempoten memakai `id`+`version`). Tabel relasional `plg_<id>_*` hanya sebagai proyeksi untuk kebutuhan query server, bukan sumber sync. | 1 | Mencegah setiap plugin membuat jalur sync sendiri. |
| B8 | **`tasks.ext`** kolom JSON di `tasks` (server) dan field `ext` di record task klien, kunci bernamespace `<pluginId>.<field>`; ikut jalur `PUT /api/tasks`, outbox task, dan delta pull task. Plugin tidak menulis kolom task lain. | 1 | Mengubah tempat field task plugin berarti migrasi semua task. |
| B9 | **Outbox op plugin** `entity_type: "plugin"`, `op: "upsert"∣"delete"`, `cid: "<plugin_id>/<entity>/<id>"`, payload record penuh; coalescing per `cid` sebelum push. Satu cabang generik di `syncpush`/`syncpull`. | 1 | Format outbox tersimpan di perangkat pengguna yang sedang offline. |
| B10 | **Status plugin per pengguna** di server (`plugin_states(user_id, plugin_id, enabled, settings, updated_at)`), `_meta` sebagai cache; aturan lebur = OR pada sinkron pertama. Status per workspace (dinyalakan pemilik untuk anggota) diputuskan di spec Fase 1; bila ada, disimpan di `plugin_states` dengan `scope`. | 0b | Mengubah arti "aktif" belakangan membingungkan pengguna lintas perangkat. |
| B11 | **Modul server plugin** `plugins/<id>.py` dengan simbol opsional `ensure_schema(conn)`, `router: APIRouter`, `on_task_written(conn, user_id, task)`, `jobs: [(name, interval_s, fn)]`, `register_bot(application)`, `intake(conn, source, message)`; dimuat oleh `webapp.py` **dan** `bot.py` lewat `plugin_loader.py` bersama. | 0b | Dua proses (web + bot) harus sepakat tentang skema dan hook. |
| B12 | **Penjadwal** = tabel `plugin_jobs(plugin_id, name, locked_until, last_run_at, next_run_at, backoff_count, last_error)` + satu worker thread (pola `EmailWorker`), tanpa APScheduler. Idempoten terhadap restart dan aman bila kelak multi-proses. | ditunda | Pekerjaan periodik yang sudah berjalan sulit dipindahkan antar mekanisme. |
| B13 | **Rahasia** di `plugin_secrets(plugin_id, user_id, key, ciphertext, updated_at)` dengan `MultiFernet` (rotasi kunci lewat `.env` `PLUGIN_SECRET_KEYS`); dekripsi hanya lewat `secrets.get(plugin_id, user_id, key)` yang diikat ke plugin pemanggil. | ditunda | Mengubah skema enkripsi = re-enkripsi massal. |
| B14 | **Blok note plugin** direpresentasikan markdown-native (fenced block ```` ```<pluginId> ````) sehingga saat plugin OFF note tetap terbaca sebagai code block; registry `TF.registry.noteBlocks`/`slashItems` dibaca `milkdown-build` saat init. | ditunda | Isi note pengguna harus tetap valid markdown selamanya. |
| B15 | **Kepercayaan**: semua plugin bawaan berjalan di bundle yang sama tanpa sandbox; izin di manifest sudah jujur sejak 0a sehingga sandbox (iframe/worker) dan prompt izin untuk plugin pihak ketiga bisa ditambahkan tanpa mengubah kontrak plugin bawaan. | 0a | Menambahkan model izin belakangan ke plugin yang sudah ada = audit ulang semua. |
| B16 | **Identitas plugin** = `id` folder; tidak pernah diganti; rename = plugin baru + `migrate` data. Versi semver; `version` naik tiap perubahan data/manifest. | 0a | `id` tertanam di kunci `_meta`, `plugin_records`, `tasks.ext`, outbox. |
