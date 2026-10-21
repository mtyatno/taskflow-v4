# Komentar Note — PR 1 Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Server untuk komentar level halaman pada note workspace: skema, API CRUD + delta pull, siklus hidup, ringkasan per note, notifikasi (in-app + Telegram), dan sinyal SSE.

**Architecture:** Modul baru `note_comments.py` (tidak mengimpor `webapp`, pola `drawing_scope.py`) memegang skema, SQL visibilitas, kursor, parsing @mention, penerima notifikasi, dan ringkasan. `webapp.py` hanya menambah model Pydantic, endpoint, helper notifikasi per user, dan bus SSE (pola `mindmap_subscribers`). `repository.py` disentuh untuk `add_notification(note_id=…)` dan hapus workspace.

**Tech Stack:** FastAPI, SQLite, Pydantic v2, sse-starlette, pytest (`tests/conftest.py`: `client`, `db()`, `register_user`).

**Spec:** `docs/superpowers/specs/2026-10-21-komentar-note-design.md` (§2–§5, §8 bagian pytest, §9 PR 1).

## Global Constraints

- Waktu: `datetime.now(_TZ_JKT).isoformat()` (di modul: parameter `now: str` dari pemanggil).
- `body`: teks polos, setelah `strip()` 1–4000 karakter; `quote`: ≤ 500 karakter, hanya disimpan di thread; `client_id`: ≤ 64 karakter. Pelanggaran → 422.
- Kode error: tidak ada / tidak bisa diakses / tidak terlihat → 404; note pribadi → 409 `{"detail": {"code": "NOTE_NOT_SHARED"}}`; tidak berhak → 403.
- Komentar tidak muncul di `/pub`, ekspor DOCX/MD, `/api/search`, backlink, snapshot Sampah.
- Field turunan note tidak boleh mengubah `scratchpad_notes.updated_at`.
- Pesan notifikasi persis (setelah `_esc_msg`, isi dipotong 80 karakter + `…` bila lebih, judul kosong → `Tanpa judul`):
  - `{nama} menyebutmu di {judul}: "{isi}"`
  - `{nama} mengomentari catatanmu {judul}: "{isi}"`
  - `{nama} membalas komentar di {judul}: "{isi}"`
  - `{nama} menyelesaikan komentarmu di {judul}`
- `{nama}` = `display_name` atau `username` aktor.
- Tanpa perubahan frontend → **tidak** menaikkan versi SW. Deploy: ada migrasi; `repository.py` berubah → restart `taskflow-web`, lalu `taskflow`.
- Tes: `python -m pytest -q` penuh hijau; username/judul unik per tes (DB dipakai bersama satu sesi).

## Review Focus

1. **Dua komentar dengan `updated_at` identik di batas halaman delta pull** — keduanya harus terkirim tepat sekali (kursor `(updated_at, id)`). Tes di Task 3.
2. **Balasan ke thread yang sudah dihapus / note yang sudah ke Sampah** — 404, tidak ada baris terbuat. Tes di Task 2.
3. **`resolved` pada balasan** — 422 "Hanya thread yang bisa diselesaikan", tidak mengubah apa pun. Tes di Task 2.
4. **HTML di isi komentar** (`<b>x</b>`) — disimpan apa adanya di API, di-escape di pesan notifikasi/Telegram. Tes di Task 5.
5. **@mention berulang, ke diri sendiri, dan ke user di luar workspace** — tepat satu notifikasi per penerima sah, nol untuk diri sendiri dan non-anggota. Tes di Task 5.

---

## File Structure

| File | Tanggung jawab |
|---|---|
| Create `note_comments.py` | Skema, visibilitas, kursor, @mention, serialisasi, penerima notifikasi, ringkasan, purge |
| Modify `webapp.py` | `migrate_db` hook; model `CommentCreate`/`CommentPatch`; endpoint §4; `_notify_users_bg`; bus SSE `note_comment_subscribers`; field turunan di `_scratchpad_row` pemanggil; purge di endpoint Sampah |
| Modify `repository.py` | `add_notification(..., note_id=None)`; `delete_shared_list` menghapus komentar workspace |
| Create `tests/note_comment_helpers.py` | `U` (user + header), `shared_note(owner, members, title)` |
| Create `tests/test_note_comments_schema.py`, `_api.py`, `_sync.py`, `_summary.py`, `_notify.py`, `_live.py` | pytest per task |
| Modify `.agents/CURRENT_STATE.md`, `SESSION_LOG.md`, `DECISIONS.md` (ADR-023) | Task 7 |

