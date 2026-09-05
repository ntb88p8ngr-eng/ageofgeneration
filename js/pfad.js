/* ═══════════════════════════════════════════════════════════
   AGE OF GENERATION — Wegsuche

   A* auf dem Kachelgitter, acht Richtungen. Zwei Dinge sind
   hier wichtiger als Schoenheit:

     1. Gleiches Ergebnis auf jedem Rechner. Deshalb ganze
        Zahlen, ein Haufen mit eindeutiger Reihenfolge und
        feste Richtungsreihenfolge — nie „irgendein“ Nachbar.
     2. Ein Deckel auf der Rechenzeit. Wird ein Ziel nicht
        gefunden, liefert die Suche den besten erreichten
        Punkt zurueck, damit die Einheit wenigstens losgeht.
   ═══════════════════════════════════════════════════════════ */
'use strict';

/** Kosten in Zehnteln: gerade 10, diagonal 14 (≈ √2). */
const GERADE = 10, DIAGONAL = 14;
export const GESPERRT = 255;

/* Feste Reihenfolge der Nachbarn — erst gerade, dann diagonal. */
const NACHBARN = [
  [0, -1, GERADE], [1, 0, GERADE], [0, 1, GERADE], [-1, 0, GERADE],
  [1, -1, DIAGONAL], [1, 1, DIAGONAL], [-1, 1, DIAGONAL], [-1, -1, DIAGONAL]
];

export class Pfadfinder {
  constructor(breite, hoehe) {
    this.b = breite; this.h = hoehe;
    const n = breite * hoehe;
    this.g = new Int32Array(n);
    this.f = new Int32Array(n);
    this.vorher = new Int32Array(n);
    this.marke = new Int32Array(n);   // Besuchsstempel statt Feld loeschen
    this.lauf = 0;
    this.haufen = new Int32Array(n + 1);
    this.haufenF = new Int32Array(n + 1);
    this.anzahl = 0;
    this.besucht = 0;                 // Statistik des letzten Laufs
  }

  _leeren() { this.anzahl = 0; this.lauf++; }

  _rein(knoten, f) {
    let i = ++this.anzahl;
    this.haufen[i] = knoten; this.haufenF[i] = f;
    while (i > 1) {
      const e = i >> 1;
      /* Gleichstand nach Knotennummer aufloesen — sonst haengt das
         Ergebnis von der Einfuegereihenfolge ab. */
      if (this.haufenF[e] < f || (this.haufenF[e] === f && this.haufen[e] <= knoten)) break;
      this.haufen[i] = this.haufen[e]; this.haufenF[i] = this.haufenF[e];
      this.haufen[e] = knoten; this.haufenF[e] = f;
      i = e;
    }
  }

  _raus() {
    const oben = this.haufen[1];
    this.haufen[1] = this.haufen[this.anzahl];
    this.haufenF[1] = this.haufenF[this.anzahl];
    this.anzahl--;
    let i = 1;
    for (;;) {
      const l = i << 1, r = l + 1;
      let k = i;
      if (l <= this.anzahl && besser(this.haufenF[l], this.haufen[l], this.haufenF[k], this.haufen[k])) k = l;
      if (r <= this.anzahl && besser(this.haufenF[r], this.haufen[r], this.haufenF[k], this.haufen[k])) k = r;
      if (k === i) break;
      const tk = this.haufen[k], tf = this.haufenF[k];
      this.haufen[k] = this.haufen[i]; this.haufenF[k] = this.haufenF[i];
      this.haufen[i] = tk; this.haufenF[i] = tf;
      i = k;
    }
    return oben;
  }

