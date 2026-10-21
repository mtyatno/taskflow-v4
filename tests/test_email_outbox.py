"""Tes outbox email + EmailWorker (jam dikendalikan, send palsu)."""
import sqlite3
import time
from datetime import datetime, timedelta

import pytest

import email_outbox as eo
import mailer
from email_templates import RenderedEmail

T0 = datetime(2026, 10, 21, 0, 0)


@pytest.fixture
def db(tmp_path):
    path = str(tmp_path / "outbox.db")

    def connect():
        c = sqlite3.connect(path)
        c.row_factory = sqlite3.Row
        return c

    c = connect()
    eo.ensure_schema(c)
    c.commit()
    c.close()
    return connect


@pytest.fixture
def clock():
    return [T0]


class FakeSend:
    def __init__(self, exc=None):
        self.exc = exc
        self.calls = []

    def __call__(self, msg):
        self.calls.append(msg)
        if self.exc is not None:
            raise self.exc


def _rendered(subject="Subjek Tes"):
    return RenderedEmail(subject=subject, text="isi teks", html="<p>isi</p>")


def _enqueue(connect, clock, **kw):
    c = connect()
    try:
        kw.setdefault("kind", "test")
        kw.setdefault("to_addr", "a@example.com")
        kw.setdefault("rendered", _rendered())
        rid = eo.enqueue(c, now=clock[0], **kw)
        c.commit()
        return rid
    finally:
        c.close()


def _row(connect, rid):
    c = connect()
    try:
        return dict(c.execute("SELECT * FROM email_outbox WHERE id=?", (rid,)).fetchone())
    finally:
        c.close()


def _worker(connect, clock, send):
    return eo.EmailWorker(connect, send=send, now=lambda: clock[0])


def test_constants():
    assert eo.RETRY_DELAYS_MIN == (1, 5, 30, 120)
    assert eo.MAX_ATTEMPTS == 5
    assert eo.POLL_SECONDS == 30
    assert eo.BATCH == 20
    assert eo.RETENTION_DAYS == 30


def test_schema_columns_and_indexes(db):
    c = db()
    try:
        eo.ensure_schema(c)  # idempoten
        cols = [r["name"] for r in c.execute("PRAGMA table_info(email_outbox)")]
        idx = {r["name"] for r in c.execute("PRAGMA index_list(email_outbox)")}
    finally:
        c.close()
    assert cols == ["id", "kind", "user_id", "to_addr", "subject", "body_text", "body_html", "status",
                    "attempts", "last_error", "next_attempt_at", "expires_at", "created_at",
                    "updated_at", "sent_at"]
    assert {"idx_email_outbox_due", "idx_email_outbox_created"} <= idx


def test_enqueue_row_fields(db, clock):
    rid = _enqueue(db, clock, kind="reset", user_id=7, expires_at=T0 + timedelta(minutes=50))
    r = _row(db, rid)
    assert r["status"] == "queued" and r["attempts"] == 0 and r["user_id"] == 7
    assert r["next_attempt_at"] == eo.iso(T0) == r["created_at"] == r["updated_at"]
    assert r["expires_at"] == eo.iso(T0 + timedelta(minutes=50))
    assert r["subject"] == "Subjek Tes" and r["body_text"] == "isi teks" and r["body_html"] == "<p>isi</p>"


def test_utcnow_is_naive():
    assert eo.utcnow().tzinfo is None
    assert eo.iso(T0) == "2026-10-21T00:00:00"


def test_enqueue_and_send_success(db, clock):
    send = FakeSend()
    rid = _enqueue(db, clock, to_addr="b@example.com", rendered=_rendered("Halo Subjek"))
    clock[0] = T0 + timedelta(seconds=5)
    assert _worker(db, clock, send).run_due() == 1
    r = _row(db, rid)
    assert r["status"] == "sent" and r["attempts"] == 1
    assert r["sent_at"] == eo.iso(clock[0])
    assert len(send.calls) == 1
    assert send.calls[0]["Subject"] == "Halo Subjek"
    assert send.calls[0]["To"] == "b@example.com"


