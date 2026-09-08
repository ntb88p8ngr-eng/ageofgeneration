/* ═══════════════════════════════════════════════════════════
   REICH DER ZEITALTER — Regeln und Werte

   Hier stehen alle Zahlen des Spiels an einem Ort: Rohstoffe,
   Zeitalter, Voelker, Gebaeude, Einheiten und Technologien.
   Simulation, Oberflaeche und Server lesen dieselbe Datei —
   damit koennen die Werte nicht auseinanderlaufen.

   Wichtig: Die Simulation rechnet ausschliesslich mit ganzen
   Zahlen (Fixpunkt), sonst ergaeben zwei Rechner bei gleichem
   Spielverlauf verschiedene Ergebnisse. Die Werte unten sind
   bequem in Kacheln und Sekunden geschrieben und werden beim
   Laden einmal in Fixpunkt umgerechnet.
   ═══════════════════════════════════════════════════════════ */
'use strict';

/* ─────────────── Grundmasse ─────────────── */

/** Fixpunkt: so viele Einheiten hat eine Kachel. */
export const FP = 1024;
/** Laenge eines Simulationsschrittes in Millisekunden. */
export const TAKT_MS = 100;
/** Schritte je Sekunde. */
export const TAKTE_PRO_S = 1000 / TAKT_MS;
/** So viele Schritte fasst eine Netzwerkrunde zusammen. */
export const RUNDE_TAKTE = 2;
/** So viele Runden im Voraus werden Befehle eingeplant. */
export const RUNDEN_VORLAUF = 2;

/** Kacheln je Sekunde → Fixpunkt je Schritt. */
export function tempoFP(kachelnProSekunde) {
  return Math.round(kachelnProSekunde * FP / TAKTE_PRO_S);
}
/** Sekunden → Schritte. */
export function takte(sekunden) {
  return Math.max(1, Math.round(sekunden * TAKTE_PRO_S));
}

export const ROHSTOFFE = ['nahrung', 'holz', 'gold', 'stein'];
export const ROHSTOFF_NAME = {
  nahrung: 'Nahrung', holz: 'Holz', gold: 'Gold', stein: 'Stein'
};

/* ─────────────── Zeitalter ───────────────
   Der Aufstieg kostet Rohstoffe, dauert und verlangt eine
   Mindestzahl an Gebaeuden aus dem laufenden Zeitalter. */

export const ZEITALTER = [
  { id: 0, name: 'Dunkle Zeit',  kurz: 'Dunkel',   kosten: null,                              dauer: 0,   braucht: 0 },
  { id: 1, name: 'Feudalzeit',   kurz: 'Feudal',   kosten: { nahrung: 500 },                  dauer: 130, braucht: 2 },
  { id: 2, name: 'Ritterzeit',   kurz: 'Ritter',   kosten: { nahrung: 800, gold: 200 },       dauer: 160, braucht: 2 },
  { id: 3, name: 'Imperialzeit', kurz: 'Imperial', kosten: { nahrung: 1000, gold: 800 },      dauer: 190, braucht: 2 }
];

/* ─────────────── Voelker ───────────────
   Jedes Volk hat einen Bonus, eine Spezialeinheit aus der Burg
   und eine eigene Farbgebung fuer die Gebaeudedaecher. */

export const VOELKER = {
  franken: {
    id: 'franken', name: 'Franken',
    beschreibung: 'Ritter mit dickerem Fell, billige Burgen. Wer frueh reitet, gewinnt frueh.',
    spezial: 'wurfaxt',
    boni: [
      { text: 'Berittene Einheiten haben +20 % Trefferpunkte', art: 'einheitHP', klasse: 'reiter', faktor: 120 },
      { text: 'Burgen kosten 25 % weniger Stein',              art: 'kosten', bau: 'burg', rohstoff: 'stein', faktor: 75 },
      { text: 'Farmen kosten 15 Holz weniger',                 art: 'kostenAbzug', bau: 'farm', rohstoff: 'holz', wert: 15 }
    ],
    dach: 0x8d3b2f
  },
  briten: {
    id: 'briten', name: 'Briten',
    beschreibung: 'Bogenschuetzen mit langem Arm und billigen Schuetzenstaenden.',
    spezial: 'langbogen',
    boni: [
      { text: 'Bogenschuetzen haben +1 Reichweite ab der Ritterzeit', art: 'reichweite', klasse: 'schuetze', abZeitalter: 2, wert: 1 },
      { text: 'Schuetzenstaende bauen 20 % schneller',               art: 'bautempo', bau: 'schuetzenstand', faktor: 120 },
      { text: 'Schafe und Beeren geben 15 % mehr Nahrung',           art: 'ertrag', rohstoff: 'nahrung', faktor: 115 }
    ],
    dach: 0x3f5f8f
  },
  byzantiner: {
    id: 'byzantiner', name: 'Byzantiner',
    beschreibung: 'Mauern, Tuerme und Gebaeude aus einem anderen Holz. Wer haelt, gewinnt spaet.',
    spezial: 'kataphrakt',
    boni: [
      { text: 'Gebaeude haben +20 % Trefferpunkte',   art: 'gebaeudeHP', faktor: 120 },
      { text: 'Speertraeger und Plaenkler kosten 25 % weniger', art: 'kostenKlasse', einheiten: ['speer', 'plaenkler'], faktor: 75 },
      { text: 'Zeitalteraufstieg kostet 10 % weniger', art: 'aufstieg', faktor: 90 }
    ],
    dach: 0x6b4f9a
  },
  mongolen: {
    id: 'mongolen', name: 'Mongolen',
    beschreibung: 'Schnelle Reiter, schnelle Jagd, kurzer Prozess.',
    spezial: 'mangudai',
    boni: [
      { text: 'Berittene Einheiten sind 15 % schneller', art: 'tempo', klasse: 'reiter', faktor: 115 },
      { text: 'Jaeger sammeln 40 % schneller',           art: 'sammeltempo', quelle: 'wild', faktor: 140 },
      { text: 'Spaeher haben +2 Sicht',                  art: 'sicht', einheiten: ['spaeher'], wert: 2 }
    ],
    dach: 0x9a7d3a
  }
};

