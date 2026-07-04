# Forgot Password (Email Reset Link) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** User yang lupa password bisa reset sendiri via link email sekali-pakai (expire 1 jam); registrasi baru wajib email; user lama isi email via Settings.

**Architecture:** Kolom `email` baru di `users` (nullable, wajib untuk registrasi baru) + tabel `password_reset_tokens` (simpan SHA-256 token, bukan token mentah). Endpoint `POST /api/auth/forgot` (anti-enumeration, rate-limited) kirim email via modul baru `mailer.py` (smtplib stdlib; SMTP belum di-setup → dev mode cetak link ke stdout/log). `POST /api/auth/reset` memvalidasi token dan mengganti password. Frontend SPA: link "Lupa password?" di LoginPage, komponen `ResetPasswordPage` yang aktif saat URL berisi `?reset_token=`, field email di RegisterPage, dan field password di form email Settings yang **sudah ada** tapi backend-nya belum pernah dibuat.

**Tech Stack:** FastAPI + sqlite3 + smtplib (stdlib, tanpa dependency baru), React (compiled `createElement` style di `static/index.html`), pytest + starlette TestClient (CI only).

**Spec:** `docs/superpowers/specs/2026-07-04-forgot-password-design.md`

## Global Constraints

- **Frontend source = compiled JS.** `static/index.html` di git berisi hasil kompilasi Babel (`/*#__PURE__*/React.createElement(...)`), BUKAN JSX. Semua kode frontend baru ditulis langsung dalam gaya `React.createElement`. Jangan menulis JSX.
- **SW cache bump wajib:** `static/sw.js` baris 1 `taskflow-v182-recurring-mojibake-fix` → `taskflow-v183-forgot-password`.
- **Tanpa dependency runtime baru.** Email pakai `smtplib` + `email.mime.text` (stdlib). Dependency test (`pytest`, `httpx`) hanya di CI.
- **fastapi TIDAK terinstall di environment lokal (Z:).** Test integrasi jalan di CI (`.github/workflows/test.yml`, dibuat di Task 1). Bukti RED/GREEN untuk test integrasi = hasil run CI, bukan run lokal. Jangan mencoba `pytest` lokal — akan gagal import.
- **Push = deploy.** `deploy.yml` ter-trigger oleh push ke `main` dan men-deploy ke VPS produksi. Commit lokal per task; **push hanya sekali di Task 6**. Perubahan backward compatible (kolom email nullable, endpoint baru) sehingga deploy aman.
- **Konvensi waktu:** `datetime.now(_TZ_JKT).isoformat()` (pola yang dipakai telegram_link_tokens di webapp.py). Perbandingan expired = perbandingan string isoformat (format sama → lexicographic aman).
- **Copy UI/error berbahasa Indonesia**, konsisten dengan yang ada ("Username atau password salah").
- **Pesan generik anti-enumeration:** `"Jika email terdaftar, link reset sudah dikirim"` — dipakai persis sama untuk email terdaftar, tidak terdaftar, maupun kena rate limit.

## File Structure

- Create: `mailer.py` — satu tanggung jawab: kirim email (dev mode = log link).
- Create: `tests/conftest.py` — harness TestClient (env var di-set sebelum import webapp) + helper register.
- Create: `tests/test_forgot_password.py` — seluruh test integrasi fitur ini.
- Create: `.github/workflows/test.yml` — CI pytest.
- Modify: `config.py` — 5 variabel SMTP.
- Modify: `.env.example` — blok SMTP.
- Modify: `repository.py` (±baris 412-415) — migrasi kolom `email` + unique index.
- Modify: `webapp.py` — tabel `password_reset_tokens` di `migrate_db()` (±baris 147), schema `RegisterReq` (±baris 438), endpoint register/login/me (±baris 784-823), endpoint baru `forgot`/`reset`/`profile/email` setelah blok auth routes.
- Modify: `static/index.html` — LoginPage (±baris 1935-2044), komponen baru `ResetPasswordPage` (disisip sebelum RegisterPage ±baris 2046), RegisterPage (±baris 2047-2071), SettingsPage form email (±baris 13645-13729, 13884-13896), App wiring (±baris 21427, 21818-21848).
- Modify: `static/sw.js` baris 1 — bump versi cache.

**PENTING — nomor baris di atas adalah posisi saat plan ini ditulis.** Selalu cari anchor string yang diberikan di tiap step, jangan mengandalkan nomor baris mentah.

---

### Task 1: Test harness + CI workflow

**Files:**
- Create: `tests/conftest.py`
- Create: `tests/test_forgot_password.py` (baru berisi 1 smoke test)
- Create: `.github/workflows/test.yml`

**Interfaces:**
- Produces: fixture `client` (TestClient baru per test, cookie jar sendiri), helper `register_user(client, username, email, password="pass1234") -> dict` (register + assert 200, return JSON respons: `{user_id, username, token, email}`), helper `db()` → koneksi sqlite ke DB test dengan `row_factory=Row`.
- Catatan kompatibilitas: plan `2026-06-27-tenant-isolation-hardening.md` Task 1 juga membuat `tests/conftest.py` + `test.yml`. Plan ini dieksekusi lebih dulu → saat plan 2a jalan nanti, file sudah ada dan 2a tinggal menambah fixture-nya (JANGAN menimpa). `register_user` di sini sudah menyertakan `email` karena setelah plan ini register wajib email.

- [ ] **Step 1: Tulis `tests/conftest.py`**

