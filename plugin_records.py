"""
Alurik — record plugin yang tersinkron (`plugin_records`), spec Fase 1 §5.2, §5.3, §6.2; rencana PR 1a-2 R1, R5–R8.

Bagian murni (tanpa koneksi sendiri, tanpa `sqlite3.connect`, tanpa `webapp`/`repository`): skema, validasi item,
kursor `seq`, penerapan item (LWW + `base_version`), halaman tarik, dan purge tombstone. Bagian akhir berkas =
router HTTP `GET/POST /api/plugins/{id}/records` (PR 1a-2 T2, R4, R7, R8) yang memanggil fungsi-fungsi itu.

- Satu baris = `(plugin_id, entity, owner_key, id)`; `owner_key` = `u:<user_id>` | `l:<list_id>`.
- `seq` = urutan commit server (`MAX(seq) + 1`, dibaca di dalam `write_tx` pemanggil) — kursor tarik berbasis `seq`,
  bukan waktu klien, sehingga edit offline lama yang baru terkirim tetap ditarik perangkat lain (R5, R7).
  `seq` tidak pernah turun walau tombstone tertinggi di-purge (`purged_seq` ikut dihitung di `next_seq`).
- `apply_item` TIDAK membuka transaksi: pemanggil membungkus seluruh `items` dalam satu `dbconn.write_tx` (R5).
- Validasi data = klien (vektor bersama `tests/fixtures/plugin_records_vectors.json`, R25).
"""
from __future__ import annotations

import hashlib
import json
import logging
import re
import sqlite3
import time
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, StrictBool, conlist

import dbconn
import plugin_host
import plugin_loader
import plugin_states
import task_ext

logger = logging.getLogger("alurik.plugins")

ENTITY_RE = plugin_loader.RECORD_ENTITY_RE
ID_RE = re.compile(r"^[A-Za-z0-9:@._-]{1,80}$")
SCOPE_RE = re.compile(r"^(user|list:[1-9][0-9]{0,17})$")
MAX_DATA_BYTES = plugin_loader.RECORD_MAX_BYTES  # 65536
TOMBSTONE_DAYS = 30
PURGE_INTERVAL_S = 3600

_CURSOR_RE = re.compile(r"^1\.([0-9]{1,18})\.([0-9a-f]{8})$")
_last_purge: float | None = None


def ensure_schema(conn) -> None:
    """DDL §5.2 (idempoten). Tidak commit — pemanggil (loader `migrate`) yang mengatur transaksi."""
    conn.execute("""
        CREATE TABLE IF NOT EXISTS plugin_records (
          seq        INTEGER NOT NULL,
          plugin_id  TEXT    NOT NULL,
          entity     TEXT    NOT NULL,
          id         TEXT    NOT NULL,
          owner_key  TEXT    NOT NULL,
          user_id    INTEGER REFERENCES users(id) ON DELETE CASCADE,
          list_id    INTEGER REFERENCES shared_lists(id) ON DELETE CASCADE,
          scope      TEXT    NOT NULL,
          data       TEXT    NOT NULL DEFAULT '{}',
          updated_at TEXT    NOT NULL,
          version    INTEGER NOT NULL,
          deleted    INTEGER NOT NULL DEFAULT 0,
          updated_by INTEGER,
          server_at  TEXT    NOT NULL,
          PRIMARY KEY (plugin_id, entity, owner_key, id),
          CHECK ((user_id IS NULL) <> (list_id IS NULL))
        )
    """)
    conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS ux_plugin_records_seq ON plugin_records(seq)")
    conn.execute("CREATE INDEX IF NOT EXISTS ix_plugin_records_user "
                 "ON plugin_records(plugin_id, user_id, seq) WHERE list_id IS NULL")
    conn.execute("CREATE INDEX IF NOT EXISTS ix_plugin_records_list "
                 "ON plugin_records(plugin_id, list_id, seq) WHERE list_id IS NOT NULL")
    conn.execute("CREATE TABLE IF NOT EXISTS plugin_records_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)")


# ── Kunci pemilik ────────────────────────────────────────────────────────────

