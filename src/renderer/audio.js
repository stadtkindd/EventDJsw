/*
 * EventDJ – Audio-Engine (Web Audio)
 *
 * Signalweg je Voice:  <audio> → MediaElementSource → Gain (Fade × Lautstärke × Normalisierung × Ducking)
 *                      → Bus-Gain (Master/Vorhören) → Ausgabegerät (AudioContext.setSinkId)
 *                                                 └→ Pegelanzeige (Analyser L/R)
 *
 * - Fade-In / Fade-Out mit gleichleistungs-Kurve (Sinus/Kosinus)
 * - Endpunkt mit automatischem Ausblenden, Schleife zwischen Start- und Endpunkt
 * - Playlists (nacheinander/zufällig, optional wiederholen)
 * - Ducking: Hintergrundmusik wird abgesenkt, solange ein Jingle läuft
 * - Lautheitsanalyse (LUFS nach ITU-R BS.1770, K-Bewertung) und Wellenform-Daten
 */
(function (root) {
  'use strict';

  const TICK_MS = 15;

  function fileUrl(p) {
    if (!p) return '';
    if (/^(blob:|data:|file:|https?:)/i.test(p)) return p;
    let s = String(p).replace(/\\/g, '/');
    if (s.startsWith('//')) {
      return 'file:' + s.split('/').map((seg, i) => (i < 2 ? seg : encodeURIComponent(seg))).join('/');
    }
    const parts = s.split('/').map((seg, i) => (i === 0 && /^[a-zA-Z]:$/.test(seg) ? seg : encodeURIComponent(seg)));
    s = parts.join('/');
    return 'file://' + (s.startsWith('/') ? '' : '/') + s;
  }

  const dbToLin = (db) => Math.pow(10, (db || 0) / 20);
  const linToDb = (x) => (x > 0 ? 20 * Math.log10(x) : -Infinity);
  function easeIn(x) { return Math.sin((Math.min(1, Math.max(0, x)) * Math.PI) / 2); }
  function easeOut(x) { return Math.cos((Math.min(1, Math.max(0, x)) * Math.PI) / 2); }

  const listeners = {};
  function emit(type, data) { (listeners[type] || []).forEach((fn) => { try { fn(data); } catch (e) { console.error(e); } }); }

  // ------------------------------------------------------------------ Busse

  function createBus(name) {
    const AC = window.AudioContext || window.webkitAudioContext;
    const ctx = new AC({ latencyHint: 'interactive' });
    const input = ctx.createGain();
    input.channelCount = 2;
    input.channelCountMode = 'explicit';
    input.channelInterpretation = 'speakers';
    input.connect(ctx.destination);
    const splitter = ctx.createChannelSplitter(2);
    input.connect(splitter);
    const meters = [0, 1].map((ch) => {
      const a = ctx.createAnalyser();
      a.fftSize = 1024;
      a.smoothingTimeConstant = 0;
      splitter.connect(a, ch);
      return a;
    });
    return { name, ctx, input, meters, sinkId: '', meterBuf: new Float32Array(1024), peakHold: [0, 0], peakHoldAt: [0, 0] };
  }

  const engine = {
    sinks: { master: 'default', cue: '' },
    busVolume: { master: 1, cue: 1 },
    duck: { level: 0.25, fadeMs: 500 },
    buses: {},
    voices: new Map(),
    warm: new Map(),
    timer: null,
    seq: 0,

    on(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },

    fileUrl,
    dbToLin,
    linToDb,

    bus(name) {
      if (!this.buses[name]) {
        this.buses[name] = createBus(name);
        this.applyBusSink(name);
        this.buses[name].input.gain.value = this.busVolume[name] == null ? 1 : this.busVolume[name];
      }
      const b = this.buses[name];
      if (b.ctx.state === 'suspended') b.ctx.resume().catch(() => {});
      return b;
    },

    sinkFor(bus) {
      if (bus === 'cue') return this.sinks.cue || this.sinks.master || 'default';
      return this.sinks.master || 'default';
    },

    async applyBusSink(name) {
      const b = this.buses[name];
      if (!b) return true;
      const id = this.sinkFor(name);
      const wanted = id === 'default' ? '' : id;
      if (typeof b.ctx.setSinkId !== 'function') return true;
      if (b.sinkId === wanted) return true;
      try {
        await b.ctx.setSinkId(wanted);
        b.sinkId = wanted;
        return true;
      } catch (err) {
        emit('device-error', { bus: name, deviceId: id, error: String((err && err.message) || err) });
        try { await b.ctx.setSinkId(''); b.sinkId = ''; } catch (e) { /* ignorieren */ }
        return false;
      }
    },

    async setSink(bus, deviceId) {
      this.sinks[bus] = deviceId || (bus === 'master' ? 'default' : '');
      await this.applyBusSink(bus);
      if (bus === 'master') await this.applyBusSink('cue'); // „wie Master“
    },

    setBusVolume(bus, vol) {
      this.busVolume[bus] = Math.min(1, Math.max(0, Number(vol) || 0));
      const b = this.buses[bus];
      if (b) b.input.gain.setTargetAtTime(this.busVolume[bus], b.ctx.currentTime, 0.02);
    },

    setDucking(level, fadeMs) {
      this.duck.level = Math.min(1, Math.max(0, level));
      this.duck.fadeMs = Math.max(0, fadeMs || 0);
    },

    async listOutputs() {
      if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return [];
      let devices = await navigator.mediaDevices.enumerateDevices();
      let outs = devices.filter((d) => d.kind === 'audiooutput');
      if (outs.length && outs.every((d) => !d.label)) {
        try {
          const s = await navigator.mediaDevices.getUserMedia({ audio: true });
          s.getTracks().forEach((t) => t.stop());
          devices = await navigator.mediaDevices.enumerateDevices();
          outs = devices.filter((d) => d.kind === 'audiooutput');
        } catch (e) { /* kein Mikrofon – Labels bleiben ggf. leer */ }
      }
      return outs.map((d, i) => ({
        deviceId: d.deviceId,
        label: d.label || (d.deviceId === 'default' ? 'Windows-Standardgerät' : 'Ausgabegerät ' + (i + 1)),
        groupId: d.groupId
      }));
    },

    // ---------------------------------------------------- Vorladen

    prewarm(tiles) {
      this._lastWarmTiles = tiles;
      const keep = new Set();
      (tiles || []).slice(0, 64).forEach((tile) => {
        const file = tile.kind === 'playlist' ? '' : tile.file;
        if (!file) return;
        const key = tile.id + '|' + file;
        keep.add(key);
        if (!this.warm.has(key)) {
          const a = new Audio();
          a.preload = 'auto';
          a.src = fileUrl(file);
          a.load();
          this.warm.set(key, a);
        }
      });
      this.warm.forEach((a, key) => {
        if (!keep.has(key)) { a.removeAttribute('src'); a.load(); this.warm.delete(key); }
      });
    },

    takeAudio(tileId, file) {
      const key = tileId + '|' + file;
      const a = this.warm.get(key);
      if (a) {
        this.warm.delete(key);
        setTimeout(() => this.prewarm(this._lastWarmTiles), 50);
        return a;
      }
      const audio = new Audio();
      audio.preload = 'auto';
      audio.src = fileUrl(file);
      return audio;
    },

    // ---------------------------------------------------- Wiedergabe

    /**
     * Startet eine Kachel.
     * opts: { bus, fadeIn, fadeOut, volume, gainDb, startAt, endAt, loop, role, tracks:[{file,gainDb,title}], shuffle }
     */
    async play(tile, opts) {
      opts = opts || {};
      const busName = opts.bus || 'master';
      const bus = this.bus(busName);
      const tracks = opts.tracks && opts.tracks.length ? opts.tracks : null;
      let order = null;
      if (tracks) {
        order = tracks.map((_, i) => i);
        if (opts.shuffle) shuffle(order);
      }
      const firstFile = tracks ? tracks[order[0]].file : tile.file;
      const audio = tracks ? this.takeAudio('__pl', firstFile) : this.takeAudio(tile.id, firstFile);
      let source;
      try {
        source = bus.ctx.createMediaElementSource(audio);
      } catch (e) {
        // Element hing bereits an einem Kontext – frisches Element verwenden
        const fresh = new Audio(fileUrl(firstFile));
        fresh.preload = 'auto';
        return this._start(tile, opts, bus, busName, fresh, bus.ctx.createMediaElementSource(fresh), tracks, order);
      }
      return this._start(tile, opts, bus, busName, audio, source, tracks, order);
    },

    async _start(tile, opts, bus, busName, audio, source, tracks, order) {
      const gain = bus.ctx.createGain();
      gain.gain.value = 0;
      source.connect(gain);
      gain.connect(bus.input);

      const voice = {
        id: 'v' + (++this.seq),
        tileId: tile.id,
        title: tile.title,
        trackTitle: '',
        bus: busName,
        audio, source, gain, ctx: bus.ctx,
        fadeIn: Math.max(0, opts.fadeIn || 0),
        fadeOut: Math.max(0, opts.fadeOut || 0),
        volume: opts.volume == null ? 1 : opts.volume,
        trim: dbToLin(opts.gainDb),
        startAt: tracks ? 0 : Math.max(0, opts.startAt || 0),
        endAt: tracks ? 0 : Math.max(0, opts.endAt || 0),
        loop: !!opts.loop,
        role: opts.role === 'bed' && busName === 'master' ? 'bed' : 'normal',
        tracks, order, trackPos: 0,
        duckFactor: 1,
        startedAt: performance.now(),
        fadeOutStart: null,
        fadeOutFrom: 1,
        env: 0,
        state: 'starting'
      };
      if (tracks) this._setTrackMeta(voice);
      // native Schleife nur, wenn kein Start-/Endpunkt gesetzt ist (lückenlos)
      audio.loop = !tracks && voice.loop && !voice.startAt && !voice.endAt;
      audio.volume = 1;
      this.voices.set(voice.id, voice);
      emit('change', { type: 'start', voice });

      audio.onended = () => this._onEnded(voice);
      audio.onerror = () => {
        emit('error', { voice, error: (audio.error && audio.error.message) || 'Datei kann nicht abgespielt werden' });
        if (voice.tracks && voice.trackPos < voice.order.length - 1) { this._advance(voice, false); return; }
        this.finish(voice, 'error');
      };

      if (voice.startAt > 0) await this._seek(audio, voice.startAt);
      if (voice.state === 'done') return voice;
      voice.startedAt = performance.now();
      voice.state = 'playing';
      this.ensureTimer();
      try {
        await audio.play();
      } catch (err) {
        if (voice.state !== 'done') {
          emit('error', { voice, error: String((err && err.message) || err) });
          this.finish(voice, 'error');
        }
      }
      return voice;
    },

    async _seek(audio, t) {
      try {
        if (audio.readyState < 1) {
          await new Promise((res) => { audio.addEventListener('loadedmetadata', res, { once: true }); setTimeout(res, 1500); });
        }
        audio.currentTime = t;
      } catch (e) { /* ignorieren */ }
    },

    _setTrackMeta(v) {
      const tr = v.tracks[v.order[v.trackPos]];
      v.trim = dbToLin(tr.gainDb);
      v.trackTitle = tr.title || '';
    },

    _onEnded(v) {
      if (v.state === 'done') return;
      if (v.tracks) { this._advance(v, false); return; }
      if (v.loop) {
        v.audio.currentTime = v.startAt || 0;
        v.audio.play().catch(() => {});
        return;
      }
      this.finish(v, 'ended');
    },

    /** Playlist: nächster Titel (manual = per Knopf, mit kurzem Einblenden) */
    _advance(v, manual) {
      v.trackPos++;
      if (v.trackPos >= v.order.length) {
        if (!v.loop) { this.finish(v, 'ended'); return; }
        v.trackPos = 0;
        if (v.order.length > 2) {
          const last = v.order[v.order.length - 1];
          shuffle(v.order);
          if (v.order[0] === last) v.order.push(v.order.shift());
        }
      }
      this._setTrackMeta(v);
      v.audio.src = fileUrl(v.tracks[v.order[v.trackPos]].file);
      if (manual) { v.startedAt = performance.now(); v.fadeIn = Math.max(v.fadeIn, 250); }
      v.audio.play().catch((err) => emit('error', { voice: v, error: String((err && err.message) || err) }));
      emit('change', { type: 'track', voice: v });
    },

    next(tileId) {
      this.voices.forEach((v) => { if (v.tileId === tileId && v.tracks && v.state !== 'fading') this._advance(v, true); });
    },

    isBedDucked() {
      let jingle = false;
      this.voices.forEach((v) => { if (v.bus === 'master' && v.role !== 'bed' && v.state === 'playing') jingle = true; });
      return jingle;
    },

    tick(now, dt) {
      const duckOn = this.isBedDucked();
      this.voices.forEach((v) => {
        // Endpunkt: rechtzeitig automatisch ausblenden bzw. Schleife
        if (v.endAt > 0 && v.state === 'playing' && !v.audio.paused) {
          const t = v.audio.currentTime;
          if (v.loop) {
            if (t >= v.endAt) v.audio.currentTime = v.startAt || 0;
          } else {
            const left = (v.endAt - t) * 1000;
            if (left <= Math.max(30, v.fadeOut)) this.stop(v.id, true, Math.max(30, left));
          }
        }
        // Ducking weich nachführen
        if (v.role === 'bed') {
          const target = duckOn ? this.duck.level : 1;
          const step = this.duck.fadeMs > 0 ? dt / this.duck.fadeMs : 1;
          if (v.duckFactor < target) v.duckFactor = Math.min(target, v.duckFactor + step);
          else if (v.duckFactor > target) v.duckFactor = Math.max(target, v.duckFactor - step);
        }
        this.applyVolume(v, now);
      });
    },

    applyVolume(v, now) {
      let env = 1;
      if (v.state === 'starting') env = 0;
      else if (v.fadeIn > 0) env = easeIn((now - v.startedAt) / v.fadeIn);
      if (v.fadeOutStart != null) {
        const x = v.fadeOut > 0 ? (now - v.fadeOutStart) / v.fadeOut : 1;
        env = Math.min(env, v.fadeOutFrom * easeOut(x));
        if (x >= 1) { this.finish(v, 'faded'); return; }
      }
      v.env = env;
      const g = env * v.volume * v.trim * v.duckFactor;
      try { v.gain.gain.setTargetAtTime(g, v.ctx.currentTime, 0.006); } catch (e) { v.gain.gain.value = g; }
    },

    ensureTimer() {
      if (this.timer) return;
      let last = performance.now();
      this.timer = setInterval(() => {
        const now = performance.now();
        this.tick(now, now - last);
        last = now;
        emit('tick', now);
        if (!this.voices.size) { clearInterval(this.timer); this.timer = null; emit('tick', now); }
      }, TICK_MS);
    },

    /** Voice ausblenden (fade=true) oder sofort stoppen */
    stop(voiceId, fade, fadeMs) {
      const v = this.voices.get(voiceId);
      if (!v) return;
      const ms = fadeMs != null ? fadeMs : v.fadeOut;
      if (!fade || ms <= 0 || v.state === 'starting') { this.finish(v, 'stopped'); return; }
      if (v.fadeOutStart != null) { this.finish(v, 'stopped'); return; } // zweiter Stopp = sofort aus
      v.fadeOutFrom = v.env;
      v.fadeOut = ms;
      v.fadeOutStart = performance.now();
      v.state = 'fading';
      emit('change', { type: 'fading', voice: v });
      this.ensureTimer();
    },

    finish(v, reason) {
      if (v.state === 'done') return;
      v.state = 'done';
      try { v.audio.pause(); } catch (e) { /* ignorieren */ }
      v.audio.onended = null;
      v.audio.onerror = null;
      try { v.gain.disconnect(); v.source.disconnect(); } catch (e) { /* ignorieren */ }
      v.audio.removeAttribute('src');
      try { v.audio.load(); } catch (e) { /* ignorieren */ }
      this.voices.delete(v.id);
      emit('change', { type: 'end', voice: v, reason });
    },

    stopTile(tileId, fade, bus) {
      this.voices.forEach((v) => { if (v.tileId === tileId && (!bus || v.bus === bus)) this.stop(v.id, fade); });
    },

    // Bereits ausblendende Voices laufen beim Ausblenden ungestört weiter
    stopBus(bus, fade, fadeMs, filter) {
      this.voices.forEach((v) => {
        if (v.bus !== bus || (fade && v.fadeOutStart != null)) return;
        if (filter && !filter(v)) return;
        this.stop(v.id, fade, fadeMs);
      });
    },

    stopAll(fade, fadeMs) {
      this.voices.forEach((v) => { if (!(fade && v.fadeOutStart != null)) this.stop(v.id, fade, fadeMs); });
    },

    voicesForTile(tileId, bus) {
      const out = [];
      this.voices.forEach((v) => { if (v.tileId === tileId && (!bus || v.bus === bus)) out.push(v); });
      return out;
    },

    /** Pegel eines Busses: { l, r, holdL, holdR } linear 0…1+ */
    readMeter(busName) {
      const b = this.buses[busName];
      if (!b) return { l: 0, r: 0, holdL: 0, holdR: 0 };
      const now = performance.now();
      const vals = b.meters.map((a, i) => {
        a.getFloatTimeDomainData(b.meterBuf);
        let peak = 0;
        for (let k = 0; k < b.meterBuf.length; k++) { const x = Math.abs(b.meterBuf[k]); if (x > peak) peak = x; }
        if (peak >= b.peakHold[i] || now - b.peakHoldAt[i] > 1500) { b.peakHold[i] = peak; b.peakHoldAt[i] = now; }
        return peak;
      });
      return { l: vals[0], r: vals[1], holdL: b.peakHold[0], holdR: b.peakHold[1] };
    },

    /** Prüfton auf einem Bus */
    async testTone(busName) {
      const b = this.bus(busName);
      const ctx = b.ctx;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      const t = ctx.currentTime + 0.02;
      osc.frequency.setValueAtTime(660, t);
      osc.frequency.setValueAtTime(880, t + 0.4);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.3, t + 0.02);
      g.gain.setValueAtTime(0.3, t + 0.7);
      g.gain.linearRampToValueAtTime(0, t + 0.8);
      osc.connect(g); g.connect(b.input);
      osc.start(t); osc.stop(t + 0.85);
      osc.onended = () => { try { g.disconnect(); } catch (e) { /* */ } };
    },

    /** Dauer einer Datei ermitteln (Sekunden); −1 = nicht lesbar */
    probeDuration(path) {
      return new Promise((resolve) => {
        const a = new Audio();
        a.preload = 'metadata';
        const done = (d) => { a.removeAttribute('src'); try { a.load(); } catch (e) { /* */ } resolve(d); };
        a.onloadedmetadata = () => done(Number.isFinite(a.duration) ? a.duration : 0);
        a.onerror = () => done(-1);
        setTimeout(() => done(0), 5000);
        a.src = fileUrl(path);
      });
    },

    // ---------------------------------------------------- Analyse

    /** Datei dekodieren. reader(path) → Promise<Uint8Array|ArrayBuffer> */
    async decode(path, reader) {
      const data = await reader(path);
      const buf = data instanceof ArrayBuffer ? data : data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
      return this.bus('master').ctx.decodeAudioData(buf);
    },

    /** Lautheit (LUFS, integriert, nach ITU-R BS.1770) und Spitzenpegel */
    async analyzeLoudness(buffer) {
      const ch = Math.min(2, buffer.numberOfChannels);
      const sr = buffer.sampleRate;
      let peak = 0;
      for (let c = 0; c < buffer.numberOfChannels; c++) {
        const d = buffer.getChannelData(c);
        for (let i = 0; i < d.length; i++) { const x = d[i] < 0 ? -d[i] : d[i]; if (x > peak) peak = x; }
      }
      // K-Bewertung: Hochton-Shelf (+4 dB) und Hochpass (~38 Hz)
      const off = new OfflineAudioContext(ch, buffer.length, sr);
      const src = off.createBufferSource();
      src.buffer = buffer;
      const shelf = off.createBiquadFilter();
      shelf.type = 'highshelf'; shelf.frequency.value = 1681.97; shelf.gain.value = 4;
      const hp = off.createBiquadFilter();
      hp.type = 'highpass'; hp.frequency.value = 38.14; hp.Q.value = 0.5003;
      src.connect(shelf); shelf.connect(hp); hp.connect(off.destination);
      src.start();
      const k = await off.startRendering();
      const data = [];
      for (let c = 0; c < ch; c++) data.push(k.getChannelData(c));
      const block = Math.round(0.4 * sr), step = Math.round(0.1 * sr);
      const blocks = [];
      for (let start = 0; start + block <= k.length; start += step) {
        let sum = 0;
        for (let c = 0; c < ch; c++) {
          const d = data[c];
          let s = 0;
          for (let i = start; i < start + block; i++) s += d[i] * d[i];
          sum += s / block;
        }
        blocks.push(sum);
      }
      if (!blocks.length) {
        // sehr kurze Datei: gesamte Länge als ein Block
        let sum = 0;
        for (let c = 0; c < ch; c++) { const d = data[c]; let s = 0; for (let i = 0; i < d.length; i++) s += d[i] * d[i]; sum += s / Math.max(1, d.length); }
        blocks.push(sum);
      }
      const lufsOf = (z) => -0.691 + 10 * Math.log10(z);
      const abs = blocks.filter((z) => z > 0 && lufsOf(z) > -70);
      if (!abs.length) return { lufs: null, peak };
      const meanAbs = abs.reduce((a, b) => a + b, 0) / abs.length;
      const rel = lufsOf(meanAbs) - 10;
      const gated = abs.filter((z) => lufsOf(z) > rel);
      const mean = gated.reduce((a, b) => a + b, 0) / Math.max(1, gated.length);
      return { lufs: Math.round(lufsOf(mean) * 10) / 10, peak };
    },

    /** Wellenform: n Spalten mit [min, max] */
    peaks(buffer, n) {
      const out = new Array(n);
      const len = buffer.length;
      const chans = [];
      for (let c = 0; c < buffer.numberOfChannels; c++) chans.push(buffer.getChannelData(c));
      for (let i = 0; i < n; i++) {
        const a = Math.floor((i * len) / n), b = Math.max(a + 1, Math.floor(((i + 1) * len) / n));
        let mn = 0, mx = 0;
        const stride = Math.max(1, Math.floor((b - a) / 400));
        for (let j = a; j < b; j += stride) {
          for (let c = 0; c < chans.length; c++) { const x = chans[c][j]; if (x < mn) mn = x; if (x > mx) mx = x; }
        }
        out[i] = [mn, mx];
      }
      return out;
    }
  };

  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
    navigator.mediaDevices.addEventListener('devicechange', () => emit('devices-changed'));
  }

  root.AudioEngine = engine;
})(window);
