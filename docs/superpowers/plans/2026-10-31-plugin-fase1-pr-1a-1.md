# Sistem Plugin Fase 1 — PR 1a-1: `tasks.ext`, slot `taskList.views` + `taskDetail.sections`, `api.taskExt`, perbaikan `versionchange` IndexedDB — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plugin bisa menyimpan field sendiri di task (`tasks.ext`, kunci `<pluginId>.<field>`) yang ikut sinkron task di semua jalur dengan semantik **patch per kunci** (perangkat/anggota yang plugin-nya OFF atau klien lama tidak pernah menimpa field plugin), host punya dua slot baru (`taskList.views` = view ke-4 di halaman project/workspace yang tombolnya tampil tanpa mengeksekusi kode plugin, `taskDetail.sections` = seksi di detail task), `TF.api` v1 mendapat `api.taskExt` (izin `task.ext`), dan `static/offline/db.js` akhirnya menangani `versionchange`/`blocked` (tab lama menutup koneksi + memberi tahu pengguna) — **tanpa** menaikkan versi IndexedDB (v7 di PR 1a-2, ≥ 3 hari setelah PR ini di-deploy). Dibuktikan plugin contoh khusus tes `demo-ext`; tidak ada fitur baru yang terlihat pengguna (whatsnew `silent`).

**Architecture:** Server: modul baru `task_ext.py` (skema `ALTER TABLE tasks ADD COLUMN ext`, validasi bentuk/namespace/`$task`, `apply_patch` per kunci, batas 4/16 KB, `parse` → objek); `webapp.py` menerima `ext` di `POST /api/tasks` dan `ext_patch` di `PUT /api/tasks/{id}`, menggabungkan di dalam transaksi `UPDATE` yang sama, `task_row_to_dict` selalu mengirim `ext` objek, dan PUT yang hanya mengubah ext tidak memicu notifikasi workspace (K6); `plugin_loader` menyimpan izin plugin dari `index.json` (namespace sah = plugin berizin `task.ext`). Klien: modul murni baru `static/offline/taskext.js` (`TF.taskext`, aturan yang sama dengan server) dipakai `taskrepo` (`rec.ext` + `rec.ext_dirty`), `hydrate`/`syncpull` (*only-if-sent*, tempel ulang kunci kotor saat LWW server menang), dan `syncpush` (`ext`/`ext_patch` hanya kunci kotor, resolusi `{"$task": cid}` → id server, tahan/tunda, jendela deploy); `db.js` memasang `onversionchange`/`onblocked` + `subscribe`, modul DOM baru `static/offline/dbupgrade.js` menampilkan banner; runtime (`static/plugin-runtime.js`) mendapat dua slot, izin `task.ext`, validasi `contributes`/`taskExt`, `viewsFor`/`useViews`, `TF.SlotView`, `TF.PluginIcon`, `api.taskExt`; `compile.js` menyalin `contributes`/`taskExt` ke `index.json` dan menggabung `parts`; `index.html` hanya sambungan (≤ 35 baris).

**Tech Stack:** Python 3.12 (CI) / 3.13 lokal, FastAPI 0.115, pydantic v2, `sqlite3` lewat `dbconn` (ADR-038), pytest; klien UMD tanpa bundler (`static/offline/*.js`), React UMD (`static/vendor/react.production.min.js`, tes memakai dispatcher hooks palsu seperti `tests/offline/plugin_slot.test.js`), `node --test` + `fake-indexeddb` 6 (`tests/offline/setup.js`), Babel classic (`compile.js`), Playwright (E2E manual, tidak di CI). Tidak ada dependensi baru.

**Spec:** `docs/superpowers/specs/2026-10-31-plugin-fase1-timeline-design.md` (salinan Project claude.ai `claude/spec-plugin-fase1-timeline-2026-10-31.md`; disetujui pemilik 2026-10-31 — §15 Q1 lima PR dengan jeda ≥ 3 hari antara 1a-1 dan 1a-2, Q2 fondasi dibuktikan plugin contoh khusus tes, Q3 Timeline di workspace per anggota, Q4/Q5 untuk 1b). PR 1a-1 mencakup §1 kriteria 2, 4, 5 (`task.ext` saja), 9, 10; §2 K1, K2, K4–K7, K12, K13, K19 (`contributes`/`taskExt`/`parts`), K20, K21; §3 baris 1a-1; §4 (handler saja); §5.1 baris `task_ext.py`/`webapp.py`/`plugin_loader.py` (bagian ext); §5.2 ALTER; §6.1; §7.1 baris `db.js` (K2), `dbupgrade.js`, `hydrate.js`, `taskrepo.js`, `syncpush.js`/`syncpull.js` (bagian ext), `plugin-runtime.js`, `compile.js`, `index.html`; §7.2; §7.4; §10 baris 1–4 dan jendela deploy 1a-1; §11 bagian 1a-1; §12 baris 1a-1. **Bukan** cakupan: `plugin_records`, `plugin_sync.js`, `api.records`, izin `records`, IndexedDB v7, ekspor data, `plugin_host.list_access`, rute `/records` dicadangkan (semua 1a-2). Juga: spec 0a Lampiran B5–B9, spec 0b, ADR-037/038/039, `docs/plugins/README.md`, `.agents/PROTOCOL.md` §4, `CLAUDE.md`.

