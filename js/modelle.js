/* ═══════════════════════════════════════════════════════════
   AGE OF GENERATION — Modelle

   Alle Gebaeude, Einheiten, Baeume und Vorkommen werden hier aus
   Grundkoerpern zusammengesetzt: Kaesten, Zylinder, Kegel, Kugeln.
   Kein einziges fremdes Modell, keine Texturen — das haelt das
   Spiel klein und macht es unabhaengig von Bilddateien.

   Jedes Modell zerfaellt in zwei Teile:
     koerper  — wird in der Spielerfarbe eingefaerbt
     neutral  — Holz, Stein, Haut, Metall in eigener Farbe

   Beide Teile werden getrennt als InstancedMesh gezeichnet, damit
   auch bei tausend Einheiten nur eine Handvoll Zeichenaufrufe
   noetig sind. Deshalb lohnt sich der Aufwand im Einzelmodell:
   Ein Dorfzentrum aus vierzig Teilen kostet nicht mehr Aufrufe
   als eines aus vieren.
   ═══════════════════════════════════════════════════════════ */
'use strict';

import * as THREE from './vendor/three.module.js';
import { GEBAEUDE, VOELKER } from './regeln.js';

/* Farben der neutralen Teile. */
export const FARBE = {
  holz:        0x7c5230,
  holzHell:    0xa8794a,
  holzDunkel:  0x4e3320,
  balken:      0x5a3b23,
  stein:       0x9c9c94,
  steinHell:   0xb5b5ac,
  steinDunkel: 0x6f6f68,
  putz:        0xe4dcc6,
  putzGrau:    0xcfc7b2,
  stroh:       0xc8a24a,
  strohDunkel: 0xa8842f,
  ziegel:      0xa14a35,
  metall:      0xb9bec6,
  eisen:       0x7e858e,
  haut:        0xd8ab86,
  hautDunkel:  0xb98c68,
  leder:       0x6e4b2c,
  stoff:       0xe8e3d4,
  gruen:       0x4c7a34,
  dunkel:      0x2f2f2d,
  gold:        0xd9b44a,
  fenster:     0x2a2620,
  wasser:      0x2f6d8c,
  schiefer:    0x5c6670,
  kupfer:      0x4f8f7d,
  schindel:    0x6b533a,
  ziegelHell:  0xb4573c
};

/* ─────────────── Baukasten ───────────────
   Sammelt Dreiecke in zwei Toepfen. Alle Masse in Kacheln. */

class Bau {
  constructor() {
    this.koerper = [];   // Spielerfarbe
    this.neutral = [];   // eigene Farbe
  }

  _lege(geo, farbe, x, y, z, drehX, drehY, drehZ) {
    /* Nur indizierte Geometrien aufloesen — sonst warnt three.js. */
    const g = geo.index ? geo.toNonIndexed() : geo;
    const m = new THREE.Matrix4();
    m.makeRotationFromEuler(new THREE.Euler(drehX || 0, drehY || 0, drehZ || 0));
    m.setPosition(x, y, z);
    g.applyMatrix4(m);
    if (farbe == null) this.koerper.push(g);
    else {
      const c = new THREE.Color(farbe);
      const n = g.attributes.position.count;
      const farben = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { farben[i * 3] = c.r; farben[i * 3 + 1] = c.g; farben[i * 3 + 2] = c.b; }
      g.setAttribute('color', new THREE.BufferAttribute(farben, 3));
      this.neutral.push(g);
    }
    return this;
  }

  kasten(x, y, z, bx, by, bz, farbe, drehY, drehX, drehZ) {
    return this._lege(new THREE.BoxGeometry(bx, by, bz), farbe, x, y, z, drehX, drehY, drehZ);
  }
  /** Duenne Platte — fuer Daecher, Bretter, Schilde. */
  platte(x, y, z, bx, bz, farbe, drehY, drehX, drehZ) {
    return this._lege(new THREE.BoxGeometry(bx, 0.05, bz), farbe, x, y, z, drehX, drehY, drehZ);
  }
  zylinder(x, y, z, rOben, rUnten, h, seiten, farbe, drehX, drehZ, drehY) {
    return this._lege(new THREE.CylinderGeometry(rOben, rUnten, h, seiten || 8), farbe, x, y, z, drehX, drehY, drehZ);
  }
  kegel(x, y, z, r, h, seiten, farbe, drehX, drehZ) {
    return this._lege(new THREE.ConeGeometry(r, h, seiten || 6), farbe, x, y, z, drehX, 0, drehZ);
  }
  kugel(x, y, z, r, farbe, seiten) {
    return this._lege(new THREE.SphereGeometry(r, seiten || 8, (seiten || 8) >> 1), farbe, x, y, z, 0, 0, 0);
  }
  /** Halbkugel, flach unten — fuer Buschwerk und Kuppeln. */
  halbkugel(x, y, z, r, farbe, seiten) {
    const g = new THREE.SphereGeometry(r, seiten || 8, (seiten || 8) >> 1, 0, Math.PI * 2, 0, Math.PI / 2);
    return this._lege(g, farbe, x, y, z, 0, 0, 0);
  }

  /** Ein flaches Dreieck, beidseitig sichtbar — fuer Giebelwaende. */
  dreieck(x, y, z, breite, hoehe, farbe, drehY) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
      -breite / 2, 0, 0, breite / 2, 0, 0, 0, hoehe, 0,
      breite / 2, 0, 0, -breite / 2, 0, 0, 0, hoehe, 0
    ]), 3));
    g.computeVertexNormals();
    return this._lege(g, farbe, x, y, z, 0, drehY || 0, 0);
  }

  /** Pyramidendach (Kegel mit vier Seiten, um 45° gedreht). */
  dach(x, y, z, breite, hoehe, farbe) {
    return this._lege(new THREE.ConeGeometry(breite * 0.72, hoehe, 4), farbe, x, y + hoehe / 2, z, 0, Math.PI / 4, 0);
  }

  /**
   * Satteldach: zwei geneigte Flaechen ueber der Grundflaeche bx × bz,
   * First in der Mitte, dazu die beiden Giebelwaende. Der First laeuft
   * in z-Richtung, die Flaechen fallen nach ±x ab.
   */
  giebel(x, y, z, bx, bz, h, farbe, first) {
    const ueber = 0.07;
    const breite = bx + ueber * 2, tiefe = bz + ueber * 2;
    const laenge = Math.sqrt((breite / 2) * (breite / 2) + h * h);
    const winkel = Math.atan2(h, breite / 2);
    this._lege(new THREE.BoxGeometry(laenge, 0.07, tiefe), farbe, x - breite / 4, y + h / 2, z, 0, 0, winkel);
    this._lege(new THREE.BoxGeometry(laenge, 0.07, tiefe), farbe, x + breite / 4, y + h / 2, z, 0, 0, -winkel);
    if (first !== false) this.kasten(x, y + h + 0.03, z, 0.1, 0.08, tiefe, FARBE.holzDunkel);
    for (const s of [-1, 1]) this.dreieck(x, y, z + s * bz / 2, bx, h, FARBE.putzGrau);
    return this;
  }

  /** Zinnenkranz auf Mauer oder Turm. */
  zinnen(x, y, z, breite, tiefe, farbe, zahl) {
    const n = zahl || 4;
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n - 0.5;
      this.kasten(x + t * breite, y, z - tiefe / 2, breite / (n * 2.2), 0.2, 0.13, farbe);
      this.kasten(x + t * breite, y, z + tiefe / 2, breite / (n * 2.2), 0.2, 0.13, farbe);
      this.kasten(x - breite / 2, y, z + t * tiefe, 0.13, 0.2, tiefe / (n * 2.2), farbe);
      this.kasten(x + breite / 2, y, z + t * tiefe, 0.13, 0.2, tiefe / (n * 2.2), farbe);
    }
    return this;
  }

  /** Fenster: dunkle Nische mit hellem Rahmen. */
  fenster(x, y, z, b, h, richtung) {
    const dz = richtung === 'z' ? 0.03 : 0;
    const dx = richtung === 'z' ? 0 : 0.03;
    this.kasten(x, y, z, richtung === 'z' ? b : 0.06, h, richtung === 'z' ? 0.06 : b, FARBE.fenster);
    this.kasten(x + dx, y + h / 2 + 0.03, z + dz, richtung === 'z' ? b + 0.08 : 0.07,
      0.06, richtung === 'z' ? 0.07 : b + 0.08, FARBE.holzDunkel);
    return this;
  }

  /** Tuer mit Sturz. */
  tuer(x, y, z, b, h, richtung) {
    this.kasten(x, y + h / 2, z, richtung === 'z' ? b : 0.07, h, richtung === 'z' ? 0.07 : b, FARBE.holzDunkel);
    this.kasten(x, y + h + 0.04, z, richtung === 'z' ? b + 0.1 : 0.09, 0.08,
      richtung === 'z' ? 0.09 : b + 0.1, FARBE.balken);
    return this;
  }

  /** Fachwerk: schraege und senkrechte Balken auf einer Wand. */
  fachwerk(x, y, z, breite, hoehe, tiefe, richtung) {
    const n = Math.max(2, Math.round(breite / 0.55));
    for (let i = 0; i <= n; i++) {
      const t = i / n - 0.5;
      if (richtung === 'z') this.kasten(x + t * breite, y, z, 0.07, hoehe, tiefe + 0.02, FARBE.balken);
      else this.kasten(x, y, z + t * breite, tiefe + 0.02, hoehe, 0.07, FARBE.balken);
    }
    /* Waagerechte Baender oben und unten. */
    for (const s of [-1, 1]) {
      if (richtung === 'z') this.kasten(x, y + s * (hoehe / 2 - 0.04), z, breite, 0.08, tiefe + 0.02, FARBE.balken);
      else this.kasten(x, y + s * (hoehe / 2 - 0.04), z, tiefe + 0.02, 0.08, breite, FARBE.balken);
    }
    return this;
  }

  /** Zaun aus Pfosten und zwei Querlatten. */
  zaun(x0, z0, x1, z1, farbe) {
    const dx = x1 - x0, dz = z1 - z0;
    const laenge = Math.hypot(dx, dz);
    const n = Math.max(1, Math.round(laenge / 0.5));
    const winkel = Math.atan2(dx, dz);
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      this.kasten(x0 + dx * t, 0.19, z0 + dz * t, 0.07, 0.38, 0.07, farbe || FARBE.holz);
    }
    for (const h of [0.14, 0.3]) {
      this.kasten((x0 + x1) / 2, h, (z0 + z1) / 2, 0.05, 0.05, laenge, farbe || FARBE.holzHell, winkel);
    }
    return this;
  }

  /** Fass. */
  fass(x, y, z, r, h, gelegt) {
    this.zylinder(x, y + (gelegt ? 0 : h / 2), z, r, r * 0.92, h, 8, FARBE.holz, gelegt ? Math.PI / 2 : 0);
    for (const t of [-0.28, 0.28]) {
      this.zylinder(x, y + (gelegt ? 0 : h / 2) + (gelegt ? 0 : t * h), z + (gelegt ? t * h : 0),
        r * 1.04, r * 1.04, 0.05, 8, FARBE.eisen, gelegt ? Math.PI / 2 : 0);
    }
    return this;
  }

  /** Fahnenstange mit wehendem Tuch (Tuch in Spielerfarbe). */
  fahne(x, y, z, hoehe) {
    this.zylinder(x, y + hoehe / 2, z, 0.035, 0.035, hoehe, 6, FARBE.holzDunkel);
    this.kugel(x, y + hoehe + 0.05, z, 0.06, FARBE.gold, 6);
    this.kasten(x + 0.17, y + hoehe - 0.18, z, 0.32, 0.24, 0.04, null);
    return this;
  }

  /** Kleiner Wimpel — traegt die Spielerfarbe, ohne das ganze Dach
      einzufaerben. Damit bleibt ein Dorf ein Dorf und faerbt sich
      nicht durchgehend blau oder rot. */
  wimpel(x, y, z, hoehe) {
    this.zylinder(x, y + hoehe / 2, z, 0.025, 0.03, hoehe, 5, FARBE.holzDunkel);
    this.kugel(x, y + hoehe + 0.03, z, 0.04, FARBE.gold, 5);
    this.dreieck(x + 0.11, y + hoehe - 0.22, z, 0.22, 0.2, null, Math.PI / 2);
    this.kasten(x + 0.11, y + hoehe - 0.12, z, 0.22, 0.03, 0.03, null, Math.PI / 2);
    return this;
  }

  /** Stapel Bretter oder Baumstaemme. */
  stapel(x, y, z, n, laenge, r, farbe) {
    for (let i = 0; i < n; i++) {
      const reihe = i % 3, lage = (i / 3) | 0;
      this.zylinder(x + (reihe - 1) * r * 2.1 + lage * r, y + r + lage * r * 1.7, z,
        r, r, laenge, 6, farbe || FARBE.holzHell, 0, Math.PI / 2);
    }
    return this;
  }

  fertig() {
    return { koerper: verschmelze(this.koerper), neutral: verschmelze(this.neutral) };
  }
}

