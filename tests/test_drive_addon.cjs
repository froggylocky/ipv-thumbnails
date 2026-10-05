// Runs drive-addon/*.gs against simulated Apps Script services, including a
// strict CardService that only allows methods that exist in Google's API.
//   node tests/test_drive_addon.cjs samples
const fs = require('fs'), vm = require('vm'), crypto = require('crypto'), path = require('path'), zlib = require('zlib');
const Png = require('../drive-addon/Png.gs');
const IPVnode = require('../docs/ipv.js');

const sampleDir = process.argv[2] || 'samples';
const read = (n) => fs.readFileSync(path.join(sampleDir, n));
let failures = 0;
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) failures++; };

// ---------------------------------------------------------------- an .ipv whose artwork PNG is over 2 MB
function crc32(b) { let c = ~0; for (const x of b) { c ^= x; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; } return ~c >>> 0; }
function makePng(w, h, pixel) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw.set(pixel(x, y), y * (w * 4 + 1) + 1 + x * 4);
  const chunk = (t, d) => { const len = Buffer.alloc(4); len.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
function makeIpv(png) {
  const chunk = (tag, p) => { const h = Buffer.alloc(8); h.writeUInt32BE(tag, 0); h.writeUInt32BE(p.length, 4); const t = Buffer.alloc(4); t.writeInt32BE(-(p.length + 8)); return Buffer.concat([h, p, t]); };
  const comp = Buffer.alloc(20); comp.writeDoubleBE(1.7e9, 0); comp.writeInt32BE(-1, 8); comp.writeInt32BE(0, 12); comp.writeUInt32BE(png.length, 16);
  return Buffer.concat([chunk(0x01000100, Buffer.alloc(16)), chunk(0x01000500, Buffer.concat([comp, png]))]);
}
let seed = 7; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const bigPng = makePng(1400, 1400, (x, y) => [(x * 255 / 1400) + rnd() * 24 & 255, (y * 255 / 1400) + rnd() * 24 & 255, 128 + rnd() * 24 & 255, 255]);

// ---------------------------------------------------------------- fake Drive
const files = [
  { id: 'a', name: 'Untitled1.ipv', data: read('good_large.ipv') },
  { id: 'b', name: 'groflock.ipv', data: read('good_small.ipv') },
  { id: 'c', name: 'notes.txt', data: Buffer.from('hello') },
  { id: 'd', name: 'broken.ipv', data: read('bad_random.ipv') },
  { id: 'e', name: 'huge <art>.ipv', data: makeIpv(bigPng) },
];
const updates = [], store = {}, triggers = [];
let clock = 1e12, tickPerFile = 0;
const signed = (buf) => Array.from(buf, (b) => (b > 127 ? b - 256 : b));
const unsigned = (arr) => Buffer.from(arr.map((b) => b & 255));
function fileObj(f) {
  return { getId: () => f.id, getName: () => f.name, getSize: () => f.data.length, getLastUpdated: () => new Date(0),
           getBlob: () => ({ getBytes: () => signed(f.data) }) };
}
function iterator(pos) {
  return { hasNext: () => pos < files.length, next: () => { clock += tickPerFile; return fileObj(files[pos++]); },
           getContinuationToken: () => 'tok:' + pos };
}

// ---------------------------------------------------------------- strict CardService
const API = {
  CardBuilder: ['setHeader', 'addSection', 'build', 'setName', 'setFixedFooter', 'addCardAction', 'setDisplayStyle', 'setPeekCardHeader'],
  CardHeader: ['setTitle', 'setSubtitle', 'setImageUrl', 'setImageStyle', 'setImageAltText'],
  CardSection: ['setHeader', 'addWidget', 'setCollapsible', 'setNumUncollapsibleWidgets'],
  TextParagraph: ['setText'],
  DecoratedText: ['setText', 'setTopLabel', 'setBottomLabel', 'setWrapText', 'setSwitchControl', 'setButton', 'setStartIcon', 'setEndIcon', 'setOnClickAction', 'setOpenLink'],
  Image: ['setImageUrl', 'setAltText', 'setOnClickAction', 'setOpenLink'],
  TextButton: ['setText', 'setOnClickAction', 'setOpenLink', 'setTextButtonStyle', 'setDisabled', 'setBackgroundColor'],
  Switch: ['setFieldName', 'setValue', 'setSelected', 'setOnChangeAction', 'setControlType'],
  Action: ['setFunctionName', 'setParameters', 'setLoadIndicator'],
  OpenLink: ['setUrl', 'setOpenAs', 'setOnClose'],
  ActionResponseBuilder: ['setNavigation', 'setNotification', 'setOpenLink', 'setStateChanged', 'build'],
  Navigation: ['updateCard', 'pushCard', 'popCard', 'popToRoot'],
  Notification: ['setText'],
};
function builder(type) {
  const obj = { _type: type, _calls: [] };
  return new Proxy(obj, {
    get(t, prop) {
      if (prop in t) return t[prop];
      if (typeof prop !== 'string' || !API[type].includes(prop)) throw new TypeError(`CardService ${type} has no method ${String(prop)}`);
      return (...args) => {
        if (prop === 'setParameters') for (const v of Object.values(args[0])) if (typeof v !== 'string') throw new TypeError('setParameters values must be strings');
        t._calls.push([prop, args]);
        return prop === 'build' ? t : new Proxy(t, this);
      };
    },
  });
}
const CardService = { TextButtonStyle: { FILLED: 'FILLED', TEXT: 'TEXT', OUTLINED: 'OUTLINED' }, ImageStyle: { SQUARE: 'SQUARE', CIRCLE: 'CIRCLE' } };
for (const t of Object.keys(API)) CardService['new' + t] = () => builder(t);
const flat = (node, out = []) => {   // all [method, args] pairs anywhere in a card, depth-first
  if (node && node._calls) for (const [m, args] of node._calls) { out.push([m, args]); args.forEach((a) => flat(a, out)); }
  return out;
};
const calls = (card, m) => flat(card).filter(([x]) => x === m).map(([, a]) => a[0]);

// ---------------------------------------------------------------- Apps Script globals
const ctx = {
  console: { log: () => {} },
  CardService,
  Date: Object.assign(function (...a) { return new Date(...a); }, { now: () => clock }),
  DriveApp: {
    searchFiles: () => iterator(0),
    continueFileIterator: (t) => iterator(Number(t.split(':')[1])),
    getFileById: (id) => { const f = files.find((x) => x.id === id); if (!f) throw new Error('File not found'); return fileObj(f); },
  },
  Drive: { Files: {
    get: (id) => { const f = files.find((x) => x.id === id); return { md5Checksum: crypto.createHash('md5').update(f.data).digest('hex'), size: String(f.data.length) }; },
    update: (res, id, media, opts) => { updates.push({ id, res, media, opts }); return { id }; } } },
  Utilities: {
    newBlob: (bytes) => ({ bytes }),
    gzip: (blob) => { const gz = zlib.gzipSync(unsigned(blob.bytes)); return { getBytes: () => signed(gz) }; },
    base64Encode: (arr) => unsigned(arr).toString('base64'),
    base64EncodeWebSafe: (arr) => unsigned(arr).toString('base64').replace(/\+/g, '-').replace(/\//g, '_'),
    formatDate: (d, tz) => `${d.toISOString()} (${tz})`,
  },
  Session: { getScriptTimeZone: () => 'Etc/UTC' },
  PropertiesService: { getUserProperties: () => ({
    getProperty: (k) => (k in store ? store[k] : null), setProperty: (k, v) => { store[k] = String(v); },
    deleteAllProperties: () => { for (const k of Object.keys(store)) delete store[k]; } }) },
  LockService: { getUserLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
  ScriptApp: {
    newTrigger: (fn) => ({ timeBased: () => ({ everyHours: (h) => ({ create: () => triggers.push({ h, getHandlerFunction: () => fn }) }) }) }),
    getProjectTriggers: () => triggers.slice(), deleteTrigger: (t) => triggers.splice(triggers.indexOf(t), 1) },
};
ctx.Date.prototype = Date.prototype;
ctx.globalThis = ctx;
vm.createContext(ctx);
const dir = path.join(__dirname, '..', 'drive-addon');
for (const f of ['ipv.gs', 'Png.gs', 'Thumbs.gs', 'Addon.gs']) vm.runInContext(fs.readFileSync(path.join(dir, f), 'utf8'), ctx, { filename: f });
const call = (fn, arg) => { ctx.__arg = arg; return vm.runInContext(`${fn}(globalThis.__arg)`, ctx); };
const sel = (ids, cursor) => ({ drive: { selectedItems: ids.map((id) => ({ id, title: files.find((f) => f.id === id).name })), activeCursorItem: { id: cursor } },
                                commonEventObject: { timeZone: { id: 'Europe/London' } } });

// ---------------------------------------------------------------- tests
let card = call('onHomepage', { commonEventObject: { timeZone: { id: 'America/Los_Angeles' } } });
check(calls(card, 'setText').includes('Add thumbnails now'), 'home: "Add thumbnails now" button');
check(calls(card, 'setSelected')[0] === false, 'home: hourly switch starts off');

card = call('onDriveItemsSelected', sel(['c'], 'c'));
check(calls(card, 'setText').some((t) => /Select an \.ipv file/.test(t)), 'selecting a non-.ipv file shows a hint on the home card');

card = call('onDriveItemsSelected', sel(['a', 'b', 'c'], 'a'));
const img = calls(card, 'setImageUrl').find((u) => u.startsWith('data:'));
const preview = img && Png.decode(Buffer.from(img.split(',')[1], 'base64'));
const art = Png.decode(Buffer.from(IPVnode.findComposite(files[0].data)));
check(preview && preview.width === Math.min(240, art.width), `selection: preview image of the focused file (${preview && `${preview.width}x${preview.height}`}, ${img && img.length} chars)`);
check(calls(card, 'setHeader').includes('2 .ipv files selected'), 'selection: counts only the .ipv files');
const params = calls(card, 'setParameters')[0];
check(params && JSON.parse(params.items).length === 2, 'selection: button carries both .ipv files');

let resp = call('addSelectedAction', { parameters: params });
check(calls(resp, 'setText').includes('2 thumbnails added.'), 'add selected: notification "2 thumbnails added."');
check(updates.length === 2 && updates.every((u) => Buffer.compare(
  Buffer.from(u.res.contentHints.thumbnail.image.replace(/-/g, '+').replace(/_/g, '/'), 'base64'),
  Buffer.from(IPVnode.findComposite(files.find((f) => f.id === u.id).data))) === 0), 'add selected: uploaded thumbnails are the exact artwork');
check(calls(resp, 'setBottomLabel').filter((l) => l === 'Thumbnail added').length === 2, 'add selected: each file shows "Thumbnail added"');
check(!calls(resp, 'setFunctionName').includes('addSelectedAction'), 'add selected: no Continue button when everything is done');

updates.length = 0; tickPerFile = 0;
const origNow = ctx.Date.now; let n = 0;
ctx.Date.now = () => clock + (n++ > 1 ? 60000 : 0);    // time runs out after the first file
resp = call('addSelectedAction', { parameters: params });
ctx.Date.now = origNow;
const cont = calls(resp, 'setParameters')[0];
check(updates.length === 1 && cont && JSON.parse(cont.items).length === 1 && calls(resp, 'setText').includes('Continue'),
  'add selected: stops before the 30 s limit and offers Continue with only the unfinished file');

card = call('onDriveItemsSelected', sel(['d'], 'd'));
check(calls(card, 'setBottomLabel').some((l) => /No finished artwork found/.test(l)), 'damaged file: explains instead of crashing');

updates.length = 0;
card = call('onDriveItemsSelected', sel(['e'], 'e'));
check(calls(card, 'setText').includes('huge &lt;art&gt;.ipv'), 'file names are escaped for card text');
resp = call('addSelectedAction', { parameters: calls(card, 'setParameters')[0] });
const big = updates[0] && Buffer.from(updates[0].res.contentHints.thumbnail.image.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
const bigImg = big && Png.decode(big);
check(bigPng.length > 2 * 1024 * 1024 && big && big.length <= 2 * 1024 * 1024 && bigImg.width < 1400,
  `artwork over 2 MB (${(bigPng.length / 1048576).toFixed(1)} MB) is shrunk to ${bigImg && bigImg.width}px, ${big && (big.length / 1048576).toFixed(2)} MB`);

resp = call('toggleAutoUpdateAction', { commonEventObject: { formInputs: { autoUpdate: { stringInputs: { value: ['on'] } } } } });
check(triggers.length === 1 && calls(resp, 'setSelected')[0] === true && calls(resp, 'setText').includes('Hourly updates are on.'), 'switch on: one hourly trigger, switch shows on');
call('toggleAutoUpdateAction', { commonEventObject: { formInputs: {} } });
check(triggers.length === 0, 'switch off: trigger removed');

call('startOver'); updates.length = 0;
resp = call('runScanAction', { commonEventObject: { timeZone: { id: 'Asia/Tokyo' } } });
check(updates.length === 3, `scan: thumbnails for the 3 good .ipv files (got ${updates.length})`);
check(calls(resp, 'setText').some((t) => /^<b>Last run .*Asia\/Tokyo/.test(t) && /3 added, 0 already done, 1 skipped/.test(t)), 'scan: home card shows the last run in the person\'s time zone');
updates.length = 0;
call('runScanAction', {});
check(updates.length === 0, 'scan again: nothing re-uploaded');

process.exit(failures ? 1 : 0);
