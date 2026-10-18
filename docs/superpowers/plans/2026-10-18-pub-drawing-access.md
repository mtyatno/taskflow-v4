# Rencana: akses publik drawing & lampiran mengikuti note publish (PR 1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Tanggal: 2026-10-18 · Agent: Claude · Branch: `claude/pub-drawing-access` · Backend saja, **tanpa** kenaikan versi SW

**Goal:** Halaman dan endpoint publik (`/pub/...`) hanya menampilkan drawing yang memang di-embed penerbit di note publish pribadi, dan menghormati password note publish untuk drawing, lampiran, dan backlink. Ekspor DOCX hanya memakai drawing milik pengekspor.

**Architecture:** Satu set helper di `webapp.py`: regex direktif `::draw` bersama, resolusi token drawing yang dibatasi ke pemilik note, dan cek cookie unlock. `GET /pub/drawings/{token}`, render konten publish, `/pub/attachments/{id}`, dan backlink "Related" memakai helper itu. Seksi "kanvas legacy per-note" (`drawings.id == note_id`) dihapus.

**Tech Stack:** Python 3, FastAPI, SQLite, pytest + Starlette `TestClient` (`tests/conftest.py`).

**Spec:** `docs/superpowers/specs/2026-10-18-workspace-drawing-project-design.md` §3 (celah 3a–3d dan aturan perbaikan).

## Global Constraints

- Hanya `webapp.py` dan tes yang berubah. Tidak ada perubahan skema DB, frontend (`static/`), atau versi SW.
- Semua penolakan menjawab **404** dengan detail yang sudah ada: `"Drawing tidak ditemukan"` untuk `/pub/drawings`, `"Attachment tidak ditemukan"` untuk `/pub/attachments`. Penolakan tidak boleh dibedakan dari "tidak ada".
- Bentuk respons `GET /pub/drawings/{token}` tidak berubah: tepat kunci `id`, `title`, `data_json`, `svg_preview`.
- Token direktif valid hanya `[0-9a-zA-Z_-]+` (sama dengan regex render yang sudah ada). Token lain → 404 tanpa query.
- "Penerbit" = `published_notes.user_id` (hanya pemilik note yang bisa publish, jadi sama dengan `scratchpad_notes.user_id`).
- Cookie unlock: nama `pub_unlock_{slug}`, diverifikasi dengan `_verify_cookie(cookie) == slug` (fungsi yang sudah ada). Tes membuat cookie dengan `webapp._sign_cookie(slug)`.
- Teks kartu untuk token yang tidak ter-resolve: tepat `Gambar tidak tersedia`.
- Note publish **bersama** (`scratchpad_notes.list_id` terisi; anggota workspace bisa mengedit isinya) tidak menampilkan drawing apa pun di PR 1, dan tidak dihitung sebagai rujukan oleh `/pub/drawings`. (Amandemen dari review Task 1; spec §3.)
- Commit diakhiri dua baris trailer:
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` dan
  `Claude-Session: https://claude.ai/code/session_01QibHmWHTKzbucVmVw4YuuX`
- Jangan push. Jalankan pytest dengan `python3 -m pytest`.

## Review Focus

1. Token `client_id` (UUID) adalah format default direktif sejak offline-first; render publik dan `/pub/drawings` harus me-resolve-nya ke drawing penerbit (tes 2 dan 7).
2. Halaman publik memanggil `/pub/drawings/{id angka}` (atribut `data-drawing-preview`) walau note merujuk lewat `client_id`; endpoint harus tetap 200 untuk kasus ini (tes 2).
3. Token dengan karakter di luar `[0-9a-zA-Z_-]` (mis. `a.b`) → 404, bukan 500 (tes 1).
4. Drawing yang dirujuk note berpassword dan note terbuka sekaligus → cukup lolos di note terbuka (tes 5).
5. Token tak ter-resolve tidak boleh menghasilkan atribut `data-drawing-preview` / `data-drawing-id` yang menunjuk ke token itu (tes 6).

---

### Task 1 — Drawing di halaman publik

**Files:**
- Modify: `webapp.py` (`_render_published_content` ±4038–4270, `view_published_note` ±6581–6810, `get_published_drawing` ±6545–6567, helper baru)
- Create: `tests/test_pub_access.py`
- Modify: `tests/test_drawings.py::test_drawing_endpoints_by_client_id` (langkah 3 sekarang mengasumsikan endpoint terbuka)

