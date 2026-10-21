# Email Fase 0b — Mailer andal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Semua email Alurik lewat antrean SQLite persisten dengan retry, dikirim sebagai HTML + teks lewat SMTP STARTTLS/SSL/none yang diatur `.env`, dan dipantau dari kartu "Email" di halaman Admin.

**Architecture:** Tiga modul baru yang tidak mengimpor `webapp`: `mailer.py` (transport SMTP + klasifikasi error), `email_templates.py` (render murni), `email_outbox.py` (skema tabel, `enqueue`, `EmailWorker` thread daemon meniru `media_worker.py`). `webapp.py` hanya merangkai: migrasi, start worker, `/api/auth/forgot` → outbox, tiga endpoint admin. UI: kartu di `AdminPage` + helper murni `static/offline/emailadmin.js`.

**Tech Stack:** Python 3 stdlib (`smtplib`, `ssl`, `email.message.EmailMessage`, `html`, `threading`, `sqlite3`), FastAPI, React SPA satu file `static/index.html`, node `--test`.

**Spec:** `docs/superpowers/specs/2026-10-21-email-fase0b-mailer-design.md`

## Global Constraints

- Retry: percobaan gagal ke-1 → +1 menit, ke-2 → +5 menit, ke-3 → +30 menit, ke-4 → +120 menit, ke-5 → `failed`.
- Email reset: `expires_at` = dibuat + **50 menit**. Pembersihan: baris `sent`/`expired`/`failed` berumur > **30 hari** dihapus (saat start + sekali per 24 jam).
- Worker: polling **30 detik**, maks **20** baris per putaran, `wake()` membangunkan segera.
- `last_error` maks **300** karakter, nilai `SMTP_PASSWORD` disaring.
- Timestamp tabel: ISO UTC naif (`datetime.now(timezone.utc).replace(tzinfo=None).isoformat()`), sama dengan `media_worker._now()`.
- `SMTP_SECURITY` ∈ `starttls|ssl|none`; kosong → 465 = `ssl`, lainnya `starttls`; nilai lain → log warning + `starttls`. `SMTP_TIMEOUT` bawaan 15. `SMTP_REPLY_TO` opsional.
- Dev mode (`SMTP_HOST` kosong) tetap mencetak `[MAILER DEV MODE] to=… subject=…` + isi teks ke stdout dan log; baris outbox menjadi `sent`.
- Admin: email tes maks **5 per jam global** (429); 20 email terbaru; penyamaran = 2 karakter pertama lokal + `***@domain` (lokal ≤ 2 karakter → 1 karakter + `***`). Subjek/isi tidak pernah keluar dari API.
- Respons `/api/auth/forgot` tetap `_FORGOT_GENERIC`; batas 3/jam per user tetap.
- UI: teks Indonesia, ikon glyph duotone `VIEW_GLYPHS` (bukan emoji), token CSS tema terang + gelap, **tanpa `border-left` aksen**, tanpa scroll horizontal di 375 px.
- Rilis frontend: SW `CACHE` + fallback di `index.html` + `sw_cache` di `webapp.py` + `tests/test_version.py` + semua tes `tests/offline/*.test.js` yang memeriksa versi, dan `app.css?v=`. Saat plan ditulis `main` = `taskflow-v445-pages-icons` / `app.css?v=351` → pakai nomor kosong berikutnya setelah cek `origin/main` (target `taskflow-v446-email-mailer` / `?v=352`).
- CI workflow tidak diubah; tes `aiosmtpd` hanya `pytest.importorskip`.
- Perintah tes: `python3 -m pytest -q -p no:warnings tests/` (baseline cek dulu di `main`), `npm test` (1 kegagalan lama `draw_local_reactive` diterima), `node temporary_files/check_inline_scripts.js static/index.html`.

## Review Focus

