# Sistem Plugin Fase 0b — PR B: loader server, status plugin per akun, `TF.api.fetch` — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Status ON/OFF plugin pindah dari perangkat ke akun (tabel `plugin_states`, tetap bisa diubah offline lewat outbox, tersinkron ke perangkat lain), jalur server untuk plugin disiapkan (`plugin_loader.py` dipakai web + bot, fasad `plugin_host.py`, `ensure_schema`, router `/api/plugins/<id>/…` dengan login + cek aktif, dibuktikan plugin contoh khusus tes), dan plugin berizin `network` mendapat `api.fetch` ke rute server miliknya sendiri. Tambahan kecil yang disetujui pemilik: error handler bot supaya `telegram.error.NetworkError` sesaat tercatat satu baris WARNING tanpa traceback. Tidak ada plugin baru yang terlihat pengguna; yang terasa hanya "plugin yang kunyalakan ikut ke perangkat lain".

**Architecture:** Server: `plugin_states.py` (skema + query LWW + router host `GET /api/plugins/state`, `PUT /api/plugins/state/{plugin_id}`, semua `def` + `dbconn.write_tx`), `plugin_host.py` (fasad `HOST_API = 1`: `current_user`, `get_conn`, `write_tx`, `now_utc`, `allow_async`; diisi `bind()` oleh web/bot), `plugin_loader.py` (baca `static/plugins/index.json` → daftar id dikenal, pindai `plugins/<id>.py`, tolak simbol tertunda/endpoint coroutine/router ber-prefix, `migrate()` = skema `plugin_states` + `ensure_schema` plugin per `write_tx` dengan pagar nama `plg_<id_>_`, `mount()` dengan `Depends(current_user)` + `Depends(require_plugin_enabled(id))`, `load_for_bot()` tanpa DDL). Klien: modul baru `static/offline/pluginstate.js` (`TF.pluginstate`) satu-satunya penulis cache `_meta plugins:state:v1`; toggle = satu transaksi IndexedDB `_meta` + `_outbox` dengan satu op `plugin_state/set` per plugin (coalescing); pull di `sync()` sebelum `pushOutbox` (op tertunda menang, lebur pertama Q1a); cabang `opPluginStateSet` di `syncpush`; runtime memakai status akun ∧ ¬peredaman lokal (error = padam hanya di perangkat itu); `TF.api.fetch` lewat `api.fetch` host (`network: true`) yang disuntik `bindHost`.

**Tech Stack:** Python 3.12 (CI `test.yml`, venv produksi 3.12.3; lokal 3.13 juga harus lulus), FastAPI 0.115 (`APIRouter`, `Depends`), pydantic v2 (`StrictBool`), `sqlite3` lewat `dbconn` (ADR-038), python-telegram-bot 21.11 (`Application.add_error_handler`, `telegram.error.NetworkError`), pytest; klien UMD tanpa bundler (`static/offline/*.js`), `node --test` + `fake-indexeddb` (`tests/offline/setup.js`), Babel classic (`compile.js`), Playwright (E2E manual, tidak di CI). Tidak ada dependensi baru.

**Spec:** `docs/superpowers/specs/2026-10-31-plugin-fase0b-design.md` (salinan Project claude.ai `claude/spec-plugin-fase0b-2026-10-31.md`; disetujui pemilik 2026-10-31 — Q1 (a) keputusan terbaru menang, Q2 metrik Heatmap tetap per perangkat, Q3 teks disetujui, Q4 dua PR). PR B mencakup §2 K6–K18, §4.1 (baris loader/host/states/templat/fixture), §4.4–§4.5, §5, §6, §7, §8, §9.1 baris 5–6, §9.2, §9.3, §10 "PR B", §11 baris 2–5. Juga: `docs/plugins/README.md`, ADR-037/038, `.agents/PROTOCOL.md` §4.

**Branch:** `claude/plugin-fase0b` dari `main` ≥ `33dda23b` (berisi PR A `dbconn.py`, merge `41f26da1`; SW `taskflow-v489-heatmap-rapi`, `app.css?v=382`, IndexedDB `taskflow-offline` v6, `index.html` 46.092 baris, 80 modul `static/offline/`). Baseline (dijalankan 2026-10-31 18.10 WIB di `main` 33dda23b, Python 3.13.18 / pytest 9.1.1 / FastAPI 0.115.14 / PTB 21.11.1; `venv/` lokal tanpa pytest → pakai `python3`): `python3 -m pytest tests/ -q` → **1284 passed, 1 skipped** (103 s); `npm test` → **3592/3593** (gagal pra-ada: `Unified Offline Drawing Reactivity - Local Event Reactivity`, `draw_local_reactive`); `node --test tests/build-plugins.test.js` → **8/8**.

## Peta perubahan

| File | Status | Isi (Task) |
|---|---|---|
| `plugin_states.py` | baru (~170 baris) | skema, `parse_ts`/`iso`, `get_states`, `effective_enabled`, `put_state` (LWW), `router` host (T1, T4) |
| `plugin_host.py` | baru (~70 baris) | fasad K8 (T2) |
| `plugin_loader.py` | baru (~240 baris) | indeks, discover, `migrate`, `health`, `require_plugin_enabled`, `mount`, `init_web`, `load_for_bot` (T2, T3) |
| `plugins/_template.py` | baru | templat modul server, dilewati loader (T2) |
| `tests/fixtures/plugins/{demo-server.py,_skip.py,index.json}` | baru | plugin contoh khusus tes (K18) (T2) |
| `webapp.py` | ubah | `import plugin_host, plugin_loader, plugin_states`; satu baris `plugin_loader.migrate(DB_PATH)` di `migrate_db` setelah blok project (`:946–968`) dan sebelum blok heal (`:971`); `bind` + `include_router(plugin_states.router)` + `init_web(app)` sebelum `if __name__` (`:10803`) (T4) |
| `bot.py` | ubah | `on_error` + `app.add_error_handler(on_error)`; `plugin_host.bind` + `plugin_loader.load_for_bot(app)` di `main()` (`:2805`) (T5) |
| `compile.js` | ubah | lint `fetch` berbasis izin, id `state`/pola id ditolak (T6) |
| `static/offline/pluginstate.js` | baru (~260 baris) | `TF.pluginstate` (T7) |
| `static/offline/syncpush.js` | ubah | cabang `plugin_state/set` → `opPluginStateSet` (T8) |
| `static/plugin-runtime.js` | ubah | izin `network`, status akun, peredaman lokal, `reloadState`, `knownIds`, `bindHost` (T9); `api.fetch` + `PluginNetworkError` (T10) |
| `static/index.html` | ubah (≤ 60 baris bersih) | `<script>` `pluginstate.js`, langkah pull di `sync()`, `bindHost` + `fetch/isOfflineErr/pushNow`, kartu Pengaturan (T11); versi SW (T12) |
| `static/sw.js`, `static/whatsnew.json` | ubah | `STATIC` += `pluginstate.js` (T11); `CACHE` v490, entri whatsnew (T12) |
| `docs/plugins/README.md`, `.agents/DECISIONS.md`, spec, plan | ubah/baru | §Server, `api.fetch`, status akun; ADR-039 (T12) |
| `temporary_files/e2e_plugin_fase0b.py` | baru | E2E dua perangkat (T13) |

## Keputusan rencana (controller)

