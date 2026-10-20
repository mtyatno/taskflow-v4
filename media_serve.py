"""Token URL, parser Range, dan Content-Disposition. Modul murni: tidak mengimpor webapp."""
import base64
import hashlib
import hmac
import re
from urllib.parse import quote

VARIANTS = ("play", "poster", "download")
_RANGE_RE = re.compile(r"^(\d*)-(\d*)$")


def _b64(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode("ascii")


def _unb64(s: str) -> bytes:
    if not s.isascii():
        raise ValueError("non-ascii")
    return base64.b64decode(s + "=" * (-len(s) % 4), altchars=b"-_", validate=True)


def sign_token(att_id: int, variant: str, exp: int, secret: bytes) -> str:
    payload = f"{att_id}.{variant}.{exp}".encode()
    return _b64(payload) + "." + _b64(hmac.new(secret, payload, hashlib.sha256).digest())


def verify_token(token, secret: bytes, now: int):
    try:
        parts = token.split(".")
        if len(parts) != 2:
            return None
        payload, sig = _unb64(parts[0]), _unb64(parts[1])
        if not hmac.compare_digest(hmac.new(secret, payload, hashlib.sha256).digest(), sig):
            return None
        fields = payload.decode("ascii").split(".")
        if len(fields) != 3 or fields[1] not in VARIANTS:
            return None
        att_id, exp = int(fields[0]), int(fields[2])
        if now > exp:
            return None
        return att_id, fields[1], exp
    except Exception:
        return None


def parse_range(header, size: int):
    if not header:
        return None
    header = header.strip()
    if header[:6].lower() != "bytes=":
        return None
    spec = header[6:].split(",")[0].strip()
    m = _RANGE_RE.match(spec)
    if not m or (not m.group(1) and not m.group(2)):
        return "invalid"
    if size <= 0:
        return "invalid"
    a, b = m.group(1), m.group(2)
    if not a:
        n = int(b)
        if n == 0:
            return "invalid"
        return (max(size - n, 0), size - 1)
    start = int(a)
    end = int(b) if b else size - 1
    if start >= size or end < start:
        return "invalid"
    return (start, min(end, size - 1))


def content_disposition(disposition: str, name: str) -> str:
    name = name or "media"
    clean = re.sub(r'[\r\n"]', "_", name)
    fallback = "".join(
        "_" if (ord(c) < 32 or ord(c) > 126 or c in '"\\') else c for c in name)
    out = f'{disposition}; filename="{fallback}"'
    if not name.isascii():
        out += f"; filename*=UTF-8''{quote(clean, safe='')}"
    return out
