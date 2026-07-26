import io, sys
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

# ── 1. Fix CSS: no flex-wrap on toolbar (now in static/app.css) ─────────────
old_css = '.note-toolbar { display: flex; gap: 2px; flex-wrap: wrap; align-items: center; margin-bottom: 6px; }'
new_css = '.note-toolbar { display: flex; gap: 2px; flex-wrap: nowrap; align-items: center; margin-bottom: 6px; overflow: visible; }'

with open('static/app.css', encoding='utf-8') as f:
    css = f.read()
if old_css in css:
    css = css.replace(old_css, new_css, 1)
    with open('static/app.css', 'w', encoding='utf-8') as f:
        f.write(css)
    print('CSS nowrap: OK')
else:
    print('ERROR: toolbar CSS not found')

# ── 2. Read index.html for JS patches ──────────────────────────────────────
with open('static/index.html', encoding='utf-8') as f:
    h = f.read()

# ── 3. Add moreOpen state + ref after hOpen state ────────────────────────────
old_state = '      const [hOpen, setHOpen] = React.useState(false);\n      const hRef = React.useRef(null);'
new_state = ('      const [hOpen, setHOpen] = React.useState(false);\n'
             '      const hRef = React.useRef(null);\n'
             '      const [moreOpen, setMoreOpen] = React.useState(false);\n'
             '      const moreRef = React.useRef(null);')
if old_state in h:
    h = h.replace(old_state, new_state, 1)
    print('moreOpen state: OK')
else:
    print('ERROR: hOpen state not found')

# ── 3. Add useEffect for moreOpen click-outside after hOpen useEffect ────────
old_effect = ('      React.useEffect(() => {\n'
              '        if (!hOpen) return;\n'
              '        const close = (e) => { if (hRef.current && !hRef.current.contains(e.target)) setHOpen(false); };\n'
              '        document.addEventListener("mousedown", close);\n'
              '        return () => document.removeEventListener("mousedown", close);\n'
              '      }, [hOpen]);')
new_effect = (old_effect + '\n'
              '      React.useEffect(() => {\n'
              '        if (!moreOpen) return;\n'
              '        const close = (e) => { if (moreRef.current && !moreRef.current.contains(e.target)) setMoreOpen(false); };\n'
              '        document.addEventListener("mousedown", close);\n'
              '        return () => document.removeEventListener("mousedown", close);\n'
              '      }, [moreOpen]);')
if old_effect in h:
    h = h.replace(old_effect, new_effect, 1)
    print('moreOpen useEffect: OK')
else:
    print('ERROR: hOpen useEffect not found')

# ── 4. Remove the 4 overflow buttons + their separators from primary row ─────
# These 4 buttons are currently between the blockquote group and HR:
# sep | 1. S | sep | ⊞ [[]] | sep | — (HR)
# We keep the last sep + — (HR), remove the two groups before it

old_overflow = (
    '          <div className="sep"/>\n'
    '          <button onClick={() => insertLinePrefix("1. ")} title="Numbered list" style={{ fontSize: 12, fontWeight: 700 }}>1.</button>\n'
    '          <button onClick={() => insert("~~", "~~", "teks")} title="Strikethrough" style={{ textDecoration: "line-through", fontSize: 13 }}>S</button>\n'
    '          <div className="sep"/>\n'
    '          <button onClick={() => { const el = textareaRef.current; if (!el) return; const s = el.selectionStart; const row1 = "| Kolom 1 | Kolom 2 | Kolom 3 |"; const row2 = "|---------|---------|---------|"; const row3 = "|  |  |  |"; const tbl = "\\n" + row1 + "\\n" + row2 + "\\n" + row3 + "\\n"; const newVal = value.slice(0,s) + tbl + value.slice(s); onChange(newVal); setTimeout(() => { el.focus(); el.setSelectionRange(s+tbl.length,s+tbl.length); },0); }} title="Insert table" style={{ fontSize: 13 }}>&#x229E;</button>\n'
    '          <button onClick={() => insert("[[", "]]", "judul note")} title="Internal link [[wiki]]" style={{ fontSize: 11, fontWeight: 700 }}>[[]]</button>\n'
    '          <div className="sep"/>\n'
    '          <button onClick={() => { const el = textareaRef.current; if (!el) return; const s = el.selectionStart; const nl = String.fromCharCode(10); const newVal = value.slice(0,s) + nl + "---" + nl + value.slice(s); onChange(newVal); setTimeout(() => { el.focus(); el.setSelectionRange(s+5,s+5); },0); }} title="Horizontal rule" style={{ fontSize: 13, letterSpacing: -1 }}>—</button>'
)