1. **Server mati di tengah kirim** — baris tertinggal `sending`; harus kembali `queued` saat start, bukan menggantung selamanya (Task 3 `test_recover_stale_requeues_sending`).
2. **SMTP salah konfigurasi di produksi** (password salah) — email tidak boleh dicoba 5 kali × jeda panjang; langsung `failed` dengan pesan yang bisa dibaca admin tanpa password (Task 1 `test_auth_error_is_permanent_and_redacted`, Task 3 `test_permanent_error_fails_immediately`).
3. **`wake()` di proses yang worker-nya belum di-start** (tes, bot) — tidak boleh memulai thread diam-diam yang lalu mengirim/mengubah baris (Task 3 `test_wake_without_start_does_not_spawn_thread`).
4. **Username/link berisi HTML** di email reset — harus ter-escape, link `javascript:` ditolak (Task 2 `test_reset_escapes_username_and_link`, `test_rejects_non_http_link`).
5. **Admin dengan akun tanpa email** menekan "Kirim email tes" tanpa isi alamat — 400 dengan pesan jelas, bukan 500 (Task 5 `test_send_test_without_any_address_400`).

---

## File Structure

| File | Tanggung jawab |
|---|---|
| `config.py` (modify) | baca `SMTP_SECURITY`, `SMTP_REPLY_TO`, `SMTP_TIMEOUT` |
| `.env.example` (modify) | dokumentasi blok SMTP + contoh Brevo/Resend/Exim |
| `mailer.py` (rewrite) | `resolve_security`, `build_message`, `send_message`, `smtp_summary`, error permanen/sementara, `format_error` |
| `email_templates.py` (create) | `RenderedEmail`, `reset_password`, `smtp_test`, `_layout` |
| `email_outbox.py` (create) | `ensure_schema`, `enqueue`, `EmailWorker` |
| `webapp.py` (modify) | migrasi, `email_worker` global + startup, `/api/auth/forgot`, endpoint admin, `sw_cache` |
| `tests/conftest.py` (modify) | fixture `captured_emails` membaca `email_outbox` |
| `static/offline/emailadmin.js` (create) | helper murni kartu Admin |
| `static/index.html`, `static/app.css`, `static/sw.js` (modify) | kartu Email, gaya, precache, versi |
| `.agents/DECISIONS.md` (modify) | ADR baru |

---

### Task 1: Transport SMTP (`mailer.py`) + konfigurasi

**Files:**
- Modify: `config.py:68-74`, `.env.example` (blok SMTP), `mailer.py` (tulis ulang; hapus `send_reset_email` di Task 4)
- Test: `tests/test_mailer.py`

**Interfaces:**
- Produces (`mailer`):
  - `class MailPermanentError(Exception)`, `class MailTemporaryError(Exception)`; keduanya `.__str__()` sudah berupa teks `format_error`.
  - `resolve_security(value: str, port: int) -> str` → `"starttls"|"ssl"|"none"`.
  - `build_message(to: str, subject: str, text: str, html: str) -> EmailMessage`.
  - `send_message(msg: EmailMessage) -> None` — dev mode cetak + return; selain itu kirim; melempar dua kelas error di atas saja.
  - `smtp_summary() -> dict` → `{"mode": "dev"|"smtp", "host", "port", "security", "from"}` (host/port/security `None` saat dev).
  - `format_error(exc: BaseException) -> str` (≤ 300 char, password disaring).
  - Modul membaca konfigurasi lewat atribut modul `mailer.SMTP_HOST` dkk. (diimpor dari `config`) supaya tes bisa `monkeypatch.setattr(mailer, "SMTP_HOST", ...)`.

