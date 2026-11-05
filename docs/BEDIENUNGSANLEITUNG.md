# EventDJ – Bedienungsanleitung

## 1. Die Oberfläche

```
┌──────────────────────────────────────────────────────────────────────┐
│ E │1 2 3│ Reiter 1 │ Reiter 2 │ Reiter 3 │ … (10)│  ↺ ✎ ⚙ ⛶         │  ← Kopfzeile
├──────────────────────────────────────────────────────────────────────┤
│  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐                         │
│  │3× STIL │ │0×      │ │        │ │        │                         │  ← Kachel-Matrix
│  │ Titel  │ │ Titel  │ │        │ │        │                         │    (Spalten × Zeilen
│  │▶  0:12 │ │▶  0:05 │ │        │ │        │                         │     pro Reiter)
│  └────────┘ └────────┘ └────────┘ └────────┘                         │
├──────────────────────────────────────────────────────────────────────┤
│ Tempo 1× 2× 5× 10× │ Bass │ Höhen │ Filter │ Hall │ Echo │ ⟲ Alle aus  │  ← Effektleiste (FX)
├──────────────────────────────────────────────────────────────────────┤
│ ▶ läuft …  −0:08 ■ │ Master ━━━● │ FX │ ❚❚ │ Ausblenden │ STOP        │  ← Fußzeile
└──────────────────────────────────────────────────────────────────────┘
```

**Kachel** – oben links der **Zähler** (wie oft gespielt), daneben der Name der **Eigenschaft/Stil**, in der Mitte der **Titel**, unten der **Play-Button** und die **Länge** bzw. während der Wiedergabe die **Restzeit**. Eine laufende Kachel leuchtet weiß und zeigt einen Fortschrittsbalken; ausblendende Kacheln werden etwas blasser. Graue Kacheln mit „Datei fehlt“ verweisen auf eine Audiodatei, die nicht mehr gefunden wird.

**Fußzeile** – alle gerade laufenden Jingles mit Restzeit und eigenem Stopp-Button (ein Tipp = ausblenden, nochmal = sofort aus), die aktuellen Ausgabegeräte, der Master-Lautstärkeregler, **FX** (Effektleiste ein/aus – leuchtet orange umrandet, solange ein Effekt aktiv ist), **❚❚ Pause**, **Ausblenden** (alles mit Fade-Out) und **STOP** (sofort alles aus).

## 2. Live-Modus und Bearbeitungsmodus

EventDJ startet im **Live-Modus**: Ein Tipp auf eine Kachel spielt den Jingle, ein weiterer Tipp blendet ihn aus. Versehentliche Änderungen sind hier nicht möglich.

Mit **✎ Bearbeiten** (oder `Strg+E`) wechselst du in den **Bearbeitungsmodus** (gelb gestreifter Hinweis). Jetzt gilt:

- leeres Feld (**+**) antippen → Audiodateien auswählen
- Kachel antippen → Kachel bearbeiten
- aktiven Reiter antippen → Reiter bearbeiten, **+** neben den Reitern → neuer Reiter
- Kacheln mit der Maus auf ein anderes Feld ziehen (belegtes Feld = tauschen) oder auf einen anderen Reiter ziehen

Mit **Fertig** geht es zurück in den Live-Modus.

## 3. Reiter

Reiter gliedern deine Jingles, z. B. *Während des Spiels*, *Satzpausen*, *Hymnen*, *Einlauf*, *Sponsoren*.

Im Dialog **Reiter bearbeiten**:

- **Name** und **Farbe** (Farbfelder oder eigene Farbe)
- **Kachel-Matrix**: Spalten und Zeilen (je 1–12). Die Vorschau zeigt die Belegung. Wird die Matrix verkleinert, gehen keine Kacheln verloren – überzählige Kacheln werden in zusätzlichen (scrollbaren) Zeilen angezeigt.
- **Position**: nach links/rechts (mit der Maus auch per Ziehen in der Reiterleiste)
- **Zähler dieses Reiters zurücksetzen**
- **Reiter löschen** (der letzte Reiter bleibt immer erhalten)

Rechtsklick auf einen Reiter öffnet ein Schnellmenü. Ein grüner Punkt am Reiter zeigt, dass dort gerade etwas läuft.

