"""Jalankan tes node tema (registri TF.themes, guard literal/aturan gelap, boot script, dekorasi TF.decor, layar kosong) dari pytest, supaya
ikut CI (workflow test.yml hanya menjalankan pytest). Spec docs/superpowers/specs/2026-10-26-tema-palet-dekorasi-design.md.
File tes yang hilang = gagal (bukan dilewati); dilewati seluruhnya bila node tidak ada."""
import glob
import os
import re
import shutil
import subprocess

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NODE_TESTS = [
    "themes", "theme_guard", "theme_boot", "theme_palettes", "theme_react", "theme_settings_ui",
    "decor", "decor_ui", "empty_state_ui",
]
# Pola berkas yang wajib terdaftar di NODE_TESTS (tema, dekorasi, layar kosong).
NODE_TEST_GLOBS = ["theme*.test.js", "decor*.test.js", "empty_state*.test.js"]


@pytest.mark.skipif(shutil.which("node") is None, reason="node tidak ada di PATH")
def test_theme_node_tests():
    files = [os.path.join("tests", "offline", f"{n}.test.js") for n in NODE_TESTS]
    missing = [f for f in files if not os.path.exists(os.path.join(ROOT, f))]
    assert not missing, f"file tes hilang: {missing}"
    r = subprocess.run(["node", "--test", *files], cwd=ROOT, capture_output=True, text=True, timeout=300)
    out = r.stdout + r.stderr
    assert r.returncode == 0, out[-6000:]
    assert "# fail 0" in out, out[-6000:]
    m = re.search(r"# pass (\d+)", out)
    assert m and int(m.group(1)) > 0, "tidak ada tes yang berjalan:\n" + out[-3000:]


def test_theme_bridge_lists_all_files():
    # Semua tests/offline/{theme,decor,empty_state}*.test.js wajib terdaftar di NODE_TESTS, supaya tes tema baru
    # tidak diam-diam tertinggal dari CI (dan sebaliknya: entri NODE_TESTS tanpa berkas = gagal).
    on_disk = set()
    for pat in NODE_TEST_GLOBS:
        found = {os.path.basename(f)[: -len(".test.js")] for f in glob.glob(os.path.join(ROOT, "tests", "offline", pat))}
        assert found, f"glob {pat} kosong"
        on_disk |= found
    assert set(NODE_TESTS) == on_disk, f"NODE_TESTS {sorted(NODE_TESTS)} != berkas {sorted(on_disk)}"
    assert len(NODE_TESTS) == len(set(NODE_TESTS)), "NODE_TESTS berisi nama ganda"
    missing = [n for n in NODE_TESTS if not os.path.exists(os.path.join(ROOT, "tests", "offline", f"{n}.test.js"))]
    assert not missing, f"file tes hilang: {missing}"
