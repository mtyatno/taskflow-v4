import re
from datetime import datetime

import pytest

from media_probe import ALLOWED_INIT_EXTS, Sniff, final_mime, sniff_media
from media_serve import content_disposition, parse_range, sign_token, verify_token
from media_storage import LocalStorage, get_storage, is_valid_key, new_key, poster_key_for


@pytest.mark.parametrize("head,family,ext", [
    (b"\x00\x00\x00\x20ftypM4A \x00", "isobmff", ".m4a"),
    (b"\x00\x00\x00\x14ftypqt  \x00", "isobmff", ".mov"),
    (b"\x00\x00\x00\x18ftypisom\x00", "isobmff", ".mp4"),
    (b"\x00\x00\x00\x18ftyp3gp5\x00", "isobmff", ".3gp"),
    (b"ID3\x04\x00", "mpeg_audio", ".mp3"), (b"\xff\xfb\x90\x00", "mpeg_audio", ".mp3"),
    (b"OggS\x00\x02", "ogg", ".ogg"), (b"RIFF\x24\x00\x00\x00WAVEfmt ", "wav", ".wav"),
    (b"\x1aE\xdf\xa3\x9fB\x86\x81\x01B\x82\x84webm", "matroska", ".webm"),
    (b"\x1aE\xdf\xa3\x9fB\x82\x88matroska", "matroska", ".mkv"),
    (b"fLaC\x00", "flac", ".flac"), (b"#!AMR\n", "amr", ".amr"),
])
def test_sniff_accepts(head, family, ext):
    s = sniff_media(head)
    assert s is not None and s.family == family and s.ext == ext


def test_sniff_brands():
    assert sniff_media(b"\x00\x00\x00\x20ftypM4A \x00").brand == "M4A "
    assert sniff_media(b"\x1aE\xdf\xa3\x9fB\x86\x81\x01B\x82\x84webm").brand == "webm"
    assert sniff_media(b"\x1aE\xdf\xa3\x9fB\x82\x88matroska").brand == "matroska"
    assert sniff_media(b"OggS\x00").brand == ""


@pytest.mark.parametrize("head", [b"<!doctype html><script>", b"<svg xmlns", b"%PDF-1.7",
    b"\x00\x00\x00\x18ftypheic\x00", b"\x89PNG\r\n", b"", b"\x00\x00\x00\x18ftypavif",
    b"\x00", b"\xff", b"ftyp"])
def test_sniff_rejects(head):
    assert sniff_media(head) is None


def test_final_mime_audio_only_mp4_is_audio_mp4():
    s = sniff_media(b"\x00\x00\x00\x18ftypisom\x00")
    assert final_mime(s, "audio") == "audio/mp4"
    assert final_mime(s, "video") == "video/mp4"


def test_final_mime_table():
    def m(head, mt, fmt=""):
        return final_mime(sniff_media(head), mt, fmt)
    assert m(b"\x00\x00\x00\x20ftypM4A \x00", "audio") == "audio/mp4"
    assert m(b"\x00\x00\x00\x14ftypqt  \x00", "video") == "video/quicktime"
    assert m(b"\x00\x00\x00\x18ftyp3gp5\x00", "audio") == "audio/3gpp"
    assert m(b"\x00\x00\x00\x18ftyp3gp5\x00", "video") == "video/3gpp"
    assert m(b"OggS\x00", "audio") == "audio/ogg"
    assert m(b"OggS\x00", "video") == "video/ogg"
    assert m(b"RIFF\x24\x00\x00\x00WAVEfmt ", "audio") == "audio/wav"
    assert m(b"\x1aE\xdf\xa3\x9fB\x86\x81\x01B\x82\x84webm", "audio") == "audio/webm"
    assert m(b"\x1aE\xdf\xa3\x9fB\x86\x81\x01B\x82\x84webm", "video") == "video/webm"
    assert m(b"\x1aE\xdf\xa3\x9fB\x82\x88matroska", "video") == "video/x-matroska"
    assert m(b"\x1aE\xdf\xa3\x9fB\x82\x88matroska", "audio") == "audio/x-matroska"
    assert m(b"fLaC\x00", "audio") == "audio/flac"
    assert m(b"#!AMR\n", "audio") == "audio/amr"
    assert m(b"ID3\x04\x00", "audio") == "audio/mpeg"


def test_final_mime_mpeg_audio_aac_format():
    s_mp3 = sniff_media(b"\xff\xfb\x90\x00")
    assert final_mime(s_mp3, "audio", "aac") == "audio/aac"


