import io, sys
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

with open('static/index.html', encoding='utf-8') as f:
    h = f.read()

# Add state after holidays state
old = '      const [holidays, setHolidays] = useState({});  // { "YYYY-MM-DD": "Nama Libur" }'
new = (old + '\n'
       '      const [recurExceptions, setRecurExceptions] = useState({});\n'
       '      const [recurPopup, setRecurPopup] = useState(null);')

if old in h:
    h = h.replace(old, new, 1)
    print('State added: OK')
else:
    print('ERROR: holidays state pattern not found')
    sys.exit(1)

with open('static/index.html', 'w', encoding='utf-8') as f:
    f.write(h)
print('Done')
