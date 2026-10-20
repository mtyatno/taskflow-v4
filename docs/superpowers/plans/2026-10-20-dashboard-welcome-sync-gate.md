# Dashboard Welcome Sync Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Welcome card dashboard hanya tampil bila akun benar-benar kosong; selama sync pertama, saat offline di perangkat baru, atau saat sync gagal, dashboard menampilkan kartu status yang jujur.

**Architecture:** Modul offline murni baru `static/offline/introgate.js` (keputusan tampilan + baca/tulis penanda `_meta initial_sync:v1` + `hasLocalData`). `sync()` di `index.html` menulis penanda bila pull task & pull note sukses dan memancarkan status sync. `Dashboard` memakai hook `useIntroState` untuk memilih welcome / kartu status / dashboard. Frontend saja, tanpa backend.

**Tech Stack:** React tanpa JSX di `static/index.html` (gaya `React.createElement` seperti kode sekitarnya), modul UMD di `static/offline/`, IndexedDB (`TF.db`, `TF.meta`), tes `node --test` + `fake-indexeddb`, pytest, E2E Playwright Python.

**Spec:** `docs/superpowers/specs/2026-10-20-dashboard-welcome-sync-gate-design.md`

## Global Constraints

- "Punya data" = record `tasks` dengan `!deleted` ATAU record `notes` dengan `!deleted`. Mindmap/drawing/habit tidak dihitung. Task `done`/`archived` dihitung.
- Penanda: kunci `_meta` **`initial_sync:v1`**, nilai `{ user_id: String, at: ISO string }`; ditulis hanya bila pull task **dan** pull note sukses dalam satu putaran `sync()`.
- Event: **`tf:initial-sync`** (penanda baru ditulis), **`tf:sync-state`** (detail `{ running: boolean, lastFailed: boolean }`); state global `window.__syncState = { running, lastFailed }`.
- Hasil `decideIntro`: tepat salah satu dari `"dashboard" | "welcome" | "syncing" | "offline_empty" | "sync_error"`, urutan prioritas sesuai tabel spec §4.5.
- Teks UI (persis):
  - syncing: judul "Menyinkronkan data kamu dari server…", sub "Datamu aman di server. Sebentar lagi muncul di sini."
  - offline_empty: judul "Belum terhubung ke server", sub "Datamu akan muncul setelah perangkat ini online."
  - sync_error: judul "Gagal mengambil data dari server", sub "Datamu aman di server. Coba lagi sebentar lagi.", tombol "Coba lagi"
  - kalimat ringkasan: syncing → "Menyinkronkan datamu…"; offline_empty → "Menunggu koneksi untuk memuat datamu."; sync_error → "Datamu belum termuat."; "Selamat datang di Alurik! Mari mulai dengan mencatat tugas atau ide pertamamu." hanya untuk `welcome`.
- `tf_dismiss_onboarding` tetap dihormati: `welcome` + sudah ditutup → kartu Prioritas biasa (perilaku sekarang).
- Guard `hasTasks && …` untuk KPI / Eisenhower / GTD / Analitik tidak diubah; `hasTasks = tasks.length > 0` tetap ada (tes `dashboard_onboarding.test.js` mengunci pola itu).
- Aturan gaya repo: jangan pakai `border-left` aksen. Kartu status mendukung tema terang & gelap (variabel CSS yang sudah dipakai `.dash-onboarding-card`).
- Rilis frontend: naik SW ke nomor kosong berikutnya (sekarang `taskflow-v429-note-media` → `taskflow-v430-dashboard-intro`, cek `main` saat merge), `app.css?v=337` → `338`, ubah di `static/sw.js`, `static/index.html` (fallback `__SW_VERSION` + link CSS + teks versi di Settings), `webapp.py` `sw_cache`, `tests/test_version.py`, dan tes versi di `tests/offline/*` yang mengunci string versi lama (grep `taskflow-v429-note-media` dan `app.css?v=337`).
- Jangan ubah urutan langkah `sync()`, perilaku push, atau `stepFailed`; tes `sync_robustness.test.js` yang ada harus tetap lulus.

## Review Focus