---

### Task 1: Modul skema & helper murni

**Files:**
- Create: `note_comments.py`
- Modify: `webapp.py` (`migrate_db`, blok `ensure_*` ±baris 930–941)
- Test: `tests/test_note_comments_schema.py`

**Interfaces:**
- Produces:
  - `ensure_note_comments_schema(conn) -> None` — DDL spec §2.1 persis + `ALTER TABLE notifications ADD COLUMN note_id INTEGER DEFAULT NULL` bila kolom belum ada; idempoten.
  - `purge_old_tombstones(conn, now: str, days: int = 30) -> int` — hapus baris `deleted_at < now - days`; kembalikan jumlah.
  - `parse_cursor(s: str | None) -> tuple[str, int] | None` — format `"<updated_at>|<id>"`; kosong/rusak → `None`.
  - `make_cursor(updated_at: str, cid: int) -> str`
  - `cursor_expired(cursor: tuple[str, int] | None, now: str, days: int = 30) -> bool`
  - `mention_usernames(body: str) -> set[str]` — regex `@(\w+)`, huruf kecil.
  - `serialize(row) -> dict` — bentuk spec §4 (`username`, `display_name`, `resolved_by_name` dari kolom join `author_username`, `author_display`, `resolver_name`); tombstone → `body: ""`.
  - `SELECT_COLS: str` — kolom `c.*` + join nama penulis & penyelesai (alias di atas), dipakai semua query.

- [ ] **Step 1: Tulis tes gagal** `tests/test_note_comments_schema.py`:
  - `test_schema_idempotent`: `ensure_note_comments_schema` dua kali pada koneksi `db()` → tabel `note_comments`, `note_comment_reads` ada; `PRAGMA table_info(notifications)` memuat `note_id`; index `idx_note_comments_client` unik.
  - `test_migrate_db_creates_tables`: setelah `webapp.migrate_db()` tabel ada.
  - `test_cursor_roundtrip`: `parse_cursor(make_cursor("2026-10-21T05:00:00+07:00", 7)) == ("2026-10-21T05:00:00+07:00", 7)`; `parse_cursor("")`, `parse_cursor("x")`, `parse_cursor("a|b")` → `None`.
  - `test_cursor_expired`: kursor 31 hari sebelum `now` → `True`; 29 hari → `False`; `None` → `False`.
  - `test_mention_usernames`: `"hai @Rina dan @budi_2, @rina lagi"` → `{"rina", "budi_2"}`; tanpa @ → `set()`.
  - `test_purge_old_tombstones`: sisipkan 3 baris (dihapus 40 hari lalu, dihapus 5 hari lalu, tidak dihapus) → kembalikan 1, dua sisanya tetap.
- [ ] **Step 2: Jalankan → FAIL.** `python -m pytest tests/test_note_comments_schema.py -q`
- [ ] **Step 3: Implementasi** di `note_comments.py`; di `migrate_db` panggil `note_comments.ensure_note_comments_schema(conn)` dan `note_comments.purge_old_tombstones(conn, datetime.now(_TZ_JKT).isoformat())` di blok yang sama dengan `drawing_scope.ensure_drawing_scope_schema`. `import note_comments` di samping `import drawing_scope`.
- [ ] **Step 4: Jalankan → PASS**, lalu `python -m pytest -q` → PASS.
- [ ] **Step 5: Commit** `feat(komentar): skema note_comments + helper kursor/mention`

### Task 2: Endpoint tulis dan hak akses

**Files:**
- Modify: `note_comments.py`, `webapp.py` (model di dekat `MindmapShareReq`, endpoint setelah blok `/api/scratchpad/{note_id}/publish`)
- Create: `tests/note_comment_helpers.py`
- Test: `tests/test_note_comments_api.py`

