import { REPO_ROOT } from '../utils/paths.js';
import { runCommand } from '../utils/shell.js';

export async function getCurrentCommitHash(): Promise<string> {
  const { stdout } = await runCommand('git', ['rev-parse', 'HEAD'], REPO_ROOT);
  return stdout.trim();
}

export async function repoHasPendingChanges(): Promise<boolean> {
  const { stdout } = await runCommand('git', ['status', '--porcelain'], REPO_ROOT);
  return Boolean(stdout.trim());
}

export async function commitAll(message: string): Promise<string> {
  const pending = await repoHasPendingChanges();
  if (!pending) {
    return getCurrentCommitHash();
  }

  await runCommand('git', ['add', '.'], REPO_ROOT);
  await runCommand('git', ['commit', '-m', message], REPO_ROOT);
  return getCurrentCommitHash();
}

export async function readFileAtCommit(
  commitHash: string,
  relativePath: string,
): Promise<string> {
  const { stdout } = await runCommand(
    'git',
    ['show', `${commitHash}:${relativePath}`],
    REPO_ROOT,
  );
  return stdout;
}