export const VOLK_LISTE = Object.keys(VOELKER);

/* ─────────────── Spielerfarben ─────────────── */

export const FARBEN = [
  { id: 0, name: 'Blau',   hex: 0x2f6fd0 },
  { id: 1, name: 'Rot',    hex: 0xc93030 },
  { id: 2, name: 'Gruen',  hex: 0x2f9c48 },
  { id: 3, name: 'Gelb',   hex: 0xd8b031 },
  { id: 4, name: 'Tuerkis',hex: 0x27a8a8 },
  { id: 5, name: 'Lila',   hex: 0x8a49b8 },
  { id: 6, name: 'Grau',   hex: 0x9aa0a6 },
  { id: 7, name: 'Orange', hex: 0xdd7722 },
  { id: 8, name: 'Rosa',   hex: 0xd4589a }
];

/* ─────────────── Kachelarten ─────────────── */

export const BODEN = {
  gras: 0, wiese: 1, sand: 2, fels: 3, wasser: 4, acker: 5, strasse: 6
};
export const BODEN_BEGEHBAR = [true, true, true, true, false, true, true];

/* Rohstoffvorkommen auf dem Gitter. */
export const VORKOMMEN = {
  baum:   { id: 'baum',   rohstoff: 'holz',    menge: 100, name: 'Baum' },
  beere:  { id: 'beere',  rohstoff: 'nahrung', menge: 125, name: 'Beerenstrauch' },
  wild:   { id: 'wild',   rohstoff: 'nahrung', menge: 140, name: 'Wild' },
  schaf:  { id: 'schaf',  rohstoff: 'nahrung', menge: 100, name: 'Schaf' },
  gold:   { id: 'gold',   rohstoff: 'gold',    menge: 800, name: 'Goldader' },
  stein:  { id: 'stein',  rohstoff: 'stein',   menge: 350, name: 'Steinbruch' },
  fisch:  { id: 'fisch',  rohstoff: 'nahrung', menge: 250, name: 'Fischgrund', wasser: true }
};

/** Wieviel ein Dorfbewohner je Sekunde von einer Quelle holt. */
export const SAMMELTEMPO = {
  baum: 0.39, beere: 0.31, wild: 0.41, schaf: 0.33, gold: 0.38, stein: 0.36, acker: 0.37,
  fisch: 0.43
};
/* Ein Fischerboot traegt mehr als ein Dorfbewohner — der Weg zum
   Hafen ist schliesslich laenger. */
export const TRAGKRAFT_BOOT = 15;
/** So viel traegt ein Dorfbewohner, bevor er abliefert. */
export const TRAGKRAFT = 10;

/* ─────────────── Gebaeude ───────────────
   groesse   Kantenlaenge in Kacheln (immer quadratisch)
   abgabe    welche Rohstoffe hier abgeliefert werden koennen
   bev       wieviel Bevoelkerungsraum das Gebaeude schafft
   waffe     Verteidigungsanlagen schiessen selbst
*/

