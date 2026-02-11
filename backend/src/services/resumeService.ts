import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { customAlphabet } from 'nanoid';
import {
  AppSettings,
  CommitEvent,
  GlobalCatalog,
  RenderedResumeData,
  ResumeDocument,
  ResumeSummary,
  SectionKey,
} from '../domain/types.js';
import { renderLatex } from '../latex/renderer.js';
import {
  getResumeFileRelativePath,
  initializeStorage,
  loadAllCommitEvents,
  loadAllResumes,
  loadSettings,
  loadGlobal,
  loadResume,
  saveSettings,
  saveCommitEvent,
  saveGlobal,
  saveResume,
  saveResumes,
} from '../storage/dataStore.js';
import { nowIso } from '../utils/time.js';
import { commitAll, readFileAtCommit } from './gitService.js';
import {
  allSectionKeys,
  buildRenderedResumeData,
  resumesReferencingGlobalPoint,
  toResumeSummary,
} from './resumeAssembler.js';
import {
  compileHistoricalResume,
  compileResume,
  currentArtifactPaths,
} from './compileService.js';
import { syncPdfToExportDirectory } from './pdfExportService.js';
import { BUILDS_DIR, HISTORY_CACHE_DIR, ensureDir } from '../utils/paths.js';

const shortId = customAlphabet('1234567890abcdefghijklmnopqrstuvwxyz', 8);
const publicBaseUrl = (process.env.PUBLIC_BASE_URL ?? 'http://127.0.0.1:4100').replace(
  /\/$/,
  '',
);

function toArtifactUrl(absolutePath: string): string {
  const normalized = absolutePath.replace(/\\/g, '/');
  const marker = '/storage/';
  const idx = normalized.indexOf(marker);
  if (idx < 0) {
    return '';
  }
  const suffix = normalized.slice(idx + marker.length);
  return `${publicBaseUrl}/artifacts/${suffix}`;
}