- [ ] **Step 1: Tulis tes gagal** `tests/test_mailer.py` dengan kelas palsu `FakeSMTP` (merekam `starttls`, `login`, `send_message`/`sendmail(from, to, data)`, `quit`; mendukung context manager) yang di-monkeypatch ke `mailer.smtplib.SMTP` dan `mailer.smtplib.SMTP_SSL`:
  - `test_resolve_security`: `("", 465)→"ssl"`, `("", 587)→"starttls"`, `("SSL", 587)→"ssl"`, `("none", 25)→"none"`, `("aneh", 587)→"starttls"`.
  - `test_dev_mode_prints_and_opens_no_connection` (capsys berisi `[MAILER DEV MODE] to=a@b.id subject=Hai`; `FakeSMTP` tidak pernah dibuat).
  - `test_starttls_mode_calls_starttls_and_login`, `test_ssl_mode_uses_smtp_ssl_without_starttls`, `test_none_mode_no_tls`, `test_no_login_when_user_empty`.
  - `test_envelope_sender_is_bare_address` (`SMTP_FROM="Alurik <noreply@x.id>"` → from envelope `noreply@x.id`).
  - `test_build_message_headers_and_parts`: `Subject`, `To`, `From`, `Date`, `Message-ID` berakhir `@x.id>`, `Auto-Submitted == "auto-generated"`, `X-Auto-Response-Suppress == "All"`, `Reply-To` hanya bila `SMTP_REPLY_TO` diisi; `get_content_type()=="multipart/alternative"`, bagian `text/plain` lalu `text/html`, UTF-8 (subjek "Tés ✓" utuh setelah `email.message_from_bytes(msg.as_bytes(), policy=default)`).
  - `test_auth_error_is_permanent_and_redacted`: `login` melempar `smtplib.SMTPAuthenticationError(535, b"bad creds rahasia123")`, `SMTP_PASSWORD="rahasia123"` → `MailPermanentError`, `"rahasia123" not in str(e)`, `"535" in str(e)`.
  - `test_recipient_refused_5xx_permanent_4xx_temporary` (`SMTPRecipientsRefused({"a@b.id": (550, b"no")})` → permanen; `(451, b"later")` → sementara).
  - `test_connection_errors_temporary` (`OSError`, `socket.timeout`, `SMTPServerDisconnected` → `MailTemporaryError`).
  - `test_format_error_truncates_300`.
  - `test_smtp_summary_dev_and_smtp` (dev → `{"mode": "dev", "host": None, ...}`; smtp tidak memuat user/password).
  - `test_roundtrip_aiosmtpd` diawali `pytest.importorskip("aiosmtpd")`: server lokal mode none, satu pesan diterima dengan dua bagian.
- [ ] **Step 2:** `python3 -m pytest -q -p no:warnings tests/test_mailer.py` → FAIL (atribut tidak ada).
- [ ] **Step 3: Implementasi.** `config.py`: `SMTP_SECURITY = os.getenv("SMTP_SECURITY", "")`, `SMTP_REPLY_TO = os.getenv("SMTP_REPLY_TO", "")`, `SMTP_TIMEOUT = int(os.getenv("SMTP_TIMEOUT", "15"))`. `mailer.py`: koneksi `smtplib.SMTP_SSL(host, port, timeout, context=ssl.create_default_context())` untuk ssl, `smtplib.SMTP(host, port, timeout)` + `starttls(context=…)` untuk starttls; klasifikasi error sesuai spec 3.4 (exception tak dikenal → sementara); `Message-ID` domain diambil dari `parseaddr(SMTP_FROM)[1]` setelah `@`, fallback `alurik.local`. `.env.example`: blok SMTP diganti keterangan dev mode + `SMTP_SECURITY=`, `SMTP_REPLY_TO=`, `SMTP_TIMEOUT=15` + contoh terkomentar Brevo (`smtp-relay.brevo.com` 587 starttls), Resend (`smtp.resend.com` 465 ssl, user `resend`), Exim lokal (`localhost` 587 starttls).
- [ ] **Step 4:** tes Task 1 PASS; `send_reset_email` lama masih ada sementara (dipakai webapp sampai Task 4) — biarkan, tetapi panggil `send_message(build_message(...))` di dalamnya agar tetap berfungsi. Jalankan suite penuh → tetap hijau.
- [ ] **Step 5: Commit** `feat(mailer): transport SMTP starttls/ssl/none, multipart, klasifikasi error`.

