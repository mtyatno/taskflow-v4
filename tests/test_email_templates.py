"""Tes template email (email_templates.py) — fungsi murni, tanpa I/O."""
import pytest

import config
import email_templates as et


def test_reset_contains_link_in_text_and_html():
    link = "https://alurik.com/?reset_token=abc123"
    r = et.reset_password("budi", link)
    assert r.subject == "Reset Password Alurik"
    assert link in r.text
    assert f'href="{link}"' in r.html
    assert "berlaku 1 jam" in r.text
    assert "abaikan email ini" in r.text
    assert "Buat password baru" in r.html
    assert "salin link ini" in r.html
    assert "budi" in r.text and "budi" in r.html


def test_reset_escapes_username_and_link():
    r = et.reset_password("<script>x</script>", 'https://a.id/?reset_token=a&b"c')
    assert "<script>" not in r.html
    assert "&lt;script&gt;" in r.html
    assert "a&amp;b&quot;c" in r.html
    assert 'b"c' not in r.html


@pytest.mark.parametrize("bad", ["javascript:alert(1)", "ftp://a.id/x", "//a.id/x", ""])
def test_rejects_non_http_link(bad):
    with pytest.raises(ValueError):
        et.reset_password("u", bad)


def test_layout_inline_only():
    html = et.reset_password("u", "https://alurik.com/?reset_token=t").html
    for banned in ("<style", "<link", "<img", "url("):
        assert banned not in html
    for needed in ("#a8c500", "#0f172a", "max-width:560px",
                   "Email ini dikirim otomatis oleh Alurik"):
        assert needed in html


def test_footer_domain_read_at_call_time(monkeypatch):
    monkeypatch.setattr(config, "WEBAPP_URL", "https://contoh.example:8443/x")
    assert "contoh.example" in et.reset_password("u", "https://a.id/").html


def test_smtp_test_never_mentions_credentials(monkeypatch):
    monkeypatch.setattr(config, "SMTP_USER", "rahasia-user-xyz", raising=False)
    monkeypatch.setattr(config, "SMTP_PASSWORD", "rahasia-pass-xyz", raising=False)
    r = et.smtp_test("smtp.contoh.id", 587, "starttls", "21 Okt 2026 10:00 WIB")
    assert r.subject == "Email tes Alurik"
    for part in (r.text, r.html):
        assert "rahasia" not in part
        for v in ("smtp.contoh.id", "587", "starttls", "21 Okt 2026 10:00 WIB",
                  "SMTP Alurik berfungsi"):
            assert v in part


def test_smtp_test_dev_mode_host():
    r = et.smtp_test(None, None, None, "sekarang")
    assert "(dev mode)" in r.text and "(dev mode)" in r.html
