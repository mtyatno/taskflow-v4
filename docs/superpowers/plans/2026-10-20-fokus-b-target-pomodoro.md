# Fokus Hari Ini — PR B: Target 🍅 (estimasi vs realisasi) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Setiap task punya estimasi 🍅 (1–20) yang diubah dengan klik ikon tomat. Realisasi 🍅 tercatat di server lewat log append-only yang idempoten, tidak hilang saat reload, dan sama di semua perangkat. Bar Task Aktif, chip kartu task, dan header halaman Fokus menampilkan realisasi / estimasi.

**Architecture:** Server menambah kolom `tasks.estimated_pomodoros` + `tasks.pomodoros_done` dan tabel `pomodoro_log`, dengan endpoint `POST /api/tasks/{id}/pomodoros` yang idempoten lewat `client_id`. Klien mencatat 🍅 lewat route lokal yang mengantre op outbox payload-only `pomodoro_log/create` (modul baru `pomolog.js`); nilai realisasi lokal = nilai server terakhir + op yang belum terkirim. Perhitungan murni (ringkasan header, jam, aturan klik estimasi, `client_id`) ada di modul baru `pomologic.js`. `taskPomodoros` (state React yang hilang saat reload) dihapus.

**Tech Stack:** FastAPI + SQLite (`webapp.py`, `repository.py`), pytest; modul UMD `static/offline/*.js` + IndexedDB (`fake-indexeddb` di tes), `node --test`; React tanpa JSX di `static/index.html`; Playwright Python untuk E2E lokal.

**Spec:** `docs/superpowers/specs/2026-10-20-fokus-hari-ini-enhancement-design.md` (§4, §5, §7.2, D2–D6, D14, D15; PR B di §10). Overtime (§6.2 baris overtime, `pomodorosToday`) adalah PR C — jangan dibuat di sini.

## Global Constraints

- Skema persis seperti spec §4.1 (kolom `estimated_pomodoros INTEGER NOT NULL DEFAULT 1`, `pomodoros_done INTEGER NOT NULL DEFAULT 0`; tabel `pomodoro_log` dengan `UNIQUE (user_id, client_id)`, `task_id … ON DELETE SET NULL`, indeks `idx_pomodoro_log_task` dan `idx_pomodoro_log_user_date`). Migrasi idempoten di `TaskRepository` (dipakai `migrate_db()`, bot, tes).
- `pomodoros_done` hanya diubah endpoint log, **tidak pernah** menyentuh `tasks.updated_at`, tidak bisa di-PUT.
- Validasi log: `client_id` 1–64; `kind="session"` → `pomodoros == 1`, `focus_seconds` 1–1500; `kind="overtime"` → `pomodoros` 0–4, `focus_seconds` 60–7200, `pomodoros == focus_seconds // 1500`; `log_date` `YYYY-MM-DD`; `ended_at` ISO yang bisa di-parse → else 422. Akses = hak baca task (`_can_access_task(conn, task_id, uid)`), status task tidak diperiksa. Respons 200 `{id, task_id, pomodoros_done, duplicate}`.
- Estimasi 1–20, default 1. Aturan klik: ikon 1–4 menyetel nilai itu; ikon "5+" menyetel 5, atau +1 bila nilai sudah ≥ 5, berhenti di 20.
- `client_id` sesi utama: `pomo-<user_id>-<workStartedAt>-s` (`user_id` dari `localStorage["tf_user_id"]`).
- Header: `N tugas • X / Y 🍅 hari ini (~Z jam)`; X = `sessionCount` (sampai PR C); Y = Σ estimasi task di "Task hari ini"; Z = Y × 25 menit dalam jam, dibulatkan ke 0,5 terdekat (tengah → ke atas), titik desimal, tanpa ".0" (32 → `~13.5 jam`, 24 → `~10 jam`, 3 → `~1.5 jam`); daftar kosong → `0 tugas • X 🍅 hari ini`. 🍅 dirender sebagai glyph `pomoTomato` (`ViewGlyph`), bukan emoji.
- Oranye bila realisasi > estimasi: `#fb923c` di kartu gelap, `var(--p2)` di chip daftar. Timer tidak pernah diblokir.
- Tanggal "hari ini" Pomodoro = tanggal lokal (`TF.tasklogic.todayLocalISO()`), bukan `toISOString().slice(0,10)`.
- React.createElement tanpa JSX; setiap akses `localStorage` dalam try/catch.
- Rilis: SW + `app.css?v=` ke nomor kosong berikutnya di atas `main` (sekarang v434 / 342 → **v435 `taskflow-v435-focus-target`, `?v=343`**), di `static/sw.js` `CACHE`, `static/index.html` (`__SW_VERSION` + fallback Settings + link css), `webapp.py` `sw_cache`, dan tes yang mengunci versi. Modul JS baru masuk `STATIC` di `sw.js` dan tag `<script>` di index.html.
- Deploy: ada migrasi → restart `taskflow-web` **dan** `taskflow`.