1. **Ganti akun di perangkat yang sama** (A logout → B login): penanda milik A tidak boleh membuat B (akun lama) melihat welcome. → Task 1 tes `readInitialSync` user lain = belum.
2. **Sync putus di tengah** (pull task sukses, pull note gagal): penanda tidak ditulis; tanpa data lokal → `sync_error`, bukan welcome. → Task 2 tes.
3. **Offline lalu online** di perangkat baru: `window.addEventListener("online", sync)` hanya menjalankan `sync()`, tidak `fetchAll`, jadi state `tasks` App tetap `[]`. Setelah `tf:initial-sync`, Dashboard harus memanggil `window.__refreshTasks()` bila `tasks.length === 0`, kalau tidak dashboard penuh tidak pernah muncul. → Task 3 tes + E2E (c).
4. **Akun yang hanya punya note** atau **hanya anggota workspace** (task milik orang lain): bukan welcome. → Task 1 tes `hasLocalData` (note saja), E2E (e) dan (g).
5. **Menghapus task/note terakhir** di dashboard tanpa reload: welcome muncul lagi; juga setelah reload offline. → E2E (f).

---

### Task 1: Modul `introgate.js` (keputusan murni + penanda + data lokal)

**Files:**
- Create: `static/offline/introgate.js`
- Modify: `static/index.html` (tambah `<script src="/static/offline/introgate.js"></script>` setelah baris `workspacepins.js` ±299), `static/sw.js` (tambah ke daftar precache setelah `"/static/offline/workspacepins.js"`)
- Test: `tests/offline/introgate.test.js`

**Interfaces:**
- Consumes: `TF.db.openDB()` (`static/offline/db.js`), `TF.meta.metaGet(key)` / `metaSet(key, val)` (`static/offline/meta.js`); pola UMD + `require` di Node seperti `meta.js`.
- Produces (`window.TF.introgate` dan `module.exports`):
  - `MARKER_KEY = "initial_sync:v1"`
  - `decideIntro({ hasData, initialSyncDone, online, syncRunning, lastSyncFailed }) -> "dashboard"|"welcome"|"syncing"|"offline_empty"|"sync_error"` (murni)
  - `hasLocalData() -> Promise<boolean>`
  - `readInitialSync(userId) -> Promise<boolean>` (true hanya bila penanda ada dan `String(marker.user_id) === String(userId)`; `userId` null → false; error IDB → false)
  - `markInitialSync(userId, nowIso?) -> Promise<void>` (no-op bila `userId` null)
  - `currentUserId() -> string|null` (baca `localStorage.tf_user_id` dalam try/catch; di Node tanpa localStorage → null)

- [ ] **Step 1: Write the failing tests** di `tests/offline/introgate.test.js` (pola `sync_robustness.test.js`: `require("./setup.js")`, `_reset()` + `deleteDB(DB_NAME)` di `beforeEach`, helper `put(store, recs)`):
  - `decideIntro: hasData menang atas semua` → `decideIntro({hasData:true, initialSyncDone:false, online:false, syncRunning:true, lastSyncFailed:true}) === "dashboard"`
  - `decideIntro: penanda ada → welcome, juga offline` → `{hasData:false, initialSyncDone:true, online:false}` → `"welcome"`
  - `decideIntro: tanpa penanda + offline → offline_empty` (walau `lastSyncFailed:true`)
  - `decideIntro: online + syncRunning → syncing` (walau `lastSyncFailed:true`)
  - `decideIntro: online, tidak berjalan, gagal → sync_error`
  - `decideIntro: online, belum mulai → syncing` (`syncRunning:false, lastSyncFailed:false`)
  - `hasLocalData: kosong → false`; `hanya task deleted:true → false`; `note saja (deleted:false) → true`; `task saja → true`
  - `readInitialSync: belum ada → false`; `markInitialSync("7") lalu readInitialSync("7") → true`; `readInitialSync("8") → false` (akun lain); `readInitialSync(null) → false`
  - `markInitialSync menyimpan {user_id:"7", at}` — `metaGet("initial_sync:v1")` → `user_id === "7"` dan `at` string ISO

- [ ] **Step 2: Run to verify fail**
  Run: `node --test tests/offline/introgate.test.js`
  Expected: FAIL `Cannot find module '../../static/offline/introgate.js'`

