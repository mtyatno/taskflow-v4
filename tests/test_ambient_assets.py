"""Aset suara latar (static/sounds) dan skrip pembangkitnya.

Cek keberadaan + ukuran selalu jalan; cek durasi butuh ffprobe, cek sinyal
butuh numpy (keduanya tidak ada di CI -> di-skip).
"""
import importlib.util
import json
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
SOUNDS = ROOT / "static" / "sounds"
SCRIPT = ROOT / "scripts" / "gen_ambient_sounds.py"
NAMES = {"hujan": 30, "brown-noise": 30, "detak-jam": 10}
FILES = [SOUNDS / f"{n}-v1.{ext}" for n in NAMES for ext in ("ogg", "mp3")]


def _load_script():
    spec = importlib.util.spec_from_file_location("gen_ambient_sounds", SCRIPT)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


@pytest.mark.parametrize("path", FILES, ids=lambda p: p.name)
def test_file_exists_and_small(path):
    assert path.is_file()
    assert 0 < path.stat().st_size <= 250 * 1024


@pytest.mark.parametrize("path", FILES, ids=lambda p: p.name)
def test_duration_and_mono(path):
    if shutil.which("ffprobe") is None:
        pytest.skip("ffprobe tidak tersedia")
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "stream=channels:format=duration",
         "-of", "json", str(path)],
        capture_output=True, text=True, check=True).stdout
    info = json.loads(out)
    expected = NAMES[path.name.rsplit("-v1", 1)[0]]
    assert abs(float(info["format"]["duration"]) - expected) <= 0.1
    assert info["streams"][0]["channels"] == 1


def test_script_import_writes_nothing():
    pytest.importorskip("numpy")
    before = {p: p.stat().st_mtime_ns for p in FILES if p.exists()}
    _load_script()
    after = {p: p.stat().st_mtime_ns for p in FILES if p.exists()}
    assert before == after


def test_generators_shape_peak_and_loop():
    np = pytest.importorskip("numpy")
    gen = _load_script()
    sr = gen.SAMPLE_RATE
    for fn, secs in ((gen.make_brown_noise, 30), (gen.make_rain, 30)):
        x = fn(np.random.default_rng(1), secs)
        assert len(x) == secs * sr
        assert np.max(np.abs(x)) <= 0.9
        assert abs(x[-1] - x[0]) <= 0.05
        rms_db = 20 * np.log10(np.sqrt(np.mean(x ** 2)))
        assert abs(rms_db - gen.TARGET_RMS_DB) <= 3
    c = gen.make_clock(10)
    assert len(c) == 10 * sr
    assert np.max(np.abs(c)) <= 0.9
    # setiap ketukan ada energi, antar ketukan hening
    assert np.sqrt(np.mean(c[:sr // 20] ** 2)) > 0.01
    assert np.max(np.abs(c[sr // 2:sr - 100])) < 1e-3
