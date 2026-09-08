/* ═══════════════════════════════════════════════════════════
   AGE OF GENERATION — Darstellung

   Baut aus dem Spielstand ein Bild: Gelaende aus der Hoehenkarte,
   Wasser, Waelder, Gebaeude, Einheiten, Geschosse, Nebel des
   Krieges.

   Damit auch grosse Schlachten fluessig bleiben, wird alles
   Gleichartige gebuendelt gezeichnet (InstancedMesh): alle Ritter
   eines Typs in einem Aufruf, alle Baeume in einem Aufruf. Die
   Simulation rechnet zehnmal je Sekunde, gezeichnet wird mit der
   Bildrate des Rechners — dazwischen wird die Bewegung geglaettet.
   ═══════════════════════════════════════════════════════════ */
'use strict';

import * as THREE from './vendor/three.module.js';
import { FP, GEBAEUDE, EINHEITEN, FARBEN, BODEN } from './regeln.js';
import { VORKOMMEN_LISTE } from './karte.js';
import { gebaeudeModell, einheitModell, landModell, geschossModell, BAUMARTEN } from './modelle.js';
import { punktrausch } from './zufall.js';

/** Hoehe einer Gelaendestufe in Welteinheiten (1 Einheit = 1 Kachel). */
export const HOEHE = 0.42;
/** Wasserspiegel. */
const WASSER_Y = 0.16;
/* Einheiten werden etwas groesser gezeichnet als sie „sind“ —
   sonst verschwinden sie zwischen den Gebaeuden. Auf den Kampf
   hat das keinen Einfluss, die Simulation rechnet in Kacheln. */
const EINHEIT_SKALA = 1.5;
/* So oft wird jede Kachel im Gelaendenetz unterteilt. Mehr Punkte
   heisst weichere Nebelkanten — zwei genuegen dafuer. */
const UNTERTEILUNG = 2;
/* So viele Farbfelder hat eine Kachel in der Bodentextur. Damit ist
   die sichtbare Einteilung ein Achtel so gross wie eine Kachel. */
const FEINHEIT = 8;
/* Verteilung der Baumarten im Wald. */
const BAUM_MISCHUNG = ['fichte', 'fichte', 'fichte', 'fichte', 'kiefer', 'kiefer',
                       'eiche', 'eiche', 'birke', 'busch', 'totholz'];

const BODENFARBE = {
  [BODEN.gras]:    0x5f8c3c,
  [BODEN.wiese]:   0x74a04a,
  [BODEN.sand]:    0xcbb681,
  [BODEN.fels]:    0x8b8b85,
  [BODEN.wasser]:  0x33564a,
  [BODEN.acker]:   0x8a6a3a,
  [BODEN.strasse]: 0xa89b80
};