---

### Task 2: Template (`email_templates.py`)

**Files:**
- Create: `email_templates.py`
- Test: `tests/test_email_templates.py`

**Interfaces:**
- Produces:
  - `@dataclass(frozen=True) class RenderedEmail: subject: str; text: str; html: str`
  - `reset_password(username: str, link: str) -> RenderedEmail` — subjek `"Reset Password Alurik"`.
  - `smtp_test(host: str | None, port: int | None, security: str | None, sent_at_wib: str) -> RenderedEmail` — subjek `"Email tes Alurik"`; dev → host tampil `"(dev mode)"`.
  - `_layout(title: str, body_html: str, cta_label: str | None, cta_url: str | None, footer_domain: str) -> str` (internal).
  - `footer_domain` dari `config.WEBAPP_URL` (`urlparse(...).hostname`).

- [ ] **Step 1: Tes gagal:**
  - `test_reset_contains_link_in_text_and_html` (link muncul di `text` dan sebagai `href` di `html`; teks memuat `"berlaku 1 jam"` dan `"abaikan email ini"`; html memuat tombol `"Buat password baru"` dan kalimat cadangan `"salin link ini"`).
  - `test_reset_escapes_username_and_link`: username `<script>x</script>` → html tidak memuat `<script>`, memuat `&lt;script&gt;`; link `https://a.id/?reset_token=a&b"c` → `href` ter-escape (`&amp;`, `&quot;`).
  - `test_rejects_non_http_link`: `reset_password("u", "javascript:alert(1)")` → `ValueError`.
  - `test_layout_inline_only`: html tidak memuat `<style`, `<link`, `<img`, `url(`; memuat `#a8c500`, `#0f172a`, `max-width:560px`, `"Email ini dikirim otomatis oleh Alurik"`.
  - `test_smtp_test_never_mentions_credentials` (monkeypatch `config.SMTP_USER/SMTP_PASSWORD` → tidak muncul) dan memuat host, port, security, waktu.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** Implementasi dengan `html.escape(..., quote=True)` di setiap sisipan; teks reset mengikuti isi `mailer.send_reset_email` lama.
- [ ] **Step 4:** PASS.
- [ ] **Step 5: Commit** `feat(email): template HTML+teks reset password dan email tes`.

---

### Task 3: Outbox + worker (`email_outbox.py`)

**Files:**
- Create: `email_outbox.py`
- Test: `tests/test_email_outbox.py`

**Interfaces:**
- Consumes: `mailer.send_message`, `mailer.build_message`, `mailer.MailPermanentError`, `mailer.MailTemporaryError`, `mailer.format_error`; `email_templates.RenderedEmail`.
- Produces:
  - `ensure_schema(conn: sqlite3.Connection) -> None` — `CREATE TABLE IF NOT EXISTS email_outbox (...)` kolom persis spec 1.2 + `CREATE INDEX IF NOT EXISTS idx_email_outbox_due ON email_outbox(status, next_attempt_at)` + `idx_email_outbox_created ON email_outbox(created_at)`.
  - `utcnow() -> datetime` (naif UTC) dan `iso(dt) -> str`.
  - `enqueue(conn, *, kind: str, to_addr: str, rendered: RenderedEmail, user_id: int | None = None, expires_at: datetime | None = None, now: datetime | None = None) -> int` — status `queued`, `next_attempt_at = now`; tidak commit.
  - `RETRY_DELAYS_MIN = (1, 5, 30, 120)`, `MAX_ATTEMPTS = 5`, `POLL_SECONDS = 30`, `BATCH = 20`, `RETENTION_DAYS = 30`.
  - `class EmailWorker(connect: Callable[[], sqlite3.Connection], send: Callable[[EmailMessage], None] = mailer.send_message, now: Callable[[], datetime] = utcnow)` dengan `start()`, `wake()`, `is_alive() -> bool`, `run_due() -> int` (jumlah baris diproses), `recover_stale() -> int`, `purge_old() -> int`.
  - `wake()`: set `threading.Event`; bila thread **pernah** di-start dan sudah mati → `start()` ulang; bila belum pernah di-start → hanya set event.