- [ ] **Step 3: Implement `static/offline/introgate.js`** dengan antarmuka di atas. `hasLocalData` membuka transaksi readonly ke store `tasks` dan `notes`, iterasi cursor dan berhenti di record pertama `!deleted` (jangan `getAll` seluruh store). Tambahkan tag `<script>` di `index.html` dan entri precache di `sw.js`.

- [ ] **Step 4: Run to verify pass**
  Run: `node --test tests/offline/introgate.test.js` → PASS; lalu `npm test` → hanya gagal pra-ada `draw_local_reactive`.

- [ ] **Step 5: Commit**
  `git add static/offline/introgate.js tests/offline/introgate.test.js static/index.html static/sw.js && git commit -m "feat(offline): introgate — keputusan welcome dashboard + penanda sync awal"`

---

### Task 2: `sync()` menulis penanda dan memancarkan status sync

**Files:**
- Modify: `static/index.html` fungsi `sync()` (±1120–1180)
- Test: `tests/offline/introgate_sync.test.js` (harness `new Function(...)` persis seperti `sync_robustness.test.js` baris 558–578)

**Interfaces:**
- Consumes: `window.TF.introgate.markInitialSync(userId)`, `window.TF.introgate.currentUserId()` (Task 1). Akses hanya lewat `window.…` dan dijaga `window.TF.introgate &&` supaya harness tes lama (tanpa introgate) tetap lulus.
- Produces: `window.__syncState = { running, lastFailed }`; event `tf:sync-state` (detail sama) dikirim saat mulai (`running:true`) dan selesai (`running:false`, `lastFailed` = pull task ATAU pull note gagal di putaran ini); event `tf:initial-sync` (detail `{ user_id }`) setelah `markInitialSync` selesai.

- [ ] **Step 1: Write the failing tests** (`win` palsu dengan `TF.introgate = { currentUserId: () => "7", markInitialSync: (u) => { marked.push(u); return Promise.resolve(); } }`, `dispatchEvent(e)` merekam `e.type`/`e.detail`, `CustomEvent` = `function (type, init) { this.type = type; this.detail = init && init.detail; }`):
  - `sync(): pull task & note sukses → markInitialSync("7") sekali, event tf:initial-sync terkirim`
  - `sync(): pull note gagal → tidak ada markInitialSync, tidak ada tf:initial-sync, __syncState.lastFailed === true`
  - `sync(): pull task gagal → tidak ada markInitialSync, lastFailed === true`
  - `sync(): event tf:sync-state pertama running:true, terakhir running:false; __syncState.running === false setelah selesai`
  - `sync(): langkah lain (habits/mindmaps) gagal tapi task & note sukses → tetap ditandai, lastFailed === false`
  - `sync(): tanpa window.TF.introgate → tidak melempar, push tetap berjalan` (regresi harness lama)

- [ ] **Step 2: Run to verify fail**
  Run: `node --test tests/offline/introgate_sync.test.js` → FAIL (markInitialSync tidak dipanggil)

- [ ] **Step 3: Implement** di `sync()`: dua flag lokal `tasksOk`/`notesOk` di-set `true` di `.then` pull task (sebelum `.catch(stepFailed)`) dan di dalam langkah note; set `window.__syncState` + dispatch `tf:sync-state` di awal tugas eksklusif dan di akhir (setelah push, baik sukses maupun `catch`); setelah push, bila `tasksOk && notesOk` dan `currentUserId()` tidak null → `markInitialSync(uid).then(dispatch tf:initial-sync)` (error ditelan). Urutan langkah & nilai kembali `sync()` tidak berubah.

- [ ] **Step 4: Run to verify pass**
  Run: `node --test tests/offline/introgate_sync.test.js tests/offline/sync_robustness.test.js` → PASS; `npm test` → hanya pra-ada `draw_local_reactive`.

- [ ] **Step 5: Commit**
  `git commit -am "feat(sync): tandai sync awal bila pull task & note sukses, pancarkan tf:sync-state"` (sertakan file tes baru dengan `git add`)

---

### Task 3: Dashboard memakai keputusan intro + kartu status

