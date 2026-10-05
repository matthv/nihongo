"""Builds www/strokes.json from KanjiVG (https://kanjivg.tagaini.net, CC BY-SA 3.0, Ulrich Apel):
for every kana, its stroke paths in writing order and where each stroke number goes.
Usage: python3 outils/kanjivg.py"""
import json, os, re, sys, urllib.request, urllib.error
from concurrent.futures import ThreadPoolExecutor

URL = 'https://raw.githubusercontent.com/KanjiVG/kanjivg/master/kanji/{:05x}.svg'
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'www', 'strokes.json')
CHARS = [chr(c) for c in list(range(0x3041, 0x3097)) + list(range(0x30a1, 0x30fb)) + [0x30fc]]

def fetch(ch):
    try:
        svg = urllib.request.urlopen(URL.format(ord(ch)), timeout=20).read().decode()
    except urllib.error.HTTPError as e:
        return ch, None if e.code == 404 else e
    paths = re.findall(r'<path [^>]*\bd="([^"]+)"', svg)
    nums = [[float(x), float(y)] for x, y in re.findall(r'matrix\(1 0 0 1 ([\d.]+) ([\d.]+)\)', svg)]
    if not paths or len(nums) != len(paths):
        return ch, ValueError(f'{len(paths)} paths, {len(nums)} numbers')
    # Two decimals are plenty in a 109-unit box and halve the file.
    paths = [re.sub(r'(\d+\.\d\d)\d+', r'\1', p) for p in paths]
    return ch, {'p': paths, 'n': nums}

with ThreadPoolExecutor(8) as pool:
    results = dict(pool.map(fetch, CHARS))
errors = {c: r for c, r in results.items() if isinstance(r, Exception)}
for c, e in errors.items():
    print('error', c, e)
data = {c: r for c, r in results.items() if isinstance(r, dict)}
missing = [c for c, r in results.items() if r is None]
print(f'{len(data)} kana, missing: {"".join(missing)}')
if errors:
    sys.exit(1)
with open(OUT, 'w') as f:
    json.dump(data, f, ensure_ascii=False, separators=(',', ':'))
print(f'{OUT}: {os.path.getsize(OUT)} bytes')
