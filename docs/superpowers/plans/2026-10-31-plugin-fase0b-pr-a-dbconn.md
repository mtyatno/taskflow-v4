# Sistem Plugin Fase 0b — PR A: fondasi koneksi database (`dbconn.py`) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Satu pintu koneksi SQLite untuk server Alurik: modul baru `dbconn.py` (`connect`, `get_conn`, `write_tx`) menggantikan 31 titik `sqlite3.connect` produksi (`webapp.py` 29, `repository.py` 1, `bot.py` 1) secara bertahap, tanpa perubahan perilaku yang terlihat pengguna, tanpa perubahan skema, tanpa perubahan frontend. Sekalian memperbaiki bug pra-ada `/link <KODE>` di bot (`repo._db_path`). Hasilnya dipakai PR B (loader plugin, `plugin_states`, `TF.api.fetch`).

**Architecture:** `dbconn.py` (~80 baris, stdlib saja, tidak meng-import `webapp`/`repository`) adalah satu-satunya tempat `sqlite3.connect` dipanggil. `connect(path=None, *, foreign_keys=True, row_factory=sqlite3.Row)` membuka koneksi dengan `timeout=5.0`, `isolation_level="IMMEDIATE"` (mode transaksi *legacy* Python; atribut `autocommit` tidak pernah disentuh), `PRAGMA busy_timeout=5000`, `PRAGMA journal_mode=WAL`, dan `PRAGMA foreign_keys=ON` sesuai parameter. `get_conn(path=None)` = context manager semantik `get_db` hari ini (commit bila sukses, rollback bila exception, selalu close). `write_tx(conn)` = `BEGIN IMMEDIATE` eksplisit **sebelum** SELECT pertama, `COMMIT`/`ROLLBACK`, menolak transaksi yang sudah terbuka. `webapp.get_db()` tetap ada sebagai pembungkus satu baris (211 pemanggil tidak disentuh); `TaskRepository._connect` → `dbconn.get_conn(self.db_path)` (90 pemanggil tidak disentuh); 27 koneksi `migrate_db()` → `dbconn.connect(DB_PATH, foreign_keys=False)` kecuali blok project (FK ON seperti sekarang); `bot.py` `/link` → `dbconn.get_conn(repo.db_path)`. Pagar AST di tes menolak `sqlite3.connect` (termasuk alias `import sqlite3 as _sq`) di luar `dbconn.py`.

**Tech Stack:** Python 3.12 (CI `test.yml:16` dan venv produksi 3.12.3; lokal 3.13 juga lulus), `sqlite3` stdlib (SQLite 3.45.1 di venv), pytest. Tidak ada dependensi baru, tidak ada perubahan `static/`, `node`, SW, maupun `whatsnew.json`.

**Spec:** `/home/claude/alurik-specs/spec-plugin-fase0b-2026-10-31.md` (Project claude.ai `claude/spec-plugin-fase0b-2026-10-31.md`; disetujui pemilik 2026-10-31, §13 Q4 = dua PR). PR A mencakup §2 K1–K5, §4.2–§4.3, §7 (bagian server), §9.1 baris 1–4, §10 "PR A", §11 baris 1. Saat implementasi dimulai spec di-commit ke `docs/superpowers/specs/2026-10-31-plugin-fase0b-design.md` (Task 7), dengan deviasi R1/R4/R5/R7 di bawah dicatat di kedua salinan.

**Branch:** `claude/dbconn` dari `main` ≥ `105a72b1` (SW `taskflow-v489-heatmap-rapi`, `app.css?v=382` — keduanya **tidak berubah** di PR ini). Baseline (dijalankan 2026-10-31 di `main` 105a72b1): `python -m pytest tests/ -q` → **1250 passed, 1 skipped** (97 s); `npm test` tidak relevan (tanpa perubahan statis).

## Peta titik koneksi (`main` 105a72b1)

| File | Baris | Jumlah | Sekarang | Sesudah (Task) |
|---|---|---|---|---|
| `webapp.py` | 184 `_media_db_connect` | 1 | WAL + FK ON, tanpa context manager (worker media/email) | `dbconn.connect(DB_PATH)` (Task 2) |
| `webapp.py` | 297 `get_db` | 1 | WAL + FK ON, commit/rollback/close | `dbconn.get_conn(DB_PATH)` (Task 2) |
| `webapp.py` | `migrate_db` 361, 422, 433, 465, 509, 528, 591, 603, 623, 641, 658, 682, 733, 761, 779, 790, 802, 847, 858, 869, 892, 905, 925, 943, 967, 978, 1004 | 27 | 26 tanpa pragma apa pun (FK OFF, 7 di antaranya tanpa `row_factory`), 978 FK ON eksplisit | `dbconn.connect(DB_PATH, foreign_keys=False)` × 26, blok 978 `foreign_keys=True` (Task 3) |
| `repository.py` | 625 `TaskRepository._connect` | 1 | identik `get_db` | `dbconn.get_conn(self.db_path)` (Task 4) |
| `bot.py` | 313 `cmd_link` (`import sqlite3 as _sq` di 310, `_sq.connect(repo._db_path)`) | 1 | **crash `AttributeError`** (K5) | `dbconn.get_conn(repo.db_path)` + 2 perbaikan bug (Task 5) |
| **Total produksi** | | **31** | | **0 di luar `dbconn.py`** (Task 6) |
| Bukan produksi (dikecualikan pagar, tidak diubah) | `scripts/dedup_drawings.py:66`, `merge_db.py:23,25`, `fix_list_tasks.py:23,25` | 5 | skrip sekali jalan / pemeliharaan, dijalankan manual | tetap (R6) |