/** Fasst mehrere Geometrien zu einer zusammen (ohne fremde Hilfsbibliothek). */
export function verschmelze(liste) {
  liste = liste.filter(g => g && g.attributes.position);
  if (!liste.length) return null;
  let punkte = 0;
  for (const g of liste) punkte += g.attributes.position.count;
  const pos = new Float32Array(punkte * 3);
  const nor = new Float32Array(punkte * 3);
  const far = new Float32Array(punkte * 3);
  let o = 0;
  for (const g of liste) {
    const p = g.attributes.position, n = g.attributes.normal, c = g.attributes.color;
    pos.set(p.array.subarray ? p.array.subarray(0, p.count * 3) : p.array, o * 3);
    if (n) nor.set(n.array.subarray ? n.array.subarray(0, n.count * 3) : n.array, o * 3);
    if (c) far.set(c.array.subarray ? c.array.subarray(0, c.count * 3) : c.array, o * 3);
    else for (let i = 0; i < p.count; i++) { far[(o + i) * 3] = 1; far[(o + i) * 3 + 1] = 1; far[(o + i) * 3 + 2] = 1; }
    o += p.count;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(far, 3));
  geo.computeBoundingSphere();
  return geo;
}

/* ═══════════════ Landschaft ═══════════════
   Sechs Baumarten, damit ein Wald nicht wie gestempelt aussieht.
   Welche Art auf welcher Kachel steht, entscheidet die Darstellung
   aus den Kachelkoordinaten — nicht der Zufall, sonst saehe der
   Wald bei jedem Neuzeichnen anders aus. */

const landSpeicher = new Map();

export const BAUMARTEN = ['fichte', 'kiefer', 'eiche', 'birke', 'busch', 'totholz'];

export function landModell(art) {
  if (landSpeicher.has(art)) return landSpeicher.get(art);
  const b = new Bau();
  switch (art) {

    /* ── Baeume ── */
    case 'fichte': {
      /* Schlanke Tanne: Stamm mit Astansaetzen, drei Nadelkraenze. */
      b.zylinder(0, 0.32, 0, 0.06, 0.11, 0.64, 6, 0x5b4026);
      b.kegel(0, 0.78, 0, 0.44, 0.62, 7, 0x27622f);
      b.kegel(0, 1.12, 0, 0.36, 0.55, 7, 0x2f7038);
      b.kegel(0, 1.44, 0, 0.25, 0.48, 7, 0x3a7f42);
      b.kegel(0, 1.72, 0, 0.13, 0.3, 6, 0x458c4a);
      break;
    }
    case 'kiefer': {
      /* Hoher, kahler Stamm, Krone erst oben — laesst Licht durch. */
      b.zylinder(0, 0.55, 0, 0.07, 0.12, 1.1, 6, 0x7a4f2c);
      b.zylinder(0.12, 0.78, 0.04, 0.03, 0.03, 0.36, 4, 0x6b4527, 0, -0.9);
      b.zylinder(-0.13, 0.95, -0.03, 0.03, 0.03, 0.32, 4, 0x6b4527, 0, 0.8);
      b.halbkugel(0, 1.08, 0, 0.48, 0x3d7a34, 8);
      b.halbkugel(0.2, 1.24, 0.12, 0.3, 0x468a3c, 7);
      b.halbkugel(-0.18, 1.2, -0.1, 0.26, 0x35702e, 7);
      break;
    }
    case 'eiche': {
      /* Breite Laubkrone aus mehreren Kugeln, kraeftiger Stamm. */
      b.zylinder(0, 0.34, 0, 0.11, 0.17, 0.68, 7, 0x6b4a2a);
      b.zylinder(0.16, 0.62, 0.05, 0.05, 0.06, 0.3, 5, 0x6b4a2a, 0, -1.0);
      b.zylinder(-0.15, 0.66, -0.06, 0.05, 0.06, 0.28, 5, 0x6b4a2a, 0, 0.95);
      b.kugel(0, 0.98, 0, 0.44, 0x3c7b31, 9);
      b.kugel(0.32, 0.86, 0.14, 0.3, 0x448a37, 8);
      b.kugel(-0.28, 0.9, -0.16, 0.28, 0x35702c, 8);
      b.kugel(0.06, 1.22, -0.14, 0.26, 0x4c9440, 8);
      break;
    }
    case 'birke': {
      /* Heller Stamm mit dunklen Rindenstrichen, lichte Krone. */
      b.zylinder(0, 0.52, 0, 0.055, 0.085, 1.04, 6, 0xdcd7c8);
      for (const [h, s] of [[0.3, 0.05], [0.55, -0.06], [0.8, 0.04]]) {
        b.kasten(s, h, 0.07, 0.11, 0.035, 0.03, 0x3d3a33);
      }
      b.kugel(0, 1.16, 0, 0.34, 0x63a13f, 8);
      b.kugel(0.22, 1.02, 0.1, 0.24, 0x71ad48, 7);
      b.kugel(-0.19, 1.08, -0.12, 0.22, 0x568f37, 7);
      break;
    }
    case 'busch': {
      /* Unterholz — niedrig, breit, dicht. */
      b.zylinder(0, 0.1, 0, 0.05, 0.07, 0.2, 5, 0x6b4a2a);
      b.halbkugel(0, 0.18, 0, 0.42, 0x3f7a33, 8);
      b.kugel(0.24, 0.28, 0.12, 0.22, 0x498a3a, 7);
      b.kugel(-0.2, 0.3, -0.14, 0.2, 0x376c2c, 7);
      break;
    }
    case 'totholz': {
      /* Abgestorbener Baum: kahle Aeste, gute Abwechslung im Wald. */
      b.zylinder(0, 0.46, 0, 0.07, 0.13, 0.92, 6, 0x6a5a44);
      b.zylinder(0.2, 0.72, 0.05, 0.035, 0.045, 0.42, 4, 0x6a5a44, 0, -1.1);
      b.zylinder(-0.22, 0.82, -0.04, 0.03, 0.04, 0.38, 4, 0x6a5a44, 0, 1.15);
      b.zylinder(0.06, 1.0, 0.18, 0.025, 0.035, 0.3, 4, 0x6a5a44, 0.9, 0);
      break;
    }

    /* ── Beeren ── */
    case 'beere': {
      /* Eine grosse gruene Kugel mit roten Punkten — so verlangt,
         und auf der Karte auf einen Blick zu erkennen. */
      b.zylinder(0, 0.09, 0, 0.05, 0.07, 0.18, 5, 0x5c4326);
      b.kugel(0, 0.42, 0, 0.36, 0x3f8a35, 10);
      const punkte = [
        [0.30, 0.50, 0.10], [-0.26, 0.46, 0.18], [0.12, 0.72, 0.22],
        [-0.14, 0.66, -0.26], [0.24, 0.34, -0.22], [-0.30, 0.30, -0.08],
        [0.04, 0.20, 0.30], [0.32, 0.62, -0.06], [-0.08, 0.76, 0.02],
        [-0.32, 0.58, -0.14], [0.18, 0.24, 0.26], [-0.2, 0.2, 0.22]
      ];
      for (const [x, y, z] of punkte) b.kugel(x, y, z, 0.075, 0xc22c33, 6);
      break;
    }

    /* ── Erz ── */
    case 'gold': {
      b.kegel(0, 0.16, 0, 0.4, 0.34, 6, 0x8a8377);
      b.kasten(-0.16, 0.12, 0.12, 0.22, 0.22, 0.2, 0x9a9385, 0.5);
      b.kugel(0.1, 0.3, 0.06, 0.09, 0xe8bf34, 7);
      b.kugel(-0.12, 0.26, -0.06, 0.075, 0xf0cb46, 7);
      b.kugel(0.2, 0.18, -0.16, 0.06, 0xd6ae2a, 6);
      break;
    }
    case 'stein': {
      b.kegel(0, 0.17, 0, 0.42, 0.36, 6, 0x8d8d88);
      b.kasten(0.14, 0.14, 0.12, 0.26, 0.26, 0.24, 0xa5a5a0, 0.6, 0.3);
      b.kasten(-0.18, 0.1, -0.1, 0.2, 0.2, 0.2, 0x9a9a95, 0.9, 0, 0.4);
      b.kugel(0.02, 0.36, -0.02, 0.12, 0xb2b2ad, 6);
      break;
    }

    /* ── Fisch ──
       Liegt im Wasser: ein Schwarm dicht unter der Oberflaeche, dazu
       ein paar Ringe. Mehr braucht es nicht, um erkennbar zu sein. */
    case 'fisch': {
      for (const [dx, dz, dreh, gross] of [[0, 0, 0.3, 1], [0.22, 0.18, -0.5, 0.8], [-0.2, 0.15, 0.9, 0.7], [0.05, -0.24, 1.6, 0.75]]) {
        const l = 0.2 * gross;
        b.kugel(dx, 0.06, dz, l * 0.5, 0x4a7f9c, 6);
        b.kegel(dx - Math.cos(dreh) * l, 0.06, dz - Math.sin(dreh) * l, l * 0.45, l * 0.9, 4, 0x3d6d88, Math.PI / 2, dreh);
        b.kasten(dx, 0.12, dz, l * 0.5, l * 0.35, 0.02, 0x5a90ab, dreh);
      }
      break;
    }

    /* ── Tiere ── */
    case 'schaf': {
      b.kugel(0, 0.24, 0, 0.2, 0xefe9dd, 8);
      b.kugel(-0.14, 0.28, 0, 0.15, 0xf5f0e6, 7);
      b.kugel(0.13, 0.26, 0.04, 0.14, 0xefe9dd, 7);
      b.kasten(0.22, 0.27, 0, 0.13, 0.13, 0.12, 0x46423e);       // Kopf
      b.kasten(0.29, 0.29, 0, 0.06, 0.07, 0.09, 0x37332f);       // Schnauze
      for (const [dx, dz] of [[-0.1, -0.08], [-0.1, 0.08], [0.1, -0.08], [0.1, 0.08]]) {
        b.kasten(dx, 0.07, dz, 0.05, 0.14, 0.05, 0x46423e);
      }
      break;
    }
    case 'wild': {
      /* Hirsch mit Geweih. */
      b.kasten(0, 0.34, 0, 0.44, 0.2, 0.2, 0x8a6134);
      b.kasten(0.2, 0.44, 0, 0.14, 0.24, 0.13, 0x8a6134, 0, 0, -0.3);
      b.kasten(0.3, 0.58, 0, 0.19, 0.13, 0.12, 0x9a6f3d);
      b.kasten(0.39, 0.56, 0, 0.08, 0.08, 0.09, 0x6b4a26);
      /* Geweih */
      for (const s of [-1, 1]) {
        b.zylinder(0.3, 0.72, s * 0.05, 0.02, 0.025, 0.2, 4, 0x5c4326, 0, s * 0.35);
        b.zylinder(0.34, 0.82, s * 0.1, 0.015, 0.018, 0.12, 4, 0x5c4326, 0.5, s * 0.6);
        b.zylinder(0.24, 0.82, s * 0.09, 0.015, 0.018, 0.12, 4, 0x5c4326, -0.4, s * 0.5);
      }
      b.kasten(-0.24, 0.4, 0, 0.1, 0.12, 0.06, 0xefe9dd);        // Blume
      for (const [dx, dz] of [[-0.15, -0.08], [-0.15, 0.08], [0.14, -0.08], [0.14, 0.08]]) {
        b.kasten(dx, 0.12, dz, 0.055, 0.24, 0.055, 0x6f4d29);
      }
      break;
    }

    default:
      b.kegel(0, 0.2, 0, 0.3, 0.4, 5, 0x777777);
  }
  const modell = b.fertig();
  landSpeicher.set(art, modell);
  return modell;
}

