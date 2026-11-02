// Einfache Tests für das Datenmodell: node test/model.test.js
'use strict';
const assert = require('assert');
const M = require('../src/shared/model');

let n = 0;
function test(name, fn) { fn(); n++; console.log('✔ ' + name); }

test('Standardkonfiguration ist gültig', () => {
  const c = M.normalizeConfig(M.defaultConfig());
  assert.strictEqual(c.tabs.length, 3);
  assert.ok(c.styles.find((s) => s.name === 'Satzbeginn'));
  assert.strictEqual(c.activeTabId, c.tabs[0].id);
});

test('Kaputte Konfiguration wird repariert', () => {
  const c = M.normalizeConfig({ tabs: [{ cols: 99, rows: -3, color: 'rot', tiles: [{ slot: 0 }, { slot: 0 }] }], settings: { playMode: 'xyz', defaultFadeOut: 'a' } });
  assert.strictEqual(c.tabs[0].cols, 12);
  assert.strictEqual(c.tabs[0].rows, 1);
  assert.strictEqual(c.tabs[0].color, '#1d5fd1');
  assert.deepStrictEqual(c.tabs[0].tiles.map((t) => t.slot), [0, 1]);
  assert.strictEqual(c.settings.playMode, 'exclusive');
  assert.strictEqual(c.settings.defaultFadeOut, 1500);
});

test('Freie Slots und Zeilen-Erweiterung', () => {
  const tab = M.newTab('T', '#000000', 2, 2);
  tab.tiles.push(M.newTile(0), M.newTile(2));
  assert.deepStrictEqual(M.freeSlots(tab, 0, 3), [1, 3, 4]);
  tab.tiles.push(M.newTile(5));
  assert.strictEqual(M.effectiveRows(tab), 3);
});

test('Kacheln verschieben/tauschen', () => {
  const tab = M.newTab('T', '#000000', 3, 1);
  const a = M.newTile(0, { title: 'A' });
  const b = M.newTile(1, { title: 'B' });
  tab.tiles.push(a, b);
  M.moveTile(tab, a.id, 1);
  assert.strictEqual(a.slot, 1);
  assert.strictEqual(b.slot, 0);
  M.moveTile(tab, a.id, 2);
  assert.strictEqual(a.slot, 2);
});

test('Zähler zurücksetzen (alle / ein Reiter)', () => {
  const c = M.defaultConfig();
  c.tabs[0].tiles.push(M.newTile(0, { playCount: 4 }));
  c.tabs[1].tiles.push(M.newTile(0, { playCount: 2 }));
  M.resetCounters(c, c.tabs[1].id);
  assert.strictEqual(c.tabs[0].tiles[0].playCount, 4);
  assert.strictEqual(c.tabs[1].tiles[0].playCount, 0);
  M.resetCounters(c);
  assert.strictEqual(c.tabs[0].tiles[0].playCount, 0);
});

test('Stil + Überschreibungen', () => {
  const c = M.defaultConfig();
  const t = M.newTile(0, { styleId: 'st_auszeit' });
  assert.strictEqual(M.resolveLook(c, t).bg, '#1f9d55');
  t.bg = '#123456';
  t.fontSize = 40;
  c.settings.tileScale = 1.5;
  const look = M.resolveLook(c, t);
  assert.strictEqual(look.bg, '#123456');
  assert.strictEqual(look.fontSize, 60);
});

test('Audioformate & Titel', () => {
  assert.ok(M.isAudioFile('C:\\Musik\\Tor.MP3'));
  assert.ok(M.isAudioFile('x.flac'));
  assert.ok(!M.isAudioFile('bild.jpg'));
  assert.strictEqual(M.titleFromFileName('C:\\a\\Ironie_Gegner.wav'), 'Ironie Gegner');
});

test('Playlist, Rolle, Fernsteuerung werden normalisiert', () => {
  const t = M.normalizeTile({ kind: 'playlist', playlist: [{ file: 'a.mp3', gainDb: 99 }, { file: '' }], role: 'bed', hotkey: 'F1', midi: 'note:10:36', endAt: -3 });
  assert.strictEqual(t.kind, 'playlist');
  assert.strictEqual(t.playlist.length, 1);
  assert.strictEqual(t.playlist[0].gainDb, 24);
  assert.strictEqual(t.role, 'bed');
  assert.strictEqual(t.endAt, 0);
  assert.deepStrictEqual(M.tileFiles(t), ['a.mp3']);
  assert.ok(M.tileHasAudio(t));
  assert.ok(!M.tileHasAudio(M.normalizeTile({ kind: 'playlist' })));
});

test('Normalisierungs-Verstärkung mit Spitzenbegrenzung', () => {
  assert.strictEqual(M.normalizeGain(-22, 0.1, -16), 6);       // genug Reserve
  assert.strictEqual(M.normalizeGain(-22, 0.7, -16), 2.1);     // Spitze −3,1 dBFS → max. +2,1 dB
  assert.strictEqual(M.normalizeGain(-10, 1, -16), -6);
  assert.strictEqual(M.normalizeGain(null, 1, -16), 0);
});

test('Neue Einstellungen mit Standardwerten', () => {
  const c = M.normalizeConfig({ settings: { httpPort: 80, duckLevel: 3 } });
  assert.strictEqual(c.settings.httpPort, 1024);
  assert.strictEqual(c.settings.duckLevel, 1);
  assert.strictEqual(c.settings.targetLufs, -16);
  assert.strictEqual(c.settings.httpEnabled, false);
});

console.log('\n' + n + ' Tests bestanden.');
