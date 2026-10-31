# Sistem Plugin Fase 1 — PR 1a-2: IndexedDB v7, `plugin_records` (server + `plugin_sync.js`), `api.records`, izin `records` — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plugin bisa menyimpan **record** sendiri (data yang bukan milik satu task: kalender, baseline, kapasitas) yang sinkron dua arah, bekerja offline penuh, dan dibagi ke anggota workspace untuk scope `list:<id>` — lewat satu jalur generik: IndexedDB `taskflow-offline` naik **sekali** ke **v7** (store `plugin_records` + `plugin_kv`, data v6 utuh), tabel server `plugin_records` dengan kursor delta **`seq`** (bukan `updated_at`) dan sidik jari keanggotaan workspace yang memicu tarik ulang, endpoint `GET/POST /api/plugins/{id}/records` (tidak mensyaratkan plugin ON), konflik LWW dengan `base_version`, modul klien `static/offline/plugin_sync.js` (`TF.pluginsync`: satu op outbox per record lewat `op_qid`, cabang `entity_type: "plugin"` di `syncpush`/`syncpull`), `TF.api` v1 mendapat `api.records` (izin `records` pindah dari dicadangkan ke dikenal), dan ekspor data memuat `plugin_states.json` + `plugin_records.json`. Dibuktikan plugin contoh khusus tes `demo-records`; tidak ada fitur baru yang terlihat pengguna (whatsnew `silent`).

**Architecture:** Server: modul baru `plugin_records.py` (skema + `plugin_records_meta`, validasi murni, `fingerprint`/kursor, `apply_item` LWW di dalam satu `write_tx`, `purge`, `router` `def` GET/POST) — skema dipanggil `plugin_loader.migrate` setelah `plugin_states` (R1); router host dipasang **sebelum** `plugin_loader.init_web` dan loader menolak router plugin yang memakai `/records…` (R2); `plugin_loader._read_index` menyimpan deklarasi `records` (`records_decl()`); `plugin_host.list_access` (pemakai pertama); `task_ext.check_value` publik untuk validasi `$task` di data record; ekspor `GET /api/export/download` + dua berkas. Klien: `db.js` `DB_VERSION = 7` dengan `PLUGIN_STORES` terpisah dari `ENTITY_STORES` (tanpa pemindahan data); modul baru `static/offline/plugin_sync.js` (`TF.pluginsync`: `put/get/list/remove/subscribe/newId` atas transaksi `["plugin_records", "_outbox"]`, `pushOp` yang dipanggil cabang baru `processOp` di `syncpush.js`, `pullAll` yang dipanggil pembungkus tipis `syncpull.pullPluginRecords`, `healStranded`, `rewriteTaskRefs` setelah `POST` task, penjaga pemilik cache); runtime (`static/plugin-runtime.js`) mendapat izin `records`, validasi `manifest.records`, `recordPluginIds()`, `api.records`; `compile.js` menyalin `records` ke `index.json`; `index.html` hanya sambungan (≤ 5 baris, rencana +2).

**Tech Stack:** Python 3.12 (CI) / 3.13 lokal, FastAPI 0.115, pydantic v2, `sqlite3` lewat `dbconn` (ADR-038), pytest; klien UMD tanpa bundler (`static/offline/*.js`), React UMD, `node --test` + `fake-indexeddb` 6 (`tests/offline/setup.js`), Babel classic (`compile.js`), Playwright (E2E manual, tidak di CI). Tidak ada dependensi baru.

**Spec:** `docs/superpowers/specs/2026-10-31-plugin-fase1-timeline-design.md` (salinan Project claude.ai `claude/spec-plugin-fase1-timeline-2026-10-31.md`; disetujui pemilik 2026-10-31 — §15 Q1 lima PR dengan jeda ≥ 3 hari antara 1a-1 dan 1a-2, Q2 fondasi dibuktikan plugin contoh khusus tes **dan rencana 1b ditulis serta direview sebelum 1a-2 di-merge**, Q3 data workspace dibagi ke semua anggota). PR 1a-2 mencakup §1 kriteria 1, 3, 5 (`records`), 9 (bump v7 tepat sekali), 10; §2 K1 (baris 1a-2), K3, K8, K9, K10, K11, K14 (record `list:<id>`), K19 (`records`); §3 baris 1a-2; §4 (bump + rollback); §5.1 baris `plugin_records.py`, `plugin_loader.py` (records + `/records` dicadangkan), `plugin_host.py`, ekspor; §5.2 bagian `plugin_records`; §5.3; §6.2; §7.1 baris `db.js` (K3), `plugin_sync.js`, `syncpush.js` (cabang plugin), `plugin-runtime.js` (`records`), `compile.js` (`records`); §7.3; §10 baris "Jendela deploy 1a-2", "Pengguna baru masuk workspace", "Pengguna dikeluarkan dari workspace", "Timeline OFF di laptop", "Dua tab"; §11 bagian 1a-2; §12 baris 1a-2; serta **"Catatan implementasi PR 1a-1"** (`plugin_records.ensure_schema` boleh tetap di `plugin_loader.migrate`; mekanisme `versionchange` R12; `TF.taskext` + referensi `$task` R9). Juga: spec 0a Lampiran B5–B9, ADR-037/038/039/040, `docs/plugins/README.md`, `.agents/PROTOCOL.md` §4, `CLAUDE.md`. **Bukan** cakupan: plugin `timeline` (1b), scope `project:<id>`, strategi `merge`/`manual`, batch push > 1 item per permintaan dari klien, pemindahan `api.storage` ke `plugin_kv`, UI konflik record di bilah konflik, delta pull task (§14).

