"""
Alurik — field plugin di task (`tasks.ext`), spec Fase 1 K4/K7, §5.2, §6.1; rencana PR 1a-1 R1–R4.

`tasks.ext` = objek JSON datar berkunci `<pluginId>.<field>`. Tulis selalu **patch per kunci** (`null` menghapus
kunci) supaya perangkat/anggota yang tidak menyentuh plugin tidak menimpa field plugin. Modul ini murni (tanpa
koneksi sendiri): `ensure_schema` menerima koneksi pemanggil dan tidak commit; tidak ada `sqlite3.connect`.

- `clean_patch(patch, allow_null=…)` — urutan: bentuk kunci (`EXT_INVALID`), nilai JSON baku (`EXT_INVALID`),
  referensi task `{"$task": <int>}` (`EXT_TASK_REF`), lalu namespace (R4): kunci milik plugin yang tidak berizin
  `task.ext` dibuang diam-diam (WARNING sekali per namespace per proses); indeks plugin rusak → gagal-terbuka.
  Namespace asing memicu baca ulang indeks paling sering sekali per `REFRESH_TTL_S` (10 s).
- `apply_patch(old_raw, patch)` → JSON baru; ukuran per namespace ≤ 4096 byte lalu total ≤ 16384 byte
  (byte UTF-8 `dumps` ringkas) → `EXT_TOO_LARGE` dengan `key` = namespace / `None`.
- `parse(raw)` → selalu `dict` (`{}` bila kosong/rusak).

Aturan yang sama ada di klien `static/offline/taskext.js` (vektor bersama `tests/fixtures/taskext_vectors.json`).
"""
from __future__ import annotations

import json
import logging
import math
import re
import time

import plugin_loader

logger = logging.getLogger("alurik.plugins")

KEY_RE = re.compile(r"^[a-z][a-z0-9-]{2,31}\.[a-zA-Z][a-zA-Z0-9_]{0,31}$")
PLUGIN_MAX_BYTES = 4096
TOTAL_MAX_BYTES = 16384
REF_KEY = "$task"

_warned: set[str] = set()
_warned_fail_open = False
# Baca ulang `index.json` karena namespace asing paling sering sekali per REFRESH_TTL_S (review akhir PR 1a-1):
# klien lama/plugin terhapus yang terus mengirim kunci asing tidak membuat setiap PUT membaca berkas.
REFRESH_TTL_S = 10.0
_clock = time.monotonic  # bisa disuntik tes
_last_refresh: float | None = None


class ExtError(Exception):
    def __init__(self, code: str, key: str | None = None):
        super().__init__(code)
        self.code = code
        self.key = key

    @property
    def detail(self) -> dict:
        return {"code": self.code, "key": self.key}


def dumps(obj) -> str:
    """JSON ringkas, non-ASCII apa adanya (dasar hitung byte, sama dengan `JSON.stringify`)."""
    return json.dumps(obj, separators=(",", ":"), ensure_ascii=False, allow_nan=False)


def _nbytes(obj) -> int:
    return len(dumps(obj).encode("utf-8"))


def namespace_of(key: str) -> str:
    return key.split(".", 1)[0]


def ensure_schema(conn) -> bool:
    """`ALTER TABLE tasks ADD COLUMN ext` bila belum ada (idempoten, tanpa backfill, tanpa commit).
    True bila kolom ditambahkan; tabel `tasks` tidak ada → False."""
    cols = {r[1] for r in conn.execute("PRAGMA table_info(tasks)").fetchall()}
    if not cols or "ext" in cols:
        return False
    conn.execute("ALTER TABLE tasks ADD COLUMN ext TEXT NOT NULL DEFAULT '{}'")
    return True


def parse(raw) -> dict:
    if not isinstance(raw, str) or not raw:
        return {}
    try:
        val = json.loads(raw)
    except (ValueError, TypeError):
        return {}
    return val if isinstance(val, dict) else {}


def _is_ref_ok(d: dict) -> bool:
    if len(d) != 1:
        return False
    v = d[REF_KEY]
    return isinstance(v, int) and not isinstance(v, bool)


