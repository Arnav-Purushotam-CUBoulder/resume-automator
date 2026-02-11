import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { AppSettings, ResumeDocument } from '../domain/types.js';
import { loadExportManifest, saveExportManifest } from '../storage/dataStore.js';

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

export async function syncPdfToExportDirectory(
  settings: AppSettings,
  resume: ResumeDocument,
  compiledPdfPath: string,
): Promise<{ exportedPath?: string; warning?: string }> {
  const targetDir = settings.exportPdfDir?.trim();
  if (!targetDir) {
    return {};
  }

  try {
    await fsp.mkdir(targetDir, { recursive: true });

    const manifest = await loadExportManifest();
    const nextFileName = `${sanitizeFileName(resume.name)}__${resume.id}.pdf`;
    const emailFolder = sanitizeFileName(resume.variantEmail || 'default-email');
    const locationFolder = sanitizeFileName(resume.variantLocation || 'default-location');
    const nextRelativePath = toPosixRelativePath(path.join(emailFolder, locationFolder, nextFileName));
    const previousRelativePath = manifest[resume.id];

    if (previousRelativePath && previousRelativePath !== nextRelativePath) {
      const previousPath = path.join(targetDir, previousRelativePath);
      if (fs.existsSync(previousPath)) {
        await fsp.unlink(previousPath);
      }
    }

    const targetPath = path.join(targetDir, nextRelativePath);
    await fsp.mkdir(path.dirname(targetPath), { recursive: true });
    if (fs.existsSync(targetPath)) {
      await fsp.unlink(targetPath);
    }

    await fsp.copyFile(compiledPdfPath, targetPath);

    manifest[resume.id] = nextRelativePath;
    await saveExportManifest(manifest);

    return { exportedPath: targetPath };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      warning: `Failed to export ${resume.name} PDF to ${targetDir}: ${message}`,
    };
  }
}
