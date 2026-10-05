/* Addon.gs - the side panel in Google Drive.
 *
 * Home: add thumbnails to every .ipv file, and the hourly auto-update switch.
 * Selecting .ipv files in Drive: a preview of the artwork, and a button to add
 * thumbnails to the selected files.
 */

// Optional: your IPV Viewer site (from GitHub Pages), e.g.
// 'https://your-name.github.io/ipv-thumbnails/'. Adds "Open in IPV Viewer".
const VIEWER_URL = '';
// Shown in the panel header. Keep in sync with "logoUrl" in appsscript.json.
const LOGO_URL = 'https://www.gstatic.com/images/icons/material/system/1x/photo_library_black_48dp.png';

const PREVIEW_SIZE = 240;
const ACTION_BUDGET_MS = 18 * 1000;   // add-on buttons must finish within 30 seconds
const MAX_LISTED = 20;

// ------------------------------------------------------------------ triggers (see appsscript.json)

function onHomepage(e) {
  return homeCard_(null, timeZone_(e));
}

function onDriveItemsSelected(e) {
  const items = selectedIpv_(e);
  if (!items.length) return homeCard_('Select an .ipv file in Drive to see its artwork here.', timeZone_(e));
  const cursor = e && e.drive && e.drive.activeCursorItem;
  const focus = items.find((i) => cursor && i.id === cursor.id) || items[0];
  return selectionCard_(items, focus, null);
}

// ------------------------------------------------------------------ button actions

function runScanAction(e) {
  const lock = LockService.getUserLock();
  if (!lock.tryLock(1000)) return respond_(homeCard_(null, timeZone_(e)), 'A run is already in progress. Try again in a few minutes.');
  let msg;
  try {
    const res = scan_(ACTION_BUDGET_MS);
    msg = res.done
      ? `Done: ${summary_(res.counts)}.`
      : `Paused partway (${summary_(res.counts)} so far). Click "Add thumbnails now" again to continue, or turn on hourly updates to finish in the background.`;
    saveLastRun_(msg);
  } finally {
    lock.releaseLock();
  }
  return respond_(homeCard_(null, timeZone_(e)), msg.split('.')[0] + '.');
}

function toggleAutoUpdateAction(e) {
  const on = switchValue_(e, 'autoUpdate') === 'on';
  if (on) turnOnAutoUpdate(); else turnOffAutoUpdate();
  return respond_(homeCard_(null, timeZone_(e)), on ? 'Hourly updates are on.' : 'Hourly updates are off.');
}

function addSelectedAction(e) {
  const items = JSON.parse(e.parameters.items);
  const props = PropertiesService.getUserProperties();
  const started = Date.now();
  const results = {};
  let added = 0, problems = 0, waiting = 0;
  for (const it of items) {
    if (Date.now() - started > ACTION_BUDGET_MS) {
      results[it.id] = 'Not done yet. Click the button again to continue.';
      waiting++;
      continue;
    }
    let r;
    try {
      r = processFile_(DriveApp.getFileById(it.id), props, true);
    } catch (err) {
      r = { status: 'failed', message: err.message };
    }
    results[it.id] = r.message;
    if (r.status === 'added') added++; else problems++;
  }
  // Keep only the unfinished files on the button, so clicking again continues.
  const remaining = items.filter((it) => /^Not done yet/.test(results[it.id]));
  let note = `${added} thumbnail${added === 1 ? '' : 's'} added`;
  if (problems) note += `, ${problems} with problems`;
  if (waiting) note += `, ${waiting} still to do`;
  return respond_(selectionCard_(items, null, results, remaining), note + '.');
}

// ------------------------------------------------------------------ cards

function homeCard_(note, tz) {
  const card = CardService.newCardBuilder().setHeader(header_());
  if (note) card.addSection(CardService.newCardSection().addWidget(CardService.newTextParagraph().setText(note)));

  const last = JSON.parse(PropertiesService.getUserProperties().getProperty('lastRun') || 'null');
  const all = CardService.newCardSection().setHeader('All .ipv files in your Drive');
  all.addWidget(CardService.newTextParagraph().setText(last
    ? `<b>Last run ${formatTime_(last.at, tz)}</b><br>${escape_(last.text)}`
    : 'Gives every .ipv file in your Drive its finished artwork as its thumbnail, so you can see it in Drive\'s file grid.'));
  all.addWidget(CardService.newTextButton()
    .setText('Add thumbnails now')
    .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
    .setOnClickAction(CardService.newAction().setFunctionName('runScanAction')));
  all.addWidget(CardService.newDecoratedText()
    .setText('Keep up to date')
    .setBottomLabel('Checks for new and changed .ipv files every hour')
    .setWrapText(true)
    .setSwitchControl(CardService.newSwitch()
      .setFieldName('autoUpdate')
      .setValue('on')
      .setSelected(autoUpdateIsOn_())
      .setOnChangeAction(CardService.newAction().setFunctionName('toggleAutoUpdateAction'))));
  card.addSection(all);
  if (VIEWER_URL) card.addSection(viewerSection_(null));
  return card.build();
}

