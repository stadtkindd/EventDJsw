# Änderungen

## 1.3.0 – 2026-11-05

- **Pausenmusik-Player** (Knopf ♫ unten bzw. `Strg+P`): eigenständiger Playlist-Player als Seitenleiste – Titel per Ziehen oder „+ Titel“ hinzufügen, Reihenfolge ändern, Titel antippen zum Abspielen, ⏮ ❚❚ ⏭ ■, Spulen, **Ausblenden** mit wählbarer Zeit (1/3/5/10 s), Zufall, Endlos, Lautstärke. Läuft unabhängig von den Kacheln weiter und wird bei Jingles automatisch abgesenkt (Ducking, abschaltbar). Die Liste wird gespeichert und ist im Set-Export enthalten.
- **Reset-Knopf ⟲ an jedem Effekt** – setzt nur diesen Effekt zurück.
- **Effekte per Pfeiltasten:** Regler antippen oder mit `↑`/`↓` wählen, mit `←`/`→` fein verstellen (`Umschalt` = grob), `Entf` setzt den gewählten Regler zurück. Nur aktiv, solange die Effektleiste offen ist.
- **Effekte pro Kachel speichern:** im Kachel-Dialog → Wiedergabe → „Klang & Effekte dieser Kachel“ (Tempo, Bass, Höhen, Filter, Hall, Echo) oder direkt aus der Effektleiste mit „💾 Auf Kachel“. Kacheln mit eigenen Effekten zeigen ✦.
- HTTP-Fernsteuerung: `/api/music`, `/api/musicnext`, `/api/musicfade`.
- Behoben: „Nächster Titel“ oder Pause direkt nach dem Start einer Playlist konnte die Wiedergabe beenden; Playlists ohne Zufallsmodus wurden nach dem ersten Durchlauf gemischt.

## 1.2.0 – 2026-11-05

- **Reiterleiste neu:** alle Reiter immer gleich breit (10 Plätze je Leiste), kein Scrollbalken mehr. Lange Namen werden automatisch verkleinert bzw. zweizeilig eingepasst.
- **Reiter-Ebenen:** bis zu 3 Reiterleisten à 10 Reiter (max. 30), Umschalter **1 · 2 · 3** links neben den Reitern. Reiter per Dialog, Rechtsklick oder Ziehen auf die Ebenen-Taste verschieben.
- **Live-Effektleiste (FX):** Regler für **Tempo** (0,25×–16×, Schnelltasten 1×/2×/5×/10×, Stufen frei einstellbar), **Bass**, **Höhen**, **Filter** (dumpf ↔ Telefon), **Hall** und **Echo** – wirkt live auf den Master, Vorhören bleibt unberührt. Sichtbare Regler wählbar, Limiter gegen Übersteuern, MIDI-Fader zuweisbar, optional Tonhöhe halten.
- **Pause:** alles anhalten und fortsetzen (Leertaste oder Knopf ❚❚), Blenden laufen danach korrekt weiter.
- **Player-Tasten frei belegbar** (Einstellungen → Tasten): Standard `Enter` = sofort alles stoppen, `Leertaste` = Pause, `Esc` = ausblenden, `Bild↑/↓` = Reiter, `Strg+Bild↑/↓` = Ebene, `+`/`−` = Tempo, `Strg+F` = Effektleiste, `Rücktaste` = Effekte aus u. a.
- `Strg+1` … `Strg+9`, `Strg+0` wählen die Reiter der angezeigten Ebene.
- Restzeit berücksichtigt das Tempo.
- HTTP-Fernsteuerung: neue Befehle `/api/pause`, `/api/tempo/<faktor>`, `/api/fx/<name>/<wert>`, `/api/fxreset`; Browser-Fernbedienung mit Pause- und Tempo-Knöpfen.

## 1.1.0 – 2026-11-02

- **Wellenform-Editor:** Start- und Endpunkt per Touch/Maus setzen, automatisches Ausblenden am Endpunkt, Schleife zwischen Start und Ende, Abspielposition beim Vorhören
- **Lautheit:** LUFS-Messung (ITU-R BS.1770) und Normalisierung auf eine Ziel-Lautheit – automatisch beim Import oder für alle Kacheln auf einmal; manuelle Pegelanpassung in dB
- **Pegelanzeige** (VU-Meter L/R mit Spitzenwert und Clip-Warnung) in der Fußzeile
- **Playlists:** Kacheln mit mehreren Titeln, Zufallsreihenfolge, Wiederholen, „Nächster Titel“
- **Hintergrundmusik mit Ducking:** wird während eines Jingles automatisch abgesenkt (Pegel und Zeit einstellbar)
- **Tastenkürzel pro Kachel** (auch für Elgato Stream Deck „Hotkey“)
- **MIDI-Controller** mit Lernfunktion, globale MIDI-Tasten für Stoppen/Ausblenden
- **HTTP-Schnittstelle** für Stream Deck/Bitfocus Companion und Browser-Fernbedienung (Tablet/Handy)
- Kachel-Dialog und Einstellungen in übersichtliche Seiten gegliedert
- Audio-Engine auf Web Audio umgestellt (klickfreie Fades, Verstärkung über 100 % für Normalisierung)

## 1.0.0 – 2026-11-02

Erste Version.

- Reiter mit Name, Farbe und frei wählbarer Kachel-Matrix (1–12 × 1–12)
- Jingle-Kacheln mit Titel, Untertitel, Zähler, Play-Button, Restzeit und Fortschritt
- Fade-In/Fade-Out global und pro Kachel, Crossfade im Exklusiv-Modus, Loop, Startpunkt, Lautstärke
- Kachel-Stile („Eigenschaften“) mit Farben und Schriftgröße, pro Kachel überschreibbar
- Master- und Vorhör-Ausgang (jedes Windows-Wiedergabegerät inkl. Bluetooth/USB/HDMI), Prüfton
- Zähler zurücksetzen: alles („Neues Spiel“), pro Reiter, pro Kachel
- Bedienung per Touch (Tippen, langes Drücken) und Maus (Klick, Rechtsklick, Drag & Drop)
- Drag & Drop aus dem Explorer, Kopie in die EventDJ-Bibliothek
- Automatisches Speichern mit Backup, Set-Export/-Import (.edjset inkl. Audiodateien), Portable-Modus