- [ ] **Step 1: Tes gagal** (DB sqlite sementara per tes via `tmp_path`, `connect` mengembalikan koneksi `row_factory=sqlite3.Row`; `send` palsu merekam/ melempar; jam palsu `clock = [datetime(2026,10,21,0,0)]`, `now=lambda: clock[0]`):
  - `test_enqueue_and_send_success` → `sent`, `sent_at` terisi, `attempts==1`, pesan yang dikirim punya subjek baris.
  - `test_retry_schedule`: `send` selalu `MailTemporaryError("x")`; setelah tiap `run_due()` `next_attempt_at - now` = 1, 5, 30, 120 menit; `run_due()` sebelum jatuh tempo → 0 diproses; percobaan ke-5 → `failed`, `last_error == "x"`.
  - `test_permanent_error_fails_immediately` (`attempts==1`, `failed`).
  - `test_expired_not_sent` (`expires_at` lewat → `expired`, `send` tidak dipanggil).
  - `test_claim_is_atomic`: dua instance worker pada DB sama, `run_due()` keduanya → `send` dipanggil tepat sekali.
  - `test_recover_stale_requeues_sending` (baris `sending` → `queued`, return 1).
  - `test_purge_old`: `sent` 31 hari dihapus, `sent` 29 hari tetap, `queued` 40 hari tetap.
  - `test_unexpected_exception_does_not_kill_worker`: `send` melempar `RuntimeError` → diperlakukan sementara; `run_due()` tidak melempar.
  - `test_batch_limit_20` (25 baris → `run_due()` memproses 20).
  - `test_wake_without_start_does_not_spawn_thread` (`wake()` → `is_alive() is False`, baris tetap `queued`).
  - `test_thread_sends_after_wake` (`start()`, `enqueue`, `wake()`, tunggu ≤ 2 dtk sampai `sent`).
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** Implementasi. Loop thread: `recover_stale()` tidak dipanggil di sini (dipanggil webapp sebelum `start()`); tiap iterasi `run_due()`, `purge_old()` bila ≥ 24 jam sejak terakhir, lalu `event.wait(POLL_SECONDS)` + `event.clear()`; seluruh isi iterasi dalam `try/except Exception: log.exception`. Klaim: `UPDATE email_outbox SET status='sending', attempts=attempts+1, updated_at=? WHERE id=? AND status='queued'` lalu `commit`; rowcount 0 → lewati. Pesan dibangun dengan `mailer.build_message(to, subject, text, html)` saat kirim. Exception selain dua kelas mailer → sementara dengan `mailer.format_error(e)`.
- [ ] **Step 4:** PASS.
- [ ] **Step 5: Commit** `feat(email): outbox SQLite + EmailWorker dengan retry dan kedaluwarsa`.

---

### Task 4: Rangkai ke webapp (migrasi, startup, lupa password)

**Files:**
- Modify: `webapp.py` (impor; `migrate_db`; global `email_worker` di dekat `media_worker` ~L190; `startup` ~L1665; `forgot_password` ~L1908), `mailer.py` (hapus `send_reset_email`), `tests/conftest.py` (fixture), `tests/test_forgot_password.py`, `tests/test_account_profile.py` (hanya bila perlu), `.agents/DECISIONS.md`
- Test: `tests/test_forgot_password.py`, `tests/test_email_wiring.py`