**Gleich breite Reiter:** Die Reiterleiste hat immer 10 gleich breite Plätze – es entsteht nie ein Scrollbalken. Lange Namen werden automatisch kleiner und bei Bedarf zweizeilig dargestellt.

**Reiter-Ebenen (bis zu 3 Leisten):** Links neben den Reitern schaltet **1 · 2 · 3** zwischen bis zu drei Reiterleisten um – zusammen also bis zu 30 Reiter. Die Ebene mit dem gerade aktiven Reiter ist unterstrichen, ein grüner Punkt zeigt, dass auf dieser Ebene etwas läuft. Leere Ebenen sind nur im Bearbeitungsmodus wählbar (zum Anlegen neuer Reiter). Einen Reiter verschiebst du auf eine andere Ebene über *Reiter bearbeiten → Reiter-Ebene*, per Rechtsklick → *Auf Ebene … verschieben* oder indem du ihn mit der Maus auf die Ebenen-Taste ziehst.

`Strg+1` … `Strg+9` und `Strg+0` springen zum 1.–10. Reiter der angezeigten Ebene, `Bild↑`/`Bild↓` blättern durch alle Reiter, `Strg+Bild↑`/`Strg+Bild↓` wechseln die Ebene.

## 4. Jingles hinzufügen

- **Drag & Drop**: Eine oder mehrere Dateien aus dem Windows-Explorer auf die Kachelfläche ziehen. Sie werden ab dem Feld, auf dem du loslässt, in die freien Felder einsortiert. Ziehst du **eine** Datei auf eine **belegte** Kachel, fragt EventDJ, ob die Audiodatei ersetzt werden soll (Einstellungen der Kachel bleiben erhalten). Beim Ziehen über einen anderen Reiter wechselt EventDJ nach kurzer Zeit dorthin.
- **Datei-Dialog**: Im Bearbeitungsmodus ein leeres Feld antippen. Bei genau einer Datei öffnet sich gleich der Bearbeiten-Dialog.

Unterstützte Formate: **MP3, WAV, OGG, FLAC, M4A/AAC, OPUS, WEBM**. (WMA wird nicht unterstützt.)

Standardmäßig kopiert EventDJ die Dateien in seine eigene **Bibliothek**. So funktionieren die Kacheln auch dann noch, wenn die Originale verschoben oder gelöscht werden (abschaltbar unter *Einstellungen → Daten & Sicherung*).

## 5. Kachel bearbeiten

Oben links siehst du eine **Live-Vorschau** der Kachel.

| Feld | Bedeutung |
|---|---|
| **Titel / Untertitel** | Text auf der Kachel (Untertitel kleiner, z. B. Interpret) |
| **Audiodatei** | Datei wählen oder austauschen; **🎧 Vorhören** spielt sie auf dem Kopfhörer-Ausgang |
| **Eigenschaft (Kachel-Stil)** | Vorlage für Farben und Schrift, z. B. *Satzbeginn*, *Auszeiten*, *Ironie Gegner* |
| **Aussehen anpassen** | Eigene Hintergrund-/Schriftfarbe und Schriftgröße nur für diese Kachel |
| **Fade-In** | Einblendzeit beim Start (Standard oder eigener Wert, 0 = hart) |
| **Fade-Out beim Stoppen** | Ausblendzeit, wenn du stoppst oder ein anderer Jingle übernimmt |
| **Lautstärke** | Pegel dieser Kachel (zum Angleichen lauter/leiser Dateien) |
| **Start bei** | Überspringt z. B. Stille am Dateianfang |
| **Endlosschleife** | Für Hintergrundmusik in Pausen – läuft, bis gestoppt wird (Symbol ⟲) |
| **Zähler** | Abspielzähler manuell setzen |
| **Ablage** | Kachel in einen anderen Reiter verschieben, Position im Raster ändern, duplizieren |

**Löschen** entfernt die Kachel (die Audiodatei in der Bibliothek bleibt bis zum Aufräumen erhalten).

## 6. Eigenschaften / Kachel-Stile

Unter **⚙ Einstellungen → Kachel-Stile** definierst du einmalig deine Eigenschaften:

| Beispiel | Hintergrund | Schrift |
|---|---|---|
| Satzbeginn | blau | weiß |
| Auszeiten | grün | weiß |
| Ironie Gegner | gelb | schwarz |
| Punkt Heim | rot | weiß |
| Hymne | lila | weiß |

