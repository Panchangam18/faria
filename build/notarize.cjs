const { notarize } = require("@electron/notarize");

exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context;
  if (electronPlatformName !== "darwin") return;

  const appName = context.packager.appInfo.productFilename;
  const appPath = `${appOutDir}/${appName}.app`;
  const appleId = process.env.APPLE_ID;
  const appleIdPassword = process.env.APPLE_APP_SPECIFIC_PASSWORD;
  const teamId = process.env.APPLE_TEAM_ID;

  const missing = [
    ["APPLE_ID", appleId],
    ["APPLE_APP_SPECIFIC_PASSWORD", appleIdPassword],
    ["APPLE_TEAM_ID", teamId],
  ].filter(([, value]) => !value);

  if (missing.length > 0) {
    const names = missing.map(([name]) => name).join(", ");
    throw new Error(
      `Missing required notarization environment variable(s): ${names}. ` +
      "In GitHub Actions, add repo secrets for APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, and APPLE_TEAM_ID."
    );
  }

  console.log(`Notarizing ${appPath}...`);

  try {
    await notarize({
      appPath,
      appleId,
      appleIdPassword,
      teamId,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `${message}\n\n` +
      "If Apple returns an authentication error, make sure APPLE_APP_SPECIFIC_PASSWORD is an Apple app-specific password " +
      "from appleid.apple.com and not your normal Apple ID password."
    );
  }

  console.log("Notarization complete.");
};
