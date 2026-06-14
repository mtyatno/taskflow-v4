"""Bookmark URL validation + readable-article extraction (kept out of webapp.py
so the pure logic is importable and testable on its own)."""
import ipaddress
import socket
from urllib.parse import urlparse


def validate_bookmark_url(url):
    """Return None if the URL is safe to fetch, else a human error string.

    Allows only http/https public hosts. Rejects private/loopback/link-local/
    reserved IPs (SSRF guard). For IP-literal hosts no DNS lookup happens.
    """
    if not isinstance(url, str) or len(url) > 2048:
        return "URL tidak valid"
    parsed = urlparse(url.strip())
    if parsed.scheme not in ("http", "https"):
        return "Hanya URL http/https yang didukung"
    host = parsed.hostname
    if not host:
        return "URL tidak punya host"
    # Resolve to IP(s). getaddrinfo on an IP literal returns it without DNS.
    try:
        infos = socket.getaddrinfo(host, None)
    except OSError:
        return "Host tidak dapat di-resolve"
    for info in infos:
        ip_str = info[4][0]
        try:
            ip = ipaddress.ip_address(ip_str)
        except ValueError:
            continue
        if (ip.is_private or ip.is_loopback or ip.is_link_local
                or ip.is_reserved or ip.is_multicast or ip.is_unspecified):
            return "Host internal tidak diizinkan"
    return None


MAX_CONTENT_CHARS = 50_000


def extract_readable(html, url):
    """Extract the main article (title + text) from already-fetched HTML.

    Returns {"title": str, "content": str}. On failure returns empty content.
    """
    import trafilatura
    title = ""
    content = ""
    try:
        meta = trafilatura.extract_metadata(html)
        if meta is not None and getattr(meta, "title", None):
            title = meta.title or ""
    except Exception:
        pass
    try:
        extracted = trafilatura.extract(
            html, url=url, include_comments=False, include_tables=False,
            favor_recall=True,
        )
        content = (extracted or "").strip()[:MAX_CONTENT_CHARS]
    except Exception:
        content = ""
    return {"title": title, "content": content}
