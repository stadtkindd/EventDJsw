'use strict';
/*
 * EventDJ – Datenablage
 *
 * Datenordner:
 *  - Portable-EXE:   <Ordner der EXE>\EventDJ-Daten
 *  - Ordner "EventDJ-Daten" neben der EventDJ.exe vorhanden → dieser wird genutzt
 *  - sonst:          %APPDATA%\EventDJ
 *
 * Inhalt: config.json (+ config.bak.json), library\ (kopierte Audiodateien)
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const AdmZip = require('adm-zip');
const Model = require('../shared/model');

let DATA_DIR = null;
let PORTABLE = false;

function init(app) {
  const portableDir = process.env.PORTABLE_EXECUTABLE_DIR;
  const exeDir = path.dirname(app.getPath('exe'));
  if (portableDir) {
    DATA_DIR = path.join(portableDir, 'EventDJ-Daten');
    PORTABLE = true;
  } else if (app.isPackaged && fs.existsSync(path.join(exeDir, 'EventDJ-Daten'))) {
    DATA_DIR = path.join(exeDir, 'EventDJ-Daten');
    PORTABLE = true;
  } else {
    DATA_DIR = app.getPath('userData');
  }
  fs.mkdirSync(libraryDir(), { recursive: true });
}

function dataDir() { return DATA_DIR; }
function libraryDir() { return path.join(DATA_DIR, 'library'); }
function isPortable() { return PORTABLE; }
function configPath() { return path.join(DATA_DIR, 'config.json'); }
function backupPath() { return path.join(DATA_DIR, 'config.bak.json'); }

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return null;
  }
}

function loadConfig() {
  const cfg = readJson(configPath()) || readJson(backupPath());
  return Model.normalizeConfig(cfg || Model.defaultConfig());
}

// Atomar speichern: erst temporär schreiben, dann umbenennen. Vorherige Version als Backup.
function saveConfig(cfg) {
  const clean = Model.normalizeConfig(cfg);
  const json = JSON.stringify(clean, null, 2);
  const tmp = configPath() + '.tmp';
  fs.writeFileSync(tmp, json, 'utf8');
  if (fs.existsSync(configPath())) {
    try { fs.copyFileSync(configPath(), backupPath()); } catch (e) { /* ignorieren */ }
  }
  fs.renameSync(tmp, configPath());
  return true;
}

function fileHash(file) {
  const h = crypto.createHash('sha1');
  h.update(fs.readFileSync(file));
  return h.digest('hex');
}

function safeName(name) {
  return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 150) || 'audio';
}

/** Kopiert eine Datei in die Bibliothek. Identische Dateien werden wiederverwendet. */
function copyToLibrary(src) {
  const lib = libraryDir();
  const resolved = path.resolve(src);
  if (resolved.toLowerCase().startsWith(path.resolve(lib).toLowerCase() + path.sep)) return resolved;

  const ext = path.extname(src);
  const base = safeName(path.basename(src, ext));
  let target = path.join(lib, base + ext);
  let i = 1;
  if (fs.existsSync(target)) {
    const srcHash = fileHash(src);
    while (fs.existsSync(target)) {
      try {
        if (fs.statSync(target).size === fs.statSync(src).size && fileHash(target) === srcHash) return target;
      } catch (e) { /* weiter */ }
      target = path.join(lib, base + ' (' + i++ + ')' + ext);
    }
  }
  fs.copyFileSync(src, target);
  return target;
}

/** Entfernt Dateien aus der Bibliothek, die keiner Kachel mehr zugeordnet sind */
function cleanupLibrary(usedPaths) {
  const lib = path.resolve(libraryDir());
  const used = new Set(usedPaths.map((p) => path.resolve(p).toLowerCase()));
  let removed = 0;
  for (const f of fs.readdirSync(lib)) {
    const full = path.join(lib, f);
    if (!used.has(full.toLowerCase()) && fs.statSync(full).isFile()) {
      fs.unlinkSync(full);
      removed++;
    }
  }
  return { removed };
}

/** Set exportieren: set.json + alle verwendeten Audiodateien in einer ZIP (.edjset) */
function exportSet(cfg, target) {
  const clean = Model.normalizeConfig(cfg);
  const zip = new AdmZip();
  const added = new Map();
  let missing = 0;
  const pack = (file) => {
    if (!file) return '';
    if (!fs.existsSync(file)) { missing++; return ''; }
    const key = path.resolve(file).toLowerCase();
    if (!added.has(key)) {
      const ext = path.extname(file);
      let name = safeName(path.basename(file));
      let n = 1;
      const names = new Set(added.values());
      while (names.has('audio/' + name)) name = safeName(path.basename(file, ext)) + ' (' + n++ + ')' + ext;
      zip.addLocalFile(file, 'audio', name);
      added.set(key, 'audio/' + name);
    }
    return added.get(key);
  };
  clean.tabs.forEach((tab) =>
    tab.tiles.forEach((tile) => {
      tile.file = pack(tile.file);
      tile.playlist.forEach((tr) => (tr.file = pack(tr.file)));
      tile.playlist = tile.playlist.filter((tr) => tr.file);
    })
  );
  zip.addFile('set.json', Buffer.from(JSON.stringify(clean, null, 2), 'utf8'));
  zip.writeZip(target);
  return { ok: true, path: target, files: added.size, missing };
}

/** Set importieren: Audiodateien in die Bibliothek entpacken, Pfade anpassen */
function importSet(file) {
  try {
    const zip = new AdmZip(file);
    const entry = zip.getEntry('set.json');
    if (!entry) return { ok: false, error: 'Keine gültige EventDJ-Set-Datei (set.json fehlt).' };
    const cfg = Model.normalizeConfig(JSON.parse(entry.getData().toString('utf8')));
    const map = new Map();
    const tmpDir = fs.mkdtempSync(path.join(DATA_DIR, 'import-'));
    try {
      zip.getEntries().forEach((e) => {
        if (e.isDirectory || !e.entryName.startsWith('audio/')) return;
        const name = safeName(path.basename(e.entryName));
        const tmpFile = path.join(tmpDir, name);
        fs.writeFileSync(tmpFile, e.getData());
        map.set(e.entryName, copyToLibrary(tmpFile));
      });
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
    cfg.tabs.forEach((tab) =>
      tab.tiles.forEach((tile) => {
        tile.file = map.get(tile.file) || '';
        tile.playlist.forEach((tr) => (tr.file = map.get(tr.file) || ''));
        tile.playlist = tile.playlist.filter((tr) => tr.file);
      })
    );
    return { ok: true, config: cfg, files: map.size };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
}

/** Audiodatei als Bytes lesen (für Wellenform & Lautheitsanalyse) */
function readAudio(file) {
  const st = fs.statSync(file);
  if (st.size > 300 * 1024 * 1024) throw new Error('Datei zu groß für die Analyse');
  return fs.readFileSync(file);
}

module.exports = {
  readAudio,
  init, dataDir, libraryDir, isPortable, loadConfig, saveConfig,
  copyToLibrary, cleanupLibrary, exportSet, importSet
};