def owner_key_for(uid: int, scope: str) -> tuple[str, int | None, int | None]:
    """`(owner_key, user_id, list_id)`; scope di luar `user` | `list:<id>` → `ValueError`."""
    if scope == "user":
        return f"u:{uid}", uid, None
    if isinstance(scope, str) and SCOPE_RE.fullmatch(scope):
        lid = int(scope[5:])
        return f"l:{lid}", None, lid
    raise ValueError(f"scope tidak didukung: {scope!r}")


# ── Validasi ─────────────────────────────────────────────────────────────────

def _max_bytes(decl: dict) -> int:
    mb = decl.get("maxBytes", MAX_DATA_BYTES)
    if isinstance(mb, bool) or not isinstance(mb, int) or mb < 1:
        return MAX_DATA_BYTES
    return min(MAX_DATA_BYTES, mb)


def _is_int(v) -> bool:
    return isinstance(v, int) and not isinstance(v, bool)


def validate_item(item: dict, decl: dict | None) -> tuple[str, str] | None:
    """`None` bila sah, selain itu `("INVALID", detail)`. `decl` = deklarasi entitas item (`None` = tak dideklarasikan).
    Urutan: entity, id, scope, updated_at, base_version, deleted, lalu data (objek → nilai baku → `$task` → ukuran).
    Data tombstone tidak divalidasi (batas `maxBytes` bisa menyusut setelah record dibuat) dan tidak disimpan."""
    entity = item.get("entity")
    if decl is None or not isinstance(entity, str) or not ENTITY_RE.fullmatch(entity):
        return "INVALID", "entity"
    rid = item.get("id")
    if not isinstance(rid, str) or not ID_RE.fullmatch(rid):
        return "INVALID", "id"
    scope = item.get("scope", "user")
    if not isinstance(scope, str) or not SCOPE_RE.fullmatch(scope):
        return "INVALID", "scope"
    ua = item.get("updated_at")
    if ua is not None:
        try:
            plugin_states.parse_ts(ua)
        except (ValueError, TypeError, OverflowError):
            return "INVALID", "updated_at"
    bv = item.get("base_version")
    if bv is not None and (not _is_int(bv) or bv < 0):
        return "INVALID", "base_version"
    deleted = item.get("deleted")
    if deleted is not None and not isinstance(deleted, bool):
        return "INVALID", "deleted"
    if deleted:
        return None
    data = item["data"] if "data" in item else {}
    if not isinstance(data, dict):
        return "INVALID", "data"
    code = task_ext.check_value(data)
    if code == "EXT_TASK_REF":
        return "INVALID", "task_ref"
    if code is not None:
        return "INVALID", "data"
    try:
        size = len(task_ext.dumps(data).encode("utf-8"))
    except (ValueError, TypeError, RecursionError):
        return "INVALID", "data"
    if size > _max_bytes(decl):
        return "INVALID", "size"
    return None


# ── Kursor ───────────────────────────────────────────────────────────────────

def fingerprint(list_ids) -> str:
    """8 hex pertama sha1 dari id workspace yang bisa diakses (tak peduli urutan masukan, R7)."""
    ids = sorted(str(i) for i in set(list_ids))
    return hashlib.sha1(",".join(ids).encode("utf-8")).hexdigest()[:8]


def make_cursor(seq: int, fp: str) -> str:
    return f"1.{seq}.{fp}"


def parse_cursor(s) -> tuple[int, str | None] | None:
    """`""`/`None` → `(0, None)` (tarik penuh, bukan reset); format tak terbaca → `None` (→ reset)."""
    if s is None or s == "":
        return 0, None
    if not isinstance(s, str):
        return None
    m = _CURSOR_RE.fullmatch(s)
    if m is None:
        return None
    return int(m.group(1)), m.group(2)


def purged_seq(conn) -> int:
    row = conn.execute("SELECT value FROM plugin_records_meta WHERE key = 'purged_seq'").fetchone()
    try:
        return int(row[0]) if row is not None else 0
    except (TypeError, ValueError):
        return 0