export const GEBAEUDE = {
  dorfzentrum: {
    id: 'dorfzentrum', name: 'Dorfzentrum', taste: 'E',
    kosten: { holz: 275, stein: 100 }, bauzeit: 150, groesse: 4, hp: 2400,
    ruestung: { nah: 3, fern: 5 }, sicht: 8, zeitalter: 0, bev: 5,
    abgabe: ['nahrung', 'holz', 'gold', 'stein'],
    produziert: ['dorfbewohner'], forscht: ['schubkarre', 'handkarre'],
    waffe: { schaden: 5, reichweite: 6, tempo: 2.0, art: 'fern', braucht: 'einheit' },
    beschreibung: 'Herz der Siedlung: bildet Dorfbewohner aus, nimmt alle Rohstoffe an und laeutet das naechste Zeitalter ein.'
  },
  haus: {
    id: 'haus', name: 'Haus', taste: 'Q',
    kosten: { holz: 25 }, bauzeit: 25, groesse: 2, hp: 550,
    ruestung: { nah: 0, fern: 5 }, sicht: 4, zeitalter: 0, bev: 5,
    beschreibung: 'Platz fuer fuenf weitere Untertanen.'
  },
  muehle: {
    id: 'muehle', name: 'Muehle', taste: 'W',
    kosten: { holz: 100 }, bauzeit: 35, groesse: 2, hp: 600,
    ruestung: { nah: 0, fern: 5 }, sicht: 6, zeitalter: 0,
    abgabe: ['nahrung'], forscht: ['pflug'],
    beschreibung: 'Nimmt Nahrung an. Farmen werden in ihrer Naehe am besten angelegt.'
  },
  farm: {
    id: 'farm', name: 'Farm', taste: 'F',
    kosten: { holz: 60 }, bauzeit: 15, groesse: 3, hp: 480,
    ruestung: { nah: 0, fern: 5 }, sicht: 2, zeitalter: 0, braucht: 'muehle',
    vorrat: 250, acker: true,
    beschreibung: 'Verlaesslichste Nahrungsquelle. Traegt 250 Nahrung, danach neu bestellen.'
  },
  lager: {
    id: 'lager', name: 'Lager', taste: 'R',
    kosten: { holz: 100 }, bauzeit: 35, groesse: 2, hp: 600,
    ruestung: { nah: 0, fern: 5 }, sicht: 6, zeitalter: 0,
    abgabe: ['holz', 'gold', 'stein'],
    beschreibung: 'Nimmt Holz, Gold und Stein an. Gehoert an den Wald oder an die Mine.'
  },
  kaserne: {
    id: 'kaserne', name: 'Kaserne', taste: 'A',
    kosten: { holz: 175 }, bauzeit: 50, groesse: 3, hp: 1200,
    ruestung: { nah: 0, fern: 7 }, sicht: 6, zeitalter: 0,
    produziert: ['milizionaer', 'speer'], forscht: ['manatarme', 'langschwert', 'pike'],
    beschreibung: 'Bildet Fussvolk aus.'
  },
  schuetzenstand: {
    id: 'schuetzenstand', name: 'Schuetzenstand', taste: 'S',
    kosten: { holz: 175 }, bauzeit: 50, groesse: 3, hp: 1200,
    ruestung: { nah: 0, fern: 7 }, sicht: 6, zeitalter: 1, braucht: 'kaserne',
    produziert: ['bogen', 'plaenkler'], forscht: ['armbrust', 'elitplaenkler'],
    beschreibung: 'Bildet Schuetzen aus.'
  },
  stall: {
    id: 'stall', name: 'Stall', taste: 'D',
    kosten: { holz: 175 }, bauzeit: 50, groesse: 3, hp: 1200,
    ruestung: { nah: 0, fern: 7 }, sicht: 6, zeitalter: 1, braucht: 'kaserne',
    produziert: ['spaeher', 'ritter'], forscht: ['kreuzritter'],
    beschreibung: 'Bildet Reiterei aus.'
  },
  belagerung: {
    id: 'belagerung', name: 'Belagerungswerkstatt', taste: 'G',
    kosten: { holz: 200 }, bauzeit: 60, groesse: 3, hp: 1200,
    ruestung: { nah: 0, fern: 7 }, sicht: 6, zeitalter: 2, braucht: 'lager',
    produziert: ['ramme', 'mangonel'],
    beschreibung: 'Baut schweres Geraet gegen Mauern und Menschenmengen.'
  },
  markt: {
    id: 'markt', name: 'Markt', taste: 'M',
    kosten: { holz: 175 }, bauzeit: 60, groesse: 3, hp: 1800,
    ruestung: { nah: 0, fern: 7 }, sicht: 6, zeitalter: 1, braucht: 'muehle',
    handel: true,
    beschreibung: 'Kauft und verkauft Rohstoffe gegen Gold. Die Preise bewegen sich mit dem Handel.'
  },
  kloster: {
    id: 'kloster', name: 'Kloster', taste: 'N',
    kosten: { holz: 175 }, bauzeit: 40, groesse: 3, hp: 2100,
    ruestung: { nah: 0, fern: 7 }, sicht: 8, zeitalter: 2,
    produziert: ['moench'], forscht: ['glaube', 'inbrunst'],
    beschreibung: 'Bildet Moenche aus, die heilen und Feinde bekehren.'
  },
  universitaet: {
    id: 'universitaet', name: 'Universitaet', taste: 'U',
    kosten: { holz: 200 }, bauzeit: 60, groesse: 3, hp: 1800,
    ruestung: { nah: 1, fern: 7 }, sicht: 6, zeitalter: 2,
    forscht: ['schmiede1', 'schmiede2', 'ruestung1', 'ruestung2', 'ballistik', 'mauerwerk', 'wehrturm'],
    beschreibung: 'Erforscht bessere Waffen, dickere Ruestungen und staerkere Mauern.'
  },
  burg: {
    id: 'burg', name: 'Burg', taste: 'C',
    kosten: { stein: 650 }, bauzeit: 200, groesse: 4, hp: 4800,
    ruestung: { nah: 8, fern: 11 }, sicht: 10, zeitalter: 2, bev: 20,
    produziert: ['spezial', 'trebuchet'],
    waffe: { schaden: 11, reichweite: 8, tempo: 2.0, art: 'fern' },
    beschreibung: 'Schwerster Bau des Spiels: schiesst von selbst, gibt Bevoelkerungsraum und bildet die Spezialeinheit des Volkes aus.'
  },
  turm: {
    id: 'turm', name: 'Wachturm', taste: 'T',
    kosten: { stein: 125, holz: 50 }, bauzeit: 80, groesse: 1, hp: 850,
    ruestung: { nah: 1, fern: 7 }, sicht: 9, zeitalter: 1,
    waffe: { schaden: 6, reichweite: 7, tempo: 2.0, art: 'fern' },
    beschreibung: 'Wachposten mit Bogenschuetzen darin.'
  },
  mauer: {
    id: 'mauer', name: 'Mauer', taste: 'Z',
    kosten: { stein: 5 }, bauzeit: 7, groesse: 1, hp: 900,
    ruestung: { nah: 8, fern: 10 }, sicht: 2, zeitalter: 1, kette: true,
    beschreibung: 'Haelt auf, was nicht klettern kann. Mit gedrueckter Maustaste in Reihe ziehen.'
  },
  bruecke: {
    id: 'bruecke', name: 'Bruecke', taste: 'B',
    kosten: { holz: 40 }, bauzeit: 14, groesse: 1, hp: 800,
    ruestung: { nah: 3, fern: 6 }, sicht: 3, zeitalter: 0, kette: true,
    aufWasser: true, begehbar: true,
    beschreibung: 'Ueberquert Wasser. Nur auf Wasserfeldern zu bauen, die an Land oder an eine andere Bruecke grenzen. Mit gedrueckter Maustaste in Reihe ziehen.'
  },
  hafen: {
    id: 'hafen', name: 'Hafen', taste: 'H',
    kosten: { holz: 150 }, bauzeit: 45, groesse: 3, hp: 1400,
    ruestung: { nah: 0, fern: 7 }, sicht: 8, zeitalter: 0, amUfer: true,
    abgabe: ['nahrung', 'holz', 'gold', 'stein'],
    produziert: ['fischerboot', 'transporter', 'galeere'],
    beschreibung: 'Muss ans Ufer. Baut Schiffe, nimmt den Fang der Fischerboote an und liefert Rohstoffe wie ein Lager.'
  },
  tor: {
    id: 'tor', name: 'Tor', taste: 'X',
    kosten: { stein: 30 }, bauzeit: 30, groesse: 1, hp: 1300,
    ruestung: { nah: 8, fern: 10 }, sicht: 4, zeitalter: 1, durchlass: true,
    beschreibung: 'Laesst die eigenen Leute durch, die fremden nicht.'
  }
};