**Interfaces:**
- Consumes: Task 1.
- Produces:
  - `note_comments.visible_note(conn, uid: int, note_id: int) -> sqlite3.Row | None` — note yang lolos akses (pemilik, atau pemilik/anggota `n.list_id`), dari tabel `scratchpad_notes`.
  - `note_comments.visible_clause(uid: int) -> tuple[str, list]` — fragmen WHERE untuk alias `c` + join `scratchpad_notes n ON n.id = c.note_id`: `n.list_id IS NOT NULL AND n.list_id = c.list_id AND (n.user_id = ? OR n.list_id IN (SELECT id FROM shared_lists WHERE owner_id = ? UNION SELECT list_id FROM list_members WHERE user_id = ?))`.
  - `note_comments.get_visible(conn, uid, comment_id) -> sqlite3.Row | None` (termasuk tombstone).
  - Model `CommentCreate{body: str, quote: Optional[str], parent_id: Optional[int], client_id: Optional[str]}`, `CommentPatch{body: Optional[str], resolved: Optional[bool]}` (tepat satu field wajib → 422).
  - Endpoint: `POST /api/scratchpad/{note_id}/comments` → 200 `serialize`; `PATCH /api/note-comments/{cid}` → 200 `serialize`; `DELETE /api/note-comments/{cid}` → `{"ok": true}`.
  - Setiap penulisan mem-bump `updated_at` baris yang berubah. Hapus: `deleted_at = now`, `body = ''`, thread → semua balasannya juga.
  - Helper tes: `U(client, name)` dengan `.id`, `.get/.post/.patch/.delete` (pola `tests/test_mindmap_live.py`); `shared_note(owner, members: list[U], title) -> (note_id, list_id)`; `private_note(owner, title) -> note_id`.

- [ ] **Step 1: Tulis tes gagal** `tests/test_note_comments_api.py` (setiap tes membuat user/workspace unik):
  - `test_owner_and_member_can_comment`: A pemilik, B anggota → keduanya POST 200; respons memuat `note_id`, `list_id`, `user_id`, `username`, `body`, `quote`, `parent_id is None`.
  - `test_non_member_404`: C bukan anggota → POST 404.
  - `test_private_note_409`: note pribadi → 409, `detail.code == "NOTE_NOT_SHARED"`.
  - `test_body_validation`: body `"   "` → 422; 4001 karakter → 422; quote 501 karakter → 422; PATCH `{}` → 422; PATCH `{body, resolved}` sekaligus → 422.
  - `test_client_id_idempotent`: POST dua kali dengan `client_id="c-1"` → id sama, hanya satu baris di DB.
  - `test_reply_flattened_and_quote_dropped`: balasan R1 ke thread T; balasan ke R1 → `parent_id == T`; `quote` pada balasan → tersimpan `None`.
  - `test_reply_to_deleted_thread_404` (Review Focus 2): hapus T, balas T → 404, jumlah baris tidak bertambah.
  - `test_comment_on_trashed_note_404` (Review Focus 2): DELETE note, lalu POST komentar → 404.
  - `test_edit_only_author`: penulis PATCH body → 200, `edited_at` terisi; pemilik note PATCH body komentar B → 403.
  - `test_resolve_rights`: penulis thread dan pemilik note bisa `resolved: true` (→ `resolved_at`, `resolved_by`, `resolved_by_name`), anggota lain → 403; `resolved: false` mengosongkan keduanya.
  - `test_resolve_reply_422` (Review Focus 3): PATCH `resolved` pada balasan → 422 `"Hanya thread yang bisa diselesaikan"`, baris tidak berubah.
  - `test_delete_rights_and_cascade`: anggota lain → 403; penulis → 200; pemilik note menghapus thread → balasannya ikut `deleted_at` terisi dan `body == ""`; DELETE kedua kali → 200.
  - `test_patch_deleted_404`: PATCH komentar terhapus → 404.
- [ ] **Step 2: Jalankan → FAIL.** `python -m pytest tests/test_note_comments_api.py -q`
- [ ] **Step 3: Implementasi** model (`field_validator` untuk strip/batas, `model_validator` untuk tepat-satu) dan endpoint. Urutan cek POST: `visible_note` → 404; `list_id IS NULL` → 409; `client_id` sudah ada untuk user ini → kembalikan baris itu; `parent_id` → `get_visible` (bukan tombstone, note sama) atau 404, ratakan ke induk. Hak: penulis = `c.user_id`, pemilik note = `n.user_id`, penulis thread = induk `user_id`.
- [ ] **Step 4: Jalankan → PASS**, `python -m pytest -q` → PASS.
- [ ] **Step 5: Commit** `feat(komentar): endpoint buat/edit/selesaikan/hapus komentar note`

