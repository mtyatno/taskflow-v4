# Spec: Sistem Plugin Alurik — Fase 0b (server: `get_conn`, loader plugin, status per pengguna, `TF.api.fetch`)

- **Tanggal:** 2026-10-31
- **Basis kode:** `main` @ `105a72b` (SW `taskflow-v489-heatmap-rapi`, `app.css?v=382`, IndexedDB `taskflow-offline` v6, 80 modul `static/offline/`, `index.html` 46.092 baris; `webapp.py` 10.838 baris / 213 endpoint — **semuanya `async def`** — / 0 `APIRouter` / 211 pemanggilan `get_db()`; `repository.py` 91 pemanggilan `self._connect()`; Python 3.12 (CI `test.yml:16`, venv 3.12.3), SQLite 3.45.1; baseline tes: pytest 1250 lulus / 1 skip, `npm test` 3592/3593 (pra-ada `draw_local_reactive`)).
- **Status:** disetujui pemilik 2026-10-31 (Q1 = a, Q2 = per perangkat, Q3 = setuju, Q4 = dua PR; lihat §13). Kelanjutan spec Fase 0a (`docs/superpowers/specs/2026-10-29-plugin-fase0a-design.md`, ADR-037), terutama §3 (tabel fase), Lampiran A (guard rail 1, 6, 7, 9, 11) dan Lampiran B (B10, B11; B12/B13 tetap ditunda).
- **Salinan:** Project claude.ai "alurik" `claude/spec-plugin-fase0b-2026-10-31.md`; saat implementasi dimulai, di-commit ke `docs/superpowers/specs/2026-10-31-plugin-fase0b-design.md`. Isi keduanya harus sama.
- **Istilah** (tambahan atas istilah Fase 0a):
  - *`dbconn`* = modul server baru, satu-satunya tempat `sqlite3.connect`;
  - *`write_tx`* = blok transaksi tulis yang dibuka dengan `BEGIN IMMEDIATE` **sebelum** membaca;
  - *loader server* = `plugin_loader.py`, pemindai `plugins/<id>.py`, dipakai `webapp.py` dan `bot.py`;
  - *`plugin_host`* = fasad server untuk modul plugin (padanan `TF.api` di klien);
  - *status akun* = ON/OFF plugin per pengguna di tabel `plugin_states` (sumber kebenaran mulai 0b);
  - *cache status* = `_meta plugins:state:v1` di IndexedDB, salinan status akun + perubahan yang belum terkirim;
  - *peredaman lokal* = plugin dimatikan **hanya di perangkat ini** karena error (bukan perubahan status akun);
  - *jendela deploy* = jeda antara workflow deploy (file baru di disk + `migrate_db`) dan restart manual layanan.

---

## 1. Tujuan

Fase 0a membuat ON/OFF plugin bekerja di satu perangkat tanpa server. Fase 0b memindahkan status itu ke akun (tetap bisa diubah offline), menyiapkan jalur server untuk plugin (Timeline di Fase 1 butuh tabel dan endpoint), dan lebih dulu merapikan koneksi SQLite yang akan dipakai bersama host dan plugin. Yang terlihat pengguna hanya: plugin yang dinyalakan ikut ke perangkat lain.

**Kriteria berhasil**

1. **Satu pintu koneksi.** Semua `sqlite3.connect` produksi (31 titik: `webapp.py` 29, `repository.py` 1, `bot.py` 1) lewat `dbconn`; `busy_timeout` 5000 ms tertulis eksplisit, `isolation_level="IMMEDIATE"`, WAL; `foreign_keys` sama seperti sekarang di tiap jalur. Seluruh pytest lama lulus **tanpa mengubah asersi**.
2. **Transaksi tulis aman.** `dbconn.write_tx(conn)` tersedia dan dipakai semua kode baru yang membaca-lalu-menulis; tes konkurensi dua thread tidak menghasilkan `SQLITE_BUSY_SNAPSHOT` maupun update hilang.
3. **Loader server** dipakai `webapp.py` dan `bot.py`; mendukung `ensure_schema` dan `router`; simbol B11 lain ditolak dengan pesan yang menyebut fasenya; satu plugin rusak tidak menjatuhkan web maupun bot.
4. **Router plugin** terpasang di `/api/plugins/<id>/…` dengan otorisasi deklaratif: tanpa token 401, plugin OFF 403 `PLUGIN_DISABLED`, skema plugin gagal 503 `PLUGIN_UNAVAILABLE`.
5. **`plugin_states`** + `GET /api/plugins/state` + `PUT /api/plugins/state/{plugin_id}`; migrasi idempoten di `migrate_db()`; last-write-wins berdasar `updated_at`.
6. **Status per pengguna di klien.** Toggle bekerja offline, menjadi satu op outbox per plugin (coalescing), tersinkron saat online; perangkat lain melihatnya pada sinkron berikutnya; sinkron pertama melebur status perangkat Fase 0a (OR).
7. **Error tetap lokal.** Plugin yang dimatikan otomatis karena error hanya padam di perangkat itu; status akun tidak berubah; tidak ada siklus ON/OFF antara pull dan error.
8. **`TF.api.fetch`** untuk plugin berizin `network` (`apiVersion` tetap 1), hanya ke `/api/plugins/<id>/…` miliknya, jalan di web dan Tauri; offline → error terstruktur yang ditampilkan "Butuh koneksi internet".
9. **Tanpa plugin baru untuk pengguna.** Pola server dibuktikan plugin contoh khusus tes.
10. **Batas ukuran 0a tetap:** `index.html` bertambah ≤ 60 baris, IndexedDB tetap v6, `app.css` tidak berubah; SW bump + entri `whatsnew.json`.
11. **Deploy dan rollback** tanpa migrasi data manual; restart `taskflow-web` **dan** `taskflow`.

## 2. Keputusan

