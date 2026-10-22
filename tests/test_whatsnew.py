"""Penjaga `static/whatsnew.json` (catatan pembaruan untuk modal "Apa yang baru"), ikut CI lewat pytest.

Spec docs/superpowers/specs/2026-10-23-apa-yang-baru-design.md §3.3 (aturan isi) dan §3.4 (precache).
`validate` menerapkan aturan 1-7; aturan 8 (ukuran file) dijaga test_whatsnew_file_size. Tes berikutnya
(mis. precache modul JS) memakai `static_entries` untuk membaca array `STATIC` di sw.js."""
import datetime
import json
import os
import re

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WHATSNEW = os.path.join(ROOT, "static", "whatsnew.json")
SW = os.path.join(ROOT, "static", "sw.js")
INDEX = os.path.join(ROOT, "static", "index.html")

VERSION_RE = re.compile(r"^taskflow-v(\d+)-[a-z0-9-]+$")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")  # fromisoformat menerima bentuk lain (mis. 20261023), spec hanya YYYY-MM-DD
ALLOWED_KEYS = {"version", "date", "title", "new", "fixed", "silent"}
MAX_TITLE = 60
MAX_POINT = 140
MAX_BYTES = 64 * 1024


def read(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


def load():
    return json.loads(read(WHATSNEW))


def sw_cache():
    return re.search(r'^const CACHE = "([^"]+)";', read(SW), re.M).group(1)


def index_sw_version():
    """Versi dari <script> awal di <body> index.html (`window.__SW_VERSION = "…";`), bukan fallback `|| "…"`."""
    return re.search(r'window\.__SW_VERSION\s*=\s*"([^"]+)";', read(INDEX)).group(1)


def static_entries(sw_src):
    """Isi array `const STATIC = [ … \\n];` di sw.js (bentuk yang sama dengan tests/offline/sw_precache_shell.test.js)."""
    block = re.search(r"const STATIC = \[([\s\S]*?)\n\];", sw_src)
    assert block, "blok `const STATIC = [ … \\n];` tidak ditemukan di sw.js"
    return re.findall(r'^\s*"([^"]+)",', block.group(1), re.M)


def _check_points(label, key, points, errs):
    """Validasi array poin `new`/`fixed` (aturan 6); kembalikan jumlah poin yang diperiksa."""
    if not isinstance(points, list) or not all(isinstance(p, str) for p in points):
        errs.append(f"{label}: {key} harus array string")
        return 0
    for p in points:
        if not p.strip():
            errs.append(f"{label}: {key} berisi poin kosong")
        if len(p) > MAX_POINT:
            errs.append(f"{label}: poin > {MAX_POINT} karakter di {key} ({len(p)})")
        if "<" in p or ">" in p:
            errs.append(f"{label}: poin memuat < atau > di {key}: {p[:40]!r}")
        if "\n" in p or "\r" in p:
            errs.append(f"{label}: poin memuat baris baru di {key}: {p[:40]!r}")
    return len(points)


def validate(data, cache, index_version):
    """Daftar pesan galat aturan isi 1-7 spec §3.3 (kosong = valid). `cache` = CACHE di sw.js,
    `index_version` = window.__SW_VERSION di index.html."""
    entries = data.get("entries") if isinstance(data, dict) else None
    if not isinstance(entries, list) or not entries:
        return ["entries kosong: wajib objek dengan kunci entries berupa array tidak kosong"]

    errs = []
    prev_num = None
    for i, e in enumerate(entries):
        label = f"entri #{i}"
        if not isinstance(e, dict):
            errs.append(f"{label}: bukan objek")
            continue

        unknown = sorted(set(e) - ALLOWED_KEYS)
        if unknown:  # aturan 7
            errs.append(f"{label}: kunci tidak dikenal: {', '.join(map(str, unknown))}")

        version = e.get("version")  # aturan 2 + 3
        m = VERSION_RE.match(version) if isinstance(version, str) else None
        if not m:
            errs.append(f"{label}: version {version!r} tidak valid (harus cocok {VERSION_RE.pattern})")
        else:
            num = int(m.group(1))
            if prev_num is not None and num >= prev_num:
                errs.append(f"{label}: nomor versi tidak turun tegas (v{num} setelah v{prev_num})")
            prev_num = num

        date = e.get("date")
        try:
            if not isinstance(date, str) or not DATE_RE.match(date):
                raise ValueError(date)
            datetime.date.fromisoformat(date)
        except ValueError:
            errs.append(f"{label}: date {date!r} tidak valid (harus tanggal YYYY-MM-DD yang ada)")

        silent = e.get("silent", False)  # aturan 5
        if not isinstance(silent, bool):
            errs.append(f"{label}: silent harus true atau false")
        if silent is True:
            extra = [k for k in ("title", "new", "fixed") if k in e]
            if extra:
                errs.append(f"{label}: silent tidak boleh punya title/new/fixed (ada: {', '.join(extra)})")
            continue

        title = e.get("title")
        if not isinstance(title, str) or not title.strip():
            errs.append(f"{label}: title wajib berupa teks tidak kosong (kecuali silent)")
        elif len(title) > MAX_TITLE:
            errs.append(f"{label}: title > {MAX_TITLE} karakter ({len(title)})")

        total = 0
        for key in ("new", "fixed"):
            if key in e:
                total += _check_points(label, key, e[key], errs)
        if total < 1:
            errs.append(f"{label}: minimal satu poin di new atau fixed")

    top = entries[0].get("version") if isinstance(entries[0], dict) else None  # aturan 4
    if top != cache or index_version != cache:
        errs.append(
            f"entri teratas ≠ CACHE: entri teratas={top!r}, CACHE di sw.js={cache!r}, "
            f"__SW_VERSION di index.html={index_version!r} (ketiganya harus sama persis)"
        )
    return errs


def test_whatsnew_file_valid():
    assert validate(load(), sw_cache(), index_sw_version()) == []


def test_whatsnew_file_size():
    assert os.path.getsize(WHATSNEW) <= MAX_BYTES


def test_whatsnew_json_precached():
    assert "/static/whatsnew.json" in static_entries(read(SW))


GOOD = {"version": "taskflow-v10-a", "date": "2026-10-23", "title": "Judul", "new": ["Poin."]}


@pytest.mark.parametrize("data, needle", [
    ({"entries": []}, "kosong"),
    ({"entries": [dict(GOOD, version="v10-a")]}, "version"),
    ({"entries": [dict(GOOD, date="2026-13-01")]}, "date"),
    ({"entries": [GOOD, dict(GOOD, version="taskflow-v10-b")]}, "turun"),
    ({"entries": [dict(GOOD, version="taskflow-v9-a")]}, "CACHE"),
    ({"entries": [dict(GOOD, silent=True)]}, "silent"),
    ({"entries": [{k: v for k, v in GOOD.items() if k != "title"}]}, "title"),
    ({"entries": [dict(GOOD, new=[], fixed=[])]}, "poin"),
    ({"entries": [dict(GOOD, new=["x" * 141])]}, "140"),
    ({"entries": [dict(GOOD, new=["<b>tebal</b>"])]}, "<"),
    ({"entries": [dict(GOOD, title="t" * 61)]}, "60"),
    ({"entries": [dict(GOOD, link="/x")]}, "kunci"),
    # sub-aturan yang tidak tertangkap baris di atas: tiap baris mengunci satu cabang validate
    ({"entries": [dict(GOOD, new=[""])]}, "poin kosong"),
    ({"entries": [dict(GOOD, new=["  "])]}, "poin kosong"),  # hanya spasi = kosong
    ({"entries": [dict(GOOD, new=["a\nb"])]}, "baris baru"),
    ({"entries": [dict(GOOD, new=["a\rb"])]}, "baris baru"),
    ({"entries": [dict(GOOD, new="bukan array")]}, "new harus array string"),
    ({"entries": [dict(GOOD, fixed=[3])]}, "fixed harus array string"),
    ({"entries": [dict(GOOD, date="20261023")]}, "date '20261023'"),  # fromisoformat (3.11+) menerimanya; hanya DATE_RE yang menolak
    ({"entries": [dict(GOOD, silent="ya")]}, "silent harus true atau false"),
])
def test_validator_rejects(data, needle):
    errs = validate(data, "taskflow-v10-a", "taskflow-v10-a")
    assert errs and any(needle in e for e in errs), errs


def test_validator_rejects_index_version_mismatch():
    # aturan 4 juga berlaku bila hanya index.html yang tertinggal
    errs = validate({"entries": [GOOD]}, "taskflow-v10-a", "taskflow-v9-a")
    assert errs and any("entri teratas ≠ CACHE" in e for e in errs), errs


def test_validator_accepts_silent_and_gaps():
    data = {"entries": [GOOD, {"version": "taskflow-v7-z", "date": "2026-10-22", "silent": True}]}
    assert validate(data, "taskflow-v10-a", "taskflow-v10-a") == []
