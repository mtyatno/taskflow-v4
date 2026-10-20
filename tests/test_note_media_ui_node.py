"""Jalankan semua tes node untuk UI media note dari pytest, supaya ikut CI (workflow test.yml hanya
menjalankan pytest). File tes yang hilang = gagal (bukan dilewati); dilewati seluruhnya bila node tidak ada."""
import os
import re
import shutil
import subprocess

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MEDIA_TESTS = [
    "mediadirective", "mediaupload", "mediacard", "render_markdown_media",
    "note_media_editor", "note_media_attachments", "sw_media",
]


@pytest.mark.skipif(shutil.which("node") is None, reason="node tidak ada di PATH")
def test_note_media_ui_node_tests():
    files = [os.path.join("tests", "offline", f"{n}.test.js") for n in MEDIA_TESTS]
    missing = [f for f in files if not os.path.exists(os.path.join(ROOT, f))]
    assert not missing, f"file tes media hilang: {missing}"
    r = subprocess.run(["node", "--test", *files], cwd=ROOT, capture_output=True, text=True, timeout=300)
    out = r.stdout + r.stderr
    assert r.returncode == 0, out[-6000:]
    assert "# fail 0" in out, out[-6000:]
    m = re.search(r"# pass (\d+)", out)
    assert m and int(m.group(1)) > 0, "tidak ada tes yang berjalan:\n" + out[-3000:]


EXPECTED_MEDIA_TESTS = {
    "mediadirective", "mediaupload", "mediacard", "render_markdown_media",
    "note_media_editor", "note_media_attachments", "sw_media",
}


def test_note_media_ui_bridge_lists_all_media_files():
    assert set(MEDIA_TESTS) == EXPECTED_MEDIA_TESTS
    missing = [n for n in MEDIA_TESTS if not os.path.exists(os.path.join(ROOT, "tests", "offline", f"{n}.test.js"))]
    assert not missing, f"file tes media hilang: {missing}"
