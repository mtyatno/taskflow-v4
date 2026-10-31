"""bot.on_error — NetworkError sesaat = satu baris WARNING tanpa traceback; error lain ERROR + traceback;
main() memasang error handler dan loader plugin (rencana PR B T5, R18)."""
import ast
import asyncio
import logging
from pathlib import Path
from types import SimpleNamespace

from telegram.error import NetworkError, TimedOut

import bot


def _run(update, err, caplog):
    with caplog.at_level(logging.INFO, logger="taskflow"):
        asyncio.run(bot.on_error(update, SimpleNamespace(error=err)))
    return [r for r in caplog.records if r.name == "taskflow"]


def test_network_error_one_warning_line(caplog):
    recs = _run(None, NetworkError("httpx.ReadError: "), caplog)
    assert len(recs) == 1
    rec = recs[0]
    assert rec.levelno == logging.WARNING
    assert rec.exc_info is None
    assert "NetworkError" in rec.getMessage()
    assert not [r for r in caplog.records if r.levelno >= logging.ERROR]


def test_timed_out_is_network_error(caplog):
    recs = _run(None, TimedOut(), caplog)
    assert len(recs) == 1
    assert recs[0].levelno == logging.WARNING
    assert recs[0].exc_info is None
    assert "TimedOut" in recs[0].getMessage()


def test_other_error_logged_with_traceback(caplog):
    try:
        raise ValueError("x")
    except ValueError as e:
        err = e
    recs = _run(SimpleNamespace(update_id=42), err, caplog)
    assert len(recs) == 1
    rec = recs[0]
    assert rec.levelno == logging.ERROR
    assert rec.exc_info is not None and rec.exc_info[0] is ValueError
    assert "42" in rec.getMessage()


def test_update_id_fallback():
    assert bot._update_id(None) == "-"
    assert bot._update_id(SimpleNamespace(update_id=7)) == "7"


def test_main_registers_error_handler_and_loader():
    src = Path(bot.__file__).read_text(encoding="utf-8")
    fn = next(n for n in ast.parse(src).body if isinstance(n, ast.FunctionDef) and n.name == "main")
    calls = sorted((n for n in ast.walk(fn) if isinstance(n, ast.Call)), key=lambda c: (c.lineno, c.col_offset))

    def find(pred):
        return [c for c in calls if pred(c)]

    def attr(c, name):
        return isinstance(c.func, ast.Attribute) and c.func.attr == name

    eh = find(lambda c: attr(c, "add_error_handler"))
    assert eh and [ast.unparse(a) for a in eh[0].args] == ["on_error"]
    bind = find(lambda c: attr(c, "bind") and ast.unparse(c.func.value) == "plugin_host")
    assert bind
    kw = {k.arg: ast.unparse(k.value) for k in bind[0].keywords}
    assert kw.get("current_user") == "None"
    assert "db_path" in kw
    lfb = find(lambda c: attr(c, "load_for_bot") and ast.unparse(c.func.value) == "plugin_loader")
    assert lfb and [ast.unparse(a) for a in lfb[0].args] == ["app"]
    poll = find(lambda c: attr(c, "run_polling"))
    assert poll
    last = poll[-1].lineno
    assert eh[0].lineno < last and bind[0].lineno < last and lfb[0].lineno < last
    assert bind[0].lineno < lfb[0].lineno