export const GEBAEUDE_LISTE = Object.keys(GEBAEUDE);

/* ─────────────── Einheiten ───────────────
   klasse    fuer Boni und Konter: dorf, fussvolk, schuetze, reiter, belagerung, moench
   angriff   art 'nah' oder 'fern'; bei 'fern' zaehlt flugzeit
   bonus     Zusatzschaden gegen Klassen oder gegen Gebaeude
*/

export const EINHEITEN = {
  dorfbewohner: {
    id: 'dorfbewohner', name: 'Dorfbewohner', taste: 'Q', klasse: 'dorf',
    kosten: { nahrung: 50 }, zeit: 25, hp: 25, bev: 1, tempo: 0.8, sicht: 4,
    angriff: { art: 'nah', schaden: 3, reichweite: 0.4, tempo: 2.0 },
    ruestung: { nah: 0, fern: 0 }, zeitalter: 0, kannBauen: true, kannSammeln: true,
    beschreibung: 'Faellt, graebt, jagt, baut. Ohne ihn steht nichts.'
  },
  spaeher: {
    id: 'spaeher', name: 'Spaeherkavallerie', taste: 'W', klasse: 'reiter',
    kosten: { nahrung: 80 }, zeit: 30, hp: 45, bev: 1, tempo: 1.55, sicht: 8,
    angriff: { art: 'nah', schaden: 3, reichweite: 0.5, tempo: 2.0 },
    ruestung: { nah: 0, fern: 2 }, zeitalter: 0, bonus: { moench: 6 },
    beschreibung: 'Augen des Reiches. Schnell, billig, gegen Moenche gefaehrlich.'
  },
  milizionaer: {
    id: 'milizionaer', name: 'Milizionaer', taste: 'A', klasse: 'fussvolk',
    kosten: { nahrung: 60, gold: 20 }, zeit: 21, hp: 40, bev: 1, tempo: 0.9, sicht: 4,
    angriff: { art: 'nah', schaden: 4, reichweite: 0.4, tempo: 2.0 },
    ruestung: { nah: 0, fern: 1 }, zeitalter: 0,
    stufen: ['manatarme', 'langschwert'],
    beschreibung: 'Erstes Fussvolk. Wird mit den Zeitaltern zum Schwertkaempfer.'
  },
  speer: {
    id: 'speer', name: 'Speertraeger', taste: 'S', klasse: 'fussvolk',
    kosten: { nahrung: 35, holz: 25 }, zeit: 22, hp: 45, bev: 1, tempo: 1.0, sicht: 4,
    angriff: { art: 'nah', schaden: 3, reichweite: 0.5, tempo: 3.0 },
    ruestung: { nah: 0, fern: 0 }, zeitalter: 1, bonus: { reiter: 15, belagerung: 8 },
    stufen: ['pike'],
    beschreibung: 'Billige Antwort auf Reiterei.'
  },
  bogen: {
    id: 'bogen', name: 'Bogenschuetze', taste: 'D', klasse: 'schuetze',
    kosten: { holz: 25, gold: 45 }, zeit: 35, hp: 30, bev: 1, tempo: 0.96, sicht: 6,
    angriff: { art: 'fern', schaden: 4, reichweite: 4, tempo: 2.0, flugzeit: 0.35 },
    ruestung: { nah: 0, fern: 0 }, zeitalter: 1,
    stufen: ['armbrust'],
    beschreibung: 'Schiesst aus vier Kacheln Entfernung. Weich, aber zahlreich gefaehrlich.'
  },
  plaenkler: {
    id: 'plaenkler', name: 'Plaenkler', taste: 'F', klasse: 'schuetze',
    kosten: { nahrung: 25, holz: 35 }, zeit: 22, hp: 30, bev: 1, tempo: 0.96, sicht: 6,
    angriff: { art: 'fern', schaden: 2, reichweite: 4, tempo: 3.0, flugzeit: 0.35 },
    ruestung: { nah: 0, fern: 3 }, zeitalter: 1, bonus: { schuetze: 3 },
    stufen: ['elitplaenkler'],
    beschreibung: 'Wurfspeere gegen fremde Schuetzen. Braucht kein Gold.'
  },
  ritter: {
    id: 'ritter', name: 'Ritter', taste: 'R', klasse: 'reiter',
    kosten: { nahrung: 60, gold: 75 }, zeit: 30, hp: 100, bev: 1, tempo: 1.35, sicht: 5,
    angriff: { art: 'nah', schaden: 10, reichweite: 0.5, tempo: 1.8 },
    ruestung: { nah: 2, fern: 2 }, zeitalter: 2,
    stufen: ['kreuzritter'],
    beschreibung: 'Gepanzerte Faust. Teuer, schnell, schwer aufzuhalten.'
  },
  moench: {
    id: 'moench', name: 'Moench', taste: 'C', klasse: 'moench',
    kosten: { gold: 100 }, zeit: 51, hp: 30, bev: 1, tempo: 0.7, sicht: 9,
    angriff: null, ruestung: { nah: 0, fern: 0 }, zeitalter: 2,
    heilt: { rate: 6, reichweite: 4 }, bekehrt: { reichweite: 4, dauer: 8, ruhe: 12 },
    beschreibung: 'Heilt eigene Verwundete und redet fremden Soldaten ins Gewissen.'
  },
  ramme: {
    id: 'ramme', name: 'Ramme', taste: 'V', klasse: 'belagerung',
    kosten: { holz: 160, gold: 75 }, zeit: 36, hp: 175, bev: 1, tempo: 0.5, sicht: 3,
    angriff: { art: 'nah', schaden: 2, reichweite: 0.6, tempo: 5.0 },
    ruestung: { nah: 0, fern: 180 }, zeitalter: 2, bonus: { gebaeude: 125 },
    beschreibung: 'Pfeile prallen ab, Mauern nicht. Gegen Gebaeude gebaut.'
  },
  mangonel: {
    id: 'mangonel', name: 'Mangonel', taste: 'B', klasse: 'belagerung',
    kosten: { holz: 160, gold: 135 }, zeit: 46, hp: 50, bev: 1, tempo: 0.6, sicht: 9,
    angriff: { art: 'fern', schaden: 40, reichweite: 7, tempo: 6.0, flugzeit: 1.0, flaeche: 1.2 },
    ruestung: { nah: 0, fern: 6 }, zeitalter: 2, bonus: { gebaeude: 25 },
    beschreibung: 'Wirft Steine in die Menge — auch in die eigene. Vorsicht beim Zielen.'
  },
  trebuchet: {
    id: 'trebuchet', name: 'Trebuchet', taste: 'N', klasse: 'belagerung',
    kosten: { holz: 200, gold: 200 }, zeit: 50, hp: 150, bev: 1, tempo: 0.4, sicht: 12,
    angriff: { art: 'fern', schaden: 50, reichweite: 12, tempo: 10.0, flugzeit: 1.8, flaeche: 0.8 },
    ruestung: { nah: 1, fern: 150 }, zeitalter: 3, bonus: { gebaeude: 200 },
    beschreibung: 'Reisst Burgen aus zwoelf Kacheln Entfernung nieder. Langsam wie ein Amtsweg.'
  },
  /* ── Schiffe ──
     Sie fahren nur auf Wasser, brauchen einen Hafen und koennen
     nicht an Land. Der Transporter traegt Landeinheiten ueber
     Fluesse und Meerengen. */
  fischerboot: {
    id: 'fischerboot', name: 'Fischerboot', taste: 'F', klasse: 'schiff', wasser: true,
    kosten: { holz: 75 }, zeit: 40, hp: 60, bev: 1, tempo: 1.1, sicht: 5,
    angriff: null, ruestung: { nah: 0, fern: 4 }, zeitalter: 0, kannSammeln: true, nurFisch: true,
    beschreibung: 'Faengt Fisch und bringt ihn in den Hafen. Traegt mehr als ein Dorfbewohner.'
  },
  transporter: {
    id: 'transporter', name: 'Transportschiff', taste: 'T', klasse: 'schiff', wasser: true,
    kosten: { holz: 125 }, zeit: 45, hp: 150, bev: 1, tempo: 1.45, sicht: 5,
    angriff: null, ruestung: { nah: 0, fern: 6 }, zeitalter: 0, plaetze: 8,
    beschreibung: 'Nimmt bis zu acht Landeinheiten auf. Rechtsklick auf das Schiff laedt ein, Rechtsklick ans Ufer laedt aus.'
  },
  galeere: {
    id: 'galeere', name: 'Galeere', taste: 'G', klasse: 'schiff', wasser: true,
    kosten: { holz: 90, gold: 30 }, zeit: 60, hp: 130, bev: 1, tempo: 1.43, sicht: 7,
    angriff: { art: 'fern', schaden: 6, reichweite: 5, tempo: 3.0, flugzeit: 0.4 },
    ruestung: { nah: 0, fern: 6 }, zeitalter: 1, bonus: { schiff: 4 },
    beschreibung: 'Kriegsschiff. Beherrscht das Wasser und beschiesst auch das Ufer.'
  },

  /* ── Spezialeinheiten aus der Burg ── */
  wurfaxt: {
    id: 'wurfaxt', name: 'Wurfaxtwerfer', taste: 'Y', klasse: 'fussvolk', volk: 'franken',
    kosten: { nahrung: 55, gold: 25 }, zeit: 17, hp: 60, bev: 1, tempo: 0.9, sicht: 5,
    angriff: { art: 'fern', schaden: 7, reichweite: 3, tempo: 2.0, flugzeit: 0.3 },
    ruestung: { nah: 0, fern: 1 }, zeitalter: 2,
    beschreibung: 'Fraenkische Spezialeinheit: Fussvolk, das aus drei Kacheln zuschlaegt.'
  },
  langbogen: {
    id: 'langbogen', name: 'Langbogenschuetze', taste: 'Y', klasse: 'schuetze', volk: 'briten',
    kosten: { holz: 35, gold: 40 }, zeit: 18, hp: 35, bev: 1, tempo: 0.96, sicht: 7,
    angriff: { art: 'fern', schaden: 6, reichweite: 6, tempo: 2.0, flugzeit: 0.4 },
    ruestung: { nah: 0, fern: 0 }, zeitalter: 2,
    beschreibung: 'Britische Spezialeinheit: schiesst weiter als alles andere zu Fuss.'
  },
  kataphrakt: {
    id: 'kataphrakt', name: 'Kataphrakt', taste: 'Y', klasse: 'reiter', volk: 'byzantiner',
    kosten: { nahrung: 70, gold: 75 }, zeit: 20, hp: 110, bev: 1, tempo: 1.35, sicht: 4,
    angriff: { art: 'nah', schaden: 9, reichweite: 0.5, tempo: 1.7 },
    ruestung: { nah: 2, fern: 1 }, zeitalter: 2, bonus: { fussvolk: 9 },
    beschreibung: 'Byzantinische Spezialeinheit: Reiter, die Fussvolk zermahlen.'
  },
  mangudai: {
    id: 'mangudai', name: 'Mangudai', taste: 'Y', klasse: 'reiter', volk: 'mongolen',
    kosten: { gold: 65, holz: 55 }, zeit: 26, hp: 60, bev: 1, tempo: 1.4, sicht: 6,
    angriff: { art: 'fern', schaden: 6, reichweite: 4, tempo: 2.1, flugzeit: 0.3 },
    ruestung: { nah: 0, fern: 1 }, zeitalter: 2, bonus: { belagerung: 8 },
    beschreibung: 'Mongolische Spezialeinheit: berittener Schuetze, der im Reiten trifft.'
  }
};

