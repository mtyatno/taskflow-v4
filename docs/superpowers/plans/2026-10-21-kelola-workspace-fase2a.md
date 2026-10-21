# Kelola Workspace Fase 2a — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Undangan via username menjadi undangan menunggu persetujuan (aplikasi, notifikasi, badge, Telegram), dan link undangan punya masa berlaku + batas pemakaian yang bisa dilihat dan dibatalkan.

**Architecture:** Tabel baru `workspace_invitations` + kolom baru `list_invites` (`max_uses`, `uses`, `revoked_at`, `created_at`) + `notifications.kind`; logika di `repository.py` (dipakai webapp dan bot). Klien: helper teks di `static/offline/wsmanage.js`, state undangan di App (cache `OfflineDB` "invitations"), seksi penerima di `SharedListsManager`, seksi owner di `WorkspaceMembersSection`.

**Tech Stack:** FastAPI + SQLite, python-telegram-bot (InlineKeyboard), pytest; React tanpa build (`static/index.html`), node:test; Playwright E2E lokal.

**Spec:** `docs/superpowers/specs/2026-10-21-kelola-workspace-fase2a-design.md`

## Global Constraints

- `static/index.html` adalah JS `React.createElement` biasa; **jangan** menjalankan `compile.js`. Setelah mengubahnya: `node temporary_files/check_inline_scripts.js static/index.html` harus OK.
- Teks UI berbahasa Indonesia, istilah "workspace". Teks yang dipatok spec dipakai persis (lihat spec §1.2, §1.3, §2.1–2.3).
- Ikon memakai glyph `VIEW_GLYPHS` yang sudah ada; tanpa emoji baru di UI aplikasi. Tanpa warna hex tetap di markup baru.
- Nama/username dirender sebagai teks (React children); di Telegram lewat `h()` / `_esc_msg`.
- Undangan pending kedaluwarsa **14 hari** setelah `created_at`; link `expires_in` ∈ {`1h`,`1d`,`7d`} (bawaan `1d`), `max_uses` ∈ {1, 10, null} (bawaan 1).
- Waktu = `datetime.now().isoformat()` (pola file).
- Semua aksi undangan/link online saja (`{ network: true }`); offline → nonaktif + `Butuh koneksi internet`.
- Versi SW/`app.css?v=` naik ke nomor kosong berikutnya di Task 7 (saat rencana ditulis `main` = v445 / 351).
- Deploy: restart `taskflow-web` lalu `taskflow`.

## Review Focus

1. **Pemakaian bersamaan link sisa 1** — dua orang menekan Gabung bersamaan → tepat satu jadi anggota, yang lain mendapat "Link sudah mencapai batas pemakaian.". Tes: Task 2 `test_concurrent_join_last_use` (dua thread).
2. **Undangan dijawab di dua tempat** (aplikasi lalu tombol Telegram, atau sebaliknya) → jawaban kedua tidak mengubah apa pun dan Telegram menampilkan "Undangan ini sudah tidak berlaku". Tes: Task 3 `test_callback_after_app_accept`.
3. **Penerima sudah jadi anggota lewat link sebelum menerima undangan** → terima = 200, tidak ada baris anggota ganda. Tes: Task 1 `test_accept_when_already_member`.
4. **Workspace dihapus saat undangan masih pending** → undangan hilang dari daftar penerima, badge turun, tombol Telegram → "sudah tidak berlaku". Tes: Task 1 `test_invitation_gone_after_workspace_delete`; Task 3 callback dengan id yang sudah tidak ada.
5. **Link lama (sebelum migrasi) yang belum terpakai** tetap bisa dipakai sekali sampai `expires_at`, link lama yang terpakai tetap ditolak. Tes: Task 2 `test_legacy_invite_backfill`.

---

### Task 1: Backend undangan via username + notifikasi

