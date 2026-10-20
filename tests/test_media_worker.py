import os
import shutil
import struct
import subprocess

import pytest

import media_probe
import media_worker
from media_probe import ProbeInfo, needs_faststart, parse_probe
from media_storage import LocalStorage, poster_key_for
from conftest import db

KEY = "2026/10/11111111-1111-1111-1111-111111111111.mp4"
FAIL_TEXT = "File tidak bisa dibaca sebagai audio/video"


def _atom(kind: bytes, payload: bytes = b"") -> bytes:
    return struct.pack(">I", 8 + len(payload)) + kind + payload


def _ftyp(brand=b"isom") -> bytes:
    return _atom(b"ftyp", brand + b"\0\0\0\0" + brand)


# ── parse_probe ──────────────────────────────────────────────────────────────

def test_parse_probe_video_and_audio_only():
    v = parse_probe({
        "format": {"duration": "2.5", "format_name": "mov,mp4,m4a,3gp,3g2,mj2"},
        "streams": [
            {"codec_type": "video", "codec_name": "h264", "width": 1280, "height": 720,
             "disposition": {"attached_pic": 0}},
            {"codec_type": "audio", "codec_name": "aac"},
        ]})
    assert v == ProbeInfo("video", 2500, "h264", "aac", 1280, 720, "mov,mp4,m4a,3gp,3g2,mj2")
    a = parse_probe({
        "format": {"duration": "10", "format_name": "mp3"},
        "streams": [
            {"codec_type": "audio", "codec_name": "mp3"},
            {"codec_type": "video", "codec_name": "mjpeg", "width": 500, "height": 500,
             "disposition": {"attached_pic": 1}},
        ]})
    assert a.media_type == "audio" and a.video_codec is None and a.width is None
    assert a.audio_codec == "mp3" and a.duration_ms == 10000


def test_parse_probe_no_streams_returns_none():
    assert parse_probe({"format": {}, "streams": []}) is None
    assert parse_probe({}) is None
    assert parse_probe({"streams": [{"codec_type": "subtitle"}]}) is None


def test_needs_faststart_detects_moov_after_mdat(tmp_path):
    a = tmp_path / "a.mp4"
    a.write_bytes(_ftyp() + _atom(b"mdat", b"x" * 20) + _atom(b"moov", b"y" * 10))
    b = tmp_path / "b.mp4"
    b.write_bytes(_ftyp() + _atom(b"moov", b"y" * 10) + _atom(b"mdat", b"x" * 20))
    assert needs_faststart(a) is True
    assert needs_faststart(b) is False


def test_needs_faststart_64bit_and_to_eof(tmp_path):
    big = struct.pack(">I", 1) + b"mdat" + struct.pack(">Q", 16 + 5) + b"x" * 5
    p = tmp_path / "c.mp4"
    p.write_bytes(_ftyp() + big + _atom(b"moov", b"z"))
    assert needs_faststart(p) is True
    q = tmp_path / "d.mp4"
    q.write_bytes(_ftyp() + struct.pack(">I", 0) + b"mdat" + b"x" * 30)  # mdat sampai akhir, tanpa moov
    assert needs_faststart(q) is False


def test_needs_faststart_caps_atom_scan_at_10000(tmp_path):
    """Temuan akhir #10: scan atom dibatasi 10_000; batas tercapai → False (file dibiarkan apa adanya)."""
    def build(n_free):
        return _ftyp() + _atom(b"mdat", b"x") + _atom(b"free") * n_free + _atom(b"moov")
    p = tmp_path / "many.mp4"
    p.write_bytes(build(20_000))
    assert needs_faststart(p) is False
    p.write_bytes(build(100))
    assert needs_faststart(p) is True
    p.write_bytes(build(9_997))   # moov = atom ke-10_000 → masih terbaca
    assert needs_faststart(p) is True
    p.write_bytes(build(9_998))   # moov = atom ke-10_001 → batas tercapai
    assert needs_faststart(p) is False


# ── process ──────────────────────────────────────────────────────────────────

