"""Tes transport SMTP (mailer.py) — smtplib diganti kelas palsu."""
import email
import socket
import smtplib
import ssl
from email import policy

import pytest

import mailer


class FakeSMTP:
    instances = []
    login_error = None
    send_error = None

    def __init__(self, host=None, port=None, timeout=None, **kw):
        self.host, self.port, self.timeout, self.kw = host, port, timeout, kw
        self.calls = []
        self.sent = []
        FakeSMTP.instances.append(self)

    def __enter__(self):
        return self

    def __exit__(self, *a):
        self.quit()
        return False

    def starttls(self, **kw):
        self.calls.append("starttls")
        self.starttls_kw = kw

    def login(self, user, password):
        self.calls.append(("login", user, password))
        if FakeSMTP.login_error:
            raise FakeSMTP.login_error

    def send_message(self, msg, from_addr=None, to_addrs=None, **kw):
        self.calls.append("send_message")
        if FakeSMTP.send_error:
            raise FakeSMTP.send_error
        self.sent.append((from_addr, to_addrs, msg))
        return {}

    def quit(self):
        self.calls.append("quit")


@pytest.fixture(autouse=True)
def fake(monkeypatch):
    FakeSMTP.instances = []
    FakeSMTP.login_error = None
    FakeSMTP.send_error = None
    monkeypatch.setattr(mailer.smtplib, "SMTP", FakeSMTP)
    monkeypatch.setattr(mailer.smtplib, "SMTP_SSL", type("FakeSSL", (FakeSMTP,), {}))
    monkeypatch.setattr(mailer, "SMTP_HOST", "smtp.x.id")
    monkeypatch.setattr(mailer, "SMTP_PORT", 587)
    monkeypatch.setattr(mailer, "SMTP_USER", "u")
    monkeypatch.setattr(mailer, "SMTP_PASSWORD", "pw")
    monkeypatch.setattr(mailer, "SMTP_FROM", "Alurik <noreply@x.id>")
    monkeypatch.setattr(mailer, "SMTP_SECURITY", "")
    monkeypatch.setattr(mailer, "SMTP_REPLY_TO", "")
    monkeypatch.setattr(mailer, "SMTP_TIMEOUT", 15)


def _msg():
    return mailer.build_message("a@b.id", "Hai", "teks", "<p>html</p>")


def test_resolve_security():
    assert mailer.resolve_security("", 465) == "ssl"
    assert mailer.resolve_security("", 587) == "starttls"
    assert mailer.resolve_security("SSL", 587) == "ssl"
    assert mailer.resolve_security("none", 25) == "none"
    assert mailer.resolve_security("aneh", 587) == "starttls"


def test_dev_mode_prints_and_opens_no_connection(monkeypatch, capsys):
    monkeypatch.setattr(mailer, "SMTP_HOST", "")
    mailer.send_message(_msg())
    out = capsys.readouterr().out
    assert "[MAILER DEV MODE] to=a@b.id subject=Hai" in out
    assert "teks" in out
    assert FakeSMTP.instances == []


def test_starttls_mode_calls_starttls_and_login():
    mailer.send_message(_msg())
    s = FakeSMTP.instances[0]
    assert (s.host, s.port, s.timeout) == ("smtp.x.id", 587, 15)
    assert s.calls == ["starttls", ("login", "u", "pw"), "send_message", "quit"]
    assert isinstance(s.starttls_kw["context"], ssl.SSLContext)


def test_ssl_mode_uses_smtp_ssl_without_starttls(monkeypatch):
    monkeypatch.setattr(mailer, "SMTP_PORT", 465)
    mailer.send_message(_msg())
    s = FakeSMTP.instances[0]
    assert type(s).__name__ == "FakeSSL"
    assert "starttls" not in s.calls
    assert "send_message" in s.calls
    assert isinstance(s.kw["context"], ssl.SSLContext)


def test_none_mode_no_tls(monkeypatch):
    monkeypatch.setattr(mailer, "SMTP_SECURITY", "none")
    monkeypatch.setattr(mailer, "SMTP_PORT", 25)
    mailer.send_message(_msg())
    assert "starttls" not in FakeSMTP.instances[0].calls


def test_no_login_when_user_empty(monkeypatch):
    monkeypatch.setattr(mailer, "SMTP_USER", "")
    mailer.send_message(_msg())
    assert not any(isinstance(c, tuple) for c in FakeSMTP.instances[0].calls)


def test_envelope_sender_is_bare_address():
    mailer.send_message(_msg())
    frm, to, _ = FakeSMTP.instances[0].sent[0]
    assert frm == "noreply@x.id"
    assert to == ["a@b.id"]


