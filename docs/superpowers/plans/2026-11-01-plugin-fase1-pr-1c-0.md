# Sistem Plugin Fase 1 — PR 1c-0: push "ext saja", `setMany` satu render, entitas record baru tanpa restart — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Perbaikan host yang wajib ada sebelum Timeline bisa menulis jadwal massal (1c-1): (K24) `api.taskExt.setMany` memperbarui state task host untuk **semua** item dalam **satu** render React (`ReactDOM.unstable_batchedUpdates`) lalu menulis lokal berurutan, dan penolakannya membawa `err.applied` (taskId yang sudah tersimpan); (K25) edit yang **hanya** mengubah `tasks.ext` dikirim sebagai PUT `{ext_patch}` **tanpa field inti**, respons PUT itu mengadopsi field inti server, dan saat tarik field inti server **selalu** menang untuk record yang tertunda hanya karena ext — sehingga perangkat dengan salinan basi (push tanpa pull lewat `schedulePush`/`__pushNow`, atau pull→push dengan LWW lokal "lebih baru") tidak lagi mengembalikan judul/status/penanggung jawab yang diubah anggota lain; seluruh penulis store `tasks` diaudit dan dikunci tes pagar; (K26) server `plugin_records` membaca ulang `index.json` sekali (dibatasi 1×/10 dtk per proses) sebelum menolak entitas record yang tidak dideklarasikan, sehingga entitas baru `project` (1c-1), `baseline` (1c-2), `resource` (1d) diterima tanpa restart. Tidak ada fitur baru yang terlihat pengguna (whatsnew `silent`); deploy butuh **restart `taskflow-web` sekali** (bot tidak).

**Architecture:** Klien: penanda "tertunda hanya karena ext" disimpan sebagai **`ext_only_rev`** (angka) di record task dan **hanya berlaku bila sama dengan `rev`** (`TF.taskext.extOnlyNow(rec)`); setiap penulis yang menaikkan `rev` tanpa mengenal penanda (kode lama di tab lain, penulis yang terlewat audit) otomatis membatalkannya, jadi kegagalan selalu jatuh ke payload penuh seperti sekarang (R1). `taskrepo.updateTask` menyetel penanda di dalam `TFdb.mutate` atas record terkini (R2). Op outbox task tetap tanpa makna payload: `syncpush.opUpdate` memutuskan bentuk payload dari record saat drain (R3–R4), membuang op untuk record yang sudah bersih tanpa request (R3), dan untuk payload ext saja mengadopsi field inti dari respons lewat kait baru `markPushed(…, adoptAny)` + `TF.hydrate.coreFromServer` (R5). `syncpull.pullTasks` memakai jalur R11 1a-1 (inti server + tempel `ext_dirty` + antre ulang) tanpa membandingkan waktu bila `extOnlyNow(localRec)` (R7). Penghapusan tag lokal dan `syncconflict` ikut aturan (R8, R10). Runtime `plugin-runtime.js` `setMany` (R11–R12). Server: `plugin_records._decl_for` (R13); `webapp.py` PUT **tidak berubah** (sudah menerima `{ext_patch}` saja sejak 1a-1, R14). `index.html` **+0 baris** (hanya string versi SW).

**Tech Stack:** Python 3.12 (CI) / 3.13 lokal, FastAPI 0.115, pydantic v2, `sqlite3` lewat `dbconn` (ADR-038), pytest; klien UMD tanpa bundler (`static/offline/*.js`), React 18.2 UMD dengan `ReactDOM.render` legacy, `node --test` + `fake-indexeddb` 6 (`tests/offline/setup.js`), Playwright (E2E manual, tidak di CI). Tidak ada dependensi baru.

**Spec:** `/home/claude/alurik-specs/spec-plugin-fase1-1c-otomatis-2026-11-01.md` (salinan Project claude.ai `claude/spec-plugin-fase1-1c-otomatis-2026-11-01.md`; **disetujui pemilik 2026-11-01 16.21 WIB**, §13 Q1–Q5 semuanya (a)). PR 1c-0 mencakup §1 kriteria 7 (bagian host: satu render, push tanpa field inti basi, tanpa endpoint baru), 11 (kompatibel ke belakang), 12 (`index.html` +0, IndexedDB v7); §2 **K22** (baris 1c-0), **K23** (tanpa endpoint batch), **K24**, **K25**, **K26**; §3 baris 1c-0 + urutan wajib; §6.2 (penilaian batch — tidak dikerjakan), **§6.3 H1–H3** + README §5 + ADR-043; §6.4 baris "B mengubah judul … A menerapkan 200 task", "Jendela deploy 1c-0", "Jendela deploy 1c-1"; §9 baris 1c-0 + pytest; §10 baris 1c-0 + rollback 1c-0; §11 R1, R2 (dicatat, tidak diselesaikan), R3, R10. Spec induk: `docs/superpowers/specs/2026-10-31-plugin-fase1-timeline-design.md` K5/K6/K7 + "Catatan implementasi PR 1a-1" (R2, R8, R10, R11), 1a-2 (D6 baca ulang indeks), 1b. ADR-040/041/042, `docs/plugins/README.md` §5, `.agents/PROTOCOL.md` §4, `CLAUDE.md`. **Bukan** cakupan: apa pun di plugin `timeline` (1c-1/1c-2; `static/plugins/` tidak berubah), endpoint batch (K23), LWW per kelompok field task di server (§11 R2), sinkron tag task dua arah (lihat R8), mengubah `api.taskExt.set` tunggal.