- **R1 — `migrate_db` tidak menambah `dbconn.connect`.** Spec K10 menaruh `ensure_schema` "setelah `email_outbox.ensure_schema` pada koneksi FK OFF", tetapi di `main` `email_outbox.ensure_schema` (`webapp.py:966`) berada di **blok project yang FK ON** (`:946`, pengecualian K4), dan pagar PR A `tests/test_dbconn_callsites.py::test_migrate_db_connects_without_fk_except_project_block` mengunci tepat 27 `dbconn.connect` di `migrate_db`. Maka `migrate_db` mendapat **satu baris** `plugin_loader.migrate(DB_PATH)` setelah blok project (sebelum blok heal "Terakhir"); `plugin_loader.migrate` membuka koneksinya sendiri `dbconn.connect(db_path, foreign_keys=False)`, menjalankan `plugin_states.ensure_schema` lalu `ensure_schema` tiap plugin, masing-masing dalam `write_tx`, dan **tidak pernah melempar** (gagal → log + health). Tes PR A tidak diubah.
- **R2 — `plugin_host.current_user` = `async def current_user(request: Request) -> dict`** yang `return await _bound_current_user(request)`. `webapp.get_current_user` (`:1158`) adalah `async def` (memanggil `_resolve_user`); fungsi tingkat-modul yang stabil membuat cache dependency FastAPI bekerja (sekali per request walau dipakai router + endpoint, K8). Yang wajib `def` (K9) adalah `require_plugin_enabled` dan endpoint plugin. Di bot `current_user` tidak di-bind → memanggilnya `RuntimeError("plugin_host belum di-bind (current_user)")`.
- **R3 — pagar `ensure_schema` per objek, bukan `PRAGMA foreign_key_check` seluruh DB.** Spec K10 menyebut `PRAGMA foreign_key_check` di akhir; tanpa argumen pragma itu memeriksa **semua** tabel → satu pelanggaran FK pra-ada di DB produksi akan membuat setiap plugin "gagal". Loader memotret `{(type, name): sql}` `sqlite_master` (lewati nama `sqlite_%`) sebelum/sesudah `ensure_schema` di dalam `write_tx`: objek baru/berubah/hilang yang namanya tidak berawalan `plg_<id_>_` (`id_` = id dengan `-` → `_`) = pelanggaran (menangkap juga `ALTER`/`DROP` tabel host); lalu `PRAGMA foreign_key_check("<tabel plg_ baru/berubah>")` per tabel. Pelanggaran atau exception → rollback (keluar dari `write_tx` dengan exception), health `"schema_failed"`, log `ERROR` satu baris berisi id + alasan.
- **R4 — siklus import.** `plugin_states` meng-import `plugin_host` dan `plugin_loader` di tingkat modul; `plugin_loader` meng-import `plugin_host` dan `dbconn` di tingkat modul dan `plugin_states` **di dalam fungsi** (`migrate`, `require_plugin_enabled`). `plugin_host` hanya meng-import `dbconn` + fastapi. Tak satu pun meng-import `webapp`/`repository`/`bot`.
- **R5 — modul plugin didaftarkan di `sys.modules["alurik_plugins.<id_>"]`** sebelum `exec_module` (pydantic/`from __future__ import annotations` di plugin butuh modulnya ada di `sys.modules`); dihapus lagi bila import/validasi gagal. Import dibungkus `except BaseException` kecuali `KeyboardInterrupt`/`SystemExit` (spec §4.4 langkah 3; `SystemExit` dari plugin dicatat sebagai penolakan, bukan diteruskan — K: satu plugin tidak menjatuhkan proses).
- **R6 — pesan simbol tertunda (K7):** `on_task_written` → `"on_task_written belum didukung (Fase 1)"`; `jobs`, `register_bot`, `intake` → `"<nama> belum didukung (ditunda, Lampiran B)"` (spec Fase 0a §3 baris "ditunda"; belum ada fase bernomor).
- **R7 — token clipper (`scope == "ext"`) ditolak juga di `GET/PUT /api/plugins/state`** dengan 403 `{"detail": {"code": "PLUGIN_FORBIDDEN_TOKEN"}}` (spec hanya menyebutnya untuk rute plugin; token clipper tidak semestinya mengubah status plugin akun). Klien menganggap 403 permanen (R9).
- **R8 — validasi body PUT memakai `StrictBool`** (`enabled: "ya"` → 422, pydantic lax akan mengubahnya jadi `True`); "dikirim" dibedakan dari "tidak dikirim" lewat `model_fields_set` (`enabled: null` = kembali ke default, sah). Urutan: 401 → 403 ext → 404 `PLUGIN_UNKNOWN` (id tidak cocok pola / bukan di indeks / `state`) → 503 `PLUGIN_UNAVAILABLE` bila indeks tidak sehat → 422. (FastAPI memvalidasi body sebelum badan fungsi: id asing dengan body rusak menjawab 422 — diterima.) Waktu disimpan `iso(dt)` = UTC `isoformat(timespec="milliseconds")` ber-offset `+00:00`; dibandingkan sebagai `datetime`; sama persis → diterapkan (idempoten).
- **R9 — klien: kegagalan permanen PUT memakai `dropOp`, bukan `failPermanent`.** `failPermanent(null, …)` (spec §6.2) hanya menghapus op dan meninggalkan `dirty: true` di cache selamanya. `opPluginStateSet`: 2xx → `ackPushed`; 404 ber-`detail.code === "PLUGIN_UNKNOWN"` → `dropOp` (tidak dihitung gagal); 404 lain → op tetap (jendela deploy, K14); 400/403/409/422/4xx lain → `dropOp` + `result.failed++`; 401/429/5xx/jaringan → dilempar `send` (perilaku drain yang ada). "Menunggu sinkron" = **ada op** untuk plugin itu (sumber kebenaran), `dirty` hanya penanda informatif yang ikut dibersihkan.
- **R10 — lebur pertama hanya untuk cache tanpa pemilik.** `db.clearAll` (`db.js:128–149`) menelan error dan mengembalikan `null`; bila gagal, cache pengguna sebelumnya tertinggal dengan `owner` = pengguna lama. Aturan `pull`: `owner` **tidak ada** (cache Fase 0a) → lebur OR + Q1a (K15); `owner` ada tetapi **berbeda** dari `userId` → buang cache dan op `plugin_state` lama, adopsi server persis (tidak pernah membawa status akun lain); `owner === userId` → aturan normal. Selalu tulis `owner = String(userId)`.
- **R11 — op lebur dan coalescing.** Payload op = `{plugin_id, enabled?, settings?, updated_at}`; field yang tidak diubah **tidak dikirim** (0b tidak pernah mengirim `settings`). Coalescing: op lama plugin yang sama dihapus dan payload-nya digabung (field baru menang, `updated_at` baru) ke op baru (qid baru = urutan terakhir). Lebur pertama memakai `updated_at = entry.updatedAt` asli 0a (K15); `updatedAt` tak terbaca → `"1970-01-01T00:00:00.000Z"` (kalah dari keputusan server mana pun).
- **R12 — notifikasi perubahan:** `TF.pluginstate.subscribe(fn) → off` (bekerja di Node dan browser) **dan** `window` event `tf:plugin-state {ids}`; runtime memakai `subscribe`. Tab lain di browser yang sama tidak menerima notifikasi seketika (melihatnya setelah pull/reload berikutnya) — dicatat di README, tidak diselesaikan di 0b.
- **R13 — runtime menyimpan salinan sinkron** `{state, pending:Set, suppressed}` dari `TF.pluginstate.snapshot()` (satu transaksi baca `_meta` + `_outbox`) karena `list()`/`isEnabled()` sinkron. `setEnabled` memperbarui salinan seketika (optimistis), lalu `setLocal`; `reloadState()` menyelaraskan. Fallback bila `TF.pluginstate` tidak ada (modul lama di cache SW): perilaku 0a (`persistState`).
- **R14 — "Aktifkan lagi" = `setEnabled(id, true)`** (kartu tidak berubah): `setEnabled(…, true)` selalu `unsuppress`, mereset hitungan error, dan menulis `setLocal` (keputusan eksplisit pengguna, waktu sekarang). Peredaman dihapus juga saat `init`/`reloadState` bila `hash` indeks plugin ≠ `hash` tersimpan. Gagal `load` tetap penanda sesi (tidak diredam, seperti 0a).
- **R15 — lint `compile.js`:** `LINT_RE` tanpa `fetch\(`; aturan fetch terpisah: `(?<![\w$.])fetch\s*\(` (fetch polos) dan `\b(?:window|self|globalThis)\s*\.\s*fetch\b` selalu ditolak; `\.\s*fetch\s*\(` hanya boleh bila `manifest.permissions` memuat `"network"`. `buildOne` juga menolak id yang tidak cocok `^[a-z][a-z0-9-]{2,31}$` atau sama dengan `state` (folder `plugins/state/` → build gagal). `LINT_RE` tetap diekspor.
- **R16 — anggaran `index.html`:** `tests/offline/plugin_host_wiring.test.js` memakai `BASELINE_LINES = 46049` (sebelum Fase 0a); `main` sudah 46.092 (+43). Spec kriteria 10 = +≤ 60 baris **untuk 0b** → baseline dinaikkan ke **46092** (jumlah `\n` di `main` 33dda23b) dengan komentar "baseline Fase 0b"; batas tetap 60.
- **R17 — tes lama yang asersinya berubah karena spec (hanya ini):** izin dicadangkan contoh `"network"` → `"records"` di `plugin_registry.test.js:38`, `:50`, `plugin_loader.test.js:92` (+ regex toast `:100` `/network/` → `/records/`), `plugin_failure.test.js:145`; `plugin_registry.test.js:36` `KNOWN_PERMISSIONS` → `["storage", "network"]`; auto-OFF = peredaman lokal di `plugin_failure.test.js:35`, `:111`, `plugin_loader.test.js:98` (asersi `_meta plugins:state:v1 … enabled === false` → `plugins:suppressed:v1[id].reason` + status akun tidak berubah); `plugin_settings_ui.test.js:38` subjudul; `plugin_host_wiring.test.js:14` baseline (R16). Semua tes Python lama tidak disentuh.
- **R18 — error handler bot:** `async def on_error(update, context) -> None` tingkat-modul di `bot.py`: `isinstance(context.error, telegram.error.NetworkError)` (termasuk `TimedOut`) → `logger.warning("Telegram: gangguan jaringan sesaat (%s: %s)", type(err).__name__, err)` (tanpa `exc_info`); selain itu `logger.error("Error saat memproses update %s", _update_id(update), exc_info=err)`. Didaftarkan `app.add_error_handler(on_error)` di `main()`. PTB 21 meneruskan error polling `getUpdates` ke error handler (`Application.run_polling` → `error_callback` → `process_error`), jadi `httpx.ReadError` saat polling ikut jadi WARNING satu baris.
- **R19 — versi:** SW `taskflow-v490-plugin-akun`; bila `main` maju, nomor berikutnya mengikuti PROTOCOL §4 butir 4. ADR-039. Rencana ini disalin ke `docs/superpowers/plans/2026-10-31-plugin-fase0b-pr-b.md`; spec repo + Project mendapat subbagian "Catatan implementasi PR B" (R1–R18 yang menyimpang dari teks).

## Global Constraints

