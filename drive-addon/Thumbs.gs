/* Thumbs.gs - give .ipv files their artwork as their Drive thumbnail.
 *
 * Used by the add-on's buttons (Addon.gs) and by the hourly trigger. These
 * functions can also be run straight from the Apps Script editor:
 *   addThumbnails     Scan Drive and add thumbnails. Safe to run any time.
 *   turnOnAutoUpdate  Run addThumbnails every hour.
 *   turnOffAutoUpdate Stop the hourly run.
 *   startOver         Forget progress, so the next run re-checks every file.
 */

const MAX_THUMB_BYTES = 2 * 1024 * 1024;     // Drive's limit for custom thumbnails
const MAX_FILE_BYTES = 50 * 1024 * 1024;     // Apps Script can't load larger files
const SHRINK_SIZES = [1024, 768, 512];       // artwork over 2 MB is shrunk until it fits
const SCAN_BUDGET_MS = 4.5 * 60 * 1000;      // Apps Script stops scripts at 6 minutes

// ------------------------------------------------------------------ editor / trigger entry points

function addThumbnails() {
  const lock = LockService.getUserLock();
  if (!lock.tryLock(1000)) {
    console.log('Another run is already in progress. Try again in a few minutes.');
    return;
  }
  try {
    const res = scan_(SCAN_BUDGET_MS);
    const msg = res.done
      ? `Done: ${summary_(res.counts)}.`
      : `Paused to stay within Apps Script's time limit (${summary_(res.counts)} so far). Run again to continue.`;
    saveLastRun_(msg);
    console.log(msg);
    return msg;
  } finally {
    lock.releaseLock();
  }
}

function turnOnAutoUpdate() {
  turnOffAutoUpdate();
  ScriptApp.newTrigger('addThumbnails').timeBased().everyHours(1).create();
  console.log('Auto-update is on: addThumbnails will run every hour.');
}

function turnOffAutoUpdate() {
  ScriptApp.getProjectTriggers()
    .filter((t) => t.getHandlerFunction() === 'addThumbnails')
    .forEach((t) => ScriptApp.deleteTrigger(t));
  console.log('Auto-update is off.');
}

function startOver() {
  PropertiesService.getUserProperties().deleteAllProperties();
  console.log('Progress cleared. The next run will check every .ipv file again.');
}

function autoUpdateIsOn_() {
  return ScriptApp.getProjectTriggers().some((t) => t.getHandlerFunction() === 'addThumbnails');
}

// ------------------------------------------------------------------ scanning

// Scans Drive for .ipv files, resuming where the last run stopped.
// Returns {done, counts}. Later scans only look at files changed since the
// last complete scan began.
function scan_(budgetMs) {
  const props = PropertiesService.getUserProperties();
  const started = Date.now();
  const scan = JSON.parse(props.getProperty('scan') || '{}');
  let files;
  if (scan.token) {
    files = DriveApp.continueFileIterator(scan.token);
  } else {
    scan.startedAt = new Date().toISOString();
    scan.counts = { added: 0, unchanged: 0, skipped: 0, failed: 0 };
    let query = 'trashed = false';
    if (scan.since) query += ` and modifiedDate > '${scan.since}'`;
    files = DriveApp.searchFiles(query);
  }
  while (files.hasNext()) {
    if (Date.now() - started > budgetMs) {
      scan.token = files.getContinuationToken();
      props.setProperty('scan', JSON.stringify(scan));
      return { done: false, counts: scan.counts };
    }
    const file = files.next();
    if (!/\.ipv$/i.test(file.getName())) continue;
    scan.counts[processFile_(file, props, false).status]++;
  }
  props.setProperty('scan', JSON.stringify({ since: scan.startedAt }));
  return { done: true, counts: scan.counts };
}

function summary_(c) {
  return `${c.added} added, ${c.unchanged} already done, ${c.skipped} skipped, ${c.failed} failed`;
}

function saveLastRun_(text) {
  PropertiesService.getUserProperties().setProperty('lastRun', JSON.stringify({ at: new Date().toISOString(), text }));
}

