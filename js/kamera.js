/* ═══════════════════════════════════════════════════════════
   AGE OF GENERATION — Kamera

   Freie Feldherrnkamera: sie haengt an einem Punkt auf dem Boden
   und laesst sich schieben, drehen, kippen und zoomen. Die
   Tastenbelegung folgt dem Vorbild — Pfeiltasten und Bildschirm-
   rand schieben, das Mausrad zoomt —, dazu kommt das Drehen,
   das es dort nicht gab.
   ═══════════════════════════════════════════════════════════ */
'use strict';

import * as THREE from './vendor/three.module.js';

export class Kamera {
  constructor(welt) {
    this.welt = welt;
    this.kamera = welt.kamera;
    this.ziel = new THREE.Vector3(welt.sim.karte.breite / 2, 0, welt.sim.karte.hoehe / 2);
    this.abstand = 26;
    this.drehung = Math.PI * 0.25;   // Blickrichtung um die Hochachse
    this.neigung = 0.86;             // 0 = flach, 1.4 = fast senkrecht
    this.schub = new THREE.Vector2();
    this.tasten = new Set();
    this.randScrollen = true;
    this.maus = { x: 0, y: 0, drin: false };
    this.aktualisiere(0);
  }

  /** Einmal je Bild: Tasten auswerten, weich nachziehen. */
  aktualisiere(dt) {
    const geschwindigkeit = (12 + this.abstand * 0.55) * Math.min(0.05, dt);
    let vx = 0, vz = 0;
    if (this.tasten.has('w') || this.tasten.has('arrowup')) vz -= 1;
    if (this.tasten.has('s') || this.tasten.has('arrowdown')) vz += 1;
    if (this.tasten.has('a') || this.tasten.has('arrowleft')) vx -= 1;
    if (this.tasten.has('d') || this.tasten.has('arrowright')) vx += 1;

    /* Bildschirmrand schiebt mit — wie im Vorbild. */
    if (this.randScrollen && this.maus.drin) {
      const b = this.welt.leinwand.clientWidth, h = this.welt.leinwand.clientHeight;
      const rand = 12;
      if (this.maus.x < rand) vx -= 1;
      else if (this.maus.x > b - rand) vx += 1;
      if (this.maus.y < rand) vz -= 1;
      else if (this.maus.y > h - rand) vz += 1;
    }

    if (vx || vz) {
      const laenge = Math.hypot(vx, vz);
      vx /= laenge; vz /= laenge;
      /* In Blickrichtung schieben, nicht in Weltrichtung. */
      const sin = Math.sin(this.drehung), cos = Math.cos(this.drehung);
      this.ziel.x += (vx * cos - vz * sin) * geschwindigkeit;
      this.ziel.z += (vx * sin + vz * cos) * geschwindigkeit;
    }

    if (this.tasten.has('q')) this.drehung -= 1.6 * Math.min(0.05, dt);
    if (this.tasten.has('e')) this.drehung += 1.6 * Math.min(0.05, dt);
    if (this.tasten.has('r')) this.neigung = Math.min(1.45, this.neigung + 1.2 * Math.min(0.05, dt));
    if (this.tasten.has('f')) this.neigung = Math.max(0.28, this.neigung - 1.2 * Math.min(0.05, dt));

    this.begrenzen();
    this.setzen();
  }

  begrenzen() {
    const k = this.welt.sim.karte;
    this.ziel.x = Math.max(-4, Math.min(k.breite + 4, this.ziel.x));
    this.ziel.z = Math.max(-4, Math.min(k.hoehe + 4, this.ziel.z));
    this.abstand = Math.max(6, Math.min(90, this.abstand));
    this.ziel.y = this.welt.hoeheAn(
      Math.max(0, Math.min(k.breite - 0.01, this.ziel.x)),
      Math.max(0, Math.min(k.hoehe - 0.01, this.ziel.z)));
  }

  setzen() {
    const y = Math.sin(this.neigung) * this.abstand;
    const flach = Math.cos(this.neigung) * this.abstand;
    this.kamera.position.set(
      this.ziel.x - Math.sin(this.drehung) * flach,
      this.ziel.y + y,
      this.ziel.z - Math.cos(this.drehung) * flach
    );
    this.kamera.lookAt(this.ziel);
  }

  zoom(schritte) {
    this.abstand *= Math.pow(1.12, schritte);
    this.begrenzen(); this.setzen();
  }

  drehen(dx, dy) {
    this.drehung += dx;
    this.neigung = Math.max(0.28, Math.min(1.45, this.neigung + dy));
    this.setzen();
  }

  /** Kamera auf einen Punkt setzen (Minikarte, Sprungtasten). */
  zentriere(x, z) {
    this.ziel.x = x; this.ziel.z = z;
    this.begrenzen(); this.setzen();
  }

  /** Verschieben in Bildschirmrichtung (mittlere Maustaste). */
  schiebe(dx, dz) {
    const massstab = this.abstand * 0.0022;
    const sin = Math.sin(this.drehung), cos = Math.cos(this.drehung);
    const x = -dx * massstab, z = -dz * massstab;
    this.ziel.x += x * cos - z * sin;
    this.ziel.z += x * sin + z * cos;
    this.begrenzen(); this.setzen();
  }
}
