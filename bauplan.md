# Form3D-Bauplan – Anleitung für KI-Systeme

Du entwirfst ein 3D-Modell für **Form3D**, eine CAD-App für den 3D-Druck
(https://tn3d-objekte.github.io/form3d/). Du lieferst einen **Bauplan**: ein JSON-Objekt, das Schritt für Schritt
beschreibt, wie das Modell entsteht. Der Benutzer fügt ihn in Form3D ein (Menü → „Bauplan einfügen (KI)“), und die
App baut echte Volumenkörper daraus. Rundungen, Fasen und Schraubenlöcher sind danach in der App bearbeitbar.

## Vorgehen: erst fragen, dann bauen

Das Teil soll zu den Wünschen des Benutzers passen und **ohne Nacharbeit druckbar** sein. Stelle deshalb vor dem
ersten Bauplan **3–6 kurze Rückfragen** – noch ohne Bauplan. Frage nur, was die Beschreibung offen lässt.

**Rückfragen zum Antippen**: Der Benutzer arbeitet oft am Handy. Gib zu jeder Frage **2–4 fertige Antworten** vor,
die er nur antippen muss – die sinnvollste zuerst, als „(empfohlen)“ markiert. Freie Eingabe muss immer möglich
bleiben, falls nichts passt.

- **Hat deine Oberfläche ein Werkzeug für Auswahlfragen** (anklickbare Antwortknöpfe, Mehrfachauswahl,
  Formular o. Ä.), **benutze es** – eine Frage pro Auswahlfeld, mit Textfeld für eigene Angaben.
- **Sonst** schreibe die Fragen so, dass man kurz antworten kann: Fragen nummeriert, Antworten mit Buchstaben,
  und am Ende der Hinweis „Antworte z. B. mit *1A 2B 3C* – oder schreib einfach, was du anders willst.“

Beispiel ohne Auswahl-Werkzeug:

> **1. Kanten-Stil?** A) gerundet, weich (empfohlen) · B) gefast, technisch · C) gemischt: oben rund, unten Fase
>
> **2. Material?** A) PLA (empfohlen) · B) PETG – zäher, wärmefester · C) ASA – für draußen
>
> **3. Wandstärke?** A) 2 mm (empfohlen) · B) 3 mm – stabiler · C) 1,6 mm – leichter
>
> Antworte z. B. mit *1A 2B 3A* – oder schreib einfach, was du anders willst.

Typische Fragen (nur stellen, was offen ist; Antworten passend zum Teil vorschlagen):

1. **Zweck und Einbau**: Woran wird es befestigt (Schrauben, Kleben, Klemmen, Magnet), was muss hineinpassen?
2. **Hauptmaße**: Vorschläge für Außenmaße bzw. Größe (klein / mittel / groß mit Zahlen), Lochabstände.
3. **Kanten-Stil**: gerundet (weich, griffig) · gefast (technisch, druckt ohne Stützen) · gemischt; dazu die Stärke
   (0,5 / 1 / 2 mm).
4. **Material und Belastung**: PLA · PETG · ASA/ABS · TPU; muss es Gewicht, Wärme oder Sonne aushalten?
5. **Mehrteilig**: einteilig · mit Deckel (geschraubt / gesteckt / Schnapphaken) · mit Clip oder Scharnier.
6. **Sichtseite**: Welche Seite ist später zu sehen oder anzufassen?

Danach baust du nach den Antworten. Sagt der Benutzer „ohne Rückfragen“ oder hat er alles Wichtige schon genannt,
baue direkt und nenne vor dem Bauplan kurz deine Annahmen (Maße, Kanten-Stil, Druckausrichtung).

## Antwortformat

- Wenn du den Bauplan lieferst: **genau ein JSON-Codeblock** mit dem vollständigen Bauplan. Kurze Erklärungen davor
  oder danach sind erlaubt (Annahmen, Druckhinweise, wie die Teile zusammengehören).
- Gültiges JSON: doppelte Anführungszeichen, keine Kommentare, keine abschließenden Kommas, Zahlen mit Punkt (2.5).
- Maße in **Millimetern**, Winkel in **Grad**.

