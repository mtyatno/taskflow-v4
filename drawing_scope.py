"""Drawing milik workspace: token direktif ::draw[x], skema, backfill, dan akses (spec §4.1, §4.6).

Modul ini TIDAK boleh mengimpor webapp (webapp yang mengimpor modul ini)."""
import logging
import re
import sqlite3
from typing import Optional

BACKFILL_KEY = "drawing_list_backfill_v1"

# Token = id angka atau client_id (UUID). Bentuk ter-escape oleh serializer markdown (::draw\[x\]) ikut dikenali.
# IGNORECASE: klien (static/offline/drawdirective.js) mengenali ::DRAW[x] tanpa membedakan huruf besar/kecil.
DRAW_DIRECTIVE_RE = re.compile(r'\\?::draw\\?\[([0-9a-zA-Z_-]+)\\?\](?:\s*\\?\{([^}]*)\\?\})?', re.IGNORECASE)


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


def resolve_for_publish(conn, token: str, owner_id: Optional[int], list_id: Optional[int],
                        cols: str = "*") -> Optional[sqlite3.Row]:
    """Drawing yang boleh ditampilkan di halaman publik untuk token direktif.
    owner_id terisi (note tepercaya: pribadi, ditulis penerbit) -> drawing yang bisa diakses penerbit.
    Selain itu, list_id terisi (note publish bersama di W) -> hanya drawing ber-list_id = W (id angka, lalu client_id).
    Keduanya None -> None. Judul tidak pernah jadi kunci."""
    if owner_id is not None:
        return find_accessible(conn, token, owner_id, cols)
    if list_id is None:
        return None
    did = draw_token_id(token)
    if did is not None:
        row = conn.execute(f"SELECT {cols} FROM drawings WHERE id = ? AND list_id = ?", (did, list_id)).fetchone()
        if row:
            return row
    return conn.execute(f"SELECT {cols} FROM drawings WHERE client_id = ? AND list_id = ? ORDER BY id LIMIT 1",
                        (token, list_id)).fetchone()


def refs_of(row) -> set[str]:
    """Token yang bisa merujuk drawing ini: id dan client_id (bila ada)."""
    refs = {str(row["id"])}
    if row["client_id"]:
        refs.add(row["client_id"])
    return refs


def notes_in_list_using(conn, drawing_row, list_id: int, viewer_uid: int) -> tuple[list[dict], int]:
    """Note ber-list_id = list_id yang merujuk drawing ini: ([{"id","title"}] yang bisa diakses viewer,
    jumlah yang tidak bisa). Prefilter LIKE (SQLite LIKE tak peka huruf besar/kecil untuk ASCII, jadi ::DRAW ikut
    lolos), lalu cocok persis lewat draw_tokens."""
    refs = refs_of(drawing_row)
    rows = conn.execute(
        "SELECT id, user_id, title, content, "
        "  (user_id = ? OR list_id IN (SELECT id FROM shared_lists WHERE owner_id = ? "
        "   UNION SELECT list_id FROM list_members WHERE user_id = ?)) AS visible "
        "FROM scratchpad_notes WHERE list_id = ? AND content LIKE '%::draw%' ORDER BY updated_at DESC, id DESC",
        (viewer_uid, viewer_uid, viewer_uid, list_id),
    ).fetchall()
    visible, hidden = [], 0
    for r in rows:
        if not (draw_tokens(r["content"]) & refs):
            continue
        if r["visible"]:
            visible.append({"id": r["id"], "title": r["title"]})
        else:
            hidden += 1
    return visible, hidden


