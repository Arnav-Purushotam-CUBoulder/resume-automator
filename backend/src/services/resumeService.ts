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
  deleteResume,
  getResumeFileRelativePath,
  initializeStorage,
  loadAllCommitEvents,
  loadAllResumes,
  loadExportManifest,
  loadSettings,
  loadGlobal,
  loadResume,
  saveExportManifest,
  saveSettings,
  saveCommitEvent,
  saveGlobal,
  saveResumes,
} from '../storage/dataStore.js';
import { nowIso } from '../utils/time.js';
import { commitAll, listFileCommitHashes, readFileAtCommit } from './gitService.js';
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
import { BUILDS_DIR, HISTORY_CACHE_DIR, RESUMES_DIR, ensureDir } from '../utils/paths.js';

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
    contactVariants: oldGlobal.contactVariants,
    sections: oldGlobal.sections,
  };
  const nextShape = {
    header: nextGlobal.header,
    contactVariants: nextGlobal.contactVariants,
    sections: nextGlobal.sections,
  };
  return JSON.stringify(oldShape) !== JSON.stringify(nextShape);
}

const pointBearingSections = ['experience', 'projects', 'openSource'] as const;

function uniqueNonEmpty(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

function normalizeGlobalCatalog(global: GlobalCatalog): GlobalCatalog {
  const fallbackEmail = global.header.email?.trim() || 'user@example.com';
  const fallbackLocation = global.header.location?.trim() || 'Unknown, USA';

  const emails = uniqueNonEmpty([
    ...(global.contactVariants?.emails ?? []),
    fallbackEmail,
  ]);
  const locations = uniqueNonEmpty([
    ...(global.contactVariants?.locations ?? []),
    fallbackLocation,
  ]);

  return {
    ...global,
    header: {
      ...global.header,
      email: fallbackEmail,
      location: fallbackLocation,
    },
    contactVariants: {
      emails: emails.length ? emails : [fallbackEmail],
      locations: locations.length ? locations : [fallbackLocation],
    },
  };
}

function defaultEmail(global: GlobalCatalog): string {
  return global.contactVariants.emails[0] ?? global.header.email;
}

function defaultLocation(global: GlobalCatalog): string {
  return global.contactVariants.locations[0] ?? global.header.location;
}

function normalizeResumeVariantMetadata(
  resume: ResumeDocument,
  global: GlobalCatalog,
): ResumeDocument {
  return {
    ...resume,
    templateId: resume.templateId || resume.id,
    variantEmail: (resume.variantEmail || '').trim() || defaultEmail(global),
    variantLocation: (resume.variantLocation || '').trim() || defaultLocation(global),
  };
}

function variantKey(templateId: string, email: string, location: string): string {
  return `${templateId}::${email}::${location}`;
}

function sanitizeFileName(input: string): string {
  const cleaned = input
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned) {
    return 'resume';
  }
  if (cleaned.length <= 140) {
    return cleaned;
  }
  return cleaned.slice(0, 140).trim();
}

function toPosixRelativePath(input: string): string {
  return input.replace(/\\/g, '/');
}

function getExportPathCandidatesForResume(resume: ResumeDocument): string[] {
  const sanitizedName = sanitizeFileName(resume.name);
  const nested = toPosixRelativePath(path.join(
    sanitizeFileName(resume.variantEmail || 'default-email'),
    sanitizeFileName(resume.variantLocation || 'default-location'),
    `${sanitizedName}__${resume.id}.pdf`,
  ));
  const flatWithId = `${sanitizedName}__${resume.id}.pdf`;
  const legacySanitizedFlat = `${sanitizedName}.pdf`;
  const legacyRawFlat = `${resume.name.trim()}.pdf`;

  const seen = new Set<string>();
  const out: string[] = [];
  for (const candidate of [nested, flatWithId, legacySanitizedFlat, legacyRawFlat]) {
    if (!candidate || seen.has(candidate)) {
      continue;
    }
    seen.add(candidate);
    out.push(candidate);
  }
  return out;
}

function normalizePointText(text?: string): string {
  return (text ?? '').replace(/\s+/g, ' ').trim();
}

