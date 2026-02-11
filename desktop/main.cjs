const path = require('node:path');
const fs = require('node:fs');
const { fileURLToPath, pathToFileURL } = require('node:url');
const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');

const apiPort = Number(process.env.PORT || 4100);
let mainWindow = null;
let backendServer = null;

ipcMain.handle('choose-folder', async () => {
  const focusedWindow = BrowserWindow.getFocusedWindow() ?? undefined;
  const result = await dialog.showOpenDialog(focusedWindow, {
    title: 'Select PDF Sync Folder',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }
  return result.filePaths[0];
});

function getAppRoot() {
  return path.resolve(__dirname, '..');
}

function getFrontendIndex() {
  return path.join(getAppRoot(), 'frontend', 'dist', 'index.html');
}

function getBackendEntry() {
  return path.join(getAppRoot(), 'backend', 'dist', 'index.js');
}

function isAllowedMainUrl(url, expectedUrl) {
  return (
    url === expectedUrl ||
    url.startsWith(`${expectedUrl}#`) ||
    url.startsWith(`${expectedUrl}?`)
  );
}

function shouldForceMainShell(url, expectedFilePath) {
  if (!url || !url.startsWith('file://')) {
    return false;
  }

  try {
    const currentPath = path.resolve(fileURLToPath(stripHashAndQuery(url)));
    const expectedPath = path.resolve(expectedFilePath);
    if (currentPath === expectedPath) {
      return false;
    }

    const ext = path.extname(currentPath).toLowerCase();
    // Never allow top-level navigation to raw assets/documents.
    return ['.css', '.js', '.mjs', '.json', '.map', '.pdf', '.tex', '.log'].includes(ext);
  } catch {
    return false;
  }
}

function stripHashAndQuery(url) {
  return url.split('#')[0].split('?')[0];
}

function isSameFileUrl(url, expectedFilePath) {
  try {
    const normalizedExpected = path.resolve(expectedFilePath);
    const normalizedCurrent = path.resolve(fileURLToPath(stripHashAndQuery(url)));
    return normalizedCurrent === normalizedExpected;
  } catch {
    return false;
  }
}

async function startBackendServer() {
  const backendEntry = getBackendEntry();
  if (!fs.existsSync(backendEntry)) {
    throw new Error(
      `Backend build output not found at ${backendEntry}. Run \"npm run build\" first.`,
    );
  }

  process.env.PORT = String(apiPort);
  process.env.PUBLIC_BASE_URL = `http://127.0.0.1:${apiPort}`;
  process.env.RESUME_AUTOMATOR_STORAGE_ROOT = path.join(app.getPath('userData'), 'storage');
  process.env.RESUME_AUTOMATOR_PROJECT_ROOT = getAppRoot();

  const backendModule = await import(pathToFileURL(backendEntry).href);
  backendServer = await backendModule.startServer(apiPort);
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1540,
    height: 980,
    minWidth: 1180,
    minHeight: 760,
    title: 'Resume Automator',
    titleBarStyle: 'default',
    backgroundColor: '#f6f8fb',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url).catch(() => {
      // Ignore external open failures.
    });
    return { action: 'deny' };
  });

  const devUrl = process.env.ELECTRON_START_URL;
  if (devUrl) {
    mainWindow.webContents.on('will-navigate', (event, url) => {
      if (url.startsWith(devUrl)) {
        return;
      }
      event.preventDefault();
      shell.openExternal(url).catch(() => {
        // Ignore external open failures.
      });
    });
    mainWindow.loadURL(devUrl);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    const frontendIndex = getFrontendIndex();
    if (!fs.existsSync(frontendIndex)) {
      throw new Error(
        `Frontend build output not found at ${frontendIndex}. Run \"npm run build\" first.`,
      );
    }
    const frontendUrl = pathToFileURL(frontendIndex).toString();

    // Keep top-level navigation anchored to the app shell file.
    mainWindow.webContents.on('will-navigate', (event, url) => {
      if (shouldForceMainShell(url, frontendIndex)) {
        event.preventDefault();
        mainWindow.loadFile(frontendIndex).catch(() => {
          // Ignore reload failures here; did-fail-load will surface startup errors.
        });
        return;
      }

      if (isAllowedMainUrl(url, frontendUrl) || isSameFileUrl(url, frontendIndex)) {
        return;
      }
      event.preventDefault();
      if (url.startsWith('http://') || url.startsWith('https://')) {
        shell.openExternal(url).catch(() => {
          // Ignore external open failures.
        });
        return;
      }
      mainWindow.loadFile(frontendIndex).catch(() => {
        // Ignore reload failures here; did-fail-load will surface startup errors.
      });
    });

    mainWindow.webContents.on('did-finish-load', () => {
      const current = mainWindow?.webContents.getURL() ?? '';
      if (shouldForceMainShell(current, frontendIndex)) {
        mainWindow?.loadFile(frontendIndex).catch(() => {
          // Ignore reload failures here; app startup path will surface hard failures.
        });
        return;
      }
      if (isAllowedMainUrl(current, frontendUrl) || isSameFileUrl(current, frontendIndex)) {
        return;
      }
      mainWindow?.loadFile(frontendIndex).catch(() => {
        // Ignore reload failures here; app startup path will surface hard failures.
      });
    });

    mainWindow.webContents.on('did-navigate', (_event, url) => {
      if (!shouldForceMainShell(url, frontendIndex)) {
        return;
      }
      mainWindow?.loadFile(frontendIndex).catch(() => {
        // Ignore reload failures here; did-finish-load + startup path surface hard failures.
      });
    });

    mainWindow.loadFile(frontendIndex);
  }
}

async function shutdownBackend() {
  if (!backendServer) {
    return;
  }

  await new Promise((resolve) => {
    backendServer.close(() => resolve());
  });
  backendServer = null;
}

async function boot() {
  try {
    await startBackendServer();
    createMainWindow();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    dialog.showErrorBox('Resume Automator failed to start', message);
    await shutdownBackend();
    app.exit(1);
  }
}

const singleInstanceLock = app.requestSingleInstanceLock();
if (!singleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) {
      return;
    }
    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    mainWindow.focus();
  });

  app.whenReady().then(boot);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });

  app.on('before-quit', () => {
    if (backendServer) {
      backendServer.close();
      backendServer = null;
    }
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });
}
