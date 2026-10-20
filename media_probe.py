"""Sniff format media dari byte awal. Modul murni: tidak mengimpor webapp."""
import json
import logging
import os
import re
import struct
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

_log = logging.getLogger("alurik.media_probe")

ALLOWED_INIT_EXTS = frozenset(
    "mp3 m4a m4b aac wav ogg oga opus webm flac amr 3gp 3g2 mp4 m4v mov mkv".split())

# Direktif ::media[client_id]{name="..."} di isi note (juga bentuk ter-escape serializer markdown).
MEDIA_DIRECTIVE_RE = re.compile(
    r'\\?::media\\?\[([0-9a-zA-Z_-]{1,64})\\?\](?:\s*\\?\{([^}]*)\\?\})?', re.IGNORECASE)


def format_duration(ms) -> Optional[str]:
    """m:ss, atau h:mm:ss bila >= 1 jam; None bila tidak diketahui."""
    try:
        total = int(ms) // 1000
    except (TypeError, ValueError):
        return None
    if total <= 0:
        return None
    h, rem = divmod(total, 3600)
    m, s = divmod(rem, 60)
    return f"{h}:{m:02d}:{s:02d}" if h else f"{m}:{s:02d}"


_VIDEO_EXTS = {".mov", ".mp4", ".webm", ".mkv", ".3gp"}
_MP4_BRANDS = {"isom", "iso2", "iso4", "iso5", "iso6", "mp41", "mp42", "avc1", "dash", "MSNV", "M4V "}


@dataclass
class Sniff:
    family: str
    brand: str
    ext: str
    default_media_type: str


def _mk(family, brand, ext):
    return Sniff(family, brand, ext, "video" if ext in _VIDEO_EXTS else "audio")


def sniff_media(head: bytes):
    head = bytes(head[:64])
    if len(head) < 2:
        return None
    if head[4:8] == b"ftyp":
        if len(head) < 12:
            return None
        brand = head[8:12].decode("latin-1")
        if brand in ("M4A ", "M4B "):
            return _mk("isobmff", brand, ".m4a")
        if brand == "qt  ":
            return _mk("isobmff", brand, ".mov")
        if brand[:3] in ("3gp", "3g2"):
            return _mk("isobmff", brand, ".3gp")
        if brand in _MP4_BRANDS:
            return _mk("isobmff", brand, ".mp4")
        return None
    if head[:4] == b"\x1a\x45\xdf\xa3":
        if b"webm" in head:
            return _mk("matroska", "webm", ".webm")
        return _mk("matroska", "matroska", ".mkv")
    if head[:3] == b"ID3" or ((head[0] << 8 | head[1]) & 0xFFE0) == 0xFFE0:
        return _mk("mpeg_audio", "", ".mp3")
    if head[:4] == b"OggS":
        return _mk("ogg", "", ".ogg")
    if head[:4] == b"RIFF" and head[8:12] == b"WAVE":
        return _mk("wav", "", ".wav")
    if head[:4] == b"fLaC":
        return _mk("flac", "", ".flac")
    if head[:5] == b"#!AMR":
        return _mk("amr", "", ".amr")
    return None


def final_mime(s: Sniff, media_type: str, format_name: str = "") -> str:
    video = media_type == "video"
    f = s.family
    if f == "isobmff":
        if s.ext == ".mov":
            return "video/quicktime"
        if s.ext == ".3gp":
            return "video/3gpp" if video else "audio/3gpp"
        return "video/mp4" if video else "audio/mp4"
    if f == "mpeg_audio":
        return "audio/aac" if format_name == "aac" else "audio/mpeg"
    if f == "ogg":
        return "video/ogg" if video else "audio/ogg"
    if f == "wav":
        return "audio/wav"
    if f == "matroska":
        base = "webm" if s.brand == "webm" else "x-matroska"
        return f"{'video' if video else 'audio'}/{base}"
    if f == "flac":
        return "audio/flac"
    if f == "amr":
        return "audio/amr"
    raise ValueError(f"keluarga tidak dikenal: {f}")


# Nama format ffprobe (`format.format_name`, dipisah koma) yang sah untuk tiap keluarga sniff.
# Mencegah file dengan awalan yang lolos sniff (mis. ID3) tetapi isinya kontainer lain (mis. AVI).
_FAMILY_FORMATS = {
    "mpeg_audio": frozenset({"mp3", "aac"}),
    "isobmff": frozenset({"mov", "mp4", "m4a", "3gp", "3g2", "mj2"}),
    "ogg": frozenset({"ogg"}),
    "wav": frozenset({"wav"}),
    "matroska": frozenset({"matroska", "webm"}),
    "flac": frozenset({"flac"}),
    "amr": frozenset({"amr"}),
}


