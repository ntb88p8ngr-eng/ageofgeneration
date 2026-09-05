/* ═══════════════════════════════════════════════════════════
   REICH DER ZEITALTER — Zufall und Ganzzahl-Mathematik

   Alles, was die Simulation rechnet, muss auf jedem Rechner
   Zeichen fuer Zeichen dasselbe ergeben — sonst laufen die
   Partien im Mehrspieler auseinander. Deshalb:

     * ein eigener Zufallsgenerator mit ganzzahligem Zustand
       (kein Math.random — das ist auf jedem Rechner anders),
     * Wurzel und Abstand als Ganzzahl,
     * keine Winkelfunktionen in der Simulation.
   ═══════════════════════════════════════════════════════════ */
'use strict';

/** xorshift128 — schnell, ganzzahlig, ueberall gleich. */
export class Zufall {
  constructor(saat) {
    let s = (saat | 0) || 0x1a2b3c4d;
    /* Aus einer Zahl vier Startzustaende machen (splitmix-artig). */
    this.a = this._streu(s ^ 0x9e3779b9);
    this.b = this._streu(this.a ^ 0x85ebca6b);
    this.c = this._streu(this.b ^ 0xc2b2ae35);
    this.d = this._streu(this.c ^ 0x27d4eb2f);
    for (let i = 0; i < 12; i++) this.next();
  }
  _streu(x) {
    x = x | 0;
    x = Math.imul(x ^ (x >>> 16), 0x21f0aaad);
    x = Math.imul(x ^ (x >>> 15), 0x735a2d97);
    x = x ^ (x >>> 15);
    return x | 0 || 0x6d2b79f5;
  }
  /** Naechste Zahl, 0 … 2^32-1. */
  next() {
    let t = this.d | 0;
    const s = this.a | 0;
    this.d = this.c | 0;
    this.c = this.b | 0;
    this.b = s;
    t ^= t << 11; t ^= t >>> 8;
    this.a = (t ^ s ^ (s >>> 19)) | 0;
    return this.a >>> 0;
  }
  /** 0 … n-1 */
  bis(n) { return n <= 0 ? 0 : this.next() % n; }
  /** a … b (beide einschliesslich) */
  bereich(a, b) { return b <= a ? a : a + this.bis(b - a + 1); }
  /** Trifft mit p Prozent zu. */
  chance(p) { return this.bis(100) < p; }
  /** Ein zufaelliges Element (leeres Feld → undefined). */
  aus(liste) { return liste.length ? liste[this.bis(liste.length)] : undefined; }
  /** Mischt an Ort und Stelle (Fisher-Yates, deterministisch). */
  mische(liste) {
    for (let i = liste.length - 1; i > 0; i--) {
      const j = this.bis(i + 1);
      const t = liste[i]; liste[i] = liste[j]; liste[j] = t;
    }
    return liste;
  }
  /** Zustand sichern/wiederherstellen — fuer Pruefsummen und Replays. */
  zustand() { return [this.a | 0, this.b | 0, this.c | 0, this.d | 0]; }
  setze(z) { this.a = z[0] | 0; this.b = z[1] | 0; this.c = z[2] | 0; this.d = z[3] | 0; }
}

/** Ganzzahlige Quadratwurzel (abgerundet). */
export function iwurzel(n) {
  if (n <= 0) return 0;
  if (n < 0x40000000) {
    /* Klein genug: Math.sqrt ist hier exakt genug und wird gerundet. */
    let x = Math.floor(Math.sqrt(n));
    while (x * x > n) x--;
    while ((x + 1) * (x + 1) <= n) x++;
    return x;
  }
  let x = n, y = ((x + 1) / 2) | 0;
  while (y < x) { x = y; y = ((x + (n / x)) / 2) | 0; }
  return x;
}

/** Abstand zweier Punkte, alles in Fixpunkt. */
export function abstand(x1, y1, x2, y2) {
  const dx = x1 - x2, dy = y1 - y2;
  return iwurzel(dx * dx + dy * dy);
}

/** Quadrat des Abstands — fuer Vergleiche, spart die Wurzel. */
export function abstand2(x1, y1, x2, y2) {
  const dx = x1 - x2, dy = y1 - y2;
  return dx * dx + dy * dy;
}

/** Begrenzt auf [a, b]. */
export function klemme(v, a, b) { return v < a ? a : (v > b ? b : v); }

/** Ortsfester Rauschwert 0 … 65535 aus Gitterpunkt und Saat. */
export function punktrausch(x, y, saat) {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ (saat | 0);
  h = Math.imul(h ^ (h >>> 15), 0x2545f491);
  h ^= h >>> 13;
  return (h >>> 16) & 0xffff;
}

/**
 * Weiches Wertrauschen ueber ein Gitter: fuer Hoehen und
 * Bodenarten. Rechnet in Ganzzahlen (0 … 65535) und mischt
 * mehrere Feinheitsstufen (Oktaven).
 */
export function rauschfeld(breite, hoehe, saat, stufen, grundweite) {
  const feld = new Int32Array(breite * hoehe);
  let weite = grundweite, staerke = 1 << 16, summe = 0;
  for (let s = 0; s < stufen; s++) {
    const gb = Math.ceil(breite / weite) + 2, gh = Math.ceil(hoehe / weite) + 2;
    const gitter = new Int32Array(gb * gh);
    for (let i = 0; i < gitter.length; i++) {
      gitter[i] = punktrausch(i % gb, (i / gb) | 0, saat + s * 7919);
    }
    for (let y = 0; y < hoehe; y++) {
      const gy = (y / weite) | 0, fy = y - gy * weite;
      const ty = Math.round(fy * 65536 / weite);
      /* weiche Blende (3t² − 2t³), damit die Kanten nicht sichtbar bleiben */
      const wy = blende(ty);
      for (let x = 0; x < breite; x++) {
        const gx = (x / weite) | 0, fx = x - gx * weite;
        const wx = blende(Math.round(fx * 65536 / weite));
        const a = gitter[gy * gb + gx], b = gitter[gy * gb + gx + 1];
        const c = gitter[(gy + 1) * gb + gx], d = gitter[(gy + 1) * gb + gx + 1];
        const o = a + (((b - a) * wx) >> 16);
        const u = c + (((d - c) * wx) >> 16);
        const v = o + (((u - o) * wy) >> 16);
        feld[y * breite + x] += (v * staerke) >> 16;
      }
    }
    summe += staerke;
    staerke = staerke >> 1;
    weite = Math.max(2, weite >> 1);
  }
  /* auf 0 … 65535 normieren */
  for (let i = 0; i < feld.length; i++) feld[i] = Math.round(feld[i] * 65536 / summe);
  return feld;
}

function blende(t) {
  /* 3t² − 2t³ in Festkomma (t = 0 … 65536) */
  const t2 = (t * t) >> 16;
  const t3 = (t2 * t) >> 16;
  return klemme(3 * t2 - 2 * t3, 0, 65536);
}

/** 32-Bit-Pruefsumme ueber eine Zahlenfolge (Desync-Erkennung). */
export function summe32(werte) {
  let h = 0x811c9dc5 | 0;
  for (let i = 0; i < werte.length; i++) {
    h = Math.imul(h ^ (werte[i] | 0), 0x01000193) | 0;
    h = (h ^ (h >>> 13)) | 0;
  }
  return h >>> 0;
}
