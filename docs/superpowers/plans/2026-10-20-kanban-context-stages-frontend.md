# Kanban Tahap Kustom — PR Frontend + Offline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Papan Kanban Group by Context menampilkan tahap per scope (termasuk yang kosong) di antara kolom bawaan "Belum ada tahap" dan "Selesai", bisa diseret dengan mouse dan sentuh, tahap bisa dibuat (juga offline) dan dikelola (online), dan task menyimpan `context_id` lewat lapisan offline.

**Architecture:** Meniru PR 5 Project (ADR-011): cache server per scope di `_meta` (`contextcache.js`) + `context_id`/`context_ref_name` di record task + aturan payload F1 saat push. Hal baru: tahap yang dibuat offline disimpan sebagai entri *pending* di `_meta` dan dikirim lewat op outbox `{entity_type:"context", op:"create"}`; task yang menunjuk cid tahap pending ditahan sampai op itu selesai. Logika papan (susunan kolom, isi Selesai, aksi drop) ada di modul murni `kanbanboard.js` supaya bisa dites tanpa DOM; `index.html` hanya merender dan menjalankan aksinya.

**Tech Stack:** React tanpa JSX (`React.createElement`, file `static/index.html` sudah terkompilasi — edit langsung, jangan jalankan `compile.js`), modul UMD di `static/offline/*.js` di atas IndexedDB, `node --test` + `fake-indexeddb`, pytest, Playwright (Python) untuk E2E.

