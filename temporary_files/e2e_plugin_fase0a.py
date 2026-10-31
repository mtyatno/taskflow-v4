"""E2E sistem plugin Fase 0a (spec docs/superpowers/specs/2026-10-29-plugin-fase0a-design.md §11.3 langkah 1–7).
Tidak dijalankan CI.

    python3 temporary_files/e2e_plugin_fase0a.py

Server uvicorn lokal + DB sementara + Chromium (Playwright), SW diizinkan (langkah 5 butuh precache). Seed memakai
e2e_hero_dashboard.seed (6 task, 4 habit) + log tambahan supaya hari ini BUKAN tingkat tertinggi:
  d-3: 4 habit done; d-2: 2; d-1: 1; hari ini: 1 → tingkat hari ini 1 (25%); setelah check-in satu habit lagi → 2 (50%).
"""
import datetime
import os
import re
import shutil
import sys
import tempfile
import subprocess

from playwright.sync_api import TimeoutError as PwTimeout, sync_playwright

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import e2e_hero_dashboard as hd  # noqa: E402

ROOT = hd.ROOT
SHOTS = os.path.join(ROOT, "temporary_files", "e2e_plugin_fase0a")
PID = "habit-heatmap"
NAME = "Heatmap Habit"
SWITCH = '[role=switch][aria-labelledby="plugin-name-%s"]' % PID
CARD = ".dash-plugins .plg-heatmap"
TODAY_RECT = CARD + " rect.plg-heatmap-today"
CRASH_TEXT = "Terjadi kesalahan pada tampilan"

check = hd.check
plugin_reqs = []      # request halaman (bukan SW) ke plugin.js
console_log = []      # (type, text)


def seed_extra(base, user):
    habits = {h["title"]: h["id"] for h in hd.api(base, user, "GET", "/api/habits")}
    d = lambda n: (datetime.date.today() - datetime.timedelta(days=n)).isoformat()
    for t in habits:
        hd.api(base, user, "POST", "/api/habits/%s/checkin" % habits[t], json={"status": "done", "date": d(3)})
    hd.api(base, user, "POST", "/api/habits/%s/checkin" % habits["Minum air putih"], json={"status": "done", "date": d(2)})


def shot(p, name):
    os.makedirs(SHOTS, exist_ok=True)
    p.screenshot(path=os.path.join(SHOTS, name), animations="disabled", caret="hide")


def nav(p, label):
    link = p.locator(".sidebar-link").filter(has_text=label).first
    if not link.is_visible():
        top = p.locator(".mobile-topbar button")
        if top.count() and top.first.is_visible():
            top.first.click()
            p.wait_for_timeout(500)
        elif p.locator("button[aria-label='Tampilkan semua menu']").count():
            p.locator("button[aria-label='Tampilkan semua menu']").first.click()
    link.click()


def open_settings(p):
    nav(p, "Pengaturan")
    p.get_by_text("Fitur opsional. Status disimpan di perangkat ini.").wait_for(state="visible", timeout=20000)
    p.locator(SWITCH).scroll_into_view_if_needed()


def open_dashboard(p):
    nav(p, "Dashboard")
    p.locator(".dash-hero-greet").wait_for(state="visible", timeout=20000)
    p.wait_for_timeout(800)


def plugin_row(p):
    return p.locator(".theme-card-decor").filter(has=p.locator(SWITCH)).first


def wait_toast(p, text, timeout=8000):
    try:
        p.get_by_text(text, exact=True).first.wait_for(state="visible", timeout=timeout)
        return True
    except PwTimeout:
        return False


def today_fill(p):
    return p.evaluate("""sel => { const r = document.querySelector(sel); if (!r) return null;
        return { attr: r.getAttribute('fill'), computed: getComputedStyle(r).fill, title: r.textContent }; }""", TODAY_RECT)


def cell_fills(p):
    """Fill terhitung per tingkat (atribut 0/25/50/75/100%) dari sel di kartu."""
    return p.evaluate("""sel => { const out = {};
        for (const r of document.querySelectorAll(sel + ' rect')) { const a = r.getAttribute('fill') || '';
          const m = a.match(/(\\d+)%/); if (m && !(m[1] in out)) out[m[1]] = getComputedStyle(r).fill; }
        return out; }""", CARD)


def no_crash(p):
    return p.get_by_text(CRASH_TEXT).count() == 0


