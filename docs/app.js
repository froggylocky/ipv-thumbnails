/* app.js - IPV Viewer page: local viewer, layer list, and Google Drive thumbnails. */
(() => {
  'use strict';

  const cfg = window.IPV_CONFIG || {};
  const signInConfigured = Boolean(cfg.clientId);                       // enough for "Open with"
  const pickerConfigured = Boolean(cfg.clientId && cfg.apiKey && cfg.appId);  // needed to pick files
  const openWithConfigured = signInConfigured && Boolean(cfg.openWith);
  const SCOPES = ['https://www.googleapis.com/auth/drive.file']
    .concat(cfg.openWith ? ['https://www.googleapis.com/auth/drive.install'] : [])
    .join(' ');
  const DRIVE = 'https://www.googleapis.com/drive/v3/files/';
  const MAX_THUMB_BYTES = 2 * 1024 * 1024;   // Drive's limit for custom thumbnails

  const $ = (sel) => document.querySelector(sel);
  const stage = $('#stage'), view = $('#view'), empty = $('#empty');
  const list = $('#layerList'), layersEmpty = $('#layersEmpty'), fileLabel = $('#fileLabel');

  // ------------------------------------------------------------------ helpers
  let toastTimer = 0;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 4000);
  }

  function baseName(name) { return name.replace(/\.ipv$/i, ''); }

  async function bitmapFromPng(png) {
    return createImageBitmap(new Blob([png], { type: 'image/png' }));
  }

  function canvasFrom(source, w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    c.getContext('2d').drawImage(source, 0, 0, w, h);
    return c;
  }

  async function layerCanvas(layer) {
    const decoded = await IPV.decodePng(layer.png);
    const rgba = IPV.assembleLayer(layer, decoded.data);
    const c = document.createElement('canvas');
    c.width = layer.cw; c.height = layer.ch;
    c.getContext('2d').putImageData(new ImageData(rgba, layer.cw, layer.ch), 0, 0);
    return c;
  }

  // Everything shown on the stage goes through here, so rotation applies to the
  // artwork, single layers and timelapse frames alike. Saved PNGs stay unrotated.
  let rotation = 0, currentSource = null;
  function showOnStage(source) {
    currentSource = source;
    const swap = rotation % 180 !== 0, w = source.width, h = source.height;
    if (view.width !== (swap ? h : w)) view.width = swap ? h : w;
    if (view.height !== (swap ? w : h)) view.height = swap ? w : h;
    const ctx = view.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, view.width, view.height);
    ctx.translate(view.width / 2, view.height / 2);
    ctx.rotate(rotation * Math.PI / 180);
    ctx.drawImage(source, -w / 2, -h / 2);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    view.hidden = false;
    empty.hidden = true;
  }
  function rotate(by) {
    rotation = (rotation + by + 360) % 360;
    if (currentSource) showOnStage(currentSource);
    $('#rotLabel').textContent = rotation ? `${rotation}°` : '';
  }
  $('#rotL').addEventListener('click', () => rotate(-90));
  $('#rotR').addEventListener('click', () => rotate(90));

  function showMessage(title, text, isError) {
    view.hidden = true;
    empty.hidden = false;
    empty.innerHTML = '';
    const h = document.createElement('h2');
    h.textContent = title;
    const p = document.createElement('p');
    p.textContent = text;
    if (isError) p.className = 'error-text';
    empty.append(h, p);
    return empty;
  }

  function download(canvas, filename) {
    canvas.toBlob((blob) => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    }, 'image/png');
  }

  // ------------------------------------------------------------------ viewer
  let loadId = 0;

  function addLayerItem(label, meta, getCanvas, filename, disabled) {
    const li = document.createElement('li');
    li.className = 'layer';
    const pick = document.createElement('button');
    pick.type = 'button';
    pick.className = 'layer-pick';
    pick.setAttribute('aria-pressed', 'false');
    pick.disabled = disabled;
    const thumb = document.createElement('canvas');
    thumb.className = 'thumb checker';
    thumb.width = 96; thumb.height = 96;
    thumb.setAttribute('aria-hidden', 'true');
    const text = document.createElement('span');
    const name = document.createElement('span');
    name.className = 'layer-name';
    name.textContent = label;
    const metaEl = document.createElement('span');
    metaEl.className = 'layer-meta';
    metaEl.textContent = meta;
    text.append(name, metaEl);
    pick.append(thumb, text);
    li.append(pick);

    if (!disabled) {
      const save = document.createElement('button');
      save.type = 'button';
      save.className = 'btn small';
      save.textContent = 'Save PNG';
      save.setAttribute('aria-label', `Save ${label} as PNG`);
      save.addEventListener('click', async () => download(await getCanvas(), filename));
      li.append(save);
      pick.addEventListener('click', async () => {
        setMode('art');
        list.querySelectorAll('.layer-pick').forEach((b) => b.setAttribute('aria-pressed', 'false'));
        pick.setAttribute('aria-pressed', 'true');
        artSource = await getCanvas();
        showOnStage(artSource);
      });
    }
    list.append(li);
    return { pick, thumb, metaEl };
  }

  // `box` (optional) zooms the thumbnail in on a layer's used area, so small
  // details are visible instead of a speck on a big empty canvas.
  function drawThumb(thumb, source, box) {
    const b = box || { x: 0, y: 0, w: source.width, h: source.height };
    const ctx = thumb.getContext('2d');
    const s = Math.min(thumb.width / b.w, thumb.height / b.h);
    const w = b.w * s, h = b.h * s;
    ctx.clearRect(0, 0, thumb.width, thumb.height);
    ctx.drawImage(source, b.x, b.y, b.w, b.h, (thumb.width - w) / 2, (thumb.height - h) / 2, w, h);
  }

  async function openBuffer(buf, name) {
    const id = ++loadId;
    let info;
    try {
      info = IPV.parse(buf);
    } catch (e) {
      showMessage(`Couldn't open ${name}`, e.message, true);
      return;
    }
    const usable = info.layers.filter((l) => !l.empty);
    if (!info.composite && !usable.length) {
      showMessage(`Couldn't open ${name}`, 'No saved artwork was found in this file. It may be damaged or only partly downloaded.', true);
      return;
    }
    fileLabel.textContent = info.version ? `${name}, saved with ibisPaint X ${info.version.slice(4)}` : name;
    document.title = `${name}: IPV Viewer`;
    list.innerHTML = '';
    layersEmpty.hidden = true;
    const base = baseName(name);

    // The drawing history gives the real layer order and the timelapse.
    stopTimelapse();
    let history = null;
    try { history = IPVTimelapse.parseHistory(buf); } catch (e) { history = null; }
    tl = { info, history, final: null, player: null, building: null };
    const table = history && history.finalTable && history.finalTable.length ? history.finalTable : null;
    $('#layerNote').textContent = table ? 'Top layer first, as in ibisPaint.' : 'Numbered by ibisPaint\'s internal layer ID, which isn\'t always the stacking order.';
    let ordered = [...info.layers].reverse();
    if (table) {
      const rank = new Map(table.map((r, i) => [r.id, i]));
      ordered = [...info.layers].sort((x, y) => (rank.has(y.id) ? rank.get(y.id) : -1) - (rank.has(x.id) ? rank.get(x.id) : -1));
    }
    const props = new Map((table || []).map((r) => [r.id, r]));
    const describe = (layer) => {
      const r = props.get(layer.id), bits = [];
      if (r && !r.visible) bits.push('Hidden');
      if (r && r.clip) bits.push('Clipped');
      if (r && r.opacity < 0.995) bits.push(`${Math.round(r.opacity * 100)}% opacity`);
      return bits;
    };
    const hasTimelapse = Boolean(history && history.steps > 0 && info.composite);
    $('#stageBar').hidden = false;
    $('#tabTl').disabled = !hasTimelapse;
    $('#tabTl').title = hasTimelapse ? '' : 'No drawing history found in this file';
    setMode('art');

    if (info.composite) {
      const bmp = await bitmapFromPng(info.composite);
      if (id !== loadId) return;
      const full = canvasFrom(bmp, bmp.width, bmp.height);
      tl.final = full;
      const item = addLayerItem('Finished artwork', `${bmp.width} × ${bmp.height}`, async () => full, `${base}_final.png`, false);
      drawThumb(item.thumb, full);
      item.pick.setAttribute('aria-pressed', 'true');
      artSource = full;
      showOnStage(full);
    }
    if (!info.complete) toast('This file seems incomplete; showing what could be read.');

    // Layers: build each one once for its thumbnail, then rebuild on demand so
    // a 30-layer file doesn't hold 30 full-size images in memory.
    let shownFirst = Boolean(info.composite);
    for (const layer of ordered) {
      if (id !== loadId) return;
      const extra = describe(layer);
      if (layer.empty) {
        addLayerItem(`Layer ${layer.id}`, [layer.damaged ? 'Couldn\'t be read' : 'Empty', ...extra].join(', '), null, '', true);
        continue;
      }
      const get = () => layerCanvas(layer);
      const item = addLayerItem(`Layer ${layer.id}`, [`${layer.bw} × ${layer.bh} area`, ...extra].join(', '), get, `${base}_layer_${String(layer.id).padStart(2, '0')}.png`, false);
      try {
        const c = await get();
        if (id !== loadId) return;
        drawThumb(item.thumb, c, { x: layer.bx, y: layer.ch - layer.by - layer.bh, w: layer.bw, h: layer.bh });
        if (!shownFirst) { artSource = c; showOnStage(c); item.pick.setAttribute('aria-pressed', 'true'); shownFirst = true; }
      } catch (e) {
        item.metaEl.textContent = 'Couldn\'t be read';
        item.pick.disabled = true;
      }
    }
  }

  async function openFile(file) {
    if (!file) return;
    showMessage('Opening…', file.name);
    openBuffer(await file.arrayBuffer(), file.name);
  }

  $('#fileInput').addEventListener('change', (e) => { openFile(e.target.files[0]); e.target.value = ''; });
  $('#openLabel').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('#fileInput').click(); }
  });
  stage.addEventListener('dragover', (e) => { e.preventDefault(); stage.classList.add('drag'); });
  stage.addEventListener('dragleave', (e) => { if (!stage.contains(e.relatedTarget)) stage.classList.remove('drag'); });
  stage.addEventListener('drop', (e) => {
    e.preventDefault();
    stage.classList.remove('drag');
    openFile(e.dataTransfer.files[0]);
  });

  // ------------------------------------------------------------------ timelapse
  let tl = null, artSource = null, mode = 'art';
  const play = { on: false, raf: 0, last: 0, acc: 0, fadeStart: 0 };
  const FADE_MS = 1500;

  function setMode(m) {
    mode = m;
    $('#tabArt').setAttribute('aria-selected', String(m === 'art'));
    $('#tabTl').setAttribute('aria-selected', String(m === 'tl'));
    $('#player').hidden = m !== 'tl';
    if (m === 'art') {
      stopTimelapse();
      if (artSource) showOnStage(artSource);
    }
  }

  function stopTimelapse() {
    play.on = false;
    cancelAnimationFrame(play.raf);
    $('#tlPlay').textContent = 'Play';
    $('#tlPlay').setAttribute('aria-label', 'Play timelapse');
  }

  // Decode every layer once and hand them to the player.
  async function buildPlayer() {
    if (tl.player) return tl.player;
    if (tl.building) return tl.building;
    tl.building = (async () => {
      const layers = new Map(), usable = tl.info.layers.filter((l) => !l.empty);
      let n = 0;
      for (const L of usable) {
        $('#tlLabel').textContent = `Preparing… ${++n} of ${usable.length} layers`;
        try {
          const canvas = await layerCanvas(L);
          layers.set(L.id, { canvas, bw: L.bw, bh: L.bh, bx: L.bx, by: L.ch - L.by - L.bh });
        } catch (e) { /* a layer that can't be read just won't appear */ }
      }
      const W = tl.final.width, H = tl.final.height;
      tl.player = new IPVTimelapse.Player(tl.history, layers, tl.final, W, H, 1024);
      return tl.player;
    })();
    return tl.building;
  }

  function stepsPerSecond() {
    const speed = Number($('#tlSpeed').value) || 1;
    return speed * Math.max(10, tl.player.steps / 30);              // about 30 seconds at 1×
  }

  function updateLabel() {
    const p = tl.player;
    $('#tlSeek').value = String(p.step);
    $('#tlLabel').textContent = p.step >= p.steps ? 'Finished' : `Step ${p.step} of ${p.steps}`;
  }

  function drawFrame(fade) {
    const p = tl.player;
    if (fade >= 1) { showOnStage(tl.final); return; }               // end exactly on the real picture
    showOnStage(p.render(fade));
  }

  function tick(now) {
    if (!play.on) return;
    const p = tl.player, dt = Math.min(100, now - play.last);
    play.last = now;
    if (p.step < p.steps) {
      play.acc += dt / 1000 * stepsPerSecond();
      const n = Math.floor(play.acc);
      if (n > 0) { play.acc -= n; p.seek(p.step + n); }
      drawFrame(0);
      if (p.step >= p.steps) play.fadeStart = now;
    } else {
      const f = Math.min(1, (now - play.fadeStart) / FADE_MS);
      drawFrame(f);
      if (f >= 1) { updateLabel(); stopTimelapse(); return; }
    }
    updateLabel();
    play.raf = requestAnimationFrame(tick);
  }

  async function startTimelapse() {
    const p = await buildPlayer();
    $('#tlSeek').max = String(p.steps);
    if (p.step >= p.steps) p.seek(0);                                // play again from the start
    play.on = true; play.last = performance.now(); play.acc = 0;
    $('#tlPlay').textContent = 'Pause';
    $('#tlPlay').setAttribute('aria-label', 'Pause timelapse');
    play.raf = requestAnimationFrame(tick);
  }

  $('#tabArt').addEventListener('click', () => setMode('art'));
  $('#tabTl').addEventListener('click', async () => {
    if (!tl || $('#tabTl').disabled) return;
    setMode('tl');
    const p = await buildPlayer();
    $('#tlSeek').max = String(p.steps);
    if (mode !== 'tl') return;
    updateLabel();
    drawFrame(p.step >= p.steps ? 1 : 0);
  });
  $('#tlPlay').addEventListener('click', () => { if (play.on) stopTimelapse(); else startTimelapse(); });
  $('#tlSeek').addEventListener('input', async () => {
    const p = await buildPlayer();
    p.seek(Number($('#tlSeek').value));
    play.acc = 0;
    if (p.step >= p.steps) play.fadeStart = performance.now() - FADE_MS;
    updateLabel();
    drawFrame(p.step >= p.steps ? 1 : 0);
  });

  // ------------------------------------------------------------------ Google sign-in
  let tokenClient = null, accessToken = null, tokenExpiry = 0, pendingToken = null;

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src; s.async = true;
      s.onload = resolve;
      s.onerror = () => reject(new Error(`Couldn't load ${src}. Check your connection or ad blocker.`));
      document.head.appendChild(s);
    });
  }

  const googleReady = !signInConfigured ? null : Promise.all([
    loadScript('https://accounts.google.com/gsi/client'),
    !pickerConfigured ? null : loadScript('https://apis.google.com/js/api.js').then(() => new Promise((resolve, reject) =>
      gapi.load('picker', { callback: resolve, onerror: () => reject(new Error('Couldn\'t load Google Picker.')) }))),
  ]).then(() => {
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: cfg.clientId,
      scope: SCOPES,
      callback: (resp) => {
        const p = pendingToken; pendingToken = null;
        if (!p) return;
        if (resp.error) return p.reject(new Error(resp.error_description || resp.error));
        accessToken = resp.access_token;
        tokenExpiry = Date.now() + Number(resp.expires_in || 3600) * 1000;
        p.resolve(accessToken);
      },
      error_callback: (err) => {
        const p = pendingToken; pendingToken = null;
        if (!p) return;
        const msg = err.type === 'popup_closed' ? 'Google sign-in was closed before it finished.'
          : err.type === 'popup_failed_to_open' ? 'The Google sign-in window was blocked. Allow pop-ups for this site, then try again.'
          : (err.message || 'Google sign-in failed.');
        p.reject(new Error(msg));
      },
    });
  });
  if (googleReady) googleReady.catch(() => {});   // reported when the person tries to use Drive

  // Must be called directly from a click handler (before any await) so the
  // browser allows Google's sign-in pop-up.
  // `hint` (optional): the Google account to use, so no account chooser appears.
  function getToken(hint) {
    if (accessToken && Date.now() < tokenExpiry - 60000) return Promise.resolve(accessToken);
    if (!tokenClient) return Promise.reject(new Error('Google is still loading. Try again in a moment.'));
    return new Promise((resolve, reject) => {
      pendingToken = { resolve, reject };
      const opts = { prompt: accessToken ? '' : undefined };
      if (hint) opts.hint = hint;
      tokenClient.requestAccessToken(opts);
    });
  }

  async function driveFetch(url, options = {}) {
    const token = await getToken();
    const resp = await fetch(url, Object.assign({}, options, {
      headers: Object.assign({}, options.headers, { Authorization: `Bearer ${token}` }),
    }));
    if (!resp.ok) {
      let msg = `Google Drive returned ${resp.status}.`;
      try { const j = await resp.json(); if (j.error && j.error.message) msg = j.error.message; } catch (e) { /* not JSON */ }
      throw new Error(msg);
    }
    return resp;
  }

  const downloadFile = async (id) =>
    (await driveFetch(`${DRIVE}${encodeURIComponent(id)}?alt=media&supportsAllDrives=true`)).arrayBuffer();

  // ------------------------------------------------------------------ Drive thumbnails
  function base64url(u8) {
    let s = '';
    for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_');
  }

  // Drive accepts PNG/JPEG/GIF thumbnails up to 2 MB, ideally 1600 px wide.
  async function thumbnailFor(png) {
    if (png.length <= MAX_THUMB_BYTES * 0.95) return { bytes: png, mimeType: 'image/png' };
    const bmp = await bitmapFromPng(png);
    const scale = Math.min(1, 1600 / bmp.width);
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(bmp, 0, 0, c.width, c.height);
    for (const q of [0.9, 0.8, 0.65]) {
      const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', q));
      if (blob.size <= MAX_THUMB_BYTES) return { bytes: new Uint8Array(await blob.arrayBuffer()), mimeType: 'image/jpeg' };
    }
    throw new Error('The artwork is too large to use as a Drive thumbnail.');
  }

  function pickFiles(token) {
    return new Promise((resolve) => {
      const view = new google.picker.DocsView(google.picker.ViewId.DOCS)
        .setIncludeFolders(true)
        .setSelectFolderEnabled(false);
      const picker = new google.picker.PickerBuilder()
        .setTitle('Choose your .ipv files')
        .setAppId(cfg.appId)
        .setOAuthToken(token)
        .setDeveloperKey(cfg.apiKey)
        .addView(view)
        .enableFeature(google.picker.Feature.MULTISELECT_ENABLED)
        .setCallback((data) => {
          const action = data[google.picker.Response.ACTION];
          if (action === google.picker.Action.PICKED) {
            resolve(data[google.picker.Response.DOCUMENTS].map((d) => ({
              id: d[google.picker.Document.ID], name: d[google.picker.Document.NAME],
            })));
          } else if (action === google.picker.Action.CANCEL) {
            resolve([]);
          }
        })
        .build();
      picker.setVisible(true);
    });
  }

  function resultRow(name) {
    const li = document.createElement('li');
    const ph = document.createElement('div');
    ph.className = 'ph checker';
    const text = document.createElement('div');
    const n = document.createElement('div');
    n.className = 'name'; n.textContent = name;
    const st = document.createElement('div');
    st.className = 'status';
    text.append(n, st);
    li.append(ph, text);
    $('#driveResults').append(li);
    return {
      status(msg, kind) { st.textContent = msg; st.className = `status ${kind || ''}`; },
      preview(png) {
        const img = document.createElement('img');
        img.alt = '';
        img.src = URL.createObjectURL(new Blob([png], { type: 'image/png' }));
        ph.replaceWith(img);
      },
    };
  }

  async function addThumbnails(files) {
    const summary = $('#driveSummary');
    if (!files.length) return;
    let added = 0, skipped = 0, failed = 0;
    for (const f of files) {
      const row = resultRow(f.name);
      try {
        row.status('Downloading…');
        const png = IPV.findComposite(await downloadFile(f.id));
        if (!png) {
          row.status('Skipped: not an ibisPaint file, or no finished artwork in it', 'err');
          skipped++;
          continue;
        }
        row.preview(png);
        row.status('Adding thumbnail…');
        const thumb = await thumbnailFor(png);
        await driveFetch(`${DRIVE}${encodeURIComponent(f.id)}?supportsAllDrives=true&fields=id`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contentHints: { thumbnail: { image: base64url(thumb.bytes), mimeType: thumb.mimeType } } }),
        });
        row.status('Thumbnail added', 'ok');
        added++;
      } catch (e) {
        row.status(e.message, 'err');
        failed++;
      }
    }
    const parts = [`${added} thumbnail${added === 1 ? '' : 's'} added`];
    if (skipped) parts.push(`${skipped} skipped`);
    if (failed) parts.push(`${failed} failed`);
    summary.textContent = `${parts.join(', ')}. New thumbnails can take a few minutes to appear in Drive.`;
  }

  const dialog = $('#driveDialog');
  $('#driveBtn').addEventListener('click', () => {
    $('#driveSetupMissing').hidden = pickerConfigured || openWithConfigured;
    $('#driveSetupReady').hidden = !pickerConfigured;
    $('#drivePick').hidden = !pickerConfigured;
    $('#openWithSetup').hidden = !openWithConfigured;
    dialog.showModal();
  });

  // Signing in with the drive.install permission is what adds IPV Viewer to
  // Drive's "Open with" menu and to the "Connected apps" list in Drive's preview.
  $('#installOpenWith').addEventListener('click', () => {
    const btn = $('#installOpenWith'), out = $('#installResult');
    btn.disabled = true;
    out.textContent = '';
    getToken()
      .then(() => {
        out.className = 'ok-text';
        out.textContent = 'Done. In Google Drive, double-click an .ipv file and choose IPV Viewer under Connected apps, or right-click it › Open with › IPV Viewer. It can take a few minutes to appear; refresh Drive if it doesn\'t.';
      })
      .catch((e) => { out.className = 'error-text'; out.textContent = e.message; })
      .finally(() => { btn.disabled = false; });
  });
  $('#driveClose').addEventListener('click', () => dialog.close());

  $('#drivePick').addEventListener('click', () => {
    $('#driveSummary').textContent = '';
    const btn = $('#drivePick');
    btn.disabled = true;
    // Picker opens over the page; hide our dialog so it isn't in the way.
    getToken()
      .then((token) => { dialog.close(); return pickFiles(token); })
      .then((files) => { dialog.showModal(); return addThumbnails(files); })
      .catch((e) => { if (!dialog.open) dialog.showModal(); $('#driveSummary').textContent = e.message; })
      .finally(() => { btn.disabled = false; });
  });

  // ------------------------------------------------------------------ "Open with" from Drive
  // Drive opens this page with ?state={"ids":[...],"action":"open"} when someone
  // chooses Open with › IPV Viewer.
  (function handleOpenWith() {
    let state = null;
    try { state = JSON.parse(new URLSearchParams(location.search).get('state') || 'null'); } catch (e) { /* ignore */ }
    if (!state || state.action !== 'open' || !Array.isArray(state.ids) || !state.ids.length) return;
    const fileId = state.ids[0];
    if (!signInConfigured) {
      showMessage('Opened from Google Drive', 'Google Drive isn\'t connected on this copy of the site yet, so the file can\'t be loaded.', true);
      return;
    }
    const box = showMessage('Opened from Google Drive', 'Sign in to Google so this page can load the file you chose.');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn primary';
    btn.textContent = 'Load from Drive';
    const row = document.createElement('div');
    row.className = 'actions';
    row.append(btn);
    box.append(row);
    btn.addEventListener('click', () => {
      btn.disabled = true;
      getToken(state.userId)
        .then(() => driveFetch(`${DRIVE}${encodeURIComponent(fileId)}?fields=name&supportsAllDrives=true`))
        .then((r) => r.json())
        .then(async (meta) => {
          showMessage('Opening…', meta.name);
          openBuffer(await downloadFile(fileId), meta.name);
        })
        .catch((e) => { showMessage('Couldn\'t load the file from Drive', e.message, true); });
    });
  })();
})();