- IndexedDB tetap `taskflow-offline` v6 (tanpa store/index baru: `_outbox` dipindai kursor); `app.css?v=382` tidak berubah; `index.html` +≤ 60 baris bersih dari 46.092 (R16); `TF.api.apiVersion` tetap `1`.
- Semua endpoint **baru** `def` (bukan `async def`) dan semua baca-lalu-tulis baru di dalam `dbconn.write_tx`; 213 endpoint lama tidak diubah. Modul baru tidak memanggil `sqlite3.connect` (pagar AST PR A memindai akar + `plugins/*.py`); `plugin_host.get_conn()` → `dbconn.get_conn(<path ter-bind>)`.
- Kode error persis: `PLUGIN_UNKNOWN` (404), `PLUGIN_DISABLED` (403), `PLUGIN_FORBIDDEN_TOKEN` (403), `PLUGIN_UNAVAILABLE` (503), dalam `{"detail": {"code": …, "plugin_id"?: …}}`.
- Pola id `^[a-z][a-z0-9-]{2,31}$`; id `state` dicadangkan; objek DB plugin berawalan `plg_<id dengan - → _>_`; `settings` ≤ 16 KB (16384 byte UTF-8 `json.dumps(…, separators=(",", ":"), ensure_ascii=False)`); body `api.fetch` ≤ 256 KB; timeout `api.fetch` 15000 ms; tunggu `pushNow` maks 5000 ms.
- Kunci `_meta`: `plugins:state:v1` (bentuk 0a kompatibel `{[id]: {enabled, updatedAt, settings?, dirty?}}`), `plugins:state:owner:v1`, `plugins:suppressed:v1` (`{[id]: {reason, hash, at}}`). Op outbox `{entity_type: "plugin_state", op: "set", cid: <plugin_id>, payload}`.
- Teks UI persis (Q3): subjudul `"Fitur opsional. Pilihanmu tersimpan di akun dan berlaku di semua perangkat."`, `"Menunggu sinkron"`, `"Dimatikan di perangkat ini karena error"`; label izin `network` `"Butuh koneksi internet untuk sebagian fitur"`; `storage` tetap `"Menyimpan pengaturan di perangkat ini"`; error offline `api.fetch` `"Butuh koneksi internet"`. Toast tidak berubah.
- `plugin.js` tetap dilarang `fetch(` polos, `window|self|globalThis.fetch`, `localStorage`, `indexedDB`, dst.; `.fetch(` hanya dengan izin `network` (R15).
- Pesan log loader: `"plugin server: N dimuat, M ditolak"` (web dan bot); loader/migrasi/plugin rusak tidak pernah menjatuhkan web, bot, maupun `migrate_db` (`deploy.yml` menjalankannya dengan `set -e`).
- Setelah setiap task: `python3 -m pytest tests/ -q` hijau (1284 lama + baru, 1 skip) dan, untuk task klien, `npm test` (hanya gagal pra-ada `draw_local_reactive`).
- Commit: `feat(plugin)`, `feat(bot)`, `test(plugin)`, `docs(plugin)`, `chore(release)`; ikuti aturan atribusi commit/PR sesi. Rilis mengikuti PROTOCOL §4.

## Review Focus

1. **Toggle saat push sedang berjalan** — pengguna mematikan plugin ketika op ON-nya sedang di-PUT: `ackPushed` dari respons ON tidak boleh menimpa niat OFF yang lebih baru di cache, dan op OFF tetap terkirim (tes `ackPushed` dengan op lebih baru di T7, op ter-coalesce dilewati di T8).
2. **Jam perangkat salah** — HP dengan jam +1 hari tidak boleh selalu menang (dipotong ke waktu server), jam mundur hanya membuat perangkat itu kalah (tes `test_put_future_clipped`, `test_put_older_not_applied` di T1).
3. **Jendela deploy** — file statis baru sudah tersaji, proses web lama belum restart: `GET /api/plugins/state` 404 tidak memutus `sync()` dan `PUT` 404 generik tidak membuang toggle (tes `syncpush_pluginstate` "404 generik tetap" di T8, langkah pull terisolasi di T11, skenario E2E 3 di T13).
4. **Ganti akun di perangkat yang sama, termasuk saat `clearAll` gagal** — status plugin akun A tidak pernah terbawa ke akun B (R10; tes "owner berbeda → adopsi server, op lama dibuang" di T7, E2E 4).
5. **Plugin error di satu perangkat** — padam hanya di perangkat itu, tidak menyala lagi oleh pull, menyala lagi oleh "Aktifkan lagi" atau versi plugin baru (hash), dan perangkat lain tetap ON (tes T9 + E2E 5).

---

### Task 1: `plugin_states.py` — skema, LWW, query (tanpa HTTP)

**Files:**
- Create: `plugin_states.py`
- Test: `tests/test_plugin_states.py` (bagian unit; DB `tmp_path` lewat `dbconn.connect`)

**Interfaces (Produces):**
- `ID_RE = re.compile(r"^[a-z][a-z0-9-]{2,31}$")`, `RESERVED_IDS = frozenset({"state"})`, `SETTINGS_MAX_BYTES = 16 * 1024`, `SCOPE_USER = "user"`.
- `ensure_schema(conn) -> None` — DDL §4.5 persis (`CREATE TABLE IF NOT EXISTS plugin_states …`), tanpa commit.
- `parse_ts(value: str) -> datetime` — `datetime.fromisoformat` (terima akhiran `Z`); tanpa zona → UTC; hasil aware UTC; tak terbaca → `ValueError`.
- `iso(dt: datetime) -> str` — `dt.astimezone(timezone.utc).isoformat(timespec="milliseconds")` (contoh `2026-11-01T10:05:00.000+00:00`).
- `row_to_state(row) -> dict` → `{"enabled": True|False|None, "settings": dict, "updated_at": str}`.
- `get_states(conn, user_id: int) -> dict[str, dict]` — hanya `scope='user'`.
- `effective_enabled(conn, user_id: int, plugin_id: str, default_enabled: bool) -> bool` — `enabled` baris bila bukan NULL, selain itu `default_enabled`.
- `put_state(conn, user_id: int, plugin_id: str, *, fields: dict, updated_at: datetime | None, now: datetime) -> tuple[bool, dict]` — membuka `dbconn.write_tx(conn)` sendiri; `fields` ⊆ `{"enabled", "settings"}` (hanya yang dikirim); `incoming = min(updated_at or now, now)`; baris ada dan `parse_ts(baris.updated_at) > incoming` → `(False, row_to_state(baris))` tanpa menulis; selain itu upsert hanya kolom di `fields` (baris baru: `enabled` NULL bila tidak dikirim, `settings` `'{}'`), `updated_at = iso(incoming)` → `(True, state_baru)`.

- [ ] **Step 1: Tulis tes gagal** (fixture `conn` = `dbconn.connect(tmp/"p.db")` + `CREATE TABLE users (id INTEGER PRIMARY KEY)` + 2 pengguna + `ensure_schema`):
  - `test_ensure_schema_idempotent`: dua kali tanpa error; `PRAGMA table_info(plugin_states)` = 6 kolom urut spec; PK `(user_id, plugin_id, scope)`.
  - `test_put_creates_then_updates`: `put_state(..., fields={"enabled": True}, updated_at=T0, now=T0+1m)` → `(True, {"enabled": True, "settings": {}, "updated_at": iso(T0)})`; lalu `{"enabled": False}` di `T0+30s` → applied, `enabled False`.
  - `test_put_older_not_applied`: baris `T0+5m`, kiriman `T0` → `(False, state baris)`, DB tidak berubah.
  - `test_put_equal_time_is_idempotent`: kiriman identik dua kali → keduanya `applied True`, satu baris.
  - `test_put_future_clipped`: `updated_at = now + 1 hari` → tersimpan `iso(now)`; kiriman berikut `now + 1 s` (dari perangkat lain, `now2 = now + 2 s`) tetap menang.
  - `test_put_partial_fields`: kirim `settings={"a": 1}` saja pada baris `enabled True` → `enabled` tetap `True`; kirim `enabled=None` → kolom NULL; `effective_enabled(..., default_enabled=True)` → `True`, `False` → `False`.
  - `test_get_states_isolated_per_user_and_scope`: baris `scope='workspace'` (sisip manual) tidak ikut; pengguna 2 tidak melihat milik pengguna 1.
  - `test_parse_ts`: `"2026-11-01T10:05:00Z"`, `"2026-11-01T17:05:00+07:00"` sama; naif = UTC; `"kemarin"` → `ValueError`.
  - `test_cascade_on_user_delete`: koneksi FK ON, `DELETE FROM users WHERE id=1` → baris plugin pengguna 1 hilang.
  - `test_put_state_uses_write_tx`: `set_trace_callback` → jejak dimulai `BEGIN IMMEDIATE` sebelum SELECT; `put_state` pada koneksi dengan transaksi terbuka → `RuntimeError` (dari `write_tx`).
- [ ] **Step 2: Jalankan → FAIL** `python3 -m pytest tests/test_plugin_states.py -q` (`ModuleNotFoundError: plugin_states`).
- [ ] **Step 3: Implementasi** fungsi di atas (router menyusul di Task 4; `router = APIRouter()` boleh sudah dideklarasikan kosong).
- [ ] **Step 4: Jalankan → PASS**, lalu `python3 -m pytest tests/ -q` hijau.
- [ ] **Step 5: Commit** `feat(plugin): plugin_states — skema per pengguna dan last-write-wins`

### Task 2: `plugin_host.py` + `plugin_loader.py` (indeks, discover, migrate/health) + templat + fixture

**Files:**
- Create: `plugin_host.py`, `plugin_loader.py`, `plugins/_template.py`, `tests/fixtures/plugins/demo-server.py`, `tests/fixtures/plugins/_skip.py`, `tests/fixtures/plugins/index.json`
- Test: `tests/test_plugin_loader.py` (bagian discover/migrate)

