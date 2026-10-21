"""Outbox email SQLite + EmailWorker. Modul murni: tidak mengimpor webapp.

Alur (spec Email Fase 0b §1.3): pemanggil `enqueue()` di transaksinya sendiri lalu
`wake()` setelah commit. Worker (satu thread daemon) mengambil baris `queued` yang
jatuh tempo, klaim atomik → `sending` (commit sebelum kirim), lalu `sent` / jadwal
ulang / `failed`. Semua timestamp ISO UTC naif dari jam `now()` yang disuntikkan
(sama formatnya dengan `media_worker._now()`).
"""
import logging
import sqlite3
import threading
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
from typing import Callable, Optional

import mailer
from email_templates import RenderedEmail

log = logging.getLogger("alurik.email_outbox")

RETRY_DELAYS_MIN = (1, 5, 30, 120)
MAX_ATTEMPTS = 5
POLL_SECONDS = 30
BATCH = 20
RETENTION_DAYS = 30
_PURGE_EVERY = timedelta(hours=24)


def utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def iso(dt: datetime) -> str:
    return dt.isoformat()


def mask_email(addr: str) -> str:
    """Samarkan penerima: 2 karakter pertama lokal + ***@domain (lokal 1 karakter -> 1 karakter)."""
    local, sep, domain = (addr or "").rpartition("@")
    if not sep:
        return "***"
    return f"{local[:2]}***@{domain}"


def ensure_schema(conn: sqlite3.Connection) -> None:
    conn.execute("""
        CREATE TABLE IF NOT EXISTS email_outbox (
            id INTEGER PRIMARY KEY,
            kind TEXT NOT NULL,
            user_id INTEGER,
            to_addr TEXT NOT NULL,
            subject TEXT NOT NULL,
            body_text TEXT NOT NULL,
            body_html TEXT NOT NULL,
            status TEXT NOT NULL,
            attempts INTEGER NOT NULL DEFAULT 0,
            last_error TEXT,
            next_attempt_at TEXT NOT NULL,
            expires_at TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            sent_at TEXT
        )""")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_email_outbox_due ON email_outbox(status, next_attempt_at)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_email_outbox_created ON email_outbox(created_at)")


def enqueue(conn: sqlite3.Connection, *, kind: str, to_addr: str, rendered: RenderedEmail,
            user_id: Optional[int] = None, expires_at: Optional[datetime] = None,
            now: Optional[datetime] = None) -> int:
    """Masukkan email ke antrean. Tidak commit — ikut transaksi pemanggil."""
    ts = iso(now if now is not None else utcnow())
    cur = conn.execute(
        "INSERT INTO email_outbox (kind, user_id, to_addr, subject, body_text, body_html, status, attempts,"
        " next_attempt_at, expires_at, created_at, updated_at) VALUES (?,?,?,?,?,?,'queued',0,?,?,?,?)",
        (kind, user_id, to_addr, rendered.subject, rendered.text, rendered.html,
         ts, iso(expires_at) if expires_at is not None else None, ts, ts))
    return int(cur.lastrowid)


