# IPV Thumbnails

See your ibisPaint X `.ipv` artwork without opening ibisPaint:

- **Windows File Explorer**: thumbnails for `.ipv` files (installer below).
- **IPV Viewer** (web, in `docs/`): open an `.ipv` file in any browser to see
  the finished artwork and every layer, save them as PNGs, and add thumbnails
  to your `.ipv` files in **Google Drive**. Once GitHub Pages is on, it lives at
  `https://froggylocky.github.io/ipv-thumbnails/`.

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

There are three ways to see your `.ipv` artwork in Google Drive.

### Option 1: Drive add-on (side panel in Google Drive)

IPV Thumbnails adds a panel to Google Drive's right-hand side bar:

- **Select an `.ipv` file** to see its finished artwork in the panel, then
  click **Add thumbnail**. Select several to add them all at once.
- **Add thumbnails now** gives every `.ipv` file in your Drive its artwork as
  its thumbnail.
- **Keep up to date** checks for new and re-uploaded `.ipv` files every hour.

Artwork over Drive's 2 MB thumbnail limit is shrunk automatically.

**Set it up (once, about 10 minutes).** This uses the Google Cloud project from
"Google Drive setup for the web page" below: you need its **project number**,
**Google Drive API** turned on, and the sign-in (OAuth consent) screen set up
with your account as a test user.