```json
{
  "format": "form3d-bauplan/1",
  "name": "Name des Modells",
  "schritte": [ { "op": "…" }, { "op": "…" } ]
}
```

## Koordinatensystem

- **z zeigt nach oben**, die Druckplatte ist die Ebene z = 0. Baue Teile so, dass sie auf z = 0 stehen.
- x nach rechts, y nach hinten. Richtungsnamen: `oben` +z, `unten` −z, `rechts` +x, `links` −x, `hinten` +y, `vorne` −y.
- Jeder Grundkörper entsteht in seinem eigenen System mit dem **Boden-Mittelpunkt im Ursprung**
  (Ausnahmen: `kugel` sitzt mit dem **Mittelpunkt** im Ursprung, `profil` siehe unten), wird dann um x, y, z gedreht (`drehen`) und an `pos` verschoben.

## Körper und Kombinieren

Jeder Formschritt (`quader`, `zylinder`, `kugel`, `kegel`, `profil`, `drehkoerper`) hat einen `modus`:

| modus | Wirkung |
|---|---|
| `"neu"` (Standard) | legt einen neuen Körper an; `"name"` vergeben (eindeutig) |
| `"vereinigen"` | fügt die Form an den Körper `"ziel"` an |
| `"abziehen"` | zieht die Form vom Körper `"ziel"` ab (Löcher, Taschen, Nuten) |
| `"schnitt"` | behält nur den gemeinsamen Teil von Körper `"ziel"` und Form |

Gemeinsame Felder aller Formschritte:

- `"pos": [x, y, z]` – Verschiebung (Standard `[0, 0, 0]`)
- `"drehen": [rx, ry, rz]` – Drehung in Grad um x, dann y, dann z, vor dem Verschieben
- `"raster": { "anzahl": [nx, ny], "abstand": [dx, dy] }` – Kopien in x und y, **mittig um `pos` verteilt**
  (z. B. 4 Bohrungen: `"anzahl": [2, 2], "abstand": [60, 30]` → bei x = ±30, y = ±15)
- `"farbe"` – nur bei `"neu"`: `grau`, `rot`, `orange`, `gruen`, `blau`, `violett`, `weiss`, `dunkel`

## Formschritte

### quader
`{ "op": "quader", "l": 80, "b": 50, "h": 10 }` – Länge l in x, Breite b in y, Höhe h in z; Boden mittig im Ursprung
(reicht von x = −l/2 … l/2, y = −b/2 … b/2, z = 0 … h).

### zylinder
`{ "op": "zylinder", "d": 20, "h": 30 }` – Durchmesser d, Höhe h, Achse z, Boden-Mitte im Ursprung.

### kegel
`{ "op": "kegel", "d1": 20, "d2": 10, "h": 15 }` – unten Durchmesser d1, oben d2 (0 = Spitze).

### kugel
`{ "op": "kugel", "d": 20 }` – Mittelpunkt im Ursprung.

### profil (2D-Form extrudieren)
```json
{ "op": "profil", "name": "Platte", "form": { "rechteck": [80, 50], "r": 6 },
  "loecher": [ { "kreis": 10, "mitte": [0, 0] } ], "hoehe": 8, "ebene": "xy" }
```
- `form`: eine Form oder eine Liste von Formen (getrennte Flächen); `loecher`: Formen, die ausgespart werden.
- `hoehe`: Extrusionslänge entlang der Ebenen-Normale.
- `ebene`: `"xy"` (Standard; Form in x/y, extrudiert nach +z), `"xz"` (Form in x/z, extrudiert nach −y),
  `"yz"` (Form in y/z, extrudiert nach +x). Danach wirken `drehen` und `pos`.

**Formen** (2D, in mm; `mitte` Standard `[0, 0]`, `winkel` in Grad dreht um die Mitte):
- `{ "rechteck": [breite, tiefe], "mitte": [x, y], "r": 3, "winkel": 0 }` – r = Eckenradius (optional)
- `{ "kreis": 12, "mitte": [x, y] }` – **Durchmesser** 12
- `{ "langloch": [laenge, breite], "mitte": [x, y], "winkel": 0 }` – Gesamtlänge und Breite
- `{ "polygon": [[x1, y1], [x2, y2], [x3, y3], …] }` – Eckpunkte der Reihe nach