function summarize(resumes: ResumeDocument[]): ResumeSummary[] {
  return resumes
    .map((resume) => toResumeSummary(resume))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function diffGlobalPoints(oldGlobal: GlobalCatalog, nextGlobal: GlobalCatalog): string[] {
  const ids = new Set<string>([
    ...Object.keys(oldGlobal.points),
    ...Object.keys(nextGlobal.points),
  ]);

  const changed: string[] = [];
  for (const id of ids) {
    const oldText = oldGlobal.points[id]?.text;
    const nextText = nextGlobal.points[id]?.text;
    if (oldText !== nextText) {
      changed.push(id);
    }
  }

  return changed;
}

function hasGlobalStructuralChange(oldGlobal: GlobalCatalog, nextGlobal: GlobalCatalog): boolean {
  const oldShape = {
    header: oldGlobal.header,
    sections: oldGlobal.sections,
  };
  const nextShape = {
    header: nextGlobal.header,
    sections: nextGlobal.sections,
  };
  return JSON.stringify(oldShape) !== JSON.stringify(nextShape);
}

const pointBearingSections = ['experience', 'projects', 'openSource'] as const;
type PointBearingSection = (typeof pointBearingSections)[number];

function normalizePointText(text?: string): string {
  return (text ?? '').replace(/\s+/g, ' ').trim();
}

function buildRelinkTextIndex(
  oldGlobal: GlobalCatalog,
  nextGlobal: GlobalCatalog,
  changedPointIds: string[],
): Map<string, string> {
  const oldTextCounts = new Map<string, number>();

  for (const pointId of changedPointIds) {
    const oldText = normalizePointText(oldGlobal.points[pointId]?.text);
    const nextText = normalizePointText(nextGlobal.points[pointId]?.text);
    if (!oldText || !nextText || oldText === nextText) {
      continue;
    }
    oldTextCounts.set(oldText, (oldTextCounts.get(oldText) ?? 0) + 1);
  }

  const index = new Map<string, string>();
  for (const pointId of changedPointIds) {
    const oldText = normalizePointText(oldGlobal.points[pointId]?.text);
    const nextText = normalizePointText(nextGlobal.points[pointId]?.text);
    if (!oldText || !nextText || oldText === nextText) {
      continue;
    }
    // Ambiguous source text (same old text mapped to multiple global points) is skipped.
    if ((oldTextCounts.get(oldText) ?? 0) !== 1) {
      continue;
    }
    index.set(oldText, pointId);
  }

  return index;
}

function collectUsedLocalPointIds(resume: ResumeDocument): Set<string> {
  const used = new Set<string>();

  for (const section of pointBearingSections) {
    const localEntryById = new Map(
      resume.local[section].map((entry) => [entry.id, entry] as const),
    );

    for (const ref of resume.sections[section]) {
      if (!ref.localId) {
        continue;
      }
      const localEntry = localEntryById.get(ref.localId);
      if (!localEntry) {
        continue;
      }
      for (const pointId of localEntry.pointIds) {
        if (resume.local.points[pointId]) {
          used.add(pointId);
        }
      }
      for (const pointId of ref.includePointIds ?? []) {
        if (resume.local.points[pointId]) {
          used.add(pointId);
        }
      }
    }
  }

  return used;
}

function relinkLocalPointsToGlobalByText(
  resume: ResumeDocument,
  relinkTextIndex: Map<string, string>,
): { resume: ResumeDocument; changed: boolean } {
  if (relinkTextIndex.size === 0) {
    return { resume, changed: false };
  }

  const next = JSON.parse(JSON.stringify(resume)) as ResumeDocument;
  let changed = false;

  const replacePointIds = (pointIds: string[]): string[] => {
    const nextPointIds: string[] = [];
    const seen = new Set<string>();

    for (const pointId of pointIds) {
      let mappedPointId = pointId;
      const localPoint = next.local.points[pointId];
      if (localPoint) {
        const targetGlobalPointId = relinkTextIndex.get(normalizePointText(localPoint.text));
        if (targetGlobalPointId && targetGlobalPointId !== pointId) {
          mappedPointId = targetGlobalPointId;
          changed = true;
        }
      }

      if (!seen.has(mappedPointId)) {
        nextPointIds.push(mappedPointId);
        seen.add(mappedPointId);
      } else {
        changed = true;
      }
    }

    return nextPointIds;
  };

  for (const section of pointBearingSections) {
    const localEntryById = new Map(
      next.local[section].map((entry) => [entry.id, entry] as const),
    );

    for (const ref of next.sections[section]) {
      if (!ref.localId) {
        continue;
      }
      const localEntry = localEntryById.get(ref.localId);
      if (!localEntry) {
        continue;
      }

      const nextPointIds = replacePointIds(localEntry.pointIds);
      if (JSON.stringify(nextPointIds) !== JSON.stringify(localEntry.pointIds)) {
        localEntry.pointIds = nextPointIds;
        changed = true;
      }

      if (ref.includePointIds) {
        const nextIncludePointIds = replacePointIds(ref.includePointIds);
        if (JSON.stringify(nextIncludePointIds) !== JSON.stringify(ref.includePointIds)) {
          ref.includePointIds = nextIncludePointIds;
          changed = true;
        }
      }
    }
  }

  const usedLocalPointIds = collectUsedLocalPointIds(next);
  for (const pointId of Object.keys(next.local.points)) {
    if (!usedLocalPointIds.has(pointId)) {
      delete next.local.points[pointId];
      changed = true;
    }
  }

  return { resume: next, changed };
}

async function compileAndUpdateResumes(
  global: GlobalCatalog,
  resumes: ResumeDocument[],
): Promise<ResumeDocument[]> {
  const now = nowIso();
  const settings = await loadSettings();
  const updated: ResumeDocument[] = [];

  for (const resume of resumes) {
    const result = await compileResume(global, resume);
    let compileMessage = result.message;

    if (result.ok && result.pdfPath) {
      const exported = await syncPdfToExportDirectory(settings, resume, result.pdfPath);
      if (exported.exportedPath) {
        compileMessage = `${compileMessage} Exported PDF to ${exported.exportedPath}.`;
      }
      if (exported.warning) {
        compileMessage = `${compileMessage} ${exported.warning}`;
      }
    }

    updated.push({
      ...resume,
      lastCompiledAt: now,
      lastCompileStatus: result.ok ? 'success' : 'failed',
      lastCompileMessage: compileMessage,
      updatedAt: now,
    });
  }

  await saveResumes(updated);
  return updated;
}

async function syncCurrentCompiledPdfsToExport(
  settings: AppSettings,
  resumes: ResumeDocument[],
): Promise<void> {
  if (!settings.exportPdfDir?.trim()) {
    return;
  }

  for (const resume of resumes) {
    const current = currentArtifactPaths(resume.id);
    if (!fs.existsSync(current.pdfPath)) {
      continue;
    }
    await syncPdfToExportDirectory(settings, resume, current.pdfPath);
  }
}

async function recordCommitEvent(
  message: string,
  affectedResumes: string[],
): Promise<CommitEvent> {
  const commitHash = await commitAll(message);
  const event: CommitEvent = {
    id: `${Date.now()}_${shortId()}`,
    createdAt: nowIso(),
    message,
    commitHash,
    affectedResumes,
  };
  await saveCommitEvent(event);
  return event;
}

function ensureSectionKey(section: string): SectionKey {
  const keys = allSectionKeys();
  if (!keys.includes(section as SectionKey)) {
    throw new Error(`Unknown section: ${section}`);
  }
  return section as SectionKey;
}

function cloneResume(resume: ResumeDocument, newId: string, name: string): ResumeDocument {
  const now = nowIso();
  return {
    ...JSON.parse(JSON.stringify(resume)),
    id: newId,
    name,
    createdAt: now,
    updatedAt: now,
    lastCompiledAt: undefined,
    lastCompileStatus: undefined,
    lastCompileMessage: undefined,
  } as ResumeDocument;
}

export interface AppStateResponse {
  global: GlobalCatalog;
  resumes: ResumeSummary[];
  settings: AppSettings;
}

export interface ResumeDetailResponse {
  resume: ResumeDocument;
  rendered: RenderedResumeData;
  latex: string;
  pdfUrl?: string;
  texUrl?: string;
  logUrl?: string;
}

export async function bootstrap(): Promise<void> {
  await initializeStorage();
  ensureDir(path.join(BUILDS_DIR));
  ensureDir(path.join(HISTORY_CACHE_DIR));
}

export async function getAppState(): Promise<AppStateResponse> {
  const [global, resumes, settings] = await Promise.all([
    loadGlobal(),
    loadAllResumes(),
    loadSettings(),
  ]);
  return {
    global,
    resumes: summarize(resumes),
    settings,
  };
}

export async function getAppSettings(): Promise<AppSettings> {
  return loadSettings();
}

export async function updateAppSettings(
  nextSettings: Partial<AppSettings>,
): Promise<AppSettings> {
  const current = await loadSettings();
  const merged: AppSettings = {
    ...current,
    ...nextSettings,
    exportPdfDir: nextSettings.exportPdfDir?.trim()
      ? nextSettings.exportPdfDir.trim()
      : undefined,
    updatedAt: nowIso(),
  };

  await saveSettings(merged);
  const resumes = await loadAllResumes();
  await syncCurrentCompiledPdfsToExport(merged, resumes);
  return merged;
}

export async function getResumeDetail(id: string): Promise<ResumeDetailResponse | null> {
  const [global, resume] = await Promise.all([loadGlobal(), loadResume(id)]);
  if (!resume) {
    return null;
  }

  const rendered = buildRenderedResumeData(global, resume);
  const latex = resume.customLatex ?? renderLatex(rendered);
  const current = currentArtifactPaths(resume.id);

  return {
    resume,
    rendered,
    latex,
    pdfUrl: fs.existsSync(current.pdfPath) ? `${toArtifactUrl(current.pdfPath)}?t=${Date.now()}` : undefined,
    texUrl: fs.existsSync(current.texPath) ? `${toArtifactUrl(current.texPath)}?t=${Date.now()}` : undefined,
    logUrl: fs.existsSync(current.logPath) ? `${toArtifactUrl(current.logPath)}?t=${Date.now()}` : undefined,
  };
}

export async function compileResumeById(
  resumeId: string,
  message = `Compile resume ${resumeId}`,
): Promise<ResumeDetailResponse | null> {
  const [global, resume] = await Promise.all([loadGlobal(), loadResume(resumeId)]);
  if (!resume) {
    return null;
  }

  const [updated] = await compileAndUpdateResumes(global, [resume]);
  await recordCommitEvent(message, [resumeId]);
  return getResumeDetail(updated.id);
}

export async function compileAllResumes(
  message = 'Compile all resumes',
): Promise<AppStateResponse> {
  const [global, resumes] = await Promise.all([loadGlobal(), loadAllResumes()]);
  if (resumes.length > 0) {
    await compileAndUpdateResumes(global, resumes);
  }
  await recordCommitEvent(message, resumes.map((resume) => resume.id));
  const latest = await loadAllResumes();
  const settings = await loadSettings();
  return {
    global,
    resumes: summarize(latest),
    settings,
  };
}

export async function updateGlobalCatalog(
  nextGlobal: GlobalCatalog,
  message = 'Update global resume sections',
): Promise<AppStateResponse> {
  const [oldGlobal, resumes] = await Promise.all([loadGlobal(), loadAllResumes()]);

  const changedPointIds = diffGlobalPoints(oldGlobal, nextGlobal);
  const structuralChange = hasGlobalStructuralChange(oldGlobal, nextGlobal);

  const now = nowIso();
  const normalizedGlobal: GlobalCatalog = {
    ...nextGlobal,
    updatedAt: now,
  };

  await saveGlobal(normalizedGlobal);

  const relinkTextIndex = buildRelinkTextIndex(
    oldGlobal,
    normalizedGlobal,
    changedPointIds,
  );
  const relinkedResumeById = new Map<string, ResumeDocument>();
  for (const resume of resumes) {
    const relinked = relinkLocalPointsToGlobalByText(resume, relinkTextIndex);
    if (relinked.changed) {
      relinkedResumeById.set(resume.id, {
        ...relinked.resume,
        updatedAt: now,
      });
    }
  }

  let affected: ResumeDocument[];
  if (structuralChange || changedPointIds.length === 0) {
    affected = resumes.map((resume) => relinkedResumeById.get(resume.id) ?? resume);
  } else {
    const affectedIds = new Set<string>(relinkedResumeById.keys());
    for (const pointId of changedPointIds) {
      for (const resume of resumesReferencingGlobalPoint(resumes, oldGlobal, pointId)) {
        affectedIds.add(resume.id);
      }
    }
    affected = resumes
      .filter((resume) => affectedIds.has(resume.id))
      .map((resume) => relinkedResumeById.get(resume.id) ?? resume);
  }

  if (affected.length > 0) {
    await compileAndUpdateResumes(normalizedGlobal, affected);
  }

  await recordCommitEvent(message, affected.map((resume) => resume.id));

  const latestResumes = await loadAllResumes();
  const settings = await loadSettings();
  return {
    global: normalizedGlobal,
    resumes: summarize(latestResumes),
    settings,
  };
}

export async function updateResumeDocument(
  resumeId: string,
  nextResume: ResumeDocument,
  message = `Update resume ${resumeId}`,
): Promise<ResumeDetailResponse | null> {
  const [global, existing] = await Promise.all([loadGlobal(), loadResume(resumeId)]);
  if (!existing) {
    return null;
  }

  const now = nowIso();
  const updatedResume: ResumeDocument = {
    ...nextResume,
    id: resumeId,
    createdAt: existing.createdAt,
    updatedAt: now,
  };

  await saveResume(updatedResume);
  await compileAndUpdateResumes(global, [updatedResume]);
  await recordCommitEvent(message, [resumeId]);
  return getResumeDetail(resumeId);
}

export async function setResumeCustomLatex(
  resumeId: string,
  latex: string,
  message = `Update custom LaTeX for ${resumeId}`,
): Promise<ResumeDetailResponse | null> {
  const resume = await loadResume(resumeId);
  if (!resume) {
    return null;
  }

  const updated: ResumeDocument = {
    ...resume,
    customLatex: latex,
    updatedAt: nowIso(),
  };

  return updateResumeDocument(resumeId, updated, message);
}

export async function clearResumeCustomLatex(
  resumeId: string,
  message = `Clear custom LaTeX for ${resumeId}`,
): Promise<ResumeDetailResponse | null> {
  const resume = await loadResume(resumeId);
  if (!resume) {
    return null;
  }

  const updated: ResumeDocument = {
    ...resume,
    customLatex: undefined,
    updatedAt: nowIso(),
  };

  return updateResumeDocument(resumeId, updated, message);
}

export async function createResume(
  name: string,
  sourceResumeId?: string,
): Promise<ResumeDetailResponse> {
  const resumes = await loadAllResumes();
  let base = resumes[0];

  if (sourceResumeId) {
    const found = resumes.find((resume) => resume.id === sourceResumeId);
    if (found) {
      base = found;
    }
  }

  if (!base) {
    throw new Error('No source resume available to clone.');
  }

  const newId = `resume_${shortId()}`;
  const newResume = cloneResume(base, newId, name);
  await saveResume(newResume);

  const global = await loadGlobal();
  await compileAndUpdateResumes(global, [newResume]);
  await recordCommitEvent(`Create resume ${name}`, [newId]);

  const detail = await getResumeDetail(newId);
  if (!detail) {
    throw new Error('Created resume but failed to load details.');
  }
  return detail;
}

export interface OverridePointInput {
  resumeId: string;
  section: string;
  refId: string;
  pointId: string;
  text: string;
}

export async function overridePointForResume(
  input: OverridePointInput,
): Promise<ResumeDetailResponse | null> {
  const section = ensureSectionKey(input.section);
  if (!['experience', 'projects', 'openSource'].includes(section)) {
    throw new Error('Point overrides are only supported for experience/projects/openSource.');
  }

  const resume = await loadResume(input.resumeId);
  if (!resume) {
    return null;
  }

  const localPointId = `lp_${shortId()}`;
  const refs = resume.sections[section];
  const ref = refs.find((item) => item.globalId === input.refId || item.localId === input.refId);

  if (!ref) {
    throw new Error(`Could not find section ref ${input.refId}.`);
  }

  ref.pointOverrides = {
    ...(ref.pointOverrides ?? {}),
    [input.pointId]: localPointId,
  };

  resume.local.points[localPointId] = {
    id: localPointId,
    text: input.text,
  };

  return updateResumeDocument(
    input.resumeId,
    resume,
    `Override point ${input.pointId} in ${input.resumeId}`,
  );
}

export async function listResumeHistory(resumeId: string): Promise<CommitEvent[]> {
  const events = await loadAllCommitEvents();
  return events.filter((event) => event.affectedResumes.includes(resumeId));
}

async function getHistoricalLatex(
  resumeId: string,
  commitHash: string,
): Promise<string> {
  const [globalRaw, resumeRaw] = await Promise.all([
    readFileAtCommit(commitHash, 'global.json'),
    readFileAtCommit(commitHash, getResumeFileRelativePath(resumeId)),
  ]);

  const global = JSON.parse(globalRaw) as GlobalCatalog;
  const resume = JSON.parse(resumeRaw) as ResumeDocument;
  const rendered = buildRenderedResumeData(global, resume);
  return resume.customLatex ?? renderLatex(rendered);
}

export async function getHistoricalSnapshot(
  resumeId: string,
  commitHash: string,
): Promise<{
  latex: string;
  pdfUrl?: string;
  texUrl?: string;
  logUrl?: string;
}> {
  const latex = await getHistoricalLatex(resumeId, commitHash);
  const result = await compileHistoricalResume(resumeId, commitHash, latex);

  return {
    latex,
    pdfUrl: result.pdfPath ? `${toArtifactUrl(result.pdfPath)}?t=${Date.now()}` : undefined,
    texUrl: `${toArtifactUrl(result.texPath)}?t=${Date.now()}`,
    logUrl: `${toArtifactUrl(result.logPath)}?t=${Date.now()}`,
  };
}

export async function getBuildFilesContent(resumeId: string): Promise<{
  tex?: string;
  log?: string;
}> {
  const current = currentArtifactPaths(resumeId);

  const [tex, log] = await Promise.all([
    fs.existsSync(current.texPath) ? fsp.readFile(current.texPath, 'utf8') : Promise.resolve(undefined),
    fs.existsSync(current.logPath) ? fsp.readFile(current.logPath, 'utf8') : Promise.resolve(undefined),
  ]);

  return { tex, log };
}
