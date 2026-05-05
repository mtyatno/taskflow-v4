import io, sys
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

with open('static/index.html', encoding='utf-8') as f:
    h = f.read()

# Use the unique context: setIsOnline followed by the comment about offline
old = ('        setIsOnline(navigator.onLine);\n'
       '\n'
       '        // Saat offline: apply pending queue mutations di atas data cache')

new = ('        setIsOnline(navigator.onLine);\n'
       '        if (navigator.onLine) {\n'
       '          api.post("/api/recurring/check-expiry")\n'
       '            .then(data => {\n'
       '              if (data && data.tasks && data.tasks.length > 0) {\n'
       '                const hasExpired = data.tasks.some(t => t.level === "expired");\n'
       '                setRecurExpiryAlert({ count: data.tasks.length, hasExpired });\n'
       '              }\n'
       '            })\n'
       '            .catch(() => {});\n'
       '        }\n'
       '\n'
       '        // Saat offline: apply pending queue mutations di atas data cache')

if old in h:
    h = h.replace(old, new, 1)
    print('check-expiry call: OK')
else:
    print('ERROR: setIsOnline pattern not found')
    sys.exit(1)

with open('static/index.html', 'w', encoding='utf-8') as f:
    f.write(h)
print('Done')
