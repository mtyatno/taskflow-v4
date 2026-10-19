# Rencana: drawing milik workspace — PR 2, backend

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Tanggal: 2026-10-19 · Agent: Claude · Branch: `claude/drawing-workspace-backend` · Backend saja, **tanpa** kenaikan versi SW

**Goal:** Drawing bisa dimiliki satu workspace (`drawings.list_id`, meniru mindmap). Anggota W bisa melihat dan mengedit drawing W. Drawing pribadi milik aktor ikut ke W saat dirujuk dari note W. Halaman publik dan ekspor DOCX mengikuti akses baru.

**Architecture:** Modul baru `drawing_scope.py` berisi skema, backfill sekali jalan, access clause, lookup token, dan sinkron note → drawing. Fungsinya menerima `conn` dan tidak mengimpor `webapp`. `webapp.py` memakai modul itu di endpoint drawing, endpoint note (POST/PUT/share/restore), render publik, dan ekspor DOCX. `repository.delete_shared_list` mem-bump `updated_at` drawing W yang kembali pribadi. Frontend dan offline = PR 3.

**Tech Stack:** Python 3, FastAPI, SQLite, pytest (`tests/conftest.py`).

**Spec:** `docs/superpowers/specs/2026-10-18-workspace-drawing-project-design.md` §4.1–§4.6, §3 (aturan publik setelah PR 2), §7 (tes kunci PR 2).

## Global Constraints

- Yang berubah: `drawing_scope.py` (baru), `webapp.py`, `repository.py` (hanya `delete_shared_list`), dan tes. Tidak ada perubahan `static/`, `bot.py`, atau versi SW.
- Skema persis spec §4.1: `drawings.list_id INTEGER DEFAULT NULL REFERENCES shared_lists(id) ON DELETE SET NULL`, `drawings.last_edited_by INTEGER DEFAULT NULL REFERENCES users(id) ON DELETE SET NULL`, `CREATE INDEX IF NOT EXISTS idx_drawings_list ON drawings(list_id, updated_at)`.
- **Akses lihat/edit** = `user_id = uid` ATAU `list_id` ∈ workspace tempat uid owner/anggota (bentuk SQL sama dengan `_mindmap_access_clause`). **Share, hapus, pin** = hanya pemilik (`user_id`).
- Token direktif `::draw[x]` = id angka (lewat `_draw_token_id`) atau `client_id`. `client_id` hanya unik per user, jadi lookup lintas user memakai `ORDER BY (user_id = :uid) DESC LIMIT 1`. Judul tidak pernah jadi kunci kecuali heuristik ekspor DOCX yang sudah ada (token bukan id/UUID).
- Penolakan: tidak bisa melihat → 404 `"Drawing tidak ditemukan"`; bisa melihat tapi bukan pemilik (share/hapus) → 403 `"Hanya pemilik drawing"`; bukan anggota workspace tujuan → 403 `"Bukan anggota list ini"`; drawing masih dipakai note W saat unshare/pindah → 409 `{"code": "DRAWING_IN_USE", "notes": [{"id", "title"}], "hidden_count": n}`.
- Perubahan scope drawing (share, sinkron note, backfill, hapus workspace) selalu mem-bump `updated_at` supaya pull klien mengadopsi `list_id` baru (pola audit K4).
- Server tidak pernah menulis ulang `content` note.
- **Kompat klien lama (keputusan rencana, bukan dari spec):** `GET /api/drawings` tanpa parameter tetap hanya mengembalikan drawing milik user. Drawing W milik orang lain hanya ikut dengan `?shared=1` (dipakai PR 3). Alasannya: klien yang belum di-update akan menyimpan drawing orang lain sebagai miliknya dan mencoba menghapus/pin-nya. `GET`/`PUT /api/drawings/{token}` langsung memakai akses baru, sehingga embed di note W langsung bisa dimuat anggota.
- Deploy: `migrate_db()` dijalankan workflow; restart **`taskflow-web` dan `taskflow`** (karena `repository.py` berubah).
- Commit diakhiri trailer atribusi harness pelaksana. Jangan push. Tes: `python3 -m pytest tests -q`.