**Interfaces (Produces):**
- `plugin_host`: `HOST_API = 1`; `bind(*, current_user=None, db_path) -> None` (`db_path` callable tanpa argumen); `async def current_user(request: Request) -> dict` (R2); `get_conn()` → `dbconn.get_conn(_db_path())`; `write_tx = dbconn.write_tx`; `now_utc() -> datetime` (aware UTC); `allow_async(fn)` → set `fn.__plugin_allow_async__ = True`, kembalikan `fn`; `_reset_for_tests()`.
- `plugin_loader`: `ROOT = Path(__file__).parent`; `PLUGINS_DIR = ROOT / "plugins"`; `INDEX_PATH = ROOT / "static" / "plugins" / "index.json"`; `PENDING_HOOKS = {"on_task_written": "Fase 1", "jobs": None, "register_bot": None, "intake": None}` (pesan R6).
  - `load_known(index_path=INDEX_PATH) -> dict[str, dict]` — set `_known = {id: {"defaultEnabled": bool}}` dan `_index_ok = True`; baca/parse gagal atau bentuk salah → `_known = {}`, `_index_ok = False`, log ERROR; tidak melempar.
  - `known() -> dict`, `index_ok() -> bool`, `default_enabled(pid) -> bool`.
  - `@dataclass(frozen=True) LoadedPlugin: id: str; module: ModuleType; router: APIRouter | None; ensure_schema: Callable | None`.
  - `discover(plugins_dir=PLUGINS_DIR, known=None) -> tuple[list[LoadedPlugin], dict[str, str]]` — urut nama file; `*.py` bukan `_*`; validasi berurutan (pesan penolakan persis dalam kurung): id cocok `ID_RE` ("id tidak valid"), bukan `state` ("id 'state' dicadangkan"), ada di `known` ("tidak terdaftar di static/plugins/index.json"), import (R5; "import gagal: <Exc>: <msg>"), simbol tertunda (R6), `MIN_HOST_API` (`"butuh host API N, host 1"`), `router` bila ada harus `APIRouter` ("router bukan APIRouter") dengan `prefix == ""` ("router tidak boleh punya prefix") dan tiap `APIRoute.endpoint` bukan coroutine function kecuali `__plugin_allow_async__` ("endpoint <path> async; tulis def atau @host.allow_async"), `ensure_schema` bila ada callable 1 argumen posisi ("ensure_schema harus fungsi (conn)"). Plugin ditolak tidak masuk `sys.modules`.
  - `migrate(db_path, plugins=None) -> dict[str, str]` — `plugins=None` → daftar hasil `init_web`/`load_for_bot` terakhir (`_loaded`); satu koneksi `dbconn.connect(db_path, foreign_keys=False)`: `with write_tx: plugin_states.ensure_schema(conn)`, lalu per plugin ber-`ensure_schema` `with write_tx:` + pagar R3; hasil `_health[id] = "ok" | "schema_failed"`; plugin tanpa `ensure_schema` → `"ok"`. Exception apa pun (termasuk `plugin_states` gagal) dicatat, tidak dilempar.
  - `health(pid) -> str` — `"ok"`, `"pending"` (dimuat tetapi `migrate` belum jalan), `"schema_failed"`, `"unknown"`.
  - `_reset_for_tests()`.
- `plugins/_template.py` dan `tests/fixtures/plugins/demo-server.py` = kontrak §4.4: `MIN_HOST_API = 1`, `router = APIRouter()`, `ensure_schema(conn)` membuat `plg_demo_server_items (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, title TEXT NOT NULL)`, `GET /items` (`def`, `user["sub"]`, `fetchall()`), `POST /items` (`def`, `write_tx`) mengembalikan `{"id": …}`. `tests/fixtures/plugins/index.json` = `{"v": 1, "plugins": [{"id": "demo-server", "defaultEnabled": false}, {"id": "bad-async", …}, …]}` — id untuk kasus tolak dibuat tes di `tmp_path` (salin `demo-server.py` lalu ubah), bukan file permanen.

- [ ] **Step 1: Tulis tes gagal** `tests/test_plugin_loader.py` (fixture `reset` memanggil `plugin_loader._reset_for_tests()`; tiap tes menulis indeks/plugin ke `tmp_path`):
  - `test_load_known_ok_and_broken`: indeks fixture → `known()["demo-server"] == {"defaultEnabled": False}`, `index_ok()`; file hilang / JSON rusak / `plugins` bukan list → `{}`, `index_ok() is False`, tidak melempar.
  - `test_discover_fixture_ok_and_skips_underscore`: `discover(FIXTURES, known())` → satu `LoadedPlugin` `demo-server` dengan router 2 rute; `_skip.py` (berisi `raise RuntimeError`) tidak diimpor; `"alurik_plugins.demo_server" in sys.modules`.
  - `test_discover_rejections` (parametrize; masing-masing file di `tmp_path` + id di indeks tmp): endpoint `async def` → alasan memuat `"async"`; endpoint `async` + `@host.allow_async` → lolos; `on_task_written = lambda *a: None` → `"on_task_written belum didukung (Fase 1)"`; `jobs = []` → `"jobs belum didukung (ditunda, Lampiran B)"`; `APIRouter(prefix="/x")` → `"prefix"`; id `Bad_Id.py` → `"id tidak valid"`; `state.py` → `"dicadangkan"`; id tidak di indeks → `"tidak terdaftar"`; `raise ValueError("boom")` saat import → `"import gagal: ValueError: boom"` dan modul tidak ada di `sys.modules`; `sys.exit(3)` saat import → ditolak, tes tetap berjalan; `MIN_HOST_API = 2` → `"butuh host API 2"`. Plugin sehat lain di folder yang sama tetap dimuat.
  - `test_migrate_creates_plugin_states_and_plugin_tables(tmp_path)`: DB baru + tabel `users`; `migrate(db, plugins)` → tabel `plugin_states` dan `plg_demo_server_items` ada; `health("demo-server") == "ok"`; dipanggil dua kali → tetap ok.
  - `test_migrate_rejects_unprefixed_object`: plugin `ensure_schema` membuat `plg_demo_server_items` **dan** `items_bocor` → keduanya tidak ada setelah migrate (rollback), `health == "schema_failed"`, `caplog` ERROR memuat id + `"items_bocor"`.
  - `test_migrate_rejects_host_table_change`: `ensure_schema` menjalankan `ALTER TABLE users ADD COLUMN x` → rollback, `schema_failed`, kolom tidak ada.
  - `test_migrate_fk_check_scoped`: DB punya pelanggaran FK pra-ada di tabel host (`PRAGMA foreign_keys=OFF` + sisip anak yatim) → plugin tetap `ok` (R3); plugin yang tabelnya sendiri melanggar FK → `schema_failed`.
  - `test_migrate_never_raises`: `ensure_schema` melempar → `schema_failed`, `migrate` kembali normal; plugin lain `ok`.
  - `test_host_get_conn_uses_bound_path_and_current_user_unbound`: `bind(db_path=lambda: str(p))` → `with plugin_host.get_conn() as c` → `isolation_level == "IMMEDIATE"`, file `p` dipakai; `asyncio.run(plugin_host.current_user(None))` tanpa bind → `RuntimeError`.
- [ ] **Step 2: Jalankan → FAIL** (`ModuleNotFoundError: plugin_loader`).
- [ ] **Step 3: Implementasi** `plugin_host.py`, bagian loader di atas, templat, fixture.
- [ ] **Step 4: Jalankan → PASS**; `python3 -m pytest tests/test_dbconn_callsites.py tests/ -q` hijau (pagar AST memindai `plugins/_template.py`, `plugin_host.py`, `plugin_loader.py`).
- [ ] **Step 5: Commit** `feat(plugin): plugin_loader dan plugin_host — discover, ensure_schema berpagar plg_, health`

### Task 3: `require_plugin_enabled`, `mount`, `init_web`, `load_for_bot`

**Files:**
- Modify: `plugin_loader.py`
- Test: `tests/test_plugin_loader.py` (bagian HTTP: app FastAPI baru)

**Interfaces:**
- Consumes: Task 1 `plugin_states.effective_enabled`, Task 2 `plugin_host`, `discover`, `migrate`, `health`, `default_enabled`.
- Produces:
  - `require_plugin_enabled(plugin_id: str) -> Callable` — mengembalikan `def _dep(user: dict = Depends(plugin_host.current_user)) -> None` dengan urutan spec §4.4: `user.get("scope") == "ext"` → 403 `{"code": "PLUGIN_FORBIDDEN_TOKEN"}`; `health(id) != "ok"` → 503 `{"code": "PLUGIN_UNAVAILABLE", "plugin_id": id}`; `with plugin_host.get_conn() as c: effective_enabled(c, user["sub"], id, default_enabled(id))` false → 403 `{"code": "PLUGIN_DISABLED", "plugin_id": id}`.
  - `mount(app, plugins) -> None` — untuk tiap plugin ber-`router`: `app.include_router(p.router, prefix=f"/api/plugins/{p.id}", tags=[f"plugin:{p.id}"], dependencies=[Depends(plugin_host.current_user), Depends(require_plugin_enabled(p.id))])`.
  - `init_web(app, *, plugins_dir=PLUGINS_DIR, index_path=INDEX_PATH) -> list[LoadedPlugin]` — `load_known` → `discover` → simpan `_loaded`, set health `"pending"` untuk yang punya `ensure_schema` (lainnya `"ok"`) → `mount` → log INFO `"plugin server: N dimuat, M ditolak"` + satu WARNING per penolakan (`"plugin <id> ditolak: <alasan>"`). Tidak pernah melempar.
  - `load_for_bot(application=None, *, plugins_dir=PLUGINS_DIR, index_path=INDEX_PATH) -> tuple[int, int]` — `load_known` + `discover` + log yang sama; tanpa `migrate`, tanpa router; tidak pernah melempar.