/** Geschosse: Pfeil, Stein, Speer. */
export function geschossModell(art) {
  const schluessel = 'g:' + art;
  if (landSpeicher.has(schluessel)) return landSpeicher.get(schluessel);
  const b = new Bau();
  if (art === 'stein') {
    b.kugel(0, 0, 0, 0.14, FARBE.stein, 6);
    b.kasten(0.06, 0.04, 0.05, 0.1, 0.1, 0.1, FARBE.steinDunkel, 0.6);
  } else if (art === 'speer') {
    b.zylinder(0, 0, 0, 0.022, 0.022, 0.44, 5, FARBE.holz, 0, Math.PI / 2);
    b.kegel(0.24, 0, 0, 0.045, 0.14, 4, FARBE.metall, 0, -Math.PI / 2);
  } else {
    b.zylinder(0, 0, 0, 0.016, 0.016, 0.36, 4, 0x5a4632, 0, Math.PI / 2);
    b.kegel(0.2, 0, 0, 0.03, 0.1, 4, FARBE.metall, 0, -Math.PI / 2);
    b.kasten(-0.16, 0, 0, 0.07, 0.05, 0.01, FARBE.stoff);
  }
  const modell = b.fertig();
  landSpeicher.set(schluessel, modell);
  return modell;
}

/* ═══════════════ Gebaeude ═══════════════
   Masse in Kacheln: ein Gebaeude der Groesse g ist g × g gross,
   der Nullpunkt liegt in seiner Mitte auf dem Boden. Die
   Spielerfarbe traegt jeweils das Dach oder das Tuch — nie die
   ganze Wand, sonst erkennt man das Gebaeude nicht wieder. */

const gebaeudeSpeicher = new Map();