## Review Focus

1. **Klien lama sebelum PR 3** memanggil `GET /api/drawings` tanpa `shared=1` → hanya drawing milik sendiri; drawing W miliknya sendiri tetap ada dengan `list_id` terisi. Tes: Task 2 `test_list_default_own_only_shared_flag_adds_workspace`.
2. **`client_id` sama dimiliki dua user** (A pribadi, B di W yang juga diakses A) → `GET /api/drawings/{cid}` oleh A memberi milik A; oleh anggota lain memberi milik B. Tes: Task 2 `test_client_id_lookup_prefers_own_row`.
3. **Pemilik drawing sudah keluar dari W** lalu unshare drawing yang masih dipakai note W → 409 tanpa judul note yang tidak bisa ia lihat (`notes: []`, `hidden_count` > 0). Tes: Task 3 `test_unshare_in_use_hides_titles_from_ex_member`.
4. **Direktif ter-escape** `::draw\[uuid\]` (keluaran serializer markdown) di note W → drawing tetap ikut ke W. Tes: Task 4 `test_escaped_directive_moves_drawing`.
5. **Workspace dihapus** → drawing kembali pribadi pemiliknya **dan** `updated_at` berubah, sehingga perangkat pemilik mengadopsi `list_id = NULL`. Tes: Task 1 `test_delete_workspace_reverts_drawing_and_bumps`.

---

### Task 1 — Modul `drawing_scope`, skema, backfill, hapus workspace

**Files:**
- Create: `drawing_scope.py`
- Modify: `webapp.py` (`migrate_db`, sekitar baris 800: panggil skema + backfill di blok yang sama dengan `ensure_projects_schema`; pindahkan `_DRAW_DIRECTIVE_RE`, `_DRAW_TOKEN_RE`, `_draw_tokens`, `_draw_token_id` dari ±baris 4276 ke modul lalu impor balik dengan nama yang sama)
- Modify: `repository.py:1264-1281` (`delete_shared_list`)
- Create: `tests/drawing_ws_helpers.py`, `tests/test_drawing_scope_schema.py`

**Interfaces:**
- Produces (`drawing_scope.py`):
  - `DRAW_DIRECTIVE_RE`, `draw_tokens(content: str|None) -> set[str]`, `draw_token_id(token: str) -> int|None` (isi sama persis dengan versi webapp sekarang; webapp: `_DRAW_DIRECTIVE_RE = drawing_scope.DRAW_DIRECTIVE_RE`, dst.)
  - `ensure_drawing_scope_schema(conn) -> None` — idempoten.
  - `backfill_drawing_lists(conn, now: str) -> dict` — `{"skipped": True}` bila `app_meta['drawing_list_backfill_v1']` sudah ada; selain itu `{"moved": int, "conflicts": [{"drawing_id", "kept_list_id", "other_list_id"}]}` lalu tulis flag. Pemanggil yang commit.
  - `access_clause(uid: int, prefix: str = "") -> tuple[str, list]`
  - `find_accessible(conn, token: str, uid: int, cols: str = "*") -> sqlite3.Row|None`
  - `refs_of(row) -> set[str]` — `{str(id)}` ∪ `{client_id}` bila ada.
- Produces (`tests/drawing_ws_helpers.py`): `auth(client, username) -> dict`, `uid_of(username) -> int`, `make_drawing(client, headers, title, cid=None, list_id=None, svg="") -> dict`, `make_note(client, headers, title, content, list_id=None) -> dict`, `workspace(client, headers, name) -> int`, `add_member(list_id, user_id) -> None`, `drawing_row(did) -> sqlite3.Row` (baca langsung dari DB). Salin pola `_auth`/`_uid`/`_workspace`/`_add_member` dari `tests/test_pub_access.py`; `make_drawing` mengirim `list_id` hanya bila tidak None (endpoint-nya baru ada di Task 2).