```python
"""
Test harness: set env var SEBELUM import webapp supaya DB/upload/secret
mengarah ke lokasi temp, bukan produksi. webapp membuat tabel di event
startup — di sini dipanggil langsung via migrate_db() karena TestClient
tanpa context manager tidak menjalankan lifespan.
"""
import os
import sqlite3
import tempfile

_TMP = tempfile.mkdtemp(prefix="taskflow-test-")
os.environ["DB_PATH"] = os.path.join(_TMP, "test.db")
os.environ["UPLOAD_DIR"] = os.path.join(_TMP, "uploads")
os.environ["WEB_SECRET_KEY"] = "test-secret-key"
os.environ["TELEGRAM_BOT_TOKEN"] = ""

import pytest  # noqa: E402
from starlette.testclient import TestClient  # noqa: E402

import webapp  # noqa: E402

webapp.migrate_db()


@pytest.fixture
def client():
    return TestClient(webapp.app)


def db():
    conn = sqlite3.connect(os.environ["DB_PATH"])
    conn.row_factory = sqlite3.Row
    return conn


def register_user(client, username, email, password="pass1234"):
    r = client.post("/api/auth/register", json={
        "username": username,
        "password": password,
        "email": email,
    })
    assert r.status_code == 200, r.text
    return r.json()
```

- [ ] **Step 2: Tulis smoke test di `tests/test_forgot_password.py`**

Smoke test ini membuktikan harness jalan dengan endpoint yang SUDAH ada (register belum wajib email pada titik ini — field ekstra diabaikan pydantic default):

```python
from conftest import register_user


def test_harness_register_login(client):
    data = register_user(client, "smokeuser", "smoke@test.id")
    assert data["username"] == "smokeuser"
    r = client.post("/api/auth/login", json={"username": "smokeuser", "password": "pass1234"})
    assert r.status_code == 200
    assert r.json()["user_id"] == data["user_id"]
```

- [ ] **Step 3: Tulis `.github/workflows/test.yml`**

`pytz`, `python-dotenv`, `dateparser` dibutuhkan oleh import chain webapp tapi tidak ada di `requirements-web.txt`:

```yaml
name: Tests

on:
  push:
    branches: [main]
  pull_request:
  workflow_dispatch:

jobs:
  test:
    runs-on: ubuntu-22.04
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "3.12"
      - name: Install deps
        run: |
          python -m pip install --upgrade pip
          pip install -r requirements-web.txt
          pip install pytz python-dotenv dateparser pytest httpx
      - name: Run tests
        run: python -m pytest tests/ -q
```

- [ ] **Step 4: Verifikasi sintaks Python lokal** (tanpa fastapi tetap bisa cek parse)

Run: `python -m py_compile tests/conftest.py tests/test_forgot_password.py`
Expected: exit 0, tanpa output.

- [ ] **Step 5: Commit**

```bash
git add tests/conftest.py tests/test_forgot_password.py .github/workflows/test.yml
git commit -m "test: pytest harness + CI workflow untuk test integrasi web"
```

---

### Task 2: Konfigurasi SMTP + mailer.py

**Files:**
- Modify: `config.py` (tambahkan di akhir file)
- Modify: `.env.example` (tambahkan blok SMTP)
- Create: `mailer.py`

**Interfaces:**
- Produces: `mailer.send_email(to: str, subject: str, body: str) -> None` (raise exception SMTP jika gagal kirim); `mailer.send_reset_email(to: str, username: str, reset_link: str) -> None` (TIDAK raise — menelan + log error, karena dipanggil dari BackgroundTasks dan kegagalan SMTP tidak boleh bocor ke response). `SMTP_HOST` kosong → dev mode: cetak link ke stdout + log, tidak kirim apa pun.
- Consumes: —

- [ ] **Step 1: Tambah variabel SMTP di `config.py`** (append di akhir file, mengikuti pola `os.getenv` yang ada)

```python
# SMTP untuk email transaksional (reset password).
# SMTP_HOST kosong = dev mode: email tidak dikirim, isinya dicetak ke log server.
SMTP_HOST = os.getenv("SMTP_HOST", "")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USER = os.getenv("SMTP_USER", "")
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "")
SMTP_FROM = os.getenv("SMTP_FROM", "TaskFlow <noreply@localhost>")
```

- [ ] **Step 2: Tambah blok SMTP di `.env.example`** (append)

```
# SMTP — email transaksional (reset password). Kosongkan SMTP_HOST untuk dev mode (link dicetak ke log).
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASSWORD=
SMTP_FROM=TaskFlow <noreply@example.com>
```

- [ ] **Step 3: Tulis `mailer.py`**

```python
"""
TaskFlow - pengiriman email transaksional via SMTP (stdlib, tanpa dependency).
SMTP_HOST kosong = dev mode: email tidak dikirim, isi dicetak ke stdout/log
supaya flow reset password tetap bisa dites end-to-end sebelum SMTP di-setup.
"""
import logging
import smtplib
from email.mime.text import MIMEText

from config import SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, SMTP_FROM

log = logging.getLogger("mailer")


def send_email(to: str, subject: str, body: str) -> None:
    if not SMTP_HOST:
        msg = f"[MAILER DEV MODE] to={to} subject={subject}\n{body}"
        print(msg, flush=True)
        log.warning(msg)
        return
    msg = MIMEText(body, "plain", "utf-8")
    msg["Subject"] = subject
    msg["From"] = SMTP_FROM
    msg["To"] = to
    with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=15) as s:
        s.starttls()
        if SMTP_USER:
            s.login(SMTP_USER, SMTP_PASSWORD)
        s.sendmail(SMTP_FROM, [to], msg.as_string())


def send_reset_email(to: str, username: str, reset_link: str) -> None:
    # Dipanggil dari BackgroundTasks — jangan raise: kegagalan SMTP cukup di-log,
    # response ke user sudah terkirim dan tetap generik (anti-enumeration).
    subject = "Reset Password TaskFlow"
    body = (
        f"Halo {username},\n\n"
        f"Kami menerima permintaan reset password untuk akun TaskFlow-mu.\n"
        f"Klik link berikut untuk membuat password baru (berlaku 1 jam, sekali pakai):\n\n"
        f"{reset_link}\n\n"
        f"Jika kamu tidak merasa meminta reset password, abaikan email ini — "
        f"password-mu tidak berubah.\n"
    )
    try:
        send_email(to, subject, body)
    except Exception:
        log.exception("Gagal kirim email reset ke %s", to)
```

