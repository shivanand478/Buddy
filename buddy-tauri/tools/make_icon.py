#!/usr/bin/env python3
"""Renders Nub to a PNG so `tauri icon` has a source to work from.

Pure stdlib — no Pillow. Draws at 4x and box-downsamples for antialiasing.
"""
import math
import struct
import zlib

SIZE = 1024
SS = 4                      # supersample factor
W = SIZE * SS

BUTTER = (239, 180, 59)
CORAL = (224, 101, 75)
DARK = (42, 31, 28)
WHITE = (255, 255, 255)
MOUTH = (138, 95, 22)


def ellipse(px, py, cx, cy, rx, ry):
    dx = (px - cx) / rx
    dy = (py - cy) / ry
    return dx * dx + dy * dy <= 1.0


def triangle(px, py, a, b, c):
    def sign(p1, p2, p3):
        return (p1[0] - p3[0]) * (p2[1] - p3[1]) - (p2[0] - p3[0]) * (p1[1] - p3[1])
    d1 = sign((px, py), a, b)
    d2 = sign((px, py), b, c)
    d3 = sign((px, py), c, a)
    neg = (d1 < 0) or (d2 < 0) or (d3 < 0)
    pos = (d1 > 0) or (d2 > 0) or (d3 > 0)
    return not (neg and pos)


def shade(x, y):
    """Returns (r, g, b, a) for a pixel in the supersampled space."""
    u = x / W * 100.0          # map to the 100x110 design space
    v = y / W * 110.0

    # smile — drawn first so the body can't cover it
    if 42 <= u <= 58:
        t = (u - 42) / 16.0
        arc = 68 + 8 * math.sin(math.pi * t)
        if abs(v - arc) <= 1.6 and ellipse(u, v, 50, 56, 33, 42):
            return MOUTH + (255,)

    # eyes
    for ex in (38, 62):
        if ellipse(u, v, ex, 50, 8, 8):
            if ellipse(u, v, ex + 1, 51, 4, 4):
                return DARK + (255,)
            return WHITE + (255,)

    # cheeks
    for cx in (27, 73):
        if ellipse(u, v, cx, 63, 5, 5) and ellipse(u, v, 50, 56, 33, 42):
            return (233, 138, 108) + (255,)

    # horn
    if triangle(u, v, (50, 3), (59.5, 18), (40.5, 18)):
        return CORAL + (255,)

    # body
    if ellipse(u, v, 50, 56, 33, 42):
        return BUTTER + (255,)

    return (0, 0, 0, 0)


def main():
    print(f"rendering {SIZE}x{SIZE} (supersampled {SS}x)…")
    rows = []
    for oy in range(SIZE):
        row = bytearray()
        for ox in range(SIZE):
            r = g = b = a = 0
            for sy in range(SS):
                for sx in range(SS):
                    pr, pg, pb, pa = shade(ox * SS + sx, oy * SS + sy)
                    r += pr * pa
                    g += pg * pa
                    b += pb * pa
                    a += pa
            n = SS * SS
            if a == 0:
                row += bytes((0, 0, 0, 0))
            else:
                row += bytes((r // a, g // a, b // a, a // n))
        rows.append(bytes(row))

    raw = b"".join(b"\x00" + r for r in rows)

    def chunk(tag, payload):
        c = struct.pack(">I", len(payload)) + tag + payload
        return c + struct.pack(">I", zlib.crc32(tag + payload) & 0xFFFFFFFF)

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", SIZE, SIZE, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(raw, 9))
    png += chunk(b"IEND", b"")

    with open("app-icon.png", "wb") as f:
        f.write(png)
    print("wrote app-icon.png")


if __name__ == "__main__":
    main()
