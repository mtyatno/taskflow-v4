# Sistem Plugin Fase 1 — PR 1c-0b: waktu inti task terpisah dari edit ext (menutup residual R2) — Spec ringkas + Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

---

## Bagian A — Spec ringkas

- **Status:** disetujui pemilik 2026-11-04 16.17 WIB — Q1 (a): task yang dihapus offline tetap terhapus walau anggota lain hanya menggeser jadwalnya. Pemilik memutuskan menutup residual **R2** (spec 1c §11, ADR-043) **sebelum** PR 1c-1. Zona waktu VPS belum dikonfirmasi pemilik; rancangan ini tidak bergantung padanya (aturan (1) hanya membandingkan cap waktu server).
- **Basis kode:** `main` @ `390e151d` (sudah memuat PR 1c-0 #123, SW `taskflow-v496-sinkron-ext`, IndexedDB `taskflow-offline` **v7**, 84 modul `static/offline/`, `index.html` 46.074 baris, `webapp.py` 10.888, `task_ext.py` 207, `syncpull.js` 2.038, `syncpush.js` 2.513).
- **Sumber:** spec 1c `docs/superpowers/specs/2026-11-01-plugin-fase1-1c-otomatis-design.md` (§6.3, "Catatan implementasi PR 1c-0", §6.4, §11 R2), ADR-040 dan ADR-043 `.agents/DECISIONS.md`, rencana 1c-0 `docs/superpowers/plans/2026-11-01-plugin-fase1-pr-1c-0.md` (R1–R20), audit sinkron `docs/superpowers/specs/2026-10-15-offline-sync-audit.md` (S9). Spec ini melanjutkan penomoran keputusan spec 1c (**K45–K50**).

### A.1 Masalah

PUT task "ext saja" (`{ext_patch}`, K25/1c-0) menaikkan `tasks.updated_at` di server. Tarik task (`syncpull.js:326–353`) memutuskan edit-vs-edit dengan LWW satu record utuh: untuk record lokal yang kotor dengan perubahan **inti**, `serverWins = tsEpoch(s.updated_at) > tsEpoch(localRec.updated_at)`. Akibatnya:

1. A offline mengubah judul T (10.10). B online menggeser bar Timeline T (10.20) → server `updated_at` = 10.20 tanpa perubahan inti. A online → sinkron (tarik dulu, `index.html:1481` → `:1307`) → server "lebih baru" → `dropOutbox` + tulis baris server → **judul A hilang tanpa salinan konflik**. Direproduksi pada `main` (eksperimen sementara, §Baseline): hasil tarik `title "Awal"`, `dirty 0`, op 0, `lwwResolved 1`.
2. Hal yang sama untuk status selesai, progress, penanggung jawab, tenggat, dan **penghapusan** task offline (task "hidup lagi").
3. Diperparah S9 (audit sinkron): server menulis `datetime.now().isoformat()` **naif** (zona host), klien menganggap tanpa zona = UTC. Bila zona VPS Asia/Jakarta, setiap cap waktu server tampak 7 jam lebih baru dari jam perangkat → dalam praktik **server selalu menang** perbandingan jam lintas mesin. Perbaikan yang hanya mengganti `updated_at` dengan "waktu inti" lalu tetap membandingkan dengan jam perangkat **tidak** menutup R2 di produksi.
4. 1c-1 (Terapkan jadwal otomatis, puluhan–ratusan PUT ext saja) melipatgandakan peluangnya.

### A.2 Keputusan

| # | Keputusan | Alasan |
|---|---|---|
| K45 | **Waktu inti server = `updated_at` revisi terakhir yang mengubah field inti.** Disimpan **terikat** pada `updated_at` (pola `ext_only_rev` 1c-0 R1, sisi server): dua kolom mentah `tasks.ext_core_at` (waktu inti yang dibekukan) dan `tasks.ext_only_at` (nilai `updated_at` yang ditulis PUT ext murni yang membekukan). Waktu inti efektif = `ext_core_at` **hanya bila** `ext_only_at = updated_at` dan `ext_core_at` tidak kosong; selain itu = `updated_at`. | Ada **12** pernyataan `UPDATE tasks` yang menaikkan `updated_at` di `webapp.py` dan `repository.py` (dipakai juga proses bot), ditambah skrip pemeliharaan. Kolom `core_updated_at` biasa yang wajib dinaikkan setiap penulis: satu penulis yang terlewat (hari ini atau kelak) membuat perubahan inti tampak **tua** → edit offline basi menimpa perubahan itu (arah berbahaya). Dengan ikatan, penulis mana pun yang tidak tahu kolom ini otomatis membatalkan pembekuan (waktu inti = `updated_at`, perilaku hari ini). Hanya **satu** jalur yang menulis kolom: PUT ext murni. Bot tidak perlu diubah. |
| K46 | **Pembekuan hanya pada "PUT ext murni"**: body tanpa field inti apa pun (`updates` kosong sebelum `updated_at`/`quadrant`, `recurrence_renew` tidak benar) **dan** `ext_patch` ada. Nilai dihitung **di SQL atas baris terkini** di pernyataan `UPDATE` yang sama: `ext_core_at = CASE WHEN ext_only_at IS NOT NULL AND ext_only_at = updated_at AND ext_core_at IS NOT NULL THEN ext_core_at ELSE updated_at END, ext_only_at = ?` (RHS SQLite memakai nilai baris lama). PUT penuh yang inti-nya kebetulan sama (klien lama) **tidak** membekukan. | PUT membaca `existing` **sebelum** `BEGIN IMMEDIATE` (dbconn K3, kode lama tidak di-refactor): penulis lain bisa commit di antaranya. Menghitung dari `existing` bisa membekukan waktu inti yang lebih tua dari perubahan inti yang baru saja masuk. Keputusan "murni" hanya dari body (deterministik); nilai dari baris terkini (atomik). PUT penuh dengan inti sama bisa menimpa perubahan inti konkuren (nilai inti basi) → tidak boleh dibekukan; arah konservatif = perilaku hari ini. |
| K47 | **API:** setiap keluaran `task_row_to_dict` memuat `core_updated_at` (string, waktu inti efektif); kolom mentah `ext_core_at`/`ext_only_at` **dibuang** dari respons. Nama field API sengaja **berbeda** dari nama kolom. | Rollback ke kode lama: `dict(row)` lama mengekspos kolom mentah apa adanya; bila namanya sama dengan field API, klien baru akan membaca nilai beku basi sebagai waktu inti (arah berbahaya). Dengan nama berbeda, server lama = field tidak ada = aturan lama. |
| K48 | **Klien, tarik task, record kotor dengan perubahan inti (bukan ext saja), server berubah sejak `base_rev`:** (1) **inti server tidak berubah sejak `base_rev`** — `core_updated_at` ada, terbaca, dan tidak lebih baru dari `base_rev` (keduanya cap waktu **server**, presisi mikrodetik) → **inti lokal menang tanpa membandingkan jam perangkat** (tetap kotor, push mengirim payload penuh; ext server diadopsi dari respons PUT oleh `taskAdopt`); (2) selain itu LWW lama tetapi sisi server memakai `core_updated_at` (fallback `updated_at`): `tsEpoch(core) > tsEpoch(localRec.updated_at)`. Record ext saja (1c-0 R7) **tidak berubah**. Server tanpa field → persis aturan lama. | (1) menutup R2 secara deterministik, kebal S9: server tidak punya perubahan inti yang bisa hilang, jadi tidak ada konflik inti sama sekali — mekanisme konflik yang ada (LWW) tetap dipakai hanya bila **kedua** sisi mengubah inti. (2) membuat edit ext perangkat lain tidak lagi "menyegarkan" sisi server dalam konflik inti sungguhan. |
| K49 | **Tidak ada penyimpanan klien baru**: IndexedDB tetap **v7**, `db.js`, `hydrate.js`, `taskext.js`, `taskrepo.js`, `syncpush.js` tidak berubah; `core_updated_at` hanya dibaca di `syncpull.js` saat memutuskan LWW (tidak disalin ke record). Payload push tidak berubah; notifikasi K6 tidak berubah. | Aturan (1) cukup membandingkan waktu inti server **terkini** dengan `base_rev` yang sudah ada; tidak perlu "waktu inti dasar". Permukaan perubahan klien satu fungsi. |
| K50 | **Rilis**: SW `taskflow-v497-waktu-inti`, whatsnew `silent`; restart **`taskflow-web` saja** (kode server baru di `webapp.py`/`task_ext.py`; bot tidak mengimpor `task_ext` dan tulisannya otomatis benar berkat K45); migrasi lewat `migrate_db` (deploy workflow sudah menjalankannya sebelum restart). Urutan: 1c-0b merge + deploy + restart + verifikasi → baru 1c-1. | Klien baru + proses lama (sebelum restart) = field tidak ada = aturan lama (aman). Verifikasi pasca-restart bisa membedakan proses lama/baru: respons task memuat `core_updated_at` hanya dari kode baru. |

### A.3 Bentuk data

**Server (SQLite, tabel `tasks`)** — `ALTER TABLE tasks ADD COLUMN ext_core_at TEXT` dan `ALTER TABLE tasks ADD COLUMN ext_only_at TEXT` (nullable, tanpa default, **tanpa backfill**; `NULL` = waktu inti = `updated_at`), idempoten per kolom lewat `PRAGMA table_info`, di blok project `migrate_db` tepat setelah `task_ext.ensure_schema(conn)` (`webapp.py:974`); gagal = `migrate_db` melempar = deploy berhenti sebelum restart (pola ADR-040 R1).

| Kejadian | `updated_at` | `ext_only_at` | `ext_core_at` | `core_updated_at` (API) |
|---|---|---|---|---|
| baris lama / POST baru | T0 | NULL | NULL | T0 |
| PUT ext murni (B seret bar) | T2 | T2 | T0 | **T0** |
| PUT ext murni lagi | T3 | T3 | T0 | T0 |
| penulis apa pun yang menaikkan `updated_at` (PUT inti, `/done`, `/focus`, pindah workspace, ganti nama project/tahap, bot, …) | T4 | T3 (basi) | T0 (basi) | **T4** |
| PUT ext murni berikutnya | T5 | T5 | T4 | T4 |

Diverifikasi di SQLite 3.53.1 (eksperimen sementara, §Baseline), termasuk urutan `SET` dibalik.

**API** — `GET /api/tasks`, `GET /api/tasks/{id}`, respons `POST`/`PUT`/`/done`/`/focus`/`PATCH …/workspace`, `child-tasks`, `current` di 409 `REV_MISMATCH`: tambah `"core_updated_at": "<ISO naif server>"` (selalu string bila `updated_at` ada). Tidak ada field lain berubah.

**Klien** — tidak ada kunci baru di IndexedDB. `TF.syncpull` mengekspor fungsi murni `serverCoreAt(s)` dan `coreUnchangedSince(s, baseRev)`; `result` `pullTasks` mendapat penghitung `coreKept`.

### A.4 Kasus tepi

| Kasus | Hasil |
|---|---|
| A offline ubah judul/status/progress/penanggung jawab; B hanya menggeser bar (online, satu atau banyak kali) | aturan (1): inti A menang, PUT penuh A sampai ke server, ext B tetap di server (`ext_patch` A hanya kunci kotor A) dan diadopsi A dari respons PUT |
| A offline ubah judul **dan** menggeser bar T; B menggeser bar T | inti A menang; kunci ext yang sama: yang terakhir sampai menang (K4, tidak berubah) |
| A offline ubah judul; B ubah judul online (konflik inti sungguhan) | aturan (2) LWW seperti hari ini dengan waktu inti server; S9 membuat server biasanya menang (pra-ada, tidak diubah) |
| A offline ubah judul (10.10); B ubah judul 10.05 lalu seret 10.20 | aturan (2): waktu inti server 10.05 vs A 10.10 (tanpa S9) → A menang; sebelum PR seret B membuat server menang |
| A offline **menghapus** task; B hanya menggeser bar | aturan (1): penghapusan A menang (task terhapus di server). Hari ini task "hidup lagi". **Q1 pemilik** |
| A tertunda ext saja (penanda 1c-0 sah) | jalur R7 1c-0 tidak berubah (inti server selalu menang, ext ditempel) |
| Daftar tarik basi (`s.updated_at` lebih tua dari `base_rev`) untuk record berinti tertunda | aturan (1): lokal menang (dulu bisa ditimpa daftar basi karena S9) |
| Edit inti selama PUT ext saja terbang (1c-0: adopsi inti dilewati, `base_rev` maju) | aturan (1) bisa memenangkan inti lokal atas perubahan inti anggota lain yang masuk **sebelum** PUT itu — urutan waktu nyata: edit lokal lebih baru, jadi tetap LWW yang benar; residual 1c-0 tetap dicatat |
| PUT penuh dari klien lama (tab 1c-0 belum diperbarui) dengan inti sama + `ext_patch` | tidak dibekukan (K46) → R2 tetap untuk tab lama sampai SW memperbarui (jendela deploy) |
| PUT ext murni ditolak 422 `EXT_TOO_LARGE` | seluruh PUT di-rollback termasuk pembekuan |
| PUT ext murni bersamaan dengan PUT inti anggota lain (race baca sebelum `BEGIN IMMEDIATE`) | `CASE` membaca baris terkini → waktu inti = waktu PUT inti itu |
| Penulis tanpa kenaikan `updated_at` (`pomodoros_done`, kuadran cron, `recurrence_notif_level`, tautan ulang `project_id`/`context_id`) | kedua nilai tidak berubah (tidak terlihat oleh tarik, pra-ada) |
| Bot Telegram mengubah task (`repository.update`, `toggle_focus`) | `updated_at` naik → waktu inti = `updated_at` tanpa kode bot baru |
| `core_updated_at` kosong / bukan string / tak terbaca, atau `base_rev` tak terbaca | aturan (1) tidak berlaku → aturan (2) (setara lama) |
| Dua revisi server dalam milidetik yang sama | dibandingkan dengan presisi mikrodetik (`tsMicro`) |
| Push A gagal setelah lokal menang | A tetap kotor dan menampilkan ext lama sampai push sukses (tidak ada data hilang); tarik berikutnya memutuskan hal yang sama |
| Proses web lama (jendela deploy) / server di-rollback | field tidak ada → aturan lama; kolom mentah yang terekspos `dict(row)` lama diabaikan klien |
| Edit ext **lokal** A setelah edit inti lokal A membuat `localRec.updated_at` lebih baru dari edit intinya (sisi lokal kebalikan R2) | tidak diubah (K49): hanya berpengaruh pada konflik inti sungguhan, dan di sana S9 lebih dominan. Tindak lanjut bersama S9 (§A.5) |

### A.5 Di luar cakupan

S9 (cap waktu server naif) — tindak lanjut host terpisah; LWW per field inti; tarik tag task (R8 1c-0); "waktu edit inti lokal" untuk sisi klien (baris terakhir A.4); salinan konflik untuk task (task tetap LWW).

### A.6 Keputusan untuk pemilik

- **Q1 — Task yang dihapus offline sementara anggota lain hanya menggeser jadwalnya.** (a) **Task tetap terhapus** (penghapusan adalah perubahan "inti"; menggeser jadwal tidak membatalkannya) — **rekomendasi**, konsisten dengan tujuan "perubahan jadwal tidak boleh membuat edit offline kalah"; (b) task muncul lagi seperti sekarang (perlu satu pengecualian di kode: aturan (1) tidak berlaku untuk record terhapus). Bila anggota lain mengubah judul/status task itu, perilaku tetap seperti sekarang di kedua opsi.

---

## Bagian B — Implementation Plan

**Goal:** Edit inti task yang dibuat offline tidak lagi kalah oleh perubahan `ext` (seret Timeline, seksi Jadwal, 1c-1 Terapkan) yang dibuat perangkat/anggota lain. Server menyimpan waktu inti terikat `updated_at` (K45), membekukannya hanya pada PUT ext murni secara atomik (K46) dan mengirim `core_updated_at` (K47); klien, saat tarik, memenangkan inti lokal bila inti server tidak berubah sejak `base_rev` (perbandingan jam server saja, kebal S9) dan memakai waktu inti untuk LWW sisanya (K48). Tanpa perubahan IndexedDB/payload/notifikasi (K49); restart `taskflow-web` sekali (K50).

**Architecture:** Server: `task_ext.py` mendapat `ensure_core_schema(conn)`, konstanta `CORE_FREEZE_SET` (potongan `SET` + satu parameter) dan `apply_core_at(d)` (hitung `core_updated_at`, buang kolom mentah); `webapp.migrate_db` memanggil `ensure_core_schema` setelah `ensure_schema`; `update_task` (PUT) menghitung `pure_ext` dari body lalu menambahkan `CORE_FREEZE_SET` ke `UPDATE` utamanya; `task_row_to_dict` memanggil `apply_core_at`. Tidak ada penulis lain yang disentuh (ikatan K45), dikunci tes pagar. Klien: `syncpull.js` mendapat `serverCoreAt`, `tsMicro`, `coreUnchangedSince` dan cabang LWW `pullTasks` (`:326–353`) diubah sesuai K48. `index.html` +0 baris (hanya string versi SW).

**Tech Stack:** Python 3.12 (CI) / 3.13 lokal, FastAPI 0.115, pydantic v2, `sqlite3` lewat `dbconn` (ADR-038), pytest; klien UMD tanpa bundler, `node --test` + `fake-indexeddb` (`tests/offline/setup.js`); Playwright (E2E manual). Tidak ada dependensi baru.

**Spec:** Bagian A dokumen ini (disalin ke spec 1c sebagai "Catatan implementasi PR 1c-0b" di Task 5). Spec induk 1c §11 R2, §6.4 baris "Jendela deploy"; ADR-040 (kolom `tasks.ext`, K6), ADR-043 (R2 residual). **Bukan** cakupan: §A.5.

**Branch:** `claude/task-core-time` dari `main` ≥ `390e151d`.

**Baseline** (dijalankan 2026-11-01 20.15–20.28 WIB di worktree `origin/main` `390e151d`, Python 3.13.18 / pytest 9.1.1 / Node 22.23.4 / SQLite 3.53.1, `node_modules` lewat symlink dari working tree utama):
- `python3 -m pytest tests/ -q` → **1435 passed, 1 skipped** (144,5 s).
- `npm test` → **4145 tes, 4144 lulus, 1 gagal pra-ada** (`Unified Offline Drawing Reactivity - Local Event Reactivity`, `draw_local_reactive`) (85 s).
- `node --test tests/build-plugins.test.js` → **26/26**; `syncpull`, `syncpull_ext`, `taskext_only_flow`, `taskext_writers_fence`, `syncpush_ext` → **124/124**; `tests/test_task_ext.py` → **23 passed**; PROTOCOL §4 butir 5 → **33 passed**.
- **Eksperimen R2 (sementara, dihapus):** `tests/offline/zz_r2_experiment.test.js` — record bersih `base_rev` T0, `updateTask({title: "Judul A"}, now 10.10Z)`, lalu `pullTasks([server updated_at 10.20 naif, judul "Awal", ext baru])` → `title "Awal"`, `dirty 0`, outbox 0, `{updated: 1, lwwResolved: 1}` — **judul A hilang** (bug terreproduksi di kode `main`).
- **Eksperimen SQL (sementara):** tabel `t(updated_at, ext_core_at, ext_only_at)`: PUT ext murni T2 → `(T2, T0, T2)`; lagi T3 → `(T3, T0, T3)`; penulis tak sadar T4 → `(T4, T0, T3)` (efektif T4); PUT ext murni T5 dengan `SET` dibalik → `(T5, T4, T5)` — RHS memakai nilai baris lama di semua urutan.

## Peta perubahan

| File | Status | Isi (Task) |
|---|---|---|
| `task_ext.py` | ubah (~35 baris) | `CORE_COLS`, `ensure_core_schema`, `CORE_FREEZE_SET`, `core_at_of`, `apply_core_at` (T1) |
| `webapp.py` | ubah (~10 baris) | `migrate_db` (+1 panggilan setelah `:974`), `task_row_to_dict` (+1 baris setelah `:1538`), `update_task` (`pure_ext` setelah `:2677`, `set_clause` `:2692–2694`) (T1) |
| `tests/test_task_core_time.py` | baru | perilaku PUT/POST/GET, matriks penulis, race, rollback/kolom NULL, migrasi, pagar (T1) |
| `static/offline/syncpull.js` | ubah (~30 baris) | `serverCoreAt`, `tsMicro`, `coreUnchangedSince`, cabang LWW `:326–353`, `result.coreKept`, ekspor `:2026` (T2) |
| `tests/offline/taskext_core_lww.test.js` | baru | unit aturan K48, alur dua perangkat (server palsu dengan semantik K45/K46), pagar pembaca `core_updated_at` (T2) |
| `static/sw.js`, `static/index.html`, `static/whatsnew.json`, berkas `tests/` yang memuat string versi | ubah | v497 + entri `silent` (T3) |
| `tests/test_plugins_node.py` | ubah | `REQUIRED` += `taskext_core_lww` (pola `taskext*.test.js` sudah ada) (T3) |
| `docs/plugins/README.md` | ubah | §5 `api.taskExt` butir "Tidak menimpa field inti": kalimat "Sisa batasan …" diganti (T3) |
| `.agents/DECISIONS.md` | ubah | ADR-044 (T3) |
| `temporary_files/e2e_plugin_fase1_1c0b.py` | baru | E2E (T4) |
| `docs/superpowers/specs/2026-11-01-plugin-fase1-1c-otomatis-design.md`, `docs/superpowers/plans/2026-11-01-plugin-fase1-pr-1c-0b.md`, `.agents/CURRENT_STATE.md`, `.agents/SESSION_LOG.md` | ubah / baru | catatan implementasi 1c-0b + §11 R2, salinan rencana, handover (T5) |

**Tidak berubah:** `repository.py`, `bot.py`, `models.py`, `dbconn.py`, `plugin_*.py`, `static/offline/{db,hydrate,taskext,taskrepo,syncpush,outbox,syncconflict,taskroutes}.js`, `static/plugin-runtime.js`, `static/plugins/**`, `static/app.css`, `compile.js`.

## Keputusan rencana (controller)

- **R1 — Kolom terikat, bukan kolom yang dirawat semua penulis (K45).** Hasil pemindaian `UPDATE\s+tasks\s+SET` (§Baseline, skrip sementara) — pernyataan yang menaikkan `updated_at`:

  | Berkas:baris | Jalur | Ubah inti? | Penanganan 1c-0b |
  |---|---|---|---|
  | `webapp.py:2694` | PUT `/api/tasks/{id}` (`set_clause` dinamis, `updated_at` selalu ada) | ya/tidak | satu-satunya penulis kolom: `CORE_FREEZE_SET` hanya bila `pure_ext` (R2) |
  | `webapp.py:2772` | `PATCH /api/tasks/{id}/workspace` (pindah) | ya | otomatis (ikatan) |
  | `webapp.py:2807` | `POST /api/tasks/{id}/done` | ya | otomatis |
  | `webapp.py:2844` | `POST /api/tasks/{id}/focus` | ya | otomatis |
  | `webapp.py:3223` | `PATCH /api/projects/{id}` (ganti nama) | ya (`project`) | otomatis |
  | `webapp.py:3247` | `DELETE /api/projects/{id}` | ya | otomatis |
  | `webapp.py:3417` | `PATCH /api/contexts/{id}` (ganti nama tahap) | ya (`context`) | otomatis |
  | `webapp.py:3441` | `DELETE /api/contexts/{id}` | ya | otomatis |
  | `repository.py:40` | `_return_tasks_to_creator` (keluar/hapus workspace) | ya | otomatis |
  | `repository.py:1346` | `TaskRepository.update` (bot, NLP) | ya | otomatis |
  | `repository.py:1597` | `TaskRepository.toggle_focus` (bot) | ya | otomatis |
  | `repository.py:1914` | `remove_list_member` (lepas penanggung jawab) | ya | otomatis |

  Tanpa `updated_at` (tidak terlihat tarik, tidak relevan): `webapp.py:2703` (ext, di dalam PUT yang sama), `:2906` (pomodoro), `:3024`/`:3029` (`recurrence_notif_level`), `:3464` (kuadran); `repository.py:266/307/558/604` (tautan ulang id), `:1242/1251` (`user_id`), `:1508` (kuadran); `fix_list_tasks.py:86`, `merge_db.py:84` (skrip manual). INSERT (`webapp.py:2489`, `repository.py:1290`, `:2141`) tidak perlu menyentuh kolom (NULL = `updated_at`). Semua penulis `updated_at` memakai `datetime.now().isoformat()` (naif, zona host) — invarian format yang dibutuhkan K48(1), dikunci tes (R8).
- **R2 — `pure_ext` dan pembekuan atomik (K46).** Di `update_task`, tepat setelah blok `recurrence` (`:2677`) dan **sebelum** `if not updates and ext_patch is None` (`:2679`): `pure_ext = ext_patch is not None and not updates and not req.recurrence_renew`. `ext_only` (K6, `:2682`) **tidak berubah**. Setelah `set_clause`/`values` dibangun (`:2692–2693`): `if pure_ext: set_clause += ", " + task_ext.CORE_FREEZE_SET; values.insert(-1, updates["updated_at"])` (parameter `ext_only_at` = nilai `updated_at` yang sama persis, sebelum `task_id`). Tidak ada perubahan pada urutan transaksi, `_check_base_rev`, tag, `ext` kedua, notifikasi. `CORE_FREEZE_SET = "ext_core_at = CASE WHEN ext_only_at IS NOT NULL AND ext_only_at = updated_at AND ext_core_at IS NOT NULL AND ext_core_at <> '' THEN ext_core_at ELSE updated_at END, ext_only_at = ?"`.
- **R3 — `apply_core_at(d)` (K47).** `core_at_of(d) = d["ext_core_at"] if (d.get("ext_only_at") is not None and d.get("ext_only_at") == d.get("updated_at") and d.get("ext_core_at")) else d.get("updated_at")`; `apply_core_at(d)`: `d["core_updated_at"] = core_at_of(d)`, `d.pop("ext_core_at", None)`, `d.pop("ext_only_at", None)`, kembalikan `d`. Dipanggil di `task_row_to_dict` setelah `d["ext"] = …` (`:1538`). Baris tanpa kolom (DB tes lama) → `updated_at`. Nama kolom mentah hanya muncul di `task_ext.py` (pagar).
- **R4 — Migrasi (K45, K50).** `ensure_core_schema(conn) -> bool` (True bila ada kolom ditambahkan; tabel tidak ada → False; tanpa commit; pola `ensure_schema :68–75`). `migrate_db` blok project: `task_ext.ensure_core_schema(conn)` tepat setelah `task_ext.ensure_schema(conn)` (`:974`) dan sebelum `conn.commit()`. Tidak ada backfill (menghindari `UPDATE` seluruh tabel saat deploy).
- **R5 — Aturan tarik (K48).** Di `syncpull.js`:
  - `serverCoreAt(s)` = `s.core_updated_at` bila string tak kosong, selain itu `null`.
  - `tsMicro(ts)` = `tsEpoch(ts)` + pecahan milidetik dari digit ke-4 dst. (pola `syncpush.tsPrecise :364–370`; disalin, bukan diimpor, agar `syncpull` tidak bergantung pada ekspor baru `syncpush`).
  - `coreUnchangedSince(s, baseRev)` = `c = serverCoreAt(s)`; `false` bila `c == null`, `baseRev` kosong, `tsMicro(c) <= 0` atau `tsMicro(baseRev) <= 0`; selain itu `!(tsMicro(c) > tsMicro(baseRev))`.
  - Cabang LWW (`:336–338`): `extOnly` → ekspresi 1c-0 apa adanya; `coreUnchangedSince(s, localRec.base_rev)` → `serverWins = false`, `result.coreKept++`; selain itu `tsEpoch(serverCoreAt(s) || s.updated_at) > tsEpoch(localRec.updated_at)`. `result.lwwResolved++` tetap di tempatnya. Cabang "server menang" dan "lokal menang" (`return;` `:353`) tidak berubah. Komentar menjelaskan S9 (jam server vs jam perangkat).
  - `result` awal (`:313`) += `coreKept: 0`; ekspor (`:2026`) += `serverCoreAt, coreUnchangedSince`.
- **R6 — Modul klien lain sengaja tidak berubah (K49), dengan alasan dari kode.** `markPushed` (`syncpush.js:387–410`) dan `adoptCore` (`:691–697`) memakai `updated_at` sebagai **identitas revisi** (urutan maju `base_rev`, respons basi) — waktu inti bukan identitas revisi (banyak revisi berbagi satu waktu inti), jadi tetap `updated_at`. `taskAdopt` (`:520–560`) sudah mengadopsi `ext` server dari respons PUT penuh (dibutuhkan setelah "lokal menang"). `hydrate.taskFromServer` tetap `base_rev = updated_at`; `core_updated_at` tidak disalin (tidak dibutuhkan aturan (1)). `taskext`/`taskrepo`/penanda `ext_only_rev` dan jalur R7/R11 tidak berubah. Payload push identik (tidak ada perubahan `syncpush.js`).
- **R7 — Sisi lokal tidak dibuat "waktu inti lokal" (deviasi dari kemungkinan perluasan).** Dipertimbangkan kunci `core_edit_at`/`core_edit_rev` terikat `rev`: hanya memengaruhi aturan (2) (konflik inti sungguhan), dan di produksi aturan (2) didominasi S9. Biaya (kunci IndexedDB baru, audit penulis store `tasks`, tes pagar 1c-0 berubah) tidak sebanding. Dicatat sebagai residual + tindak lanjut bersama S9.
- **R8 — Pagar server (`tests/test_task_core_time.py`).** (a) Nama `ext_core_at`/`ext_only_at` hanya muncul di `task_ext.py` di antara `*.py` akar repo (tidak termasuk `tests/`, `venv/`, `temporary_files/`, `taskflow-v4-web-addon/`); `webapp.py` memuat `task_ext.CORE_FREEZE_SET` tepat sekali (di dalam `update_task`, AST) dan `task_ext.apply_core_at` tepat sekali (di dalam `task_row_to_dict`). (b) `AUDIT` per berkas: jumlah pernyataan `UPDATE tasks SET … updated_at` = `{"webapp.py": 8, "repository.py": 4}` (pemindai: dari `UPDATE\s+tasks\s+SET` sampai `WHERE` terdekat, ≤ 400 karakter; f-string `set_clause` PUT dihitung lewat penanda khusus) — berubah → gagal dengan pesan "penulis `updated_at` task berubah di <file>: pastikan nilainya `datetime.now().isoformat()` (naif) dan tinjau ADR-044, lalu perbarui AUDIT". (c) Matriks perilaku untuk **setiap** baris tabel R1 (setelah satu PUT ext murni): `core_updated_at == updated_at`, lebih baru dari nilai beku, dan `datetime.fromisoformat(updated_at).tzinfo is None`. (d) Penulis tanpa `updated_at` (pomodoro, kuadran, `recurrence_notif_level`): `updated_at` dan `core_updated_at` tidak berubah.
- **R9 — Jendela deploy dan kompatibilitas (K50).** Workflow deploy (`deploy.yml`: `git reset`, `node compile.js`, `python -c "import webapp; webapp.migrate_db()"`) **tidak me-restart**:

  | Kombinasi | Hasil |
  |---|---|
  | Klien 1c-0b + proses web lama (setelah migrasi, sebelum restart) | respons `dict(row)` lama memuat kolom mentah (NULL), tanpa `core_updated_at` → aturan lama; PUT lama tidak membekukan → R2 tetap sampai restart, tanpa error |
  | Klien lama (tab 1c-0) + server baru | field diabaikan; PUT `{ext_patch}` dari klien 1c-0 tetap dibekukan (menguntungkan klien baru) |
  | Klien 1c-0b + server baru | K48 aktif |
  | Bot (`taskflow`) tidak di-restart | kode bot tidak berubah; tulisannya menaikkan `updated_at` → waktu inti benar (K45) |
  | DB belum termigrasi + kode baru | tidak terjadi (migrasi sebelum restart, dan `startup` juga memanggil `migrate_db`); bila `migrate_db` gagal, deploy berhenti |
- **R10 — Rollback.** Revert sebagai rilis baru (SW bump + whatsnew `silent`) + restart `taskflow-web`. Kolom dibiarkan (kode lama mengabaikannya; `dict(row)` lama mengekspos nama mentah yang tidak dibaca klien → aturan lama, K47). Penulisan kode lama menaikkan `updated_at` sehingga pembekuan lama otomatis batal bila 1c-0b dipasang lagi. Tanpa data hilang. Rollback 1c-0b setelah 1c-1 terpasang **boleh** (1c-1 tidak bergantung pada K45–K48; hanya R2 kembali).
- **R11 — Rilis.** SW `taskflow-v497-waktu-inti` (nomor berikutnya setelah `taskflow-v496-sinkron-ext` di `static/sw.js:1`; bila `main` maju, PROTOCOL §4 butir 4), whatsnew `{"version": "taskflow-v497-waktu-inti", "date": "<tanggal rilis WIB>", "silent": true}`, `app.css?v=383` tetap, `index.html` hanya dua string versi (`__SW_VERSION` + fallback), `wc -l` tetap 46.074; jumlah modul `static/offline/` tetap 84; `STATIC` SW tidak berubah selain `CACHE`. Restart **`taskflow-web` saja**. Verifikasi pasca-restart: (a) wajib `systemctl show -p ActiveEnterTimestamp taskflow-web` lebih baru dari waktu selesai deploy; (b) wajib — DevTools Network (atau `curl` bertoken) `GET /api/tasks?include_done=true` → item memuat `core_updated_at` (hanya proses baru; membedakan proses lama/baru); (c) seret bar Timeline lalu `GET /api/tasks/<id>` → `updated_at` naik, `core_updated_at` tetap.
- **R12 — Tes lama tidak diubah asersinya.** Semua `syncpull*.test.js`, `syncpush*.test.js`, `taskext*.test.js` (termasuk `taskext_writers_fence` — tidak ada penulis store `tasks` baru), `cas_rev.test.js`, `test_task_ext.py`, `test_sync_audit_server.py`, `test_projects_*`, `test_contexts_*`, `test_workspace_*` lulus tanpa perubahan asersi. Tes LWW lama memakai dict server tanpa `core_updated_at` → aturan lama (bukti kompatibilitas). Bila satu tes lama gagal → **berhenti dan laporkan**.
- **R13 — E2E.** Pola `temporary_files/e2e_plugin_fase1_1c0.py` (modul aman diimpor: `main()` di bawah `__name__`; `import e2e_plugin_fase1_1c0 as c0`, tambahkan `c0.OLD["static/offline/syncpull.js"] = c0.old_src(...)`). Server uvicorn lokal dengan `TZ=Asia/Jakarta` (mereproduksi S9 seperti produksi). Kontrol kepekaan ganda: (i) `syncpull.js` dari `origin/main` (kode sebelum PR) → judul hilang; (ii) kode PR tetapi respons tarik dilucuti `core_updated_at` (`route.fetch()` + `fulfill`) → judul hilang (bukti jendela deploy = perilaku lama dan bahwa perbaikan bergantung pada field).
- **R14 — Urutan terhadap 1c-1.** 1c-0b merge + deploy + restart `taskflow-web` + verifikasi R11 → baru rencana/merge 1c-1. 1c-1 tidak butuh perubahan karena 1c-0b (PUT ext saja otomatis dibekukan).

## Global Constraints

- Server hanya `webapp.py` (≤ ~10 baris) dan `task_ext.py`; tidak ada endpoint baru; `repository.py`/`bot.py` tidak berubah; nama kolom mentah hanya di `task_ext.py`; tidak ada `UPDATE` seluruh tabel saat migrasi.
- K6: notifikasi "memperbarui task" identik (variabel `ext_only` dan `_core_changed` tidak disentuh; tes `test_ext_only_put_no_workspace_notification` lulus apa adanya).
- Klien: hanya `syncpull.js`; payload push identik byte-per-kunci (tidak ada perubahan `syncpush.js`); IndexedDB tetap **v7**, tidak ada kunci record baru; `index.html` **+0 baris** (dua string versi); `app.css` tetap; `static/plugins/` tetap (`node compile.js` dua kali tanpa diff); `TF.api.apiVersion` tetap `1`.
- `core_updated_at` hanya dibaca di `syncpull.js` lewat `serverCoreAt` (pagar T2).
- Setelah setiap task: `python3 -m pytest tests/ -q` hijau (1435 lama + baru, 1 skip) dan, untuk task klien, `npm test` (hanya gagal pra-ada `draw_local_reactive`).
- Commit `feat(sync)`, `test(sync)`, `docs(sync)`, `chore(release)`; atribusi commit/PR sesi. Rilis mengikuti PROTOCOL §4.

## Review Focus

1. **Tidak ada jalur yang membuat perubahan inti tampak lebih tua dari kenyataannya** — ikatan `ext_only_at = updated_at` (R1), pembekuan hanya `pure_ext` dari body (R2), nilai dari baris terkini di SQL (race), penulis lain tidak menyentuh kolom (pagar R8).
2. **Aturan (1) hanya membandingkan cap waktu server** (`core_updated_at` vs `base_rev`), presisi mikrodetik, tidak pernah benar bila salah satu tak terbaca; aturan (2) = lama bila field tidak ada.
3. **Invarian `base_rev`** — setiap jalur yang memajukan `base_rev` (pull `write`, R11, `markPushed` setelah POST/PUT penuh/ext saja, `hydrate`) meninggalkan record yang intinya sama dengan inti server pada `base_rev` atau berisi edit lokal yang lebih baru; kasus 1c-0 "edit inti selama PUT ext saja terbang" ditinjau (A.4).
4. **Ext anggota lain tidak tertimpa dan sampai ke perangkat A** setelah "lokal menang" (`ext_patch` A hanya kunci kotor; `taskAdopt` mengadopsi `ext` respons).
5. **Kompatibilitas jendela deploy dan rollback** (R9, R10, nama field ≠ nama kolom).
6. **Q1** diterapkan sesuai jawaban pemilik (opsi (b) = satu syarat `!localRec.deleted` di aturan (1) + tes).

---

### Task 1: Server — kolom terikat, pembekuan PUT ext murni, `core_updated_at`, pagar penulis

**Files:**
- Modify: `task_ext.py` (setelah `ensure_schema :68–75`), `webapp.py` (`migrate_db :974`, `task_row_to_dict :1538`, `update_task :2677–2694`)
- Test (baru): `tests/test_task_core_time.py` (impor `from conftest import db, client`, `from test_direct_messages import U, _mk_list, _rows`; helper `_post/_put/_get/_full_payload` disalin dari `tests/test_task_ext.py:247–278`; fixture `demo_index` dari `test_task_ext` bila perlu namespace `demo-ext`)

**Interfaces (Produces):** `task_ext.CORE_COLS = ("ext_core_at", "ext_only_at")`; `task_ext.ensure_core_schema(conn) -> bool`; `task_ext.CORE_FREEZE_SET: str` (satu `?`); `task_ext.core_at_of(d) -> str | None`; `task_ext.apply_core_at(d: dict) -> dict`. API: field `core_updated_at` di semua keluaran `task_row_to_dict`.

- [ ] **Step 1: Tulis tes gagal** (`tests/test_task_core_time.py`):
  - `test_ensure_core_schema_idempotent` (DB tmp: tabel `tasks` minimal → True lalu False; kolom `TEXT`, nullable, default NULL; tanpa tabel → False).
  - `test_migrate_db_adds_core_cols_idempotent` (pola `test_migrate_db_adds_ext_idempotent :462–489`: DROP kedua kolom, sisipkan baris lama, `migrate_db()` dua kali → kolom ada, baris lama NULL; AST: `task_ext.ensure_core_schema(conn)` tepat sekali, setelah `task_ext.ensure_schema` dan sebelum `plugin_loader.migrate`).
  - `test_post_and_get_have_core_equal_updated_at` (POST, GET satu, GET daftar `include_done=true`: `core_updated_at == updated_at`; kunci `ext_core_at`/`ext_only_at` **tidak** ada di respons).
  - `test_pure_ext_put_freezes_core` (POST T0; `_put(tid, ext_patch={…})` → `updated_at > T0`, `core_updated_at == T0`; PUT ext murni kedua → tetap T0; GET daftar sama; baris DB: `ext_only_at == updated_at`).
  - `test_core_put_after_freeze_moves_core` (setelah beku: PUT `{title}` → `core_updated_at == updated_at`; PUT ext murni berikutnya → beku di waktu PUT judul).
  - `test_put_not_pure_never_freezes` (param: `{ext_patch, gtd_status}`, `{ext_patch, title}`, `_full_payload(t) + ext_patch` dengan inti sama (klien lama), `{ext_patch, recurrence_renew: True}`, `{title}` saja → `core_updated_at == updated_at`; `{ext_patch, title: None, progress: None}` → **beku** (nilai `null` = tidak dikirim di server)).
  - `test_pure_ext_put_rejected_rolls_back_freeze` (patch melewati `TOTAL_MAX_BYTES` → 422 `EXT_TOO_LARGE`; baris DB `updated_at`, `ext_core_at`, `ext_only_at` tidak berubah).
  - `test_freeze_reads_current_row_not_stale_existing` (beku dulu; lalu `monkeypatch` `webapp._can_access_task` agar mengembalikan baris **basi** yang dibaca sebelum `UPDATE tasks SET title=?, updated_at=?` langsung ke DB (menirukan penulis konkuren yang commit di antara SELECT dan UPDATE); PUT ext murni → `core_updated_at` == `updated_at` penulis konkuren itu, bukan nilai beku lama).
  - `test_unaware_writer_invalidates_freeze` (beku; `UPDATE tasks SET title='x', updated_at=?` mentah (menirukan kode lama/rollback/penulis baru) → `core_updated_at == updated_at` baru).
  - `test_rows_without_cols_or_null` (`apply_core_at` atas dict tanpa kolom → `updated_at`; `ext_only_at == updated_at` tetapi `ext_core_at` None/"" → `updated_at`; tidak mengubah kunci lain).
  - `test_writers_after_freeze_bump_core` — **matriks R8(c)**, satu kasus per baris tabel R1 (selain PUT): `POST /done`, `POST /focus`, `PATCH /api/tasks/{id}/workspace` (task pribadi → W), `PATCH /api/projects/{id}` ganti nama, `DELETE /api/projects/{id}`, `PATCH /api/contexts/{id}` ganti nama, `DELETE /api/contexts/{id}`, `TaskRepository(DB_PATH).update(task)` (jalur bot), `TaskRepository.toggle_focus`, `TaskRepository.remove_list_member` (task ber-`assigned_to` anggota itu), `_return_tasks_to_creator` lewat jalur publik keluar/hapus workspace. Masing-masing: beku dulu lewat PUT ext murni, jalankan penulis, GET → `core_updated_at == updated_at` > nilai beku dan `fromisoformat(updated_at).tzinfo is None`.
  - `test_writers_without_updated_at_keep_core` (`POST /api/tasks/{id}/pomodoros` (`:2893`, menambah `pomodoros_done`), hitung ulang kuadran `recalculate_eisenhower` (`:3450`), `check_recurring_expiry` (`recurrence_notif_level`, `:3024`) → `updated_at` dan `core_updated_at` tetap).
  - `test_rev_mismatch_current_has_core` (PUT dengan `base_rev` salah → 409, `detail.current.core_updated_at` ada).
  - `test_k6_and_payload_unchanged` (PUT ext murni workspace → tanpa notifikasi `memperbarui task`; PUT `{title}` → satu notifikasi) — penegasan, tes lama `test_task_ext.py:394` tetap.
  - **Pagar** `test_core_cols_only_in_task_ext` (R8(a), termasuk AST `webapp.update_task` memuat `task_ext.CORE_FREEZE_SET` sekali dan `task_row_to_dict` memuat `task_ext.apply_core_at` sekali) dan `test_task_updated_at_writers_audit` (R8(b), `AUDIT = {"webapp.py": 8, "repository.py": 4}` dengan alasan per baris dari tabel R1 sebagai komentar; kasus kontrol: string contoh dengan `UPDATE tasks SET x=?, updated_at=? WHERE` terdeteksi, `UPDATE tasks SET quadrant=? WHERE` tidak).
- [ ] **Step 2: Jalankan → FAIL** `python3 -m pytest tests/test_task_core_time.py -q` (`AttributeError: ensure_core_schema` / `KeyError: core_updated_at`).
- [ ] **Step 3: Implementasi** (R2, R3, R4).
- [ ] **Step 4: Jalankan → PASS**; `python3 -m pytest tests/ -q` (1435 lama + baru, 1 skip; R12); asap `python3 -c "import webapp, bot"`.
- [ ] **Step 5: Commit** `feat(sync): waktu inti task terikat updated_at; PUT ext murni membekukannya (core_updated_at)`

### Task 2: Klien — LWW tarik memakai waktu inti server

**Files:**
- Modify: `static/offline/syncpull.js` (helper di dekat `tsEpoch :242–250`; `pullTasks` `result :313`, cabang `:326–353`; ekspor `:2026`)
- Test (baru): `tests/offline/taskext_core_lww.test.js` (pola `tests/offline/syncpull_ext.test.js:1–40` untuk `putTasks/getTask/local/srv`; alur dua perangkat dengan server palsu pola `tests/offline/taskext_only_flow.test.js`)

**Interfaces:** Produces `TF.syncpull.serverCoreAt(s) -> string | null`, `TF.syncpull.coreUnchangedSince(s, baseRev) -> boolean`; `pullTasks` → `result.coreKept`.

- [ ] **Step 1: Tulis tes gagal**:
  - `"coreUnchangedSince: vektor"` — core = base → true; core < base → true; core > base (mikrodetik: `…00.123457` vs `…00.123456`) → false; tanpa pecahan vs dengan pecahan; spasi SQLite `"2026-11-01 10:00:00"`; `core_updated_at` hilang/`""`/angka/`null` → false; `baseRev` null/`""`/tak terbaca → false; `serverCoreAt` hanya string tak kosong.
  - `"R2: inti lokal tertunda + server hanya berubah ext (core = base_rev) → lokal menang"` — record `base_rev` T0, `updateTask({title: "Judul A"})`; tarik dict `updated_at` T2 (naif, **lebih baru** dari edit lokal dalam tafsir UTC), `core_updated_at` T0, ext baru → judul A, `dirty 1`, op update tetap 1, `lwwResolved 1`, `coreKept 1`, `updated 0`.
  - `"kontrol: dict yang sama TANPA core_updated_at → server menang (aturan lama, bug terreproduksi)"`.
  - `"inti server berubah setelah base_rev dan lebih baru dari edit lokal → server menang"`; `"inti server berubah setelah base_rev, LEBIH TUA dari edit lokal, updated_at lebih baru (seret sesudahnya) → lokal menang lewat aturan (2)"`; `"... aturan lama dengan updated_at akan memenangkan server"` (bandingkan).
  - `"status selesai / progress / assigned_to / deadline lokal tertunda + server ext saja → lokal menang"` (satu tes berparameter).
  - `"hapus lokal tertunda + server ext saja → op delete tetap, record deleted tetap"` (**Q1 (a)**; bila pemilik memilih (b): server menang dan tes ini dibalik).
  - `"record ext saja (penanda sah) + core = base → jalur R7 1c-0 (inti server, ext ditempel, op diantre ulang)"` — aturan (1) tidak berlaku untuk ext saja.
  - `"daftar basi (s.updated_at < base_rev, core < base_rev) untuk record berinti tertunda → lokal menang"`.
  - `"sync_error / conflict / base_rev null → tidak berubah"` (dilewati seperti sebelumnya).
  - **Alur dua perangkat** `"A offline judul; B PUT {ext_patch}; A pull→push"` — server palsu menyimpan baris dengan `updated_at`, `ext_core_at`, `ext_only_at` dan menerapkan aturan K45/K46 (PUT tanpa kunci inti → beku; dengan kunci inti → tidak), GET daftar memakai `apply_core_at` versi JS di tes; A (`fake-indexeddb`) `pullTasks` → `pushOutbox` → body PUT A penuh (`FULL_KEYS` 1c-0) **tanpa** `ext_patch`; baris server: judul A, ext B utuh; record A setelah push: `dirty 0`, ext = ext B (adopsi `taskAdopt`), `base_rev` = `updated_at` respons. Varian: A juga punya `ext_dirty` kunci lain → PUT penuh + `ext_patch` kunci A saja, ext server = gabungan.
  - **Pagar** `"core_updated_at hanya dibaca syncpull.js"` — literal `core_updated_at` (komentar dibuang, pakai `stripComments` dari `taskext_writers_fence.test.js` lewat `require` bila diekspor, selain itu salin kecil) tidak muncul di `static/offline/*.js` lain maupun `static/index.html`; di `syncpull.js` hanya di dalam `serverCoreAt`.
- [ ] **Step 2: Jalankan → FAIL** `node --test tests/offline/taskext_core_lww.test.js`.
- [ ] **Step 3: Implementasi** (R5).
- [ ] **Step 4: Jalankan → PASS**, `npm test` (semua `syncpull*.test.js`, `syncpush*.test.js`, `taskext*.test.js`, `cas_rev.test.js` lulus tanpa diubah — R12).
- [ ] **Step 5: Commit** `feat(sync): tarik task — inti lokal menang bila inti server tidak berubah sejak base_rev (core_updated_at)`

### Task 3: Rilis — SW v497 `silent`, README §5, ADR-044, pola tes CI

**Files:** `static/sw.js` (`CACHE :1`), `static/index.html` (`__SW_VERSION` + fallback; hanya dua baris), berkas `static/` + `tests/` yang memuat `taskflow-v496-sinkron-ext` (sed **kecuali** `static/whatsnew.json`), `static/whatsnew.json`, `tests/test_plugins_node.py` (`REQUIRED :33–40`), `docs/plugins/README.md` (§5 `api.taskExt` `:194–200`), `.agents/DECISIONS.md` (ADR-044 setelah ADR-043)

- [ ] **Step 1: Versi** `taskflow-v496-sinkron-ext` → `taskflow-v497-waktu-inti` (R11; cek `static/sw.js` di `main` saat merge, PROTOCOL §4 butir 4); `app.css?v=383` tetap; `wc -l static/index.html` = 46.074.
- [ ] **Step 2: whatsnew** entri teratas `{"version": "taskflow-v497-waktu-inti", "date": "<tanggal rilis WIB>", "silent": true}`.
- [ ] **Step 3: `tests/test_plugins_node.py`** `REQUIRED` += `"taskext_core_lww"`.
- [ ] **Step 4: README §5** — kalimat "Sisa batasan: edit inti offline yang lebih tua dari edit ext perangkat lain bisa kalah saat ditarik (…)" diganti: "Edit ext tidak membuat edit inti offline perangkat lain kalah: server mencatat waktu inti task terpisah (`core_updated_at`, tidak naik oleh PUT yang hanya membawa `ext_patch`), dan perangkat yang tertunda dengan edit inti menang bila inti server belum berubah sejak terakhir ia sinkron. Bila kedua sisi mengubah field inti, last-write-wins seperti biasa." Kalimat tag (R8 1c-0) dipertahankan.
- [ ] **Step 5: ADR-044** "Waktu inti task terikat `updated_at` (`core_updated_at`); tarik memenangkan inti lokal bila inti server tidak berubah" (Date / Agent / Context / Decision / Consequences, format ADR-043): **Context** — residual R2 ADR-043 (PUT ext saja menaikkan `updated_at`; tarik LWW satu record; reproduksi baseline), S9 (cap waktu server naif → server tampak 7 jam lebih baru), 12 penulis `updated_at` lintas web/bot. **Decision** — K45–K49 + R1–R5 (dua kolom mentah terikat, pembekuan hanya PUT ext murni dihitung di SQL, field API berbeda nama, migrasi tanpa backfill, aturan tarik (1) cap waktu server saja + (2) LWW waktu inti, klien hanya `syncpull.js`, tanpa IndexedDB/payload/K6 berubah) + jawaban Q1. **Consequences** — edit inti offline tidak lagi hilang karena seret/Terapkan Timeline perangkat lain (juga penghapusan, sesuai Q1); daftar tarik basi tidak lagi menimpa edit inti tertunda (efek samping baik); penulis server baru otomatis benar selama menaikkan `updated_at` dengan `datetime.now().isoformat()` (pagar `test_task_core_time`); PUT penuh dari klien lama tidak dibekukan; restart `taskflow-web` (bot tidak); verifikasi `core_updated_at` di respons; rollback = rilis baru + restart, kolom dibiarkan; residual: konflik inti sungguhan tetap LWW yang dipengaruhi S9, edit ext lokal tetap memajukan `updated_at` lokal (R7), tag (R8 1c-0) tetap.
- [ ] **Step 6: Verifikasi** PROTOCOL §4 butir 5 (`tests/test_whatsnew.py tests/test_sw_precache_node.py tests/test_app_update_node.py`), `python3 -m pytest tests/test_plugins_node.py -q`, `npm test`, `python3 -m pytest tests/ -q`, `node compile.js` dua kali tanpa diff, `node temporary_files/check_inline_scripts.js static/index.html`.
- [ ] **Step 7: Commit** `chore(release): SW v497 waktu-inti (silent), README taskExt, ADR-044`

### Task 4: E2E Playwright (dua perangkat)

**Files:** Create `temporary_files/e2e_plugin_fase1_1c0b.py` (R13; tangkapan ke `temporary_files/e2e_plugin_fase1_1c0b/`; `TZ=Asia/Jakarta`; konteks `service_workers="block"`; tidak di CI). Seed seperti 1c-0 (`seed_all`): U1 "sx1" (perangkat A, pemilik W "Ruang Rilis"), U2 "sx2" (perangkat B, anggota), Timeline ON keduanya, T1–T4 di project "Rilis" dengan `timeline.start`/`duration`. Semua PUT/DELETE task dicatat per perangkat (`page.on("request")`).

**Skenario:**
1. **R2 inti (wajib):** A sinkron lalu `go_offline`; A ubah judul T1 → "Judul offline A" lewat UI detail (`ui_set_title`); B (online) `open_timeline` + `drag_bar(T1, +2)` → tepat satu PUT B `{ext_patch}`; server: judul lama, `updated_at` naik, `core_updated_at` **tetap** (= nilai sebelum seret); A `go_online` + `sync_now` → server `title == "Judul offline A"`, `timeline.start` = hasil seret B (tidak kembali); PUT A ke T1 penuh (`FULL_KEYS`) tanpa `ext_patch`; IndexedDB A: judul A, `ext["timeline.start"]` = nilai B, `dirty 0`; daftar A menampilkan "Judul offline A".
2. **Kontrol kode lama:** perangkat A' (U1) dengan `serve_old(ctx, "static/offline/syncpull.js")` (origin/main) → ulangi 1 pada T2 → judul **tertimpa** (server judul lama, IndexedDB A' judul lama, tidak ada PUT judul) — "bug lama terreproduksi"; kembalikan judul lewat API sesudahnya.
3. **Kontrol server tanpa field (jendela deploy):** perangkat A'' kode PR, `ctx.route(PULL_RE)` → `route.fetch()`, buang `core_updated_at` dari setiap item, `fulfill` → ulangi 1 pada T3 → judul tertimpa (aturan lama; tanpa error konsol).
4. **Status + progress:** A offline centang selesai T3 dan ubah progress T4 → 60; B seret T3 dan T4 → A online → server: T3 selesai, T4 progress 60, jadwal B utuh.
5. **Hapus (Q1):** A offline hapus T4; B seret T4 → A online → (a) `GET /api/tasks/<T4>` 404 dan tidak ada di daftar B setelah sinkron; (b) task kembali di A.
6. **Dua kali seret:** B seret T1 dua kali → `core_updated_at` tetap di kedua respons; A ubah judul online → `core_updated_at == updated_at`.
7. **Konflik inti sungguhan (info + cek):** A offline ubah judul T2; B ubah judul T2 online (lebih baru) → A online → server judul B (LWW tidak berubah). Catat (info, bukan cek) varian "B ubah judul **sebelum** edit offline A, lalu seret": dengan `TZ=Asia/Jakarta` server tetap menang karena S9 (dicakup tes Node aturan (2)).
8. **Bot/penulis lain (API):** setelah seret B, `POST /api/tasks/<T1>/done` lewat API U1 → `core_updated_at == updated_at`.
9. **Konsol:** tanpa error selain yang disengaja (abort skenario 3 tidak ada; route fulfill).

