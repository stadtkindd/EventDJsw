/*
 * EventDJ – Datenmodell (wird von Main-Prozess, Renderer und Tests genutzt)
 *
 * Aufbau einer Konfiguration:
 * {
 *   version, settings{...}, styles[ {id,name,bg,fg,fontSize,bold} ],
 *   tabs[ {id,name,color,cols,rows,tiles[ {id,slot,title,file,...,playCount} ]} ],
 *   activeTabId
 * }
 */
(function (root) {
  'use strict';

  const SCHEMA_VERSION = 1;

  const AUDIO_EXTENSIONS = ['mp3', 'wav', 'ogg', 'oga', 'flac', 'm4a', 'aac', 'mp4', 'opus', 'webm', 'weba'];

  function uid(prefix) {
    return (prefix || 'id') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function clamp(n, min, max, fallback) {
    n = Number(n);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  }

  function str(v, fallback) {
    return typeof v === 'string' ? v : fallback;
  }

  function color(v, fallback) {
    return typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? v : fallback;
  }

  function defaultSettings() {
    return {
      masterDeviceId: 'default',
      masterDeviceLabel: '',
      cueDeviceId: '',
      cueDeviceLabel: '',
      masterVolume: 1,
      cueVolume: 1,
      defaultFadeIn: 300,
      defaultFadeOut: 1500,
      playMode: 'exclusive',   // 'exclusive' = neuer Jingle blendet laufenden aus, 'overlap' = mehrere gleichzeitig
      retrigger: 'stop',       // Klick auf laufende Kachel: 'stop' (ausblenden) oder 'restart'
      triggerOn: 'up',         // 'up' = beim Loslassen, 'down' = sofort beim Berühren
      copyToLibrary: true,     // Audiodateien in die Bibliothek der App kopieren
      showRemaining: true,
      tileScale: 1,            // globaler Faktor für Schriftgrößen
      longPressMs: 550,
      confirmReset: true,
      // Ducking: Hintergrundmusik wird abgesenkt, solange ein Jingle läuft
      duckLevel: 0.25,
      duckFadeMs: 500,
      // Lautheit
      normalizeOnImport: true,
      targetLufs: -16,
      showMeter: true,
      // Fernsteuerung
      midiEnabled: true,
      midiStop: '',            // MIDI-Zuweisung "Sofort stoppen"
      midiFade: '',            // MIDI-Zuweisung "Alles ausblenden"
      httpEnabled: false,      // lokale HTTP-Schnittstelle (Stream Deck, Companion)
      httpPort: 8765,
      httpLan: false,          // auch im Netzwerk erreichbar (Tablet/Handy als Fernbedienung)
      // Player-Tasten (je Aktion bis zu zwei Tasten)
      keys: defaultKeys(),
      // Live-Effekte
      fxBarOpen: false,
      fxModules: FX_MODULES.slice(),     // sichtbare Regler in der Effektleiste (Reihenfolge)
      tempoPresets: [1, 2, 5, 10],
      pitchLock: false,                  // Tonhöhe beim Beschleunigen halten
      echoMs: 375,
      fxAutoReset: false,                // Effekte zurücksetzen, wenn nichts mehr läuft
      fxMidi: {}                         // MIDI-Regler je Effekt, z. B. { bass: 'cc:1:7' }
    };
  }

  /** Live-Effekte (Reihenfolge = Standard-Reihenfolge in der Leiste) */
  const FX_MODULES = ['tempo', 'bass', 'treble', 'filter', 'hall', 'echo'];

  /** Player-Aktionen mit Standardtasten */
  const PLAYER_ACTIONS = [
    { id: 'stopAll', label: 'Sofort alles stoppen', keys: ['Enter', 'Shift+Escape'] },
    { id: 'pause', label: 'Pause / Weiter', keys: ['Space'] },
    { id: 'fadeAll', label: 'Alles ausblenden', keys: ['Escape'] },
    { id: 'nextTrack', label: 'Playlist: nächster Titel', keys: [] },
    { id: 'nextTab', label: 'Nächster Reiter', keys: ['PageDown'] },
    { id: 'prevTab', label: 'Vorheriger Reiter', keys: ['PageUp'] },
    { id: 'nextLayer', label: 'Nächste Reiter-Ebene', keys: ['Ctrl+PageDown'] },
    { id: 'prevLayer', label: 'Vorherige Reiter-Ebene', keys: ['Ctrl+PageUp'] },
    { id: 'fxBar', label: 'Effektleiste ein/aus', keys: ['Ctrl+F'] },
    { id: 'fxReset', label: 'Alle Effekte zurücksetzen', keys: ['Backspace'] },
    { id: 'tempoUp', label: 'Tempo: nächste Stufe', keys: ['+', 'NumAdd'] },
    { id: 'tempoDown', label: 'Tempo: vorherige Stufe', keys: ['-', 'NumSubtract'] },
    { id: 'tempoReset', label: 'Tempo: normal (1×)', keys: ['NumMultiply'] },
    { id: 'edit', label: 'Bearbeiten ein/aus', keys: ['Ctrl+E'] },
    { id: 'reset', label: 'Neues Spiel (Zähler zurücksetzen)', keys: [] }
  ];

  function defaultKeys() {
    const out = {};
    PLAYER_ACTIONS.forEach((a) => (out[a.id] = a.keys.slice()));
    return out;
  }

  function normalizeKeys(k) {
    const out = defaultKeys();
    if (!k || typeof k !== 'object') return out;
    PLAYER_ACTIONS.forEach((a) => {
      if (Array.isArray(k[a.id])) out[a.id] = k[a.id].filter((x) => typeof x === 'string' && x).slice(0, 2);
    });
    return out;
  }

  /** Höchstzahl Reiter: 10 je Ebene, 3 Ebenen */
  const TABS_PER_LAYER = 10;
  const MAX_LAYERS = 3;
  const MAX_TABS = TABS_PER_LAYER * MAX_LAYERS;

  function defaultStyles() {
    return [
      { id: 'st_standard', name: 'Standard', bg: '#2b3140', fg: '#ffffff', fontSize: 22, bold: true },
      { id: 'st_satzbeginn', name: 'Satzbeginn', bg: '#1d5fd1', fg: '#ffffff', fontSize: 24, bold: true },
      { id: 'st_auszeit', name: 'Auszeiten', bg: '#1f9d55', fg: '#ffffff', fontSize: 24, bold: true },
      { id: 'st_ironie', name: 'Ironie Gegner', bg: '#f2c818', fg: '#1a1a1a', fontSize: 24, bold: true },
      { id: 'st_punkt', name: 'Punkt Heim', bg: '#d1361d', fg: '#ffffff', fontSize: 24, bold: true },
      { id: 'st_hymne', name: 'Hymne', bg: '#6b3fa0', fg: '#ffffff', fontSize: 26, bold: true }
    ];
  }

  function newTab(name, color, cols, rows, layer) {
    return {
      id: uid('tab'),
      name: name || 'Neuer Reiter',
      color: color || '#1d5fd1',
      cols: cols || 4,
      rows: rows || 3,
      layer: layer || 0,
      tiles: []
    };
  }

  function newTile(slot, data) {
    data = data || {};
    return normalizeTile(Object.assign({ id: uid('tile'), slot: slot }, data));
  }

  function defaultConfig() {
    const tabs = [
      newTab('Während des Spiels', '#1d5fd1', 4, 3),
      newTab('Satzpausen', '#1f9d55', 4, 3),
      newTab('Hymnen', '#6b3fa0', 3, 2)
    ];
    return {
      version: SCHEMA_VERSION,
      settings: defaultSettings(),
      styles: defaultStyles(),
      tabs: tabs,
      activeTabId: tabs[0].id
    };
  }

  function normalizeTile(t) {
    t = t || {};
    return {
      id: str(t.id, uid('tile')),
      slot: Math.max(0, Math.floor(clamp(t.slot, 0, 9999, 0))),
      title: str(t.title, 'Jingle'),
      subtitle: str(t.subtitle, ''),
      file: str(t.file, ''),            // absoluter Pfad zur Audiodatei
      fileName: str(t.fileName, ''),    // Originaldateiname (Anzeige)
      duration: clamp(t.duration, 0, 86400, 0),
      styleId: str(t.styleId, 'st_standard'),
      // Überschreibungen (null = vom Stil übernehmen)
      bg: color(t.bg, null),
      fg: color(t.fg, null),
      fontSize: t.fontSize == null ? null : clamp(t.fontSize, 8, 120, null),
      // Wiedergabe (null = globaler Standard)
      fadeIn: t.fadeIn == null ? null : clamp(t.fadeIn, 0, 20000, null),
      fadeOut: t.fadeOut == null ? null : clamp(t.fadeOut, 0, 20000, null),
      volume: clamp(t.volume, 0, 1, 1),
      startAt: clamp(t.startAt, 0, 86400, 0),
      endAt: clamp(t.endAt, 0, 86400, 0),          // 0 = bis Dateiende; sonst Auto-Ausblenden bis zu diesem Punkt
      loop: !!t.loop,
      // Lautheit (Normalisierung): Verstärkung in dB, gemessene Lautheit (LUFS) und Spitzenpegel
      gainDb: clamp(t.gainDb, -24, 24, 0),
      loudness: t.loudness == null ? null : clamp(t.loudness, -99, 10, null),
      peak: t.peak == null ? null : clamp(t.peak, 0, 4, null),
      // Art: Einzel-Jingle oder Playlist; Rolle: normal oder Hintergrund (wird bei Jingles abgesenkt)
      kind: t.kind === 'playlist' ? 'playlist' : 'single',
      playlist: Array.isArray(t.playlist) ? t.playlist.map(normalizeTrack).filter((x) => x.file) : [],
      shuffle: !!t.shuffle,
      role: t.role === 'bed' ? 'bed' : 'normal',
      // Fernsteuerung
      hotkey: str(t.hotkey, ''),
      midi: str(t.midi, ''),
      playCount: Math.max(0, Math.floor(clamp(t.playCount, 0, 1e9, 0)))
    };
  }

  function normalizeTrack(x) {
    x = x || {};
    return {
      file: str(x.file, ''),
      fileName: str(x.fileName, ''),
      duration: clamp(x.duration, 0, 86400, 0),
      gainDb: clamp(x.gainDb, -24, 24, 0),
      loudness: x.loudness == null ? null : clamp(x.loudness, -99, 10, null),
      peak: x.peak == null ? null : clamp(x.peak, 0, 4, null)
    };
  }

  /** Alle Audiodateien einer Kachel (Einzeldatei bzw. Playlist) */
  function tileFiles(tile) {
    const out = [];
    if (tile.file) out.push(tile.file);
    (tile.playlist || []).forEach((x) => x.file && out.push(x.file));
    return out;
  }

  /** Abspielbar? */
  function tileHasAudio(tile) {
    return tile.kind === 'playlist' ? tile.playlist.length > 0 : !!tile.file;
  }

  /** Normalisierungs-Verstärkung (dB), begrenzt durch Spitzenpegel (max. −1 dBFS) */
  function normalizeGain(loudness, peak, target) {
    if (loudness == null || !Number.isFinite(loudness)) return 0;
    let g = target - loudness;
    if (peak && peak > 0) {
      const headroom = -1 - 20 * Math.log10(peak);
      g = Math.min(g, headroom);
    }
    return Math.round(Math.max(-24, Math.min(24, g)) * 10) / 10;
  }

  function normalizeTab(t) {
    t = t || {};
    const tab = {
      id: str(t.id, uid('tab')),
      name: str(t.name, 'Reiter'),
      color: color(t.color, '#1d5fd1'),
      cols: Math.floor(clamp(t.cols, 1, 12, 4)),
      rows: Math.floor(clamp(t.rows, 1, 12, 3)),
      layer: t.layer == null ? null : Math.floor(clamp(t.layer, 0, MAX_LAYERS - 1, 0)),  // Reiter-Ebene 0…2
      tiles: Array.isArray(t.tiles) ? t.tiles.map(normalizeTile) : []
    };
    // doppelte Slots auflösen
    const used = new Set();
    tab.tiles.sort((a, b) => a.slot - b.slot);
    tab.tiles.forEach((tile) => {
      while (used.has(tile.slot)) tile.slot++;
      used.add(tile.slot);
    });
    return tab;
  }

  function normalizeStyle(s) {
    s = s || {};
    return {
      id: str(s.id, uid('st')),
      name: str(s.name, 'Stil'),
      bg: color(s.bg, '#2b3140'),
      fg: color(s.fg, '#ffffff'),
      fontSize: clamp(s.fontSize, 8, 120, 22),
      bold: s.bold !== false
    };
  }

  function normalizeConfig(cfg) {
    if (!cfg || typeof cfg !== 'object') return defaultConfig();
    const base = defaultSettings();
    const s = Object.assign({}, base, cfg.settings || {});
    const settings = {
      masterDeviceId: str(s.masterDeviceId, 'default'),
      masterDeviceLabel: str(s.masterDeviceLabel, ''),
      cueDeviceId: str(s.cueDeviceId, ''),
      cueDeviceLabel: str(s.cueDeviceLabel, ''),
      masterVolume: clamp(s.masterVolume, 0, 1, 1),
      cueVolume: clamp(s.cueVolume, 0, 1, 1),
      defaultFadeIn: clamp(s.defaultFadeIn, 0, 20000, base.defaultFadeIn),
      defaultFadeOut: clamp(s.defaultFadeOut, 0, 20000, base.defaultFadeOut),
      playMode: s.playMode === 'overlap' ? 'overlap' : 'exclusive',
      retrigger: s.retrigger === 'restart' ? 'restart' : 'stop',
      triggerOn: s.triggerOn === 'down' ? 'down' : 'up',
      copyToLibrary: s.copyToLibrary !== false,
      showRemaining: s.showRemaining !== false,
      tileScale: clamp(s.tileScale, 0.5, 2.5, 1),
      longPressMs: clamp(s.longPressMs, 250, 2000, 550),
      confirmReset: s.confirmReset !== false,
      duckLevel: clamp(s.duckLevel, 0, 1, 0.25),
      duckFadeMs: clamp(s.duckFadeMs, 0, 5000, 500),
      normalizeOnImport: s.normalizeOnImport !== false,
      targetLufs: clamp(s.targetLufs, -30, -6, -16),
      showMeter: s.showMeter !== false,
      midiEnabled: s.midiEnabled !== false,
      midiStop: str(s.midiStop, ''),
      midiFade: str(s.midiFade, ''),
      httpEnabled: !!s.httpEnabled,
      httpPort: Math.floor(clamp(s.httpPort, 1024, 65535, 8765)),
      httpLan: !!s.httpLan,
      keys: normalizeKeys(s.keys),
      fxBarOpen: !!s.fxBarOpen,
      fxModules: Array.isArray(s.fxModules) ? s.fxModules.filter((m, i, a) => FX_MODULES.includes(m) && a.indexOf(m) === i) : FX_MODULES.slice(),
      tempoPresets: normalizePresets(s.tempoPresets),
      pitchLock: !!s.pitchLock,
      echoMs: Math.round(clamp(s.echoMs, 50, 1500, 375)),
      fxAutoReset: !!s.fxAutoReset,
      fxMidi: normalizeFxMidi(s.fxMidi)
    };
    let styles = Array.isArray(cfg.styles) ? cfg.styles.map(normalizeStyle) : defaultStyles();
    if (!styles.length) styles = defaultStyles();
    let tabs = Array.isArray(cfg.tabs) ? cfg.tabs.map(normalizeTab) : [];
    if (!tabs.length) tabs = [newTab('Reiter 1')];
    assignLayers(tabs);
    const activeTabId = tabs.some((t) => t.id === cfg.activeTabId) ? cfg.activeTabId : tabs[0].id;
    return { version: SCHEMA_VERSION, settings, styles, tabs, activeTabId };
  }

  function normalizePresets(p) {
    let list = Array.isArray(p) ? p : [1, 2, 5, 10];
    list = list.map(Number).filter((x) => Number.isFinite(x) && x >= 0.25 && x <= 16).map((x) => Math.round(x * 100) / 100);
    list = list.filter((x, i, a) => a.indexOf(x) === i).sort((a, b) => a - b).slice(0, 8);
    if (!list.includes(1)) list.unshift(1);
    return list.sort((a, b) => a - b);
  }

  function normalizeFxMidi(m) {
    const out = {};
    if (!m || typeof m !== 'object') return out;
    FX_MODULES.forEach((k) => { if (typeof m[k] === 'string' && /^cc:\d+:\d+$/.test(m[k])) out[k] = m[k]; });
    return out;
  }

  /**
   * Jeder Reiter gehört zu einer Ebene (0…2), je Ebene höchstens 10 Reiter.
   * Ältere Konfigurationen ohne Ebene werden der Reihe nach verteilt; volle Ebenen laufen in die nächste über.
   */
  function assignLayers(tabs) {
    const counts = new Array(MAX_LAYERS).fill(0);
    tabs.forEach((t, i) => {
      let L = t.layer == null ? Math.min(MAX_LAYERS - 1, Math.floor(i / TABS_PER_LAYER)) : t.layer;
      while (L < MAX_LAYERS - 1 && counts[L] >= TABS_PER_LAYER) L++;
      t.layer = L;
      counts[L]++;
    });
    return tabs;
  }

  /** Reiter einer Ebene in Anzeigereihenfolge */
  function tabsOfLayer(tabs, layer) { return tabs.filter((t) => (t.layer || 0) === layer); }

  /** Anzahl der benutzten Ebenen (mindestens 1) */
  function layerCount(tabs) { return 1 + (tabs || []).reduce((m, t) => Math.max(m, t.layer || 0), 0); }

  /** Effektives Aussehen einer Kachel (Stil + Überschreibungen) */
  function resolveLook(cfg, tile) {
    const style = cfg.styles.find((s) => s.id === tile.styleId) || cfg.styles[0];
    return {
      bg: tile.bg || style.bg,
      fg: tile.fg || style.fg,
      fontSize: (tile.fontSize || style.fontSize) * (cfg.settings.tileScale || 1),
      bold: style.bold,
      styleName: style.name
    };
  }

  /** Anzahl der Zeilen, die nötig sind, damit keine Kachel verloren geht */
  function effectiveRows(tab) {
    const maxSlot = tab.tiles.reduce((m, t) => Math.max(m, t.slot), -1);
    return Math.max(tab.rows, Math.ceil((maxSlot + 1) / tab.cols));
  }

  /** Freie Slots ab einer Startposition */
  function freeSlots(tab, start, count) {
    const used = new Set(tab.tiles.map((t) => t.slot));
    const out = [];
    let s = Math.max(0, start || 0);
    while (out.length < count) {
      if (!used.has(s)) out.push(s);
      s++;
    }
    return out;
  }

  /** Kachel verschieben; ist der Ziel-Slot belegt, wird getauscht */
  function moveTile(tab, tileId, targetSlot) {
    const tile = tab.tiles.find((t) => t.id === tileId);
    if (!tile) return false;
    const other = tab.tiles.find((t) => t.slot === targetSlot && t.id !== tileId);
    if (other) other.slot = tile.slot;
    tile.slot = targetSlot;
    return true;
  }

  function resetCounters(cfg, tabId) {
    cfg.tabs.forEach((tab) => {
      if (tabId && tab.id !== tabId) return;
      tab.tiles.forEach((t) => (t.playCount = 0));
    });
  }

  function isAudioFile(name) {
    const m = /\.([^.\\/]+)$/.exec(String(name || ''));
    return !!m && AUDIO_EXTENSIONS.indexOf(m[1].toLowerCase()) >= 0;
  }

  function titleFromFileName(name) {
    const base = String(name || '').split(/[\\/]/).pop().replace(/\.[^.]+$/, '');
    return base.replace(/[_]+/g, ' ').trim() || 'Jingle';
  }

  const api = {
    SCHEMA_VERSION, AUDIO_EXTENSIONS, uid, defaultConfig, defaultSettings, defaultStyles,
    newTab, newTile, normalizeConfig, normalizeTile, normalizeTab, normalizeStyle, normalizeTrack,
    tileFiles, tileHasAudio, normalizeGain,
    resolveLook, effectiveRows, freeSlots, moveTile, resetCounters, isAudioFile, titleFromFileName,
    FX_MODULES, PLAYER_ACTIONS, defaultKeys, normalizeKeys, normalizePresets,
    TABS_PER_LAYER, MAX_LAYERS, MAX_TABS, assignLayers, tabsOfLayer, layerCount
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.EDJModel = api;
})(typeof window !== 'undefined' ? window : globalThis);