def global_max_seq(conn) -> int:
    """`max(MAX(seq), purged_seq)` — batas atas `seq` yang pernah diberikan (juga setelah purge tombstone teratas)."""
    row = conn.execute("SELECT COALESCE(MAX(seq), 0) FROM plugin_records").fetchone()
    return max(int(row[0]), purged_seq(conn))


def next_seq(conn) -> int:
    """`MAX(seq) + 1`, dibaca di dalam `write_tx` pemanggil. Tidak pernah ≤ `purged_seq`: tanpa itu purge tombstone
    bertanda `seq` tertinggi membuat tulis berikutnya memakai ulang `seq` yang sudah dilihat klien (tulis terlewat)."""
    row = conn.execute("SELECT COALESCE(MAX(seq), 0) FROM plugin_records").fetchone()
    return max(int(row[0]), purged_seq(conn)) + 1


# ── Baris ↔ record ───────────────────────────────────────────────────────────

def row_to_record(row) -> dict:
    try:
        data = json.loads(row["data"]) if row["data"] else {}
    except (TypeError, ValueError):
        data = {}
    if not isinstance(data, dict):
        data = {}
    return {
        "entity": row["entity"],
        "id": row["id"],
        "scope": row["scope"],
        "data": data,
        "updated_at": row["updated_at"],
        "version": row["version"],
        "deleted": bool(row["deleted"]),
    }


def _canon(raw_or_obj) -> str | None:
    try:
        obj = json.loads(raw_or_obj) if isinstance(raw_or_obj, str) else raw_or_obj
        return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False)
    except (TypeError, ValueError):
        return None


# ── Tulis ────────────────────────────────────────────────────────────────────

_ROW_SQL = ("SELECT seq, plugin_id, entity, id, owner_key, scope, data, updated_at, version, deleted, updated_by, "
            "server_at FROM plugin_records WHERE plugin_id = ? AND entity = ? AND owner_key = ? AND id = ?")


def _err(item: dict, code: str, detail: str | None = None) -> dict:
    out = {"entity": item.get("entity"), "id": item.get("id"), "error": code}
    if detail is not None:
        out["detail"] = detail
    return out


def apply_item(conn, uid: int, pid: str, item: dict, decl: dict | None, now: datetime,
               access: set[int]) -> dict:
    """Satu item POST (R6). Harus dipanggil di dalam `write_tx` pemanggil. Mengembalikan
    `{"entity","id","applied","record"}` atau `{"entity","id","error","detail"?}`. `access` = id workspace yang
    bisa diakses `uid` (`plugin_host.accessible_list_ids`)."""
    if not conn.in_transaction:
        raise RuntimeError("apply_item harus dipanggil di dalam write_tx")
    bad = validate_item(item, decl)
    if bad is not None:
        return _err(item, *bad)
    entity, rid = item["entity"], item["id"]
    scope = item.get("scope", "user")
    owner_key, user_id, list_id = owner_key_for(uid, scope)
    if list_id is not None and list_id not in access:
        return _err(item, "FORBIDDEN_SCOPE")
    # id yang sama di pemilik lain yang bisa diakses pengguna ini → scope tidak bisa diubah. Pencarian dibatasi ke
    # kunci pemilik yang bisa diakses (`u:<uid>` + `l:<id>` tiap workspace di `access`), memakai PK penuh
    # (plugin_id, entity, owner_key, id); baris pengguna lain tidak ikut terpindai.
    visible = [f"u:{uid}"] + [f"l:{int(i)}" for i in sorted(access)]
    if conn.execute(
        "SELECT 1 FROM plugin_records WHERE plugin_id = ? AND entity = ? AND id = ? AND owner_key != ? "
        "AND owner_key IN (SELECT value FROM json_each(?)) LIMIT 1",
        (pid, entity, rid, owner_key, json.dumps(visible)),
    ).fetchone() is not None:
        return _err(item, "SCOPE_IMMUTABLE")
    base = item.get("base_version") or 0
    deleted = bool(item.get("deleted"))
    row = conn.execute(_ROW_SQL, (pid, entity, owner_key, rid)).fetchone()

    if row is not None and row["version"] == base + 1 and row["updated_by"] == uid \
            and bool(row["deleted"]) == deleted \
            and (deleted or _canon(row["data"]) == _canon(item.get("data", {}))):
        return {"entity": entity, "id": rid, "applied": True, "record": row_to_record(row)}  # kiriman ulang

    if row is None and deleted:
        return {"entity": entity, "id": rid, "applied": True, "record": None}

    ua = item.get("updated_at")
    incoming = min(plugin_states.parse_ts(ua) if ua is not None else now, now)
    if row is not None and base != row["version"]:
        try:
            existing = plugin_states.parse_ts(row["updated_at"])
        except (ValueError, TypeError, OverflowError):
            existing = None  # nilai rusak di DB → kiriman menang
        if existing is not None and existing > incoming:
            return {"entity": entity, "id": rid, "applied": False, "record": row_to_record(row)}

    data_json = "{}" if deleted else task_ext.dumps(item.get("data", {}))
    ts, server_at, seq = plugin_states.iso(incoming), plugin_states.iso(now), next_seq(conn)
    if row is None:
        conn.execute(
            "INSERT INTO plugin_records (seq, plugin_id, entity, id, owner_key, user_id, list_id, scope, data, "
            "updated_at, version, deleted, updated_by, server_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?)",
            (seq, pid, entity, rid, owner_key, user_id, list_id, scope, data_json, ts, uid, server_at),
        )
    else:
        conn.execute(
            "UPDATE plugin_records SET seq = ?, data = ?, updated_at = ?, version = version + 1, deleted = ?, "
            "updated_by = ?, server_at = ? WHERE plugin_id = ? AND entity = ? AND owner_key = ? AND id = ?",
            (seq, data_json, ts, 1 if deleted else 0, uid, server_at, pid, entity, owner_key, rid),
        )
    new = conn.execute(_ROW_SQL, (pid, entity, owner_key, rid)).fetchone()
    return {"entity": entity, "id": rid, "applied": True, "record": row_to_record(new)}


