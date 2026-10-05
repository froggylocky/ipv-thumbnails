#!/usr/bin/env python3
"""
ipv_extract.py - extract images from ibisPaint X .ipv project files without ibisPaint.

Usage:  python3 ipv_extract.py drawing.ipv [output_dir]
Needs:  pip install pillow numpy

Outputs: <name>_final.png (the flattened artwork) and <name>_layer_XX.png
(each layer as a full-canvas transparent PNG).

Format notes (reverse engineered; big-endian throughout):
  The file is a flat list of chunks:
     u32 tag | u32 length | payload[length] | i32 trailer = -(length + 8)
  The trailer lets the app walk the file backwards (it's an append-only history log).
  Tag 0x01000500 = image snapshot. Payload:
     f64 timestamp | i32 layer_id (-1 = flattened composite) | i32 kind | ...
  kind 0: the composite, stored as a normal PNG.
  kind 1: a layer, wrapped in an "RPNG" block:
     "RPNG" | u32 0x2d | u32 0 | u8 flag (4 or 0; meaning unknown) | u32 canvasW | u32 canvasH
     | u32 boxW | u32 boxH | u32 boxX | u32 boxY | u32 pngW | u32 pngH | u32 padding
     | u32 0xFFFFFF00 or 0 | u32 spanBytes | u16 (skip, run) pairs | u32 png_size | PNG
  The PNG holds only the non-empty pixels packed end to end. Walk the bounding box
  row-major: skip `skip` pixels, then copy `run` pixels from the PNG, and repeat.
  Orientation: EVERYTHING is bottom-up (OpenGL convention): box Y counts from the
  bottom of the canvas, box rows run bottom to top, and the packed PNG's rows must
  also be read from its last row to its first. Flip the finished canvas to view it.
"""
import struct, sys, os, io
import numpy as np
from PIL import Image

def chunks(d):
    off = 0
    while off + 8 <= len(d):
        tag, ln = struct.unpack('>II', d[off:off+8])
        end = off + 8 + ln
        if end + 4 > len(d) or struct.unpack('>i', d[end:end+4])[0] != -(ln + 8):
            raise ValueError(f'bad chunk at {off:#x}')
        yield off, tag, d[off+8:end]
        off = end + 4

def decode_rpng(q):
    flag = q[12]
    cw, ch, bw, bh, bx, by, pw, ph, pad = struct.unpack('>9I', q[13:49])
    nspan = struct.unpack('>I', q[53:57])[0]
    spans = struct.unpack(f'>{nspan//2}H', q[57:57+nspan])
    p = 57 + nspan
    plen = struct.unpack('>I', q[p:p+4])[0]
    png = Image.open(io.BytesIO(q[p+4:p+4+plen])).convert('RGBA')
    # Everything in ibisPaint is bottom-up (OpenGL convention), including the
    # packed PNG's rows, so read the PNG from its last row to its first.
    packed = np.asarray(png)[::-1].reshape(-1, 4)
    box = np.zeros((bw * bh, 4), np.uint8)
    pos = src = 0
    for i in range(0, len(spans), 2):
        pos += spans[i]
        run = spans[i+1] if i + 1 < len(spans) else 0
        box[pos:pos+run] = packed[src:src+run]
        pos += run
        src += run
    canvas = np.zeros((ch, cw, 4), np.uint8)
    canvas[by:by+bh, bx:bx+bw] = box.reshape(bh, bw, 4)   # bottom-up canvas
    return canvas[::-1].copy()                               # -> normal top-down image

def main(path, outdir='.'):
    d = open(path, 'rb').read()
    name = os.path.splitext(os.path.basename(path))[0]
    os.makedirs(outdir, exist_ok=True)
    final, layers = None, {}
    for off, tag, p in chunks(d):
        if tag != 0x01000500: continue
        layer_id, kind = struct.unpack('>ii', p[8:16])
        if kind == 0 and b'\x89PNG' in p[:64]:
            final = p[p.find(b'\x89PNG'):]          # latest one wins
        elif kind == 1:
            r = p.find(b'RPNG')
            layers[layer_id] = decode_rpng(p[r:]) if r >= 0 else None  # None = empty layer
    if final:
        open(os.path.join(outdir, f'{name}_final.png'), 'wb').write(final)
        print('wrote', f'{name}_final.png')
    for lid, arr in sorted(layers.items()):
        if arr is None: continue
        Image.fromarray(arr).save(os.path.join(outdir, f'{name}_layer_{lid:02d}.png'))
    print(f'wrote {sum(a is not None for a in layers.values())} layer PNGs')
    return final, layers

if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else '.')
