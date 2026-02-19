import { tool } from '@langchain/core/tools';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { spawn } from 'child_process';
import { homedir } from 'os';

const MAX_OUTPUT_BYTES = 512 * 1024; // 512KB max stdout/stderr
const DEFAULT_TIMEOUT = 30_000; // 30 seconds

const ExecuteBashSchema = z.object({
  command: z.string().describe('The shell command to execute'),
  workdir: z.string().optional().describe('Working directory. Defaults to home directory.'),
  timeout: z.number().optional().describe('Timeout in milliseconds. Default: 30000'),
});

export function createExecuteBashTool(): DynamicStructuredTool {
  return tool(
    async (input) => {
      const { command, workdir, timeout = DEFAULT_TIMEOUT } = input;
      const cwd = workdir || homedir();

      return new Promise<string>((resolve) => {
        // If command backgrounds a process (ends with &), redirect its stdio
        // so the backgrounded child doesn't keep our pipes open
        const isBackgrounded = /&\s*$/.test(command.trim());
        const wrappedCommand = isBackgrounded
          ? command.trim().replace(/&\s*$/, '>/dev/null 2>&1 &')
          : command;

        const proc = spawn('bash', ['-c', wrappedCommand], {
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
          let result = '';
          if (stdout) result += stdout;
          if (stderr) result += (result ? '\n' : '') + `stderr: ${stderr}`;
          if (result) {
            result += `\n(process timed out after ${timeout}ms and was killed — output above was captured before timeout)`;
          } else {
            result = `(process timed out after ${timeout}ms with no output — it may still be running in the background)`;
          }
          resolve(result);
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
      description: 'Execute a bash command on the system. Can run any shell command — install packages, manage files, run scripts, use git, curl, etc. Returns stdout and stderr. IMPORTANT: Working directory defaults to the home directory. Avoid recursive searches (grep -r, find) without specifying a narrow target directory — searching from ~ will be extremely slow and will time out.',
      schema: ExecuteBashSchema,
    }
  );
}
