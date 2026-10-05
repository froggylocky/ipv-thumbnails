// ipv_parse.h - locate the flattened artwork PNG inside an ibisPaint .ipv file.
//
// Portable C++ (no Windows headers) so the same code runs in the Explorer
// thumbnail DLL and in the test harness.
//
// Format (big-endian). The file is a flat list of chunks:
//     u32 tag | u32 length | payload[length] | i32 trailer = -(length + 8)
// The trailer lets us walk the file backwards from the end. The flattened
// image is a chunk with tag 0x01000500 whose payload starts:
//     f64 timestamp | i32 layer_id = -1 | i32 kind = 0 | u32 png_size | PNG...
// ibisPaint writes it near the end of the file, so a backward walk normally
// finds it within a couple of chunks without reading the rest of the file.

#pragma once
#include <cstdint>
#include <cstring>

namespace ipv {

const uint32_t TAG_FIRST = 0x01000100;  // first chunk of every .ipv seen so far
const uint32_t TAG_IMAGE = 0x01000500;
const uint32_t MAX_PNG   = 256u * 1024u * 1024u;

struct Span { uint64_t offset; uint32_t length; };

inline uint32_t be32(const uint8_t* p) {
    return (uint32_t(p[0]) << 24) | (uint32_t(p[1]) << 16) | (uint32_t(p[2]) << 8) | p[3];
}

// Reader: callable as bool rd(uint64_t offset, void* buf, uint32_t len),
// returning true only if all len bytes were read.

template <class Reader>
bool read_chunk_header(Reader& rd, uint64_t off, uint64_t size, uint32_t& tag, uint32_t& len) {
    uint8_t h[8];
    if (off + 12 > size || !rd(off, h, 8)) return false;
    tag = be32(h);
    len = be32(h + 4);
    if (off + 12 + uint64_t(len) > size) return false;
    uint8_t t[4];
    if (!rd(off + 8 + len, t, 4)) return false;
    return int64_t(int32_t(be32(t))) == -(int64_t(len) + 8);
}

// If the chunk at `off` is the flattened composite, return where its PNG is.
template <class Reader>
bool composite_png(Reader& rd, uint64_t off, uint32_t len, Span& out) {
    if (len < 28) return false;
    uint8_t p[64];
    uint32_t n = len < 64 ? len : 64;
    if (!rd(off + 8, p, n)) return false;
    if (int32_t(be32(p + 8)) != -1 || int32_t(be32(p + 12)) != 0) return false;
    static const uint8_t sig[8] = {0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A};
    for (uint32_t i = 16; i + 8 <= n; ++i) {
        if (std::memcmp(p + i, sig, 8) != 0) continue;
        uint32_t avail = len - i, plen = avail;
        uint32_t declared = be32(p + i - 4);          // size field just before the PNG
        if (declared > 0 && declared <= avail) plen = declared;
        if (plen > MAX_PNG) return false;
        out.offset = off + 8 + i;
        out.length = plen;
        return true;
    }
    return false;
}

// Find the most recent flattened-artwork PNG. Returns false if the file is
// not an .ipv or contains no composite.
template <class Reader>
bool find_composite(Reader& rd, uint64_t size, Span& out) {
    uint8_t first[4];
    if (size < 12 || !rd(0, first, 4) || be32(first) != TAG_FIRST) return false;

    // 1) Backward walk using the trailers (fast path).
    uint64_t end = size;
    while (end >= 12) {
        uint8_t t[4];
        if (!rd(end - 4, t, 4)) break;
        int64_t neg = int32_t(be32(t));
        if (neg > -8) break;
        uint64_t total = uint64_t(-neg) + 4;           // header + payload + trailer
        if (total > end) break;
        uint64_t off = end - total;
        uint32_t tag, len;
        if (!read_chunk_header(rd, off, size, tag, len)) break;
        if (tag == TAG_IMAGE && composite_png(rd, off, len, out)) return true;
        end = off;
    }
    if (end == 0) return false;                         // walked the whole file, none found

    // 2) The backward walk hit something unexpected: fall back to a forward
    //    walk and keep the last composite found before any damage.
    bool found = false;
    uint64_t off = 0;
    while (off + 12 <= size) {
        uint32_t tag, len;
        if (!read_chunk_header(rd, off, size, tag, len)) break;
        Span s;
        if (tag == TAG_IMAGE && composite_png(rd, off, len, s)) { out = s; found = true; }
        off += 12 + uint64_t(len);
    }
    return found;
}

}  // namespace ipv
