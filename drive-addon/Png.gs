/* Png.gs - minimal PNG decode, resize and encode in plain JavaScript.
 *
 * Apps Script can't resize images, but the add-on needs small previews for the
 * side panel and must shrink artwork that's over Drive's 2 MB thumbnail limit.
 * Supports 8-bit RGB/RGBA non-interlaced PNGs (what ibisPaint writes); anything
 * else makes decode() return null so callers can fall back gracefully.
 */
var Png = (function () {
  'use strict';

  // ---------------------------------------------------------------- inflate (RFC 1951)
  var LBASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
  var LEXT = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
  var DBASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
  var DEXT = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
  var CLORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

  function huffman(lengths, n) {
    var count = new Uint16Array(16), offs = new Uint16Array(16), sym = new Uint16Array(n), i;
    for (i = 0; i < n; i++) count[lengths[i]]++;
    count[0] = 0;
    for (i = 1; i < 16; i++) offs[i] = offs[i - 1] + count[i - 1];
    for (i = 0; i < n; i++) if (lengths[i]) sym[offs[lengths[i]]++] = i;
    return { count: count, sym: sym };
  }

  var FIXED_LIT, FIXED_DIST;
  (function () {
    var l = new Uint8Array(288), i;
    for (i = 0; i < 144; i++) l[i] = 8;
    for (; i < 256; i++) l[i] = 9;
    for (; i < 280; i++) l[i] = 7;
    for (; i < 288; i++) l[i] = 8;
    FIXED_LIT = huffman(l, 288);
    var d = new Uint8Array(30);
    for (i = 0; i < 30; i++) d[i] = 5;
    FIXED_DIST = huffman(d, 30);
  })();

  function inflateRaw(src, start, sizeHint) {
    var pos = start, bitbuf = 0, bitcnt = 0;
    var out = new Uint8Array(Math.max(1024, sizeHint || src.length * 4)), op = 0;

    function need(n) {
      if (op + n <= out.length) return;
      var len = out.length * 2;
      while (len < op + n) len *= 2;
      var bigger = new Uint8Array(len);
      bigger.set(out);
      out = bigger;
    }
    function bits(n) {
      while (bitcnt < n) {
        if (pos >= src.length) throw new Error('PNG data ended early');
        bitbuf |= src[pos++] << bitcnt;
        bitcnt += 8;
      }
      var v = bitbuf & ((1 << n) - 1);
      bitbuf >>>= n;
      bitcnt -= n;
      return v;
    }
    function decode(h) {
      var code = 0, first = 0, index = 0;
      for (var len = 1; len < 16; len++) {
        if (bitcnt === 0) {
          if (pos >= src.length) throw new Error('PNG data ended early');
          bitbuf = src[pos++]; bitcnt = 8;
        }
        code |= bitbuf & 1; bitbuf >>>= 1; bitcnt--;
        var c = h.count[len];
        if (code - c < first) return h.sym[index + (code - first)];
        index += c; first += c; first <<= 1; code <<= 1;
      }
      throw new Error('Bad compressed data in PNG');
    }
    function codes(lit, dist) {
      for (;;) {
        var s = decode(lit);
        if (s < 256) { need(1); out[op++] = s; continue; }
        if (s === 256) return;
        s -= 257;
        if (s >= 29) throw new Error('Bad compressed data in PNG');
        var len = LBASE[s] + bits(LEXT[s]);
        var ds = decode(dist);
        if (ds >= 30) throw new Error('Bad compressed data in PNG');
        var d = DBASE[ds] + bits(DEXT[ds]);
        if (d > op) throw new Error('Bad compressed data in PNG');
        need(len);
        for (var k = 0; k < len; k++, op++) out[op] = out[op - d];
      }
    }

    var last;
    do {
      last = bits(1);
      var type = bits(2);
      if (type === 0) {
        bitbuf = 0; bitcnt = 0;                        // skip to the next byte
        if (pos + 4 > src.length) throw new Error('PNG data ended early');
        var len = src[pos] | (src[pos + 1] << 8);
        pos += 4;
        if (pos + len > src.length) throw new Error('PNG data ended early');
        need(len);
        out.set(src.subarray(pos, pos + len), op);
        op += len; pos += len;
      } else if (type === 1) {
        codes(FIXED_LIT, FIXED_DIST);
      } else if (type === 2) {
        var nlen = bits(5) + 257, ndist = bits(5) + 1, ncode = bits(4) + 4, i;
        var cl = new Uint8Array(19);
        for (i = 0; i < ncode; i++) cl[CLORDER[i]] = bits(3);
        var clh = huffman(cl, 19);
        var lengths = new Uint8Array(nlen + ndist);
        for (i = 0; i < nlen + ndist;) {
          var sym = decode(clh), rep = 0, val = 0;
          if (sym < 16) { lengths[i++] = sym; continue; }
          if (sym === 16) { if (i === 0) throw new Error('Bad compressed data in PNG'); val = lengths[i - 1]; rep = 3 + bits(2); }
          else if (sym === 17) rep = 3 + bits(3);
          else rep = 11 + bits(7);
          if (i + rep > nlen + ndist) throw new Error('Bad compressed data in PNG');
          while (rep--) lengths[i++] = val;
        }
        codes(huffman(lengths.subarray(0, nlen), nlen), huffman(lengths.subarray(nlen), ndist));
      } else {
        throw new Error('Bad compressed data in PNG');
      }
    } while (!last);
    return out.subarray(0, op);
  }

  // ---------------------------------------------------------------- checksums
  var CRC_TABLE = (function () {
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(bytes, start, end) {
    var c = 0xffffffff;
    for (var i = start; i < end; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }
  function adler32(bytes) {
    var a = 1, b = 0;
    for (var i = 0; i < bytes.length;) {
      var end = Math.min(i + 5552, bytes.length);
      for (; i < end; i++) { a += bytes[i]; b += a; }
      a %= 65521; b %= 65521;
    }
    return ((b << 16) | a) >>> 0;
  }

  // ---------------------------------------------------------------- decode
  function u32(b, i) { return ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0; }

  // Returns {width, height, rgba: Uint8Array} or null if unsupported.
  function decode(png) {
    var SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    for (var s = 0; s < 8; s++) if (png[s] !== SIG[s]) return null;
    var w = 0, h = 0, depth = 0, ctype = 0, interlace = 0, parts = [], total = 0;
    for (var p = 8; p + 8 <= png.length;) {
      var len = u32(png, p), type = String.fromCharCode(png[p + 4], png[p + 5], png[p + 6], png[p + 7]);
      if (p + 12 + len > png.length) break;
      if (type === 'IHDR') {
        w = u32(png, p + 8); h = u32(png, p + 12);
        depth = png[p + 16]; ctype = png[p + 17]; interlace = png[p + 20];
      } else if (type === 'IDAT') {
        parts.push(png.subarray(p + 8, p + 8 + len)); total += len;
      } else if (type === 'IEND') break;
      p += 12 + len;
    }
    if (!w || !h || depth !== 8 || (ctype !== 6 && ctype !== 2) || interlace !== 0 || !parts.length) return null;
    var idat = new Uint8Array(total), o = 0;
    parts.forEach(function (x) { idat.set(x, o); o += x.length; });

    var bpp = ctype === 6 ? 4 : 3, stride = w * bpp;
    var raw = inflateRaw(idat, 2, (stride + 1) * h);           // 2 = skip zlib header
    if (raw.length < (stride + 1) * h) throw new Error('PNG image data is incomplete');
    var rgba = new Uint8Array(w * h * 4), prev = new Uint8Array(stride), cur = new Uint8Array(stride);
    for (var y = 0; y < h; y++) {
      var f = raw[y * (stride + 1)], base = y * (stride + 1) + 1, i;
      for (i = 0; i < stride; i++) {
        var x = raw[base + i], a = i >= bpp ? cur[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
        if (f === 1) x += a;
        else if (f === 2) x += b;
        else if (f === 3) x += (a + b) >> 1;
        else if (f === 4) {
          var pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
          x += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        }
        cur[i] = x & 255;
      }
      for (var px = 0; px < w; px++) {
        var di = (y * w + px) * 4, si = px * bpp;
        rgba[di] = cur[si]; rgba[di + 1] = cur[si + 1]; rgba[di + 2] = cur[si + 2];
        rgba[di + 3] = bpp === 4 ? cur[si + 3] : 255;
      }
      var t = prev; prev = cur; cur = t;
    }
    return { width: w, height: h, rgba: rgba };
  }

  // ---------------------------------------------------------------- resize
  // Area-average downscale to fit within maxW x maxH (never enlarges).
  // Averages in premultiplied alpha so transparent edges don't go dark.
  function resize(img, maxW, maxH) {
    var w = img.width, h = img.height, s = Math.min(1, maxW / w, maxH / h);
    var tw = Math.max(1, Math.round(w * s)), th = Math.max(1, Math.round(h * s));
    if (tw === w && th === h) return img;
    var src = img.rgba, out = new Uint8Array(tw * th * 4);
    for (var ty = 0; ty < th; ty++) {
      var y0 = Math.floor(ty * h / th), y1 = Math.max(y0 + 1, Math.floor((ty + 1) * h / th));
      for (var tx = 0; tx < tw; tx++) {
        var x0 = Math.floor(tx * w / tw), x1 = Math.max(x0 + 1, Math.floor((tx + 1) * w / tw));
        var r = 0, g = 0, b = 0, a = 0, n = 0;
        for (var y = y0; y < y1; y++) {
          for (var x = x0, i = (y * w + x0) * 4; x < x1; x++, i += 4) {
            var al = src[i + 3];
            r += src[i] * al; g += src[i + 1] * al; b += src[i + 2] * al; a += al; n++;
          }
        }
        var o = (ty * tw + tx) * 4;
        if (a > 0) { out[o] = Math.round(r / a); out[o + 1] = Math.round(g / a); out[o + 2] = Math.round(b / a); }
        out[o + 3] = Math.round(a / n);
      }
    }
    return { width: tw, height: th, rgba: out };
  }

  // ---------------------------------------------------------------- encode
  // `deflateRaw(Uint8Array) -> Uint8Array` does the compression (see Thumbs.gs
  // for the Apps Script version built on Utilities.gzip).
  function encode(img, deflateRaw) {
    var w = img.width, h = img.height, stride = w * 4, src = img.rgba;
    var raw = new Uint8Array((stride + 1) * h);
    for (var y = 0; y < h; y++) {                               // "Sub" filter: compresses well
      var o = y * (stride + 1), s = y * stride;
      raw[o] = 1;
      for (var i = 0; i < stride; i++) raw[o + 1 + i] = (src[s + i] - (i >= 4 ? src[s + i - 4] : 0)) & 255;
    }
    var def = deflateRaw(raw), ad = adler32(raw);
    var zlib = new Uint8Array(def.length + 6);
    zlib[0] = 0x78; zlib[1] = 0x9c;
    zlib.set(def, 2);
    zlib.set([ad >>> 24, (ad >>> 16) & 255, (ad >>> 8) & 255, ad & 255], def.length + 2);

    var ihdr = [w >>> 24, (w >>> 16) & 255, (w >>> 8) & 255, w & 255, h >>> 24, (h >>> 16) & 255, (h >>> 8) & 255, h & 255, 8, 6, 0, 0, 0];
    var chunks = [['IHDR', ihdr], ['IDAT', zlib], ['IEND', []]];
    var size = 8;
    chunks.forEach(function (c) { size += 12 + c[1].length; });
    var out = new Uint8Array(size), p = 0;
    out.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0); p = 8;
    chunks.forEach(function (c) {
      var len = c[1].length;
      out.set([len >>> 24, (len >>> 16) & 255, (len >>> 8) & 255, len & 255], p);
      for (var k = 0; k < 4; k++) out[p + 4 + k] = c[0].charCodeAt(k);
      out.set(c[1], p + 8);
      var crc = crc32(out, p + 4, p + 8 + len);
      out.set([crc >>> 24, (crc >>> 16) & 255, (crc >>> 8) & 255, crc & 255], p + 8 + len);
      p += 12 + len;
    });
    return out;
  }

  return { decode: decode, resize: resize, encode: encode, inflateRaw: inflateRaw };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = Png;