**Interfaces:**
- Consumes: Task 1–3.
- Produces: global `webapp.email_worker: EmailWorker` (koneksi via fungsi yang sama dengan `_media_db_connect` atau `get_db` mentah yang mengembalikan koneksi tanpa context manager); fixture `captured_emails` → objek mirip list berisi dict `{"to", "kind", "status", "link"}` dari baris `email_outbox` yang dibuat setelah fixture dibuat (`id > max_id_awal`), `link` = regex `https?://\S*reset_token=[^\s"<]+` pada `body_text`; mendukung `len()`, indeks, iterasi, `[-1]`.

- [ ] **Step 1: Tes gagal** `tests/test_email_wiring.py`:
  - `test_migrate_creates_email_outbox` (tabel + kedua indeks ada setelah `webapp.migrate_db()`; dipanggil dua kali aman).
  - `test_forgot_enqueues_reset_with_50min_expiry`: baris `kind='reset'`, `to_addr` email user, `status='queued'`, `expires_at - created_at == 50 menit` (±1 dtk), `body_html` memuat link yang sama dengan `body_text`.
  - `test_forgot_response_unchanged_and_unknown_email_no_row`.
  - `test_forgot_wakes_worker` (monkeypatch `webapp.email_worker.wake` → dipanggil sekali).
  - `test_mailer_has_no_send_reset_email` (`not hasattr(mailer, "send_reset_email")`).
  Tes lama di `test_forgot_password.py` dan `test_account_profile.py` tetap memakai `captured_emails` tanpa diubah selain bila bentuk dict berbeda (field `link`, `to` dipertahankan; field `username` dihapus — sesuaikan asersi yang memakainya).
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** `migrate_db()` memanggil `email_outbox.ensure_schema(conn)`. `startup()`: setelah `migrate_db()`, `email_worker.recover_stale()`, `email_worker.purge_old()`, `email_worker.start()` (masing-masing dibungkus try/log seperti media worker). `forgot_password`: buang parameter `background_tasks` untuk email; di dalam `with get_db()` yang sama dengan insert token panggil `email_outbox.enqueue(conn, kind="reset", user_id=user["id"], to_addr=email, rendered=email_templates.reset_password(user["username"], reset_link), expires_at=now_utc + timedelta(minutes=50))`; setelah blok `email_worker.wake()`. Hapus `mailer.send_reset_email`. Ganti fixture `captured_emails` di `tests/conftest.py` sesuai Interfaces. Tambah ADR berikutnya di `.agents/DECISIONS.md` (cek nomor terakhir; saat plan ditulis ADR-024): "Email lewat outbox SQLite + worker thread di taskflow-web" — konteks (dev mode di produksi, email hilang saat gagal), keputusan (spec 1.1–1.4), konsekuensi (restart `taskflow-web`; bot belum memakai; email ganda mungkin saat crash di tengah kirim).
- [ ] **Step 4:** suite penuh PASS.
- [ ] **Step 5: Commit** `feat(email): lupa password lewat outbox; worker email di startup`.

---

### Task 5: Endpoint admin email

**Files:**
- Modify: `webapp.py` (dekat `/api/admin/users` ~L6198)
- Test: `tests/test_admin_email.py`

**Interfaces:**
- Consumes: `mailer.smtp_summary()`, `email_outbox.enqueue`, `email_templates.smtp_test`, `email_worker.wake/is_alive`, `get_admin_user`, `EMAIL_RE`.
- Produces (JSON persis spec 3.1):
  - `GET /api/admin/email/status` → `{mode, host, port, security, from, worker_alive, counts_7d: {sent, failed, queued, expired}, recent: [{id, kind, to, status, attempts, last_error, created_at, sent_at}]}`.
  - `POST /api/admin/email/test` body `{"to": str | null}` → `{"id": int}`.
  - `POST /api/admin/email/{email_id}/retry` → `{"ok": true}`.
  - Helper `mask_email(addr: str) -> str` (letakkan di `email_outbox.py`, diuji di sini).

