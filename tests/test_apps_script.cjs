// Runs drive-script/*.gs against simulated Apps Script services.
//   node tests/test_apps_script.cjs samples
const fs = require('fs'), vm = require('vm'), crypto = require('crypto'), path = require('path');
const dir = path.join(__dirname, '..', 'drive-script');
const sampleDir = process.argv[2] || 'samples';
const SAMPLE = { 'Untitled1.ipv': 'good_large.ipv', 'groflock.ipv': 'good_small.ipv' };
const real = (n) => fs.readFileSync(path.join(sampleDir, SAMPLE[n]));
const IPVnode = require('../docs/ipv.js');
const expectPng = { f1: Buffer.from(IPVnode.findComposite(real('Untitled1.ipv'))), f2: Buffer.from(IPVnode.findComposite(real('groflock.ipv'))) };
const files = [
  { id: 'f1', name: 'Untitled1.ipv', data: real('Untitled1.ipv') },
  { id: 'f2', name: 'groflock.ipv', data: real('groflock.ipv') },
  { id: 'f3', name: 'notes.txt', data: Buffer.from('hello') },
  { id: 'f4', name: 'broken.ipv', data: crypto.randomBytes(4000) },
];
const queries = [], updates = [], store = {}, triggers = [];
let clock = Date.now(), tick = 0;
function iterator(pos) {
  return { hasNext: () => pos < files.length, next: () => { clock += tick; return fileObj(files[pos++]); },
           getContinuationToken: () => 'tok:' + pos };
}
function fileObj(f) {
  return { getId: () => f.id, getName: () => f.name, getSize: () => f.data.length, getLastUpdated: () => new Date(0),
           getBlob: () => ({ getBytes: () => Array.from(f.data, (b) => (b > 127 ? b - 256 : b)) }) };
}
const ctx = {
  console: { log: (m) => logs.push(m) },
  Date: Object.assign(function (...a) { return new Date(...a); }, { now: () => clock }),
  DriveApp: { searchFiles: (q) => { queries.push(q); return iterator(0); },
              continueFileIterator: (t) => iterator(Number(t.split(':')[1])) },
  Drive: { Files: {
    get: (id) => { const f = files.find((x) => x.id === id); return { md5Checksum: crypto.createHash('md5').update(f.data).digest('hex'), size: String(f.data.length) }; },
    update: (res, id, media, opts) => { updates.push({ id, res, media, opts }); return { id }; } } },
  Utilities: { base64EncodeWebSafe: (arr) => Buffer.from(arr.map((b) => b & 255)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_') },
  PropertiesService: { getUserProperties: () => ({
    getProperty: (k) => (k in store ? store[k] : null), setProperty: (k, v) => { store[k] = String(v); },
    deleteAllProperties: () => { for (const k of Object.keys(store)) delete store[k]; } }) },
  LockService: { getUserLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
  ScriptApp: {
    newTrigger: (fn) => ({ timeBased: () => ({ everyHours: (h) => ({ create: () => triggers.push({ fn, h, getHandlerFunction: () => fn }) }) }) }),
    getProjectTriggers: () => triggers.slice(), deleteTrigger: (t) => triggers.splice(triggers.indexOf(t), 1) },
};
// Apps Script has no `module` or `self`; files share one global scope.
ctx.globalThis = ctx; vm.createContext(ctx);
// Date inside the context must still construct real dates
ctx.Date.prototype = Date.prototype;
for (const f of ['ipv.gs', 'Code.gs']) vm.runInContext(fs.readFileSync(`${dir}/${f}`, 'utf8'), ctx, { filename: f });
let logs = [], fails = 0;
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) fails++; };
const run = (fn) => { logs = []; updates.length = 0; return vm.runInContext(`${fn}()`, ctx); };

let r = run('addThumbnails');
check(r === 'Done: 2 added, 0 already done, 1 skipped, 0 failed.', `first run: ${r}`);
check(queries[0] === 'trashed = false', `first run scans everything: "${queries[0]}"`);
for (const u of updates) {
  const t = u.res.contentHints.thumbnail;
  const img = Buffer.from(t.image.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  check(Buffer.compare(img, expectPng[u.id]) === 0 && t.mimeType === 'image/png', `${u.id}: uploaded thumbnail is the exact artwork (${img.length} bytes)`);
  check(u.media === null && u.opts.supportsAllDrives === true, `${u.id}: update called with (resource, id, null, options)`);
}
check(!logs.some((l) => l.includes('notes.txt')), 'non-.ipv files are ignored');
check(logs.some((l) => l.startsWith('Skipped broken.ipv')), 'damaged .ipv reported as skipped');

r = run('addThumbnails');
check(r === 'Done: 0 added, 3 already done, 0 skipped, 0 failed.', `second run: ${r}`);
check(/^trashed = false and modifiedDate > '\d{4}-\d\d-\d\dT/.test(queries[1]), `second run only looks at changed files: "${queries[1]}"`);

const changed = Buffer.from(real('Untitled1.ipv')); changed[100] ^= 1; files[0].data = changed; // "re-uploaded" (content changed)
r = run('addThumbnails');
check(r.startsWith('Done: 1 added') && updates.length === 1 && updates[0].id === 'f1', `after a re-upload: ${r}`);

run('startOver'); tick = 2.5 * 60 * 1000;   // each file "takes" 2.5 minutes
files[0].data = real('Untitled1.ipv');
r = run('addThumbnails');
check(r.startsWith('Paused') && JSON.parse(store.scan).token, `long scan pauses: ${r.slice(0, 60)}...`);
tick = 0;
r = run('addThumbnails');
check(r === 'Done: 2 added, 0 already done, 1 skipped, 0 failed.', `resumed scan finishes with combined totals: ${r}`);

run('turnOnAutoUpdate'); run('turnOnAutoUpdate');
check(triggers.length === 1 && triggers[0].h === 1, 'auto-update: exactly one hourly trigger, even if turned on twice');
run('turnOffAutoUpdate');
check(triggers.length === 0, 'auto-update off removes the trigger');
process.exit(fails ? 1 : 0);