- [ ] **Step 1: Tulis tes yang gagal** di `tests/test_drawing_scope_schema.py`:

```python
def test_schema_columns_and_index(db):
    cols = {r["name"] for r in db.execute("PRAGMA table_info(drawings)")}
    assert {"list_id", "last_edited_by"} <= cols
    idx = {r["name"] for r in db.execute("PRAGMA index_list(drawings)")}
    assert "idx_drawings_list" in idx

def test_backfill_moves_owner_drawing_into_note_workspace(client):
    # A punya drawing d1 (pribadi) dan d2 (milik B, pribadi); note W milik A merujuk d1 (id) dan d2 (client_id)
    # setelah reset flag + backfill: d1.list_id == W dan updated_at berubah; d2 tetap NULL
    # (pakai migrate langsung: hapus app_meta key, set list_id NULL lewat DB, panggil drawing_scope.backfill_drawing_lists)

def test_backfill_runs_once(client):
    # panggilan kedua -> {"skipped": True}; drawing pribadi A yang dirujuk note W SETELAH backfill pertama tidak dipindah

def test_backfill_conflict_newest_note_wins(client):
    # d1 dirujuk note W1 (updated_at lebih baru) dan note W2 -> d1.list_id == W1; result["conflicts"] == [{"drawing_id": d1, "kept_list_id": W1, "other_list_id": W2}]

def test_delete_workspace_reverts_drawing_and_bumps(client):
    # d1.list_id = W (set lewat DB), catat updated_at; DELETE /api/lists/W oleh owner
    # -> d1.list_id is None dan updated_at != sebelumnya
```

Isi badan tes yang dikomentari dengan helper dari `drawing_ws_helpers`; tulis `list_id`/`updated_at` langsung lewat DB bila endpoint belum ada.

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `python3 -m pytest tests/test_drawing_scope_schema.py -q`
Expected: FAIL (`ModuleNotFoundError: drawing_scope` / kolom tidak ada)

- [ ] **Step 3: Implementasi**
  - Skema: `ALTER TABLE ... ADD COLUMN` hanya bila kolom belum ada (cek `PRAGMA table_info`), lalu index.
  - Backfill: note `WHERE list_id IS NOT NULL ORDER BY updated_at DESC, id DESC`; untuk tiap token, drawing milik `note.user_id` (id lalu `client_id`). `list_id IS NULL` → set `list_id = note.list_id, updated_at = now`, catat id yang dipindah run ini. `list_id` = list lain dan dipindah run ini → masuk `conflicts`, lalu `logging.warning`. Lalu `INSERT OR REPLACE INTO app_meta(key, value) VALUES ('drawing_list_backfill_v1', now)`.
  - `migrate_db`: `drawing_scope.ensure_drawing_scope_schema(conn)` + `drawing_scope.backfill_drawing_lists(conn, datetime.now(_TZ_JKT).isoformat())` sebelum `conn.commit()` di blok projects.
  - `delete_shared_list`: di dalam blok owner-check yang sudah ada, tambahkan `UPDATE drawings SET list_id = NULL, updated_at = ? WHERE list_id = ?` (bungkus `sqlite3.OperationalError` seperti mindmap).

- [ ] **Step 4: Jalankan tes modul + seluruh suite**

Run: `python3 -m pytest tests/test_drawing_scope_schema.py -q && python3 -m pytest tests -q`
Expected: semua PASS (baseline main 307 + tes baru)

- [ ] **Step 5: Commit** — `feat(drawings): kolom list_id/last_edited_by, backfill sekali jalan, hapus workspace mem-bump drawing`

---

### Task 2 — Akses drawing: daftar, detail, edit, pin, hapus, buat

**Files:**
- Modify: `webapp.py` — `DrawingCreate` (+`list_id: Optional[int] = None`), `_drawing_enrich` (±7771), `list_drawings`, `create_drawing`, `get_drawing_detail`, `update_drawing_detail`, `toggle_pin_drawing`, `delete_drawing_detail` (±7802-7950), pencarian drawing di endpoint search (±7378)
- Test: `tests/test_drawing_workspace_access.py`