- [ ] **Step 1: Tes gagal** (jadikan user admin lewat `db()` `UPDATE users SET is_admin=1`):
  - `test_non_admin_forbidden_on_all_three` (403).
  - `test_mask_email`: `"hi@jatahku.com"→"hi***@jatahku.com"`, `"a@b.id"→"a***@b.id"`, `"abc@x.id"→"ab***@x.id"`.
  - `test_status_dev_mode` (`mode=="dev"`, `host is None`) dan `test_status_smtp_mode` (monkeypatch `mailer.SMTP_HOST="smtp.x.id"`, `SMTP_PORT=465`, `SMTP_SECURITY=""` → `security=="ssl"`; respons tidak memuat `SMTP_USER`/`SMTP_PASSWORD`).
  - `test_status_recent_masks_and_hides_content`: setelah forgot → `recent[0]["to"]` tersamar; kunci `subject`, `body_text`, `body_html` tidak ada; `counts_7d["queued"]` menghitung `queued`+`sending`.
  - `test_send_test_defaults_to_admin_email` (baris `kind='test'`, `to_addr` = email admin) dan `test_send_test_custom_address_validated` (`"bukan-email"` → 400).
  - `test_send_test_without_any_address_400` (admin `email=NULL`, body `{}` → 400, detail `"Isi alamat tujuan atau tambahkan email di Pengaturan"`).
  - `test_send_test_rate_limit_5_per_hour` (ke-6 → 429; baris `kind='test'` > 1 jam lalu tidak dihitung).
  - `test_retry_failed_only`: `failed` → `queued`, `attempts==0`; `sent` → 400; id tak ada → 404; `reset` `failed` dengan `expires_at` lewat → 400 `"Link reset sudah kedaluwarsa — minta reset baru"`.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** Implementasi; waktu kirim email tes untuk template diformat WIB (`_TZ_JKT`, `"%d %b %Y %H:%M WIB"`).
- [ ] **Step 4:** suite penuh PASS.
- [ ] **Step 5: Commit** `feat(admin): status email, kirim email tes, coba lagi`.

---

### Task 6: Kartu "Email" di halaman Admin + rilis frontend

**Files:**
- Create: `static/offline/emailadmin.js`, `tests/offline/emailadmin.test.js`, `tests/offline/admin_email_card.test.js`
- Modify: `static/index.html` (`<script src>` di samping `accountbanner.js` ~L302; `AdminPage` ~L35777; glyph baru di `VIEW_GLYPHS` bila belum ada yang cocok), `static/app.css`, `static/sw.js` (precache + `CACHE`), `webapp.py` (`sw_cache`), `tests/test_version.py`, tes versi lain di `tests/offline/`

**Interfaces:**
- Consumes: endpoint Task 5.
- Produces `window.TF.emailadmin` (juga `module.exports` untuk node, pola sama dengan `accountbanner.js`):
  - `statusLabel(status) -> string`: `sent→"Terkirim"`, `queued→"Antre"`, `sending→"Mengirim"`, `failed→"Gagal"`, `expired→"Kedaluwarsa"`, lainnya → status apa adanya.
  - `kindLabel(kind)`: `reset→"Reset password"`, `test→"Email tes"`.
  - `badgeFor(status) -> "ok"|"warn"|"err"|"muted"`: sent→ok, queued/sending→warn, failed→err, expired→muted.
  - `modeBadge(summary) -> {tone: "warn"|"ok"|"err", text}`: `worker_alive===false` → err `"Worker email tidak berjalan"`; dev → warn `"Dev mode — email hanya dicetak ke log server"`; smtp → ok `` `SMTP: ${host}:${port} · ${security}` ``.
  - `isPollingDone(row) -> boolean`: status ∈ sent/failed/expired.
  - `POLL_MS = 3000`, `POLL_MAX_MS = 30000`.