Modul lain yang disebut spec (`media_worker.py`, `email_outbox.py`, `note_comments.py`, `drawing_scope.py`, `workspace_identity.py`, `review_history.py`, `ai_review.py`, `bookmark.py`) **tidak** memanggil `sqlite3.connect` — mereka menerima `conn` atau callable `connect` dari pemanggil (`MediaWorker(connect=…)`, `EmailWorker(connect=…)`) → tidak diubah; keduanya otomatis memakai dbconn begitu `_media_db_connect` dimigrasi (Task 2). Pemanggil yang tidak disentuh: 211 × `get_db()` di `webapp.py`, 90 × `self._connect()` di `repository.py`, 4 × `repo._connect()` di `bot.py` (`:1761`, `:2238`, `:2255`, `:2405`). `BEGIN IMMEDIATE` eksplisit yang sudah ada (`repository.py:1803`, `:1833`, `:1859`, `:1876`) dan `SAVEPOINT` backfill (`:265`, `:277`, `:557`, `:570`) tidak diubah.

## Keputusan rencana (controller)

- **R1 — path dibaca saat dipanggil.** `connect(path=None)`/`get_conn(path=None)`: `None` → `dbconn.default_path()` = `config.DB_PATH` yang di-*import* di dalam fungsi (bukan `from config import DB_PATH` di tingkat modul) sehingga nilainya dibaca saat dipanggil. Di PR A **semua** pemanggil produksi mengirim path eksplisit: `webapp.get_db()` → `dbconn.get_conn(DB_PATH)` dan `migrate_db`/`_media_db_connect` → `dbconn.connect(DB_PATH, …)` memakai global `DB_PATH` modul `webapp` **di badan fungsi** (lookup saat dipanggil, jadi `monkeypatch.setattr(webapp, "DB_PATH", …)` di `tests/test_sync_audit_server.py:128` tetap bekerja); `repository` → `self.db_path`; `bot` → `repo.db_path`. Pagar AST (Task 1) menolak `dbconn.connect(`/`dbconn.get_conn(` **tanpa argumen posisi** di `webapp.py`, `repository.py`, `bot.py`. Default `None` disediakan untuk `plugin_host` (PR B) dan skrip.
- **R2 — mode transaksi = K2 (legacy `isolation_level="IMMEDIATE"`), `write_tx` = `BEGIN IMMEDIATE` eksplisit, bukan `isolation_level=None`/`autocommit`.** Diverifikasi 2026-10-31 dengan `set_trace_callback` di venv 3.12.3/SQLite 3.45.1 dan 3.13: (a) SELECT dan DDL sebelum DML pertama berjalan di luar transaksi (`in_transaction False`), DML pertama memicu `BEGIN IMMEDIATE` — jejak endpoint lama identik kecuali kata `IMMEDIATE`; (b) `conn.execute("BEGIN IMMEDIATE")` manual lalu SELECT/UPDATE/`commit()` menghasilkan jejak `['BEGIN IMMEDIATE', 'SELECT …', 'UPDATE …', 'COMMIT']` tanpa BEGIN ganda; (c) `SAVEPOINT` tanpa BEGIN tidak disisipi BEGIN oleh Python; (d) **baca-lalu-tulis tanpa `write_tx` = pembaruan hilang tanpa error** (2 thread × 50 increment → 50, bukan 100) karena SELECT-nya berjalan sebelum transaksi; dengan `write_tx` → 100 tanpa error; (e) transaksi *deferred* eksplisit (`BEGIN`; SELECT) yang menulis setelah penulis lain commit gagal **seketika** `database is locked` (SQLITE_BUSY_SNAPSHOT, 0,00 s; `busy_timeout` tidak menolong). Semua menjadi tes di `tests/test_dbconn.py` (Task 1).
- **R3 — `migrate_db`:** 26 blok → `dbconn.connect(DB_PATH, foreign_keys=False)`; blok project (`:978`) → `dbconn.connect(DB_PATH, foreign_keys=True)` eksplisit dan baris `conn.execute("PRAGMA foreign_keys=ON")` (`:981`) **dibiarkan** (diff minimal; pragma di luar transaksi = no-op aman). Diverifikasi (probe 2026-10-31): rebuild tabel dengan FK ON → `DROP TABLE x_old` menghapus baris tabel anak (CASCADE) **dan** `REFERENCES` anak ditulis ulang ke `x_old` walau `legacy_alter_table=ON`; FK OFF → anak utuh dan referensi tetap `x`. `row_factory=Row` pada 7 koneksi yang dulu tanpa `row_factory` aman (`r[0]` dan unpacking `for name, sql in …` di `_heal_broken_triggers` diverifikasi bekerja dengan `Row`). Pagar AST: semua `dbconn.connect` di `migrate_db` wajib `foreign_keys=` literal, tepat satu `True`, total 27.
- **R4 — `_media_db_connect` tetap fungsi bernama** (`return dbconn.connect(DB_PATH)`), bukan lambda seperti teks K5: `DB_PATH` tetap *late-bound*, dan `webapp.media_worker._connect`/`webapp.email_worker._connect` bisa diuji.
- **R5 — `/link <KODE>` punya dua bug pra-ada, keduanya diperbaiki di Task 5** dengan satu tes regresi yang memakai token dari endpoint asli (`POST /api/auth/telegram-link-token`): (1) `repo._db_path` → `AttributeError` (K5); (2) setelah (1) diperbaiki, `datetime.fromisoformat(row["expires_at"]) < datetime.now()` melempar `TypeError: can't compare offset-naive and offset-aware datetimes` karena `webapp.py:1917` menulis `expires_at` ber-zona Asia/Jakarta (diverifikasi 2026-10-31). Perbaikan: `exp = datetime.fromisoformat(...)`; `exp < datetime.now(exp.tzinfo)` (aware ↔ aware, naif lama ↔ naif). Di luar cakupan (dicatat di handover): jalur token tidak memindahkan task dari pengguna otomatis `tg_<id>` seperti jalur username (`repository.py:1249–1252`).
- **R6 — pagar AST** (`tests/test_dbconn_callsites.py`): memindai semua `*.py` di akar repo (`scripts/`, `tests/`, `temporary_files/`, `venv/`, `node_modules/`, `draw-app/`, `docs/` tidak dipindai) dengan allowlist eksplisit beralasan `{"merge_db.py", "fix_list_tasks.py"}` (skrip sekali jalan, tidak diimpor layanan). Menolak: `sqlite3.connect` lewat `import sqlite3`, `import sqlite3 as X` (kasus `bot.py:310`, termasuk import di dalam fungsi), `from sqlite3 import connect [as Y]`; kata kunci `isolation_level=`/`autocommit=` di pemanggilan apa pun; assignment `.isolation_level`/`.autocommit` — semuanya di luar `dbconn.py`. `dbconn.py` sendiri wajib tepat **satu** `sqlite3.connect`. Selama migrasi bertahap, tes memakai **ratchet** `REMAINING = {"webapp.py": 29, "repository.py": 1, "bot.py": 1}` (jumlah titik yang masih diizinkan per file, hanya boleh turun); Task 6 menghapus ratchet → aturan keras.
- **R7 — ADR-038 = dbconn (PR A)** sesuai instruksi pemilik; spec §10 menyebut ADR-038 untuk PR B → PR B memakai **ADR-039**; kedua salinan spec diperbarui (Task 7).
- **R8 — exception di context manager:** `get_conn` menangkap `Exception` (identik `get_db` hari ini — K1 "semantik `get_db`"; `close()` di `finally` tetap membuang transaksi bila `BaseException` lolos), `write_tx` menangkap `BaseException` (K3, sesuai spec §4.2).
- **R9 — dokumen di PR A:** salinan spec (`docs/superpowers/specs/2026-10-31-plugin-fase0b-design.md`) dan rencana ini (`docs/superpowers/plans/2026-10-31-plugin-fase0b-pr-a-dbconn.md`) di-commit; `schema-db.md` tidak berubah (tanpa skema baru). Tanpa SW bump, tanpa entri `whatsnew.json`: PROTOCOL §4 hanya berlaku pada kenaikan versi SW.
- **R10 — tes lama tidak disentuh:** `git diff --stat origin/main -- tests/` hanya boleh berisi file **baru** (bukti netralitas K1; diperiksa Task 8). Tidak ada endpoint lama yang diubah ke `def`/`write_tx` (spec §12).