- [ ] **Step 1: Tulis tes gagal** (fixture `app_demo(tmp_path, client)`: `plugin_host.bind(current_user=webapp.get_current_user, db_path=lambda: webapp.DB_PATH)`; `app = FastAPI()`; `init_web(app, plugins_dir=FIXTURES, index_path=FIXTURES/"index.json")`; `migrate(webapp.DB_PATH)`; `TestClient(app)`; teardown `_reset_for_tests()` + bind ulang seperti `webapp` (Task 4) bila sudah ada; token dari `register_user(client, …)["token"]` di app utama):
  - `test_plugin_route_requires_login`: `GET /api/plugins/demo-server/items` tanpa header → 401.
  - `test_plugin_route_disabled_by_default`: dengan token → 403, `json()["detail"] == {"code": "PLUGIN_DISABLED", "plugin_id": "demo-server"}`.
  - `test_plugin_route_enabled_after_state_on`: `put_state(..., {"enabled": True})` langsung via `plugin_states` (HTTP PUT diuji di Task 4) → `POST /items {"title": "a"}` lalu `GET /items` → 200 berisi item milik pengguna itu saja (pengguna kedua ON juga → daftar kosong).
  - `test_plugin_route_ext_token_forbidden`: token dari `webapp.create_ext_token` + baris `ext_tokens` (pola tes clipper yang ada) → 403 `PLUGIN_FORBIDDEN_TOKEN`.
  - `test_plugin_route_unavailable_when_schema_failed`: paksa `plugin_loader._health["demo-server"] = "schema_failed"` → 503 `PLUGIN_UNAVAILABLE`; juga `"pending"` (sebelum `migrate`) → 503.
  - `test_current_user_resolved_once_per_request`: bungkus `get_current_user` penghitung lewat `bind` → satu request = 1 panggilan (cache dependency, R2).
  - `test_init_web_never_raises`: `plugins_dir` berisi plugin rusak + indeks rusak → app tanpa rute plugin, `caplog` memuat `"plugin server: 0 dimuat"`.
  - `test_load_for_bot_no_ddl_no_routes(tmp_path, caplog)`: DB kosong; `load_for_bot(None, plugins_dir=FIXTURES, index_path=…)` → `(1, 0)`; tabel `plg_demo_server_items` **tidak** dibuat; log `"plugin server: 1 dimuat, 0 ditolak"`.
- [ ] **Step 2: Jalankan → FAIL**.
- [ ] **Step 3: Implementasi** fungsi di atas.
- [ ] **Step 4: Jalankan → PASS**, `python3 -m pytest tests/ -q` hijau.
- [ ] **Step 5: Commit** `feat(plugin): router plugin /api/plugins/<id> — login, PLUGIN_DISABLED, PLUGIN_UNAVAILABLE`

### Task 4: API status + sambungan `webapp.py`

**Files:**
- Modify: `plugin_states.py` (router), `webapp.py` (import di blok `import dbconn` `:145`; `migrate_db` satu baris setelah `:968`; akhir modul sebelum `if __name__` `:10803`)
- Test: `tests/test_plugin_states.py` (bagian HTTP lewat `client` conftest), `tests/test_plugin_loader.py::test_webapp_wiring`

**Interfaces:**
- Consumes: Task 1–3.
- Produces:
  - `class StatePut(BaseModel)`: `enabled: StrictBool | None = None`, `settings: dict | None = None`, `updated_at: str | None = None` (R8).
  - `@router.get("/api/plugins/state") def get_state(user=Depends(plugin_host.current_user)) -> dict` → `{"v": 1, "server_time": iso(now), "plugins": get_states(...)}`.
  - `@router.put("/api/plugins/state/{plugin_id}") def put_state_endpoint(plugin_id: str, body: StatePut, user=Depends(plugin_host.current_user)) -> dict` → `{"applied": bool, "state": {...}}`; urutan error R8; tanpa `enabled`/`settings` di `model_fields_set` → 422; `settings` bukan objek / > 16 KB → 422; `updated_at` tak terbaca → 422 (pesan `"updated_at tidak valid"`).
  - `webapp.py` akhir modul: `plugin_host.bind(current_user=get_current_user, db_path=lambda: DB_PATH)`, `app.include_router(plugin_states.router)`, `plugin_loader.init_web(app)`; `migrate_db`: `plugin_loader.migrate(DB_PATH)` (R1).

- [ ] **Step 1: Tulis tes gagal**:
  - `test_get_state_empty_then_after_put(client)`: GET → `{"v": 1, "server_time": …, "plugins": {}}`; `PUT /api/plugins/state/habit-heatmap {"enabled": true, "updated_at": "<sekarang-1m Z>"}` → `{"applied": true, "state": {"enabled": true, "settings": {}, "updated_at": …}}`; GET memuatnya.
  - `test_put_lww_over_http`: PUT `T+5m` dipotong; PUT lebih lama → `applied false` + state server; kiriman ulang sama → hasil sama.
  - `test_put_unknown_and_reserved_ids`: `nope-plugin`, `state`, `Bad_Id` → 404 `{"detail": {"code": "PLUGIN_UNKNOWN"}}`.
  - `test_put_validation_422`: `{}`; `{"enabled": "ya"}`; `{"settings": []}`; `{"settings": {"x": "a" * 16400}}`; `{"enabled": true, "updated_at": "kemarin"}` → 422. `{"enabled": null}` → 200, `enabled None`.
  - `test_state_requires_login_and_rejects_ext(client)`: tanpa token GET/PUT → 401; token ext → 403 `PLUGIN_FORBIDDEN_TOKEN` (R7).
  - `test_state_isolated_between_users(client)`.
  - `test_put_503_when_index_unhealthy(monkeypatch)`: `monkeypatch.setattr(plugin_loader, "_index_ok", False)` → 503 `PLUGIN_UNAVAILABLE` (op klien tetap antre).
  - `test_webapp_wiring`: rute `/api/plugins/state` dan `/api/plugins/state/{plugin_id}` ada di `webapp.app.routes` dengan endpoint bukan coroutine; tidak ada rute `/api/plugins/<id>/…` (folder `plugins/` hanya templat); `webapp.migrate_db()` di DB tmp (pola `tests/test_sync_audit_server.py:114–138`) membuat `plugin_states` dan idempoten; AST `migrate_db` tetap 27 `dbconn.connect` (tes PR A lulus tanpa diubah) dan memuat tepat satu `plugin_loader.migrate(DB_PATH)` setelah pemanggilan `email_outbox.ensure_schema`.
- [ ] **Step 2: Jalankan → FAIL** (404 rute).
- [ ] **Step 3: Implementasi** router + sambungan webapp.
- [ ] **Step 4: Jalankan → PASS**, `python3 -m pytest tests/ -q` hijau (1284 lama tanpa diubah). Asap: `DB_PATH=/tmp/asap.db python3 -c "import webapp; webapp.migrate_db(); webapp.migrate_db(); print('ok')"`.
- [ ] **Step 5: Commit** `feat(plugin): GET/PUT /api/plugins/state dan pemasangan loader di webapp`

### Task 5: `bot.py` — error handler `NetworkError` + loader

**Files:**
- Modify: `bot.py` (import `from telegram.error import NetworkError` di blok `:51–54`; `import plugin_host, plugin_loader` setelah `import dbconn` `:71`; fungsi `on_error` sebelum `main` `:2805`; di `main()` setelah `Application.builder()` `:2810`)
- Test: `tests/test_bot_error_handler.py` (baru)

**Interfaces (Produces):** `async def on_error(update: object, context) -> None` (R18); `_update_id(update) -> str` (`str(update.update_id)` bila ada, selain itu `"-"`); `main()` memanggil `app.add_error_handler(on_error)`, `plugin_host.bind(current_user=None, db_path=lambda: repo.db_path)`, `plugin_loader.load_for_bot(app)`.

- [ ] **Step 1: Tulis tes gagal** (pola `asyncio.run(bot.on_error(...))` + `caplog.at_level(logging.INFO, logger="taskflow")`, `context = SimpleNamespace(error=…)`):
  - `test_network_error_one_warning_line`: `NetworkError("httpx.ReadError: ")` → tepat satu record level `WARNING`, `record.exc_info is None`, pesan memuat `"NetworkError"`; tidak ada record ERROR.
  - `test_timed_out_is_network_error`: `telegram.error.TimedOut()` → WARNING, tanpa `exc_info`.
  - `test_other_error_logged_with_traceback`: `ValueError("x")` (dilempar lalu ditangkap agar punya traceback) → satu record `ERROR` dengan `exc_info[0] is ValueError`; `update=SimpleNamespace(update_id=42)` → pesan memuat `42`.
  - `test_main_registers_error_handler_and_loader`: AST `bot.py` `main` memuat `add_error_handler(on_error)`, `plugin_host.bind(` dengan kata kunci `current_user=None`, dan `plugin_loader.load_for_bot(app)` sebelum `run_polling`.
- [ ] **Step 2: Jalankan → FAIL** (`AttributeError: on_error`).
- [ ] **Step 3: Implementasi.**
- [ ] **Step 4: Jalankan → PASS**; `python3 -m pytest tests/ -q` hijau (termasuk `test_bot_link_token.py`, `test_bot_invitations.py`); asap `TELEGRAM_BOT_TOKEN= DB_PATH=/tmp/asap.db python3 -c "import bot; print('ok')"`.
- [ ] **Step 5: Commit** `feat(bot): error handler — NetworkError sesaat satu baris WARNING; loader plugin di bot`

### Task 6: `compile.js` — lint `fetch` berbasis izin, id dicadangkan

**Files:**
- Modify: `compile.js` (`LINT_RE` `:80`, `buildOne` `:110–139`)
- Test: `tests/build-plugins.test.js`

**Interfaces (Produces):** `LINT_RE` tanpa `fetch\(` (tetap diekspor); `lintPlugin(code: string, manifest: object) -> string | null` (mengembalikan potongan terlarang pertama, R15); `buildOne` menolak id tidak valid / `state` sebelum membaca manifest (`plugin <id>: id tidak valid atau dicadangkan`). Diekspor: `lintPlugin`.

- [ ] **Step 1: Tulis tes gagal** di `tests/build-plugins.test.js`:
  - `"fixture: fetch polos / window|self|globalThis.fetch ditolak walau berizin network"`: manifest `permissions: ["network"]`, sumber berisi masing-masing → `/lint/`.
  - `"fixture: api.fetch( hanya dengan izin network"`: `function C({api}) { api.fetch("/api/plugins/x/items"); … }` → tanpa izin `/lint/` menyebut `.fetch(`; dengan `["network"]` → build sukses dan `index.json` memuat izin `network`.
  - `"fixture: folder plugin state / Bad_Id ditolak"` → error memuat `dicadangkan`.
  - Tes lama `:147` tetap lulus apa adanya (`fetch(` polos masih ditolak).
