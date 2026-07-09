"""
TaskFlow - pengiriman email transaksional via SMTP (stdlib, tanpa dependency).
SMTP_HOST kosong = dev mode: email tidak dikirim, isi dicetak ke stdout/log
supaya flow reset password tetap bisa dites end-to-end sebelum SMTP di-setup.
"""
import logging
import smtplib
from email.mime.text import MIMEText
from email.utils import parseaddr

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
        # Envelope sender (MAIL FROM) wajib bare address — MTA ketat menolak
        # display-name; header From: tetap boleh "TaskFlow <noreply@x>".
        s.sendmail(parseaddr(SMTP_FROM)[1], [to], msg.as_string())


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
