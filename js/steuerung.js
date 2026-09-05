/* ═══════════════════════════════════════════════════════════
   AGE OF GENERATION — Steuerung

   Maus und Tastatur wie im Vorbild:

     linke Taste      auswaehlen, mit Ziehen ein Rechteck
     rechte Taste     Befehl je nach Ziel — gehen, angreifen,
                      sammeln, bauen, reparieren, Sammelpunkt
     Umschalt         Befehl anhaengen / Auswahl erweitern
     Doppelklick      alle sichtbaren Einheiten desselben Typs
     Strg+Zahl        Kontrollgruppe anlegen, Zahl waehlt sie
     H                zum Dorfzentrum, Punkt = naechster
                      untaetiger Dorfbewohner
     Buchstaben       je nach Auswahl Gebaeude oder Einheiten
     Entf             Gebaeude abreissen, S haelt an
   ═══════════════════════════════════════════════════════════ */
'use strict';

import { FP, GEBAEUDE, EINHEITEN, TECHS, spezialEinheit } from './regeln.js';
import { VORKOMMEN_LISTE } from './karte.js';

export class Steuerung {
  constructor(spiel) {
    this.spiel = spiel;
    this.welt = spiel.welt;
    this.kamera = spiel.kamera;
    this.leinwand = spiel.welt.leinwand;

    this.zieht = false;
    this.zugStart = null;
    this.mausRunter = null;
    this.dreht = false;
    this.schiebt = false;
    this.letzterKlick = 0;
    this.letzterKlickZiel = 0;
    this.gruppen = new Map();
    this.letzteGruppe = { nummer: -1, zeit: 0 };
    this.mauerStart = null;

    this.binde();
  }

  binde() {
    const c = this.leinwand;
    c.addEventListener('contextmenu', e => e.preventDefault());
    c.addEventListener('mousedown', e => this.maustaste(e, true));
    globalThis.addEventListener('mouseup', e => this.maustaste(e, false));
    globalThis.addEventListener('mousemove', e => this.mausBewegt(e));
    c.addEventListener('wheel', e => { e.preventDefault(); this.kamera.zoom(Math.sign(e.deltaY)); }, { passive: false });
    c.addEventListener('mouseenter', () => { this.kamera.maus.drin = true; });
    c.addEventListener('mouseleave', () => { this.kamera.maus.drin = false; });
    globalThis.addEventListener('keydown', e => this.taste(e, true));
    globalThis.addEventListener('keyup', e => this.taste(e, false));
    globalThis.addEventListener('blur', () => this.kamera.tasten.clear());
  }