- [ ] **Step 2: Jalankan → FAIL** `node --test tests/build-plugins.test.js`.
- [ ] **Step 3: Implementasi.**
- [ ] **Step 4: Jalankan → PASS**; `node compile.js --plugins-only` dua kali → `git status` bersih (idempoten, `habit-heatmap` tidak berubah).
- [ ] **Step 5: Commit** `feat(plugin): lint compile.js — api.fetch hanya dengan izin network; id state dicadangkan`

### Task 7: `static/offline/pluginstate.js` — `TF.pluginstate`

**Files:**
- Create: `static/offline/pluginstate.js` (UMD seperti `pomolog.js`; `require("./db.js")`, `./outbox.js` di Node)
- Test: `tests/offline/pluginstate.test.js` (baru; `setup.js`, `deleteDB` per tes seperti `pomolog.test.js`)

**Interfaces (Produces):**
- Konstanta: `STATE_KEY = "plugins:state:v1"`, `OWNER_KEY = "plugins:state:owner:v1"`, `SUPPRESSED_KEY = "plugins:suppressed:v1"`, `ENTITY = "plugin_state"`.
- `setLocal(id, {enabled?, settings?}, opts?: {now?: () => string}) -> Promise<number>` (qid op baru) — satu transaksi `["_meta", "_outbox"]`: entri `{...lama, ...fields, updatedAt: now, dirty: true}`; kursor `_outbox` menghapus op `plugin_state`/cid sama dan menggabungkan payload-nya (R11); `add` op `{entity_type, op: "set", cid: id, payload: {plugin_id: id, ...fields, updated_at: now}, ts, retries: 0}`. Setelah `oncomplete`: notifikasi (R12) + `tf:outbox-queued`.
- `snapshot() -> Promise<{state: object, pending: string[], suppressed: object, owner: string|null}>` (satu transaksi baca).
- `pull(rawFetch, {userId, known?: string[] | null}) -> Promise<{changed: string[], mode: "merge"|"foreign"|"normal"}>` — `rawFetch("/api/plugins/state")`; non-2xx → throw `Error("http <status>")` ber-`status`; badan `{plugins}`; lalu satu transaksi `["_meta", "_outbox"]` dengan aturan R10/K15/Q1a: **merge** (owner tidak ada): per id ∈ (lokal ∪ server) ∩ `known` (bila `known` diberikan) — op tertunda → lewati; lokal `enabled === true` dan server bukan `true` → pertahankan lokal + `add` op dengan `updated_at = entry.updatedAt` asli (R11); selain itu adopsi server (tidak ada → hapus entri). **foreign** (owner ≠ userId): hapus semua op `plugin_state`, cache = server persis. **normal**: id dengan op tertunda dilewati, sisanya = server persis. Tulis `OWNER_KEY = String(userId)`. `userId == null` → tidak melakukan apa-apa (`{changed: [], mode: "normal"}`). Entri dari server: `{enabled, updatedAt: s.updated_at, settings: s.settings}`.
- `ackPushed(qid, id, serverState) -> Promise<void>` — satu transaksi: hapus op `qid`; bila tidak ada op lain untuk `id` → entri = bentuk server (tanpa `dirty`); bila ada → cache tidak disentuh.
- `dropOp(qid, id) -> Promise<void>` — hapus op + `dirty` (bila tak ada op lain).
- `hasPending(id) -> Promise<boolean>`.
- `suppress(id, reason, hash)`, `unsuppress(id)`, `suppressed() -> Promise<object>`, `pruneSuppressed(hashById: object) -> Promise<string[]>` (hapus entri yang hash-nya berbeda; kembalikan id yang dihapus).
- `subscribe(fn) -> () => void`; setiap fungsi pengubah memanggil pendengar `fn({ids})` dan `dispatchEvent(new CustomEvent("tf:plugin-state", {detail: {ids}}))` bila tersedia.

- [ ] **Step 1: Tulis tes gagal** `tests/offline/pluginstate.test.js`:
  - `"setLocal: entri dirty + satu op; toggle kedua menggabungkan (tetap satu op, qid baru, nilai terakhir)"`: ON lalu OFF → `outboxAll()` satu op `plugin_state/set` cid `habit-heatmap`, `payload.enabled === false`, tanpa kunci `settings`; cache `enabled false, dirty true`; `tf:outbox-queued` terpancar 2×.
  - `"setLocal atomik"`: injeksi kegagalan `_outbox.add` (stub `openDB` yang membatalkan transaksi) → cache juga tidak berubah.
  - `"pull merge (owner tidak ada): matriks lokal {true,false,tidak ada} × server {true,false,tidak ada}"` — 9 kasus: hanya (lokal true, server false/tidak ada) yang menghasilkan op dengan `updated_at === updatedAt asli`; sisanya mengadopsi server; `owner` ditulis.
  - `"pull merge: op tertunda menang"` (toggle sebelum sinkron pertama).
  - `"pull foreign: owner berbeda → op plugin_state lama dibuang, cache = server"` (R10).
  - `"pull normal: tanpa op → adopsi server persis; tidak ada di server → entri dihapus; dengan op → dilewati"`.
  - `"pull: 404 / 503 → throw, cache tidak berubah"`; `"pull: userId null → tanpa perubahan"`; `"pull: known membatasi id"`.
  - `"ackPushed: tanpa op lain → cache = server, dirty hilang; dengan op lebih baru → cache tetap niat lokal"` (Review Focus 1).
  - `"dropOp membersihkan dirty"`; `"hasPending"`.
  - `"suppress/unsuppress/pruneSuppressed(hash)"`.
  - `"clearAll → snapshot kosong (default)"`.
  - `"subscribe dipanggil dengan ids yang berubah"`.
- [ ] **Step 2: Jalankan → FAIL** `node --test tests/offline/pluginstate.test.js`.
- [ ] **Step 3: Implementasi.**
- [ ] **Step 4: Jalankan → PASS**, `npm test` (hanya gagal pra-ada).
- [ ] **Step 5: Commit** `feat(plugin): TF.pluginstate — cache status akun, op plugin_state/set ber-coalescing, lebur pertama`

### Task 8: `syncpush` — cabang `plugin_state/set`

**Files:**
- Modify: `static/offline/syncpush.js` (resolusi malas `pluginState()` seperti `noteRepo()` `:22`; `opPluginStateSet` dekat `opPomodoroCreate` `:676`; satu baris di `processOp` sebelum fallback `:2151`)
- Test: `tests/offline/syncpush_pluginstate.test.js` (baru; `fakeTransport` pola `tests/offline/syncpush.test.js:32`)

**Interfaces:**
- Consumes: Task 7 `ackPushed`, `dropOp`, `setLocal`.
- Produces: `opPluginStateSet(op, transport, result) -> Promise` (aturan R9): op tidak lagi ada di `outboxAll()` → `return null`; `send(transport, "PUT", "/api/plugins/state/" + encodeURIComponent(op.cid), op.payload)`; `pluginState()` tidak ada → op dibiarkan.

- [ ] **Step 1: Tulis tes gagal**:
  - `"PUT ke /api/plugins/state/<id> dengan payload op; 2xx → ack (op hilang, cache = state server), pushed 1"`.
  - `"401 menghentikan drain, op tetap"`; `"503/500 → op tetap, op lain tetap dikirim"`; `"timeout/jaringan → op tetap"`.
  - `"404 PLUGIN_UNKNOWN → op dibuang tanpa failed"`; `"404 tanpa kode (jendela deploy) → op tetap, failed 0"`.
  - `"422/403 → op dibuang, failed 1, dirty bersih"` (R9).
  - `"op yang sudah di-coalesce di tengah drain dilewati"`: transport lambat untuk op lain; `setLocal` dipanggil di antaranya → hanya op baru yang di-PUT (sekali).
  - `"op plugin_state tidak menahan/dihitung sebagai create induk"` (`pendingCreateCids` tidak memuatnya).
- [ ] **Step 2: Jalankan → FAIL** (op dibuang oleh fallback `processOp`).
- [ ] **Step 3: Implementasi.**
- [ ] **Step 4: Jalankan → PASS**, `npm test`.
- [ ] **Step 5: Commit** `feat(plugin): syncpush plugin_state/set — PLUGIN_UNKNOWN dibuang, 404 lain tetap antre`

### Task 9: Runtime — status akun, peredaman lokal, izin `network`

**Files:**
- Modify: `static/plugin-runtime.js` (`:18–19`, `isEnabled :229`, `list :236`, `setEnabled :288–303`, `markFailed :431–479`, `setEnabledInternal :482–484`, `bindHost :415`, `init :505–529`, `_reset :531`; `NODE_PATHS` + `pluginstate: "./offline/pluginstate.js"`)
- Test: `tests/offline/plugin_registry.test.js`, `plugin_failure.test.js`, `plugin_loader.test.js` (ubah, R17), `tests/offline/plugin_accountstate.test.js` (baru)

**Interfaces:**
- Consumes: Task 7 (`snapshot`, `setLocal`, `suppress`, `unsuppress`, `pruneSuppressed`, `subscribe`).
- Produces: `KNOWN_PERMISSIONS = ["storage", "network"]`; `RESERVED_PERMISSIONS` tanpa `network`; `plugins.accountEnabled(id) -> boolean`; `isEnabled(id)` = `accountEnabled ∧ !suppressed[id]`; `list()` item + `accountEnabled`, `pending: boolean`, `suppressed: string|null` (reason); `plugins.reloadState() -> Promise<string[]>` (id yang status efektifnya berubah; `activate`/`deactivate` + `plugins.changed {id, enabled}` per id); `plugins.knownIds() -> string[] | null` (null sebelum init); `bindHost(b)` menyimpan juga `fetch`, `isOfflineErr`, `pushNow` dan memanggil `reloadState()` bila `userId` berubah; `init` = indeks → `snapshot()` → `pruneSuppressed(hash indeks)` → `subscribe(reloadState)`; `markFailed` jalur OFF otomatis (manifest, factory, 2 error) → `suppressLocal(id, kind)` = salinan memori seketika + `pluginstate.suppress(id, kind, index hash)`, **tanpa** `setLocal`.