Jeder Stil hat Name, Hintergrundfarbe, Schriftfarbe, Schriftgröße und „fett“. Änderungen wirken sofort auf alle Kacheln mit diesem Stil. Wird ein Stil gelöscht, erhalten seine Kacheln den ersten Stil der Liste.

Unter **Darstellung** lässt sich die Schriftgröße **aller** Kacheln gemeinsam skalieren (50–250 %) – praktisch, wenn die App auf einem kleineren oder größeren Bildschirm läuft.

## 7. Wiedergabe-Verhalten

Unter **⚙ Einstellungen → Wiedergabe**:

- **Standard Fade-In / Fade-Out** – gilt für alle Kacheln ohne eigenen Wert (Werkseinstellung 300 ms / 1500 ms).
- **Neuer Jingle, während einer läuft**
  - *Laufenden ausblenden* (Standard): Der laufende Jingle blendet mit seinem Fade-Out aus, während der neue einblendet → sauberer Übergang.
  - *Gleichzeitig spielen*: Jingles überlagern sich (z. B. Soundeffekt über Musik).
- **Laufende Kachel erneut antippen** – *Ausblenden* (Standard) oder *Neu starten*.
- **Auslösen** – *Beim Loslassen* (Standard, verhindert Fehlauslösungen beim Wischen) oder *Sofort beim Berühren* (schnellstmöglich; das Kontextmenü gibt es dann per Rechtsklick oder im Bearbeitungsmodus).
- **Langes Drücken** – wie lange ein Finger liegen muss, bis das Kontextmenü erscheint.

Jeder Start im Live-Modus zählt den **Zähler** der Kachel hoch (Vorhören zählt nicht).

## 8. Audio-Ausgänge

Unter **⚙ Einstellungen → Audio-Ausgabe** erscheinen alle Wiedergabegeräte, die Windows kennt:

- eingebaute Lautsprecher / **Kopfhörer-Klinke**
- **USB-Soundkarten** und Audio-Interfaces (mehrere Ausgänge erscheinen als einzelne Geräte)
- **HDMI / DisplayPort** (Monitor, Beamer)
- **Bluetooth**-Lautsprecher und -Kopfhörer

**Master-Ausgang** = was das Publikum hört (Mischpult, PA, Bluetooth-Box).
**Vorhör-Ausgang** = dein Kopfhörer. Über das Kontextmenü einer Kachel (lange drücken / Rechtsklick → *Vorhören*) oder im Bearbeiten-Dialog hörst du einen Jingle vor, ohne dass er über die Anlage läuft. „— wie Master —“ heißt: kein eigener Vorhör-Ausgang.

Mit **♪ Test** spielt EventDJ einen kurzen Prüfton auf dem jeweiligen Ausgang. Wird ein gewähltes Gerät getrennt (z. B. Bluetooth-Box aus), nutzt EventDJ den Windows-Standard und zeigt einen Hinweis; beim erneuten Verbinden wird das Gerät automatisch wiedererkannt.

**Tipps für den Live-Einsatz**

- Bluetooth hat systembedingt ca. 0,1–0,3 s Verzögerung und kann abbrechen – für die Hallen-PA ist Kabel oder ein USB-Interface zuverlässiger.
- Windows-Systemklänge und Benachrichtigungen ausschalten (Fokus-Assistent), Energiesparmodus deaktivieren.
- Typisches Setup: Laptop-Klinke → Kopfhörer (Vorhören), USB-Interface → Mischpult (Master).

## 9. Neues Spiel / Event

**↺ Neues Spiel** in der Kopfzeile setzt **alle** Abspielzähler auf 0 (mit Rückfrage – abschaltbar unter *Darstellung*). Einzelne Reiter setzt du im Reiter-Dialog oder per Rechtsklick auf den Reiter zurück, einzelne Kacheln über ihr Kontextmenü.

## 10. Daten, Sicherung und Umzug auf einen anderen PC