**Interfaces:**
- Consumes: `drawing_scope.access_clause`, `find_accessible`, helper tes Task 1.
- Produces:
  - `_drawing_enrich(row_dict, conn, viewer_uid: int) -> dict`: menambah `list_id`, `last_edited_by` (dari baris), `last_editor_username`/`last_editor_display_name` bila editor ≠ pemilik (pola `_mindmap_enrich`). `linked_notes` = note yang **bisa diakses viewer** (`_note_access_clause(viewer_uid)`) dan merujuk `::draw[id]` atau `::draw[client_id]`, maks 5, urut `updated_at DESC`.
  - `GET /api/drawings?shared=0|1`: default milik sendiri; `shared=1` = semua yang bisa diakses. Kolom yang dikirim: `id, user_id, client_id, title, svg_preview, is_pinned, list_id, last_edited_by, created_at, updated_at`.
  - `POST /api/drawings` dengan `list_id`: keanggotaan dicek → 403 `"Bukan anggota list ini"`. Jalur idempoten `client_id` tidak mengubah `list_id` baris yang sudah ada.
  - `PUT /api/drawings/{token}`: lookup lewat `find_accessible`; mengisi `last_edited_by = uid`; `_check_base_rev` tetap; tag ditulis di bawah `user_id` pemilik drawing.
  - `PATCH .../pin` dan `DELETE`: baris terlihat tapi bukan milik → 403 `"Hanya pemilik drawing"`; tidak terlihat → 404.

- [ ] **Step 1: Tulis tes yang gagal**

