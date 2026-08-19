#!/usr/bin/env python3
"""Turns the character renders into web-ready PNGs with clean transparency.

There is no Pillow on this machine, so the pipeline leans on `sips` (which ships
with macOS) to decode and resize, and does the alpha work here:

    source png --sips--> uncompressed TIFF --parse--> RGBA --encode--> PNG

Two of the four renders arrived on a white background. Keying that out by a
plain "white becomes transparent" test would eat the highlights on the cloud's
face and leave a hard, aliased edge. Instead the background is found by
flood-filling inward from the border, so only pixels actually connected to the
outside are removed, and edge pixels get partial alpha so the outline stays soft.
"""
import struct
import subprocess
import sys
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT_APP = ROOT / "src" / "img"
OUT_SITE = ROOT.parent / "buddy-site" / "img"


# ------------------------------------------------------------------ tiff in

def load_rgba(path: Path, size: int):
    """Decodes via sips into an uncompressed TIFF and returns (w, h, bytearray)."""
    tmp = Path("/tmp/_prep.tiff")
    subprocess.run(
        ["sips", "-s", "format", "tiff", "-s", "formatOptions", "none",
         "-Z", str(size), str(path), "--out", str(tmp)],
        check=True, capture_output=True)

    data = tmp.read_bytes()
    endian = "<" if data[:2] == b"II" else ">"
    (offset,) = struct.unpack(endian + "I", data[4:8])

    tags = {}
    (count,) = struct.unpack(endian + "H", data[offset:offset + 2])
    for i in range(count):
        p = offset + 2 + i * 12
        tag, typ, n = struct.unpack(endian + "HHI", data[p:p + 8])
        if typ == 3 and n == 1:
            (value,) = struct.unpack(endian + "H", data[p + 8:p + 10])
        else:
            (value,) = struct.unpack(endian + "I", data[p + 8:p + 12])
        tags[tag] = (value, n, typ, p)

    w = tags[256][0]
    h = tags[257][0]
    spp = tags.get(277, (1,))[0]
    strip_tag = tags[273]

    # One strip or many; gather the offsets either way.
    if strip_tag[1] == 1:
        offsets = [strip_tag[0]]
    else:
        base = strip_tag[0]
        offsets = [struct.unpack(endian + "I", data[base + i * 4:base + i * 4 + 4])[0]
                   for i in range(strip_tag[1])]
    rows_tag = tags.get(278, (h, 1, 3, 0))
    rows_per_strip = rows_tag[0]

    px = bytearray(w * h * 4)
    for s, off in enumerate(offsets):
        first = s * rows_per_strip
        rows = min(rows_per_strip, h - first)
        for r in range(rows):
            y = first + r
            src = off + r * w * spp
            for x in range(w):
                i = src + x * spp
                o = (y * w + x) * 4
                px[o] = data[i]
                px[o + 1] = data[i + 1]
                px[o + 2] = data[i + 2]
                px[o + 3] = data[i + 3] if spp == 4 else 255
    tmp.unlink(missing_ok=True)
    return w, h, px


# ------------------------------------------------------------------ keying

def key_white(w, h, px, hard=250, soft=228):
    """Removes the white surround without touching white *inside* the figure.

    Pixels are only considered background if they connect to the image border,
    which is what keeps the cloud's white face and the star's highlights intact.
    Brightness between `soft` and `hard` becomes partial alpha so the edge does
    not turn into a jagged cut-out.
    """
    def bright(i):
        # The *darkest* channel, not the brightest. Pale blue reads as ~245 on
        # its blue channel and would be mistaken for white; its red channel sits
        # near 175, so the minimum separates a tinted body from true white.
        return min(px[i], px[i + 1], px[i + 2])

    seen = bytearray(w * h)
    stack = []
    for x in range(w):
        stack.append((x, 0))
        stack.append((x, h - 1))
    for y in range(h):
        stack.append((0, y))
        stack.append((w - 1, y))

    while stack:
        x, y = stack.pop()
        if x < 0 or y < 0 or x >= w or y >= h:
            continue
        n = y * w + x
        if seen[n]:
            continue
        if bright(n * 4) < soft:
            continue
        seen[n] = 1
        stack.extend(((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)))

    for n in range(w * h):
        if not seen[n]:
            continue
        i = n * 4
        b = bright(i)
        if b >= hard:
            px[i + 3] = 0
        else:
            # Fade through the soft band rather than cutting a hard edge.
            px[i + 3] = int(255 * (hard - b) / (hard - soft))
    return px


def trim(w, h, px, pad=8):
    """Crops to the visible figure so every character sits the same in its box."""
    minx, miny, maxx, maxy = w, h, -1, -1
    for y in range(h):
        row = y * w
        for x in range(w):
            if px[(row + x) * 4 + 3] > 8:
                if x < minx: minx = x
                if x > maxx: maxx = x
                if y < miny: miny = y
                if y > maxy: maxy = y
    minx = max(0, minx - pad); miny = max(0, miny - pad)
    maxx = min(w - 1, maxx + pad); maxy = min(h - 1, maxy + pad)
    nw, nh = maxx - minx + 1, maxy - miny + 1
    out = bytearray(nw * nh * 4)
    for y in range(nh):
        src = ((y + miny) * w + minx) * 4
        out[y * nw * 4:(y + 1) * nw * 4] = px[src:src + nw * 4]
    return nw, nh, out


# ------------------------------------------------------------------ png out

def write_png(path: Path, w, h, px):
    raw = bytearray()
    for y in range(h):
        raw.append(0)                       # filter: none
        raw += px[y * w * 4:(y + 1) * w * 4]

    def chunk(tag, body):
        return (struct.pack(">I", len(body)) + tag + body
                + struct.pack(">I", zlib.crc32(tag + body) & 0xFFFFFFFF))

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(bytes(raw), 9))
    png += chunk(b"IEND", b"")
    path.write_bytes(png)


# ------------------------------------------------------------------ run

CHARACTERS = [
    ("sprout", "ChatGPT Image Aug 19, 2026, 01_49_25 AM.png", False),
    ("nimbus", "ChatGPT Image Aug 19, 2026, 12_28_33 AM.png", True),
    ("dew",    "ChatGPT Image Aug 19, 2026, 12_29_18 AM.png", True),
    ("sunny",  "ChatGPT Image Aug 19, 2026, 12_27_34 AM.png", False),
]

# 360px covers the largest on-screen use (a ~140px hero on a 2x display) with
# room to spare; 128px covers every thumbnail. Shipping 512 was paying for
# pixels nothing ever showed.
SIZES = [("", 360), ("@small", 128)]


def main():
    src_dir = Path.home() / "Downloads"
    OUT_APP.mkdir(parents=True, exist_ok=True)
    OUT_SITE.mkdir(parents=True, exist_ok=True)

    for name, filename, needs_key in CHARACTERS:
        src = src_dir / filename
        if not src.exists():
            print(f"!! missing {src}")
            continue
        for suffix, size in SIZES:
            w, h, px = load_rgba(src, size)
            if needs_key:
                px = key_white(w, h, px)
            w, h, px = trim(w, h, px)
            out = f"{name}{suffix}.png"
            write_png(OUT_APP / out, w, h, px)
            write_png(OUT_SITE / out, w, h, px)
            print(f"{out:20s} {w}x{h}  {(OUT_APP / out).stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
