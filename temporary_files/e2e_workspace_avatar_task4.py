"""Smoke Task 4: avatar workspace di rail/sidebar/judul (terang+gelap). Tidak dijalankan CI."""
import os, sys, tempfile, importlib.util
spec = importlib.util.spec_from_file_location("f0", os.path.join(os.path.dirname(__file__), "e2e_kelola_workspace_fase0.py"))
f0 = importlib.util.module_from_spec(spec); spec.loader.exec_module(f0)
from playwright.sync_api import sync_playwright
OUT = os.path.join(f0.ROOT, "temporary_files", "e2e_workspace_avatar_task4"); os.makedirs(OUT, exist_ok=True)
tmp = tempfile.mkdtemp()
proc, base = f0.start_server(tmp)
bad = []
try:
    A = f0.register(base, "avA", "Ana")
    ws = {}
    for k, nm, patch in [("a", "Proyek Alfa", {"description": "Deskripsi satu baris " * 8, "color_idx": 3}),
                         ("b", "Bintang", {"avatar": "🔥", "color_idx": 5}),
                         ("c", "Cetak <b>x</b>", {"avatar": "ab"})]:
        ws[k] = f0.api(base, A, "POST", "/api/lists", json={"name": nm})["id"]
        f0.api(base, A, "PATCH", "/api/lists/%d" % ws[k], json=patch)
        f0.api(base, A, "PUT", "/api/lists/%d/pin" % ws[k])
    with sync_playwright() as pw:
        br = pw.chromium.launch()
        for theme in ("light", "dark"):
            ctx, p = f0.open_app(br, base, A, theme)
            p.wait_for_timeout(1500)
            p.screenshot(path=f"{OUT}/{theme}_sidebar.png")
            n_rail = p.locator(".sidebar-rail-ws-avatar").count()
            n_side = p.locator(".sidebar-link .ws-avatar").count()
            texts = p.locator(".sidebar-link .ws-avatar").all_inner_texts()
            print(theme, "rail", n_rail, "side", n_side, texts)
            if n_side != 3 or "🔥" not in texts or "AB" not in texts: bad.append(theme + " sidebar")
            p.locator("button[title='Proyek Alfa']").first.click()
            p.locator(".ws-page-desc").wait_for(timeout=8000)
            h1 = p.locator("h1 .ws-avatar")
            print(theme, "title avatar", h1.count(), p.locator(".ws-page-desc").inner_text()[:30],
                  p.locator(".ws-page-desc").evaluate("e => e.scrollWidth > e.clientWidth && getComputedStyle(e).textOverflow"))
            if h1.count() != 1: bad.append(theme + " title")
            p.screenshot(path=f"{OUT}/{theme}_page.png")
            p.locator("button[title='Bintang']").first.click()
            p.wait_for_timeout(600)
            if p.locator(".ws-page-desc").count() != 0: bad.append(theme + " desc shown when empty")
            if p.locator("h1 .ws-avatar").inner_text() != "🔥": bad.append(theme + " emoji title")
            p.screenshot(path=f"{OUT}/{theme}_page_emoji.png")
            ctx.close()
        br.close()
finally:
    proc.kill()
print("BAD:", bad); sys.exit(1 if bad else 0)
