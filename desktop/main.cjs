const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
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
    mainWindow.loadURL(devUrl);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    const frontendIndex = getFrontendIndex();
    if (!fs.existsSync(frontendIndex)) {
      throw new Error(
        `Frontend build output not found at ${frontendIndex}. Run \"npm run build\" first.`,
      );
    }
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