export function gebaeudeModell(typ, volk) {
  const schluessel = typ + ':' + volk;
  if (gebaeudeSpeicher.has(schluessel)) return gebaeudeSpeicher.get(schluessel);
  const g = GEBAEUDE[typ].groesse;
  const b = new Bau();

  switch (typ) {

    /* ─────────────── Dorfzentrum ───────────────
       Ein Rathaus, keine Burg: breites Fachwerkhaus mit Ziegeldach,
       offener Laube auf Holzsaeulen, Glockengiebel, Schornstein.
       Ringsum das, was ein Ablieferplatz eben hat — Faesser,
       Saecke, Holzstapel, Brunnen. */
    case 'dorfzentrum': {
      const w = g - 1.2;                       // Breite des Hauskoerpers
      /* Sockel und Vorplatz */
      b.kasten(0, 0.07, 0, g - 0.3, 0.14, g - 0.3, FARBE.steinDunkel);
      b.kasten(0, 0.16, 0, g - 0.9, 0.1, g - 1.5, FARBE.stein);

      /* Erdgeschoss: verputzte Wand mit Fachwerk */
      b.kasten(0, 0.62, -0.25, w, 0.82, g - 2.0, FARBE.putz);
      b.fachwerk(0, 0.62, -0.25 + (g - 2.0) / 2 + 0.01, w, 0.82, 0.04, 'z');
      b.fachwerk(0, 0.62, -0.25 - (g - 2.0) / 2 - 0.01, w, 0.82, 0.04, 'z');
      b.fachwerk(-w / 2 - 0.01, 0.62, -0.25, g - 2.0, 0.82, 0.04, 'x');
      b.fachwerk(w / 2 + 0.01, 0.62, -0.25, g - 2.0, 0.82, 0.04, 'x');

      /* Obergeschoss kragt vor — typisch fuer ein Rathaus */
      b.kasten(0, 1.28, -0.25, w + 0.24, 0.5, g - 1.8, FARBE.putzGrau);
      b.kasten(0, 1.02, -0.25, w + 0.3, 0.09, g - 1.75, FARBE.balken);
      for (const s of [-1, 1]) {
        b.fenster(s * 0.5, 1.3, -0.25 + (g - 1.8) / 2, 0.26, 0.3, 'z');
      }
      b.fenster(0, 1.3, -0.25 + (g - 1.8) / 2, 0.26, 0.3, 'z');

      /* Steiles Ziegeldach in Spielerfarbe — ein flaches saehe aus
         wie ein Deckel und liesse das Haus gedrungen wirken. */
      const dachY = 1.53, dachH = 1.05;
      b.giebel(0, dachY, -0.25, w + 0.1, g - 1.9, dachH, null);
      const first = dachY + dachH;

      /* Glockenstuhl auf dem First — das Zeichen des Rathauses */
      for (const dx of [-0.24, 0, 0.24]) b.kasten(dx, first + 0.2, -0.25, 0.09, 0.4, 0.09, FARBE.holzDunkel);
      b.kasten(0, first + 0.42, -0.25, 0.62, 0.09, 0.14, FARBE.holzDunkel);
      b.kegel(0, first + 0.5, -0.25, 0.36, 0.3, 4, null);
      b.kegel(0, first + 0.24, -0.25, 0.12, 0.2, 6, FARBE.gold, Math.PI);

      /* Schornstein, der ueber den First hinausragt */
      b.kasten(w / 2 - 0.4, first - 0.35, -0.75, 0.24, 1.1, 0.24, FARBE.steinDunkel);
      b.kasten(w / 2 - 0.4, first + 0.24, -0.75, 0.32, 0.09, 0.32, FARBE.stein);

      /* Offene Laube davor: vier Saeulen, Balken, Pultdach */
      const vz = g / 2 - 0.55;
      for (const sx of [-1, 1]) {
        b.zylinder(sx * (w / 2 - 0.15), 0.5, vz, 0.09, 0.11, 1.0, 7, FARBE.holz);
        b.zylinder(sx * (w / 2 - 0.15) * 0.4, 0.5, vz, 0.09, 0.11, 1.0, 7, FARBE.holz);
        /* Kopfbaender */
        b.kasten(sx * (w / 2 - 0.32), 0.94, vz, 0.28, 0.07, 0.07, FARBE.balken, 0, 0, sx * 0.6);
      }
      b.kasten(0, 1.02, vz, w + 0.1, 0.1, 0.12, FARBE.balken);
      b.platte(0, 1.18, vz - 0.16, w + 0.34, 0.9, null, 0, -0.32);

      /* Eingang mit Stufen */
      b.tuer(0, 0.21, -0.25 + (g - 2.0) / 2 - 0.02, 0.46, 0.72, 'z');
      b.kasten(0, 0.12, vz + 0.42, 0.9, 0.08, 0.2, FARBE.stein);
      b.kasten(0, 0.06, vz + 0.6, 1.0, 0.08, 0.2, FARBE.stein);

      /* Ablieferplatz: Faesser, Saecke, Holz, Brunnen */
      b.fass(-g / 2 + 0.45, 0.16, g / 2 - 0.5, 0.15, 0.34);
      b.fass(-g / 2 + 0.75, 0.16, g / 2 - 0.4, 0.13, 0.3);
      b.fass(-g / 2 + 0.5, 0.3, g / 2 - 0.85, 0.13, 0.3, true);
      b.stapel(g / 2 - 0.55, 0.16, g / 2 - 0.6, 6, 0.7, 0.07);
      for (const [dx, dz, r] of [[0.5, -0.4, 0.16], [0.75, -0.62, 0.14], [0.42, -0.75, 0.13]]) {
        b.halbkugel(-g / 2 + 0.6 + dx, 0.16, -g / 2 + 0.6 + dz, r, FARBE.stroh, 6);
      }
      /* Brunnen */
      b.zylinder(g / 2 - 0.55, 0.32, -g / 2 + 0.6, 0.24, 0.26, 0.36, 8, FARBE.stein);
      b.zylinder(g / 2 - 0.55, 0.5, -g / 2 + 0.6, 0.2, 0.2, 0.04, 8, FARBE.wasser);
      for (const sx of [-1, 1]) b.kasten(g / 2 - 0.55 + sx * 0.22, 0.62, -g / 2 + 0.6, 0.05, 0.6, 0.05, FARBE.holz);
      b.kasten(g / 2 - 0.55, 0.92, -g / 2 + 0.6, 0.55, 0.06, 0.3, FARBE.holzDunkel);

      b.fahne(-w / 2 - 0.12, 1.45, -0.95, 0.9);
      break;
    }

    /* ─────────────── Wohnhaus ─────────────── */
    case 'haus': {
      b.kasten(0, 0.05, 0, g - 0.4, 0.1, g - 0.5, FARBE.steinDunkel);
      b.kasten(0, 0.46, 0, g - 0.55, 0.72, g - 0.7, FARBE.putz);
      b.fachwerk(0, 0.46, (g - 0.7) / 2, g - 0.55, 0.72, 0.04, 'z');
      b.fachwerk(0, 0.46, -(g - 0.7) / 2, g - 0.55, 0.72, 0.04, 'z');
      b.giebel(0, 0.82, 0, g - 0.45, g - 0.6, 0.66, FARBE.ziegel);
      b.tuer(0, 0.1, (g - 0.7) / 2 - 0.01, 0.26, 0.44, 'z');
      b.fenster(-0.4, 0.58, (g - 0.7) / 2, 0.18, 0.2, 'z');
      b.fenster(0.4, 0.58, (g - 0.7) / 2, 0.18, 0.2, 'z');
      b.kasten(0.45, 1.05, -0.2, 0.16, 0.5, 0.16, FARBE.steinDunkel);
      b.kasten(0.45, 1.32, -0.2, 0.22, 0.06, 0.22, FARBE.stein);
      b.stapel(-0.6, 0.02, -0.55, 3, 0.5, 0.06);
      break;
    }

    /* ─────────────── Muehle ─────────────── */
    case 'muehle': {
      b.zylinder(0, 0.1, 0, 0.72, 0.78, 0.2, 8, FARBE.stein);
      b.zylinder(0, 0.62, 0, 0.56, 0.7, 0.86, 8, FARBE.putz);
      for (let i = 0; i < 8; i++) {
        const a = i * Math.PI / 4;
        b.kasten(Math.sin(a) * 0.63, 0.62, Math.cos(a) * 0.63, 0.06, 0.86, 0.06, FARBE.balken, a);
      }
      b.fenster(0, 0.8, 0.6, 0.16, 0.2, 'z');
      b.tuer(0, 0.2, 0.58, 0.24, 0.4, 'z');
      b.kegel(0, 1.32, 0, 0.78, 0.56, 8, FARBE.schindel);
      b.wimpel(0, 1.58, 0, 0.42);
      /* Fluegelkreuz mit Segeln */
      b.zylinder(0, 1.0, 0.78, 0.06, 0.06, 0.16, 6, FARBE.holzDunkel, Math.PI / 2);
      for (let i = 0; i < 4; i++) {
        const a = i * Math.PI / 2 + 0.4;
        const dx = Math.cos(a), dy = Math.sin(a);
        b.kasten(dx * 0.55, 1.0 + dy * 0.55, 0.86, 1.1, 0.08, 0.05, FARBE.holz, 0, 0, a);
        b.kasten(dx * 0.62, 1.0 + dy * 0.62, 0.9, 0.8, 0.26, 0.03, FARBE.stoff, 0, 0, a);
      }
      /* Saecke am Fuss */
      for (const [dx, dz] of [[0.75, 0.45], [0.95, 0.3], [0.7, 0.15]]) {
        b.halbkugel(dx, 0.02, dz, 0.17, FARBE.stroh, 6);
      }
      break;
    }

    /* ─────────────── Farm ───────────────
       Ein Weizenfeld, kein gruener Rasen: Erdreich mit Furchen,
       darauf einzelne Halme mit Aehre — reihenweise gesetzt, in
       Hoehe und Neigung leicht gestreut, damit es nach Feld
       aussieht und nicht nach Bordüre. Die Streuung kommt aus den
       Zaehlern, nicht aus dem Zufall: so sieht jeder Acker gleich
       aus und niemand rechnet beim Zeichnen etwas nach. */
    case 'farm': {
      b.kasten(0, 0.03, 0, g - 0.1, 0.06, g - 0.1, 0x8a6b3a);
      const reihen = 8, jeReihe = 9;
      const spanne = g - 0.7;
      for (let r = 0; r < reihen; r++) {
        const z = -spanne / 2 + r * spanne / (reihen - 1);
        /* Furche unter der Reihe */
        b.kasten(0, 0.08, z, g - 0.28, 0.05, 0.12, r % 2 ? 0x9a7a42 : 0x8a6b3a);
        for (let i = 0; i < jeReihe; i++) {
          const versatz = (r % 2) ? 0.07 : -0.07;
          const x = -spanne / 2 + i * spanne / (jeReihe - 1) + versatz;
          const streu = (r * 7 + i * 13) % 5;
          const hoehe = 0.34 + streu * 0.04;
          const neigung = (((r * 5 + i * 11) % 7) - 3) * 0.045;
          const halm = [0xd2be5c, 0xdcc868, 0xc8b453][streu % 3];
          const aehre = [0xf0d34f, 0xe6c63f, 0xf7de6a][(streu + i) % 3];
          b.zylinder(x, 0.1 + hoehe / 2, z, 0.014, 0.02, hoehe, 3, halm, 0, neigung);
          /* Aehre am oberen Ende, in Neigungsrichtung versetzt */
          const kx = x + Math.sin(neigung) * hoehe * 0.55;
          b.kegel(kx, 0.12 + hoehe + 0.08, z, 0.07, 0.22, 5, aehre, 0, neigung);
        }
      }
      /* Eckpfaehle mit gespanntem Seil */
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        b.kasten(sx * (g / 2 - 0.12), 0.18, sz * (g / 2 - 0.12), 0.07, 0.36, 0.07, FARBE.holz);
      }
      for (const t of [-1, 1]) {
        b.kasten(0, 0.3, t * (g / 2 - 0.12), g - 0.24, 0.03, 0.03, FARBE.holzHell);
        b.kasten(t * (g / 2 - 0.12), 0.3, 0, 0.03, 0.03, g - 0.24, FARBE.holzHell);
      }
      /* Vogelscheuche mit Strohhut und ausgebreiteten Armen */
      const vx = g / 2 - 0.45, vz = -g / 2 + 0.45;
      b.kasten(vx, 0.34, vz, 0.05, 0.68, 0.05, FARBE.holzDunkel);
      b.kasten(vx, 0.54, vz, 0.46, 0.05, 0.05, FARBE.holzDunkel);
      b.kasten(vx, 0.5, vz, 0.2, 0.24, 0.12, 0x8a6a3a);
      b.kugel(vx, 0.7, vz, 0.09, FARBE.stroh, 6);
      b.zylinder(vx, 0.76, vz, 0.15, 0.15, 0.03, 8, FARBE.strohDunkel);
      break;
    }

    /* ─────────────── Lager ─────────────── */
    case 'lager': {
      b.kasten(0, 0.04, 0, g - 0.3, 0.08, g - 0.3, FARBE.steinDunkel);
      /* Offener Schuppen: Rueckwand, zwei Seitenwaende, Pultdach */
      b.kasten(0, 0.42, -(g - 0.9) / 2, g - 0.5, 0.76, 0.1, FARBE.holz);
      for (const sx of [-1, 1]) {
        b.kasten(sx * (g - 0.5) / 2, 0.42, 0, 0.1, 0.76, g - 0.9, FARBE.holz);
        b.zylinder(sx * (g - 0.6) / 2, 0.45, (g - 0.9) / 2, 0.07, 0.08, 0.9, 6, FARBE.holzHell);
      }
      b.platte(0, 0.92, 0.06, g - 0.25, g - 0.7, FARBE.schindel, 0, -0.22);
      b.kasten(0, 0.86, -(g - 0.9) / 2, g - 0.4, 0.09, 0.12, FARBE.balken);
      /* Lagergut */
      b.stapel(-0.35, 0.08, -0.25, 6, 0.8, 0.075);
      b.fass(0.45, 0.08, -0.3, 0.16, 0.36);
      b.fass(0.45, 0.08, 0.1, 0.16, 0.36);
      b.fass(0.72, 0.26, -0.1, 0.14, 0.32, true);
      for (const [dx, dz] of [[-0.5, 0.35], [-0.2, 0.45]]) b.halbkugel(dx, 0.08, dz, 0.18, FARBE.stroh, 6);
      /* Amboss und Werkbank */
      b.kasten(0.3, 0.2, 0.4, 0.34, 0.24, 0.24, FARBE.holzDunkel);
      b.kasten(0.3, 0.36, 0.4, 0.2, 0.1, 0.14, FARBE.eisen);
      break;
    }

    /* ─────────────── Kaserne ─────────────── */
    case 'kaserne': {
      b.kasten(0, 0.05, 0, g - 0.3, 0.1, g - 0.3, FARBE.steinDunkel);
      b.kasten(0, 0.5, -0.25, g - 0.6, 0.8, g - 1.1, FARBE.putzGrau);
      b.fachwerk(0, 0.5, -0.25 + (g - 1.1) / 2, g - 0.6, 0.8, 0.04, 'z');
      b.giebel(0, 0.9, -0.25, g - 0.5, g - 1.0, 0.78, FARBE.ziegel);
      b.tuer(0, 0.1, -0.25 + (g - 1.1) / 2 - 0.02, 0.4, 0.6, 'z');
      b.fenster(-0.75, 0.72, -0.25 + (g - 1.1) / 2, 0.2, 0.22, 'z');
      b.fenster(0.75, 0.72, -0.25 + (g - 1.1) / 2, 0.2, 0.22, 'z');
      /* Uebungsplatz mit Waffenstaender und Strohpuppe */
      b.zaun(-g / 2 + 0.3, g / 2 - 0.3, g / 2 - 0.3, g / 2 - 0.3);
      b.kasten(-0.6, 0.3, g / 2 - 0.75, 0.6, 0.08, 0.1, FARBE.holz);
      for (let i = 0; i < 4; i++) {
        b.zylinder(-0.82 + i * 0.15, 0.45, g / 2 - 0.75, 0.02, 0.02, 0.5, 4, FARBE.holzHell, 0.15);
        b.kegel(-0.82 + i * 0.15, 0.72, g / 2 - 0.75, 0.04, 0.12, 4, FARBE.metall);
      }
      b.kasten(0.7, 0.36, g / 2 - 0.7, 0.07, 0.72, 0.07, FARBE.holzDunkel);
      b.kasten(0.7, 0.6, g / 2 - 0.7, 0.44, 0.07, 0.07, FARBE.holzDunkel);
      b.kugel(0.7, 0.76, g / 2 - 0.7, 0.11, FARBE.stroh, 6);
      b.kasten(0.7, 0.58, g / 2 - 0.62, 0.3, 0.28, 0.06, FARBE.leder);
      b.fahne(-g / 2 + 0.35, 0.1, -g / 2 + 0.35, 1.0);
      break;
    }

    /* ─────────────── Schuetzenstand ─────────────── */
    case 'schuetzenstand': {
      b.kasten(0, 0.05, 0, g - 0.3, 0.1, g - 0.3, FARBE.steinDunkel);
      b.kasten(0, 0.44, -0.45, g - 0.7, 0.68, g - 1.6, FARBE.holz);
      b.giebel(0, 0.78, -0.45, g - 0.6, g - 1.5, 0.62, FARBE.schindel);
      b.tuer(0, 0.1, -0.45 + (g - 1.6) / 2 - 0.02, 0.34, 0.5, 'z');
      /* Ueberdachter Schiessstand */
      for (const sx of [-1, 1]) {
        b.zylinder(sx * (g / 2 - 0.35), 0.42, 0.35, 0.07, 0.08, 0.84, 6, FARBE.holz);
      }
      b.platte(0, 0.9, 0.35, g - 0.5, 0.8, FARBE.schindel, 0, -0.18);
      b.wimpel(-g / 2 + 0.3, 0.1, -g / 2 + 0.3, 0.8);
      /* Zielscheiben */
      for (const [dx, dz] of [[0.55, g / 2 - 0.35], [-0.55, g / 2 - 0.35]]) {
        b.kasten(dx, 0.25, dz, 0.07, 0.5, 0.07, FARBE.holz);
        b.zylinder(dx, 0.62, dz, 0.24, 0.24, 0.07, 12, FARBE.stoff, Math.PI / 2);
        b.zylinder(dx, 0.62, dz + 0.05, 0.14, 0.14, 0.04, 10, 0xc0392b, Math.PI / 2);
        b.zylinder(dx, 0.62, dz + 0.08, 0.05, 0.05, 0.03, 8, 0x2a2620, Math.PI / 2);
        b.zylinder(dx + 0.06, 0.66, dz + 0.14, 0.012, 0.012, 0.2, 4, 0x5a4632, Math.PI / 2);
      }
      /* Bogenstaender */
      b.kasten(-0.7, 0.3, -0.1, 0.5, 0.07, 0.1, FARBE.holzDunkel, 0.4);
      for (let i = 0; i < 3; i++) {
        b.zylinder(-0.85 + i * 0.14, 0.5, -0.05, 0.02, 0.02, 0.44, 4, FARBE.holzHell, 0, 0.2);
      }
      break;
    }

    /* ─────────────── Stall ─────────────── */
    case 'stall': {
      b.kasten(0, 0.05, 0, g - 0.3, 0.1, g - 0.3, FARBE.steinDunkel);
      b.kasten(-0.35, 0.46, 0, g - 1.3, 0.72, g - 0.7, FARBE.holz);
      b.giebel(-0.35, 0.82, 0, g - 1.2, g - 0.6, 0.7, FARBE.stroh);
      b.wimpel(-g / 2 + 0.3, 0.1, -g / 2 + 0.3, 0.8);
      /* Stalltueren */
      for (const s of [-1, 1]) {
        b.kasten(-0.35 + (g - 1.3) / 2 - 0.02, 0.34, s * 0.55, 0.05, 0.48, 0.42, FARBE.holzDunkel);
        b.kasten(-0.35 + (g - 1.3) / 2 - 0.03, 0.4, s * 0.55, 0.03, 0.06, 0.42, FARBE.eisen);
      }
      /* Koppel */
      b.zaun(g / 2 - 1.05, -g / 2 + 0.3, g / 2 - 0.3, -g / 2 + 0.3);
      b.zaun(g / 2 - 0.3, -g / 2 + 0.3, g / 2 - 0.3, g / 2 - 0.3);
      b.zaun(g / 2 - 1.05, g / 2 - 0.3, g / 2 - 0.3, g / 2 - 0.3);
      /* Trog und Heuballen */
      b.kasten(g / 2 - 0.7, 0.14, 0, 0.5, 0.2, 0.28, FARBE.holzDunkel);
      b.kasten(g / 2 - 0.7, 0.24, 0, 0.42, 0.06, 0.2, FARBE.stroh);
      b.zylinder(g / 2 - 0.65, 0.2, -g / 2 + 0.75, 0.2, 0.2, 0.34, 8, FARBE.stroh, 0, Math.PI / 2);
      break;
    }

    /* ─────────────── Belagerungswerkstatt ─────────────── */
    case 'belagerung': {
      b.kasten(0, 0.06, 0, g - 0.3, 0.12, g - 0.3, 0x6f6b60);
      /* Offene Halle mit vier Staendern und Dachstuhl */
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        b.kasten(sx * (g / 2 - 0.35), 0.72, sz * (g / 2 - 0.35), 0.15, 1.2, 0.15, FARBE.holz);
        b.kasten(sx * (g / 2 - 0.55), 1.2, sz * (g / 2 - 0.35), 0.35, 0.09, 0.09, FARBE.balken, 0, 0, sx * 0.7);
      }
      for (const sz of [-1, 1]) b.kasten(0, 1.3, sz * (g / 2 - 0.35), g - 0.5, 0.12, 0.12, FARBE.balken);
      b.giebel(0, 1.36, 0, g - 0.3, g - 0.5, 0.6, FARBE.schindel, true);
      /* Werkstueck: halbfertige Ramme */
      b.zylinder(0, 0.5, 0, 0.16, 0.16, 1.5, 8, FARBE.holzHell, 0, Math.PI / 2);
      b.zylinder(0.72, 0.5, 0, 0.19, 0.19, 0.14, 8, FARBE.eisen, 0, Math.PI / 2);
      for (const [dx, dz] of [[-0.45, -0.3], [-0.45, 0.3], [0.35, -0.3], [0.35, 0.3]]) {
        b.zylinder(dx, 0.18, dz, 0.17, 0.17, 0.09, 8, FARBE.holzDunkel, Math.PI / 2);
      }
      /* Werkzeug und Zahnrad */
      b.kasten(-g / 2 + 0.5, 0.3, g / 2 - 0.5, 0.5, 0.12, 0.3, FARBE.holzDunkel);
      b.zylinder(g / 2 - 0.5, 0.35, -g / 2 + 0.55, 0.28, 0.28, 0.09, 10, FARBE.holz, 0, Math.PI / 2);
      b.stapel(-g / 2 + 0.5, 0.12, -g / 2 + 0.5, 6, 0.9, 0.08);
      break;
    }

    /* ─────────────── Markt ─────────────── */
    case 'markt': {
      b.kasten(0, 0.06, 0, g - 0.3, 0.12, g - 0.3, 0xa89b80);
      /* Drei Buden mit gestreiften Planen */
      const buden = [[-0.75, -0.7, 0], [0.8, -0.55, 0.3], [-0.1, 0.8, -0.4]];
      /* Drei Planen: Leinen, rot gestreift und eine in der
         Spielerfarbe — das genuegt, um den Markt zuzuordnen. */
      const planen = [FARBE.stoff, 0xb4573c, null];
      buden.forEach(([bx, bz, dreh], nummer) => {
        b.kasten(bx, 0.34, bz, 0.8, 0.44, 0.55, FARBE.holz, dreh);
        b.kasten(bx, 0.58, bz, 0.86, 0.06, 0.62, FARBE.holzHell, dreh);
        for (const sx of [-1, 1]) b.kasten(bx + sx * 0.36, 0.72, bz - 0.24, 0.05, 0.32, 0.05, FARBE.holz, dreh);
        b.platte(bx, 0.9, bz - 0.06, 0.98, 0.75, planen[nummer], dreh, -0.25);
        /* Waren */
        b.halbkugel(bx - 0.2, 0.58, bz + 0.1, 0.11, 0xc0392b, 6);
        b.halbkugel(bx + 0.05, 0.58, bz + 0.12, 0.1, 0xd8b657, 6);
        b.halbkugel(bx + 0.26, 0.58, bz + 0.08, 0.1, 0x4c7a34, 6);
      });
      /* Waage in der Mitte */
      b.kasten(0.2, 0.4, 0.05, 0.06, 0.56, 0.06, FARBE.holzDunkel);
      b.kasten(0.2, 0.66, 0.05, 0.5, 0.04, 0.04, FARBE.eisen);
      for (const s of [-1, 1]) b.zylinder(0.2 + s * 0.22, 0.58, 0.05, 0.09, 0.07, 0.06, 8, FARBE.metall);
      b.fahne(g / 2 - 0.35, 0.12, -g / 2 + 0.35, 0.9);
      b.fass(-g / 2 + 0.4, 0.12, g / 2 - 0.45, 0.15, 0.34);
      break;
    }

    /* ─────────────── Kloster ─────────────── */
    case 'kloster': {
      b.kasten(0, 0.06, 0, g - 0.3, 0.12, g - 0.3, FARBE.stein);
      /* Kirchenschiff */
      b.kasten(0.2, 0.62, 0, g - 1.3, 1.0, g - 1.1, FARBE.putz);
      b.giebel(0.2, 1.12, 0, g - 1.2, g - 1.0, 0.8, FARBE.schiefer);
      /* Rundbogenfenster */
      for (const dz of [-0.55, 0, 0.55]) {
        b.fenster(0.2 + (g - 1.3) / 2, 0.72, dz, 0.22, 0.34, 'x');
        b.zylinder(0.2 + (g - 1.3) / 2, 0.89, dz, 0.11, 0.11, 0.06, 8, FARBE.fenster, 0, Math.PI / 2);
      }
      /* Glockenturm */
      const tx = -g / 2 + 0.6;
      b.kasten(tx, 1.0, 0, 0.62, 2.0, 0.62, FARBE.stein);
      b.kasten(tx, 1.72, 0, 0.68, 0.1, 0.68, FARBE.steinDunkel);
      for (const s of [-1, 1]) {
        b.fenster(tx + s * 0.32, 1.55, 0, 0.16, 0.28, 'x');
        b.fenster(tx, 1.55, s * 0.32, 0.16, 0.28, 'z');
      }
      b.kegel(tx, 2.28, 0, 0.5, 0.72, 6, FARBE.schiefer);
      b.kasten(tx, 2.78, 0, 0.05, 0.34, 0.05, FARBE.gold);
      b.kasten(tx, 2.86, 0, 0.22, 0.05, 0.05, FARBE.gold);
      /* Kreuzgang mit Saeulen */
      for (let i = 0; i < 4; i++) {
        b.zylinder(0.2 + (g - 1.3) / 2 + 0.35, 0.4, -0.75 + i * 0.5, 0.07, 0.08, 0.8, 8, FARBE.steinHell);
      }
      b.platte(0.2 + (g - 1.3) / 2 + 0.35, 0.84, 0, 0.5, 1.8, FARBE.ziegel);
      b.tuer(0.2, 0.12, (g - 1.1) / 2 - 0.02, 0.34, 0.56, 'z');
      break;
    }

    /* ─────────────── Universitaet ─────────────── */
    case 'universitaet': {
      b.kasten(0, 0.08, 0, g - 0.2, 0.16, g - 0.2, FARBE.steinHell);
      b.kasten(0, 0.16, 0, g - 0.5, 0.12, g - 0.5, FARBE.stein);
      b.kasten(0, 0.72, -0.2, g - 0.8, 1.0, g - 1.3, FARBE.putz);
      /* Saeulenportikus */
      for (let i = 0; i < 5; i++) {
        const x = -1.0 + i * 0.5;
        b.zylinder(x, 0.62, g / 2 - 0.45, 0.1, 0.11, 0.92, 10, FARBE.steinHell);
        b.zylinder(x, 1.1, g / 2 - 0.45, 0.13, 0.13, 0.08, 10, FARBE.steinHell);
      }
      b.kasten(0, 1.2, g / 2 - 0.45, g - 0.4, 0.14, 0.3, FARBE.steinHell);
      b.kegel(0, 1.42, g / 2 - 0.45, 1.3, 0.34, 3, FARBE.putzGrau, 0, Math.PI / 2);
      /* Kuppel */
      b.zylinder(0, 1.34, -0.2, 0.62, 0.72, 0.3, 12, FARBE.steinHell);
      b.halbkugel(0, 1.48, -0.2, 0.62, FARBE.kupfer, 12);
      b.kugel(0, 2.14, -0.2, 0.1, FARBE.gold, 7);
      /* Fenster und Buecherstapel */
      for (const s of [-1, 1]) b.fenster(s * 0.85, 0.85, -0.2 + (g - 1.3) / 2, 0.24, 0.36, 'z');
      b.kasten(-g / 2 + 0.45, 0.28, -g / 2 + 0.5, 0.3, 0.09, 0.22, 0x8a3b2f);
      b.kasten(-g / 2 + 0.45, 0.37, -g / 2 + 0.5, 0.28, 0.09, 0.2, 0x2f5b8a);
      b.kasten(-g / 2 + 0.45, 0.46, -g / 2 + 0.5, 0.26, 0.08, 0.19, 0x3f7a34);
      break;
    }

    /* ─────────────── Burg ─────────────── */
    case 'burg': {
      b.kasten(0, 0.12, 0, g - 0.2, 0.24, g - 0.2, FARBE.steinDunkel);
      b.kasten(0, 0.95, 0, g - 0.9, 1.7, g - 0.9, FARBE.stein);
      /* Mauerband und Zinnen */
      b.kasten(0, 1.78, 0, g - 0.75, 0.12, g - 0.75, FARBE.steinDunkel);
      b.zinnen(0, 1.94, 0, g - 0.75, g - 0.75, FARBE.stein, 5);
      /* Bergfried */
      b.kasten(0, 2.3, -0.2, g - 2.3, 1.1, g - 2.3, FARBE.steinDunkel);
      b.zinnen(0, 2.9, -0.2, g - 2.3, g - 2.3, FARBE.stein, 3);
      b.dach(0, 2.95, -0.2, g - 2.4, 0.85, null);
      b.fahne(0, 3.8, -0.2, 0.6);
      /* Ecktuerme */
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        const x = sx * (g / 2 - 0.5), z = sz * (g / 2 - 0.5);
        b.zylinder(x, 1.3, z, 0.46, 0.54, 2.6, 9, FARBE.stein);
        b.zylinder(x, 2.62, z, 0.54, 0.54, 0.1, 9, FARBE.steinDunkel);
        b.zinnen(x, 2.78, z, 0.95, 0.95, FARBE.stein, 3);
        b.kegel(x, 3.2, z, 0.58, 0.9, 8, null);
        for (const w of [0, Math.PI / 2]) b.fenster(x + Math.sin(w) * 0.46, 1.9, z + Math.cos(w) * 0.46, 0.1, 0.3, w ? 'x' : 'z');
      }
      /* Tor mit Fallgitter */
      b.kasten(0, 0.62, g / 2 - 0.5, 0.9, 1.24, 0.14, FARBE.holzDunkel);
      b.zylinder(0, 1.22, g / 2 - 0.5, 0.45, 0.45, 0.14, 10, FARBE.stein, Math.PI / 2);
      for (let i = 0; i < 4; i++) b.kasten(-0.3 + i * 0.2, 0.62, g / 2 - 0.44, 0.05, 1.2, 0.05, FARBE.eisen);
      break;
    }

    /* ─────────────── Wachturm ─────────────── */
    case 'turm': {
      b.zylinder(0, 0.12, 0, 0.44, 0.5, 0.24, 8, FARBE.steinDunkel);
      b.zylinder(0, 1.0, 0, 0.34, 0.42, 1.8, 8, FARBE.stein);
      b.zylinder(0, 1.94, 0, 0.46, 0.42, 0.12, 8, FARBE.steinDunkel);
      b.zinnen(0, 2.08, 0, 0.82, 0.82, FARBE.stein, 3);
      b.kegel(0, 2.42, 0, 0.5, 0.72, 7, null);
      /* Schiessscharten und Leiter */
      for (let i = 0; i < 4; i++) {
        const a = i * Math.PI / 2 + 0.4;
        b.kasten(Math.sin(a) * 0.36, 1.4, Math.cos(a) * 0.36, 0.08, 0.28, 0.08, FARBE.fenster, a);
      }
      for (let i = 0; i < 5; i++) b.kasten(0.42, 0.35 + i * 0.22, 0.2, 0.24, 0.03, 0.03, FARBE.holz);
      break;
    }

    /* ─────────────── Mauer ─────────────── */
    case 'mauer': {
      b.kasten(0, 0.1, 0, 1.0, 0.2, 0.72, FARBE.steinDunkel);
      b.kasten(0, 0.6, 0, 0.9, 0.82, 0.58, FARBE.stein);
      /* Quaderfugen andeuten */
      for (let i = 0; i < 3; i++) {
        b.kasten(0, 0.28 + i * 0.26, 0.3, 0.92, 0.03, 0.02, FARBE.steinDunkel);
        b.kasten(0, 0.28 + i * 0.26, -0.3, 0.92, 0.03, 0.02, FARBE.steinDunkel);
      }
      b.kasten(0, 1.04, 0, 0.98, 0.09, 0.66, FARBE.steinDunkel);
      b.zinnen(0, 1.16, 0, 0.9, 0.5, FARBE.stein, 2);
      break;
    }

    /* ─────────────── Bruecke ───────────────
       Liegt auf dem Wasser, ein Feld breit: Joche, Bohlen, Gelaender.
       Der Nullpunkt liegt auf Hoehe des Wasserspiegels. */
    case 'bruecke': {
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          b.zylinder(sx * 0.34, 0.02, sz * 0.34, 0.06, 0.07, 0.5, 6, FARBE.holzDunkel);
        }
      }
      b.kasten(0, 0.28, 0, 1.04, 0.07, 0.86, FARBE.holz);
      for (let i = 0; i < 5; i++) {
        b.kasten(-0.4 + i * 0.2, 0.33, 0, 0.13, 0.04, 0.86, FARBE.holzHell);
      }
      for (const sz of [-1, 1]) {
        b.kasten(0, 0.52, sz * 0.44, 1.04, 0.05, 0.05, FARBE.holzHell);
        for (const sx of [-1, 0, 1]) b.kasten(sx * 0.42, 0.42, sz * 0.44, 0.06, 0.24, 0.06, FARBE.holzDunkel);
      }
      break;
    }

    /* ─────────────── Hafen ───────────────
       Das Bootshaus steht mit dem Ruecken zum Land (-z), davor liegt
       eine Kaimauer und ein Steg, der auf Pfaehlen ins Wasser (+z)
       hinauslaeuft. Die Simulation dreht das Ganze so, dass der Steg
       zum Wasser zeigt; darum ist das Modell nicht symmetrisch. */
    case 'hafen': {
      const halb = g / 2;                       // 1,5 Kacheln

      /* Kaimauer aus Bruchstein am Uebergang zum Wasser. */
      b.kasten(0, 0.12, 0.15, g - 0.2, 0.24, 0.5, FARBE.steinDunkel);
      for (let i = 0; i < 5; i++) {
        b.kasten(-1.1 + i * 0.55, 0.26, 0.15, 0.42, 0.08, 0.54, FARBE.stein);
      }

      /* Bootshaus: Bruchsteinsockel, verputzte Wand, Fachwerk, Satteldach. */
      b.kasten(-0.35, 0.1, -0.85, 1.7, 0.2, 1.15, FARBE.steinDunkel);
      b.kasten(-0.35, 0.62, -0.85, 1.62, 0.84, 1.05, FARBE.putz);
      b.fachwerk(-0.35, 0.62, -0.85 + 0.53, 1.62, 0.84, 1.05, 'z');
      b.giebel(-0.35, 1.04, -0.85, 1.72, 1.15, 0.62, FARBE.schindel, true);
      b.tuer(-0.35, 0.2, -0.85 + 0.53, 0.5, 0.62, 'z');
      b.fenster(-1.0, 0.78, -0.85 + 0.53, 0.22, 0.24, 'z');
      b.fenster(0.3, 0.78, -0.85 + 0.53, 0.22, 0.24, 'z');
      /* Schornstein und Wetterfahne */
      b.kasten(0.35, 1.5, -1.15, 0.16, 0.5, 0.16, FARBE.ziegel);
      b.zylinder(-0.35, 1.68, -0.85, 0.02, 0.02, 0.3, 4, FARBE.eisen);

      /* Kai davor: Bohlen quer, danach der Steg ins Wasser. */
      b.kasten(0, 0.3, 0.05, g - 0.3, 0.06, 0.7, FARBE.holz);
      for (let i = 0; i < 7; i++) {
        b.kasten(-1.2 + i * 0.4, 0.34, 0.05, 0.3, 0.03, 0.7, FARBE.holzHell);
      }
      /* Steg: schmaler Laufsteg, der ueber die Baugrenze hinausragt. */
      b.kasten(0.35, 0.3, halb + 0.35, 0.75, 0.06, 1.5, FARBE.holz);
      for (let i = 0; i < 6; i++) {
        b.kasten(0.35, 0.34, halb - 0.3 + i * 0.26, 0.75, 0.03, 0.2, FARBE.holzHell);
      }
      /* Pfaehle unter Kai und Steg, bis unter den Wasserspiegel. */
      for (const [px, pz] of [[-1.2, 0.35], [-0.4, 0.35], [0.4, 0.35], [1.2, 0.35],
                              [0.05, halb + 0.2], [0.65, halb + 0.2],
                              [0.05, halb + 1.0], [0.65, halb + 1.0]]) {
        b.zylinder(px, -0.05, pz, 0.06, 0.07, 0.75, 6, FARBE.holzDunkel);
      }
      /* Poller mit Tau */
      for (const px of [-1.25, 1.25]) {
        b.zylinder(px, 0.42, 0.35, 0.07, 0.08, 0.24, 6, FARBE.holzDunkel);
        b.kugel(px, 0.55, 0.35, 0.07, FARBE.holz, 6);
      }

      /* Ladekran am Kai: Mast, Ausleger, Seil, Haken. */
      b.zylinder(-1.35, 0.75, 0.25, 0.08, 0.1, 0.9, 7, FARBE.holz);
      b.kasten(-1.35, 1.2, 0.25, 0.09, 0.09, 0.09, FARBE.eisen);
      b.kasten(-1.05, 1.16, 0.25, 0.7, 0.08, 0.08, FARBE.holz, 0, 0, 0.25);
      b.zylinder(-0.75, 0.95, 0.25, 0.012, 0.012, 0.42, 4, FARBE.eisen);
      b.kasten(-0.75, 0.72, 0.25, 0.18, 0.14, 0.18, FARBE.holzDunkel);

      /* Fischerkram: Kisten, Faesser, Netz, Ruder, Bojen. */
      b.kasten(0.95, 0.42, -0.15, 0.3, 0.18, 0.24, FARBE.holzHell);
      b.kasten(0.95, 0.6, -0.15, 0.26, 0.16, 0.2, FARBE.holzHell);
      b.kasten(1.25, 0.42, 0.15, 0.26, 0.18, 0.22, FARBE.holz);
      b.fass(-0.95, 0.44, -0.1, 0.13, 0.28);
      b.fass(-0.7, 0.38, 0.05, 0.12, 0.26, true);
      b.halbkugel(-1.3, 0.35, -0.25, 0.2, 0x8a8f6a, 7);
      b.kasten(1.15, 0.62, -0.35, 0.05, 0.05, 0.9, FARBE.holzHell, 0, 0.4, 0);
      for (const [bx, bz] of [[-0.15, halb + 1.2], [0.85, halb + 0.9]]) {
        b.kugel(bx, 0.06, bz, 0.09, FARBE.ziegel, 6);
      }

      /* Wimpel am Giebel — der Hafen gehoert sichtbar jemandem. */
      b.wimpel(-1.35, 0.3, -1.3, 0.95);
      break;
    }

    /* ─────────────── Tor ─────────────── */
    case 'tor': {
      for (const sx of [-1, 1]) {
        b.kasten(sx * 0.42, 0.66, 0, 0.24, 1.32, 0.74, FARBE.stein);
        b.zinnen(sx * 0.42, 1.36, 0, 0.28, 0.7, FARBE.steinDunkel, 1);
      }
      b.kasten(0, 1.24, 0, 1.1, 0.24, 0.74, FARBE.stein);
      b.zylinder(0, 1.12, 0, 0.34, 0.34, 0.76, 10, FARBE.steinDunkel, Math.PI / 2);
      /* Zwei Torfluegel in Spielerfarbe mit Eisenbeschlag */
      for (const sx of [-1, 1]) {
        b.kasten(sx * 0.15, 0.55, 0, 0.3, 1.1, 0.1, null);
        b.kasten(sx * 0.15, 0.8, 0.06, 0.28, 0.06, 0.03, FARBE.eisen);
        b.kasten(sx * 0.15, 0.35, 0.06, 0.28, 0.06, 0.03, FARBE.eisen);
      }
      break;
    }

    default: {
      b.kasten(0, 0.4, 0, g - 0.5, 0.8, g - 0.5, FARBE.stein);
      b.dach(0, 0.8, 0, g - 0.4, 0.5, null);
    }
  }

  const modell = b.fertig();
  gebaeudeSpeicher.set(schluessel, modell);
  return modell;
}

