import io, sys
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

with open('static/index.html', encoding='utf-8') as f:
    h = f.read()

# Insert expiry banner after the sync banner, before Mobile top bar
old = ('            )}\n'
       '\n'
       '            {/* Mobile top bar */}')

new = ('            )}\n'
       '            {recurExpiryAlert && (\n'
       '              <div onClick={() => { setPage("tasks"); setRecurExpiryAlert(null); }}\n'
       '                style={{ position: "sticky", top: 0, zIndex: 50, cursor: "pointer", padding: "8px 16px",\n'
       '                  background: recurExpiryAlert.hasExpired ? "#fef2f2" : "#fefce8",\n'
       '                  borderBottom: "1px solid " + (recurExpiryAlert.hasExpired ? "#fca5a5" : "#fde68a"),\n'
       '                  display: "flex", alignItems: "center", justifyContent: "space-between" }}>\n'
       '                <span style={{ fontSize: 13, fontWeight: 600, color: recurExpiryAlert.hasExpired ? "#b91c1c" : "#854d0e" }}>\n'
       '                  {recurExpiryAlert.hasExpired ? "\xf0\x9f\x94\xb4" : "\xe2\x9a\xa0\xef\xb8\x8f"} {recurExpiryAlert.count} recurring task {recurExpiryAlert.hasExpired ? "telah berakhir" : "akan berakhir"} \xe2\x80\x94 Klik untuk lihat\n'
       '                </span>\n'
       '                <button onClick={e => { e.stopPropagation(); setRecurExpiryAlert(null); }}\n'
       '                  style={{ background: "transparent", border: "none", fontSize: 16, cursor: "pointer", color: "var(--text-light)" }}>\xe2\x9c\x95</button>\n'
       '              </div>\n'
       '            )}\n'
       '\n'
       '            {/* Mobile top bar */}')

# Count occurrences to make sure we patch the right one
count = h.count(old)
print('Pattern occurrences:', count)

if count == 1:
    h = h.replace(old, new, 1)
    print('Expiry banner JSX: OK')
elif count > 1:
    # Find the one that comes after the sync banner
    idx_sync = h.find('{isOnline && queueSize > 0 && (')
    # Find the pattern after sync banner
    idx_pattern = h.find(old, idx_sync)
    if idx_pattern != -1:
        h = h[:idx_pattern] + new + h[idx_pattern + len(old):]
        print('Expiry banner JSX (targeted): OK')
    else:
        print('ERROR: Pattern not found after sync banner')
        sys.exit(1)
else:
    print('ERROR: Pattern not found')
    sys.exit(1)

with open('static/index.html', 'w', encoding='utf-8') as f:
    f.write(h)
print('Done')
