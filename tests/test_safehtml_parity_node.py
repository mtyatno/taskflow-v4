"""Jalankan tes paritas perilaku safehtml.js ↔ safehtml.py (tests/offline/safehtml_parity.test.js) dari pytest,
supaya ikut CI (workflow test.yml hanya menjalankan pytest). Dilewati bila node tidak ada di PATH."""
import os
import shutil
import subprocess

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


@pytest.mark.skipif(shutil.which("node") is None, reason="node tidak ada di PATH")
def test_safehtml_js_py_behavioural_parity():
    r = subprocess.run(
        ["node", "--test", os.path.join("tests", "offline", "safehtml_parity.test.js")],
        cwd=ROOT, capture_output=True, text=True, timeout=300,
    )
    out = r.stdout + r.stderr
    assert r.returncode == 0, out[-6000:]
    # semua subtes benar-benar jalan (python3 ada di CI → tidak ada yang dilewati)
    assert "# fail 0" in out, out[-6000:]
    assert "# skipped 0" in out, out[-6000:]
