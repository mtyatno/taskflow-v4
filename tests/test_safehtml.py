"""safehtml.py: escape, allowlist tag isi note, filter URL, validasi atribut ::draw.

Aturan: docs/superpowers/specs/2026-10-19-xss-hardening-design.md §2. Kasus yang sama dipakai
static/offline/safehtml.js (Task berikutnya), jadi perilaku di sini adalah kontraknya.
"""
import pytest

from safehtml import (
    OBFUSCATED_CASES,
    escape_attr,
    escape_html,
    restore_allowed_tags,
    safe_draw_attrs,
    safe_url,
)


def test_escape_html_basic():
    assert escape_html('a&b<c>d"e\'') == 'a&amp;b&lt;c&gt;d"e\''
    assert escape_html(None) == ''
    assert escape_html(12) == '12'


def test_escape_attr_quotes():
    assert escape_attr('a"b\'c<') == 'a&quot;b&#x27;c&lt;'
    assert escape_attr('&>') == '&amp;&gt;'
    assert escape_attr(None) == ''


def test_restore_allowed_tags_exact_forms_only():
    src = ('&lt;br&gt; &lt;br/&gt; &lt;br /&gt; &lt;BR&gt; '
           '&lt;details&gt;&lt;summary&gt;S&lt;/summary&gt;D&lt;/details&gt; '
           '&lt;mark&gt;m&lt;/MARK&gt;')
    out = restore_allowed_tags(src)
    assert out == ('<br> <br> <br> <br> '
                   '<details><summary>S</summary>D</details> '
                   '<mark>m</mark>')
    for kept in ('&lt;br onclick=x&gt;', '&lt;mark style=x&gt;', '&lt;br  /&gt;', '&lt; br&gt;',
                 '&lt;br/ &gt;', '&lt;details open&gt;', '&lt;b&gt;', '&lt;script&gt;',
                 '&amp;lt;br&amp;gt;', '&lt;/br&gt;', '&lt;brx&gt;'):
        assert restore_allowed_tags(kept) == kept, kept


def test_allowlist_not_restored_inside_code():
    assert restore_allowed_tags('<code>&lt;br&gt;</code>') == '<code>&lt;br&gt;</code>'
    src = '<pre><code class="language-x">&lt;details&gt;\n&lt;mark&gt;</code></pre>'
    assert restore_allowed_tags(src) == src
    # di luar kode tetap dikembalikan
    assert (restore_allowed_tags('a&lt;br&gt;<code>&lt;br&gt;</code>&lt;br&gt;')
            == 'a<br><code>&lt;br&gt;</code><br>')
    # kode tanpa penutup: sisanya dianggap kode
    assert restore_allowed_tags('<code>&lt;br&gt;') == '<code>&lt;br&gt;'


def test_allowlist_not_restored_inside_attributes():
    src = '<img src="x.png" alt="&lt;br&gt;"><a title="&lt;mark&gt;" href="/x">t</a>'
    assert restore_allowed_tags(src) == src


@pytest.mark.parametrize("url", [
    "https://a.b", "http://a.b/c?d=1&e=2#f", "HTTPS://A.B", "mailto:a@b", "tel:1",
    "/x", "./x", "../x", "x.png", "foo/bar", "#h", "", "//cdn.example/x", "a/b:c", "?q=1:2",
])
def test_safe_url_allowed(url):
    assert safe_url(url) == url.strip()


@pytest.mark.parametrize("url", [
    "javascript:alert(1)", "JaVaScRiPt:x", "java&#x73;cript:x", "java&#115;cript:x",
    "&#106;avascript:x", "javascript&colon;x", "java&amp;#x73;cript:x",
    "\tjavascript:x", " javascript:x", "jav\x00ascript:x", "java\nscript:x", "java\tscript:x",
    "data:text/html,x", "data:image/png;base64,AAAA", "vbscript:x", "file:///etc/passwd",
    "ftp://a.b",
])
def test_safe_url_rejected(url):
    assert safe_url(url) is None


def test_safe_url_cases():
    assert safe_url("data:image/png;base64,AAAA", image=True) == "data:image/png;base64,AAAA"
    for ok in ("data:image/jpeg;base64,AA", "data:image/gif;base64,AA", "data:image/webp;base64,AA",
               "DATA:IMAGE/PNG;BASE64,AA", "https://a.b/x.png", "x.png"):
        assert safe_url(ok, image=True) == ok
    for bad in ("data:image/svg+xml;base64,AAAA", "data:image/png,AAAA", "data:text/html;base64,AA",
                "data:image/svg+xml,<svg onload=alert(1)>", "javascript:alert(1)"):
        assert safe_url(bad, image=True) is None
    assert safe_url(None) is None


def test_safe_draw_attrs():
    assert safe_draw_attrs({'size': 'M', 'width': '50%', 'height': '300px'}) == \
        {'size': 'M', 'width': '50%', 'height': '300px'}
    assert safe_draw_attrs({'width': 'x" onclick="y', 'size': 'Q'}) == {}
    assert safe_draw_attrs({'size': 'm', 'width': 'small', 'height': 'large'}) == \
        {'size': 'M', 'width': 'small', 'height': 'large'}
    for bad in ('50%\n', '50 %', '12345px', 'calc(1px)', '1em', '-1px', '50%;color:red', 'Small', ''):
        assert safe_draw_attrs({'width': bad, 'height': bad}) == {}, repr(bad)
    for bad in ('FULL', 'SM', 'S\n', '', 'X"onfocus=1'):
        assert safe_draw_attrs({'size': bad}) == {}, repr(bad)
    # kunci lain diteruskan apa adanya (di-escape saat dipakai)
    assert safe_draw_attrs({'title': '<b>"x"</b>', 'width': '9999px'}) == \
        {'title': '<b>"x"</b>', 'width': '9999px'}
    assert safe_draw_attrs(None) == {}


def test_obfuscated_cases_cover_review_focus():
    joined = "\n".join(OBFUSCATED_CASES)
    assert all(isinstance(c, str) and c for c in OBFUSCATED_CASES)
    for needle in ("java&#x73;cript:", "JaVaScRiPt:", "\tjavascript:", "<SCRIPT>", "<scr<script>ipt>",
                   "<br onclick=x>", "<mark style=", "<img src=x onerror=", "<svg onload=",
                   "](javascript:", '](x"onerror="', "</title><script>"):
        assert needle in joined, needle
