# EventDJ – Technische Dokumentation

## Aufbau

```
EventDJsw/
├─ package.json            Abhängigkeiten, Skripte, electron-builder-Konfiguration
├─ build/icon.png          App-Icon (Installer/EXE)
├─ src/
│  ├─ main/
│  │  ├─ main.js           Main-Prozess: Fenster, IPC, Dialoge, Tastatur (F11), Rechte für Audiogeräte
│  │  └─ store.js          Datenordner, config.json (atomar + Backup), Bibliothek, Set-Export/-Import (ZIP)
│  ├─ preload/preload.js   sichere Brücke (contextBridge) → window.edj
│  ├─ shared/model.js      Datenmodell: Standardwerte, Validierung, Slots, Stile (Main, Renderer, Tests)
│  └─ renderer/
│     ├─ index.html        Grundgerüst der Oberfläche
│     ├─ styles.css        Design (dunkel, große Touch-Ziele)
│     ├─ audio.js          Audio-Engine (Voices, Fades, Ausgabegeräte, Vorladen)
│     └─ app.js            Oberfläche: Reiter, Kacheln, Dialoge, Drag & Drop, Touch-Gesten
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
    "tileScale": 1, "longPressMs": 550, "confirmReset": true
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
          "volume": 1, "startAt": 0, "loop": false,
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

- Jeder Start erzeugt eine **Voice** (ein `HTMLAudioElement`). Das Ausgabegerät wird per `setSinkId()` gesetzt – so funktioniert jedes Windows-Wiedergabegerät, auch Bluetooth, ohne zusätzliche Treiber.
- Zwei **Busse**: `master` und `cue` (Vorhören), jeweils mit eigenem Gerät und eigener Lautstärke.
- **Fades** laufen über einen 15-ms-Takt mit gleichleistungs-Kurven (Sinus beim Einblenden, Kosinus beim Ausblenden). Wird während des Einblendens gestoppt, beginnt das Ausblenden am aktuellen Pegel – keine Sprünge.
- **Exklusiv-Modus**: Beim Start eines neuen Jingles werden alle laufenden Master-Voices mit ihrem Fade-Out ausgeblendet (= Crossfade). Bereits ausblendende Voices laufen ungestört zu Ende.
- **Vorladen**: Für die Kacheln des sichtbaren Reiters liegen fertig gepufferte Audio-Elemente bereit (max. 64), damit ein Tipp ohne Ladeverzögerung startet.
- `backgroundThrottling: false` im Fenster sorgt dafür, dass Fades auch weiterlaufen, wenn das Fenster nicht im Vordergrund ist.

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

- Hotkeys pro Kachel (Tastatur / MIDI-Controller / Stream Deck)
- Pegelanzeige (VU-Meter) und Lautheits-Normalisierung beim Import
- Wellenform-Ansicht zum Setzen von Start-/Endpunkten
- Playlists / Hintergrundmusik mit automatischem „Ducking“