### drehkoerper
`{ "op": "drehkoerper", "profil": [[0, 0], [15, 0], [15, 3], [8, 20], [0, 20]] }` – Punkte [r, z] (r ≥ 0),
dreht 360° um die z-Achse. Gut für Knöpfe, Füße, Flaschen, Zapfen.

## Rundung und Fase

```json
{ "op": "rundung", "ziel": "Platte", "r": 2, "kanten": { "flaeche": "oben", "ganz_oben": true } }
{ "op": "fase",    "ziel": "Platte", "groesse": 0.6, "kanten": { "ganz_unten": true, "art": "aussen" } }
```
Außenkanten werden abgerundet (Material weg), Innenkanten ausgerundet (Material dazu).
**`kanten`** wählt Kanten des Zielkörpers: `"alle"`, ein Filter-Objekt (alle Bedingungen müssen gelten) oder eine
Liste von Filter-Objekten (eine davon muss gelten). Filter:

| Filter | Bedeutung |
|---|---|
| `"flaeche": "oben"` | Kante grenzt an eine Fläche mit dieser Richtung (`oben`, `unten`, `vorne`, `hinten`, `links`, `rechts`) |
| `"z": 8` (ebenso `"x"`, `"y"`) | Kante liegt ganz auf dieser Koordinate (±0,05 mm) |
| `"ganz_oben": true` / `"ganz_unten": true` | Kante liegt auf der höchsten bzw. tiefsten Höhe des Körpers |
| `"parallel": "z"` | gerade Kante parallel zur Achse (z. B. senkrechte Gehäuseecken) |
| `"art": "aussen"` / `"innen"` | nach außen stehende Kante bzw. Innenecke/Kehle |
| `"rund": true` / `false` | gekrümmte Kante (Kreis, Bogen) bzw. gerade Kante |
| `"nahe": [x, y, z], "abstand": 1` | Kante verläuft näher als `abstand` (Standard 1) am Punkt |
| `"bereich": { "min": [x,y,z], "max": [x,y,z] }` | Kante liegt ganz in diesem Quader |

Tangential anschließende Kanten laufen automatisch mit (z. B. gerade Kante + Eckenbogen eines abgerundeten
Rechtecks). Der Bericht meldet, wie viele Kanten ein Filter getroffen hat.

## Druckteile (Normteile, mit Druckspiel)

```json
{ "op": "schraubenloch", "ziel": "Platte", "m": "M3", "kopf": "senk", "halt": "kern", "laenge": 12,
  "punkte": [[-30, -15, 8], [30, -15, 8]], "richtung": [0, 0, 1] }
```
- `punkt` (oder `punkte` für mehrere): Punkt **auf der Oberfläche**; `richtung`: Normale dieser Fläche nach außen
  (Standard `[0, 0, 1]` = Fläche zeigt nach oben, gebohrt wird nach unten).
- `m`: `M2`, `M2.5`, `M3`, `M4`, `M5`, `M6`, `M8`, `M10`, `M12`.
- **schraubenloch**: `kopf` `senk` (Senkkopf, Standard) | `zylinder` (Zylinderkopf, angesenkt) | `ohne`;
  `halt` `kern` (Kernloch, Schraube schneidet ins Plastik, Standard) | `durch` (Durchgangsloch);
  `laenge` = Schraubenlänge (Standard 12).
- **mutternfalle**: Sechskant-Tasche für die Mutter plus Durchgangsloch, `tiefe` (Standard 10).
- **gewinde**: `art` `innen` (Innengewinde, Standard) | `bolzen` (Gewindebolzen wird angefügt), `laenge` (Standard 10).

## Weitere Schritte

- `{ "op": "verschieben", "ziel": "Deckel", "pos": [0, 0, 30], "drehen": [180, 0, 0] }` – Körper bewegen/drehen
  (um den Ursprung).
- `{ "op": "loeschen", "ziel": "Hilfskoerper" }` – Körper entfernen (z. B. Hilfskörper nach einem Schnitt).

## Druckgerecht konstruieren (wichtig)

Jeder Körper im Bauplan wird **genau so gedruckt, wie er liegt**. Der Bauplan zeigt also die **Druckplatte**, nicht das
zusammengebaute Produkt.