function stripLatexForMatching(text: string): string {
  return text
    .replace(/\\href\{([^}]*)\}\{([^}]*)\}/g, '$2')
    .replace(/\\textbf\{([^}]*)\}/g, '$1')
    .replace(/\\textit\{([^}]*)\}/g, '$1')
    .replace(/\\texttt\{([^}]*)\}/g, '$1')
    .replace(/\\emph\{([^}]*)\}/g, '$1')
    .replace(/\\textbar\\\s*/g, '| ')
    .replace(/\\textasciitilde\{\}/g, '~')
    .replace(/\\textasciicircum\{\}/g, '^')
    .replace(/\\#/g, '#')
    .replace(/\\%/g, '%')
    .replace(/\\&/g, '&')
    .replace(/\\_/g, '_')
    .replace(/\\\{/g, '{')
    .replace(/\\\}/g, '}')
    .replace(/\$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildPointMatchKey(text?: string): string {
  const normalized = stripLatexForMatching(normalizePointText(text));
  if (!normalized) {
    return '';
  }
  return normalized
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function pointTextTokens(text?: string): Set<string> {
  const key = buildPointMatchKey(text);
  if (!key) {
    return new Set<string>();
  }
  return new Set<string>(key.split(' ').filter(Boolean));
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) {
    return 0;
  }
  let intersection = 0;
  for (const token of a) {
    if (b.has(token)) {
      intersection += 1;
    }
  }
  const union = new Set<string>([...a, ...b]).size;
  return union ? intersection / union : 0;
}

function buildAutoPointAliasMap(global: GlobalCatalog): Map<string, string> {
  const aliasMap = new Map<string, string>();
  const pointIds = Object.keys(global.points);
  const nonAutoIds = pointIds.filter((id) => !id.startsWith('pt_auto_'));
  const nonAutoTokens = new Map<string, Set<string>>();

  for (const id of nonAutoIds) {
    nonAutoTokens.set(id, pointTextTokens(global.points[id]?.text));
  }

  for (const id of pointIds) {
    if (!id.startsWith('pt_auto_')) {
      continue;
    }
    const autoTokens = pointTextTokens(global.points[id]?.text);
    if (!autoTokens.size) {
      continue;
    }

    let bestId: string | undefined;
    let bestScore = 0;
    for (const candidateId of nonAutoIds) {
      const score = jaccardSimilarity(autoTokens, nonAutoTokens.get(candidateId) ?? new Set<string>());
      if (score > bestScore) {
        bestScore = score;
        bestId = candidateId;
      }
    }

    if (bestId && bestScore >= 0.9) {
      aliasMap.set(id, bestId);
    }
  }

  return aliasMap;
}

function normalizeComparable(input?: string): string {
  return (input ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

function remapPointIds(pointIds: string[] | undefined, aliasMap: Map<string, string>): string[] {
  if (!pointIds || !pointIds.length) {
    return [];
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of pointIds) {
    const mapped = aliasMap.get(id) ?? id;
    if (seen.has(mapped)) {
      continue;
    }
    seen.add(mapped);
    out.push(mapped);
  }
  return out;
}

function applyPointAliasMapToGlobalAndResumes(
  global: GlobalCatalog,
  resumes: ResumeDocument[],
  aliasMap: Map<string, string>,
): { global: GlobalCatalog; resumes: ResumeDocument[]; changed: boolean } {
  if (!aliasMap.size) {
    return { global, resumes, changed: false };
  }

  let changed = false;
  const nextGlobal = JSON.parse(JSON.stringify(global)) as GlobalCatalog;
  const nextResumes = JSON.parse(JSON.stringify(resumes)) as ResumeDocument[];

  for (const section of pointBearingSections) {
    for (const entry of nextGlobal.sections[section]) {
      const nextPointIds = remapPointIds(entry.pointIds, aliasMap);
      if (JSON.stringify(nextPointIds) !== JSON.stringify(entry.pointIds)) {
        entry.pointIds = nextPointIds;
        changed = true;
      }
    }
  }

  for (const [from] of aliasMap) {
    if (nextGlobal.points[from]) {
      delete nextGlobal.points[from];
      changed = true;
    }
  }

  for (const resume of nextResumes) {
    for (const section of pointBearingSections) {
      for (const entry of resume.local[section]) {
        const nextPointIds = remapPointIds(entry.pointIds, aliasMap);
        if (JSON.stringify(nextPointIds) !== JSON.stringify(entry.pointIds)) {
          entry.pointIds = nextPointIds;
          changed = true;
        }
      }
      for (const ref of resume.sections[section]) {
        if (ref.includePointIds) {
          const nextInclude = remapPointIds(ref.includePointIds, aliasMap);
          if (JSON.stringify(nextInclude) !== JSON.stringify(ref.includePointIds)) {
            ref.includePointIds = nextInclude;
            changed = true;
          }
        }
        if (ref.pointOverrides) {
          const remapped: Record<string, string> = {};
          let overridesChanged = false;
          for (const [pointId, overrideId] of Object.entries(ref.pointOverrides)) {
            const mappedPointId = aliasMap.get(pointId) ?? pointId;
            if (mappedPointId !== pointId) {
              overridesChanged = true;
            }
            if (!(mappedPointId in remapped)) {
              remapped[mappedPointId] = overrideId;
            }
          }
          if (overridesChanged) {
            ref.pointOverrides = remapped;
            changed = true;
          }
        }
      }
    }
  }

  return {
    global: nextGlobal,
    resumes: nextResumes,
    changed,
  };
}

function buildGlobalPointMatchIndex(global: GlobalCatalog): Map<string, string> {
  const index = new Map<string, string>();
  const pointIds = Object.keys(global.points).sort();

  for (const pointId of pointIds) {
    const key = buildPointMatchKey(global.points[pointId]?.text);
    if (!key || index.has(key)) {
      continue;
    }
    index.set(key, pointId);
  }

  return index;
}

function createGlobalPointId(global: GlobalCatalog): string {
  let pointId = `pt_auto_${shortId()}`;
  while (global.points[pointId]) {
    pointId = `pt_auto_${shortId()}`;
  }
  return pointId;
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
      for (const localPointId of Object.values(ref.pointOverrides ?? {})) {
        if (resume.local.points[localPointId]) {
          used.add(localPointId);
        }
      }
    }
  }

  return used;
}

function relinkResumeLocalPointsToGlobal(
  global: GlobalCatalog,
  pointMatchIndex: Map<string, string>,
  resume: ResumeDocument,
): { resume: ResumeDocument; changed: boolean } {
  const next = JSON.parse(JSON.stringify(resume)) as ResumeDocument;
  let changed = false;

  const replacePointIds = (pointIds: string[]): string[] => {
    const nextPointIds: string[] = [];
    const seen = new Set<string>();

    for (const pointId of pointIds) {
      let mappedPointId = pointId;
      const localPoint = next.local.points[pointId];
      if (localPoint) {
        const pointKey = buildPointMatchKey(localPoint.text);
        if (pointKey) {
          let targetGlobalPointId = pointMatchIndex.get(pointKey);
          if (!targetGlobalPointId) {
            targetGlobalPointId = createGlobalPointId(global);
            global.points[targetGlobalPointId] = {
              id: targetGlobalPointId,
              text: localPoint.text,
            };
            pointMatchIndex.set(pointKey, targetGlobalPointId);
          }

          if (targetGlobalPointId !== pointId) {
            mappedPointId = targetGlobalPointId;
            changed = true;
          }
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

function relinkAllResumesToGlobalPoints(
  globalInput: GlobalCatalog,
  resumesInput: ResumeDocument[],
  now: string,
): {
  global: GlobalCatalog;
  resumes: ResumeDocument[];
  changedResumeIds: Set<string>;
} {
  const global = JSON.parse(JSON.stringify(globalInput)) as GlobalCatalog;
  const pointMatchIndex = buildGlobalPointMatchIndex(global);
  const changedResumeIds = new Set<string>();

  const resumes = resumesInput.map((resume) => {
    const relinked = relinkResumeLocalPointsToGlobal(
      global,
      pointMatchIndex,
      resume,
    );
    if (!relinked.changed) {
      return resume;
    }
    changedResumeIds.add(relinked.resume.id);
    return {
      ...relinked.resume,
      updatedAt: now,
    };
  });

  return { global, resumes, changedResumeIds };
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

function ensureVariantResumeMatrix(
  global: GlobalCatalog,
  resumesInput: ResumeDocument[],
  templateIds?: Set<string>,
): { resumes: ResumeDocument[]; createdResumeIds: Set<string> } {
  const resumes = [...resumesInput];
  const createdResumeIds = new Set<string>();
  const byVariant = new Map<string, ResumeDocument>();

  for (const resume of resumes) {
    byVariant.set(
      variantKey(resume.templateId, resume.variantEmail, resume.variantLocation),
      resume,
    );
  }

  const templates = resumes.filter((resume) =>
    resume.templateId === resume.id
    && (!templateIds || templateIds.has(resume.templateId)),
  );

  for (const template of templates) {
    for (const email of global.contactVariants.emails) {
      for (const location of global.contactVariants.locations) {
        const key = variantKey(template.id, email, location);
        if (byVariant.has(key)) {
          continue;
        }
        const cloneId = `resume_${shortId()}`;
        const clone = cloneResume(template, cloneId, template.name);
        clone.templateId = template.id;
        clone.variantEmail = email;
        clone.variantLocation = location;
        resumes.push(clone);
        byVariant.set(key, clone);
        createdResumeIds.add(clone.id);
      }
    }
  }

  return { resumes, createdResumeIds };
}

async function removeResumesAndArtifacts(
  resumes: ResumeDocument[],
  settings: AppSettings,
  manifest: Record<string, string>,
): Promise<Set<string>> {
  const deletedIds = new Set<string>();
  const exportRoot = settings.exportPdfDir?.trim();

  for (const resume of resumes) {
    await deleteResume(resume.id);
    await fsp.rm(path.join(BUILDS_DIR, resume.id), { recursive: true, force: true });
    await fsp.rm(path.join(HISTORY_CACHE_DIR, resume.id), { recursive: true, force: true });

    const relativeExportPath = manifest[resume.id];
    if (relativeExportPath && exportRoot) {
      const absoluteExportPath = path.join(exportRoot, relativeExportPath);
      if (fs.existsSync(absoluteExportPath)) {
        await fsp.unlink(absoluteExportPath);
      }
    }
    delete manifest[resume.id];
    deletedIds.add(resume.id);
  }

  return deletedIds;
}

async function reconcileDeletedResumesFromExportFolder(
  resumesInput: ResumeDocument[],
): Promise<{ resumes: ResumeDocument[] }> {
  const settings = await loadSettings();
  const exportRoot = settings.exportPdfDir?.trim();
  if (!exportRoot || !fs.existsSync(exportRoot)) {
    return { resumes: resumesInput };
  }

  const manifest = await loadExportManifest();
  const byId = new Map(resumesInput.map((resume) => [resume.id, resume] as const));
  const missingExportIds: string[] = [];
  const claimedPaths = new Set<string>();
  let manifestChanged = false;

  for (const resume of resumesInput) {
    const candidates = [
      ...(manifest[resume.id] ? [manifest[resume.id]] : []),
      ...getExportPathCandidatesForResume(resume),
    ];

    let matchedPath: string | undefined;
    for (const relativePath of candidates) {
      if (claimedPaths.has(relativePath)) {
        continue;
      }
      const absolutePath = path.join(exportRoot, relativePath);
      if (!fs.existsSync(absolutePath)) {
        continue;
      }
      matchedPath = relativePath;
      break;
    }

    if (!matchedPath) {
      missingExportIds.push(resume.id);
      continue;
    }

    claimedPaths.add(matchedPath);
    if (manifest[resume.id] !== matchedPath) {
      manifest[resume.id] = matchedPath;
      manifestChanged = true;
    }
  }

  for (const resumeId of Object.keys(manifest)) {
    if (byId.has(resumeId)) {
      continue;
    }
    delete manifest[resumeId];
    manifestChanged = true;
  }

  if (!missingExportIds.length) {
    if (manifestChanged) {
      await saveExportManifest(manifest);
    }
    return { resumes: resumesInput };
  }

  const templateIdsToDelete = new Set<string>();
  for (const resumeId of missingExportIds) {
    const resume = byId.get(resumeId);
    if (resume) {
      templateIdsToDelete.add(resume.templateId || resume.id);
    }
  }

  const familyResumes = resumesInput.filter((resume) =>
    templateIdsToDelete.has(resume.templateId || resume.id),
  );
  const deletedIds = await removeResumesAndArtifacts(familyResumes, settings, manifest);
  if (deletedIds.size > 0 || manifestChanged) {
    await saveExportManifest(manifest);
  }

  if (deletedIds.size > 0) {
    await recordCommitEvent(
      `Sync deleted exported resume PDFs (${deletedIds.size})`,
      [...deletedIds],
    );
  }

  if (!deletedIds.size) {
    return { resumes: resumesInput };
  }
  return {
    resumes: resumesInput.filter((resume) => !deletedIds.has(resume.id)),
  };
}

async function normalizeStoredState(): Promise<{
  global: GlobalCatalog;
  resumes: ResumeDocument[];
}> {
  const [globalRaw, resumesRaw] = await Promise.all([loadGlobal(), loadAllResumes()]);
  const normalizedGlobal = normalizeGlobalCatalog(globalRaw);

  const normalizedResumes = resumesRaw.map((resume) => {
    const base = normalizeResumeVariantMetadata(resume, normalizedGlobal);
    if (
      base.headerMode === 'local'
      && base.localHeader
      && normalizeComparable(base.localHeader.name) === normalizeComparable(normalizedGlobal.header.name)
      && base.localHeader.name !== normalizedGlobal.header.name
    ) {
      return {
        ...base,
        localHeader: {
          ...base.localHeader,
          name: normalizedGlobal.header.name,
        },
      };
    }
    return base;
  });

  const autoAliasMap = buildAutoPointAliasMap(normalizedGlobal);
  const aliased = applyPointAliasMapToGlobalAndResumes(
    normalizedGlobal,
    normalizedResumes,
    autoAliasMap,
  );
  const finalGlobal = aliased.global;
  const finalResumes = aliased.resumes;

  const globalChanged = JSON.stringify(globalRaw) !== JSON.stringify(finalGlobal);
  const resumesChanged = JSON.stringify(resumesRaw) !== JSON.stringify(finalResumes);

  if (globalChanged) {
    await saveGlobal(finalGlobal);
  }
  if (resumesChanged) {
    await saveResumes(finalResumes);
  }

  return {
    global: finalGlobal,
    resumes: finalResumes,
  };
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
  await normalizeStoredState();
}

export async function getAppState(): Promise<AppStateResponse> {
  const [normalized, settings] = await Promise.all([
    normalizeStoredState(),
    loadSettings(),
  ]);
  const reconciled = await reconcileDeletedResumesFromExportFolder(normalized.resumes);
  return {
    global: normalized.global,
    resumes: summarize(reconciled.resumes),
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
  const normalized = await normalizeStoredState();
  const resume = normalized.resumes.find((item) => item.id === id);
  if (!resume) {
    return null;
  }

  const rendered = buildRenderedResumeData(normalized.global, resume);
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
  const normalized = await normalizeStoredState();
  const resume = normalized.resumes.find((item) => item.id === resumeId);
  if (!resume) {
    return null;
  }

  const [updated] = await compileAndUpdateResumes(normalized.global, [resume]);
  await recordCommitEvent(message, [resumeId]);
  return getResumeDetail(updated.id);
}

export async function compileAllResumes(
  message = 'Compile all resumes',
): Promise<AppStateResponse> {
  const normalized = await normalizeStoredState();
  const { global, resumes } = normalized;
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
  const normalizedState = await normalizeStoredState();
  const oldGlobal = normalizedState.global;
  const resumes = normalizedState.resumes;

  const now = nowIso();
  const normalizedNextGlobal = normalizeGlobalCatalog(nextGlobal);
  const changedPointIds = diffGlobalPoints(oldGlobal, normalizedNextGlobal);
  const structuralChange = hasGlobalStructuralChange(oldGlobal, normalizedNextGlobal);

  const baseGlobal: GlobalCatalog = {
    ...normalizedNextGlobal,
    updatedAt: now,
  };

  const relinked = relinkAllResumesToGlobalPoints(baseGlobal, resumes, now);
  const matrix = ensureVariantResumeMatrix(relinked.global, relinked.resumes);
  const normalizedGlobal = relinked.global;
  const resumesAfterRelink = matrix.resumes;

  const affectedIds = new Set<string>(relinked.changedResumeIds);
  for (const createdId of matrix.createdResumeIds) {
    affectedIds.add(createdId);
  }
  if (structuralChange || changedPointIds.length === 0) {
    for (const resume of resumesAfterRelink) {
      affectedIds.add(resume.id);
    }
  } else {
    for (const pointId of changedPointIds) {
      for (const resume of resumesReferencingGlobalPoint(
        resumesAfterRelink,
        normalizedGlobal,
        pointId,
      )) {
        affectedIds.add(resume.id);
      }
    }
  }

  const affected = resumesAfterRelink.filter((resume) => affectedIds.has(resume.id));

  await saveGlobal(normalizedGlobal);
  if (affected.length > 0) {
    await compileAndUpdateResumes(normalizedGlobal, affected);
  }

  const commitResumes = [...affectedIds];
  await recordCommitEvent(message, commitResumes);

  const latestResumes = await loadAllResumes();
  const settings = await loadSettings();
  return {
    global: normalizedGlobal,
    resumes: summarize(latestResumes),
    settings,
  };
}

export async function rollbackLastGlobalCatalogChange(
  message = 'Rollback last global change',
): Promise<AppStateResponse | null> {
  const commitHashes = await listFileCommitHashes('global.json', 100);
  if (commitHashes.length < 2) {
    return null;
  }

  const targetCommit = commitHashes[1];
  const snapshotRaw = await readFileAtCommit(targetCommit, 'global.json');
  const snapshotGlobal = JSON.parse(snapshotRaw) as GlobalCatalog;
  return updateGlobalCatalog(
    snapshotGlobal,
    `${message} (restore ${targetCommit.slice(0, 10)})`,
  );
}

export async function updateResumeDocument(
  resumeId: string,
  nextResume: ResumeDocument,
  message = `Update resume ${resumeId}`,
): Promise<ResumeDetailResponse | null> {
  const normalized = await normalizeStoredState();
  const global = normalized.global;
  const existing = normalized.resumes.find((resume) => resume.id === resumeId);
  if (!existing) {
    return null;
  }

  const templateId = existing.templateId || existing.id;
  const family = normalized.resumes.filter((resume) =>
    (resume.templateId || resume.id) === templateId,
  );

  const now = nowIso();
  const updatedFamily: ResumeDocument[] = family.map((resume) => ({
    ...nextResume,
    id: resume.id,
    templateId: resume.templateId,
    variantEmail: resume.variantEmail,
    variantLocation: resume.variantLocation,
    createdAt: resume.createdAt,
    updatedAt: now,
  }));

  await saveResumes(updatedFamily);
  await compileAndUpdateResumes(global, updatedFamily);
  await recordCommitEvent(message, updatedFamily.map((resume) => resume.id));
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
  const normalized = await normalizeStoredState();
  const global = normalized.global;
  const resumes = normalized.resumes;
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

  const templateId = `resume_${shortId()}`;
  const templateResume = cloneResume(base, templateId, name);
  templateResume.templateId = templateId;
  templateResume.variantEmail = base.variantEmail || defaultEmail(global);
  templateResume.variantLocation = base.variantLocation || defaultLocation(global);

  const withTemplate = [...resumes, templateResume];
  const matrix = ensureVariantResumeMatrix(global, withTemplate, new Set([templateId]));
  const createdFamily = matrix.resumes.filter((resume) => resume.templateId === templateId);
  await saveResumes(createdFamily);
  await compileAndUpdateResumes(global, createdFamily);
  await recordCommitEvent(`Create resume ${name}`, createdFamily.map((resume) => resume.id));

  const preferredResume = createdFamily.find(
    (resume) =>
      resume.variantEmail === templateResume.variantEmail
      && resume.variantLocation === templateResume.variantLocation,
  ) ?? templateResume;

  const detail = await getResumeDetail(preferredResume.id);
  if (!detail) {
    throw new Error('Created resume but failed to load details.');
  }
  return detail;
}

export async function deleteResumeFamily(
  resumeId: string,
  message = `Delete resume family for ${resumeId}`,
): Promise<AppStateResponse | null> {
  const normalized = await normalizeStoredState();
  const target = normalized.resumes.find((resume) => resume.id === resumeId);
  if (!target) {
    return null;
  }

  const templateId = target.templateId || target.id;
  const family = normalized.resumes.filter((resume) => resume.templateId === templateId);
  if (!family.length) {
    return null;
  }

  const settings = await loadSettings();
  const manifest = await loadExportManifest();
  await removeResumesAndArtifacts(family, settings, manifest);
  await saveExportManifest(manifest);
  await recordCommitEvent(message, family.map((resume) => resume.id));

  const latestResumes = await loadAllResumes();
  return {
    global: normalized.global,
    resumes: summarize(latestResumes),
    settings,
  };
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

  const normalized = await normalizeStoredState();
  const resume = normalized.resumes.find((item) => item.id === input.resumeId);
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
