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

Open IPV Viewer and click **Add Drive thumbnails**, then **Choose files in
Drive** and pick your `.ipv` files. Each one gets its finished artwork as its
Drive thumbnail. The page only gets access to the files you pick.

Thumbnails can take a few minutes to show up. Drive removes a custom thumbnail
when a new version of the file is uploaded, so add it again after re-uploading.

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
  JavaScript) on Linux, builds x64 and
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

### Google Drive setup (one time, free)

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
