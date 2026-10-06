// Google settings for the Drive features. Leave them empty to use the viewer
// without Drive. See README.md for where each comes from.
//   "Open with" / Connected apps needs: clientId + openWith: true
//   Adding thumbnails from this page also needs: apiKey + appId
// These values are not secrets: they're visible to anyone who opens the page,
// and Google restricts them to your site's address.
window.IPV_CONFIG = {
  // OAuth client ID, ends in .apps.googleusercontent.com
  clientId: '568534552197-21qsn6se4vasnt1s8bu8ddplf72odvij.apps.googleusercontent.com',
  // API key, restricted to the Google Picker API and your site's address
  apiKey: 'AIzaSyAo0bT6Y3BndMUIoGRZpqW-mtCfFpkXsxQ',
  // Google Cloud project NUMBER (digits only, not the project ID)
  appId: 'project-6f68878a-e698-4ff5-b7a ',
  // true = offer "Add IPV Viewer to Drive", which puts it in Drive's "Open with"
  // menu and preview screen. Needs the "Drive UI integration" step in the README.
  openWith: true,
};