# ── Tarik ────────────────────────────────────────────────────────────────────

def fetch_page(conn, uid: int, pid: str, cursor_seq: int, limit: int, access, entity: str | None = None):
    """Baris terlihat (`u:<uid>` ∪ workspace di `access`) dengan `seq > cursor_seq`, urut `seq`.
    Mengembalikan `(rows, more)` — paling banyak `limit` baris."""
    ent_sql = " AND entity = ?" if entity is not None else ""
    cols = ("seq, plugin_id, entity, id, owner_key, scope, data, updated_at, version, deleted, "
            "updated_by, server_at")
    user_params = [pid, cursor_seq, uid] + ([entity] if entity is not None else [])
    list_params = [pid, cursor_seq, json.dumps(sorted(int(i) for i in access))] + ([entity] if entity is not None else [])
    sql = (
        f"SELECT * FROM ("
        f"SELECT {cols} FROM plugin_records WHERE plugin_id = ? AND seq > ? AND list_id IS NULL AND user_id = ?{ent_sql} "
        f"UNION ALL "
        f"SELECT {cols} FROM plugin_records WHERE plugin_id = ? AND seq > ? AND list_id IS NOT NULL "
        f"AND list_id IN (SELECT value FROM json_each(?)){ent_sql}"
        f") ORDER BY seq LIMIT ?"
    )
    got = conn.execute(sql, user_params + list_params + [limit + 1]).fetchall()
    return got[:limit], len(got) > limit


# ── Purge ────────────────────────────────────────────────────────────────────

