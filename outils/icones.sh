#!/bin/bash
# Renders the home-screen icons and the link preview image (og.png) with headless Chrome (the あ uses the bundled Klee One font).
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

# Link preview (WhatsApp, iMessage...): 1200x630, Sakura palette.
path = f'{www}/img/_render.html'
with open(path, 'w') as f:
    f.write('''<!doctype html><meta charset="utf-8"><style>
@font-face{font-family:K;src:url(../fonts/klee-one-600.woff2)}
html,body{margin:0;overflow:hidden}
body{width:1200px;height:630px;background:#fbf5f7;display:flex;align-items:center;gap:72px;padding:0 110px;box-sizing:border-box;
font-family:system-ui,"DejaVu Sans",sans-serif;color:#2b1f25}
.tile{flex:none;width:300px;height:300px;border-radius:66px;background:#c8402f;display:grid;place-items:center;color:#fff;font:600 190px/1 K}
h1{margin:0;font-size:104px;line-height:1;font-weight:800;letter-spacing:-1px}
.jp{font:600 54px/1.3 K;color:#a33e6c;margin:14px 0 22px}
p{margin:0;font-size:38px;color:#7a6670}</style>
<div class="tile">あ</div><div><h1>Nihongo</h1><div class="jp">にほんご</div><p>Apprendre le japonais,<br>kana par kana</p></div>''')
b = Browser(width=1200, height=630)
try:
    b.go('file://' + path, wait=1)
    b.shot(f'{www}/img/og.png')
finally:
    b.close()
    os.remove(path)
print('og')
PY