1. Go to [script.google.com](https://script.google.com), click **New project**,
   and name it **IPV Thumbnails** (click "Untitled project" at the top).
2. Click the gear icon (**Project Settings**):
   - Tick **Show "appsscript.json" manifest file in editor**.
   - Under **Google Cloud Platform (GCP) Project**, click **Change project**,
     enter your Cloud **project number**, and click **Set project**.
3. Back in the editor (the `< >` icon), create these files. For each, paste
   the contents of the file with the same name from [`drive-addon/`](drive-addon/):
   - `appsscript.json`: select all and paste over it.
   - `Code.gs`: rename it to `Addon` (the ⋮ menu next to it › **Rename**),
     then paste `Addon.gs` over its contents.
   - Click **+** next to Files › **Script** three times, naming them `Thumbs`,
     `Png` and `ipv`, and paste `Thumbs.gs`, `Png.gs` and `ipv.gs` into them.
4. Optional, at the top of `Addon`: set `VIEWER_URL` to your IPV Viewer address
   to get an **Open in IPV Viewer** button for browsing layers. To use the IPV
   Viewer logo in Drive, set `LOGO_URL` there and `logoUrl` in `appsscript.json`
   to `https://froggylocky.github.io/ipv-thumbnails/icons/icon-128.png`.
5. Click **Save**, then **Deploy** › **Test deployments** › make sure
   **Google Workspace add-on** is the application type › **Install** › **Done**.
6. Open [drive.google.com](https://drive.google.com) and refresh. Click the
   IPV Thumbnails icon in the side bar on the right (click the small arrow at
   the bottom right if the side bar is hidden), then **Authorize access**.
   Google shows **"Google hasn't verified this app"** because it's your own
   add-on: click **Advanced** › **Go to IPV Thumbnails (unsafe)** › **Allow**.

To remove it: in the script, **Deploy** › **Test deployments** › **Uninstall**.

**Sharing it with other people.** A test deployment is for you. To let others
install it, publish it with the **Google Workspace Marketplace SDK** in your
Cloud project. Because the add-on can read every file in your Drive (Google
calls this a "restricted" permission), a public listing needs Google's
verification, which includes a paid security assessment; publishing privately
inside a Google Workspace organization doesn't. A version that asks for access
one file at a time would avoid that; it would lose the "all files" and
hourly features.

The same functions also run straight from the Apps Script editor (pick one in
the toolbar, click **Run**): `addThumbnails`, `turnOnAutoUpdate`,
`turnOffAutoUpdate`, and `startOver` (forget progress and re-check everything).

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
Option 1 with "Keep up to date" on re-adds it on its own; with Option 2, add
it again.

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
  JavaScript) and the Drive add-on on Linux, builds x64 and
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
`https://froggylocky.github.io/ipv-thumbnails/`. Opening local files works
straight away; Drive needs the setup below.

### Google Drive setup for the web page (one time, free)

Needed for the web page (Option 2). The add-on (Option 1) needs steps 1 to 3
and 6; steps 4, 5 and 7 are only for the web page. For "Open with", see the
next section.

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
   `https://froggylocky.github.io` (no path, no trailing slash). Copy the
   client ID.
5. **API key**: Credentials › Create credentials › API key. Edit it:
   Application restrictions › **Websites** › `https://froggylocky.github.io/*`;
   API restrictions › **Restrict key** › Google Picker API. Copy the key.
6. **Project number**: the Dashboard or Project settings page shows it (digits only).
7. Put the three values in `docs/config.js` and commit.

These values aren't secrets: they're visible to anyone who opens the page, and
Google only accepts them from your site's address.

To let people outside your test-user list use it, publish the app on the
consent screen. `drive.file` is Google's recommended low-access scope, but
Google may still ask you to verify the app's name and homepage; `docs/privacy.html`
is there for the privacy-policy link it asks for.

### "Open with" and Connected apps: open .ipv files from Drive

Drive's own preview can't show `.ipv` artwork (no app can change that window),
but it lists **Connected apps** under "Could not preview the file". This puts
**IPV Viewer** in that list and in the right-click **Open with** menu, so one
click opens the file's artwork and layers.

You need: the web viewer live on GitHub Pages, and the same Google Cloud project
as the add-on, with your account as a test user on the OAuth consent screen.

1. **OAuth client ID** (skip if you already made one for the web page):
   APIs & Services › Credentials › Create credentials › OAuth client ID ›
   **Web application**. Under Authorized JavaScript origins add
   `https://froggylocky.github.io`. Copy the client ID.
2. **Permissions**: on the OAuth consent screen's **Data access** page, add
   `https://www.googleapis.com/auth/drive.file` and
   `https://www.googleapis.com/auth/drive.install`.
3. **Drive UI integration**: APIs & Services › Enabled APIs & services ›
   **Google Drive API** › **Drive UI integration** tab. Fill in:
   - Application name: `IPV Viewer`, plus a short and long description.
   - Application icons: upload the matching sizes from `docs/icons/`
     (`icon-16.png` to `icon-256.png`).
   - Open URL: `https://froggylocky.github.io/ipv-thumbnails/`
   - Default file extensions: `ipv`
   - Leave "Creating files" and "Importing" off. Turn on "Shared drives support"
     if you keep `.ipv` files in shared drives.

   Save.
4. **config.js**: set `clientId` to the client ID and `openWith: true`. Commit,
   and give GitHub Pages a minute to update. (`apiKey` and `appId` are only
   needed for adding thumbnails from the web page.)
5. **Install it into your Drive** (once): open IPV Viewer, click
   **Google Drive** › **Add IPV Viewer to Drive**, and sign in. You'll see the
   "unverified app" warning for your own app: **Advanced** › **Go to IPV Viewer**
   › **Allow**.
6. In Google Drive, refresh, then double-click an `.ipv` file: **IPV Viewer**
   appears under Connected apps (right-click › **Open with** works too). It
   opens the viewer; click **Load from Drive** to show the artwork. That click
   is needed each time because browsers block Google's sign-in pop-up unless
   you click something.

If IPV Viewer doesn't appear after a few minutes and a refresh, Google may
require the app to be installed through a Google Workspace Marketplace listing
instead. That's set up under **Google Workspace Marketplace SDK** in the same
Cloud project.

With `VIEWER_URL` set in the add-on (`drive-addon/Addon.gs`), its **Open in IPV
Viewer** button opens files the same way.

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
| `docs/icons/` | Logo: `icon-16`/`32`/`48` (compact ".ipv"), `icon-64` to `512` (full logo), `app.ico` (Windows installer), `logo-original.png` |
| `drive-addon/` | Google Drive add-on (Apps Script); `ipv.gs` is a copy of `docs/ipv.js` |
