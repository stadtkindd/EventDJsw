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

  function createBus(name, withFx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    const ctx = new AC({ latencyHint: 'interactive' });
    const input = ctx.createGain();
    input.channelCount = 2;
    input.channelCountMode = 'explicit';
    input.channelInterpretation = 'speakers';
    let out = input;
    let fx = null;
    if (withFx) {
      fx = createFxChain(ctx);
      input.connect(fx.input);
      out = fx.output;
    }
    out.connect(ctx.destination);
    const splitter = ctx.createChannelSplitter(2);
    out.connect(splitter);
    const meters = [0, 1].map((ch) => {
      const a = ctx.createAnalyser();
      a.fftSize = 1024;
      a.smoothingTimeConstant = 0;
      splitter.connect(a, ch);
      return a;
    });
    return { name, ctx, input, fx, meters, sinkId: '', meterBuf: new Float32Array(1024), peakHold: [0, 0], peakHoldAt: [0, 0] };
  }

  // ------------------------------------------------------------------ Live-Effekte (nur Master)
  //
  //  Eingang → Bass (Low-Shelf) → Höhen (High-Shelf) → Tiefpass → Hochpass ─┬→ trocken ──────────┐
  //                                                                         ├→ Hall (Faltung) ──┤→ Limiter → Ausgang
  //                                                                         └→ Echo (Delay+FB) ─┘

  function makeImpulse(ctx, seconds, decay) {
    const sr = ctx.sampleRate;
    const len = Math.floor(sr * seconds);
    const pre = Math.floor(sr * 0.012);
    const buf = ctx.createBuffer(2, len, sr);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = pre; i < len; i++) {
        const t = (i - pre) / (len - pre);
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay);
      }
    }
    return buf;
  }

  function createFxChain(ctx, withLimiter) {
    if (withLimiter === undefined) withLimiter = true;
    const input = ctx.createGain();
    const bass = ctx.createBiquadFilter();
    bass.type = 'lowshelf'; bass.frequency.value = 110; bass.gain.value = 0;
    const treble = ctx.createBiquadFilter();
    treble.type = 'highshelf'; treble.frequency.value = 5500; treble.gain.value = 0;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = ctx.sampleRate / 2; lp.Q.value = 0.9;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 10; hp.Q.value = 0.9;
    input.connect(bass); bass.connect(treble); treble.connect(lp); lp.connect(hp);

    const sum = ctx.createGain();
    hp.connect(sum); // trocken

    const conv = ctx.createConvolver();
    conv.buffer = makeImpulse(ctx, 3.2, 2.6);
    const hallWet = ctx.createGain(); hallWet.gain.value = 0;
    hp.connect(hallWet); hallWet.connect(conv); conv.connect(sum);

    const delay = ctx.createDelay(2);
    delay.delayTime.value = 0.375;
    const fb = ctx.createGain(); fb.gain.value = 0.42;
    const fbTone = ctx.createBiquadFilter(); fbTone.type = 'lowpass'; fbTone.frequency.value = 3800;
    const echoWet = ctx.createGain(); echoWet.gain.value = 0;
    hp.connect(echoWet); echoWet.connect(delay);
    delay.connect(fbTone); fbTone.connect(fb); fb.connect(delay);
    delay.connect(sum);

    let output = sum;
    if (withLimiter) {
      // Schutz vor Übersteuerung (Bass-Anhebung, Hall, Echo)
      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -1.5; limiter.knee.value = 0; limiter.ratio.value = 20;
      limiter.attack.value = 0.002; limiter.release.value = 0.15;
      sum.connect(limiter);
      output = limiter;
    }
    return { ctx, input, output, bass, treble, lp, hp, hallWet, echoWet, delay, fb };
  }

  /** Effektwerte f = { bass, treble, filter, hall, echo } auf eine Kette anwenden */
  function applyFxParams(fx, f, echoMs, immediate) {
    const ctx = fx.ctx, t = ctx.currentTime;
    const set = (param, val) => {
      if (immediate) param.value = val;
      else { param.cancelScheduledValues(t); param.setTargetAtTime(val, t, 0.03); }
    };
    const g = (k) => Number(f[k]) || 0;
    set(fx.bass.gain, g('bass'));
    set(fx.treble.gain, g('treble'));
    const nyq = ctx.sampleRate / 2;
    const x = g('filter') / 100;
    set(fx.lp.frequency, x < 0 ? 20000 * Math.pow(250 / 20000, -x) : nyq);
    set(fx.hp.frequency, x > 0 ? 20 * Math.pow(2500 / 20, x) : 10);
    // Hall/Echo: Anteil gebogen, damit der Regler unten feinfühlig ist
    set(fx.hallWet.gain, Math.pow(g('hall') / 100, 2) * 1.6);
    set(fx.echoWet.gain, Math.pow(g('echo') / 100, 1.5) * 0.85);
    set(fx.fb.gain, 0.3 + 0.3 * (g('echo') / 100));
    set(fx.delay.delayTime, (echoMs || 375) / 1000);
  }

  /** hat eine Kachel klangverändernde Effekte (ohne Tempo)? */
  function hasSoundFx(f) {
    return !!f && ['bass', 'treble', 'filter', 'hall', 'echo'].some((k) => Math.abs(Number(f[k]) || 0) > 1e-6);
  }

  /** Neutralwerte und Wertebereiche der Effekte */
  const FX_DEFS = {
    tempo: { min: 0.25, max: 16, neutral: 1 },
    bass: { min: -12, max: 15, neutral: 0 },      // dB
    treble: { min: -12, max: 12, neutral: 0 },    // dB
    filter: { min: -100, max: 100, neutral: 0 },  // −100 = dumpf (Tiefpass) … +100 = dünn (Hochpass)
    hall: { min: 0, max: 100, neutral: 0 },       // %
    echo: { min: 0, max: 100, neutral: 0 }        // %
  };

  const engine = {
    sinks: { master: 'default', cue: '' },
    busVolume: { master: 1, cue: 1 },
    duck: { level: 0.25, fadeMs: 500 },
    fxDefs: FX_DEFS,
    fx: { tempo: 1, bass: 0, treble: 0, filter: 0, hall: 0, echo: 0 },
    pitchLock: false,
    paused: false,
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
        this.buses[name] = createBus(name, name === 'master');
        if (name === 'master') this._applyFxNodes(true);
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

    // ---------------------------------------------------- Live-Effekte

    /** Effektwert setzen (Name aus FX_DEFS); Tempo wirkt auf alle Master-Titel */
    setFx(name, value) {
      const def = FX_DEFS[name];
      if (!def) return;
      let v = Number(value);
      if (!Number.isFinite(v)) v = def.neutral;
      v = Math.min(def.max, Math.max(def.min, v));
      this.fx[name] = v;
      if (name === 'tempo') this._applyTempoAll();
      else this._applyFxNodes(false);
      emit('fx', { name, value: v });
    },

    resetFx() {
      Object.keys(FX_DEFS).forEach((k) => { this.fx[k] = FX_DEFS[k].neutral; });
      this._applyTempoAll();
      this._applyFxNodes(false);
      emit('fx', { name: '*' });
    },

    /** true, wenn irgendein Effekt vom Neutralwert abweicht */
    fxActive() {
      return Object.keys(FX_DEFS).some((k) => Math.abs(this.fx[k] - FX_DEFS[k].neutral) > 1e-6);
    },

    setEchoTime(ms) {
      this.echoMs = Math.min(1500, Math.max(50, Number(ms) || 375));
      this._applyFxNodes(false);
    },

    setPitchLock(on) {
      this.pitchLock = !!on;
      this._applyTempoAll();
    },

    _applyFxNodes(immediate) {
      const b = this.buses.master;
      if (b && b.fx) applyFxParams(b.fx, this.fx, this.echoMs, immediate);
      this.voices.forEach((v) => { if (v.fxChain) applyFxParams(v.fxChain, v.tileFx, this.echoMs, immediate); });
    },

    /** Effekte einer laufenden Voice ändern (z. B. nach „Auf Kachel speichern“) */
    setVoiceFx(v, fx) {
      v.tileFx = Object.assign({}, fx || {});
      v.tileRate = Number(v.tileFx.tempo) || 1;
      if (hasSoundFx(v.tileFx) && !v.fxChain) {
        v.fxChain = createFxChain(v.ctx, false);
        try { v.source.disconnect(); } catch (e) { /* ignorieren */ }
        v.source.connect(v.fxChain.input);
        v.fxChain.output.connect(v.gain);
      }
      if (v.fxChain) applyFxParams(v.fxChain, v.tileFx, this.echoMs, false);
      this._applyTempo(v);
    },

    _rateFor(v) {
      const r = (v.tileRate || 1) * (v.bus === 'master' ? this.fx.tempo : 1);
      return Math.min(16, Math.max(0.0625, r));
    },

    _applyTempo(v) {
      const r = this._rateFor(v);
      const a = v.audio;
      try {
        // Ohne Tonhöhenkorrektur klingt es wie ein schneller laufendes Band („Mickymaus“)
        a.preservesPitch = this.pitchLock && r <= 4;
        a.defaultPlaybackRate = r;
        a.playbackRate = r;
      } catch (e) { /* ignorieren */ }
    },

    _applyTempoAll() {
      this.voices.forEach((v) => this._applyTempo(v));
    },

    // ---------------------------------------------------- Pause

    /** Pause/Weiter für alle laufenden Titel. Rückgabe: true = jetzt pausiert */
    togglePause() {
      let running = false;
      this.voices.forEach((v) => { if (!v.paused && (v.state === 'playing' || v.state === 'fading')) running = true; });
      if (running) this.pauseAll(); else this.resumeAll();
      return this.paused;
    },

    pauseVoice(v) {
      if (!v || v.paused || (v.state !== 'playing' && v.state !== 'fading')) return;
      v.paused = true;
      v.pausedAt = performance.now();
      try { v.audio.pause(); } catch (e) { /* ignorieren */ }
    },

    resumeVoice(v) {
      if (!v || !v.paused) return;
      const shift = performance.now() - v.pausedAt;
      v.startedAt += shift;
      if (v.fadeOutStart != null) v.fadeOutStart += shift;
      v.paused = false;
      v.audio.play().catch((err) => emit('error', { voice: v, error: String((err && err.message) || err) }));
      this.ensureTimer();
    },

    /** eine Voice anhalten/fortsetzen (z. B. Pausenmusik-Player) */
    toggleVoicePause(v) {
      if (!v) return false;
      if (v.paused) this.resumeVoice(v); else this.pauseVoice(v);
      this.paused = this._anyPaused();
      emit('change', { type: v.paused ? 'pause' : 'resume', voice: v });
      return v.paused;
    },

    pauseAll() {
      this.voices.forEach((v) => this.pauseVoice(v));
      this.paused = this._anyPaused();
      emit('change', { type: 'pause' });
    },

    resumeAll() {
      this.voices.forEach((v) => this.resumeVoice(v));
      this.paused = false;
      emit('change', { type: 'resume' });
    },

    _anyPaused() {
      let p = false;
      this.voices.forEach((v) => { if (v.paused) p = true; });
      return p;
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
        // gewünschter Starttitel (Player): im Zufallsmodus an den Anfang holen
        const si = Math.min(tracks.length - 1, Math.max(0, opts.startIndex || 0));
        if (opts.shuffle && opts.startIndex != null) { order.splice(order.indexOf(si), 1); order.unshift(si); opts.startPos = 0; }
        else opts.startPos = opts.startIndex != null ? si : 0;
      }
      const firstFile = tracks ? tracks[order[opts.startPos || 0]].file : tile.file;
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
      // Effekte der Kachel (eigene Kette nur, wenn nötig)
      let fxChain = null;
      if (hasSoundFx(opts.fx)) {
        fxChain = createFxChain(bus.ctx, false);
        applyFxParams(fxChain, opts.fx, this.echoMs, true);
        source.connect(fxChain.input);
        fxChain.output.connect(gain);
      } else {
        source.connect(gain);
      }
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
        duck: opts.duck !== false,
        shuffled: !!opts.shuffle,
        fxChain,
        tileFx: Object.assign({}, opts.fx || {}),
        tileRate: (opts.fx && Number(opts.fx.tempo)) || 1,
        tracks, order, trackPos: tracks ? Math.max(0, opts.startPos || 0) : 0,
        duckFactor: 1,
        startedAt: performance.now(),
        fadeOutStart: null,
        fadeOutFrom: 1,
        env: 0,
        paused: false,
        pausedAt: 0,
        state: 'starting'
      };
      if (tracks) this._setTrackMeta(voice);
      // native Schleife nur, wenn kein Start-/Endpunkt gesetzt ist (lückenlos)
      audio.loop = !tracks && voice.loop && !voice.startAt && !voice.endAt;
      audio.volume = 1;
      this._applyTempo(voice);
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
        // „Abgebrochen“ heißt nur: neuer Titel geladen (Weiter/Sprung) oder Pause während des Ladens – kein Fehler
        if (err && err.name === 'AbortError') return voice;
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
      if (v.paused) { v.paused = false; this.paused = this._anyPaused(); }
      v.trackPos++;
      if (v.trackPos >= v.order.length) {
        if (!v.loop) { this.finish(v, 'ended'); return; }
        v.trackPos = 0;
        if (v.shuffled && v.order.length > 2) {   // nur im Zufallsmodus neu mischen
          const last = v.order[v.order.length - 1];
          shuffle(v.order);
          if (v.order[0] === last) v.order.push(v.order.shift());
        }
      }
      this._setTrackMeta(v);
      v.audio.src = fileUrl(v.tracks[v.order[v.trackPos]].file);
      this._applyTempo(v);
      if (manual) { v.startedAt = performance.now(); v.fadeIn = Math.max(v.fadeIn, 250); }
      v.audio.play().catch((err) => emit('error', { voice: v, error: String((err && err.message) || err) }));
      emit('change', { type: 'track', voice: v });
    },

    next(tileId) {
      this.voices.forEach((v) => { if (v.tileId === tileId && v.tracks && v.state !== 'fading') this._advance(v, true); });
    },

    /** Playlist-Index (in tracks) des aktuellen Titels, −1 = unbekannt */
    currentTrackIndex(v) {
      return v && v.tracks && v.trackPos >= 0 ? v.order[v.trackPos] : -1;
    },

    /** zu einem bestimmten Titel springen */
    jumpTo(v, index) {
      if (!v || !v.tracks || !v.tracks[index]) return;
      if (v.paused) { v.paused = false; this.paused = this._anyPaused(); }
      v.trackPos = v.order.indexOf(index) - 1;
      const loop = v.loop; v.loop = true;   // Sprung darf nicht am Listenende enden
      this._advance(v, true);
      v.loop = loop;
    },

    /** zurück: nach >3 s an den Titelanfang, sonst vorheriger Titel */
    prev(v) {
      if (!v || !v.tracks) return;
      if ((v.audio.currentTime || 0) > 3) { v.audio.currentTime = 0; return; }
      const pos = v.trackPos > 0 ? v.trackPos - 1 : (v.loop ? v.order.length - 1 : 0);
      this.jumpTo(v, v.order[pos]);
    },

    seek(v, sec) {
      if (!v) return;
      try { v.audio.currentTime = Math.max(0, sec); } catch (e) { /* ignorieren */ }
    },

    setVoiceVolume(v, vol) { if (v) v.volume = Math.min(1, Math.max(0, vol)); },
    setVoiceLoop(v, on) { if (v) v.loop = !!on; },
    setVoiceDuck(v, on) { if (v) v.duck = !!on; },

    /**
     * Titelliste einer laufenden Playlist ersetzen (Player-Liste bearbeitet).
     * curIndex = Index des laufenden Titels in der neuen Liste (−1 = nicht mehr enthalten)
     */
    setTracks(v, tracks, curIndex, shuffled) {
      if (!v || !v.tracks) return;
      v.tracks = tracks;
      v.shuffled = !!shuffled;
      v.order = tracks.map((_, i) => i);
      if (shuffled) {
        shuffle(v.order);
        if (curIndex >= 0) { v.order.splice(v.order.indexOf(curIndex), 1); v.order.unshift(curIndex); }
      }
      v.trackPos = curIndex >= 0 ? v.order.indexOf(curIndex) : -1;
      emit('change', { type: 'track', voice: v });
    },

    isBedDucked() {
      let jingle = false;
      this.voices.forEach((v) => { if (v.bus === 'master' && v.role !== 'bed' && v.state === 'playing' && !v.paused) jingle = true; });
      return jingle;
    },

    tick(now, dt) {
      const duckOn = this.isBedDucked();
      this.voices.forEach((v) => {
        if (v.paused) return; // Pegel und Blenden ruhen während der Pause
        // Endpunkt: rechtzeitig automatisch ausblenden bzw. Schleife
        if (v.endAt > 0 && v.state === 'playing' && !v.audio.paused) {
          const t = v.audio.currentTime;
          if (v.loop) {
            if (t >= v.endAt) v.audio.currentTime = v.startAt || 0;
          } else {
            const left = ((v.endAt - t) * 1000) / (v.audio.playbackRate || 1);
            if (left <= Math.max(30, v.fadeOut)) this.stop(v.id, true, Math.max(30, left));
          }
        }
        // Ducking weich nachführen
        if (v.role === 'bed') {
          const target = duckOn && v.duck ? this.duck.level : 1;
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
      if (!fade || ms <= 0 || v.state === 'starting' || v.paused) { this.finish(v, 'stopped'); return; }
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
      if (v.fxChain) { try { v.fxChain.output.disconnect(); } catch (e) { /* ignorieren */ } }
      v.audio.removeAttribute('src');
      try { v.audio.load(); } catch (e) { /* ignorieren */ }
      this.voices.delete(v.id);
      if (this.paused && !this._anyPaused()) this.paused = false;
      emit('change', { type: 'end', voice: v, reason });
    },

    stopTile(tileId, fade, bus) {
      this.voices.forEach((v) => { if (v.tileId === tileId && (!bus || v.bus === bus)) this.stop(v.id, fade); });
    },

    // Bereits ausblendende Voices laufen beim Ausblenden ungestört weiter
    stopBus(bus, fade, fadeMs, filter) {
      this.voices.forEach((v) => {
        if (v.bus !== bus) return;
        if (filter && !filter(v)) return;
        if (v.paused) { this.finish(v, 'stopped'); return; }
        if (fade && v.fadeOutStart != null) return;
        this.stop(v.id, fade, fadeMs);
      });
    },

    stopAll(fade, fadeMs) {
      this.voices.forEach((v) => {
        if (v.paused) this.finish(v, 'stopped');
        else if (!(fade && v.fadeOutStart != null)) this.stop(v.id, fade, fadeMs);
      });
      this.paused = false;
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