**Files:**
- Modify: `repository.py` (skema `workspace_invitations`, `notifications.kind`; method di bawah), `webapp.py` (endpoint; `POST /api/lists/{id}/invite` diubah; kirim Telegram)
- Test: `tests/test_workspace_invitations.py`

**Interfaces:**
- Produces (repository, kelas `TaskRepository`):
  - `create_workspace_invitation(list_id: int, inviter_id: int, invitee_id: int) -> dict` — raise `InvitationExists` (sudah pending), `AlreadyMember`; membuat notifikasi `kind='workspace_invite'` untuk penerima; mengembalikan `{id, list_id, invitee_id, inviter_id, status, created_at}`.
  - `list_pending_invitations_for_user(user_id: int) -> list[dict]` (tanpa yang kedaluwarsa; berisi `list` {id,name,avatar,color_idx} + `inviter_name`).
  - `list_pending_invitations_for_workspace(list_id: int) -> list[dict]` (berisi `invitee` {id,username,display_name}).
  - `respond_workspace_invitation(invitation_id: int, user_id: int, accept: bool) -> dict` — raise `InvitationNotFound` (404), `InvitationClosed` (409), `InvitationExpired` (410); accept → `add_list_member` (idempoten bila sudah anggota) + notifikasi owner; decline → notifikasi owner. Mengembalikan `{status, list: {...}}`.
  - `cancel_workspace_invitation(list_id: int, invitation_id: int) -> None` — raise `InvitationNotFound` / `InvitationClosed`.
  - Konstanta `INVITATION_TTL_DAYS = 14`.
- Produces (HTTP): spec §1.2 persis (`GET /api/invitations`, `POST /api/invitations/{id}/accept|decline`, `GET /api/lists/{id}/invitations`, `DELETE /api/lists/{id}/invitations/{inv_id}`; `POST /api/lists/{id}/invite` → pending); `GET /api/notifications` menyertakan `kind`.
- Produces (webapp): `_send_invitation_telegram(invitation: dict)` — bila penerima punya `telegram_id` dan `_tg_bot`, kirim `"{h(inviter)} mengundangmu ke workspace <b>{h(nama)}</b>."` dengan `InlineKeyboardMarkup([[Terima → inv_acc_{id}, Tolak → inv_dec_{id}]])`; galat diabaikan (log).

- [ ] **Step 1: Tes gagal** (pola `U`/`_workspace` di `tests/test_workspace_pins_api.py`): `test_invite_creates_pending_not_member`; `test_invite_duplicate_409`; `test_invite_existing_member_400`; `test_invitee_lists_pending_with_inviter_and_list`; `test_accept_makes_member_and_notifies_owner`; `test_decline_notifies_owner_not_member`; `test_respond_not_owner_of_invitation_404`; `test_respond_twice_409`; `test_respond_expired_410` (ubah `created_at` jadi 15 hari lalu); `test_expired_not_listed`; `test_accept_when_already_member` (B gabung lewat link dulu → accept 200, satu baris `list_members`); `test_owner_lists_and_cancels`; `test_cancel_non_pending_409`; `test_non_owner_cannot_list_or_cancel_403`; `test_invitation_gone_after_workspace_delete`; `test_notification_kind_workspace_invite` (`GET /api/notifications` item memuat `kind == "workspace_invite"`); `test_migration_idempotent`.
- [ ] **Step 2: FAIL.** `python3 -m pytest tests/test_workspace_invitations.py -q`
- [ ] **Step 3: Implementasi** sesuai Interfaces; indeks unik parsial `CREATE UNIQUE INDEX … ON workspace_invitations(list_id, invitee_id) WHERE status='pending'`; undangan pending kedaluwarsa diperlakukan tidak ada untuk keunikan (saat membuat undangan baru, ubah pending kedaluwarsa milik pasangan yang sama menjadi `cancelled` dulu).
- [ ] **Step 4: PASS** + `python3 -m pytest tests -q`.
- [ ] **Step 5: Commit** `feat(workspace): undangan via username menunggu persetujuan + notifikasi`