### Task 3: Endpoint baca, delta pull, dan siklus hidup

**Files:**
- Modify: `note_comments.py`, `webapp.py` (endpoint baca; `purge_trashed_note` dan `empty_trashed_notes` ±6038–6070), `repository.py` (`delete_shared_list`)
- Test: `tests/test_note_comments_sync.py`

**Interfaces:**
- Consumes: Task 2.
- Produces:
  - `note_comments.delete_for_notes(conn, note_ids: list[int]) -> None` — hapus baris `note_comments` dan `note_comment_reads` (chunk 500).
  - `GET /api/scratchpad/{note_id}/comments` → `list[serialize]` tanpa tombstone, urut `created_at, id`; note tidak terlihat → 404; note pribadi → `[]`.
  - `GET /api/note-comments?since=&limit=` → `{items, cursor, more}`; urut `(updated_at, id)`; `limit` default 500, dibatasi 1..1000; kursor kedaluwarsa → `{"reset": true, "items": [], "cursor": "", "more": false}`; kursor rusak diperlakukan kosong.

- [ ] **Step 1: Tulis tes gagal** `tests/test_note_comments_sync.py`:
  - `test_list_per_note_excludes_tombstones`.
  - `test_delta_pull_pages`: 5 komentar, `limit=2` → 3 halaman, total 5 id unik, halaman terakhir `more: false`.
  - `test_delta_same_timestamp_boundary` (Review Focus 1): set `updated_at` dua komentar identik lewat DB, `limit=1` → keduanya muncul tepat sekali.
  - `test_delta_includes_tombstone`: setelah hapus, pull dari kursor sebelumnya memuat item dengan `deleted_at` dan `body == ""`.
  - `test_delta_reset_old_cursor`: `since=make_cursor(<40 hari lalu>, 1)` → `reset: true`.
  - `test_delta_hides_invisible`: komentar di note workspace W tidak muncul untuk non-anggota.
  - `test_unshare_reshare_other_workspace`: unshare → per-note `[]` dan tidak di delta (kursor kosong); share ulang ke W → muncul lagi; share ke W2 → tidak muncul.
  - `test_trash_restore_purge`: hapus note → per-note 404; restore → komentar kembali; hapus lagi lalu purge (`DELETE /api/scratchpad/trash/{id}`) → baris di `note_comments` untuk note itu 0. Sama untuk `DELETE /api/scratchpad/trash` (kosongkan).
  - `test_delete_workspace_removes_comments`: hapus workspace → baris `note_comments` dengan `list_id` itu 0.
- [ ] **Step 2: Jalankan → FAIL.**
- [ ] **Step 3: Implementasi.** Rute `/api/note-comments` didaftarkan sebelum `/api/note-comments/{cid}`. Delta: `WHERE (c.updated_at > ? OR (c.updated_at = ? AND c.id > ?))`, ambil `limit + 1` untuk `more`. Purge: kumpulkan `note_id` yang benar-benar dihapus (sudah ada `RETURNING` di kosongkan) lalu `delete_for_notes`. `delete_shared_list`: `DELETE FROM note_comments WHERE list_id = ?` di blok owner-check yang sama, dibungkus `except sqlite3.OperationalError`.
- [ ] **Step 4: Jalankan → PASS**, `python -m pytest -q` → PASS.
- [ ] **Step 5: Commit** `feat(komentar): delta pull, daftar per note, siklus hidup Sampah dan workspace`

### Task 4: Status baca dan ringkasan per note

**Files:**
- Modify: `note_comments.py`, `webapp.py` (endpoint read; `GET /api/scratchpad` ±5607 dan `GET /api/scratchpad/{note_id}` ±7021)
- Test: `tests/test_note_comments_summary.py`

**Interfaces:**
- Consumes: Task 3.
- Produces:
  - `note_comments.summaries(conn, uid: int, note_ids: list[int]) -> dict[int, dict]` → `{note_id: {"comment_open_count": int, "comment_unread": bool}}`; satu query agregat per chunk; note tanpa baris → tidak ada di dict (pemanggil default `0`/`False`).
  - `comment_open_count` = thread terlihat, `parent_id IS NULL`, `deleted_at IS NULL`, `resolved_at IS NULL`. `comment_unread` = ada komentar terlihat, tidak terhapus, `user_id != uid`, `created_at > COALESCE(last_read_at, '')`.
  - `POST /api/scratchpad/{note_id}/comments/read` → `{"ok": true}` (note harus terlihat, else 404; note pribadi → 200 tanpa efek).