@pytest.fixture
def env(tmp_path):
    storage = LocalStorage(tmp_path / "media")
    created = []

    def connect():
        import sqlite3
        c = sqlite3.connect(os.environ["DB_PATH"])
        c.row_factory = sqlite3.Row
        c.execute("PRAGMA journal_mode=WAL")
        c.execute("PRAGMA foreign_keys=ON")
        return c

    def mk(key=KEY, status="processing", head=None, write=True):
        if write:
            p = storage.path(key)
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_bytes(head if head is not None else _ftyp() + _atom(b"moov") + _atom(b"mdat", b"x" * 50))
        conn = db()
        conn.execute("PRAGMA foreign_keys=OFF")
        cur = conn.execute(
            "INSERT INTO note_attachments (note_id, user_id, nextcloud_path, original_name, file_size, "
            "mime_type, kind, storage, storage_key, status, media_type) "
            "VALUES (1, 990, '', 'a.mp4', 70, 'video/mp4', 'media', 'local', ?, ?, 'video')",
            (key, status))
        conn.commit()
        att_id = cur.lastrowid
        conn.close()
        created.append(att_id)
        return att_id

    def row(att_id):
        conn = db()
        try:
            return conn.execute("SELECT * FROM note_attachments WHERE id=?", (att_id,)).fetchone()
        finally:
            conn.close()

    yield type("Env", (), {"storage": storage, "connect": staticmethod(connect), "mk": staticmethod(mk),
                           "row": staticmethod(row)})
    conn = db()
    conn.execute("DELETE FROM note_attachments WHERE user_id=990")
    conn.commit()
    conn.close()


def _worker(env, ffmpeg="/usr/bin/ffmpeg", ffprobe="/usr/bin/ffprobe"):
    return media_worker.MediaWorker(connect=env.connect, storage=env.storage, ffmpeg=ffmpeg, ffprobe=ffprobe)


INFO = ProbeInfo("video", 2000, "h264", "aac", 640, 360, "mov,mp4,m4a,3gp,3g2,mj2")


def _patch(monkeypatch, info=INFO, faststart=False, remux=True, poster=True):
    calls = {"remux": 0, "poster": []}
    monkeypatch.setattr(media_worker, "run_ffprobe", lambda p, bin="ffprobe", timeout=60: {"x": 1})
    monkeypatch.setattr(media_worker, "parse_probe", lambda d: info)
    monkeypatch.setattr(media_worker, "needs_faststart", lambda p: faststart)

    def fake_remux(src, dst, bin="ffmpeg", timeout=600):
        calls["remux"] += 1
        if remux:
            open(dst, "wb").write(b"REMUXED")
        return remux

    def fake_poster(src, dst, at_sec, bin="ffmpeg", timeout=60):
        calls["poster"].append(at_sec)
        if poster:
            open(dst, "wb").write(b"JPG")
        return poster

    monkeypatch.setattr(media_worker, "remux_faststart", fake_remux)
    monkeypatch.setattr(media_worker, "make_poster", fake_poster)
    return calls


def test_process_ready_with_metadata(env, monkeypatch):
    _patch(monkeypatch)
    i = env.mk()
    _worker(env).process(i)
    r = env.row(i)
    assert r["status"] == "ready" and r["error"] is None
    assert r["duration_ms"] == 2000 and r["video_codec"] == "h264" and r["audio_codec"] == "aac"
    assert (r["width"], r["height"]) == (640, 360) and r["media_type"] == "video"
    assert r["mime_type"] == "video/mp4" and r["updated_at"]


def test_process_probe_fail_marks_failed_and_deletes_file(env, monkeypatch):
    monkeypatch.setattr(media_worker, "run_ffprobe", lambda *a, **k: None)
    i = env.mk()
    _worker(env).process(i)
    r = env.row(i)
    assert r["status"] == "failed" and r["error"] == FAIL_TEXT
    assert not env.storage.path(KEY).exists()


def test_process_unsniffable_marks_failed(env, monkeypatch):
    _patch(monkeypatch)
    i = env.mk(head=b"not media at all, just text" * 3)
    _worker(env).process(i)
    r = env.row(i)
    assert r["status"] == "failed" and r["error"] == FAIL_TEXT
    assert not env.storage.path(KEY).exists()


def test_process_faststart_only_when_needed(env, monkeypatch):
    calls = _patch(monkeypatch, faststart=False)
    i = env.mk()
    _worker(env).process(i)
    assert calls["remux"] == 0
    calls = _patch(monkeypatch, faststart=True)
    i2 = env.mk(key="2026/10/22222222-2222-2222-2222-222222222222.mp4")
    _worker(env).process(i2)
    assert calls["remux"] == 1
    assert env.storage.path("2026/10/22222222-2222-2222-2222-222222222222.mp4").read_bytes() == b"REMUXED"
    assert env.row(i2)["status"] == "ready"
    # remux gagal → tetap ready, file asli utuh
    calls = _patch(monkeypatch, faststart=True, remux=False)
    k3 = "2026/10/33333333-3333-3333-3333-333333333333.mp4"
    i3 = env.mk(key=k3)
    orig = env.storage.path(k3).read_bytes()
    _worker(env).process(i3)
    assert env.row(i3)["status"] == "ready" and env.storage.path(k3).read_bytes() == orig


