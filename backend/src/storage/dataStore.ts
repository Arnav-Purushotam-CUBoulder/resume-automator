import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import {
  AppSettings,
  CommitEvent,
  GlobalCatalog,
  ResumeDocument,
} from '../domain/types.js';
import {
  EXPORT_MANIFEST_FILE,
  EVENTS_DIR,
  GLOBAL_FILE,
  REPO_ROOT,
  RESUMES_DIR,
  SETTINGS_FILE,
  ensureStorageLayout,
} from '../utils/paths.js';
import { runCommand } from '../utils/shell.js';
import { nowIso } from '../utils/time.js';
import { createSeedGlobal, createSeedResumes } from './seed.js';

function resumePath(id: string): string {
  return path.join(RESUMES_DIR, `${id}.json`);
}

async function readJson<T>(filePath: string): Promise<T> {
  const raw = await fsp.readFile(filePath, 'utf8');
  return JSON.parse(raw) as T;
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await fsp.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function hasGitRepo(): Promise<boolean> {
  return fs.existsSync(path.join(REPO_ROOT, '.git'));
}

async function setupGitRepo(): Promise<void> {
  await runCommand('git', ['init'], REPO_ROOT);
  await runCommand('git', ['config', 'user.name', 'Resume Automator'], REPO_ROOT);
  await runCommand('git', ['config', 'user.email', 'resume-automator@local'], REPO_ROOT);
}

async function seedIfNeeded(): Promise<void> {
  if (fs.existsSync(GLOBAL_FILE)) {
    return;
  }

  const now = nowIso();
  const global = createSeedGlobal(now);
  const resumes = createSeedResumes(now);

  await writeJson(GLOBAL_FILE, global);
  await Promise.all(resumes.map((resume) => writeJson(resumePath(resume.id), resume)));
}

async function seedSettingsIfNeeded(): Promise<void> {
  if (fs.existsSync(SETTINGS_FILE)) {
    return;
  }

  const settings: AppSettings = {
    exportPdfDir: undefined,
    updatedAt: nowIso(),
  };

  await writeJson(SETTINGS_FILE, settings);
}

async function seedExportManifestIfNeeded(): Promise<void> {
  if (fs.existsSync(EXPORT_MANIFEST_FILE)) {
    return;
  }

  await writeJson(EXPORT_MANIFEST_FILE, {});
}

async function initialCommitIfNeeded(): Promise<void> {
  const { stdout } = await runCommand('git', ['status', '--porcelain'], REPO_ROOT);
  if (!stdout.trim()) {
    return;
  }
  await runCommand('git', ['add', '.'], REPO_ROOT);
  await runCommand('git', ['commit', '-m', 'Initial resume seed'], REPO_ROOT);
}

export async function initializeStorage(): Promise<void> {
  ensureStorageLayout();
  if (!(await hasGitRepo())) {
    await setupGitRepo();
  }
  await seedIfNeeded();
  await seedSettingsIfNeeded();
  await seedExportManifestIfNeeded();
  await initialCommitIfNeeded();
}

export async function loadGlobal(): Promise<GlobalCatalog> {
  return readJson<GlobalCatalog>(GLOBAL_FILE);
}

export async function saveGlobal(global: GlobalCatalog): Promise<void> {
  await writeJson(GLOBAL_FILE, global);
}

export async function loadSettings(): Promise<AppSettings> {
  if (!fs.existsSync(SETTINGS_FILE)) {
    const fallback: AppSettings = {
      exportPdfDir: undefined,
      updatedAt: nowIso(),
    };
    await writeJson(SETTINGS_FILE, fallback);
    return fallback;
  }
  return readJson<AppSettings>(SETTINGS_FILE);
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  await writeJson(SETTINGS_FILE, settings);
}

export async function loadExportManifest(): Promise<Record<string, string>> {
  if (!fs.existsSync(EXPORT_MANIFEST_FILE)) {
    await writeJson(EXPORT_MANIFEST_FILE, {});
    return {};
  }
  return readJson<Record<string, string>>(EXPORT_MANIFEST_FILE);
}

export async function saveExportManifest(manifest: Record<string, string>): Promise<void> {
  await writeJson(EXPORT_MANIFEST_FILE, manifest);
}

export async function loadResume(id: string): Promise<ResumeDocument | null> {
  const filePath = resumePath(id);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return readJson<ResumeDocument>(filePath);
}

export async function loadAllResumes(): Promise<ResumeDocument[]> {
  const files = await fsp.readdir(RESUMES_DIR);
  const resumeFiles = files.filter((file) => file.endsWith('.json')).sort();
  const resumes = await Promise.all(
    resumeFiles.map((file) => readJson<ResumeDocument>(path.join(RESUMES_DIR, file))),
  );
  return resumes;
}

export async function saveResume(resume: ResumeDocument): Promise<void> {
  await writeJson(resumePath(resume.id), resume);
}

export async function saveResumes(resumes: ResumeDocument[]): Promise<void> {
  await Promise.all(resumes.map((resume) => saveResume(resume)));
}

export async function deleteResume(id: string): Promise<void> {
  const filePath = resumePath(id);
  if (!fs.existsSync(filePath)) {
    return;
  }
  await fsp.unlink(filePath);
}

export async function saveCommitEvent(event: CommitEvent): Promise<void> {
  await writeJson(path.join(EVENTS_DIR, `${event.id}.json`), event);
}

export async function loadAllCommitEvents(): Promise<CommitEvent[]> {
  const files = (await fsp.readdir(EVENTS_DIR)).filter((file) => file.endsWith('.json')).sort();
  const events = await Promise.all(
    files.map((file) => readJson<CommitEvent>(path.join(EVENTS_DIR, file))),
  );
  return events.sort((a, b) =>
    a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0,
  );
}

export function getResumeFileRelativePath(id: string): string {
  return `resumes/${id}.json`;
}