- [ ] **Step 1: Tulis tes gagal:**
  - `test_counts_and_unread`: A pemilik, B menulis 2 thread + 1 balasan, 1 thread diselesaikan → untuk A `comment_open_count == 1`, `comment_unread is True` di `GET /api/scratchpad` dan `GET /api/scratchpad/{id}`; setelah A POST `/read` → `False`; komentar A sendiri tidak membuat A unread.
  - `test_summary_does_not_bump_note`: catat `updated_at` note → buat/selesaikan/hapus komentar + `/read` → `updated_at` note sama persis.
  - `test_private_note_defaults`: note pribadi → `0` dan `False`.
  - `test_not_in_pub_export_search`: komentar berisi token unik `zqkomentar123` → tidak ada di `GET /api/search?q=zqkomentar123`, di respons ekspor MD note, maupun halaman `/pub/{slug}` setelah publish.
- [ ] **Step 2: Jalankan → FAIL.**
- [ ] **Step 3: Implementasi;** di kedua endpoint note, isi field dari `summaries` setelah `_scratchpad_row` (default `0`/`False`).
- [ ] **Step 4: Jalankan → PASS**, `python -m pytest -q` → PASS.
- [ ] **Step 5: Commit** `feat(komentar): status baca dan ringkasan komentar per note`

### Task 5: Notifikasi in-app dan Telegram

**Files:**
- Modify: `note_comments.py`, `webapp.py` (helper dekat `_notify_members_bg` ±1479; panggil dari POST dan PATCH resolve), `repository.py` (`add_notification`)
- Test: `tests/test_note_comments_notify.py`

**Interfaces:**
- Consumes: Task 2.
- Produces:
  - `note_comments.recipients(conn, *, note, comment, actor_uid: int, event: str) -> dict[int, str]` — `event` ∈ `"create"`, `"resolve"`; hasil `{user_id: kind}` dengan `kind` ∈ `"mention"`, `"comment"`, `"reply"`, `"resolve"`. Aturan spec §5.1: thread baru → pemilik note (`comment`) + mention; balasan → peserta thread (penulis thread + penulis balasan yang tidak terhapus, `reply`) + mention; resolve → penulis thread bila ≠ aktor. Mention dicocokkan ke `users.username` (case-insensitive). Hanya pemilik/anggota `note.list_id` saat ini. Aktor dikeluarkan. Prioritas `mention > comment > reply`.
  - `note_comments.message(kind: str, actor_name: str, title: str, body: str, esc) -> str` — teks persis Global Constraints; `esc` = `_esc_msg`.
  - `TaskRepository.add_notification(user_id, message, list_id=None, task_id=None, note_id=None) -> dict` (dict kembalian memuat `note_id`).
  - `webapp._notify_users_bg(messages: dict[int, str], list_id: int, note_id: int) -> None` (async) — in-app selalu; Telegram via `users.telegram_id` bila `_tg_bot`; kegagalan diabaikan. Dijadwalkan dengan `BackgroundTasks` setelah commit.
- [ ] **Step 1: Tulis tes gagal** (baca tabel `notifications` langsung):
  - `test_new_thread_notifies_owner`: B (anggota) membuat thread di note A → A dapat 1 notifikasi, pesan diawali `"<nama B> mengomentari catatanmu "`, `note_id` dan `list_id` terisi; B tidak dapat.
  - `test_mention_priority_and_dedup` (Review Focus 5): B menulis `"@a @A @b @c @outsider"` (C anggota, outsider bukan) → A 1 notifikasi jenis menyebut (`"… menyebutmu di …"`), C 1, B 0, outsider 0.
  - `test_reply_notifies_participants`: thread A, balasan C, lalu B membalas → A dan C masing-masing 1 `"… membalas komentar di …"`; balasan yang dihapus tidak menjadikan penulisnya peserta.
  - `test_resolve_notifies_author`: pemilik menyelesaikan thread B → B 1 `"… menyelesaikan komentarmu di …"`; B menyelesaikan thread miliknya → 0.
  - `test_edit_reopen_delete_silent`: edit, buka lagi, hapus → jumlah notifikasi tidak bertambah.
  - `test_message_escaped_and_truncated` (Review Focus 4): body `"<b>x</b>" + "a" * 100` → API mengembalikan body apa adanya; pesan memuat `&lt;b&gt;x&lt;/b&gt;` dan isi ≤ 80 karakter + `…`; judul kosong → `Tanpa judul`.
  - `test_telegram_sent`: monkeypatch `webapp._tg_bot` dengan objek `send_message` async perekam, set `users.telegram_id` A → satu panggilan ke `chat_id` A dengan `parse_mode="HTML"`.