**Branch:** `claude/plugin-fase1-1a-1` dari `main` ≥ `8a16cd4` (setelah #118 Fase 0b PR B; SW `taskflow-v490-plugin-akun`, `app.css?v=382`, IndexedDB `taskflow-offline` v6, 81 modul `static/offline/`, `index.html` 46.095 baris, `plugin-runtime.js` 1.138, `syncpush.js` 2.319, `syncpull.js` 1.951, `webapp.py` 10.819). Baseline (dijalankan 2026-10-31 21.54 WIB di `main` `8a16cd4`, Python 3.13.18 / pytest 9.1.1 / Node 22.23.4; `git fetch origin main && git checkout -B main origin/main`): `python3 -m pytest tests/ -q` → **1345 passed, 1 skipped** (100 s); `npm test` → **3645/3646** (gagal pra-ada: `Unified Offline Drawing Reactivity - Local Event Reactivity`, `draw_local_reactive`); `node --test tests/build-plugins.test.js` → **11/11**.

## Peta perubahan

| File | Status | Isi (Task) |
|---|---|---|
| `docs/superpowers/specs/2026-10-31-plugin-fase1-timeline-design.md` | baru | salinan spec (T1), "Catatan implementasi PR 1a-1" (T13) |
| `task_ext.py` | baru (~150 baris) | skema, validasi, `apply_patch`, `parse`, filter namespace (T1) |
| `plugin_loader.py` | ubah | `permissions()`, `ext_namespaces()`, pesan `on_task_written` (T1) |
| `tests/fixtures/plugins/index.json` | ubah | entri `demo-ext` berizin `task.ext` (T1) |
| `tests/fixtures/taskext_vectors.json` | baru | vektor bersama pytest + node (T1, T3) |
| `webapp.py` | ubah | `migrate_db` satu baris, `TaskCreate.ext`, `TaskUpdate.ext_patch`, `task_row_to_dict`, POST, PUT, K6 (T2) |
| `static/offline/taskext.js` | baru (~130 baris) | `TF.taskext` murni (T3) |
| `static/offline/taskrepo.js`, `hydrate.js` | ubah | `ext`/`ext_dirty`, tulis akhir lewat `TFdb.mutate`, *only-if-sent* (T4) |
| `static/offline/syncpush.js` | ubah | `ext`/`ext_patch`, `$task`, `taskAdopt`, tulis ulang ref (T5) |
| `static/offline/syncpull.js` | ubah | *only-if-sent*, tempel ulang + antre ulang (T6) |
| `static/offline/db.js` | ubah | `onversionchange`, `onblocked`, `subscribe`, `upgradeState` (T7) |
| `static/offline/dbupgrade.js` | baru (~70 baris) | banner DOM (T7) |
| `compile.js` | ubah | `contributes`, `taskExt`, `parts`, validasi `icon.path` (T8) |
| `tests/fixtures/plugins/demo-ext/{manifest.json,plugin.jsx,util.js}` | baru | plugin contoh khusus tes (T8) |
| `static/plugin-runtime.js` | ubah | slot, izin, `viewsFor`/`useViews`, `SlotView`, `PluginIcon` (T9); `api.taskExt` (T10) |
| `static/index.html` | ubah (≤ 35 baris bersih) | `<script>` ×2, `pageScopePred`, tombol + cabang view, context, slot detail, `bindHost`, label izin (T11); versi SW (T12) |
| `static/sw.js`, `static/whatsnew.json` | ubah | `STATIC` +2 (T11); `CACHE` v491, entri `silent` (T12) |
| `docs/plugins/README.md`, `.agents/DECISIONS.md` | ubah | `task.ext`, slot, `contributes`/`parts`; ADR-040 (T12) |
| `tests/test_plugins_node.py` | ubah | pola + `REQUIRED` (T12) |
| `temporary_files/e2e_plugin_fase1a1.py`, `temporary_files/e2e_app_demo_ext.py` | baru | E2E (T13) |

## Keputusan rencana (controller)

- **R1 — Migrasi kolom di blok project `migrate_db`, bukan di `plugin_loader.migrate`.** Spec §5.1 menaruh `task_ext.ensure_schema` di `plugin_loader.migrate`, yang menelan semua exception (ADR-039). Kolom `ext` dipakai setiap INSERT/UPDATE task — gagal diam-diam = 500 di setiap tulis task. Maka satu baris `task_ext.ensure_schema(conn)` tepat setelah `email_outbox.ensure_schema(conn)` (`webapp.py:969`, koneksi FK ON, ALTER ADD COLUMN tidak merombak tabel): gagal = `migrate_db` melempar = `deploy.yml` (`set -e`) berhenti sebelum restart. Jumlah `dbconn.connect` tetap 27 (pagar `tests/test_dbconn_callsites.py` tidak diubah); `migrate_db` juga dijalankan saat startup web (`webapp.py:1755`).
- **R2 — Gabung ext di dalam transaksi `UPDATE` yang sudah ada.** `PUT /api/tasks/{id}` tetap `async def` + `get_db()` (endpoint lama tidak di-refactor). Validasi bentuk/namespace/`$task` sebelum membuka DB (422 cepat). Setelah `UPDATE tasks SET …` utama (`:2645`, DML pertama → `BEGIN IMMEDIATE` karena `isolation_level="IMMEDIATE"`): `SELECT ext` → `apply_patch` → `UPDATE tasks SET ext`; semuanya sebelum `conn.commit()` blok tag (`:2647–2651`). `EXT_TOO_LARGE` dilempar di dalam `with get_db()` → rollback seluruh PUT. `ext_patch` yang dikirim dihitung sebagai perubahan (tidak pernah 400 "No fields to update").
- **R3 — Server lama mengirim `ext` sebagai string.** Setelah `migrate_db` (sebelum restart) proses lama melihat kolom baru lewat `SELECT *` → `"ext": "{}"` (string), bukan "tanpa `ext`" seperti asumsi K5. Klien memperlakukan `ext` hanya sebagai "dikirim" bila **objek polos** (`TF.taskext.isPlainObject`); string/array/null = tidak dikirim (hidrasi, pull, `taskAdopt`).
- **R4 — Namespace: buang diam-diam, gagal-terbuka saat indeks rusak.** Kunci ber-namespace yang bukan plugin berizin `task.ext`: `plugin_loader.refresh_known()` sekali per request, masih asing → dibuang + `WARNING` sekali per namespace per proses. Bila `plugin_loader.index_ok()` false → semua namespace berbentuk sah **diterima** (log `WARNING` sekali): indeks rusak tidak boleh membuat server membuang data plugin lalu klien mengadopsi ext tanpa kunci itu.
- **R5 — Bentuk `known()` tidak berubah.** `test_load_known_ok_and_broken` mengunci `known()["demo-server"] == {"defaultEnabled": False}`; izin disimpan terpisah (`_permissions`), diisi `load_known`/`refresh_known`. K21 dikerjakan di sini: `PENDING_HOOKS["on_task_written"] = None` → pesan `"on_task_written belum didukung (ditunda, Lampiran B)"` (satu parameter tes lama berubah, R18).
- **R6 — Aturan K6.** Notifikasi "memperbarui task" dilewati bila `ext_patch` dikirim **dan** tidak ada field inti yang berubah: untuk tiap kunci di `updates` kecuali `updated_at`, `quadrant`, `completed_at`, `recurrence_end_date`, `recurrence_notif_level`, `ext` — nilai baru `==` baris lama; `recurrence_renew` true = berubah. (Push klien selalu mengirim record penuh; task `done` selalu menulis ulang `completed_at`.) PUT **tanpa** `ext_patch` tetap berperilaku lama.
- **R7 — Nama field `ext_patch` juga di rute lokal dan `taskrepo`.** Spec K5 menulis `patch.ext`; body yang sama (`{ext_patch}`) dipakai untuk `api.put` lokal maupun jaringan, jadi `taskrepo.updateTask` membaca `patch.ext_patch`. `createTask` membaca `input.ext` (sama dengan `POST`).
- **R8 — Tulis akhir `updateTask` lewat `TFdb.mutate`.** `updateTask` membaca record lalu `putRaw` di transaksi lain (`taskrepo.js:177–282`); autosave Live Edit yang berjalan bersamaan dengan `api.taskExt.set` akan menimpa `ext`/`ext_dirty`. Tulis akhir menjadi `TFdb.mutate("tasks", cid, cur => …)`: field inti dari `next` (perilaku lama), tetapi `ext` = `applyPatch(cur.ext, ext_patch)`, `ext_dirty` = `cur.ext_dirty ∪ kunci patch`, `rev = (cur.rev || 0) + 1`; record hilang/terhapus di `cur` → `Task not found`; ukuran > batas → abort, reject 422.
- **R9 — `$task`: create menunda kunci, update menahan op.** Op **create** tidak pernah ditahan karena ref (A↔B yang dibuat offline saling merujuk akan deadlock): kunci yang memuat ref ke cid ber-create antre **tidak dikirim** dan tetap kotor (`taskAdopt` menempelnya kembali → op update susulan). Op **update** yang kunci kotornya merujuk cid ber-create antre **ditahan** (pola `contextHeld`). Ref ke cid tanpa server id dan tanpa create antre → nilai `null` (objek ref diganti `null`, bukan `{"$task": null}`). Setelah `POST` task sukses: `rewriteTaskExtRefs(cid, sid)` di samping `rewriteNoteTaskLinks` (`syncpush.js:517`). Server menerima `$task` hanya `{"$task": <int>}` (bukan bool, tepat satu kunci); klien menerima angka bulat atau cid string tak kosong ≤ 64.
- **R10 — Jendela deploy.** Respons 2xx tanpa `ext` objek dan record punya `ext_dirty` → `taskAdopt` memaksa `dirty = 1`, `ext_dirty` tetap; `requeueIfDirty` mengantre op untuk **drain berikutnya** (drain memakai snapshot op, `syncpush.js:2288–2290`) → paling banyak satu PUT per task per sinkron sampai server di-restart. Push tanpa `ext_dirty` tidak pernah mengirim kunci `ext_patch` (server lama dan K6 tidak tersentuh).
- **R11 — Pull LWW server menang dengan kunci kotor:** `dropOutbox` (perilaku lama) → tulis record server + `ext` = ext server (atau lokal bila tidak dikirim) ditempeli `cur.ext[k]` untuk `k ∈ ext_dirty`, `ext_dirty` dipertahankan, `dirty = 1` → `requeueOp("task", rec)` (op update). Tanpa `ext_dirty` perilaku lama persis.
- **R12 — `versionchange`.** `e.newVersion === null` (hapus DB) → tutup + `_dbPromise = null` (boleh buka ulang; tanpa banner). Selain itu → `db.close()`, `_dbPromise` = penolakan `Error("DB_UPGRADED_ELSEWHERE")` (`code` sama, sudah `.catch` agar tidak *unhandled*), `upgradeState().upgradedElsewhere = true`, event. `onblocked` → `blocked = true` + event; `onsuccess` setelah blocked → `blocked = false` + event `unblocked`. Event: `subscribe(fn)` (Node + browser) dan `window` `tf:db-blocked` / `tf:db-unblocked` / `tf:db-upgraded-elsewhere`. `_reset()` mengosongkan status. Teks banner (§4 spec; K2 menulis versi ringkas): blocked `"Tutup tab Alurik lain untuk menyelesaikan pembaruan"`; elsewhere `"Alurik diperbarui di tab lain. Muat ulang tab ini."` + tombol `"Muat ulang"`. `DB_VERSION` tetap 6; komentar "jangan pernah diturunkan" ditambahkan sekarang.
- **R13 — `compile.js`.** `contributes` dan `taskExt` opsional, disalin ke `index.json` **dan** konstanta `manifest` di `plugin.js` hanya bila ada (indeks `habit-heatmap` dan hash-nya tidak berubah); `records` menyusul 1a-2. `parts` hanya saat build (tidak disalin): nama `^[a-z0-9][a-z0-9_-]*\.js$`, unik, ada di folder, bukan `plugin.js`; isinya mentah (tanpa Babel) didahulukan sebelum kode `plugin.jsx` di dalam IIFE yang sama, masing-masing diawali komentar `// part: <nama>`; lint berlaku atas `plugin.js` utuh. Izin `task.ext` ⇔ `taskExt.keys` (array field unik `^[a-zA-Z][a-zA-Z0-9_]{0,31}$`, tak kosong). Validasi `contributes` sama dengan runtime (T9).
- **R14 — `api.taskExt`.** Selalu ada di `api`; setiap fungsi tanpa izin `task.ext` → `PluginPermissionError` (dihitung `markFailed("permission")`). `set` hanya menerima field di `manifest.taskExt.keys` (salah ketik tertangkap; Timeline 1c menambah kunci lewat manifest). Error host: `status 422` + pesan `EXT_*` → `PluginStorageError`; `"Task not found"`/404 → `Error("Task not found")`; lainnya diteruskan. Optimistis: `hostBinding.patchTaskExt(id, prefixed)` sebelum `updateTaskExt`; gagal → `refreshTasks()` lalu reject. `setMany` berhenti pada kegagalan pertama (item sebelumnya tetap tersimpan), selalu satu `refreshTasks()` + satu `taskUpdated` di akhir.
- **R15 — Context `taskDetail.sections` tanpa `currentUser`.** `TaskDetailBody` (`index.html:9669`) tidak menerima `user`/`showToast`; menambah prop = mengubah dua pemanggil + App. Context: `{task, variant, collaborators, onOpenTask, showToast: window.__showToast}`; pengguna lewat `api.env.userId` (didokumentasikan README).
- **R16 — Context `taskList.views` stabil.** `filtered` dihitung ulang tiap render (`index.html:19229`); `useMemo` bergantung pada **masukan** (`page`, `tasks`, `allTasks`, tujuh state filter panel, `collaborators`, `currentUser`, `liveOn`, `sel.ref`, view aktif) dan menghitung `applyPanelFilters(tasks)` di dalamnya; `onTaskClick`/`isSelected` dibungkus ref (`extCbRef.current = {rowClick, isSel}`) agar identitas tetap. Tanpa view plugin aktif memo mengembalikan `null`.
- **R17 — Anggaran `index.html`.** `plugin_host_wiring.test.js` `BASELINE_LINES = 46095` ("baseline Fase 1, main 8a16cd4"), `MAX_ADDED_LINES = 60` untuk **seluruh** Fase 1 (K20); batas PR ini **≤ 35** (§12) diperiksa di T14 (`wc -l static/index.html` ≤ 46130).
- **R18 — Tes lama yang asersinya berubah karena spec (hanya ini):** `plugin_registry.test.js:36` `KNOWN_SLOTS` → `["dashboard.widgets", "taskList.views", "taskDetail.sections"]`, `:37` `KNOWN_PERMISSIONS` → `["storage", "network", "task.ext"]`, `:38` daftar dicadangkan tanpa `"task.ext"` + `assert.ok(!P.RESERVED_PERMISSIONS.includes("task.ext"))`; `tests/test_plugin_loader.py:124` pesan `on_task_written` (R5); `plugin_host_wiring.test.js:15` baseline (R17). Semua tes `syncpush`/`syncpull`/`taskrepo`/`hydrate`/`db` lama lulus tanpa diubah.
- **R19 — Rilis:** SW `taskflow-v491-plugin-ext` (bila `main` maju, nomor berikutnya mengikuti PROTOCOL §4 butir 4), whatsnew `{"version", "date", "silent": true}`, `app.css?v=382` tetap, ADR-040, restart manual `taskflow-web` **dan** `taskflow`.
- **R20 — Label izin di Pengaturan:** `task.ext` → `"Menyimpan data tambahan di task (ikut tersinkron)"` (di baris `perm` yang sama, `index.html:27207`, 0 baris baru).
- **R21 — E2E tanpa menyentuh `static/plugins/`:** server memakai aplikasi pembungkus `temporary_files/e2e_app_demo_ext.py` (`import webapp` lalu `plugin_loader.load_known(<indeks tmp: indeks nyata + demo-ext>)`); klien mendapat `demo-ext` lewat `ctx.route` atas `/static/plugins/index.json` dan `/static/plugins/demo-ext/*` (hasil `buildPlugins` ke direktori tmp), konteks dengan `service_workers="block"`.

## Global Constraints

- IndexedDB tetap `taskflow-offline` **v6**, tanpa store/indeks baru; `app.css` dan `app.css?v=382` tidak berubah (banner memakai gaya inline bertoken `var(--…)`); `index.html` ≤ +35 baris bersih dari 46.095; `TF.api.apiVersion` tetap `1`; `static/plugins/` (indeks produksi) tidak berubah — `node compile.js` dua kali tanpa diff.
- Tidak ada endpoint baru; `POST/PUT /api/tasks` tetap `async def`; `task_ext.py` tidak memanggil `sqlite3.connect` (pagar AST PR A); `migrate_db` tetap 27 `dbconn.connect`.
- Kolom: `ext TEXT NOT NULL DEFAULT '{}'` (ALTER idempoten lewat `PRAGMA table_info`, tanpa backfill). Kunci `^[a-z][a-z0-9-]{2,31}\.[a-zA-Z][a-zA-Z0-9_]{0,31}$`; ukuran = byte UTF-8 `json.dumps(obj, separators=(",", ":"), ensure_ascii=False)` / `JSON.stringify` — per plugin (kunci ber-namespace sama) ≤ **4096**, total ≤ **16384**. 422 `{"detail": {"code": "EXT_INVALID" | "EXT_TOO_LARGE" | "EXT_TASK_REF", "key": <kunci | namespace | null>}}`. Respons task selalu `ext` objek (`{}` bila kosong/rusak).
- Klien: record `ext` (objek) + `ext_dirty` (array kunci belum terkirim, tidak ada = bersih). Push: `POST` kirim `ext` hanya bila ada kunci; `PUT` kirim `ext_patch` hanya bila `ext_dirty` tak kosong.
- `localStorage` `tf_viewmode_ext:<page>` bernilai `"<pluginId>:<viewId>"`; `tf_viewmode` tidak berubah. `pageKind`: `proj_*` → `project`, `slist_*` → `workspace`, lainnya tanpa tombol.
- Teks UI persis: banner R12; view `"Memuat {label}…"`, `"{label} tidak bisa dimuat"`, tombol `"Kembali ke Normal"`; label izin R20.
- Event/kode: `tf:db-blocked`, `tf:db-unblocked`, `tf:db-upgraded-elsewhere`, `DB_UPGRADED_ELSEWHERE`.
- Plugin contoh `demo-ext` hanya di `tests/fixtures/plugins/` dan tidak pernah di `static/plugins/`.
- Setelah setiap task: `python3 -m pytest tests/ -q` hijau (1345 lama + baru, 1 skip) dan, untuk task klien, `npm test` (hanya gagal pra-ada `draw_local_reactive`).
- Commit `feat(plugin)`, `feat(sync)`, `feat(offline)`, `test(plugin)`, `docs(plugin)`, `chore(release)`; atribusi commit/PR sesi. Rilis mengikuti PROTOCOL §4.

## Review Focus

1. **Autosave Live Edit bersamaan dengan `api.taskExt.set` di task yang sama** — kunci ext tidak boleh hilang walau dua `updateTask` saling mendahului (R8; tes "updateTask bersamaan" di T4).
2. **Jendela deploy** — server lama menjawab tanpa `ext` atau dengan `ext: "{}"` string: perubahan plugin tidak hilang, tidak ada loop PUT di dalam satu drain, terkirim setelah restart (R3, R10; tes T5 + E2E skenario 3).
3. **Dua task yang dibuat offline saling merujuk (A↔B)** — tidak deadlock, ref akhirnya id server di kedua task (R9; tes T5).
4. **Anggota/perangkat yang plugin-nya OFF atau masih kode lama mengedit task** — tidak pernah menghapus ext (tes server PUT tanpa `ext_patch` di T2, payload tanpa `ext_patch` di T5, tempel ulang pull di T6, E2E skenario 2).
5. **Tab lama tanpa handler menahan pembaruan** — tab baru menampilkan banner lalu jalan sendiri setelah tab lama ditutup; tab berkode 1a-1 menutup koneksi, menolak `openDB` berikutnya, dan menawarkan muat ulang (R12; tes T7 + E2E skenario 6).

---

### Task 1: Spec di repo + `task_ext.py` (murni) + izin di `plugin_loader`

**Files:**
- Create: `docs/superpowers/specs/2026-10-31-plugin-fase1-timeline-design.md` (salinan persis `/home/claude/alurik-specs/spec-plugin-fase1-timeline-2026-10-31.md`), `task_ext.py`, `tests/fixtures/taskext_vectors.json`, `tests/test_task_ext.py` (bagian unit)
- Modify: `plugin_loader.py` (`_read_index :72–82`, `load_known`, `refresh_known`, `PENDING_HOOKS :45`, `_reset_for_tests`), `tests/fixtures/plugins/index.json` (+ `{"id": "demo-ext", "defaultEnabled": false, "permissions": ["task.ext"]}`), `tests/test_plugin_loader.py:124` (R5)

**Interfaces (Produces):**
- `plugin_loader.permissions(pid: str) -> frozenset[str]`, `plugin_loader.ext_namespaces() -> frozenset[str]` (id berizin `"task.ext"`); `_read_index` → `(known, perms)`; `known()` tetap `{id: {"defaultEnabled": bool}}`.
- `task_ext`: `KEY_RE`, `PLUGIN_MAX_BYTES = 4096`, `TOTAL_MAX_BYTES = 16384`; `class ExtError(Exception)` dengan `code`, `key`, `detail -> {"code": code, "key": key}`; `dumps(obj) -> str` (ringkas, `ensure_ascii=False`); `ensure_schema(conn) -> bool` (True bila menambah kolom; tabel `tasks` tidak ada → False, tanpa error; tanpa commit); `parse(raw) -> dict` (bukan JSON objek → `{}`); `clean_patch(patch: dict, *, allow_null: bool) -> dict` (urut: bentuk kunci → `EXT_INVALID`; ref → `EXT_TASK_REF`; namespace R4; `allow_null=False` membuang nilai `null`); `apply_patch(old_raw: str | None, patch: dict) -> str` (`null` menghapus kunci; ukuran per namespace lalu total → `EXT_TOO_LARGE` dengan `key` = namespace / `None`); `_reset_for_tests()`.
- `taskext_vectors.json`: `{"keys": {"valid": [...], "invalid": [...]}, "refs": [{"value": …, "server": "ok" | "EXT_TASK_REF", "client": "ok" | "EXT_TASK_REF"}], "sizes": [{"ext": {...}, "error": null | "EXT_TOO_LARGE", "key": …}]}` — dibaca juga T3.

- [ ] **Step 0: Commit spec** `docs(plugin): spec Fase 1 Timeline (disetujui 2026-10-31)` (isi sama persis dengan Project).
- [ ] **Step 1: Tulis tes gagal** `tests/test_task_ext.py` (unit; fixture `demo_index` = `plugin_loader.load_known(FIXTURES / "index.json")`, teardown `plugin_loader.load_known()` + `task_ext._reset_for_tests()`):
  - `test_vectors_keys_refs_sizes`: setiap vektor menghasilkan error/`ok` yang tertulis (sisi `server`).
  - `test_ensure_schema_idempotent`: DB `dbconn.connect` + `CREATE TABLE tasks (id INTEGER PRIMARY KEY, title TEXT)` + 1 baris → `ensure_schema` True lalu False; kolom `ext` `notnull=1`, `dflt_value="'{}'"`; baris lama `ext == '{}'`; DB tanpa `tasks` → False.
  - `test_apply_patch_per_key`: `apply_patch('{"demo-ext.a":1,"x-plug.k":2}', {"demo-ext.b": 3, "demo-ext.a": None})` → `{"x-plug.k": 2, "demo-ext.b": 3}`; `old_raw` rusak/`None` → mulai `{}`.
  - `test_size_limits`: nilai sehingga satu namespace = 4096 byte lolos, 4097 → `EXT_TOO_LARGE` key `"demo-ext"`; lima namespace @ ±3,5 KB → `EXT_TOO_LARGE` key `None`; huruf non-ASCII dihitung byte UTF-8.
  - `test_clean_patch_unknown_namespace_dropped_once_warned`: `{"demo-ext.a": 1, "lain-plugin.b": 2}` → hanya `demo-ext.a`; `caplog` tepat satu `WARNING` memuat `lain-plugin` setelah dua panggilan; `refresh_known` dipanggil (monkeypatch penghitung).
  - `test_clean_patch_fail_open_when_index_broken`: `monkeypatch.setattr(plugin_loader, "_index_ok", False)` + `_known = {}` → kunci berbentuk sah diterima.
  - `test_refs`: `{"$task": 12}` ok; `{"$task": "uuid"}`, `{"$task": True}`, `{"$task": 1, "x": 2}`, `{"$task": 1.5}` di kedalaman mana pun (list/dict) → `EXT_TASK_REF` dengan `key` = kunci ext.
  - `test_allow_null`: `clean_patch({"demo-ext.a": None}, allow_null=False) == {}`; `allow_null=True` mempertahankan `None`.
  - `test_plugin_loader_permissions`: fixture → `ext_namespaces() == {"demo-ext"}`, `permissions("demo-server") == frozenset()`, `known()["demo-server"] == {"defaultEnabled": False}`; indeks rusak → `ext_namespaces() == frozenset()`.
- [ ] **Step 2: Jalankan → FAIL** `python3 -m pytest tests/test_task_ext.py -q` (`ModuleNotFoundError: task_ext`).
- [ ] **Step 3: Implementasi** `task_ext.py`, perubahan `plugin_loader.py`, fixture, vektor, parameter tes R5.
- [ ] **Step 4: Jalankan → PASS**; `python3 -m pytest tests/test_plugin_loader.py tests/test_dbconn_callsites.py tests/ -q` hijau.
- [ ] **Step 5: Commit** `feat(plugin): task_ext — validasi dan patch per kunci ext; izin plugin dari index.json`

### Task 2: `webapp.py` — kolom, POST/PUT, respons, K6

**Files:**
- Modify: `webapp.py` (`import task_ext` di blok import plugin `:146–148`; `migrate_db` satu baris setelah `:969` (R1); `TaskCreate :1216`; `TaskUpdate :1244`; `task_row_to_dict :1513`; `create_task :2350–2482`; `update_task :2525–2676`)
- Test: `tests/test_task_ext.py` (bagian HTTP lewat `client` conftest; pola `tests/test_task_update_notify_coalesce.py` — `U`, `_mk_list`, `_rows` dari `test_direct_messages`)

**Interfaces:**
- Consumes: Task 1 `task_ext.*`.
- Produces: `TaskCreate.ext: Optional[dict] = None`; `TaskUpdate.ext_patch: Optional[dict] = None`; `_ext_422(e: task_ext.ExtError) -> HTTPException`; `_core_changed(updates: dict, existing, req: TaskUpdate) -> bool` (R6); `task_row_to_dict(...)["ext"]` selalu `dict`.

- [ ] **Step 1: Tulis tes gagal** (fixture `demo_index` dari Task 1):
  - `test_post_with_ext_and_get_returns_object`: `POST {"title": "a", "ext": {"demo-ext.note": "hai", "demo-ext.gone": null, "asing-plug.k": 1}}` → `ext == {"demo-ext.note": "hai"}`; `GET /api/tasks/{id}` dan `GET /api/tasks?include_done=true` memuat `ext` objek; task tanpa ext → `{}`.
  - `test_put_patch_per_key_two_devices`: PUT `{"title": "a", "ext_patch": {"demo-ext.a": 1}}` lalu PUT `{"title": "a", "ext_patch": {"demo-ext.b": 2}}` → ext `{a, b}`; PUT `{"ext_patch": {"demo-ext.a": null}}` → hanya `b`.
  - `test_put_without_ext_patch_keeps_ext`: payload penuh gaya klien (`title, description, priority, project, context, deadline: "", gtd_status, waiting_for, assigned_to: null, progress, is_focused, recurrence_type: null, recurrence_days: null`) tanpa `ext_patch` → ext tetap.
  - `test_put_ext_only_counts_as_update`: `{"ext_patch": {"demo-ext.a": 1}}` → 200 (bukan 400), `updated_at` naik; `{"ext_patch": {"asing-plug.a": 1}}` saja → 200, ext tidak berubah.
  - `test_ext_422_codes`: kunci `"Bad.key"` → `{"code": "EXT_INVALID", "key": "Bad.key"}`; `$task` string → `EXT_TASK_REF`; > 4096 → `EXT_TOO_LARGE` key `"demo-ext"`; PUT gagal ukuran tidak mengubah field lain di permintaan yang sama (rollback; judul tetap lama); `ext_patch: []` → 422.
  - `test_post_idempotent_retry_returns_ext`: POST dua kali `client_id` sama → baris sama, ext sama.
  - `test_corrupt_ext_in_db_reads_empty_and_patch_recovers`: `UPDATE tasks SET ext='rusak'` langsung → GET `{}`; PUT `ext_patch {"demo-ext.a": 1}` → `{"demo-ext.a": 1}`.
  - `test_ext_only_put_no_workspace_notification`: workspace a+b; `_put(a, tid, **payload_penuh_sama, ext_patch={"demo-ext.a": 1})` → `_updates(b.id, tid) == []`; task `done` (payload `gtd_status: "done"`) + ext saja → tetap tanpa notifikasi; `_backdate` lalu PUT `priority` berubah + `ext_patch` → tepat satu notifikasi; PUT tanpa `ext_patch` dan tanpa perubahan → perilaku lama (satu notifikasi).
  - `test_old_client_payload_ignored_fields`: PUT berisi `ext` (bukan `ext_patch`) → diabaikan, ext tetap.
  - `test_migrate_db_adds_ext_idempotent(monkeypatch, tmp_path)`: pola `tests/test_sync_audit_server.py:114–138` — DB lama dengan tabel `tasks` tanpa `ext` + baris → `webapp.migrate_db()` ×2 → kolom ada, baris `'{}'`; AST `migrate_db`: tepat satu `task_ext.ensure_schema(conn)` setelah `email_outbox.ensure_schema(conn)` dan sebelum `plugin_loader.migrate(DB_PATH)`; `tests/test_dbconn_callsites.py` tetap lulus tanpa diubah.
- [ ] **Step 2: Jalankan → FAIL** (422/kolom tidak ada).
- [ ] **Step 3: Implementasi** (R1, R2, R6): validasi `clean_patch` sebelum `with get_db()`; POST: `ext_json = apply_patch("{}", ext)` + kolom `ext` di INSERT (`:2450`); PUT: merge setelah `:2645`; `ext_only` membungkus blok notifikasi `:2655`.
- [ ] **Step 4: Jalankan → PASS**; `python3 -m pytest tests/ -q` hijau (termasuk `test_task_update_notify_coalesce.py`, `test_migrate_fk.py`); asap `DB_PATH=/tmp/asap.db python3 -c "import webapp; webapp.migrate_db(); webapp.migrate_db(); print('ok')"`.
- [ ] **Step 5: Commit** `feat(plugin): tasks.ext di POST/PUT /api/tasks — patch per kunci, tanpa notifikasi untuk perubahan ext saja`

### Task 3: `static/offline/taskext.js` — aturan klien

**Files:**
- Create: `static/offline/taskext.js` (UMD seperti `outbox.js`, tanpa dependensi), `tests/offline/taskext.test.js`

**Interfaces (Produces `TF.taskext`):** `KEY_RE`, `FIELD_RE = /^[a-zA-Z][a-zA-Z0-9_]{0,31}$/`, `PLUGIN_MAX_BYTES`, `TOTAL_MAX_BYTES`; `isPlainObject(v) -> boolean` (prototype `Object.prototype` atau `null`); `utf8Bytes(str) -> number`; `namespaceOf(key) -> string`; `extError(code, key) -> Error` (`message = code`, `.code`, `.key`, `.status = 422`); `checkPatch(patch, {allowNull}) -> {code, key} | null` (bukan objek → `{code: "EXT_INVALID", key: null}`; kunci; nilai harus lolos `JSON.stringify` tanpa `undefined`/fungsi; ref); `cleanNulls(patch) -> object`; `applyPatch(ext, patch) -> object` (objek baru; `ext` bukan objek → `{}`; `null` menghapus); `sizeError(ext) -> {code: "EXT_TOO_LARGE", key} | null`; `isRef(v)`; `refsIn(value) -> Array<number|string>`; `mapRefs(value, fn: (ref) => {$task}|null) -> value` (salinan dalam).

- [ ] **Step 1: Tulis tes gagal**: `"vektor bersama (sisi client)"` membaca `tests/fixtures/taskext_vectors.json`; `"applyPatch per kunci dan tidak memutasi masukan"`; `"sizeError: batas 4096/16384 byte UTF-8 sama dengan server"` (nilai yang sama dengan `test_size_limits`); `"checkPatch: undefined/fungsi/NaN-dalam-objek → EXT_INVALID"`; `"ref: angka bulat dan cid string ok; {$task: 1, x: 1}, {$task: ''}, {$task: 1.5} → EXT_TASK_REF"`; `"mapRefs mengganti ref di list/objek bersarang, null menggantikan objek ref"`; `"isPlainObject: string '{}' / array / null → false"`.
- [ ] **Step 2: Jalankan → FAIL** `node --test tests/offline/taskext.test.js`.
- [ ] **Step 3: Implementasi.**
- [ ] **Step 4: Jalankan → PASS**.
- [ ] **Step 5: Commit** `feat(offline): TF.taskext — aturan ext sama dengan server`

### Task 4: `taskrepo` + `hydrate` — `ext`/`ext_dirty`

**Files:**
- Modify: `static/offline/taskrepo.js` (`createTask :114–175`, `updateTask :177–282`, `displayFrom :81–90`; `TFtaskext` di blok require `:11–21`), `static/offline/hydrate.js` (`taskFromServer :25–44`)
- Test: `tests/offline/taskrepo_ext.test.js` (baru), `tests/offline/hydrate.test.js` (tambah kasus, asersi lama tetap)

**Interfaces:**
- Consumes: Task 3.
- Produces: `createTask(input)` — `input.ext` → `rec.ext` (nilai `null` dibuang), `rec.ext_dirty = Object.keys(rec.ext)` bila tak kosong, selalu `rec.ext` objek; `updateTask(cid, patch)` — `patch.ext_patch` (R7, R8) → reject `extError` (status 422) bila tidak valid/terlalu besar, record tidak berubah; `displayFrom(rec)` → `ext` objek; `taskFromServer(dict)` → `rec.ext` hanya bila `isPlainObject(dict.ext)` (R3), tanpa kunci `ext_dirty`.

- [ ] **Step 1: Tulis tes gagal** `taskrepo_ext.test.js`:
  - `"createTask dengan ext → rec.ext, ext_dirty, op create"`; `"createTask tanpa ext → ext {} tanpa ext_dirty"`.
  - `"updateTask ext_patch: merge per kunci, null menghapus, ext_dirty gabungan, dirty 1, rev+1, satu op update"`.
  - `"updateTask bersamaan (title + ext_patch tanpa await di antaranya) → kunci ext dan judul baru sama-sama tersimpan"` (Review Focus 1).
  - `"ext_patch terlalu besar → reject status 422 pesan EXT_TOO_LARGE, record dan outbox tidak berubah"`; `"kunci tak valid → EXT_INVALID"`; `"task terhapus → Task not found"`.
  - `"rute lokal PUT /api/tasks/:id meneruskan {ext_patch} dan mengembalikan baris berisi ext"` (lewat `taskroutes.buildTaskRouter().dispatch`).
  - `hydrate.test.js`: `"taskFromServer: ext objek disalin; ext string '{}' / tidak ada → tanpa kunci ext"`.
- [ ] **Step 2: Jalankan → FAIL**.
- [ ] **Step 3: Implementasi.**
- [ ] **Step 4: Jalankan → PASS**, `npm test`.
- [ ] **Step 5: Commit** `feat(offline): ext di record task lokal — patch per kunci, aman dari autosave bersamaan`

### Task 5: `syncpush` — `ext`/`ext_patch`, `$task`, jendela deploy

**Files:**
- Modify: `static/offline/syncpush.js` (`opCreate :479–509`, `opUpdate :511–535`, `taskAdopt :424–447`, di samping `rewriteNoteTaskLinks :330`; ekspor `:2310–2316`)
- Test: `tests/offline/syncpush_ext.test.js` (baru; `fakeTransport`/`put`/`task` pola `tests/offline/syncpush.test.js:14–41`)

**Interfaces:**
- Consumes: Task 3, Task 4 (bentuk record), `TFidmap.serverIdOf`, `pendingCreateCids`, `ensureEntityOp`, `markPushed`.
- Produces: `extPatchOf(rec) -> object | null` (murni; `{k: rec.ext[k] ?? null}` untuk `k ∈ ext_dirty`); `resolveExtRefs(obj, pending) -> Promise<{value: object, held: string[]}>` (R9); `taskAdopt(data, heldKeys = [])` (R3, R9, R10); `rewriteTaskExtRefs(cid, sid) -> Promise<number>` (jumlah record diubah; setiap record: ref → `sid`, kunci masuk `ext_dirty`, `dirty 1`, `rev+1`, `ensureEntityOp`; gagal tidak menggagalkan create). `taskToCreatePayload`/`taskToUpdatePayload` tetap murni tanpa ext (tes lama tidak berubah).

- [ ] **Step 1: Tulis tes gagal**:
  - `"PUT mengirim ext_patch hanya kunci ext_dirty; 2xx dengan ext objek → ext = ext server, ext_dirty hilang, dirty 0"`.
  - `"record tanpa ext_dirty → payload PUT tanpa kunci ext_patch"` dan `"POST tanpa ext → payload tanpa kunci ext"` (Review Focus 4).
  - `"jendela deploy: 2xx tanpa ext → ext_dirty tetap, dirty 1, satu op susulan, PUT hanya sekali di drain ini; drain kedua dengan ext objek → bersih"`; `"jendela deploy: ext '{}' (string) diperlakukan sama"` (Review Focus 2).
  - `"edit selama in-flight (rev naik) → ext_dirty tidak dibersihkan"`.
  - `"$task cid ber-server-id → dikirim angka"`; `"$task cid tanpa server id dan tanpa create antre → null"`.
  - `"op update dengan ref ke cid ber-create antre → ditahan (tanpa request); setelah create sukses di drain yang sama → drain berikut mengirim id server"`.
  - `"create saling merujuk A↔B (keduanya baru) → kedua POST terkirim tanpa kunci ref; drain berikut dua PUT dengan id server; tidak ada op tertahan"` (Review Focus 3).
  - `"rewriteTaskExtRefs mengganti {$task: cid} di task lain setelah POST sukses"`.
  - `"422 EXT_* dari server → failPermanent seperti 422 lain (sync_error)"`.
- [ ] **Step 2: Jalankan → FAIL** `node --test tests/offline/syncpush_ext.test.js`.
- [ ] **Step 3: Implementasi.**
- [ ] **Step 4: Jalankan → PASS**, `npm test` (semua `syncpush*.test.js` lama lulus tanpa diubah).
- [ ] **Step 5: Commit** `feat(sync): push ext per kunci — ext_patch, referensi $task, aman di jendela deploy`

### Task 6: `syncpull` — *only-if-sent* dan tempel ulang kunci kotor

**Files:**
- Modify: `static/offline/syncpull.js` (`fromServer :264–270`, cabang LWW `:282–291`; ekspor)
- Test: `tests/offline/syncpull_ext.test.js` (baru; pola `tests/offline/syncpull.test.js`)

**Interfaces:**
- Consumes: Task 3, Task 4 (`taskFromServer`).
- Produces: `withLocalExt(rec, localRec) -> rec` (murni: `rec` tanpa `ext` → `localRec.ext`; `localRec.ext_dirty` tak kosong → tempel `localRec.ext[k]`, salin `ext_dirty`, `dirty = 1`); `pullTasks` memakai R11; `result.extKept` (jumlah tempel ulang).

- [ ] **Step 1: Tulis tes gagal**:
  - `"server tanpa ext / ext string → ext lokal bersih dipertahankan saat field lain berubah"`.
  - `"server ext objek → diadopsi pada record bersih"`.
  - `"LWW server menang + ext_dirty: field inti = server, kunci kotor lokal ditempel di atas ext server (kunci perangkat lain ikut), dirty 1, tepat satu op update baru"` (dua perangkat menulis kunci berbeda → keduanya bertahan).
  - `"LWW lokal menang + ext_dirty: tidak berubah, op tetap"`.
  - `"tanpa ext_dirty: perilaku lama persis (dropOutbox, dirty 0)"`.
  - `"record dirty tanpa op (jendela deploy) → diantre ulang oleh requeueDirtyWithoutOps, tidak ditimpa"`.
- [ ] **Step 2: Jalankan → FAIL**.
- [ ] **Step 3: Implementasi.**
- [ ] **Step 4: Jalankan → PASS**, `npm test`.
- [ ] **Step 5: Commit** `feat(sync): pull task mempertahankan ext yang belum terkirim`

### Task 7: `db.js` `versionchange`/`blocked` + banner `dbupgrade.js`

**Files:**
- Modify: `static/offline/db.js` (`openDB :101–126`, `_reset :172`, ekspor; komentar di `DB_VERSION :12`)
- Create: `static/offline/dbupgrade.js`, `tests/offline/db_versionchange.test.js`, `tests/offline/dbupgrade.test.js`

**Interfaces (Produces):**
- `TF.db`: `UPGRADED_ELSEWHERE = "DB_UPGRADED_ELSEWHERE"`; `subscribe(fn: ({type: "blocked" | "unblocked" | "upgraded-elsewhere"}) => void) -> () => void`; `upgradeState() -> {blocked: boolean, upgradedElsewhere: boolean}`; perilaku R12.
- `TF.dbupgrade`: `TEXT_BLOCKED`, `TEXT_ELSEWHERE`, `RELOAD_LABEL` (R12); `bannerFor(state) -> null | {kind: "blocked" | "elsewhere", text, role: "status" | "alert", reload: boolean}` (elsewhere menang); `render(doc, spec, onReload) -> Element | null` — satu elemen `#tf-db-banner` (dibuat/diganti/dihapus), `position: fixed` atas, gaya inline `var(--bg-card)`, `var(--text-primary)`, `var(--border)`; `install(win)` — `TF.db.subscribe` + status awal + tunggu `DOMContentLoaded` bila `body` belum ada; dipanggil otomatis di browser.

- [ ] **Step 1: Tulis tes gagal**:
  - `db_versionchange`: `"koneksi modul menerima versionchange (open mentah v7) → koneksi ditutup, open mentah sukses, openDB berikutnya reject DB_UPGRADED_ELSEWHERE, event upgraded-elsewhere sekali"`; `"deleteDatabase (newVersion null) → openDB berikutnya membuka DB baru (bukan reject)"`; `"koneksi mentah v5 tanpa handler menahan upgrade → event blocked; koneksi ditutup → openDB resolve + event unblocked"` (bila `fake-indexeddb` tidak memancarkan `blocked`, tes memakai `indexedDB` palsu minimal yang memanggil `req.onblocked` — catat di laporan); `"_reset mengosongkan upgradeState"`; `"DB_VERSION tetap 6"`.
  - `dbupgrade`: `bannerFor` untuk tiga status (teks persis R12); `render` dengan `document` palsu minimal (`createElement`, `getElementById`, `body.appendChild`, `remove`): blocked → `role="status"` tanpa tombol; elsewhere → `role="alert"` + tombol `"Muat ulang"` memanggil `onReload`; `null` → elemen dihapus; `"tidak memakai localStorage/innerHTML"` (regex sumber).
- [ ] **Step 2: Jalankan → FAIL**.
- [ ] **Step 3: Implementasi.**
- [ ] **Step 4: Jalankan → PASS**, `npm test` (`db.test.js`, `user_session_isolation.test.js`, `chatdb.test.js` lama lulus).
- [ ] **Step 5: Commit** `fix(offline): tab lain menahan pembaruan — tutup koneksi saat versionchange, banner blocked (S12)`

### Task 8: `compile.js` — `contributes`, `taskExt`, `parts` + plugin contoh `demo-ext`

**Files:**
- Modify: `compile.js` (`MANIFEST_FIELDS :88`, `readManifest :113–128`, `buildOne :130–170`)
- Create: `tests/fixtures/plugins/demo-ext/manifest.json`, `plugin.jsx`, `util.js`
- Test: `tests/build-plugins.test.js`

**Interfaces (Produces):** `OPTIONAL_FIELDS = ["contributes", "taskExt"]` (disalin bila ada, R13); `validateContributes(m) -> string | null` (alasan); `ICON_PATH_RE = /^[MmLlHhVvCcSsQqTtAaZz0-9.,\- ]+$/`, batas 2048 byte. Aturan `contributes`: kunci ⊆ `slots` ∩ {`taskList.views`, `taskDetail.sections`}; `taskList.views` item `{id: ^[a-z][a-z0-9-]{0,31}$ unik, label: 1–40 karakter, icon: {path}, pages: subset tak kosong ["project","workspace"]}`; `taskDetail.sections` item `{id, label, order?: number}`. `demo-ext` manifest: `{"id": "demo-ext", "name": "Demo Ext", "description": "Plugin contoh khusus tes (tidak dirilis).", "version": "1.0.0", "minApi": 1, "defaultEnabled": false, "slots": ["taskList.views", "taskDetail.sections"], "permissions": ["task.ext"], "contributes": {"taskList.views": [{"id": "board", "label": "Demo", "icon": {"path": "M2 4h12M2 8h12M2 12h8"}, "pages": ["project", "workspace"]}], "taskDetail.sections": [{"id": "note", "label": "Catatan demo", "order": 10}]}, "taskExt": {"keys": ["note", "after"]}, "parts": ["util.js"]}`; `util.js` menulis `root.__demoExt = {label(t)}` (UMD, `module.exports` di Node); `plugin.jsx` mendaftarkan view `board` (daftar `context.tasks`: judul + `api.taskExt.read(t).note`, klik → `context.onTaskClick(t)`) dan seksi `note` (input + tombol "Simpan" → `api.taskExt.set(task.id, {note})`).

- [ ] **Step 1: Tulis tes gagal** di `tests/build-plugins.test.js`:
  - `"fixture demo-ext: parts digabung sebelum kode plugin.jsx, contributes + taskExt ada di index.json dan konstanta manifest, parts tidak"` (bangun salinan `tests/fixtures/plugins/demo-ext` ke tmp).
  - `"util.js bisa di-require Node (fungsi murni teruji terpisah)"`.
  - `"parts: berkas hilang / nama ../x.js / plugin.js / duplikat → PluginBuildError"`.
  - `"contributes: slot tidak di slots, pages kosong/asing, icon.path berisi '<' atau > 2048 byte, id view ganda → error"`.
  - `"task.ext tanpa taskExt / taskExt tanpa izin task.ext → error"`.
  - `"habit-heatmap: index.json dan hash tidak berubah"` (bangun `static/plugins` nyata ke tmp, bandingkan entri dengan `static/plugins/index.json`).
- [ ] **Step 2: Jalankan → FAIL** `node --test tests/build-plugins.test.js`.
- [ ] **Step 3: Implementasi.**
- [ ] **Step 4: Jalankan → PASS**; `node compile.js --plugins-only` dua kali → `git status` bersih.
- [ ] **Step 5: Commit** `feat(plugin): compile.js — contributes, taskExt, parts; plugin contoh demo-ext`

### Task 9: Runtime — slot baru, izin `task.ext`, tombol view, `TF.SlotView`

**Files:**
- Modify: `static/plugin-runtime.js` (`KNOWN_SLOTS/KNOWN_PERMISSIONS/RESERVED_PERMISSIONS :19–21`, `validateManifest :220–240`, `SLOT_CLASS :1053`, ekspor `:1108–1137`; `NODE_PATHS` + `taskext`)
- Test: `tests/offline/plugin_slot_views.test.js` (baru; React UMD + dispatcher palsu `plugin_slot.test.js:25–43`), `tests/offline/plugin_registry.test.js` (R18)

**Interfaces:**
- Consumes: Task 8 (bentuk `contributes` di entri indeks).
- Produces: konstanta R18; `validateManifest` + aturan `contributes`/`taskExt` (sama dengan `compile.js`); `plugins.pageKindOf(page) -> "project" | "workspace" | null`; `plugins.viewsFor(kind) -> [{pluginId, id, label, icon: {path}}]` (entri indeks, plugin `isEnabled`, item tak valid dilewati, urut `pluginId` lalu urutan manifest); `plugins.useViews(kind)` (hook: berlangganan `plugins.ready/changed/loaded`, mengembalikan `viewsFor`); `SlotView({name, pluginId, viewId, label, context, onFallback})` → `TF.SlotView`: `useMemo(() => Object.freeze({...context}), [context])`; `load(pluginId)` di effect; status memuat → `div[role=status]` `"Memuat {label}…"`; gagal muat / kontribusi `{id: viewId}` tidak ada → `"{label} tidak bisa dimuat"` + `button` `"Kembali ke Normal"` → `onFallback()`; siap → `div.tf-plugin-view[data-plugin-view="<pluginId>:<viewId>"]` berisi `PluginBoundary` › komponen `{context, api: api.for(pluginId)}`; plugin tidak `isEnabled` → `null`. `PluginIcon({path, size = 16})` → `TF.PluginIcon` (`svg viewBox 0 0 16 16`, `stroke="currentColor"`, `fill="none"`, `aria-hidden`). `SLOT_CLASS["taskDetail.sections"] = "td-plugin-sections"`.

- [ ] **Step 1: Ubah tes lama (R18) dan tulis tes gagal** `plugin_slot_views.test.js` (indeks berisi `demo-ext` dari manifest Task 8 + `habit-heatmap`):
  - `"viewsFor: hanya plugin ON, sesuai pages; Inbox (null) kosong; tanpa memuat kode plugin (inject tidak dipanggil)"`.
  - `"viewsFor: item tak valid (icon.path '<script', pages asing) dilewati"`; `"plugin diredam / OFF → tidak ada tombol"`.
  - `"SlotView: sebelum load → Memuat Demo…; effect memanggil load sekali"`; `"register → komponen dalam PluginBoundary dengan context beku, identitas context sama untuk props context yang sama"`; `"load gagal → Demo tidak bisa dimuat + Kembali ke Normal memanggil onFallback"`; `"register tanpa view board → tidak bisa dimuat"`.
  - `"Slot taskDetail.sections → wadah td-plugin-sections; tanpa kontribusi → null"`.
  - `"validateManifest: contributes/taskExt salah → alasan; task.ext kini izin dikenal"`.
  - `"pageKindOf: proj_x → project, slist_3 → workspace, inbox/today → null"`.
- [ ] **Step 2: Jalankan → FAIL** `node --test tests/offline/plugin_*.test.js`.
- [ ] **Step 3: Implementasi.**
- [ ] **Step 4: Jalankan → PASS**, `npm test`.
- [ ] **Step 5: Commit** `feat(plugin): slot taskList.views dan taskDetail.sections — tombol view dari indeks, TF.SlotView`

### Task 10: Runtime — `api.taskExt`

**Files:**
- Modify: `static/plugin-runtime.js` (`api.for :1012–1027`, `bindHost :538`)
- Test: `tests/offline/plugin_taskext_api.test.js` (baru)

**Interfaces:**
- Consumes: Task 3 (`checkPatch`, `FIELD_RE`), Task 9 (manifest `taskExt`), binding host `updateTaskExt(id, prefixedPatch) -> Promise<row>`, `patchTaskExt(id, prefixedPatch)`, `refreshTasks()`.
- Produces: `api.for(id).taskExt = {read(task) -> object, set(taskId, patch) -> Promise<row>, setMany([{taskId, patch}]) -> Promise<row[]>, ref(task) -> {$task: task.id}}` (R14); setelah `set` sukses dan di akhir `setMany`: `refreshTasks()` + `window` `taskUpdated {taskId}` (satu kali; `setMany` `{taskIds}`).

- [ ] **Step 1: Tulis tes gagal** (stub binding mencatat panggilan):
  - `"read: hanya kunci namespace sendiri tanpa prefiks; task tanpa ext → {}"`; `"ref(task) → {$task: id}"`.
  - `"set: prefiks otomatis, null diteruskan, patchTaskExt sebelum updateTaskExt, satu refreshTasks"`.
  - `"set: field tidak di taskExt.keys / pola salah / nilai fungsi / ref rusak → PluginStorageError tanpa memanggil host"`.
  - `"set: host 422 EXT_TOO_LARGE → PluginStorageError; 'Task not found' → Error yang sama; gagal → refreshTasks dipanggil"`.
  - `"setMany 20 item → 20 updateTaskExt berurutan, satu refreshTasks, satu taskUpdated; gagal di item 3 → item 1–2 tersimpan, reject, tetap satu refreshTasks"`.
  - `"tanpa izin task.ext → PluginPermissionError untuk read/set/setMany/ref, failures(id) bertambah"`.
- [ ] **Step 2: Jalankan → FAIL**.
- [ ] **Step 3: Implementasi.**
- [ ] **Step 4: Jalankan → PASS**, `npm test`.
- [ ] **Step 5: Commit** `feat(plugin): TF.api.taskExt — read/set/setMany/ref, izin task.ext`

### Task 11: Sambungan host `index.html` + SW `STATIC`

**Files:**
- Modify: `static/index.html` (`<script>` setelah `db.js :309`; `kanbanDonePool :17567–17579`; `TaskListView :19117` — state view `:19167–19198`, tombol setelah Kanban `:19632–19646`, cabang render sebelum `kanbanOn ?` `:19832`; `TaskDetailBody` antara `td-desc-wrap` dan `DetailTabs` `:10411`; `bindHost :43568`; label izin `:27207`), `static/sw.js` (`STATIC` setelah `"/static/offline/db.js",` `:21`)
- Test: `tests/offline/plugin_host_wiring.test.js`, `tests/offline/plugin_settings_ui.test.js`

**Interfaces:**
- Consumes: Task 3, 7, 9, 10.
- Produces (teks yang diperiksa tes):
  - `<script src="/static/offline/taskext.js"></script>` dan `<script src="/static/offline/dbupgrade.js"></script>` tepat setelah `db.js`, sebelum `taskrepo.js`/`hydrate.js`/`syncpush.js`; keduanya di `STATIC`.
  - `function pageScopePred(page)` (predikat halaman dari `kanbanDonePool`, yang kini memanggilnya).
  - Di `TaskListView`: `const pageKind = window.TF?.plugins?.pageKindOf?.(page) ?? null;`, `const extViews = window.TF?.plugins?.useViews ? window.TF.plugins.useViews(pageKind) : [];`, state `extPick` dibaca/ditulis `"tf_viewmode_ext:" + page` (try/catch, dibaca ulang saat `page` berubah), `extView` = item `extViews` yang `pluginId + ":" + id === extPick` atau `null`; `handleViewMode` menghapus kunci per halaman; tombol `tl-view-btn` per `extViews` (`TF.PluginIcon`, `aria-label`/`title` = label, `aria-pressed`); tombol inti `aria-pressed` false saat `extView`.
  - Cabang render: `extView ? React.createElement(window.TF.SlotView, { name: "taskList.views", pluginId, viewId, label, context: extCtx, onFallback: () => handleViewMode("normal") }) : kanbanOn ? …` di dalam `liveWrap`.
  - `extCtx` = `React.useMemo` R16 dengan kunci `{page, pageKind, listId, projectName, tasks, scopeTasks, collaborators, currentUser, onTaskClick, isSelected, liveEdit, showToast}`; `scopeTasks` = `allTasks` non-`archived` yang lolos `pageScopePred(page)` lalu `applyPanelFilters`.
  - `TaskDetailBody`: `window.TF?.Slot && React.createElement(window.TF.Slot, { name: "taskDetail.sections", context: tdPluginCtx })` dengan `tdPluginCtx = React.useMemo(…, [task, variant, collaborators, onOpenTask])` (R15).
  - `bindHost({… , updateTaskExt: (id, p) => api.put(\`/api/tasks/${id}\`, { ext_patch: p }), patchTaskExt: (id, p) => setTasks(prev => prev.map(t => t.id === id ? { ...t, ext: window.TF.taskext.applyPatch(t.ext, p) } : t)), refreshTasks: () => window.__refreshTasks?.() })` di baris yang sama.
  - Label izin R20.

- [ ] **Step 1: Tulis tes gagal**:
  - `plugin_host_wiring`: `BASELINE_LINES = 46095` (R17); urutan/keunikan dua `<script>` + `STATIC`; `kanbanDonePool` memanggil `pageScopePred(`; di `fnSource("TaskListView")`: `useViews(`, `"tf_viewmode_ext:"`, `TF.SlotView`, `"taskList.views"`, `onFallback`, `useMemo` yang deps-nya **tidak** memuat `filtered`, cabang `extView ?` muncul sebelum `kanbanOn ?` di dalam `liveWrap(`; `localStorage.setItem("tf_viewmode"` tetap hanya di `handleViewMode` dan efek reset Kanban; di `fnSource("TaskDetailBody")`: `"taskDetail.sections"` setelah `td-desc-wrap` dan sebelum `DetailTabs`; `bindHost` memuat tiga kunci baru.
  - `plugin_settings_ui`: label `"Menyimpan data tambahan di task (ikut tersinkron)"`.
- [ ] **Step 2: Jalankan → FAIL**.
- [ ] **Step 3: Implementasi** (edit langsung `index.html` terkompilasi, gaya `React.createElement`/`/*#__PURE__*/` seperti sekitarnya; baris panjang diperbolehkan).
- [ ] **Step 4: Jalankan → PASS**: `npm test`, `python3 -m pytest tests/test_plugins_node.py tests/test_sw_precache_node.py tests/test_taskdetail_node.py tests/test_liveedit_node.py -q`, `node temporary_files/check_inline_scripts.js static/index.html` (6/6 OK), `wc -l static/index.html` ≤ 46130.
- [ ] **Step 5: Commit** `feat(plugin): sambungkan view plugin, seksi detail, api.taskExt, dan banner DB ke host`

### Task 12: Rilis — SW v491, whatsnew `silent`, README, ADR-040, pola tes CI

**Files:**
- Modify: `static/sw.js` (`CACHE`), `static/index.html` (`__SW_VERSION :270` + fallback `:27985`), 28 file `static/`+`tests/` bervers lama (sed **kecuali** `static/whatsnew.json`), `static/whatsnew.json`, `tests/test_plugins_node.py`, `docs/plugins/README.md`, `.agents/DECISIONS.md`

- [ ] **Step 1: Versi** `taskflow-v490-plugin-akun` → `taskflow-v491-plugin-ext` (R19); `app.css?v=382` tetap.
- [ ] **Step 2: whatsnew** entri teratas `{"version": "taskflow-v491-plugin-ext", "date": "<tanggal rilis WIB>", "silent": true}`.
- [ ] **Step 3: `tests/test_plugins_node.py`**: `PATTERNS` += `taskext*.test.js`, `taskrepo_ext.test.js`, `syncpush_ext.test.js`, `syncpull_ext.test.js`, `db_versionchange.test.js`, `dbupgrade*.test.js`; `REQUIRED` += `"plugin_slot_views", "plugin_taskext_api", "taskext", "taskrepo_ext", "syncpush_ext", "syncpull_ext", "db_versionchange", "dbupgrade"`.
- [ ] **Step 4: README** judul "(Fase 0a–1a)"; §2 `parts`; §3 izin `task.ext` + `taskExt.keys` + `contributes` (contoh `demo-ext`); §5 `api.taskExt` (patch per kunci, namespace sendiri, ext plugin lain terlihat tetapi "baca saja", batas 4/16 KB, `$task` + `ref`, `setMany` untuk seret massal, pengguna lewat `api.env.userId`); §6 dua slot baru (tombol dari indeks tanpa memuat kode, `tf_viewmode_ext:<page>`, context, gagal muat → "Kembali ke Normal"); §8 "jangan menulis kolom task lain"; §11 server menyimpan izin, namespace asing dibuang, restart dua layanan.
- [ ] **Step 5: ADR-040** "Field plugin di task (`tasks.ext`) dengan patch per kunci, slot view/detail, handler `versionchange`" (Date / Agent / Context / Decision / Consequences, format ADR-039): Context (push task mengirim record penuh `syncpush.js:124–145`, pull LWW satu record, notifikasi tiap PUT workspace, S12 audit `2026-10-15-offline-sync-audit.md:120`); Decision (K4–K7, K12, K13, K2 + R1–R4, R8–R12); Consequences (patch hanya membatasi tabrakan ke kunci yang sama; ext ikut tarik penuh `GET /api/tasks`; banner hanya untuk tab berkode ≥ 1a-1 — v7 menunggu ≥ 3 hari; `DB_VERSION` tidak pernah diturunkan; restart dua layanan; rollback = revert sebagai rilis baru + restart, kolom `ext` dibiarkan, klien lama mengabaikan string `ext`).
- [ ] **Step 6: Verifikasi** `python3 -m pytest tests/test_whatsnew.py tests/test_sw_precache_node.py tests/test_app_update_node.py -q` (PROTOCOL §4 butir 5), `npm test`, `python3 -m pytest tests/ -q`, `node compile.js` idempoten.
- [ ] **Step 7: Commit** `chore(release): SW v491 plugin-ext (silent), README task.ext dan slot, ADR-040`

### Task 13: E2E Playwright

**Files:**
- Create: `temporary_files/e2e_app_demo_ext.py` (R21), `temporary_files/e2e_plugin_fase1a1.py` (pola `temporary_files/e2e_plugin_fase0b.py`: `hd.seed`, `hd.check`, tangkapan ke `temporary_files/e2e_plugin_fase1a1/`; server dijalankan dengan modul pembungkus; tidak di CI)

**Skenario** (U1 di konteks A dan B; U2 anggota workspace W milik U1; demo-ext ON untuk U1 lewat `PUT /api/plugins/state/demo-ext`; sinkron `window.__syncNow()` lalu tunggu `__syncState.running === false`):
1. A: detail task W › seksi "Catatan demo" tampil di antara Deskripsi dan tab (modal dan panel Live Edit) → isi "hai" + Simpan → sinkron → server `ext == {"demo-ext.note": "hai"}` → B sinkron → seksi B menampilkan "hai".
2. B offline: `api.put` lokal `ext_patch {"demo-ext.after": {"$task": <id task lain>}}`; A mengganti judul task yang sama → B online + sinkron → server: judul A + kedua kunci ext. U2 (demo-ext OFF) mengganti prioritas lewat API → ext utuh. Notifikasi U2 "memperbarui task" tidak bertambah oleh langkah 1 (ext saja).
3. Jendela deploy: A `ctx.route("**/api/tasks/*", …)` meneruskan PUT lalu mengganti `ext` di respons dengan `"{}"` (string) → `ext_dirty` record tetap (baca IndexedDB) → `unroute` → sinkron → server punya kunci baru, `ext_dirty` hilang.
4. Halaman `proj_<nama>` dan `slist_<W>`: tombol "Demo" tampil **tanpa** request `plugin.js` sampai diklik → "Memuat Demo…" lalu view; reload → tetap Demo (per halaman); Inbox tanpa tombol dan `tf_viewmode` tidak berubah; klik Normal → kunci `tf_viewmode_ext:<page>` hilang; Live Edit ON + klik item view → panel detail terbuka; `plugin.js` 404 → "Demo tidak bisa dimuat" → "Kembali ke Normal".
5. Plugin OFF dari Pengaturan saat view Demo aktif → daftar kembali ke mode inti tanpa reload.
6. Dua tab: (a) konteks baru, tab app terbuka, tab kedua `indexedDB.open("taskflow-offline", 7)` mentah → tab app menampilkan "Alurik diperbarui di tab lain. Muat ulang tab ini." + tombol "Muat ulang"; (b) konteks baru, tab `/manifest.json` membuat DB v5 mentah dan menahan koneksi → tab app menampilkan "Tutup tab Alurik lain untuk menyelesaikan pembaruan" → tab pertama ditutup → banner hilang, daftar task tampil.
7. 375 px: tombol view tanpa geser horizontal halaman, banner muat; Sakura gelap: tombol dan banner terbaca; konsol tanpa error selain yang disengaja.

- [ ] **Step 1:** tulis skrip; **Step 2:** `python3 temporary_files/e2e_plugin_fase1a1.py` → semua cek lolos (catat N/N); regresi `temporary_files/e2e_plugin_fase0b.py` dan `e2e_plugin_fase0a.py` lulus.
- [ ] **Step 3: Commit** `test(plugin): E2E Fase 1 PR 1a-1 (ext per kunci, view plugin, banner DB)`

### Task 14: Verifikasi akhir, dokumen, handover, review, PR draft

**Files:** `docs/superpowers/specs/2026-10-31-plugin-fase1-timeline-design.md` (+ "### Catatan implementasi PR 1a-1 (2026-10-31)" di §2), `docs/superpowers/plans/2026-10-31-plugin-fase1-pr-1a-1.md` (salinan rencana ini), `.agents/CURRENT_STATE.md` (entri teratas), `.agents/SESSION_LOG.md` (format PROTOCOL §3.2)

- [ ] **Step 1: Verifikasi** dan catat angka: `python3 -m pytest tests/ -q` (1345 lama + baru, 1 skip; Python 3.12 bila tersedia); `npm test` (hanya `draw_local_reactive`); `node --test tests/build-plugins.test.js`; PROTOCOL §4 butir 5; `node temporary_files/check_inline_scripts.js static/index.html`; `node compile.js` dua kali tanpa diff; `git diff --stat origin/main -- static/app.css static/plugins` kosong; `grep -n "DB_VERSION = 6" static/offline/db.js`; `wc -l static/index.html` ≤ 46130; `git diff origin/main -- 'tests/*.py' 'tests/offline/*.js'` hanya file baru + perubahan R18 + `test_plugins_node.py` + `hydrate.test.js`/`build-plugins.test.js` (penambahan saja); asap `migrate_db` ×2 dan `import bot`.
- [ ] **Step 2: Dokumen:** catatan implementasi di spec repo (R1–R4, R6–R10, R12–R16 ringkas, plus "1a-2: `plugin_records.ensure_schema` boleh tetap di `plugin_loader.migrate` karena tidak dipakai jalur task") dan salinan Project `claude/spec-plugin-fase1-timeline-2026-10-31.md` lewat `project_write` (isi sama); salin rencana ke `docs/superpowers/plans/`.
- [ ] **Step 3: Handover** `CURRENT_STATE.md`: `## 🟡 Plugin Fase 1 — PR 1a-1: tasks.ext + slot view/detail + api.taskExt + perbaikan versionchange — claude/plugin-fase1-1a-1 — <tanggal> (Claude) — PR DRAFT, menunggu "merge dan deploy"`: spec/plan/ADR-040; isi; rilis SW v491 `silent`; **deploy: workflow (`git reset`, `node compile.js`, `migrate_db` menambah kolom `tasks.ext`) TIDAK me-restart → Bapak wajib `sudo systemctl restart taskflow-web taskflow`**; selama jendela deploy perubahan ext klien baru tertahan dan terkirim setelah restart (R3, R10); verifikasi pasca-deploy: `sqlite3 <db> "PRAGMA table_info(tasks)"` memuat `ext`, `GET /api/tasks` memuat `"ext": {}`, Pengaturan menampilkan SW v491; **PR 1a-2 (IndexedDB v7) tidak boleh di-merge sebelum ≥ 3 hari setelah deploy ini, dan rencana 1b direview lebih dulu (§15 Q2)**; rollback = revert sebagai rilis baru (SW bump + whatsnew `silent`) + restart, kolom dibiarkan. `SESSION_LOG.md` entri baru.
- [ ] **Step 4: Commit** `docs(agents): handover PR 1a-1 Fase 1`
- [ ] **Step 5: Review akhir oleh subagen reviewer terpisah** (Review Focus 1–5 + R1–R21; khusus: tidak ada jalur tulis task yang membangun record dari nol tanpa membawa `ext`/`ext_dirty`; `ext_patch` tidak pernah dikirim untuk record bersih; merge server dalam transaksi yang sama dengan `UPDATE`; K6 tidak membungkam notifikasi perubahan inti; `versionchange` tidak memutus tes/rute yang memanggil `_reset`; context view tidak berganti identitas tiap detik Pomodoro; tidak ada `localStorage`/`fetch(` baru di runtime; anggaran `index.html`). Perbaiki temuan wajib, ulangi Step 1.
- [ ] **Step 6: Push + PR draft** judul `Plugin Fase 1 — PR 1a-1: tasks.ext per kunci, slot view/detail, api.taskExt, perbaikan versionchange`; body: ringkasan, tabel file, R-keputusan penting, **catatan deploy: restart manual `sudo systemctl restart taskflow-web taskflow`** (web memuat `task_ext`/`webapp` baru; bot memuat `plugin_loader` baru), jeda ≥ 3 hari sebelum 1a-2, rollback, angka tes, hasil E2E; akhiri dengan atribusi sesi. Merge hanya setelah Bapak bilang "merge dan deploy"; setelah deploy sukses ingatkan restart dua layanan.