- EventDJ **speichert automatisch** jede Änderung (inkl. Zähler). Die vorherige Fassung bleibt als `config.bak.json` erhalten.
- Datenordner: `%APPDATA%\EventDJ` (Portable-Version: `EventDJ-Daten` neben der EXE). Öffnen über *Einstellungen → Daten & Sicherung → Datenordner öffnen*.
- **Set exportieren** erzeugt eine `.edjset`-Datei mit allen Reitern, Kacheln, Stilen **und Audiodateien**.
- **Set importieren** ersetzt das aktuelle Set. Die Geräteeinstellungen des PCs (Ausgänge, Lautstärken) bleiben erhalten. Ein Doppelklick auf eine `.edjset`-Datei öffnet sie direkt in EventDJ (installierte Version).
- **Bibliothek aufräumen** löscht Audiodateien aus der Bibliothek, die keiner Kachel mehr zugeordnet sind.

## 11. Wellenform: Start- und Endpunkt

Kachel bearbeiten → **Audio**. Unter der Datei siehst du die **Wellenform**:

- **grüner Marker** = Startpunkt, **roter Marker** = Endpunkt. Marker mit Finger oder Maus ziehen oder einfach ins Bild tippen (der nähere Marker springt dorthin). Feineinstellung mit **−/+** in 0,1-s-Schritten.
- Der dunkle Bereich wird nicht gespielt. Der rötliche Verlauf vor dem Endpunkt zeigt das **automatische Ausblenden** (Länge = Fade-Out der Kachel).
- Mit **Endlosschleife** springt die Wiedergabe am Endpunkt zurück zum Startpunkt – ideal, um nur den Refrain zu loopen.
- **🎧 Vorhören** spielt den gewählten Ausschnitt auf dem Kopfhörer, die weiße Linie zeigt die Position.
- **Zurücksetzen** = ganze Datei.

Auf der Kachel zeigt ⇥ an, dass ein Endpunkt gesetzt ist; die angezeigte Länge ist die des Ausschnitts.

## 12. Lautheit angleichen & Pegelanzeige

Jingles aus verschiedenen Quellen sind oft unterschiedlich laut. EventDJ misst die **Lautheit (LUFS)** jeder Datei nach dem Rundfunkstandard ITU-R BS.1770 und gleicht sie auf eine **Ziel-Lautheit** an (Werkseinstellung −16 LUFS).

- Neue Dateien werden automatisch analysiert (abschaltbar unter *Einstellungen → Audio → Lautheit*).
- Kachel bearbeiten → **Audio → Lautheit / Normalisierung**: gemessener Wert, Spitzenpegel und die **Pegelanpassung** in dB (von Hand änderbar, −24 … +24 dB). Leise Dateien werden höchstens so weit angehoben, dass die Spitze −1 dBFS nicht überschreitet.
- **Einstellungen → Audio → „Alle Kacheln analysieren & normalisieren“** gleicht ein bestehendes Set in einem Rutsch an, z. B. nach einer Änderung der Ziel-Lautheit.
- Die **Pegelanzeige** in der Fußzeile zeigt links/rechts den Master-Pegel (grün bis −12 dB, gelb bis −3 dB, rot darüber, weiße Linie = Spitzenwert). **CLIP** leuchtet bei Übersteuerung – dann Master oder Kachel-Lautstärke etwas zurücknehmen.

## 13. Playlists und Hintergrundmusik (Ducking)

**Playlist anlegen:** Kachel bearbeiten → **Audio → Art der Kachel: Playlist**. Titel über *+ Titel hinzufügen …* oder per Drag & Drop aus dem Explorer in die Liste ziehen; Reihenfolge mit ▲▼ ändern. Optionen: **Zufällige Reihenfolge**, unter *Wiedergabe* **Playlist wiederholen**.

Antippen startet die Playlist, erneutes Antippen blendet sie aus. Der aktuelle Titel steht auf der Kachel (♪) und in der Fußzeile. **Nächster Titel**: ⏭ in der Fußzeile oder Kontextmenü der Kachel.

**Hintergrundmusik:** Kachel bearbeiten → **Wiedergabe → Rolle: Hintergrundmusik** (Symbol ▽ auf der Kachel, „BG“ in der Fußzeile). Solche Kacheln

- laufen weiter, wenn ein Jingle startet – sie werden währenddessen automatisch **abgesenkt** (Ducking) und kommen danach sanft zurück,
- werden nur durch eine andere Hintergrundmusik abgelöst (im Modus „Laufenden ausblenden“).

Wie stark und wie schnell abgesenkt wird, stellst du unter *Einstellungen → Wiedergabe → Hintergrundmusik & Ducking* ein (Werkseinstellung 25 % ≈ −12 dB, 500 ms). Typisch: Pausenmusik-Playlist als Hintergrundmusik, Durchsagen-Jingles und Effekte darüber.