def test_process_faststart_skipped_for_non_isobmff(env, monkeypatch):
    calls = _patch(monkeypatch, info=ProbeInfo("video", 1000, "vp9", "opus", 64, 64, "matroska,webm"),
                   faststart=True)
    k = "2026/10/44444444-4444-4444-4444-444444444444.webm"
    i = env.mk(key=k, head=b"\x1a\x45\xdf\xa3webm" + b"\0" * 40)
    _worker(env).process(i)
    assert calls["remux"] == 0 and env.row(i)["mime_type"] == "video/webm"


def test_process_poster_for_video_only(env, monkeypatch):
    calls = _patch(monkeypatch)
    i = env.mk()
    _worker(env).process(i)
    r = env.row(i)
    assert r["poster_key"] == poster_key_for(KEY)
    assert env.storage.path(r["poster_key"]).read_bytes() == b"JPG"
    assert calls["poster"] == [pytest.approx(0.2)]  # min(1.0, 2.0/10)
    # poster gagal → ready tanpa poster_key
    _patch(monkeypatch, poster=False)
    k2 = "2026/10/55555555-5555-5555-5555-555555555555.mp4"
    i2 = env.mk(key=k2)
    _worker(env).process(i2)
    assert env.row(i2)["status"] == "ready" and env.row(i2)["poster_key"] is None
    # audio → tanpa poster
    calls = _patch(monkeypatch, info=ProbeInfo("audio", 3000, None, "aac", None, None, "mov,mp4,m4a,3gp,3g2,mj2"))
    k3 = "2026/10/66666666-6666-6666-6666-666666666666.m4a"
    i3 = env.mk(key=k3, head=_ftyp(b"M4A ") + _atom(b"moov") + _atom(b"mdat"))
    _worker(env).process(i3)
    r3 = env.row(i3)
    assert calls["poster"] == [] and r3["poster_key"] is None
    assert r3["media_type"] == "audio" and r3["mime_type"] == "audio/mp4"


def test_process_format_outside_sniff_family_fails_and_deletes(env, monkeypatch):
    """Temuan akhir #2: header ID3 + isi AVI → ffprobe 'avi' → failed, file dihapus."""
    _patch(monkeypatch, info=ProbeInfo("video", 2000, "mpeg4", "mp3", 320, 240, "avi"))
    k = "2026/10/88888888-8888-8888-8888-888888888888.mp3"
    i = env.mk(key=k, head=b"ID3\x04\x00\x00\x00\x00\x00\x00RIFF\x00\x00\x00\x00AVI LIST" + b"\0" * 40)
    _worker(env).process(i)
    r = env.row(i)
    assert r["status"] == "failed" and r["error"] == FAIL_TEXT
    assert not env.storage.path(k).exists()
    assert r["duration_ms"] is None and r["poster_key"] is None
    # format sekeluarga tetap ready
    _patch(monkeypatch, info=ProbeInfo("audio", 3000, None, "mp3", None, None, "mp3"))
    k2 = "2026/10/99999999-9999-9999-9999-999999999999.mp3"
    i2 = env.mk(key=k2, head=b"ID3\x04\x00" + b"\0" * 40)
    _worker(env).process(i2)
    assert env.row(i2)["status"] == "ready" and env.row(i2)["mime_type"] == "audio/mpeg"


def test_process_without_ffmpeg_marks_ready(env):
    i = env.mk()
    _worker(env, ffmpeg=None, ffprobe=None).process(i)
    r = env.row(i)
    assert r["status"] == "ready" and r["duration_ms"] is None
    assert r["media_type"] == "video" and r["mime_type"] == "video/mp4" and r["updated_at"]


def test_process_missing_row_is_noop(env, monkeypatch):
    _patch(monkeypatch)
    w = _worker(env)
    w.process(987654)
    i = env.mk(status="ready")
    w.process(i)
    assert env.row(i)["status"] == "ready" and env.row(i)["duration_ms"] is None


def test_process_row_removed_during_processing_deletes_poster(env, monkeypatch):
    _patch(monkeypatch)
    i = env.mk()
    orig = media_worker.make_poster

    def poster_then_delete(src, dst, at_sec, bin="ffmpeg", timeout=60):
        ok = orig(src, dst, at_sec)
        conn = db()
        conn.execute("DELETE FROM note_attachments WHERE id=?", (i,))
        conn.commit()
        conn.close()
        return ok

    monkeypatch.setattr(media_worker, "make_poster", poster_then_delete)
    _worker(env).process(i)
    assert env.row(i) is None
    assert not env.storage.path(poster_key_for(KEY)).exists()


