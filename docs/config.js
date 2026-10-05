// Google settings for the Drive features. Leave them empty to use the viewer
// without Drive. See README.md, "Google Drive setup", for where each comes from.
// These values are not secrets: they're visible to anyone who opens the page,
// and Google restricts them to your site's address.
window.IPV_CONFIG = {
  // OAuth client ID, ends in .apps.googleusercontent.com
  clientId: '',
  // API key, restricted to the Google Picker API and your site's address
  apiKey: '',
  // Google Cloud project NUMBER (digits only, not the project ID)
  appId: '',
  // true = also add "IPV Viewer" to Drive's right-click "Open with" menu.
  // Needs the extra "Drive UI integration" step in the README.
  openWith: false,
};