def _check_value(key: str, value) -> None:
    """Nilai harus JSON baku (tanpa NaN/Infinity, string UTF-8 sah) dan setiap objek ber-`$task` harus ref sah."""
    stack = [value]
    while stack:
        v = stack.pop()
        if isinstance(v, dict):
            if REF_KEY in v and not _is_ref_ok(v):
                raise ExtError("EXT_TASK_REF", key)
            for k, item in v.items():
                if not isinstance(k, str):
                    raise ExtError("EXT_INVALID", key)
                stack.append(item)
        elif isinstance(v, list):
            stack.extend(v)
        elif isinstance(v, float):
            if not math.isfinite(v):
                raise ExtError("EXT_INVALID", key)
        elif v is None or isinstance(v, (bool, int)):
            pass
        elif isinstance(v, str):
            try:
                v.encode("utf-8")
            except UnicodeEncodeError:
                raise ExtError("EXT_INVALID", key) from None
        else:
            raise ExtError("EXT_INVALID", key)


def _allowed_namespaces(namespaces: set[str]) -> set[str] | None:
    """Namespace yang boleh disimpan; `None` = semua (indeks rusak, gagal-terbuka R4)."""
    global _warned_fail_open, _last_refresh
    if not plugin_loader.index_ok():
        if not _warned_fail_open:
            _warned_fail_open = True
            logger.warning("tasks.ext: indeks plugin tidak sehat — semua namespace ext diterima")
        return None
    allowed = plugin_loader.ext_namespaces()
    if namespaces <= allowed:
        return set(allowed)
    now = _clock()
    if _last_refresh is not None and now - _last_refresh < REFRESH_TTL_S:
        return set(allowed)  # baru dibaca ulang: hasil itu dipakai sampai TTL lewat
    _last_refresh = now
    plugin_loader.refresh_known()  # deploy menulis index.json baru sebelum proses di-restart
    if not plugin_loader.index_ok():
        return None
    return set(plugin_loader.ext_namespaces())


def clean_patch(patch, *, allow_null: bool) -> dict:
    """Validasi patch dan buang kunci ber-namespace asing. `allow_null=False` (POST) membuang nilai `null`."""
    if not isinstance(patch, dict):
        raise ExtError("EXT_INVALID", None)
    for key, value in patch.items():
        if not isinstance(key, str) or not KEY_RE.fullmatch(key):
            raise ExtError("EXT_INVALID", key if isinstance(key, str) else None)
        _check_value(key, value)
    namespaces = {namespace_of(k) for k in patch}
    allowed = _allowed_namespaces(namespaces) if namespaces else set()
    out = {}
    for key, value in patch.items():
        ns = namespace_of(key)
        if allowed is not None and ns not in allowed:
            if ns not in _warned:
                _warned.add(ns)
                logger.warning("tasks.ext: namespace '%s' bukan plugin berizin task.ext — kunci dibuang", ns)
            continue
        if value is None and not allow_null:
            continue
        out[key] = value
    return out


def size_error(ext: dict) -> ExtError | None:
    by_ns: dict[str, dict] = {}
    for k, v in ext.items():
        by_ns.setdefault(namespace_of(k), {})[k] = v
    for ns in sorted(by_ns):
        if _nbytes(by_ns[ns]) > PLUGIN_MAX_BYTES:
            return ExtError("EXT_TOO_LARGE", ns)
    if _nbytes(ext) > TOTAL_MAX_BYTES:
        return ExtError("EXT_TOO_LARGE", None)
    return None


def apply_patch(old_raw, patch: dict) -> str:
    """Gabung `patch` (sudah lewat `clean_patch`) ke JSON lama per kunci; `None` menghapus kunci."""
    ext = parse(old_raw)
    for key, value in patch.items():
        if value is None:
            ext.pop(key, None)
        else:
            ext[key] = value
    err = size_error(ext)
    if err is not None:
        raise err
    return dumps(ext)


def _reset_for_tests() -> None:
    global _warned_fail_open, _last_refresh
    _warned.clear()
    _warned_fail_open = False
    _last_refresh = None
