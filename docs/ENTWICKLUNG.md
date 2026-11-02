# EventDJ – Technische Dokumentation

## Aufbau

```
EventDJsw/
├─ package.json            Abhängigkeiten, Skripte, electron-builder-Konfiguration
├─ build/icon.png          App-Icon (Installer/EXE)
├─ src/
│  ├─ main/
│  │  ├─ main.js           Main-Prozess: Fenster, IPC, Dialoge, Tastatur (F11), Rechte für Audiogeräte
│  │  ├─ store.js          Datenordner, config.json (atomar + Backup), Bibliothek, Set-Export/-Import (ZIP)
│  │  └─ remote.js         HTTP-Fernsteuerung (Stream Deck, Companion, Browser-Fernbedienung)
│  ├─ preload/preload.js   sichere Brücke (contextBridge) → window.edj
│  ├─ shared/model.js      Datenmodell: Standardwerte, Validierung, Slots, Stile (Main, Renderer, Tests)
│  └─ renderer/
│     ├─ index.html        Grundgerüst der Oberfläche
│     ├─ styles.css        Design (dunkel, große Touch-Ziele)
│     ├─ audio.js          Audio-Engine (Web Audio: Voices, Fades, Ducking, Playlists, Pegel, LUFS-Analyse)
│     └─ app.js            Oberfläche: Reiter, Kacheln, Dialoge, Wellenform, Drag & Drop, Touch, MIDI, Hotkeys
├─ test/model.test.js      Tests des Datenmodells (npm test)
├─ docs/                   Bedienungsanleitung, diese Datei, Screenshots
└─ .github/workflows/      Windows-Build in GitHub Actions
```

Sicherheit: `contextIsolation`, `sandbox`, kein `nodeIntegration`, Content-Security-Policy im HTML. Die Oberfläche kommuniziert ausschließlich über `window.edj` (siehe `preload.js`) mit dem Main-Prozess.

## Datenformat (`config.json`)

```jsonc
{
  "version": 1,
  "settings": {
    "masterDeviceId": "default", "masterDeviceLabel": "",
    "cueDeviceId": "", "cueDeviceLabel": "",
    "masterVolume": 1, "cueVolume": 1,
    "defaultFadeIn": 300, "defaultFadeOut": 1500,      // Millisekunden
    "playMode": "exclusive",                            // | "overlap"
    "retrigger": "stop",                                // | "restart"
    "triggerOn": "up",                                  // | "down"
    "copyToLibrary": true, "showRemaining": true,
    "tileScale": 1, "longPressMs": 550, "confirmReset": true,
    "duckLevel": 0.25, "duckFadeMs": 500,              // Ducking der Hintergrundmusik
    "normalizeOnImport": true, "targetLufs": -16, "showMeter": true,
    "midiEnabled": true, "midiStop": "", "midiFade": "", // z. B. "note:10:36", "cc:1:20", "pc:1:5"
    "httpEnabled": false, "httpPort": 8765, "httpLan": false
  },
  "styles": [
    { "id": "st_satzbeginn", "name": "Satzbeginn", "bg": "#1d5fd1", "fg": "#ffffff", "fontSize": 24, "bold": true }
  ],
  "tabs": [
    {
      "id": "tab_…", "name": "Während des Spiels", "color": "#1d5fd1", "cols": 4, "rows": 3,
      "tiles": [
        {
          "id": "tile_…", "slot": 0,                      // Position: Zeile = slot / cols, Spalte = slot % cols
          "title": "Satzbeginn", "subtitle": "",
          "file": "C:\\Users\\…\\EventDJ\\library\\Satzbeginn.mp3", "fileName": "Satzbeginn.mp3", "duration": 3.2,
          "styleId": "st_satzbeginn",
          "bg": null, "fg": null, "fontSize": null,       // null = vom Stil
          "fadeIn": null, "fadeOut": null,                // null = globaler Standard
          "volume": 1, "startAt": 0, "endAt": 0, "loop": false,   // endAt 0 = Dateiende
          "gainDb": 0, "loudness": -15.9, "peak": 0.24,            // Normalisierung (dB), gemessene LUFS, Spitze linear
          "kind": "single",                                       // | "playlist"
          "playlist": [ { "file": "…", "fileName": "…", "duration": 180, "gainDb": -2.5, "loudness": -13.5, "peak": 0.9 } ],
          "shuffle": false, "role": "normal",                     // | "bed" (Hintergrundmusik, wird abgesenkt)
          "hotkey": "F1", "midi": "note:10:36",
          "playCount": 0
        }
      ]
    }
  ],
  "activeTabId": "tab_…"
}
```

`model.normalizeConfig()` repariert jede eingelesene Konfiguration (fehlende Felder, ungültige Farben, doppelte Slots …), damit eine beschädigte Datei nie den Start verhindert. Gespeichert wird atomar (`.tmp` → umbenennen), die vorige Version liegt in `config.bak.json`.