- [ ] **Step 1:** tulis skrip; **Step 2:** `TZ=Asia/Jakarta python3 temporary_files/e2e_plugin_fase1_1c0b.py` → semua cek lolos (catat N/N); regresi `e2e_plugin_fase1_1c0.py` (skenario 1–7, 10) dan `e2e_plugin_fase1_1b.py` lulus.
- [ ] **Step 3: Commit** `test(sync): E2E PR 1c-0b (edit inti offline vs seret Timeline, kontrol kode lama dan server tanpa field)`

### Task 5: Verifikasi akhir, dokumen, handover, review, PR draft

**Files:** `docs/superpowers/specs/2026-11-01-plugin-fase1-1c-otomatis-design.md` ("### Catatan implementasi PR 1c-0b (<tanggal>)" setelah catatan 1c-0; baris §11 R2 → "Diselesaikan di 1c-0b (ADR-044): …"; kalimat "Risiko residual: **R2** …" di catatan 1c-0 diberi rujukan ke 1c-0b), `docs/superpowers/plans/2026-11-01-plugin-fase1-pr-1c-0b.md` (salinan rencana ini), `.agents/CURRENT_STATE.md` (entri teratas), `.agents/SESSION_LOG.md` (format PROTOCOL §3.2)

- [ ] **Step 1: Verifikasi** dan catat angka: `python3 -m pytest tests/ -q` (1435 lama + baru, 1 skip; Python 3.12 bila tersedia); `npm test` (hanya `draw_local_reactive`); `node --test tests/build-plugins.test.js` (26/26); PROTOCOL §4 butir 5; `check_inline_scripts`; `node compile.js` dua kali tanpa diff; `git diff --stat origin/main -- repository.py bot.py static/app.css static/plugins static/offline/db.js static/offline/syncpush.js static/offline/taskrepo.js static/offline/taskext.js static/offline/hydrate.js` **kosong**; `git diff origin/main -- static/index.html` hanya dua baris versi; `ls static/offline/*.js | wc -l` = 84; `git diff origin/main -- 'tests/*.py' 'tests/offline/*.js'` hanya berkas baru + `test_plugins_node.py` + string versi (R12); asap `python3 -c "import webapp, bot"`; migrasi atas salinan DB produksi-semu (`migrate_db` dua kali, `PRAGMA table_info(tasks)` memuat dua kolom, tanpa `UPDATE` massal).
- [ ] **Step 2: Dokumen** — catatan implementasi 1c-0b (K45–K50, jawaban Q1, penyimpangan saat implementasi); perbarui salinan Project `claude/spec-plugin-fase1-1c-otomatis-2026-11-01.md` lewat `project_write` (isi sama); salin rencana ke `docs/superpowers/plans/`.
- [ ] **Step 3: Handover** `CURRENT_STATE.md`: `## 🟡 Plugin Fase 1 — PR 1c-0b: waktu inti task (menutup R2) — claude/task-core-time — <tanggal> (Claude) — PR DRAFT, menunggu "merge dan deploy"`: rencana/ADR-044; isi (K45–K50); skema (dua kolom nullable, tanpa backfill, `migrate_db`); rilis SW v497 `silent`; **deploy: workflow TIDAK me-restart → Bapak wajib `sudo systemctl restart taskflow-web` (bot/`taskflow` tidak perlu)**; jendela deploy aman (R9); verifikasi pasca-deploy R11 (a) ActiveEnterTimestamp, (b) `core_updated_at` ada di respons daftar task, (c) seret bar → `core_updated_at` tetap; **1c-1 baru boleh di-merge setelah verifikasi**; rollback R10; risiko terbuka (S9, R7 sisi lokal, R8 tag 1c-0). `SESSION_LOG.md` entri baru.
- [ ] **Step 4: Commit** `docs(sync): handover PR 1c-0b, catatan implementasi spec 1c`
- [ ] **Step 5: Review akhir oleh subagen reviewer terpisah** (Review Focus 1–6 + R1–R14; khusus: jalankan pemindai `UPDATE tasks` sendiri dan cocokkan dengan tabel R1; pembekuan hanya di `update_task` dan hanya `pure_ext`; `CASE` membaca baris terkini; nama kolom mentah tidak bocor ke respons kode baru; aturan (1) tidak pernah benar dengan cap waktu tak terbaca; invarian `base_rev` (Review Focus 3) diperiksa terhadap setiap jalur yang menulis `base_rev` di `syncpull.js`/`syncpush.js`/`hydrate.js`; `syncpush.js` tidak berubah). Perbaiki temuan wajib, ulangi Step 1.
- [ ] **Step 6: Push + PR draft** judul `Plugin Fase 1 — PR 1c-0b: waktu inti task terpisah dari edit ext (edit offline tidak kalah oleh seret Timeline)`; body: masalah (contoh "A offline ganti judul, B geser bar, judul A hilang"), tabel file, keputusan penting (K45 ikatan, K46 SQL atomik, K48 aturan (1) kebal S9, K49 klien satu fungsi), skema, angka tes, hasil E2E (kontrol ganda), jawaban Q1, **catatan deploy: migrasi otomatis di workflow; restart manual `sudo systemctl restart taskflow-web`** (bot tidak), verifikasi pasca-deploy (Step 3), urutan sebelum 1c-1, rollback; akhiri dengan atribusi sesi. Merge hanya setelah Bapak bilang "merge dan deploy"; setelah deploy sukses ingatkan restart `taskflow-web`.