## Global Constraints

- Tidak ada perubahan di `static/` (SW `taskflow-v489-heatmap-rapi`, `app.css?v=382`, `whatsnew.json` tetap), `index.html`, `compile.js`, `package.json`, `draw-app/`, `src-tauri/`; `git diff --stat origin/main -- static/` kosong.
- Tidak ada perubahan skema/DDL baru, tidak ada `DB_VERSION`/IndexedDB; `migrate_db()` tetap idempoten dan tetap **tanpa** FK pada 26 blok (K4).
- `dbconn.py` hanya meng-import stdlib (+ `config` malas di `default_path`); tidak pernah meng-import `webapp`, `repository`, `bot` (hindari import melingkar; `bot.py` dan `webapp.py` keduanya meng-import `dbconn`).
- Tidak pernah menyetel `conn.autocommit` atau `isolation_level` selain `"IMMEDIATE"` di `dbconn.connect` (Python 3.12 + 3.13 harus lulus; `sqlite3.LEGACY_TRANSACTION_CONTROL`).
- Pragma per koneksi persis: `busy_timeout=5000` (eksplisit, bukan hanya bawaan `timeout=5.0`), `journal_mode=WAL`, `foreign_keys=ON` bila `foreign_keys=True`.
- 211 pemanggil `get_db()`, 90 pemanggil `self._connect()`, 4 pemanggil `repo._connect()`, serta `conn.commit()` di tengah fungsi (mis. `webapp.py:7315`) tidak disentuh.
- Setelah **setiap** task: `python -m pytest tests/ -q` hijau (1250 lama + tes baru; 1 skipped), tanpa mengubah asersi tes lama.
- Tes konkurensi tidak boleh mengandalkan `sleep` sebagai sinkronisasi kecuali sebagai penahan kunci yang dibatasi (`threading.Event` untuk urutan; batas waktu ≤ 2 s).
- Pesan commit: `feat(db)`, `refactor(db)`, `fix(bot)`, `test(db)`, `docs(db)`; ikuti aturan atribusi commit/PR yang berlaku di sesi.

## Review Focus

1. **Netralitas:** jejak SQL endpoint lama identik kecuali `BEGIN` → `BEGIN IMMEDIATE`; `migrate_db` tetap FK OFF (tes `test_migrate_fk.py` + aturan AST); 1250 tes lama lulus tanpa diubah (R10).
2. **`write_tx` benar:** `BEGIN IMMEDIATE` sebelum SELECT pertama, menolak transaksi terbuka, rollback pada `BaseException`, tes konkurensi deterministik (Task 1).
3. **Monkeypatch tetap bekerja:** `webapp.DB_PATH` dibaca saat dipanggil di `get_db`, `migrate_db`, `_media_db_connect` (R1; `tests/test_sync_audit_server.py:128`, `tests/test_mindmap_live.py:144` membungkus `webapp.get_db`).
4. **Pagar lengkap:** alias `import sqlite3 as _sq`, import di dalam fungsi, `from sqlite3 import connect`; `isolation_level`/`autocommit`; allowlist beralasan; bukti mutasi (Task 6).
5. **Deploy:** `deploy.yml` menjalankan `migrate_db()` tetapi **tidak** me-restart layanan → handover wajib menyebut `sudo systemctl restart taskflow-web taskflow` (bot memuat `repository.py`/`bot.py` yang berubah) dan rollback = revert PR + restart.

---

### Task 1: Modul `dbconn.py` + tes unit/konkurensi + pagar AST (ratchet)

**Files:**
- Create: `dbconn.py`
- Test: `tests/test_dbconn.py`, `tests/test_dbconn_callsites.py`

