/*
 * EventDJ – Audio-Engine
 *
 * - Jeder Abspielvorgang ist eine "Voice" (HTMLAudioElement mit eigenem Ausgabegerät via setSinkId)
 * - Fade-In / Fade-Out mit gleichleistungs-Kurve (Sinus/Kosinus), zeitgesteuert
 * - Zwei Busse: "master" (Hauptausgang, z. B. Mischpult/Bluetooth) und "cue" (Vorhören, z. B. Kopfhörer)
 * - Vorgeladene Audio-Elemente ("warm cache") für verzögerungsfreien Start
 */
(function (root) {
  'use strict';

  const TICK_MS = 15;

  function fileUrl(p) {
    if (!p) return '';
    if (/^(blob:|data:|file:|https?:)/i.test(p)) return p;
    let s = String(p).replace(/\\/g, '/');
    if (s.startsWith('//')) {
      // UNC-Pfad \\server\share\datei.mp3
      return 'file:' + s.split('/').map((seg, i) => (i < 2 ? seg : encodeURIComponent(seg))).join('/');
    }
    const parts = s.split('/').map((seg, i) => (i === 0 && /^[a-zA-Z]:$/.test(seg) ? seg : encodeURIComponent(seg)));
    s = parts.join('/');
    return 'file://' + (s.startsWith('/') ? '' : '/') + s;
  }

  function easeIn(x) { return Math.sin((Math.min(1, Math.max(0, x)) * Math.PI) / 2); }
  function easeOut(x) { return Math.cos((Math.min(1, Math.max(0, x)) * Math.PI) / 2); }

  const listeners = {};
  function emit(type, data) { (listeners[type] || []).forEach((fn) => { try { fn(data); } catch (e) { console.error(e); } }); }

  const engine = {
    sinks: { master: 'default', cue: '' },
    busVolume: { master: 1, cue: 1 },
    voices: new Map(),
    warm: new Map(),
    timer: null,
    seq: 0,

    on(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },

    fileUrl,

    sinkFor(bus) {
      if (bus === 'cue') return this.sinks.cue || this.sinks.master || 'default';
      return this.sinks.master || 'default';
    },

    async applySink(audio, bus) {
      const id = this.sinkFor(bus);
      const wanted = id === 'default' ? '' : id;
      if (typeof audio.setSinkId !== 'function') return true;
      if (audio.sinkId === wanted) return true;
      try {
        await audio.setSinkId(wanted);
        return true;
      } catch (err) {
        emit('device-error', { bus, deviceId: id, error: String(err && err.message || err) });
        try { await audio.setSinkId(''); } catch (e) { /* ignorieren */ }
        return false;
      }
    },

    async setSink(bus, deviceId) {
      this.sinks[bus] = deviceId || (bus === 'master' ? 'default' : '');
      // laufende Voices dieses Busses umleiten
      const jobs = [];
      this.voices.forEach((v) => { if (v.bus === bus || (bus === 'master' && v.bus === 'cue' && !this.sinks.cue)) jobs.push(this.applySink(v.audio, v.bus)); });
      this.clearWarm();
      await Promise.all(jobs);
    },

    setBusVolume(bus, vol) {
      this.busVolume[bus] = Math.min(1, Math.max(0, Number(vol) || 0));
      this.voices.forEach((v) => this.applyVolume(v, performance.now()));
    },

    async listOutputs() {
      if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return [];
      let devices = await navigator.mediaDevices.enumerateDevices();
      let outs = devices.filter((d) => d.kind === 'audiooutput');
      if (outs.length && outs.every((d) => !d.label)) {
        // Labels werden erst nach Medienfreigabe geliefert – kurz anfragen
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

    warmKey(tile, bus) { return tile.id + '|' + tile.file + '|' + bus; },

    prewarm(tiles) {
      const keep = new Set();
      (tiles || []).slice(0, 64).forEach((tile) => {
        if (!tile.file) return;
        const key = this.warmKey(tile, 'master');
        keep.add(key);
        if (!this.warm.has(key)) {
          const a = new Audio();
          a.preload = 'auto';
          a.src = fileUrl(tile.file);
          this.applySink(a, 'master');
          a.load();
          this.warm.set(key, a);
        }
      });
      this.warm.forEach((a, key) => {
        if (!keep.has(key)) { a.removeAttribute('src'); a.load(); this.warm.delete(key); }
      });
    },

    clearWarm() {
      this.warm.forEach((a) => { a.removeAttribute('src'); a.load(); });
      this.warm.clear();
    },

    takeAudio(tile, bus) {
      const key = this.warmKey(tile, bus);
      const a = this.warm.get(key);
      if (a) {
        this.warm.delete(key);
        // Nachladen für den nächsten Start
        setTimeout(() => this.prewarm(engine._lastWarmTiles), 50);
        return a;
      }
      const audio = new Audio();
      audio.preload = 'auto';
      audio.src = fileUrl(tile.file);
      return audio;
    },

    // ---------------------------------------------------- Wiedergabe

    /**
     * Startet eine Kachel.
     * opts: { bus, fadeIn, fadeOut, volume, startAt, loop }
     */
    async play(tile, opts) {
      opts = opts || {};
      const bus = opts.bus || 'master';
      const audio = this.takeAudio(tile, bus);
      const voice = {
        id: 'v' + (++this.seq),
        tileId: tile.id,
        title: tile.title,
        bus,
        audio,
        fadeIn: Math.max(0, opts.fadeIn || 0),
        fadeOut: Math.max(0, opts.fadeOut || 0),
        volume: opts.volume == null ? 1 : opts.volume,
        startedAt: performance.now(),
        fadeOutStart: null,
        fadeOutFrom: 1,
        env: 0,
        state: 'starting'
      };
      audio.loop = !!opts.loop;
      audio.volume = 0;
      this.voices.set(voice.id, voice);
      emit('change', { type: 'start', voice });

      audio.onended = () => this.finish(voice, 'ended');
      audio.onerror = () => {
        emit('error', { voice, error: (audio.error && audio.error.message) || 'Datei kann nicht abgespielt werden' });
        this.finish(voice, 'error');
      };

      await this.applySink(audio, bus);
      if (opts.startAt > 0) {
        try {
          if (audio.readyState < 1) await new Promise((res) => { audio.addEventListener('loadedmetadata', res, { once: true }); setTimeout(res, 1500); });
          audio.currentTime = opts.startAt;
        } catch (e) { /* ignorieren */ }
      }
      if (voice.state === 'done') return voice; // währenddessen gestoppt
      voice.startedAt = performance.now();
      voice.state = 'playing';
      this.applyVolume(voice, voice.startedAt);
      try {
        await audio.play();
      } catch (err) {
        if (voice.state !== 'done') {
          emit('error', { voice, error: String(err && err.message || err) });
          this.finish(voice, 'error');
        }
        return voice;
      }
      this.ensureTimer();
      return voice;
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
      const vol = env * v.volume * (this.busVolume[v.bus] == null ? 1 : this.busVolume[v.bus]);
      v.audio.volume = Math.min(1, Math.max(0, vol));
    },

    ensureTimer() {
      if (this.timer) return;
      this.timer = setInterval(() => {
        const now = performance.now();
        this.voices.forEach((v) => this.applyVolume(v, now));
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
      if (v.fadeOutStart != null) {
        // zweiter Stopp während Ausblenden → sofort aus
        this.finish(v, 'stopped');
        return;
      }
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
      v.audio.removeAttribute('src');
      try { v.audio.load(); } catch (e) { /* ignorieren */ }
      this.voices.delete(v.id);
      emit('change', { type: 'end', voice: v, reason });
    },

    stopTile(tileId, fade, bus) {
      this.voices.forEach((v) => { if (v.tileId === tileId && (!bus || v.bus === bus)) this.stop(v.id, fade); });
    },

    // Bereits ausblendende Voices laufen beim Ausblenden ungestört weiter
    stopBus(bus, fade, fadeMs) {
      this.voices.forEach((v) => { if (v.bus === bus && !(fade && v.fadeOutStart != null)) this.stop(v.id, fade, fadeMs); });
    },

    stopAll(fade, fadeMs) {
      this.voices.forEach((v) => { if (!(fade && v.fadeOutStart != null)) this.stop(v.id, fade, fadeMs); });
    },

    voicesForTile(tileId, bus) {
      const out = [];
      this.voices.forEach((v) => { if (v.tileId === tileId && (!bus || v.bus === bus)) out.push(v); });
      return out;
    },

    /** Prüfton auf einem Bus */
    async testTone(bus) {
      const rate = 44100, secs = 0.8, n = Math.floor(rate * secs);
      const buf = new ArrayBuffer(44 + n * 2);
      const dv = new DataView(buf);
      const w = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
      w(0, 'RIFF'); dv.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
      dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
      dv.setUint32(24, rate, true); dv.setUint32(28, rate * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
      w(36, 'data'); dv.setUint32(40, n * 2, true);
      for (let i = 0; i < n; i++) {
        const t = i / rate;
        const env = Math.min(1, t / 0.02, (secs - t) / 0.1);
        const f = t < secs / 2 ? 660 : 880;
        dv.setInt16(44 + i * 2, Math.sin(2 * Math.PI * f * t) * env * 0.4 * 32767, true);
      }
      const url = URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
      const a = new Audio(url);
      a.volume = this.busVolume[bus] == null ? 1 : this.busVolume[bus];
      await this.applySink(a, bus);
      a.onended = () => URL.revokeObjectURL(url);
      await a.play();
    },

    /** Dauer einer Datei ermitteln (Sekunden) */
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
    }
  };

  // Für Nachladen merken
  const origPrewarm = engine.prewarm.bind(engine);
  engine.prewarm = function (tiles) { engine._lastWarmTiles = tiles; origPrewarm(tiles); };

  if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
    navigator.mediaDevices.addEventListener('devicechange', () => emit('devices-changed'));
  }

  root.AudioEngine = engine;
})(window);
