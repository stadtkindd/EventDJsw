'use strict';
/*
 * EventDJ – Main-Prozess
 * Fenster, Datenablage, Datei-Dialoge, Bibliothek, Set-Export/-Import
 */
const { app, BrowserWindow, ipcMain, dialog, shell, Menu, session, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const store = require('./store');
const Model = require('../shared/model');

const isDev = process.argv.includes('--dev');

// Fester Datenordner: %APPDATA%\EventDJ (portable Variante: siehe store.js)
app.setName('EventDJ');
try {
  app.setPath('userData', path.join(app.getPath('appData'), 'EventDJ'));
} catch (e) { /* Standardpfad von Electron verwenden */ }
let mainWindow = null;

// Nur eine Instanz zulassen (wichtig bei Touch: Doppelstarts vermeiden)
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
      const setFile = argv.find((a) => a.toLowerCase().endsWith('.edjset'));
      if (setFile) mainWindow.webContents.send('set:open-request', setFile);
    }
  });
}

function createWindow() {
  const { workAreaSize } = screen.getPrimaryDisplay();
  mainWindow = new BrowserWindow({
    width: Math.min(1600, workAreaSize.width),
    height: Math.min(1000, workAreaSize.height),
    minWidth: 800,
    minHeight: 560,
    backgroundColor: '#11141b',
    title: 'EventDJ',
    show: false,
    autoHideMenuBar: true,
    icon: path.join(__dirname, '..', '..', 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      backgroundThrottling: false // Fades/Timer laufen auch im Hintergrund sauber weiter
    }
  });

  Menu.setApplicationMenu(null);
  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.maximize();
    mainWindow.show();
  });

  // Pinch-Zoom auf Touchscreens unterbinden
  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.webContents.setVisualZoomLevelLimits(1, 1).catch(() => {});
    const setFile = process.argv.find((a) => a.toLowerCase().endsWith('.edjset'));
    if (setFile) mainWindow.webContents.send('set:open-request', setFile);
  });

  // Tastatur: F11 Vollbild, F12 DevTools (nur dev), Strg+R neu laden (nur dev)
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11') {
      mainWindow.setFullScreen(!mainWindow.isFullScreen());
      event.preventDefault();
    } else if (input.key === 'F12' && isDev) {
      mainWindow.webContents.toggleDevTools();
    } else if (input.control && input.key.toLowerCase() === 'r' && !isDev) {
      event.preventDefault(); // versehentliches Neuladen während eines Events verhindern
    }
  });

  // Externe Links nie im App-Fenster öffnen
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (e) => e.preventDefault());

  mainWindow.on('closed', () => (mainWindow = null));
}

app.whenReady().then(() => {
  store.init(app);

  // Zugriff auf Ausgabegeräte-Namen (enumerateDevices liefert sonst leere Labels)
  const ses = session.defaultSession;
  ses.setPermissionCheckHandler((_wc, permission) =>
    ['media', 'speaker-selection', 'audioCapture'].includes(permission)
  );
  ses.setPermissionRequestHandler((_wc, permission, cb) =>
    cb(['media', 'speaker-selection', 'audioCapture'].includes(permission))
  );
  if (ses.setDevicePermissionHandler) ses.setDevicePermissionHandler(() => true);

  registerIpc();
  createWindow();
});

app.on('window-all-closed', () => app.quit());

// ---------------------------------------------------------------- IPC

function registerIpc() {
  ipcMain.handle('app:info', () => ({
    version: app.getVersion(),
    dataDir: store.dataDir(),
    libraryDir: store.libraryDir(),
    portable: store.isPortable(),
    platform: process.platform,
    electron: process.versions.electron
  }));

  ipcMain.handle('config:load', () => store.loadConfig());
  ipcMain.handle('config:save', (_e, cfg) => store.saveConfig(cfg));
  ipcMain.on('config:save-sync', (e, cfg) => {
    try {
      store.saveConfig(cfg);
      e.returnValue = true;
    } catch (err) {
      e.returnValue = false;
    }
  });

  ipcMain.handle('dialog:pick-audio', async (_e, multi) => {
    const res = await dialog.showOpenDialog(mainWindow, {
      title: 'Audiodateien auswählen',
      properties: multi === false ? ['openFile'] : ['openFile', 'multiSelections'],
      filters: [
        { name: 'Audio', extensions: Model.AUDIO_EXTENSIONS },
        { name: 'Alle Dateien', extensions: ['*'] }
      ]
    });
    return res.canceled ? [] : res.filePaths;
  });

  // Dateien (optional) in die Bibliothek kopieren und Infos zurückgeben
  ipcMain.handle('library:import', (_e, paths, copy) => {
    return (paths || []).map((p) => {
      try {
        if (!fs.existsSync(p)) return { ok: false, source: p, error: 'Datei nicht gefunden' };
        const target = copy ? store.copyToLibrary(p) : p;
        return { ok: true, source: p, path: target, name: path.basename(p) };
      } catch (err) {
        return { ok: false, source: p, error: String(err.message || err) };
      }
    });
  });

  ipcMain.handle('file:exists', (_e, paths) => (paths || []).map((p) => !!p && fs.existsSync(p)));

  ipcMain.handle('library:cleanup', (_e, usedPaths) => store.cleanupLibrary(usedPaths || []));

  ipcMain.handle('set:export', async (_e, cfg) => {
    const res = await dialog.showSaveDialog(mainWindow, {
      title: 'Set exportieren',
      defaultPath: 'EventDJ-Set-' + new Date().toISOString().slice(0, 10) + '.edjset',
      filters: [{ name: 'EventDJ Set', extensions: ['edjset'] }]
    });
    if (res.canceled || !res.filePath) return { ok: false, canceled: true };
    return store.exportSet(cfg, res.filePath);
  });

  ipcMain.handle('set:import', async (_e, filePath) => {
    let file = filePath;
    if (!file) {
      const res = await dialog.showOpenDialog(mainWindow, {
        title: 'Set importieren',
        properties: ['openFile'],
        filters: [{ name: 'EventDJ Set', extensions: ['edjset', 'zip'] }]
      });
      if (res.canceled || !res.filePaths.length) return { ok: false, canceled: true };
      file = res.filePaths[0];
    }
    return store.importSet(file);
  });

  ipcMain.handle('app:fullscreen', (_e, value) => {
    if (!mainWindow) return false;
    const next = typeof value === 'boolean' ? value : !mainWindow.isFullScreen();
    mainWindow.setFullScreen(next);
    return next;
  });

  ipcMain.handle('app:open-data-dir', () => shell.openPath(store.dataDir()));
  ipcMain.handle('app:open-url', (_e, url) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
  });
}