- **Jeder Körper liegt auf z = 0** – mit einer großen, ebenen Fläche. Nichts schwebt, nichts liegt auf einem anderen
  Körper.
- **Mehrere Teile nebeneinander** auf die Platte legen, mindestens **5 mm Abstand**, jedes in seiner besten
  Drucklage (Deckel z. B. umgedreht, Sichtseite nach unten). Teile **nie** in Einbaulage übereinander- oder
  ineinanderstapeln. Wie sie zusammengehören, erklärst du in Worten.
- **Ein Körper = ein zusammenhängendes Stück**: Angesetzte Formen müssen das Grundteil überlappen (mind. 0,5 mm),
  nicht nur berühren. Alles wächst von unten nach oben – keine Inseln, die in der Luft beginnen.
- **Überhänge höchstens 45°**. Nach unten zeigende Kanten mit einer **45°-Fase** statt einer Rundung brechen.
  Waagerechte Decken (Brücken) ohne Stütze höchstens ~15 mm frei spannen. Bohrungen möglichst senkrecht (Achse z);
  waagerechte Bohrungen über 6 mm vermeiden oder als Langloch/Raute mit spitzer Oberseite ausführen.
- **Wände** ≥ 1,2 mm (besser 2 mm bei tragenden Teilen), **Stege und Zapfen** ≥ 2 mm, **Passungen** mit 0,15–0,3 mm
  Spiel je Seite.
- Lange, dünne Teile flach legen, nicht hochkant – das ist stabiler (Schichten quer zur Last).

## Kanten gestalten

Ein gutes Druckteil hat **keine scharfen Kanten**. Breche alle Kanten, je nach Wunsch des Benutzers:

| Wo | Standard | Warum |
|---|---|---|
| Unterkante auf der Platte (`ganz_unten`, `art: aussen`) | **Fase 0,4–0,6 mm** | gegen Elefantenfuß; Rundung unten wäre Überhang |
| Senkrechte Außenecken | Rundung r 1–3 mm (am besten schon im `profil` mit `"r"`) | griffig, weniger Verzug |
| Oberkanten und alles, was man anfasst (`ganz_oben`, Ränder, Griffe) | **Rundung r 0,8–2 mm** oder Fase 0,8–1,5 mm | angenehm in der Hand, keine Kratzer |
| Innenecken unter Last (`art: innen`) | Ausrundung r 1–3 mm | weniger Bruch an der Kerbe |
| Kanten von Löchern für Stifte/Schrauben | Fase 0,3–0,5 mm | leichteres Einführen |

Mag der Benutzer es technisch/kantig, nimm überall Fasen; mag er es weich, Rundungen (unten trotzdem Fase).

## Regeln für gute Ergebnisse

1. **Erst die Form, dann die Kanten**: alle Körper vereinigen/abziehen, **Rundungen und Fasen zuletzt**.
   Ein späteres Vereinigen/Abziehen kann Rundungen anschneiden.
2. Werkzeuge zum **Abziehen** etwas länger machen als das Material (z. B. Loch durch 8 mm Platte: `h` 10,
   `pos` z = −1), damit keine hauchdünne Haut stehen bleibt.
3. Rundungsradius kleiner als die halbe Wandstärke und kleiner als die angrenzenden Flächen; sonst meldet die App
   „Radius zu groß“. Die Meldung nennt dann Punkte der Kanten, an denen es scheitert: Nimm diese Kanten mit einem
   engeren Filter (`bereich`, `nahe`, `art`) aus oder runde sie in einem eigenen Schritt mit kleinerem Radius.
4. Für den 3D-Druck: siehe **Druckgerecht konstruieren** und **Kanten gestalten** – prüfe den fertigen Bauplan
   gegen beide Abschnitte, bevor du ihn ausgibst.
5. Namen von Körpern genau wiederverwenden (Groß-/Kleinschreibung zählt).
6. Gibt dir der Benutzer einen **Bauplan-Bericht** zurück, korrigiere die Schritte mit `"ok": false` anhand von
   `"fehler"`, behebe alle `"druckhinweise"` (schwebende oder gestapelte Körper, Überhang, ungebrochene Kanten) und
   liefere den ganzen Bauplan neu.