- [ ] **Step 4: Verifikasi lokal** (mailer tidak butuh fastapi — bisa dites langsung)

Run: `python -c "import mailer; mailer.send_reset_email('a@b.id', 'tester', 'https://x/?reset_token=abc')"`
Expected: output stdout diawali `[MAILER DEV MODE] to=a@b.id` dan memuat link `https://x/?reset_token=abc`. Exit 0.

- [ ] **Step 5: Commit**

```bash
git add config.py .env.example mailer.py
git commit -m "feat: mailer smtplib + konfigurasi SMTP (dev mode log link)"
```

---

### Task 3: Migrasi DB + register wajib email + /me + PATCH profile/email

**Files:**
- Modify: `repository.py` (blok migrasi `is_admin`, ±baris 412)
- Modify: `webapp.py` (`migrate_db()` ±baris 147; `RegisterReq` ±baris 438; endpoint register/login/me ±baris 784-823; endpoint baru setelah `/api/auth/logout`)
- Modify: `tests/test_forgot_password.py` (tambah test)

**Interfaces:**
- Consumes: `register_user`, `db` dari `tests/conftest.py` (Task 1).
- Produces:
  - Kolom `users.email TEXT DEFAULT NULL` + unique index `idx_users_email` pada `lower(email)`.
  - Tabel `password_reset_tokens(id, user_id, token_hash, created_at, expires_at, used_at)` — dipakai Task 4.
  - `EMAIL_RE` (module-level regex di webapp.py) — dipakai Task 4 tidak, tapi dipakai register + profile/email.
  - `POST /api/auth/register` body wajib `email`; respons + field `"email"`.
  - `POST /api/auth/login` respons + field `"email"`.
  - `GET /api/auth/me` respons + field `"email"`.
  - `PATCH /api/auth/profile/email` body `{email, current_password}` → `{ok, email}` (endpoint yang SUDAH dipanggil frontend Settings tapi belum pernah ada di backend).

- [ ] **Step 1: Tulis failing tests** (append ke `tests/test_forgot_password.py`)

```python
from conftest import db


def test_register_requires_email(client):
    r = client.post("/api/auth/register", json={"username": "noemail", "password": "pass1234"})
    assert r.status_code == 422  # pydantic: field email wajib


def test_register_rejects_invalid_email(client):
    r = client.post("/api/auth/register", json={
        "username": "bademail", "password": "pass1234", "email": "bukan-email",
    })
    assert r.status_code == 400
    assert "email" in r.json()["detail"].lower()


def test_register_rejects_duplicate_email_case_insensitive(client):
    register_user(client, "dupemail1", "dup@test.id")
    r = client.post("/api/auth/register", json={
        "username": "dupemail2", "password": "pass1234", "email": "DUP@test.id",
    })
    assert r.status_code == 400
    assert "sudah terdaftar" in r.json()["detail"]


def test_me_and_login_include_email(client):
    data = register_user(client, "emailme", "me@test.id")
    assert data["email"] == "me@test.id"
    r = client.post("/api/auth/login", json={"username": "emailme", "password": "pass1234"})
    assert r.json()["email"] == "me@test.id"
    me = client.get("/api/auth/me", headers={"Authorization": f"Bearer {data['token']}"})
    assert me.status_code == 200
    assert me.json()["email"] == "me@test.id"


def test_change_email_requires_correct_password(client):
    data = register_user(client, "changer", "old@test.id")
    h = {"Authorization": f"Bearer {data['token']}"}
    r = client.patch("/api/auth/profile/email",
                     json={"email": "new@test.id", "current_password": "SALAH"}, headers=h)
    assert r.status_code == 400
    r = client.patch("/api/auth/profile/email",
                     json={"email": "new@test.id", "current_password": "pass1234"}, headers=h)
    assert r.status_code == 200
    assert r.json()["email"] == "new@test.id"
    me = client.get("/api/auth/me", headers=h)
    assert me.json()["email"] == "new@test.id"
```

- [ ] **Step 2: Migrasi kolom email di `repository.py`**

Cari blok ini (±baris 412):

```python
            # Migrate: add is_admin to users if missing
            user_cols = [r["name"] for r in conn.execute("PRAGMA table_info(users)").fetchall()]
            if "is_admin" not in user_cols:
                conn.execute("ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0")
```

Tambahkan tepat setelahnya (indentasi sama):

```python
            # Migrate: add email to users if missing (forgot-password / SaaS)
            if "email" not in user_cols:
                conn.execute("ALTER TABLE users ADD COLUMN email TEXT DEFAULT NULL")
            conn.execute(
                "CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email "
                "ON users(lower(email)) WHERE email IS NOT NULL"
            )
```

- [ ] **Step 3: Tabel `password_reset_tokens` di `webapp.py` `migrate_db()`**

Di dalam `migrate_db()` (±baris 147), setelah blok `CREATE TABLE IF NOT EXISTS telegram_link_tokens (...)`, tambahkan:

```python
        conn.execute("""
            CREATE TABLE IF NOT EXISTS password_reset_tokens (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id     INTEGER NOT NULL,
                token_hash  TEXT NOT NULL,
                created_at  TEXT NOT NULL,
                expires_at  TEXT NOT NULL,
                used_at     TEXT DEFAULT NULL
            )
        """)
        conn.execute("CREATE INDEX IF NOT EXISTS idx_prt_token_hash ON password_reset_tokens(token_hash)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_prt_user ON password_reset_tokens(user_id)")
```

- [ ] **Step 4: Schema + endpoint di `webapp.py`**

4a. Tambah `EMAIL_RE` module-level, letakkan setelah baris `JWT_EXPIRE_HOURS = ...` (±baris 58):

```python
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
```

4b. `RegisterReq` (±baris 438) — tambah field email:

```python
class RegisterReq(BaseModel):
    username: str = Field(min_length=3, max_length=50)
    password: str = Field(min_length=4, max_length=100)
    display_name: str = ""
    email: str = Field(min_length=5, max_length=255)
```