**Interfaces (Produces):**
- `_DRAW_DIRECTIVE_RE`: regex modul `r'\\?::draw\\?\[([0-9a-zA-Z_-]+)\\?\](?:\s*\\?\{([^}]*)\\?\})?'` (group 1 = token, group 2 = atribut). `_render_published_content` memakai konstanta ini, bukan pola inline.
- `_draw_tokens(content: Optional[str]) -> set[str]`: semua token direktif di content.
- `_resolve_owned_drawing(conn, token: str, owner_id: int) -> Optional[sqlite3.Row]`: kolom `id, user_id, client_id, title, svg_preview, data_json`; token angka dicari lewat `id` dulu, lalu (atau token non-angka) lewat `client_id`; selalu `AND user_id = owner_id`.
- `_pub_note_unlocked(request: Request, slug: str, password_hash: Optional[str]) -> bool`: True bila tanpa password (None/kosong) atau cookie unlock valid. `view_published_note` memakai helper ini untuk gerbang password yang sudah ada.
- `_published_drawing_for_request(conn, token: str, request: Request) -> Optional[sqlite3.Row]`: kandidat = drawing dengan `id = token` (bila angka) dan drawing dengan `client_id = token` (semua user). Kandidat D dikembalikan bila ada note publish milik `D.user_id` yang `_draw_tokens(content)` memuat `str(D.id)` atau `D.client_id`, dan note itu lolos `_pub_note_unlocked`.
- `_render_published_content(raw_content, conn, note_id=None, owner_id=None)`: parameter baru `owner_id`.

- [ ] **Step 1: Tulis tes yang gagal di `tests/test_pub_access.py`**

Helper di file tes: `_auth(client, username)` → header Bearer (pakai `register_user`), `_uid(username)` → id dari tabel `users` (pakai `conftest.db()`), `anon()` → `TestClient(webapp.app)` baru tanpa cookie, `_publish(client, headers, title, content, password=None)` → `(note_id, slug, username)`. Semua judul, client_id, dan marker unik per tes (DB dipakai bersama satu sesi pytest).

1. `test_pub_drawing_not_embedded_is_404`: drawing A (`client_id`) tanpa note → anon `GET /pub/drawings/{id}` dan `/{cid}` = 404; `GET /pub/drawings/a.b` = 404.
2. `test_pub_drawing_embedded_by_id_cid_and_escaped`: D1 dirujuk `::draw[{D1.id}]`, D2 dirujuk `::draw[{D2.cid}]`, D3 dirujuk bentuk ter-escape `::draw\[{D3.id}\]`, ketiganya di note publish milik A → anon GET lewat id dan cid masing-masing = 200, kunci JSON tepat `{"id","title","data_json","svg_preview"}`, `svg_preview` sama dengan yang dibuat.
3. `test_pub_drawing_unpublish_revokes`: setelah `DELETE /api/scratchpad/{note}/publish` → 404.
4. `test_pub_drawing_password_gate`: note publish dengan password → tanpa cookie 404; `Cookie: pub_unlock_{slug}=<_sign_cookie(slug)>` → 200; cookie `{slug}:deadbeef` → 404; cookie valid milik slug lain → 404.
5. `test_pub_drawing_any_accessible_note_suffices`: drawing yang sama dirujuk note berpassword dan note terbuka → tanpa cookie 200.
6. `test_pub_other_users_drawing_not_exposed`: drawing B (svg marker unik) dirujuk note A lewat id dan cid → anon `/pub/drawings/{B.id}` dan `/{B.cid}` = 404; HTML halaman A tidak memuat marker B, memuat `Gambar tidak tersedia`, dan tidak memuat `data-drawing-preview="{B.id}"` / `data-drawing-preview="{B.cid}"`.
7. `test_published_page_resolves_own_cid_reference`: drawing A (svg marker) dirujuk `::draw[{cid}]` → HTML memuat marker.
8. `test_published_page_ignores_title_match`: drawing B berjudul token-valid unik (mis. `judulrahasiab`) dengan svg marker; note A berisi `::draw[judulrahasiab]` → HTML tidak memuat marker.
9. `test_published_page_no_note_id_fallback_and_no_legacy_canvas`: paksa id drawing B = id note A: buat satu note dulu (agar baris `sqlite_sequence` ada), hitung `D = max(max id drawings, max id scratchpad_notes, seq scratchpad_notes) + 1000`, insert langsung drawing B dengan `id = D` (svg marker dan `data_json` berisi marker data), `UPDATE sqlite_sequence SET seq = D - 1 WHERE name = 'scratchpad_notes'`, lalu buat note A lewat API dan assert `note_id == D`. Isi note `::draw[00000000-0000-0000-0000-000000000000]`, publish → HTML tidak memuat kedua marker B, tidak memuat `id="drawing-iframe"`, dan memuat `Gambar tidak tersedia`.