class EmailWorker:
    def __init__(self, connect: Callable[[], sqlite3.Connection],
                 send: Callable[[EmailMessage], None] = mailer.send_message,
                 now: Callable[[], datetime] = utcnow):
        self._connect = connect
        self._send = send
        self._now = now
        self._event = threading.Event()
        self._stop = threading.Event()
        self._thread: Optional[threading.Thread] = None
        self._lock = threading.Lock()
        self._last_purge: Optional[datetime] = None

    # ── thread ───────────────────────────────────────────────────────────────
    def start(self) -> None:
        with self._lock:
            if self._thread is not None and self._thread.is_alive():
                return
            self._stop.clear()
            self._thread = threading.Thread(target=self._loop, name="email-worker", daemon=True)
            self._thread.start()

    def wake(self) -> None:
        """Bangunkan worker. Thread hanya di-start ulang bila pernah di-start lalu mati."""
        self._event.set()
        if self._thread is not None and not self._thread.is_alive():
            log.warning("thread email-worker mati, di-start ulang")
            self.start()

    def is_alive(self) -> bool:
        return self._thread is not None and self._thread.is_alive()

    def stop(self, timeout: Optional[float] = None) -> None:
        """Hentikan thread (dipakai tes/shutdown)."""
        self._stop.set()
        self._event.set()
        t = self._thread
        if t is not None:
            t.join(timeout)

    def _loop(self) -> None:
        while not self._stop.is_set():
            try:
                self.run_due()
                last = self._last_purge
                if last is None or self._now() - last >= _PURGE_EVERY:
                    self.purge_old()
            except Exception:
                log.exception("putaran email-worker gagal")
            self._event.wait(POLL_SECONDS)
            self._event.clear()

    # ── pemrosesan ───────────────────────────────────────────────────────────
    def run_due(self) -> int:
        """Proses maks BATCH baris jatuh tempo. Return jumlah baris yang diproses."""
        conn = self._connect()
        try:
            ids = [r[0] for r in conn.execute(
                "SELECT id FROM email_outbox WHERE status='queued' AND next_attempt_at <= ?"
                " ORDER BY id LIMIT ?", (iso(self._now()), BATCH))]
            n = 0
            for rid in ids:
                try:
                    if self._process(conn, rid):
                        n += 1
                except Exception:
                    log.exception("memproses email %s gagal", rid)
                    try:
                        conn.rollback()
                    except Exception:
                        pass
            return n
        finally:
            conn.close()

    def _process(self, conn: sqlite3.Connection, rid: int) -> bool:
        """Proses satu baris. False bila baris tidak lagi `queued` (sudah diklaim worker lain)."""
        row = conn.execute(
            "SELECT to_addr, subject, body_text, body_html, expires_at FROM email_outbox"
            " WHERE id=? AND status='queued'", (rid,)).fetchone()
        if row is None:
            return False
        now = self._now()
        ts = iso(now)
        if row[4] is not None and now >= datetime.fromisoformat(row[4]):
            cur = conn.execute(
                "UPDATE email_outbox SET status='expired', updated_at=? WHERE id=? AND status='queued'", (ts, rid))
            conn.commit()
            return cur.rowcount > 0

        cur = conn.execute(
            "UPDATE email_outbox SET status='sending', attempts=attempts+1, updated_at=?"
            " WHERE id=? AND status='queued'", (ts, rid))
        conn.commit()
        if cur.rowcount == 0:
            return False
        attempts = conn.execute("SELECT attempts FROM email_outbox WHERE id=?", (rid,)).fetchone()[0]

        permanent = False
        try:
            msg = mailer.build_message(row[0], row[1], row[2], row[3])
            self._send(msg)
        except mailer.MailPermanentError as e:
            err, permanent = str(e), True
            log.warning("email %s gagal permanen: %s", rid, err)
        except mailer.MailTemporaryError as e:
            err = str(e)
            log.warning("email %s gagal sementara (percobaan %s): %s", rid, attempts, err)
        except Exception as e:
            err = mailer.format_error(e)
            log.exception("email %s gagal tak terduga (percobaan %s)", rid, attempts)
        else:
            now = self._now()
            conn.execute(
                "UPDATE email_outbox SET status='sent', sent_at=?, updated_at=? WHERE id=? AND status='sending'",
                (iso(now), iso(now), rid))
            conn.commit()
            return True

        now = self._now()
        if permanent or attempts >= MAX_ATTEMPTS:
            conn.execute(
                "UPDATE email_outbox SET status='failed', last_error=?, updated_at=? WHERE id=? AND status='sending'",
                (err, iso(now), rid))
        else:
            delay = RETRY_DELAYS_MIN[min(attempts, len(RETRY_DELAYS_MIN)) - 1]
            conn.execute(
                "UPDATE email_outbox SET status='queued', last_error=?, next_attempt_at=?, updated_at=?"
                " WHERE id=? AND status='sending'",
                (err, iso(now + timedelta(minutes=delay)), iso(now), rid))
        conn.commit()
        return True

    def recover_stale(self) -> int:
        """Baris `sending` (server mati di tengah kirim) → `queued`. Dipanggil sebelum start()."""
        conn = self._connect()
        try:
            cur = conn.execute(
                "UPDATE email_outbox SET status='queued', updated_at=? WHERE status='sending'", (iso(self._now()),))
            conn.commit()
            return cur.rowcount
        finally:
            conn.close()

    def purge_old(self) -> int:
        """Hapus baris sent/expired/failed berumur > RETENTION_DAYS (isi email reset memuat link sensitif)."""
        now = self._now()
        cutoff = iso(now - timedelta(days=RETENTION_DAYS))
        conn = self._connect()
        try:
            cur = conn.execute(
                "DELETE FROM email_outbox WHERE status IN ('sent','expired','failed') AND created_at < ?", (cutoff,))
            conn.commit()
            self._last_purge = now
            return cur.rowcount
        finally:
            conn.close()