def format_matches_family(family: str, format_name) -> bool:
    """True bila salah satu nama di `format_name` ffprobe termasuk keluarga sniff `family`."""
    allowed = _FAMILY_FORMATS.get(family)
    if not allowed or not isinstance(format_name, str):
        return False
    return any(n.strip() in allowed for n in format_name.split(","))


# ── ffprobe / ffmpeg (Task 3) ────────────────────────────────────────────────

@dataclass
class ProbeInfo:
    media_type: str
    duration_ms: Optional[int]
    video_codec: Optional[str]
    audio_codec: Optional[str]
    width: Optional[int]
    height: Optional[int]
    format_name: str


def _num(v):
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if f >= 0 and f == f and f != float("inf") else None


def parse_probe(data: dict):
    """Ubah keluaran `ffprobe -print_format json` jadi ProbeInfo; None bila tanpa stream audio/video."""
    if not isinstance(data, dict):
        return None
    streams = [s for s in (data.get("streams") or []) if isinstance(s, dict)]
    video = next((s for s in streams if s.get("codec_type") == "video"
                  and not (s.get("disposition") or {}).get("attached_pic")), None)
    audio = next((s for s in streams if s.get("codec_type") == "audio"), None)
    if video is None and audio is None:
        return None
    fmt = data.get("format") or {}
    dur = _num(fmt.get("duration"))
    if dur is None:
        dur = next((d for d in (_num(s.get("duration")) for s in (video, audio) if s) if d is not None), None)

    def _int(v):
        return int(v) if isinstance(v, (int, float)) and v > 0 else None

    return ProbeInfo(
        media_type="video" if video else "audio",
        duration_ms=int(round(dur * 1000)) if dur is not None else None,
        video_codec=(video or {}).get("codec_name"),
        audio_codec=(audio or {}).get("codec_name"),
        width=_int((video or {}).get("width")),
        height=_int((video or {}).get("height")),
        format_name=str(fmt.get("format_name") or ""),
    )


_FASTSTART_MAX_ATOMS = 10_000


def needs_faststart(path) -> bool:
    """True bila atom `mdat` muncul sebelum `moov` (scan atom top-level ISO-BMFF).
    Scan dibatasi `_FASTSTART_MAX_ATOMS` atom; batas tercapai → False (file dibiarkan apa adanya)."""
    seen_mdat = False
    try:
        with open(path, "rb") as f:
            size_total = os.fstat(f.fileno()).st_size
            pos = 0
            for _ in range(_FASTSTART_MAX_ATOMS):
                if pos + 8 > size_total:
                    break
                f.seek(pos)
                hdr = f.read(8)
                if len(hdr) < 8:
                    break
                size, kind = struct.unpack(">I4s", hdr)
                if size == 1:
                    ext = f.read(8)
                    if len(ext) < 8:
                        break
                    size = struct.unpack(">Q", ext)[0]
                elif size == 0:
                    size = size_total - pos
                if kind == b"moov":
                    return seen_mdat
                if kind == b"mdat":
                    seen_mdat = True
                if size < 8:
                    break
                pos += size
    except OSError:
        return False
    return False


def _run(cmd, timeout):
    return subprocess.run(cmd, stdin=subprocess.DEVNULL, capture_output=True, timeout=timeout, check=False)


def run_ffprobe(path, bin="ffprobe", timeout=60):
    cmd = [bin, "-v", "error", "-print_format", "json", "-show_format", "-show_streams", str(path)]
    try:
        r = _run(cmd, timeout)
    except (OSError, subprocess.SubprocessError) as e:
        _log.warning("ffprobe gagal dijalankan: %s", e)
        return None
    if r.returncode != 0:
        return None
    try:
        data = json.loads(r.stdout.decode("utf-8", "replace"))
    except ValueError:
        return None
    return data if isinstance(data, dict) else None


def remux_faststart(src, dst, bin="ffmpeg", timeout=600) -> bool:
    cmd = [bin, "-y", "-v", "error", "-i", str(src), "-c", "copy", "-map", "0",
           "-movflags", "+faststart", str(dst)]
    try:
        r = _run(cmd, timeout)
    except (OSError, subprocess.SubprocessError) as e:
        _log.warning("ffmpeg faststart gagal: %s", e)
        return False
    return r.returncode == 0 and Path(dst).exists() and Path(dst).stat().st_size > 0


def make_poster(src, dst, at_sec: float, bin="ffmpeg", timeout=60) -> bool:
    cmd = [bin, "-y", "-v", "error", "-ss", f"{at_sec:.3f}", "-i", str(src), "-frames:v", "1",
           "-vf", "scale=640:-2", "-f", "image2", "-c:v", "mjpeg", str(dst)]
    try:
        r = _run(cmd, timeout)
    except (OSError, subprocess.SubprocessError) as e:
        _log.warning("ffmpeg poster gagal: %s", e)
        return False
    return r.returncode == 0 and Path(dst).exists() and Path(dst).stat().st_size > 0
