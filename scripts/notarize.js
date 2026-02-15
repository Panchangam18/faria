// macOS Notarization Script for electron-builder
//
// To enable notarization for distribution outside the Mac App Store:
//
// 1. Set the following environment variables:
//    - APPLE_ID: Your Apple ID email
//    - APPLE_APP_SPECIFIC_PASSWORD: App-specific password from appleid.apple.com
//    - APPLE_TEAM_ID: Your Apple Developer Team ID
//
// 2. In package.json, change "notarize": false to "notarize": true in build.mac
//
// 3. Ensure you have a valid Developer ID Application certificate installed
//    in your Keychain. Set the signing identity via:
//    - CSC_NAME="Developer ID Application: Your Name (TEAM_ID)"
//    or
//    - CSC_LINK and CSC_KEY_PASSWORD for CI environments
//
// electron-builder v24+ handles notarization natively when build.mac.notarize
// is set to true (or an object with appleId, appleIdPassword, teamId).
//
// For manual notarization or custom workflows, you can use this script
// as an afterSign hook by adding to package.json build config:
//   "afterSign": "scripts/notarize.js"

const { notarize } = require('@electron/notarize');
const path = require('path');

exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context;

  if (electronPlatformName !== 'darwin') {
    return;
  }

  if (!process.env.APPLE_ID || !process.env.APPLE_APP_SPECIFIC_PASSWORD || !process.env.APPLE_TEAM_ID) {
    console.log('Skipping notarization: APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, or APPLE_TEAM_ID not set');
    return;
  }

  const appName = context.packager.appInfo.productFilename;
  const appPath = path.join(appOutDir, `${appName}.app`);

  console.log(`Notarizing ${appPath}...`);

  await notarize({
    appPath,
    appleId: process.env.APPLE_ID,
    appleIdPassword: process.env.APPLE_APP_SPECIFIC_PASSWORD,
    teamId: process.env.APPLE_TEAM_ID,
  });

  console.log('Notarization complete.');
};