## 14. Fernsteuerung: Tastatur, MIDI, Stream Deck, Tablet

**Tastenkürzel pro Kachel:** Kachel bearbeiten → **Steuerung → ⌨ Taste zuweisen** → gewünschte Taste drücken (z. B. `F1`, `Q`, `Num5`, `Strg+Umschalt+A`). Das Kürzel wirkt im Live-Modus in **allen** Reitern und steht klein auf der Kachel. Reserviert sind `Esc`, `F11`, `F12`, `Strg+E`, `Strg+R`, `Strg+1…9`. Wird ein Kürzel neu vergeben, verliert die bisherige Kachel es automatisch.

**MIDI-Controller:** USB-MIDI-Gerät anschließen (Pad-Controller, Keyboard, Launchpad …). Kachel bearbeiten → **Steuerung → ♫ MIDI zuweisen** → Pad/Taste/Regler betätigen. Erkannt werden Noten, Controller (CC, ausgelöst beim Überschreiten der Mitte) und Programmwechsel. Unter *Einstellungen → Fernsteuerung* kannst du außerdem **„Sofort stoppen“** und **„Alles ausblenden“** auf MIDI-Tasten legen. Die Tabelle dort zeigt alle Zuweisungen.

**Elgato Stream Deck:**
- *Einfach:* Aktion **„Hotkey“** (System) auf die Taste legen und das Tastenkürzel der Kachel eintragen. Tipp: `F13`–`F24` gibt es auf keiner normalen Tastatur und kollidieren daher nie.
- *Ohne Tastenkürzel:* HTTP-Schnittstelle einschalten (s. u.) und mit einem Web-Request-Plugin (z. B. „API Ninja“) die Adresse der Kachel aufrufen.

**HTTP-Schnittstelle / Bitfocus Companion:** *Einstellungen → Fernsteuerung → HTTP-Fernsteuerung aktiv* (Port 8765). Die Adresse jeder Kachel steht im Kachel-Dialog unter *Steuerung* (Knopf *Kopieren*).

| Adresse | Wirkung |
|---|---|
| `/api/toggle/<id>` | wie Antippen (Start bzw. Ausblenden) |
| `/api/play/<id>` · `/api/stop/<id>` | nur starten · nur ausblenden |
| `/api/next/<id>` | Playlist: nächster Titel |
| `/api/key/F1` | Kachel mit diesem Tastenkürzel |
| `/api/fade` · `/api/stopall` | alles ausblenden · sofort alles stoppen |
| `/api/tab/2` | zu Reiter 2 wechseln |
| `/api/reset` | alle Zähler zurücksetzen |
| `/api/pause` | Pause / Weiter |
| `/api/tempo/<faktor>` | Tempo setzen, z. B. `/api/tempo/2` oder `/api/tempo/0.5` |
| `/api/fx/<name>/<wert>` | Effekt setzen: `bass`, `treble` (dB), `filter` (−100…100), `hall`, `echo` (0…100) |
| `/api/fxreset` | alle Effekte zurücksetzen |
| `/api/music` | Pausenmusik Start / Pause |
| `/api/musicnext` | Pausenmusik: nächster Titel |
| `/api/musicfade` | Pausenmusik ausblenden |
| `/api/state` | Reiter, Kacheln und laufende Jingles als JSON |

**Tablet/Handy als Fernbedienung:** zusätzlich *Auch im Netzwerk erreichbar* einschalten und auf dem Tablet die angezeigte Adresse (z. B. `http://192.168.1.20:8765/`) im Browser öffnen – dort erscheinen alle Reiter und Kacheln als Buttons. Windows fragt beim ersten Mal ggf. nach einer Firewall-Freigabe. Nur in vertrauenswürdigen Netzwerken verwenden (kein Passwortschutz).

## 14a. Pausenmusik-Player

Für Musik in Satzpausen, Halbzeit, Einlass usw. gibt es einen eigenen **Playlist-Player** – unabhängig von den Kacheln. Öffnen mit **♫** in der Fußzeile (oder `Strg+P`); er erscheint rechts als Seitenleiste. Schließen mit ✕ – die Musik läuft dabei weiter.

