import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * Escape a string for use in AppleScript
 * Handles quotes and backslashes
 */
export function escapeForAppleScript(str: string): string {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
}

/**
 * Execute an AppleScript and return the result
 */
export async function runAppleScript(script: string): Promise<string> {
  try {
    // Use osascript to execute AppleScript
    const { stdout, stderr } = await execAsync(`osascript -e '${script.replace(/'/g, "'\"'\"'")}'`, {
      timeout: 30000, // 30 second timeout
      maxBuffer: 1024 * 1024 * 10, // 10MB buffer for large outputs
    });

    if (stderr && !stdout) {
      throw new Error(stderr);
    }

    return stdout.trim();
  } catch (error) {
    const err = error as Error & { stderr?: string };
    throw new Error(`AppleScript execution failed: ${err.message || err.stderr || 'Unknown error'}`);
  }
}

/**
 * Execute AppleScript from a file
 */
export async function runAppleScriptFile(filePath: string): Promise<string> {
  try {
    const { stdout, stderr } = await execAsync(`osascript "${filePath}"`, {
      timeout: 30000,
      maxBuffer: 1024 * 1024 * 10,
    });

    if (stderr && !stdout) {
      throw new Error(stderr);
    }

    return stdout.trim();
  } catch (error) {
    const err = error as Error & { stderr?: string };
    throw new Error(`AppleScript file execution failed: ${err.message || err.stderr || 'Unknown error'}`);
  }
}

/**
 * Get the frontmost application name
 */
export async function getFrontmostApp(): Promise<string> {
  const script = `
    tell application "System Events"
      set frontApp to name of first application process whose frontmost is true
      return frontApp
    end tell
  `;
  return runAppleScript(script);
}

/**
 * Get the bundle identifier of an application
 */
export async function getAppBundleId(appName: string): Promise<string | null> {
  const script = `
    try
      return id of application "${escapeForAppleScript(appName)}"
    on error
      return ""
    end try
  `;
  const result = await runAppleScript(script);
  return result || null;
}

/**
 * Bring an application to the foreground
 */
export async function focusApp(appName: string): Promise<void> {
  const script = `
    tell application "${escapeForAppleScript(appName)}"
      activate
    end tell
  `;
  await runAppleScript(script);
}

/**
 * Check if an application is running
 */
export async function isAppRunning(appName: string): Promise<boolean> {
  const script = `
    tell application "System Events"
      return (name of processes) contains "${escapeForAppleScript(appName)}"
    end tell
  `;
  const result = await runAppleScript(script);
  return result === 'true';
}

/**
 * Get the path to an application
 */
export async function getAppPath(appName: string): Promise<string | null> {
  const script = `
    try
      tell application "Finder"
        return POSIX path of (application file id (id of application "${escapeForAppleScript(appName)}") as alias)
      end tell
    on error
      return ""
    end try
  `;
  const result = await runAppleScript(script);
  return result || null;
}

/**
 * Execute JavaScript in a browser via AppleScript
 */
export async function executeJavaScriptInBrowser(
  browser: 'Safari' | 'Google Chrome' | 'Arc',
  js: string
): Promise<string> {
  const escapedJs = escapeForAppleScript(js);
  
  let script: string;
  
  switch (browser) {
    case 'Safari':
      script = `
        tell application "Safari"
          do JavaScript "${escapedJs}" in current tab of front window
        end tell
      `;
      break;
    case 'Google Chrome':
      script = `
        tell application "Google Chrome"
          execute front window's active tab javascript "${escapedJs}"
        end tell
      `;
      break;
    case 'Arc':
      script = `
        tell application "Arc"
          execute front window's active tab javascript "${escapedJs}"
        end tell
      `;
      break;
    default:
      throw new Error(`Unsupported browser: ${browser}`);
  }
  
  return runAppleScript(script);
}

