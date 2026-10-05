#!/bin/bash
# Runs outils/tests.js against www/kana.js in headless Chrome.
set -eu
cd "$(dirname "$0")"
python3 - <<'PY'
import json, os, sys
sys.path.insert(0, '.')
from cdp import Browser
root = os.path.abspath('..')
b = Browser()
try:
    b.go('file://' + root + '/outils/tests.html', wait=1)
    r = b.js('JSON.stringify(window.TEST_RESULT)')
finally:
    b.close()
r = json.loads(r) if r else {'fails': ['tests did not run']}
print(f"{r.get('count')} items, {r.get('lessons')} lessons")
for f in r['fails']: print('FAIL', f)
sys.exit(1 if r['fails'] else 0)
PY