Ein **Set** (`.edjset`) ist eine ZIP-Datei mit `set.json` (gleiches Format, Dateipfade relativ als `audio/<name>`) und dem Ordner `audio/`.

## Audio-Engine (`audio.js`)

Signalweg (Web Audio API):

```
<audio> → MediaElementSource → Gain (Fade × Lautstärke × Normalisierung × Ducking)
        → Bus-Gain (Master bzw. Vorhören) → AudioContext.destination (Ausgabegerät per setSinkId)
                                        └→ ChannelSplitter → Analyser L/R (Pegelanzeige)
```

- Je **Bus** (Master, Vorhören) ein eigener `AudioContext`; das Ausgabegerät wird mit `AudioContext.setSinkId()` gewählt – so funktioniert jedes Windows-Wiedergabegerät inkl. Bluetooth.
- Jeder Start erzeugt eine **Voice**. Ein 15-ms-Takt berechnet die Hüllkurve (Sinus beim Ein-, Kosinus beim Ausblenden) und setzt den Gain mit `setTargetAtTime` (klickfrei). Gains > 1 sind möglich (Normalisierung leiser Dateien).
- **Endpunkt:** Der Takt startet das Ausblenden so, dass die Fade-Out-Zeit genau am Endpunkt endet. Mit Schleife wird am Endpunkt zum Startpunkt gesprungen; ohne Start-/Endpunkt nutzt die Schleife das native, lückenlose `loop`.
- **Playlists:** Eine Voice wechselt am Titelende die Quelle desselben Audio-Elements (die MediaElementSource bleibt bestehen); Zufallsreihenfolge per Fisher-Yates, beim Wiederholen neu gemischt.
- **Ducking:** Voices mit Rolle `bed` folgen einem Faktor, der linear (Dauer `duckFadeMs`) zwischen 1 und `duckLevel` wandert, solange eine normale Master-Voice spielt. Im Exklusiv-Modus blenden Jingles nur Jingles aus und Hintergrundmusik nur Hintergrundmusik.
- **Lautheit:** Datei über IPC lesen → `decodeAudioData` → K-Bewertung (High-Shelf +4 dB bei 1682 Hz, Hochpass 38 Hz) in einem `OfflineAudioContext` → 400-ms-Blöcke mit 75 % Überlappung, absolute (−70 LUFS) und relative (−10 LU) Schwelle → integrierte Lautheit. Die Verstärkung `target − gemessen` wird durch den Spitzenpegel auf −1 dBFS begrenzt.
- **Vorladen:** Für den sichtbaren Reiter liegen gepufferte Audio-Elemente bereit (max. 64).

## Fernsteuerung

- **Tastatur:** `hotkeyFromEvent()` erzeugt Namen wie `F1`, `Q`, `Num5`, `Ctrl+Shift+A` (über `KeyboardEvent.code`, unabhängig vom Tastaturlayout bei Buchstaben/Ziffern).
- **MIDI:** Web MIDI API (Electron-Berechtigung `midi`). IDs: `note:<kanal>:<nr>`, `cc:<kanal>:<nr>` (Auslösen bei steigender Flanke über 64), `pc:<kanal>:<nr>`.
- **HTTP (`src/main/remote.js`):** Node-`http`-Server im Main-Prozess, standardmäßig nur `127.0.0.1`. Die Oberfläche schickt einen Status-Schnappschuss (`remote:state`), Befehle gehen per IPC (`remote:command`) an die Oberfläche. `GET /` liefert eine Browser-Fernbedienung. Endpunkte siehe Bedienungsanleitung, Abschnitt 14.

## Bedienung per Touch & Maus

`bindPress()` in `app.js` vereinheitlicht Pointer-Events: Tippen/Klicken, **langes Drücken** (= Rechtsklick → Kontextmenü), Wischen bricht ab. Pinch-Zoom ist abgeschaltet, alle Bedienelemente sind mindestens ca. 46–56 px groß. Verschieben funktioniert mit der Maus per Drag & Drop und per Touch über „Verschieben → Zielfeld antippen“.

## Bauen & Veröffentlichen

```bash
npm install
npm start            # Entwicklung
npm run dist         # dist/EventDJ-Setup-x.y.z.exe + dist/EventDJ-Portable-x.y.z.exe (unter Windows)
```

GitHub Actions (`.github/workflows/build.yml`) baut bei jedem Push auf `main` die Windows-EXEs als Artefakt und erstellt bei einem Tag `v*` automatisch ein Release mit beiden Dateien.

Ohne Electron lässt sich die Oberfläche auch im Browser öffnen (`src/renderer/index.html`) – dann greift ein Ersatz-Backend mit `localStorage` (nur zum Ausprobieren, Audiodateien überleben kein Neuladen).

## Ideen für spätere Versionen

- Zweiter Bildschirm mit „Now Playing“-Anzeige
- Zeitgesteuerte Abläufe (Countdown-Jingles, Einlauf-Sequenzen)
- Feedback an MIDI-Controller (LEDs der Pads leuchten bei laufendem Jingle)