## Review Focus

1. **Dua tab menyelesaikan sesi yang sama** → satu baris log di server dan realisasi lokal +1, bukan +2 — test dedupe outbox di Task 4, skenario E2E di Task 7.
2. **Respons push hilang lalu di-retry** → server menjawab `duplicate: true` tanpa menambah realisasi — pytest di Task 1, test syncpush di Task 4.
3. **Task dibuat offline lalu langsung difokuskan dan sesinya selesai sebelum sync** → op log ditahan sampai create task terkirim, lalu terkirim ke id server yang benar — test syncpush di Task 4.
4. **Record lokal lama tanpa `estimated_pomodoros`** (sebelum update) mengedit task → PUT tidak mengirim `estimated_pomodoros` sehingga nilai server tidak tertimpa 1 — test syncpush di Task 3.
5. **Task dihapus di server saat op log masih tertunda** → 404 → op dibuang, tidak di-retry selamanya, realisasi lokal tidak lagi menghitungnya — test syncpush di Task 4.

---

### Task 1: Server — skema, endpoint log, estimasi di create/update, ADR-020

**Files:**
- Modify: `repository.py` (blok migrasi `tasks` ~550–560: dua `ALTER TABLE` bila kolom belum ada; `CREATE TABLE IF NOT EXISTS pomodoro_log` + indeks di `_init_db` dekat tabel lain)
- Modify: `webapp.py`: `TaskCreate` (~1145) tambah `estimated_pomodoros: int = Field(default=1, ge=1, le=20)`; `TaskUpdate` (~1172) tambah `estimated_pomodoros: Optional[int] = Field(default=None, ge=1, le=20)`; INSERT di `create_task` (~2082) menyertakan kolom itu; `update_task` (~2238) `if req.estimated_pomodoros is not None: updates["estimated_pomodoros"] = req.estimated_pomodoros`; model baru `PomodoroLogIn` + endpoint `POST /api/tasks/{task_id}/pomodoros` (dekat `mark_occurrence`, ~2371).
- Modify: `.agents/DECISIONS.md` (ADR-020, teks dari spec §12)
- Test: `tests/test_pomodoro_log.py` (fixture `client`, `register_user`, `db()` dari `tests/conftest.py`; workspace + anggota mengikuti helper di `tests/test_contexts_tasks.py`)

**Interfaces:**
- Produces: `POST /api/tasks/{task_id}/pomodoros` body `{client_id: str, kind: "session"|"overtime", pomodoros: int, focus_seconds: int, log_date: "YYYY-MM-DD", ended_at: ISO str}` → 200 `{id: int, task_id: int, pomodoros_done: int, duplicate: bool}`. Dict task membawa `estimated_pomodoros: int`, `pomodoros_done: int`.