def _purge(conn, now: datetime) -> int:
    cutoff = plugin_states.iso(now - timedelta(days=TOMBSTONE_DAYS))
    top = conn.execute("SELECT MAX(seq) FROM plugin_records WHERE deleted = 1 AND server_at < ?",
                       (cutoff,)).fetchone()[0]
    if top is None:
        return 0
    n = conn.execute("DELETE FROM plugin_records WHERE deleted = 1 AND server_at < ?", (cutoff,)).rowcount
    conn.execute("INSERT INTO plugin_records_meta (key, value) VALUES ('purged_seq', ?) "
                 "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                 (str(max(purged_seq(conn), int(top))),))
    return n


def purge(conn, now: datetime) -> int:
    """Hapus tombstone `server_at` lebih tua dari 30 hari; `purged_seq` = max(lama, seq terbesar yang dihapus).
    Di luar transaksi → `write_tx` sendiri; di dalam transaksi pemanggil → ikut transaksi itu. Mengembalikan jumlah baris."""
    if conn.in_transaction:
        return _purge(conn, now)
    with dbconn.write_tx(conn):
        return _purge(conn, now)


def maybe_purge(conn, now: datetime, clock=time.monotonic) -> int | None:
    """`purge` paling sering sekali per `PURGE_INTERVAL_S` per proses (dipanggil handler GET). `None` = dilewati."""
    global _last_purge
    t = clock()
    if _last_purge is not None and t - _last_purge < PURGE_INTERVAL_S:
        return None
    n = purge(conn, now)
    _last_purge = t  # dicatat hanya setelah sukses: purge gagal (mis. DB terkunci) tidak menahan percobaan berikutnya
    return n


def export_rows(conn, uid: int) -> list[dict]:
    """Record `user` milik `uid` tanpa tombstone untuk ekspor data (R24); record `list:` milik workspace, tidak diekspor.
    Tabel tidak ada → `[]` (ekspor tidak boleh gagal)."""
    try:
        rows = conn.execute(
            "SELECT plugin_id, entity, id, scope, data, updated_at, version, deleted FROM plugin_records "
            "WHERE user_id = ? AND list_id IS NULL AND deleted = 0 ORDER BY plugin_id, entity, id", (uid,),
        ).fetchall()
    except sqlite3.OperationalError:
        return []
    out = []
    for r in rows:
        rec = row_to_record(r)
        out.append({"plugin_id": r["plugin_id"], "entity": rec["entity"], "id": rec["id"], "scope": rec["scope"],
                    "data": rec["data"], "updated_at": rec["updated_at"], "version": rec["version"]})
    return out


def _reset_for_tests() -> None:
    global _last_purge
    _last_purge = None


# ── API host (spec §6.2; rencana R1, R2, R4, R7, R8) ─────────────────────────

router = APIRouter()

MAX_BODY_BYTES = 262144


class RecordItem(BaseModel):
    entity: str
    id: str
    scope: str
    data: dict = {}
    deleted: StrictBool = False
    updated_at: str
    base_version: int | None = None


class RecordsPost(BaseModel):
    items: conlist(RecordItem, min_length=1, max_length=50)


def _unavailable(plugin_id: str | None = None) -> HTTPException:
    detail = {"code": "PLUGIN_UNAVAILABLE"}
    if plugin_id:
        detail["plugin_id"] = plugin_id
    return HTTPException(status_code=503, detail=detail)


def _guard(plugin_id: str, request: Request, user: dict = Depends(plugin_host.current_user)) -> dict:
    """Pemeriksaan tingkat permintaan (R4), sebelum badan POST divalidasi: 401 (dependency) → 403 token clipper →
    404 id tak sah/`state` → 503 indeks tidak sehat → (id tak dikenal / tanpa izin `records`: baca ulang indeks sekali)
    404 → 413 (hanya POST). TIDAK memeriksa plugin ON (K9: antrean klien tetap terkirim saat plugin dimatikan)."""
    if user.get("scope") == "ext":
        raise HTTPException(status_code=403, detail={"code": "PLUGIN_FORBIDDEN_TOKEN"})
    if not plugin_loader.ID_RE.match(plugin_id) or plugin_id in plugin_loader.RESERVED_IDS:
        raise HTTPException(status_code=404, detail={"code": "PLUGIN_UNKNOWN"})
    if not plugin_loader.index_ok():
        raise _unavailable(plugin_id)
    if plugin_id not in plugin_loader.known() or "records" not in plugin_loader.permissions(plugin_id):
        plugin_loader.refresh_known()
        if plugin_id not in plugin_loader.known() or "records" not in plugin_loader.permissions(plugin_id):
            raise HTTPException(status_code=404, detail={"code": "PLUGIN_UNKNOWN"})
    if request.method == "POST":
        try:
            length = int(request.headers.get("content-length", ""))
        except ValueError:
            length = 0
        if length > MAX_BODY_BYTES:
            raise HTTPException(status_code=413, detail={"code": "TOO_LARGE"})
    return {"uid": user["sub"], "pid": plugin_id, "decl": plugin_loader.records_decl(plugin_id)}


@router.get("/api/plugins/{plugin_id}/records")
def get_records(plugin_id: str, cursor: str = "", limit: int = Query(500, ge=1, le=1000), entity: str | None = None,
                ctx: dict = Depends(_guard)) -> dict:
    uid, pid, decl = ctx["uid"], ctx["pid"], ctx["decl"]
    # Kursor `seq` bersifat global per plugin (bukan per entitas): kursor dari GET ber-`entity` hanya sah untuk
    # filter `entity` yang sama. Dipakai tanpa filter (atau dengan entitas lain) ia melewatkan record entitas lain
    # yang `seq`-nya lebih kecil dari kursor. Klien menarik per plugin tanpa filter.
    if entity is not None and entity not in decl:
        raise HTTPException(status_code=422, detail={"code": "INVALID", "detail": "entity"})
    now = plugin_host.now_utc()
    try:
        with plugin_host.get_conn() as conn:
            access = plugin_host.accessible_list_ids(conn, uid)
            fp = fingerprint(access)
            parsed = parse_cursor(cursor)
            if parsed is None:
                out: dict = {"reset": True}
            else:
                seq, cfp = parsed
                if cfp is not None and (cfp != fp or seq < purged_seq(conn)):
                    out = {"reset": True}  # keanggotaan berubah, atau tombstone yang belum dilihat klien sudah dipurge
                else:
                    # M dibaca SEBELUM halaman: `seq` diberikan di dalam BEGIN IMMEDIATE, jadi baris ber-seq ≤ M sudah
                    # commit sebelum M terbaca dan pasti terlihat oleh fetch_page berikutnya.
                    horizon = global_max_seq(conn)
                    rows, more = fetch_page(conn, uid, pid, seq, limit, access, entity)
                    if cfp is not None and seq < purged_seq(conn):
                        # purge mendarat di antara pemeriksaan awal dan pembacaan halaman (snapshot terpisah):
                        # halaman bisa tanpa tombstone yang sudah dibuang → klien harus menarik penuh
                        out = {"reset": True}
                    else:
                        last = rows[-1]["seq"] if rows else seq
                        # Halaman terakhir: kursor maju ke M (MAX(seq) global, termasuk purged_seq) walau baris terlihat
                        # terakhir lebih lama — tanpa ini kursor pengguna yang barisnya tua tertahan di bawah
                        # `purged_seq` (global) dan di-reset setiap sinkron. `more`: tetap di seq item terakhir.
                        out = {"items": [row_to_record(r) for r in rows],
                               "cursor": make_cursor(last if more else max(last, horizon), fp), "more": more}
            try:  # halaman sudah terbaca; purge gagal (mis. DB terkunci) tidak boleh menggagalkan tarik
                maybe_purge(conn, now)
            except Exception as e:  # noqa: BLE001
                logger.warning("plugin_records: purge tombstone gagal (%s: %s)", type(e).__name__, e)
    except sqlite3.OperationalError as e:  # R1: tabel hilang/DB tak terbuka → klien mengantre ulang (5xx)
        logger.error("plugin_records GET: %s", e)
        raise _unavailable(pid) from e
    return out


@router.post("/api/plugins/{plugin_id}/records")
def post_records(plugin_id: str, body: RecordsPost, ctx: dict = Depends(_guard)) -> dict:
    uid, pid, decl = ctx["uid"], ctx["pid"], ctx["decl"]
    now = plugin_host.now_utc()
    try:
        with plugin_host.get_conn() as conn:
            with dbconn.write_tx(conn):  # satu transaksi: `seq` dibaca-lalu-ditulis tanpa celah (R5)
                access = set(plugin_host.accessible_list_ids(conn, uid))
                results = [apply_item(conn, uid, pid, it.model_dump(), decl.get(it.entity), now, access)
                           for it in body.items]
    except sqlite3.OperationalError as e:
        logger.error("plugin_records POST: %s", e)
        raise _unavailable(pid) from e
    return {"results": results}
