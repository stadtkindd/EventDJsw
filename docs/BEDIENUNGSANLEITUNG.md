# EventDJ – Bedienungsanleitung

## 1. Die Oberfläche

```
┌──────────────────────────────────────────────────────────────────────┐
│ EventDJ │ Reiter 1 │ Reiter 2 │ Reiter 3 │   ↺ Neues Spiel ✎ ⚙ ⛶      │  ← Kopfzeile
├──────────────────────────────────────────────────────────────────────┤
│  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐                         │
│  │3× STIL │ │0×      │ │        │ │        │                         │  ← Kachel-Matrix
│  │ Titel  │ │ Titel  │ │        │ │        │                         │    (Spalten × Zeilen
│  │▶  0:12 │ │▶  0:05 │ │        │ │        │                         │     pro Reiter)
│  └────────┘ └────────┘ └────────┘ └────────┘                         │
├──────────────────────────────────────────────────────────────────────┤
│ ▶ läuft gerade …  −0:08 ■ │ 🔊 Ausgang │ Master ━━━● │ Ausblenden │ STOP │  ← Fußzeile
└──────────────────────────────────────────────────────────────────────┘
```

**Kachel** – oben links der **Zähler** (wie oft gespielt), daneben der Name der **Eigenschaft/Stil**, in der Mitte der **Titel**, unten der **Play-Button** und die **Länge** bzw. während der Wiedergabe die **Restzeit**. Eine laufende Kachel leuchtet weiß und zeigt einen Fortschrittsbalken; ausblendende Kacheln werden etwas blasser. Graue Kacheln mit „Datei fehlt“ verweisen auf eine Audiodatei, die nicht mehr gefunden wird.

**Fußzeile** – alle gerade laufenden Jingles mit Restzeit und eigenem Stopp-Button (ein Tipp = ausblenden, nochmal = sofort aus), die aktuellen Ausgabegeräte, der Master-Lautstärkeregler, **Ausblenden** (alles mit Fade-Out) und **STOP** (sofort alles aus).

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

Rechtsklick auf einen Reiter öffnet ein Schnellmenü. Mit `Strg+1` … `Strg+9` springst du direkt zu einem Reiter. Ein grüner Punkt am Reiter zeigt, dass dort gerade etwas läuft.

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

## 11. Tastenkürzel

| Taste | Funktion |
|---|---|
| `Esc` | alles ausblenden (bzw. Dialog/Menü schließen) |
| `Umschalt+Esc` | sofort alles stoppen |
| `Strg+1` … `Strg+9` | Reiter 1–9 |
| `Strg+E` | Bearbeitungsmodus ein/aus |
| `F11` | Vollbild |

## 12. Häufige Fragen

**Die Gerätenamen heißen nur „Ausgabegerät 1, 2 …“.** – Windows gibt die Namen erst nach einer Medienfreigabe heraus. EventDJ fragt diese automatisch an; ist kein Mikrofon vorhanden, bleiben die Namen evtl. generisch. Mit **♪ Test** findest du das richtige Gerät.

**Eine Kachel ist grau und zeigt „Datei fehlt“.** – Die Audiodatei wurde verschoben/gelöscht (nur möglich, wenn das Kopieren in die Bibliothek ausgeschaltet war). Kachel bearbeiten → *Datei wählen …* oder neue Datei auf die Kachel ziehen.

**Eine Datei lässt sich nicht abspielen.** – Vermutlich ein nicht unterstützter Codec (z. B. WMA oder ein exotisches M4A). In MP3 oder WAV umwandeln.

**ASIO?** – EventDJ nutzt die Windows-Audioausgabe (WASAPI, gemeinsamer Modus). ASIO-Treiber werden nicht direkt angesprochen; die meisten Interfaces stellen aber zusätzlich ein normales Windows-Gerät bereit.
