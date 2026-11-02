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
      confirmReset: true
    };
  }

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

  function newTab(name, color, cols, rows) {
    return {
      id: uid('tab'),
      name: name || 'Neuer Reiter',
      color: color || '#1d5fd1',
      cols: cols || 4,
      rows: rows || 3,
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
      loop: !!t.loop,
      playCount: Math.max(0, Math.floor(clamp(t.playCount, 0, 1e9, 0)))
    };
  }

  function normalizeTab(t) {
    t = t || {};
    const tab = {
      id: str(t.id, uid('tab')),
      name: str(t.name, 'Reiter'),
      color: color(t.color, '#1d5fd1'),
      cols: Math.floor(clamp(t.cols, 1, 12, 4)),
      rows: Math.floor(clamp(t.rows, 1, 12, 3)),
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
      confirmReset: s.confirmReset !== false
    };
    let styles = Array.isArray(cfg.styles) ? cfg.styles.map(normalizeStyle) : defaultStyles();
    if (!styles.length) styles = defaultStyles();
    let tabs = Array.isArray(cfg.tabs) ? cfg.tabs.map(normalizeTab) : [];
    if (!tabs.length) tabs = [newTab('Reiter 1')];
    const activeTabId = tabs.some((t) => t.id === cfg.activeTabId) ? cfg.activeTabId : tabs[0].id;
    return { version: SCHEMA_VERSION, settings, styles, tabs, activeTabId };
  }

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
    newTab, newTile, normalizeConfig, normalizeTile, normalizeTab, normalizeStyle,
    resolveLook, effectiveRows, freeSlots, moveTile, resetCounters, isAudioFile, titleFromFileName
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.EDJModel = api;
})(typeof window !== 'undefined' ? window : globalThis);