**Interfaces (Produces):**
- `dbconn.BUSY_TIMEOUT_MS = 5000`
- `dbconn.default_path() -> str` — `import config` di dalam fungsi, kembalikan `config.DB_PATH` (R1).
- `dbconn.connect(path=None, *, foreign_keys=True, row_factory=sqlite3.Row) -> sqlite3.Connection` — `sqlite3.connect(path or default_path(), timeout=BUSY_TIMEOUT_MS / 1000, isolation_level="IMMEDIATE")`; `conn.row_factory = row_factory`; `PRAGMA busy_timeout=5000`; `PRAGMA journal_mode=WAL`; `PRAGMA foreign_keys=ON` bila `foreign_keys`.
- `dbconn.get_conn(path=None, *, foreign_keys=True)` — `@contextmanager`: `connect(...)`, `yield conn`, `conn.commit()`; `except Exception: conn.rollback(); raise`; `finally: conn.close()` (R8).
- `dbconn.write_tx(conn)` — `@contextmanager`: `if conn.in_transaction: raise RuntimeError("write_tx: transaksi sudah terbuka")`; `conn.execute("BEGIN IMMEDIATE")`; `yield conn`; `conn.commit()`; `except BaseException: conn.rollback(); raise`.
- Docstring modul: ADR-038, aturan K3 untuk kode baru ("baca-lalu-tulis wajib `write_tx`; `fetchall()` sebelum menulis pada koneksi yang sama"), larangan `autocommit`.

- [ ] **Step 1: Tulis tes gagal** `tests/test_dbconn.py` (setiap tes memakai `tmp_path`, bukan DB conftest):
  - `test_connect_pragmas`: `busy_timeout == 5000`, `journal_mode == "wal"`, `foreign_keys == 1`; `connect(p, foreign_keys=False)` → `0`; `conn.isolation_level == "IMMEDIATE"`; `conn.autocommit == sqlite3.LEGACY_TRANSACTION_CONTROL` (lewati asersi bila atribut tidak ada); `row_factory is sqlite3.Row`; `connect(p, row_factory=None)` memberi tuple.
  - `test_default_path_is_read_at_call_time(monkeypatch)`: `monkeypatch.setattr(config, "DB_PATH", str(tmp))` → `dbconn.connect()` membuat file itu; `dbconn.default_path()` mengikuti.
  - `test_get_conn_commit_rollback_close`: INSERT di blok sukses tersimpan; INSERT di blok yang melempar `ValueError` tidak tersimpan dan exception diteruskan; setelah blok, `conn.execute` → `sqlite3.ProgrammingError` (sudah ditutup).
  - `test_legacy_trace_begin_only_before_dml`: `set_trace_callback` → `SELECT`, `CREATE TABLE` (DDL), lalu `INSERT`, `commit()` → jejak (dinormalisasi spasi) `== ["SELECT …", "CREATE TABLE …", "BEGIN IMMEDIATE", "INSERT …", "COMMIT"]`; `in_transaction` `False` sebelum INSERT (R2a).
  - `test_write_tx_trace`: jejak `== ["BEGIN IMMEDIATE", "SELECT …", "UPDATE …", "COMMIT"]`; `in_transaction False` sesudahnya (R2b).
  - `test_write_tx_rollback_on_exception`: `with pytest.raises(ValueError)` → perubahan hilang, jejak diakhiri `ROLLBACK`.
  - `test_write_tx_rejects_open_transaction`: `conn.execute("INSERT …")` (membuka transaksi implisit) lalu `with dbconn.write_tx(conn)` → `RuntimeError` dengan teks persis; juga `write_tx` di dalam `write_tx` → `RuntimeError`.
  - `test_write_tx_inside_get_conn`: `with dbconn.get_conn(p) as c, dbconn.write_tx(c): …` → tersimpan; commit ganda tidak melempar.
  - `test_write_tx_with_savepoint`: `SAVEPOINT s; INSERT; RELEASE s` di dalam `write_tx` → jejak `["BEGIN IMMEDIATE", "SAVEPOINT s", "INSERT …", "RELEASE s", "COMMIT"]` (pola backfill, R2c).
  - `test_read_then_write_without_write_tx_loses_update` (deterministik, R2d): koneksi A dan B; `na = A.SELECT n` (0), `nb = B.SELECT n` (0); `B.UPDATE n=nb+1; B.commit()`; `A.UPDATE n=na+1; A.commit()` → `n == 1` (bukan 2) — mendokumentasikan bahaya yang dihindari K3.
  - `test_deferred_read_then_write_fails_immediately` (R2e): A: `execute("BEGIN")` + SELECT; B: UPDATE + commit; `t0`; `with pytest.raises(sqlite3.OperationalError, match="locked")`: A UPDATE; `elapsed < 1.0` (busy_timeout 5 s tidak dipakai = BUSY_SNAPSHOT).
  - `test_write_tx_waits_for_other_writer_then_sees_its_write`: thread B: `write_tx` → UPDATE `n = n + 1` → `started.set()` → `time.sleep(0.3)` → commit; utama: `started.wait(2)`, `t0`, `write_tx` → SELECT (harus 1) → UPDATE 2 → commit; asersi `n_final == 2`, `elapsed >= 0.2`, tanpa exception.
  - `test_write_tx_two_threads_fifty_increments`: 2 thread × 50 `write_tx` (SELECT lalu UPDATE n+1) → `n == 100`, daftar error kosong.
- [ ] **Step 2: Tulis tes gagal** `tests/test_dbconn_callsites.py` (pagar AST, R6):
  - Helper `connect_calls(path) -> list[(lineno, bentuk)]`: kumpulkan nama alias modul `sqlite3` (`Import`, termasuk di dalam `FunctionDef`) dan nama dari `ImportFrom sqlite3 … connect`; cari `Call` `Attribute(value=Name(alias), attr="connect")` atau `Name(direct)`.
  - Helper `forbidden_tx_control(path)`: `keyword.arg in {"isolation_level", "autocommit"}` pada `Call` mana pun; `Assign/AugAssign` target `Attribute(attr in {...})`.
  - `PROD_FILES = sorted(ROOT.glob("*.py")) - ALLOWLIST` dengan `ALLOWLIST = {"merge_db.py", "fix_list_tasks.py"}` (komentar alasan).
  - `REMAINING = {"webapp.py": 29, "repository.py": 1, "bot.py": 1}` — ratchet: `test_sqlite_connect_only_in_dbconn_or_remaining`: untuk tiap file, jumlah `connect_calls` `== REMAINING.get(nama, 0)`, kecuali `dbconn.py` yang wajib `== 1`.
  - `test_no_isolation_level_or_autocommit_outside_dbconn`: `forbidden_tx_control` kosong untuk semua file kecuali `dbconn.py`.
  - `test_dbconn_callers_pass_explicit_path` (R1): di `webapp.py`, `repository.py`, `bot.py` setiap `Call` ke `dbconn.connect`/`dbconn.get_conn` punya `len(call.args) >= 1` (hari ini tidak ada pemanggil → lulus kosong; mulai bermakna Task 2).