// ------------------------------------------------------------------ one file

// Returns {status: 'added'|'unchanged'|'skipped'|'failed', message}.
// `force` re-adds the thumbnail even if this version already got one.
function processFile_(file, props, force) {
  let name = '(unknown file)';
  try {
    name = file.getName();
    const id = file.getId();
    const meta = Drive.Files.get(id, { fields: 'md5Checksum,size', supportsAllDrives: true });
    // The checksum changes only when the content does (a re-upload clears the thumbnail).
    const key = 'done_' + id;
    const sig = meta.md5Checksum || `${file.getSize()}:${file.getLastUpdated().getTime()}`;
    if (!force && props.getProperty(key) === sig) return result_('unchanged', 'Already has its thumbnail');

    const png = IPV.findComposite(readIpv_(file));
    if (!png) {
      props.setProperty(key, sig);
      return result_('skipped', 'No finished artwork found. It may not be an ibisPaint file, or it may be damaged.', name);
    }
    const thumb = thumbnailPng_(png);
    if (!thumb) {
      props.setProperty(key, sig);
      return result_('skipped', 'The artwork couldn\'t be made small enough for a Drive thumbnail.', name);
    }
    Drive.Files.update(
      { contentHints: { thumbnail: { image: Utilities.base64EncodeWebSafe(toSignedBytes_(thumb)), mimeType: 'image/png' } } },
      id, null, { supportsAllDrives: true, fields: 'id' });
    props.setProperty(key, sig);
    return result_('added', 'Thumbnail added', name);
  } catch (e) {
    return result_('failed', e.message, name);
  }
}

function result_(status, message, name) {
  if (name && status !== 'unchanged') console.log(`${status === 'added' ? 'Added' : status === 'skipped' ? 'Skipped' : 'Failed'} ${name}: ${message}`);
  return { status, message };
}

function readIpv_(file) {
  if (file.getSize() > MAX_FILE_BYTES) throw new Error('This file is larger than the 50 MB that Apps Script can load.');
  return Uint8Array.from(file.getBlob().getBytes());
}

// The artwork PNG itself if it fits Drive's 2 MB limit; otherwise the largest
// shrunk copy that fits. (At 512 px the raw image is only 1 MB, so it always fits.)
function thumbnailPng_(png) {
  if (png.length <= MAX_THUMB_BYTES) return png;
  const img = Png.decode(png);
  if (!img) return null;
  for (const size of SHRINK_SIZES) {
    const small = Png.encode(Png.resize(img, size, size), deflateRaw_);
    if (small.length <= MAX_THUMB_BYTES) return small;
  }
  return null;
}

// {url, width, height} for showing the artwork in the side panel, or null.
function previewOf_(png, size) {
  const img = Png.decode(png);
  if (!img) return null;
  const small = Png.encode(Png.resize(img, size, size), deflateRaw_);
  return { url: 'data:image/png;base64,' + Utilities.base64Encode(toSignedBytes_(small)), width: img.width, height: img.height };
}

// ------------------------------------------------------------------ byte helpers

// Raw DEFLATE via Apps Script's gzip (strip the gzip header and trailer).
function deflateRaw_(u8) {
  const b = Uint8Array.from(Utilities.gzip(Utilities.newBlob(toSignedBytes_(u8))).getBytes());
  if (b[0] !== 0x1f || b[1] !== 0x8b) throw new Error('Unexpected gzip output');
  const flags = b[3];
  let p = 10;
  if (flags & 4) p += 2 + (b[p] | (b[p + 1] << 8));
  if (flags & 8) while (b[p++] !== 0);
  if (flags & 16) while (b[p++] !== 0);
  if (flags & 2) p += 2;
  return b.subarray(p, b.length - 8);
}

// Apps Script's Utilities functions expect Java-style signed bytes (-128..127).
function toSignedBytes_(u8) {
  const out = new Array(u8.length);
  for (let i = 0; i < u8.length; i++) out[i] = u8[i] > 127 ? u8[i] - 256 : u8[i];
  return out;
}
