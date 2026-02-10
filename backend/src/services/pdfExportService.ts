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
    const previousFileName = manifest[resume.id];

    if (previousFileName && previousFileName !== nextFileName) {
      const previousPath = path.join(targetDir, previousFileName);
      if (fs.existsSync(previousPath)) {
        await fsp.unlink(previousPath);
      }
    }

    const targetPath = path.join(targetDir, nextFileName);
    if (fs.existsSync(targetPath)) {
      await fsp.unlink(targetPath);
    }

    await fsp.copyFile(compiledPdfPath, targetPath);

    manifest[resume.id] = nextFileName;
    await saveExportManifest(manifest);

    return { exportedPath: targetPath };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      warning: `Failed to export ${resume.name} PDF to ${targetDir}: ${message}`,
    };
  }
}