4c. Endpoint register (±baris 784) — validasi + simpan email. Ganti seluruh fungsi menjadi:

```python
@app.post("/api/auth/register")
async def register(req: RegisterReq, response: Response):
    email = req.email.strip().lower()
    if not EMAIL_RE.match(email):
        raise HTTPException(status_code=400, detail="Format email tidak valid")
    with get_db() as conn:
        existing = conn.execute("SELECT id FROM users WHERE username = ?", (req.username,)).fetchone()
        if existing:
            raise HTTPException(status_code=400, detail="Username sudah digunakan")
        dup = conn.execute("SELECT id FROM users WHERE lower(email) = ?", (email,)).fetchone()
        if dup:
            raise HTTPException(status_code=400, detail="Email sudah terdaftar")

        now = datetime.now().isoformat()
        cur = conn.execute(
            "INSERT INTO users (username, password_hash, display_name, email, created_at) VALUES (?,?,?,?,?)",
            (req.username, hash_password(req.password), req.display_name or req.username, email, now),
        )
        user_id = cur.lastrowid

    token = create_token(user_id, req.username)
    response.set_cookie("token", token, httponly=True, samesite="lax", max_age=JWT_EXPIRE_HOURS * 3600)
    return {"user_id": user_id, "username": req.username, "email": email, "token": token}
```

4d. Endpoint login (±baris 803) — tambah `"email": user["email"]` pada dict return:

```python
    return {"user_id": user["id"], "username": user["username"], "display_name": user["display_name"], "email": user["email"], "token": token}
```

4e. Endpoint `/api/auth/me` (±baris 818) — tambah `email` ke SELECT:

```python
        row = conn.execute("SELECT id, username, display_name, email, created_at, telegram_id, is_admin FROM users WHERE id = ?", (user["sub"],)).fetchone()
```

4f. Endpoint baru `PATCH /api/auth/profile/email` — letakkan setelah fungsi `logout` (±baris 845). Schema `EmailChangeReq` letakkan bersama schema auth lain (setelah `LoginReq`):

```python
class EmailChangeReq(BaseModel):
    email: str
    current_password: str
```

```python
@app.patch("/api/auth/profile/email")
async def change_email(req: EmailChangeReq, user=Depends(get_current_user)):
    email = req.email.strip().lower()
    if not EMAIL_RE.match(email):
        raise HTTPException(status_code=400, detail="Format email tidak valid")
    with get_db() as conn:
        row = conn.execute("SELECT password_hash FROM users WHERE id = ?", (user["sub"],)).fetchone()
        if not row or not verify_password(req.current_password, row["password_hash"]):
            raise HTTPException(status_code=400, detail="Password salah")
        dup = conn.execute(
            "SELECT id FROM users WHERE lower(email) = ? AND id != ?", (email, user["sub"])
        ).fetchone()
        if dup:
            raise HTTPException(status_code=400, detail="Email sudah terdaftar")
        conn.execute("UPDATE users SET email = ? WHERE id = ?", (email, user["sub"]))
    return {"ok": True, "email": email}
```

- [ ] **Step 5: Perbaiki smoke test Task 1**

`test_harness_register_login` di Task 1 memakai `register_user` yang sudah mengirim email — setelah step ini register mensyaratkan email, test tetap valid tanpa perubahan. Pastikan saja tidak ada test lain yang register tanpa email.

- [ ] **Step 6: Verifikasi sintaks lokal**

Run: `python -m py_compile webapp.py repository.py tests/test_forgot_password.py`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add repository.py webapp.py tests/test_forgot_password.py
git commit -m "feat: kolom email users + register wajib email + PATCH profile/email"
```

---

### Task 4: Endpoint forgot + reset

**Files:**
- Modify: `webapp.py` (import; schema; 2 endpoint baru setelah `change_email`)
- Modify: `tests/conftest.py` (fixture `captured_emails`)
- Modify: `tests/test_forgot_password.py` (test flow reset)

**Interfaces:**
- Consumes: `mailer.send_reset_email` (Task 2), tabel `password_reset_tokens` + `EMAIL_RE` (Task 3), `WEBAPP_URL` dari config.py (sudah ada, ±baris 42 config.py).
- Produces:
  - `POST /api/auth/forgot` body `{email}` → SELALU `200 {"message": "Jika email terdaftar, link reset sudah dikirim"}`.
  - `POST /api/auth/reset` body `{token, new_password}` → `200 {"ok": true}` atau `400 "Link tidak valid atau kedaluwarsa"`.
  - Fixture pytest `captured_emails` → list of `{"to","username","link"}`.

- [ ] **Step 1: Fixture `captured_emails`** (append ke `tests/conftest.py`)

```python
@pytest.fixture
def captured_emails(monkeypatch):
    """Tangkap panggilan mailer.send_reset_email alih-alih kirim email sungguhan.
    webapp memanggil mailer.send_reset_email sebagai atribut modul, jadi patch
    di modul mailer berlaku juga untuk webapp. TestClient menjalankan
    BackgroundTasks secara sinkron setelah response — list terisi begitu
    request selesai."""
    import mailer
    sent = []
    monkeypatch.setattr(
        mailer, "send_reset_email",
        lambda to, username, reset_link: sent.append(
            {"to": to, "username": username, "link": reset_link}
        ),
    )
    return sent
```

- [ ] **Step 2: Tulis failing tests** (append ke `tests/test_forgot_password.py`)

```python
from datetime import datetime, timedelta


def _token_from_link(link):
    return link.split("reset_token=")[1]


def test_forgot_reset_happy_path(client, captured_emails):
    register_user(client, "resetme", "resetme@test.id")
    r = client.post("/api/auth/forgot", json={"email": "resetme@test.id"})
    assert r.status_code == 200
    assert len(captured_emails) == 1
    token = _token_from_link(captured_emails[0]["link"])

    r = client.post("/api/auth/reset", json={"token": token, "new_password": "barubanget9"})
    assert r.status_code == 200

    assert client.post("/api/auth/login", json={
        "username": "resetme", "password": "barubanget9"}).status_code == 200
    assert client.post("/api/auth/login", json={
        "username": "resetme", "password": "pass1234"}).status_code == 401