- [ ] **Step 2: Jalankan tes, pastikan gagal karena alasan yang benar**

Run: `python3 -m pytest tests/test_pub_access.py -q`
Expected: tes 1, 3, 4, 6, 7, 8, 9 FAIL (endpoint masih terbuka, render belum di-scope); 2 dan 5 boleh sudah lulus.

- [ ] **Step 3: Implementasi di `webapp.py`**

- Tambah helper di Interfaces (modul, sebelum dipakai).
- `get_published_drawing(drawing_id: str, request: Request)`: pakai `_published_drawing_for_request`; None → 404 `"Drawing tidak ditemukan"`.
- `_replace_draw` di `_render_published_content`: `d_row = _resolve_owned_drawing(conn, token, owner_id)` bila `owner_id` ada, selain itu None. Hapus pencocokan `title = ?` dan fallback `id = note_id`. Token tak ter-resolve → kartu `note-draw-card` dengan header judul (atribut `title` direktif atau "Gambar") dan isi `Gambar tidak tersedia`, **tanpa** `data-drawing-id`/`data-drawing-preview` dan tanpa iframe. Token ter-resolve: markup lama tidak berubah.
- `view_published_note`: ambil `p.user_id`, teruskan `owner_id` ke `_render_published_content`; gerbang password memakai `_pub_note_unlocked`; hapus blok "Drawing canvas (read-only embed for legacy per-note canvas)" dan teruskan `drawing_html=''`, `drawing_data_js='null'` ke template (template tidak diubah).

- [ ] **Step 4: Perbarui `tests/test_drawings.py::test_drawing_endpoints_by_client_id`**

Langkah 3: anon `GET /pub/drawings/{cid}` sebelum di-embed = 404; lalu buat note berisi `::draw[{cid}]`, publish, GET = 200 dengan field yang sama seperti assert lama. Langkah 7 (404 setelah drawing dihapus) tetap.

- [ ] **Step 5: Jalankan tes**

Run: `python3 -m pytest tests/test_pub_access.py tests/test_drawings.py -q` → semua PASS. Lalu suite penuh `python3 -m pytest tests -q` → semua PASS (baseline 178).

- [ ] **Step 6: Commit**

```bash
git add webapp.py tests/test_pub_access.py tests/test_drawings.py
git commit -m "fix(pub): drawing publik hanya yang di-embed penerbit di note publish"
```

**Amandemen (fix round 1, dari review Task 1).** Premis "isi note dikendalikan penerbit" tidak berlaku untuk note bersama: `update_scratchpad` mengizinkan anggota workspace mengedit `content`. Anggota bisa menyisipkan `::draw[1..N]` ke note bersama yang dipublish pemilik, lalu membaca drawing pribadi pemilik lewat halaman publik.

- `view_published_note`: ambil `n.list_id`; teruskan `owner_id=row["user_id"]` hanya bila `list_id` NULL, selain itu `owner_id=None` (semua token jadi kartu `Gambar tidak tersedia`).
- `_published_drawing_for_request`: hanya note publish dengan `n.list_id IS NULL` yang dihitung sebagai rujukan.
- Tes `test_pub_shared_note_drawings_not_public`: A membuat workspace W (`POST /api/lists {name}`), note A dengan `list_id = W` berisi `::draw[{D.id}]` (D milik A), dipublish → HTML tanpa marker D dan memuat `Gambar tidak tersedia`; anon `/pub/drawings/{D.id}` = 404.
- Tes `test_pub_member_injection_blocked`: drawing pribadi P milik A tidak dirujuk di mana pun; note bersama N milik A (list W) dipublish; B dijadikan anggota W (insert `list_members(list_id, user_id, joined_at)` lewat `conftest.db()`); B `PUT /api/scratchpad/{N}` menambah `::draw[{P.id}]` dan `::draw[{P.cid}]` (assert 200) → HTML halaman N tanpa marker P; anon `/pub/drawings/{P.id}` dan `/{P.cid}` = 404.

### Task 2 — Password note publish untuk lampiran dan backlink

**Files:**
- Modify: `webapp.py` (`view_published_attachment` ±6501, query backlink di `view_published_note`)
- Modify: `tests/test_pub_access.py`

**Interfaces:**
- Consumes: `_pub_note_unlocked(request, slug, password_hash)` dari Task 1.

- [ ] **Step 1: Tulis tes yang gagal**

