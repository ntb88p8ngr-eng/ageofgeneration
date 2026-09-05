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
import { gebaeudeModell, einheitModell, landModell, geschossModell } from './modelle.js';

/** Hoehe einer Gelaendestufe in Welteinheiten (1 Einheit = 1 Kachel). */
export const HOEHE = 0.42;
/** Wasserspiegel. */
const WASSER_Y = 0.16;
/* Einheiten werden etwas groesser gezeichnet als sie „sind“ —
   sonst verschwinden sie zwischen den Gebaeuden. Auf den Kampf
   hat das keinen Einfluss, die Simulation rechnet in Kacheln. */
const EINHEIT_SKALA = 1.5;

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
    const sonne = new THREE.DirectionalLight(0xfff2dc, 1.55);
    sonne.position.set(0.6, 1.0, 0.35);
    this.szene.add(sonne);
    this.szene.add(new THREE.HemisphereLight(0xbfd8ef, 0x40502e, 1.0));

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
     Die Eckpunkte liegen auf dem Mittel der angrenzenden Kacheln,
     dadurch werden Haenge weich. Die Farbe bleibt je Kachel gleich,
     das ergibt die typische Feldereinteilung. */

  gelaendeBauen() {
    const k = this.sim.karte;
    const b = k.breite, h = k.hoehe;

    /* Eckhoehen */
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

    const kacheln = b * h;
    const pos = new Float32Array(kacheln * 18);
    const far = new Float32Array(kacheln * 18);
    const nor = new Float32Array(kacheln * 18);
    this.gelaendeFarbenBasis = new Float32Array(kacheln * 18);

    const eck = (x, y) => this.ecken[y * (b + 1) + x];
    let o = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < b; x++) {
        const i = y * b + x;
        const h00 = eck(x, y), h10 = eck(x + 1, y), h01 = eck(x, y + 1), h11 = eck(x + 1, y + 1);
        /* Zwei Dreiecke, Reihenfolge gegen den Uhrzeigersinn von oben. */
        const p = [
          x, h00, y, x, h01, y + 1, x + 1, h10, y,
          x + 1, h10, y, x, h01, y + 1, x + 1, h11, y + 1
        ];
        pos.set(p, o);
        /* Farbton je Kachel leicht streuen, sonst wirkt alles wie Filz. */
        const grund = BODENFARBE[k.boden[i]] != null ? BODENFARBE[k.boden[i]] : 0x5f8c3c;
        const c = new THREE.Color(grund);
        const streu = (((x * 73856093) ^ (y * 19349663)) & 15) / 15 - 0.5;
        c.offsetHSL(0, 0, streu * 0.035);
        for (let v = 0; v < 6; v++) {
          far[o + v * 3] = c.r; far[o + v * 3 + 1] = c.g; far[o + v * 3 + 2] = c.b;
        }
        o += 18;
      }
    }
    this.gelaendeFarbenBasis.set(far);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(far, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.computeVertexNormals();
    this.gelaendeGeo = geo;
    this.gelaende = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
    this.gelaende.frustumCulled = false;
    this.szene.add(this.gelaende);
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
    const far = new Float32Array(kacheln.length * 18);
    const nor = new Float32Array(kacheln.length * 18);
    this.wasserBasis = new Float32Array(kacheln.length * 18);
    const c = new THREE.Color(0x2f6d8c);
    for (let n = 0; n < kacheln.length; n++) {
      const i = kacheln[n];
      const x = i % k.breite, y = (i / k.breite) | 0;
      const o = n * 18;
      pos.set([
        x, WASSER_Y, y, x, WASSER_Y, y + 1, x + 1, WASSER_Y, y,
        x + 1, WASSER_Y, y, x, WASSER_Y, y + 1, x + 1, WASSER_Y, y + 1
      ], o);
      for (let v = 0; v < 6; v++) {
        far[o + v * 3] = c.r; far[o + v * 3 + 1] = c.g; far[o + v * 3 + 2] = c.b;
        nor[o + v * 3] = 0; nor[o + v * 3 + 1] = 1; nor[o + v * 3 + 2] = 0;
      }
    }
    this.wasserBasis.set(far);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(far, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    this.wasserGeo = geo;
    this.wasser = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({
      vertexColors: true, transparent: true, opacity: 0.85
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
      nimm('b:' + b.typ + ':' + p.volk, gebaeudeModell(b.typ, p.volk), {
        x, y: this.hoeheAn(x, z), z, winkel: 0, skalaY: fortschritt,
        farbe: FARBEN[p.farbe % FARBEN.length].hex,
        matt: !b.fertig
      });
    }

    /* ── Einheiten ── */
    for (const e of sim.einheiten) {
      if (e.tot || !this.darfSehen(e)) continue;
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
      nimm('e:' + e.typ, einheitModell(e.typ), {
        x, y: this.hoeheAn(x, z), z, winkel: merk.winkel - Math.PI / 2, skalaY: 1,
        skala: EINHEIT_SKALA, farbe: FARBEN[p.farbe % FARBEN.length].hex
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
        /* Zwei Baumformen im Wechsel, damit der Wald nicht gestempelt aussieht. */
        if (art === 'baum' && ((x * 7 + y * 13) & 3) === 0) art = 'baum2';
        let liste = listen.get(art);
        if (!liste) { liste = []; listen.set(art, liste); }
        const streuX = (((x * 374761393 + y * 668265263) >>> 8) & 255) / 255 - 0.5;
        const streuZ = (((x * 668265263 + y * 374761393) >>> 8) & 255) / 255 - 0.5;
        liste.push({ x: x + 0.5 + streuX * 0.4, z: y + 0.5 + streuZ * 0.4, dreh: ((x * 31 + y * 17) % 16) / 16 * 6.283 });
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
        v3.set(o.x, this.hoeheAn(o.x, o.z), o.z);
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
     Statt einer zweiten Ebene wird die Gelaendefarbe abgedunkelt:
     unerforscht ganz schwarz, erforscht aber unbeobachtet gedaempft. */

  nebelZeichnen() {
    if (this.spielerId == null) return;
    const k = this.sim.karte;
    const farben = this.gelaendeGeo.attributes.color;
    const basis = this.gelaendeFarbenBasis;
    const arr = farben.array;
    for (let y = 0; y < k.hoehe; y++) {
      for (let x = 0; x < k.breite; x++) {
        const i = y * k.breite + x;
        const s = this.sichtbar(x, y);
        const f = s === 2 ? 1 : (s === 1 ? 0.5 : 0.06);
        const o = i * 18;
        for (let v = 0; v < 18; v++) arr[o + v] = basis[o + v] * f;
      }
    }
    farben.needsUpdate = true;

    /* Dasselbe fuer die Wasserkacheln. */
    if (this.wasser && this.wasserKacheln) {
      const wf = this.wasserGeo.attributes.color;
      const wa = wf.array;
      for (let n = 0; n < this.wasserKacheln.length; n++) {
        const i = this.wasserKacheln[n];
        const s = this.sichtbarFuer(this.spielerId, i % k.breite, (i / k.breite) | 0);
        const f = s === 2 ? 1 : (s === 1 ? 0.5 : 0.06);
        const o = n * 18;
        for (let v = 0; v < 18; v++) wa[o + v] = this.wasserBasis[o + v] * f;
      }
      wf.needsUpdate = true;
    }
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
      if (e.tot || !this.darfSehen(e)) continue;
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
    this.vorschau.position.set(x, this.hoeheAn(x, z), z);
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
      if (e.tot || !this.darfSehen(e)) continue;
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
      if (e.tot || e.spieler !== this.spielerId) continue;
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
