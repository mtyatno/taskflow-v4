"""Jalankan tes node perbaikan tag task (simpan task tidak menghapus tag; overlay "Task dengan tag" menutupi area
terlihat saat isi digulir) dari pytest, supaya ikut CI (workflow test.yml hanya menjalankan pytest). ADR-032.
File tes yang hilang = gagal (bukan dilewati); dilewati seluruhnya bila node tidak ada.

Tes repo IndexedDB (taskrepo, tagrepo) memuat tests/offline/setup.js yang butuh paket npm `fake-indexeddb`.
Workflow CI tidak menjalankan `npm install`, jadi tes itu hanya dijalankan di sini bila paketnya terpasang
(lokal: `npm install`); selain itu dilewati dengan alasan eksplisit. `npm test` lokal tetap menjalankannya."""
import os
import re
import shutil
import subprocess

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# Tes sumber murni (tanpa paket npm) — selalu jalan di CI.
NODE_TESTS = ["tag_tasks_overlay"]
# Tes IndexedDB (butuh fake-indexeddb).
IDB_NODE_TESTS = ["taskrepo", "tagrepo"]


def _run_node_tests(names):
    files = [os.path.join("tests", "offline", f"{n}.test.js") for n in names]
    missing = [f for f in files if not os.path.exists(os.path.join(ROOT, f))]
    assert not missing, f"file tes hilang: {missing}"
    r = subprocess.run(["node", "--test", *files], cwd=ROOT, capture_output=True, text=True, timeout=300)
    out = r.stdout + r.stderr
    assert r.returncode == 0, out[-6000:]
    assert "# fail 0" in out, out[-6000:]
    m = re.search(r"# pass (\d+)", out)
    assert m and int(m.group(1)) > 0, "tidak ada tes yang berjalan:\n" + out[-3000:]


def _has_fake_indexeddb():
    r = subprocess.run(["node", "-e", "require.resolve('fake-indexeddb/auto')"], cwd=ROOT,
                       capture_output=True, text=True, timeout=60)
    return r.returncode == 0


@pytest.mark.skipif(shutil.which("node") is None, reason="node tidak ada di PATH")
def test_tag_node_tests():
    _run_node_tests(NODE_TESTS)


@pytest.mark.skipif(shutil.which("node") is None, reason="node tidak ada di PATH")
def test_tag_idb_node_tests():
    if not _has_fake_indexeddb():
        pytest.skip("paket npm fake-indexeddb tidak terpasang (CI tidak menjalankan npm install); "
                    "jalankan `npm install` lalu `npm test` untuk tes taskrepo/tagrepo")
    _run_node_tests(IDB_NODE_TESTS)


EXPECTED_NODE_TESTS = {"tag_tasks_overlay"}
EXPECTED_IDB_NODE_TESTS = {"taskrepo", "tagrepo"}


def test_tag_bridge_lists_all_files():
    assert set(NODE_TESTS) == EXPECTED_NODE_TESTS
    assert set(IDB_NODE_TESTS) == EXPECTED_IDB_NODE_TESTS
    names = NODE_TESTS + IDB_NODE_TESTS
    missing = [n for n in names if not os.path.exists(os.path.join(ROOT, "tests", "offline", f"{n}.test.js"))]
    assert not missing, f"file tes hilang: {missing}"