/* ═══════════════ Einheiten ═══════════════
   Eine Figur ist rund 0,62 Kacheln hoch (die Darstellung
   vergroessert sie noch etwas). Rumpf und Kopfbedeckung tragen die
   Spielerfarbe, Haut, Holz, Leder und Metall bleiben neutral. */

const einheitSpeicher = new Map();

/** Grundgestalt eines Menschen mit Beinen, Rumpf, Armen und Kopf. */
function mensch(b, o) {
  o = o || {};
  const h = o.gross ? 0.66 : 0.58;
  const kopfHoehe = h * 0.8;

  /* Beine mit Stiefeln */
  for (const s of [-1, 1]) {
    b.kasten(0, h * 0.16, s * 0.07, 0.09, h * 0.32, 0.09, o.hose || FARBE.leder);
    b.kasten(0.02, h * 0.03, s * 0.07, 0.13, h * 0.07, 0.1, FARBE.holzDunkel);
  }
  /* Rumpf in Spielerfarbe, mit Guertel */
  b.kasten(0, h * 0.5, 0, 0.26, h * 0.42, 0.18, null);
  b.kasten(0, h * 0.33, 0, 0.27, 0.05, 0.19, FARBE.leder);
  if (o.panzer) {
    b.kasten(0, h * 0.56, 0, 0.28, h * 0.24, 0.2, FARBE.eisen);
    b.kasten(0, h * 0.68, 0, 0.32, 0.06, 0.22, FARBE.metall);
  }
  if (o.umhang) {
    b.kasten(0, h * 0.5, -0.11, 0.28, h * 0.5, 0.04, null);
  }
  /* Arme */
  for (const s of [-1, 1]) {
    b.kasten(s * 0.17, h * 0.52, 0, 0.08, h * 0.34, 0.09, o.aermel || null);
    b.kugel(s * 0.17, h * 0.35, 0.02, 0.045, FARBE.haut, 6);
  }
  /* Kopf */
  b.zylinder(0, kopfHoehe, 0, 0.085, 0.085, 0.11, 7, FARBE.haut);
  b.kugel(0, kopfHoehe + 0.05, 0, 0.085, FARBE.haut, 7);
  if (o.helm === 'topf') {
    b.zylinder(0, kopfHoehe + 0.06, 0, 0.1, 0.1, 0.14, 8, FARBE.metall);
    b.kasten(0, kopfHoehe + 0.06, 0.09, 0.05, 0.09, 0.03, FARBE.fenster);
  } else if (o.helm === 'kappe') {
    b.halbkugel(0, kopfHoehe + 0.04, 0, 0.1, FARBE.metall, 8);
    b.zylinder(0, kopfHoehe + 0.03, 0, 0.11, 0.11, 0.03, 8, FARBE.eisen);
  } else if (o.helm === 'hut') {
    b.zylinder(0, kopfHoehe + 0.03, 0, 0.16, 0.16, 0.03, 8, null);
    b.halbkugel(0, kopfHoehe + 0.04, 0, 0.09, null, 7);
  } else if (o.helm === 'kapuze') {
    b.halbkugel(0, kopfHoehe + 0.03, 0, 0.11, null, 8);
    b.kasten(0, kopfHoehe + 0.02, -0.06, 0.16, 0.14, 0.08, null);
  } else {
    b.halbkugel(0, kopfHoehe + 0.045, 0, 0.088, o.haar || 0x6b4a2a, 7);
  }
  return h;
}

