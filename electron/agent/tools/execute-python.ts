import { tool } from '@langchain/core/tools';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { spawn, execSync } from 'child_process';
import { writeFile, mkdtemp, mkdir, access, rm } from 'fs/promises';
import { tmpdir, homedir } from 'os';
import { join } from 'path';
import { ToolResult } from './types';
import { buildSandboxProfile, isSandboxAvailable, getSandboxExecPath } from './sandbox';

const VENV_DIR = join(homedir(), '.faria', 'python-venv');
const installedPackages = new Set<string>();
const MAX_OUTPUT_BYTES = 512 * 1024; // 512KB max stdout/stderr

// Zod schema for the tool
export const ExecutePythonSchema = z.object({
  code: z.string().describe('Python code to execute'),
  packages: z.array(z.string()).optional().describe('List of pip packages to install before running (e.g. ["pandas", "requests"]). Cached between runs.'),
  timeout: z.number().optional().describe('Timeout in milliseconds. Default: 30000'),
});

export interface ExecutePythonParams {
  code: string;
  packages?: string[];
  timeout?: number;
}

async function ensureVenv(): Promise<string> {
  const pythonPath = join(VENV_DIR, 'bin', 'python');

  try {
    await access(pythonPath);
    return pythonPath;
  } catch {
    // Venv doesn't exist, create it
    console.log('[Faria] Creating Python venv at', VENV_DIR);
    await mkdir(join(homedir(), '.faria'), { recursive: true });
    execSync(`python3 -m venv "${VENV_DIR}"`, { stdio: 'pipe' });
    return pythonPath;
  }
}

async function installPackages(pythonPath: string, packages: string[]): Promise<string | null> {
  // Filter out already installed packages (in-memory cache)
  const toInstall = packages.filter(pkg => !installedPackages.has(pkg.toLowerCase()));

  if (toInstall.length === 0) {
    return null;
  }

  console.log('[Faria] Installing packages:', toInstall.join(', '));

  const pipPath = join(VENV_DIR, 'bin', 'pip');

  return new Promise((resolve) => {
    const proc = spawn(pipPath, ['install', '--quiet', ...toInstall], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stderr = '';
    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      if (code === 0) {
        // Add to cache
        toInstall.forEach(pkg => installedPackages.add(pkg.toLowerCase()));
        resolve(null);
      } else {
        resolve(`Failed to install packages: ${stderr}`);
      }
    });

    proc.on('error', (err) => {
      resolve(`Failed to run pip: ${err.message}`);
    });
  });
}

