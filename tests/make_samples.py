#!/usr/bin/env python3
"""Generate synthetic .ipv files for the automated tests (no third-party packages).

good_*.ipv : valid files whose artwork has a RED top-left quadrant and a BLUE
             bottom-right quadrant, so tests can catch flipped/mirrored output.
bad_*.ipv  : files the handler must reject without crashing.
"""
import os, random, struct, sys, zlib

def png(w, h):
    def pixel(x, y):
        if x < w // 2 and y < h // 2:   return b'\xff\x00\x00\xff'   # red
        if x >= w // 2 and y >= h // 2: return b'\x00\x00\xff\xff'   # blue
        return b'\x80\x80\x80\xff'                                   # grey
    raw = b''.join(b'\x00' + b''.join(pixel(x, y) for x in range(w)) for y in range(h))
    def chunk(t, d):
        return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    return (b'\x89PNG\r\n\x1a\n'
            + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(raw))
            + chunk(b'IEND', b''))

def ipv_chunk(tag, payload):
    return struct.pack('>II', tag, len(payload)) + payload + struct.pack('>i', -(len(payload) + 8))

def ipv(p):
    # Mirrors the layout of real files: header, info, an empty layer snapshot,
    # the flattened composite, then one trailing chunk after it.
    ts = struct.pack('>d', 1.7e9)
    return (ipv_chunk(0x01000100, ts + bytes.fromhex('0000050000000500'))
            + ipv_chunk(0x01000200, b'\x00\x0bibisPaint X')
            + ipv_chunk(0x01000500, ts + struct.pack('>ii', 0, 1) + bytes.fromhex('040000000000'))
            + ipv_chunk(0x01000500, ts + struct.pack('>iiI', -1, 0, len(p)) + p)
            + ipv_chunk(0x01000600, b'\x00' * 40))

def history_ipv():
    """A tiny .ipv with a drawing history, in the layouts timelapse.js reads:
    stack change (layer 1 added above layer 0), layer settings, one stroke on
    layer 1, one fill on layer 0, and the final layer table."""
    ts = struct.pack('>d', 1.7e9)
    def sub(tag, payload): return ipv_chunk(tag, payload)
    def point(x, y): return sub(0x02000301, struct.pack('>dff', 1.0, x, y))
    def record(lid, flags, opacity): return sub(0x03000402, struct.pack('>iBf', lid, flags, opacity) + b'\x00' * 38)
    stack_ids = lambda ids: b''.join(sub(0x03000603, struct.pack('>i', i)) for i in ids)
    stack = ipv_chunk(0x03000600, b'\x00' * 8 + stack_ids([0, -1]) + stack_ids([0, 1, -1]))
    props = ipv_chunk(0x03000400, b'\x00' + struct.pack('>II', 2, 3) + record(0, 1, 1.0) + record(1, 3, 0.5))
    pts = [point(10.5, 20.0), point(30.0, 40.0), point(50.0, 45.5)]
    stroke_tail = b'\x00' * 36 + struct.pack('>f', 12.5) + b'\x00' * 20      # brush size at tail + 36
    stroke = ipv_chunk(0x02000300, ts + ts + struct.pack('>III', 0, 1, 0x7000) + bytes.fromhex('ff0000ff')
                       + struct.pack('>II', 2, len(pts)) + b''.join(pts) + stroke_tail)    # position 2 = layer 1
    nested = (struct.pack('>II', 0x01000500, 64) + ts + struct.pack('>ii', 0, 1) + b'\x04\x00' + struct.pack('>I', 20))
    fill = ipv_chunk(0x02000400, ts + ts + struct.pack('>I', 1) + point(7.0, 9.0) + b'\x00' * 12 + nested + b'RPNG' + b'\x00' * 60)
    table = ipv_chunk(0x01000600, b'\x00' * 10 + record(0, 1, 1.0) + record(1, 3, 0.5) + record(-1, 1, 0.5))
    first = ipv_chunk(0x01000100, ts + bytes.fromhex('0000050000000500'))
    return first + stack + props + stroke + fill + table


def main(out):
    os.makedirs(out, exist_ok=True)
    small, large = ipv(png(64, 48)), ipv(png(600, 300))
    random.seed(1)
    files = {
        'good_small.ipv': small,                  # thumbnail stays 64x48
        'good_large.ipv': large,                  # thumbnail scales to 256x128
        'history.ipv': history_ipv(),             # drawing history for the timelapse parser
        'bad_truncated.ipv': large[:len(large) - 100],
        'bad_not_ipv.ipv': png(32, 32),           # a PNG renamed to .ipv
        'bad_random.ipv': bytes(random.getrandbits(8) for _ in range(5000)),
        'bad_empty.ipv': b'',
    }
    for name, data in files.items():
        with open(os.path.join(out, name), 'wb') as f:
            f.write(data)
    print(f'wrote {len(files)} samples to {out}')

if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else 'samples')
