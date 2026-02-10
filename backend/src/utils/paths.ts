import fs from 'node:fs';
import path from 'node:path';

const cwd = process.cwd();
const configuredProjectRoot = process.env.RESUME_AUTOMATOR_PROJECT_ROOT;
const configuredBackendRoot = process.env.RESUME_AUTOMATOR_BACKEND_ROOT;
const configuredStorageRoot = process.env.RESUME_AUTOMATOR_STORAGE_ROOT;

const inferredBackendRoot =
  path.basename(cwd) === 'backend' ? cwd : path.join(cwd, 'backend');
const inferredProjectRoot =
  path.basename(cwd) === 'backend' ? path.dirname(cwd) : cwd;

export const PROJECT_ROOT = configuredProjectRoot ?? inferredProjectRoot;
export const BACKEND_ROOT = configuredBackendRoot ?? inferredBackendRoot;
export const STORAGE_ROOT = configuredStorageRoot ?? path.join(BACKEND_ROOT, 'storage');
export const REPO_ROOT = path.join(STORAGE_ROOT, 'repo');
export const RESUMES_DIR = path.join(REPO_ROOT, 'resumes');
export const GLOBAL_FILE = path.join(REPO_ROOT, 'global.json');
export const EVENTS_DIR = path.join(STORAGE_ROOT, 'events');
export const BUILDS_DIR = path.join(STORAGE_ROOT, 'builds');
export const HISTORY_CACHE_DIR = path.join(STORAGE_ROOT, '.history-cache');
export const SETTINGS_FILE = path.join(STORAGE_ROOT, 'settings.json');
export const EXPORT_MANIFEST_FILE = path.join(STORAGE_ROOT, 'pdf-export-manifest.json');

export function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

export function ensureStorageLayout(): void {
  ensureDir(STORAGE_ROOT);
  ensureDir(REPO_ROOT);
  ensureDir(RESUMES_DIR);
  ensureDir(EVENTS_DIR);
  ensureDir(BUILDS_DIR);
  ensureDir(HISTORY_CACHE_DIR);
}
