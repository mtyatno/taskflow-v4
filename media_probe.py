"""Sniff format media dari byte awal. Modul murni: tidak mengimpor webapp."""
from dataclasses import dataclass

ALLOWED_INIT_EXTS = frozenset(
    "mp3 m4a m4b aac wav ogg oga opus webm flac amr 3gp 3g2 mp4 m4v mov mkv".split())

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
