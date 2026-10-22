"""E2E: lampirkan gambar lewat tombol 📎 editor note (bug 2026-10-22). Tidak dijalankan CI.

Alur:
  a  note → Edit → 📎 pilih PNG (upload ditahan 2,5 dtk) → indikator "Mengunggah …" tampil selama upload
  b  selesai → editor menampilkan <img> (bukan teks "![…](…)"), indikator hilang
  c  Simpan → isi tersimpan `![nama](/api/scratchpad/attachments/N/view)` tanpa backslash
  d  mode baca (note viewer) menampilkan <img> yang termuat (naturalWidth > 0)
  e  📎 file non-gambar (PDF) → tautan "📄 nama" (elemen <a>), bukan teks mentah
  f  upload gagal (500) → indikator hilang + toast galat, editor tidak berisi teks sampah

    python temporary_files/e2e_note_image_attach.py      (python sistem, bukan venv)
"""
import os
import re
import sys
import tempfile
import time

import requests
from playwright.sync_api import sync_playwright

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import e2e_note_list_tags as E  # noqa: E402  (server, register, open_app, go_notes, card, click_btn)

SHOTS = os.path.join(E.ROOT, "temporary_files", "e2e_note_image_attach")
results = []


def check(step, ok, note=""):
    results.append((step, bool(ok)))
    print(("PASS " if ok else "FAIL ") + step + (" — " + str(note) if note else ""), flush=True)


class FakeDav:
    """WebDAV tiruan minimal untuk Nextcloud (MKCOL / PUT / GET) di thread sendiri."""

    def __init__(self):
        import http.server
        import threading
        store = self.store = {}

        class H(http.server.BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def do_MKCOL(self):
                code = 405 if self.path in store else 201
                store.setdefault(self.path, None)
                self.send_response(code)
                self.end_headers()

            def do_PUT(self):
                n = int(self.headers.get("Content-Length") or 0)
                store[self.path] = (self.headers.get("Content-Type"), self.rfile.read(n))
                self.send_response(201)
                self.end_headers()

            def do_GET(self):
                v = store.get(self.path)
                if not v:
                    self.send_response(404)
                    self.end_headers()
                    return
                self.send_response(200)
                self.send_header("Content-Type", v[0] or "application/octet-stream")
                self.send_header("Content-Length", str(len(v[1])))
                self.end_headers()
                self.wfile.write(v[1])

        self.srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H)
        self.url = "http://127.0.0.1:%d" % self.srv.server_address[1]
        threading.Thread(target=self.srv.serve_forever, daemon=True).start()


def make_files(tmp):
    from PIL import Image
    png = os.path.join(tmp, "Gambar Uji 09_09_26.png")
    Image.new("RGB", (240, 120), (40, 160, 220)).save(png)
    pdf = os.path.join(tmp, "dokumen uji.pdf")
    with open(pdf, "wb") as fh:
        fh.write(b"%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Count 0/Kids[]>>endobj\n"
                 b"trailer<</Root 1 0 R>>\n%%EOF\n")
    big = os.path.join(tmp, "Foto Besar Liburan.png")
    Image.effect_noise((360, 280), 90).convert("RGB").save(big)  # ±250 KB: progres terlihat saat throttle
    return png, pdf, big


def throttle(ctx, p, on):
    """Batasi kecepatan unggah lewat CDP (tanpa memblokir loop Playwright seperti sleep di handler route)."""
    cdp = ctx.new_cdp_session(p)
    cdp.send("Network.enable")
    cdp.send("Network.emulateNetworkConditions", {"offline": False, "latency": 20 if on else 0,
             "downloadThroughput": -1, "uploadThroughput": 40_000 if on else -1})


def open_editor(p, title):
    E.card(p, title).click()
    p.locator(".notes-panel-actions").first.wait_for(timeout=15000)
    p.locator(".notes-panel-actions").first.get_by_text("Edit", exact=True).click()
    p.locator(".ProseMirror").first.wait_for(timeout=15000)
    p.wait_for_function("() => window.MilkdownBundle && document.querySelector('.ProseMirror[contenteditable=true]')",
                        timeout=15000)
    p.wait_for_timeout(2500)
    p.locator(".ProseMirror").first.click()
    p.keyboard.press("Control+End")


def attach(p, path):
    # input tersembunyi tombol 📎 (accept mencakup .pdf; input 🎬 media tidak)
    inp = p.locator("input[type=file][accept*='.pdf']").first
    inp.set_input_files(path)


