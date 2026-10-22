"""Jalankan tes node precache service worker dari pytest, supaya ikut CI (workflow test.yml hanya
menjalankan pytest). Penjaga ini mencegah mode gagal permanen: entri shell yang 404 / ganda membuat semua
update SW gagal (spec docs/superpowers/specs/2026-10-22-sw-precache-shell-design.md §3.2, §6).
File tes yang hilang = gagal (bukan dilewati); dilewati seluruhnya bila node tidak ada."""
import os
import re
import shutil
import subprocess

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SW_TESTS = ["sw_precache_shell", "sw_ambient_cache"]


@pytest.mark.skipif(shutil.which("node") is None, reason="node tidak ada di PATH")
def test_sw_precache_node_tests():
    files = [os.path.join("tests", "offline", f"{n}.test.js") for n in SW_TESTS]
    missing = [f for f in files if not os.path.exists(os.path.join(ROOT, f))]
    assert not missing, f"file tes SW hilang: {missing}"
    r = subprocess.run(["node", "--test", *files], cwd=ROOT, capture_output=True, text=True, timeout=300)
    out = r.stdout + r.stderr
    assert r.returncode == 0, out[-6000:]
    assert "# fail 0" in out, out[-6000:]
    m = re.search(r"# pass (\d+)", out)
    assert m and int(m.group(1)) > 0, "tidak ada tes yang berjalan:\n" + out[-3000:]


EXPECTED_SW_TESTS = {"sw_precache_shell", "sw_ambient_cache"}


def test_sw_precache_bridge_lists_all_files():
    assert set(SW_TESTS) == EXPECTED_SW_TESTS
    missing = [n for n in SW_TESTS if not os.path.exists(os.path.join(ROOT, "tests", "offline", f"{n}.test.js"))]
    assert not missing, f"file tes SW hilang: {missing}"
