/* ═══════════════════════════════════════════════════════════
   AGE OF GENERATION — Klang

   Alle Geraeusche werden gerechnet, nicht abgespielt: kurze
   Toene aus Oszillatoren und Rauschen. Das spart Dateien und
   klingt trotzdem nach Holz, Metall und Muenzen.
   ═══════════════════════════════════════════════════════════ */
'use strict';

export class Klang {
  constructor() {
    this.aus = false;
    this.ctx = null;
    this.letzte = new Map();
  }

  _an() {
    if (this.aus) return null;
    if (!this.ctx) {
      const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!AC) { this.aus = true; return null; }
      this.ctx = new AC();
      this.haupt = this.ctx.createGain();
      this.haupt.gain.value = 0.22;
      this.haupt.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }

  /** Kurzer Ton mit Huellkurve. */
  ton(frequenz, dauer, art, lautstaerke, gleitZu) {
    const ctx = this._an();
    if (!ctx) return;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = art || 'sine';
    o.frequency.setValueAtTime(frequenz, ctx.currentTime);
    if (gleitZu) o.frequency.exponentialRampToValueAtTime(Math.max(30, gleitZu), ctx.currentTime + dauer);
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(lautstaerke || 0.3, ctx.currentTime + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dauer);
    o.connect(g); g.connect(this.haupt);
    o.start(); o.stop(ctx.currentTime + dauer + 0.02);
  }

  /** Rauschstoss — fuer Hiebe, Einschlaege, Faellen. */
  rauschen(dauer, filter, lautstaerke) {
    const ctx = this._an();
    if (!ctx) return;
    const n = Math.floor(ctx.sampleRate * dauer);
    const puffer = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = puffer.getChannelData(0);
    let wert = 0;
    for (let i = 0; i < n; i++) {
      wert = (wert + (Math.random() * 2 - 1) * 0.5) * 0.86;
      d[i] = wert * (1 - i / n);
    }
    const q = ctx.createBufferSource();
    q.buffer = puffer;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = filter || 900; f.Q.value = 0.9;
    const g = ctx.createGain();
    g.gain.value = lautstaerke == null ? 0.3 : lautstaerke;
    q.connect(f); f.connect(g); g.connect(this.haupt);
    q.start();
  }

  /** Benannte Geraeusche, mit Sperre gegen Dauerfeuer. */
  spiele(art) {
    const jetzt = performance.now();
    const sperre = { hieb: 55, schuss: 70, treffer: 60, abgabe: 160, einschlag: 140 }[art] || 0;
    if (sperre) {
      const l = this.letzte.get(art) || 0;
      if (jetzt - l < sperre) return;
      this.letzte.set(art, jetzt);
    }
    switch (art) {
      case 'befehl':      this.ton(660, 0.06, 'triangle', 0.16, 880); break;
      case 'auswahl':     this.ton(520, 0.05, 'square', 0.08); break;
      case 'hieb':        this.rauschen(0.09, 1400, 0.22); break;
      case 'schuss':      this.rauschen(0.07, 2600, 0.12); break;
      case 'treffer':     this.rauschen(0.06, 1800, 0.14); break;
      case 'einschlag':   this.rauschen(0.3, 320, 0.4); this.ton(90, 0.25, 'sine', 0.3, 45); break;
      case 'abgabe':      this.ton(880, 0.05, 'sine', 0.1, 1320); break;
      case 'gebaeude':    this.ton(300, 0.12, 'triangle', 0.2, 450); this.rauschen(0.18, 700, 0.15); break;
      case 'einheit':     this.ton(440, 0.09, 'sine', 0.12, 660); break;
      case 'zeitalter':   [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => this.ton(f, 0.35, 'triangle', 0.22), i * 130)); break;
      case 'angriff':     this.ton(220, 0.5, 'sawtooth', 0.16, 180); break;
      case 'sieg':        [523, 659, 784, 1047, 1319].forEach((f, i) => setTimeout(() => this.ton(f, 0.5, 'triangle', 0.25), i * 160)); break;
      case 'niederlage':  [523, 466, 392, 311].forEach((f, i) => setTimeout(() => this.ton(f, 0.6, 'sine', 0.22), i * 200)); break;
      case 'fehlt':       this.ton(200, 0.14, 'square', 0.12, 150); break;
    }
  }
}
