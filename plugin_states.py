"""
Alurik — status plugin per pengguna (spec Fase 0b K11, K12, §4.5, §5; ADR-039).

Tabel `plugin_states(user_id, plugin_id, scope, enabled, settings, updated_at)`:
`enabled` NULL = ikut `defaultEnabled` dari `static/plugins/index.json`; `settings`
objek JSON ≤ 16 KB (disimpan dan disinkron, belum diekspos ke plugin — K18).

Last-write-wins di server berdasarkan `updated_at` kiriman klien (waktu toggle),
dipotong ke `min(klien, waktu server)` dan dibandingkan sebagai `datetime` (K12).
Semua baca-lalu-tulis lewat `dbconn.write_tx` (ADR-038 K3).
"""
from __future__ import annotations

import json
import re
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, StrictBool

import dbconn
import plugin_host
import plugin_loader

ID_RE = re.compile(r"^[a-z][a-z0-9-]{2,31}$")
RESERVED_IDS = frozenset({"state"})
SETTINGS_MAX_BYTES = 16 * 1024
SCOPE_USER = "user"

router = APIRouter()


def ensure_schema(conn) -> None:
    """DDL §4.5 (idempoten). Tidak commit — pemanggil yang mengatur transaksi."""
    conn.execute("""
        CREATE TABLE IF NOT EXISTS plugin_states (
          user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          plugin_id  TEXT    NOT NULL,
          scope      TEXT    NOT NULL DEFAULT 'user',
          enabled    INTEGER CHECK (enabled IN (0, 1)),
          settings   TEXT    NOT NULL DEFAULT '{}',
          updated_at TEXT    NOT NULL,
          PRIMARY KEY (user_id, plugin_id, scope)
        )
    """)


def parse_ts(value: str) -> datetime:
    """ISO 8601 → datetime aware UTC. Akhiran `Z` diterima; tanpa zona = UTC.
    Tak terbaca → `ValueError`."""
    if not isinstance(value, str) or not value.strip():
        raise ValueError("waktu kosong")
    s = value.strip()
    if s.endswith(("Z", "z")):
        s = s[:-1] + "+00:00"
    dt = datetime.fromisoformat(s)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def iso(dt: datetime) -> str:
    """UTC, milidetik, offset `+00:00` (mis. `2026-11-01T10:05:00.000+00:00`)."""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).isoformat(timespec="milliseconds")


def _settings_obj(raw) -> dict:
    try:
        val = json.loads(raw) if raw else {}
    except (TypeError, ValueError):
        return {}
    return val if isinstance(val, dict) else {}


def row_to_state(row) -> dict:
    enabled = row["enabled"]
    return {
        "enabled": None if enabled is None else bool(enabled),
        "settings": _settings_obj(row["settings"]),
        "updated_at": row["updated_at"],
    }


def dump_settings(settings: dict) -> str:
    """Serialisasi kanonik yang juga dipakai untuk batas ukuran 16 KB."""
    return json.dumps(settings, separators=(",", ":"), ensure_ascii=False)


def get_states(conn, user_id: int) -> dict[str, dict]:
    rows = conn.execute(
        "SELECT plugin_id, enabled, settings, updated_at FROM plugin_states "
        "WHERE user_id = ? AND scope = ? ORDER BY plugin_id",
        (user_id, SCOPE_USER),
    ).fetchall()
    return {r["plugin_id"]: row_to_state(r) for r in rows}


def effective_enabled(conn, user_id: int, plugin_id: str, default_enabled: bool) -> bool:
    row = conn.execute(
        "SELECT enabled FROM plugin_states WHERE user_id = ? AND plugin_id = ? AND scope = ?",
        (user_id, plugin_id, SCOPE_USER),
    ).fetchone()
    if row is None or row["enabled"] is None:
        return bool(default_enabled)
    return bool(row["enabled"])


