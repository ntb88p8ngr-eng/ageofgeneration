# Age of Generation — Reich der Zeitalter

Echtzeit-Strategie im Browser, im Geist von *Age of Empires II*: vom Dorf in der
Dunklen Zeit bis zur Imperialzeit, auf jedes Mal neu gewuerfelten Karten, allein
gegen den Rechner oder zu acht ueber das Netz — mit Zuschauern und Aufzeichnungen.

Geschrieben in reinem JavaScript. Keine npm-Abhaengigkeiten, kein Uebersetzungs-
schritt, kein Bilder- oder Tonarchiv: Landschaft, Gebaeude, Einheiten und
Geraeusche werden zur Laufzeit gerechnet. Mitgeliefert wird einzig three.js
(MIT, unveraendert, unter `js/vendor/`).

```
node server.js        →  http://localhost:3000
```

Node ab Version 18. Ohne Server laeuft nichts — die Seite besteht aus ES-Modulen,
die der Browser nur ueber `http://` laedt, nicht ueber `file://`.

---

## Was drin ist

| | |
|---|---|
| **Zeitalter** | Dunkle Zeit, Feudalzeit, Ritterzeit, Imperialzeit |
| **Voelker** | Franken, Briten, Byzantiner, Mongolen — je drei Boni und eine Spezialeinheit |
| **Gebaeude** | 16, vom Haus ueber Muehle, Kaserne, Stall, Belagerungswerkstatt, Markt, Kloster, Universitaet bis zu Burg, Turm, Mauer und Tor |
| **Einheiten** | 15, vom Dorfbewohner ueber Speertraeger, Bogenschuetze, Ritter, Moench, Ramme, Mangonel und Trebuchet bis zu den vier Spezialeinheiten |
| **Technologien** | 18: Schubkarre, Handkarre, Pflug, Waffen- und Ruestungsstufen, Ballistik, Mauerwerk, Wehrturm, Glaubenseifer … |
| **Rohstoffe** | Nahrung, Holz, Gold, Stein — samt Markt mit schwankenden Preisen |
| **Karten** | Ebene, Seenplatte, Hochland, Waelder in vier Groessen, aus einer Saat erzeugt |
| **Spielarten** | Einzelspiel gegen bis zu sieben Rechnergegner (drei Schwierigkeitsgrade), Mehrspieler mit Teams, Zuschauermodus, Aufzeichnung und Wiedergabe |

## Steuerung

Wie im Vorbild, erweitert um die freie Kamera.

**Kamera**

| Taste | Wirkung |
|---|---|
| `W A S D`, Pfeiltasten, Bildschirmrand | Karte schieben |
| Mausrad | zoomen |
| `Q` `E` oder `Alt`+Ziehen | drehen |
| `R` `F` | kippen |
| mittlere Maustaste | Karte ziehen |
| Klick auf die Minikarte | dorthin springen |

**Auswahl**

| Taste | Wirkung |
|---|---|
| linke Taste | auswaehlen; Ziehen zieht ein Rechteck |
| Doppelklick | alle sichtbaren Einheiten derselben Art |
| `Umschalt`+Klick | zur Auswahl hinzufuegen |
| `Strg`+`1`…`9` | Kontrollgruppe merken, Zahl ruft sie ab, zweimal springt hin |
| `H` | Dorfzentrum · `.` naechster untaetiger Dorfbewohner · `Leertaste` letztes Ereignis |

**Befehle** (rechte Maustaste, je nach Ziel)

| Ziel | Wirkung |
|---|---|
| Boden | hingehen |
| Feind | angreifen |
| Wald, Erz, Wild, Beeren | sammeln |
| eigene Baustelle | mitbauen |
| beschaedigtes Gebaeude | reparieren |
| Farm | bestellen |
| mit gewaehltem Gebaeude | Sammelpunkt setzen |

`Umschalt` haengt einen Befehl an, `S` haelt an, `Entf` reisst ab.

**Bauen und Ausbilden** — mit gewaehlten Dorfbewohnern oeffnet jeder Buchstabe
direkt den passenden Bau: `Q` Haus, `W` Muehle, `F` Farm, `R` Lager, `A` Kaserne,
`S` Schuetzenstand, `D` Stall, `G` Belagerungswerkstatt, `M` Markt, `N` Kloster,
`U` Universitaet, `C` Burg, `T` Turm, `Z` Mauer, `X` Tor, `E` Dorfzentrum.
Mauern lassen sich mit gedrueckter Maustaste in einer Reihe ziehen. Ist ein
Gebaeude gewaehlt, bildet die Anfangstaste der Einheit sie aus — mit `Umschalt`
gleich fuenf auf einmal.

Zuschauer wechseln mit `Tab` die Sicht von Spieler zu Spieler.

---

## Wie es gebaut ist

