"""Jalankan tes node `static/config.js` (resolveApiBase: host web same-origin vs fallback Tauri ke alurik.com)
dari pytest, supaya ikut CI (workflow test.yml hanya menjalankan pytest). Pola sama dengan
tests/test_sw_precache_node.py: file tes yang hilang = gagal (bukan dilewati); dilewati seluruhnya bila node tidak ada.
ADR-036 (masa transisi dua domain)."""
import os
import re
import shutil
import subprocess

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONFIG_TEST = os.path.join("tests", "offline", "config.test.js")


def test_config_node_test_file_exists():
    assert os.path.exists(os.path.join(ROOT, CONFIG_TEST)), f"file tes config hilang: {CONFIG_TEST}"
    assert os.path.exists(os.path.join(ROOT, "static", "config.js")), "static/config.js hilang"


@pytest.mark.skipif(shutil.which("node") is None, reason="node tidak ada di PATH")
def test_config_node_tests():
    assert os.path.exists(os.path.join(ROOT, CONFIG_TEST)), f"file tes config hilang: {CONFIG_TEST}"
    r = subprocess.run(["node", "--test", CONFIG_TEST], cwd=ROOT, capture_output=True, text=True, timeout=300)
    out = r.stdout + r.stderr
    assert r.returncode == 0, out[-6000:]
    assert "# fail 0" in out, out[-6000:]
    m = re.search(r"# pass (\d+)", out)
    assert m and int(m.group(1)) > 0, "tidak ada tes yang berjalan:\n" + out[-3000:]