- [ ] **Step 2: Jalankan → FAIL.**
- [ ] **Step 3: Implementasi.**
- [ ] **Step 4: Jalankan → PASS**, `python -m pytest -q` → PASS (termasuk tes notifikasi lama: `tests/test_notification_escape.py`).
- [ ] **Step 5: Commit** `feat(komentar): notifikasi komentar ke pemilik, peserta thread, dan yang disebut`

### Task 6: Sinyal SSE

**Files:**
- Modify: `webapp.py` (bus di samping `mindmap_subscribers` ±baris 240; broadcast + stream setelah blok endpoint komentar)
- Test: `tests/test_note_comments_live.py`

**Interfaces:**
- Consumes: Task 2–3.
- Produces:
  - `note_comment_subscribers: dict[int, set[tuple[int, asyncio.Queue]]]`
  - `async def _note_comment_broadcast(note_id: int, event: dict) -> None` — pelanggan yang tidak lagi lolos `note_comments.visible_note` (atau note-nya pribadi) menerima `{"type": "comments_access_lost", "note_id"}` dan dilepas; kegagalan hanya di-log.
  - Event dari POST/PATCH/DELETE (setelah commit): `{"type": "comments_changed", "note_id": int}` — tanpa isi komentar.
  - `GET /api/scratchpad/{note_id}/comments/stream` (`get_current_user_sse`) → 404 bila tidak terlihat atau pribadi; selain itu pola `mindmap_stream` (ping 20 detik, `_session_still_valid`, berhenti setelah `comments_access_lost`).
- [ ] **Step 1: Tulis tes gagal** (pola `tests/test_mindmap_live.py`: monkeypatch `webapp._note_comment_broadcast` dengan perekam):
  - `test_writes_broadcast_signal`: POST, PATCH edit, PATCH resolve, DELETE → masing-masing satu panggilan `(note_id, {"type": "comments_changed", "note_id": note_id})`, `set(event) == {"type", "note_id"}`.
  - `test_broadcast_access_lost`: daftarkan antrean B langsung di `note_comment_subscribers`, keluarkan B dari workspace, jalankan `asyncio.run(webapp._note_comment_broadcast(nid, {...}))` asli → antrean B menerima `comments_access_lost` dan B terlepas; antrean A menerima `comments_changed`.
  - `test_stream_404`: non-anggota dan note pribadi → 404.
- [ ] **Step 2: Jalankan → FAIL.**
- [ ] **Step 3: Implementasi.**
- [ ] **Step 4: Jalankan → PASS**, `python -m pytest -q` → PASS.
- [ ] **Step 5: Commit** `feat(komentar): sinyal SSE perubahan komentar note`

### Task 7: Dokumentasi agen dan verifikasi akhir

**Files:**
- Modify: `.agents/DECISIONS.md` (ADR-023), `.agents/CURRENT_STATE.md` (entri teratas), `.agents/SESSION_LOG.md`

- [ ] **Step 1:** ADR-023 "Komentar note = tabel terpisah `note_comments` (soft delete, `list_id` saat dibuat menentukan visibilitas, tanpa FK ke note)" — konteks, keputusan, konsekuensi (tombstone 30 hari + `reset`, komentar tidak ikut Sampah/ekspor).
- [ ] **Step 2:** CURRENT_STATE: status PR 1, catatan deploy (migrasi; restart `taskflow-web` lalu `taskflow`; tanpa naik versi SW), cek produksi `SELECT COUNT(*) FROM note_comments;`, berikutnya PR 2 (offline). SESSION_LOG: ringkasan sesi.
- [ ] **Step 3:** `python -m pytest -q` penuh → PASS; `npm test` → hanya kegagalan pra-ada `draw_local_reactive`.
- [ ] **Step 4: Commit** `docs(agents): komentar note PR 1 backend`, push branch, buka draft PR.
