"""Validasi murni identitas workspace (spec kelola-workspace-fase1 §1.2).

Tanpa dependensi eksternal: aturan emoji memakai rentang codepoint, bukan pustaka `regex`.
Klien memakai aturan yang sama (`validateAvatar` di static/offline/workspacepins.js).
"""
from typing import Optional

AVATAR_ERROR = "Avatar harus 1–2 huruf/angka atau satu emoji"
DESCRIPTION_ERROR = "Deskripsi maksimal 300 karakter"
COLOR_ERROR = "Warna tidak valid"

DESCRIPTION_MAX = 300
_EMOJI_MAX_CODEPOINTS = 16

_ZWJ = 0x200D
_VS16 = 0xFE0F
_KEYCAP = 0x20E3
_EMOJI_RANGES = (
    (0x1F000, 0x1FAFF),
    (0x2600, 0x27BF),
    (0x2300, 0x23FF),
    (0x2B00, 0x2BFF),
)


def _in_emoji_range(cp: int) -> bool:
    return any(lo <= cp <= hi for lo, hi in _EMOJI_RANGES)


def _is_skin_modifier(cp: int) -> bool:
    return 0x1F3FB <= cp <= 0x1F3FF


def _is_regional(cp: int) -> bool:
    return 0x1F1E6 <= cp <= 0x1F1FF


def _is_single_emoji(s: str) -> bool:
    cps = [ord(c) for c in s]
    if not cps or len(cps) > _EMOJI_MAX_CODEPOINTS:
        return False
    # Keycap: [0-9#*] VS16? U+20E3
    if cps[-1] == _KEYCAP and chr(cps[0]) in "0123456789#*" and len(cps) in (2, 3):
        return len(cps) == 2 or cps[1] == _VS16
    bases = 0
    regional_run = 0
    prev = None
    for cp in cps:
        if cp in (_ZWJ, _VS16, _KEYCAP):
            regional_run = 0
        elif _in_emoji_range(cp):
            if _is_regional(cp):
                regional_run += 1
                if regional_run % 2 == 1:  # pasangan regional indicator dihitung satu
                    bases += 1
            else:
                regional_run = 0
                if not _is_skin_modifier(cp) and prev != _ZWJ:
                    bases += 1
        else:
            return False
        prev = cp
    # Regional indicator tunggal (jumlah ganjil) bukan bendera.
    return bases == 1 and regional_run % 2 == 0


def normalize_avatar(value: Optional[str]) -> Optional[str]:
    """None/kosong -> None; 1-2 huruf/angka -> uppercase; atau tepat satu emoji."""
    if value is None:
        return None
    if not isinstance(value, str):
        raise ValueError(AVATAR_ERROR)
    v = value.strip()
    if not v:
        return None
    if len(v) <= 2 and v.isalnum():
        return v.upper()
    if _is_single_emoji(v):
        return v
    raise ValueError(AVATAR_ERROR)


def normalize_description(value: Optional[str]) -> str:
    if value is None:
        return ""
    if not isinstance(value, str):
        raise ValueError(DESCRIPTION_ERROR)
    v = value.strip()
    if len(v) > DESCRIPTION_MAX:
        raise ValueError(DESCRIPTION_ERROR)
    return v


def normalize_color_idx(value) -> Optional[int]:
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, int) or not 0 <= value <= 7:
        raise ValueError(COLOR_ERROR)
    return value