- [ ] **Step 1: Ubah tes lama (R17) dan tulis tes gagal** `plugin_accountstate.test.js`:
  - registry `:36` → `["storage", "network"]`; `:38` daftar tanpa `network` + `assert.ok(!P.RESERVED_PERMISSIONS.includes("network"))`; `:50`, loader `:92`, failure `:145` → `"records"` (regex toast loader → `/records/`).
  - failure `:35`, `:111`, loader `:98`: `(await metaGet("plugins:suppressed:v1"))["habit-heatmap"].reason` = `"render"`/`"factory"`/`"manifest"`; `plugins:state:v1` **tidak** berubah ke `false`; tidak ada op `plugin_state` di outbox.
  - baru: `"setEnabled → setLocal (op plugin_state), isEnabled seketika, plugins.changed"`; `"pull mengubah cache → reloadState mengaktifkan/mematikan + plugins.changed"` (panggil `pluginstate.pull` dengan rawFetch palsu); `"plugin diredam: pull yang mengembalikan ON tidak menyalakannya (tanpa siklus)"`; `"Aktifkan lagi (setEnabled true) menghapus peredaman"`; `"hash indeks berubah saat init → peredaman dihapus"`; `"list(): pending true selama ada op, false setelah ackPushed"`; `"bindHost userId berubah → reloadState"`; `"tanpa TF.pluginstate → perilaku 0a (persistState)"`; `"manifest berizin network valid"`.
- [ ] **Step 2: Jalankan → FAIL** `node --test tests/offline/plugin_*.test.js`.
- [ ] **Step 3: Implementasi** (R13, R14).
- [ ] **Step 4: Jalankan → PASS**, `npm test`.
- [ ] **Step 5: Commit** `feat(plugin): runtime memakai status akun; mati karena error hanya di perangkat ini`

### Task 10: `TF.api.fetch` + `PluginNetworkError`

**Files:**
- Modify: `static/plugin-runtime.js` (fasad `api.for` `:717–736`, kelas error `:549–554`)
- Test: `tests/offline/plugin_fetch.test.js` (baru)

**Interfaces:**
- Consumes: Task 9 `hostBinding.{fetch, isOfflineErr, pushNow}`, `pending`.
- Produces: `api.for(id).fetch(path, {method = "GET", body, timeoutMs = 15000} = {}) -> Promise<any>` (spec §6.4 langkah 1–6); `class PluginNetworkError extends Error {code, status?, detail?}` dengan `code ∈ "offline" | "timeout" | "auth" | "disabled" | "unavailable" | "http"`, `message` offline = `"Butuh koneksi internet"`; diekspor `TF.api.PluginNetworkError`. Validasi path: `p === "/api/plugins/" + id || p.startsWith("/api/plugins/" + id + "/")`, dan tolak `..` (segmen), `//`, `\`, `#`, `://`, awalan selain `/` → `PluginPermissionError` (dihitung `markFailed` "permission"). Pemetaan error host: `isOfflineErr(e)` atau `(e.status === 503 && e.message === "OFFLINE")` → offline; `e.status === 401` → auth; `403` + `e.body.detail.code === "PLUGIN_DISABLED"` → disabled; `503` + `PLUGIN_UNAVAILABLE` → unavailable; timer runtime habis atau pesan host `"Request timeout — coba lagi"` → timeout; lainnya → http `{status, detail: e.body && e.body.detail}`. `PluginNetworkError` **tidak** memanggil `markFailed`.

- [ ] **Step 1: Tulis tes gagal** `plugin_fetch.test.js` (runtime `_reset`, indeks dengan plugin berizin `["network"]` dan satu tanpa izin; `bindHost({fetch: stub, isOfflineErr, pushNow})`):
  - tanpa izin → `PluginPermissionError`, `failures(id)` bertambah; path plugin lain, `/api/plugins/demo-server/../state`, `https://x`, `//evil`, `/api/tasks` → `PluginPermissionError`; path sah → stub dipanggil `(path, {method: "POST", body: '{"a":1}'})`.
  - method `TRACE` / body > 256 KB → `TypeError` (bukan request).
  - `navigator.onLine = false` → `PluginNetworkError code offline`, pesan `"Butuh koneksi internet"`, stub tidak dipanggil.
  - pemetaan error 503 OFFLINE, TypeError jaringan, 401, 403 `PLUGIN_DISABLED`, 503 `PLUGIN_UNAVAILABLE`, 500 → kode masing-masing; timeout (stub tak pernah selesai, `timeoutMs: 20`) → `timeout`; tidak ada yang menambah `failures(id)` / toast.
  - op tertunda untuk plugin → `pushNow` dipanggil sebelum stub; `pushNow` menggantung → request tetap jalan setelah ≤ 5000 ms (tes dengan jam palsu atau parameter internal `_pushWaitMs` untuk tes).
- [ ] **Step 2: Jalankan → FAIL**.
- [ ] **Step 3: Implementasi.**
- [ ] **Step 4: Jalankan → PASS**, `npm test`.
- [ ] **Step 5: Commit** `feat(plugin): TF.api.fetch untuk izin network — hanya /api/plugins/<id>/, offline = "Butuh koneksi internet"`

### Task 11: Sambungan host `index.html` + SW `STATIC` + kartu Pengaturan

**Files:**
- Modify: `static/index.html` (`<script>` setelah `pomolog.js` `:370`; `sync()` langkah baru tepat sebelum `.then(() => window.TF.syncpush.pushOutbox(__syncTransport))` `:1360`; `bindHost` `:43565`; `PluginSettingsCard` `:27189–27212`), `static/sw.js` (`STATIC` setelah `"/static/offline/pomolog.js",` `:56`)
- Test: `tests/offline/plugin_host_wiring.test.js`, `tests/offline/plugin_settings_ui.test.js`

**Interfaces:**
- Consumes: Task 7 `TF.pluginstate.pull`, Task 9 `knownIds`, `list()` (`pending`, `suppressed`), Task 10 binding.
- Produces (teks yang diperiksa tes):
  - `<script src="/static/offline/pluginstate.js"></script>` sebelum `syncpush.js`.
  - `.then(() => step(() => (window.TF.pluginstate ? window.TF.pluginstate.pull(__syncRawFetch, { userId: runUid, known: window.TF.plugins?.knownIds?.() ?? null }) : null)))`.
  - `bindHost({... , fetch: (p, o) => api.fetch(p, { ...o, network: true }), isOfflineErr, pushNow: () => window.__pushNow() })`.
  - Kartu: subjudul Q3; petunjuk `it.pending ? hint("Menunggu sinkron", "q")`; `it.suppressed` → `"Dimatikan di perangkat ini karena error"` + tombol `"Aktifkan lagi"` (`P.setEnabled(it.id, true)`) dan `"Salin detail"`; `it.failed` lain (load) tetap `"Error — "`; label izin `network` → `"Butuh koneksi internet untuk sebagian fitur"`.

- [ ] **Step 1: Tulis tes gagal**:
  - `plugin_host_wiring`: `BASELINE_LINES = 46092` (R16); tag `pluginstate.js` tepat sekali, sebelum `syncpush.js`, setelah `outbox.js`/`meta.js`; `STATIC` sw memuat `"/static/offline/pluginstate.js",`; di `sync()` langkah `pluginstate.pull(__syncRawFetch` ada, dibungkus `step(`, **sebelum** `syncpush.pushOutbox(__syncTransport)` dan sesudah `pullDrawingsAndReconcile`; `bindHost` memuat `fetch: (p, o) => api.fetch(p, { ...o, network: true })`, `isOfflineErr`, `pushNow: () => window.__pushNow()`.
  - `plugin_settings_ui`: `:38` → subjudul baru; tambah `"Menunggu sinkron"`, `"Dimatikan di perangkat ini karena error"`, `"Butuh koneksi internet untuk sebagian fitur"`; teks lama `"Status disimpan di perangkat ini."` tidak ada lagi; `P.setEnabled(it.id, true)` tetap.
- [ ] **Step 2: Jalankan → FAIL**.
- [ ] **Step 3: Implementasi** (edit langsung `index.html` terkompilasi — tidak ada sumber `text/babel`; tulis `React.createElement`/`/*#__PURE__*/` seperti sekitarnya).
- [ ] **Step 4: Jalankan → PASS**: `npm test`, `python3 -m pytest tests/test_plugins_node.py tests/test_sw_precache_node.py -q`, `node temporary_files/check_inline_scripts.js static/index.html` → semua skrip inline OK (6/6 di `main`).
- [ ] **Step 5: Commit** `feat(plugin): sambungkan pluginstate ke sync() dan kartu Pengaturan (status ikut akun)`

### Task 12: Rilis — SW v490, whatsnew, README, ADR-039, spec + plan, pola tes CI

**Files:**
- Modify: `static/sw.js` (`CACHE`), `static/index.html` (`__SW_VERSION` `:270` + fallback `:27982`), 26 file `tests/` yang memuat string versi lama (sed **kecuali** `static/whatsnew.json`, PROTOCOL §4 butir 1), `static/whatsnew.json`, `docs/plugins/README.md`, `.agents/DECISIONS.md`, `docs/superpowers/specs/2026-10-31-plugin-fase0b-design.md`, `tests/test_plugins_node.py`
- Create: `docs/superpowers/plans/2026-10-31-plugin-fase0b-pr-b.md` (salinan rencana ini)

