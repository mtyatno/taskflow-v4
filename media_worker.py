"""Worker pemrosesan media (ffprobe, faststart, poster). Modul murni: tidak mengimpor webapp.

Satu thread daemon memproses satu file per waktu. `process` sinkron dan tidak pernah melempar
(exception dicatat, baris yang masih 'processing' ditandai failed), supaya thread tidak mati.
Timestamp `updated_at`: ISO UTC naif (`datetime.now(timezone.utc)` tanpa tzinfo, sama dengan
`_media_utcnow()` di webapp).
"""
import logging
import os
import queue
import sqlite3
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Optional

from media_probe import (final_mime, format_matches_family, make_poster, needs_faststart, parse_probe,
                         remux_faststart, run_ffprobe, sniff_media)
from media_storage import LocalStorage, poster_key_for

log = logging.getLogger("alurik.media_worker")
FAIL_TEXT = "File tidak bisa dibaca sebagai audio/video"


def _now() -> str:
    return datetime.now(timezone.utc).replace(tzinfo=None).isoformat()


def _unlink(p) -> None:
    try:
        Path(p).unlink()
    except OSError:
        pass


class MediaWorker:
    def __init__(self, connect: Callable[[], sqlite3.Connection], storage: LocalStorage,
                 ffmpeg: Optional[str], ffprobe: Optional[str]):
        self._connect = connect
        self._storage = storage
        self._ffmpeg = ffmpeg
        self._ffprobe = ffprobe
        self._queue: "queue.Queue[int]" = queue.Queue()
        self._thread: Optional[threading.Thread] = None

    @property
    def ffmpeg(self) -> Optional[str]:
        return self._ffmpeg

    @property
    def ffprobe(self) -> Optional[str]:
        return self._ffprobe

    # ── antrean ──────────────────────────────────────────────────────────────
    def enqueue(self, att_id: int) -> None:
        self._queue.put(int(att_id))

    def start(self) -> None:
        if self._thread is not None and self._thread.is_alive():
            return
        self._thread = threading.Thread(target=self._loop, name="media-worker", daemon=True)
        self._thread.start()

    def _loop(self) -> None:
        while True:
            att_id = self._queue.get()
            self.process(att_id)

    def run_pending(self) -> int:
        n = 0
        while True:
            try:
                att_id = self._queue.get_nowait()
            except queue.Empty:
                return n
            self.process(att_id)
            n += 1

    def requeue_processing(self) -> int:
        conn = self._connect()
        try:
            ids = [r[0] for r in conn.execute(
                "SELECT id FROM note_attachments WHERE status='processing' ORDER BY id")]
        finally:
            conn.close()
        for i in ids:
            self.enqueue(i)
        return len(ids)

    # ── pemrosesan ───────────────────────────────────────────────────────────
    def process(self, att_id: int) -> None:
        try:
            self._process(att_id)
        except Exception:
            log.exception("pemrosesan media %s gagal", att_id)
            self._fail_after_error(att_id)

    def _fail_after_error(self, att_id: int) -> None:
        """Best-effort: baris yang masih 'processing' ditandai failed, file media (+ poster) dihapus."""
        try:
            conn = self._connect()
            try:
                row = conn.execute("SELECT storage_key FROM note_attachments WHERE id=? AND status='processing'",
                                   (att_id,)).fetchone()
                if row is None:
                    return
                key = row["storage_key"]
                if self._update(conn, att_id, {"status": "failed", "error": FAIL_TEXT, "poster_key": None}) and key:
                    self._storage.delete(key)
                    self._storage.delete(poster_key_for(key))
            finally:
                conn.close()
        except Exception:
            log.exception("menandai media %s gagal juga gagal", att_id)

    def _update(self, conn, att_id: int, sets: dict) -> bool:
        cols = ", ".join(f"{k}=?" for k in sets)
        cur = conn.execute(
            f"UPDATE note_attachments SET {cols}, updated_at=? WHERE id=? AND status='processing'",
            (*sets.values(), _now(), att_id))
        conn.commit()
        return cur.rowcount > 0

    @staticmethod
    def _still_processing(conn, att_id: int) -> bool:
        return conn.execute("SELECT 1 FROM note_attachments WHERE id=? AND status='processing'",
                            (att_id,)).fetchone() is not None

    def _fail(self, conn, att_id: int, key: str) -> None:
        if self._update(conn, att_id, {"status": "failed", "error": FAIL_TEXT}):
            self._storage.delete(key)

    def _process(self, att_id: int) -> None:
        conn = self._connect()
        try:
            row = conn.execute(
                "SELECT status, storage_key, mime_type, media_type FROM note_attachments WHERE id=?",
                (att_id,)).fetchone()
            if row is None or row["status"] != "processing" or not row["storage_key"]:
                return
            key = row["storage_key"]
            path = self._storage.path(key)
            try:
                with open(path, "rb") as f:
                    head = f.read(64)
            except OSError:
                self._fail(conn, att_id, key)
                return
            sniff = sniff_media(head)
            if sniff is None:
                self._fail(conn, att_id, key)
                return

            sets = {"status": "ready", "error": None}
            info = None
            if self._ffprobe:
                data = run_ffprobe(path, bin=self._ffprobe)
                info = parse_probe(data) if data else None
                if info is None or not format_matches_family(sniff.family, info.format_name):
                    self._fail(conn, att_id, key)
                    return
                sets.update(
                    media_type=info.media_type, duration_ms=info.duration_ms,
                    video_codec=info.video_codec, audio_codec=info.audio_codec,
                    width=info.width, height=info.height,
                    mime_type=final_mime(sniff, info.media_type, info.format_name))

            if self._ffmpeg and sniff.family == "isobmff" and needs_faststart(path):
                tmp = self._storage.temp_path(att_id).with_suffix(".fs" + Path(key).suffix)
                try:
                    if remux_faststart(path, tmp, bin=self._ffmpeg):
                        # Baris/file bisa terhapus selama remux: jangan membangkitkan file yatim.
                        if not self._still_processing(conn, att_id) or not path.exists():
                            return
                        os.replace(tmp, path)
                    else:
                        log.warning("faststart gagal untuk %s; file asli dipertahankan", att_id)
                except Exception:
                    log.exception("faststart %s gagal", att_id)
                finally:
                    _unlink(tmp)

            poster_key = None
            if self._ffmpeg and info is not None and info.media_type == "video":
                dur_s = (info.duration_ms or 0) / 1000.0
                tmp = self._storage.temp_path(att_id).with_suffix(".poster.jpg")
                try:
                    if make_poster(path, tmp, min(1.0, dur_s / 10), bin=self._ffmpeg):
                        poster_key = poster_key_for(key)
                        self._storage.commit(poster_key, tmp)
                        sets["poster_key"] = poster_key
                except Exception:
                    log.exception("poster %s gagal", att_id)
                    poster_key = None
                finally:
                    _unlink(tmp)

            if not self._update(conn, att_id, sets) and poster_key:
                self._storage.delete(poster_key)  # baris dihapus/dibuang selama proses
        finally:
            conn.close()
