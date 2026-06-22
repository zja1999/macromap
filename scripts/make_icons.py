#!/usr/bin/env python3
"""Generate Macro Map PWA icons (pure standard library, no Pillow).

Draws a full-bleed green tile with a white map-pin (matching the app logo) and
writes PNGs used by the web app manifest and the iOS home-screen icon.

    python scripts/make_icons.py
"""
import os
import struct
import zlib

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "icons")
os.makedirs(OUT, exist_ok=True)

ACCENT = (22, 163, 74)     # #16a34a
WHITE = (255, 255, 255)


def make_png(size):
    cx, cy = size * 0.5, size * 0.44
    head_r = size * 0.20
    tip_y = size * 0.80
    inner_r = size * 0.075
    head_r2, inner_r2 = head_r * head_r, inner_r * inner_r

    raw = bytearray()
    for y in range(size):
        raw.append(0)  # PNG filter byte: none
        for x in range(size):
            r, g, b = ACCENT  # full-bleed background (good for maskable)
            dx, dy = x - cx, y - cy
            d2 = dx * dx + dy * dy
            in_pin = d2 <= head_r2
            if not in_pin and cy <= y <= tip_y:           # tapering tail -> teardrop
                t = (y - cy) / (tip_y - cy)
                if abs(dx) <= head_r * 0.98 * (1 - t):
                    in_pin = True
            if in_pin:
                r, g, b = WHITE
                if d2 <= inner_r2:                          # green dot in the pin head
                    r, g, b = ACCENT
            raw += bytes((r, g, b, 255))

    def chunk(typ, data):
        return (struct.pack(">I", len(data)) + typ + data +
                struct.pack(">I", zlib.crc32(typ + data) & 0xffffffff))

    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)  # 8-bit RGBA
    idat = zlib.compress(bytes(raw), 9)
    return sig + chunk(b"IHDR", ihdr) + chunk(b"IDAT", idat) + chunk(b"IEND", b"")


for size, name in [(192, "icon-192.png"), (512, "icon-512.png"), (180, "icon-180.png")]:
    with open(os.path.join(OUT, name), "wb") as f:
        f.write(make_png(size))
    print("wrote icons/" + name)