- [ ] **Step 1: Tes gagal** `emailadmin.test.js` (semua fungsi + kasus di atas) dan `admin_email_card.test.js` (asersi sumber `index.html`: `AdminPage` memanggil `/api/admin/email/status`, `/api/admin/email/test`, `/api/admin/email/` + `/retry`; memakai `TF.emailadmin.modeBadge` dan `POLL_MAX_MS`; judul kartu `"Email"` memakai glyph, tanpa emoji 📧/✉️; `index.html` memuat `<script src="/static/offline/emailadmin.js">`; `sw.js` precache memuat path itu; CSS kartu tidak memuat `border-left`).
- [ ] **Step 2:** `npm test` → kegagalan baru sesuai harapan.
- [ ] **Step 3:** Implementasi kartu sesuai spec 3.2: muat status saat mount; badge; ringkasan 4 angka; form tes (input `type=email`, placeholder email admin) → POST → polling `status` tiap `POLL_MS` sampai baris `id` itu `isPollingDone` atau `POLL_MAX_MS` habis → toast `"Email tes terkirim"` / `"Email tes gagal: <last_error>"` / `"Email tes masih dalam antrean"`; tabel 20 email (kolom Jenis, Penerima, Status chip, Percobaan, Waktu lokal, Error dipotong 60 karakter dengan `title` penuh, aksi "Coba lagi" untuk `failed` → POST retry → muat ulang); ≤ 768 px daftar kartu; tombol "Muat ulang"; gagal muat → `"Gagal memuat status email"` + "Coba lagi". Polling dihentikan saat unmount. Naikkan versi rilis (lihat Global Constraints) di semua lokasi; `grep` nomor lama sampai bersih kecuali `.agents`/`docs`.
- [ ] **Step 4:** `npm test` (hanya `draw_local_reactive` gagal), `node temporary_files/check_inline_scripts.js static/index.html` OK, pytest penuh PASS.
- [ ] **Step 5: Commit** `feat(admin): kartu Email (status SMTP, email tes, riwayat, coba lagi) + SW vNNN`.

---

### Task 7: E2E, handover, PR

**Files:**
- Create: `temporary_files/e2e_admin_email.py`
- Modify: `.agents/CURRENT_STATE.md`, `.agents/SESSION_LOG.md`

- [ ] **Step 1:** E2E Playwright (pola `temporary_files/e2e_*.py` yang ada: server sementara dengan env tes, Chromium `/opt/pw-browsers`): admin login → halaman Admin → badge dev mode → "Kirim email tes" → dalam ≤ 30 dtk baris teratas berstatus "Terkirim" dan toast muncul; user non-admin tidak melihat kartu; user biasa "Lupa password" → baris "Reset password" muncul di kartu admin dengan penerima tersamar; ganti tema gelap; viewport 375 px tanpa scroll horizontal (`document.documentElement.scrollWidth <= 375`). Screenshot ke `temporary_files/e2e_admin_email/` (di-.gitignore seperti folder E2E lain).
- [ ] **Step 2:** Jalankan E2E → semua cek lulus.
- [ ] **Step 3:** Perbarui `.agents/CURRENT_STATE.md` (entri baru teratas: branch, versi SW, deploy = restart `taskflow-web` saja, isi, verifikasi, sisa, checklist SMTP/DNS dari spec) dan tambahkan entri `SESSION_LOG.md`.
- [ ] **Step 4:** Commit `docs(agents): email fase 0b`; `git fetch origin main` → merge bila `main` maju (resolusi versi: pakai nomor kosong berikutnya); push; buka draft PR via `gh api repos/mtyatno/taskflow-v4/pulls` (judul "Email Fase 0b: mailer andal (outbox + retry, HTML, kartu Admin)", isi: ringkasan, deploy, verifikasi, checklist SMTP).