```python
def test_member_can_get_and_put_workspace_drawing(client):
    # A buat drawing di W (POST list_id=W); B anggota W: GET 200, PUT title "B edit" 200
    # -> baris: title == "B edit", last_edited_by == uid(B); respons GET oleh A punya last_editor_username == "B..."

def test_non_member_gets_404(client):
    # C bukan anggota: GET/PUT/DELETE/pin -> 404

def test_removed_member_loses_access(client):
    # B anggota lalu dihapus dari list_members -> GET 404

def test_only_owner_can_delete_or_pin(client):
    # B anggota: DELETE -> 403, PATCH pin -> 403; A: keduanya 200

def test_create_with_list_id_requires_membership(client):
    # C POST list_id=W -> 403; A POST list_id=W -> 200, list_id == W

def test_list_default_own_only_shared_flag_adds_workspace(client):
    # B: GET /api/drawings -> tidak memuat drawing W milik A; ?shared=1 -> memuat, dengan list_id == W
    # A: GET /api/drawings (tanpa flag) memuat drawing W miliknya dengan list_id == W

def test_client_id_lookup_prefers_own_row(client):
    # A punya drawing pribadi cid X; B punya drawing di W (A dan D anggota) cid X juga (tulis client_id lewat DB)
    # GET /api/drawings/X oleh A -> id milik A; oleh D -> id milik B

def test_member_put_tags_stored_under_owner(client):
    # B PUT tags ["x"] -> tags.user_id untuk tag "x" (entity drawing) == uid(A)

def test_linked_notes_only_viewer_accessible(client):
    # A: note pribadi "Rahasia A" dan note W "Catatan W" merujuk drawing W
    # GET oleh B -> linked_notes titles == ["Catatan W"]; oleh A memuat keduanya

def test_search_includes_workspace_drawings(client):
    # B cari judul drawing W milik A lewat endpoint search -> muncul di "drawings"
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `python3 -m pytest tests/test_drawing_workspace_access.py -q`
Expected: FAIL (404 untuk anggota, `list_id` tidak dikenal)

- [ ] **Step 3: Implementasi** sesuai Interfaces. Semua pemanggil `_drawing_enrich` mengoper `uid`.

- [ ] **Step 4: Jalankan tes + `tests/test_drawings.py`, `tests/test_dedup_drawings.py`, lalu suite penuh**

Run: `python3 -m pytest tests -q`
Expected: semua PASS

- [ ] **Step 5: Commit** — `feat(drawings): akses anggota workspace, list ?shared=1, last_edited_by, linked_notes per viewer`

---

### Task 3 — Share, salin, daftar per workspace, dampak keluar

**Files:**
- Modify: `drawing_scope.py`, `webapp.py` (endpoint baru di bagian drawings)
- Test: `tests/test_drawing_workspace_share.py`

**Interfaces:**
- Consumes: Task 1–2.
- Produces:
  - `drawing_scope.notes_in_list_using(conn, drawing_row, list_id: int, viewer_uid: int) -> tuple[list[dict], int]` — note `list_id = list_id` yang merujuk drawing; kembalikan (`[{"id","title"}]` yang bisa diakses viewer, jumlah yang tidak).
  - `drawing_scope.leave_impact(conn, list_id: int, uid: int) -> list[dict]` — note pribadi milik uid (`list_id IS NULL`) yang merujuk drawing ber-`list_id = list_id` milik orang lain: `[{"note_id","note_title","drawing_id","drawing_client_id","drawing_title"}]`.
  - `PATCH /api/drawings/{token}/share {list_id: int|null}` (model `DrawingShareReq`): hanya pemilik; tujuan dicek keanggotaan; `list_id` sama → kembalikan baris tanpa perubahan; dari W ke lain (NULL/W2) dan `notes_in_list_using` tidak kosong → 409 `DRAWING_IN_USE`; selain itu set `list_id`, bump `updated_at`. Respons `_drawing_enrich`.
  - `POST /api/drawings/{token}/copy {list_id: int|null, title?: str, client_id?: str}` (model `DrawingCopyReq`): sumber harus terlihat; tujuan dicek keanggotaan; buat baris baru milik penyalin (`user_id = uid`, `list_id`, `data_json`, `svg_preview`, `title` = `req.title` atau judul sumber); idempoten per `(uid, client_id)`. Respons `_drawing_enrich`.
  - `GET /api/lists/{list_id}/drawings`: anggota saja (403 lain); `id, user_id, client_id, title, svg_preview, is_pinned, list_id, last_edited_by, updated_at`, urut `updated_at DESC`.
  - `GET /api/lists/{list_id}/leave-impact`: anggota saja; `{"items": leave_impact(...)}`.

- [ ] **Step 1: Tulis tes yang gagal**

```python
def test_owner_shares_and_unshares_unused_drawing(client):
    # A share d ke W -> list_id W, updated_at berubah; unshare (null) -> None

def test_member_cannot_share(client):  # B share drawing W milik A -> 403

def test_share_to_foreign_list_403(client):  # A share ke W milik C (bukan anggota) -> 403

def test_unshare_in_use_409_lists_notes(client):
    # note W "Rapat" merujuk d -> PATCH null -> 409, detail.code == "DRAWING_IN_USE", detail.notes == [{"id": n, "title": "Rapat"}]
    # PATCH ke W2 -> 409 juga

def test_unshare_in_use_hides_titles_from_ex_member(client):
    # W milik C, A anggota, d milik A di W dipakai note W milik C; A dikeluarkan dari W
    # A PATCH null -> 409, notes == [], hidden_count == 1

def test_copy_to_personal_and_workspace(client):
    # B salin drawing W milik A ke pribadi -> user_id B, list_id None, data_json & svg sama, id baru
    # salin ke W2 tempat B bukan anggota -> 403; C (tanpa akses) salin -> 404
    # ulang dengan client_id sama -> id sama (idempoten)

def test_list_workspace_drawings(client):
    # GET /api/lists/W/drawings oleh anggota -> hanya drawing list_id W; non-anggota -> 403

def test_leave_impact(client):
    # note pribadi B merujuk drawing W milik A -> items memuat note itu; drawing W milik B sendiri tidak masuk