export const EINHEIT_LISTE = Object.keys(EINHEITEN);

/** Welche Spezialeinheit baut welches Volk? */
export function spezialEinheit(volk) {
  const v = VOELKER[volk];
  return v ? v.spezial : 'wurfaxt';
}

/* ─────────────── Technologien ─────────────── */

export const TECHS = {
  schubkarre:   { id: 'schubkarre',   name: 'Schubkarre',      kosten: { nahrung: 175, holz: 50 },  zeit: 75,  zeitalter: 1, wirkung: { dorfTempo: 110, tragkraft: 3 },
                  beschreibung: 'Dorfbewohner laufen schneller und tragen mehr.' },
  handkarre:    { id: 'handkarre',    name: 'Handkarre',       kosten: { nahrung: 300, holz: 200 }, zeit: 100, zeitalter: 2, braucht: 'schubkarre', wirkung: { dorfTempo: 110, tragkraft: 5 },
                  beschreibung: 'Noch schneller, noch mehr auf der Schulter.' },
  pflug:        { id: 'pflug',        name: 'Schwerer Pflug',  kosten: { nahrung: 125, holz: 75 },  zeit: 70,  zeitalter: 2, wirkung: { ackerVorrat: 175, sammelNahrung: 115 },
                  beschreibung: 'Farmen tragen mehr und werden schneller abgeerntet.' },
  manatarme:    { id: 'manatarme',    name: 'Bewaffneter Mann',kosten: { nahrung: 100, gold: 40 },  zeit: 40,  zeitalter: 1, wirkung: { stufe: 'milizionaer' },
                  beschreibung: 'Milizionaere werden zu bewaffneten Maennern (+6 TP, +2 Schaden).' },
  langschwert:  { id: 'langschwert',  name: 'Langschwert',     kosten: { nahrung: 200, gold: 65 },  zeit: 45,  zeitalter: 2, braucht: 'manatarme', wirkung: { stufe: 'milizionaer' },
                  beschreibung: 'Aus bewaffneten Maennern werden Langschwertkaempfer.' },
  pike:         { id: 'pike',         name: 'Pikenier',        kosten: { nahrung: 215, holz: 90 },  zeit: 45,  zeitalter: 2, wirkung: { stufe: 'speer' },
                  beschreibung: 'Speertraeger werden zu Pikenieren.' },
  armbrust:     { id: 'armbrust',     name: 'Armbrust',        kosten: { nahrung: 125, gold: 75 },  zeit: 50,  zeitalter: 2, wirkung: { stufe: 'bogen' },
                  beschreibung: 'Bogenschuetzen legen die Armbrust an.' },
  elitplaenkler:{ id: 'elitplaenkler',name: 'Elite-Plaenkler', kosten: { nahrung: 230, gold: 100 }, zeit: 50,  zeitalter: 2, wirkung: { stufe: 'plaenkler' },
                  beschreibung: 'Plaenkler werfen weiter und haerter.' },
  kreuzritter:  { id: 'kreuzritter',  name: 'Kreuzritter',     kosten: { nahrung: 300, gold: 300 }, zeit: 90,  zeitalter: 3, wirkung: { stufe: 'ritter' },
                  beschreibung: 'Ritter werden zu Kreuzrittern.' },
  schmiede1:    { id: 'schmiede1',    name: 'Geschmiedetes Schwert', kosten: { nahrung: 100 },      zeit: 50, zeitalter: 1, wirkung: { angriff: 1 },
                  beschreibung: '+1 Schaden fuer alle Kaempfer.' },
  schmiede2:    { id: 'schmiede2',    name: 'Eisenguss',       kosten: { nahrung: 220, gold: 120 }, zeit: 70,  zeitalter: 2, braucht: 'schmiede1', wirkung: { angriff: 1 },
                  beschreibung: 'Noch einmal +1 Schaden fuer alle Kaempfer.' },
  ruestung1:    { id: 'ruestung1',    name: 'Lederpanzer',     kosten: { nahrung: 100 },            zeit: 50,  zeitalter: 1, wirkung: { ruestung: 1 },
                  beschreibung: '+1 Nah- und Fernruestung fuer alle Einheiten.' },
  ruestung2:    { id: 'ruestung2',    name: 'Kettenpanzer',    kosten: { nahrung: 200, gold: 100 }, zeit: 70,  zeitalter: 2, braucht: 'ruestung1', wirkung: { ruestung: 1 },
                  beschreibung: 'Noch einmal +1 Ruestung fuer alle Einheiten.' },
  ballistik:    { id: 'ballistik',    name: 'Ballistik',       kosten: { holz: 300, gold: 175 },    zeit: 60,  zeitalter: 2, wirkung: { treffsicher: true },
                  beschreibung: 'Geschosse treffen auch laufende Ziele.' },
  mauerwerk:    { id: 'mauerwerk',    name: 'Mauerwerk',       kosten: { holz: 150, stein: 150 },   zeit: 70,  zeitalter: 2, wirkung: { gebaeudeHP: 120 },
                  beschreibung: 'Alle Gebaeude bekommen 20 % mehr Trefferpunkte.' },
  wehrturm:     { id: 'wehrturm',     name: 'Wehrturm',        kosten: { nahrung: 200, stein: 100 },zeit: 70,  zeitalter: 2, wirkung: { turmSchaden: 3, turmReichweite: 1 },
                  beschreibung: 'Tuerme schiessen weiter und haerter.' },
  glaube:       { id: 'glaube',       name: 'Glaubenseifer',   kosten: { gold: 120, nahrung: 80 },  zeit: 60,  zeitalter: 2, wirkung: { moenchTempo: 130 },
                  beschreibung: 'Moenche erholen sich schneller vom Bekehren.' },
  inbrunst:     { id: 'inbrunst',     name: 'Inbrunst',        kosten: { gold: 140 },               zeit: 50,  zeitalter: 2, wirkung: { moenchHP: 130, heilRate: 130 },
                  beschreibung: 'Moenche halten mehr aus und heilen schneller.' }
};