- [ ] **Step 1: Tulis test yang gagal** — `tests/test_pomodoro_log.py`:
  - `test_migration_adds_columns_and_table` — `PRAGMA table_info(tasks)` memuat kedua kolom dengan default 1 / 0; tabel `pomodoro_log` dan kedua indeks ada; memanggil `webapp.migrate_db()` kedua kali tidak error.
  - `test_task_dict_has_estimate_defaults` — POST task tanpa estimasi → `estimated_pomodoros == 1`, `pomodoros_done == 0`.
  - `test_create_and_update_estimate` — POST dengan 3 → 3; PUT `{estimated_pomodoros: 7}` → 7; PUT tanpa field → tetap 7; PUT 0 dan 21 → 422.
  - `test_put_cannot_change_pomodoros_done` — PUT `{pomodoros_done: 99}` → nilai tetap 0.
  - `test_log_session_increments_without_touching_updated_at` — catat `updated_at`; POST log session (1, 1500) → 200, `pomodoros_done == 1`, `duplicate is False`; `updated_at` task sama persis; satu baris di `pomodoro_log` dengan `kind`, `log_date`, `client_id` yang dikirim.
  - `test_log_duplicate_client_id_is_idempotent` — POST yang sama dua kali → kedua 200, kedua `id` sama, kedua `pomodoros_done == 1`, yang kedua `duplicate is True`, satu baris.
  - `test_log_overtime_rules` — overtime (2, 3100) → 200 dan +2; (1, 3100) → 422; (0, 59) → 422; (5, 7500) → 422; (0, 720) → 200 dan +0.
  - `test_log_session_rules` — session (2, 1500), (1, 0), (1, 1501) → 422; `log_date` "20-10-2026" → 422; `ended_at` "kemarin" → 422; `client_id` "" atau 65 karakter → 422; `kind` "x" → 422.
  - `test_log_access` — user lain → 403; task tidak ada → 404; task berstatus done → 200.
  - `test_workspace_member_adds_to_shared_task` — anggota workspace mencatat pada task milik owner → `pomodoros_done` naik; owner melihat nilai yang sama di `GET /api/tasks/{id}`.
  - `test_delete_task_keeps_log_with_null_task` — hapus task (DELETE API) → baris log tetap, `task_id IS NULL` (koneksi memakai `PRAGMA foreign_keys=ON`; bila DELETE API melakukan soft-delete, uji hard delete lewat SQL dengan foreign_keys ON).
- [ ] **Step 2: Jalankan → FAIL** — `python -m pytest tests/test_pomodoro_log.py -q`
- [ ] **Step 3: Implementasi** skema, model, endpoint (`INSERT OR IGNORE`, baca baris lewat `(user_id, client_id)`, `UPDATE tasks SET pomodoros_done = pomodoros_done + ?` hanya bila `rowcount == 1`, dalam satu `with get_db()`), field estimasi. Parse `ended_at` dengan `datetime.fromisoformat` (terima akhiran `Z`). Tulis ADR-020.
- [ ] **Step 4: Jalankan → PASS**, lalu `python -m pytest tests/ -q` (baseline 816 + tes baru).
- [ ] **Step 5: Commit** — `feat(pomodoro): log realisasi + estimasi task di server (ADR-020)`

---

### Task 2: Modul murni `pomologic.js`

**Files:**
- Create: `static/offline/pomologic.js` (UMD seperti `static/offline/focuspage.js`; `root.TF.pomologic`)
- Modify: `static/index.html` (tag script setelah `focuspage.js`), `static/sw.js` (`STATIC`)
- Test: `tests/offline/pomologic.test.js`

**Interfaces:**
- Produces (`TF.pomologic`):
  - `POMO_SECONDS = 1500`, `EST_MIN = 1`, `EST_MAX = 20`
  - `clampEstimate(n: any) -> int` — angka dibulatkan, di luar 1–20 dijepit, non-angka → 1.
  - `nextEstimate(current: int, clicked: 1|2|3|4|5) -> int` — aturan klik Global Constraints.
  - `estimateHoursLabel(y: int) -> string` — `"~13.5 jam"`.
  - `headerSummary({count: int, done: int, estimate: int}) -> {tasksText: string, pomoText: string, hoursText: string|null}` — `tasksText` "N tugas"; bila `count > 0`: `pomoText` "X / Y", `hoursText` dari `estimateHoursLabel(Y)`; bila 0: `pomoText` "X", `hoursText` null. (Komponen merangkai `tasksText • pomoText [glyph] hari ini (hoursText)`.)
  - `sessionClientId(userId: string|number, workStartedAt: number) -> string` — `pomo-<uid>-<ms>-s`.
  - `isOverEstimate(done: int, estimate: int) -> bool` — `done > estimate`.