- [ ] **Step 3: Jalankan → FAIL.** `python -m pytest tests/test_dbconn.py tests/test_dbconn_callsites.py -q` (`ModuleNotFoundError: dbconn`; ratchet `dbconn.py` tidak ada).
- [ ] **Step 4: Implementasi** `dbconn.py` sesuai Interfaces.
- [ ] **Step 5: Jalankan → PASS**, lalu `python -m pytest tests/ -q` (1250 + ±14 baru, 1 skipped). Jalankan `tests/test_dbconn.py` dua kali berturut-turut (tes konkurensi tidak boleh flaky).
- [ ] **Step 6: Commit** `feat(db): dbconn — satu pintu koneksi SQLite, get_conn, write_tx BEGIN IMMEDIATE`

### Task 2: `webapp.get_db` dan `_media_db_connect` → dbconn (2 titik)

**Files:**
- Modify: `webapp.py` (`import dbconn` dekat `import repository` ±145; `_media_db_connect` 183–188; `get_db` 295–308)
- Test: `tests/test_dbconn_callsites.py` (tambah bagian "webapp")

**Produces:**
- `webapp._media_db_connect()` → `return dbconn.connect(DB_PATH)` (R4; FK ON seperti sekarang; `media_worker`/`email_worker` tetap menerima `connect=_media_db_connect`).
- `webapp.get_db()` → fungsi biasa (tanpa `@contextmanager`) `return dbconn.get_conn(DB_PATH)` dengan docstring "DB_PATH dibaca saat dipanggil (monkeypatch tes)". `@contextmanager` hanya dipakai di `get_db` (`webapp.py:295`, satu-satunya pemakaian) → hapus `from contextlib import contextmanager` (`:27`) setelah diverifikasi grep.

- [ ] **Step 1: Tulis tes gagal** di `tests/test_dbconn_callsites.py`:
  - Turunkan ratchet `REMAINING["webapp.py"]` 29 → 27.
  - `test_get_db_connection_is_dbconn`: `with webapp.get_db() as c:` → `isolation_level == "IMMEDIATE"` (pembeda: hari ini `""`), `busy_timeout == 5000`, `foreign_keys == 1`, `journal_mode == "wal"`, `row_factory is sqlite3.Row`.
  - `test_get_db_reads_webapp_db_path_at_call_time(monkeypatch, tmp_path)`: `monkeypatch.setattr(webapp, "DB_PATH", str(tmp))`; `with webapp.get_db() as c: c.execute("CREATE TABLE tes_r1 (x)")`; buka `sqlite3.connect(tmp)` → tabel ada; `config.DB_PATH` tidak berubah dan tidak punya tabel itu.
  - `test_get_db_rollback_on_exception(tmp_path, monkeypatch)`: pola yang sama, INSERT lalu `raise ValueError` → tidak tersimpan.
  - `test_get_db_still_patchable`: `monkeypatch.setattr(webapp, "get_db", lambda: real())` (pola `tests/test_mindmap_live.py:138–144`) → `with webapp.get_db() as c` tetap bekerja.
  - `test_worker_connect_is_dbconn`: `c = webapp.media_worker._connect()` → `isolation_level == "IMMEDIATE"`, FK 1, busy 5000, Row; `webapp.email_worker._connect is webapp.media_worker._connect is webapp._media_db_connect`; tutup koneksi.
- [ ] **Step 2: Jalankan → FAIL** (`isolation_level` masih `""`; ratchet 29 ≠ 27).
- [ ] **Step 3: Implementasi** kedua fungsi; hapus badan lama; pertahankan nama fungsi dan tanda tangan.
- [ ] **Step 4: Jalankan → PASS**, lalu `python -m pytest tests/ -q` hijau (termasuk `tests/test_mindmap_live.py`, `tests/test_media_worker.py`, `tests/test_email_wiring.py`, `tests/test_note_media_lifecycle.py`).
- [ ] **Step 5: Commit** `refactor(db): webapp.get_db dan _media_db_connect lewat dbconn`

### Task 3: `migrate_db()` 27 koneksi → `dbconn.connect(DB_PATH, foreign_keys=False)` (K4)

**Files:**
- Modify: `webapp.py` `migrate_db` (355–1010)
- Test: `tests/test_migrate_fk.py` (baru), `tests/test_dbconn_callsites.py` (aturan `migrate_db`)

**Produces:**
- 26 blok: `conn = sqlite3.connect(DB_PATH)` [+ `conn.row_factory = sqlite3.Row`] → `conn = dbconn.connect(DB_PATH, foreign_keys=False)` (satu baris; `Row` otomatis — aman untuk 7 blok yang dulu tanpa `row_factory`: 591, 603, 623, 641, 658, 682, 892, lihat R3). Struktur `try/finally: conn.close()` dan `conn.commit()` tiap blok **tidak diubah**.
- Blok project 978: `conn = dbconn.connect(DB_PATH, foreign_keys=True)`; baris 981 `PRAGMA foreign_keys=ON` dibiarkan (R3).
- Blok 1004 (`_heal_broken_triggers`): `foreign_keys=False` seperti sekarang.
- `except sqlite3.OperationalError`/`IntegrityError` di blok 595, 607, 627, 634 tetap (`import sqlite3` di `webapp.py` tetap ada untuk kelas exception dan `sqlite3.Row`).

