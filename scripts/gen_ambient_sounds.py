#!/usr/bin/env python3
"""Synthesize the ambient focus sounds -> static/sounds/{name}-v1.{ogg,mp3}.

Sounds: hujan (rain, 30 s loop), brown-noise (30 s loop), detak-jam (clock
tick-tock, 10 s loop). 44.1 kHz mono, fixed RNG seed so output is reproducible.
Encoded with ffmpeg: ogg vorbis (-q:a 2) and mp3 (64 kbps).

Run:  python scripts/gen_ambient_sounds.py

Requires numpy and ffmpeg. numpy is ONLY needed to regenerate these assets;
it is not a runtime dependency (do not add it to requirements-web.txt).
Bump the "-v1" suffix (and the app's references) when changing the sounds.
"""
import subprocess
from pathlib import Path

import numpy as np

SAMPLE_RATE = 44100
SEED = 20261021
TARGET_RMS_DB = -24.0   # noise loops; clock uses the same value per tick window
PEAK_LIMIT = 0.85       # linear, ~ -1.4 dBFS
CROSSFADE_S = 2.0
OUT_DIR = Path(__file__).resolve().parent.parent / "static" / "sounds"


def _filter(x, low=None, high=None):
    """Zero-phase FFT band filter with smooth (raised-cosine) edges."""
    spec = np.fft.rfft(x)
    f = np.fft.rfftfreq(len(x), 1 / SAMPLE_RATE)
    gain = np.ones_like(f)
    if low is not None:  # high-pass, transition low/2 .. low
        gain *= np.clip((f - low / 2) / (low / 2), 0, 1)
    if high is not None:  # low-pass, transition high .. high*1.25
        gain *= np.clip((high * 1.25 - f) / (high * 0.25), 0, 1)
    gain = np.sin(gain * np.pi / 2) ** 2
    return np.fft.irfft(spec * gain, len(x))


def _normalize(x, target_db=TARGET_RMS_DB):
    x = x - np.mean(x)
    x = x * (10 ** (target_db / 20) / np.sqrt(np.mean(x ** 2)))
    peak = np.max(np.abs(x))
    if peak > PEAK_LIMIT:
        x *= PEAK_LIMIT / peak
    return x


def _make_loop(signal, n):
    """Cut n samples from signal (n + crossfade long), equal-power crossfading
    the extra tail into the head so the loop point is seamless."""
    xf = int(CROSSFADE_S * SAMPLE_RATE)
    t = np.linspace(0, np.pi / 2, xf)
    out = signal[:n].copy()
    out[:xf] = signal[:xf] * np.sin(t) + signal[n:n + xf] * np.cos(t)
    return out


def make_brown_noise(rng, seconds):
    n = int(seconds * SAMPLE_RATE)
    total = n + int(CROSSFADE_S * SAMPLE_RATE)
    x = np.cumsum(rng.standard_normal(total))
    x = _filter(x, low=20, high=6000)  # remove drift, soften top end
    return _normalize(_make_loop(x, n))


def make_rain(rng, seconds):
    n = int(seconds * SAMPLE_RATE)
    total = n + int(CROSSFADE_S * SAMPLE_RATE)
    # pink-ish bed: white noise shaped 1/sqrt(f), band-passed 400 Hz - 8 kHz
    spec = np.fft.rfft(rng.standard_normal(total))
    f = np.fft.rfftfreq(total, 1 / SAMPLE_RATE)
    bed = np.fft.irfft(spec / np.sqrt(np.maximum(f, 1.0)), total)
    bed = _normalize(_filter(bed, low=400, high=8000))
    # droplets: short decaying sine bursts, 30-80 per second
    drops = np.zeros(total)
    count = int(rng.uniform(30, 80) * total / SAMPLE_RATE)
    starts = rng.integers(0, total - 2000, count)
    tt = np.arange(1500) / SAMPLE_RATE
    for s in starts:
        freq = rng.uniform(1500, 4500)
        env = np.exp(-tt / rng.uniform(0.002, 0.006))
        drops[s:s + 1500] += rng.uniform(0.1, 1.0) * env * np.sin(2 * np.pi * freq * tt)
    drops = _filter(drops, low=400, high=6000)
    mix = bed + 0.5 * _normalize(drops)
    return _normalize(_make_loop(mix, n))


def make_clock(seconds):
    n = int(seconds * SAMPLE_RATE)
    out = np.zeros(n)
    burst = int(0.015 * SAMPLE_RATE)
    t = np.arange(burst * 6) / SAMPLE_RATE
    window = int(0.05 * SAMPLE_RATE)
    gains = []
    for beat in range(int(seconds)):
        freq = 2500 if beat % 2 == 0 else 2000  # tik / tok
        click = np.exp(-t / (0.015 / 4)) * np.sin(2 * np.pi * freq * t)
        click[:20] *= np.linspace(0, 1, 20)  # no onset click
        start = beat * SAMPLE_RATE
        out[start:start + len(click)] += click
        gains.append(np.sqrt(np.mean(out[start:start + window] ** 2)))
    out *= 10 ** (TARGET_RMS_DB / 20) / np.mean(gains)  # RMS over tick windows
    peak = np.max(np.abs(out))
    if peak > PEAK_LIMIT:
        out *= PEAK_LIMIT / peak
    return out


def _encode(samples, name):
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    raw = samples.astype("<f4").tobytes()
    for ext, codec in (("ogg", ["-c:a", "libvorbis", "-q:a", "2"]),
                       ("mp3", ["-c:a", "libmp3lame", "-b:a", "64k"])):
        subprocess.run(
            ["ffmpeg", "-y", "-v", "error", "-f", "f32le", "-ar", str(SAMPLE_RATE),
             "-ac", "1", "-i", "-", *codec, str(OUT_DIR / f"{name}-v1.{ext}")],
            input=raw, check=True)


def main():
    rng = np.random.default_rng(SEED)
    _encode(make_rain(rng, 30), "hujan")
    _encode(make_brown_noise(rng, 30), "brown-noise")
    _encode(make_clock(10), "detak-jam")


if __name__ == "__main__":
    main()