- [ ] **Step 1: Tulis test yang gagal** — nilai persis: `estimateHoursLabel(32) === "~13.5 jam"`, `(24) === "~10 jam"`, `(3) === "~1.5 jam"`, `(1) === "~0.5 jam"`, `(2) === "~1 jam"`; `nextEstimate`: (1,3)→3, (7,2)→2, (3,5)→5, (5,5)→6, (19,5)→20, (20,5)→20; `clampEstimate`: 0→1, 25→20, "3"→3, 2.6→3, null→1, "x"→1; `headerSummary({count:28,done:0,estimate:32})` → `{tasksText:"28 tugas", pomoText:"0 / 32", hoursText:"~13.5 jam"}`; `headerSummary({count:0,done:2,estimate:0})` → `{tasksText:"0 tugas", pomoText:"2", hoursText:null}`; `sessionClientId(7, 1760000000000) === "pomo-7-1760000000000-s"`; `isOverEstimate(4,2)` true, `(2,2)` false. Plus asserti source: tag script di index.html dan entri `STATIC` di sw.js.
- [ ] **Step 2: Jalankan → FAIL** — `node --test tests/offline/pomologic.test.js`
- [ ] **Step 3: Implementasi.**
- [ ] **Step 4: Jalankan → PASS.**
- [ ] **Step 5: Commit** — `feat(pomodoro): modul pomologic (header, estimasi, client_id)`

---

### Task 3: Field task offline (`estimated_pomodoros`, `pomodoros_done`)

**Files:**
- Modify: `static/offline/hydrate.js` (`COPY` + default: `estimated_pomodoros` → 1, `pomodoros_done` → 0 bila null)
- Modify: `static/offline/syncpull.js` (`TASK_DERIVED` ~158 tambah `"pomodoros_done"`)
- Modify: `static/offline/taskrepo.js` (`createTask` ~116: `estimated_pomodoros: clamp(input.estimated_pomodoros ?? 1)`, `pomodoros_done: 0`; `updateTask` ~173: patch `estimated_pomodoros` → `TF.pomologic.clampEstimate` — atau salinan kecil fungsi jepit di taskrepo bila memuat pomologic di node tidak sesuai pola modul; pilih yang mengikuti pola `require` modul lain)
- Modify: `static/offline/syncpush.js` (`taskToCreatePayload` ~92 dan `taskToUpdatePayload` ~111: sertakan `estimated_pomodoros` **hanya bila** `record.estimated_pomodoros != null`; jangan pernah mengirim `pomodoros_done`)
- Test: tambah ke `tests/offline/hydrate.test.js`, `tests/offline/syncpull.test.js`, `tests/offline/taskrepo.test.js`, `tests/offline/syncpush.test.js`

**Interfaces:**
- Consumes: `TF.pomologic.clampEstimate` (Task 2).
- Produces: record task lokal punya `estimated_pomodoros` (int) dan `pomodoros_done` (int, nilai server terakhir).

- [ ] **Step 1: Tulis test yang gagal:**
  - hydrate: dict server dengan `estimated_pomodoros: 3, pomodoros_done: 5` → record 3/5; dict tanpa keduanya → 1/0.
  - syncpull: record bersih dengan `updated_at` sama, server `pomodoros_done` 4 vs lokal 1 → setelah `pullTasks`, lokal 4 dan `result.derived` naik; record dirty dengan op tertunda → nilai lokal tidak berubah.
  - taskrepo: `createTask({title})` → 1/0; `createTask({title, estimated_pomodoros: 30})` → 20; `updateTask(cid, {estimated_pomodoros: 4})` → 4, dirty + rev naik; `updateTask(cid, {estimated_pomodoros: 0})` → 1.
  - syncpush: payload create/update memuat `estimated_pomodoros` bila record punya; record tanpa field → key tidak ada di payload (Review Focus 4); payload tidak pernah memuat `pomodoros_done`.
