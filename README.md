# IPV Thumbnails

See your ibisPaint X `.ipv` artwork without opening ibisPaint:

- **Windows File Explorer**: thumbnails for `.ipv` files (installer below).
- **IPV Viewer** (web, in `docs/`): open an `.ipv` file in any browser to see
  the finished artwork and every layer, save them as PNGs, and add thumbnails
  to your `.ipv` files in **Google Drive**. Once GitHub Pages is on, it lives at
  `https://<your-username>.github.io/<repo-name>/`.

## Install (Windows thumbnails)

1. Go to the [Releases](../../releases/latest) page and download
   **`IpvThumb-Setup-<version>.exe`**.
2. Run it. No admin rights are needed.
3. Open a folder with `.ipv` files and switch to **Medium icons** view or larger.

Windows may show **"Windows protected your PC"** because the installer isn't
code-signed. Click **More info**, then **Run anyway**.

To uninstall, go to **Settings › Apps › Installed apps › IPV Thumbnails**.

Prefer not to run an installer? Download `IpvThumb-portable-<version>.zip`,
extract it, and double-click `install.bat` (or `uninstall.bat` to remove it).

### Thumbnails not showing?

- Use **Medium icons** view or larger.
- In Folder Options › View, untick **"Always show icons, never thumbnails"**.
- Restart Explorer: Task Manager › right-click **Windows Explorer** › **Restart**.
- Clear old cached icons: **Disk Cleanup** › tick **Thumbnails** › OK.

Works on Windows 10 and 11, on both regular (x64) PCs and ARM PCs.

## Google Drive

There are three ways to see your `.ipv` artwork in Google Drive. The first
needs no Google Cloud setup.

### Option 1: Apps Script (easiest, no Google Cloud)

A small script that runs in your own Google account and gives every `.ipv`
file in your Drive its artwork as its Drive thumbnail. It can keep running
every hour, so new and re-uploaded files are handled automatically.