### Task 2: Backend link undangan (masa berlaku, batas pemakaian, batalkan)

**Files:**
- Modify: `repository.py` (`list_invites` kolom + backfill; `create_list_invite`, `consume_list_invite`, method baru), `webapp.py` (`generate-link`, `links`, `join`, `preview`)
- Test: `tests/test_workspace_invite_links.py`

**Interfaces:**
- Produces: `create_list_invite(list_id, created_by, expire_hours: int, max_uses: int | None) -> dict` (`{code, expires_at, max_uses, uses}`); `list_active_invites(list_id) -> list[dict]`; `revoke_list_invite(list_id, code) -> bool`; `revoke_all_list_invites(list_id) -> int`; `invite_status(code) -> str` ∈ {`ok`,`missing`,`revoked`,`expired`,`full`} plus `list_id`; `consume_list_invite(code) -> int | None` (atomik, spec §1.3). HTTP sesuai spec §1.3; pesan galat persis: `Kode tidak valid.`, `Link sudah dibatalkan owner.`, `Link sudah kedaluwarsa.`, `Link sudah mencapai batas pemakaian.`.
- Endpoint `join`: cek owner/anggota **sebelum** consume (400 dengan pesan lama tanpa memakai kuota).

- [ ] **Step 1: Tes gagal:** `test_generate_defaults_1d_single_use`; `test_generate_options_valid` (1h/7d, 10, null); `test_generate_invalid_options_422` (`"2d"`, 5); `test_links_lists_active_only` (dibatalkan, kedaluwarsa, penuh tidak muncul); `test_revoke_one_and_all`; `test_single_use_second_person_full`; `test_unlimited_two_people`; `test_member_join_does_not_consume`; `test_preview_and_join_error_messages` (keempat pesan); `test_concurrent_join_last_use` (dua `threading.Thread` memanggil `TaskRepository.consume_list_invite` pada link `max_uses=1` → tepat satu bukan None); `test_legacy_invite_backfill` (sisipkan baris gaya lama `used=0` dan `used=1` tanpa kolom baru → `migrate_db()` → yang `used=0` bisa dipakai sekali, `used=1` → "penuh"); `test_non_owner_links_403`.
- [ ] **Step 2: FAIL.**
- [ ] **Step 3: Implementasi** sesuai Interfaces.
- [ ] **Step 4: PASS** + suite penuh.
- [ ] **Step 5: Commit** `feat(workspace): link undangan dengan masa berlaku, batas pemakaian, dan pembatalan`

### Task 3: Bot Telegram — `/invite` menunggu persetujuan + tombol Terima/Tolak

**Files:**
- Modify: `bot.py` (`cmd_invite` memakai `create_workspace_invitation` + kirim pesan ke penerima; `handle_callback` cabang `inv_acc_` / `inv_dec_`)
- Test: `tests/test_bot_invitations.py` (pola update/bot palsu di `tests/test_bot_escape.py`)

**Interfaces:**
- Consumes: Task 1 repository methods dan exceptions.
- Produces: callback `inv_acc_{id}` / `inv_dec_{id}`; pesan hasil persis: `✅ Bergabung ke <b>{nama}</b>`, `Undangan ditolak`, `Undangan ini sudah tidak berlaku`, `Undangan ini bukan untukmu`. `/invite` sukses → `📨 Undangan dikirim ke @{username}. Menunggu persetujuan.`; duplikat → `Undangan untuk @{username} sudah dikirim.`