def test_forgot_unknown_email_indistinguishable(client, captured_emails):
    register_user(client, "known1", "known1@test.id")
    r_known = client.post("/api/auth/forgot", json={"email": "known1@test.id"})
    r_unknown = client.post("/api/auth/forgot", json={"email": "ghost@test.id"})
    assert r_known.status_code == r_unknown.status_code == 200
    assert r_known.json() == r_unknown.json()
    # unknown email: tidak ada email terkirim untuknya, tidak ada token dibuat
    assert all(e["to"] != "ghost@test.id" for e in captured_emails)


def test_reset_rejects_bad_expired_and_reused_token(client, captured_emails):
    data = register_user(client, "tokuser", "tok@test.id")
    client.post("/api/auth/forgot", json={"email": "tok@test.id"})
    token = _token_from_link(captured_emails[0]["link"])

    # token acak
    assert client.post("/api/auth/reset", json={
        "token": "ngawur", "new_password": "apapun99"}).status_code == 400

    # token expired (mundurkan expires_at langsung di DB — scoped ke user ini
    # supaya tidak mengganggu token milik test lain; DB dipakai bersama semodule)
    conn = db()
    conn.execute("UPDATE password_reset_tokens SET expires_at = ? WHERE user_id = ?",
                 ((datetime.now() - timedelta(hours=2)).isoformat(), data["user_id"]))
    conn.commit(); conn.close()
    assert client.post("/api/auth/reset", json={
        "token": token, "new_password": "apapun99"}).status_code == 400

    # token valid → sukses → dipakai ulang → 400
    client.post("/api/auth/forgot", json={"email": "tok@test.id"})
    token2 = _token_from_link(captured_emails[-1]["link"])
    assert client.post("/api/auth/reset", json={
        "token": token2, "new_password": "apapun99"}).status_code == 200
    assert client.post("/api/auth/reset", json={
        "token": token2, "new_password": "lainlagi99"}).status_code == 400


def test_reset_invalidates_other_tokens(client, captured_emails):
    register_user(client, "multi", "multi@test.id")
    client.post("/api/auth/forgot", json={"email": "multi@test.id"})
    client.post("/api/auth/forgot", json={"email": "multi@test.id"})
    tok_a = _token_from_link(captured_emails[0]["link"])
    tok_b = _token_from_link(captured_emails[1]["link"])
    assert client.post("/api/auth/reset", json={
        "token": tok_b, "new_password": "pilihanB99"}).status_code == 200
    # token A ikut hangus
    assert client.post("/api/auth/reset", json={
        "token": tok_a, "new_password": "pilihanA99"}).status_code == 400


def test_forgot_rate_limit_3_per_hour(client, captured_emails):
    data = register_user(client, "spammer", "spam@test.id")
    for _ in range(4):
        r = client.post("/api/auth/forgot", json={"email": "spam@test.id"})
        assert r.status_code == 200  # respons tetap generik
    assert len(captured_emails) == 3  # permintaan ke-4 tidak membuat token/email
    conn = db()
    n = conn.execute(
        "SELECT COUNT(*) AS n FROM password_reset_tokens WHERE user_id = ?",
        (data["user_id"],)).fetchone()["n"]
    conn.close()
    assert n == 3
```

- [ ] **Step 3: Implementasi di `webapp.py`**

3a. Tambah import: pada baris `from config import ...` (±baris 42) tambahkan `WEBAPP_URL`; setelah `import review_history` (±baris 53) tambahkan:

```python
import mailer
```

3b. Schema, letakkan setelah `EmailChangeReq`:

```python
class ForgotReq(BaseModel):
    email: str

class ResetReq(BaseModel):
    token: str = Field(min_length=1)
    new_password: str = Field(min_length=4, max_length=100)
```

3c. Endpoint, letakkan setelah `change_email`:

```python
_FORGOT_GENERIC = {"message": "Jika email terdaftar, link reset sudah dikirim"}

@app.post("/api/auth/forgot")
async def forgot_password(req: ForgotReq, background_tasks: BackgroundTasks):
    email = req.email.strip().lower()
    with get_db() as conn:
        user = conn.execute(
            "SELECT id, username FROM users WHERE lower(email) = ?", (email,)
        ).fetchone()
        if not user:
            return _FORGOT_GENERIC
        one_hour_ago = (datetime.now(_TZ_JKT) - timedelta(hours=1)).isoformat()
        recent = conn.execute(
            "SELECT COUNT(*) AS n FROM password_reset_tokens WHERE user_id = ? AND created_at > ?",
            (user["id"], one_hour_ago),
        ).fetchone()["n"]
        if recent >= 3:
            return _FORGOT_GENERIC
        token = secrets.token_urlsafe(32)
        now = datetime.now(_TZ_JKT)
        conn.execute(
            "INSERT INTO password_reset_tokens (user_id, token_hash, created_at, expires_at) VALUES (?,?,?,?)",
            (
                user["id"],
                hashlib.sha256(token.encode()).hexdigest(),
                now.isoformat(),
                (now + timedelta(hours=1)).isoformat(),
            ),
        )
    reset_link = f"{WEBAPP_URL}/?reset_token={token}"
    background_tasks.add_task(mailer.send_reset_email, email, user["username"], reset_link)
    return _FORGOT_GENERIC