export const TECH_LISTE = Object.keys(TECHS);

/* Was eine Ausbaustufe an den Grundwerten aendert. */
export const STUFEN_WIRKUNG = {
  manatarme:     { einheit: 'milizionaer', name: 'Bewaffneter Mann',   hp: 6,  schaden: 2 },
  langschwert:   { einheit: 'milizionaer', name: 'Langschwertkaempfer',hp: 15, schaden: 3, ruestungNah: 1 },
  pike:          { einheit: 'speer',       name: 'Pikenier',           hp: 10, schaden: 1, bonus: { reiter: 7 } },
  armbrust:      { einheit: 'bogen',       name: 'Armbrustschuetze',   hp: 5,  schaden: 1, reichweite: 1 },
  elitplaenkler: { einheit: 'plaenkler',   name: 'Elite-Plaenkler',    hp: 5,  schaden: 1, reichweite: 1 },
  kreuzritter:   { einheit: 'ritter',      name: 'Kreuzritter',        hp: 20, schaden: 2, ruestungNah: 1 }
};

/* ─────────────── Handel ─────────────── */
export const HANDEL = {
  startpreis: 100,      // Gold fuer 100 Einheiten eines Rohstoffs
  schritt: 3,           // so stark bewegt sich der Preis je Geschaeft
  minpreis: 20, maxpreis: 900,
  gebuehr: 30           // Prozent, die beim Verkaufen einbehalten werden
};