- [ ] **Step 1: Tes gagal:** `test_cmd_invite_creates_pending`; `test_cmd_invite_duplicate_message`; `test_callback_accept_by_invitee`; `test_callback_decline`; `test_callback_wrong_user` (`Undangan ini bukan untukmu`, tidak ada perubahan); `test_callback_after_app_accept` (`Undangan ini sudah tidak berlaku`); `test_callback_missing_invitation` (id tidak ada); nama workspace `<x>&` di-escape.
- [ ] **Step 2: FAIL.** `python3 -m pytest tests/test_bot_invitations.py -q`
- [ ] **Step 3: Implementasi.** User Telegram dipetakan ke user Alurik dengan helper yang sudah dipakai handler lain (`uid(context)` / lookup `telegram_id`).
- [ ] **Step 4: PASS** + suite penuh.
- [ ] **Step 5: Commit** `feat(bot): /invite menunggu persetujuan + tombol Terima/Tolak`

### Task 4: Klien — helper, state undangan di App, badge, notifikasi

**Files:**
- Modify: `static/offline/wsmanage.js` (`linkUsageText`, `linkExpiryText`, `invitationSubtitle`), `static/index.html` (App: state `invitations` + `loadInvitations()` di `fetchAll` online + cache `OfflineDB.cacheSet("invitations")`, `handleInvitationResponse(id, accept)`; badge di menu `manage_lists` sidebar terbuka + rail "Semua workspace"; klik notifikasi `kind === "workspace_invite"` → `setPage("manage_lists")` + gulir ke `#ws-invitations`)
- Test: `tests/offline/workspace_invitations_client.test.js`

**Interfaces:**
- Produces: `TF.wsmanage.linkUsageText({max_uses, uses}) -> string` (`"Sisa 3 dari 10"`, `"Sisa 1 dari 1"`, `"Tanpa batas"`); `linkExpiryText(expires_at: string) -> string` (`"berlaku sampai {tanggal jam}"`, `toLocaleString("id-ID", {day:"numeric", month:"short", hour:"2-digit", minute:"2-digit"})`); `invitationSubtitle({inviter_name, created_at}) -> string` (`"Diundang oleh {nama} · {tanggal}"`). App: `invitations: Array`, `handleInvitationResponse(id: number, accept: boolean) -> Promise<boolean>` (online; sukses → hapus dari state + cache, accept → toast `Bergabung ke {nama}` + `fetchAll`/list pull; decline → toast `Undangan ditolak`; galat → toast `detail`). Semua helper baru dipanggil dengan guard `typeof … === "function"` (pola Fase 1).

- [ ] **Step 1: Tes gagal:** helper (nilai di atas); cek sumber: App memanggil `/api/invitations` dengan `{ network: true }`, menyimpan cache `"invitations"`, badge dirender bila `invitations.length > 0` di kedua menu, notifikasi `workspace_invite` → `manage_lists`.
- [ ] **Step 2: FAIL.**
- [ ] **Step 3: Implementasi.**
- [ ] **Step 4: PASS**; `npm test`; inline OK.
- [ ] **Step 5: Commit** `feat(workspace): state undangan, badge, dan notifikasi undangan di klien`

### Task 5: UI penerima — seksi "Undangan untukmu" + pratinjau `?join=`

**Files:**
- Modify: `static/index.html` — `SharedListsManager` (seksi baru `id="ws-invitations"` paling atas), `JoinListModal` (owner + jumlah anggota; pesan galat link)
- Test: `tests/offline/workspace_invitations_ui.test.js`

**Interfaces:**
- Consumes: App `invitations`, `handleInvitationResponse` (Task 4) diteruskan sebagai props; `WorkspaceAvatar`; helper Task 4.

- [ ] **Step 1: Tes gagal** (sumber): judul seksi `Undangan untukmu`; tombol `Terima` / `Tolak` nonaktif offline dengan `title="Butuh koneksi internet"`; seksi tidak dirender bila kosong; `JoinListModal` merender `Owner: ` + `anggota` bila `owner_name` ada.
- [ ] **Step 2: FAIL.**
- [ ] **Step 3: Implementasi.** Tombol menampilkan status sibuk per kartu (cegah klik ganda).
- [ ] **Step 4: PASS**; `npm test`; inline OK.
- [ ] **Step 5: Commit** `feat(workspace): seksi Undangan untukmu dan pratinjau link yang lebih lengkap`

