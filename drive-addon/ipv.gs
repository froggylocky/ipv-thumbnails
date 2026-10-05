/* ipv.js - read ibisPaint X .ipv files in the browser (and in Node, for tests).
 *
 * Format (big-endian). The file is a flat list of chunks:
 *     u32 tag | u32 length | payload[length] | i32 trailer = -(length + 8)
 * Tag 0x01000500 holds images: f64 timestamp | i32 layerId | i32 kind | ...
 *   layerId -1, kind 0: the flattened artwork, stored as a normal PNG.
 *   kind 1: one layer, in an "RPNG" block (see parseRpng). Everything in a
 *   layer is stored bottom-up (OpenGL style), including the packed PNG's rows.
 */
(function (root) {
  'use strict';

  const TAG_FIRST = 0x01000100;
  const TAG_INFO  = 0x01000200;
  const TAG_IMAGE = 0x01000500;
  const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

  function bytes(buf) {
    return buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  }
  function dataView(u8) {
    return new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  }

  // Returns {tag, len} if a well-formed chunk starts at `off`, else null.
  function chunkAt(dv, off) {
    const size = dv.byteLength;
    if (off < 0 || off + 12 > size) return null;
    const tag = dv.getUint32(off), len = dv.getUint32(off + 4);
    if (off + 12 + len > size) return null;
    if (dv.getInt32(off + 8 + len) !== -(len + 8)) return null;
    return { tag, len };
  }

  function isIpv(buf) {
    const u8 = bytes(buf);
    return u8.length >= 12 && dataView(u8).getUint32(0) === TAG_FIRST;
  }

  // If the image chunk at `off` is the flattened composite, return its PNG bytes.
  function compositeIn(u8, dv, off, len) {
    if (len < 28) return null;
    const p = off + 8;
    if (dv.getInt32(p + 8) !== -1 || dv.getInt32(p + 12) !== 0) return null;
    const n = Math.min(len, 64);
    for (let i = 16; i + 8 <= n; i++) {
      let match = true;
      for (let k = 0; k < 8; k++) if (u8[p + i + k] !== PNG_SIG[k]) { match = false; break; }
      if (!match) continue;
      const avail = len - i;
      const declared = dv.getUint32(p + i - 4);   // size field just before the PNG
      const plen = declared > 0 && declared <= avail ? declared : avail;
      return u8.subarray(p + i, p + i + plen);
    }
    return null;
  }

  // The most recent flattened-artwork PNG, or null. Walks backwards from the
  // end (the composite is near the end), falling back to a forward walk.
  function findComposite(buf) {
    const u8 = bytes(buf);
    if (!isIpv(u8)) return null;
    const dv = dataView(u8);
    let end = u8.length;
    while (end >= 12) {
      const neg = dv.getInt32(end - 4);
      if (neg > -8) break;
      const off = end - (-neg + 4);
      const c = chunkAt(dv, off);
      if (!c) break;
      if (c.tag === TAG_IMAGE) {
        const png = compositeIn(u8, dv, off, c.len);
        if (png) return png;
      }
      end = off;
    }
    if (end === 0) return null;
    let found = null;
    for (let off = 0; ; ) {
      const c = chunkAt(dv, off);
      if (!c) break;
      if (c.tag === TAG_IMAGE) found = compositeIn(u8, dv, off, c.len) || found;
      off += 12 + c.len;
    }
    return found;
  }

  // RPNG layout, offsets from the "RPNG" magic:
  //  0 "RPNG" | 4 u32 0x2d | 8 u32 0 | 12 u8 flag | 13 u32 canvasW | 17 canvasH
  //  21 boxW | 25 boxH | 29 boxX | 33 boxY (from the bottom) | 37 pngW | 41 pngH
  //  45 padding | 49 u32 | 53 u32 spanBytes | 57 u16 (skip, run) pairs
  //  then u32 pngSize | PNG of the used pixels, packed end to end.
  function parseRpng(u8, dv, q, end) {
    if (q + 57 > end) return null;
    const f = [];
    for (let k = 0; k < 9; k++) f.push(dv.getUint32(q + 13 + 4 * k));
    const [cw, ch, bw, bh, bx, by, pw, ph, pad] = f;
    const nspan = dv.getUint32(q + 53);
    const p = q + 57 + nspan;
    if (p + 4 > end) return null;
    const spans = new Uint16Array(nspan >> 1);
    for (let k = 0; k < spans.length; k++) spans[k] = dv.getUint16(q + 57 + 2 * k);
    const plen = dv.getUint32(p);
    if (p + 4 + plen > end) return null;
    return { cw, ch, bw, bh, bx, by, pw, ph, pad, spans, png: u8.subarray(p + 4, p + 4 + plen) };
  }

  // Full parse: composite PNG, app version, and the latest snapshot of each layer.
  function parse(buf) {
    const u8 = bytes(buf);
    if (!isIpv(u8)) throw new Error('This is not an ibisPaint .ipv file.');
    const dv = dataView(u8);
    const layers = new Map();
    let composite = null, version = null, off = 0;
    for (;;) {
      const c = chunkAt(dv, off);
      if (!c) break;
      const p = off + 8;
      if (c.tag === TAG_INFO && !version) {
        const text = String.fromCharCode.apply(null, u8.subarray(p, p + Math.min(c.len, 200)));
        const m = /ver\.[0-9][0-9.]*/.exec(text);
        if (m) version = m[0];
      } else if (c.tag === TAG_IMAGE && c.len >= 16) {
        const id = dv.getInt32(p + 8), kind = dv.getInt32(p + 12);
        if (kind === 0) {
          composite = compositeIn(u8, dv, off, c.len) || composite;
        } else if (kind === 1 && id >= 0) {
          let q = -1;
          for (let i = p + 16; i < Math.min(p + 40, p + c.len - 4); i++) {
            if (u8[i] === 0x52 && u8[i + 1] === 0x50 && u8[i + 2] === 0x4e && u8[i + 3] === 0x47) { q = i; break; }
          }
          if (q < 0) layers.set(id, { id, empty: true });
          else {
            const info = parseRpng(u8, dv, q, p + c.len);
            layers.set(id, info ? Object.assign({ id, empty: false }, info) : { id, empty: true, damaged: true });
          }
        }
      }
      off += 12 + c.len;
    }
    const complete = off === u8.length;
    return { composite, version, complete, layers: [...layers.values()].sort((a, b) => a.id - b.id) };
  }

  // Rebuild a layer as a top-down RGBA canvas from its decoded packed PNG.
  // `rgba` is the packed PNG decoded normally (top row first), pw x ph pixels.
  function assembleLayer(layer, rgba) {
    const { cw, ch, bw, bx, by, pw, ph, spans } = layer;
    const out = new Uint8ClampedArray(cw * ch * 4);
    const total = pw * ph;
    let pos = 0, src = 0;
    for (let i = 0; i < spans.length; i += 2) {
      pos += spans[i];
      const run = i + 1 < spans.length ? spans[i + 1] : 0;
      for (let j = 0; j < run; j++, pos++, src++) {
        if (src >= total) return out;
        const si = ((ph - 1 - Math.floor(src / pw)) * pw + (src % pw)) * 4;   // packed PNG is bottom-up
        const x = bx + (pos % bw);
        const y = ch - 1 - (by + Math.floor(pos / bw));                        // box rows are bottom-up
        if (x < 0 || x >= cw || y < 0 || y >= ch) continue;
        const di = (y * cw + x) * 4;
        out[di] = rgba[si]; out[di + 1] = rgba[si + 1]; out[di + 2] = rgba[si + 2]; out[di + 3] = rgba[si + 3];
      }
    }
    return out;
  }

  // Browser only: decode PNG bytes to {data, width, height}.
  async function decodePng(png) {
    const bmp = await createImageBitmap(new Blob([png], { type: 'image/png' }),
      { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
    const c = document.createElement('canvas');
    c.width = bmp.width; c.height = bmp.height;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bmp, 0, 0);
    bmp.close();
    return { data: ctx.getImageData(0, 0, c.width, c.height).data, width: c.width, height: c.height };
  }

  const IPV = { isIpv, findComposite, parse, assembleLayer, decodePng };
  if (typeof module !== 'undefined' && module.exports) module.exports = IPV;
  else root.IPV = IPV;
})(typeof self !== 'undefined' ? self : globalThis);