- [ ] **Step 1: Versi** `taskflow-v489-heatmap-rapi` → `taskflow-v490-plugin-akun` di `sw.js`, `index.html` (2 tempat) dan tes; `app.css?v=382` tetap.
- [ ] **Step 2: whatsnew** entri teratas: `{"version": "taskflow-v490-plugin-akun", "date": "<tanggal rilis WIB YYYY-MM-DD>", "title": "Plugin ikut akunmu", "new": ["Plugin yang kamu nyalakan kini ikut aktif di perangkat lain setelah tersinkron.", "Tetap bisa dinyalakan atau dimatikan saat offline; perubahan dikirim begitu online."]}`.
- [ ] **Step 3: `tests/test_plugins_node.py`**: `PATTERNS` += `tests/offline/pluginstate*.test.js`, `tests/offline/syncpush_pluginstate.test.js`; `REQUIRED` += `"plugin_fetch", "plugin_accountstate", "pluginstate", "syncpush_pluginstate"`.
- [ ] **Step 4: README** `docs/plugins/README.md`: judul "(Fase 0a–0b)"; §4 status = akun (cache `_meta`, offline, "Menunggu sinkron", peredaman lokal karena error); §3 izin `network`; §5 baris `api.fetch` + `PluginNetworkError` (kode, "Butuh koneksi internet", wajib menurunkan diri); §8 butir 1–2 diperbarui (fetch polos tetap dilarang, `api.fetch` hanya ke rute sendiri); §Server baru: kontrak `plugins/<id>.py` (§4.4 spec), `plugin_host` (`current_user`, `get_conn`, `write_tx`, `now_utc`, `allow_async`), aturan `def`, `fetchall()` sebelum menulis, transaksi pendek tanpa jaringan, nama `plg_<id_>_`, kode error, simbol tertunda, restart dua layanan; catatan tab lain (R12).
- [ ] **Step 5: ADR-039** "Status plugin per akun, loader server bersama web/bot, `TF.api.fetch`" (Date / Agent / Context / Decision / Consequences, format ADR-037/038): Context (0a per perangkat; Timeline Fase 1 butuh tabel + endpoint; auto-OFF 0a ikut tersimpan); Decision (`plugin_states` LWW server dipotong waktu server; op `plugin_state/set` ber-coalescing; lebur pertama hanya untuk cache tanpa pemilik, Q1a; peredaman lokal; loader `importlib` + indeks `index.json` bersama; `migrate()` berpagar `plg_`; router `Depends` login + aktif; endpoint `def`; `api.fetch` lewat host; error handler bot); Consequences (restart `taskflow-web` + `taskflow` tiap perubahan server plugin; status tidak disiarkan SSE; tab lain melihat perubahan saat sinkron; `settings` tersimpan tapi belum diekspos; rollback = revert + SW bump `silent`).
- [ ] **Step 6: Spec + plan:** tambah "### Catatan implementasi PR B (2026-10-31)" di §2 spec repo (R1–R3, R7–R10, R15–R18 ringkas) dan perbarui salinan Project `claude/spec-plugin-fase0b-2026-10-31.md` lewat `project_write` (isi sama); salin rencana ke `docs/superpowers/plans/2026-10-31-plugin-fase0b-pr-b.md`.
- [ ] **Step 7: Verifikasi** `python3 -m pytest tests/test_whatsnew.py tests/test_sw_precache_node.py tests/test_app_update_node.py -q` (PROTOCOL §4 butir 5), `npm test`, `python3 -m pytest tests/ -q`, `node compile.js` idempoten.
- [ ] **Step 8: Commit** `chore(release): SW v490 plugin-akun, whatsnew, README server, ADR-039`

### Task 13: E2E Playwright dua perangkat

**Files:**
- Create: `temporary_files/e2e_plugin_fase0b.py` (pola `temporary_files/e2e_plugin_fase0a.py`: `hd.start_server`, `hd.seed`, `hd.check`, tangkapan ke `temporary_files/e2e_plugin_fase0b/`; tidak di CI)

**Skenario** (dua `browser.new_context(service_workers="allow")` = perangkat A dan B, satu akun; sinkron dipicu `page.evaluate("window.__syncNow()")` lalu tunggu `window.__syncState.running === false`):
1. A: Pengaturan › Plugin → ON (switch `aria-checked="true"`, petunjuk "Menunggu sinkron" lalu hilang) → B `__syncNow` → switch B `aria-checked="true"` **tanpa reload**, Dashboard B merender `.dash-plugins .plg-heatmap`. Server: `GET /api/plugins/state` → `enabled: true`.
2. B `ctx.set_offline(True)` → OFF → "Menunggu sinkron" tampil, `_outbox` berisi tepat satu op `plugin_state` (toggle ON→OFF→ON→OFF offline tetap satu op) → online → A `__syncNow` → A OFF.
3. Jendela deploy: A `ctx.route("**/api/plugins/state**", 404 {"detail": "Not Found"})` → toggle ON → `__syncNow` → op tetap ada, sync selesai tanpa error lain (task/note tetap tersinkron) → `unroute` → `__syncNow` → server ON.
4. Q1a: (a) server OFF eksplisit hari ini (PUT dari A); di B tulis cache 0a lewat `TF.meta.metaSet("plugins:state:v1", {"habit-heatmap": {enabled: true, updatedAt: "<7 hari lalu>"}})` + `metaDel("plugins:state:owner:v1")` + `TF.plugins.reloadState()` → `__syncNow` → B **OFF**, server tetap OFF. (b) server tanpa baris (pengguna kedua) dengan cache 0a ON → `__syncNow` → server ON, perangkat lain pengguna itu ikut ON setelah sinkron.
5. Logout di B → login akun lain → status plugin akun lain diadopsi, tidak ada PUT untuk akun lain dengan status akun pertama.
6. A `TF.plugins._debugThrow("habit-heatmap")` 2× → A: "Dimatikan di perangkat ini karena error", Dashboard tanpa kartu; B tetap ON setelah `__syncNow`; A `__syncNow` tidak menyalakannya; "Aktifkan lagi" di A → kartu kembali.
7. 375 px: kartu Pengaturan tanpa geser horizontal; konsol tanpa error selain yang disengaja.

- [ ] **Step 1:** tulis skrip; **Step 2:** jalankan `python3 temporary_files/e2e_plugin_fase0b.py` → semua cek lolos (catat N/N); jalankan juga `temporary_files/e2e_plugin_fase0a.py` (regresi 0a, sesuaikan cek yang membaca `plugins:state:v1` setelah auto-OFF bila ada, tanpa mengubah perilaku yang diuji).
- [ ] **Step 3: Commit** `test(plugin): E2E dua perangkat Fase 0b`

### Task 14: Verifikasi akhir, handover, review, PR draft

**Files:** `.agents/CURRENT_STATE.md` (entri teratas), `.agents/SESSION_LOG.md` (format PROTOCOL §3.2)

- [ ] **Step 1: Verifikasi** dan catat angka: `python3 -m pytest tests/ -q` (1284 lama + baru, 1 skip; Python 3.12 bila tersedia); `npm test` (hanya `draw_local_reactive`); `node --test tests/build-plugins.test.js`; PROTOCOL §4 butir 5; `node temporary_files/check_inline_scripts.js static/index.html`; `node compile.js` dua kali tanpa diff; `git diff --stat origin/main -- static/app.css static/offline/db.js` kosong; `index.html` +≤ 60; `git diff origin/main -- tests/*.py` hanya file baru + `tests/test_plugins_node.py` (R17); asap `migrate_db` ×2 dan `import bot`.
- [ ] **Step 2: Handover** `CURRENT_STATE.md`: `## 🟡 Plugin Fase 0b — PR B: status plugin per akun + loader server + TF.api.fetch — claude/plugin-fase0b — <tanggal> (Claude) — PR DRAFT, menunggu "merge dan deploy"`: spec/plan/ADR-039; isi; rilis SW v490 + whatsnew; **deploy: workflow (`git reset`, `node compile.js`, `migrate_db` membuat `plugin_states`) TIDAK me-restart → Bapak wajib `sudo systemctl restart taskflow-web taskflow`**; selama jendela deploy toggle tetap antre (K14); verifikasi pasca-deploy: `GET /api/plugins/state` dengan token → 200, `journalctl -u taskflow` memuat `plugin server: 0 dimuat, 0 ditolak` dan gangguan jaringan Telegram kini satu baris WARNING, Pengaturan › Plugin menampilkan subjudul baru setelah "Perbarui Sekarang"; rollback = revert sebagai rilis baru (SW bump + whatsnew `silent`) + restart dua layanan, tabel `plugin_states` dibiarkan; tindak lanjut: siaran SSE status, tab lain (R12), `api.settings` (Fase 1), `plugin_states` di ekspor data (Fase 1). `SESSION_LOG.md` entri baru.
- [ ] **Step 3: Commit** `docs(agents): handover PR B Fase 0b`
- [ ] **Step 4: Review akhir oleh subagen reviewer terpisah** (Review Focus 1–5 + R1–R18; khusus: tidak ada `async def` baru di `plugin_states`/plugin fixture, semua baca-lalu-tulis baru dalam `write_tx`, `ensure_schema` tidak bisa menyentuh tabel host, coalescing + `ackPushed` tidak menimpa niat lebih baru, lint tidak bisa diakali `globalThis["fetch"]` — bila bisa, catat sebagai batas lint yang diketahui, bukan blokir). Perbaiki temuan wajib, ulangi Step 1.
- [ ] **Step 5: Push + PR draft** judul `Plugin Fase 0b — PR B: status plugin per akun, loader server, TF.api.fetch`; body: ringkasan, tabel file, R-keputusan penting, **catatan deploy restart manual dua layanan**, rollback, angka tes, hasil E2E; akhiri dengan atribusi sesi. Merge hanya setelah Bapak bilang "merge dan deploy"; setelah deploy sukses ingatkan restart `taskflow-web` + `taskflow`.