/** Rundschild am linken Arm. */
function schild(b, h, art) {
  if (art === 'rund') {
    b.zylinder(-0.21, h * 0.5, 0.06, 0.15, 0.15, 0.04, 10, null, Math.PI / 2);
    b.zylinder(-0.21, h * 0.5, 0.09, 0.05, 0.05, 0.03, 8, FARBE.metall, Math.PI / 2);
  } else {
    b.kasten(-0.21, h * 0.5, 0.06, 0.05, 0.26, 0.2, null);
    b.kasten(-0.23, h * 0.5, 0.06, 0.02, 0.04, 0.18, FARBE.metall);
  }
}

/** Pferd mit Sattel, Mähne und Schweif. */
function pferd(b, farbe) {
  const fell = farbe || 0x6b4a2a;
  b.kasten(0, 0.36, 0, 0.54, 0.24, 0.22, fell);
  b.kasten(-0.24, 0.36, 0, 0.14, 0.26, 0.2, fell);        // Kruppe
  b.kasten(0.27, 0.44, 0, 0.16, 0.3, 0.17, fell, 0, 0, -0.25);   // Hals
  b.kasten(0.37, 0.58, 0, 0.22, 0.14, 0.14, fell);        // Kopf
  b.kasten(0.46, 0.55, 0, 0.09, 0.1, 0.11, 0x4a3520);     // Maul
  for (const s of [-1, 1]) b.kegel(0.33, 0.68, s * 0.05, 0.035, 0.09, 4, fell);   // Ohren
  /* Maehne und Schweif */
  for (let i = 0; i < 4; i++) b.kasten(0.24 - i * 0.05, 0.56 - i * 0.02, 0, 0.05, 0.11, 0.07, 0x3a2a18);
  b.kasten(-0.32, 0.4, 0, 0.1, 0.22, 0.06, 0x3a2a18, 0, 0, 0.5);
  /* Beine mit Hufen */
  for (const [dx, dz] of [[-0.18, -0.09], [-0.18, 0.09], [0.19, -0.09], [0.19, 0.09]]) {
    b.kasten(dx, 0.15, dz, 0.075, 0.3, 0.075, fell);
    b.kasten(dx, 0.02, dz, 0.085, 0.05, 0.085, 0x2f2620);
  }
  /* Sattel und Decke in Spielerfarbe */
  b.kasten(0, 0.5, 0, 0.34, 0.05, 0.28, null);
  b.kasten(0.02, 0.54, 0, 0.2, 0.06, 0.22, FARBE.leder);
  b.kasten(0.14, 0.52, 0, 0.05, 0.09, 0.2, FARBE.leder);
}

