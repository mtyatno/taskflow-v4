# Spec: Sistem Plugin Alurik — Fase 1 (fondasi data plugin + Timeline/Gantt)

- **Tanggal:** 2026-10-31
- **Basis kode:** `main` @ `8a16cd4` (setelah #118 Fase 0b PR B; SW `taskflow-v490-plugin-akun`, `app.css?v=382`, IndexedDB `taskflow-offline` **v6**, 81 modul `static/offline/`, `index.html` 46.095 baris, `plugin-runtime.js` 1.138 baris, `syncpush.js` 2.319, `syncpull.js` 1.951, `webapp.py` 10.819 baris / 213 endpoint, `plugin_loader.py` 421, `plugin_states.py` 217).
- **Status:** disetujui pemilik 2026-10-31 — §15: (1) lima PR (1a-1, 1a-2, 1b, 1c, 1d) dengan jeda ≥ 3 hari antara 1a-1 dan 1a-2; (2) fondasi 1a dibuktikan plugin contoh khusus tes, rencana 1b direview sebelum 1a-2 di-merge; (3) Timeline di workspace per anggota, data jadwal/kalender bersama; (4) cuti bersama libur secara bawaan + sakelar per kalender; (5) seksi Jadwal untuk semua task kecuali task berulang.
- **Salinan:** Project claude.ai "alurik" `claude/spec-plugin-fase1-timeline-2026-10-31.md`; saat implementasi dimulai di-commit ke `docs/superpowers/specs/2026-10-31-plugin-fase1-timeline-design.md`. Isi keduanya harus sama.
- **Istilah** (tambahan atas Fase 0a/0b):
  - *ext* = kolom `tasks.ext`: objek JSON datar berkunci `<pluginId>.<field>` (B8), milik plugin, ikut sinkron task;
  - *record* = baris `plugin_records` (B6/B7): data plugin yang bukan milik satu task (kalender, baseline, kapasitas);
  - *scope* record = `user` (milik pengguna) atau `list:<id>` (milik workspace, dibaca/ditulis semua anggota);
  - *seq* = nomor urut tulis server di `plugin_records`, dasar kursor delta;
  - *referensi task* = nilai `{"$task": <id>}` di dalam ext atau data record; `<id>` = id tampilan task (`server_id ?? cid`);
  - *hari kerja (hk)* = tanggal yang bukan akhir pekan menurut kalender, bukan libur nasional/cuti bersama (bila dipakai), dan bukan libur tambahan;
  - *view plugin* = tampilan daftar task yang disumbang plugin lewat slot `taskList.views` (Timeline = view ke-4 setelah Normal/Compact/Kanban).

---

## 1. Tujuan

Fase 1 membawa plugin besar pertama, **Timeline/Gantt**, ke halaman project dan workspace — tanpa membuat jalur sinkron khusus untuk Timeline. Untuk itu Fase 1 lebih dulu membangun fondasi data plugin generik yang sudah dikunci di Lampiran B Fase 0a: field plugin di task (`tasks.ext`), tabel record plugin (`plugin_records`) dengan delta pull, store IndexedDB v7, dan dua slot UI baru. Timeline lalu dibangun bertahap: Gantt dasar (1b), penjadwalan otomatis + CPM + baseline (1c), Beban Tim + ekspor (1d).

**Kriteria berhasil** (1a dan 1b; 1c/1d punya kriteria di spec turunannya)

1. **IndexedDB v7 aman.** Upgrade v6→v7 hanya menambah `plugin_records` dan `plugin_kv`; data v6 utuh; tab lama yang membuka koneksi tidak membuat tab baru menggantung tanpa pesan (S12 audit 2026-10-15 ditutup).
2. **`tasks.ext` ikut sinkron task** di semua jalur: `POST/PUT/GET /api/tasks`, hidrasi, outbox task, delta pull task — dengan semantik patch per kunci, sehingga perangkat/anggota yang plugin-nya OFF tidak menimpa field plugin.
3. **`plugin_records`** sinkron dua arah: `GET /api/plugins/{id}/records` (kursor `seq`, tombstone, reset) dan `POST /api/plugins/{id}/records` (batch upsert idempoten, LWW); bekerja offline; satu op outbox per record (coalescing O(1)).
4. **Dua slot baru** `taskList.views` dan `taskDetail.sections`; tombol view plugin tampil tanpa mengeksekusi kode plugin (lazy-execute tetap berlaku).
5. **`TF.api` v1 bertambah** `api.taskExt` dan `api.records` (izin `task.ext`, `records` pindah dari dicadangkan ke dikenal); `apiVersion` tetap 1.
6. **Timeline (1b)**: view ke-4 di halaman `proj_*` dan `slist_*`; tabel kiri + bar per task dikelompokkan per Project/induk; zoom Hari/Minggu/Bulan; garis hari ini; akhir pekan dan libur diarsir; dependensi FS + lag sebagai panah; milestone belah ketupat; tenggat sebagai bendera; geser/ubah durasi dengan seret; seksi "Jadwal" di detail task (mode Manual); Live Edit tetap jalan.
7. **Hari kerja Indonesia offline**: libur nasional dan cuti bersama 2025–2027 dibundel di plugin; tidak ada unduhan saat runtime.
8. **Performa:** 500 task + 400 dependensi: render awal ≤ 150 ms dan gulir tanpa jank pada Chrome dengan CPU throttle 4× (proksi HP menengah); DOM ≤ ~1.500 elemen pada satu waktu.
9. **Batas ukuran:** `index.html` bertambah ≤ 60 baris untuk **seluruh** Fase 1 (baseline baru 46.095); bump IndexedDB tepat sekali (v7) di Fase 1; `app.css` tidak berubah.
10. **Deploy/rollback** tanpa migrasi data manual; tidak ada data plugin yang hilang di jendela deploy.

## 2. Keputusan

| # | Keputusan | Alasan (kode nyata) |
|---|---|---|
| K1 | Fase 1 = **lima PR**: **1a-1** `tasks.ext` + slot + `api.taskExt` + perbaikan S12 (tanpa bump IndexedDB); **1a-2** IndexedDB v7 + `plugin_records` + `plugin_sync.js` + `api.records`; **1b** Timeline dasar; **1c** otomatis + CPM + baseline + jadwalkan ulang; **1d** Beban Tim + earned value + ekspor. | Usulan awal "1a satu PR" menyentuh dua area paling rawan sekaligus: sinkron task (`syncpush.js:105–145`, `:527–550`, `syncpull.js:246–328`) dan skema IndexedDB (`db.js:12`, `:61–79`). Keduanya independen; dipisah, masing-masing bisa di-revert sendiri. Urutan 1a-1 → 1a-2 wajib karena K2. |
| K2 | `db.js` mendapat `onversionchange` (tutup koneksi, tolak `openDB` berikutnya dengan `DB_UPGRADED_ELSEWHERE`, banner "Alurik diperbarui di tab lain — Muat ulang") dan `onblocked` yang tampil ke pengguna ("Tutup tab Alurik lain untuk menyelesaikan pembaruan"). Dirilis di **1a-1**, minimal 3 hari sebelum bump v7 di 1a-2. | Hari ini `openDB` (`db.js:101–126`) hanya `console.warn` di `onblocked` (`:121–123`) dan tidak memasang `onversionchange` — S12 audit (`2026-10-15-offline-sync-audit.md:120`) masih terbuka: tab baru menggantung, semua `api.fetch` lokal ikut menggantung. Tab yang masih menjalankan kode lama tidak punya handler, jadi handler harus beredar **sebelum** versi naik. Satu-satunya pembuka `taskflow-offline` adalah `db.js` (SW tidak membuka IndexedDB; `OfflineDB` `index.html:502–509` memakai DB lain). |
| K3 | v7 = B5 + satu indeks: `plugin_records` keyPath `[plugin_id, entity, id]`, indeks `[plugin_id, entity]`, `[plugin_id, entity, updated_at]`, `[plugin_id, entity, dirty]`, **`[plugin_id, entity, scope]`**; `plugin_kv` keyPath `[plugin_id, scope, key]`. `dirty` disimpan **0/1** (bukan boolean). Dibuat di blok terpisah dari `ENTITY_STORES` (keyPath `cid`). | Boolean bukan kunci IndexedDB yang sah: record ber-`dirty: true` tidak masuk indeks majemuk (store lain memakai 0/1, `taskrepo.js:270`). Indeks scope dibutuhkan kalender/baseline per workspace dan gratis di upgrade yang sama; menambahnya nanti = v8. |
| K4 | `tasks.ext TEXT NOT NULL DEFAULT '{}'` (ALTER idempoten, tanpa backfill). Tulis = **patch per kunci**: `PUT` menerima `ext_patch {kunci: nilai∣null}`, `POST` menerima `ext {…}`; `null` menghapus kunci. Respons task selalu memuat `ext` sebagai objek. Namespace = id plugin di `index.json` yang berizin `task.ext`; namespace tak dikenal **diabaikan** (bukan 4xx); kunci `^[a-z][a-z0-9-]{2,31}\.[a-zA-Z][a-zA-Z0-9_]{0,31}$`; ≤ 4 KB per plugin, ≤ 16 KB total → selain itu 422 `EXT_INVALID`/`EXT_TOO_LARGE`. | Push task mengirim **seluruh** record (`taskToUpdatePayload`, `syncpush.js:124–145`) dan pull memakai LWW satu record (`syncpull.js:284–291`): ext utuh akan ditimpa oleh perangkat/anggota yang tidak menyentuh Timeline. Patch per kunci membatasi tabrakan ke kunci yang sama. Menolak namespace asing akan membuat seluruh update task gagal permanen (`failPermanent` → `sync_error`) bila plugin dihapus dari repo saat op masih antre. |
| K5 | Klien: `rec.ext` + `rec.ext_dirty` (daftar kunci yang belum terkirim). `taskrepo.updateTask` menerima `patch.ext`; push menambah `ext_patch` = nilai kunci di `ext_dirty`; `markPushed` membersihkan `ext_dirty` hanya bila rev tidak berubah **dan** respons memuat `ext`. Pull: `ext` diperlakukan *only-if-sent*; bila LWW memenangkan server, kunci `ext_dirty` lokal ditempel di atas ext server dan op diantre ulang (tidak dibuang bersama `dropOutbox`). | Jendela deploy: file statis baru sudah tersaji sementara proses web lama belum restart (Fase 0b §7). Server lama mengabaikan `ext_patch` (Pydantic `extra` diabaikan) dan menjawab 200 tanpa `ext`; tanpa aturan ini `dirty` hilang dan perubahan tidak pernah terkirim, lalu pull dari server baru (`ext = {}`) menghapusnya. `ONLY_IF_SENT` sudah ada untuk pola yang sama (`syncpull.js:161`). |
| K6 | `PUT /api/tasks/{id}` yang hanya mengubah `ext` (nilai field inti sama dengan baris lama) **tidak** memicu notifikasi "memperbarui task" ke anggota workspace. | Notifikasi dikirim untuk setiap PUT task workspace (`webapp.py:2669–2676`, dibatasi per task per jendela R20). Menyeret 20 bar = 20 notifikasi Telegram ke tiap anggota. |
| K7 | **Referensi task** di ext dan data record = `{"$task": <id>}`. Klien menyimpan id tampilan (`server_id ?? cid`); setelah `POST` task sukses, host menulis ulang semua `{"$task": "<cid>"}` menjadi id server (pola `rewriteNoteTaskLinks`, `syncpush.js:330`, `:517`); op yang masih merujuk cid yang create-nya antre **ditahan** (pola T10 `parentCreatePending`, `:490`); rujukan ke cid tanpa server id dan tanpa create antre → `null`. Server menolak `$task` bukan integer (422 `EXT_TASK_REF`). | cid hanya bermakna di satu perangkat (S15). Ini satu mekanisme generik untuk semua plugin, bukan aturan khusus Timeline (guard rail 12). |
| K8 | Server `plugin_records` = tabel host (modul baru `plugin_records.py`, dipanggil `plugin_loader.migrate` setelah `plugin_states`), PK `(plugin_id, entity, owner_key, id)` dengan `owner_key` = `u:<user_id>`∣`l:<list_id>`. Kursor delta = **`seq` integer** (nomor tulis yang diberikan di dalam `write_tx`), bukan `(updated_at, id)`; kursor membawa sidik jari daftar workspace yang bisa diakses; tombstone dihapus setelah 30 hari dengan penanda `purged_seq`. | Lampiran A #2 meminta keyset `(updated_at, id)`, tetapi di record `updated_at` = waktu edit **klien** (dasar LWW, B6): edit offline kemarin yang baru terkirim hari ini akan berada di belakang kursor perangkat lain dan tidak pernah ditarik. `seq` diberikan saat tulis, dan `BEGIN IMMEDIATE` menyerialkan penulis sehingga urutannya = urutan commit — lebih kuat dari margin 5 menit `note_comments` (`webapp.py:8361–8365`). Anggota baru workspace butuh tarik penuh; sidik jari memicu `reset`. |
| K9 | Endpoint record **tidak** mensyaratkan plugin ON (hanya: token sah, bukan token clipper, plugin ada di indeks dan berizin `records`, entitas dideklarasikan). Klien menarik record hanya untuk plugin yang ON; push selalu. Scope yang didukung: `user`, `list:<id>`; `project:<id>` (B6) ditunda. | OFF = UI disembunyikan, data tidak dihapus (K6 Fase 0a). Bila push mensyaratkan ON, mematikan Timeline di laptop membuat op kalender dari HP ditolak dan dibuang. |
| K10 | Konflik record: hanya strategi `lww` di Fase 1. Server: `base_version == version` → terapkan; selain itu bandingkan `min(updated_at klien, waktu server)` dengan `updated_at` baris (pola K12 Fase 0b); kalah → `applied: false` + baris server. `version` diberikan server (+1 tiap tulis diterima). Manifest yang mendeklarasikan `merge`/`manual` ditolak "belum didukung". | B6 menyebut tiga strategi; belum ada pemakai `merge`/`manual`. Versi buatan klien tidak sebanding antar perangkat; versi server + `base_version` memberi deteksi konflik murah. |
| K11 | Klien `static/offline/plugin_sync.js` (`TF.pluginsync`): tulis record = satu transaksi `["plugin_records", "_outbox"]`; record menyimpan `op_qid` sehingga coalescing = hapus satu op berdasarkan qid (O(1)); op = `{entity_type: "plugin", op: "upsert"∣"delete", cid: "<plugin>/<entity>/<id>", payload: record}` (B9). Push = satu cabang di `processOp` (`syncpush.js:2147–2175`) yang memanggil `TF.pluginsync.pushOp`; pull = satu langkah di `sync()` setelah pull status plugin (`index.html:1362`) dan sebelum `pushOutbox` (`:1363`). Kursor disimpan di `plugin_kv` (`[pluginId, "_sync", "cursor"]`). | `pluginstate.setLocal` memindai seluruh `_outbox` dengan kursor (`pluginstate.js:107–117`); itu wajar untuk satu op per plugin, tidak untuk ratusan record. `outbox.js` tidak berindeks (`:43–45` filter `getAll`). Menaruh logika di modul sendiri menahan `syncpush.js` (2.319 baris) tidak tumbuh. |
| K12 | Slot `taskList.views` **deklaratif**: manifest `contributes["taskList.views"] = [{id, label, icon: {path}, pages: ["project","workspace"]}]` disalin `compile.js` ke `index.json`; host menggambar tombol dari indeks untuk plugin ON tanpa memuat kodenya; klik → `TF.SlotView` memuat plugin dan merender komponen. Pilihan view plugin disimpan **per halaman** `tf_viewmode_ext:<page>`; `tf_viewmode` (`index.html:19167`, `:19189–19192`) tidak berubah. | Tombol view harus ada sebelum kode plugin dieksekusi (K3 Fase 0a lazy-execute). `tf_viewmode` global untuk semua halaman; menyimpan "timeline" di sana akan memaksa Inbox jatuh ke Normal tanpa sebab yang jelas. Pola per halaman sudah ada (`kanbanScopeKey(page)`, `:19171–19180`). |
| K13 | `taskDetail.sections` = `<TF.Slot>` di `TaskDetailBody` antara Deskripsi dan `DetailTabs` (`index.html:10396–10411`), di modal maupun panel Live Edit. | Satu titik untuk dua wadah (redesain detail §6.1); seksi "Jadwal" mockup berada di bawah properti. |
| K14 | **A2 (plugin di workspace): status tetap per pengguna.** Data plugin di task bersama dan record `list:<id>` dibagi ke semua anggota; siapa pun yang boleh mengedit task (`_can_access_task(write=True)`, `webapp.py:1560–1576`) boleh mengubah jadwal dan kalender workspace. Kolom `plugin_states.scope` tetap dicadangkan. | Mewajibkan pemilik menyalakan untuk semua anggota butuh status per konteks halaman di runtime (kini global per pengguna, `plugin-runtime.js:243–254`) dan aturan peran yang belum ada (`list_members` tanpa kolom peran, `repository.py:738–745`). Patch per kunci (K4) membuat anggota yang OFF tidak merusak data. |
| K15 | Data Timeline: **per task di ext** (`timeline.start`, `timeline.duration`, `timeline.deps`; 1c: `mode`, `constraint`, `actual`; 1d: `split`); **% selesai = `tasks.progress`** host (0–100, sudah ada: `repository.py:903`, `TaskUpdate.progress` `webapp.py:1256`); **Work/Actual = `estimated_pomodoros`/`pomodoros_done`**; tenggat = `deadline`; penanggung jawab = `assigned_to`. **Record**: `calendar` (1b), `project` dan `baseline` (1c), `resource` (1d). Dependensi disimpan di task penerus, **bukan** record. | Dependensi di ext otomatis ikut otorisasi, berbagi workspace, dan perpindahan task ke workspace (`PATCH /api/tasks/{id}/workspace`) tanpa aturan scope tambahan; task terhapus = dependensinya ikut hilang. Kalender/baseline milik banyak task → record. Menggandakan `progress` di ext akan membuat dua sumber kebenaran. |
| K16 | Hari kerja dihitung dengan bilangan hari (`Date.UTC(y,m-1,d)/864e5`), bukan `Date` lokal; durasi dalam hari kerja; milestone ⇔ `duration = 0`. | Indonesia tanpa DST, tapi pengguna bisa di zona lain; tanggal `YYYY-MM-DD` diperlakukan sebagai tanggal kalender murni. "Hari ini" = `api.env.today()` (Asia/Jakarta). |
| K17 | Libur nasional + cuti bersama Indonesia **dibundel** sebagai bagian plugin (`holidays-id.js`, tabel statis per tahun, sumber SKB 3 Menteri), diperbarui satu PR per tahun; tahun tanpa data → hanya akhir pekan + pemberitahuan. | Wajib 100% offline (guard rail 9); `api.fetch` hanya ke `/api/plugins/<id>/` dan lint melarang `fetch(`. |
| K18 | Render Gantt: **satu wadah gulir** (tabel kiri `position: sticky`, header skala waktu sticky), **virtualisasi baris**, bar = `div` absolut, panah dependensi = **satu `<svg>` overlay** untuk baris yang tampak, latar hari/akhir pekan = `repeating-linear-gradient` periode 7 hari, libur = `div` hanya di rentang tampak. | Div lebih murah di-hit-test dan mengikuti token tema; SVG hanya untuk garis. Satu wadah gulir = tidak ada sinkron gulir JS antara tabel dan grafik. Canvas ditolak (aksesibilitas, teks, token tema). |
| K19 | `compile.js`: manifest boleh punya `parts` (berkas JS murni yang digabung sebelum `plugin.jsx` menjadi satu `plugin.js`), `contributes`, `records`, `taskExt`; tiga yang terakhir disalin ke `index.json`. `plugin_loader._read_index` (`plugin_loader.py:72–82`) menyimpan `permissions` dan `records` selain `defaultEnabled`. | Build plugin hari ini satu berkas (`compile.js:137`, `:155–162`). Mesin kalender/jadwal harus bisa dites Node terpisah dari UI. Server perlu izin dan daftar entitas untuk memvalidasi K4/K9. |
| K20 | Anggaran `index.html`: baseline Fase 1 = **46.095** (main `8a16cd4`), **+60 untuk seluruh Fase 1** (alokasi §12). | `tests/offline/plugin_host_wiring.test.js:15–16` masih berbasis 46.092 (+3 terpakai 0b). Lampiran A #13: ≤ 60 per fase plugin, bukan per PR. |
| K21 | Timeline 1b–1c tanpa modul server (`plugins/timeline.py` tidak ada); pesan loader untuk `on_task_written` (`plugin_loader.py:45`) diganti "belum didukung (ditunda)". | Semua perhitungan jadwal berjalan di klien (offline). Tidak ada proyeksi server yang membutuhkan hook. |

**Keputusan pemilik yang dibawa:** A1/A3 (status per akun, toggle offline), Q1a Fase 0b (keputusan terbaru menang), istilah UI "Plugin"; dari percakapan Timeline: default **Manual**, toggle "Jadwal otomatis" per project dengan pratinjau; resource = anggota workspace dengan kapasitas 🍅/hari; leveling manual saja; tanpa task types, biaya, resource pool lintas workspace.

### Catatan implementasi PR 1a-1 (2026-10-31)

Deviasi dari teks K1–K21 dan §4–§7 yang diputuskan saat rencana/implementasi PR 1a-1 (`docs/superpowers/plans/2026-10-31-plugin-fase1-pr-1a-1.md` R1–R21, branch `claude/plugin-ext`, ADR-040):

**Server**

- **R1 — kolom di blok project `migrate_db`, bukan `plugin_loader.migrate`.** `task_ext.ensure_schema(conn)` satu baris tepat setelah `email_outbox.ensure_schema(conn)` (koneksi FK ON; `ALTER … ADD COLUMN` tidak merombak tabel). `plugin_loader.migrate` menelan exception (ADR-039), padahal kolom `ext` dipakai setiap INSERT/UPDATE task — gagal diam-diam = 500 di setiap tulis task. Kini gagal = `migrate_db` melempar = deploy berhenti sebelum restart. Jumlah `dbconn.connect` di `migrate_db` tetap 27. **1a-2:** `plugin_records.ensure_schema` boleh tetap di `plugin_loader.migrate` karena tidak dipakai jalur task.
- **R2 — merge di transaksi `UPDATE` yang sama.** `PUT /api/tasks/{id}` tetap `async def` + `get_db()`; validasi bentuk/namespace/`$task` sebelum membuka DB (422 cepat); setelah `UPDATE tasks SET …` utama (DML pertama → `BEGIN IMMEDIATE`): `SELECT ext` → `apply_patch` → `UPDATE tasks SET ext`, semua sebelum `commit`, atomik dalam `BEGIN IMMEDIATE` yang sama. `EXT_TOO_LARGE` → rollback seluruh PUT. `ext_patch` yang dikirim dihitung sebagai perubahan (tidak pernah 400 "No fields to update").
- **R3 — server lama mengirim `ext` sebagai string.** Setelah `migrate_db` (sebelum restart) proses lama melihat kolom baru lewat `SELECT *` → `"ext": "{}"` (string), bukan "tanpa `ext`" seperti asumsi K5. Klien memperlakukan `ext` sebagai "dikirim" hanya bila **objek polos** (`TF.taskext.isPlainObject`) di hidrasi, pull, dan `taskAdopt`.
- **R4 — namespace.** Kunci plugin yang tidak berizin `task.ext`: `plugin_loader.refresh_known()` sekali per request, masih asing → dibuang + `WARNING` sekali per namespace per proses. Indeks rusak (`index_ok()` false) → semua namespace berbentuk sah **diterima** (gagal-terbuka) **tanpa** baca ulang indeks.
- **R5 — `known()` tidak berubah;** izin disimpan terpisah (`permissions()`, `ext_namespaces()`). `on_task_written` → "belum didukung (ditunda, Lampiran B)" (K21).
- **R6 — aturan K6.** Notifikasi "memperbarui task" dilewati bila `ext_patch` dikirim **dan** tidak ada field inti yang berubah (abaikan `updated_at`, `quadrant`, `completed_at`, `recurrence_end_date`, `recurrence_notif_level`, `ext`; `recurrence_renew` true = berubah). PUT tanpa `ext_patch` berperilaku lama.
- **Ukuran dicek atas ext gabungan.** Batas 4/16 KB diperiksa atas hasil `apply_patch` (bukan atas patch). Selisih kecil hitung byte untuk float bulat (`json.dumps(1.0)` = `1.0` di Python, `JSON.stringify(1.0)` = `1` di JS) diterima; server penentu akhir.
- **`ext_patch: []`** (bukan objek) → 422 dari validasi pydantic (bukan `EXT_INVALID`).

**Klien**

- **R7 — nama `ext_patch` juga di rute lokal dan `taskrepo`** (body yang sama untuk `api.put` lokal dan jaringan); `createTask` membaca `input.ext` (sama dengan `POST`).
- **R8 — tulis akhir `updateTask` lewat `TFdb.mutate`.** Patch diterapkan ke record **terbaru** di dalam `TFdb.mutate("tasks", cid, cur => …)`; **semua** update task kini lewat `mutate` (bukan hanya yang membawa `ext_patch`): field inti dari patch (perilaku lama), `ext` = `applyPatch(cur.ext, ext_patch)`, `ext_dirty` = `cur.ext_dirty ∪ kunci patch`, `rev + 1`. Autosave Live Edit yang berjalan bersamaan dengan `api.taskExt.set` tidak menghapus kunci ext.
- **R9 — `$task`.** Op create tidak pernah ditahan karena ref (A↔B offline akan deadlock): kunci yang merujuk cid ber-create antre tidak dikirim dan tetap kotor; op update yang merujuknya ditahan; ref ke cid tanpa server id dan tanpa create antre → `null`. Setelah `POST` sukses: `rewriteTaskExtRefs(cid, sid)`. A↔B: POST A (tanpa kunci ref), POST B **langsung** membawa id server A, lalu **satu** PUT A dengan id server B.
- **R10 — jendela deploy.** Respons 2xx tanpa `ext` objek dan record ber-`ext_dirty` → `dirty = 1`, `ext_dirty` tetap, op diantre untuk drain **berikutnya** → paling banyak satu PUT per task per sinkron sampai server di-restart. Push tanpa `ext_dirty` tidak pernah mengirim kunci `ext_patch`.
- **R11 — pull** LWW server menang dengan kunci kotor → kunci lokal ditempel di atas ext server, `ext_dirty` dipertahankan, op diantre ulang.
- **R12 — `versionchange`.** `newVersion === null` (hapus DB) → tutup + boleh buka ulang tanpa banner; selain itu `db.close()` dan `openDB` berikutnya ditolak `Error("DB_UPGRADED_ELSEWHERE")` (`code` sama). `DB_VERSION` tetap **6**, dengan komentar "jangan pernah diturunkan". Banner DOM `static/offline/dbupgrade.js` (berlangganan `TF.db.subscribe`/`upgradeState`, gaya inline bertoken).
- **R13 — `compile.js`.** `contributes`/`taskExt` disalin ke `index.json` dan konstanta `manifest` hanya bila ada (indeks dan hash `habit-heatmap` tidak berubah); `parts` digabung mentah sebelum `plugin.jsx`. Plugin contoh `demo-ext` **hanya** di `tests/fixtures/plugins/demo-ext/` (dibangun tes ke direktori sementara, tidak pernah di `static/plugins/`).
- **R14 — `api.taskExt`.** `set` hanya menerima field di `manifest.taskExt.keys`. Tanpa binding host (`updateTaskExt`), jatuh ke rute lokal `PUT /api/tasks/:id` (tes Node, pemakaian di luar `App`).
- **R15 — context `taskDetail.sections` tanpa `currentUser`** (`TaskDetailBody` tidak menerima `user`): `{task, variant, collaborators, onOpenTask, showToast: window.__showToast}`; pengguna lewat `api.env.userId`.
- **R16 — context `taskList.views` stabil:** `useMemo` atas **masukan** (halaman, task, tujuh state filter panel, kolaborator, pengguna, Live Edit, pilihan, view aktif), bukan `filtered`; `onTaskClick`/`isSelected` lewat ref.
- **Tes lama yang diubah** selain R18 rencana: `tests/offline/tasklist_view_icons.test.js` kini menghitung tombol view **inti** saja (tombol view plugin ditambahkan dinamis di baris yang sama).

## 3. Ruang lingkup dan pembagian PR

| PR | Isi | Server | IndexedDB | Terlihat pengguna |
|---|---|---|---|---|
| **1a-1** | `tasks.ext` (server + hidrasi + push/pull + `$task`), K6, slot `taskList.views` + `taskDetail.sections`, `TF.SlotView`, `api.taskExt`, izin `task.ext`, handler S12 (K2), `compile.js` `contributes`/`parts`, plugin contoh khusus tes `demo-ext` | ya (restart) | v6 | tidak (whatsnew `silent`) |
| **1a-2** | v7 (K3), `plugin_records.py` + endpoint, `plugin_sync.js`, `api.records`, izin `records`, langkah `sync()`, ekspor data (`plugin_records`, `plugin_states`), plugin contoh `demo-records` | ya (restart) | **v7** | tidak (`silent`) |
| **1b** | plugin `timeline` 1.0: view, Gantt manual, dependensi FS+lag, milestone, tenggat, kalender + libur, seksi "Jadwal" Manual, zoom, seret | tidak | v7 | ya |
| 1c | mode Otomatis per task/project dengan pratinjau, CPM + slack + jalur kritis, batasan (ASAP/SNET/MFO), "Kenapa dijadwalkan di sini?", baseline 1–3, tracking aktual, "Jadwalkan ulang yang belum selesai", SS/FF/SF bila sempat | mungkin (batch ext) | v7 | ya |
| 1d | panel Beban Tim + kapasitas/cuti anggota, split manual, earned value 🍅, ekspor MSPDI XML | tidak | v7 | ya |

**Penilaian usulan awal.** Isi 1a yang diusulkan benar seluruhnya (semua di B5–B9 dan tabel §3 Fase 0a), tetapi tiga hal di kode memaksa perubahan bentuk: (1) handler `versionchange` belum ada sehingga bump v7 di PR yang sama dengan perbaikannya tetap menggantung tab lama (K2); (2) push task mengirim record penuh sehingga `tasks.ext` butuh semantik patch, bukan sekadar kolom JSON (K4/K5) — ini perubahan di inti sinkron task yang layak di-revert terpisah; (3) dependensi lebih aman di ext daripada record (K15), sehingga 1b hanya butuh satu entitas record (`calendar`). Usulan "1b Timeline dasar, 1c CPM + baseline + jadwalkan ulang, 1d Beban Tim + ekspor" dipertahankan, dengan **mode Otomatis dipindah ke 1c** (forward pass dan CPM memakai mesin yang sama; 1b Manual saja sesuai default pemilik).

**Plugin contoh khusus tes** (`tests/fixtures/plugins/demo-ext`, `demo-records`, indeks tes terpisah) membuktikan 1a tanpa fitur baru bagi pengguna — pola K18 Fase 0b. Rencana 1b ditulis dan direview **sebelum** 1a-2 di-merge; ketidakcocokan API yang ditemukan diperbaiki di 1a-2, bukan ditambal di 1b (§15 Q2).

## 4. Risiko bump IndexedDB (rinci)

| Situasi | Perilaku hari ini (`db.js`) | Sesudah K2 |
|---|---|---|
| Tab A (kode lama, v6 terbuka), tab B memuat kode v7 | `open(…, 7)` di B memicu `versionchange` di A; A tidak punya handler → koneksi tetap → B menerima `blocked` (`:121–123`, hanya log) dan **menunggu tanpa batas**; semua rute lokal B menggantung (S12) | Tidak bisa dicegah untuk tab yang masih kode **pra-1a-1** — karena itu handler dikirim lebih dulu (K1/K2). B menampilkan banner "Tutup tab Alurik lain untuk menyelesaikan pembaruan" setelah `blocked`; upgrade lanjut sendiri begitu A ditutup |
| Tab A sudah kode 1a-1 | – | A menerima `versionchange` → `db.close()` (transaksi berjalan selesai dulu), `_dbPromise` diganti penolakan `DB_UPGRADED_ELSEWHERE`, event `tf:db-upgraded-elsewhere` → banner "Alurik diperbarui di tab lain. Muat ulang tab ini." dengan tombol Muat ulang. Kode lama di A tidak mencoba `open(…, 6)` lagi (akan `VersionError`) |
| Upgrade gagal/dibatalkan di tengah | `tx.onabort` → reject (`:115`) | sama; `onupgradeneeded` v7 hanya `createObjectStore` + `createIndex` (tanpa pemindahan data) sehingga atomik |
| PWA/Tauri satu jendela | tidak ada tab lain | tidak ada risiko |
| Rollback 1a-2 (kode v6 setelah DB sudah v7) | `open(…, 6)` pada DB v7 → `VersionError` → semua offline mati | **Dilarang menurunkan `DB_VERSION`.** Rollback 1a-2 = revert kode tetapi `DB_VERSION = 7` dan `createSchema` tetap membuat store (tanpa pemakai). Dicatat di ADR dan di komentar `db.js` |

Banner memakai pola `accountbanner.js` (DOM polos tanpa React) di modul baru `static/offline/dbupgrade.js` (~60 baris) sehingga tidak menambah baris `index.html` selain satu `<script>`.

## 5. Arsitektur server

### 5.1 File

| File | Status | Isi |
|---|---|---|
| `task_ext.py` | baru (~150 baris, PR 1a-1) | `ensure_schema(conn)` (ALTER `tasks.ext`), `validate_patch(patch, known)`, `apply_patch(old_json, patch) → new_json`, `to_api(row_ext)`, cek `$task` |
| `plugin_records.py` | baru (~300 baris, 1a-2) | skema, `router` (GET/POST), `scope_access(conn, uid, scope)`, `fingerprint(conn, uid)`, `purge(conn)` |
| `webapp.py` | ubah | `TaskCreate` (`:1216`) + `ext: Optional[dict]`; `TaskUpdate` (`:1244`) + `ext_patch: Optional[dict]`; `task_row_to_dict` (`:1513`) mengurai `ext`; INSERT (`:2450`) + kolom `ext`; PUT (`:2525`): `ext_patch` dihitung sebagai update (sebelum `:2633` "No fields to update"), K6 sebelum `:2669`; `include_router(plugin_records.router)` **sebelum** `plugin_loader.init_web` (`:10813–10814`) |
| `plugin_loader.py` | ubah | `migrate` (`:283`) memanggil `task_ext.ensure_schema` lalu `plugin_records.ensure_schema` dalam `write_tx` masing-masing; `_read_index` (`:72`) menyimpan `permissions`/`records`; router plugin yang punya rute `/records…` ditolak (path dicadangkan host); pesan `on_task_written` (K21) |
| `plugin_host.py` | ubah kecil | `list_access(conn, uid, list_id)` (pemakai pertama `get_authorized_list`, Lampiran A #7); `HOST_API` tetap 1 |
| ekspor `GET /api/export/download` (`:7405`) | ubah | `plugin_states.json`, `plugin_records.json` milik pengguna (scope `user`) — `tasks.ext` sudah ikut baris task |

### 5.2 Skema

```sql
-- task_ext.ensure_schema (idempoten, pola PRAGMA table_info seperti repository.ensure_projects_schema :47)
ALTER TABLE tasks ADD COLUMN ext TEXT NOT NULL DEFAULT '{}';

-- plugin_records.ensure_schema
CREATE TABLE IF NOT EXISTS plugin_records (
  seq        INTEGER NOT NULL,                 -- urutan tulis server (kursor)
  plugin_id  TEXT    NOT NULL,
  entity     TEXT    NOT NULL,                 -- [a-z][a-z0-9_]{0,31}
  id         TEXT    NOT NULL,                 -- [A-Za-z0-9:@._-]{1,80}
  owner_key  TEXT    NOT NULL,                 -- 'u:<user_id>' | 'l:<list_id>'
  user_id    INTEGER REFERENCES users(id) ON DELETE CASCADE,
  list_id    INTEGER REFERENCES shared_lists(id) ON DELETE CASCADE,
  scope      TEXT    NOT NULL,                 -- 'user' | 'list:<id>'
  data       TEXT    NOT NULL DEFAULT '{}',    -- objek JSON ≤ 64 KB (batas entitas boleh lebih kecil)
  updated_at TEXT    NOT NULL,                 -- waktu edit klien, dipotong ke waktu server (LWW)
  version    INTEGER NOT NULL,                 -- +1 tiap tulis diterima
  deleted    INTEGER NOT NULL DEFAULT 0,
  updated_by INTEGER,
  server_at  TEXT    NOT NULL,                 -- waktu tulis server (purge tombstone)
  PRIMARY KEY (plugin_id, entity, owner_key, id),
  CHECK ((user_id IS NULL) <> (list_id IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_plugin_records_seq ON plugin_records(seq);
CREATE INDEX IF NOT EXISTS ix_plugin_records_user ON plugin_records(plugin_id, user_id, seq) WHERE list_id IS NULL;
CREATE INDEX IF NOT EXISTS ix_plugin_records_list ON plugin_records(plugin_id, list_id, seq) WHERE list_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS plugin_records_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL); -- 'purged_seq'
```

`seq` = `COALESCE(MAX(seq), 0) + 1` dibaca di dalam `write_tx` (B7 menyebut indeks `(user_id, plugin_id, entity, updated_at, id)`; diganti dua indeks parsial ber-`seq` — perubahan atas Lampiran B yang dicatat di ADR). Tabel host, bukan `plg_*`: dibuat host, bukan `ensure_schema` plugin.

### 5.3 Kursor dan reset

Kursor = `"1.<seq>.<fp>"`, `fp` = 8 hex sha1 dari daftar id workspace yang bisa diakses (`owner_id = uid` ∪ `list_members`). Server menjawab `{"reset": true}` bila: format tak terbaca, `seq < purged_seq`, atau `fp` berbeda (pengguna masuk/keluar workspace). Tarik setelah reset dimulai dari kursor kosong; klien menandai generasi tarik di `plugin_kv` dan, setelah halaman terakhir, menghapus record lokal **bersih** plugin itu yang tidak terlihat (record `dirty` dipertahankan). Purge tombstone (`deleted = 1 AND server_at < now − 30 hari`) berjalan paling sering sekali per jam dari handler GET, memperbarui `purged_seq` = seq terbesar yang dihapus.

## 6. API

### 6.1 Task (1a-1)

- `POST /api/tasks` + `ext` (objek, kunci lengkap ber-namespace). `PUT /api/tasks/{id}` + `ext_patch` (objek; `null` = hapus kunci). Keduanya: namespace tak dikenal dibuang diam-diam (log `WARNING` sekali per namespace per proses); bentuk salah → 422 `{"detail": {"code": "EXT_INVALID", "key"}}`; terlalu besar → 422 `EXT_TOO_LARGE`; `$task` bukan integer → 422 `EXT_TASK_REF`. Merge di dalam transaksi PUT yang sama (baca baris → `apply_patch` → UPDATE).
- Semua respons yang memakai `task_row_to_dict` (termasuk `GET /api/tasks`, `GET /api/tasks/{id}`) memuat `ext` sebagai objek (`{}` bila kosong/rusak).
- Server tidak memvalidasi isi semantik (`timeline.duration` negatif dsb.) — itu tugas plugin; server hanya bentuk, ukuran, namespace, `$task`.

### 6.2 Record (1a-2)

**`GET /api/plugins/{id}/records?cursor=&limit=500&entity=`** (`def`; `limit` 1–1000)

```json
{"items": [{"entity": "calendar", "id": "cal@list:12", "scope": "list:12", "data": {"v": 1, "weekdays": [1,2,3,4,5]},
            "updated_at": "2026-11-02T03:00:00.000+00:00", "version": 3, "deleted": false}],
 "cursor": "1.10422.9f2c1a0b", "more": false}
```

Hanya baris yang bisa diakses: `(list_id IS NULL AND user_id = uid) OR list_id IN (<akses>)`, `ORDER BY seq`.

**`POST /api/plugins/{id}/records`** (`def`, satu `write_tx`; ≤ 50 item, body ≤ 256 KB)

```json
{"items": [{"entity": "calendar", "id": "cal@list:12", "scope": "list:12", "data": {}, "deleted": false,
            "updated_at": "2026-11-02T02:59:58.120Z", "base_version": 2}]}
→ {"results": [{"entity": "calendar", "id": "cal@list:12", "applied": true, "record": {…seperti GET…}}]}
```

Per item: scope tidak bisa diakses → `{"error": "FORBIDDEN_SCOPE"}`; entitas tak dideklarasikan / data bukan objek / terlalu besar / `updated_at` rusak / id tak cocok pola → `{"error": "INVALID", "detail"}`; id sama sudah ada di `owner_key` lain yang bisa diakses → `{"error": "SCOPE_IMMUTABLE"}`. Kesalahan tingkat permintaan: 401; 403 `PLUGIN_FORBIDDEN_TOKEN`; 404 `PLUGIN_UNKNOWN` (tidak di indeks atau tanpa izin `records`); 503 `PLUGIN_UNAVAILABLE` (indeks tidak sehat — op klien tetap antre, R8 Fase 0b). Kiriman ulang yang sama → `applied: true` dengan baris yang sama bila `base_version` sudah tertinggal satu tetapi isi identik (idempoten, dicek sebelum LWW).

## 7. Klien

### 7.1 Berkas

| Berkas | Status | Isi |
|---|---|---|
| `static/offline/db.js` | ubah | K2 (1a-1), K3 (1a-2); `DB_VERSION = 7`; `PLUGIN_STORES` terpisah dari `ENTITY_STORES` (`:15–54`) |
| `static/offline/dbupgrade.js` | baru (1a-1) | banner `tf:db-blocked` / `tf:db-upgraded-elsewhere` |
| `static/offline/hydrate.js` | ubah | `COPY` (`:17–22`) + `ext` (default `{}`; hanya bila dikirim — K5) |
| `static/offline/taskrepo.js` | ubah | `updateTask` (`:177–282`): `patch.ext` → `next.ext` digabung per kunci, `next.ext_dirty` ∪= kunci; `createTask` menerima `input.ext` |
| `static/offline/syncpush.js` | ubah | payload (`:105–145`) + `ext`/`ext_patch`; `taskAdopt` (`:424`) mengadopsi `ext` server lalu menempel ulang `ext_dirty`; `markPushed` (`:369–394`) membersihkan `ext_dirty` (K5); tahan op ber-`$task` ke create antre; tulis ulang ref setelah create (di samping `:517`); cabang `entity_type: "plugin"` di `processOp` sebelum fallback `:2175` |
| `static/offline/syncpull.js` | ubah | `pullTasks` (`:246–328`): cabang LWW server-menang (`:287–288`) menempel `ext_dirty` + antre ulang; `ext` *only-if-sent* |
| `static/offline/plugin_sync.js` | baru (1a-2, ~400 baris) | `put/remove/get/list` record, coalescing `op_qid`, `pushOp`, `pullAll`, rewrite `$task` di data record, `onChange` |
| `static/plugin-runtime.js` | ubah | `KNOWN_SLOTS` (`:19`) + 2 slot; `KNOWN_PERMISSIONS`/`RESERVED_PERMISSIONS` (`:20–21`); validasi `contributes`/`records`/`taskExt` (`:220–240`); `viewsFor(pageKind)`; `SlotView`; `api.for` (`:1012–1027`) + `taskExt`, `records`; `SLOT_CLASS` (`:1053`) |
| `compile.js` | ubah | K19; validasi `icon.path` (hanya `[MmLlHhVvCcSsQqTtAaZz0-9.,\- ]`, ≤ 2 KB) |
| `static/index.html` | ubah ≤ 60 baris total | §12 |

### 7.2 `api.taskExt` (izin `task.ext`)

| Fungsi | Perilaku |
|---|---|
| `read(task) → object` | kunci namespace plugin sendiri tanpa prefiks: `{start, duration, deps}` dari `task.ext["timeline.*"]`; murni, sinkron |
| `set(taskId, patch) → Promise<task>` | prefiks otomatis; `null` menghapus; validasi ukuran/bentuk sama dengan server (gagal → `PluginStorageError`); lewat binding host `updateTaskExt` → rute lokal `PUT /api/tasks/:id` (`taskroutes.js:190`) → `taskrepo.updateTask`; state `App` diperbarui optimistis (pola `handleUpdateTaskFields`, `index.html:44842–44856`, tetapi `ext` digabung, bukan diganti) |
| `setMany([{taskId, patch}]) → Promise` | berurutan, **satu** `fetchAll` dan satu event `taskUpdated` di akhir (seret 20 bar ≠ 20 muat ulang) |
| `ref(task) → {$task}` | referensi task untuk ext/record (K7) |

Task tidak ditemukan → reject `Task not found`; task tanpa hak tulis tidak mungkin terjadi lokal (semua task di IndexedDB bisa ditulis pengguna).

### 7.3 `api.records` (izin `records`, entitas dideklarasikan di manifest)

`get(entity, id)`, `list(entity, {scope?, limit = 200, after?}) → {items, next}` (hanya lewat indeks `[plugin_id, entity]` / `[plugin_id, entity, scope]`, guard rail 5), `put(entity, id∣null, data, {scope}) → record` (id `null` → uuid; scope tidak bisa diubah setelah dibuat), `remove(entity, id)`, `onChange(fn) → off` (`{entity, ids, source: "local"∣"sync", lost?: [ids]}` — `lost` = edit lokal yang kalah LWW), `newId()`. Record yang dikembalikan: `{entity, id, scope, data, updated_at, version, pending}`; tombstone tidak pernah dikembalikan.

### 7.4 Slot

**`taskList.views`** — `TaskListView` (`index.html:19117`):

- Tombol: setelah tombol Kanban (`:19632–19646`), `TF.plugins.viewsFor(pageKind)` → `[{pluginId, id, label, icon}]` untuk plugin ON dan tidak diredam yang mendeklarasikan `pages` berisi `pageKind` (`proj_*` → `project`, `slist_*` → `workspace`; halaman lain tidak menampilkan tombol).
- Pilihan: `viewMode` efektif = `tf_viewmode_ext:<page>` bila view itu masih tersedia, selain itu mode inti. Memilih Normal/Compact/Kanban di halaman itu menghapus kunci per halaman. Efek reset Kanban (`:19193–19198`) tidak menyentuh view plugin.
- Render: cabang baru sebelum `kanbanOn ?` (`:19832`), di dalam `liveWrap` (`:19479`): `TF.SlotView({name: "taskList.views", pluginId, viewId, context})`. Saat memuat: kerangka "Memuat {label}…"; gagal: "{label} tidak bisa dimuat" + tombol "Kembali ke Normal".
- `context` (beku dangkal, dibuat dengan `useMemo` agar identitas stabil — Pomodoro me-render `App` tiap detik): `{page, pageKind, listId, projectName, tasks` (hasil filter panel, aktif), `scopeTasks` (semua status selain `archived` di scope halaman, filter panel diterapkan; predikat halaman diambil dari `kanbanDonePool` `:17567–17579` yang dipecah menjadi `pageScopePred(page)`), `collaborators, currentUser, onTaskClick` (= `rowClick`, `:19476`, sadar Live Edit), `isSelected` (= `isSel`, `:19477`), `liveEdit` (bool), `showToast}`.

**`taskDetail.sections`** — `context: {task, variant: "modal"∣"panel", collaborators, currentUser, showToast, onOpenTask}`; kelas wadah `td-plugin-sections`; tanpa kontribusi = tanpa wadah.

## 8. Timeline 1b

### 8.1 Manifest

```json
{"id": "timeline", "name": "Timeline", "version": "1.0.0", "minApi": 1, "defaultEnabled": false,
 "description": "Gantt untuk project dan workspace: jadwal hari kerja, dependensi, milestone.",
 "slots": ["taskList.views", "taskDetail.sections"],
 "permissions": ["storage", "task.ext", "records"],
 "contributes": {"taskList.views": [{"id": "gantt", "label": "Timeline", "icon": {"path": "M2 4h7M5 8h8M3 12h5"}, "pages": ["project", "workspace"]}],
                 "taskDetail.sections": [{"id": "schedule", "label": "Jadwal", "order": 10}]},
 "records": {"calendar": {"conflict": "lww", "maxBytes": 16384}},
 "taskExt": {"keys": ["start", "duration", "deps"]},
 "parts": ["holidays-id.js", "calendar.js", "schedule.js", "layout.js"]}
```

`parts` adalah modul murni (tanpa React/DOM) yang menulis ke `window.__tl` dan diekspor untuk tes Node; `plugin.jsx` berisi UI. Perkiraan `plugin.js` 70–100 KB (tanpa minify), precache, dieksekusi hanya saat view/seksi dibuka.

### 8.2 Data

```ts
// tasks.ext (kunci 1b)
"timeline.start":    string            // "YYYY-MM-DD"; tidak ada = belum dijadwalkan
"timeline.duration": number            // integer 0..999 hari kerja; 0 = milestone
"timeline.deps":     Array<{ t: { $task: number | string }, type: "FS", lag: number }> // ≤ 20; lag −99..999 hk
// selesai (finish) tidak disimpan: dihitung dari start + duration + kalender

// record calendar — id "cal@user" (scope "user") atau "cal@list:<id>" (scope "list:<id>")
type Calendar = {
  v: 1,
  weekdays: number[],        // ISO 1=Sen … 7=Min; bawaan [1,2,3,4,5]
  national: boolean,         // libur nasional = libur (bawaan true)
  cutiBersama: boolean,      // cuti bersama = libur (bawaan true, §15 Q4)
  off:  { d: string, n: string }[],   // libur tambahan (≤ 366)
  work: { d: string, n: string }[],   // hari kerja pengganti (≤ 366)
}
```

Kalender yang dipakai sebuah task: task workspace → `cal@list:<list_id>`; task pribadi → `cal@user`; tidak ada record → bawaan. Tipe dependensi selain `FS` ditolak plugin di 1b (data tetap bentuk yang sama untuk SS/FF/SF di 1c).

### 8.3 Algoritma hari kerja (`calendar.js`, murni)

- `dn(iso)` = `Date.UTC(y, m−1, d) / 864e5`; `iso(dn)` kebalikannya; `isoWeekday(dn) = ((dn + 3) mod 7) + 1` (1970-01-01 = Kamis).
- `compile(cal, holidays)` → `{mask: Set(weekdays), off: Set(dn), work: Set(dn), years: Set}`; `off` = libur nasional (bila `national`) ∪ cuti bersama (bila `cutiBersama`) ∪ `cal.off`.
- `isWork(dn)` = `work.has(dn) || (mask.has(isoWeekday(dn)) && !off.has(dn))`; O(1).
- `nextWork(dn)` = hari kerja pertama ≥ `dn`; `addWork(dn, k)` maju/mundur `k` hari kerja (loop harian; batas 3.650 iterasi → error, bukan hang).
- `finish(start, dur)`: `dur = 0` → `start` (milestone); `dur ≥ 1` → `s = nextWork(start)`, lalu `addWork(s, dur − 1)` (inklusif).
- `workdays(a, b)` inklusif.
- **FS + lag:** awal paling cepat penerus = `addWork(nextWorkAfter(finish(pred)), lag)` dengan `nextWorkAfter(x) = nextWork(x + 1)`; lag negatif = lead. Milestone (dur 0) dianggap selesai di akhir harinya, jadi penerusnya mulai hari kerja berikutnya.
- Biaya: 500 task × durasi rata-rata 10 hari ≈ 5.000 iterasi per hitung ulang — tidak perlu optimasi lompat minggu.

### 8.4 Libur nasional Indonesia (`holidays-id.js`)

- **Sumber:** Surat Keputusan Bersama Menteri Agama, Menteri Ketenagakerjaan, dan Menteri PANRB tentang Hari Libur Nasional dan Cuti Bersama (terbit tiap tahun, biasanya September–Oktober tahun sebelumnya; kadang direvisi). 2026: 17 libur + 8 cuti bersama; 2027 sudah ditetapkan (18 libur + 8 cuti bersama, diumumkan September 2026).
- **Bentuk:** `{2026: {src: "SKB 3 Menteri …, <nomor/tanggal>", libur: [["2026-01-01", "Tahun Baru 2026 Masehi"], …], cuti: [[…]]}}` untuk 2025, 2026, 2027.
- **Pembaruan:** satu PR per tahun begitu SKB terbit (atau direvisi): tabel + `version` plugin naik → `hash` baru → precache baru → entri whatsnew. Checklist rilis frontend (PROTOCOL) mendapat butir "SKB tahun berikutnya sudah masuk?" sejak Oktober.
- **Tes:** tanggal sah dan di tahun kuncinya, urut, tanpa duplikat, nama tidak kosong, `src` tidak kosong; tidak ada tes yang bergantung pada tanggal hari ini (bom waktu CI).
- **Tahun tanpa data** di rentang tampak: hanya akhir pekan + catatan di bawah legenda "Libur nasional {tahun} belum ada di Alurik versi ini."
- Cuti bersama ASN vs swasta: satu daftar (SKB) dengan sakelar `cutiBersama` per kalender.

### 8.5 Susunan baris dan WBS (`layout.js`, murni)

1. Kelompok: halaman project → satu kelompok; halaman workspace → per project (`project_id`/nama) + "(Tanpa project)".
2. Di dalam kelompok: hierarki `parent_cid` (child task Alurik = WBS), urut `created_at` (stabil; mengurut menurut Mulai mengubah nomor WBS setiap seret). Opsi "Urutkan menurut Mulai" hanya mengubah tampilan, nomor WBS tetap.
3. Task induk (punya anak) = **ringkasan**: rentang min(mulai)–maks(selesai) anak terjadwal, tidak bisa diseret di 1b; ext miliknya disimpan tetapi tidak dipakai selama punya anak.
4. Dikecualikan: task berulang (`recurrence_type`), `archived`. Task `done` tampil dengan bar 100%.
5. Kolom tabel: WBS · Nama · Mulai · Dur · 🍅 (`pomodoros_done`/`estimated_pomodoros`) · % (`progress`). Kolom Slack muncul di 1c. HP (≤ 640 px) dan Live Edit aktif: hanya WBS + Nama; tombol "Kolom" menampilkan sisanya.

### 8.6 Render (K18)

- Wadah: tinggi `calc(100dvh − <offset header halaman>)`, min 360 px, gulir dua arah; kolom tabel `position: sticky; left: 0`; header skala waktu `position: sticky; top: 0`.
- Baris tinggi tetap 32 px (36 px di layar sentuh); virtualisasi: hanya baris di `[scrollTop − 10 baris, scrollTop + tinggi + 10 baris]` yang dirender (`requestAnimationFrame` pada `scroll`, tanpa setState per piksel).
- Sumbu x = hari kalender: Hari 28 px/hari, Minggu 12 px/hari, Bulan 4 px/hari (header: Hari = tanggal + nama minggu; Minggu = "Mg 45" + bulan; Bulan = bulan + kuartal). Rentang: min(mulai) − 14 hari s.d. maks(selesai, tenggat) + 30 hari, minimal ±60 hari dari hari ini. Zoom tersimpan per perangkat (`api.storage` `zoom:<page>`).
- Latar akhir pekan: `repeating-linear-gradient` periode 7 × px/hari yang dibangun dari `mask` kalender (berlaku untuk pola minggu apa pun); libur = `div` per tanggal hanya di rentang tampak; garis hari ini = satu `div` `--accent`.
- Bar: `div` absolut `transform: translateX()`, warna token (`--accent` biasa, `--text-secondary` ringkasan, lapisan `%` dari `progress`); milestone = belah ketupat 12 px; tenggat = bendera di tanggal `deadline`, merah bila `finish > deadline`; label nama di kanan bar bila muat.
- Panah FS: satu `<svg>` overlay seukuran jendela virtual; path ortogonal (keluar 6 px ke kanan dari akhir pendahulu, turun/naik, masuk ke awal penerus); digambar bila salah satu ujung tampak. Pelanggaran (penerus mulai sebelum awal paling cepat) = garis putus-putus merah + ikon peringatan di baris.
- Memo: tata letak dihitung `useMemo([scopeTasks, kalender, zoom])`; komponen `React.memo` pada identitas `context.tasks/scopeTasks`.
- Anggaran: ≤ ~1.500 elemen DOM; hitung tata letak 500 task ≤ 30 ms; render awal ≤ 150 ms (CPU 4×).
- Aksesibilitas: tabel `role="grid"`; bar `role="button"` + `aria-label` "Desain UI, Kam 5 Nov sampai Sel 10 Nov, 4 hari kerja, 60%"; fokus baris lalu Alt+←/→ menggeser 1 hk, Alt+Shift+←/→ mengubah durasi.

### 8.7 Interaksi

| Aksi | Desktop | Sentuh | Hasil |
|---|---|---|---|
| Buka task | klik bar/baris | ketuk | `context.onTaskClick` (Live Edit bila aktif) |
| Geser | seret badan bar (> 4 px) | tekan lama 350 ms lalu seret | jepret per hari; jatuh di hari libur → `nextWork`; durasi (hk) tetap; tooltip "Sen 9 Nov → Kam 12 Nov · 4 hk" |
| Ubah durasi | seret tepi kanan (area 8 px) | pegangan 16 px setelah tekan lama | durasi ≥ 1; milestone hanya lewat detail |
| Dependensi | seret titik di ujung bar ke bar lain | lewat detail "Tambah dependensi" | FS lag 0 di task penerus; siklus ditolak ("Dependensi ini membuat lingkaran"); hanya task di scope halaman yang sama |
| Batal | Esc saat menyeret | lepas di luar grafik | tanpa tulis |
| Urungkan | toast "Jadwal diubah · Urungkan" 5 detik | sama | `setMany` nilai lama |

Selama seret hanya `transform` bar yang berubah (ref + rAF); satu `api.taskExt.set` saat dilepas. Mode Manual: dependensi **tidak** memindahkan task; pelanggaran hanya ditandai. Aksi satu kali "Geser ke setelah dependensi" ada di seksi Jadwal.

### 8.8 Seksi "Jadwal" di detail task (1b)

Tampil untuk task non-berulang bila plugin ON (§15 Q5). Tingkat (1) bawaan: **Mulai** (tanggal) + **Durasi** (hk) + tautan "Tambah dependensi"; "Jadwal otomatis untuk project ini" tampil mulai 1c. Dibuka penuh (1b): Mulai · Durasi · **Selesai (terhitung)** · Milestone · % selesai (mengedit `progress` host lewat jalur detail yang ada) · daftar dependensi (task, tipe FS, lag, hapus) · peringatan tenggat ("Selesai Sel 10 Nov, 2 hk setelah tenggat") · peringatan pelanggaran + "Geser ke setelah dependensi". Tingkat (2) kartu ringkas mode Otomatis, Batasan, Baseline, "Kenapa dijadwalkan di sini?" dan beban penanggung jawab = 1c/1d. Teks UI bahasa Indonesia; "hk" ditulis "hari kerja" di detail, "hk" di tabel/tooltip.

### 8.9 Offline, sinkron, konflik, izin

- Semua baca/tulis Timeline lewat IndexedDB (task + record); view dan seksi bekerja offline sejak rilis terpasang (precache).
- Seret saat offline = update task lokal + op `task/update` dengan `ext_patch`; terkirim saat online.
- Konflik: dua orang menggeser task yang sama → kunci `timeline.start` terakhir yang **terkirim** menang (patch per kunci di server); edit judul di perangkat lain tidak menimpa jadwal (K4/K5). Kalender: LWW record (K10); edit lokal yang kalah → `onChange({lost})` → toast "Perubahan kalender di perangkat ini kalah oleh perubahan yang lebih baru".
- Izin: siapa pun yang bisa mengedit task bisa mengubah jadwalnya; kalender workspace bisa diubah semua anggota (K14). Anggota yang Timeline-nya OFF tidak melihat apa pun dan tidak merusak data.

## 9. Garis besar 1c dan 1d

**1c — Otomatis, CPM, baseline, tracking.** Mesin `schedule.js`: forward pass (topologis, Kahn; O(V+E)) dari tanggal mulai project (`record project`: `{auto, start}`) dengan batasan per task (`timeline.constraint`: ASAP/SNET/MFO); backward pass → late start/finish, **slack** (hk) dan **jalur kritis** (slack ≤ 0, merah); `timeline.mode` per task (Manual tetap dihormati sebagai titik jangkar). Toggle "Jadwal otomatis untuk project ini" dan "Jadwalkan ulang yang belum selesai ke setelah hari ini" selalu lewat **pratinjau** (daftar "Task · Mulai lama → baru · Δ hk", Terapkan/Batal) lalu `setMany`. "Kenapa dijadwalkan di sini?" = rantai pendahulu penentu + batasan + hari libur yang dilewati. **Baseline** 1–3 per project = record `baseline` `{n, name, savedAt, tasks: [{t: {$task}, start, finish, duration, target}]}` ≤ 64 KB (±500 task); bar baseline abu-abu tipis di bawah bar; tabel "Baseline vs sekarang". **Tracking**: `timeline.actual {start, finish}` terisi otomatis saat `progress` pertama > 0 / task selesai (bisa diubah). SS/FF/SF ditambahkan bila waktu memungkinkan (bentuk data sudah mendukung). Risiko: "jadwalkan ulang" 200 task = 200 PUT berurutan; bila terukur > 10 detik, 1c menambah `PATCH /api/tasks/ext` batch (≤ 100 task, satu `write_tx`) + op outbox batch — keputusan saat plan 1c.

**1d — Beban Tim, earned value, ekspor.** Record `resource` per anggota workspace (`res@list:<id>:<user_id>`: `{capacity: 🍅/hari (bawaan 8), leave: [{from, to, note}]}`); panel "Beban Tim" = histogram per orang per hari (🍅 terjadwal = sisa target `estimated_pomodoros − pomodoros_done` dibagi rata ke hari kerja tersisa task) vs kapasitas, hari lebih dari kapasitas merah; **leveling manual** (sorotan + daftar saran, pengguna yang menggeser). Split task manual `timeline.split` (segmen hk, mis. karena cuti). **Earned value 🍅**: PV dari baseline aktif, EV = `progress` × target, AC = `pomodoros_done`; SPI/CPI di ringkasan project. **Ekspor MSPDI XML** di klien (offline) lewat fasad baru `api.ui.saveFile(name, text, mime)` (unduh blob seperti `downloadBackup`, `index.html:782–797`; Tauri diperiksa). Prasyarat terbuka: `estimated_pomodoros` dibatasi `le=20` (`webapp.py:1232`, `:1260`) — terlalu kecil untuk task berhari-hari; split dari log 🍅 butuh hidrasi `pomodoro_log` ke IndexedDB (belum ada, K11 Fase 0a) → dikerjakan sebagai PR host tersendiri sebelum/selama 1d.

## 10. Offline dan sinkron (skenario)

| Skenario | Hasil |
|---|---|
| HP offline menggeser 5 bar, laptop mengganti judul salah satu task | HP: 5 op dengan `ext_patch`; laptop: PUT judul tanpa `ext_patch` (kunci tak tersentuh); keduanya bertahan |
| HP offline mengubah `timeline.start` task X; laptop (lebih baru) mengubah prioritas X; HP online | pull HP: LWW server menang → record diganti versi server, `timeline.start` lokal ditempel ulang + op diantre ulang (K5) → server punya prioritas laptop + jadwal HP |
| Dependensi ke task yang dibuat offline | op penerus ditahan sampai `POST` pendahulu sukses; ref ditulis ulang ke id server; lalu terkirim |
| Jendela deploy 1a-1 (server lama) | PUT 200 tanpa `ext` → `ext_dirty` tetap → terkirim ulang setelah restart |
| Jendela deploy 1a-2 | `GET/POST …/records` 404 tanpa `PLUGIN_UNKNOWN` → langkah pull gagal terisolasi; op tetap antre (pola K14 Fase 0b) |
| Pengguna baru masuk workspace | sidik jari kursor berubah → `reset` → tarik penuh → kalender workspace muncul |
| Pengguna dikeluarkan dari workspace | `reset` → record `list:` itu tidak terlihat lagi → dihapus lokal (yang bersih); op tertunda → `FORBIDDEN_SCOPE` → op dibuang + record lokal dihapus |
| Timeline OFF di laptop, HP mengubah kalender | push HP diterima (K9); laptop tidak menarik record sampai Timeline ON (lalu tarik penuh) |
| Dua tab, tab lama kode 1a-1, tab baru 1a-2 | tab lama menutup DB + banner muat ulang; tab baru meng-upgrade |

## 11. Pengujian

**pytest (baru):** `tests/test_task_ext.py` (ALTER idempoten; POST/PUT patch; `null` menghapus; namespace asing dibuang; 422 bentuk/ukuran/`$task`; respons `ext` objek di GET daftar/satu; K6 tanpa notifikasi untuk perubahan ext saja, dengan notifikasi bila field inti berubah; data `ext` rusak di DB → `{}`); `tests/test_plugin_records.py` (skema idempoten; `seq` naik urut commit di bawah dua thread `write_tx`; kursor + `more`; reset karena format/purge/sidik jari; LWW `base_version`/`updated_at` dipotong; idempoten kirim ulang; `FORBIDDEN_SCOPE`, `SCOPE_IMMUTABLE`, `INVALID`; 401/403 clipper/404/503; plugin OFF tetap bisa push; isolasi antar pengguna; CASCADE user/list; purge); `tests/test_plugin_loader.py` (ubah: `/records` dicadangkan, `_read_index` menyimpan izin). Pagar AST `test_dbconn_callsites.py` tetap lulus (modul baru memakai `dbconn`/`write_tx`).

**`node --test` (baru/ubah):** `db_v7.test.js` (upgrade v6 berisi data → v7 utuh; indeks; `versionchange` menutup dan menolak; `blocked` memancarkan event); `taskrepo_ext.test.js`, `syncpush_ext.test.js` (payload, `ext_dirty`, respons tanpa `ext`, tahan + tulis ulang `$task`), `syncpull_ext.test.js` (only-if-sent, tempel ulang saat server menang); `plugin_sync.test.js` (coalescing `op_qid`, atomik, LWW, `lost`, reset + sapu, scope hilang); `plugin_slot_views.test.js` (tombol dari indeks tanpa memuat kode, per halaman, fallback saat OFF/diredam); `plugin_taskext_api.test.js`; `timeline_calendar.test.js` (pergantian tahun, libur di hari Minggu, hari kerja pengganti, lag negatif, milestone, batas iterasi); `timeline_holidays.test.js`; `timeline_layout.test.js` (WBS, ringkasan, jendela virtual); `plugin_host_wiring.test.js` (baseline 46.095, langkah `sync()`, slot di `TaskDetailBody`); `build-plugins.test.js` (`parts`, `contributes`, `icon.path`); `chatdb.test.js:9–10` dan `db.test.js:66` → `DB_VERSION is 7`. `tests/test_plugins_node.py` `REQUIRED`/pola diperbarui.

**E2E (Playwright, `temporary_files/`):** dua konteks satu akun (seret di A → B setelah sinkron; offline A + edit judul di B); simulasi jendela deploy; **dua tab** (tab kode 1a-1 terbuka, tab 1a-2 dibuka → banner di tab lama, upgrade selesai); 500 task + 400 dependensi dengan CPU throttle 4× (waktu render, FPS gulir); 375 px (tekan lama, kolom ringkas, tanpa gulir halaman horizontal); Sakura gelap; Tauri Desktop bila build ada.

## 12. Rilis

| PR | SW / whatsnew | Restart | Anggaran `index.html` |
|---|---|---|---|
| 1a-1 | bump; `{"silent": true}` | `taskflow-web` + `taskflow` (bot memuat `plugin_loader`) | ≤ 35 (tombol view ~10, cabang render + context ~12, simpan per halaman ~5, slot detail ~4, `bindHost.updateTaskExt` ~2, `<script>` dbupgrade/STATIC 1) |
| 1a-2 | bump; `silent` | dua layanan | ≤ 5 (langkah `sync()`, event `tf:plugin-records`) |
| 1b | bump; "Timeline: lihat jadwal project sebagai Gantt" (+ poin hari kerja/libur nasional, seret untuk mengubah jadwal) | tidak (statis) | 0 |
| 1c | bump; whatsnew | tergantung batch ext | ≤ 5 |
| 1d | bump; whatsnew | tidak | ≤ 10 (`saveFile`) |

Setiap PR: `CACHE` + `__SW_VERSION` + fallback + tes versi; `STATIC` += modul baru; `app.css?v=382` tetap. **Rollback:** 1a-1 = revert sebagai rilis baru + restart; kolom `ext` dibiarkan (kode lama tidak membacanya; `SELECT *` lama meneruskan string `ext` yang diabaikan klien lama). 1a-2 = revert kode **tanpa** menurunkan `DB_VERSION` (§4); tabel `plugin_records` dibiarkan; op `plugin` di klien lama dibuang fallback `processOp` (`syncpush.js:2175`) — record yang belum terkirim hilang, maka rollback 1a-2 sebelum 1b rilis hampir tanpa data nyata. 1b = matikan plugin (tanpa deploy) atau revert.

## 13. Risiko dan mitigasi

| Risiko | Mitigasi |
|---|---|
| Tab lama pra-1a-1 memblokir upgrade v7 | handler dirilis lebih dulu (K2), jeda ≥ 3 hari, banner `blocked` di tab baru |
| Perubahan inti sinkron task (ext) merusak alur lama | PR tersendiri 1a-1; semua tes `syncpush`/`syncpull` lama lulus tanpa ubah asersi; patch hanya menambah field |
| Ext besar membengkakkan tarik penuh `GET /api/tasks` (masih tarik penuh, `syncpull.js:332`) | batas 4/16 KB; Timeline 1b ±150 B per task; delta pull task = pekerjaan host terpisah |
| Seret massal memicu banyak PUT dan notifikasi | K6; `setMany` satu muat ulang; batch server dinilai di 1c |
| Mesin jadwal lambat di HP | O(V+E), hitung ulang hanya saat data berubah (memo), anggaran terukur di E2E |
| Data libur salah/terlambat | sumber SKB tercatat per tahun, tes bentuk, butir checklist rilis, catatan UI untuk tahun kosong |
| `seq` MAX+1 butuh penulis serial | semua tulis record di `write_tx` (`BEGIN IMMEDIATE`); tes dua thread |
| Plugin membaca/menulis ext plugin lain | `api.taskExt` hanya namespace sendiri; ext plugin lain tetap terlihat di objek task (dokumentasikan "baca saja"); bukan sandbox (ADR-039 batas diketahui) |
| Rerender tiap detik saat Pomodoro berjalan | `context` di-memo host; komponen `React.memo` |

## 14. Di luar cakupan Fase 1

Status plugin per workspace (A2 opsi b); scope record `project:<id>`; strategi konflik `merge`/`manual`; `api.settings` dan izin `settings.project` (tetap dicadangkan); `on_task_written`, `jobs`, SSE siaran; "Hapus data plugin" (data workspace bersama — butuh aturan sendiri); siklus `migrate(from, to)` (B4) sampai ada perubahan format data pertama; delta pull task; batch push record (> 1 item per permintaan) sampai ada beban nyata; task types, biaya, resource pool lintas workspace, leveling otomatis; hidrasi `pomodoro_log` (PR host terpisah); sandbox plugin.

## 15. Keputusan untuk pemilik

1. **Q1 — Pembagian PR Fase 1.** Lima PR (1a-1 field plugin di task + slot; 1a-2 database plugin + IndexedDB v7; 1b Timeline dasar; 1c otomatis/CPM/baseline; 1d Beban Tim/ekspor), atau 1a tetap satu PR. **Rekomendasi: lima PR**; 1a-1 di-deploy dan didiamkan ≥ 3 hari sebelum 1a-2 supaya tab yang lama terbuka sudah membawa perbaikan "tab lain menahan pembaruan". Butuh restart `taskflow-web` + `taskflow` untuk 1a-1 dan 1a-2.
2. **Q2 — Cara membuktikan fondasi 1a.** (a) plugin contoh khusus tes, tanpa fitur baru bagi pengguna (seperti Fase 0b), atau (b) 1a dan 1b digabung. **Rekomendasi: (a)**, dengan syarat rencana 1b sudah ditulis dan direview sebelum 1a-2 di-merge, dan 1b menyusul segera setelahnya; perbedaan kebutuhan Timeline diperbaiki di 1a-2, bukan ditambal di 1b.
3. **Q3 — Timeline di workspace (A2 yang ditunda).** Tetap per anggota: siapa pun menyalakan Timeline untuk dirinya sendiri; jadwal, dependensi, dan kalender workspace dibagi ke semua anggota dan bisa diubah semua anggota yang bisa mengedit task; anggota yang mematikannya tidak melihat dan tidak merusak jadwal. **Rekomendasi: setujui**; "pemilik menyalakan untuk semua anggota" dan "hanya pemilik yang mengubah kalender workspace" ditunda sampai ada permintaan nyata.
4. **Q4 — Cuti bersama di kalender bawaan.** Cuti bersama dianggap hari libur (seperti libur nasional) atau hari kerja? **Rekomendasi: dianggap libur secara bawaan**, dengan sakelar "Ikuti cuti bersama" per kalender (pribadi dan per workspace) untuk tim swasta yang tetap bekerja.
5. **Q5 — Seksi "Jadwal" di detail task.** Tampil di semua task (kecuali task berulang) saat Timeline ON, atau hanya task yang punya project/workspace. **Rekomendasi: semua task non-berulang**, terlipat ke Mulai + Durasi saja, supaya task pribadi tanpa project juga bisa dijadwalkan dan langsung muncul begitu dimasukkan ke project.
