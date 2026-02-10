import { Router } from 'express';
import {
  clearResumeCustomLatex,
  compileAllResumes,
  compileResumeById,
  createResume,
  getAppSettings,
  getAppState,
  getBuildFilesContent,
  getHistoricalSnapshot,
  getResumeDetail,
  listResumeHistory,
  overridePointForResume,
  setResumeCustomLatex,
  updateAppSettings,
  updateGlobalCatalog,
  updateResumeDocument,
} from '../services/resumeService.js';
import { GlobalCatalog, ResumeDocument } from '../domain/types.js';

function parseMessage(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim().length > 0 ? value : fallback;
}

export function createApiRouter(): Router {
  const router = Router();

  router.get('/health', (_req, res) => {
    res.json({ ok: true });
  });

  router.get('/state', async (_req, res) => {
    const state = await getAppState();
    res.json(state);
  });

  router.get('/settings', async (_req, res) => {
    const settings = await getAppSettings();
    res.json({ settings });
  });

  router.put('/settings', async (req, res) => {
    const exportPdfDir =
      typeof req.body?.settings?.exportPdfDir === 'string'
        ? req.body.settings.exportPdfDir
        : undefined;
    const settings = await updateAppSettings({ exportPdfDir });
    res.json({ settings });
  });

  router.put('/global', async (req, res) => {
    const nextGlobal = req.body?.global as GlobalCatalog | undefined;
    if (!nextGlobal) {
      res.status(400).json({ error: 'Body must include global.' });
      return;
    }

    const message = parseMessage(req.body?.message, 'Update global resume sections');
    const state = await updateGlobalCatalog(nextGlobal, message);
    res.json(state);
  });

  router.get('/resumes/:id', async (req, res) => {
    const detail = await getResumeDetail(req.params.id);
    if (!detail) {
      res.status(404).json({ error: 'Resume not found.' });
      return;
    }
    res.json(detail);
  });

  router.post('/resumes', async (req, res) => {
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    const sourceResumeId =
      typeof req.body?.sourceResumeId === 'string'
        ? req.body.sourceResumeId.trim()
        : undefined;

    if (!name) {
      res.status(400).json({ error: 'name is required.' });
      return;
    }

    const detail = await createResume(name, sourceResumeId);
    res.status(201).json(detail);
  });

  router.put('/resumes/:id', async (req, res) => {
    const resume = req.body?.resume as ResumeDocument | undefined;
    if (!resume) {
      res.status(400).json({ error: 'Body must include resume.' });
      return;
    }

    const message = parseMessage(req.body?.message, `Update resume ${req.params.id}`);
    const detail = await updateResumeDocument(req.params.id, resume, message);
    if (!detail) {
      res.status(404).json({ error: 'Resume not found.' });
      return;
    }
    res.json(detail);
  });

  router.post('/resumes/:id/compile', async (req, res) => {
    const message = parseMessage(req.body?.message, `Compile resume ${req.params.id}`);
    const detail = await compileResumeById(req.params.id, message);
    if (!detail) {
      res.status(404).json({ error: 'Resume not found.' });
      return;
    }
    res.json(detail);
  });

  router.post('/resumes/compile-all', async (req, res) => {
    const message = parseMessage(req.body?.message, 'Compile all resumes');
    const state = await compileAllResumes(message);
    res.json(state);
  });

  router.put('/resumes/:id/custom-latex', async (req, res) => {
    const latex = typeof req.body?.latex === 'string' ? req.body.latex : '';
    if (!latex.trim()) {
      res.status(400).json({ error: 'latex is required.' });
      return;
    }

    const message = parseMessage(
      req.body?.message,
      `Update custom LaTeX for ${req.params.id}`,
    );
    const detail = await setResumeCustomLatex(req.params.id, latex, message);
    if (!detail) {
      res.status(404).json({ error: 'Resume not found.' });
      return;
    }
    res.json(detail);
  });

  router.delete('/resumes/:id/custom-latex', async (req, res) => {
    const message = parseMessage(
      req.body?.message,
      `Clear custom LaTeX for ${req.params.id}`,
    );
    const detail = await clearResumeCustomLatex(req.params.id, message);
    if (!detail) {
      res.status(404).json({ error: 'Resume not found.' });
      return;
    }
    res.json(detail);
  });

  router.post('/resumes/:id/override-point', async (req, res) => {
    const section = typeof req.body?.section === 'string' ? req.body.section : '';
    const refId = typeof req.body?.refId === 'string' ? req.body.refId : '';
    const pointId = typeof req.body?.pointId === 'string' ? req.body.pointId : '';
    const text = typeof req.body?.text === 'string' ? req.body.text : '';

    if (!section || !refId || !pointId || !text) {
      res.status(400).json({
        error: 'section, refId, pointId, and text are required.',
      });
      return;
    }

    const detail = await overridePointForResume({
      resumeId: req.params.id,
      section,
      refId,
      pointId,
      text,
    });

    if (!detail) {
      res.status(404).json({ error: 'Resume not found.' });
      return;
    }
    res.json(detail);
  });

  router.get('/resumes/:id/history', async (req, res) => {
    const history = await listResumeHistory(req.params.id);
    res.json({ history });
  });

  router.get('/resumes/:id/history/:commitHash', async (req, res) => {
    const snapshot = await getHistoricalSnapshot(req.params.id, req.params.commitHash);
    res.json(snapshot);
  });

  router.get('/resumes/:id/build-files', async (req, res) => {
    const files = await getBuildFilesContent(req.params.id);
    res.json(files);
  });

  return router;
}