- **Titel hinzufügen:** Audiodateien aus dem Explorer auf den Player ziehen oder **+ Titel**. Mit ▲ ▼ die Reihenfolge ändern, ✕ entfernt einen Titel, **🗑 Leeren** die ganze Liste.
- **Abspielen:** ▶ startet (bzw. ❚❚ pausiert), einen Titel in der Liste antippen spielt genau diesen. ⏮ springt an den Titelanfang bzw. zum vorherigen Titel, ⏭ zum nächsten, ■ stoppt sofort. Über den Schieber im grünen Feld kannst du im Titel spulen.
- **▼ Ausblenden** blendet die Pausenmusik sanft aus – die Dauer wählst du daneben (1, 3, 5 oder 10 s). Ideal, wenn das Spiel weitergeht.
- **⤮ Zufall**, **⟳ Endlos** (Liste wiederholen), **▽ Ducking** (unter Jingles automatisch leiser) und eine eigene **Lautstärke**.

Die Pausenmusik läuft über den Master-Ausgang. Jingles verdrängen sie nicht, sondern senken sie nur ab (Ducking, Pegel/Zeit unter Einstellungen → Wiedergabe). Startest du eine Kachel mit der Rolle *Hintergrundmusik*, ersetzt diese die Pausenmusik (und umgekehrt). `Leertaste` (Pause) und `Enter` (Stopp) wirken auch auf die Pausenmusik. Die Titelliste wird gespeichert und ist im Set-Export enthalten.

## 15. Tastenkürzel (Player-Tasten)

Unter **⚙ Einstellungen → Tasten** legst du für jede Player-Aktion bis zu zwei Tasten fest (**Zuweisen/Ändern** → Taste drücken). Eine Taste kann nur einmal vergeben werden – wird sie neu zugewiesen, verschwindet sie automatisch bei der alten Aktion bzw. Kachel. **⟲ Standardbelegung** stellt alles wieder her.

| Standardtaste | Funktion |
|---|---|
| `Enter` (auch Ziffernblock) · `Umschalt+Esc` | **sofort alles stoppen** |
| `Leertaste` | **Pause / Weiter** |
| `Esc` | alles ausblenden (schließt zuerst offene Dialoge/Menüs) |
| `Bild↓` / `Bild↑` | nächster / vorheriger Reiter |
| `Strg+Bild↓` / `Strg+Bild↑` | nächste / vorherige Reiter-Ebene |
| `+` / `−` (auch Ziffernblock) | Tempo eine Stufe schneller / langsamer |
| `Num ×` | Tempo normal (1×) |
| `Strg+F` | Effektleiste ein/aus |
| `Rücktaste` | alle Effekte zurücksetzen |
| `↑` / `↓` | Effektleiste: Regler wählen (nur bei offener Leiste) |
| `←` / `→` (mit `Umschalt` grob) | Effektleiste: gewählten Regler fein verstellen |
| `Entf` | Effektleiste: gewählten Regler zurücksetzen |
| `Strg+P` | Pausenmusik-Player ein/aus |
| `Strg+E` | Bearbeitungsmodus ein/aus |
| – (frei belegbar) | Pausenmusik Start/Pause · nächster Titel · ausblenden · Playlist-Kachel: nächster Titel · Neues Spiel |
| `Strg+1` … `Strg+9`, `Strg+0` | Reiter 1–10 der angezeigten Ebene (fest) |
| `F11` | Vollbild (fest) |
| eigene Kürzel | Kachel auslösen (Kachel-Dialog → Steuerung) |

Player-Tasten haben Vorrang vor den Tastenkürzeln der Kacheln. In Texteingabefeldern und offenen Dialogen sind sie nicht aktiv.

## 15a. Live-Effekte (FX)

Der Knopf **FX** in der Fußzeile öffnet die Effektleiste. Alle Effekte wirken sofort auf alles, was über den **Master** läuft – der Vorhör-Ausgang bleibt unverändert.