- [ ] **Step 2: Jalankan → FAIL** — `node --test tests/offline/hydrate.test.js tests/offline/syncpull.test.js tests/offline/taskrepo.test.js tests/offline/syncpush.test.js`
- [ ] **Step 3: Implementasi.**
- [ ] **Step 4: Jalankan → PASS**, lalu `npm test`.
- [ ] **Step 5: Commit** — `feat(pomodoro): estimasi + realisasi di record task offline`

---

### Task 4: `pomolog.js`, route lokal, dan push `pomodoro_log/create`

**Files:**
- Create: `static/offline/pomolog.js` (UMD; `root.TF.pomolog`)
- Modify: `static/offline/taskroutes.js` (route `POST /api/tasks/:id/pomodoros`; `GET /api/tasks` dan `GET /api/tasks/:id` menambahkan pending ke `pomodoros_done`)
- Modify: `static/offline/syncpush.js` (`processOp`: `if (op.entity_type === "pomodoro_log" && op.op === "create") return opPomodoroCreate(op, transport, result, pending);` sebelum fallthrough ~1859)
- Modify: `static/index.html` (tag script), `static/sw.js` (`STATIC`)
- Test: `tests/offline/pomolog.test.js`, tambah ke `tests/offline/syncpush.test.js` dan `tests/offline/taskroutes.test.js`

**Interfaces:**
- Consumes: outbox (`outboxAll`, `outboxAdd`, `outboxRemove`), `TFdb.openDB`, `resolveCid` di taskroutes, pola `opMark` + `parentCreatePending` di syncpush.
- Produces (`TF.pomolog`):
  - `enqueue(taskCid: string, entry: {client_id, kind, pomodoros, focus_seconds, log_date, ended_at}) -> Promise<boolean>` — tambah op `{entity_type:"pomodoro_log", op:"create", cid: entry.client_id, payload: {task_cid, …entry}}`; `false` tanpa menambah bila op dengan `cid` sama sudah ada.
  - `pendingByTaskCid() -> Promise<Object<string, number>>` — Σ `payload.pomodoros` per `task_cid` dari op `pomodoro_log`, dihitung sekali per `cid`.
  - `withPending(row, pendingMap) -> row` — `pomodoros_done = (row.pomodoros_done || 0) + (pendingMap[row.cid] || 0)` (row tampilan punya `cid`).
  - `ackPushed(qid: number, taskCid: string, pomodorosDone: number) -> Promise<void>` — **satu** transaksi IndexedDB atas store `tasks` + `_outbox`: set `pomodoros_done` pada record task bila ada dan tidak `deleted` (tanpa mengubah `dirty`/`rev`/`base_rev`), hapus op `qid`.
- Route lokal `POST /api/tasks/:id/pomodoros`: `resolveCid` → bukan task → `notFound()`; `enqueue`; jawab `{pomodoros_done}` = record + pending.
- `opPomodoroCreate`: `serverIdOf(task_cid)` null → `parentCreatePending(pending, task_cid)` ? tahan : buang op; else `send(transport, "POST", "/api/tasks/" + sid + "/pomodoros", body)` di mana body = payload tanpa `task_cid`; 2xx → `ackPushed(op.qid, task_cid, res.data.pomodoros_done)` + `result.pushed++`; 404/403 → buang op + `result.failed++`; 4xx lain → buang op + `result.failed++`; 401/429/5xx/jaringan → biarkan (perilaku `send` yang ada).