def put_state(conn, user_id: int, plugin_id: str, *, fields: dict,
              updated_at: datetime | None, now: datetime) -> tuple[bool, dict]:
    """Upsert LWW. `fields` ⊆ {"enabled", "settings"} — hanya yang dikirim klien.
    Mengembalikan `(applied, state)`; baris server yang lebih baru → `(False, state_server)`."""
    unknown = set(fields) - {"enabled", "settings"}
    if unknown:
        raise ValueError(f"field tidak dikenal: {sorted(unknown)}")
    incoming = min(updated_at or now, now)
    ts = iso(incoming)
    with dbconn.write_tx(conn):
        row = conn.execute(
            "SELECT enabled, settings, updated_at FROM plugin_states "
            "WHERE user_id = ? AND plugin_id = ? AND scope = ?",
            (user_id, plugin_id, SCOPE_USER),
        ).fetchone()
        if row is not None:
            try:
                existing = parse_ts(row["updated_at"])
            except ValueError:
                existing = None  # nilai rusak di DB → kiriman sah menimpanya
            if existing is not None and existing > incoming:
                return False, row_to_state(row)
        values = {}
        if "enabled" in fields:
            en = fields["enabled"]
            values["enabled"] = None if en is None else (1 if en else 0)
        if "settings" in fields:
            values["settings"] = dump_settings(fields["settings"] or {})
        if row is None:
            conn.execute(
                "INSERT INTO plugin_states (user_id, plugin_id, scope, enabled, settings, updated_at) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                (user_id, plugin_id, SCOPE_USER, values.get("enabled"),
                 values.get("settings", "{}"), ts),
            )
        else:
            cols = list(values) + ["updated_at"]
            params = [values[c] for c in values] + [ts, user_id, plugin_id, SCOPE_USER]
            conn.execute(
                "UPDATE plugin_states SET " + ", ".join(f"{c} = ?" for c in cols)
                + " WHERE user_id = ? AND plugin_id = ? AND scope = ?",
                params,
            )
        new = conn.execute(
            "SELECT enabled, settings, updated_at FROM plugin_states "
            "WHERE user_id = ? AND plugin_id = ? AND scope = ?",
            (user_id, plugin_id, SCOPE_USER),
        ).fetchone()
        return True, row_to_state(new)


# ── API host (spec §5; rencana R7, R8) ────────────────────────────────────────

class StatePut(BaseModel):
    enabled: StrictBool | None = None
    settings: dict | None = None
    updated_at: str | None = None


def _reject_ext(user: dict) -> None:
    if user.get("scope") == "ext":  # R7: token clipper tidak mengubah/membaca status plugin akun
        raise HTTPException(status_code=403, detail={"code": "PLUGIN_FORBIDDEN_TOKEN"})


@router.get("/api/plugins/state")
def get_state(user: dict = Depends(plugin_host.current_user)) -> dict:
    _reject_ext(user)
    with plugin_host.get_conn() as conn:
        plugins = get_states(conn, user["sub"])
    return {"v": 1, "server_time": iso(plugin_host.now_utc()), "plugins": plugins}


@router.put("/api/plugins/state/{plugin_id}")
def put_state_endpoint(plugin_id: str, body: StatePut,
                       user: dict = Depends(plugin_host.current_user)) -> dict:
    _reject_ext(user)
    if not ID_RE.match(plugin_id) or plugin_id in RESERVED_IDS:
        raise HTTPException(status_code=404, detail={"code": "PLUGIN_UNKNOWN"})
    # Indeks tidak sehat → 503 (op klien tetap antre), dicek SEBELUM keanggotaan indeks:
    # indeks rusak = daftar kosong, dan 404 PLUGIN_UNKNOWN membuat klien membuang toggle.
    if not plugin_loader.index_ok():
        raise HTTPException(status_code=503, detail={"code": "PLUGIN_UNAVAILABLE", "plugin_id": plugin_id})
    if plugin_id not in plugin_loader.known():
        raise HTTPException(status_code=404, detail={"code": "PLUGIN_UNKNOWN"})
    sent = body.model_fields_set
    fields: dict = {}
    if "enabled" in sent:
        fields["enabled"] = body.enabled
    if "settings" in sent:
        if body.settings is None:
            raise HTTPException(status_code=422, detail="settings harus objek")
        if len(dump_settings(body.settings).encode("utf-8")) > SETTINGS_MAX_BYTES:
            raise HTTPException(status_code=422, detail="settings melebihi 16 KB")
        fields["settings"] = body.settings
    if not fields:
        raise HTTPException(status_code=422, detail="kirim enabled atau settings")
    updated_at = None
    if body.updated_at is not None:
        try:
            updated_at = parse_ts(body.updated_at)
        except (ValueError, TypeError):
            raise HTTPException(status_code=422, detail="updated_at tidak valid")
    with plugin_host.get_conn() as conn:
        applied, state = put_state(conn, user["sub"], plugin_id, fields=fields,
                                   updated_at=updated_at, now=plugin_host.now_utc())
    return {"applied": applied, "state": state}
