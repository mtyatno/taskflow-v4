"""Task 5 tema-fondasi: bandingkan computed style aturan yang diubah (app.css lama vs kerja), mode terang & gelap.

Pakai: python3 temporary_files/tema_cek_computed.py [REF]   (REF bawaan: b1ab7df = sebelum Task 5)
Elemen sintetis mencakup setiap selektor yang disentuh Task 5; :hover diganti kelas .__h (transisi dimatikan) agar
keadaan hover bisa dibaca. Keluaran: daftar DIFF; yang diharapkan hanya pemetaan selisih ≤ 3 (lihat task-5-report).
"""
import subprocess, sys
from playwright.sync_api import sync_playwright
REF = sys.argv[1] if len(sys.argv) > 1 else "b1ab7df"
DOM = """
<input class="input" id="e-input"><select class="input" id="e-select"><option>a</option></select>
<div class="modal-content scale-in" id="e-modal">m</div>
<div class="task-row" id="e-taskrow">t</div>
<div class="mobile-topbar" id="e-mtop" style="display:flex">x</div>
<div class="sidebar" id="e-sidebar">
  <div class="sidebar-link" id="e-slink">l</div><div class="sidebar-section" id="e-ssec">s</div>
  <button class="sidebar-rail-btn" id="e-rbtn">b</button><button class="sidebar-rail-btn sidebar-rail-expand" id="e-rexp">e</button><div class="sidebar-rail-divider" id="e-rdiv"></div>
  <div class="sidebar-rail-ctx" id="e-ctx"><button id="e-ctxbtn">Buka</button></div>
</div>
<div class="stat-card" id="e-stat">s</div><div class="eisenhower-cell" id="e-eis">e</div>
<span class="tag-pill active" id="e-tpa">a<span class="tag-count" id="e-tpac">1</span></span>
<span class="tag-pill" id="e-tp">b<span class="tag-count" id="e-tpc">2</span></span>
<span class="note-tag-untagged" id="e-untag">u</span>
<span class="admin-email-chip admin-email-chip-muted" id="e-chipm">m</span>
<div class="chat-bubble" id="e-bub"><div class="chat-quote-block" id="e-quote">q</div><div class="chat-task-card" id="e-ctc">c</div></div>
<div class="center-hud-toast" id="e-hud">h</div>
<div class="img-resize-toolbar" id="e-irt"><button id="e-irtb">x</button></div>
<div class="note-rendered" id="e-nr"><table><tr><th id="e-th">h</th></tr><tr><td id="e-td1">a</td></tr><tr><td id="e-td2">b</td></tr></table>
  <details id="e-det"><summary>s</summary>x</details></div>
<div class="milkdown-editor"><div class="ProseMirror"><pre id="e-pre"><code id="e-precode">x</code></pre><code id="e-code">c</code><table><tr><th id="e-pmth">h</th></tr></table></div></div>
<span class="tasklink-node-fallback" id="e-tlf">f</span>
<div class="milkdown-slash-menu" id="e-slash">s</div><div class="milkdown-tooltip" id="e-tt">t</div>
<div class="dash" id="e-dash"><span class="dash-delta" id="e-ddelta">1</span><div class="dash-kpi" id="e-dkpi">k</div><div class="dash-date" id="e-ddate">d</div>
  <svg><circle class="dash-ring-track" id="e-ring" r="5" cx="5" cy="5"></circle></svg></div>
<div class="note-code-header" id="e-nch">x</div>
<div class="habit-heatmap-cell" id="e-hh">x</div><div class="habit-mini-cell" id="e-hm">x</div>
<div class="focus-mini-anchor is-active" id="e-fma"></div>
<div class="ftask" id="e-ftask"><span class="ftask-sub-box" id="e-fsb"></span></div>
<button class="topbar-pomo-btn" id="e-tpb">p</button>
<div class="gtd-wizard-desc" id="e-gwd">d</div>
<span class="cmt-badge is-unread" id="e-cbu">1</span><span class="cmt-badge" id="e-cb">2</span>
<div class="focus-filter-time"><button id="e-fftb"><span class="n" id="e-ffn">3</span></button><button aria-pressed="true"><span class="n" id="e-ffnp">3</span></button></div>
<button class="focus-filter-btn" id="e-ffbtn">f</button><button class="focus-filter-chip" id="e-ffchip">c</button>
<span class="whatsnew-date" id="e-wnd">d</span>
"""
PROPS = ["color", "background-color", "background-image", "border-top-color", "border-right-color", "border-bottom-color", "border-left-color", "box-shadow", "stroke", "outline-color"]
PSEUDO = {"e-hh": "::after", "e-hm": "::after", "e-fma": "::before"}
HOVER = ["e-taskrow", "e-slink", "e-rbtn", "e-rexp", "e-ctxbtn", "e-tpa", "e-tp", "e-irtb", "e-ftask", "e-tpb", "e-ffbtn", "e-ffchip", "e-untag"]
def snap(page, theme, css):
    page.set_content(f"<!doctype html><html data-theme='{theme}'><head><style>{css}</style><style>*,*::before,*::after{{transition:none!important;animation:none!important}}</style></head><body>{DOM}</body></html>")
    out = {}
    ids = page.eval_on_selector_all("[id^=e-]", "els => els.map(e => e.id)")
    for i in ids + ["BODY"]:
        sel = "body" if i == "BODY" else "#" + i
        for hov in ([False, True] if i in HOVER else [False]):
            if hov:
                page.evaluate("s => document.querySelector(s).classList.add('__h')", sel)
            vals = page.evaluate("([s,p,props]) => { const cs = getComputedStyle(document.querySelector(s), p||null); return props.map(k => cs.getPropertyValue(k)); }", [sel, PSEUDO.get(i), PROPS])
            out[f"{theme}:{i}{':hover' if hov else ''}"] = dict(zip(PROPS, vals))
            if hov:
                page.evaluate("s => document.querySelector(s).classList.remove('__h')", sel)
    return out
with sync_playwright() as pw:
    b = pw.chromium.launch(); pg = b.new_page()
    old_css = subprocess.run(["git", "show", f"{REF}:static/app.css"], capture_output=True, text=True, check=True).stdout.replace(":hover", ".__h")
    new_css = open("static/app.css", encoding="utf-8").read().replace(":hover", ".__h")
    for th in ["light", "dark"]:
        o = snap(pg, th, old_css); n = snap(pg, th, new_css)
        for k in o:
            for p in PROPS:
                if o[k][p] != n[k][p]:
                    print(f"DIFF {k} {p}: {o[k][p]}  ->  {n[k][p]}")
    print("checked", len(o)*2, "element-states x", len(PROPS), "props")
    b.close()
