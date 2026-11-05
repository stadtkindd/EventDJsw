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
      publishState();
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

  /** angezeigte Länge: Einzeldatei (ggf. Start–Ende) bzw. Summe der Playlist */
  function tileLength(tile) {
    if (tile.kind === 'playlist') return tile.playlist.reduce((a, x) => a + (x.duration || 0), 0);
    if (!tile.duration) return 0;
    const end = tile.endAt > 0 ? Math.min(tile.endAt, tile.duration) : tile.duration;
    return Math.max(0, end - (tile.startAt || 0));
  }
  function fmtTotal(tile) { const l = tileLength(tile); return l ? fmtTime(l) : ''; }
  function flagTitle(tile) {
    const t = [];
    if (tile.kind === 'playlist') t.push('Playlist mit ' + tile.playlist.length + ' Titeln' + (tile.shuffle ? ', zufällig' : ''));
    if (tile.role === 'bed') t.push('Hintergrundmusik (wird bei Jingles abgesenkt)');
    if (tile.loop) t.push(tile.kind === 'playlist' ? 'wiederholen' : 'Endlosschleife');
    if (tile.endAt > 0 && tile.kind !== 'playlist') t.push('Endpunkt gesetzt');
    if (tile.fx && Object.keys(tile.fx).length) t.push('eigene Effekte: ' + fxSummary(tile.fx));
    return t.join(' · ');
  }

  // ================================================================ Start

  async function init() {
    info = await api.info();
    cfg = M.normalizeConfig(await api.loadConfig());

    A.setBusVolume('master', cfg.settings.masterVolume);
    A.setBusVolume('cue', cfg.settings.cueVolume);
    A.setDucking(cfg.settings.duckLevel, cfg.settings.duckFadeMs);
    await refreshDevices(true);

    A.on('change', onVoiceChange);
    A.on('tick', updateProgress);
    A.on('error', (e) => toast('„' + e.voice.title + '“: ' + e.error, 'err', 5000));
    A.on('device-error', (e) => toast('Ausgabegerät nicht verfügbar – Windows-Standard wird genutzt.', 'err', 5000));
    A.on('devices-changed', () => refreshDevices(false));
    A.on('fx', () => { updateFxBar(); publishState(); });
    A.setPitchLock(cfg.settings.pitchLock);
    A.setEchoTime(cfg.settings.echoMs);

    bindTopbar();
    bindBottombar();
    bindDragDrop();
    bindKeys();
    onTabsResize();
    if (api.onSetOpenRequest) api.onSetOpenRequest((file) => importSet(file));
    if (api.onRemoteCommand) api.onRemoteCommand(onRemoteCommand);
    initMidi();
    applyRemoteSettings(true);
    startMeterLoop();

    window.addEventListener('beforeunload', () => {
      if (saveTimer) { clearTimeout(saveTimer); }
      try { api.saveConfigSync(cfg); } catch (e) { /* ignorieren */ }
    });

    renderAll();
    checkMissing();
    publishState();
  }

  async function checkMissing() {
    const files = [];
    cfg.tabs.forEach((t) => t.tiles.forEach((tile) => files.push(...M.tileFiles(tile))));
    cfg.player.tracks.forEach((tr) => files.push(tr.file));
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
    renderFxBar();
    renderPlayer();
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

  // ---------------------------------------------------------------- Reiter (10 je Ebene, bis zu 3 Ebenen)

  let viewLayer = null;   // angezeigte Ebene; null = Ebene des aktiven Reiters

  function currentLayer() {
    if (viewLayer == null || !layerUsable(viewLayer)) viewLayer = (activeTab() && activeTab().layer) || 0;
    return Math.min(viewLayer, M.MAX_LAYERS - 1);
  }

  /** alle Reiter in Anzeigereihenfolge (Ebene 1, 2, 3) */
  function orderedTabs() {
    const out = [];
    for (let L = 0; L < M.MAX_LAYERS; L++) out.push(...M.tabsOfLayer(cfg.tabs, L));
    return out;
  }

  function layerUsable(L) {
    if (M.tabsOfLayer(cfg.tabs, L).length) return true;
    // leere Ebene nur im Bearbeitungsmodus, und nur die erste leere nach den belegten
    return editMode && L <= M.layerCount(cfg.tabs) && cfg.tabs.length < M.MAX_TABS;
  }

  function showLayer(L) {
    if (L < 0 || L >= M.MAX_LAYERS || !layerUsable(L)) return;
    viewLayer = L;
    renderTabs();
  }

  function stepLayer(dir) {
    for (let i = 1; i <= M.MAX_LAYERS; i++) {
      const L = (currentLayer() + dir * i + M.MAX_LAYERS * 2) % M.MAX_LAYERS;
      if (layerUsable(L)) { showLayer(L); return; }
    }
  }

  /** Reiter auf eine andere Ebene verschieben (ans Ende) */
  function moveTabToLayer(tab, L) {
    if ((tab.layer || 0) === L) return;
    if (M.tabsOfLayer(cfg.tabs, L).length >= M.TABS_PER_LAYER) { toast('Ebene ' + (L + 1) + ' ist voll (max. ' + M.TABS_PER_LAYER + ' Reiter).', 'err'); return; }
    cfg.tabs = cfg.tabs.filter((t) => t !== tab);
    tab.layer = L;
    cfg.tabs.push(tab);
    persist();
    renderTabs();
    toast('„' + tab.name + '“ liegt jetzt auf Ebene ' + (L + 1) + '.', 'ok');
  }

  function renderLayers() {
    const box = $('#layers');
    box.innerHTML = '';
    const cur = currentLayer();
    for (let L = 0; L < M.MAX_LAYERS; L++) {
      const tabs = M.tabsOfLayer(cfg.tabs, L);
      const usable = layerUsable(L);
      const hasActive = tabs.some((t) => t.id === cfg.activeTabId);
      const playing = tabs.some(tabIsPlaying);
      const b = h('button', {
        class: 'layer' + (L === cur ? ' on' : '') + (hasActive ? ' has-active' : ''),
        disabled: !usable,
        title: 'Reiter-Ebene ' + (L + 1) + (tabs.length ? ' (' + tabs.length + ' Reiter)' : editMode ? ' – leer, Reiter hier anlegen' : ' – leer'),
        onclick: () => showLayer(L),
        dataset: { layer: String(L) }
      }, String(L + 1), playing ? h('span', { class: 'dot' }) : null);
      // Reiter auf eine Ebenen-Taste ziehen = auf diese Ebene verschieben
      b.addEventListener('dragover', (e) => {
        if (Array.from(e.dataTransfer.types).includes('text/edj-tab')) { e.preventDefault(); b.classList.add('drag-over'); }
      });
      b.addEventListener('dragleave', () => b.classList.remove('drag-over'));
      b.addEventListener('drop', (e) => {
        b.classList.remove('drag-over');
        const id = e.dataTransfer.getData('text/edj-tab');
        const tab = cfg.tabs.find((t) => t.id === id);
        if (tab) { e.preventDefault(); moveTabToLayer(tab, L); }
      });
      box.appendChild(b);
    }
  }

  function renderTabs() {
    renderLayers();
    const nav = $('#tabs');
    nav.innerHTML = '';
    const L = currentLayer();
    const list = M.tabsOfLayer(cfg.tabs, L);
    list.forEach((tab, pos) => {
      const isActive = tab.id === cfg.activeTabId;
      const keyHint = pos < 10 ? '  (Strg+' + ((pos + 1) % 10) + ')' : '';
      const b = h('button', {
        class: 'tab' + (isActive ? ' active' : ''),
        style: { '--tabc': tab.color, '--tabfg': contrast(tab.color) },
        title: tab.name + keyHint,
        draggable: editMode ? 'true' : 'false',
        dataset: { tabId: tab.id }
      },
      h('span', { class: 'tab-label' }, tab.name),
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
        const items = [
          { icon: '✎', label: 'Reiter bearbeiten', fn: () => openTabEditor(tab) },
          { icon: '↺', label: 'Zähler dieses Reiters zurücksetzen', fn: () => resetCounters(tab) },
          { icon: '+', label: 'Neuer Reiter', fn: () => openTabEditor(null) }
        ];
        for (let k = 0; k < M.MAX_LAYERS; k++) {
          if (k !== L) items.push({ icon: '⇅', label: 'Auf Ebene ' + (k + 1) + ' verschieben', fn: () => moveTabToLayer(tab, k) });
        }
        showMenu(e.clientX, e.clientY, tab.name, items);
      });

      // Reiter per Maus umsortieren / Kacheln & Dateien auf Reiter ziehen
      b.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/edj-tab', tab.id); e.dataTransfer.effectAllowed = 'move'; });
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
        const fromId = e.dataTransfer.getData('text/edj-tab');
        const tileId = e.dataTransfer.getData('text/edj-tile');
        if (fromId) {
          e.preventDefault();
          const moved = cfg.tabs.find((t) => t.id === fromId);
          if (!moved || moved === tab) return;
          if ((moved.layer || 0) !== L && list.length >= M.TABS_PER_LAYER) { toast('Ebene ' + (L + 1) + ' ist voll.', 'err'); return; }
          cfg.tabs = cfg.tabs.filter((t) => t !== moved);
          moved.layer = L;
          cfg.tabs.splice(cfg.tabs.indexOf(tab), 0, moved);
          persist(); renderTabs();
        } else if (tileId) {
          e.preventDefault();
          moveTileToTab(tileId, tab);
        }
      });
      nav.appendChild(b);
    });
    if (editMode && list.length < M.TABS_PER_LAYER && cfg.tabs.length < M.MAX_TABS) {
      nav.appendChild(h('button', { class: 'tab add', title: 'Neuen Reiter auf Ebene ' + (L + 1) + ' anlegen', onclick: () => openTabEditor(null) }, '+'));
    }
    fitTabLabels();
  }

  /**
   * Reitertexte einpassen: einzeilig verkleinern (einzelne Wörter bis 10 px), sonst zweizeilig
   * an Wortgrenzen und weiter verkleinern; nur wenn ein Wort selbst dann nicht passt, wird es getrennt.
   */
  function fitTabLabels() {
    document.querySelectorAll('#tabs .tab-label').forEach((el) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      // einzeilig: echte Textbreite messen (Bruchteil-Pixel lösen sonst schon „…“ aus)
      const fits = () => (el.classList.contains('two')
        ? el.scrollWidth <= el.clientWidth && el.scrollHeight <= el.clientHeight + 1
        : range.getBoundingClientRect().width <= el.getBoundingClientRect().width - 0.5);
      const oneWord = !/\s/.test(el.textContent.trim());
      el.classList.remove('two', 'brk');
      let size = 17;
      el.style.fontSize = size + 'px';
      const minOne = oneWord ? 10 : 13;
      while (!fits() && size > minOne) el.style.fontSize = --size + 'px';
      if (fits() || oneWord) { if (!fits()) el.classList.add('brk'); return; }
      el.classList.add('two');
      size = 16;
      el.style.fontSize = size + 'px';
      while (!fits() && size > 10) el.style.fontSize = --size + 'px';
      if (!fits()) el.classList.add('brk');
    });
  }

  function onTabsResize() {
    let raf = 0;
    const ro = new ResizeObserver(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(fitTabLabels); });
    ro.observe($('#tabs'));
  }

  /** Reiter per Tastatur/Fernsteuerung: nächster/vorheriger über alle Ebenen */
  function stepTab(dir) {
    const order = orderedTabs();
    const i = order.findIndex((t) => t.id === cfg.activeTabId);
    const next = order[(i + dir + order.length) % order.length];
    if (next) selectTab(next.id);
  }

  let tabSwitchTimer = null;
  function selectTabDelayed(id) {
    clearTimeout(tabSwitchTimer);
    tabSwitchTimer = setTimeout(() => selectTab(id), 600);
  }

  function selectTab(id) {
    const tab = cfg.tabs.find((t) => t.id === id);
    if (tab) viewLayer = tab.layer || 0;
    if (cfg.activeTabId === id) { renderTabs(); return; }
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
    const files = M.tileFiles(tile);
    const isPlaylist = tile.kind === 'playlist';
    const isMissing = files.length > 0 && files.every((f) => missing.has(f));
    const progress = h('div', { class: 'progress' });
    const line = h('div', { class: 'progress-line' });
    const count = h('span', { class: 'count' + (tile.playCount ? '' : ' zero'), title: 'So oft gespielt' }, tile.playCount + '×');
    const time = h('span', { class: 'time' }, fmtTotal(tile));
    const track = h('span', { class: 'tile-track' });
    const flags = [];
    if (isPlaylist) flags.push('☰ ' + tile.playlist.length + (tile.shuffle ? ' ⤮' : ''));
    if (tile.role === 'bed') flags.push('▽');
    if (tile.loop) flags.push('⟲');
    if (tile.endAt > 0 && !isPlaylist) flags.push('⇥');
    if (tile.fx && Object.keys(tile.fx).length) flags.push('✦');
    const keyBadges = [];
    if (tile.hotkey) keyBadges.push(h('span', { class: 'keybadge', title: 'Tastenkürzel' }, tile.hotkey));
    if (tile.midi) keyBadges.push(h('span', { class: 'keybadge midi', title: 'MIDI: ' + midiLabel(tile.midi) }, '♫'));
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
      h('span', { class: 'flags', title: flagTitle(tile) }, flags.join('  '))
    ),
    h('div', { class: 'tile-title', style: { fontSize: look.fontSize + 'px', fontWeight: look.bold ? '800' : '500' } },
      tile.title || '(ohne Titel)',
      tile.subtitle ? h('span', { class: 'tile-sub' }, tile.subtitle) : null,
      track
    ),
    h('div', { class: 'tile-bottom' },
      playBtn,
      isMissing ? h('span', { class: 'missing-note' }, 'Datei fehlt') : (!M.tileHasAudio(tile) ? h('span', { class: 'missing-note' }, isPlaylist ? 'leere Playlist' : 'keine Datei') : null),
      h('span', { class: 'keys' }, keyBadges),
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
    return { el, progress, line, time, count, track, play: playBtn, tile };
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

  function playOptions(tile, bus) {
    const o = {
      bus,
      fadeIn: fadeInOf(tile),
      fadeOut: fadeOutOf(tile),
      volume: tile.volume,
      gainDb: tile.gainDb,
      startAt: tile.startAt,
      endAt: tile.endAt,
      loop: tile.loop,
      role: tile.role,
      fx: tile.fx
    };
    if (tile.kind === 'playlist') {
      o.tracks = tile.playlist.map((x) => ({ file: x.file, gainDb: x.gainDb, title: M.titleFromFileName(x.fileName || x.file) }));
      o.shuffle = tile.shuffle;
    }
    return o;
  }

  function triggerTile(tile, bus) {
    const s = cfg.settings;
    if (!M.tileHasAudio(tile)) {
      toast('Für „' + tile.title + '“ ist ' + (tile.kind === 'playlist' ? 'noch kein Titel in der Playlist.' : 'keine Audiodatei hinterlegt.'), 'err');
      return;
    }
    const running = A.voicesForTile(tile.id, bus).filter((v) => v.state !== 'fading');

    if (bus === 'cue') {
      if (running.length) { A.stopTile(tile.id, true, 'cue'); return; }
      A.stopBus('cue', true, 150);
    } else {
      if (running.length) {
        if (s.retrigger === 'stop') { A.stopTile(tile.id, true, 'master'); return; }
        running.forEach((v) => A.stop(v.id, true, 120));
      }
      if (s.playMode === 'exclusive') {
        // Jingles verdrängen Jingles, Hintergrundmusik verdrängt Hintergrundmusik.
        // Hintergrundmusik bleibt unter einem Jingle stehen und wird nur abgesenkt (Ducking).
        const isBed = tile.role === 'bed';
        A.stopBus('master', true, null, (v) => (isBed ? v.role === 'bed' : v.role !== 'bed'));
      }
    }

    A.play(tile, playOptions(tile, bus));

    if (bus === 'master') {
      tile.playCount++;
      persist();
      const te = tileEls.get(tile.id);
      if (te) { te.count.textContent = tile.playCount + '×'; te.count.classList.remove('zero'); }
    }
  }

  /** Wiedergabe gezielt starten (nicht umschalten) – für Fernsteuerung */
  function startTile(tile) {
    if (A.voicesForTile(tile.id, 'master').some((v) => v.state !== 'fading')) return;
    triggerTile(tile, 'master');
  }

  function onVoiceChange() {
    $('#btn-pause').classList.toggle('on', A.paused);
    $('#btn-pause').textContent = A.paused ? '▶' : '❚❚';
    if (cfg.settings.fxAutoReset && !A.voices.size && A.fxActive()) A.resetFx();
    updatePlayer();
    publishState();
    updateTileStates();
    renderNowPlaying();
    // Punkte an den Reitern und Ebenen aktualisieren
    let dirty = false;
    document.querySelectorAll('#tabs .tab[data-tab-id]').forEach((b) => {
      const tab = cfg.tabs.find((t) => t.id === b.dataset.tabId);
      if (tab && !!b.querySelector('.dot') !== tabIsPlaying(tab)) dirty = true;
    });
    document.querySelectorAll('#layers .layer').forEach((b) => {
      const playing = M.tabsOfLayer(cfg.tabs, Number(b.dataset.layer)).some(tabIsPlaying);
      if (!!b.querySelector('.dot') !== playing) dirty = true;
    });
    if (dirty) renderTabs();
  }

  function updateTileStates() {
    tileEls.forEach((t, id) => {
      const vs = A.voicesForTile(id);
      const master = vs.filter((v) => v.bus === 'master');
      const paused = master.length > 0 && master.every((v) => v.paused);
      const playing = !paused && master.some((v) => v.state !== 'fading');
      const fading = !paused && !playing && master.some((v) => v.state === 'fading');
      t.el.classList.toggle('paused', paused);
      t.el.classList.toggle('playing', playing);
      t.el.classList.toggle('fading', fading);
      t.el.classList.toggle('cueing', vs.some((v) => v.bus === 'cue'));
      t.play.textContent = paused ? '❚❚' : playing || fading ? '■' : '▶';
      const pl = master.find((v) => v.tracks);
      t.track.textContent = pl && pl.trackTitle ? '♪ ' + pl.trackTitle : '';
      if (!master.length) {
        t.progress.style.width = '0';
        t.line.style.width = '0';
        t.time.textContent = fmtTotal(t.tile);
      }
    });
  }

  function voiceProgress(v) {
    const a = v.audio;
    const full = Number.isFinite(a.duration) && a.duration > 0 ? a.duration : 0;
    const from = v.startAt || 0;
    const to = v.endAt > 0 && full ? Math.min(v.endAt, full) : full;
    const dur = Math.max(0, to - from);
    const cur = Math.max(0, (a.currentTime || 0) - from);
    const rate = a.playbackRate || 1;
    return { dur, cur, pct: dur ? Math.min(1, cur / dur) : 0, rem: dur ? Math.max(0, dur - cur) / rate : 0 };
  }

  function updateProgress() {
    updatePlayer();
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
      const look = found ? M.resolveLook(cfg, found.tile) : v.tileId === PLAYER_ID ? { bg: '#13a3a3', fg: '#fff' } : { bg: '#333', fg: '#fff' };
      const bar = h('div', { class: 'np-bar' });
      const time = h('span', { class: 'np-time' }, '…');
      const el = h('div', {
        class: 'np' + (v.state === 'fading' ? ' fading' : '') + (v.paused ? ' paused' : ''),
        style: { '--npbg': look.bg, '--npfg': look.fg },
        title: found ? 'Reiter: ' + found.tab.name : ''
      },
      v.bus === 'cue' ? h('span', { class: 'np-bus' }, '🎧 Vorhören') : null,
      v.role === 'bed' ? h('span', { class: 'np-bus', title: 'Hintergrundmusik – wird bei Jingles abgesenkt' }, '▽ BG') : null,
      v.paused ? h('span', { class: 'np-bus' }, '❚❚ Pause') : null,
      h('span', { class: 'np-title', onclick: () => (v.tileId === PLAYER_ID ? openPlayerPanel() : found && selectTab(found.tab.id)) }, v.title, v.trackTitle ? h('small', null, v.trackTitle) : null),
      time,
      v.tracks ? h('button', { title: 'Nächster Titel', onclick: () => A.next(v.tileId) }, '⏭') : null,
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
      if (te && !A.voicesForTile(t.id, 'master').length) te.time.textContent = fmtTotal(t);
      persist();
    });
    if (cfg.settings.normalizeOnImport) tiles.forEach((t) => queueAnalysis(t, true));
    return tiles;
  }

  // ---------- Lautheitsanalyse (im Hintergrund, nacheinander)

  const analysisQueue = [];
  let analysisBusy = false;

  /** entry = Kachel oder Playlist-Titel (mit file, gainDb, loudness, peak) */
  function queueAnalysis(entry, applyGain) {
    return new Promise((resolve) => {
      analysisQueue.push({ entry, applyGain, resolve });
      runAnalysisQueue();
    });
  }

  async function runAnalysisQueue() {
    if (analysisBusy) return;
    analysisBusy = true;
    while (analysisQueue.length) {
      const job = analysisQueue.shift();
      job.resolve(await analyzeEntry(job.entry, job.applyGain));
    }
    analysisBusy = false;
  }

  async function analyzeEntry(entry, applyGain) {
    if (!entry.file || !api.readAudio) return null;
    try {
      const buffer = await A.decode(entry.file, api.readAudio);
      const r = await A.analyzeLoudness(buffer);
      entry.loudness = r.lufs;
      entry.peak = r.peak;
      if (!entry.duration) entry.duration = buffer.duration;
      if (applyGain) entry.gainDb = M.normalizeGain(r.lufs, r.peak, cfg.settings.targetLufs);
      persist();
      return r;
    } catch (e) {
      console.warn('Analyse fehlgeschlagen', entry.file, e);
      return null;
    }
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
      playing && tile.kind === 'playlist' ? { icon: '⏭', label: 'Nächster Titel', fn: () => A.next(tile.id) } : null,
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
    return h('label', { class: 'check' }, cb, h('span', null, label));
  }

  // ---------- Reiter-Dialog

  function openTabEditor(tab) {
    const isNew = !tab;
    if (isNew && cfg.tabs.length >= M.MAX_TABS) { toast('Maximal ' + M.MAX_TABS + ' Reiter (3 Ebenen à ' + M.TABS_PER_LAYER + ').', 'err'); return; }
    let newLayer = currentLayer();
    if (isNew && M.tabsOfLayer(cfg.tabs, newLayer).length >= M.TABS_PER_LAYER) {
      newLayer = [0, 1, 2].find((L) => M.tabsOfLayer(cfg.tabs, L).length < M.TABS_PER_LAYER);
    }
    const draft = isNew ? M.newTab('Neuer Reiter', PALETTE[cfg.tabs.length % PALETTE.length], 4, 3, newLayer) : JSON.parse(JSON.stringify(tab));
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
      const sib = M.tabsOfLayer(cfg.tabs, tab.layer || 0);
      const pos = sib.indexOf(tab);
      append(d.body, h('div', { class: 'section' },
        h('h3', null, 'Position & Zähler'),
        field('Reiter-Ebene', segmented([0, 1, 2].map((L) => [String(L), 'Ebene ' + (L + 1)]), String(tab.layer || 0), (v) => { d.close(); moveTabToLayer(tab, Number(v)); })),
        h('div', { class: 'row' },
          h('button', { class: 'btn', disabled: pos === 0, onclick: () => { moveTab(tab, -1); d.close(); } }, '◀ Nach links'),
          h('button', { class: 'btn', disabled: pos === sib.length - 1, onclick: () => { moveTab(tab, 1); d.close(); } }, 'Nach rechts ▶'),
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
          if (cfg.activeTabId === tab.id) {
            const same = M.tabsOfLayer(cfg.tabs, tab.layer || 0);
            cfg.activeTabId = (same[0] || cfg.tabs[0]).id;
            viewLayer = null;
          }
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
            viewLayer = draft.layer || 0;
          } else {
            Object.assign(tab, { name: draft.name, color: draft.color, cols: draft.cols, rows: draft.rows });
          }
          persist(); d.close(); renderAll();
        }
      }, isNew ? 'Anlegen' : 'Übernehmen')
    ]);
  }

  /** Reiter innerhalb seiner Ebene nach links/rechts verschieben */
  function moveTab(tab, dir) {
    const sib = M.tabsOfLayer(cfg.tabs, tab.layer || 0);
    const other = sib[sib.indexOf(tab) + dir];
    if (!other) return;
    const a = cfg.tabs.indexOf(tab), b = cfg.tabs.indexOf(other);
    cfg.tabs[a] = other; cfg.tabs[b] = tab;
    persist();
    renderTabs();
  }

  // ---------- Kachel-Dialog

  function openTileEditor(tab, tile) {
    const draft = JSON.parse(JSON.stringify(tile));
    const s = cfg.settings;
    const d = openDialog({
      title: 'Kachel bearbeiten', kind: 'tile', size: 'wide',
      onClose: () => { A.stopTile(draft.id, false, 'cue'); cancelLearn(); if (wave) wave.destroy(); }
    });
    let wave = null;

    const previewSlot = h('div', { class: 'slot' });
    const drawPreview = () => {
      previewSlot.innerHTML = '';
      previewSlot.appendChild(buildTile(draft, { interactive: false }).el);
    };

    // ---------------- Seiten des Dialogs
    const pages = {};
    const pageNames = [['general', 'Allgemein'], ['audio', 'Audio'], ['playback', 'Wiedergabe'], ['control', 'Steuerung']];
    const showPage = (name) => {
      Object.keys(pages).forEach((k) => (pages[k].hidden = k !== name));
      if (name === 'audio' && wave) wave.resize();
    };
    pageNames.forEach(([k]) => (pages[k] = h('div', { class: 'page' })));
    const nav = segmented(pageNames, 'general', showPage);
    nav.classList.add('page-nav');

    // ---------------- Allgemein
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
    const bgPick = colorPicker(draft.bg || look.bg, (c) => { draft.bg = c; bgCb.querySelector('input').checked = true; drawPreview(); });
    const fgPick = colorPicker(draft.fg || look.fg, (c) => { draft.fg = c; fgCb.querySelector('input').checked = true; drawPreview(); });
    const bgCb = checkbox('Eigene Hintergrundfarbe', !!draft.bg, (on) => { draft.bg = on ? bgPick.querySelector('input[type=color]').value : null; drawPreview(); });
    const fgCb = checkbox('Eigene Schriftfarbe', !!draft.fg, (on) => { draft.fg = on ? fgPick.querySelector('input[type=color]').value : null; drawPreview(); });
    const curStyle = () => cfg.styles.find((x) => x.id === draft.styleId) || cfg.styles[0];

    append(pages.general, h('div', { class: 'grid2' },
      h('div', null,
        h('div', { class: 'preview-wrap' }, previewSlot),
        field('Titel', textInput(draft.title, (v) => { draft.title = v; drawPreview(); }, 'z. B. Satzbeginn')),
        field('Untertitel (optional)', textInput(draft.subtitle, (v) => { draft.subtitle = v; drawPreview(); }, 'z. B. Interpret, Hinweis')),
        field('Eigenschaft (Kachel-Stil)', styleBox, 'Stile legst du in den Einstellungen an (z. B. Satzbeginn = blau, Auszeiten = grün).')),
      h('div', null,
        h('div', { class: 'section' },
          h('h3', null, 'Aussehen anpassen'),
          bgCb, bgPick, h('div', { style: { height: '10px' } }), fgCb, fgPick, h('div', { style: { height: '10px' } }),
          field('Schriftgröße', optionalStepper({
            value: draft.fontSize, defaultValue: curStyle().fontSize, min: 10, max: 96, step: 1, bigStep: 2,
            defaultLabel: 'Schriftgröße vom Stil', format: (v) => v + ' px',
            onChange: (v) => { draft.fontSize = v; drawPreview(); }
          }))),
        h('div', { class: 'section' },
          h('h3', null, 'Zähler & Ablage'),
          h('div', { class: 'row' },
            stepper({ value: draft.playCount, min: 0, max: 9999, step: 1, noRange: true, format: (v) => v + '×', onChange: (v) => { draft.playCount = v; drawPreview(); } })),
          h('div', { class: 'row' },
            h('select', { class: 'inp', style: { maxWidth: '320px' }, onchange: (e) => (draft._targetTab = e.target.value) },
              cfg.tabs.map((t) => h('option', { value: t.id, selected: t.id === tab.id }, t.id === tab.id ? t.name + ' (aktuell)' : t.name)))),
          h('p', { class: 'hint' }, 'Reiter wählen, um die Kachel beim Speichern dorthin zu verschieben.'),
          h('div', { class: 'row' },
            h('button', { class: 'small-btn', type: 'button', onclick: () => { d.close(); startMove(tile); } }, '⇄ Position im Raster ändern'),
            h('button', { class: 'small-btn', type: 'button', onclick: () => { d.close(); duplicateTile(tab, tile); } }, '⧉ Duplizieren'))))
    ));

    // ---------------- Audio
    const singleBox = h('div');
    const playlistBox = h('div');
    const drawKind = () => {
      singleBox.hidden = draft.kind !== 'single';
      playlistBox.hidden = draft.kind !== 'playlist';
      loopCb.querySelector('span').textContent = draft.kind === 'playlist' ? 'Playlist wiederholen (nach dem letzten Titel von vorn)' : 'Endlosschleife – läuft, bis gestoppt wird (zwischen Start- und Endpunkt)';
      if (draft.kind === 'single' && wave) wave.resize();
      drawPreview();
    };

    // Einzeldatei
    const fileName = h('div', { class: 'fname' });
    const loudInfo = h('div', { class: 'loud-info' });
    let gainStep = null;
    const drawFile = () => {
      fileName.innerHTML = '';
      append(fileName, [
        draft.file ? (draft.fileName || draft.file.split(/[\\/]/).pop()) : 'Keine Datei gewählt',
        h('small', null, draft.file ? (draft.duration ? 'Länge ' + fmtTime(draft.duration) + ' · ' : '') + draft.file : 'MP3, WAV, OGG, FLAC, M4A/AAC, OPUS …')
      ]);
      drawLoud();
    };
    const drawLoud = () => {
      loudInfo.textContent = draft.loudness != null
        ? 'Gemessen: ' + draft.loudness.toFixed(1) + ' LUFS · Spitze ' + (draft.peak ? A.linToDb(draft.peak).toFixed(1) : '–') + ' dBFS → mit Anpassung ≈ ' + (draft.loudness + draft.gainDb).toFixed(1) + ' LUFS (Ziel ' + s.targetLufs + ')'
        : 'Noch nicht analysiert.';
    };
    const startStep = stepper({ value: draft.startAt, min: 0, max: Math.max(1, Math.ceil(draft.duration || 60)), step: 0.1, bigStep: 0.5, noRange: true, format: (v) => v.toFixed(1) + ' s', onChange: (v) => { draft.startAt = v; if (draft.endAt && draft.endAt <= v) draft.endAt = 0; wave && wave.draw(); drawPreview(); } });
    const endStep = stepper({ value: draft.endAt, min: 0, max: Math.max(1, Math.ceil(draft.duration || 60)), step: 0.1, bigStep: 0.5, noRange: true, format: (v) => (v ? v.toFixed(1) + ' s' : 'Dateiende'), onChange: (v) => { draft.endAt = v > draft.startAt ? v : 0; wave && wave.draw(); drawPreview(); } });
    const waveHost = h('div', { class: 'wave-host' });

    const loadWave = () => {
      if (wave) { wave.destroy(); wave = null; }
      waveHost.innerHTML = '';
      if (!draft.file) { waveHost.appendChild(h('div', { class: 'wave-empty' }, 'Keine Datei')); return; }
      wave = createWaveform(waveHost, draft, {
        onChange: () => { startStep._set(draft.startAt); endStep._set(draft.endAt); drawPreview(); },
        onLoaded: (dur) => { if (!draft.duration) { draft.duration = dur; drawFile(); } }
      });
    };

    const pickSingle = async () => {
      const p = await api.pickAudio(false);
      if (!p || !p.length) return;
      const [r] = await api.importFiles(p, s.copyToLibrary);
      if (!r || !r.ok) { toast('Import fehlgeschlagen: ' + (r && r.error), 'err'); return; }
      draft.file = r.path;
      draft.fileName = fileNames.get(r.path) || r.name;
      if (!draft.title || draft.title === 'Jingle' || draft.title === M.titleFromFileName(tile.fileName)) draft.title = M.titleFromFileName(draft.fileName);
      draft.duration = Math.max(0, await A.probeDuration(draft.file));
      draft.startAt = 0; draft.endAt = 0; draft.loudness = null; draft.peak = null; draft.gainDb = 0;
      startStep._set(0); endStep._set(0);
      missing.delete(draft.file);
      drawFile(); drawPreview(); loadWave();
      if (s.normalizeOnImport) { await queueAnalysis(draft, true); gainStep._set(draft.gainDb); drawLoud(); }
    };

    gainStep = stepper({ value: draft.gainDb, min: -24, max: 24, step: 0.5, bigStep: 1, format: (v) => (v > 0 ? '+' : '') + v.toFixed(1) + ' dB', onChange: (v) => { draft.gainDb = v; drawLoud(); } });

    append(singleBox, [
      field('Audiodatei', h('div', { class: 'file-box' },
        fileName,
        h('button', { class: 'small-btn', type: 'button', onclick: pickSingle }, 'Datei wählen …'))),
      field('Wellenform – Start- und Endpunkt', h('div', null,
        waveHost,
        h('div', { class: 'row wave-ctrl' },
          h('button', { class: 'small-btn', type: 'button', title: 'Ab Startpunkt auf dem Vorhör-Ausgang abspielen', onclick: () => { if (draft.file) triggerTile(draft, 'cue'); } }, '🎧 Vorhören'),
          h('span', { class: 'lbl-inline start' }, 'Start'), startStep,
          h('span', { class: 'lbl-inline end' }, 'Ende'), endStep,
          h('button', { class: 'small-btn', type: 'button', onclick: () => { draft.startAt = 0; draft.endAt = 0; startStep._set(0); endStep._set(0); wave && wave.draw(); drawPreview(); } }, 'Zurücksetzen'))),
        'Grünen bzw. roten Marker ziehen (Finger oder Maus) oder ins Bild tippen. Ist ein Endpunkt gesetzt, blendet der Jingle dort automatisch mit seiner Fade-Out-Zeit aus.'),
      h('div', { class: 'section' },
        h('h3', null, 'Lautheit / Normalisierung'),
        loudInfo,
        field('Pegelanpassung', gainStep, 'Wird zusätzlich zur Lautstärke angewendet. Positive Werte machen leise Dateien lauter (Begrenzung auf −1 dBFS Spitze).'),
        h('div', { class: 'row' },
          h('button', {
            class: 'small-btn', type: 'button',
            onclick: async (e) => {
              if (!draft.file) return;
              e.target.disabled = true; e.target.textContent = 'Analysiere …';
              const r = await queueAnalysis(draft, true);
              e.target.disabled = false; e.target.textContent = '📊 Analysieren & auf Ziel normalisieren';
              if (!r) toast('Analyse nicht möglich.', 'err');
              gainStep._set(draft.gainDb); drawLoud();
            }
          }, '📊 Analysieren & auf Ziel normalisieren'),
          h('button', { class: 'small-btn', type: 'button', onclick: () => { draft.gainDb = 0; gainStep._set(0); drawLoud(); } }, '0 dB')))
    ]);

    // Playlist
    const trackList = h('div', { class: 'track-list' });
    const drawTracks = () => {
      trackList.innerHTML = '';
      if (!draft.playlist.length) trackList.appendChild(h('p', { class: 'hint' }, 'Noch keine Titel – „Titel hinzufügen …“ oder Dateien aus dem Explorer hierher ziehen.'));
      draft.playlist.forEach((tr, i) => {
        trackList.appendChild(h('div', { class: 'track' },
          h('span', { class: 'track-no' }, String(i + 1)),
          h('span', { class: 'track-name' }, tr.fileName || tr.file.split(/[\\/]/).pop(),
            h('small', null, (tr.duration ? fmtTime(tr.duration) : '') + (tr.loudness != null ? ' · ' + tr.loudness.toFixed(1) + ' LUFS' : '') + (tr.gainDb ? ' · ' + (tr.gainDb > 0 ? '+' : '') + tr.gainDb.toFixed(1) + ' dB' : '') + (missing.has(tr.file) ? ' · Datei fehlt' : ''))),
          h('button', { class: 'small-btn', type: 'button', title: 'Nach oben', disabled: i === 0, onclick: () => { draft.playlist.splice(i - 1, 0, draft.playlist.splice(i, 1)[0]); drawTracks(); } }, '▲'),
          h('button', { class: 'small-btn', type: 'button', title: 'Nach unten', disabled: i === draft.playlist.length - 1, onclick: () => { draft.playlist.splice(i + 1, 0, draft.playlist.splice(i, 1)[0]); drawTracks(); } }, '▼'),
          h('button', { class: 'small-btn', type: 'button', title: 'Entfernen', onclick: () => { draft.playlist.splice(i, 1); drawTracks(); drawPreview(); } }, '✕')));
      });
      drawPreview();
    };
    const addTracks = async (paths) => {
      const audio = paths.filter((p) => M.isAudioFile(p) || /^blob:/.test(p));
      const res = await api.importFiles(audio, s.copyToLibrary);
      const added = [];
      res.filter((r) => r.ok).forEach((r) => {
        const tr = M.normalizeTrack({ file: r.path, fileName: fileNames.get(r.path) || r.name });
        draft.playlist.push(tr);
        added.push(tr);
      });
      drawTracks();
      for (const tr of added) {
        tr.duration = Math.max(0, await A.probeDuration(tr.file));
        drawTracks();
      }
      if (s.normalizeOnImport) for (const tr of added) { await queueAnalysis(tr, true); drawTracks(); }
    };
    playlistBox.addEventListener('dragover', (e) => { if (Array.from(e.dataTransfer.types).includes('Files')) { e.preventDefault(); e.stopPropagation(); } });
    playlistBox.addEventListener('drop', (e) => {
      if (!Array.from(e.dataTransfer.types).includes('Files')) return;
      e.preventDefault(); e.stopPropagation();
      addTracks(Array.from(e.dataTransfer.files).map((f) => { const p = api.pathForFile(f); if (p) fileNames.set(p, f.name); return p; }).filter(Boolean));
    });
    append(playlistBox, [
      trackList,
      h('div', { class: 'row', style: { marginTop: '10px' } },
        h('button', { class: 'small-btn', type: 'button', onclick: async () => { const p = await api.pickAudio(true); if (p && p.length) addTracks(p); } }, '+ Titel hinzufügen …'),
        h('button', {
          class: 'small-btn', type: 'button',
          onclick: async (e) => {
            e.target.disabled = true;
            for (const tr of draft.playlist) { await queueAnalysis(tr, true); drawTracks(); }
            e.target.disabled = false;
          }
        }, '📊 Alle normalisieren'),
        h('button', { class: 'small-btn', type: 'button', onclick: () => { if (draft.playlist.length) triggerTile(draft, 'cue'); } }, '🎧 Vorhören')),
      checkbox('Zufällige Reihenfolge (Shuffle)', draft.shuffle, (v) => { draft.shuffle = v; drawPreview(); }),
      h('p', { class: 'hint' }, 'Antippen startet die Playlist, nochmal antippen blendet aus. „Nächster Titel“ gibt es im Kontextmenü (lange drücken) und in der Fußzeile (⏭).')
    ]);

    append(pages.audio, [
      field('Art der Kachel', segmented([['single', 'Einzel-Jingle'], ['playlist', 'Playlist (mehrere Titel)']], draft.kind, (v) => { draft.kind = v; drawKind(); })),
      singleBox, playlistBox
    ]);

    // ---------------- Wiedergabe
    const loopCb = checkbox('', draft.loop, (v) => { draft.loop = v; drawPreview(); });
    append(pages.playback, h('div', { class: 'grid2' },
      h('div', null,
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
        field('Lautstärke', stepper({ value: Math.round(draft.volume * 100), min: 0, max: 100, step: 1, bigStep: 5, format: (v) => v + ' %', onChange: (v) => (draft.volume = v / 100) }))),
      h('div', null,
        field('Rolle', segmented([['normal', 'Jingle'], ['bed', 'Hintergrundmusik']], draft.role, (v) => { draft.role = v; drawPreview(); }),
          'Hintergrundmusik läuft unter Jingles weiter und wird währenddessen automatisch abgesenkt (Ducking, siehe Einstellungen). Ein Jingle beendet sie nicht.'),
        loopCb)
    ));

    // Klang & Effekte dieser Kachel
    const fxBox = h('div');
    const drawTileFx = () => {
      fxBox.innerHTML = '';
      const f = draft.fx || (draft.fx = {});
      const get = (k) => (f[k] == null ? M.FX_RANGES[k].neutral : f[k]);
      const setV = (k, v) => { const r = M.FX_RANGES[k]; if (Math.abs(v - r.neutral) < 1e-6) delete f[k]; else f[k] = v; };
      const defs = {
        tempo: { min: 50, max: 400, step: 5, bigStep: 25, scale: 100, format: (v) => fmtRate(v / 100) },
        bass: { min: -24, max: 30, step: 1, bigStep: 2, scale: 2, format: (v) => FX_UI.bass.fmt(v / 2) },
        treble: { min: -24, max: 24, step: 1, bigStep: 2, scale: 2, format: (v) => FX_UI.treble.fmt(v / 2) },
        filter: { min: -100, max: 100, step: 2, bigStep: 10, scale: 1, format: FX_UI.filter.fmt },
        hall: { min: 0, max: 100, step: 2, bigStep: 10, scale: 1, format: FX_UI.hall.fmt },
        echo: { min: 0, max: 100, step: 2, bigStep: 10, scale: 1, format: FX_UI.echo.fmt }
      };
      const cols = [[], []];
      M.FX_MODULES.forEach((k, i) => {
        const d = defs[k];
        cols[i % 2].push(field(FX_UI[k].name + (k === 'tempo' ? ' (0,5× … 4×)' : ''), stepper({
          value: Math.round(get(k) * d.scale), min: d.min, max: d.max, step: d.step, bigStep: d.bigStep, format: d.format,
          onChange: (v) => setV(k, v / d.scale)
        })));
      });
      append(fxBox, h('div', { class: 'grid2' }, h('div', null, cols[0]), h('div', null, cols[1])));
    };
    drawTileFx();
    append(pages.playback, h('div', { class: 'section' },
      h('h3', null, 'Klang & Effekte dieser Kachel'),
      h('p', { class: 'hint', style: { marginBottom: '10px' } }, 'Werden bei jedem Abspielen dieser Kachel angewendet (auch beim Vorhören) – zusätzlich zu den Live-Effekten der Effektleiste. Tipp: Jingle starten, in der Effektleiste einstellen und dort „💾 Auf Kachel“ tippen.'),
      fxBox,
      h('div', { class: 'row', style: { marginTop: '6px' } },
        h('button', { class: 'small-btn', type: 'button', disabled: !A.fxActive(), title: A.fxActive() ? '' : 'Keine Live-Effekte aktiv', onclick: () => { draft.fx = M.normalizeFx(mergeFx(draft.fx, A.fx)); drawTileFx(); toast('Live-Effekte übernommen – mit „Speichern“ bestätigen.', 'ok'); } }, '✦ Aktuelle Live-Effekte übernehmen'),
        h('button', { class: 'small-btn', type: 'button', onclick: () => { draft.fx = {}; drawTileFx(); } }, '⟲ Alle Effekte der Kachel zurücksetzen'),
        h('button', { class: 'small-btn', type: 'button', onclick: () => { if (M.tileHasAudio(draft)) triggerTile(draft, 'cue'); } }, '🎧 Vorhören'))));

    // ---------------- Steuerung
    const hkVal = h('span', { class: 'learn-val' });
    const midiVal = h('span', { class: 'learn-val' });
    const drawCtl = () => {
      hkVal.textContent = draft.hotkey || '—';
      midiVal.textContent = draft.midi ? midiLabel(draft.midi) : '—';
      drawPreview();
    };
    const hkBtn = h('button', {
      class: 'small-btn', type: 'button',
      onclick: () => learnHotkey(hkBtn, (key) => { draft.hotkey = key; drawCtl(); }, draft.id)
    }, '⌨ Taste zuweisen');
    const midiBtn = h('button', {
      class: 'small-btn', type: 'button',
      onclick: () => learnMidi(midiBtn, (id) => { draft.midi = id; drawCtl(); }, draft.id)
    }, '♫ MIDI zuweisen');
    const apiUrl = 'http://localhost:' + s.httpPort + '/api/toggle/' + draft.id;
    append(pages.control, [
      field('Tastenkürzel', h('div', { class: 'row' }, hkVal, hkBtn, h('button', { class: 'small-btn', type: 'button', onclick: () => { draft.hotkey = ''; drawCtl(); } }, 'Entfernen')),
        'Funktioniert im Live-Modus in allen Reitern. Stream Deck: Aktion „Hotkey“ mit derselben Taste belegen (z. B. F13–F24 oder Strg+Umschalt+Buchstabe).'),
      field('MIDI-Controller', h('div', { class: 'row' }, midiVal, midiBtn, h('button', { class: 'small-btn', type: 'button', onclick: () => { draft.midi = ''; drawCtl(); } }, 'Entfernen')),
        'Taste/Pad (Note), Regler oder Taster (CC ≥ 64) oder Programmwechsel am Gerät betätigen.'),
      field('HTTP-Fernsteuerung (Stream Deck, Companion)', h('div', { class: 'row' },
        h('code', { class: 'api-url' }, apiUrl),
        h('button', { class: 'small-btn', type: 'button', onclick: () => copyText(apiUrl) }, 'Kopieren')),
        s.httpEnabled ? 'Aufruf startet bzw. blendet die Kachel aus. Weitere Befehle: /api/play/…, /api/stop/…, /api/next/…' : 'Die HTTP-Schnittstelle ist ausgeschaltet – Einstellungen → Fernsteuerung.')
    ]);

    append(d.body, [nav, pages.general, pages.audio, pages.playback, pages.control]);
    drawStyles(); drawFile(); drawTracks(); drawCtl(); drawKind(); showPage('general');
    loadWave();

    append(d.foot, [
      h('button', { class: 'btn danger', onclick: async () => { if (await deleteTile(tab, tile)) d.close(); } }, 'Löschen'),
      h('div', { class: 'spacer' }),
      h('button', { class: 'btn', onclick: () => d.close() }, 'Abbrechen'),
      h('button', {
        class: 'btn primary',
        onclick: () => {
          const target = draft._targetTab;
          delete draft._targetTab;
          releaseHotkeyConflicts(draft);
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

  /** Doppelte Tastenkürzel/MIDI-Zuweisungen bei anderen Kacheln entfernen */
  function releaseHotkeyConflicts(t) {
    cfg.tabs.forEach((tab) => tab.tiles.forEach((o) => {
      if (o.id === t.id) return;
      if (t.hotkey && o.hotkey === t.hotkey) { o.hotkey = ''; toast('Tastenkürzel ' + t.hotkey + ' wurde von „' + o.title + '“ übernommen.', '', 4000); }
      if (t.midi && o.midi === t.midi) { o.midi = ''; toast('MIDI-Zuweisung wurde von „' + o.title + '“ übernommen.', '', 4000); }
    }));
    if (t.midi && (t.midi === cfg.settings.midiStop || t.midi === cfg.settings.midiFade)) {
      toast('Achtung: Diese MIDI-Zuweisung ist auch für Stopp/Ausblenden belegt.', 'err', 5000);
    }
  }

  function copyText(text) {
    try { navigator.clipboard.writeText(text); toast('Kopiert.', 'ok', 1500); } catch (e) { toast(text, '', 6000); }
  }

  // ---------- Wellenform mit Start-/Endmarkern

  const peakCache = new Map();

  function createWaveform(host, draft, cb) {
    const canvas = h('canvas', { class: 'wave' });
    const status = h('div', { class: 'wave-status' }, 'Wellenform wird geladen …');
    host.appendChild(canvas);
    host.appendChild(status);
    let peaks = null, duration = draft.duration || 0, raf = null, dead = false, drag = null;
    const H = 150;

    const xFor = (t, w) => (duration ? (t / duration) * w : 0);
    const tFor = (x, w) => Math.max(0, Math.min(duration, (x / w) * duration));

    function resize() {
      const w = Math.max(200, host.clientWidth || 600);
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(H * dpr);
      canvas.style.width = w + 'px';
      canvas.style.height = H + 'px';
      draw();
    }

    function draw() {
      const ctx = canvas.getContext('2d');
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.width / dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, H);
      ctx.fillStyle = '#0b0d12';
      ctx.fillRect(0, 0, w, H);
      const mid = (H - 22) / 2;
      if (peaks) {
        const n = peaks.length;
        ctx.fillStyle = '#5b8def';
        for (let i = 0; i < w; i++) {
          const p = peaks[Math.min(n - 1, Math.floor((i / w) * n))];
          const y1 = mid - p[1] * mid * 0.95, y2 = mid - p[0] * mid * 0.95;
          ctx.fillRect(i, y1, 1, Math.max(1, y2 - y1));
        }
      }
      if (duration) {
        const xs = xFor(draft.startAt || 0, w);
        const xe = draft.endAt > 0 ? xFor(Math.min(draft.endAt, duration), w) : w;
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillRect(0, 0, xs, H - 22);
        ctx.fillRect(xe, 0, w - xe, H - 22);
        // Fade-Out-Bereich vor dem Endpunkt andeuten
        if (draft.endAt > 0) {
          const fo = (draft.fadeOut == null ? cfg.settings.defaultFadeOut : draft.fadeOut) / 1000;
          const xf = Math.max(xs, xFor(Math.max(0, draft.endAt - fo), w));
          const g = ctx.createLinearGradient(xf, 0, xe, 0);
          g.addColorStop(0, 'rgba(229,56,59,0)');
          g.addColorStop(1, 'rgba(229,56,59,0.35)');
          ctx.fillStyle = g;
          ctx.fillRect(xf, 0, xe - xf, H - 22);
        }
        marker(ctx, xs, '#2fbf71', 'Start ' + (draft.startAt || 0).toFixed(1) + ' s', 'left');
        marker(ctx, xe, '#e5383b', draft.endAt > 0 ? 'Ende ' + draft.endAt.toFixed(1) + ' s' : 'Ende', 'right');
        // Abspielposition beim Vorhören
        const v = A.voicesForTile(draft.id, 'cue')[0];
        if (v && v.audio.currentTime) {
          const xp = xFor(v.audio.currentTime, w);
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(xp - 1, 0, 2, H - 22);
        }
        // Zeitachse
        ctx.fillStyle = '#8b94a8';
        ctx.font = '11px Segoe UI, sans-serif';
        ctx.textAlign = 'center';
        const stepSec = duration > 120 ? 30 : duration > 40 ? 10 : duration > 12 ? 2 : duration > 4 ? 1 : 0.5;
        for (let t = 0; t <= duration + 0.001; t += stepSec) {
          const x = xFor(t, w);
          ctx.fillRect(x, H - 22, 1, 4);
          if (x > 14 && x < w - 14) ctx.fillText(stepSec < 1 ? t.toFixed(1) : fmtTime(t), x, H - 6);
        }
      }
    }

    function marker(ctx, x, color, label, side) {
      ctx.fillStyle = color;
      ctx.fillRect(x - 1.5, 0, 3, H - 22);
      ctx.beginPath();
      ctx.arc(x, H - 34, 11, 0, Math.PI * 2);
      ctx.fill();
      ctx.font = 'bold 12px Segoe UI, sans-serif';
      ctx.textAlign = side === 'left' ? 'left' : 'right';
      ctx.fillText(label, x + (side === 'left' ? 6 : -6), 14);
    }

    function pick(e) {
      const r = canvas.getBoundingClientRect();
      const x = e.clientX - r.left, w = r.width;
      const xs = xFor(draft.startAt || 0, w);
      const xe = draft.endAt > 0 ? xFor(draft.endAt, w) : w;
      const ds = Math.abs(x - xs), de = Math.abs(x - xe);
      return { x, w, which: ds <= de ? 'start' : 'end', near: Math.min(ds, de) < 28 };
    }

    function setFrom(which, x, w) {
      let t = Math.round(tFor(x, w) * 10) / 10;
      if (which === 'start') {
        const max = (draft.endAt > 0 ? draft.endAt : duration) - 0.2;
        draft.startAt = Math.max(0, Math.min(t, max));
      } else {
        t = Math.max(t, (draft.startAt || 0) + 0.2);
        draft.endAt = t >= duration - 0.05 ? 0 : t;
      }
      draw();
      cb.onChange && cb.onChange();
    }

    canvas.addEventListener('pointerdown', (e) => {
      if (!duration) return;
      const p = pick(e);
      drag = p.which;
      canvas.setPointerCapture(e.pointerId);
      setFrom(drag, p.x, p.w);
      e.preventDefault();
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const r = canvas.getBoundingClientRect();
      setFrom(drag, e.clientX - r.left, r.width);
    });
    const end = () => { drag = null; };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);

    function loop() {
      if (dead) return;
      if (A.voicesForTile(draft.id, 'cue').length) draw();
      raf = requestAnimationFrame(loop);
    }

    (async () => {
      try {
        if (!api.readAudio) throw new Error('Wellenform nur in der Desktop-App');
        let entry = peakCache.get(draft.file);
        if (!entry) {
          const buffer = await A.decode(draft.file, api.readAudio);
          entry = { peaks: A.peaks(buffer, 1200), duration: buffer.duration };
          peakCache.set(draft.file, entry);
          if (peakCache.size > 30) peakCache.delete(peakCache.keys().next().value);
        }
        if (dead) return;
        peaks = entry.peaks;
        duration = entry.duration;
        status.remove();
        cb.onLoaded && cb.onLoaded(duration);
        resize();
      } catch (err) {
        status.textContent = 'Wellenform nicht verfügbar: ' + (err.message || err);
        resize();
      }
    })();
    resize();
    loop();

    return {
      draw, resize,
      destroy: () => { dead = true; cancelAnimationFrame(raf); }
    };
  }

  // ---------- Einstellungen

  function openSettings(opts) {
    const s = cfg.settings;
    const d = openDialog({ title: 'Einstellungen', kind: 'settings', size: 'wide', onClose: () => { cancelLearn(); renderAll(); } });

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

    // --- Lautheit: alle Kacheln analysieren
    const normAllInfo = h('p', { class: 'hint' });
    const normAllBtn = h('button', {
      class: 'small-btn',
      onclick: async () => {
        const entries = [];
        cfg.tabs.forEach((t) => t.tiles.forEach((x) => {
          if (x.kind === 'playlist') x.playlist.forEach((tr) => entries.push(tr));
          else if (x.file) entries.push(x);
        }));
        if (!entries.length) { toast('Keine Audiodateien vorhanden.', 'err'); return; }
        normAllBtn.disabled = true;
        let n = 0, failed = 0;
        for (const e of entries) {
          normAllInfo.textContent = 'Analysiere ' + (++n) + ' von ' + entries.length + ' …';
          if (!(await queueAnalysis(e, true))) failed++;
        }
        normAllBtn.disabled = false;
        normAllInfo.textContent = entries.length - failed + ' Datei(en) auf ' + s.targetLufs + ' LUFS angeglichen' + (failed ? ', ' + failed + ' nicht lesbar' : '') + '.';
        renderGrid();
      }
    }, '📊 Alle Kacheln analysieren & normalisieren');

    // --- MIDI
    const midiStatus = h('p', { class: 'hint' });
    const midiStopVal = h('span', { class: 'learn-val' });
    const midiFadeVal = h('span', { class: 'learn-val' });
    const drawMidiGlobal = () => {
      midiStopVal.textContent = s.midiStop ? midiLabel(s.midiStop) : '—';
      midiFadeVal.textContent = s.midiFade ? midiLabel(s.midiFade) : '—';
    };
    const drawMidiStatus = () => {
      const ins = midiInputs();
      midiStatus.textContent = !navigator.requestMIDIAccess || !midiAccess ? 'MIDI ist auf diesem System nicht verfügbar.'
        : ins.length ? 'Verbunden: ' + ins.join(', ') : 'Kein MIDI-Gerät angeschlossen.';
    };
    d.dlg._refreshMidi = drawMidiStatus;
    drawMidiGlobal(); drawMidiStatus();

    // --- HTTP
    const httpStatus = h('div', { class: 'hint' });
    const drawHttp = () => {
      httpStatus.innerHTML = '';
      if (!s.httpEnabled) { httpStatus.textContent = 'Aus.'; return; }
      if (!remoteInfo.running) { httpStatus.textContent = 'Nicht gestartet (Port belegt?).'; return; }
      append(httpStatus, ['Läuft – Fernbedienung im Browser: ', remoteInfo.urls.map((u, i) => [i ? ' · ' : '',
        h('a', { href: '#', style: { color: 'var(--accent)' }, onclick: (e) => { e.preventDefault(); api.openUrl(u); } }, u)])]);
    };
    let remoteTimer = null;
    const applyRemote = () => { clearTimeout(remoteTimer); remoteTimer = setTimeout(async () => { await applyRemoteSettings(true); drawHttp(); }, 400); };
    drawHttp();

    // --- Übersicht der Zuweisungen
    const keyTable = h('div', { class: 'key-table' });
    const rows = [];
    cfg.tabs.forEach((t) => t.tiles.forEach((x) => { if (x.hotkey || x.midi) rows.push([x.hotkey || '–', x.midi ? midiLabel(x.midi) : '–', x.title, t.name]); }));
    if (!rows.length) keyTable.appendChild(h('p', { class: 'hint' }, 'Noch keine Tasten oder MIDI-Signale zugewiesen.'));
    else keyTable.appendChild(h('table', null,
      h('tr', null, h('th', null, 'Taste'), h('th', null, 'MIDI'), h('th', null, 'Kachel'), h('th', null, 'Reiter')),
      rows.map((r) => h('tr', null, r.map((c) => h('td', null, c))))));

    // --- Player-Tasten
    const keysBox = h('div');
    const drawKeys = () => {
      keysBox.innerHTML = '';
      keysBox.appendChild(h('table', { class: 'keys-table' }, M.PLAYER_ACTIONS.map((a) => {
        const list = s.keys[a.id] || [];
        const cap = (slot) => h('span', { class: 'key-cap' },
          h('span', { class: 'learn-val' }, list[slot] ? keyLabel(list[slot]) : '—'),
          h('button', { class: 'small-btn', onclick: (e) => learnPlayerKey(e.currentTarget, (key) => { assignPlayerKey(a.id, slot, key); drawKeys(); }) }, list[slot] ? 'Ändern' : 'Zuweisen'),
          list[slot] ? h('button', { class: 'small-btn', title: 'Taste entfernen', onclick: () => { s.keys[a.id] = list.filter((_, i) => i !== slot); persist(); drawKeys(); } }, '✕') : null);
        return h('tr', null,
          h('td', null, a.label),
          h('td', null, cap(0), list[0] ? cap(1) : null));
      })));
    };
    drawKeys();

    // --- Live-Effekte
    const fxMidiBox = h('div');
    const drawFxMidi = () => {
      fxMidiBox.innerHTML = '';
      M.FX_MODULES.forEach((k) => {
        fxMidiBox.appendChild(field(FX_UI[k].name, h('div', { class: 'row', style: { marginBottom: '0' } },
          h('span', { class: 'learn-val' }, s.fxMidi[k] ? midiLabel(s.fxMidi[k]) : '—'),
          h('button', { class: 'small-btn', onclick: (e) => learnMidiCc(e.currentTarget, (id) => {
            Object.keys(s.fxMidi).forEach((o) => { if (s.fxMidi[o] === id) delete s.fxMidi[o]; });
            s.fxMidi[k] = id; persist(); drawFxMidi();
          }) }, '♫ Regler zuweisen'),
          s.fxMidi[k] ? h('button', { class: 'small-btn', onclick: () => { delete s.fxMidi[k]; persist(); drawFxMidi(); } }, 'Entfernen') : null)));
      });
    };
    drawFxMidi();
    const presetInp = h('input', {
      class: 'inp', type: 'text', value: s.tempoPresets.map((r) => String(r).replace('.', ',')).join('  '),
      onchange: () => {
        const vals = presetInp.value.split(/[\s;/|]+/).map((x) => Number(x.replace(',', '.').replace(/[×x]/gi, ''))).filter((x) => x > 0);
        s.tempoPresets = M.normalizePresets(vals);
        presetInp.value = s.tempoPresets.map((r) => String(r).replace('.', ',')).join('  ');
        persist();
      }
    });

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
        h('h3', null, 'Hintergrundmusik & Ducking'),
        h('p', { class: 'hint', style: { marginBottom: '8px' } }, 'Kacheln mit der Rolle „Hintergrundmusik“ (z. B. Playlists für Satzpausen) laufen unter Jingles weiter und werden währenddessen automatisch leiser. Endet der Jingle, kommt die Musik sanft zurück.'),
        h('div', { class: 'grid2' },
          field('Pegel während eines Jingles', stepper({ value: Math.round(s.duckLevel * 100), min: 0, max: 100, step: 5, format: (v) => v + ' %' + (v > 0 ? ' (' + A.linToDb(v / 100).toFixed(0) + ' dB)' : ' (stumm)'), onChange: (v) => { s.duckLevel = v / 100; A.setDucking(s.duckLevel, s.duckFadeMs); persist(); } })),
          field('Absenk- und Rückkehrzeit', stepper({ value: s.duckFadeMs, min: 0, max: 3000, step: 50, bigStep: 100, format: (v) => v + ' ms', onChange: (v) => { s.duckFadeMs = v; A.setDucking(s.duckLevel, s.duckFadeMs); persist(); } })))),

      h('div', { class: 'section' },
        h('h3', null, 'Lautheit & Pegelanzeige'),
        h('div', { class: 'grid2' },
          h('div', null,
            checkbox('Neue Dateien automatisch analysieren und normalisieren', s.normalizeOnImport, (v) => { s.normalizeOnImport = v; persist(); }),
            field('Ziel-Lautheit', stepper({ value: s.targetLufs, min: -30, max: -6, step: 1, format: (v) => v + ' LUFS', onChange: (v) => { s.targetLufs = v; persist(); } }),
              '−16 LUFS ist ein guter Wert für Hallen-PA; −14 lauter, −20 leiser. Alle Jingles werden auf diese Lautheit angeglichen, damit keiner aus der Reihe fällt.')),
          h('div', null,
            normAllBtn,
            normAllInfo,
            checkbox('Pegelanzeige (VU-Meter) in der Fußzeile', s.showMeter, (v) => { s.showMeter = v; persist(); })))),

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
        h('h3', null, 'Tastenbelegung (Player)'),
        h('p', { class: 'hint', style: { marginBottom: '8px' } }, 'Standard-Bedienung per Tastatur – je Aktion bis zu zwei Tasten. Diese Tasten haben Vorrang vor den Tastenkürzeln der Kacheln. Fest belegt: Strg+1…9/0 (Reiter der angezeigten Ebene), F11 (Vollbild). Esc schließt zuerst offene Dialoge.'),
        keysBox,
        h('div', { class: 'row', style: { marginTop: '10px' } },
          h('button', { class: 'small-btn', onclick: async () => {
            if (!(await confirmDialog('Tasten zurücksetzen?', 'Alle Player-Tasten werden auf die Standardbelegung zurückgesetzt (Enter = Stopp, Leertaste = Pause, Esc = Ausblenden …).', 'Zurücksetzen', false))) return;
            s.keys = M.defaultKeys(); persist(); drawKeys();
          } }, '⟲ Standardbelegung'))),

      h('div', { class: 'section' },
        h('h3', null, 'Live-Effekte'),
        h('p', { class: 'hint', style: { marginBottom: '8px' } }, 'Die Effektleiste (Knopf „FX“ unten) wirkt live auf alles, was über den Master-Ausgang läuft – Vorhören bleibt unbeeinflusst. Wert antippen bzw. Regler doppelklicken = zurück auf neutral.'),
        h('div', { class: 'grid2' },
          h('div', null,
            field('Regler in der Effektleiste', h('div', { class: 'fx-pick' }, M.FX_MODULES.map((k) =>
              checkbox(FX_UI[k].name, s.fxModules.includes(k), (v) => {
                s.fxModules = M.FX_MODULES.filter((m) => (m === k ? v : s.fxModules.includes(m)));
                persist();
              })))),
            field('Tempo-Stufen (Knöpfe)', presetInp, 'Zahlen mit Leerzeichen getrennt, 0,25 bis 16 – z. B. „0,5 1 1,5 2 5 10“. 1× ist immer dabei.'),
            checkbox('Tonhöhe beim Beschleunigen halten (bis 4×)', s.pitchLock, (v) => { s.pitchLock = v; A.setPitchLock(v); persist(); }),
            h('p', { class: 'hint', style: { marginBottom: '14px' } }, 'Aus: klingt wie ein schneller laufendes Band („Mickymaus“) – funktioniert bei jedem Tempo. An: gleiche Tonhöhe, nur schneller; über 4× schaltet EventDJ automatisch auf Band-Modus.'),
            field('Echo-Zeit', stepper({ value: s.echoMs, min: 50, max: 1500, step: 25, bigStep: 100, format: (v) => v + ' ms', onChange: (v) => { s.echoMs = v; A.setEchoTime(v); persist(); } })),
            checkbox('Effekte automatisch zurücksetzen, wenn nichts mehr läuft', s.fxAutoReset, (v) => { s.fxAutoReset = v; persist(); })),
          h('div', null,
            h('h4', null, 'MIDI-Regler (Fader/Drehregler)'),
            h('p', { class: 'hint', style: { marginBottom: '8px' } }, 'Jedem Effekt einen Fader oder Drehregler des MIDI-Controllers zuweisen – der Regler steuert den Effekt dann stufenlos.'),
            fxMidiBox))),

      h('div', { class: 'section' },
        h('h3', null, 'Fernsteuerung'),
        h('div', { class: 'grid2' },
          h('div', null,
            h('h4', null, 'MIDI-Controller'),
            checkbox('MIDI-Steuerung aktiv', s.midiEnabled, (v) => { s.midiEnabled = v; persist(); }),
            midiStatus,
            field('„Sofort stoppen“', h('div', { class: 'row' }, midiStopVal, h('button', { class: 'small-btn', onclick: (e) => learnMidi(e.currentTarget, (id) => { s.midiStop = id; persist(); drawMidiGlobal(); }) }, '♫ Zuweisen'), h('button', { class: 'small-btn', onclick: () => { s.midiStop = ''; persist(); drawMidiGlobal(); } }, 'Entfernen'))),
            field('„Alles ausblenden“', h('div', { class: 'row' }, midiFadeVal, h('button', { class: 'small-btn', onclick: (e) => learnMidi(e.currentTarget, (id) => { s.midiFade = id; persist(); drawMidiGlobal(); }) }, '♫ Zuweisen'), h('button', { class: 'small-btn', onclick: () => { s.midiFade = ''; persist(); drawMidiGlobal(); } }, 'Entfernen'))),
            h('p', { class: 'hint' }, 'Kacheln weist du im Kachel-Dialog unter „Steuerung“ eine Taste oder ein MIDI-Signal zu. Funktioniert mit allen USB-MIDI-Geräten (Pad-Controller, Keyboards, Akai APC/MPD, Novation Launchpad …).')),
          h('div', null,
            h('h4', null, 'HTTP-Schnittstelle (Stream Deck, Companion, Tablet)'),
            checkbox('HTTP-Fernsteuerung aktiv', s.httpEnabled, (v) => { s.httpEnabled = v; persist(); applyRemote(); }),
            field('Port', stepper({ value: s.httpPort, min: 1024, max: 65535, step: 1, noRange: true, onChange: (v) => { s.httpPort = v; persist(); applyRemote(); } })),
            checkbox('Auch im Netzwerk erreichbar (Tablet/Handy als Fernbedienung)', s.httpLan, (v) => { s.httpLan = v; persist(); applyRemote(); }),
            httpStatus,
            h('p', { class: 'hint' }, 'Stream Deck: einfachste Lösung ist die Aktion „Hotkey“ mit dem Tastenkürzel der Kachel. Alternativ mit einem Web-Request-Plugin bzw. Bitfocus Companion die Adresse /api/toggle/<Kachel-ID> aufrufen (ID im Kachel-Dialog unter „Steuerung“). Netzwerkzugriff nur in vertrauenswürdigen Netzen einschalten.'))),
        field('Belegte Tasten & MIDI-Signale', keyTable)),

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
          'Tastatur: ', h('span', { class: 'kbd' }, keysOf('stopAll') || '–'), ' sofort stoppen · ', h('span', { class: 'kbd' }, keysOf('pause') || '–'), ' Pause · ',
          h('span', { class: 'kbd' }, keysOf('fadeAll') || '–'), ' ausblenden · ', h('span', { class: 'kbd' }, 'Strg+1…9/0'), ' Reiter der Ebene · ', h('span', { class: 'kbd' }, 'F11'), ' Vollbild · alle Player-Tasten unter „Tasten“, eigene Tastenkürzel pro Kachel im Kachel-Dialog → Steuerung'),
        h('p', { class: 'hint' }, 'EventDJ ' + (info.version || '') + (info.electron ? ' · Electron ' + info.electron : '') + ' · ',
          h('a', { href: '#', style: { color: 'var(--accent)' }, onclick: (e) => { e.preventDefault(); api.openUrl('https://github.com/stadtkindd/EventDJsw'); } }, 'github.com/stadtkindd/EventDJsw')))
    ]);

    // Seiten-Navigation der Einstellungen
    const PAGE_OF = {
      'Audio-Ausgabe': 'audio', 'Lautheit & Pegelanzeige': 'audio',
      'Wiedergabe': 'play', 'Hintergrundmusik & Ducking': 'play',
      'Tastenbelegung (Player)': 'keys', 'Live-Effekte': 'fx',
      'Kachel-Stile (Eigenschaften)': 'look', 'Darstellung': 'look',
      'Fernsteuerung': 'remote',
      'Daten & Sicherung': 'data', 'Bedienung & Info': 'data'
    };
    const sections = Array.from(d.body.querySelectorAll(':scope > .section'));
    const showSettingsPage = (pg) => sections.forEach((sec) => { sec.hidden = PAGE_OF[sec.querySelector('h3').textContent] !== pg; });
    const PAGES = [['audio', 'Audio'], ['play', 'Wiedergabe'], ['keys', 'Tasten'], ['fx', 'Effekte'], ['look', 'Aussehen'], ['remote', 'Fernsteuerung'], ['data', 'Daten & Info']];
    const navEl = segmented(PAGES, 'audio', showSettingsPage);
    navEl.classList.add('page-nav');
    d.body.insertBefore(navEl, d.body.firstChild);
    showSettingsPage(opts && opts.page || 'audio');
    if (opts && opts.page) navEl.querySelectorAll('button').forEach((b, i) => b.classList.toggle('sel', PAGES[i][0] === opts.page));

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
    cfg.tabs.forEach((t) => t.tiles.forEach((x) => used.push(...M.tileFiles(x))));
    cfg.player.tracks.forEach((tr) => used.push(tr.file));
    const r = await api.cleanupLibrary(used);
    toast(r.removed + ' ungenutzte Datei(en) entfernt.', 'ok');
  }

  // ================================================================ Fernsteuerung: Tastatur, MIDI, HTTP


  /** Tastenkombination als Text, z. B. "F1", "Q", "Num5", "Ctrl+Shift+A" */
  function hotkeyFromEvent(e) {
    if (['Control', 'Shift', 'Alt', 'Meta', 'AltGraph', 'CapsLock', 'Dead', 'Unidentified'].includes(e.key)) return '';
    let key;
    if (/^Key[A-Z]$/.test(e.code)) key = e.code.slice(3);
    else if (/^Digit\d$/.test(e.code)) key = e.code.slice(5);
    else if (e.code === 'NumpadEnter') key = 'Enter';
    else if (/^Numpad/.test(e.code)) key = 'Num' + e.code.slice(6);
    else if (e.code === 'Space') key = 'Space';
    else if (/^F\d{1,2}$/.test(e.key)) key = e.key;
    else key = e.key.length === 1 ? e.key.toUpperCase() : e.key;
    const mods = [];
    if (e.ctrlKey) mods.push('Ctrl');
    if (e.altKey) mods.push('Alt');
    if (e.shiftKey) mods.push('Shift');
    return mods.concat(key).join('+');
  }

  function findTileByHotkey(key) {
    for (const tab of cfg.tabs) for (const t of tab.tiles) if (t.hotkey && t.hotkey.toLowerCase() === String(key).toLowerCase()) return t;
    return null;
  }

  let learnState = null;
  function cancelLearn() {
    if (!learnState) return;
    const st = learnState;
    learnState = null;
    if (st.keyHandler) document.removeEventListener('keydown', st.keyHandler, true);
    st.btn.classList.remove('learning');
    st.btn.textContent = st.label;
  }

  function learnHotkey(btn, done) {
    cancelLearn();
    const label = btn.textContent;
    btn.classList.add('learning');
    btn.textContent = 'Taste drücken … (Esc = abbrechen)';
    const keyHandler = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape' && !e.shiftKey) { cancelLearn(); return; }
      const key = hotkeyFromEvent(e);
      if (!key) return;
      if (FIXED_KEYS.includes(key)) { toast(key + ' ist für EventDJ reserviert – bitte eine andere Taste wählen.', 'err'); return; }
      const act = actionForKey(key);
      if (act) { toast(key + ' ist dem Player zugewiesen („' + actionLabel(act) + '“). Änderbar unter Einstellungen → Tasten.', 'err', 5000); return; }
      cancelLearn();
      done(key);
    };
    learnState = { btn, label, keyHandler };
    document.addEventListener('keydown', keyHandler, true);
  }

  // ---------- MIDI

  let midiAccess = null;
  const ccState = new Map();

  function midiLabel(id) {
    const m = /^(note|cc|pc):(\d+):(\d+)$/.exec(id || '');
    if (!m) return id || '';
    const names = { note: 'Note', cc: 'CC', pc: 'Programm' };
    let extra = '';
    if (m[1] === 'note') {
      const n = Number(m[3]);
      extra = ' (' + ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'H'][n % 12] + (Math.floor(n / 12) - 1) + ')';
    }
    return names[m[1]] + ' ' + m[3] + extra + ' · Kanal ' + m[2];
  }

  async function initMidi() {
    if (!navigator.requestMIDIAccess) return;
    try {
      midiAccess = await navigator.requestMIDIAccess({ sysex: false });
    } catch (e) {
      midiAccess = null;
      return;
    }
    const hook = () => midiAccess.inputs.forEach((inp) => { inp.onmidimessage = onMidiMessage; });
    hook();
    midiAccess.onstatechange = (e) => {
      hook();
      if (e.port && e.port.type === 'input') {
        if (e.port.state === 'connected' && e.port.connection !== 'open') toast('MIDI-Gerät verbunden: ' + e.port.name, 'ok', 2500);
        if (e.port.state === 'disconnected') toast('MIDI-Gerät getrennt: ' + e.port.name, 'err', 4000);
      }
      const dlg = document.querySelector('.dialog[data-kind=settings]');
      if (dlg && dlg._refreshMidi) dlg._refreshMidi();
    };
  }

  function midiInputs() {
    const out = [];
    if (midiAccess) midiAccess.inputs.forEach((i) => out.push(i.name || 'MIDI-Gerät'));
    return out;
  }

  function onMidiMessage(e) {
    const [status, d1, d2] = e.data;
    const type = status & 0xf0, ch = (status & 0x0f) + 1;
    if (type === 0xb0) {
      const cc = 'cc:' + ch + ':' + d1;
      if (learnState && learnState.ccDone) { const done = learnState.ccDone; cancelLearn(); done(cc); return; }
      const fxName = cfg.settings.midiEnabled && Object.keys(cfg.settings.fxMidi).find((k) => cfg.settings.fxMidi[k] === cc);
      if (fxName) { fxFromMidi(fxName, d2); return; }
    }
    let id = null;
    if (type === 0x90 && d2 > 0) id = 'note:' + ch + ':' + d1;
    else if (type === 0xb0) {
      const key = 'cc:' + ch + ':' + d1;
      const prev = ccState.get(key) || 0;
      ccState.set(key, d2);
      if (d2 >= 64 && prev < 64) id = key; // nur bei steigender Flanke auslösen
    } else if (type === 0xc0) id = 'pc:' + ch + ':' + d1;
    if (!id) return;
    if (learnState && learnState.midiDone) {
      const done = learnState.midiDone;
      cancelLearn();
      done(id);
      return;
    }
    if (!cfg.settings.midiEnabled || topDialog()) return;
    if (id === cfg.settings.midiStop) { A.stopAll(false); return; }
    if (id === cfg.settings.midiFade) { A.stopAll(true); return; }
    for (const tab of cfg.tabs) for (const t of tab.tiles) if (t.midi === id) { triggerTile(t, 'master'); return; }
  }

  /** MIDI-Regler (CC) für einen Effekt lernen – jede Bewegung zählt */
  function learnMidiCc(btn, done) {
    learnMidi(btn, done);
    if (learnState) { learnState.ccDone = done; learnState.btn.textContent = 'Regler/Fader am MIDI-Gerät bewegen … (Esc = abbrechen)'; }
  }

  function learnMidi(btn, done) {
    if (!midiAccess) { toast('MIDI ist nicht verfügbar – ist ein MIDI-Gerät angeschlossen?', 'err'); return; }
    if (!midiInputs().length) { toast('Kein MIDI-Eingang gefunden. Gerät anschließen und erneut versuchen.', 'err'); return; }
    cancelLearn();
    const label = btn.textContent;
    btn.classList.add('learning');
    btn.textContent = 'Taste/Regler am MIDI-Gerät betätigen … (Esc = abbrechen)';
    const keyHandler = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancelLearn(); } };
    document.addEventListener('keydown', keyHandler, true);
    learnState = { btn, label, keyHandler, midiDone: done };
  }

  // ---------- HTTP (Stream Deck, Companion, Tablet-Fernbedienung)

  let remoteInfo = { running: false, urls: [] };

  async function applyRemoteSettings(silent) {
    if (!api.remoteConfigure) return remoteInfo;
    const s = cfg.settings;
    const r = await api.remoteConfigure({ enabled: s.httpEnabled, port: s.httpPort, lan: s.httpLan });
    remoteInfo = r || remoteInfo;
    if (r && r.ok === false) toast('Fernsteuerung: ' + r.error, 'err', 6000);
    else if (!silent && r && r.running) toast('Fernsteuerung aktiv: ' + r.urls[0], 'ok');
    publishState();
    return remoteInfo;
  }

  let stateTimer = null;
  function publishState() {
    if (!api.remoteState || !cfg) return;
    clearTimeout(stateTimer);
    stateTimer = setTimeout(() => {
      const playing = [];
      A.voices.forEach((v) => { if (v.bus === 'master' && !playing.includes(v.tileId)) playing.push(v.tileId); });
      api.remoteState({
        activeTab: orderedTabs().findIndex((t) => t.id === cfg.activeTabId) + 1,
        tabs: orderedTabs().map((t) => ({
          id: t.id, name: t.name, color: t.color, layer: (t.layer || 0) + 1,
          tiles: t.tiles.slice().sort((a, b) => a.slot - b.slot).map((x) => {
            const look = M.resolveLook(cfg, x);
            return { id: x.id, title: x.title, bg: look.bg, fg: look.fg, hotkey: x.hotkey, playCount: x.playCount, kind: x.kind };
          })
        })),
        playing,
        paused: A.paused,
        fx: Object.assign({}, A.fx)
      });
    }, 80);
  }

  function onRemoteCommand(c) {
    const found = c.id ? findTile(c.id) : null;
    switch (c.cmd) {
      case 'toggle': if (found) triggerTile(found.tile, 'master'); break;
      case 'play': if (found) startTile(found.tile); break;
      case 'stop': if (found) A.stopTile(found.tile.id, true, 'master'); break;
      case 'next': if (found) A.next(found.tile.id); break;
      case 'key': { const t = findTileByHotkey(c.key); if (t) triggerTile(t, 'master'); break; }
      case 'fade': A.stopAll(true); break;
      case 'stopall': A.stopAll(false); break;
      case 'tab': { const t = orderedTabs()[c.index]; if (t) selectTab(t.id); break; }
      case 'reset': M.resetCounters(cfg); persist(); renderGrid(); toast('Zähler per Fernsteuerung zurückgesetzt.', 'ok'); break;
      case 'pause': if (A.voices.size) A.togglePause(); break;
      case 'tempo': A.setFx('tempo', c.value); break;
      case 'fx': A.setFx(c.name, c.value); break;
      case 'fxreset': A.resetFx(); break;
      case 'music': playerToggle(); break;
      case 'musicnext': playerNext(); break;
      case 'musicfade': playerFade(); break;
    }
  }

  // ================================================================ Live-Effekte

  const numDe = (v, d) => v.toFixed(d).replace('.', ',');
  const fmtRate = (r) => (Math.abs(r - Math.round(r)) < 0.005 ? String(Math.round(r)) : numDe(r, r < 1 ? 2 : 1).replace(/0$/, '')) + '×';
  const signed = (v, d, unit) => (v > 0 ? '+' : v < 0 ? '−' : '') + numDe(Math.abs(v), d) + unit;

  // Tempo-Regler: logarithmisch 0,25× … 16× (Reglerposition 0 … 1000), 1× genau in der Mitte des unteren Bereichs
  const TEMPO_MIN = 0.25, TEMPO_MAX = 16;
  const tempoToPos = (r) => Math.round((Math.log(r / TEMPO_MIN) / Math.log(TEMPO_MAX / TEMPO_MIN)) * 1000);
  const posToTempo = (p) => {
    let r = TEMPO_MIN * Math.pow(TEMPO_MAX / TEMPO_MIN, p / 1000);
    // in der Nähe der Stufen einrasten
    const snap = cfg.settings.tempoPresets.concat([0.5, 1.5]).find((x) => Math.abs(Math.log(r / x)) < 0.035);
    if (snap) r = snap;
    return Math.round(r * 100) / 100;
  };

  const FX_UI = {
    tempo: { name: 'Tempo', hint: 'Geschwindigkeit der laufenden Titel' },
    bass: { name: 'Bass', min: -12, max: 15, step: 0.5, fmt: (v) => (v ? signed(v, 1, ' dB') : '0 dB') },
    treble: { name: 'Höhen', min: -12, max: 12, step: 0.5, fmt: (v) => (v ? signed(v, 1, ' dB') : '0 dB') },
    filter: { name: 'Filter', min: -100, max: 100, step: 1, fmt: (v) => (v === 0 ? 'aus' : v < 0 ? 'dumpf ' + -v + '%' : 'dünn ' + v + '%'), hint: 'links: dumpf (Tiefpass) · rechts: dünn wie Telefon (Hochpass)' },
    hall: { name: 'Hall', min: 0, max: 100, step: 1, fmt: (v) => (v ? v + ' %' : 'aus') },
    echo: { name: 'Echo', min: 0, max: 100, step: 1, fmt: (v) => (v ? v + ' %' : 'aus') }
  };

  let fxEls = {};
  let fxSel = null;   // per Pfeiltasten gewählter Regler

  // Feinschritte für die Pfeiltasten (mit Umschalt ×5)
  const FX_STEP = { bass: 0.5, treble: 0.5, filter: 2, hall: 2, echo: 2 };

  function selectFx(name) {
    if (!cfg.settings.fxModules.includes(name)) return;
    fxSel = name;
    Object.keys(fxEls).forEach((k) => fxEls[k].box.classList.toggle('sel', k === fxSel));
  }

  function currentFxSel() {
    const mods = cfg.settings.fxModules;
    if (!fxSel || !mods.includes(fxSel)) fxSel = mods[0] || null;
    return fxSel;
  }

  function fxSelStep(dir) {
    const mods = cfg.settings.fxModules;
    if (!mods.length) return;
    const i = mods.indexOf(currentFxSel());
    selectFx(mods[(i + dir + mods.length) % mods.length]);
  }

  /** gewählten Regler fein verstellen (Tempo: ca. 2 % je Schritt) */
  function fxNudge(dir, coarse) {
    const name = currentFxSel();
    if (!name) return;
    const k = coarse ? 5 : 1;
    if (name === 'tempo') {
      const r = A.fx.tempo * Math.pow(1.02, dir * k);
      // 1× nicht überspringen
      const cur = A.fx.tempo;
      A.setFx('tempo', (cur < 1 && r > 1) || (cur > 1 && r < 1) ? 1 : Math.round(r * 100) / 100);
    } else {
      const d = A.fxDefs[name];
      const v = Math.round((A.fx[name] + dir * k * FX_STEP[name]) * 100) / 100;
      // Nullpunkt bei Reglern mit Mitte einrasten
      A.setFx(name, (A.fx[name] < 0 && v > 0) || (A.fx[name] > 0 && v < 0) ? 0 : Math.min(d.max, Math.max(d.min, v)));
    }
    if (!cfg.settings.fxBarOpen) toast(FX_UI[name].name + ': ' + (name === 'tempo' ? fmtRate(A.fx.tempo) : FX_UI[name].fmt(A.fx[name])), '', 900);
  }

  /** laufende Kachel, auf die „Auf Kachel speichern“ wirkt: zuletzt gestarteter Jingle (sonst Hintergrundmusik) */
  function fxTargetTile() {
    let best = null;
    A.voices.forEach((v) => {
      if (v.bus !== 'master' || v.state === 'fading') return;
      const f = findTile(v.tileId);
      if (!f) return;
      const score = (v.role === 'bed' ? 0 : 1e13) + v.startedAt;
      if (!best || score > best.score) best = { score, voice: v, tile: f.tile };
    });
    return best;
  }

  /** Live-Effekte dauerhaft in die laufende Kachel übernehmen */
  async function saveFxToTile() {
    const t = fxTargetTile();
    if (!t) { toast('Es läuft gerade keine Kachel – starte den Jingle, stelle die Effekte ein und speichere dann.', 'err', 5000); return; }
    if (!A.fxActive()) { toast('Es ist kein Live-Effekt aktiv.', 'err'); return; }
    if (!(await confirmDialog('Effekte speichern?', 'Die aktuellen Live-Effekte werden in der Kachel „' + t.tile.title + '“ gespeichert und klingen künftig bei jedem Abspielen mit. Die Effektleiste wird danach zurückgesetzt.', 'Speichern', false))) return;
    const merged = mergeFx(t.tile.fx, A.fx);
    t.tile.fx = M.normalizeFx(merged);
    A.resetFx();
    A.voicesForTile(t.tile.id).forEach((v) => A.setVoiceFx(v, t.tile.fx));
    persist();
    renderGrid();
    toast('Effekte in „' + t.tile.title + '“ gespeichert (Kachel-Dialog → Wiedergabe).', 'ok', 4000);
  }

  /** Kachel-Effekte + Live-Effekte zusammenfassen (Tempo multipliziert, Rest addiert) */
  function mergeFx(a, b) {
    a = a || {}; b = b || {};
    const out = {};
    M.FX_MODULES.forEach((k) => {
      const r = M.FX_RANGES[k];
      const x = a[k] == null ? r.neutral : a[k], y = b[k] == null ? r.neutral : b[k];
      out[k] = Math.min(r.max, Math.max(r.min, k === 'tempo' ? x * y : x + y));
    });
    return out;
  }

  function renderFxBar() {
    const bar = $('#fxbar');
    const s = cfg.settings;
    bar.hidden = !s.fxBarOpen;
    $('#btn-fx').classList.toggle('on', s.fxBarOpen);
    bar.innerHTML = '';
    fxEls = {};
    const mods = s.fxModules;
    if (!mods.length) bar.appendChild(h('div', { class: 'fx-empty' }, 'Keine Effekte ausgewählt – unter ⚙ Einstellungen → Effekte festlegen.'));
    mods.forEach((name) => {
      const ui = FX_UI[name];
      const val = h('button', { class: 'fx-val', title: 'Zurücksetzen', onclick: () => A.setFx(name, A.fxDefs[name].neutral) });
      const reset = h('button', { class: 'fx-reset', title: ui.name + ' zurücksetzen', onclick: () => A.setFx(name, A.fxDefs[name].neutral) }, '⟲');
      const slider = name === 'tempo'
        ? h('input', { type: 'range', min: '0', max: '1000', step: '1', 'aria-label': ui.name })
        : h('input', { type: 'range', min: String(ui.min), max: String(ui.max), step: String(ui.step), 'aria-label': ui.name });
      slider.addEventListener('input', () => A.setFx(name, name === 'tempo' ? posToTempo(Number(slider.value)) : Number(slider.value)));
      slider.addEventListener('dblclick', () => A.setFx(name, A.fxDefs[name].neutral));
      const box = h('div', { class: 'fx ' + name, title: ui.hint || '' },
        h('div', { class: 'fx-head' }, h('span', { class: 'fx-name' }, ui.name), val, reset),
        slider);
      // antippen = Regler für die Pfeiltasten auswählen
      box.addEventListener('pointerdown', () => selectFx(name));
      let presets = null;
      if (name === 'tempo') {
        presets = h('div', { class: 'fx-presets' }, s.tempoPresets.map((r) =>
          h('button', { dataset: { rate: String(r) }, onclick: () => A.setFx('tempo', r) }, fmtRate(r))));
        box.appendChild(presets);
      }
      bar.appendChild(box);
      fxEls[name] = { box, val, slider, presets, reset };
    });
    selectFx(currentFxSel());
    bar.appendChild(h('div', { class: 'fx-side' },
      h('button', { class: 'danger', title: 'Alle Effekte auf neutral', onclick: () => A.resetFx() }, '⟲ Alle aus'),
      h('button', { title: 'Aktuelle Effekte dauerhaft in der laufenden Kachel speichern', onclick: saveFxToTile }, '💾 Auf Kachel'),
      h('button', { title: 'Effektleiste einrichten', onclick: () => openSettings({ page: 'fx' }) }, '⚙ Einrichten')));
    updateFxBar();
  }

  function updateFxBar() {
    Object.keys(fxEls).forEach((name) => {
      const e = fxEls[name];
      const v = A.fx[name];
      const changed = Math.abs(v - A.fxDefs[name].neutral) > 1e-6;
      e.box.classList.toggle('changed', changed);
      e.reset.disabled = !changed;
      if (name === 'tempo') {
        e.val.textContent = fmtRate(v);
        if (document.activeElement !== e.slider) e.slider.value = String(tempoToPos(v));
        e.presets.querySelectorAll('button').forEach((b) => b.classList.toggle('sel', Math.abs(Number(b.dataset.rate) - v) < 0.005));
      } else {
        e.val.textContent = FX_UI[name].fmt(v);
        if (document.activeElement !== e.slider) e.slider.value = String(v);
      }
    });
    $('#btn-fx').classList.toggle('active', A.fxActive());
    $('#btn-fx').title = 'Live-Effekte ein-/ausblenden' + (A.fxActive() ? ' – Effekte aktiv!' : '');
  }

  function toggleFxBar(open) {
    cfg.settings.fxBarOpen = open == null ? !cfg.settings.fxBarOpen : !!open;
    persist();
    renderFxBar();
  }

  /** Tempo eine Stufe hoch/runter (Stufen aus den Einstellungen) */
  function tempoStep(dir) {
    const list = cfg.settings.tempoPresets;
    const cur = A.fx.tempo;
    const next = dir > 0 ? list.find((r) => r > cur + 0.005) : list.slice().reverse().find((r) => r < cur - 0.005);
    if (next != null) A.setFx('tempo', next);
    toast('Tempo ' + fmtRate(A.fx.tempo), '', 1200);
  }

  /** MIDI-Regler (CC 0…127) auf einen Effekt abbilden */
  function fxFromMidi(name, value) {
    const x = value / 127;
    if (name === 'tempo') { A.setFx('tempo', posToTempo(x * 1000)); return; }
    const d = A.fxDefs[name];
    let v = d.min + x * (d.max - d.min);
    // Mittelstellung bei Reglern mit Null in der Mitte einrasten lassen
    if (d.min < 0 && Math.abs(v) < (d.max - d.min) * 0.03) v = 0;
    A.setFx(name, Math.round(v / FX_UI[name].step) * FX_UI[name].step);
  }

  function fxSummary(fx) {
    return Object.keys(fx || {}).map((k) => FX_UI[k].name + ' ' + (k === 'tempo' ? fmtRate(fx[k]) : FX_UI[k].fmt(fx[k]))).join(', ');
  }

  // ================================================================ Pausenmusik-Player

  const PLAYER_ID = '__player';
  let plEls = null;

  function playerVoice() {
    return A.voicesForTile(PLAYER_ID, 'master').find((v) => v.state !== 'fading') || null;
  }

  function playerTrackList() {
    return cfg.player.tracks.map((tr) => ({ file: tr.file, gainDb: tr.gainDb, title: M.titleFromFileName(tr.fileName || tr.file), ref: tr }));
  }

  /** Index (in cfg.player.tracks) des gerade laufenden Titels */
  function playerCurrentIndex(v) {
    v = v || playerVoice();
    if (!v) return -1;
    const i = A.currentTrackIndex(v);
    const t = i >= 0 && v.tracks[i];
    return t ? cfg.player.tracks.indexOf(t.ref) : -1;
  }

  function playerStart(index) {
    const P = cfg.player;
    if (!P.tracks.length) { toast('Die Pausenmusik-Liste ist leer – Titel hinzufügen.', 'err'); openPlayerPanel(); return; }
    const v = playerVoice();
    if (v) {
      if (index == null) { A.toggleVoicePause(v); return; }
      const tl = v.tracks.findIndex((t) => t.ref === P.tracks[index]);
      if (tl >= 0) { A.jumpTo(v, tl); return; }
    }
    // andere Hintergrundmusik verdrängen (wie bei Kacheln mit Rolle „Hintergrundmusik“)
    if (cfg.settings.playMode === 'exclusive') A.stopBus('master', true, null, (x) => x.role === 'bed' && x.tileId !== PLAYER_ID);
    A.stopTile(PLAYER_ID, true, 'master');
    A.play({ id: PLAYER_ID, title: 'Pausenmusik' }, {
      bus: 'master', tracks: playerTrackList(), shuffle: P.shuffle, loop: P.repeat, role: 'bed', duck: P.duck,
      volume: P.volume, fadeIn: 800, fadeOut: P.fadeOutMs, startIndex: index == null ? undefined : index
    });
  }

  function playerToggle() { playerStart(null); }
  function playerNext() { const v = playerVoice(); if (v) A.next(PLAYER_ID); else playerStart(null); }
  function playerPrev() { const v = playerVoice(); if (v) A.prev(v); }
  function playerFade() { A.voicesForTile(PLAYER_ID, 'master').forEach((v) => A.stop(v.id, true, cfg.player.fadeOutMs)); }
  function playerStopNow() { A.stopTile(PLAYER_ID, false, 'master'); }

  /** nach Änderungen an der Liste die laufende Wiedergabe nachführen */
  function playerSync() {
    const v = playerVoice();
    if (v) {
      const curRef = (v.tracks[A.currentTrackIndex(v)] || {}).ref;
      const list = playerTrackList();
      A.setTracks(v, list, list.findIndex((t) => t.ref === curRef), cfg.player.shuffle);
      A.setVoiceLoop(v, cfg.player.repeat);
      A.setVoiceDuck(v, cfg.player.duck);
      A.setVoiceVolume(v, cfg.player.volume);
    }
    persist();
    renderPlayer();
  }

  function openPlayerPanel() { if (!cfg.player.open) togglePlayerPanel(true); }
  function togglePlayerPanel(open) {
    cfg.player.open = open == null ? !cfg.player.open : !!open;
    persist();
    renderPlayer();
  }

  async function playerAddFiles(paths) {
    const audio = paths.filter((p) => M.isAudioFile(p) || /^blob:/.test(p));
    if (audio.length < paths.length) toast((paths.length - audio.length) + ' Datei(en) übersprungen (kein Audioformat).', 'err');
    if (!audio.length) return;
    const res = await api.importFiles(audio, cfg.settings.copyToLibrary);
    const added = [];
    res.forEach((r) => {
      if (!r.ok) { toast('Import fehlgeschlagen: ' + r.source + ' – ' + r.error, 'err', 6000); return; }
      const tr = M.normalizeTrack({ file: r.path, fileName: fileNames.get(r.path) || r.name });
      cfg.player.tracks.push(tr);
      missing.delete(tr.file);
      added.push(tr);
    });
    playerSync();
    if (added.length) toast(added.length + ' Titel zur Pausenmusik hinzugefügt.', 'ok');
    for (const tr of added) { tr.duration = Math.max(0, await A.probeDuration(tr.file)); renderPlayerList(); }
    persist();
    if (cfg.settings.normalizeOnImport) for (const tr of added) { await queueAnalysis(tr, true); }
    playerSync();
  }

  function renderPlayer() {
    const box = $('#player');
    const P = cfg.player;
    box.hidden = !P.open;
    $('#btn-player').classList.toggle('on', P.open);
    $('#btn-player').classList.toggle('active', !!A.voicesForTile(PLAYER_ID, 'master').length);
    if (!P.open) { plEls = null; return; }
    box.innerHTML = '';
    const title = h('div', { class: 'pl-title' });
    const sub = h('div', { class: 'pl-sub' });
    const seek = h('input', { type: 'range', min: '0', max: '1000', step: '1', value: '0', class: 'pl-seek', 'aria-label': 'Position' });
    const tCur = h('span'), tRem = h('span');
    seek.addEventListener('input', () => {
      const v = playerVoice();
      if (v && Number.isFinite(v.audio.duration)) A.seek(v, (Number(seek.value) / 1000) * v.audio.duration);
    });
    const playBtn = h('button', { class: 'pl-btn big', title: 'Start / Pause', onclick: playerToggle }, '▶');
    const tog = (label, key, title) => h('button', {
      class: 'pl-tog' + (P[key] ? ' on' : ''), title,
      onclick: () => { P[key] = !P[key]; playerSync(); }
    }, label);
    const vol = h('input', { type: 'range', min: '0', max: '100', step: '1', value: String(Math.round(P.volume * 100)), 'aria-label': 'Lautstärke Pausenmusik' });
    const volVal = h('span', { class: 'pl-volval' }, Math.round(P.volume * 100) + '%');
    vol.addEventListener('input', () => {
      P.volume = Number(vol.value) / 100;
      volVal.textContent = vol.value + '%';
      A.setVoiceVolume(playerVoice(), P.volume);
      persist();
    });
    const list = h('div', { class: 'pl-list' });
    const fadeSel = segmented([['1000', '1 s'], ['3000', '3 s'], ['5000', '5 s'], ['10000', '10 s']], String(P.fadeOutMs), (v) => { P.fadeOutMs = Number(v); persist(); });
    fadeSel.title = 'Ausblendzeit';

    append(box, [
      h('div', { class: 'pl-head' },
        h('span', { class: 'pl-h' }, '♫ Pausenmusik'),
        h('span', { class: 'pl-count' }),
        h('button', { class: 'pl-x', title: 'Player ausblenden (Musik läuft weiter)', onclick: () => togglePlayerPanel(false) }, '✕')),
      h('div', { class: 'pl-now' }, title, sub, seek, h('div', { class: 'pl-times' }, tCur, tRem)),
      h('div', { class: 'pl-ctrl' },
        h('button', { class: 'pl-btn', title: 'Zurück / Titelanfang', onclick: playerPrev }, '⏮'),
        playBtn,
        h('button', { class: 'pl-btn', title: 'Nächster Titel', onclick: playerNext }, '⏭'),
        h('button', { class: 'pl-btn', title: 'Sofort stoppen', onclick: playerStopNow }, '■')),
      h('div', { class: 'pl-fadetime' },
        h('button', { class: 'pl-fade', title: 'Pausenmusik sanft ausblenden', onclick: playerFade }, '▼ Ausblenden'),
        fadeSel),
      h('div', { class: 'pl-toggles' },
        tog('⤮ Zufall', 'shuffle', 'Zufällige Reihenfolge'),
        tog('⟳ Endlos', 'repeat', 'Liste endlos wiederholen'),
        tog('▽ Ducking', 'duck', 'Unter Jingles automatisch leiser')),
      h('div', { class: 'pl-vol' }, h('span', null, 'Lautstärke'), vol, volVal),
      list,
      h('div', { class: 'pl-add' },
        h('button', { class: 'small-btn', onclick: async () => { const p = await api.pickAudio(true); if (p && p.length) playerAddFiles(p); } }, '+ Titel'),
        h('button', { class: 'small-btn', title: 'Alle Titel entfernen', disabled: !P.tracks.length, onclick: async () => {
          if (!(await confirmDialog('Liste leeren?', 'Alle ' + P.tracks.length + ' Titel aus der Pausenmusik entfernen? (Die Dateien bleiben erhalten.)', 'Leeren', true))) return;
          playerStopNow(); P.tracks = []; playerSync();
        } }, '🗑 Leeren'))
    ]);
    // Dateien direkt in den Player ziehen
    box.ondragover = (e) => { if (Array.from(e.dataTransfer.types).includes('Files')) { e.preventDefault(); e.stopPropagation(); box.classList.add('drag-over'); } };
    box.ondragleave = () => box.classList.remove('drag-over');
    box.ondrop = (e) => {
      if (!Array.from(e.dataTransfer.types).includes('Files')) return;
      e.preventDefault(); e.stopPropagation(); box.classList.remove('drag-over');
      playerAddFiles(Array.from(e.dataTransfer.files).map((f) => { const p = api.pathForFile(f); if (p) fileNames.set(p, f.name); return p; }).filter(Boolean));
    };
    plEls = { title, sub, seek, tCur, tRem, playBtn, list, count: box.querySelector('.pl-count') };
    renderPlayerList();
    updatePlayer();
  }

  function renderPlayerList() {
    if (!plEls) return;
    const P = cfg.player;
    const list = plEls.list;
    list.innerHTML = '';
    plEls.count.textContent = P.tracks.length ? P.tracks.length + ' Titel · ' + fmtTime(P.tracks.reduce((a, t) => a + (t.duration || 0), 0)) : '';
    if (!P.tracks.length) {
      list.appendChild(h('div', { class: 'pl-empty' }, 'Noch keine Titel. Audiodateien hierher ziehen oder „+ Titel hinzufügen“.'));
      return;
    }
    const cur = playerCurrentIndex();
    const move = (i, d) => { const [x] = P.tracks.splice(i, 1); P.tracks.splice(i + d, 0, x); playerSync(); };
    P.tracks.forEach((tr, i) => {
      const row = h('div', { class: 'pl-row' + (i === cur ? ' cur' : '') + (missing.has(tr.file) ? ' missing' : ''), title: 'Antippen = diesen Titel spielen' },
        h('span', { class: 'pl-no' }, i === cur ? '♪' : String(i + 1)),
        h('span', { class: 'pl-name' }, M.titleFromFileName(tr.fileName || tr.file), h('small', null, tr.duration ? fmtTime(tr.duration) : '')),
        h('span', { class: 'pl-acts' },
          h('button', { title: 'Nach oben', disabled: i === 0, onclick: (e) => { e.stopPropagation(); move(i, -1); } }, '▲'),
          h('button', { title: 'Nach unten', disabled: i === P.tracks.length - 1, onclick: (e) => { e.stopPropagation(); move(i, 1); } }, '▼'),
          h('button', { title: 'Aus der Liste entfernen', onclick: (e) => { e.stopPropagation(); P.tracks.splice(i, 1); playerSync(); } }, '✕')));
      row.addEventListener('click', () => playerStart(i));
      list.appendChild(row);
    });
  }

  /** Anzeige (Titel, Zeit, Knöpfe) – wird laufend aufgerufen */
  let plLastCur = -2;
  function updatePlayer() {
    $('#btn-player').classList.toggle('active', !!A.voicesForTile(PLAYER_ID, 'master').length);
    if (!plEls) return;
    const all = A.voicesForTile(PLAYER_ID, 'master');
    const v = playerVoice() || all[0];
    const cur = playerCurrentIndex(v);
    if (cur !== plLastCur) { plLastCur = cur; renderPlayerList(); }
    if (!v) {
      plEls.title.textContent = cfg.player.tracks.length ? 'Bereit' : 'Keine Titel';
      plEls.sub.textContent = cfg.player.tracks.length ? 'Antippen ▶ oder einen Titel wählen' : '';
      plEls.playBtn.textContent = '▶';
      plEls.seek.value = '0'; plEls.tCur.textContent = ''; plEls.tRem.textContent = '';
      return;
    }
    plEls.title.textContent = v.trackTitle || 'Pausenmusik';
    plEls.sub.textContent = v.state === 'fading' ? 'blendet aus …' : v.paused ? 'Pause' : (A.isBedDucked() && v.duck ? 'abgesenkt (Jingle läuft)' : 'läuft');
    plEls.playBtn.textContent = v.paused || v.state === 'fading' ? '▶' : '❚❚';
    const a = v.audio;
    const dur = Number.isFinite(a.duration) ? a.duration : 0;
    if (document.activeElement !== plEls.seek) plEls.seek.value = dur ? String(Math.round((a.currentTime / dur) * 1000)) : '0';
    plEls.tCur.textContent = fmtTime(a.currentTime || 0);
    plEls.tRem.textContent = dur ? '−' + fmtTime((dur - a.currentTime) / (a.playbackRate || 1)) : '';
  }

  // ================================================================ Player-Aktionen (Tastatur)

  const FIXED_KEYS = ['F11', 'F12', 'Ctrl+R'].concat([0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => 'Ctrl+' + n));

  function actionForKey(key) {
    if (!key) return null;
    const k = String(key).toLowerCase();
    const map = cfg.settings.keys;
    const a = M.PLAYER_ACTIONS.find((x) => (map[x.id] || []).some((y) => y.toLowerCase() === k));
    return a ? a.id : null;
  }

  function actionLabel(id) { const a = M.PLAYER_ACTIONS.find((x) => x.id === id); return a ? a.label : id; }

  /** Taste deutsch beschriften (Speicherung bleibt englisch, z. B. "Ctrl+Space") */
  const KEY_NAMES = { Ctrl: 'Strg', Shift: 'Umschalt', Space: 'Leertaste', Escape: 'Esc', PageDown: 'Bild↓', PageUp: 'Bild↑',
    Backspace: 'Rücktaste', Delete: 'Entf', Insert: 'Einfg', NumAdd: 'Num +', NumSubtract: 'Num −', NumMultiply: 'Num ×', NumDivide: 'Num ÷',
    ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Home: 'Pos1', End: 'Ende' };
  function keyLabel(k) {
    const parts = String(k || '').split('+');
    if (parts.length > 1 && parts[parts.length - 1] === '') { parts.pop(); parts[parts.length - 1] = '+'; } // Taste „+“
    return parts.map((p) => KEY_NAMES[p] || p).join('+');
  }

  function keysOf(id) { return (cfg.settings.keys[id] || []).map(keyLabel).join(' / '); }

  function togglePause() {
    if (!A.voices.size) return;
    const p = A.togglePause();
    toast(p ? 'Pause – nochmal drücken setzt fort.' : 'Weiter.', '', 1200);
  }

  const FX_KEY_ACTIONS = ['fxPrev', 'fxNext', 'fxInc', 'fxDec', 'fxSelReset'];

  function runAction(id, coarse) {
    switch (id) {
      case 'fxPrev': fxSelStep(-1); break;
      case 'fxNext': fxSelStep(1); break;
      case 'fxInc': fxNudge(1, coarse); break;
      case 'fxDec': fxNudge(-1, coarse); break;
      case 'fxSelReset': { const n = currentFxSel(); if (n) A.setFx(n, A.fxDefs[n].neutral); break; }
      case 'playerPanel': togglePlayerPanel(); break;
      case 'playerToggle': playerToggle(); break;
      case 'playerNext': playerNext(); break;
      case 'playerFade': playerFade(); break;
      case 'stopAll': A.stopAll(false); break;
      case 'pause': togglePause(); break;
      case 'fadeAll': A.stopAll(true); break;
      case 'nextTrack': {
        const done = new Set();
        A.voices.forEach((v) => { if (v.bus === 'master' && v.tracks && !done.has(v.tileId)) { done.add(v.tileId); A.next(v.tileId); } });
        break;
      }
      case 'nextTab': stepTab(1); break;
      case 'prevTab': stepTab(-1); break;
      case 'nextLayer': stepLayer(1); break;
      case 'prevLayer': stepLayer(-1); break;
      case 'fxBar': toggleFxBar(); break;
      case 'fxReset': A.resetFx(); toast('Alle Effekte zurückgesetzt.', '', 1200); break;
      case 'tempoUp': tempoStep(1); break;
      case 'tempoDown': tempoStep(-1); break;
      case 'tempoReset': A.setFx('tempo', 1); toast('Tempo 1×', '', 1000); break;
      case 'edit': editMode = !editMode; moveTileId = null; renderAll(); break;
      case 'reset': resetCounters(null); break;
    }
  }

  /** Taste für eine Player-Aktion lernen */
  function learnPlayerKey(btn, done) {
    cancelLearn();
    const label = btn.textContent;
    btn.classList.add('learning');
    btn.textContent = 'Taste drücken … (Esc = abbrechen)';
    const keyHandler = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape' && !e.shiftKey && !e.ctrlKey && !e.altKey) { cancelLearn(); return; }
      const key = hotkeyFromEvent(e);
      if (!key) return;
      if (FIXED_KEYS.includes(key)) { toast(key + ' ist fest belegt (Vollbild, Reiter Strg+0…9) – bitte eine andere Taste wählen.', 'err'); return; }
      cancelLearn();
      done(key);
    };
    learnState = { btn, label, keyHandler };
    document.addEventListener('keydown', keyHandler, true);
  }

  /** Taste einer Aktion zuweisen; Konflikte mit anderen Aktionen/Kacheln werden aufgelöst */
  function assignPlayerKey(actionId, slot, key) {
    const map = cfg.settings.keys;
    const low = key.toLowerCase();
    M.PLAYER_ACTIONS.forEach((a) => {
      if (a.id !== actionId && (map[a.id] || []).some((x) => x.toLowerCase() === low)) {
        map[a.id] = map[a.id].filter((x) => x.toLowerCase() !== low);
        toast(keyLabel(key) + ' war „' + a.label + '“ zugewiesen – dort entfernt.', '', 3500);
      }
    });
    cfg.tabs.forEach((t) => t.tiles.forEach((x) => {
      if (x.hotkey && x.hotkey.toLowerCase() === low) { x.hotkey = ''; toast(keyLabel(key) + ' war der Kachel „' + x.title + '“ zugewiesen – dort entfernt.', '', 3500); }
    }));
    const list = (map[actionId] || []).filter((x) => x.toLowerCase() !== low);
    list[slot] = key;
    map[actionId] = list.filter(Boolean).slice(0, 2);
    persist();
  }

  // ================================================================ Pegelanzeige

  function startMeterLoop() {
    const canvas = $('#meter');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const W = 200, H = 44;
    canvas.width = W * dpr; canvas.height = H * dpr;
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const MIN = -48, MAX = 3;
    const xOf = (lin) => { const db = A.linToDb(lin); return Math.max(0, Math.min(1, (db - MIN) / (MAX - MIN))) * W; };
    const smooth = [0, 0];
    let idleFrames = 0;
    function frame() {
      requestAnimationFrame(frame);
      const wrap = $('#meter-wrap');
      if (!cfg.settings.showMeter) { wrap.hidden = true; return; }
      wrap.hidden = false;
      const active = A.voices.size > 0;
      if (!active && idleFrames > 90) return;
      idleFrames = active ? 0 : idleFrames + 1;
      const m = A.readMeter('master');
      const vals = [m.l, m.r], holds = [m.holdL, m.holdR];
      ctx.clearRect(0, 0, W, H);
      const barH = 15;
      [0, 1].forEach((i) => {
        smooth[i] = Math.max(vals[i], smooth[i] * 0.86);
        const y = 4 + i * (barH + 4);
        ctx.fillStyle = '#232938';
        ctx.fillRect(0, y, W, barH);
        const x = xOf(smooth[i]);
        const xY = xOf(A.dbToLin(-12)), xR = xOf(A.dbToLin(-3));
        ctx.fillStyle = '#2fbf71'; ctx.fillRect(0, y, Math.min(x, xY), barH);
        if (x > xY) { ctx.fillStyle = '#f2c818'; ctx.fillRect(xY, y, Math.min(x, xR) - xY, barH); }
        if (x > xR) { ctx.fillStyle = '#e5383b'; ctx.fillRect(xR, y, x - xR, barH); }
        const xh = xOf(holds[i]);
        if (xh > 1) { ctx.fillStyle = holds[i] >= 1 ? '#ff4d4f' : '#ffffff'; ctx.fillRect(xh - 1, y, 2, barH); }
      });
      // Skala
      ctx.fillStyle = '#8b94a8';
      ctx.font = '9px Segoe UI, sans-serif';
      ctx.textAlign = 'center';
      [-36, -24, -12, -6, 0].forEach((db) => {
        const x = ((db - MIN) / (MAX - MIN)) * W;
        ctx.fillRect(x, 4 + 2 * barH + 4, 1, 3);
        ctx.fillText(String(db), Math.min(W - 6, Math.max(6, x)), H - 1);
      });
      const clip = m.holdL >= 1 || m.holdR >= 1;
      $('#meter-clip').classList.toggle('on', clip);
    }
    requestAnimationFrame(frame);
  }

  // ================================================================ Bedienleisten & Eingaben

  function bindTopbar() {
    $('#btn-edit').addEventListener('click', () => { editMode = !editMode; moveTileId = null; renderAll(); });
    $('#btn-reset').addEventListener('click', () => resetCounters(null));
    $('#btn-settings').addEventListener('click', () => openSettings());
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
    $('#btn-pause').addEventListener('click', togglePause);
    $('#btn-fx').addEventListener('click', () => toggleFxBar());
    $('#btn-player').addEventListener('click', () => togglePlayerPanel());
    // Fokus nicht auf Knöpfen stehen lassen – sonst lösen Leertaste/Enter den zuletzt geklickten Knopf aus
    document.addEventListener('pointerup', (e) => {
      const b = e.target.closest && e.target.closest('button, input[type=range]');
      if (b && !b.closest('.overlay')) setTimeout(() => b.blur(), 0);
    });
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
      if (!isFiles(e) || topDialog()) return;
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
    const isTyping = (e) => /^(INPUT|TEXTAREA|SELECT)$/.test((e.target && e.target.tagName) || '') && !['range', 'checkbox', 'radio', 'color'].includes(e.target.type);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !e.shiftKey) {
        if (document.querySelector('.menu')) { closeMenus(); e.preventDefault(); return; }
        const top = topDialog();
        if (top) { top._close(); e.preventDefault(); return; }
        if (moveTileId) { moveTileId = null; renderAll(); e.preventDefault(); return; }
      }
      if (isTyping(e) || topDialog()) return;
      const key = hotkeyFromEvent(e);
      // Strg+1…9, Strg+0: Reiter der angezeigten Ebene
      if (e.ctrlKey && !e.altKey && !e.shiftKey && /^Digit\d$/.test(e.code)) {
        const n = Number(e.code.slice(5));
        const tab = M.tabsOfLayer(cfg.tabs, currentLayer())[(n + 9) % 10];
        if (tab) selectTab(tab.id);
        e.preventDefault();
        return;
      }
      let act = actionForKey(key);
      let coarse = false;
      // Umschalt + Pfeil = grober Schritt
      if (!act && e.shiftKey) {
        const plain = actionForKey(key.replace(/(^|\+)Shift\+/, '$1'));
        if (plain === 'fxInc' || plain === 'fxDec') { act = plain; coarse = true; }
      }
      // Effekt-Pfeiltasten nur bei geöffneter Effektleiste (sonst bleiben die Tasten frei)
      if (act && FX_KEY_ACTIONS.includes(act) && !cfg.settings.fxBarOpen) act = null;
      if (act) {
        e.preventDefault();
        if (e.repeat && !['tempoUp', 'tempoDown', 'nextTab', 'prevTab', 'fxInc', 'fxDec'].includes(act)) return;
        runAction(act, coarse);
        return;
      }
      if (!editMode && !e.repeat) {
        // Tastenkürzel der Kacheln (gelten in allen Reitern)
        const tile = findTileByHotkey(key);
        if (tile) { e.preventDefault(); triggerTile(tile, 'master'); }
      }
    });
    // Leertaste/Enter lösen sonst beim Loslassen einen fokussierten Knopf aus
    document.addEventListener('keyup', (e) => {
      if (isTyping(e) || topDialog()) return;
      if (actionForKey(hotkeyFromEvent(e))) e.preventDefault();
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
      readAudio: (p) => fetch(p).then((r) => r.arrayBuffer()),
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