def test_build_message_headers_and_parts(monkeypatch):
    m = mailer.build_message("a@b.id", "Tés ✓", "teks", "<p>html</p>")
    assert m["To"] == "a@b.id"
    assert m["From"] == "Alurik <noreply@x.id>"
    assert m["Date"]
    assert m["Message-ID"].endswith("@x.id>")
    assert m["Auto-Submitted"] == "auto-generated"
    assert m["X-Auto-Response-Suppress"] == "All"
    assert m["Reply-To"] is None
    assert m.get_content_type() == "multipart/alternative"
    parsed = email.message_from_bytes(m.as_bytes(), policy=policy.default)
    assert parsed["Subject"] == "Tés ✓"
    parts = list(parsed.iter_parts())
    assert [p.get_content_type() for p in parts] == ["text/plain", "text/html"]
    assert parts[0].get_content().strip() == "teks"
    assert "html" in parts[1].get_content()
    monkeypatch.setattr(mailer, "SMTP_REPLY_TO", "bantuan@x.id")
    assert mailer.build_message("a@b.id", "S", "t", "h")["Reply-To"] == "bantuan@x.id"


def test_message_id_fallback_domain(monkeypatch):
    monkeypatch.setattr(mailer, "SMTP_FROM", "noreply")
    assert mailer.build_message("a@b.id", "S", "t", "h")["Message-ID"].endswith("@alurik.local>")


def test_auth_error_is_permanent_and_redacted(monkeypatch):
    monkeypatch.setattr(mailer, "SMTP_PASSWORD", "rahasia123")
    FakeSMTP.login_error = smtplib.SMTPAuthenticationError(535, b"bad creds rahasia123")
    with pytest.raises(mailer.MailPermanentError) as ei:
        mailer.send_message(_msg())
    assert "rahasia123" not in str(ei.value)
    assert "535" in str(ei.value)


def test_recipient_refused_5xx_permanent_4xx_temporary():
    FakeSMTP.send_error = smtplib.SMTPRecipientsRefused({"a@b.id": (550, b"no")})
    with pytest.raises(mailer.MailPermanentError):
        mailer.send_message(_msg())
    FakeSMTP.send_error = smtplib.SMTPRecipientsRefused({"a@b.id": (451, b"later")})
    with pytest.raises(mailer.MailTemporaryError):
        mailer.send_message(_msg())


@pytest.mark.parametrize("exc", [OSError("down"), socket.timeout("t"),
                                 smtplib.SMTPServerDisconnected("bye"),
                                 RuntimeError("aneh")])
def test_connection_errors_temporary(exc):
    FakeSMTP.send_error = exc
    with pytest.raises(mailer.MailTemporaryError):
        mailer.send_message(_msg())


def test_other_permanent_classes():
    for exc in (smtplib.SMTPNotSupportedError("x"),
                smtplib.SMTPDataError(554, b"spam"),
                smtplib.SMTPSenderRefused(553, b"bad", "x@y")):
        FakeSMTP.send_error = exc
        with pytest.raises(mailer.MailPermanentError):
            mailer.send_message(_msg())


def test_error_str_is_message_when_constructed_directly():
    assert str(mailer.MailTemporaryError("x")) == "x"
    assert str(mailer.MailPermanentError("y")) == "y"


def test_format_error_truncates_300(monkeypatch):
    assert len(mailer.format_error(RuntimeError("x" * 1000))) == 300
    monkeypatch.setattr(mailer, "SMTP_PASSWORD", "sekret")
    assert "sekret" not in mailer.format_error(RuntimeError("pw sekret ok"))


def test_smtp_summary_dev_and_smtp(monkeypatch):
    s = mailer.smtp_summary()
    assert s == {"mode": "smtp", "host": "smtp.x.id", "port": 587,
                 "security": "starttls", "from": "Alurik <noreply@x.id>"}
    monkeypatch.setattr(mailer, "SMTP_HOST", "")
    d = mailer.smtp_summary()
    assert d["mode"] == "dev"
    assert d["host"] is None and d["port"] is None and d["security"] is None


def test_roundtrip_aiosmtpd(monkeypatch):
    pytest.importorskip("aiosmtpd")
    from aiosmtpd.controller import Controller

    got = []

    class H:
        async def handle_DATA(self, server, session, envelope):
            got.append(envelope)
            return "250 OK"

    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    ctl = Controller(H(), hostname="127.0.0.1", port=port)
    ctl.start()
    try:
        monkeypatch.undo()  # pakai smtplib asli
        monkeypatch.setattr(mailer, "SMTP_HOST", "127.0.0.1")
        monkeypatch.setattr(mailer, "SMTP_PORT", port)
        monkeypatch.setattr(mailer, "SMTP_SECURITY", "none")
        monkeypatch.setattr(mailer, "SMTP_USER", "")
        monkeypatch.setattr(mailer, "SMTP_FROM", "Alurik <noreply@x.id>")
        monkeypatch.setattr(mailer, "SMTP_REPLY_TO", "")
        monkeypatch.setattr(mailer, "SMTP_TIMEOUT", 5)
        mailer.send_message(mailer.build_message("a@b.id", "Hai", "teks", "<p>h</p>"))
    finally:
        ctl.stop()
    assert len(got) == 1
    parsed = email.message_from_bytes(got[0].content, policy=policy.default)
    assert len(list(parsed.iter_parts())) == 2