```

- [ ] **Step 2: Jalankan, pastikan gagal** — `python3 -m pytest tests/test_drawing_workspace_share.py -q` → FAIL (405/404)
- [ ] **Step 3: Implementasi** sesuai Interfaces. Pencocokan rujukan: prefilter `content LIKE '%::draw%'` lalu cek tepat dengan `draw_tokens(content) & refs_of(drawing)` (jangan mengandalkan LIKE saja).
- [ ] **Step 4: Suite penuh** — `python3 -m pytest tests -q` → PASS
- [ ] **Step 5: Commit** — `feat(drawings): share/unshare dengan aturan 409, salin, daftar per workspace, leave-impact`

---

### Task 4 — Sinkron note → drawing di server

**Files:**
- Modify: `drawing_scope.py`; `webapp.py` — `create_scratchpad` (kedua jalur return), `update_scratchpad`, `share_scratchpad`, `restore_trashed_note`
- Test: `tests/test_drawing_note_sync.py`

**Interfaces:**
- Produces: `drawing_scope.pull_note_drawings_into_list(conn, note_row, actor_uid: int, now: str) -> dict` dengan `{"moved_drawings": [{"id","client_id","list_id","updated_at"}], "unresolved_drawings": [token, ...]}`. Aturan persis spec §4.4: note pribadi → kedua daftar kosong; drawing `list_id == note.list_id` dilewati; `list_id IS NULL` dan `user_id == actor_uid` → pindah + bump; selain itu (termasuk tidak terlihat oleh aktor, milik W2, pribadi orang lain/pemilik note) → token masuk `unresolved_drawings` tanpa detail apa pun. Lookup token dari sudut pandang aktor: `find_accessible(conn, token, actor_uid)`; tidak ketemu → unresolved.
- Respons keempat endpoint note = `_scratchpad_row(...)` ditambah dua kunci di atas (selalu ada, list kosong bila tidak relevan). Helper dipanggil sesudah UPDATE/INSERT note dan sebelum `conn.commit()`.

- [ ] **Step 1: Tulis tes yang gagal**

```python
def test_put_with_new_embed_moves_actor_drawing(client):
    # note W milik A; A PUT content "::draw[<cid d>]" (d pribadi A) -> d.list_id == W; respons moved_drawings[0]["id"] == d

def test_post_note_in_workspace_moves_drawing(client):  # POST list_id=W dengan ::draw[d.id] -> pindah

def test_share_note_moves_drawings(client):
    # note pribadi A merujuk d1 (A) -> PATCH share W -> d1.list_id W; moved_drawings berisi d1

def test_member_edit_does_not_move_owner_drawing(client):
    # (tes kunci §7) note W milik A; B PUT menyisipkan ::draw[d] dengan d pribadi milik A
    # -> d.list_id tetap None; respons unresolved_drawings == [str(d)]

def test_other_workspace_drawing_untouched(client):
    # d2 milik A di W2; note W merujuk d2 -> d2.list_id tetap W2; token di unresolved_drawings

def test_personal_note_never_moves(client):  # note pribadi merujuk d -> list kosong, d tetap None

def test_escaped_directive_moves_drawing(client):  # content "::draw\\[<cid>\\]" di note W -> pindah

def test_restore_from_trash_moves_drawing(client):
    # note W milik A dihapus, d dikembalikan ke pribadi lewat DB, restore -> d.list_id == W
