"""Template email Alurik (HTML + teks) — fungsi murni, tanpa I/O.

Semua nilai yang disisipkan di-escape; semua CSS inline; tanpa gambar,
font web, atau piksel pelacak.
"""
from dataclasses import dataclass
from html import escape
from urllib.parse import urlparse

import config

_LIME = "#a8c500"
_SLATE = "#0f172a"


@dataclass(frozen=True)
class RenderedEmail:
    subject: str
    text: str
    html: str


def _e(value) -> str:
    return escape(str(value), quote=True)


def _footer_domain() -> str:
    # Dibaca saat dipanggil agar config.WEBAPP_URL bisa di-monkeypatch.
    return urlparse(config.WEBAPP_URL or "").hostname or "alurik"


def _check_http_url(url: str) -> str:
    parsed = urlparse(url or "")
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        raise ValueError("Link harus berupa URL http/https")
    return url


def _layout(title: str, body_html: str, cta_label: str | None,
            cta_url: str | None, footer_domain: str) -> str:
    """Kerangka HTML email. `body_html` harus sudah ter-escape oleh pemanggil."""
    cta = ""
    if cta_label and cta_url:
        href = _e(_check_http_url(cta_url))
        cta = (
            '<tr><td style="padding:8px 32px 8px 32px;">'
            f'<a href="{href}" style="display:inline-block;background:{_LIME};'
            f'color:{_SLATE};font-weight:700;text-decoration:none;'
            'padding:12px 24px;border-radius:8px;">'
            f'{_e(cta_label)}</a></td></tr>'
            '<tr><td style="padding:16px 32px 0 32px;font-size:13px;'
            'color:#475569;line-height:1.5;">'
            'Jika tombol tidak berfungsi, salin link ini: '
            f'<span style="word-break:break-all;">{href}</span></td></tr>'
        )
    return (
        '<!doctype html><html lang="id"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width,initial-scale=1">'
        f'<title>{_e(title)}</title></head>'
        '<body style="margin:0;padding:0;background:#f1f5f9;'
        'font-family:Arial,Helvetica,sans-serif;color:#0f172a;">'
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" '
        'style="background:#f1f5f9;"><tr><td align="center" style="padding:24px 12px;">'
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" '
        'style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;">'
        f'<tr><td style="background:{_SLATE};padding:20px 32px;font-size:22px;'
        f'font-weight:700;color:{_LIME};">Alurik</td></tr>'
        f'<tr><td style="padding:28px 32px 8px 32px;font-size:20px;font-weight:700;">'
        f'{_e(title)}</td></tr>'
        f'<tr><td style="padding:0 32px 16px 32px;font-size:15px;line-height:1.6;">'
        f'{body_html}</td></tr>'
        f'{cta}'
        '<tr><td style="padding:28px 32px;font-size:12px;color:#94a3b8;">'
        f'Email ini dikirim otomatis oleh Alurik &middot; {_e(footer_domain)}'
        '</td></tr></table></td></tr></table></body></html>'
    )


def reset_password(username: str, link: str) -> RenderedEmail:
    _check_http_url(link)
    text = (
        f"Halo {username},\n\n"
        "Kami menerima permintaan reset password untuk akun Alurik-mu.\n"
        "Klik link berikut untuk membuat password baru (berlaku 1 jam, sekali pakai):\n\n"
        f"{link}\n\n"
        "Jika kamu tidak merasa meminta reset password, abaikan email ini — "
        "password-mu tidak berubah.\n"
    )
    body = (
        f'<p style="margin:0 0 12px 0;">Halo {_e(username)},</p>'
        '<p style="margin:0 0 12px 0;">Kami menerima permintaan reset password '
        'untuk akun Alurik-mu. Klik tombol di bawah untuk membuat password baru.</p>'
        '<p style="margin:0 0 12px 0;">Link berlaku 1 jam dan hanya bisa dipakai sekali.</p>'
        '<p style="margin:0;color:#475569;">Jika kamu tidak meminta reset password, '
        'abaikan email ini — password-mu tidak berubah.</p>'
    )
    html = _layout("Reset password", body, "Buat password baru", link, _footer_domain())
    return RenderedEmail("Reset Password Alurik", text, html)


def smtp_test(host: str | None, port: int | None, security: str | None,
              sent_at_wib: str) -> RenderedEmail:
    host_s = host or "(dev mode)"
    port_s = str(port) if port else "-"
    sec_s = security or "-"
    text = (
        "SMTP Alurik berfungsi.\n\n"
        f"Host: {host_s}\nPort: {port_s}\nKeamanan: {sec_s}\n"
        f"Waktu kirim: {sent_at_wib}\n"
    )
    rows = "".join(
        f'<tr><td style="padding:2px 16px 2px 0;color:#475569;">{label}</td>'
        f'<td style="padding:2px 0;">{_e(value)}</td></tr>'
        for label, value in (("Host", host_s), ("Port", port_s),
                             ("Keamanan", sec_s), ("Waktu kirim", sent_at_wib))
    )
    body = (
        '<p style="margin:0 0 12px 0;">SMTP Alurik berfungsi.</p>'
        f'<table role="presentation" cellpadding="0" cellspacing="0">{rows}</table>'
    )
    html = _layout("Email tes", body, None, None, _footer_domain())
    return RenderedEmail("Email tes Alurik", text, html)