// `results` maps file id -> message after a button press; `remaining` (optional)
// are the files the button should process next time.
function selectionCard_(items, focus, results, remaining) {
  const card = CardService.newCardBuilder().setHeader(header_());
  if (focus) card.addSection(previewSection_(focus));

  const todo = remaining || items;
  const sec = CardService.newCardSection()
    .setHeader(items.length === 1 ? 'Drive thumbnail' : `${items.length} .ipv files selected`);
  if (results || items.length > 1) {
    items.slice(0, MAX_LISTED).forEach((it) => {
      const w = CardService.newDecoratedText().setText(escape_(it.title)).setWrapText(true);
      if (results && results[it.id]) w.setBottomLabel(results[it.id]);
      sec.addWidget(w);
    });
    if (items.length > MAX_LISTED) sec.addWidget(CardService.newTextParagraph().setText(`and ${items.length - MAX_LISTED} more`));
  } else {
    sec.addWidget(CardService.newTextParagraph().setText('Use this artwork as the file\'s thumbnail in Drive.'));
  }
  if (todo.length) {
    const label = results ? 'Continue' : items.length === 1 ? 'Add thumbnail' : `Add thumbnails to ${items.length} files`;
    sec.addWidget(CardService.newTextButton()
      .setText(label)
      .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
      .setOnClickAction(CardService.newAction()
        .setFunctionName('addSelectedAction')
        .setParameters({ items: JSON.stringify(todo) })));
  }
  card.addSection(sec);
  return card.build();
}

function previewSection_(item) {
  const sec = CardService.newCardSection();
  try {
    const png = IPV.findComposite(readIpv_(DriveApp.getFileById(item.id)));
    if (!png) {
      sec.addWidget(CardService.newDecoratedText().setText(escape_(item.title)).setWrapText(true)
        .setBottomLabel('No finished artwork found. It may not be an ibisPaint file, or it may be damaged.'));
      return sec;
    }
    const preview = previewOf_(png, PREVIEW_SIZE);
    if (preview) sec.addWidget(CardService.newImage().setImageUrl(preview.url).setAltText(`Artwork in ${item.title}`));
    sec.addWidget(CardService.newDecoratedText()
      .setText(escape_(item.title))
      .setBottomLabel(preview ? `${preview.width} × ${preview.height} artwork` : 'Finished artwork')
      .setWrapText(true));
    if (VIEWER_URL) sec.addWidget(viewerButton_(item.id));
  } catch (err) {
    sec.addWidget(CardService.newDecoratedText().setText(escape_(item.title)).setWrapText(true)
      .setBottomLabel(`Couldn't read this file: ${err.message}`));
  }
  return sec;
}

function viewerSection_(fileId) {
  return CardService.newCardSection().addWidget(viewerButton_(fileId));
}

function viewerButton_(fileId) {
  const url = fileId
    ? `${VIEWER_URL}?state=${encodeURIComponent(JSON.stringify({ ids: [fileId], action: 'open' }))}`
    : VIEWER_URL;
  return CardService.newTextButton()
    .setText(fileId ? 'Open in IPV Viewer (layers)' : 'Open IPV Viewer')
    .setOpenLink(CardService.newOpenLink().setUrl(url));
}

function header_() {
  return CardService.newCardHeader()
    .setTitle('IPV Thumbnails')
    .setSubtitle('ibisPaint artwork in Drive')
    .setImageUrl(LOGO_URL)
    .setImageStyle(CardService.ImageStyle.SQUARE);
}

// ------------------------------------------------------------------ helpers

function respond_(card, text) {
  const b = CardService.newActionResponseBuilder().setNavigation(CardService.newNavigation().updateCard(card));
  if (text) b.setNotification(CardService.newNotification().setText(text));
  return b.build();
}

function selectedIpv_(e) {
  const items = (e && e.drive && e.drive.selectedItems) || [];
  return items
    .filter((i) => /\.ipv$/i.test(i.title || ''))
    .map((i) => ({ id: i.id, title: i.title }));
}

// A switch's value is present only while it's on.
function switchValue_(e, field) {
  const ce = e && e.commonEventObject;
  const v = ce && ce.formInputs && ce.formInputs[field];
  if (v && v.stringInputs && v.stringInputs.value) return v.stringInputs.value[0];
  return (e && e.formInput && e.formInput[field]) || '';
}

function timeZone_(e) {
  const ce = e && e.commonEventObject;
  return (ce && ce.timeZone && ce.timeZone.id) || Session.getScriptTimeZone();
}

function formatTime_(iso, tz) {
  return Utilities.formatDate(new Date(iso), tz, "MMM d 'at' h:mm a");
}

// Card text supports a little HTML, so escape file names.
function escape_(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