| # | Keputusan | Alasan (kode nyata) |
|---|---|---|
| K1 | Modul baru `dbconn.py`: `connect(path, *, foreign_keys=True)`, `get_conn(path)` (context manager: commit bila sukses, rollback bila exception, selalu close) dan `write_tx(conn)`. `webapp.get_db()` tetap ada sebagai pembungkus satu baris yang meneruskan `DB_PATH` global **saat dipanggil**; `TaskRepository._connect` → `dbconn.get_conn(self.db_path)`. | `get_db` (`webapp.py:295–308`) dan `TaskRepository._connect` (`repository.py:623–636`) identik; `_media_db_connect` (`webapp.py:183–188`) mengulang pragma yang sama untuk dua worker. Path eksplisit wajib: `tests/test_sync_audit_server.py:128` me-monkeypatch `webapp.DB_PATH`. 211 pemanggil `get_db()` tidak disentuh. |
| K2 | Pragma standar: `sqlite3.connect(path, timeout=5.0, isolation_level="IMMEDIATE")`, lalu `PRAGMA busy_timeout=5000`, `PRAGMA journal_mode=WAL`, `PRAGMA foreign_keys=ON` (kecuali K4). Mode transaksi **legacy** Python dipertahankan; atribut `autocommit` (Python 3.12) tidak pernah di-set. | Diverifikasi (venv 3.12.3): koneksi baru sudah `busy_timeout = 5000` (bawaan `timeout=5.0`) — pragma hanya membuatnya eksplisit. Jejak `set_trace_callback`: dengan `"IMMEDIATE"` Python tetap mengirim `BEGIN` tepat sebelum DML pertama; SELECT/DDL sebelumnya tetap di luar transaksi. Hanya jenis BEGIN yang berubah → netral. `autocommit=False` justru menahan transaksi baca terbuka (snapshot basi, checkpoint WAL tertahan). |
| K3 | Kode **baru** yang membaca lalu menulis wajib `with dbconn.write_tx(conn):` (`BEGIN IMMEDIATE` sebelum SELECT pertama; `RuntimeError` bila `conn.in_transaction`). Kode lama tidak di-refactor. | Diverifikasi: transaksi deferred yang membaca lalu menulis setelah penulis lain commit gagal **seketika** `SQLITE_BUSY_SNAPSHOT` (`busy_timeout` tak membantu); `BEGIN IMMEDIATE` menunggu lalu sukses. Preseden: `repository.py:1833`, `:1859`, `:1876`. |
| K4 | `migrate_db()` memakai `dbconn.connect(DB_PATH, foreign_keys=False)` untuk 27 koneksinya (`webapp.py:361–1004`), kecuali blok `:978–1001` yang tetap menyalakan FK eksplisit (`:981`). | 26 dari 27 koneksi migrasi kini tanpa FK. Rebuild tabel (`habit_templates` `:397–413`, `drawings` `:535–567`, `entity_tags` `:738–751`) dengan FK ON — diverifikasi: `DROP TABLE x_old` menghapus baris tabel anak (CASCADE) dan meninggalkan `REFERENCES "x_old"`. Belum ada FK ke tiga tabel itu, tapi FK ON di sini jebakan data. |
| K5 | `bot.py:313` → `dbconn.get_conn(repo.db_path)`; worker media/email memakai `lambda: dbconn.connect(DB_PATH)`. | **Bug pra-ada:** `bot.py:312` membaca `repo._db_path`, padahal `TaskRepository` hanya punya `db_path` (`repository.py:620`) → `/link <KODE>` dari Pengaturan melempar `AttributeError` (tanpa tes). Ikut diperbaiki + tes regresi. |
| K6 | `plugins/<id>.py` dimuat `plugin_loader.py` lewat `importlib.util.spec_from_file_location`; `plugins/_*.py` dilewati; `<id>` wajib ada di `static/plugins/index.json`; id `state` dicadangkan (`compile.js` + loader menolak). Import tanpa efek samping. | B11. Id bertanda hubung (`habit-heatmap`) bukan identifier Python. `index.json` (ditulis `compile.js`, di-commit, dibangun ulang saat deploy) sudah memuat `id` + `defaultEnabled` → satu daftar plugin untuk server dan klien. `state` bentrok dengan `/api/plugins/state`. |
| K7 | Diimplementasikan di 0b: `ensure_schema(conn)` dan `router: APIRouter`. Simbol B11 lain (`on_task_written`, `jobs`, `register_bot`, `intake`) dikenali, tetapi plugin yang memilikinya **ditolak utuh** dengan pesan, mis. `"on_task_written belum didukung (Fase 1)"`. | Hook yang diabaikan diam-diam membuat penulis plugin mengira proyeksinya diperbarui. Menolak utuh = gagal jelas (guard rail 11); pemakai pertama tiap hook menambah dukungannya di spec fasenya. |
| K8 | Fasad server `plugin_host.py` (`HOST_API = 1`): `current_user` (dependency), `get_conn()`, `write_tx`, `now_utc()`, `allow_async` (dekorator, lihat K9). Diisi `webapp.py`/`bot.py` lewat `plugin_host.bind(...)` saat start. Plugin dilarang meng-import `webapp`, `repository`, atau memanggil `sqlite3.connect`. | Padanan K7 Fase 0a; mencegah import melingkar `webapp` ↔ plugin; `current_user` = fungsi tingkat-modul yang stabil sehingga cache dependency FastAPI bekerja (sekali per request walau dipakai router + endpoint). |
| K9 | Pemasangan: `app.include_router(mod.router, prefix=f"/api/plugins/{id}", tags=[f"plugin:{id}"], dependencies=[Depends(plugin_host.current_user), Depends(require_plugin_enabled(id))])`. Router plugin wajib tanpa `prefix` sendiri; setiap endpoint wajib `def` — loader menolak endpoint coroutine kecuali ditandai `@plugin_host.allow_async` (pengecualian "uji koneksi" Lampiran A #1). `require_plugin_enabled` = dependency `def`. | Lampiran A #1, #7. Host memanggil `sqlite3` sinkron di 213 endpoint `async def` dan di `get_current_user` (`webapp.py:1191` → `:1113`): menunggu kunci memblokir event loop. Kode baru tidak menambah pola itu. |
| K10 | `ensure_schema` hanya dijalankan `migrate_db()` milik web (setelah `email_outbox.ensure_schema`, `webapp.py:998`), satu `write_tx` per plugin pada koneksi FK OFF (alasan K4; rebuild tabel plugin aman), diakhiri `PRAGMA foreign_key_check`. Objek yang dibuat wajib bernama `plg_<id_>_…` (diperiksa lewat selisih `sqlite_master`; pelanggaran → rollback). Gagal → plugin ditandai tidak sehat, dicatat, **`migrate_db` tidak melempar**. Bot tidak menjalankan DDL. | `deploy.yml` sudah menjalankan `migrate_db()` setelah `git reset`; dua proses menjalankan DDL bersamaan saat restart hanya menambah perebutan kunci. Satu plugin tidak boleh menggagalkan deploy host (guard rail 11); router tetap terpasang tetapi menjawab 503 (K9). |
| K11 | Tabel `plugin_states(user_id, plugin_id, scope, enabled, settings, updated_at)`, PK `(user_id, plugin_id, scope)`, `scope` bawaan `'user'`, `enabled` boleh NULL (= ikut `defaultEnabled`). Didefinisikan di modul `plugin_states.py` (`ensure_schema` + query + router host), dipanggil di `migrate_db`. | B10 menyebut `scope` untuk workspace; sekarang gratis, nanti = rebuild PK. NULL mencegah baris "hanya settings" membekukan default lama. Modul terpisah meniru `email_outbox.ensure_schema` (`email_outbox.py:45`) dan menahan `webapp.py` tumbuh. |
| K12 | Last-write-wins di **server** berdasarkan `updated_at` kiriman klien (waktu toggle), dipotong ke `min(klien, waktu server)`, dibandingkan sebagai `datetime` (bukan string). Respons selalu `{applied, state}`. Endpoint `def` + `write_tx`. | Toggle offline 10.00 di HP yang baru terkirim 11.00 tidak boleh menimpa toggle 10.05 di laptop. Pemotongan mencegah jam perangkat yang maju selalu menang. |
| K13 | Klien: modul baru `static/offline/pluginstate.js` (`TF.pluginstate`) menjadi **satu-satunya penulis** `_meta plugins:state:v1`; setiap toggle = satu transaksi IndexedDB atas `_meta` + `_outbox` yang memperbarui entri dan mengganti op lama plugin yang sama (coalescing). Op: `{entity_type: "plugin_state", op: "set", cid: "<plugin_id>", payload}`. | Pola payload-only `pomolog.js`, tetapi atomik: dedupe `pomolog.enqueue` baca-lalu-tulis (diakui di `pomolog.js:25`); `pomolog.ackPushed` (`:69–86`) membuktikan transaksi `_outbox` + store lain. Runtime 0a menulis seluruh snapshot (`plugin-runtime.js:254–257`) → bertabrakan dengan tulisan pull. |
| K14 | Pull status = langkah baru di `sync()` sebelum `pushOutbox` (`index.html:1312–1360`); entri dengan op tertunda menang atas server. 404 bertubuh `PLUGIN_UNKNOWN` → op dibuang; 404 lain (rute belum ada di jendela deploy) → op **tetap** antre. | `classify` menganggap semua 404 "gone" (`syncpush.js:254–263`); tanpa pembeda, toggle selama jendela deploy hilang. Urutan pull→push sama dengan entitas lain. |
| K15 | Sinkron pertama per pengguna per perangkat (penanda `_meta plugins:state:owner:v1`): status = OR(perangkat, server). Plugin yang ON di perangkat tetapi tidak ON di server diantrekan sebagai op dengan **`updatedAt` asli dari 0a**, sehingga keputusan eksplisit yang lebih baru di server tetap menang (K12). | Memenuhi keputusan A1/A3 (OR) tanpa menghidupkan lagi plugin yang sengaja dimatikan pengguna di perangkat lain setelah 0b berjalan. Konfirmasi: §13 Q1. |
| K16 | Mati otomatis karena error (`markFailed`: manifest, factory, 2 error render/pendengar) menjadi **peredaman lokal** di `_meta plugins:suppressed:v1 {[id]: {reason, hash, at}}`, bukan perubahan status akun. Dihapus oleh "Aktifkan lagi" atau bila `hash` plugin berubah. Status efektif = status akun ∧ ¬diredam. | Auto-OFF sekarang memanggil `setEnabled(id, false)` (`plugin-runtime.js:455`, `:464`, `:475`, `:482–484`). Ikut sinkron → error di satu HP lama mematikan plugin di semua perangkat; tidak ikut → pull berikutnya menyalakannya lagi (siklus). |
| K17 | `TF.api.fetch(path, opts)` ditambahkan ke `TF.api` v1 (`apiVersion` tetap 1). Izin `network` pindah dari dicadangkan ke dikenal. Runtime tidak memakai `fetch` sendiri: host menyuntik `bindHost({fetch, isOfflineErr, pushNow})`, dengan `fetch = (p, o) => api.fetch(p, {...o, network: true})`. Lint `compile.js` diubah: `fetch(` polos tetap dilarang; `.fetch(` hanya boleh bila manifest berizin `network`. | `api.fetch` host (`index.html:809–918`) sudah menangani `API_BASE` (Tauri), token, `X-TF-Sync` (SW network-only → 503 `OFFLINE`, `sw.js:425–435`), 401 → `handleAuthExpired`, dan `body` error. Lint `fetch\(` (`compile.js:80`) kini menolak `api.fetch(`. Izin `network` juga pagar kapabilitas: runtime lama menolaknya sebagai "dicadangkan". |
| K18 | Tidak ada plugin baru bagi pengguna. Pola server dibuktikan plugin contoh `tests/fixtures/plugins/demo-server.py` + indeks tes; pilihan metrik Heatmap tetap di `api.storage` perangkat. Kolom `settings` disimpan dan disinkron oleh API, tetapi belum diekspos ke plugin (`api.settings` menyusul bersama `settings.project` di Fase 1). | Heatmap tanpa modul server: memindahkan metriknya ke `settings` tidak membuktikan loader/router/`ensure_schema`, dan mengunci kontrak `api.settings` (B2) sebelum kebutuhan Timeline jelas. Konfirmasi: §13 Q2. |

**Keputusan pemilik yang dibawa dari Fase 0a:** A1 (0a per perangkat, 0b per pengguna), A2 (plugin dalam workspace ditunda ke Fase 1), A3 (toggle tetap bisa offline; tidak ada "Butuh koneksi internet" untuk toggle), istilah UI "Plugin".

### Catatan implementasi PR A (2026-10-31)

Deviasi dari teks K1–K5 dan §4.2 yang diputuskan saat rencana/implementasi PR A (`docs/superpowers/plans/2026-10-31-plugin-fase0b-pr-a-dbconn.md`, branch `claude/dbconn`, ADR-038):

- **R1 — tanda tangan `connect`:** `connect(path=None, *, foreign_keys=True, row_factory=sqlite3.Row)` dan `get_conn(path=None, *, foreign_keys=True)`; `None` → `dbconn.default_path()` = `config.DB_PATH` yang di-import **di dalam fungsi** (dibaca saat dipanggil). Di PR A semua pemanggil produksi mengirim path eksplisit (`webapp` → global `DB_PATH` modul di badan fungsi, `repository` → `self.db_path`, `bot` → `repo.db_path`); pagar AST menolak `dbconn.connect(`/`dbconn.get_conn(` tanpa argumen posisi di tiga file itu. Default `None` disediakan untuk `plugin_host` (PR B) dan skrip. Bila pengaturan pragma gagal, `connect` menutup koneksi lalu meneruskan exception; `foreign_keys=False` menulis `PRAGMA foreign_keys=OFF` eksplisit.
- **R4 — `_media_db_connect` tetap fungsi bernama** (`return dbconn.connect(DB_PATH)`), bukan `lambda` seperti teks K5: `DB_PATH` tetap *late-bound* dan `webapp.media_worker._connect`/`webapp.email_worker._connect` bisa diuji.
- **R5 — `/link <KODE>` punya tiga bug pra-ada**, semuanya diperbaiki dengan satu tes regresi (`tests/test_bot_link_token.py`, token dari endpoint asli): (0) guard `if len(context.args) < 2:` di awal `cmd_link` menelan kasus satu argumen sehingga cabang token tidak pernah tercapai — kini `if not context.args:`; (1) `repo._db_path` → `AttributeError` (teks K5); (2) `datetime.fromisoformat(expires_at) < datetime.now()` → `TypeError` karena `webapp.py` menulis `expires_at` ber-zona Asia/Jakarta — kini `exp < datetime.now(exp.tzinfo)`. Balasan sukses dikirim setelah blok `get_conn` (commit dulu, seperti semula) agar kunci tulis tidak dipegang selama I/O Telegram; teks balasan tidak berubah. Di luar cakupan: jalur token tidak memindahkan task dari pengguna otomatis `tg_<id>` seperti jalur username.
- **R7 — nomor ADR:** ADR-038 = dbconn (PR A); PR B memakai **ADR-039** (§10 diperbarui).
- **Satu tes lama disesuaikan** (`tests/test_petakan.py::test_empty_trash_deletes_map_of_note_trashed_between_statements`): tes menyisipkan baris lewat koneksi lain *secara sinkron di dalam trace callback* tepat saat DELETE mulai; dengan `BEGIN IMMEDIATE` kunci tulis sudah dipegang di titik itu sehingga sisipan menunggu `busy_timeout` lalu gagal diam-diam. Titik sisip dipindah ke SELECT `_purge_trashed_media` (tetap sesudah daftar `mine` dibaca dan sebelum DELETE, di luar transaksi); asersi dan properti yang diuji (RETURNING menutup celah SELECT→DELETE) tidak berubah. Ini satu-satunya perbedaan perilaku yang terdeteksi 1250 tes lama; selebihnya lulus tanpa perubahan.
- **Lingkungan:** diimplementasikan dan diverifikasi di Python 3.13.18 / SQLite 3.53.1; semua klaim K2–K4 (jejak `BEGIN IMMEDIATE` hanya sebelum DML pertama, `SAVEPOINT` tanpa BEGIN, pembaruan hilang tanpa `write_tx`, BUSY_SNAPSHOT seketika pada transaksi deferred, 2 thread × 50 increment = 100 dengan `write_tx`) identik dengan venv produksi 3.12.3 / 3.45.1.
- **Pagar AST** memindai akar repo **dan `plugins/*.py`** (folder boleh belum ada) sehingga modul server plugin PR B langsung terjaga.

### Catatan implementasi PR B (2026-10-31)

Deviasi dari teks K6–K18 dan §4.4–§6 yang diputuskan saat rencana/implementasi PR B (`docs/superpowers/plans/2026-10-31-plugin-fase0b-pr-b.md` R1–R19, branch `claude/plugin-fase0b`, ADR-039):

**Server**

- **R1 — `migrate_db` tidak menambah `dbconn.connect`.** `email_outbox.ensure_schema` ternyata berada di blok project yang FK ON (pengecualian K4) dan pagar PR A mengunci 27 `dbconn.connect` di `migrate_db`. Maka `migrate_db` mendapat satu baris `plugin_loader.migrate(DB_PATH)` setelah blok project; loader membuka koneksinya sendiri `dbconn.connect(db_path, foreign_keys=False)`, menjalankan `plugin_states.ensure_schema` lalu `ensure_schema` tiap plugin masing-masing dalam `write_tx`, dan tidak pernah melempar.
- **R2 — `plugin_host.current_user` = `async def`** yang meneruskan ke `webapp.get_current_user` (async); fungsi tingkat-modul stabil sehingga cache dependency bekerja. Yang wajib `def`: `require_plugin_enabled`, endpoint host, dan endpoint plugin. Di bot `current_user` tidak di-bind → `RuntimeError`.
- **R3 — pagar `ensure_schema` per objek dan lebih ketat dari K10.** Bukan `PRAGMA foreign_key_check` seluruh DB (satu pelanggaran FK pra-ada akan menggagalkan setiap plugin), melainkan selisih `sqlite_master` sebelum/sesudah (lewati `sqlite_%`, membandingkan `tbl_name` dan `sql`): setiap objek baru/berubah/hilang wajib **bernama** `plg_<id_>_` **dan** tabel induknya (`tbl_name`) juga `plg_<id_>_` (indeks/trigger ber-prefix pada tabel host ditolak; `ALTER`/`DROP` tabel host tertangkap); lalu `PRAGMA foreign_key_check("<tabel>")` hanya untuk tabel plugin yang tersentuh. `ensure_schema` menerima **koneksi pembungkus** yang menolak `commit`/`rollback`/`close`/`executescript` (executescript meng-COMMIT transaksi terbuka) dan pengubahan atribut; transaksi yang berakhir di dalam `ensure_schema` juga pelanggaran. Pelanggaran/exception → rollback, health `schema_failed`, log ERROR satu baris.
- **R5 — modul plugin didaftarkan di `sys.modules["alurik_plugins.<id_>"]`** sebelum `exec_module` dan dihapus bila gagal; import dibungkus `except BaseException` kecuali `KeyboardInterrupt` (`SystemExit` dari plugin = penolakan).
- **R6 — pesan simbol tertunda:** `on_task_written` → "belum didukung (Fase 1)"; `jobs`, `register_bot`, `intake` → "belum didukung (ditunda, Lampiran B)".
- **R7 — token clipper ditolak juga di `GET/PUT /api/plugins/state`** (403 `PLUGIN_FORBIDDEN_TOKEN`), bukan hanya di rute plugin.
- **R8 — validasi PUT dan urutan error (diubah dari teks §5).** `enabled` memakai `StrictBool` (`"ya"` → 422); `enabled: null` sah (kembali ke default); `settings: null` → 422 (harus objek); field yang dikirim dibedakan lewat `model_fields_set`. Urutan: 401 → 403 clipper → 404 `PLUGIN_UNKNOWN` bila id tidak cocok pola atau `state` → **503 `PLUGIN_UNAVAILABLE` bila indeks tidak sehat** → 404 `PLUGIN_UNKNOWN` bila id tidak di indeks → 422. Alasannya: indeks yang tidak terbaca = daftar kosong; bila keanggotaan dicek lebih dulu, setiap toggle menjawab `PLUGIN_UNKNOWN` dan klien membuang op-nya — dengan urutan ini op tetap antre sampai server pulih. (FastAPI memvalidasi body sebelum badan fungsi, jadi id asing dengan body rusak menjawab 422 — diterima.) Waktu disimpan UTC `isoformat(timespec="milliseconds")` ber-offset `+00:00`; nilai `updated_at` rusak di DB ditimpa kiriman sah.
- **Logger** loader/migrasi = `logging.getLogger("alurik.plugins")` (`plugin server: N dimuat, M ditolak`, penolakan WARNING, kegagalan skema ERROR).
- **R18 — error handler bot** `on_error` tingkat-modul: `telegram.error.NetworkError` (termasuk `TimedOut`, juga error polling `getUpdates`) → satu baris WARNING tanpa traceback; selain itu ERROR + traceback.

**Klien**

- **R9 — kegagalan permanen PUT memakai `dropOp`, bukan `failPermanent`** (yang meninggalkan `dirty: true` selamanya): 2xx → `ackPushed`; 404 `PLUGIN_UNKNOWN` → `dropOp` (tidak dihitung gagal); 404 lain → op tetap; 400/403/409/422/4xx lain → `dropOp` + gagal; 401/429/5xx/jaringan → perilaku `send`. "Menunggu sinkron" = ada op untuk plugin itu (bukan `dirty`).
- **R10 — lebur pertama hanya untuk cache tanpa pemilik.** `owner` tidak ada (cache 0a) → lebur OR + Q1a; `owner` ada tetapi berbeda (mis. `clearAll` gagal saat ganti akun) → cache dan op `plugin_state` lama dibuang, server diadopsi persis; `owner === userId` → aturan normal. `updatedAt` 0a tak terbaca → `1970-01-01T00:00:00.000Z`.
- **R11 — payload op hanya field yang diubah** (`{plugin_id, enabled?, settings?, updated_at}`; 0b tidak pernah mengirim `settings`); coalescing menggabungkan payload op lama ke op baru (qid baru).
- **R12 — notifikasi** `TF.pluginstate.subscribe(fn) → off` (dipakai runtime) dan `window` event `tf:plugin-state`; tab lain di browser yang sama baru melihat perubahan setelah sinkron/reload (tidak diselesaikan di 0b).
- **R13 — runtime menyimpan salinan sinkron** `{state, pending, suppressed}` dari `TF.pluginstate.snapshot()`; `setEnabled` optimistis lalu `setLocal`. **Runtime menahan `reloadState` selama tulisan lokal berjalan** (penghitung tulisan lokal; notifikasi store yang datang di tengahnya ditunda dan dijalankan sekali setelah tulisan terakhir selesai) agar snapshot lama tidak membalik toggle optimistis. Fallback bila `TF.pluginstate` tidak ada: perilaku 0a.
- **`list()`** tetap berbentuk 0a untuk plugin biasa; kunci 0b hanya ditambahkan bila relevan: `pending: true` bila ada op, dan `suppressed` (alasan) + `accountEnabled` bila diredam.
- **R14 — "Aktifkan lagi" = `setEnabled(id, true)`** (selalu `unsuppress`, reset hitungan error, tulis `setLocal`).
- **`api.fetch` selalu ada di `api`** (bukan hanya untuk plugin berizin `network`); tanpa izin → `PluginPermissionError` saat dipanggil. Asersi lama `tests/offline/plugin_api.test.js:37` (daftar kunci `api`) disesuaikan: `typeof a.fetch === "function"`.
- **Hook tes runtime:** `_setPluginStateModule(m)` (ganti modul `TF.pluginstate`) dan `_setPushWaitMs(ms)` (batas tunggu `pushNow`, bawaan 5000 ms).
- **R15 — lint `compile.js`:** `fetch(` polos dan `window|self|globalThis.fetch` selalu ditolak; `.fetch(` hanya dengan izin `network`; id tidak cocok pola atau `state` → build gagal. Batas yang diketahui: lint berbasis teks (mis. `globalThis["fetch"]`).
- **R16 — anggaran `index.html`:** baseline tes dinaikkan ke 46.092 baris (`main` sebelum 0b), batas +60 tetap.
- **R17 — tes lama yang asersinya berubah karena spec:** contoh izin dicadangkan `"network"` → `"records"`, `KNOWN_PERMISSIONS = ["storage", "network"]`, auto-OFF diperiksa sebagai peredaman lokal, subjudul kartu Pengaturan, baseline `index.html`, dan `plugin_api.test.js:37`. Tes Python lama tidak disentuh.
- **Review akhir:** `api.fetch` menolak karakter kontrol (`[\u0000-\u001F\u007F]`) dan mewajibkan `new URL(path, …).pathname` sama dengan path asli dan tetap di bawah `/api/plugins/<id>`; `PUT` membaca ulang `index.json` sekali (`plugin_loader.refresh_known`, gagal = daftar lama) sebelum 404 `PLUGIN_UNKNOWN`; runtime mengabaikan cache ber-`owner` ≠ `userId` ter-bind sampai pull menulis owner yang benar. Batas diketahui (lint teks bisa diakali, `ensure_schema` hanya menangkap DDL tak sengaja — bukan sandbox) dicatat di README §8 dan ADR-039.
- **Rilis:** SW `taskflow-v490-plugin-akun`, entri whatsnew "Plugin ikut akunmu"; `tests/test_plugins_node.py` mencakup `pluginstate*.test.js` dan `syncpush_pluginstate.test.js`.

## 3. Ruang lingkup

| Bagian | Isi 0b | Tidak di 0b |
|---|---|---|
| SQLite | `dbconn.py`, 31 titik koneksi, `write_tx` | endpoint lama ke `write_tx` atau `def` |
| Loader | `plugin_loader.py` (web + bot), `plugin_host.py`, `ensure_schema`, `router`, templat | `on_task_written`, `jobs` (B12), `register_bot`, `intake`, rahasia (B13) |
| Status | `plugin_states`, API, `TF.pluginstate`, op `plugin_state/set`, lebur OR, peredaman lokal | status per workspace, siaran SSE |
| Klien | `TF.api.fetch` + izin `network`, kartu Pengaturan, README | `api.settings`, `plugin_records`, IndexedDB v7 |

Rilis dipecah dua PR (§10): **PR A** `dbconn` saja (tanpa perubahan perilaku), **PR B** loader + status + `TF.api.fetch`.

## 4. Arsitektur server

### 4.1 File

| File | Status | Isi |
|---|---|---|
| `dbconn.py` | baru (~80 baris) | `connect`, `get_conn`, `write_tx` (K1–K3) |
| `webapp.py` | ubah | `get_db` → pembungkus; `_media_db_connect` → `dbconn.connect`; 27 koneksi `migrate_db` → `dbconn.connect(DB_PATH, foreign_keys=False)` (K4); `plugin_states.ensure_schema(conn)` + `plugin_loader.run_ensure_schema(...)` di `migrate_db`; `plugin_host.bind(...)`, `app.include_router(plugin_states.router)` dan `plugin_loader.mount(app)` setelah semua rute host (sebelum `if __name__`, `:10836`) |
| `repository.py` | ubah | `_connect` → `dbconn.get_conn(self.db_path)` |
| `bot.py` | ubah | `:313` → `dbconn.get_conn(repo.db_path)` (K5); di `main()` (`:2808`) `plugin_host.bind(...)` + `plugin_loader.load_for_bot(app)` (validasi + log; tanpa DDL, tanpa router) |
| `plugin_host.py` | baru (~60 baris) | fasad K8 |
| `plugin_loader.py` | baru (~220 baris) | `known_plugins()`, `discover()`, `run_ensure_schema()`, `mount()`, `require_plugin_enabled()`, `load_for_bot()`, `health(id)` |
| `plugin_states.py` | baru (~150 baris) | skema, `get_states`, `effective_enabled`, `put_state`, `router` host |
| `plugins/_template.py` | baru | templat modul server (dilewati loader) |
| `tests/fixtures/plugins/demo-server.py` + `index.json` | baru | plugin contoh khusus tes (K18) |

### 4.2 `dbconn`

```python
BUSY_TIMEOUT_MS = 5000

def default_path():                 # config.DB_PATH dibaca saat dipanggil (R1)
    import config
    return config.DB_PATH

def connect(path=None, *, foreign_keys=True, row_factory=sqlite3.Row):
    conn = sqlite3.connect(path or default_path(), timeout=5.0, isolation_level="IMMEDIATE")
    try:
        conn.row_factory = row_factory
        conn.execute("PRAGMA busy_timeout=5000")
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA foreign_keys=ON" if foreign_keys else "PRAGMA foreign_keys=OFF")
    except BaseException:
        conn.close(); raise          # tidak bocor bila pragma gagal
    return conn

@contextmanager
def get_conn(path=None, *, foreign_keys=True):   # = semantik get_db hari ini
    conn = connect(path, foreign_keys=foreign_keys)
    try:
        yield conn; conn.commit()
    except Exception:
        conn.rollback(); raise
    finally:
        conn.close()

@contextmanager
def write_tx(conn):                 # untuk baca-ubah-tulis
    if conn.in_transaction:
        raise RuntimeError("write_tx: transaksi sudah terbuka")
    conn.execute("BEGIN IMMEDIATE")
    try:
        yield conn; conn.commit()
    except BaseException:
        conn.rollback(); raise
```

`row_factory = Row` aman untuk semua: koneksi migrasi tanpa `row_factory` (`webapp.py:591`, `:603`, `:623`, `:641`, `:658`, `:682`, `:892`) tidak membaca baris, dan `Row` tetap mendukung indeks angka/unpacking (`_heal_broken_triggers`, `:1028`).

### 4.3 Peta koneksi dan risiko

| Titik | Sekarang | Sesudah | Risiko konkret dan penanganannya |
|---|---|---|---|
| `webapp.py:295–308` `get_db` (211 pemanggil) | WAL, FK ON, BEGIN deferred implisit | `dbconn.get_conn(DB_PATH)` | Netral (K2, jejak terverifikasi). Commit di tengah fungsi (mis. `:7315` "get_db me-rollback bila exception, jadi commit dulu") tetap berlaku. |
| `webapp.py:183–188` `_media_db_connect` (MediaWorker, EmailWorker) | WAL, FK ON, tanpa context manager | `_media_db_connect()` → `return dbconn.connect(DB_PATH)` (R4) | Worker commit per langkah (`email_outbox.py:166–214`, `media_worker.py:118–121`): tidak berubah. |
| `webapp.py:361–1004` `migrate_db` (27 koneksi) | 26 tanpa FK; `:978` FK ON | `connect(..., foreign_keys=False)`; `:978` tetap FK ON | Rebuild dengan FK ON menghapus anak (K4). DDL di mode legacy berjalan di luar transaksi bila belum ada DML — sama seperti sekarang. `SAVEPOINT` di backfill (`repository.py:265`, `:277`, `:557`, `:570`) membuka transaksi sendiri tanpa BEGIN dari Python (terverifikasi) — tidak terpengaruh `isolation_level`. |
| `repository.py:623–636` `_connect` (91 pemanggil, juga dipakai bot) | identik `get_db` | `dbconn.get_conn(self.db_path)` | `BEGIN IMMEDIATE` eksplisit (`:1803`, `:1833`, `:1859`, `:1876`) dipanggil sebelum DML apa pun → tidak bentrok dengan BEGIN implisit (terverifikasi). `:1801`/`:1810` menurunkan `busy_timeout` ke 1000 lalu memulihkan 5000 = bawaan baru. |
| Kursor terbuka + tulis di koneksi yang sama | pola `for r in conn.execute(...)` tanpa `fetchall` (`webapp.py:2360`, `:2368`, `:3020`, `:3024`, `:6715`) | tidak diubah | Bila badan loop menulis → `SQLITE_BUSY_SNAPSHOT` seketika apa pun `isolation_level`-nya (terverifikasi). Sampel yang diperiksa hanya membaca; loop yang menulis sudah `fetchall()` (`:2746`, `:6536`). Aturan plugin: `fetchall()` sebelum menulis. |
| Event loop | SQL sinkron di 213 endpoint `async def` | sama; kode plugin `def` di threadpool | Penulisan web kini **benar-benar paralel** dengan SQL di event loop; endpoint `async` yang menunggu kunci transaksi plugin memblokir loop hingga 5 s → transaksi plugin wajib pendek, tanpa jaringan (guard rail 1). |

Pagar statis: tes yang mem-parse AST semua `*.py` produksi (kecuali `scripts/`, `tests/`, `temporary_files/`) dan menolak `sqlite3.connect` di luar `dbconn.py` serta argumen `autocommit=`.

### 4.4 Loader dan fasad

**Siklus hidup web** (`webapp.py`, saat import modul, setelah semua rute host):

1. `plugin_host.bind(current_user=get_current_user, db_path=lambda: DB_PATH)`.
2. `known = plugin_loader.known_plugins(STATIC_DIR / "plugins/index.json")` → `{id: {defaultEnabled}}`; gagal baca → loader ditandai tidak sehat + log error: tidak ada plugin server dimuat dan `PUT` menjawab 503 (op klien tetap antre).
3. `discover(PLUGINS_DIR, known)` untuk tiap `plugins/<id>.py` (bukan `_*`): validasi id (pola `[a-z][a-z0-9-]{2,31}`, ada di `known`, bukan `state`) → import terisolasi (`try/except BaseException` kecuali `KeyboardInterrupt`) → tolak bila punya simbol tertunda (K7) → `getattr(mod, "MIN_HOST_API", 1) <= HOST_API` → `router` (bila ada) harus `APIRouter` tanpa prefix dan semua `APIRoute.endpoint` bukan coroutine kecuali bertanda `allow_async` → `ensure_schema` (bila ada) callable satu argumen.
4. `mount(app)`: `include_router` sesuai K9 untuk plugin yang lolos dan punya `router`. Rute host `plugin_states.router` dipasang lebih dulu.
5. Saat startup, `migrate_db()` menjalankan `plugin_states.ensure_schema` lalu `run_ensure_schema(DB_PATH)` (K10); hasilnya mengisi `health(id)`.

**`require_plugin_enabled(id)`** (dependency `def`, memakai `Depends(plugin_host.current_user)` yang sama sehingga tercache):

| Kondisi | Jawaban |
|---|---|
| token `scope == "ext"` (clipper) | 403 `{"detail": {"code": "PLUGIN_FORBIDDEN_TOKEN"}}` — token clipper tidak dipakai untuk plugin |
| `health(id) != "ok"` | 503 `{"detail": {"code": "PLUGIN_UNAVAILABLE", "plugin_id": id}}` |
| `effective_enabled(conn, uid, id)` = `enabled` baris, atau `defaultEnabled` bila NULL/tidak ada → false | 403 `{"detail": {"code": "PLUGIN_DISABLED", "plugin_id": id}}` |

Peredaman lokal (K16) tidak diketahui server; perangkat lain tetap bisa memakai API plugin.

**Bot** (`bot.py` `main()`): `plugin_host.bind(current_user=None, db_path=lambda: repo.db_path)`; `load_for_bot(app)` = langkah 2–3 saja, log `"plugin server: N dimuat, M ditolak"`, tidak pernah melempar. Kelak fungsi inilah yang memanggil `mod.register_bot(app)`.

**Kontrak modul plugin** (didokumentasikan di `docs/plugins/README.md` §Server dan `plugins/_template.py`):

```python
from fastapi import APIRouter, Depends
import plugin_host as host

MIN_HOST_API = 1
router = APIRouter()

def ensure_schema(conn):            # dipanggil dalam write_tx; jangan commit
    conn.execute("CREATE TABLE IF NOT EXISTS plg_demo_server_items (...)")

@router.get("/items")
def list_items(user=Depends(host.current_user)):
    with host.get_conn() as conn:
        rows = conn.execute("SELECT ... WHERE user_id = ?", (user["sub"],)).fetchall()
    return {"items": [dict(r) for r in rows]}
```

### 4.5 Skema `plugin_states`

```sql
CREATE TABLE IF NOT EXISTS plugin_states (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plugin_id  TEXT    NOT NULL,
  scope      TEXT    NOT NULL DEFAULT 'user',
  enabled    INTEGER CHECK (enabled IN (0, 1)),      -- NULL = ikut defaultEnabled
  settings   TEXT    NOT NULL DEFAULT '{}',          -- objek JSON ≤ 16 KB
  updated_at TEXT    NOT NULL,                        -- ISO UTC dengan offset
  PRIMARY KEY (user_id, plugin_id, scope)
);
```

`ensure_schema` idempoten (`CREATE TABLE IF NOT EXISTS`; kolom kelak lewat pola `PRAGMA table_info` seperti `repository.ensure_pomodoro_schema`, `repository.py:458`). Baris tidak dihapus saat plugin dihapus dari repo (data milik pengguna; pembersihan = keputusan fase lain).

## 5. API

**`GET /api/plugins/state`** (`def`, `Depends(get_current_user)`)

```json
{"v": 1, "server_time": "2026-11-02T03:00:00.000+00:00",
 "plugins": {"habit-heatmap": {"enabled": true, "settings": {}, "updated_at": "2026-11-01T10:05:00.000+00:00"}}}
```

Hanya baris `scope='user'` milik pengguna. Plugin tanpa baris tidak dicantumkan (klien memakai `defaultEnabled` dari `index.json`).

**`PUT /api/plugins/state/{plugin_id}`** (`def`, `write_tx`)

Body: `{"enabled": true|false|null, "settings": {...}?, "updated_at": "<ISO>"?}`; minimal satu dari `enabled`/`settings`. Validasi: `plugin_id` cocok pola, ada di `known`, bukan `state` → selain itu 404 `{"detail": {"code": "PLUGIN_UNKNOWN"}}`; `settings` harus objek dan ≤ 16 KB setelah serialisasi (422); `updated_at` tak terbaca → 422; tanpa zona = UTC; tanpa `updated_at` = waktu server.

Perilaku: `incoming = min(updated_at, now)`. Bila baris ada dan `baris.updated_at > incoming` → tidak menulis, `200 {"applied": false, "state": baris}`. Selain itu upsert hanya field yang dikirim, `updated_at = incoming`, `200 {"applied": true, "state": baris_baru}`. Kiriman ulang yang sama → hasil sama (idempoten).

**Rute plugin** `/api/plugins/<id>/…`: 401 (tanpa/kedaluwarsa token, perilaku `get_current_user`), 403 `PLUGIN_DISABLED`/`PLUGIN_FORBIDDEN_TOKEN`, 503 `PLUGIN_UNAVAILABLE`, sisanya milik plugin.

## 6. Klien

### 6.1 `TF.pluginstate` (`static/offline/pluginstate.js`, UMD seperti `pomolog.js`)

Bentuk `_meta plugins:state:v1` tetap kompatibel dengan 0a: `{[id]: {enabled, updatedAt, settings?, dirty?}}` (runtime 0a hanya membaca `enabled`). Kunci baru: `plugins:state:owner:v1` (user id pemilik cache), `plugins:suppressed:v1` (K16).

| Fungsi | Perilaku |
|---|---|
| `setLocal(id, {enabled?, settings?})` | satu transaksi `["_meta", "_outbox"]`: tulis entri (`updatedAt = now`, `dirty: true`), hapus op `plugin_state` ber-`cid` sama, tambah op baru berisi niat terakhir `{plugin_id, enabled, settings, updated_at}`; lalu `tf:outbox-queued` (memicu `schedulePush`, `index.html:1001`) |
| `pull(rawFetch, {userId, known})` | `GET /api/plugins/state` (non-2xx → throw; langkah sync terisolasi), lalu satu transaksi atas op tertunda, cache, `owner`. **Lebur pertama** (`owner !== userId`, K15): perangkat `true` dan server bukan `true` → lokal dipertahankan + op dengan `updatedAt` asli; selain itu adopsi server. **Sesudahnya:** plugin dengan op tertunda dilewati; sisanya mengadopsi server persis (tak ada di server → entri lokal dihapus = default). Hasil `{changed: [id]}` |
| `ackPushed(qid, id, state)` | satu transaksi: hapus op `qid`; bila tidak ada op lain untuk `id`, tulis `state` server ke cache (`dirty` hilang) |
| `dropOp(qid, id)` | untuk `PLUGIN_UNKNOWN`: hapus op dan bendera `dirty` |
| `hasPending(id)`, `suppress(id, reason, hash)`, `unsuppress(id)`, `suppressed()` | pembantu runtime |

Setiap fungsi yang mengubah cache memancarkan `window` event `tf:plugin-state` `{ids}`.

### 6.2 Sinkron

- `syncpush.processOp` (`syncpush.js:2123–2152`) + satu cabang `plugin_state/set` → `opPluginStateSet`: pastikan op masih ada (pola `processCommentOp` `:2089–2096`, karena coalescing bisa menghapusnya di tengah drain yang memakai snapshot `:2264–2265`); `PUT /api/plugins/state/<cid>` lewat `send`; 2xx → `ackPushed`; 404 `PLUGIN_UNKNOWN` → `dropOp`; 404 lain → biarkan (retry); 400/422 → `failPermanent(null, …)`; 401/429/5xx/jaringan → perilaku `send` yang ada.
- `sync()` (`index.html:1261`) + satu langkah `step(() => TF.pluginstate && TF.pluginstate.pull(__syncRawFetch, {...}))` sebelum `pushOutbox` (`:1360`).
- Fallback `processOp` untuk op tak dikenal (`:2151` membuang op) berarti SW lama setelah rollback membuang op `plugin_state` dengan sendirinya — tidak ada antrean macet (§10).

### 6.3 Runtime (`static/plugin-runtime.js`)

- `KNOWN_PERMISSIONS = ["storage", "network"]`; `network` keluar dari `RESERVED_PERMISSIONS` (`:18–19`).
- `setEnabled(id, on)` (`:288–303`) memakai `TF.pluginstate.setLocal`, bukan `persistState`; "Aktifkan lagi" juga `unsuppress`.
- `setEnabledInternal` (`:482–484`) dari `markFailed` diganti `suppress(id, kind, hash)`; status akun tak tersentuh.
- `isEnabled(id)` = status akun (cache) ∧ tidak diredam; `list()` menambah `pending` (ada op) dan `suppressed`.
- Pendengar `tf:plugin-state` → `reloadState()`: baca ulang cache, `activate`/`deactivate` plugin yang berubah, emit `plugins.changed` per id.
- `bindHost` (`:415`) menerima `fetch`, `isOfflineErr`, `pushNow`; bila `userId` berubah → `reloadState()` (logout memanggil `clearAll`, `db.js:128`, sehingga cache kosong → default sampai pull pertama).

### 6.4 `TF.api.fetch`

`api.fetch(path, {method = "GET", body, timeoutMs = 15000}) → Promise<json>`

1. Tanpa izin `network` → `PluginPermissionError` (dihitung sebagai error, seperti `storage`).
2. `path` harus diawali `/api/plugins/<id>/` (atau sama dengan `/api/plugins/<id>`), tanpa segmen `..`, `//`, `\`, `#`, skema/host → selain itu `PluginPermissionError`.
3. `method` ∈ GET/POST/PUT/PATCH/DELETE; `body` JSON ≤ 256 KB.
4. `api.env.online === false` → `PluginNetworkError {code: "offline", message: "Butuh koneksi internet"}` tanpa request.
5. `TF.pluginstate.hasPending(id)` → `await Promise.race([pushNow(), sleep(5000)])` supaya toggle ON yang baru dibuat sampai lebih dulu.
6. `hostBinding.fetch(path, {method, body: JSON.stringify(body)})`. Pemetaan error: `isOfflineErr(err)` atau 503 `OFFLINE` → `offline`; timeout → `timeout`; 401 → `auth`; 403 `PLUGIN_DISABLED` → `disabled`; 503 `PLUGIN_UNAVAILABLE` → `unavailable`; lainnya → `http` dengan `status` dan `detail`.

`PluginNetworkError` diekspor di `TF.api`, **tidak** dihitung `markFailed` (kegagalan jaringan bukan bug plugin). Plugin wajib menampilkan teks "Butuh koneksi internet" untuk `offline` dan menurunkan diri (guard rail 9).

### 6.5 Kartu Pengaturan › Plugin (`index.html:27190–27212`)

- Subjudul `"Fitur opsional. Status disimpan di perangkat ini."` → **`"Fitur opsional. Pilihanmu tersimpan di akun dan berlaku di semua perangkat."`** (§13 Q3).
- Petunjuk baris saat `pending`: `"Menunggu sinkron"`.
- Petunjuk saat `suppressed`: `"Dimatikan di perangkat ini karena error"` + tombol `"Aktifkan lagi"` dan `"Salin detail"` yang sudah ada.
- Label izin `network`: `"Butuh koneksi internet untuk sebagian fitur"`; label `storage` tetap `"Menyimpan pengaturan di perangkat ini"` (memang tetap per perangkat).
- Toast tidak berubah.

## 7. Migrasi dan kompatibilitas

- **Server:** `plugin_states` dibuat `migrate_db()` (dijalankan `deploy.yml` sebelum restart dan lagi saat startup); idempoten. Tidak ada backfill: status 0a hanya ada di perangkat dan naik lewat lebur pertama (K15).
- **Cache klien:** bentuk entri 0a dipertahankan; field tambahan diabaikan runtime 0a; kunci baru tidak dibaca 0a.
- **Jendela deploy:** setelah `git reset` file statis baru langsung tersaji, sedangkan proses web lama masih melayani sampai restart manual. Klien baru: `GET /api/plugins/state` 404 → langkah pull gagal terisolasi; `PUT` 404 tanpa `PLUGIN_UNKNOWN` → op tetap antre (K14). Tidak ada toggle yang hilang.

## 8. Offline dan sinkron (skenario)

| Skenario | Hasil |
|---|---|
| Toggle ON saat offline, lalu OFF, lalu online | satu op (OFF) terkirim; server OFF |
| Perangkat A (0a) ON, server kosong | lebur pertama: op ON dengan waktu asli → server ON; perangkat B ikut ON di sinkron berikutnya |
| Perangkat A (0a) ON minggu lalu, server OFF eksplisit hari ini | op A ditolak LWW → OFF (§13 Q1) |
| Logout lalu login akun lain di perangkat yang sama | `clearAll` + pemilik berbeda → tidak ada lebur dari pengguna sebelumnya; status akun baru diadopsi |
| Plugin error 2× di HP | diredam di HP saja; laptop tetap ON; pull tidak menyalakannya lagi di HP |

Status tidak disiarkan lewat SSE di 0b; perangkat lain berubah pada sinkron berikutnya (start, fokus tab, online, interval yang ada).

## 9. Pengujian

### 9.1 pytest (baru)

| File | Yang diuji |
|---|---|
| `tests/test_dbconn.py` | pragma (`busy_timeout`, WAL, FK on/off, `IMMEDIATE`, `autocommit` legacy); `get_conn` commit/rollback/close; jejak alur khas `SELECT; BEGIN IMMEDIATE; INSERT; COMMIT`; `write_tx` BEGIN sebelum SELECT + menolak transaksi terbuka; 2 thread × 50 increment dengan `write_tx` = 100 tanpa error (versi deferred: `SQLITE_BUSY_SNAPSHOT`) |
| `tests/test_dbconn_callsites.py` | AST: `sqlite3.connect` hanya di `dbconn.py`; tidak ada `autocommit=`; `migrate_db` memanggil `connect(..., foreign_keys=False)` kecuali blok project |
| `tests/test_migrate_fk.py` | rebuild ala `drawings` di DB lama dengan tabel anak ber-FK: baris anak utuh setelah `migrate_db` |
| `tests/test_bot_link_token.py` | `cmd_link` dengan kode valid menautkan `telegram_id` (regresi `bot.py:312`) |
| `tests/test_plugin_states.py` | skema idempoten; GET kosong; PUT buat/ubah; LWW `applied:false`; pemotongan waktu masa depan; `enabled: null`; 404 `PLUGIN_UNKNOWN` (id asing, `state`); 422 (settings, waktu); 401; isolasi antar pengguna; CASCADE |
| `tests/test_plugin_loader.py` | fixture `demo-server` lolos; ditolak: endpoint coroutine, `on_task_written` ("Fase 1"), router ber-prefix, id di luar indeks, import error (terisolasi); `_skip.py` dilewati; objek tanpa prefix → rollback + 503; app FastAPI baru + `mount`: 401 / 403 `PLUGIN_DISABLED` / 200 setelah PUT ON / 403 token ext; `load_for_bot` tanpa DDL dan tanpa rute |

Seluruh pytest lama (1250) lulus tanpa perubahan asersi — bukti utama netralitas PR A.

### 9.2 `node --test`

| File | Yang diuji |
|---|---|
| `tests/offline/pluginstate.test.js` (baru) | `setLocal` atomik + satu op per plugin; matriks lebur pertama 3×3 + `updatedAt` asli; `owner`; op tertunda menang saat pull; `ackPushed` dengan/tanpa op lebih baru; `clearAll` → default |
| `tests/offline/syncpush_pluginstate.test.js` (baru) | cabang `processOp`: path/body PUT, 2xx ack, 401 menghentikan drain, 5xx tetap, 404 generik tetap, `PLUGIN_UNKNOWN` dibuang, op yang sudah di-coalesce dilewati |
| `tests/offline/plugin_fetch.test.js` (baru) | izin, validasi path (plugin lain, `..`, URL absolut, `//`), offline tanpa request, pemetaan error, `pushNow` saat tertunda, tidak memanggil `markFailed` |
| `plugin_registry`/`plugin_loader`/`plugin_failure` (ubah) | contoh izin dicadangkan `"network"` → `"records"` (`plugin_registry.test.js:38,50`, `plugin_loader.test.js:92`, `plugin_failure.test.js:145`); auto-OFF = peredaman lokal, dihapus "Aktifkan lagi"/hash baru |
| `plugin_settings_ui`, `plugin_host_wiring` (ubah) | teks baru (`plugin_settings_ui.test.js:38,42`), "Menunggu sinkron", label `network`; `sync()` memuat langkah pull sebelum `pushOutbox`; `bindHost` meneruskan `fetch/isOfflineErr/pushNow`; `<script>` + `STATIC` `pluginstate.js` |
| `tests/build-plugins.test.js` (ubah) | lint: `fetch(` polos ditolak, `api.fetch(` hanya dengan izin `network`; id `state` ditolak |

`tests/test_plugins_node.py`: `REQUIRED` += `plugin_fetch`, pola += `pluginstate*.test.js`, `syncpush_pluginstate.test.js`.

### 9.3 Statis dan E2E manual

- `check_inline_scripts`, `compile.js` idempoten, PROTOCOL §4 butir 5.
- E2E (dua konteks browser, satu akun): (1) ON di A → sinkron → B ON tanpa reload; (2) B offline OFF → "Menunggu sinkron" → online → A OFF; (3) server tanpa rute (simulasi jendela deploy) → toggle tetap antre, terkirim setelah server baru; (4) logout/login akun lain; (5) `_debugThrow` 2× di A → A diredam, B tetap ON; (6) Tauri Desktop bila ada build: langkah 1–2.

## 10. Rilis

**PR A — `claude/dbconn`** (server saja; ADR-038): `dbconn.py`, migrasi 31 titik, perbaikan `/link`, tes §9.1 baris 1–4. Tanpa perubahan frontend → tanpa SW bump. Deploy: workflow (`git reset`, `migrate_db`; **tidak** me-restart), lalu Bapak menjalankan **`sudo systemctl restart taskflow-web taskflow`** (bot memakai `repository.py`/`bot.py` yang berubah). Pantau `journalctl -u taskflow-web -u taskflow` (`database is locked`) ±1 hari sebelum PR B.

**PR B — `claude/plugin-fase0b`:** loader, fasad, `plugin_states`, klien, README, ADR-039 (ADR-038 dipakai PR A).
- SW: `CACHE` → `taskflow-v490-plugin-akun` (nomor final mengikuti `main`), `window.__SW_VERSION` + fallback, tes versi; `STATIC` += `/static/offline/pluginstate.js`; `app.css` tetap `?v=382`.
- `whatsnew.json` entri teratas: `{"version": "taskflow-v490-plugin-akun", "date": "…", "title": "Plugin ikut akunmu", "new": ["Plugin yang kamu nyalakan kini ikut aktif di perangkat lain setelah tersinkron.", "Tetap bisa dinyalakan atau dimatikan saat offline; perubahan dikirim begitu online."]}`.
- Deploy: workflow → restart **`taskflow-web` dan `taskflow`** (bot memuat `plugin_loader`). Verifikasi: `GET /api/plugins/state` dengan token → 200; log bot `plugin server: 0 dimuat, 0 ditolak`; Pengaturan › Plugin menampilkan subjudul baru setelah "Perbarui Sekarang".
- Urutan CI Tauri tidak berubah (`npm run compile` → `build-tauri-dist`).

**Rollback.** PR B: revert sebagai rilis baru (SW bump + entri `whatsnew` `silent`, PROTOCOL §4) + restart dua layanan; tabel `plugin_states` dibiarkan (tidak dibaca kode lama); SW lama membuang op `plugin_state` tak dikenal (`syncpush.js:2151`) dan membaca entri cache seperti 0a (status per perangkat). PR A: revert + restart; tidak ada perubahan data atau skema.

## 11. Risiko dan mitigasi

| Risiko | Mitigasi |
|---|---|
| Endpoint lama ternyata bergantung pada BEGIN deferred | jejak pernyataan identik kecuali kata `IMMEDIATE` (§9.1); 1250 tes lama tanpa perubahan asersi; PR A terpisah dan bisa di-revert sendiri |
| Jam perangkat salah | pemotongan ke waktu server (K12); jam yang mundur hanya membuat perubahan perangkat itu kalah |
| Lint `fetch` dilonggarkan | `.fetch(` hanya dengan izin `network`; `fetch(` polos, `window.fetch`, `self.fetch`, `globalThis.fetch` tetap ditolak |
| Runtime/plugin beda versi di Fase 0c | izin `network` ditolak runtime lama sebagai "dicadangkan" → plugin OFF dengan alasan jelas, bukan error `api.fetch is not a function` |
| `index.json` hilang/rusak di server | loader tidak sehat: `PUT` 503 (op tetap antre), tanpa plugin server; deploy selalu menjalankan `node compile.js` |

## 12. Di luar cakupan

`on_task_written`, `jobs`/`plugin_jobs`, `register_bot`, `intake`, `plugin_secrets`; `plugin_records`, IndexedDB v7, `tasks.ext`; `api.settings`; status per workspace; siaran SSE status; `plugin_states` di ekspor data pengguna (bersama `plugin_records`, Fase 1); `Depends(get_authorized_task/list)` (Fase 1, pemakai pertama); mengubah 213 endpoint lama ke `def`/`write_tx`; audit menyeluruh kursor-terbuka-lalu-tulis; `PRAGMA foreign_keys=OFF` di `webapp.py:6248` yang no-op karena berjalan di dalam transaksi implisit (terverifikasi, pra-ada); restart otomatis di `deploy.yml`; precache revisi per file (Fase 0c); plugin pihak ketiga/sandbox.

## 13. Keputusan pemilik (dikonfirmasi 2026-10-31)

Keputusan: **Q1 (a)** keputusan terbaru menang; **Q2** metrik Heatmap tetap per perangkat; **Q3** teks disetujui; **Q4** dua PR (A: fondasi database; B: status per akun + loader + `TF.api.fetch`).


1. **Q1 — Aturan lebur sinkron pertama.** Plugin yang dinyalakan di HP sebelum pembaruan, padahal di laptop sudah sengaja dimatikan sesudah pembaruan: (a) tetap mati karena keputusan laptop lebih baru, atau (b) selalu hidup (OR murni)? **Rekomendasi: (a)** — OR berlaku penuh selama belum ada keputusan yang lebih baru di akun, dan pengguna tidak melihat plugin yang sudah dimatikannya hidup lagi.
2. **Q2 — Pilihan metrik Heatmap (Habit/Task selesai/Keduanya).** Tetap per perangkat di 0b, atau ikut akun? **Rekomendasi: tetap per perangkat**; ikut akun dibuat di Fase 1 bersama pengaturan plugin lain. Konsekuensinya 0b tidak menambah plugin yang terlihat; jalur server dibuktikan plugin contoh khusus tes.
3. **Q3 — Teks kartu Pengaturan.** Subjudul **"Fitur opsional. Pilihanmu tersimpan di akun dan berlaku di semua perangkat."**, penanda **"Menunggu sinkron"**, dan **"Dimatikan di perangkat ini karena error"** untuk plugin yang padam otomatis. **Rekomendasi: setujui** (atau beri teks pengganti).
4. **Q4 — Rilis dua tahap.** PR A (fondasi database server, tanpa perubahan yang terlihat) di-deploy dan dipantau ±1 hari, baru PR B (status per akun). Keduanya butuh restart **`taskflow-web` dan `taskflow`** oleh Bapak setelah deploy. **Rekomendasi: dua PR**; bila Bapak lebih suka satu kali restart, keduanya bisa digabung dengan risiko rollback yang lebih kasar.

## 14. Pertanyaan terbuka (teknis, diputuskan saat plan)

1. Nama modul `dbconn.py` vs `db.py` (nama terakhir mudah tertukar dengan `static/offline/db.js`); spec memilih `dbconn.py`.
2. Batas 16 KB `settings` dan 256 KB body `api.fetch` adalah angka awal; ditinjau ulang saat Timeline punya ukuran nyata.