```
server.js      Server: Dateien ausliefern und Partien vermitteln
partien.js     Warteraum, Rundenrelais, Aufzeichnungen (Server)
index.html     Startbildschirm und Spieloberflaeche
css/spiel.css  Gestaltung
js/
  regeln.js    alle Zahlen des Spiels an einer Stelle
  zufall.js    eigener Zufallsgenerator, ganzzahlige Mathematik
  karte.js     Kartengenerator aus einer Saat
  pfad.js      A* auf dem Kachelgitter
  sim.js       die Simulation: Einheiten, Bauten, Wirtschaft, Kampf
  ki.js        der Rechner als Gegner
  welt.js      Darstellung mit three.js
  modelle.js   Gebaeude und Einheiten aus Kaesten und Kegeln
  kamera.js    freie Feldherrnkamera
  steuerung.js Maus und Tastatur
  hud.js       Leisten, Knoepfe, Minikarte
  netz.js      Langabfrage zum Server
  klang.js     gerechnete Geraeusche
  spiel.js     haelt alles zusammen
test/          node --test test/*.test.js
```

### Warum die Simulation nur ganze Zahlen kennt

Im Mehrspieler wird **kein Spielstand uebertragen**, sondern nur, was die Spieler
befehlen. Der Server sammelt diese Befehle und veroeffentlicht sie fuenfmal je
Sekunde als „Runde“; jeder Rechner rechnet daraus dieselbe Welt. Das ist das
Verfahren des Vorbilds und der Grund, warum auch achthundert Einheiten ueber eine
schmale Leitung passen.

Damit das aufgeht, muss jeder Rechner *auf die Ziffer genau* dasselbe ausrechnen.
Deshalb:

* Positionen und Geschwindigkeiten stehen in Fixpunkt (1 Kachel = 1024),
* der Zufall kommt aus einem eigenen Generator mit ganzzahligem Zustand,
* keine Winkelfunktionen und kein `Math.random` in der Simulation,
* alles wird in fester Reihenfolge durchlaufen, nie „irgendein“ Nachbar zuerst,
* auch die KI ist Teil der Simulation und wird nicht uebertragen.

Zur Sicherheit schickt jeder Rechner alle hundert Runden eine Pruefsumme; weichen
sie ab, meldet der Server es. Die Aufzeichnung einer Partie ist deshalb winzig:
Startaufbau plus Befehlsliste, mehr braucht die Wiedergabe nicht.

### Der Nebel des Krieges

Jeder Spieler fuehrt zwei Felder: was er je gesehen hat und was er gerade sieht.
Unerkundetes Land wird schwarz gezeichnet, erkundetes aber unbeobachtetes
gedaempft; fremde Einheiten verschwinden dort, fremde Gebaeude bleiben als
Erinnerung stehen. Verbuendete teilen ihre Sicht.

---

## Betrieb

```
PORT=8080 node server.js          # anderer Port
HOST=127.0.0.1 node server.js     # nur oertlich
BASE_PATH=/spiel node server.js   # hinter einem Proxy in einem Unterpfad
```

Aufzeichnungen liegen unter `daten/replays/` (die achtzig neuesten bleiben
erhalten). Der Ordner `daten/` wird nie ausgeliefert.

## Tests

```
node --test test/*.test.js
```

43 Tests: Zufall und Wurzel, Kartenerzeugung samt Erreichbarkeit aller
Startplaetze, Wegsuche, Volksboni, Aufstellung, Ernte, Bau, Ausbildung,
Bevoelkerungsgrenze, Kampf mit Bonusschaden, Zeitalteraufstieg, Sicht,
Siegbedingung, Markt, Rechteschutz (niemand befiehlt fremde Einheiten) sowie
Warteraum, Rundenrelais, Zuschauerrechte und Aufzeichnungen des Servers.
Dazu die Rueckkehr an die Arbeit nach getanem Bau.
Dazu die wichtigste Probe: zwei Simulationen mit denselben Befehlen ergeben
ueber neunhundert Runden dieselbe Pruefsumme. Gegengeprueft wurde ausserdem
ueber die Laufzeitgrenze hinweg — dieselbe Aufzeichnung, einmal in Node und
einmal in Chromium gerechnet, ergibt Zeichen fuer Zeichen dieselbe
Pruefsumme. Genau davon lebt der Mehrspieler.

## Grenzen

* Kein Wasserkrieg: es gibt keine Schiffe und keinen Hafen, Wasser ist Hindernis.
* Einheiten koennen sich nicht in Gebaeude zurueckziehen.
* Die KI spielt eine ordentliche, aber gemaechliche Wirtschaft: Feudalzeit
  nach etwa vierzehn Minuten, die Ritterzeit erreicht sie nur auf guten
  Karten. Sie schickt Angriffswellen, belagert aber nicht planvoll und
  baut keine Mauern. Gegen einen geuebten Menschen verliert sie.
* Handel gibt es nur ueber den Markt, nicht mit Handelskarren zwischen Spielern.