  ort(e) {
    const r = this.leinwand.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  /* ─────────────── Maus ─────────────── */

  maustaste(e, runter) {
    if (e.target !== this.leinwand && runter) return;
    const p = this.ort(e);

    if (e.button === 1) {           // mittlere Taste: schieben
      this.schiebt = runter;
      this.letzteMaus = p;
      e.preventDefault();
      return;
    }
    if (e.button === 2) {           // rechte Taste
      if (runter) {
        if (this.spiel.bauModus) { this.spiel.bauAbbrechen(); return; }
        this.rechtsklick(p, e.shiftKey);
      }
      return;
    }
    if (e.button !== 0) return;

    if (runter) {
      if (e.altKey) { this.dreht = true; this.letzteMaus = p; return; }
      if (this.spiel.bauModus) { this.bauKlick(p, e, true); return; }
      this.mausRunter = p;
      this.zugStart = p;
      this.zieht = false;
    } else {
      if (this.dreht) { this.dreht = false; return; }
      if (this.spiel.bauModus) { this.bauKlick(p, e, false); return; }
      if (!this.mausRunter) return;
      if (this.zieht) {
        const liste = this.welt.imRechteck(this.zugStart.x, this.zugStart.y, p.x, p.y);
        this.spiel.setzeAuswahl(liste.map(u => u.id), e.shiftKey);
        this.spiel.rahmen(null);
      } else {
        this.einfacherKlick(p, e);
      }
      this.mausRunter = null;
      this.zieht = false;
    }
  }

  mausBewegt(e) {
    const p = this.ort(e);
    this.kamera.maus.x = p.x; this.kamera.maus.y = p.y;
    this.kamera.maus.gesehen = true;

    if (this.dreht && this.letzteMaus) {
      this.kamera.drehen((p.x - this.letzteMaus.x) * 0.006, (p.y - this.letzteMaus.y) * 0.004);
      this.letzteMaus = p; return;
    }
    if (this.schiebt && this.letzteMaus) {
      this.kamera.schiebe(p.x - this.letzteMaus.x, p.y - this.letzteMaus.y);
      this.letzteMaus = p; return;
    }
    if (this.spiel.bauModus) { this.spiel.bauVorschau(p); return; }
    if (this.mausRunter) {
      const d = Math.hypot(p.x - this.mausRunter.x, p.y - this.mausRunter.y);
      if (d > 6) this.zieht = true;
      if (this.zieht) this.spiel.rahmen({ x0: this.zugStart.x, y0: this.zugStart.y, x1: p.x, y1: p.y });
    }
  }

  einfacherKlick(p, e) {
    const ziel = this.welt.entitaetAn(p.x, p.y, false);
    const jetzt = performance.now();
    if (!ziel) {
      if (!e.shiftKey) this.spiel.setzeAuswahl([]);
      return;
    }
    /* Doppelklick: alle sichtbaren Einheiten desselben Typs. */
    if (jetzt - this.letzterKlick < 350 && this.letzterKlickZiel === ziel.id && ziel.art === 'einheit') {
      const gleiche = [];
      for (const u of this.spiel.sim.einheiten) {
        if (u.tot || u.spieler !== this.spiel.spielerId || u.typ !== ziel.typ) continue;
        const s = this.welt.aufSchirm(u.x / FP, 0, u.y / FP);
        if (s.z < 1 && s.x >= 0 && s.y >= 0 && s.x <= this.leinwand.clientWidth && s.y <= this.leinwand.clientHeight) {
          gleiche.push(u.id);
        }
      }
      this.spiel.setzeAuswahl(gleiche, e.shiftKey);
    } else {
      this.spiel.setzeAuswahl([ziel.id], e.shiftKey);
    }
    this.letzterKlick = jetzt;
    this.letzterKlickZiel = ziel.id;
  }

  /* ─────────────── Rechtsklick: der Befehl ergibt sich aus dem Ziel ─────────────── */

  rechtsklick(p, anhaengen) {
    const spiel = this.spiel;
    const sim = spiel.sim;
    if (spiel.zuschauer) return;
    const eigene = spiel.auswahl
      .map(id => sim.nachId.get(id))
      .filter(o => o && !o.tot && o.spieler === spiel.spielerId);
    if (!eigene.length) return;

    const einheiten = eigene.filter(o => o.art === 'einheit');
    const gebaeude = eigene.filter(o => o.art === 'gebaeude');
    const ziel = this.welt.entitaetAn(p.x, p.y, false);
    const punkt = this.welt.bodenPunkt(p.x, p.y);

    /* Gebaeude ausgewaehlt → Sammelpunkt setzen. */
    if (gebaeude.length && !einheiten.length) {
      for (const b of gebaeude) {
        spiel.senden({ a: 'treffpunkt', g: b.id,
          x: Math.round((ziel ? ziel.x / FP : punkt ? punkt.x : 0) * FP),
          y: Math.round((ziel ? ziel.y / FP : punkt ? punkt.z : 0) * FP),
          ziel: ziel && ziel.art === 'gebaeude' ? ziel.id : 0 });
      }
      spiel.hinweis('Sammelpunkt gesetzt');
      return;
    }
    if (!einheiten.length) return;
    const ids = einheiten.map(u => u.id);

    /* Feind → angreifen. */
    if (ziel && !sim.verbuendet(spiel.spielerId, ziel.spieler)) {
      spiel.senden({ a: 'angriff', ids, ziel: ziel.id, anhaengen });
      spiel.klang('befehl');
      return;
    }
    /* Eigenes Gebaeude → bauen, reparieren oder ackern. */
    if (ziel && ziel.art === 'gebaeude' && sim.verbuendet(spiel.spielerId, ziel.spieler)) {
      const def = GEBAEUDE[ziel.typ];
      if (!ziel.fertig) { spiel.senden({ a: 'weiterbauen', ids, ziel: ziel.id, anhaengen }); return; }
      if (def.acker) { spiel.senden({ a: 'sammeln', ids, ziel: ziel.id, anhaengen }); return; }
      if (ziel.hp < ziel.hpMax) { spiel.senden({ a: 'reparieren', ids, ziel: ziel.id, anhaengen }); return; }
      /* Sonst einfach hingehen. */
    }
    if (!punkt) return;
    const kx = punkt.x | 0, ky = punkt.z | 0;
    /* Rohstoffkachel → sammeln. */
    const i = ky * sim.karte.breite + kx;
    if (kx >= 0 && ky >= 0 && kx < sim.karte.breite && ky < sim.karte.hoehe
        && sim.karte.vorkommen[i] && sim.karte.menge[i] > 0) {
      const sammler = ids.filter(id => {
        const u = sim.nachId.get(id);
        return u && sim.werte(u.spieler, u.typ).kannSammeln;
      });
      if (sammler.length) {
        spiel.senden({ a: 'sammeln', ids: sammler, kx, ky, anhaengen });
        const rest = ids.filter(id => sammler.indexOf(id) < 0);
        if (rest.length) spiel.senden({ a: 'gehen', ids: rest, x: Math.round(punkt.x * FP), y: Math.round(punkt.z * FP), anhaengen });
        spiel.klang('befehl');
        return;
      }
    }
    spiel.senden({ a: 'gehen', ids, x: Math.round(punkt.x * FP), y: Math.round(punkt.z * FP), anhaengen });
    spiel.zeigeBefehlspunkt(punkt);
    spiel.klang('befehl');
  }

  /* ─────────────── Bauen ─────────────── */

  bauKlick(p, e, runter) {
    const spiel = this.spiel;
    const typ = spiel.bauModus;
    if (!typ) return;
    const stelle = spiel.bauStelle(p);
    if (!stelle) return;
    if (GEBAEUDE[typ].kette) {
      /* Mauern in einer Reihe: beim Druecken anfangen, beim Loslassen setzen. */
      if (runter) { this.mauerStart = stelle; return; }
      const reihe = this.mauerReihe(this.mauerStart || stelle, stelle);
      this.mauerStart = null;
      spiel.bauAusfuehren(typ, stelle, reihe, e.shiftKey);
      return;
    }
    if (!runter) return;
    spiel.bauAusfuehren(typ, stelle, null, e.shiftKey);
  }

  mauerReihe(a, b) {
    const reihe = [];
    const dx = b.kx - a.kx, dy = b.ky - a.ky;
    const n = Math.max(Math.abs(dx), Math.abs(dy));
    if (n === 0) return [{ kx: a.kx, ky: a.ky }];
    /* Nur gerade oder diagonale Reihen — sonst wird es Kraut und Rueben. */
    const sx = Math.sign(dx), sy = Math.sign(dy);
    const gerade = Math.abs(dx) > Math.abs(dy) * 2 ? [sx, 0]
                 : (Math.abs(dy) > Math.abs(dx) * 2 ? [0, sy] : [sx, sy]);
    for (let i = 0; i <= Math.min(n, 40); i++) {
      reihe.push({ kx: a.kx + gerade[0] * i, ky: a.ky + gerade[1] * i });
    }
    return reihe;
  }

  /* ─────────────── Tastatur ─────────────── */

  taste(e, runter) {
    const ziel = e.target;
    if (ziel && (ziel.tagName === 'INPUT' || ziel.tagName === 'TEXTAREA')) return;
    const k = e.key.toLowerCase();
    const spiel = this.spiel;

    if (!runter) { this.kamera.tasten.delete(k); return; }

    /* Kameratasten laufen weiter, solange sie gedrueckt sind. */
    if (['w', 'a', 's', 'd', 'q', 'e', 'r', 'f', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].indexOf(k) >= 0) {
      /* Buchstaben sind zugleich Baubefehle — nur wenn nichts Eigenes
         ausgewaehlt ist, zaehlen sie als Kamerataste. */
      const belegt = this.tastenBefehl(k, e);
      if (!belegt) this.kamera.tasten.add(k);
      if (k.startsWith('arrow')) e.preventDefault();
      return;
    }

    if (k === 'tab') {
      /* Zuschauer wechseln die Sicht von Spieler zu Spieler. */
      e.preventDefault();
      if (spiel.zuschauer) spiel.blickWechseln();
      return;
    }
    if (k === 'escape') {
      if (spiel.bauModus) spiel.bauAbbrechen();
      else spiel.setzeAuswahl([]);
      return;
    }
    if (k === 'delete') { spiel.abreissen(); return; }
    if (k === ' ') { e.preventDefault(); spiel.zumLetztenEreignis(); return; }
    if (k === '.') { spiel.naechsterUntaetiger(); return; }
    if (k === 'h') { spiel.zumDorfzentrum(); return; }
    if (k === 'p') { spiel.pause(); return; }
    if (k === 'delete') { spiel.abreissen(); return; }

    /* Kontrollgruppen */
    if (k >= '0' && k <= '9') {
      const n = Number(k);
      if (e.ctrlKey || e.metaKey) {
        this.gruppen.set(n, spiel.auswahl.slice());
        spiel.hinweis('Gruppe ' + n + ' gespeichert (' + spiel.auswahl.length + ')');
      } else {
        const g = (this.gruppen.get(n) || []).filter(id => {
          const o = spiel.sim.nachId.get(id);
          return o && !o.tot;
        });
        this.gruppen.set(n, g);
        spiel.setzeAuswahl(g, e.shiftKey);
        const jetzt = performance.now();
        if (this.letzteGruppe.nummer === n && jetzt - this.letzteGruppe.zeit < 400) spiel.zurAuswahl();
        this.letzteGruppe = { nummer: n, zeit: jetzt };
      }
      return;
    }
    this.tastenBefehl(k, e);
  }

  /**
   * Buchstabe als Befehl: Bei ausgewaehlten Dorfbewohnern startet er
   * einen Bau, bei einem Produktionsgebaeude eine Ausbildung oder
   * Forschung. Gibt true zurueck, wenn die Taste verbraucht wurde.
   */
  tastenBefehl(k, e) {
    const spiel = this.spiel;
    if (spiel.zuschauer) return false;
    const sim = spiel.sim;
    const gewaehlt = spiel.auswahl.map(id => sim.nachId.get(id)).filter(o => o && !o.tot && o.spieler === spiel.spielerId);
    if (!gewaehlt.length) return false;
    const p = sim.spieler[spiel.spielerId];

    const bauer = gewaehlt.filter(o => o.art === 'einheit' && sim.werte(o.spieler, o.typ).kannBauen);
    if (bauer.length) {
      for (const typ in GEBAEUDE) {
        const def = GEBAEUDE[typ];
        if (def.taste.toLowerCase() !== k) continue;
        if (def.zeitalter > p.zeitalter) { spiel.hinweis(def.name + ' gibt es erst in der ' + ['Dunklen Zeit','Feudalzeit','Ritterzeit','Imperialzeit'][def.zeitalter]); return true; }
        if (def.braucht && !sim.hatGebaeude(p.id, def.braucht)) { spiel.hinweis(def.name + ' braucht zuerst: ' + GEBAEUDE[def.braucht].name); return true; }
        spiel.bauStarten(typ);
        return true;
      }
      if (k === 's') { spiel.senden({ a: 'stopp', ids: gewaehlt.map(o => o.id) }); return true; }
      return false;
    }

    /* Gebaeude: Einheiten und Forschung ueber die Anfangstaste. */
    const b = gewaehlt.find(o => o.art === 'gebaeude');
    if (b) {
      const def = GEBAEUDE[b.typ];
      for (const typ of (def.produziert || [])) {
        const echt = typ === 'spezial' ? spezialEinheit(p.volk) : typ;
        const ed = EINHEITEN[echt];
        if (!ed || ed.taste.toLowerCase() !== k) continue;
        spiel.senden({ a: 'ausbilden', g: b.id, typ, anzahl: e.shiftKey ? 5 : 1 });
        return true;
      }
      for (const t of (def.forscht || [])) {
        const td = TECHS[t];
        if (!td || td.name[0].toLowerCase() !== k) continue;
        spiel.senden({ a: 'forschen', g: b.id, tech: t });
        return true;
      }
    }
    /* Einheiten: S haelt an. */
    if (k === 's') { spiel.senden({ a: 'stopp', ids: gewaehlt.filter(o => o.art === 'einheit').map(o => o.id) }); return true; }
    return false;
  }
}
