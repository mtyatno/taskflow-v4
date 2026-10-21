"""Rangkai outbox email ke webapp: migrasi, lupa password, worker."""
import re
from datetime import datetime

import mailer
import webapp
from conftest import db, register_user


def test_migrate_creates_email_outbox():
    webapp.migrate_db()
    webapp.migrate_db()  # idempoten
    c = db()
    try:
        names = {r["name"] for r in c.execute(
            "SELECT name FROM sqlite_master WHERE tbl_name='email_outbox'")}
    finally:
        c.close()
    assert {"email_outbox", "idx_email_outbox_due", "idx_email_outbox_created"} <= names


def _last_row(email):
    c = db()
    try:
        return c.execute("SELECT * FROM email_outbox WHERE to_addr=? ORDER BY id DESC LIMIT 1",
                         (email,)).fetchone()
    finally:
        c.close()


def test_forgot_enqueues_reset_with_50min_expiry(client):
    register_user(client, "wire_a", "wire_a@test.id")
    r = client.post("/api/auth/forgot", json={"email": "wire_a@test.id"})
    assert r.status_code == 200
    row = _last_row("wire_a@test.id")
    assert row["kind"] == "reset" and row["status"] == "queued"
    delta = datetime.fromisoformat(row["expires_at"]) - datetime.fromisoformat(row["created_at"])
    assert abs(delta.total_seconds() - 50 * 60) <= 1
    m = re.search(r"https?://\S*reset_token=[^\s\"<]+", row["body_text"])
    assert m and m.group(0) in row["body_html"].replace("&amp;", "&")


def test_forgot_response_unchanged_and_unknown_email_no_row(client):
    register_user(client, "wire_b", "wire_b@test.id")
    ok = client.post("/api/auth/forgot", json={"email": "wire_b@test.id"})
    ghost = client.post("/api/auth/forgot", json={"email": "wire_ghost@test.id"})
    assert ok.json() == ghost.json() == webapp._FORGOT_GENERIC
    assert _last_row("wire_ghost@test.id") is None


def test_forgot_wakes_worker(client, monkeypatch):
    register_user(client, "wire_c", "wire_c@test.id")
    calls = []
    monkeypatch.setattr(webapp.email_worker, "wake", lambda: calls.append(1))
    client.post("/api/auth/forgot", json={"email": "wire_c@test.id"})
    assert calls == [1]


def test_mailer_has_no_send_reset_email():
    assert not hasattr(mailer, "send_reset_email")


def test_forgot_render_failure_returns_generic_and_writes_nothing(client, monkeypatch):
    import email_templates
    register_user(client, "wire_d", "wire_d@test.id")

    def count():
        c = db()
        try:
            return (c.execute("SELECT COUNT(*) FROM email_outbox").fetchone()[0],
                    c.execute("SELECT COUNT(*) FROM password_reset_tokens").fetchone()[0])
        finally:
            c.close()

    before = count()

    def boom(*a, **k):
        raise ValueError("WEBAPP_URL tanpa skema")

    monkeypatch.setattr(email_templates, "reset_password", boom)
    r = client.post("/api/auth/forgot", json={"email": "wire_d@test.id"})
    assert r.status_code == 200 and r.json() == webapp._FORGOT_GENERIC
    assert count() == before
