# Forgot Password — Email Reset Link

**Tanggal:** 2026-07-04
**Status:** Disetujui, siap dibuat plan implementasi

## Latar Belakang

TaskFlow belum punya jalur recovery password. User yang lupa password terkunci permanen (satu-satunya jalan: reset manual via DB oleh admin). Menjelang monetisasi SaaS publik (Free/Pro/Team), forgot password adalah fitur wajib.

Kondisi sekarang:

- Tabel `users` hanya punya `username`, `password_hash`, `display_name`, `telegram_id` — **tidak ada kolom email**.
- Registrasi (`POST /api/auth/register`) tidak meminta email.
- Tidak ada infrastruktur pengiriman email di codebase; semua notifikasi via bot Telegram.
- User belum setup domain + SMTP → kode dibuat sekarang, verifikasi kirim email nyata ditunda.

## Keputusan Desain

| Keputusan | Pilihan |
|---|---|
| Jalur recovery | Email (bukan Telegram) |
| Kebijakan email | **Wajib untuk registrasi baru**; user lama mengisi via Settings (tanpa email = tidak bisa reset) |
| Mekanisme | Reset link berisi token sekali-pakai, kedaluwarsa 1 jam |
| Pengiriman email | `smtplib` stdlib, tanpa dependency baru |
| SMTP belum siap | Dev mode: reset link dicetak ke log server, flow tetap bisa dites end-to-end |

## 1. Database

Migrasi mengikuti pola migrate-if-missing yang sudah ada:

- Di `repository.py` (bersama migrasi `is_admin`): `ALTER TABLE users ADD COLUMN email TEXT DEFAULT NULL` (nullable — user lama boleh kosong) + unique index case-insensitive `CREATE UNIQUE INDEX idx_users_email ON users(lower(email)) WHERE email IS NOT NULL`.
- Di `webapp.py` `migrate_db()` (bersama tabel auth lain: `telegram_link_tokens`, `magic_tokens`, `ext_tokens`) — tabel baru:

```sql
CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id),
    token_hash  TEXT NOT NULL,          -- SHA-256 hex dari token mentah
    created_at  TEXT NOT NULL,
    expires_at  TEXT NOT NULL,          -- created_at + 1 jam
    used_at     TEXT DEFAULT NULL       -- terisi = token hangus
)
```

Token mentah tidak pernah disimpan — hanya hash-nya, supaya kebocoran DB tidak membocorkan reset link aktif.

## 2. Backend (webapp.py)

### Konfigurasi (.env, pola config.py)

```
SMTP_HOST=          # kosong = dev mode (log link, tidak kirim email)
SMTP_PORT=587
SMTP_USER=
SMTP_PASSWORD=
SMTP_FROM=          # mis. "TaskFlow <noreply@domain>"
```

Tidak ada hardcode domain — reset link dibangun dari `WEBAPP_URL` yang sudah ada.

### `POST /api/auth/forgot` — body `{email}`

1. **Selalu** balas `200 {"message": "Jika email terdaftar, link reset sudah dikirim"}` — apa pun hasilnya (anti user-enumeration).
2. Jika email terdaftar:
   - Rate limit: maksimal 3 token dibuat per user per jam (hitung dari `password_reset_tokens.created_at`); lebih dari itu → tetap balas 200, tidak buat token.
   - Buat token: `secrets.token_urlsafe(32)`, simpan SHA-256-nya, `expires_at` = +1 jam.
   - Kirim email berisi link `{WEBAPP_URL}/?reset_token=<token>`.
   - Dev mode (SMTP_HOST kosong): cetak link ke log server alih-alih kirim email.
3. Pengiriman email dijalankan non-blocking (thread/executor) supaya response time tidak membocorkan ada/tidaknya akun.

### `POST /api/auth/reset` — body `{token, new_password}`

1. Validasi `new_password` dengan aturan yang sama dengan register (min 4, max 100).
2. Cari baris `password_reset_tokens` dengan `token_hash = sha256(token)`; tolak `400` jika: tidak ditemukan, `used_at` terisi, atau `expires_at` lewat. Pesan error generik ("Link tidak valid atau kedaluwarsa").
3. Valid → update `users.password_hash` (pakai `hash_password` yang ada), set `used_at`, dan hanguskan semua token lain milik user yang sama.

### `POST /api/auth/register` — perubahan

- Field baru `email` **wajib**: `EmailStr`-like validasi regex sederhana (tanpa dependency `email-validator` baru), lowercase-kan sebelum simpan.
- Email sudah dipakai → `400 "Email sudah terdaftar"`.

### Endpoint email untuk user lama

- `PATCH /api/auth/profile/email` (authenticated) — body `{email, current_password}`: verifikasi password lama, lalu set/ubah email. Password diminta supaya session yang dibajak tidak bisa membelokkan jalur recovery.
  - Path ini mengikuti temuan saat planning: frontend Settings **sudah punya** form email yang memanggil `PATCH /api/auth/profile/email`, tapi endpoint backend-nya tidak pernah dibuat. Kita implement di path yang sudah dipanggil itu (form frontend ditambah field password).
- `GET /api/auth/me` ditambah field `email` supaya Settings bisa menampilkannya.

## 3. Frontend (static/index.html)

- **Form login**: link "Lupa password?" → form input email → submit ke `/api/auth/forgot` → tampilkan pesan generik "Jika email terdaftar, link reset sudah dikirim."
- **Halaman reset**: saat load, SPA cek `?reset_token=` di URL (sebelum cek auth) → tampilkan form password baru + konfirmasi → submit ke `/api/auth/reset` → sukses: bersihkan query param, arahkan ke form login dengan pesan "Password berhasil diubah, silakan login."
- **Form registrasi**: field email wajib.
- **Settings**: section email — tampilkan email sekarang (atau "belum diisi"), form ubah email (minta password).
- **SW cache**: bump versi (wajib setiap perubahan static).

Catatan native (.exe/APK): link reset dari email terbuka di browser menuju web app — setelah password diganti, user login ulang di aplikasi native. Tidak perlu perubahan di sisi Tauri.

## 4. Error Handling

- Semua kegagalan validasi token → satu pesan generik, tanpa membedakan sebab (anti probing).
- Kegagalan SMTP saat kirim → log error di server; response ke user tetap 200 generik.
- `/api/auth/forgot` untuk email tak dikenal → 200 generik, tanpa token dibuat.

## 5. Testing

Test integrasi backend (pytest, jalan di CI — fastapi tidak tersedia lokal):

- Happy path: register dengan email → forgot → ambil token dari DB/log → reset → login dengan password baru sukses, password lama gagal.
- Token expired → 400; token sudah dipakai → 400; token acak → 400.
- Reset menghanguskan token lain milik user yang sama.
- Anti-enumeration: forgot dengan email tak terdaftar → 200, response body identik dengan email terdaftar.
- Rate limit: permintaan ke-4 dalam 1 jam → 200 tapi tidak ada token baru di DB.
- Register tanpa email atau format salah → 422/400; email duplikat → 400.
- `PUT /api/auth/email` dengan password salah → 401/400.

**Verifikasi kirim email nyata ditunda** sampai domain + SMTP di-setup user; sampai saat itu dev mode (link di log) yang dipakai.

## Di Luar Scope (disengaja, bisa menyusul)

- Verifikasi email saat registrasi (double opt-in).
- Invalidasi JWT/session aktif setelah reset password.
- Reset via Telegram sebagai jalur alternatif.
- Notifikasi email lain (billing/receipt) — fondasi SMTP-nya sudah tersedia setelah fitur ini.
