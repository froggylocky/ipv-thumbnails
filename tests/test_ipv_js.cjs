// Tests docs/ipv.js (the browser parser) in Node against the generated samples.
//   node tests/test_ipv_js.cjs samples
const fs = require('fs');
const path = require('path');
const IPV = require('../docs/ipv.js');

const dir = process.argv[2] || 'samples';
let failures = 0;
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) failures++; };
const pngSize = (png) => {
  const dv = new DataView(png.buffer, png.byteOffset, png.byteLength);
  return [dv.getUint32(16), dv.getUint32(20)];   // IHDR width, height
};

for (const [name, w, h] of [['good_small.ipv', 64, 48], ['good_large.ipv', 600, 300]]) {
  const buf = fs.readFileSync(path.join(dir, name));
  const png = IPV.findComposite(buf);
  check(png && png[0] === 0x89 && png[1] === 0x50, `${name}: composite PNG found`);
  if (png) check(pngSize(png).join('x') === `${w}x${h}`, `${name}: PNG is ${w}x${h}`);
  const info = IPV.parse(buf);
  check(info.complete && info.composite && Buffer.compare(Buffer.from(info.composite), Buffer.from(png)) === 0,
        `${name}: full parse agrees with fast path`);
}
for (const name of fs.readdirSync(dir).filter((f) => f.startsWith('bad_'))) {
  const buf = fs.readFileSync(path.join(dir, name));
  check(IPV.findComposite(buf) === null, `${name}: rejected`);
}
// Timelapse history parser (docs/timelapse.js)
const TL = require('../docs/timelapse.js');
{
  const h = TL.parseHistory(fs.readFileSync(path.join(dir, 'history.ipv')));
  const by = (type) => h.events.filter((e) => e.type === type);
  const stack = by('stack')[0], props = by('props')[0], stroke = by('stroke')[0], fill = by('fill')[0];
  check(stack && JSON.stringify(stack.stack) === '[0,1]', 'history: layer stack after the change is [0,1]');
  check(props && props.records.length === 2 && props.records[1].clip && props.records[1].opacity === 0.5, 'history: layer settings (clipping, opacity) read');
  check(stroke && stroke.layer === 1 && stroke.pts.length === 6 && stroke.size === 12.5 && stroke.pts[0] === 10.5, 'history: stroke on layer 1 with 3 points, size 12.5');
  check(fill && fill.layer === 0 && fill.x === 7 && fill.y === 9, 'history: fill on layer 0 tapped at (7, 9)');
  check(h.finalTable && h.finalTable.map((r) => r.id).join() === '0,1' && h.finalTable[0].visible && h.finalTable[1].clip, 'history: final layer table (order, visibility, clipping)');
  check(h.steps === 2, `history: 2 replay steps (got ${h.steps})`);
  const plain = TL.parseHistory(fs.readFileSync(path.join(dir, 'good_small.ipv')));
  check(plain.steps === 0 && !(plain.finalTable && plain.finalTable.length), 'history: file without history has no replay steps');
  let threw = false; try { TL.parseHistory(fs.readFileSync(path.join(dir, 'bad_not_ipv.ipv'))); } catch (e) { threw = true; }
  check(threw, 'history: non-.ipv file rejected');
}

const real = path.join(__dirname, 'samples');
if (fs.existsSync(real)) {
  for (const name of fs.readdirSync(real).filter((f) => f.endsWith('.ipv'))) {
    const info = IPV.parse(fs.readFileSync(path.join(real, name)));
    check(info.composite !== null && info.complete, `tests/samples/${name}: parsed (${info.layers.length} layers)`);
    const h = TL.parseHistory(fs.readFileSync(path.join(real, name)));
    check(h.steps > 0 && h.finalTable && h.finalTable.length > 0, `tests/samples/${name}: history has ${h.steps} replay steps`);
  }
}
process.exit(failures ? 1 : 0);
