"""Test regresi rebrand TaskFlow → Alurik pada file backend."""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

def _read(name: str) -> str:
    return (ROOT / name).read_text(encoding="utf-8")

def test_webapp_visible_strings_rebranded():
    src = _read("webapp.py")
    assert "Alurik" in src, "webapp.py harus menyebut Alurik"
    # string user-visible lama wajib hilang
    for old in [
        "TaskFlow V4",
        "Buka TaskFlow",
        "Published via TaskFlow",
        "Back to TaskFlow",
        "TaskFlow Publish",
        "TaskFlow Note AI",
        "TaskFlowBookmark",
        "taskflow-export-",
        "di TaskFlow",
        "Not Found — TaskFlow",
        "Protected — TaskFlow",
        ">TaskFlow</a>",
    ]:
        assert old not in src, f"webapp.py masih mengandung: {old!r}"

def test_webapp_internal_identifiers_kept():
    src = _read("webapp.py")
    assert "/TaskFlow/attachments" in src, "komentar routing internal wajib tetap"

def test_bot_visible_strings_rebranded():
    src = _read("bot.py")
    assert "Alurik" in src, "bot.py harus menyebut Alurik"
    for old in ["TaskFlow V4", "Selamat datang! TaskFlow"]:
        assert old not in src, f"bot.py masih mengandung: {old!r}"
    assert 'logging.getLogger("taskflow")' in src, "logger internal wajib tetap taskflow"

def test_other_modules_visible_strings_rebranded():
    mailer = _read("mailer.py")
    docx = _read("docx_exporter.py")
    ai_review = _read("ai_review.py")
    config = _read("config.py")
    # string user-visible lama wajib hilang
    for old in ["Reset Password TaskFlow", "akun TaskFlow-mu"]:
        assert old not in mailer, f"mailer.py masih mengandung: {old!r}"
    assert "Catatan TaskFlow" not in docx, "docx_exporter.py masih mengandung: 'Catatan TaskFlow'"
    assert "TaskFlow Weekly Review" not in ai_review, "ai_review.py masih mengandung: 'TaskFlow Weekly Review'"
    # ai_review.py tidak punya identifier internal taskflow (terverifikasi grep
    # case-insensitive: hanya 2 kemunculan, keduanya header X-Title user-visible)
    # → kata kapital "TaskFlow" wajib nol
    assert "TaskFlow" not in ai_review, "ai_review.py masih mengandung 'TaskFlow'"
    # config.py: SMTP_FROM default = display-name email From (user-visible);
    # identifier internal (taskflow.db, /TaskFlow/attachments) sah tetap ada
    assert "TaskFlow <noreply@localhost>" not in config, "config.py SMTP_FROM default masih TaskFlow"
    assert "TaskFlow V4" not in config, "config.py docstring masih mengandung 'TaskFlow V4'"
