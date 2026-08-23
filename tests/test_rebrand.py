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
