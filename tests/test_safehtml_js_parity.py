"""OBFUSCATED_CASES di static/offline/safehtml.js harus sama persis dengan safehtml.py.

Daftar di JS ditulis sebagai literal JSON di antara penanda OBFUSCATED_CASES:BEGIN/END supaya bisa dibaca di
sini tanpa node. Paritas perilaku (safe_url dkk.) dicek tests/offline/safehtml_parity.test.js.
"""
import json
import pathlib
import re

from safehtml import OBFUSCATED_CASES

JS_PATH = pathlib.Path(__file__).resolve().parent.parent / "static" / "offline" / "safehtml.js"


def _js_cases():
    src = JS_PATH.read_text(encoding="utf-8")
    m = re.search(r"/\* OBFUSCATED_CASES:BEGIN \*/(.*?)/\* OBFUSCATED_CASES:END \*/", src, re.DOTALL)
    assert m, "penanda OBFUSCATED_CASES:BEGIN/END tidak ditemukan di safehtml.js"
    return json.loads(m.group(1))


def test_obfuscated_cases_same_in_js():
    assert _js_cases() == OBFUSCATED_CASES


def test_js_marker_block_is_the_only_list():
    src = JS_PATH.read_text(encoding="utf-8")
    assert src.count("OBFUSCATED_CASES:BEGIN") == 1
    assert src.count("OBFUSCATED_CASES:END") == 1
