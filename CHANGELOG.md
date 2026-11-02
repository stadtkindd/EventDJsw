# Änderungen

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
