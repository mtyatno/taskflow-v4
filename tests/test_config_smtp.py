"""config.py: variabel SMTP kosong tidak boleh membuat import crash."""
import importlib

import config


def test_blank_smtp_numbers_use_defaults(monkeypatch):
    monkeypatch.setenv("SMTP_TIMEOUT", "")
    monkeypatch.setenv("SMTP_PORT", "")
    try:
        importlib.reload(config)
        assert config.SMTP_TIMEOUT == 15 and config.SMTP_PORT == 587
    finally:
        monkeypatch.undo()
        importlib.reload(config)
