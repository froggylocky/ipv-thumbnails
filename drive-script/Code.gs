/**
 * IPV Thumbnails for Google Drive (Google Apps Script).
 *
 * Gives every ibisPaint .ipv file in your Drive its finished artwork as its
 * Drive thumbnail. Runs under your own Google account; no Google Cloud setup.
 *
 * Functions to run from the editor (pick one in the toolbar, then click Run):
 *   addThumbnails     Scan Drive and add thumbnails. Safe to run any time.
 *   turnOnAutoUpdate  Run addThumbnails every hour, so new and re-uploaded
 *                     .ipv files get thumbnails automatically.
 *   turnOffAutoUpdate Stop the hourly run.
 *   startOver         Forget progress, so the next run re-checks every file.
 *
 * Needs ipv.gs (the parser) in the same project, and the Drive API service
 * (v3) added under Services. See README.md, "Google Drive without Google Cloud".
 */

const MAX_THUMB_BYTES = 2 * 1024 * 1024;     // Drive's limit for custom thumbnails
const MAX_FILE_BYTES = 50 * 1024 * 1024;     // Apps Script can't load larger files
const TIME_BUDGET_MS = 4.5 * 60 * 1000;      // Apps Script stops scripts at 6 minutes

function addThumbnails() {
  const lock = LockService.getUserLock();
  if (!lock.tryLock(1000)) {
    console.log('Another run is already in progress. Try again in a few minutes.');
    return;
  }
  try {
    return scan_();
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

// ---------------------------------------------------------------------------

function scan_() {
  const props = PropertiesService.getUserProperties();
  const started = Date.now();
  // scan = {token, startedAt, since, counts}; `since` is when the last full
  // scan began, so later scans only look at files changed after that.
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
    if (Date.now() - started > TIME_BUDGET_MS) {
      scan.token = files.getContinuationToken();
      props.setProperty('scan', JSON.stringify(scan));
      const msg = `Paused to stay within Apps Script's time limit (${summary_(scan.counts)} so far). ` +
        'Run addThumbnails again to continue, or let auto-update continue it.';
      console.log(msg);
      return msg;
    }
    const file = files.next();
    if (!/\.ipv$/i.test(file.getName())) continue;
    scan.counts[processFile_(file, props)]++;
  }

  props.setProperty('scan', JSON.stringify({ since: scan.startedAt }));
  const msg = `Done: ${summary_(scan.counts)}.`;
  console.log(msg);
  return msg;
}

function summary_(c) {
  return `${c.added} added, ${c.unchanged} already done, ${c.skipped} skipped, ${c.failed} failed`;
}

// Returns 'added', 'unchanged', 'skipped' or 'failed'.
function processFile_(file, props) {
  const name = file.getName();
  try {
    const id = file.getId();
    const meta = Drive.Files.get(id, { fields: 'md5Checksum,size', supportsAllDrives: true });
    // The checksum changes only when the content does (a re-upload clears the thumbnail).
    const key = 'done_' + id;
    const sig = meta.md5Checksum || `${file.getSize()}:${file.getLastUpdated().getTime()}`;
    if (props.getProperty(key) === sig) return 'unchanged';

    const size = Number(meta.size || file.getSize());
    if (size > MAX_FILE_BYTES) {
      console.log(`Skipped ${name}: larger than the 50 MB Apps Script can load.`);
      props.setProperty(key, sig);
      return 'skipped';
    }
    const png = IPV.findComposite(Uint8Array.from(file.getBlob().getBytes()));
    if (!png) {
      console.log(`Skipped ${name}: no finished artwork found (not an ibisPaint file, or damaged).`);
      props.setProperty(key, sig);
      return 'skipped';
    }
    if (png.length > MAX_THUMB_BYTES) {
      console.log(`Skipped ${name}: the artwork is over Drive's 2 MB thumbnail limit. ` +
        'Use the IPV Viewer web page for this file; it can shrink the image.');
      props.setProperty(key, sig);
      return 'skipped';
    }
    Drive.Files.update(
      { contentHints: { thumbnail: { image: Utilities.base64EncodeWebSafe(toSignedBytes_(png)), mimeType: 'image/png' } } },
      id, null, { supportsAllDrives: true, fields: 'id' });
    props.setProperty(key, sig);
    console.log(`Added thumbnail: ${name}`);
    return 'added';
  } catch (e) {
    console.log(`Failed ${name}: ${e.message}`);
    return 'failed';
  }
}

// Apps Script's Utilities functions expect Java-style signed bytes (-128..127).
function toSignedBytes_(u8) {
  const out = new Array(u8.length);
  for (let i = 0; i < u8.length; i++) out[i] = u8[i] > 127 ? u8[i] - 256 : u8[i];
  return out;
}
