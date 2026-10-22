"""E2E lampiran task di web TANPA cookie `token` (SPA login lewat localStorage + header). Tidak dijalankan CI.

Dulu openAttachment di web = window.open(path) → navigasi biasa yang hanya membawa cookie httpOnly `token`;
tanpa cookie server menjawab 401 {"detail":"Not authenticated"}. Kini web memakai AttachmentViewer in-app
(event tf-open-attachment, fetch dengan Authorization: Bearer, tanpa ?token= di URL).

Skenario: seed task deadline hari ini + unggah PNG kecil (multipart, Bearer) → buka app, hapus cookie →
prasyarat: GET download tanpa header = 401 → Fokus Hari Ini → buka task → tab Lampiran → klik lampiran →
viewer menampilkan <img> blob:, tidak ada tab/halaman baru, request download tanpa token= dan dengan
header Authorization → "✕ Tutup" menutup viewer.
Lampiran note (/api/scratchpad/attachments/{id}/view) tidak dicakup: unggahnya lewat Nextcloud (tidak ada
di lingkungan E2E); jalur kliknya sama (openAttachment) dan dicakup tes node attachment_viewer_web.test.js.

    E2E_PYTHON=/path/python-dengan-dependensi-webapp python3 temporary_files/e2e_attachment_open_web.py
"""
import base64
import os
import shutil
import subprocess
import sys
import tempfile

import requests
from playwright.sync_api import sync_playwright

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import e2e_focus_page as h  # harness: start_server, register, api, open_app, nav, check

check = h.check
TITLE = "Task berlampiran"
# PNG 1×1 transparan
PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==")


def main():
    tmp = tempfile.mkdtemp(prefix="e2e_attachment_open_web_")
    proc, base = h.start_server(tmp)
    print("server", base, flush=True)
    try:
        user = h.register(base, "lampi")
        _, task = h.api(base, user, "POST", "/api/tasks",
                        json={"title": TITLE, "priority": "P1", "gtd_status": "next", "deadline": h.today_iso()})
        r = requests.post(base + "/api/tasks/%d/attachments" % task["id"],
                          headers={"Authorization": "Bearer " + user["token"]},
                          files={"file": ("titik.png", PNG, "image/png")}, timeout=10)
        att = r.json() if r.ok else {}
        check("0 seed: task hari ini + lampiran PNG", r.ok and att.get("id"), "%d %s" % (r.status_code, r.text[:120]))
        dl_path = "/api/attachments/%d/download" % att["id"]
        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            ctx, p = h.open_app(browser, base, user, "light")
            try:
                run_flow(ctx, p, base, dl_path)
            finally:
                ctx.close()
            browser.close()
    except Exception as e:
        import traceback
        traceback.print_exc()
        check("exception", False, "%s: %s" % (type(e).__name__, e))
    finally:
        proc.terminate()
        try:
            proc.wait(10)
        except subprocess.TimeoutExpired:
            proc.kill()
        shutil.rmtree(tmp, ignore_errors=True)
    failed = [r for r in h.results if not r[1]]
    print("\n%d langkah, %d gagal" % (len(h.results), len(failed)))
    sys.exit(1 if failed else 0)


def run_flow(ctx, p, base, dl_path):
    # Kondisi Bapak: tidak ada cookie sama sekali; SPA tetap login lewat localStorage.tf_token.
    ctx.clear_cookies()
    check("1 cookie token dihapus", not any(c["name"] == "token" for c in ctx.cookies()), repr(ctx.cookies()))
    status = p.evaluate("(u) => fetch(u, { credentials: 'same-origin' }).then(r => r.status)", dl_path)
    check("2 prasyarat: navigasi/fetch tanpa header ke URL download = 401", status == 401, str(status))

    pages_before = len(ctx.pages)
    new_pages = []
    ctx.on("page", lambda pg: new_pages.append(pg))
    dl_reqs = []
    p.on("request", lambda rq: dl_reqs.append(rq) if "/api/attachments/" in rq.url and "/download" in rq.url else None)
    dl_resps = []
    p.on("response", lambda rs: dl_resps.append(rs.status) if "/api/attachments/" in rs.url and "/download" in rs.url else None)

    h.nav(p, "Fokus Hari Ini")
    row = p.locator(".ftask").filter(has_text=TITLE).first
    row.wait_for(state="visible", timeout=20000)
    row.locator(".ftask-title").click()
    tab = row.locator(".ftask-tab").filter(has_text="Lampiran").first
    tab.wait_for(state="visible", timeout=5000)
    tab.click()
    link = row.locator(".ftask-file-name").filter(has_text="titik.png").first
    link.wait_for(state="visible", timeout=10000)
    check("3 tab Lampiran menampilkan titik.png", link.is_visible())
    check("3b <a href> tetap relatif (klik tengah memakai cookie, tidak diubah)",
          link.get_attribute("href") == dl_path, link.get_attribute("href"))

    link.click()
    img = p.locator("img[alt='titik.png']")
    img.wait_for(state="visible", timeout=10000)
    src = img.get_attribute("src") or ""
    check("4 viewer in-app menampilkan <img> dengan src blob:", src.startswith("blob:"), src)
    check("5 tidak ada tab/halaman baru", not new_pages and len(ctx.pages) == pages_before,
          "baru=%d halaman=%d" % (len(new_pages), len(ctx.pages)))
    viewer_reqs = [rq for rq in dl_reqs if rq.url.endswith(dl_path)]
    check("6 request download tanpa token= di URL", dl_reqs and all("token=" not in rq.url for rq in dl_reqs),
          repr([rq.url for rq in dl_reqs]))
    auth = [rq.headers.get("authorization") for rq in viewer_reqs]
    check("7 request download membawa header Authorization: Bearer", any(a and a.startswith("Bearer ") for a in auth),
          repr(auth))
    check("8 respons download 200 (bukan 401)", 200 in dl_resps and 401 not in dl_resps, repr(dl_resps))
    check("9 header viewer: nama file + Simpan + Tutup",
          p.get_by_role("button", name="⬇ Simpan").count() == 1 and p.get_by_role("button", name="✕ Tutup").count() == 1)

    p.get_by_role("button", name="✕ Tutup").click()
    p.wait_for_timeout(300)
    check("10 ✕ Tutup menutup viewer", p.locator("img[alt='titik.png']").count() == 0
          and p.get_by_role("button", name="✕ Tutup").count() == 0)
    check("11 halaman Fokus tetap terbuka setelah Tutup", row.is_visible())


if __name__ == "__main__":
    main()
