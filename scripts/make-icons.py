"""Pixel icons for radio.phareim.no: a small pixel radio with its antenna
sending out two neon arcs, in the Neon Shrine palette. Drawn on a grid of N
logical pixels and scaled up by a whole number with nearest-neighbour, so
every pixel stays square (same method as phareim.no scripts/make-favicon.py).

    python3 scripts/make-icons.py   → public/favicon.ico (16/32/48),
                                      apple-touch-icon.png, icon-192.png, icon-512.png
"""
import io
import math
import os
import struct

from PIL import Image

HEX = {
    'bg': '0b0616', 'bg2': '140b26', 'bg3': '1c1030', 'star': 'cfc6ff',
    'edge': 'ff2fa0', 'body': '43246e', 'bodyD': '2a1a4c', 'hi': '6a2a7c',
    'cyan': '2ff3ff', 'cyanD': '1b6f86', 'gold': 'ffd23f', 'ink': 'f2e9ff',
}
C = {k: tuple(int(v[i:i + 2], 16) for i in (0, 2, 4)) + (255,) for k, v in HEX.items()}
BAYER = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]]


def line(px, x0, y0, x1, y1, col):
    steps = max(abs(x1 - x0), abs(y1 - y0))
    for i in range(steps + 1):
        t = i / max(1, steps)
        px[round(x0 + (x1 - x0) * t), round(y0 + (y1 - y0) * t)] = col


def arc(px, n, cx, cy, r, a0, a1, col):
    seen = set()
    for i in range(int(r * 12) + 1):
        a = math.radians(a0 + (a1 - a0) * i / (r * 12))
        x, y = round(cx + r * math.cos(a)), round(cy - r * math.sin(a))
        if 0 <= x < n and 0 <= y < n and (x, y) not in seen:
            seen.add((x, y))
            px[x, y] = col


def draw(n: int) -> Image.Image:
    """The radio on an n×n grid (n = 16 or 32)."""
    img = Image.new('RGBA', (n, n), C['bg'])
    px = img.load()
    s = n / 32

    # Ground: a faint dithered violet rising from the bottom.
    for y in range(n):
        f = max(0.0, (y / n - 0.55) / 0.45)
        for x in range(n):
            if f * 16 > BAYER[y % 4][x % 4] + 0.5:
                px[x, y] = C['bg2']
    if n >= 32:
        for x, y in ((27, 2), (29, 9), (22, 5)):
            px[x, y] = C['star']

    # Body: a notched box (no corner pixels), pink edge, violet fill, a lit top rim.
    x0, x1 = round(3 * s), round(28 * s)
    y0, y1 = round(14 * s), round(27 * s)
    for y in range(y0, y1 + 1):
        for x in range(x0, x1 + 1):
            corner = (x in (x0, x1)) and (y in (y0, y1))
            if corner:
                continue
            edge = x in (x0, x1) or y in (y0, y1)
            px[x, y] = C['edge'] if edge else C['body']
    for x in range(x0 + 1, x1):
        px[x, y0 + 1] = C['hi']
        px[x, y1 - 1] = C['bodyD']

    # Speaker grille (left): cyan dots on a chequer.
    gx0, gx1 = x0 + round(3 * s), x0 + round(10 * s)
    gy0, gy1 = y0 + round(3 * s), y1 - round(3 * s)
    for y in range(gy0, gy1 + 1):
        for x in range(gx0, gx1 + 1):
            px[x, y] = C['bodyD']
            if (x + y) % 2 == 0:
                px[x, y] = C['cyanD'] if n >= 32 else C['cyan']
    if n >= 32:
        for (x, y) in ((gx0 + 2, gy0 + 2), (gx0 + 4, gy0 + 4), (gx0 + 2, gy0 + 6), (gx0 + 6, gy0 + 2)):
            if gx0 <= x <= gx1 and gy0 <= y <= gy1:
                px[x, y] = C['cyan']

    # Dial window (right): cyan band with a pink needle, gold knobs under it.
    dx0, dx1 = x0 + round(14 * s), x1 - round(3 * s)
    dy0, dy1 = y0 + round(3 * s), y0 + round(6 * s)
    for y in range(dy0, dy1 + 1):
        for x in range(dx0, dx1 + 1):
            px[x, y] = C['cyan'] if y in (dy0, dy1) or n < 32 else C['bg']
    if n >= 32:
        for x in range(dx0 + 1, dx1, 2):
            px[x, dy0 + 1] = C['cyanD']
    nx = dx0 + round(4 * s)
    for y in range(dy0, dy1 + 1):
        px[nx, y] = C['edge'] if n >= 32 else C['bg']
    ky = y1 - round(4 * s)
    for kx in (dx0 + round(1 * s), dx1 - round(2 * s)):
        for yy in range(ky, ky + max(1, round(2 * s))):
            for xx in range(kx, kx + max(1, round(2 * s))):
                px[xx, yy] = C['gold']

    # Antenna: from the body's top, leaning left, a gold tip.
    ax0, ay0 = x0 + round(17 * s), y0 - 1
    ax1, ay1 = round(12 * s), round(7 * s)
    line(px, ax0, ay0, ax1, ay1, C['ink'] if n >= 32 else C['star'])
    tip = max(1, round(2 * s))
    for yy in range(ay1 - tip + 1, ay1 + 1):
        for xx in range(ax1 - tip + 1, ax1 + 1):
            px[xx, yy] = C['gold']

    # The signal: two arcs out of the tip, up and to the left.
    cx, cy = ax1 - (tip - 1) / 2, ay1 - (tip - 1) / 2
    if n >= 32:
        arc(px, n, cx, cy, 4, 92, 196, C['cyan'])
        arc(px, n, cx, cy, 7.5, 100, 188, C['cyan'])
    else:
        arc(px, n, cx, cy, 2.5, 95, 205, C['cyan'])
        arc(px, n, cx, cy, 4.5, 100, 200, C['cyan'])
    return img


def icon(size: int, grid: int, pad: int = 0) -> Image.Image:
    art = draw(grid)
    if pad:
        framed = Image.new('RGBA', (grid + 2 * pad, grid + 2 * pad), C['bg'])
        framed.paste(art, (pad, pad))
        art = framed
    assert size % art.width == 0, (size, art.width)
    return art.resize((size, size), Image.NEAREST)


out = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'public')
icon(180, 32, pad=2).save(os.path.join(out, 'apple-touch-icon.png'))
icon(192, 32).save(os.path.join(out, 'icon-192.png'))
icon(512, 32).save(os.path.join(out, 'icon-512.png'))

# Pillow's ICO writer ignores append_images, so build the container by hand.
entries = [icon(16, 16), icon(32, 16), icon(48, 16)]
blobs = []
for im in entries:
    b = io.BytesIO()
    im.save(b, format='PNG')
    blobs.append(b.getvalue())
offset = 6 + 16 * len(entries)
dirs, data = b'', b''
for im, blob in zip(entries, blobs):
    dirs += struct.pack('<BBBBHHII', im.width, im.height, 0, 0, 1, 32, len(blob), offset)
    offset += len(blob)
    data += blob
with open(os.path.join(out, 'favicon.ico'), 'wb') as f:
    f.write(struct.pack('<HHH', 0, 1, len(entries)) + dirs + data)
print('wrote public/favicon.ico (16/32/48), apple-touch-icon.png (180), icon-192.png and icon-512.png')