- [ ] **Step 1: Tulis test yang gagal:**
  - pomolog: `enqueue` dua kali dengan `client_id` sama → satu op, panggilan kedua `false`; dua `client_id` beda untuk task sama → `pendingByTaskCid()` = 2; op tipe lain diabaikan; `ackPushed` → record task `pomodoros_done` = nilai server, `dirty`/`rev` tidak berubah, op hilang; `ackPushed` untuk task yang sudah dihapus lokal → op tetap dihapus, tanpa error.
  - taskroutes: `POST /api/tasks/<serverId>/pomodoros` pada task server_id 10 dengan `pomodoros_done` 2 → jawaban `pomodoros_done` 3, dan `GET /api/tasks` serta `GET /api/tasks/10` melaporkan 3; id tidak dikenal → 404.
  - syncpush: (a) 200 `{pomodoros_done: 5}` → request ke `/api/tasks/10/pomodoros` dengan body tanpa `task_cid`, record lokal 5, op hilang, GET lokal melaporkan 5 (bukan 6); (b) task belum punya server id + op create task tertunda → tidak ada request, op tetap; setelah create task sukses dalam drain yang sama/berikutnya → log terkirim ke id baru (Review Focus 3); (c) task belum punya server id tanpa create tertunda → op dibuang; (d) 404 → op dibuang, pending 0 (Review Focus 5); (e) 403 dan 422 → op dibuang; (f) NETWORK / 503 → op tetap; (g) respons `duplicate: true` diperlakukan sama dengan sukses (Review Focus 2).
- [ ] **Step 2: Jalankan → FAIL** — `node --test tests/offline/pomolog.test.js tests/offline/syncpush.test.js tests/offline/taskroutes.test.js`
- [ ] **Step 3: Implementasi.**
- [ ] **Step 4: Jalankan → PASS**, lalu `npm test`.
- [ ] **Step 5: Commit** — `feat(pomodoro): antre log 🍅 offline + push idempoten`

---

### Task 5: Timer mencatat sesi utama; tanggal lokal; hapus `taskPomodoros`

**Files:**
- Modify: `static/index.html`:
  - `usePomodoro` (~8381): signature `usePomodoro({ focusTask })`; `todayStr` → `window.TF.tasklogic.todayLocalISO()`; state baru disimpan di `tf_pomo_state`: `workStartedAt` (number|null) dan `sessionTaskId` (id|null). `start()`: bila `mode === "work"` dan `timeLeft === POMO_DURATIONS.work` → `workStartedAt = Date.now()`; setiap `start()` dengan task → `sessionTaskId = activeTask.id`. `stop()`, `switchMode()`, `skip()` dari Work → `workStartedAt = null`. `handleTimerComplete` cabang work: ganti update `taskPomodoros` dengan pencatatan: task = `focusTask?.id ?? sessionTaskId`; bila ada → `api.post("/api/tasks/" + id + "/pomodoros", {client_id: TF.pomologic.sessionClientId(uid, workStartedAt), kind: "session", pomodoros: 1, focus_seconds: 1500, log_date: <tanggal lokal>, ended_at: new Date().toISOString()})` lalu `window.__refreshTasks?.()`; error dicatat ke `console.warn` (tidak memblokir timer). `uid` dari `localStorage["tf_user_id"]` (try/catch; bila kosong pakai `"0"`). Bila `workStartedAt` null (state lama), pakai `Date.now() - 1500000`.
  - App (~36044): pemulihan `focusTaskId` memakai tanggal lokal; hapus `const [taskPomodoros, setTaskPomodoros]` dan semua prop `taskPomodoros`/`setTaskPomodoros` (App → `TodayFocusView`, `TodayFocusView` lokal + fallback, `PomodoroTimer`, `FocusTaskItem.pomodoroCount`).
  - `TodayFocusView`: `todayStr` lokal.
- Test: `tests/offline/focus_pomo_log.test.js` (gaya `fnSource`)

**Interfaces:**
- Consumes: `TF.pomologic.sessionClientId` (Task 2), route lokal `POST /api/tasks/:id/pomodoros` (Task 4), `TF.tasklogic.todayLocalISO`.
- Produces: `tf_pomo_state` memuat `workStartedAt`, `sessionTaskId`; tidak ada lagi `taskPomodoros` di index.html (Task 6 membaca realisasi dari `task.pomodoros_done`).

