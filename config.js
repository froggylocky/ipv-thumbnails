// Google settings for the Drive features. Leave them empty to use the viewer
// without Drive. See README.md for where each comes from.
//   "Open with" / Connected apps needs: clientId + openWith: true
//   Adding thumbnails from this page also needs: apiKey + appId
// These values are not secrets: they're visible to anyone who opens the page,
// and Google restricts them to your site's address.
window.IPV_CONFIG = {
  // OAuth client ID, ends in .apps.googleusercontent.com
  clientId: '',
  // API key, restricted to the Google Picker API and your site's address
  apiKey: '',
  // Google Cloud project NUMBER (digits only, not the project ID)
  appId: '',
  // true = offer "Add IPV Viewer to Drive", which puts it in Drive's "Open with"
  // menu and preview screen. Needs the "Drive UI integration" step in the README.
  openWith: false,
};