**Files:**
- Modify: `static/index.html` — komponen `Dashboard` (±17651), slot welcome (±18430), kalimat ringkasan (±18031); komponen baru `DashSyncCard` di dekat `DashOnboardingCard` (±17573)
- Modify: `static/app.css` — kelas `.dash-sync-card` (+ anak `-title`, `-sub`, `-btn`, skeleton) setelah blok `.dash-onboarding-card` (±3861)
- Test: `tests/offline/dashboard_intro_ui.test.js` (pola sumber-teks seperti `dashboard_onboarding.test.js`)

**Interfaces:**
- Consumes: `window.TF.introgate.{decideIntro, hasLocalData, readInitialSync, currentUserId}` (Task 1); `window.__syncState`, event `tf:sync-state`, `tf:initial-sync` (Task 2); event `noteSaved` dan `online`/`offline` yang sudah ada; `window.__refreshTasks()` (sudah ada, `fetchAll`).
- Produces: hook `useIntroState(tasks) -> "dashboard"|"welcome"|"syncing"|"offline_empty"|"sync_error"`; komponen `DashSyncCard({ mode, onRetry })`.

- [ ] **Step 1: Write the failing tests** (baca `index.html` & `app.css` sebagai teks):
  - `index.html mendefinisikan useIntroState dan DashSyncCard`
  - `slot welcome memakai intro === "welcome" && !dismissedOnboarding` (regex `intro\s*===\s*"welcome"\s*&&\s*!dismissedOnboarding`) dan `DashSyncCard` untuk `syncing|offline_empty|sync_error`
  - `teks persis ada`: tiga judul, tiga sub, "Coba lagi", tiga kalimat ringkasan dari Global Constraints
  - `"Selamat datang di Alurik!" hanya di cabang intro === "welcome"` (regex: kalimat itu didahului `intro === "welcome"` dalam ekspresi `summaryLine`)
  - `useIntroState memanggil __refreshTasks saat tf:initial-sync dan tasks kosong` (regex `tf:initial-sync` dan `__refreshTasks` di dalam badan hook)
  - `useIntroState mendengarkan tf:sync-state, noteSaved, online, offline`
  - `app.css punya .dash-sync-card tanpa border-left`
  - tes lama `dashboard_onboarding.test.js` tetap lulus (tidak diedit kecuali string versi di Task 4)

- [ ] **Step 2: Run to verify fail**
  Run: `node --test tests/offline/dashboard_intro_ui.test.js` → FAIL

- [ ] **Step 3: Implement**
  - `useIntroState(tasks)`: state `localHas` (null = belum tahu), `syncDone`, `online` (`navigator.onLine`), `syncState` (dari `window.__syncState || {running:false,lastFailed:false}`). `hasData = tasks.length > 0 || localHas === true`. Bila `tasks.length === 0` → `hasLocalData()` ulang saat mount, saat `noteSaved`, saat `tf:initial-sync`, saat `tasks.length` berubah. `readInitialSync(currentUserId())` saat mount dan saat `tf:initial-sync`. Saat `tf:initial-sync` dengan `tasks.length === 0` → `window.__refreshTasks && window.__refreshTasks()`. Selama `localHas === null` dan `tasks.length === 0`, kembalikan `"syncing"` (jangan pernah sekejap `welcome`). Hasil akhir: `decideIntro(...)`. Bersihkan semua listener saat unmount. Bila `window.TF.introgate` tidak ada → kembali ke perilaku lama (`tasks.length > 0 ? "dashboard" : "welcome"`).
  - `DashSyncCard({ mode, onRetry })`: kartu di posisi welcome; `role="status"` + `aria-live="polite"`; mode `syncing` menampilkan spinner/skeleton tiga baris; `sync_error` menampilkan tombol "Coba lagi" → `onRetry` = `() => window.__refreshTasks && window.__refreshTasks()`.
  - Slot ±18430: `intro === "welcome" && !dismissedOnboarding` → `DashOnboardingCard`; `intro` ∈ {syncing, offline_empty, sync_error} → `DashSyncCard`; lainnya → kartu Prioritas seperti sekarang.
  - `summaryLine`: cabang `intro` untuk tiga mode status lebih dulu; "Selamat datang…" hanya bila `intro === "welcome"`; sisanya tidak berubah. Bila `intro === "dashboard"` tapi `tasks.length === 0` (akun hanya note) → pakai kalimat "Tidak ada yang mendesak hari ini. Saat yang pas untuk merencanakan." yang sudah ada.
  - CSS `.dash-sync-card`: ikuti token warna/radius `.dash-onboarding-card`; animasi skeleton menghormati `prefers-reduced-motion`.