def leave_impact(conn, list_id: int, uid: int) -> list[dict]:
    """Note pribadi uid (list_id NULL) yang merujuk drawing milik orang lain di workspace list_id: setelah uid
    keluar, rujukan itu tidak bisa dimuat lagi. Token di-resolve seperti find_accessible (milik sendiri didahulukan)."""
    drawings = conn.execute(
        "SELECT id, user_id, client_id, title FROM drawings WHERE list_id = ? AND user_id != ?", (list_id, uid)
    ).fetchall()
    if not drawings:
        return []
    by_id = {str(d["id"]): d for d in drawings}
    by_cid = {d["client_id"]: d for d in drawings if d["client_id"]}
    notes = conn.execute(
        "SELECT id, title, content FROM scratchpad_notes WHERE user_id = ? AND list_id IS NULL "
        "AND content LIKE '%::draw%' ORDER BY updated_at DESC, id DESC", (uid,)
    ).fetchall()
    items: list[dict] = []
    for n in notes:
        seen: set[int] = set()
        for token in sorted(draw_tokens(n["content"])):
            d = by_id.get(token) or by_cid.get(token)
            if d is None or d["id"] in seen:
                continue
            # client_id milik uid sendiri menang atas drawing orang lain (find_accessible)
            if by_id.get(token) is None and conn.execute(
                "SELECT 1 FROM drawings WHERE user_id = ? AND client_id = ?", (uid, token)
            ).fetchone():
                continue
            seen.add(d["id"])
            items.append({"note_id": n["id"], "note_title": n["title"], "drawing_id": d["id"],
                          "drawing_client_id": d["client_id"], "drawing_title": d["title"]})
    return items


def pull_note_drawings_into_list(conn, note_row, actor_uid: int, now: str, move: bool = True) -> dict:
    """Spec §4.4 (diubah oleh putusan akhir PR 2): note di workspace menarik drawing PRIBADI milik AKTOR ke workspace
    note, tetapi HANYA bila move=True, yaitu tulisan ini menetapkan atau mengubah list_id note (POST note baru
    ber-list_id, PATCH share, PUT/POST idempoten yang mengganti list_id; hanya pemilik yang bisa). Itu tindakan
    berbagi yang sengaja (prinsip 2). Semua tulisan lain (PUT/autosave biasa, POST idempoten tanpa ganti list_id,
    restore dari trash) memakai move=False: tidak ada yang dipindah. Diff token mentah sengaja tidak dipakai karena
    klien menormalkan direktif (::DRAW, bentuk ter-escape) sehingga simpan ulang pemilik bisa "menambah" token yang
    disuntik anggota lain. Menyisipkan drawing pribadi ke note W yang sudah ada dibagikan klien lewat
    PATCH /api/drawings/{id}/share (PR 3).
    Drawing orang lain, drawing di workspace lain, token yang tak terlihat aktor, dan semua token bila aktor bukan
    pemilik/anggota list note tidak pernah dipindah. Token yang tidak dipindah dan belum di W dilaporkan mentah-mentah
    di unresolved_drawings (semua token note, tanpa judul/id). Note pribadi: tidak melakukan apa-apa.
    Pemanggil yang commit; content note tidak pernah ditulis ulang."""
    result: dict = {"moved_drawings": [], "unresolved_drawings": []}
    list_id = note_row["list_id"]
    if list_id is None:
        return result
    if move and not conn.execute(
        "SELECT 1 FROM shared_lists WHERE id = ? AND owner_id = ? "
        "UNION SELECT 1 FROM list_members WHERE list_id = ? AND user_id = ?",
        (list_id, actor_uid, list_id, actor_uid),
    ).fetchone():
        move = False
    moved: dict[int, dict] = {}
    unresolved: set[str] = set()
    for token in sorted(draw_tokens(note_row["content"])):
        d = find_accessible(conn, token, actor_uid, cols="id, user_id, client_id, list_id")
        if d is None:
            unresolved.add(token)
        elif d["list_id"] == list_id or d["id"] in moved:
            continue
        elif move and d["list_id"] is None and d["user_id"] == actor_uid:
            conn.execute("UPDATE drawings SET list_id = ?, updated_at = ? WHERE id = ?", (list_id, now, d["id"]))
            moved[d["id"]] = {"id": d["id"], "client_id": d["client_id"], "list_id": list_id, "updated_at": now}
        else:
            unresolved.add(token)
    result["moved_drawings"] = list(moved.values())
    result["unresolved_drawings"] = sorted(unresolved)
    return result
