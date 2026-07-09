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
os.environ["WEB_SECRET_KEY"] = "test-secret-key-0123456789abcdef-panjang-32b"  # >=32 byte: hindari InsecureKeyLengthWarning PyJWT
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