export class Welt {
  /**
   * @param {Sim} sim
   * @param {HTMLCanvasElement} leinwand
   * @param {number|null} spielerId  null = Zuschauer, sieht alles
   */
  constructor(sim, leinwand, spielerId) {
    this.sim = sim;
    this.spielerId = spielerId;
    this.leinwand = leinwand;

    this.renderer = new THREE.WebGLRenderer({ canvas: leinwand, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(2, globalThis.devicePixelRatio || 1));
    this.renderer.setClearColor(0x8fb6d8);

    this.szene = new THREE.Scene();
    this.szene.fog = new THREE.Fog(0x8fb6d8, 55, 130);

    this.kamera = new THREE.PerspectiveCamera(50, 1, 0.5, 400);

    /* Licht: hohe Sonne von schraeg vorn, dazu Himmelslicht, damit
       Schattenseiten nicht schwarz absaufen. */
    const sonne = new THREE.DirectionalLight(0xfff2dc, 1.25);
    sonne.position.set(0.6, 1.0, 0.35);
    this.szene.add(sonne);
    /* Zweites, schwaches Licht von der Gegenseite und ein kraeftiges
       Himmelslicht: sonst saufen die vom Betrachter abgewandten
       Hauswaende ab und jedes Gebaeude wirkt wie ein dunkler Klotz. */
    const gegenlicht = new THREE.DirectionalLight(0xdce8ff, 0.35);
    gegenlicht.position.set(-0.5, 0.4, -0.7);
    this.szene.add(gegenlicht);
    this.szene.add(new THREE.HemisphereLight(0xcfe2f2, 0x7a8a68, 1.15));

    this.gruppen = new Map();      // gebuendelte Zeichenaufrufe
    this.anzeige = new Map();      // gemerkte Blickrichtung je Einheit
    this.landDreckig = true;
    this.nebelDreckig = true;

    this.gelaendeBauen();
    this.wasserBauen();
    this.hilfsformen();
    this.groesseAnpassen();
  }

  /* ─────────────── Gelaende ───────────────
     Zwei getrennte Aufloesungen, und das mit Absicht:

       * Das Netz wird je Kachel unterteilt (UNTERTEILUNG × UNTERTEILUNG).
         Darauf sitzt der Nebel des Krieges als Eckpunktfarbe — weil die
         Grafikkarte zwischen Eckpunkten weich ueberblendet, bekommt der
         Nebel dadurch runde, weiche Raender statt Treppenstufen.

       * Die Bodenfarbe kommt aus einer Textur mit FEINHEIT Feldern je
         Kachel. Die sichtbare Karo-Einteilung wird dadurch achtmal
         kleiner, ohne dass ein einziges Dreieck mehr noetig waere. */

  gelaendeBauen() {
    const k = this.sim.karte;
    const b = k.breite, h = k.hoehe;

    /* Eckhoehen: Mittel der angrenzenden Kacheln, dadurch weiche Haenge. */
    this.ecken = new Float32Array((b + 1) * (h + 1));
    for (let y = 0; y <= h; y++) {
      for (let x = 0; x <= b; x++) {
        let summe = 0, n = 0;
        for (const [dx, dy] of [[-1, -1], [0, -1], [-1, 0], [0, 0]]) {
          const tx = x + dx, ty = y + dy;
          if (tx < 0 || ty < 0 || tx >= b || ty >= h) continue;
          const i = ty * b + tx;
          summe += k.boden[i] === BODEN.wasser ? -0.6 : k.hoehen[i];
          n++;
        }
        this.ecken[y * (b + 1) + x] = n ? (summe / n) * HOEHE : 0;
      }
    }

    const S = UNTERTEILUNG;
    const gb = b * S + 1, gh = h * S + 1;
    const punkte = gb * gh;
    const pos = new Float32Array(punkte * 3);
    const uv = new Float32Array(punkte * 2);
    const far = new Float32Array(punkte * 3).fill(1);
    for (let j = 0; j < gh; j++) {
      for (let i = 0; i < gb; i++) {
        const n = j * gb + i;
        const wx = i / S, wz = j / S;
        pos[n * 3] = wx;
        pos[n * 3 + 1] = this.eckHoehe(wx, wz);
        pos[n * 3 + 2] = wz;
        uv[n * 2] = wx / b;
        uv[n * 2 + 1] = wz / h;
      }
    }
    const felder = (gb - 1) * (gh - 1);
    const index = (punkte > 65535 ? new Uint32Array(felder * 6) : new Uint16Array(felder * 6));
    let o = 0;
    for (let j = 0; j < gh - 1; j++) {
      for (let i = 0; i < gb - 1; i++) {
        const a = j * gb + i, c = a + 1, d = a + gb, e = d + 1;
        index[o++] = a; index[o++] = d; index[o++] = c;
        index[o++] = c; index[o++] = d; index[o++] = e;
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setAttribute('color', new THREE.BufferAttribute(far, 3));
    geo.setIndex(new THREE.BufferAttribute(index, 1));
    geo.computeVertexNormals();
    this.gelaendeGeo = geo;
    this.gitterB = gb; this.gitterH = gh;

    this.gelaende = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({
      vertexColors: true, map: this.bodenTextur()
    }));
    this.gelaende.frustumCulled = false;
    this.szene.add(this.gelaende);
  }

  /**
   * Uebernimmt geaenderte Gelaendehoehen ins Netz: erst die Eckhoehen,
   * dann die Punkte des feinen Gitters, dann die Normalen.
   */
  gelaendeNachziehen() {
    const k = this.sim.karte;
    const b = k.breite, h = k.hoehe;
    for (let y = 0; y <= h; y++) {
      for (let x = 0; x <= b; x++) {
        let summe = 0, n = 0;
        for (const [dx, dy] of [[-1, -1], [0, -1], [-1, 0], [0, 0]]) {
          const tx = x + dx, ty = y + dy;
          if (tx < 0 || ty < 0 || tx >= b || ty >= h) continue;
          const i = ty * b + tx;
          summe += k.boden[i] === BODEN.wasser ? -0.6 : k.hoehen[i];
          n++;
        }
        this.ecken[y * (b + 1) + x] = n ? (summe / n) * HOEHE : 0;
      }
    }
    const S = UNTERTEILUNG;
    const gb = this.gitterB, gh = this.gitterH;
    const pos = this.gelaendeGeo.attributes.position;
    const arr = pos.array;
    for (let j = 0; j < gh; j++) {
      for (let i = 0; i < gb; i++) {
        arr[(j * gb + i) * 3 + 1] = this.eckHoehe(i / S, j / S);
      }
    }
    pos.needsUpdate = true;
    this.gelaendeGeo.computeVertexNormals();
  }

  /** Hoehe an einem Punkt des Eckgitters (bilinear zwischen Kachelecken). */
  eckHoehe(x, z) {
    const k = this.sim.karte, b = k.breite;
    const gx = Math.min(k.breite - 1, Math.floor(x)), gz = Math.min(k.hoehe - 1, Math.floor(z));
    const fx = x - gx, fz = z - gz;
    const h00 = this.ecken[gz * (b + 1) + gx];
    const h10 = this.ecken[gz * (b + 1) + gx + 1];
    const h01 = this.ecken[(gz + 1) * (b + 1) + gx];
    const h11 = this.ecken[(gz + 1) * (b + 1) + gx + 1];
    return (h00 * (1 - fx) + h10 * fx) * (1 - fz) + (h01 * (1 - fx) + h11 * fx) * fz;
  }

  /**
   * Bodentextur: je Kachel FEINHEIT × FEINHEIT Farbfelder. Der Ton
   * streut von Feld zu Feld ein wenig und wird an den Kachelgrenzen
   * mit dem Nachbarn gemischt — das ergibt eine Wiese aus vielen
   * kleinen Flecken statt eines Schachbretts aus grossen.
   */
  bodenTextur() {
    const k = this.sim.karte;
    const T = FEINHEIT;
    const tw = k.breite * T, th = k.hoehe * T;
    const daten = new Uint8Array(tw * th * 4);
    /* Die Farbwerte werden hier unmittelbar aus dem Hex-Wert genommen
       und bleiben damit in sRGB. Ginge man ueber THREE.Color, laegen
       sie linear vor, und die als sRGB gekennzeichnete Textur wuerde
       ein zweites Mal umgerechnet — das ganze Gelaende waere zu dunkel. */
    const grund = new Float32Array(k.breite * k.hoehe * 3);
    for (let i = 0; i < k.breite * k.hoehe; i++) {
      const hex = BODENFARBE[k.boden[i]] != null ? BODENFARBE[k.boden[i]] : 0x5f8c3c;
      grund[i * 3] = (hex >> 16) & 255;
      grund[i * 3 + 1] = (hex >> 8) & 255;
      grund[i * 3 + 2] = hex & 255;
    }
    for (let ty = 0; ty < k.hoehe; ty++) {
      for (let tx = 0; tx < k.breite; tx++) {
        const i = ty * k.breite + tx;
        for (let fy = 0; fy < T; fy++) {
          for (let fx = 0; fx < T; fx++) {
            /* Anteilig mit den Nachbarkacheln mischen, damit die
               Kachelgrenzen nicht als Kanten stehen bleiben. */
            const ax = (fx + 0.5) / T - 0.5, az = (fy + 0.5) / T - 0.5;
            const nx = Math.min(k.breite - 1, Math.max(0, tx + Math.sign(ax)));
            const nz = Math.min(k.hoehe - 1, Math.max(0, ty + Math.sign(az)));
            const gx = Math.abs(ax) * 0.8, gz = Math.abs(az) * 0.8;
            const j = ty * k.breite + nx, m = nz * k.breite + tx;
            let r = grund[i * 3] * (1 - gx - gz) + grund[j * 3] * gx + grund[m * 3] * gz;
            let g = grund[i * 3 + 1] * (1 - gx - gz) + grund[j * 3 + 1] * gx + grund[m * 3 + 1] * gz;
            let bl = grund[i * 3 + 2] * (1 - gx - gz) + grund[j * 3 + 2] * gx + grund[m * 3 + 2] * gz;
            /* Feine Streuung je Farbfeld. */
            const streu = (punktrausch(tx * T + fx, ty * T + fy, 0x51fe) / 65535 - 0.5) * 34;
            const o = ((ty * T + fy) * tw + tx * T + fx) * 4;
            daten[o] = klemme255(r + streu);
            daten[o + 1] = klemme255(g + streu);
            daten[o + 2] = klemme255(bl + streu);
            daten[o + 3] = 255;
          }
        }
      }
    }
    const textur = new THREE.DataTexture(daten, tw, th, THREE.RGBAFormat);
    textur.magFilter = THREE.NearestFilter;      // scharfe kleine Felder
    textur.minFilter = THREE.LinearMipmapLinearFilter;
    textur.generateMipmaps = true;
    textur.colorSpace = THREE.SRGBColorSpace;
    textur.needsUpdate = true;
    return textur;
  }

  /* Wasser wird kachelweise gezeichnet und nicht als eine grosse
     Platte. Nur so laesst es sich vom Nebel des Krieges verdecken —
     sonst laege die Seenlandschaft der ganzen Karte offen, bevor ein
     Spaeher sie je gesehen hat. */
  wasserBauen() {
    const k = this.sim.karte;
    const kacheln = [];
    for (let y = 0; y < k.hoehe; y++) {
      for (let x = 0; x < k.breite; x++) {
        if (k.boden[y * k.breite + x] === BODEN.wasser) kacheln.push(y * k.breite + x);
      }
    }
    this.wasserKacheln = kacheln;
    if (!kacheln.length) { this.wasser = null; return; }

    const pos = new Float32Array(kacheln.length * 18);
    const far = new Float32Array(kacheln.length * 18).fill(1);
    const nor = new Float32Array(kacheln.length * 18);
    for (let n = 0; n < kacheln.length; n++) {
      const i = kacheln[n];
      const x = i % k.breite, y = (i / k.breite) | 0;
      const o = n * 18;
      pos.set([
        x, WASSER_Y, y, x, WASSER_Y, y + 1, x + 1, WASSER_Y, y,
        x + 1, WASSER_Y, y, x, WASSER_Y, y + 1, x + 1, WASSER_Y, y + 1
      ], o);
      for (let v = 0; v < 6; v++) { nor[o + v * 3 + 1] = 1; }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(far, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    this.wasserGeo = geo;
    this.wasser = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({
      color: 0x2f6d8c, vertexColors: true, transparent: true, opacity: 0.85
    }));
    this.wasser.frustumCulled = false;
    this.wasser.renderOrder = 1;
    this.szene.add(this.wasser);
  }

  /** Gelaendehoehe an einer beliebigen Stelle (weich zwischen den Ecken). */
  hoeheAn(x, z) {
    const k = this.sim.karte;
    const b = k.breite;
    if (x < 0 || z < 0 || x > k.breite || z > k.hoehe) return 0;
    const gx = Math.min(k.breite - 1, Math.floor(x)), gz = Math.min(k.hoehe - 1, Math.floor(z));
    const fx = x - gx, fz = z - gz;
    const h00 = this.ecken[gz * (b + 1) + gx];
    const h10 = this.ecken[gz * (b + 1) + gx + 1];
    const h01 = this.ecken[(gz + 1) * (b + 1) + gx];
    const h11 = this.ecken[(gz + 1) * (b + 1) + gx + 1];
    return (h00 * (1 - fx) + h10 * fx) * (1 - fz) + (h01 * (1 - fx) + h11 * fx) * fz;
  }

  /* ─────────────── Auswahlringe, Balken, Vorschau ─────────────── */

  hilfsformen() {
    /* Auswahlring */
    const ring = new THREE.RingGeometry(0.34, 0.44, 20);
    ring.rotateX(-Math.PI / 2);
    this.ringe = new THREE.InstancedMesh(ring, new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false
    }), 512);
    this.ringe.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(512 * 3).fill(1), 3);
    this.ringe.count = 0;
    this.ringe.frustumCulled = false;
    this.szene.add(this.ringe);

    /* Lebensbalken: zwei Lagen, immer zur Kamera gedreht. */
    const quad = new THREE.PlaneGeometry(1, 1);
    this.balkenHinten = this._balken(quad, 0x1a1a1a, 1024);
    this.balkenVorn = this._balken(quad, 0xffffff, 1024);

    /* Bauvorschau */
    this.vorschau = new THREE.Group();
    this.vorschau.visible = false;
    this.szene.add(this.vorschau);

    /* Sammelpunkt-Fahne */
    const fahne = new THREE.Group();
    const stab = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.0, 5),
      new THREE.MeshLambertMaterial({ color: 0x6b4a2a }));
    stab.position.y = 0.5;
    const tuch = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.26),
      new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide }));
    tuch.position.set(0.21, 0.85, 0);
    fahne.add(stab); fahne.add(tuch);
    fahne.visible = false;
    this.fahne = fahne;
    this.fahnenTuch = tuch;
    this.szene.add(fahne);
  }

  _balken(geo, farbe, n) {
    const m = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({
      color: farbe, transparent: true, depthTest: true, depthWrite: false
    }), n);
    m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3).fill(1), 3);
    m.count = 0;
    m.frustumCulled = false;
    m.renderOrder = 5;
    this.szene.add(m);
    return m;
  }

  /* ─────────────── Buendel je Modelltyp ─────────────── */

  gruppe(schluessel, modell) {
    let gr = this.gruppen.get(schluessel);
    if (!gr) {
      gr = { modell, kapazitaet: 0, koerper: null, neutral: null };
      this.gruppen.set(schluessel, gr);
    }
    return gr;
  }

  gruppeGroesse(gr, n) {
    if (n <= gr.kapazitaet) return;
    let neu = Math.max(16, gr.kapazitaet || 16);
    while (neu < n) neu *= 2;
    for (const teil of ['koerper', 'neutral']) {
      if (gr[teil]) { this.szene.remove(gr[teil]); gr[teil].dispose(); gr[teil] = null; }
      const geo = gr.modell[teil];
      if (!geo) continue;
      const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
      const mesh = new THREE.InstancedMesh(geo, mat, neu);
      /* Weiss als Grundwert: die Instanzfarbe wird auf die
         Eckpunktfarbe multipliziert. Bliebe sie auf Null, waere
         jedes Modell schwarz. */
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(neu * 3).fill(1), 3);
      mesh.count = 0;
      mesh.frustumCulled = false;
      gr[teil] = mesh;
      this.szene.add(mesh);
    }
    gr.kapazitaet = neu;
  }

  /* ─────────────── Sichtbarkeit ─────────────── */

  sichtbar(kx, ky) {
    if (this.spielerId == null) return 2;
    return this.sim.sichtbarFuer(this.spielerId, kx, ky);
  }

  darfSehen(e) {
    if (this.spielerId == null) return true;
    if (this.sim.verbuendet(this.spielerId, e.spieler)) return true;
    const kx = e.art === 'gebaeude' ? e.kx + (e.groesse >> 1) : (e.x / FP) | 0;
    const ky = e.art === 'gebaeude' ? e.ky + (e.groesse >> 1) : (e.y / FP) | 0;
    const s = this.sichtbar(kx, ky);
    /* Gebaeude bleiben im Gedaechtnis, Einheiten nicht. */
    return e.art === 'gebaeude' ? s >= 1 : s === 2;
  }

  /* ═══════════════ Zeichnen ═══════════════ */

  /**
   * @param {number} zwischen 0…1 — wie weit der laufende Simulationsschritt
   *        fortgeschritten ist; damit werden Bewegungen geglaettet.
   */
  zeichne(zwischen) {
    const sim = this.sim;
    const t = Math.max(0, Math.min(1, zwischen));

    /* Wurde beim Bauen planiert, zieht das Gelaendenetz nach. Das
       passiert selten — nur wenn wirklich ein Bauwerk gesetzt wurde —
       deshalb darf es ruhig das ganze Netz neu berechnen. */
    if (this.gelaendeStand !== sim.gelaendeVersion) {
      this.gelaendeStand = sim.gelaendeVersion;
      this.gelaendeNachziehen();
      this.landDreckig = true;
    }
    if (this.landDreckig) { this.landschaftBauen(); this.landDreckig = false; }
    if (this.nebelDreckig) { this.nebelZeichnen(); this.nebelDreckig = false; }

    /* Alle Buendel leeren. */
    for (const gr of this.gruppen.values()) {
      gr.zahl = 0;
      if (gr.land) continue;
    }
    const sammler = new Map();   // schluessel → [{x,y,z,winkel,skalaY,farbe}]
    const nimm = (schluessel, modell, eintrag) => {
      let liste = sammler.get(schluessel);
      if (!liste) { liste = []; liste.modell = modell; sammler.set(schluessel, liste); }
      liste.push(eintrag);
    };

    /* ── Gebaeude ── */
    for (const b of sim.gebaeude) {
      if (b.tot || !this.darfSehen(b)) continue;
      const p = sim.spieler[b.spieler];
      const mitte = b.groesse / 2;
      const x = b.kx + mitte, z = b.ky + mitte;
      const fortschritt = b.fertig ? 1 : Math.max(0.12, b.bauFortschritt / b.bauGesamt);
      /* Was auf dem Wasser steht, sitzt auf dem Wasserspiegel — nicht
         auf dem Grund darunter. */
      const yBau = GEBAEUDE[b.typ].aufWasser ? WASSER_Y - 0.02 : this.hoeheAn(x, z);
      nimm('b:' + b.typ + ':' + p.volk, gebaeudeModell(b.typ, p.volk), {
        x, y: yBau, z, winkel: (b.drehung || 0) * Math.PI / 2, skalaY: fortschritt,
        farbe: FARBEN[p.farbe % FARBEN.length].hex,
        matt: !b.fertig
      });
    }

    /* ── Einheiten ── */
    for (const e of sim.einheiten) {
      if (e.tot || e.verladen || !this.darfSehen(e)) continue;
      const p = sim.spieler[e.spieler];
      const x = (e.altX + (e.x - e.altX) * t) / FP;
      const z = (e.altY + (e.y - e.altY) * t) / FP;
      let merk = this.anzeige.get(e.id);
      if (!merk) { merk = { winkel: 0 }; this.anzeige.set(e.id, merk); }
      const dx = e.x - e.altX, dz = e.y - e.altY;
      if (dx * dx + dz * dz > 4) {
        const ziel = Math.atan2(dx, dz);
        /* Weich einschwenken statt springen. */
        let d = ziel - merk.winkel;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        merk.winkel += d * Math.min(1, 0.35);
      }
      const schiff = !!(EINHEITEN[e.typ] && EINHEITEN[e.typ].wasser);
      nimm('e:' + e.typ, einheitModell(e.typ), {
        x, y: schiff ? WASSER_Y - 0.04 : this.hoeheAn(x, z), z,
        winkel: merk.winkel - Math.PI / 2, skalaY: 1,
        skala: schiff ? 1.15 : EINHEIT_SKALA, farbe: FARBEN[p.farbe % FARBEN.length].hex
      });
    }

    /* ── Geschosse ── */
    for (const g of sim.geschosse) {
      const x = g.x / FP, z = g.y / FP;
      if (this.spielerId != null && this.sichtbar(x | 0, z | 0) !== 2) continue;
      const art = g.flaeche > 0 ? 'stein' : (g.typ === 'plaenkler' ? 'speer' : 'pfeil');
      /* Ein Bogen ueber die Strecke, damit es nicht wie ein Laser wirkt. */
      const anteil = 1 - g.rest / g.gesamt;
      const bogen = Math.sin(anteil * Math.PI) * (g.flaeche > 0 ? 1.6 : 0.5);
      nimm('g:' + art, geschossModell(art), {
        x, y: this.hoeheAn(x, z) + 0.5 + bogen, z,
        winkel: Math.atan2(g.zx - g.startX, g.zy - g.startY) - Math.PI / 2,
        skalaY: 1, farbe: 0xffffff
      });
    }

    /* Alles Gesammelte in die Puffer schreiben. */
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), s = new THREE.Vector3();
    const farbe = new THREE.Color();
    for (const [schluessel, liste] of sammler) {
      const gr = this.gruppe(schluessel, liste.modell);
      this.gruppeGroesse(gr, liste.length);
      for (let i = 0; i < liste.length; i++) {
        const o = liste[i];
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), o.winkel);
        v.set(o.x, o.y, o.z);
        const sk = o.skala || 1;
        s.set(sk, sk * o.skalaY, sk);
        m.compose(v, q, s);
        farbe.setHex(o.farbe);
        if (o.matt) farbe.multiplyScalar(0.75);
        for (const teil of ['koerper', 'neutral']) {
          const mesh = gr[teil];
          if (!mesh) continue;
          mesh.setMatrixAt(i, m);
          if (teil === 'koerper') mesh.setColorAt(i, farbe);
        }
      }
      for (const teil of ['koerper', 'neutral']) {
        const mesh = gr[teil];
        if (!mesh) continue;
        mesh.count = liste.length;
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      }
    }
    /* Buendel ohne Eintraege ausblenden. */
    for (const [schluessel, gr] of this.gruppen) {
      if (sammler.has(schluessel) || gr.land) continue;
      if (gr.koerper) gr.koerper.count = 0;
      if (gr.neutral) gr.neutral.count = 0;
    }

    this.ringeZeichnen(t);
    this.balkenZeichnen(t);
    this.renderer.render(this.szene, this.kamera);
  }

  /* ─────────────── Landschaft (Baeume, Erz, Wild) ─────────────── */

  landschaftBauen() {
    const k = this.sim.karte;
    const listen = new Map();
    for (let y = 0; y < k.hoehe; y++) {
      for (let x = 0; x < k.breite; x++) {
        const i = y * k.breite + x;
        const v = k.vorkommen[i];
        if (!v || k.menge[i] <= 0) continue;
        if (this.spielerId != null && this.sichtbar(x, y) === 0) continue;
        let art = VORKOMMEN_LISTE[v - 1];
        /* Welche Baumart auf welcher Kachel steht, haengt allein an den
           Koordinaten — so sieht derselbe Wald immer gleich aus, ist
           aber nicht gestempelt. Nadelbaeume ueberwiegen, Totholz ist
           selten. */
        if (art === 'baum') art = BAUM_MISCHUNG[punktrausch(x, y, 0x7a11) % BAUM_MISCHUNG.length];
        let liste = listen.get(art);
        if (!liste) { liste = []; listen.set(art, liste); }
        const streuX = (((x * 374761393 + y * 668265263) >>> 8) & 255) / 255 - 0.5;
        const streuZ = (((x * 668265263 + y * 374761393) >>> 8) & 255) / 255 - 0.5;
        liste.push({ x: x + 0.5 + streuX * 0.4, z: y + 0.5 + streuZ * 0.4,
                     dreh: ((x * 31 + y * 17) % 16) / 16 * 6.283, wasser: art === 'fisch' });
      }
    }
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), v3 = new THREE.Vector3(), s = new THREE.Vector3(1, 1, 1);
    const achse = new THREE.Vector3(0, 1, 0);
    /* Alte Landschaftsbuendel zuruecksetzen. */
    for (const [schluessel, gr] of this.gruppen) {
      if (!gr.land) continue;
      if (gr.koerper) gr.koerper.count = 0;
      if (gr.neutral) gr.neutral.count = 0;
    }
    for (const [art, liste] of listen) {
      const schluessel = 'l:' + art;
      const gr = this.gruppe(schluessel, landModell(art));
      gr.land = true;
      this.gruppeGroesse(gr, liste.length);
      for (let i = 0; i < liste.length; i++) {
        const o = liste[i];
        q.setFromAxisAngle(achse, o.dreh);
        v3.set(o.x, o.wasser ? WASSER_Y - 0.02 : this.hoeheAn(o.x, o.z), o.z);
        m.compose(v3, q, s);
        if (gr.koerper) gr.koerper.setMatrixAt(i, m);
        if (gr.neutral) gr.neutral.setMatrixAt(i, m);
      }
      for (const teil of ['koerper', 'neutral']) {
        const mesh = gr[teil];
        if (!mesh) continue;
        mesh.count = liste.length;
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) {
          const weiss = new THREE.Color(0xffffff);
          for (let i = 0; i < liste.length; i++) mesh.setColorAt(i, weiss);
          mesh.instanceColor.needsUpdate = true;
        }
      }
    }
  }

  /* ─────────────── Nebel des Krieges ───────────────
     Der Nebel steckt in den Eckpunktfarben des Gelaendes. Weil die
     Grafikkarte zwischen Eckpunkten ueberblendet und das Sichtfeld
     vorher weichgezeichnet wird, bekommt er runde Raender statt
     der Treppenstufen, die ein kachelweiser Nebel hinterlaesst. */

  nebelZeichnen() {
    if (this.spielerId == null) return;    // Zuschauer sehen alles
    const k = this.sim.karte, b = k.breite, h = k.hoehe;

    if (!this.sichtFeld) {
      this.sichtFeld = new Float32Array(b * h);
      this.sichtWeich = new Float32Array(b * h);
    }
    /* 1. Sichtstufe je Kachel: gesehen, erinnert, unbekannt. */
    for (let i = 0; i < b * h; i++) {
      const x = i % b, y = (i / b) | 0;
      const s = this.sichtbar(x, y);
      this.sichtFeld[i] = s === 2 ? 1 : (s === 1 ? 0.5 : 0.06);
    }
    /* 2. Weichzeichnen — das nimmt die Zacken aus den Sichtkreisen. */
    const f = this.sichtFeld, w = this.sichtWeich;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < b; x++) {
        let summe = 0, n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= h) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            if (xx < 0 || xx >= b) continue;
            const gewicht = (dx === 0 && dy === 0) ? 4 : 1;
            summe += f[yy * b + xx] * gewicht; n += gewicht;
          }
        }
        w[y * b + x] = summe / n;
      }
    }

    /* 3. Auf die Eckpunkte des feinen Gitters uebertragen. */
    const S = UNTERTEILUNG;
    const gb = this.gitterB, gh = this.gitterH;
    const farben = this.gelaendeGeo.attributes.color;
    const arr = farben.array;
    for (let j = 0; j < gh; j++) {
      for (let i = 0; i < gb; i++) {
        const v = this.sichtWert(i / S, j / S);
        const o = (j * gb + i) * 3;
        arr[o] = v; arr[o + 1] = v; arr[o + 2] = v;
      }
    }
    farben.needsUpdate = true;

    /* 4. Dasselbe fuer die Wasserkacheln, ebenfalls ueber die Ecken. */
    if (this.wasser && this.wasserKacheln) {
      const wf = this.wasserGeo.attributes.color;
      const wa = wf.array;
      for (let n = 0; n < this.wasserKacheln.length; n++) {
        const i = this.wasserKacheln[n];
        const x = i % b, y = (i / b) | 0;
        const e00 = this.sichtWert(x, y), e01 = this.sichtWert(x, y + 1);
        const e10 = this.sichtWert(x + 1, y), e11 = this.sichtWert(x + 1, y + 1);
        const ecken = [e00, e01, e10, e10, e01, e11];
        const o = n * 18;
        for (let v = 0; v < 6; v++) {
          arr2(wa, o + v * 3, ecken[v]);
        }
      }
      wf.needsUpdate = true;
    }
  }

  /** Sichtwert an einer Weltstelle — weich zwischen den Kachelmitten. */
  sichtWert(wx, wz) {
    const k = this.sim.karte, b = k.breite, h = k.hoehe;
    const x = Math.min(b - 1.001, Math.max(0, wx - 0.5));
    const z = Math.min(h - 1.001, Math.max(0, wz - 0.5));
    const x0 = x | 0, z0 = z | 0;
    const fx = x - x0, fz = z - z0;
    const w = this.sichtWeich;
    const a = w[z0 * b + x0], c = w[z0 * b + x0 + 1];
    const d = w[(z0 + 1) * b + x0], e = w[(z0 + 1) * b + x0 + 1];
    return (a * (1 - fx) + c * fx) * (1 - fz) + (d * (1 - fx) + e * fx) * fz;
  }

  /* ─────────────── Auswahl und Balken ─────────────── */

  setzeAuswahl(ids) { this.auswahl = ids || []; }

  ringeZeichnen(t) {
    const sim = this.sim;
    const m = new THREE.Matrix4(), v = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    const c = new THREE.Color();
    let n = 0;
    for (const id of (this.auswahl || [])) {
      const e = sim.nachId.get(id);
      if (!e || e.tot || n >= 512) continue;
      let x, z, gr;
      if (e.art === 'gebaeude') { gr = e.groesse * 0.8; x = e.kx + e.groesse / 2; z = e.ky + e.groesse / 2; }
      else {
        gr = 1.0;
        x = (e.altX + (e.x - e.altX) * t) / FP;
        z = (e.altY + (e.y - e.altY) * t) / FP;
      }
      v.set(x, this.hoeheAn(x, z) + 0.06, z);
      s.set(gr, 1, gr);
      m.compose(v, q, s);
      this.ringe.setMatrixAt(n, m);
      const p = sim.spieler[e.spieler];
      c.setHex(this.spielerId != null && !sim.verbuendet(this.spielerId, e.spieler)
        ? 0xff5555 : FARBEN[p.farbe % FARBEN.length].hex);
      c.lerp(new THREE.Color(0xffffff), 0.45);
      this.ringe.setColorAt(n, c);
      n++;
    }
    this.ringe.count = n;
    this.ringe.instanceMatrix.needsUpdate = true;
    if (this.ringe.instanceColor) this.ringe.instanceColor.needsUpdate = true;
  }

  balkenZeichnen(t) {
    const sim = this.sim;
    const q = this.kamera.quaternion;
    const m = new THREE.Matrix4(), v = new THREE.Vector3(), s = new THREE.Vector3();
    const c = new THREE.Color();
    const ausgewaehlt = new Set(this.auswahl || []);
    let n = 0;
    const eintrag = (e, x, z, hoch, breite) => {
      const anteil = Math.max(0, Math.min(1, e.hp / e.hpMax));
      const zeigen = ausgewaehlt.has(e.id) || anteil < 0.999;
      if (!zeigen || n >= 1024) return;
      const y = this.hoeheAn(x, z) + hoch;
      v.set(x, y, z);
      s.set(breite, breite * 0.16, 1);
      m.compose(v, q, s);
      this.balkenHinten.setMatrixAt(n, m);
      c.setHex(0x101010);
      this.balkenHinten.setColorAt(n, c);

      /* Vordere Lage: Laenge nach Trefferpunkten, leicht davor. */
      const bv = breite * anteil;
      v.set(x - (breite - bv) / 2, y, z);
      v.addScaledVector(new THREE.Vector3(0, 0, 1).applyQuaternion(q), 0.01);
      s.set(Math.max(0.0001, bv), breite * 0.11, 1);
      m.compose(v, q, s);
      this.balkenVorn.setMatrixAt(n, m);
      const eigen = this.spielerId == null || sim.verbuendet(this.spielerId, e.spieler);
      c.setHex(eigen ? (anteil > 0.5 ? 0x4ad152 : (anteil > 0.25 ? 0xd8c33a : 0xd84a3a)) : 0xd84a3a);
      this.balkenVorn.setColorAt(n, c);
      n++;
    };
    for (const e of sim.einheiten) {
      if (e.tot || e.verladen || !this.darfSehen(e)) continue;
      const x = (e.altX + (e.x - e.altX) * t) / FP;
      const z = (e.altY + (e.y - e.altY) * t) / FP;
      eintrag(e, x, z, 0.95, 0.7);
    }
    for (const b of sim.gebaeude) {
      if (b.tot || !this.darfSehen(b)) continue;
      const x = b.kx + b.groesse / 2, z = b.ky + b.groesse / 2;
      const anteil = b.fertig ? b.hp / b.hpMax : 0;
      if (!b.fertig) {
        /* Baufortschritt statt Trefferpunkte. */
        const p = { id: b.id, hp: b.bauFortschritt, hpMax: b.bauGesamt, spieler: b.spieler };
        eintrag(p, x, z, 0.6 + b.groesse * 0.35, b.groesse * 0.75);
      } else if (anteil < 0.999 || ausgewaehlt.has(b.id)) {
        eintrag(b, x, z, 0.6 + b.groesse * 0.45, b.groesse * 0.75);
      }
    }
    this.balkenHinten.count = n;
    this.balkenVorn.count = n;
    this.balkenHinten.instanceMatrix.needsUpdate = true;
    this.balkenVorn.instanceMatrix.needsUpdate = true;
    if (this.balkenHinten.instanceColor) this.balkenHinten.instanceColor.needsUpdate = true;
    if (this.balkenVorn.instanceColor) this.balkenVorn.instanceColor.needsUpdate = true;
  }

  /* ─────────────── Bauvorschau und Fahne ─────────────── */

  zeigeVorschau(typ, kx, ky, gueltig, volk) {
    while (this.vorschau.children.length) {
      const c = this.vorschau.children.pop();
      if (c.geometry && c.geometry.dispose) c.geometry.dispose();
    }
    if (!typ) { this.vorschau.visible = false; return; }
    const modell = gebaeudeModell(typ, volk || 'franken');
    const farbe = gueltig ? 0x6cf06c : 0xf06c6c;
    for (const teil of ['koerper', 'neutral']) {
      if (!modell[teil]) continue;
      const mat = new THREE.MeshBasicMaterial({ color: farbe, transparent: true, opacity: 0.45, depthWrite: false });
      this.vorschau.add(new THREE.Mesh(modell[teil], mat));
    }
    const g = GEBAEUDE[typ].groesse;
    const x = kx + g / 2, z = ky + g / 2;
    /* Bruecken schwimmen auf dem Wasser, alles Uebrige steht im Gelaende. */
    const y = GEBAEUDE[typ].aufWasser ? WASSER_Y - 0.02 : this.hoeheAn(x, z);
    this.vorschau.position.set(x, y, z);
    this.vorschau.visible = true;
  }

  zeigeFahne(punkt, farbe) {
    if (!punkt) { this.fahne.visible = false; return; }
    this.fahne.position.set(punkt.x, this.hoeheAn(punkt.x, punkt.z), punkt.z);
    this.fahnenTuch.material.color.setHex(farbe);
    this.fahne.visible = true;
  }

  /* ─────────────── Auswahl per Strahl ───────────────
     Statt das ganze Gelaendenetz zu durchsuchen, wird der Strahl
     Schritt fuer Schritt abgelaufen und mit der Hoehenkarte
     verglichen. Das ist schnell genug fuer jeden Mausbewegung. */

  bodenPunkt(mausX, mausY) {
    const zeiger = new THREE.Vector2(
      (mausX / this.leinwand.clientWidth) * 2 - 1,
      -(mausY / this.leinwand.clientHeight) * 2 + 1
    );
    const strahl = new THREE.Raycaster();
    strahl.setFromCamera(zeiger, this.kamera);
    const o = strahl.ray.origin, d = strahl.ray.direction;
    let t = 0;
    const schritt = 0.35;
    let letzterUeber = o.y - this.hoeheAn(o.x, o.z);
    for (let i = 0; i < 900; i++) {
      t += schritt;
      const x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t;
      if (y < -5) break;
      if (x < -20 || z < -20 || x > this.sim.karte.breite + 20 || z > this.sim.karte.hoehe + 20) {
        if (t > 400) break; else continue;
      }
      const ueber = y - this.hoeheAn(x, z);
      if (ueber <= 0) {
        /* Zwischen den letzten beiden Schritten genauer nachsehen. */
        const anteil = letzterUeber / (letzterUeber - ueber || 1);
        const tt = t - schritt + schritt * anteil;
        return new THREE.Vector3(o.x + d.x * tt, o.y + d.y * tt, o.z + d.z * tt);
      }
      letzterUeber = ueber;
    }
    return null;
  }

  /** Bildschirmposition einer Weltkoordinate (fuer Auswahlrahmen und HUD). */
  aufSchirm(x, y, z, ziel) {
    const v = ziel || new THREE.Vector3();
    v.set(x, y, z).project(this.kamera);
    v.x = (v.x + 1) / 2 * this.leinwand.clientWidth;
    v.y = (-v.y + 1) / 2 * this.leinwand.clientHeight;
    return v;
  }

  /** Was liegt unter dem Zeiger? Naechste Einheit oder Gebaeude. */
  entitaetAn(mausX, mausY, nurEigene) {
    const sim = this.sim;
    let bestes = null, bestD = 42 * 42;
    const v = new THREE.Vector3();
    for (const e of sim.einheiten) {
      if (e.tot || e.verladen || !this.darfSehen(e)) continue;
      if (nurEigene && e.spieler !== this.spielerId) continue;
      const x = e.x / FP, z = e.y / FP;
      this.aufSchirm(x, this.hoeheAn(x, z) + 0.35, z, v);
      if (v.z > 1) continue;
      const d = (v.x - mausX) * (v.x - mausX) + (v.y - mausY) * (v.y - mausY);
      if (d < bestD) { bestD = d; bestes = e; }
    }
    if (bestes) return bestes;
    /* Gebaeude: ueber die Kachel unter dem Zeiger. */
    const punkt = this.bodenPunkt(mausX, mausY);
    if (!punkt) return null;
    const kx = punkt.x | 0, ky = punkt.z | 0;
    if (kx < 0 || ky < 0 || kx >= sim.karte.breite || ky >= sim.karte.hoehe) return null;
    const id = sim.belegt[ky * sim.karte.breite + kx];
    if (!id) return null;
    const b = sim.nachId.get(id);
    if (!b || b.tot || !this.darfSehen(b)) return null;
    if (nurEigene && b.spieler !== this.spielerId) return null;
    return b;
  }

  /** Alle eigenen Einheiten in einem Bildschirmrechteck. */
  imRechteck(x0, y0, x1, y1) {
    const raus = [];
    const v = new THREE.Vector3();
    const ax = Math.min(x0, x1), bx = Math.max(x0, x1);
    const ay = Math.min(y0, y1), by = Math.max(y0, y1);
    for (const e of this.sim.einheiten) {
      if (e.tot || e.verladen || e.spieler !== this.spielerId) continue;
      const x = e.x / FP, z = e.y / FP;
      this.aufSchirm(x, this.hoeheAn(x, z) + 0.3, z, v);
      if (v.z > 1) continue;
      if (v.x >= ax && v.x <= bx && v.y >= ay && v.y <= by) raus.push(e);
    }
    return raus;
  }

  groesseAnpassen() {
    const b = this.leinwand.clientWidth || 1, h = this.leinwand.clientHeight || 1;
    this.renderer.setSize(b, h, false);
    this.kamera.aspect = b / h;
    this.kamera.updateProjectionMatrix();
  }
}

/** Setzt drei gleiche Werte in ein Farbfeld. */
function arr2(feld, o, v) { feld[o] = v; feld[o + 1] = v; feld[o + 2] = v; }

/** Auf einen Byte-Farbwert begrenzen. */
function klemme255(v) { return v < 0 ? 0 : (v > 255 ? 255 : v | 0); }