- [ ] **Step 1: Tulis test yang gagal** — `fnSource("usePomodoro")`: tidak memuat `toISOString().slice(0, 10)`; memuat `todayLocalISO()`, `workStartedAt`, `sessionTaskId`, `sessionClientId(`, `"/pomodoros"`, `kind: "session"`, `focus_seconds: 1500`, `__refreshTasks`; tidak memuat `setTaskPomodoros`. Seluruh `indexHtml`: tidak ada `taskPomodoros`. Pemulihan `focusTaskId` di App memakai `todayLocalISO()`.
- [ ] **Step 2: Jalankan → FAIL** — `node --test tests/offline/focus_pomo_log.test.js`
- [ ] **Step 3: Implementasi.**
- [ ] **Step 4: Jalankan → PASS**; `node temporary_files/check_inline_scripts.js` bersih; `npm test` (tes lama yang mengunci `taskPomodoros` diperbarui, bukan dihapus diam-diam — sebutkan di report).
- [ ] **Step 5: Commit** — `feat(pomodoro): sesi selesai dicatat ke log; tanggal Pomodoro lokal`

---

### Task 6: UI Target 🍅

**Files:**
- Modify: `static/index.html`:
  - `PomodoroTimer` bar Task Aktif (~8727): ganti `"🍅 ", taskPomodoros[...]` dengan `[ViewGlyph pomoTomato 14] <span class="focus-pomo-task-done[ is-over]">{done}</span> / {estimate}`; `done = focusTask.pomodoros_done || 0`, `estimate = TF.pomologic.clampEstimate(focusTask.estimated_pomodoros)`; `title` "Realisasi / estimasi pomodoro".
  - `FocusTaskItem`: chip `ftask-count is-pomo` → `[ViewGlyph pomoTomato 12] done/estimate`, tampil bila `done > 0 || estimate !== 1`, kelas ` is-over` bila lewat, `title` "Realisasi / estimasi pomodoro". Prop baru `onEstimate(task, n)`. Pemilih `div.ftask-estimate` (`role="radiogroup"`, `aria-label` "Estimasi pomodoro") di `.ftask-tabs` setelah tiga tab, sebelum `ftask-detail-link`: lima `button.ftask-est-btn` (`role="radio"`, `aria-checked` = ikon ke-i == min(nilai,5), `aria-label` "Estimasi i pomodoro"; i ≤ min(nilai,5) → kelas ` is-filled`; ikon ke-5 berlabel teks "5+" dan, bila nilai ≥ 5, badge `×n`), klik → `onEstimate(task, TF.pomologic.nextEstimate(nilai, i))`.
  - `TodayFocusView`: `handleEstimate(task, n)` → `api.put("/api/tasks/" + task.id, {estimated_pomodoros: n})` lalu `window.__refreshTasks?.()`, gagal → toast "Gagal menyimpan estimasi". Header (~9358): `TF.pomologic.headerSummary({count: sortedTasks.length, done: timer.sessionCount, estimate: Σ clampEstimate(t.estimated_pomodoros)})` dirangkai `tasksText " • " pomoText " " [ViewGlyph pomoTomato 14] " hari ini" (+ " (" hoursText ")")`.
- Modify: `static/app.css` — `.focus-pomo-task-done.is-over { color:#fb923c }`, `.ftask-count.is-pomo.is-over { color: var(--p2) }`, `.ftask-estimate`/`.ftask-est-btn` (tombol 26×26, ikon pudar `opacity:.35` bila tidak terisi, terisi warna `var(--pomodoro)`, fokus terlihat; ≤ 768 px boleh pindah baris), tanpa animasi di `prefers-reduced-motion`.
- Test: `tests/offline/focus_target_ui.test.js`

**Interfaces:**
- Consumes: `task.pomodoros_done`, `task.estimated_pomodoros` (Task 3/4), `TF.pomologic.{clampEstimate,nextEstimate,headerSummary,isOverEstimate}` (Task 2), `timer.sessionCount`.
- Produces: kelas DOM `.focus-pomo-task-done`, `.ftask-estimate`, `.ftask-est-btn`, `.focus-page-summary` (dipakai E2E Task 7).