/**
 * Schiffsrumpf in Klinkerbauweise: Kiel, drei Plankengaenge je Seite,
 * die nach oben ausstellen, Vordersteven, Heckspiegel und ein
 * Seitenruder. Alle Masse in Kacheln; das Boot zeigt nach +x.
 */
function rumpf(b, laenge, breite, farbe, dunkel) {
  const rand = dunkel || FARBE.holzDunkel;
  /* Kiel und Boden */
  b.kasten(0, 0.05, 0, laenge * 0.94, 0.08, breite * 0.82, farbe);
  b.kasten(0, -0.01, 0, laenge, 0.05, breite * 0.3, rand);
  /* Plankengaenge: jeder liegt etwas hoeher und weiter aussen. */
  for (let i = 0; i < 3; i++) {
    const y = 0.11 + i * 0.07;
    const w = breite * (0.84 + i * 0.09);
    const l = laenge * (0.94 - i * 0.03);
    for (const sz of [-1, 1]) {
      b.kasten(0, y, sz * w / 2, l, 0.075, 0.045, i === 2 ? rand : farbe);
    }
  }
  /* Spanten innen */
  for (let i = -1; i <= 1; i++) {
    b.kasten(i * laenge * 0.26, 0.16, 0, 0.05, 0.16, breite * 0.86, rand);
  }
  /* Vordersteven: ansteigender Keil statt stumpfer Nase. */
  b.kegel(laenge / 2 - 0.02, 0.1, 0, breite * 0.42, laenge * 0.26, 4, farbe, 0, -Math.PI / 2);
  b.kasten(laenge / 2 - 0.03, 0.24, 0, 0.07, 0.26, 0.06, rand, 0, 0, -0.35);
  /* Heckspiegel mit Ruderpinne */
  b.kasten(-laenge / 2 + 0.05, 0.18, 0, 0.07, 0.26, breite * 0.86, farbe);
  b.kasten(-laenge / 2 + 0.02, 0.06, breite * 0.44, 0.05, 0.22, 0.03, rand, 0, 0, 0.3);
  b.kasten(-laenge / 2 + 0.08, 0.3, breite * 0.4, 0.16, 0.03, 0.03, FARBE.holzHell);
}

