const { notarize } = require("@electron/notarize");

exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context;
  if (electronPlatformName !== "darwin") return;

  const appName = context.packager.appInfo.productFilename;
  const appPath = `${appOutDir}/${appName}.app`;

  console.log(`Notarizing ${appPath}...`);
  console.log(`Apple ID: ${process.env.APPLE_ID}`);
  console.log(`Team ID: ${process.env.APPLE_TEAM_ID}`);

  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("Notarization timed out after 30 minutes")), 30 * 60 * 1000)
  );

  await Promise.race([
    notarize({
      appPath,
      appleId: process.env.APPLE_ID,
      appleIdPassword: process.env.APPLE_ID_PASSWORD,
      teamId: process.env.APPLE_TEAM_ID,
    }),
    timeout,
  ]);

  console.log("Notarization complete.");
};