| Regler | Wirkung |
|---|---|
| **Tempo** | Geschwindigkeit der laufenden Titel, 0,25× bis 16×. Schnelltasten **1× · 2× · 5× · 10×** (Stufen in den Einstellungen änderbar, z. B. `0,5 1 1,5 2 5 10`). Auch neu gestartete Jingles laufen im eingestellten Tempo, bis du zurückstellst. |
| **Bass** | Tiefen anheben/absenken (−12 … +15 dB) |
| **Höhen** | Höhen anheben/absenken (−12 … +12 dB) |
| **Filter** | nach links dumpf (wie aus dem Nebenraum), nach rechts dünn (wie Telefon/Radio) |
| **Hall** | Raumhall wie in einer großen Halle |
| **Echo** | Wiederholungen (Echo-Zeit in den Einstellungen) |

Der kleine Knopf **⟲** an jedem Effekt (oder Wert antippen bzw. Regler doppelklicken) setzt nur diesen Effekt zurück, **⟲ Alle aus** setzt alle zurück.

**Gefühlvoll per Pfeiltasten:** Einen Regler antippen (oder mit `↑`/`↓` wählen – der gewählte Regler ist blau umrandet), dann mit `←`/`→` in kleinen Schritten verstellen; gedrückt halten fährt den Regler gleichmäßig. Mit `Umschalt` sind die Schritte 5× so groß, `Entf` setzt den gewählten Regler zurück. Die Pfeiltasten wirken nur, solange die Effektleiste geöffnet ist.

**Effekte an einer Kachel speichern:** Jingle starten, Effekte einstellen und **💾 Auf Kachel** tippen – die Werte werden in der laufenden Kachel gespeichert und klingen künftig bei jedem Abspielen mit (die Effektleiste wird danach zurückgesetzt). Alternativ im Kachel-Dialog → **Wiedergabe** → *Klang & Effekte dieser Kachel* die Werte direkt einstellen. Kacheln mit eigenen Effekten zeigen oben rechts ✦. Live-Effekte der Leiste wirken zusätzlich obendrauf. Solange ein Effekt aktiv ist, ist der FX-Knopf orange umrandet. Ein eingebauter Limiter verhindert Übersteuerung (z. B. bei viel Bass).

**Tonhöhe beim Tempo:** Standardmäßig klingt ein schnelleres Tempo wie ein schneller laufendes Band (höher, „Mickymaus“) – das funktioniert bei jedem Tempo. Mit *Tonhöhe beim Beschleunigen halten* bleibt die Tonhöhe gleich (bis 4×, darüber automatisch Band-Modus).

**Einrichten** (⚙ Einstellungen → Effekte): welche Regler in der Leiste erscheinen, Tempo-Stufen, Echo-Zeit, automatisches Zurücksetzen, wenn nichts mehr läuft, und **MIDI-Regler**: jedem Effekt einen Fader oder Drehregler eines MIDI-Controllers zuweisen (*♫ Regler zuweisen* → Regler bewegen).

## 16. Häufige Fragen

**Die Gerätenamen heißen nur „Ausgabegerät 1, 2 …“.** – Windows gibt die Namen erst nach einer Medienfreigabe heraus. EventDJ fragt diese automatisch an; ist kein Mikrofon vorhanden, bleiben die Namen evtl. generisch. Mit **♪ Test** findest du das richtige Gerät.

**Eine Kachel ist grau und zeigt „Datei fehlt“.** – Die Audiodatei wurde verschoben/gelöscht (nur möglich, wenn das Kopieren in die Bibliothek ausgeschaltet war). Kachel bearbeiten → *Datei wählen …* oder neue Datei auf die Kachel ziehen.

**Eine Datei lässt sich nicht abspielen.** – Vermutlich ein nicht unterstützter Codec (z. B. WMA oder ein exotisches M4A). In MP3 oder WAV umwandeln.

**Der MIDI-Controller wird nicht erkannt.** – Gerät vor dem Start von EventDJ anschließen bzw. nach dem Anschließen kurz warten; unter *Einstellungen → Fernsteuerung* steht, welche Geräte verbunden sind. Manche Geräte brauchen einen Windows-Treiber des Herstellers.

**Die Stream-Deck-Hotkeys lösen nichts aus.** – EventDJ muss das aktive Fenster sein (Tastenkürzel gehen an das Fenster im Vordergrund). Unabhängig vom Fokus funktioniert die HTTP-Schnittstelle.

**ASIO?** – EventDJ nutzt die Windows-Audioausgabe (WASAPI, gemeinsamer Modus). ASIO-Treiber werden nicht direkt angesprochen; die meisten Interfaces stellen aber zusätzlich ein normales Windows-Gerät bereit.
