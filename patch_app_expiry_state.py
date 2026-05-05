import io, sys
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

with open('static/index.html', encoding='utf-8') as f:
    h = f.read()

old = '      const [unreadCount, setUnreadCount] = useState(0);'
new = ('      const [unreadCount, setUnreadCount] = useState(0);\n'
       '      const [recurExpiryAlert, setRecurExpiryAlert] = useState(null);')

if old in h:
    h = h.replace(old, new, 1)
    print('recurExpiryAlert state: OK')
else:
    print('ERROR: unreadCount pattern not found')
    sys.exit(1)

with open('static/index.html', 'w', encoding='utf-8') as f:
    f.write(h)
print('Done')