**Branch:** `claude/plugin-host-1c0` dari `main` ≥ `c7ee5100` (setelah #120 1a-2 dan #122 1b di-merge dan di-deploy 2026-11-01 13.35 WIB; SW `taskflow-v495-timeline`, `app.css?v=383`, IndexedDB `taskflow-offline` **v7**, 84 modul `static/offline/`, `index.html` **46.074** baris, `plugin-runtime.js` 1.635, `syncpush.js` 2.461, `syncpull.js` 2.020, `taskrepo.js` 343, `taskext.js` 182, `hydrate.js` 83, `taskroutes.js` 335, `syncconflict.js` 235, `plugin_records.py` 489, `webapp.py` 10.888). Baseline (dijalankan 2026-11-01 16.26 WIB di worktree `origin/main` `c7ee5100`, Python 3.13.18 / pytest 9.1.1 / Node 22.23.4, `node_modules` dari working tree utama lewat symlink): `python3 -m pytest tests/ -q` → **1422 passed, 1 skipped** (127 s); `npm test` → **4061 tes, 4060 lulus, 1 gagal pra-ada** (`Unified Offline Drawing Reactivity - Local Event Reactivity`, `draw_local_reactive`); `node --test tests/build-plugins.test.js` → **26/26**; tujuh berkas inti yang disentuh (`plugin_taskext_api`, `syncpush_ext`, `syncpull_ext`, `taskrepo_ext`, `syncpush`, `syncpull`, `taskrepo`) → **193/193**; PROTOCOL §4 butir 5 → **33 passed**. **Eksperimen R3** (sementara, dibatalkan): `opUpdate` membuang op untuk record `dirty 0` tanpa request → `npm test` tetap 4060/4061 (gagal yang sama), tidak ada tes lama yang bergantung pada PUT ulang record bersih. **1c-1 tidak boleh di-merge sebelum PR ini ter-deploy dan `taskflow-web` di-restart** (§3 spec, R15).

## Peta perubahan

| File | Status | Isi (Task) |
|---|---|---|
| `plugin_records.py` | ubah (~35 baris) | `DECL_REFRESH_TTL_S`, `_decl_clock`, `_decl_for(pid, decl, entities)`, pemakaian di `get_records`/`post_records`, `_reset_for_tests` (T1) |
| `tests/test_plugin_records.py` | ubah (tambah saja) | K26 (T1) |
| `tests/test_task_ext.py` | ubah (tambah saja) | regresi server PUT `{ext_patch}` saja dari anggota basi (T1) |
| `static/offline/taskext.js` | ubah (~20 baris) | `EXT_ONLY_KEY`, `isExtOnlyPatch`, `extOnlyNow`, `extOnlyNext` (T2) |
| `static/offline/hydrate.js` | ubah (~20 baris) | `coreFromServer(dict)` (field inti + turunan, only-if-sent) (T2) |
| `static/offline/taskrepo.js` | ubah (~6 baris) | penanda di `applyTo`, `deleteTask` (T2) |
| `static/offline/taskroutes.js` | ubah (~6 baris) | `DELETE /api/tasks/:id/tags/:name` membatalkan penanda (R8) (T2) |
| `static/offline/syncpush.js` | ubah (~40 baris) | `hydrateMod()` malas, `opUpdate` (record bersih → buang op; payload ext saja), `markPushed(…, adoptAny)`, `taskAdopt`, `rewriteTaskExtRefs` (T3) |
| `static/offline/syncpull.js` | ubah (~6 baris) | cabang LWW `extOnlyNow`, `withLocalExt` menyetel penanda (T4) |
| `static/offline/syncconflict.js` | ubah (1 baris) | `discard_local` menghapus penanda (T4) |
| `tests/offline/taskrepo_ext.test.js`, `syncpush_ext.test.js`, `syncpull_ext.test.js`, `taskext.test.js`, `syncconflict.test.js` | ubah (tambah saja) | T2–T4 |
| `tests/offline/taskext_only_flow.test.js` | baru | alur dua anggota (server palsu), regresi payload penuh (T5) |
| `tests/offline/taskext_writers_fence.test.js` | baru | tes pagar penulis store `tasks` (T5) |
| `static/plugin-runtime.js` | ubah (~25 baris) | `setMany` satu batch optimistis + `err.applied` (T6) |
| `tests/offline/plugin_taskext_api.test.js` | ubah (tambah saja) | K24 (T6) |
| `static/sw.js`, `static/index.html`, `static/whatsnew.json` | ubah | `CACHE`/`__SW_VERSION` + fallback v496, entri `silent` (T7) — `index.html` hanya 2 baris versi |
| `tests/test_plugins_node.py` | ubah | `REQUIRED` += `taskext_only_flow`, `taskext_writers_fence` (pola `taskext*.test.js` sudah mencakup) (T7) |
| `docs/plugins/README.md`, `.agents/DECISIONS.md` | ubah | §5 `setMany`/push ext saja, §records entitas baru, §11; ADR-043 (T7) |
| `temporary_files/e2e_plugin_fase1_1c0.py` | baru | E2E (T8) |
| `docs/superpowers/specs/2026-11-01-plugin-fase1-1c-otomatis-design.md`, `docs/superpowers/plans/2026-11-01-plugin-fase1-pr-1c-0.md`, `.agents/CURRENT_STATE.md`, `.agents/SESSION_LOG.md` | baru / ubah | salinan spec + "Catatan implementasi PR 1c-0", salinan rencana, handover (T9) |

`webapp.py`, `static/app.css`, `static/plugins/**`, `compile.js`, `plugin_loader.py`, `db.js`, `outbox.js`, `pomolog.js`: **tidak berubah**.

## Keputusan rencana (controller)

- **R1 — Penanda = `ext_only_rev` diikat ke `rev`, bukan boolean (deviasi kecil teks K25 `rec.ext_only = true`).** `TF.taskext.EXT_ONLY_KEY = "ext_only_rev"`; `extOnlyNow(rec) = !!rec && !!rec.dirty && !rec.deleted && Number.isInteger(rec.ext_only_rev) && rec.ext_only_rev === (rec.rev || 0)`. Alasan dari kode nyata: (a) tab lama (kode 1b) dan tab baru berbagi IndexedDB yang sama; `updateTask` lama menyalin record (`Object.assign({}, base)`, `taskrepo.js:234`) sehingga **boolean ikut tersalin** ke edit judul lama → tab baru akan mengirim payload ext saja dan judul itu hilang; (b) penulis yang terlewat audit (spec §11 R3). Semua penulis yang mengubah field inti menaikkan `rev` (`taskrepo.js:309`, `:333`, `syncpush.js:496`, `:723`, `index.html:8701`, `syncconflict.js:161` `keep_as_*`), jadi penanda lama otomatis tidak berlaku → payload penuh (perilaku sekarang). Record tanpa kunci (semua record lama) = payload penuh. Rollback: kode lama mengabaikan kunci ini.
- **R2 — Aturan menyetel penanda (satu fungsi, `TF.taskext.extOnlyNext(cur, patchIsExtOnly, nextRev) -> number | undefined`).** `isExtOnlyPatch(patch)` = `patch.ext_patch` objek polos **dan** setiap kunci lain bernilai `undefined` (ketat: `{ext_patch, title: null}` **bukan** ext saja → payload penuh, arah aman). Di `taskrepo.updateTask` `applyTo(base)` (di dalam `TFdb.mutate`, atas record terkini, `taskrepo.js:317–320`): `v = extOnlyNext(base, isExtOnlyPatch(patch), next.rev)`; `v === undefined` → `delete next.ext_only_rev`, selain itu `next.ext_only_rev = v`; `extOnlyNext` = `patchIsExtOnly && (!cur.dirty || extOnlyNow(cur)) ? nextRev : undefined`. Jadi: record bersih + patch ext → ext saja; record tertunda ext saja + patch ext → tetap; record tertunda dengan perubahan inti (atau record lama tanpa penanda) + patch apa pun → penuh; patch inti apa pun → penuh. `createTask`: tidak pernah menyetel (op `create` = `POST` penuh). `deleteTask`: `rev + 1` sudah membatalkan; kunci dihapus demi kebersihan.
- **R3 — Outbox dan coalescing: bentuk payload diputuskan saat kirim, bukan saat antre.** Op task `update` tidak membawa makna (`opUpdate` membaca record saat drain, `syncpush.js:631`; `outbox.js` tanpa coalescing, satu op per `updateTask`). Maka "op ext saja" **bukan** jenis op baru: op `update` biasa, dan `opUpdate` memeriksa `extOnlyNow(rec)`. **Baru:** `opUpdate` membuang op tanpa request bila `!rec.dirty` (op basi: perubahan sudah terkirim oleh op sebelumnya di drain yang sama atau sudah diadopsi pull) — tanpa ini edit ext kedua sebelum push menghasilkan PUT kedua **berpayload penuh** dari record bersih (salinan inti yang bisa basi, dan PUT tanpa `ext_patch` selalu memicu notifikasi "memperbarui task", `webapp.py:2713`). Eksperimen baseline membuktikan tidak ada tes lama yang bergantung pada PUT itu. Tabel kombinasi sebelum push (dikunci tes T3/T5):

  | Urutan edit lokal sebelum push | Penanda | Payload | Yang terkirim |
  |---|---|---|---|
  | ext | sah | `{ext_patch}` | kunci `ext_dirty` |
  | ext, ext | sah | satu `{ext_patch}` (op kedua dibuang: record bersih) | gabungan `ext_dirty` |
  | ext, inti | batal (patch inti) | penuh + `ext_patch` | inti lokal + gabungan `ext_dirty` |
  | inti, ext | tidak pernah sah (record kotor tanpa penanda) | penuh + `ext_patch` | sama |
  | PUT ext saja terbang, lalu edit inti | batal; `markPushed` melihat `rev` berubah → `dirty 1`, op susulan | lalu penuh | edit inti tidak hilang |
  | PUT ext saja terbang, lalu edit ext | tetap sah (`ext_only_rev` = `rev` baru) | lalu `{ext_patch}` | kunci baru |
  | PUT penuh terbang, lalu edit ext | `extOnlyNext`: record kotor tanpa penanda → batal | lalu penuh | sama seperti sekarang |
- **R4 — Payload ext saja.** Di `opUpdate`: `extOnly = X && X.extOnlyNow(rec) && extPatch != null && H && typeof H.coreFromServer === "function"` (`H` = `hydrateMod()` malas; modul hilang dari cache SW lama → payload penuh, arah aman). `extOnly` → `payload = { ext_patch: ext.value }` saja, **tanpa** memanggil `tagsFor`/`projectItems`/`contextItems` (tidak ada field inti, `titleWithTags` tidak dibutuhkan); kunci yang merujuk create antre (`ext.held`) → op ditahan seperti sekarang (`syncpush.js:640`). `contextHeld` tetap diperiksa lebih dulu (tidak berbahaya). Selain itu payload **persis** seperti sekarang (`taskToUpdatePayload` + `ext_patch` bila ada) — dikunci tes snapshot T5. Server menerima `{ext_patch}` saja: `if not updates and ext_patch is None → 400` (`webapp.py:2679`) tidak terpicu karena `ext_patch` bukan `None`; `ext_only` → tanpa notifikasi (`:2682`, `:2713`); `updates` = `updated_at` + `quadrant` dari baris lama; respons `task_row_to_dict(row)` memuat seluruh baris + `ext` objek. **Tidak ada perubahan server untuk PUT** (R14).
- **R5 — Respons PUT ext saja mengadopsi field inti server.** Tanpa ini K25 tidak benar: `markPushed` memajukan `base_rev` ke `updated_at` respons (`syncpush.js:388–390`), sehingga tarik berikutnya melihat `updated_at` sama dan hanya mengadopsi field turunan (`syncpull.js:342–344`) — judul anggota lain **tidak pernah** sampai ke perangkat ini. Ubah `markPushed(storeName, cid, sentRev, updatedAt, sid, adopt, adoptAny)` (parameter opsional ke-7, pemanggil lain tidak berubah): `adoptAny(next, cur, unchanged)` dipanggil **sebelum** `adopt`, terlepas dari `unchanged`. Untuk payload ext saja `opUpdate` memberi `adoptAny = (next, cur) => { if (X.extOnlyNow(cur)) Object.assign(next, H.coreFromServer(res.data)); }` — diadopsi selama tidak ada edit inti lokal sejak payload dibaca (termasuk bila `rev` naik karena edit ext lain selama terbang); ada edit inti → tidak diadopsi (edit lokal dikirim penuh berikutnya; R2 residual spec). `TF.hydrate.coreFromServer(dict)` = kunci `COPY` (`hydrate.js:18–23`) **kecuali** `created_at`, `updated_at`, hanya bila kunci ada di `dict` (only-if-sent), dengan nilai bawaan yang sama dengan `taskFromServer` (`progress`/`is_focused`/`pomodoros_done` 0, `estimated_pomodoros` 1, lainnya `null`), plus `project_ref_name`/`context_ref_name` bila `project*`/`context*` ikut. `parent_cid`, `list_id`, `client_id`, `ext` tidak disentuh (ext diurus `taskAdopt`). `rev` tidak dinaikkan (pola `taskAdopt`).
- **R6 — `taskAdopt` dan `rewriteTaskExtRefs`.** `taskAdopt` (dipanggil hanya bila `rev` tidak berubah) mulai dengan `delete next.ext_only_rev`; bila ia menandai `dirty = 1` lagi karena kunci ext tertahan (`held`) atau respons server lama tanpa `ext` objek (`syncpush.js:515–517`) → `next.ext_only_rev = next.rev || 0` (inti baru saja terkirim penuh / diadopsi, yang tertunda hanya ext). `rewriteTaskExtRefs` (`syncpush.js:483–497`) = perubahan ext teknis: penanda dihitung `extOnlyNext(cur, true, nextRev)`.
- **R7 — Pull.** Di `pullTasks` cabang `localRec.dirty && pendingTaskOps.has(cid) && base_rev != null && s.updated_at !== base_rev` (`syncpull.js:313–336`): `const serverWins = extOnlyNow(localRec) || tsEpoch(s.updated_at) > tsEpoch(localRec.updated_at)`; `serverWins` → cabang yang sudah ada (tanpa `ext_dirty` → `dropOutbox` + tulis server; dengan `ext_dirty` → jalur R11: inti server + tempel `ext_dirty` + `requeueOp`), selain itu lokal menang seperti sekarang. `result.lwwResolved` tetap dihitung. `withLocalExt` (`:33–52`), saat menempel kunci (`keys.length`) → `rec.ext_only_rev = rec.rev` (rec hasil `fromServer` sudah ber-`rev` lokal + 1, `:299`) — record hasil R11 **selalu** ext saja (intinya baru dari server), juga untuk record yang kalah LWW tanpa penanda. Server tidak berubah sejak `base_rev` → dilewati seperti sekarang (inti lokal = inti server pada `base_rev`). `adoptTaskDerived`, `write` record bersih, `backfillClientIds` tidak berubah (nilai server / bukan inti).
- **R8 — Tag: syarat spec "tanpa baris `entity_tags` kotor" diganti (deviasi, dengan bukti).** `entity_tags.dirty` hanya pernah ditulis `1` (`tagrepo.js:80`, `:127`) dan **tidak pernah dibersihkan** oleh kode mana pun (grep `entity_tags` di `static/offline/`: hanya `tagrepo.js`, `db.js`, `notequery.js` baca) → syarat harfiah mematikan K25 **selamanya** untuk setiap task yang pernah diberi tag di perangkat ini. Faktanya: tambah tag task hanya lewat `title` (`taskrepo.js:224–229`, `:322`) → patch bukan ext saja → penanda batal. Hapus tag (rute lokal `DELETE /api/tasks/:id/tags/:name`, `taskroutes.js:301–302`, **tanpa op**; hari ini menumpang PUT penuh berikutnya lewat `titleWithTags`) → setelah `removeEntityTag`, `TFdb.mutate("tasks", cid, cur => extOnlyNow(cur) ? {...cur, rev: cur.rev + 1} : undefined)`: record tertunda ext saja menjadi penuh (dan PUT ext saja yang sedang terbang tidak membersihkannya, karena `rev` berubah). Record bersih: tetap seperti sekarang (menumpang PUT **penuh** berikutnya) — dengan K25 penumpang itu bisa tertunda sampai edit inti berikutnya. Dicatat sebagai residual (utang pra-ada: pull task tidak pernah menarik tag; PUT penuh dari perangkat tanpa tag lokal **menghapus** tag server, `webapp.py:2569–2574`, `:2705–2709` — K25 justru mengurangi kasus ini untuk edit ext).
- **R9 — Audit penulis store `tasks` (sumber kebenaran tes pagar T5).** Semua lokasi di `static/offline/*.js` + `static/index.html` yang menulis record task:

  | Penulis | Lokasi | Ubah inti? | `rev` | Penanganan |
  |---|---|---|---|---|
  | `createTask` | `taskrepo.js:181` | baru | 1 | tanpa penanda (op `create`) |
  | `updateTask` | `taskrepo.js:317` | ya/tidak | +1 | R2 |
  | `deleteTask` | `taskrepo.js:334` | hapus | +1 | otomatis batal; kunci dihapus |
  | hapus tag (rute) | `taskroutes.js:302` | tag | +1 bila ext saja | R8 (baru) |
  | `markPushed` (task) | `syncpush.js:381` | adopsi | tetap | R5 (`adoptAny`), unchanged → `taskAdopt` |
  | `taskAdopt` | `syncpush.js:504` | turunan server | tetap | R6 |
  | `rewriteTaskExtRefs` | `syncpush.js:483` | ext | +1 | R6 |
  | `adoptContextServerId` | `syncpush.js:718` | `context_id` | +1 | otomatis batal (memang inti) |
  | `releaseContextCid` | `syncpush.js:741` | `context_id` cid lokal → `null` | tetap | tidak perlu: server tidak pernah mengenal cid itu; teks tidak berubah |
  | `opUpdate` 404/403/4xx | `syncpush.js:653`, `accessLost`, `markSyncError` | tidak (`conflict`/`sync_error`) | tetap | tidak perlu |
  | pull `write`/`putIfUnchanged` | `syncpull.js:304`, `:327` | nilai server | lokal+1 | record baru tanpa penanda; R11 → R7 |
  | `adoptTaskDerived` | `syncpull.js:215` | turunan server | tetap | tidak perlu |
  | `deleteTask`/`remote_deleted` pull | `syncpull.js:93`, `:361` | — | — | tidak perlu |
  | `backfillClientIds` | `syncpull.js:157` | `client_id` | tetap | tidak perlu |
  | `hydrateTasks` | `hydrate.js:62` | nilai server | — | tidak perlu |
  | `pomolog.ackPushed` | `pomolog.js:71` | `pomodoros_done` (milik server) | tetap | tidak perlu |
  | `syncconflict` `retry` | `syncconflict.js:133` | tidak (perubahan tertunda yang sama dikirim ulang) | tetap | penanda dipertahankan dengan sengaja |
  | `syncconflict` `discard_local` | `syncconflict.js:146` | → bersih | tetap | R10: hapus kunci |
  | `syncconflict` `keep_as_*` | `syncconflict.js:161` | jadi entitas baru | +1 | otomatis batal |
  | `applyMovedTasksLocal` | `index.html:8690` | nilai server (pindah workspace) | +1 | otomatis batal (tanpa ubah `index.html`) |
- **R10 — `syncconflict`.** `discard_local` (`syncconflict.js:146`) ikut `delete next.ext_only_rev` (kebersihan; record bersih). `retry` tidak diubah: record ber-`sync_error` yang penandanya masih sah memang hanya berisi perubahan ext (mis. 422 `EXT_TOO_LARGE`), "Coba lagi" mengirimnya ulang sebagai ext saja.
- **R11 — K24 `setMany` (`plugin-runtime.js:1292–1312`).** Setelah validasi semua item (tidak berubah): `batch = root.ReactDOM && typeof root.ReactDOM.unstable_batchedUpdates === "function" ? f => root.ReactDOM.unstable_batchedUpdates(f) : f => f()`; bila `hostBinding.patchTaskExt` fungsi → `try { batch(() => { for (const it of prepared) { try { hostBinding.patchTaskExt(it.taskId, it.patch); } catch (e) { warn(…); } } }); } catch (e) { warn(…); }` — **sekali**, sebelum tulis pertama. Lalu tulis berurutan lewat `writeOnly(taskId, p)` = `write` tanpa langkah `patchTaskExt` (`:1245–1251` dipecah: `patch(taskId, p)` + `persist(taskId, p)`; `set` tunggal memanggil keduanya = perilaku lama). Berhenti pada kegagalan pertama (seperti sekarang); `finish()` = satu `refreshTasks` (mengembalikan state optimistis item yang tidak tersimpan) + satu `taskUpdated {taskIds: done}`. Host (`index.html:43547` `patchTaskExt` → `setTasks` per item) **tidak diubah**: di dalam `unstable_batchedUpdates` React 18.2 legacy menggabungkan semua `setTasks` menjadi satu render.
- **R12 — `err.applied`.** Penolakan `setMany` (setelah `mapExtError`) membawa `applied` = salinan larik `taskId` yang `persist`-nya selesai, berurutan (`[]` bila item pertama gagal). Error bukan objek → dibungkus `new Error(String(err))`. Penambahan fungsi, `TF.api.apiVersion` tetap `1`; kegagalan validasi (sebelum menulis) tidak membawa `applied`.
- **R13 — K26 server.** `plugin_records.DECL_REFRESH_TTL_S = 10.0`, `_decl_clock = time.monotonic` (bisa disuntik tes), `_last_decl_refresh: float | None`. `_decl_for(pid, decl, entities) -> dict`: `missing` = entitas yang cocok `ENTITY_RE` dan tidak ada di `decl`; kosong → `decl`; dalam TTL sejak baca ulang terakhir → `decl`; selain itu catat waktu, `plugin_loader.refresh_known()`, `logger.info("plugin_records: entitas %s belum dideklarasikan %s → baca ulang indeks", …)`, kembalikan `plugin_loader.records_decl(pid)`. `post_records`: `decl = _decl_for(pid, decl, {it.entity for it in body.items})` **sebelum** `get_conn`/`write_tx` (baca berkas tidak di dalam transaksi tulis). `get_records`: `entity is not None` → `decl = _decl_for(pid, decl, {entity})` sebelum cek 422. Nama tak sah (`Bad`, `x-y`) tidak memicu baca ulang. Plugin kehilangan izin `records` di indeks baru → `records_decl` `{}` → `INVALID entity` per item (tidak 404 di tengah permintaan; permintaan berikutnya 404 lewat `_guard`). `refresh_known` gagal → daftar lama tetap (perilaku `plugin_loader.py:131–141`). `_reset_for_tests` mengosongkan `_last_decl_refresh`. TTL terpisah dari `task_ext` (pola sama, modul berbeda).
- **R14 — Server PUT task tidak berubah.** Bukti: `webapp.py:2564–2730` + tes yang sudah ada `test_put_ext_only_counts_as_update`, `test_ext_only_put_no_workspace_notification` (`tests/test_task_ext.py:331`, `:394`). Ditambah satu tes regresi skenario K25 (T1). Karena itu jendela deploy PUT aman ke dua arah (R15).
- **R15 — Jendela deploy dan urutan.** Workflow deploy (`git reset`, `node compile.js`, `migrate_db`) **tidak me-restart**:

  | Kombinasi | Hasil |
  |---|---|
  | Klien 1c-0 + proses server lama (sebelum restart) | PUT `{ext_patch}` diterima (sejak #119), respons baris penuh + `ext` → adopsi R5 jalan; K26 belum aktif tetapi 1c-0 tidak memakai entitas baru → tanpa dampak |
  | Klien lama (tab belum diperbarui) + server baru | PUT penuh seperti sekarang; server identik untuk PUT |
  | Tab lama + tab 1c-0 di peramban yang sama (IndexedDB bersama) | tulis tab lama menaikkan `rev` → penanda batal → payload penuh (R1); tab lama tetap mengirim penuh (sama dengan hari ini, bukan regresi) |
  | 1c-1 di-deploy sebelum restart 1c-0 | `POST` record `project` → `INVALID entity` di proses lama → `plugin_sync` `markError` (op dibuang, `sync_error`) — **dilarang**: urutan wajib merge+deploy+restart 1c-0 → verifikasi (T9) → baru merge 1c-1 |
  | Rollback 1c-0 setelah 1c-1 terpasang | dilarang tanpa rollback 1c-1 dulu (1c-1 bergantung K24–K26) |

  Verifikasi pasca-restart (bukti kode baru hidup): `POST /api/plugins/timeline/records` dengan item entitas `probe` → `results[0].error == "INVALID"`, `detail == "entity"`, dan `journalctl -u taskflow-web` memuat baris "entitas … belum dideklarasikan … baca ulang indeks".
- **R16 — Rollback.** Revert sebagai rilis baru (SW bump + whatsnew `silent`) + restart `taskflow-web`. Kunci `ext_only_rev` di IndexedDB diabaikan kode lama (payload penuh lagi); op basi untuk record bersih kembali di-PUT (perilaku lama); `err.applied` hilang (belum ada pemakai sebelum 1c-1). Tidak ada data hilang, tidak ada skema berubah.
- **R17 — Rilis.** SW `taskflow-v496-sinkron-ext` (nomor berikutnya setelah `taskflow-v495-timeline` di `static/sw.js:1` `main`; bila `main` maju, PROTOCOL §4 butir 4), whatsnew `{"version", "date", "silent": true}`, `app.css?v=383` tetap, `index.html` hanya baris 270 dan 28006 (string versi) — `wc -l` tetap **46.074**, restart **`taskflow-web` saja** (bot tidak meng-import `plugin_records`; `plugin_loader` tidak berubah).
- **R18 — README + ADR-043.** README §5 `api.taskExt`: butir "Seret massal" ditulis ulang (optimistis semua item dalam satu render, tulis berurutan, berhenti pada gagal pertama, `err.applied`), butir baru "Tidak menimpa field inti" (edit yang hanya mengubah ext dikirim tanpa field inti; field inti selalu milik server/anggota terakhir yang mengubahnya; edit ext di perangkat basi tidak mengembalikan judul/status orang lain); §5 `api.records`: entitas baru di `manifest.records` diterima server tanpa restart (baca ulang indeks paling sering 1×/10 dtk; selama deploy belum selesai klien bisa menerima `INVALID entity` → `error` pada record, `put` berikutnya mencoba lagi); §11 server: "entitas record baru tidak butuh restart; modul server plugin baru tetap butuh". ADR-043 di T7.
- **R19 — Tes lama tidak diubah asersinya.** Semua `syncpush*.test.js`, `syncpull*.test.js`, `taskrepo*.test.js`, `plugin_taskext_api.test.js` (termasuk "setMany 20 item → 20 updateTaskExt berurutan" dan "gagal di item 3": `patch` tambahan tidak diperiksa urutannya di sana), `contextsync.test.js`, `cas_rev.test.js`, `syncconflict*.test.js`, `test_task_ext.py`, `test_plugin_records.py` lulus tanpa mengubah asersi. Bila satu tes lama gagal karena R3/R5/R7 → **berhenti dan laporkan** (jangan ubah asersi), karena itu berarti ada perilaku yang belum dipetakan R9.
- **R20 — E2E.** Konteks Playwright per anggota (`service_workers="block"`); "data basi" dibuat dengan `ctx.route("**/api/tasks?include_done=true*", abort)` (tarik gagal, push tetap jalan) atau `set_offline`; kontrol kepekaan tes: konteks yang memuat `static/offline/syncpush.js` dari `git show origin/main:` (pola skenario 8 rencana 1a-2) harus **mereproduksi** bug (judul tertimpa), lalu kode PR tidak. Perhitungan render React lewat `__REACT_DEVTOOLS_GLOBAL_HOOK__` palsu (`add_init_script`; React produksi memanggil `onCommitFiberRoot`).

## Global Constraints

- `index.html` **+0 baris** (46.074; hanya dua string versi SW); `app.css`/`app.css?v=383` tidak berubah; IndexedDB tetap **v7**, `db.js` tidak berubah; tidak ada modul baru di `static/offline/` (tetap 84) dan `STATIC` SW tidak berubah selain `CACHE`; `static/plugins/` tidak berubah (`node compile.js` dua kali tanpa diff, hash plugin sama); `TF.api.apiVersion` tetap `1`.
- Server: hanya `plugin_records.py`; `webapp.py`, `plugin_loader.py`, `task_ext.py` tidak berubah; tidak ada endpoint baru (K23); `plugin_records.py` tetap tanpa `sqlite3.connect` dan tanpa import `webapp`; baca ulang indeks tidak pernah di dalam `write_tx`.
- Payload PUT task untuk setiap edit yang menyentuh field inti **identik byte-per-kunci** dengan sebelum PR (snapshot T5); payload ext saja **tepat** `{"ext_patch": {...}}`.
- Penanda hanya `ext_only_rev` (angka) dan hanya dibaca lewat `TF.taskext.extOnlyNow`; tidak ada kode lain yang membandingkan `ext_only_rev` langsung (dicek tes pagar).
- Setelah setiap task: `python3 -m pytest tests/ -q` hijau (1422 lama + baru, 1 skip) dan, untuk task klien, `npm test` (hanya gagal pra-ada `draw_local_reactive`).
- Commit `feat(sync)`, `feat(plugin)`, `fix(sync)`, `test(sync)`, `test(plugin)`, `docs(plugin)`, `chore(release)`; atribusi commit/PR sesi. Rilis mengikuti PROTOCOL §4.

## Review Focus

1. **Tidak ada jalur yang mengirim payload ext saja padahal ada perubahan inti tertunda** — R1 (ikatan `rev`), R2 (patch ketat), R3 (in-flight), R8 (hapus tag), R9 (setiap penulis), tab lama berbagi IndexedDB; tes pagar T5 menolak penulis baru yang tidak ditinjau.
2. **Field inti anggota lain tidak tertimpa** di kedua jalur: push tanpa pull (`schedulePush`/`__pushNow`, `index.html:994–1003`) dan sinkron pull→push (LWW `syncpull.js:318–336`); **dan** perangkat basi akhirnya menampilkan nilai server (R5: tanpa adopsi respons, `base_rev` maju dan judul baru tidak pernah tertarik).
3. **Tidak ada edit lokal yang hilang** — coalescing tabel R3, adopsi inti hanya bila `extOnlyNow(cur)` di dalam transaksi `markPushed`, op record bersih dibuang hanya bila `dirty` 0.
4. **Edit inti normal tetap payload penuh persis** (judul, status selesai, progress, fokus, tenggat, penanggung jawab, berulang) — snapshot kunci.
5. **`setMany`** — satu `unstable_batchedUpdates`, `patchTaskExt` tepat sekali per item, `err.applied` akurat, state optimistis item gagal dikembalikan oleh satu `refreshTasks`.
6. **K26** — baca ulang dibatasi TTL, tidak dipicu nama tak sah, tidak di dalam transaksi, daftar lama bertahan saat indeks rusak.
7. **Jendela deploy + rollback** (R15–R16) dan urutan wajib sebelum 1c-1.

---

### Task 1: Server — K26 baca ulang indeks untuk entitas record baru + regresi PUT ext saja

**Files:**
- Modify: `plugin_records.py` (konstanta setelah `PURGE_INTERVAL_S :41`, `_decl_for` di samping `maybe_purge :343`, `get_records :430–474`, `post_records :477–489`, `_reset_for_tests :372–374`)
- Test: `tests/test_plugin_records.py` (tambah; pola fixture `test_refresh_known_once_before_404 :703`), `tests/test_task_ext.py` (tambah; helper `U`, `_mk_list`, `_post`, `_put`, `_updates`)

**Interfaces (Produces):** `plugin_records.DECL_REFRESH_TTL_S = 10.0`; `plugin_records._decl_clock` (callable); `plugin_records._decl_for(pid: str, decl: dict, entities: set[str]) -> dict` (R13).

- [ ] **Step 1: Tulis tes gagal** (`tests/test_plugin_records.py`; indeks tmp seperti `:703–725`, `monkeypatch` atribut `plugin_loader` + `plugin_records._decl_clock` = jam palsu, `plugin_records._reset_for_tests()` di awal):
  - `test_new_entity_after_start_accepted_without_restart`: indeks tmp `demo-records` `{note}` → POST item `memo` → `error INVALID detail entity` dan `refresh_known` terpanggil **1×**; tulis indeks dengan `{note, memo}`, majukan jam 11 s → POST `memo` → `applied True`, version 1; GET → item `memo` ada; POST `memo` lagi → tanpa baca ulang (sudah dideklarasikan).
  - `test_decl_refresh_throttled`: dua POST entitas tak dikenal dalam 10 s → `refresh_known` 1×; setelah 10 s → 2×.
  - `test_invalid_entity_name_never_refreshes`: entitas `Bad`, `a-b`, `""` → `INVALID entity`, `refresh_known` 0×.
  - `test_declared_entities_do_not_refresh`: POST/GET `note` → 0×.
  - `test_get_entity_param_refreshes_once`: GET `?entity=memo` sebelum ditambahkan → 422 `INVALID entity` + 1×; setelah ditambahkan (jam maju) → 200.
  - `test_mixed_batch_one_refresh`: satu POST `[note, memo]` setelah `memo` ditambahkan → keduanya `applied`, `seq` naik 2, `refresh_known` 1×.
  - `test_refresh_failure_keeps_old_decl`: indeks tmp diganti JSON rusak → POST `memo` → `INVALID entity`, POST `note` → `applied` (deklarasi lama bertahan), tanpa 500.
  - `test_refresh_not_inside_write_tx`: `refresh_known` palsu memeriksa `sqlite3` belum dalam transaksi (spy `dbconn.write_tx` belum dimasuki saat dipanggil).
  - `test_reset_for_tests_clears_decl_throttle`.
  - (`tests/test_task_ext.py`) `test_put_ext_patch_only_from_stale_member_keeps_core`: workspace milik A, B anggota, task T; A PUT `_full_payload(t, title="Judul A", gtd_status="done", progress=40)`; B PUT `{ext_patch: {"demo-ext.a": 1}}` → 200; respons memuat `title == "Judul A"`, `gtd_status == "done"`, `progress == 40`, `completed_at` tidak `None`, `ext == {"demo-ext.a": 1}`, `updated_at` > sebelumnya, kunci `quadrant`, `project`, `context`, `assigned_to`, `recurrence_days` ada (dibutuhkan R5); GET T dari A sama; `_updates(a.id, tid)` tidak bertambah (K6).
- [ ] **Step 2: Jalankan → FAIL** `python3 -m pytest tests/test_plugin_records.py tests/test_task_ext.py -q` (`AttributeError: _decl_clock`; tes regresi PUT sudah lulus — catat, itu bukti R14).
- [ ] **Step 3: Implementasi** (R13).
- [ ] **Step 4: Jalankan → PASS**; `python3 -m pytest tests/ -q` (1422 lama + baru, 1 skip); asap `python3 -c "import webapp, bot"`.
- [ ] **Step 5: Commit** `feat(plugin): plugin_records membaca ulang index.json untuk entitas baru (tanpa restart, 1×/10 dtk)`

### Task 2: `taskext` (penanda), `hydrate.coreFromServer`, `taskrepo`, hapus tag

**Files:**
- Modify: `static/offline/taskext.js` (fungsi baru sebelum `exported :175`, ekspor), `static/offline/hydrate.js` (`coreFromServer` setelah `taskFromServer :26–46`, ekspor `:80`), `static/offline/taskrepo.js` (`applyTo :233–315` setelah `next.rev :309`; `deleteTask :333`), `static/offline/taskroutes.js` (`:301–302`)
- Test: `tests/offline/taskext.test.js`, `tests/offline/taskrepo_ext.test.js` (tambah saja)

**Interfaces (Produces):** `TF.taskext.EXT_ONLY_KEY === "ext_only_rev"`; `isExtOnlyPatch(patch) -> boolean`; `extOnlyNow(rec) -> boolean`; `extOnlyNext(cur, patchIsExtOnly, nextRev) -> number | undefined` (R1, R2). `TF.hydrate.coreFromServer(dict) -> object` (R5). Rute lokal `DELETE /api/tasks/:id/tags/:name` hasilnya tetap `{ok: true}`.

- [ ] **Step 1: Tulis tes gagal**:
  - `taskext.test.js` `"isExtOnlyPatch: {ext_patch:{}} benar; + title/gtd_status/progress:0/is_focused:0/project_id:null/recurrence_type:null → salah; ext_patch null/array → salah; kunci lain undefined → benar"`.
  - `"extOnlyNow: dirty + ext_only_rev === rev → benar; rev beda / dirty 0 / deleted / kunci hilang / string '3' → salah; rev hilang dianggap 0"`.
  - `"extOnlyNext: bersih + ext → nextRev; kotor-ext-saja + ext → nextRev; kotor tanpa penanda + ext → undefined; patch inti → undefined"`.
  - `hydrate` (di `taskext.test.js` atau `taskrepo_ext.test.js`): `"coreFromServer: hanya kunci yang dikirim; bawaan sama dengan taskFromServer (progress null → 0, estimated_pomodoros null → 1, is_focused true tetap true); tanpa created_at/updated_at/parent/list/ext; project_ref_name/context_ref_name dihitung"`.
  - `taskrepo_ext.test.js` `"updateTask ext_patch pada record bersih → ext_only_rev = rev baru"`.
  - `"dua ext_patch berturut → penanda mengikuti rev terakhir"`.
  - `"ext_patch lalu title → penanda hilang; title lalu ext_patch → tidak pernah ada"`.
  - `"title + ext_patch dalam satu patch → tanpa penanda"`; `"{ext_patch, gtd_status:'done'} → tanpa penanda"`.
  - `"record lama kotor tanpa kunci + ext_patch → tanpa penanda (payload penuh)"`.
  - `"tulis mentah ala kode lama (rev+1, salin record termasuk ext_only_rev) → extOnlyNow false"` (bukti R1).
  - `"updateTask bersamaan (title + ext_patch tanpa await) → tanpa penanda di akhir, kedua nilai tersimpan"` (perluasan tes `:71`).
  - `"createTask dengan ext → tanpa penanda"`; `"deleteTask → kunci dihapus"`.
  - `"rute DELETE tag pada record kotor ext saja → rev+1, extOnlyNow false, ext_dirty tetap, {ok:true}; pada record bersih → record tidak berubah (rev sama)"`.
- [ ] **Step 2: Jalankan → FAIL** `node --test tests/offline/taskext.test.js tests/offline/taskrepo_ext.test.js`.
- [ ] **Step 3: Implementasi** (R1, R2, R5 bagian `coreFromServer`, R8).
- [ ] **Step 4: Jalankan → PASS**, `npm test` (semua `taskrepo*.test.js`, `tagrepo.test.js`, `tag_tasks_overlay.test.js` lulus tanpa diubah).
- [ ] **Step 5: Commit** `feat(sync): penanda ext_only_rev untuk edit task yang hanya mengubah ext`

### Task 3: `syncpush` — payload ext saja, buang op record bersih, adopsi inti dari respons

**Files:**
- Modify: `static/offline/syncpush.js` (`hydrateMod()` malas di samping `taskExtMod :45–47`; `markPushed :380–402` + parameter `adoptAny`; `rewriteTaskExtRefs :483–497`; `taskAdopt :504–538`; `opUpdate :630–660`)
- Test: `tests/offline/syncpush_ext.test.js` (tambah; server palsu `:40–72` diperluas: menyimpan field inti per baris, PUT hanya menerapkan kunci yang dikirim seperti `webapp.py`, respons baris penuh)

**Interfaces:**
- Consumes: Task 2 (`extOnlyNow`, `extOnlyNext`, `coreFromServer`).
- Produces: `markPushed(storeName, cid, sentRev, updatedAt, sid, adopt, adoptAny?)` (R5; tanpa argumen ke-7 = perilaku lama); `opUpdate` R3/R4/R5; `taskAdopt` R6.

- [ ] **Step 1: Tulis tes gagal**:
  - `"record ext saja → PUT body tepat {ext_patch: kunci ext_dirty}; tagsFor/projectItems tidak dipanggil"` (spy).
  - `"respons PUT ext saja → judul/status/progress/assigned_to/deadline server diadopsi, base_rev = updated_at respons, ext server, ext_dirty hilang, dirty 0, tanpa ext_only_rev, rev tetap"`.
  - `"PUT ext saja terbang + edit judul di dalam transport → inti TIDAK diadopsi (judul lokal baru tetap), dirty 1, satu op susulan; drain berikut → PUT penuh berjudul baru"`.
  - `"PUT ext saja terbang + edit ext lain di dalam transport → inti diadopsi, ext_dirty kunci baru tetap, penanda = rev baru; drain berikut → {ext_patch} kunci baru"`.
  - `"dua op update untuk record yang sama (dua edit ext) → satu PUT; op kedua dibuang tanpa request (record bersih)"`; `"op update untuk record dirty 0 → tanpa request, op hilang, result.pushed tidak bertambah"`.
  - `"record ext saja dengan ref ke cid ber-create antre → ditahan tanpa request (seperti sekarang)"`.
  - `"ext saja + respons tanpa ext objek (server lama, R10 1a-1) → inti diadopsi, ext_dirty tetap, dirty 1, penanda = rev, satu op susulan; drain kedua dengan ext objek → bersih"`.
  - `"modul hydrate tidak ada (stub TF.hydrate tanpa coreFromServer) → payload penuh"` (R4).
  - `"payload penuh tidak berubah: record kotor tanpa penanda dengan ext_dirty → taskToUpdatePayload + ext_patch persis seperti sebelumnya"` (perbandingan dengan fungsi yang sama dipanggil terpisah).
  - `"POST create dengan held → taskAdopt menandai dirty 1 + penanda = rev → op susulan mengirim {ext_patch}"`.
  - `"rewriteTaskExtRefs pada record bersih → penanda = rev baru; pada record kotor inti → tanpa penanda"`.
  - `"markPushed tanpa adoptAny (note/mindmap/habit) → perilaku lama"` (satu tes per store dengan record contoh).
  - `"422 EXT_* pada PUT ext saja → sync_error, penanda tetap (retry mengirim ext saja)"`.
- [ ] **Step 2: Jalankan → FAIL** `node --test tests/offline/syncpush_ext.test.js`.
- [ ] **Step 3: Implementasi** (R3, R4, R5, R6). `opUpdate`: setelah `if (rec.conflict) return;` → `if (!rec.dirty) return TFoutbox.outboxRemove(op.qid);`; cabang `extOnly` membangun payload tanpa `Promise.all([tagsOf, projectItems, contextItems])`; `markPushed("tasks", op.cid, sentRev, updatedAtOf(res), null, taskAdopt(res.data), extOnly ? adoptCore(res.data) : null)`.
- [ ] **Step 4: Jalankan → PASS**, `npm test` (semua `syncpush*.test.js`, `cas_rev.test.js`, `contextsync.test.js`, `crossdevice_links.test.js`, `mindmapsync_*`, `drawing*` lulus tanpa diubah — R19).
- [ ] **Step 5: Commit** `feat(sync): push ext saja tanpa field inti; adopsi inti dari respons; op basi dibuang`

### Task 4: `syncpull` (inti server menang untuk record ext saja) + `syncconflict`

**Files:**
- Modify: `static/offline/syncpull.js` (`withLocalExt :33–52`, `pullTasks :313–336`), `static/offline/syncconflict.js` (`discard_local :146`)
- Test: `tests/offline/syncpull_ext.test.js`, `tests/offline/syncconflict.test.js` (tambah saja)

**Interfaces:** Consumes Task 2 (`extOnlyNow` lewat `taskExtMod()`; modul tidak ada → `false` = LWW lama).

- [ ] **Step 1: Tulis tes gagal**:
  - `"record ext saja kotor + op, server berubah dengan updated_at LEBIH LAMA dari edit lokal → server menang (bukan LWW lokal): judul/status server, kunci ext_dirty ditempel di atas ext server, dirty 1, penanda = rev record baru, tepat satu op update"` (bandingkan: tes lama `:107` "LWW lokal menang" untuk record **tanpa** penanda tetap lulus).
  - `"record ext saja + server tidak berubah (updated_at = base_rev) → dilewati, op tetap"`.
  - `"record ext saja tanpa ext_dirty (kasus tepi) → dropOutbox + tulis server, bersih"`.
  - `"jalur R11 untuk record TANPA penanda yang kalah LWW → kini ber-penanda (inti dari server)"`.
  - `"tab lama menaikkan rev tanpa penanda (record kotor, ext_only_rev < rev) → LWW lama"`.
  - `"withLocalExt murni: kunci ditempel → ext_only_rev = rec.rev; tanpa kunci → tanpa penanda"`.
  - `"setelah pull R11, push → {ext_patch} saja"` (integrasi `pullTasks` → `pushOutbox` di berkas yang sama).
  - `syncconflict.test.js` `"discard_local menghapus ext_only_rev dan ext_dirty"`; `"retry mempertahankan penanda"`; `"keep_as_new → rev naik, op create"`.
- [ ] **Step 2: Jalankan → FAIL** `node --test tests/offline/syncpull_ext.test.js tests/offline/syncconflict.test.js`.
- [ ] **Step 3: Implementasi** (R7, R10).
- [ ] **Step 4: Jalankan → PASS**, `npm test` (semua `syncpull*.test.js`, `contextsync.test.js` lulus tanpa diubah).
- [ ] **Step 5: Commit** `feat(sync): tarik — field inti server menang untuk task yang tertunda hanya karena ext`

### Task 5: Tes pagar penulis store `tasks` + alur dua anggota + snapshot payload penuh

**Files:**
- Create: `tests/offline/taskext_writers_fence.test.js`, `tests/offline/taskext_only_flow.test.js`

**Interfaces:** Consumes Task 2–4. Tidak ada kode produksi baru (bila tes menemukan celah → perbaiki di modul terkait dengan commit `fix(sync)` dan catat di laporan).

- [ ] **Step 1: Tulis tes pagar** `taskext_writers_fence.test.js` (membaca teks sumber, tanpa IndexedDB):
  - Pola penulis (regex): `P_MUTATE` `/\bmutate\(\s*"tasks"/`, `P_TX` `/transaction\(\s*"tasks"\s*,\s*"readwrite"/`, `P_TX_MULTI` `/transaction\(\s*\[[^\]]*"tasks"[^\]]*\]\s*,\s*"readwrite"/`, `P_PUTIF` `/putIfUnchanged\(\s*"tasks"/`, `P_MARK` `/markPushed\(\s*"tasks"/`, `P_OP` `/(ensureEntityOp|requeueOp)\(\s*"task"|requeueIfDirty\(\s*"tasks"|entity_type:\s*"task"/`, `P_GENERIC` `/\b(patchRec|mutate)\(\s*(store|storeName)\b/` (syncconflict/syncpush/syncpull generik).
  - `"daftar penulis store tasks persis tabel audit R9"`: hitungan per (berkas, pola) atas `static/offline/*.js` + `static/index.html` sama dengan objek `AUDIT` yang dibekukan di tes (setiap entri memuat `reason` dari tabel R9). Lokasi baru/berkurang → gagal dengan pesan `"penulis store tasks berubah di <file>: tinjau ext_only_rev (R9, ADR-043) lalu perbarui AUDIT"`. Prosedur: jalankan pemindai sekali setelah T2–T4, cocokkan **setiap** lokasi dengan tabel R9, baru bekukan.
  - `"ext_only_rev hanya dibandingkan di taskext.js"`: di luar `taskext.js`, `ext_only_rev` hanya muncul sebagai penugasan/`delete` (regex `/ext_only_rev\s*(===|!==|==|!=|<|>)/` tidak ada).
  - `"penulis yang menaikkan rev ada di daftar AUDIT dengan kategori 'rev+1'"` (regex `/rev:\s*\(cur\.rev \|\| 0\) \+ 1|next\.rev = \(base\.rev/` per berkas).
- [ ] **Step 2: Tulis tes alur** `taskext_only_flow.test.js` (server palsu bersama: baris task dengan field inti + ext, PUT menerapkan hanya kunci yang dikirim dan menaikkan `updated_at`, `GET /api/tasks?include_done=true` untuk pull; "anggota A" = mutasi langsung baris server; "perangkat B" = IndexedDB `fake-indexeddb`):
  - `"push tanpa pull: A mengubah judul + status selesai + progress 40; B (basi) updateTask {ext_patch} → pushOutbox → body PUT tepat {ext_patch}; baris server mempertahankan nilai A; record B menampilkan nilai A sebelum pull"` (Review Focus 2).
  - `"pull→push: B mengedit ext offline SETELAH A mengubah judul → pullTasks + pushOutbox → nilai A bertahan di server dan di B; ext B di server"`.
  - `"B: ext lalu judul sebelum push → satu PUT penuh berisi judul B + ext_patch; judul → ext → sama"`.
  - `"B: 200 task masing-masing satu ext_patch → 200 PUT {ext_patch}, 0 PUT penuh, server tidak mencatat perubahan inti"`.
  - `"B: dua ext pada task yang sama sebelum push → 1 PUT"`.
  - **Regresi payload penuh** `"edit inti normal → kunci payload persis FULL_KEYS"` untuk patch `{title}`, `{gtd_status: "done"}`, `{progress: 50}`, `{is_focused: 1}`, `{deadline: "2026-11-20"}`, `{assigned_to: 9}`, `{recurrence_type: "weekly", recurrence_days: [1]}`, `{description}`: `FULL_KEYS = ["title","description","priority","project","context","deadline","gtd_status","waiting_for","assigned_to","progress","is_focused","recurrence_type","recurrence_days","estimated_pomodoros"]` (+ `project_id`/`context_id` bila record ber-id) — dibuktikan sama dengan kunci yang dihasilkan `origin/main` (konstanta dibekukan dari baseline; tes juga membandingkan dengan `taskToUpdatePayload(rec, …)` dipanggil terpisah); nilai `title` = judul + tag lokal (`titleWithTags`).
  - `"record lama di IndexedDB (dirty, ext_dirty, tanpa penanda — data dari versi 1b) → payload penuh"`.
  - `"hapus tag lokal pada task ext saja lalu push → PUT penuh dengan title tanpa #tag"`.
- [ ] **Step 3: Jalankan → PASS** `node --test tests/offline/taskext_writers_fence.test.js tests/offline/taskext_only_flow.test.js` (bila gagal karena celah → perbaiki, ulangi T2–T4 Step 4).
- [ ] **Step 4:** `npm test`.
- [ ] **Step 5: Commit** `test(sync): pagar penulis store tasks dan alur ext saja dua anggota`

### Task 6: Runtime — `setMany` satu render + `err.applied`

**Files:**
- Modify: `static/plugin-runtime.js` (`makeTaskExt :1219–1314`: pecah `write :1245–1251`, `setMany :1292–1312`)
- Test: `tests/offline/plugin_taskext_api.test.js` (tambah saja; `globalThis.ReactDOM` palsu dipasang/dilepas per tes)

**Interfaces:** Produces `api.taskExt.setMany(items) -> Promise<rows>`; reject → error dengan `applied: Array<taskId>` (R11, R12). `set` tidak berubah.

- [ ] **Step 1: Tulis tes gagal**:
  - `"setMany 200 item → satu unstable_batchedUpdates; urutan panggilan: batch-mulai, patch×200, batch-selesai, update×200, refresh"` (ReactDOM palsu mencatat kedalaman; semua `patch` di kedalaman 1).
  - `"patchTaskExt tepat sekali per item (tidak dipanggil lagi saat tulis)"`.
  - `"tanpa ReactDOM (Node) → patch tetap semua di depan, berurutan"`.
  - `"unstable_batchedUpdates melempar / patchTaskExt melempar untuk satu item → warn, item lain tetap dipatch, semua tetap ditulis"`.
  - `"gagal di item 3 (EXT_TOO_LARGE) → PluginStorageError dengan applied [1, 2]; satu refreshTasks; taskUpdated {taskIds: [1, 2]}"`.
  - `"gagal di item 1 → applied []"`; `"'Task not found' → Error dengan applied"`; `"penolakan bukan objek (string) → Error dengan applied"`.
  - `"validasi gagal (field tak terdaftar) → reject tanpa patch, tanpa tulis, tanpa applied"`.
  - `"set tunggal: urutan patch → update tidak berubah"` (tes lama `:66` lulus).
  - `"apiVersion tetap 1"`.
- [ ] **Step 2: Jalankan → FAIL** `node --test tests/offline/plugin_taskext_api.test.js`.
- [ ] **Step 3: Implementasi** (R11, R12).
- [ ] **Step 4: Jalankan → PASS**, `npm test` (`timeline_*.test.js`, `plugin_api*.test.js` lulus tanpa diubah).
- [ ] **Step 5: Commit** `feat(plugin): api.taskExt.setMany — satu render untuk pembaruan optimistis, err.applied`

### Task 7: Rilis — SW v496, whatsnew `silent`, README §5, ADR-043, pola tes CI

**Files:**
- Modify: `static/sw.js` (`CACHE :1`), `static/index.html` (`__SW_VERSION :270` + fallback `:28006`), file `static/`+`tests/` yang memuat string versi lama (sed **kecuali** `static/whatsnew.json`), `static/whatsnew.json`, `tests/test_plugins_node.py` (`REQUIRED :32–40`), `docs/plugins/README.md` (§5 `:174–200`, §5 `api.records`, §11 `:546`), `.agents/DECISIONS.md` (ADR-043 setelah ADR-042 `:346–351`)

- [ ] **Step 1: Versi** `taskflow-v495-timeline` → `taskflow-v496-sinkron-ext` (R17; cek `static/sw.js` di `main` saat merge, PROTOCOL §4 butir 4); `app.css?v=383` tetap; `wc -l static/index.html` = **46.074**.
- [ ] **Step 2: whatsnew** entri teratas `{"version": "taskflow-v496-sinkron-ext", "date": "<tanggal rilis WIB>", "silent": true}`.
- [ ] **Step 3: `tests/test_plugins_node.py`**: `REQUIRED` += `"taskext_only_flow", "taskext_writers_fence"` (pola `taskext*.test.js` sudah ada di `PATTERNS :19`); `EXTRA` += `tests/offline/syncconflict.test.js` bila belum tercakup.
- [ ] **Step 4: README** (R18) judul tetap; §5 `api.taskExt` dua butir; §5 `api.records` + §11 entitas baru tanpa restart.
- [ ] **Step 5: ADR-043** "Push task 'ext saja' (`ext_only_rev`), `setMany` satu render, entitas record baru tanpa restart" (Date / Agent / Context / Decision / Consequences, format ADR-042): **Context** — push task selalu mengirim seluruh field inti dari salinan lokal (`taskToUpdatePayload`), server tanpa LWW task, `schedulePush`/`__pushNow` push tanpa pull, LWW pull memenangkan edit ext lokal yang "lebih baru" → seret Timeline di perangkat basi mengembalikan judul/status anggota lain (sudah ada di 1b, 1c melipatgandakan); `setMany` = render per item di bawah `ReactDOM.render` legacy; entitas record baru butuh restart (`INVALID entity` dibuang permanen di klien). **Decision** — K24–K26 + R1–R13 (penanda diikat `rev`, patch ketat, bentuk payload diputuskan saat kirim, op record bersih dibuang, adopsi inti dari respons PUT ext saja, pull inti server menang, hapus tag membatalkan penanda, syarat `entity_tags` kotor diganti karena `dirty` tidak pernah dibersihkan, `unstable_batchedUpdates`, `err.applied`, `_decl_for` TTL 10 dtk); server PUT tidak berubah; tanpa endpoint batch (K23). **Consequences** — edit ext tidak pernah lagi membawa field inti; perangkat basi melihat nilai server setelah push pertamanya; edit inti tetap LWW seperti sebelumnya (residual spec §11 R2: PUT ext saja menaikkan `tasks.updated_at` sehingga edit inti offline yang lebih tua dari perangkat lain kalah saat tarik — tindak lanjut "LWW per kelompok field task"); penghapusan tag pada task bersih bisa tertunda sampai edit inti berikutnya (utang sinkron tag pra-ada); lebih sedikit PUT (op basi dibuang); 1c-1/1c-2/1d deploy statis tanpa restart; restart `taskflow-web` sekali; rollback = rilis baru + restart, kunci `ext_only_rev` diabaikan; tab lama tetap mengirim payload penuh sampai diperbarui.
- [ ] **Step 6: Verifikasi** `python3 -m pytest tests/test_whatsnew.py tests/test_sw_precache_node.py tests/test_app_update_node.py -q` (PROTOCOL §4 butir 5), `python3 -m pytest tests/test_plugins_node.py -q`, `npm test`, `python3 -m pytest tests/ -q`, `node compile.js` dua kali tanpa diff, `node temporary_files/check_inline_scripts.js static/index.html`.
- [ ] **Step 7: Commit** `chore(release): SW v496 sinkron-ext (silent), README taskExt/records, ADR-043`

### Task 8: E2E Playwright

**Files:**
- Create: `temporary_files/e2e_plugin_fase1_1c0.py` (pola `temporary_files/e2e_plugin_fase1_1b.py`: `new_device`, `open_timeline`, `bar`, `mouse_drag`, `sync_now`, `wait_sync`, `server_task`, `ext_of`, `core_of`, `upd_notifs`, `watch`; tangkapan ke `temporary_files/e2e_plugin_fase1_1c0/`; `TZ=Asia/Jakarta`; konteks `service_workers="block"`; tidak di CI)

**Skenario** (U1 = anggota A, U2 = anggota B; workspace W milik U1, U2 anggota; Timeline ON untuk keduanya lewat `PUT /api/plugins/state/timeline`; task T1–T3 di W project "Rilis" dengan `timeline.start`/`duration` diisi lewat `PUT ext_patch`; semua PUT task dicatat per konteks lewat `page.on("request")` beserta `post_data_json`):
1. **Push tanpa pull (inti):** B memuat app + sinkron; `ctx_b.route("**/api/tasks?include_done=true*", lambda r: r.abort())`; A (UI: detail task) mengubah judul T1 → "Judul dari A"; B membuka Timeline W, seret bar T1 +2 hari → tunggu **tepat satu** PUT B ke `/api/tasks/<T1>`: `set(body.keys()) == {"ext_patch"}`; server: `title == "Judul dari A"`, `timeline.start` bergeser 2 hari kerja; `upd_notifs(U1, …)` tidak bertambah; IndexedDB B (`page.evaluate`) `title == "Judul dari A"` **sebelum** `unroute`; setelah `unroute` + sinkron, baris T1 di daftar B "Judul dari A". **Ini E2E wajib "A mengubah judul, B (data basi) menyeret bar Timeline → judul A tidak tertimpa".**
2. **Sinkron pull→push:** B `set_offline(True)`, seret T2 −1 hari; A mengubah judul T2 + tandai selesai + progress 40; B online + `sync_now` → server: judul/status/progress A, ext B; B menampilkan judul A dan status selesai; satu PUT B `{ext_patch}` saja.
3. **Kontrol kepekaan:** konteks baru B' (U2) dengan `page.route("**/static/offline/syncpush.js")` menyajikan `git show origin/main:static/offline/syncpush.js` → ulangi skenario 1 pada T3 → **judul tertimpa** oleh salinan basi B' (dicatat "bug lama terreproduksi"); kembalikan judul lewat API sesudahnya.
4. **Regresi edit inti normal:** B mengubah judul T1 di detail task → PUT B memuat semua `FULL_KEYS` (R-T5) + `title` = judul baru; B menandai T2 belum selesai lalu selesai (checkbox) → PUT penuh dengan `gtd_status`; B mengubah progress T3 di detail → PUT penuh dengan `progress`; server sesuai.
5. **Inti + ext sebelum push:** B offline: seret T1 lalu ubah judul T1; ubah judul T2 lalu seret T2 → online → server memuat **keduanya** (judul B + ext B) untuk T1 dan T2; tiap task satu PUT penuh berisi `ext_patch`.
6. **Hapus tag:** B mengubah judul T3 menjadi "… #rapat" (sinkron, server punya tag `rapat`); B offline: seret T3, lalu hapus chip tag `rapat` → online → PUT T3 penuh (bukan ext saja), `GET /api/tasks/<T3>/tags` server tanpa `rapat`.
7. **Tab lama + tab baru (R1):** konteks U2 dengan dua tab: P memuat `taskrepo.js` + `syncpush.js` dari `git show origin/main:` (kode 1b), Q kode PR; Q offline seret T1 (penanda sah); P (offline, IndexedDB sama) mengubah judul T1; Q online + sinkron → PUT penuh dengan judul P (penanda batal karena `rev` naik).
8. **`setMany` satu render (K24):** konteks U2 dengan `add_init_script` memasang `__REACT_DEVTOOLS_GLOBAL_HOOK__` palsu (`supportsFiber: true`, `inject() → 1`, `onCommitFiberRoot() { window.__commits++ }`, `onCommitFiberUnmount() {}`, `checkDCE() {}`); 200 task di project pribadi B dengan `timeline.start`; CDP `Emulation.setCPUThrottlingRate {rate: 4}`; `page.evaluate` → `__commits = 0`, `TF.api.for("timeline").taskExt.setMany(200 item start +1 hari)` → catat jumlah commit (**≤ 3**: satu batch optimistis + satu `refreshTasks` + toleransi satu) dan waktu sampai resolve (dicatat; target 1c-1 ≤ 2 s); kontrol: `page.route("**/static/plugin-runtime.js")` dari `origin/main` → commit ±200 (dicatat). `setMany` dengan item ke-5 `taskId` tak ada → reject, `err.applied.length == 4`, daftar task kembali konsisten (item 5–200 tidak berubah).
9. **K26 (harness):** server dari `temporary_files/e2e_app_demo_records.py` dengan indeks tmp; setelah server jalan, indeks tmp ditulis ulang dengan entitas `memo` pada `demo-records`; `fetch` POST dari halaman (token) item `memo` → `applied: true` tanpa restart; item `nope` → `INVALID entity`.
10. **375 px + konsol:** skenario 1 di 375 px (Daftar HP: edit Mulai lewat seksi Jadwal) → PUT `{ext_patch}`; konsol tanpa error selain yang disengaja (abort skenario 1).

- [ ] **Step 1:** tulis skrip; **Step 2:** `TZ=Asia/Jakarta python3 temporary_files/e2e_plugin_fase1_1c0.py` → semua cek lolos (catat N/N, jumlah commit, waktu `setMany`); regresi `e2e_plugin_fase1_1b.py`, `e2e_plugin_fase1_1a2.py`, `e2e_plugin_fase1_1a1.py` lulus.
- [ ] **Step 3: Commit** `test(plugin): E2E PR 1c-0 (ext saja dua anggota, kontrol bug lama, setMany satu render, entitas baru)`

### Task 9: Verifikasi akhir, dokumen, handover, review, PR draft

**Files:** `docs/superpowers/specs/2026-11-01-plugin-fase1-1c-otomatis-design.md` (salinan spec disetujui + "### Catatan implementasi PR 1c-0 (<tanggal>)" setelah §6.3), `docs/superpowers/plans/2026-11-01-plugin-fase1-pr-1c-0.md` (salinan rencana ini), `.agents/CURRENT_STATE.md` (entri teratas), `.agents/SESSION_LOG.md` (format PROTOCOL §3.2)

- [ ] **Step 1: Verifikasi** dan catat angka: `python3 -m pytest tests/ -q` (1422 lama + baru, 1 skip; Python 3.12 bila tersedia); `npm test` (hanya `draw_local_reactive`); `node --test tests/build-plugins.test.js` (26/26); PROTOCOL §4 butir 5; `node temporary_files/check_inline_scripts.js static/index.html`; `node compile.js` dua kali tanpa diff; `git diff --stat origin/main -- static/app.css static/plugins static/offline/db.js webapp.py plugin_loader.py` kosong; `wc -l static/index.html` = 46.074 dan `git diff origin/main -- static/index.html` hanya dua baris versi; `ls static/offline/*.js | wc -l` = 84; `git diff origin/main -- 'tests/*.py' 'tests/offline/*.js'` hanya penambahan + dua berkas baru + `test_plugins_node.py` (R19); asap `python3 -c "import webapp, bot"`; simulasi CI tanpa `node_modules` (pola 1a-2).
- [ ] **Step 2: Dokumen:** salin spec 1c ke `docs/superpowers/specs/2026-11-01-plugin-fase1-1c-otomatis-design.md` + catatan implementasi 1c-0 (R1 penanda `rev`, R3 op basi dibuang, R5 adopsi inti, R8 deviasi tag, penyimpangan yang ditemukan saat implementasi); perbarui salinan Project `claude/spec-plugin-fase1-1c-otomatis-2026-11-01.md` lewat `project_write` (isi sama); salin rencana ke `docs/superpowers/plans/2026-11-01-plugin-fase1-pr-1c-0.md`.
- [ ] **Step 3: Handover** `CURRENT_STATE.md`: `## 🟡 Plugin Fase 1 — PR 1c-0: push ext saja + setMany satu render + entitas record baru tanpa restart — claude/plugin-host-1c0 — <tanggal> (Claude) — PR DRAFT, menunggu "merge dan deploy"`: spec/plan/ADR-043; isi (K24–K26, R1–R13); rilis SW v496 `silent`; **deploy: workflow TIDAK me-restart → Bapak wajib `sudo systemctl restart taskflow-web` (bot tidak perlu)**; jendela deploy aman (R15: server lama menerima `{ext_patch}`); verifikasi pasca-deploy: `systemctl show -p ActiveEnterTimestamp taskflow-web` setelah waktu deploy, POST `/api/plugins/timeline/records` entitas `probe` → `INVALID`/`entity` + baris log "baca ulang indeks" di `journalctl -u taskflow-web`, Pengaturan menampilkan SW v496, seret bar Timeline → DevTools Network: PUT body hanya `ext_patch`; **1c-1 baru boleh di-merge setelah verifikasi itu**; rollback (R16); risiko terbuka (residual §11 R2, tag R8). `SESSION_LOG.md` entri baru.
- [ ] **Step 4: Commit** `docs(agents): handover PR 1c-0 Fase 1`
- [ ] **Step 5: Review akhir oleh subagen reviewer terpisah** (Review Focus 1–7 + R1–R20; khusus: setiap penulis store `tasks` di tabel R9 dan tidak ada yang terlewat (jalankan pemindai sendiri, bukan percaya `AUDIT`); `extOnlyNow` satu-satunya pembaca penanda; payload penuh tidak berubah; adopsi inti hanya di dalam transaksi `markPushed` dan hanya bila `extOnlyNow(cur)`; op dibuang hanya bila `dirty` 0; jalur R11 tidak menghapus edit inti lokal yang **tidak** ext saja dan menang LWW; `setMany` tidak memanggil `patchTaskExt` dua kali; `_decl_for` di luar `write_tx`; `index.html` +0). Perbaiki temuan wajib, ulangi Step 1.
- [ ] **Step 6: Push + PR draft** judul `Plugin Fase 1 — PR 1c-0: push task "ext saja", setMany satu render, entitas record baru tanpa restart`; body: ringkasan (masalah yang diperbaiki dengan contoh "judul anggota lain tertimpa saat menyeret bar Timeline di perangkat basi"), tabel file, R-keputusan penting (R1, R3, R5, R7, R8 deviasi, R13), angka tes, hasil E2E (termasuk kontrol bug lama dan jumlah commit React), **catatan deploy: restart manual `sudo systemctl restart taskflow-web`** (memuat `plugin_records.py` baru; `taskflow` tidak perlu), verifikasi pasca-deploy (Step 3), **urutan: 1c-1 hanya setelah PR ini ter-deploy + restart + verifikasi**, rollback; akhiri dengan atribusi sesi. Merge hanya setelah Bapak bilang "merge dan deploy"; setelah deploy sukses ingatkan restart `taskflow-web`.
