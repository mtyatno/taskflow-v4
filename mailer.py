"""
Alurik - pengiriman email transaksional via SMTP (stdlib, tanpa dependency).
SMTP_HOST kosong = dev mode: email tidak dikirim, isi dicetak ke stdout/log
supaya flow reset password tetap bisa dites end-to-end sebelum SMTP di-setup.

Konfigurasi dibaca lewat atribut modul (mailer.SMTP_HOST dst.) saat dipanggil,
sehingga tes bisa monkeypatch.
"""
import logging
import smtplib
import ssl
from email.message import EmailMessage
from email.utils import formatdate, make_msgid, parseaddr

from config import (SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, SMTP_FROM,
                    SMTP_SECURITY, SMTP_REPLY_TO, SMTP_TIMEOUT)

log = logging.getLogger("mailer")

_MAX_ERROR = 300


class MailPermanentError(Exception):
    """Gagal permanen (kredensial/alamat/konfigurasi salah) — jangan di-retry.
    str(e) sudah berupa teks format_error."""


class MailTemporaryError(Exception):
    """Gagal sementara (jaringan/timeout/4xx) — boleh di-retry.
    str(e) sudah berupa teks format_error."""


def resolve_security(value: str, port: int) -> str:
    v = (value or "").strip().lower()
    if v in ("starttls", "ssl", "none"):
        return v
    if v:
        log.warning("SMTP_SECURITY=%r tidak dikenal, dipakai 'starttls'", value)
        return "starttls"
    return "ssl" if port == 465 else "starttls"


def _code_and_text(exc: BaseException):
    if isinstance(exc, smtplib.SMTPRecipientsRefused):
        vals = list(exc.recipients.values())
        if vals:
            code, err = vals[0]
            return code, err
        return None, ""
    code = getattr(exc, "smtp_code", None)
    if code is not None:
        return code, getattr(exc, "smtp_error", b"")
    return None, str(exc)


def format_error(exc: BaseException) -> str:
    code, text = _code_and_text(exc)
    if isinstance(text, bytes):
        text = text.decode("utf-8", "replace")
    parts = [type(exc).__name__]
    if code is not None:
        parts.append(str(code))
    if text:
        parts.append(str(text))
    out = " ".join(parts)
    if SMTP_PASSWORD:
        out = out.replace(SMTP_PASSWORD, "***")
    return out[:_MAX_ERROR]


def _is_permanent(exc: BaseException) -> bool:
    if isinstance(exc, (smtplib.SMTPAuthenticationError,
                        smtplib.SMTPNotSupportedError,
                        ssl.SSLCertVerificationError)):
        return True
    if isinstance(exc, smtplib.SMTPConnectError):
        return False
    if isinstance(exc, smtplib.SMTPRecipientsRefused):
        codes = [v[0] for v in exc.recipients.values()]
        return bool(codes) and all(c >= 500 for c in codes)
    if isinstance(exc, (smtplib.SMTPSenderRefused, smtplib.SMTPDataError)):
        return exc.smtp_code >= 500
    return False


def build_message(to: str, subject: str, text: str, html: str) -> EmailMessage:
    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = SMTP_FROM
    msg["To"] = to
    msg["Date"] = formatdate(localtime=False)
    addr = parseaddr(SMTP_FROM)[1]
    domain = addr.rsplit("@", 1)[1] if "@" in addr else ""
    msg["Message-ID"] = make_msgid(domain=domain or "alurik.local")
    if SMTP_REPLY_TO:
        msg["Reply-To"] = SMTP_REPLY_TO
    msg["Auto-Submitted"] = "auto-generated"
    msg["X-Auto-Response-Suppress"] = "All"
    msg.set_content(text, charset="utf-8")
    msg.add_alternative(html, subtype="html", charset="utf-8")
    return msg


def smtp_summary() -> dict:
    if not SMTP_HOST:
        return {"mode": "dev", "host": None, "port": None, "security": None,
                "from": SMTP_FROM}
    return {"mode": "smtp", "host": SMTP_HOST, "port": SMTP_PORT,
            "security": resolve_security(SMTP_SECURITY, SMTP_PORT),
            "from": SMTP_FROM}


def send_message(msg: EmailMessage) -> None:
    """Kirim pesan. Dev mode: cetak lalu return. Hanya melempar MailPermanentError
    atau MailTemporaryError."""
    if not SMTP_HOST:
        body = msg.get_body(preferencelist=("plain",))
        text = body.get_content() if body is not None else ""
        out = f"[MAILER DEV MODE] to={msg['To']} subject={msg['Subject']}\n{text}"
        print(out, flush=True)
        log.warning(out)
        return
    # Envelope sender (MAIL FROM) wajib bare address — MTA ketat menolak
    # display-name; header From: tetap boleh "Alurik <noreply@x>".
    sender = parseaddr(SMTP_FROM)[1]
    if not sender:
        raise MailPermanentError("Konfigurasi SMTP_FROM tidak valid")
    security = resolve_security(SMTP_SECURITY, SMTP_PORT)
    try:
        ctx = ssl.create_default_context()
        if security == "ssl":
            conn = smtplib.SMTP_SSL(SMTP_HOST, SMTP_PORT, timeout=SMTP_TIMEOUT, context=ctx)
        else:
            conn = smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=SMTP_TIMEOUT)
        with conn as s:
            if security == "starttls":
                s.starttls(context=ctx)
            if SMTP_USER:
                s.login(SMTP_USER, SMTP_PASSWORD)
            s.send_message(msg, from_addr=sender, to_addrs=[msg["To"]])
    except (MailPermanentError, MailTemporaryError):
        raise
    except Exception as e:
        err = MailPermanentError if _is_permanent(e) else MailTemporaryError
        raise err(format_error(e)) from e