def note_content(base, user, nid):
    r = requests.get(base + "/api/scratchpad/%d" % nid, headers={"Authorization": "Bearer " + user["token"]})
    return r.json().get("content") or ""


def main():
    os.makedirs(SHOTS, exist_ok=True)
    tmp = tempfile.mkdtemp(prefix="e2e_note_image_attach_")
    png, pdf, big = make_files(tmp)
    dav = FakeDav()
    os.environ.update(NEXTCLOUD_URL=dav.url, NEXTCLOUD_USER="uji", NEXTCLOUD_APP_PASSWORD="x")
    proc, base = E.start_server(tmp)  # start_server meneruskan os.environ ke uvicorn
    try:
        A = E.register(base, "Penulis")
        n = E.make_note(base, A, "Note Gambar E2E", "Isi awal catatan")
        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            ctx, p = E.open_app(browser, base, A)
            E.go_notes(p)
            E.card(p, "Note Gambar E2E").wait_for(timeout=20000)

            # a + b: unggah diperlambat (CDP) supaya indikator + persentase bisa diamati
            open_editor(p, "Note Gambar E2E")
            throttle(ctx, p, True)
            attach(p, big)
            status = p.locator(".note-upload-status")
            try:
                status.wait_for(state="visible", timeout=2000)
                txt = status.inner_text()
            except Exception:  # noqa: BLE001
                txt = ""
            check("a indikator 'Mengunggah … %' tampil selama upload",
                  "Mengunggah" in txt and "Foto Besar Liburan.png" in txt and re.search(r"\d+%", txt), txt.replace("\n", " "))
            p.screenshot(path=os.path.join(SHOTS, "a_uploading.png"))
            img = p.locator(".ProseMirror img[src*='/api/scratchpad/attachments/']")
            try:
                img.first.wait_for(state="attached", timeout=60000)
                ok_img = True
            except Exception:  # noqa: BLE001
                ok_img = False
            pm_text = p.locator(".ProseMirror").first.inner_text()
            check("b editor menampilkan <img>, bukan teks markdown", ok_img and "](/api" not in pm_text,
                  pm_text.replace("\n", " | ")[:160])
            check("b2 indikator hilang setelah selesai", status.count() == 0 or not status.first.is_visible())
            throttle(ctx, p, False)
            p.wait_for_timeout(600)
            p.screenshot(path=os.path.join(SHOTS, "b_editor.png"))

            # c: simpan → isi tersimpan
            E.click_btn(p, "Simpan")
            content = ""
            end = time.time() + 15
            while time.time() < end:
                content = note_content(base, A, n["id"])
                if "/api/scratchpad/attachments/" in content:
                    break
                p.wait_for_timeout(500)
            # `_` di teks alt boleh di-escape serializer (`09\_09`) — tetap markdown gambar yang sah
            ok_md = re.search(r"(?<!\\)!\[Foto Besar Liburan\.png\]\(/api/scratchpad/attachments/\d+/view\)", content)
            check("c isi tersimpan markdown gambar tanpa escape", bool(ok_md), repr(content[-120:]))

            # d: viewer
            vimg = p.locator(".notes-panel img[src*='attachments'], .note-viewer img[src*='attachments'], "
                             "[class*=note] img[src*='attachments']").first
            ok_view = False
            try:
                vimg.wait_for(state="attached", timeout=10000)
                ok_view = p.wait_for_function("el => el.complete && el.naturalWidth > 0", arg=vimg.element_handle(),
                                              timeout=10000) is not None
            except Exception as e:  # noqa: BLE001
                ok_view = False
            check("d note viewer menampilkan gambar termuat", ok_view)
            p.screenshot(path=os.path.join(SHOTS, "d_viewer.png"))

            # e: PDF → tautan
            open_editor(p, "Note Gambar E2E")
            attach(p, pdf)
            link = p.locator(".ProseMirror a", has_text="dokumen uji.pdf")
            try:
                link.first.wait_for(state="attached", timeout=15000)
                ok_link = True
            except Exception:  # noqa: BLE001
                ok_link = False
            pm_text = p.locator(".ProseMirror").first.inner_text()
            check("e PDF → tautan <a>, bukan teks markdown", ok_link and "](/api" not in pm_text,
                  pm_text.replace("\n", " | ")[-120:])

            # f: upload gagal
            ctx.route(re.compile(r".*/api/scratchpad/\d+/attachments$"),
                      lambda route, req: route.fulfill(status=500, content_type="application/json",
                                                       body='{"detail":"Upload gagal (uji)"}')
                      if req.method == "POST" else route.continue_())
            before = p.locator(".ProseMirror").first.inner_text()
            dialogs = []
            p.on("dialog", lambda d: (dialogs.append(d.message), d.dismiss()))
            attach(p, png)
            p.wait_for_timeout(2000)
            after = p.locator(".ProseMirror").first.inner_text()
            body = p.locator("body").inner_text()
            check("f gagal → tanpa alert, toast galat tampil, editor tidak berubah",
                  not dialogs and "Upload gagal" in body and before == after
                  and (status.count() == 0 or not status.first.is_visible()), dialogs)
            ctx.unroute(re.compile(r".*/api/scratchpad/\d+/attachments$"))
            E.click_btn(p, "Batal")

            # g: note lama yang sudah rusak (isi ter-escape dari bug lama) pulih saat dibuka di editor + disimpan
            H = {"Authorization": "Bearer " + A["token"]}
            n2 = E.make_note(base, A, "Note Rusak E2E", "Awal")
            with open(png, "rb") as fh:
                att = requests.post(base + "/api/scratchpad/%d/attachments" % n2["id"], headers=H,
                                    files={"file": ("ChatGPT Image Jul 22, 2026, 09_09_26 AM.png", fh, "image/png")}).json()
            broken = ("Awal\n\n!\\[ChatGPT Image Jul 22, 2026, 09\\_09\\_26 AM.png]\\(/api/scratchpad/attachments/%d/view)"
                      % att["id"])
            requests.put(base + "/api/scratchpad/%d" % n2["id"], headers=H,
                         json={"title": "Note Rusak E2E", "content": broken, "tags": []}).raise_for_status()
            p.goto(base + "/")
            p.locator(".sidebar-link").first.wait_for(state="attached", timeout=30000)
            E.go_notes(p)
            E.card(p, "Note Rusak E2E").wait_for(timeout=20000)
            open_editor(p, "Note Rusak E2E")
            gimg = p.locator(".ProseMirror img[src*='/api/scratchpad/attachments/%d/view']" % att["id"])
            ok_g = gimg.count() > 0
            check("g note rusak lama → editor menampilkan gambar", ok_g, p.locator(".ProseMirror").first.inner_text()[:120])
            p.keyboard.type(" x", delay=30)
            p.wait_for_timeout(700)
            E.click_btn(p, "Simpan")
            fixed = ""
            end = time.time() + 15
            while time.time() < end:
                fixed = note_content(base, A, n2["id"])
                if fixed != broken:
                    break
                p.wait_for_timeout(500)
            check("g2 setelah disimpan isi kembali markdown gambar",
                  bool(re.search(r"(?<!\\)!\[ChatGPT Image Jul 22, 2026, 09\\?_09\\?_26 AM\.png\]\(/api/scratchpad/attachments/%d/view\)"
                                 % att["id"], fixed)), repr(fixed[-140:]))

            # h: indikator di 375 px + tema gelap (tanpa scroll horizontal)
            p.goto(base + "/")
            p.locator(".sidebar-link").first.wait_for(state="attached", timeout=30000)
            E.go_notes(p)
            open_editor(p, "Note Gambar E2E")
            p.set_viewport_size({"width": 375, "height": 800})
            p.evaluate("() => document.documentElement.setAttribute('data-theme', 'dark')")
            p.wait_for_timeout(500)
            throttle(ctx, p, True)
            attach(p, big)
            try:
                status.wait_for(state="visible", timeout=2000)
                box = status.bounding_box()
                vw = p.evaluate("() => document.documentElement.clientWidth")
                ok_h = box is not None and box["x"] >= 0 and box["x"] + box["width"] <= vw + 1
                ok_h = ok_h and p.evaluate("() => document.documentElement.scrollWidth <= document.documentElement.clientWidth")
            except Exception:  # noqa: BLE001
                ok_h = False
            p.screenshot(path=os.path.join(SHOTS, "h_mobile_dark_uploading.png"))
            check("h indikator muat di 375 px (gelap), tanpa scroll horizontal", ok_h)
            p.wait_for_function("() => !document.querySelector('.note-upload-status')", timeout=60000)
            throttle(ctx, p, False)
            check("z tanpa pageerror", not p.errors, p.errors[:3])
            browser.close()
    finally:
        proc.kill()
    failed = [s for s, ok in results if not ok]
    print("\n%d/%d lulus" % (len(results) - len(failed), len(results)))
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
