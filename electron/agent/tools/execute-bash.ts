import { tool } from '@langchain/core/tools';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { spawn } from 'child_process';
import { homedir } from 'os';

const MAX_OUTPUT_BYTES = 512 * 1024; // 512KB max stdout/stderr
const DEFAULT_TIMEOUT = 120_000; // 2 minutes

const ExecuteBashSchema = z.object({
  command: z.string().describe('The shell command to execute'),
  workdir: z.string().optional().describe('Working directory. Defaults to home directory.'),
  timeout: z.number().optional().describe('Timeout in milliseconds. Default: 120000'),
});

export function createExecuteBashTool(): DynamicStructuredTool {
  return tool(
    async (input) => {
      const { command, workdir, timeout = DEFAULT_TIMEOUT } = input;
      const cwd = workdir || homedir();

      return new Promise<string>((resolve) => {
        const proc = spawn('bash', ['-c', command], {
          cwd,
          env: { ...process.env },
          stdio: ['pipe', 'pipe', 'pipe'],
        });

        let stdout = '';
        let stderr = '';

        proc.stdout.on('data', (data: Buffer) => {
          if (stdout.length < MAX_OUTPUT_BYTES) {
            stdout += data.toString();
          }
        });

        proc.stderr.on('data', (data: Buffer) => {
          if (stderr.length < MAX_OUTPUT_BYTES) {
            stderr += data.toString();
          }
        });

        proc.stdin.end();

        const timer = setTimeout(() => {
          proc.kill('SIGKILL');
          resolve(`Error: Command timed out after ${timeout}ms`);
        }, timeout);

        proc.on('close', (code) => {
          clearTimeout(timer);
          const truncatedStdout = stdout.length >= MAX_OUTPUT_BYTES
            ? stdout.slice(0, MAX_OUTPUT_BYTES) + '\n...(output truncated)'
            : stdout;
          const truncatedStderr = stderr.length >= MAX_OUTPUT_BYTES
            ? stderr.slice(0, MAX_OUTPUT_BYTES) + '\n...(output truncated)'
            : stderr;

          let result = '';
          if (truncatedStdout) result += truncatedStdout;
          if (truncatedStderr) result += (result ? '\n' : '') + `stderr: ${truncatedStderr}`;
          if (!result) result = `(no output, exit code ${code})`;
          if (code !== 0) result = `Exit code ${code}\n${result}`;
          resolve(result);
        });

        proc.on('error', (err) => {
          clearTimeout(timer);
          resolve(`Error: Failed to execute command: ${err.message}`);
        });
      });
    },
    {
      name: 'execute_bash',
      description: 'Execute a bash command on the system. Can run any shell command — install packages, manage files, run scripts, use git, curl, etc. Returns stdout and stderr.',
      schema: ExecuteBashSchema,
    }
  );
}
