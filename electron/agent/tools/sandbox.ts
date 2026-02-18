import { homedir } from 'os';
import { realpathSync, accessSync, constants } from 'fs';

const SANDBOX_EXEC = '/usr/bin/sandbox-exec';

// Check once at module load whether sandbox-exec is available
let sandboxAvailable = false;
try {
  accessSync(SANDBOX_EXEC, constants.X_OK);
  sandboxAvailable = true;
} catch {
  console.warn('[Faria] sandbox-exec not available, Python will run without OS sandbox');
}

export function isSandboxAvailable(): boolean {
  return sandboxAvailable;
}

export function getSandboxExecPath(): string {
  return SANDBOX_EXEC;
}

/**
 * Build a macOS Seatbelt sandbox profile for Python script execution.
 *
 * Security model:
 * - Deny all by default
 * - Allow file reads broadly (Python needs stdlib, frameworks, venv packages)
 * - Deny reads to sensitive user directories (ssh keys, documents, credentials)
 * - Allow file writes ONLY to the provided temp directory
 * - Allow network access (agent may call APIs on user's behalf)
 * - Sandbox is inherited by all child processes
 */
export function buildSandboxProfile(tempDir: string): string {
  const home = homedir();
  // macOS symlinks /var -> /private/var; resolve to real path for sandbox rules
  const realTempDir = realpathSync(tempDir);

  return [
    '(version 1)',
    '(deny default)',

    // Process execution (sandbox inherited by children)
    '(allow process-exec)',
    '(allow process-fork)',

    // File reads — allow broadly, then deny sensitive dirs
    '(allow file-read*)',

    // System calls Python needs
    '(allow sysctl-read)',
    '(allow mach-lookup)',
    '(allow signal (target self))',

    // Network — allowed for API calls, web scraping
    '(allow network*)',

    // File writes — sandbox temp dir + /tmp/faria for cross-app temp files
    `(allow file-write* (subpath "${realTempDir}"))`,
    '(allow file-write* (subpath "/private/tmp/faria"))',
    '(allow file-write* (subpath "/tmp/faria"))',

    // Block reads to sensitive user directories
    `(deny file-read* (subpath "${home}/Documents"))`,
    `(deny file-read* (subpath "${home}/Desktop"))`,
    `(deny file-read* (subpath "${home}/Downloads"))`,
    `(deny file-read* (subpath "${home}/.ssh"))`,
    `(deny file-read* (subpath "${home}/.gnupg"))`,
    `(deny file-read* (subpath "${home}/.config"))`,
    `(deny file-read* (subpath "${home}/.aws"))`,
    `(deny file-read* (subpath "${home}/.kube"))`,
    `(deny file-read* (subpath "${home}/Library/Keychains"))`,
    `(deny file-read* (subpath "${home}/Library/Mail"))`,
    `(deny file-read* (subpath "${home}/Library/Messages"))`,
    `(deny file-read* (subpath "${home}/Library/Cookies"))`,
    `(deny file-read* (subpath "${home}/Library/Accounts"))`,
  ].join('\n');
}