**Spec:** `docs/superpowers/specs/2026-10-19-kanban-context-stages-design.md` §7 (papan), §8 (offline), §10 (error), §11 (tes), §12 butir 2. Backend sudah di `main` (PR #50, ADR-016): `GET /api/contexts` (`string[]`, `?list_id`, `?format=full&scope=all&include_archived=1`), `POST`, `PATCH /{id}`, `PUT /order`, `DELETE /{id}`; respons task memuat `context_id`.

**Branch:** `claude/kanban-stages-frontend` dari `main` (≥ `9e79989`). Sekali di awal: `npm ci`. Baseline: `npm test` dan `python -m pytest tests -q` (615).

## Keputusan pemilik (2026-10-20, melengkapi spec)

- **K1 — Task berulang ke "Selesai":** drop (dan checkbox kartu) menandai *occurrence hari ini* selesai lewat `POST /api/tasks/{id}/occurrences/{hariIniJakarta}/mark {status:"done"}`, kartu tetap di tahapnya. Hanya online; offline → toast `"Tidak bisa dilakukan saat offline"`, tidak ada perubahan.
- **K2 — Keluar dari "Selesai":** task dibuka lagi dengan `gtd_status: "next"` sekaligus context tujuan.

## Keputusan rencana (controller)

- **R1:** entri tahap pending disimpan di `_meta` kunci `contexts:pending:v1` (tanpa store IndexedDB baru, `DB_VERSION` tetap 5). Biaya: kegagalan permanen create tahap tidak tampil di conflict bar; diganti toast saat drop (lihat Task 3).
- **R2:** isi kolom "Selesai" diambil dari `allTasks` (bukan `tasks` halaman). "Lolos filter halaman" = predikat non-status halaman: `slist_<W>` → `list_id = W`; `proj_<nama>` → project NOCASE sama; halaman lain → tanpa filter tambahan. Plus scope papan dan filter panel (prioritas/project/context/assignee/cari).
- **R3:** urutan di modal "Kelola tahap" memakai tombol ↑/↓ (bukan drag) — dapat diakses keyboard/HP, satu `PUT /order` per klik. Biaya: kurang mulus dibanding drag.
- **R4:** papan Kanban tetap dirender walau halaman tanpa task aktif (kolom kosong tampil, spec §7.1); kartu "Tidak ada task" hanya untuk mode daftar.

## Global Constraints

- Teks UI persis: `"Belum ada tahap"`, `"Selesai"`, `"+ Tahap"`, `"Papan:"`, `"Pribadi"`, `"Kelola tahap"`, `"Pindah ke…"`, `" (diarsip)"`, `" (belum tersinkron)"`, `"Butuh koneksi internet"`, `"Tahap sudah tidak ada"`, `"Nama tahap sudah dipakai"`, `"Urutan tahap sudah berubah, muat ulang"`, `"{n} task akan pindah ke Belum ada tahap"`, `"{n} task dari scope lain tidak ditampilkan"`, `"Tidak bisa dilakukan saat offline"`.
- `localStorage`: pilihan scope papan `tf_kanban_scope:<page>` (nilai `""` = pribadi, atau id workspace); semua akses `localStorage` dalam `try/catch` seperti kode sekitarnya.
- Tanggal "hari ini" dan jendela 7 hari = Asia/Jakarta (UTC+7). `completed_at` tanpa zona = UTC (sama dengan `tsEpoch`).
- Urutan kartu otomatis: prioritas P1→P4 (kosong terakhir), deadline terdekat (kosong terakhir), judul NOCASE, id. Kolom Selesai: `completed_at` terbaru di atas.
- Pembanding nama = NOCASE ASCII (`projectcache.nocaseKey`/`nocaseEq` — pakai ulang, jangan salin).
- `PATCH`/`DELETE /api/contexts/{id}` dan `PUT /api/contexts/order` **tidak** didaftarkan di router lokal (selalu ke jaringan). `GET` di modal kelola memakai `{network:true}`. `POST /api/contexts` lokal.
- Id task/tahap dipakai sebagai string apa adanya (angka server atau cid), dibandingkan dengan `String(a) === String(b)`; tidak ada `parseInt` pada id.
- Error HTTP terstruktur dibaca dari `err.body && err.body.detail` (`{code, message}`); pesan ke user = `detail.message` bila ada, selain itu `err.message`.
- Modul offline baru: tambahkan ke daftar precache `STATIC` di `static/sw.js` **dan** `<script src="/static/offline/<nama>.js">` di `index.html` sebelum `taskroutes.js` (urutan factory penting; ketergantungan ke modul yang dimuat belakangan di-resolve malas seperti `projectcache.js`).
- Tidak ada `border-left` sebagai aksen; gaya inline seperti Kanban sekarang (tanpa ubah `app.css`, sehingga `?v=334` tetap).
- Rilis: SW `taskflow-v425-kanban-stages` (ganti semua kemunculan `taskflow-v424-xss-hardening` di `static/`, `webapp.py`, `tests/`; `tests/test_version.py` juga `"v425"`). Periksa `main` sebelum merge — nomor bisa bentrok dengan PR paralel.
- Setiap task: `npm test` dan `node temporary_files/check_inline_scripts.js static/index.html` lulus; task yang menyentuh Python juga pytest.

## Review Focus

1. **Task berid cid (dibuat offline) diseret ke tahap / ke Selesai / keluar dari Selesai** → aksi benar dan task ditemukan. Tes: Task 4 `dropAction` dengan id string UUID; Task 5 tes sumber tanpa `parseInt`.
2. **Tahap dibuat offline, task dipindah ke situ, lalu online** → op tahap terkirim lebih dulu, task terkirim dengan `context_id` server, tahap tidak berkedip hilang setelah sync. Tes: Task 3 `push holds task until context create, then sends server id`; Task 1 `refresh keeps pending entries`.
3. **Perangkat basi: tahap di-rename/dihapus di perangkat lain, perangkat ini mengedit judul task offline** → push tidak membuat ulang nama lama. Tes: Task 2/3 `payloadContextId` (F1).
4. **Halaman campuran tanpa task workspace / dengan `list_id` workspace yang sudah dihapus** → pemilih scope hanya berisi scope yang ada, default Pribadi, task workspace terhapus dianggap pribadi. Tes: Task 4 `scopeOptions`.
5. **`completed_at` campuran (`Z`, tanpa zona, mikrodetik) di sekitar tengah malam WIB** → masuk/keluar jendela 7 hari dengan benar. Tes: Task 4 `isDoneRecent`.

---

### Task 1: `contextcache.js` + route lokal `GET`/`POST /api/contexts`

**Files:**
- Create: `static/offline/contextcache.js` (UMD `root.TF.contextcache`, pola `projectcache.js`)
- Modify: `static/offline/taskquery.js` — `getContextsInScope(listId)` (salinan `getProjectsInScope` dengan `r.context`), ekspor; `getContexts` tetap
- Modify: `static/offline/taskroutes.js` — ganti `GET /api/contexts` (baris ~204); tambah `POST /api/contexts`
- Modify: `static/sw.js` (STATIC), `static/index.html` (`<script>` setelah `projectcache.js`)
- Test: `tests/offline/contextcache.test.js`; perbarui `tests/offline/taskroutes.test.js` bila perlu (kontrak lama tetap: cache kosong + task `@home` → `["@home"]`)

**Interfaces:**
- Produces (`TF.contextcache`):
  - `KEY = "contexts:v1"`, `PENDING_KEY = "contexts:pending:v1"`, `FULL_PATH = "/api/contexts?format=full&scope=all&include_archived=1"`
  - `refresh(transport) -> Promise<void>` — sama dengan projectcache (gagal → cache lama tetap); **tidak menyentuh `PENDING_KEY`**.
  - `allItems() -> Promise<Item[]>` — item server + item pending. Item pending: `{id: cid, cid, name, list_id, user_id: null, position, color: null, archived: false, can_manage: true, pending: true}`.
  - `sortItems(items) -> Item[]` (murni): `position`, lalu nama NOCASE, lalu `String(id)`.
  - `list(listId, {includeArchived}) -> Promise<Item[]>` — scope, terurut `sortItems`.
  - `names(listId) -> Promise<string[]>` — nama item tidak diarsip di scope (urut posisi), lalu nama dari `taskquery.getContextsInScope(listId)` yang belum ada (NOCASE), diurut NOCASE.
  - `findId(items, listId, name) -> id|null` (murni, termasuk arsip & pending, NOCASE, scope-aware).
  - `addPending(listId, name) -> Promise<{item, created: boolean}>` — nama di-`trim()`; kosong → reject `Error("Nama tahap tidak boleh kosong")`; sudah ada di scope (NOCASE, termasuk arsip/pending) → item itu, `created:false`; selain itu entri baru dengan `cid = TF.ids.newCid()` (lihat `ids.js`) dan `position = max(position di scope) + 1` (0 bila kosong).
  - `resolvePending(cid, serverItem) -> Promise<void>` — hapus entri pending, upsert `serverItem` ke `KEY.items` (berdasarkan `id`).
  - `dropPending(cid) -> Promise<void>`; `pendingByCid(cid) -> Promise<Item|null>`.
  - `refNameOf(record)` dan `payloadContextId(record, items)` — salinan aturan `projectcache.refNameOf`/`payloadProjectId` untuk `context`/`context_id`/`context_ref_name`, dengan tambahan: id yang bukan angka (cid) → `null`.
- Route lokal:
  - `GET /api/contexts` — tanpa `format`: `names(list_id|null)`; `format=full`: `list(list_id|null, {includeArchived: ia==="1"||ia==="true"})`; `scope=all&format=full`: `allItems()` terurut (pribadi dulu, lalu per `list_id`, masing-masing `sortItems`).
  - `POST /api/contexts {name, list_id}` — `addPending`; bila `created`, tambah op outbox `{op:"create", entity_type:"context", cid, payload:{cid}}`; respons = item. (`api.fetch` sudah memanggil `schedulePush()` untuk non-GET lokal.)

- [ ] **Step 1: Write the failing tests** (`tests/offline/contextcache.test.js`, harness seperti `projectcache.test.js`):
  - `refresh stores items and keeps old cache on failure`
  - `refresh keeps pending entries` — `addPending(null,"Desain")` lalu `refresh` dengan daftar server tanpa "Desain" → `allItems()` masih memuat pending.
  - `list orders by position then name` — server item posisi 2,0,1 + pending posisi 3 → urutan 0,1,2,3; arsip hanya dengan `includeArchived`.
  - `names falls back to task contexts in scope` — cache kosong, task pribadi `@home` + task W `@kantor` → `names(null)` = `["@home"]`, `names(W)` = `["@kantor"]`.
  - `addPending reuses existing NOCASE incl archived` dan `addPending appends at max position + 1`; nama `"  "` → reject.
  - `resolvePending swaps pending for server item`.
  - `payloadContextId follows F1 and drops cids` — teks sama dengan ref → id record; teks beda → `findId`; id di scope lain → null; `context_id` cid → null.
  - Route: `GET /api/contexts?format=full&list_id=7` hanya scope 7; `GET ?format=full&scope=all`; `POST /api/contexts` membuat pending + tepat satu op outbox, POST kedua nama sama (beda kapital) → tanpa op baru.
  - `PATCH/DELETE/PUT order are not served locally` (`hasRoute` false).

- [ ] **Step 2: Run to verify fail** — `node --test tests/offline/contextcache.test.js` → FAIL (`Cannot find module .../contextcache.js`)

- [ ] **Step 3: Implement** modul, `getContextsInScope`, kedua route, registrasi `sw.js` + `<script>`.

- [ ] **Step 4: Run to verify pass** — `npm test` (semua) → PASS

- [ ] **Step 5: Commit** — `feat(kanban): contextcache + route lokal GET/POST /api/contexts`

---

### Task 2: `context_id` di record task (hydrate, repo, pull)

**Files:**
- Modify: `static/offline/hydrate.js` (COPY + `context_ref_name`), `static/offline/taskrepo.js` (`createTask`, `updateTask`, `displayFrom` bila perlu menampilkan `context_id`), `static/offline/syncpull.js` (`TASK_DERIVED`, refresh cache context setelah refresh project)
- Modify: `static/index.html` `sync()` — setelah baris dispatch `tf:projects-changed` di blok `.then` yang sama, dispatch `new CustomEvent("tf:contexts-changed", { detail: { source: "sync" } })` (jangan sisipkan `}` sebelum dispatch project; regex di `project_views.test.js` bergantung padanya)
- Test: `tests/offline/contextsync.test.js` (baru)

**Interfaces:**
- Consumes: `TF.contextcache.allItems/findId/refNameOf/refresh` (Task 1) — di-resolve malas dari `taskrepo`/`syncpull` seperti `projectcache`.
- Produces: record task punya `context_id` (angka server, cid tahap pending, atau `null`) dan `context_ref_name` (nama saat id diikat, atau `null`); `GET /api/tasks` lokal mengembalikan `context_id`.

Aturan (cermin `project_id`, taskrepo.js 115–126 dan 156–242):
- `createTask`: `context_id` eksplisit di input menang; selain itu `findId` dari cache untuk teks `context` di scope task; `context_ref_name = context_id != null ? context : null`.
- `updateTask`: `"context_id" in patch` → pakai (null mengosongkan); `patch.context != null` tanpa `context_id` → bila teks sama NOCASE dengan `rec.context` dan `rec.context_id != null` → id tetap, selain itu `findId`; `context_ref_name` diperbarui setiap id ditulis. `{context:"", context_id:null}` mengosongkan keduanya.
- hydrate & `adoptTaskDerived`: tambah `"context"`, `"context_id"` dengan penjaga `k in s` yang sama dengan project, dan hitung ulang `context_ref_name`.

- [ ] **Step 1: Write the failing tests**:
  - `hydrate copies context_id and sets ref name`
  - `createTask links context id from cache` dan `createTask keeps explicit pending cid`
  - `updateTask context_id patch sets ref name` / `same text keeps id` / `different text relinks via cache` / `clear empties both`
  - `pull adopts context_id changed without updated_at bump` (server mengubah `context_id` tanpa mengubah `updated_at`)
  - `pull refreshes context cache and failure does not fail pull`
  - sumber: `sync()` mendispatch `tf:contexts-changed` setelah `tf:projects-changed` dan regex lama di `project_views.test.js` tetap lulus

- [ ] **Step 2: Run to verify fail** — `node --test tests/offline/contextsync.test.js` → FAIL
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run** — `npm test` → PASS
- [ ] **Step 5: Commit** — `feat(kanban): context_id/context_ref_name di record task + pull`

---

### Task 3: Push — op create tahap + `context_id` di payload task

**Files:**
- Modify: `static/offline/syncpush.js` — `taskToCreatePayload`/`taskToUpdatePayload` kirim `context_id` via `payloadContextId`; `opCreate` dan `opUpdate` menahan op; `opContextCreate`; `processOp` meneruskan `pending` ke `opUpdate` dan mendaftarkan `entity_type === "context" && op === "create"`; `taskAdopt` mengadopsi `context`/`context_id`/`context_ref_name`
- Test: `tests/offline/contextsync.test.js` (lanjutan)

**Interfaces:**
- Consumes: Task 1 (`pendingByCid`, `resolvePending`, `dropPending`, `payloadContextId`, `allItems`), Task 2 (field record), `TF.idmap.mapPut`, `TF.db.mutate`, `parentCreatePending(pending, cid)`.
- Produces: `opContextCreate(op, transport, result) -> Promise` (internal), ekspor untuk tes bila pola file mengekspor op lain.

Perilaku:
- **Tahan op task:** bila `rec.context_id` bukan angka dan `pending.has(rec.context_id)` → `return` (op tetap di outbox), baik di `opCreate` maupun `opUpdate`. Bila bukan angka tetapi tidak pending lagi → payload `context_id: null` (kirim teks saja).
- **`opContextCreate`:** entri pending tidak ada → hapus op. `POST /api/contexts {name, list_id, client_id: cid}`:
  - 2xx → `mapPut("context", data.id, cid)`, `resolvePending(cid, data)`, lalu setiap task lokal dengan `context_id === cid` di-`mutate` menjadi `context_id = data.id`, `context_ref_name = data.name`, dan `context = data.name` bila teksnya NOCASE sama (tandai dirty + pastikan op `update` ada, pola `rewriteNoteTaskLinks`); hapus op; dispatch `tf:contexts-changed` bila `window` ada.
  - 403/404/4xx permanen → `dropPending(cid)`, task lokal dengan `context_id === cid` di-`mutate` ke `context_id = null`, `context_ref_name = null` (teks tetap); hapus op.
  - 429/5xx/jaringan/401 → op tetap (ikuti `send`/`classify` yang ada).

- [ ] **Step 1: Write the failing tests**:
  - `task payloads carry numeric context_id via F1` (create dan update)
  - `push holds task until context create, then sends server id` — pending tahap + task baru dengan `context_id = cid`; transport mencatat urutan: POST `/api/contexts` dulu, lalu POST `/api/tasks` dengan `context_id` angka; cache tidak lagi berisi pending.
  - `task update with pending context cid is held` (opUpdate)
  - `context create permanent failure clears cid on tasks and sends name only`
  - `context create network error keeps op and pending`
  - `stale device does not resend deleted context` — record `context_id: 5`, `context_ref_name: "Lama"`, teks `"Lama"`, cache tanpa id 5 → payload `context_id: 5` (server yang mengabaikan); teks diubah offline ke `"Baru"` yang tak ada di cache → `context_id: null`
  - `taskAdopt adopts context fields`

- [ ] **Step 2: Run to verify fail** — `node --test tests/offline/contextsync.test.js` → FAIL
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run** — `npm test` → PASS
- [ ] **Step 5: Commit** — `feat(kanban): push tahap offline + context_id task`

---

### Task 4: Model papan murni `kanbanboard.js`

**Files:**
- Create: `static/offline/kanbanboard.js` (UMD `root.TF.kanbanboard`, tanpa akses DOM/IndexedDB)
- Modify: `static/sw.js` (STATIC), `static/index.html` (`<script>` setelah `contextcache.js`)
- Test: `tests/offline/kanbanboard.test.js`

**Interfaces (semua murni):**
- Bentuk kolom (dipakai semua builder, `dropAction`, `moveTargets`, dan UI): `{key: string, kind: "none"|"stage"|"orphan"|"done"|"priority"|"project", label: string, tasks: Task[], item?: ContextItem, value?: string, color?: string|null}` — `item` untuk `stage`, `value` untuk `priority` (`"P1".."P4"` atau `""`), `project` memakai `key` grup project yang sudah ada.
- `jktDay(nowMs?: number) -> "YYYY-MM-DD"`; `tsMs(s) -> number` (tanpa zona = UTC; `NaN` untuk kosong).
- `isDoneRecent(task, todayIso) -> boolean` — `gtd_status === "done"` dan hari Jakarta `completed_at` ∈ [today−6, today].
- `sortCards(tasks) -> Task[]` dan `sortDone(tasks) -> Task[]` (Global Constraints).
- `taskScope(task, sharedLists) -> string` — `String(list_id)` bila workspace itu ada di `sharedLists`, selain itu `""`.
- `scopeOptions(tasks, sharedLists) -> [{value, label}]` — `{value:"", label:"Pribadi"}` lalu workspace yang punya task di `tasks`, label `"👥 " + name`, urut nama NOCASE.
- `buildContextBoard({tasks, donePool, items, scope, sharedLists}) -> {columns, hiddenOtherScope}` — `tasks` aktif halaman, `donePool` hasil filter R2, `items` = item context semua scope (`allItems`), `scope` = `""`/id.
  - Kolom: `{key:"none", kind:"none", label:"Belum ada tahap"}` → tiap item tidak diarsip di scope (`kind:"stage"`, `key:"stage:"+id`, `item`) → kolom sementara `kind:"orphan"` (task aktif yang context-nya item diarsip: label `nama + " (diarsip)"`; nama tak dikenal: `nama + " (belum tersinkron)"`, `key:"orphan:"+nocaseKey(nama)`) → `{key:"done", kind:"done", label:"Selesai"}`.
  - Pencocokan task→tahap: `String(context_id)` sama dengan `String(item.id)` lebih dulu, lalu nama NOCASE di scope. Kartu terurut `sortCards`; Selesai `sortDone`.
  - `hiddenOtherScope` = jumlah task di `tasks` dengan scope lain.
- `buildPriorityBoard({tasks, donePool}) -> {columns}` — `P1..P4` selalu (`key:"pri:P1"`, label `"🔴 P1 Critical"`, dst. sama dengan label sekarang), `"(Tanpa Priority)"` hanya bila ada isinya, lalu Selesai.
- `withDoneColumn(columns, donePool) -> columns` — untuk Group by Project.
- `dropAction({task, from, to, groupBy, online, todayIso}) -> Action` (`from`/`to` = objek kolom):
  - kolom sama → `{type:"none"}`
  - ke `done`: task berulang (`recurrence_type` terisi) → online ? `{type:"occurrence", date: todayIso}` : `{type:"blocked", message:"Tidak bisa dilakukan saat offline"}`; lainnya `{type:"done"}`
  - dari `done` ke `stage` → `{type:"reopen", patch:{gtd_status:"next", context_id: item.id, context: item.name}}`; ke `none` → `{type:"reopen", patch:{gtd_status:"next", context_id:null, context:""}}`; ke kolom priority/project → `{type:"reopen", patch:{gtd_status:"next", ...patch kolom}}`
  - ke `stage` → `{type:"patch", patch:{context_id: item.id, context: item.name}}`; ke `none` → `{type:"patch", patch:{context_id:null, context:""}}`; ke `orphan` → `{type:"none"}` (kolom sementara bukan target)
  - priority: `{type:"patch", patch:{priority:"P2"}}` / Tanpa → `{priority:""}`; project: `{type:"project", columnKey: to.key}` (pemanggil memakai `projectDropTarget`)
- `moveTargets(columns, fromKey) -> [{key, label}]` — semua kolom target sah kecuali asal dan `orphan` (untuk menu "Pindah ke…").
- `reorderIds(items, scope, id, dir: -1|1) -> number[]|null` — id item server tidak diarsip di scope setelah geser; `null` bila di ujung atau item pending.

- [ ] **Step 1: Write the failing tests** (satu `test(...)` per perilaku di atas), termasuk:
  - `isDoneRecent handles Z, naive and microsecond timestamps around WIB midnight` — `completed_at` `"2026-10-13T17:30:00Z"` (= 14 Okt 00.30 WIB) masuk untuk today `2026-10-20`, `"2026-10-13T16:59:59"` (13 Okt WIB) tidak masuk, `"2026-10-19T23:59:59.123456"` masuk.
  - `scopeOptions ignores deleted workspace and defaults to personal`
  - `buildContextBoard shows empty stages, orphan archived and unsynced, done last`
  - `buildContextBoard matches by id before name and counts other scope`
  - `buildPriorityBoard always shows P1-P4`
  - `dropAction with cid string task id` (id `"3f2a…-uuid"`), semua baris tabel di atas, termasuk recurring offline → blocked
  - `reorderIds swaps and refuses pending/edges`
- [ ] **Step 2: Run to verify fail** — `node --test tests/offline/kanbanboard.test.js` → FAIL
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run** — `npm test` → PASS
- [ ] **Step 5: Commit** — `feat(kanban): model papan murni kanbanboard.js`

---

### Task 5: Papan di `TaskListView` (kolom, scope, Selesai, aksi, menu "Pindah ke…")

**Files:**
- Modify: `static/index.html` — `TaskListView` (~13236–13825), `KanbanCard`, `KanbanColumn`, `KanbanView` (~12573–12843), dua call site `React.createElement(TaskListView, {` (~34776, ~34796) tambah prop `currentUser: user` **setelah** `sharedLists: sharedLists`; App: state + effect `reloadContextItems` (dengar `tf:contexts-changed`, pola `reloadProjects`) yang memuat `api.get("/api/contexts?format=full&scope=all&include_archived=1")` (lokal) ke state `contextItems`, diteruskan ke `TaskListView` sebagai `contextItems` (juga setelah `sharedLists`)
- Test: `tests/offline/kanban_board_ui.test.js` (tes sumber + fungsi helper yang di-slice, pola `project_views.test.js`)

**Interfaces:**
- Consumes: `TF.kanbanboard.*` (Task 4), `TF.contextcache` lewat `api.post("/api/contexts")` (Task 1), `handleDone`/`onDone`, `onUpdateTask` (= `handleUpdateTaskFields`), `projectDropTarget`.
- Produces: helper top-level di `index.html` (bisa di-slice untuk tes):
  - `kanbanDonePool(allTasks, page, todayIso) -> Task[]` (R2)
  - `kanbanScopeKey(page) -> string` = `"tf_kanban_scope:" + page`
  - `taskInitials(task, currentUser, collaborators) -> string|null` — dari `assigned_to` → `display_name || username` (huruf pertama tiap dua kata pertama, kapital); tak dikenal → `"?"`; tanpa assignee → `null`
  - `runKanbanAction(action, task, deps) -> Promise` — `deps = {onDone, onUpdateTask, api, showToast, onAfterOccurrence}`: `done` → `onDone(task.id)`; `occurrence` → `api.post("/api/tasks/" + task.id + "/occurrences/" + action.date + "/mark", {status:"done"})` lalu `onAfterOccurrence()`, gagal → toast `"Gagal: " + msg`; `reopen`/`patch` → `onUpdateTask(task.id, action.patch)`; `blocked` → `showToast(action.message, "error")`; `none` → tidak apa-apa.

Perilaku:
- Group by Context + Kanban: pemilih `"Papan:"` (select, opsi `scopeOptions`) tampil hanya di halaman non-`slist_*`; halaman `slist_<W>` → scope `W` tetap. Nilai disimpan di `kanbanScopeKey(page)`; nilai yang tidak ada lagi di opsi → `""`. Keterangan `"{n} task dari scope lain tidak ditampilkan"` bila `hiddenOtherScope > 0`.
- Kolom dari `buildContextBoard` / `buildPriorityBoard` / project (logika lama + `withDoneColumn`). Kanban tetap tidak tersedia untuk None/Tag/Quadrant.
- R4: cabang Kanban dirender walau `filtered.length === 0`.
- `onMoveTask` lama diganti pemanggilan `dropAction` + `runKanbanAction`; task dicari di `filtered` ∪ `donePool` dengan `String(t.id) === String(id)`. Group by Project tetap memakai `projectDropTarget(task, projGroupMetaRef.current[targetGroupKey])` (perbarui `project_views.test.js` hanya bila bentuk sumber yang dipatok benar-benar berubah, dan jelaskan di laporan).
- Kartu: checkbox terkontrol (`checked` untuk task done), kartu Selesai redup (`opacity: 0.6`); checkbox kartu = aksi drop ke `done` (termasuk K1); menghapus centang pada kartu Selesai = `onUpdateTask(task.id, {gtd_status: "next"})` (task kembali ke tahapnya sendiri, K2). Penanda terlambat/hari ini memakai `jktDay()`. Inisial assignee (bulat kecil, `taskInitials`) bila task punya `assigned_to`. Tombol kecil `"⋯"` di kartu membuka menu `"Pindah ke…"` berisi `moveTargets`.
- Header kolom: label, badge scope (project), hitungan kartu; kolom bawaan tanpa warna aksen; kolom `orphan` dengan teks abu-abu.
- Drag di task ini masih memakai mekanisme yang ada (HTML5) tetapi membawa id sebagai string apa adanya; Task 6 menggantinya.

- [ ] **Step 1: Write the failing tests** (`kanban_board_ui.test.js`):
  - `kanbanDonePool applies page predicate` (slist, proj_, next) dan jendela 7 hari
  - `taskInitials` (nama dua kata, username saja, tak dikenal `"?"`, tanpa assignee `null`)
  - `runKanbanAction dispatches each action type` (stub `onDone`, `onUpdateTask`, `api.post`, `showToast`)
  - sumber: `TaskListView` memanggil `TF.kanbanboard.buildContextBoard` dan `dropAction`; tidak ada `parseInt(` pada id kartu di `KanbanColumn`/`KanbanCard`; cabang kanban tidak dijaga `filtered.length`; kedua call site memuat `currentUser: user` dan `contextItems:` setelah `sharedLists: sharedLists`; `KanbanCard` tidak lagi memakai `new Date().toISOString()`.
- [ ] **Step 2: Run to verify fail** — `node --test tests/offline/kanban_board_ui.test.js` → FAIL
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run** — `npm test` dan `node temporary_files/check_inline_scripts.js static/index.html` → PASS
- [ ] **Step 5: Commit** — `feat(kanban): papan tahap per scope dengan kolom Selesai`

---

### Task 6: Drag dengan Pointer Events (mouse + sentuh)

**Files:**
- Modify: `static/index.html` — `KanbanCard`, `KanbanColumn`, `KanbanView` (hapus HTML5 `draggable`/`onDragStart`/`onDrop`/`dataTransfer`)
- Test: `tests/offline/kanban_drag.test.js`

**Interfaces:**
- Produces: helper top-level murni
  - `kanbanDragStart(e, now) -> {pointerType, x, y, t}`
  - `kanbanDragShouldStart(start, e, now) -> boolean` — mouse/pen: jarak ≥ 6 px; sentuh: tetap di tempat (jarak < 6 px) selama ≥ 250 ms; sentuh yang bergerak ≥ 6 px sebelum 250 ms → tidak pernah mulai (biarkan scroll)
  - `kanbanAutoScrollDelta(pointerX, rect) -> number` — negatif dalam 40 px dari tepi kiri, positif dalam 40 px dari tepi kanan, 0 selain itu (maks 16 px per frame)
  - `kanbanColumnAt(x, y)` — membaca `document.elementFromPoint(x, y).closest("[data-kanban-col]")` → key kolom atau `null`

Perilaku: `pointerdown` di kartu mencatat awal; `pointermove` memutuskan mulai lewat `kanbanDragShouldStart`, lalu `setPointerCapture`, kartu "hantu" (`position: fixed`, mengikuti pointer, `pointer-events: none`), kolom tujuan disorot (`data-kanban-col` pada elemen kolom), auto-scroll container papan via `requestAnimationFrame`. `pointerup` di atas kolom → `onMoveTask(id, key)`; di luar kolom atau `Escape` atau `pointercancel` → batal. Kartu memakai `touch-action: pan-y` (sentuh tetap bisa scroll vertikal), `tabIndex: 0`, `Enter` membuka task. Klik biasa (tanpa drag) tetap membuka detail.

- [ ] **Step 1: Write the failing tests** — `kanbanDragShouldStart` (mouse 5 px tidak, 6 px ya; sentuh diam 249 ms tidak, 250 ms ya; sentuh bergerak 8 px pada 100 ms → tidak, juga sesudahnya), `kanbanAutoScrollDelta` (tepi kiri/kanan/tengah, batas 16), sumber: tidak ada `draggable:`/`dataTransfer` di blok Kanban, ada `data-kanban-col`, `setPointerCapture`, `touchAction: "pan-y"`, `Escape`.
- [ ] **Step 2: Run to verify fail** — `node --test tests/offline/kanban_drag.test.js` → FAIL
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run** — `npm test` + `check_inline_scripts` → PASS
- [ ] **Step 5: Commit** — `feat(kanban): drag pointer events untuk mouse dan sentuh`

---

### Task 7: Kelola tahap (kolom "+ Tahap", menu kolom, modal "Kelola tahap")

**Files:**
- Modify: `static/index.html` — `KanbanView` (kolom tipis `"+ Tahap"` sebelum Selesai, hanya Group by Context), menu `"⋯"` header kolom tahap, komponen baru `StageManagerModal({listId, listName, onClose, showToast})` di dekat `ProjectManagerModal` (~3752), state App `stageManager` + render di samping `projectManager` (~34821), tombol `"Kelola tahap"` di header workspace di samping `"Kelola project"` (~34758) dan di header papan (halaman non-workspace: membuka scope papan aktif); Group by Context mode daftar memakai urutan posisi (`contextItems`) alih-alih `normalKeys.sort()`
- Test: `tests/offline/stage_manager.test.js`

**Interfaces:**
- Consumes: `contextItems` (Task 5), `TF.kanbanboard.reorderIds` (Task 4), `api.post("/api/contexts")` lokal (Task 1), endpoint jaringan `PATCH/DELETE /api/contexts/{id}`, `PUT /api/contexts/order {list_id, ids}`.
- Produces: helper top-level murni untuk tes:
  - `stageManagerUrl(listId) -> string` = `/api/contexts?format=full&include_archived=1` (+ `&list_id=` bila ada)
  - `stageMenuActions(item, online) -> string[]` — item pending → `[]`; `!item.can_manage` → `[]`; selain itu `["rename","color","left","right","archive","delete"]`; offline → aksi yang sama tetapi ditandai nonaktif oleh pemanggil (fungsi kedua `stageActionDisabled(action, online)` → `true` bila `!online`)
  - `stageDeleteConfirmText(item) -> string` = `"{task_count} task akan pindah ke Belum ada tahap"` (0 → teks tetap dengan 0)
  - `stageErrorText(err) -> string` — `err.body.detail.code === "CONTEXT_NAME_TAKEN"` → `"Nama tahap sudah dipakai"`; `"CONTEXT_ORDER_STALE"` → `"Urutan tahap sudah berubah, muat ulang"`; 404 → `"Tahap sudah tidak ada"`; offline (`isOfflineErr`) → `"Butuh koneksi internet"`; selain itu `detail.message || err.message`
  - `stageAfterChange(tasksChanged)` — `TF.contextcache.refresh(window.__syncRawFetch)` lalu dispatch `tf:contexts-changed`; bila `tasksChanged` → `window.__syncNow()` dan `window.__refreshTasks()` (pola `projectManagerAfterChange`)

Perilaku:
- `"+ Tahap"`: input nama (Enter simpan, Escape batal) → `api.post("/api/contexts", {name, list_id: scope || null})` → dispatch `tf:contexts-changed`; bekerja offline.
- Menu kolom: Ganti nama (inline), Warna (`<input type="color">` + validasi `#rrggbb`), Geser ke kiri/kanan (`reorderIds` → `PUT /order`), Arsip, Hapus (konfirmasi `stageDeleteConfirmText`). Nonaktif offline dengan `title: "Butuh koneksi internet"`. Error → toast `stageErrorText`; 409 `CONTEXT_ORDER_STALE` → toast + `stageAfterChange(false)`.
- Modal "Kelola tahap" (`role: "dialog"`, `aria-label: "Kelola tahap"`): `api.get(stageManagerUrl(listId), {network:true})`, baris per tahap (termasuk arsip, ditandai), tombol ↑/↓ (R3), rename, warna, arsip/aktifkan, hapus; offline → teks `"Butuh koneksi internet"` dan semua aksi nonaktif; Escape menutup.

- [ ] **Step 1: Write the failing tests** — helper di atas (masing-masing), `stageAfterChange` dengan `window`/`CustomEvent` palsu (pola `project_manager.test.js`), sumber: tombol `"Kelola tahap"` berada di antara penanda yang dipatok `project_manager.test.js` tanpa mengubah indentasi blok `if (page.startsWith("slist_")) {`, modal memakai `{ network: true }`, `"+ Tahap"` hanya untuk Group by Context, mode daftar context tidak lagi memakai `normalKeys.sort()` untuk context.
- [ ] **Step 2: Run to verify fail** — `node --test tests/offline/stage_manager.test.js` → FAIL
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run** — `npm test` + `check_inline_scripts` → PASS
- [ ] **Step 5: Commit** — `feat(kanban): kelola tahap dari papan dan modal`

---

### Task 8: Field Context per scope di form & detail task

**Files:**
- Modify: `static/index.html` — hook `useScopeContexts(listId)` di dekat `useScopeProjects` (~3673; muat `api.get(listId ? "/api/contexts?list_id=" + encodeURIComponent(listId) : "/api/contexts")`, muat ulang pada `tf:contexts-changed`); helper `contextScopeLabel(listId, sharedLists)` → `"Tahap/Context · Pribadi"` atau `"Tahap/Context · <nama W>"`; `TaskFormModal` (~3881): Context `ComboSelect` memakai `useScopeContexts(form.list_id)` dan label `contextScopeLabel`; `changeScope` (~4102) juga mengosongkan `context` bila tidak ada di scope baru (`projectAfterScopeChange(f.context, names)`); `TaskDetailModal` (~6208): Context memakai `useScopeContexts(task.list_id)` + label yang sama; App: `setContexts` juga dimuat ulang pada `tf:contexts-changed`
- Test: `tests/offline/context_scope_form.test.js` (pola `project_scope_form.test.js`)

**Interfaces:**
- Consumes: route lokal `GET /api/contexts?list_id=` (Task 1); `taskrepo` mengikat `context_id` dari teks (Task 2), sehingga form cukup mengirim teks `context`.

- [ ] **Step 1: Write the failing tests** — `contextScopeLabel` (pribadi, workspace, workspace tak dikenal → "Pribadi"), sumber: `TaskFormModal` memakai `useScopeContexts(form.list_id)`, `changeScope` memanggil `projectAfterScopeChange(f.context`, `TaskDetailModal` memakai `useScopeContexts(task.list_id)`, `useScopeContexts` mendengar `tf:contexts-changed`.
- [ ] **Step 2: Run to verify fail** — `node --test tests/offline/context_scope_form.test.js` → FAIL
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run** — `npm test` + `check_inline_scripts` → PASS
- [ ] **Step 5: Commit** — `feat(kanban): field context per scope di form dan detail task`

---

### Task 9: Rilis — versi SW, ADR, E2E

**Files:**
- Modify: `static/sw.js`, `static/index.html` (2 tempat), `webapp.py` (`sw_cache`), `tests/test_version.py`, 14 tes JS yang memuat string versi (lihat Global Constraints)
- Modify: `.agents/DECISIONS.md` — **ADR-017** "Papan Kanban tahap: model murni + tahap pending offline di `_meta`" (K1, K2, R1–R4, aturan tahan op task)
- Create: `temporary_files/e2e_kanban_stages.py` (pola `temporary_files/e2e_project_scope.py`; tidak dijalankan CI; screenshot ke `temporary_files/e2e_kanban_stages/`)

- [ ] **Step 1:** Ganti versi: `grep -rl "taskflow-v424-xss-hardening" static webapp.py tests | xargs sed -i 's/taskflow-v424-xss-hardening/taskflow-v425-kanban-stages/g'`, lalu ubah literal `"v424"` di `tests/test_version.py` menjadi `"v425"`. Pastikan `grep -rn "v424" static webapp.py tests` hanya menyisakan teks yang bukan versi aktif.
- [ ] **Step 2:** Tulis ADR-017.
- [ ] **Step 3:** Tulis E2E dengan alur (masing-masing `check(...)` + screenshot):
  1. Buat tahap "Desain" dan "Review" di workspace tanpa task → dua kolom kosong tampil di antara "Belum ada tahap" dan "Selesai".
  2. Buat task, seret dengan mouse ke "Desain" → `context` di server `"Desain"` dengan `context_id` benar setelah sync.
  3. Konteks `has_touch=True`: tekan-tahan kartu ≥ 300 ms lalu geser ke "Review" (PointerEvent sentuh sintetis bila `page.touchscreen` tidak cukup) → pindah.
  4. Seret ke "Selesai" → task done; seret keluar ke "Desain" → `gtd_status` `next`.
  5. Task berulang ke "Selesai" → occurrence hari ini tercatat, kartu tetap di tahapnya.
  6. Menu "Pindah ke…" memindahkan kartu tanpa drag.
  7. Halaman "Next Actions" dengan task pribadi + workspace → pemilih "Papan:" dan keterangan task dari scope lain.
  8. Rename, geser kiri, arsip, hapus tahap di perangkat A → perangkat B (konteks kedua, anggota W) melihat hasilnya setelah sync.
  9. Offline (`set_offline(True)`): "+ Tahap" "QA", buat task dan pindahkan ke "QA"; online + sync → server punya tahap "QA" dan task ter-link ke id servernya.
  10. Task yang dibuat offline (id cid) bisa diseret sebelum sync.
- [ ] **Step 4:** Jalankan semua: `npm test`, `python -m pytest tests -q`, `node temporary_files/check_inline_scripts.js static/index.html`, `python3 temporary_files/e2e_kanban_stages.py` → semua PASS (catat hasil E2E dan daftar screenshot di laporan).
- [ ] **Step 5: Commit** — `chore(kanban): SW v425, ADR-017, E2E papan tahap`

---

## Setelah semua task

- Review akhir seluruh branch (model terkuat), satu gelombang perbaikan, re-review.
- Perbarui `.agents/CURRENT_STATE.md` dan `.agents/SESSION_LOG.md`; buka **draft PR** ke `main`. Catatan deploy: hanya file statis + `webapp.py` (`sw_cache`) → restart `taskflow-web` agar `/api/version` melaporkan v425.