def test_retry_schedule(db, clock):
    send = FakeSend(mailer.MailTemporaryError("x"))
    w = _worker(db, clock, send)
    rid = _enqueue(db, clock, kind="reset")
    for n, delay in enumerate((1, 5, 30, 120), start=1):
        assert w.run_due() == 1
        r = _row(db, rid)
        assert r["status"] == "queued" and r["attempts"] == n and r["last_error"] == "x"
        nxt = datetime.fromisoformat(r["next_attempt_at"])
        assert nxt - clock[0] == timedelta(minutes=delay)
        clock[0] = nxt - timedelta(seconds=1)
        assert w.run_due() == 0  # belum jatuh tempo
        clock[0] = nxt
    assert w.run_due() == 1
    r = _row(db, rid)
    assert r["status"] == "failed" and r["attempts"] == 5 and r["last_error"] == "x"
    assert len(send.calls) == 5
    assert w.run_due() == 0


def test_test_kind_fails_on_first_temporary_error(db, clock):
    send = FakeSend(mailer.MailTemporaryError("timed out"))
    rid = _enqueue(db, clock, kind="test")
    assert _worker(db, clock, send).run_due() == 1
    r = _row(db, rid)
    assert r["status"] == "failed" and r["attempts"] == 1 and r["last_error"] == "timed out"
    assert r["body_text"] == "isi teks"  # failed menyimpan isi untuk "Coba lagi"


def test_sent_row_body_is_blanked(db, clock):
    rid = _enqueue(db, clock)
    assert _worker(db, clock, FakeSend()).run_due() == 1
    r = _row(db, rid)
    assert r["status"] == "sent" and r["body_text"] == "" and r["body_html"] == ""


def test_expired_row_body_is_blanked(db, clock):
    rid = _enqueue(db, clock, expires_at=T0 + timedelta(minutes=50))
    clock[0] = T0 + timedelta(minutes=51)
    assert _worker(db, clock, FakeSend()).run_due() == 1
    r = _row(db, rid)
    assert r["status"] == "expired" and r["body_text"] == "" and r["body_html"] == ""


def test_failed_row_keeps_body(db, clock):
    send = FakeSend(mailer.MailPermanentError("535"))
    rid = _enqueue(db, clock, kind="reset")
    _worker(db, clock, send).run_due()
    r = _row(db, rid)
    assert r["status"] == "failed" and r["body_text"] == "isi teks" and r["body_html"] == "<p>isi</p>"


def test_permanent_error_fails_immediately(db, clock):
    send = FakeSend(mailer.MailPermanentError("SMTPAuthenticationError 535 bad"))
    rid = _enqueue(db, clock)
    assert _worker(db, clock, send).run_due() == 1
    r = _row(db, rid)
    assert r["status"] == "failed" and r["attempts"] == 1
    assert r["last_error"] == "SMTPAuthenticationError 535 bad"
    assert r["sent_at"] is None


def test_expired_not_sent(db, clock):
    send = FakeSend()
    rid = _enqueue(db, clock, expires_at=T0 + timedelta(minutes=50))
    clock[0] = T0 + timedelta(minutes=51)
    assert _worker(db, clock, send).run_due() == 1
    r = _row(db, rid)
    assert r["status"] == "expired" and r["attempts"] == 0
    assert send.calls == []


def test_not_expired_before_deadline_is_sent(db, clock):
    send = FakeSend()
    rid = _enqueue(db, clock, expires_at=T0 + timedelta(minutes=50))
    clock[0] = T0 + timedelta(minutes=49)
    _worker(db, clock, send).run_due()
    assert _row(db, rid)["status"] == "sent"