10. `test_pub_attachment_respects_note_password`: tulis file di `os.environ["UPLOAD_DIR"]` (nama unik), insert baris `note_attachments` (`note_id`, `user_id`, `nextcloud_path` = `"<folder>/<nama file>"`, `original_name`, `file_size`, `mime_type="text/plain"`) untuk note publish **berpassword** dan untuk note publish **terbuka** → anon: berpassword tanpa cookie 404, dengan cookie valid 200 dan isi body = isi file; terbuka 200.
11. `test_pub_backlinks_hide_password_protected_notes`: note X terbuka berjudul unik T; note Y berpassword berisi `[[T]]` dengan judul unik; note Z terbuka berisi `[[T]]` dengan judul unik → HTML halaman X tidak memuat judul Y dan memuat judul Z.

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `python3 -m pytest tests/test_pub_access.py -q -k "attachment or backlinks"` → keduanya FAIL.

- [ ] **Step 3: Implementasi**

- `view_published_attachment(att_id: int, request: Request)`: SELECT ikut mengambil `p.slug` dan `p.password_hash`; bila `not _pub_note_unlocked(...)` → 404 `"Attachment tidak ditemukan"` sebelum membaca file.
- Query backlink "Related" di `view_published_note`: tambah `AND (p2.password_hash IS NULL OR p2.password_hash = '')`.

- [ ] **Step 4: Jalankan tes**

Run: `python3 -m pytest tests/test_pub_access.py -q` lalu `python3 -m pytest tests -q` → semua PASS.

- [ ] **Step 5: Commit**

```bash
git add webapp.py tests/test_pub_access.py
git commit -m "fix(pub): lampiran dan backlink menghormati password note publish"
```

### Task 3 — Ekspor DOCX hanya memakai drawing milik pengekspor

Ditambahkan dari review Task 1 (celah 3e di spec): `_make_drawing_resolver` me-resolve drawing tanpa filter pemilik, dan `POST /api/scratchpad/export/docx` menerima isi bebas.

**Files:**
- Modify: `webapp.py` (`_make_drawing_resolver` ±5277–5332 dan dua pemanggilnya: ekspor note tersimpan ±5414, ekspor live ±5471)
- Create: `tests/test_export_drawing_scope.py`

**Interfaces:**
- `_make_drawing_resolver(uid: int)` → `_resolve_drawing(did, title=None) -> Optional[dict]` dengan kunci `id`, `title`, `svg` (bentuk dan perilaku pemanggil `docx_exporter` tidak berubah). Parameter `note_id` dihapus beserta fallback-nya; pemanggil diperbarui.
- Consumes dari Task 1: `_draw_token_id(token)` dan `_resolve_owned_drawing(conn, token, owner_id)` bila cocok dipakai ulang (boleh, tidak wajib).

- [ ] **Step 1: Tulis tes yang gagal di `tests/test_export_drawing_scope.py`**

Buat user A dan B; drawing A (svg marker, `client_id`, judul unik) dan drawing B (svg marker, `client_id`, judul unik, di-pin lewat `PATCH /api/drawings/{id}/pin`). `res = webapp._make_drawing_resolver(uid_A)`.

12. `test_export_resolver_rejects_other_users_drawings`: `res(str(B.id))`, `res(B.cid)`, `res("tidak-ada", title=B.title)`, dan `res(B.title)` semuanya `None`.
13. `test_export_resolver_resolves_own_drawings`: `res(str(A.id))["svg"]`, `res(A.cid)["svg"]` (dukungan `client_id` baru), dan `res("tidak-ada", title=A.title)["svg"]` sama dengan marker A.
14. `test_export_resolver_no_note_id_fallback`: drawing B dengan id yang sama dengan id note A (paksa seperti tes 9 di Task 1); resolver untuk A dengan token tak dikenal `00000000-0000-0000-0000-000000000000` → `None`.

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `python3 -m pytest tests/test_export_drawing_scope.py -q` → 12 dan 13 (bagian `client_id`) FAIL; 14 FAIL atau ERROR karena signature lama.

- [ ] **Step 3: Implementasi**

Semua query di resolver memakai `AND user_id = uid`. Urutan: token angka → `id`; token → `client_id`; judul direktif persis; judul `LIKE` yang sudah ada (heuristik "gambar/canvas -"). Hapus klausa `is_pinned = 1`, query `title = ? OR id = ?` tanpa filter, dan fallback `id = note_id`.

- [ ] **Step 4: Jalankan tes**

Run: `python3 -m pytest tests/test_export_drawing_scope.py tests/test_docx_export.py -q` lalu `python3 -m pytest tests -q` → semua PASS.

- [ ] **Step 5: Commit**

```bash
git add webapp.py tests/test_export_drawing_scope.py
git commit -m "fix(export): resolver drawing DOCX hanya untuk drawing milik pengekspor"
```