1. Go to [script.google.com](https://script.google.com) and click **New project**.
   Click "Untitled project" at the top and name it **IPV Thumbnails**.
2. Click the gear icon (**Project Settings**) and tick
   **Show "appsscript.json" manifest file in editor**.
3. Back in the editor (the `< >` icon), set up three files. For each one,
   select everything in the editor and paste over it:
   - `appsscript.json`: paste [`drive-script/appsscript.json`](drive-script/appsscript.json).
     This switches on the Drive service the script uses.
   - `Code.gs`: paste [`drive-script/Code.gs`](drive-script/Code.gs).
   - Click **+** next to Files › **Script**, name it `ipv`, and paste
     [`drive-script/ipv.gs`](drive-script/ipv.gs).
4. Click **Save** (the disk icon). In the toolbar, pick **addThumbnails** from
   the function list and click **Run**.
5. The first time, Google asks for permission. Choose your account. You'll see
   **"Google hasn't verified this app"**: that appears for any personal script.
   Click **Advanced** › **Go to IPV Thumbnails (unsafe)** › **Allow**. The script
   runs only in your account, and nobody else gets access to your Drive.
6. The log at the bottom lists each file. If it says **Paused**, click **Run**
   again; large Drives can take a few runs.
7. Optional: pick **turnOnAutoUpdate** and click **Run** to repeat this every
   hour. **turnOffAutoUpdate** stops it.

Drive can take a few minutes to show new thumbnails. Artwork larger than
Drive's 2 MB thumbnail limit is skipped by the script (the log says which);
Option 2 can shrink those.

### Option 2: IPV Viewer web page

Open IPV Viewer and click **Add Drive thumbnails**, then **Choose files in
Drive** and pick your `.ipv` files. The page only gets access to the files you
pick. This needs the one-time Google Cloud setup under "For maintainers".

### Option 3: Google Drive for desktop (Windows only)

If you install [Google Drive for desktop](https://www.google.com/drive/download/)
along with the Windows thumbnail installer above, your Drive appears in File
Explorer and its `.ipv` files get thumbnails there, with no other setup. These
show on that PC only, not on drive.google.com. If Drive for desktop is set to
stream files, Windows downloads each `.ipv` file to make its thumbnail.

Drive removes a custom thumbnail when a new version of the file is uploaded.
Option 1 with auto-update re-adds it on its own; with Option 2, add it again.

## How it works

An `.ipv` file is ibisPaint's save log: a list of chunks, each laid out as
`tag | length | data | -(length + 8)`. ibisPaint stores the finished,
flattened artwork as an ordinary PNG in a chunk near the end of the file
(tag `0x01000500`, layer `-1`, kind `0`). Because each chunk ends with that
negative length, the handler can walk backwards from the end of the file and
usually finds the image in about 8 small reads. It then decodes the PNG with
the image decoder built into Windows. A damaged file, or one that isn't really
an `.ipv`, just shows the normal icon.

`tools/ipv_extract.py` also exports every layer as a PNG
(`pip install pillow numpy`, then `python tools/ipv_extract.py file.ipv outdir`).
Layer opacity, blend modes, order, and names are not decoded yet.

## For maintainers

GitHub Actions builds everything; you don't need Visual Studio.

- **Every push or pull request**: tests both parsers (C++ and the web viewer's
  JavaScript) and the Apps Script on Linux, builds x64 and
  ARM64 DLLs, loads the x64 DLL and renders test thumbnails exactly as Explorer
  would (checking the size and that the image isn't flipped), then builds the
  installer. The results are under the run's **Artifacts**.
- **Publishing a release**: push a version tag. The workflow attaches the
  installer and the portable zip to a new GitHub Release.

  ```
  git tag v1.0.0
  git push origin v1.0.0
  ```

### Turning on the web viewer (GitHub Pages)

Repo **Settings › Pages** › Source: **Deploy from a branch** › Branch: `main`,
folder: `/docs` › Save. After a minute the viewer is live at
`https://<your-username>.github.io/<repo-name>/`. Opening local files works
straight away; Drive needs the setup below.

### Google Drive setup for the web page (one time, free)

Only needed for Option 2 above. Option 1 (Apps Script) doesn't need any of this.

You need a Google Cloud project so Google knows which site is asking for access.
In the [Google Cloud console](https://console.cloud.google.com/):

1. **Create a project** (top bar › project picker › New project).
2. **Turn on the APIs**: APIs & Services › Library › enable **Google Drive API**,
   then **Google Picker API**.
3. **Set up sign-in** (APIs & Services › OAuth consent screen, also called
   Google Auth Platform): app name "IPV Viewer", your email, audience
   **External**. Under data access, add the scope
   `https://www.googleapis.com/auth/drive.file`. While the app is in **Testing**,
   add your own Google account (and up to 100 others) as **test users**.
4. **OAuth client ID**: Credentials › Create credentials › OAuth client ID ›
   **Web application**. Under Authorized JavaScript origins, add
   `https://<your-username>.github.io` (no path, no trailing slash). Copy the
   client ID.
5. **API key**: Credentials › Create credentials › API key. Edit it:
   Application restrictions › **Websites** › `https://<your-username>.github.io/*`;
   API restrictions › **Restrict key** › Google Picker API. Copy the key.
6. **Project number**: the Dashboard or Project settings page shows it (digits only).
7. Put the three values in `docs/config.js` and commit.

These values aren't secrets: they're visible to anyone who opens the page, and
Google only accepts them from your site's address.

To let people outside your test-user list use it, publish the app on the
consent screen. `drive.file` is Google's recommended low-access scope, but
Google may still ask you to verify the app's name and homepage; `docs/privacy.html`
is there for the privacy-policy link it asks for.

### Optional: "Open with › IPV Viewer" in Drive

This adds IPV Viewer to Drive's right-click menu for `.ipv` files.

1. In the Cloud console, open **Google Drive API** › **Drive UI integration**.
2. Fill in the app name and descriptions, upload the icons from `docs/icons/`,
   set **Open URL** to `https://<your-username>.github.io/<repo-name>/`, and add
   `ipv` under **Default file extensions**. Save.
3. On the consent screen's data access, also add the scope
   `https://www.googleapis.com/auth/drive.install`.
4. Set `openWith: true` in `docs/config.js` and commit.
5. Open IPV Viewer, click **Add Drive thumbnails › Choose files in Drive**, and
   sign in once. That installs the app into your Drive. If it doesn't show up
   under Open with afterwards, Google may require a Google Workspace Marketplace
   listing for this step; the thumbnail feature works either way.

Test files are generated by `tests/make_samples.py`. To also test real files,
add them to `tests/samples/` (any `.ipv` there must parse successfully).

| Path | What it is |
| --- | --- |
| `src/ipv_parse.h` | Format parser (portable C++, shared with tests) |
| `src/IpvThumbnailProvider.cpp` | The Explorer thumbnail handler (COM DLL) |
| `installer/IpvThumb.iss` | Inno Setup installer script |
| `portable/` | install/uninstall scripts for the zip download |
| `tests/` | Parser test, Windows smoke test, sample generator |
| `tools/ipv_extract.py` | Exports the final image and layers as PNGs |
| `docs/` | IPV Viewer web page and Google Drive features (GitHub Pages) |
| `docs/ipv.js` | Format parser for the browser (tested by `tests/test_ipv_js.cjs`) |
| `docs/config.js` | Your Google Cloud values for the Drive features |
| `drive-script/` | Apps Script version of the Drive thumbnails (no Google Cloud) |
