/*
 * EventDJ – Oberfläche
 * Reiter, Kachel-Matrix, Bearbeitung, Einstellungen, Bedienung per Touch & Maus
 */
(function () {
  'use strict';

  const M = window.EDJModel;
  const A = window.AudioEngine;
  const fileNames = new Map();
  const api = window.edj || browserFallback();

  let cfg = null;
  let info = {};
  let editMode = false;
  let moveTileId = null;
  let devices = [];
  const missing = new Set();
  let tileEls = new Map();   // tileId -> { el, progress, line, time, count }
  let npEls = new Map();     // voiceId -> { el, bar, time }

  const PALETTE = ['#1d5fd1', '#0e8fd6', '#13a3a3', '#1f9d55', '#5aa832', '#f2c818', '#f08c1a', '#d1361d',
    '#e0457b', '#6b3fa0', '#3b3f4c', '#8a6a4b', '#111111', '#ffffff'];

  // ================================================================ Helfer

  const $ = (s, el) => (el || document).querySelector(s);

  function h(tag, props) {
    const el = document.createElement(tag);
    const kids = Array.prototype.slice.call(arguments, 2);
    if (props) {
      Object.keys(props).forEach((k) => {
        const v = props[k];
        if (v == null || v === false) return;
        if (k === 'class') el.className = v;
        else if (k === 'style' && typeof v === 'object') {
          Object.keys(v).forEach((sk) => {
            if (sk.startsWith('--')) el.style.setProperty(sk, v[sk]);
            else el.style[sk] = v[sk];
          });
        } else if (k === 'dataset') Object.assign(el.dataset, v);
        else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else if (k in el && typeof v !== 'string') el[k] = v;
        else el.setAttribute(k, v === true ? '' : v);
      });
    }
    append(el, kids);
    return el;
  }
  function append(el, kids) {
    (Array.isArray(kids) ? kids : [kids]).forEach((c) => {
      if (c == null || c === false) return;
      if (Array.isArray(c)) append(el, c);
      else el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
    });
  }

  function fmtTime(sec) {
    if (!Number.isFinite(sec) || sec < 0) sec = 0;
    sec = Math.round(sec);
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return m + ':' + String(s).padStart(2, '0');
  }

  function contrast(hex) {
    const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || '');
    if (!m) return '#ffffff';
    const [r, g, b] = [m[1], m[2], m[3]].map((x) => parseInt(x, 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.45 ? '#141414' : '#ffffff';
  }

  function toast(msg, kind, ms) {
    const t = h('div', { class: 'toast ' + (kind || '') }, msg);
    $('#toasts').appendChild(t);
    setTimeout(() => t.remove(), ms || 3500);
  }

  let saveTimer = null;
  function persist() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      api.saveConfig(cfg).catch((e) => toast('Speichern fehlgeschlagen: ' + e, 'err'));
    }, 300);
  }

  function activeTab() {
    return cfg.tabs.find((t) => t.id === cfg.activeTabId) || cfg.tabs[0];
  }

  function findTile(tileId) {
    for (const tab of cfg.tabs) {
      const tile = tab.tiles.find((t) => t.id === tileId);
      if (tile) return { tab, tile };
    }
    return null;
  }

  function fadeInOf(tile) { return tile.fadeIn == null ? cfg.settings.defaultFadeIn : tile.fadeIn; }
  function fadeOutOf(tile) { return tile.fadeOut == null ? cfg.settings.defaultFadeOut : tile.fadeOut; }

  // ================================================================ Start

  async function init() {
    info = await api.info();
    cfg = M.normalizeConfig(await api.loadConfig());

    A.setBusVolume('master', cfg.settings.masterVolume);
    A.setBusVolume('cue', cfg.settings.cueVolume);
    await refreshDevices(true);

    A.on('change', onVoiceChange);
    A.on('tick', updateProgress);
    A.on('error', (e) => toast('„' + e.voice.title + '“: ' + e.error, 'err', 5000));
    A.on('device-error', (e) => toast('Ausgabegerät nicht verfügbar – Windows-Standard wird genutzt.', 'err', 5000));
    A.on('devices-changed', () => refreshDevices(false));

    bindTopbar();
    bindBottombar();
    bindDragDrop();
    bindKeys();
    if (api.onSetOpenRequest) api.onSetOpenRequest((file) => importSet(file));

    window.addEventListener('beforeunload', () => {
      if (saveTimer) { clearTimeout(saveTimer); }
      try { api.saveConfigSync(cfg); } catch (e) { /* ignorieren */ }
    });

    renderAll();
    checkMissing();
  }

  async function checkMissing() {
    const files = [];
    cfg.tabs.forEach((t) => t.tiles.forEach((tile) => tile.file && files.push(tile.file)));
    if (!files.length) return;
    const exists = await api.filesExist(files);
    missing.clear();
    files.forEach((f, i) => { if (!exists[i]) missing.add(f); });
    if (missing.size) toast(missing.size + ' Audiodatei(en) nicht gefunden – betroffene Kacheln sind grau.', 'err', 6000);
    renderGrid();
  }

  // ================================================================ Ausgabegeräte

  async function refreshDevices(initial) {
    try { devices = await A.listOutputs(); } catch (e) { devices = []; }
    const s = cfg.settings;
    const resolve = (idKey, labelKey) => {
      const id = s[idKey];
      if (!id || id === 'default') return;
      if (devices.some((d) => d.deviceId === id)) return;
      const byLabel = s[labelKey] && devices.find((d) => d.label === s[labelKey]);
      if (byLabel) { s[idKey] = byLabel.deviceId; persist(); return; }
      if (devices.length) toast('Ausgabegerät „' + (s[labelKey] || 'unbekannt') + '“ nicht gefunden – Windows-Standard wird genutzt.', 'err', 6000);
    };
    resolve('masterDeviceId', 'masterDeviceLabel');
    resolve('cueDeviceId', 'cueDeviceLabel');
    const masterOk = s.masterDeviceId === 'default' || devices.some((d) => d.deviceId === s.masterDeviceId);
    const cueOk = !s.cueDeviceId || devices.some((d) => d.deviceId === s.cueDeviceId);
    await A.setSink('master', masterOk ? s.masterDeviceId : 'default');
    await A.setSink('cue', cueOk ? s.cueDeviceId : '');
    renderOutputInfo();
    if (!initial) {
      const dlg = document.querySelector('.dialog[data-kind=settings]');
      if (dlg && dlg._refreshDevices) dlg._refreshDevices();
      renderGrid();
    }
  }

  function deviceLabel(id, fallback) {
    if (!id) return fallback;
    if (id === 'default') return 'Windows-Standard';
    const d = devices.find((x) => x.deviceId === id);
    return d ? d.label : fallback;
  }

  function renderOutputInfo() {
    const s = cfg.settings;
    const el = $('#output-info');
    el.innerHTML = '';
    append(el, [
      h('div', null, '🔊 ' + deviceLabel(s.masterDeviceId, s.masterDeviceLabel || 'Windows-Standard')),
      h('div', null, '🎧 ' + (s.cueDeviceId ? deviceLabel(s.cueDeviceId, s.cueDeviceLabel || '?') : 'Vorhören: wie Master'))
    ]);
  }

  // ================================================================ Rendering

  function renderAll() {
    document.body.classList.toggle('editing', editMode);
    document.body.classList.toggle('moving', !!moveTileId);
    $('#btn-edit').classList.toggle('on', editMode);
    $('#btn-edit .lbl').textContent = editMode ? 'Fertig' : 'Bearbeiten';
    const banner = $('#edit-banner');
    banner.hidden = !editMode && !moveTileId;
    banner.classList.toggle('move', !!moveTileId);
    $('#edit-banner-text').textContent = moveTileId
      ? 'Verschieben: Zielfeld antippen (belegtes Feld = Kacheln tauschen) – oder auf einen Reiter tippen.'
      : 'Bearbeitungsmodus – Kachel antippen zum Bearbeiten, leeres Feld zum Hinzufügen, Audiodateien aus dem Explorer hierher ziehen.';
    $('#edit-banner-cancel').hidden = !moveTileId;
    renderTabs();
    renderGrid();
    renderNowPlaying();
    const mv = $('#master-vol');
    mv.value = Math.round(cfg.settings.masterVolume * 100);
    $('#master-val').textContent = mv.value + '%';
    renderOutputInfo();
  }

  function tabIsPlaying(tab) {
    let playing = false;
    A.voices.forEach((v) => { if (v.bus === 'master' && tab.tiles.some((t) => t.id === v.tileId)) playing = true; });
    return playing;
  }

  function renderTabs() {
    const nav = $('#tabs');
    nav.innerHTML = '';
    cfg.tabs.forEach((tab, idx) => {
      const isActive = tab.id === cfg.activeTabId;
      const b = h('button', {
        class: 'tab' + (isActive ? ' active' : ''),
        style: { '--tabc': tab.color, '--tabfg': contrast(tab.color) },
        title: tab.name + (idx < 9 ? '  (Strg+' + (idx + 1) + ')' : ''),
        draggable: editMode ? 'true' : 'false'
      },
      tab.name,
      tabIsPlaying(tab) ? h('span', { class: 'dot' }) : null,
      editMode && isActive ? h('span', { class: 'edit-mark' }, '✎') : null);

      b.addEventListener('click', () => {
        if (moveTileId) { moveTileToTab(moveTileId, tab); return; }
        if (isActive && editMode) openTabEditor(tab);
        else selectTab(tab.id);
      });
      b.addEventListener('dblclick', () => { if (!editMode) return; openTabEditor(tab); });
      b.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        showMenu(e.clientX, e.clientY, tab.name, [
          { icon: '✎', label: 'Reiter bearbeiten', fn: () => openTabEditor(tab) },
          { icon: '↺', label: 'Zähler dieses Reiters zurücksetzen', fn: () => resetCounters(tab) },
          { icon: '+', label: 'Neuer Reiter', fn: () => openTabEditor(null) }
        ]);
      });

      // Reiter per Maus umsortieren / Kacheln & Dateien auf Reiter ziehen
      b.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/edj-tab', String(idx)); e.dataTransfer.effectAllowed = 'move'; });
      b.addEventListener('dragover', (e) => {
        const types = Array.from(e.dataTransfer.types);
        if (types.includes('text/edj-tab') || types.includes('text/edj-tile') || types.includes('Files')) {
          e.preventDefault();
          b.classList.add('drag-over');
          if (types.includes('Files') && !isActive) selectTabDelayed(tab.id);
        }
      });
      b.addEventListener('dragleave', () => b.classList.remove('drag-over'));
      b.addEventListener('drop', (e) => {
        b.classList.remove('drag-over');
        const from = e.dataTransfer.getData('text/edj-tab');
        const tileId = e.dataTransfer.getData('text/edj-tile');
        if (from !== '') {
          e.preventDefault();
          const [moved] = cfg.tabs.splice(Number(from), 1);
          cfg.tabs.splice(idx, 0, moved);
          persist(); renderTabs();
        } else if (tileId) {
          e.preventDefault();
          moveTileToTab(tileId, tab);
        }
      });
      nav.appendChild(b);
    });
    if (editMode) {
      nav.appendChild(h('button', { class: 'tab add', title: 'Neuen Reiter anlegen', onclick: () => openTabEditor(null) }, '+'));
    }
    const act = nav.querySelector('.tab.active');
    if (act && act.scrollIntoView) act.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  let tabSwitchTimer = null;
  function selectTabDelayed(id) {
    clearTimeout(tabSwitchTimer);
    tabSwitchTimer = setTimeout(() => selectTab(id), 600);
  }

  function selectTab(id) {
    if (cfg.activeTabId === id) return;
    cfg.activeTabId = id;
    persist();
    renderTabs();
    renderGrid();
  }

  function renderGrid() {
    const tab = activeTab();
    const grid = $('#grid');
    const rows = M.effectiveRows(tab);
    const total = tab.cols * rows;
    grid.style.gridTemplateColumns = 'repeat(' + tab.cols + ', minmax(0, 1fr))';
    grid.style.gridTemplateRows = 'repeat(' + rows + ', minmax(' + (rows > tab.rows ? 110 : 90) + 'px, 1fr))';
    grid.innerHTML = '';
    tileEls = new Map();

    const bySlot = new Map(tab.tiles.map((t) => [t.slot, t]));
    for (let slot = 0; slot < total; slot++) {
      const tile = bySlot.get(slot);
      const slotEl = h('div', { class: 'slot' + (tile ? '' : ' empty'), dataset: { slot: String(slot) } });
      if (tile) {
        const built = buildTile(tile, { interactive: true, tab });
        slotEl.appendChild(built.el);
        tileEls.set(tile.id, built);
      }
      bindSlot(slotEl, tab, slot);
      grid.appendChild(slotEl);
    }
    updateTileStates();
    updateProgress();
    A.prewarm(tab.tiles);
  }

  function buildTile(tile, opts) {
    opts = opts || {};
    const look = M.resolveLook(cfg, tile);
    const isMissing = !!tile.file && missing.has(tile.file);
    const progress = h('div', { class: 'progress' });
    const line = h('div', { class: 'progress-line' });
    const count = h('span', { class: 'count' + (tile.playCount ? '' : ' zero'), title: 'So oft gespielt' }, tile.playCount + '×');
    const time = h('span', { class: 'time' }, tile.duration ? fmtTime(tile.duration) : '');
    const flags = [];
    if (tile.loop) flags.push('⟲');
    const playBtn = h('button', { class: 'play', title: 'Abspielen / Stoppen', tabindex: '-1' }, '▶');

    const el = h('div', {
      class: 'tile' + (isMissing ? ' missing' : '') + (tile.id === moveTileId ? ' selected' : ''),
      style: { '--tbg': look.bg, '--tfg': look.fg },
      draggable: opts.interactive && editMode ? 'true' : 'false'
    },
    progress,
    h('div', { class: 'tile-top' },
      count,
      h('span', { class: 'tag' }, look.styleName),
      h('span', { class: 'flags' }, flags.join(' '))
    ),
    h('div', { class: 'tile-title', style: { fontSize: look.fontSize + 'px', fontWeight: look.bold ? '800' : '500' } },
      tile.title || '(ohne Titel)',
      tile.subtitle ? h('span', { class: 'tile-sub' }, tile.subtitle) : null
    ),
    h('div', { class: 'tile-bottom' },
      playBtn,
      isMissing ? h('span', { class: 'missing-note' }, 'Datei fehlt') : (!tile.file ? h('span', { class: 'missing-note' }, 'keine Datei') : null),
      time
    ),
    line);

    if (opts.interactive) {
      bindPress(el, {
        tap: () => onTileTap(opts.tab, tile),
        long: (x, y) => openTileMenu(opts.tab, tile, x, y)
      });
      el.addEventListener('dragstart', (e) => {
        if (!editMode) { e.preventDefault(); return; }
        e.dataTransfer.setData('text/edj-tile', tile.id);
        e.dataTransfer.effectAllowed = 'move';
      });
    }
    return { el, progress, line, time, count, play: playBtn, tile };
  }

  /** Tippen / Klicken / langes Drücken / Rechtsklick – einheitlich für Touch & Maus */
  function bindPress(el, handlers) {
    let timer = null, startX = 0, startY = 0, long = false, moved = false, fired = false, active = false;
    el.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      active = true; long = false; moved = false; fired = false;
      startX = e.clientX; startY = e.clientY;
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (!active || moved) return;
        long = true;
        handlers.long && handlers.long(startX, startY);
      }, cfg.settings.longPressMs);
      if (cfg.settings.triggerOn === 'down' && !editMode && !moveTileId) {
        fired = true;
        handlers.tap();
      }
    });
    el.addEventListener('pointermove', (e) => {
      if (!active) return;
      if (Math.abs(e.clientX - startX) > 14 || Math.abs(e.clientY - startY) > 14) { moved = true; clearTimeout(timer); }
    });
    el.addEventListener('pointerup', (e) => {
      if (!active) return;
      active = false;
      clearTimeout(timer);
      if (moveTileId) return; // Slot-Handler übernimmt (Ziel im Verschiebe-Modus)
      if (!long && !moved && !fired) handlers.tap();
      e.stopPropagation();
    });
    el.addEventListener('pointercancel', () => { active = false; clearTimeout(timer); });
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!long) handlers.long && handlers.long(e.clientX, e.clientY);
    });
  }

  function bindSlot(slotEl, tab, slot) {
    // Tippen auf Slot (leer oder im Verschiebe-Modus)
    slotEl.addEventListener('pointerup', (e) => {
      if (moveTileId) {
        e.stopPropagation();
        const ok = M.moveTile(tab, moveTileId, slot) || moveTileToTab(moveTileId, tab, slot, true);
        if (ok) { persist(); }
        moveTileId = null;
        renderAll();
        return;
      }
      if (!slotEl.classList.contains('empty')) return;
      if (editMode) addViaPicker(tab, slot);
    });
    slotEl.addEventListener('contextmenu', (e) => {
      if (!slotEl.classList.contains('empty')) return;
      e.preventDefault();
      showMenu(e.clientX, e.clientY, 'Leeres Feld', [
        { icon: '♪', label: 'Audiodatei(en) hinzufügen …', fn: () => addViaPicker(tab, slot) }
      ]);
    });
    // Kacheln (Maus) umsortieren
    slotEl.addEventListener('dragover', (e) => {
      const types = Array.from(e.dataTransfer.types);
      if (types.includes('text/edj-tile') || types.includes('Files')) {
        e.preventDefault();
        slotEl.classList.add('drag-over');
      }
    });
    slotEl.addEventListener('dragleave', () => slotEl.classList.remove('drag-over'));
    slotEl.addEventListener('drop', (e) => {
      slotEl.classList.remove('drag-over');
      const tileId = e.dataTransfer.getData('text/edj-tile');
      if (tileId) {
        e.preventDefault();
        e.stopPropagation();
        if (!M.moveTile(tab, tileId, slot)) moveTileToTab(tileId, tab, slot);
        persist();
        renderGrid();
      }
      // Dateien behandelt der Stage-Handler
    });
  }

  // ================================================================ Wiedergabe

  function onTileTap(tab, tile) {
    if (moveTileId) return;
    if (editMode) { openTileEditor(tab, tile); return; }
    triggerTile(tile, 'master');
  }

  function triggerTile(tile, bus) {
    const s = cfg.settings;
    if (!tile.file) { toast('Für „' + tile.title + '“ ist keine Audiodatei hinterlegt.', 'err'); return; }
    const running = A.voicesForTile(tile.id, bus).filter((v) => v.state !== 'fading');

    if (bus === 'cue') {
      if (running.length) { A.stopTile(tile.id, true, 'cue'); return; }
      A.stopBus('cue', true, 150);
    } else {
      if (running.length) {
        if (s.retrigger === 'stop') { A.stopTile(tile.id, true, 'master'); return; }
        running.forEach((v) => A.stop(v.id, true, 120));
      }
      if (s.playMode === 'exclusive') A.stopBus('master', true);
    }

    A.play(tile, {
      bus,
      fadeIn: fadeInOf(tile),
      fadeOut: fadeOutOf(tile),
      volume: tile.volume,
      startAt: tile.startAt,
      loop: tile.loop
    });

    if (bus === 'master') {
      tile.playCount++;
      persist();
      const te = tileEls.get(tile.id);
      if (te) { te.count.textContent = tile.playCount + '×'; te.count.classList.remove('zero'); }
    }
  }

  function onVoiceChange() {
    updateTileStates();
    renderNowPlaying();
    // Punkte an den Reitern aktualisieren
    document.querySelectorAll('#tabs .tab').forEach((b, i) => {
      const tab = cfg.tabs[i];
      if (!tab) return;
      const has = !!b.querySelector('.dot');
      const should = tabIsPlaying(tab);
      if (has !== should) renderTabs();
    });
  }

  function updateTileStates() {
    tileEls.forEach((t, id) => {
      const vs = A.voicesForTile(id);
      const master = vs.filter((v) => v.bus === 'master');
      const playing = master.some((v) => v.state !== 'fading');
      const fading = !playing && master.some((v) => v.state === 'fading');
      t.el.classList.toggle('playing', playing);
      t.el.classList.toggle('fading', fading);
      t.el.classList.toggle('cueing', vs.some((v) => v.bus === 'cue'));
      t.play.textContent = playing || fading ? '■' : '▶';
      if (!master.length) {
        t.progress.style.width = '0';
        t.line.style.width = '0';
        t.time.textContent = t.tile.duration ? fmtTime(t.tile.duration) : '';
      }
    });
  }

  function voiceProgress(v) {
    const a = v.audio;
    const dur = Number.isFinite(a.duration) && a.duration > 0 ? a.duration : 0;
    const cur = a.currentTime || 0;
    return { dur, cur, pct: dur ? Math.min(1, cur / dur) : 0, rem: dur ? Math.max(0, dur - cur) : 0 };
  }

  function updateProgress() {
    const showRem = cfg.settings.showRemaining;
    A.voices.forEach((v) => {
      const p = voiceProgress(v);
      const te = v.bus === 'master' ? tileEls.get(v.tileId) : null;
      if (te) {
        te.progress.style.width = (p.pct * 100).toFixed(2) + '%';
        te.line.style.width = (p.pct * 100).toFixed(2) + '%';
        if (p.dur) te.time.textContent = showRem ? '−' + fmtTime(p.rem) : fmtTime(p.cur);
      }
      const np = npEls.get(v.id);
      if (np) {
        np.bar.style.width = (p.pct * 100).toFixed(2) + '%';
        np.time.textContent = p.dur ? (showRem ? '−' + fmtTime(p.rem) : fmtTime(p.cur)) : '…';
      }
    });
  }

  function renderNowPlaying() {
    const box = $('#nowplaying');
    box.innerHTML = '';
    npEls = new Map();
    const list = Array.from(A.voices.values());
    if (!list.length) {
      box.appendChild(h('span', { class: 'idle' }, 'Bereit.'));
      return;
    }
    list.forEach((v) => {
      const found = findTile(v.tileId);
      const look = found ? M.resolveLook(cfg, found.tile) : { bg: '#333', fg: '#fff' };
      const bar = h('div', { class: 'np-bar' });
      const time = h('span', { class: 'np-time' }, '…');
      const el = h('div', {
        class: 'np' + (v.state === 'fading' ? ' fading' : ''),
        style: { '--npbg': look.bg, '--npfg': look.fg },
        title: found ? 'Reiter: ' + found.tab.name : ''
      },
      v.bus === 'cue' ? h('span', { class: 'np-bus' }, '🎧 Vorhören') : null,
      h('span', { class: 'np-title', onclick: () => found && selectTab(found.tab.id) }, v.title),
      time,
      h('button', {
        title: 'Ausblenden (nochmal = sofort aus)',
        onclick: () => A.stop(v.id, true)
      }, v.state === 'fading' ? '✕' : '■'),
      bar);
      npEls.set(v.id, { el, bar, time });
      box.appendChild(el);
    });
    updateProgress();
  }

  // ================================================================ Kacheln anlegen

  async function addViaPicker(tab, slot) {
    const paths = await api.pickAudio(true);
    if (!paths || !paths.length) return;
    const added = await addFiles(tab, paths, slot);
    if (added.length === 1) openTileEditor(tab, added[0]);
  }

  async function addFiles(tab, paths, startSlot) {
    const audio = paths.filter((p) => M.isAudioFile(p) || /^blob:/.test(p));
    if (audio.length < paths.length) toast((paths.length - audio.length) + ' Datei(en) übersprungen (kein unterstütztes Audioformat).', 'err');
    if (!audio.length) return [];
    const res = await api.importFiles(audio, cfg.settings.copyToLibrary);
    const ok = res.filter((r) => r.ok);
    res.filter((r) => !r.ok).forEach((r) => toast('Import fehlgeschlagen: ' + r.source + ' – ' + r.error, 'err', 6000));
    const slots = M.freeSlots(tab, startSlot || 0, ok.length);
    const styleId = (cfg.styles[0] || {}).id;
    const tiles = ok.map((r, i) => M.newTile(slots[i], {
      title: M.titleFromFileName(fileNames.get(r.path) || r.name),
      file: r.path,
      fileName: fileNames.get(r.path) || r.name,
      styleId
    }));
    tab.tiles.push(...tiles);
    tiles.forEach((t) => missing.delete(t.file));
    persist();
    renderGrid();
    if (tiles.length) toast(tiles.length + ' Jingle(s) hinzugefügt.', 'ok');
    // Dauer im Hintergrund ermitteln
    tiles.forEach(async (t) => {
      const d = await A.probeDuration(t.file);
      if (d < 0) toast('„' + t.fileName + '“ kann nicht gelesen werden (Format/Codec?).', 'err', 6000);
      t.duration = Math.max(0, d);
      const te = tileEls.get(t.id);
      if (te && !A.voicesForTile(t.id, 'master').length) te.time.textContent = t.duration ? fmtTime(t.duration) : '';
      persist();
    });
    return tiles;
  }

  function moveTileToTab(tileId, targetTab, slot, silent) {
    const found = findTile(tileId);
    if (!found) return false;
    if (found.tab.id === targetTab.id) {
      if (!silent) { moveTileId = null; renderAll(); }
      return slot != null ? M.moveTile(targetTab, tileId, slot) : false;
    }
    found.tab.tiles = found.tab.tiles.filter((t) => t.id !== tileId);
    found.tile.slot = slot != null && !targetTab.tiles.some((t) => t.slot === slot) ? slot : M.freeSlots(targetTab, 0, 1)[0];
    targetTab.tiles.push(found.tile);
    persist();
    if (!silent) {
      moveTileId = null;
      toast('„' + found.tile.title + '“ → ' + targetTab.name, 'ok');
      renderAll();
    }
    return true;
  }

  function duplicateTile(tab, tile) {
    const copy = M.newTile(M.freeSlots(tab, tile.slot + 1, 1)[0], Object.assign({}, tile, { id: undefined, playCount: 0, title: tile.title + ' (Kopie)' }));
    copy.id = M.uid('tile');
    tab.tiles.push(copy);
    persist();
    renderGrid();
  }

  async function deleteTile(tab, tile) {
    const ok = await confirmDialog('Kachel löschen?', '„' + tile.title + '“ wird aus dem Reiter „' + tab.name + '“ entfernt.', 'Löschen', true);
    if (!ok) return false;
    A.stopTile(tile.id, false);
    tab.tiles = tab.tiles.filter((t) => t.id !== tile.id);
    persist();
    renderGrid();
    return true;
  }

  async function resetCounters(tab) {
    if (cfg.settings.confirmReset) {
      const ok = await confirmDialog(
        tab ? 'Zähler zurücksetzen?' : 'Neues Spiel / Event starten?',
        tab ? 'Alle Abspielzähler im Reiter „' + tab.name + '“ werden auf 0 gesetzt.' : 'Alle Abspielzähler in allen Reitern werden auf 0 gesetzt.',
        'Zurücksetzen', false);
      if (!ok) return;
    }
    M.resetCounters(cfg, tab ? tab.id : null);
    persist();
    renderGrid();
    toast(tab ? 'Zähler im Reiter zurückgesetzt.' : 'Alle Zähler zurückgesetzt – viel Erfolg!', 'ok');
  }

  // ================================================================ Kontextmenü

  function closeMenus() { document.querySelectorAll('.menu').forEach((m) => m.remove()); }

  function showMenu(x, y, title, items) {
    closeMenus();
    const menu = h('div', { class: 'menu', role: 'menu' },
      title ? h('div', { class: 'menu-title' }, title) : null,
      items.filter(Boolean).map((it) => h('button', {
        class: it.danger ? 'danger' : '',
        onclick: (e) => { e.stopPropagation(); closeMenus(); it.fn(); }
      }, h('span', { class: 'mi' }, it.icon || ''), it.label))
    );
    document.body.appendChild(menu);
    const r = menu.getBoundingClientRect();
    menu.style.left = Math.max(8, Math.min(x, window.innerWidth - r.width - 8)) + 'px';
    menu.style.top = Math.max(8, Math.min(y, window.innerHeight - r.height - 8)) + 'px';
    setTimeout(() => {
      const off = (e) => {
        if (!menu.contains(e.target)) { closeMenus(); document.removeEventListener('pointerdown', off, true); }
      };
      document.addEventListener('pointerdown', off, true);
    }, 0);
  }

  function openTileMenu(tab, tile, x, y) {
    const playing = A.voicesForTile(tile.id, 'master').length > 0;
    const cueing = A.voicesForTile(tile.id, 'cue').length > 0;
    showMenu(x, y, tile.title, [
      { icon: playing ? '■' : '▶', label: playing ? 'Ausblenden' : 'Abspielen', fn: () => (playing ? A.stopTile(tile.id, true, 'master') : triggerTile(tile, 'master')) },
      { icon: '🎧', label: cueing ? 'Vorhören stoppen' : 'Vorhören (Kopfhörer)', fn: () => triggerTile(tile, 'cue') },
      { icon: '✎', label: 'Bearbeiten …', fn: () => openTileEditor(tab, tile) },
      { icon: '⇄', label: 'Verschieben …', fn: () => startMove(tile) },
      { icon: '⧉', label: 'Duplizieren', fn: () => duplicateTile(tab, tile) },
      { icon: '0', label: 'Zähler zurücksetzen', fn: () => { tile.playCount = 0; persist(); renderGrid(); } },
      { icon: '🗑', label: 'Löschen', danger: true, fn: () => deleteTile(tab, tile) }
    ]);
  }

  function startMove(tile) {
    moveTileId = tile.id;
    renderAll();
  }

  // ================================================================ Dialoge

  function openDialog(opts) {
    const root = $('#overlay-root');
    const body = h('div', { class: 'dialog-body' });
    const foot = h('div', { class: 'dialog-foot' });
    const dlg = h('div', { class: 'dialog ' + (opts.size || ''), role: 'dialog', 'aria-modal': 'true', dataset: { kind: opts.kind || '' } },
      h('div', { class: 'dialog-head' },
        h('h2', null, opts.title),
        h('button', { class: 'close-x', title: 'Schließen', onclick: () => close() }, '✕')),
      body, foot);
    const overlay = h('div', { class: 'overlay' }, dlg);
    overlay.addEventListener('pointerdown', (e) => { if (e.target === overlay && opts.closeOnBackdrop !== false) overlay._down = true; });
    overlay.addEventListener('pointerup', (e) => { if (e.target === overlay && overlay._down) close(); overlay._down = false; });
    function close(result) {
      if (overlay._closed) return;
      overlay._closed = true;
      overlay.remove();
      opts.onClose && opts.onClose(result);
    }
    overlay._close = close;
    root.appendChild(overlay);
    return { dlg, body, foot, close };
  }

  function topDialog() {
    const all = document.querySelectorAll('#overlay-root .overlay');
    return all.length ? all[all.length - 1] : null;
  }

  function confirmDialog(title, text, okLabel, danger) {
    return new Promise((resolve) => {
      let result = false;
      const d = openDialog({ title, size: 'narrow', onClose: () => resolve(result) });
      d.body.appendChild(h('p', { style: { fontSize: '17px', lineHeight: '1.5', margin: '4px 0' } }, text));
      append(d.foot, [
        h('div', { class: 'spacer' }),
        h('button', { class: 'btn', onclick: () => d.close() }, 'Abbrechen'),
        h('button', { class: 'btn ' + (danger ? 'danger' : 'primary'), onclick: () => { result = true; d.close(); } }, okLabel || 'OK')
      ]);
    });
  }

  // ---------- Bausteine für Formulare

  function field(label, control, hint) {
    return h('div', { class: 'field' }, h('label', { class: 'lbl' }, label), control, hint ? h('p', { class: 'hint' }, hint) : null);
  }

  function textInput(value, onInput, placeholder) {
    return h('input', { class: 'inp', type: 'text', value: value || '', placeholder: placeholder || '', oninput: (e) => onInput(e.target.value) });
  }

  /** Zahl mit −/+ und Schieberegler (touchfreundlich) */
  function stepper(o) {
    let value = o.value;
    const val = h('span', { class: 'val' });
    const range = h('input', { type: 'range', min: o.min, max: o.max, step: o.step });
    const set = (v, fromUser) => {
      v = Math.min(o.max, Math.max(o.min, Math.round(v / o.step) * o.step));
      value = Number(v.toFixed(4));
      range.value = value;
      val.textContent = o.format ? o.format(value) : value;
      if (fromUser) o.onChange(value);
    };
    range.addEventListener('input', () => set(Number(range.value), true));
    const minus = h('button', { type: 'button', onclick: () => set(value - (o.bigStep || o.step), true) }, '−');
    const plus = h('button', { type: 'button', onclick: () => set(value + (o.bigStep || o.step), true) }, '+');
    const el = h('div', { class: 'stepper' }, minus, val, plus, o.noRange ? null : range);
    el._set = (v) => set(v, false);
    el._get = () => value;
    el._disable = (d) => [minus, plus, range].forEach((x) => (x.disabled = d));
    set(value, false);
    return el;
  }

  /** Optionaler Wert: Checkbox "Standard" + Stepper */
  function optionalStepper(o) {
    const isDefault = o.value == null;
    const st = stepper(Object.assign({}, o, { value: isDefault ? o.defaultValue : o.value, onChange: (v) => o.onChange(v) }));
    const cb = h('input', { type: 'checkbox', checked: isDefault });
    const lbl = h('label', { class: 'check' }, cb, o.defaultLabel || 'Standard verwenden');
    cb.addEventListener('change', () => {
      st._disable(cb.checked);
      if (cb.checked) { st._set(o.defaultValue); o.onChange(null); } else { o.onChange(st._get()); }
    });
    st._disable(isDefault);
    return h('div', null, lbl, st);
  }

  function segmented(options, value, onChange) {
    const el = h('div', { class: 'seg' });
    options.forEach(([val, label]) => {
      const b = h('button', { type: 'button', class: val === value ? 'sel' : '' }, label);
      b.addEventListener('click', () => {
        el.querySelectorAll('button').forEach((x) => x.classList.remove('sel'));
        b.classList.add('sel');
        onChange(val);
      });
      el.appendChild(b);
    });
    return el;
  }

  function colorPicker(value, onChange, allowNone) {
    const wrap = h('div', { class: 'swatches' });
    const input = h('input', { type: 'color', value: value || '#1d5fd1', title: 'Eigene Farbe' });
    const draw = (cur) => {
      wrap.querySelectorAll('.swatch').forEach((s) => s.classList.toggle('sel', s.dataset.c === cur));
    };
    PALETTE.forEach((c) => {
      wrap.appendChild(h('button', {
        type: 'button', class: 'swatch', style: { background: c }, dataset: { c }, title: c,
        onclick: () => { input.value = c; draw(c); onChange(c); }
      }));
    });
    input.addEventListener('input', () => { draw(input.value); onChange(input.value); });
    wrap.appendChild(input);
    draw(value);
    wrap._set = (c) => { input.value = c || '#1d5fd1'; draw(c); };
    return wrap;
  }

  function checkbox(label, checked, onChange) {
    const cb = h('input', { type: 'checkbox', checked: !!checked });
    cb.addEventListener('change', () => onChange(cb.checked));
    return h('label', { class: 'check' }, cb, label);
  }

  // ---------- Reiter-Dialog

  function openTabEditor(tab) {
    const isNew = !tab;
    const draft = isNew ? M.newTab('Neuer Reiter', PALETTE[cfg.tabs.length % PALETTE.length], 4, 3) : JSON.parse(JSON.stringify(tab));
    const d = openDialog({ title: isNew ? 'Neuer Reiter' : 'Reiter bearbeiten', kind: 'tab' });

    const prev = h('div', { class: 'matrix-prev' });
    const overflowNote = h('p', { class: 'hint' });
    const drawPrev = () => {
      prev.innerHTML = '';
      prev.style.gridTemplateColumns = 'repeat(' + draft.cols + ', 1fr)';
      prev.style.gridTemplateRows = 'repeat(' + draft.rows + ', 1fr)';
      for (let i = 0; i < draft.cols * draft.rows; i++) prev.appendChild(h('div', { style: { background: i < draft.tiles.length ? draft.color : '' } }));
      const capacity = draft.cols * draft.rows;
      const outside = draft.tiles.filter((t) => t.slot >= capacity).length;
      overflowNote.textContent = capacity + ' Felder' + (outside ? ' – ' + outside + ' Kachel(n) liegen außerhalb, dafür werden automatisch weitere Zeilen angezeigt (scrollbar).' : '.');
    };

    append(d.body, [
      field('Name', textInput(draft.name, (v) => (draft.name = v), 'z. B. Während des Spiels')),
      field('Farbe', colorPicker(draft.color, (c) => { draft.color = c; drawPrev(); })),
      h('div', { class: 'section' },
        h('h3', null, 'Kachel-Matrix'),
        h('div', { class: 'row' },
          h('div', null,
            field('Spalten', stepper({ value: draft.cols, min: 1, max: 12, step: 1, noRange: true, onChange: (v) => { draft.cols = v; drawPrev(); } })),
            field('Zeilen', stepper({ value: draft.rows, min: 1, max: 12, step: 1, noRange: true, onChange: (v) => { draft.rows = v; drawPrev(); } }))),
          prev),
        overflowNote)
    ]);
    if (!isNew) {
      const idx = cfg.tabs.findIndex((t) => t.id === tab.id);
      append(d.body, h('div', { class: 'section' },
        h('h3', null, 'Position & Zähler'),
        h('div', { class: 'row' },
          h('button', { class: 'btn', disabled: idx === 0, onclick: () => { moveTab(idx, -1); d.close(); } }, '◀ Nach links'),
          h('button', { class: 'btn', disabled: idx === cfg.tabs.length - 1, onclick: () => { moveTab(idx, 1); d.close(); } }, 'Nach rechts ▶'),
          h('button', { class: 'btn', onclick: () => { d.close(); resetCounters(tab); } }, '↺ Zähler dieses Reiters zurücksetzen'))));
    }
    drawPrev();

    append(d.foot, [
      !isNew ? h('button', {
        class: 'btn danger',
        disabled: cfg.tabs.length <= 1,
        title: cfg.tabs.length <= 1 ? 'Der letzte Reiter kann nicht gelöscht werden' : '',
        onclick: async () => {
          const ok = await confirmDialog('Reiter löschen?', '„' + tab.name + '“ mit ' + tab.tiles.length + ' Kachel(n) wird gelöscht.', 'Löschen', true);
          if (!ok) return;
          tab.tiles.forEach((t) => A.stopTile(t.id, false));
          cfg.tabs = cfg.tabs.filter((t) => t.id !== tab.id);
          if (cfg.activeTabId === tab.id) cfg.activeTabId = cfg.tabs[0].id;
          persist(); d.close(); renderAll();
        }
      }, 'Reiter löschen') : null,
      h('div', { class: 'spacer' }),
      h('button', { class: 'btn', onclick: () => d.close() }, 'Abbrechen'),
      h('button', {
        class: 'btn primary',
        onclick: () => {
          draft.name = draft.name.trim() || 'Reiter';
          if (isNew) {
            cfg.tabs.push(M.normalizeTab(draft));
            cfg.activeTabId = draft.id;
          } else {
            Object.assign(tab, { name: draft.name, color: draft.color, cols: draft.cols, rows: draft.rows });
          }
          persist(); d.close(); renderAll();
        }
      }, isNew ? 'Anlegen' : 'Übernehmen')
    ]);
  }

  function moveTab(idx, dir) {
    const [t] = cfg.tabs.splice(idx, 1);
    cfg.tabs.splice(idx + dir, 0, t);
    persist();
    renderTabs();
  }

  // ---------- Kachel-Dialog

  function openTileEditor(tab, tile) {
    const draft = JSON.parse(JSON.stringify(tile));
    const s = cfg.settings;
    const d = openDialog({ title: 'Kachel bearbeiten', kind: 'tile', size: 'wide' });

    const previewSlot = h('div', { class: 'slot' });
    const drawPreview = () => {
      previewSlot.innerHTML = '';
      previewSlot.appendChild(buildTile(draft, { interactive: false }).el);
    };

    const fileName = h('div', { class: 'fname' });
    const drawFile = () => {
      fileName.innerHTML = '';
      append(fileName, [
        draft.file ? (draft.fileName || draft.file.split(/[\\/]/).pop()) : 'Keine Datei gewählt',
        h('small', null, draft.file ? (draft.duration ? 'Länge ' + fmtTime(draft.duration) + ' · ' : '') + draft.file : 'MP3, WAV, OGG, FLAC, M4A/AAC, OPUS …')
      ]);
    };

    const styleBox = h('div', { class: 'style-pick' });
    const drawStyles = () => {
      styleBox.innerHTML = '';
      cfg.styles.forEach((st) => {
        styleBox.appendChild(h('button', {
          type: 'button',
          class: 'style-chip' + (draft.styleId === st.id ? ' sel' : ''),
          style: { background: st.bg, color: st.fg },
          onclick: () => { draft.styleId = st.id; drawStyles(); drawPreview(); }
        }, st.name));
      });
    };

    const look = M.resolveLook(cfg, Object.assign({}, draft, { bg: null, fg: null, fontSize: null }));

    // Farb-Überschreibungen
    const bgPick = colorPicker(draft.bg || look.bg, (c) => { draft.bg = c; bgCb.querySelector('input').checked = true; drawPreview(); });
    const fgPick = colorPicker(draft.fg || look.fg, (c) => { draft.fg = c; fgCb.querySelector('input').checked = true; drawPreview(); });
    const bgCb = checkbox('Eigene Hintergrundfarbe', !!draft.bg, (on) => { draft.bg = on ? bgPick.querySelector('input[type=color]').value : null; drawPreview(); });
    const fgCb = checkbox('Eigene Schriftfarbe', !!draft.fg, (on) => { draft.fg = on ? fgPick.querySelector('input[type=color]').value : null; drawPreview(); });

    const curStyle = () => cfg.styles.find((x) => x.id === draft.styleId) || cfg.styles[0];

    append(d.body, h('div', { class: 'grid2' },
      h('div', null,
        h('div', { class: 'preview-wrap' }, previewSlot),
        field('Titel', textInput(draft.title, (v) => { draft.title = v; drawPreview(); }, 'z. B. Satzbeginn')),
        field('Untertitel (optional)', textInput(draft.subtitle, (v) => { draft.subtitle = v; drawPreview(); }, 'z. B. Interpret, Hinweis')),
        field('Audiodatei', h('div', { class: 'file-box' },
          fileName,
          h('button', {
            class: 'small-btn', type: 'button',
            onclick: async () => {
              const p = await api.pickAudio(false);
              if (!p || !p.length) return;
              const [r] = await api.importFiles(p, s.copyToLibrary);
              if (!r || !r.ok) { toast('Import fehlgeschlagen: ' + (r && r.error), 'err'); return; }
              draft.file = r.path;
              draft.fileName = fileNames.get(r.path) || r.name;
              if (!draft.title || draft.title === 'Jingle' || draft.title === M.titleFromFileName(tile.fileName)) draft.title = M.titleFromFileName(draft.fileName);
              const dur = await A.probeDuration(draft.file);
              draft.duration = Math.max(0, dur);
              missing.delete(draft.file);
              drawFile(); drawPreview();
            }
          }, 'Datei wählen …'),
          h('button', {
            class: 'small-btn', type: 'button', title: 'Auf dem Vorhör-Ausgang abspielen',
            onclick: () => { if (draft.file) triggerTile(draft, 'cue'); }
          }, '🎧 Vorhören')
        )),
        field('Eigenschaft (Kachel-Stil)', styleBox, 'Stile legst du in den Einstellungen an (z. B. Satzbeginn = blau, Auszeiten = grün).'),
        h('div', { class: 'section' },
          h('h3', null, 'Aussehen anpassen'),
          bgCb, bgPick, h('div', { style: { height: '10px' } }), fgCb, fgPick, h('div', { style: { height: '10px' } }),
          field('Schriftgröße', optionalStepper({
            value: draft.fontSize, defaultValue: curStyle().fontSize, min: 10, max: 96, step: 1, bigStep: 2,
            defaultLabel: 'Schriftgröße vom Stil', format: (v) => v + ' px',
            onChange: (v) => { draft.fontSize = v; drawPreview(); }
          })))
      ),
      h('div', null,
        h('div', { class: 'section' },
          h('h3', null, 'Wiedergabe'),
          field('Fade-In', optionalStepper({
            value: draft.fadeIn, defaultValue: s.defaultFadeIn, min: 0, max: 10000, step: 50, bigStep: 100,
            defaultLabel: 'Standard (' + s.defaultFadeIn + ' ms)', format: (v) => v + ' ms',
            onChange: (v) => (draft.fadeIn = v)
          })),
          field('Fade-Out beim Stoppen', optionalStepper({
            value: draft.fadeOut, defaultValue: s.defaultFadeOut, min: 0, max: 10000, step: 50, bigStep: 250,
            defaultLabel: 'Standard (' + s.defaultFadeOut + ' ms)', format: (v) => v + ' ms',
            onChange: (v) => (draft.fadeOut = v)
          })),
          field('Lautstärke', stepper({ value: Math.round(draft.volume * 100), min: 0, max: 100, step: 1, bigStep: 5, format: (v) => v + ' %', onChange: (v) => (draft.volume = v / 100) })),
          field('Start bei', stepper({ value: draft.startAt, min: 0, max: Math.max(60, Math.ceil(draft.duration || 0)), step: 0.5, format: (v) => v.toFixed(1) + ' s', onChange: (v) => (draft.startAt = v) }), 'Überspringt Stille am Anfang der Datei.'),
          checkbox('Endlosschleife (Loop) – läuft, bis gestoppt wird', draft.loop, (v) => { draft.loop = v; drawPreview(); })
        ),
        h('div', { class: 'section' },
          h('h3', null, 'Zähler'),
          h('div', { class: 'row' },
            stepper({ value: draft.playCount, min: 0, max: 9999, step: 1, noRange: true, format: (v) => v + '×', onChange: (v) => { draft.playCount = v; drawPreview(); } }))
        ),
        h('div', { class: 'section' },
          h('h3', null, 'Ablage'),
          h('div', { class: 'row' },
            h('select', {
              class: 'inp', style: { maxWidth: '320px' },
              onchange: (e) => (draft._targetTab = e.target.value)
            }, cfg.tabs.map((t) => h('option', { value: t.id, selected: t.id === tab.id }, t.name === tab.name && t.id === tab.id ? t.name + ' (aktuell)' : t.name)))),
          h('p', { class: 'hint' }, 'Reiter wählen, um die Kachel beim Speichern dorthin zu verschieben.'),
          h('div', { class: 'row' },
            h('button', { class: 'small-btn', type: 'button', onclick: () => { d.close(); startMove(tile); } }, '⇄ Position im Raster ändern'),
            h('button', { class: 'small-btn', type: 'button', onclick: () => { d.close(); duplicateTile(tab, tile); } }, '⧉ Duplizieren'))
        )
      )
    ));

    drawFile(); drawStyles(); drawPreview();

    append(d.foot, [
      h('button', { class: 'btn danger', onclick: async () => { if (await deleteTile(tab, tile)) d.close(); } }, 'Löschen'),
      h('div', { class: 'spacer' }),
      h('button', { class: 'btn', onclick: () => { A.stopTile(draft.id, true, 'cue'); d.close(); } }, 'Abbrechen'),
      h('button', {
        class: 'btn primary',
        onclick: () => {
          A.stopTile(draft.id, true, 'cue');
          const target = draft._targetTab;
          delete draft._targetTab;
          Object.assign(tile, M.normalizeTile(draft));
          if (target && target !== tab.id) {
            const tt = cfg.tabs.find((t) => t.id === target);
            if (tt) moveTileToTab(tile.id, tt, null, true);
          }
          persist(); d.close(); renderAll();
        }
      }, 'Speichern')
    ]);
  }

  // ---------- Einstellungen

  function openSettings() {
    const s = cfg.settings;
    const d = openDialog({ title: 'Einstellungen', kind: 'settings', size: 'wide', onClose: () => renderAll() });

    // --- Audio-Ausgabe
    const masterSel = h('select', { class: 'inp' });
    const cueSel = h('select', { class: 'inp' });
    const fillDevices = () => {
      masterSel.innerHTML = '';
      cueSel.innerHTML = '';
      const has = (id) => devices.some((x) => x.deviceId === id);
      if (!has('default')) masterSel.appendChild(h('option', { value: 'default' }, 'Windows-Standardgerät'));
      cueSel.appendChild(h('option', { value: '' }, '— wie Master —'));
      devices.forEach((dv) => {
        masterSel.appendChild(h('option', { value: dv.deviceId }, dv.label));
        cueSel.appendChild(h('option', { value: dv.deviceId }, dv.label));
      });
      if (s.masterDeviceId !== 'default' && !has(s.masterDeviceId)) masterSel.appendChild(h('option', { value: s.masterDeviceId }, (s.masterDeviceLabel || 'Gerät') + ' (nicht verbunden)'));
      if (s.cueDeviceId && !has(s.cueDeviceId)) cueSel.appendChild(h('option', { value: s.cueDeviceId }, (s.cueDeviceLabel || 'Gerät') + ' (nicht verbunden)'));
      masterSel.value = s.masterDeviceId || 'default';
      cueSel.value = s.cueDeviceId || '';
    };
    d.dlg._refreshDevices = fillDevices;
    masterSel.addEventListener('change', async () => {
      s.masterDeviceId = masterSel.value;
      s.masterDeviceLabel = (devices.find((x) => x.deviceId === masterSel.value) || {}).label || '';
      await A.setSink('master', s.masterDeviceId);
      persist(); renderOutputInfo(); renderGrid();
    });
    cueSel.addEventListener('change', async () => {
      s.cueDeviceId = cueSel.value;
      s.cueDeviceLabel = (devices.find((x) => x.deviceId === cueSel.value) || {}).label || '';
      await A.setSink('cue', s.cueDeviceId);
      persist(); renderOutputInfo();
    });
    fillDevices();

    // --- Stile
    const styleList = h('div');
    const drawStyleList = () => {
      styleList.innerHTML = '';
      cfg.styles.forEach((st) => {
        const chip = h('div', { class: 'chip', style: { background: st.bg, color: st.fg, fontWeight: st.bold ? '800' : '500' } }, st.name || 'Stil');
        const upd = () => {
          chip.textContent = st.name || 'Stil';
          chip.style.background = st.bg; chip.style.color = st.fg; chip.style.fontWeight = st.bold ? '800' : '500';
          persist(); renderGrid();
        };
        const used = cfg.tabs.reduce((n, t) => n + t.tiles.filter((x) => x.styleId === st.id).length, 0);
        styleList.appendChild(h('div', { class: 'style-row' },
          chip,
          h('input', { class: 'inp', type: 'text', value: st.name, oninput: (e) => { st.name = e.target.value; upd(); } }),
          h('label', { title: 'Hintergrundfarbe' }, h('input', { type: 'color', value: st.bg, oninput: (e) => { st.bg = e.target.value; upd(); } })),
          h('label', { title: 'Schriftfarbe' }, h('input', { type: 'color', value: st.fg, oninput: (e) => { st.fg = e.target.value; upd(); } })),
          stepper({ value: st.fontSize, min: 10, max: 96, step: 1, bigStep: 2, noRange: true, format: (v) => v + ' px', onChange: (v) => { st.fontSize = v; upd(); } }),
          checkbox('fett', st.bold, (v) => { st.bold = v; upd(); }),
          h('button', {
            class: 'small-btn', title: used ? used + ' Kachel(n) nutzen diesen Stil' : 'Stil löschen', disabled: cfg.styles.length <= 1,
            onclick: async () => {
              if (used && !(await confirmDialog('Stil löschen?', used + ' Kachel(n) nutzen „' + st.name + '“ und erhalten danach den ersten Stil.', 'Löschen', true))) return;
              cfg.styles = cfg.styles.filter((x) => x.id !== st.id);
              cfg.tabs.forEach((t) => t.tiles.forEach((x) => { if (x.styleId === st.id) x.styleId = cfg.styles[0].id; }));
              persist(); drawStyleList(); renderGrid();
            }
          }, '🗑')
        ));
      });
    };
    drawStyleList();

    const libInfo = h('p', { class: 'hint' }, 'Datenordner: ' + (info.dataDir || '–') + (info.portable ? ' (portabel)' : ''));

    append(d.body, [
      h('div', { class: 'section' },
        h('h3', null, 'Audio-Ausgabe'),
        h('div', { class: 'grid2' },
          h('div', null,
            field('Master-Ausgang (Publikum / Mischpult / Bluetooth-Box)', h('div', { class: 'row' }, masterSel, h('button', { class: 'small-btn', onclick: () => A.testTone('master') }, '♪ Test'))),
            field('Master-Lautstärke', stepper({ value: Math.round(s.masterVolume * 100), min: 0, max: 100, step: 1, bigStep: 5, format: (v) => v + ' %', onChange: (v) => { s.masterVolume = v / 100; A.setBusVolume('master', s.masterVolume); persist(); } }))),
          h('div', null,
            field('Vorhör-Ausgang (Kopfhörer)', h('div', { class: 'row' }, cueSel, h('button', { class: 'small-btn', onclick: () => A.testTone('cue') }, '♪ Test'))),
            field('Vorhör-Lautstärke', stepper({ value: Math.round(s.cueVolume * 100), min: 0, max: 100, step: 1, bigStep: 5, format: (v) => v + ' %', onChange: (v) => { s.cueVolume = v / 100; A.setBusVolume('cue', s.cueVolume); persist(); } })))),
        h('div', { class: 'row' }, h('button', { class: 'small-btn', onclick: () => refreshDevices(false).then(() => toast(devices.length + ' Ausgabegerät(e) gefunden.', 'ok')) }, '⟳ Geräteliste aktualisieren')),
        h('p', { class: 'hint' }, 'Angezeigt werden alle Wiedergabegeräte, die Windows kennt: Lautsprecher/Klinke, USB-Soundkarten (z. B. 2 Ausgänge), HDMI, Bluetooth-Geräte usw. Vorhören: Kachel lange drücken bzw. Rechtsklick → „Vorhören“. Hinweis: Bluetooth hat systembedingt ca. 0,1–0,3 s Verzögerung – für Live-Einsätze ist ein Kabel/USB-Interface zuverlässiger.')),

      h('div', { class: 'section' },
        h('h3', null, 'Wiedergabe'),
        h('div', { class: 'grid2' },
          h('div', null,
            field('Standard Fade-In', stepper({ value: s.defaultFadeIn, min: 0, max: 5000, step: 50, bigStep: 100, format: (v) => v + ' ms', onChange: (v) => { s.defaultFadeIn = v; persist(); } })),
            field('Standard Fade-Out (beim Stoppen)', stepper({ value: s.defaultFadeOut, min: 0, max: 10000, step: 50, bigStep: 250, format: (v) => v + ' ms', onChange: (v) => { s.defaultFadeOut = v; persist(); } }))),
          h('div', null,
            field('Neuer Jingle, während einer läuft', segmented([['exclusive', 'Laufenden ausblenden'], ['overlap', 'Gleichzeitig spielen']], s.playMode, (v) => { s.playMode = v; persist(); })),
            field('Laufende Kachel erneut antippen', segmented([['stop', 'Ausblenden'], ['restart', 'Neu starten']], s.retrigger, (v) => { s.retrigger = v; persist(); })),
            field('Auslösen', segmented([['up', 'Beim Loslassen'], ['down', 'Sofort beim Berühren']], s.triggerOn, (v) => { s.triggerOn = v; persist(); }),
              '„Sofort“ ist am schnellsten; das Kontextmenü gibt es dann per Rechtsklick oder im Bearbeitungsmodus.'),
            field('Langes Drücken (Kontextmenü)', stepper({ value: s.longPressMs, min: 250, max: 2000, step: 50, format: (v) => v + ' ms', onChange: (v) => { s.longPressMs = v; persist(); } }))))),

      h('div', { class: 'section' },
        h('h3', null, 'Kachel-Stile (Eigenschaften)'),
        h('p', { class: 'hint', style: { marginBottom: '8px' } }, 'Vorlagen für Farben und Schrift – z. B. Satzbeginn blau, Auszeiten grün, Ironie Gegner gelb. Jede Kachel bekommt einen Stil und kann ihn einzeln überschreiben.'),
        styleList,
        h('div', { class: 'row', style: { marginTop: '10px' } },
          h('button', { class: 'small-btn', onclick: () => { cfg.styles.push(M.normalizeStyle({ id: M.uid('st'), name: 'Neuer Stil', bg: PALETTE[cfg.styles.length % PALETTE.length], fg: '#ffffff', fontSize: 22 })); persist(); drawStyleList(); } }, '+ Stil hinzufügen'))),

      h('div', { class: 'section' },
        h('h3', null, 'Darstellung'),
        h('div', { class: 'grid2' },
          h('div', null,
            field('Schriftgröße aller Kacheln', stepper({ value: Math.round(s.tileScale * 100), min: 50, max: 250, step: 5, format: (v) => v + ' %', onChange: (v) => { s.tileScale = v / 100; persist(); renderGrid(); } }))),
          h('div', null,
            checkbox('Restzeit statt Laufzeit anzeigen', s.showRemaining, (v) => { s.showRemaining = v; persist(); }),
            checkbox('Zähler-Reset bestätigen lassen', s.confirmReset, (v) => { s.confirmReset = v; persist(); })))),

      h('div', { class: 'section' },
        h('h3', null, 'Daten & Sicherung'),
        checkbox('Audiodateien beim Hinzufügen in die EventDJ-Bibliothek kopieren (empfohlen)', s.copyToLibrary, (v) => { s.copyToLibrary = v; persist(); }),
        libInfo,
        h('div', { class: 'row', style: { marginTop: '10px' } },
          h('button', { class: 'small-btn', onclick: exportSet }, '⤓ Set exportieren …'),
          h('button', { class: 'small-btn', onclick: () => importSet() }, '⤒ Set importieren …'),
          h('button', { class: 'small-btn', onclick: cleanupLibrary }, '🧹 Bibliothek aufräumen'),
          h('button', { class: 'small-btn', onclick: () => api.openDataDir() }, '📁 Datenordner öffnen')),
        h('p', { class: 'hint' }, 'Ein Set (.edjset) enthält alle Reiter, Kacheln, Stile und Audiodateien – ideal als Sicherung oder zum Übertragen auf einen anderen PC.')),

      h('div', { class: 'section' },
        h('h3', null, 'Bedienung & Info'),
        h('p', { class: 'hint' },
          'Tastatur: ', h('span', { class: 'kbd' }, 'Esc'), ' alles ausblenden · ', h('span', { class: 'kbd' }, 'Umschalt+Esc'), ' sofort stoppen · ',
          h('span', { class: 'kbd' }, 'Strg+1…9'), ' Reiter wechseln · ', h('span', { class: 'kbd' }, 'Strg+E'), ' Bearbeiten · ', h('span', { class: 'kbd' }, 'F11'), ' Vollbild'),
        h('p', { class: 'hint' }, 'EventDJ ' + (info.version || '') + (info.electron ? ' · Electron ' + info.electron : '') + ' · ',
          h('a', { href: '#', style: { color: 'var(--accent)' }, onclick: (e) => { e.preventDefault(); api.openUrl('https://github.com/stadtkindd/EventDJsw'); } }, 'github.com/stadtkindd/EventDJsw')))
    ]);

    append(d.foot, [h('div', { class: 'spacer' }), h('button', { class: 'btn primary', onclick: () => d.close() }, 'Fertig')]);
  }

  async function exportSet() {
    const r = await api.exportSet(cfg);
    if (r.canceled) return;
    if (r.ok) toast('Set gespeichert (' + r.files + ' Audiodateien' + (r.missing ? ', ' + r.missing + ' fehlten' : '') + ').', 'ok', 5000);
    else toast('Export fehlgeschlagen: ' + r.error, 'err', 6000);
  }

  async function importSet(file) {
    const ok = await confirmDialog('Set importieren?', 'Das aktuelle Set (alle Reiter und Kacheln) wird ersetzt. Tipp: vorher exportieren, wenn du es behalten möchtest.', 'Importieren', true);
    if (!ok) return;
    const r = await api.importSet(file);
    if (r.canceled) return;
    if (!r.ok) { toast('Import fehlgeschlagen: ' + r.error, 'err', 6000); return; }
    A.stopAll(false);
    const keepSettings = cfg.settings;
    cfg = M.normalizeConfig(r.config);
    // Geräteeinstellungen dieses PCs behalten
    ['masterDeviceId', 'masterDeviceLabel', 'cueDeviceId', 'cueDeviceLabel', 'masterVolume', 'cueVolume', 'copyToLibrary'].forEach((k) => (cfg.settings[k] = keepSettings[k]));
    persist();
    topDialog() && topDialog()._close();
    renderAll();
    checkMissing();
    toast('Set importiert (' + r.files + ' Audiodateien).', 'ok');
  }

  async function cleanupLibrary() {
    if (!(await confirmDialog('Bibliothek aufräumen?', 'Audiodateien in der EventDJ-Bibliothek, die keiner Kachel mehr zugeordnet sind, werden gelöscht.', 'Aufräumen', true))) return;
    const used = [];
    cfg.tabs.forEach((t) => t.tiles.forEach((x) => x.file && used.push(x.file)));
    const r = await api.cleanupLibrary(used);
    toast(r.removed + ' ungenutzte Datei(en) entfernt.', 'ok');
  }

  // ================================================================ Bedienleisten & Eingaben

  function bindTopbar() {
    $('#btn-edit').addEventListener('click', () => { editMode = !editMode; moveTileId = null; renderAll(); });
    $('#btn-reset').addEventListener('click', () => resetCounters(null));
    $('#btn-settings').addEventListener('click', openSettings);
    $('#btn-fullscreen').addEventListener('click', () => api.fullscreen());
    $('#edit-banner-cancel').addEventListener('click', () => { moveTileId = null; renderAll(); });
  }

  function bindBottombar() {
    const mv = $('#master-vol');
    mv.addEventListener('input', () => {
      cfg.settings.masterVolume = Number(mv.value) / 100;
      $('#master-val').textContent = mv.value + '%';
      A.setBusVolume('master', cfg.settings.masterVolume);
      persist();
    });
    $('#btn-fadeall').addEventListener('click', () => A.stopAll(true));
    $('#btn-stopall').addEventListener('click', () => A.stopAll(false));
  }

  function bindDragDrop() {
    const stage = $('#stage');
    const hint = $('#drop-hint');
    let depth = 0;
    const isFiles = (e) => Array.from(e.dataTransfer.types || []).includes('Files');
    document.addEventListener('dragover', (e) => { if (isFiles(e)) e.preventDefault(); });
    document.addEventListener('drop', (e) => { if (isFiles(e)) e.preventDefault(); });
    stage.addEventListener('dragenter', (e) => { if (!isFiles(e)) return; depth++; hint.hidden = false; });
    stage.addEventListener('dragleave', (e) => { if (!isFiles(e)) return; depth = Math.max(0, depth - 1); if (!depth) hint.hidden = true; });
    stage.addEventListener('dragover', (e) => { if (isFiles(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
    stage.addEventListener('drop', async (e) => {
      if (!isFiles(e)) return;
      e.preventDefault();
      depth = 0; hint.hidden = true;
      document.querySelectorAll('.drag-over').forEach((x) => x.classList.remove('drag-over'));
      const files = Array.from(e.dataTransfer.files);
      const paths = files.map((f) => {
        const p = api.pathForFile(f);
        if (p && !fileNames.has(p)) fileNames.set(p, f.name);
        return p;
      }).filter(Boolean);
      if (!paths.length) return;
      const tab = activeTab();
      const slotEl = e.target.closest && e.target.closest('.slot');
      const slot = slotEl ? Number(slotEl.dataset.slot) : 0;
      const existing = tab.tiles.find((t) => t.slot === slot);
      if (existing && paths.length === 1 && slotEl) {
        const replace = await confirmDialog('Audiodatei ersetzen?', 'Die Datei von „' + existing.title + '“ durch „' + (fileNames.get(paths[0]) || paths[0].split(/[\\/]/).pop()) + '“ ersetzen? (Nein = als neue Kachel hinzufügen)', 'Ersetzen', false);
        if (replace) {
          const [r] = await api.importFiles(paths, cfg.settings.copyToLibrary);
          if (!r || !r.ok) { toast('Import fehlgeschlagen: ' + (r && r.error), 'err'); return; }
          A.stopTile(existing.id, true);
          existing.file = r.path;
          existing.fileName = fileNames.get(r.path) || r.name;
          existing.duration = Math.max(0, await A.probeDuration(r.path));
          missing.delete(r.path);
          persist(); renderGrid();
          return;
        }
      }
      addFiles(tab, paths, slot);
    });
  }

  function bindKeys() {
    document.addEventListener('keydown', (e) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target && e.target.tagName) || '') && e.target.type !== 'range' && e.target.type !== 'checkbox';
      if (e.key === 'Escape') {
        if (document.querySelector('.menu')) { closeMenus(); return; }
        const top = topDialog();
        if (top) { top._close(); return; }
        if (moveTileId) { moveTileId = null; renderAll(); return; }
        A.stopAll(!e.shiftKey);
        e.preventDefault();
        return;
      }
      if (typing || topDialog()) return;
      if (e.ctrlKey && /^[1-9]$/.test(e.key)) {
        const tab = cfg.tabs[Number(e.key) - 1];
        if (tab) selectTab(tab.id);
        e.preventDefault();
      } else if (e.ctrlKey && e.key.toLowerCase() === 'e') {
        editMode = !editMode; moveTileId = null; renderAll();
        e.preventDefault();
      }
    });
    // Kein Kontextmenü des Browsers
    document.addEventListener('contextmenu', (e) => {
      if (!/^(INPUT|TEXTAREA)$/.test(e.target.tagName)) e.preventDefault();
    });
  }

  // ================================================================ Browser-Ersatz (Demo/Test ohne Electron)

  function browserFallback() {
    const KEY = 'eventdj-config';
    const blobFor = (f) => { const u = URL.createObjectURL(f); fileNames.set(u, f.name); return u; };
    return {
      info: async () => ({ version: 'Browser-Demo', dataDir: '(Browser-Speicher)', portable: false }),
      loadConfig: async () => {
        let c = null;
        try { c = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { c = null; }
        return c || M.defaultConfig();
      },
      saveConfig: async (c) => { try { localStorage.setItem(KEY, JSON.stringify(c)); } catch (e) { /* */ } return true; },
      saveConfigSync: (c) => { try { localStorage.setItem(KEY, JSON.stringify(c)); } catch (e) { /* */ } return true; },
      pickAudio: (multi) => new Promise((res) => {
        const inp = document.createElement('input');
        inp.type = 'file'; inp.multiple = multi !== false; inp.accept = 'audio/*';
        inp.onchange = () => res(Array.from(inp.files).map(blobFor));
        inp.click();
      }),
      importFiles: async (paths) => paths.map((p) => ({ ok: true, source: p, path: p, name: fileNames.get(p) || p.split(/[\\/]/).pop() })),
      filesExist: async (p) => p.map((x) => !/^blob:/.test(x)),
      cleanupLibrary: async () => ({ removed: 0 }),
      exportSet: async () => ({ ok: false, error: 'nur in der Desktop-App verfügbar' }),
      importSet: async () => ({ ok: false, error: 'nur in der Desktop-App verfügbar' }),
      fullscreen: async () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()),
      openDataDir: async () => {},
      openUrl: async (u) => window.open(u, '_blank'),
      pathForFile: blobFor,
      onSetOpenRequest: () => {}
    };
  }

  // Für Tests zugänglich
  window.__edj = { get cfg() { return cfg; }, renderAll, triggerTile, A };

  init().catch((e) => {
    console.error(e);
    document.body.appendChild(h('pre', { style: { color: '#f88', padding: '20px' } }, 'Startfehler: ' + (e && e.stack || e)));
  });
})();
