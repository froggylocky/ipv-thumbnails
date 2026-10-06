/* timelapse.js - replay the drawing history stored in an ibisPaint .ipv file.
 *
 * ibisPaint records every action in the .ipv. This file reads the parts needed
 * to replay how a picture was made:
 *   0x02000300  brush stroke: colour, size, layer position, and its points
 *   0x02000400  bucket fill: its layer and the point that was tapped
 *   0x03000600  layer stack before/after adding, deleting or moving layers
 *   0x03000400  every layer's visibility / clipping / opacity at that moment
 *   0x01000600  the final layer table (order, visibility, clipping, opacity)
 *
 * Rebuilding ibisPaint's brushes exactly isn't possible, so the replay works
 * the other way round: each layer's real final pixels start hidden, and every
 * stroke uncovers them along its path. A fill's result isn't stored (only undo
 * data is), so a fill uncovers the connected patch of paint around the tapped
 * point. The
 * picture appears in the order and shapes it was drawn, with the real colours
 * and textures, and the last moment fades into ibisPaint's own finished image.
 */
(function (root) {
  'use strict';

  const T = {
    STROKE: 0x02000300, POINT: 0x02000301, FILL: 0x02000400,
    PROPS: 0x03000400, PROP_RECORD: 0x03000402, STACK: 0x03000600, STACK_ID: 0x03000603,
    IMAGE: 0x01000500, LAYER_TABLE: 0x01000600, FIRST: 0x01000100,
  };

  // ---------------------------------------------------------------- reading helpers
  function chunkAt(dv, off, end) {
    if (off < 0 || off + 12 > end) return null;
    const tag = dv.getUint32(off), len = dv.getUint32(off + 4);
    if (off + 12 + len > end) return null;
    if (dv.getInt32(off + 8 + len) !== -(len + 8)) return null;
    return { tag, len };
  }

  // All well-formed sub-chunks with `tag` inside [start, end), found by scanning.
  function findAll(dv, start, end, tag, wantLen) {
    const out = [];
    for (let k = start; k + 12 <= end;) {
      if (dv.getUint32(k) === tag) {
        const c = chunkAt(dv, k, end);
        if (c && (wantLen === undefined || c.len === wantLen)) { out.push(k); k += 12 + c.len; continue; }
      }
      k++;
    }
    return out;
  }

  function hasPng(u8, start, end) {
    for (let k = start; k + 4 <= end; k++) if (u8[k] === 0x89 && u8[k + 1] === 0x50 && u8[k + 2] === 0x4e && u8[k + 3] === 0x47) return true;
    return false;
  }

  // Layer records: [{id, visible, clip, opacity}]
  function propRecords(dv, start, end) {
    return findAll(dv, start, end, T.PROP_RECORD).map((k) => {
      const f = dv.getUint8(k + 12);
      return { id: dv.getInt32(k + 8), visible: (f & 1) !== 0, clip: (f & 2) !== 0, opacity: dv.getFloat32(k + 13) };
    });
  }

  // A stack entry holds the layer list before and after the change, each ending in -1.
  function stackLists(dv, start, end) {
    const ids = findAll(dv, start, end, T.STACK_ID, 4).map((k) => dv.getInt32(k + 8));
    const lists = [];
    let cur = [];
    for (const id of ids) {
      if (id === -1) { lists.push(cur); cur = []; } else if (!cur.includes(id)) cur.push(id);
    }
    return lists;
  }

  // ---------------------------------------------------------------- history
  function parseHistory(buf) {
    const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    if (u8.length < 12 || dv.getUint32(0) !== T.FIRST) throw new Error('This is not an ibisPaint .ipv file.');
    const events = [];
    let stack = [], finalTable = null, strokes = 0, fills = 0;

    for (let off = 0; ;) {
      const c = chunkAt(dv, off, u8.length);
      if (!c) break;
      const p = off + 8, end = p + c.len;

      if (c.tag === T.STACK) {
        const lists = stackLists(dv, p, end);
        const after = lists.length >= 2 ? lists[1] : lists[0];
        const before = lists.length >= 2 ? lists[0] : stack;
        if (after) {
          const removed = before.filter((id) => !after.includes(id));
          const added = after.filter((id) => !before.includes(id));
          // A removed layer that was merged down hands its painted area to the layer below it.
          const mergeInto = {};
          for (const id of removed) {
            const i = before.indexOf(id);
            if (i > 0 && after.includes(before[i - 1])) mergeInto[id] = before[i - 1];
          }
          events.push({ type: 'stack', stack: after.slice(), removed, mergeInto });
          // Layers added together with picture data are imported images: show them whole.
          if (added.length && (c.len > 60000 || hasPng(u8, p, end))) events.push({ type: 'reveal', ids: added, visual: true });
          stack = after.slice();
        }
      } else if (c.tag === T.PROPS) {
        const recs = propRecords(dv, p, end).filter((r) => r.id >= 0);
        if (recs.length) events.push({ type: 'props', records: recs });
      } else if (c.tag === T.STROKE && c.len >= 40) {
        const tool = dv.getUint32(p + 16), position = dv.getUint32(p + 32);
        const points = findAll(dv, p + 40, end, T.POINT, 16);
        if (tool === 0 && points.length && position >= 1 && position <= stack.length) {
          const pts = new Float32Array(points.length * 2);
          points.forEach((k, i) => { pts[2 * i] = dv.getFloat32(k + 16); pts[2 * i + 1] = dv.getFloat32(k + 20); });
          const last = points[points.length - 1] + 28;
          let size = last + 40 <= end ? dv.getFloat32(last + 36) : NaN;
          if (!(size > 0.3 && size < 2000)) size = 8;
          events.push({ type: 'stroke', layer: stack[position - 1], pts, size, visual: true });
          strokes++;
        }
      } else if (c.tag === T.FILL) {
        // tap point(s) as 0x02000301 sub-chunks, then later a nested layer snapshot:
        // ... 01000500 len | f64 | i32 layerId | i32 kind | u8 u8 | u32 size | RPNG (undo data)
        let q = -1;
        for (let k = p; k + 4 <= end; k++) if (u8[k] === 0x52 && u8[k + 1] === 0x50 && u8[k + 2] === 0x4e && u8[k + 3] === 0x47) { q = k; break; }
        const hdr = q - 30, tap = findAll(dv, p + 16, q > 0 ? q : end, T.POINT, 16)[0];
        if (q > p + 16 && tap !== undefined && dv.getUint32(hdr) === T.IMAGE) {
          events.push({ type: 'fill', layer: dv.getInt32(hdr + 16), x: dv.getFloat32(tap + 16), y: dv.getFloat32(tap + 20), visual: true });
          fills++;
        }
      } else if (c.tag === T.LAYER_TABLE) {
        const recs = propRecords(dv, p, end);
        finalTable = recs.filter((r) => r.id >= 0);
      }
      off = end + 4;
    }
    return { events, finalTable, strokes, fills, steps: events.filter((e) => e.visual).length };
  }

  // ---------------------------------------------------------------- player
  // `layers`: Map id -> {canvas (full-size final pixels), bw, bh, bx, by} with bx/by the
  // layer's area top-left in canvas pixels. `finalImage`: ibisPaint's flattened picture.
  class Player {
    constructor(history, layers, finalImage, width, height, maxSize) {
      this.h = history;
      this.W = width; this.H = height;
      this.s = Math.min(1, (maxSize || 1024) / Math.max(width, height));
      this.out = document.createElement('canvas');
      this.out.width = Math.round(width * this.s); this.out.height = Math.round(height * this.s);
      this.final = finalImage;
      this.scratch = document.createElement('canvas');
      this.group = document.createElement('canvas');
      this.group.width = this.out.width; this.group.height = this.out.height;
      this.layers = new Map();
      for (const [id, L] of layers) {
        const s = this.s, x = Math.floor(L.bx * s), y = Math.floor(L.by * s);
        const w = Math.max(1, Math.ceil((L.bx + L.bw) * s) - x), h = Math.max(1, Math.ceil((L.by + L.bh) * s) - y);
        const src = document.createElement('canvas');
        src.width = w; src.height = h;
        src.getContext('2d').drawImage(L.canvas, L.bx, L.by, L.bw, L.bh, L.bx * s - x, L.by * s - y, L.bw * s, L.bh * s);
        const shown = document.createElement('canvas');
        shown.width = w; shown.height = h;
        this.layers.set(id, { src, shown, x, y, pattern: null });
      }
      this.visualIndex = this.h.events.map((e, i) => (e.visual ? i : -1)).filter((i) => i >= 0);
      this.reset();
    }

    reset() {
      for (const L of this.layers.values()) L.shown.getContext('2d').clearRect(0, 0, L.shown.width, L.shown.height);
      this.stack = []; this.props = new Map(); this.painted = new Map();   // painted: id -> events that painted it
      this.next = 0; this.step = 0;
    }

    get steps() { return this.visualIndex.length; }

    // Apply history up to (not including) visual step `target`.
    seek(target) {
      target = Math.max(0, Math.min(this.steps, target));
      if (target < this.step) this.reset();
      const stopAt = target < this.steps ? this.visualIndex[target] : this.h.events.length;
      while (this.next < stopAt) this.apply(this.h.events[this.next++]);
      this.step = target;
    }

    apply(e) {
      if (e.type === 'stack') {
        for (const id of e.removed) {
          const into = e.mergeInto[id];
          if (into !== undefined) for (const pe of this.painted.get(id) || []) this.paint(into, pe);
        }
        this.stack = e.stack;
      } else if (e.type === 'props') {
        for (const r of e.records) this.props.set(r.id, r);
      } else if (e.type === 'stroke' || e.type === 'fill') {
        if (!this.painted.has(e.layer)) this.painted.set(e.layer, []);
        this.painted.get(e.layer).push(e);
        this.paint(e.layer, e);
      } else if (e.type === 'reveal') {
        for (const id of e.ids) {
          const L = this.layers.get(id);
          if (L) { const g = L.shown.getContext('2d'); g.clearRect(0, 0, L.shown.width, L.shown.height); g.drawImage(L.src, 0, 0); }
        }
      }
    }

    // Uncover layer `id`'s real pixels under a stroke's path or a fill's area.
    paint(id, e) {
      const L = this.layers.get(id);
      if (!L) return;                                 // layer was deleted before the end: no pixels to show
      const g = L.shown.getContext('2d'), s = this.s;
      if (!L.pattern) L.pattern = g.createPattern(L.src, 'no-repeat');
      if (e.type === 'stroke') {
        const pts = e.pts, w = Math.max(1.5, e.size * 1.15 * s);
        g.save();
        g.lineCap = 'round'; g.lineJoin = 'round'; g.lineWidth = w;
        g.beginPath();
        g.moveTo(pts[0] * s - L.x, pts[1] * s - L.y);
        if (pts.length === 2) g.lineTo(pts[0] * s - L.x + 0.01, pts[1] * s - L.y);
        for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i] * s - L.x, pts[i + 1] * s - L.y);
        g.globalCompositeOperation = 'destination-out'; g.strokeStyle = '#000'; g.stroke();   // clear, so edges don't double up
        g.globalCompositeOperation = 'source-over'; g.strokeStyle = L.pattern; g.stroke();
        g.restore();
      } else {
        // Fill: uncover the connected patch of paint around the tapped point.
        const W = L.src.width, H = L.src.height;
        const px = Math.round(e.x * s - L.x), py = Math.round(e.y * s - L.y);
        if (px < 0 || py < 0 || px >= W || py >= H) return;
        if (!L.srcData) L.srcData = L.src.getContext('2d').getImageData(0, 0, W, H);
        const src = L.srcData.data;
        if (src[(py * W + px) * 4 + 3] === 0) return;
        const shown = g.getImageData(0, 0, W, H), out = shown.data, seen = new Uint8Array(W * H);
        const stack = [px, py];
        seen[py * W + px] = 1;
        while (stack.length) {                                       // scanline flood fill
          const y = stack.pop(), x0 = stack.pop();
          let x = x0;
          while (x > 0 && src[(y * W + x - 1) * 4 + 3] && !seen[y * W + x - 1]) x--;
          for (; x < W && src[(y * W + x) * 4 + 3]; x++) {
            const i = y * W + x;
            seen[i] = 1;
            out[i * 4] = src[i * 4]; out[i * 4 + 1] = src[i * 4 + 1]; out[i * 4 + 2] = src[i * 4 + 2]; out[i * 4 + 3] = src[i * 4 + 3];
            for (const ny of [y - 1, y + 1]) {
              const j = ny * W + x;
              if (ny >= 0 && ny < H && !seen[j] && src[j * 4 + 3]) { seen[j] = 1; stack.push(x, ny); }
            }
          }
        }
        g.putImageData(shown, 0, 0);
      }
    }

    // Draw the current state. `fade` (0..1) blends towards the finished picture.
    render(fade) {
      const out = this.out, g = out.getContext('2d');
      g.clearRect(0, 0, out.width, out.height);
      const group = this.group, gg = group.getContext('2d');
      let base = null, baseOpacity = 1;
      const flush = () => {
        if (base) { g.globalAlpha = baseOpacity; g.drawImage(group, 0, 0); g.globalAlpha = 1; }
        base = null;
      };
      for (const id of this.stack) {                   // bottom -> top
        const L = this.layers.get(id), P = this.props.get(id) || { visible: true, clip: false, opacity: 1 };
        if (!P.clip) {
          flush();
          if (!P.visible || !L) { base = null; continue; }
          gg.clearRect(0, 0, group.width, group.height);
          gg.drawImage(L.shown, L.x, L.y);
          base = id; baseOpacity = P.opacity;
        } else if (base !== null && P.visible && L) {
          // Clipping layer: only where the layer it's clipped to has paint.
          gg.globalCompositeOperation = 'source-atop'; gg.globalAlpha = P.opacity;
          gg.drawImage(L.shown, L.x, L.y);
          gg.globalCompositeOperation = 'source-over'; gg.globalAlpha = 1;
        }
      }
      flush();
      if (fade > 0 && this.final) { g.globalAlpha = fade; g.drawImage(this.final, 0, 0, out.width, out.height); g.globalAlpha = 1; }
      return out;
    }
  }

  const IPVTimelapse = { parseHistory, Player };
  if (typeof module !== 'undefined' && module.exports) module.exports = IPVTimelapse;
  else root.IPVTimelapse = IPVTimelapse;
})(typeof self !== 'undefined' ? self : globalThis);