@app.post("/api/auth/reset")
async def reset_password(req: ResetReq):
    token_hash = hashlib.sha256(req.token.encode()).hexdigest()
    now = datetime.now(_TZ_JKT).isoformat()
    with get_db() as conn:
        row = conn.execute(
            "SELECT * FROM password_reset_tokens WHERE token_hash = ?", (token_hash,)
        ).fetchone()
        if not row or row["used_at"] or row["expires_at"] < now:
            raise HTTPException(status_code=400, detail="Link tidak valid atau kedaluwarsa")
        conn.execute(
            "UPDATE users SET password_hash = ? WHERE id = ?",
            (hash_password(req.new_password), row["user_id"]),
        )
        conn.execute(
            "UPDATE password_reset_tokens SET used_at = ? WHERE user_id = ? AND used_at IS NULL",
            (now, row["user_id"]),
        )
    return {"ok": True}
```

Catatan: `BackgroundTasks` sudah ada di import fastapi webapp.py; `hashlib`, `secrets`, `timedelta`, `_TZ_JKT` juga sudah ada.

- [ ] **Step 4: Verifikasi sintaks lokal**

Run: `python -m py_compile webapp.py tests/conftest.py tests/test_forgot_password.py`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add webapp.py tests/conftest.py tests/test_forgot_password.py
git commit -m "feat: endpoint forgot/reset password (token hash, anti-enumeration, rate limit)"
```

---

### Task 5: Frontend — lupa password, halaman reset, email di register & Settings

**Files:**
- Modify: `static/index.html` (5 lokasi, anchor string di tiap step)
- Modify: `static/sw.js` (baris 1)

**Interfaces:**
- Consumes: `POST /api/auth/forgot`, `POST /api/auth/reset` (Task 4), `PATCH /api/auth/profile/email`, field `email` di respons register/login/me (Task 3). Helper yang sudah ada di file: `api.post`, `api.patch`, komponen `Field`, `useState`.
- Produces: komponen `ResetPasswordPage({ token, onDone })`.
- **Ingat: tulis dalam gaya compiled `React.createElement`, BUKAN JSX.**

- [ ] **Step 1: LoginPage — state & handler forgot**

Anchor (±baris 1940-1942), cari:

```js
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
```

di dalam `function LoginPage(...)`. Tambahkan tepat setelahnya:

```js
  const [forgotMode, setForgotMode] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotMsg, setForgotMsg] = useState("");
  const handleForgot = async e => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const data = await api.post("/api/auth/forgot", { email: forgotEmail });
      setForgotMsg(data.message || "Jika email terdaftar, link reset sudah dikirim");
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  };
```

- [ ] **Step 2: LoginPage — render mode forgot (early return)**

Tepat sebelum `return /*#__PURE__*/React.createElement("div", {` milik LoginPage (±baris 1958; pastikan masih di dalam LoginPage, setelah `handleForgot` yang baru ditambahkan), sisipkan:

```js
  if (forgotMode) {
    return /*#__PURE__*/React.createElement("div", {
      style: { minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "linear-gradient(135deg, #0f172a 0%, #1e3a5f 100%)" }
    }, /*#__PURE__*/React.createElement("div", {
      className: "card scale-in",
      style: { width: 400, padding: 36 }
    }, /*#__PURE__*/React.createElement("div", {
      style: { textAlign: "center", marginBottom: 28 }
    }, /*#__PURE__*/React.createElement("div", {
      style: { fontSize: 32, fontWeight: 700, color: "var(--bg-primary)" }
    }, "⚡ TaskFlow"), /*#__PURE__*/React.createElement("div", {
      style: { fontSize: 14, color: "var(--text-secondary)", marginTop: 4 }
    }, "Lupa Password")), forgotMsg ? /*#__PURE__*/React.createElement("div", {
      style: { textAlign: "center", fontSize: 14, color: "var(--text-secondary)", lineHeight: 1.6 }
    }, "✉️ ", forgotMsg) : /*#__PURE__*/React.createElement("form", {
      onSubmit: handleForgot
    }, /*#__PURE__*/React.createElement("label", {
      className: "input-label"
    }, "Email"), /*#__PURE__*/React.createElement("input", {
      className: "input",
      type: "email",
      value: forgotEmail,
      onChange: e => setForgotEmail(e.target.value),
      required: true,
      autoFocus: true,
      placeholder: "email akunmu",
      style: { marginBottom: 6 }
    }), error && /*#__PURE__*/React.createElement("div", {
      style: { color: "#ef4444", fontSize: 13, marginTop: 8 }
    }, error), /*#__PURE__*/React.createElement("button", {
      className: "btn btn-primary",
      type: "submit",
      disabled: loading,
      style: { width: "100%", justifyContent: "center", marginTop: 18, padding: "12px 0" }
    }, loading ? "Mengirim..." : "Kirim Link Reset")), /*#__PURE__*/React.createElement("div", {
      style: { textAlign: "center", marginTop: 18, fontSize: 14 }
    }, /*#__PURE__*/React.createElement("span", {
      onClick: () => { setForgotMode(false); setForgotMsg(""); setError(""); },
      style: { color: "var(--accent)", cursor: "pointer", fontWeight: 600 }
    }, "← Kembali ke login"))));
  }
```

- [ ] **Step 3: LoginPage — link "Lupa password?"**

Anchor (±baris 2029): cari di LoginPage

```js
  }, loading ? "Loading..." : "Login")), /*#__PURE__*/React.createElement("div", {
```

Ganti menjadi (menyisipkan satu elemen link di antara tombol Login dan blok "Belum punya akun?"):

```js
  }, loading ? "Loading..." : "Login")), /*#__PURE__*/React.createElement("div", {
    style: { textAlign: "center", marginTop: 12, fontSize: 13 }
  }, /*#__PURE__*/React.createElement("span", {
    onClick: () => { setForgotMode(true); setError(""); },
    style: { color: "var(--accent)", cursor: "pointer" }
  }, "Lupa password?")), /*#__PURE__*/React.createElement("div", {
```

Perhatikan: hanya kemunculan di LoginPage (`loading ? "Loading..." : "Login"` unik — tombol register memakai teks lain).

- [ ] **Step 4: Komponen `ResetPasswordPage`**

Sisipkan sebelum baris komentar `// ── Register Page ───────────────────────────────────────────` (±baris 2046):

