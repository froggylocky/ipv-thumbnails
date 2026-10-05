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
const real = path.join(__dirname, 'samples');
if (fs.existsSync(real)) {
  for (const name of fs.readdirSync(real).filter((f) => f.endsWith('.ipv'))) {
    const info = IPV.parse(fs.readFileSync(path.join(real, name)));
    check(info.composite !== null && info.complete, `tests/samples/${name}: parsed (${info.layers.length} layers)`);
  }
}
process.exit(failures ? 1 : 0);