export async function executePython(params: ExecutePythonParams): Promise<ToolResult> {
  const { code, packages = [], timeout = 30000 } = params;

  try {
    // Ensure venv exists and get python path
    const pythonPath = await ensureVenv();

    // Install packages if needed (unsandboxed — needs network + venv writes)
    if (packages.length > 0) {
      const installError = await installPackages(pythonPath, packages);
      if (installError) {
        return { success: false, error: installError };
      }
    }

    // Create temp directory for code file
    const tempDir = await mkdtemp(join(tmpdir(), 'faria-python-'));
    const scriptPath = join(tempDir, 'script.py');

    try {
      await writeFile(scriptPath, code, 'utf-8');

      const env: NodeJS.ProcessEnv = {
        PATH: join(VENV_DIR, 'bin') + ':/usr/bin:/bin',
        PYTHONIOENCODING: 'utf-8',
        VIRTUAL_ENV: VENV_DIR,
        PYTHONDONTWRITEBYTECODE: '1',
      };

      const sandboxProfile = isSandboxAvailable() ? buildSandboxProfile(tempDir) : null;
      const result = await runPython(pythonPath, scriptPath, { env, cwd: tempDir, timeout, sandboxProfile });
      return result;
    } finally {
      // Cleanup entire temp directory
      try {
        await rm(tempDir, { recursive: true });
      } catch {
        // Ignore cleanup errors
      }
    }
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

/**
 * Factory function that creates the execute python tool
 */
export function createExecutePythonTool(): DynamicStructuredTool {
  return tool(
    async (input) => {
      const { code, packages = [], timeout = 30000 } = input;

      try {
        // Ensure venv exists and get python path
        const pythonPath = await ensureVenv();

        // Install packages if needed (unsandboxed — needs network + venv writes)
        if (packages.length > 0) {
          const installError = await installPackages(pythonPath, packages);
          if (installError) {
            throw new Error(installError);
          }
        }

        // Create temp directory for code file
        const tempDir = await mkdtemp(join(tmpdir(), 'faria-python-'));
        const scriptPath = join(tempDir, 'script.py');

        try {
          await writeFile(scriptPath, code, 'utf-8');

          const env: NodeJS.ProcessEnv = {
            PATH: join(VENV_DIR, 'bin') + ':/usr/bin:/bin',
            PYTHONIOENCODING: 'utf-8',
            VIRTUAL_ENV: VENV_DIR,
            PYTHONDONTWRITEBYTECODE: '1',
          };

          const sandboxProfile = isSandboxAvailable() ? buildSandboxProfile(tempDir) : null;
          const result = await runPythonInternal(pythonPath, scriptPath, { env, cwd: tempDir, timeout, sandboxProfile });
          return result;
        } finally {
          // Cleanup entire temp directory
          try {
            await rm(tempDir, { recursive: true });
          } catch {
            // Ignore cleanup errors
          }
        }
      } catch (error) {
        throw new Error(String(error));
      }
    },
    {
      name: 'execute_python',
      description: 'Execute Python code. Use for calculations, data processing, or any programmatic task. Returns stdout and stderr. Packages are cached in a persistent venv.',
      schema: ExecutePythonSchema,
    }
  );
}

function runPython(
  pythonPath: string,
  scriptPath: string,
  options: { env: NodeJS.ProcessEnv; cwd: string; timeout: number; sandboxProfile: string | null }
): Promise<ToolResult> {
  return new Promise((resolve) => {
    const command = options.sandboxProfile ? getSandboxExecPath() : pythonPath;
    const args = options.sandboxProfile
      ? ['-p', options.sandboxProfile, pythonPath, scriptPath]
      : [scriptPath];

    const proc = spawn(command, args, {
      env: options.env,
      cwd: options.cwd,
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      if (stdout.length < MAX_OUTPUT_BYTES) {
        stdout += data.toString();
      }
    });

    proc.stderr.on('data', (data) => {
      if (stderr.length < MAX_OUTPUT_BYTES) {
        stderr += data.toString();
      }
    });

    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      resolve({ success: false, error: `Execution timed out after ${options.timeout}ms` });
    }, options.timeout);

    proc.on('close', (code) => {
      clearTimeout(timer);

      if (code === 0) {
        const truncated = stdout.length >= MAX_OUTPUT_BYTES;
        resolve({
          success: true,
          result: (truncated ? stdout.slice(0, MAX_OUTPUT_BYTES) + '\n...(output truncated)' : stdout) || '(no output)',
        });
      } else {
        resolve({
          success: false,
          error: stderr || `Process exited with code ${code}`,
          result: stdout || undefined,
        });
      }
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      resolve({ success: false, error: `Failed to start Python: ${err.message}` });
    });
  });
}

// Internal version for the tool - returns string or throws
function runPythonInternal(
  pythonPath: string,
  scriptPath: string,
  options: { env: NodeJS.ProcessEnv; cwd: string; timeout: number; sandboxProfile: string | null }
): Promise<string> {
  return new Promise((resolve, reject) => {
    const command = options.sandboxProfile ? getSandboxExecPath() : pythonPath;
    const args = options.sandboxProfile
      ? ['-p', options.sandboxProfile, pythonPath, scriptPath]
      : [scriptPath];

    const proc = spawn(command, args, {
      env: options.env,
      cwd: options.cwd,
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      if (stdout.length < MAX_OUTPUT_BYTES) {
        stdout += data.toString();
      }
    });

    proc.stderr.on('data', (data) => {
      if (stderr.length < MAX_OUTPUT_BYTES) {
        stderr += data.toString();
      }
    });

    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      reject(new Error(`Execution timed out after ${options.timeout}ms`));
    }, options.timeout);

    proc.on('close', (code) => {
      clearTimeout(timer);

      if (code === 0) {
        const truncated = stdout.length >= MAX_OUTPUT_BYTES;
        resolve((truncated ? stdout.slice(0, MAX_OUTPUT_BYTES) + '\n...(output truncated)' : stdout) || '(no output)');
      } else {
        reject(new Error(stderr || `Process exited with code ${code}`));
      }
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error(`Failed to start Python: ${err.message}`));
    });
  });
}