```js
// ── Reset Password Page (dibuka via link email ?reset_token=...) ─────────────
function ResetPasswordPage({
  token,
  onDone
}) {
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const handleSubmit = async e => {
    e.preventDefault();
    if (pw !== confirm) {
      setError("Password tidak cocok");
      return;
    }
    setLoading(true);
    setError("");
    try {
      await api.post("/api/auth/reset", { token, new_password: pw });
      setDone(true);
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  };
  return /*#__PURE__*/React.createElement("div", {
    style: { minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "linear-gradient(135deg, #0f172a 0%, #1e3a5f 100%)" }
  }, /*#__PURE__*/React.createElement("div", {
    className: "card scale-in",
    style: { width: 400, padding: 36 }
  }, /*#__PURE__*/React.createElement("div", {
    style: { textAlign: "center", marginBottom: 28 }
  }, /*#__PURE__*/React.createElement("div", {
    style: { fontSize: 32, fontWeight: 700, color: "var(--bg-primary)" }
  }, "⚡ TaskFlow"), /*#__PURE__*/React.createElement("div", {
    style: { fontSize: 14, color: "var(--text-secondary)", marginTop: 4 }
  }, "Reset Password")), done ? /*#__PURE__*/React.createElement("div", {
    style: { textAlign: "center" }
  }, /*#__PURE__*/React.createElement("div", {
    style: { fontSize: 14, color: "var(--text-secondary)", marginBottom: 18 }
  }, "✅ Password berhasil diubah."), /*#__PURE__*/React.createElement("button", {
    className: "btn btn-primary",
    onClick: onDone,
    style: { width: "100%", justifyContent: "center", padding: "12px 0" }
  }, "Ke Halaman Login")) : /*#__PURE__*/React.createElement("form", {
    onSubmit: handleSubmit
  }, /*#__PURE__*/React.createElement("label", {
    className: "input-label"
  }, "Password Baru"), /*#__PURE__*/React.createElement("input", {
    className: "input",
    type: "password",
    value: pw,
    onChange: e => setPw(e.target.value),
    required: true,
    autoFocus: true,
    placeholder: "min. 4 karakter",
    style: { marginBottom: 14 }
  }), /*#__PURE__*/React.createElement("label", {
    className: "input-label"
  }, "Konfirmasi Password Baru"), /*#__PURE__*/React.createElement("input", {
    className: "input",
    type: "password",
    value: confirm,
    onChange: e => setConfirm(e.target.value),
    required: true,
    style: { marginBottom: 6 }
  }), error && /*#__PURE__*/React.createElement("div", {
    style: { color: "#ef4444", fontSize: 13, marginTop: 8 }
  }, error), /*#__PURE__*/React.createElement("button", {
    className: "btn btn-primary",
    type: "submit",
    disabled: loading,
    style: { width: "100%", justifyContent: "center", marginTop: 18, padding: "12px 0" }
  }, loading ? "Menyimpan..." : "Simpan Password Baru"))));
}
```

- [ ] **Step 5: RegisterPage — field email wajib**

5a. Anchor `const [displayName, setDisplayName] = useState("");` (±baris 2053) → tambahkan setelahnya:

```js
  const [email, setEmail] = useState("");
```

5b. Payload register: cari di RegisterPage

```js
      const data = await api.post("/api/auth/register", {
        username,
        password,
        display_name: displayName
      });
```

ganti menjadi:

```js
      const data = await api.post("/api/auth/register", {
        username,
        password,
        email,
        display_name: displayName
      });
```

5c. Input email: cari blok input Display Name di RegisterPage (unik lewat `placeholder: "Nama tampilan"`):

```js
    placeholder: "Nama tampilan",
    style: {
      marginBottom: 14
    }
  }), /*#__PURE__*/React.createElement("label", {
    className: "input-label"
  }, "Username"),
```

ganti menjadi (menyisipkan label+input Email di antaranya):

```js
    placeholder: "Nama tampilan",
    style: {
      marginBottom: 14
    }
  }), /*#__PURE__*/React.createElement("label", {
    className: "input-label"
  }, "Email"), /*#__PURE__*/React.createElement("input", {
    className: "input",
    type: "email",
    value: email,
    onChange: e => setEmail(e.target.value),
    required: true,
    placeholder: "untuk reset password",
    style: {
      marginBottom: 14
    }
  }), /*#__PURE__*/React.createElement("label", {
    className: "input-label"
  }, "Username"),
```

- [ ] **Step 6: App — wiring `?reset_token=` dan email di handleLogin**

6a. Anchor (±baris 21427):

```js
  // Handle ?join=<code> invite link from URL
  const [pendingJoinCode, setPendingJoinCode] = useState(() => {
```

Tambahkan SEBELUM baris komentar itu:

```js
  // Handle ?reset_token=<token> dari link email reset password
  const [resetToken, setResetToken] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("reset_token") || "";
  });
```

6b. Anchor render auth gate (±baris 21840):

```js
  if (!user) {
    return authPage === "login" ? /*#__PURE__*/React.createElement(LoginPage, {
```

Tambahkan SEBELUM blok `if (!user) {` itu:

```js
  if (!user && resetToken) {
    return /*#__PURE__*/React.createElement(ResetPasswordPage, {
      token: resetToken,
      onDone: () => {
        window.history.replaceState({}, "", window.location.pathname);
        setResetToken("");
        setAuthPage("login");
      }
    });
  }
```

6c. `handleLogin` (±baris 21818) — bawa email ke state user. Cari:

```js
  const handleLogin = data => {
    tokenStore.set(data.token);
    setUser({
      id: data.user_id,
      username: data.username,
      display_name: data.display_name || data.username
    });
```

ganti menjadi:

```js
  const handleLogin = data => {
    tokenStore.set(data.token);
    setUser({
      id: data.user_id,
      username: data.username,
      display_name: data.display_name || data.username,
      email: data.email || ""
    });
```

- [ ] **Step 7: SettingsPage — form email kirim password**

7a. Anchor (±baris 13645):

