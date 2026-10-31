"""Jalankan tes node sistem plugin Fase 0a–0b dari pytest, supaya ikut CI (workflow test.yml hanya menjalankan
pytest; `npm test` tidak mencakup tests/build-plugins.test.js). Spec
docs/superpowers/specs/2026-10-29-plugin-fase0a-design.md §11. Pola sama dengan tests/test_sw_precache_node.py:
file wajib yang hilang = gagal (bukan dilewati); dilewati seluruhnya bila node tidak ada."""
import glob
import os
import re
import shutil
import subprocess

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PATTERNS = [
    os.path.join("tests", "offline", "plugin_*.test.js"),
    os.path.join("tests", "offline", "habit_heatmap_*.test.js"),
    os.path.join("tests", "offline", "pluginstate*.test.js"),
    os.path.join("tests", "offline", "syncpush_pluginstate.test.js"),
]
EXTRA = [
    os.path.join("tests", "offline", "meta.test.js"),
    os.path.join("tests", "build-plugins.test.js"),
]
REQUIRED = [
    "plugin_registry", "plugin_events", "plugin_loader", "plugin_failure", "plugin_api", "plugin_storage",
    "plugin_slot", "plugin_host_wiring", "plugin_settings_ui",
    "plugin_fetch", "plugin_accountstate", "pluginstate", "syncpush_pluginstate",
]


def _files():
    found = sorted({os.path.relpath(f, ROOT) for p in PATTERNS for f in glob.glob(os.path.join(ROOT, p))})
    return found + EXTRA


def test_plugins_bridge_lists_required_files():
    names = {os.path.basename(f)[: -len(".test.js")] for f in _files()}
    missing = [n for n in REQUIRED if n not in names]
    assert not missing, f"file tes plugin hilang: {missing}"
    absent = [f for f in EXTRA if not os.path.exists(os.path.join(ROOT, f))]
    assert not absent, f"file tes hilang: {absent}"


def _npm_deps_present():
    """CI (test.yml) tidak menjalankan `npm install`: tes yang butuh fake-indexeddb / @babel/core dilewati di sana
    dan dijalankan lewat `npm test` lokal (pola tests/test_tag_node.py)."""
    code = "require.resolve('fake-indexeddb/auto'); require.resolve('@babel/core')"
    r = subprocess.run(["node", "-e", code], cwd=ROOT, capture_output=True, text=True, timeout=60)
    return r.returncode == 0


def _needs_npm(rel):
    with open(os.path.join(ROOT, rel), encoding="utf-8") as fh:
        src = fh.read()
    return bool(re.search(r"setup\.js|fake-indexeddb|@babel|compile\.js", src))


def _run(files):
    r = subprocess.run(["node", "--test", *files], cwd=ROOT, capture_output=True, text=True, timeout=300)
    out = r.stdout + r.stderr
    assert r.returncode == 0, out[-6000:]
    assert "# fail 0" in out, out[-6000:]
    m = re.search(r"# pass (\d+)", out)
    assert m and int(m.group(1)) > 0, "tidak ada tes yang berjalan:\n" + out[-3000:]


@pytest.mark.skipif(shutil.which("node") is None, reason="node tidak ada di PATH")
def test_plugins_node_tests_pure():
    files = [f for f in _files() if not _needs_npm(f)]
    assert files, "tidak ada tes plugin tanpa paket npm"
    _run(files)


@pytest.mark.skipif(shutil.which("node") is None, reason="node tidak ada di PATH")
def test_plugins_node_tests_npm():
    if not _npm_deps_present():
        pytest.skip("paket npm (fake-indexeddb, @babel/core) tidak terpasang (CI tidak menjalankan npm install); "
                    "jalankan `npm install` lalu `npm test` dan `node --test tests/build-plugins.test.js`")
    _run([f for f in _files() if _needs_npm(f)])
