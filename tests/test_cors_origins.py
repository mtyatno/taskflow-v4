"""Penjaga default `CORS_ALLOW_ORIGINS` di webapp.py selama masa transisi domain (ADR-036).

`webapp._CORS_ORIGINS` dihitung sekali saat import dari env `CORS_ALLOW_ORIGINS` (atau string default-nya),
jadi monkeypatch env setelah import tidak mengubahnya. Supaya deterministik, string default dibaca langsung
dari sumber webapp.py lewat `ast` dan diurai dengan aturan yang sama (split koma + strip + buang kosong).
Nilai runtime hanya diuji pada invarian yang berlaku apa pun env-nya, plus kesamaan dengan default bila
env tidak diset di proses ini (CI tidak mengaturnya).
"""
import ast
import os

import pytest

import webapp

WEBAPP_PY = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "webapp.py")
TAURI_ORIGINS = ["tauri://localhost", "http://tauri.localhost", "https://tauri.localhost"]
WEB_ORIGINS = ["https://alurik.com", "https://todo.yatno.web.id"]


def _default_cors_literal():
    """String default argumen kedua `os.environ.get("CORS_ALLOW_ORIGINS", "…")` di webapp.py."""
    with open(WEBAPP_PY, encoding="utf-8") as f:
        tree = ast.parse(f.read(), filename=WEBAPP_PY)
    hits = []
    for node in ast.walk(tree):
        if (isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr == "get"
                and isinstance(node.func.value, ast.Attribute) and node.func.value.attr == "environ"
                and len(node.args) == 2 and isinstance(node.args[0], ast.Constant)
                and node.args[0].value == "CORS_ALLOW_ORIGINS" and isinstance(node.args[1], ast.Constant)
                and isinstance(node.args[1].value, str)):
            hits.append(node.args[1].value)
    assert len(hits) == 1, f"os.environ.get('CORS_ALLOW_ORIGINS', '…') harus tepat satu di webapp.py, ada {len(hits)}"
    return hits[0]


def _parse(raw):
    # aturan yang sama dengan webapp.py
    return [o.strip() for o in raw.split(",") if o.strip()]


def test_default_cors_origins_memuat_kedua_domain_web():
    origins = _parse(_default_cors_literal())
    for o in WEB_ORIGINS:
        assert o in origins, f"{o} tidak ada di default CORS_ALLOW_ORIGINS: {origins}"


def test_default_cors_origins_tetap_memuat_origin_tauri():
    origins = _parse(_default_cors_literal())
    for o in TAURI_ORIGINS:
        assert o in origins, f"{o} hilang dari default CORS_ALLOW_ORIGINS: {origins}"


def test_default_cors_origins_tanpa_entri_kosong_spasi_atau_slash():
    raw = _default_cors_literal()
    parts = raw.split(",")
    assert all(p.strip() for p in parts), f"ada entri kosong di default: {raw!r}"
    assert all(p == p.strip() for p in parts), f"ada spasi di sekitar koma: {raw!r}"
    assert all(not p.endswith("/") for p in parts), f"origin tidak boleh berakhiran slash: {raw!r}"
    assert len(parts) == len(set(parts)), f"ada origin ganda: {raw!r}"


def test_runtime_cors_origins_tanpa_entri_kosong():
    # invarian list comprehension di webapp.py; berlaku apa pun isi env saat import
    assert isinstance(webapp._CORS_ORIGINS, list) and webapp._CORS_ORIGINS
    assert all(isinstance(o, str) and o and o == o.strip() for o in webapp._CORS_ORIGINS), webapp._CORS_ORIGINS


@pytest.mark.skipif("CORS_ALLOW_ORIGINS" in os.environ,
                    reason="CORS_ALLOW_ORIGINS diset di env proses ini; _CORS_ORIGINS saat import mengikuti env, bukan default")
def test_runtime_cors_origins_sama_dengan_default_bila_env_tidak_diset():
    assert webapp._CORS_ORIGINS == _parse(_default_cors_literal())
    for o in WEB_ORIGINS:
        assert o in webapp._CORS_ORIGINS
