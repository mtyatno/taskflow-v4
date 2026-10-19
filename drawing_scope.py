"""Drawing milik workspace: token direktif ::draw[x], skema, backfill, dan akses (spec §4.1, §4.6).

Modul ini TIDAK boleh mengimpor webapp (webapp yang mengimpor modul ini)."""
import logging
import re
import sqlite3
from typing import Optional

BACKFILL_KEY = "drawing_list_backfill_v1"

# Token = id angka atau client_id (UUID). Bentuk ter-escape oleh serializer markdown (::draw\[x\]) ikut dikenali.
DRAW_DIRECTIVE_RE = re.compile(r'\\?::draw\\?\[([0-9a-zA-Z_-]+)\\?\](?:\s*\\?\{([^}]*)\\?\})?')


def draw_tokens(content: Optional[str]) -> set[str]:
    """Semua token direktif ::draw[...] di content (id angka atau client_id)."""
    return {m.group(1) for m in DRAW_DIRECTIVE_RE.finditer(content or "")}


def draw_token_id(token: str) -> Optional[int]:
    """Token angka ASCII → id baris (drawing, id note di wikilink publik, id lampiran di /pub/attachments). None bila
    bukan angka ASCII atau di luar INTEGER 64-bit SQLite (digit Unicode membuat int() gagal, angka terlalu besar jadi
    OverflowError saat di-bind: keduanya 500, padahal barisnya pasti tidak ada)."""
    if token.isascii() and token.isdigit() and len(token) <= 19:
        value = int(token)
        if value <= 2**63 - 1:
            return value
    return None


def ensure_drawing_scope_schema(conn) -> None:
    """drawings.list_id + last_edited_by + indeks (idempoten). Pemanggil yang commit."""
    cols = {r[1] for r in conn.execute("PRAGMA table_info(drawings)").fetchall()}
    if "list_id" not in cols:
        conn.execute("ALTER TABLE drawings ADD COLUMN list_id INTEGER DEFAULT NULL REFERENCES shared_lists(id) ON DELETE SET NULL")
    if "last_edited_by" not in cols:
        conn.execute("ALTER TABLE drawings ADD COLUMN last_edited_by INTEGER DEFAULT NULL REFERENCES users(id) ON DELETE SET NULL")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_drawings_list ON drawings(list_id, updated_at)")


def backfill_drawing_lists(conn, now: str) -> dict:
    """Sekali jalan: drawing pribadi milik penulis note workspace yang merujuknya ikut masuk workspace note itu.
    Note terbaru menang bila satu drawing dirujuk note di dua workspace. Pemanggil yang commit."""
    if conn.execute("SELECT 1 FROM app_meta WHERE key = ?", (BACKFILL_KEY,)).fetchone():
        return {"skipped": True}
    moved: set[int] = set()
    conflicts: list[dict] = []
    notes = conn.execute(
        "SELECT user_id, list_id, content FROM scratchpad_notes "
        "WHERE list_id IS NOT NULL ORDER BY updated_at DESC, id DESC"
    ).fetchall()
    for note in notes:
        for token in draw_tokens(note[2]):
            row = None
            did = draw_token_id(token)
            if did is not None:
                row = conn.execute("SELECT id, list_id FROM drawings WHERE id = ? AND user_id = ?",
                                   (did, note[0])).fetchone()
            if row is None:
                row = conn.execute("SELECT id, list_id FROM drawings WHERE client_id = ? AND user_id = ?",
                                   (token, note[0])).fetchone()
            if row is None:
                continue
            if row[1] is None:
                conn.execute("UPDATE drawings SET list_id = ?, updated_at = ? WHERE id = ?", (note[1], now, row[0]))
                moved.add(row[0])
            elif row[1] != note[1] and row[0] in moved:
                c = {"drawing_id": row[0], "kept_list_id": row[1], "other_list_id": note[1]}
                if c not in conflicts:
                    conflicts.append(c)
                    logging.warning("drawing %s dirujuk note di dua workspace: tetap di %s, abaikan %s",
                                    row[0], row[1], note[1])
    conn.execute("INSERT OR REPLACE INTO app_meta(key, value) VALUES (?, ?)", (BACKFILL_KEY, now))
    return {"moved": len(moved), "conflicts": conflicts}


def access_clause(uid: int, prefix: str = "") -> tuple[str, list]:
    """SQL WHERE fragment + params: drawing milik uid ATAU di workspace tempat uid owner/anggota."""
    p = f"{prefix}." if prefix else ""
    clause = (
        f"({p}user_id = ? OR {p}list_id IN ("
        "  SELECT id FROM shared_lists WHERE owner_id = ?"
        "  UNION SELECT list_id FROM list_members WHERE user_id = ?"
        "))"
    )
    return clause, [uid, uid, uid]


def find_accessible(conn, token: str, uid: int, cols: str = "*") -> Optional[sqlite3.Row]:
    """Drawing yang bisa diakses uid untuk token direktif: id angka dulu, lalu client_id. client_id hanya unik
    per user, jadi lintas user milik uid sendiri didahulukan."""
    clause, params = access_clause(uid)
    did = draw_token_id(token)
    if did is not None:
        row = conn.execute(f"SELECT {cols} FROM drawings WHERE id = ? AND {clause}", [did, *params]).fetchone()
        if row:
            return row
    return conn.execute(
        f"SELECT {cols} FROM drawings WHERE client_id = ? AND {clause} ORDER BY (user_id = ?) DESC LIMIT 1",
        [token, *params, uid],
    ).fetchone()


def refs_of(row) -> set[str]:
    """Token yang bisa merujuk drawing ini: id dan client_id (bila ada)."""
    refs = {str(row["id"])}
    if row["client_id"]:
        refs.add(row["client_id"])
    return refs