def test_process_swallows_exceptions(env, monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("x")
    monkeypatch.setattr(media_worker, "run_ffprobe", boom)
    i = env.mk()
    _worker(env).process(i)  # tidak melempar


def test_process_unexpected_exception_marks_failed_and_deletes_file(env, monkeypatch, caplog):
    """Temuan akhir #9: exception tak terduga → failed + file dihapus (bukan 'processing' sampai restart)."""
    def boom(*a, **k):
        raise RuntimeError("x")
    monkeypatch.setattr(media_worker, "run_ffprobe", boom)
    i = env.mk()
    with caplog.at_level("ERROR", logger="alurik.media_worker"):
        _worker(env).process(i)
    r = env.row(i)
    assert r["status"] == "failed" and r["error"] == FAIL_TEXT
    assert not env.storage.path(KEY).exists()
    assert any("gagal" in rec.getMessage() for rec in caplog.records)


def test_process_db_error_on_final_update_cleans_media_and_poster(env, monkeypatch):
    """Temuan akhir #9: UPDATE akhir melempar (mis. database is locked) setelah poster dibuat."""
    import sqlite3
    _patch(monkeypatch)
    i = env.mk()
    w = _worker(env)
    real = w._update
    state = {"n": 0}

    def flaky(conn, att_id, sets):
        state["n"] += 1
        if state["n"] == 1:
            raise sqlite3.OperationalError("database is locked")
        return real(conn, att_id, sets)
    monkeypatch.setattr(w, "_update", flaky)
    w.process(i)
    r = env.row(i)
    assert r["status"] == "failed" and r["error"] == FAIL_TEXT and r["poster_key"] is None
    assert not env.storage.path(KEY).exists()
    assert not env.storage.path(poster_key_for(KEY)).exists()


def test_process_exception_does_not_touch_row_no_longer_processing(env, monkeypatch):
    def boom(*a, **k):
        conn = db()
        conn.execute("UPDATE note_attachments SET status='ready' WHERE user_id=990")
        conn.commit()
        conn.close()
        raise RuntimeError("x")
    monkeypatch.setattr(media_worker, "run_ffprobe", boom)
    i = env.mk()
    _worker(env).process(i)
    assert env.row(i)["status"] == "ready" and env.storage.path(KEY).exists()


def test_requeue_processing_enqueues_rows(env):
    a = env.mk()
    b = env.mk(key="2026/10/77777777-7777-7777-7777-777777777777.mp4", status="ready")
    w = _worker(env)
    assert w.requeue_processing() >= 1
    assert a in list(w._queue.queue) and b not in list(w._queue.queue)


def test_run_pending_processes_queue(env, monkeypatch):
    _patch(monkeypatch)
    i = env.mk()
    w = _worker(env)
    w.enqueue(i)
    assert w.run_pending() == 1
    assert env.row(i)["status"] == "ready"
    assert w.run_pending() == 0


# ── integrasi ────────────────────────────────────────────────────────────────

@pytest.mark.skipif(not shutil.which("ffmpeg"), reason="ffmpeg tidak terpasang")
def test_integration_real_ffmpeg(env, tmp_path):
    src = tmp_path / "gen.mp4"
    subprocess.run(
        ["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", "testsrc=duration=2:size=320x240:rate=15",
         "-f", "lavfi", "-i", "sine=frequency=440:duration=2", "-c:v", "libx264", "-c:a", "aac",
         "-pix_fmt", "yuv420p", "-shortest", str(src)], check=True)
    assert needs_faststart(src) is True
    p = env.storage.path(KEY)
    p.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy(src, p)
    i = env.mk(write=False)
    w = _worker(env, ffmpeg=shutil.which("ffmpeg"), ffprobe=shutil.which("ffprobe"))
    w.process(i)
    r = env.row(i)
    assert r["status"] == "ready", r["error"]
    assert 1800 <= r["duration_ms"] <= 2300
    assert r["media_type"] == "video" and r["video_codec"] == "h264" and r["audio_codec"] == "aac"
    assert (r["width"], r["height"]) == (320, 240) and r["mime_type"] == "video/mp4"
    assert needs_faststart(p) is False
    assert r["poster_key"] and env.storage.path(r["poster_key"]).stat().st_size > 0


def test_process_row_deleted_during_remux_leaves_no_orphan(env, monkeypatch):
    calls = _patch(monkeypatch, faststart=True)
    i = env.mk()

    def remux_then_delete(src, dst, bin="ffmpeg", timeout=600):
        open(dst, "wb").write(b"REMUXED")
        conn = db()
        conn.execute("DELETE FROM note_attachments WHERE id=?", (i,))
        conn.commit()
        conn.close()
        env.storage.delete(KEY)  # hard delete menghapus file
        return True

    monkeypatch.setattr(media_worker, "remux_faststart", remux_then_delete)
    _worker(env).process(i)
    assert not env.storage.path(KEY).exists()
    assert not env.storage.path(poster_key_for(KEY)).exists()
    assert calls["poster"] == []
    tmpdir = env.storage.root / ".tmp"
    assert not any(tmpdir.glob(f"{i}.*"))