- [ ] **Step 1: Tulis tes gagal**:
  - `tests/test_dbconn_callsites.py`: ratchet `REMAINING["webapp.py"]` 27 → 0 (hapus kunci); `test_migrate_db_connects_without_fk_except_project_block`: ambil `FunctionDef migrate_db` dari AST `webapp.py`; kumpulkan `Call` `dbconn.connect`; **27** pemanggilan; setiap pemanggilan punya `keyword foreign_keys` bernilai `ast.Constant` bool; tepat **satu** `True`; semua memakai `Name("DB_PATH")` sebagai argumen pertama (R1).
  - `tests/test_migrate_fk.py::test_rebuild_drawings_keeps_child_rows_and_references(monkeypatch, tmp_path)`: buat DB lama: `CREATE TABLE drawings (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, note_id INTEGER, data_json TEXT NOT NULL DEFAULT '{}', created_at TEXT, updated_at TEXT)` (skema lama: tanpa `title`, ada `note_id` → memicu rebuild `webapp.py:534–567`), tabel anak sintetis `tes_anak_drawings (id INTEGER PRIMARY KEY, drawing_id INTEGER NOT NULL REFERENCES drawings(id) ON DELETE CASCADE)`, satu baris drawing (id 1, user_id 1) + satu baris anak; `monkeypatch.setattr(webapp, "DB_PATH", str(legacy))`; `webapp.migrate_db()` (seperti `tests/test_sync_audit_server.py:114–138`); asersi: `drawings` punya kolom `title` dan tanpa `note_id`; `COUNT(*) FROM tes_anak_drawings == 1`; `sql` tabel anak di `sqlite_master` memuat `REFERENCES drawings(` dan **tidak** memuat `drawings_old`; `PRAGMA foreign_key_check` kosong; `migrate_db()` kedua kali tidak melempar. Tambahkan docstring: tes ini **lulus di `main`** (FK memang OFF) — ia pagar agar migrasi ke `dbconn` tidak menyalakan FK (R3).
- [ ] **Step 2: Jalankan → FAIL** (`test_dbconn_callsites`: 0 pemanggilan `dbconn.connect` di `migrate_db`, ratchet). `test_migrate_fk` lulus — itu diharapkan.
- [ ] **Step 3: Implementasi** 27 penggantian (lakukan dengan hati-hati per blok, bukan `sed` buta: 7 blok tanpa `row_factory` hanya punya satu baris untuk diganti).
- [ ] **Step 4: Bukti pagar (mutasi sementara):** ubah blok `drawings` (528) menjadi `foreign_keys=True` → `tests/test_migrate_fk.py` **gagal** (anak terhapus / `drawings_old`) dan aturan AST gagal (dua `True`) → kembalikan.
- [ ] **Step 5: Jalankan → PASS**, lalu `python -m pytest tests/ -q` hijau (perhatikan `tests/test_sync_audit_server.py`, `tests/test_trigger_heal.py`, `tests/test_drawings.py`, `tests/test_contexts_schema.py`, `tests/test_projects_schema.py`, `tests/test_email_outbox.py`).
- [ ] **Step 6: Commit** `refactor(db): migrate_db memakai dbconn.connect tanpa FK (K4), blok project FK ON`

### Task 4: `TaskRepository._connect` → `dbconn.get_conn(self.db_path)` (1 titik)

**Files:**
- Modify: `repository.py` (`import dbconn`; `_connect` 623–636)
- Test: `tests/test_dbconn_callsites.py` (bagian "repository")

**Produces:** `_connect(self)` → `return dbconn.get_conn(self.db_path)` (bukan generator `@contextmanager` lagi; tetap dipakai `with self._connect() as conn:` di 90 tempat dan `with repo._connect() as conn:` di `bot.py`). `self.db_path` tetap atribut publik (dipakai Task 5).

- [ ] **Step 1: Tulis tes gagal**: ratchet `REMAINING["repository.py"]` 1 → 0; `test_repository_connect_is_dbconn(tmp_path)`: `repo = TaskRepository(str(tmp / "r.db"))` (menjalankan `_init_db` lewat dbconn) → `with repo._connect() as c:` `isolation_level == "IMMEDIATE"`, FK 1, busy 5000, Row; `test_repository_connect_rollback`: INSERT ke `users` lalu `raise ValueError` → tidak tersimpan; `test_repository_explicit_begin_immediate_still_works(tmp_path)`: `uid = repo.auto_register_telegram_user(1, "A")`, `lid = repo.create_shared_list("WS", uid)["id"]`, `repo.pin_workspace(uid, lid) == 0` dua kali (idempoten; jalur `BEGIN IMMEDIATE` eksplisit `repository.py:1833` di atas koneksi `IMMEDIATE`), `repo.unpin_workspace(uid, lid) is True`.
- [ ] **Step 2: Jalankan → FAIL** (`isolation_level == ""`; ratchet).
- [ ] **Step 3: Implementasi.**
- [ ] **Step 4: Jalankan → PASS**, lalu `python -m pytest tests/ -q` hijau (perhatikan `tests/test_workspace_pins_repo.py`, `tests/test_workspace_pin_order.py`, `tests/test_contexts_repo.py`, `tests/test_bot_invitations.py`, `tests/test_projects_tasks.py`).
- [ ] **Step 5: Commit** `refactor(db): TaskRepository._connect lewat dbconn.get_conn`

### Task 5: `bot.py` `/link <KODE>` → dbconn + perbaikan dua bug pra-ada (K5, R5)

**Files:**
- Modify: `bot.py` (`import dbconn` di blok import setelah `from repository import …` `:70`; `cmd_link` 308–346)
- Test: `tests/test_bot_link_token.py` (baru), `tests/test_dbconn_callsites.py` (ratchet `bot.py` 1 → 0)

**Produces:**
- Hapus `import sqlite3 as _sq` (310) dan `from datetime import datetime as _dt` (322; `datetime` sudah di-import di atas modul).
- `with dbconn.get_conn(repo.db_path) as conn:` menggantikan `conn = _sq.connect(db_path)` + `row_factory` + `try/finally: conn.close()`; `conn.commit()` manual dihapus (commit di akhir blok, termasuk saat `return` lebih awal; rollback bila exception).
- `exp = datetime.fromisoformat(row["expires_at"])`; `if exp < datetime.now(exp.tzinfo):` (aware ↔ aware untuk token tulisan `webapp.py:1917`; naif ↔ naif untuk token lama).
- Teks balasan **tidak berubah**.

