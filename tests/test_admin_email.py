"""Endpoint admin email (spec Email Fase 0b §3.1)."""
import uuid
from datetime import timedelta

import email_outbox
import mailer
from conftest import db, register_user


def _mk(client, admin=True, with_email=True):
    u = "adm" + uuid.uuid4().hex[:8]
    email = f"{u}@test.id"
    reg = register_user(client, u, email)
    conn = db()
    if admin:
        conn.execute("UPDATE users SET is_admin=1 WHERE username=?", (u,))
    if not with_email:
        conn.execute("UPDATE users SET email=NULL WHERE username=?", (u,))
    conn.commit()
    conn.close()
    return {"Authorization": f"Bearer {reg['token']}"}, email


def _insert(status="failed", kind="test", attempts=5, expires_at=None, created=None, to="x@test.id"):
    now = email_outbox.utcnow()
    ts = email_outbox.iso(created or now)
    conn = db()
    cur = conn.execute(
        "INSERT INTO email_outbox (kind, to_addr, subject, body_text, body_html, status, attempts, last_error,"
        " next_attempt_at, expires_at, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
        (kind, to, "SUBJ", "BODY", "<p>BODY</p>", status, attempts, "boom", ts,
         email_outbox.iso(expires_at) if expires_at else None, ts, ts))
    conn.commit()
    i = cur.lastrowid
    conn.close()
    return i


def _row(i):
    conn = db()
    r = conn.execute("SELECT * FROM email_outbox WHERE id=?", (i,)).fetchone()
    conn.close()
    return r


def _clear_tests():
    conn = db()
    conn.execute("DELETE FROM email_outbox WHERE kind='test'")
    conn.commit()
    conn.close()


def test_non_admin_forbidden_on_all_three(client):
    h, _ = _mk(client, admin=False)
    assert client.get("/api/admin/email/status", headers=h).status_code == 403
    assert client.post("/api/admin/email/test", json={}, headers=h).status_code == 403
    assert client.post("/api/admin/email/1/retry", headers=h).status_code == 403


def test_mask_email():
    assert email_outbox.mask_email("hi@jatahku.com") == "hi***@jatahku.com"
    assert email_outbox.mask_email("a@b.id") == "a***@b.id"
    assert email_outbox.mask_email("abc@x.id") == "ab***@x.id"


def test_status_dev_mode(client, monkeypatch):
    monkeypatch.setattr(mailer, "SMTP_HOST", "")
    h, _ = _mk(client)
    d = client.get("/api/admin/email/status", headers=h).json()
    assert d["mode"] == "dev" and d["host"] is None and d["port"] is None and d["security"] is None
    assert set(d["counts_7d"]) == {"sent", "failed", "queued", "expired"}
    assert isinstance(d["worker_alive"], bool)


def test_status_smtp_mode(client, monkeypatch):
    monkeypatch.setattr(mailer, "SMTP_HOST", "smtp.x.id")
    monkeypatch.setattr(mailer, "SMTP_PORT", 465)
    monkeypatch.setattr(mailer, "SMTP_SECURITY", "")
    monkeypatch.setattr(mailer, "SMTP_USER", "rahasia-user")
    monkeypatch.setattr(mailer, "SMTP_PASSWORD", "rahasia-pw")
    h, _ = _mk(client)
    r = client.get("/api/admin/email/status", headers=h)
    d = r.json()
    assert d["mode"] == "smtp" and d["host"] == "smtp.x.id" and d["port"] == 465 and d["security"] == "ssl"
    assert "rahasia-user" not in r.text and "rahasia-pw" not in r.text
    assert "SMTP_USER" not in r.text and "SMTP_PASSWORD" not in r.text


def test_status_recent_masks_and_hides_content(client):
    h, _ = _mk(client)
    before = client.get("/api/admin/email/status", headers=h).json()["counts_7d"]["queued"]
    _insert(status="queued", kind="reset", attempts=0, to="budi@test.id")
    j = _insert(status="sending", kind="reset", attempts=1, to="budi@test.id")
    d = client.get("/api/admin/email/status", headers=h).json()
    assert d["counts_7d"]["queued"] == before + 2
    assert len(d["recent"]) <= 20
    top = d["recent"][0]
    assert top["id"] == j and top["to"] == "bu***@test.id"
    assert set(top) == {"id", "kind", "to", "status", "attempts", "last_error", "created_at", "sent_at"}
    assert "SUBJ" not in str(d) and "BODY" not in str(d)


def test_send_test_defaults_to_admin_email(client):
    _clear_tests()
    h, email = _mk(client)
    r = client.post("/api/admin/email/test", json={}, headers=h)
    assert r.status_code == 200, r.text
    row = _row(r.json()["id"])
    assert row["kind"] == "test" and row["to_addr"] == email and row["status"] == "queued"
    assert "WIB" in row["body_text"]


def test_send_test_custom_address_validated(client):
    _clear_tests()
    h, _ = _mk(client)
    assert client.post("/api/admin/email/test", json={"to": "bukan-email"}, headers=h).status_code == 400
    r = client.post("/api/admin/email/test", json={"to": "lain@test.id"}, headers=h)
    assert r.status_code == 200
    assert _row(r.json()["id"])["to_addr"] == "lain@test.id"


def test_send_test_without_any_address_400(client):
    h, _ = _mk(client, with_email=False)
    r = client.post("/api/admin/email/test", json={}, headers=h)
    assert r.status_code == 400
    assert r.json()["detail"] == "Isi alamat tujuan atau tambahkan email di Pengaturan"


def test_send_test_rate_limit_5_per_hour(client):
    _clear_tests()
    h, _ = _mk(client)
    _insert(kind="test", created=email_outbox.utcnow() - timedelta(hours=2))
    for _ in range(5):
        assert client.post("/api/admin/email/test", json={}, headers=h).status_code == 200
    assert client.post("/api/admin/email/test", json={}, headers=h).status_code == 429
    _clear_tests()


def test_retry_failed_only(client):
    h, _ = _mk(client)
    i = _insert(status="failed", kind="test", attempts=5)
    assert client.post(f"/api/admin/email/{i}/retry", headers=h).json() == {"ok": True}
    r = _row(i)
    assert r["status"] == "queued" and r["attempts"] == 0 and r["last_error"] == "boom"
    assert client.post(f"/api/admin/email/{i}/retry", headers=h).status_code == 400  # kini queued
    s = _insert(status="sent", kind="test")
    assert client.post(f"/api/admin/email/{s}/retry", headers=h).status_code == 400
    assert client.post("/api/admin/email/99999999/retry", headers=h).status_code == 404
    exp = _insert(status="failed", kind="reset",
                  expires_at=email_outbox.utcnow() - timedelta(minutes=1))
    r = client.post(f"/api/admin/email/{exp}/retry", headers=h)
    assert r.status_code == 400
    assert r.json()["detail"] == "Link reset sudah kedaluwarsa — minta reset baru"
    assert _row(exp)["status"] == "failed"