def run(browser, base, user):
    ctx = browser.new_context(service_workers="allow", viewport=hd.DESKTOP, timezone_id="Asia/Jakarta",
                              reduced_motion="reduce")
    # CDN/font eksternal diblokir proxy sandbox: batalkan langsung supaya tidak menggantung.
    ctx.route(re.compile(r"^(?!%s/)" % re.escape(base)), lambda route: route.abort())
    ctx.add_cookies([{"name": "token", "value": user["token"], "url": base, "httpOnly": True, "sameSite": "Lax"}])
    p = ctx.new_page()
    p.on("dialog", lambda d: d.accept())
    p.on("request", lambda r: plugin_reqs.append(r.url) if "/static/plugins/%s/plugin.js" % PID in r.url else None)
    p.on("console", lambda m: console_log.append((m.type, m.text)))
    p.on("pageerror", lambda e: console_log.append(("pageerror", str(e))))
    p.goto(base + "/manifest.json")
    p.evaluate("""([t, u, tours, sw]) => {
        localStorage.setItem('tf_token', t); localStorage.setItem('tf_user_id', String(u));
        for (const pg of tours) localStorage.setItem('tf_tour_' + pg, '1');
        localStorage.setItem('tf_whatsnew_seen', sw); localStorage.setItem('tf_theme', 'light');
        localStorage.setItem('tf_dismiss_onboarding', '1'); localStorage.setItem('tf_shortcut_hint', '1');
    }""", [user["token"], user["id"], hd.TOURS, hd.sw_version()])
    p.goto(base + "/")
    hd.wait_dashboard_ready(p)
    try:
        # ── 2 (dulu, sebelum Pengaturan): Dashboard saat OFF ──
        ok2 = (len(plugin_reqs) == 0 and p.locator(".dash-plugins").count() == 0
               and p.locator('script[src*="/static/plugins/"]').count() == 0)
        check("2 Dashboard OFF: tanpa request plugin.js, tanpa wadah .dash-plugins", ok2,
              "req=%d wadah=%d" % (len(plugin_reqs), p.locator(".dash-plugins").count()))

        # ── 1: Pengaturan › Plugin ──
        open_settings(p)
        row = plugin_row(p)
        rtxt = row.inner_text()
        sw_ = p.locator(SWITCH)
        ok1 = (NAME in rtxt and "Bawaan" in rtxt and "Belum dimuat" in rtxt
               and sw_.get_attribute("aria-checked") == "false" and sw_.get_attribute("title") == "Nonaktif")
        check("1 Pengaturan › Plugin: 'Heatmap Habit', Nonaktif, Belum dimuat", ok1, repr(rtxt.replace("\n", " | ")))
        shot(p, "1-settings-off.png")
        check("2b masih tanpa request plugin.js setelah membuka Pengaturan", len(plugin_reqs) == 0, str(plugin_reqs))

        # ── 3: aktifkan ──
        sw_.click()
        t3 = wait_toast(p, "Plugin %s diaktifkan" % NAME)
        on = sw_.get_attribute("aria-checked") == "true"
        check("3a toast 'Plugin Heatmap Habit diaktifkan', switch aria-checked=true", t3 and on)
        p.evaluate("() => { window.__e2eNoReload = 1; }")
        open_dashboard(p)
        try:
            p.locator(CARD).wait_for(state="visible", timeout=15000)
            p.wait_for_function("sel => document.querySelectorAll(sel + ' rect').length > 300", arg=CARD, timeout=10000)
            card = True
        except PwTimeout:
            card = False
        title = p.locator(CARD + " .dash-card-title").first.inner_text() if card else ""
        check("3b Dashboard menampilkan kartu 'Heatmap' tanpa reload", card and title == "Heatmap"
              and p.evaluate("() => window.__e2eNoReload") == 1, repr(title))
        p.wait_for_timeout(500)
        check("3c plugin.js diminta sekali", len(plugin_reqs) == 1, str(plugin_reqs))
        summary = p.locator(CARD + " .plg-heatmap-summary").inner_text() if card else ""
        print("  ringkasan:", summary, flush=True)
        shot(p, "3-dashboard-on.png")

        # ── 4: check-in habit di Dashboard ──
        before = today_fill(p)
        btn = p.locator("button.dash-hero-habit").first
        hname = btn.locator(".dash-hero-habit-name").inner_text().strip()
        btn.click()
        try:
            p.wait_for_function("([sel, a]) => { const r = document.querySelector(sel); return r && r.getAttribute('fill') !== a; }",
                                arg=[TODAY_RECT, before and before["attr"]], timeout=10000)
        except PwTimeout:
            pass
        after = today_fill(p)
        ok4 = (before and after and before["attr"] != after["attr"] and before["computed"] != after["computed"]
               and p.evaluate("() => window.__e2eNoReload") == 1)
        check("4 check-in '%s' → sel hari ini naik tingkat tanpa reload" % hname, ok4,
              "%s → %s" % (before and (before["attr"], before["title"]), after and (after["attr"], after["title"])))
        m = re.search(r"(\d+)%", (before or {}).get("attr") or ""), re.search(r"(\d+)%", (after or {}).get("attr") or "")
        if m[0] and m[1]:
            check("4b tingkat naik (persen lebih besar)", int(m[1].group(1)) > int(m[0].group(1)),
                  "%s%% → %s%%" % (m[0].group(1), m[1].group(1)))

        # ── 1.1: ringkasan + legenda ──
        foot = p.evaluate("""sel => { const c = document.querySelector(sel); const lg = c && c.querySelector('.plg-heatmap-legend');
            const sv = c && c.querySelector('svg');
            return { summary: c && c.querySelector('.plg-heatmap-summary').textContent, legend: lg && lg.textContent,
                     legendCells: lg ? lg.querySelectorAll('.plg-heatmap-legend-cell').length : 0,
                     aria: sv && sv.getAttribute('aria-label') }; }""", CARD)
        ok_foot = (re.fullmatch(r"Streak \d+ hari · Terpanjang \d+ hari · \d+ hari aktif dari 365", foot["summary"] or "") is not None
                   and foot["legend"] == "SedikitBanyak" and foot["legendCells"] == 5
                   and re.fullmatch(r"Heatmap habit, \d+ hari aktif", foot["aria"] or "") is not None)
        check("1.1a ringkasan 'Streak · Terpanjang · aktif', legenda Sedikit/5 kotak/Banyak, aria-label svg", ok_foot, repr(foot))

        # ── 1.1: 1660 px — grid mengisi lebar kartu ──
        p.set_viewport_size({"width": 1660, "height": 1000})
        p.wait_for_timeout(800)
        wide = p.evaluate("""sel => { const c = document.querySelector(sel); const cs = getComputedStyle(c);
            const content = c.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
            const sv = c.querySelector('svg').getBoundingClientRect(); const r = c.querySelector('rect').getBoundingClientRect();
            const xs = [...new Set([...c.querySelectorAll('rect')].map(x => +x.getAttribute('x')))].sort((a, b) => a - b);
            const gap = xs[1] - xs[0] - +c.querySelector('rect').getAttribute('width');
            const s = c.querySelector('.plg-heatmap-scroll'); const de = document.documentElement;
            const lg = c.querySelector('.plg-heatmap-legend').getBoundingClientRect();
            const sm = c.querySelector('.plg-heatmap-summary').getBoundingClientRect();
            return { content, svgW: sv.width, cell: r.width, gap, scrollSW: s.scrollWidth, scrollCW: s.clientWidth,
                     docSW: de.scrollWidth, docCW: de.clientWidth, legendRight: lg.right, cardRight: c.getBoundingClientRect().right
                       - parseFloat(cs.paddingRight) - parseFloat(cs.borderRightWidth), sameRow: Math.abs(lg.top - sm.top) < 8 }; }""", CARD)
        ok1660 = (wide["svgW"] >= 0.9 * wide["content"] and 11 <= wide["cell"] <= 26.01 and 2 <= wide["gap"] <= 4
                  and wide["scrollSW"] <= wide["scrollCW"] and wide["docSW"] <= wide["docCW"]
                  and wide["sameRow"] and abs(wide["legendRight"] - wide["cardRight"]) < 2)
        check("1.1b 1660px: lebar svg ≥ 90%% konten kartu, kotak 11–26, gap ≤ 4 px, tanpa scroll, legenda kanan sejajar ringkasan", ok1660,
              repr(wide))
        p.locator(CARD).scroll_into_view_if_needed()
        shot(p, "1660-dashboard.png")
        p.locator(CARD).screenshot(path=os.path.join(SHOTS, "1660-card.png"), animations="disabled")

        # ── 375 px ──
        p.set_viewport_size(hd.MOBILE)
        p.wait_for_timeout(800)
        info = p.evaluate("""sel => { const c = document.querySelector(sel); const s = c && c.querySelector('.plg-heatmap-scroll');
            const de = document.documentElement; const r = c && c.getBoundingClientRect();
            return { docSW: de.scrollWidth, docCW: de.clientWidth, cardRight: r && r.right, cardW: r && r.width,
                     scrollSW: s && s.scrollWidth, scrollCW: s && s.clientWidth, overflowX: s && getComputedStyle(s).overflowX,
                     cols: c && new Set([...c.querySelectorAll('rect')].map(x => x.getAttribute('x'))).size }; }""", CARD)
        ok375 = info["docSW"] <= info["docCW"] and info["cardRight"] <= info["docCW"] + 0.5 and info["cols"] == 26
        check("375px kartu tidak meluber (scroll internal OK), 26 kolom", ok375, repr(info))
        p.locator(CARD).scroll_into_view_if_needed()
        shot(p, "375-dashboard.png")
        p.locator(CARD).screenshot(path=os.path.join(SHOTS, "375-card.png"), animations="disabled")
        p.set_viewport_size(hd.DESKTOP)
        p.wait_for_timeout(500)

        # ── 5: offline + reload ──
        sw_state = p.evaluate("""async () => { const reg = await Promise.race([navigator.serviceWorker.ready,
                new Promise(r => setTimeout(() => r(null), 30000))]);
            for (let i = 0; i < 60 && !navigator.serviceWorker.controller; i++) await new Promise(r => setTimeout(r, 500));
            const keys = await caches.keys(); let hit = null;
            for (let i = 0; i < 60 && !hit; i++) { hit = await caches.match(new Request('/static/plugins/habit-heatmap/plugin.js?v=' +
                (await (await fetch('/static/plugins/index.json')).json()).plugins[0].hash)); if (!hit) await new Promise(r => setTimeout(r, 500)); }
            return { active: !!(reg && reg.active), controller: !!navigator.serviceWorker.controller, keys, precached: !!hit }; }""")
        print("  SW:", sw_state, flush=True)
        check("5a SW aktif + plugin.js di precache", sw_state["active"] and sw_state["precached"], repr(sw_state))
        reqs_before = len(plugin_reqs)
        ctx.set_offline(True)
        try:
            p.reload()
            p.locator(".dash-hero-greet").wait_for(state="visible", timeout=30000)
            try:
                p.locator(CARD).wait_for(state="visible", timeout=15000)
                card_off = True
            except PwTimeout:
                card_off = False
            check("5b offline + reload → kartu Heatmap tetap tampil (precache)",
                  card_off and p.evaluate("() => navigator.onLine") is False,
                  "plugin.js diminta %d× setelah reload (dilayani SW)" % (len(plugin_reqs) - reqs_before))
            shot(p, "5-offline-dashboard.png")
            open_settings(p)
            sw_ = p.locator(SWITCH)
            loaded_txt = plugin_row(p).inner_text()
            sw_.click()
            t_off = wait_toast(p, "Plugin %s dinonaktifkan" % NAME)
            off_ok = sw_.get_attribute("aria-checked") == "false"
            open_dashboard(p)
            gone = p.locator(".dash-plugins").count() == 0
            open_settings(p)
            p.locator(SWITCH).click()
            t_on = wait_toast(p, "Plugin %s diaktifkan" % NAME)
            on_ok = p.locator(SWITCH).get_attribute("aria-checked") == "true"
            open_dashboard(p)
            try:
                p.locator(CARD).wait_for(state="visible", timeout=10000)
                back = True
            except PwTimeout:
                back = False
            check("5c offline: toggle OFF (toast, kartu hilang) lalu ON (toast, kartu kembali)",
                  t_off and off_ok and gone and t_on and on_ok and back,
                  "row='%s' off=%s/%s hilang=%s on=%s/%s kembali=%s" % (loaded_txt.replace("\n", " | ")[:80], t_off, off_ok,
                                                                       gone, t_on, on_ok, back))
        finally:
            ctx.set_offline(False)

        # ── 6: Sakura + gelap ──
        p.wait_for_function("sel => document.querySelectorAll(sel + ' rect').length > 300", arg=CARD, timeout=10000)
        p.wait_for_timeout(500)
        f_def = cell_fills(p)
        open_settings(p)
        p.get_by_role("group", name="Palet").get_by_role("button").filter(has_text="Sakura").click()
        p.get_by_role("radiogroup", name="Mode").get_by_role("radio", name="Gelap").click()
        p.wait_for_function("() => document.documentElement.getAttribute('data-palette') === 'sakura'"
                            " && document.documentElement.getAttribute('data-theme') === 'dark'", timeout=5000)
        open_dashboard(p)
        p.locator(CARD).wait_for(state="visible", timeout=10000)
        p.wait_for_timeout(500)
        f_sak = cell_fills(p)
        changed = [k for k in f_def if k in f_sak and f_def[k] != f_sak[k]]
        check("6 Sakura + gelap → warna sel berubah (computed fill)", len(changed) >= 2 and len(changed) == len([k for k in f_def if k in f_sak]),
              "default=%r sakura-gelap=%r" % (f_def, f_sak))
        shot(p, "6-sakura-dark.png")

        # Error console dari runtime/plugin selama skenario normal (1–6).
        bad = [(t, x) for t, x in console_log if t in ("error", "pageerror", "warning")
               and re.search(r"plugin|heatmap", x, re.I)]
        check("console: tanpa error/peringatan runtime/plugin di skenario normal", not bad, repr(bad[:5]))
        errs_all = [(t, x[:140]) for t, x in console_log if t in ("error", "pageerror")]
        print("  (semua error console, info: %d) %r" % (len(errs_all), errs_all[:6]), flush=True)

        # ── 7: _debugThrow dua kali ──
        n0 = len(console_log)
        p.evaluate("() => TF.plugins._debugThrow('habit-heatmap')")
        t71 = wait_toast(p, "Plugin %s mengalami error" % NAME, 5000)
        p.wait_for_timeout(400)
        still_on = p.evaluate("() => TF.plugins.isEnabled('habit-heatmap')")
        p.evaluate("() => TF.plugins._debugThrow('habit-heatmap')")
        t72 = wait_toast(p, "Plugin %s dimatikan karena error" % NAME, 5000)
        p.wait_for_timeout(400)
        off7 = p.evaluate("() => TF.plugins.isEnabled('habit-heatmap')") is False
        check("7a dua error render → plugin OFF + toast 'dimatikan karena error'",
              t71 and still_on and t72 and off7 and p.locator(".dash-plugins").count() == 0,
              "toast1=%s on-setelah-1=%s toast2=%s off=%s" % (t71, still_on, t72, off7))
        check("7b tanpa layar crash AppErrorBoundary", no_crash(p) and p.locator(".dash-hero-greet").count() == 1)
        shot(p, "7-after-errors.png")
        open_settings(p)
        again = plugin_row(p).get_by_role("button", name="Aktifkan lagi")
        has_again = again.count() == 1 and plugin_row(p).get_by_role("button", name="Salin detail").count() == 1
        check("7c Pengaturan menampilkan 'Aktifkan lagi' (+ 'Salin detail')", has_again,
              repr(plugin_row(p).inner_text().replace("\n", " | ")))
        shot(p, "7-settings-error.png")
        if has_again:
            again.click()
            t_re = wait_toast(p, "Plugin %s diaktifkan" % NAME)
            open_dashboard(p)
            try:
                p.locator(CARD).wait_for(state="visible", timeout=10000)
                back = True
            except PwTimeout:
                back = False
            check("7d 'Aktifkan lagi' → toast + kartu kembali", t_re and back)
        print("  console selama langkah 7: %r" % [(t, x[:100]) for t, x in console_log[n0:] if t in ("error", "warning")][:6],
              flush=True)
    finally:
        ctx.close()


def main():
    shutil.rmtree(SHOTS, ignore_errors=True)
    tmp = tempfile.mkdtemp(prefix="e2e_plugin_fase0a_")
    proc, base = hd.start_server(tmp)
    print("server", base, flush=True)
    try:
        user = hd.seed(base, username="plugin", display_name="Rani")
        seed_extra(base, user)
        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            run(browser, base, user)
            browser.close()
    finally:
        proc.terminate()
        try:
            proc.wait(10)
        except subprocess.TimeoutExpired:
            proc.kill()
        shutil.rmtree(tmp, ignore_errors=True)
    failed = [r for r in hd.results if not r[1]]
    print("\n%d/%d cek lolos" % (len(hd.results) - len(failed), len(hd.results)), flush=True)
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