### Task 6: UI owner — undangan menunggu + link undangan di seksi Anggota

**Files:**
- Modify: `static/index.html` — `WorkspaceMembersSection` (owner): toast undang baru, daftar `Undangan menunggu` + `Batalkan`, bagian `Link undangan` (pilihan, `Buat link`, daftar link aktif, `Salin`, `Batalkan`, `Matikan semua link` + dialog konfirmasi)
- Test: `tests/offline/workspace_owner_invites_ui.test.js`

**Interfaces:**
- Consumes: endpoint Task 1 & 2; helper `linkUsageText`, `linkExpiryText` (Task 4); dialog Alurik `useDrawingScopeDialog` (pola Fase 0).

Teks persis: `Undangan dikirim ke @{username}`; `Undangan menunggu`; `Batalkan`; `Link undangan`; label `Berlaku` dengan opsi `1 jam` / `1 hari` / `7 hari`; label `Bisa dipakai` dengan opsi `1 orang` / `Maks 10 orang` / `Tanpa batas`; `Buat link`; `Salin`; `Link disalin`; `Belum ada link aktif.`; `Matikan semua link`; konfirmasi `Matikan semua link undangan workspace ini? Link yang sudah dibagikan tidak bisa dipakai lagi.`; toast `Semua link dimatikan`.

- [ ] **Step 1: Tes gagal** (sumber): semua teks di atas ada; `generate-link` dikirim dengan `expires_in` + `max_uses`; daftar link memuat dari `/links` dengan `{ network: true }` dan dimuat ulang setelah buat/batalkan; aksi nonaktif offline; tidak ada `confirm(`.
- [ ] **Step 2: FAIL.**
- [ ] **Step 3: Implementasi.** Link baru langsung muncul di daftar aktif (tidak lagi state sementara yang hilang).
- [ ] **Step 4: PASS**; `npm test`; inline OK; E2E Fase 0 & Fase 1 (`temporary_files/e2e_kelola_workspace_fase0.py`, `…fase1.py`) disesuaikan bila memaku perilaku undang-langsung (undang kini menunggu persetujuan) tanpa melemahkan yang dilindungi — jelaskan di laporan.
- [ ] **Step 5: Commit** `feat(workspace): kelola undangan menunggu dan link undangan di seksi Anggota`

### Task 7: Versi, E2E, verifikasi penuh

**Files:**
- Modify: versi SW di `static/sw.js`, `static/index.html` (2 tempat), `webapp.py` (`sw_cache`), `tests/test_version.py`, tes `tests/offline/*.test.js` yang memaku versi; `app.css?v=`; `.gitignore` (`temporary_files/e2e_kelola_workspace_fase2a/`)
- Create: `temporary_files/e2e_kelola_workspace_fase2a.py` (pola E2E Fase 1)

- [ ] **Step 1: Versi** nomor kosong berikutnya setelah `main` dan PR terbuka (cek `git show origin/main:static/sw.js` + branch PR terbuka), nama `taskflow-v<N>-kelola-workspace-fase2a`.
- [ ] **Step 2: E2E** (A owner, B, C; terang + gelap; 375 px): skenario spec §Pengujian E2E, termasuk notifikasi diklik → seksi undangan; badge muncul/hilang; `?join=` menampilkan owner + jumlah; offline.
- [ ] **Step 3: E2E dua kali → lulus**; E2E Fase 0 + Fase 1 lulus.
- [ ] **Step 4: Verifikasi penuh:** pytest, `npm test` (hanya `draw_local_reactive` pra-ada), inline OK.
- [ ] **Step 5: Commit** `chore: SW v<N> + E2E kelola workspace fase 2a`

## Di luar cakupan

Sama dengan spec.