new_overflow = (
    '          <div className="sep"/>\n'
    '          {/* More dropdown */}\n'
    '          <div ref={moreRef} style={{ position: "relative", flexShrink: 0 }}>\n'
    '            <button onClick={() => setMoreOpen(o => !o)} title="Format lainnya"\n'
    '              style={{ fontWeight: 700, fontSize: 14, color: moreOpen ? "var(--accent)" : undefined,\n'
    '                       borderColor: moreOpen ? "var(--accent)" : undefined }}>+</button>\n'
    '            {moreOpen && (\n'
    '              <div style={{ position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 300,\n'
    '                background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 10,\n'
    '                boxShadow: "0 6px 24px rgba(0,0,0,0.15)", display: "flex", alignItems: "center",\n'
    '                gap: 2, padding: "6px 8px", flexWrap: "nowrap" }}>\n'
    '                <button onClick={() => { insertLinePrefix("1. "); setMoreOpen(false); }} title="Numbered list" style={{ fontSize: 12, fontWeight: 700 }}>1.</button>\n'
    '                <button onClick={() => { insert("~~", "~~", "teks"); setMoreOpen(false); }} title="Strikethrough" style={{ textDecoration: "line-through", fontSize: 13 }}>S</button>\n'
    '                <div className="sep"/>\n'
    '                <button onClick={() => { const el = textareaRef.current; if (!el) return; const s = el.selectionStart; const row1 = "| Kolom 1 | Kolom 2 | Kolom 3 |"; const row2 = "|---------|---------|---------|"; const row3 = "|  |  |  |"; const tbl = "\\n" + row1 + "\\n" + row2 + "\\n" + row3 + "\\n"; const newVal = value.slice(0,s) + tbl + value.slice(s); onChange(newVal); setTimeout(() => { el.focus(); el.setSelectionRange(s+tbl.length,s+tbl.length); },0); setMoreOpen(false); }} title="Insert table" style={{ fontSize: 13 }}>&#x229E;</button>\n'
    '                <button onClick={() => { insert("[[", "]]", "judul note"); setMoreOpen(false); }} title="Internal link [[wiki]]" style={{ fontSize: 11, fontWeight: 700 }}>[[]]</button>\n'
    '              </div>\n'
    '            )}\n'
    '          </div>\n'
    '          <div className="sep"/>\n'
    '          <button onClick={() => { const el = textareaRef.current; if (!el) return; const s = el.selectionStart; const nl = String.fromCharCode(10); const newVal = value.slice(0,s) + nl + "---" + nl + value.slice(s); onChange(newVal); setTimeout(() => { el.focus(); el.setSelectionRange(s+5,s+5); },0); }} title="Horizontal rule" style={{ fontSize: 13, letterSpacing: -1 }}>—</button>'
)

if old_overflow in h:
    h = h.replace(old_overflow, new_overflow, 1)
    print('Overflow buttons to dropdown: OK')
else:
    print('ERROR: overflow buttons pattern not found')
    # Debug: check parts
    parts = [
        '1. ")} title="Numbered list"',
        'title="Strikethrough"',
        'title="Insert table"',
        'title="Internal link',
    ]
    for p in parts:
        print(f'  "{p}" found:', p in h)

with open('static/index.html', 'w', encoding='utf-8') as f:
    f.write(h)

# Verify
with open('static/index.html', encoding='utf-8') as f:
    v = f.read()
with open('static/app.css', encoding='utf-8') as f:
    css = f.read()
print()
print('nowrap CSS:', 'flex-wrap: nowrap' in css)
print('moreOpen state:', 'moreOpen' in v)
print('+ button:', 'Format lainnya' in v)
print('dropdown:', 'moreOpen && (' in v)
