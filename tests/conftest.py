"""
Test harness: set env var SEBELUM import webapp supaya DB/upload/secret
mengarah ke lokasi temp, bukan produksi. webapp membuat tabel di event
startup — di sini dipanggil langsung via migrate_db() karena TestClient
tanpa context manager tidak menjalankan lifespan.
"""
import os
import re
import sqlite3
import tempfile

_TMP = tempfile.mkdtemp(prefix="taskflow-test-")
os.environ["DB_PATH"] = os.path.join(_TMP, "test.db")
os.environ["UPLOAD_DIR"] = os.path.join(_TMP, "uploads")
os.environ["WEB_SECRET_KEY"] = "test-secret-key-0123456789abcdef-panjang-32b"  # >=32 byte: hindari InsecureKeyLengthWarning PyJWT
os.environ["TELEGRAM_BOT_TOKEN"] = ""
os.environ["MEDIA_ROOT"] = os.path.join(_TMP, "media")
os.environ["MEDIA_ACCEL"] = "0"

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


class _EmailList:
    """Tampilan list baca-saja atas baris email_outbox yang dibuat setelah fixture dibuat."""
    _LINK = re.compile(r"https?://\S*reset_token=[^\s\"<]+")

    def __init__(self, min_id):
        self._min_id = min_id

    def _items(self):
        conn = db()
        try:
            rows = conn.execute(
                "SELECT to_addr, kind, status, body_text FROM email_outbox WHERE id > ? ORDER BY id",
                (self._min_id,)).fetchall()
        finally:
            conn.close()
        out = []
        for r in rows:
            m = self._LINK.search(r["body_text"] or "")
            out.append({"to": r["to_addr"], "kind": r["kind"], "status": r["status"],
                        "link": m.group(0) if m else None})
        return out

    def __len__(self):
        return len(self._items())

    def __getitem__(self, i):
        return self._items()[i]

    def __iter__(self):
        return iter(self._items())


@pytest.fixture
def captured_emails():
    """Email yang di-enqueue ke email_outbox sejak fixture dibuat (worker tidak jalan di tes)."""
    conn = db()
    try:
        max_id = conn.execute("SELECT COALESCE(MAX(id), 0) FROM email_outbox").fetchone()[0]
    finally:
        conn.close()
    return _EmailList(max_id)