- [ ] **Step 4: Run to verify pass**
  Run: `node --test tests/offline/dashboard_intro_ui.test.js tests/offline/dashboard_onboarding.test.js` → PASS; `npm test`; `python -m pytest tests/ -q` → hijau (selain pra-ada yang dicatat di CURRENT_STATE).

- [ ] **Step 5: Commit**
  `git commit -am "feat(dashboard): kartu status sync menggantikan welcome card selama sync awal"` (tambahkan file tes baru)

---

### Task 4: Rilis (versi SW) + E2E + dokumentasi handover

**Files:**
- Modify: `static/sw.js`, `static/index.html`, `webapp.py` (±4275), `tests/test_version.py`, tes node yang mengunci versi lama (grep)
- Create: `temporary_files/e2e_dashboard_intro.py` (pola `temporary_files/e2e_kanban_stages.py`: uvicorn lokal + DB sementara, Playwright Chromium, screenshot ke `temporary_files/e2e_dashboard_intro/`, keluar non-zero bila gagal)
- Modify: `.agents/CURRENT_STATE.md`, `.agents/SESSION_LOG.md`

**Interfaces:**
- Consumes: semua dari Task 1–3.
- Produces: SW `taskflow-v430-dashboard-intro`, `app.css?v=338`.

- [ ] **Step 1: Naikkan versi** di semua lokasi Global Constraints; `grep -rn "taskflow-v429-note-media\|app.css?v=337" static tests webapp.py` → tidak ada sisa.
- [ ] **Step 2: Tulis E2E** dengan skenario (akun lama = 3 task + 2 note di server; route `/api/tasks*` dan `/api/scratchpad*` bisa ditahan/diganti lewat `page.route`):
  - (a) akun lama, perangkat baru, pull task ditahan 3 dtk → teks "Menyinkronkan data kamu dari server…" terlihat, "Selamat datang di Alurik" **tidak pernah** muncul (cek tiap 100 ms); dilepas → kartu Prioritas + KPI tampil.
  - (b) akun baru (kosong) → welcome card ("Mulai Langkah Pertama") tampil setelah sync.
  - (c) akun lama, context offline sejak sebelum login berhasil memuat app (token sudah ada, IndexedDB kosong) → "Belum terhubung ke server"; set online → dashboard penuh tanpa reload (Review Focus 3).
  - (d) `/api/scratchpad` 500 → "Gagal mengambil data dari server" + "Coba lagi"; hapus route → klik "Coba lagi" → dashboard penuh.
  - (e) akun hanya punya note → bukan welcome, bukan kartu status.
  - (f) akun dengan 1 task + 1 note: hapus keduanya → welcome muncul tanpa reload; reload dalam mode offline → welcome tetap.
  - (g) akun B anggota workspace milik A, B tanpa item pribadi, workspace berisi 1 task → bukan welcome.
  - (h) logout akun lama → login akun baru di tab yang sama → welcome (bukan dashboard, bukan kartu status macet).
  - Screenshot (a), (c), (d) terang + gelap.
- [ ] **Step 3: Jalankan verifikasi penuh**
  Run: `python3 temporary_files/e2e_dashboard_intro.py` → semua langkah lulus; `npm test` → hanya pra-ada `draw_local_reactive`; `python -m pytest tests/ -q` → hijau.
- [ ] **Step 4: Handover** — perbarui entri CURRENT_STATE (status "DRAFT PR, TUNGGU MERGE DAN DEPLOY", SW v430, verifikasi, sisa diketahui) dan tambahkan SESSION_LOG.
- [ ] **Step 5: Commit + push**
  `git add -A static tests webapp.py temporary_files/e2e_dashboard_intro.py .agents && git commit -m "chore(release): SW v430 dashboard intro + E2E" && git push`