- [ ] **Step 1: Tulis tes gagal** `tests/test_bot_link_token.py` (pola `tests/test_bot_invitations.py`: `SimpleNamespace` update/context, `asyncio.run(bot.cmd_link(update, ctx))`, `conftest.db()`):
  - `_web_user(client, name)`: `register_user` (conftest) → `{"user_id", "token"}`; `_link_token(client, jwt)`: `POST /api/auth/telegram-link-token` (`Authorization: Bearer`) → `token` 6 hex (format produksi).
  - `test_link_token_links_web_account(client)`: tg id acak; `ctx.args=[token.lower()]` (huruf kecil → `.upper()` di bot); balasan `startswith("✅ Berhasil!")`; `users.telegram_id` pengguna web `== tg`; baris `telegram_link_tokens` terhapus; `ctx.user_data["db_user_id"] == user_id`.
  - `test_link_token_expired(client)`: sisipkan baris `telegram_link_tokens` dengan `expires_at = (datetime.now(_TZ_JKT) - timedelta(minutes=1)).isoformat()` (format sama dengan webapp) → balasan `startswith("❌ Kode sudah expired")`; baris terhapus (commit lewat `get_conn` walau `return` lebih awal).
  - `test_link_token_invalid(client)`: kode `"ZZZZZZ"` → `"❌ Kode tidak valid…"`; `test_link_token_taken_by_other_telegram(client)`: pengguna web sudah `telegram_id` lain → `"❌ Akun ini sudah terhubung ke Telegram lain."` dan `telegram_id` tidak berubah.
  - Ratchet `REMAINING["bot.py"]` 1 → 0.
- [ ] **Step 2: Jalankan → FAIL** dengan `AttributeError: 'TaskRepository' object has no attribute '_db_path'` (bukti bug 1).
- [ ] **Step 3: Perbaiki `_db_path` → `dbconn.get_conn(repo.db_path)` saja** (belum menyentuh datetime) → jalankan → **FAIL** `TypeError: can't compare offset-naive and offset-aware datetimes` pada `test_link_token_links_web_account` (bukti bug 2, R5).
- [ ] **Step 4: Perbaiki perbandingan `expires_at`** → jalankan → **PASS**, lalu `python -m pytest tests/ -q` hijau (termasuk `tests/test_bot_escape.py`, `tests/test_bot_invitations.py`).
- [ ] **Step 5: Commit** `fix(bot): /link <KODE> — repo.db_path lewat dbconn, bandingkan expires_at ber-zona`

### Task 6: Pagar akhir — tidak ada `sqlite3.connect` di luar `dbconn.py`

**Files:**
- Test: `tests/test_dbconn_callsites.py`

- [ ] **Step 1:** hapus `REMAINING` dan ubah `test_sqlite_connect_only_in_dbconn_or_remaining` menjadi `test_sqlite_connect_only_in_dbconn`: untuk semua `PROD_FILES` kecuali `dbconn.py` → `connect_calls == []` dengan pesan gagal menyebut file:baris; `dbconn.py` → tepat 1. Tambah docstring modul tes: daftar allowlist + alasannya, cara menambah pengecualian (harus beralasan di PR), dan catatan bahwa `scripts/` tidak dipindai.
- [ ] **Step 2: Jalankan → PASS** (semua titik sudah dimigrasi). **Bukti pagar (mutasi sementara):** tambahkan `sqlite3.connect(":memory:")` di `bookmark.py` dan `import sqlite3 as _s; _s.connect(":memory:")` di dalam sebuah fungsi `ai_review.py` → tes gagal menyebut keduanya; tambahkan `isolation_level=None` ke pemanggilan di `dbconn.py` → tidak ditolak (dikecualikan), tetapi `tests/test_dbconn.py::test_connect_pragmas` gagal; kembalikan semuanya.
- [ ] **Step 3:** verifikasi manual `grep -rn "sqlite3.connect\|_sq.connect" --include=*.py . | grep -v "tests/\|temporary_files/\|venv/\|node_modules/\|scripts/\|draw-app/"` → hanya `dbconn.py`, `merge_db.py`, `fix_list_tasks.py`, dan docstring `review_history.py:4`.
- [ ] **Step 4:** `python -m pytest tests/ -q` hijau. **Commit** `test(db): pagar — sqlite3.connect hanya di dbconn.py`

### Task 7: Dokumen — ADR-038, salinan spec dan rencana

**Files:**
- Modify: `.agents/DECISIONS.md` (ADR-038 setelah ADR-037, format ADR-036/037: Date / Agent / Context / Decision / Consequences)
- Create: `docs/superpowers/specs/2026-10-31-plugin-fase0b-design.md` (salinan spec + deviasi), `docs/superpowers/plans/2026-10-31-plugin-fase0b-pr-a-dbconn.md` (rencana ini)
- Modify (Project claude.ai, lewat `project_write`, isi harus sama dengan salinan repo): `claude/spec-plugin-fase0b-2026-10-31.md`

**ADR-038 — "dbconn: satu jalur koneksi SQLite + `write_tx` BEGIN IMMEDIATE"** (ringkasan isi):
- **Context:** 31 titik `sqlite3.connect` tersebar (`get_db`, `_connect`, `_media_db_connect`, 27 blok `migrate_db`, `bot.py`) dengan pragma yang diulang dan tidak seragam (26 koneksi migrasi tanpa pragma); PR B menambah kode plugin server yang berjalan di threadpool sehingga penulisan benar-benar paralel dengan SQL di event loop; pola baca-lalu-tulis dengan transaksi deferred gagal seketika `SQLITE_BUSY_SNAPSHOT` atau kehilangan pembaruan tanpa error (diverifikasi). Bug pra-ada `/link` (`repo._db_path`, `TypeError` zona waktu).
- **Decision:** (1) `dbconn.py` satu-satunya tempat `sqlite3.connect`; pragma standar `busy_timeout=5000` eksplisit, WAL, FK sesuai parameter; `isolation_level="IMMEDIATE"` legacy, `autocommit` tidak disentuh. (2) `get_conn(path)` = semantik `get_db`; `webapp.get_db()` dan `TaskRepository._connect` jadi pembungkus; path selalu eksplisit dan dibaca saat dipanggil. (3) `write_tx(conn)` wajib untuk kode **baru** yang membaca lalu menulis; kode lama tidak di-refactor. (4) `migrate_db` tetap FK OFF kecuali blok project (rebuild tabel dengan FK ON menghapus anak dan menulis ulang `REFERENCES` ke `x_old`). (5) Pagar AST di tes. (6) Rilis tanpa versi SW; deploy butuh restart manual `taskflow-web` + `taskflow`.
- **Consequences:** jejak SQL endpoint lama identik kecuali `BEGIN` → `BEGIN IMMEDIATE`; kode plugin memakai `host.get_conn()`/`host.write_tx` (PR B, ADR-039); menambah koneksi di luar `dbconn` gagal di CI; `scripts/` dan dua skrip sekali jalan tetap di luar pagar; audit menyeluruh kursor-terbuka-lalu-tulis dan konversi endpoint ke `def` tetap di luar cakupan (spec §12).