def test_claim_is_atomic(db, clock):
    rid = _enqueue(db, clock)
    send_b = FakeSend()
    w_b = _worker(db, clock, send_b)

    class SendA(FakeSend):
        def __call__(self, msg):
            super().__call__(msg)
            # worker lain berjalan saat A sedang mengirim: baris sudah 'sending'
            assert w_b.run_due() == 0
            c = db()
            try:
                assert w_b._process(c, rid) is False  # klaim ditolak
            finally:
                c.close()

    send_a = SendA()
    w_a = _worker(db, clock, send_a)
    assert w_a.run_due() == 1
    assert w_b.run_due() == 0
    assert len(send_a.calls) == 1 and send_b.calls == []
    r = _row(db, rid)
    assert r["status"] == "sent" and r["attempts"] == 1


def test_recover_stale_requeues_sending(db, clock):
    rid = _enqueue(db, clock)
    other = _enqueue(db, clock)
    c = db()
    c.execute("UPDATE email_outbox SET status='sending', attempts=1 WHERE id=?", (rid,))
    c.commit()
    c.close()
    clock[0] = T0 + timedelta(minutes=3)
    w = _worker(db, clock, FakeSend())
    assert w.recover_stale() == 1
    r = _row(db, rid)
    assert r["status"] == "queued" and r["attempts"] == 1
    assert r["updated_at"] == eo.iso(clock[0])
    assert _row(db, other)["status"] == "queued"
    assert w.recover_stale() == 0


def test_purge_old(db, clock):
    def make(status, days):
        rid = _enqueue(db, [clock[0] - timedelta(days=days)])
        c = db()
        c.execute("UPDATE email_outbox SET status=? WHERE id=?", (status, rid))
        c.commit()
        c.close()
        return rid

    old_sent = make("sent", 31)
    old_failed = make("failed", 31)
    old_expired = make("expired", 31)
    young_sent = make("sent", 29)
    old_queued = make("queued", 40)
    assert _worker(db, clock, FakeSend()).purge_old() == 3
    c = db()
    ids = {r["id"] for r in c.execute("SELECT id FROM email_outbox")}
    c.close()
    assert ids == {young_sent, old_queued}
    assert not ids & {old_sent, old_failed, old_expired}


def test_unexpected_exception_does_not_kill_worker(db, clock):
    send = FakeSend(RuntimeError("boom"))
    rid = _enqueue(db, clock, kind="reset")
    assert _worker(db, clock, send).run_due() == 1
    r = _row(db, rid)
    assert r["status"] == "queued" and r["attempts"] == 1
    assert r["last_error"] == mailer.format_error(RuntimeError("boom"))
    assert datetime.fromisoformat(r["next_attempt_at"]) == clock[0] + timedelta(minutes=1)


def test_batch_limit_20(db, clock):
    send = FakeSend()
    ids = [_enqueue(db, clock) for _ in range(25)]
    w = _worker(db, clock, send)
    assert w.run_due() == 20
    assert [_row(db, i)["status"] for i in ids[:20]] == ["sent"] * 20
    assert [_row(db, i)["status"] for i in ids[20:]] == ["queued"] * 5
    assert w.run_due() == 5


def test_wake_without_start_does_not_spawn_thread(db, clock):
    send = FakeSend()
    rid = _enqueue(db, clock)
    w = _worker(db, clock, send)
    w.wake()
    time.sleep(0.05)
    assert w.is_alive() is False
    assert _row(db, rid)["status"] == "queued"
    assert send.calls == []


def test_thread_sends_after_wake(db):
    send = FakeSend()
    w = eo.EmailWorker(db, send=send)  # jam sungguhan
    w.start()
    try:
        assert w.is_alive()
        rid = _enqueue(db, [eo.utcnow()])
        w.wake()
        deadline = time.monotonic() + 2
        while time.monotonic() < deadline and _row(db, rid)["status"] != "sent":
            time.sleep(0.02)
        assert _row(db, rid)["status"] == "sent"
        assert len(send.calls) == 1
    finally:
        w.stop(timeout=2)
    assert w.is_alive() is False


def test_wake_restarts_dead_thread(db, clock):
    w = _worker(db, clock, FakeSend())
    w.start()
    w.stop(timeout=2)
    assert w.is_alive() is False
    try:
        w.wake()
        assert w.is_alive() is True
    finally:
        w.stop(timeout=2)
