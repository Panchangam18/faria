import { spawn, execSync } from 'child_process';
import { writeFile, unlink, mkdtemp, mkdir, access } from 'fs/promises';
import { tmpdir, homedir } from 'os';
import { join } from 'path';
import { ToolResult } from './types';

const VENV_DIR = join(homedir(), '.faria', 'python-venv');
const installedPackages = new Set<string>();

export interface ExecutePythonParams {
  code: string;
  packages?: string[];
  sandboxed?: boolean;
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
  const { code, packages = [], sandboxed = true, timeout = 30000 } = params;

  try {
    // Ensure venv exists and get python path
    const pythonPath = await ensureVenv();

    // Install packages if needed
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

      const env = sandboxed
        ? {
            PATH: process.env.PATH,
            PYTHONIOENCODING: 'utf-8',
            VIRTUAL_ENV: VENV_DIR,
          }
        : { ...process.env, PYTHONIOENCODING: 'utf-8', VIRTUAL_ENV: VENV_DIR };

      const cwd = sandboxed ? tempDir : process.cwd();

      const result = await runPython(pythonPath, scriptPath, { env, cwd, timeout });
      return result;
    } finally {
      // Cleanup temp file
      try {
        await unlink(scriptPath);
      } catch {
        // Ignore cleanup errors
      }
    }
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

function runPython(
  pythonPath: string,
  scriptPath: string,
  options: { env: NodeJS.ProcessEnv; cwd: string; timeout: number }
): Promise<ToolResult> {
  return new Promise((resolve) => {
    const proc = spawn(pythonPath, [scriptPath], {
      env: options.env,
      cwd: options.cwd,
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      resolve({ success: false, error: `Execution timed out after ${options.timeout}ms` });
    }, options.timeout);

    proc.on('close', (code) => {
      clearTimeout(timer);

      if (code === 0) {
        resolve({
          success: true,
          result: stdout || '(no output)',
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