/* ─────────────── Sieg und Niederlage ─────────────── */
export const SIEG = {
  /* Ein Spieler ist besiegt, wenn er weder Dorfbewohner noch
     Gebaeude hat, aus denen wieder welche kommen koennten. */
  aufgabeMoeglich: true
};

/* ─────────────── Hilfen ─────────────── */

/** Kosten eines Bauwerks/einer Einheit fuer ein Volk (Boni eingerechnet). */
export function kosten(art, id, volk) {
  const def = art === 'gebaeude' ? GEBAEUDE[id] : EINHEITEN[id];
  if (!def) return null;
  const out = {};
  for (const r of ROHSTOFFE) if (def.kosten[r]) out[r] = def.kosten[r];
  const v = VOELKER[volk];
  if (!v) return out;
  for (const b of v.boni) {
    if (b.art === 'kosten' && art === 'gebaeude' && b.bau === id && out[b.rohstoff]) {
      out[b.rohstoff] = Math.round(out[b.rohstoff] * b.faktor / 100);
    }
    if (b.art === 'kostenAbzug' && art === 'gebaeude' && b.bau === id && out[b.rohstoff]) {
      out[b.rohstoff] = Math.max(0, out[b.rohstoff] - b.wert);
    }
    if (b.art === 'kostenKlasse' && art === 'einheit' && b.einheiten.indexOf(id) >= 0) {
      for (const r of ROHSTOFFE) if (out[r]) out[r] = Math.round(out[r] * b.faktor / 100);
    }
  }
  return out;
}

/** Kosten des naechsten Zeitalters. */
export function aufstiegKosten(zeitalter, volk) {
  const z = ZEITALTER[zeitalter + 1];
  if (!z) return null;
  const out = Object.assign({}, z.kosten);
  const v = VOELKER[volk];
  if (v) for (const b of v.boni) {
    if (b.art === 'aufstieg') for (const r of ROHSTOFFE) if (out[r]) out[r] = Math.round(out[r] * b.faktor / 100);
  }
  return out;
}

/** Kurzer Text „50 Nahrung, 25 Holz“. */
export function kostenText(k) {
  if (!k) return '';
  return ROHSTOFFE.filter(r => k[r]).map(r => k[r] + ' ' + ROHSTOFF_NAME[r]).join(', ');
}

/** Alles, was ein Gebaeude bauen/forschen kann — nach Zeitalter gefiltert. */
export function bauplan(zeitalter) {
  return GEBAEUDE_LISTE.filter(id => GEBAEUDE[id].zeitalter <= zeitalter);
}