**Deviasi yang dicatat di kedua salinan spec** (tambahkan subbagian "Catatan implementasi PR A (2026-10-31)" di §2 setelah tabel, dan sesuaikan §4.2 serta §10): R1 (`connect(path=None, *, foreign_keys=True, row_factory=sqlite3.Row)`, `default_path()`), R4 (`_media_db_connect` fungsi bernama), R5 (bug kedua `/link`), R7 (ADR-038 = PR A, PR B = ADR-039), nama file plan PR A.

- [ ] **Step 1:** tulis ADR-038; salin spec (`cp` dari `/home/claude/alurik-specs/spec-plugin-fase0b-2026-10-31.md`, normalisasi CRLF bila ada) + subbagian deviasi; salin rencana; `project_write` spec yang sudah diperbarui ke Project (`diff` kedua salinan kosong, seperti pasangan Fase 0a yang identik).
- [ ] **Step 2:** `python -m pytest tests/ -q` hijau; `git diff --stat origin/main -- static/` kosong.
- [ ] **Step 3: Commit** `docs(db): ADR-038 dbconn; spec + plan Fase 0b PR A`

### Task 8: Verifikasi akhir, handover, review, PR draft

**Files:** `.agents/CURRENT_STATE.md` (entri baru paling atas), `.agents/SESSION_LOG.md` (entri baru di bawah judul, format PROTOCOL §3.2)

- [ ] **Step 1: Verifikasi** dan catat angkanya:
  - `python -m pytest tests/ -q` → 1250 lama + semua tes baru lulus, 1 skipped; jalankan `tests/test_dbconn.py` 3× berturut-turut (tanpa flake).
  - `git diff --stat origin/main -- tests/` hanya file baru (R10); `git diff --stat origin/main -- static/ package.json compile.js` kosong; `git diff --stat origin/main` menyebut `dbconn.py`, `webapp.py`, `repository.py`, `bot.py`, `.agents/*`, `docs/*`, `tests/*` saja.
  - Asap nyata: `DB_PATH=/tmp/asap.db venv/bin/python -c "import webapp; webapp.migrate_db(); webapp.migrate_db(); print('ok')"` (perintah yang sama dengan `deploy.yml`) dan `DB_PATH=/tmp/asap.db venv/bin/python -c "import bot; print(bot.repo.db_path)"` (bot bisa di-import; `TELEGRAM_BOT_TOKEN` kosong tidak masalah untuk import) — pakai `python3` sistem bila venv lokal tidak lengkap.
- [ ] **Step 2: Handover** `.agents/CURRENT_STATE.md` — entri `## 🟡 Plugin Fase 0b — PR A fondasi koneksi DB (dbconn.py) — claude/dbconn — 2026-10-31 (Claude) — PR DRAFT, menunggu "merge dan deploy"` berisi: spec/plan/ADR; isi (31 titik, `write_tx`, pagar, bug `/link` ×2); rilis: **tanpa SW bump/whatsnew**, server saja; **deploy: workflow menjalankan `migrate_db()` tetapi TIDAK me-restart → Bapak wajib `sudo systemctl restart taskflow-web taskflow` setelah deploy sukses** (bot memuat `repository.py`/`bot.py` baru; proses lama tetap berjalan dengan kode lama sampai restart, tidak ada jendela bahaya); pantau `journalctl -u taskflow-web -u taskflow -f | grep -i "database is locked"` ±1 hari sebelum PR B (spec §10); rollback = revert PR (deploy otomatis) + restart dua layanan, tanpa perubahan data/skema; verifikasi angka tes; tindak lanjut di luar cakupan: jalur token `/link` tidak memindahkan task dari `tg_<id>` (R5), `scripts/dedup_drawings.py` belum lewat dbconn, `PRAGMA foreign_keys=OFF` `webapp.py:6248` no-op pra-ada (spec §12), audit kursor-terbuka-lalu-tulis; **Berikutnya:** PR B (`claude/plugin-fase0b`: `plugin_loader`, `plugin_host`, `plugin_states`, `TF.pluginstate`, `TF.api.fetch`, ADR-039, SW v490). Tambahkan entri `SESSION_LOG.md`.
- [ ] **Step 3: Commit** `docs(agents): handover PR A dbconn`
- [ ] **Step 4: Review akhir oleh subagen reviewer terpisah** (Review Focus 1–5; khusus: cek 27 blok `migrate_db` satu per satu bahwa `try/finally`/`commit` tidak bergeser, `webapp.get_db` tanpa `@contextmanager` tetapi dipakai `with`, tidak ada import `sqlite3` yang dihapus padahal masih dipakai untuk exception/`Row`). Perbaiki temuan wajib, jalankan ulang Step 1.
- [ ] **Step 5: Push + PR draft** judul `Plugin Fase 0b — PR A: fondasi koneksi DB (dbconn.py)`; body: ringkasan, tabel 31 titik, dua bug `/link`, **catatan deploy restart manual**, rollback, angka tes; akhiri dengan atribusi yang berlaku di sesi. Merge hanya setelah Bapak bilang "merge dan deploy"; setelah deploy sukses, ingatkan restart dua layanan.
