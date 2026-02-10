import { execFile } from 'node:child_process';

export interface ShellResult {
  stdout: string;
  stderr: string;
}

export function runCommand(
  command: string,
  args: string[],
  cwd: string,
): Promise<ShellResult> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { cwd, maxBuffer: 1024 * 1024 * 20 }, (error, stdout, stderr) => {
      if (error) {
        const err = new Error(
          `${command} ${args.join(' ')} failed: ${stderr || error.message}`,
        );
        reject(err);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}
