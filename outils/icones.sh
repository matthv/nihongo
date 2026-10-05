#!/bin/bash
# Renders the home-screen icons with headless Chrome (the あ uses the bundled Klee One font).
set -eu
cd "$(dirname "$0")"
python3 - <<'PY'
import os, sys
sys.path.insert(0, '.')
from cdp import Browser
www = os.path.abspath('../www')
def page(size, pad):
    r = 0 if pad else size * 0.22
    path = f'{www}/img/_render.html'
    with open(path, 'w') as f:
        f.write(f'''<!doctype html><meta charset="utf-8"><style>
@font-face{{font-family:K;src:url(../fonts/klee-one-600.woff2)}}
html,body{{margin:0;background:transparent;overflow:hidden}}
div{{width:{size}px;height:{size}px;border-radius:{r}px;background:#c8402f;display:grid;place-items:center;
color:#fff;font:600 {size * (0.5 if pad else 0.62)}px/1 K}}</style><div>あ</div>''')
    return 'file://' + path
for name, size, pad in [('apple-touch-icon', 180, True), ('icon-192', 192, False), ('icon-512', 512, False), ('icon-maskable-512', 512, True)]:
    b = Browser(width=size, height=size)
    try:
        b.ws.call('Emulation.setDefaultBackgroundColorOverride', color={'r': 0, 'g': 0, 'b': 0, 'a': 0})
        b.go(page(size, pad), wait=1)
        b.shot(f'{www}/img/{name}.png')
    finally:
        b.close()
        os.remove(f'{www}/img/_render.html')
    print(name)
PY