export function einheitModell(typ) {
  if (einheitSpeicher.has(typ)) return einheitSpeicher.get(typ);
  const b = new Bau();

  switch (typ) {
    case 'dorfbewohner': {
      const h = mensch(b, { helm: 'hut', hose: 0x6b5a3a });
      /* Axt in der Hand */
      b.zylinder(0.19, h * 0.42, 0.08, 0.022, 0.022, 0.38, 5, FARBE.holz, 0, 0.25);
      b.kasten(0.24, h * 0.66, 0.08, 0.14, 0.1, 0.04, FARBE.metall, 0, 0, 0.25);
      b.kasten(0.19, h * 0.63, 0.08, 0.05, 0.07, 0.05, FARBE.eisen);
      /* Beutel am Guertel */
      b.halbkugel(-0.14, h * 0.3, 0.09, 0.07, FARBE.leder, 6);
      break;
    }

    case 'milizionaer': {
      const h = mensch(b, { gross: true, helm: 'kappe', panzer: true });
      b.zylinder(0.2, h * 0.44, 0.06, 0.025, 0.025, 0.3, 5, FARBE.holz);
      b.kasten(0.2, h * 0.68, 0.06, 0.16, 0.11, 0.05, FARBE.metall);
      b.kasten(0.2, h * 0.62, 0.06, 0.06, 0.08, 0.06, FARBE.eisen);
      schild(b, h, 'rund');
      break;
    }

    case 'speer': {
      const h = mensch(b, { gross: true, helm: 'kappe' });
      b.zylinder(0.18, h * 0.55, 0.07, 0.022, 0.022, 0.95, 5, FARBE.holz);
      b.kegel(0.18, h * 0.55 + 0.55, 0.07, 0.05, 0.16, 5, FARBE.metall);
      b.kasten(0.18, h * 0.55 + 0.42, 0.07, 0.1, 0.03, 0.03, FARBE.eisen);
      schild(b, h, 'lang');
      break;
    }

    case 'bogen': case 'langbogen': {
      const lang = typ === 'langbogen';
      const h = mensch(b, { helm: lang ? 'hut' : null, haar: 0x8a6134 });
      const bl = lang ? 0.66 : 0.5;
      /* Bogen als drei geneigte Segmente statt gerader Stange */
      b.zylinder(0.2, h * 0.5, 0.1, 0.02, 0.02, bl * 0.5, 5, FARBE.holz, 0, 0.12);
      b.zylinder(0.22, h * 0.5 + bl * 0.35, 0.1, 0.016, 0.02, bl * 0.32, 5, FARBE.holz, 0, 0.5);
      b.zylinder(0.22, h * 0.5 - bl * 0.35, 0.1, 0.02, 0.016, bl * 0.32, 5, FARBE.holz, 0, -0.5);
      b.zylinder(0.17, h * 0.5, 0.1, 0.005, 0.005, bl * 0.95, 4, FARBE.stoff);
      /* Koecher auf dem Ruecken */
      b.zylinder(-0.13, h * 0.55, -0.1, 0.05, 0.055, 0.26, 7, FARBE.leder, 0, 0.35);
      for (let i = 0; i < 3; i++) b.zylinder(-0.13 + i * 0.02, h * 0.72, -0.1, 0.008, 0.008, 0.12, 4, FARBE.stoff, 0, 0.35);
      break;
    }

    case 'plaenkler': {
      const h = mensch(b, { helm: 'kappe', hose: 0x5a4a30 });
      b.zylinder(0.2, h * 0.55, 0.08, 0.02, 0.02, 0.52, 5, FARBE.holz, 0, 0.45);
      b.kegel(0.32, h * 0.78, 0.08, 0.04, 0.12, 4, FARBE.metall, 0, 0.45);
      /* Buendel Wurfspeere auf dem Ruecken */
      for (let i = 0; i < 3; i++) {
        b.zylinder(-0.14, h * 0.55, -0.09 + i * 0.03, 0.014, 0.014, 0.42, 4, FARBE.holz, 0, -0.3);
      }
      schild(b, h, 'rund');
      break;
    }

    case 'ritter': case 'kataphrakt': {
      pferd(b, typ === 'kataphrakt' ? 0x4a4a52 : 0x6b4a2a);
      /* Reiter in Ruestung */
      b.kasten(0, 0.66, 0, 0.24, 0.3, 0.18, null);
      b.kasten(0, 0.7, 0, 0.27, 0.2, 0.2, FARBE.eisen);
      b.kasten(0, 0.62, -0.1, 0.26, 0.34, 0.04, null);          // Umhang
      for (const s of [-1, 1]) b.kasten(s * 0.16, 0.68, 0, 0.07, 0.24, 0.08, FARBE.eisen);
      b.zylinder(0, 0.86, 0, 0.08, 0.08, 0.1, 7, FARBE.haut);
      b.zylinder(0, 0.94, 0, 0.095, 0.095, 0.13, 8, FARBE.metall);
      b.kasten(0, 0.94, 0.085, 0.05, 0.08, 0.03, FARBE.fenster);
      b.kegel(0, 1.06, 0, 0.05, 0.12, 5, null);                 // Helmbusch
      /* Lanze */
      b.zylinder(0.2, 0.72, 0.12, 0.022, 0.028, 0.95, 6, FARBE.holz, 0, 1.15);
      b.kegel(0.62, 0.98, 0.12, 0.045, 0.16, 5, FARBE.metall, 0, 1.15);
      b.kasten(0.28, 0.78, 0.12, 0.08, 0.09, 0.03, null);       // Wimpel
      schild(b, 1.3, 'lang');
      break;
    }

    case 'spaeher': {
      pferd(b, 0x8a6b42);
      b.kasten(0, 0.66, 0, 0.22, 0.28, 0.17, null);
      b.zylinder(0, 0.84, 0, 0.08, 0.08, 0.1, 7, FARBE.haut);
      b.zylinder(0, 0.92, 0, 0.15, 0.15, 0.03, 8, null);        // Breiter Hut
      b.halbkugel(0, 0.93, 0, 0.085, null, 7);
      for (const s of [-1, 1]) b.kasten(s * 0.15, 0.68, 0, 0.065, 0.22, 0.07, FARBE.haut);
      b.zylinder(0.18, 0.72, 0.1, 0.02, 0.02, 0.5, 5, FARBE.holz, 0, 0.5);
      b.kasten(-0.2, 0.6, 0.06, 0.1, 0.14, 0.1, FARBE.leder);   // Satteltasche
      break;
    }

    case 'mangudai': {
      pferd(b, 0x7a5c38);
      b.kasten(0, 0.66, 0, 0.22, 0.28, 0.17, null);
      b.zylinder(0, 0.84, 0, 0.08, 0.08, 0.1, 7, FARBE.haut);
      b.kegel(0, 0.95, 0, 0.12, 0.16, 6, null);                 // Spitzhut
      b.zylinder(0, 0.88, 0, 0.13, 0.13, 0.04, 8, FARBE.leder);
      /* Reflexbogen quer vor dem Koerper */
      b.zylinder(0.16, 0.68, 0.14, 0.018, 0.018, 0.24, 5, FARBE.holz, 0.6, 0.3);
      b.zylinder(0.16, 0.68, -0.14, 0.018, 0.018, 0.24, 5, FARBE.holz, -0.6, 0.3);
      b.zylinder(-0.12, 0.7, -0.1, 0.05, 0.05, 0.22, 6, FARBE.leder, 0, 0.3);
      break;
    }

    case 'wurfaxt': {
      const h = mensch(b, { gross: true, helm: 'kappe', panzer: true });
      /* Wurfaxt in der erhobenen Hand */
      b.zylinder(0.22, h * 0.72, 0.06, 0.02, 0.02, 0.24, 5, FARBE.holz, 0, -0.5);
      b.kasten(0.3, h * 0.82, 0.06, 0.13, 0.12, 0.04, FARBE.metall, 0, 0, -0.5);
      /* Zweite Axt am Guertel */
      b.zylinder(-0.16, h * 0.3, 0.08, 0.016, 0.016, 0.18, 4, FARBE.holz, 0, 0.3);
      b.kasten(-0.2, h * 0.22, 0.08, 0.1, 0.08, 0.03, FARBE.eisen);
      schild(b, h, 'rund');
      break;
    }

    case 'moench': {
      /* Kutte statt Beinen, Kapuze, Kreuzstab, Buch */
      b.kegel(0, 0.27, 0, 0.22, 0.54, 9, null);
      b.zylinder(0, 0.5, 0, 0.16, 0.2, 0.14, 9, null);
      b.kasten(0, 0.36, 0, 0.24, 0.05, 0.2, FARBE.stroh);       // Strick
      b.zylinder(0, 0.58, 0, 0.075, 0.075, 0.1, 7, FARBE.haut);
      b.halbkugel(0, 0.62, 0, 0.1, null, 8);
      b.kasten(0, 0.6, -0.07, 0.16, 0.16, 0.09, null);          // Kapuze hinten
      b.zylinder(0.16, 0.42, 0.04, 0.02, 0.02, 0.62, 5, FARBE.holz);
      b.kasten(0.16, 0.74, 0.04, 0.03, 0.16, 0.03, FARBE.gold);
      b.kasten(0.16, 0.78, 0.04, 0.12, 0.03, 0.03, FARBE.gold);
      b.kasten(-0.15, 0.45, 0.06, 0.1, 0.13, 0.05, 0x8a3b2f);   // Buch
      break;
    }

    case 'ramme': {
      /* Schutzdach auf Raedern, Stamm an Ketten */
      b.kasten(0, 0.16, 0, 1.0, 0.12, 0.6, FARBE.holzDunkel);
      for (const [dx, dz] of [[-0.4, -0.3], [-0.4, 0.3], [0.4, -0.3], [0.4, 0.3]]) {
        b.kasten(dx, 0.5, dz, 0.1, 0.7, 0.1, FARBE.holz);
      }
      b.kasten(0, 0.86, 0, 1.05, 0.08, 0.66, FARBE.holz);
      b.giebel(0, 0.9, 0, 1.0, 0.62, 0.42, null);
      /* Rammbock */
      b.zylinder(0, 0.46, 0, 0.13, 0.13, 1.15, 8, FARBE.holzHell, 0, Math.PI / 2);
      b.zylinder(0.62, 0.46, 0, 0.16, 0.16, 0.16, 8, FARBE.eisen, 0, Math.PI / 2);
      b.kegel(0.74, 0.46, 0, 0.15, 0.14, 8, FARBE.metall, 0, -Math.PI / 2);
      for (const dx of [-0.3, 0.3]) {
        b.kasten(dx, 0.68, 0, 0.03, 0.36, 0.03, FARBE.eisen);
      }
      /* Raeder */
      for (const [dx, dz] of [[-0.34, -0.3], [-0.34, 0.3], [0.34, -0.3], [0.34, 0.3]]) {
        b.zylinder(dx, 0.13, dz, 0.14, 0.14, 0.09, 9, FARBE.holzDunkel, Math.PI / 2);
        b.zylinder(dx, 0.13, dz, 0.05, 0.05, 0.11, 6, FARBE.eisen, Math.PI / 2);
      }
      break;
    }

    case 'mangonel': {
      b.kasten(0, 0.18, 0, 0.8, 0.12, 0.56, FARBE.holzDunkel);
      for (const dz of [-0.22, 0.22]) {
        b.kasten(-0.1, 0.44, dz, 0.09, 0.62, 0.09, FARBE.holz, 0, 0, 0.3);
        b.kasten(0.25, 0.3, dz, 0.09, 0.34, 0.09, FARBE.holz, 0, 0, -0.4);
      }
      b.kasten(-0.02, 0.74, 0, 0.12, 0.1, 0.52, FARBE.balken);
      /* Wurfarm mit Schale */
      b.kasten(0.16, 0.5, 0, 0.62, 0.08, 0.08, FARBE.holzHell, 0, 0, -0.55);
      b.halbkugel(0.42, 0.68, 0, 0.13, FARBE.leder, 7);
      b.kugel(0.42, 0.72, 0, 0.1, FARBE.stein, 6);
      /* Spannseil und Winde */
      b.zylinder(-0.3, 0.3, 0, 0.07, 0.07, 0.5, 7, FARBE.holzDunkel, Math.PI / 2);
      b.kasten(-0.3, 0.3, 0.28, 0.16, 0.03, 0.03, FARBE.holz);
      for (const [dx, dz] of [[-0.28, -0.26], [-0.28, 0.26], [0.28, -0.26], [0.28, 0.26]]) {
        b.zylinder(dx, 0.13, dz, 0.13, 0.13, 0.08, 9, FARBE.holzDunkel, Math.PI / 2);
      }
      b.kasten(0, 0.26, 0, 0.34, 0.08, 0.44, null);
      break;
    }

    case 'trebuchet': {
      b.kasten(0, 0.1, 0, 0.9, 0.12, 0.8, FARBE.holzDunkel);
      /* A-Boecke */
      for (const dz of [-0.3, 0.3]) {
        b.kasten(-0.18, 0.66, dz, 0.09, 1.2, 0.09, FARBE.holz, 0, 0, 0.28);
        b.kasten(0.18, 0.66, dz, 0.09, 1.2, 0.09, FARBE.holz, 0, 0, -0.28);
      }
      b.kasten(0, 1.22, 0, 0.14, 0.1, 0.72, FARBE.balken);
      /* Wurfarm mit Gegengewicht */
      b.kasten(0.1, 1.05, 0, 1.5, 0.09, 0.09, FARBE.holzHell, 0, 0, -0.42);
      b.kasten(-0.5, 0.78, 0, 0.28, 0.3, 0.3, FARBE.stein);
      b.kasten(-0.5, 0.78, 0, 0.31, 0.06, 0.32, FARBE.eisen);
      b.zylinder(0.72, 1.36, 0, 0.012, 0.012, 0.4, 4, FARBE.stoff);
      b.halbkugel(0.72, 1.16, 0, 0.12, FARBE.leder, 7);
      /* Fussstreben und Leiter */
      for (const s of [-1, 1]) b.kasten(s * 0.45, 0.2, 0, 0.08, 0.2, 0.7, FARBE.holzDunkel);
      for (let i = 0; i < 4; i++) b.kasten(-0.4, 0.3 + i * 0.2, 0.42, 0.22, 0.03, 0.03, FARBE.holz);
      b.kasten(0, 0.2, 0, 0.4, 0.1, 0.5, null);
      break;
    }

    /* ── Schiffe ──
       Rumpf aus zwei Haelften, Bordwand, Steven — dazu, was das
       Schiff ausmacht: Netz, Ladung oder Segel. */
    /* ── Fischerboot: kleiner Kahn mit Netz, Reusen und Fang ── */
    case 'fischerboot': {
      rumpf(b, 0.9, 0.34, FARBE.holz);
      /* Ducht (Sitzbank) und Bodenbretter */
      b.kasten(0.02, 0.17, 0, 0.52, 0.04, 0.26, FARBE.holzHell);
      b.kasten(0.16, 0.26, 0, 0.06, 0.05, 0.3, FARBE.holzHell);
      /* Kurzer Mast mit Luggersegel */
      b.zylinder(-0.02, 0.42, 0, 0.018, 0.024, 0.56, 5, FARBE.holzDunkel);
      b.kasten(-0.02, 0.62, 0, 0.02, 0.02, 0.3, FARBE.holzDunkel, 0, 0, 0.2);
      b.kasten(-0.02, 0.46, 0.09, 0.015, 0.3, 0.24, FARBE.stoff);
      /* Wimpel in Spielerfarbe — daran erkennt man den Besitzer. */
      b.kasten(-0.02, 0.68, -0.06, 0.012, 0.06, 0.12, null);
      /* Netz ueber dem Heck, Schwimmer daran */
      b.halbkugel(-0.3, 0.2, 0, 0.13, 0x8a8f6a, 7);
      for (const sz of [-1, 1]) b.kugel(-0.34, 0.28, sz * 0.1, 0.035, FARBE.ziegel, 5);
      /* Reuse und Fangkiste am Bug */
      b.zylinder(0.3, 0.24, 0.08, 0.06, 0.07, 0.16, 6, 0x8a8f6a, Math.PI / 2);
      b.kasten(0.3, 0.24, -0.07, 0.16, 0.12, 0.13, FARBE.holzHell);
      /* Zwei Ruder laengs an Bord */
      for (const sz of [-1, 1]) {
        b.zylinder(-0.05, 0.29, sz * 0.14, 0.012, 0.012, 0.5, 4, FARBE.holzHell, 0, 0, Math.PI / 2);
      }
      break;
    }
    /* ── Transporter: breiter Prahm mit Rahsegel und Ladung ── */
    case 'transporter': {
      rumpf(b, 1.1, 0.46, FARBE.holz);
      b.kasten(0, 0.2, 0, 0.84, 0.05, 0.4, FARBE.holzHell);
      /* Ladung: Kisten, Faesser, Heuballen */
      b.kasten(-0.18, 0.33, -0.06, 0.24, 0.2, 0.22, FARBE.holzDunkel);
      b.kasten(-0.2, 0.51, -0.06, 0.2, 0.16, 0.18, FARBE.holzHell);
      b.kasten(0.16, 0.31, 0.1, 0.2, 0.16, 0.18, FARBE.holzDunkel);
      b.fass(0.14, 0.28, -0.12, 0.09, 0.2);
      b.fass(-0.02, 0.24, 0.14, 0.08, 0.18, true);
      /* Mast mit Rahsegel in Spielerfarbe, Wanten nach achtern */
      b.zylinder(0.04, 0.56, 0, 0.026, 0.032, 0.74, 6, FARBE.holzDunkel);
      b.kasten(0.04, 0.86, 0, 0.03, 0.03, 0.46, FARBE.holzDunkel);
      b.kasten(0.04, 0.68, 0, 0.02, 0.34, 0.42, null);
      for (const sz of [-1, 1]) {
        b.zylinder(-0.16, 0.5, sz * 0.12, 0.008, 0.008, 0.78, 4, FARBE.leder, sz * 0.28, 0, 0.42);
      }
      /* Landungssteg am Bug, den man herunterlaesst */
      b.kasten(0.5, 0.24, 0, 0.3, 0.04, 0.26, FARBE.holzHell, 0, 0, -0.28);
      break;
    }
    /* ── Galeere: Kriegsschiff mit Ruderbank und Rammsporn ── */
    case 'galeere': {
      rumpf(b, 1.25, 0.4, FARBE.holzDunkel, 0x33220f);
      b.kasten(0, 0.22, 0, 0.94, 0.05, 0.32, FARBE.holz);
      /* Ruderbaenke und Riemen an beiden Seiten */
      for (let i = 0; i < 5; i++) {
        const x = -0.38 + i * 0.19;
        b.kasten(x, 0.27, 0, 0.05, 0.05, 0.3, FARBE.holzHell);
        for (const sz of [-1, 1]) {
          b.zylinder(x - 0.06, 0.14, sz * 0.28, 0.014, 0.014, 0.36, 4, FARBE.holzHell, sz * 0.85, 0);
        }
      }
      /* Mast mit Segel in Spielerfarbe, Ausguck oben */
      b.zylinder(-0.08, 0.6, 0, 0.028, 0.035, 0.8, 6, FARBE.holzDunkel);
      b.kasten(-0.08, 0.92, 0, 0.03, 0.03, 0.48, FARBE.holzDunkel);
      b.kasten(-0.08, 0.72, 0, 0.02, 0.36, 0.44, null);
      b.zylinder(-0.08, 1.02, 0, 0.09, 0.08, 0.12, 7, FARBE.holz);
      /* Rammsporn mit Eisenbeschlag */
      b.kegel(0.72, 0.1, 0, 0.07, 0.26, 5, FARBE.eisen, 0, -Math.PI / 2);
      b.kasten(0.58, 0.14, 0, 0.12, 0.05, 0.1, FARBE.eisen);
      /* Schuetzenstand vorn, Schilde laengs der Bordwand */
      b.kasten(0.42, 0.33, 0, 0.22, 0.16, 0.24, FARBE.holz);
      b.zinnen(0.42, 0.41, 0, 0.24, 0.26, FARBE.holzHell, 2);
      for (let i = 0; i < 4; i++) {
        for (const sz of [-1, 1]) {
          b.zylinder(-0.3 + i * 0.2, 0.32, sz * 0.21, 0.06, 0.06, 0.02, 7, null, 0, Math.PI / 2);
        }
      }
      break;
    }

    default:
      mensch(b, {});
  }

  const modell = b.fertig();
  einheitSpeicher.set(typ, modell);
  return modell;
}
