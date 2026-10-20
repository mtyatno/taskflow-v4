"""Jalankan tes node untuk UI media note (mediadirective/mediaupload/mediacard) dari pytest,
supaya ikut CI (workflow test.yml hanya menjalankan pytest). File tes yang belum ada dilewati;
dilewati seluruhnya bila node tidak ada di PATH."""
import os
import re
import shutil
import subprocess

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MEDIA_TESTS = ["mediadirective", "mediaupload", "mediacard"]


@pytest.mark.skipif(shutil.which("node") is None, reason="node tidak ada di PATH")
def test_note_media_ui_node_tests():
    files = [
        os.path.join("tests", "offline", f"{n}.test.js")
        for n in MEDIA_TESTS
        if os.path.exists(os.path.join(ROOT, "tests", "offline", f"{n}.test.js"))
    ]
    assert files, "tidak ada file tes media node ditemukan"
    r = subprocess.run(["node", "--test", *files], cwd=ROOT, capture_output=True, text=True, timeout=300)
    out = r.stdout + r.stderr
    assert r.returncode == 0, out[-6000:]
    assert "# fail 0" in out, out[-6000:]
    m = re.search(r"# pass (\d+)", out)
    assert m and int(m.group(1)) > 0, "tidak ada tes yang berjalan:\n" + out[-3000:]