**Branch:** `claude/plugin-records` dari `main` ≥ `e6d9256` (setelah #119 PR 1a-1 di-merge `ed6bd04` dan di-deploy 2026-11-01 ±02.02 WIB; SW `taskflow-v491-plugin-ext`, `app.css?v=382`, IndexedDB `taskflow-offline` **v6**, 83 modul `static/offline/`, `index.html` **46.114** baris (+19 dari baseline Fase 1 46.095), `plugin-runtime.js` 1.470, `syncpush.js` 2.423, `syncpull.js` 1.991, `db.js` 245, `webapp.py` 10.876, `plugin_loader.py` 435, `plugin_states.py` 217, `task_ext.py` 198, `compile.js` 310). Baseline (dijalankan 2026-11-01 02.11 WIB di worktree `origin/main` `e6d9256`, Python 3.13.18 / pytest 9.1.1 / Node 22.23.4, `node_modules` dari working tree utama lewat symlink): `python3 -m pytest tests/ -q` → **1367 passed, 1 skipped** (123 s); `npm test` → **3744/3745** (gagal pra-ada: `Unified Offline Drawing Reactivity - Local Event Reactivity`, `draw_local_reactive`); `node --test tests/build-plugins.test.js` → **17/17**. **Jangan merge sebelum 2026-11-04** (≥ 3 hari setelah #119 ter-deploy, K1/K2).

## Peta perubahan

| File | Status | Isi (Task) |
|---|---|---|
| `plugin_records.py` | baru (~320 baris) | skema, validasi, kursor/sidik jari, `apply_item` LWW, `purge`, `router` GET/POST (T1, T2) |
| `plugin_loader.py` | ubah | `_read_index` + `records`, `records_decl()`, `/records` dicadangkan di `_validate`, `migrate` memanggil `plugin_records.ensure_schema` (T1) |
| `plugin_host.py` | ubah kecil | `list_access(conn, uid, list_id)`, `accessible_list_ids(conn, uid)` (T1) |
| `task_ext.py` | ubah kecil | `check_value(value) -> str \| None` publik (bungkus `_check_value`) (T1) |
| `tests/fixtures/plugins/index.json` | ubah | entri `demo-records` berizin `records` + deklarasi (T1) |
| `tests/fixtures/plugin_records_vectors.json` | baru | vektor bersama pytest + node + compile (T1, T4, T7, T8) |
| `webapp.py` | ubah (≤ 25 baris) | `include_router(plugin_records.router)` sebelum `init_web` (T2); ekspor dua berkas (T2) |
| `tests/test_plugin_records.py` | baru | unit (T1) + HTTP (T2) |
| `tests/test_plugin_loader.py` | ubah (tambah saja) | `records_decl`, `/records` dicadangkan (T1) |
| `static/offline/db.js` | ubah | `DB_VERSION = 7`, `PLUGIN_STORES`, `createSchema` (T3) |
| `tests/offline/db_v7.test.js` | baru | upgrade v6→v7 utuh, indeks, blokir, rollback (T3) |
| `static/offline/plugin_sync.js` | baru (~450 baris) | `TF.pluginsync` lokal (T4), push (T5), pull (T6) |
| `static/offline/taskext.js` | ubah kecil | ekspor `checkValue(v) -> code \| null` (T4) |
| `static/offline/syncpush.js` | ubah (≤ 25 baris) | `pluginSync()` malas, cabang `entity_type: "plugin"`, heal, `rewriteTaskRefs` setelah POST task (T5) |
| `static/offline/syncpull.js` | ubah (≤ 12 baris) | `pullPluginRecords` pembungkus malas (T6) |
| `compile.js` | ubah | `records` di `OPTIONAL_FIELDS`, `validateRecords` (T7) |
| `tests/fixtures/plugins/demo-records/{manifest.json,plugin.jsx}` | baru | plugin contoh khusus tes (T7) |
| `static/plugin-runtime.js` | ubah | izin `records`, `recordsError`, `recordPluginIds`, `api.records`, `NODE_PATHS.pluginsync` (T8) |
| `static/index.html` | ubah (≤ 5 baris bersih, rencana +2) | `<script>` `plugin_sync.js`, langkah `sync()`, label izin di baris yang sama (T9); versi SW (T10) |
| `static/sw.js`, `static/whatsnew.json` | ubah | `STATIC` +1 (T9); `CACHE` v492, entri `silent` (T10) |
| `docs/plugins/README.md`, `.agents/DECISIONS.md` | ubah | `records`, `api.records`; ADR-041 (T10) |
| `tests/test_plugins_node.py` | ubah | pola + `REQUIRED` (T10) |
| `temporary_files/e2e_app_demo_records.py`, `temporary_files/e2e_plugin_fase1_1a2.py` | baru | E2E (T11) |
| `docs/superpowers/specs/…-timeline-design.md`, `docs/superpowers/plans/2026-11-01-plugin-fase1-pr-1a-2.md` | ubah / baru | "Catatan implementasi PR 1a-2", salinan rencana (T12) |

## Keputusan rencana (controller)

- **R1 — Skema di `plugin_loader.migrate`, kegagalan terlihat sebagai 503.** Sesuai catatan 1a-1: `plugin_records.ensure_schema(conn)` dipanggil di `plugin_loader.migrate` (`plugin_loader.py:316–322`) tepat setelah blok `plugin_states`, dalam `write_tx` sendiri, kegagalan di-log `ERROR` dan ditelan (record tidak dipakai jalur task). `migrate_db` tidak berubah (27 `dbconn.connect`, pagar `tests/test_dbconn_callsites.py` tidak diubah). Endpoint memetakan `sqlite3.OperationalError` (mis. `no such table`) → 503 `{"code": "PLUGIN_UNAVAILABLE"}` sehingga op klien tetap antre (5xx = retry, `syncpush.js:536–566`), bukan 500 tanpa kode.
- **R2 — Rute host dipasang sebelum router plugin; `/records` dicadangkan.** `app.include_router(plugin_records.router)` di antara `include_router(plugin_states.router)` dan `plugin_loader.init_web(app)` (`webapp.py:10870–10871`). `plugin_loader._validate` (`:184–206`) menolak router plugin yang punya `APIRoute` dengan path `== "/records"` atau diawali `"/records/"` → `PluginRejected("rute /records dicadangkan host")` (plugin ditolak utuh, pola K7 0b).
- **R3 — Deklarasi entitas dari `index.json`.** `_read_index` mengembalikan `(known, perms, records)`; `records_decl(pid) -> dict[str, {"conflict": "lww", "maxBytes": int}]` hanya untuk plugin berizin `records`; entri tak sah (nama tidak cocok `^[a-z][a-z0-9_]{0,31}$`, `conflict` ≠ `"lww"`, `maxBytes` bukan int 1..65536) dilewati dengan `WARNING` (compile.js sudah menolaknya; server tidak mempercayai). `maxBytes` tidak ada → 65536. `known()` dan `permissions()` tidak berubah bentuk (tes 1a-1 tetap).
- **R4 — Urutan error tingkat permintaan** (sama untuk GET/POST, pola `plugin_states.put_state_endpoint`): 401 (`current_user`) → 403 `PLUGIN_FORBIDDEN_TOKEN` (`scope == "ext"`) → 404 `PLUGIN_UNKNOWN` bila id tidak cocok pola/`state` → 503 `PLUGIN_UNAVAILABLE` bila `index_ok()` false → bila id tidak di indeks **atau** tanpa izin `records`: `refresh_known()` sekali lalu 404 `PLUGIN_UNKNOWN`. **Tidak** memeriksa ON (K9). GET `entity=` yang tidak dideklarasikan → 422 `{"code": "INVALID", "detail": "entity"}`.
- **R5 — `seq`.** Setiap tulis yang **diterima** (insert, update, tombstone) memberi `seq = COALESCE(MAX(seq), 0) + 1` dibaca di dalam `write_tx` yang sama (satu `write_tx` untuk seluruh `items` POST); kiriman ulang idempoten, item ditolak, dan LWW kalah tidak menaikkan `seq`. `UNIQUE INDEX ux_plugin_records_seq`. Tes dua thread × 50 tulis → `seq` 1..100 tanpa celah/duplikat dan urutan GET = urutan commit.
- **R6 — LWW (K10) rinci.** `base_version` tidak ada/`null` = 0. Urutan per item: (1) validasi → `INVALID`; (2) scope tidak bisa diakses → `FORBIDDEN_SCOPE`; (3) id yang sama di `owner_key` lain yang bisa diakses pengguna → `SCOPE_IMMUTABLE`; (4) baris ada **dan** `version == base + 1` **dan** `updated_by == uid` **dan** `data`/`deleted` identik → `applied: true` + baris apa adanya (idempoten, tanpa tulis); (5) baris tidak ada: `deleted` → `applied: true, record: null` (tanpa baris); selain itu insert `version 1`; (6) `base == version` → terapkan; (7) selain itu `incoming = min(updated_at klien, now)`; `parse_ts(row.updated_at) > incoming` → `applied: false` + baris server; selain itu terapkan. Terapkan = `version + 1`, `updated_at = iso(incoming)` (waktu klien yang dipotong, dasar LWW berikutnya; `updated_at` rusak di DB = kiriman menang), `server_at = iso(now)`, `updated_by = uid`, `deleted` 0/1, tombstone menyimpan `data = '{}'`, `seq` baru. `parse_ts`/`iso` dipakai ulang dari `plugin_states`.
- **R7 — Kursor dan reset (§5.3).** Kursor `"1.<seq>.<fp>"`; `fp` = 8 hex pertama `sha1(",".join(sorted(str(id))))` atas `plugin_host.accessible_list_ids(conn, uid)` (`shared_lists.owner_id = uid` ∪ `list_members.user_id = uid`). Kursor kosong = tarik penuh dari `seq > 0` (bukan reset). `{"reset": true}` bila format tak terbaca, `seq < purged_seq`, atau `fp` berbeda. Halaman: `ORDER BY seq LIMIT limit + 1` → `more`; kursor baru = `seq` item terakhir (tanpa item = `seq` lama dengan `fp` sekarang). `limit` 1–1000, bawaan 500 (di luar rentang → 422 pydantic). Purge tombstone (`deleted = 1 AND server_at < now − 30 hari`) paling sering sekali per jam per proses dari handler GET (`write_tx` sendiri): `purged_seq = max(lama, MAX(seq) yang dihapus)` di `plugin_records_meta`.
- **R8 — Batas permintaan.** POST: `Content-Length` > 262.144 → 413 `{"code": "TOO_LARGE"}` (header tidak ada = lanjut; batas per item tetap berlaku); `items` 1–50 (pydantic → 422). Data: objek JSON, byte UTF-8 `task_ext.dumps(data)` ≤ `min(65536, maxBytes)`, `task_ext.check_value` (`$task` hanya integer, tanpa NaN/Infinity) — gagal → `{"error": "INVALID", "detail": "data" | "size" | "task_ref"}`. Id `^[A-Za-z0-9:@._-]{1,80}$`; scope `user` | `list:<int > 0>` (`project:` → `INVALID detail "scope"`, ditunda K9); `updated_at` lewat `parse_ts`. Klien mengirim **satu item per POST** (§14 batch push ditunda).
- **R9 — IndexedDB v7 (K3).** `DB_VERSION = 7`; `PLUGIN_STORES` terpisah dari `ENTITY_STORES` (tidak masuk `ENTITY_STORE_NAMES`, jadi `syncconflict`/heal entitas tidak menyentuhnya): `plugin_records` keyPath `["plugin_id", "entity", "id"]`, indeks `entity` = `["plugin_id", "entity"]`, `entity_updated` = `["plugin_id", "entity", "updated_at"]`, `entity_dirty` = `["plugin_id", "entity", "dirty"]`, `entity_scope` = `["plugin_id", "entity", "scope"]`; `plugin_kv` keyPath `["plugin_id", "scope", "key"]`. `createSchema` hanya `createObjectStore`/`createIndex` bila belum ada (idempoten, tanpa pemindahan data → upgrade atomik). `dirty` dan `deleted` disimpan **0/1**. Komentar `DB_VERSION` diperluas: "v7 = plugin_records/plugin_kv (PR 1a-2). Revert fitur ≠ turunkan versi". `clearAll` (logout) ikut mengosongkan dua store baru (perilaku lama: semua store).
- **R10 — Rekam dan op klien.** Record lokal: `{plugin_id, entity, id, scope, data, updated_at, version (null = belum pernah diterima server), deleted 0/1, dirty 0/1, op_qid (number | null), sync_gen?, sync_error?}`. Op (B9): `{entity_type: "plugin", op: "upsert" | "delete", cid: "<pid>/<entity>/<id>", payload: <snapshot record>, ts, retries: 0}`. Tulis lokal = satu transaksi `["plugin_records", "_outbox"]`: baca record → bila `op_qid != null` `ob.delete(op_qid)` (O(1), K11) → `ob.add(op)` → `record.op_qid = qid` → `put`. `pushOp` membaca **record terkini** (payload hanya cadangan untuk diagnosis) sehingga `base_version` selalu `version` terbaru.
- **R11 — `remove` = tombstone lokal.** `remove(entity, id)` menandai `deleted 1, dirty 1` + op `delete` (coalescing yang sama), tidak pernah hapus keras sebelum ack — termasuk record yang belum pernah diterima server (server menjawab `applied: true, record: null`; tidak ada balapan dengan POST yang sedang terbang). Ack `applied` untuk tombstone → hapus keras lokal.
- **R12 — Hasil push (`pushOp`) dengan CAS `op_qid`.** Op masih ada? (`_outbox.get(qid)`; tidak ada → selesai). Record hilang → buang op. 2xx `applied: true`: bila `record.op_qid === qid` → adopsi baris server (`dirty 0`, `op_qid null`, hapus `sync_error`; tombstone/`record: null` → hapus keras) + hapus op; bila berubah selama terbang → hanya `version = server.version` (edit baru menimpa versi yang baru diterima). `applied: false`: `op_qid === qid` → adopsi baris server, hapus op, `onChange({lost: [id]})` bila data lokal ≠ server; berubah selama terbang → biarkan (LWW waktu memutuskan kiriman berikutnya). `FORBIDDEN_SCOPE` → hapus record + op, `onChange({lost: [id]})`. `INVALID`/`SCOPE_IMMUTABLE` → hapus op, record tetap `dirty 1` + `sync_error {code, detail, at}`, `result.failed++`. 404 `PLUGIN_UNKNOWN` → hapus op + `sync_error` (heal melewatinya). 404 tanpa kode (jendela deploy, server lama) → op tetap. Kode lain 4xx → hapus op + `sync_error` + gagal. 401/429/5xx/jaringan dilempar `send` (perilaku drain lama). `put` berikutnya oleh plugin menghapus `sync_error`.
- **R13 — `$task` di data record (K7).** `pushOp` memakai `syncpush.resolveExtRefs({ d: rec.data }, pending)` (fungsi 1a-1, diteruskan lewat opsi): `held` tak kosong → **op ditahan utuh** (tidak dikirim, tetap antre; tidak bisa deadlock karena create task tidak bergantung pada record); ref ke cid tanpa id server dan tanpa create antre → `null`. Setelah `POST` task sukses, `syncpush` memanggil `pluginSync().rewriteTaskRefs(cid, sid)` di samping `rewriteTaskExtRefs` (`syncpush.js:612`): record yang memuat `{"$task": cid}` ditulis ulang ke id server, `dirty 1`, op di-coalesce, `updated_at` **tidak** diubah (penulisan teknis tidak boleh memenangkan LWW). Klien menerima ref angka bulat atau cid string 1–64 (`TF.taskext.refOk`), server hanya integer.
- **R14 — Pull.** `syncpull.pullPluginRecords(rawFetch, {userId, ids})` = pembungkus malas ke `TF.pluginsync.pullAll` (B9 "satu cabang generik di syncpull"); `ids` = `TF.plugins.recordPluginIds()` (plugin di indeks, berizin `records`, `isEnabled`). Per plugin: kursor di `plugin_kv` `[pid, "_sync", "cursor"]`; satu transaksi `["plugin_records", "plugin_kv"]` per halaman (record + kursor atomik). Gabung per item: lokal `dirty 1` → dipertahankan (push + LWW server yang memutuskan); selain itu tombstone → hapus lokal, baris → `put` (`dirty 0`, `op_qid null`, `sync_gen = gen`). **Tarik penuh** (kursor kosong — pertama kali atau setelah `reset`): `gen += 1`, `resetting = true` di `plugin_kv`; setelah halaman terakhir (`more: false`) record lokal plugin itu yang **bersih** dengan `sync_gen !== gen` dihapus (sapu), `resetting = false`; terputus di tengah → lanjut dari kursor tersimpan dengan `gen` sama. `reset` > 1 kali per plugin per sinkron → berhenti. ≤ 50 halaman per plugin per sinkron. 404 `PLUGIN_UNKNOWN` → lewati plugin; error lain dilempar (langkah `step()` di `sync()` mengisolasi). Iterasi plugin berurutan, kegagalan satu plugin tidak menghentikan plugin lain (dikumpulkan, dilempar di akhir).
- **R15 — Penjaga pemilik cache.** `plugin_kv` `["_host", "_sync", "owner"]` = `userId` terakhir. `pullAll` memeriksanya **sebelum** request apa pun: berbeda → hapus semua `plugin_records`, `plugin_kv` (kecuali penanda baru), dan op `entity_type: "plugin"` di `_outbox` dalam satu transaksi, lalu tulis owner. Tidak ada owner (pertama kali) → tulis tanpa menghapus. Pola `pluginstate` "foreign" (ADR-039) untuk kasus `clearAll` gagal saat ganti akun; langkah pull selalu berjalan sebelum `pushOutbox` di `sync()`.
- **R16 — Heal.** `TF.pluginsync.healStranded(knownIds)` dipanggil `pushOutbox` setelah `healStrandedContexts()` (`syncpush.js:2389`), malas: record `dirty 1` tanpa `sync_error` yang `op_qid`-nya tidak ada di `_outbox` (crash, outbox dibersihkan) dan plugin-nya masih di indeks → op baru (coalescing biasa). Pindai lewat rentang kunci primer per plugin (`IDBKeyRange.bound([pid], [pid, []])`), bukan indeks baru.
- **R17 — `api.records` (§7.3) + satu tambahan.** `get(entity, id)`, `list(entity, {scope, limit = 200 (1–1000), after})` → `{items, next}` (tanpa scope: rentang kunci primer `[pid, entity, after]`; dengan scope: indeks `entity_scope` + `continuePrimaryKey`, fallback lewati-maju bila tidak didukung — dicatat di laporan), `put(entity, id | null, data, {scope = "user"})` (id `null` → `newId()`; scope tidak bisa diubah setelah dibuat → `PluginStorageError "scope tidak bisa diubah"`), `remove(entity, id)`, `onChange(fn) → off` (`{entity, ids, source: "local" | "sync", lost?}`, error pendengar dihitung `markFailed("listener")`), `newId()` (`crypto.randomUUID` bila ada, selain itu `TF.ids.newCid`). Record kembalian `{entity, id, scope, data, updated_at, version, pending}` ditambah **`error`** (kode `sync_error`) hanya bila ada — penambahan fungsi, `apiVersion` tetap 1. Tombstone tidak pernah dikembalikan. Validasi klien = server (vektor bersama): entitas dideklarasikan di `manifest.records`, id, scope, ukuran `maxBytes`, `checkValue`. `data` dikembalikan sebagai salinan dalam.
- **R18 — Manifest `records`.** Izin `records` ⇔ `records` objek tak kosong `{<entity>: {conflict: "lww", maxBytes?: int 1..65536}}`, nama entitas `^[a-z][a-z0-9_]{0,31}$`, ≤ 16 entitas; `conflict` `merge`/`manual` → `"strategi konflik <x> belum didukung (Fase 1: lww)"`. Aturan identik di `compile.js` (`validateRecords`) dan runtime (`recordsError`), dikunci vektor bersama.
- **R19 — Plugin OFF.** Push selalu (K9); pull hanya untuk plugin ON (R14). Menyalakan plugin tidak memicu sinkron tambahan: record yang pernah ditarik tetap ada lokal, sisanya datang di sinkron berikutnya (kursor lama masih sah kecuali tombstone sudah di-purge → `reset`).
- **R20 — Tes lama yang asersinya berubah karena spec (hanya ini):** `tests/offline/chatdb.test.js:9–10` dan `tests/offline/db.test.js:66` → `DB_VERSION is 7`; `tests/offline/commentdb.test.js:11` → `db.version` 7; `tests/offline/db_versionchange.test.js:31–32` → judul/asersi `DB_VERSION` 7 (tes lain di berkas itu memakai `DB_VERSION ± 1` dan tidak berubah); `tests/offline/plugin_registry.test.js:37–39` → `KNOWN_PERMISSIONS` `["storage", "network", "task.ext", "records"]`, daftar dicadangkan tanpa `"records"` + `assert.ok(!P.RESERVED_PERMISSIONS.includes("records"))` (kasus `permissions: ["records"]` di `:52` tetap gagal dengan alasan baru "izin records butuh manifest.records"). Semua tes `syncpush`/`syncpull`/`pluginstate`/`taskext`/`db` lain lulus tanpa diubah.
- **R21 — Anggaran `index.html`.** Baseline Fase 1 46.095, terpakai +19 (1a-1) → `wc -l` sekarang 46.114; batas PR ini ≤ +5 (§12) → **≤ 46.119**; rencana +2 (`<script>` + langkah `sync()`); label izin di baris `perm` yang sama (`index.html:27226`).
- **R22 — Rilis.** SW `taskflow-v492-plugin-records` (bila `main` maju, nomor berikutnya mengikuti PROTOCOL §4 butir 4), whatsnew `{"version", "date", "silent": true}`, `app.css?v=382` tetap, ADR-041, restart manual `taskflow-web` **dan** `taskflow` (web memuat `plugin_records`/`plugin_loader`; bot memuat `plugin_loader`). **Merge tidak sebelum 2026-11-04** dan hanya setelah rencana 1b direview (§15 Q2).
- **R23 — Plugin contoh dan E2E tanpa menyentuh `static/plugins/`.** `demo-records` hanya di `tests/fixtures/plugins/demo-records/`; E2E memakai `temporary_files/e2e_app_demo_records.py` (`import webapp` lalu `plugin_loader.load_known(<indeks tmp: indeks nyata + demo-ext + demo-records>)`) dan `ctx.route` atas `/static/plugins/index.json` + `/static/plugins/demo-records/*` (pola R21 1a-1).
- **R24 — Ekspor.** `GET /api/export/download` (`webapp.py:7462`) menulis `plugin_states.json` (`plugin_states.get_states`) dan `plugin_records.json` (baris `user_id = uid`, `deleted = 0`: `{plugin_id, entity, id, scope, data, updated_at, version}`, urut `plugin_id, entity, id`); record `list:` tidak diekspor (milik workspace). Tabel tidak ada → berkas `[]`/`{}` (ekspor tidak boleh gagal).
- **R25 — Vektor bersama** `tests/fixtures/plugin_records_vectors.json`: `{"ids": {valid, invalid}, "entities": {valid, invalid}, "scopes": {valid, invalid}, "refs": [{value, server, client}], "sizes": [{data, maxBytes, error}], "manifests": [{records, permissions, error: null | "<awalan alasan>"}]}` — dibaca `tests/test_plugin_records.py`, `tests/offline/plugin_sync.test.js`, `tests/offline/plugin_records_api.test.js`, `tests/build-plugins.test.js`.

## Global Constraints

- IndexedDB `taskflow-offline` **v7** tepat sekali di Fase 1; `onupgradeneeded` hanya membuat store/indeks baru; `ENTITY_STORES` tidak berubah; **`DB_VERSION` tidak pernah diturunkan** (juga saat revert). `app.css` dan `app.css?v=382` tidak berubah; `index.html` ≤ +5 baris bersih dari 46.114; `TF.api.apiVersion` tetap `1`; `static/plugins/` (indeks produksi) tidak berubah — `node compile.js` dua kali tanpa diff, hash `habit-heatmap` sama.
- Endpoint baru hanya `GET` dan `POST /api/plugins/{plugin_id}/records`, keduanya `def`; semua baca-lalu-tulis lewat `dbconn.write_tx` (ADR-038 K3); `plugin_records.py` tidak memanggil `sqlite3.connect` dan tidak meng-import `webapp`/`repository`; `migrate_db` tetap 27 `dbconn.connect`.
- Skema server persis §5.2 (`seq`, `plugin_id`, `entity`, `id`, `owner_key`, `user_id`, `list_id`, `scope`, `data`, `updated_at`, `version`, `deleted`, `updated_by`, `server_at`; PK `(plugin_id, entity, owner_key, id)`; `CHECK ((user_id IS NULL) <> (list_id IS NULL))`; `ux_plugin_records_seq`; indeks parsial `ix_plugin_records_user`, `ix_plugin_records_list`; `plugin_records_meta`).
- Respons record: `{"entity", "id", "scope", "data", "updated_at", "version", "deleted"}`; GET `{"items", "cursor", "more"}` atau `{"reset": true}`; POST `{"results": [{"entity", "id", "applied", "record"} | {"entity", "id", "error", "detail"?}]}`. Kode: `PLUGIN_FORBIDDEN_TOKEN`, `PLUGIN_UNKNOWN`, `PLUGIN_UNAVAILABLE`, `TOO_LARGE`, `INVALID`, `FORBIDDEN_SCOPE`, `SCOPE_IMMUTABLE`.
- Klien: op `entity_type: "plugin"`; tepat **satu** op per record di `_outbox` setiap saat (coalescing `op_qid`); push satu item per POST; pull hanya untuk plugin ON; `plugin_kv` hanya untuk pembukuan sinkron (`_sync`) di PR ini.
- Event/teks: `window` `tf:plugin-records` `{pluginId, entity, ids, source, lost?}`; label izin `records` → `"Menyimpan data plugin di akunmu (ikut tersinkron)"`.
- Plugin contoh `demo-records` hanya di `tests/fixtures/plugins/` dan tidak pernah di `static/plugins/`.
- Setelah setiap task: `python3 -m pytest tests/ -q` hijau (1367 lama + baru, 1 skip) dan, untuk task klien, `npm test` (hanya gagal pra-ada `draw_local_reactive`).
- Commit `feat(plugin)`, `feat(sync)`, `feat(offline)`, `test(plugin)`, `docs(plugin)`, `chore(release)`; atribusi commit/PR sesi. Rilis mengikuti PROTOCOL §4.

## Review Focus

1. **Upgrade v6→v7** — data v6 di semua store (task, outbox, `_meta`, `_idmap`, `blobs`, note, komentar) utuh; tab lama kode 1a-1 menutup koneksi dan menawarkan muat ulang; tab pra-1a-1 / koneksi tanpa handler → banner `blocked` lalu lanjut sendiri setelah ditutup; **tidak ada jalur yang menurunkan versi** (R9; T3 + E2E skenario 7–8).
2. **Kursor `seq` tidak pernah melewatkan tulis** — edit offline lama yang baru terkirim tetap ditarik perangkat lain (kursor berbasis urutan commit server, bukan `updated_at` klien), dua penulis paralel tidak menghasilkan `seq` ganda (R5, R7; T1/T2).
3. **Keanggotaan workspace** — anggota lain melihat record `list:<id>`; anggota baru menarik penuh; anggota yang dikeluarkan tidak lagi menarik, record bersih terhapus lokal, op tertunda → `FORBIDDEN_SCOPE` → dibuang + record dihapus (R7, R12, R14; T2, T6, E2E skenario 5).
4. **Coalescing dan CAS** — selalu satu op per record; edit selama POST terbang tidak hilang dan tidak memicu LWW palsu; `applied: false` tidak menimpa edit yang lebih baru (R10–R12; T4–T5).
5. **Offline penuh + jendela deploy** — `api.records` bekerja tanpa jaringan sejak rilis terpasang; server lama (404 tanpa kode) tidak membuat op hilang; plugin OFF tetap push (R12, R14, R19; T5, E2E skenario 2, 6, 9).
6. **Rollback** — revert kode **tanpa** menurunkan `DB_VERSION`; dampaknya terdokumentasi (ADR-041, PR body).

---

### Task 1: `plugin_records.py` (murni) + `plugin_loader` (`records`, `/records` dicadangkan) + `plugin_host.list_access`

**Files:**
- Create: `plugin_records.py` (bagian murni: skema, validasi, kursor, `apply_item`, `purge`), `tests/fixtures/plugin_records_vectors.json`, `tests/test_plugin_records.py` (bagian unit)
- Modify: `plugin_loader.py` (`_read_index :74–86`, `load_known :89–100`, `refresh_known :103–113`, `_validate :184–206`, `migrate :316–322`, `_reset_for_tests :430–435`), `plugin_host.py` (+ `list_access`, `accessible_list_ids`), `task_ext.py` (+ `check_value`), `tests/fixtures/plugins/index.json` (+ `{"id": "demo-records", "defaultEnabled": false, "permissions": ["records"], "records": {"note": {"conflict": "lww", "maxBytes": 4096}}}`), `tests/test_plugin_loader.py` (tambah tes saja)

**Interfaces (Produces):**
- `plugin_loader.records_decl(pid) -> dict[str, dict]` (R3); `_read_index` → `(known, perms, records)`.
- `plugin_host.list_access(conn, uid: int, list_id: int) -> bool`; `plugin_host.accessible_list_ids(conn, uid: int) -> list[int]` (urut naik).
- `task_ext.check_value(value) -> str | None` (`"EXT_INVALID"` | `"EXT_TASK_REF"` | `None`).
- `plugin_records`: `ENTITY_RE`, `ID_RE = ^[A-Za-z0-9:@._-]{1,80}$`, `SCOPE_RE = ^(user|list:[1-9][0-9]{0,17})$`, `MAX_DATA_BYTES = 65536`, `TOMBSTONE_DAYS = 30`, `PURGE_INTERVAL_S = 3600`; `ensure_schema(conn) -> None` (DDL §5.2 idempoten, tanpa commit); `owner_key_for(uid, scope) -> tuple[str, int | None, int | None]`; `validate_item(item: dict, decl: dict) -> tuple[str, str] | None` (`("INVALID", detail)`); `fingerprint(list_ids) -> str`; `make_cursor(seq, fp) -> str`; `parse_cursor(s) -> tuple[int, str] | None` (`""` → `(0, None)`); `next_seq(conn) -> int`; `apply_item(conn, uid, pid, item, decl, now, access: set[int]) -> dict` (R6; dipanggil di dalam `write_tx` pemanggil); `fetch_page(conn, uid, pid, cursor_seq, limit, access, entity=None) -> (rows, more)`; `purge(conn, now) -> int`; `row_to_record(row) -> dict`; `_reset_for_tests()`.

- [ ] **Step 1: Tulis tes gagal** `tests/test_plugin_records.py` (unit; DB `tmp_path` lewat `dbconn.connect` + tabel `users`/`shared_lists`/`list_members` minimal; fixture `demo_index` = `plugin_loader.load_known(FIXTURES / "index.json")`, teardown `plugin_loader.load_known()`):
  - `test_ensure_schema_idempotent`: dua kali tanpa error; kolom/PK/CHECK/indeks persis §5.2 (`PRAGMA table_info`, `index_list`); `plugin_records_meta` ada.
  - `test_vectors`: id/entitas/scope/ref/ukuran dari vektor bersama (sisi `server`).
  - `test_owner_key_and_check`: `user` → `("u:7", 7, None)`; `list:12` → `("l:12", None, 12)`; INSERT dengan `user_id` dan `list_id` keduanya terisi → `IntegrityError` (CHECK).
  - `test_seq_monotonic_two_threads`: dua thread × 50 `apply_item` masing-masing dalam `write_tx` sendiri → `seq` = 1..100 tanpa ganda; tanpa `write_tx` tidak diuji (ADR-038 sudah membuktikan).
  - `test_lww_rules`: insert → version 1; `base 1` → version 2; `base` tertinggal + `updated_at` lebih lama → `applied False` + baris server, `seq` tidak naik; `base` tertinggal + lebih baru → diterapkan; `updated_at` klien di masa depan dipotong ke `now`; `updated_at` rusak di DB → kiriman menang.
  - `test_idempotent_resend`: kirim A (base 0) → v1; kirim A lagi (base 0, isi sama, `updated_by` sama) → `applied True`, version tetap 1, `seq` tidak naik; isi beda → LWW biasa.
  - `test_delete_semantics`: tombstone → `deleted 1`, `data '{}'`, version naik; delete untuk id tidak ada → `applied True, record None`, tanpa baris.
  - `test_forbidden_and_immutable_scope`: `list:99` tanpa akses → `FORBIDDEN_SCOPE`; id sama sudah ada di `u:<uid>` lalu dikirim `list:12` → `SCOPE_IMMUTABLE`; id sama di `u:<pengguna lain>` → bukan konflik (insert biasa).
  - `test_cursor_fingerprint_reset`: `parse_cursor("")` → `(0, None)`; `"rusak"`/`"2.1.abc"` → `None`; `fingerprint([3, 1])` == `fingerprint([1, 3])`; panjang 8 hex.
  - `test_fetch_page_visibility_and_more`: baris `u:A`, `u:B`, `l:12` (A anggota) → A melihat `u:A` + `l:12` saja, `ORDER BY seq`, `limit` + `more`, filter `entity`, plugin lain tidak terlihat.
  - `test_purge`: tombstone `server_at` 31 hari lalu dihapus, 29 hari tetap; `purged_seq` = seq terbesar yang dihapus; baris hidup tidak tersentuh.
  - `test_cascade`: hapus `shared_lists` (FK ON) → baris `l:` ikut terhapus; hapus `users` → baris `u:` terhapus.
  - `test_plugin_loader_records_decl` (di `tests/test_plugin_loader.py`): fixture → `records_decl("demo-records") == {"note": {"conflict": "lww", "maxBytes": 4096}}`; `records_decl("demo-ext") == {}`; entri `conflict: "merge"` / nama `Bad` dilewati + `WARNING`; `known()["demo-records"] == {"defaultEnabled": False}`.
  - `test_router_records_path_reserved` (di `tests/test_plugin_loader.py`): modul plugin tmp dengan `@router.get("/records")` atau `"/records/x"` → ditolak `"rute /records dicadangkan host"`; `"/recordsx"` diterima.
  - `test_migrate_creates_plugin_records`: `plugin_loader.migrate(db)` membuat `plugin_states` dan `plugin_records`; `plugin_records.ensure_schema` yang dipaksa melempar (monkeypatch) → `migrate` tidak melempar, `plugin_states` tetap dibuat, log `ERROR`.
  - `test_list_access`: pemilik dan anggota True, lainnya False; `accessible_list_ids` urut dan unik.
- [ ] **Step 2: Jalankan → FAIL** `python3 -m pytest tests/test_plugin_records.py tests/test_plugin_loader.py -q` (`ModuleNotFoundError: plugin_records`).
- [ ] **Step 3: Implementasi** (R1, R3, R5–R8); `task_ext.check_value` hanya membungkus `_check_value` (kode → string, tanpa mengubah perilaku `clean_patch`).
- [ ] **Step 4: Jalankan → PASS**; `python3 -m pytest tests/test_plugin_records.py tests/test_plugin_loader.py tests/test_task_ext.py tests/test_dbconn_callsites.py tests/ -q` hijau.
- [ ] **Step 5: Commit** `feat(plugin): plugin_records — skema, kursor seq, LWW base_version; deklarasi records di plugin_loader`

### Task 2: Endpoint `GET/POST /api/plugins/{id}/records` + ekspor

**Files:**
- Modify: `plugin_records.py` (`router`, model pydantic `RecordItem`/`RecordsPost`), `webapp.py` (`import plugin_records` di blok `:147–149`; `include_router` R2 di `:10870–10871`; ekspor `:7462` setelah blok Mindmaps)
- Test: `tests/test_plugin_records.py` (bagian HTTP lewat `client` conftest; pola pengguna/workspace `tests/test_task_update_notify_coalesce.py` — `U`, `_mk_list`)

**Interfaces:**
- Consumes: Task 1.
- Produces: `GET /api/plugins/{plugin_id}/records?cursor=&limit=500&entity=` dan `POST /api/plugins/{plugin_id}/records` (`def`, R4, R7, R8, §6.2); `RecordItem {entity: str, id: str, scope: str, data: dict = {}, deleted: StrictBool = False, updated_at: str, base_version: int | None = None}`; `RecordsPost {items: conlist(RecordItem, min_length=1, max_length=50)}`.

- [ ] **Step 1: Tulis tes gagal** (fixture `demo_index`; pengguna A, B, C; workspace W milik A dengan B anggota):
  - `test_auth_and_errors`: tanpa token 401; token clipper (`scope: "ext"`) 403 `PLUGIN_FORBIDDEN_TOKEN`; id `Bad`/`state` 404 `PLUGIN_UNKNOWN`; `demo-ext` (tanpa izin `records`) 404 `PLUGIN_UNKNOWN`; `index_ok` false → 503 `PLUGIN_UNAVAILABLE`; id belum dikenal tetapi ada di indeks baru di disk → `refresh_known` dipanggil sekali lalu 200; `entity=lain` → 422; `limit=0`/`1001` → 422; `Content-Length` 300 KB → 413 `TOO_LARGE`; 51 item → 422.
  - `test_plugin_off_still_accepts`: `demo-records` OFF untuk A (`PUT /api/plugins/state/demo-records {enabled: false}`) → POST dan GET tetap 200 (K9).
  - `test_post_get_roundtrip_and_cursor`: A POST `note/n1` scope `user` → `applied True`, `version 1`; GET kosong-kursor → item `n1`, `more False`, kursor `1.<seq>.<fp>`; GET dengan kursor itu → `items []`, kursor sama; A POST lagi → GET kursor lama → hanya item yang berubah.
  - `test_offline_edit_arrives_late_still_pulled` (Review Focus 2): B menarik (kursor K); A mengirim item ber-`updated_at` kemarin (edit offline) → GET B dari K memuatnya (berkat `seq`).
  - `test_workspace_sharing`: A POST `list:W` → B GET melihatnya; B POST update dengan `base_version` terbaru → `applied True`, `version 2`, `updated_by` B; A GET kursor lama → versi B; C (bukan anggota) GET → tidak melihat, POST `list:W` → `FORBIDDEN_SCOPE`.
  - `test_membership_change_resets_cursor`: B GET → kursor KB; B dikeluarkan dari W (`DELETE` anggota lewat API yang ada atau SQL langsung) → B GET KB → `{"reset": true}`; B GET kosong → tanpa record `list:W`; B POST `list:W` → `FORBIDDEN_SCOPE`; C ditambahkan ke W → GET kursor lama C → `reset`, GET kosong → record W lengkap (Review Focus 3).
  - `test_purge_resets_old_cursor`: tombstone tua + kursor sebelum `purged_seq` → `reset`; purge hanya sekali per jam (monkeypatch waktu).
  - `test_isolation_between_users`: `u:A` tidak pernah terlihat B; id sama `cal@user` milik A dan B hidup berdampingan.
  - `test_batch_one_tx_mixed_results`: satu POST tiga item (sah, `INVALID` size, `FORBIDDEN_SCOPE`) → hasil per item urut, item sah tersimpan, `seq` naik tepat satu.
  - `test_table_missing_returns_503`: `DROP TABLE plugin_records` → GET/POST 503 `PLUGIN_UNAVAILABLE`.
  - `test_export_contains_plugin_files`: A punya status plugin + record `user` + record `list:W` → ZIP `GET /api/export/download` memuat `plugin_states.json` (`demo-records`) dan `plugin_records.json` (hanya record `user`, tanpa tombstone); tanpa tabel → `[]`.
  - `test_route_order`: `app.routes` — rute host `/api/plugins/{plugin_id}/records` terdaftar sebelum rute router plugin mana pun; `tests/test_dbconn_callsites.py` lulus tanpa diubah.
- [ ] **Step 2: Jalankan → FAIL** (404 rute tidak ada).
- [ ] **Step 3: Implementasi**: GET = cek R4 → `get_conn` → hitung akses + `fp` → reset/halaman → purge bila jatuh tempo (`write_tx` terpisah); POST = cek R4 + `Content-Length` → satu `get_conn` + `write_tx` → `apply_item` per item; `OperationalError` → 503 (R1). Ekspor R24.
- [ ] **Step 4: Jalankan → PASS**; `python3 -m pytest tests/ -q` hijau; asap `DB_PATH=/tmp/asap.db python3 -c "import webapp; webapp.migrate_db(); webapp.migrate_db(); print('ok')"` dan `python3 -c "import bot"`.
- [ ] **Step 5: Commit** `feat(plugin): GET/POST /api/plugins/{id}/records — kursor seq, reset keanggotaan, LWW; ekspor data plugin`

### Task 3: IndexedDB v7 (`db.js`)

**Files:**
- Modify: `static/offline/db.js` (`DB_VERSION :12–14`, `createSchema :109–127`, ekspor `:239–244`), `tests/offline/chatdb.test.js:9–10`, `tests/offline/db.test.js:66`, `tests/offline/commentdb.test.js:11`, `tests/offline/db_versionchange.test.js:31–32` (R20)
- Create: `tests/offline/db_v7.test.js`, `tests/fixtures/idb_v6_schema.json` (daftar store/indeks v6 persis, dipakai juga E2E)

**Interfaces (Produces):** `TF.db.DB_VERSION === 7`; `TF.db.PLUGIN_STORES = {plugin_records: {keyPath, indexes: [[name, keyPath]]}, plugin_kv: {keyPath, indexes: []}}`; `ENTITY_STORES`/`ENTITY_STORE_NAMES` tidak berubah.

- [ ] **Step 1: Ubah tes lama (R20) dan tulis tes gagal** `db_v7.test.js`:
  - `"skema v7: plugin_records keyPath + empat indeks, plugin_kv keyPath; ENTITY_STORE_NAMES tidak memuat store plugin"`.
  - `"upgrade v6 → v7 mempertahankan seluruh data lama"` (Review Focus 1): buat DB v6 mentah dari `idb_v6_schema.json` (semua `ENTITY_STORES` + `_meta`, `_idmap`, `_outbox` autoIncrement, `blobs`), isi `tasks` (dengan `ext`/`ext_dirty`), `_outbox` (3 op, qid 1–3), `_meta` (`plugins:state:v1`), `_idmap`, `blobs`, `note_comments`; tutup → `_reset()` → `openDB()` → `db.version === 7`, setiap store berisi record yang sama persis (deep-equal), indeks lama utuh (`indexNames` sama), qid outbox berikutnya = 4, dua store baru kosong.
  - `"upgrade v1 legacy → v7"` (pola `db.test.js:37`): store `queue` dipindah, `cache` dihapus, store plugin ada.
  - `"dirty 0/1 dan indeks majemuk"`: record `dirty: 1` muncul di `entity_dirty` `only([pid, entity, 1])`, `dirty: true` tidak (bukti K3).
  - `"tab lain (koneksi v6 tanpa handler) menahan upgrade → event blocked; ditutup → openDB resolve v7 + unblocked"` (mekanisme 1a-1, `subscribe`).
  - `"koneksi v7 menerima versionchange dari tab lain (open mentah v8) → DB_UPGRADED_ELSEWHERE"` (tes 1a-1 dengan `DB_VERSION` baru tetap lulus).
  - `"rollback: kode yang membuka v6 pada DB v7 → VersionError"` (open mentah v6 setelah v7) dan `"sumber db.js tidak pernah DB_VERSION < 7"` (regex) — mengunci larangan menurunkan versi.
  - `"clearAll mengosongkan plugin_records dan plugin_kv"`.
- [ ] **Step 2: Jalankan → FAIL** `node --test tests/offline/db_v7.test.js`.
- [ ] **Step 3: Implementasi** (R9).
- [ ] **Step 4: Jalankan → PASS**, `npm test` (`db.test.js`, `chatdb.test.js`, `commentdb.test.js`, `db_versionchange.test.js`, `user_session_isolation.test.js` lulus).
- [ ] **Step 5: Commit** `feat(offline): IndexedDB v7 — store plugin_records dan plugin_kv (tanpa memindah data)`

### Task 4: `plugin_sync.js` — penyimpanan lokal, coalescing `op_qid`, `onChange`

**Files:**
- Create: `static/offline/plugin_sync.js` (UMD seperti `pluginstate.js`; `require("./db.js")`, `./taskext.js`, `./ids.js` di Node), `tests/offline/plugin_sync.test.js`
- Modify: `static/offline/taskext.js` (ekspor `checkValue(v) -> code | null` dan `refOk`)

**Interfaces (Produces `TF.pluginsync`):** `ENTITY = "plugin"`; `opCid(pid, entity, id)`; `put(pid, entity, id, data, {scope, decl}) -> Promise<record>` (validasi R8/R17; id `null` → `newId()`; scope berbeda dari record yang ada → `Error` `code "SCOPE_IMMUTABLE"`; ukuran > `decl.maxBytes` → `code "TOO_LARGE"`; menghapus `sync_error`; `updated_at = new Date().toISOString()`); `get(pid, entity, id) -> Promise<record | null>` (tombstone → `null`); `list(pid, entity, {scope, limit, after}) -> Promise<{items, next}>`; `remove(pid, entity, id) -> Promise<boolean>` (R11; tidak ada → `false`); `subscribe(fn) -> off` (`{pluginId, entity, ids, source, lost?}`) + `window` `tf:plugin-records`; `newId()`; `toPublic(rec) -> {entity, id, scope, data, updated_at, version, pending, error?}`; `kvGet/kvSet(pid, scope, key[, value])`; `_internals` untuk tes.

- [ ] **Step 1: Tulis tes gagal** (`fake-indexeddb`, `deleteDB` per tes):
  - `"put baru → record dirty 1, version null, satu op upsert dengan cid pid/entity/id, op_qid = qid"`.
  - `"20 put pada record yang sama → tepat satu op di _outbox, op_qid menunjuk op terakhir, payload = isi terakhir"` (K11, Review Focus 4).
  - `"put dan op ditulis atomik: transaksi gagal (abort dipaksa) → record dan outbox tidak berubah"`.
  - `"remove → tombstone (deleted 1, dirty 1) + op delete menggantikan op upsert; get/list tidak mengembalikannya; remove record tak ada → false tanpa op"` (R11).
  - `"list: urut id, limit/next, after, filter scope lewat indeks entity_scope; tombstone dilewati; limit 1–1000"`; `"list entitas lain / plugin lain tidak bocor"`.
  - `"vektor bersama (sisi client)": id/entitas/scope/ukuran/ref`; `"scope tidak bisa diubah"`; `"data bukan objek / fungsi / NaN → INVALID"`; `"ref $task cid string dan angka diterima, {$task: 1.5} ditolak"`.
  - `"subscribe: put/remove memancarkan source local setelah transaksi selesai; pendengar error tidak memutus pendengar lain"`.
  - `"toPublic: pending = dirty 1, error dari sync_error, data salinan dalam (mutasi hasil tidak mengubah IndexedDB)"`.
  - `"kvGet/kvSet: keyPath [plugin_id, scope, key]"`.
- [ ] **Step 2: Jalankan → FAIL** `node --test tests/offline/plugin_sync.test.js`.
- [ ] **Step 3: Implementasi** (R10, R11, R17 sisi penyimpanan).
- [ ] **Step 4: Jalankan → PASS**, `npm test` (`taskext.test.js` lulus tanpa diubah).
- [ ] **Step 5: Commit** `feat(offline): TF.pluginsync — record plugin lokal, satu op per record (op_qid), onChange`

### Task 5: Push — `pushOp`, cabang `entity_type: "plugin"` di `syncpush`, heal, tulis ulang `$task`

**Files:**
- Modify: `static/offline/plugin_sync.js` (`pushOp`, `healStranded`, `rewriteTaskRefs`), `static/offline/syncpush.js` (`pluginSync()` malas di samping `pluginState()` `:27–29`; `opPluginRecord` di samping `opPluginStateSet :803–818`; `processOp :2276` satu baris sebelum fallback `:2277`; `pushOutbox :2389` `.then(() => healStrandedPluginRecords())`; POST task sukses `:612` `.then(() => rewritePluginTaskRefs(op.cid, sid))`)
- Test: `tests/offline/plugin_sync_push.test.js` (baru; `fakeTransport` pola `tests/offline/syncpush.test.js:14–41`, lewat `syncpush.pushOutbox` sungguhan)

**Interfaces:**
- Consumes: Task 4; `syncpush.send`, `ok`, `resolveExtRefs`, `pendingCreateCids`; `TFidmap.serverIdOf`.
- Produces: `TF.pluginsync.pushOp(op, {send, pending, resolveRefs, result}) -> Promise` (R12, R13); `healStranded(knownIds | null) -> Promise<number>` (R16; `knownIds` dari `TF.plugins.knownIds()` bila ada); `rewriteTaskRefs(cid, sid) -> Promise<number>` (R13). Di `syncpush`: `opPluginRecord(op, transport, result, pending)` meneruskan `send = (m, p, b) => send(transport, m, p, b)` dan `resolveRefs = resolveExtRefs`; modul tidak ada (cache SW lama) → op dibiarkan (`null`).

- [ ] **Step 1: Tulis tes gagal**:
  - `"upsert → POST /api/plugins/demo-records/records satu item {entity, id, scope, data, deleted:false, updated_at, base_version:null}; applied → dirty 0, version server, op hilang"`.
  - `"base_version = version terbaru saat kirim, bukan saat antre"`.
  - `"edit selama POST terbang (put di dalam transport) → op baru tetap, record tetap dirty dengan data baru, version = versi server"` (Review Focus 4).
  - `"applied:false + op tidak berubah → adopsi baris server, onChange lost [id]"`; `"applied:false + edit selama terbang → data lokal baru dipertahankan, op baru tetap"`.
  - `"tombstone applied (record null) → record dihapus keras"`.
  - `"FORBIDDEN_SCOPE → record dan op dihapus, onChange lost"`; `"INVALID / SCOPE_IMMUTABLE → op dibuang, sync_error, result.failed 1; put berikutnya menghapus sync_error"`.
  - `"404 PLUGIN_UNKNOWN → op dibuang + sync_error; heal tidak mengantre ulang"`; `"404 tanpa kode (jendela deploy) → op tetap, request sekali per drain"`; `"503 → op tetap (retry)"`; `"401 → drain berhenti, op tetap"`.
  - `"op basi (sudah di-coalesce saat drain memakai snapshot) → tidak ada request"`.
  - `"$task ke cid ber-create antre → op ditahan tanpa request; setelah POST task sukses di drain yang sama rewriteTaskRefs menulis id server → drain berikut mengirim angka"`; `"$task ke cid tanpa id dan tanpa create → null di payload, data lokal tetap"`; `"rewriteTaskRefs tidak mengubah updated_at"`.
  - `"heal: record dirty tanpa op (outbox dikosongkan) → satu op baru; record ber-sync_error / plugin tidak di indeks → tidak"`.
  - `"modul pluginsync tidak ada → op plugin tetap antre (tidak dibuang fallback)"`; `"semua tes syncpush*.test.js lama lulus tanpa diubah"`.
- [ ] **Step 2: Jalankan → FAIL** `node --test tests/offline/plugin_sync_push.test.js`.
- [ ] **Step 3: Implementasi** (R12, R13, R16).
- [ ] **Step 4: Jalankan → PASS**, `npm test`.
- [ ] **Step 5: Commit** `feat(sync): push record plugin — satu item per POST, CAS op_qid, $task ditahan dan ditulis ulang`

### Task 6: Pull — `pullAll`, `syncpull.pullPluginRecords`, reset + sapu, penjaga pemilik

**Files:**
- Modify: `static/offline/plugin_sync.js` (`pullAll`, `ensureOwner`), `static/offline/syncpull.js` (`pluginSync()` malas + `pullPluginRecords` + ekspor `:1978–1988`)
- Test: `tests/offline/plugin_sync_pull.test.js` (baru; `rawFetch` palsu yang menjawab skenario per URL)

**Interfaces:**
- Produces: `TF.pluginsync.pullAll(rawFetch, {userId, ids}) -> Promise<{plugins: {[pid]: {pulled, removed, reset, pages}}, errors: [...]}>` (R14, R15; memancarkan `onChange` source `"sync"` per entitas, `ids` = yang ditulis/dihapus); `TF.syncpull.pullPluginRecords(rawFetch, opts)` (modul tidak ada → `null`).

- [ ] **Step 1: Tulis tes gagal**:
  - `"tarik penuh pertama: dua halaman (more) → semua record bersih, kursor di plugin_kv, gen 1, resetting false"`.
  - `"delta: hanya item baru/berubah; tombstone → record lokal dihapus"`.
  - `"record lokal dirty tidak ditimpa pull (data, op_qid tetap)"`.
  - `"reset (keluar workspace): kursor dikosongkan, tarik penuh, record list:W bersih yang tidak terlihat dihapus, record dirty list:W dipertahankan (lalu FORBIDDEN_SCOPE di push)"` (Review Focus 3).
  - `"anggota baru: reset → tarik penuh memasukkan record list:W lama"`.
  - `"terputus di tengah tarik penuh (halaman 2 gagal) → sinkron berikut lanjut dari kursor dengan gen sama; sapu hanya setelah halaman terakhir"`.
  - `"reset dua kali dalam satu sinkron → berhenti (tanpa loop)"`; `"≤ 50 halaman per plugin per sinkron"`.
  - `"halaman ditulis atomik: kursor tidak maju bila transaksi record gagal"`.
  - `"404 PLUGIN_UNKNOWN → plugin dilewati; 404 tanpa kode → error dilaporkan, plugin lain tetap ditarik"`.
  - `"hanya ids yang diberikan (plugin ON) yang ditarik"` (R19).
  - `"pemilik berbeda → record, kv, dan op plugin akun lama dihapus sebelum request; pemilik sama → tidak"` (R15).
- [ ] **Step 2: Jalankan → FAIL**.
- [ ] **Step 3: Implementasi.**
- [ ] **Step 4: Jalankan → PASS**, `npm test` (semua `syncpull*.test.js` lama lulus tanpa diubah).
- [ ] **Step 5: Commit** `feat(sync): pull record plugin — kursor seq, reset keanggotaan dengan sapu record bersih`

### Task 7: `compile.js` — `records` + plugin contoh `demo-records`

**Files:**
- Modify: `compile.js` (`OPTIONAL_FIELDS :90` + `"records"`, `validateRecords` di samping `validateTaskExt :161`, `readManifest :199–219`, ekspor `:295`)
- Create: `tests/fixtures/plugins/demo-records/manifest.json`, `tests/fixtures/plugins/demo-records/plugin.jsx`
- Test: `tests/build-plugins.test.js`

**Interfaces (Produces):** `validateRecords(m) -> string | null` (R18, vektor `manifests`). `demo-records` manifest: `{"id": "demo-records", "name": "Demo Records", "description": "Plugin contoh khusus tes (tidak dirilis).", "version": "1.0.0", "minApi": 1, "defaultEnabled": false, "slots": ["taskList.views"], "permissions": ["records"], "contributes": {"taskList.views": [{"id": "recs", "label": "Demo Rec", "icon": {"path": "M3 3h10v10H3zM5 6h6M5 9h4"}, "pages": ["project", "workspace"]}]}, "records": {"note": {"conflict": "lww", "maxBytes": 4096}}}`. `plugin.jsx`: view `recs` — scope = `"list:" + context.listId` di halaman workspace, `"user"` di halaman project; `api.records.list("note", {scope})` saat mount dan setiap `onChange` entitas `note`; input `data-testid="dr-input"` + tombol "Tambah" (`api.records.put("note", null, {text, task}, {scope})` dengan `task = {"$task": context.tasks[0].id}` bila ada task, selain itu tanpa kunci `task`; plugin tidak memakai `api.taskExt`), tombol "Tambah (ref)" `data-testid="dr-add-ref"` untuk skenario E2E 4, per item `data-testid="dr-item"` berisi teks, penanda `"(menunggu sinkron)"` bila `pending`, `"(gagal: <error>)"` bila `error`, tombol "Ubah" (menambah " ✓" ke teks) dan "Hapus"; `lost` → baris `data-testid="dr-lost"` `"Perubahan kalah: <id>"`.

- [ ] **Step 1: Tulis tes gagal** di `tests/build-plugins.test.js`:
  - `"fixture demo-records: records disalin ke index.json dan konstanta manifest"` (bangun salinan ke tmp).
  - `"vektor manifests: records salah (conflict merge/manual, nama entitas Bad, maxBytes 0/70000, records kosong) → PluginBuildError dengan alasan vektor"`.
  - `"izin records tanpa records / records tanpa izin records → error"`.
  - `"habit-heatmap dan demo-ext: index.json dan hash tidak berubah"`.
- [ ] **Step 2: Jalankan → FAIL** `node --test tests/build-plugins.test.js`.
- [ ] **Step 3: Implementasi.**
- [ ] **Step 4: Jalankan → PASS**; `node compile.js --plugins-only` dua kali → `git status` bersih.
- [ ] **Step 5: Commit** `feat(plugin): compile.js menyalin manifest.records; plugin contoh demo-records`

### Task 8: Runtime — izin `records`, `api.records`, `recordPluginIds`

**Files:**
- Modify: `static/plugin-runtime.js` (`KNOWN_PERMISSIONS`/`RESERVED_PERMISSIONS :20–21`, `recordsError` + `validateManifest :325–349`, `NODE_PATHS :38–47` + `pluginsync`, `recordPluginIds` di samping `knownIds :527`, `makeRecords` di samping `makeTaskExt :1158`, `api.for :1264–1282`, ekspor `:1438–1440`)
- Test: `tests/offline/plugin_records_api.test.js` (baru), `tests/offline/plugin_registry.test.js:37–39` (R20)

**Interfaces:**
- Consumes: Task 4 (`TF.pluginsync`), Task 7 (bentuk `records` di indeks).
- Produces: `plugins.recordPluginIds() -> string[]` (urut; indeks belum dimuat → `[]`); `api.for(id).records = {get, list, put, remove, onChange, newId}` (R17) — selalu ada di `api`; tanpa izin `records` setiap fungsi → `PluginPermissionError` (`markFailed("permission")`); entitas tidak di `manifest.records` → `PluginStorageError`; error penyimpanan (`INVALID`, `TOO_LARGE`, `SCOPE_IMMUTABLE`) → `PluginStorageError` dengan `code`; `onChange` hanya meneruskan peristiwa plugin sendiri, pendengar error → `markFailed(id, "listener")`, `off()` idempoten; deklarasi `maxBytes` diteruskan ke `pluginsync.put`.

- [ ] **Step 1: Ubah tes lama (R20) dan tulis tes gagal** `plugin_records_api.test.js` (indeks berisi `demo-records`, `demo-ext`, `habit-heatmap`; IndexedDB palsu):
  - `"validateManifest: records diterima dengan izin records; vektor manifests (sisi runtime) sama dengan compile.js"`.
  - `"recordPluginIds: hanya plugin ON berizin records"`.
  - `"put/get/list/remove lewat api.for('demo-records').records → bentuk publik {entity,id,scope,data,updated_at,version,pending}"`; `"put id null → id uuid"`; `"newId unik"`.
  - `"entitas tidak dideklarasikan / data terlalu besar (> 4096) / scope list:abc → PluginStorageError tanpa menulis"`.
  - `"tanpa izin records (demo-ext) → PluginPermissionError untuk semua fungsi, failures bertambah"`.
  - `"onChange: local dari put, sync dari pull (pluginsync palsu memancarkan), lost diteruskan; peristiwa plugin lain tidak sampai; pendengar error dihitung"`.
  - `"tombstone dan record plugin lain tidak pernah dikembalikan"`.
- [ ] **Step 2: Jalankan → FAIL** `node --test tests/offline/plugin_*.test.js`.
- [ ] **Step 3: Implementasi.**
- [ ] **Step 4: Jalankan → PASS**, `npm test`.
- [ ] **Step 5: Commit** `feat(plugin): TF.api.records — get/list/put/remove/onChange, izin records`

### Task 9: Sambungan host `index.html` + SW `STATIC`

**Files:**
- Modify: `static/index.html` (`<script>` setelah `pluginstate.js :373`; langkah `sync()` di antara `:1364` dan `:1365`; label izin `:27226`), `static/sw.js` (`STATIC` setelah `"/static/offline/pluginstate.js",` `:59`)
- Test: `tests/offline/plugin_host_wiring.test.js`, `tests/offline/plugin_settings_ui.test.js`

**Interfaces:**
- Consumes: Task 6, Task 8.
- Produces (teks yang diperiksa tes):
  - `<script src="/static/offline/plugin_sync.js"></script>` tepat setelah `pluginstate.js`, sebelum `syncpush.js`/`syncpull.js` dan `plugin-runtime.js`; di `STATIC` tepat setelah `pluginstate.js`.
  - Langkah `.then(() => step(() => (window.TF.syncpull.pullPluginRecords ? window.TF.syncpull.pullPluginRecords(__syncRawFetch, { userId: runUid, ids: window.TF.plugins?.recordPluginIds?.() ?? [] }) : null)))` setelah langkah `pluginstate.pull` dan sebelum `syncpush.pushOutbox(__syncTransport)`.
  - Label `p === "records" ? "Menyimpan data plugin di akunmu (ikut tersinkron)"` di baris `perm` yang sama.

- [ ] **Step 1: Tulis tes gagal**:
  - `plugin_host_wiring`: urutan/keunikan `<script>` + `STATIC`; langkah `pullPluginRecords(__syncRawFetch` di dalam `step(` setelah `pluginstate.pull(__syncRawFetch` dan sebelum `syncpush.pushOutbox(__syncTransport)`, memuat `userId: runUid` dan `recordPluginIds`; `"anggaran PR 1a-2: index.html ≤ 46119 baris"` (R21); tes anggaran Fase 1 (`BASELINE_LINES = 46095`, `MAX_ADDED_LINES = 60`) tidak diubah.
  - `plugin_settings_ui`: label izin `records`.
- [ ] **Step 2: Jalankan → FAIL**.
- [ ] **Step 3: Implementasi** (edit langsung `index.html` terkompilasi, gaya sekitarnya).
- [ ] **Step 4: Jalankan → PASS**: `npm test`, `python3 -m pytest tests/test_plugins_node.py tests/test_sw_precache_node.py -q`, `node temporary_files/check_inline_scripts.js static/index.html` (OK), `wc -l static/index.html` ≤ 46119.
- [ ] **Step 5: Commit** `feat(plugin): sambungkan sinkron record plugin ke sync() dan precache`

### Task 10: Rilis — SW v492, whatsnew `silent`, README, ADR-041, pola tes CI

**Files:**
- Modify: `static/sw.js` (`CACHE`), `static/index.html` (`__SW_VERSION :270` + fallback `:28004`), file `static/`+`tests/` bervers lama (sed **kecuali** `static/whatsnew.json`), `static/whatsnew.json`, `tests/test_plugins_node.py`, `docs/plugins/README.md`, `.agents/DECISIONS.md`

- [ ] **Step 1: Versi** `taskflow-v491-plugin-ext` → `taskflow-v492-plugin-records` (R22); `app.css?v=382` tetap.
- [ ] **Step 2: whatsnew** entri teratas `{"version": "taskflow-v492-plugin-records", "date": "<tanggal rilis WIB>", "silent": true}`.
- [ ] **Step 3: `tests/test_plugins_node.py`**: `PATTERNS` += `db_v7.test.js` (pola `plugin_*.test.js` sudah mencakup `plugin_sync*.test.js` dan `plugin_records_api.test.js`); `REQUIRED` += `"db_v7", "plugin_sync", "plugin_sync_push", "plugin_sync_pull", "plugin_records_api"`.
- [ ] **Step 4: README** judul "(Fase 0a–1a)" tetap; §3 izin `records` + `manifest.records` (`conflict: "lww"` saja, `maxBytes` ≤ 64 KB, ≤ 16 entitas; contoh `demo-records`); §5 `api.records` (bentuk record, `pending`/`error`, `list` lewat indeks dan halaman `next`, scope `user`/`list:<id>` tidak bisa diubah, id deterministik **wajib menyandikan scope** (`cal@list:12`) atau uuid `newId()` — id sama di dua scope yang terlihat satu pengguna ditolak `SCOPE_IMMUTABLE`, `$task` lewat `api.taskExt.ref`, `onChange` + `lost`, bekerja offline, plugin OFF tetap mengirim tetapi tidak menarik); §8 "jangan simpan data per task di record — pakai `task.ext`"; §11 server: tabel `plugin_records` milik host (bukan `plg_*`), rute `/records` dicadangkan, endpoint tidak mensyaratkan ON, kursor `seq`, restart dua layanan.
- [ ] **Step 5: ADR-041** "Record plugin (`plugin_records`) dengan kursor `seq`, IndexedDB v7, `api.records`" (Date / Agent / Context / Decision / Consequences, format ADR-040): Context (B5–B9; `updated_at` record = waktu edit klien sehingga keyset `(updated_at, id)` Lampiran A #2 melewatkan edit offline yang terlambat; `pluginstate.setLocal` memindai seluruh `_outbox` (`pluginstate.js:107–117`) dan `outbox.js` tanpa indeks; anggota baru/keluar workspace butuh tarik ulang; boolean bukan kunci IndexedDB sah); Decision (K3, K8–K11 + R1–R19: skema dan indeks, `seq` di `write_tx`, sidik jari keanggotaan, LWW `base_version` + idempotensi, tidak mensyaratkan ON, satu op per record lewat `op_qid`, CAS, tombstone lokal, `$task`, sapu setelah tarik penuh, penjaga pemilik, `api.records`, izin `records`, ekspor; penyimpangan dari Lampiran B7: indeks parsial `seq` menggantikan `(user_id, plugin_id, entity, updated_at, id)`); Consequences (bump v7 sekali dan **tidak pernah turun** — revert = rilis baru yang mempertahankan `DB_VERSION = 7` + `PLUGIN_STORES`; op `plugin` di klien hasil revert dibuang fallback `processOp` (`syncpush.js:2277`) → record yang belum terkirim hilang, sebelum 1b rilis praktis tanpa data nyata; tabel `plugin_records` dibiarkan; perubahan keanggotaan memicu tarik penuh per plugin ON; LWW waktu klien rentan selisih jam perangkat; konflik record belum tampil di bilah konflik (hanya `error`/`lost` ke plugin); restart dua layanan; tab pra-1a-1 tetap bisa menahan upgrade — banner `blocked`).
- [ ] **Step 6: Verifikasi** `python3 -m pytest tests/test_whatsnew.py tests/test_sw_precache_node.py tests/test_app_update_node.py -q` (PROTOCOL §4 butir 5), `npm test`, `python3 -m pytest tests/ -q`, `node compile.js` idempoten.
- [ ] **Step 7: Commit** `chore(release): SW v492 plugin-records (silent), README records, ADR-041`

### Task 11: E2E Playwright

**Files:**
- Create: `temporary_files/e2e_app_demo_records.py` (R23; memeriksa `demo-records` berizin `records` dan `records_decl` memuat `note`), `temporary_files/e2e_plugin_fase1_1a2.py` (pola `temporary_files/e2e_plugin_fase1_1a1.py`: `import e2e_hero_dashboard as hd`, `hd.seed`, `hd.check`, tangkapan ke `temporary_files/e2e_plugin_fase1_1a2/`; konteks `service_workers="block"`; tidak di CI)

**Skenario** (U1 di konteks A dan B — dua perangkat satu akun; U2 di konteks C, anggota workspace W milik U1; `demo-records` ON untuk U1 dan U2 lewat `PUT /api/plugins/state/demo-records`; sinkron `window.__syncNow()` lalu tunggu `__syncState.running === false`; baca IndexedDB lewat `page.evaluate`):
1. **Bersama workspace:** A di `slist_<W>` › tombol "Demo Rec" → "Tambah" "halo" → item tampil "(menunggu sinkron)" → sinkron → penanda hilang, server `GET …/records` memuat `list:W`; C sinkron → "halo" tampil di view C; C "Ubah" → A sinkron → "halo ✓"; B (perangkat kedua U1) sinkron → sama.
2. **Offline penuh:** A `ctx.set_offline(True)` → tambah 3, ubah salah satu 5×, hapus satu → view langsung benar dari IndexedDB; `_outbox` berisi tepat satu op `plugin` per record yang tersisa + satu op `delete` (coalescing); online → sinkron → server = keadaan akhir, op plugin 0.
3. **LWW:** A offline ubah X; C ubah X (online, lebih baru) → A online + sinkron → A menampilkan versi C dan baris "Perubahan kalah: X"; kebalikannya (A lebih baru) → server versi A.
4. **`$task`:** A offline membuat task T baru lalu record yang merujuk `{"$task": <cid T>}` → online → server: data record memuat id server T (integer), tidak ada 422.
5. **Keluar workspace:** C offline menambah record di W; U1 mengeluarkan U2 dari W lewat API → C online + sinkron → record W hilang dari IndexedDB C (termasuk yang tertunda, `FORBIDDEN_SCOPE`), tidak ada error berulang pada sinkron berikutnya; U2 ditambahkan lagi → sinkron → record W kembali.
6. **Plugin OFF:** C mematikan `demo-records` dengan op tertunda → sinkron → server menerima (K9); A mengubah record → C sinkron tanpa menarik (IndexedDB C tetap versi lama); C menyalakan lagi → sinkron → versi baru.
7. **Upgrade v6→v7 dengan data:** konteks baru, tab `/manifest.json` membuat `taskflow-offline` v6 dari `tests/fixtures/idb_v6_schema.json` berisi satu task milik U1 + satu op task `update` + `_meta` sesi → buka app (login U1) → `indexedDB` versi 7, task tampil, op terkirim, store plugin ada.
8. **Dua tab:** (a) tab P memuat app dengan `page.route("**/static/offline/db.js")` menyajikan `db.js` dari `git show e6d9256:static/offline/db.js` (kode 1a-1, v6 + handler) → tab Q memuat app biasa (v7) → P menampilkan "Alurik diperbarui di tab lain. Muat ulang tab ini." + "Muat ulang", Q memuat daftar task; (b) tab R membuka v6 mentah tanpa handler dan menahan koneksi → app menampilkan "Tutup tab Alurik lain untuk menyelesaikan pembaruan" → R ditutup → banner hilang, data tampil.
9. **Jendela deploy:** `ctx.route("**/api/plugins/*/records*")` → 404 `{"detail": "Not Found"}` → tambah record → sinkron selesai tanpa melempar (langkah lain tetap jalan), op tetap; `unroute` → sinkron → terkirim.
10. **Ekspor:** `GET /api/export/download` U1 → ZIP memuat `plugin_states.json` dan `plugin_records.json` (record `user` dari halaman project, tanpa record W).
11. **375 px dan Sakura gelap:** view Demo Rec tanpa gulir horizontal halaman; konsol tanpa error selain yang disengaja (404 skenario 9).

- [ ] **Step 1:** tulis skrip; **Step 2:** `python3 temporary_files/e2e_plugin_fase1_1a2.py` → semua cek lolos (catat N/N); regresi `temporary_files/e2e_plugin_fase1_1a1.py`, `e2e_plugin_fase0b.py`, `e2e_plugin_fase0a.py` lulus.
- [ ] **Step 3: Commit** `test(plugin): E2E Fase 1 PR 1a-2 (record bersama workspace, offline, LWW, upgrade v7, dua tab)`

### Task 12: Verifikasi akhir, dokumen, handover, review, PR draft

**Files:** `docs/superpowers/specs/2026-10-31-plugin-fase1-timeline-design.md` (+ "### Catatan implementasi PR 1a-2 (<tanggal>)" setelah catatan 1a-1 di §2), `docs/superpowers/plans/2026-11-01-plugin-fase1-pr-1a-2.md` (salinan rencana ini), `.agents/CURRENT_STATE.md` (entri teratas), `.agents/SESSION_LOG.md` (format PROTOCOL §3.2)

- [ ] **Step 1: Verifikasi** dan catat angka: `python3 -m pytest tests/ -q` (1367 lama + baru, 1 skip; Python 3.12 bila tersedia); `npm test` (hanya `draw_local_reactive`); `node --test tests/build-plugins.test.js`; PROTOCOL §4 butir 5; `node temporary_files/check_inline_scripts.js static/index.html`; `node compile.js` dua kali tanpa diff; `git diff --stat origin/main -- static/app.css static/plugins` kosong; `grep -n "DB_VERSION = 7" static/offline/db.js`; `wc -l static/index.html` ≤ 46119; `git diff origin/main -- 'tests/*.py' 'tests/offline/*.js'` hanya file baru + perubahan R20 + `test_plugins_node.py` + penambahan di `test_plugin_loader.py`/`build-plugins.test.js`/`plugin_host_wiring.test.js`/`plugin_settings_ui.test.js`; asap `migrate_db` ×2 dan `import bot`; simulasi CI tanpa `node_modules` (pola 1a-1).
- [ ] **Step 2: Dokumen:** catatan implementasi 1a-2 di spec repo (R1–R19 ringkas + penyimpangan yang ditemukan saat implementasi) dan salinan Project `claude/spec-plugin-fase1-timeline-2026-10-31.md` lewat `project_write` (isi sama); salin rencana ke `docs/superpowers/plans/`.
- [ ] **Step 3: Handover** `CURRENT_STATE.md`: `## 🟡 Plugin Fase 1 — PR 1a-2: IndexedDB v7 + plugin_records + api.records — claude/plugin-records — <tanggal> (Claude) — PR DRAFT, menunggu "merge dan deploy" (tidak sebelum 2026-11-04)`: spec/plan/ADR-041; isi; rilis SW v492 `silent`; **deploy: workflow (`git reset`, `node compile.js`, `migrate_db` → `plugin_loader.migrate` membuat tabel `plugin_records`) TIDAK me-restart → Bapak wajib `sudo systemctl restart taskflow-web taskflow`**; selama jendela deploy `GET/POST …/records` 404 → op tertahan dan terkirim setelah restart; verifikasi pasca-deploy: `sqlite3 <db> ".schema plugin_records"`, `GET /api/plugins/habit-heatmap/records` (token) → 404 `PLUGIN_UNKNOWN` (bukti rute hidup), Pengaturan menampilkan SW v492, DevTools › IndexedDB `taskflow-offline` versi 7; **rollback = revert sebagai rilis baru yang mempertahankan `DB_VERSION = 7` dan `PLUGIN_STORES` di `db.js` (jangan pernah turun ke 6: `VersionError` mematikan semua rute offline), SW bump + whatsnew `silent`, restart dua layanan; tabel dibiarkan; op `plugin` yang belum terkirim hilang**; berikutnya: 1b Timeline (rencana direview sebelum merge ini). `SESSION_LOG.md` entri baru.
- [ ] **Step 4: Commit** `docs(agents): handover PR 1a-2 Fase 1`
- [ ] **Step 5: Review akhir oleh subagen reviewer terpisah** (Review Focus 1–6 + R1–R25; khusus: `onupgradeneeded` v7 tidak menyentuh store lama; tidak ada jalur tulis record yang melewati transaksi `["plugin_records", "_outbox"]`; tidak pernah dua op untuk satu record; `seq` dan LWW di dalam satu `write_tx`; kursor tidak bisa melewatkan baris; reset + sapu tidak menghapus record `dirty`; `FORBIDDEN_SCOPE` tidak berulang; penjaga pemilik berjalan sebelum push; endpoint tidak memeriksa ON; rute `/records` tidak bisa dibayangi plugin; tidak ada `localStorage`/`fetch(` baru di runtime; anggaran `index.html`; `DB_VERSION` tidak bisa turun). Perbaiki temuan wajib, ulangi Step 1.
- [ ] **Step 6: Push + PR draft** judul `Plugin Fase 1 — PR 1a-2: IndexedDB v7, plugin_records (kursor seq), api.records`; body: ringkasan, tabel file, R-keputusan penting, angka tes, hasil E2E, **catatan deploy: restart manual `sudo systemctl restart taskflow-web taskflow`** (web memuat `plugin_records`/`plugin_loader` baru; bot memuat `plugin_loader`), **JANGAN merge sebelum 2026-11-04** (≥ 3 hari setelah #119 ter-deploy 2026-11-01, agar tab yang lama terbuka sudah membawa handler `versionchange` 1a-1) **dan sebelum rencana 1b direview** (§15 Q2), rollback (v7 tidak bisa turun; konsekuensi revert seperti Step 3); akhiri dengan atribusi sesi. Merge hanya setelah Bapak bilang "merge dan deploy"; setelah deploy sukses ingatkan restart dua layanan.