  /**
   * Sucht einen Weg.
   * @param {Uint8Array} sperre  je Kachel: 0 frei, GESPERRT unpassierbar, dazwischen Zusatzkosten
   * @param {number} sx,sy       Start (Kachel)
   * @param {number} zx,zy       Ziel (Kachel)
   * @param {object} o           maxKnoten, naheGenug (Kacheln), zielSperreEgal
   * @returns {Int32Array|null}  Kachelnummern vom Start (ausschliesslich) bis zum Ziel
   */
  suche(sperre, sx, sy, zx, zy, o) {
    o = o || {};
    const b = this.b, h = this.h;
    if (sx < 0 || sy < 0 || sx >= b || sy >= h) return null;
    zx = zx < 0 ? 0 : (zx >= b ? b - 1 : zx);
    zy = zy < 0 ? 0 : (zy >= h ? h - 1 : zy);
    const start = sy * b + sx, ziel = zy * b + zx;
    if (start === ziel) return null;

    const maxKnoten = o.maxKnoten || 6000;
    const nahe = (o.naheGenug || 0) * 10;
    const zielEgal = !!o.zielSperreEgal;

    this._leeren();
    const lauf = this.lauf;
    this.g[start] = 0;
    this.f[start] = schaetzung(sx, sy, zx, zy);
    this.vorher[start] = -1;
    this.marke[start] = lauf;
    this._rein(start, this.f[start]);

    let bester = start, besterWert = this.f[start], besucht = 0;

    while (this.anzahl > 0) {
      const k = this._raus();
      if (this.marke[k] !== lauf) continue;
      const kx = k % b, ky = (k / b) | 0;
      if (k === ziel) { this.besucht = besucht; return this._weg(start, k); }
      const rest = schaetzung(kx, ky, zx, zy);
      if (nahe > 0 && rest <= nahe) { this.besucht = besucht; return this._weg(start, k); }
      if (rest < besterWert) { besterWert = rest; bester = k; }
      if (++besucht > maxKnoten) break;

      for (let ni = 0; ni < 8; ni++) {
        const nx = kx + NACHBARN[ni][0], ny = ky + NACHBARN[ni][1];
        if (nx < 0 || ny < 0 || nx >= b || ny >= h) continue;
        const nk = ny * b + nx;
        const s = sperre[nk];
        if (s === GESPERRT && !(zielEgal && nk === ziel)) continue;
        /* Diagonal nur, wenn beide Ecken frei sind — sonst laufen
           Einheiten durch Mauerecken hindurch. */
        if (ni >= 4) {
          if (sperre[ky * b + nx] === GESPERRT || sperre[ny * b + kx] === GESPERRT) continue;
        }
        const neu = this.g[k] + NACHBARN[ni][2] + (s === GESPERRT ? 0 : s);
        if (this.marke[nk] === lauf && neu >= this.g[nk]) continue;
        this.marke[nk] = lauf;
        this.g[nk] = neu;
        this.vorher[nk] = k;
        const f = neu + schaetzung(nx, ny, zx, zy);
        this.f[nk] = f;
        this._rein(nk, f);
      }
    }
    this.besucht = besucht;
    /* Ziel unerreichbar: wenigstens in die richtige Richtung laufen. */
    if (bester === start) return null;
    return this._weg(start, bester);
  }

  _weg(start, ende) {
    let n = 0;
    for (let k = ende; k !== start && k >= 0; k = this.vorher[k]) n++;
    const weg = new Int32Array(n);
    let i = n - 1;
    for (let k = ende; k !== start && k >= 0; k = this.vorher[k]) weg[i--] = k;
    return weg;
  }

  /** Sieht Punkt A den Punkt B ohne Hindernis? (Bresenham auf Kacheln) */
  sicht(sperre, x0, y0, x1, y1) {
    let dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let fehler = dx - dy, x = x0, y = y0;
    for (let wache = 0; wache < 4096; wache++) {
      if (x === x1 && y === y1) return true;
      const e2 = fehler << 1;
      if (e2 > -dy) { fehler -= dy; x += sx; }
      if (e2 < dx) { fehler += dx; y += sy; }
      if (x < 0 || y < 0 || x >= this.b || y >= this.h) return false;
      if (sperre[y * this.b + x] === GESPERRT) return false;
    }
    return false;
  }

  /** Streicht Zwischenpunkte, die man ohnehin direkt sieht. */
  glaetten(sperre, weg, sx, sy) {
    if (!weg || weg.length < 2) return weg;
    const b = this.b;
    const raus = [];
    let x = sx, y = sy, i = 0;
    while (i < weg.length) {
      let j = weg.length - 1;
      /* Den weitesten sichtbaren Punkt suchen — hoechstens 12 voraus,
         damit die Sichtpruefung nicht teurer wird als die Suche. */
      const grenze = Math.min(weg.length - 1, i + 12);
      for (j = grenze; j > i; j--) {
        const zx = weg[j] % b, zy = (weg[j] / b) | 0;
        if (this.sicht(sperre, x, y, zx, zy)) break;
      }
      raus.push(weg[j]);
      x = weg[j] % b; y = (weg[j] / b) | 0;
      i = j + 1;
    }
    return Int32Array.from(raus);
  }
}

function besser(fa, ka, fb, kb) {
  return fa < fb || (fa === fb && ka < kb);
}

/** Achteck-Schaetzung: exakt fuer acht Richtungen, nie zu gross. */
function schaetzung(x0, y0, x1, y1) {
  const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
  return dx > dy ? GERADE * dx + (DIAGONAL - GERADE) * dy
                 : GERADE * dy + (DIAGONAL - GERADE) * dx;
}
