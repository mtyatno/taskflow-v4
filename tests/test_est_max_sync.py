"""Batas target pomodoro server (webapp.TASK_EST_*) harus sama dengan klien (pomologic.js)."""
import re
from pathlib import Path

import webapp

POMOLOGIC = Path(__file__).resolve().parent.parent / "static" / "offline" / "pomologic.js"


def _angka_klien(nama):
    src = POMOLOGIC.read_text(encoding="utf-8")
    m = re.search(rf"(?m)^\s*const {nama} = (\d+);", src)
    assert m, f"pola 'const {nama} = <angka>;' tidak ditemukan di {POMOLOGIC}"
    return int(m.group(1))


def test_task_est_max_server_sama_dengan_est_max_pomologic():
    assert webapp.TASK_EST_MAX == _angka_klien("EST_MAX")


def test_task_est_min_server_sama_dengan_est_min_pomologic():
    assert webapp.TASK_EST_MIN == _angka_klien("EST_MIN")