- [ ] **Step 1: Tulis test yang gagal** — sumber: `PomodoroTimer` tidak memuat emoji "🍅", memuat `name: "pomoTomato"`, `pomodoros_done`, `clampEstimate(`, `is-over`; `FocusTaskItem` memuat `ftask-estimate`, `role: "radiogroup"`, `"Estimasi pomodoro"`, `nextEstimate(`, `"5+"`, `onEstimate`, chip dengan `pomoTomato`, dan `ftask-estimate` muncul setelah `FOCUS_TABS.map` di dalam `ftask-tabs` dan sebelum `ftask-detail-link`; `TodayFocusView` memuat `headerSummary(`, `estimated_pomodoros: n`, `"Gagal menyimpan estimasi"`, dan tidak lagi memuat `" 🍅 hari ini"`; CSS memuat `#fb923c` dan `var(--p2)` pada selektor `is-over`.
- [ ] **Step 2: Jalankan → FAIL** — `node --test tests/offline/focus_target_ui.test.js`
- [ ] **Step 3: Implementasi.**
- [ ] **Step 4: Jalankan → PASS**; `check_inline_scripts` bersih; `npm test`.
- [ ] **Step 5: Commit** — `feat(pomodoro): realisasi/estimasi di bar aktif, chip, header + pemilih tomat`

---

### Task 7: Versi, E2E, handover

**Files:**
- Modify: versi (lihat Global Constraints) di `static/sw.js`, `static/index.html`, `webapp.py`, tes yang mengunci versi.
- Create: `temporary_files/e2e_focus_target.py` (harness dari `temporary_files/e2e_focus_page.py`; jalankan dengan `python3`, server lewat `E2E_PYTHON=/home/claude/venv-alurik/bin/python`); folder screenshot `temporary_files/e2e_focus_target/` masuk `.gitignore`.
- Modify: `.agents/CURRENT_STATE.md`, `.agents/SESSION_LOG.md`.

- [ ] **Step 1: Naikkan versi** (cek `git fetch origin main` dulu).
- [ ] **Step 2: Tulis E2E** (Playwright `page.clock` untuk memajukan waktu 25 menit; `service_workers="block"` kecuali skenario yang butuh SW):
  - a. Akun dengan 3 task Q1. Panel task pertama dibuka → klik ikon tomat ke-3 → chip `3`; reload → tetap 3; server `estimated_pomodoros == 3`. Ikon "5+" diklik tiga kali dari 3 → 5, 6, 7 (badge `×7`).
  - b. Header menampilkan `3 tugas • 0 / 9 … hari ini (~4 jam)` sesuai estimasi (hitung dari data seed; 9 × 25 menit = 3,75 jam → `~4 jam`).
  - c. Fokus task pertama, Mulai, majukan jam 25 menit → bar Task Aktif `1 / 7`, header X = 1; setelah sync, server `pomodoros_done == 1` dan satu baris log; reload → tetap `1 / 7`.
  - d. Estimasi task diset 1, selesaikan dua sesi → angka realisasi berkelas `is-over` (warna oranye), timer tetap bisa dimulai lagi.
  - e. Dua tab (dua `page` di context yang sama) dengan state timer yang sama; jam dimajukan sampai sesi selesai di keduanya → server satu baris log untuk `client_id` itu, realisasi +1 (Review Focus 1).
  - f. Offline: sesi selesai saat `context.set_offline(True)` → realisasi lokal langsung +1; online → server menerima tepat satu baris.
  - Screenshot terang + gelap, desktop + 375 px (bar aktif, panel dengan pemilih, header).
- [ ] **Step 3: Jalankan** — E2E exit 0; `python -m pytest tests/ -q`; `npm test` (hanya `draw_local_reactive` yang boleh gagal); `node temporary_files/check_inline_scripts.js`.
- [ ] **Step 4: Handover** — entri baru di atas `.agents/CURRENT_STATE.md` (branch `claude/focus-target-pomodoro`, versi, isi, verifikasi, deploy: **restart `taskflow-web` dan `taskflow`** karena migrasi) + perbarui baris status entri "🟡 Halaman Fokus Hari Ini"; entri `.agents/SESSION_LOG.md`.
- [ ] **Step 5: Commit** — `chore(pomodoro): SW v435 + E2E Target 🍅`