def test_allowed_exts():
    assert ALLOWED_INIT_EXTS == frozenset(
        "mp3 m4a m4b aac wav ogg oga opus webm flac amr 3gp 3g2 mp4 m4v mov mkv".split())


def test_keys_never_from_filename(tmp_path):
    st = LocalStorage(tmp_path); k = new_key(".mp4", datetime(2026, 10, 20))
    assert re.fullmatch(r"2026/10/[0-9a-f-]{36}\.mp4", k) and poster_key_for(k).endswith(".poster.jpg")
    assert is_valid_key(k) and is_valid_key(poster_key_for(k))
    for bad in ["../x.mp4", "2026/10/../../etc/passwd", "/abs.mp4", "2026/10/abc.mp4"]:
        with pytest.raises(ValueError):
            st.path(bad)


def test_storage_commit_delete(tmp_path):
    st = LocalStorage(tmp_path)
    tmp = st.temp_path(5)
    assert tmp == tmp_path / ".tmp" / "5.part" and tmp.parent.is_dir()
    tmp.write_bytes(b"abc")
    k = new_key(".mp3", datetime(2026, 1, 2))
    st.commit(k, tmp)
    assert st.path(k).read_bytes() == b"abc" and not tmp.exists()
    st.delete(k)
    assert not st.path(k).exists()
    st.delete(k)
    st.delete(None)
    assert st.accel_uri(k) == "/_alurik_media/" + k


def test_get_storage(tmp_path):
    assert isinstance(get_storage("local", str(tmp_path)), LocalStorage)
    with pytest.raises(NotImplementedError):
        get_storage("r2", str(tmp_path))
    with pytest.raises(ValueError):
        get_storage("zzz", str(tmp_path))


def test_token_roundtrip_and_tamper():
    t = sign_token(7, "play", 2000, b"k"*32)
    assert verify_token(t, b"k"*32, 1999) == (7, "play", 2000)
    assert verify_token(t, b"k"*32, 2000) == (7, "play", 2000)
    assert verify_token(t, b"k"*32, 2001) is None
    assert verify_token(t, b"x"*32, 1999) is None
    other = sign_token(7, "download", 2000, b"k"*32)
    assert verify_token(other.split(".")[0] + "." + t.split(".")[1], b"k"*32, 1999) is None  # payload diganti
    assert verify_token("a.b.c", b"k"*32, 0) is None and verify_token("", b"k"*32, 0) is None
    assert "=" not in t


def test_token_malformed_never_raises():
    import base64
    sec = b"k"*32
    for tok in ["!!.!!", ".", "a.", ".a", "é.é", None]:
        assert verify_token(tok, sec, 0) is None
    b = lambda x: base64.urlsafe_b64encode(x).rstrip(b"=").decode()
    import hashlib, hmac
    def mk(payload):
        return b(payload) + "." + b(hmac.new(sec, payload, hashlib.sha256).digest())
    assert verify_token(mk(b"x.play.5"), sec, 0) is None
    assert verify_token(mk(b"1.play.x"), sec, 0) is None
    assert verify_token(mk(b"1.evil.5"), sec, 0) is None
    assert verify_token(mk(b"1.play"), sec, 0) is None
    assert verify_token(mk(b"1.play.5"), sec, 0) == (1, "play", 5)


@pytest.mark.parametrize("h,size,exp", [(None,100,None), ("bytes=0-",100,(0,99)), ("bytes=10-19",100,(10,19)),
    ("bytes=-10",100,(90,99)), ("bytes=90-200",100,(90,99)), ("bytes=100-",100,"invalid"),
    ("bytes=5-1",100,"invalid"), ("bytes=0-1,5-6",100,(0,1)), ("items=0-1",100,None),
    ("bytes=-500",100,(0,99)), ("bytes=-0",100,"invalid"), ("bytes=abc",100,"invalid"),
    ("bytes=0-",0,"invalid"), ("",100,None)])
def test_parse_range(h, size, exp):
    assert parse_range(h, size) == exp


def test_content_disposition_sanitizes():
    v = content_disposition("attachment", 'a"b\r\nc é.mp3')
    assert '\r' not in v and '\n' not in v and 'filename="a_b__c _.mp3"' in v and "filename*=UTF-8''" in v
    assert "%C3%A9" in v
    assert content_disposition("inline", "plain.mp3") == 'inline; filename="plain.mp3"'
    assert content_disposition("inline", "") == 'inline; filename="media"'