## Beispiel: Flansch mit Nabe

```json
{
  "format": "form3d-bauplan/1",
  "name": "Flansch mit Nabe",
  "schritte": [
    { "op": "profil", "name": "Flansch", "form": { "rechteck": [80, 50], "r": 6 }, "hoehe": 8 },
    { "op": "zylinder", "d": 30, "h": 18, "pos": [0, 0, 8], "ziel": "Flansch", "modus": "vereinigen" },
    { "op": "zylinder", "d": 16, "h": 40, "pos": [0, 0, -5], "ziel": "Flansch", "modus": "abziehen" },
    { "op": "schraubenloch", "ziel": "Flansch", "m": "M4", "kopf": "senk", "halt": "durch", "laenge": 10,
      "punkte": [[-30, -15, 8], [30, -15, 8], [-30, 15, 8], [30, 15, 8]] },
    { "op": "rundung", "ziel": "Flansch", "r": 3, "kanten": { "z": 8, "art": "innen" } },
    { "op": "rundung", "ziel": "Flansch", "r": 1, "kanten": { "z": 26, "rund": true } },
    { "op": "fase", "ziel": "Flansch", "groesse": 0.6, "kanten": { "ganz_unten": true, "art": "aussen", "rund": false } }
  ]
}
```

## Beispiel: Gehäuse mit Deckel

```json
{
  "format": "form3d-bauplan/1",
  "name": "Kleines Gehäuse",
  "schritte": [
    { "op": "profil", "name": "Gehäuse", "form": { "rechteck": [60, 40], "r": 4 }, "hoehe": 25 },
    { "op": "profil", "form": { "rechteck": [56, 36], "r": 2 }, "hoehe": 30, "pos": [0, 0, 2], "ziel": "Gehäuse", "modus": "abziehen" },
    { "op": "zylinder", "d": 6, "h": 21, "pos": [0, 0, 2], "raster": { "anzahl": [2, 2], "abstand": [48, 28] }, "ziel": "Gehäuse", "modus": "vereinigen" },
    { "op": "schraubenloch", "ziel": "Gehäuse", "m": "M2.5", "kopf": "ohne", "halt": "kern", "laenge": 8,
      "punkte": [[-24, -14, 23], [24, -14, 23], [-24, 14, 23], [24, 14, 23]] },
    { "op": "profil", "ebene": "xz", "form": { "langloch": [14, 6], "mitte": [0, 14] }, "hoehe": 6, "pos": [0, -17, 0], "ziel": "Gehäuse", "modus": "abziehen" },
    { "op": "fase", "ziel": "Gehäuse", "groesse": 0.5, "kanten": { "ganz_unten": true, "art": "aussen" } },
    { "op": "rundung", "ziel": "Gehäuse", "r": 0.8, "kanten": { "ganz_oben": true } },

    { "op": "profil", "name": "Deckel", "form": { "rechteck": [60, 40], "r": 4 }, "hoehe": 2, "pos": [0, 50, 0], "farbe": "blau" },
    { "op": "profil", "form": { "rechteck": [55.6, 35.6], "r": 1.8 }, "hoehe": 2, "pos": [0, 50, 2], "ziel": "Deckel", "modus": "vereinigen" },
    { "op": "schraubenloch", "ziel": "Deckel", "m": "M2.5", "kopf": "senk", "halt": "durch", "laenge": 6,
      "punkte": [[-24, 36, 0], [24, 36, 0], [-24, 64, 0], [24, 64, 0]], "richtung": [0, 0, -1] },
    { "op": "fase", "ziel": "Deckel", "groesse": 0.4, "kanten": { "ganz_unten": true, "art": "aussen", "rund": false } },
    { "op": "fase", "ziel": "Deckel", "groesse": 0.4, "kanten": { "ganz_oben": true, "art": "aussen" } }
  ]
}
```
Der Deckel liegt flach und 10 mm neben dem Gehäuse (Druckausrichtung, Außenseite unten); sein Rand greift 2 mm in das Gehäuse,
die Senklöcher kommen von unten (`"richtung": [0, 0, -1]` = Fläche zeigt nach unten).
