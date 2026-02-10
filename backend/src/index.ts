import cors from 'cors';
import express from 'express';
import type { Server } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApiRouter } from './api/routes.js';
import { bootstrap } from './services/resumeService.js';
import { STORAGE_ROOT } from './utils/paths.js';

export function createServerApp(): express.Express {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '4mb' }));

  app.use('/api', createApiRouter());
  app.use('/artifacts', express.static(STORAGE_ROOT));

  app.use((_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  app.use(
    (
      err: unknown,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      const message = err instanceof Error ? err.message : 'Unknown error';
      res.status(500).json({ error: message });
    },
  );

  return app;
}

export async function startServer(port = Number(process.env.PORT ?? 4100)): Promise<Server> {
  await bootstrap();
  const app = createServerApp();

  return new Promise((resolve) => {
    const server = app.listen(port, () => {
      // eslint-disable-next-line no-console
      console.log(`Resume automator backend running at http://127.0.0.1:${port}`);
      // eslint-disable-next-line no-console
      console.log(`Artifacts served from ${path.resolve(STORAGE_ROOT)}`);
      resolve(server);
    });
  });
}

async function main(): Promise<void> {
  await startServer();
}

const isDirectRun =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  main().catch((error) => {
    // eslint-disable-next-line no-console
    console.error(error);
    process.exit(1);
  });
}