```

- [ ] **Step 2: Jalankan, pastikan gagal** — `python3 -m pytest tests/test_drawing_note_sync.py -q` → FAIL (`KeyError: moved_drawings`)
- [ ] **Step 3: Implementasi**
- [ ] **Step 4: Suite penuh** — `python3 -m pytest tests -q` → PASS
- [ ] **Step 5: Commit** — `feat(drawings): note W menarik drawing pribadi milik aktor ke workspace`

---

### Task 5 — Halaman publik dan ekspor DOCX mengikuti akses baru

**Files:**
- Modify: `drawing_scope.py`; `webapp.py` — `_published_drawing_for_request` (±4318), `_render_published_content` (±4359, parameter baru), `view_published_note` (±7005-7016), `_make_drawing_resolver` (±5573)
- Modify: `tests/test_pub_access.py` (`test_pub_shared_note_drawings_not_public` diganti dua tes di bawah), `tests/test_export_drawing_scope.py`
- Test: `tests/test_drawing_workspace_public.py`

**Interfaces:**
- Produces: `drawing_scope.resolve_for_publish(conn, token: str, owner_id: int|None, list_id: int|None) -> sqlite3.Row|None`
  - `owner_id` terisi (note tepercaya) → `find_accessible(conn, token, owner_id)` (drawing yang bisa diakses penerbit).
  - Selain itu, `list_id` terisi (note publish bersama di W) → drawing `list_id = W` lewat id atau `client_id`.
  - Keduanya None → None.
- `_render_published_content(raw, conn, note_id=None, owner_id=None, list_id=None)` memakai `resolve_for_publish`. `view_published_note` mengoper `list_id=row["list_id"]` saat note tidak tepercaya.
- `_published_drawing_for_request`: kandidat D lolos bila ada note publish yang terbuka bagi request, merujuk D, **dan** (a) tepercaya dengan penerbit P yang bisa mengakses D, atau (b) note bersama dengan `n.list_id = D.list_id`.
- Ekspor DOCX: `_resolve_owned_drawing` diganti `find_accessible(conn, token, uid)`; heuristik judul terscope `access_clause(uid)`.

- [ ] **Step 1: Tulis tes yang gagal**

```python
def test_shared_published_note_shows_workspace_drawing(client):
    # note W dipublish, merujuk d (list_id W, svg penanda) -> halaman memuat penanda; /pub/drawings/<d> -> 200

def test_shared_published_note_hides_non_workspace_drawing(client):
    # (pengganti tes PR 1) anggota B menyisipkan ::draw[k] (k pribadi milik A, pemilik note) -> tidak tampil, /pub/drawings/k -> 404, k.list_id tetap None

def test_trusted_note_shows_publisher_accessible_workspace_drawing(client):
    # note pribadi A (tepercaya) merujuk drawing W milik B (A anggota W) -> tampil

def test_trusted_note_still_hides_inaccessible_drawing(client):
    # drawing pribadi C -> kartu "Gambar tidak tersedia", /pub/drawings -> 404

def test_export_docx_resolves_member_accessible_drawing(client):
    # B ekspor note W yang merujuk drawing W milik A -> svg A ikut; drawing pribadi A -> placeholder
```

- [ ] **Step 2: Jalankan, pastikan gagal** — `python3 -m pytest tests/test_drawing_workspace_public.py -q` → FAIL
- [ ] **Step 3: Implementasi**; perbarui tes PR 1 yang sekarang bertentangan (hanya tes yang memang diganti spec §3: "Setelah PR 2, drawing tampil bila `drawings.list_id = W`").
- [ ] **Step 4: Suite penuh** — `python3 -m pytest tests -q && npm test` → pytest PASS; npm sama dengan baseline (1 kegagalan pra-ada `draw_local_reactive`)
- [ ] **Step 5: Commit** — `feat(pub): note publish bersama menampilkan drawing workspace; ekspor DOCX memakai akses drawing`

---

## Penyelesaian (koordinator, setelah review akhir)

- `.agents/DECISIONS.md`: ADR-012 (drawing berscope workspace: modul `drawing_scope`, `?shared=1` untuk kompat klien lama, backfill sekali jalan dengan flag `app_meta`, sinkron note → drawing hanya untuk drawing milik aktor).
- Spec §4.3: catat `?shared=1` dan bentuk 409; salin spec ke Project doc `claude/spec-workspace-drawing-project-2026-10-18.md`.
- `.agents/CURRENT_STATE.md` + `SESSION_LOG.md`.
- Merge `origin/main` terbaru, jalankan ulang pytest + npm, push, buka draft PR dengan checklist manual: dua akun di satu W, embed drawing A di note W dibuka B, B mengedit drawing, unshare yang ditolak 409, hapus workspace.
- Pesan deploy: restart `taskflow-web` **dan** `taskflow`.
