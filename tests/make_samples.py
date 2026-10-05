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

def main(out):
    os.makedirs(out, exist_ok=True)
    small, large = ipv(png(64, 48)), ipv(png(600, 300))
    random.seed(1)
    files = {
        'good_small.ipv': small,                  # thumbnail stays 64x48
        'good_large.ipv': large,                  # thumbnail scales to 256x128
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
