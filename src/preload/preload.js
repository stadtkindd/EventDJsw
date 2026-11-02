'use strict';
/*
 * EventDJ – Preload: sichere Brücke zwischen Oberfläche und Main-Prozess
 */
const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('edj', {
  info: () => ipcRenderer.invoke('app:info'),
  loadConfig: () => ipcRenderer.invoke('config:load'),
  saveConfig: (cfg) => ipcRenderer.invoke('config:save', cfg),
  saveConfigSync: (cfg) => ipcRenderer.sendSync('config:save-sync', cfg),
  pickAudio: (multi) => ipcRenderer.invoke('dialog:pick-audio', multi),
  importFiles: (paths, copy) => ipcRenderer.invoke('library:import', paths, copy),
  filesExist: (paths) => ipcRenderer.invoke('file:exists', paths),
  cleanupLibrary: (used) => ipcRenderer.invoke('library:cleanup', used),
  exportSet: (cfg) => ipcRenderer.invoke('set:export', cfg),
  importSet: (file) => ipcRenderer.invoke('set:import', file),
  fullscreen: (value) => ipcRenderer.invoke('app:fullscreen', value),
  openDataDir: () => ipcRenderer.invoke('app:open-data-dir'),
  openUrl: (url) => ipcRenderer.invoke('app:open-url', url),
  // Pfad einer per Drag & Drop abgelegten Datei ermitteln
  pathForFile: (file) => {
    try { return webUtils.getPathForFile(file); } catch (e) { return ''; }
  },
  onSetOpenRequest: (cb) => {
    setOpenHandler = cb;
    if (pendingSetFile) { const f = pendingSetFile; pendingSetFile = null; cb(f); }
  }
});

// Per Doppelklick geöffnete .edjset-Datei puffern, bis die Oberfläche bereit ist
let pendingSetFile = null;
let setOpenHandler = null;
ipcRenderer.on('set:open-request', (_e, file) => {
  if (setOpenHandler) setOpenHandler(file);
  else pendingSetFile = file;
});