```js
  const [emForm, setEmForm] = useState({
    email: user?.email || ""
  });
```

ganti menjadi:

```js
  const [emForm, setEmForm] = useState({
    email: user?.email || "",
    current_password: ""
  });
```

7b. `handleEmail` (±baris 13717) — kirim password + sinkronkan state user. Cari:

```js
  const handleEmail = async e => {
    e.preventDefault();
    setL("email", true);
    try {
      await api.patch("/api/auth/profile/email", {
        email: emForm.email
      });
      showToast("Email berhasil disimpan ✅");
    } catch (err) {
      showToast(err.message, "error");
    }
    setL("email", false);
  };
```

ganti menjadi:

```js
  const handleEmail = async e => {
    e.preventDefault();
    setL("email", true);
    try {
      const data = await api.patch("/api/auth/profile/email", {
        email: emForm.email,
        current_password: emForm.current_password
      });
      onUsernameChange({ ...user, email: data.email });
      setEmForm({ email: data.email, current_password: "" });
      showToast("Email berhasil disimpan ✅");
    } catch (err) {
      showToast(err.message, "error");
    }
    setL("email", false);
  };
```

7c. Tambah Field password di form email. Cari (±baris 13884):

```js
  }, /*#__PURE__*/React.createElement(Field, {
    label: "Alamat Email",
    type: "email",
    value: emForm.email,
    onChange: v => setEmForm({
      email: v
    }),
    placeholder: "contoh@email.com"
  }), /*#__PURE__*/React.createElement("button", {
```

ganti menjadi:

```js
  }, /*#__PURE__*/React.createElement(Field, {
    label: "Alamat Email",
    type: "email",
    value: emForm.email,
    onChange: v => setEmForm(f => ({
      ...f,
      email: v
    })),
    placeholder: "contoh@email.com"
  }), /*#__PURE__*/React.createElement(Field, {
    label: "Password Saat Ini",
    type: "password",
    value: emForm.current_password,
    onChange: v => setEmForm(f => ({
      ...f,
      current_password: v
    })),
    placeholder: "Konfirmasi password"
  }), /*#__PURE__*/React.createElement("button", {
```

- [ ] **Step 8: Bump SW cache**

`static/sw.js` baris 1:

```js
const CACHE = "taskflow-v183-forgot-password";
```

- [ ] **Step 9: Verifikasi sintaks JS**

Ekstrak dan parse script utama index.html dengan Node (cek syntax error tanpa menjalankan):

Run (dari root repo):
```bash
node -e "const fs=require('fs');const h=fs.readFileSync('static/index.html','utf8');const m=[...h.matchAll(/<script>([\s\S]*?)<\/script>/g)];m.forEach((x,i)=>{try{new Function(x[1])}catch(e){console.error('script#'+i+':',e.message);process.exit(1)}});console.log('OK '+m.length+' scripts')"
```
Expected: `OK <n> scripts`, exit 0.

- [ ] **Step 10: Commit**

```bash
git add static/index.html static/sw.js
git commit -m "feat(ui): lupa password + halaman reset + email wajib di register & Settings (SW v183)"
```

---

### Task 6: Push, verifikasi CI, selaraskan plan tenant-isolation

**Files:**
- Modify: `docs/superpowers/plans/2026-06-27-tenant-isolation-hardening.md` (1 perubahan kecil)

**Interfaces:**
- Consumes: workflow `Tests` (Task 1), seluruh commit Task 1-5.

- [ ] **Step 1: Selaraskan plan 2a**

Plan `2026-06-27-tenant-isolation-hardening.md` Task 1 membuat `tests/conftest.py` + `.github/workflows/test.yml` dan helper `user_client` yang register TANPA email — setelah fitur ini, register wajib email sehingga plan itu akan gagal saat dieksekusi. Edit plan tersebut: (a) beri catatan di Task 1-nya bahwa `tests/conftest.py` dan `test.yml` **sudah ada** (dibuat oleh plan forgot-password 2026-07-04) — tambahkan fixture ke file yang ada, jangan menimpa; (b) pada kode helper register/`user_client` di plan itu, tambahkan field `"email": f"{username}@test.local"` ke payload register.

- [ ] **Step 2: Commit + push**

```bash
git add docs/superpowers/plans/2026-06-27-tenant-isolation-hardening.md
git commit -m "docs: selaraskan plan tenant-isolation dgn harness test & register wajib email"
git push origin main
```

CATATAN: push ini men-trigger `deploy.yml` (deploy ke VPS produksi) DAN workflow `Tests` baru. Perubahan backward compatible; deploy aman.

- [ ] **Step 3: Verifikasi CI hijau**

Run: `gh run list --limit 5` lalu `gh run watch <id-run-Tests>` (atau poll `gh run list`).
Expected: workflow **Tests** conclusion `success`. Jika gagal: baca log `gh run view <id> --log-failed`, perbaiki, commit, push ulang — jangan klaim selesai sebelum Tests hijau.

- [ ] **Step 4: Verifikasi deploy live (jangan percaya status Action saja)**

Per aturan proyek, deploy bisa hijau walau gagal — cek live state:

Run: `curl -s https://todo.yatno.web.id/static/sw.js | head -1`
Expected: `const CACHE = "taskflow-v183-forgot-password";`

Run: `curl -s -X POST https://todo.yatno.web.id/api/auth/forgot -H "Content-Type: application/json" -d "{\"email\":\"tidakada@contoh.id\"}"`
Expected: `{"message":"Jika email terdaftar, link reset sudah dikirim"}`

- [ ] **Step 5: Laporkan ke user**

Sampaikan: fitur live dalam dev mode (link reset tercetak di log server, `journalctl -u taskflow-web` di VPS); verifikasi kirim email nyata menunggu user setup domain + SMTP lalu mengisi `SMTP_*` di `.env` VPS dan restart service. Rebuild .exe/APK diperlukan agar UI baru masuk bundle native (opsional, web/PWA sudah cukup untuk fitur ini).
